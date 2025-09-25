import "dotenv/config";
import express, { Response } from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const app = express();

// CORS for Vite dev server
app.use(
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */
function readJSON<T = any>(rel: string): T {
  const p = path.join(process.cwd(), rel);
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

type Station = {
  id: string;
  name: string;
  line: string | null;
  pod: string | null;
  area: string | null;
  hmi_brand: string | null;
  builder: string | null;
  screen_url: string | null;
};

type Device = {
  id: string;
  station_id: string;
  name: string | null;
  type: string;
  vendor: string | null;
  model: string | null;
  tags: string[] | null;
};

const STATIONS: Station[] = readJSON<Station[]>("seed/stations.json");
const DEVICES: Device[] = readJSON<Device[]>("seed/devices.json");

/* ------------------------------------------------------------------ */
/* TimescaleDB bootstrap (optional, idempotent)                        */
/* ------------------------------------------------------------------ */
async function ensureTimescale() {
  try {
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS timescaledb`);

    const exists = (await prisma.$queryRawUnsafe<any[]>(
      `SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name='Telemetry'`
    )) as any[];

    if (!Array.isArray(exists) || exists.length === 0) {
      await prisma.$executeRawUnsafe(
        `SELECT create_hypertable('public."Telemetry"', 'time', if_not_exists => TRUE, migrate_data => TRUE)`
      );
      console.log("[DB] Timescale hypertable created for Telemetry.");
    } else {
      console.log("[DB] Timescale already configured.");
    }
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg.includes("TS103")) {
      console.warn(
        "[DB] Timescale TS103 warning: ensure your Prisma model uses a composite PK including `time`."
      );
    } else {
      console.error("[DB] Timescale init error:", msg);
    }
  }
}

/* ------------------------------------------------------------------ */
/* SSE channel (per station)                                           */
/* ------------------------------------------------------------------ */
const channels = new Map<string, Set<Response>>();

function publish(stationId: string, data: unknown) {
  const set = channels.get(stationId);
  if (!set) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      // ignore broken pipe
    }
  }
}

function openSSE(res: Response, stationId: string) {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  (res as any).flushHeaders?.();

  let set = channels.get(stationId);
  if (!set) {
    set = new Set();
    channels.set(stationId, set);
  }
  set.add(res);

  res.write(`event: hello\ndata: {"stationId":"${stationId}"}\n\n`);
  const iv = setInterval(() => res.write(":\n\n"), 15000);

  res.req.on("close", () => {
    clearInterval(iv);
    set!.delete(res);
    if (set!.size === 0) channels.delete(stationId);
    console.log("[SSE] close", stationId);
  });

  console.log("[SSE] open", stationId);
}

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "industrial-api", ts: new Date().toISOString() });
});

/* ------------------------------------------------------------------ */
/* Stations & Devices                                                  */
/* ------------------------------------------------------------------ */
app.get("/api/stations", (_req, res) => {
  res.json(STATIONS);
});

app.get("/api/devices", (req, res) => {
  const stationId =
    typeof req.query.station_id === "string" ? req.query.station_id : undefined;
  if (!stationId) return res.json(DEVICES);
  return res.json(DEVICES.filter((d) => d.station_id === stationId));
});

/* Inventory: group by device type */
app.get("/api/inventory", (_req, res) => {
  const map = new Map<string, number>();
  for (const d of DEVICES) {
    const key = d.type ?? "unknown";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  const items = [...map.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
  res.json(items);
});

/* ------------------------------------------------------------------ */
/* SSE endpoints                                                       */
/* ------------------------------------------------------------------ */
/** New endpoint (query): /api/sse?stationId=... */
app.get("/api/sse", (req, res) => {
  const stationId = String(req.query.stationId ?? "unknown");
  openSSE(res, stationId);
});

/** Back-compat alias expected by FE: /api/stream/station/:id */
app.get("/api/stream/station/:id", (req, res) => {
  const stationId = String(req.params.id);
  openSSE(res, stationId);
});

/* ------------------------------------------------------------------ */
/* Telemetry ingest (k/v schema)                                       */
/* ------------------------------------------------------------------ */
app.post("/api/telemetry", async (req, res) => {
  try {
    const body = req.body ?? {};
    const stationId = String(body.stationId ?? "");
    const deviceId =
      body.deviceId == null ? null : String(body.deviceId ?? "").trim() || null;
    if (!stationId) return res.status(400).json({ error: "stationId required" });

    const now = new Date();
    type Row = {
      k: string;
      v: number | null;
      time: Date;
      stationId: string;
      deviceId?: string | null;
    };
    const rows: Row[] = [];

    const pushRow = (k: unknown, v: unknown, t?: unknown) => {
      if (k == null) return;
      const key = String(k);
      const num = typeof v === "number" ? v : v == null ? null : Number(v);
      const ts = t ? new Date(String(t)) : now;
      if (num !== null && Number.isNaN(num)) return;
      rows.push({ k: key, v: num, time: ts, stationId, deviceId });
    };

    if (Array.isArray(body.events)) {
      for (const e of body.events) pushRow(e?.k, e?.v, e?.time);
    } else if (
      Object.prototype.hasOwnProperty.call(body, "k") &&
      Object.prototype.hasOwnProperty.call(body, "v")
    ) {
      pushRow(body.k, body.v, body.time);
    } else {
      const t = body.time;
      for (const [k, v] of Object.entries(body)) {
        if (k === "stationId" || k === "deviceId" || k === "time") continue;
        if (typeof v === "number") pushRow(k, v, t);
      }
    }

    if (rows.length === 0) return res.status(400).json({ error: "no metrics" });

    await prisma.telemetry.createMany({ data: rows });

    // Minimal live fan-out: group a few known keys if present
    const snapshot: Record<string, number> = {};
    for (const r of rows) {
      if (r.k === "pass" || r.k === "fail" || r.k === "suspect" || r.k === "packedFg") {
        if (typeof r.v === "number") snapshot[r.k] = r.v;
      }
    }
    publish(stationId, {
      stationId,
      ts: new Date().toISOString(),
      ...snapshot,
    });

    return res.status(201).json({ ok: true, inserted: rows.length });
  } catch (err) {
    console.error("[telemetry] ingest error", err);
    return res.status(500).json({ error: "ingest failed" });
  }
});

/* ------------------------------------------------------------------ */
/* Simple simulator (back-compat for FE button)                        */
/* ------------------------------------------------------------------ */
app.post("/api/sim/start/:id", async (req, res) => {
  const stationId = String(req.params.id);

  (async () => {
    let pass = 12,
      fail = 1,
      suspect = 0,
      packedFg = 13;

    for (let i = 0; i < 8; i++) {
      const now = new Date();

      pass += Math.random() < 0.7 ? 1 : 0;
      fail += Math.random() < 0.1 ? 1 : 0;
      suspect += Math.random() < 0.15 ? 1 : 0;
      packedFg = Math.max(packedFg, pass + fail + suspect);

      await prisma.telemetry.createMany({
        data: [
          { time: now, stationId, k: "pass", v: pass },
          { time: now, stationId, k: "fail", v: fail },
          { time: now, stationId, k: "suspect", v: suspect },
          { time: now, stationId, k: "packedFg", v: packedFg },
        ],
      });

      publish(stationId, {
        stationId,
        ts: new Date().toISOString(),
        status: "RUNNING",
        pass,
        fail,
        suspect,
        packedFg,
      });

      await new Promise((r) => setTimeout(r, 1000));
    }
  })().catch((e) => console.error("[sim] error", e));

  res.json({ ok: true, stationId });
});

/* ------------------------------------------------------------------ */
/* Boot & shutdown                                                     */
/* ------------------------------------------------------------------ */
const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => {
  console.log(`industrial-api listening on http://localhost:${PORT}`);
  void ensureTimescale();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    console.log(`\n[app] ${signal} received, shutting down...`);
    try {
      await prisma.$disconnect();
    } finally {
      process.exit(0);
    }
  });
}

// src/server.ts
import express from "express";
import cors from "cors";
import http from "http";
import { Server as IOServer } from "socket.io";
import { PrismaClient } from "@prisma/client";

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, {
  cors: { origin: true, credentials: true },
});

const prisma = new PrismaClient();

// ---------- middleware ----------
app.use(cors());
app.use(express.json());

// ---------- utils ----------
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Parse "1m/5s/1h" to SQL interval string
function parseBucketToInterval(bucket?: string): string {
  const b = (bucket || "1m").trim().toLowerCase();
  const m = b.match(/^(\d+)(s|m|h)$/);
  if (!m) return "1 minute";
  const n = Number(m[1]);
  const u = m[2];
  if (u === "s") return `${n} seconds`;
  if (u === "m") return `${n} minutes`;
  if (u === "h") return `${n} hours`;
  return "1 minute";
}

// ---------- Timescale bootstrap (idempotent) ----------
async function ensureTimescale() {
  try {
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS timescaledb;`);

    // فقط اگر هنوز hypertable نشده، با مهاجرت داده‌ها بساز
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM timescaledb_information.hypertables
          WHERE hypertable_name = 'Telemetry'
        ) THEN
          PERFORM create_hypertable('"Telemetry"', 'time', if_not_exists => TRUE, migrate_data => TRUE);
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          -- در حالت dev اگر همزمان اجرا شد بی‌صدا رد شو
          NULL;
      END
      $$;
    `);

    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Telemetry_time_idx" ON "Telemetry" ("time" DESC);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Telemetry_station_time_idx" ON "Telemetry" ("stationId", "time" DESC);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Telemetry_device_time_idx" ON "Telemetry" ("deviceId", "time" DESC);`);

    console.log("[DB] Timescale ensured.");
  } catch (e) {
    console.error("[DB] Timescale init error:", e);
  }
}

// ---------- Health ----------
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ---------- Stations / Devices / Inventory ----------
app.get("/api/stations", async (_req, res) => {
  try {
    const stations = await prisma.station.findMany({
      orderBy: { name: "asc" }, // اگر فیلد name ندارید، به code یا فیلد مناسب تغییر دهید
    });
    res.json(stations);
  } catch (e) {
    console.error("GET /api/stations error", e);
    res.status(500).json({ error: "failed" });
  }
});

app.get("/api/stations/:id/devices", async (req, res) => {
  try {
    const id = String(req.params.id);
    // اگر مدل شما فیلد stationId دارد، stationId را بگذارید. اگر station_id است همین بماند.
    const devices = await prisma.device.findMany({
      where: { station_id: id as any },
      orderBy: { id: "asc" },
    });
    res.json(devices);
  } catch (e) {
    console.error("GET /api/stations/:id/devices error", e);
    res.status(500).json({ error: "failed" });
  }
});

app.get("/api/devices", async (req, res) => {
  try {
    const stationId = req.query.station_id ? String(req.query.station_id) : undefined;
    const devices = await prisma.device.findMany({
      where: stationId ? ({ station_id: stationId } as any) : {},
      orderBy: { id: "asc" },
    });
    res.json(devices);
  } catch (e) {
    console.error("GET /api/devices error", e);
    res.status(500).json({ error: "failed" });
  }
});

app.get("/api/devices/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device) return res.status(404).json({ error: "not found" });
    res.json(device);
  } catch (e) {
    console.error("GET /api/devices/:id error", e);
    res.status(500).json({ error: "failed" });
  }
});

// Inventory: تجمیع بر اساس نوع دستگاه (بدون orderBy تایپی در Prisma)
app.get("/api/inventory", async (_req, res) => {
  try {
    const groups = await prisma.device.groupBy({
      by: ["type"],
      _count: { _all: true },
      // orderBy را نمی‌گذاریم؛ در JS سورت می‌کنیم تا با تایپ‌های Prisma شما سازگار باشد
    });

    groups.sort((a, b) => (b._count?._all ?? 0) - (a._count?._all ?? 0));

    const result = groups.map((g) => ({
      type: g.type,
      count: g._count?._all ?? 0,
    }));

    res.json(result);
  } catch (e) {
    console.error("GET /api/inventory error", e);
    res.status(500).json({ error: "failed" });
  }
});

// ---------- SSE live stream (per station) ----------
type SSEConn = {
  res: express.Response;
  stationId: string;
  pingTimer?: NodeJS.Timeout;
};
const sseClients = new Map<string, Set<SSEConn>>();

function sseWrite(res: express.Response, data: any, event = "message") {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

app.get("/api/stream/station/:id", async (req, res) => {
  const stationId = String(req.params.id);
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const conn: SSEConn = { res, stationId };
  if (!sseClients.has(stationId)) sseClients.set(stationId, new Set());
  sseClients.get(stationId)!.add(conn);

  console.log("[SSE] open", stationId);

  // keep-alive ping
  conn.pingTimer = setInterval(() => {
    try {
      sseWrite(res, { ping: Date.now() }, "ping");
    } catch {}
  }, 25000);

  req.on("close", () => {
    clearInterval(conn.pingTimer!);
    sseClients.get(stationId)?.delete(conn);
    console.log("[SSE] close", stationId);
  });
});

// نمونه براودکست به SSE
function sseBroadcast(stationId: string, event: string, payload: any) {
  const set = sseClients.get(stationId);
  if (!set) return;
  for (const c of set) {
    try {
      sseWrite(c.res, payload, event);
    } catch {}
  }
}

// ---------- Socket.IO ----------
io.on("connection", (socket) => {
  console.log("socket connected", socket.id);
  socket.on("join-station", (stationId: string) => {
    socket.join(`station:${stationId}`);
    socket.emit("joined", stationId);
  });
  socket.on("disconnect", () => {
    console.log("socket disconnected", socket.id);
  });
});

// ---------- Simulator (mock) ----------
app.post("/api/sim/start/:id", async (req, res) => {
  const stationId = String(req.params.id);
  (async () => {
    for (let i = 0; i < 5; i++) {
      const payload = {
        stationId,
        status: "RUNNING",
        speed: 40 + Math.round(Math.random() * 20),
        count: 100 + i,
        pass: 95 + (i % 3),
        fail: 1,
        suspect: 1,
        packedFg: 3,
        ts: new Date().toISOString(),
      };
      io.to(`station:${stationId}`).emit("telemetry", payload);
      sseBroadcast(stationId, "telemetry", payload);
      await sleep(1000);
    }
  })();

  res.json({ ok: true });
});

// ---------- Actions (mock) ----------
app.post("/api/actions/device/:id", async (req, res) => {
  const id = String(req.params.id);
  res.json({ ok: true, deviceId: id, action: "mocked" });
});

// ---------- Telemetry: POST ingest ----------
app.post("/api/telemetry", async (req, res) => {
  try {
    const { stationId, ts, status, speed, count, pass, fail, suspect, packedFg, deviceId } = req.body || {};
    if (!stationId || typeof stationId !== "string") {
      return res.status(400).json({ error: "stationId required" });
    }
    const timeSql = ts ? `TO_TIMESTAMP(${Date.parse(ts)} / 1000.0)` : "NOW()";

    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "Telemetry" ("time","stationId","status","speed","count","pass","fail","suspect","packedFg","deviceId")
      VALUES (${timeSql}, $1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT ("stationId","time") DO UPDATE SET
        "status"=EXCLUDED."status",
        "speed"=EXCLUDED."speed",
        "count"=EXCLUDED."count",
        "pass"=EXCLUDED."pass",
        "fail"=EXCLUDED."fail",
        "suspect"=EXCLUDED."suspect",
        "packedFg"=EXCLUDED."packedFg",
        "deviceId"=EXCLUDED."deviceId"
      `,
      stationId,
      status ?? null,
      Number.isFinite(+speed) ? +speed : null,
      Number.isFinite(+count) ? +count : null,
      Number.isFinite(+pass) ? +pass : null,
      Number.isFinite(+fail) ? +fail : null,
      Number.isFinite(+suspect) ? +suspect : null,
      Number.isFinite(+packedFg) ? +packedFg : null,
      deviceId ?? null
    );

    const payload = {
      stationId,
      status,
      speed,
      count,
      pass,
      fail,
      suspect,
      packedFg,
      ts: ts || new Date().toISOString(),
    };
    io.to(`station:${stationId}`).emit("telemetry", payload);
    sseBroadcast(stationId, "telemetry", payload);

    res.json({ ok: true });
  } catch (e) {
    console.error("POST /api/telemetry error", e);
    res.status(500).json({ error: "ingest failed" });
  }
});

// ---------- Telemetry: GET history (bucketed) ----------
app.get("/api/telemetry/:stationId", async (req, res) => {
  try {
    const stationId = String(req.params.stationId || "").trim();
    if (!stationId) return res.status(400).json({ error: "stationId required" });

    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 10 * 60 * 1000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const bucket = parseBucketToInterval(String(req.query.bucket || "1m"));
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json({ error: "invalid from/to" });
    }

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        time_bucket($1::interval, "time") AS bucket,
        AVG("speed")     AS speed,
        AVG("count")     AS count,
        AVG("pass")      AS pass,
        AVG("fail")      AS fail,
        AVG("suspect")   AS suspect,
        AVG("packedFg")  AS "packedFg",
        (ARRAY_REMOVE(ARRAY_AGG("status" ORDER BY "time" DESC), NULL))[1] AS status
      FROM "Telemetry"
      WHERE "stationId" = $2
        AND "time" >= $3::timestamptz
        AND "time" <= $4::timestamptz
      GROUP BY bucket
      ORDER BY bucket ASC
      `,
      bucket,
      stationId,
      from.toISOString(),
      to.toISOString()
    );

    const data = rows.map((r) => ({
      ts: new Date(r.bucket).toISOString(),
      status: r.status ?? null,
      speed: Math.round(Number(r.speed ?? 0)),
      count: Math.round(Number(r.count ?? 0)),
      pass: Math.round(Number(r.pass ?? 0)),
      fail: Math.round(Number(r.fail ?? 0)),
      suspect: Math.round(Number(r.suspect ?? 0)),
      packedFg: Math.round(Number(r.packedFg ?? 0)),
    }));

    res.json({ stationId, bucket, from: from.toISOString(), to: to.toISOString(), data });
  } catch (e) {
    console.error("GET /api/telemetry error", e);
    res.status(500).json({ error: "query failed" });
  }
});

// ---------- start ----------
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

ensureTimescale().finally(() => {
  server.listen(PORT, () => {
    console.log(`industrial-api listening on http://localhost:${PORT}`);
  });
});


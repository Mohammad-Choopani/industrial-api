// prisma/seed.ts
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import path from "path";

type Station = {
  id: string;
  name: string;
  line: string;
  pod: string | null;
  area: string | null;
  hmi_brand: string | null;
  builder: string | null;
  screen_url: string | null;
};

type Device = {
  id: string;
  station_id: string;
  name?: string | null;
  type: string;
  vendor?: string | null;
  model?: string | null;
  tags?: string[];
};

const prisma = new PrismaClient();

function loadJSON<T = any>(p: string): T {
  return JSON.parse(readFileSync(p, "utf8"));
}

async function seedStationsAndDevices() {
  const root = process.cwd();
  const stationsPath = path.join(root, "seed", "stations.json");
  const devicesPath = path.join(root, "seed", "devices.json");

  const stations = loadJSON<Station[]>(stationsPath);
  const devices = loadJSON<Device[]>(devicesPath);

  for (const st of stations) {
    await prisma.station.upsert({
      where: { id: st.id },
      update: {
        name: st.name,
        line: st.line,
        pod: st.pod ?? null,
        area: st.area ?? null,
        hmi_brand: st.hmi_brand ?? null,
        builder: st.builder ?? null,
        screen_url: st.screen_url ?? null,
      },
      create: {
        id: st.id,
        name: st.name,
        line: st.line,
        pod: st.pod ?? null,
        area: st.area ?? null,
        hmi_brand: st.hmi_brand ?? null,
        builder: st.builder ?? null,
        screen_url: st.screen_url ?? null,
      },
    });
  }

  for (const d of devices) {
    await prisma.device.upsert({
      where: { id: d.id },
      update: {
        station_id: d.station_id,
        name: d.name ?? null,
        type: d.type,
        vendor: d.vendor ?? null,
        model: d.model ?? null,
        tags: d.tags ?? [],
      },
      create: {
        id: d.id,
        station_id: d.station_id,
        name: d.name ?? null,
        type: d.type,
        vendor: d.vendor ?? null,
        model: d.model ?? null,
        tags: d.tags ?? [],
      },
    });
  }

  return { stations: stations.length, devices: devices.length };
}

async function seedSampleTelemetry() {
  const stId = "23-SPOILER-1";

  // start 30 minutes ago, but add a small offset to avoid exact same timestamps across runs
  const base = new Date(Date.now() - 30 * 60_000 + Math.floor(Math.random() * 10_000));

  const rows: {
    time: Date;
    stationId: string;
    deviceId?: string | null;
    k: string;
    v: number | null;
  }[] = [];

  let packed = 20, pass = 18, fail = 1, suspect = 1;

  for (let i = 0; i < 30; i++) {
    const t = new Date(base.getTime() + i * 60_000);
    const rnd = Math.random();
    if (rnd < 0.7) { pass++; packed++; }
    else if (rnd < 0.85) { suspect++; packed++; }
    else { fail++; packed++; }

    rows.push(
      { time: t, stationId: stId, k: "packedFg", v: packed },
      { time: t, stationId: stId, k: "pass", v: pass },
      { time: t, stationId: stId, k: "fail", v: fail },
      { time: t, stationId: stId, k: "suspect", v: suspect },
    );
  }

  // Skip duplicates so the script is idempotent (respects unique (stationId,time))
  const res = await prisma.telemetry.createMany({ data: rows, skipDuplicates: true });
  return res.count;
}

async function main() {
  const a = await seedStationsAndDevices();
  const inserted = await seedSampleTelemetry();
  console.log("Seed completed:", { ...a, telemetryRowsInserted: inserted });
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

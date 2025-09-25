// web/src/lib/api.ts
import { io, type Socket } from "socket.io-client";

/* ---------------- Types ---------------- */
export type Station = {
  id: string;
  name: string;
  line: string;
  pod?: string | null;
  area?: string | null;
  hmi_brand?: string | null;
  builder?: string | null;
  screen_url?: string | null;
};

export type Device = {
  id: string;
  station_id: string;
  name?: string | null;
  type: string;
  vendor?: string | null;
  model?: string | null;
  tags: string[];
};

export type InventoryByType = { type: string; count: number };
export type InventoryByStation = { station_id: string; count: number };

export type TelemetryEvent = {
  ts: string;
  stationId: string;
  metrics: {
    scheduled?: number;
    packedFg?: number;
    pass?: number;
    fail?: number;
    suspect?: number;
  };
  status?: "RUN" | "IDLE" | "DOWN";
  note?: string;
};

/* ------------- Socket event types (اختیاری ولی مفید) ------------- */
export type ClientToServerEvents = {
  "join-station": (stationId: string) => void;
};

export type ServerToClientEvents = {
  telemetry: (e: TelemetryEvent) => void;
};

/* ---------------- Base URL ---------------- */
const API_BASE =
  (import.meta as any)?.env?.VITE_API_URL ??
  (typeof window !== "undefined" ? (window as any).VITE_API_URL : null) ??
  "http://localhost:4000";

/* ---------------- tiny fetch helper ---------------- */
async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

/* ---------------- REST endpoints ---------------- */
export async function getStations(): Promise<Station[]> {
  return apiGet<Station[]>("/api/stations");
}

export async function getDevicesByStation(stationId: string): Promise<Device[]> {
  return apiGet<Device[]>(
    `/api/stations/${encodeURIComponent(stationId)}/devices`
  );
}

export async function getDevices(stationId?: string): Promise<Device[]> {
  if (stationId) {
    return apiGet<Device[]>(
      `/api/devices?station_id=${encodeURIComponent(stationId)}`
    );
  }
  return apiGet<Device[]>("/api/devices");
}

export async function getInventory(): Promise<{
  devicesByType: InventoryByType[];
  devicesByStation: InventoryByStation[];
}> {
  return apiGet("/api/inventory");
}

/* ---------------- SSE (Server-Sent Events) ---------------- */
export function openSSE(
  stationId: string,
  onEvent: (e: TelemetryEvent) => void
): EventSource {
  const url = `${API_BASE}/api/stream/station/${encodeURIComponent(stationId)}`;
  const es = new EventSource(url);
  es.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data) as TelemetryEvent;
      onEvent(data);
    } catch (err) {
      console.error("SSE parse error:", err);
    }
  };
  es.onerror = (err) => {
    console.warn("SSE error:", err);
  };
  return es;
}

/* ---------------- Socket.IO helpers ---------------- */
export function makeSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  // socket.io-client از URL http هم استفاده می‌کند؛ نیاز نیست ws:// بنویسیم
  const s = io(API_BASE, { transports: ["websocket"] });
  s.on("connect", () => console.log("socket connected", s.id));
  s.on("disconnect", (r) => console.log("socket disconnected", r));
  return s;
}

export function joinStation(
  socket: Socket<ServerToClientEvents, ClientToServerEvents>,
  stationId: string
) {
  socket.emit("join-station", stationId);
}

export async function startSim(stationId: string) {
  const res = await fetch(
    `${API_BASE}/api/sim/start/${encodeURIComponent(stationId)}`,
    { method: "POST" }
  );
  if (!res.ok) throw new Error(`startSim failed: ${res.status}`);
  return res.json();
}
export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

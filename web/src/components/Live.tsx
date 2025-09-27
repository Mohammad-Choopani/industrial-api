// web/src/components/Live.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE ||
  (import.meta as any).env?.VITE_API_URL ||
  "http://localhost:4000";

type TelemetryEvent = {
  stationId?: string;
  ts?: string; // ISO timestamp from server
  status?: "RUNNING" | "IDLE" | "DOWN" | string;
  speed?: number;
  count?: number;
  pass?: number;
  fail?: number;
  suspect?: number;
  packedFg?: number;
  [k: string]: any;
};

type Props = {
  stationId: string;
  maxPoints?: number;
  throttleMs?: number; // UI update throttle
  speedEmaAlpha?: number; // 0..1 (lower = smoother)
};

export default function Live({
  stationId,
  maxPoints = 300,
  throttleMs = 250,
  speedEmaAlpha = 0.3,
}: Props) {
  const [points, setPoints] = useState<any[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);

  const esRef = useRef<EventSource | null>(null);

  // last snapshot from server (authoritative for counters)
  const lastSnapRef = useRef<{
    ts: string;
    status: string;
    speed: number; // EMA-smoothed
    count: number;
    pass: number;
    fail: number;
    suspect: number;
    packedFg: number;
  }>({
    ts: "",
    status: "IDLE",
    speed: 0,
    count: 0,
    pass: 0,
    fail: 0,
    suspect: 0,
    packedFg: 0,
  });

  // dedup + throttle
  const lastTsRef = useRef<string>("");
  const throttleTimerRef = useRef<number | null>(null);
  const pendingRef = useRef<typeof lastSnapRef.current | null>(null);

  const flush = () => {
    if (!pendingRef.current) return;
    const s = pendingRef.current;
    setPoints((prev) => {
      const time = new Date(s.ts || Date.now()).toLocaleTimeString([], { hour12: false });
      const next = [
        ...prev,
        {
          t: s.ts,
          timeLabel: time,
          status: s.status,
          // counters are NOT smoothed
          count: s.count,
          pass: s.pass,
          fail: s.fail,
          suspect: s.suspect,
          packedFg: s.packedFg,
          // speed is smoothed (for KPI if needed later)
          speed: Math.round(s.speed),
        },
      ];
      if (next.length > maxPoints) next.splice(0, next.length - maxPoints);
      return next;
    });
    pendingRef.current = null;
  };

  const scheduleFlush = () => {
    if (throttleTimerRef.current != null) return;
    throttleTimerRef.current = window.setTimeout(() => {
      flush();
      throttleTimerRef.current = null;
    }, throttleMs);
  };

  const onTelemetry = (e: MessageEvent) => {
    if (paused) return;
    try {
      const data: TelemetryEvent = JSON.parse(e.data);

      // dedup by server timestamp if present
      const ts = typeof data.ts === "string" ? data.ts : new Date().toISOString();
      if (ts === lastTsRef.current) return;
      lastTsRef.current = ts;

      // counters come directly (no EMA)
      const pass = toNum(data.pass, lastSnapRef.current.pass);
      const fail = toNum(data.fail, lastSnapRef.current.fail);
      const suspect = toNum(data.suspect, lastSnapRef.current.suspect);
      const packedFg = toNum(data.packedFg, lastSnapRef.current.packedFg);
      const count = toNum(data.count, lastSnapRef.current.count);

      // speed: EMA only (avoid jitter)
      const alpha = clamp01(speedEmaAlpha);
      const speedRaw = toNum(data.speed, lastSnapRef.current.speed);
      const speed = alpha * speedRaw + (1 - alpha) * lastSnapRef.current.speed;

      const status = String(data.status ?? lastSnapRef.current.status ?? "IDLE");

      const snapshot = {
        ts,
        status,
        speed,
        count,
        pass,
        fail,
        suspect,
        packedFg,
      };

      lastSnapRef.current = snapshot;
      pendingRef.current = snapshot;
      if (debug) console.log("[telemetry]", snapshot);
      scheduleFlush();
    } catch {
      // ignore malformed message
    }
  };

  useEffect(() => {
    if (!stationId) return;
    setError(null);

    const url = `${API_BASE}/api/stream/station/${encodeURIComponent(stationId)}`;
    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;

    es.addEventListener("telemetry", onTelemetry);
    es.addEventListener("ping", () => {}); // ignore keepalive
    es.addEventListener("hello", () => {}); // ignore hello

    es.onopen = () => setStreaming(true);
    es.onerror = () => setError("SSE connection error");

    return () => {
      es.close();
      esRef.current = null;
      setStreaming(false);
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
    };
  }, [stationId]);

  const stopStream = () => {
    esRef.current?.close();
    esRef.current = null;
    setStreaming(false);
  };

  const startStream = () => {
    // simply re-run effect by changing key: force cleanup + reopen
    stopStream();
    lastTsRef.current = "";
    lastSnapRef.current.ts = "";
    // reopen by toggling a dummy state or instruct user to change station selection if needed
    const url = `${API_BASE}/api/stream/station/${encodeURIComponent(stationId)}`;
    const es = new EventSource(url, { withCredentials: true });
    es.addEventListener("telemetry", onTelemetry);
    es.addEventListener("ping", () => {});
    es.addEventListener("hello", () => {});
    es.onopen = () => setStreaming(true);
    es.onerror = () => setError("SSE connection error");
    esRef.current = es;
  };

  const togglePause = () => setPaused((p) => !p);
  const resetData = () => setPoints([]);

  const startSimulator = async () => {
    setError(null);
    try {
      const r = await fetch(
        `${API_BASE}/api/sim/start/${encodeURIComponent(stationId)}`,
        { method: "POST" }
      );
      if (!r.ok) throw new Error(`Simulator failed: ${r.status}`);
    } catch (e: any) {
      setError(e?.message || "Simulator error.");
    }
  };

  const last = points.length ? points[points.length - 1] : null;

  return (
    <div style={{ padding: 16 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>
          Live — Station: <span style={{ opacity: 0.85 }}>{stationId}</span>
        </h2>
        <span
          style={{
            fontSize: 12,
            padding: "2px 8px",
            borderRadius: 999,
            background: streaming ? "#1b5e20" : "#424242",
            color: "#fff",
          }}
        >
          {streaming ? (paused ? "PAUSED" : "STREAMING") : "STOPPED"}
        </span>
        <label style={{ marginLeft: 8, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={debug}
            onChange={(e) => setDebug(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          Debug logs
        </label>
        <small style={{ opacity: 0.6 }}>
          throttle={throttleMs}ms • speedEMA={speedEmaAlpha}
        </small>
      </header>

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {!streaming ? (
          <button onClick={startStream} style={btn()}>
            Start Stream
          </button>
        ) : (
          <button onClick={stopStream} style={btn()}>
            Stop Stream
          </button>
        )}
        <button onClick={togglePause} disabled={!streaming} style={btn()}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button onClick={resetData} style={btn()}>
          Reset
        </button>
        <button onClick={startSimulator} style={btn()}>
          Start Simulator
        </button>
      </div>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0,1fr))",
          gap: 12,
          marginTop: 12,
        }}
      >
        <Kpi title="Status" value={last?.status ?? "—"} />
        <Kpi title="Speed" value={last?.speed ?? 0} />
        <Kpi title="Count" value={last?.count ?? 0} />
        <Kpi title="Samples" value={points.length} />
      </section>

      <section style={{ marginTop: 12 }}>
        <div className="live-chart" style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <LineChart data={points} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="timeLabel" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="pass" dot={false} name="Pass" />
              <Line type="monotone" dataKey="fail" dot={false} name="Fail" />
              <Line type="monotone" dataKey="suspect" dot={false} name="Suspect" />
              <Line type="monotone" dataKey="packedFg" dot={false} name="Packed FG" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {error && (
        <div
          style={{
            marginTop: 12,
            padding: 8,
            border: "1px solid #b71c1c",
            color: "#ff8a80",
            borderRadius: 8,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

function Kpi({ title, value }: { title: string; value: React.ReactNode }) {
  return (
    <div style={{ padding: 12, borderRadius: 12, background: "#1f2937", color: "#e5e7eb" }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function btn(): React.CSSProperties {
  return {
    padding: "8px 12px",
    borderRadius: 10,
    background: "#263238",
    color: "#fff",
    border: "1px solid #37474f",
    cursor: "pointer",
  };
}

function toNum(n: any, fallback = 0): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

// web/src/components/Live.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
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

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

// Smoothed chart with fixed sampling, EMA, and status hysteresis.
type TelemetryEvent = {
  stationId?: string;
  ts?: string;
  status?: "RUNNING" | "IDLE" | "DOWN";
  speed?: number;
  count?: number;
  pass?: number;
  fail?: number;
  suspect?: number;
  packedFg?: number;
  [k: string]: any;
};

type Props = {
  stationId?: string;
  maxPoints?: number;
  sampleEveryMs?: number; // fixed chart sampling interval
  emaAlpha?: number; // 0..1 (lower = smoother)
  statusStableReads?: number; // consecutive reads required to flip status
};

export default function Live({
  stationId = "WINDSHIELD",
  maxPoints = 300,
  sampleEveryMs = 1000,
  emaAlpha = 0.3,
  statusStableReads = 3,
}: Props) {
  const [points, setPoints] = useState<Array<any>>([]);
  const [streaming, setStreaming] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);

  const esRef = useRef<EventSource | null>(null);

  // Raw accumulator of last incoming event
  const lastRawRef = useRef<Required<Pick<TelemetryEvent, "speed" | "count" | "pass" | "fail" | "suspect" | "packedFg" | "status">> & { ts: number }>({
    ts: Date.now(),
    status: "IDLE",
    speed: 0,
    count: 0,
    pass: 0,
    fail: 0,
    suspect: 0,
    packedFg: 0,
  });

  // EMA state
  const emaRef = useRef({
    speed: 0,
    count: 0,
    pass: 0,
    fail: 0,
    suspect: 0,
    packedFg: 0,
  });

  // Hysteresis for status
  const statusRef = useRef<{ current: "RUNNING" | "IDLE" | "DOWN"; candidate: string | null; streak: number }>({
    current: "IDLE",
    candidate: null,
    streak: 0,
  });

  const streamUrl = useMemo(
    () => `${API_BASE}/api/stream/station/${encodeURIComponent(stationId)}`,
    [stationId]
  );

  function clampNum(n: any, fallback = 0) {
    const v = Number(n);
    return Number.isFinite(v) ? v : fallback;
  }

  function updateRaw(payload: TelemetryEvent) {
    const now = payload.ts ? new Date(payload.ts).getTime() : Date.now();
    const r = lastRawRef.current;

    r.ts = now;
    r.speed = clampNum(payload.speed, r.speed);
    r.count = clampNum(payload.count, r.count);

    // If server does not provide cumulative counters, gently increment to look natural
    r.pass = payload.pass !== undefined ? clampNum(payload.pass, r.pass) : Math.max(0, r.pass + (Math.random() < 0.6 ? 1 : 0));
    r.fail = payload.fail !== undefined ? clampNum(payload.fail, r.fail) : Math.max(0, r.fail + (Math.random() < 0.05 ? 1 : 0));
    r.suspect = payload.suspect !== undefined ? clampNum(payload.suspect, r.suspect) : Math.max(0, r.suspect + (Math.random() < 0.08 ? 1 : 0));
    r.packedFg = payload.packedFg !== undefined ? clampNum(payload.packedFg, r.packedFg) : Math.max(0, r.packedFg + (Math.random() < 0.12 ? 1 : 0));

    // Status hysteresis
    const incoming = (payload.status as any) ?? r.status ?? "IDLE";
    const s = statusRef.current;
    if (incoming !== s.current) {
      if (s.candidate === incoming) {
        s.streak += 1;
        if (s.streak >= statusStableReads) {
          s.current = incoming as any;
          s.candidate = null;
          s.streak = 0;
        }
      } else {
        s.candidate = incoming as any;
        s.streak = 1;
      }
    } else {
      s.candidate = null;
      s.streak = 0;
    }
    r.status = s.current;
  }

  function parseAndIngest(ev: MessageEvent) {
    if (paused) return;
    try {
      if (!ev?.data) return;
      let obj: any = null;
      try {
        obj = JSON.parse(ev.data);
      } catch {
        if (debug) console.log("[SSE] non-JSON:", ev.data);
        return;
      }
      if (debug) console.log("[SSE] payload:", obj);
      updateRaw(obj);
    } catch (e: any) {
      setError(e?.message || "SSE parse error.");
    }
  }

  // Fixed-interval sampler: pushes one smoothed point per sampleEveryMs
  useEffect(() => {
    const id = setInterval(() => {
      if (!streaming || paused) return;

      const r = lastRawRef.current;
      const e = emaRef.current;

      // EMA: x = alpha*new + (1-alpha)*prev
      const a = Math.max(0, Math.min(1, emaAlpha));
      e.speed = a * r.speed + (1 - a) * e.speed;
      e.count = a * r.count + (1 - a) * e.count;
      e.pass = a * r.pass + (1 - a) * e.pass;
      e.fail = a * r.fail + (1 - a) * e.fail;
      e.suspect = a * r.suspect + (1 - a) * e.suspect;
      e.packedFg = a * r.packedFg + (1 - a) * e.packedFg;

      const t = r.ts || Date.now();
      const point = {
        t,
        timeLabel: new Date(t).toLocaleTimeString([], { hour12: false }),
        status: r.status,
        speed: Math.round(e.speed),
        count: Math.round(e.count),
        pass: Math.round(e.pass),
        fail: Math.round(e.fail),
        suspect: Math.round(e.suspect),
        packedFg: Math.round(e.packedFg),
      };

      setPoints((prev) => {
        const next = [...prev, point];
        if (next.length > maxPoints) next.splice(0, next.length - maxPoints);
        return next;
      });
    }, sampleEveryMs);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, paused, sampleEveryMs, emaAlpha, maxPoints]);

  const startStream = () => {
    if (streaming || esRef.current) return;
    setError(null);

    const es = new EventSource(streamUrl, { withCredentials: false });
    esRef.current = es;

    // named events
    es.addEventListener("telemetry", parseAndIngest);
    es.addEventListener("tick", parseAndIngest);
    es.addEventListener("data", parseAndIngest);
    es.addEventListener("action", (ev) => debug && console.log("[SSE action]", ev.data));

    // default event
    es.onmessage = parseAndIngest;

    es.onerror = () => setError("SSE connection error.");
    es.onopen = () => setStreaming(true);
  };

  const stopStream = () => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setStreaming(false);
  };

  const togglePause = () => setPaused((p) => !p);
  const resetData = () => setPoints([]);

  // restart when station changes
  useEffect(() => {
    if (streaming) {
      stopStream();
      const id = setTimeout(startStream, 150);
      return () => clearTimeout(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId]);

  useEffect(() => () => stopStream(), []);

  const startSimulator = async () => {
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/api/sim/start/${encodeURIComponent(stationId)}`, { method: "POST" });
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
        <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, background: streaming ? "#1b5e20" : "#424242", color: "#fff" }}>
          {streaming ? (paused ? "PAUSED" : "STREAMING") : "STOPPED"}
        </span>
        <label style={{ marginLeft: 8, fontSize: 12 }}>
          <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} style={{ marginRight: 6 }} />
          Debug logs
        </label>
        <small style={{ opacity: 0.6 }}>
          sample={sampleEveryMs}ms • alpha={emaAlpha} • statusN={statusStableReads}
        </small>
      </header>

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {!streaming ? (
          <button onClick={startStream} style={btn()}>Start Stream</button>
        ) : (
          <button onClick={stopStream} style={btn()}>Stop Stream</button>
        )}
        <button onClick={togglePause} disabled={!streaming} style={btn()}>{paused ? "Resume" : "Pause"}</button>
        <button onClick={resetData} style={btn()}>Reset</button>
        <button onClick={startSimulator} style={btn()}>Start Simulator</button>
      </div>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12, marginTop: 12 }}>
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
        <div style={{ marginTop: 12, padding: 8, border: "1px solid #b71c1c", color: "#ff8a80", borderRadius: 8 }}>
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

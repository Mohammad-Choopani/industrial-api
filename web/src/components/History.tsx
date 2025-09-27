import React, { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

type HistoryPoint = {
  ts: string;        // bucket timestamp ISO
  pass?: number;
  fail?: number;
  suspect?: number;
  packedFg?: number;
  speed?: number;
  count?: number;
  [k: string]: any;
};

type ApiResp = {
  stationId: string;
  from: string;
  to: string;
  bucket: number;
  points: HistoryPoint[];
};

type Props = {
  stationId: string;
  defaultMinutes?: number;
  defaultBucketSec?: number;
};

export default function History({
  stationId,
  defaultMinutes = 10,
  defaultBucketSec = 60,
}: Props) {
  const [minutes, setMinutes] = useState(defaultMinutes);
  const [bucket, setBucket] = useState(defaultBucketSec);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [points, setPoints] = useState<HistoryPoint[]>([]);

  const url = useMemo(() => {
    const p = new URL(`${API_BASE}/api/telemetry/${encodeURIComponent(stationId)}`);
    p.searchParams.set("minutes", String(minutes));
    p.searchParams.set("bucket", String(bucket));
    return p.toString();
  }, [stationId, minutes, bucket]);

  async function fetchHistory() {
    setErr(null); setLoading(true);
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as ApiResp;
      setPoints(j.points ?? []);
    } catch (e: any) {
      setErr(e?.message ?? "fetch error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchHistory(); }, [url]);

  const data = points.map(p => ({
    ...p,
    timeLabel: new Date(p.ts).toLocaleTimeString([], { hour12: false }),
  }));

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ margin: 0 }}>History — Station: <span style={{ opacity: 0.8 }}>{stationId}</span></h2>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12 }}>
          Minutes:&nbsp;
          <input type="number" min={1} max={1440} value={minutes}
            onChange={e => setMinutes(Math.max(1, Math.min(1440, Number(e.target.value))))}
            style={input()} />
        </label>
        <label style={{ fontSize: 12 }}>
          Bucket (sec):&nbsp;
          <input type="number" min={1} max={3600} value={bucket}
            onChange={e => setBucket(Math.max(1, Math.min(3600, Number(e.target.value))))}
            style={input()} />
        </label>
        <button onClick={fetchHistory} disabled={loading} style={btn()}>
          {loading ? "Loading..." : "Refresh"}
        </button>
        <span style={{ fontSize: 12, opacity: 0.7 }}>API: {url}</span>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="timeLabel" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="pass" name="Pass" dot={false} />
              <Line type="monotone" dataKey="fail" name="Fail" dot={false} />
              <Line type="monotone" dataKey="suspect" name="Suspect" dot={false} />
              <Line type="monotone" dataKey="packedFg" name="Packed FG" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {err && (
        <div style={{ marginTop: 12, padding: 8, border: "1px solid #b71c1c", color: "#ff8a80", borderRadius: 8 }}>
          {err}
        </div>
      )}
      {!err && !loading && data.length === 0 && (
        <div style={{ marginTop: 12, opacity: 0.7 }}>No data.</div>
      )}
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

function input(): React.CSSProperties {
  return {
    padding: "4px 8px",
    borderRadius: 8,
    border: "1px solid #37474f",
    background: "#111827",
    color: "#e5e7eb",
    width: 90,
  };
}

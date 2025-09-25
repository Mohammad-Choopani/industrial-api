// web/src/components/Stations.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

type Station = {
  id: string;
  name?: string;
  line?: string;
  [k: string]: any;
};

type Props = {
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export default function Stations({ selectedId, onSelect }: Props) {
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // search
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 200);
    return () => clearTimeout(id);
  }, [q]);

  // device count cache: stationId -> number
  const [counts, setCounts] = useState<Record<string, number>>({});
  const inflight = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`${API_BASE}/api/stations`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data: Station[] = await r.json();
        if (!alive) return;
        setStations(data);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Failed to load stations.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // fetch device count (lazy, cached)
  const ensureCount = async (stationId: string) => {
    if (counts[stationId] !== undefined) return; // already cached
    if (inflight.current.has(stationId)) return; // avoid duplicate
    inflight.current.add(stationId);
    try {
      const r = await fetch(
        `${API_BASE}/api/devices?station_id=${encodeURIComponent(stationId)}`
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const arr: any[] = await r.json();
      setCounts((c) => ({ ...c, [stationId]: Array.isArray(arr) ? arr.length : 0 }));
    } catch {
      setCounts((c) => ({ ...c, [stationId]: 0 }));
    } finally {
      inflight.current.delete(stationId);
    }
  };

  // normalized filter
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "").replace(/-/g, "");
  const filtered = useMemo(() => {
    if (!debouncedQ) return stations;
    const nq = norm(debouncedQ);
    return stations.filter((s) => {
      const a = `${s.name ?? ""} ${s.id ?? ""} ${s.line ?? ""}`;
      return norm(a).includes(nq);
    });
  }, [stations, debouncedQ]);

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search stations…"
          style={inputStyle()}
        />
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          {loading ? "Loading…" : `${filtered.length} / ${stations.length}`}
        </span>
      </div>

      {error && (
        <div style={{ marginBottom: 8, padding: 8, border: "1px solid #b71c1c", color: "#ff8a80", borderRadius: 8 }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {filtered.map((s) => (
          <StationCard
            key={s.id}
            st={s}
            selected={selectedId === s.id}
            count={counts[s.id]}
            onVisible={() => ensureCount(s.id)}
            onSelect={() => onSelect(s.id)}
          />
        ))}
      </div>
    </div>
  );
}

function StationCard({
  st,
  selected,
  count,
  onVisible,
  onSelect,
}: {
  st: Station;
  selected: boolean;
  count: number | undefined;
  onVisible: () => void;
  onSelect: () => void;
}) {
  // Fetch count when component appears (simple “visibility” hint)
  useEffect(() => {
    onVisible();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={cardStyle(selected)}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 800, marginBottom: 2 }}>
            {st.name || st.id}
          </div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            {st.id}
            {st.line ? ` • ${st.line}` : ""}
          </div>
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
            Devices: {count === undefined ? "…" : count}
          </div>
        </div>

        <div>
          {selected ? (
            <span style={badgeSelected()}>Selected</span>
          ) : (
            <button onClick={onSelect} style={btn()}>
              Select
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    flex: 1,
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #37474f",
    background: "#111827",
    color: "#e5e7eb",
    outline: "none",
  };
}

function cardStyle(selected: boolean): React.CSSProperties {
  return {
    padding: 12,
    borderRadius: 12,
    background: selected ? "#17212b" : "#111827",
    border: `1px solid ${selected ? "#2d3a46" : "#1f2a34"}`,
    color: "#e5e7eb",
  };
}

function btn(): React.CSSProperties {
  return {
    padding: "6px 10px",
    borderRadius: 10,
    background: "#263238",
    color: "#fff",
    border: "1px solid #37474f",
    cursor: "pointer",
  };
}

function badgeSelected(): React.CSSProperties {
  return {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: 999,
    background: "#1b5e20",
    color: "#fff",
    fontSize: 12,
  };
}

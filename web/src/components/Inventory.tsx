import React, { useEffect, useMemo, useState } from "react";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

type InventoryItem = {
  type: string | null;
  count: number;
};

export default function Inventory() {
  const [items, setItems] = useState<InventoryItem[]>([]); // always an array
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`${API}/api/inventory`, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        // Normalize any possible shape into an array of {type, count}
        const raw: unknown =
          Array.isArray(json) ? json :
          (json && typeof json === "object" && Array.isArray((json as any).data)) ? (json as any).data :
          [];

        const normalized: InventoryItem[] = (raw as any[]).map((x) => ({
          type: typeof x?.type === "string" ? x.type : (x?.type ?? null),
          count: Number.isFinite(+x?.count) ? +x.count : 0,
        }));

        // sort descending by count
        normalized.sort((a, b) => b.count - a.count);

        if (alive) setItems(normalized);
      } catch (e: any) {
        console.error("[Inventory] fetch error", e);
        if (alive) setError(e?.message ?? "fetch failed");
        if (alive) setItems([]); // keep array to avoid map crash
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo<InventoryItem[]>(() => {
    const q = query.trim().toLowerCase();
    const base = Array.isArray(items) ? items : [];
    if (!q) return base;
    return base.filter((it) => (it.type ?? "unknown").toLowerCase().includes(q));
  }, [items, query]);

  return (
    <div style={{ padding: 16, color: "#eaeaea" }}>
      <h2 style={{ marginBottom: 8 }}>Inventory</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by device type…"
          style={{ padding: 8, borderRadius: 8, background: "#151820", color: "#eaeaea", border: "1px solid #222" }}
        />
        {loading && <span>Loading…</span>}
        {error && <span style={{ color: "#f66" }}>Error: {error}</span>}
      </div>

      {(!filtered || filtered.length === 0) && !loading ? (
        <div style={{ padding: 16, background: "#0f1218", border: "1px solid #222", borderRadius: 12 }}>
          No items.
        </div>
      ) : (
        <div style={{ overflowX: "auto", background: "#0f1218", border: "1px solid #222", borderRadius: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Type</th>
                <th style={th}>Count</th>
              </tr>
            </thead>
            <tbody>
              {(filtered ?? []).map((it, idx) => (
                <tr key={`${it.type ?? "unknown"}-${idx}`}>
                  <td style={td}>{it.type ?? "unknown"}</td>
                  <td style={td}>{it.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid #222",
  position: "sticky",
  top: 0,
  background: "#12161f",
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #222",
};

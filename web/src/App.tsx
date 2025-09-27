// web/src/App.tsx
import { useState } from "react";
import { Stations, Inventory, Live } from "./components";
import History from "./components/History";

export default function App() {
  const [stationId, setStationId] = useState<string | null>(null);

  return (
    <div className="app">
      <header className="app__header">
        <h1>Industrial Dashboard (MVP)</h1>
        <p>
          Backend API:{" "}
          <code>{import.meta.env.VITE_API_BASE || "http://localhost:4000"}</code>
        </p>
        {stationId && (
          <p style={{ marginTop: 4 }}>
            Selected station: <strong>{stationId}</strong>
          </p>
        )}
      </header>

      <main className="app__main">
        <section className="panel">
          <h2>Stations</h2>
          <Stations
            onSelect={(id: string) => setStationId(id)}
            selectedId={stationId}
          />
        </section>

        <section className="panel">
          <h2>Inventory</h2>
          <Inventory />
        </section>

        <section className="panel">
          <h2>Live</h2>
          {stationId ? <Live stationId={stationId} /> : <p>Select a station…</p>}
        </section>

        <section className="panel">
          <h2>History</h2>
          {stationId ? (
            <History
              stationId={stationId}
              defaultMinutes={10}
              defaultBucketSec={60}
            />
          ) : (
            <p>Select a station…</p>
          )}
        </section>
      </main>
    </div>
  );
}

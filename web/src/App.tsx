import { useState } from "react";
import { Stations, Inventory, Live } from "./components";

export default function App() {
  const [stationId, setStationId] = useState<string | null>(null);

  return (
    <div className="app">
      <header className="app__header">
        <h1>Industrial Dashboard (MVP)</h1>
        <p>Backend API: <code>http://localhost:4000</code></p>
      </header>

      <main className="app__main">
        <section className="panel">
          <h2>Stations</h2>
          <Stations onSelect={(id: string) => setStationId(id)} selectedId={stationId} />
        </section>

        <section className="panel">
          <h2>Inventory</h2>
          <Inventory />
        </section>

        <section className="panel">
          <h2>Live</h2>
          {stationId ? <Live stationId={stationId} /> : <p>Select a station…</p>}
        </section>
      </main>
    </div>
  );
}

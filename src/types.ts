export type Station = {
  id: string;
  name: string;
  line: string;
  pod: string | null;
  area: string | null;
  hmi_brand: string | null;
  builder: string | null;
  screen_url: string | null;
};

export type Device = {
  id: string;
  station_id: string;
  name: string;
  type: string;
  vendor: string | null;
  model: string | null;
  tags: string[];
};

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

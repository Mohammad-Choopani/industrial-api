import fs from "fs";
import path from "path";
import { Station, Device } from "../types";

const root = process.cwd();

function readJsonFile<T>(relPath: string): T {
  const p = path.join(root, relPath);
  let data = fs.readFileSync(p, "utf8");
  // strip BOM if present
  if (data.charCodeAt(0) === 0xFEFF) data = data.slice(1);
  data = data.trim();
  try {
    return JSON.parse(data) as T;
  } catch (err) {
    console.error(`Failed to parse JSON: ${p}`);
    throw err;
  }
}

export function loadStations(): Station[] {
  return readJsonFile<Station[]>("seed/stations.json");
}

export function loadDevices(): Device[] {
  return readJsonFile<Device[]>("seed/devices.json");
}

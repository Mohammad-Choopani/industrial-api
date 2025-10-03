import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// File path setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read JSON files
function readJsonFile<T>(filename: string): T {
  const filePath = path.join(__dirname, '..', 'seed', filename);
  const data = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(data);
}

// Initialize Express
const app = express();
const port = process.env.PORT || 4000;
const httpServer = createServer(app);

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true
}));
app.use(express.json());

// Endpoints
app.get('/api/stations', (_req, res) => {
// Live telemetry for a single station
app.get('/api/live/:stationId', (req, res) => {
  try {
    const stationId = req.params.stationId;
    const devices = readJsonFile<any[]>('devices.json');
    const stationDevices = devices.filter((d: any) => d.station_id === stationId);
    const telemetry = stationDevices.map((device: any) => ({
      device_id: device.id,
      time: new Date().toISOString(),
      temperature: Math.random() * 50 + 20,
      pressure: Math.random() * 100 + 900,
      speed: Math.random() * 1000,
      power: Math.random() * 10 + 90
    }));
    res.json(telemetry);
  } catch (err) {
    console.error('[live] Error:', err);
    res.status(500).json({ error: 'Failed to fetch live telemetry' });
  }
});

// Simulated stream for a single station (Server-Sent Events)
app.get('/api/stream/station/:stationId', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const stationId = req.params.stationId;
  const sendTelemetry = () => {
    const devices = readJsonFile<any[]>('devices.json');
    const stationDevices = devices.filter((d: any) => d.station_id === stationId);
    const telemetry = stationDevices.map((device: any) => ({
      device_id: device.id,
      time: new Date().toISOString(),
      temperature: Math.random() * 50 + 20,
      pressure: Math.random() * 100 + 900,
      speed: Math.random() * 1000,
      power: Math.random() * 10 + 90
    }));
    res.write(`data: ${JSON.stringify(telemetry)}\n\n`);
  };

  const interval = setInterval(sendTelemetry, 2000);
  sendTelemetry();

  req.on('close', () => {
    clearInterval(interval);
    res.end();
  });
});
  try {
    const stations = readJsonFile('stations.json');
    console.log('[stations] Returning stations from JSON');
    res.json(stations);
  } catch (err) {
    console.error('[stations] Error reading stations.json:', err);
    res.status(500).json({ error: 'Failed to fetch stations' });
  }
});

app.get('/api/devices', (req, res) => {
  try {
    const devices = readJsonFile<any[]>('devices.json');
    const stationId = typeof req.query.station_id === 'string' ? req.query.station_id : undefined;
    const filteredDevices = stationId ? devices.filter((d: any) => d.station_id === stationId) : devices;

    console.log(`[devices] Returning ${filteredDevices.length} devices${stationId ? ` for station ${stationId}` : ''} from JSON`);
    res.json(filteredDevices);
  } catch (err) {
    console.error('[devices] Error reading devices.json:', err);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

app.get('/api/telemetry', (req, res) => {
  try {
    const devices = readJsonFile<any[]>('devices.json');
    const deviceId = typeof req.query.device_id === 'string' ? req.query.device_id : undefined;
    
    // Generate telemetry for each device
    const telemetry = devices.map((device: any) => ({
      device_id: device.id,
      time: new Date().toISOString(),
      temperature: Math.random() * 50 + 20,  // 20-70°C
      pressure: Math.random() * 100 + 900,   // 900-1000 kPa
      speed: Math.random() * 1000,           // 0-1000 RPM
      power: Math.random() * 10 + 90         // 90-100%
    }));

    if (deviceId) {
      const filtered = telemetry.filter(t => t.device_id === deviceId);
      res.json(filtered);
    } else {
      res.json(telemetry);
    }
  } catch (err) {
    console.error('[telemetry] Error:', err);
    res.status(500).json({ error: 'Failed to fetch telemetry' });
  }
});

app.get('/api/inventory', (_req, res) => {
  try {
    const devices = readJsonFile('devices.json');
    
    // Group devices by type
    const typeMap = (devices as any[]).reduce((acc, device) => {
      if (!acc[device.type]) {
        acc[device.type] = {
          type: device.type,
          count: 0,
          lastUpdate: new Date().toISOString()
        };
      }
      acc[device.type].count++;
      return acc;
    }, {} as Record<string, { type: string; count: number; lastUpdate: string }>);

    const typeStats = Object.values(typeMap);
    console.log(`[inventory] Returning stats for ${typeStats.length} device types`);
    res.json(typeStats);
  } catch (err) {
    console.error('[inventory] error:', err);
    res.status(500).json({ error: 'Failed to fetch inventory data' });
  }
});

// Start server
httpServer.listen(port, () => {
  console.log(`Server running on port ${port}`);
});


-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "public"."Device" (
    "id" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "name" TEXT,
    "type" TEXT NOT NULL,
    "vendor" TEXT,
    "model" TEXT,
    "tags" TEXT[],
    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Station" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "line" TEXT NOT NULL,
    "pod" TEXT,
    "area" TEXT,
    "hmi_brand" TEXT,
    "builder" TEXT,
    "screen_url" TEXT,
    CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Telemetry" (
    "id" BIGSERIAL NOT NULL,
    "time" TIMESTAMPTZ(6) NOT NULL,
    "stationId" TEXT NOT NULL,
    "deviceId" TEXT,
    "k" TEXT NOT NULL,
    "v" DOUBLE PRECISION,
    CONSTRAINT "Telemetry_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "Device_station_id_idx" ON "public"."Device"("station_id" ASC);
CREATE INDEX "Device_type_idx"       ON "public"."Device"("type" ASC);
CREATE INDEX "Telemetry_deviceId_time_idx"   ON "public"."Telemetry"("deviceId" ASC, "time" DESC);
CREATE INDEX "Telemetry_device_time_idx"     ON "public"."Telemetry"("deviceId" ASC, "time" DESC);
CREATE INDEX "Telemetry_stationId_time_idx"  ON "public"."Telemetry"("stationId" ASC, "time" DESC);
CREATE INDEX "Telemetry_station_time_idx"    ON "public"."Telemetry"("stationId" ASC, "time" DESC);

-- FKs
ALTER TABLE "public"."Device"
  ADD CONSTRAINT "Device_station_id_fkey"
  FOREIGN KEY ("station_id") REFERENCES "public"."Station"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."Telemetry"
  ADD CONSTRAINT "Telemetry_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "public"."Device"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."Telemetry"
  ADD CONSTRAINT "Telemetry_stationId_fkey"
  FOREIGN KEY ("stationId") REFERENCES "public"."Station"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;


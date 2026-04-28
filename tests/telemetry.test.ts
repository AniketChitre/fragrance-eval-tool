import { describe, expect, it } from "vitest";
import {
  extractBoothMetrics,
  findNearestTelemetryRow,
  rewriteTelemetryTimestamps
} from "../src/lib/telemetry";

const sampleRows = [
  {
    timestamp: "24-Apr-25 2:35:00 PM BST",
    "Air Flow Booth 1": "Off",
    "Humidity Sensor Booth 1 %RH": "49.22",
    "Temperature Sensor Booth 1 DegC": "20.93",
    "Water Flow Rate Booth 1 l/m": "0.00",
    "Water Source Booth 1": "Tap",
    "Water Temp Booth 1 DegC": "37.66",
    // Booth 2 has the inconsistent double-space we want to handle
    "Air Flow Booth 2": "Off",
    "Humidity Sensor Booth 2 %RH": "48.29",
    "Temperature Sensor Booth 2  DegC": "21.34",
    "Water Flow Rate Booth 2 l/m": "0.00",
    "Water Source Booth 2": "Tap",
    "Water Temp Booth 2  DegC": "36.88"
  },
  {
    timestamp: "24-Apr-25 2:36:00 PM BST",
    "Air Flow Booth 1": "Off",
    "Humidity Sensor Booth 1 %RH": "48.46",
    "Temperature Sensor Booth 1 DegC": "20.92",
    "Water Flow Rate Booth 1 l/m": "6.00",
    "Water Source Booth 1": "Tap",
    "Water Temp Booth 1 DegC": "39.57",
    "Air Flow Booth 2": "Off",
    "Humidity Sensor Booth 2 %RH": "49.11",
    "Temperature Sensor Booth 2  DegC": "21.33",
    "Water Flow Rate Booth 2 l/m": "6.00",
    "Water Source Booth 2": "Tap",
    "Water Temp Booth 2  DegC": "38.26"
  }
];

describe("rewriteTelemetryTimestamps", () => {
  it("assigns sequential effective timestamps from anchor", () => {
    const anchor = new Date("2026-01-01T10:00:00.000Z").toISOString();
    const out = rewriteTelemetryTimestamps(sampleRows, {
      anchorIso: anchor,
      intervalMs: 60_000
    });
    expect(out).toHaveLength(2);
    expect(out[0].effective_timestamp_iso).toBe("2026-01-01T10:00:00.000Z");
    expect(out[1].effective_timestamp_iso).toBe("2026-01-01T10:01:00.000Z");
  });
  it("preserves the original telemetry timestamp string", () => {
    const out = rewriteTelemetryTimestamps(sampleRows);
    expect(out[0].original_timestamp).toBe("24-Apr-25 2:35:00 PM BST");
  });
  it("normalises header whitespace in stored values map", () => {
    const out = rewriteTelemetryTimestamps(sampleRows);
    // Original header has double-space; normalised key collapses to single space
    expect(out[0].values["Temperature Sensor Booth 2 DegC"]).toBe("21.34");
  });
});

describe("findNearestTelemetryRow", () => {
  it("returns the row closest to the evaluation timestamp", () => {
    const anchor = new Date("2026-01-01T10:00:00.000Z").toISOString();
    const out = rewriteTelemetryTimestamps(sampleRows, {
      anchorIso: anchor,
      intervalMs: 60_000
    });
    const nearest = findNearestTelemetryRow(out, "2026-01-01T10:00:50.000Z");
    expect(nearest?.effective_timestamp_iso).toBe("2026-01-01T10:01:00.000Z");
    const nearest2 = findNearestTelemetryRow(out, "2026-01-01T10:00:10.000Z");
    expect(nearest2?.effective_timestamp_iso).toBe("2026-01-01T10:00:00.000Z");
  });
  it("returns null on empty list", () => {
    expect(findNearestTelemetryRow([], new Date().toISOString())).toBeNull();
  });
});

describe("extractBoothMetrics", () => {
  const rewritten = rewriteTelemetryTimestamps(sampleRows, {
    anchorIso: new Date("2026-01-01T10:00:00.000Z").toISOString()
  });

  it("extracts booth 1 metrics", () => {
    const m = extractBoothMetrics(rewritten[0], 1);
    expect(m.booth_temperature_c).toBeCloseTo(20.93);
    expect(m.booth_humidity_rh).toBeCloseTo(49.22);
    expect(m.booth_water_temp_c).toBeCloseTo(37.66);
    expect(m.booth_water_flow_lpm).toBeCloseTo(0.0);
    expect(m.booth_water_source).toBe("Tap");
    expect(m.booth_air_flow).toBe("Off");
  });
  it("extracts booth 2 metrics despite double-space headers", () => {
    const m = extractBoothMetrics(rewritten[0], 2);
    expect(m.booth_temperature_c).toBeCloseTo(21.34);
    expect(m.booth_water_temp_c).toBeCloseTo(36.88);
  });
  it("returns nulls when row is null", () => {
    const m = extractBoothMetrics(null, 1);
    expect(m.booth_temperature_c).toBeNull();
    expect(m.booth_water_source).toBeNull();
  });
});

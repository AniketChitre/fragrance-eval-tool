import { normaliseHeader, parseTelemetryTimestamp } from "./parsing";
import type { BoothMetrics, RawTelemetryRow, TelemetryRow } from "./types";

export interface RewriteOptions {
  anchorIso?: string;
  intervalMs?: number;
}

export function parseTelemetryRows(rows: RawTelemetryRow[]): TelemetryRow[] {
  return rows.map((raw) => {
    const tsRaw = ((raw["timestamp"] ?? raw["﻿timestamp"]) as string | undefined) ?? "";
    const parsed = parseTelemetryTimestamp(tsRaw);
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      values[normaliseHeader(k)] = (v ?? "").toString().trim();
    }
    return {
      original_timestamp: tsRaw,
      effective_timestamp_iso: parsed ? parsed.toISOString() : new Date().toISOString(),
      values
    };
  });
}

export function rewriteTelemetryTimestamps(
  rows: RawTelemetryRow[],
  options: RewriteOptions = {}
): TelemetryRow[] {
  const interval = options.intervalMs ?? 60_000;
  const anchor = options.anchorIso
    ? new Date(options.anchorIso).getTime()
    : Date.now() - interval * Math.max(1, rows.length);
  return rows.map((raw, idx) => {
    const original =
      (raw["timestamp"] as string | undefined) ??
      (raw["Timestamp"] as string | undefined) ??
      "";
    const effective = new Date(anchor + idx * interval).toISOString();
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      values[normaliseHeader(k)] = (v ?? "").toString().trim();
    }
    return {
      original_timestamp: original,
      effective_timestamp_iso: effective,
      values
    };
  });
}

export function findNearestTelemetryRow(
  rows: TelemetryRow[],
  evaluationIso: string
): TelemetryRow | null {
  if (rows.length === 0) return null;
  const target = new Date(evaluationIso).getTime();
  if (isNaN(target)) return rows[0];
  let best = rows[0];
  let bestDelta = Math.abs(new Date(best.effective_timestamp_iso).getTime() - target);
  for (let i = 1; i < rows.length; i++) {
    const t = new Date(rows[i].effective_timestamp_iso).getTime();
    const d = Math.abs(t - target);
    if (d < bestDelta) {
      bestDelta = d;
      best = rows[i];
    }
  }
  return best;
}

function num(v: string | undefined): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function str(v: string | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

// Booth headers may have inconsistent whitespace; build candidate keys after
// normalising to single spaces and look them up tolerantly.
export function extractBoothMetrics(
  row: TelemetryRow | null,
  booth: number
): BoothMetrics {
  const empty: BoothMetrics = {
    booth_temperature_c: null,
    booth_humidity_rh: null,
    booth_water_temp_c: null,
    booth_water_flow_lpm: null,
    booth_water_source: null,
    booth_air_flow: null
  };
  if (!row) return empty;
  const v = row.values;
  const lookup = (...candidates: string[]): string | undefined => {
    for (const c of candidates) {
      const norm = c.replace(/\s+/g, " ").trim();
      if (v[norm] !== undefined) return v[norm];
    }
    return undefined;
  };
  return {
    booth_temperature_c: num(lookup(`Temperature Sensor Booth ${booth} DegC`)),
    booth_humidity_rh: num(lookup(`Humidity Sensor Booth ${booth} %RH`)),
    booth_water_temp_c: num(lookup(`Water Temp Booth ${booth} DegC`)),
    booth_water_flow_lpm: num(lookup(`Water Flow Rate Booth ${booth} l/m`)),
    booth_water_source: str(lookup(`Water Source Booth ${booth}`)),
    booth_air_flow: str(lookup(`Air Flow Booth ${booth}`))
  };
}

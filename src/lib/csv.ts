import Papa from "papaparse";
import type { ApplicationCodeRow, EvaluationRecord, RawTelemetryRow } from "./types";

function stripBom(h: string): string {
  return h.replace(/^﻿/, "").trim();
}

export async function loadApplicationCodes(url: string): Promise<ApplicationCodeRow[]> {
  const text = await (await fetch(url)).text();
  const parsed = Papa.parse<ApplicationCodeRow>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: stripBom
  });
  return (parsed.data ?? []).filter(
    (r) => r && (r["Masked Code"] ?? "").trim().length > 0
  );
}

export async function loadTelemetry(url: string): Promise<RawTelemetryRow[]> {
  const text = await (await fetch(url)).text();
  const parsed = Papa.parse<RawTelemetryRow>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: stripBom
  });
  return (parsed.data ?? []).filter((r) => r && Object.keys(r).length > 0);
}

const RECORD_COLUMNS: (keyof EvaluationRecord)[] = [
  "evaluation_timestamp_iso",
  "booth_number",
  "masked_code",
  "project_id",
  "application_id",
  "effective_telemetry_timestamp_iso",
  "booth_temperature_c",
  "booth_humidity_rh",
  "booth_water_temp_c",
  "booth_water_flow_lpm",
  "booth_water_source",
  "booth_air_flow",
  "notes",
  "protocol_summary_snapshot"
];

export function recordsToCsv(records: EvaluationRecord[]): string {
  const data = records.map((r) => {
    const out: Record<string, unknown> = {};
    for (const c of RECORD_COLUMNS) out[c] = r[c] ?? "";
    return out;
  });
  return Papa.unparse({ fields: RECORD_COLUMNS as string[], data });
}

export interface ApplicationCodeRow {
  "Masked Code": string;
  "Project ID": string;
  "Application ID": string;
}

export interface RawTelemetryRow {
  [header: string]: string;
}

export interface TelemetryRow {
  original_timestamp: string;
  effective_timestamp_iso: string;
  values: Record<string, string>;
}

export interface BoothMetrics {
  booth_temperature_c: number | null;
  booth_humidity_rh: number | null;
  booth_water_temp_c: number | null;
  booth_water_flow_lpm: number | null;
  booth_water_source: string | null;
  booth_air_flow: string | null;
}

export interface EvaluationRecord {
  evaluation_timestamp_iso: string;
  booth_number: number;
  masked_code: string;
  project_id: string;
  application_id: string;
  effective_telemetry_timestamp_iso: string | null;
  booth_temperature_c: number | null;
  booth_humidity_rh: number | null;
  booth_water_temp_c: number | null;
  booth_water_flow_lpm: number | null;
  booth_water_source: string | null;
  booth_air_flow: string | null;
  notes: string;
  protocol_summary_snapshot: string;
}

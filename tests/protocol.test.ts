import { describe, expect, it } from "vitest";
import { summariseProtocol } from "../src/lib/protocol";
import { recordsToCsv } from "../src/lib/csv";
import type { EvaluationRecord } from "../src/lib/types";

const sampleProtocol = `Fragrance Bloom Intensity Evaluation Protocol – Shampoo

Date Issued: 5 Dec 2025

Environmental:
- Ambient temperature: 20–25 °C
- Humidity: Not controlled

Water and equipment:
- Water temperature: 35–40 °C
- Flow rate: 4 L/min

Product application:
- Product dose: 10 g shampoo
- Shower running time: 1 minute
- Incubation: 1 minute post-application
- Evaluation distance: ~1630 mm

Scale definition:
- Linear scale: 0–10
Anchoring:
- Reference: Intensity 5
- Low control: 3
- High control: 8
`;

describe("summariseProtocol", () => {
  it("includes the title and conditions block", () => {
    const s = summariseProtocol(sampleProtocol);
    expect(s).toContain("Fragrance Bloom Intensity Evaluation Protocol");
    expect(s).toContain("Ambient temperature: 20–25 °C");
    expect(s).toContain("Flow rate: 4 L/min");
  });
  it("includes scale, reference, and controls", () => {
    const s = summariseProtocol(sampleProtocol);
    expect(s).toContain("Linear scale: 0–10");
    expect(s).toContain("Reference intensity: Intensity 5");
    expect(s).toContain("Low control: 3");
    expect(s).toContain("High control: 8");
  });
  it("returns empty string for empty input", () => {
    expect(summariseProtocol("")).toBe("");
  });
});

describe("recordsToCsv", () => {
  it("produces a header row plus data row in declared column order", () => {
    const r: EvaluationRecord = {
      evaluation_timestamp_iso: "2026-04-28T10:00:00.000Z",
      booth_number: 1,
      masked_code: "ASDF",
      project_id: "P00001",
      application_id: "A00008",
      effective_telemetry_timestamp_iso: "2026-04-28T09:59:30.000Z",
      booth_temperature_c: 20.9,
      booth_humidity_rh: 49.2,
      booth_water_temp_c: 37.7,
      booth_water_flow_lpm: 0,
      booth_water_source: "Tap",
      booth_air_flow: "Off",
      notes: "smells nice",
      protocol_summary_snapshot: "summary text"
    };
    const csv = recordsToCsv([r]);
    const lines = csv.split(/\r?\n/);
    expect(lines[0]).toContain("evaluation_timestamp_iso");
    expect(lines[0]).toContain("application_id");
    expect(lines[1]).toContain("ASDF");
    expect(lines[1]).toContain("P00001");
  });
});

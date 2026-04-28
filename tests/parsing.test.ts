import { describe, expect, it } from "vitest";
import {
  normaliseHeader,
  parseBoothNumber,
  parseMaskedCode,
  parseTelemetryTimestamp,
  resolveMaskedCode
} from "../src/lib/parsing";

describe("parseMaskedCode", () => {
  it("returns 4-letter code from compact input", () => {
    expect(parseMaskedCode("ASDF")).toBe("ASDF");
    expect(parseMaskedCode("asdf")).toBe("ASDF");
  });
  it("handles spaced letters", () => {
    expect(parseMaskedCode("A S D F")).toBe("ASDF");
    expect(parseMaskedCode("a-s-d-f")).toBe("ASDF");
  });
  it("strips noise around code", () => {
    expect(parseMaskedCode("the code is ASDF over.")).toBe("ASDF");
  });
  it("returns null for empty or non-letters", () => {
    expect(parseMaskedCode("")).toBeNull();
    expect(parseMaskedCode("12345")).toBeNull();
  });
  it("falls back to last 4 letters when more than 4 present", () => {
    expect(parseMaskedCode("zzz finalcode is wxyz")).toBe("WXYZ");
  });
});

describe("resolveMaskedCode", () => {
  const rows = [
    { "Masked Code": "ASDF", "Project ID": "P1", "Application ID": "A1" },
    { "Masked Code": "FABC", "Project ID": "P2", "Application ID": "A2" }
  ];
  it("matches exact code", () => {
    expect(resolveMaskedCode("ASDF", rows)?.["Application ID"]).toBe("A1");
  });
  it("returns null when not found", () => {
    expect(resolveMaskedCode("XXXX", rows)).toBeNull();
  });
  it("is case-insensitive on input", () => {
    expect(resolveMaskedCode("asdf", rows)?.["Project ID"]).toBe("P1");
  });
});

describe("parseBoothNumber", () => {
  it("matches digits 1-8", () => {
    for (let n = 1; n <= 8; n++) {
      expect(parseBoothNumber(`booth ${n}`)).toBe(n);
    }
  });
  it("matches words", () => {
    expect(parseBoothNumber("number two please")).toBe(2);
    expect(parseBoothNumber("eight")).toBe(8);
  });
  it("rejects out of range", () => {
    expect(parseBoothNumber("booth 9")).toBeNull();
    expect(parseBoothNumber("0")).toBeNull();
  });
  it("returns null when nothing recognised", () => {
    expect(parseBoothNumber("hello world")).toBeNull();
  });
});

describe("normaliseHeader", () => {
  it("collapses double spaces and trims", () => {
    expect(normaliseHeader("Temperature Sensor Booth 2  DegC")).toBe(
      "Temperature Sensor Booth 2 DegC"
    );
    expect(normaliseHeader("  Water Source Booth 3  ")).toBe("Water Source Booth 3");
  });
});

describe("parseTelemetryTimestamp", () => {
  it("parses canonical telemetry format with trailing TZ", () => {
    const d = parseTelemetryTimestamp("24-Apr-25 2:35:00 PM BST");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2025);
    expect(d!.getMonth()).toBe(3); // April
    expect(d!.getDate()).toBe(24);
    expect(d!.getHours()).toBe(14);
    expect(d!.getMinutes()).toBe(35);
  });
  it("handles AM in 12-hour clock", () => {
    const d = parseTelemetryTimestamp("01-Jan-25 12:00:00 AM GMT");
    expect(d!.getHours()).toBe(0);
  });
  it("returns null for empty", () => {
    expect(parseTelemetryTimestamp("")).toBeNull();
  });
});

import { parseMaskedCode } from "./parsing";

const BOOTH_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4,
  five: 5, six: 6, seven: 7, eight: 8,
};

// ── Segment the transcript into per-booth chunks ────────────────────────────
// Splits on "booth N" / "booth one" etc. keeping everything between each
// booth marker and the next as that booth's raw text.

interface RawMarker { booth: number; matchStart: number; matchEnd: number; }

export interface BoothSegment {
  booth: number;
  rawText: string;
}

export function segmentTranscript(transcript: string): BoothSegment[] {
  const PATTERN = /\bbooth\s+(one|two|three|four|five|six|seven|eight|[1-8])\b/gi;
  const markers: RawMarker[] = [];
  let m: RegExpExecArray | null;
  while ((m = PATTERN.exec(transcript)) !== null) {
    const raw = m[1].toLowerCase();
    const booth = BOOTH_WORDS[raw] ?? parseInt(raw, 10);
    if (booth >= 1 && booth <= 8) {
      markers.push({ booth, matchStart: m.index, matchEnd: m.index + m[0].length });
    }
  }
  if (!markers.length) return [];

  // Slice text for each segment: from end of this marker to start of next
  const rawSegs: BoothSegment[] = markers.map((mk, i) => ({
    booth: mk.booth,
    rawText: transcript
      .slice(mk.matchEnd, i + 1 < markers.length ? markers[i + 1].matchStart : undefined)
      .trim(),
  }));

  // If a booth appears more than once keep the last occurrence (correction case)
  const byBooth = new Map<number, BoothSegment>();
  for (const s of rawSegs) byBooth.set(s.booth, s);

  return [...byBooth.values()].sort((a, b) => a.booth - b.booth);
}

// ── Draft entry: editable before save ───────────────────────────────────────

export interface DraftEntry {
  key: string;           // stable React key
  booth_number: number;
  masked_code: string;
  notes: string;
  evaluation_iso: string;
}

export function buildDrafts(segments: BoothSegment[]): DraftEntry[] {
  const iso = new Date().toISOString();
  return segments.map((seg, i) => {
    const code = parseMaskedCode(seg.rawText) ?? "";
    return {
      key: `booth-${seg.booth}-${i}`,
      booth_number: seg.booth,
      masked_code: code.toUpperCase(),
      notes: stripCode(seg.rawText, code),
      evaluation_iso: iso,
    };
  });
}

export function emptyDraft(booth: number): DraftEntry {
  return {
    key: `manual-${booth}-${Date.now()}`,
    booth_number: booth,
    masked_code: "",
    notes: "",
    evaluation_iso: new Date().toISOString(),
  };
}

// Remove the 4-letter code from the notes text so it isn't duplicated
function stripCode(text: string, code: string): string {
  if (!code || code.length !== 4) return text.replace(/\s{2,}/g, " ").trim();
  // Match compact "FABC" or spaced "F A B C" (with any whitespace between)
  const spaced = code.split("").join("\\s+");
  let out = text
    .replace(new RegExp(`\\b${code}\\b`, "gi"), "")
    .replace(new RegExp(`\\b${spaced}\\b`, "gi"), "");
  return out.replace(/\s{2,}/g, " ").trim();
}

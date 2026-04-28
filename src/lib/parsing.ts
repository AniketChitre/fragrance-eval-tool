import type { ApplicationCodeRow } from "./types";

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8
};

// Common 4-letter English words that appear in evaluator speech and should not
// be mistaken for masked codes. Voice transcripts strip case, so we cannot rely
// on capitalisation to disambiguate.
const STOPWORDS_4 = new Set([
  "THE", "AND", "OVER", "CODE", "ZERO", "ONE", "TWO", "FOUR", "FIVE", "NINE",
  "BOOTH", "NUMB", "NUMBER", "WITH", "FROM", "SAID", "READY", "DONE",
  "TEST", "OKAY", "YEAH", "JUST", "THIS", "THAT", "THEM", "SOME", "MORE"
]);

export function parseMaskedCode(transcript: string): string | null {
  if (!transcript) return null;
  // 1) Preserve original casing first: a token typed/written as ALL CAPS in the
  //    transcript (e.g. manually typed "ASDF") is almost certainly the code.
  const originalCapsMatches = [...transcript.matchAll(/\b[A-Z]{4}\b/g)].map(
    (m) => m[0]
  );
  if (originalCapsMatches.length > 0) {
    return originalCapsMatches[originalCapsMatches.length - 1];
  }

  const letters = transcript.toUpperCase().replace(/[^A-Z]/g, "");
  if (letters.length === 0) return null;
  if (letters.length === 4) return letters;

  // 2) Look at every 4-letter run in the transcript (compact "ASDF" or spaced
  //    "A S D F"). Prefer the LAST non-stopword token — evaluators tend to speak
  //    the code at the end of an utterance.
  const upper = transcript.toUpperCase();
  const tokens = [...upper.matchAll(/\b([A-Z](?:\s*[A-Z]){3})\b/g)]
    .map((m) => m[1].replace(/[^A-Z]/g, ""))
    .filter((t) => t.length === 4);
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (!STOPWORDS_4.has(tokens[i])) return tokens[i];
  }
  if (tokens.length > 0) return tokens[tokens.length - 1];

  // 3) Fallback: the last 4 letters spoken
  return letters.slice(-4);
}

export function resolveMaskedCode(
  code: string | null,
  rows: ApplicationCodeRow[]
): ApplicationCodeRow | null {
  if (!code) return null;
  const target = code.toUpperCase();
  return rows.find((r) => (r["Masked Code"] || "").toUpperCase() === target) ?? null;
}

export function parseBoothNumber(transcript: string): number | null {
  if (!transcript) return null;
  const lower = transcript.toLowerCase();
  // Digit form first
  const digitMatch = lower.match(/\b([1-8])\b/);
  if (digitMatch) {
    const n = Number(digitMatch[1]);
    if (n >= 1 && n <= 8) return n;
  }
  // Word form
  for (const [word, num] of Object.entries(NUMBER_WORDS)) {
    const re = new RegExp(`\\b${word}\\b`);
    if (re.test(lower)) return num;
  }
  return null;
}

export function normaliseHeader(h: string): string {
  return h.replace(/\s+/g, " ").trim();
}

export function parseTelemetryTimestamp(ts: string): Date | null {
  if (!ts) return null;
  // Strip trailing timezone token like "BST", "GMT", "UTC", "PST" etc.
  const cleaned = ts.replace(/\s+[A-Z]{2,5}\s*$/, "").trim();
  // Handle formats like "24-Apr-25 2:35:00 PM" or "24-Apr-2025 14:35:00"
  const match = cleaned.match(
    /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i
  );
  if (!match) {
    const fallback = new Date(cleaned);
    return isNaN(fallback.getTime()) ? null : fallback;
  }
  const [, dStr, monStr, yStr, hStr, minStr, secStr, ampm] = match;
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };
  const month = months[monStr.toLowerCase()];
  if (month === undefined) return null;
  const day = Number(dStr);
  let year = Number(yStr);
  if (year < 100) year += 2000;
  let hours = Number(hStr);
  const minutes = Number(minStr);
  const seconds = secStr ? Number(secStr) : 0;
  if (ampm) {
    const upper = ampm.toUpperCase();
    if (upper === "PM" && hours < 12) hours += 12;
    if (upper === "AM" && hours === 12) hours = 0;
  }
  const d = new Date(year, month, day, hours, minutes, seconds);
  return isNaN(d.getTime()) ? null : d;
}

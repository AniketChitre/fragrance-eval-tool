# Fragrance Evaluation Tool (MVP)

A voice-first, mobile-friendly PWA that lets a fragrance evaluator walk
booth-to-booth, speak a booth number and 4-letter masked code, and log an
evaluation enriched with booth telemetry. Records are stored locally and can be
exported to CSV.

## Quick start

```bash
npm install
npm run dev          # Vite dev server on http://localhost:5173
npm run build        # production build into dist/
npm run preview      # serve the built bundle (e.g. for PWA install testing)
npm test             # run the vitest suite
```

Open the dev server URL on a phone (over the same network or via tunnel) to
install it as a PWA. Voice input uses the Web Speech API, which works in
Chrome / Edge / Safari and falls back to manual input fields where unavailable.

## Data assumptions

The app reads three files from `public/`:

- `public/data/application_codes.csv`
  - Columns (exact, case-sensitive): `Masked Code`, `Project ID`, `Application ID`
- `public/data/booth_conditions.csv`
  - One `timestamp` column. Per-booth columns for booths 1 to 8:
    - `Humidity Sensor Booth X %RH`
    - `Temperature Sensor Booth X DegC`
    - `Water Flow Rate Booth X l/m`
    - `Water Source Booth X`
    - `Water Temp Booth X DegC`
    - `Air Flow Booth X`
  - Some headers contain double spaces (e.g. `Temperature Sensor Booth 2  DegC`);
    the loader normalises whitespace before lookup.
- `public/protocol.txt`
  - Plain-text protocol document; the app generates an editable summary from it.

To swap in a different dataset, replace the files in `public/data/` with the
same column names and reload.

## Voice input

Press the large mic button and say something like:

- "booth two ASDF"
- "number 5 — code is GNUI"
- "A S D F booth 1"

Parsing rules:

- `parseBoothNumber` accepts digits 1-8 and the words one through eight.
- `parseMaskedCode` uppercases the transcript, strips non-letters, and looks for
  a 4-letter token. It prefers all-caps tokens in the original transcript, then
  the last 4-letter run while skipping common English stopwords ("THE", "OVER",
  "BOOTH", etc).

If voice is unsupported, the same fields are available as a select and a text
input.

## Telemetry timestamp alignment

Real evaluations are recorded live, but booth telemetry CSVs are uploaded
*after* the session and their timestamps will not match system time at capture.
The app reconciles this with **Option A** from the spec:

1. On load, every telemetry row is rewritten to a synthetic ISO timestamp.
2. The first row anchors at `now - N minutes` (where `N = row count`) on first
   run, or aligns to the earliest stored evaluation if records already exist.
3. Subsequent rows are spaced at +1 minute intervals from the anchor.
4. The anchor is persisted to `localStorage` so reloads stay deterministic.
5. Each row keeps both the raw `original_timestamp` and the new
   `effective_timestamp_iso`. The UI displays only the effective timestamp
   under the label "Conditions snapshot (aligned)".
6. When an evaluation is saved, the system finds the telemetry row with the
   closest `effective_timestamp_iso` to the evaluation's system timestamp and
   attaches its booth metrics.

To re-anchor (e.g. when uploading a fresh telemetry CSV that should align to
the *current* session), clear the `frag.telemetry.anchor.v1` key in the
browser's localStorage and reload — the new anchor will be set from the first
saved evaluation, or from `now` if none exist.

## Record schema

Each saved evaluation contains:

- `evaluation_timestamp_iso` (system time at save, authoritative)
- `booth_number` (1-8)
- `masked_code`, `project_id`, `application_id`
- `effective_telemetry_timestamp_iso` (aligned, may be null if no telemetry)
- `booth_temperature_c`, `booth_humidity_rh`, `booth_water_temp_c`,
  `booth_water_flow_lpm`, `booth_water_source`, `booth_air_flow`
- `notes`
- `protocol_summary_snapshot` (the summary text in effect at save time)

Records are stored in `localStorage` under `frag.records.v1` and exported as
CSV via "Export CSV".

## Project layout

```
public/
  data/application_codes.csv
  data/booth_conditions.csv
  protocol.txt
  icon.svg
src/
  App.tsx               UI and state
  main.tsx              entrypoint
  styles.css            theme
  lib/
    csv.ts              papaparse loaders + recordsToCsv
    parsing.ts          parseMaskedCode / parseBoothNumber / parseTelemetryTimestamp / normaliseHeader
    protocol.ts         summariseProtocol
    speech.ts           Web Speech API shim
    telemetry.ts        rewriteTelemetryTimestamps / findNearestTelemetryRow / extractBoothMetrics
    types.ts            shared TypeScript types
tests/
  parsing.test.ts
  protocol.test.ts
  telemetry.test.ts
```

## Tech stack

- React 18 + TypeScript (strict)
- Vite 5 + vite-plugin-pwa (autoUpdate)
- papaparse for CSV in/out
- vitest + jsdom for unit tests

## Known limitations (MVP)

- No backend or sync; all state is per-device in `localStorage`.
- No authentication or user identity in records.
- Web Speech API support varies; Firefox does not implement it.
- Telemetry alignment is sequential (Option A); Option B (offset to overlap
  evaluations) is not exposed in the UI.

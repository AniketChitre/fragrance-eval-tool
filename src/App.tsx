import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseBoothNumber,
  parseMaskedCode,
  resolveMaskedCode
} from "./lib/parsing";
import {
  extractBoothMetrics,
  findNearestTelemetryRow,
  rewriteTelemetryTimestamps
} from "./lib/telemetry";
import { summariseProtocol } from "./lib/protocol";
import { loadApplicationCodes, loadTelemetry, recordsToCsv } from "./lib/csv";
import { getSpeechRecognition, type SpeechRecognitionLike } from "./lib/speech";
import type {
  ApplicationCodeRow,
  BoothMetrics,
  EvaluationRecord,
  TelemetryRow
} from "./lib/types";

const RECORDS_KEY = "frag.records.v1";
const SUMMARY_KEY = "frag.protocol.summary.v1";
const TELEMETRY_ANCHOR_KEY = "frag.telemetry.anchor.v1";

function formatNumber(n: number | null, digits = 2): string {
  if (n === null || isNaN(n)) return "—";
  return n.toFixed(digits);
}

function loadRecords(): EvaluationRecord[] {
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    return raw ? (JSON.parse(raw) as EvaluationRecord[]) : [];
  } catch {
    return [];
  }
}

function saveRecords(records: EvaluationRecord[]) {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
}

export default function App() {
  const [codes, setCodes] = useState<ApplicationCodeRow[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetryRow[]>([]);
  const [protocolText, setProtocolText] = useState("");
  const [summary, setSummary] = useState<string>(
    () => localStorage.getItem(SUMMARY_KEY) ?? ""
  );
  const [editingSummary, setEditingSummary] = useState(false);
  const [draftSummary, setDraftSummary] = useState(summary);

  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const [boothNumber, setBoothNumber] = useState<number | "">("");
  const [maskedCode, setMaskedCode] = useState<string>("");
  const [notes, setNotes] = useState("");

  const [records, setRecords] = useState<EvaluationRecord[]>(() => loadRecords());
  const [status, setStatus] = useState<{ kind: "info" | "ok" | "error"; msg: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Initial data load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [codesRows, telemetryRaw, protoRes] = await Promise.all([
          loadApplicationCodes("/data/application_codes.csv"),
          loadTelemetry("/data/booth_conditions.csv"),
          fetch("/protocol.txt").then((r) => r.text())
        ]);
        if (cancelled) return;
        setCodes(codesRows);
        setProtocolText(protoRes);
        if (!summary) {
          const generated = summariseProtocol(protoRes);
          setSummary(generated);
          setDraftSummary(generated);
          localStorage.setItem(SUMMARY_KEY, generated);
        }
        // Anchor telemetry timestamps to a stable reference: earliest existing
        // record, or now-N minutes if no records yet. Persist anchor so the
        // alignment remains stable across reloads.
        const existing = loadRecords();
        let anchorIso = localStorage.getItem(TELEMETRY_ANCHOR_KEY);
        if (!anchorIso) {
          if (existing.length > 0) {
            const earliest = existing.reduce<string>(
              (acc, r) =>
                acc === "" || r.evaluation_timestamp_iso < acc
                  ? r.evaluation_timestamp_iso
                  : acc,
              ""
            );
            anchorIso =
              earliest ||
              new Date(Date.now() - telemetryRaw.length * 60_000).toISOString();
          } else {
            anchorIso = new Date(
              Date.now() - telemetryRaw.length * 60_000
            ).toISOString();
          }
          localStorage.setItem(TELEMETRY_ANCHOR_KEY, anchorIso);
        }
        const rewritten = rewriteTelemetryTimestamps(telemetryRaw, {
          anchorIso,
          intervalMs: 60_000
        });
        setTelemetry(rewritten);
      } catch (e) {
        if (!cancelled) {
          setLoadError(
            e instanceof Error ? e.message : "Failed to load source data."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-parse from transcript whenever it changes
  useEffect(() => {
    const combined = `${transcript} ${interim}`.trim();
    if (!combined) return;
    const b = parseBoothNumber(combined);
    if (b !== null) setBoothNumber(b);
    const c = parseMaskedCode(combined);
    if (c) setMaskedCode(c);
  }, [transcript, interim]);

  // Resolved IDs and live booth metrics derived from current input
  const resolved = useMemo(
    () => resolveMaskedCode(maskedCode, codes),
    [maskedCode, codes]
  );

  const previewTelemetryRow: TelemetryRow | null = useMemo(() => {
    if (telemetry.length === 0) return null;
    return findNearestTelemetryRow(telemetry, new Date().toISOString());
  }, [telemetry]);

  const previewMetrics: BoothMetrics | null = useMemo(() => {
    if (!previewTelemetryRow || boothNumber === "") return null;
    return extractBoothMetrics(previewTelemetryRow, Number(boothNumber));
  }, [previewTelemetryRow, boothNumber]);

  function startListening() {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setStatus({
        kind: "error",
        msg: "Voice input not supported on this browser. Use the manual fields below."
      });
      return;
    }
    try {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-GB";
      rec.onresult = (e) => {
        let finalText = "";
        let interimText = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) finalText += res[0].transcript;
          else interimText += res[0].transcript;
        }
        if (finalText) setTranscript((prev) => (prev + " " + finalText).trim());
        setInterim(interimText);
      };
      rec.onend = () => {
        setListening(false);
        setInterim("");
      };
      rec.onerror = (ev) => {
        setListening(false);
        setStatus({ kind: "error", msg: `Voice error: ${ev.error}` });
      };
      rec.start();
      recognitionRef.current = rec;
      setListening(true);
      setStatus({ kind: "info", msg: "Listening. Say booth number then 4-letter code." });
    } catch (e) {
      setStatus({
        kind: "error",
        msg: e instanceof Error ? e.message : "Could not start voice input."
      });
    }
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  function clearTranscript() {
    setTranscript("");
    setInterim("");
  }

  function handleSave() {
    if (boothNumber === "" || boothNumber < 1 || boothNumber > 8) {
      setStatus({ kind: "error", msg: "Booth number must be 1 to 8." });
      return;
    }
    if (!maskedCode || maskedCode.length !== 4) {
      setStatus({ kind: "error", msg: "Masked code must be exactly 4 letters." });
      return;
    }
    if (!resolved) {
      setStatus({
        kind: "error",
        msg: `Masked code "${maskedCode}" not found in mapping.`
      });
      return;
    }
    const evaluationIso = new Date().toISOString();
    const nearest = findNearestTelemetryRow(telemetry, evaluationIso);
    const metrics = extractBoothMetrics(nearest, Number(boothNumber));
    const record: EvaluationRecord = {
      evaluation_timestamp_iso: evaluationIso,
      booth_number: Number(boothNumber),
      masked_code: maskedCode,
      project_id: resolved["Project ID"],
      application_id: resolved["Application ID"],
      effective_telemetry_timestamp_iso: nearest?.effective_timestamp_iso ?? null,
      ...metrics,
      notes,
      protocol_summary_snapshot: summary
    };
    const next = [record, ...records];
    setRecords(next);
    saveRecords(next);
    setStatus({
      kind: "ok",
      msg: `Saved booth ${record.booth_number} / ${record.masked_code} -> ${record.project_id} / ${record.application_id}.`
    });
    setNotes("");
    setMaskedCode("");
    setTranscript("");
    setInterim("");
  }

  function handleExport() {
    if (records.length === 0) {
      setStatus({ kind: "error", msg: "No records to export." });
      return;
    }
    const csv = recordsToCsv(records);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evaluations_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function handleClearRecords() {
    if (!confirm("Delete all saved evaluations on this device?")) return;
    setRecords([]);
    saveRecords([]);
    setStatus({ kind: "info", msg: "Local records cleared." });
  }

  function handleResetSummary() {
    const generated = summariseProtocol(protocolText);
    setSummary(generated);
    setDraftSummary(generated);
    localStorage.setItem(SUMMARY_KEY, generated);
    setEditingSummary(false);
    setStatus({ kind: "info", msg: "Protocol summary regenerated from source." });
  }

  function handleSaveSummary() {
    setSummary(draftSummary);
    localStorage.setItem(SUMMARY_KEY, draftSummary);
    setEditingSummary(false);
    setStatus({ kind: "ok", msg: "Protocol summary updated." });
  }

  const speechSupported = !!getSpeechRecognition();
  const recentRecords = records.slice(0, 5);

  return (
    <div className="app">
      <div className="header">
        <h1>Fragrance Evaluation</h1>
        <span className="chip">
          {codes.length} codes · {telemetry.length} telemetry rows
        </span>
      </div>

      {loadError && (
        <div className="banner error">Could not load source data: {loadError}</div>
      )}

      {status && <div className={`banner ${status.kind}`}>{status.msg}</div>}

      <section className="card">
        <h2>Voice input</h2>
        <div className="mic-row">
          <button
            className={`mic-button ${listening ? "listening" : ""}`}
            onClick={listening ? stopListening : startListening}
            disabled={!speechSupported}
            aria-pressed={listening}
          >
            {listening ? "Stop" : speechSupported ? "Hold to talk" : "Voice unavailable"}
          </button>
          <div className={`transcript ${transcript || interim ? "" : "empty"}`}>
            {transcript || interim
              ? `${transcript}${interim ? " " + interim : ""}`
              : "Press the mic and say the booth number followed by the 4-letter code."}
          </div>
          <div className="chips">
            <span className={`chip ${boothNumber !== "" ? "filled" : ""}`}>
              Booth: {boothNumber === "" ? "—" : boothNumber}
            </span>
            <span className={`chip ${maskedCode.length === 4 ? "filled" : ""}`}>
              Code: {maskedCode || "—"}
            </span>
            {transcript && (
              <button className="btn" onClick={clearTranscript}>
                Clear transcript
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Manual input</h2>
        <div className="grid">
          <div className="field">
            <label htmlFor="booth">Booth number (1-8)</label>
            <select
              id="booth"
              value={boothNumber}
              onChange={(e) =>
                setBoothNumber(e.target.value === "" ? "" : Number(e.target.value))
              }
            >
              <option value="">Select</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="code">Masked code (4 letters)</label>
            <input
              id="code"
              maxLength={4}
              value={maskedCode}
              onChange={(e) =>
                setMaskedCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))
              }
              placeholder="e.g. ASDF"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Resolved IDs</h2>
        {resolved ? (
          <div>
            <div className="kv-row">
              <span className="k">Project ID</span>
              <span className="v">{resolved["Project ID"]}</span>
            </div>
            <div className="kv-row">
              <span className="k">Application ID</span>
              <span className="v">{resolved["Application ID"]}</span>
            </div>
          </div>
        ) : (
          <div style={{ color: "var(--muted)", fontSize: 14 }}>
            {maskedCode.length === 4
              ? `Code "${maskedCode}" not found in mapping.`
              : "Enter or speak a 4-letter code to resolve project and application IDs."}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Booth conditions</h2>
        {boothNumber === "" || !previewTelemetryRow ? (
          <div style={{ color: "var(--muted)", fontSize: 14 }}>
            Select a booth to preview the latest telemetry snapshot.
          </div>
        ) : (
          <>
            <div className="timestamp-label">
              Conditions snapshot (aligned):{" "}
              {previewTelemetryRow.effective_timestamp_iso}
            </div>
            <div className="metric-grid">
              <Metric label="Temperature" value={formatNumber(previewMetrics?.booth_temperature_c ?? null)} unit="°C" />
              <Metric label="Humidity" value={formatNumber(previewMetrics?.booth_humidity_rh ?? null)} unit="%RH" />
              <Metric label="Water temp" value={formatNumber(previewMetrics?.booth_water_temp_c ?? null)} unit="°C" />
              <Metric label="Water flow" value={formatNumber(previewMetrics?.booth_water_flow_lpm ?? null)} unit="l/m" />
              <Metric label="Water source" value={previewMetrics?.booth_water_source ?? "—"} />
              <Metric label="Air flow" value={previewMetrics?.booth_air_flow ?? "—"} />
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>Protocol summary</h2>
        {editingSummary ? (
          <>
            <textarea
              value={draftSummary}
              onChange={(e) => setDraftSummary(e.target.value)}
            />
            <div className="actions" style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={handleSaveSummary}>
                Save summary
              </button>
              <button
                className="btn"
                onClick={() => {
                  setDraftSummary(summary);
                  setEditingSummary(false);
                }}
              >
                Cancel
              </button>
              <button className="btn" onClick={handleResetSummary}>
                Reset from source
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="protocol">{summary || "No summary yet."}</div>
            <div className="actions" style={{ marginTop: 10 }}>
              <button
                className="btn"
                onClick={() => {
                  setDraftSummary(summary);
                  setEditingSummary(true);
                }}
              >
                Edit
              </button>
              <button className="btn" onClick={handleResetSummary}>
                Reset from source
              </button>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>Notes</h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional observations (intensity score, character notes, anomalies)..."
        />
      </section>

      <section className="card">
        <h2>Save and export</h2>
        <div className="actions">
          <button
            className="btn primary"
            onClick={handleSave}
            disabled={boothNumber === "" || maskedCode.length !== 4 || !resolved}
          >
            Save evaluation
          </button>
          <button className="btn" onClick={handleExport} disabled={records.length === 0}>
            Export CSV ({records.length})
          </button>
          <button
            className="btn danger"
            onClick={handleClearRecords}
            disabled={records.length === 0}
          >
            Clear records
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Recent evaluations</h2>
        {recentRecords.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 14 }}>No evaluations saved yet.</div>
        ) : (
          <div className="records">
            {recentRecords.map((r) => (
              <div className="record" key={r.evaluation_timestamp_iso + r.masked_code}>
                <div className="top">
                  <span>
                    Booth <strong>{r.booth_number}</strong> · <strong>{r.masked_code}</strong>
                  </span>
                  <span className="meta">{new Date(r.evaluation_timestamp_iso).toLocaleString()}</span>
                </div>
                <div className="meta">
                  {r.project_id} / {r.application_id} · T {formatNumber(r.booth_temperature_c)} °C ·
                  RH {formatNumber(r.booth_humidity_rh)}% · flow {formatNumber(r.booth_water_flow_lpm)} l/m
                </div>
                {r.notes && <div className="meta">Note: {r.notes}</div>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  const muted = value === "—";
  return (
    <div className="metric">
      <div className="label">{label}</div>
      <div className={`value ${muted ? "muted" : ""}`}>
        {value}
        {!muted && unit ? ` ${unit}` : ""}
      </div>
    </div>
  );
}

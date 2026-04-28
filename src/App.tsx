import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseBoothNumber,
  parseMaskedCode,
  resolveMaskedCode
} from "./lib/parsing";
import {
  extractBoothMetrics,
  findNearestTelemetryRow,
  parseTelemetryRows
} from "./lib/telemetry";
import { summariseProtocol } from "./lib/protocol";
import { loadApplicationCodes, loadTelemetry, recordsToCsv } from "./lib/csv";
import { getSpeechRecognition, type SpeechRecognitionLike } from "./lib/speech";
import {
  GRAND_FAMILIES,
  SENSATIONS,
  buildTermIndex,
  detectDescriptors,
  type DetectedTerm
} from "./lib/taxonomy";
import type {
  ApplicationCodeRow,
  EvaluationRecord,
  TelemetryRow
} from "./lib/types";

const RECORDS_KEY = "frag.records.v1";
const SUMMARY_KEY = "frag.protocol.summary.v1";
const BASE = import.meta.env.BASE_URL;
const TERM_INDEX = buildTermIndex();

type AppView = "landing" | "recording" | "review";

function fmt(n: number | null, d = 2): string {
  return n === null || isNaN(n) ? "—" : n.toFixed(d);
}

function loadRecords(): EvaluationRecord[] {
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    return raw ? (JSON.parse(raw) as EvaluationRecord[]) : [];
  } catch { return []; }
}

function saveRecords(r: EvaluationRecord[]) {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(r));
}

// ── SVG icons ──────────────────────────────────────────────────────────────

function MicIcon({ size = 52, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="9" y="2" width="6" height="11" rx="3" fill={color} />
      <path d="M5 11a7 7 0 0014 0" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="12" y1="18" x2="12" y2="22" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="9" y1="22" x2="15" y2="22" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2" fill="#fff" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Root component ──────────────────────────────────────────────────────────

export default function App() {
  const [codes, setCodes] = useState<ApplicationCodeRow[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetryRow[]>([]);
  const [protocolText, setProtocolText] = useState("");
  const [summary, setSummary] = useState<string>(() => localStorage.getItem(SUMMARY_KEY) ?? "");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [view, setView] = useState<AppView>("landing");
  const [isManual, setIsManual] = useState(false);

  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const [boothNumber, setBoothNumber] = useState<number | "">("");
  const [maskedCode, setMaskedCode] = useState<string>("");
  const [notes, setNotes] = useState("");
  const notesRef = useRef<HTMLTextAreaElement>(null);

  const [records, setRecords] = useState<EvaluationRecord[]>(() => loadRecords());
  const [status, setStatus] = useState<{ kind: "info" | "ok" | "error"; msg: string } | null>(null);

  const [showRecords, setShowRecords] = useState(false);
  const [showProtocol, setShowProtocol] = useState(false);
  const [showTaxo, setShowTaxo] = useState(false);
  const [taxoSearch, setTaxoSearch] = useState("");
  const [editingSummary, setEditingSummary] = useState(false);
  const [draftSummary, setDraftSummary] = useState(summary);

  // Load data once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [codesRows, telemetryRaw, protoRes] = await Promise.all([
          loadApplicationCodes(`${BASE}data/application_codes.csv`),
          loadTelemetry(`${BASE}data/booth_conditions.csv`),
          fetch(`${BASE}protocol.txt`).then((r) => r.text())
        ]);
        if (cancelled) return;
        setCodes(codesRows);
        setProtocolText(protoRes);
        setTelemetry(parseTelemetryRows(telemetryRaw));
        if (!summary) {
          const gen = summariseProtocol(protoRes);
          setSummary(gen);
          setDraftSummary(gen);
          localStorage.setItem(SUMMARY_KEY, gen);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load data.");
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Parse booth + code from live transcript
  useEffect(() => {
    const combined = `${transcript} ${interim}`.trim();
    if (!combined) return;
    const b = parseBoothNumber(combined);
    if (b !== null) setBoothNumber(b);
    const c = parseMaskedCode(combined);
    if (c) setMaskedCode(c);
  }, [transcript, interim]);

  const resolved = useMemo(() => resolveMaskedCode(maskedCode, codes), [maskedCode, codes]);

  const nearestRow = useMemo(() => {
    if (!telemetry.length) return null;
    return findNearestTelemetryRow(telemetry, new Date().toISOString());
  }, [telemetry]);

  const metrics = useMemo(() => {
    if (!nearestRow || boothNumber === "") return null;
    return extractBoothMetrics(nearestRow, Number(boothNumber));
  }, [nearestRow, boothNumber]);

  const detected: DetectedTerm[] = useMemo(() => detectDescriptors(notes, TERM_INDEX), [notes]);

  const usageSummary = useMemo(() => {
    const m = new Map<string, number>();
    for (const rec of records) {
      for (const d of detectDescriptors(rec.notes, TERM_INDEX))
        m.set(d.term, (m.get(d.term) ?? 0) + 1);
    }
    return m;
  }, [records]);

  // ── Speech ──────────────────────────────────────────────────────────────

  function startRecording() {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setIsManual(true);
      setView("review");
      return;
    }
    try {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-GB";
      rec.onresult = (e) => {
        let fin = ""; let itr = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) fin += r[0].transcript;
          else itr += r[0].transcript;
        }
        if (fin) setTranscript((p) => (p + " " + fin).trim());
        setInterim(itr);
      };
      rec.onend = () => { setListening(false); setInterim(""); };
      rec.onerror = (ev) => {
        setListening(false);
        setStatus({ kind: "error", msg: `Voice error: ${ev.error}` });
      };
      rec.start();
      recognitionRef.current = rec;
      setListening(true);
      setTranscript("");
      setInterim("");
      setView("recording");
    } catch (e) {
      setStatus({ kind: "error", msg: e instanceof Error ? e.message : "Could not start voice." });
    }
  }

  function stopRecordingAndReview() {
    recognitionRef.current?.stop();
    setListening(false);
    setIsManual(false);
    setView("review");
  }

  function goToManual() {
    setIsManual(true);
    setBoothNumber("");
    setMaskedCode("");
    setNotes("");
    setTranscript("");
    setInterim("");
    setView("review");
  }

  function goBack() {
    recognitionRef.current?.stop();
    setListening(false);
    setView("landing");
    setStatus(null);
  }

  function appendDescriptor(label: string) {
    setNotes((p) => { const t = p.trimEnd(); return t ? `${t}, ${label}` : label; });
    notesRef.current?.focus();
  }

  function handleSave() {
    if (boothNumber === "" || boothNumber < 1 || boothNumber > 8) {
      setStatus({ kind: "error", msg: "Booth number must be 1–8." });
      return;
    }
    if (!maskedCode || maskedCode.length !== 4) {
      setStatus({ kind: "error", msg: "Masked code must be exactly 4 letters." });
      return;
    }
    if (!resolved) {
      setStatus({ kind: "error", msg: `Code "${maskedCode}" not found in mapping.` });
      return;
    }
    const evaluationIso = new Date().toISOString();
    const row = findNearestTelemetryRow(telemetry, evaluationIso);
    const mx = extractBoothMetrics(row, Number(boothNumber));
    const record: EvaluationRecord = {
      evaluation_timestamp_iso: evaluationIso,
      booth_number: Number(boothNumber),
      masked_code: maskedCode,
      project_id: resolved["Project ID"],
      application_id: resolved["Application ID"],
      effective_telemetry_timestamp_iso: row?.effective_timestamp_iso ?? null,
      ...mx,
      notes,
      protocol_summary_snapshot: summary
    };
    const next = [record, ...records];
    setRecords(next);
    saveRecords(next);
    setStatus({ kind: "ok", msg: `Saved — Booth ${record.booth_number} · ${record.project_id} / ${record.application_id}` });
    setNotes("");
    setMaskedCode("");
    setTranscript("");
    setInterim("");
  }

  function handleExport() {
    if (!records.length) { setStatus({ kind: "error", msg: "No records to export." }); return; }
    const blob = new Blob([recordsToCsv(records)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evaluations_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function handleClear() {
    if (!confirm("Delete all saved evaluations on this device?")) return;
    setRecords([]); saveRecords([]);
    setStatus({ kind: "info", msg: "Records cleared." });
  }

  function handleSaveSummary() {
    setSummary(draftSummary);
    localStorage.setItem(SUMMARY_KEY, draftSummary);
    setEditingSummary(false);
  }

  function handleResetSummary() {
    const gen = summariseProtocol(protocolText);
    setSummary(gen); setDraftSummary(gen);
    localStorage.setItem(SUMMARY_KEY, gen);
    setEditingSummary(false);
  }

  // Taxonomy filtering
  const taxoFilter = taxoSearch.toLowerCase().trim();
  const filteredFamilies = GRAND_FAMILIES
    .map((gf) => ({
      ...gf,
      subfamilies: gf.subfamilies.filter(
        (sf) => !taxoFilter || sf.toLowerCase().includes(taxoFilter) || gf.name.toLowerCase().includes(taxoFilter)
      )
    }))
    .filter((gf) => gf.subfamilies.length > 0 || (!taxoFilter ? false : gf.name.toLowerCase().includes(taxoFilter)));

  const filteredSensations = SENSATIONS.filter(
    (s) => !taxoFilter || s.toLowerCase().includes(taxoFilter)
  );

  // ── Screens ─────────────────────────────────────────────────────────────

  if (view === "landing") {
    return (
      <div className="screen landing">
        <span className="landing-brand">Fragrance Evaluation</span>

        <div className="landing-centre">
          <button
            className="mic-button-landing"
            onClick={startRecording}
            aria-label="Start voice recording"
          >
            <MicIcon size={52} />
          </button>
          <span className="landing-cta-label">Tap to begin</span>
          {loadError && (
            <div style={{ fontSize: 12, color: "#c53030", textAlign: "center", maxWidth: 280 }}>
              {loadError}
            </div>
          )}
        </div>

        <button className="skip-btn" onClick={goToManual}>
          Skip recording — enter manually
        </button>
      </div>
    );
  }

  if (view === "recording") {
    return (
      <div className="screen recording-screen">
        <div style={{ width: "100%", maxWidth: 460, textAlign: "center" }}>
          <div className="recording-label">Recording</div>
        </div>

        <div className="recording-centre">
          <div className="mic-pulse-wrapper">
            <div className="pulse-ring" />
            <div className="pulse-ring" />
            <div className="pulse-ring" />
            <button
              className="mic-button-recording"
              onClick={stopRecordingAndReview}
              aria-label="Stop recording"
            >
              <StopIcon />
            </button>
          </div>

          <div className={`transcript-box ${transcript || interim ? "" : "empty"}`}>
            {transcript || interim
              ? `${transcript}${interim ? " " + interim : ""}`
              : "Say the booth number followed by the 4-letter code…"}
          </div>

          <div className="parsed-chips-row">
            <span className={`parsed-chip ${boothNumber !== "" ? "active" : ""}`}>
              Booth {boothNumber !== "" ? boothNumber : "—"}
            </span>
            <span className={`parsed-chip ${maskedCode.length === 4 ? "active" : ""}`}>
              {maskedCode.length === 4 ? maskedCode : "Code —"}
            </span>
          </div>
        </div>

        <button className="done-btn" onClick={stopRecordingAndReview}>
          Done — review fields
        </button>
      </div>
    );
  }

  // ── Screen 3: Review / Manual entry ─────────────────────────────────────
  return (
    <div className="screen">
      <div className="review-screen">

        <div className="review-topbar">
          <button className="back-btn" onClick={goBack} aria-label="Back to start">
            ← {isManual ? "Cancel" : "Back"}
          </button>
          <span className="topbar-title">{isManual ? "Manual Entry" : "Review"}</span>
          <button
            className="records-toggle-btn"
            onClick={() => setShowRecords((s) => !s)}
          >
            Records ({records.length})
          </button>
        </div>

        {status && (
          <div className={`status-banner ${status.kind}`}>{status.msg}</div>
        )}

        {/* ── Booth + Code ── */}
        <div className="section">
          <div className="section-label">Identification</div>
          <div className="input-pair">
            <div>
              <div className="field-label">Booth</div>
              <select
                className={`field-input ${boothNumber !== "" ? "resolved" : ""}`}
                value={boothNumber}
                onChange={(e) => setBoothNumber(e.target.value === "" ? "" : Number(e.target.value))}
              >
                <option value="">—</option>
                {[1,2,3,4,5,6,7,8].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <div className="field-label">Code</div>
              <input
                className={`field-input ${maskedCode.length === 4 && resolved ? "resolved" : ""}`}
                maxLength={4}
                value={maskedCode}
                onChange={(e) => setMaskedCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
                placeholder="XXXX"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
          </div>
        </div>

        {/* ── Resolved IDs ── */}
        {maskedCode.length === 4 && (
          <>
            <div className="section-divider" />
            <div className="section">
              <div className="section-label">Project &amp; Application</div>
              {resolved ? (
                <>
                  <div className="resolved-row">
                    <span className="resolved-key">Project ID</span>
                    <span className="resolved-val">{resolved["Project ID"]}</span>
                  </div>
                  <div className="resolved-row">
                    <span className="resolved-key">Application ID</span>
                    <span className="resolved-val">{resolved["Application ID"]}</span>
                  </div>
                </>
              ) : (
                <div className="not-found-msg">"{maskedCode}" not found in mapping — check the code.</div>
              )}
            </div>
          </>
        )}

        {/* ── Booth conditions ── */}
        <div className="section-divider" />
        <div className="section">
          <div className="section-label">Booth Conditions</div>
          {boothNumber === "" || !nearestRow ? (
            <div className="not-found-msg">Select a booth to load conditions.</div>
          ) : (
            <>
              <div className="telemetry-ts">
                Snapshot: {nearestRow.original_timestamp || nearestRow.effective_timestamp_iso}
              </div>
              <div className="metrics-row">
                <MetricCard label="Temperature" value={fmt(metrics?.booth_temperature_c ?? null)} unit="°C" />
                <MetricCard label="Humidity" value={fmt(metrics?.booth_humidity_rh ?? null)} unit="%RH" />
                <MetricCard label="Water temp" value={fmt(metrics?.booth_water_temp_c ?? null)} unit="°C" />
                <MetricCard label="Water flow" value={fmt(metrics?.booth_water_flow_lpm ?? null)} unit="l/m" />
                <MetricCard label="Water source" value={metrics?.booth_water_source ?? "—"} />
                <MetricCard label="Air flow" value={metrics?.booth_air_flow ?? "—"} />
              </div>
            </>
          )}
        </div>

        {/* ── Protocol summary ── */}
        <div className="section-divider" />
        <div className="section">
          <div
            className="collapsible-header"
            onClick={() => setShowProtocol((s) => !s)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && setShowProtocol((s) => !s)}
          >
            <span className="section-label" style={{ marginBottom: 0 }}>Protocol Summary</span>
            <ChevronIcon open={showProtocol} />
          </div>
          {showProtocol && (
            <div style={{ marginTop: 12 }}>
              {editingSummary ? (
                <>
                  <textarea
                    className="notes-textarea"
                    value={draftSummary}
                    onChange={(e) => setDraftSummary(e.target.value)}
                    style={{ minHeight: 120 }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button className="ghost-btn" style={{ fontSize: 12 }} onClick={handleSaveSummary}>Save</button>
                    <button className="ghost-btn" style={{ fontSize: 12 }} onClick={() => { setDraftSummary(summary); setEditingSummary(false); }}>Cancel</button>
                    <button className="ghost-btn" style={{ fontSize: 12 }} onClick={handleResetSummary}>Reset</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="protocol-block">{summary || "No summary."}</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button className="ghost-btn" style={{ fontSize: 12 }} onClick={() => { setDraftSummary(summary); setEditingSummary(true); }}>Edit</button>
                    <button className="ghost-btn" style={{ fontSize: 12 }} onClick={handleResetSummary}>Reset</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Olfactive Descriptor Panel ── */}
        <div className="section-divider" />
        <div className="section">
          <div
            className="collapsible-header"
            onClick={() => setShowTaxo((s) => !s)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && setShowTaxo((s) => !s)}
          >
            <div>
              <span className="section-label" style={{ marginBottom: 0 }}>Olfactive Descriptors</span>
              <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 8, letterSpacing: "0.04em" }}>Osmo taxonomy</span>
            </div>
            <ChevronIcon open={showTaxo} />
          </div>
          {showTaxo && (
            <div style={{ marginTop: 12 }}>
              <input
                className="taxo-search-input"
                placeholder="Search descriptors…"
                value={taxoSearch}
                onChange={(e) => setTaxoSearch(e.target.value)}
              />
              {filteredFamilies.map((gf) => (
                <div key={gf.name} className="taxo-family-group">
                  <div className="taxo-family-label" style={{ color: gf.color }}>{gf.name}</div>
                  <div className="taxo-chips-wrap">
                    {gf.subfamilies.map((sf) => (
                      <button
                        key={sf}
                        className="taxo-chip-btn"
                        style={{ color: gf.color }}
                        onClick={() => appendDescriptor(sf)}
                      >{sf}</button>
                    ))}
                  </div>
                </div>
              ))}
              {filteredSensations.length > 0 && (
                <div className="taxo-family-group">
                  <div className="taxo-family-label" style={{ color: "#888" }}>Sensations &amp; Textures</div>
                  <div className="taxo-chips-wrap">
                    {filteredSensations.map((s) => (
                      <button
                        key={s}
                        className="taxo-chip-btn"
                        style={{ color: "#888" }}
                        onClick={() => appendDescriptor(s)}
                      >{s}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Notes ── */}
        <div className="section-divider" />
        <div className="section">
          <div className="section-label">Notes</div>
          <textarea
            ref={notesRef}
            className="notes-textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Type observations, or tap descriptors above to append them…"
          />
          {detected.length > 0 && (
            <div className="detected-bar">
              <span className="detected-bar-label">Detected:</span>
              {detected.map((d) => (
                <span key={d.term} className="detected-chip" style={{ color: d.color }}>{d.term}</span>
              ))}
            </div>
          )}
        </div>

        {/* ── Save & export ── */}
        <div className="section-divider" />
        <div className="section">
          <button
            className="save-btn"
            onClick={handleSave}
            disabled={boothNumber === "" || maskedCode.length !== 4 || !resolved}
          >
            Save Evaluation
          </button>
          <div className="secondary-actions">
            <button className="ghost-btn" onClick={handleExport} disabled={!records.length}>
              Export CSV
            </button>
            <button className="ghost-btn danger" onClick={handleClear} disabled={!records.length}>
              Clear Records
            </button>
          </div>
        </div>

        {/* ── Descriptor usage summary ── */}
        {usageSummary.size > 0 && (
          <>
            <div className="section-divider" />
            <div className="section">
              <div className="section-label">Descriptor Usage</div>
              <div className="usage-chips">
                {[...usageSummary.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([term, count]) => {
                    const meta = TERM_INDEX.get(term.toLowerCase());
                    return (
                      <span key={term} className="detected-chip" style={{ color: meta?.color ?? "#888" }}>
                        {term} <strong>×{count}</strong>
                      </span>
                    );
                  })}
              </div>
            </div>
          </>
        )}

        {/* ── Records drawer ── */}
        {showRecords && (
          <>
            <div className="section-divider" />
            <div className="section">
              <div className="section-label">Recent Evaluations</div>
              {records.length === 0 ? (
                <div className="not-found-msg">No evaluations saved yet.</div>
              ) : (
                records.slice(0, 8).map((r) => {
                  const rDets = detectDescriptors(r.notes, TERM_INDEX);
                  return (
                    <div className="record-item" key={r.evaluation_timestamp_iso + r.masked_code}>
                      <div className="record-item-top">
                        <span className="record-item-ids">
                          Booth {r.booth_number} · {r.masked_code}
                        </span>
                        <span className="record-item-time">
                          {new Date(r.evaluation_timestamp_iso).toLocaleString()}
                        </span>
                      </div>
                      <div className="record-item-meta">
                        {r.project_id} / {r.application_id} · {fmt(r.booth_temperature_c)} °C · RH {fmt(r.booth_humidity_rh)}%
                      </div>
                      {r.notes && <div className="record-item-meta" style={{ marginBottom: 4 }}>{r.notes}</div>}
                      {rDets.length > 0 && (
                        <div className="detected-bar">
                          {rDets.map((d) => (
                            <span key={d.term} className="detected-chip" style={{ color: d.color, fontSize: 10 }}>{d.term}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

      </div>
    </div>
  );
}

function MetricCard({ label, value, unit }: { label: string; value: string; unit?: string }) {
  const muted = value === "—";
  return (
    <div className="metric-card">
      <div className="m-label">{label}</div>
      <div className={`m-value ${muted ? "muted" : ""}`}>
        {value}{!muted && unit ? <span style={{ fontSize: "0.65em", fontWeight: 500, marginLeft: 2 }}>{unit}</span> : ""}
      </div>
    </div>
  );
}

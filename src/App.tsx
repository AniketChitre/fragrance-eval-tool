import { useEffect, useMemo, useRef, useState } from "react";
import { resolveMaskedCode } from "./lib/parsing";
import {
  extractBoothMetrics,
  findNearestTelemetryRow,
  parseTelemetryRows
} from "./lib/telemetry";
import { summariseProtocol } from "./lib/protocol";
import { loadApplicationCodes, loadTelemetry, downloadCsv } from "./lib/csv";
import { getSpeechRecognition, type SpeechRecognitionLike } from "./lib/speech";
import {
  GRAND_FAMILIES,
  SENSATIONS,
  buildTermIndex,
  detectDescriptors,
  type DetectedTerm
} from "./lib/taxonomy";
import {
  segmentTranscript,
  buildDrafts,
  emptyDraft,
  type DraftEntry
} from "./lib/session";
import type {
  ApplicationCodeRow,
  EvaluationRecord,
  TelemetryRow
} from "./lib/types";

const RECORDS_KEY = "frag.records.v1";
const SUMMARY_KEY = "frag.protocol.summary.v1";
const BASE = import.meta.env.BASE_URL;
const TERM_INDEX = buildTermIndex();

// "landing" → tap mic → "recording" → tap Done → "session-review"
// "landing" → Skip recording → "manual" (single booth)
type AppView = "landing" | "recording" | "session-review" | "manual";

function fmt(n: number | null, d = 1): string {
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

// ── Icons ────────────────────────────────────────────────────────────────────

function MicIcon({ size = 52, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M9 6V4h6v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  // ── Data ──────────────────────────────────────────────────────────────────
  const [codes, setCodes] = useState<ApplicationCodeRow[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetryRow[]>([]);
  const [protocolText, setProtocolText] = useState("");
  const [summary, setSummary] = useState<string>(() => localStorage.getItem(SUMMARY_KEY) ?? "");
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Navigation ─────────────────────────────────────────────────────────────
  const [view, setView] = useState<AppView>("landing");

  // ── Recording state ───────────────────────────────────────────────────────
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // ── Session drafts (one per detected booth) ───────────────────────────────
  const [drafts, setDrafts] = useState<DraftEntry[]>([]);
  const [sessionSaved, setSessionSaved] = useState(false);
  const [showTaxoFor, setShowTaxoFor] = useState<string | null>(null);
  const [taxoSearch, setTaxoSearch] = useState("");
  const notesRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // ── Manual single-booth state ──────────────────────────────────────────────
  const [manualBooth, setManualBooth] = useState<number | "">("");
  const [manualCode, setManualCode] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [manualStatus, setManualStatus] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);

  // ── Shared ─────────────────────────────────────────────────────────────────
  const [records, setRecords] = useState<EvaluationRecord[]>(() => loadRecords());
  const [showHistory, setShowHistory] = useState(false);
  const [showProtocol, setShowProtocol] = useState(false);
  const [editingSummary, setEditingSummary] = useState(false);
  const [draftSummary, setDraftSummary] = useState(summary);
  const [globalStatus, setGlobalStatus] = useState<{ kind: "info" | "ok" | "error"; msg: string } | null>(null);

  // ── Load data once ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [codesRows, telemetryRaw, protoRes] = await Promise.all([
          loadApplicationCodes(`${BASE}data/application_codes.csv`),
          loadTelemetry(`${BASE}data/booth_conditions.csv`),
          fetch(`${BASE}protocol.txt`).then((r) => r.text()),
        ]);
        if (cancelled) return;
        setCodes(codesRows);
        setProtocolText(protoRes);
        setTelemetry(parseTelemetryRows(telemetryRaw));
        if (!summary) {
          const gen = summariseProtocol(protoRes);
          setSummary(gen); setDraftSummary(gen);
          localStorage.setItem(SUMMARY_KEY, gen);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load data.");
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Live booth detection from running transcript ───────────────────────────
  const liveSegments = useMemo(
    () => segmentTranscript(`${transcript} ${interim}`.trim()),
    [transcript, interim]
  );
  const detectedBoothNums = useMemo(
    () => new Set(liveSegments.map((s) => s.booth)),
    [liveSegments]
  );

  // ── Speech controls ───────────────────────────────────────────────────────
  function startRecording() {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setGlobalStatus({ kind: "error", msg: "Voice not supported — use Skip recording." });
      return;
    }
    setTranscript(""); setInterim("");
    setSessionSaved(false);
    try {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-GB";
      rec.onresult = (e) => {
        let fin = ""; let itr = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) fin += e.results[i][0].transcript;
          else itr += e.results[i][0].transcript;
        }
        if (fin) setTranscript((p) => (p + " " + fin).trim());
        setInterim(itr);
      };
      rec.onend = () => setInterim("");
      rec.onerror = (ev) => setGlobalStatus({ kind: "error", msg: `Voice error: ${ev.error}` });
      rec.start();
      recognitionRef.current = rec;
      setView("recording");
    } catch (e) {
      setGlobalStatus({ kind: "error", msg: e instanceof Error ? e.message : "Could not start voice." });
    }
  }

  function finishRecording() {
    recognitionRef.current?.stop();
    const full = `${transcript} ${interim}`.trim();
    const segs = segmentTranscript(full);
    if (segs.length === 0) {
      // Nothing detected — fall back to manual
      setView("manual");
      return;
    }
    setDrafts(buildDrafts(segs));
    setView("session-review");
  }

  function goBack() {
    recognitionRef.current?.stop();
    setView("landing");
    setGlobalStatus(null);
    setManualStatus(null);
  }

  // ── Draft editing ──────────────────────────────────────────────────────────
  function patchDraft(key: string, patch: Partial<DraftEntry>) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  function deleteDraft(key: string) {
    setDrafts((prev) => prev.filter((d) => d.key !== key));
  }

  function addMissingBooth() {
    const used = new Set(drafts.map((d) => d.booth_number));
    const missing = [1,2,3,4,5,6,7,8].find((n) => !used.has(n)) ?? 1;
    setDrafts((prev) => [...prev, emptyDraft(missing)].sort((a, b) => a.booth_number - b.booth_number));
  }

  function appendDescriptorToDraft(key: string, label: string) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.key !== key) return d;
        const t = d.notes.trimEnd();
        return { ...d, notes: t ? `${t}, ${label}` : label };
      })
    );
    notesRefs.current[key]?.focus();
  }

  // ── Session save & export ─────────────────────────────────────────────────
  function saveSession(andExport: boolean) {
    const iso = new Date().toISOString();
    const nearestRow = telemetry.length
      ? findNearestTelemetryRow(telemetry, iso)
      : null;

    const sessionRecords: EvaluationRecord[] = drafts.map((d) => {
      const resolved = resolveMaskedCode(d.masked_code, codes);
      const mx = extractBoothMetrics(nearestRow, d.booth_number);
      return {
        evaluation_timestamp_iso: d.evaluation_iso,
        booth_number: d.booth_number,
        masked_code: d.masked_code,
        project_id: resolved?.["Project ID"] ?? "",
        application_id: resolved?.["Application ID"] ?? "",
        effective_telemetry_timestamp_iso: nearestRow?.effective_timestamp_iso ?? null,
        ...mx,
        notes: d.notes,
        protocol_summary_snapshot: summary,
      };
    });

    const next = [...sessionRecords, ...records];
    setRecords(next);
    saveRecords(next);
    setSessionSaved(true);

    if (andExport) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      downloadCsv(sessionRecords, `session_${ts}.csv`);
    }
  }

  // ── Manual single-booth save ──────────────────────────────────────────────
  const manualResolved = useMemo(
    () => resolveMaskedCode(manualCode, codes),
    [manualCode, codes]
  );

  const manualNearestRow = useMemo(() => {
    if (!telemetry.length) return null;
    return findNearestTelemetryRow(telemetry, new Date().toISOString());
  }, [telemetry]);

  const manualMetrics = useMemo(() => {
    if (!manualNearestRow || manualBooth === "") return null;
    return extractBoothMetrics(manualNearestRow, Number(manualBooth));
  }, [manualNearestRow, manualBooth]);

  function saveManual() {
    if (manualBooth === "") { setManualStatus({ kind: "error", msg: "Select a booth." }); return; }
    if (manualCode.length !== 4) { setManualStatus({ kind: "error", msg: "Enter a 4-letter code." }); return; }
    if (!manualResolved) { setManualStatus({ kind: "error", msg: `Code "${manualCode}" not found.` }); return; }
    const iso = new Date().toISOString();
    const row = telemetry.length ? findNearestTelemetryRow(telemetry, iso) : null;
    const mx = extractBoothMetrics(row, Number(manualBooth));
    const rec: EvaluationRecord = {
      evaluation_timestamp_iso: iso,
      booth_number: Number(manualBooth),
      masked_code: manualCode,
      project_id: manualResolved["Project ID"],
      application_id: manualResolved["Application ID"],
      effective_telemetry_timestamp_iso: row?.effective_timestamp_iso ?? null,
      ...mx,
      notes: manualNotes,
      protocol_summary_snapshot: summary,
    };
    const next = [rec, ...records];
    setRecords(next); saveRecords(next);
    setManualStatus({ kind: "ok", msg: `Saved — ${rec.project_id} / ${rec.application_id}` });
    setManualCode(""); setManualNotes("");
  }

  // ── Protocol summary controls ──────────────────────────────────────────────
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

  // ── Taxonomy filtering ────────────────────────────────────────────────────
  const taxoFilter = taxoSearch.toLowerCase().trim();
  const filteredFamilies = GRAND_FAMILIES
    .map((gf) => ({
      ...gf,
      subfamilies: gf.subfamilies.filter(
        (sf) => !taxoFilter || sf.toLowerCase().includes(taxoFilter) || gf.name.toLowerCase().includes(taxoFilter)
      ),
    }))
    .filter((gf) => gf.subfamilies.length > 0);
  const filteredSensations = SENSATIONS.filter(
    (s) => !taxoFilter || s.toLowerCase().includes(taxoFilter)
  );

  // ══════════════════════════════════════════════════════════════════════════
  // SCREEN 1 — Landing
  // ══════════════════════════════════════════════════════════════════════════
  if (view === "landing") {
    return (
      <div className="screen landing">
        <span className="landing-brand">Fragrance Evaluation</span>
        <div className="landing-centre">
          <button className="mic-button-landing" onClick={startRecording} aria-label="Start session recording">
            <MicIcon size={52} />
          </button>
          <span className="landing-cta-label">Tap to begin session</span>
          {loadError && (
            <div style={{ fontSize: 12, color: "#c53030", textAlign: "center", maxWidth: 280, padding: "0 16px" }}>
              {loadError}
            </div>
          )}
          {globalStatus && (
            <div style={{ fontSize: 13, color: "#c53030", textAlign: "center", maxWidth: 280 }}>
              {globalStatus.msg}
            </div>
          )}
          <span style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", maxWidth: 260, lineHeight: 1.5 }}>
            Say "Booth one, A B C D, [notes]" for each booth
          </span>
        </div>
        <button className="skip-btn" onClick={() => { setView("manual"); }}>
          Add single booth manually
        </button>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SCREEN 2 — Continuous recording
  // ══════════════════════════════════════════════════════════════════════════
  if (view === "recording") {
    return (
      <div className="screen recording-screen">
        <div style={{ width: "100%", maxWidth: 460, textAlign: "center" }}>
          <span className="recording-label">Recording session</span>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            Say "Booth one", then the 4-letter code, then your notes — repeat for each booth
          </div>
        </div>

        <div className="recording-centre" style={{ gap: 24 }}>
          <div className="mic-pulse-wrapper">
            <div className="pulse-ring" /><div className="pulse-ring" /><div className="pulse-ring" />
            <button className="mic-button-recording" onClick={finishRecording} aria-label="Stop recording">
              <StopIcon />
            </button>
          </div>

          {/* Live transcript */}
          <div className={`transcript-box ${transcript || interim ? "" : "empty"}`}
            style={{ maxHeight: 140, overflowY: "auto", textAlign: "left" }}>
            {transcript || interim
              ? `${transcript}${interim ? " " + interim : ""}`
              : 'Listening… say “Booth one F A B C rosy warm”'}
          </div>

          {/* Live-detected booth tracker */}
          <div style={{ width: "100%", maxWidth: 460 }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", marginBottom: 8, textAlign: "center" }}>
              Booths detected
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {[1,2,3,4,5,6,7,8].map((n) => (
                <div
                  key={n}
                  style={{
                    width: 38, height: 38, borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 700, fontSize: 14,
                    background: detectedBoothNums.has(n) ? "var(--pink-15)" : "var(--surface)",
                    border: `1.5px solid ${detectedBoothNums.has(n) ? "var(--pink)" : "var(--border)"}`,
                    color: detectedBoothNums.has(n) ? "var(--pink)" : "var(--text-muted)",
                    transition: "all 0.2s",
                  }}
                >
                  {n}
                </div>
              ))}
            </div>
          </div>
        </div>

        <button className="done-btn" onClick={finishRecording}>
          Finish — review {detectedBoothNums.size > 0 ? `${detectedBoothNums.size} booth${detectedBoothNums.size > 1 ? "s" : ""}` : "session"}
        </button>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SCREEN 3 — Session review (multi-booth)
  // ══════════════════════════════════════════════════════════════════════════
  if (view === "session-review") {
    return (
      <div className="screen">
        <div className="review-screen">
          {/* Sticky top bar */}
          <div className="review-topbar">
            <button className="back-btn" onClick={goBack}>← New session</button>
            <span className="topbar-title">{drafts.length} booth{drafts.length !== 1 ? "s" : ""} captured</span>
            <button className="records-toggle-btn" onClick={() => setShowHistory((s) => !s)}>
              History ({records.length})
            </button>
          </div>

          {sessionSaved && (
            <div className="status-banner ok">
              Session saved — {drafts.length} evaluations recorded.
            </div>
          )}

          {/* Protocol summary (collapsible) */}
          <div className="section">
            <div className="collapsible-header"
              onClick={() => setShowProtocol((s) => !s)} role="button" tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setShowProtocol((s) => !s)}>
              <span className="section-label" style={{ marginBottom: 0 }}>Protocol Summary</span>
              <ChevronIcon open={showProtocol} />
            </div>
            {showProtocol && (
              <div style={{ marginTop: 12 }}>
                {editingSummary ? (
                  <>
                    <textarea className="notes-textarea" value={draftSummary}
                      onChange={(e) => setDraftSummary(e.target.value)} style={{ minHeight: 100 }} />
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

          <div className="section-divider" />

          {/* Per-booth draft cards */}
          <div className="section">
            <div className="section-label">Booth Evaluations — review &amp; edit before saving</div>
            {drafts.length === 0 && (
              <div className="not-found-msg" style={{ marginBottom: 12 }}>
                No booths were detected. Add them manually below.
              </div>
            )}
            {drafts.map((draft) => (
              <BoothDraftCard
                key={draft.key}
                draft={draft}
                codes={codes}
                telemetry={telemetry}
                onPatch={(patch) => patchDraft(draft.key, patch)}
                onDelete={() => deleteDraft(draft.key)}
                showTaxo={showTaxoFor === draft.key}
                onToggleTaxo={() => setShowTaxoFor((k) => k === draft.key ? null : draft.key)}
                taxoSearch={taxoSearch}
                onTaxoSearch={setTaxoSearch}
                filteredFamilies={filteredFamilies}
                filteredSensations={filteredSensations}
                onAppendDescriptor={(label) => appendDescriptorToDraft(draft.key, label)}
                notesRef={(el) => { notesRefs.current[draft.key] = el; }}
              />
            ))}

            {/* Add missing booth */}
            {drafts.length < 8 && (
              <button className="ghost-btn" style={{ width: "100%", marginTop: 4 }} onClick={addMissingBooth}>
                + Add missing booth
              </button>
            )}
          </div>

          {/* Save & Export */}
          <div className="section-divider" />
          <div className="section">
            <button
              className="save-btn"
              onClick={() => saveSession(true)}
              disabled={drafts.length === 0}
            >
              Save all &amp; Export CSV
            </button>
            <div className="secondary-actions">
              <button className="ghost-btn" onClick={() => saveSession(false)} disabled={drafts.length === 0}>
                Save only
              </button>
              <button
                className="ghost-btn"
                onClick={() => {
                  const ts = new Date().toISOString().replace(/[:.]/g, "-");
                  downloadCsv(records, `all_evaluations_${ts}.csv`);
                }}
                disabled={records.length === 0}
              >
                Export all history
              </button>
            </div>
          </div>

          {/* History */}
          {showHistory && (
            <>
              <div className="section-divider" />
              <div className="section">
                <div className="section-label">Saved Records</div>
                {records.length === 0 ? (
                  <div className="not-found-msg">No records saved yet.</div>
                ) : (
                  records.slice(0, 10).map((r) => (
                    <div className="record-item" key={r.evaluation_timestamp_iso + r.masked_code}>
                      <div className="record-item-top">
                        <span className="record-item-ids">Booth {r.booth_number} · {r.masked_code}</span>
                        <span className="record-item-time">{new Date(r.evaluation_timestamp_iso).toLocaleString()}</span>
                      </div>
                      <div className="record-item-meta">{r.project_id} / {r.application_id} · {fmt(r.booth_temperature_c)} °C · RH {fmt(r.booth_humidity_rh)}%</div>
                      {r.notes && <div className="record-item-meta">{r.notes}</div>}
                    </div>
                  ))
                )}
                <div className="secondary-actions" style={{ marginTop: 12 }}>
                  <button className="ghost-btn danger" onClick={() => {
                    if (!confirm("Delete all saved evaluations on this device?")) return;
                    setRecords([]); saveRecords([]);
                  }} disabled={records.length === 0}>
                    Clear all records
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SCREEN 4 — Manual single-booth entry
  // ══════════════════════════════════════════════════════════════════════════
  const manualDetected: DetectedTerm[] = detectDescriptors(manualNotes, TERM_INDEX);

  return (
    <div className="screen">
      <div className="review-screen">
        <div className="review-topbar">
          <button className="back-btn" onClick={goBack}>← Back</button>
          <span className="topbar-title">Manual Entry</span>
          <button className="records-toggle-btn" onClick={() => setShowHistory((s) => !s)}>
            Records ({records.length})
          </button>
        </div>

        {manualStatus && (
          <div className={`status-banner ${manualStatus.kind}`}>{manualStatus.msg}</div>
        )}

        <div className="section">
          <div className="section-label">Identification</div>
          <div className="input-pair">
            <div>
              <div className="field-label">Booth</div>
              <select className={`field-input ${manualBooth !== "" ? "resolved" : ""}`}
                value={manualBooth}
                onChange={(e) => setManualBooth(e.target.value === "" ? "" : Number(e.target.value))}>
                <option value="">—</option>
                {[1,2,3,4,5,6,7,8].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <div className="field-label">Code</div>
              <input className={`field-input ${manualCode.length === 4 && manualResolved ? "resolved" : ""}`}
                maxLength={4} value={manualCode}
                onChange={(e) => setManualCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
                placeholder="XXXX" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
            </div>
          </div>
        </div>

        {manualCode.length === 4 && (
          <>
            <div className="section-divider" />
            <div className="section">
              <div className="section-label">Project &amp; Application</div>
              {manualResolved ? (
                <>
                  <div className="resolved-row"><span className="resolved-key">Project ID</span><span className="resolved-val">{manualResolved["Project ID"]}</span></div>
                  <div className="resolved-row"><span className="resolved-key">Application ID</span><span className="resolved-val">{manualResolved["Application ID"]}</span></div>
                </>
              ) : (
                <div className="not-found-msg">"{manualCode}" not found in mapping.</div>
              )}
            </div>
          </>
        )}

        {manualBooth !== "" && manualNearestRow && (
          <>
            <div className="section-divider" />
            <div className="section">
              <div className="section-label">Booth Conditions</div>
              <div className="telemetry-ts">Snapshot: {manualNearestRow.original_timestamp || manualNearestRow.effective_timestamp_iso}</div>
              <div className="metrics-row">
                <MetricCard label="Temp" value={fmt(manualMetrics?.booth_temperature_c ?? null)} unit="°C" />
                <MetricCard label="Humidity" value={fmt(manualMetrics?.booth_humidity_rh ?? null)} unit="%RH" />
                <MetricCard label="Water T" value={fmt(manualMetrics?.booth_water_temp_c ?? null)} unit="°C" />
                <MetricCard label="Flow" value={fmt(manualMetrics?.booth_water_flow_lpm ?? null)} unit="l/m" />
                <MetricCard label="Source" value={manualMetrics?.booth_water_source ?? "—"} />
                <MetricCard label="Air" value={manualMetrics?.booth_air_flow ?? "—"} />
              </div>
            </div>
          </>
        )}

        <div className="section-divider" />
        <div className="section">
          <div className="section-label">Notes</div>
          <textarea className="notes-textarea" value={manualNotes}
            onChange={(e) => setManualNotes(e.target.value)}
            placeholder="Observations, intensity, descriptors…" />
          {manualDetected.length > 0 && (
            <div className="detected-bar">
              <span className="detected-bar-label">Detected:</span>
              {manualDetected.map((d) => (
                <span key={d.term} className="detected-chip" style={{ color: d.color }}>{d.term}</span>
              ))}
            </div>
          )}
        </div>

        <div className="section-divider" />
        <div className="section">
          <button className="save-btn" onClick={saveManual}
            disabled={manualBooth === "" || manualCode.length !== 4 || !manualResolved}>
            Save Evaluation
          </button>
          <div className="secondary-actions">
            <button className="ghost-btn"
              onClick={() => { const ts = new Date().toISOString().replace(/[:.]/g, "-"); downloadCsv(records, `evaluations_${ts}.csv`); }}
              disabled={records.length === 0}>
              Export CSV ({records.length})
            </button>
          </div>
        </div>

        {showHistory && records.length > 0 && (
          <>
            <div className="section-divider" />
            <div className="section">
              <div className="section-label">Recent Records</div>
              {records.slice(0, 5).map((r) => (
                <div className="record-item" key={r.evaluation_timestamp_iso + r.masked_code}>
                  <div className="record-item-top">
                    <span className="record-item-ids">Booth {r.booth_number} · {r.masked_code}</span>
                    <span className="record-item-time">{new Date(r.evaluation_timestamp_iso).toLocaleString()}</span>
                  </div>
                  <div className="record-item-meta">{r.project_id} / {r.application_id}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Booth draft card (session review) ────────────────────────────────────────

interface BoothDraftCardProps {
  draft: DraftEntry;
  codes: ApplicationCodeRow[];
  telemetry: TelemetryRow[];
  onPatch: (patch: Partial<DraftEntry>) => void;
  onDelete: () => void;
  showTaxo: boolean;
  onToggleTaxo: () => void;
  taxoSearch: string;
  onTaxoSearch: (v: string) => void;
  filteredFamilies: typeof GRAND_FAMILIES;
  filteredSensations: string[];
  onAppendDescriptor: (label: string) => void;
  notesRef: (el: HTMLTextAreaElement | null) => void;
}

function BoothDraftCard({
  draft, codes, telemetry,
  onPatch, onDelete,
  showTaxo, onToggleTaxo, taxoSearch, onTaxoSearch,
  filteredFamilies, filteredSensations, onAppendDescriptor,
  notesRef,
}: BoothDraftCardProps) {
  const resolved = useMemo(
    () => resolveMaskedCode(draft.masked_code, codes),
    [draft.masked_code, codes]
  );

  const nearestRow = useMemo(() => {
    if (!telemetry.length) return null;
    return findNearestTelemetryRow(telemetry, draft.evaluation_iso);
  }, [telemetry, draft.evaluation_iso]);

  const metrics = useMemo(() => {
    if (!nearestRow) return null;
    return extractBoothMetrics(nearestRow, draft.booth_number);
  }, [nearestRow, draft.booth_number]);

  const detected: DetectedTerm[] = useMemo(
    () => detectDescriptors(draft.notes, TERM_INDEX),
    [draft.notes]
  );

  const isResolved = draft.masked_code.length === 4 && !!resolved;

  return (
    <div className={`session-card ${isResolved ? "resolved" : ""}`}>
      {/* Header row: booth badge + code input + IDs + delete */}
      <div className="session-card-header">
        <div className="booth-badge">{draft.booth_number}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="field-label" style={{ marginBottom: 4 }}>Code</div>
          <input
            className={`session-code-input ${isResolved ? "resolved" : ""}`}
            maxLength={4}
            value={draft.masked_code}
            onChange={(e) => onPatch({ masked_code: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })}
            placeholder="XXXX"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <div style={{ flex: 2, minWidth: 0, paddingLeft: 8 }}>
          {isResolved ? (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--teal)" }}>{resolved!["Project ID"]}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{resolved!["Application ID"]}</div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
              {draft.masked_code.length === 4 ? "Code not found" : "Enter code"}
            </div>
          )}
        </div>
        <button
          onClick={onDelete}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "4px", flexShrink: 0 }}
          aria-label="Remove booth"
          title="Remove this booth entry"
        >
          <TrashIcon />
        </button>
      </div>

      {/* Booth selector (in case wrong booth was detected) */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>Booth #:</span>
        <select
          style={{ fontSize: 13, fontWeight: 600, padding: "3px 6px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", flex: "0 0 auto" }}
          value={draft.booth_number}
          onChange={(e) => onPatch({ booth_number: Number(e.target.value) })}
        >
          {[1,2,3,4,5,6,7,8].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {metrics && (
          <div style={{ display: "flex", gap: 6, fontSize: 11, color: "var(--text-muted)", flexWrap: "wrap" }}>
            <span>{fmt(metrics.booth_temperature_c)} °C</span>
            <span>·</span>
            <span>RH {fmt(metrics.booth_humidity_rh)}%</span>
            <span>·</span>
            <span>Flow {fmt(metrics.booth_water_flow_lpm)} l/m</span>
          </div>
        )}
      </div>

      {/* Notes */}
      <textarea
        ref={notesRef}
        className="notes-textarea"
        style={{ minHeight: 60 }}
        value={draft.notes}
        onChange={(e) => onPatch({ notes: e.target.value })}
        placeholder="Observations…"
      />

      {/* Detected descriptors */}
      {detected.length > 0 && (
        <div className="detected-bar">
          <span className="detected-bar-label">Detected:</span>
          {detected.map((d) => (
            <span key={d.term} className="detected-chip" style={{ color: d.color }}>{d.term}</span>
          ))}
        </div>
      )}

      {/* Taxonomy toggle */}
      <button
        className="ghost-btn"
        style={{ width: "100%", marginTop: 8, fontSize: 12 }}
        onClick={onToggleTaxo}
      >
        {showTaxo ? "Hide descriptors" : "Add descriptors (Osmo taxonomy)"}
      </button>

      {showTaxo && (
        <div style={{ marginTop: 10 }}>
          <input
            className="taxo-search-input"
            placeholder="Search descriptors…"
            value={taxoSearch}
            onChange={(e) => onTaxoSearch(e.target.value)}
          />
          {filteredFamilies.map((gf) => (
            <div key={gf.name} className="taxo-family-group">
              <div className="taxo-family-label" style={{ color: gf.color }}>{gf.name}</div>
              <div className="taxo-chips-wrap">
                {gf.subfamilies.map((sf) => (
                  <button key={sf} className="taxo-chip-btn" style={{ color: gf.color }} onClick={() => onAppendDescriptor(sf)}>{sf}</button>
                ))}
              </div>
            </div>
          ))}
          {filteredSensations.length > 0 && (
            <div className="taxo-family-group">
              <div className="taxo-family-label" style={{ color: "#888" }}>Sensations &amp; Textures</div>
              <div className="taxo-chips-wrap">
                {filteredSensations.map((s) => (
                  <button key={s} className="taxo-chip-btn" style={{ color: "#888" }} onClick={() => onAppendDescriptor(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
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

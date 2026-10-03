import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ShieldAlert, ShieldCheck, FileText, Upload, AlertTriangle, Scale, BookOpen,
  ZoomIn, ZoomOut, Download, Eye, Sparkles, X, RefreshCw, FileCheck, Trash2,
  Loader2, AlertCircle, ExternalLink, FlaskConical,
} from 'lucide-react';
import { getJson, sendRequest, uploadFile } from '../api';
import DocViewer from '../DocViewer';

const API = '/api/compliance';
const ACCEPTED = ['.pdf', '.docx', '.txt', '.md'];
const MAX_MB = 10;
const SAVED_DOC_KEY = 'petrosage.compliance.doc.v1';
const ZOOM = { min: 80, max: 140, step: 10 };

const SEVERITY = {
  high: { label: 'High', color: '#b91c1c', bg: '#fef2f2', border: '#fecaca' },
  medium: { label: 'Medium', color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  low: { label: 'Low', color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
};

function readSavedDoc() {
  try { return localStorage.getItem(SAVED_DOC_KEY); } catch { return null; }
}
function rememberDoc(id) {
  try {
    if (id) localStorage.setItem(SAVED_DOC_KEY, id);
    else localStorage.removeItem(SAVED_DOC_KEY);
  } catch { /* storage blocked: the page still works, it just won't reopen the doc */ }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function lawLocation(law) {
  if (law.page) return `page ${law.page}`;
  if (law.row) return `paragraph ${law.row}`;
  return '';
}

function sectionLabel(f) {
  return `Section ${f.sectionId.slice(1)}${f.page ? `, page ${f.page}` : ''}`;
}

/* Split section text into plain and highlighted runs; overlapping quotes merge into one mark. */
function segmentsFor(text, marks) {
  const sorted = [...marks].sort((a, b) => a.start - b.start);
  const merged = [];
  for (const m of sorted) {
    const last = merged[merged.length - 1];
    if (last && m.start < last.end) {
      last.end = Math.max(last.end, m.end);
      last.ids.push(m.id);
    } else {
      merged.push({ start: m.start, end: m.end, ids: [m.id], severity: m.severity });
    }
  }
  const out = [];
  let pos = 0;
  for (const m of merged) {
    if (m.start > pos) out.push({ text: text.slice(pos, m.start) });
    out.push({ text: text.slice(m.start, m.end), mark: m });
    pos = m.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}

/* The law passage a finding cites, in the shape the shared DocViewer expects. */
function lawAsSource(f) {
  const { law } = f;
  return {
    id: f.id,
    sourceId: law.sourceId,
    name: law.name,
    country: 'India',
    unit: law.page ? 'pg.' : 'row',
    pages: [law.page || law.row].filter(Boolean),
    excerpts: [{ chunkId: law.chunkId, page: law.page, row: law.row, sheet: null, text: law.text }],
  };
}

/* ─── "What to do now?" dialog: the remediation from each finding ─── */
function ActionPlanModal({ findings, reportUrl, onClose }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    const opener = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll('button, a[href]');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); opener?.focus?.(); };
  }, [onClose]);

  return (
    <div className="reg-modal-backdrop" onClick={onClose}>
      <div className="reg-modal" role="dialog" aria-modal="true" aria-labelledby="plan-title" ref={dialogRef} onClick={e => e.stopPropagation()}>
        <div className="reg-modal-head">
          <FileCheck size={16} style={{ color: '#38bdf8' }} />
          <div style={{ flex: 1 }}>
            <h2 id="plan-title">Compliance action plan</h2>
            <p>Recommended changes for the {findings.length} flagged issue{findings.length === 1 ? '' : 's'}, most severe first</p>
          </div>
          <button ref={closeRef} className="reg-icon-btn reg-icon-btn-dark" onClick={onClose} aria-label="Close action plan"><X size={16} /></button>
        </div>
        <ol className="reg-modal-body">
          {findings.map(f => {
            const sev = SEVERITY[f.severity];
            return (
              <li key={f.id} className="reg-plan-item">
                <div className="reg-plan-title">
                  <span className="reg-sev" style={{ color: sev.color, background: sev.bg, borderColor: sev.border }}>{sev.label}</span>
                  {f.title}
                </div>
                <p>{f.remediation || 'No specific change was suggested; review the cited regulation.'}</p>
                <div className="reg-plan-law"><Scale size={11} /> {f.law.name}{lawLocation(f.law) && `, ${lawLocation(f.law)}`}</div>
              </li>
            );
          })}
        </ol>
        <div className="reg-modal-foot">
          <a className="btn btn-outline reg-btn-sm" href={reportUrl} download><Download size={13} /> Download report (.md)</a>
          <button className="btn btn-primary reg-btn-sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Empty state: drop zone + sample ─── */
function UploadZone({ onFile, onSample, disabled }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);
  return (
    <div
      className={`reg-dropzone ${dragOver ? 'drag' : ''}`}
      onDragOver={e => { e.preventDefault(); if (!disabled) setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); if (!disabled && e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); }}
    >
      <div className="reg-dropzone-icon"><Upload size={22} /></div>
      <h2>Upload a proposal to review</h2>
      <p>
        PetroSage checks it against the Indian offshore, environmental and oil &amp; gas regulations in the
        knowledge base and flags statements that conflict with them, with the exact law cited.
      </p>
      <div className="reg-dropzone-actions">
        <button className="btn btn-primary reg-btn-sm" onClick={() => inputRef.current?.click()} disabled={disabled}>
          <Upload size={13} /> Choose a file
        </button>
        <button className="btn btn-outline reg-btn-sm" onClick={onSample} disabled={disabled}>
          <FlaskConical size={13} /> Try the sample rig proposal
        </button>
      </div>
      <span className="reg-hint">or drag a file here &middot; PDF, Word (.docx), .txt or .md &middot; up to {MAX_MB} MB</span>
      <input ref={inputRef} type="file" accept={ACCEPTED.join(',')} className="reg-file-input" tabIndex={-1} aria-hidden="true"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
    </div>
  );
}

export default function Regulations() {
  const [docs, setDocs] = useState([]);
  const [docId, setDocId] = useState(readSavedDoc);
  const [data, setData] = useState(null);               // {document, analysis}
  const [pollKey, setPollKey] = useState(0);
  const [notice, setNotice] = useState(null);           // {type: 'error'|'info', text}
  const [upload, setUpload] = useState(null);           // {name, progress} while uploading
  const [busy, setBusy] = useState(null);               // label of a running action
  const [selectedId, setSelectedId] = useState(null);
  const [zoom, setZoom] = useState(100);
  const [lawSource, setLawSource] = useState(null);
  const [showPlan, setShowPlan] = useState(false);
  const uploadAbort = useRef(null);
  const headerInputRef = useRef(null);
  const sectionRefs = useRef({});

  const closePlan = useCallback(() => setShowPlan(false), []);

  const refreshList = useCallback(() => {
    getJson(`${API}/documents`).then(setDocs).catch(() => { /* list is a convenience; ignore */ });
  }, []);

  useEffect(() => { refreshList(); }, [refreshList]);

  // Load the open document and poll while its analysis is queued or running.
  useEffect(() => {
    if (!docId) return undefined;
    let cancelled = false;
    let timer;
    const load = () => {
      getJson(`${API}/documents/${docId}`)
        .then(d => {
          if (cancelled) return;
          setData(d);
          if (d.analysis.status === 'queued' || d.analysis.status === 'running') timer = setTimeout(load, 2000);
          else refreshList();
        })
        .catch(e => {
          if (cancelled) return;
          if (/not found/i.test(e.message)) {
            rememberDoc(null);
            setDocId(null);
            setData(null);
            setNotice({ type: 'info', text: 'That document has expired or was removed. Upload it again to review it.' });
          } else {
            setNotice({ type: 'error', text: `Could not load the document: ${e.message}` });
            timer = setTimeout(load, 5000);
          }
        });
    };
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [docId, pollKey, refreshList]);

  // Escape closes the law-source drawer.
  useEffect(() => {
    if (!lawSource) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setLawSource(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lawSource]);

  const openDoc = (id, initial = null) => {
    rememberDoc(id);
    setDocId(id);
    setData(initial);
    setSelectedId(null);
    setLawSource(null);
    setPollKey(k => k + 1);
  };

  const handleFile = async (file) => {
    setNotice(null);
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '';
    if (!ACCEPTED.includes(ext)) {
      setNotice({ type: 'error', text: `"${file.name}" is not supported. Upload a PDF, .docx, .txt or .md file.` });
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setNotice({ type: 'error', text: `"${file.name}" is ${formatSize(file.size)}. Files are limited to ${MAX_MB} MB.` });
      return;
    }
    if (file.size === 0) {
      setNotice({ type: 'error', text: `"${file.name}" is empty.` });
      return;
    }
    const controller = new AbortController();
    uploadAbort.current = controller;
    setUpload({ name: file.name, progress: 0 });
    try {
      const res = await uploadFile(`${API}/documents`, file, {
        signal: controller.signal,
        onProgress: p => setUpload(u => (u ? { ...u, progress: p } : u)),
      });
      openDoc(res.document.id, res);
      refreshList();
    } catch (e) {
      if (e.name !== 'AbortError') setNotice({ type: 'error', text: e.message });
    } finally {
      uploadAbort.current = null;
      setUpload(null);
    }
  };

  const runAction = async (label, fn) => {
    setBusy(label);
    setNotice(null);
    try { await fn(); } catch (e) { setNotice({ type: 'error', text: e.message }); } finally { setBusy(null); }
  };

  const loadSample = () => runAction('Loading the sample proposal…', async () => {
    const res = await sendRequest(`${API}/sample`);
    openDoc(res.document.id, res);
    refreshList();
  });

  const rerun = () => runAction('Starting analysis…', async () => {
    const analysis = await sendRequest(`${API}/documents/${docId}/analyze`);
    setData(d => ({ ...d, analysis }));
    setSelectedId(null);
    setPollKey(k => k + 1);
  });

  const removeDoc = () => runAction('Removing…', async () => {
    await sendRequest(`${API}/documents/${docId}`, 'DELETE');
    rememberDoc(null);
    setDocId(null);
    setData(null);
    setShowPlan(false);
    refreshList();
  });

  const selectFinding = (f) => {
    setSelectedId(f.id);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    sectionRefs.current[f.sectionId]?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  };

  const doc = data?.document;
  const analysis = data?.analysis;
  const status = analysis?.status;
  const findings = status === 'succeeded' ? analysis.findings : [];
  const counts = { high: 0, medium: 0, low: 0 };
  findings.forEach(f => { counts[f.severity] += 1; });
  const reportUrl = docId ? `${API}/documents/${docId}/report` : '#';
  const analyzing = status === 'queued' || status === 'running';

  const findingsBySection = {};
  findings.forEach(f => { (findingsBySection[f.sectionId] ||= []).push(f); });

  return (
    <div className="reg-page">
      {/* ─── Header ─── */}
      <div className="header reg-header">
        <div className="reg-title">
          <div className="reg-title-icon"><Scale size={18} /></div>
          <div>
            <h1>Oil &amp; Gas Regulatory Compliance Review</h1>
            <p>Checks proposals against the Indian maritime, MoEFCC environmental and oil &amp; gas laws in the knowledge base</p>
          </div>
        </div>
        <div className="reg-header-actions">
          {docs.length > 0 && (
            <select aria-label="Open a recent upload" value={docId || ''} onChange={e => e.target.value && openDoc(e.target.value)} className="reg-select">
              <option value="" disabled>Recent uploads</option>
              {docs.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}{d.status === 'succeeded' ? ` (${d.findings} finding${d.findings === 1 ? '' : 's'})` : d.status === 'failed' ? ' (failed)' : ' (analyzing)'}
                </option>
              ))}
            </select>
          )}
          {doc && (
            <button className="btn btn-outline reg-btn-sm" onClick={loadSample} disabled={!!upload || !!busy}>
              <FlaskConical size={13} /> Sample
            </button>
          )}
          <button className="btn btn-primary reg-btn-sm" onClick={() => headerInputRef.current?.click()} disabled={!!upload || !!busy}>
            <Upload size={13} /> Upload proposal
          </button>
          <input ref={headerInputRef} type="file" accept={ACCEPTED.join(',')} className="reg-file-input" tabIndex={-1} aria-hidden="true"
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleFile(f); }} />
        </div>
      </div>

      {/* ─── Status bar ─── */}
      <div aria-live="polite">
        {upload && (
          <div className="reg-statusbar">
            <Loader2 size={13} className="animate-spin" />
            <span>Uploading “{upload.name}”… {upload.progress}%</span>
            <div className="reg-progress" role="progressbar" aria-valuenow={upload.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
              <div style={{ width: `${upload.progress}%` }} />
            </div>
            <button className="reg-link-btn" onClick={() => uploadAbort.current?.abort()}>Cancel</button>
          </div>
        )}
        {busy && !upload && (
          <div className="reg-statusbar"><Loader2 size={13} className="animate-spin" /><span>{busy}</span></div>
        )}
        {notice && (
          <div className={`reg-statusbar ${notice.type === 'error' ? 'reg-statusbar-error' : ''}`} role={notice.type === 'error' ? 'alert' : 'status'}>
            <AlertCircle size={13} />
            <span style={{ flex: 1 }}>{notice.text}</span>
            <button className="reg-link-btn" onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={13} /></button>
          </div>
        )}
      </div>

      {!docId && <div className="reg-empty"><UploadZone onFile={handleFile} onSample={loadSample} disabled={!!upload || !!busy} /></div>}

      {docId && !doc && (
        <div className="reg-empty"><div className="reg-hint"><Loader2 size={16} className="animate-spin" /> Loading document…</div></div>
      )}

      {doc && (
        <div className="reg-split">
          {/* ════════ LEFT: the uploaded document ════════ */}
          <section className="reg-doc" aria-label="Uploaded document">
            <div className="reg-toolbar">
              <FileText size={15} style={{ color: 'var(--primary-color)', flexShrink: 0 }} />
              <span className="reg-doc-name" title={doc.name}>{doc.name}</span>
              <span className="reg-chip">{formatSize(doc.size)}</span>
              {doc.pageCount && <span className="reg-chip">{doc.pageCount} page{doc.pageCount === 1 ? '' : 's'}</span>}
              <div className="reg-toolbar-right">
                <button className="reg-icon-btn" onClick={() => setZoom(z => Math.max(ZOOM.min, z - ZOOM.step))} disabled={zoom <= ZOOM.min} aria-label="Zoom out" title="Zoom out"><ZoomOut size={13} /></button>
                <span className="reg-zoom">{zoom}%</span>
                <button className="reg-icon-btn" onClick={() => setZoom(z => Math.min(ZOOM.max, z + ZOOM.step))} disabled={zoom >= ZOOM.max} aria-label="Zoom in" title="Zoom in"><ZoomIn size={13} /></button>
                <a className="reg-icon-btn" href={`${API}/documents/${docId}/file`} download={doc.name} aria-label="Download original file" title="Download original file"><Download size={13} /></a>
              </div>
            </div>

            <div className="reg-canvas">
              <article className="reg-paper" style={{ fontSize: `${0.86 * zoom / 100}rem` }}>
                {doc.sections.map((s, i) => {
                  const sectionFindings = findingsBySection[s.id] || [];
                  const marks = sectionFindings.filter(f => f.quoteVerified).map(f => ({ id: f.id, start: f.start, end: f.end, severity: f.severity }));
                  const unpinned = sectionFindings.filter(f => !f.quoteVerified);
                  const newPage = s.page && s.page !== doc.sections[i - 1]?.page;
                  const isSelectedSection = sectionFindings.some(f => f.id === selectedId);
                  return (
                    <div key={s.id}>
                      {newPage && <div className="reg-page-break">Page {s.page}</div>}
                      <div
                        ref={el => { sectionRefs.current[s.id] = el; }}
                        className={`reg-section ${unpinned.length ? 'reg-section-flagged' : ''} ${isSelectedSection ? 'reg-section-selected' : ''}`}
                      >
                        {segmentsFor(s.text, marks).map((seg, j) => (seg.mark ? (
                          <mark
                            key={j}
                            className={`reg-mark reg-mark-${seg.mark.severity} ${seg.mark.ids.includes(selectedId) ? 'active' : ''}`}
                            onClick={() => setSelectedId(seg.mark.ids[0])}
                            title={seg.mark.ids.map(id => findings.find(f => f.id === id)?.title).join(' · ')}
                          >
                            {seg.text}
                          </mark>
                        ) : <span key={j}>{seg.text}</span>))}
                        {unpinned.length > 0 && (
                          <div className="reg-unpinned">⚠ {unpinned.map(f => f.title).join(' · ')} (exact wording not located)</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </article>
            </div>
          </section>

          {/* ════════ RIGHT: findings ════════ */}
          <section className="reg-report" aria-label="Compliance findings">
            <div className="reg-report-head">
              <Sparkles size={16} style={{ color: 'var(--primary-color)' }} />
              <h2>Compliance findings</h2>
              <div className="reg-toolbar-right">
                {status === 'succeeded' && findings.length > 0 && (
                  <button className="btn btn-primary reg-btn-sm" onClick={() => setShowPlan(true)}><FileCheck size={13} /> What to do now?</button>
                )}
                {status === 'succeeded' && (
                  <a className="reg-icon-btn" href={reportUrl} download aria-label="Download compliance report" title="Download report (.md)"><Download size={14} /></a>
                )}
                <button className="reg-icon-btn" onClick={rerun} disabled={analyzing || !!busy} aria-label="Run the analysis again" title={analyzing ? 'Analysis in progress' : 'Run again'}><RefreshCw size={14} /></button>
                <button className="reg-icon-btn" onClick={removeDoc} disabled={!!busy} aria-label="Remove this document" title="Remove document"><Trash2 size={14} /></button>
              </div>
            </div>

            <div className="reg-report-body" aria-live="polite">
              {analyzing && (
                <div className="reg-state">
                  <Loader2 size={22} className="animate-spin" style={{ color: 'var(--primary-color)' }} />
                  <strong>{status === 'queued' ? 'Waiting to start…' : 'Reviewing against the regulations…'}</strong>
                  <span>Matching each section to the relevant law passages and checking for conflicts. This usually takes 15–60 seconds.</span>
                </div>
              )}

              {status === 'failed' && (
                <div className="reg-state reg-state-error" role="alert">
                  <AlertCircle size={22} />
                  <strong>The review could not be completed</strong>
                  <span>{analysis.error}</span>
                  <button className="btn btn-primary reg-btn-sm" onClick={rerun} disabled={!!busy}><RefreshCw size={13} /> Retry</button>
                </div>
              )}

              {status === 'succeeded' && (
                <>
                  <div className="reg-summary">
                    <div className={`reg-summary-icon ${findings.length ? 'bad' : 'ok'}`}>
                      {findings.length ? <ShieldAlert size={16} /> : <ShieldCheck size={16} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3>
                        {findings.length
                          ? `${findings.length} potential issue${findings.length === 1 ? '' : 's'} flagged`
                          : 'No conflicts found with the indexed regulations'}
                      </h3>
                      {findings.length > 0 && (
                        <div className="reg-counts">
                          {Object.entries(counts).filter(([, n]) => n).map(([sev, n]) => (
                            <span key={sev} className="reg-sev" style={{ color: SEVERITY[sev].color, background: SEVERITY[sev].bg, borderColor: SEVERITY[sev].border }}>
                              {n} {SEVERITY[sev].label}
                            </span>
                          ))}
                        </div>
                      )}
                      {analysis.summary && <p>{analysis.summary}</p>}
                      <p className="reg-meta">Checked against: {analysis.lawSources.join(', ')}</p>
                      {analysis.truncated && (
                        <p className="reg-meta reg-warn">Only the first {analysis.analyzedSections} of {analysis.totalSections} sections were reviewed; the document is longer than one review covers.</p>
                      )}
                    </div>
                  </div>

                  {findings.map(f => {
                    const sev = SEVERITY[f.severity];
                    const selected = f.id === selectedId;
                    return (
                      <article key={f.id} className={`reg-finding ${selected ? 'selected' : ''}`} style={selected ? { borderColor: sev.color } : undefined}>
                        <div className="reg-finding-top">
                          <span className="reg-sev" style={{ color: sev.color, background: sev.bg, borderColor: sev.border }}>
                            <AlertTriangle size={11} /> {sev.label}
                          </span>
                          <button className="reg-link-btn" onClick={() => selectFinding(f)}>
                            <Eye size={12} /> Show in document ({sectionLabel(f)})
                          </button>
                        </div>
                        <h3>{f.title}</h3>
                        <blockquote>“{f.quote}”</blockquote>
                        <div className="reg-law">
                          <div className="reg-law-head">
                            <Scale size={12} />
                            <span>{f.law.name}{lawLocation(f.law) && `, ${lawLocation(f.law)}`}</span>
                            {f.law.sourceId && (
                              <button className="reg-link-btn" onClick={() => setLawSource(lawAsSource(f))}>
                                <ExternalLink size={11} /> Open source
                              </button>
                            )}
                          </div>
                          <p>{f.law.text}</p>
                        </div>
                        {f.explanation && <p className="reg-text"><strong>Why: </strong>{f.explanation}</p>}
                        {f.remediation && <p className="reg-text"><strong>Recommended change: </strong>{f.remediation}</p>}
                      </article>
                    );
                  })}

                  <div className="reg-disclaimer">
                    <BookOpen size={14} style={{ color: 'var(--primary-color)', flexShrink: 0 }} />
                    <span>{analysis.disclaimer}</span>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      )}

      {lawSource && (
        <div className="reg-drawer">
          <DocViewer key={lawSource.id} source={lawSource} onClose={() => setLawSource(null)} />
        </div>
      )}

      {showPlan && (
        <ActionPlanModal findings={findings} reportUrl={reportUrl} onClose={closePlan} />
      )}
    </div>
  );
}

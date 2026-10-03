import { useCallback, useEffect, useState } from 'react';
import { Settings as SettingsIcon, RefreshCw, CheckCircle2, XCircle, Loader2, Save, RotateCcw } from 'lucide-react';
import { getJson } from '../api';
import {
  DEFAULT_SETTINGS, JURISDICTIONS, TIMEOUT_LIMITS,
  loadSettings, saveSettings, resetSettings, validateSettings,
} from '../settings';

function StatusRow({ label, ok, okText = 'OK', badText = 'Unavailable', hint }) {
  return (
    <div className="settings-row">
      <span>{label}</span>
      <span className={`settings-status ${ok ? 'ok' : 'bad'}`}>
        {ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
        {ok ? okText : badText}
      </span>
      {!ok && hint && <div className="settings-hint">{hint}</div>}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="settings-row">
      <span>{label}</span>
      <code className="settings-value">{value ?? 'Unknown'}</code>
    </div>
  );
}

export default function Settings() {
  const [health, setHealth] = useState(null);
  const [config, setConfig] = useState(null);
  const [serverError, setServerError] = useState(null);
  const [checking, setChecking] = useState(true);

  const [prefs, setPrefs] = useState(loadSettings);
  const [saved, setSaved] = useState(loadSettings);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null); // {type: 'ok'|'error', text}

  const fetchServerState = useCallback(() => (
    Promise.all([getJson('/api/health'), getJson('/api/config/public')])
      .then(([h, c]) => { setHealth(h); setConfig(c); setServerError(null); })
      .catch(e => { setHealth(null); setConfig(null); setServerError(e.message); })
      .finally(() => setChecking(false))
  ), []);

  useEffect(() => { fetchServerState(); }, [fetchServerState]);

  const checkServer = () => {
    setChecking(true);
    fetchServerState();
  };

  const dirty = JSON.stringify(prefs) !== JSON.stringify(saved);

  const update = (field, value) => {
    setPrefs(p => ({ ...p, [field]: value }));
    setNotice(null);
    setErrors(e => ({ ...e, [field]: undefined }));
  };

  const handleSave = (e) => {
    e.preventDefault();
    const next = { ...prefs, requestTimeoutSec: Number(prefs.requestTimeoutSec) };
    const found = validateSettings(next);
    setErrors(found);
    if (Object.keys(found).length) {
      setNotice({ type: 'error', text: 'Fix the highlighted fields before saving.' });
      return;
    }
    if (!saveSettings(next)) {
      setNotice({ type: 'error', text: 'Could not save: this browser is blocking local storage.' });
      return;
    }
    setPrefs(next);
    setSaved(next);
    setNotice({ type: 'ok', text: 'Preferences saved. They apply to your next question.' });
  };

  const handleReset = () => {
    if (!resetSettings()) {
      setNotice({ type: 'error', text: 'Could not reset: this browser is blocking local storage.' });
      return;
    }
    setPrefs(DEFAULT_SETTINGS);
    setSaved(DEFAULT_SETTINGS);
    setErrors({});
    setNotice({ type: 'ok', text: 'Preferences reset to defaults.' });
  };

  const allOk = health && health.devdb && health.snapshot && health.groq_key_configured;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="header justify-between">
        <div className="font-semibold flex items-center gap-2">
          <SettingsIcon size={18} className="text-primary" />
          Settings
        </div>
      </div>

      <div className="settings-page">
        {/* ── Connection status ── */}
        <section className="card settings-card" aria-labelledby="status-heading">
          <div className="settings-card-head">
            <h2 id="status-heading">Connection status</h2>
            <button className="btn btn-outline settings-small-btn" onClick={checkServer} disabled={checking}>
              {checking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              {checking ? 'Checking…' : 'Check again'}
            </button>
          </div>
          <div aria-live="polite">
            {checking && !health && !serverError && <div className="settings-hint">Checking the API server…</div>}
            {serverError && (
              <StatusRow label="API server" ok={false} badText="Unreachable" hint={serverError} />
            )}
            {health && (
              <>
                <StatusRow label="API server" ok okText="Running" />
                <StatusRow label="DevDB vector database" ok={health.devdb} okText="Connected" badText="Not reachable"
                  hint="Start it with: cd db/DevDB && make serve" />
                <StatusRow label="Search index (snapshot)" ok={health.snapshot} okText="Present" badText="Missing"
                  hint="Build it with: python ingest.py" />
                <StatusRow label="Groq API key" ok={health.groq_key_configured} okText="Configured" badText="Not set"
                  hint="Set GROQ_API_KEY in the .env file at the repo root, then restart the API." />
                <StatusRow label="RAG pipeline" ok={health.pipeline_loaded} okText="Loaded" badText="Not loaded yet"
                  hint={allOk ? 'It loads on the first question.' : 'It loads once DevDB, the index and the API key are available.'} />
              </>
            )}
          </div>
        </section>

        {/* ── Server configuration (read-only) ── */}
        <section className="card settings-card" aria-labelledby="ai-heading">
          <div className="settings-card-head">
            <h2 id="ai-heading">AI configuration</h2>
            <span className="badge badge-secondary">Read-only</span>
          </div>
          <p className="settings-hint" style={{ marginBottom: '0.6rem' }}>
            These are set on the server (<code>core/config.py</code> and <code>.env</code>) and need an API restart to change.
          </p>
          {config ? (
            <>
              <InfoRow label="Provider" value={config.provider} />
              <InfoRow label="Answer model" value={config.model} />
              <InfoRow label="Relevance check model (CRAG)" value={config.cragModel} />
              <InfoRow label="Embedding model" value={config.embedModel} />
              <InfoRow label="Vector backend" value={config.vectorBackend} />
              <InfoRow label="Indexed chunks" value={config.index?.chunks?.toLocaleString()} />
              <InfoRow label="Candidates per query / kept after re-rank" value={`${config.retrieval.topK} / ${config.retrieval.mmrK}`} />
              <InfoRow label="Minimum relevance score" value={config.retrieval.minScore} />
              <InfoRow label="Relevance vs. diversity (MMR λ)" value={config.retrieval.mmrLambda} />
              <InfoRow label="Max question length" value={`${config.maxQueryLength} characters`} />
            </>
          ) : (
            <div className="settings-hint">{checking ? 'Loading…' : 'Unavailable while the API server is unreachable.'}</div>
          )}
        </section>

        {/* ── User preferences ── */}
        <section className="card settings-card" aria-labelledby="prefs-heading">
          <div className="settings-card-head">
            <h2 id="prefs-heading">Your preferences</h2>
            <span className="badge badge-secondary">Saved in this browser</span>
          </div>
          <form onSubmit={handleSave} noValidate>
            <div className="settings-field">
              <label htmlFor="pref-jurisdiction">Default jurisdiction</label>
              <select id="pref-jurisdiction" value={prefs.defaultJurisdiction}
                onChange={e => update('defaultJurisdiction', e.target.value)}
                aria-invalid={!!errors.defaultJurisdiction} aria-describedby="pref-jurisdiction-help">
                {Object.keys(JURISDICTIONS).map(j => <option key={j} value={j}>{j}</option>)}
              </select>
              <div id="pref-jurisdiction-help" className="settings-hint">
                {errors.defaultJurisdiction || 'Pre-selected on Market & Asset Search when the page opens.'}
              </div>
            </div>

            <div className="settings-field">
              <label className="settings-check">
                <input type="checkbox" checked={prefs.allowGeneralAnswers}
                  onChange={e => update('allowGeneralAnswers', e.target.checked)}
                  aria-describedby="pref-general-help" />
                Answer from general AI knowledge when the documents don't cover a question
              </label>
              <div id="pref-general-help" className="settings-hint">
                When off, questions the indexed data can't answer get "not found" instead. General answers have no citations.
              </div>
            </div>

            <div className="settings-field">
              <label htmlFor="pref-timeout">Request timeout (seconds)</label>
              <input id="pref-timeout" type="number" inputMode="numeric"
                min={TIMEOUT_LIMITS.min} max={TIMEOUT_LIMITS.max} step={1}
                value={prefs.requestTimeoutSec}
                onChange={e => update('requestTimeoutSec', e.target.value)}
                aria-invalid={!!errors.requestTimeoutSec} aria-describedby="pref-timeout-help" />
              <div id="pref-timeout-help" className={`settings-hint ${errors.requestTimeoutSec ? 'settings-error' : ''}`}>
                {errors.requestTimeoutSec || `How long to wait for an AI answer before giving up (${TIMEOUT_LIMITS.min}–${TIMEOUT_LIMITS.max}).`}
              </div>
            </div>

            <div className="settings-actions">
              <button type="submit" className="btn btn-primary settings-small-btn" disabled={!dirty}>
                <Save size={13} /> Save
              </button>
              <button type="button" className="btn btn-outline settings-small-btn" onClick={handleReset}>
                <RotateCcw size={13} /> Reset to defaults
              </button>
              {dirty && !notice && <span className="settings-hint">Unsaved changes</span>}
              {notice && (
                <span role={notice.type === 'error' ? 'alert' : 'status'} className={`settings-hint ${notice.type === 'error' ? 'settings-error' : 'settings-ok'}`}>
                  {notice.text}
                </span>
              )}
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}

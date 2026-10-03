import { useEffect, useMemo, useState } from 'react';
import { FileText, FileSpreadsheet, File, Download, Eye, Loader2, AlertCircle, RefreshCw, Search } from 'lucide-react';
import { getJson } from '../api';
import DocViewer from '../DocViewer';

const KIND_LABELS = { pdf: 'PDF', spreadsheet: 'Spreadsheet', csv: 'CSV', text: 'Text' };

function KindIcon({ kind }) {
  const Icon = kind === 'pdf' ? FileText : kind === 'text' ? File : FileSpreadsheet;
  return <Icon size={20} className="text-primary" style={{ flexShrink: 0 }} />;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function countBy(docs, key) {
  const counts = {};
  docs.forEach(d => { const k = d[key] || 'Other'; counts[k] = (counts[k] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function FilterGroup({ title, options, value, onChange, label = k => k }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-semibold mb-1">{title}</div>
      <div className="doclib-filters">
        <button className={`doclib-chip ${value === null ? 'active' : ''}`} onClick={() => onChange(null)}>All</button>
        {options.map(([k, n]) => (
          <button key={k} className={`doclib-chip ${value === k ? 'active' : ''}`} onClick={() => onChange(value === k ? null : k)}>
            {label(k)} <span className="doclib-chip-count">{n}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function DataExtraction() {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState(null);
  const [region, setRegion] = useState(null);
  const [viewing, setViewing] = useState(null);

  const fetchDocs = () => (
    getJson('/api/sources')
      .then(d => { setDocs(d); setError(null); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  );

  useEffect(() => { fetchDocs(); }, []);

  const retry = () => {
    setLoading(true);
    fetchDocs();
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (docs || []).filter(d =>
      (!kind || d.kind === kind) &&
      (!region || (d.country || 'Other') === region) &&
      (!q || `${d.name} ${d.folder}`.toLowerCase().includes(q))
    );
  }, [docs, query, kind, region]);

  const totals = useMemo(() => (docs || []).reduce(
    (t, d) => ({ chunks: t.chunks + d.chunks, size: t.size + d.sizeBytes }), { chunks: 0, size: 0 }
  ), [docs]);

  const openViewer = (d) => setViewing({
    id: d.sourceId, sourceId: d.sourceId, name: d.name, country: d.country,
    unit: 'pg.', pages: [1], excerpts: [],
  });

  return (
    <div className="flex flex-col" style={{ height: '100%' }}>
      <div className="header">
        Structured Data Extraction (Oil & Gas Reports)
      </div>

      <div className="content-area animate-fade-in">
        <div className="secondary-sidebar">
          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold mb-1">Indexed library</div>
            <div className="flex justify-between text-sm">
              <span className="text-medium">Documents</span>
              <span>{docs ? docs.length : '–'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-medium">Chunks indexed</span>
              <span>{docs ? totals.chunks.toLocaleString() : '–'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-medium">Total size</span>
              <span>{docs ? formatSize(totals.size) : '–'}</span>
            </div>
          </div>

          {docs && docs.length > 0 && (
            <>
              <FilterGroup title="File type" options={countBy(docs, 'kind')} value={kind} onChange={setKind} label={k => KIND_LABELS[k] || k} />
              <FilterGroup title="Region / dataset" options={countBy(docs, 'country')} value={region} onChange={setRegion} />
            </>
          )}
        </div>

        <div className="main-panel card doclib-panel">
          <div className="doclib-list">
            <div className="doclib-toolbar">
              <div className="doclib-search">
                <Search size={14} className="text-medium" />
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search documents by name or folder…"
                  aria-label="Search documents"
                />
              </div>
              {docs && (
                <span className="text-xs text-medium">
                  {filtered.length === docs.length ? `${docs.length} documents` : `${filtered.length} of ${docs.length} documents`}
                </span>
              )}
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading && !docs && (
                <div className="doclib-msg"><Loader2 size={16} className="animate-spin" /> Loading documents…</div>
              )}
              {error && (
                <div className="doclib-msg" role="alert">
                  <AlertCircle size={16} style={{ color: 'var(--danger-color)' }} />
                  <span>{error}</span>
                  <button className="btn btn-outline doclib-btn" onClick={retry} disabled={loading}><RefreshCw size={13} /> Retry</button>
                </div>
              )}
              {docs && filtered.length === 0 && (
                <div className="doclib-msg">{docs.length ? 'No documents match your filters.' : 'No documents are indexed yet. Run python ingest.py.'}</div>
              )}

              {filtered.map(d => (
                <div key={d.sourceId} className={`doclib-row ${viewing?.sourceId === d.sourceId ? 'active' : ''}`}>
                  <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
                    <KindIcon kind={d.kind} />
                    <div style={{ minWidth: 0 }}>
                      <div className="font-semibold text-sm doclib-name" title={d.name}>{d.name}</div>
                      <div className="text-xs text-medium flex gap-2 mt-1 items-center" style={{ flexWrap: 'wrap' }}>
                        <span>Manual_data/{d.folder ? `${d.folder}/` : ''}</span>
                        <span className="badge badge-secondary">{KIND_LABELS[d.kind] || d.kind}</span>
                        {d.country && <span className="badge badge-secondary">{d.country}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4" style={{ flexShrink: 0 }}>
                    <span className="text-xs text-medium doclib-meta">
                      {d.chunks.toLocaleString()} chunks
                      {d.pageCount ? ` · ${d.pageCount} pages` : ''}
                      {` · ${formatSize(d.sizeBytes)}`}
                    </span>
                    {d.kind === 'pdf' && (
                      <button className="btn btn-outline doclib-btn" onClick={() => openViewer(d)}>
                        <Eye size={14} /> View
                      </button>
                    )}
                    <a className="btn btn-outline doclib-btn" href={`/api/sources/${d.sourceId}/file`} download={d.name}>
                      <Download size={14} /> Download
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {viewing && (
            <DocViewer key={viewing.sourceId} source={viewing} onClose={() => setViewing(null)} />
          )}
        </div>
      </div>
    </div>
  );
}

export default DataExtraction;

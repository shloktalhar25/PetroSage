import { useEffect, useState } from 'react';
import { FileText, X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Download, Loader2, AlertCircle } from 'lucide-react';
import { getJson } from './api';

const ZOOM = { min: 50, max: 300, step: 25 };

function excerptLabel(ex) {
  if (ex.page) return `Page ${ex.page}`;
  if (ex.row) return ex.sheet ? `${ex.sheet}, row ${ex.row}` : `Row ${ex.row}`;
  return 'Passage';
}

/*
 * Shows a cited source exactly as indexed: PDF pages are rendered by the API from the
 * real file (cited passages highlighted); spreadsheets, CSVs and text files show the
 * retrieved rows/paragraphs. `source` is one entry of a RAG response's `sources`.
 */
export default function DocViewer({ source, onClose }) {
  const sourceId = source.sourceId;
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(sourceId ? null : 'This citation has no linked source file.');
  const [page, setPage] = useState(source.unit === 'pg.' && source.pages[0] ? source.pages[0] : 1);
  const [zoom, setZoom] = useState(100);
  const [imgState, setImgState] = useState('loading'); // loading | ready | error

  useEffect(() => {
    if (!sourceId) return undefined;
    let current = true;
    getJson(`/api/sources/${sourceId}`)
      .then(d => { if (current) setInfo(d); })
      .catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [sourceId]);

  const isPdf = info?.kind === 'pdf';
  const pageCount = info?.pageCount || 0;
  const excerpts = source.excerpts || [];
  const pageExcerpts = isPdf ? excerpts.filter(ex => ex.page === page) : excerpts;
  const citedPages = isPdf ? [...new Set(excerpts.map(ex => ex.page).filter(Boolean))].sort((a, b) => a - b) : [];
  const hl = pageExcerpts.map(ex => ex.chunkId).join(',');
  const pageUrl = `/api/sources/${sourceId}/pages/${page}.png?zoom=2&hl=${encodeURIComponent(hl)}`;

  const goTo = (n) => {
    const next = Math.min(Math.max(n, 1), pageCount);
    if (next !== page) { setPage(next); setImgState('loading'); }
  };

  return (
    <div className="doc-viewer animate-fade-in" onClick={e => e.stopPropagation()} role="region" aria-label={`Source: ${source.name}`}>
      <div className="doc-viewer-header">
        <FileText size={14} className="text-primary" style={{ flexShrink: 0 }} />
        <span className="text-sm font-semibold" title={source.name} style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {source.name}
        </span>
        <button onClick={onClose} className="icon-btn" aria-label="Close document viewer" title="Close"><X size={15} /></button>
      </div>

      <div className="doc-viewer-nav">
        {isPdf && (
          <>
            <button className="icon-btn" onClick={() => goTo(page - 1)} disabled={page <= 1} aria-label="Previous page" title="Previous page"><ChevronLeft size={14} /></button>
            <span className="text-xs" aria-live="polite">Page {page} / {pageCount}</span>
            <button className="icon-btn" onClick={() => goTo(page + 1)} disabled={page >= pageCount} aria-label="Next page" title="Next page"><ChevronRight size={14} /></button>
          </>
        )}
        {!isPdf && info && <span className="text-xs">{info.kind === 'text' ? 'Text file' : info.kind === 'csv' ? 'CSV file' : 'Spreadsheet'} &middot; {source.country}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
          {isPdf && (
            <>
              <button className="icon-btn" onClick={() => setZoom(z => Math.max(ZOOM.min, z - ZOOM.step))} disabled={zoom <= ZOOM.min} aria-label="Zoom out" title="Zoom out"><ZoomOut size={13} /></button>
              <span className="text-xs" style={{ minWidth: 34, textAlign: 'center' }}>{zoom}%</span>
              <button className="icon-btn" onClick={() => setZoom(z => Math.min(ZOOM.max, z + ZOOM.step))} disabled={zoom >= ZOOM.max} aria-label="Zoom in" title="Zoom in"><ZoomIn size={13} /></button>
            </>
          )}
          {info && (
            <a className="icon-btn" href={`/api/sources/${sourceId}/file`} download={info.name} aria-label={`Download ${info.name}`} title="Download original file">
              <Download size={13} />
            </a>
          )}
        </div>
      </div>

      {citedPages.length > 0 && (
        <div className="doc-viewer-badge" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          Cited on:
          {citedPages.map(p => (
            <button key={p} className={`doc-page-chip ${p === page ? 'active' : ''}`} onClick={() => goTo(p)}>pg. {p}</button>
          ))}
        </div>
      )}

      <div className="doc-viewer-body" style={{ overflowY: 'auto', background: '#f1f5f9', padding: '0.75rem' }}>
        {error && (
          <div className="doc-viewer-msg" role="alert">
            <AlertCircle size={16} style={{ color: 'var(--danger-color)', flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}
        {!error && !info && (
          <div className="doc-viewer-msg"><Loader2 size={16} className="animate-spin" /> Loading source…</div>
        )}

        {isPdf && (
          <div style={{ overflowX: 'auto', marginBottom: '0.75rem' }}>
            {imgState === 'loading' && <div className="doc-viewer-msg"><Loader2 size={16} className="animate-spin" /> Rendering page {page}…</div>}
            {imgState === 'error' && <div className="doc-viewer-msg" role="alert"><AlertCircle size={16} /> Could not render page {page}.</div>}
            <img
              key={pageUrl}
              src={pageUrl}
              alt={`${source.name}, page ${page}`}
              onLoad={() => setImgState('ready')}
              onError={() => setImgState('error')}
              style={{ width: `${zoom}%`, maxWidth: 'none', display: imgState === 'ready' ? 'block' : 'none', background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', border: '1px solid #cbd5e1' }}
            />
          </div>
        )}

        {info && pageExcerpts.length > 0 && (
          <div>
            <div className="doc-excerpt-title">{isPdf ? `Cited passage${pageExcerpts.length > 1 ? 's' : ''} on this page` : 'Cited passages'}</div>
            {pageExcerpts.map(ex => (
              <div key={ex.chunkId} className="doc-excerpt">
                <div className="doc-excerpt-loc">{excerptLabel(ex)}</div>
                <p>{ex.text}</p>
              </div>
            ))}
          </div>
        )}
        {info && isPdf && pageExcerpts.length === 0 && (
          <div className="text-xs text-light" style={{ textAlign: 'center' }}>No cited passages on this page.</div>
        )}
      </div>
    </div>
  );
}

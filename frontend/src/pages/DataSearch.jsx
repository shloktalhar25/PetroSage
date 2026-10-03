import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { postQuery, errorAnswer } from '../api';
import { JURISDICTIONS, loadSettings } from '../settings';
import Markdown from '../Markdown';
import DocViewer from '../DocViewer';
import {
  Search, Bookmark, BookmarkCheck, CheckCircle2, MapPin, Calendar,
  Sparkles, Send, Loader2, FileText, ChevronDown,
  File, Flame, Globe, ScrollText, ShieldCheck, Layers
} from 'lucide-react';

/* ─── Oil & Gas Domain Data ──────────────────────────────────── */
const RESULTS = [
  {
    id: 'PSC-NELP-IX-KG-DWN-2009',
    type: 'Production Sharing Contract',
    typeBadge: 'PSC',
    title: 'KG-DWN-98/2 Block — Deepwater Production Sharing Contract',
    description: 'Production Sharing Contract for the KG-DWN-98/2 deepwater block in the Krishna-Godavari Basin. Covers exploration, development and production of crude oil and natural gas. Government of India (MoPNG) and Operator: Reliance Industries Ltd. Contract period: 25 years with profit-sharing milestones defined post cost recovery.',
    region: 'Krishna-Godavari Basin, India',
    docType: 'Contract',
    date: '14/04/2000',
    status: 'Active',
    relevance: 'Highly Relevant',
    saved: false,
  },
  {
    id: 'LAW-OILFIELDS-REG-1948',
    type: 'Legislation',
    typeBadge: 'Law',
    title: 'Oilfields (Regulation and Development) Act, 1948',
    description: 'Central legislation governing regulation and development of oilfields across India. Provides for the grant of mining leases for mineral oils, and for the regulation of mining operations thereunder. Amended multiple times to include provisions for natural gas, deep-sea exploration, and unconventional hydrocarbons.',
    region: 'Pan-India',
    docType: 'Legislation',
    date: '08/09/1948',
    status: 'In Force',
    relevance: 'Highly Relevant',
    saved: true,
  },
  {
    id: 'REG-PNGRB-CGD-2008',
    type: 'Regulation',
    typeBadge: 'Regulation',
    title: 'PNGRB (Authorizing Entities to Lay, Build, Operate CGD Networks) Regulations, 2008',
    description: 'Petroleum and Natural Gas Regulatory Board regulations governing City Gas Distribution networks. Specifies criteria for authorization, technical standards, tariff determination, and consumer protection mechanisms for PNG and CNG supply in geographic areas.',
    region: 'All India CGD Zones',
    docType: 'Regulation',
    date: '01/04/2008',
    status: 'In Force',
    relevance: 'Relevant',
    saved: false,
  },
  {
    id: 'AREA-BLOCK-AA-ONN-2004',
    type: 'Exploration Block',
    typeBadge: 'Block',
    title: 'AA-ONN-2004/1 — Assam-Arakan Onshore Exploration Block',
    description: 'NELP-VI onshore exploration block in the Assam-Arakan fold-belt basin. Geological surveys indicate Eocene and Oligocene sandstone reservoirs. Block operator: Oil India Limited. Work programme commitments include 2D seismic (500 LKM) and 3 exploratory wells. Estimated prospective resources: 8 MMboe.',
    region: 'Assam, India',
    docType: 'Block Data',
    date: '15/03/2005',
    status: 'Exploration Phase',
    relevance: 'Highly Relevant',
    saved: false,
  },
];

/* ─── Citation inline component ─────────────────────────────── */
function Citation({ ids, onClick }) {
  return (
    <button className="citation-btn" onClick={onClick}>
      [{ids.join(', ')}]
    </button>
  );
}

/* ─── Status badge color ─────────────────────────────────────── */
function statusClass(s) {
  if (s === 'Active' || s === 'In Force') return 'badge-success';
  if (s === 'Exploration Phase') return 'badge-warning';
  return 'badge-secondary';
}

/* ─── Type icon ──────────────────────────────────────────────── */
function TypeIcon({ type }) {
  const map = { Law: ScrollText, Regulation: ShieldCheck, Block: Layers, PSC: Flame, Contract: FileText };
  const Icon = map[type] || FileText;
  return <Icon size={14} />;
}

/* ─── Main Component ─────────────────────────────────────────── */
export default function DataSearch() {
  const [activeTab, setActiveTab] = useState('AI Search');
  const [savedItems, setSavedItems] = useState(new Set(['LAW-OILFIELDS-REG-1948']));
  const [filters, setFilters] = useState({});
  const [searchQ, setSearchQ] = useState('');
  const [aiQuery, setAiQuery] = useState('');
  const [jurisdiction, setJurisdiction] = useState(() => loadSettings().defaultJurisdiction);
  const navigate = useNavigate();
  const [isSearching, setIsSearching] = useState(false);
  const [aiMessages, setAiMessages] = useState([]);
  const [citationPopup, setCitationPopup] = useState(null);
  const [docViewer, setDocViewer] = useState(null);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiMessages, isSearching]);

  const toggleBookmark = (id) => {
    const n = new Set(savedItems);
    n.has(id) ? n.delete(id) : n.add(id);
    setSavedItems(n);
  };

  const toggleFilter = (key) => setFilters(p => ({ ...p, [key]: !p[key] }));

  const handleAiSearch = (e, overrideQuery) => {
    e?.preventDefault();
    const q = overrideQuery || aiQuery;
    if (!q.trim()) return;
    setAiQuery('');
    setAiMessages(prev => [...prev, { role: 'user', text: q }]);
    setIsSearching(true);

    postQuery('/api/rag', q, JURISDICTIONS[jurisdiction])
      .catch(errorAnswer)
      .then(answer => {
        setAiMessages(prev => [...prev, { role: 'assistant', ...answer }]);
        setIsSearching(false);
      });
  };

  const handleCitationClick = (e, ids, sources) => {
    e.stopPropagation();
    const rect = e.target.getBoundingClientRect();
    setCitationPopup(prev =>
      prev && JSON.stringify(prev.ids) === JSON.stringify(ids)
        ? null
        : { ids, sources, x: rect.left, y: rect.bottom + 8 }
    );
  };

  const openDocViewer = (src) => {
    setCitationPopup(null);
    setDocViewer(src);
  };

  const filteredResults = RESULTS.filter(r => {
    if (activeTab === 'Saved') return savedItems.has(r.id);
    if (searchQ) {
      const q = searchQ.toLowerCase();
      return r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) || r.region.toLowerCase().includes(q);
    }
    return true;
  });

  /* ── Render AI message ── */
  const renderAssistantMessage = (msg) => (
    <div className="ai-answer animate-fade-in">
      <div className="ai-answer-header">
        <Sparkles size={15} className="text-primary" />
        <span className="font-semibold text-sm">AI Analysis</span>
      </div>

      {msg.paragraphs?.map((p, pi) => (
        <div key={pi} className="ai-text" style={{ marginTop: pi > 0 ? '0.85rem' : 0 }}>
          <Markdown>{p.text}</Markdown>
          {p.citeIds?.length > 0 && (
            <Citation ids={p.citeIds} onClick={(e) => handleCitationClick(e, p.citeIds, msg.sources)} />
          )}
        </div>
      ))}

      <div className="ai-meta">
        <span>{msg.meta?.time}</span>
        <span className="ai-meta-link" onClick={(e) => handleCitationClick(e, (msg.sources || []).map(s => s.id), msg.sources)}>
          Citations +{msg.meta?.citations}
        </span>
        
      </div>
    </div>
  );

  /* ── JSX ── */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }} onClick={() => setCitationPopup(null)}>

      {/* Header */}
      <div className="header justify-between">
        <div className="font-semibold flex items-center gap-2">
          <Flame size={18} className="text-primary" />
          Oil &amp; Gas Intelligence Search
        </div>
        <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => navigate('/settings')}>
          <Sparkles size={14} /> Manage AI Config
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Left Filters Sidebar ── */}
        <div className="filters-sidebar">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <span className="font-semibold text-sm">Filters</span>
            <span className="text-xs text-primary" style={{ cursor: 'pointer' }} onClick={() => { setFilters({}); setJurisdiction('All'); }}>Clear</span>
          </div>

          {/* Document Type */}
          <div className="filter-section">
            <div className="filter-title">Document Type</div>
            {[
              ['PSC', 'Production Sharing Contract'],
              ['RSC', 'Revenue Sharing Contract'],
              ['LAW', 'Legislation / Act'],
              ['REG', 'Regulation / Policy'],
              ['BLOCK', 'Exploration Block Data'],
              ['FIELD', 'Field Development Plan'],
              ['EIA', 'Environmental Impact Report'],
            ].map(([key, label]) => (
              <label key={key} className="filter-check">
                <input type="checkbox" checked={!!filters[key]} onChange={() => toggleFilter(key)} />
                {label}
              </label>
            ))}
          </div>

          {/* Basin / Area */}
          <div className="filter-section">
            <div className="filter-title">Basin / Area</div>
            {[
              'Krishna-Godavari Basin',
              'Cambay Basin',
              'Assam-Arakan Basin',
              'Mumbai Offshore',
              'Rajasthan Basin',
              'North Sea',
              'Persian Gulf',
            ].map(area => (
              <label key={area} className="filter-check">
                <input type="checkbox" checked={!!filters[area]} onChange={() => toggleFilter(area)} />
                {area}
              </label>
            ))}
          </div>

          {/* Jurisdiction */}
          <div className="filter-section">
            <div className="filter-title">Jurisdiction</div>
            {Object.keys(JURISDICTIONS).map(j => (
              <label key={j} className="filter-check">
                <input type="radio" name="jurisdiction" checked={jurisdiction === j} onChange={() => setJurisdiction(j)} />
                {j}
              </label>
            ))}
          </div>

          {/* Status */}
          <div className="filter-section">
            <div className="filter-title">Status</div>
            {['In Force', 'Active', 'Exploration Phase', 'Lapsed', 'Under Review'].map(s => (
              <label key={s} className="filter-check">
                <input type="checkbox" checked={!!filters[s]} onChange={() => toggleFilter(s)} />
                {s}
              </label>
            ))}
          </div>
        </div>

        {/* ── Main Area ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Tab + search bar row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 1.25rem', borderBottom: '1px solid var(--border-color)', background: 'var(--surface-color)' }}>
            {activeTab !== 'AI Search' && (
              <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-medium)' }} />
                <input
                  type="text"
                  value={searchQ}
                  onChange={e => setSearchQ(e.target.value)}
                  placeholder="Search laws, contracts, blocks..."
                  className="input-control"
                  style={{ paddingLeft: '2.2rem', width: '100%', fontSize: '0.82rem' }}
                />
              </div>
            )}
            <div style={{ display: 'flex', gap: 0, marginLeft: 'auto' }}>
              {['All Documents', 'Saved', 'AI Search'].map(t => (
                <button
                  key={t}
                  onClick={() => setActiveTab(t)}
                  className={`search-tab ${activeTab === t ? 'search-tab-active' : ''}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  {t === 'AI Search' && <Sparkles size={12} />}
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* ── AI Search Tab ── */}
          {activeTab === 'AI Search' ? (
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              {/* Chat panel */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 2rem' }}>

                  {/* Empty / Welcome state */}
                  {aiMessages.length === 0 && !isSearching && (
                    <div className="rag-empty">
                      <div className="rag-empty-icon"><Flame size={26} /></div>
                      <h2 className="font-bold text-xl">Oil &amp; Gas Knowledge Search</h2>
                      <p className="text-medium text-sm mt-2 text-center" style={{ maxWidth: 420 }}>
                        Ask about Norwegian fields and reserves, UK licensing blocks, US/Texas oil &amp; gas rules, worldwide rig counts, and commodity prices. Answers are grounded in your indexed documents with inline citations.
                      </p>
                      <div className="rag-suggestions">
                        {[
                          'Which Norwegian fields are listed and who operates them?',
                          'How have Brent and WTI crude oil prices changed in recent years?',
                          'What are the Texas rules for oil and gas field operations?',
                          'What is the Mahanadi deepwater discovery and how big is it?',
                        ].map(s => (
                          <button
                            key={s}
                            className="rag-suggestion"
                            onClick={() => handleAiSearch(null, s)}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {aiMessages.map((msg, i) => (
                    <div key={i} className={`chat-msg ${msg.role}`}>
                      {msg.role === 'user'
                        ? <div className="user-bubble">{msg.text}</div>
                        : renderAssistantMessage(msg)
                      }
                    </div>
                  ))}

                  {isSearching && (
                    <div className="ai-answer animate-fade-in" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Loader2 size={15} className="text-primary" style={{ animation: 'spin 1s linear infinite' }} />
                      <span className="text-sm text-medium">Retrieving from indexed documents…</span>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Input bar */}
                <div className="rag-input-bar" onClick={e => e.stopPropagation()}>
                  <form onSubmit={handleAiSearch} className="rag-input-form">
                    <span className="text-medium" style={{ fontSize: '1rem', paddingRight: 2 }}>+</span>
                    <input
                      ref={inputRef}
                      type="text"
                      value={aiQuery}
                      onChange={e => setAiQuery(e.target.value)}
                      placeholder={jurisdiction === 'All' ? 'Ask about fields, reserves, licences, rigs, prices or regulations…' : `Ask about ${jurisdiction} data…`}
                      className="rag-input"
                      disabled={isSearching}
                    />
                    <button type="submit" disabled={isSearching || !aiQuery.trim()} className="rag-send-btn">
                      {isSearching
                        ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
                        : <Send size={15} />
                      }
                    </button>
                  </form>
                </div>
              </div>

              {/* Document viewer panel */}
              {docViewer && (
                <DocViewer key={`${docViewer.sourceId}-${docViewer.id}`} source={docViewer} onClose={() => setDocViewer(null)} />
              )}
            </div>

          ) : (
            /* ── Document Results List ── */
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredResults.length === 0 && (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-medium)' }}>
                  <Globe size={36} style={{ margin: '0 auto 0.75rem', opacity: 0.3 }} />
                  <p className="text-sm">No documents match your filters.</p>
                </div>
              )}

              {filteredResults.map(r => (
                <div key={r.id} className="result-card">
                  {/* Row 1 — type + relevance + bookmark */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span className="og-type-badge">
                        <TypeIcon type={r.typeBadge} />
                        {r.typeBadge}
                      </span>
                      <span className="text-xs text-medium">{r.id}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span className={`badge ${statusClass(r.status)}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <CheckCircle2 size={10} />{r.status}
                      </span>
                      <button onClick={() => toggleBookmark(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-medium)' }}>
                        {savedItems.has(r.id)
                          ? <BookmarkCheck size={16} style={{ color: 'var(--primary-color)' }} />
                          : <Bookmark size={16} />
                        }
                      </button>
                    </div>
                  </div>

                  {/* Row 2 — title */}
                  <div className="font-semibold" style={{ fontSize: '0.92rem', marginBottom: '0.35rem', cursor: 'pointer', color: 'var(--text-dark)' }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--primary-color)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dark)'}
                  >
                    {r.title}
                  </div>

                  {/* Row 3 — description */}
                  <p className="result-desc">{r.description}</p>

                  {/* Row 4 — meta footer */}
                  <div className="result-footer" style={{ marginTop: '0.6rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <MapPin size={11} />{r.region}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <ScrollText size={11} />{r.docType}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                      <Calendar size={11} />Effective: {r.date}
                    </span>
                  </div>
                </div>
              ))}

              {filteredResults.length > 0 && (
                <div className="pagination-bar">
                  <button className="pg-btn" disabled>&#8592; Previous</button>
                  {[1, 2, 3].map(n => (
                    <button key={n} className={`pg-btn ${n === 1 ? 'pg-btn-active' : ''}`}>{n}</button>
                  ))}
                  <button className="pg-btn">Next &#8594;</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Citation Popup ── */}
      {citationPopup && (
        <div
          className="citation-popup animate-fade-in"
          style={{ top: citationPopup.y, left: Math.min(citationPopup.x, window.innerWidth - 340) }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-medium)', borderBottom: '1px solid var(--border-color)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Sources
          </div>
          {(citationPopup.sources || []).filter(s => citationPopup.ids.includes(s.id)).map(src => (
            <button key={src.id} className="citation-source-row" onClick={() => openDocViewer(src)}>
              <File size={13} style={{ flexShrink: 0, color: 'var(--primary-color)' }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 700 }}>[{src.id}]</span>&nbsp; {src.shortName}
              </span>
              <span className="text-light text-xs" style={{ flexShrink: 0 }}>{src.unit || 'pg.'} {src.pages.join(', ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

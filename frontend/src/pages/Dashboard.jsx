import React, { useState, useRef, useEffect } from 'react';
import {
  File, CheckCircle2, ChevronDown, ChevronUp, X,
  Send, Loader2, Sparkles, RefreshCw, Clock, Database,
  TrendingUp, Flame, Globe, BookOpen, FileText,
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Download,
  AlertCircle, Newspaper
} from 'lucide-react';

/* ─── Data ──────────────────────────────────────────────────── */
const INPUT_FILES = [
  { name: 'CMO-Pink-Sheet-Sep-2026.pdf', type: 'pdf', size: '2.4 MB', fresh: true },
  { name: 'CMO-Historical-Data-Annual.xlsx', type: 'xlsx', size: '18.7 MB', fresh: false },
  { name: 'IEA-Oil-Market-Report-Sep26.pdf', type: 'pdf', size: '5.1 MB', fresh: true },
  { name: 'OPEC-MOMR-Sep-2026.pdf', type: 'pdf', size: '3.8 MB', fresh: true },
  { name: 'EIA-Petroleum-Supply-Monthly.pdf', type: 'pdf', size: '1.2 MB', fresh: false },
  { name: 'source_regulations.pdf', type: 'pdf', size: '890 KB', fresh: false },
];

const SOURCES = [
  { id: 1, name: 'CMO-Pink-Sheet-Sep-2026.pdf', shortName: 'CMO Pink Sheet...', pages: [2, 7] },
  { id: 2, name: 'CMO-Historical-Data-Annual.xlsx', shortName: 'CMO Historical...', pages: [450] },
  { id: 3, name: 'IEA-Oil-Market-Report-Sep26.pdf', shortName: 'IEA Oil Market...', pages: [4, 11] },
  { id: 4, name: 'OPEC-MOMR-Sep-2026.pdf', shortName: 'OPEC MOMR...', pages: [6, 14, 22] },
  { id: 5, name: 'EIA-Petroleum-Supply-Monthly.pdf', shortName: 'EIA Petroleum...', pages: [9, 15] },
];

const FAQS = [
  {
    id: 'Q1',
    question: 'What is the current Brent Crude average price for today?',
    answer: 'The average price for Brent Crude in the latest reporting month (September 2026) is $82.45 per barrel, reflecting a marginal 1.2% uptick month-on-month driven by tightening OPEC+ supply and seasonal demand recovery in Asia.',
    refs: [
      { srcId: 1, label: 'CMO-Pink-Sheet-Sep-2026.pdf', loc: 'p. 2' },
      { srcId: 2, label: 'CMO-Historical-Data-Annual.xlsx', loc: 'Row 450' },
    ],
  },
  {
    id: 'Q2',
    question: 'What are the natural gas price trends for the European market?',
    answer: 'European natural gas (TTF – Title Transfer Facility) averaged $11.20/mmbtu for September 2026, showing a 5% increase month-on-month. The rise is primarily attributed to reduced Norwegian pipeline flows and an uptick in LNG demand from Asian markets competing for cargoes.',
    refs: [
      { srcId: 3, label: 'IEA-Oil-Market-Report-Sep26.pdf', loc: 'p. 4' },
      { srcId: 4, label: 'OPEC-MOMR-Sep-2026.pdf', loc: 'p. 6' },
    ],
  },
  {
    id: 'Q3',
    question: 'What are the key production forecasts for the North Sea region?',
    answer: 'Production in the North Sea is expected to decline by 1.2% annualized through 2027, offset slightly by new well tie-backs in the Norwegian Barents Sea sector. The Johan Sverdrup Phase-2 ramp-up adds approximately 185,000 bpd, partially countering natural field decline from legacy assets.',
    refs: [
      { srcId: 3, label: 'IEA-Oil-Market-Report-Sep26.pdf', loc: 'p. 11' },
    ],
  },
  {
    id: 'Q4',
    question: 'How have OPEC+ production cuts impacted global supply this quarter?',
    answer: 'OPEC+ voluntary cuts of 2.2 mbpd — extended through Q4 2026 — have kept global oil supply constrained at approximately 101.3 mbpd. Saudi Arabia and Russia jointly contribute ~1.3 mbpd of voluntary cuts. The IEA estimates global demand at 103.1 mbpd, implying a market deficit of ~1.8 mbpd.',
    refs: [
      { srcId: 4, label: 'OPEC-MOMR-Sep-2026.pdf', loc: 'p. 14, 22' },
      { srcId: 5, label: 'EIA-Petroleum-Supply-Monthly.pdf', loc: 'p. 9' },
    ],
  },
  {
    id: 'Q5',
    question: 'What is the current WTI-Brent spread and its significance?',
    answer: 'The WTI-Brent spread currently stands at -$3.20/bbl (WTI at $79.25, Brent at $82.45). This discount reflects higher US crude inventory builds reported in the EIA weekly data and logistical constraints at Cushing, Oklahoma. A widening spread may incentivize increased US crude exports.',
    refs: [
      { srcId: 1, label: 'CMO-Pink-Sheet-Sep-2026.pdf', loc: 'p. 7' },
      { srcId: 5, label: 'EIA-Petroleum-Supply-Monthly.pdf', loc: 'p. 15' },
    ],
  },
];

const AI_CHAT_RESPONSE = (query) => ({
  paragraphs: [
    {
      text: `Based on the latest indexed market data (September 2026), ${query.toLowerCase().includes('natural gas') ? 'European natural gas prices at the TTF hub have risen to $11.20/mmbtu, driven by reduced Norwegian supply and increased Asian competition for LNG cargoes. Henry Hub (US) remains more subdued at $2.85/mmbtu due to robust domestic production.' : 'the oil and gas market is showing a supply deficit of approximately 1.8 mbpd globally. Brent Crude stands at $82.45/bbl with OPEC+ cuts of 2.2 mbpd extended through Q4 2026.'}`,
      citeIds: [1, 3],
    },
    {
      text: `OPEC's Monthly Oil Market Report indicates that non-OPEC supply growth, led by the United States, Brazil, and Guyana, is projected at 1.4 mbpd for full-year 2026. However, this growth is insufficient to offset the OPEC+ production restraint currently in place.`,
      citeIds: [4],
    },
    {
      text: `The IEA Oil Market Report flags geopolitical risk premiums of approximately $3–5/bbl embedded in current Brent prices, tied to Middle East tensions and uncertainty in the Russia-Ukraine corridor affecting European energy flows.`,
      citeIds: [3, 5],
    },
  ],
  meta: { time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), citations: 5 },
});

/* ─── Small helpers ─────────────────────────────────────────── */
function FileIcon({ type }) {
  return type === 'xlsx'
    ? <Database size={13} style={{ color: '#10b981', flexShrink: 0 }} />
    : <FileText size={13} style={{ color: 'var(--primary-color)', flexShrink: 0 }} />;
}

function CitationBtn({ ids, onClick }) {
  return (
    <button className="citation-btn" onClick={onClick}>
      [{ids.join(', ')}]
    </button>
  );
}

/* ─── Main Component ─────────────────────────────────────────── */
export default function Dashboard() {
  const [openQ, setOpenQ] = useState('Q1');
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [citationPopup, setCitationPopup] = useState(null);
  const [docViewer, setDocViewer] = useState(null);
  const [docPage, setDocPage] = useState(1);
  const chatEndRef = useRef(null);
  const chatInputRef = useRef(null);

  const LAST_UPDATED = '28 Sep 2026, 02:30 AM';
  const NEXT_REFRESH = 'Tonight at 12:00 AM';

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isChatLoading]);

  const handleCitationClick = (e, ids) => {
    e.stopPropagation();
    const rect = e.target.getBoundingClientRect();
    setCitationPopup(prev =>
      prev && JSON.stringify(prev.ids) === JSON.stringify(ids)
        ? null
        : { ids, x: rect.left, y: rect.bottom + 8 }
    );
  };

  const openDocViewer = (src) => {
    setCitationPopup(null);
    setDocViewer(src);
    setDocPage(src.pages[0] || 1);
  };

  const handleChatSend = (e, override) => {
    e?.preventDefault();
    const q = override || chatInput;
    if (!q.trim()) return;
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: q }]);
    setIsChatLoading(true);

    // ← Replace with: fetch('/api/rag/market', { method: 'POST', body: JSON.stringify({ query: q }) })
    setTimeout(() => {
      setChatMessages(prev => [...prev, { role: 'assistant', ...AI_CHAT_RESPONSE(q) }]);
      setIsChatLoading(false);
    }, 1800);
  };

  const renderAssistantMessage = (msg) => (
    <div className="ai-answer animate-fade-in" style={{ maxWidth: '100%' }}>
      <div className="ai-answer-header">
        <Sparkles size={14} className="text-primary" />
        <span className="font-semibold text-sm">Market Intelligence</span>
      </div>
      {msg.paragraphs?.map((p, i) => (
        <p key={i} className="ai-text" style={{ marginTop: i > 0 ? '0.75rem' : 0 }}>
          {p.text}
          {p.citeIds?.length > 0 && (
            <CitationBtn ids={p.citeIds} onClick={(e) => handleCitationClick(e, p.citeIds)} />
          )}
        </p>
      ))}
      <div className="ai-meta">
        <span>{msg.meta?.time}</span>
        <span className="ai-meta-link" onClick={(e) => handleCitationClick(e, SOURCES.map(s => s.id))}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TrendingUp size={18} className="text-primary" />
          <span className="font-semibold">Oil &amp; Gas Industry (Market Analysis)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--text-medium)' }}>
            <RefreshCw size={13} />
            Next refresh: <strong style={{ color: 'var(--text-dark)' }}>{NEXT_REFRESH}</strong>
          </div>
          <button className="btn btn-outline" style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 5 }}>
            <RefreshCw size={13} /> Refresh Now
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Left Sidebar ── */}
        <div className="dash-sidebar">

          {/* Last Updated */}
          <div className="dash-sidebar-block" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-light)', marginBottom: 6 }}>Last Updated on</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-dark)' }}>{LAST_UPDATED}</div>
            <span className="badge badge-success" style={{ marginTop: 8, fontSize: '0.7rem' }}>
              <CheckCircle2 size={10} style={{ marginRight: 4 }} />Live
            </span>
          </div>

          {/* Details */}
          <div className="dash-sidebar-block">
            <div className="dash-sidebar-title">Details</div>
            <div className="dash-detail-row">
              <span className="text-medium">Status</span>
              <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>Active</span>
            </div>
            <div className="dash-detail-row">
              <span className="text-medium">Refresh</span>
              <span style={{ fontSize: '0.8rem' }}>Nightly</span>
            </div>
            <div className="dash-detail-row">
              <span className="text-medium">Sources</span>
              <span style={{ fontSize: '0.8rem' }}>{INPUT_FILES.length} files</span>
            </div>
            <div className="dash-detail-row">
              <span className="text-medium">FAQs</span>
              <span style={{ fontSize: '0.8rem' }}>{FAQS.length} generated</span>
            </div>
          </div>

          {/* Pipeline Steps */}
          <div className="dash-sidebar-block">
            <div className="dash-sidebar-title">Pipeline</div>
            <div className="dash-pipeline-step done">
              <CheckCircle2 size={14} style={{ color: 'var(--success-color)', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>Fetch &amp; Scrape</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-medium)' }}>PDFs &amp; articles ingested</div>
              </div>
            </div>
            <div className="dash-pipeline-step done">
              <CheckCircle2 size={14} style={{ color: 'var(--success-color)', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>Embed &amp; Index</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-medium)' }}>Vectors stored in DB</div>
              </div>
            </div>
            <div className="dash-pipeline-step done">
              <CheckCircle2 size={14} style={{ color: 'var(--success-color)', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>Generate FAQs</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-medium)' }}>AI-generated market Q&amp;A</div>
              </div>
            </div>
          </div>

          {/* Input Files */}
          <div className="dash-sidebar-block" style={{ flex: 1 }}>
            <div className="dash-sidebar-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Input Files
              <span style={{ fontSize: '0.7rem', color: 'var(--text-light)' }}>{INPUT_FILES.length} total</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {INPUT_FILES.map(f => (
                <div key={f.name} className="dash-file-row">
                  <FileIcon type={f.type} />
                  <span style={{ flex: 1, fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.name}>
                    {f.name}
                  </span>
                  {f.fresh && (
                    <span style={{ fontSize: '0.62rem', background: 'rgba(16,185,129,0.1)', color: 'var(--success-color)', padding: '1px 5px', borderRadius: 3, fontWeight: 700, flexShrink: 0 }}>NEW</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right Main Panel ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* ── TOP: FAQs section ── */}
          <div style={{ flex: '0 0 55%', overflowY: 'auto', borderBottom: '2px solid var(--border-color)' }}>
            <div style={{ padding: '1.1rem 1.5rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-light)', marginBottom: 2 }}>
                  Metric Extraction Results from Current Market
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <BookOpen size={16} className="text-primary" />
                  <span className="font-semibold" style={{ fontSize: '1rem' }}>AI-Generated FAQs</span>
                  <span className="badge badge-secondary" style={{ fontSize: '0.7rem' }}>{FAQS.length} questions</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: 'var(--text-medium)' }}>
                <Clock size={12} />
                Auto-refreshed nightly
              </div>
            </div>

            <div style={{ padding: '0 1.5rem 1rem' }}>
              {FAQS.map((faq, idx) => (
                <div key={faq.id} className="faq-item">
                  <div className="faq-header" onClick={() => setOpenQ(openQ === faq.id ? null : faq.id)}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1 }}>
                      <span className="faq-qnum">{faq.id}.</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-dark)', lineHeight: 1.45 }}>
                        {faq.question}
                      </span>
                    </div>
                    <div style={{ flexShrink: 0, marginLeft: 8 }}>
                      {openQ === faq.id
                        ? <ChevronUp size={16} style={{ color: 'var(--text-medium)' }} />
                        : <ChevronDown size={16} style={{ color: 'var(--text-medium)' }} />
                      }
                    </div>
                  </div>

                  {openQ === faq.id && (
                    <div className="faq-body animate-fade-in">
                      <p style={{ fontSize: '0.855rem', lineHeight: 1.65, color: 'var(--text-dark)', marginBottom: '0.75rem' }}>
                        {faq.answer}
                      </p>
                      <div className="faq-refs-label">References</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {faq.refs.map((ref, ri) => {
                          const src = SOURCES.find(s => s.id === ref.srcId);
                          return (
                            <button
                              key={ri}
                              className="faq-ref-btn"
                              onClick={(e) => { e.stopPropagation(); src && openDocViewer(src); }}
                            >
                              <FileText size={12} style={{ color: 'var(--primary-color)', flexShrink: 0 }} />
                              <span style={{ color: 'var(--primary-color)', fontWeight: 600 }}>[{ref.srcId}]</span>
                              <span>{ref.label}</span>
                              <span style={{ color: 'var(--text-light)' }}>({ref.loc})</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── BOTTOM: AI Chat section ── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
            {/* Chat section header */}
            <div style={{ padding: '0.7rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-color)' }}>
              <Sparkles size={15} className="text-primary" />
              <span className="font-semibold" style={{ fontSize: '0.9rem' }}>AI Search</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-medium)', marginLeft: 4 }}>— ask follow-up questions on the current market data</span>
            </div>

            {/* Messages area */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.5rem' }}>
              {chatMessages.length === 0 && !isChatLoading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <p className="text-sm text-medium" style={{ marginBottom: 8 }}>Quick questions:</p>
                  {[
                    'What are the key OPEC+ decisions affecting current supply?',
                    'Provide natural gas price trends for the European market.',
                    'What is the current WTI-Brent price spread?',
                  ].map(q => (
                    <button key={q} className="rag-suggestion" style={{ textAlign: 'left' }} onClick={() => handleChatSend(null, q)}>
                      {q}
                    </button>
                  ))}
                </div>
              )}

              {chatMessages.map((msg, i) => (
                <div key={i} className={`chat-msg ${msg.role}`} style={{ marginBottom: '0.85rem' }}>
                  {msg.role === 'user'
                    ? <div className="user-bubble">{msg.text}</div>
                    : renderAssistantMessage(msg)
                  }
                </div>
              ))}

              {isChatLoading && (
                <div className="ai-answer" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.75rem 1rem' }}>
                  <Loader2 size={14} className="text-primary" style={{ animation: 'spin 1s linear infinite' }} />
                  <span className="text-sm text-medium">Retrieving from market database…</span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat input */}
            <div className="rag-input-bar" style={{ padding: '0.75rem 1.5rem' }} onClick={e => e.stopPropagation()}>
              <form onSubmit={handleChatSend} className="rag-input-form">
                <Newspaper size={14} style={{ color: 'var(--text-light)', flexShrink: 0 }} />
                <input
                  ref={chatInputRef}
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  placeholder="Provide the natural gas price trends for the European market for…"
                  className="rag-input"
                  disabled={isChatLoading}
                />
                <button type="submit" disabled={isChatLoading || !chatInput.trim()} className="rag-send-btn">
                  {isChatLoading
                    ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                    : <Send size={14} />
                  }
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* ── Doc Viewer panel (slides in) ── */}
        {docViewer && (
          <div className="doc-viewer animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="doc-viewer-header">
              <FileText size={13} className="text-primary" style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: '0.78rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {docViewer.name}
              </span>
              <button className="icon-btn" onClick={() => setDocViewer(null)}><X size={14} /></button>
            </div>
            <div className="doc-viewer-nav">
              <button className="icon-btn" onClick={() => setDocPage(p => Math.max(1, p - 1))}><ChevronLeft size={13} /></button>
              <span style={{ fontSize: '0.75rem' }}>{docPage} / 376</span>
              <button className="icon-btn" onClick={() => setDocPage(p => p + 1)}><ChevronRight size={13} /></button>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                <button className="icon-btn"><Download size={12} /></button>
                <button className="icon-btn"><ZoomOut size={12} /></button>
                <button className="icon-btn"><ZoomIn size={12} /></button>
              </div>
            </div>
            <div className="doc-viewer-badge">● Highlighted &nbsp;^&nbsp;1/1&nbsp;×</div>
            <div className="doc-viewer-body" style={{ padding: '0.85rem', overflowY: 'auto', background: '#f1f5f9', display: 'flex', justifyContent: 'center' }}>
              <div style={{
                width: '100%',
                maxWidth: 620,
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: 4,
                padding: '1.25rem',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: '0.8rem',
                lineHeight: 1.6,
                color: '#1e293b'
              }}>
                {/* Document Header */}
                <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: '0.4rem', marginBottom: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ fontSize: '0.82rem', fontWeight: 800, color: '#0f172a', margin: 0, textTransform: 'uppercase' }}>
                      {docViewer.name}
                    </h4>
                    <span style={{ fontSize: '0.68rem', color: '#64748b' }}>
                      Official Market Publication | RAG Verified Citation
                    </span>
                  </div>
                  <span style={{ fontSize: '0.65rem', fontWeight: 700, background: '#eff6ff', color: '#1d4ed8', padding: '2px 6px', borderRadius: 3, border: '1px solid #bfdbfe' }}>
                    Page {docPage} of 376
                  </span>
                </div>

                {/* Highlighted Quote Box */}
                <div style={{ background: '#fef9c3', borderLeft: '3px solid #eab308', padding: '0.6rem 0.75rem', borderRadius: '0 4px 4px 0', marginBottom: '0.85rem' }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#a16207', textTransform: 'uppercase', marginBottom: 2 }}>
                    📍 Highlighted Citation Match (Page {docPage})
                  </div>
                  <p style={{ margin: 0, fontSize: '0.78rem', fontWeight: 600, color: '#854d0e' }}>
                    {docViewer.name.includes('Pink-Sheet')
                      ? '"Brent crude spot price averaged $81.50/bbl in Q3 2026, supported by OPEC+ supply discipline and lower inventory draws across OECD ports."'
                      : docViewer.name.includes('IEA')
                      ? '"Global oil demand growth projected at +1.2 mb/d in 2026, led by petrochemical feedstock expansion across Asia Pacific operations."'
                      : docViewer.name.includes('OPEC')
                      ? '"OPEC reference basket increased by 2.4% month-on-month. Non-OPEC supply expansion led by US Permian & Guyana offshore fields."'
                      : '"Hydrocarbon production telemetry shows 92.4% refinery utilization across coastal infrastructure hubs."'}
                  </p>
                </div>

                <p style={{ color: '#334155', marginBottom: '0.75rem' }}>
                  Executive Analysis: Field operations across Krishna-Godavari deepwater and Barmer onshore basins continue operating within target parameters. Refinery throughput across IOC, ONGC, and HPCL coastal units recorded peak Q3 efficiency.
                </p>

                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '0.4rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: '#94a3b8' }}>
                  <span>CONFIDENTIAL - RAG AUDITED SOURCE</span>
                  <span>Page {docPage}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Citation popup ── */}
      {citationPopup && (
        <div
          className="citation-popup animate-fade-in"
          style={{ top: citationPopup.y, left: Math.min(citationPopup.x, window.innerWidth - 340) }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ padding: '0.45rem 0.75rem', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-medium)', borderBottom: '1px solid var(--border-color)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Sources
          </div>
          {SOURCES.filter(s => citationPopup.ids.includes(s.id)).map(src => (
            <button key={src.id} className="citation-source-row" onClick={() => openDocViewer(src)}>
              <File size={12} style={{ color: 'var(--primary-color)', flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <strong>[{src.id}]</strong>&nbsp;{src.shortName}
              </span>
              <span className="text-light" style={{ fontSize: '0.72rem', flexShrink: 0 }}>pg. {src.pages.join(', ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

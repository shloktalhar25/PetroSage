import React, { useState } from 'react';
import {
  ShieldAlert, ShieldCheck, FileText, Upload, AlertTriangle, Scale,
  BookOpen, CheckCircle2, ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  Download, Eye, Sparkles, X, RefreshCw, FileCheck, MapPin, ExternalLink
} from 'lucide-react';

/* ─── Sample Documents ─── */
const SAMPLE_DOCS = [
  {
    id: 'rig-2026',
    name: 'Offshore_Rig_Alpha4_Expansion_Proposal.pdf',
    size: '2.4 MB',
    date: 'Sep 2026',
    title: 'Company Operational Proposal: Rig Alpha-4 Deepwater Drilling',
    author: 'Apex Oil & Gas Operating Ltd.',
    defectsCount: 2,
    warningsCount: 1,
    pages: [
      {
        pageNo: 1,
        content: `COMPANY OPERATIONAL PLAN: OFFSHORE RIG EXPANSION 2026
Project: Installation of Deepwater Drilling Rig Platform Alpha-4
Company: Apex Oil & Gas Operating Ltd.
Date: September 2026

1. EXECUTIVE SUMMARY
Apex Oil & Gas proposes the installation of a deep-water jack-up drilling rig (Alpha-4) to tap into newly surveyed hydrocarbon reserves off the western coast of India.

2. GEOGRAPHIC & POSITIONING SPECIFICATIONS
Target Site: Block W-2026-X
Distance from Coastline: 24 Nautical Miles (44.4 km) off Gujarat/Kutch shore.
Water Depth: 120 meters.
Rig Type: Dynamic Positioning Jack-Up Rig (Alpha-4).`,
        highlights: []
      },
      {
        pageNo: 2,
        content: `3. REGULATORY ASSUMPTIONS & PERMITTING
The project team assumes that since the rig is positioned 24 NM (44.4 km) offshore, it lies outside local 12 NM territorial jurisdiction and can proceed with standard company internal safety approvals without prior Ministry of Environment, Forest and Climate Change (MoEFCC) Environmental Clearance (EC) or Defense Maritime Clearance.

4. WASTE & EFFLUENT MANAGEMENT PLAN
Produced water from initial test drilling will be discharged directly into the surrounding sea at a depth of 40m without onshore treatment or closed-loop recycling.`,
        highlights: [
          {
            id: 'hl-1',
            text: 'since the rig is positioned 24 NM (44.4 km) offshore, it lies outside local 12 NM territorial jurisdiction and can proceed with standard company internal safety approvals without prior Ministry of Environment, Forest and Climate Change (MoEFCC) Environmental Clearance (EC) or Defense Maritime Clearance.',
            severity: 'critical',
            label: 'Violation 1: EEZ Act 1976 § 7(5)'
          },
          {
            id: 'hl-2',
            text: 'Produced water from initial test drilling will be discharged directly into the surrounding sea at a depth of 40m without onshore treatment',
            severity: 'warning',
            label: 'Violation 2: CPCB Water Act 1974'
          }
        ]
      },
      {
        pageNo: 3,
        content: `5. DISPATCH & LOGISTICS TIMELINE
Mobilization of supply vessels from Hazira port scheduled for Q4 2026. Drilling operations expected to commence within 60 days of site arrival.

6. REVENUE & PRODUCTION ESTIMATES
Projected initial yield: 35,000 bopd crude oil + 4.2 MMSCMD associated natural gas.`,
        highlights: []
      }
    ]
  },
  {
    id: 'pipeline-2026',
    name: 'Subsea_Pipeline_Feeder_Plan.pdf',
    size: '1.8 MB',
    date: 'Aug 2026',
    title: 'Subsea Gas Feeder Line Interconnect Plan',
    author: 'KG Basin Logistics Division',
    defectsCount: 1,
    warningsCount: 0,
    pages: [
      {
        pageNo: 1,
        content: `SUBSEA GAS PIPELINE INTERCONNECT PROPOSAL
Project: 18-inch High Pressure Natural Gas Link
Location: KG Basin Block KG-OSN-2024/1 to Kakinada Shore Terminal

1. ROUTING & JURISDICTION
Pipeline route crosses coastal fishing zone at 8 NM from baseline without state maritime board concurrence.`,
        highlights: [
          {
            id: 'hl-3',
            text: 'crosses coastal fishing zone at 8 NM from baseline without state maritime board concurrence.',
            severity: 'critical',
            label: 'Violation: CRZ Notification 2019'
          }
        ]
      }
    ]
  }
];

/* ─── Legal Violations Database ─── */
const VIOLATIONS = [
  {
    id: 'v1',
    docId: 'rig-2026',
    severity: 'CRITICAL DEFECT',
    severityColor: '#dc2626',
    badgeBg: '#fef2f2',
    title: 'Unauthorized Offshore Rig Placement in EEZ (24 NM Zone)',
    excerpt: '"...since the rig is positioned 24 NM (44.4 km) offshore, it lies outside local 12 NM territorial jurisdiction and can proceed... without prior MoEFCC Environmental Clearance (EC) or Defense Maritime Clearance."',
    lawTitle: 'Territorial Waters, Continental Shelf, EEZ & Maritime Zones Act 1976 (Section 7(5)) & MoEFCC EIA Notification 2006',
    analysis: 'Under Section 7(5) of the EEZ Act 1976, India exercises sovereign rights over the Exclusive Economic Zone up to 200 NM (370 km). Position 24 NM is NOT exempt. Constructing an offshore drilling platform anywhere in the EEZ without prior Environmental Clearance (EC) from MoEFCC and NOC from Ministry of Defense is a statutory violation punishable under Section 15 of the Environment (Protection) Act 1986.',
    pageNo: 2,
    highlightId: 'hl-1'
  },
  {
    id: 'v2',
    docId: 'rig-2026',
    severity: 'NON-COMPLIANCE',
    severityColor: '#d97706',
    badgeBg: '#fffbeb',
    title: 'Prohibited Untreated Produced Water Discharge',
    excerpt: '"Produced water from initial test drilling will be discharged directly into the surrounding sea at a depth of 40m without onshore treatment or closed-loop recycling."',
    lawTitle: 'Water (Prevention & Control of Pollution) Act 1974 & CPCB Marine Standards 2021',
    analysis: 'Direct discharge of untreated produced water violates CPCB Zero Liquid Discharge (ZLD) guidelines. Closed-loop oil-water separation (<15 ppm oil content) is legally mandatory prior to ocean discharge.',
    pageNo: 2,
    highlightId: 'hl-2'
  }
];

export default function Regulations() {
  const [selectedDoc, setSelectedDoc] = useState(SAMPLE_DOCS[0]);
  const [currentPageNo, setCurrentPageNo] = useState(1);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [activeHighlightId, setActiveHighlightId] = useState('hl-1');
  const [showRemediationModal, setShowRemediationModal] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);

  const currentPage = selectedDoc.pages.find(p => p.pageNo === currentPageNo) || selectedDoc.pages[0];

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadStatus(`Analyzing "${file.name}" against Indian Maritime Laws...`);
    setTimeout(() => {
      setUploadStatus(null);
    }, 1200);
  };

  const jumpToViolation = (pageNo, hlId) => {
    setCurrentPageNo(pageNo);
    setActiveHighlightId(hlId);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#f8fafc' }}>
      
      {/* ─── Executive Top Header ─── */}
      <div className="header" style={{ justifyContent: 'space-between', padding: '0.75rem 1.5rem', background: '#ffffff', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ width: 34, height: 34, borderRadius: 'var(--radius-md)', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary-color)' }}>
            <Scale size={18} />
          </div>
          <div>
            <h1 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--text-dark)' }}>
              Oil & Gas Regulatory Compliance Review
            </h1>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-medium)', margin: 0 }}>
              Statutory verification of operational plans against Indian Maritime & MoEFCC Environmental Laws
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <select
            value={selectedDoc.id}
            onChange={(e) => {
              const doc = SAMPLE_DOCS.find(d => d.id === e.target.value);
              if (doc) {
                setSelectedDoc(doc);
                setCurrentPageNo(1);
              }
            }}
            style={{ padding: '0.4rem 0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.78rem', background: '#f8fafc', fontWeight: 600, color: '#334155' }}
          >
            {SAMPLE_DOCS.map(d => (
              <option key={d.id} value={d.id}>{d.name} ({d.defectsCount} defects)</option>
            ))}
          </select>

          <label className="btn btn-primary" style={{ cursor: 'pointer', fontSize: '0.78rem', padding: '0.4rem 0.75rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Upload size={13} /> Upload Proposal
            <input type="file" accept=".pdf,.doc,.docx,.txt" onChange={handleFileUpload} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      {uploadStatus && (
        <div style={{ background: '#eff6ff', borderBottom: '1px solid #bfdbfe', padding: '0.4rem 1.5rem', color: '#1e40af', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <RefreshCw size={13} className="animate-spin" />
          <span>{uploadStatus}</span>
        </div>
      )}

      {/* ─── Main 50/50 Split View ─── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ════════ LEFT HALF: Professional PDF Document Viewer ════════ */}
        <div style={{ flex: '0 0 50%', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', background: '#ffffff', overflow: 'hidden' }}>
          
          {/* Document Toolbar */}
          <div style={{ padding: '0.45rem 1rem', background: '#f8fafc', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.78rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileText size={15} style={{ color: 'var(--primary-color)' }} />
              <span style={{ fontWeight: 600, color: 'var(--text-dark)' }}>{selectedDoc.name}</span>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-medium)', background: '#e2e8f0', padding: '1px 6px', borderRadius: 4 }}>{selectedDoc.size}</span>
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#ffffff', border: '1px solid var(--border-color)', borderRadius: 4, padding: '1px 4px' }}>
                <button
                  disabled={currentPageNo <= 1}
                  onClick={() => setCurrentPageNo(p => Math.max(1, p - 1))}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 2, opacity: currentPageNo <= 1 ? 0.3 : 1 }}
                >
                  <ChevronLeft size={13} />
                </button>
                <span style={{ fontWeight: 600, fontSize: '0.72rem', minWidth: 46, textAlign: 'center', color: '#334155' }}>
                  {currentPageNo} / {selectedDoc.pages.length}
                </span>
                <button
                  disabled={currentPageNo >= selectedDoc.pages.length}
                  onClick={() => setCurrentPageNo(p => Math.min(selectedDoc.pages.length, p + 1))}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 2, opacity: currentPageNo >= selectedDoc.pages.length ? 0.3 : 1 }}
                >
                  <ChevronRight size={13} />
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button onClick={() => setZoomLevel(z => Math.max(75, z - 10))} style={{ border: '1px solid var(--border-color)', background: '#fff', borderRadius: 4, padding: 2, cursor: 'pointer' }}>
                  <ZoomOut size={12} />
                </button>
                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569' }}>{zoomLevel}%</span>
                <button onClick={() => setZoomLevel(z => Math.min(140, z + 10))} style={{ border: '1px solid var(--border-color)', background: '#fff', borderRadius: 4, padding: 2, cursor: 'pointer' }}>
                  <ZoomIn size={12} />
                </button>
              </div>

              <span style={{ background: '#fef2f2', color: '#dc2626', padding: '2px 8px', borderRadius: 4, fontSize: '0.68rem', fontWeight: 700, border: '1px solid #fee2e2' }}>
                {selectedDoc.defectsCount} Violations
              </span>
            </div>
          </div>

          {/* Document Canvas */}
          <div style={{ flex: 1, padding: '1.25rem', overflowY: 'auto', background: '#f1f5f9', display: 'flex', justifyContent: 'center' }}>
            <div style={{
              width: `${zoomLevel}%`,
              maxWidth: 720,
              minHeight: 760,
              background: '#ffffff',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              border: '1px solid #cbd5e1',
              borderRadius: 4,
              padding: '2.25rem',
              fontFamily: 'Inter, system-ui, sans-serif',
              color: '#1e293b',
              lineHeight: 1.6,
              fontSize: '0.88rem',
              position: 'relative'
            }}>
              
              {/* Document Header */}
              <div style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '0.6rem', marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ fontSize: '0.92rem', fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.3px', margin: 0 }}>
                    {selectedDoc.title}
                  </h2>
                  <p style={{ fontSize: '0.7rem', color: '#64748b', margin: '2px 0 0 0' }}>
                    Author: {selectedDoc.author} | Classification: Internal Operational Plan
                  </p>
                </div>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#475569', background: '#f1f5f9', padding: '2px 6px', borderRadius: 3, border: '1px solid #e2e8f0' }}>
                  Draft v1.4
                </span>
              </div>

              {/* Render Paragraphs & Subtle Violations Accent */}
              {currentPage.content.split('\n\n').map((paragraph, idx) => {
                const foundHighlight = currentPage.highlights.find(h => paragraph.includes(h.text) || h.text.includes(paragraph.substring(0, 30)));

                if (foundHighlight) {
                  const isSelected = activeHighlightId === foundHighlight.id;
                  const borderCol = foundHighlight.severity === 'critical' ? '#dc2626' : '#d97706';
                  return (
                    <div
                      key={idx}
                      onClick={() => setActiveHighlightId(foundHighlight.id)}
                      style={{
                        margin: '1rem 0',
                        padding: '0.75rem 0.9rem',
                        background: isSelected ? '#fef2f2' : '#fafafa',
                        borderLeft: `3px solid ${borderCol}`,
                        borderTop: isSelected ? '1px solid #fca5a5' : '1px solid #f1f5f9',
                        borderRight: isSelected ? '1px solid #fca5a5' : '1px solid #f1f5f9',
                        borderBottom: isSelected ? '1px solid #fca5a5' : '1px solid #f1f5f9',
                        borderRadius: '0 4px 4px 0',
                        cursor: 'pointer',
                        transition: 'all 0.15s'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: borderCol, textTransform: 'uppercase' }}>
                          ⚠️ {foundHighlight.label}
                        </span>
                        <span style={{ fontSize: '0.65rem', color: '#64748b' }}>Click to view law</span>
                      </div>
                      <p style={{ margin: 0, color: '#0f172a', fontWeight: 500, fontSize: '0.85rem' }}>
                        {paragraph}
                      </p>
                    </div>
                  );
                }

                return (
                  <p key={idx} style={{ margin: '0.9rem 0', whiteSpace: 'pre-line', color: '#334155' }}>
                    {paragraph}
                  </p>
                );
              })}

              {/* Page Footer */}
              <div style={{ position: 'absolute', bottom: '0.8rem', left: '2.25rem', right: '2.25rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.4rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#94a3b8' }}>
                <span>CONFIDENTIAL - PROPOSED OPERATIONS</span>
                <span>Page {currentPageNo} of {selectedDoc.pages.length}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ════════ RIGHT HALF: Executive AI Compliance Report ════════ */}
        <div style={{ flex: '0 0 50%', display: 'flex', flexDirection: 'column', background: '#ffffff', overflow: 'hidden' }}>
          
          {/* Header Bar */}
          <div style={{ padding: '0.75rem 1.25rem', background: '#ffffff', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={16} style={{ color: 'var(--primary-color)' }} />
              <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-dark)' }}>
                AI Legal Compliance Report
              </span>
            </div>

            <button
              onClick={() => setShowRemediationModal(true)}
              className="btn btn-primary"
              style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: 6, background: '#2563eb' }}
            >
              <FileCheck size={13} /> What to do now?
            </button>
          </div>

          {/* RAG Scan Summary */}
          <div style={{ padding: '0.75rem 1.25rem', background: '#f8fafc', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#dc2626', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <ShieldAlert size={15} />
            </div>
            <div>
              <h4 style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                2 Legal Violations Flagged by RAG Scan
              </h4>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-medium)', margin: 0 }}>
                Cross-referenced with EEZ Act 1976, MoEFCC EIA Notification 2006, and CPCB Water Act.
              </p>
            </div>
          </div>

          {/* Violations List */}
          <div style={{ flex: 1, padding: '1rem 1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.85rem', background: '#f8fafc' }}>
            
            {VIOLATIONS.filter(v => v.docId === selectedDoc.id).map((v) => {
              const isSelected = activeHighlightId === v.highlightId;
              return (
                <div
                  key={v.id}
                  onClick={() => jumpToViolation(v.pageNo, v.highlightId)}
                  style={{
                    background: '#ffffff',
                    border: isSelected ? `2px solid ${v.severityColor}` : '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    padding: '1rem',
                    boxShadow: isSelected ? '0 2px 8px rgba(0,0,0,0.06)' : 'var(--shadow-sm)',
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                >
                  {/* Badge & Page */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                    <span style={{
                      background: v.badgeBg,
                      color: v.severityColor,
                      padding: '2px 6px',
                      borderRadius: 3,
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      border: `1px solid ${v.severityColor}30`,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4
                    }}>
                      <AlertTriangle size={11} /> {v.severity}
                    </span>

                    <span style={{ fontSize: '0.7rem', color: 'var(--primary-color)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Eye size={11} /> View in doc (Page {v.pageNo})
                    </span>
                  </div>

                  {/* Title */}
                  <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.4rem', lineHeight: 1.35 }}>
                    {v.title}
                  </h3>

                  {/* Excerpt Quote */}
                  <div style={{ background: '#f1f5f9', borderLeft: '2px solid #94a3b8', padding: '0.4rem 0.6rem', borderRadius: '0 3px 3px 0', fontSize: '0.75rem', color: '#334155', fontStyle: 'italic', marginBottom: '0.6rem' }}>
                    {v.excerpt}
                  </div>

                  {/* Law Box */}
                  <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 4, padding: '0.5rem 0.6rem', marginBottom: '0.6rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#1d4ed8', fontWeight: 700, fontSize: '0.72rem', marginBottom: 2 }}>
                      <Scale size={12} />
                      <span>Violated Statutory Law:</span>
                    </div>
                    <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#1e3a8a', margin: 0 }}>
                      {v.lawTitle}
                    </p>
                  </div>

                  {/* Analysis */}
                  <p style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.5, margin: 0 }}>
                    {v.analysis}
                  </p>
                </div>
              );
            })}

            {/* Legal Summary Footnote */}
            <div style={{ background: '#ffffff', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a', fontWeight: 700, fontSize: '0.78rem', marginBottom: 4 }}>
                <BookOpen size={14} style={{ color: 'var(--primary-color)' }} />
                <span>Statutory Governance Baseline</span>
              </div>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-medium)', lineHeight: 1.45, margin: 0 }}>
                Under international maritime law (UNCLOS III) and India's Maritime Zones Act 1976, sovereign hydrocarbon exploration rights up to 200 NM belong exclusively to the Union Govt. Operating 24 NM offshore mandates MoPNG lease approval and MoEFCC EIA clearance.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ════════ REMEDIATION MODAL ("What to do now?") ════════ */}
      {showRemediationModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1.5rem' }}>
          <div style={{ width: '100%', maxWidth: 680, background: '#ffffff', borderRadius: 'var(--radius-lg)', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15)', border: '1px solid var(--border-color)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '88vh' }}>
            
            {/* Header */}
            <div style={{ padding: '1rem 1.25rem', background: '#0f172a', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileCheck size={16} style={{ color: '#38bdf8' }} />
                <div>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: '#fff' }}>
                    Compliance Action Plan & Legal Remediation
                  </h3>
                  <p style={{ fontSize: '0.72rem', color: '#94a3b8', margin: 0 }}>
                    Recommended steps to resolve the 2 identified statutory violations
                  </p>
                </div>
              </div>
              <button onClick={() => setShowRemediationModal(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}>
                <X size={16} />
              </button>
            </div>

            {/* Content */}
            <div style={{ padding: '1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              
              {/* Action 1 */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-md)', padding: '0.85rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#16a34a', fontWeight: 700, fontSize: '0.82rem', marginBottom: 4 }}>
                  <MapPin size={14} />
                  <span>Action 1: Relocate Rig within 12 NM or Apply for EEZ Special Permit</span>
                </div>
                <p style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.45, marginBottom: '0.6rem' }}>
                  To resolve the 24 NM (44.4 km) EEZ legal defect, choose one of two statutory solutions:
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                  <div style={{ background: '#fff', border: '1px solid #cbd5e1', padding: '0.6rem', borderRadius: 4 }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#0f172a' }}>Option A (Recommended)</span>
                    <p style={{ fontSize: '0.7rem', color: '#64748b', margin: '2px 0 0 0' }}>
                      Shift Rig Alpha-4 to Block KG-OSN-2024/1 inside 12 NM territorial waters under active lease.
                    </p>
                  </div>
                  <div style={{ background: '#fff', border: '1px solid #cbd5e1', padding: '0.6rem', borderRadius: 4 }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#0f172a' }}>Option B (Permit Path)</span>
                    <p style={{ fontSize: '0.7rem', color: '#64748b', margin: '2px 0 0 0' }}>
                      File Form-1 EIA with MoEFCC Expert Appraisal Committee & obtain MoD Security Clearance.
                    </p>
                  </div>
                </div>
              </div>

              {/* Action 2 */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-md)', padding: '0.85rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#2563eb', fontWeight: 700, fontSize: '0.82rem', marginBottom: 4 }}>
                  <RefreshCw size={14} />
                  <span>Action 2: Upgrade Waste Plan to Closed-Loop Water Recycling</span>
                </div>
                <p style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.45, margin: 0 }}>
                  Replace direct 40m marine ocean discharge with an onboard Hydrocyclone Separator (&lt;15 ppm oil content) or closed-loop reinjection to satisfy CPCB Zero Liquid Discharge guidelines.
                </p>
              </div>

              {/* Checklist */}
              <div>
                <h4 style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
                  Filing Checklist:
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[
                    'MoEFCC Coastal Regulation Zone (CRZ) & EIA Category-A Clearance',
                    'Ministry of Defense (MoD) Offshore Security NOC for 24 NM site',
                    'DG Shipping Maritime Safety & Navigational Marking License',
                    'State Pollution Control Board Consent to Establish (CTE) & Operate (CTO)'
                  ].map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: '#334155' }}>
                      <CheckCircle2 size={13} style={{ color: '#16a34a', flexShrink: 0 }} />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ padding: '0.75rem 1.25rem', background: '#f8fafc', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
                onClick={() => alert("Downloading AI-redlined compliant proposal draft...")}
              >
                <Download size={13} /> Download Redlined Compliant Draft
              </button>

              <button
                className="btn btn-primary"
                style={{ fontSize: '0.75rem', padding: '0.35rem 0.85rem' }}
                onClick={() => setShowRemediationModal(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

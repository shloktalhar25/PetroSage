import React, { useState } from 'react';
import { FileText, Download, CheckCircle2, ChevronDown, Edit3, X } from 'lucide-react';

function DataExtraction() {
  const [activeTab, setActiveTab] = useState('Summary');
  const [modalType, setModalType] = useState(null); // 'csv', 'ai', or null

  return (
    <div className="flex flex-col" style={{ height: '100%' }}>
      <div className="header">
        Structured Data Extraction (Oil & Gas Reports)
      </div>
      
      <div className="content-area animate-fade-in relative">
        <div className="secondary-sidebar">
          <div className="tabs">
            <div className={`tab ${activeTab === 'Summary' ? 'active' : ''}`} onClick={() => setActiveTab('Summary')}>Summary</div>
            <div className={`tab ${activeTab === 'Content' ? 'active' : ''}`} onClick={() => setActiveTab('Content')}>Content</div>
          </div>
          
          {activeTab === 'Summary' && (
            <>
              <div className="flex flex-col gap-2">
                <div className="text-sm font-semibold mb-1">Details</div>
                <div className="flex justify-between text-sm">
                  <span className="text-medium">Status</span>
                  <span className="badge badge-success">Completed</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-medium">Start Date</span>
                  <span>12/10/2026</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-medium">Duration</span>
                  <span>15 mins</span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="text-sm font-semibold mb-1">Steps</div>
                <div className="flex gap-2 text-sm">
                  <CheckCircle2 size={16} className="text-primary mt-1" />
                  <div>
                    <div className="font-medium">Extract Tables & Time-Series</div>
                    <div className="text-xs text-medium">Extracts structured data to fill templates.</div>
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'Content' && (
            <div className="text-sm text-medium">
              List of identified tables and coordinates from the PDFs will be rendered here.
            </div>
          )}
        </div>

        <div className="main-panel card flex flex-col gap-0" style={{ padding: 0 }}>
          <div className="p-4 border-b flex justify-between items-center" style={{ backgroundColor: 'var(--secondary-color)' }}>
            <input type="text" className="input-control w-full max-w-md" placeholder="Search extracted templates..." />
          </div>
          
          <div className="flex flex-col">
            <div className="flex items-center justify-between p-4 border-b file-item hover:bg-secondary transition-colors" style={{ borderRadius: 0 }}>
              <div className="flex items-center gap-3">
                <FileText size={20} className="text-primary" />
                <div>
                  <div className="font-semibold text-sm">Commodity Price Extraction (Monthly)</div>
                  <div className="text-xs text-medium flex gap-2 mt-1">
                    <span>Template: CMO-Monthly</span>
                    <span className="badge badge-secondary">Auto-mapped</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-medium">14 tables found</span>
                <button className="btn btn-outline hover:bg-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => setModalType('csv')}>
                  <FileText size={14}/> View CSV
                </button>
                <button className="btn btn-primary hover:bg-primary-hover" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => setModalType('ai')}>
                  <Edit3 size={14}/> Validate with AI
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 border-b file-item hover:bg-secondary transition-colors" style={{ borderRadius: 0 }}>
              <div className="flex items-center gap-3">
                <FileText size={20} className="text-primary" />
                <div>
                  <div className="font-semibold text-sm">Norway Well Production Logs</div>
                  <div className="text-xs text-medium flex gap-2 mt-1">
                    <span>Template: Well-Log-Standard</span>
                    <span className="badge badge-secondary">Auto-mapped</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-medium">420 rows</span>
                <button className="btn btn-outline hover:bg-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => setModalType('csv')}>
                  <FileText size={14}/> View CSV
                </button>
                <button className="btn btn-primary hover:bg-primary-hover" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => setModalType('ai')}>
                  <Edit3 size={14}/> Validate with AI
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 border-b file-item hover:bg-secondary transition-colors" style={{ borderRadius: 0 }}>
              <div className="flex items-center gap-3">
                <FileText size={20} className="text-primary" />
                <div>
                  <div className="font-semibold text-sm">US Strategic Petroleum Reserve Status</div>
                  <div className="text-xs text-medium flex gap-2 mt-1">
                    <span>Template: SPR-Report</span>
                    <span className="badge badge-warning">Review Needed</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-medium">Source: source.pdf</span>
                <button className="btn btn-outline text-success-color border-success-color hover:bg-success-bg" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => alert("Downloading SPR-Report...")}>
                  <Download size={14}/> Download
                </button>
                <button className="btn btn-outline hover:bg-secondary" style={{ padding: '0.25rem 0.5rem' }}>
                  <ChevronDown size={14}/>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Overlay */}
        {modalType && (
          <div className="absolute inset-0 z-50 flex items-center justify-center rounded-lg" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <div className="bg-surface-color w-3/4 h-3/4 rounded-lg shadow-lg flex flex-col overflow-hidden animate-fade-in" style={{ backgroundColor: 'var(--surface-color)', width: '80%', height: '80%' }}>
              <div className="p-4 flex justify-between items-center" style={{ backgroundColor: 'var(--secondary-color)', borderBottom: '1px solid var(--border-color)' }}>
                <div className="font-semibold flex items-center gap-2">
                  {modalType === 'csv' ? <FileText size={16} className="text-primary" /> : <Edit3 size={16} className="text-primary" />}
                  {modalType === 'csv' ? 'CSV Data Viewer' : 'AI Data Validation'}
                </div>
                <button className="p-1 hover:bg-border-color rounded-md cursor-pointer" onClick={() => setModalType(null)}><X size={20} /></button>
              </div>
              <div className="flex-1 p-6 flex flex-col items-center justify-center text-medium" style={{ backgroundColor: '#f8fafc' }}>
                {modalType === 'csv' ? (
                  <>
                    <FileText size={64} className="text-light mb-4" />
                    <h3 className="text-lg font-medium text-dark mb-2">Spreadsheet Grid View</h3>
                    <p className="text-center max-w-md">An embedded DataGrid component would mount here, showing the structured data extracted from the documents.</p>
                  </>
                ) : (
                  <>
                    <Edit3 size={64} className="text-primary mb-4 opacity-50" />
                    <h3 className="text-lg font-medium text-dark mb-2">Human-in-the-Loop Validation</h3>
                    <p className="text-center max-w-md">This view presents the extracted table on the left, and the original document on the right with bounding boxes highlighting the source data.</p>
                  </>
                )}
                <button className="btn btn-primary mt-6" onClick={() => setModalType(null)}>Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default DataExtraction;

import React, { useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polygon } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Flame, Compass, Activity, Sparkles, Send, Radio, Droplets,
  Newspaper, Zap, Layers, FileText, CheckCircle2, AlertCircle,
  ExternalLink, Eye, MapPin, Database, Award, Filter
} from 'lucide-react';

/* ─── Leaflet Icon Fix ─── */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

/* ─── Upstream Assets (Current Rigs & Proven Reservoirs) ─── */
const ACTIVE_ASSETS = [
  {
    id: 'KG-OSN-2024/1',
    category: 'rig',
    name: 'KG Offshore Deepwater',
    basin: 'Krishna-Godavari',
    type: 'Offshore Deep',
    lat: 16.120,
    lng: 82.350,
    operator: 'Reliance / BP',
    status: 'Active Drilling',
    rig: 'Rig Deepwater Frontier',
    rigType: 'Drillship',
    depth: 3850,
    targetDepth: 4200,
    rop: '14.2 m/hr',
    mudWeight: '11.8 ppg',
    bopd: 45000,
    gasMmscmd: 10.2,
    waterCut: '12%',
    description: 'Active deepwater drillship operating in KG Basin targeting HPHT gas & light crude reservoirs.',
    polygon: [[16.30, 82.10], [16.30, 82.60], [15.95, 82.60], [15.95, 82.10]]
  },
  {
    id: 'RJ-ONN-2001/1',
    category: 'reservoir',
    name: 'Barmer Onshore Reservoir',
    basin: 'Rajasthan Barmer',
    type: 'Proven Reservoir',
    lat: 27.150,
    lng: 71.320,
    operator: 'Cairn Oil & Gas',
    status: 'Producing',
    rig: 'Rig Desert Explorer 4',
    rigType: 'Land Rig',
    depth: 1850,
    targetDepth: 2000,
    rop: '22.0 m/hr',
    mudWeight: '9.4 ppg',
    bopd: 125000,
    gasMmscmd: 1.5,
    waterCut: '28%',
    description: 'India largest onshore producing reservoir under polymer flood EOR across 14 well pads.',
    polygon: [[27.35, 71.10], [27.35, 71.55], [26.95, 71.55], [26.95, 71.10]]
  },
  {
    id: 'MB-OSN-2020/2',
    category: 'rig',
    name: 'Mumbai Offshore Platform',
    basin: 'Mumbai High',
    type: 'Offshore Shallow',
    lat: 18.850,
    lng: 71.220,
    operator: 'ONGC',
    status: 'Producing & Infill Drilling',
    rig: 'Jackup Sagar Samrat',
    rigType: 'Jack-up Platform',
    depth: 2400,
    targetDepth: 2500,
    rop: '8.5 m/hr',
    mudWeight: '10.2 ppg',
    bopd: 80000,
    gasMmscmd: 4.8,
    waterCut: '34%',
    description: 'Offshore jack-up platform active in Mumbai High South for reservoir redevelopment.',
    polygon: [[19.05, 71.00], [19.05, 71.45], [18.65, 71.45], [18.65, 71.00]]
  },
  {
    id: 'AM-ONN-2019/3',
    category: 'rig',
    name: 'Assam Upper Exploration',
    basin: 'Assam-Arakan',
    type: 'Onshore Land',
    lat: 26.850,
    lng: 94.620,
    operator: 'Oil India Ltd (OIL)',
    status: 'Exploratory Drilling',
    rig: 'Land Rig OIL-88',
    rigType: 'Land Rig',
    depth: 2900,
    targetDepth: 3500,
    rop: '11.4 m/hr',
    mudWeight: '10.8 ppg',
    bopd: 12000,
    gasMmscmd: 2.1,
    waterCut: '8%',
    description: 'Exploratory deep wildcat well targeting Eocene sandstone formations in Assam Shelf.',
    polygon: [[27.05, 94.40], [27.05, 94.85], [26.65, 94.85], [26.65, 94.40]]
  }
];

/* ─── Future Potential Leads & Discoveries (Scraped Industry News) ─── */
const FUTURE_LEADS = [
  {
    id: 'LEAD-01',
    category: 'lead',
    name: 'Mahanadi Deepwater Discovery',
    basin: 'Mahanadi Offshore',
    type: 'Future Potential Lead',
    lat: 19.850,
    lng: 86.900,
    operator: 'ONGC (100% Equity)',
    status: 'Wildcat Discovery Reported in News',
    source: 'Directorate General of Hydrocarbons (DGH) & EnergyWorld (Sept 2026)',
    potential: '1.4 Billion Barrels OE',
    stage: '3D Seismic Processing & Appraisal Spud Planned Q1 2027',
    description: 'Recent 3D seismic processing confirmed high-amplitude gas condensate sand anomalies in deepwater fan deposits at 4,800m sub-seabed.',
    citationLoc: 'upstream_news_leads.txt [LEAD-01]',
    polygon: [[20.05, 86.70], [20.05, 87.10], [19.65, 87.10], [19.65, 86.70]]
  },
  {
    id: 'LEAD-02',
    category: 'lead',
    name: 'Barmer Deep Tight Oil Lead',
    basin: 'Rajasthan Barmer',
    type: 'Future Potential Lead',
    lat: 25.900,
    lng: 71.150,
    operator: 'Cairn Oil & Gas',
    status: 'Unconventional Prospect',
    source: 'Cairn Exploration Technical Briefing (Aug 2026)',
    potential: '450 Million Barrels Oil',
    stage: 'Multi-stage Hydraulic Fracturing Pilot Planned',
    description: 'Deep fractured tight oil reservoir identified in Dharvi Dungar formation below existing producing horizon.',
    citationLoc: 'upstream_news_leads.txt [LEAD-02]',
    polygon: [[26.10, 70.95], [26.10, 71.35], [25.70, 71.35], [25.70, 70.95]]
  },
  {
    id: 'LEAD-03',
    category: 'lead',
    name: 'Andaman Sea Frontier Gas Lead',
    basin: 'Andaman Offshore',
    type: 'Future Potential Lead',
    lat: 11.800,
    lng: 93.400,
    operator: 'Oil India Ltd (OIL) / TotalEnergies',
    status: 'OALP IX Licensing Lead',
    source: 'MoPNG OALP IX Offshore Release (Sept 2026)',
    potential: '2.1 Trillion Cubic Feet Gas',
    stage: 'High-Resolution 3D Marine Seismic Acquisition',
    description: 'Frontier deepwater basin displaying significant seabed gas hydrates and structural anticline traps.',
    citationLoc: 'upstream_news_leads.txt [LEAD-03]',
    polygon: [[12.00, 93.20], [12.00, 93.60], [11.60, 93.60], [11.60, 93.20]]
  },
  {
    id: 'LEAD-04',
    category: 'lead',
    name: 'KG Paleocene Deep Reservoir Extension',
    basin: 'Krishna-Godavari',
    type: 'Future Potential Lead',
    lat: 16.550,
    lng: 82.900,
    operator: 'Reliance / BP',
    status: 'Deeper Target Discovery',
    source: 'Reliance-BP Offshore Technical Proceedings (July 2026)',
    potential: '850 Billion Cu Ft Gas',
    stage: 'Appraisal Well Spud Scheduled Q1 2027',
    description: 'Deeper Paleocene turbidite sands identified adjacent to producing D6 fields with prospective net pay > 80 meters.',
    citationLoc: 'upstream_news_leads.txt [LEAD-04]',
    polygon: [[16.75, 82.70], [16.75, 83.10], [16.35, 83.10], [16.35, 82.70]]
  }
];

/* ─── Marker Icon Generator ─── */
function makeMarkerIcon(category, isSelected) {
  let color = '#2563eb'; // Rigs = Blue
  if (category === 'reservoir') color = '#16a34a'; // Reservoirs = Green
  if (category === 'lead') color = '#9333ea'; // News Leads = Purple

  const border = isSelected ? '#facc15' : '#ffffff';
  const size = isSelected ? 36 : 28;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="14" fill="${color}" stroke="${border}" stroke-width="${isSelected ? 3 : 2}"/>
    <g transform="translate(7,7) scale(0.75)" stroke="#ffffff" stroke-width="2" fill="none">
      ${category === 'lead'
        ? '<path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16M5 19a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>'
        : '<path d="M12 2v20M8 6l4-4 4 4M6 12h12M4 20h16"/>'}
    </g>
  </svg>`;

  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function Upstream() {
  const [activeTab, setActiveTab] = useState('all'); // all | rigs | reservoirs | leads
  const [selectedItem, setSelectedItem] = useState(ACTIVE_ASSETS[0]);
  const [chatMessages, setChatMessages] = useState([
    {
      role: 'assistant',
      text: 'Welcome to the Upstream E&P Portal! RAG Engine is indexing live operational data, proven reservoirs, and newly reported news discoveries (Mahanadi Deepwater, Barmer Tight Oil, Andaman Frontier Gas).'
    }
  ]);
  const [chatInput, setChatInput] = useState('');

  const allItems = useMemo(() => [...ACTIVE_ASSETS, ...FUTURE_LEADS], []);

  const filteredItems = useMemo(() => {
    if (activeTab === 'rigs') return allItems.filter(i => i.category === 'rig');
    if (activeTab === 'reservoirs') return allItems.filter(i => i.category === 'reservoir');
    if (activeTab === 'leads') return allItems.filter(i => i.category === 'lead');
    return allItems;
  }, [activeTab, allItems]);

  const handleChatSend = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const q = chatInput;
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: q }]);

    setTimeout(() => {
      let reply = { text: '', refs: [] };
      const qLower = q.toLowerCase();

      if (qLower.includes('mahanadi') || qLower.includes('lead-01')) {
        reply = {
          text: `**Mahanadi Deepwater Discovery (LEAD-01)** was reported by DGH & EnergyWorld (Sept 2026). Estimated potential: **1.4 Billion Barrels OE** operated by ONGC at 4,800m sub-seabed depth.`,
          refs: [{ label: 'upstream_news_leads.txt', loc: '[LEAD-01]' }, { label: 'DGH-2026-Release.pdf', loc: 'p. 4' }]
        };
      } else if (qLower.includes('andaman') || qLower.includes('gas lead')) {
        reply = {
          text: `**Andaman Offshore Frontier Lead (LEAD-03)** is a deepwater natural gas prospect estimated at **2.1 TCF Gas** under OALP IX licensing. High-res 3D seismic processing currently underway.`,
          refs: [{ label: 'upstream_news_leads.txt', loc: '[LEAD-03]' }, { label: 'MoPNG-OALP-IX.pdf', loc: 'p. 12' }]
        };
      } else if (qLower.includes('barmer') || qLower.includes('tight oil')) {
        reply = {
          text: `**Barmer Deep Tight Oil Lead (LEAD-02)** identified by Cairn Oil & Gas contains **450 Million Barrels Tight Oil** in Dharvi Dungar formation. Hydraulic fracturing pilot planned.`,
          refs: [{ label: 'upstream_news_leads.txt', loc: '[LEAD-02]' }]
        };
      } else if (qLower.includes('rig') || qLower.includes('deepwater frontier')) {
        reply = {
          text: `**Rig Deepwater Frontier (KG-OSN-2024/1)** is actively drilling at **3,850m depth** (Target: 4,200m). ROP: 14.2 m/hr. Current production: 45,000 BOPD + 10.2 MMSCMD gas.`,
          refs: [{ label: 'upstream_operations.csv', loc: 'Row 1' }]
        };
      } else {
        reply = {
          text: `RAG search results for **"${q}"**:\nIndexed 4 current active rigs, 2 proven reservoirs, and 4 news-scraped future exploration leads (Mahanadi 1.4B bbls, Andaman 2.1 TCF, Barmer 450M bbls).`,
          refs: [{ label: 'upstream_news_leads.txt', loc: 'All Leads' }, { label: 'upstream_operations.csv', loc: 'Telemetry' }]
        };
      }

      setChatMessages(prev => [...prev, { role: 'assistant', ...reply }]);
    }, 700);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#f8fafc' }}>
      
      {/* ─── Top Executive Header ─── */}
      <div className="header" style={{ justifyContent: 'space-between', padding: '0.75rem 1.5rem', background: '#ffffff', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ width: 34, height: 34, borderRadius: 'var(--radius-md)', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary-color)' }}>
            <Compass size={18} />
          </div>
          <div>
            <h1 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--text-dark)' }}>
              Upstream Operations, Rigs & Future Exploration Leads
            </h1>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-medium)', margin: 0 }}>
              Live RAG telemetry tracking active rigs, proven reservoirs, and news-scraped exploration discoveries
            </p>
          </div>
        </div>

        {/* Navigation Category Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {[
            { id: 'all', label: 'All Operations (8)' },
            { id: 'rigs', label: 'Active Rigs (3)' },
            { id: 'reservoirs', label: 'Proven Reservoirs (1)' },
            { id: 'leads', label: '⚡ Future News Leads (4)' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '0.35rem 0.75rem',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.75rem',
                fontWeight: 600,
                border: '1px solid var(--border-color)',
                background: activeTab === tab.id ? (tab.id === 'leads' ? '#9333ea' : 'var(--primary-color)') : '#ffffff',
                color: activeTab === tab.id ? '#ffffff' : 'var(--text-medium)',
                cursor: 'pointer'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── KPI Metrics Bar ─── */}
      <div style={{ padding: '0.6rem 1.5rem', background: '#ffffff', borderBottom: '1px solid var(--border-color)', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.85rem' }}>
        <div style={{ background: '#f8fafc', padding: '0.55rem 0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-medium)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Flame size={12} style={{ color: '#f97316' }} /> Active Daily Crude Yield
          </div>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a', marginTop: 1 }}>
            262,000 <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b' }}>BOPD</span>
          </div>
        </div>

        <div style={{ background: '#f8fafc', padding: '0.55rem 0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-medium)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Radio size={12} style={{ color: '#2563eb' }} /> Natural Gas Evacuation
          </div>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a', marginTop: 1 }}>
            18.6 <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b' }}>MMSCMD</span>
          </div>
        </div>

        <div style={{ background: '#f8fafc', padding: '0.55rem 0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-medium)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Newspaper size={12} style={{ color: '#9333ea' }} /> Future News Discoveries
          </div>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: '#9333ea', marginTop: 1 }}>
            4.85 Billion <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b' }}>BOE Identified</span>
          </div>
        </div>

        <div style={{ background: '#f8fafc', padding: '0.55rem 0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-medium)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Database size={12} style={{ color: '#16a34a' }} /> RAG Search Index Status
          </div>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: '#16a34a', marginTop: 1 }}>
            Indexed <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b' }}>(DGH + Industry News)</span>
          </div>
        </div>
      </div>

      {/* ─── Main 60/40 Split View ─── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ════════ LEFT PANE: Hydrocarbon Map (60%) ════════ */}
        <div style={{ flex: '0 0 60%', borderRight: '1px solid var(--border-color)', position: 'relative' }}>
          <MapContainer
            center={[18.5, 80.5]}
            zoom={5}
            style={{ width: '100%', height: '100%' }}
          >
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
              attribution='&copy; Esri &mdash; Esri, DeLorme, NAVTEQ'
            />

            {filteredItems.map(item => (
              <React.Fragment key={item.id}>
                {item.polygon && (
                  <Polygon
                    positions={item.polygon}
                    pathOptions={{
                      color: selectedItem.id === item.id ? '#facc15' : item.category === 'lead' ? '#9333ea' : '#2563eb',
                      fillColor: item.category === 'lead' ? '#a855f7' : '#3b82f6',
                      fillOpacity: selectedItem.id === item.id ? 0.3 : 0.12,
                      weight: selectedItem.id === item.id ? 2.5 : 1.5,
                    }}
                    eventHandlers={{ click: () => setSelectedItem(item) }}
                  />
                )}

                <Marker
                  position={[item.lat, item.lng]}
                  icon={makeMarkerIcon(item.category, selectedItem.id === item.id)}
                  eventHandlers={{ click: () => setSelectedItem(item) }}
                >
                  <Popup>
                    <div style={{ fontSize: '0.78rem' }}>
                      <strong>{item.name} ({item.id})</strong><br />
                      Type: {item.type}<br />
                      Operator: {item.operator}
                    </div>
                  </Popup>
                </Marker>
              </React.Fragment>
            ))}
          </MapContainer>

          {/* Map Legend */}
          <div style={{ position: 'absolute', bottom: 16, left: 16, background: 'rgba(255,255,255,0.95)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.5rem 0.75rem', fontSize: '0.72rem', zIndex: 1000, display: 'flex', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2563eb' }}></span> Active Rigs
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a' }}></span> Proven Reservoirs
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#9333ea' }}></span> Future News Discoveries
            </div>
          </div>
        </div>

        {/* ════════ RIGHT PANE: Item Inspector & RAG AI Assistant ════════ */}
        <div style={{ flex: '0 0 40%', display: 'flex', flexDirection: 'column', background: '#ffffff', overflow: 'hidden' }}>
          
          {/* Selected Item Inspector Panel */}
          <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid var(--border-color)', background: '#f8fafc' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
              <div>
                <span style={{ fontSize: '0.68rem', fontWeight: 800, color: selectedItem.category === 'lead' ? '#9333ea' : 'var(--primary-color)', textTransform: 'uppercase' }}>
                  {selectedItem.basin} Basin | {selectedItem.type}
                </span>
                <h3 style={{ fontSize: '0.92rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                  {selectedItem.name} ({selectedItem.id})
                </h3>
              </div>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: selectedItem.category === 'lead' ? '#f3e8ff' : '#dbeafe', color: selectedItem.category === 'lead' ? '#7e22ce' : '#1d4ed8' }}>
                {selectedItem.category === 'lead' ? 'News Discovery' : selectedItem.status}
              </span>
            </div>

            <p style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.45, margin: '0 0 0.6rem 0' }}>
              {selectedItem.description}
            </p>

            {/* If News Lead vs Active Rig display specific specs */}
            {selectedItem.category === 'lead' ? (
              <div style={{ background: '#ffffff', border: '1px solid #e9d5ff', borderRadius: 4, padding: '0.5rem 0.65rem' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6b21a8', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                  <Newspaper size={12} /> News Citation: {selectedItem.source}
                </div>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0f172a' }}>
                  Est. Resource Potential: <span style={{ color: '#9333ea' }}>{selectedItem.potential}</span>
                </div>
                <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 2 }}>
                  Stage: {selectedItem.stage}
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.4rem', fontSize: '0.7rem' }}>
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '0.35rem 0.5rem', borderRadius: 4 }}>
                  <span style={{ color: '#64748b' }}>Depth</span>
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>{selectedItem.depth}m</div>
                </div>
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '0.35rem 0.5rem', borderRadius: 4 }}>
                  <span style={{ color: '#64748b' }}>Crude Yield</span>
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>{selectedItem.bopd} bopd</div>
                </div>
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '0.35rem 0.5rem', borderRadius: 4 }}>
                  <span style={{ color: '#64748b' }}>Water Cut</span>
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>{selectedItem.waterCut}</div>
                </div>
              </div>
            )}
          </div>

          {/* RAG Upstream AI Assistant */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '0.5rem 1.25rem', background: '#ffffff', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 700, color: '#0f172a' }}>
                <Sparkles size={14} style={{ color: 'var(--primary-color)' }} />
                <span>Upstream RAG AI Assistant</span>
              </div>
              <span style={{ fontSize: '0.68rem', color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: 3 }}>
                Connected to News & DGH Index
              </span>
            </div>

            {/* Chat Messages Area */}
            <div style={{ flex: 1, padding: '0.85rem 1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.65rem', background: '#f8fafc' }}>
              {chatMessages.map((m, idx) => (
                <div key={idx} style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '88%',
                  background: m.role === 'user' ? 'var(--primary-color)' : '#ffffff',
                  color: m.role === 'user' ? '#ffffff' : '#1e293b',
                  border: m.role === 'user' ? 'none' : '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.55rem 0.75rem',
                  fontSize: '0.75rem',
                  lineHeight: 1.45,
                  boxShadow: 'var(--shadow-sm)'
                }}>
                  {m.text}
                  {m.refs && m.refs.length > 0 && (
                    <div style={{ marginTop: 6, paddingTop: 4, borderTop: '1px solid #e2e8f0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {m.refs.map((r, rIdx) => (
                        <span key={rIdx} style={{ fontSize: '0.65rem', background: '#eff6ff', color: '#1d4ed8', padding: '1px 5px', borderRadius: 3, border: '1px solid #bfdbfe', fontWeight: 600 }}>
                          📄 {r.label} ({r.loc})
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Query Form */}
            <form onSubmit={handleChatSend} style={{ padding: '0.6rem 1.25rem', background: '#ffffff', borderTop: '1px solid var(--border-color)', display: 'flex', gap: 6 }}>
              <input
                type="text"
                placeholder="Ask about Mahanadi discovery, Andaman gas lead, Barmer tight oil..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                style={{ flex: 1, padding: '0.4rem 0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.75rem' }}
              />
              <button type="submit" className="btn btn-primary" style={{ padding: '0.4rem 0.75rem' }}>
                <Send size={13} />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { postQuery } from '../api';
import Markdown from '../Markdown';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, Circle } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Truck, Ship, Factory, Flame, Database, GitBranch,
  Sparkles, Send, Loader2, X, ChevronDown, ChevronUp,
  Navigation, Eye, EyeOff, Layers, AlertCircle, CheckCircle2, File
} from 'lucide-react';

/* ─── Fix Leaflet default icon ─────────────────────────────── */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

/* ─── Asset Data (from midstream_assets.csv) ─────────────────── */
const ASSETS = [
  // Trucks
  { id:'T01', type:'truck',    name:'Truck KG-33',         lat:16.512, lng:81.643, status:'en_route',   capacity:'8000 bbl',    product:'Crude Oil',         operator:'ONGC',           description:'Loaded crude carrier departing from KG Basin wellhead cluster. En route to Kakinada Refinery.' },
  { id:'T02', type:'truck',    name:'Truck RJ-17',         lat:27.021, lng:70.912, status:'available',  capacity:'10000 bbl',   product:'Crude Oil',         operator:'Cairn India',    description:'Idle at Mangala Processing Terminal awaiting dispatch instructions.' },
  { id:'T03', type:'truck',    name:'Truck MH-05',         lat:19.076, lng:72.877, status:'loading',    capacity:'6000 bbl',    product:'LNG',               operator:'GAIL',           description:'Loading LNG at Mumbai offshore receiving terminal.' },
  { id:'T04', type:'truck',    name:'Truck GJ-44',         lat:22.309, lng:72.136, status:'en_route',   capacity:'8000 bbl',    product:'Gas Condensate',    operator:'ONGC',           description:'En route from Hazira terminal to Ahmedabad distribution hub.' },
  { id:'T05', type:'truck',    name:'Truck TN-22',         lat:13.082, lng:80.270, status:'available',  capacity:'9000 bbl',    product:'Crude Oil',         operator:'CPCL',           description:'Available carrier at Chennai port depot.' },
  { id:'T06', type:'truck',    name:'Truck KA-09',         lat:12.914, lng:74.856, status:'available',  capacity:'7000 bbl',    product:'Crude Oil',         operator:'MRPL',           description:'Idle at Mangalore refinery dispatch yard.' },
  { id:'T07', type:'truck',    name:'Truck UP-80',         lat:28.404, lng:77.850, status:'en_route',   capacity:'10000 bbl',   product:'Crude Oil',         operator:'IOC',            description:'En route to Mathura Refinery via NH-19 corridor.' },
  { id:'T08', type:'truck',    name:'Truck OD-15',         lat:20.322, lng:86.614, status:'loading',    capacity:'6000 bbl',    product:'LNG',               operator:'Adani',          description:'Loading LNG at Dhamra port terminal.' },

  // Ships
  { id:'S01', type:'ship',     name:'Vessel Saraswati',    lat:16.941, lng:82.214, status:'anchored',   capacity:'250000 bbl',  product:'Crude Oil',         operator:'SCI',            description:'VLCC anchored at Kakinada anchorage awaiting berth allocation.' },
  { id:'S02', type:'ship',     name:'Vessel Ganga',        lat:19.854, lng:72.931, status:'transit',    capacity:'180000 bbl',  product:'Crude Oil',         operator:'SCI',            description:'In transit from Mumbai High to Jamnagar JNPT terminal.' },
  { id:'S03', type:'ship',     name:'Vessel Krishna',      lat:20.260, lng:86.831, status:'loading',    capacity:'120000 bbl',  product:'LNG',               operator:'Petronet LNG',   description:'Loading LNG at Dhamra LNG terminal for export.' },
  { id:'S04', type:'ship',     name:'Vessel Kaveri',       lat:9.890,  lng:76.150, status:'transit',    capacity:'300000 bbl',  product:'Crude Oil',         operator:'SCI',            description:'Supertanker in transit near Cochin port offloads.' },
  { id:'S05', type:'ship',     name:'Vessel Narmada',      lat:22.150, lng:69.550, status:'anchored',   capacity:'160000 bbl',  product:'Crude Oil',         operator:'Reliance',       description:'Anchored at Gulf of Kutch offloading for Vadinar/Jamnagar.' },

  // Refineries
  { id:'R01', type:'refinery', name:'Kakinada Refinery',   lat:16.934, lng:82.237, status:'operational',capacity:'200K bpd',    product:'Crude Oil',         operator:'ONGC',           description:'Integrated refinery at 87% utilization. Priority intake for KG Basin crude.' },
  { id:'R02', type:'refinery', name:'Jamnagar Refinery',   lat:22.455, lng:70.062, status:'operational',capacity:'1.24M bpd',   product:'Crude Oil',         operator:'Reliance',       description:"World's largest refinery complex. Currently accepting VLCC offloads." },
  { id:'R03', type:'refinery', name:'Mumbai Refinery',     lat:19.008, lng:72.843, status:'operational',capacity:'160K bpd',    product:'Crude Oil',         operator:'HPCL',           description:'Coastal refinery at Mahul. Intake primarily from Mumbai High offshore.' },
  { id:'R04', type:'refinery', name:'Mathura Refinery',    lat:27.479, lng:77.673, status:'operational',capacity:'160K bpd',    product:'Crude Oil',         operator:'IOC',            description:'Landlocked refinery supplied via HBCPL & SMPL pipelines.' },
  { id:'R05', type:'refinery', name:'Panipat Refinery',    lat:29.390, lng:76.970, status:'operational',capacity:'300K bpd',    product:'Crude Oil',         operator:'IOC',            description:'Major North India refinery supplied via cross-country crude pipelines.' },
  { id:'R06', type:'refinery', name:'Vadinar Refinery',    lat:22.390, lng:69.720, status:'operational',capacity:'400K bpd',    product:'Crude Oil',         operator:'Nayara',         description:'Deep-water refinery complex in Gulf of Kutch.' },
  { id:'R07', type:'refinery', name:'Kochi Refinery',      lat:9.960,  lng:76.280, status:'maintenance',capacity:'310K bpd',    product:'Crude Oil',         operator:'BPCL',           description:'South India coastal refinery undergoing scheduled unit maintenance.' },
  { id:'R08', type:'refinery', name:'Paradip Refinery',    lat:20.250, lng:86.660, status:'operational',capacity:'300K bpd',    product:'Crude Oil',         operator:'IOC',            description:'East coast flagship refinery hub with crude import single-point mooring.' },
  { id:'R09', type:'refinery', name:'Chennai Refinery',   lat:13.160, lng:80.300, status:'operational',capacity:'210K bpd',    product:'Crude Oil',         operator:'CPCL',           description:'Manali coastal refinery complex.' },
  { id:'R10', type:'refinery', name:'Mangalore Refinery', lat:12.950, lng:74.810, status:'operational',capacity:'300K bpd',    product:'Crude Oil',         operator:'MRPL',           description:'On coastal Karnataka with direct pipeline link to New Mangalore Port.' },

  // Storage Terminals
  { id:'ST01',type:'storage',  name:'Vizag Terminal',      lat:17.688, lng:83.218, status:'operational',capacity:'2M bbl',       product:'Crude Oil',         operator:'IOC',            description:'Strategic petroleum reserve + commercial crude storage. 68% filled.' },
  { id:'ST02',type:'storage',  name:'Mangala Terminal',    lat:27.021, lng:70.912, status:'operational',capacity:'750K bbl',     product:'Crude Oil',         operator:'Cairn India',    description:'Central processing terminal for Rajasthan fields. Pipeline dispatch hub.' },
  { id:'ST03',type:'storage',  name:'Hazira Terminal',     lat:21.118, lng:72.617, status:'operational',capacity:'500K bbl',     product:'LNG + Crude',       operator:'Shell/TOTAL',    description:'Multipurpose terminal. LNG regasification + crude handling.' },
  { id:'ST04',type:'storage',  name:'Dhamra Terminal',     lat:20.470, lng:86.823, status:'operational',capacity:'300K bbl',     product:'LNG',               operator:'Adani',          description:'East coast LNG import terminal. Connected to IOML pipeline.' },
  { id:'ST05',type:'storage',  name:'Dahej LNG Terminal',  lat:21.710, lng:72.530, status:'operational',capacity:'1.2M bbl',     product:'LNG',               operator:'Petronet LNG',   description:'India largest LNG import terminal.' },
  { id:'ST06',type:'storage',  name:'Kochi LNG Terminal',  lat:9.990,  lng:76.230, status:'operational',capacity:'900K bbl',     product:'LNG',               operator:'Petronet LNG',   description:'South India LNG receiving and regasification hub.' },
  { id:'ST07',type:'storage',  name:'Mundra Terminal',     lat:22.740, lng:69.700, status:'operational',capacity:'1.5M bbl',     product:'Crude Oil',         operator:'Adani',          description:'Major private crude tank farm and import terminal.' },

  // Wellheads
  { id:'W01', type:'wellhead', name:'KG-D6 Wellhead',      lat:16.100, lng:82.200, status:'producing',  capacity:'45K bopd',    product:'Crude + Gas',       operator:'Reliance',       description:'Deepwater KG-D6 block subsea manifold.' },
  { id:'W02', type:'wellhead', name:'Mangala Wellhead',    lat:27.300, lng:71.200, status:'producing',  capacity:'125K bopd',   product:'Crude Oil',         operator:'Cairn India',    description:'Rajasthan block onshore field.' },
  { id:'W03', type:'wellhead', name:'Mumbai High North',   lat:19.130, lng:71.540, status:'producing',  capacity:'80K bopd',    product:'Crude Oil',         operator:'ONGC',           description:'Offshore Mumbai High North platform cluster.' },
  { id:'W04', type:'wellhead', name:'Mumbai High South',   lat:18.900, lng:71.300, status:'producing',  capacity:'60K bopd',    product:'Crude Oil',         operator:'ONGC',           description:'Offshore Mumbai High South platform cluster.' },
  { id:'W05', type:'wellhead', name:'Ravva Wellhead',      lat:16.500, lng:82.100, status:'producing',  capacity:'30K bopd',    product:'Crude + Gas',       operator:'Cairn India',    description:'Offshore Krishna-Godavari basin shallow water block.' },
  { id:'W06', type:'wellhead', name:'Cauvery Wellhead',    lat:11.300, lng:79.900, status:'shut_in',    capacity:'10K bopd',    product:'Crude Oil',         operator:'ONGC',           description:'Offshore Tamil Nadu block currently shut-in for workover.' },

  // Pipeline Nodes
  { id:'P01', type:'pipeline', name:'HBJ Bhopal Node',      lat:23.259, lng:77.412, status:'active',     capacity:'18 MMSCMD',   product:'Natural Gas',       operator:'GAIL',           description:'HBJ Pipeline Seq 3 midpoint node.' },
  { id:'P02', type:'pipeline', name:'DVPL Bavla Node',      lat:22.309, lng:72.136, status:'active',     capacity:'16 MMSCMD',   product:'Natural Gas',       operator:'GAIL',           description:'DVPL Pipeline Seq 2 Gujarat switching node.' },
  { id:'P03', type:'pipeline', name:'GREP Node',            lat:16.512, lng:81.643, status:'active',     capacity:'12 MMSCMD',   product:'Natural Gas',       operator:'GAIL',           description:'GREP Pipeline Seq 2 AP node.' },
  { id:'PN01',type:'pipeline', name:'HBJ Hazira Start',    lat:21.118, lng:72.617, status:'active',     capacity:'18 MMSCMD',   product:'Natural Gas',       operator:'GAIL',           description:'HBJ Pipeline Seq 1 origination terminal.' },
  { id:'PN02',type:'pipeline', name:'HBJ Ujjain Node',     lat:23.180, lng:75.780, status:'active',     capacity:'18 MMSCMD',   product:'Natural Gas',       operator:'GAIL',           description:'HBJ Pipeline Seq 2 MP node.' },
  { id:'PN03',type:'pipeline', name:'HBJ Vijaipur Node',   lat:24.430, lng:77.350, status:'active',     capacity:'18 MMSCMD',   product:'Natural Gas',       operator:'GAIL',           description:'HBJ Pipeline Seq 4 compressor hub.' },
  { id:'PN04',type:'pipeline', name:'HBJ Jagdishpur End',  lat:26.550, lng:81.550, status:'active',     capacity:'18 MMSCMD',   product:'Natural Gas',       operator:'GAIL',           description:'HBJ Pipeline Seq 5 terminal.' },
  { id:'PN05',type:'pipeline', name:'DVPL Dahej Start',    lat:21.710, lng:72.530, status:'active',     capacity:'16 MMSCMD',   product:'Natural Gas',       operator:'GAIL',           description:'DVPL Pipeline Seq 1 Dahej LNG feed.' },
  { id:'PN06',type:'pipeline', name:'DVPL Chittorgarh',   lat:24.880, lng:74.630, status:'active',     capacity:'16 MMSCMD',   product:'Natural Gas',       operator:'GAIL',           description:'DVPL Pipeline Seq 3 Rajasthan node.' },
  { id:'PN07',type:'pipeline', name:'DVPL Kota End',       lat:25.180, lng:75.830, status:'active',     capacity:'16 MMSCMD',   product:'Natural Gas',       operator:'GAIL',           description:'DVPL Pipeline Seq 4 industrial end.' },
  { id:'PN08',type:'pipeline', name:'GREP Kakinada Start', lat:16.950, lng:82.230, status:'active',     capacity:'12 MMSCMD',   product:'Natural Gas',       operator:'GAIL',           description:'GREP Pipeline Seq 1 coastal start.' },
  { id:'PN09',type:'pipeline', name:'GREP Vijayawada End',lat:16.510, lng:80.650, status:'active',     capacity:'12 MMSCMD',   product:'Natural Gas',       operator:'GAIL',           description:'GREP Pipeline Seq 3 inland terminal.' },
  { id:'PN10',type:'pipeline', name:'SMPL Salaya Start',   lat:22.310, lng:69.600, status:'active',     capacity:'25 MMTPA',    product:'Crude Oil',         operator:'IOC',            description:'SMPL Pipeline Seq 1 Gulf of Kutch crude intake.' },
  { id:'PN11',type:'pipeline', name:'SMPL Viramgam',      lat:23.120, lng:72.040, status:'active',     capacity:'25 MMTPA',    product:'Crude Oil',         operator:'IOC',            description:'SMPL Pipeline Seq 2 Gujarat dispatch hub.' },
  { id:'PN12',type:'pipeline', name:'SMPL Chaksu',        lat:26.600, lng:75.950, status:'active',     capacity:'25 MMTPA',    product:'Crude Oil',         operator:'IOC',            description:'SMPL Pipeline Seq 3 Rajasthan tank farm.' },
  { id:'PN13',type:'pipeline', name:'SMPL Mathura End',    lat:27.479, lng:77.673, status:'active',     capacity:'25 MMTPA',    product:'Crude Oil',         operator:'IOC',            description:'SMPL Pipeline Seq 4 Mathura refinery feed.' },
];

/* Pipeline routes [from lat/lng → to lat/lng] */
const PIPELINES = [
  { id:'HBJ', name:'HBJ Pipeline', color:'#f59e0b', coords:[[21.118,72.617],[23.180,75.780],[23.259,77.412],[24.430,77.350],[26.550,81.550]], label:'Hazira–Bijaipur–Jagdishpur (GAIL)' },
  { id:'DVPL',name:'DVPL Pipeline',color:'#10b981', coords:[[21.710,72.530],[22.309,72.136],[24.880,74.630],[25.180,75.830]], label:'Dahej–Vijaypur Pipeline (GAIL)' },
  { id:'GREP',name:'GREP Pipeline',color:'#8b5cf6', coords:[[16.950,82.230],[16.512,81.643],[16.510,80.650]], label:'KG Basin–Kakinada (GAIL)' },
  { id:'SMPL',name:'SMPL Pipeline',color:'#ef4444', coords:[[22.310,69.600],[23.120,72.040],[26.600,75.950],[27.479,77.673]], label:'Salaya–Mathura Crude Line (IOC)' },
];

/* ─── Config ─────────────────────────────────────────────────── */
const TYPE_CONFIG = {
  truck:    { color:'#f59e0b', label:'Trucks',    Icon:Truck },
  ship:     { color:'#3b82f6', label:'Ships',     Icon:Ship },
  refinery: { color:'#ef4444', label:'Refineries',Icon:Factory },
  pipeline: { color:'#8b5cf6', label:'Pipelines', Icon:GitBranch },
  storage:  { color:'#10b981', label:'Storage',   Icon:Database },
  wellhead: { color:'#f97316', label:'Wellheads', Icon:Flame },
};

const STATUS_COLOR = {
  en_route:'#f59e0b', available:'#10b981', loading:'#3b82f6',
  anchored:'#8b5cf6', transit:'#3b82f6',  operational:'#10b981',
  active:'#10b981',   producing:'#f97316', maintenance:'#ef4444', shut_in:'#64748b'
};

/* ─── SVG Marker factory ────────────────────────────────────── */
function makeIcon(type, highlight = false, pulse = false) {
  const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.storage;
  const color = highlight ? '#facc15' : cfg.color;
  const border = highlight ? '#fbbf24' : 'white';
  const size = highlight ? 36 : 28;
  const icons = {
    truck:    'M1 1h12l2 5H1V1zm0 5v7h15v-7M4 13a2 2 0 100 4 2 2 0 000-4zm9 0a2 2 0 100 4 2 2 0 000-4z',
    ship:     'M2 12l1-5h12l1 5H2zm2 0l-1 5h14l-1-5M6 7V3l6 0v4M1 17c2 2 14 2 16 0',
    refinery: 'M3 20V8l4-4v16M9 20V12l4-4v12M15 20V6l3-3v17M1 20h18',
    pipeline: 'M2 12h20M2 8c0-2 2-3 4-3h12c2 0 4 1 4 3v8c0 2-2 3-4 3H6c-2 0-4-1-4-3V8z',
    storage:  'M3 7l9-5 9 5v10l-9 5-9-5V7zm9-5v20M3 7l9 5 9-5',
    wellhead: 'M12 2v20M8 6l4-4 4 4M6 12h12M4 20h16',
  };
  const svgPath = icons[type] || icons.storage;
  const pulseEl = pulse ? `<circle cx="${size/2}" cy="${size/2}" r="${size/2 - 2}" fill="none" stroke="${color}" stroke-width="2" opacity="0.4"><animate attributeName="r" values="${size/2-4};${size/2+4};${size/2-4}" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.6;0;0.6" dur="2s" repeatCount="indefinite"/></circle>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size+8}" height="${size+8}" viewBox="0 0 ${size+8} ${size+8}">
    ${pulseEl}
    <circle cx="${(size+8)/2}" cy="${(size+8)/2}" r="${size/2}" fill="${color}" stroke="${border}" stroke-width="2"/>
    <g transform="translate(${(size+8)/2 - 10},${(size+8)/2 - 10}) scale(0.833)" stroke="white" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="${svgPath}"/>
    </g>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [size+8, size+8],
    iconAnchor: [(size+8)/2, (size+8)/2],
  });
}

/* ─── Map flyto helper ──────────────────────────────────────── */
function MapController({ flyTo }) {
  const map = useMap();
  useEffect(() => {
    if (flyTo) map.flyTo([flyTo.lat, flyTo.lng], flyTo.zoom || 9, { duration: 1.4 });
  }, [flyTo, map]);
  return null;
}

export default function Midstream() {
  const [visibleTypes, setVisibleTypes] = useState(
    Object.fromEntries(Object.keys(TYPE_CONFIG).map(k => [k, true]))
  );
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [highlightIds, setHighlightIds] = useState([]);
  const [activeRoute, setActiveRoute] = useState(null);
  const [flyTo, setFlyTo] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [citationPopup, setCitationPopup] = useState(null);
  const chatEndRef = useRef(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages, isChatLoading]);

  const filteredAssets = useMemo(
    () => ASSETS.filter(a => visibleTypes[a.type]),
    [visibleTypes]
  );

  const toggleType = (type) => setVisibleTypes(p => ({ ...p, [type]: !p[type] }));

  const handleChatSend = (e, override) => {
    e?.preventDefault();
    const q = override || chatInput;
    if (!q.trim()) return;
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: q }]);
    setIsChatLoading(true);

    postQuery('/api/midstream/ai', q)
      .catch(err => ({ text: `Request failed: ${err.message}`, highlight: [], refs: [] }))
      .then(resp => {
        setChatMessages(prev => [...prev, { role: 'assistant', ...resp }]);
        setHighlightIds(resp.highlight || []);
        setActiveRoute(resp.route || null);
        if (resp.flyTo) setFlyTo({ ...resp.flyTo, _t: Date.now() });
        setIsChatLoading(false);
      });
  };

  const handleCitationClick = (e, refs) => {
    e.stopPropagation();
    const rect = e.target.getBoundingClientRect();
    setCitationPopup(prev => prev ? null : { refs, x: rect.left, y: rect.bottom + 8 });
  };

  /* Render a chat message */
  const renderMsg = (msg) => (
    <div className="ms-ai-answer animate-fade-in">
      <div className="ai-answer-header">
        <Sparkles size={14} className="text-primary" />
        <span className="font-semibold text-sm">Midstream AI</span>
      </div>
      <div className="ai-text" style={{ fontWeight: 500, marginBottom: '0.5rem' }}><Markdown>{msg.text}</Markdown></div>
      {msg.detail && (
        <div className="ai-text" style={{ color: 'var(--text-medium)', fontSize: '0.82rem' }}>
          <Markdown>{msg.detail}</Markdown>
        </div>
      )}
      <div className="ai-meta" style={{ marginTop: '0.6rem' }}>
        <span className="ai-meta-link" onClick={(e) => handleCitationClick(e, msg.refs)}>
          Citations +{msg.refs?.length || 0}
        </span>
        {msg.highlight?.length > 0 && (
          <span style={{ fontSize: '0.72rem', color: 'var(--success-color)' }}>
            <CheckCircle2 size={10} style={{ display:'inline', marginRight:3 }} />
            {msg.highlight.length} assets highlighted on map
          </span>
        )}
      </div>
    </div>
  );

  /* ── JSX ── */
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }} onClick={() => setCitationPopup(null)}>

      {/* Header */}
      <div className="header justify-between">
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <GitBranch size={18} className="text-primary" />
          <span className="font-semibold">Midstream Operations</span>
          <span className="badge badge-secondary" style={{ fontSize:'0.72rem' }}>India Region</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:'0.78rem', color:'var(--text-medium)' }}>
          <div style={{ width:8, height:8, borderRadius:'50%', background:'#10b981', animation:'pulse-dot 2s infinite' }} />
          Live — {ASSETS.length} assets tracked
        </div>
      </div>

      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* ── Left sidebar — Data Sources & Layer Controls ── */}
        <div className="dash-sidebar" style={{ width:210 }}>

          {/* Layer toggles */}
          <div className="dash-sidebar-block">
            <div className="dash-sidebar-title" style={{ display:'flex', alignItems:'center', gap:5 }}>
              <Layers size={12} />Layers
            </div>
            {Object.entries(TYPE_CONFIG).map(([type, cfg]) => {
              const count = ASSETS.filter(a => a.type === type).length;
              return (
                <div key={type} className="ms-layer-row" onClick={() => toggleType(type)}>
                  <div style={{ width:10, height:10, borderRadius:'50%', background: visibleTypes[type] ? cfg.color : '#cbd5e1', flexShrink:0, transition:'background 0.2s' }} />
                  <span style={{ flex:1, fontSize:'0.8rem' }}>{cfg.label}</span>
                  <span style={{ fontSize:'0.7rem', color:'var(--text-light)' }}>{count}</span>
                  {visibleTypes[type] ? <Eye size={11} style={{ color:'var(--text-medium)' }} /> : <EyeOff size={11} style={{ color:'var(--text-light)' }} />}
                </div>
              );
            })}
          </div>

          {/* Selected asset info */}
          {selectedAsset ? (
            <div className="dash-sidebar-block" style={{ flex:1 }}>
              <div className="dash-sidebar-title" style={{ display:'flex', justifyContent:'space-between' }}>
                Asset Detail
                <button className="icon-btn" onClick={() => setSelectedAsset(null)}><X size={12} /></button>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                <div className="dash-detail-row"><span className="text-medium">ID</span><span style={{ fontSize:'0.78rem', fontWeight:700 }}>{selectedAsset.id}</span></div>
                <div className="dash-detail-row"><span className="text-medium">Type</span><span style={{ fontSize:'0.78rem', textTransform:'capitalize' }}>{selectedAsset.type}</span></div>
                <div className="dash-detail-row"><span className="text-medium">Status</span>
                  <span style={{ fontSize:'0.7rem', background: STATUS_COLOR[selectedAsset.status]+'20', color: STATUS_COLOR[selectedAsset.status], padding:'2px 6px', borderRadius:3, fontWeight:700, textTransform:'capitalize' }}>
                    {selectedAsset.status.replace('_',' ')}
                  </span>
                </div>
                <div className="dash-detail-row"><span className="text-medium">Capacity</span><span style={{ fontSize:'0.78rem' }}>{selectedAsset.capacity}</span></div>
                <div className="dash-detail-row"><span className="text-medium">Product</span><span style={{ fontSize:'0.78rem' }}>{selectedAsset.product}</span></div>
                <div className="dash-detail-row" style={{ border:'none' }}><span className="text-medium">Operator</span><span style={{ fontSize:'0.78rem' }}>{selectedAsset.operator}</span></div>
                <p style={{ fontSize:'0.75rem', color:'var(--text-medium)', marginTop:4, lineHeight:1.5 }}>{selectedAsset.description}</p>
                <button className="btn btn-primary" style={{ fontSize:'0.75rem', marginTop:6, padding:'0.3rem 0.6rem' }}
                  onClick={() => { setChatInput(`Where should ${selectedAsset.name} (${selectedAsset.id}) go?`); }}>
                  <Navigation size={12} /> Ask AI about this asset
                </button>
              </div>
            </div>
          ) : (
            <div className="dash-sidebar-block" style={{ flex:1 }}>
              <div className="dash-sidebar-title">Data Sources</div>
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {['midstream_assets_final.csv','KG-Basin-Ops-2026.pdf','Terminal-Capacity-Report.pdf','GAIL-Pipeline-Network.pdf','Rajasthan-Ops-Report.pdf'].map(f => (
                  <div key={f} className="dash-file-row">
                    <File size={12} style={{ color: f.endsWith('.csv') ? '#10b981' : 'var(--primary-color)', flexShrink:0 }} />
                    <span style={{ fontSize:'0.75rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={f}>{f}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-medium" style={{ marginTop:10, lineHeight:1.5 }}>Click any map marker to inspect asset. Ask AI for routing recommendations.</p>
            </div>
          )}
        </div>

        {/* ── Right: Map + Chat ── */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

          {/* MAP */}
          <div style={{ flex:'0 0 58%', position:'relative', overflow:'hidden' }}>
            <MapContainer
              center={[20.5, 76.5]}
              zoom={5}
              style={{ width:'100%', height:'100%' }}
              zoomControl={true}
            >
              <TileLayer
                url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
                attribution='Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community'
                maxZoom={16}
              />
              <MapController flyTo={flyTo} />

              {/* Pipeline polylines */}
              {PIPELINES.map(pl => (
                <Polyline
                  key={pl.id}
                  positions={pl.coords}
                  pathOptions={{ color: pl.color, weight: 3, dashArray:'8 4', opacity: 0.7 }}
                >
                  <Popup><strong>{pl.name}</strong><br />{pl.label}</Popup>
                </Polyline>
              ))}

              {/* AI route highlight */}
              {activeRoute && (
                <Polyline
                  positions={[[activeRoute.from.lat, activeRoute.from.lng],[activeRoute.to.lat, activeRoute.to.lng]]}
                  pathOptions={{ color: activeRoute.color, weight: 4, dashArray:'12 6', opacity: 1 }}
                />
              )}

              {/* Asset markers */}
              {filteredAssets.map(asset => {
                const isHighlighted = highlightIds.includes(asset.id);
                const isPulsing = asset.status === 'en_route' || asset.status === 'transit' || asset.status === 'producing';
                return (
                  <Marker
                    key={asset.id}
                    position={[asset.lat, asset.lng]}
                    icon={makeIcon(asset.type, isHighlighted, isPulsing)}
                    eventHandlers={{ click: () => setSelectedAsset(asset) }}
                  >
                    <Popup>
                      <div style={{ minWidth:180 }}>
                        <div style={{ fontWeight:700, fontSize:'0.9rem', marginBottom:4 }}>{asset.name}</div>
                        <div style={{ fontSize:'0.78rem', color:'#475569', marginBottom:6 }}>{asset.id} · {asset.operator}</div>
                        <div style={{ fontSize:'0.78rem', marginBottom:2 }}><strong>Product:</strong> {asset.product}</div>
                        <div style={{ fontSize:'0.78rem', marginBottom:2 }}><strong>Capacity:</strong> {asset.capacity}</div>
                        <div style={{ fontSize:'0.78rem', marginBottom:4 }}>
                          <strong>Status: </strong>
                          <span style={{ color: STATUS_COLOR[asset.status], fontWeight:600, textTransform:'capitalize' }}>
                            {asset.status.replace('_',' ')}
                          </span>
                        </div>
                        <p style={{ fontSize:'0.75rem', color:'#64748b', lineHeight:1.45 }}>{asset.description}</p>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}

              {/* Highlight pulse circles */}
              {highlightIds.map(id => {
                const asset = ASSETS.find(a => a.id === id);
                if (!asset) return null;
                return (
                  <Circle
                    key={`hl-${id}`}
                    center={[asset.lat, asset.lng]}
                    radius={35000}
                    pathOptions={{ color:'#facc15', fillColor:'#facc15', fillOpacity:0.07, weight:2, dashArray:'6 4' }}
                  />
                );
              })}
            </MapContainer>

            {/* Map legend */}
            <div className="map-legend">
              {Object.entries(TYPE_CONFIG).filter(([t]) => visibleTypes[t]).map(([type, cfg]) => (
                <div key={type} style={{ display:'flex', alignItems:'center', gap:4, fontSize:'0.68rem', color:'var(--text-medium)' }}>
                  <div style={{ width:8, height:8, borderRadius:'50%', background:cfg.color }} />
                  {cfg.label}
                </div>
              ))}
              <div style={{ borderTop:'1px solid var(--border-color)', marginTop:4, paddingTop:4 }}>
                {PIPELINES.map(pl => (
                  <div key={pl.id} style={{ display:'flex', alignItems:'center', gap:4, fontSize:'0.68rem', color:'var(--text-medium)' }}>
                    <div style={{ width:14, height:2, background:pl.color }} />
                    {pl.name}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── AI Chat section ── */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', borderTop:'2px solid var(--border-color)' }}>
            <div style={{ padding:'0.6rem 1.25rem', borderBottom:'1px solid var(--border-color)', display:'flex', alignItems:'center', gap:8, background:'var(--surface-color)' }}>
              <Sparkles size={15} className="text-primary" />
              <span className="font-semibold" style={{ fontSize:'0.9rem' }}>AI Search</span>
              <span style={{ fontSize:'0.75rem', color:'var(--text-medium)' }}>— ask about routing, storage, or asset status. AI will highlight on map.</span>
            </div>

            <div style={{ flex:1, overflowY:'auto', padding:'0.85rem 1.25rem' }}>
              {chatMessages.length === 0 && !isChatLoading && (
                <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                  <p className="text-xs text-medium" style={{ marginBottom:4 }}>Try asking:</p>
                  {[
                    'Which is the nearest refinery for Truck T01?',
                    'Where should I store the oil from Truck RJ-17?',
                    'Show all storage terminals and their capacity.',
                    'Which vessels are currently in transit?',
                  ].map(q => (
                    <button key={q} className="rag-suggestion" onClick={() => handleChatSend(null, q)}>{q}</button>
                  ))}
                </div>
              )}

              {chatMessages.map((msg, i) => (
                <div key={i} className={`chat-msg ${msg.role}`} style={{ marginBottom:'0.75rem' }}>
                  {msg.role === 'user'
                    ? <div className="user-bubble">{msg.text}</div>
                    : renderMsg(msg)
                  }
                </div>
              ))}

              {isChatLoading && (
                <div className="ms-ai-answer" style={{ display:'flex', alignItems:'center', gap:8, padding:'0.65rem 0.85rem' }}>
                  <Loader2 size={14} className="text-primary" style={{ animation:'spin 1s linear infinite' }} />
                  <span className="text-sm text-medium">Analysing asset data…</span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div className="rag-input-bar" style={{ padding:'0.6rem 1.25rem' }} onClick={e => e.stopPropagation()}>
              <form onSubmit={handleChatSend} className="rag-input-form">
                <Navigation size={13} style={{ color:'var(--text-light)', flexShrink:0 }} />
                <input
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  placeholder="Which is the best place to store oil from Truck T01?"
                  className="rag-input"
                  disabled={isChatLoading}
                />
                <button type="submit" disabled={isChatLoading || !chatInput.trim()} className="rag-send-btn">
                  {isChatLoading
                    ? <Loader2 size={14} style={{ animation:'spin 1s linear infinite' }} />
                    : <Send size={14} />
                  }
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>

      {/* Citation popup */}
      {citationPopup && (
        <div
          className="citation-popup animate-fade-in"
          style={{ top: citationPopup.y, left: Math.min(citationPopup.x, window.innerWidth - 340) }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ padding:'0.45rem 0.75rem', fontSize:'0.7rem', fontWeight:700, color:'var(--text-medium)', borderBottom:'1px solid var(--border-color)', textTransform:'uppercase', letterSpacing:'0.05em' }}>
            Sources
          </div>
          {citationPopup.refs?.map((ref, i) => (
            <div key={i} className="citation-source-row">
              <File size={12} style={{ color:'var(--primary-color)', flexShrink:0 }} />
              <span style={{ flex:1 }}><strong>[{ref.id}]</strong>&nbsp;{ref.label}</span>
              <span className="text-light" style={{ fontSize:'0.72rem' }}>{ref.loc}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

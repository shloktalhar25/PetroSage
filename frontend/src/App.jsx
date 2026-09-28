import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Search, FileText, Activity, MessageSquare, Menu, Settings, GitBranch, Scale, Flame } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import DataSearch from './pages/DataSearch';
import DataExtraction from './pages/DataExtraction';
import Midstream from './pages/Midstream';
import Regulations from './pages/Regulations';
import Upstream from './pages/Upstream';

function Sidebar() {
  const location = useLocation();

  const navItems = [
    { path: '/', icon: <Search size={20} />, label: 'Market & Asset Search' },
    { path: '/review', icon: <FileText size={20} />, label: 'Intelligence Review' },
    { path: '/upstream', icon: <Flame size={20} />, label: 'Upstream Operations & Rigs' },
    { path: '/midstream', icon: <GitBranch size={20} />, label: 'Midstream' },
    { path: '/regulations', icon: <Scale size={20} />, label: 'Oil & Gas Laws & Regulations' },
    { path: '/extraction', icon: <Activity size={20} />, label: 'Data Extraction' },
  ];

  return (
    <div className="sidebar">
      <div className="sidebar-icon" style={{ color: 'var(--primary-color)' }}>
        <Menu size={24} />
      </div>
      <div className="flex flex-col gap-4 mt-4" style={{ flex: 1 }}>
        {navItems.map((item) => (
          <Link key={item.path} to={item.path}>
            <div className={`sidebar-icon ${location.pathname === item.path ? 'active' : ''}`} title={item.label}>
              {item.icon}
            </div>
          </Link>
        ))}
      </div>
      <div className="sidebar-icon">
        <Settings size={20} />
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <div className="app-container">
        <Sidebar />
        <div className="main-content">
          <Routes>
            <Route path="/" element={<DataSearch />} />
            <Route path="/review" element={<Dashboard />} />
            <Route path="/upstream" element={<Upstream />} />
            <Route path="/midstream" element={<Midstream />} />
            <Route path="/regulations" element={<Regulations />} />
            <Route path="/extraction" element={<DataExtraction />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;

import { useState } from 'react';
import './BrowserCapture.css';

interface CaptureTab {
  id: 'scan' | 'resources' | 'history' | 'inspector';
  label: string;
}

const TABS: CaptureTab[] = [
  { id: 'scan', label: 'SCAN' },
  { id: 'resources', label: 'RESOURCES' },
  { id: 'history', label: 'HISTORY' },
  { id: 'inspector', label: 'INSPECTOR' },
];

export function BrowserCapture() {
  const [url, setUrl] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [activeTab, setActiveTab] = useState<'scan' | 'resources' | 'history' | 'inspector'>('scan');
  const [isCapturing, setIsCapturing] = useState(false);
  const [stats, setStats] = useState({ files: 0, scans: 0, status: 'IDLE' });

  const handleCapture = async () => {
    if (!targetUrl) return;
    setIsCapturing(true);
    try {
      const response = await fetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });
      const data = await response.json();
      setStats({ files: data.files || 0, scans: 1, status: 'COMPLETE' });
    } catch (error) {
      setStats({ ...stats, status: 'ERROR' });
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <div className="browser-capture">
      {/* Address Bar */}
      <div className="address-bar">
        <div className="status-indicator" />
        <input
          type="text"
          placeholder="https://example.com"
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleCapture()}
          className="address-input"
        />
        <button onClick={handleCapture} disabled={isCapturing} className="capture-btn">
          {isCapturing ? '⟳' : '▶'} Capture
        </button>
      </div>

      {/* Viewport */}
      <div className="viewport">
        {targetUrl ? (
          <iframe src={targetUrl} className="viewport-frame" sandbox="allow-same-origin allow-scripts allow-forms" />
        ) : (
          <div className="viewport-placeholder">AWAITING TARGET URL</div>
        )}
      </div>

      {/* Tabs */}
      <div className="tabs-bar">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Compact Toolbar */}
      <div className={`toolbar ${activeTab}`}>
        {activeTab === 'scan' && (
          <div className="toolbar-content">
            <div className="field-group">
              <span className="field-label">Max interactions</span>
              <span className="field-value">20</span>
            </div>
            <div className="field-group">
              <span className="field-label">Timeout</span>
              <span className="field-value">45000 ms</span>
            </div>
            <div className="field-group">
              <span className="field-label">Mode</span>
              <span className="field-value">Reuse session</span>
            </div>
            <div className="actions">
              <button className="action-btn">ZIP</button>
              <button className="action-btn">JSON</button>
              <button className="action-btn">Report</button>
            </div>
          </div>
        )}

        {activeTab === 'resources' && (
          <div className="toolbar-content">
            <input type="text" placeholder="Search by URL, mime, path..." className="search-field" />
            <select className="filter-select">
              <option>All types</option>
              <option>HTML</option>
              <option>CSS</option>
              <option>JavaScript</option>
              <option>Images</option>
              <option>Fonts</option>
            </select>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="toolbar-content">
            <div className="history-empty">No captures yet</div>
          </div>
        )}

        {activeTab === 'inspector' && (
          <div className="toolbar-content">
            <div className="inspector-empty">Select a resource to inspect</div>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="status-bar">
        <span>FILES: <strong>{stats.files}</strong></span>
        <span>SCANS: <strong>{stats.scans}</strong></span>
        <span>STATUS: <strong className={`status-${stats.status.toLowerCase()}`}>{stats.status}</strong></span>
      </div>
    </div>
  );
}

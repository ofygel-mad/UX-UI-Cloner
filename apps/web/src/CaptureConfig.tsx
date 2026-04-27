import { useState } from 'react';
import './CaptureConfig.css';

export type LoginAction =
  | { type: 'goto'; url: string }
  | { type: 'fill'; selector: string; value: string }
  | { type: 'click'; selector: string; waitMs?: number }
  | { type: 'wait'; selector: string; timeoutMs?: number }
  | { type: 'screenshot'; path?: string };

interface AuthSession {
  sourceUrl: string;
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
  }>;
  storages: Array<{
    origin: string;
    localStorage: Record<string, string>;
    sessionStorage: Record<string, string>;
  }>;
}

interface CaptureConfigState {
  url: string;
  maxActions: number;
  timeout: number;
  domainInclude: string;
  domainExclude: string;
  pathExclusions: string;
  crawlDepth: number;
  adminMode: boolean;
  useAuth: boolean;
  authSession: AuthSession | null;
  loginSteps: LoginAction[];
}

export function CaptureConfig({ onCapture }: { onCapture: (config: any) => void }) {
  const [state, setState] = useState<CaptureConfigState>({
    url: '',
    maxActions: 20,
    timeout: 45000,
    domainInclude: '',
    domainExclude: '',
    pathExclusions: '',
    crawlDepth: 3,
    adminMode: false,
    useAuth: false,
    authSession: null,
    loginSteps: [
      { type: 'goto', url: '' }
    ]
  });

  const [isCapturing, setIsCapturing] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);

  const handleCapture = async () => {
    setIsCapturing(true);
    try {
      const config: any = {
        url: state.url,
        maxActionsPerPage: state.maxActions,
        timeoutMs: state.timeout
      };

      if (state.adminMode) {
        config.adminMode = true;
      }

      if (state.crawlDepth > 1) {
        config.crawlDepth = state.crawlDepth;
      }

      if (state.domainInclude || state.domainExclude) {
        config.domainFilter = {};
        if (state.domainInclude) {
          config.domainFilter.include = state.domainInclude
            .split(',')
            .map(d => d.trim())
            .filter(Boolean);
        }
        if (state.domainExclude) {
          config.domainFilter.exclude = state.domainExclude
            .split(',')
            .map(d => d.trim())
            .filter(Boolean);
        }
      }

      if (state.pathExclusions) {
        config.pathExclusions = state.pathExclusions
          .split('\n')
          .map(p => p.trim())
          .filter(Boolean);
      }

      if (state.useAuth && state.authSession) {
        config.session = state.authSession;
      }

      onCapture(config);
    } finally {
      setIsCapturing(false);
    }
  };

  const handleAuthCapture = async () => {
    if (!state.loginSteps.length) return;
    setLoginLoading(true);
    try {
      const response = await fetch('/api/auth-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actions: state.loginSteps,
          timeoutMs: 60000
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to capture session');
      }

      const session = await response.json();
      setState(prev => ({ ...prev, authSession: session, useAuth: true }));
    } catch (err) {
      alert(`Auth capture failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoginLoading(false);
    }
  };

  const addLoginStep = () => {
    setState(prev => ({
      ...prev,
      loginSteps: [...prev.loginSteps, { type: 'click' as const, selector: '' }]
    }));
  };

  const updateLoginStep = (index: number, updates: Partial<LoginAction>) => {
    setState(prev => ({
      ...prev,
      loginSteps: prev.loginSteps.map((step, i) =>
        i === index ? { ...step, ...updates } : step
      ) as LoginAction[]
    }));
  };

  const removeLoginStep = (index: number) => {
    setState(prev => ({
      ...prev,
      loginSteps: prev.loginSteps.filter((_, i) => i !== index)
    }));
  };

  return (
    <div className="capture-config">
      {/* Basic Settings */}
      <section className="config-section">
        <h3>Basic Settings</h3>
        <div className="config-grid">
          <label>
            <span className="label-text">Target URL</span>
            <input
              type="text"
              value={state.url}
              onChange={e => setState(prev => ({ ...prev, url: e.target.value }))}
              placeholder="https://example.com"
            />
          </label>
          <label>
            <span className="label-text">Max Actions</span>
            <input
              type="number"
              min={0}
              max={50}
              value={state.maxActions}
              onChange={e => setState(prev => ({ ...prev, maxActions: Number(e.target.value) }))}
            />
          </label>
          <label>
            <span className="label-text">Timeout (ms)</span>
            <input
              type="number"
              min={5000}
              max={120000}
              step={1000}
              value={state.timeout}
              onChange={e => setState(prev => ({ ...prev, timeout: Number(e.target.value) }))}
            />
          </label>
          <label>
            <span className="label-text">Crawl Depth</span>
            <input
              type="number"
              min={1}
              max={10}
              value={state.crawlDepth}
              onChange={e => setState(prev => ({ ...prev, crawlDepth: Number(e.target.value) }))}
            />
          </label>
        </div>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={state.adminMode}
            onChange={e => setState(prev => ({ ...prev, adminMode: e.target.checked }))}
          />
          Admin Mode (aggressive interactions for admin panels)
        </label>
      </section>

      {/* Domain Filters */}
      <section className="config-section">
        <h3>Domain Filters</h3>
        <div className="config-grid">
          <label>
            <span className="label-text">Include Domains (comma-separated)</span>
            <textarea
              value={state.domainInclude}
              onChange={e => setState(prev => ({ ...prev, domainInclude: e.target.value }))}
              placeholder="example.com,api.example.com"
              rows={2}
            />
          </label>
          <label>
            <span className="label-text">Exclude Domains (comma-separated)</span>
            <textarea
              value={state.domainExclude}
              onChange={e => setState(prev => ({ ...prev, domainExclude: e.target.value }))}
              placeholder="cdn.jsdelivr.net,google-analytics.com"
              rows={2}
            />
          </label>
        </div>
      </section>

      {/* Path Exclusions */}
      <section className="config-section">
        <h3>Path Exclusions</h3>
        <label>
          <span className="label-text">Paths to Skip (one per line)</span>
          <textarea
            value={state.pathExclusions}
            onChange={e => setState(prev => ({ ...prev, pathExclusions: e.target.value }))}
            placeholder="/logout&#10;/api/delete&#10;/admin/purge"
            rows={4}
          />
        </label>
      </section>

      {/* Authentication */}
      <section className="config-section auth-section">
        <h3>Authentication Flow</h3>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={state.useAuth}
            onChange={e => setState(prev => ({ ...prev, useAuth: e.target.checked }))}
          />
          Capture Authenticated Session
        </label>

        {state.useAuth && (
          <div className="auth-steps">
            {state.authSession ? (
              <div className="session-badge">
                ✓ Session captured from {state.authSession.sourceUrl}
                <button
                  className="clear-session-btn"
                  onClick={() => setState(prev => ({ ...prev, authSession: null }))}
                >
                  Clear
                </button>
              </div>
            ) : (
              <>
                <div className="login-steps-list">
                  {state.loginSteps.map((step, idx) => (
                    <div key={idx} className="login-step">
                      <select
                        value={step.type}
                        onChange={e => {
                          const newType = e.target.value as LoginAction['type'];
                          let newStep: LoginAction;
                          if (newType === 'goto') newStep = { type: 'goto', url: '' };
                          else if (newType === 'fill') newStep = { type: 'fill', selector: '', value: '' };
                          else if (newType === 'click') newStep = { type: 'click', selector: '' };
                          else if (newType === 'wait') newStep = { type: 'wait', selector: '' };
                          else newStep = { type: 'screenshot' };
                          updateLoginStep(idx, newStep);
                        }}
                      >
                        <option value="goto">Goto</option>
                        <option value="fill">Fill</option>
                        <option value="click">Click</option>
                        <option value="wait">Wait</option>
                        <option value="screenshot">Screenshot</option>
                      </select>

                      {step.type === 'goto' && (
                        <input
                          type="text"
                          placeholder="https://example.com/login"
                          value={step.url}
                          onChange={e => updateLoginStep(idx, { url: e.target.value })}
                        />
                      )}

                      {(step.type === 'fill' || step.type === 'click' || step.type === 'wait') && (
                        <input
                          type="text"
                          placeholder="CSS selector"
                          value={'selector' in step ? step.selector : ''}
                          onChange={e => updateLoginStep(idx, { selector: e.target.value })}
                        />
                      )}

                      {step.type === 'fill' && (
                        <input
                          type="text"
                          placeholder="Value to fill"
                          value={'value' in step ? step.value : ''}
                          onChange={e => updateLoginStep(idx, { value: e.target.value })}
                        />
                      )}

                      <button
                        type="button"
                        className="remove-step-btn"
                        onClick={() => removeLoginStep(idx)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  className="add-step-btn"
                  onClick={addLoginStep}
                >
                  + Add Step
                </button>

                <button
                  type="button"
                  className="auth-capture-btn"
                  onClick={handleAuthCapture}
                  disabled={loginLoading}
                >
                  {loginLoading ? 'Capturing Login...' : 'Capture Login Session'}
                </button>
              </>
            )}
          </div>
        )}
      </section>

      {/* Submit */}
      <div className="config-actions">
        <button
          className="primary-button"
          onClick={handleCapture}
          disabled={!state.url || isCapturing}
        >
          {isCapturing ? 'Capturing...' : '▶ Start Capture'}
        </button>
      </div>
    </div>
  );
}

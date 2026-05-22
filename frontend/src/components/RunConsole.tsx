import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Settings, Terminal, Activity, AlertTriangle } from 'lucide-react';

interface TelemetryStats {
  tps: number;
  totalOrders: number;
  totalCancels: number;
  successfulMatches: number;
  p50Latency: number;
  p90Latency: number;
  p99Latency: number;
  correctnessScore: number;
  violations: Array<{
    type: string;
    description: string;
    timestamp: number;
  }>;
  activeBots?: number;
}

interface RunConsoleProps {
  isRunning: boolean;
  onStart: (name: string, type: string, duration: number, bots: number, rate: number) => void;
  onStop: () => void;
  onScale: (bots: number) => void;
  stats: TelemetryStats | null;
  logs: string[];
}

export const RunConsole: React.FC<RunConsoleProps> = ({
  isRunning,
  onStart,
  onStop,
  onScale,
  stats,
  logs
}) => {
  // Input parameters
  const [name, setName] = useState('Super Trading Systems');
  const [engineType, setEngineType] = useState('js');
  const [duration, setDuration] = useState(30);
  const [botCount, setBotCount] = useState(10);
  const [botRate, setBotRate] = useState(100);

  const [tpsHistory, setTpsHistory] = useState<number[]>([]);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll terminal logs
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Maintain historical trace of TPS for dynamic SVG graphing
  useEffect(() => {
    if (isRunning && stats) {
      setTpsHistory(prev => {
        const next = [...prev, stats.tps];
        if (next.length > 30) next.shift(); // Keep last 30 readings
        return next;
      });
    } else if (!isRunning) {
      setTpsHistory([]);
    }
  }, [isRunning, stats]);

  const handleStart = () => {
    onStart(name, engineType, duration, botCount, botRate);
  };

  const handleScaleChange = (amt: number) => {
    const nextVal = Math.max(botCount + amt, 1);
    setBotCount(nextVal);
    if (isRunning) {
      onScale(nextVal);
    }
  };

  // Render SVG line chart of dynamic TPS performance
  const renderTpsChart = () => {
    if (tpsHistory.length < 2) {
      return (
        <div style={{ height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'hsl(var(--text-muted))' }}>
          Initializing telemetry grid...
        </div>
      );
    }

    const maxVal = Math.max(...tpsHistory, 100);
    const minVal = 0;
    const width = 400;
    const height = 100;
    const padding = 10;

    const points = tpsHistory.map((val, idx) => {
      const x = padding + (idx / (tpsHistory.length - 1)) * (width - padding * 2);
      const y = height - padding - ((val - minVal) / (maxVal - minVal)) * (height - padding * 2);
      return `${x},${y}`;
    }).join(' ');

    return (
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: '120px', overflow: 'visible' }}>
        {/* Neon Glow filters */}
        <defs>
          <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--accent-purple))" stopOpacity="0.4" />
            <stop offset="100%" stopColor="hsl(var(--accent-purple))" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        {/* Background Gridlines */}
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="hsl(var(--border-dim))" strokeWidth="1" />
        <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="hsl(var(--border-dim) / 0.3)" strokeWidth="1" strokeDasharray="4 4" />
        <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="hsl(var(--border-dim) / 0.3)" strokeWidth="1" strokeDasharray="4 4" />

        {/* Filled Path */}
        <path
          d={`M ${padding},${height - padding} L ${points} L ${width - padding},${height - padding} Z`}
          fill="url(#chartGrad)"
        />
        {/* Line Path */}
        <polyline
          fill="none"
          stroke="hsl(var(--accent-purple))"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
          style={{ filter: 'drop-shadow(0px 0px 8px hsl(var(--accent-purple) / 0.5))' }}
        />
      </svg>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* 1. Stress Test Setup Panel */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div className="flex-row-center">
          <Settings style={{ color: 'hsl(var(--accent-purple))' }} size={24} />
          <h2>Benchmark Configurations</h2>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>Contestant / Team Name</label>
            <input 
              type="text" 
              value={name} 
              onChange={(e) => setName(e.target.value)} 
              disabled={isRunning}
              placeholder="Enter contestant team name..."
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>Matching Engine Stack</label>
              <select 
                value={engineType} 
                onChange={(e) => setEngineType(e.target.value)}
                disabled={isRunning}
              >
                <option value="js">Node.js / JS (Standard)</option>
                <option value="go">Go (Optimized Channels)</option>
                <option value="rust">Rust (Ultra-Fast BTreeMap)</option>
                <option value="cpp">C++ (Standard STL map)</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>Stress Test Duration</label>
              <select 
                value={duration} 
                onChange={(e) => setDuration(parseInt(e.target.value))}
                disabled={isRunning}
              >
                <option value={15}>15 Seconds (Quick Scan)</option>
                <option value={30}>30 Seconds (Default stress)</option>
                <option value={60}>60 Seconds (Heavy stress)</option>
                <option value={120}>120 Seconds (Peak Soak)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>Virtual Bot Fleet Size</label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button type="button" className="btn-secondary" style={{ padding: '0.5rem 1rem' }} onClick={() => handleScaleChange(-5)}>-</button>
                <span className="mono" style={{ minWidth: '40px', textAlign: 'center', fontSize: '1.1rem', fontWeight: 700 }}>{botCount}</span>
                <button type="button" className="btn-secondary" style={{ padding: '0.5rem 1rem' }} onClick={() => handleScaleChange(5)}>+</button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>Orders Rate / Bot (RPS)</label>
              <input 
                type="number" 
                value={botRate} 
                onChange={(e) => setBotRate(parseInt(e.target.value) || 10)}
                disabled={isRunning}
                min={10}
                max={500}
              />
            </div>
          </div>

          <div style={{ marginTop: '0.5rem' }}>
            {!isRunning ? (
              <button className="btn-primary" style={{ width: '100%', padding: '1rem' }} onClick={handleStart}>
                <Play size={18} fill="white" /> Launch Stress Test
              </button>
            ) : (
              <button className="btn-danger" style={{ width: '100%', padding: '1rem' }} onClick={onStop}>
                <Square size={18} fill="currentColor" /> Force Abort Run
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. Real-Time Telemetry Panels */}
      {isRunning && stats && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', borderLeft: '4px solid hsl(var(--accent-purple))' }}>
            <div className="flex-row-center" style={{ justifyContent: 'space-between' }}>
              <div className="flex-row-center">
                <Activity className="pulse-glow-green" size={20} />
                <h3 style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.875rem', color: 'hsl(var(--text-secondary))' }}>Performance Telemetry</h3>
              </div>
              <span className="badge badge-purple" style={{ animation: 'pulseGlow 1.5s infinite' }}>Stress Active</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.5rem' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>CURRENT THROUGHPUT</div>
                <div className="mono" style={{ fontSize: '1.75rem', fontWeight: 800, color: 'hsl(var(--accent-purple))' }}>
                  {stats.tps.toLocaleString()} <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>TPS</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>ALGORITHMIC CORRECTNESS</div>
                <div className="mono" style={{ fontSize: '1.75rem', fontWeight: 800, color: stats.correctnessScore === 100 ? 'hsl(var(--accent-green))' : 'hsl(var(--accent-red))' }}>
                  {stats.correctnessScore}%
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginTop: '0.5rem', borderTop: '1px solid hsl(var(--border-dim) / 0.5)', paddingTop: '0.75rem' }}>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))' }}>p50 LATENCY</div>
                <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{stats.p50Latency} ms</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))' }}>p90 LATENCY</div>
                <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{stats.p90Latency} ms</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))' }}>p99 LATENCY</div>
                <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: stats.p99Latency < 50 ? 'inherit' : 'hsl(var(--accent-orange))' }}>{stats.p99Latency} ms</div>
              </div>
            </div>

            {/* Throughput SVG Chart */}
            <div style={{ marginTop: '0.75rem', background: 'hsl(var(--bg-base) / 0.5)', borderRadius: '8px', padding: '0.5rem' }}>
              {renderTpsChart()}
            </div>
          </div>

          {/* Validation & Violation audit logs */}
          {stats.violations.length > 0 && (
            <div className="glass-card" style={{ borderLeft: '4px solid hsl(var(--accent-red))', display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem' }}>
              <div className="flex-row-center" style={{ color: 'hsl(var(--accent-red))' }}>
                <AlertTriangle size={18} />
                <h3 style={{ fontSize: '0.875rem', fontWeight: 700 }}>Correctness Auditing Exceptions</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '100px', overflowY: 'auto' }}>
                {stats.violations.map((v, i) => (
                  <div key={i} className="mono" style={{ fontSize: '0.75rem', color: 'hsl(var(--accent-red) / 0.95)', borderBottom: '1px dashed hsl(var(--border-dim) / 0.3)', paddingBottom: '0.2rem' }}>
                    [{v.type}] {v.description}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}

      {/* 3. Sandbox Live Compiler Terminal */}
      <div className="glass-card" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: '280px' }}>
        <div className="flex-row-center" style={{ justifyContent: 'space-between' }}>
          <div className="flex-row-center">
            <Terminal style={{ color: 'hsl(var(--accent-purple))' }} size={20} />
            <h3 style={{ fontSize: '1rem' }}>Sandbox Console Logs</h3>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>STDERR / STDOUT</span>
        </div>

        <div style={{ 
          background: 'hsl(var(--bg-base))', 
          border: '1px solid hsl(var(--border-dim))',
          borderRadius: '8px',
          padding: '1rem',
          flexGrow: 1,
          maxHeight: '320px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.25rem',
          color: '#39ff14', // Matrix green color for high visual impact
          textShadow: '0 0 2px rgba(57, 255, 20, 0.3)'
        }} className="mono">
          {logs.length === 0 ? (
            <div style={{ color: 'hsl(var(--text-muted))' }}>Console offline. Click launch stress test to initiate container deployment...</div>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} style={{ whiteSpace: 'pre-wrap', lineHeight: '1.4' }}>
                {log}
              </div>
            ))
          )}
          <div ref={terminalEndRef} />
        </div>
      </div>

    </div>
  );
};

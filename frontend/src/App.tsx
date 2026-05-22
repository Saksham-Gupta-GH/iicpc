import React, { useState, useEffect, useRef } from 'react';
import { Leaderboard, LeaderboardEntry } from './components/Leaderboard';
import { RunConsole } from './components/RunConsole';
import { AlertCircle, Wifi, WifiOff, Cpu, Award } from 'lucide-react';

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
}

const App: React.FC = () => {
  const [wsConnected, setWsConnected] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [activeRunDetails, setActiveRunDetails] = useState<{ name?: string, lang?: string } | null>(null);

  // Leaderboard lists
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [history, setHistory] = useState<any[]>([]);

  // Logging & telemetries
  const [stats, setStats] = useState<TelemetryStats | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);

  // Setup WS Connection
  useEffect(() => {
    connectWS();
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, []);

  const connectWS = () => {
    const wsUrl = `ws://${window.location.hostname}:5050`;
    console.log('[WebSocket] Connecting to:', wsUrl);
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      console.log('[WebSocket] Connected!');
      setWsConnected(true);
      setErrorMsg(null);
    };

    socket.onclose = () => {
      console.log('[WebSocket] Connection closed. Attempting reconnect in 3s...');
      setWsConnected(false);
      setTimeout(connectWS, 3000);
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const { type, payload } = msg;

        if (type === 'INIT') {
          // Wrap in startViewTransition if available for beautiful progressive layout reorders
          triggerViewTransition(() => {
            setLeaderboard(payload.leaderboard);
            setHistory(payload.history);
          });
          setIsRunning(payload.isRunning);
        } else if (type === 'STATUS_CHANGE') {
          setIsRunning(payload.isRunning);
          if (payload.isRunning) {
            setLogs([]);
            setStats(null);
            setActiveRunDetails({ name: payload.contestantName, lang: payload.engineType });
          } else {
            setActiveRunDetails(null);
          }
        } else if (type === 'LOG') {
          setLogs(prev => [...prev, payload.text]);
        } else if (type === 'STATS') {
          setStats(payload);
        } else if (type === 'FINISHED') {
          setIsRunning(false);
          setActiveRunDetails(null);
          triggerViewTransition(() => {
            setLeaderboard(payload.leaderboard);
            setHistory(payload.history);
          });
        }
      } catch (err) {
        console.error('[WebSocket] Parsing failed:', err);
      }
    };
  };

  const triggerViewTransition = (callback: () => void) => {
    if ((document as any).startViewTransition) {
      (document as any).startViewTransition(callback);
    } else {
      callback();
    }
  };

  const handleStartRun = async (
    contestantName: string,
    engineType: string,
    duration: number,
    botCount: number,
    botRate: number
  ) => {
    try {
      setErrorMsg(null);
      const res = await fetch('http://localhost:5050/api/benchmark/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contestantName,
          engineType,
          duration,
          botCount,
          botRate
        })
      });

      if (!res.ok) {
        const data = await res.json();
        setErrorMsg(data.error || 'Failed to start benchmark.');
      }
    } catch (err: any) {
      setErrorMsg('Error establishing connection with orchestrator backend.');
    }
  };

  const handleStopRun = async () => {
    try {
      await fetch('http://localhost:5050/api/benchmark/stop', { method: 'POST' });
    } catch (err) {
      setErrorMsg('Failed to broadcast stop request.');
    }
  };

  const handleScaleFleet = async (bots: number) => {
    try {
      await fetch('http://localhost:5050/api/benchmark/scale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botCount: bots })
      });
    } catch (err) {
      console.error('Scaling error:', err);
    }
  };

  return (
    <div className="app-container">
      
      {/* Dynamic Header with glow accent */}
      <header style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        borderBottom: '1px solid var(--border-dim)',
        paddingBottom: '1.5rem',
        marginTop: '1rem'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <div className="flex-row-center">
            <Cpu style={{ color: 'hsl(var(--accent-purple))' }} size={28} />
            <h1 style={{ fontSize: '2rem', margin: 0 }} className="gradient-text">IICPC Summer Hackathon 2026</h1>
          </div>
          <span style={{ fontSize: '0.9rem', color: 'hsl(var(--text-secondary))', fontWeight: 500 }}>
            Decoupled High-Performance Benchmarking & Sandbox Hosting Platform
          </span>
        </div>

        {/* Status indicator and Live WS connection Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {activeRunDetails && (
            <div className="flex-row-center" style={{ background: 'hsl(var(--accent-purple) / 0.15)', border: '1px solid hsl(var(--accent-purple) / 0.3)', padding: '0.5rem 1rem', borderRadius: '12px', gap: '0.5rem' }}>
              <span className="badge badge-purple" style={{ animation: 'pulseGlow 1.5s infinite' }}>Testing</span>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'hsl(var(--accent-purple))' }}>{activeRunDetails.name} ({activeRunDetails.lang?.toUpperCase()})</span>
            </div>
          )}
          <div className="flex-row-center" style={{ background: 'hsl(var(--bg-surface))', border: '1px solid hsl(var(--border-dim))', padding: '0.5rem 1rem', borderRadius: '12px' }}>
            {wsConnected ? (
              <>
                <Wifi style={{ color: 'hsl(var(--accent-green))' }} size={16} />
                <span className="mono" style={{ fontSize: '0.8rem', color: 'hsl(var(--accent-green))', fontWeight: 600 }}>ORCHESTRATOR ONLINE</span>
              </>
            ) : (
              <>
                <WifiOff style={{ color: 'hsl(var(--accent-red))' }} size={16} />
                <span className="mono" style={{ fontSize: '0.8rem', color: 'hsl(var(--accent-red))', fontWeight: 600 }}>ORCHESTRATOR OFFLINE</span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Global alert error drawer */}
      {errorMsg && (
        <div className="glass-card" style={{ borderLeft: '4px solid hsl(var(--accent-red))', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem', background: 'hsl(var(--accent-red) / 0.05)' }}>
          <AlertCircle style={{ color: 'hsl(var(--accent-red))' }} size={20} />
          <span style={{ fontWeight: 600, color: 'hsl(var(--accent-red))' }}>{errorMsg}</span>
        </div>
      )}

      {/* Primary Grid Layout */}
      <main className="dashboard-grid">
        
        {/* Left Side: Live rankings & upload templates */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          <Leaderboard entries={leaderboard} />
          
          {/* Submission Info drawer */}
          <div className="glass-card flex-row-center" style={{ gap: '1.5rem', background: 'linear-gradient(135deg, hsl(var(--bg-surface)) 0%, hsl(var(--border-dim) / 0.2) 100%)' }}>
            <Award size={48} style={{ color: 'hsl(var(--accent-purple))', flexShrink: 0 }} />
            <div>
              <h3 style={{ fontSize: '1.1rem', marginBottom: '0.25rem' }}>Hardcore Systems Challenge</h3>
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'hsl(var(--text-secondary))', lineHeight: '1.4' }}>
                Binary matching engines are evaluated on <strong>Throughput (TPS)</strong>, <strong>Ack Latency</strong>, and <strong>Price-Time Correctness</strong>. Spawning dynamic trading bot bombardment simulates real market volatility.
              </p>
            </div>
          </div>

          {/* Recent Runs History */}
          {history && history.length > 0 && (
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="flex-row-center">
                <Award style={{ color: 'hsl(var(--accent-blue))' }} size={20} />
                <h3 style={{ fontSize: '1.1rem' }}>Recent Stress Tests</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {history.slice(0, 5).map((run) => (
                  <div key={run.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid hsl(var(--border-dim) / 0.4)', paddingBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{run.contestantName}</span>
                      <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
                        {run.language.toUpperCase()} • {run.duration}s • {new Date(run.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'hsl(var(--accent-purple))' }} className="mono">
                        {run.compositeScore.toLocaleString()} pts
                      </span>
                      <span className={`badge ${run.status === 'SUCCESS' ? 'badge-green' : 'badge-red'}`} style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>
                        {run.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Execution Sandbox Console & Telemetry Charts */}
        <RunConsole 
          isRunning={isRunning} 
          onStart={handleStartRun} 
          onStop={handleStopRun} 
          onScale={handleScaleFleet}
          stats={stats} 
          logs={logs}
        />
      </main>

      {/* Platform footer */}
      <footer style={{ textAlign: 'center', borderTop: '1px solid hsl(var(--border-dim))', padding: '1.5rem 0', marginTop: '2rem', color: 'hsl(var(--text-muted))', fontSize: '0.8rem' }}>
        <p style={{ margin: 0 }}>© IICPC Summer Hackathon 2026. Made with Google Antigravity developer SDK.</p>
      </footer>

    </div>
  );
};

export default App;

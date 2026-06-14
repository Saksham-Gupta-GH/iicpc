import React from 'react';
import { Award, Clock } from 'lucide-react';

export interface LeaderboardEntry {
  id: string;
  name: string;
  language: string;
  maxTps: number;
  p50Latency: number;
  p90Latency: number;
  p99Latency: number;
  correctness: number;
  compositeScore: number;
  timestamp: number;
}

interface LeaderboardProps {
  entries: LeaderboardEntry[];
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ entries }) => {
  const getLanguageBadge = (lang: string) => {
    switch (lang.toLowerCase()) {
      case 'rust': return <span className="badge badge-orange">Rust</span>;
      case 'cpp': return <span className="badge badge-blue">C++</span>;
      case 'go': return <span className="badge badge-purple">Go</span>;
      default: return <span className="badge badge-green">Node.js</span>;
    }
  };

  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="flex-row-center">
          <Award style={{ color: 'hsl(var(--accent-purple))' }} size={24} />
          <h2 style={{ fontSize: '1.5rem' }}>Live Leaderboard</h2>
        </div>
        <span style={{ fontSize: '0.875rem', color: 'hsl(var(--text-muted))' }}>
          {entries.length} Submissions
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid hsl(var(--border-dim))', color: 'hsl(var(--text-muted))', fontSize: '0.875rem' }}>
              <th style={{ padding: '1rem 0.5rem' }}>Rank</th>
              <th style={{ padding: '1rem' }}>Contestant</th>
              <th style={{ padding: '1rem' }}>Language</th>
              <th style={{ padding: '1rem', textAlign: 'right' }}>Max TPS</th>
              <th style={{ padding: '1rem', textAlign: 'right' }}>p99 Latency</th>
              <th style={{ padding: '1rem', textAlign: 'right' }}>Correctness</th>
              <th style={{ padding: '1rem', textAlign: 'right' }}>Composite</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '3rem', textAlign: 'center', color: 'hsl(var(--text-muted))' }}>
                  No stress tests recorded yet. Upload a matching engine below to start!
                </td>
              </tr>
            ) : (
              entries.map((entry, idx) => {
                const rank = idx + 1;
                const rowTransitionName = `leaderboard-row-${entry.id}`;

                return (
                  <tr 
                    key={entry.id} 
                    style={{ 
                      borderBottom: '1px solid hsl(var(--border-dim) / 0.5)',
                      transition: 'background 0.2s ease',
                      // Custom view transition identifier for fluid sliding
                      viewTransitionName: rowTransitionName
                    } as any}
                    className="leaderboard-row"
                  >
                    <td style={{ padding: '1.25rem 0.5rem', fontWeight: 800 }}>
                      <div className="flex-row-center" style={{ justifyContent: 'flex-start' }}>
                        {rank === 1 && <span style={{ color: 'goldenrod', fontSize: '1.25rem' }}>🥇</span>}
                        {rank === 2 && <span style={{ color: 'silver', fontSize: '1.25rem' }}>🥈</span>}
                        {rank === 3 && <span style={{ color: 'bronze', fontSize: '1.25rem' }}>🥉</span>}
                        {rank > 3 && <span style={{ color: 'hsl(var(--text-muted))', marginLeft: '0.25rem' }}>#{rank}</span>}
                      </div>
                    </td>
                    <td style={{ padding: '1.25rem 1rem', fontWeight: 600 }}>
                      {entry.name}
                    </td>
                    <td style={{ padding: '1.25rem 1rem' }}>
                      {getLanguageBadge(entry.language)}
                    </td>
                    <td style={{ padding: '1.25rem 1rem', textAlign: 'right', fontWeight: 700 }} className="mono">
                      {entry.maxTps.toLocaleString()}
                    </td>
                    <td style={{ padding: '1.25rem 1rem', textAlign: 'right' }} className="mono">
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: entry.p99Latency < 50 ? 'hsl(var(--accent-green))' : 'hsl(var(--accent-orange))' }}>
                        <Clock size={12} />
                        {entry.p99Latency} ms
                      </div>
                    </td>
                    <td style={{ padding: '1.25rem 1rem', textAlign: 'right' }}>
                      <span className={`badge ${entry.correctness === 100 ? 'badge-green' : 'badge-red'}`} style={{ fontStyle: 'normal' }}>
                        {entry.correctness}%
                      </span>
                    </td>
                    <td style={{ padding: '1.25rem 1rem', textAlign: 'right', fontWeight: 800, color: 'hsl(var(--accent-purple))', fontSize: '1.1rem' }} className="mono">
                      {entry.compositeScore}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

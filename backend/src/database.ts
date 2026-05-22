import * as fs from 'fs';
import * as path from 'path';

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

export interface BenchmarkRun {
  id: string;
  contestantName: string;
  language: string;
  tps: number;
  p50Latency: number;
  p90Latency: number;
  p99Latency: number;
  correctness: number;
  compositeScore: number;
  status: 'SUCCESS' | 'FAILED';
  duration: number;
  timestamp: number;
}

export class PlatformDatabase {
  private filePath = path.join(__dirname, '..', 'iicpc-data.json');
  private data: {
    leaderboard: LeaderboardEntry[];
    runs: BenchmarkRun[];
  } = { leaderboard: [], runs: [] };

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const fileContent = fs.readFileSync(this.filePath, 'utf-8');
        this.data = JSON.parse(fileContent);
      } else {
        this.save();
      }
    } catch (err) {
      console.error('[Database] Load failed, resetting schema:', err);
      this.save();
    }
  }

  private save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Database] Save failed:', err);
    }
  }

  getLeaderboard(): LeaderboardEntry[] {
    return this.data.leaderboard.sort((a, b) => b.compositeScore - a.compositeScore);
  }

  getRuns(): BenchmarkRun[] {
    return this.data.runs.sort((a, b) => b.timestamp - a.timestamp);
  }

  addRun(run: BenchmarkRun) {
    this.data.runs.push(run);
    this.updateLeaderboard(run);
    this.save();
  }

  private updateLeaderboard(run: BenchmarkRun) {
    if (run.status !== 'SUCCESS') return;

    const existingIdx = this.data.leaderboard.findIndex(
      e => e.name === run.contestantName && e.language === run.language
    );

    const entry: LeaderboardEntry = {
      id: run.id,
      name: run.contestantName,
      language: run.language,
      maxTps: run.tps,
      p50Latency: run.p50Latency,
      p90Latency: run.p90Latency,
      p99Latency: run.p99Latency,
      correctness: run.correctness,
      compositeScore: run.compositeScore,
      timestamp: run.timestamp
    };

    if (existingIdx !== -1) {
      const existing = this.data.leaderboard[existingIdx];
      // Only overwrite if the new composite score is higher
      if (entry.compositeScore > existing.compositeScore) {
        this.data.leaderboard[existingIdx] = entry;
      }
    } else {
      this.data.leaderboard.push(entry);
    }
  }

  /**
   * Helper to calculate the composite benchmark score
   * Formula factors in: (TPS * CorrectnessRatio) - (p99Latency_in_ms * 2)
   */
  static calculateCompositeScore(tps: number, correctness: number, p99Ms: number): number {
    const correctnessRatio = correctness / 100;
    const base = tps * correctnessRatio;
    const penalty = p99Ms * 2;
    const score = Math.max(Math.round(base - penalty), 0);
    return score;
  }
}

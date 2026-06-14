import { Pool } from 'pg';

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
  private pool: Pool | null = null;
  
  // Fallback in-memory storage if DB connection fails/missing
  private data: {
    leaderboard: LeaderboardEntry[];
    runs: BenchmarkRun[];
  } = { leaderboard: [], runs: [] };
  
  constructor() {
    if (process.env.DATABASE_URL) {
      this.pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      });
      this.initDb();
    } else {
      console.warn('[Database] No DATABASE_URL provided. Falling back to in-memory store.');
    }
  }

  private async initDb() {
    if (!this.pool) return;
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS runs (
          id VARCHAR(255) PRIMARY KEY,
          contestant_name VARCHAR(255),
          language VARCHAR(50),
          tps FLOAT,
          p50_latency FLOAT,
          p90_latency FLOAT,
          p99_latency FLOAT,
          correctness FLOAT,
          composite_score FLOAT,
          status VARCHAR(50),
          duration INT,
          timestamp BIGINT
        );
      `);
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS leaderboard (
          id VARCHAR(255) PRIMARY KEY,
          name VARCHAR(255),
          language VARCHAR(50),
          max_tps FLOAT,
          p50_latency FLOAT,
          p90_latency FLOAT,
          p99_latency FLOAT,
          correctness FLOAT,
          composite_score FLOAT,
          timestamp BIGINT
        );
      `);
      console.log('[Database] PostgreSQL initialized.');
    } catch (err) {
      console.error('[Database] Failed to init tables:', err);
    }
  }

  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    if (this.pool) {
      try {
        const res = await this.pool.query('SELECT * FROM leaderboard ORDER BY composite_score DESC');
        return res.rows.map(r => ({
          id: r.id,
          name: r.name,
          language: r.language,
          maxTps: r.max_tps,
          p50Latency: r.p50_latency,
          p90Latency: r.p90_latency,
          p99Latency: r.p99_latency,
          correctness: r.correctness,
          compositeScore: r.composite_score,
          timestamp: Number(r.timestamp)
        }));
      } catch (err) {
        console.error('[Database] Leaderboard fetch error:', err);
        return [];
      }
    }
    return this.data.leaderboard.sort((a, b) => b.compositeScore - a.compositeScore);
  }

  async getRuns(): Promise<BenchmarkRun[]> {
    if (this.pool) {
      try {
        const res = await this.pool.query('SELECT * FROM runs ORDER BY timestamp DESC');
        return res.rows.map(r => ({
          id: r.id,
          contestantName: r.contestant_name,
          language: r.language,
          tps: r.tps,
          p50Latency: r.p50_latency,
          p90Latency: r.p90_latency,
          p99Latency: r.p99_latency,
          correctness: r.correctness,
          compositeScore: r.composite_score,
          status: r.status,
          duration: r.duration,
          timestamp: Number(r.timestamp)
        }));
      } catch (err) {
        console.error('[Database] Runs fetch error:', err);
        return [];
      }
    }
    return this.data.runs.sort((a, b) => b.timestamp - a.timestamp);
  }

  async addRun(run: BenchmarkRun) {
    if (this.pool) {
      try {
        await this.pool.query(`
          INSERT INTO runs (id, contestant_name, language, tps, p50_latency, p90_latency, p99_latency, correctness, composite_score, status, duration, timestamp)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [run.id, run.contestantName, run.language, run.tps, run.p50Latency, run.p90Latency, run.p99Latency, run.correctness, run.compositeScore, run.status, run.duration, run.timestamp]);
        
        await this.updateLeaderboard(run);
      } catch (err) {
        console.error('[Database] Error adding run:', err);
      }
    } else {
      this.data.runs.push(run);
      await this.updateLeaderboard(run);
    }
  }

  private async updateLeaderboard(run: BenchmarkRun) {
    if (run.status !== 'SUCCESS') return;

    if (this.pool) {
      const existing = await this.pool.query(`
        SELECT composite_score FROM leaderboard WHERE name = $1 AND language = $2
      `, [run.contestantName, run.language]);

      if (existing.rowCount && existing.rowCount > 0) {
        const existingScore = existing.rows[0].composite_score;
        if (run.compositeScore > existingScore) {
          await this.pool.query(`
            UPDATE leaderboard SET
              id = $1, max_tps = $2, p50_latency = $3, p90_latency = $4, p99_latency = $5, correctness = $6, composite_score = $7, timestamp = $8
            WHERE name = $9 AND language = $10
          `, [run.id, run.tps, run.p50Latency, run.p90Latency, run.p99Latency, run.correctness, run.compositeScore, run.timestamp, run.contestantName, run.language]);
        }
      } else {
        await this.pool.query(`
          INSERT INTO leaderboard (id, name, language, max_tps, p50_latency, p90_latency, p99_latency, correctness, composite_score, timestamp)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [run.id, run.contestantName, run.language, run.tps, run.p50Latency, run.p90Latency, run.p99Latency, run.correctness, run.compositeScore, run.timestamp]);
      }
    } else {
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
        if (entry.compositeScore > existing.compositeScore) {
          this.data.leaderboard[existingIdx] = entry;
        }
      } else {
        this.data.leaderboard.push(entry);
      }
    }
  }

  static calculateCompositeScore(tps: number, correctness: number, p99Ms: number): number {
    const correctnessRatio = correctness / 100;
    const base = tps * correctnessRatio;
    const penalty = p99Ms * 2;
    const score = Math.max(Math.round(base - penalty), 0);
    return score;
  }
}

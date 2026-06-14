import { Worker } from 'worker_threads';
import * as path from 'path';
import { TelemetryIngester } from '../../backend/src/telemetry';

export class LoadGenerator {
  private workers: Worker[] = [];
  private isRunning = false;
  private targetUrl = 'http://localhost:8080';

  constructor(private telemetryIngester: TelemetryIngester) {}

  /**
   * Spawns the bot fleet.
   * @param botCount Number of bots to spawn.
   * @param botRate Throughput target per bot (e.g. 50 orders/sec).
   */
  start(botCount: number, botRate: number) {
    if (this.isRunning) {
      this.stop();
    }

    this.isRunning = true;
    
    const isTs = __filename.endsWith('.ts');
    const workerScript = isTs 
      ? path.resolve(__dirname, 'worker.ts') 
      : path.resolve(__dirname, 'worker.js');

    const archetypes = ['MM', 'HFT', 'ARBITRAGE', 'NOISE'];

    console.log(`[LoadGenerator] Spawning ${botCount} bots at rate ${botRate} req/sec using script: ${workerScript}`);

    for (let i = 0; i < botCount; i++) {
      const archetype = archetypes[i % archetypes.length];
      this.spawnWorker(i, archetype, botRate, workerScript);
    }
  }

  private spawnWorker(id: number, archetype: string, targetRate: number, scriptPath: string) {
    const isTs = scriptPath.endsWith('.ts');
    const worker = new Worker(scriptPath, {
      workerData: {
        workerId: id,
        archetype,
        targetUrl: this.targetUrl,
        targetRate
      },
      execArgv: isTs ? ['-r', 'ts-node/register'] : undefined
    });

    worker.on('message', (msg) => {
      if (!this.isRunning) return;

      if (msg.type === 'ORDER_PLACED') {
        this.telemetryIngester.recordOrderPlacement(msg.payload);
      } else if (msg.type === 'ORDER_CANCELLED') {
        this.telemetryIngester.recordOrderCancellation(msg.payload.id);
      } else if (msg.type === 'METRIC') {
        const { latency, success } = msg.payload;
        if (success) {
          this.telemetryIngester.recordLatency(latency);
        }
      }
    });

    worker.on('error', (err) => {
      console.error(`[LoadGenerator] Worker ${id} encountered error:`, err);
    });

    worker.on('exit', (code) => {
      if (code !== 0 && this.isRunning) {
        console.warn(`[LoadGenerator] Worker ${id} exited unexpectedly with code ${code}`);
      }
    });

    this.workers.push(worker);
  }

  /**
   * Scales the bot fleet up or down dynamically during active runs!
   */
  scale(newBotCount: number, botRate: number) {
    if (!this.isRunning) return;

    const currentCount = this.workers.length;
    const isTs = __filename.endsWith('.ts');
    const workerScript = isTs 
      ? path.resolve(__dirname, 'worker.ts') 
      : path.resolve(__dirname, 'worker.js');
      
    const archetypes = ['MM', 'HFT', 'ARBITRAGE', 'NOISE'];

    if (newBotCount > currentCount) {
      // Scale Up
      const spawnCount = newBotCount - currentCount;
      console.log(`[LoadGenerator] Scaling up by spawning ${spawnCount} new workers...`);
      for (let i = 0; i < spawnCount; i++) {
        const id = currentCount + i;
        const archetype = archetypes[id % archetypes.length];
        this.spawnWorker(id, archetype, botRate, workerScript);
      }
    } else if (newBotCount < currentCount) {
      // Scale Down
      const stopCount = currentCount - newBotCount;
      console.log(`[LoadGenerator] Scaling down by stopping ${stopCount} workers...`);
      for (let i = 0; i < stopCount; i++) {
        const worker = this.workers.pop();
        if (worker) {
          worker.postMessage('STOP');
          worker.terminate();
        }
      }
    }
  }

  /**
   * Stop the load generator and terminate all active worker threads.
   */
  stop() {
    this.isRunning = false;
    console.log(`[LoadGenerator] Tearing down bot fleet of ${this.workers.length} workers...`);
    for (const worker of this.workers) {
      worker.postMessage('STOP');
      worker.terminate();
    }
    this.workers = [];
  }

  getActiveBotCount(): number {
    return this.workers.length;
  }
}

import express, { Request, Response } from 'express';
import * as http from 'http';
import WebSocket from 'ws';
import cors from 'cors';
import * as path from 'path';
import * as fs from 'fs';
import { TelemetryIngester } from './telemetry';
import { ContestantOrchestrator } from './orchestrator';
import { LoadGenerator } from '../../bot-fleet/src/generator';
import { PlatformDatabase, BenchmarkRun } from './database';


const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Shared Platform Instances
const db = new PlatformDatabase();
const telemetry = new TelemetryIngester();
const sandbox = new ContestantOrchestrator(telemetry);
const generator = new LoadGenerator(telemetry);

let activeRunId: string | null = null;
let activeRunName: string = '';
let activeRunLang: string = '';
let activeRunTimer: NodeJS.Timeout | null = null;
let activeRunDuration = 30;

// WS Clients (using 'any' to avoid browser DOM vs Node ws type namespace collisions)
const wsClients = new Set<any>();

wss.on('connection', async (ws: any) => {
  wsClients.add(ws);
  
  // Stream current database state on connect
  const [leaderboard, history] = await Promise.all([db.getLeaderboard(), db.getRuns()]);
  ws.send(JSON.stringify({
    type: 'INIT',
    payload: {
      leaderboard,
      history,
      isRunning: sandbox.isRunning
    }
  }));

  ws.on('close', () => wsClients.delete(ws));
});

function broadcastToClients(type: string, payload: any) {
  const msg = JSON.stringify({ type, payload });
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// REST API Endpoints

// GET /api/leaderboard
app.get('/api/leaderboard', async (req: Request, res: Response) => {
  res.json(await db.getLeaderboard());
});

// GET /api/history
app.get('/api/history', async (req: Request, res: Response) => {
  res.json(await db.getRuns());
});

// POST /api/upload
app.post('/api/upload', (req: Request, res: Response) => {
  const { contestantName, language, code } = req.body;

  if (!contestantName || !language || !code) {
    return res.status(400).json({ error: 'Missing contestantName, language, or code content.' });
  }

  const cleanName = contestantName.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleanName) {
    return res.status(400).json({ error: 'Invalid contestant team name.' });
  }

  const lang = language.toLowerCase();
  if (!['js', 'go', 'rust', 'cpp'].includes(lang)) {
    return res.status(400).json({ error: 'Invalid matching engine language stack.' });
  }

  try {
    const isCompiled = __filename.endsWith('.js');
    const backendRoot = isCompiled ? path.resolve(__dirname, '..', '..', '..') : path.resolve(__dirname, '..');
    const repoRoot = path.resolve(backendRoot, '..');

    // 1. Resolve sandboxed upload directory path
    const uploadDir = path.resolve(backendRoot, 'uploads', cleanName, lang);
    fs.mkdirSync(uploadDir, { recursive: true });

    // 2. Define path to template matching engine resources
    const templateDir = path.resolve(repoRoot, 'contestant-examples', lang);

    // 3. Write uploaded source code to sandboxed directory
    if (lang === 'js') {
      fs.writeFileSync(path.join(uploadDir, 'server.js'), code, 'utf-8');
      fs.copyFileSync(path.join(templateDir, 'Dockerfile'), path.join(uploadDir, 'Dockerfile'));
      fs.copyFileSync(path.join(templateDir, 'package.json'), path.join(uploadDir, 'package.json'));
    } else if (lang === 'go') {
      fs.writeFileSync(path.join(uploadDir, 'main.go'), code, 'utf-8');
      fs.copyFileSync(path.join(templateDir, 'Dockerfile'), path.join(uploadDir, 'Dockerfile'));
    } else if (lang === 'cpp') {
      fs.writeFileSync(path.join(uploadDir, 'main.cpp'), code, 'utf-8');
      fs.copyFileSync(path.join(templateDir, 'Dockerfile'), path.join(uploadDir, 'Dockerfile'));
      fs.copyFileSync(path.join(templateDir, 'httplib.h'), path.join(uploadDir, 'httplib.h'));
    } else if (lang === 'rust') {
      fs.mkdirSync(path.join(uploadDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(uploadDir, 'src', 'main.rs'), code, 'utf-8');
      fs.copyFileSync(path.join(templateDir, 'Dockerfile'), path.join(uploadDir, 'Dockerfile'));
      fs.copyFileSync(path.join(templateDir, 'Cargo.toml'), path.join(uploadDir, 'Cargo.toml'));
    }

    console.log(`[Platform] Successfully stored upload for ${cleanName} in ${lang}`);
    res.json({ message: 'Matching engine source code uploaded and sandboxed successfully!' });
  } catch (err: any) {
    console.error('[Platform Error] Upload failed:', err);
    res.status(500).json({ error: `Internal upload failed: ${err.message}` });
  }
});

// POST /api/benchmark/start
app.post('/api/benchmark/start', async (req: Request, res: Response) => {
  const { contestantName, engineType, duration, botCount, botRate, useUploadedCode } = req.body;

  if (sandbox.isRunning) {
    return res.status(400).json({ error: 'A stress test is already running!' });
  }

  // Validate parameters
  const name = (contestantName || 'Anonymous').trim();
  const type = engineType || 'js'; // js, go, rust, cpp
  const runSec = parseInt(duration) || 30;
  const bots = parseInt(botCount) || 10;
  const rate = parseInt(botRate) || 50;

  activeRunId = `run-${Math.random().toString(36).substring(2, 10)}-${Date.now()}`;
  activeRunName = name;
  activeRunLang = type;
  activeRunDuration = runSec;

  res.json({ message: 'Initializing stress test sandbox environment...', runId: activeRunId });

  broadcastToClients('STATUS_CHANGE', { isRunning: true, runId: activeRunId, contestantName: name, engineType: type });

  const isCompiled = __filename.endsWith('.js');
  const backendRoot = isCompiled ? path.resolve(__dirname, '..', '..', '..') : path.resolve(__dirname, '..');
  const repoRoot = path.resolve(backendRoot, '..');

  // Resolve contestant source directory path
  let submissionDir = '';
  if (useUploadedCode) {
    const cleanName = name.replace(/[^a-zA-Z0-9_-]/g, '');
    submissionDir = path.resolve(backendRoot, 'uploads', cleanName, type);
    if (!fs.existsSync(submissionDir)) {
      console.warn(`[Platform Warning] Upload path not found: ${submissionDir}. Falling back to default.`);
      useUploadedCode === false; // Note: useUploadedCode = false doesn't do much since it's a const, but fixing the warning
    }
  }

  if (!submissionDir || !fs.existsSync(submissionDir)) {
    if (type === 'go') {
      submissionDir = path.resolve(repoRoot, 'contestant-examples', 'go');
    } else if (type === 'rust') {
      submissionDir = path.resolve(repoRoot, 'contestant-examples', 'rust');
    } else if (type === 'cpp') {
      submissionDir = path.resolve(repoRoot, 'contestant-examples', 'cpp');
    } else {
      submissionDir = path.resolve(repoRoot, 'contestant-examples', 'js');
    }
  }

  telemetry.reset();

  const logger = (log: string) => {
    console.log(log.trim());
    broadcastToClients('LOG', { text: log });
  };

  logger(`[Platform] Booting matching engine sandbox [${type.toUpperCase()}] for contestant "${name}"...\n`);

  try {
    // 1. Start Docker Container Sandbox
    const sandboxStarted = await sandbox.startSandbox(submissionDir, '0.5', '256m', logger);
    if (!sandboxStarted) {
      throw new Error('Sandbox orchestration container failed to spin up.');
    }

    sandbox.startChaosMonkey(logger);

    logger(`[Platform] Sandbox is online. Deploying Bot Fleet of ${bots} bots...\n`);

    // 2. Start Bot Load Generator
    generator.start(bots, rate);

    logger(`[Platform] Stress test active. Streaming telemetry for ${runSec} seconds...\n`);

    // 3. Periodic real-time statistics broadcastery (every 250ms)
    let statsInterval = setInterval(() => {
      if (!sandbox.isRunning) {
        clearInterval(statsInterval);
        return;
      }
      const stats = telemetry.getStats();
      broadcastToClients('STATS', {
        ...stats,
        activeBots: generator.getActiveBotCount()
      });
    }, 250);

    // 4. Run timer
    activeRunTimer = setTimeout(async () => {
      clearInterval(statsInterval);
      await stopStressTest('SUCCESS');
    }, runSec * 1000);

  } catch (err: any) {
    logger(`[Platform Error] Stress test aborted: ${err.message}\n`);
    await stopStressTest('FAILED');
  }
});

// POST /api/benchmark/stop
app.post('/api/benchmark/stop', async (req: Request, res: Response) => {
  if (!sandbox.isRunning) {
    return res.status(400).json({ error: 'No stress test is currently running.' });
  }
  
  if (activeRunTimer) {
    clearTimeout(activeRunTimer);
    activeRunTimer = null;
  }

  broadcastToClients('LOG', { text: '[Platform] Manually stopped by administrator.\n' });
  await stopStressTest('SUCCESS');
  res.json({ message: 'Stress test terminated manually.' });
});

// POST /api/benchmark/scale
app.post('/api/benchmark/scale', (req: Request, res: Response) => {
  const { botCount, botRate } = req.body;
  if (!sandbox.isRunning) {
    return res.status(400).json({ error: 'No active stress test to scale.' });
  }

  const bots = parseInt(botCount);
  const rate = parseInt(botRate) || 50;

  if (isNaN(bots) || bots <= 0) {
    return res.status(400).json({ error: 'Invalid bot count.' });
  }

  generator.scale(bots, rate);
  broadcastToClients('LOG', { text: `[Platform] Scaled bot fleet to ${bots} active bots.\n` });
  res.json({ activeBots: generator.getActiveBotCount() });
});

async function stopStressTest(status: 'SUCCESS' | 'FAILED') {
  if (activeRunTimer) {
    clearTimeout(activeRunTimer);
    activeRunTimer = null;
  }

  // 1. Stop bot fleet
  generator.stop();

  // 2. Capture final telemetry statistics
  const finalStats = telemetry.getStats();

  // 3. Stop sandbox container
  await sandbox.stopSandbox((log) => {
    broadcastToClients('LOG', { text: log });
  });

  if (activeRunId) {
    const compositeScore = PlatformDatabase.calculateCompositeScore(
      finalStats.tps,
      finalStats.correctnessScore,
      finalStats.p99Latency
    );

    const runResult: BenchmarkRun = {
      id: activeRunId,
      contestantName: activeRunName,
      language: activeRunLang,
      tps: finalStats.tps,
      p50Latency: finalStats.p50Latency,
      p90Latency: finalStats.p90Latency,
      p99Latency: finalStats.p99Latency,
      correctness: finalStats.correctnessScore,
      compositeScore,
      status,
      duration: activeRunDuration,
      timestamp: Date.now()
    };

    // Store in db
    await db.addRun(runResult);

    const [leaderboard, history] = await Promise.all([db.getLeaderboard(), db.getRuns()]);

    broadcastToClients('FINISHED', {
      run: runResult,
      leaderboard,
      history
    });
  }

  activeRunId = null;
  broadcastToClients('STATUS_CHANGE', { isRunning: false });
}

// Start Server
const PORT = process.env.PORT || 5050;
server.listen(PORT, () => {
  console.log(`IICPC Platform orchestrator listening on port ${PORT}`);
});

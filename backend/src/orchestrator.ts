import { spawn, exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { TelemetryIngester } from './telemetry';

export class ContestantOrchestrator {
  private containerName = 'iicpc-contestant-runner';
  private logsProcess: any = null;
  private localProcess: any = null;
  private isDocker = true;
  public isRunning = false;
  private chaosInterval: NodeJS.Timeout | null = null;

  constructor(private telemetryIngester: TelemetryIngester) {}

  /**
   * Compiles and runs a contestant submission in a sandboxed Docker container
   * or falls back to a high-fidelity local child process if Docker is not available.
   * @param submissionDir Path to the folder containing contestant's Dockerfile and source.
   * @param cpuLimit CPU quota (e.g. "0.5")
   * @param memoryLimit Memory quota (e.g. "256m")
   * @param logCallback Callback to stream container build/running logs to the UI.
   */
  async startSandbox(
    submissionDir: string,
    cpuLimit: string = '0.5',
    memoryLimit: string = '256m',
    logCallback: (log: string) => void
  ): Promise<boolean> {
    if (this.isRunning) {
      logCallback('[Orchestrator] A sandbox is already active. Stopping it first...\n');
      await this.stopSandbox(logCallback);
    }

    this.isRunning = true;

    // Detect if Docker is available
    const hasDocker = await new Promise<boolean>((resolve) => {
      exec('docker --version', (err) => {
        resolve(!err);
      });
    });

    this.isDocker = hasDocker;

    if (hasDocker) {
      logCallback(`[Orchestrator] Docker detected. Building contestant Docker image from: ${submissionDir}...\n`);

      // 1. Build image
      const buildSuccess = await new Promise<boolean>((resolve) => {
        const buildProc = exec(`docker build -t iicpc-contestant-image "${submissionDir}"`);

        buildProc.stdout?.on('data', (data) => logCallback(data.toString()));
        buildProc.stderr?.on('data', (data) => logCallback(`[Build Error] ${data.toString()}`));

        buildProc.on('close', (code) => {
          if (code === 0) {
            logCallback('[Orchestrator] Docker build successful!\n');
            resolve(true);
          } else {
            logCallback(`[Orchestrator] Docker build failed with exit code: ${code}\n`);
            resolve(false);
          }
        });
      });

      if (!buildSuccess) {
        this.isRunning = false;
        return false;
      }

      // Clean up any existing container with the same name
      await new Promise((resolve) => {
        exec(`docker rm -f ${this.containerName}`, () => resolve(true));
      });

      logCallback(`[Orchestrator] Spawning sandboxed container (CPU: ${cpuLimit}, RAM: ${memoryLimit})...\n`);

      // 2. Start container with CPU and memory limits
      const runSuccess = await new Promise<boolean>((resolve) => {
        const runCmd = `docker run -d --name ${this.containerName} --cpus="${cpuLimit}" --memory="${memoryLimit}" -p 8080:8080 iicpc-contestant-image`;
        
        exec(runCmd, (err, stdout, stderr) => {
          if (err) {
            logCallback(`[Orchestrator] Failed to start container: ${stderr || err.message}\n`);
            resolve(false);
          } else {
            logCallback(`[Orchestrator] Container started successfully. ID: ${stdout.trim().substring(0, 12)}\n`);
            resolve(true);
          }
        });
      });

      if (!runSuccess) {
        this.isRunning = false;
        return false;
      }

      // 3. Stream container stdout logs and parse Trade/Cancel events in real-time
      this.logsProcess = spawn('docker', ['logs', '-f', this.containerName]);

      this.logsProcess.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          
          // Log to console output
          logCallback(`[Container Output] ${line}\n`);

          // Check if the line is a JSON Trade Event or Cancel Event
          try {
            if (line.startsWith('{') && line.includes('"type"')) {
              const event = JSON.parse(line.trim());
              if (event.type === 'TRADE') {
                this.telemetryIngester.recordActualTrade(event);
              } else if (event.type === 'ORDER') {
                this.telemetryIngester.recordOrderPlacement(event);
              } else if (event.type === 'CANCEL') {
                this.telemetryIngester.recordOrderCancellation(event.orderId || event.id);
              }
            }
          } catch (err) {
            // Non-JSON outputs or malformed logs are safely ignored
          }
        }
      });

      this.logsProcess.stderr?.on('data', (data: Buffer) => {
        logCallback(`[Container Stderr] ${data.toString()}`);
      });

      // Give the matching engine container a moment to initialize
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return true;

    } else {
      logCallback('[Orchestrator] Warning: Docker daemon is not detected. Falling back to native local execution...\n');
      
      const isJs = submissionDir.endsWith('js');
      const isCpp = submissionDir.endsWith('cpp');
      const isGo = submissionDir.endsWith('go');
      const isRust = submissionDir.endsWith('rust');

      if (isJs) {
        logCallback('[Orchestrator] Resolving Node dependencies in JS sandbox...\n');
        await new Promise((resolve) => {
          exec('npm install ws', { cwd: submissionDir }, (err, stdout, stderr) => {
            if (err) logCallback(`[Dependency Warning] npm install: ${stderr || err.message}\n`);
            resolve(true);
          });
        });

        logCallback('[Orchestrator] Spawning native JS matching engine...\n');
        this.localProcess = spawn('node', ['--max-old-space-size=64', 'server.js'], { cwd: submissionDir, env: { ...process.env, PORT: '8080' } });
      } else if (isCpp) {
        const httplibPath = path.join(submissionDir, 'httplib.h');
        if (!fs.existsSync(httplibPath)) {
          logCallback('[Orchestrator] Fetching httplib.h header-only dependency...\n');
          await new Promise((resolve) => {
            exec(`curl -L -o "${httplibPath}" https://raw.githubusercontent.com/yhirose/cpp-httplib/v0.12.1/httplib.h`, () => resolve(true));
          });
        }

        logCallback('[Orchestrator] Compiling C++ matching engine locally with optimizations...\n');
        const compileSuccess = await new Promise<boolean>((resolve) => {
          exec('g++ -O3 -std=c++17 -pthread -o engine main.cpp', { cwd: submissionDir }, (err, stdout, stderr) => {
            if (err) {
              logCallback(`[Compiler Error] g++ failed: ${stderr || err.message}\n`);
              resolve(false);
            } else {
              logCallback('[Orchestrator] Compilation successful!\n');
              resolve(true);
            }
          });
        });

        if (!compileSuccess) {
          this.isRunning = false;
          return false;
        }

        logCallback('[Orchestrator] Spawning native C++ matching engine...\n');
        this.localProcess = spawn('./engine', [], { cwd: submissionDir, env: { ...process.env, PORT: '8080' } });
      } else if (isGo) {
        logCallback('[Orchestrator] Spawning native Go matching engine...\n');
        this.localProcess = spawn('go', ['run', 'main.go'], { cwd: submissionDir, env: { ...process.env, PORT: '8080' } });
      } else if (isRust) {
        logCallback('[Orchestrator] Spawning native Rust matching engine...\n');
        this.localProcess = spawn('cargo', ['run', '--release'], { cwd: submissionDir, env: { ...process.env, PORT: '8080' } });
      }

      if (!this.localProcess) {
        logCallback('[Orchestrator] Error: Local child process could not be initialized.\n');
        this.isRunning = false;
        return false;
      }

      // Stream stdout & stderr of local process
      const handleLogs = (data: Buffer, streamName: string) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          logCallback(`[${streamName}] ${line}\n`);

          // Parse TRADE and CANCEL events in real-time
          try {
            if (line.startsWith('{') && line.includes('"type"')) {
              const event = JSON.parse(line.trim());
              if (event.type === 'TRADE') {
                this.telemetryIngester.recordActualTrade(event);
              } else if (event.type === 'ORDER') {
                this.telemetryIngester.recordOrderPlacement(event);
              } else if (event.type === 'CANCEL') {
                this.telemetryIngester.recordOrderCancellation(event.orderId || event.id);
              }
            }
          } catch (err) {
            // Safe ignore
          }
        }
      };

      this.localProcess.stdout?.on('data', (data: Buffer) => handleLogs(data, 'Local Engine Output'));
      this.localProcess.stderr?.on('data', (data: Buffer) => handleLogs(data, 'Local Engine Stderr'));

      this.localProcess.on('close', (code: number) => {
        logCallback(`[Orchestrator] Local engine process closed with code: ${code}\n`);
        this.isRunning = false;
      });

      // Give the local process a brief moment to open its port
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return true;
    }
  }

  /**
   * Stop and remove the active contestant container or local process.
   */
  async stopSandbox(logCallback: (log: string) => void): Promise<void> {
    this.isRunning = false;
    this.stopChaosMonkey();

    if (this.logsProcess) {
      this.logsProcess.kill();
      this.logsProcess = null;
    }

    if (this.localProcess) {
      logCallback('[Orchestrator] Killing native matching engine child process...\n');
      this.localProcess.kill();
      this.localProcess = null;
    }

    if (this.isDocker) {
      logCallback('[Orchestrator] Tearing down contestant sandbox container...\n');
      await new Promise((resolve) => {
        exec(`docker stop ${this.containerName} && docker rm ${this.containerName}`, (err, stdout, stderr) => {
          logCallback('[Orchestrator] Sandbox container stopped and removed.\n');
          resolve(true);
        });
      });
    }
  }

  public startChaosMonkey(logCallback: (log: string) => void) {
    if (!this.isDocker || !this.isRunning) return;

    this.chaosInterval = setInterval(() => {
      // 20% chance to pause container for 500ms
      if (Math.random() > 0.8) {
        logCallback('[Chaos Monkey] Triggering CPU stall! Pausing container...\n');
        exec(`docker pause ${this.containerName}`, () => {
          setTimeout(() => {
            exec(`docker unpause ${this.containerName}`, () => {
              logCallback('[Chaos Monkey] CPU stall resolved. Container unpaused.\n');
            });
          }, 500);
        });
      }
    }, 5000); // Check every 5 seconds
  }

  public stopChaosMonkey() {
    if (this.chaosInterval) {
      clearInterval(this.chaosInterval);
      this.chaosInterval = null;
    }
  }
}

# System Architecture & Design Document

## 1. Executive Summary
The **IICPC High-Performance Benchmarking Platform** is a decoupled, sandboxed orchestration system designed to evaluate algorithmic matching engines. The platform isolates untrusted contestant code, attacks it with a simulated high-frequency trading bot fleet, and performs real-time mathematical auditing to grade the engine on **Throughput (TPS)**, **Latency**, and **Algorithmic Correctness**.

---

## 2. High-Level Architecture
The platform is divided into three completely decoupled components to ensure that load generation and telemetry auditing do not interfere with the contestant's CPU resources:

1. **Frontend (React / Vite)**: A responsive, Material Light themed dashboard where contestants upload code, configure stress tests, and view real-time telemetry graphs and leaderboards.
2. **Backend Orchestrator (Node.js / Express)**: The central brain that compiles code, spawns the sandboxed engines, coordinates the Bot Fleet, and aggregates telemetry.
3. **Contestant Sandbox (Native / Child Processes)**: Isolated runtime environments where contestant code (C++, Node.js) runs.

---

## 3. Core Components

### 3.1 The Code Sandbox & Orchestrator
When a contestant submits code (e.g., C++), the `ContestantOrchestrator` securely compiles it using native toolchains (e.g., `g++ -O3`). 
The engine is spawned as a child process listening on an HTTP port. This prevents memory leaks or crashes in the contestant's code from bringing down the core platform.

### 3.2 The Bot Fleet (Load Generator)
To simulate intense market volatility, the `LoadGenerator` spins up multiple Node.js **Worker Threads**. 
Each worker acts as an independent high-frequency trading bot, bypassing standard HTTP overhead by firing aggressive REST requests (`/order`, `/cancel`) directly to the sandboxed engine. The fleet scales dynamically based on UI configuration.

### 3.3 Real-time Telemetry Ingestion
High-performance compiled languages (C++) can output tens of thousands of trades per second. Standard logging would crash the server.
- The sandboxed engines emit `ORDER` and `TRADE` events as raw JSON to `stdout`.
- The Orchestrator's stream parser intercepts these chunks, buffers them safely, and routes them to the `TelemetryIngester`.
- **UI Throttling**: To prevent the React frontend from freezing, the backend heavily throttles the raw JSON logs sent via WebSockets (max 1 log / 500ms), while calculating TPS and Latency metrics internally at maximum speed.

---

## 4. Algorithmic Correctness Auditing
Speed is irrelevant if the matching logic is flawed. The platform features an independent **Reference Engine**.

1. **Order Tracking**: When a bot places an order, the `TelemetryIngester` records it.
2. **Mathematical Expectations**: The Reference Engine processes the identical order and calculates the *mathematically expected* outcome (e.g., matching a Limit Order against an existing Ask based on strictly enforced FIFO time priority).
3. **Reconciliation**: When the contestant's engine emits a `TRADE` event, the platform checks it against the expected queue.
4. **Violations**: If the contestant's engine matches the wrong order, uses the wrong price, or violates FIFO priority, a `FIFO_VIOLATION` is flagged, and the Correctness Score is penalized.

---

## 5. Scoring Mechanism
At the end of a stress test, a **Composite Score** is calculated to rank the engine on the Live Leaderboard:

- **Max TPS**: The peak throughput achieved during the run.
- **Latency Penalty**: Heavy deductions are applied if the engine's `p99` latency spikes above acceptable thresholds, ensuring contestants don't cheat by queueing orders indefinitely in memory.
- **Correctness Multiplier**: The final score is multiplied by the correctness percentage (0% to 100%). A single mathematical error drastically reduces the final score.

# IICPC Summer Hackathon 2026: Distributed Benchmarking & Hosting Platform

Welcome to the **Distributed Benchmarking & Hosting Platform**! This platform is designed for high-performance stress testing, telemetry auditing, and real-time visualization of trading matching engines. The system supports multi-threaded market traffic generation, microsecond latency percentiles tracking, and algorithmic FIFO correctness validation.

---

## 🚀 Key Features

*   **Polyglot Matching Engine Support**: Includes reference matching engines implemented in **C++17**, **Rust**, **Go**, and **TypeScript/Node.js**.
*   **Dual Orchestration Environment (Docker & Native Fallback)**:
    *   *Production*: Isolates contestant containers with pinned CPU cores and RAM limits.
    *   *Development/macOS*: Seamlessly compiles and spawns native binary fallbacks locally if Docker is not active.
*   **Low-Overhead Telemetry Channel**: Captures zero-delay matching engine stdout events to log trades, cancellations, and order books under microsecond precisions.
*   **Parallel FIFO Correctness Auditor**: Replicates orders through a pure TypeScript reference order book in real-time to audit double-auction priority correctness.
*   **Multi-Threaded Bot Fleet**: Spawns concurrent `worker_threads` generating diverse market behaviors (Market Makers, Arbitrageurs, Momentum, and Noise Traders) scaling up to 5,000+ RPS.
*   **Premium Glassmorphic Leaderboard**: Dynamic React dashboard utilizing standard HSL styling and the React View Transitions API to glide entries up and down the rankings.

---

## 🏗️ Repository Layout

```text
├── backend/                  # Express + WebSockets platform server & telemetry orchestrator
├── bot-fleet/                # Multi-threaded dynamic market traffic load generator
├── contestant-examples/      # Reference matching engine implementations (C++, Go, Rust, JS)
├── deploy/                   # Infrastructure as Code (Terraform, Compose, K8s manifests)
└── frontend/                 # Vite + React real-time leaderboard dashboard
```

---

## 🛠️ Getting Started (Local Development)

Follow these steps to run the complete platform stack locally on your computer.

### Prerequisites
*   [Node.js (v18+)](https://nodejs.org/)
*   [Git](https://git-scm.com/)
*   *Optional*: [Docker & Docker Compose](https://www.docker.com/) (For sandboxed runs; the system automatically falls back to native compilation using `g++` or `cargo` if Docker is offline).

---

### Setup Instructions

#### 1. Clone the repository and install root packages:
```bash
git clone https://github.com/Saksham-Gupta-GH/iicpc.git
cd iicpc
npm install
```

#### 2. Start the Backend Orchestrator:
Navigate to the `backend/` directory, install its dependencies, and launch the platform server:
```bash
cd backend
npm install
npm run start
```
*Note: The server runs on port **`5050`** to avoid conflicts with default macOS AirPlay receivers.*

#### 3. Start the Frontend Dashboard:
In a new terminal window, navigate to the `frontend/` directory, install its dependencies, and start the Vite development server:
```bash
cd frontend
npm install
npm run dev
```
Open **`http://localhost:5173`** (or the port output by Vite) in your browser to view the real-time leaderboard and console!

---

## 🐳 Docker Stack Setup (Staging / Production)

To launch the entire platform (orchestrator server, telemetry handlers, and database records) inside unified containers, run:

```bash
docker-compose -f deploy/docker-compose.yml up --build
```

---

## ☁️ Infrastructure as Code (IaC) & Deployment

For deployment in cloud environments, look inside the `deploy/` directory:
*   **Terraform**: Provision secure AWS clusters (ECS Fargate, EKS, RDS PostgreSQL, VPC networks) using the files in [deploy/terraform/](file:///Users/sakshamgupta/Documents/projects/iicpc/deploy/terraform/).
*   **Kubernetes Manifests**: Deploy and scale components with pre-configured Horizontal Pod Autoscalers (HPA) in [deploy/k8s/](file:///Users/sakshamgupta/Documents/projects/iicpc/deploy/k8s/).

---

## 📝 Authors & Team Notes

Built for the **IICPC Summer Hackathon 2026**. Feel free to add your teammate details here!
*   **Saksham Gupta** - GitHub: [@Saksham-Gupta-GH](https://github.com/Saksham-Gupta-GH)

import { parentPort, workerData } from 'worker_threads';
import * as http from 'http';

const { workerId, archetype, targetUrl, targetRate } = workerData;

let isRunning = true;
let activeOrderIds: string[] = [];
let priceBasis = 10000.0; // Simulated asset baseline (BTCUSD)

// Simple high-speed HTTP client to avoid external overhead
function postJson(url: string, path: string, bodyObj: any): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(bodyObj);
    const options = {
      hostname: 'localhost',
      port: 8080,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      },
      agent: new http.Agent({ keepAlive: true, maxSockets: 100 })
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode || 500, body: data }));
    });

    req.on('error', (err) => reject(err));
    req.write(bodyStr);
    req.end();
  });
}

function generateUuid(): string {
  return `bot-${workerId}-${Math.random().toString(36).substring(2, 10)}-${Date.now()}`;
}

async function placeOrder() {
  if (!isRunning) return;

  const orderId = generateUuid();
  const side = Math.random() > 0.5 ? 'BUY' : 'SELL';
  let type = 'LIMIT';
  let price = priceBasis + (Math.random() - 0.5) * 50; // Random walk around baseline
  let quantity = Math.round((Math.random() * 5 + 0.1) * 100) / 100;

  // Adapt behavior by archetype
  if (archetype === 'MM') {
    // Market Maker: tight limit spreads
    price = priceBasis + (side === 'BUY' ? -2.0 : 2.0) - (Math.random() * 3.0);
  } else if (archetype === 'HFT') {
    // High Frequency Momentum: rapid market / immediate execution
    type = 'MARKET';
  } else if (archetype === 'ARBITRAGE') {
    // Snipe prices
    price = priceBasis + (side === 'BUY' ? 1.0 : -1.0);
  } else {
    // Noise Trader: random limit order
    type = Math.random() > 0.8 ? 'MARKET' : 'LIMIT';
  }

  price = Math.round(price * 100) / 100;

  const orderPayload = {
    id: orderId,
    symbol: 'BTCUSD',
    side,
    type,
    price,
    quantity
  };

  const sentTime = Date.now();

  try {
    // Send order placement to Telemetry Ingester is now handled directly by sandboxed engine stdout sequencing
    const res = await postJson(targetUrl, '/order', orderPayload);
    const latency = Date.now() - sentTime;

    parentPort?.postMessage({
      type: 'METRIC',
      payload: {
        latency,
        success: res.statusCode === 202 || res.statusCode === 200,
        type: 'ORDER'
      }
    });

    if (type === 'LIMIT' && res.statusCode === 202) {
      activeOrderIds.push(orderId);
      // Keep inventory capped
      if (activeOrderIds.length > 50) {
        cancelOldestOrder();
      }
    }
  } catch (err: any) {
    parentPort?.postMessage({
      type: 'METRIC',
      payload: {
        latency: Date.now() - sentTime,
        success: false,
        type: 'ORDER_ERROR',
        error: err.message
      }
    });
  }
}

async function cancelOldestOrder() {
  if (activeOrderIds.length === 0 || !isRunning) return;
  const orderId = activeOrderIds.shift()!;

  const sentTime = Date.now();
  const cancelPayload = { id: orderId, symbol: 'BTCUSD' };

  try {
    // Send order cancellation to Telemetry Ingester is now handled directly by sandboxed engine stdout sequencing
    const res = await postJson(targetUrl, '/cancel', cancelPayload);
    const latency = Date.now() - sentTime;

    parentPort?.postMessage({
      type: 'METRIC',
      payload: {
        latency,
        success: res.statusCode === 200,
        type: 'CANCEL'
      }
    });
  } catch (err: any) {
    parentPort?.postMessage({
      type: 'METRIC',
      payload: {
        latency: Date.now() - sentTime,
        success: false,
        type: 'CANCEL_ERROR',
        error: err.message
      }
    });
  }
}

// Main execution loop
function run() {
  // Calculate interval between orders based on targetRate (orders/sec)
  const intervalMs = Math.max(1000 / targetRate, 1);

  const loop = setInterval(() => {
    if (!isRunning) {
      clearInterval(loop);
      return;
    }

    // 10% chance to cancel an order instead of placing, or place order
    if (Math.random() > 0.85 && activeOrderIds.length > 0) {
      cancelOldestOrder();
    } else {
      placeOrder();
    }
  }, intervalMs);
}

// Receive messages from main thread
parentPort?.on('message', (msg) => {
  if (msg === 'STOP') {
    isRunning = false;
  }
});

run();

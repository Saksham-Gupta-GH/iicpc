import { parentPort, workerData } from 'worker_threads';
import * as http from 'http';
import WebSocket from 'ws';

const { workerId, archetype, targetUrl, targetRate } = workerData;

let isRunning = true;
let activeOrderIds: string[] = [];
let priceBasis = 10000.0; // Simulated asset baseline (BTCUSD)

const wsUrl = targetUrl.replace(/^http/, 'ws');
let wsClient: WebSocket | null = null;
let useWebSockets = false;

function initWebSocket(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(wsUrl);
      
      ws.on('open', () => {
        wsClient = ws;
        useWebSockets = true;
        resolve();
      });

      ws.on('error', () => {
        // Failed to connect WS, fallback to REST
        resolve();
      });

      ws.on('close', () => {
        useWebSockets = false;
        wsClient = null;
      });
    } catch (e) {
      resolve();
    }
  });
}

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

  if (archetype === 'MM') {
    price = priceBasis + (side === 'BUY' ? -2.0 : 2.0) - (Math.random() * 3.0);
  } else if (archetype === 'HFT') {
    type = 'MARKET';
  } else if (archetype === 'ARBITRAGE') {
    price = priceBasis + (side === 'BUY' ? 1.0 : -1.0);
  } else {
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
    let success = false;
    
    if (useWebSockets && wsClient?.readyState === WebSocket.OPEN) {
      wsClient.send(JSON.stringify({ action: 'order', payload: orderPayload }));
      success = true;
    } else {
      const res = await postJson(targetUrl, '/order', orderPayload);
      success = res.statusCode === 202 || res.statusCode === 200;
    }

    const latency = Date.now() - sentTime;
    if (success) {
      parentPort?.postMessage({
        type: 'ORDER_PLACED',
        payload: orderPayload
      });
    }

    parentPort?.postMessage({
      type: 'METRIC',
      payload: {
        latency,
        success,
        type: 'ORDER'
      }
    });

    if (type === 'LIMIT' && success) {
      activeOrderIds.push(orderId);
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
    let success = false;
    
    if (useWebSockets && wsClient?.readyState === WebSocket.OPEN) {
      wsClient.send(JSON.stringify({ action: 'cancel', payload: cancelPayload }));
      success = true;
    } else {
      const res = await postJson(targetUrl, '/cancel', cancelPayload);
      success = res.statusCode === 200;
    }

    const latency = Date.now() - sentTime;
    if (success) {
      parentPort?.postMessage({
        type: 'ORDER_CANCELLED',
        payload: cancelPayload
      });
    }

    parentPort?.postMessage({
      type: 'METRIC',
      payload: {
        latency,
        success,
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
async function run() {
  await initWebSocket();
  
  const intervalMs = Math.max(1000 / targetRate, 1);

  const loop = setInterval(() => {
    if (!isRunning) {
      clearInterval(loop);
      if (wsClient) {
        wsClient.close();
      }
      return;
    }

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

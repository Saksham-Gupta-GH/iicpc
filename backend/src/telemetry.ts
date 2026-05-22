import { ReferenceOrderBook, Trade } from './reference_orderbook';

export interface TelemetryStats {
  tps: number;
  totalOrders: number;
  totalCancels: number;
  successfulMatches: number;
  p50Latency: number;
  p90Latency: number;
  p99Latency: number;
  correctnessScore: number; // 0 to 100
  violations: Array<{
    type: string;
    description: string;
    timestamp: number;
  }>;
}

export class TelemetryIngester {
  referenceBook = new ReferenceOrderBook();
  latencies: number[] = [];
  
  // Audit tracks
  expectedTradesQueue: Trade[] = [];
  actualTradesMatched = 0;
  totalViolationsCount = 0;
  violations: Array<{ type: string; description: string; timestamp: number }> = [];

  // Performance metrics
  totalOrders = 0;
  totalCancels = 0;
  startTime: number | null = null;
  runDurationSeconds = 0;

  recordLatency(latencyMs: number) {
    this.latencies.push(latencyMs);
    // Sort periodically or keep insertion sorted for percentile performance
    // For small/medium stress tests, simple sorting is extremely robust
  }

  recordOrderPlacement(order: any) {
    this.totalOrders++;
    if (!this.startTime) this.startTime = Date.now();

    // 1. Process in Reference Book
    const expected = this.referenceBook.processOrder({
      id: order.id,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      price: order.price,
      quantity: order.quantity
    });

    // 2. Queue expected trades for comparison
    this.expectedTradesQueue.push(...expected);
  }

  recordOrderCancellation(id: string) {
    this.totalCancels++;
    this.referenceBook.cancelOrder(id);
  }

  recordActualTrade(actual: any) {
    // Look for matching expected trade in the queue
    const index = this.expectedTradesQueue.findIndex(
      expected =>
        expected.buyOrderId === actual.buyOrderId &&
        expected.sellOrderId === actual.sellOrderId
    );

    if (index !== -1) {
      const expected = this.expectedTradesQueue[index];
      
      // Check price correctness
      if (Math.abs(expected.price - actual.price) > 0.0001) {
        this.addViolation(
          'PRICE_VIOLATION',
          `Order matched at price ${actual.price}, expected ${expected.price} for Buy:${actual.buyOrderId} Sell:${actual.sellOrderId}`
        );
      }
      
      // Check quantity correctness
      if (Math.abs(expected.quantity - actual.quantity) > 0.0001) {
        this.addViolation(
          'QUANTITY_VIOLATION',
          `Order matched quantity ${actual.quantity}, expected ${expected.quantity} for Buy:${actual.buyOrderId} Sell:${actual.sellOrderId}`
        );
      }

      this.actualTradesMatched++;
      // Remove from expected queue
      this.expectedTradesQueue.splice(index, 1);
    } else {
      // Check if it's completely unexpected or priority issue
      this.addViolation(
        'UNEXPECTED_MATCH_OR_FIFO_VIOLATION',
        `Contestant emitted trade Buy:${actual.buyOrderId} Sell:${actual.sellOrderId} at price ${actual.price} which was not anticipated by reference FIFO priority`
      );
    }
  }

  private addViolation(type: string, description: string) {
    this.totalViolationsCount++;
    this.violations.push({
      type,
      description,
      timestamp: Date.now()
    });
    if (this.violations.length > 50) {
      this.violations.shift(); // Cap violations in log to top 50
    }
  }

  getStats(): TelemetryStats {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;

    const duration = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;
    const activeDuration = Math.max(duration, 0.1);
    const tps = (this.totalOrders + this.totalCancels) / activeDuration;

    // Correctness score formula: starts at 100, drops by 5 points per violation
    const correctnessScore = Math.max(100 - this.totalViolationsCount * 5, 0);

    return {
      tps: Math.round(tps * 100) / 100,
      totalOrders: this.totalOrders,
      totalCancels: this.totalCancels,
      successfulMatches: this.actualTradesMatched,
      p50Latency: Math.round(p50 * 100) / 100,
      p90Latency: Math.round(p90 * 100) / 100,
      p99Latency: Math.round(p99 * 100) / 100,
      correctnessScore,
      violations: this.violations
    };
  }

  reset() {
    this.referenceBook = new ReferenceOrderBook();
    this.latencies = [];
    this.expectedTradesQueue = [];
    this.actualTradesMatched = 0;
    this.totalViolationsCount = 0;
    this.violations = [];
    this.totalOrders = 0;
    this.totalCancels = 0;
    this.startTime = null;
  }
}

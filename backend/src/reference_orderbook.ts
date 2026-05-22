export interface Order {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET';
  price: number;
  quantity: number;
  filled: number;
  timestamp: number;
}

export interface Trade {
  symbol: string;
  buyOrderId: string;
  sellOrderId: string;
  price: number;
  quantity: number;
  timestamp: number;
}

export class ReferenceOrderBook {
  bids: Order[] = []; // Sorted descending
  asks: Order[] = []; // Sorted ascending
  orderMap = new Map<string, Order>();

  processOrder(o: Omit<Order, 'filled' | 'timestamp'> & { price?: number }): Trade[] {
    const order: Order = {
      ...o,
      price: o.price || 0,
      filled: 0,
      timestamp: Date.now()
    };

    const trades: Trade[] = [];

    if (order.side === 'BUY') {
      while (this.asks.length > 0 && order.quantity > 0) {
        const ask = this.asks[0];
        if (order.type === 'LIMIT' && order.price < ask.price) break;

        const matchQty = Math.min(order.quantity, ask.quantity);
        order.quantity -= matchQty;
        order.filled += matchQty;
        ask.quantity -= matchQty;
        ask.filled += matchQty;

        trades.push({
          symbol: order.symbol,
          buyOrderId: order.id,
          sellOrderId: ask.id,
          price: ask.price,
          quantity: matchQty,
          timestamp: Date.now()
        });

        if (ask.quantity === 0) {
          this.asks.shift();
          this.orderMap.delete(ask.id);
        }
      }

      if (order.quantity > 0 && order.type === 'LIMIT') {
        this.bids.push(order);
        this.bids.sort((a, b) => b.price - a.price || a.timestamp - b.timestamp);
        this.orderMap.set(order.id, order);
      }
    } else {
      while (this.bids.length > 0 && order.quantity > 0) {
        const bid = this.bids[0];
        if (order.type === 'LIMIT' && order.price > bid.price) break;

        const matchQty = Math.min(order.quantity, bid.quantity);
        order.quantity -= matchQty;
        order.filled += matchQty;
        bid.quantity -= matchQty;
        bid.filled += matchQty;

        trades.push({
          symbol: order.symbol,
          buyOrderId: bid.id,
          sellOrderId: order.id,
          price: bid.price,
          quantity: matchQty,
          timestamp: Date.now()
        });

        if (bid.quantity === 0) {
          this.bids.shift();
          this.orderMap.delete(bid.id);
        }
      }

      if (order.quantity > 0 && order.type === 'LIMIT') {
        this.asks.push(order);
        this.asks.sort((a, b) => a.price - b.price || a.timestamp - b.timestamp);
        this.orderMap.set(order.id, order);
      }
    }

    return trades;
  }

  cancelOrder(id: string): boolean {
    const order = this.orderMap.get(id);
    if (!order) return false;

    if (order.side === 'BUY') {
      this.bids = this.bids.filter(o => o.id !== id);
    } else {
      this.asks = this.asks.filter(o => o.id !== id);
    }
    this.orderMap.delete(id);
    return true;
  }

  getSnapshot() {
    return {
      bids: this.bids.map(o => ({ price: o.price, quantity: o.quantity, id: o.id })),
      asks: this.asks.map(o => ({ price: o.price, quantity: o.quantity, id: o.id }))
    };
  }
}

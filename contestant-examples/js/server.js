const http = require('http');
const WebSocket = require('ws');

// Order Book State
const books = {
  BTCUSD: { bids: [], asks: [] }
};
const orderMap = new Map(); // orderId -> Order Object

// WS clients for trade streaming
let wsClients = new Set();

function broadcast(event) {
  const message = JSON.stringify(event);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// Order class
class Order {
  constructor(id, symbol, side, type, price, quantity) {
    this.id = id;
    this.symbol = symbol;
    this.side = side;
    this.type = type;
    this.price = parseFloat(price);
    this.quantity = parseFloat(quantity);
    this.filled = 0;
    this.timestamp = Date.now();
  }
}

// Match incoming order against the book
function matchOrder(order) {
  const book = books[order.symbol];
  if (!book) return false;

  let trades = [];

  if (order.side === 'BUY') {
    // Match against asks (sorted ascending by price)
    while (book.asks.length > 0 && order.quantity > 0) {
      const ask = book.asks[0];
      if (order.type === 'LIMIT' && order.price < ask.price) break;

      const matchQty = Math.min(order.quantity, ask.quantity);
      order.quantity -= matchQty;
      order.filled += matchQty;
      ask.quantity -= matchQty;
      ask.filled += matchQty;

      trades.push({
        type: 'TRADE',
        symbol: order.symbol,
        buyOrderId: order.id,
        sellOrderId: ask.id,
        price: ask.price,
        quantity: matchQty,
        timestamp: Date.now()
      });

      if (ask.quantity === 0) {
        book.asks.shift();
        orderMap.delete(ask.id);
      }
    }

    // If limit order and not fully filled, insert into bids (sorted descending by price)
    if (order.quantity > 0 && order.type === 'LIMIT') {
      book.bids.push(order);
      // Sort bids: descending price, then ascending timestamp (FIFO)
      book.bids.sort((a, b) => b.price - a.price || a.timestamp - b.timestamp);
      orderMap.set(order.id, order);
    }
  } else if (order.side === 'SELL') {
    // Match against bids (sorted descending by price)
    while (book.bids.length > 0 && order.quantity > 0) {
      const bid = book.bids[0];
      if (order.type === 'LIMIT' && order.price > bid.price) break;

      const matchQty = Math.min(order.quantity, bid.quantity);
      order.quantity -= matchQty;
      order.filled += matchQty;
      bid.quantity -= matchQty;
      bid.filled += matchQty;

      trades.push({
        type: 'TRADE',
        symbol: order.symbol,
        buyOrderId: bid.id,
        sellOrderId: order.id,
        price: bid.price,
        quantity: matchQty,
        timestamp: Date.now()
      });

      if (bid.quantity === 0) {
        book.bids.shift();
        orderMap.delete(bid.id);
      }
    }

    // If limit order and not fully filled, insert into asks (sorted ascending by price)
    if (order.quantity > 0 && order.type === 'LIMIT') {
      book.asks.push(order);
      // Sort asks: ascending price, then ascending timestamp (FIFO)
      book.asks.sort((a, b) => a.price - b.price || a.timestamp - b.timestamp);
      orderMap.set(order.id, order);
    }
  }

  // Broadcast trades
  for (const trade of trades) {
    broadcast(trade);
    console.log(JSON.stringify(trade));
  }


  return true;
}

// HTTP Server
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'POST' && req.url === '/order') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { id, symbol, side, type, price, quantity } = data;

        if (!id || !symbol || !side || !type || quantity <= 0) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ status: 'REJECTED', reason: 'Invalid parameters' }));
        }

        if (orderMap.has(id)) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ status: 'REJECTED', reason: 'Duplicate order ID' }));
        }

        if (!books[symbol]) {
          books[symbol] = { bids: [], asks: [] };
        }

        const order = new Order(id, symbol, side, type, price, quantity);
        console.log(JSON.stringify({
          type: 'ORDER',
          id: order.id,
          symbol: order.symbol,
          side: order.side,
          type: order.type,
          price: order.price,
          quantity: order.quantity,
          timestamp: order.timestamp
        }));
        matchOrder(order);

        res.statusCode = 202;
        res.end(JSON.stringify({ status: 'ACCEPTED', orderId: id }));
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ status: 'REJECTED', reason: 'Malformed JSON' }));
      }
    });
  } else if (req.method === 'POST' && req.url === '/cancel') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { id, symbol } = data;

        if (!id || !symbol) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ status: 'REJECTED', reason: 'Missing id or symbol' }));
        }

        const order = orderMap.get(id);
        if (!order || order.symbol !== symbol) {
          res.statusCode = 404;
          return res.end(JSON.stringify({ status: 'NOT_FOUND', orderId: id }));
        }

        const book = books[symbol];
        if (order.side === 'BUY') {
          book.bids = book.bids.filter(o => o.id !== id);
        } else {
          book.asks = book.asks.filter(o => o.id !== id);
        }
        orderMap.delete(id);

        const cancelEvent = {
          type: 'CANCEL',
          symbol,
          orderId: id,
          timestamp: Date.now()
        };
        broadcast(cancelEvent);
        console.log(JSON.stringify(cancelEvent));


        res.statusCode = 200;
        res.end(JSON.stringify({ status: 'CANCELLED', orderId: id }));
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ status: 'REJECTED', reason: 'Malformed JSON' }));
      }
    });
  } else if (req.method === 'GET' && req.url.startsWith('/book')) {
    const urlParams = new URL(req.url, `http://${req.headers.host}`);
    const symbol = urlParams.searchParams.get('symbol') || 'BTCUSD';
    const book = books[symbol] || { bids: [], asks: [] };

    const response = {
      bids: book.bids.map(o => ({ price: o.price, quantity: o.quantity, id: o.id })),
      asks: book.asks.map(o => ({ price: o.price, quantity: o.quantity, id: o.id }))
    };

    res.statusCode = 200;
    res.end(JSON.stringify(response));
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
});

// WebSocket Server
const wss = new WebSocket.Server({ server });
wss.on('connection', ws => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Matching Engine (JS) listening on port ${PORT}`);
});

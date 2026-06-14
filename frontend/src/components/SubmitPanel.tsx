import React, { useState, useEffect } from 'react';
import { UploadCloud, Code, FileText, RefreshCw } from 'lucide-react';

interface SubmitPanelProps {
  defaultContestantName: string;
  onUploadSuccess: (msg: string, lang: string) => void;
  onUploadError: (msg: string) => void;
}

const TEMPLATES: Record<string, string> = {
  js: `// Sandboxed Node.js Orderbook matching engine submission
const http = require('http');
const WebSocket = require('ws');

const books = { BTCUSD: { bids: [], asks: [] } };
const orderMap = new Map();
let wsClients = new Set();

function broadcast(event) {
  const message = JSON.stringify(event);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

function matchOrder(order) {
  const book = books[order.symbol];
  if (!book) return;

  let trades = [];

  if (order.side === 'BUY') {
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

    if (order.quantity > 0 && order.type === 'LIMIT') {
      book.bids.push(order);
      book.bids.sort((a, b) => b.price - a.price || a.timestamp - b.timestamp);
      orderMap.set(order.id, order);
    }
  } else {
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

    if (order.quantity > 0 && order.type === 'LIMIT') {
      book.asks.push(order);
      book.asks.sort((a, b) => a.price - b.price || a.timestamp - b.timestamp);
      orderMap.set(order.id, order);
    }
  }

  // Broadcast to WS & stdout logs for low-latency Telemetry audits!
  for (const trade of trades) {
    broadcast(trade);
    console.log(JSON.stringify(trade));
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'POST' && req.url === '/order') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { id, symbol, side, type, price, quantity } = data;
        const order = { id, symbol, side, type, price: parseFloat(price), quantity: parseFloat(quantity), filled: 0, timestamp: Date.now() };
        
        matchOrder(order);
        
        res.statusCode = 202;
        res.end(JSON.stringify({ status: 'ACCEPTED', orderId: id }));
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ status: 'REJECTED', reason: 'Malformed request' }));
      }
    });
  } else if (req.method === 'POST' && req.url === '/cancel') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { id, symbol } = JSON.parse(body);
        const order = orderMap.get(id);
        if (order) {
          const book = books[symbol];
          if (order.side === 'BUY') {
            book.bids = book.bids.filter(o => o.id !== id);
          } else {
            book.asks = book.asks.filter(o => o.id !== id);
          }
          orderMap.delete(id);
          const cancelEvent = { type: 'CANCEL', symbol, orderId: id, timestamp: Date.now() };
          broadcast(cancelEvent);
          console.log(JSON.stringify(cancelEvent));
        }
        res.statusCode = 200;
        res.end(JSON.stringify({ status: 'CANCELLED', orderId: id }));
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ status: 'REJECTED' }));
      }
    });
  } else if (req.method === 'GET' && req.url.startsWith('/book')) {
    const book = books.BTCUSD;
    res.statusCode = 200;
    res.end(JSON.stringify({
      bids: book.bids.map(o => ({ price: o.price, quantity: o.quantity, id: o.id })),
      asks: book.asks.map(o => ({ price: o.price, quantity: o.quantity, id: o.id }))
    }));
  } else {
    res.statusCode = 404;
    res.end();
  }
});

const wss = new WebSocket.Server({ server });
wss.on('connection', ws => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
});

server.listen(8080, () => {
  console.log('Matching Engine (JS Uploaded) online on port 8080');
});`,

  cpp: `// Sandboxed C++17 Orderbook matching engine submission
#include <iostream>
#include <string>
#include <vector>
#include <list>
#include <map>
#include <unordered_map>
#include <mutex>
#include <chrono>
#include <sstream>
#include <memory>
#include "httplib.h"

using namespace std;

struct Order {
    string id;
    string symbol;
    string side; // BUY, SELL
    string type; // LIMIT, MARKET
    double price;
    double quantity;
    double filled = 0.0;
    long long timestamp;
};

struct TradeEvent {
    string type = "TRADE";
    string symbol;
    string buyOrderId;
    string sellOrderId;
    double price;
    double quantity;
    long long timestamp;
};

struct OrderRef {
    double price;
    string side;
    list<Order>::iterator it;
};

map<double, list<Order>, greater<double>> bids;
map<double, list<Order>, less<double>> asks;
unordered_map<string, OrderRef> order_map;
mutex mtx;

long long get_now_ms() {
    return chrono::duration_cast<chrono::milliseconds>(
        chrono::system_clock::now().time_since_epoch()
    ).count();
}

void emit_trade(const TradeEvent& t) {
    stringstream ss;
    ss << "{\"type\":\"TRADE\",\"symbol\":\"" << t.symbol 
       << "\",\"buyOrderId\":\"" << t.buyOrderId 
       << "\",\"sellOrderId\":\"" << t.sellOrderId 
       << "\",\"price\":" << t.price 
       << ",\"quantity\":" << t.quantity 
       << ",\"timestamp\":" << t.timestamp << "}\\n";
    cout << ss.str() << flush;
}

void match_order(Order& order) {
    vector<TradeEvent> trades;

    if (order.side == "BUY") {
        while (!asks.empty() && order.quantity > 0) {
            auto it = asks.begin();
            double ask_price = it->first;
            auto& queue = it->second;

            if (order.type == "LIMIT" && order.price < ask_price) break;

            while (!queue.empty() && order.quantity > 0) {
                auto& ask = queue.front();
                double match_qty = min(order.quantity, ask.quantity);

                order.quantity -= match_qty;
                order.filled += match_qty;
                ask.quantity -= match_qty;
                ask.filled += match_qty;

                trades.push_back(TradeEvent{
                    "TRADE", order.symbol, order.id, ask.id, ask_price, match_qty, get_now_ms()
                });

                if (ask.quantity == 0) {
                    order_map.erase(ask.id);
                    queue.pop_front();
                }
            }

            if (queue.empty()) asks.erase(it);
        }

        if (order.quantity > 0 && order.type == "LIMIT") {
            auto& queue = bids[order.price];
            queue.push_back(order);
            order_map[order.id] = OrderRef{order.price, "BUY", --queue.end()};
        }
    } else {
        while (!bids.empty() && order.quantity > 0) {
            auto it = bids.begin();
            double bid_price = it->first;
            auto& queue = it->second;

            if (order.type == "LIMIT" && order.price > bid_price) break;

            while (!queue.empty() && order.quantity > 0) {
                auto& bid = queue.front();
                double match_qty = min(order.quantity, bid.quantity);

                order.quantity -= match_qty;
                order.filled += match_qty;
                bid.quantity -= match_qty;
                bid.filled += match_qty;

                trades.push_back(TradeEvent{
                    "TRADE", order.symbol, bid.id, order.id, bid_price, match_qty, get_now_ms()
                });

                if (bid.quantity == 0) {
                    order_map.erase(bid.id);
                    queue.pop_front();
                }
            }

            if (queue.empty()) bids.erase(it);
        }

        if (order.quantity > 0 && order.type == "LIMIT") {
            auto& queue = asks[order.price];
            queue.push_back(order);
            order_map[order.id] = OrderRef{order.price, "SELL", --queue.end()};
        }
    }

    for (const auto& t : trades) emit_trade(t);
}

int main() {
    httplib::Server svr;

    svr.Post("/order", [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Content-Type", "application/json");
        // Simple manual JSON parse for speed and zero external dependencies
        string id, symbol, side, type;
        double price = 0.0, quantity = 0.0;

        auto get_val = [&](const string& key, string& out) {
            size_t pos = req.body.find("\\"" + key + "\\"");
            if (pos == string::npos) return false;
            pos = req.body.find(":", pos);
            size_t start = req.body.find("\\"", pos);
            size_t end = req.body.find("\\"", start + 1);
            out = req.body.substr(start + 1, end - start - 1);
            return true;
        };

        auto get_num = [&](const string& key, double& out) {
            size_t pos = req.body.find("\\"" + key + "\\"");
            if (pos == string::npos) return false;
            pos = req.body.find(":", pos);
            size_t start = req.body.find_first_of("0123456789.-", pos);
            size_t end = req.body.find_first_not_of("0123456789.eE+-", start);
            out = stod(req.body.substr(start, end - start));
            return true;
        };

        if (get_val("id", id) && get_val("symbol", symbol) && get_val("side", side) && get_val("type", type) && get_num("quantity", quantity)) {
            if (type == "LIMIT") get_num("price", price);

            lock_guard<mutex> lock(mtx);
            if (order_map.find(id) == order_map.end()) {
                Order order{id, symbol, side, type, price, quantity, 0.0, get_now_ms()};
                match_order(order);
                res.status = 202;
                res.set_content("{\\"status\\":\\"ACCEPTED\\",\\"orderId\\":\\"" + id + "\\"}", "application/json");
                return;
            }
        }
        res.status = 400;
        res.set_content("{\\"status\\":\\"REJECTED\\"}", "application/json");
    });

    svr.Post("/cancel", [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Content-Type", "application/json");
        string id, symbol;
        // Simple manual parse
        auto get_val = [&](const string& key, string& out) {
            size_t pos = req.body.find("\\"" + key + "\\"");
            if (pos == string::npos) return false;
            pos = req.body.find(":", pos);
            size_t start = req.body.find("\\"", pos);
            size_t end = req.body.find("\\"", start + 1);
            out = req.body.substr(start + 1, end - start - 1);
            return true;
        };

        if (get_val("id", id) && get_val("symbol", symbol)) {
            lock_guard<mutex> lock(mtx);
            auto it = order_map.find(id);
            if (it != order_map.end()) {
                OrderRef ref = it->second;
                if (ref.side == "BUY") {
                    bids[ref.price].erase(ref.it);
                    if (bids[ref.price].empty()) bids.erase(ref.price);
                } else {
                    asks[ref.price].erase(ref.it);
                    if (asks[ref.price].empty()) asks.erase(ref.price);
                }
                order_map.erase(it);
                res.status = 200;
                res.set_content("{\\"status\\":\\"CANCELLED\\"}", "application/json");
                return;
            }
        }
        res.status = 404;
    });

    cout << "Matching Engine (C++ Uploaded) online on port 8080" << endl << flush;
    svr.listen("0.0.0.0", 8080);
    return 0;
}`,

  go: `// Sandboxed Go Orderbook matching engine submission
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type Order struct {
	ID        string    \`json:"id"\`
	Symbol    string    \`json:"symbol"\`
	Side      string    \`json:"side"\` // BUY, SELL
	Type      string    \`json:"type"\` // LIMIT, MARKET
	Price     float64   \`json:"price"\`
	Quantity  float64   \`json:"quantity"\`
	Filled    float64   \`json:"filled"\`
	Timestamp time.Time \`json:"timestamp"\`
}

type OrderBook struct {
	Bids []*Order
	Asks []*Order
}

var (
	books    = map[string]*OrderBook{"BTCUSD": {Bids: make([]*Order, 0), Asks: make([]*Order, 0)}}
	orderMap = make(map[string]*Order)
	mu       sync.Mutex
)

type Event struct {
	Type        string    \`json:"type"\`
	Symbol      string    \`json:"symbol"\`
	BuyOrderID  string    \`json:"buyOrderId,omitempty"\`
	SellOrderID string    \`json:"sellOrderId,omitempty"\`
	OrderID     string    \`json:"orderId,omitempty"\`
	Price       float64   \`json:"price"\`
	Quantity    float64   \`json:"quantity"\`
	Timestamp   time.Time \`json:"timestamp"\`
}

func matchOrder(order *Order) {
	book := books[order.Symbol]
	var trades []Event

	if order.Side == "BUY" {
		for len(book.Asks) > 0 && order.Quantity > 0 {
			ask := book.Asks[0]
			if order.Type == "LIMIT" && order.Price < ask.Price {
				break
			}
			matchQty := order.Quantity
			if ask.Quantity < matchQty {
				matchQty = ask.Quantity
			}

			order.Quantity -= matchQty
			order.Filled += matchQty
			ask.Quantity -= matchQty
			ask.Filled += matchQty

			trades = append(trades, Event{
				Type:        "TRADE",
				Symbol:      order.Symbol,
				BuyOrderID:  order.ID,
				SellOrderID: ask.ID,
				Price:       ask.Price,
				Quantity:    matchQty,
				Timestamp:   time.Now(),
			})

			if ask.Quantity == 0 {
				book.Asks = book.Asks[1:]
				delete(orderMap, ask.ID)
			}
		}
		if order.Quantity > 0 && order.Type == "LIMIT" {
			book.Bids = append(book.Bids, order)
			sortBids(book.Bids)
			orderMap[order.ID] = order
		}
	} else {
		for len(book.Bids) > 0 && order.Quantity > 0 {
			bid := book.Bids[0]
			if order.Type == "LIMIT" && order.Price > bid.Price {
				break
			}
			matchQty := order.Quantity
			if bid.Quantity < matchQty {
				matchQty = bid.Quantity
			}

			order.Quantity -= matchQty
			order.Filled += matchQty
			bid.Quantity -= matchQty
			bid.Filled += matchQty

			trades = append(trades, Event{
				Type:        "TRADE",
				Symbol:      order.Symbol,
				BuyOrderID:  bid.ID,
				SellOrderID: order.ID,
				Price:       bid.Price,
				Quantity:    matchQty,
				Timestamp:   time.Now(),
			})

			if bid.Quantity == 0 {
				book.Bids = book.Bids[1:]
				delete(orderMap, bid.ID)
			}
		}
		if order.Quantity > 0 && order.Type == "LIMIT" {
			book.Asks = append(book.Asks, order)
			sortAsks(book.Asks)
			orderMap[order.ID] = order
		}
	}

	for _, t := range trades {
		msg, _ := json.Marshal(t)
		fmt.Println(string(msg))
	}
}

func sortBids(bids []*Order) {
	for i := len(bids) - 1; i > 0; i-- {
		if bids[i].Price > bids[i-1].Price || (bids[i].Price == bids[i-1].Price && bids[i].Timestamp.Before(bids[i-1].Timestamp)) {
			bids[i], bids[i-1] = bids[i-1], bids[i]
		}
	}
}

func sortAsks(asks []*Order) {
	for i := len(asks) - 1; i > 0; i-- {
		if asks[i].Price < asks[i-1].Price || (asks[i].Price == asks[i-1].Price && asks[i].Timestamp.Before(asks[i-1].Timestamp)) {
			asks[i], asks[i-1] = asks[i-1], asks[i]
		}
	}
}

func handleOrder(w http.ResponseWriter, r *http.Request) {
	var req Order
	_ = json.NewDecoder(r.Body).Decode(&req)

	mu.Lock()
	defer mu.Unlock()

	if _, exists := orderMap[req.ID]; !exists {
		req.Timestamp = time.Now()
		matchOrder(&req)
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(fmt.Sprintf("{\"status\":\"ACCEPTED\",\"orderId\":\"%s\"}", req.ID)))
		return
	}
	w.WriteHeader(http.StatusBadRequest)
}

func handleCancel(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID     string \`json:"id"\`
		Symbol string \`json:"symbol"\`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	mu.Lock()
	defer mu.Unlock()

	order, exists := orderMap[req.ID]
	if exists {
		book := books[req.Symbol]
		if order.Side == "BUY" {
			for i, o := range book.Bids {
				if o.ID == req.ID {
					book.Bids = append(book.Bids[:i], book.Bids[i+1:]...)
					break
				}
			}
		} else {
			for i, o := range book.Asks {
				if o.ID == req.ID {
					book.Asks = append(book.Asks[:i], book.Asks[i+1:]...)
					break
				}
			}
		}
		delete(orderMap, req.ID)
		cancelEvt := Event{Type: "CANCEL", Symbol: req.Symbol, OrderID: req.ID, Timestamp: time.Now()}
		msg, _ := json.Marshal(cancelEvt)
		fmt.Println(string(msg))
		w.WriteHeader(http.StatusOK)
		return
	}
	w.WriteHeader(http.StatusNotFound)
}

func main() {
	http.HandleFunc("/order", handleOrder)
	http.HandleFunc("/cancel", handleCancel)
	fmt.Println("Matching Engine (Go Uploaded) online on port 8080")
	_ = http.ListenAndServe(":8080", nil)
}`,

  rust: `// Sandboxed Rust Orderbook matching engine submission
use axum::{
    extract::{ws::{Message as WsMessage, WebSocket, WebSocketUpgrade}, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::SystemTime,
};
use tower_http::cors::CorsLayer;

#[derive(Clone, Serialize, Deserialize, Debug)]
struct Order {
    id: String,
    symbol: String,
    side: String,
    #[serde(rename = "type")]
    order_type: String,
    price: f64,
    quantity: f64,
    #[serde(default)]
    filled: f64,
    #[serde(default = "now_millis")]
    timestamp: u64,
}

fn now_millis() -> u64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_millis() as u64
}

struct BookSide {
    levels: BTreeMap<i64, VecDeque<Order>>,
    is_bids: bool,
}

impl BookSide {
    fn new(is_bids: bool) -> Self {
        Self { levels: BTreeMap::new(), is_bids }
    }
    fn insert(&mut self, order: Order) {
        let price_key = if self.is_bids { -scaled_price(order.price) } else { scaled_price(order.price) };
        self.levels.entry(price_key).or_insert_with(VecDeque::new).push_back(order);
    }
}

fn scaled_price(p: f64) -> i64 {
    (p * 10000.0).round() as i64
}

struct OrderBook {
    bids: BookSide,
    asks: BookSide,
    order_map: HashMap<String, Order>,
}

impl OrderBook {
    fn new() -> Self {
        Self { bids: BookSide::new(true), asks: BookSide::new(false), order_map: HashMap::new() }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(tag = "type")]
enum Event {
    TRADE {
        symbol: String,
        #[serde(rename = "buyOrderId")] buy_order_id: String,
        #[serde(rename = "sellOrderId")] sell_order_id: String,
        price: f64,
        quantity: f64,
        timestamp: u64,
    },
    CANCEL {
        symbol: String,
        #[serde(rename = "orderId")] order_id: String,
        timestamp: u64,
    },
}

struct AppState {
    books: Mutex<HashMap<String, OrderBook>>,
}

#[tokio::main]
async fn main() {
    let state = Arc::new(AppState { books: Mutex::new(HashMap::new()) });
    state.books.lock().unwrap().insert("BTCUSD".to_string(), OrderBook::new());

    let app = Router::new()
        .route("/order", post(handle_order))
        .route("/cancel", post(handle_cancel))
        .with_state(state)
        .layer(CorsLayer::permissive());

    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));
    println!("Matching Engine (Rust Uploaded) online on port 8080");
    axum::Server::bind(&addr).serve(app.into_make_service()).await.unwrap();
}

async fn handle_order(State(state): State<Arc<AppState>>, Json(req): Json<Order>) -> impl IntoResponse {
    let mut books = state.books.lock().unwrap();
    let book = books.entry(req.symbol.clone()).or_insert_with(OrderBook::new);

    if book.order_map.contains_key(&req.id) {
        return (StatusCode::BAD_REQUEST, "Duplicate ID");
    }

    let mut order = req;
    order.timestamp = now_millis();
    let mut trades = Vec::new();

    if order.side == "BUY" {
        while order.quantity > 0.0 {
            let mut matched_ask_key = None;
            let mut match_qty = 0.0;
            let mut ask_id = String::new();
            let mut ask_price = 0.0;

            if let Some((&price_key, level)) = book.asks.levels.iter_mut().next() {
                let ask = level.front_mut().unwrap();
                if order.order_type == "LIMIT" && order.price < ask.price { break; }

                match_qty = order.quantity.min(ask.quantity);
                order.quantity -= match_qty;
                order.filled += match_qty;
                ask.quantity -= match_qty;
                ask.filled += match_qty;
                ask_id = ask.id.clone();
                ask_price = ask.price;

                if ask.quantity == 0.0 {
                    level.pop_front();
                    if level.is_empty() { matched_ask_key = Some(price_key); }
                }
            } else { break; }

            if let Some(key) = matched_ask_key { book.asks.levels.remove(&key); }
            book.order_map.remove(&ask_id);

            trades.push(Event::TRADE {
                symbol: order.symbol.clone(),
                buy_order_id: order.id.clone(),
                sell_order_id: ask_id,
                price: ask_price,
                quantity: match_qty,
                timestamp: now_millis(),
            });
        }

        if order.quantity > 0.0 && order.order_type == "LIMIT" {
            book.order_map.insert(order.id.clone(), order.clone());
            book.bids.insert(order);
        }
    } else {
        while order.quantity > 0.0 {
            let mut matched_bid_key = None;
            let mut match_qty = 0.0;
            let mut bid_id = String::new();
            let mut bid_price = 0.0;

            if let Some((&price_key, level)) = book.bids.levels.iter_mut().next() {
                let bid = level.front_mut().unwrap();
                if order.order_type == "LIMIT" && order.price > bid.price { break; }

                match_qty = order.quantity.min(bid.quantity);
                order.quantity -= match_qty;
                order.filled += match_qty;
                bid.quantity -= match_qty;
                bid.filled += match_qty;
                bid_id = bid.id.clone();
                bid_price = bid.price;

                if bid.quantity == 0.0 {
                    level.pop_front();
                    if level.is_empty() { matched_bid_key = Some(price_key); }
                }
            } else { break; }

            if let Some(key) = matched_bid_key { book.bids.levels.remove(&key); }
            book.order_map.remove(&bid_id);

            trades.push(Event::TRADE {
                symbol: order.symbol.clone(),
                buy_order_id: bid_id,
                sell_order_id: order.id.clone(),
                price: bid_price,
                quantity: match_qty,
                timestamp: now_millis(),
            });
        }

        if order.quantity > 0.0 && order.order_type == "LIMIT" {
            book.order_map.insert(order.id.clone(), order.clone());
            book.asks.insert(order);
        }
    }

    for t in trades {
        println!("{}", serde_json::to_string(&t).unwrap());
    }

    (StatusCode::ACCEPTED, "ACCEPTED")
}

async fn handle_cancel(State(state): State<Arc<AppState>>, Json(req: Order>) -> impl IntoResponse {
    let mut books = state.books.lock().unwrap();
    let book = books.get_mut(&req.symbol).unwrap();

    if let Some(order) = book.order_map.remove(&req.id) {
        if order.side == "BUY" {
            let price_key = -scaled_price(order.price);
            if let Some(level) = book.bids.levels.get_mut(&price_key) {
                level.retain(|o| o.id != req.id);
                if level.is_empty() { book.bids.levels.remove(&price_key); }
            }
        } else {
            let price_key = scaled_price(order.price);
            if let Some(level) = book.asks.levels.get_mut(&price_key) {
                level.retain(|o| o.id != req.id);
                if level.is_empty() { book.asks.levels.remove(&price_key); }
            }
        }
        let cancel_evt = Event::CANCEL { symbol: req.symbol, order_id: req.id, timestamp: now_millis() };
        println!("{}", serde_json::to_string(&cancel_evt).unwrap());
        return StatusCode::OK;
    }
    StatusCode::NOT_FOUND
}`
};

export const SubmitPanel: React.FC<SubmitPanelProps> = ({
  defaultContestantName,
  onUploadSuccess,
  onUploadError
}) => {
  const [contestantName, setContestantName] = useState(defaultContestantName || 'Super Trading Systems');
  const [language, setLanguage] = useState('js');
  const [code, setCode] = useState(TEMPLATES.js);
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // Synchronize code block template when language stack changes
  useEffect(() => {
    setCode(TEMPLATES[language] || '');
  }, [language]);

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const nextCode = code.substring(0, start) + '  ' + code.substring(end);
      setCode(nextCode);
      // Reset cursor position asynchronously
      setTimeout(() => {
        e.currentTarget.selectionStart = e.currentTarget.selectionEnd = start + 2;
      }, 0);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setCode(event.target.result as string);
          
          // Auto-detect language by file extension
          const ext = file.name.split('.').pop()?.toLowerCase();
          if (ext === 'js' || ext === 'ts') setLanguage('js');
          else if (ext === 'go') setLanguage('go');
          else if (ext === 'rs') setLanguage('rust');
          else if (ext === 'cpp' || ext === 'hpp' || ext === 'h') setLanguage('cpp');
        }
      };
      reader.readAsText(file);
    }
  };

  const handleFileUploadInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setCode(event.target.result as string);
          
          const ext = file.name.split('.').pop()?.toLowerCase();
          if (ext === 'js' || ext === 'ts') setLanguage('js');
          else if (ext === 'go') setLanguage('go');
          else if (ext === 'rs') setLanguage('rust');
          else if (ext === 'cpp' || ext === 'hpp' || ext === 'h') setLanguage('cpp');
        }
      };
      reader.readAsText(file);
    }
  };

  const handleSubmit = async () => {
    if (!contestantName.trim()) {
      onUploadError('Please enter a team name before uploading!');
      return;
    }
    if (!code.trim()) {
      onUploadError('The matching engine source code cannot be empty!');
      return;
    }

    setIsUploading(true);
    try {
      const res = await fetch('https://iicpc-2q06.onrender.com/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contestantName: contestantName.trim(),
          language,
          code
        })
      });

      const data = await res.json();
      if (res.ok) {
        onUploadSuccess(`Sandbox matching engine [${language.toUpperCase()}] uploaded successfully! Activate 'Benchmark custom uploaded code' to test.`, language);
      } else {
        onUploadError(data.error || 'Failed to upload custom solution.');
      }
    } catch (err) {
      onUploadError('Unable to connect to the orchestrator platform to upload code.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', flexGrow: 1 }}>
      <div className="flex-row-center" style={{ justifyContent: 'space-between' }}>
        <div className="flex-row-center">
          <UploadCloud style={{ color: 'hsl(var(--accent-purple))' }} size={24} />
          <h2>Contestant Sandboxed Submissions</h2>
        </div>
        <span style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))', fontWeight: 500 }}>
          SECURE PIPELINE MV3
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>Contestant Name / Team Key</label>
            <input 
              type="text" 
              value={contestantName} 
              onChange={(e) => setContestantName(e.target.value)} 
              placeholder="Enter contestant team name..."
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>Compile Stack</label>
            <select 
              value={language} 
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="js">Node.js (Plain JS)</option>
              <option value="cpp">C++17 (GCC Optimized)</option>
            </select>
          </div>
        </div>

        {/* Drag & Drop source file receiver */}
        <div 
          onDragEnter={handleDrag} 
          onDragOver={handleDrag} 
          onDragLeave={handleDrag} 
          onDrop={handleDrop}
          style={{ 
            border: dragActive ? '2px dashed hsl(var(--accent-purple))' : '1px dashed hsl(var(--border-dim))',
            borderRadius: '8px',
            padding: '1rem',
            textAlign: 'center',
            background: dragActive ? 'hsl(var(--accent-purple) / 0.05)' : 'hsl(var(--bg-base) / 0.2)',
            cursor: 'pointer',
            transition: 'all 0.2s ease-in-out',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.25rem'
          }}
          onClick={() => document.getElementById('file-upload-input')?.click()}
        >
          <input 
            type="file" 
            id="file-upload-input" 
            style={{ display: 'none' }} 
            onChange={handleFileUploadInput}
            accept=".js,.go,.rs,.cpp,.h,.hpp,.txt"
          />
          <FileText size={24} style={{ color: 'hsl(var(--text-secondary))' }} />
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Drag & Drop your matching engine source here</span>
          <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>Supports .js, .go, .rs, .cpp files</span>
        </div>

        {/* Custom Monaco-like editor text block */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>
              Interactive Code Editor
            </label>
            <button 
              type="button" 
              className="btn-secondary" 
              style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }} 
              onClick={() => setCode(TEMPLATES[language])}
            >
              <RefreshCw size={12} /> Reset Template
            </button>
          </div>
          <div style={{ position: 'relative' }}>
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              className="mono"
              rows={15}
              style={{
                width: '100%',
                background: 'hsl(var(--bg-base))',
                border: '1px solid hsl(var(--border-dim))',
                borderRadius: '8px',
                padding: '0.85rem',
                color: 'hsl(var(--text-primary))',
                fontSize: '0.85rem',
                lineHeight: '1.5',
                resize: 'vertical',
                tabSize: 2
              }}
              placeholder={`Write or paste your custom matching engine logic for ${language.toUpperCase()}...`}
            />
          </div>
        </div>

        <button 
          onClick={handleSubmit}
          className="btn-primary" 
          style={{ width: '100%', padding: '0.875rem' }}
          disabled={isUploading}
        >
          {isUploading ? (
            <>
              <RefreshCw className="pulse-glow-green" size={18} style={{ animation: 'spin 1s linear infinite' }} /> 
              Uploading Solution...
            </>
          ) : (
            <>
              <Code size={18} /> Deploy to Secure Sandbox
            </>
          )}
        </button>
      </div>
    </div>
  );
};

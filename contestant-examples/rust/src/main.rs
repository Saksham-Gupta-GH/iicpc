use axum::{
    extract::{
        ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use futures_util::{stream::StreamExt, SinkExt};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::SystemTime,
};
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;

#[derive(Clone, Serialize, Deserialize, Debug)]
struct Order {
    id: String,
    symbol: String,
    side: String, // BUY, SELL
    #[serde(rename = "type")]
    order_type: String, // LIMIT, MARKET
    price: f64,
    quantity: f64,
    #[serde(default)]
    filled: f64,
    #[serde(default = "now_millis")]
    timestamp: u64,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

struct BookSide {
    // Key: price key (represented as scaled integer for exact comparison)
    // Value: FIFO list of orders at this price
    levels: BTreeMap<i64, VecDeque<Order>>,
    is_bids: bool,
}

impl BookSide {
    fn new(is_bids: bool) -> Self {
        Self {
            levels: BTreeMap::new(),
            is_bids,
        }
    }

    fn insert(&mut self, order: Order) {
        let price_key = if self.is_bids {
            -scaled_price(order.price) // Negative price to sort descending in BTreeMap
        } else {
            scaled_price(order.price)
        };
        self.levels
            .entry(price_key)
            .or_insert_with(VecDeque::new)
            .push_back(order);
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
        Self {
            bids: BookSide::new(true),
            asks: BookSide::new(false),
            order_map: HashMap::new(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(tag = "type")]
enum Event {
    ORDER {
        id: String,
        symbol: String,
        side: String,
        #[serde(rename = "type")]
        order_type: String,
        price: f64,
        quantity: f64,
        timestamp: u64,
    },
    TRADE {
        symbol: String,
        #[serde(rename = "buyOrderId")]
        buy_order_id: String,
        #[serde(rename = "sellOrderId")]
        sell_order_id: String,
        price: f64,
        quantity: f64,
        timestamp: u64,
    },
    CANCEL {
        symbol: String,
        #[serde(rename = "orderId")]
        order_id: String,
        timestamp: u64,
    },
}

struct AppState {
    books: Mutex<HashMap<String, OrderBook>>,
    tx: broadcast::Sender<Event>,
}

#[derive(Deserialize)]
struct OrderRequest {
    id: String,
    symbol: String,
    side: String,
    #[serde(rename = "type")]
    order_type: String,
    price: serde_json::Value,
    quantity: serde_json::Value,
}

#[derive(Serialize)]
struct OrderResponse {
    status: String,
    #[serde(rename = "orderId")]
    order_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

#[derive(Deserialize)]
struct CancelRequest {
    id: String,
    symbol: String,
}

#[derive(Serialize)]
struct BookEntry {
    price: f64,
    quantity: f64,
    id: String,
}

#[derive(Serialize)]
struct BookResponse {
    bids: Vec<BookEntry>,
    asks: Vec<BookEntry>,
}

#[tokio::main]
async fn main() {
    let (tx, _rx) = broadcast::channel(10000);
    let state = Arc::new(AppState {
        books: Mutex::new(HashMap::new()),
        tx,
    });

    // Seed default BTCUSD book
    {
        let mut books = state.books.lock().unwrap();
        books.insert("BTCUSD".to_string(), OrderBook::new());
    }

    let app = Router::new()
        .route("/order", post(handle_order))
        .route("/cancel", post(handle_cancel))
        .route("/book", get(handle_book))
        .route("/ws", get(handle_ws))
        .with_state(state)
        .layer(CorsLayer::permissive());

    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));
    println!("Matching Engine (Rust) listening on port 8080");
    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
}

async fn handle_order(
    State(state): State<Arc<AppState>>,
    Json(req): Json<OrderRequest>,
) -> impl IntoResponse {
    let price: f64 = match req.price {
        serde_json::Value::Number(n) => n.as_f64().unwrap_or(0.0),
        serde_json::Value::String(s) => s.parse().unwrap_or(0.0),
        _ => 0.0,
    };

    let quantity: f64 = match req.quantity {
        serde_json::Value::Number(n) => n.as_f64().unwrap_or(0.0),
        serde_json::Value::String(s) => s.parse().unwrap_or(0.0),
        _ => 0.0,
    };

    if req.id.is_empty() || req.symbol.is_empty() || req.side.is_empty() || req.order_type.is_empty() || quantity <= 0.0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(OrderResponse {
                status: "REJECTED".to_string(),
                order_id: req.id,
                reason: Some("Invalid parameters".to_string()),
            }),
        );
    }

    let mut books = state.books.lock().unwrap();
    let book = books
        .entry(req.symbol.clone())
        .or_insert_with(OrderBook::new);

    if book.order_map.contains_key(&req.id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(OrderResponse {
                status: "REJECTED".to_string(),
                order_id: req.id,
                reason: Some("Duplicate order ID".to_string()),
            }),
        );
    }

    let mut order = Order {
        id: req.id.clone(),
        symbol: req.symbol.clone(),
        side: req.side.clone(),
        order_type: req.order_type.clone(),
        price,
        quantity,
        filled: 0.0,
        timestamp: now_millis(),
    };

    let order_evt = Event::ORDER {
        id: order.id.clone(),
        symbol: order.symbol.clone(),
        side: order.side.clone(),
        order_type: order.order_type.clone(),
        price: order.price,
        quantity: order.quantity,
        timestamp: order.timestamp,
    };
    println!("{}", serde_json::to_string(&order_evt).unwrap());

    let mut trades = Vec::new();

    if order.side == "BUY" {
        while order.quantity > 0.0 {
            let mut matched_ask_key = None;
            let mut match_qty = 0.0;
            let mut ask_id = String::new();
            let mut ask_price = 0.0;

            if let Some((&price_key, level)) = book.asks.levels.iter_mut().next() {
                let ask = level.front_mut().unwrap();
                if order.order_type == "LIMIT" && order.price < ask.price {
                    break;
                }

                match_qty = order.quantity.min(ask.quantity);
                order.quantity -= match_qty;
                order.filled += match_qty;
                ask.quantity -= match_qty;
                ask.filled += match_qty;
                ask_id = ask.id.clone();
                ask_price = ask.price;

                if ask.quantity == 0.0 {
                    level.pop_front();
                    if level.is_empty() {
                        matched_ask_key = Some(price_key);
                    }
                }
            } else {
                break;
            }

            if let Some(key) = matched_ask_key {
                book.asks.levels.remove(&key);
            }
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
    } else if order.side == "SELL" {
        while order.quantity > 0.0 {
            let mut matched_bid_key = None;
            let mut match_qty = 0.0;
            let mut bid_id = String::new();
            let mut bid_price = 0.0;

            if let Some((&price_key, level)) = book.bids.levels.iter_mut().next() {
                let bid = level.front_mut().unwrap();
                if order.order_type == "LIMIT" && order.price > bid.price {
                    break;
                }

                match_qty = order.quantity.min(bid.quantity);
                order.quantity -= match_qty;
                order.filled += match_qty;
                bid.quantity -= match_qty;
                bid.filled += match_qty;
                bid_id = bid.id.clone();
                bid_price = bid.price;

                if bid.quantity == 0.0 {
                    level.pop_front();
                    if level.is_empty() {
                        matched_bid_key = Some(price_key);
                    }
                }
            } else {
                break;
            }

            if let Some(key) = matched_bid_key {
                book.bids.levels.remove(&key);
            }
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

    // Broadcast trades
    for t in trades {
        println!("{}", serde_json::to_string(&t).unwrap());
        let _ = state.tx.send(t);
    }

    (
        StatusCode::ACCEPTED,
        Json(OrderResponse {
            status: "ACCEPTED".to_string(),
            order_id: req.id,
            reason: None,
        }),
    )
}

async fn handle_cancel(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CancelRequest>,
) -> impl IntoResponse {
    let mut books = state.books.lock().unwrap();
    let book = match books.get_mut(&req.symbol) {
        Some(b) => b,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(OrderResponse {
                    status: "NOT_FOUND".to_string(),
                    order_id: req.id,
                    reason: Some("Order Book not found".to_string()),
                }),
            )
        }
    };

    let order = match book.order_map.remove(&req.id) {
        Some(o) => o,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(OrderResponse {
                    status: "NOT_FOUND".to_string(),
                    order_id: req.id,
                    reason: None,
                }),
            )
        }
    };

    if order.side == "BUY" {
        let price_key = -scaled_price(order.price);
        if let Some(level) = book.bids.levels.get_mut(&price_key) {
            level.retain(|o| o.id != req.id);
            if level.is_empty() {
                book.bids.levels.remove(&price_key);
            }
        }
    } else {
        let price_key = scaled_price(order.price);
        if let Some(level) = book.asks.levels.get_mut(&price_key) {
            level.retain(|o| o.id != req.id);
            if level.is_empty() {
                book.asks.levels.remove(&price_key);
            }
        }
    }

    let cancel_evt = Event::CANCEL {
        symbol: req.symbol,
        order_id: req.id.clone(),
        timestamp: now_millis(),
    };
    println!("{}", serde_json::to_string(&cancel_evt).unwrap());
    let _ = state.tx.send(cancel_evt);

    (
        StatusCode::OK,
        Json(OrderResponse {
            status: "CANCELLED".to_string(),
            order_id: req.id,
            reason: None,
        }),
    )
}

#[derive(Deserialize)]
struct BookQuery {
    symbol: Option<String>,
}

async fn handle_book(
    State(state): State<Arc<AppState>>,
    Query(query): Query<BookQuery>,
) -> impl IntoResponse {
    let symbol = query.symbol.unwrap_or_else(|| "BTCUSD".to_string());
    let books = state.books.lock().unwrap();

    let mut bids = Vec::new();
    let mut asks = Vec::new();

    if let Some(book) = books.get(&symbol) {
        for level in book.bids.levels.values() {
            for o in level {
                bids.push(BookEntry {
                    price: o.price,
                    quantity: o.quantity,
                    id: o.id.clone(),
                });
            }
        }
        for level in book.asks.levels.values() {
            for o in level {
                asks.push(BookEntry {
                    price: o.price,
                    quantity: o.quantity,
                    id: o.id.clone(),
                });
            }
        }
    }

    Json(BookResponse { bids, asks })
}

async fn handle_ws(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.tx.subscribe();

    // Spawn writing task
    let mut write_task = tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            let msg_text = serde_json::to_string(&event).unwrap();
            if sender.send(WsMessage::Text(msg_text)).await.is_err() {
                break;
            }
        }
    });

    // Spawn reading task (just to keep connection alive and receive close signals)
    let mut read_task = tokio::spawn(async move {
        while let Some(Ok(_)) = receiver.next().await {}
    });

    tokio::select! {
        _ = (&mut write_task) => read_task.abort(),
        _ = (&mut read_task) => write_task.abort(),
    };
}

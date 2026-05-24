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

// Order Struct
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

// Trade event structure
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

// Global variables
map<double, list<Order>, greater<double>> bids; // descending price
map<double, list<Order>, less<double>> asks;    // ascending price
unordered_map<string, OrderRef> order_map;
mutex mtx;

long long get_now_ms() {
    return chrono::duration_cast<chrono::milliseconds>(
        chrono::system_clock::now().time_since_epoch()
    ).count();
}

// Helper to print JSON trade event to stdout for Telemetry Ingester
void emit_trade(const TradeEvent& t) {
    // Print JSON to stdout in a thread-safe manner
    // The Docker orchestrator will capture these lines
    stringstream ss;
    ss << "{\"type\":\"TRADE\",\"symbol\":\"" << t.symbol 
       << "\",\"buyOrderId\":\"" << t.buyOrderId 
       << "\",\"sellOrderId\":\"" << t.sellOrderId 
       << "\",\"price\":" << t.price 
       << ",\"quantity\":" << t.quantity 
       << ",\"timestamp\":" << t.timestamp << "}\n";
    cout << ss.str() << flush;
}

// Helper to print JSON cancel event to stdout
void emit_cancel(const string& symbol, const string& order_id) {
    stringstream ss;
    ss << "{\"type\":\"CANCEL\",\"symbol\":\"" << symbol 
       << "\",\"orderId\":\"" << order_id 
       << "\",\"timestamp\":" << get_now_ms() << "}\n";
    cout << ss.str() << flush;
}

void match_order(Order& order) {
    vector<TradeEvent> trades;

    if (order.side == "BUY") {
        while (!asks.empty() && order.quantity > 0) {
            auto it = asks.begin();
            double ask_price = it->first;
            auto& queue = it->second;

            if (order.type == "LIMIT" && order.price < ask_price) {
                break;
            }

            while (!queue.empty() && order.quantity > 0) {
                auto& ask = queue.front();
                double match_qty = min(order.quantity, ask.quantity);

                order.quantity -= match_qty;
                order.filled += match_qty;
                ask.quantity -= match_qty;
                ask.filled += match_qty;

                trades.push_back(TradeEvent{
                    "TRADE",
                    order.symbol,
                    order.id,
                    ask.id,
                    ask_price,
                    match_qty,
                    get_now_ms()
                });

                if (ask.quantity == 0) {
                    order_map.erase(ask.id);
                    queue.pop_front();
                }
            }

            if (queue.empty()) {
                asks.erase(it);
            }
        }

        if (order.quantity > 0 && order.type == "LIMIT") {
            auto& queue = bids[order.price];
            queue.push_back(order);
            auto queue_it = --queue.end();
            order_map[order.id] = OrderRef{order.price, "BUY", queue_it};
        }

    } else if (order.side == "SELL") {
        while (!bids.empty() && order.quantity > 0) {
            auto it = bids.begin();
            double bid_price = it->first;
            auto& queue = it->second;

            if (order.type == "LIMIT" && order.price > bid_price) {
                break;
            }

            while (!queue.empty() && order.quantity > 0) {
                auto& bid = queue.front();
                double match_qty = min(order.quantity, bid.quantity);

                order.quantity -= match_qty;
                order.filled += match_qty;
                bid.quantity -= match_qty;
                bid.filled += match_qty;

                trades.push_back(TradeEvent{
                    "TRADE",
                    order.symbol,
                    bid.id,
                    order.id,
                    bid_price,
                    match_qty,
                    get_now_ms()
                });

                if (bid.quantity == 0) {
                    order_map.erase(bid.id);
                    queue.pop_front();
                }
            }

            if (queue.empty()) {
                bids.erase(it);
            }
        }

        if (order.quantity > 0 && order.type == "LIMIT") {
            auto& queue = asks[order.price];
            queue.push_back(order);
            auto queue_it = --queue.end();
            order_map[order.id] = OrderRef{order.price, "SELL", queue_it};
        }
    }

    for (const auto& t : trades) {
        emit_trade(t);
    }
}

int main() {
    httplib::Server svr;

    // POST /order
    svr.Post("/order", [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Content-Type", "application/json");
        try {
            // Very simple JSON parsing for speed and zero external dependencies
            // Expecting: {"id":"...","symbol":"...","side":"...","type":"...","price":...,"quantity":...}
            string id, symbol, side, type;
            double price = 0.0, quantity = 0.0;

            // Simple parser
            auto get_val = [&](const string& key, string& out) {
                size_t pos = req.body.find("\"" + key + "\"");
                if (pos == string::npos) return false;
                pos = req.body.find(":", pos);
                if (pos == string::npos) return false;
                size_t start = req.body.find("\"", pos);
                if (start == string::npos) return false;
                size_t end = req.body.find("\"", start + 1);
                if (end == string::npos) return false;
                out = req.body.substr(start + 1, end - start - 1);
                return true;
            };

            auto get_num = [&](const string& key, double& out) {
                size_t pos = req.body.find("\"" + key + "\"");
                if (pos == string::npos) return false;
                pos = req.body.find(":", pos);
                if (pos == string::npos) return false;
                // find first digit or decimal
                size_t start = req.body.find_first_of("0123456789.-", pos);
                if (start == string::npos) return false;
                size_t end = req.body.find_first_not_of("0123456789.eE+-", start);
                string val_str = req.body.substr(start, end - start);
                out = stod(val_str);
                return true;
            };

            if (!get_val("id", id) || !get_val("symbol", symbol) || 
                !get_val("side", side) || !get_val("type", type) || 
                !get_num("quantity", quantity)) {
                res.status = 400;
                res.set_content("{\"status\":\"REJECTED\",\"reason\":\"Invalid parameters\"}", "application/json");
                return;
            }

            // Price is optional for MARKET orders
            if (type == "LIMIT") {
                get_num("price", price);
            }

            if (id.empty() || symbol.empty() || side.empty() || type.empty() || quantity <= 0) {
                res.status = 400;
                res.set_content("{\"status\":\"REJECTED\",\"reason\":\"Invalid parameters\"}", "application/json");
                return;
            }

            lock_guard<mutex> lock(mtx);

            if (order_map.find(id) != order_map.end()) {
                res.status = 400;
                res.set_content("{\"status\":\"REJECTED\",\"reason\":\"Duplicate order ID\"}", "application/json");
                return;
            }

            // Print ORDER event to stdout in a thread-safe manner under lock
            stringstream ss;
            ss << "{\"type\":\"ORDER\",\"id\":\"" << id 
               << "\",\"symbol\":\"" << symbol 
               << "\",\"side\":\"" << side 
               << "\",\"type\":\"" << type 
               << "\",\"price\":" << price 
               << ",\"quantity\":" << quantity 
               << ",\"timestamp\":" << get_now_ms() << "}\n";
            cout << ss.str() << flush;

            Order order{id, symbol, side, type, price, quantity, 0.0, get_now_ms()};
            match_order(order);

            res.status = 202;
            res.set_content("{\"status\":\"ACCEPTED\",\"orderId\":\"" + id + "\"}", "application/json");
        } catch (...) {
            res.status = 400;
            res.set_content("{\"status\":\"REJECTED\",\"reason\":\"Malformed JSON\"}", "application/json");
        }
    });

    // POST /cancel
    svr.Post("/cancel", [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Content-Type", "application/json");
        try {
            string id, symbol;
            auto get_val = [&](const string& key, string& out) {
                size_t pos = req.body.find("\"" + key + "\"");
                if (pos == string::npos) return false;
                pos = req.body.find(":", pos);
                if (pos == string::npos) return false;
                size_t start = req.body.find("\"", pos);
                if (start == string::npos) return false;
                size_t end = req.body.find("\"", start + 1);
                if (end == string::npos) return false;
                out = req.body.substr(start + 1, end - start - 1);
                return true;
            };

            if (!get_val("id", id) || !get_val("symbol", symbol)) {
                res.status = 400;
                res.set_content("{\"status\":\"REJECTED\",\"reason\":\"Missing id or symbol\"}", "application/json");
                return;
            }

            lock_guard<mutex> lock(mtx);

            auto it = order_map.find(id);
            if (it == order_map.end()) {
                res.status = 404;
                res.set_content("{\"status\":\"NOT_FOUND\",\"orderId\":\"" + id + "\"}", "application/json");
                return;
            }

            OrderRef ref = it->second;
            if (ref.side == "BUY") {
                bids[ref.price].erase(ref.it);
                if (bids[ref.price].empty()) {
                    bids.erase(ref.price);
                }
            } else {
                asks[ref.price].erase(ref.it);
                if (asks[ref.price].empty()) {
                    asks.erase(ref.price);
                }
            }

            order_map.erase(it);
            emit_cancel(symbol, id);

            res.status = 200;
            res.set_content("{\"status\":\"CANCELLED\",\"orderId\":\"" + id + "\"}", "application/json");
        } catch (...) {
            res.status = 400;
            res.set_content("{\"status\":\"REJECTED\",\"reason\":\"Malformed JSON\"}", "application/json");
        }
    });

    // GET /book
    svr.Get("/book", [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Content-Type", "application/json");
        lock_guard<mutex> lock(mtx);

        stringstream ss;
        ss << "{\"bids\":[";
        bool first_bid = true;
        for (const auto& level : bids) {
            for (const auto& o : level.second) {
                if (!first_bid) ss << ",";
                ss << "{\"price\":" << o.price << ",\"quantity\":" << o.quantity << ",\"id\":\"" << o.id << "\"}";
                first_bid = false;
            }
        }
        ss << "],\"asks\":[";
        bool first_ask = true;
        for (const auto& level : asks) {
            for (const auto& o : level.second) {
                if (!first_ask) ss << ",";
                ss << "{\"price\":" << o.price << ",\"quantity\":" << o.quantity << ",\"id\":\"" << o.id << "\"}";
                first_ask = false;
            }
        }
        ss << "]}";

        res.status = 200;
        res.set_content(ss.str(), "application/json");
    });

    int port = 8080;
    cout << "Matching Engine (C++) listening on port " << port << endl << flush;
    svr.listen("0.0.0.0", port);
    return 0;
}

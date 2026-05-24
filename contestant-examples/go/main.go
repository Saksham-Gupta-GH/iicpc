package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Order struct {
	ID        string    `json:"id"`
	Symbol    string    `json:"symbol"`
	Side      string    `json:"side"` // BUY, SELL
	Type      string    `json:"type"` // LIMIT, MARKET
	Price     float64   `json:"price"`
	Quantity  float64   `json:"quantity"`
	Filled    float64   `json:"filled"`
	Timestamp time.Time `json:"timestamp"`
}

type OrderBook struct {
	Bids []*Order `json:"bids"`
	Asks []*Order `json:"asks"`
}

var (
	books = map[string]*OrderBook{
		"BTCUSD": {Bids: make([]*Order, 0), Asks: make([]*Order, 0)},
	}
	orderMap = make(map[string]*Order)
	mu       sync.Mutex

	clients   = make(map[*websocket.Conn]bool)
	clientsMu sync.Mutex
)

type Event struct {
	Type         string    `json:"type"` // TRADE, CANCEL
	Symbol       string    `json:"symbol"`
	BuyOrderID   string    `json:"buyOrderId,omitempty"`
	SellOrderID  string    `json:"sellOrderId,omitempty"`
	OrderID      string    `json:"orderId,omitempty"`
	Price        float64   `json:"price"`
	Quantity     float64   `json:"quantity"`
	Timestamp    time.Time `json:"timestamp"`
}

func broadcast(e Event) {
	clientsMu.Lock()
	defer clientsMu.Unlock()
	msg, err := json.Marshal(e)
	if err != nil {
		return
	}
	for client := range clients {
		_ = client.WriteMessage(websocket.TextMessage, msg)
	}
}

func matchOrder(order *Order) {
	book, ok := books[order.Symbol]
	if !ok {
		return
	}

	var trades []Event

	if order.Side == "BUY" {
		for len(book.Asks) > 0 && order.Quantity > 0 {
			ask := book.Asks[0]
			if order.Type == "LIMIT" && order.Price < ask.Price {
				break
			}

			matchQty := math.Min(order.Quantity, ask.Quantity)
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
	} else if order.Side == "SELL" {
		for len(book.Bids) > 0 && order.Quantity > 0 {
			bid := book.Bids[0]
			if order.Type == "LIMIT" && order.Price > bid.Price {
				break
			}

			matchQty := math.Min(order.Quantity, bid.Quantity)
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
		broadcast(t)
		msg, _ := json.Marshal(t)
		fmt.Println(string(msg))
	}
}

func sortBids(bids []*Order) {
	// Simple sorting: descending price, then ascending timestamp
	for i := len(bids) - 1; i > 0; i-- {
		if bids[i].Price > bids[i-1].Price ||
			(bids[i].Price == bids[i-1].Price && bids[i].Timestamp.Before(bids[i-1].Timestamp)) {
			bids[i], bids[i-1] = bids[i-1], bids[i]
		} else {
			break
		}
	}
}

func sortAsks(asks []*Order) {
	// Simple sorting: ascending price, then ascending timestamp
	for i := len(asks) - 1; i > 0; i-- {
		if asks[i].Price < asks[i-1].Price ||
			(asks[i].Price == asks[i-1].Price && asks[i].Timestamp.Before(asks[i-1].Timestamp)) {
			asks[i], asks[i-1] = asks[i-1], asks[i]
		} else {
			break
		}
	}
}

func handleOrder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID       string      `json:"id"`
		Symbol   string      `json:"symbol"`
		Side     string      `json:"side"`
		Type     string      `json:"type"`
		Price    interface{} `json:"price"`
		Quantity interface{} `json:"quantity"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"status":"REJECTED","reason":"Malformed JSON"}`))
		return
	}

	priceVal := 0.0
	switch p := req.Price.(type) {
	case float64:
		priceVal = p
	case string:
		priceVal, _ = strconv.ParseFloat(p, 64)
	}

	quantityVal := 0.0
	switch q := req.Quantity.(type) {
	case float64:
		quantityVal = q
	case string:
		quantityVal, _ = strconv.ParseFloat(q, 64)
	}

	if req.ID == "" || req.Symbol == "" || req.Side == "" || req.Type == "" || quantityVal <= 0 {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"status":"REJECTED","reason":"Invalid parameters"}`))
		return
	}

	mu.Lock()
	defer mu.Unlock()

	if _, exists := orderMap[req.ID]; exists {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"status":"REJECTED","reason":"Duplicate order ID"}`))
		return
	}

	order := &Order{
		ID:        req.ID,
		Symbol:    req.Symbol,
		Side:      req.Side,
		Type:      req.Type,
		Price:     priceVal,
		Quantity:  quantityVal,
		Timestamp: time.Now(),
	}

	orderEvt := struct {
		Type      string    `json:"type"`
		ID        string    `json:"id"`
		Symbol    string    `json:"symbol"`
		Side      string    `json:"side"`
		Price     float64   `json:"price"`
		Quantity  float64   `json:"quantity"`
		Timestamp time.Time `json:"timestamp"`
	}{
		Type:      "ORDER",
		ID:        order.ID,
		Symbol:    order.Symbol,
		Side:      order.Side,
		Price:     order.Price,
		Quantity:  order.Quantity,
		Timestamp: order.Timestamp,
	}
	msg, _ := json.Marshal(orderEvt)
	fmt.Println(string(msg))

	matchOrder(order)

	w.WriteHeader(http.StatusAccepted)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"status":"ACCEPTED","orderId":"%s"}`, req.ID)))
}

func handleCancel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID     string `json:"id"`
		Symbol string `json:"symbol"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"status":"REJECTED","reason":"Malformed JSON"}`))
		return
	}

	mu.Lock()
	defer mu.Unlock()

	order, exists := orderMap[req.ID]
	if !exists || order.Symbol != req.Symbol {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(fmt.Sprintf(`{"status":"NOT_FOUND","orderId":"%s"}`, req.ID)))
		return
	}

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

	cancelEvt := Event{
		Type:      "CANCEL",
		Symbol:    req.Symbol,
		OrderID:   req.ID,
		Timestamp: time.Now(),
	}
	broadcast(cancelEvt)
	msg, _ := json.Marshal(cancelEvt)
	fmt.Println(string(msg))

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"status":"CANCELLED","orderId":"%s"}`, req.ID)))
}

func handleBook(w http.ResponseWriter, r *http.Request) {
	symbol := r.URL.Query().Get("symbol")
	if symbol == "" {
		symbol = "BTCUSD"
	}

	mu.Lock()
	book, ok := books[symbol]
	if !ok {
		book = &OrderBook{Bids: []*Order{}, Asks: []*Order{}}
	}

	type BookEntry struct {
		Price    float64 `json:"price"`
		Quantity float64 `json:"quantity"`
		ID       string  `json:"id"`
	}

	var response struct {
		Bids []BookEntry `json:"bids"`
		Asks []BookEntry `json:"asks"`
	}
	response.Bids = make([]BookEntry, len(book.Bids))
	response.Asks = make([]BookEntry, len(book.Asks))

	for i, o := range book.Bids {
		response.Bids[i] = BookEntry{Price: o.Price, Quantity: o.Quantity, ID: o.ID}
	}
	for i, o := range book.Asks {
		response.Asks[i] = BookEntry{Price: o.Price, Quantity: o.Quantity, ID: o.ID}
	}
	mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
}

func handleWS(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	clientsMu.Lock()
	clients[ws] = true
	clientsMu.Unlock()

	defer func() {
		clientsMu.Lock()
		delete(clients, ws)
		clientsMu.Unlock()
		_ = ws.Close()
	}()

	// Keep alive / Read loop
	for {
		_, _, err := ws.ReadMessage()
		if err != nil {
			break
		}
	}
}

func main() {
	http.HandleFunc("/order", handleOrder)
	http.HandleFunc("/cancel", handleCancel)
	http.HandleFunc("/book", handleBook)
	http.HandleFunc("/ws", handleWS)

	port := "8080"
	fmt.Printf("Matching Engine (Go) listening on port %s\n", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

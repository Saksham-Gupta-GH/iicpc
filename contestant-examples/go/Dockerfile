FROM golang:1.20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git

# Initialize module and get Gorilla WebSocket
RUN go mod init contestant-go-engine && go get github.com/gorilla/websocket

COPY main.go .

RUN CGO_ENABLED=0 GOOS=linux go build -o engine .

FROM alpine:latest

WORKDIR /app

COPY --from=builder /app/engine .

EXPOSE 8080

CMD ["./engine"]

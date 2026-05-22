FROM rust:1.68-slim AS builder

WORKDIR /app

COPY Cargo.toml .
# Create dummy main to compile and cache dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release

COPY src/main.rs src/

# Touch main.rs to trigger rebuild
RUN touch src/main.rs && cargo build --release

FROM debian:bullseye-slim

WORKDIR /app

RUN apk add --no-cache ca-certificates 2>/dev/null || apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/contestant-rust-engine ./engine

EXPOSE 8080

CMD ["./engine"]

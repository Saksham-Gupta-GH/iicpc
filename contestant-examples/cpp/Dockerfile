FROM ubuntu:22.04 AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y \
    g++ \
    make \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Download yhi-pg/cpp-httplib header-only library
RUN curl -L -o httplib.h https://raw.githubusercontent.com/yhirose/cpp-httplib/v0.12.1/httplib.h

COPY main.cpp .

# Compile optimized C++ binary
RUN g++ -O3 -std=c++11 -pthread -o engine main.cpp

FROM ubuntu:22.04

WORKDIR /app

COPY --from=builder /app/engine .

EXPOSE 8080

CMD ["./engine"]

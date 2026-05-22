FROM node:18-alpine

WORKDIR /app

# Install Docker CLI in Alpine so we can execute docker commands from Node.js
RUN apk add --no-cache docker-cli

COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

EXPOSE 5000

CMD ["node", "dist/backend/src/server.js"]

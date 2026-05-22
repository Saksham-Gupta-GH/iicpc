FROM node:18-alpine

WORKDIR /app

# Install standard dependencies
RUN npm init -y && npm install ws

COPY server.js .

EXPOSE 8080

CMD ["node", "server.js"]

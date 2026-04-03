FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY mcp-server.mjs ./

ENTRYPOINT ["node", "mcp-server.mjs"]

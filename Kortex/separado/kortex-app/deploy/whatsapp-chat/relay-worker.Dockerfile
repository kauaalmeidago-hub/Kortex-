FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
WORKDIR /app
COPY deploy/whatsapp-chat/relay-worker/package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY server/whatsapp ./server/whatsapp
COPY scripts/whatsapp/worker-health.mjs ./scripts/whatsapp/worker-health.mjs
USER node
CMD ["node", "--env-file=/run/secrets/worker.env", "server/whatsapp/worker.mjs", "--relay"]

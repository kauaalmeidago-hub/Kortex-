FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server/whatsapp ./server/whatsapp
USER node
CMD ["node", "server/whatsapp/worker.mjs"]

FROM mcr.microsoft.com/playwright:v1.49.1-noble

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

ENV NODE_ENV=production
ENV KOA_AUTOMATION_HOST=127.0.0.1
ENV KOA_AUTOMATION_PORT=4777
ENV KOA_AUTOMATION_HEADLESS=true

EXPOSE 4777

CMD ["node", "dist/index.js"]

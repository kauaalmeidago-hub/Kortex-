FROM node:24.14.1-alpine
# Build from the app repository root: docker build -f tools/koa-whatsapp/Dockerfile .
WORKDIR /app/tools/koa-whatsapp
COPY tools/koa-whatsapp/package.json tools/koa-whatsapp/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir -p /data && chown node:node /data
COPY tools/koa-whatsapp/core.mjs tools/koa-whatsapp/tasks.mjs tools/koa-whatsapp/groups.mjs tools/koa-whatsapp/private.mjs tools/koa-whatsapp/routes.mjs tools/koa-whatsapp/scheduler.mjs tools/koa-whatsapp/runtime.mjs tools/koa-whatsapp/files.mjs tools/koa-whatsapp/worker.mjs tools/koa-whatsapp/announce.mjs tools/koa-whatsapp/supabase-root.crt ./
COPY supabase/functions/_shared/file-inputs.mjs /app/supabase/functions/_shared/file-inputs.mjs
USER node
ENV KOA_SQLITE_PATH=/data/conversations.sqlite
EXPOSE 3335
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3335/health || exit 1
CMD ["node","worker.mjs"]

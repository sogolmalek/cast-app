FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app

RUN addgroup -g 1001 cast && adduser -u 1001 -G cast -s /bin/sh -D cast

COPY backend/package*.json ./backend/
RUN cd backend && npm install --production --ignore-scripts

COPY backend/src ./backend/src
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

RUN mkdir -p /app/backend/data && chown -R cast:cast /app

USER cast

ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/app/backend/data/cast.db

EXPOSE 3001
VOLUME ["/app/backend/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health | grep -q '"ok"' || exit 1

CMD ["node", "backend/src/index.js"]

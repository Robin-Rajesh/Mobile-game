# Moonbite game server + web client in one image.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package*.json ./
RUN npm ci --omit=dev && npm install --no-save tsx@4
COPY --from=build /app/dist ./dist
COPY shared ./shared
COPY server ./server
COPY tsconfig.json ./
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://localhost:8080/healthz || exit 1
USER node
CMD ["npx", "tsx", "server/index.ts"]

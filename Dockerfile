FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN PUPPETEER_SKIP_DOWNLOAD=true npm install
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app

# Chromium do sistema para o Puppeteer (providers.ts); o ffmpeg vem do @ffmpeg-installer
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-liberation ca-certificates tzdata \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
  TZ=America/Sao_Paulo \
  PUPPETEER_SKIP_DOWNLOAD=true \
  PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json .sequelizerc ./
COPY certs ./certs
RUN mkdir -p public

EXPOSE 8080
CMD ["sh", "-c", "npx sequelize db:migrate && node dist/server.js"]

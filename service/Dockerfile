# EC Service — container image. Phase 1 target: deploy to an India cloud region.
FROM node:22-slim AS base
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY src ./src
COPY public ./public
COPY tsconfig.json ./

EXPOSE 8080
# tsx runs TypeScript directly; Phase 1 may switch to a compiled build.
RUN npm install tsx@^4.19.2
CMD ["npx", "tsx", "src/index.ts"]

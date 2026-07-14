# syntax=docker/dockerfile:1
#
# Dev Social runs TWO Node processes in one container:
#   - Next.js app (next start)        -> :3000
#   - Socket.IO realtime game server  -> :3001  (in-memory room state + timers)
# Both are launched together by `npm start` (concurrently).
#
# The game server is executed straight from TypeScript via tsx, so the runtime
# image keeps the source tree + full node_modules (incl. tsx/concurrently).
# That is intentional: this is a homelab single-image build, not a size-golfed
# serverless bundle.

# Debian-slim (glibc) base — more robust for Next.js native deps / SWC than Alpine.
ARG NODE_VERSION=22-bookworm-slim

# ---- deps: install all dependencies (dev deps included; tsx + concurrently
#      are needed at runtime, not just at build time) ----
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: produce the Next.js production build ----
FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so they
# MUST be provided as build args. They are public/non-secret by design (the anon
# key is the publishable key; the game-server URL is just your public origin).
ARG NEXT_PUBLIC_GAME_SERVER_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ENV NEXT_PUBLIC_GAME_SERVER_URL=$NEXT_PUBLIC_GAME_SERVER_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---- runner: runtime image that runs both processes ----
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src

EXPOSE 3000 3001

# Secret (SUPABASE_SERVICE_ROLE_KEY) and runtime config (GAME_CLIENT_ORIGIN,
# SUPABASE_URL) are injected at run time via docker-compose, never baked in.
CMD ["npm", "start"]

#!/bin/bash

# Dev Social - Deploy Script
# Commits changes to GitHub, then builds a linux/amd64 Docker image and pushes
# it to the GitHub Container Registry (ghcr.io). Finally prints the Unraid
# setup / run instructions.
#
# Dev Social runs TWO processes in one container:
#   - Next.js app                -> :3000  (nginx: location / )
#   - Socket.IO realtime server  -> :3001  (nginx: location /socket.io/ )
#
# Usage:
#   ./deploy.sh                    # build (linux/amd64) + push to ghcr.io
#   ./deploy.sh "commit message"   # git commit/push first, then build + push
#   ./deploy.sh --local            # build & run locally via docker compose
#
# Prereqs:
#   export GITHUB_CR_PAT='...'     # GitHub PAT with write:packages, read:packages
#                                  #   (https://github.com/settings/tokens)
#   .env present with SUPABASE_SERVICE_ROLE_KEY=... (used in the printed run cmd)

set -e  # Exit on error

GITHUB_USERNAME="mikesawayda-adaptivesoftware"
REPO_URL="https://github.com/mikesawayda-adaptivesoftware/Dev-Social.git"

IMAGE_NAME="dev-social"
IMAGE_TAG="${IMAGE_TAG:-latest}"
IMAGE="ghcr.io/${GITHUB_USERNAME}/${IMAGE_NAME}:${IMAGE_TAG}"

# ---- PUBLIC values: baked into the browser bundle at BUILD time (NEXT_PUBLIC_*).
#      These are public/non-secret by design. Access is via nginx on one origin,
#      which routes /socket.io/ -> :3001 and everything else -> :3000.
PUBLIC_ORIGIN="https://dev-social.adaptivesoftware.co"
SUPABASE_URL="https://dlfjcxnnmtkzupvhdivw.supabase.co"
SUPABASE_ANON_KEY="sb_publishable_BKDF8Jx85S4jPZy7UUembg_vQK2GW6g"
# Optional browser Google Maps key for the Real GeoGuessr game. Picked up from
# your shell or .env; leave unset and GeoGuessr just shows a setup hint.
MAPS_BROWSER_KEY="${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:-}"

# Unraid host ports (left = host, right = container). The container always
# listens on 3000/3001 internally; these are just the host-side ports nginx
# proxies to. Changing them needs NO rebuild (the baked public origin is
# unchanged — nginx serves both the app and /socket.io/ on one origin).
NEXT_PORT=3092
GAME_PORT=3093

# Where the runtime secret lives on the Unraid host (saved once, reused on update).
UNRAID_APPDATA="/mnt/user/appdata/dev-social"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   🎉 Dev Social - Deploy Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$SCRIPT_DIR"
cd "$APP_DIR"

echo -e "${YELLOW}📁 App directory: $APP_DIR${NC}"
echo ""

# Load .env (for the runtime service_role secret used in the printed run cmd,
# and optionally the Google Maps browser key).
if [ -f .env ]; then
    set -a; . ./.env; set +a
    MAPS_BROWSER_KEY="${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:-$MAPS_BROWSER_KEY}"
fi

# --------------------------- Local mode --------------------------------------
if [[ "$1" == "--local" ]]; then
    echo -e "${BLUE}🐳 Building & running locally with docker compose...${NC}"
    docker compose up --build
    exit 0
fi

# ----------------------- Optional: commit + push -----------------------------
if [[ -z $(git status -s) ]]; then
    echo -e "${YELLOW}⚠️  No changes to commit${NC}"
else
    if [ -z "$1" ]; then
        COMMIT_MSG="Update Dev-Social - $(date '+%Y-%m-%d %H:%M')"
        echo -e "${YELLOW}💬 Using default commit message: ${COMMIT_MSG}${NC}"
    else
        COMMIT_MSG="$1"
        echo -e "${YELLOW}💬 Commit message: ${COMMIT_MSG}${NC}"
    fi
    echo ""

    echo -e "${BLUE}📦 Staging changes...${NC}"
    git add -A

    echo -e "${BLUE}✍️  Committing...${NC}"
    git commit -m "$COMMIT_MSG"

    echo -e "${BLUE}🚀 Pushing to GitHub...${NC}"
    git remote set-url origin "${REPO_URL}" 2>/dev/null || git remote add origin "${REPO_URL}"
    git push origin "$(git rev-parse --abbrev-ref HEAD)"
    echo -e "${GREEN}✅ GitHub updated successfully!${NC}"
fi
echo ""

# --------------------------- ghcr.io login -----------------------------------
echo -e "${BLUE}🔑 Logging into ghcr.io...${NC}"
if [ -z "$GITHUB_CR_PAT" ]; then
    echo -e "${RED}❌ Error: GITHUB_CR_PAT environment variable is not set!${NC}"
    echo -e "${YELLOW}Please set it with: export GITHUB_CR_PAT='your_token_here'${NC}"
    echo -e "${YELLOW}Get a token from: https://github.com/settings/tokens${NC}"
    echo -e "${YELLOW}Required scopes: write:packages, read:packages${NC}"
    exit 1
fi
echo "$GITHUB_CR_PAT" | docker login ghcr.io -u "$GITHUB_USERNAME" --password-stdin
echo -e "${GREEN}✅ Logged into ghcr.io${NC}"
echo ""

# --------------------- Build (linux/amd64) & push ----------------------------
echo -e "${BLUE}🐳 Building ${IMAGE} for linux/amd64 and pushing to ghcr.io...${NC}"

if ! docker buildx version >/dev/null 2>&1; then
    echo -e "${RED}❌ Docker buildx is not available. Please install it first.${NC}"
    exit 1
fi
docker buildx create --name devsocial-builder --use 2>/dev/null \
    || docker buildx use devsocial-builder 2>/dev/null || true

if [ -z "$MAPS_BROWSER_KEY" ]; then
    echo -e "${YELLOW}ℹ️  No Google Maps key set — Real GeoGuessr will show a setup hint.${NC}"
    echo -e "${YELLOW}   Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in .env or your shell to enable it.${NC}"
fi

echo -e "${YELLOW}⏳ This may take a few minutes...${NC}"
docker buildx build \
    --platform linux/amd64 \
    --build-arg NEXT_PUBLIC_GAME_SERVER_URL="$PUBLIC_ORIGIN" \
    --build-arg NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL" \
    --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
    --build-arg NEXT_PUBLIC_GOOGLE_MAPS_API_KEY="$MAPS_BROWSER_KEY" \
    -t "$IMAGE" \
    --push .

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   ✅ Deployment Complete! Pushed:${NC}"
echo -e "${GREEN}   ${IMAGE}${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# ----------------------- Print Unraid instructions ---------------------------
if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    echo -e "${YELLOW}⚠️  SUPABASE_SERVICE_ROLE_KEY not found in .env. Without it the app${NC}"
    echo -e "${YELLOW}   runs in-memory only (no persistence / photo storage). The setup${NC}"
    echo -e "${YELLOW}   below saves it to a file on Unraid so you don't re-paste it.${NC}"
    echo ""
fi

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   🖥️  UNRAID SETUP INSTRUCTIONS${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${YELLOW}FIRST TIME SETUP:${NC}"
echo ""
echo -e "  1. SSH into your Unraid server."
echo ""
echo -e "  2. Login to GitHub Container Registry (one-time setup):"
echo ""
echo -e "     ${GREEN}echo 'YOUR_GITHUB_PAT_HERE' | docker login ghcr.io -u ${GITHUB_USERNAME} --password-stdin${NC}"
echo ""
echo -e "  3. Save your Supabase service_role secret ONCE (reused on every update):"
echo ""
echo -e "     ${GREEN}mkdir -p ${UNRAID_APPDATA}${NC}"
echo -e "     ${GREEN}printf %s 'YOUR_SUPABASE_SERVICE_ROLE_KEY' > ${UNRAID_APPDATA}/service_role${NC}"
echo -e "     ${GREEN}chmod 600 ${UNRAID_APPDATA}/service_role${NC}"
echo ""
echo -e "  4. Pull the latest image:"
echo ""
echo -e "     ${GREEN}docker pull ${IMAGE}${NC}"
echo ""
echo -e "  5. Stop/remove any old container (if it exists):"
echo ""
echo -e "     ${GREEN}docker rm -f ${IMAGE_NAME} 2>/dev/null || true${NC}"
echo ""
echo -e "  6. Run the container:"
echo ""
echo -e "     ${GREEN}SERVICE_ROLE=\$(cat ${UNRAID_APPDATA}/service_role)${NC}"
echo -e "     ${GREEN}docker run -d \\${NC}"
echo -e "     ${GREEN}  --name ${IMAGE_NAME} \\${NC}"
echo -e "     ${GREEN}  --restart unless-stopped \\${NC}"
echo -e "     ${GREEN}  -p ${NEXT_PORT}:3000 \\${NC}"
echo -e "     ${GREEN}  -p ${GAME_PORT}:3001 \\${NC}"
echo -e "     ${GREEN}  -e NODE_ENV=production \\${NC}"
echo -e "     ${GREEN}  -e GAME_CLIENT_ORIGIN='${PUBLIC_ORIGIN}' \\${NC}"
echo -e "     ${GREEN}  -e SUPABASE_URL='${SUPABASE_URL}' \\${NC}"
echo -e "     ${GREEN}  -e SUPABASE_SERVICE_ROLE_KEY=\"\$SERVICE_ROLE\" \\${NC}"
echo -e "     ${GREEN}  ${IMAGE}${NC}"
echo ""
echo -e "  7. Watch logs:"
echo ""
echo -e "     ${GREEN}docker logs -f ${IMAGE_NAME}${NC}"
echo ""
echo -e "${YELLOW}TO UPDATE (after future deploys):${NC}"
echo ""
echo -e "     ${GREEN}docker pull ${IMAGE}${NC}"
echo -e "     ${GREEN}docker rm -f ${IMAGE_NAME} 2>/dev/null || true${NC}"
echo -e "     ${GREEN}SERVICE_ROLE=\$(cat ${UNRAID_APPDATA}/service_role)${NC}"
echo -e "     ${GREEN}docker run -d \\${NC}"
echo -e "     ${GREEN}  --name ${IMAGE_NAME} \\${NC}"
echo -e "     ${GREEN}  --restart unless-stopped \\${NC}"
echo -e "     ${GREEN}  -p ${NEXT_PORT}:3000 \\${NC}"
echo -e "     ${GREEN}  -p ${GAME_PORT}:3001 \\${NC}"
echo -e "     ${GREEN}  -e NODE_ENV=production \\${NC}"
echo -e "     ${GREEN}  -e GAME_CLIENT_ORIGIN='${PUBLIC_ORIGIN}' \\${NC}"
echo -e "     ${GREEN}  -e SUPABASE_URL='${SUPABASE_URL}' \\${NC}"
echo -e "     ${GREEN}  -e SUPABASE_SERVICE_ROLE_KEY=\"\$SERVICE_ROLE\" \\${NC}"
echo -e "     ${GREEN}  ${IMAGE}${NC}"
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   🌐 nginx: /socket.io/ -> :${GAME_PORT}, everything else -> :${NEXT_PORT}${NC}"
echo -e "${BLUE}   🌐 Access: ${PUBLIC_ORIGIN}${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

#!/bin/bash

# Dev Social - Deploy Script
# Builds a linux/amd64 image and pushes it to Docker Hub, then prints the
# Unraid `docker run` command.
#
# Usage:
#   ./deploy.sh                    # Build (linux/amd64) & push to Docker Hub
#   ./deploy.sh "commit message"   # Commit+push to git first, then build & push
#   ./deploy.sh --local            # Build & run locally with docker compose
#
# Prereqs:
#   export DOCKERHUB_TOKEN='...'   # Docker Hub access token (hub.docker.com ->
#                                  #   Account Settings -> Personal access tokens)
#   .env present with SUPABASE_SERVICE_ROLE_KEY=... (for the printed run command)

set -e

# ----------------------------- Config ---------------------------------------
DOCKERHUB_USERNAME="${DOCKERHUB_USERNAME:-adaptivesoftware}"   # <-- set yours
IMAGE_NAME="dev-social"
IMAGE_TAG="${IMAGE_TAG:-latest}"
IMAGE="docker.io/${DOCKERHUB_USERNAME}/${IMAGE_NAME}:${IMAGE_TAG}"

# PUBLIC values — baked into the browser bundle at BUILD time (NEXT_PUBLIC_*).
PUBLIC_ORIGIN="https://devsocial.adaptivesoftware.co"
SUPABASE_URL="https://dlfjcxnnmtkzupvhdivw.supabase.co"
SUPABASE_ANON_KEY="sb_publishable_BKDF8Jx85S4jPZy7UUembg_vQK2GW6g"

# Unraid host ports (left = host, right = container).
NEXT_PORT=3000
GAME_PORT=3001

# Optional git remote for the commit step.
REPO_URL="${REPO_URL:-}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   🎉 Dev Social - Deploy${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Load .env (for the runtime service_role secret used in the printed run cmd).
if [ -f .env ]; then
    set -a; . ./.env; set +a
fi

# --------------------------- Local mode --------------------------------------
if [[ "$1" == "--local" ]] || [[ "$2" == "--local" ]]; then
    echo -e "${BLUE}🐳 Building & running locally with docker compose...${NC}"
    docker compose up --build
    exit 0
fi

# ----------------------- Optional: commit + push -----------------------------
if [ -n "$1" ] && [[ "$1" != "--local" ]]; then
    if [[ -n $(git status -s 2>/dev/null) ]]; then
        echo -e "${BLUE}📦 Committing changes...${NC}"
        git add -A
        git commit -m "$1"
        if [ -n "$REPO_URL" ]; then
            git remote set-url origin "$REPO_URL" 2>/dev/null || git remote add origin "$REPO_URL"
            git push origin "$(git rev-parse --abbrev-ref HEAD)"
            echo -e "${GREEN}✅ Git updated${NC}"
        else
            echo -e "${YELLOW}ℹ️  No REPO_URL set; committed locally only.${NC}"
        fi
        echo ""
    fi
fi

# --------------------------- Docker Hub login --------------------------------
echo -e "${BLUE}🔑 Logging into Docker Hub...${NC}"
if [ -z "$DOCKERHUB_TOKEN" ]; then
    echo -e "${RED}❌ DOCKERHUB_TOKEN is not set.${NC}"
    echo -e "${YELLOW}export DOCKERHUB_TOKEN='your_token' (hub.docker.com -> Account Settings -> Personal access tokens)${NC}"
    exit 1
fi
echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin
echo -e "${GREEN}✅ Logged in${NC}"
echo ""

# --------------------- Build (linux/amd64) & push ----------------------------
if ! docker buildx version >/dev/null 2>&1; then
    echo -e "${RED}❌ docker buildx is required.${NC}"; exit 1
fi
docker buildx create --name devsocial-builder --use 2>/dev/null \
    || docker buildx use devsocial-builder 2>/dev/null || true

echo -e "${BLUE}🐳 Building ${IMAGE} for linux/amd64 and pushing...${NC}"
echo -e "${YELLOW}⏳ This may take a few minutes...${NC}"
docker buildx build \
    --platform linux/amd64 \
    --build-arg NEXT_PUBLIC_GAME_SERVER_URL="$PUBLIC_ORIGIN" \
    --build-arg NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL" \
    --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
    -t "$IMAGE" \
    --push .

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   ✅ Pushed ${IMAGE}${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# ----------------------- Print Unraid run command ----------------------------
if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    echo -e "${YELLOW}⚠️  SUPABASE_SERVICE_ROLE_KEY not found in .env — the printed${NC}"
    echo -e "${YELLOW}   command below uses a PLACEHOLDER. Fill it in, or the app runs${NC}"
    echo -e "${YELLOW}   in-memory only (no persistence / photo storage).${NC}"
    SERVICE_ROLE_FOR_CMD="PASTE_YOUR_SERVICE_ROLE_KEY"
else
    SERVICE_ROLE_FOR_CMD="$SUPABASE_SERVICE_ROLE_KEY"
fi

echo "========================================"
echo "   UNRAID DOCKER RUN COMMAND"
echo "========================================"
echo ""
echo "Copy/paste into your Unraid terminal:"
echo ""
echo "----------------------------------------"
cat <<DOCKER_CMD
docker pull ${IMAGE} && \\
docker rm -f ${IMAGE_NAME} 2>/dev/null; \\
docker run -d \\
  --name ${IMAGE_NAME} \\
  --restart unless-stopped \\
  -p ${NEXT_PORT}:3000 \\
  -p ${GAME_PORT}:3001 \\
  -e NODE_ENV=production \\
  -e GAME_CLIENT_ORIGIN='${PUBLIC_ORIGIN}' \\
  -e SUPABASE_URL='${SUPABASE_URL}' \\
  -e SUPABASE_SERVICE_ROLE_KEY='${SERVICE_ROLE_FOR_CMD}' \\
  ${IMAGE}
DOCKER_CMD
echo "----------------------------------------"
echo ""
echo "nginx: route /socket.io/ -> :${GAME_PORT}, everything else -> :${NEXT_PORT}"
echo "Logs:  docker logs -f ${IMAGE_NAME}"
echo ""

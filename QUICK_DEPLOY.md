# 🚀 Quick Deploy Cheat Sheet

Full details in [README → Deploy](README.md#deploy-docker--unraid--nginx).
Two-process container: Next.js app (`:3000`) + Socket.IO game server (`:3001`),
fronted by one HTTPS origin. Hosted Supabase is the system of record.

- **Image**: `ghcr.io/mikesawayda-adaptivesoftware/dev-social:latest`
- **Origin**: https://dev-social.adaptivesoftware.co
- **Unraid host**: `192.168.0.248` — app `:3092`, socket `:3093`

## Deploy from Dev Machine (Mac)
```bash
open -a Docker                       # Docker Desktop must be running
export GITHUB_CR_PAT='ghp_...'       # PAT w/ write:packages + read:packages
cd /Users/msawayda/test_stuff/Dev-Social
./deploy.sh "Your commit message"    # commit/push → build linux/amd64 → push to ghcr.io
# ./deploy.sh          # build + push only (no commit)
# ./deploy.sh --local  # build + run locally via docker compose
```

## One-time infra (per environment)
**Cloudflare** — add a proxied CNAME:
`dev-social` → `adaptivesoftware.co`, 🟠 Proxied, TTL Auto.
(Account SSL/TLS mode = **Full**, not Flexible.)

**Nginx Proxy Manager** — one proxy host:
- Details: `dev-social.adaptivesoftware.co` → `http` `192.168.0.248:3092`, **Websockets ON**
- Custom Locations: `/socket.io/` → `http` `192.168.0.248:3093`, gear ⚙️:
  ```nginx
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_read_timeout 86400s;
  proxy_send_timeout 86400s;
  ```
- SSL: Let's Encrypt + Force SSL. (If issuance fails while proxied, set CF to
  DNS-only, issue, then re-enable Proxied.)

## Deploy on Unraid (First Time)
```bash
# Login only if the ghcr package is private
echo 'YOUR_PAT' | docker login ghcr.io -u mikesawayda-adaptivesoftware --password-stdin

# Save the Supabase service_role secret ONCE (reused on every update)
mkdir -p /mnt/user/appdata/dev-social
printf %s 'YOUR_SERVICE_ROLE_KEY' > /mnt/user/appdata/dev-social/service_role
chmod 600 /mnt/user/appdata/dev-social/service_role

# Pull + run
docker pull ghcr.io/mikesawayda-adaptivesoftware/dev-social:latest
docker rm -f dev-social 2>/dev/null || true
SERVICE_ROLE=$(cat /mnt/user/appdata/dev-social/service_role)
docker run -d --name dev-social --restart unless-stopped \
  -p 3092:3000 -p 3093:3001 \
  -e NODE_ENV=production \
  -e GAME_CLIENT_ORIGIN='https://dev-social.adaptivesoftware.co' \
  -e SUPABASE_URL='https://dlfjcxnnmtkzupvhdivw.supabase.co' \
  -e SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE" \
  ghcr.io/mikesawayda-adaptivesoftware/dev-social:latest
```

## Update on Unraid (after future deploys)
```bash
docker pull ghcr.io/mikesawayda-adaptivesoftware/dev-social:latest
docker rm -f dev-social 2>/dev/null || true
SERVICE_ROLE=$(cat /mnt/user/appdata/dev-social/service_role)
# ...then the same `docker run` as above (service_role file is reused)
```

## Access & Logs
- **URL**: https://dev-social.adaptivesoftware.co
- **Health**: `http://192.168.0.248:3093/health` (game server)
- **Logs**: `docker logs -f dev-social`

## Gotchas
| Symptom | Fix |
| ------- | --- |
| Page loads, games never connect | NPM `/socket.io/` → `:3093` w/ upgrade headers; baked origin must match domain |
| `ERR_TOO_MANY_REDIRECTS` | Cloudflare SSL/TLS mode → **Full** |
| `docker pull` denied | ghcr package is private → `docker login` or make it public |
| GeoGuessr shows setup hint | Set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in `.env` and re-run `./deploy.sh` (baked at build, not runtime) |
| No leaderboard / persistence | `SUPABASE_SERVICE_ROLE_KEY` missing on container, or migrations not applied |

# 🚀 Quick Deploy Cheat Sheet

Full details in [README → Deploy](README.md#deploy-docker--unraid--nginx).
Two-process container: Next.js app (`:3000`) + Socket.IO game server (`:3001`),
fronted by one HTTPS origin. Hosted Supabase is the system of record.

- **Image**: `ghcr.io/mikesawayda-adaptivesoftware/dev-social:latest`
- **Origin**: https://dev-social.adaptivesoftware.co
- **Unraid host**: `192.168.0.248` — app `:3092`, socket `:3093`

## Deploy

```bash
git push origin main
```

That's it. There is no deploy script and nothing to run on a workstation.

```
push to main
  └─ CI: lint → build → tsc --noEmit          (.github/workflows/ci.yml)
      └─ build linux/amd64, push :latest      (.github/workflows/deploy.yml)
          └─ Watchtower on Unraid polls, pulls, restarts   (~5 min)
```

A failing CI produces **no image**, so a broken build never reaches Unraid —
that is what makes pushing straight to `main` safe without branch protection.
Delivery is pull-based, so CI holds no SSH key, no VPN and no LAN access.

Changes under `supabase/migrations/` also apply themselves, via
`.github/workflows/deploy-migrations.yml`.

### Confirm it landed

```bash
curl -s https://dev-social.adaptivesoftware.co/api/health
```

`sha` is the commit that's live. Compare it to what you pushed.

> ⚠️ **Room state is in memory.** Every Watchtower restart ends every game in
> progress. Don't merge during a happy hour — or set `WATCHTOWER_SCHEDULE` on
> the Unraid box so updates land at a known quiet time.

### Rollback

Every build also publishes `:sha-<full-commit>`. On Unraid, pin it and restart:

```bash
cd /mnt/user/appdata/dev-social && docker compose up -d
```

(after editing `image:` in `docker-compose.yml` to the sha tag).

### Build locally

```bash
npm run docker:local
```

## One-time repo setup

**GitHub → Settings → Secrets and variables → Actions**

| Kind | Name | Value |
| ---- | ---- | ----- |
| Variable | `PUBLIC_ORIGIN` | `https://dev-social.adaptivesoftware.co` |
| Variable | `SUPABASE_URL` | `https://dlfjcxnnmtkzupvhdivw.supabase.co` |
| Variable | `GOOGLE_MAPS_MAP_ID` | your Map ID (else the map falls back to `DEMO_MAP_ID`) |
| Secret | `SUPABASE_ANON_KEY` | the `sb_publishable_…` key |
| Secret | `GOOGLE_MAPS_BROWSER_KEY` | browser Maps key — **restrict by HTTP referrer** |
| Secret | `SUPABASE_ACCESS_TOKEN` | Supabase → Account → Access Tokens (migrations only) |
| Secret | `SUPABASE_DB_PASSWORD` | project Postgres password (migrations only) |

The migrations workflow skips with a warning until its two secrets exist, so the
pipeline stays green in the meantime.

`NEXT_PUBLIC_*` values are inlined into the browser bundle at **build** time, so
changing any of them requires a new build — re-run **Deploy** from the Actions
tab (`workflow_dispatch`) after editing.

## One-time infra (per environment)

**Cloudflare** — add a proxied CNAME:
`dev-social` → `adaptivesoftware.co`, 🟠 Proxied, TTL Auto.
(Account SSL/TLS mode = **Full**, not Flexible.)

**Nginx Proxy Manager** — one proxy host:
- Details: `dev-social.adaptivesoftware.co` → `http` `192.168.0.248:3092`, **Websockets ON**
- Custom Locations: `/socket.io/` → `http` `192.168.0.248:3093`. In the gear ⚙️
  box put **only** the timeouts (Websockets Support adds the upgrade headers; a
  2nd `proxy_http_version` breaks nginx → Internal Error / 525):
  ```nginx
  proxy_read_timeout 86400s;
  proxy_send_timeout 86400s;
  ```
- SSL: Let's Encrypt + Force SSL. (If issuance fails while proxied, set CF to
  DNS-only, issue, then re-enable Proxied.)

## One-time Unraid setup

```bash
mkdir -p /mnt/user/appdata/dev-social && cd /mnt/user/appdata/dev-social

# 1. Compose file — copy infra/docker-compose.yml from the repo to here.
#    Only needed again if that file changes; image updates need nothing.

# 2. Secrets, beside it. See infra/.env.unraid.example.
cat > .env <<'EOF'
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GOOGLE_MAPS_API_KEY=your-unrestricted-server-key
EOF
chmod 600 .env

# 3. The ghcr package is private, so the host needs a login (one time).
echo 'YOUR_GITHUB_PAT' | docker login ghcr.io -u mikesawayda-adaptivesoftware --password-stdin

# 4. Replace the old hand-run container with the compose stack.
docker rm -f dev-social 2>/dev/null || true
docker compose pull && docker compose up -d
```

Then confirm Watchtower can pull a **private** GHCR image — it needs either the
host's `~/.docker/config.json` mounted, or `REPO_USER`/`REPO_PASS` set on the
Watchtower container. It already pulls `campsite-scanner` from the same org, so
this is usually already in place.

## Access & Logs
- **URL**: https://dev-social.adaptivesoftware.co
- **Live commit**: `https://dev-social.adaptivesoftware.co/api/health`
- **Health (LAN)**: `http://192.168.0.248:3093/health` (game server, same sha)
- **Logs**: `docker logs -f dev-social`

## Gotchas
| Symptom | Fix |
| ------- | --- |
| Page loads, games never connect | NPM `/socket.io/` → `:3093`, Websockets Support ON; baked origin must match domain |
| NPM *Internal Error* on save / Cloudflare 525 | Duplicate `proxy_http_version` in the `/socket.io/` advanced box — delete it (the Websockets toggle adds it) |
| `ERR_TOO_MANY_REDIRECTS` | Cloudflare SSL/TLS mode → **Full** |
| `docker pull` denied | ghcr package is private → `docker login` on the host, and give Watchtower the same creds |
| GeoGuessr shows setup hint | `GOOGLE_MAPS_BROWSER_KEY` secret missing → set it and re-run **Deploy** (baked at build, not runtime) |
| GeoGuessr loads but no Street View | Server-side `GOOGLE_MAPS_API_KEY` missing from the Unraid `.env`, or it's referrer-restricted (it must not be) |
| No leaderboard / persistence | `SUPABASE_SERVICE_ROLE_KEY` missing from the Unraid `.env`, or migrations not applied |
| `/api/health` sha is stale | Watchtower hasn't polled yet (wait), or Cloudflare cached it (the route sends `no-store`, so check the poll interval first) |
| CI green but no image | The push only touched paths in `paths-ignore` (`**.md`, `supabase/**`, `.claude/**`) — run **Deploy** manually if you need a rebuild |

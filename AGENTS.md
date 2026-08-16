<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Deploying

**A push to `main` ships to production.** Treat it that way.

```
push to main
  └─ CI: lint → next build → tsc --noEmit         .github/workflows/ci.yml
      └─ build linux/amd64, push :latest + :sha-… .github/workflows/deploy.yml
          └─ Watchtower on Unraid pulls, restarts              (~5 min)
```

- **Never run `docker buildx`, `docker push`, or any deploy script by hand.**
  There is no deploy script; `deploy.sh` was deleted deliberately. CI owns the
  build, and it is the only thing holding registry credentials.
- The publish job `needs:` the CI job, so a red build produces no image. Don't
  route around that.
- Confirm a deploy landed with
  `curl -s https://dev-social.adaptivesoftware.co/api/health` — `sha` is the
  commit the running image was built from. Do not report a deploy as done
  before that value matches; a green Actions run only means the image was
  pushed, not that Unraid has it yet.
- Before pushing, run the CI gate locally in this order — `npx tsc --noEmit`
  fails on missing generated types if `next build` hasn't run first:

  ```bash
  npm run lint && npm run build && npx tsc --noEmit
  ```

- `tsc --noEmit` is the **only** check that covers `server/`. `next build`
  typechecks `src/` alone, and the game server is executed straight from
  TypeScript by `tsx`, so a type error there is a production crash rather than
  a build failure. Never skip it.

## Things that will bite you

- **`NEXT_PUBLIC_*` values are baked at build time**, from repo Variables and
  Secrets (see the table in [README](README.md#build-time-vs-run-time-config-read-this-first)).
  Changing one is a settings edit plus a re-run of **Deploy**, not a container
  restart.
- **Room state is in memory** (`server/rooms.ts`, no Redis adapter). Every
  Watchtower restart ends every game in progress. Say so before merging if a
  session might be live.
- **Runtime secrets never pass through CI.** `SUPABASE_SERVICE_ROLE_KEY` and the
  server-side `GOOGLE_MAPS_API_KEY` live only in `/mnt/user/appdata/dev-social/.env`
  on the Unraid host. Don't add them to the workflow, and don't write them into
  a tracked file — `.gitignore` covers `.env*` for this reason.
- **Two Maps keys, opposite restrictions.** The browser key must be
  HTTP-referrer-restricted; the server key must not be restricted at all.
- `infra/docker-compose.yml` is production (pull-only). The root
  `docker-compose.yml` is a local build. They are not interchangeable.

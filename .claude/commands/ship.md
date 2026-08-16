---
description: Run the CI gate, push to main, then watch the deploy all the way to the live site
argument-hint: [commit message]
allowed-tools: Bash, Read, Edit, Glob, Grep
---

Ship the current working tree to production, end to end. Do not stop at "pushed"
— a green Actions run only means the image was published, not that Unraid is
running it.

Commit message: $1 (if empty, write one from the diff — imperative subject, then
a short paragraph on *why*, not what).

## Steps

1. **Show me what's shipping.** `git status --short` and `git diff --stat`. If
   the tree is clean, skip to step 4 and just verify what's already live.

2. **Run the gate locally**, in this order — `tsc` needs the generated types
   that `next build` produces:

   ```
   npm run lint && npm run build && npx tsc --noEmit
   ```

   If anything fails, fix it and re-run. Do not push a red tree; the publish job
   `needs:` CI, so pushing it just burns five minutes and produces no image.

3. **Commit and push to `main`.** Stage deliberately — name the paths, never
   `git add -A`. Confirm nothing matching `.env*` or a key is in the diff before
   committing.

4. **Watch the build.** `gh run watch --exit-status` on the newest **Deploy**
   run. On failure, read the logs (`gh run view --log-failed`), fix, and go back
   to step 2.

5. **Wait for Watchtower and confirm.** Poll until the live sha matches the
   commit you just pushed — it usually takes a few minutes after the run goes
   green:

   ```
   curl -s https://dev-social.adaptivesoftware.co/api/health
   ```

   Compare `sha` to `git rev-parse HEAD`. Poll at a sensible interval rather
   than in a tight loop, and give up after about ten minutes with a clear
   report rather than waiting forever.

## Report back

The commit sha, the Actions run URL, and whether `/api/health` matched. If it
didn't match, say so plainly and name the likely cause — Watchtower not yet
polled, Watchtower unable to pull the private GHCR package, or the push having
touched only `paths-ignore` paths (`**.md`, `supabase/**`, `.claude/**`), in
which case no image was built and **Deploy** needs a manual run.

## Warn me first if

- A game might be in progress. Room state is in memory, so the restart ends
  every live session.
- The diff touches `supabase/migrations/` — that fires a separate workflow that
  writes to the production database.
- The diff changes a `NEXT_PUBLIC_*` default or `infra/docker-compose.yml`;
  neither takes effect the way a normal code change does.

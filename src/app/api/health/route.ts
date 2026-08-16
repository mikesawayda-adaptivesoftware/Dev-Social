/**
 * Deploy verification endpoint.
 *
 * Watchtower pulls new images silently, so without this there is no way to tell
 * whether the code running at https://dev-social.adaptivesoftware.co is the
 * commit you just pushed. `BUILD_SHA` is baked into the runner stage of the
 * Dockerfile from `github.sha`, so:
 *
 *   curl -s https://dev-social.adaptivesoftware.co/api/health
 *
 * is the whole confirmation step, and it works from a phone.
 *
 * Reachable on the public origin because nginx routes everything except
 * /socket.io/ to :3000. The game server has the same sha on its own /health,
 * but that one is only exposed on the LAN.
 *
 * Route Handlers are uncached by default, so no route segment config is needed —
 * but Cloudflare proxies this origin and would happily serve a stale sha, hence
 * the explicit no-store.
 */
export async function GET() {
  return Response.json(
    {
      ok: true,
      sha: process.env.BUILD_SHA ?? "dev",
      startedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

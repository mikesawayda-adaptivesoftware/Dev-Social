-- Dev Social — per-player GeoGuessr location history.
--
-- Records which curated locations each identity (players.name_key) has already
-- been shown. New games read this to soft-prefer locations the current players
-- haven't seen yet, reducing repeats across games. It never hard-blocks a game:
-- when everyone has seen everything, selection just falls back to least-seen.
--
-- Security: written only by the trusted game server (service_role key). Browser
-- roles (anon/authenticated) get no access. RLS is enabled with no policies.
--
-- Apply with `supabase db push`, the Supabase SQL editor, or the Supabase MCP.

create table if not exists public.player_locations_seen (
  name_key     text not null,             -- normalized player identity
  location_id  text not null,             -- GEO_LOCATIONS[].id
  last_seen_at timestamptz not null default now(),
  primary key (name_key, location_id)
);

create index if not exists player_locations_seen_name_key_idx
  on public.player_locations_seen using btree (name_key);

alter table public.player_locations_seen enable row level security;
revoke all on public.player_locations_seen from anon, authenticated;

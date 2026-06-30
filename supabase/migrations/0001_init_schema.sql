-- Dev Social — core schema for game history + season leaderboard.
--
-- This mirrors the live hosted project (dlfjcxnnmtkzupvhdivw) exactly, so a
-- fresh `supabase db push` reproduces the working database.
--
-- Architecture: the Socket.IO server (service_role key) is the only writer and
-- bypasses RLS. The browser (anon/publishable key) gets SELECT-only access via
-- RLS so it can render the public leaderboard.

create extension if not exists "pgcrypto";

-- One row per finished game.
create table if not exists public.games (
  id           uuid primary key default gen_random_uuid(),
  code         text not null,
  game_type    text not null default 'photo_guessr',
  host_name    text not null,
  status       text not null default 'finished',
  player_count integer not null default 0,
  round_count  integer not null default 0,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz default now()
);

-- One row per player within a game.
create table if not exists public.game_players (
  id        uuid primary key default gen_random_uuid(),
  game_id   uuid not null references public.games (id) on delete cascade,
  name      text not null,
  color     text not null default '#a78bfa',
  score     integer not null default 0,
  placement integer,
  is_host   boolean not null default false
);

create index if not exists game_players_game_id_idx
  on public.game_players using btree (game_id);

-- Case-insensitive, trimmed name index to back the leaderboard aggregation.
create index if not exists game_players_name_idx
  on public.game_players using btree (lower(btrim(name)));

-- All-time standings, grouped case-insensitively by player name. The displayed
-- name is the most recent spelling that player used. security_invoker = true so
-- the view respects the querying role's RLS policies.
create or replace view public.season_leaderboard
with (security_invoker = true) as
select
  (array_agg(btrim(gp.name) order by g.finished_at desc nulls last))[1] as name,
  count(distinct gp.game_id)                    as games_played,
  coalesce(sum(gp.score), 0::bigint)            as total_score,
  coalesce(max(gp.score), 0)                    as best_score,
  count(*) filter (where gp.placement = 1)      as wins
from public.game_players gp
join public.games g on g.id = gp.game_id and g.status = 'finished'
group by lower(btrim(gp.name));

-- RLS: read-only for the anon (browser) role; writes only via service_role.
alter table public.games enable row level security;
alter table public.game_players enable row level security;

drop policy if exists "Public can read games" on public.games;
create policy "Public can read games"
  on public.games
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Public can read game_players" on public.game_players;
create policy "Public can read game_players"
  on public.game_players
  for select
  to anon, authenticated
  using (true);

grant usage on schema public to anon, authenticated;
grant select on public.games to anon, authenticated;
grant select on public.game_players to anon, authenticated;
grant select on public.season_leaderboard to anon, authenticated;

-- Dev Social — Draw It drawings, kept for the leaderboard gallery.
--
-- Stores the *strokes*, not a rendered image.
--
-- The spec called for flattening each drawing to a PNG in the photos Storage
-- bucket. Strokes turned out to be strictly better on every axis that matters
-- here: no bucket and no rasteriser (the server has stroke data, not a canvas,
-- and node-canvas is a native dependency this project does not otherwise need),
-- the gallery re-renders through the same component the game draws with, it
-- stays crisp at any size instead of being a phone-sized bitmap on a TV, and a
-- whole drawing is ~16 KB of JSON against a PNG several times that.
--
-- It also quietly drops a consequence worth not having: Storage URLs are public
-- and permanent, so every doodle would have been a shareable link forever.
-- These rows are readable by the site, like game history, and no further.
--
-- `score` is the drawer's points for that round, which is the ceiling scaled by
-- the share of the room that guessed it — so ordering by it ranks drawings by
-- how well they communicated, which is the only thing a drawing here is for.
--
-- Apply with `supabase db push`, the Supabase SQL editor, or the Supabase MCP.

create table if not exists public.game_drawings (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games (id) on delete cascade,
  word         text not null,
  drawer_name  text not null,
  drawer_color text not null default '#a78bfa',
  score        integer not null default 0,
  solved       integer not null default 0,
  guessers     integer not null default 0,
  strokes      jsonb not null,
  created_at   timestamptz not null default now()
);

create index if not exists game_drawings_score_idx
  on public.game_drawings using btree (score desc, created_at desc);

create index if not exists game_drawings_game_id_idx
  on public.game_drawings using btree (game_id);

-- Same posture as games/game_players: the browser reads, only the game server
-- (service_role) writes.
alter table public.game_drawings enable row level security;

drop policy if exists "Public can read game_drawings" on public.game_drawings;
create policy "Public can read game_drawings"
  on public.game_drawings
  for select
  to anon, authenticated
  using (true);

grant select on public.game_drawings to anon, authenticated;

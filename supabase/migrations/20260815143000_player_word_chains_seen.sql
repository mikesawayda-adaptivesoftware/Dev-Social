-- Dev Social — per-player Word Chain puzzle history.
--
-- Records which seeded chains each identity (players.name_key) has already been
-- dealt. A Word Chain game is a single puzzle, so unlike the GeoGuessr history
-- this one is a hard filter first: the server picks from the chains nobody in
-- the room has seen, and only falls back to least-seen when the bank is
-- exhausted for that particular group.
--
-- Security: written only by the trusted game server (service_role key). Browser
-- roles (anon/authenticated) get no access. RLS is enabled with no policies.
--
-- Apply with `supabase db push`, the Supabase SQL editor, or the Supabase MCP.

create table if not exists public.player_word_chains_seen (
  name_key     text not null,             -- normalized player identity
  puzzle_id    text not null,             -- WORD_CHAINS[].id
  last_seen_at timestamptz not null default now(),
  primary key (name_key, puzzle_id)
);

create index if not exists player_word_chains_seen_name_key_idx
  on public.player_word_chains_seen using btree (name_key);

alter table public.player_word_chains_seen enable row level security;
revoke all on public.player_word_chains_seen from anon, authenticated;

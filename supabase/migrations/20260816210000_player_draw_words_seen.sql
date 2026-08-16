-- Dev Social — per-player Draw It word history.
--
-- Records which words each identity (players.name_key) has already been offered
-- or drawn, so future games steer toward words the room hasn't had.
--
-- A soft preference, not a filter, unlike the Word Chain equivalent. A repeated
-- word only spoils it for whoever remembers drawing it, and each turn offers
-- three words rather than dealing one, so the bank drains three times as fast
-- as a one-puzzle-per-game bank would. Blocking on it would run dry quickly for
-- no real gain.
--
-- Security: written only by the trusted game server (service_role key). Browser
-- roles (anon/authenticated) get no access. RLS is enabled with no policies.
--
-- Apply with `supabase db push`, the Supabase SQL editor, or the Supabase MCP.

create table if not exists public.player_draw_words_seen (
  name_key     text not null,             -- normalized player identity
  word_id      text not null,             -- DRAW_WORDS[].id
  last_seen_at timestamptz not null default now(),
  primary key (name_key, word_id)
);

create index if not exists player_draw_words_seen_name_key_idx
  on public.player_draw_words_seen using btree (name_key);

alter table public.player_draw_words_seen enable row level security;
revoke all on public.player_draw_words_seen from anon, authenticated;

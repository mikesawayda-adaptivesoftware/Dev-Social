-- Dev Social — name+PIN identity ("claim the name").
--
-- Each row owns a normalized name (name_key). The first person to use a name
-- claims it by setting a PIN; anyone else using that name must match the PIN.
-- This makes each leaderboard name a single, protected identity.
--
-- Security: the trusted game server (service_role key) is the only reader and
-- writer. anon/authenticated (the browser) get NO access, since this table holds
-- PIN hashes. RLS is enabled with no policies, so all non-service roles are
-- denied by default; service_role bypasses RLS.
--
-- Apply with `supabase db push`, the Supabase SQL editor, or the Supabase MCP.

create table if not exists public.players (
  id           uuid primary key default gen_random_uuid(),
  name_key     text unique not null,        -- normalized lower(btrim(name))
  display_name text not null,               -- last spelling the player used
  pin_hash     text not null,               -- scrypt, stored as saltHex:hashHex
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.players enable row level security;

-- Belt and suspenders: ensure the browser roles cannot touch PIN data.
revoke all on public.players from anon, authenticated;

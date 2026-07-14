-- Dev Social — richer leaderboards.
--
-- Adds an average-score column to the overall season leaderboard and a new
-- per-game-type leaderboard view. Both group players case-insensitively by name
-- and only count finished games. security_invoker = true so the views respect
-- the querying role's RLS (read-only for anon/browser).
--
-- Apply with `supabase db push` or by pasting into the Supabase SQL editor.

-- Overall standings across every game. avg_score is appended so this stays a
-- valid `create or replace view` over the 0001 definition.
create or replace view public.season_leaderboard
with (security_invoker = true) as
select
  (array_agg(btrim(gp.name) order by g.finished_at desc nulls last))[1] as name,
  count(distinct gp.game_id)                    as games_played,
  coalesce(sum(gp.score), 0::bigint)            as total_score,
  coalesce(max(gp.score), 0)                    as best_score,
  count(*) filter (where gp.placement = 1)      as wins,
  coalesce(round(avg(gp.score)), 0)::int        as avg_score
from public.game_players gp
join public.games g on g.id = gp.game_id and g.status = 'finished'
group by lower(btrim(gp.name));

-- Standings split by game type. Powers the per-type leaderboards, plus each
-- player's average (avg_score) and high score (best_score) per game type.
create or replace view public.season_leaderboard_by_type
with (security_invoker = true) as
select
  (array_agg(btrim(gp.name) order by g.finished_at desc nulls last))[1] as name,
  g.game_type,
  count(distinct gp.game_id)                    as games_played,
  coalesce(sum(gp.score), 0::bigint)            as total_score,
  coalesce(max(gp.score), 0)                    as best_score,
  coalesce(round(avg(gp.score)), 0)::int        as avg_score,
  count(*) filter (where gp.placement = 1)      as wins
from public.game_players gp
join public.games g on g.id = gp.game_id and g.status = 'finished'
group by lower(btrim(gp.name)), g.game_type;

grant select on public.season_leaderboard to anon, authenticated;
grant select on public.season_leaderboard_by_type to anon, authenticated;

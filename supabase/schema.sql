-- =============================================================================
--  Unified Competition Platform  ·  Supabase / PostgreSQL schema
-- =============================================================================
--  Run this whole file ONCE in the Supabase dashboard:
--      SQL Editor  →  New query  →  paste  →  Run
--  It is safe to run again (idempotent): it never deletes your data.
--
--  Security model
--  --------------
--  * Every table has Row Level Security ON and NO policy, and the anon /
--    authenticated roles have no table privileges. The publishable key that
--    the server uses can therefore NOT read or write any table directly.
--  * The only entry points are the cp_* functions below (SECURITY DEFINER).
--    Each one checks a shared sync secret that only the app server knows
--    (APP_SYNC_SECRET in .env). Without it every call is refused.
--  * Players' browsers never talk to Supabase: they talk to the app server,
--    which validates, rate-limits, then persists here.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Private config (not exposed through the API)
-- ---------------------------------------------------------------------------
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table if not exists app_private.config (
  key   text primary key,
  value text not null
);
revoke all on app_private.config from public, anon, authenticated;

-- The server's sync secret. It MUST equal APP_SYNC_SECRET in your .env file.
-- To rotate it: change it here and in .env, then restart the app container.
insert into app_private.config (key, value)
values ('sync_secret', '__APP_SYNC_SECRET__')
on conflict (key) do update set value = excluded.value;

-- ---------------------------------------------------------------------------
-- 1. Tables (they mirror the application's data model)
-- ---------------------------------------------------------------------------

-- competitionState: one row for the whole event
create table if not exists public.competition (
  id                     smallint primary key default 1 check (id = 1),
  version                bigint      not null default 0,          -- bumps on every change
  status                 text        not null default 'REGISTRATION'
                         check (status in ('REGISTRATION','LOBBY_LOCKED','COUNTDOWN',
                                           'MAIN_GAMES','CHALLENGE_WINDOW','FINISHED')),
  min_members            smallint    not null default 1,
  max_members            smallint    not null default 4,
  balance_small_groups   boolean     not null default true,
  base_challenge_stake   integer     not null default 50 check (base_challenge_stake between 0 and 1000),
  max_denials            smallint    not null default 2  check (max_denials between 0 and 10),
  countdown_ends_at      timestamptz,
  started_at             timestamptz,
  main_games_ends_at     timestamptz,                        -- the challenge phase opens by itself at this time
  registration_open      boolean     not null default true,  -- the public /register form accepts students
  checkin_open           boolean     not null default false, -- the check-in QR is on the big screen
  challenge_opened_at    timestamptz,
  challenge_timer_end    timestamptz,
  finished_at            timestamptz,
  active_challenge_id    text,
  settings               jsonb       not null default '{}'::jsonb, -- game tuning (battery, huroof rounds…)
  counters               jsonb       not null default '{}'::jsonb, -- id sequences used by the server
  updated_at             timestamptz not null default now()
);
insert into public.competition (id) values (1) on conflict (id) do nothing;

-- teams
create table if not exists public.teams (
  id                  text primary key,                      -- team_01, team_02 …
  join_code           text not null unique,                  -- A7X9
  placeholder_name    text not null,                         -- Cyber Falcons
  custom_name         text not null,                         -- name chosen by the team
  color_hex           text not null check (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order          smallint not null default 0,
  current_game_index  smallint not null default 0,           -- 0 RoboPath, 1 Locked Phone, 2 N7 Quiz, 3 done
  denials_remaining   smallint not null default 2,
  claimed_at          timestamptz,                           -- first login with the join code
  main_finished_at    timestamptz,                           -- finished the gauntlet
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- registered participants (team members)
create table if not exists public.participants (
  id             text primary key,
  full_name      text not null check (char_length(full_name) between 1 and 80),
  phone          text not null default '' check (char_length(phone) <= 20),   -- visible to the admin only
  filiere        text not null default '' check (char_length(filiere) <= 80),  -- field of study
  academic_year  smallint not null check (academic_year in (1, 2, 3)),
  source         text not null default 'admin' check (source in ('self','admin','import')), -- who registered them
  checked_in_at  timestamptz,                                -- confirmed presence (QR scan or admin); teams use only these
  team_id        text references public.teams (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists participants_team_idx on public.participants (team_id);

-- per team, per mini-game progress and points
-- (RoboPath 0–100, Locked Phone 0–100, N7 Quiz 0–280 with one decimal, as in the original quiz)
create table if not exists public.game_progress (
  team_id       text not null references public.teams (id) on delete cascade,
  game_key      text not null check (game_key in ('robopath','locked_phone','quiz')),
  status        text not null default 'locked'
                check (status in ('locked','ready','playing','completed','abandoned','dead')),
  points        numeric(6,1) not null default 0 check (points between 0 and 1000),
  state         jsonb not null default '{}'::jsonb,           -- game-specific saved state
  started_at    timestamptz,
  completed_at  timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (team_id, game_key)
);

-- 1v1 Huruf challenges (requests, queue, active match and history)
create table if not exists public.challenges (
  id                  text primary key,                      -- chal_01 …
  challenger_team_id  text not null references public.teams (id) on delete cascade,
  defender_team_id    text not null references public.teams (id) on delete cascade,
  status              text not null
                      check (status in ('PENDING','DENIED','EXPIRED','CANCELLED',
                                        'QUEUED','IN_PROGRESS','COMPLETED','ABORTED')),
  auto_accepted       boolean not null default false,
  challenger_rank     smallint,
  defender_rank       smallint,
  rank_delta          smallint,
  locked_point_stake  integer,
  winner_team_id      text references public.teams (id) on delete set null,
  requested_at        timestamptz not null,
  expires_at          timestamptz,
  responded_at        timestamptz,
  accepted_at         timestamptz,
  started_at          timestamptz,
  completed_at        timestamptz,
  huroof_state        jsonb,                                 -- live board of the match
  check (challenger_team_id <> defender_team_id)
);
create index if not exists challenges_status_idx on public.challenges (status, accepted_at);

-- points that are not mini-game points: challenge transfers and admin overrides
create table if not exists public.score_adjustments (
  id            text primary key,
  team_id       text not null references public.teams (id) on delete cascade,
  source        text not null check (source in ('challenge','admin')),
  points        integer not null,
  reason        text not null default '',
  challenge_id  text references public.challenges (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists score_adjustments_team_idx on public.score_adjustments (team_id);

-- audit trail / activity feed (append only)
create table if not exists public.event_log (
  id          bigserial primary key,
  type        text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists event_log_created_idx on public.event_log (created_at desc);

-- ---------------------------------------------------------------------------
-- 1b. Upgrade a database created by an earlier version of this file
--     (adds the registration / check-in columns and the N7 Quiz; keeps data)
-- ---------------------------------------------------------------------------
alter table public.competition  add column if not exists main_games_ends_at timestamptz;
alter table public.competition  add column if not exists registration_open  boolean not null default true;
alter table public.competition  add column if not exists checkin_open       boolean not null default false;
alter table public.participants add column if not exists phone              text not null default '';
alter table public.participants add column if not exists source             text not null default 'admin';
alter table public.participants add column if not exists checked_in_at      timestamptz;
alter table public.participants drop constraint if exists participants_phone_check;
alter table public.participants add  constraint participants_phone_check check (char_length(phone) <= 20);
alter table public.participants drop constraint if exists participants_source_check;
alter table public.participants add  constraint participants_source_check check (source in ('self','admin','import'));

drop view if exists public.v_leaderboard; -- depends on game_progress.points
alter table public.game_progress drop constraint if exists game_progress_game_key_check;
alter table public.game_progress drop constraint if exists game_progress_points_check;
alter table public.game_progress alter column points type numeric(6,1);
alter table public.game_progress add  constraint game_progress_game_key_check check (game_key in ('robopath','locked_phone','quiz'));
alter table public.game_progress add  constraint game_progress_points_check   check (points between 0 and 1000);

-- Readable leaderboard for the Supabase dashboard (not reachable by anon)
create or replace view public.v_leaderboard with (security_invoker = true) as
select t.id,
       t.custom_name                                   as team_name,
       t.color_hex,
       coalesce(g.points, 0)                           as game_points,
       coalesce(a.points, 0)                           as adjustment_points,
       coalesce(g.points, 0) + coalesce(a.points, 0)   as total_score
from public.teams t
left join (select team_id, sum(points) as points from public.game_progress group by team_id) g
       on g.team_id = t.id
left join (select team_id, sum(points)::int as points from public.score_adjustments group by team_id) a
       on a.team_id = t.id
order by total_score desc, t.sort_order;

-- ---------------------------------------------------------------------------
-- 2. Lock everything down
-- ---------------------------------------------------------------------------
alter table public.competition       enable row level security;
alter table public.teams             enable row level security;
alter table public.participants      enable row level security;
alter table public.game_progress     enable row level security;
alter table public.challenges        enable row level security;
alter table public.score_adjustments enable row level security;
alter table public.event_log         enable row level security;

revoke all on public.competition, public.teams, public.participants, public.game_progress,
              public.challenges, public.score_adjustments, public.event_log, public.v_leaderboard
  from anon, authenticated;
revoke all on sequence public.event_log_id_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
create or replace function app_private.check_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = app_private, pg_temp
as $$
declare
  v_secret text;
begin
  select value into v_secret from app_private.config where key = 'sync_secret';
  if v_secret is null or left(v_secret, 2) = '__' or p_secret is null or p_secret <> v_secret then
    raise exception 'cp: invalid sync secret' using errcode = '28000';
  end if;
end;
$$;
revoke all on function app_private.check_secret(text) from public, anon, authenticated;

-- milliseconds since epoch  <->  timestamptz
create or replace function app_private.ts(p jsonb)
returns timestamptz language sql immutable as $$
  select case when p is null or jsonb_typeof(p) <> 'number' then null
              else to_timestamp((p::text)::numeric / 1000.0) end
$$;
create or replace function app_private.ms(p timestamptz)
returns bigint language sql immutable as $$
  select case when p is null then null else round(extract(epoch from p) * 1000)::bigint end
$$;
revoke all on function app_private.ts(jsonb), app_private.ms(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. API used by the app server
-- ---------------------------------------------------------------------------

-- Health check: true when the secret is right.
create or replace function public.cp_ping(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
begin
  perform app_private.check_secret(p_secret);
  return jsonb_build_object('ok', true, 'version', (select version from public.competition where id = 1));
end;
$$;

-- Saves the whole competition snapshot in one transaction.
-- Stale writes (lower version than stored) are ignored.
create or replace function public.cp_save_snapshot(p_secret text, p_snapshot jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_version bigint := coalesce((p_snapshot->>'version')::bigint, 0);
  v_stored  bigint;
  c         jsonb  := coalesce(p_snapshot->'competition', '{}'::jsonb);
begin
  perform app_private.check_secret(p_secret);

  select version into v_stored from public.competition where id = 1 for update;
  if v_stored is not null and v_version < v_stored then
    return jsonb_build_object('ok', false, 'stale', true, 'version', v_stored);
  end if;

  -- competition -------------------------------------------------------------
  insert into public.competition as k (id, version, status, min_members, max_members, balance_small_groups,
         base_challenge_stake, max_denials, countdown_ends_at, started_at, main_games_ends_at,
         registration_open, checkin_open, challenge_opened_at,
         challenge_timer_end, finished_at, active_challenge_id, settings, counters, updated_at)
  values (1, v_version,
          coalesce(c->>'status', 'REGISTRATION'),
          coalesce((c->>'minMembers')::smallint, 1),
          coalesce((c->>'maxMembers')::smallint, 4),
          coalesce((c->>'balanceSmallGroups')::boolean, true),
          coalesce((c->>'baseChallengeStake')::int, 50),
          coalesce((c->>'maxDenials')::smallint, 2),
          ts(c->'countdownEndsAt'), ts(c->'startedAt'), ts(c->'mainGamesEndsAt'),
          coalesce((c->>'registrationOpen')::boolean, true),
          coalesce((c->>'checkinOpen')::boolean, false),
          ts(c->'challengeOpenedAt'),
          ts(c->'challengeTimerEnd'), ts(c->'finishedAt'),
          c->>'activeChallengeId',
          coalesce(c->'settings', '{}'::jsonb),
          coalesce(p_snapshot->'counters', '{}'::jsonb),
          now())
  on conflict (id) do update set
    version = excluded.version, status = excluded.status, min_members = excluded.min_members,
    max_members = excluded.max_members, balance_small_groups = excluded.balance_small_groups,
    base_challenge_stake = excluded.base_challenge_stake, max_denials = excluded.max_denials,
    countdown_ends_at = excluded.countdown_ends_at, started_at = excluded.started_at,
    main_games_ends_at = excluded.main_games_ends_at, registration_open = excluded.registration_open,
    checkin_open = excluded.checkin_open,
    challenge_opened_at = excluded.challenge_opened_at, challenge_timer_end = excluded.challenge_timer_end,
    finished_at = excluded.finished_at, active_challenge_id = excluded.active_challenge_id,
    settings = excluded.settings, counters = excluded.counters, updated_at = now();

  -- teams -------------------------------------------------------------------
  -- join codes are unique: free the codes of teams that are going away first
  delete from public.teams
   where id not in (select x->>'id' from jsonb_array_elements(coalesce(p_snapshot->'teams','[]')) x);
  -- avoid transient unique clashes when codes are swapped between teams
  update public.teams set join_code = '~' || id where true;

  insert into public.teams as t (id, join_code, placeholder_name, custom_name, color_hex, sort_order,
         current_game_index, denials_remaining, claimed_at, main_finished_at, created_at, updated_at)
  select x->>'id', x->>'joinCode', x->>'placeholderName',
         coalesce(nullif(x->>'customName',''), x->>'placeholderName'),
         x->>'colorHex', coalesce((x->>'order')::smallint, 0),
         coalesce((x->>'currentGameIndex')::smallint, 0),
         coalesce((x->>'denialsRemaining')::smallint, 2),
         ts(x->'claimedAt'), ts(x->'mainFinishedAt'),
         coalesce(ts(x->'createdAt'), now()), now()
    from jsonb_array_elements(coalesce(p_snapshot->'teams','[]')) x
  on conflict (id) do update set
    join_code = excluded.join_code, placeholder_name = excluded.placeholder_name,
    custom_name = excluded.custom_name, color_hex = excluded.color_hex, sort_order = excluded.sort_order,
    current_game_index = excluded.current_game_index, denials_remaining = excluded.denials_remaining,
    claimed_at = excluded.claimed_at, main_finished_at = excluded.main_finished_at,
    created_at = excluded.created_at, updated_at = now();

  -- participants ------------------------------------------------------------
  delete from public.participants
   where id not in (select x->>'id' from jsonb_array_elements(coalesce(p_snapshot->'participants','[]')) x);

  insert into public.participants as p (id, full_name, phone, filiere, academic_year, source,
         checked_in_at, team_id, created_at)
  select x->>'id', x->>'fullName', coalesce(x->>'phone',''), coalesce(x->>'filiere',''),
         (x->>'year')::smallint, coalesce(nullif(x->>'source',''), 'admin'),
         ts(x->'checkedInAt'), nullif(x->>'teamId',''), coalesce(ts(x->'createdAt'), now())
    from jsonb_array_elements(coalesce(p_snapshot->'participants','[]')) x
  on conflict (id) do update set
    full_name = excluded.full_name, phone = excluded.phone, filiere = excluded.filiere,
    academic_year = excluded.academic_year, source = excluded.source,
    checked_in_at = excluded.checked_in_at, team_id = excluded.team_id, created_at = excluded.created_at;

  -- game progress -----------------------------------------------------------
  delete from public.game_progress where true;
  insert into public.game_progress (team_id, game_key, status, points, state, started_at, completed_at, updated_at)
  select x->>'teamId', x->>'gameKey', x->>'status', coalesce((x->>'points')::numeric, 0),
         coalesce(x->'state','{}'::jsonb), ts(x->'startedAt'), ts(x->'completedAt'), now()
    from jsonb_array_elements(coalesce(p_snapshot->'games','[]')) x;

  -- challenges --------------------------------------------------------------
  delete from public.challenges
   where id not in (select x->>'id' from jsonb_array_elements(coalesce(p_snapshot->'challenges','[]')) x);

  insert into public.challenges as ch (id, challenger_team_id, defender_team_id, status, auto_accepted,
         challenger_rank, defender_rank, rank_delta, locked_point_stake, winner_team_id,
         requested_at, expires_at, responded_at, accepted_at, started_at, completed_at, huroof_state)
  select x->>'id', x->>'challengerTeamId', x->>'defenderTeamId', x->>'status',
         coalesce((x->>'autoAccepted')::boolean, false),
         (x->>'challengerRank')::smallint, (x->>'defenderRank')::smallint, (x->>'rankDelta')::smallint,
         (x->>'lockedPointStake')::int, nullif(x->>'winnerTeamId',''),
         coalesce(ts(x->'requestedAt'), now()), ts(x->'expiresAt'), ts(x->'respondedAt'),
         ts(x->'acceptedAt'), ts(x->'startedAt'), ts(x->'completedAt'),
         case when jsonb_typeof(x->'huroof') = 'object' then x->'huroof' else null end
    from jsonb_array_elements(coalesce(p_snapshot->'challenges','[]')) x
  on conflict (id) do update set
    challenger_team_id = excluded.challenger_team_id, defender_team_id = excluded.defender_team_id,
    status = excluded.status, auto_accepted = excluded.auto_accepted,
    challenger_rank = excluded.challenger_rank, defender_rank = excluded.defender_rank,
    rank_delta = excluded.rank_delta, locked_point_stake = excluded.locked_point_stake,
    winner_team_id = excluded.winner_team_id, requested_at = excluded.requested_at,
    expires_at = excluded.expires_at, responded_at = excluded.responded_at,
    accepted_at = excluded.accepted_at, started_at = excluded.started_at,
    completed_at = excluded.completed_at, huroof_state = excluded.huroof_state;

  -- score adjustments -------------------------------------------------------
  delete from public.score_adjustments
   where id not in (select x->>'id' from jsonb_array_elements(coalesce(p_snapshot->'adjustments','[]')) x);

  insert into public.score_adjustments as a (id, team_id, source, points, reason, challenge_id, created_at)
  select x->>'id', x->>'teamId', x->>'source', (x->>'points')::int, coalesce(x->>'reason',''),
         nullif(x->>'challengeId',''), coalesce(ts(x->'createdAt'), now())
    from jsonb_array_elements(coalesce(p_snapshot->'adjustments','[]')) x
  on conflict (id) do update set
    team_id = excluded.team_id, source = excluded.source, points = excluded.points,
    reason = excluded.reason, challenge_id = excluded.challenge_id, created_at = excluded.created_at;

  return jsonb_build_object('ok', true, 'version', v_version);
end;
$$;

-- Loads the whole competition snapshot (same shape the server saves).
create or replace function public.cp_load_snapshot(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  k public.competition;
begin
  perform app_private.check_secret(p_secret);
  select * into k from public.competition where id = 1;
  if not found then
    return jsonb_build_object('version', 0);
  end if;

  return jsonb_build_object(
    'version', k.version,
    'counters', k.counters,
    'competition', jsonb_build_object(
      'status', k.status, 'minMembers', k.min_members, 'maxMembers', k.max_members,
      'balanceSmallGroups', k.balance_small_groups, 'baseChallengeStake', k.base_challenge_stake,
      'maxDenials', k.max_denials, 'countdownEndsAt', ms(k.countdown_ends_at),
      'startedAt', ms(k.started_at), 'mainGamesEndsAt', ms(k.main_games_ends_at),
      'registrationOpen', k.registration_open, 'checkinOpen', k.checkin_open,
      'challengeOpenedAt', ms(k.challenge_opened_at),
      'challengeTimerEnd', ms(k.challenge_timer_end), 'finishedAt', ms(k.finished_at),
      'activeChallengeId', k.active_challenge_id, 'settings', k.settings),
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'joinCode', t.join_code, 'placeholderName', t.placeholder_name,
        'customName', t.custom_name, 'colorHex', t.color_hex, 'order', t.sort_order,
        'currentGameIndex', t.current_game_index, 'denialsRemaining', t.denials_remaining,
        'claimedAt', ms(t.claimed_at), 'mainFinishedAt', ms(t.main_finished_at),
        'createdAt', ms(t.created_at)) order by t.sort_order, t.id) from public.teams t), '[]'::jsonb),
    'participants', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'fullName', p.full_name, 'phone', p.phone, 'filiere', p.filiere,
        'year', p.academic_year, 'source', p.source, 'checkedInAt', ms(p.checked_in_at),
        'teamId', p.team_id, 'createdAt', ms(p.created_at)) order by p.created_at, p.id)
        from public.participants p), '[]'::jsonb),
    'games', coalesce((select jsonb_agg(jsonb_build_object(
        'teamId', g.team_id, 'gameKey', g.game_key, 'status', g.status, 'points', g.points,
        'state', g.state, 'startedAt', ms(g.started_at), 'completedAt', ms(g.completed_at))
        order by g.team_id, g.game_key) from public.game_progress g), '[]'::jsonb),
    'challenges', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'challengerTeamId', c.challenger_team_id, 'defenderTeamId', c.defender_team_id,
        'status', c.status, 'autoAccepted', c.auto_accepted, 'challengerRank', c.challenger_rank,
        'defenderRank', c.defender_rank, 'rankDelta', c.rank_delta,
        'lockedPointStake', c.locked_point_stake, 'winnerTeamId', c.winner_team_id,
        'requestedAt', ms(c.requested_at), 'expiresAt', ms(c.expires_at),
        'respondedAt', ms(c.responded_at), 'acceptedAt', ms(c.accepted_at),
        'startedAt', ms(c.started_at), 'completedAt', ms(c.completed_at),
        'huroof', c.huroof_state) order by c.requested_at, c.id) from public.challenges c), '[]'::jsonb),
    'adjustments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'teamId', a.team_id, 'source', a.source, 'points', a.points,
        'reason', a.reason, 'challengeId', a.challenge_id, 'createdAt', ms(a.created_at))
        order by a.created_at, a.id) from public.score_adjustments a), '[]'::jsonb)
  );
end;
$$;

-- Appends activity-feed / audit events (array of {type, payload, at}).
create or replace function public.cp_append_events(p_secret text, p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  n integer;
begin
  perform app_private.check_secret(p_secret);
  insert into public.event_log (type, payload, created_at)
  select left(coalesce(x->>'type','event'), 60), coalesce(x->'payload','{}'::jsonb),
         coalesce(ts(x->'at'), now())
    from jsonb_array_elements(coalesce(p_events,'[]')) x;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Only the server (holding the secret) can do anything useful with these,
-- but the role it connects with (the publishable key → anon) must be allowed to call them.
revoke all on function public.cp_ping(text), public.cp_save_snapshot(text, jsonb),
                       public.cp_load_snapshot(text), public.cp_append_events(text, jsonb)
  from public;
grant execute on function public.cp_ping(text), public.cp_save_snapshot(text, jsonb),
                          public.cp_load_snapshot(text), public.cp_append_events(text, jsonb)
  to anon, authenticated, service_role;

-- Done. Check with:  select public.cp_ping('<your APP_SYNC_SECRET>');

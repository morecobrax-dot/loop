-- =============================================================================
-- LOOP — D155 FRIEND PROFILES: SHARED TRAINING HIGHLIGHTS, BY CONSENT
-- =============================================================================
-- A friend's profile shows what the friendship already shares (username, level,
-- rank, this week's XP and workouts, from 0001/0002) plus, ONLY IF THE ATHLETE
-- TURNS IT ON, two small published summaries their own device computes:
--
--     records    up to three personal records: exercise name, kind of record,
--                load in lb and/or reps, and the date — each LOOP's own record
--                (one per lift, newest first; never an estimate, never an
--                assisted lift's counterweight)
--     activity   the three muscle groups with the most working sets over the
--                last four weeks, the working-set total they come from, and the
--                current week streak (consecutive weeks with a workout)
--
-- Each has its own switch, and both start OFF. A friendship alone shares
-- neither. Turning a switch off erases what was published under it, at once:
-- the next read by anyone gets nothing, whatever they saw before.
--
-- WHAT NEWLY CROSSES THE NETWORK, all of it listed in SOCIAL-SETUP.md: the two
-- summaries above, when switched on, and nothing else. Never: workouts, sets,
-- loads beyond the three records, notes, bodyweight, RIR, readiness, programs,
-- dates beyond the records' own, backups.
--
-- WHO CAN READ IT: the athlete, and an athlete with a CONFIRMED friendship —
-- decided at the moment of the read from public.friendships, never from
-- anything the caller sends. A pending request, an invite link (previewed or
-- not), a friend of a friend, a removed friend, a stranger who knows a user id
-- and an anonymous caller all get the same answer as a user who does not
-- exist: not_found.
--
-- HOW: one table, row level security ON, NO policy, NO grant — like
-- friend_invites. Three SECURITY DEFINER functions are the only door, and each
-- states auth.uid() first:
--     loop_set_profile_sharing(records, activity)   my switches
--     loop_publish_profile_highlights(seq, records, activity)   my summaries
--     loop_friend_profile(athlete, week)   one profile: mine or a friend's
--
-- PURELY ADDITIVE. No existing table, column, policy, grant or function is
-- changed: the LOOP client already in use keeps working exactly as before, and
-- loop_friends_hub is untouched. Requires 0005 (it relies on 0005's
-- loop_are_friends, which answers only about the caller) and refuses to apply
-- without it. Safe to run twice. If 0001 is ever run again, run 0005 and then
-- this file again after it.
--
-- Apply with:  supabase db push       (or paste into the SQL editor)
-- =============================================================================

do $$
begin
  if coalesce(obj_description('public.loop_new_invite_code()'::regprocedure, 'pg_proc'), '') <> 'csprng-v1' then
    raise exception '0006 needs 0005 (the security closure) applied first';
  end if;
end $$;


-- =============================================================================
-- THE PUBLISHED SUMMARIES
-- =============================================================================
-- One row per athlete, created the first time they touch a switch. The data
-- columns can only hold something while their switch is on (the checks say so
-- structurally, not just the functions), and are bounded in size and shape.
create table if not exists public.social_profile_share (
  user_id         uuid primary key references public.profiles(user_id) on delete cascade,
  share_records   boolean not null default false,
  share_activity  boolean not null default false,
  records         jsonb,
  records_at      timestamptz,
  activity        jsonb,
  activity_at     timestamptz,
  -- The publishing device's own sequence (its clock in ms when it derived the
  -- summaries): a retried or replayed older publication can never overwrite a
  -- newer one.
  seq             bigint not null default 0,
  published_at    timestamptz,
  updated_at      timestamptz not null default now(),

  constraint social_profile_share_records_need_consent check (share_records or (records is null and records_at is null)),
  constraint social_profile_share_activity_need_consent check (share_activity or (activity is null and activity_at is null)),
  constraint social_profile_share_records_bounded check (
    records is null or (jsonb_typeof(records) = 'array' and jsonb_array_length(records) <= 3 and octet_length(records::text) <= 2048)),
  constraint social_profile_share_activity_bounded check (
    activity is null or (jsonb_typeof(activity) = 'object' and octet_length(activity::text) <= 1024)),
  constraint social_profile_share_seq_sane check (seq >= 0)
);

alter table public.social_profile_share enable row level security;
-- Deliberately NO policy: no client role reads or writes this table directly.


-- =============================================================================
-- VALIDATION — exactly the shapes the app publishes, and nothing else
-- =============================================================================
-- Every key is named; an unknown key (a "notes", an "is_friend", anything)
-- makes the whole payload invalid rather than being ignored. Exercise names
-- may not carry control characters or angle brackets.

-- [{exercise, kind, load?, reps?, date}] — at most three, one per exercise.
--   weight          load (lb)          "the heaviest load lifted"
--   reps_at_weight  load (lb) + reps   "the most reps at that load"
--   reps            reps               "the most reps" (bodyweight)
create or replace function public.loop_profile_records_valid(p jsonb)
returns boolean
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  it    jsonb;
  kind  text;
  nm    text;
  keys  text[];
  want  text[];
  seen  text[] := '{}';
  num   numeric;
  dt    date;
begin
  if p is null or jsonb_typeof(p) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p) > 3 or octet_length(p::text) > 2048 then return false; end if;
  for it in select e.value from jsonb_array_elements(p) e loop
    if jsonb_typeof(it) is distinct from 'object' then return false; end if;
    if jsonb_typeof(it -> 'kind') is distinct from 'string' then return false; end if;
    kind := it ->> 'kind';
    want := case kind
              when 'weight'         then array['date','exercise','kind','load']
              when 'reps_at_weight' then array['date','exercise','kind','load','reps']
              when 'reps'           then array['date','exercise','kind','reps']
            end;
    if want is null then return false; end if;
    select coalesce(array_agg(k order by k), '{}') into keys from jsonb_object_keys(it) k;
    if keys is distinct from want then return false; end if;

    if jsonb_typeof(it -> 'exercise') is distinct from 'string' then return false; end if;
    nm := it ->> 'exercise';
    if char_length(nm) < 1 or char_length(nm) > 60 or nm <> btrim(nm) then return false; end if;
    if nm ~ '[[:cntrl:]<>]' then return false; end if;
    if lower(nm) = any(seen) then return false; end if;
    seen := seen || lower(nm);

    if jsonb_typeof(it -> 'date') is distinct from 'string' then return false; end if;
    if (it ->> 'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
    begin
      dt := (it ->> 'date')::date;
    exception when others then
      return false;
    end;
    if dt < date '2000-01-01' or dt > current_date + 2 then return false; end if;

    if kind in ('weight', 'reps_at_weight') then
      if jsonb_typeof(it -> 'load') is distinct from 'number' then return false; end if;
      num := (it ->> 'load')::numeric;
      if num <= 0 or num > 2000 or num <> round(num, 2) then return false; end if;
    end if;
    if kind in ('reps_at_weight', 'reps') then
      if jsonb_typeof(it -> 'reps') is distinct from 'number' then return false; end if;
      num := (it ->> 'reps')::numeric;
      if num < 1 or num > 1000 or num <> trunc(num) then return false; end if;
    end if;
  end loop;
  return true;
end;
$$;

-- {window_weeks: 4, through, sets, muscles: [{id, sets}], streak_weeks}
--   through        the publishing athlete's own civil date the window ends on
--   sets           working sets performed in the window (the denominator)
--   muscles        up to three, most sets first, LOOP's ten muscle ids; a set
--                  counts toward each muscle it primarily trains, so each is at
--                  most `sets` and they need not sum to it
--   streak_weeks   consecutive weeks with a workout (LOOP's week streak)
create or replace function public.loop_profile_activity_valid(p jsonb)
returns boolean
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  keys  text[];
  m     jsonb;
  ids   text[] := '{}';
  total numeric;
  prev  numeric := null;
  num   numeric;
  dt    date;
begin
  if p is null or jsonb_typeof(p) is distinct from 'object' or octet_length(p::text) > 1024 then return false; end if;
  select coalesce(array_agg(k order by k), '{}') into keys from jsonb_object_keys(p) k;
  if keys is distinct from array['muscles','sets','streak_weeks','through','window_weeks'] then return false; end if;

  if jsonb_typeof(p -> 'window_weeks') is distinct from 'number' or (p ->> 'window_weeks')::numeric <> 4 then return false; end if;

  if jsonb_typeof(p -> 'through') is distinct from 'string' then return false; end if;
  if (p ->> 'through') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
  begin
    dt := (p ->> 'through')::date;
  exception when others then
    return false;
  end;
  -- Fresh when published: the athlete's own today, which may sit a day either
  -- side of the server's.
  if dt < current_date - 2 or dt > current_date + 2 then return false; end if;

  if jsonb_typeof(p -> 'sets') is distinct from 'number' then return false; end if;
  total := (p ->> 'sets')::numeric;
  if total < 0 or total > 20000 or total <> trunc(total) then return false; end if;

  if jsonb_typeof(p -> 'streak_weeks') is distinct from 'number' then return false; end if;
  num := (p ->> 'streak_weeks')::numeric;
  if num < 0 or num > 104 or num <> trunc(num) then return false; end if;

  if jsonb_typeof(p -> 'muscles') is distinct from 'array' or jsonb_array_length(p -> 'muscles') > 3 then return false; end if;
  if total = 0 and jsonb_array_length(p -> 'muscles') > 0 then return false; end if;
  for m in select e.value from jsonb_array_elements(p -> 'muscles') e loop
    if jsonb_typeof(m) is distinct from 'object' then return false; end if;
    select coalesce(array_agg(k order by k), '{}') into keys from jsonb_object_keys(m) k;
    if keys is distinct from array['id','sets'] then return false; end if;
    if jsonb_typeof(m -> 'id') is distinct from 'string'
       or (m ->> 'id') not in ('chest','shoulders','back','biceps','triceps','abs','quads','hamstrings','glutes','calves') then
      return false;
    end if;
    if (m ->> 'id') = any(ids) then return false; end if;
    ids := ids || (m ->> 'id');
    if jsonb_typeof(m -> 'sets') is distinct from 'number' then return false; end if;
    num := (m ->> 'sets')::numeric;
    if num < 1 or num > total or num <> trunc(num) then return false; end if;
    if prev is not null and num > prev then return false; end if;
    prev := num;
  end loop;
  return true;
end;
$$;


-- =============================================================================
-- OPERATIONS
-- =============================================================================

-- My two switches. null leaves a switch as it is. Turning one OFF erases what
-- was published under it in the same statement; turning one ON publishes
-- nothing by itself — the app publishes fresh summaries next.
create or replace function public.loop_set_profile_sharing(p_records boolean, p_activity boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me  uuid := auth.uid();
  rec boolean;
  act boolean;
begin
  if me is null then return jsonb_build_object('status', 'not_signed_in'); end if;
  if not exists (select 1 from public.profiles where user_id = me) then
    return jsonb_build_object('status', 'no_profile');
  end if;
  if p_records is null and p_activity is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('loop_profile_share:' || me::text, 0));
  insert into public.social_profile_share (user_id) values (me) on conflict (user_id) do nothing;

  update public.social_profile_share s
     set share_records  = coalesce(p_records, s.share_records),
         records        = case when coalesce(p_records, s.share_records) then s.records else null end,
         records_at     = case when coalesce(p_records, s.share_records) then s.records_at else null end,
         share_activity = coalesce(p_activity, s.share_activity),
         activity       = case when coalesce(p_activity, s.share_activity) then s.activity else null end,
         activity_at    = case when coalesce(p_activity, s.share_activity) then s.activity_at else null end,
         updated_at     = now()
   where s.user_id = me
   returning s.share_records, s.share_activity into rec, act;

  return jsonb_build_object('status', 'ok', 'share_records', rec, 'share_activity', act);
end;
$$;

-- My summaries. Only for a switch that is on; only the exact shapes above;
-- only newer than what is stored; at most one publication every 10 seconds.
-- A category passed as null is left as it is.
create or replace function public.loop_publish_profile_highlights(p_seq bigint, p_records jsonb, p_activity jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  r  public.social_profile_share%rowtype;
begin
  if me is null then return jsonb_build_object('status', 'not_signed_in'); end if;
  if p_seq is null or p_seq <= 0 or p_seq > 9007199254740991 then
    return jsonb_build_object('status', 'invalid_payload');
  end if;
  if p_records is null and p_activity is null then
    return jsonb_build_object('status', 'invalid_payload');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('loop_profile_share:' || me::text, 0));
  select * into r from public.social_profile_share where user_id = me for update;
  if not found
     or (p_records is not null and not r.share_records)
     or (p_activity is not null and not r.share_activity) then
    return jsonb_build_object('status', 'not_shared');
  end if;
  if p_seq <= r.seq then
    return jsonb_build_object('status', 'stale', 'seq', r.seq);
  end if;
  if p_records is not null and not public.loop_profile_records_valid(p_records) then
    return jsonb_build_object('status', 'invalid_payload');
  end if;
  if p_activity is not null and not public.loop_profile_activity_valid(p_activity) then
    return jsonb_build_object('status', 'invalid_payload');
  end if;
  if r.published_at is not null and r.published_at > now() - interval '10 seconds' then
    return jsonb_build_object('status', 'too_frequent');
  end if;

  update public.social_profile_share
     set records      = case when p_records  is not null then p_records  else records end,
         records_at   = case when p_records  is not null then now()      else records_at end,
         activity     = case when p_activity is not null then p_activity else activity end,
         activity_at  = case when p_activity is not null then now()      else activity_at end,
         seq          = p_seq,
         published_at = now(),
         updated_at   = now()
   where user_id = me;

  return jsonb_build_object('status', 'published', 'seq', p_seq);
end;
$$;

-- One profile: mine, or a CONFIRMED friend's. Anyone else — however their id
-- was obtained — is indistinguishable from nobody. The week is the caller's own
-- civil Monday, as for loop_friends_hub; no row for it is null, never 0. Each
-- summary comes back only while its switch is on, with when it was published.
create or replace function public.loop_friend_profile(p_athlete uuid, p_week date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  s  public.social_profile_share%rowtype;
  person jsonb;
begin
  if me is null then return jsonb_build_object('status', 'not_signed_in'); end if;
  if p_week is null or extract(isodow from p_week) <> 1 then
    return jsonb_build_object('status', 'invalid_week');
  end if;
  if p_athlete is null then return jsonb_build_object('status', 'not_found'); end if;
  if p_athlete <> me and not coalesce(public.loop_are_friends(me, p_athlete), false) then
    return jsonb_build_object('status', 'not_found');
  end if;

  select jsonb_build_object(
           'user_id', p.user_id,
           'username', p.username,
           'is_self', p.user_id = me,
           'level', coalesce(st.level, 1),
           'rank', coalesce(st.rank, 'ROOKIE'),
           'lifetime_xp', coalesce(st.lifetime_xp, 0),
           'stats_updated_at', st.updated_at,
           'week_xp', w.weekly_xp,
           'week_workouts', w.workouts,
           'week_updated_at', w.updated_at,
           'friends_since', f.created_at)
    into person
    from public.profiles p
    left join public.social_stats st  on st.user_id = p.user_id
    left join public.social_weekly w  on w.user_id = p.user_id and w.week_start = p_week
    left join public.friendships f    on f.user_a = least(me, p.user_id) and f.user_b = greatest(me, p.user_id)
   where p.user_id = p_athlete;
  if person is null then return jsonb_build_object('status', 'not_found'); end if;

  select * into s from public.social_profile_share where user_id = p_athlete;

  return jsonb_build_object(
    'status', 'ok',
    'week', p_week,
    'person', person,
    'records', jsonb_build_object(
       'shared', coalesce(s.share_records, false),
       'items', case when coalesce(s.share_records, false) then s.records end,
       'updated_at', case when coalesce(s.share_records, false) then s.records_at end),
    'activity', jsonb_build_object(
       'shared', coalesce(s.share_activity, false),
       'data', case when coalesce(s.share_activity, false) then s.activity end,
       'updated_at', case when coalesce(s.share_activity, false) then s.activity_at end)
  );
end;
$$;


-- =============================================================================
-- GRANTS
-- =============================================================================
-- The same lessons as 0001–0005, applied from the start. Supabase's default
-- privileges grant ALL on every new table and function to anon and
-- authenticated, and PostgreSQL grants EXECUTE to PUBLIC besides — so each
-- holding is revoked by name, and exactly what a signed-in athlete needs is
-- granted back: the three functions. Nobody holds anything on the table, and
-- the two validators run only inside the functions (as their owner).
revoke all on table public.social_profile_share from public, anon, authenticated;

revoke execute on function public.loop_profile_records_valid(jsonb)  from public, anon, authenticated;
revoke execute on function public.loop_profile_activity_valid(jsonb) from public, anon, authenticated;

revoke execute on function public.loop_set_profile_sharing(boolean, boolean)              from public, anon;
revoke execute on function public.loop_publish_profile_highlights(bigint, jsonb, jsonb)   from public, anon;
revoke execute on function public.loop_friend_profile(uuid, date)                         from public, anon;
grant execute on function public.loop_set_profile_sharing(boolean, boolean)              to authenticated;
grant execute on function public.loop_publish_profile_highlights(bigint, jsonb, jsonb)   to authenticated;
grant execute on function public.loop_friend_profile(uuid, date)                         to authenticated;

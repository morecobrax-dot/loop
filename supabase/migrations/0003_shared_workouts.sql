-- =============================================================================
-- LOOP — D80B SHARED WORKOUTS
-- =============================================================================
-- One athlete sends one friend one workout: "I want you to try this." What
-- crosses the network is an intentional, sanitized snapshot of a workout's
-- PLAN — its title, its kind of session, an optional note written at the moment
-- of sharing, and for each exercise its identity, sets, reps and effort target.
--
-- It is not workout storage and it is not history. The recipient previews it
-- and either saves it — which creates an ordinary saved workout ON THEIR PHONE
-- that they own from then on — or dismisses it. Either way the row is deleted.
-- Nothing ever syncs back, and nothing here is ever edited after it is sent.
--
-- Never in a snapshot: weights, performed reps, RIR, PRs, Session Score,
-- ratings, private notes, bodyweight, dates or history, GPS, readiness, trainer
-- output, programs, email. The server rebuilds every stored snapshot from
-- validated fields, so an unexpected field is refused rather than stored.
--
--     shared_workouts        pending shares: RLS on, no policy, no grant —
--                            only the functions below reach it
--     shared_workout_sends   a 24-hour ledger of who sent to whom, for rate
--                            limits; RLS on, no policy, no grant
--
-- Requires 0001 and 0002. Safe to run twice.
--
-- Apply with:  supabase db push       (or paste into the SQL editor)
-- =============================================================================


-- =============================================================================
-- THE SNAPSHOTS
-- =============================================================================
-- Title, kind and exercise count are columns so the Friends screen can list a
-- share without reading its payload; the payload is the whole snapshot, stored
-- exactly as the server rebuilt it. A pending share lives 30 days.
create table if not exists public.shared_workouts (
  id             uuid primary key default gen_random_uuid(),
  sender         uuid not null references public.profiles(user_id) on delete cascade,
  recipient      uuid not null references public.profiles(user_id) on delete cascade,
  schema_version smallint not null,
  title          text not null,
  category       text not null,
  exercise_count smallint not null,
  payload        jsonb not null,
  created_at     timestamptz not null default now(),
  viewed_at      timestamptz,

  constraint shared_workouts_not_self check (sender <> recipient),
  -- A version this server does not understand is never stored. Supporting a
  -- new one is a migration, which is exactly the coupling wanted.
  constraint shared_workouts_version_known check (schema_version = 1),
  constraint shared_workouts_title_sane check (char_length(title) between 1 and 60),
  constraint shared_workouts_category_known check (
    category in ('push','pull','legs','upper','lower','core','fullbody','arms')),
  constraint shared_workouts_count_sane check (exercise_count between 1 and 20),
  constraint shared_workouts_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint shared_workouts_payload_size check (octet_length(payload::text) <= 8192)
);
create index if not exists shared_workouts_recipient_idx
  on public.shared_workouts(recipient, created_at desc);
create index if not exists shared_workouts_pair_idx
  on public.shared_workouts(sender, recipient);

-- IMMUTABLE AFTER SEND. The one change a row may ever take is being marked
-- viewed, once. Everything else — payload, title, who sent it, to whom, when —
-- is refused, whoever asks.
create or replace function public.loop_shared_workouts_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id
     or new.sender is distinct from old.sender
     or new.recipient is distinct from old.recipient
     or new.schema_version is distinct from old.schema_version
     or new.title is distinct from old.title
     or new.category is distinct from old.category
     or new.exercise_count is distinct from old.exercise_count
     or new.payload is distinct from old.payload
     or new.created_at is distinct from old.created_at
     or (old.viewed_at is not null and new.viewed_at is distinct from old.viewed_at) then
    raise exception 'a shared workout cannot be changed after it is sent' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists shared_workouts_guard on public.shared_workouts;
create trigger shared_workouts_guard before update on public.shared_workouts
  for each row execute function public.loop_shared_workouts_guard();


-- =============================================================================
-- THE LEDGER
-- =============================================================================
-- Rate limits have to count shares the recipient has already saved or
-- dismissed, whose rows are gone. So each send leaves one line here — who, to
-- whom, when, and nothing about the workout — kept for a day.
create table if not exists public.shared_workout_sends (
  sender    uuid not null references public.profiles(user_id) on delete cascade,
  recipient uuid not null references public.profiles(user_id) on delete cascade,
  sent_at   timestamptz not null default now()
);
create index if not exists shared_workout_sends_sender_idx
  on public.shared_workout_sends(sender, sent_at desc);
create index if not exists shared_workout_sends_sent_at_idx
  on public.shared_workout_sends(sent_at);


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
-- Both tables: RLS on, and deliberately NO policy. No client role reads or
-- writes either one directly; the SECURITY DEFINER functions below are the
-- only door, and each decides from auth.uid() alone.
alter table public.shared_workouts      enable row level security;
alter table public.shared_workout_sends enable row level security;


-- =============================================================================
-- OPERATIONS
-- =============================================================================

-- Send one workout to one friend.
--
-- Authorisation first: the caller must be signed in, have a profile, and be an
-- accepted friend of the recipient — checked here, never assumed from a client
-- list. A non-friend learns nothing else, not even whether the id exists.
--
-- Then the payload, field by field. Only these keys are accepted:
--   { v, title, category, note?, exercises: [ { id?, name, sets, reps, effort? } ] }
-- and anything else is refused. What is stored is REBUILT from the validated
-- values, never the caller's JSON as sent.
create or replace function public.loop_share_workout(p_recipient uuid, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me          uuid := auth.uid();
  v_key       text;
  v_title     text;
  v_category  text;
  v_note      text;
  v_count     int;
  v_ex        jsonb;
  v_name      text;
  v_id        text;
  v_sets      int;
  v_reps      text;
  v_effort    text;
  v_clean_ex  jsonb := '[]'::jsonb;
  v_clean     jsonb;
  v_existing  uuid;
  v_new       uuid;
  v_day       int;
  v_pair      int;
  v_inbox     int;
begin
  if me is null then return jsonb_build_object('status', 'not_signed_in'); end if;
  if p_recipient is null then return jsonb_build_object('status', 'invalid_payload', 'reason', 'recipient'); end if;
  if p_recipient = me then return jsonb_build_object('status', 'self'); end if;
  if not exists (select 1 from public.profiles where user_id = me) then
    return jsonb_build_object('status', 'no_profile');
  end if;
  if not public.loop_are_friends(me, p_recipient) then
    return jsonb_build_object('status', 'not_friends');
  end if;

  -- ---------------------------------------------------------------- shape --
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('status', 'invalid_payload', 'reason', 'shape');
  end if;
  if octet_length(p_payload::text) > 8192 then
    return jsonb_build_object('status', 'too_large');
  end if;
  for v_key in select jsonb_object_keys(p_payload) loop
    if v_key not in ('v', 'title', 'category', 'note', 'exercises') then
      return jsonb_build_object('status', 'invalid_payload', 'reason', 'unexpected_field');
    end if;
  end loop;
  if coalesce(jsonb_typeof(p_payload -> 'v'), '') <> 'number' or (p_payload ->> 'v') <> '1' then
    return jsonb_build_object('status', 'unsupported_version');
  end if;

  -- ---------------------------------------------------------------- title --
  if coalesce(jsonb_typeof(p_payload -> 'title'), '') <> 'string' then
    return jsonb_build_object('status', 'invalid_payload', 'reason', 'title');
  end if;
  v_title := btrim(regexp_replace(p_payload ->> 'title', '\s+', ' ', 'g'));
  if char_length(v_title) < 1 or char_length(v_title) > 60 or v_title ~ '[[:cntrl:]]' then
    return jsonb_build_object('status', 'invalid_payload', 'reason', 'title');
  end if;

  -- ------------------------------------------------------------- category --
  if coalesce(jsonb_typeof(p_payload -> 'category'), '') <> 'string'
     or (p_payload ->> 'category') not in ('push','pull','legs','upper','lower','core','fullbody','arms') then
    return jsonb_build_object('status', 'invalid_payload', 'reason', 'category');
  end if;
  v_category := p_payload ->> 'category';

  -- ----------------------------------------------------------------- note --
  -- Written by the sender at the moment of sharing. Optional, short, plain.
  if p_payload ? 'note' and jsonb_typeof(p_payload -> 'note') <> 'null' then
    if jsonb_typeof(p_payload -> 'note') <> 'string' then
      return jsonb_build_object('status', 'invalid_payload', 'reason', 'note');
    end if;
    v_note := btrim(p_payload ->> 'note');
    if char_length(v_note) > 280 or v_note ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' then
      return jsonb_build_object('status', 'invalid_payload', 'reason', 'note');
    end if;
    if v_note = '' then v_note := null; end if;
  end if;

  -- ------------------------------------------------------------ exercises --
  if coalesce(jsonb_typeof(p_payload -> 'exercises'), '') <> 'array' then
    return jsonb_build_object('status', 'invalid_payload', 'reason', 'exercises');
  end if;
  v_count := jsonb_array_length(p_payload -> 'exercises');
  if v_count < 1 or v_count > 20 then
    return jsonb_build_object('status', 'invalid_payload', 'reason', 'exercise_count');
  end if;

  for v_ex in
    select e.value from jsonb_array_elements(p_payload -> 'exercises') with ordinality as e(value, ord)
     order by e.ord
  loop
    if jsonb_typeof(v_ex) <> 'object' then
      return jsonb_build_object('status', 'invalid_payload', 'reason', 'exercise');
    end if;
    for v_key in select jsonb_object_keys(v_ex) loop
      if v_key not in ('id', 'name', 'sets', 'reps', 'effort') then
        return jsonb_build_object('status', 'invalid_payload', 'reason', 'unexpected_field');
      end if;
    end loop;

    if coalesce(jsonb_typeof(v_ex -> 'name'), '') <> 'string' then
      return jsonb_build_object('status', 'invalid_payload', 'reason', 'name');
    end if;
    v_name := btrim(regexp_replace(v_ex ->> 'name', '\s+', ' ', 'g'));
    if char_length(v_name) < 1 or char_length(v_name) > 60 or v_name ~ '[[:cntrl:]]' then
      return jsonb_build_object('status', 'invalid_payload', 'reason', 'name');
    end if;

    v_id := null;
    if v_ex ? 'id' and jsonb_typeof(v_ex -> 'id') <> 'null' then
      if jsonb_typeof(v_ex -> 'id') <> 'string' or (v_ex ->> 'id') !~ '^[a-z0-9_]{1,48}$' then
        return jsonb_build_object('status', 'invalid_payload', 'reason', 'id');
      end if;
      v_id := v_ex ->> 'id';
    end if;

    if coalesce(jsonb_typeof(v_ex -> 'sets'), '') <> 'number' or (v_ex ->> 'sets') !~ '^[0-9]{1,2}$' then
      return jsonb_build_object('status', 'invalid_payload', 'reason', 'sets');
    end if;
    v_sets := (v_ex ->> 'sets')::int;
    if v_sets < 1 or v_sets > 20 then
      return jsonb_build_object('status', 'invalid_payload', 'reason', 'sets');
    end if;

    if coalesce(jsonb_typeof(v_ex -> 'reps'), '') <> 'string' then
      return jsonb_build_object('status', 'invalid_payload', 'reason', 'reps');
    end if;
    v_reps := btrim(v_ex ->> 'reps');
    if char_length(v_reps) < 1 or char_length(v_reps) > 20 or v_reps ~ '[[:cntrl:]]' then
      return jsonb_build_object('status', 'invalid_payload', 'reason', 'reps');
    end if;

    v_effort := null;
    if v_ex ? 'effort' and jsonb_typeof(v_ex -> 'effort') <> 'null' then
      if jsonb_typeof(v_ex -> 'effort') <> 'string' then
        return jsonb_build_object('status', 'invalid_payload', 'reason', 'effort');
      end if;
      v_effort := btrim(v_ex ->> 'effort');
      if char_length(v_effort) > 12 or v_effort ~ '[[:cntrl:]]' then
        return jsonb_build_object('status', 'invalid_payload', 'reason', 'effort');
      end if;
      if v_effort = '' then v_effort := null; end if;
    end if;

    v_clean_ex := v_clean_ex || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'id', v_id, 'name', v_name, 'sets', v_sets, 'reps', v_reps, 'effort', v_effort)));
  end loop;

  v_clean := jsonb_strip_nulls(jsonb_build_object(
    'v', 1, 'title', v_title, 'category', v_category, 'note', v_note, 'exercises', v_clean_ex));

  -- One send at a time per sender, until this transaction ends: however many
  -- requests arrive at once, the duplicate check and every limit below count
  -- what is really there.
  perform pg_advisory_xact_lock(hashtextextended('loop_share_workout:' || me::text, 0));

  -- --------------------------------------------------------- housekeeping --
  delete from public.shared_workouts
   where recipient = p_recipient and created_at < now() - interval '30 days';
  delete from public.shared_workout_sends where sent_at < now() - interval '1 day';

  -- The same workout, still waiting in the same friend's inbox, is not sent a
  -- second time: a double tap or an unsure resend never becomes two copies.
  select id into v_existing from public.shared_workouts
   where sender = me and recipient = p_recipient and payload = v_clean
   limit 1;
  if v_existing is not null then
    return jsonb_build_object('status', 'already_sent', 'id', v_existing);
  end if;

  -- ---------------------------------------------------------- rate limits --
  -- Generous for anyone sharing with the people they train with; not enough to
  -- use this as storage or to flood a friend.
  select count(*) into v_day from public.shared_workout_sends
   where sender = me and sent_at > now() - interval '1 day';
  if v_day >= 30 then return jsonb_build_object('status', 'rate_limited'); end if;

  select count(*) into v_pair from public.shared_workout_sends
   where sender = me and recipient = p_recipient and sent_at > now() - interval '1 hour';
  if v_pair >= 10 then return jsonb_build_object('status', 'too_frequent'); end if;

  select count(*) into v_inbox from public.shared_workouts where recipient = p_recipient;
  if v_inbox >= 50 then return jsonb_build_object('status', 'inbox_full'); end if;

  insert into public.shared_workouts (sender, recipient, schema_version, title, category, exercise_count, payload)
  values (me, p_recipient, 1, v_title, v_category, v_count, v_clean)
  returning id into v_new;
  insert into public.shared_workout_sends (sender, recipient) values (me, p_recipient);

  return jsonb_build_object('status', 'sent', 'id', v_new);
end;
$$;

-- Open one share: the full snapshot, for its recipient only, and the moment it
-- counts as seen. A share already delivered stays readable after the two stop
-- being friends — it was sent while they were — but no new one can be.
create or replace function public.loop_open_shared_workout(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me  uuid := auth.uid();
  r   record;
begin
  if me is null then return jsonb_build_object('status', 'not_signed_in'); end if;
  if p_id is null then return jsonb_build_object('status', 'not_found'); end if;

  select s.id, s.schema_version, s.payload, s.created_at, s.viewed_at, p.username
    into r
    from public.shared_workouts s
    left join public.profiles p on p.user_id = s.sender
   where s.id = p_id and s.recipient = me;

  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if r.created_at < now() - interval '30 days' then
    delete from public.shared_workouts where id = p_id and recipient = me;
    return jsonb_build_object('status', 'expired');
  end if;
  if r.viewed_at is null then
    update public.shared_workouts set viewed_at = now() where id = p_id and recipient = me;
  end if;

  return jsonb_build_object('status', 'ok', 'id', r.id, 'from', r.username,
    'created_at', r.created_at, 'schema_version', r.schema_version, 'payload', r.payload);
end;
$$;

-- Remove one share from the recipient's inbox — after saving it, or to dismiss
-- it. The row is deleted; what the recipient saved lives on their phone.
create or replace function public.loop_remove_shared_workout(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  n  int;
begin
  if me is null then return jsonb_build_object('status', 'not_signed_in'); end if;
  delete from public.shared_workouts where id = p_id and recipient = me;
  get diagnostics n = row_count;
  return jsonb_build_object('status', case when n > 0 then 'removed' else 'not_found' end);
end;
$$;

-- THE FRIENDS SCREEN, STILL ONE QUERY. 0002's hub, plus a summary of the shares
-- waiting for this athlete: who, the title, the kind, how many exercises, when,
-- and whether it has been opened. Never the snapshot itself — that is fetched
-- only when the athlete opens one.
create or replace function public.loop_friends_hub(p_week date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me   uuid := auth.uid();
  prev date;
begin
  if me is null then return jsonb_build_object('status', 'not_signed_in'); end if;
  if p_week is null or extract(isodow from p_week) <> 1 then
    return jsonb_build_object('status', 'invalid_week');
  end if;
  prev := p_week - 7;

  return jsonb_build_object(
    'status', 'ok',
    'week', p_week,
    'profile', (select jsonb_build_object('username', p.username, 'invite_code', p.invite_code)
                  from public.profiles p where p.user_id = me),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', p.user_id,
               'username', p.username,
               'is_self', p.user_id = me,
               'level', coalesce(s.level, 1),
               'rank', coalesce(s.rank, 'ROOKIE'),
               'lifetime_xp', coalesce(s.lifetime_xp, 0),
               'stats_updated_at', s.updated_at,
               'week_xp', w.weekly_xp,
               'week_workouts', w.workouts,
               'week_updated_at', w.updated_at,
               'prev_xp', pw.weekly_xp,
               'prev_workouts', pw.workouts,
               'friends_since', f.created_at
             ) order by p.username_key)
        from (
          select me as uid
          union
          select case when fr.user_a = me then fr.user_b else fr.user_a end
            from public.friendships fr
           where fr.user_a = me or fr.user_b = me
        ) c
        join public.profiles p        on p.user_id = c.uid
        left join public.social_stats s   on s.user_id = c.uid
        left join public.social_weekly w  on w.user_id = c.uid and w.week_start = p_week
        left join public.social_weekly pw on pw.user_id = c.uid and pw.week_start = prev
        left join public.friendships f    on f.user_a = least(me, c.uid) and f.user_b = greatest(me, c.uid)
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'direction', case when r.from_user = me then 'outgoing' else 'incoming' end,
               'username', p.username,
               'created_at', r.created_at
             ) order by r.created_at)
        from public.friend_requests r
        join public.profiles p
          on p.user_id = case when r.from_user = me then r.to_user else r.from_user end
       where r.from_user = me or r.to_user = me
    ), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'expires_at', i.expires_at, 'uses', i.uses)
             order by i.created_at desc)
        from public.friend_invites i
       where i.inviter = me and i.revoked_at is null and i.expires_at > now() and i.uses < 20
    ), '[]'::jsonb),
    'shares', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id,
               'from', x.username,
               'title', x.title,
               'category', x.category,
               'exercises', x.exercise_count,
               'created_at', x.created_at,
               'viewed', x.viewed_at is not null
             ) order by x.created_at desc)
        from (
          select sw.id, p.username, sw.title, sw.category, sw.exercise_count, sw.created_at, sw.viewed_at
            from public.shared_workouts sw
            left join public.profiles p on p.user_id = sw.sender
           where sw.recipient = me and sw.created_at > now() - interval '30 days'
           order by sw.created_at desc
           limit 20
        ) x
    ), '[]'::jsonb)
  );
end;
$$;


-- =============================================================================
-- GRANTS
-- =============================================================================
-- The same three lessons as 0001 and 0002: Supabase's default privileges grant
-- ALL on new tables and functions to anon and authenticated, and PostgreSQL
-- grants EXECUTE to PUBLIC besides — so every holding is revoked by name and
-- exactly what an authenticated session needs is granted back.
revoke all on table public.shared_workouts      from public, anon, authenticated;
revoke all on table public.shared_workout_sends from public, anon, authenticated;

revoke execute on function public.loop_shared_workouts_guard()          from public, anon, authenticated;
revoke execute on function public.loop_share_workout(uuid, jsonb)       from public, anon;
revoke execute on function public.loop_open_shared_workout(uuid)        from public, anon;
revoke execute on function public.loop_remove_shared_workout(uuid)      from public, anon;
revoke execute on function public.loop_friends_hub(date)                from public, anon;

grant execute on function public.loop_share_workout(uuid, jsonb)        to authenticated;
grant execute on function public.loop_open_shared_workout(uuid)         to authenticated;
grant execute on function public.loop_remove_shared_workout(uuid)       to authenticated;
grant execute on function public.loop_friends_hub(date)                 to authenticated;

-- =============================================================================
-- LOOP — D81 SHARED WORKOUT IDENTITY
-- =============================================================================
-- A workout in LOOP 8.2 can have an icon and a colour its athlete chose. When
-- they share it, those two choices may travel with it — as two registry ids,
-- { iconId, colorId }, and nothing else: never artwork, never a colour value,
-- never anything about how the workout was trained.
--
-- This is snapshot version 2: version 1 plus an optional `identity`. Everything
-- 0003 promises still holds, unchanged — friends only, every field checked, the
-- stored snapshot rebuilt from the checked values, immutable after send, the
-- same limits — because loop_share_workout below is 0003's function with only
-- the version handling and the identity check added.
--
-- Compatibility, in both directions:
--   * LOOP sends version 2 only for a workout with a chosen icon or colour.
--     Until this file is applied, the server refuses version 2, and LOOP sends
--     the same workout again as version 1, without its look.
--   * LOOP 8.1 opening a version-2 share says it came from a newer LOOP and
--     asks to update, rather than guessing.
--
-- It also replaces loop_friends_hub: 0003's, with one addition. Each share in
-- Shared with you carries its two ids beside its title, so LOOP can show the
-- workout's icon without opening the share (opening marks it seen). The ids are
-- rebuilt from the stored, already-checked snapshot; nothing else of it leaves.
--
-- Requires 0003. Safe to run twice. If 0002 or 0003 is ever run again, run this
-- after them.
--
-- Apply with:  supabase db push       (or paste into the SQL editor)
-- =============================================================================

-- A version this server does not understand is still never stored; the list of
-- versions it does understand is now two long.
alter table public.shared_workouts drop constraint if exists shared_workouts_version_known;
alter table public.shared_workouts add constraint shared_workouts_version_known check (schema_version in (1, 2));

-- Send one workout to one friend — 0003's function, taking version 1 or 2.
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
  v_version   int;
  v_identity  jsonb;
  v_icon      text;
  v_color     text;
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
  -- Version 2 (D81) is version 1 plus the icon and colour its sender chose.
  v_version := case when coalesce(jsonb_typeof(p_payload -> 'v'), '') = 'number' and (p_payload ->> 'v') in ('1', '2')
                    then (p_payload ->> 'v')::int else 0 end;
  for v_key in select jsonb_object_keys(p_payload) loop
    if v_key not in ('v', 'title', 'category', 'note', 'exercises', 'identity')
       or (v_key = 'identity' and v_version < 2) then
      return jsonb_build_object('status', 'invalid_payload', 'reason', 'unexpected_field');
    end if;
  end loop;
  if v_version = 0 then
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

  -- ------------------------------------------------------------- identity --
  -- Presentation only: at most two registry ids, never artwork or a colour
  -- value. An id is checked for shape, not against a list, so a newer LOOP's
  -- icon is kept and an older LOOP draws its own default in its place.
  if v_version = 2 and p_payload ? 'identity' and jsonb_typeof(p_payload -> 'identity') <> 'null' then
    v_identity := p_payload -> 'identity';
    if jsonb_typeof(v_identity) <> 'object' then
      return jsonb_build_object('status', 'invalid_payload', 'reason', 'identity');
    end if;
    for v_key in select jsonb_object_keys(v_identity) loop
      if v_key not in ('iconId', 'colorId') then
        return jsonb_build_object('status', 'invalid_payload', 'reason', 'unexpected_field');
      end if;
    end loop;
    if v_identity ? 'iconId' and jsonb_typeof(v_identity -> 'iconId') <> 'null' then
      if jsonb_typeof(v_identity -> 'iconId') <> 'string' or (v_identity ->> 'iconId') !~ '^[a-z0-9_]{1,24}$' then
        return jsonb_build_object('status', 'invalid_payload', 'reason', 'identity');
      end if;
      v_icon := v_identity ->> 'iconId';
    end if;
    if v_identity ? 'colorId' and jsonb_typeof(v_identity -> 'colorId') <> 'null' then
      if jsonb_typeof(v_identity -> 'colorId') <> 'string' or (v_identity ->> 'colorId') !~ '^[a-z0-9_]{1,24}$' then
        return jsonb_build_object('status', 'invalid_payload', 'reason', 'identity');
      end if;
      v_color := v_identity ->> 'colorId';
    end if;
  end if;
  v_identity := case when v_icon is null and v_color is null then null
                     else jsonb_strip_nulls(jsonb_build_object('iconId', v_icon, 'colorId', v_color)) end;

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
    'v', v_version, 'title', v_title, 'category', v_category, 'note', v_note, 'identity', v_identity,
    'exercises', v_clean_ex));

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
  values (me, p_recipient, v_version, v_title, v_category, v_count, v_clean)
  returning id into v_new;
  insert into public.shared_workout_sends (sender, recipient) values (me, p_recipient);

  return jsonb_build_object('status', 'sent', 'id', v_new);
end;
$$;

-- The Friends hub — 0003's, with each shared workout's icon and colour ids.
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
             ) || case when jsonb_typeof(x.identity) = 'object' and (x.identity ? 'iconId' or x.identity ? 'colorId')
                  then jsonb_build_object('identity', jsonb_strip_nulls(jsonb_build_object(
                         'iconId', x.identity ->> 'iconId', 'colorId', x.identity ->> 'colorId')))
                  else '{}'::jsonb end
             order by x.created_at desc)
        from (
          select sw.id, p.username, sw.title, sw.category, sw.exercise_count, sw.created_at, sw.viewed_at,
                 sw.payload -> 'identity' as identity
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
-- Replacing a function keeps its grants, and they are stated again anyway, so
-- this file alone leaves the function exactly as locked down as 0003 did.
revoke execute on function public.loop_share_workout(uuid, jsonb) from public, anon;
grant execute on function public.loop_share_workout(uuid, jsonb) to authenticated;
revoke execute on function public.loop_friends_hub(date) from public, anon;
grant execute on function public.loop_friends_hub(date) to authenticated;

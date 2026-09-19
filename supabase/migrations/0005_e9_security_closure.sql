-- =============================================================================
-- LOOP — D95 SECURITY CLOSURE (D88 FINDING E9)
-- =============================================================================
-- The publishable key in the app is public by design and is not a boundary.
-- These are the places where the DATABASE, not the UI, still said yes to
-- something it should not have:
--
--   E9-A  profiles_select let a friend, and anyone with a pending request to or
--         from you, read your whole profile row — including invite_code, a
--         reusable capability. Now a profile row is readable by its owner only;
--         everything a friend legitimately sees (a username, a level) already
--         comes through the SECURITY DEFINER functions, which are unchanged.
--
--   E9-B  0001 revoked table privileges from anon but left Supabase's default
--         GRANT ALL on authenticated, so profiles, social_stats, friend_requests
--         and friendships carried TRUNCATE, REFERENCES, TRIGGER, DELETE and
--         more than nothing of INSERT/UPDATE that no policy ever used. TRUNCATE
--         is not subject to row level security at all. Every table is now
--         revoked from everyone and granted back exactly what the app does.
--         profiles is granted by COLUMN: a client can set its username, never
--         choose or change its invite_code, id or timestamps.
--
--   E9-C  loop_new_invite_code() built the code from random(), which is not a
--         cryptographic source and, behind a connection pool, shares state
--         between callers. It now draws from gen_random_uuid() (the same
--         CSPRNG the 244-bit invite links use), with rejection sampling so every
--         character is exactly uniform. Codes already issued came from the old
--         generator, so they are issued again once (see the marker below).
--         Eight characters of a 31-symbol alphabet is 39.6 bits: adequate as an
--         unguessable code only if guessing is throttled, so it now is — 20
--         wrong codes an hour per athlete, across both functions that take one.
--
--   E9-D  loop_are_friends(a, b) and loop_request_between(a, b) answered for ANY
--         two UUIDs — "are these two strangers friends?", "is there a request
--         between them?". Both now answer only about the caller: if the caller
--         is neither a nor b the answer is false. loop_request_between is no
--         longer used by any policy, so it is no longer executable at all.
--
-- What does NOT change: no function signature, no return shape a client reads
-- (loop_send_friend_request gains one status, 'rate_limited'), no policy other
-- than profiles_select, no data except invite codes, once. LOOP needs no update:
-- every request the app makes is still allowed, checked against this file.
--
-- Requires 0001 and 0002; safe with or without 0003/0004. Safe to run twice.
-- If 0001 is ever run again, run this file again after it: 0001 replaces the
-- functions and the policy changed here.
--
-- Apply with:  supabase db push       (or paste into the SQL editor)
-- =============================================================================


-- =============================================================================
-- E9-C — INVITE CODES FROM A CRYPTOGRAPHIC SOURCE
-- =============================================================================
-- 8 characters, 31-symbol alphabet with no O/0/I/1/L (read aloud, typed in):
-- 31^8 = 8.5e11 codes, 39.6 bits. Bytes come from gen_random_uuid() — 16 bytes
-- per call, of which byte 6 (version) and byte 8 (variant) are not random and
-- are skipped. A byte is used only when it is below 248 (= 8 x 31), so that
-- `byte mod 31` is uniform over the alphabet: no modulo bias. Uniqueness is the
-- profiles_invite_code_unique constraint; loop_rotate_invite_code retries on a
-- collision, and a collision at first insert is refused (23505) rather than
-- stored twice.
create or replace function public.loop_new_invite_code()
returns text
language plpgsql
volatile
set search_path = pg_catalog
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  code text := '';
  raw  bytea;
  i    int;
  b    int;
begin
  while length(code) < 8 loop
    raw := uuid_send(gen_random_uuid());
    for i in 0..15 loop
      continue when i in (6, 8);
      b := get_byte(raw, i);
      continue when b >= 248;
      code := code || substr(alphabet, 1 + (b % 31), 1);
      exit when length(code) = 8;
    end loop;
  end loop;
  return code;
end;
$$;


-- =============================================================================
-- E9-C — GUESSING A CODE IS RATE-LIMITED
-- =============================================================================
-- One row per WRONG code an athlete tried, kept an hour. RLS on, no policy, no
-- grant: only the two functions below touch it. A right code, or the athlete's
-- own, costs nothing.
create table if not exists public.invite_code_misses (
  user_id   uuid not null references public.profiles(user_id) on delete cascade,
  missed_at timestamptz not null default now()
);
create index if not exists invite_code_misses_user_idx
  on public.invite_code_misses(user_id, missed_at desc);
alter table public.invite_code_misses enable row level security;
revoke all on table public.invite_code_misses from public, anon, authenticated;

-- Look up an invite code before acting on it: a USERNAME AND NOTHING ELSE, and
-- only for the person who holds the code. A wrong code, the athlete's own code,
-- and a throttled athlete all return the same thing — no rows — so the answer
-- says nothing about which codes exist.
create or replace function public.loop_preview_invite(code text)
returns table (username text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me      uuid := auth.uid();
  clean   text := upper(trim(code));
  v_owner uuid;
  misses  int;
begin
  if me is null then return; end if;

  perform pg_advisory_xact_lock(hashtextextended('loop_code_guess:' || me::text, 0));
  delete from public.invite_code_misses m
   where m.user_id = me and m.missed_at < now() - interval '1 hour';
  select count(*) into misses from public.invite_code_misses m where m.user_id = me;
  if misses >= 20 then return; end if;

  select p.user_id into v_owner from public.profiles p where p.invite_code = clean;
  if v_owner is null then
    insert into public.invite_code_misses (user_id) values (me);
    return;
  end if;
  if v_owner = me then return; end if;

  return query select p.username from public.profiles p where p.user_id = v_owner;
end;
$$;

-- Send a request, by invite code — 0001's function, with the same throttle
-- ahead of the lookup, so a throttled athlete learns nothing about the code.
create or replace function public.loop_send_friend_request(code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me     uuid := auth.uid();
  target uuid;
  pending int;
  misses int;
begin
  if me is null then return 'not_signed_in'; end if;

  perform pg_advisory_xact_lock(hashtextextended('loop_code_guess:' || me::text, 0));
  delete from public.invite_code_misses m
   where m.user_id = me and m.missed_at < now() - interval '1 hour';
  select count(*) into misses from public.invite_code_misses m where m.user_id = me;
  if misses >= 20 then return 'rate_limited'; end if;

  select user_id into target from public.profiles
  where invite_code = upper(trim(code));

  if target is null then
    insert into public.invite_code_misses (user_id) values (me);
    return 'invalid_code';
  end if;
  if target = me   then return 'self'; end if;

  if public.loop_are_friends(me, target) then return 'already_friends'; end if;

  -- They invited me first: accept rather than mirror it.
  if exists (select 1 from public.friend_requests
             where from_user = target and to_user = me) then
    insert into public.friendships (user_a, user_b)
    values (least(me, target), greatest(me, target))
    on conflict do nothing;
    delete from public.friend_requests
    where (from_user = target and to_user = me)
       or (from_user = me and to_user = target);
    return 'accepted';
  end if;

  if exists (select 1 from public.friend_requests
             where from_user = me and to_user = target) then
    return 'already_pending';
  end if;

  select count(*) into pending from public.friend_requests where from_user = me;
  if pending >= 25 then return 'too_many_pending'; end if;

  insert into public.friend_requests (from_user, to_user) values (me, target);
  return 'sent';
end;
$$;


-- =============================================================================
-- E9-D — THE TWO UUID ORACLES ANSWER ONLY ABOUT THE CALLER
-- =============================================================================
-- Every legitimate call already has the caller as one of the two: the policies
-- pass (row owner, auth.uid()), and the functions pass (me, someone). A caller
-- who is neither gets false, exactly as if there were no such relationship.
create or replace function public.loop_are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and auth.uid() in (a, b)
     and exists (
       select 1 from public.friendships f
       where f.user_a = least(a, b) and f.user_b = greatest(a, b)
     );
$$;

create or replace function public.loop_request_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and auth.uid() in (a, b)
     and exists (
       select 1 from public.friend_requests r
       where (r.from_user = a and r.to_user = b)
          or (r.from_user = b and r.to_user = a)
     );
$$;


-- =============================================================================
-- E9-A — A PROFILE ROW IS ITS OWNER'S
-- =============================================================================
-- 0001 also let a friend, or anyone mid-invite, SELECT the row. The client never
-- reads anyone else's profile that way — a friend's or a requester's username
-- comes through loop_friends_hub / loop_my_requests / loop_friends_leaderboard /
-- the preview functions, which are SECURITY DEFINER and are unchanged — so the
-- policy is simply the owner.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (user_id = auth.uid());


-- =============================================================================
-- E9-B — GRANTS: REVOKE EVERYTHING, GRANT BACK WHAT THE APP DOES
-- =============================================================================
-- Supabase's default privileges grant ALL on every new table to anon and
-- authenticated, and 0001 only took it back from anon. Each holding is revoked
-- by name, then exactly this is granted to authenticated:
--
--   profiles         SELECT (own row, by policy); INSERT (user_id, username,
--                    username_key); UPDATE (username, username_key). Never
--                    invite_code, created_at or updated_at, never DELETE
--                    (loop_delete_account does that).
--   social_stats     SELECT, INSERT, UPDATE  (the app upserts its own row)
--   social_weekly    SELECT, INSERT, UPDATE  (unchanged from 0002)
--   friend_requests  SELECT, DELETE          (decline and cancel)
--   friendships      SELECT, DELETE          (unchanged in effect; own rows only)
--
-- Whatever a policy has no rule for stays denied, and now stays un-granted too:
-- TRUNCATE, REFERENCES and TRIGGER on all four were held and used by nothing.
revoke all on table public.profiles, public.social_stats, public.social_weekly,
                    public.friend_requests, public.friendships, public.friend_invites
  from public, anon, authenticated;

grant select on table public.profiles to authenticated;
grant insert (user_id, username, username_key) on table public.profiles to authenticated;
grant update (username, username_key)           on table public.profiles to authenticated;
grant select, insert, update on table public.social_stats  to authenticated;
grant select, insert, update on table public.social_weekly to authenticated;
grant select, delete on table public.friend_requests to authenticated;
grant select, delete on table public.friendships     to authenticated;

-- 0003's tables, when 0003 is applied: no policy, no grant, restated.
do $$
begin
  if to_regclass('public.shared_workouts') is not null then
    execute 'revoke all on table public.shared_workouts from public, anon, authenticated';
  end if;
  if to_regclass('public.shared_workout_sends') is not null then
    execute 'revoke all on table public.shared_workout_sends from public, anon, authenticated';
  end if;
end $$;

-- FUNCTIONS. Trigger functions are checked for EXECUTE when a trigger is
-- CREATED, never when it fires, so no role needs them. loop_request_between is
-- no longer used by any policy. The two functions rewritten above keep their
-- grants, restated here so this file alone states the whole picture.
revoke execute on function public.loop_request_between(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.loop_touch_updated_at()          from public, anon, authenticated;
revoke execute on function public.loop_profiles_guard()            from public, anon, authenticated;

revoke execute on function public.loop_preview_invite(text)      from public, anon;
revoke execute on function public.loop_send_friend_request(text) from public, anon;
revoke execute on function public.loop_are_friends(uuid, uuid)   from public, anon;
revoke execute on function public.loop_new_invite_code()         from public, anon;
grant execute on function public.loop_preview_invite(text)      to authenticated;
grant execute on function public.loop_send_friend_request(text) to authenticated;
-- Still required, and now harmless: policies (loop_are_friends) and the column
-- DEFAULT (loop_new_invite_code) are evaluated as the calling role.
grant execute on function public.loop_are_friends(uuid, uuid)   to authenticated;
grant execute on function public.loop_new_invite_code()         to authenticated;


-- =============================================================================
-- E9-C — CODES ALREADY ISSUED CAME FROM THE OLD GENERATOR
-- =============================================================================
-- Once, and only once: the marker on the function says it has been done, so
-- running this file again re-issues nothing. Nobody sees or types a code in the
-- app any more (invite LINKS are what is shared), so this changes nothing an
-- athlete does; it only retires codes that a predictable generator made.
do $$
declare
  r record;
begin
  if coalesce(obj_description('public.loop_new_invite_code()'::regprocedure, 'pg_proc'), '') <> 'csprng-v1' then
    perform set_config('loop.allow_code_rotation', 'on', true);
    for r in select user_id from public.profiles loop
      loop
        begin
          update public.profiles set invite_code = public.loop_new_invite_code() where user_id = r.user_id;
          exit;
        exception when unique_violation then
          null;   -- vanishingly unlikely; draw again
        end;
      end loop;
    end loop;
    comment on function public.loop_new_invite_code() is 'csprng-v1';
  end if;
end $$;

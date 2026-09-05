-- =============================================================================
-- LOOP — D52 SOCIAL FOUNDATION
-- =============================================================================
-- LOOP's first trust boundary. Everything above this line in the product is
-- local-first: workouts, programs, PRs, XP and settings live on the device and
-- never leave it. This schema holds the only things that must be shared for a
-- private friends leaderboard to exist:
--
--     who you are to your friends   (a username)
--     who your friends are          (accepted, mutual)
--     what you have earned          (XP, level, rank — already public to a friend)
--
-- It deliberately holds nothing else. No workouts, no exercises, no loads, no
-- RIR, no bodyweight, no readiness, no programs, no notes.
--
-- SECURITY LIVES HERE, NOT IN THE UI. Every table denies by default and is
-- opened by explicit policy. The two operations that must be atomic — sending
-- and accepting a request — are SECURITY DEFINER functions, so a client can
-- never produce half a friendship or a duplicate one.
--
-- Apply with:  supabase db push       (or paste into the SQL editor)
-- =============================================================================

-- Random, non-enumerable invite codes. 8 characters from an unambiguous
-- alphabet — no O/0, no I/1/l — because these get read aloud and typed in.
-- 32^8 is ~1.1e12, so guessing is not a strategy, and the code is generated
-- rather than derived from the user id or email.
create or replace function public.loop_new_invite_code()
returns text
language plpgsql
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  out text := '';
  i int;
begin
  for i in 1..8 loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end;
$$;


-- =============================================================================
-- PROFILES — the social identity, and nothing more
-- =============================================================================
-- Email is NOT here. It lives in auth.users, which no client policy exposes.
-- A friend sees a username; they never see an address.
create table if not exists public.profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  -- What the athlete typed, capitalisation preserved for display.
  username      text not null,
  -- The same name folded for comparison. Uniqueness is enforced HERE, so
  -- @Cobra and @cobra can never become two accounts.
  username_key  text not null,
  -- Rotatable independently of the username, and never derived from either the
  -- user id or the email.
  invite_code   text not null default public.loop_new_invite_code(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint profiles_username_key_unique unique (username_key),
  constraint profiles_invite_code_unique  unique (invite_code),
  -- 3–20 characters, letters, numbers and underscore. Anchored, so no
  -- whitespace, no invisible characters, and no email address can pass.
  constraint profiles_username_shape check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  constraint profiles_username_key_folded check (username_key = lower(username)),
  -- A small reserved list. Not moderation — just names that would let an
  -- account impersonate the product itself.
  constraint profiles_username_reserved check (
    username_key not in ('loop','admin','administrator','support','moderator',
                         'mod','staff','help','system','root','official','null','undefined')
  )
);

-- =============================================================================
-- SOCIAL STATS — the published snapshot of progression the athlete already has
-- =============================================================================
-- LOOP's local XP remains the source of truth. This is a published
-- representation of it, not a second progression system: there is no social
-- score and no separate rules. rules_version records which progression the
-- numbers were produced by, so a stale row is never silently reinterpreted.
create table if not exists public.social_stats (
  user_id       uuid primary key references public.profiles(user_id) on delete cascade,
  lifetime_xp   bigint not null default 0,
  level         integer not null default 1,
  rank          text not null default 'ROOKIE',
  rules_version text not null default 'unknown',
  updated_at    timestamptz not null default now(),

  constraint social_stats_xp_nonneg check (lifetime_xp >= 0),
  constraint social_stats_level_sane check (level >= 1 and level <= 999)
);

-- =============================================================================
-- FRIEND REQUESTS — directed, and only ever pending
-- =============================================================================
-- An accepted request becomes a friendship and the request row is gone, so
-- "pending" is the absence of a decision rather than a status column that can
-- drift out of step with the friendship table.
create table if not exists public.friend_requests (
  id         uuid primary key default gen_random_uuid(),
  from_user  uuid not null references public.profiles(user_id) on delete cascade,
  to_user    uuid not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),

  constraint friend_requests_not_self check (from_user <> to_user),
  constraint friend_requests_unique unique (from_user, to_user)
);
create index if not exists friend_requests_to_user_idx on public.friend_requests(to_user);

-- =============================================================================
-- FRIENDSHIPS — undirected, stored once
-- =============================================================================
-- The pair is always ordered, so A→B and B→A are the same row and the primary
-- key makes a duplicate friendship structurally impossible rather than a thing
-- the application has to remember not to create.
create table if not exists public.friendships (
  user_a     uuid not null references public.profiles(user_id) on delete cascade,
  user_b     uuid not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),

  primary key (user_a, user_b),
  constraint friendships_ordered check (user_a < user_b)
);
create index if not exists friendships_user_b_idx on public.friendships(user_b);


-- =============================================================================
-- HELPERS
-- =============================================================================
-- Are these two accounts friends? Used by policies, so it is STABLE and
-- SECURITY DEFINER: a policy that had to read friendships through the caller's
-- own policies would recurse.
create or replace function public.loop_are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
    where f.user_a = least(a, b) and f.user_b = greatest(a, b)
  );
$$;

-- Is there a request between these two, in either direction? A pending request
-- is the one situation where two strangers legitimately need to see each
-- other's username, so that an invite can be shown and answered.
create or replace function public.loop_request_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friend_requests r
    where (r.from_user = a and r.to_user = b)
       or (r.from_user = b and r.to_user = a)
  );
$$;

create or replace function public.loop_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.loop_touch_updated_at();

drop trigger if exists social_stats_touch on public.social_stats;
create trigger social_stats_touch before update on public.social_stats
  for each row execute function public.loop_touch_updated_at();

-- The two fields a client must never move. user_id is identity and invite_code
-- is a capability; letting an UPDATE reach either would turn "change my
-- username" into "become someone else" or "claim someone's invite".
create or replace function public.loop_profiles_guard()
returns trigger language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id is immutable';
  end if;
  if new.invite_code is distinct from old.invite_code
     and current_setting('loop.allow_code_rotation', true) is distinct from 'on' then
    raise exception 'invite_code is rotated through loop_rotate_invite_code()';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.loop_profiles_guard();


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
-- Enabled on every table with no permissive fallback. Anything not named by a
-- policy below is denied.
alter table public.profiles        enable row level security;
alter table public.social_stats    enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships     enable row level security;

-- ---------------------------------------------------------------- profiles --
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    user_id = auth.uid()                                  -- myself
    or public.loop_are_friends(user_id, auth.uid())       -- an accepted friend
    or public.loop_request_between(user_id, auth.uid())   -- someone mid-invite
  );

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Deliberately no delete policy: account removal goes through
-- loop_delete_account(), which takes the whole graph down together.

-- ------------------------------------------------------------ social_stats --
drop policy if exists social_stats_select on public.social_stats;
create policy social_stats_select on public.social_stats
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.loop_are_friends(user_id, auth.uid())
  );
-- A pending invite shows a username and nothing else. Progression is not
-- visible until the connection is mutual.

drop policy if exists social_stats_insert on public.social_stats;
create policy social_stats_insert on public.social_stats
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists social_stats_update on public.social_stats;
create policy social_stats_update on public.social_stats
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- --------------------------------------------------------- friend_requests --
drop policy if exists friend_requests_select on public.friend_requests;
create policy friend_requests_select on public.friend_requests
  for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());

-- Requests are created through send_friend_request(), which resolves an invite
-- code and handles the reciprocal case atomically. No direct insert.

drop policy if exists friend_requests_delete on public.friend_requests;
create policy friend_requests_delete on public.friend_requests
  for delete to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());   -- cancel or decline

-- ------------------------------------------------------------- friendships --
drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships
  for select to authenticated
  using (user_a = auth.uid() or user_b = auth.uid());

-- No insert policy at all. A friendship can only come from
-- accept_friend_request(), which is the only thing that can produce one.

drop policy if exists friendships_delete on public.friendships;
create policy friendships_delete on public.friendships
  for delete to authenticated
  using (user_a = auth.uid() or user_b = auth.uid());


-- =============================================================================
-- OPERATIONS
-- =============================================================================

-- Look up an invite before acting on it. Returns a USERNAME AND NOTHING ELSE —
-- no email, no progression, no user id. Enumeration is not a concern here
-- because the input is an 8-character random code, not a username, and there
-- is no endpoint anywhere that lists or searches usernames.
create or replace function public.loop_preview_invite(code text)
returns table (username text)
language sql
stable
security definer
set search_path = public
as $$
  select p.username
  from public.profiles p
  where p.invite_code = upper(trim(code))
    and p.user_id <> auth.uid()
  limit 1;
$$;

-- Send a request, by invite code.
--
-- Atomic, and it collapses the race the brief names: if the other athlete has
-- already invited ME, this accepts instead of creating a mirrored second
-- request. Two people inviting each other end with one clean friendship.
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
begin
  if me is null then return 'not_signed_in'; end if;

  select user_id into target from public.profiles
  where invite_code = upper(trim(code));

  if target is null then return 'invalid_code'; end if;
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

  -- A ceiling rather than a moderation system: enough for anyone training with
  -- people they know, and not enough to spam with.
  select count(*) into pending from public.friend_requests where from_user = me;
  if pending >= 25 then return 'too_many_pending'; end if;

  insert into public.friend_requests (from_user, to_user) values (me, target);
  return 'sent';
end;
$$;

-- Accept a request addressed to me. One statement block: the friendship
-- appears and the request disappears together, so there is no window in which
-- a half-accepted state exists.
create or replace function public.loop_accept_friend_request(request_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me   uuid := auth.uid();
  frm  uuid;
begin
  if me is null then return 'not_signed_in'; end if;

  select from_user into frm from public.friend_requests
  where id = request_id and to_user = me;      -- only the RECIPIENT may accept

  if frm is null then return 'not_found'; end if;

  insert into public.friendships (user_a, user_b)
  values (least(me, frm), greatest(me, frm))
  on conflict do nothing;

  delete from public.friend_requests
  where (from_user = frm and to_user = me) or (from_user = me and to_user = frm);

  return 'accepted';
end;
$$;

-- The leaderboard: me plus my accepted friends, with the progression each of us
-- has published. One query rather than a profile-then-stats round trip per
-- friend. Ordering is decided by the client so that a tie breaks the same way
-- on every device, but the data comes back together.
create or replace function public.loop_friends_leaderboard()
returns table (
  user_id     uuid,
  username    text,
  lifetime_xp bigint,
  level       integer,
  rank        text,
  updated_at  timestamptz,
  is_self     boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as id),
  circle as (
    select (select id from me) as uid
    union
    select case when f.user_a = (select id from me) then f.user_b else f.user_a end
    from public.friendships f
    where f.user_a = (select id from me) or f.user_b = (select id from me)
  )
  select p.user_id,
         p.username,
         coalesce(s.lifetime_xp, 0),
         coalesce(s.level, 1),
         coalesce(s.rank, 'ROOKIE'),
         s.updated_at,
         p.user_id = (select id from me)
  from circle c
  join public.profiles p on p.user_id = c.uid
  left join public.social_stats s on s.user_id = c.uid;
$$;

-- Requests I am party to, with the other athlete's username attached, in one
-- call. Direction is explicit so the client never has to guess.
create or replace function public.loop_my_requests()
returns table (
  id         uuid,
  direction  text,
  username   text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id,
         case when r.from_user = auth.uid() then 'outgoing' else 'incoming' end,
         p.username,
         r.created_at
  from public.friend_requests r
  join public.profiles p
    on p.user_id = case when r.from_user = auth.uid() then r.to_user else r.from_user end
  where r.from_user = auth.uid() or r.to_user = auth.uid();
$$;

-- Remove a friendship from either side.
create or replace function public.loop_remove_friend(other uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare me uuid := auth.uid();
begin
  if me is null then return 'not_signed_in'; end if;
  delete from public.friendships
  where user_a = least(me, other) and user_b = greatest(me, other);
  return 'removed';
end;
$$;

-- A new invite code, for an athlete who has shared theirs too widely.
create or replace function public.loop_rotate_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare me uuid := auth.uid(); code text;
begin
  if me is null then return null; end if;
  perform set_config('loop.allow_code_rotation', 'on', true);
  loop
    code := public.loop_new_invite_code();
    begin
      update public.profiles set invite_code = code where user_id = me;
      exit;
    exception when unique_violation then
      -- vanishingly unlikely; try again rather than fail the athlete
    end;
  end loop;
  return code;
end;
$$;

-- Remove the social account. Takes the whole graph with it — profile, stats,
-- requests in both directions, friendships on both sides. It does not and
-- cannot touch anything on the athlete's device: their training lives there,
-- not here.
create or replace function public.loop_delete_account()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare me uuid := auth.uid();
begin
  if me is null then return 'not_signed_in'; end if;
  delete from public.friendships where user_a = me or user_b = me;
  delete from public.friend_requests where from_user = me or to_user = me;
  delete from public.social_stats where user_id = me;
  delete from public.profiles where user_id = me;
  return 'deleted';
end;
$$;


-- =============================================================================
-- GRANTS
-- =============================================================================
-- anon gets nothing at all. Every table is reached by an authenticated session
-- through the policies above, and the functions are the only way to write a
-- request or a friendship.
revoke all on public.profiles, public.social_stats,
              public.friend_requests, public.friendships from anon;

grant select, insert, update on public.profiles     to authenticated;
grant select, insert, update on public.social_stats to authenticated;
grant select, delete         on public.friend_requests to authenticated;
grant select, delete         on public.friendships    to authenticated;

grant execute on function public.loop_preview_invite(text)        to authenticated;
grant execute on function public.loop_send_friend_request(text)   to authenticated;
grant execute on function public.loop_accept_friend_request(uuid) to authenticated;
grant execute on function public.loop_friends_leaderboard()       to authenticated;
grant execute on function public.loop_my_requests()               to authenticated;
grant execute on function public.loop_remove_friend(uuid)         to authenticated;
grant execute on function public.loop_rotate_invite_code()        to authenticated;
grant execute on function public.loop_delete_account()            to authenticated;

revoke execute on function public.loop_new_invite_code() from anon, authenticated;
revoke execute on function public.loop_are_friends(uuid, uuid) from anon, authenticated;
revoke execute on function public.loop_request_between(uuid, uuid) from anon, authenticated;

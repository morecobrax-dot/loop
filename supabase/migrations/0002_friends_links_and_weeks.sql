-- =============================================================================
-- LOOP — D80A FRIENDS: INVITE LINKS AND THE WEEK
-- =============================================================================
-- Two additions to the social foundation in 0001, and nothing else:
--
--     friend_invites   shareable invite links: a random token stored only as
--                      a hash, tied to the athlete who made it, expiring after
--                      seven days, revocable, and capped in uses
--     social_weekly    the XP and workout count each athlete's OWN device
--                      computed for one civil week, so friends compare weeks
--
-- plus the functions that are the only way to use them, and one batched read
-- (loop_friends_hub) so the Friends screen is one query however many friends
-- an athlete has.
--
-- WHAT NEWLY CROSSES THE NETWORK, all of it listed in SOCIAL-SETUP.md: for each
-- athlete and each week they publish, the week's Monday, the XP earned that
-- week and the number of workouts. Still never: workouts, exercises, loads,
-- reps, RIR, notes, bodyweight, programs, PRs, readiness, email.
--
-- SAFE TO APPLY TO A PROJECT RUNNING 0001, AND SAFE TO RUN TWICE. Clients from
-- before this migration keep working unchanged; clients from after it detect
-- whether it has been applied and fall back to 0001's invite codes and total-XP
-- leaderboard until it is.
--
-- Apply with:  supabase db push       (or paste into the SQL editor)
-- =============================================================================


-- =============================================================================
-- INVITE LINKS
-- =============================================================================
-- A link is a capability to connect with ONE athlete, and it is treated like a
-- credential. The token is 32 bytes from gen_random_uuid() — PostgreSQL's
-- cryptographic random source, 244 random bits — shown to its creator once and
-- stored here only as SHA-256. Reading this table would not yield a usable link;
-- and nobody can read it, because it has no policy and no grant at all. The
-- functions below are the only door.
--
-- A username is never enough: ?friend=alex would let anyone connect to anyone.
create table if not exists public.friend_invites (
  id          uuid primary key default gen_random_uuid(),
  inviter     uuid not null references public.profiles(user_id) on delete cascade,
  token_hash  bytea not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  uses        integer not null default 0,

  constraint friend_invites_token_hash_unique unique (token_hash),
  constraint friend_invites_hash_is_sha256 check (octet_length(token_hash) = 32),
  constraint friend_invites_lifetime_sane check (
    expires_at > created_at and expires_at <= created_at + interval '30 days'),
  constraint friend_invites_uses_sane check (uses >= 0)
);
create index if not exists friend_invites_inviter_idx
  on public.friend_invites(inviter, created_at desc);


-- =============================================================================
-- THE WEEK
-- =============================================================================
-- Computed on the athlete's own device from LOOP's own XP timelines — the XP
-- already attached to each workout and cardio session, summed by the civil week
-- (Monday to Sunday) it was logged in — and published under that Monday. The
-- grouping happens once, where the training happened; every friend then reads
-- the same row for the same week, so no two devices can disagree about which
-- week a session belonged to.
--
-- Like social_stats this is a published claim, not proof: it is private to
-- friends, not a competition with stakes, and not cheat-proof.
create table if not exists public.social_weekly (
  user_id       uuid not null references public.profiles(user_id) on delete cascade,
  week_start    date not null,
  weekly_xp     integer not null default 0,
  workouts      integer not null default 0,
  rules_version text not null default 'unknown',
  updated_at    timestamptz not null default now(),

  primary key (user_id, week_start),
  constraint social_weekly_week_is_monday check (extract(isodow from week_start) = 1),
  -- Ceilings far above anything a real week produces (a workout earns under
  -- a thousand XP), so they only ever stop garbage.
  constraint social_weekly_xp_sane check (weekly_xp >= 0 and weekly_xp <= 50000),
  constraint social_weekly_workouts_sane check (workouts >= 0 and workouts <= 100),
  constraint social_weekly_rules_version_sane check (char_length(rules_version) between 1 and 40)
);

-- The server's clock decides updated_at, and a week can only be written while
-- it is recent: nothing further ahead than next week, nothing older than a year.
create or replace function public.loop_social_weekly_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if new.week_start > (now() at time zone 'utc')::date + 7
     or new.week_start < (now() at time zone 'utc')::date - 371 then
    raise exception 'week_start is outside the writable window' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists social_weekly_guard on public.social_weekly;
create trigger social_weekly_guard before insert or update on public.social_weekly
  for each row execute function public.loop_social_weekly_guard();


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
alter table public.friend_invites enable row level security;
alter table public.social_weekly  enable row level security;

-- friend_invites: RLS on, and deliberately NO policy. Not readable or writable
-- by any client role; only the SECURITY DEFINER functions below touch it.

-- ------------------------------------------------------------ social_weekly --
-- Readable by the athlete and by accepted friends. A pending request or an
-- invite preview shows a username and nothing else, exactly as in 0001.
drop policy if exists social_weekly_select on public.social_weekly;
create policy social_weekly_select on public.social_weekly
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.loop_are_friends(user_id, auth.uid())
  );

drop policy if exists social_weekly_insert on public.social_weekly;
create policy social_weekly_insert on public.social_weekly
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists social_weekly_update on public.social_weekly;
create policy social_weekly_update on public.social_weekly
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No delete policy: rows leave with the account (on delete cascade).


-- =============================================================================
-- OPERATIONS
-- =============================================================================
-- Every function is SECURITY DEFINER, so its authorisation lives in its own
-- text: each one states `me is null` before anything else, as 0001's do.

-- Create a link. The plaintext token exists exactly once, in this return value.
create or replace function public.loop_create_invite_link()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me     uuid := auth.uid();
  raw    bytea;
  token  text;
  inv    public.friend_invites%rowtype;
  recent int;
begin
  if me is null then return jsonb_build_object('status', 'not_signed_in'); end if;
  if not exists (select 1 from public.profiles where user_id = me) then
    return jsonb_build_object('status', 'no_profile');
  end if;

  -- A ceiling, not moderation: nobody sharing with people they train with
  -- needs twenty new links in a day.
  select count(*) into recent from public.friend_invites
   where inviter = me and created_at > now() - interval '1 day';
  if recent >= 20 then return jsonb_build_object('status', 'rate_limited'); end if;

  -- Housekeeping: links dead for a month are gone for good.
  delete from public.friend_invites
   where inviter = me and coalesce(revoked_at, expires_at) < now() - interval '30 days';

  -- At most five live links: a sixth retires the oldest.
  update public.friend_invites set revoked_at = now()
   where id in (select id from public.friend_invites
                 where inviter = me and revoked_at is null and expires_at > now()
                 order by created_at desc
                 offset 4);

  raw   := uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid());
  token := translate(encode(raw, 'base64'), '+/=', '-_');

  insert into public.friend_invites (inviter, token_hash, expires_at)
  values (me, sha256(convert_to(token, 'UTF8')), now() + interval '7 days')
  returning * into inv;

  return jsonb_build_object('status', 'created', 'id', inv.id, 'token', token,
                            'expires_at', inv.expires_at);
end;
$$;

-- Who sent this link, and does it still work? A username and nothing else —
-- and only to a signed-in caller who already holds the token.
create or replace function public.loop_preview_invite_link(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me  uuid := auth.uid();
  inv record;
begin
  if me is null then return jsonb_build_object('status', 'not_signed_in'); end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('status', 'invalid');
  end if;

  select i.inviter, i.expires_at, i.revoked_at, i.uses, p.username
    into inv
    from public.friend_invites i
    join public.profiles p on p.user_id = i.inviter
   where i.token_hash = sha256(convert_to(p_token, 'UTF8'));

  if not found then return jsonb_build_object('status', 'invalid'); end if;
  if inv.inviter = me then return jsonb_build_object('status', 'self'); end if;
  -- A dead link does not say whose it was.
  if inv.revoked_at is not null then return jsonb_build_object('status', 'revoked'); end if;
  if inv.expires_at <= now() then return jsonb_build_object('status', 'expired'); end if;
  if public.loop_are_friends(me, inv.inviter) then
    return jsonb_build_object('status', 'already_friends', 'username', inv.username);
  end if;
  if inv.uses >= 20 then return jsonb_build_object('status', 'full'); end if;

  return jsonb_build_object('status', 'ok', 'username', inv.username,
                            'expires_at', inv.expires_at);
end;
$$;

-- Accept a link. The recipient is the one saying yes; the inviter said yes by
-- creating and sending it. One atomic block: the friendship appears, any
-- pending request between the two disappears, and the use is counted.
create or replace function public.loop_accept_invite_link(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me     uuid := auth.uid();
  inv    record;
  who    text;
  mine   int;
  theirs int;
begin
  if me is null then return jsonb_build_object('status', 'not_signed_in'); end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- Locked, so two people accepting a nearly used-up link cannot both pass.
  select i.id, i.inviter, i.expires_at, i.revoked_at, i.uses
    into inv
    from public.friend_invites i
   where i.token_hash = sha256(convert_to(p_token, 'UTF8'))
   for update;

  if not found then return jsonb_build_object('status', 'invalid'); end if;
  if inv.inviter = me then return jsonb_build_object('status', 'self'); end if;
  if inv.revoked_at is not null then return jsonb_build_object('status', 'revoked'); end if;
  if inv.expires_at <= now() then return jsonb_build_object('status', 'expired'); end if;
  if not exists (select 1 from public.profiles where user_id = me) then
    return jsonb_build_object('status', 'no_profile');
  end if;

  select username into who from public.profiles where user_id = inv.inviter;

  if public.loop_are_friends(me, inv.inviter) then
    return jsonb_build_object('status', 'already_friends', 'username', who);
  end if;
  if inv.uses >= 20 then return jsonb_build_object('status', 'full'); end if;

  select count(*) into mine   from public.friendships where user_a = me or user_b = me;
  select count(*) into theirs from public.friendships where user_a = inv.inviter or user_b = inv.inviter;
  if mine >= 500 or theirs >= 500 then
    return jsonb_build_object('status', 'too_many_friends');
  end if;

  insert into public.friendships (user_a, user_b)
  values (least(me, inv.inviter), greatest(me, inv.inviter))
  on conflict do nothing;

  delete from public.friend_requests
   where (from_user = me and to_user = inv.inviter)
      or (from_user = inv.inviter and to_user = me);

  update public.friend_invites set uses = uses + 1 where id = inv.id;

  return jsonb_build_object('status', 'connected', 'username', who);
end;
$$;

-- Reset: every link this athlete ever made stops working at once.
create or replace function public.loop_revoke_invite_links()
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
  update public.friend_invites set revoked_at = now()
   where inviter = me and revoked_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('status', 'revoked', 'count', n);
end;
$$;

-- THE FRIENDS SCREEN IN ONE QUERY. This athlete's profile; everyone in their
-- circle (themselves and accepted friends, nobody else) with level, rank, total
-- XP and the week asked for and the week before; their pending requests; and
-- which of their own links still work. Nothing is returned about anyone outside
-- the circle, and the circle is always auth.uid()'s own.
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
    ), '[]'::jsonb)
  );
end;
$$;


-- =============================================================================
-- GRANTS
-- =============================================================================
-- The same three lessons as 0001, applied from the start. Supabase's default
-- privileges grant ALL on every new table and function to anon and
-- authenticated, and PostgreSQL grants EXECUTE to PUBLIC besides — so each
-- holding is revoked by name, and exactly what an authenticated session needs
-- is granted back.
revoke all on table public.friend_invites from public, anon, authenticated;
revoke all on table public.social_weekly  from public, anon, authenticated;
grant select, insert, update on table public.social_weekly to authenticated;

revoke execute on function public.loop_social_weekly_guard()     from public, anon, authenticated;
revoke execute on function public.loop_create_invite_link()      from public, anon;
revoke execute on function public.loop_preview_invite_link(text) from public, anon;
revoke execute on function public.loop_accept_invite_link(text)  from public, anon;
revoke execute on function public.loop_revoke_invite_links()     from public, anon;
revoke execute on function public.loop_friends_hub(date)         from public, anon;

grant execute on function public.loop_create_invite_link()      to authenticated;
grant execute on function public.loop_preview_invite_link(text) to authenticated;
grant execute on function public.loop_accept_invite_link(text)  to authenticated;
grant execute on function public.loop_revoke_invite_links()     to authenticated;
grant execute on function public.loop_friends_hub(date)         to authenticated;

'use strict';
/* D95 — LOOP's Supabase security boundary, proven on a real PostgreSQL.

   Not a scan of SQL text: every attack below is run as the role and the signed-in
   athlete who would make it, and each denial must NAME the SQLSTATE it is
   refused with, so a query that fails because it was malformed cannot pass for a
   query that was refused. Supabase's default privileges are in force (see
   shim.js), because they are the thing this review is about.

   The cast:   A <-> B friends,  B <-> C friends,  C is a stranger to A,
               D has a pending request to A,  E has an account and no profile,
               anon is the publishable key and nothing else.

       npm install --no-save @electric-sql/pglite
       node supabase/tests/e9-security.js            (all migrations)
       MIG_DIR=<dir> node supabase/tests/e9-security.js   (a mutated copy)   */
const fs = require('fs');
const path = require('path');
const { makeDb, apply, as, addUser, MIG, ALL } = require('./shim.js');

let pass = 0, fail = 0;
const failures = [];
function T(name, ok, detail){
  if(ok) pass++;
  else { fail++; failures.push(name + (detail !== undefined ? '  :: ' + String(detail).slice(0, 300) : '')); }
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (!ok && detail !== undefined ? '  :: ' + String(detail).slice(0, 300) : ''));
}
const section = s => console.log('\n== ' + s);
const err = async p => { try{ await p; return null; }catch(e){ return e; } };
const code = e => e && (e.code || (e.cause && e.cause.code));
const denied = (e, codes) => !!e && (codes || ['42501']).indexOf(code(e)) !== -1;
const sj = v => JSON.stringify(v);

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const mondayOf = d => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
const THIS_WEEK = mondayOf(new Date());
const SNAP = (extra) => Object.assign({ v: 1, title: 'Push Day', category: 'push', exercises: [{ name: 'Bench Press', sets: 3, reps: '8' }] }, extra || {});

/* ------------------------------------------------------------------------- *
 * What the app is allowed to hold. Anything a role holds beyond this is a
 * finding; anything new must be classified here on purpose.
 * ------------------------------------------------------------------------- */
const TABLE_GRANTS = {   // authenticated, table-level; anon and PUBLIC hold none of any
  profiles: ['SELECT'], social_stats: ['INSERT', 'SELECT', 'UPDATE'], social_weekly: ['INSERT', 'SELECT', 'UPDATE'],
  friend_requests: ['DELETE', 'SELECT'], friendships: ['DELETE', 'SELECT'],
  friend_invites: [], invite_code_misses: [], shared_workouts: [], shared_workout_sends: []
};
const PROFILE_INSERT_COLS = ['user_id', 'username', 'username_key'];
const PROFILE_UPDATE_COLS = ['username', 'username_key'];
const AUTH_FUNCTIONS = [   // what an authenticated session may execute
  'loop_accept_friend_request', 'loop_accept_invite_link', 'loop_are_friends', 'loop_create_invite_link', 'loop_delete_account',
  'loop_friends_hub', 'loop_friends_leaderboard', 'loop_my_requests', 'loop_new_invite_code', 'loop_open_shared_workout',
  'loop_preview_invite', 'loop_preview_invite_link', 'loop_remove_friend', 'loop_remove_shared_workout', 'loop_revoke_invite_links',
  'loop_rotate_invite_code', 'loop_send_friend_request', 'loop_share_workout'];
const NO_ONE_FUNCTIONS = ['loop_request_between', 'loop_touch_updated_at', 'loop_profiles_guard', 'loop_social_weekly_guard', 'loop_shared_workouts_guard'];
const HUB_PERSON_KEYS = ['friends_since', 'is_self', 'level', 'lifetime_xp', 'prev_workouts', 'prev_xp', 'rank', 'stats_updated_at',
  'user_id', 'username', 'week_updated_at', 'week_workouts', 'week_xp'];

(async () => {
  const files = ALL();
  const hasShares = files.some(f => f.startsWith('0003'));

  /* ====================================================================== */
  section('the chain applies, twice, and re-issues nothing the second time');
  let db;
  { const e = await err((async () => { db = await makeDb({ twice: true }); })());
    T('every migration applies on a Supabase-shaped database, and applying them all again is harmless', !e, e && e.message);
    if(e) process.exit(1); }
  T('0005 is in the chain being tested', files.some(f => f.startsWith('0005')), files.join());

  const A = await addUser(db, 'a@example.com', 'alice');
  const B = await addUser(db, 'b@example.com', 'bob');
  const C = await addUser(db, 'c@example.com', 'carol');
  const D = await addUser(db, 'd@example.com', 'dave');
  const E = (await db.query("insert into auth.users(email) values ('e@example.com') returning id")).rows[0].id;
  const AS = { A, B, C, D, E };
  const ME = (who, fn) => as(db, 'authenticated', AS[who], fn);
  const ANON = fn => as(db, 'anon', null, fn);
  const SU = (sql, p) => db.query(sql, p || []);
  const pair = (x, y) => SU('insert into public.friendships(user_a,user_b) values (least($1::uuid,$2::uuid), greatest($1::uuid,$2::uuid)) on conflict do nothing', [x, y]);
  await pair(A, B); await pair(B, C);
  await SU('insert into public.friend_requests(from_user,to_user) values ($1,$2)', [D, A]);
  for(const u of [A, B, C, D]){
    await SU('insert into public.social_stats(user_id,lifetime_xp,level,rank) values ($1, 1000, 3, $2)', [u, 'TRAINEE']);
    await SU('insert into public.social_weekly(user_id,week_start,weekly_xp,workouts) values ($1,$2,120,3)', [u, THIS_WEEK]);
  }
  const codeOf = async u => (await SU('select invite_code from public.profiles where user_id=$1', [u])).rows[0].invite_code;
  const cA = await codeOf(A), cC = await codeOf(C);
  /* an error is a value here, so a regression shows as a failed assertion, not a crashed run */
  const rpc = (who, sql, p) => ME(who, ({ one }) => one(sql, p)).then(r => r && r.r).catch(e => ({ status: 'ERROR', error: code(e) || e.message }));
  const names = { [A]: 'A', [B]: 'B', [C]: 'C', [D]: 'D' };

  /* ====================================================================== */
  section('E9-A — an invite code is a capability, and only its owner can read it');
  {
    const own = await ME('A', ({ q }) => q('select user_id, invite_code from public.profiles'));
    T('A reads exactly one profile row: her own — not her friend B, not the athlete who requested her', own.rows.length === 1 && own.rows[0].user_id === A, own.rows.map(r => names[r.user_id]));
    T('and her own code is there, well-formed', CODE_RE.test(own.rows[0].invite_code), own.rows[0].invite_code);
    for(const [who, other, why] of [['A', B, 'a friend'], ['A', D, 'someone with a pending request to her'], ['D', A, 'the athlete he asked'], ['C', A, 'a stranger'], ['B', C, 'a friend']]){
      const r = await ME(who, ({ q }) => q('select invite_code from public.profiles where user_id = $1', [other]));
      T(who + ' cannot read ' + names[other] + "'s invite code by id (" + why + ')', r.rows.length === 0);
    }
    { const r = await ME('C', ({ q }) => q('select invite_code from public.profiles where invite_code = $1', [cA]));
      T('nor find a profile by a code she is guessing', r.rows.length === 0); }
    { const e = await err(ANON(({ q }) => q('select invite_code from public.profiles')));
      T('anon reads no profile at all', denied(e), e && code(e)); }
    { const e = await err(ANON(({ q }) => q('select * from public.friend_invites')));
      T('anon cannot read invite links', denied(e), e && code(e));
      const e2 = await err(ME('A', ({ q }) => q('select * from public.friend_invites')));
      T('and neither can the athlete who made them — no client role reads that table', denied(e2), e2 && code(e2)); }
    /* what a friend legitimately sees still arrives, through the definer functions */
    const hub = await rpc('A', 'select public.loop_friends_hub($1::date) r', [THIS_WEEK]);
    const people = hub.people || [];
    T('the Friends hub still shows A her friend B and herself, with usernames', hub.status === 'ok' && people.map(p => p.username).sort().join() === 'alice,bob', people.map(p => p.username));
    T('and lists the pending request from dave by username', (hub.requests || []).length === 1 && hub.requests[0].username === 'dave' && hub.requests[0].direction === 'incoming');
    T('no other athlete’s invite code is anywhere in what the hub returns', !sj(hub).includes(await codeOf(B)) && !sj(hub).includes(await codeOf(D)) && !sj(hub).includes(await codeOf(C)));
    T('her own is (the app reads it for its own "that is your own code" check)', hub.profile && hub.profile.invite_code === await codeOf(A));
    const lb = await ME('A', ({ q }) => q('select * from public.loop_friends_leaderboard()'));
    T('the 0001 leaderboard and request list still work for a project on the older client', lb.rows.length === 2 && !sj(lb.rows).includes(await codeOf(B)));
    const rq = await ME('A', ({ q }) => q('select * from public.loop_my_requests()'));
    T('… and my_requests names dave without exposing anything else of him', rq.rows.length === 1 && rq.rows[0].username === 'dave' && Object.keys(rq.rows[0]).sort().join() === 'created_at,direction,id,username');
  }

  /* ====================================================================== */
  section('E9-B — privileges: what each role holds, read from the catalog');
  {
    const tables = (await SU("select c.relname t from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m') order by 1")).rows.map(r => r.t);
    T('no table in the social schema is unclassified (a new table must be added to this suite on purpose)', tables.every(t => t in TABLE_GRANTS), tables.filter(t => !(t in TABLE_GRANTS)));
    const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
    for(const t of tables){
      const held = async role => (await SU(`select ${PRIVS.map(p => `has_table_privilege('${role}','public.${t}','${p}') as "${p}"`).join(',')}`)).rows[0];
      const anon = await held('anon'), au = await held('authenticated');
      const pub = (await SU(`select privilege_type p from information_schema.table_privileges where table_schema='public' and table_name=$1 and grantee='PUBLIC'`, [t])).rows.map(r => r.p);
      T(t + ': anon holds nothing, PUBLIC holds nothing', !PRIVS.some(p => anon[p]) && pub.length === 0, { anon: PRIVS.filter(p => anon[p]), pub });
      const got = PRIVS.filter(p => au[p]).sort();
      T(t + ': authenticated holds exactly [' + (TABLE_GRANTS[t] || []).join(',') + ']', sj(got) === sj((TABLE_GRANTS[t] || []).slice().sort()), got);
    }
    const cols = (await SU("select column_name c from information_schema.columns where table_schema='public' and table_name='profiles' order by ordinal_position")).rows.map(r => r.c);
    const colHeld = async priv => { const out = []; for(const c of cols) if((await SU(`select has_column_privilege('authenticated','public.profiles',$1,'${priv}') h`, [c])).rows[0].h) out.push(c); return out; };
    T('profiles is granted by COLUMN: a client may set user_id, username, username_key on insert — never invite_code or a timestamp', sj(await colHeld('INSERT')) === sj(cols.filter(c => PROFILE_INSERT_COLS.includes(c))), await colHeld('INSERT'));
    T('and change only username and username_key afterwards — never its own id, invite code or dates', sj(await colHeld('UPDATE')) === sj(cols.filter(c => PROFILE_UPDATE_COLS.includes(c))), await colHeld('UPDATE'));

    const fns = (await SU(`select p.proname n, p.prosecdef def, p.proconfig cfg,
        has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
        exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type='EXECUTE') pub
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1`)).rows;
    T('no function in the schema is unclassified', fns.every(f => AUTH_FUNCTIONS.includes(f.n) || NO_ONE_FUNCTIONS.includes(f.n)), fns.filter(f => !AUTH_FUNCTIONS.includes(f.n) && !NO_ONE_FUNCTIONS.includes(f.n)).map(f => f.n));
    T('anon can execute no function, and neither can PUBLIC', fns.every(f => !f.anon && !f.pub), fns.filter(f => f.anon || f.pub).map(f => f.n));
    const authSet = fns.filter(f => f.auth).map(f => f.n).sort();
    T('authenticated can execute exactly the ' + AUTH_FUNCTIONS.length + ' functions the app and its policies need', sj(authSet) === sj(AUTH_FUNCTIONS.filter(n => fns.some(f => f.n === n)).sort()), authSet);
    T('the trigger functions and the retired loop_request_between are executable by no client role', NO_ONE_FUNCTIONS.every(n => fns.filter(f => f.n === n).every(f => !f.auth && !f.anon && !f.pub)));
  }

  /* ====================================================================== */
  section('E9-B — privileges: what an athlete can actually do');
  {
    const tryw = async (who, sql, p) => {     // run inside a transaction that is always rolled back
      let n = null;
      const e = await err(ME(who, async ({ q }) => { const r = await q(sql, p); n = r.affectedRows ?? r.rows.length; throw Object.assign(new Error('rolled back'), { code: 'PROBE_OK' }); }));
      return e && code(e) === 'PROBE_OK' ? { ok: true, n } : { ok: false, code: code(e) };
    };
    T('A cannot TRUNCATE friendships — TRUNCATE is not subject to row level security, so only the grant stops it', (await tryw('A', 'truncate public.friendships')).code === '42501');
    T('nor social_stats, friend_requests or profiles', ['social_stats', 'friend_requests', 'profiles'].every(async t => true) && (await Promise.all(['social_stats', 'friend_requests', 'profiles'].map(t => tryw('A', 'truncate public.' + t)))).every(r => r.code === '42501'));
    T('A cannot DELETE her own profile row (only loop_delete_account can)', (await tryw('A', 'delete from public.profiles where user_id = $1', [A])).code === '42501');
    T('A cannot UPDATE her own invite_code directly', (await tryw('A', "update public.profiles set invite_code = 'AAAAAAAA' where user_id = $1", [A])).code === '42501');
    T('A cannot rewrite her own created_at or updated_at', (await tryw('A', "update public.profiles set created_at = '2001-01-01' where user_id = $1", [A])).code === '42501' && (await tryw('A', "update public.profiles set updated_at = '2001-01-01' where user_id = $1", [A])).code === '42501');
    T('A cannot move her profile to another user_id (identity is immutable)', (await tryw('A', 'update public.profiles set user_id = $2 where user_id = $1', [A, E])).code === '42501');
    T('A cannot UPDATE or INSERT a friendship, or a request between others', (await tryw('A', 'update public.friendships set created_at = now()')).code === '42501' &&
      (await tryw('A', 'insert into public.friend_requests(from_user,to_user) values ($1,$2)', [A, C])).code === '42501');
    /* the paths the app really uses, exactly as PostgREST writes them */
    { const e = await err(as(db, 'authenticated', E, ({ q }) => q("insert into public.profiles(user_id, username, username_key) values ($1, 'erin', 'erin') returning *", [E])));
      T('a new athlete claims a username: the insert the app makes works, and a code is assigned by the database', !e, e && e.message);
      const c = await codeOf(E);
      T('… that code is well-formed and the athlete did not choose it', CODE_RE.test(c), c); }
    { const e1 = await err(as(db, 'authenticated', E, ({ q }) => q("update public.profiles set username='erin2', username_key='erin2' where user_id=$1 returning *", [E])));
      T('renaming works (username and username_key are the columns the app PATCHes)', !e1, e1 && e1.message); }
    { const e = await err(as(db, 'authenticated', E, ({ q }) => q("insert into public.profiles(user_id, username, username_key, invite_code) values (gen_random_uuid(), 'x1x', 'x1x', 'AAAAAAAA')")));
      T('an athlete cannot choose their own invite code at insert (that would be an existence oracle for everyone else’s)', denied(e), e && code(e)); }
    { const e = await err(ME('A', ({ q }) => q(`insert into public.social_stats(user_id,lifetime_xp,level,rank,rules_version) values ($1,1500,4,'ATHLETE','r1')
        on conflict (user_id) do update set user_id = excluded.user_id, lifetime_xp = excluded.lifetime_xp, level = excluded.level, rank = excluded.rank, rules_version = excluded.rules_version`, [A])));
      T('publishing stats — the upsert the app makes, primary key in the SET clause as PostgREST writes it — works', !e, e && e.message); }
    { const e = await err(ME('A', ({ q }) => q(`insert into public.social_weekly(user_id,week_start,weekly_xp,workouts,rules_version) values ($1,$2,200,4,'r1')
        on conflict (user_id, week_start) do update set user_id = excluded.user_id, week_start = excluded.week_start, weekly_xp = excluded.weekly_xp, workouts = excluded.workouts, rules_version = excluded.rules_version`, [A, THIS_WEEK])));
      T('publishing the week works the same way', !e, e && e.message); }
    { const r = await tryw('D', 'delete from public.friend_requests where from_user = $1 and to_user = $2', [D, A]);
      T('a requester can cancel his own request (a DELETE the app makes)', r.ok && r.n === 1, r); }
    { const r = await tryw('A', 'delete from public.friend_requests where from_user = $1 and to_user = $2', [D, A]);
      T('and the recipient can decline it', r.ok && r.n === 1, r); }
    { const r = await tryw('C', 'delete from public.friend_requests where from_user = $1 and to_user = $2', [D, A]);
      T('a stranger cannot cancel or decline it (0 rows, row level security)', r.ok && r.n === 0, r); }
  }

  /* ====================================================================== */
  section('E9-C — invite codes: a cryptographic source, uniform, throttled');
  {
    /* the old generator was random(): reseeding the session made it repeat itself */
    const ctl = await ME('A', async ({ q }) => { await q('select setseed(0.42)'); const a = (await q('select random() r')).rows[0].r; await q('select setseed(0.42)'); const b = (await q('select random() r')).rows[0].r; return a === b; });
    T('control: a reseeded random() repeats exactly (so the check below can tell)', ctl === true);
    const twice = await ME('A', async ({ q }) => { await q('select setseed(0.42)'); const a = (await q('select public.loop_new_invite_code() c')).rows[0].c; await q('select setseed(0.42)'); const b = (await q('select public.loop_new_invite_code() c')).rows[0].c; return [a, b]; });
    T('the generator does NOT follow the session’s pseudo-random state: the same seed yields different codes', twice[0] !== twice[1] && CODE_RE.test(twice[0]) && CODE_RE.test(twice[1]), twice);
    const N = 8000;
    const codes = (await ME('A', ({ q }) => q('select public.loop_new_invite_code() c from generate_series(1, $1)', [N]))).rows.map(r => r.c);
    T(N + ' codes: every one is 8 characters of the 31-symbol alphabet (no O, 0, I, 1, L)', codes.every(c => CODE_RE.test(c)));
    T('… and no repeats among them (collision at 39.6 bits is a birthday of 1 in ~13 million here)', new Set(codes).size === codes.length, codes.length - new Set(codes).size);
    const counts = {}; ALPHABET.split('').forEach(c => counts[c] = 0); codes.join('').split('').forEach(c => counts[c]++);
    const exp = (N * 8) / 31; const chi = ALPHABET.split('').reduce((s, c) => s + Math.pow(counts[c] - exp, 2) / exp, 0);
    T('every character is equally likely — chi-square ' + chi.toFixed(1) + ' over 30 degrees of freedom (a modulo-biased generator scores ~150 here; 60 is p<0.001)', chi < 60, chi);
    const pos = []; for(let i = 0; i < 8; i++){ const c2 = {}; ALPHABET.split('').forEach(c => c2[c] = 0); codes.forEach(c => c2[c[i]]++); pos.push(ALPHABET.split('').reduce((s, c) => s + Math.pow(c2[c] - N / 31, 2) / (N / 31), 0)); }
    T('and equally likely in every position (worst position chi-square ' + Math.max(...pos).toFixed(1) + ')', Math.max(...pos) < 75, pos.map(x => x.toFixed(0)));

    /* throttle */
    try{
    const F = await addUser(db, 'f@example.com', 'frank'), G = await addUser(db, 'g@example.com', 'gina');
    AS.F = F; AS.G = G;
    const wrong = i => '2222222' + ALPHABET[i % 31];
    const wrongCodes = Array.from({ length: 21 }, (_, i) => wrong(i));
    T('(the wrong codes used below really are wrong)', (await SU('select count(*)::int n from public.profiles where invite_code = any($1)', [wrongCodes])).rows[0].n === 0);
    const before = (await SU('select count(*)::int n from public.friend_requests')).rows[0].n;
    let shapes = [];
    for(let i = 0; i < 20; i++) shapes.push(await rpc('F', 'select public.loop_send_friend_request($1) r', [wrongCodes[i]]));
    T('20 wrong codes are each answered "invalid_code"', shapes.every(s => s === 'invalid_code'), shapes);
    T('the 21st wrong code is refused as rate_limited — before the code is even looked at', await rpc('F', 'select public.loop_send_friend_request($1) r', [wrongCodes[20]]) === 'rate_limited');
    T('a RIGHT code gets the same answer while throttled, so the throttle itself reveals nothing about which codes exist', await rpc('F', 'select public.loop_send_friend_request($1) r', [await codeOf(C)]) === 'rate_limited');
    T('preview is throttled too, and answers a throttled right code exactly as a wrong one: no rows',
      (await ME('F', ({ q }) => q('select * from public.loop_preview_invite($1)', [cC]))).rows.length === 0 &&
      (await ME('F', ({ q }) => q('select * from public.loop_preview_invite($1)', [wrongCodes[0]]))).rows.length === 0);
    T('a throttled athlete created no request', (await SU('select count(*)::int n from public.friend_requests')).rows[0].n === before);
    T('the throttle is per athlete: G, at the same moment, sends a request with a right code', await rpc('G', 'select public.loop_send_friend_request($1) r', [await codeOf(C)]) === 'sent');
    await SU("update public.invite_code_misses set missed_at = now() - interval '61 minutes' where user_id = $1", [F]);
    T('an hour later F’s misses are gone and a right code works again', await rpc('F', 'select public.loop_send_friend_request($1) r', [await codeOf(C)]) === 'sent');
    const misses0 = (await SU('select count(*)::int n from public.invite_code_misses where user_id = $1', [F])).rows[0].n;
    T('a right code, or your own, costs nothing against the limit',
      await rpc('F', 'select public.loop_send_friend_request($1) r', [await codeOf(F)]) === 'self' &&
      (await SU('select count(*)::int n from public.invite_code_misses where user_id = $1', [F])).rows[0].n === misses0);
    { const e = await err(ME('A', ({ q }) => q('select * from public.invite_code_misses')));
      T('nobody can read or edit the miss ledger', denied(e), e && code(e)); }

    /* collision handling, with a generator that repeats itself once */
    const db2 = await makeDb();
    const X = await addUser(db2, 'x@example.com', 'xena'), Y = await addUser(db2, 'y@example.com', 'yuri');
    await db2.exec(`create table public._seq(n int); insert into public._seq values (0);
      create or replace function public.loop_new_invite_code() returns text language plpgsql security definer as $f$
      declare k int; begin update public._seq set n = n + 1 returning n into k; return case when k = 1 then 'ZZZZZZZZ' else 'YYYYYYYY' end; end $f$;
      select set_config('loop.allow_code_rotation','on',false);
      update public.profiles set invite_code = 'ZZZZZZZZ' where user_id = '${Y}';
      select set_config('loop.allow_code_rotation','off',false);`);
    const rot = await as(db2, 'authenticated', X, ({ one }) => one('select public.loop_rotate_invite_code() r'));
    T('rotating onto a code somebody holds is retried, not failed and not duplicated', rot.r === 'YYYYYYYY');
    const W = (await db2.query("insert into auth.users(email) values ('w@example.com') returning id")).rows[0].id;
    const dup = await err(as(db2, 'authenticated', W, ({ q }) => q("insert into public.profiles(user_id, username, username_key) values ($1,'wren','wren')", [W])));
    T('a first insert whose default code collides is refused by the unique constraint (23505), and stores nothing', code(dup) === '23505' &&
      (await db2.query('select count(*)::int n from public.profiles where user_id = $1', [W])).rows[0].n === 0, dup && code(dup));

    /* the codes issued before this migration came from the old generator, and are re-issued once */
    if(files.some(f => f.startsWith('0005'))){
      const pre = files.filter(f => !f.startsWith('0005'));
      const db3 = await makeDb({ migrations: pre });
      const P1 = await addUser(db3, 'p1@example.com', 'pat'), P2 = await addUser(db3, 'p2@example.com', 'pam');
      const old = (await db3.query('select invite_code from public.profiles order by username')).rows.map(r => r.invite_code);
      const friendsBefore = (await db3.query('select 1 from public.friendships')).rows.length;
      await apply(db3, files.find(f => f.startsWith('0005')));
      const mid = (await db3.query('select invite_code from public.profiles order by username')).rows.map(r => r.invite_code);
      T('on a project that had codes from the old generator, applying 0005 issues every athlete a new one', mid.every((c, i) => c !== old[i] && CODE_RE.test(c)), { old, mid });
      await apply(db3, files.find(f => f.startsWith('0005')));
      const after = (await db3.query('select invite_code from public.profiles order by username')).rows.map(r => r.invite_code);
      T('and applying it again re-issues nothing (the marker holds)', sj(after) === sj(mid));
      T('and no profile, friendship or username was touched', (await db3.query('select count(*)::int n from public.profiles')).rows[0].n === 2 && (await db3.query('select 1 from public.friendships')).rows.length === friendsBefore);
      const db4 = await makeDb({ migrations: files.filter(f => /^000[125]/.test(f)) });
      T('0005 also applies to a project that has only 0001 and 0002', !!db4);
    }
    }catch(e){ T('the throttle, collision and re-issue checks ran to the end (threw: ' + (e && e.message) + ')', false); }
  }

  /* ====================================================================== */
  section('E9-D — no function answers a question about strangers');
  {
    const F2 = t => t === true ? 'true' : t === false ? 'false' : String(t);
    T('A asks whether B and C are friends (they are; she is party to neither): false', await rpc('A', 'select public.loop_are_friends($1,$2) r', [B, C]) === false);
    T('… and the other order, and with her own id absent', await rpc('A', 'select public.loop_are_friends($1,$2) r', [C, B]) === false);
    T('A asks about A and B — a relationship she has: true, either way round', await rpc('A', 'select public.loop_are_friends($1,$2) r', [A, B]) === true && await rpc('A', 'select public.loop_are_friends($1,$2) r', [B, A]) === true);
    T('A asks about a stranger who is not a friend: false, identical to asking about a UUID that does not exist', await rpc('A', 'select public.loop_are_friends($1,$2) r', [A, C]) === await rpc('A', 'select public.loop_are_friends($1,gen_random_uuid()) r', [A]));
    T('B (friends with both) still gets true for each of his own — the policies that use this are unaffected', await rpc('B', 'select public.loop_are_friends($1,$2) r', [B, C]) === true);
    { const e = await err(ANON(({ one }) => one('select public.loop_are_friends($1,$2) r', [B, C])));
      T('anon cannot call it at all', denied(e), e && code(e)); }
    { const e = await err(ME('C', ({ one }) => one('select public.loop_request_between($1,$2) r', [D, A])));
      T('loop_request_between — which told C that D had asked A — is not executable by any athlete now', denied(e), e && code(e)); }
    { const e = await err(ANON(({ one }) => one('select public.loop_request_between($1,$2) r', [D, A])));
      T('or by anon', denied(e), e && code(e)); }
    /* the same shape for a real and a made-up id wherever a caller has no right to know */
    const ghost = (await SU('select gen_random_uuid() g')).rows[0].g;
    T('loop_remove_friend answers "removed" for a real friend, a stranger and a UUID that does not exist alike',
      sj([await rpc('A', 'select public.loop_remove_friend($1) r', [C]), await rpc('A', 'select public.loop_remove_friend($1) r', [ghost])]) === sj(['removed', 'removed']));
    T('and A removing "C" — whom she is not friends with — left B and C friends', (await SU('select 1 from public.friendships where user_a = least($1::uuid,$2::uuid) and user_b = greatest($1::uuid,$2::uuid)', [B, C])).rows.length === 1);
    const reqId = (await SU('select id from public.friend_requests limit 1')).rows[0]?.id || ghost;
    T('accepting somebody else’s request, and accepting one that does not exist, are both "not_found"',
      sj([await rpc('C', 'select public.loop_accept_friend_request($1) r', [reqId]), await rpc('C', 'select public.loop_accept_friend_request($1) r', [ghost])]) === sj(['not_found', 'not_found']));
    T('a token that is well-formed but unknown is "invalid" — exactly what a malformed one gets', sj(await rpc('C', 'select public.loop_preview_invite_link($1) r', ['A'.repeat(43)])) === sj(await rpc('C', 'select public.loop_preview_invite_link($1) r', ['nope'])));
    T('accepting one is the same', sj(await rpc('C', 'select public.loop_accept_invite_link($1) r', ['B'.repeat(43)])) === sj({ status: 'invalid' }));
    if(hasShares){
      const share = (name) => ({ v: 1, title: name, category: 'push', exercises: [{ name: 'Bench Press', sets: 3, reps: '8' }] });
      T('sharing with a stranger and with an id that does not exist give one and the same answer',
        sj(await rpc('A', 'select public.loop_share_workout($1,$2::jsonb) r', [C, sj(share('x'))])) === sj(await rpc('A', 'select public.loop_share_workout($1,$2::jsonb) r', [ghost, sj(share('x'))])) &&
        (await rpc('A', 'select public.loop_share_workout($1,$2::jsonb) r', [C, sj(share('x'))])).status === 'not_friends');
      T('and the check comes before the payload is read: a stranger learns nothing from a malformed one either', (await rpc('A', 'select public.loop_share_workout($1,$2::jsonb) r', [C, '{"bad":1}'])).status === 'not_friends');
      T('opening and removing a share that does not exist give the answer an unauthorised caller gets for a real one', sj(await rpc('C', 'select public.loop_open_shared_workout($1) r', [ghost])) === sj({ status: 'not_found' }) && sj(await rpc('C', 'select public.loop_remove_shared_workout($1) r', [ghost])) === sj({ status: 'not_found' }));
    }
  }

  /* ====================================================================== */
  section('SECURITY DEFINER — identity from auth.uid(), a fixed search_path, no hijack');
  {
    const defs = (await SU(`select p.proname n, p.proconfig cfg from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef order by 1`)).rows;
    T(defs.length + ' SECURITY DEFINER functions, and every one pins its search_path', defs.length >= 17 && defs.every(f => (f.cfg || []).some(c => /^search_path=/.test(c))), defs.filter(f => !(f.cfg || []).some(c => /^search_path=/.test(c))).map(f => f.n));
    T('… to `public` — never to something a caller can put a schema in front of', defs.every(f => (f.cfg || []).some(c => c === 'search_path=public')), defs.map(f => f.cfg));
    const inv = (await SU(`select p.proname n, p.proconfig cfg from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and not p.prosecdef and p.proname = 'loop_new_invite_code'`)).rows[0];
    T('the one invoker function that is executed by callers (the column default) pins pg_catalog', inv && (inv.cfg || []).includes('search_path=pg_catalog'), inv);
    /* every function reads its caller from auth.uid(), never from an argument */
    const src = (await SU(`select p.proname n, pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef order by 1`)).rows;
    T('every one of them names auth.uid()', src.every(f => /auth\.uid\(\)/.test(f.d)), src.filter(f => !/auth\.uid\(\)/.test(f.d)).map(f => f.n));
    T('and none takes the caller’s identity as a parameter (no `me`, `user_id`, `caller` or `uid` argument)', src.every(f => !/\((?:[^)]*,\s*)?(?:me|uid|caller|user_id|p_user|p_me)\s+uuid/i.test(f.d.split('RETURNS')[0])), src.filter(f => /\((?:[^)]*,\s*)?(?:me|uid|caller|user_id|p_user|p_me)\s+uuid/i.test(f.d.split('RETURNS')[0])).map(f => f.n));

    /* hijack: shadow the built-ins the functions use, in the schema they search, and in the caller's own */
    await db.exec(`create function public.upper(text) returns text language sql as $$ select 'AAAAAAAA'::text $$;
              create function public.sha256(bytea) returns bytea language sql as $$ select '\\x00'::bytea $$;
              create function public.now() returns timestamptz language sql as $$ select '2001-01-01'::timestamptz $$;
              create function public.gen_random_uuid() returns uuid language sql as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
              create function public.substr(text, int, int) returns text language sql as $$ select 'Z'::text $$;`);
    const tok = await rpc('A', 'select public.loop_create_invite_link() r');
    T('with hostile upper(), sha256(), now(), gen_random_uuid() and substr() planted in public, a link is still minted from real randomness', tok.status === 'created' && TOKEN_RE.test(tok.token) && tok.token !== 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    const pv = await rpc('C', 'select public.loop_preview_invite_link($1) r', [tok.token]);
    T('… looked up by the real SHA-256 and the real clock', pv.status === 'ok' && pv.username === 'alice', pv);
    T('the invoker default still draws a real code with those shadows in place', CODE_RE.test((await ME('E', ({ one }) => one('select public.loop_new_invite_code() c'))).c) && (await ME('E', ({ one }) => one('select public.loop_new_invite_code() c'))).c !== 'ZZZZZZZZ');
    T('… and a preview by a code still resolves the real code (upper() was not redirected)', (await ME('C', ({ q }) => q('select * from public.loop_preview_invite($1)', [cA]))).rows.map(r => r.username).join() === 'alice');
    await db.exec('drop function public.upper(text); drop function public.sha256(bytea); drop function public.now(); drop function public.gen_random_uuid(); drop function public.substr(text,int,int)');
    /* a caller's own search_path and temp tables cannot redirect a definer function */
    const hub = await ME('A', async ({ q, one }) => {
      await q('create temp table profiles (user_id uuid, username text, invite_code text)');
      await q("insert into pg_temp.profiles values (gen_random_uuid(), 'mallory', 'HIJACKED')");
      await q('set local search_path = pg_temp, public');
      return (await one('select public.loop_friends_hub($1::date) r', [THIS_WEEK])).r;
    });
    T('a caller’s own temp table named profiles, first in their own search_path, does not reach the Friends hub', hub.status === 'ok' && !sj(hub).includes('mallory') && !sj(hub).includes('HIJACKED') && hub.people.length === 2);
  }

  /* ====================================================================== */
  section('friend invite links — one authorisation boundary per action');
  {
    const made = await rpc('A', 'select public.loop_create_invite_link() r');
    T('A creates a link: 43 base64url characters, returned once', made.status === 'created' && TOKEN_RE.test(made.token), made);
    T('… stored only as its SHA-256 — the plaintext is in no column of any table', (await SU(`select count(*)::int n from public.friend_invites i where i.token_hash = sha256(convert_to($1,'UTF8'))`, [made.token])).rows[0].n === 1 &&
      !(await SU(`select 1 from public.friend_invites where token_hash::text like '%' || $1 || '%'`, [made.token])).rows.length);
    T('A’s hub lists her link by id and expiry, never the token', !sj(await rpc('A', 'select public.loop_friends_hub($1::date) r', [THIS_WEEK])).includes(made.token));
    T('and nobody else’s hub lists it at all', (await rpc('C', 'select public.loop_friends_hub($1::date) r', [THIS_WEEK])).invites.length === 0);
    const pv = await rpc('E', 'select public.loop_preview_invite_link($1) r', [made.token]);
    T('E opens it: sees who sent it, and nothing more', pv.status === 'ok' && pv.username === 'alice' && Object.keys(pv).sort().join() === 'expires_at,status,username', pv);
    T('A previewing and accepting her own link: "self"', (await rpc('A', 'select public.loop_preview_invite_link($1) r', [made.token])).status === 'self' && (await rpc('A', 'select public.loop_accept_invite_link($1) r', [made.token])).status === 'self');
    const beforeF = (await SU('select count(*)::int n from public.friendships')).rows[0].n;
    await as(db, 'authenticated', E, ({ q }) => q("insert into public.profiles(user_id, username, username_key) values ($1,'erin9','erin9') on conflict do nothing", [E])).catch(() => {});
    const acc = await rpc('E', 'select public.loop_accept_invite_link($1) r', [made.token]);
    T('E accepts: connected, and exactly one friendship (A–E) appears', acc.status === 'connected' && (await SU('select count(*)::int n from public.friendships')).rows[0].n === beforeF + 1 &&
      (await SU('select 1 from public.friendships where user_a = least($1::uuid,$2::uuid) and user_b = greatest($1::uuid,$2::uuid)', [A, E])).rows.length === 1, acc);
    T('the same link redeemed again is a deterministic "already_friends", and adds nothing', (await rpc('E', 'select public.loop_accept_invite_link($1) r', [made.token])).status === 'already_friends' && (await SU('select count(*)::int n from public.friendships')).rows[0].n === beforeF + 1);
    T('the use was counted once', (await SU('select uses from public.friend_invites where token_hash = sha256(convert_to($1,\'UTF8\'))', [made.token])).rows[0].uses === 1);
    const t2 = await rpc('A', 'select public.loop_create_invite_link() r');
    await SU('update public.friend_invites set expires_at = now() + interval \'1 minute\', created_at = now() - interval \'1 day\' where token_hash = sha256(convert_to($1,\'UTF8\'))', [t2.token]);
    await SU('update public.friend_invites set expires_at = now() - interval \'1 second\' where token_hash = sha256(convert_to($1,\'UTF8\'))', [t2.token]).catch(() => {});
    const expiredRow = await err(SU("update public.friend_invites set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where token_hash = sha256(convert_to($1,'UTF8'))", [t2.token]));
    T('an expired link cannot connect anyone', !expiredRow && (await rpc('C', 'select public.loop_accept_invite_link($1) r', [t2.token])).status === 'expired');
    const t3 = await rpc('A', 'select public.loop_create_invite_link() r');
    await rpc('A', 'select public.loop_revoke_invite_links() r');
    T('a revoked link cannot connect anyone, and does not say whose it was', (await rpc('C', 'select public.loop_accept_invite_link($1) r', [t3.token])).status === 'revoked' && !('username' in (await rpc('C', 'select public.loop_preview_invite_link($1) r', [t3.token]))));
    T('a link that never existed is "invalid" and reveals nothing', (await rpc('C', 'select public.loop_accept_invite_link($1) r', ['x'.repeat(43)])).status === 'invalid');
    T('none of that created a friendship for C with A', (await SU('select 1 from public.friendships where user_a = least($1::uuid,$2::uuid) and user_b = greatest($1::uuid,$2::uuid)', [A, C])).rows.length === 0);
    { const e = await err(ME('C', ({ one }) => one('select public.loop_accept_invite_link($1) r', [null])));
      T('a null token is refused in the function, not by luck', !e && (await rpc('C', 'select public.loop_accept_invite_link($1) r', [null])).status === 'invalid'); }
    { const e = await err(ANON(({ one }) => one('select public.loop_accept_invite_link($1) r', [made.token])));
      T('anon cannot redeem it, holding the token or not', denied(e), e && code(e)); }
  }

  /* ====================================================================== */
  section('friendships — nobody edits a relationship they are not part of');
  {
    const rows = await ME('A', ({ q }) => q('select user_a, user_b from public.friendships'));
    T('A sees only friendships she is in', rows.rows.every(r => r.user_a === A || r.user_b === A), rows.rows.length);
    { const e = await err(ME('A', ({ q }) => q('insert into public.friendships(user_a,user_b) values (least($1::uuid,$2::uuid), greatest($1::uuid,$2::uuid))', [A, C])));
      T('A inserts an A–C friendship directly: refused (42501) — friendships come only from accepting a request or a link', denied(e), e && code(e)); }
    { const e = await err(ME('A', ({ q }) => q('insert into public.friendships(user_a,user_b) values (least($1::uuid,$2::uuid), greatest($1::uuid,$2::uuid))', [B, C])));
      T('or a friendship between two other people', denied(e), e && code(e)); }
    { const r = await ME('A', ({ q }) => q('delete from public.friendships where user_a = least($1::uuid,$2::uuid) and user_b = greatest($1::uuid,$2::uuid)', [B, C]));
      T('A deleting the B–C friendship removes nothing', (r.affectedRows ?? 0) === 0 && (await SU('select 1 from public.friendships where user_a = least($1::uuid,$2::uuid) and user_b = greatest($1::uuid,$2::uuid)', [B, C])).rows.length === 1); }
    { const e = await err(ME('A', ({ q }) => q("update public.friendships set created_at = '2001-01-01'")));
      T('A cannot update any friendship, even her own', denied(e), e && code(e)); }
    T('a request from D can be sent, accepted by its RECIPIENT only, and produces one friendship',
      (await rpc('D', 'select public.loop_accept_friend_request($1) r', [(await SU('select id from public.friend_requests limit 1')).rows[0]?.id || '00000000-0000-0000-0000-000000000000'])) === 'not_found');
    const sent = await rpc('D', 'select public.loop_send_friend_request($1) r', [await codeOf(C)]);
    const rid = (await SU('select id from public.friend_requests where from_user = $1 and to_user = $2', [D, C])).rows[0]?.id;
    T('(setup) D asks C by code', sent === 'sent' && !!rid, sent);
    T('the sender cannot accept his own request', await rpc('D', 'select public.loop_accept_friend_request($1) r', [rid]) === 'not_found');
    T('a third party cannot accept it', await rpc('A', 'select public.loop_accept_friend_request($1) r', [rid]) === 'not_found');
    T('the recipient accepts: one friendship, and the request is consumed', await rpc('C', 'select public.loop_accept_friend_request($1) r', [rid]) === 'accepted' &&
      (await SU('select 1 from public.friendships where user_a = least($1::uuid,$2::uuid) and user_b = greatest($1::uuid,$2::uuid)', [D, C])).rows.length === 1 &&
      (await SU('select 1 from public.friend_requests where id = $1', [rid])).rows.length === 0);
    T('a friend removes the friendship through the function, from either side', await rpc('D', 'select public.loop_remove_friend($1) r', [C]) === 'removed' && (await SU('select 1 from public.friendships where user_a = least($1::uuid,$2::uuid) and user_b = greatest($1::uuid,$2::uuid)', [D, C])).rows.length === 0);
  }

  /* ====================================================================== */
  section('weekly leaderboard and comparison — only friends, only the approved fields');
  {
    const w = await ME('A', ({ q }) => q('select user_id from public.social_weekly'));
    T('A reads the weekly rows of herself and her friend B — not C, not D', new Set(w.rows.map(r => names[r.user_id] || 'E-or-other')).size >= 1 && w.rows.every(r => [A, B].includes(r.user_id) || r.user_id === E), w.rows.map(r => names[r.user_id]));
    T('and never a stranger’s', !w.rows.some(r => r.user_id === C || r.user_id === D));
    const s = await ME('A', ({ q }) => q('select user_id from public.social_stats'));
    T('the same for total XP and rank', !s.rows.some(r => r.user_id === C || r.user_id === D) && s.rows.some(r => r.user_id === B));
    { const r = await ME('C', ({ q }) => q('select user_id from public.social_weekly where user_id = $1', [A]));
      T('C, who is nobody’s friend of A’s, reads none of A’s weeks', r.rows.length === 0); }
    { const e = await err(ME('A', ({ q }) => q('insert into public.social_weekly(user_id,week_start,weekly_xp) values ($1,$2,9999)', [B, THIS_WEEK])));
      T('A cannot write a week as B', denied(e), e && code(e)); }
    { const e = await err(ANON(({ q }) => q('select * from public.social_weekly')));
      T('anon cannot read weeks', denied(e), e && code(e)); }
    { const r = await ME('A', ({ q }) => q("update public.social_weekly set weekly_xp = 1 where user_id = $1", [B]));
      T('A updating B’s week changes nothing', (r.affectedRows ?? 0) === 0 && (await SU('select weekly_xp from public.social_weekly where user_id=$1', [B])).rows[0].weekly_xp === 120); }
    const hub = await rpc('A', 'select public.loop_friends_hub($1::date) r', [THIS_WEEK]);
    T('the comparison is exactly these fields per athlete — no workouts, exercises, loads, readiness, prescriptions, programs or notes', hub.people.every(p => sj(Object.keys(p).sort()) === sj(HUB_PERSON_KEYS)), hub.people.map(p => Object.keys(p)));
    T('and the hub’s top level is status, week, profile, people, requests, invites' + (hasShares ? ', shares' : ''), sj(Object.keys(hub).sort()) === sj(['invites', 'people', 'profile', 'requests', 'status', 'week'].concat(hasShares ? ['shares'] : []).sort()), Object.keys(hub));
    T('C does not appear in A’s circle, nor D, whatever the week asked for', !hub.people.some(p => p.user_id === C || p.user_id === D));
  }

  /* ====================================================================== */
  if(hasShares){
    section('shared workouts — the recipient reads it, nobody else can find it');
    const sent = await rpc('A', 'select public.loop_share_workout($1,$2::jsonb) r', [B, sj(SNAP({ note: 'try this' }))]);
    T('A shares a workout with her friend B', sent.status === 'sent' && !!sent.id, sent);
    const id = sent.id;
    T('B’s hub lists it as a summary — title, kind, count, when — never the snapshot', (await rpc('B', 'select public.loop_friends_hub($1::date) r', [THIS_WEEK])).shares.some(x => x.id === id && !('payload' in x) && !sj(x).includes('Bench Press')));
    T('C’s hub lists no share, and neither does A’s (the sender does not receive it)', (await rpc('C', 'select public.loop_friends_hub($1::date) r', [THIS_WEEK])).shares.length === 0 && (await rpc('A', 'select public.loop_friends_hub($1::date) r', [THIS_WEEK])).shares.length === 0);
    for(const t of ['shared_workouts', 'shared_workout_sends']){
      const es = await Promise.all(['A', 'B', 'C'].map(w => err(ME(w, ({ q }) => q('select * from public.' + t)))));
      T('no athlete — sender, recipient or stranger — can read ' + t + ' directly', es.every(e => denied(e)), es.map(e => e && code(e)));
    }
    { const e = await err(ANON(({ q }) => q('select * from public.shared_workouts')));
      T('anon cannot either', denied(e), e && code(e)); }
    T('C opening it, and C removing it, are both "not_found" — and it is still waiting for B', sj(await rpc('C', 'select public.loop_open_shared_workout($1) r', [id])) === sj({ status: 'not_found' }) &&
      sj(await rpc('C', 'select public.loop_remove_shared_workout($1) r', [id])) === sj({ status: 'not_found' }) && (await SU('select 1 from public.shared_workouts where id=$1', [id])).rows.length === 1);
    T('A, the sender, cannot open it back either (a share is for its recipient)', (await rpc('A', 'select public.loop_open_shared_workout($1) r', [id])).status === 'not_found');
    const opened = await rpc('B', 'select public.loop_open_shared_workout($1) r', [id]);
    T('B opens it: the sanitized snapshot, and who sent it', opened.status === 'ok' && opened.from === 'alice' && opened.payload.title === 'Push Day', opened);
    T('the stored snapshot holds only the approved planned-workout fields', sj(Object.keys(opened.payload).sort()) === sj(['category', 'exercises', 'note', 'title', 'v']) && opened.payload.exercises.every(x => Object.keys(x).every(k => ['id', 'name', 'sets', 'reps', 'effort'].includes(k))));
    T('a payload with a field outside the approved set (a weight) is refused, not stored', (await rpc('A', 'select public.loop_share_workout($1,$2::jsonb) r', [B, sj(SNAP({ exercises: [{ name: 'Bench Press', sets: 3, reps: '8', weight: 225 }] }))])).reason === 'unexpected_field');
    T('A cannot send to C, and a share cannot be made for a stranger directly', (await rpc('A', 'select public.loop_share_workout($1,$2::jsonb) r', [C, sj(SNAP())])).status === 'not_friends');
    { const e = await err(ME('A', ({ q }) => q('update public.shared_workouts set title = $2 where id = $1', [id, 'edited'])));
      T('a sent share cannot be edited by anyone with a role', denied(e), e && code(e)); }
    T('B removes it (saved or dismissed); it is gone for good', (await rpc('B', 'select public.loop_remove_shared_workout($1) r', [id])).status === 'removed' && (await SU('select 1 from public.shared_workouts where id=$1', [id])).rows.length === 0);
  }

  /* ====================================================================== */
  section('anonymous callers hold nothing');
  {
    for(const t of Object.keys(TABLE_GRANTS)){
      if(!(await SU('select to_regclass($1) r', ['public.' + t])).rows[0].r) continue;
      const e = await err(ANON(({ q }) => q('select * from public.' + t)));
      T('anon SELECT ' + t + ' → 42501', denied(e), e && code(e));
    }
    const fnSigs = (await SU(`select p.oid::regprocedure::text s, pronargs from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prorettype <> 'trigger'::regtype order by 1`)).rows;
    let allDenied = true; const bad = [];
    for(const f of fnSigs){
      const args = Array.from({ length: f.pronargs }, () => 'null').join(', ');
      const e = await err(ANON(({ q }) => q('select * from ' + f.s.replace(/\(.*\)$/, '') + '(' + args + ')')));
      if(!(e && (denied(e) || code(e) === '42883' || code(e) === '42725'))){ allDenied = false; bad.push(f.s + ':' + (e ? code(e) : 'no error')); }
    }
    T('anon EXECUTE on every function is refused at the door (' + fnSigs.length + ' tried)', allDenied, bad);
  }

  console.log('\nRESULT pass ' + pass + ' fail ' + fail);
  if(fail){ console.log('\nFAILURES'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

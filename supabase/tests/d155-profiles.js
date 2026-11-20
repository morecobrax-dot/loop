'use strict';
/* D155 — friend profiles (migration 0006), proven on a real PostgreSQL.

   Every case is run as the role and the signed-in athlete who would make it,
   with Supabase's default privileges in force (shim.js). A denial must name its
   SQLSTATE, and a "nobody" answer must be byte-identical to the answer for a
   user who does not exist, so the function cannot be used as an oracle.

   The cast:   A (alice)  publishes; B (bob) is A's confirmed friend;
               C (carol) is B's friend and a stranger to A; D (dave) has a
               pending request to A; E (erin) is a stranger with a profile;
               F (finn) was A's friend and is removed; G (gail) holds A's invite
               link and previews it before accepting; H (hana) is A's friend and
               deletes her account; anon is the publishable key and nothing else.

       npm install   (PGlite is a pinned devDependency)
       node supabase/tests/d155-profiles.js                 (all migrations)
       MIG_DIR=<dir> node supabase/tests/d155-profiles.js   (a mutated copy)  */
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
/* a section that throws is a FAILED section, never a crashed run: every other section still runs */
const guard = async (name, fn) => { try{ await fn(); }catch(e){ T(name + ' — the section ran to the end', false, 'threw: ' + (e && e.message)); } };
const code = e => e && (e.code || (e.cause && e.cause.code));
const denied = (e, codes) => !!e && (codes || ['42501']).indexOf(code(e)) !== -1;
/* canonical JSON: jsonb stores an object's keys in its own order, so "the same content" is compared with keys sorted */
const canon = v => Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object') ? Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {}) : v;
const sj = v => JSON.stringify(canon(v));
const mondayOf = d => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };

(async () => {
  const files = ALL();
  if(!files.some(f => f.startsWith('0006'))){ console.error('0006 is not in ' + MIG); process.exit(2); }

  /* ====================================================================== */
  section('the chain applies, twice; 0006 refuses a project without 0005');
  let db;
  { const e = await err((async () => { db = await makeDb({ twice: true }); })());
    T('every migration through 0006 applies on a Supabase-shaped database, and applying them all again is harmless', !e, e && e.message);
    if(e) process.exit(1); }
  { const pre = files.filter(f => f.slice(0, 4) < '0005');
    const db0 = await makeDb({ migrations: pre });
    const e = await err(apply(db0, files.find(f => f.startsWith('0006'))));
    T('0006 applied to a project WITHOUT 0005 stops with an error and creates nothing', !!e && /needs 0005/.test(e.message) &&
      (await db0.query("select to_regclass('public.social_profile_share') r")).rows[0].r === null, e && e.message); }

  const SU = (sql, p) => db.query(sql, p || []);
  const TODAY = (await SU('select current_date::text d')).rows[0].d;
  const THIS_WEEK = mondayOf(new Date(TODAY + 'T12:00:00Z'));
  const LAST_WEEK = mondayOf(new Date(Date.parse(THIS_WEEK + 'T12:00:00Z') - 7 * 864e5));

  const A = await addUser(db, 'a@example.com', 'alice');
  const B = await addUser(db, 'b@example.com', 'bob');
  const C = await addUser(db, 'c@example.com', 'carol');
  const D = await addUser(db, 'd@example.com', 'dave');
  const E = await addUser(db, 'e@example.com', 'erin');
  const F = await addUser(db, 'f@example.com', 'finn');
  const G = await addUser(db, 'g@example.com', 'gail');
  const H = await addUser(db, 'h@example.com', 'hana');
  const AS = { A, B, C, D, E, F, G, H };
  const names = {}; Object.keys(AS).forEach(k => { names[AS[k]] = k; });
  const ME = (who, fn) => as(db, 'authenticated', AS[who], fn);
  const ANON = fn => as(db, 'anon', null, fn);
  const pair = (x, y) => SU('insert into public.friendships(user_a,user_b) values (least($1::uuid,$2::uuid), greatest($1::uuid,$2::uuid)) on conflict do nothing', [x, y]);
  await pair(A, B); await pair(B, C); await pair(A, F); await pair(A, H);
  await SU('insert into public.friend_requests(from_user,to_user) values ($1,$2)', [D, A]);
  for(const u of [A, B, C, F, H]) await SU('insert into public.social_stats(user_id,lifetime_xp,level,rank) values ($1, 2400, 8, $2)', [u, 'TRAINEE']);
  await SU('insert into public.social_weekly(user_id,week_start,weekly_xp,workouts) values ($1,$2,206,1)', [A, THIS_WEEK]);
  await SU('insert into public.social_weekly(user_id,week_start,weekly_xp,workouts) values ($1,$2,0,0)', [F, THIS_WEEK]);
  await SU('insert into public.social_weekly(user_id,week_start,weekly_xp,workouts) values ($1,$2,955,3)', [B, LAST_WEEK]);   /* B: last week only */

  /* an error is a value here, so a regression shows as a failed assertion, not a crashed run */
  const rpc = (who, sql, p) => (who === 'anon' ? ANON(({ one }) => one(sql, p)) : ME(who, ({ one }) => one(sql, p)))
    .then(r => r && r.r).catch(e => ({ status: 'ERROR', error: code(e) || e.message }));
  const share = (who, rec, act) => rpc(who, 'select public.loop_set_profile_sharing($1, $2) r', [rec, act]);
  const publish = (who, seq, rec, act) => rpc(who, 'select public.loop_publish_profile_highlights($1::bigint, $2::jsonb, $3::jsonb) r',
    [seq, rec === null || rec === undefined ? null : sj(rec), act === null || act === undefined ? null : sj(act)]);
  const profile = (who, target, week) => rpc(who, 'select public.loop_friend_profile($1::uuid, $2::date) r', [target, week || THIS_WEEK]);
  const unthrottle = u => SU("update public.social_profile_share set published_at = now() - interval '1 minute' where user_id = $1", [u]);
  const row = async u => (await SU('select * from public.social_profile_share where user_id = $1', [u])).rows[0] || null;

  const REC = [
    { exercise: 'Bench Press', kind: 'weight', load: 185, date: TODAY },
    { exercise: 'Lat Pulldown', kind: 'reps_at_weight', load: 160, reps: 10, date: TODAY },
    { exercise: 'Pull-Up', kind: 'reps', reps: 12, date: TODAY }
  ];
  const ACT = { window_days: 30, through: TODAY, sets: 40, muscles: [{ id: 'chest', sets: 12 }, { id: 'back', sets: 10 }, { id: 'quads', sets: 8 }] };
  const NOT_FOUND = sj({ status: 'not_found' });
  let seq = 1000;

  /* ====================================================================== */
  section('catalog — the table is closed, the functions are the only door');
  await guard("catalog — the table is closed, the functions are the only door", async () => {
    const t = (await SU("select c.relrowsecurity rls, (select count(*)::int from pg_policy p where p.polrelid = c.oid) pol from pg_class c where c.oid = 'public.social_profile_share'::regclass")).rows[0];
    T('social_profile_share has row level security ON and NO policy', t.rls === true && t.pol === 0, sj(t));
    const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
    for(const role of ['anon', 'authenticated']){
      const held = (await SU(`select ${PRIVS.map(p => `has_table_privilege('${role}','public.social_profile_share','${p}') as "${p}"`).join(',')}`)).rows[0];
      T(role + ' holds no privilege at all on social_profile_share', !PRIVS.some(p => held[p]), sj(held));
    }
    const pub = (await SU("select privilege_type from information_schema.table_privileges where table_schema='public' and table_name='social_profile_share' and grantee='PUBLIC'")).rows;
    T('PUBLIC holds nothing on it either', pub.length === 0, sj(pub));
    const fns = (await SU(`select p.proname n, p.prosecdef def, coalesce(array_to_string(p.proconfig, ','), '') cfg,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') auth, has_function_privilege('anon', p.oid, 'EXECUTE') anon
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.proname in ('loop_set_profile_sharing','loop_publish_profile_highlights','loop_friend_profile','loop_profile_records_valid','loop_profile_activity_valid')`)).rows;
    const by = n => fns.find(f => f.n === n) || {};
    for(const n of ['loop_set_profile_sharing', 'loop_publish_profile_highlights', 'loop_friend_profile']){
      const f = by(n);
      T(n + ': SECURITY DEFINER with a fixed search_path, executable by authenticated and not by anon', f.def === true && /search_path=public/.test(f.cfg) && f.auth === true && f.anon === false, sj(f));
    }
    for(const n of ['loop_profile_records_valid', 'loop_profile_activity_valid']){
      const f = by(n);
      T(n + ': not a definer, a fixed search_path, executable by no client role', f.def === false && /search_path=pg_catalog/.test(f.cfg) && f.auth === false && f.anon === false, sj(f));
    }
    const src = (await SU("select string_agg(pg_get_functiondef(p.oid), ' ') d from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'loop_friend_profile'")).rows[0].d || '';
    T('loop_friend_profile decides access from auth.uid() and public.friendships (via loop_are_friends), never from a caller-supplied flag', /me uuid := auth\.uid\(\)/.test(src) && /loop_are_friends\(me, p_athlete\)/.test(src) && !/p_is_friend|p_viewer|p_me\b/.test(src));
  });

  /* ====================================================================== */
  section('consent — off by default; a friendship alone shares nothing new');
  await guard("consent — off by default; a friendship alone shares nothing new", async () => {
    const p = await profile('B', A);
    T('2/3  B (a confirmed friend) reads A before A switches anything on: level, rank and the week, and no records or activity', p.status === 'ok' && p.person.username === 'alice' &&
      p.records.shared === false && p.records.items === null && p.activity.shared === false && p.activity.data === null, sj(p));
    T('the week: A published 206 XP and 1 workout for THIS week', p.person.week_xp === 206 && p.person.week_workouts === 1, sj(p.person));
    const r0 = await publish('A', ++seq, REC, null);
    T('A cannot publish records while records sharing is off (not_shared), and nothing is stored', r0.status === 'not_shared' && (await row(A)) === null, sj(r0));
    const s1 = await share('A', true, null);
    T('A turns on personal records only', s1.status === 'ok' && s1.share_records === true && s1.share_activity === false, sj(s1));
    const r1 = await publish('A', ++seq, REC, ACT);
    T('6  publishing activity with records-only consent is refused (not_shared) — and the records in the same call are not stored either', r1.status === 'not_shared' && (await row(A)).records === null, sj(r1));
    const r2 = await publish('A', ++seq, REC, null);
    T('A publishes her three records', r2.status === 'published', sj(r2));
    const p2 = await profile('B', A);
    T('2  B now reads A’s three records exactly as published', p2.records.shared === true && sj(p2.records.items) === sj(REC) && !!p2.records.updated_at, sj(p2.records));
    T('3  …and still NOT her activity: consent for records is not consent for muscles', p2.activity.shared === false && p2.activity.data === null, sj(p2.activity));
    await unthrottle(A);
    await share('A', null, true);
    const r3 = await publish('A', ++seq, null, ACT);
    T('A turns on activity and publishes it, leaving her records as they were', r3.status === 'published' && sj((await row(A)).records) === sj(REC), sj(r3));
    const p3 = await profile('B', A);
    T('25  B reads both, as a legitimate signed-in friend', p3.records.shared && p3.activity.shared && sj(p3.activity.data) === sj(ACT), sj(p3));
    const self = await profile('A', A);
    T('1  A reads her own profile: is_self, both summaries', self.status === 'ok' && self.person.is_self === true && sj(self.records.items) === sj(REC) && sj(self.activity.data) === sj(ACT), sj(self));
    T('nothing in a profile answer is an email or an invite code', !/@example\.com/.test(sj(p3)) && !sj(p3).includes((await SU('select invite_code from public.profiles where user_id=$1', [A])).rows[0].invite_code));
    T('a profile answer holds exactly the person’s shared fields', sj(Object.keys(p3.person).sort()) === sj(['friends_since', 'is_self', 'level', 'lifetime_xp', 'rank', 'stats_updated_at', 'user_id', 'username', 'week_updated_at', 'week_workouts', 'week_xp']) &&
      sj(Object.keys(p3).sort()) === sj(['activity', 'person', 'records', 'status', 'week']), sj(Object.keys(p3)));
  });

  /* ====================================================================== */
  section('who may read — confirmed friends only, decided at the moment of the read');
  await guard("who may read — confirmed friends only, decided at the moment of the read", async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    const nobody = await profile('C', ghost);
    T('a user id that does not exist answers not_found', sj(nobody) === NOT_FOUND, sj(nobody));
    const c = await profile('C', A);
    T('4  C (B’s friend, a stranger to A) cannot read A through B: the same answer as nobody', sj(c) === NOT_FOUND, sj(c));
    T('   (C reading her own friend B works — the path is open, A is simply not hers)', (await profile('C', B)).status === 'ok');
    const d = await profile('D', A);
    T('5  D, with a PENDING request to A, cannot read A', sj(d) === NOT_FOUND, sj(d));
    T('   nor A read D: a pending request grants nothing in either direction', sj(await profile('A', D)) === NOT_FOUND);
    const e = await profile('E', A);
    T('6  E, a stranger who knows A’s user id, cannot read A', sj(e) === NOT_FOUND, sj(e));
    T('14 an arbitrary or null id grants nothing', sj(await profile('E', null)) === NOT_FOUND && sj(await profile('B', ghost)) === NOT_FOUND);
    T('   a week that is not a Monday is refused before any lookup', (await profile('B', A, LAST_WEEK.slice(0, 8) + String(Number(LAST_WEEK.slice(8)) + 1).padStart(2, '0'))).status === 'invalid_week');
    const forged = await err(ME('E', ({ q }) => q("select public.loop_friend_profile(p_athlete => $1::uuid, p_week => $2::date, p_is_friend => true) r", [A, THIS_WEEK])));
    T('7  a caller-supplied "is friend" flag is not something the server accepts (no such argument: 42883)', denied(forged, ['42883']), forged && code(forged));

    /* the invite link: a preview is not acceptance */
    const link = await rpc('A', 'select public.loop_create_invite_link() r');
    T('A makes an invite link (the existing flow still works)', link.status === 'created' && /^[A-Za-z0-9_-]{43}$/.test(link.token), sj(link));
    const pv = await rpc('G', 'select public.loop_preview_invite_link($1) r', [link.token]);
    T('G previews A’s link and sees her username', pv.status === 'ok' && pv.username === 'alice', sj(pv));
    T('10 holding (and previewing) the link grants G no profile access', sj(await profile('G', A)) === NOT_FOUND);
    const acc = await rpc('G', 'select public.loop_accept_invite_link($1) r', [link.token]);
    const g2 = await profile('G', A);
    T('16 G accepts the link (the existing flow) — and only now reads A, with the records A shares', acc.status === 'connected' && g2.status === 'ok' && g2.records.shared === true, sj([acc, g2.status]));

    /* removal */
    T('F, A’s friend, reads A', (await profile('F', A)).status === 'ok');
    const rm = await rpc('A', 'select public.loop_remove_friend($1::uuid) r', [F]);
    const f2 = await profile('F', A);
    T('7/24 A removes F; F’s very next read is not_found — nothing to refresh, nothing cached on the server', rm === 'removed' && sj(f2) === NOT_FOUND, sj([rm, f2]));
    T('   and A cannot read F any more either', sj(await profile('A', F)) === NOT_FOUND);
  });

  /* ====================================================================== */
  section('revocation and re-enabling — turning a switch off erases what it published');
  await guard("revocation and re-enabling — turning a switch off erases what it published", async () => {
    await share('A', false, null);
    const r = await row(A);
    T('8  A turns records off: the stored records are erased in the same statement (null), activity untouched', r.share_records === false && r.records === null && r.records_at === null && sj(r.activity) === sj(ACT), sj(r));
    const b = await profile('B', A);
    T('8  B’s next read has no records — and still has the activity A shares', b.records.shared === false && b.records.items === null && b.activity.shared === true, sj(b));
    await share('A', true, null);
    const b2 = await profile('B', A);
    T('9  A turns records on again: nothing comes back by itself — the old records are gone, not hidden', b2.records.shared === true && b2.records.items === null, sj(b2.records));
    await unthrottle(A);
    const REC2 = [{ exercise: 'Back Squat', kind: 'weight', load: 225, date: TODAY }];
    const p = await publish('A', ++seq, REC2, null);
    T('9  she publishes fresh records; current friends see them', p.status === 'published' && sj(((await profile('B', A)).records || {}).items) === sj(REC2), sj(p));
    T('9  …and only current friends: not the removed F, not the stranger E, not B’s friend C', [await profile('F', A), await profile('E', A), await profile('C', A)].every(x => sj(x) === NOT_FOUND));
    await share('A', null, false);
    T('A turns activity off: erased at once too', ((await row(A)) || {}).activity === null && ((await profile('B', A)).activity || {}).data === null);
    await share('A', null, true);
    await unthrottle(A);
    await publish('A', ++seq, null, ACT);
  });

  /* ====================================================================== */
  section('nobody else can write, read the table, or act for another athlete');
  await guard("nobody else can write, read the table, or act for another athlete", async () => {
    const before = sj(await row(A));
    const e1 = await err(ME('B', ({ q }) => q('select * from public.social_profile_share')));
    T('13 a signed-in athlete cannot SELECT the table directly (42501)', denied(e1), e1 && code(e1));
    const e2 = await err(ME('B', ({ q }) => q('insert into public.social_profile_share(user_id, share_records, records) values ($1, true, $2::jsonb)', [A, sj(REC)])));
    T('11 B cannot INSERT a row for A (42501)', denied(e2), e2 && code(e2));
    const e3 = await err(ME('B', ({ q }) => q('update public.social_profile_share set share_activity = false where user_id = $1', [A])));
    T('12 B cannot UPDATE A’s consent directly (42501)', denied(e3), e3 && code(e3));
    const e4 = await err(ME('A', ({ q }) => q('delete from public.social_profile_share where user_id = $1', [A])));
    const e5 = await err(ME('A', ({ q }) => q('truncate public.social_profile_share')));
    T('not even the owner deletes or truncates it directly (42501) — the functions are the only door', denied(e4) && denied(e5), [e4, e5].map(code));
    const bp = await publish('B', ++seq, REC, ACT);
    const bs = await share('B', false, false);
    T('11/12 B’s own calls touch only B’s row: B has no consent so B publishes nothing, and B’s switches create B’s row alone', bp.status === 'not_shared' && bs.status === 'ok' && sj(await row(A)) === before, sj([bp, bs]));
    /* two athletes who both share: each publication lands on its publisher's row and nobody else's */
    await share('B', true, true);
    const BREC = [{ exercise: 'Leg Press', kind: 'weight', load: 410, date: TODAY }];
    const bpub = await publish('B', ++seq, BREC, ACT);
    await unthrottle(A);
    const apub = await publish('A', ++seq, REC, ACT);
    T('8  with both sharing, B’s publication is B’s and A’s is A’s: neither lands on the other’s row', bpub.status === 'published' && apub.status === 'published' &&
      sj(((await row(B)) || {}).records) === sj(BREC) && sj(((await row(A)) || {}).records) === sj(REC) && sj(((await profile('A', B)).records || {}).items) === sj(BREC), sj([bpub, apub]));
    await share('B', false, false);
    T('   B switches both off again: B’s row is empty, A’s untouched', ((await row(B)) || {}).records === null && sj(((await row(A)) || {}).records) === sj(REC));
    for(const [n, sql, p] of [['loop_friend_profile', 'select public.loop_friend_profile($1::uuid, $2::date)', [A, THIS_WEEK]],
                              ['loop_set_profile_sharing', 'select public.loop_set_profile_sharing(true, true)', []],
                              ['loop_publish_profile_highlights', 'select public.loop_publish_profile_highlights(1, $1::jsonb, null)', [sj(REC)]]]){
      const e = await err(ANON(({ q }) => q(sql, p)));
      T('10 anon cannot execute ' + n + ' (42501)', denied(e), e && code(e));
    }
    const e6 = await err(ANON(({ q }) => q('select * from public.social_profile_share')));
    T('10 anon cannot read the table (42501)', denied(e6), e6 && code(e6));
    const N = (await SU("insert into auth.users(email) values ('n@example.com') returning id")).rows[0].id;
    const np = await as(db, 'authenticated', N, ({ one }) => one('select public.loop_set_profile_sharing(true, true) r')).then(r => r.r);
    T('a signed-in account with no LOOP profile gets no_profile from the switches, and no row', np.status === 'no_profile' && (await row(N)) === null, sj(np));
    const bad = await err(as(db, 'authenticated', N, ({ q }) => q("insert into public.profiles(user_id, username, username_key) values ($1,'<b>x','<b>x')", [N])));
    T('22 a username cannot carry markup at all — 0001’s shape check refuses it (23514), and the client escapes every name besides', code(bad) === '23514', bad && code(bad));
  });

  /* ====================================================================== */
  section('payloads — exactly the published shapes; anything else changes nothing');
  await guard("payloads — exactly the published shapes; anything else changes nothing", async () => {
    await unthrottle(A);
    const stored = sj(await row(A));
    const R = (o) => Object.assign({ exercise: 'Bench Press', kind: 'weight', load: 185, date: TODAY }, o);
    const BAD_RECORDS = {
      'an unknown key (notes)': [R({ notes: 'felt heavy' })],
      'an authorization-looking key (is_friend)': [R({ is_friend: true })],
      'four records': [R(), R({ exercise: 'Row' }), R({ exercise: 'Squat' }), R({ exercise: 'Press' })],
      'the same exercise twice (any case)': [R(), R({ exercise: 'bench press' })],
      'an estimated 1RM (kind 1rm)': [R({ kind: '1rm' })],
      'a session-volume record (kind volume)': [R({ kind: 'volume' })],
      'weight with a reps key': [R({ reps: 5 })],
      'reps without its reps': [{ exercise: 'Pull-Up', kind: 'reps', date: TODAY }],
      'a load given as text': [R({ load: '185' })],
      'a negative load': [R({ load: -5 })],
      'a load over 2000 lb': [R({ load: 2001 })],
      'a load with three decimals': [R({ load: 185.125 })],
      'zero reps': [{ exercise: 'Pull-Up', kind: 'reps', reps: 0, date: TODAY }],
      'fractional reps': [{ exercise: 'Pull-Up', kind: 'reps', reps: 7.5, date: TODAY }],
      'a 61-character name': [R({ exercise: 'X'.repeat(61) })],
      'a name with markup': [R({ exercise: '<img src=x onerror=alert(1)>' })],
      'a name with a control character': [R({ exercise: 'Bench\u0007Press' })],
      'an empty name': [R({ exercise: '' })],
      'a padded name': [R({ exercise: ' Bench Press' })],
      'an impossible date': [R({ date: '2026-13-40' })],
      'a date in the future': [R({ date: '2099-01-01' })],
      'a nested object': [R({ load: { v: 185 } })],
      'an object instead of a list': R(),
      'a huge list': Array.from({ length: 200 }, (_, i) => R({ exercise: 'Lift ' + i }))
    };
    for(const [why, bad] of Object.entries(BAD_RECORDS)){
      const r = await publish('A', ++seq, bad, null);
      T('21/23 records refused — ' + why, r.status === 'invalid_payload', sj(r));
    }
    const Ab = o => Object.assign({}, ACT, o);
    const BAD_ACT = {
      'an unknown key (notes)': Ab({ notes: 'x' }),
      'a window that is not 30 days': Ab({ window_days: 28 }),
      'the retired four-week shape (window_weeks)': (() => { const o = Ab({ window_weeks: 4 }); delete o.window_days; return o; })(),
      'a streak (no longer part of the summary)': Ab({ streak_weeks: 6 }),
      'a window ending long ago': Ab({ through: '2020-01-06' }),
      'an unknown muscle': Ab({ muscles: [{ id: 'forearms', sets: 3 }] }),
      'a muscle with more sets than were performed': Ab({ muscles: [{ id: 'chest', sets: 41 }] }),
      'muscles out of order': Ab({ muscles: [{ id: 'chest', sets: 5 }, { id: 'back', sets: 9 }] }),
      'the same muscle twice': Ab({ muscles: [{ id: 'chest', sets: 9 }, { id: 'chest', sets: 9 }] }),
      'four muscles': Ab({ muscles: [{ id: 'chest', sets: 9 }, { id: 'back', sets: 8 }, { id: 'quads', sets: 7 }, { id: 'abs', sets: 6 }] }),
      'muscles with zero sets in total': Ab({ sets: 0, muscles: [{ id: 'chest', sets: 1 }] }),
      'a muscle row with an extra key': Ab({ muscles: [{ id: 'chest', sets: 9, bodyweight: 180 }] }),
      'a list instead of an object': [ACT]
    };
    for(const [why, bad] of Object.entries(BAD_ACT)){
      const r = await publish('A', ++seq, null, bad);
      T('21/23 activity refused — ' + why, r.status === 'invalid_payload', sj(r));
    }
    T('15 and after all of that, what A had published is exactly what is stored', sj(await row(A)) === stored);
    const zero = await publish('A', ++seq, null, Ab({ sets: 0, muscles: [] }));
    T('a quiet month is a real answer: 0 sets and no muscles is accepted (it is not the same as not shared)', zero.status === 'published', sj(zero));
    const big = await publish('A', ++seq, null, null);
    T('a call that publishes nothing is refused', big.status === 'invalid_payload', sj(big));
    const neg = await publish('A', -1, REC, null);
    T('a sequence that is not positive is refused', neg.status === 'invalid_payload', sj(neg));
  });

  /* ====================================================================== */
  section('ordering — a replayed or retried older publication never wins; publishing is throttled');
  await guard("ordering — a replayed or retried older publication never wins; publishing is throttled", async () => {
    await unthrottle(A);
    const now = ++seq;
    const REC3 = [{ exercise: 'Deadlift', kind: 'weight', load: 315, date: TODAY }];
    const ok = await publish('A', now, REC3, null);
    await unthrottle(A);
    const old = await publish('A', now - 5, REC, null);
    T('27 an older sequence arriving after a newer one is refused (stale) and does not overwrite it', ok.status === 'published' && old.status === 'stale' && sj((await row(A)).records) === sj(REC3), sj(old));
    const same = await publish('A', now, REC, null);
    T('   the same sequence twice is refused too', same.status === 'stale', sj(same));
    await unthrottle(A);
    const first = await publish('A', ++seq, REC, null);
    const second = await publish('A', ++seq, REC3, null);
    T('19 at most one publication every 10 seconds: the second inside the window is refused (too_frequent) and stores nothing', first.status === 'published' && second.status === 'too_frequent' && sj((await row(A)).records) === sj(REC), sj([first, second]));
    await unthrottle(A);
    const third = await publish('A', ++seq, REC3, null);
    T('   …and once the window has passed, the next publication lands', third.status === 'published' && sj((await row(A)).records) === sj(REC3), sj(third));
  });

  /* ====================================================================== */
  section('the week — missing is not zero, and a new week inherits nothing');
  await guard("the week — missing is not zero, and a new week inherits nothing", async () => {
    const b = await profile('A', B);
    T('B published LAST week only: this week reads null XP and null workouts — never 0', b.status === 'ok' && b.person.week_xp === null && b.person.week_workouts === null, sj(b.person));
    const bl = await profile('A', B, LAST_WEEK);
    T('…and asking for last week gives last week’s numbers', bl.person.week_xp === 955 && bl.person.week_workouts === 3, sj(bl.person));
    await pair(A, F);
    const f = await profile('A', F);
    T('F published an honest zero for this week: 0 is shown as 0, distinct from missing', f.person.week_xp === 0 && f.person.week_workouts === 0, sj(f.person));
    const hub = await rpc('A', 'select public.loop_friends_hub($1::date) r', [THIS_WEEK]);
    const pa = (hub.people || []).find(p => p.user_id === A);
    const pr = await profile('A', A);
    T('the profile and the hub agree on every shared number (one week definition: the caller’s Monday)', pa && pa.week_xp === pr.person.week_xp && pa.week_workouts === pr.person.week_workouts && pa.level === pr.person.level && pa.rank === pr.person.rank, sj([pa, pr.person]));
  });

  /* ====================================================================== */
  section('the existing system is untouched — the hub, shared workouts, deletion');
  await guard("the existing system is untouched — the hub, shared workouts, deletion", async () => {
    const hub = await rpc('B', 'select public.loop_friends_hub($1::date) r', [THIS_WEEK]);
    const KEYS = ['friends_since', 'is_self', 'level', 'lifetime_xp', 'prev_workouts', 'prev_xp', 'rank', 'stats_updated_at', 'user_id', 'username', 'week_updated_at', 'week_workouts', 'week_xp'];
    T('17 loop_friends_hub returns exactly its old person fields, and none of the new summaries', hub.status === 'ok' && (hub.people || []).every(p => sj(Object.keys(p).sort()) === sj(KEYS)) && !/Deadlift|Bench Press|window_days|muscles/.test(sj(hub)), sj(Object.keys((hub.people || [])[0] || {})));
    if(files.some(f => f.startsWith('0003'))){
      const snap = { v: 1, title: 'Push Day', category: 'push', exercises: [{ name: 'Bench Press', sets: 3, reps: '8' }] };
      const s1 = await rpc('A', 'select public.loop_share_workout($1::uuid, $2::jsonb) r', [B, sj(snap)]);
      const s2 = await rpc('E', 'select public.loop_share_workout($1::uuid, $2::jsonb) r', [A, sj(snap)]);
      T('18 sharing a workout still works between friends and is still refused to a stranger', s1.status === 'sent' && s2.status === 'not_friends', sj([s1, s2]));
    }
    await share('H', true, true);
    await publish('H', ++seq, [{ exercise: 'Hip Thrust', kind: 'weight', load: 275, date: TODAY }], null);
    T('H shares records with her friend A', ((((await profile('A', H)) || {}).records || {}).items || []).length === 1);
    const del = await rpc('H', 'select public.loop_delete_account() r');
    T('15 H deletes her account: her published summaries are gone from the database (cascade), not merely hidden', del === 'deleted' && (await row(H)) === null &&
      (await SU("select count(*)::int n from public.social_profile_share where records::text like '%Hip Thrust%'")).rows[0].n === 0, del);
    T('15 …and A reading H gets not_found', sj(await profile('A', H)) === NOT_FOUND);
  });

  /* ====================================================================== */
  section('old-client compatibility — 0006 changes no object that existed before it');
  await guard("old-client compatibility — 0006 changes no object that existed before it", async () => {
    const pre = files.filter(f => f.slice(0, 4) < '0006');
    const dbA = await makeDb({ migrations: pre });
    const snap = async (d) => {
      const out = {};
      out.fns = (await d.query(`select p.oid::regprocedure::text sig, md5(pg_get_functiondef(p.oid)) h, coalesce(array_to_string(p.proacl, ','), '') acl
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`)).rows;
      out.pol = (await d.query(`select polrelid::regclass::text t, polname, pg_get_expr(polqual, polrelid) q, pg_get_expr(polwithcheck, polrelid) w from pg_policy order by 1, 2`)).rows;
      out.tab = (await d.query(`select table_name, grantee, privilege_type from information_schema.table_privileges where table_schema = 'public' order by 1, 2, 3`)).rows;
      out.col = (await d.query(`select table_name, column_name, grantee, privilege_type from information_schema.column_privileges where table_schema = 'public' order by 1, 2, 3, 4`)).rows;
      out.con = (await d.query(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`)).rows;
      return out;
    };
    const before = await snap(dbA);
    await apply(dbA, files.find(f => f.startsWith('0006')));
    const after = await snap(dbA);
    const old = (list, key) => list.filter(x => !/social_profile_share|loop_set_profile_sharing|loop_publish_profile_highlights|loop_friend_profile|loop_profile_records_valid|loop_profile_activity_valid/.test(sj(x)));
    T('every function that existed before 0006 has the same definition and the same grants after it', sj(before.fns) === sj(old(after.fns)), sj(after.fns.length));
    T('every policy is unchanged', sj(before.pol) === sj(old(after.pol)));
    T('every table grant is unchanged', sj(before.tab) === sj(old(after.tab)));
    T('every column grant is unchanged', sj(before.col) === sj(old(after.col)));
    T('every constraint is unchanged', sj(before.con) === sj(old(after.con)));
    T('0006 adds exactly one table and five functions', after.fns.length - before.fns.length === 5 &&
      (await dbA.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'")).rows[0].n ===
      (await makeDb({ migrations: pre }).then(d => d.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'"))).rows[0].n + 1);
    await apply(dbA, files.find(f => f.startsWith('0006')));
    T('applying 0006 a second time changes nothing', sj(await snap(dbA)) === sj(after));
    /* SOCIAL-SETUP.md's "to undo it entirely", verbatim in effect */
    await dbA.exec(`drop function if exists public.loop_friend_profile(uuid, date);
drop function if exists public.loop_publish_profile_highlights(bigint, jsonb, jsonb);
drop function if exists public.loop_set_profile_sharing(boolean, boolean);
drop function if exists public.loop_profile_records_valid(jsonb);
drop function if exists public.loop_profile_activity_valid(jsonb);
drop table if exists public.social_profile_share;`);
    T('the documented rollback returns the catalog exactly to what it was before 0006', sj(await snap(dbA)) === sj(before));
  });

  console.log('\nRESULT pass ' + pass + ' fail ' + fail);
  if(fail){ console.log('FAILURES'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

'use strict';
/* D155 — does the database notice when the friend-profile boundary is taken away?

   Each mutant is ONE deliberate regression in a COPY of the migrations (0006, or
   an earlier file it relies on), run through BOTH real-Postgres suites —
   d155-profiles.js and e9-security.js — by pointing MIG_DIR at the copy. A
   mutant is killed when either fails. Each kill is also classed: BEHAVIOUR when
   a behavioural assertion failed (an athlete could read, write or keep something
   they must not), CATALOG when only a privilege/definition check did. The repo's
   migrations are never touched.

       npm install   (PGlite is a pinned devDependency)
       node supabase/tests/d155-mutations.js [D1,D5,...]                         */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const SRC = path.join(__dirname, '..', 'migrations');
const SUITES = [path.join(__dirname, 'd155-profiles.js'), path.join(__dirname, 'e9-security.js')];
const ONLY = (process.argv[2] || '').split(',').filter(Boolean);
const R = (from, to) => ({ from, to });
const ALLOW = "  if p_athlete <> me and not coalesce(public.loop_are_friends(me, p_athlete), false) then\n";

/* [id, file prefix, what it does (the brief's mutant number where there is one), edit(s)] */
const MUTANTS = [
  ['D1', '0006', '#1 a stranger reads a profile (the friendship check is removed)',
    [R(ALLOW + "    return jsonb_build_object('status', 'not_found');\n  end if;\n", '')]],
  ['D2', '0006', '#2 a pending request grants profile access',
    [R(ALLOW, "  if p_athlete <> me and not (coalesce(public.loop_are_friends(me, p_athlete), false) or exists (select 1 from public.friend_requests r where (r.from_user = me and r.to_user = p_athlete) or (r.from_user = p_athlete and r.to_user = me))) then\n")]],
  ['D3', '0006', '#3 a friend of a friend is granted access',
    [R(ALLOW, "  if p_athlete <> me and not (coalesce(public.loop_are_friends(me, p_athlete), false) or exists (select 1 from public.friendships f1, public.friendships f2 where (me in (f1.user_a, f1.user_b)) and (p_athlete in (f2.user_a, f2.user_b)) and (f1.user_a in (f2.user_a, f2.user_b) or f1.user_b in (f2.user_a, f2.user_b)))) then\n")]],
  ['D4', '0006', '#4 a removed friend keeps access (the audience is captured when the athlete publishes, not decided at the read)',
    [R('  seq             bigint not null default 0,\n', "  seq             bigint not null default 0,\n  audience        uuid[] not null default '{}',\n"),
     R('         seq          = p_seq,\n', '         seq          = p_seq,\n         audience     = array(select case when f.user_a = me then f.user_b else f.user_a end from public.friendships f where f.user_a = me or f.user_b = me),\n'),
     R(ALLOW, "  if p_athlete <> me and not (coalesce(public.loop_are_friends(me, p_athlete), false) or me = any(coalesce((select x.audience from public.social_profile_share x where x.user_id = p_athlete), '{}'::uuid[]))) then\n")]],
  ['D5', '0006', '#5 consent OFF still returns highlights (switching off neither erases nor hides)',
    [R("         records        = case when coalesce(p_records, s.share_records) then s.records else null end,\n         records_at     = case when coalesce(p_records, s.share_records) then s.records_at else null end,\n", ''),
     R("  constraint social_profile_share_records_need_consent check (share_records or (records is null and records_at is null)),\n", ''),
     R("       'items', case when coalesce(s.share_records, false) then s.records end,", "       'items', s.records,")]],
  ['D6', '0006', '#6 consent for records grants muscle activity too',
    [R("     or (p_activity is not null and not r.share_activity) then", "     or (p_activity is not null and not r.share_records) then"),
     R("  constraint social_profile_share_activity_need_consent check (share_activity or (activity is null and activity_at is null)),\n", ''),
     R("       'shared', coalesce(s.share_activity, false),\n       'data', case when coalesce(s.share_activity, false) then s.activity end,", "       'shared', coalesce(s.share_records, false),\n       'data', case when coalesce(s.share_records, false) then s.activity end,")]],
  ['D7', '0006', '#7 a client-supplied "is friend" flag bypasses the server check',
    [R('create or replace function public.loop_friend_profile(p_athlete uuid, p_week date)', 'create or replace function public.loop_friend_profile(p_athlete uuid, p_week date, p_is_friend boolean default false)'),
     R(ALLOW, '  if p_athlete <> me and not p_is_friend and not coalesce(public.loop_are_friends(me, p_athlete), false) then\n'),
     R('revoke execute on function public.loop_friend_profile(uuid, date)                         from public, anon;', 'revoke execute on function public.loop_friend_profile(uuid, date, boolean)                from public, anon;'),
     R('grant execute on function public.loop_friend_profile(uuid, date)                         to authenticated;', 'grant execute on function public.loop_friend_profile(uuid, date, boolean)                to authenticated;')]],
  ['D8', '0006', '#8 a publication writes to every consenting athlete’s row (the owner predicate is replaced by consent)',
    [R("         updated_at   = now()\n   where user_id = me;\n\n  return jsonb_build_object('status', 'published'", "         updated_at   = now()\n   where share_records and share_activity;\n\n  return jsonb_build_object('status', 'published'")]],
  ['D9', '0006', '#9 direct table SELECT exposes every athlete’s highlights (a grant and a permissive policy)',
    [R('revoke all on table public.social_profile_share from public, anon, authenticated;', "revoke all on table public.social_profile_share from public, anon, authenticated;\ngrant select on table public.social_profile_share to authenticated;\ndrop policy if exists social_profile_share_select on public.social_profile_share;\ncreate policy social_profile_share_select on public.social_profile_share for select to authenticated using (true);")]],
  ['D10', '0006', '#10 holding an invite link (a live one exists) grants profile access',
    [R(ALLOW, "  if p_athlete <> me and not (coalesce(public.loop_are_friends(me, p_athlete), false) or exists (select 1 from public.friend_invites i where i.inviter = p_athlete and i.revoked_at is null and i.expires_at > now())) then\n")]],
  ['D11', '0006', '#11 an anonymous caller may read profiles',
    [R('grant execute on function public.loop_friend_profile(uuid, date)                         to authenticated;', 'grant execute on function public.loop_friend_profile(uuid, date)                         to authenticated, anon;')]],
  ['D13', '0006', '#13 a records payload may carry unknown keys (a "notes" or any history rides along)',
    [R("    if keys is distinct from want then return false; end if;\n", '')]],
  ['D13b', '0006', '#13 an activity payload may carry unknown keys',
    [R("  if keys is distinct from array['muscles','sets','through','window_days'] then return false; end if;\n", '')]],
  ['D14', '0006', '#14 a deleted account leaves its summaries behind (no cascade from profiles)',
    [R('  user_id         uuid primary key references public.profiles(user_id) on delete cascade,', '  user_id         uuid primary key,')]],
  ['D15', '0006', '#15 an unbounded records list is accepted (the three-record bound is removed)',
    [R('  if jsonb_array_length(p) > 3 or octet_length(p::text) > 2048 then return false; end if;\n', ''),
     R("records is null or (jsonb_typeof(records) = 'array' and jsonb_array_length(records) <= 3 and octet_length(records::text) <= 2048)", "records is null or jsonb_typeof(records) = 'array'")]],
  ['D16', '0006', 'switching records off hides them but no longer erases them (they come back on re-enable)',
    [R("         records        = case when coalesce(p_records, s.share_records) then s.records else null end,\n         records_at     = case when coalesce(p_records, s.share_records) then s.records_at else null end,\n", ''),
     R("  constraint social_profile_share_records_need_consent check (share_records or (records is null and records_at is null)),\n", '')]],
  ['D17', '0006', '#27 a replayed older publication overwrites a newer one (the sequence check is removed)',
    [R("  if p_seq <= r.seq then\n    return jsonb_build_object('status', 'stale', 'seq', r.seq);\n  end if;\n", '')]],
  ['D18', '0006', 'publishing is no longer throttled',
    [R("  if r.published_at is not null and r.published_at > now() - interval '10 seconds' then\n    return jsonb_build_object('status', 'too_frequent');\n  end if;\n", '')]],
  ['D19', '0006', 'loop_friend_profile loses its fixed search_path',
    [R('stable\nsecurity definer\nset search_path = public\nas $$\ndeclare\n  me uuid := auth.uid();\n  s  public.social_profile_share%rowtype;', 'stable\nsecurity definer\nas $$\ndeclare\n  me uuid := auth.uid();\n  s  public.social_profile_share%rowtype;')]],
  ['D20', '0006', '#21 a missing week is shown as a verified zero',
    [R("           'week_xp', w.weekly_xp,\n           'week_workouts', w.workouts,", "           'week_xp', coalesce(w.weekly_xp, 0),\n           'week_workouts', coalesce(w.workouts, 0),")]],
  ['D21', '0006', '#36 markup is accepted in an exercise name',
    [R("    if nm ~ '[[:cntrl:]<>]' then return false; end if;\n", "    if nm ~ '[[:cntrl:]]' then return false; end if;\n")]],
  ['D22', '0006', '#29 an estimated record (1RM) is accepted as a personal record',
    [R("              when 'reps'           then array['date','exercise','kind','reps']\n", "              when 'reps'           then array['date','exercise','kind','reps']\n              when '1rm'            then array['date','exercise','kind','load']\n"),
     R("    if kind in ('weight', 'reps_at_weight') then", "    if kind in ('weight', 'reps_at_weight', '1rm') then")]],
  ['D23', '0006', 'a record dated in the future is accepted',
    [R('    if dt < date \'2000-01-01\' or dt > current_date + 2 then return false; end if;\n', "    if dt < date '2000-01-01' then return false; end if;\n")]],
  ['D24', '0006', 'muscles out of order pass as "the top three"',
    [R('    if prev is not null and num > prev then return false; end if;\n', '')]],
  ['D25', '0006', '#33 a muscle may claim more sets than were performed',
    [R('    if num < 1 or num > total or num <> trunc(num) then return false; end if;\n', '    if num < 1 or num <> trunc(num) then return false; end if;\n')]],
  ['D26', '0006', '0006 applies to a project without the 0005 security closure',
    [R("    raise exception '0006 needs 0005 (the security closure) applied first';\n", "    null;\n")]],
  ['D27', '0006', 'the validators are executable by signed-in athletes (a payload oracle outside the functions)',
    [R('revoke execute on function public.loop_profile_records_valid(jsonb)  from public, anon, authenticated;', 'revoke execute on function public.loop_profile_records_valid(jsonb)  from public, anon;\ngrant execute on function public.loop_profile_records_valid(jsonb) to authenticated;')]],
  ['D28', '0005', '#54 loop_are_friends answers about any two UUIDs again — which 0006’s read relies on',
    [R('     and auth.uid() in (a, b)\n     and exists (\n       select 1 from public.friendships f', '     and exists (\n       select 1 from public.friendships f')]]
];

const CATALOG = /holds no privilege|PUBLIC holds nothing|SECURITY DEFINER with a fixed search_path|not a definer, a fixed search_path|unclassified|can execute exactly|executable by no client role|anon can execute no function|authenticated holds exactly|anon holds nothing|search_path|decides access from auth\.uid\(\)/;
function run(suite, dir){
  const r = spawnSync(process.execPath, [suite], { encoding: 'utf8', timeout: 900000, maxBuffer: 1 << 26, env: Object.assign({}, process.env, { MIG_DIR: dir }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = /RESULT pass (\d+) fail (\d+)/.exec(out);
  const fails = out.split('\n').filter(l => /^\s*FAIL\s/.test(l)).map(l => l.trim());
  return { code: r.status, pass: m ? +m[1] : null, fail: m ? +m[2] : null, fails, tail: out.slice(-400) };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-d155-mut-'));
const files = fs.readdirSync(SRC).filter(f => /\.sql$/.test(f));
/* LF copies, as git stores them (a CRLF checkout would break multi-line anchors) */
const reset = () => files.forEach(f => fs.writeFileSync(path.join(tmp, f), fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\r\n/g, '\n')));
reset();
for(const s of SUITES){
  const b = run(s, tmp);
  console.log('baseline ' + path.basename(s) + ': pass ' + b.pass + ', fail ' + b.fail);
  if(b.fail !== 0 || b.code !== 0){ console.log(b.tail); process.exit(1); }
}

let killed = 0; const survived = [], broken = [], catalogOnly = [], crashOnly = [];
for(const [id, prefix, what, edits] of MUTANTS){
  if(ONLY.length && ONLY.indexOf(id) === -1) continue;
  reset();
  const f = files.find(x => x.startsWith(prefix));
  let text = fs.readFileSync(path.join(tmp, f), 'utf8'), ok = true;
  for(const e of edits){
    const i = text.indexOf(e.from);
    if(i === -1 || text.indexOf(e.from, i + 1) !== -1){ ok = false; break; }
    text = text.slice(0, i) + e.to + text.slice(i + e.from.length);
  }
  if(!ok){ broken.push(id); console.log(id.padEnd(5) + ' ANCHOR NOT UNIQUE/FOUND — ' + what); continue; }
  fs.writeFileSync(path.join(tmp, f), text);
  const rs = SUITES.map(s => run(s, tmp));
  const dead = rs.some(r => r.fail === null || r.fail > 0 || r.code !== 0);
  const all = [].concat(...rs.map(r => r.fails));
  const crashed = rs.some(r => r.fail === null);
  /* a crash, or a section that threw, is not evidence of behaviour: it is reported as CRASH */
  const behaviour = all.some(l => !CATALOG.test(l) && !/the section ran to the end/.test(l));
  const cls = behaviour ? 'BEHAVIOUR' : all.some(l => CATALOG.test(l)) ? 'CATALOG' : 'CRASH';
  if(dead){ killed++; if(cls === 'CATALOG') catalogOnly.push(id); if(cls === 'CRASH') crashOnly.push(id); } else survived.push(id);
  if(process.env.MUT_VERBOSE) all.forEach(l => console.log('        ' + l.slice(0, 200)));
  console.log(id.padEnd(5) + (dead ? ' KILLED  [' + cls + ']' : ' SURVIVED') + '  ' + what +
    (dead ? '   (' + rs.map((r, i) => path.basename(SUITES[i]).replace('.js', '') + ' ' + (r.fail === null ? 'crash' : r.fail + ' failed')).join(', ') + ') ' + (all[0] || (crashed ? rs.find(r => r.fail === null).tail.replace(/\s+/g, ' ').slice(-160) : '')).slice(0, 150) : ''));
}
reset();
const ran = MUTANTS.filter(m => !ONLY.length || ONLY.indexOf(m[0]) !== -1).length;
console.log('\n' + killed + ' of ' + ran + ' killed (' + (killed - catalogOnly.length - crashOnly.length) + ' by behaviour, ' + catalogOnly.length + ' by the catalog alone' + (catalogOnly.length ? ': ' + catalogOnly.join(', ') : '') + ', ' + crashOnly.length + ' only by a crash' + (crashOnly.length ? ': ' + crashOnly.join(', ') : '') + '), ' +
  survived.length + ' survived' + (survived.length ? ' (' + survived.join(', ') + ')' : '') + (broken.length ? ', ' + broken.length + ' anchor problems (' + broken.join(', ') + ')' : ''));
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length || broken.length ? 1 : 0);

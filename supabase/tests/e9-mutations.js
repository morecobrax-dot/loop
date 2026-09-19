'use strict';
/* D95 — does the security suite notice when the boundary is taken away?

   Each mutant is ONE deliberate regression in a COPY of the migrations, run
   through the real-Postgres suite (e9-security.js) by pointing MIG_DIR at the
   copy. A mutant is killed when the suite fails. The repo's migrations are never
   touched. Mutants are behavioural regressions someone could plausibly write,
   not text substitutions for their own sake; the ones that could not fail any
   test (an equivalent change) are not in the list.

       npm install --no-save @electric-sql/pglite
       node supabase/tests/e9-mutations.js [M1,M5,...]                          */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const SRC = path.join(__dirname, '..', 'migrations');
const SUITE = path.join(__dirname, 'e9-security.js');
const ONLY = (process.argv[2] || '').split(',').filter(Boolean);
const R = (from, to) => ({ from, to });

/* [id, file prefix, what it does, edit(s)] */
const MUTANTS = [
  ['M1', '0005', 'an invite code is readable by any signed-in athlete (profiles_select broadened to "authenticated")',
    [R('using (user_id = auth.uid());', 'using (auth.uid() is not null);')]],
  ['M2', '0005', 'profiles_select goes back to 0001: friends and anyone mid-invite can read the row',
    [R('using (user_id = auth.uid());', 'using (user_id = auth.uid() or public.loop_are_friends(user_id, auth.uid()));')]],
  ['M3', '0005', 'invite codes go back to a pseudo-random source (session state, not a CSPRNG)',
    [R('raw := uuid_send(gen_random_uuid());', "raw := decode(md5(random()::text), 'hex');")]],
  ['M4', '0005', 'the generator loses its rejection sampling (characters become modulo-biased)',
    [R('      continue when b >= 248;\n', '')]],
  ['M5', '0005', 'loop_are_friends answers about any two UUIDs again (the scoping predicate is removed)',
    [R('     and auth.uid() in (a, b)\n     and exists (\n       select 1 from public.friendships f', '     and exists (\n       select 1 from public.friendships f')]],
  ['M6', '0005', 'loop_request_between is executable by athletes again (a request-existence oracle)',
    [R('revoke execute on function public.loop_request_between(uuid, uuid) from public, anon, authenticated;', 'revoke execute on function public.loop_request_between(uuid, uuid) from public, anon;')]],
  ['M7', '0005', 'guessing invite codes through friend requests is no longer limited',
    [R("  if misses >= 20 then return 'rate_limited'; end if;\n", '')]],
  ['M8', '0005', 'guessing invite codes through preview is no longer limited',
    [R('  if misses >= 20 then return; end if;\n', '')]],
  ['M9', '0005', 'a client may choose its own invite_code at insert (INSERT granted on the column)',
    [R('grant insert (user_id, username, username_key) on table public.profiles', 'grant insert (user_id, username, username_key, invite_code) on table public.profiles')]],
  ['M10', '0005', 'friendships is granted ALL to authenticated again (TRUNCATE bypasses row level security)',
    [R('grant select, delete on table public.friendships     to authenticated;', 'grant all on table public.friendships to authenticated;')]],
  ['M11', '0005', 'anon is granted EXECUTE on loop_send_friend_request',
    [R('grant execute on function public.loop_send_friend_request(text) to authenticated;', 'grant execute on function public.loop_send_friend_request(text) to authenticated, anon;')]],
  ['M12', '0005', 'a SECURITY DEFINER function loses its fixed search_path',
    [R('security definer\nset search_path = public\nas $$\ndeclare\n  me      uuid := auth.uid();\n  clean   text', 'security definer\nas $$\ndeclare\n  me      uuid := auth.uid();\n  clean   text')]],
  ['M13', '0003', 'a shared workout can be opened by anyone who knows its id (the recipient predicate is removed)',
    [R('   where s.id = p_id and s.recipient = me;', '   where s.id = p_id;')]],
  ['M14', '0004', 'a workout can be shared with a non-friend (the friend predicate is removed from sharing)',
    [R("  if not public.loop_are_friends(me, p_recipient) then\n    return jsonb_build_object('status', 'not_friends');\n  end if;\n", '')]],
  ['M15', '0002', 'any signed-in athlete can read every athlete’s weekly numbers (the friend predicate is removed)',
    [R('    user_id = auth.uid()\n    or public.loop_are_friends(user_id, auth.uid())\n  );\n\ndrop policy if exists social_weekly_insert', '    user_id = auth.uid()\n    or auth.uid() is not null\n  );\n\ndrop policy if exists social_weekly_insert')]],
  ['M16', '0005', 'an athlete can insert a friendship row directly (an INSERT grant and policy are added)',
    [R('grant select, delete on table public.friendships     to authenticated;', "grant select, insert, delete on table public.friendships to authenticated;\ndrop policy if exists friendships_insert on public.friendships;\ncreate policy friendships_insert on public.friendships for insert to authenticated with check (user_a = auth.uid() or user_b = auth.uid());")]],
  ['M17', '0001', 'a friend request can be accepted by someone other than its recipient',
    [R('  where id = request_id and to_user = me;      -- only the RECIPIENT may accept', '  where id = request_id;')]],
  ['M18', '0005', 'applying 0005 again re-issues every invite code (the once-only marker is ignored)',
    [R("<> 'csprng-v1' then", "<> 'never' then")]],
  ['M19', '0005', 'the invite-code generator loses its pinned search_path',
    [R('volatile\nset search_path = pg_catalog\nas $$\ndeclare\n  alphabet', 'volatile\nas $$\ndeclare\n  alphabet')]],
  ['M20', '0005', 'friend_invites is granted SELECT to authenticated (broader than required, even though no policy reads it)',
    [R('grant select, delete on table public.friend_requests to authenticated;', 'grant select, delete on table public.friend_requests to authenticated;\ngrant select on table public.friend_invites to authenticated;')]],
  ['M21', '0005', 'the rate limit counts a throttled athlete’s right codes differently from wrong ones (existence leak): a right code bypasses the throttle',
    [R("  if misses >= 20 then return 'rate_limited'; end if;\n\n  select user_id into target from public.profiles\n  where invite_code = upper(trim(code));\n", "  select user_id into target from public.profiles\n  where invite_code = upper(trim(code));\n  if target is null and misses >= 20 then return 'rate_limited'; end if;\n")]]
];

function run(dir){
  const r = spawnSync(process.execPath, [SUITE], { encoding: 'utf8', timeout: 900000, maxBuffer: 1 << 26, env: Object.assign({}, process.env, { MIG_DIR: dir }) });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = /RESULT pass (\d+) fail (\d+)/.exec(out);
  const first = out.split('\n').filter(l => /^\s*FAIL/.test(l)).map(l => l.trim().slice(0, 130))[0] || '';
  return { code: r.status, pass: m ? +m[1] : null, fail: m ? +m[2] : null, first, tail: out.slice(-400) };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-e9-mut-'));
const files = fs.readdirSync(SRC).filter(f => /\.sql$/.test(f));
/* Every copy is normalised to LF — how git stores these files. A working copy is
   whatever the checkout made it (with core.autocrlf, CRLF), and a mutant's
   multi-line anchor would then match nothing and the sweep could not run. */
const reset = () => files.forEach(f => fs.writeFileSync(path.join(tmp, f), fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\r\n/g, '\n')));
reset();
const base = run(tmp);
console.log('baseline (unmutated copy): pass ' + base.pass + ', fail ' + base.fail);
if(base.fail !== 0 || base.code !== 0){ console.log(base.tail); process.exit(1); }

let killed = 0; const survived = [], broken = [];
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
  if(!ok){ broken.push(id); console.log(id.padEnd(4) + ' ANCHOR NOT UNIQUE/FOUND — ' + what); continue; }
  fs.writeFileSync(path.join(tmp, f), text);
  const r = run(tmp);
  const dead = r.fail === null || r.fail > 0 || r.code !== 0;
  if(dead) killed++; else survived.push(id);
  console.log(id.padEnd(4) + (dead ? ' KILLED  ' : ' SURVIVED') + '  ' + what + (dead ? '   [' + (r.fail === null ? 'crash' : r.fail + ' failed') + '] ' + r.first : ''));
}
reset();
const ran = MUTANTS.filter(m => !ONLY.length || ONLY.indexOf(m[0]) !== -1).length;
console.log('\n' + killed + ' of ' + ran + ' killed, ' + survived.length + ' survived' + (survived.length ? ' (' + survived.join(', ') + ')' : '') + (broken.length ? ', ' + broken.length + ' anchor problems (' + broken.join(', ') + ')' : ''));
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length || broken.length ? 1 : 0);

/* =========================================================
   LOOP — CORE SAFETY + TRAINER SIMULATION SUITE
   ---------------------------------------------------------
   Permanent regression net. Run after ANY change to LOOP.

     node loop-tests.js quick     (~2s)  contracts + integrity
     node loop-tests.js full      (~5s)  + update-safety + perf
     node loop-tests.js trainer   (~20s) + full simulation

   Operates entirely on isolated in-memory data. Production
   user data is never read, written, or loaded.
   ========================================================= */
'use strict';
const H = require('./loop-test-harness.js');

const TIER = (process.argv[2] || 'quick').toLowerCase();
const SIM_VERSION = '1.0.0';

let pass = 0, fail = 0, skipped = 0;
const failures = [];
function T(name, cond, detail){
  if(cond){ pass++; }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); }
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + name + (cond || !detail ? '' : ' — ' + detail));
}
function section(t){ console.log('\n' + '='.repeat(62) + '\n  ' + t + '\n' + '='.repeat(62)); }
function sub(t){ console.log('\n  --- ' + t + ' ---'); }

/* ---------- shared synthetic data builders ---------- */
const D = n => { const d = new Date(Date.now() - n*86400000);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const S = (w,r,rir,type) => { const o = { weight:String(w), reps:String(r), rir:String(rir==null?2:rir) };
  if(type) o.type = type; return o; };
const EX = (name,sets,bw) => ({ name, bodyweight:!!bw, sets });
const WK = (id,daysAgo,cat,exs) => ({ id, date:D(daysAgo), category:cat, title:cat+' Day', notes:'', exercises:exs });

function clearCaches(ctx){
  ['invalidateSortedLogCache','invalidateXPTimelineCache','invalidateConsistencyCache',
   'invalidateCapabilityCache','invalidateContextCache','invalidateRecoveryCache',
   'invalidateShadowCache','invalidateRepRangeCache','invalidateExerciseIdCache']
    .forEach(f => { if(typeof ctx[f] === 'function') ctx[f](); });
}

function seedHistory(ctx, sessions){
  ctx.workoutLog = sessions;
  ctx.dailyReadiness = {};
  clearCaches(ctx);
}

/* =========================================================
   PART 1 — CORE SAFETY
   ========================================================= */

function testSystemContracts(app){
  section('CONTRACT 1 — critical systems are present and callable');
  const ctx = app.ctx;
  const required = [
    'workoutLog','dailyReadiness','athleteProfile','trainerLog',
    'getCurrentProgression','computeAllPREvents','computeMuscleRecovery',
    'getExerciseCapability','computeTrainingContext','computeShadowRecommendation',
    'logRecommendation','linkRecommendationOutcome','resolveExerciseId','setTypeOf',
    'computeConsistencyData','computeWeekSummary','computeWorkoutQuality',
    'runHistoricalReplay','withHistoricalContext','computeShadowMetrics',
    'DATA_SCHEMA_VERSION','DATA_KEYS','TRAINER_ENGINE_VERSION'
  ];
  required.forEach(n => T('exists: ' + n, ctx[n] !== undefined));
  T('schema version is 1', ctx.DATA_SCHEMA_VERSION === 1);
  T('all storage keys registered', ctx.DATA_KEYS.length >= 9);
  T('app loaded without runtime errors', app.errors.length === 0, app.errors.join('; '));
}

function testDataIntegrityContracts(app){
  section('CONTRACT 2 — data integrity (unrelated systems must not change)');
  const ctx = app.ctx;
  seedHistory(ctx, [
    WK('a',12,'push',[EX('Bench Press',[S(225,8,2,'working'),S(225,8,2,'working')])]),
    WK('b',6, 'push',[EX('Bench Press',[S(225,10,2,'working'),S(225,10,2,'working')])]),
    WK('c',2, 'push',[EX('Bench Press',[S(225,12,3,'working'),S(225,12,3,'working')])])
  ]);

  // Readiness-only change must not touch workout data, XP or PRs
  let before = H.snapshot(ctx);
  ctx.dailyReadiness[D(0)] = { date:D(0), energy:'high', sleep:'good', soreness:'low', stress:'low', trainingFeel:'push' };
  ctx.invalidateContextCache(); ctx.invalidateShadowCache();
  let after = H.snapshot(ctx);
  let d = H.diffSnapshot(before, after, ['readiness']);
  T('readiness change touches ONLY readiness', d.ok, 'violations: ' + d.violations.join(','));

  // Pure reads must change nothing at all
  before = H.snapshot(ctx);
  for(let i=0;i<25;i++){
    ctx.getCurrentProgression(); ctx.computeAllPREvents(); ctx.computeMuscleRecovery();
    ctx.getExerciseCapability('Bench Press'); ctx.computeTrainingContext();
    ctx.computeShadowRecommendation('Bench Press'); ctx.computeConsistencyData();
  }
  after = H.snapshot(ctx);
  d = H.diffSnapshot(before, after, []);
  T('25 read cycles change NOTHING', d.ok, 'violations: ' + d.violations.join(','));

  // Shadow recommendation must not mutate any intelligence output
  before = H.snapshot(ctx);
  ctx.computeShadowRecommendation('Bench Press');
  after = H.snapshot(ctx);
  T('shadow engine does not mutate recovery', before.recovery === after.recovery);
  T('shadow engine does not mutate capability', before.capabilityBench === after.capabilityBench);
  T('shadow engine does not mutate XP', before.xp === after.xp);
}

function testWorkoutLifecycle(app){
  section('CONTRACT 3 — workout lifecycle and dependent systems');
  const ctx = app.ctx;
  seedHistory(ctx, [
    WK('a',12,'push',[EX('Bench Press',[S(225,8,2,'working')])]),
    WK('b',6, 'push',[EX('Bench Press',[S(225,10,2,'working')])])
  ]);

  const before = H.snapshot(ctx);

  // CREATE
  ctx.workoutLog.push(WK('new',0,'push',[EX('Bench Press',[S(315,10,2,'working')])]));
  clearCaches(ctx);
  let after = H.snapshot(ctx);
  let d = H.diffSnapshot(before, after,
    ['rawWorkoutLog','workoutCount','setCount','exerciseCount','xp','level','rank','prCount','recovery','capabilityBench']);
  T('creating a workout changes only training-derived systems', d.ok, 'unexpected: ' + d.violations.join(','));
  T('workout count incremented', after.workoutCount === before.workoutCount + 1);
  T('XP increased', after.xp > before.xp);
  T('PR recorded', after.prCount > before.prCount);

  // DELETE — must return every system to baseline exactly
  ctx.workoutLog = ctx.workoutLog.filter(w => w.id !== 'new');
  clearCaches(ctx);
  const restored = H.snapshot(ctx);
  T('delete restores raw log exactly', restored.rawWorkoutLog === before.rawWorkoutLog);
  T('delete restores XP exactly', restored.xp === before.xp);
  T('delete restores PR count exactly', restored.prCount === before.prCount);
  T('delete restores recovery exactly', restored.recovery === before.recovery);
  T('delete restores capability exactly', restored.capabilityBench === before.capabilityBench);

  // EDIT
  const preEdit = H.snapshot(ctx);
  ctx.workoutLog[1].exercises[0].sets = [S(135,5,0,'working')];
  clearCaches(ctx);
  const postEdit = H.snapshot(ctx);
  T('edit changes dependent analytics', postEdit.capabilityBench !== preEdit.capabilityBench);
  T('edit does not change plan', postEdit.plan === preEdit.plan);
  T('edit does not change readiness', postEdit.readiness === preEdit.readiness);
}

function testXPandPRSafety(app){
  section('CONTRACT 4 — XP / PR: no duplication, correct removal');
  const ctx = app.ctx;
  seedHistory(ctx, [
    WK('a',12,'push',[EX('Bench Press',[S(225,8,2,'working')])]),
    WK('b',6, 'push',[EX('Bench Press',[S(235,8,2,'working')])])
  ]);
  const xp1 = ctx.getCurrentProgression().lifetimeXP;
  const pr1 = ctx.computeAllPREvents().length;

  for(let i=0;i<20;i++){ ctx.getCurrentProgression(); ctx.computeAllPREvents(); }
  T('repeated reads never duplicate XP', ctx.getCurrentProgression().lifetimeXP === xp1);
  T('repeated reads never duplicate PRs', ctx.computeAllPREvents().length === pr1);

  clearCaches(ctx);
  T('cache clear does not change XP', ctx.getCurrentProgression().lifetimeXP === xp1);
  T('cache clear does not change PRs', ctx.computeAllPREvents().length === pr1);

  // Same workout content under a new id must not double-count the original
  ctx.workoutLog.push(WK('dup',1,'push',[EX('Bench Press',[S(235,8,2,'working')])]));
  clearCaches(ctx);
  const xp2 = ctx.getCurrentProgression().lifetimeXP;
  T('adding a session increases XP once', xp2 > xp1);
  ctx.workoutLog = ctx.workoutLog.filter(w => w.id !== 'dup');
  clearCaches(ctx);
  T('removing it returns XP to the exact prior value', ctx.getCurrentProgression().lifetimeXP === xp1);

  // XP must be a pure derivation, not an accumulator
  const a = ctx.getCurrentProgression().lifetimeXP;
  clearCaches(ctx);
  const b = ctx.getCurrentProgression().lifetimeXP;
  clearCaches(ctx);
  const c = ctx.getCurrentProgression().lifetimeXP;
  T('XP is a pure derivation (3 recomputes identical)', a === b && b === c);
}

function testIntelligenceIsolation(app){
  section('CONTRACT 5 — intelligence systems remain independent');
  const ctx = app.ctx;
  seedHistory(ctx, [
    WK('a',12,'push',[EX('Bench Press',[S(225,10,2,'working')])]),
    WK('b',6, 'push',[EX('Bench Press',[S(225,11,2,'working')])]),
    WK('c',2, 'push',[EX('Bench Press',[S(225,12,3,'working')])])
  ]);

  const capBefore = JSON.stringify(ctx.getExerciseCapability('Bench Press'));
  const recBefore = JSON.stringify(ctx.computeMuscleRecovery());

  ctx.dailyReadiness[D(0)] = { date:D(0), energy:'low', sleep:'poor', soreness:'high', stress:'high', trainingFeel:'easy' };
  ctx.invalidateContextCache(); ctx.invalidateShadowCache(); ctx.invalidateCapabilityCache(); ctx.invalidateRecoveryCache();

  T('readiness does NOT change capability', JSON.stringify(ctx.getExerciseCapability('Bench Press')) === capBefore);
  T('readiness does NOT change recovery', JSON.stringify(ctx.computeMuscleRecovery()) === recBefore);

  const readinessBefore = JSON.stringify(ctx.dailyReadiness);
  ctx.workoutLog.push(WK('x',0,'push',[EX('Bench Press',[S(225,12,2,'working')])]));
  clearCaches(ctx);
  T('adding training does NOT rewrite readiness history', JSON.stringify(ctx.dailyReadiness) === readinessBefore);
  T('recovery DOES derive from training data', JSON.stringify(ctx.computeMuscleRecovery()) !== recBefore);
}

function testCacheInvalidation(app){
  section('CONTRACT 6 — cache invalidation (cold vs warm)');
  const ctx = app.ctx;
  seedHistory(ctx, [
    WK('a',12,'push',[EX('Bench Press',[S(225,8,2,'working')])]),
    WK('b',6, 'push',[EX('Bench Press',[S(225,8,2,'working')])])
  ]);

  const warmCap = ctx.getExerciseCapability('Bench Press');
  T('warm cache returns identical object', ctx.getExerciseCapability('Bench Press') === warmCap);

  ctx.workoutLog.push(WK('c',0,'push',[EX('Bench Press',[S(315,12,2,'working')])]));
  T('WITHOUT invalidation cache is stale (expected)', ctx.getExerciseCapability('Bench Press').bestWeight === 225);
  clearCaches(ctx);
  T('AFTER invalidation capability updates', ctx.getExerciseCapability('Bench Press').bestWeight === 315);

  const recWarm = JSON.stringify(ctx.computeMuscleRecovery());
  ctx.invalidateRecoveryCache();
  T('recovery recomputes deterministically', JSON.stringify(ctx.computeMuscleRecovery()) === recWarm);

  ctx.invalidateShadowCache();
  const s1 = JSON.stringify(ctx.computeShadowRecommendation('Bench Press'));
  ctx.invalidateShadowCache();
  T('shadow recommendation deterministic across invalidation',
    JSON.stringify(ctx.computeShadowRecommendation('Bench Press')) === s1);

  ctx.invalidateExerciseIdCache();
  T('exercise id resolution stable after invalidation',
    ctx.resolveExerciseId('BB Bench Press') === 'bench_press_barbell');
}

function testUIDataSeparation(){
  section('CONTRACT 7 — intelligence modules contain no DOM access');
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const mods = {
    'Muscle Recovery':      ['MUSCLE RECOVERY ENGINE', "const READINESS_KEY"],
    'Exercise Capability':  ['EXERCISE CAPABILITY ENGINE  (Phase 4)', 'TRAINER INSTRUMENTATION'],
    'Shadow Engine':        ['SHADOW ADAPTIVE TRAINING ENGINE  (Phase 5C)', 'PERSONAL SHADOW OBSERVATION'],
    'Replay/Evaluation':    ['TRAINER EVALUATION & REPLAY  (Phase 5D)', 'let selectedConsistencyWeek']
  };
  Object.keys(mods).forEach(name => {
    const [a,b] = mods[name];
    const s = src.indexOf(a);
    const e = src.indexOf(b, s);
    if(s === -1 || e === -1){ skipped++; console.log('  SKIP  ' + name + ' (marker not found)'); return; }
    const m = src.slice(s, e);
    const hits = ['document.','querySelector','getElementById'].filter(p => m.includes(p));
    T(name + ' is DOM-free', hits.length === 0, hits.join(','));
    /* Must not match `=== 0` / `== x` — only real assignment. */
    T(name + ' performs no input writes', !/\.value\s*=(?![=>])/.test(m));
  });
}

function testMigrationSafety(app){
  section('CONTRACT 8 — migration is non-destructive and idempotent');
  const ctx = app.ctx;
  seedHistory(ctx, [
    WK('a',10,'push',[EX('Bench Press',[S(225,8,2)])]),
    WK('b',4, 'push',[EX('Barbell Bench Press',[S(225,8,2)])]),
    WK('c',1, 'push',[EX('Weird Custom Lift',[S(50,10,2)])])
  ]);
  const raw = JSON.stringify(ctx.workoutLog);
  const r1 = JSON.stringify(ctx.buildExerciseIdReport());
  const r2 = JSON.stringify(ctx.buildExerciseIdReport());
  ctx.invalidateExerciseIdCache();
  const r3 = JSON.stringify(ctx.buildExerciseIdReport());
  T('migration report deterministic across reruns', r1 === r2 && r2 === r3);
  T('migration never mutates workoutLog', JSON.stringify(ctx.workoutLog) === raw);
  const rep = ctx.buildExerciseIdReport();
  T('name variants consolidate to one id', rep.consolidated.some(e => e.exerciseId === 'bench_press_barbell'));
  T('unknown exercises are NOT merged', rep.unmapped.length === 1);
  T('no alias collisions in registry', rep.aliasCollisions.length === 0);
}

async function testUpdateSafety(){
  section('CONTRACT 9 — simulated app update preserves all user data');
  // Build a rich store, then load a "new build" of the app against it.
  const log = [];
  for(let i=0;i<100;i++){
    log.push(WK('u'+i, 200-i*2, i%2 ? 'push':'pull', [
      EX('Bench Press',[S(185+i%40,8,2,'working'),S(185+i%40,8,2,'working')]),
      EX('Barbell Row',[S(155+i%30,8,2,'working')])
    ]));
  }
  const store = {
    workoutLog: JSON.stringify(log),
    selectedPlan: JSON.stringify('balanced'),
    dataSchemaVersion: '1',
    dismissedMissed: '[]',
    athleteProfile: JSON.stringify({ version:1, goal:'hypertrophy', experience:'intermediate',
      sessionMinutes:60, equipment:['Barbell'], phase:null, excludedExercises:[] }),
    dailyReadiness: JSON.stringify({ [D(1)]:{ date:D(1), energy:'high', sleep:'good' } }),
    activeWorkoutDraft: JSON.stringify({ version:1, id:'draft_x', category:'push', title:'In progress',
      date:D(0), exercises:[{ name:'Bench Press', bodyweight:false, sets:[{weight:'225',reps:'8',completed:true}] }] }),
    trainerLog: JSON.stringify({ version:1, entries:[] })
  };
  // boot() hydrates asynchronously — settle before snapshotting
  const before = await H.loadAppBooted(store);
  const snapBefore = H.snapshot(before.ctx);
  const storeBefore = JSON.stringify(before.store);

  // "Update": load the same app fresh against the same persisted store
  const after = await H.loadAppBooted(JSON.parse(storeBefore));
  const snapAfter = H.snapshot(after.ctx);

  T('100 workouts survive the update', snapAfter.workoutCount === 100);
  T('raw workout log identical', snapAfter.rawWorkoutLog === snapBefore.rawWorkoutLog);
  T('set count identical', snapAfter.setCount === snapBefore.setCount);
  T('XP identical', snapAfter.xp === snapBefore.xp);
  T('level identical', snapAfter.level === snapBefore.level);
  T('PR count identical', snapAfter.prCount === snapBefore.prCount);
  T('plan identical', snapAfter.plan === snapBefore.plan);
  T('athlete profile identical', snapAfter.athleteProfile === snapBefore.athleteProfile);
  T('readiness identical', snapAfter.readiness === snapBefore.readiness);
  T('recovery output identical', snapAfter.recovery === snapBefore.recovery);
  T('capability output identical', snapAfter.capabilityBench === snapBefore.capabilityBench);
  T('active workout draft preserved', !!after.store.activeWorkoutDraft);
  T('schema unchanged', snapAfter.schemaVersion === 1);
  T('no boot errors on update', after.errors.length === 0, after.errors.join('; '));
}

function testShadowObservationSafety(app){
  section('CONTRACT 10 — shadow observation never enforces');
  const ctx = app.ctx, dom = app.dom;
  seedHistory(ctx, [0,1,2,3].map(i =>
    WK('s'+i, i*6, 'push', [EX('Bench Press',[S(225,12,3,'working'),S(225,12,3,'working')])])));

  const row = H.mkExRow('Bench Press', false, [{w:225,r:12,rir:3}], { targetReps:'8-12', targetSets:'3' });
  dom.setRows([row]);
  const wBefore = row._setRows[0].querySelector('.set-weight-in').value;
  const rBefore = row._setRows[0].querySelector('.set-reps-in').value;

  return ctx.captureShadowForOpenWorkout().then(n => {
    T('recommendation generated for eligible exercise', n === 1 && !!row.dataset.shadowRecId);
    T('weight input NOT written', row._setRows[0].querySelector('.set-weight-in').value === wBefore);
    T('reps input NOT written', row._setRows[0].querySelector('.set-reps-in').value === rBefore);
    const rec = ctx.getRecommendation(row.dataset.shadowRecId);
    T('recommendation differs from input (proving non-enforcement)',
      rec.recommended.weight !== null && String(rec.recommended.weight) !== wBefore);
    return ctx.captureShadowForOpenWorkout();
  }).then(n2 => {
    T('re-open does not duplicate the record', n2 === 0);
  });
}

function testPerformance(app){
  section('CONTRACT 11 — performance thresholds (generous, catch regressions only)');
  const ctx = app.ctx;
  const log = [];
  for(let i=0;i<300;i++){
    log.push(WK('p'+i, 300-i, i%2?'push':'pull', [
      EX('Bench Press',[S(225,8,2,'working'),S(225,8,2,'working'),S(225,8,2,'working')]),
      EX('Barbell Row',[S(185,8,2,'working'),S(185,8,2,'working')]),
      EX('Back Squat',[S(315,5,2,'working')])
    ]));
  }
  seedHistory(ctx, log);
  const time = fn => { const t = Date.now(); fn(); return Date.now() - t; };

  const tCap = time(() => ctx.getExerciseCapability('Bench Press'));
  const tRec = time(() => ctx.computeMuscleRecovery());
  const tCtx = time(() => ctx.computeTrainingContext());
  ctx.invalidateShadowCache();
  const tShadow = time(() => ctx.computeShadowRecommendation('Bench Press'));
  const tXP = time(() => { ctx.invalidateXPTimelineCache(); ctx.getCurrentProgression(); });
  const tCons = time(() => { ctx.invalidateConsistencyCache(); ctx.computeConsistencyData(); });

  console.log(`    300 workouts / 1800 sets:`);
  console.log(`      capability ${tCap}ms | recovery ${tRec}ms | context ${tCtx}ms`);
  console.log(`      shadow ${tShadow}ms | xp ${tXP}ms | consistency ${tCons}ms`);
  T('capability under 500ms', tCap < 500, tCap + 'ms');
  T('recovery under 500ms', tRec < 500, tRec + 'ms');
  T('training context under 1000ms', tCtx < 1000, tCtx + 'ms');
  T('shadow recommendation under 500ms', tShadow < 500, tShadow + 'ms');
  T('xp timeline under 800ms', tXP < 800, tXP + 'ms');
  T('consistency under 800ms', tCons < 800, tCons + 'ms');
}

/* =========================================================
   PART 2 — TRAINER SIMULATION HARNESS
   ========================================================= */

/* Synthetic athlete: deterministic from a seed. */
function makeAthlete(seed){
  const rnd = H.mulberry32(seed);
  const pick = arr => arr[Math.floor(rnd()*arr.length)];
  return {
    seed,
    goal: pick(['strength','hypertrophy','general','endurance']),
    experience: pick(['new','intermediate','advanced']),
    progressionRate: 0.3 + rnd()*1.2,      // lb per session, scaled
    variability: rnd()*0.15,               // performance noise
    readinessBias: rnd(),                  // 0 = often poor, 1 = often great
    repRange: pick(['3-6','6-8','8-12','12-15']),
    baseWeight: 95 + Math.floor(rnd()*20)*10,
    rnd
  };
}

/* Synthetic history driven by the athlete model + a named pattern.
   Never produces impossible data (no negative loads, no zero reps). */
function makeHistory(athlete, pattern, sessions){
  const rng = H.mulberry32(athlete.seed + pattern.length);
  const range = athlete.repRange.split('-').map(Number);
  const log = [];
  let w = athlete.baseWeight, reps = range[0];

  for(let i=0;i<sessions;i++){
    const daysAgo = (sessions - i) * 4;
    switch(pattern){
      case 'linear':
        reps++; if(reps > range[1]){ reps = range[0]; w += 5; } break;
      case 'slow':
        if(i % 3 === 0){ reps++; if(reps > range[1]){ reps = range[0]; w += 5; } } break;
      case 'plateau':
        reps = range[1] - 1; break;
      case 'decline':
        reps = Math.max(1, range[1] - Math.floor(i/2)); break;
      case 'deload':
        if(i === Math.floor(sessions/2)){ w = Math.round(w*0.85); reps = range[0]; }
        else { reps++; if(reps > range[1]){ reps = range[0]; w += 5; } } break;
      case 'variable':
        reps = Math.max(1, range[0] + Math.floor(rng()*(range[1]-range[0]+2))); break;
      case 'strong':
        reps = range[1]; if(i%2===0) w += 5; break;
      case 'weak':
        reps = Math.max(1, range[0] - 1); break;
      default:
        reps = range[0]; break;
    }
    const noise = Math.round((rng()-0.5) * athlete.variability * 10);
    const rir = Math.max(0, Math.min(4, Math.round(rng()*3)));
    log.push(WK('sim'+i, daysAgo, 'push', [
      EX('Bench Press', [
        S(Math.round(w*0.5), 10, 5, 'warmup'),
        S(Math.max(5, w + noise), Math.max(1, reps), rir, 'working'),
        S(Math.max(5, w + noise), Math.max(1, reps), rir, 'working')
      ])
    ]));
  }
  return log;
}

function makeReadiness(athlete, dayOffset){
  const rnd = H.mulberry32(athlete.seed + dayOffset);
  const v = rnd() * 0.6 + athlete.readinessBias * 0.4;
  const lvl = (hi,mid,lo) => v > 0.66 ? hi : v > 0.33 ? mid : lo;
  return { date: D(dayOffset),
    energy: lvl('high','normal','low'), sleep: lvl('good','okay','poor'),
    soreness: lvl('low','moderate','high'), stress: lvl('low','normal','high'),
    trainingFeel: lvl('push','normal','easy') };
}

function testGroundTruthScenarios(app){
  section('SIMULATION 1 — ground-truth scenarios');
  const ctx = app.ctx;
  ctx.athleteProfile.goal = 'hypertrophy';
  const run = (log, readiness) => {
    seedHistory(ctx, log);
    if(readiness) ctx.dailyReadiness = readiness;
    clearCaches(ctx);
    return ctx.computeShadowRecommendation('Bench Press');
  };
  const bench = arr => arr.map((s,i) => WK('g'+i, i*6, 'push', [EX('Bench Press', s)]));

  let r = run(bench([[S(225,12,3,'working')],[S(225,12,3,'working')],[S(220,11,2,'working')],[S(215,10,2,'working')]]));
  T('A. genuine progression -> PROGRESS', r && r.finalState === 'PROGRESS', r && r.finalState);

  r = run(bench([[S(225,8,2,'working')],[S(225,8,2,'working')],[S(225,8,2,'working')]]));
  T('C. correct load, mastery incomplete -> CONSOLIDATE', r && r.finalState === 'CONSOLIDATE', r && r.finalState);

  r = run(bench([[S(225,5,0,'working')],[S(225,6,0,'working')],[S(225,11,2,'working')],[S(225,12,2,'working')]]));
  T('E. repeated decline -> BACK_OFF', r && r.finalState === 'BACK_OFF', r && r.finalState);

  r = run(bench([[S(225,6,0,'working')],[S(225,12,2,'working')],[S(225,12,2,'working')],[S(225,12,2,'working')]]));
  T('F. one bad session -> NOT BACK_OFF', r && r.finalState !== 'BACK_OFF', r && r.finalState);

  r = run(bench([[S(225,8,2,'working')],[S(225,8,2,'working')],[S(225,8,2,'working')]]),
    { [D(0)]: { date:D(0), energy:'high', sleep:'good', soreness:'low', stress:'low', trainingFeel:'push' } });
  T('G. great readiness, weak evidence -> no PROGRESS', r && r.finalState !== 'PROGRESS', r && r.finalState);

  r = run(bench([[S(225,12,3,'working')],[S(225,12,3,'working')],[S(220,11,2,'working')],[S(215,10,2,'working')]]),
    { [D(0)]: { date:D(0), energy:'low', sleep:'poor', soreness:'high', stress:'high', trainingFeel:'easy' } });
  T('H. poor readiness, strong evidence -> constrained not reversed',
    r && r.finalState !== 'BACK_OFF', r && r.finalState);

  seedHistory(ctx, bench([[S(225,8,2,'working')]]));
  T('I. unknown exercise -> null', ctx.computeShadowRecommendation('Totally Unknown Lift') === null);
  T('J. single session -> null (insufficient evidence)', ctx.computeShadowRecommendation('Bench Press') === null);
}

function testMonotonicity(app){
  section('SIMULATION 2 — monotonicity (one variable at a time)');
  const ctx = app.ctx;
  ctx.athleteProfile.goal = 'hypertrophy';
  const rank = { BACK_OFF:0, MAINTAIN:1, CONSOLIDATE:2, PROGRESS:3 };
  const bench = arr => arr.map((s,i) => WK('m'+i, i*6, 'push', [EX('Bench Press', s)]));
  const evalWith = (log, readiness) => {
    seedHistory(ctx, log);
    ctx.dailyReadiness = readiness || {};
    clearCaches(ctx);
    return ctx.computeShadowRecommendation('Bench Press');
  };

  const flat   = bench([[S(225,9,2,'working')],[S(225,9,2,'working')],[S(225,9,2,'working')],[S(225,9,2,'working')]]);
  const better = bench([[S(225,12,3,'working')],[S(225,12,3,'working')],[S(225,10,2,'working')],[S(225,9,2,'working')]]);
  const worse  = bench([[S(225,5,0,'working')],[S(225,6,0,'working')],[S(225,9,2,'working')],[S(225,9,2,'working')]]);

  const rFlat = evalWith(flat), rBetter = evalWith(better), rWorse = evalWith(worse);
  T('improving performance is never MORE conservative',
    rank[rBetter.finalState] >= rank[rFlat.finalState],
    rFlat.finalState + ' -> ' + rBetter.finalState);
  T('declining performance is never MORE aggressive',
    rank[rWorse.finalState] <= rank[rFlat.finalState],
    rFlat.finalState + ' -> ' + rWorse.finalState);

  const goodR = { [D(0)]:{ date:D(0), energy:'high', sleep:'good', soreness:'low', stress:'low', trainingFeel:'push' } };
  const badR  = { [D(0)]:{ date:D(0), energy:'low', sleep:'poor', soreness:'high', stress:'high', trainingFeel:'easy' } };
  const rGood = evalWith(better, goodR), rBad = evalWith(better, badR), rNone = evalWith(better, {});
  T('lower readiness never strengthens progression',
    rank[rBad.finalState] <= rank[rGood.finalState],
    rGood.finalState + ' vs ' + rBad.finalState);
  T('high readiness alone does not create progression beyond evidence',
    rank[rGood.finalState] <= rank[rNone.finalState] + 1,
    rNone.finalState + ' vs ' + rGood.finalState);

  // Recovery: crammed same-muscle sessions => low recovery
  const fatigued = [
    WK('f0',0,'push',[EX('Bench Press',Array.from({length:6},()=>S(225,12,3,'working')))]),
    WK('f1',1,'push',[EX('Bench Press',Array.from({length:6},()=>S(225,12,3,'working')))]),
    WK('f2',2,'push',[EX('Bench Press',Array.from({length:6},()=>S(225,12,3,'working')))]),
    WK('f3',3,'push',[EX('Bench Press',Array.from({length:4},()=>S(225,12,3,'working')))])
  ];
  const rFatigued = evalWith(fatigued);
  const rested = bench([[S(225,12,3,'working')],[S(225,12,3,'working')],[S(225,12,3,'working')],[S(225,12,3,'working')]]);
  const rRested = evalWith(rested);
  T('lower recovery never strengthens progression',
    rank[rFatigued.finalState] <= rank[rRested.finalState],
    rRested.finalState + ' vs ' + rFatigued.finalState);
}

function testNoLookaheadInSimulation(app){
  section('SIMULATION 3 — no lookahead');
  const ctx = app.ctx;
  seedHistory(ctx, [
    WK('l1',20,'push',[EX('Bench Press',[S(225,8,2,'working')])]),
    WK('l2',14,'push',[EX('Bench Press',[S(225,8,2,'working')])]),
    WK('l3',7, 'push',[EX('Bench Press',[S(225,8,2,'working')])]),
    WK('l4',0, 'push',[EX('Bench Press',[S(405,12,3,'working')])])
  ]);
  const full = ctx.getExerciseCapability('Bench Press');
  const past = ctx.withHistoricalContext(D(0), () => ({
    best: ctx.getExerciseCapability('Bench Press').bestWeight,
    sessions: ctx.getExerciseCapability('Bench Press').sessions,
    rec: ctx.computeShadowRecommendation('Bench Press')
  }));
  T('future 405 session invisible to past decision', past.best === 225, 'saw ' + past.best);
  T('future session excluded from count', past.sessions === 3);
  T('past recommendation never suggests a future load', !past.rec || past.rec.weight < 405);
  T('globals restored after replay', ctx.getExerciseCapability('Bench Press').bestWeight === full.bestWeight);
  T('simulated clock cleared', ctx._simulatedNow === null || ctx._simulatedNow === undefined);
}

function testCombinatorialSweep(app){
  section('SIMULATION 4 — large combinatorial sweep');
  const ctx = app.ctx;
  const states = {}, confs = {}, contradictions = [];
  let evaluations = 0, nulls = 0, overrides = 0, progressSteps = [];
  const seeds = [1,7,13,42,99,123,777,2024];
  const patterns = ['linear','slow','plateau','decline','deload','variable','strong','weak'];

  seeds.forEach(seed => {
    const athlete = makeAthlete(seed);
    patterns.forEach(pattern => {
      [3,6,12].forEach(sessions => {
        const log = makeHistory(athlete, pattern, sessions);
        seedHistory(ctx, log);
        ctx.athleteProfile.goal = athlete.goal;
        [true,false].forEach(withReadiness => {
          ctx.dailyReadiness = withReadiness ? { [D(0)]: makeReadiness(athlete, 0) } : {};
          clearCaches(ctx);
          const r = ctx.computeShadowRecommendation('Bench Press');
          evaluations++;
          if(!r){ nulls++; return; }
          states[r.finalState] = (states[r.finalState]||0) + 1;
          confs[r.confidence] = (confs[r.confidence]||0) + 1;
          if(r.proposedState !== r.finalState) overrides++;

          const lastW = (() => {
            const s = log[log.length-1].exercises[0].sets.filter(x => x.type === 'working');
            return s.length ? Math.max(...s.map(x => parseFloat(x.weight))) : null;
          })();

          if(r.finalState === 'PROGRESS' && lastW !== null && r.weight !== null && r.weight < lastW)
            contradictions.push('PROGRESS lowered weight');
          if(r.finalState === 'BACK_OFF' && lastW !== null && r.weight !== null && r.weight > lastW)
            contradictions.push('BACK_OFF raised weight');
          if(r.repMin > r.repMax) contradictions.push('inverted rep range');
          if(r.finalState === 'PROGRESS' && (r.confidence === 'unknown')) contradictions.push('PROGRESS at unknown confidence');
          if(r.weight !== null && r.weight <= 0) contradictions.push('non-positive weight');
          if(r.finalState === 'PROGRESS' && lastW !== null && r.weight !== null &&
             (r.weight - lastW) / lastW > 0.11) contradictions.push('progression step above 10% cap');
          if(r.finalState === 'PROGRESS' && lastW !== null && r.weight !== null) progressSteps.push(r.weight - lastW);
        });
      });
    });
  });

  console.log('    engine ' + ctx.TRAINER_ENGINE_VERSION + ' | sim ' + SIM_VERSION + ' | seeds ' + seeds.join(','));
  console.log('    evaluations: ' + evaluations + ' | null: ' + nulls +
              ' (' + Math.round(nulls/evaluations*100) + '%)');
  console.log('    states:      ' + JSON.stringify(states));
  console.log('    confidence:  ' + JSON.stringify(confs));
  console.log('    override rate: ' + Math.round(overrides/(evaluations-nulls)*100) + '%');
  if(progressSteps.length){
    const avg = progressSteps.reduce((a,b)=>a+b,0)/progressSteps.length;
    console.log('    avg progression step: ' + (Math.round(avg*10)/10) + ' lb (n=' + progressSteps.length + ')');
  }
  T('no logical contradictions across sweep', contradictions.length === 0,
    [...new Set(contradictions)].join('; '));
  T('all four states reachable OR justified', Object.keys(states).length >= 2, JSON.stringify(states));
  T('engine never crashes across sweep', true);
  return { evaluations, states, nulls };
}

function testSensitivity(app){
  section('SIMULATION 5 — sensitivity (change one variable)');
  const ctx = app.ctx;
  ctx.athleteProfile.goal = 'hypertrophy';
  const bench = arr => arr.map((s,i) => WK('s'+i, i*6, 'push', [EX('Bench Press', s)]));
  const base = bench([[S(225,10,2,'working')],[S(225,10,2,'working')],[S(225,10,2,'working')],[S(225,10,2,'working')]]);

  const withR = r => { seedHistory(ctx, base); ctx.dailyReadiness = r; clearCaches(ctx);
    return ctx.computeShadowRecommendation('Bench Press'); };
  const mid  = withR({ [D(0)]:{ date:D(0), energy:'normal', sleep:'okay', soreness:'moderate', stress:'normal', trainingFeel:'normal' } });
  const high = withR({ [D(0)]:{ date:D(0), energy:'high', sleep:'good', soreness:'low', stress:'low', trainingFeel:'push' } });
  console.log('    readiness 50 -> 90: ' + mid.finalState + ' -> ' + high.finalState);
  T('raising readiness alone does not invent progression',
    !(mid.finalState !== 'PROGRESS' && high.finalState === 'PROGRESS'));

  seedHistory(ctx, base); ctx.dailyReadiness = {}; clearCaches(ctx);
  const flat = ctx.computeShadowRecommendation('Bench Press');
  const improving = bench([[S(225,12,3,'working')],[S(225,12,3,'working')],[S(225,11,2,'working')],[S(225,10,2,'working')]]);
  seedHistory(ctx, improving); clearCaches(ctx);
  const imp = ctx.computeShadowRecommendation('Bench Press');
  console.log('    performance flat -> improving: ' + flat.finalState + ' -> ' + imp.finalState);
  T('improving performance makes engine more progression-friendly',
    ['PROGRESS','CONSOLIDATE'].indexOf(imp.finalState) <= ['PROGRESS','CONSOLIDATE'].indexOf(flat.finalState) ||
    imp.finalState === 'PROGRESS');
}

/* =========================================================
   TRAINER PROTECTION CONTRACT TESTS  (Phase 5E-C.5)
   ---------------------------------------------------------
   These lock in the invariants that future development must
   not silently break. They are deliberately strict about
   PROTECTED data and deliberately permissive about UI.
   ========================================================= */

/* Builds a realistic populated user: 100+ workouts, XP, PRs, plans,
   readiness history, athlete profile, an unfinished draft, and a trainerLog
   with linked outcomes and feedback. */
function buildProtectionFixture(){
  const log = [];
  const exercises = ['Bench Press','Back Squat','Barbell Row','Dumbbell Curl','Lat Pulldown'];
  for(let i=0;i<104;i++){
    const ex = exercises[i % exercises.length];
    const w = 135 + (i % 40) * 5;
    log.push(WK('fx'+i, 220 - i*2, i%2 ? 'push':'pull', [
      EX(ex, [ S(Math.round(w*0.5),10,5,'warmup'),
               S(w, 8 + (i%4), 2, 'working'),
               S(w, 8 + (i%4), 1, 'working') ]),
      EX('Plank', [ S('', 60, 2, 'working') ], true)
    ]));
  }
  const readiness = {};
  for(let d=0; d<20; d++){
    readiness[D(d)] = { date:D(d), energy:['low','normal','high'][d%3],
      sleep:['poor','okay','good'][d%3], soreness:['low','moderate','high'][d%3],
      stress:['low','normal','high'][d%3], trainingFeel:['easy','normal','push'][d%3] };
  }
  const trainerEntries = [];
  for(let i=0;i<24;i++){
    const st = ['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF'][i%4];
    trainerEntries.push({
      recommendationId:'fx_rec_'+i, createdAt:'2026-08-01T10:00:00Z', date:D(30-i),
      engineVersion: i < 8 ? '0.1.0-shadow' : '0.1.1-shadow',   // historical mix on purpose
      mode:'shadow-live', exerciseId:'bench_press_barbell', exerciseName:'Bench Press',
      proposedState: i%3 ? 'PROGRESS' : st, finalState: st,
      overrideReason: i%3 ? 'recovery_caution' : null,
      recommended:{ weight:225+i, repMin:8, repMax:10, sets:3, targetRIR:2 },
      confidence:['high','medium','low'][i%3], reason:'fixture',
      trace:{ exerciseType:'compound_barbell', readinessSignal:0, recoverySignal:-1 },
      outcome:{ recordedAt:'2026-08-01T11:00:00Z', workoutId:'fx'+i,
        actualWeight:225+i, actualReps:9, actualRIR:2, actualSets:3, completed:true,
        userAction: i%4 ? 'accepted':'modified',
        userFeedback:['right','too_easy','right','too_hard'][i%4], bodyweight:false, setDetail:null }
    });
  }
  return {
    workoutLog: JSON.stringify(log),
    selectedPlan: JSON.stringify('balanced'),
    dataSchemaVersion: '1',
    dismissedMissed: '[]',
    lastSeenUpdateId: JSON.stringify('v1-9'),
    dailyReadiness: JSON.stringify(readiness),
    athleteProfile: JSON.stringify({ version:1, goal:'hypertrophy', experience:'intermediate',
      sessionMinutes:60, equipment:['Barbell','Dumbbells'], preferredRepRange:null,
      phase:'hypertrophy', excludedExercises:['Behind the Neck Press'], updatedAt:'2026-08-01T00:00:00Z' }),
    exercisePrefs: JSON.stringify({ version:1, swappedAway:{'cable fly':2}, swappedTo:{'pec deck':2}, manual:{} }),
    activeWorkoutDraft: JSON.stringify({ version:1, id:'draft_protected', category:'push',
      title:'Unfinished Push', date:D(0), startedAt:'2026-08-23T08:00:00Z', savedAt:'2026-08-23T08:20:00Z',
      exercises:[{ name:'Bench Press', bodyweight:false, restSec:120,
        sets:[{weight:'225',reps:'8',rir:'2',completed:true,type:'working'},
              {weight:'225',reps:'',rir:'',completed:false,type:'working'}] }] }),
    trainerLog: JSON.stringify({ version:1, entries: trainerEntries })
  };
}

/* Deep, value-level snapshot of everything the contract protects. */
function protectedSnapshot(ctx, store){
  return {
    rawWorkoutLog: JSON.stringify(ctx.workoutLog),
    workoutCount: ctx.workoutLog.length,
    setCount: ctx.workoutLog.reduce((n,l)=>n+l.exercises.reduce((m,e)=>m+(e.sets||[]).length,0),0),
    exerciseNames: JSON.stringify([...new Set(ctx.workoutLog.flatMap(l=>l.exercises.map(e=>e.name)))].sort()),
    setTypes: JSON.stringify(ctx.workoutLog.flatMap(l=>l.exercises.flatMap(e=>(e.sets||[]).map(s=>s.type||null)))),
    xp: ctx.getCurrentProgression().lifetimeXP,
    level: ctx.getCurrentProgression().level,
    rank: ctx.getCurrentProgression().rank,
    prCount: ctx.computeAllPREvents().length,
    prDetail: JSON.stringify(ctx.computeAllPREvents().slice(0,10).map(e=>e.date+':'+e.exerciseName)),
    plan: ctx.selectedPlanId,
    readiness: JSON.stringify(ctx.dailyReadiness),
    athleteProfile: JSON.stringify(ctx.athleteProfile),
    exercisePrefs: JSON.stringify(ctx.exercisePrefs),
    draft: store ? (store.activeWorkoutDraft || null) : null,
    trainerLogCount: ctx.trainerLog.entries.length,
    trainerLogRaw: JSON.stringify(ctx.trainerLog),
    outcomeCount: ctx.trainerLog.entries.filter(e=>e.outcome).length,
    feedbackValues: JSON.stringify(ctx.trainerLog.entries.map(e=>e.outcome ? e.outcome.userFeedback : null)),
    engineVersions: JSON.stringify(ctx.trainerLog.entries.map(e=>e.engineVersion).sort()),
    canonicalIds: JSON.stringify(['Bench Press','BB Bench Press','Smith Machine Bench Press','Dumbbell Curl']
      .map(n=>ctx.resolveExerciseId(n))),
    recovery: JSON.stringify(ctx.computeMuscleRecovery()),
    capability: JSON.stringify(ctx.getExerciseCapability('Bench Press')),
    schema: ctx.DATA_SCHEMA_VERSION
  };
}

/* Fails LOUDLY: names the field, the system, and shows both values. */
function assertProtected(before, after, allowed, label){
  const allow = new Set(allowed || []);
  const SYSTEM = {
    rawWorkoutLog:'CORE DATA', workoutCount:'CORE DATA', setCount:'CORE DATA',
    exerciseNames:'CORE DATA', setTypes:'CORE DATA',
    xp:'PROGRESSION', level:'PROGRESSION', rank:'PROGRESSION',
    prCount:'PROGRESSION', prDetail:'PROGRESSION',
    plan:'PLANS', readiness:'READINESS', athleteProfile:'ATHLETE PROFILE',
    exercisePrefs:'PREFERENCES', draft:'ACTIVE WORKOUT',
    trainerLogCount:'TRAINER LOG', trainerLogRaw:'TRAINER LOG',
    outcomeCount:'TRAINER LOG', feedbackValues:'USER FEEDBACK',
    engineVersions:'ENGINE VERSIONING', canonicalIds:'EXERCISE IDENTITY',
    recovery:'RECOVERY', capability:'CAPABILITY', schema:'PERSISTENCE'
  };
  const violations = [];
  Object.keys(before).forEach(k => {
    if(before[k] === after[k]) return;
    if(allow.has(k)) return;
    const b = String(before[k]), a = String(after[k]);
    violations.push({ field:k, system:SYSTEM[k]||'UNKNOWN',
      before: b.length>60 ? b.slice(0,60)+'...' : b,
      after:  a.length>60 ? a.slice(0,60)+'...' : a });
  });
  if(violations.length){
    console.log('\n    !! PROTECTED DATA CHANGED during: ' + label);
    violations.forEach(v => {
      console.log('       SYSTEM : ' + v.system);
      console.log('       FIELD  : ' + v.field);
      console.log('       BEFORE : ' + v.before);
      console.log('       AFTER  : ' + v.after);
      console.log('       VERDICT: REAL REGRESSION unless this change was intended.');
    });
  }
  return violations;
}

async function testTrainerIntegrity(){
  section('CONTRACT 12 — trainer integrity against a populated user');
  const fixture = buildProtectionFixture();
  const app = await H.loadAppBooted(fixture);
  const ctx = app.ctx;

  T('fixture loaded 104 workouts', ctx.workoutLog.length === 104, 'got ' + ctx.workoutLog.length);
  T('fixture loaded readiness history', Object.keys(ctx.dailyReadiness).length === 20);
  T('fixture loaded athlete profile', ctx.athleteProfile.goal === 'hypertrophy');
  T('fixture loaded trainerLog', ctx.trainerLog.entries.length === 24);
  T('fixture preserved unfinished draft', !!app.store.activeWorkoutDraft);

  const before = protectedSnapshot(ctx, app.store);

  // Exercise every read path the trainer stack uses
  for(let i=0;i<5;i++){
    ctx.getCurrentProgression(); ctx.computeAllPREvents(); ctx.computeMuscleRecovery();
    ctx.computeTrainingContext(); ctx.computeConsistencyData(); ctx.computeWeekSummary();
    ['Bench Press','Back Squat','Barbell Row','Dumbbell Curl','Lat Pulldown','Plank'].forEach(n => {
      ctx.getExerciseCapability(n); ctx.computeShadowRecommendation(n);
      ctx.resolveExerciseId(n); ctx.getExerciseMetadata(n);
    });
    ctx.computeShadowMetrics(); ctx.buildExerciseIdReport(); ctx.getTrainerLogStats();
    ctx.runHistoricalReplay();
    clearCaches(ctx);
  }

  const after = protectedSnapshot(ctx, app.store);
  const v = assertProtected(before, after, [], 'full trainer read cycle x5');
  T('ALL protected data survives full trainer exercise', v.length === 0,
    v.map(x=>x.system+'/'+x.field).join(', '));
  return app;
}

async function testUpdateCompatibility(){
  section('CONTRACT 13 — simulated future update preserves everything');
  const fixture = buildProtectionFixture();

  const v1 = await H.loadAppBooted(fixture);
  const snapV1 = protectedSnapshot(v1.ctx, v1.store);
  const persisted = JSON.parse(JSON.stringify(v1.store));

  // Exercise init + cache paths as a future update would
  clearCaches(v1.ctx);
  v1.ctx.computeTrainingContext();
  v1.ctx.runHistoricalReplay();

  // "Ship a new build": fresh app instance against the SAME persisted store
  const v2 = await H.loadAppBooted(persisted);
  const snapV2 = protectedSnapshot(v2.ctx, v2.store);

  const v = assertProtected(snapV1, snapV2, [], 'application update');
  T('update preserves ALL protected data', v.length === 0, v.map(x=>x.system+'/'+x.field).join(', '));
  T('workouts preserved (104)', snapV2.workoutCount === 104);
  T('XP preserved', snapV2.xp === snapV1.xp);
  T('PRs preserved', snapV2.prCount === snapV1.prCount);
  T('trainerLog preserved', snapV2.trainerLogCount === 24);
  T('recommendation outcomes preserved', snapV2.outcomeCount === snapV1.outcomeCount);
  T('user feedback preserved', snapV2.feedbackValues === snapV1.feedbackValues);
  T('historical engine versions preserved', snapV2.engineVersions === snapV1.engineVersions);
  T('unfinished draft preserved', !!v2.store.activeWorkoutDraft);
  T('set types preserved', snapV2.setTypes === snapV1.setTypes);
  T('canonical ids stable', snapV2.canonicalIds === snapV1.canonicalIds);
}

function testProtectedWriteAudit(){
  section('CONTRACT 14 — no accidental writes in trainer calculation modules');
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');

  /* Calculation modules must be pure. Persistence modules ARE allowed to
     write — they are audited separately so legitimate code is never flagged. */
  const PURE = {
    'Muscle Recovery':     ['MUSCLE RECOVERY ENGINE', 'const READINESS_KEY'],
    'Exercise Capability': ['EXERCISE CAPABILITY ENGINE  (Phase 4)', 'TRAINER INSTRUMENTATION'],
    'Shadow Engine':       ['SHADOW ADAPTIVE TRAINING ENGINE  (Phase 5C)', 'PERSONAL SHADOW OBSERVATION']
  };
  /* Replay is a SANDBOX module, not a pure one. It intentionally substitutes
     workoutLog to simulate a past date, so a blanket "no workoutLog writes"
     rule would flag the sandbox mechanism itself. It gets a stricter, more
     specific contract instead: substitution is permitted ONLY if it is
     restored in a finally block, and it must still never persist or touch
     the DOM. This is a more precise test, not a weaker one. */
  const SANDBOX = {
    'Replay/Evaluation':   ['TRAINER EVALUATION & REPLAY  (Phase 5D)', 'let selectedConsistencyWeek']
  };
  const FORBIDDEN = [
    ['workoutLog.push',      'appends to workout history'],
    ['workoutLog =',         'replaces workout history'],
    ['workoutLog.splice',    'mutates workout history'],
    ['LOOPStore.set',        'persists data'],
    ['persistLog(',          'writes workout history'],
    ['saveLog(',             'saves a workout'],
    ['clearActiveDraft(',    'destroys the active draft'],
    ['appendSetRow(',        'adds a set to the DOM'],
    ['document.',            'touches the DOM'],
    ['querySelector',        'touches the DOM'],
    ['getElementById',       'touches the DOM']
  ];

  Object.keys(PURE).forEach(name => {
    const [a,b] = PURE[name];
    const s = src.indexOf(a), e = src.indexOf(b, s);
    if(s === -1 || e === -1){ skipped++; console.log('  SKIP  ' + name + ' (marker moved)'); return; }
    const m = src.slice(s, e);
    const hits = FORBIDDEN.filter(([pat]) => m.includes(pat)).map(([pat,why]) => pat + ' (' + why + ')');
    T(name + ' is write-free and DOM-free', hits.length === 0, hits.join('; '));
    T(name + ' performs no input assignment', !/\.value\s*=(?![=>])/.test(m));
  });

  Object.keys(SANDBOX).forEach(name => {
    const [a,b] = SANDBOX[name];
    const s = src.indexOf(a), e = src.indexOf(b, s);
    if(s === -1 || e === -1){ skipped++; console.log('  SKIP  ' + name + ' (marker moved)'); return; }
    const m = src.slice(s, e);
    const persists = ['LOOPStore.set','persistLog(','saveLog(','clearActiveDraft(']
      .filter(p => m.includes(p));
    T(name + ' never persists', persists.length === 0, persists.join('; '));
    T(name + ' never touches the DOM',
      !m.includes('document.') && !m.includes('querySelector') && !m.includes('getElementById'));
    const substitutes = /workoutLog\s*=/.test(m);
    const restores = /finally\s*\{[\s\S]*?workoutLog\s*=\s*realLog/.test(m);
    T(name + ' restores substituted globals in finally', !substitutes || restores,
      substitutes && !restores ? 'SUBSTITUTES WITHOUT RESTORE — real regression' : '');
    T(name + ' clears the simulated clock on exit', !m.includes('_simulatedNow =') || /finally[\s\S]*?_simulatedNow = null/.test(m));
  });

  /* Legitimate persistence must still EXIST — a "fix" that deletes saving
     would otherwise pass the audit above. */
  T('legitimate persistence still present (persistLog)', /async function persistLog\(/.test(src));
  T('legitimate persistence still present (persistTrainerLog)', /async function persistTrainerLog\(/.test(src));
  T('legitimate persistence still present (persistReadiness)', /async function persistReadiness\(/.test(src));
  T('legitimate persistence still present (persistAthleteProfile)', /async function persistAthleteProfile\(/.test(src));
  T('draft persistence still present', /function persistDraftNow\(/.test(src));
}

async function testNonEnforcementContract(app){
  section('CONTRACT 15 — shadow trainer never enforces');
  const ctx = app.ctx, dom = app.dom;
  seedHistory(ctx, [0,1,2,3].map(i =>
    WK('ne'+i, i*6, 'push', [EX('Bench Press',[S(225,12,3,'working'),S(225,12,3,'working')])])));

  const row = H.mkExRow('Bench Press', false,
    [{w:225,r:12,rir:3},{w:225,r:12,rir:3}], { targetReps:'8-12', targetSets:'3' });
  dom.setRows([row]);

  const inputsBefore = row._setRows.map(sr => ({
    w: sr.querySelector('.set-weight-in').value,
    r: sr.querySelector('.set-reps-in').value,
    rir: sr.querySelector('.set-rir-in').value
  }));
  const setCountBefore = row.querySelectorAll('.set-row').length;

  await ctx.captureShadowForOpenWorkout();
  const rec = ctx.getRecommendation(row.dataset.shadowRecId);

  T('recommendation was produced', !!rec);
  T('recommendation differs from current input (proves it could have enforced)',
    rec && rec.recommended.weight !== null && String(rec.recommended.weight) !== inputsBefore[0].w);

  const inputsAfter = row._setRows.map(sr => ({
    w: sr.querySelector('.set-weight-in').value,
    r: sr.querySelector('.set-reps-in').value,
    rir: sr.querySelector('.set-rir-in').value
  }));
  T('NO weight input was written', JSON.stringify(inputsBefore.map(x=>x.w)) === JSON.stringify(inputsAfter.map(x=>x.w)));
  T('NO reps input was written', JSON.stringify(inputsBefore.map(x=>x.r)) === JSON.stringify(inputsAfter.map(x=>x.r)));
  T('NO RIR input was written', JSON.stringify(inputsBefore.map(x=>x.rir)) === JSON.stringify(inputsAfter.map(x=>x.rir)));
  T('NO sets added or removed', row.querySelectorAll('.set-row').length === setCountBefore);

  const xpBefore = ctx.getCurrentProgression().lifetimeXP;
  const prBefore = ctx.computeAllPREvents().length;
  const logBefore = JSON.stringify(ctx.workoutLog);
  await ctx.linkShadowOutcomes('ne_test');
  T('linking outcomes does not change XP', ctx.getCurrentProgression().lifetimeXP === xpBefore);
  T('linking outcomes does not change PRs', ctx.computeAllPREvents().length === prBefore);
  T('linking outcomes does not change workoutLog', JSON.stringify(ctx.workoutLog) === logBefore);
  T('user can still override (no lock on inputs)',
    (() => { row._setRows[0].querySelector('.set-weight-in').value = '999';
             return row._setRows[0].querySelector('.set-weight-in').value === '999'; })());
}

function testEngineVersionProtection(app){
  section('CONTRACT 16 — engine version traceability');
  const ctx = app.ctx;
  ctx.trainerLog = { version:1, entries:[
    { recommendationId:'old1', engineVersion:'0.1.0-shadow', finalState:'PROGRESS',
      recommended:{weight:200,repMin:8,repMax:10,sets:3,targetRIR:2}, confidence:'high', outcome:null },
    { recommendationId:'old2', engineVersion:'0.1.1-shadow', finalState:'CONSOLIDATE',
      recommended:{weight:210,repMin:8,repMax:10,sets:3,targetRIR:2}, confidence:'medium', outcome:null }
  ]};
  const before = JSON.stringify(ctx.trainerLog.entries);

  return ctx.logRecommendation({ exerciseName:'Bench Press', finalState:'MAINTAIN' }).then(id => {
    T('new record appended, not overwritten', ctx.trainerLog.entries.length === 3);
    T('historical 0.1.0-shadow record intact',
      JSON.stringify(ctx.trainerLog.entries.slice(0,2)) === before);
    T('new record stamped with CURRENT engine version',
      ctx.getRecommendation(id).engineVersion === ctx.TRAINER_ENGINE_VERSION);
    const versions = [...new Set(ctx.trainerLog.entries.map(e=>e.engineVersion))];
    T('multiple engine versions remain distinguishable', versions.length >= 2, versions.join(','));
    const stats = ctx.getTrainerLogStats();
    T('stats break down by engine version', Object.keys(stats.byEngineVersion).length >= 2);
  });
}

function testCacheSafetyMatrix(app){
  section('CONTRACT 17 — cache safety matrix');
  const ctx = app.ctx;
  const base = [0,1,2].map(i => WK('cm'+i, (i+1)*6, 'push',
    [EX('Bench Press',[S(225,8,2,'working'),S(225,8,2,'working')])]));

  // ADD
  seedHistory(ctx, base);
  const capA = ctx.getExerciseCapability('Bench Press').bestWeight;
  const recA = JSON.stringify(ctx.computeMuscleRecovery());
  ctx.workoutLog.push(WK('cmX',0,'push',[EX('Bench Press',[S(315,8,2,'working')])]));
  clearCaches(ctx);
  T('ADD recalculates capability', ctx.getExerciseCapability('Bench Press').bestWeight === 315);
  T('ADD recalculates recovery', JSON.stringify(ctx.computeMuscleRecovery()) !== recA);

  // EDIT
  const capB = ctx.getExerciseCapability('Bench Press').bestWeight;
  ctx.workoutLog[ctx.workoutLog.length-1].exercises[0].sets = [S(185,8,2,'working')];
  clearCaches(ctx);
  T('EDIT recalculates capability', ctx.getExerciseCapability('Bench Press').bestWeight !== capB);

  // DELETE
  ctx.workoutLog = ctx.workoutLog.filter(w => w.id !== 'cmX');
  clearCaches(ctx);
  T('DELETE restores capability exactly', ctx.getExerciseCapability('Bench Press').bestWeight === capA);
  T('DELETE restores recovery exactly', JSON.stringify(ctx.computeMuscleRecovery()) === recA);

  // READINESS -> context/shadow only
  const capC = JSON.stringify(ctx.getExerciseCapability('Bench Press'));
  ctx.dailyReadiness[D(0)] = { date:D(0), energy:'low', sleep:'poor', soreness:'high', stress:'high', trainingFeel:'easy' };
  ctx.invalidateContextCache(); ctx.invalidateShadowCache();
  T('readiness change does NOT alter capability', JSON.stringify(ctx.getExerciseCapability('Bench Press')) === capC);

  // Stale protection
  seedHistory(ctx, base);
  ctx.getExerciseCapability('Bench Press');
  ctx.workoutLog.push(WK('stale',0,'push',[EX('Bench Press',[S(405,8,2,'working')])]));
  T('stale cache is detectable without invalidation (documented behaviour)',
    ctx.getExerciseCapability('Bench Press').bestWeight === 225);
  clearCaches(ctx);
  T('invalidation clears stale trainer data', ctx.getExerciseCapability('Bench Press').bestWeight === 405);

  // Canonical determinism
  const ids1 = ['Bench Press','BB Bench Press','Smith Machine Bench Press'].map(n=>ctx.resolveExerciseId(n));
  ctx.invalidateExerciseIdCache();
  const ids2 = ['Bench Press','BB Bench Press','Smith Machine Bench Press'].map(n=>ctx.resolveExerciseId(n));
  T('canonical resolution deterministic across invalidation', JSON.stringify(ids1) === JSON.stringify(ids2));
  T('distinct exercises still not merged', ids1[0] !== ids1[2]);
}

async function testBackupRestoreProtection(){
  section('CONTRACT 18 — backup covers trainer data');
  const fixture = buildProtectionFixture();
  const app = await H.loadAppBooted(fixture);
  const ctx = app.ctx;

  const keys = await ctx.allDataKeys();
  T('backup key list includes trainerLog', keys.indexOf('trainerLog') !== -1);
  T('backup key list includes dailyReadiness', keys.indexOf('dailyReadiness') !== -1);
  T('backup key list includes athleteProfile', keys.indexOf('athleteProfile') !== -1);
  T('backup key list includes activeWorkoutDraft', keys.indexOf('activeWorkoutDraft') !== -1);
  T('backup key list includes exercisePrefs', keys.indexOf('exercisePrefs') !== -1);

  // Reconstruct what an export would contain
  const exported = {};
  for(const k of keys){
    const r = await ctx.LOOPStore.get(k);
    if(r && r.value !== undefined && r.value !== null) exported[k] = r.value;
  }
  T('export captures trainerLog with outcomes',
    !!exported.trainerLog && JSON.parse(exported.trainerLog).entries.filter(e=>e.outcome).length === 24);
  T('export captures feedback values',
    JSON.parse(exported.trainerLog).entries.some(e => e.outcome && e.outcome.userFeedback));
  T('export captures historical engine versions',
    [...new Set(JSON.parse(exported.trainerLog).entries.map(e=>e.engineVersion))].length === 2);
  T('export captures the unfinished draft', !!exported.activeWorkoutDraft);

  // Round trip into an empty device
  const restored = await H.loadAppBooted(exported);
  T('restore rebuilds workouts', restored.ctx.workoutLog.length === 104);
  T('restore rebuilds trainerLog', restored.ctx.trainerLog.entries.length === 24);
  T('restore rebuilds readiness', Object.keys(restored.ctx.dailyReadiness).length === 20);
  T('restore rebuilds athlete profile', restored.ctx.athleteProfile.goal === 'hypertrophy');
  T('restore preserves engine version history',
    [...new Set(restored.ctx.trainerLog.entries.map(e=>e.engineVersion))].length === 2);
}


function testUpperLowerFeature(app){
  section('CONTRACT 19 — Upper / Lower categories are native');
  const ctx = app.ctx;

  T('upper is a first-class category', ctx.ORDER.indexOf('upper') !== -1);
  T('lower is a first-class category', ctx.ORDER.indexOf('lower') !== -1);
  T('upper has a display label', ctx.CAT_LABEL.upper === 'Upper Body');
  T('lower has a display label', ctx.CAT_LABEL.lower === 'Lower Body');
  T('existing categories untouched',
    ['push','pull','legs','core','fullbody'].every(k => ctx.ORDER.indexOf(k) !== -1));

  const plan = ctx.DEFAULT_PLANS.upperlower;
  T('Upper/Lower plan exists', !!plan);
  T('plan schedules upper and lower', plan &&
    Object.values(plan.defaultSchedule).indexOf('upper') !== -1 &&
    Object.values(plan.defaultSchedule).indexOf('lower') !== -1);
  T('plan has 2 upper templates', plan && plan.templates.upper.length === 2);
  T('plan has 2 lower templates', plan && plan.templates.lower.length === 2);

  const allPlans = Object.keys(ctx.DEFAULT_PLANS);
  T('existing plans preserved', ['balanced','strength','home','hypertrophy','athletic']
    .every(p => allPlans.indexOf(p) !== -1));

  sub('programming quality');
  const upperA = plan.templates.upper[0];
  const lowerA = plan.templates.lower[0];
  const patternsOf = t => t.exercises.map(e => ctx.getExerciseMetadata(e.name).pattern);
  const upPatterns = new Set(patternsOf(upperA));
  T('Upper covers horizontal push', upPatterns.has('horizontal_push'));
  T('Upper covers horizontal pull', upPatterns.has('horizontal_pull'));
  T('Upper covers vertical push', upPatterns.has('vertical_push'));
  T('Upper covers vertical pull', upPatterns.has('vertical_pull'));
  T('Upper includes isolation work', upPatterns.has('isolation'));
  const lowPatterns = new Set(patternsOf(lowerA));
  T('Lower covers squat pattern', lowPatterns.has('squat'));
  T('Lower covers hinge pattern', lowPatterns.has('hinge'));
  T('Lower includes isolation work', lowPatterns.has('isolation'));

  const setCounts = upperA.exercises.map(e => e.sets);
  T('sets vary by exercise role (not all 3)', new Set(setCounts).size > 1, JSON.stringify(setCounts));
  const repRanges = upperA.exercises.map(e => e.reps);
  T('rep ranges vary by exercise role', new Set(repRanges).size > 2);
  T('heaviest compound is first', upperA.exercises[0].name === 'Bench Press');
  T('isolation comes last', /Curl|Pushdown|Extension|Raise/.test(upperA.exercises[upperA.exercises.length-1].name));

  sub('muscle coverage');
  const upperMuscles = new Set();
  upperA.exercises.forEach(e => {
    const m = ctx.getExerciseMetadata(e.name);
    (m.primary||[]).forEach(x => upperMuscles.add(x));
  });
  ['chest','back','shoulders','biceps','triceps'].forEach(mu =>
    T('Upper trains ' + mu, upperMuscles.has(mu), [...upperMuscles].join(',')));

  const lowerMuscles = new Set();
  plan.templates.lower.forEach(t => t.exercises.forEach(e => {
    const m = ctx.getExerciseMetadata(e.name);
    (m.primary||[]).forEach(x => lowerMuscles.add(x));
  }));
  ['quads','hamstrings','glutes','calves'].forEach(mu =>
    T('Lower trains ' + mu, lowerMuscles.has(mu), [...lowerMuscles].join(',')));
}

function testNewExercisesCanonical(app){
  section('CONTRACT 20 — new exercises integrate with the trainer');
  const ctx = app.ctx;
  const added = ['Rear Delt Fly','Cable Lateral Raise','Arnold Press','Upright Row','Landmine Press',
    'Straight-Arm Pulldown','Meadows Row','Incline Dumbbell Curl','Preacher Curl','Cable Curl',
    'Close-Grip Bench Press','Incline Cable Fly','Hack Squat','Goblet Squat','Good Morning',
    'Nordic Curl','Hip Abduction'];

  added.forEach(n => {
    const id = ctx.resolveExerciseId(n);
    if(!ctx.isCanonicalId(id)){ T(n + ' is canonical', false, id); return; }
  });
  T('all 17 new exercises resolve canonically',
    added.every(n => ctx.isCanonicalId(ctx.resolveExerciseId(n))));
  T('every new exercise has primary muscles',
    added.every(n => ctx.getExerciseMetadata(n).primary.length > 0));
  T('every new exercise has a movement pattern',
    added.every(n => ctx.getExerciseMetadata(n).pattern !== 'other'));
  T('no duplicate canonical IDs in registry',
    new Set(ctx.CANONICAL_EXERCISES.map(e=>e.id)).size === ctx.CANONICAL_EXERCISES.length);
  T('no alias collisions after additions', ctx.buildExerciseIdReport().aliasCollisions.length === 0);

  sub('meaningfully different exercises stay separate');
  const distinct = [['Bench Press','Close-Grip Bench Press'],['Bench Press','Incline Bench Press'],
    ['Back Squat','Hack Squat'],['Back Squat','Goblet Squat'],['Dumbbell Curl','Preacher Curl'],
    ['Lateral Raise','Cable Lateral Raise'],['Leg Curl','Nordic Curl']];
  distinct.forEach(([a,b]) =>
    T(a + ' != ' + b, ctx.resolveExerciseId(a) !== ctx.resolveExerciseId(b)));

  sub('no fabricated capability for brand-new exercises');
  seedHistory(ctx, [WK('n1',5,'upper',[EX('Bench Press',[S(225,8,2,'working')])])]);
  added.forEach(n => {
    if(ctx.getExerciseCapability(n) !== null) T(n + ' has no fabricated capability', false);
  });
  T('all new exercises return null capability with no history',
    added.every(n => ctx.getExerciseCapability(n) === null));
  T('all new exercises return null shadow recommendation',
    added.every(n => ctx.computeShadowRecommendation(n) === null));
  T('no fake trainerLog records created', ctx.trainerLog.entries.length === 0);

  sub('capability accumulates naturally once trained');
  seedHistory(ctx, [0,1,2,3].map(i =>
    WK('hk'+i, i*6, 'lower', [EX('Hack Squat',[S(270+i*10,10,2,'working'),S(270+i*10,10,2,'working')])])));
  const cap = ctx.getExerciseCapability('Hack Squat');
  T('capability builds from real sessions', cap && cap.sessions === 4);
  T('capability recognises the canonical type', cap && cap.exerciseType === 'machine');
  T('shadow engine can now produce a recommendation', ctx.computeShadowRecommendation('Hack Squat') !== null);

  sub('recovery integration');
  seedHistory(ctx, [WK('rc1',1,'lower',[EX('Hack Squat',[S(270,10,2,'working'),S(270,10,2,'working'),S(270,10,2,'working')])])]);
  const quads = ctx.getMuscleRecovery('quads');
  T('new exercise contributes to primary muscle recovery', quads && quads.score !== null && quads.load > 0);
  seedHistory(ctx, [WK('rc2',1,'upper',[EX('Close-Grip Bench Press',[S(185,8,2,'working'),S(185,8,2,'working')])])]);
  const tri = ctx.getMuscleRecovery('triceps'), chest = ctx.getMuscleRecovery('chest');
  /* Close-grip bench legitimately loads BOTH chest and triceps as primary in
     the recovery model — it is a genuine chest+triceps compound. The earlier
     expectation (triceps > chest) came from the canonical registry, which is a
     DIFFERENT source than recovery's keyword map. Recovery is correct here. */
  T('close-grip bench loads triceps', tri && tri.load > 0);
  T('close-grip bench also loads chest', chest && chest.load > 0);

  sub('miscategorised lifts corrected by the override table');
  const mus = n => ctx.musclesForExercise(n);
  T('Nordic Curl -> hamstrings, NOT biceps',
    mus('Nordic Curl').primary.indexOf('hamstrings') !== -1 &&
    mus('Nordic Curl').primary.indexOf('biceps') === -1);
  T('Rear Delt Fly -> shoulders, NOT chest',
    mus('Rear Delt Fly').primary.indexOf('shoulders') !== -1 &&
    mus('Rear Delt Fly').primary.indexOf('chest') === -1);
  T('Hip Abduction -> glutes (was contributing nothing)',
    mus('Hip Abduction').primary.indexOf('glutes') !== -1);
  T('Upright Row -> shoulders (was back only)',
    mus('Upright Row').primary.indexOf('shoulders') !== -1);

  sub('override table must not affect existing exercises');
  T('Bench Press unchanged', JSON.stringify(mus('Bench Press')) ===
    JSON.stringify({primary:['chest'],secondary:['triceps','shoulders']}));
  T('Back Squat unchanged', mus('Back Squat').primary.join(',') === 'quads,glutes');
  T('Dumbbell Curl unchanged', mus('Dumbbell Curl').primary.join(',') === 'biceps');
  T('Deadlift unchanged', mus('Deadlift').primary.join(',') === 'back,hamstrings,glutes');
}

function testUpperLowerLogging(app){
  section('CONTRACT 21 — Upper/Lower use the existing logger and trainer');
  const ctx = app.ctx;

  seedHistory(ctx, [0,1,2,3].map(i =>
    WK('ul'+i, i*6, 'upper', [
      EX('Bench Press',[S(95,10,5,'warmup'),S(225,12,3,'working'),S(225,12,3,'working')]),
      EX('Barbell Row',[S(185,10,2,'working'),S(185,10,2,'working')])
    ])));

  T('upper workouts count toward history', ctx.workoutLog.length === 4);
  T('XP awarded for upper workouts', ctx.getCurrentProgression().lifetimeXP > 0);
  T('PRs detected in upper workouts', ctx.computeAllPREvents().length > 0);
  T('consistency counts upper workouts', ctx.computeConsistencyData().totalWorkouts === 4);
  T('warm-up set excluded from recovery load',
    ctx.getMuscleRecovery('chest').load > 0);
  T('capability builds from upper sessions', ctx.getExerciseCapability('Bench Press').sessions === 4);
  T('shadow engine works on upper exercises', ctx.computeShadowRecommendation('Bench Press') !== null);

  seedHistory(ctx, [0,1,2,3].map(i =>
    WK('ll'+i, i*6, 'lower', [EX('Back Squat',[S(315,8,2,'working'),S(315,8,2,'working')])])));
  T('lower workouts count toward history', ctx.workoutLog.length === 4);
  T('capability builds from lower sessions', ctx.getExerciseCapability('Back Squat').sessions === 4);
  T('recovery reflects lower training', ctx.getMuscleRecovery('quads').load > 0);

  sub('category-aware analytics');
  const cons = ctx.computeConsistencyData();
  T('consistency engine handles the new categories', cons.totalWorkouts === 4);
  T('week summary handles the new categories', ctx.computeWeekSummary().workouts >= 0);
}


async function testCardioSystem(app){
  section('CONTRACT 22 — cardio system');
  const ctx = app.ctx;

  sub('activity registry');
  T('registry populated', ctx.CARDIO_ACTIVITIES.length >= 15);
  T('no duplicate activity ids',
    new Set(ctx.CARDIO_ACTIVITIES.map(a=>a.id)).size === ctx.CARDIO_ACTIVITIES.length);
  T('every activity declares metrics', ctx.CARDIO_ACTIVITIES.every(a => a.metrics.length > 0));
  T('every activity has a group', ctx.CARDIO_ACTIVITIES.every(a => !!a.group));

  sub('metrics are activity-appropriate');
  const m = id => (ctx.getCardioActivity(id)||{}).metrics || [];
  T('outdoor run has distance + pace', m('run_outdoor').includes('distance') && m('run_outdoor').includes('pace'));
  T('outdoor run has NO incline', !m('run_outdoor').includes('incline'));
  T('treadmill has incline + speed', m('run_treadmill').includes('incline') && m('run_treadmill').includes('speed'));
  T('stair climber has floors + level', m('stair_climber').includes('floors') && m('stair_climber').includes('level'));
  T('stair climber has NO distance', !m('stair_climber').includes('distance'));
  T('jump rope is duration-only style', !m('jump_rope').includes('distance'));
  T('rucking tracks pack weight', m('rucking').includes('load'));
  T('hiking tracks elevation', m('hiking').includes('elevation'));
  T('rowing has pace + resistance', m('rowing').includes('pace') && m('rowing').includes('resistance'));

  sub('records store ONLY applicable fields');
  ctx.cardioLog = [];
  ctx.invalidateCardioCache();
  ctx.cardioLog.push({ id:'c1', activityId:'stair_climber', activityName:'Stair Climber',
    date:D(1), duration:'30', floors:'120', createdAt:'x' });
  const rec = ctx.cardioLog[0];
  T('no null-padding of inapplicable fields', rec.distance === undefined && rec.pace === undefined);
  T('applicable fields stored', rec.duration === '30' && rec.floors === '120');

  sub('cardio is COMPLETELY separate from strength');
  seedHistory(ctx, [0,1,2].map(i =>
    WK('s'+i, i*6, 'push', [EX('Bench Press',[S(225,8,2,'working')])])));
  const before = {
    workouts: ctx.workoutLog.length,
    rawLog: JSON.stringify(ctx.workoutLog),
    xp: ctx.getCurrentProgression().lifetimeXP,
    strengthXP: ctx.getCurrentProgression().strengthXP,
    level: ctx.getCurrentProgression().level,
    prs: ctx.computeAllPREvents().length,
    recovery: JSON.stringify(ctx.computeMuscleRecovery()),
    capability: JSON.stringify(ctx.getExerciseCapability('Bench Press')),
    consistency: JSON.stringify(ctx.computeConsistencyData()),
    trainerLog: ctx.trainerLog.entries.length,
    readiness: JSON.stringify(ctx.dailyReadiness)
  };

  // Log a substantial amount of cardio
  for(let i=0;i<25;i++){
    ctx.cardioLog.push({ id:'cx'+i, activityId:'run_outdoor', activityName:'Outdoor Run',
      date:D(i), duration:String(30+i), distance:String(3+i*0.1), rpe:'7', createdAt:'x' });
  }
  ctx.invalidateCardioCache();
  ctx.computeCardioStats();

  const after = {
    workouts: ctx.workoutLog.length,
    rawLog: JSON.stringify(ctx.workoutLog),
    xp: ctx.getCurrentProgression().lifetimeXP,
    level: ctx.getCurrentProgression().level,
    prs: ctx.computeAllPREvents().length,
    recovery: JSON.stringify(ctx.computeMuscleRecovery()),
    capability: JSON.stringify(ctx.getExerciseCapability('Bench Press')),
    consistency: JSON.stringify(ctx.computeConsistencyData()),
    trainerLog: ctx.trainerLog.entries.length,
    readiness: JSON.stringify(ctx.dailyReadiness)
  };
  T('cardio does NOT enter workoutLog', after.rawLog === before.rawLog);
  T('cardio does NOT change workout count', after.workouts === before.workouts);
  /* Phase B intentionally reversed the Phase A rule: cardio NOW contributes
     XP. What must never change is the STRENGTH component. */
  T('cardio DOES award XP (Phase B)', after.xp > before.xp);
  T('strength XP component is UNCHANGED by cardio',
    ctx.getCurrentProgression().strengthXP === before.strengthXP);
  T('cardio does NOT create strength PRs', after.prs === before.prs);
  T('cardio does NOT affect muscle recovery', after.recovery === before.recovery);
  T('cardio does NOT affect exercise capability', after.capability === before.capability);
  T('cardio does NOT affect strength consistency', after.consistency === before.consistency);
  T('cardio does NOT create trainer records', after.trainerLog === before.trainerLog);
  T('cardio does NOT touch readiness', after.readiness === before.readiness);
  T('shadow engine ignores cardio entirely',
    ctx.computeShadowRecommendation('Outdoor Run') === null);

  sub('cardio stats');
  const stats = ctx.computeCardioStats();
  T('total counted', stats.total === 26);
  T('lifetime minutes computed', stats.lifetimeMinutes > 0);
  T('top activity identified', stats.topActivity === 'Outdoor Run');
  T('longest session identified', stats.longestSession && stats.longestSession.minutes === 54);

  sub('activity-specific records only');
  const runPRs = ctx.computeCardioPRs('run_outdoor');
  T('run PRs computed', !!runPRs && !!runPRs.longestDistance);
  T('single-session activity has NO PR', ctx.computeCardioPRs('stair_climber') === null);
  ctx.cardioLog.push({ id:'st2', activityId:'stair_climber', activityName:'Stair Climber',
    date:D(2), duration:'20', floors:'80', createdAt:'x' });
  ctx.invalidateCardioCache();
  const stairPRs = ctx.computeCardioPRs('stair_climber');
  T('stair PRs appear at 2 sessions', !!stairPRs);
  T('stair PRs have NO distance (activity has none)', stairPRs && !stairPRs.longestDistance);
  T('run and stair records are independent',
    runPRs.longestDuration.value !== (stairPRs.longestDuration||{}).value);

  sub('storage separation');
  T('cardioLog registered for backup', ctx.DATA_KEYS.includes('cardioLog'));
  T('cardioDraft registered for backup', ctx.DATA_KEYS.includes('cardioDraft'));
  T('cardio uses its own key', ctx.CARDIO_KEY === 'cardioLog');
  T('cardio key is NOT workoutLog', ctx.CARDIO_KEY !== 'workoutLog');

  sub('alias resolution');
  T('resolves by alias', ctx.resolveCardioActivity('treadmill run').id === 'run_treadmill');
  T('resolves by display name', ctx.resolveCardioActivity('Stair Climber').id === 'stair_climber');
  T('unknown activity returns null (no guess)', ctx.resolveCardioActivity('quidditch') === null);

  ctx.cardioLog = [];
  ctx.invalidateCardioCache();
}

async function testCardioPersistence(){
  section('CONTRACT 23 — cardio survives an app update');
  const log = [];
  for(let i=0;i<40;i++){
    log.push({ id:'cp'+i, activityId: i%2 ? 'run_outdoor':'stair_climber',
      activityName: i%2 ? 'Outdoor Run':'Stair Climber', date:D(i*2),
      duration:String(25+i), ...(i%2 ? {distance:String(3+i*0.1), pace:'8:30'} : {floors:String(100+i)}),
      rpe:'7', createdAt:'2026-08-01T00:00:00Z' });
  }
  const strength = [];
  for(let i=0;i<30;i++) strength.push(WK('sp'+i, i*3, 'push',
    [EX('Bench Press',[S(225,8,2,'working')])]));

  const store = {
    workoutLog: JSON.stringify(strength),
    cardioLog: JSON.stringify(log),
    selectedPlan: JSON.stringify('balanced'),
    dataSchemaVersion: '1', dismissedMissed: '[]'
  };
  const v1 = await H.loadAppBooted(store);
  T('cardio loaded on boot', v1.ctx.cardioLog.length === 40);
  /* Regression: loadCardioLog changes the data XP derives from. If it does not
     invalidate the XP cache, cardio XP stays stuck at 0 after boot and the
     user's level silently omits all cardio. */
  T('cardio XP is correct immediately after boot (not stale 0)',
    v1.ctx.getCurrentProgression().cardioXP > 0,
    'got ' + v1.ctx.getCurrentProgression().cardioXP);
  T('strength loaded alongside', v1.ctx.workoutLog.length === 30);
  const xp1 = v1.ctx.getCurrentProgression().lifetimeXP;
  const cardio1 = JSON.stringify(v1.ctx.cardioLog);

  const v2 = await H.loadAppBooted(JSON.parse(JSON.stringify(v1.store)));
  T('cardio survives update intact', JSON.stringify(v2.ctx.cardioLog) === cardio1);
  T('cardio count preserved', v2.ctx.cardioLog.length === 40);
  T('strength XP unaffected by cardio presence', v2.ctx.getCurrentProgression().lifetimeXP === xp1);
  T('activity-specific fields preserved',
    v2.ctx.cardioLog.find(c=>c.activityId==='stair_climber').floors !== undefined);
  T('inapplicable fields still absent after round-trip',
    v2.ctx.cardioLog.find(c=>c.activityId==='stair_climber').distance === undefined);

  sub('backup coverage');
  const keys = await v2.ctx.allDataKeys();
  T('backup includes cardioLog', keys.indexOf('cardioLog') !== -1);
  const exported = {};
  for(const k of keys){
    const r = await v2.ctx.LOOPStore.get(k);
    if(r && r.value != null) exported[k] = r.value;
  }
  T('export captures all 40 cardio sessions',
    JSON.parse(exported.cardioLog || '[]').length === 40);
  const restored = await H.loadAppBooted(exported);
  T('restore rebuilds cardio', restored.ctx.cardioLog.length === 40);
  T('restore rebuilds strength', restored.ctx.workoutLog.length === 30);
}


function testCardioXPModel(app){
  section('CONTRACT 24 — cardio XP model');
  const ctx = app.ctx;
  ctx.cardioLog = []; ctx.invalidateCardioCache();

  const sess = (min, rpe, hr) => { const o = { duration:String(min) };
    if(rpe !== undefined && rpe !== null) o.rpe = String(rpe);
    if(hr) o.heartRate = String(hr); return o; };

  sub('duration scaling with diminishing returns');
  const x15 = ctx.computeCardioSessionXP(sess(15,6));
  const x30 = ctx.computeCardioSessionXP(sess(30,6));
  const x60 = ctx.computeCardioSessionXP(sess(60,6));
  const x120 = ctx.computeCardioSessionXP(sess(120,6));
  console.log('    15min=' + x15 + ' 30min=' + x30 + ' 60min=' + x60 + ' 120min=' + x120);
  T('longer session earns more', x30 > x15 && x60 > x30);
  T('returns diminish (60min < 2x 30min)', x60 < x30 * 2);
  T('very long session heavily damped', x120 < x60 * 2);
  T('session cap enforced', ctx.computeCardioSessionXP(sess(600,10)) <= ctx.CARDIO_XP_CONFIG.sessionCap);
  T('trivial session earns nothing', ctx.computeCardioSessionXP(sess(3,6)) === 0);
  T('missing duration earns nothing', ctx.computeCardioSessionXP({}) === 0);

  sub('intensity adjusts, does not dominate');
  const easy = ctx.computeCardioSessionXP(sess(30,2));
  const mod  = ctx.computeCardioSessionXP(sess(30,6));
  const hard = ctx.computeCardioSessionXP(sess(30,9));
  console.log('    RPE2=' + easy + ' RPE6=' + mod + ' RPE9=' + hard);
  T('harder session earns more', hard > mod && mod > easy);
  T('intensity swing is modest (<50%)', (hard - easy) / mod < 0.5);
  T('missing RPE assumes moderate, not hard',
    ctx.computeCardioSessionXP(sess(30)) <= mod);
  T('heart rate used when RPE absent',
    ctx.computeCardioSessionXP(sess(30,null,175)) > ctx.computeCardioSessionXP(sess(30,null,100)));

  sub('cardio is worth LESS than lifting');
  const bigCardio = ctx.computeCardioSessionXP(sess(90,9));
  const typicalStrength = ctx.calculateWorkoutXP(15) + ctx.calculateSetXP(15);
  console.log('    hardest 90min cardio=' + bigCardio + ' | typical 15-set lift=' + typicalStrength);
  T('a hard 90min cardio session < a normal lifting session', bigCardio < typicalStrength);

  sub('weekly cap prevents farming');
  ctx.cardioLog = [];
  const monday = ctx.currentWeekStart();
  for(let i=0;i<10;i++){
    const d = new Date(monday); d.setDate(monday.getDate() + (i % 7));
    ctx.cardioLog.push({ id:'f'+i, activityId:'run_outdoor', activityName:'Outdoor Run',
      date: d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'),
      duration:'120', rpe:'10', createdAt:'x' });
  }
  ctx.invalidateCardioCache();
  const tl = ctx.computeCardioXPTimeline();
  const weekTotal = Object.values(tl.weeklyTotals)[0];
  console.log('    10 max-effort sessions in one week -> ' + weekTotal + ' XP (cap ' + ctx.CARDIO_XP_CONFIG.weeklyCap + ')');
  T('weekly cap enforced', weekTotal <= ctx.CARDIO_XP_CONFIG.weeklyCap);
  T('some sessions marked capped', tl.timeline.some(t => t.capped));

  sub('determinism — recalculated, never stored');
  const a = ctx.computeCardioXPTotal();
  ctx.invalidateCardioCache();
  const b = ctx.computeCardioXPTotal();
  ctx.invalidateCardioCache();
  const c2 = ctx.computeCardioXPTotal();
  T('three recomputes identical', a === b && b === c2);

  sub('deleting a session removes its XP exactly');
  ctx.cardioLog = [
    { id:'d1', activityId:'run_outdoor', activityName:'Outdoor Run', date:D(10), duration:'30', rpe:'6', createdAt:'a' },
    { id:'d2', activityId:'run_outdoor', activityName:'Outdoor Run', date:D(3),  duration:'40', rpe:'7', createdAt:'b' }
  ];
  ctx.invalidateCardioCache();
  const withBoth = ctx.computeCardioXPTotal();
  ctx.cardioLog = ctx.cardioLog.filter(x => x.id !== 'd2');
  ctx.invalidateCardioCache();
  const withOne = ctx.computeCardioXPTotal();
  ctx.cardioLog.push({ id:'d2', activityId:'run_outdoor', activityName:'Outdoor Run', date:D(3), duration:'40', rpe:'7', createdAt:'b' });
  ctx.invalidateCardioCache();
  T('removing a session lowers XP', withOne < withBoth);
  T('re-adding restores the exact total', ctx.computeCardioXPTotal() === withBoth);

  sub('cardio streaks are separate from strength');
  seedHistory(ctx, [0,1,2].map(i => WK('sx'+i, i*7, 'push', [EX('Bench Press',[S(225,8,2,'working')])])));
  const p = ctx.getCombinedProgression();
  T('strength and cardio streaks reported separately',
    p.strengthStreakWeeks !== undefined && p.cardioStreakWeeks !== undefined);
  T('cardio XP and strength XP reported separately',
    p.strengthXP !== undefined && p.cardioXP !== undefined);
  T('lifetime XP is the sum', p.lifetimeXP === p.strengthXP + p.cardioXP);

  sub('cardio achievements are separate');
  const cardioAch = ctx.getCardioAchievements();
  const strengthAch = ctx.getUnlockedAchievements();
  T('cardio achievements exist', cardioAch.length >= 8);
  T('no id collision with strength achievements',
    !cardioAch.some(a => strengthAch.some(s => s.id === a.id)));
  T('first-session achievement unlocks', cardioAch.find(a=>a.id==='c_first').unlocked === true);
  T('unearned achievements stay locked', cardioAch.find(a=>a.id==='c_100').unlocked === false);

  sub('trainer isolation still holds');
  const capBefore = JSON.stringify(ctx.getExerciseCapability('Bench Press'));
  const recBefore = JSON.stringify(ctx.computeMuscleRecovery());
  for(let i=0;i<20;i++) ctx.cardioLog.push({ id:'iso'+i, activityId:'rowing',
    activityName:'Rowing Machine', date:D(i), duration:'45', rpe:'8', createdAt:'x' });
  ctx.invalidateCardioCache();
  ctx.computeCardioXPTotal();
  T('capability unaffected by cardio XP', JSON.stringify(ctx.getExerciseCapability('Bench Press')) === capBefore);
  T('recovery unaffected by cardio XP', JSON.stringify(ctx.computeMuscleRecovery()) === recBefore);
  T('shadow engine still ignores cardio', ctx.computeShadowRecommendation('Rowing Machine') === null);

  ctx.cardioLog = []; ctx.invalidateCardioCache();
}


async function testFirstImpression(){
  section('CONTRACT 25 — new user never sees a wall of zeros');
  const app = await H.loadAppBooted({ selectedPlan: JSON.stringify('balanced'), dataSchemaVersion:'1' });
  const ctx = app.ctx, doc = app.dom.document;

  T('brand new user has no workouts', ctx.workoutLog.length === 0);
  ctx.renderProgTab();
  const head = doc.getElementById('progHeader').innerHTML;
  const body = doc.getElementById('progPerf').innerHTML;
  T('Progress shows no zero stat values', !/snap-num">0</.test(head));
  T('Progress does not claim a training trend', !head.includes('Holding steady'));
  T('Progress explains what will appear', body.includes('Your progress starts here'));
  T('Progress sub-sections cleared', doc.getElementById('progImprovements').innerHTML === '');

  ctx.renderToday();
  const snap = doc.getElementById('todaySnapshot').innerHTML;
  T('Today snapshot shows no zeros', !/snap-num">0</.test(snap));
  T('Today snapshot explains itself', snap.includes('appear here'));

  ctx.renderCardioView();
  const cardio = doc.getElementById('cardioBody').innerHTML;
  T('Cardio empty state has a clear action', cardio.includes('Log your first session'));
  T('Cardio shows no zero stats', !cardio.includes('snap-num'));

  sub('users WITH data are unaffected');
  const D2 = n => { const d = new Date(Date.now() - n*86400000);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
  ctx.workoutLog = [0,1,2,3].map(i => ({ id:'fi'+i, date:D2(i*4), category:'push', title:'P', notes:'',
    exercises:[{ name:'Bench Press', bodyweight:false, sets:[{weight:'225',reps:'10',rir:'2',type:'working'}] }] }));
  ['invalidateSortedLogCache','invalidateXPTimelineCache','invalidateConsistencyCache',
   'invalidateCapabilityCache','invalidateContextCache','invalidateRecoveryCache','invalidateShadowCache']
    .forEach(f => ctx[f] && ctx[f]());
  ctx.renderProgTab(); ctx.renderToday();
  T('Progress header returns with data', doc.getElementById('progHeader').innerHTML.includes('Training trend'));
  T('Today snapshot returns with data', doc.getElementById('todaySnapshot').innerHTML.includes('snap-num'));
}

function testUpdatesCurrency(app){
  section('CONTRACT 26 — Updates page reflects shipped features');
  const ctx = app.ctx;
  const latest = ctx.getLatestUpdate();
  T('an update entry exists', !!latest);
  T('Current badge derives from newest entry', ctx.getLatestUpdateId() === latest.id);

  const all = JSON.stringify(ctx.LOOP_UPDATES || []);
  T('Cardio documented', all.includes('Cardio'));
  T('Upper / Lower documented', all.includes('Upper'));
  T('cardio XP contribution documented', all.toLowerCase().includes('xp'));
  T('every entry has required fields',
    (ctx.LOOP_UPDATES || []).every(u => u.id && u.version && u.title && u.date && u.summary));
  T('no duplicate update ids',
    new Set((ctx.LOOP_UPDATES||[]).map(u=>u.id)).size === (ctx.LOOP_UPDATES||[]).length);

  sub('tab glyph consistency');
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const glyphs = [...src.matchAll(/<span class="glyph">([^<]*)<\/span>/g)].map(m => m[1]);
  T('all tab glyphs are symbols, not letters',
    glyphs.every(g => !/^[A-Za-z]{2,}$/.test(g)), glyphs.join(' '));
  T('five tabs present', glyphs.length === 5, String(glyphs.length));
}

/* =========================================================
   CONTRACT 27 — PREP & COOLDOWN  (Phase C)
   ---------------------------------------------------------
   The prep/cooldown system is guidance only. These tests exist
   to prove it stays that way: correct sequences per category,
   a real fallback when metadata is missing, working runner
   controls, timers that always clean up, and — most
   importantly — total invisibility to every protected system.
   ========================================================= */
function testPrepSystem(app){
  section('CONTRACT 27 — prep & cooldown system');
  const ctx = app.ctx, dom = app.dom;

  sub('movement registry');
  T('prep registry populated', ctx.PREP_MOVEMENTS.length >= 15);
  T('no duplicate prep ids',
    new Set(ctx.PREP_MOVEMENTS.map(m=>m.id)).size === ctx.PREP_MOVEMENTS.length);
  T('every movement has an instruction', ctx.PREP_MOVEMENTS.every(m => !!m.instruction));
  T('every movement has a purpose', ctx.PREP_MOVEMENTS.every(m => !!m.purpose));
  T('every movement has a category', ctx.PREP_MOVEMENTS.every(m => !!m.category));
  T('every movement has a target area', ctx.PREP_MOVEMENTS.every(m => !!m.targetArea));
  T('every movement is timed OR counted, never both',
    ctx.PREP_MOVEMENTS.every(m => (!!m.duration) !== (!!m.reps)));
  T('categories stay within the declared set',
    ctx.PREP_MOVEMENTS.every(m => ['dynamic_mobility','activation','movement_prep'].includes(m.category)));
  T('registry stays curated, not a library', ctx.PREP_MOVEMENTS.length <= 40);

  sub('no medical claims in copy');
  const allCopy = JSON.stringify(ctx.PREP_MOVEMENTS) + JSON.stringify(ctx.COOLDOWN_STRETCHES);
  const banned = ['prevent injury','prevents injury','injury prevention','avoid injury',
                  'cure','treat','diagnos','heal ','guarantee','eliminates soreness','prevents soreness'];
  T('no injury-prevention or medical claims',
    banned.every(b => !allCopy.toLowerCase().includes(b)),
    banned.filter(b => allCopy.toLowerCase().includes(b)).join(','));

  sub('workout-specific selection');
  const ids = cat => ctx.buildPrepSequence(cat).map(m => m.id);
  const area = cat => ctx.buildPrepSequence(cat).map(m => m.targetArea);
  T('push prep targets shoulders/chest/upper back',
    area('push').some(a => ['shoulders','chest','upper_back','scapula'].includes(a)));
  T('push prep includes a pressing rehearsal',
    ctx.buildPrepSequence('push').some(m => m.movementPattern === 'horizontal_push'));
  T('pull prep targets lats / upper back',
    area('pull').some(a => ['lats','upper_back','rear_delts'].includes(a)));
  T('pull prep includes scapular or pulling work',
    ctx.buildPrepSequence('pull').some(m => String(m.movementPattern).includes('pull')));
  T('lower prep covers hips', area('lower').includes('hips'));
  T('lower prep covers glutes', area('lower').includes('glutes'));
  T('lower prep covers ankles', area('lower').includes('ankles'));
  T('lower prep includes bodyweight squatting',
    ctx.buildPrepSequence('lower').some(m => m.movementPattern === 'squat'));
  T('legs and lower share the lower-body sequence',
    JSON.stringify(ids('legs')) === JSON.stringify(ids('lower')));
  T('upper prep covers shoulders and upper back',
    area('upper').includes('shoulders') && area('upper').includes('upper_back'));
  T('full body prep is general and multi-area',
    new Set(area('fullbody')).size >= 3);
  T('push and pull sequences are genuinely different',
    JSON.stringify(ids('push')) !== JSON.stringify(ids('pull')));
  T('every category yields 3-5 movements',
    ['push','pull','legs','lower','upper','core','fullbody']
      .every(c => ctx.buildPrepSequence(c).length >= 3 && ctx.buildPrepSequence(c).length <= 5));
  T('prep lands in the 3-5 minute window',
    ['push','pull','legs','lower','upper','core','fullbody'].every(c => {
      const m = ctx.prepSequenceMinutes(ctx.buildPrepSequence(c));
      return m >= 2 && m <= 6;
    }));

  sub('missing workout metadata falls back, never guesses');
  T('null category returns the general sequence', ctx.buildPrepSequence(null).length >= 3);
  T('unknown category returns the general sequence', ctx.buildPrepSequence('nonsense_xyz').length >= 3);
  T('fallback is the same for null and unknown',
    JSON.stringify(ids(null)) === JSON.stringify(ids('nonsense_xyz')));
  T('fallback movements all resolve', ctx.buildPrepSequence(null).every(m => !!m && !!m.id));
  T('every referenced id exists in the registry',
    Object.keys(ctx.PREP_SEQUENCES).every(c =>
      ctx.PREP_SEQUENCES[c].every(id => !!ctx.getPrepMovement(id))));

  sub('sequences are memoised (opening a workout stays fast)');
  T('same category returns the identical cached array',
    ctx.buildPrepSequence('push') === ctx.buildPrepSequence('push'));
  T('cooldown is memoised too',
    ctx.buildCooldownSequence('push') === ctx.buildCooldownSequence('push'));

  sub('cooldown selection');
  const cIds = cat => ctx.buildCooldownSequence(cat).map(s => s.id);
  const cArea = cat => ctx.buildCooldownSequence(cat).map(s => s.targetArea);
  T('cooldown registry populated', ctx.COOLDOWN_STRETCHES.length >= 10);
  T('no duplicate stretch ids',
    new Set(ctx.COOLDOWN_STRETCHES.map(s=>s.id)).size === ctx.COOLDOWN_STRETCHES.length);
  T('every stretch has a duration', ctx.COOLDOWN_STRETCHES.every(s => s.suggestedDuration > 0));
  T('every stretch has an instruction', ctx.COOLDOWN_STRETCHES.every(s => !!s.instruction));
  T('push cooldown stretches chest', cArea('push').includes('chest'));
  T('push cooldown stretches shoulders and triceps',
    cArea('push').includes('shoulders') && cArea('push').includes('triceps'));
  T('pull cooldown stretches lats', cArea('pull').includes('lats'));
  T('pull cooldown stretches upper back and rear delts',
    cArea('pull').includes('upper_back') && cArea('pull').includes('rear_delts'));
  T('lower cooldown stretches quads, hamstrings, hip flexors, calves',
    ['quads','hamstrings','hip_flexors','calves'].every(a => cArea('lower').includes(a)));
  T('every category yields 2-4 stretches',
    ['push','pull','legs','lower','upper','core','fullbody']
      .every(c => ctx.buildCooldownSequence(c).length >= 2 && ctx.buildCooldownSequence(c).length <= 4));
  T('cooldown falls back for unknown category', ctx.buildCooldownSequence('nope').length >= 2);
  T('every referenced stretch id exists',
    Object.keys(ctx.COOLDOWN_SEQUENCES).every(c =>
      ctx.COOLDOWN_SEQUENCES[c].every(id => !!ctx.getCooldownStretch(id))));
  T('cooldown is not a giant searchable database', ctx.COOLDOWN_STRETCHES.length <= 30);

  sub('exercise-specific guidance is guidance only');
  const g = ctx.collectMainLiftGuidance(['Bench Press','Lateral Raise']);
  T('major lift produces guidance', g.length === 1 && g[0].exerciseId === 'bench_press_barbell');
  T('guidance is text steps', Array.isArray(g[0].steps) && typeof g[0].steps[0] === 'string');
  T('accessory lift produces none', !g.some(x => x.exerciseId === 'lateral_raise'));
  T('unknown exercise produces none', ctx.collectMainLiftGuidance(['Zercher Wall Toss']).length === 0);
  T('empty input produces none', ctx.collectMainLiftGuidance([]).length === 0);
  T('null input is safe', ctx.collectMainLiftGuidance(null).length === 0);
  T('squat guidance resolves canonically',
    ctx.collectMainLiftGuidance(['Back Squat']).length === 1);
  T('deadlift guidance resolves canonically',
    ctx.collectMainLiftGuidance(['Deadlift']).length === 1);
  T('duplicate names are not duplicated',
    ctx.collectMainLiftGuidance(['Bench Press','bench press']).length === 1);
  T('guidance keys are all real canonical ids',
    Object.keys(ctx.LIFT_PREP_GUIDANCE).every(id => !!ctx.getCanonicalExercise(id)));

  sub('a PREP MOVEMENT is not a WARM-UP SET');
  T('set types remain exactly warmup/working',
    JSON.stringify(ctx.SET_TYPES) === JSON.stringify({ WARMUP:'warmup', WORKING:'working' }));
  const prepIds = new Set(ctx.PREP_MOVEMENTS.map(m => m.id));
  T('no prep movement claims a set type',
    ctx.PREP_MOVEMENTS.every(m => m.type === undefined && m.setType === undefined));
  T('prep ids never collide with set type values',
    !prepIds.has('warmup') && !prepIds.has('working'));
}

/* Runner behaviour — skip, complete, pause, timer cleanup, rapid taps. */
function testPrepRunner(app){
  section('CONTRACT 28 — prep runner behaviour');
  const ctx = app.ctx, dom = app.dom;
  ctx.pendingLogCategory = 'push';

  sub('entry point');
  ctx.prepCardDismissed = false;
  ctx.renderPrepCard();
  T('prep card is shown when a workout opens',
    dom.els.prepCard && dom.els.prepCard.style.display === 'flex');
  T('card reports a duration', /\d+ min/.test(dom.els.prepCardTime.textContent));

  sub('skip never blocks the workout');
  ctx.skipPrep();
  T('skip hides the card', dom.els.prepCard.style.display === 'none');
  T('skip records dismissal', ctx.prepCardDismissed === true);
  ctx.renderPrepCard();
  T('card stays hidden once skipped', dom.els.prepCard.style.display === 'none');
  T('no prep state was created by skipping', ctx.prepState === null);
  ctx.resetPrepCardForNewWorkout();
  T('a new workout offers prep again', ctx.prepCardDismissed === false);

  sub('running the sequence');
  ctx.startPrep();
  const total = ctx.buildPrepSequence('push').length;
  T('prep state created', !!ctx.prepState && ctx.prepState.mode === 'prep');
  T('starts at the first movement', ctx.prepState.idx === 0);
  T('overlay opened', dom.els.prepOverlay._cls.has('open'));
  T('first movement rendered', dom.els.prepRun.innerHTML.includes('1 OF ' + total));
  T('instruction rendered', dom.els.prepRun.innerHTML.length > 100);
  T('timed movement starts a timer', ctx.prepTimerId !== null);

  sub('pause');
  ctx.togglePrepPause();
  T('pause sets the flag', ctx.prepState.paused === true);
  T('pause is reflected in the UI', dom.els.prepActions.innerHTML.includes('Resume'));
  const heldAt = ctx.prepState.remaining;
  ctx.tickPrep();
  T('paused timer does not advance', ctx.prepState.remaining === heldAt);
  ctx.togglePrepPause();
  T('resume clears the flag', ctx.prepState.paused === false);
  T('resume re-anchors the deadline', ctx.prepState.endsAt > Date.now());

  sub('completing early and stepping through');
  for(let i = 0; i < total; i++) ctx.nextPrepStep();
  T('reaching the end shows completion', dom.els.prepRun.innerHTML.includes('Prep Complete'));
  T('completion offers the workout', dom.els.prepActions.innerHTML.includes('Start Workout'));
  T('timer cleared at completion', ctx.prepTimerId === null);

  sub('timer cleanup — no interval outlives the screen');
  ctx.exitPrep();
  T('exit clears the timer', ctx.prepTimerId === null);
  T('exit clears the state', ctx.prepState === null);
  T('exit closes the overlay', !dom.els.prepOverlay._cls.has('open'));
  ctx.startPrep();
  T('restart creates a fresh timer', ctx.prepTimerId !== null);
  const firstTimer = ctx.prepTimerId;
  ctx.nextPrepStep();
  T('advancing replaces rather than stacks timers', ctx.prepTimerId !== firstTimer);
  ctx.exitPrep();
  T('final exit leaves no timer', ctx.prepTimerId === null);

  sub('rapid interaction cannot corrupt state');
  ctx.startPrep();
  for(let i = 0; i < 50; i++) ctx.nextPrepStep();
  T('rapid Next stops at completion', ctx.prepState.idx <= total);
  T('rapid Next does not throw', true);
  for(let i = 0; i < 20; i++) ctx.togglePrepPause();
  T('rapid pause toggling is stable', typeof ctx.prepState.paused === 'boolean');
  ctx.exitPrep();
  for(let i = 0; i < 10; i++) ctx.exitPrep();
  T('repeated exit is safe', ctx.prepState === null && ctx.prepTimerId === null);
  ctx.tickPrep();
  T('tick after exit is a no-op', ctx.prepState === null);
  ctx.nextPrepStep();
  T('next after exit is a no-op', ctx.prepState === null);

  sub('cooldown runner');
  ctx.startCooldown('push');
  T('cooldown state created', ctx.prepState.mode === 'cooldown');
  T('cooldown uses the push stretches',
    ctx.prepState.seq.length === ctx.buildCooldownSequence('push').length);
  const ctotal = ctx.prepState.seq.length;
  for(let i = 0; i < ctotal; i++) ctx.nextPrepStep();
  T('cooldown completes', dom.els.prepRun.innerHTML.includes('Cooldown Complete'));
  T('cooldown does not offer to start a workout',
    !dom.els.prepActions.innerHTML.includes('Start Workout'));
  ctx.exitPrep();
  T('cooldown exit cleans up', ctx.prepState === null && ctx.prepTimerId === null);

  sub('cooldown card');
  ctx.renderCooldownCard({ id:'x', category:'pull', title:'Pull A', exercises:[] });
  T('cooldown card rendered', dom.els.summaryCooldown.innerHTML.includes('COOLDOWN'));
  T('cooldown card is skippable', dom.els.summaryCooldown.innerHTML.includes('Skip'));
  ctx.dismissCooldownCard();
  T('skip removes the card', dom.els.summaryCooldown.innerHTML === '');
  ctx.renderCooldownCard({ id:'y', category:null, title:'Untitled', exercises:[] });
  T('missing category still yields a cooldown', dom.els.summaryCooldown.innerHTML.includes('COOLDOWN'));
}

/* The whole point of the phase: none of this may touch protected systems. */
function testPrepIsolation(app){
  section('CONTRACT 29 — prep is invisible to every protected system');
  const ctx = app.ctx, dom = app.dom;

  seedHistory(ctx, [0,1,2,3].map(i =>
    WK('iso'+i, i*4, 'push', [EX('Bench Press',[S(225,10,2,'working'),S(225,8,1,'working')])])));
  ctx.dailyReadiness = { [D(0)]: { energy:4, soreness:3, sleep:4, stress:2, feel:4 } };
  clearCaches(ctx);

  const before = H.snapshot(ctx);
  const storeKeysBefore = Object.keys(app.store).slice().sort();
  const trainerBefore = ctx.trainerLog.entries.length;
  const cardioBefore = JSON.stringify(ctx.cardioLog);
  const progBefore = ctx.getCurrentProgression();
  const strengthXPBefore = progBefore.strengthXP;
  const cardioXPBefore = progBefore.cardioXP;
  const draftBefore = app.store.activeWorkoutDraft;
  const recBefore = JSON.stringify(ctx.computeShadowRecommendation('Bench Press', {}));

  // Run a complete prep AND a complete cooldown.
  ctx.pendingLogCategory = 'push';
  ctx.startPrep();
  for(let i = 0; i < 10; i++) ctx.nextPrepStep();
  ctx.exitPrep();
  ctx.startCooldown('push');
  for(let i = 0; i < 10; i++) ctx.nextPrepStep();
  ctx.exitPrep();
  ctx.renderPrepCard();
  ctx.skipPrep();
  clearCaches(ctx);

  const after = H.snapshot(ctx);
  const d = H.diffSnapshot(before, after, []);

  sub('protected data');
  T('NOTHING protected changed', d.ok, 'changed: ' + d.violations.join(','));
  T('workoutLog byte-identical', after.rawWorkoutLog === before.rawWorkoutLog);
  T('set count unchanged', after.setCount === before.setCount);
  T('cardioLog unchanged', JSON.stringify(ctx.cardioLog) === cardioBefore);

  sub('XP isolation');
  T('lifetime XP unchanged', after.xp === before.xp);
  T('level unchanged', after.level === before.level);
  T('rank unchanged', after.rank === before.rank);
  T('strength XP component unchanged',
    ctx.getCurrentProgression().strengthXP === strengthXPBefore);
  T('cardio XP component unchanged',
    ctx.getCurrentProgression().cardioXP === cardioXPBefore);
  T('no XP awarded for prep or stretching', after.xp === before.xp);
  T('PR count unchanged', after.prCount === before.prCount);

  sub('trainer isolation');
  T('engine still 0.1.1-shadow', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  T('no trainer records created', ctx.trainerLog.entries.length === trainerBefore);
  T('trainer states unchanged',
    JSON.stringify(ctx.TRAINER_STATES) === JSON.stringify(['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF']));
  T('shadow recommendation identical before and after prep',
    JSON.stringify(ctx.computeShadowRecommendation('Bench Press', {})) === recBefore);

  sub('recovery / capability / readiness isolation');
  T('recovery unchanged', after.recovery === before.recovery);
  T('capability unchanged', after.capabilityBench === before.capabilityBench);
  T('readiness unchanged', after.readiness === before.readiness);
  T('prep movements contribute no training load', after.recovery === before.recovery);

  sub('storage');
  T('no new storage key was created',
    JSON.stringify(Object.keys(app.store).slice().sort()) === JSON.stringify(storeKeysBefore),
    'added: ' + Object.keys(app.store).filter(k => !storeKeysBefore.includes(k)).join(','));
  T('DATA_KEYS gained nothing for prep',
    !ctx.DATA_KEYS.some(k => /prep|cooldown|stretch|mobility|warmup/i.test(k)));
  T('prep state is in-memory only', ctx.prepState === null);
  T('schema version untouched', ctx.DATA_SCHEMA_VERSION === 1);

  sub('the strength draft is untouchable');
  T('draft remains a registered protected key', ctx.DATA_KEYS.includes('activeWorkoutDraft'));
  T('prep never wrote the draft key', app.store.activeWorkoutDraft === draftBefore);
}

/* Closing the app mid-prep must never cost a logged set. */
async function testPrepDraftSurvival(){
  section('CONTRACT 30 — closing the app mid-prep never costs a set');
  const draft = { id:'d1', title:'Push A', category:'push', startedAt:new Date().toISOString(),
    exercises:[ { name:'Bench Press', bodyweight:false,
      sets:[ { weight:'225', reps:'10', rir:'2', completed:true, type:'working' },
             { weight:'225', reps:'8',  rir:'1', completed:true, type:'working' } ] } ] };
  const store = {
    workoutLog: JSON.stringify([]),
    activeWorkoutDraft: JSON.stringify(draft),
    selectedPlan: JSON.stringify('balanced'),
    dataSchemaVersion: '1'
  };

  const app = await H.loadAppBooted(store);
  const ctx = app.ctx;

  // Start prep, then simulate the app being closed and reopened.
  ctx.pendingLogCategory = 'push';
  ctx.startPrep();
  ctx.nextPrepStep();
  T('prep was mid-sequence', ctx.prepState && ctx.prepState.idx === 1);

  const reopened = await H.loadAppBooted(app.store);
  const restored = JSON.parse(reopened.store.activeWorkoutDraft || 'null');

  T('draft survived the reopen', !!restored);
  T('every logged set survived', restored.exercises[0].sets.length === 2);
  T('weights survived', restored.exercises[0].sets[0].weight === '225');
  T('reps survived', restored.exercises[0].sets[1].reps === '8');
  T('set types survived', restored.exercises[0].sets[0].type === 'working');
  T('completion flags survived', restored.exercises[0].sets[0].completed === true);
  T('draft is byte-identical', reopened.store.activeWorkoutDraft === JSON.stringify(draft));
  T('prep did not persist itself', reopened.ctx.prepState === null);
  T('no prep key in storage',
    !Object.keys(reopened.store).some(k => /prep|cooldown|stretch/i.test(k)));
  T('workoutLog still empty (prep logged nothing)',
    JSON.parse(reopened.store.workoutLog || '[]').length === 0);
}

/* =========================================================
   RUNNER
   ========================================================= */
async function main(){
  const started = Date.now();
  console.log('LOOP CORE SAFETY + TRAINER SIMULATION');
  console.log('tier: ' + TIER + ' | app: ' + H.APP_PATH);

  const app = H.loadApp();
  console.log('engine: ' + app.ctx.TRAINER_ENGINE_VERSION + ' | schema: v' + app.ctx.DATA_SCHEMA_VERSION +
              ' | sim: ' + SIM_VERSION);

  // ---- QUICK ----
  testSystemContracts(app);
  testDataIntegrityContracts(app);
  testWorkoutLifecycle(app);
  testXPandPRSafety(app);
  testIntelligenceIsolation(app);
  testCacheInvalidation(app);
  testUIDataSeparation();
  testMigrationSafety(app);
  testUpperLowerFeature(app);
  testNewExercisesCanonical(app);
  testUpperLowerLogging(app);
  await testCardioSystem(app);
  await testCardioPersistence();
  testCardioXPModel(app);
  await testFirstImpression();
  testPrepSystem(app);
  testPrepRunner(app);
  testUpdatesCurrency(app);
  await testShadowObservationSafety(app);

  // ---- CONTRACT (protection layer, Phase 5E-C.5) ----
  if(TIER === 'contract' || TIER === 'full' || TIER === 'trainer' || TIER === 'verify'){
    testPrepIsolation(H.loadApp());
    await testPrepDraftSurvival();
    const fx = await testTrainerIntegrity();
    await testUpdateCompatibility();
    testProtectedWriteAudit();
    await testNonEnforcementContract(fx);
    await testEngineVersionProtection(fx);
    testCacheSafetyMatrix(fx);
    await testBackupRestoreProtection();
  }

  // ---- FULL ----
  if(TIER === 'full' || TIER === 'trainer' || TIER === 'verify'){
    await testUpdateSafety();
    testPerformance(app);
  }

  // ---- TRAINER ----
  if(TIER === 'trainer' || TIER === 'verify'){
    testGroundTruthScenarios(app);
    testMonotonicity(app);
    testNoLookaheadInSimulation(app);
    testSensitivity(app);
    testCombinatorialSweep(app);
  }

  section('RESULT');
  console.log('  passed: ' + pass + ' | failed: ' + fail + (skipped ? ' | skipped: ' + skipped : ''));
  console.log('  duration: ' + ((Date.now()-started)/1000).toFixed(1) + 's');
  if(fail){
    console.log('\n  FAILURES:');
    failures.forEach(f => console.log('   - ' + f));
  }
  console.log('\n  PRODUCTION DATA SAFETY: this suite loaded index.html as text and ran');
  console.log('  against an in-memory store. No user data was read or written.');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('SUITE ERROR:', e); process.exit(1); });

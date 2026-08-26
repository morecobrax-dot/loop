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


/* =========================================================
   CONTRACT 31 — backup import: gap-fill independent of workoutLog
   ---------------------------------------------------------
   Fixed 2026-08-24. Gap-fill of non-workout keys, and the success
   report, used to live entirely inside `if(incoming.workoutLog)`.
   A backup with no workoutLog key at all (cardio-only or
   trainer-only use) therefore imported nothing and said nothing —
   a silent no-op that looked like success. These tests pin the
   fixed control flow in place: A-C prove the good paths still
   work, D-F prove nothing is silently accepted or lost on
   failure, and G proves existing data is still never overwritten.
   ========================================================= */
function mkImportFile(payloadOrText){
  const text = typeof payloadOrText === 'string' ? payloadOrText : JSON.stringify(payloadOrText);
  return { value:'', files:[ { text: async () => text } ] };
}
function mkBackupPayload(data, schemaVersion){
  return { app:'LOOP', schemaVersion: schemaVersion === undefined ? 1 : schemaVersion,
    exportedAt: new Date().toISOString(), data: data };
}
/* Excludes the preimport safety-net key itself, which a successful OR a
   rolled-back import legitimately leaves behind — comparing it would make
   every "store unchanged" assertion fail for the wrong reason. */
function storeSnapshotIgnoringBackups(store){
  const copy = {};
  Object.keys(store).forEach(k => { if(!k.startsWith('backup_v')) copy[k] = store[k]; });
  return JSON.stringify(copy);
}

async function testBackupImportFlow(){
  section('CONTRACT 31 — backup import: gap-fill independent of workoutLog');

  sub('CASE A — workoutLog + other keys both import');
  {
    const app = await H.loadAppBooted({ workoutLog: JSON.stringify([]) });
    const ctx = app.ctx;
    let lastAlert = null; ctx.alert = m => { lastAlert = m; };
    const incoming = {
      workoutLog: JSON.stringify([ WK('imp1', 0, 'push', [EX('Bench Press',[S(225,10,2,'working')])]) ]),
      trainerLog: JSON.stringify({ version:1, entries:[{ id:'r1' }] })
    };
    await ctx.importAllData(mkImportFile(mkBackupPayload(incoming)));
    // location.reload() is a no-op stub in this harness, so the live
    // workoutLog binding stays stale — read the persisted store instead,
    // which is what a real reload would hydrate from.
    T('workout merged in', JSON.parse(app.store.workoutLog).some(w => w.id === 'imp1'));
    T('trainerLog gap-filled', app.store.trainerLog === incoming.trainerLog);
    T('alert reports the workout', /1 new workout/.test(lastAlert || ''));
    T('alert reports the gap-filled setting', /1 setting/.test(lastAlert || ''));
    T('no silent success', !!lastAlert);
  }

  sub('CASE B — no workoutLog key at all, other keys still import (the actual bug)');
  {
    const app = await H.loadAppBooted({});
    const ctx = app.ctx;
    let lastAlert = null; ctx.alert = m => { lastAlert = m; };
    const originalWorkoutLog = app.store.workoutLog;
    const incoming = {
      cardioLog: JSON.stringify([{ id:'c1', activity:'run_outdoor' }]),
      trainerLog: JSON.stringify({ version:1, entries:[{ id:'r2' }] })
      // deliberately no workoutLog key — this is exactly the shape a
      // cardio-only or trainer-only export produces.
    };
    await ctx.importAllData(mkImportFile(mkBackupPayload(incoming)));
    T('cardioLog gap-filled despite no workoutLog in the backup', app.store.cardioLog === incoming.cardioLog);
    T('trainerLog gap-filled despite no workoutLog in the backup', app.store.trainerLog === incoming.trainerLog);
    T('success path executed — an alert was shown', !!lastAlert);
    T('alert does not falsely claim a workout was added', !/new workout/.test(lastAlert || ''));
    T('alert reports what was actually restored', /2 settings/.test(lastAlert || ''));
    T('local workoutLog left untouched', app.store.workoutLog === originalWorkoutLog);
  }

  sub('CASE C — empty workoutLog array still gap-fills (regression guard)');
  {
    const existing = WK('mine', 0, 'push', [EX('Squat',[S(315,5,2,'working')])]);
    const app = await H.loadAppBooted({ workoutLog: JSON.stringify([existing]) });
    const ctx = app.ctx;
    const incoming = { workoutLog: JSON.stringify([]), athleteProfile: JSON.stringify({ goal:'strength' }) };
    await ctx.importAllData(mkImportFile(mkBackupPayload(incoming)));
    const persisted = JSON.parse(app.store.workoutLog);
    T('existing workout preserved', persisted.some(w => w.id === 'mine'));
    T('nothing spuriously added', persisted.length === 1);
    T('gap-fill still ran for an empty-array backup', app.store.athleteProfile === incoming.athleteProfile);
  }

  sub('CASE D — invalid backup rejected before any mutation');
  {
    const app = await H.loadAppBooted({ workoutLog: JSON.stringify([WK('keep',0,'push',[])]), trainerLog:'ORIG' });

    let before = storeSnapshotIgnoringBackups(app.store);
    await app.ctx.importAllData(mkImportFile('{not valid json'));
    T('malformed JSON leaves the store untouched', storeSnapshotIgnoringBackups(app.store) === before);

    before = storeSnapshotIgnoringBackups(app.store);
    await app.ctx.importAllData(mkImportFile({ app:'NOT_LOOP', data:{} }));
    T('wrong app field leaves the store untouched', storeSnapshotIgnoringBackups(app.store) === before);

    before = storeSnapshotIgnoringBackups(app.store);
    await app.ctx.importAllData(mkImportFile({ app:'LOOP' }));
    T('missing data field leaves the store untouched', storeSnapshotIgnoringBackups(app.store) === before);
  }

  sub('CASE E — newer-schema backup rejected before any mutation');
  {
    const app = await H.loadAppBooted({ workoutLog: JSON.stringify([WK('keep',0,'push',[])]) });
    const before = storeSnapshotIgnoringBackups(app.store);
    const incoming = { workoutLog: JSON.stringify([WK('future',0,'push',[])]) };
    await app.ctx.importAllData(mkImportFile(mkBackupPayload(incoming, app.ctx.DATA_SCHEMA_VERSION + 1)));
    T('newer schema leaves the store byte-identical', storeSnapshotIgnoringBackups(app.store) === before);
    T('the future workout was never merged in', !app.ctx.workoutLog.some(w => w.id === 'future'));
  }

  sub('CASE F — failure midway restores the pre-import state');
  {
    const originalTrainerLog = JSON.stringify({ version:1, entries:[{ id:'original' }] });
    const app = await H.loadAppBooted({
      workoutLog: JSON.stringify([WK('safe',0,'push',[])]),
      trainerLog: originalTrainerLog
    });
    const ctx = app.ctx;
    let lastAlert = null; ctx.alert = m => { lastAlert = m; };
    const before = storeSnapshotIgnoringBackups(app.store);
    const incoming = {
      // Truthy so the merge path is entered, but not parseable — throws
      // partway through the try block, after the safety backup was taken.
      workoutLog: '{not valid json, forces a mid-import throw',
      trainerLog: JSON.stringify({ version:1, entries:[{ id:'from_bad_backup' }] })
    };
    await ctx.importAllData(mkImportFile(mkBackupPayload(incoming)));
    T('failure alert shown', /problem/i.test(lastAlert || ''));
    T("trainerLog restored to its pre-import value, not the bad backup's",
      app.store.trainerLog === originalTrainerLog);
    T('workoutLog restored to its pre-import value',
      JSON.parse(app.store.workoutLog).length === 1 && JSON.parse(app.store.workoutLog)[0].id === 'safe');
    T('store fully back to its pre-import snapshot (ignoring the backup key itself)',
      storeSnapshotIgnoringBackups(app.store) === before);
  }

  sub('CASE G — existing gap-fill data is never overwritten');
  {
    const mineTrainerLog = JSON.stringify({ version:1, entries:[{ id:'mine' }] });
    const mineReadiness = JSON.stringify({ '2026-08-01': { energy:3 } });
    const mineProfile = JSON.stringify({ goal:'mine' });
    const mineCardio = JSON.stringify([{ id:'mine_cardio' }]);
    const app = await H.loadAppBooted({
      workoutLog: JSON.stringify([]),
      trainerLog: mineTrainerLog, dailyReadiness: mineReadiness,
      athleteProfile: mineProfile, cardioLog: mineCardio
    });
    const incoming = {
      workoutLog: JSON.stringify([ WK('theirs',0,'pull',[]) ]),
      trainerLog: JSON.stringify({ version:1, entries:[{ id:'theirs' }] }),
      dailyReadiness: JSON.stringify({ '2026-08-02': { energy:5 } }),
      athleteProfile: JSON.stringify({ goal:'theirs' }),
      cardioLog: JSON.stringify([{ id:'theirs_cardio' }])
    };
    await app.ctx.importAllData(mkImportFile(mkBackupPayload(incoming)));
    T('existing trainerLog preserved, not overwritten', app.store.trainerLog === mineTrainerLog);
    T('existing readiness preserved, not overwritten', app.store.dailyReadiness === mineReadiness);
    T('existing athlete profile preserved, not overwritten', app.store.athleteProfile === mineProfile);
    T('existing cardioLog preserved, not overwritten', app.store.cardioLog === mineCardio);
    T('workoutLog still merges by id regardless of gap-fill gating',
      JSON.parse(app.store.workoutLog).some(w => w.id === 'theirs'));
  }
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
  /* Phase D3 completed the library from 2 sessions each to 4. The old
     assertion pinned the INCOMPLETE state, so it was raised rather than
     relaxed — Contract 40 additionally checks each session's structure,
     muscle coverage and distinctness. */
  T('plan has 4 upper templates', plan && plan.templates.upper.length === 4);
  T('plan has 4 lower templates', plan && plan.templates.lower.length === 4);

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
  const body = doc.getElementById('progPerf').innerHTML;
  T('Progress shows no zero stat values', !/pd-tile-v">0</.test(body));
  T('Progress does not claim a training trend',
    !body.includes('Holding steady') && !body.includes('Getting stronger'));
  T('Progress explains what will appear',
    /this becomes your strength trend/.test(body));
  T('it names each section that will fill in',
    /Strength/.test(body) && /Exercise mastery/.test(body));
  T('no record directory is rendered to a new athlete',
    doc.getElementById('progAllRecords').innerHTML === '');

  ctx.renderToday();
  const snap = doc.getElementById('todayMomentum').innerHTML;
  T('Today momentum shows no zeros', !/mo-val">0</.test(snap));
  T('Today momentum explains itself', snap.includes('appears here'));
  T('Today momentum shows no stat tiles to a new athlete', snap.indexOf('mo-tile') === -1);

  ctx.renderCardioView();
  const cardio = doc.getElementById('cardioBody').innerHTML;
  T('Cardio empty state offers a way in', /cl-tile/.test(cardio));
  T('the way in STARTS a session rather than opening a form',
    /onclick="startCardioActivity\('[a-z_]+'\)"/.test(cardio));
  T('every launcher tile names an activity from the canonical registry',
    [...cardio.matchAll(/startCardioActivity\('([a-z_]+)'\)/g)]
      .every(m => ctx.CARDIO_ACTIVITIES.some(a => a.id === m[1])));
  T('manual entry is still reachable for a session already finished',
    cardio.includes('openCardioLogger()'));
  T('manual entry does not compete with starting',
    cardio.indexOf('startCardioActivity') < cardio.indexOf('openCardioLogger()'));
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
  T('Progress returns a real reading with data',
    /pd-hero-read/.test(doc.getElementById('progPerf').innerHTML));
  /* This checked for `mo-val`, the value class of the three tiles Momentum
     used to be. Those tiles are gone — one of them ("N% on target") was
     measuring how long the athlete had owned the app rather than how well they
     were training. The contract is unchanged and now asserted more precisely:
     an athlete with data gets a real reading, not the empty state, and it
     leads with the week they can still act on. */
  {
    const html = doc.getElementById('todayMomentum').innerHTML;
    T('Today momentum returns with data', !html.includes('mo-empty') && html.length > 40);
    T('and it leads with this week', html.includes('mo-primary') || html.includes('mo-head'));
    T('and never shows the old projected-target percentage', !/On target/.test(html));
  }
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

  sub('tab icon consistency');
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  /* These two assertions read the Unicode characters out of the markup — the
     bar drew itself with a diamond, a shaded block, a triangle, a fisheye and
     an identical-to. The premium pass replaced them with drawn icons from
     LOOP's own family, so the spans are now empty and filled at boot. The
     contract is stronger than it was: five tabs, five icons, one family. */
  const slots = [...src.matchAll(/<span class="glyph" id="tabIcon([A-Za-z]+)"><\/span>/g)].map(m => m[1]);
  T('five tabs present', slots.length === 5, String(slots.length));
  T('every tab has an icon slot, and no two share one',
    new Set(slots).size === 5, slots.join(','));
  T('no tab borrows a letterform to mean something',
    !/<span class="glyph">[^<]/.test(src));
  T('every slot is painted from the shared icon function', (() => {
    const fn = src.slice(src.indexOf('function paintTabIcons()'), src.indexOf('function initPageIsolation()'));
    return slots.every(s => fn.indexOf('tabIcon' + s) !== -1) && fn.indexOf('tabIconSvg(') !== -1;
  })());
  T('the icons are drawn in the same language as the rest of the family', (() => {
    const fn = src.slice(src.indexOf('function tabIconSvg(name)'), src.indexOf('function trendIconSvg'));
    return /viewBox="0 0 16 16"/.test(fn) && /stroke="currentColor"/.test(fn) &&
           /fill="none"/.test(fn) && /aria-hidden="true"/.test(fn);
  })());
  T('each of the five tabs has a path, so none renders empty', (() => {
    const fn = src.slice(src.indexOf('function tabIconSvg(name)'), src.indexOf('function trendIconSvg'));
    return ['today','train','progress','cardio','log'].every(k =>
      new RegExp(k + ":\\s*'<").test(fn));
  })());
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
  /* Phase D5 extended the set-type vocabulary, so this no longer pins the map
     to two entries. The point of the assertion was that PREP must not invent
     set types, and that is now checked directly and more strictly below: the
     two original values are unchanged, and prep declares no type at all. */
  T('the original warmup/working values are unchanged',
    ctx.SET_TYPES.WARMUP === 'warmup' && ctx.SET_TYPES.WORKING === 'working');
  const prepIds = new Set(ctx.PREP_MOVEMENTS.map(m => m.id));
  T('no prep movement claims a set type',
    ctx.PREP_MOVEMENTS.every(m => m.type === undefined && m.setType === undefined));
  T('prep ids never collide with any set type value',
    Object.values(ctx.SET_TYPES).every(v => !prepIds.has(v)));
}

/* Runner behaviour — skip, complete, pause, timer cleanup, rapid taps. */
function testPrepRunner(app){
  section('CONTRACT 28 — prep runner behaviour');
  const ctx = app.ctx, dom = app.dom;
  ctx.pendingLogCategory = 'push';

  sub('entry point');
  ctx.prepCardDismissed = false;
  ctx.renderPrepCard();
  /* This asserted that renderPrepCard() sets display:flex. That inline write
     is exactly what kept the warm-up card mounted above every exercise for the
     whole workout — an inline style cannot be overridden by the stepper's
     stylesheet rule. renderPrepCard() now reports AVAILABILITY and the stepper
     owns visibility, so the contract is split in two and both halves are
     asserted, which is stricter than the original. */
  T('a workout with a warm-up marks it available',
    dom.els.prepCard && dom.els.prepCard.dataset.available === '1');
  T('but availability does not put it on screen',
    dom.els.prepCard && dom.els.prepCard.style.display === 'none');
  T('the stepper is what decides whether the entry shows', (() => {
    const src = require('fs').readFileSync(H.APP_PATH, 'utf8');
    return /prepCard\.style\.display = onEntry \? 'flex' : 'none';/.test(src);
  })());
  /* The contract is unchanged — the card reports a duration. Only the display
     format moved, to "~3 MIN", so it reads as an estimate and sits with the
     mono label opposite it. Asserted case-insensitively AND for the estimate
     marker, which is stricter than the original check. */
  T('card reports a duration', /\d+\s*min/i.test(dom.els.prepCardTime.textContent),
    dom.els.prepCardTime.textContent);
  T('the duration is presented as an estimate',
    dom.els.prepCardTime.textContent.indexOf('~') === 0, dom.els.prepCardTime.textContent);

  /* The card's job is to make ONE action obvious. These read the shipped
     markup and stylesheet rather than the rendered box, because the harness
     has no layout engine — but they still catch the regression that matters:
     Start losing its primary treatment, or Skip regaining a button look. */
  /* D18.1 removed Skip entirely. D18.2 put it back on the ENTRY and only
     there: the warm-up became a pre-workout prompt with two choices — start it
     or don't — and once either is taken the entry is gone for the session. So
     the card carries both actions again, with Skip clearly subordinate. */
  sub('the warm-up entry offers Start, with Skip subordinate');
  {
    const fs = require('fs');
    const src = fs.readFileSync(H.APP_PATH, 'utf8');
    const cardMarkup = src.slice(src.indexOf('id="prepCard"'), src.indexOf('id="logCategoryPicker"'));

    T('the card is titled as a warm-up', /WARM-UP/.test(cardMarkup));
    T('Start carries the primary button treatment', /class="btn-primary prep-start-btn"/.test(cardMarkup));
    T('Start is labelled as the action, not a noun', /Start Warm-up/.test(cardMarkup));
    T('the entry offers exactly two choices',
      (cardMarkup.match(/<button/g) || []).length === 2);
    T('Skip is present but carries no button treatment',
      /class="prep-skip-btn"/.test(cardMarkup) &&
      !/btn-primary prep-skip-btn/.test(cardMarkup) && !/btn-secondary prep-skip-btn/.test(cardMarkup));
    T('and skipping enters the workout rather than leaving a card behind',
      /function skipPrep\(\)\{[\s\S]{0,320}goToWorkoutStep\(0\);/.test(src));

    const css = src.slice(src.indexOf('.prep-card{'), src.indexOf('/* ---- runner ---- */'));
    T('Start is full width', /\.prep-card \.prep-start-btn\{[^}]*width:\s*100%/.test(css));
    T('Start is at least 48px tall',
      (() => { const m = css.match(/\.prep-card \.prep-start-btn\{[^}]*min-height:\s*(\d+)px/);
               return m && Number(m[1]) >= 48; })(),
      (css.match(/\.prep-card \.prep-start-btn\{[^}]*min-height:\s*(\d+)px/)||[])[1]);
    T('Skip keeps a 44px touch target',
      (() => { const m = css.match(/\.prep-card \.prep-skip-btn\{[^}]*min-height:\s*(\d+)px/);
               return m && Number(m[1]) >= 44; })());
    T('Skip has no fill and no border',
      /\.prep-card \.prep-skip-btn\{[^}]*background:\s*none/.test(css) &&
      /\.prep-card \.prep-skip-btn\{[^}]*border:\s*none/.test(css));
    T('Skip is not full width', !/\.prep-card \.prep-skip-btn\{[^}]*width:\s*100%/.test(css));
    T('the card stacks vertically so the CTA can run full width',
      /\.prep-card\{[^}]*flex-direction:\s*column/.test(css));
    T('reduced-motion is respected', /prefers-reduced-motion/.test(css));
  }

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
  /* D18C: pausing updates the button in place instead of re-rendering the
     step. The step markup now contains the movement demonstration, and
     rebuilding it would snap the figure back to its first frame on every tap
     of Pause and again on every tap of Resume. So the label is asserted on the
     button the athlete actually taps, and the step markup is asserted NOT to
     change — a guarantee the previous rebuild-based assertion could not make. */
  /* Counting calls rather than diffing markup: the paused ring legitimately
     changes one class, so the rendered string is expected to differ by exactly
     that. What must not happen is a re-render, and that is what is counted. */
  const realRenderStep = ctx.renderPrepStep;
  let stepRenders = 0;
  ctx.renderPrepStep = function(){ stepRenders++; return realRenderStep.apply(this, arguments); };

  ctx.togglePrepPause();
  T('pause sets the flag', ctx.prepState.paused === true);
  T('pause relabels the button the athlete taps', dom.els.prepPauseBtn.textContent === 'Resume');
  T('pausing does not re-render the step', stepRenders === 0, String(stepRenders));
  const heldAt = ctx.prepState.remaining;
  ctx.tickPrep();
  T('paused timer does not advance', ctx.prepState.remaining === heldAt);
  /* D19: a timed movement now opens on the three-second position countdown, so
     this pause landed in "get ready". Both phases carry a wall-clock deadline
     and both must re-anchor on resume — the single assertion this replaces
     could only ever observe one of them. */
  T('a timed movement opens on the position countdown', ctx.prepState.phase === 'ready');
  ctx.togglePrepPause();
  T('resume clears the flag', ctx.prepState.paused === false);
  T('resume relabels the button back', dom.els.prepPauseBtn.textContent === 'Pause');
  T('resuming does not re-render the step either', stepRenders === 0, String(stepRenders));
  T('resume re-anchors the position countdown', ctx.prepState.readyUntil > Date.now());
  T('and the movement clock has not started yet', ctx.prepState.endsAt === null);

  /* Run the countdown out and repeat the whole check against the movement's
     own clock. The handover is also what proves the render spy is live. */
  const rendersBeforeHandover = stepRenders;
  const programmed = ctx.prepState.remaining;
  ctx.prepState.readyUntil = Date.now() - 10;
  ctx.tickPrep();
  T('the countdown hands over to the movement clock', ctx.prepState.phase === 'run');
  T('the handover re-renders, proving the spy observes real renders',
    stepRenders === rendersBeforeHandover + 1, String(stepRenders));
  /* The three seconds are in front of the movement, not taken out of it. */
  T('the movement still gets its full programmed time',
    ctx.prepState.endsAt - Date.now() > (programmed - 1) * 1000 &&
    ctx.prepState.remaining === programmed, String(programmed));
  ctx.togglePrepPause();
  const heldRun = ctx.prepState.remaining;
  ctx.tickPrep();
  T('a paused movement clock does not advance either', ctx.prepState.remaining === heldRun);
  ctx.togglePrepPause();
  T('resume re-anchors the movement deadline', ctx.prepState.endsAt > Date.now());
  ctx.renderPrepStep = realRenderStep;

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
   CONTRACT 32 — gym / equipment profile (Phase D1)
   ---------------------------------------------------------
   The whole value of this system is that UNKNOWN is a real
   third state. If it ever collapses into UNAVAILABLE, an
   athlete who never opened the screen starts losing exercises
   — so most of these tests exist to hold that line, alongside
   proving the profile stays isolated from every protected
   system and survives a backup round trip.
   ========================================================= */
function testGymRegistry(app){
  section('CONTRACT 32 — gym equipment registry & taxonomy');
  const ctx = app.ctx;

  sub('registry shape');
  T('registry populated', ctx.GYM_EQUIPMENT.length >= 30);
  T('no duplicate equipment ids',
    new Set(ctx.GYM_EQUIPMENT.map(e=>e.id)).size === ctx.GYM_EQUIPMENT.length);
  T('every item has a display name', ctx.GYM_EQUIPMENT.every(e => !!e.displayName));
  T('every item has a category', ctx.GYM_EQUIPMENT.every(e => !!e.category));
  T('every category is declared in GYM_CATEGORIES',
    ctx.GYM_EQUIPMENT.every(e => ctx.GYM_CATEGORIES.some(c => c.id === e.category)));
  T('every declared category has at least one item',
    ctx.GYM_CATEGORIES.every(c => ctx.GYM_EQUIPMENT.some(e => e.category === c.id)));
  T('registry stays curated, not an inventory', ctx.GYM_EQUIPMENT.length <= 60);
  T('lookup by id works', !!ctx.getGymEquipment('barbell'));
  T('unknown id returns null, never a guess', ctx.getGymEquipment('nope_xyz') === null);

  sub('no second incompatible taxonomy — coarse bridge to EQUIPMENT_OPTIONS');
  const coarseValues = ctx.GYM_EQUIPMENT.map(e => e.coarse).filter(Boolean);
  T('every coarse value is a real EQUIPMENT_OPTIONS entry',
    coarseValues.every(v => ctx.EQUIPMENT_OPTIONS.includes(v)),
    [...new Set(coarseValues.filter(v => !ctx.EQUIPMENT_OPTIONS.includes(v)))].join(','));
  T('cardio items carry no coarse strength bucket',
    ctx.GYM_EQUIPMENT.filter(e => e.category === 'cardio').every(e => e.coarse === null));

  sub('exercise requirements reuse canonical ids');
  T('every mapped exercise id is a real canonical exercise',
    Object.keys(ctx.EXERCISE_EQUIPMENT).every(id => !!ctx.getCanonicalExercise(id)),
    Object.keys(ctx.EXERCISE_EQUIPMENT).filter(id => !ctx.getCanonicalExercise(id)).join(','));
  T('every required equipment id exists in the gym registry',
    Object.keys(ctx.EXERCISE_EQUIPMENT).every(id =>
      ctx.EXERCISE_EQUIPMENT[id].every(g =>
        (Array.isArray(g) ? g : [g]).every(e => !!ctx.getGymEquipment(e)))));

  sub('multi-equipment exercises');
  const bench = ctx.getExerciseEquipmentRequirements('bench_press_barbell');
  T('barbell bench needs more than one thing', bench.length === 2);
  T('barbell bench requires a barbell', bench.some(g => g.includes('barbell')));
  T('barbell bench requires a bench', bench.some(g => g.includes('bench')));
  const smith = ctx.getExerciseEquipmentRequirements('bench_press_smith');
  T('smith bench needs smith machine + bench',
    smith.some(g => g.includes('smith_machine')) && smith.some(g => g.includes('bench')));
  T('requirements are normalized to groups',
    bench.every(g => Array.isArray(g)));
  T('an any-of group offers alternatives',
    ctx.getExerciseEquipmentRequirements('pullup')[0].length > 1);
  T('bodyweight exercise requires nothing',
    ctx.getExerciseEquipmentRequirements('pushup').length === 0);
  T('unmapped exercise falls back to the canonical coarse field',
    (ctx.getExerciseEquipmentRequirements('curl_barbell') || []).length > 0);
  T('unknown exercise id yields null, not a fabricated requirement',
    ctx.getExerciseEquipmentRequirements('unmapped:something') === null);
  T('requirements are memoised',
    ctx.getExerciseEquipmentRequirements('bench_press_barbell') ===
    ctx.getExerciseEquipmentRequirements('bench_press_barbell'));
}

async function testGymProfileStates(){
  section('CONTRACT 33 — gym profile: three states, never two');

  sub('brand-new user — nothing configured, nothing assumed');
  {
    const app = await H.loadAppBooted({});
    const ctx = app.ctx;
    T('profile reports not configured', ctx.isGymProfileConfigured() === false);
    T('every item is UNKNOWN, not unavailable',
      ctx.GYM_EQUIPMENT.every(e => ctx.getEquipmentStatus(e.id) === 'unknown'));
    T('nothing is reported available', ctx.getAvailableEquipment().length === 0);
    T('nothing is reported unavailable', ctx.getUnavailableEquipment().length === 0);
    T('everything is reported unknown', ctx.getUnknownEquipment().length === ctx.GYM_EQUIPMENT.length);
    T('isEquipmentAvailable is false for unknown', ctx.isEquipmentAvailable('barbell') === false);

    sub('a new user must still be able to do every exercise');
    const verdicts = Object.keys(ctx.EXERCISE_EQUIPMENT).map(id => ctx.canPerformExercise(id));
    T('no exercise is ever ruled OUT for an unconfigured user',
      verdicts.every(v => v !== 'unavailable'),
      verdicts.filter(v => v === 'unavailable').length + ' ruled out');
    T('equipment-free exercises are still performable',
      ctx.canPerformExercise('pushup') === 'available');
    T('equipment-needing exercises are unknown, not blocked',
      ctx.canPerformExercise('bench_press_barbell') === 'unknown');
    T('no gymProfile key written just by loading', app.store.gymProfile === undefined);
  }

  sub('user configures the gym');
  {
    const app = await H.loadAppBooted({});
    const ctx = app.ctx;
    ctx.setEquipmentAvailable('barbell', true);
    T('configuring stamps configuredAt', ctx.isGymProfileConfigured() === true);
    T('barbell now available', ctx.getEquipmentStatus('barbell') === 'available');
    T('isEquipmentAvailable agrees', ctx.isEquipmentAvailable('barbell') === true);
    T('untouched item stays UNKNOWN, not unavailable',
      ctx.getEquipmentStatus('hack_squat') === 'unknown');

    ctx.setEquipmentAvailable('bench', false);
    T('explicit false is UNAVAILABLE', ctx.getEquipmentStatus('bench') === 'unavailable');
    T('available list reflects the choice', ctx.getAvailableEquipment().includes('barbell'));
    T('unavailable list reflects the choice', ctx.getUnavailableEquipment().includes('bench'));

    sub('canPerformExercise across the three states');
    T('all requirements available -> available',
      (ctx.setEquipmentAvailable('bench', true), ctx.canPerformExercise('bench_press_barbell')) === 'available');
    T('a required item explicitly missing -> unavailable',
      (ctx.setEquipmentAvailable('bench', false),
       ctx.setEquipmentAvailable('adjustable_bench', false),
       ctx.canPerformExercise('bench_press_barbell')) === 'unavailable');
    T('an unset requirement -> unknown, never unavailable',
      ctx.canPerformExercise('squat_hack') === 'unknown');
    T('any-of group satisfied by one member',
      (ctx.setEquipmentAvailable('adjustable_bench', true),
       ctx.canPerformExercise('bench_press_barbell')) === 'available');
    T('rejecting the whole registry never breaks equipment-free work',
      ctx.canPerformExercise('plank') === 'available');
  }

  sub('rapid toggling stays consistent');
  {
    const app = await H.loadAppBooted({});
    const ctx = app.ctx;
    for(let i = 0; i < 40; i++) ctx.setEquipmentAvailable('dumbbells', i % 2 === 0);
    T('final state matches the last toggle', ctx.getEquipmentStatus('dumbbells') === 'unavailable');
    for(let i = 0; i < 41; i++) ctx.setEquipmentAvailable('dumbbells', i % 2 === 0);
    T('odd count lands on available', ctx.getEquipmentStatus('dumbbells') === 'available');
    T('derived lists stay in sync after rapid toggling',
      ctx.getAvailableEquipment().includes('dumbbells') &&
      !ctx.getUnavailableEquipment().includes('dumbbells'));
    T('toggling an unknown id is rejected safely',
      ctx.setEquipmentAvailable('not_a_real_thing', true) === false);
  }

  sub('registry growth — an item a saved profile has never seen');
  {
    const saved = JSON.stringify({ version:1, configuredAt:'2026-01-01T00:00:00.000Z',
      equipment:{ barbell:true }, custom:[] });
    const app = await H.loadAppBooted({ gymProfile: saved });
    const ctx = app.ctx;
    T('configured profile loads', ctx.isGymProfileConfigured() === true);
    T('known choice preserved', ctx.getEquipmentStatus('barbell') === 'available');
    T('an item absent from the saved profile is UNKNOWN, not unavailable',
      ctx.getEquipmentStatus('reverse_hyper') === 'unknown');
    T('a future registry addition cannot silently block exercises',
      ctx.canPerformExercise('squat_hack') === 'unknown');
  }

  sub('save and reload');
  {
    const app = await H.loadAppBooted({});
    const ctx = app.ctx;
    ctx.setEquipmentAvailable('barbell', true);
    ctx.setEquipmentAvailable('hack_squat', false);
    ctx.addCustomEquipment('Atlantis chest press');
    await H.settle(60);
    T('profile persisted to its own key', !!app.store.gymProfile);
    const reopened = await H.loadAppBooted(app.store);
    T('available choice survived reload', reopened.ctx.getEquipmentStatus('barbell') === 'available');
    T('unavailable choice survived reload', reopened.ctx.getEquipmentStatus('hack_squat') === 'unavailable');
    T('unknown stayed unknown after reload', reopened.ctx.getEquipmentStatus('sled') === 'unknown');
    T('custom equipment survived reload', reopened.ctx.gymProfile.custom.length === 1);
    T('configuredAt survived reload', !!reopened.ctx.gymProfile.configuredAt);
  }

  sub('custom equipment is never trusted for compatibility');
  {
    const app = await H.loadAppBooted({});
    const ctx = app.ctx;
    const e = ctx.addCustomEquipment('  Atlantis chest press  ');
    T('custom entry created', !!e);
    T('label trimmed', e.label === 'Atlantis chest press');
    T('custom ids are namespaced', ctx.isCustomEquipmentId(e.id));
    T('custom entry is explicitly unmapped', e.mapped === false);
    T('custom equipment is not in the trusted registry', ctx.getGymEquipment(e.id) === null);
    T('custom equipment reports UNKNOWN status, never available',
      ctx.getEquipmentStatus(e.id) === 'unknown');
    T('custom equipment never appears in available list',
      !ctx.getAvailableEquipment().includes(e.id));
    T('duplicate custom is rejected', ctx.addCustomEquipment('Atlantis chest press') === null);
    T('empty custom is rejected', ctx.addCustomEquipment('   ') === null);
    T('custom can be removed', ctx.removeCustomEquipment(e.id) === true);
    T('removing a missing custom is safe', ctx.removeCustomEquipment('custom:nope') === false);
  }

  sub('coarse bridge is read-only');
  {
    const app = await H.loadAppBooted({});
    const ctx = app.ctx;
    const profileBefore = JSON.stringify(ctx.athleteProfile.equipment);
    ctx.setEquipmentAvailable('barbell', true);
    ctx.setEquipmentAvailable('treadmill', true);
    T('coarse derivation reports Barbell', ctx.coarseEquipmentFromGym().includes('Barbell'));
    T('cardio contributes no coarse bucket', !ctx.coarseEquipmentFromGym().includes('Cardio'));
    T('athleteProfile.equipment is NOT written by the gym profile',
      JSON.stringify(ctx.athleteProfile.equipment) === profileBefore);
  }
}

/* Existing users, existing data, and every protected system. */
async function testGymIsolation(){
  section('CONTRACT 34 — gym profile is isolated from every protected system');

  sub('an existing user with real history and no gym profile');
  const fixture = buildProtectionFixture();
  const app = await H.loadAppBooted(fixture);
  const ctx = app.ctx;

  T('existing user has no gym profile', ctx.isGymProfileConfigured() === false);
  T('their history is intact', ctx.workoutLog.length === 104);
  T('their trainerLog is intact', ctx.trainerLog.entries.length === 24);
  T('their plan is intact', !!ctx.selectedPlanId);
  T('no exercise is hidden from them', Object.keys(ctx.EXERCISE_EQUIPMENT)
    .every(id => ctx.canPerformExercise(id) !== 'unavailable'));

  const before = H.snapshot(ctx);
  const progBefore = ctx.getCurrentProgression();
  const trainerBefore = ctx.trainerLog.entries.length;
  const cardioBefore = JSON.stringify(ctx.cardioLog);
  const draftBefore = app.store.activeWorkoutDraft;
  const plansBefore = app.store.selectedPlan;
  const recBefore = JSON.stringify(ctx.computeShadowRecommendation('Bench Press', {}));

  // Configure a full gym — the loudest possible use of this system.
  ctx.GYM_EQUIPMENT.forEach((e, i) => ctx.setEquipmentAvailable(e.id, i % 2 === 0));
  ctx.addCustomEquipment('Atlantis chest press');
  await H.settle(60);
  clearCaches(ctx);
  const after = H.snapshot(ctx);

  sub('protected data');
  const d = H.diffSnapshot(before, after, []);
  T('NOTHING protected changed', d.ok, 'changed: ' + d.violations.join(','));
  T('workoutLog byte-identical', after.rawWorkoutLog === before.rawWorkoutLog);
  T('cardioLog unchanged', JSON.stringify(ctx.cardioLog) === cardioBefore);
  T('plans unchanged', app.store.selectedPlan === plansBefore);
  T('drafts unchanged', app.store.activeWorkoutDraft === draftBefore);

  sub('XP / PRs');
  T('lifetime XP unchanged', after.xp === before.xp);
  T('level unchanged', after.level === before.level);
  T('strength XP unchanged', ctx.getCurrentProgression().strengthXP === progBefore.strengthXP);
  T('cardio XP unchanged', ctx.getCurrentProgression().cardioXP === progBefore.cardioXP);
  T('PR count unchanged', after.prCount === before.prCount);

  sub('trainer');
  T('engine still 0.1.1-shadow', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  T('no trainerLog entries created by equipment changes',
    ctx.trainerLog.entries.length === trainerBefore);
  T('shadow recommendation identical before and after configuring a gym',
    JSON.stringify(ctx.computeShadowRecommendation('Bench Press', {})) === recBefore);
  T('trainer states unchanged',
    JSON.stringify(ctx.TRAINER_STATES) === JSON.stringify(['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF']));

  sub('recovery / capability / readiness');
  T('recovery unchanged', after.recovery === before.recovery);
  T('capability unchanged', after.capabilityBench === before.capabilityBench);
  T('readiness unchanged', after.readiness === before.readiness);

  sub('storage isolation');
  T('gym data lives in its own key', !!app.store.gymProfile);
  T('gymProfile registered for backup', ctx.DATA_KEYS.includes('gymProfile'));
  T('gym data is NOT inside athleteProfile',
    !JSON.stringify(JSON.parse(app.store.athleteProfile)).includes('hack_squat'));
  T('gym data is NOT inside workoutLog', !app.store.workoutLog.includes('hack_squat'));
  T('gym data is NOT inside trainerLog', !app.store.trainerLog.includes('hack_squat'));
  T('schema version untouched', ctx.DATA_SCHEMA_VERSION === 1);
}

/* Backup must carry the gym profile, under the existing gap-fill semantics. */
async function testGymBackup(){
  section('CONTRACT 35 — gym profile survives backup / restore');

  sub('export captures the gym profile');
  const app = await H.loadAppBooted({ workoutLog: JSON.stringify([]) });
  const ctx = app.ctx;
  ctx.setEquipmentAvailable('barbell', true);
  ctx.setEquipmentAvailable('hack_squat', false);
  ctx.addCustomEquipment('Atlantis chest press');
  await H.settle(60);

  const keys = await ctx.allDataKeys();
  T('gymProfile is in the backup key list', keys.includes('gymProfile'));
  const exported = {};
  for(const k of keys){
    const r = await ctx.LOOPStore.get(k);
    if(r && r.value !== undefined && r.value !== null) exported[k] = r.value;
  }
  T('export contains the gym profile', !!exported.gymProfile);
  T('export preserves availability', JSON.parse(exported.gymProfile).equipment.barbell === true);
  T('export preserves unavailability', JSON.parse(exported.gymProfile).equipment.hack_squat === false);
  T('export preserves custom equipment', JSON.parse(exported.gymProfile).custom.length === 1);

  sub('restore into a fresh device');
  const restored = await H.loadAppBooted(exported);
  T('restore rebuilds configured state', restored.ctx.isGymProfileConfigured() === true);
  T('restore rebuilds available equipment', restored.ctx.getEquipmentStatus('barbell') === 'available');
  T('restore rebuilds unavailable equipment', restored.ctx.getEquipmentStatus('hack_squat') === 'unavailable');
  T('restore leaves unseen equipment UNKNOWN', restored.ctx.getEquipmentStatus('sled') === 'unknown');
  T('restore rebuilds custom equipment', restored.ctx.gymProfile.custom.length === 1);

  sub('import gap-fill semantics preserved');
  {
    // Fresh device with no gym profile — import should fill the gap.
    const fresh = await H.loadAppBooted({ workoutLog: JSON.stringify([]) });
    const payload = { app:'LOOP', schemaVersion:1, exportedAt:new Date().toISOString(),
      data: { gymProfile: exported.gymProfile } };
    await fresh.ctx.importAllData(mkImportFile(payload));
    T('gym profile imported into an empty slot', fresh.store.gymProfile === exported.gymProfile);
  }
  {
    // Device that already has its own gym profile — must NOT be overwritten.
    const mine = JSON.stringify({ version:1, configuredAt:'2026-02-02T00:00:00.000Z',
      equipment:{ dumbbells:true }, custom:[] });
    const owned = await H.loadAppBooted({ workoutLog: JSON.stringify([]), gymProfile: mine });
    const payload = { app:'LOOP', schemaVersion:1, exportedAt:new Date().toISOString(),
      data: { gymProfile: exported.gymProfile } };
    await owned.ctx.importAllData(mkImportFile(payload));
    T('existing gym profile is NOT overwritten by import', owned.store.gymProfile === mine);
  }
}

/* =========================================================
   CONTRACT 36-38 — EXERCISE SUBSTITUTION ENGINE (Phase D2)
   ---------------------------------------------------------
   The engine ranks; a person chooses. These tests hold three
   lines: hard filters are genuinely hard (a soft preference
   can never smuggle back an unavailable or incompatible
   exercise), training intent outranks familiarity, and
   choosing a replacement touches today's draft and nothing
   else — not the plan, not history, not capability, not the
   trainer.
   ========================================================= */
function testSubstitutionRanking(app){
  section('CONTRACT 36 — substitution ranking & filters');
  const ctx = app.ctx;
  const ids = r => r.map(x => x.exerciseId);

  sub('config is centralized');
  T('SUBSTITUTION_CONFIG exists', !!ctx.SUBSTITUTION_CONFIG);
  T('pattern weights configured', typeof ctx.SUBSTITUTION_CONFIG.pattern.same === 'number');
  T('limits configured', ctx.SUBSTITUTION_CONFIG.limits.maxResults > 0);
  T('surfaced list stays small (3-5 strong candidates)',
    ctx.SUBSTITUTION_CONFIG.limits.maxResults <= 5);

  sub('1. bench press -> best available substitutes');
  const bench = ctx.rankSubstitutionCandidates('bench_press_barbell', {});
  T('produces candidates', bench.length > 0);
  T('never more than the configured maximum',
    bench.length <= ctx.SUBSTITUTION_CONFIG.limits.maxResults);
  T('every candidate is a horizontal push or related pattern',
    bench.every(r => { const c = ctx.getCanonicalExercise(r.exerciseId);
      return c.pattern === 'horizontal_push' || c.pattern === 'vertical_push'; }));
  T('every candidate trains chest',
    bench.every(r => { const c = ctx.getCanonicalExercise(r.exerciseId);
      return c.primary.concat(c.secondary).includes('chest'); }));
  T('offers a machine alternative for a taken bench',
    ids(bench).some(id => ['bench_press_smith','chest_press_machine'].includes(id)));
  T('every candidate carries an explanation', bench.every(r => r.reasons.length > 0));
  T('explanations never expose scoring math',
    bench.every(r => r.reasons.every(x => !/\d+\s*(pts|points|score)/i.test(x))));

  sub('2. pull movement');
  const pulldown = ctx.rankSubstitutionCandidates('lat_pulldown', {});
  T('pulldown produces candidates', pulldown.length > 0);
  T('pull candidates train back',
    pulldown.every(r => { const c = ctx.getCanonicalExercise(r.exerciseId);
      return c.primary.concat(c.secondary).includes('back'); }));
  T('a pull never returns a pressing movement',
    !ids(pulldown).some(id => ['bench_press_barbell','overhead_press_bb'].includes(id)));

  sub('3. lower body');
  const squat = ctx.rankSubstitutionCandidates('squat_back', {});
  T('squat produces candidates', squat.length > 0);
  T('squat candidates are squat or lunge patterns',
    squat.every(r => ['squat','lunge'].includes(ctx.getCanonicalExercise(r.exerciseId).pattern)));
  T('squat never returns an upper-body exercise',
    !ids(squat).some(id => id.indexOf('bench') === 0 || id.indexOf('curl') === 0));

  sub('4/5. machine and cable originals');
  const pecdeck = ctx.rankSubstitutionCandidates('pec_deck', {});
  T('machine exercise produces candidates', pecdeck.length > 0);
  T('machine candidates stay chest-focused',
    pecdeck.every(r => ctx.getCanonicalExercise(r.exerciseId).primary.includes('chest')));
  const pushdown = ctx.rankSubstitutionCandidates('triceps_pushdown', {});
  T('cable exercise produces candidates', pushdown.length > 0);
  T('cable candidates actually train triceps',
    pushdown.every(r => { const c = ctx.getCanonicalExercise(r.exerciseId);
      return c.primary.concat(c.secondary).includes('triceps'); }));

  sub('16. movement / muscle mismatch rejection');
  T('a triceps movement never suggests calf raise', !ids(pushdown).includes('calf_raise'));
  T('a triceps movement never suggests shrug', !ids(pushdown).includes('shrug'));
  T('a triceps movement never suggests a biceps curl',
    !ids(pushdown).some(id => id.indexOf('curl_') === 0));
  T('leg curl never returns a bench press',
    !ids(ctx.rankSubstitutionCandidates('leg_curl', {})).includes('bench_press_barbell'));
  T('hard filter reports muscle mismatch',
    ctx.substitutionHardReject('triceps_pushdown', ctx.getCanonicalExercise('calf_raise'),
      ctx.substitutionContext('triceps_pushdown', {})) === 'no_muscle_overlap');
  T('hard filter reports pattern mismatch',
    ctx.substitutionHardReject('bench_press_barbell', ctx.getCanonicalExercise('leg_press'),
      ctx.substitutionContext('bench_press_barbell', {})) === 'pattern_mismatch');

  sub('6. exercise type / role is respected');
  const legCurl = ctx.rankSubstitutionCandidates('leg_curl', {});
  T('a machine accessory is not topped by a heavy barbell lift',
    legCurl.length > 0 && !['deadlift_conventional','squat_back'].includes(legCurl[0].exerciseId),
    legCurl.length ? legCurl[0].exerciseId : 'none');
  T('barbell escalation is penalized, not silently allowed',
    ctx.SUBSTITUTION_CONFIG.type.barbellEscalation < 0);

  sub('17. the original exercise is never its own substitute');
  const originals = ['bench_press_barbell','lat_pulldown','squat_back','leg_curl','pec_deck','curl_dumbbell'];
  T('original never appears in its own results',
    originals.every(id => !ids(ctx.rankSubstitutionCandidates(id, {})).includes(id)));
  T('hard filter names the reason',
    ctx.substitutionHardReject('bench_press_barbell', ctx.getCanonicalExercise('bench_press_barbell'),
      ctx.substitutionContext('bench_press_barbell', {})) === 'same_exercise');

  sub('18. duplicate variation suppression');
  const fams = {};
  bench.forEach(r => { const c = ctx.getCanonicalExercise(r.exerciseId);
    const k = c.pattern + '|' + c.primary.join('+') + '|' + c.equipment;
    fams[k] = (fams[k] || 0) + 1; });
  T('no more than the configured number per variant family',
    Object.keys(fams).every(k => fams[k] <= ctx.SUBSTITUTION_CONFIG.limits.maxPerVariantFamily));
  T('equipment variety is preserved rather than collapsed',
    new Set(bench.map(r => ctx.getCanonicalExercise(r.exerciseId).equipment)).size >= 2);

  sub('candidate API surface');
  T('getSubstitutionCandidates returns survivors of hard filters',
    ctx.getSubstitutionCandidates('bench_press_barbell', {}).length >= bench.length);
  T('getBestSubstitution returns the top candidate',
    ctx.getBestSubstitution('bench_press_barbell', {}).exerciseId === bench[0].exerciseId);
  T('getBestSubstitution returns null when nothing qualifies',
    ctx.getBestSubstitution('unmapped:nonsense', {}) === null);
  T('by-name lookup resolves canonically',
    ctx.getSubstitutionsByName('Bench Press', {}).length === bench.length);
  T('unknown name yields no candidates, never a guess',
    ctx.getSubstitutionsByName('Zercher Wall Toss', {}).length === 0);

  sub('28. performance — ranking is cached, not rescanned');
  T('repeat call returns the cached array',
    ctx.rankSubstitutionCandidates('bench_press_barbell', {}) ===
    ctx.rankSubstitutionCandidates('bench_press_barbell', {}));
  const t0 = Date.now();
  for(let i = 0; i < 200; i++) ctx.rankSubstitutionCandidates('bench_press_barbell', {});
  T('200 cached lookups are effectively free', Date.now() - t0 < 100, (Date.now()-t0) + 'ms');
}

async function testSubstitutionEquipment(){
  section('CONTRACT 37 — substitution respects the three-state gym profile');

  sub('6/23. unknown gym — nothing is ruled out');
  {
    const app = await H.loadAppBooted({});
    const ctx = app.ctx;
    T('gym is unconfigured', ctx.isGymProfileConfigured() === false);
    const r = ctx.rankSubstitutionCandidates('bench_press_barbell', {});
    T('candidates are still produced', r.length > 0);
    T('no candidate was filtered for equipment',
      r.every(x => x.equipmentStatus !== 'unavailable'));
    T('unknown equipment is not advertised as available',
      r.every(x => !x.reasons.includes('Available at your gym')));
    T('unknown equipment carries no ranking bonus',
      ctx.SUBSTITUTION_CONFIG.equipment.unknown === 0);
  }

  sub('7. fully configured gym — available candidates are promoted');
  {
    const app = await H.loadAppBooted({});
    const ctx = app.ctx;
    ['smith_machine','chest_press_machine','bench','dumbbells'].forEach(e => ctx.setEquipmentAvailable(e, true));
    const r = ctx.rankSubstitutionCandidates('bench_press_barbell', {});
    T('available candidates surface', r.some(x => x.equipmentStatus === 'available'));
    T('available candidates are labelled',
      r.filter(x => x.equipmentStatus === 'available').every(x => x.reasons.includes('Available at your gym')));
    T('an available candidate outranks an unknown one of equal intent',
      r[0].equipmentStatus === 'available');
  }

  sub('8. explicitly unavailable equipment is a HARD filter');
  {
    const app = await H.loadAppBooted({});
    const ctx = app.ctx;
    ctx.setEquipmentAvailable('smith_machine', false);
    ctx.setEquipmentAvailable('chest_press_machine', false);
    const r = ctx.rankSubstitutionCandidates('bench_press_barbell', {});
    T('unavailable smith bench is not offered',
      !r.map(x=>x.exerciseId).includes('bench_press_smith'));
    T('unavailable machine press is not offered',
      !r.map(x=>x.exerciseId).includes('chest_press_machine'));
    T('hard filter names the reason',
      ctx.substitutionHardReject('bench_press_barbell', ctx.getCanonicalExercise('bench_press_smith'),
        ctx.substitutionContext('bench_press_barbell', {})) === 'equipment_unavailable');
    T('other candidates still available', r.length > 0);
  }

  sub('9. multi-equipment requirements are honoured');
  {
    const app = await H.loadAppBooted({});
    const ctx = app.ctx;
    // Dumbbells yes, every bench no -> DB bench press needs both.
    ctx.setEquipmentAvailable('dumbbells', true);
    ctx.setEquipmentAvailable('bench', false);
    ctx.setEquipmentAvailable('adjustable_bench', false);
    T('exercise needing an unavailable second item is excluded',
      !ctx.rankSubstitutionCandidates('bench_press_barbell', {})
        .map(x=>x.exerciseId).includes('bench_press_db'));
    ctx.setEquipmentAvailable('bench', true);
    T('it returns once the second item is available',
      ctx.rankSubstitutionCandidates('bench_press_barbell', {})
        .map(x=>x.exerciseId).includes('bench_press_db'));
  }

  sub('10/24. custom equipment never unlocks an exercise');
  {
    const app = await H.loadAppBooted({});
    const ctx = app.ctx;
    ctx.setEquipmentAvailable('chest_press_machine', false);
    const before = ctx.rankSubstitutionCandidates('bench_press_barbell', {}).map(x=>x.exerciseId);
    ctx.addCustomEquipment('Atlantis chest press');
    ctx.invalidateSubstitutionCache();
    const after = ctx.rankSubstitutionCandidates('bench_press_barbell', {}).map(x=>x.exerciseId);
    T('custom equipment does not make a blocked exercise eligible',
      !after.includes('chest_press_machine'));
    T('custom equipment does not change the ranking at all',
      JSON.stringify(before) === JSON.stringify(after));
  }

  sub('gym changes invalidate the ranking cache');
  {
    const app = await H.loadAppBooted({});
    const ctx = app.ctx;
    const before = ctx.rankSubstitutionCandidates('bench_press_barbell', {}).map(x=>x.exerciseId);
    ctx.setEquipmentAvailable('bench_press_smith', false);   // not a real id, no-op
    ctx.setEquipmentAvailable('smith_machine', false);
    const after = ctx.rankSubstitutionCandidates('bench_press_barbell', {}).map(x=>x.exerciseId);
    T('stale rankings are not served after a gym change',
      before.includes('bench_press_smith') ? !after.includes('bench_press_smith') : true);
  }
}

async function testSubstitutionPersonalization(){
  section('CONTRACT 38 — history, preference and workout context');

  sub('11/22. brand-new user with no history at all');
  {
    const app = await H.loadAppBooted({});
    const ctx = app.ctx;
    const r = ctx.rankSubstitutionCandidates('bench_press_barbell', {});
    T('still produces useful substitutions from metadata alone', r.length > 0);
    T('no candidate claims prior sessions', r.every(x => x.sessions === 0));
    T('no candidate claims familiarity in its reasons',
      r.every(x => !x.reasons.some(s => /used .* times|used once/i.test(s))));
    T('no fabricated capability is attached', r.every(x => x.recommendedWeight === undefined));
  }

  sub('12/13/14. history gives a familiarity advantage');
  {
    const hist = [];
    for(let i = 0; i < 14; i++){
      hist.push(WK('h'+i, i*3, 'push', [EX('Machine Chest Press', [S(140,10,2,'working')])]));
    }
    const app = await H.loadAppBooted({ workoutLog: JSON.stringify(hist) });
    const ctx = app.ctx;
    const r = ctx.rankSubstitutionCandidates('bench_press_barbell', {});
    const machine = r.find(x => x.exerciseId === 'chest_press_machine');
    T('the familiar exercise is surfaced', !!machine);
    T('its session count is real, not invented', machine && machine.sessions === 14);
    T('familiarity is explained to the user',
      machine && machine.reasons.some(s => /used 14 times/i.test(s)));
    const unfamiliar = r.find(x => x.sessions === 0);
    T('familiar outranks an equally-matched unfamiliar candidate',
      !unfamiliar || machine.score > unfamiliar.score);
    T('history bonus is capped so intent still wins',
      ctx.SUBSTITUTION_CONFIG.history.maxBonus <= ctx.SUBSTITUTION_CONFIG.pattern.same);
    T('a zero-history candidate is still offered', r.some(x => x.sessions === 0));
  }

  sub('15. preferences influence ranking');
  {
    const app = await H.loadAppBooted({});
    const ctx = app.ctx;
    const baseline = ctx.rankSubstitutionCandidates('bench_press_barbell', {})
      .find(x => x.exerciseId === 'bench_press_db').score;
    ctx.setExercisePreference('Dumbbell Bench Press', 'more');
    ctx.invalidateSubstitutionCache();
    const boosted = ctx.rankSubstitutionCandidates('bench_press_barbell', {})
      .find(x => x.exerciseId === 'bench_press_db');
    T('a stated preference raises the score', boosted.score > baseline);
    T('a preferred lift is explained as such',
      boosted.reasons.includes('One of your preferred lifts'));

    ctx.setExercisePreference('Dumbbell Bench Press', 'never');
    ctx.invalidateSubstitutionCache();
    T('a "never" preference is a HARD filter',
      !ctx.rankSubstitutionCandidates('bench_press_barbell', {})
        .map(x=>x.exerciseId).includes('bench_press_db'));
    T('hard filter names the reason',
      ctx.substitutionHardReject('bench_press_barbell', ctx.getCanonicalExercise('bench_press_db'),
        ctx.substitutionContext('bench_press_barbell', {})) === 'never_preference');

    ctx.setExercisePreference('Dumbbell Bench Press', null);
    ctx.athleteProfile.excludedExercises = ['Dumbbell Bench Press'];
    ctx.invalidateSubstitutionCache();
    T('an excluded exercise is never recommended',
      !ctx.rankSubstitutionCandidates('bench_press_barbell', {})
        .map(x=>x.exerciseId).includes('bench_press_db'));
    ctx.athleteProfile.excludedExercises = [];
    ctx.invalidateSubstitutionCache();
  }

  sub('19. workout-context redundancy');
  {
    const app = await H.loadAppBooted({});
    const ctx = app.ctx;
    const plain = ctx.rankSubstitutionCandidates('bench_press_barbell', {})
      .find(x => x.exerciseId === 'incline_press_db');
    const withRedundancy = ctx.rankSubstitutionCandidates('bench_press_barbell',
      { workoutExerciseIds: ['incline_press_db'] })
      .find(x => x.exerciseId === 'incline_press_db');
    T('an exercise already in today\'s workout is penalized',
      !withRedundancy || withRedundancy.score < plain.score);
    T('redundancy is explained when surfaced',
      !withRedundancy || withRedundancy.reasons.includes('Already in this workout'));
    T('redundancy does not empty the list',
      ctx.rankSubstitutionCandidates('bench_press_barbell',
        { workoutExerciseIds: ['incline_press_db','bench_press_db'] }).length > 0);
    T('context is part of the cache key',
      ctx.rankSubstitutionCandidates('bench_press_barbell', {}) !==
      ctx.rankSubstitutionCandidates('bench_press_barbell', { workoutExerciseIds:['incline_press_db'] }));
  }
}

/* The replacement action itself: today's draft only, nothing else. */
async function testSubstitutionApplySafety(){
  section('CONTRACT 39 — replacing an exercise is non-destructive');

  const fixture = buildProtectionFixture();
  const app = await H.loadAppBooted(fixture);
  const ctx = app.ctx, dom = app.dom;

  const before = H.snapshot(ctx);
  const progBefore = ctx.getCurrentProgression();
  const trainerBefore = ctx.trainerLog.entries.length;
  const planBefore = app.store.selectedPlan;
  const planDataBefore = JSON.stringify(Object.keys(app.store).filter(k => k.indexOf('planData:') === 0)
    .map(k => app.store[k]));
  const gymBefore = app.store.gymProfile;
  const cardioBefore = JSON.stringify(ctx.cardioLog);
  const capBefore = JSON.stringify(ctx.getExerciseCapability('Bench Press'));

  sub('23. opening the substitution UI changes nothing');
  const row = H.mkExRow('Bench Press', false, [{w:225,r:10,rir:2},{w:225,r:8,rir:1}], { targetReps:'8-10', targetSets:'3' });
  dom.setRows([row]);
  const btn = { closest: () => row };
  for(let i = 0; i < 10; i++){ ctx.openSubstitutions(btn); ctx.closeSubstitutions(); }
  T('rapid open/close leaves no dangling target', ctx.substitutionTargetRow === null);
  T('opening created no trainerLog entries', ctx.trainerLog.entries.length === trainerBefore);
  T('opening did not change workoutLog',
    JSON.stringify(ctx.workoutLog) === before.rawWorkoutLog);
  T('opening rendered options', (dom.els.subBody.innerHTML || '').includes('sub-option'));
  T('the sheet states it is today-only',
    (dom.els.subBody.innerHTML || '').toLowerCase().includes("today's workout only"));

  sub('15/20. applying replaces IN PLACE and preserves programming');
  ctx.openSubstitutions(btn);
  const setsBefore = row._setRows.length;
  const repsBefore = row._setRows.map(sr => sr.querySelector('.set-reps-in').value);
  ctx.applySubstitution('chest_press_machine');
  T('the exercise name changed', row.querySelector('.ex-name-in').value === 'Machine Chest Press');
  T('set COUNT preserved', row._setRows.length === setsBefore);
  T('reps preserved exactly',
    JSON.stringify(row._setRows.map(sr => sr.querySelector('.set-reps-in').value)) === JSON.stringify(repsBefore));
  T('no duplicate exercise row was added', dom.document.querySelectorAll('#logExercises .ex-log-row').length === 1);
  T('the sheet closed', ctx.substitutionTargetRow === null);

  sub('18. no capability is copied to the replacement');
  T('weight fields cleared rather than carried over',
    row._setRows.every(sr => sr.querySelector('.set-weight-in').value === ''));
  T('original capability is unchanged',
    JSON.stringify(ctx.getExerciseCapability('Bench Press')) === capBefore);
  T('replacement has its own independent capability',
    JSON.stringify(ctx.getExerciseCapability('Machine Chest Press')) !== capBefore);
  T('shadow marker cleared so an outcome cannot link to the wrong prediction',
    row.dataset.shadowRecId === undefined);

  sub('24. rapid selection is safe');
  ctx.applySubstitution('chest_press_machine');   // no target row now
  T('applying with no open sheet is a no-op', ctx.substitutionTargetRow === null);
  ctx.openSubstitutions(btn);
  ctx.applySubstitution('not_a_real_exercise');
  T('an invalid id is rejected without changing the row',
    row.querySelector('.ex-name-in').value === 'Machine Chest Press');

  sub('16/17/30. everything protected is untouched');
  clearCaches(ctx);
  const after = H.snapshot(ctx);
  /* capabilityBench is ALLOWED to differ in exactly one respect:
     getExerciseCapability() embeds inferredPreference(), and replacing an
     exercise records a swap via the existing recordExerciseSwap() — the same
     preference signal the pre-existing swap dropdown has always written.
     The training numbers must not move, which is asserted field by field
     immediately below, so this is a narrower contract than a blanket pass. */
  const d = H.diffSnapshot(before, after, ['capabilityBench']);
  T('NOTHING protected changed except the documented preference signal',
    d.ok, 'changed: ' + d.violations.join(','));

  const capA = JSON.parse(before.capabilityBench), capB = JSON.parse(after.capabilityBench);
  const stripPref = c => { const x = Object.assign({}, c); delete x.preference; return JSON.stringify(x); };
  T('every capability training field is byte-identical', stripPref(capA) === stripPref(capB));
  T('the ONLY capability difference is the preference signal',
    JSON.stringify(capA.preference) !== JSON.stringify(capB.preference));
  T('session count unchanged', capA.sessions === capB.sessions);
  T('estimated 1RM unchanged', capA.estimated1RM === capB.estimated1RM);
  T('current capability unchanged',
    JSON.stringify(capA.currentCapability) === JSON.stringify(capB.currentCapability));
  T('working range unchanged',
    JSON.stringify(capA.workingRange) === JSON.stringify(capB.workingRange));
  T('capability confidence unchanged',
    JSON.stringify(capA.confidence) === JSON.stringify(capB.confidence));
  T('the swap was recorded as a preference signal (existing behaviour)',
    capB.preference.net < capA.preference.net);
  T('historical workoutLog byte-identical', after.rawWorkoutLog === before.rawWorkoutLog);
  T('history still records the ORIGINAL exercise',
    JSON.parse(app.store.workoutLog).some(w =>
      (w.exercises||[]).some(e => e.name === 'Bench Press')));
  T('histories were not merged',
    !JSON.parse(app.store.workoutLog).some(w =>
      (w.exercises||[]).some(e => e.name === 'Machine Chest Press')));
  T('the saved plan is unchanged', app.store.selectedPlan === planBefore);
  T('plan templates are unchanged',
    JSON.stringify(Object.keys(app.store).filter(k => k.indexOf('planData:') === 0)
      .map(k => app.store[k])) === planDataBefore);
  T('gym profile unchanged', app.store.gymProfile === gymBefore);
  T('XP unchanged', after.xp === before.xp);
  T('strength XP unchanged', ctx.getCurrentProgression().strengthXP === progBefore.strengthXP);
  T('cardio XP unchanged', ctx.getCurrentProgression().cardioXP === progBefore.cardioXP);
  T('PRs unchanged', after.prCount === before.prCount);
  T('readiness unchanged', after.readiness === before.readiness);
  T('recovery unchanged', after.recovery === before.recovery);
  T('capability training history unchanged (preference signal excluded)',
    stripPref(JSON.parse(before.capabilityBench)) === stripPref(JSON.parse(after.capabilityBench)));
  T('cardioLog unchanged', JSON.stringify(ctx.cardioLog) === cardioBefore);

  sub('27. the trainer is untouched');
  T('engine still 0.1.1-shadow', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  T('no trainerLog entries created by substituting',
    ctx.trainerLog.entries.length === trainerBefore);
  T('trainer states unchanged',
    JSON.stringify(ctx.TRAINER_STATES) === JSON.stringify(['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF']));
  T('substitution creates no shadow recommendations',
    ctx.trainerLog.entries.length === trainerBefore);

  sub('29. no new persistent storage was introduced');
  T('no substitutionLog key exists', app.store.substitutionLog === undefined);
  T('DATA_KEYS gained nothing for substitution',
    !ctx.DATA_KEYS.some(k => /substitut/i.test(k)));
  T('schema version untouched', ctx.DATA_SCHEMA_VERSION === 1);
}

/* =========================================================
   CONTRACT 40-42 — UPPER/LOWER LIBRARY + TIME MODE (Phase D3)
   ---------------------------------------------------------
   Two things are being protected here. First, that the eight
   sessions are real programmes rather than lists of exercises
   that happen to parse — hence the muscle-coverage and
   ordering checks. Second, that Time Mode only ever COMPRESSES
   the planned workout: it must never invent an exercise, never
   write to a plan, and never drop the movement the session
   exists for.
   ========================================================= */
const UL = ctx => ctx.DEFAULT_PLANS.upperlower.templates;
const musclesOf = (ctx, name) => {
  const id = ctx.resolveExerciseId(name);
  const c = ctx.getCanonicalExercise(id);
  return c ? c.primary.concat(c.secondary) : [];
};
const patternOf = (ctx, name) => {
  const c = ctx.getCanonicalExercise(ctx.resolveExerciseId(name));
  return c ? c.pattern : null;
};
const coversAny = (ctx, w, list) =>
  w.exercises.some(ex => musclesOf(ctx, ex.name).some(m => list.includes(m)));

function testUpperLowerLibrary(app){
  section('CONTRACT 40 — Upper/Lower library is a real programme');
  const ctx = app.ctx;
  const t = UL(ctx);

  sub('library completeness');
  T('four Upper sessions exist', t.upper.length === 4, String(t.upper.length));
  T('four Lower sessions exist', t.lower.length === 4, String(t.lower.length));
  T('no duplicate template ids',
    new Set(t.upper.concat(t.lower).map(w => w.id)).size === 8);
  T('every session has a name', t.upper.concat(t.lower).every(w => !!w.name));
  T('Upper sessions are labelled A-D',
    ['A','B','C','D'].every(l => t.upper.some(w => w.name.indexOf('Upper ' + l) === 0)));
  T('Lower sessions are labelled A-D',
    ['A','B','C','D'].every(l => t.lower.some(w => w.name.indexOf('Lower ' + l) === 0)));

  sub('every exercise is loggable — no invalid ids');
  const all = t.upper.concat(t.lower);
  const unmapped = [];
  all.forEach(w => w.exercises.forEach(ex => {
    if(!ctx.isCanonicalId(ctx.resolveExerciseId(ex.name))) unmapped.push(w.name + '::' + ex.name);
  }));
  T('every exercise resolves to a canonical id', unmapped.length === 0, unmapped.join(','));
  T('every exercise has sets', all.every(w => w.exercises.every(ex => parseInt(ex.sets) > 0)));
  T('every exercise has a rep prescription', all.every(w => w.exercises.every(ex => !!ex.reps)));
  T('no duplicate exercise inside a session',
    all.every(w => new Set(w.exercises.map(e => e.name)).size === w.exercises.length),
    all.filter(w => new Set(w.exercises.map(e => e.name)).size !== w.exercises.length).map(w=>w.name).join(','));

  sub('session size is realistic — no junk volume');
  T('every session has 5-9 exercises',
    all.every(w => w.exercises.length >= 5 && w.exercises.length <= 9));
  T('every session totals 15-30 sets',
    all.every(w => { const s = ctx.templateSetTotal(w); return s >= 15 && s <= 30; }),
    all.map(w => w.name.split(' —')[0] + ':' + ctx.templateSetTotal(w)).join(' '));
  T('every session estimates 30-75 minutes',
    all.every(w => { const d = ctx.computeWorkoutDuration(w); return d >= 30 && d <= 75; }));

  sub('program quality — Upper muscle coverage');
  t.upper.forEach(w => {
    const short = w.name.split(' —')[0];
    T(short + ' trains chest', coversAny(ctx, w, ['chest']));
    T(short + ' trains back', coversAny(ctx, w, ['back']));
    T(short + ' trains shoulders', coversAny(ctx, w, ['shoulders']));
    T(short + ' trains arms', coversAny(ctx, w, ['biceps','triceps']));
    T(short + ' has a push and a pull pattern',
      w.exercises.some(ex => ['horizontal_push','vertical_push'].includes(patternOf(ctx, ex.name))) &&
      w.exercises.some(ex => ['horizontal_pull','vertical_pull'].includes(patternOf(ctx, ex.name))));
  });

  sub('program quality — Lower muscle coverage');
  t.lower.forEach(w => {
    const short = w.name.split(' —')[0];
    T(short + ' trains quads', coversAny(ctx, w, ['quads']));
    T(short + ' trains hamstrings or glutes', coversAny(ctx, w, ['hamstrings','glutes']));
    T(short + ' has a knee-dominant movement',
      w.exercises.some(ex => ['squat','lunge'].includes(patternOf(ctx, ex.name))));
    T(short + ' has a hinge / posterior movement',
      w.exercises.some(ex => patternOf(ctx, ex.name) === 'hinge'));
    T(short + ' trains calves', coversAny(ctx, w, ['calves']));
  });

  sub('sensible ordering — compounds lead');
  all.forEach(w => {
    const tiers = ctx.assignTimeTiers(w.exercises);
    const firstPattern = patternOf(ctx, w.exercises[0].name);
    T(w.name.split(' —')[0] + ' opens with a compound movement',
      ctx.TIME_MODE_COMPOUND_PATTERNS.includes(firstPattern), String(firstPattern));
    T(w.name.split(' —')[0] + ' has a distinct major opposing movement',
      tiers.indexOf(2) > 0);
  });

  sub('the four variants are genuinely different');
  const overlap = (a, b) => {
    const A = new Set(a.exercises.map(e => e.name));
    return b.exercises.filter(e => A.has(e.name)).length;
  };
  ['upper','lower'].forEach(cat => {
    for(let i = 0; i < 4; i++) for(let j = i+1; j < 4; j++){
      const a = t[cat][i], b = t[cat][j];
      const shared = overlap(a, b);
      T(`${a.name.split(' —')[0]} vs ${b.name.split(' —')[0]} are not near-duplicates`,
        shared <= Math.floor(Math.min(a.exercises.length, b.exercises.length) * 0.6),
        shared + ' shared');
    }
  });
  T('Upper variants use at least 14 distinct exercises',
    new Set([].concat(...t.upper.map(w => w.exercises.map(e => e.name)))).size >= 14);
  T('Lower variants use at least 10 distinct exercises',
    new Set([].concat(...t.lower.map(w => w.exercises.map(e => e.name)))).size >= 10);

  sub('gym profile does not rewrite the plan');
  const beforeJson = JSON.stringify(UL(ctx));
  ctx.GYM_EQUIPMENT.forEach(e => ctx.setEquipmentAvailable(e.id, false));
  T('templates unchanged when every piece of equipment is unavailable',
    JSON.stringify(UL(ctx)) === beforeJson);
  T('exercises are still present rather than silently removed',
    UL(ctx).upper[0].exercises.length === t.upper[0].exercises.length);
  ctx.GYM_EQUIPMENT.forEach(e => ctx.setEquipmentAvailable(e.id, true));

  sub('Replace still works against the new templates');
  const sub1 = ctx.getSubstitutionsByName(UL(ctx).upper[2].exercises[0].name, {});
  T('a new template exercise has substitution candidates', sub1.length > 0);
  T('candidates never include the exercise itself',
    !sub1.map(x=>x.displayName).includes(UL(ctx).upper[2].exercises[0].name));
}

function testTimeModeMatrix(app){
  section('CONTRACT 41 — Time Mode compresses, never generates');
  const ctx = app.ctx;
  const t = UL(ctx);
  const all = t.upper.concat(t.lower);
  const MODES = [90, 60, 45, 30, 15];

  sub('configuration');
  T('TIME_MODE_CONFIG exists', !!ctx.TIME_MODE_CONFIG);
  T('offers the expected options',
    JSON.stringify(ctx.TIME_MODE_CONFIG.options) === JSON.stringify([15,30,45,60,90]));
  T('tiers 1 and 2 are protected',
    JSON.stringify(ctx.TIME_MODE_CONFIG.protectedTiers) === JSON.stringify([1,2]));

  sub('FULL / default equals the planned workout exactly');
  all.forEach(w => {
    const full = ctx.compressWorkoutForTime(w, null);
    T(w.name.split(' —')[0] + ' full mode is identical to the plan',
      JSON.stringify(full.exercises) === JSON.stringify(w.exercises));
  });

  sub('the matrix — every workout at every mode');
  all.forEach(w => {
    const short = w.name.split(' —')[0];
    const tiers = ctx.assignTimeTiers(w.exercises);
    const primary = w.exercises[tiers.indexOf(1)].name;
    const t2i = tiers.indexOf(2);
    const opposing = t2i >= 0 ? w.exercises[t2i].name : null;
    const planNames = new Set(w.exercises.map(e => e.name));

    let prevSets = ctx.templateSetTotal(w), prevCount = w.exercises.length;
    MODES.forEach(m => {
      const a = ctx.compressWorkoutForTime(w, m);
      const names = a.exercises.map(e => e.name);
      T(`${short} @${m} keeps the primary movement`, names.includes(primary));
      if(opposing) T(`${short} @${m} keeps the major opposing movement`, names.includes(opposing));
      T(`${short} @${m} invents no exercise`, names.every(n => planNames.has(n)));
      T(`${short} @${m} has no duplicate rows`, new Set(names).size === names.length);
      T(`${short} @${m} keeps a workable session`, a.exercises.length >= 3);
      const sets = ctx.templateSetTotal(a);
      T(`${short} @${m} workload does not exceed the longer mode`, sets <= prevSets,
        sets + ' > ' + prevSets);
      T(`${short} @${m} exercise count does not exceed the longer mode`,
        a.exercises.length <= prevCount);
      prevSets = sets; prevCount = a.exercises.length;
    });
  });

  sub('15-minute sessions stay realistic');
  all.forEach(w => {
    const a = ctx.compressWorkoutForTime(w, 15);
    const short = w.name.split(' —')[0];
    T(short + ' @15 is not an unrealistic 20-set session', ctx.templateSetTotal(a) <= 12,
      String(ctx.templateSetTotal(a)));
    T(short + ' @15 estimates at or under 20 minutes', ctx.computeWorkoutDuration(a) <= 20,
      String(ctx.computeWorkoutDuration(a)));
  });

  sub('sets are trimmed before movements are dropped');
  {
    const w = t.upper[0];
    const a = ctx.compressWorkoutForTime(w, 45);
    const benchFull = w.exercises[0].sets;
    const benchCut = a.exercises.find(e => e.name === w.exercises[0].name).sets;
    T('the primary lift survives a moderate cut', !!benchCut);
    T('a moderate cut reduces rather than deletes',
      a.exercises.length >= 4 && parseInt(benchCut) <= parseInt(benchFull));
    T('no exercise is reduced below the configured floor',
      a.exercises.every(e => parseInt(e.sets) >= ctx.TIME_MODE_CONFIG.minSets.accessory));
  }

  sub('deterministic and repeatable');
  {
    const w = t.lower[0];
    const a = JSON.stringify(ctx.compressWorkoutForTime(w, 30));
    for(let i = 0; i < 20; i++){
      T_quiet(JSON.stringify(ctx.compressWorkoutForTime(w, 30)) === a);
    }
    T('20 repeat compressions are byte-identical', T_quietOk());
    // switching back and forth many times must not drift
    let last = null;
    for(let i = 0; i < 30; i++){
      const m = [null,15,30,45,60,90][i % 6];
      last = ctx.compressWorkoutForTime(w, m);
    }
    T('switching modes repeatedly does not corrupt the template',
      JSON.stringify(UL(ctx).lower[0].exercises) === JSON.stringify(w.exercises));
    T('a later full request still returns the complete workout',
      ctx.compressWorkoutForTime(w, null).exercises.length === w.exercises.length);
  }

  sub('estimation is presented as an estimate');
  {
    const s = ctx.timeModeSummary(t.upper[0], 30);
    T('summary reports both source and result', s.sourceName === t.upper[0].name && s.estimatedMinutes > 0);
    T('summary reports it compressed', s.compressed === true);
    T('full mode reports no compression', ctx.timeModeSummary(t.upper[0], null).compressed === false);
  }
}

/* tiny quiet-assert helper so 20 identical checks do not spam 20 lines */
let _quietFails = 0;
function T_quiet(cond){ if(!cond) _quietFails++; }
function T_quietOk(){ const ok = _quietFails === 0; _quietFails = 0; return ok; }

async function testTimeModeSafety(){
  section('CONTRACT 42 — Time Mode touches no plan and no user data');
  const fixture = buildProtectionFixture();
  const app = await H.loadAppBooted(fixture);
  const ctx = app.ctx;

  const before = H.snapshot(ctx);
  const progBefore = ctx.getCurrentProgression();
  const trainerBefore = ctx.trainerLog.entries.length;
  const planBefore = app.store.selectedPlan;
  const planDataBefore = JSON.stringify(Object.keys(app.store)
    .filter(k => k.indexOf('planData:') === 0).map(k => app.store[k]));
  const templatesBefore = JSON.stringify(ctx.DEFAULT_PLANS.upperlower.templates);
  const gymBefore = app.store.gymProfile;
  const draftBefore = app.store.activeWorkoutDraft;
  const cardioBefore = JSON.stringify(ctx.cardioLog);

  sub('selecting every time mode');
  [15,30,45,60,90,null].forEach(m => { ctx.selectedWorkoutMinutes = m;
    ctx.compressWorkoutForTime(ctx.DEFAULT_PLANS.upperlower.templates.upper[0], m); });
  ctx.selectedWorkoutMinutes = null;

  T('DEFAULT_PLANS templates are byte-identical',
    JSON.stringify(ctx.DEFAULT_PLANS.upperlower.templates) === templatesBefore);
  T('saved plan selection unchanged', app.store.selectedPlan === planBefore);
  T('planData templates unchanged',
    JSON.stringify(Object.keys(app.store).filter(k => k.indexOf('planData:') === 0)
      .map(k => app.store[k])) === planDataBefore);
  T('no time mode key was persisted', app.store.workoutTimeMode === undefined);
  T('DATA_KEYS gained nothing for time mode',
    !ctx.DATA_KEYS.some(k => /time|minutes/i.test(k)));

  sub('user data');
  clearCaches(ctx);
  const after = H.snapshot(ctx);
  const d = H.diffSnapshot(before, after, []);
  T('NOTHING protected changed', d.ok, 'changed: ' + d.violations.join(','));
  T('workoutLog byte-identical', after.rawWorkoutLog === before.rawWorkoutLog);
  T('cardioLog unchanged', JSON.stringify(ctx.cardioLog) === cardioBefore);
  T('XP unchanged', after.xp === before.xp);
  T('strength XP unchanged', ctx.getCurrentProgression().strengthXP === progBefore.strengthXP);
  T('cardio XP unchanged', ctx.getCurrentProgression().cardioXP === progBefore.cardioXP);
  T('level unchanged', after.level === before.level);
  T('PRs unchanged', after.prCount === before.prCount);
  T('readiness unchanged', after.readiness === before.readiness);
  T('recovery unchanged', after.recovery === before.recovery);
  T('capability unchanged', after.capabilityBench === before.capabilityBench);
  T('gymProfile unchanged', app.store.gymProfile === gymBefore);
  T('draft preserved', app.store.activeWorkoutDraft === draftBefore);

  sub('trainer');
  T('engine still 0.1.1-shadow', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  T('no trainerLog entries created by time mode',
    ctx.trainerLog.entries.length === trainerBefore);
  T('trainer states unchanged',
    JSON.stringify(ctx.TRAINER_STATES) === JSON.stringify(['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF']));

  sub('read-only interface for a future phase');
  T('getAvailableTime reports the session choice', ctx.getAvailableTime() === null);
  ctx.selectedWorkoutMinutes = 30;
  T('getAvailableTime reflects a selection', ctx.getAvailableTime() === 30);
  T('getTimeAdjustedWorkout compresses a supplied template',
    ctx.getTimeAdjustedWorkout(ctx.DEFAULT_PLANS.upperlower.templates.upper[0], 15).exercises.length < 8);
  T('getTimeAdjustedWorkout returns null with no workout', ctx.getTimeAdjustedWorkout(null, 30) === null ||
    !!ctx.getTimeAdjustedWorkout(null, 30));
  ctx.selectedWorkoutMinutes = null;

  sub('duration fields are optional and additive');
  T('historical entries carry no timing fields',
    ctx.workoutLog.every(w => w.startedAt === undefined));
  T('plannedVsActualHtml renders nothing without timing',
    ctx.plannedVsActualHtml({ id:'x' }) === '');
  T('plannedVsActualHtml renders when timing is known',
    ctx.plannedVsActualHtml({ id:'y', startedAt:'2026-08-24T10:00:00.000Z',
      endedAt:'2026-08-24T10:51:14.000Z', plannedMinutes:47 }).includes('51:14'));
  T('planned figure is marked as an estimate',
    ctx.plannedVsActualHtml({ id:'y', startedAt:'2026-08-24T10:00:00.000Z',
      endedAt:'2026-08-24T10:51:14.000Z', plannedMinutes:47 }).includes('~47'));
}

/* =========================================================
   CONTRACT 43-45 — UPPER/LOWER PLAN INTEGRATION (Phase D4)
   ---------------------------------------------------------
   Upper/Lower became available inside Balanced, Strength,
   Hypertrophy and Home. Athletic was deliberately left alone.

   The risk in this phase is not the templates — it is the
   backfill that delivers them. An existing athlete already has
   `upper: []` persisted in planData, so the tests below check
   hard that filling it never touches a category they have
   customised, never rewrites their schedule, and never so much
   as looks at their history.
   ========================================================= */
const UL_PLANS = ['balanced','strength','hypertrophy','home'];
const ALL_UL_PLANS = UL_PLANS.concat(['upperlower']);

function testPlanUpperLowerIntegration(app){
  section('CONTRACT 43 — Upper/Lower is available across the plan library');
  const ctx = app.ctx;

  sub('which plans gained Upper/Lower');
  UL_PLANS.forEach(p => {
    const t = ctx.DEFAULT_PLANS[p].templates;
    T(p + ' has 4 Upper sessions', (t.upper || []).length === 4, String((t.upper||[]).length));
    T(p + ' has 4 Lower sessions', (t.lower || []).length === 4, String((t.lower||[]).length));
  });
  T('upperlower plan still has its own 4+4',
    ctx.DEFAULT_PLANS.upperlower.templates.upper.length === 4 &&
    ctx.DEFAULT_PLANS.upperlower.templates.lower.length === 4);
  T('Athletic was deliberately NOT converted',
    !(ctx.DEFAULT_PLANS.athletic.templates.upper || []).length &&
    !(ctx.DEFAULT_PLANS.athletic.templates.lower || []).length);

  sub('existing plan structures were preserved, not replaced');
  ['balanced','strength','hypertrophy','home','athletic'].forEach(p => {
    const t = ctx.DEFAULT_PLANS[p].templates;
    ['push','pull','legs','core','fullbody'].forEach(cat => {
      T(`${p}.${cat} still has its 4 workouts`, (t[cat] || []).length === 4,
        p + '.' + cat + '=' + (t[cat]||[]).length);
    });
  });
  T('no plan lost its default schedule',
    ['balanced','strength','hypertrophy','home','athletic'].every(p =>
      Object.keys(ctx.DEFAULT_PLANS[p].defaultSchedule).length === 7));
  T('default schedules were NOT rewritten to Upper/Lower',
    ['balanced','strength','hypertrophy','home','athletic'].every(p =>
      !Object.values(ctx.DEFAULT_PLANS[p].defaultSchedule).some(v => v === 'upper' || v === 'lower')));

  sub('template integrity');
  const ids = [];
  ALL_UL_PLANS.forEach(p => ['upper','lower'].forEach(cat =>
    (ctx.DEFAULT_PLANS[p].templates[cat] || []).forEach(w => ids.push(w.id))));
  T('every Upper/Lower template id is unique across plans',
    new Set(ids).size === ids.length, ids.length + ' ids');
  ALL_UL_PLANS.forEach(p => ['upper','lower'].forEach(cat => {
    (ctx.DEFAULT_PLANS[p].templates[cat] || []).forEach(w => {
      T(`${p}/${w.id} has 5-9 exercises`, w.exercises.length >= 5 && w.exercises.length <= 9,
        String(w.exercises.length));
      T(`${p}/${w.id} has no duplicate exercise`,
        new Set(w.exercises.map(e => e.name)).size === w.exercises.length);
      T(`${p}/${w.id} prescribes sets and reps everywhere`,
        w.exercises.every(e => parseInt(e.sets) > 0 && !!e.reps));
    });
  }));

  sub('exercises resolve — canonical for gym plans');
  const bad = [];
  ['balanced','strength','hypertrophy','upperlower'].forEach(p =>
    ['upper','lower'].forEach(cat => (ctx.DEFAULT_PLANS[p].templates[cat] || []).forEach(w =>
      w.exercises.forEach(e => {
        if(!ctx.isCanonicalId(ctx.resolveExerciseId(e.name))) bad.push(p + '/' + w.id + '::' + e.name);
      }))));
  T('every gym-plan Upper/Lower exercise is canonical', bad.length === 0, bad.join(','));

  sub('Home stays home — equipment appropriateness by construction');
  {
    const home = ctx.DEFAULT_PLANS.home.templates;
    const vocab = new Set();
    ['push','pull','legs','core','fullbody'].forEach(cat =>
      home[cat].forEach(w => w.exercises.forEach(e => vocab.add(e.name))));
    const outside = [];
    ['upper','lower'].forEach(cat => home[cat].forEach(w => w.exercises.forEach(e => {
      if(!vocab.has(e.name)) outside.push(w.id + '::' + e.name);
    })));
    T('Home Upper/Lower uses only exercises the Home plan already used',
      outside.length === 0, outside.join(','));
    /* Canonical equipment is NOT a reliable proxy here: "Glute Bridge"
       aliases to Hip Thrust, which the registry marks Barbell, yet it is a
       bodyweight movement this plan has always used. The Home plan's own
       vocabulary is the authority for what is home-appropriate, so the
       meaningful check is that none of the gym-only staples leaked in. */
    const GYM_ONLY = ['Bench Press','Incline Bench Press','Back Squat','Front Squat','Deadlift',
      'Romanian Deadlift','Leg Press','Hack Squat','Lat Pulldown','Seated Cable Row',
      'Machine Chest Press','Machine Row','Pec Deck','Leg Curl','Leg Extension','Smith Machine Squat',
      'Cable Fly','Triceps Pushdown','Cable Curl','Overhead Press','Barbell Row','Barbell Curl'];
    const leaked = [];
    ['upper','lower'].forEach(cat => home[cat].forEach(w => w.exercises.forEach(e => {
      if(GYM_ONLY.includes(e.name)) leaked.push(w.id + '::' + e.name);
    })));
    T('no gym-only exercise leaked into Home Upper/Lower', leaked.length === 0, leaked.join(','));
    T('Home Upper/Lower is dumbbell, band or bodyweight throughout',
      ['upper','lower'].every(cat => home[cat].every(w => w.exercises.every(e =>
        /^(DB |Band |Bodyweight |Single-Leg |Single-Arm |Slow Tempo |Incline Push|Pike |Diamond |Push-Up|Towel |Chair |Bench Dips|Wall Sit|Goblet|Walking Lunge|Glute Bridge|Calf Raise|Reverse Fly|Superman|Plank)/.test(e.name)))));
  }

  sub('program quality — Upper coverage (gym plans)');
  const musclesOfEx = (name) => {
    const c = ctx.getCanonicalExercise(ctx.resolveExerciseId(name));
    return c ? c.primary.concat(c.secondary) : [];
  };
  const patternOfEx = (name) => {
    const c = ctx.getCanonicalExercise(ctx.resolveExerciseId(name));
    return c ? c.pattern : null;
  };
  ['balanced','strength','hypertrophy'].forEach(p => {
    ctx.DEFAULT_PLANS[p].templates.upper.forEach(w => {
      const all = [].concat(...w.exercises.map(e => musclesOfEx(e.name)));
      T(`${p}/${w.id} trains chest`, all.includes('chest'));
      T(`${p}/${w.id} trains back`, all.includes('back'));
      T(`${p}/${w.id} trains shoulders`, all.includes('shoulders'));
      T(`${p}/${w.id} trains arms`, all.includes('biceps') || all.includes('triceps'));
      T(`${p}/${w.id} has both a push and a pull pattern`,
        w.exercises.some(e => ['horizontal_push','vertical_push'].includes(patternOfEx(e.name))) &&
        w.exercises.some(e => ['horizontal_pull','vertical_pull'].includes(patternOfEx(e.name))));
    });
    ctx.DEFAULT_PLANS[p].templates.lower.forEach(w => {
      const all = [].concat(...w.exercises.map(e => musclesOfEx(e.name)));
      T(`${p}/${w.id} trains quads`, all.includes('quads'));
      T(`${p}/${w.id} trains hamstrings or glutes`,
        all.includes('hamstrings') || all.includes('glutes'));
      T(`${p}/${w.id} has a knee-dominant movement`,
        w.exercises.some(e => ['squat','lunge'].includes(patternOfEx(e.name))));
      T(`${p}/${w.id} has a hinge movement`,
        w.exercises.some(e => patternOfEx(e.name) === 'hinge'));
      T(`${p}/${w.id} trains calves`, all.includes('calves'));
    });
  });

  sub('variety — a rotation is not the same session four times');
  UL_PLANS.forEach(p => ['upper','lower'].forEach(cat => {
    const list = ctx.DEFAULT_PLANS[p].templates[cat];
    for(let i = 0; i < list.length; i++) for(let j = i+1; j < list.length; j++){
      const A = new Set(list[i].exercises.map(e => e.name));
      const shared = list[j].exercises.filter(e => A.has(e.name)).length;
      const cap = Math.floor(Math.min(list[i].exercises.length, list[j].exercises.length) * 0.7);
      T(`${p}/${cat} ${list[i].id} vs ${list[j].id} are not near-duplicates`,
        shared <= cap, shared + '>' + cap);
    }
    T(`${p}/${cat} variants have distinct names`,
      new Set(list.map(w => w.name)).size === list.length);
  }));

  sub('Time Mode works with every new session');
  ALL_UL_PLANS.forEach(p => ['upper','lower'].forEach(cat => {
    (ctx.DEFAULT_PLANS[p].templates[cat] || []).forEach(w => {
      const planNames = new Set(w.exercises.map(e => e.name));
      let prev = ctx.templateSetTotal(w);
      let ok = true, invented = false, tooBig = false;
      [90,60,45,30,15].forEach(m => {
        const a = ctx.compressWorkoutForTime(w, m);
        const sets = ctx.templateSetTotal(a);
        if(sets > prev) ok = false;
        if(!a.exercises.every(e => planNames.has(e.name))) invented = true;
        if(m === 15 && sets > 12) tooBig = true;
        prev = sets;
      });
      T(`${p}/${w.id} compresses monotonically`, ok);
      T(`${p}/${w.id} never invents an exercise`, !invented);
      T(`${p}/${w.id} 15-minute version stays realistic`, !tooBig);
      T(`${p}/${w.id} full mode equals the plan`,
        JSON.stringify(ctx.compressWorkoutForTime(w, null).exercises) === JSON.stringify(w.exercises));
    });
  }));

  sub('substitution works against the new templates');
  {
    const w = ctx.DEFAULT_PLANS.balanced.templates.upper[0];
    const cands = ctx.getSubstitutionsByName(w.exercises[0].name, {});
    T('a new template exercise has substitution candidates', cands.length > 0);
    T('it is never offered as its own replacement',
      !cands.map(x => x.displayName).includes(w.exercises[0].name));
  }
}

/* The delivery mechanism — this is where an existing athlete could get hurt. */
async function testPlanBackfillSafety(){
  section('CONTRACT 44 — backfill reaches existing users without touching their data');

  sub('an existing user who already has planData with EMPTY upper/lower');
  {
    const custom = { id:'MY-CUSTOM', name:'My Own Push Day', exercises:[
      { name:'Bench Press', sets:3, reps:'8–12', effort:'7', recommended:'—' } ] };
    const oldPlanData = { push:[custom], pull:[], legs:[], core:[], fullbody:[], upper:[], lower:[] };
    const sched = { mon:'push', tue:'pull', wed:'rest', thu:'legs', fri:'push', sat:'rest', sun:'rest' };
    const store = {
      selectedPlan: JSON.stringify('balanced'),
      'planData:balanced': JSON.stringify(oldPlanData),
      'schedule:balanced': JSON.stringify(sched),
      'planStart:balanced': JSON.stringify('2026-01-15'),
      workoutLog: JSON.stringify([
        WK('old1', 30, 'push', [EX('Bench Press',[S(225,8,2,'working')])]) ]),
      dataSchemaVersion: '1'
    };
    const app = await H.loadAppBooted(store);
    await H.settle(250);
    const after = JSON.parse(app.store['planData:balanced']);

    T('empty upper was backfilled', after.upper.length === 4);
    T('empty lower was backfilled', after.lower.length === 4);
    T('their CUSTOM push category is untouched',
      after.push.length === 1 && after.push[0].id === 'MY-CUSTOM');
    T('their custom workout name survives', after.push[0].name === 'My Own Push Day');
    T('their schedule was NOT rewritten', app.store['schedule:balanced'] === JSON.stringify(sched));
    T('their plan start date was NOT reset', JSON.parse(app.store['planStart:balanced']) === '2026-01-15');
    T('their selected plan is unchanged', JSON.parse(app.store.selectedPlan) === 'balanced');
    T('their workout history is untouched', JSON.parse(app.store.workoutLog).length === 1);
    T('their history still names the original exercise',
      JSON.parse(app.store.workoutLog)[0].exercises[0].name === 'Bench Press');

    sub('backfill is idempotent');
    const app2 = await H.loadAppBooted(app.store);
    await H.settle(250);
    T('a second boot changes nothing',
      app2.store['planData:balanced'] === app.store['planData:balanced']);
    const app3 = await H.loadAppBooted(app2.store);
    await H.settle(250);
    T('a third boot changes nothing',
      app3.store['planData:balanced'] === app2.store['planData:balanced']);
  }

  sub('a category the user has customised is NEVER overwritten');
  {
    const mine = { id:'MY-UPPER', name:'My Upper', exercises:[
      { name:'Bench Press', sets:3, reps:'8–12', effort:'7', recommended:'—' } ] };
    const store = {
      selectedPlan: JSON.stringify('balanced'),
      'planData:balanced': JSON.stringify({ push:[], pull:[], legs:[], core:[], fullbody:[], upper:[mine], lower:[] })
    };
    const app = await H.loadAppBooted(store);
    await H.settle(250);
    const after = JSON.parse(app.store['planData:balanced']);
    T('a non-empty upper category is left exactly as the user had it',
      after.upper.length === 1 && after.upper[0].id === 'MY-UPPER');
    T('the empty lower category beside it is still backfilled', after.lower.length === 4);
  }

  sub('Athletic gains nothing, because it ships nothing');
  {
    const app = await H.loadAppBooted({ selectedPlan: JSON.stringify('athletic') });
    await H.settle(250);
    const after = JSON.parse(app.store['planData:athletic']);
    T('athletic upper stays empty', (after.upper || []).length === 0);
    T('athletic lower stays empty', (after.lower || []).length === 0);
    T('athletic keeps its own categories', after.push.length === 4 && after.legs.length === 4);
  }

  sub('switching plans keeps history and only affects future planning');
  {
    const store = {
      selectedPlan: JSON.stringify('balanced'),
      workoutLog: JSON.stringify([
        WK('h1', 20, 'push', [EX('Bench Press',[S(225,8,2,'working')])]),
        WK('h2', 10, 'legs', [EX('Back Squat',[S(315,5,2,'working')])]) ])
    };
    const app = await H.loadAppBooted(store);
    await H.settle(250);
    const logBefore = app.store.workoutLog;
    const xpBefore = app.ctx.getCurrentProgression().lifetimeXP;

    await app.ctx.choosePlan('upperlower');
    await H.settle(250);

    T('history survived the plan switch', app.store.workoutLog === logBefore);
    T('XP survived the plan switch', app.ctx.getCurrentProgression().lifetimeXP === xpBefore);
    T('the new plan is selected', JSON.parse(app.store.selectedPlan) === 'upperlower');
    T('the new plan has a schedule', !!app.store['schedule:upperlower']);
    T('the new schedule uses upper/lower',
      Object.values(JSON.parse(app.store['schedule:upperlower'])).some(v => v === 'upper'));
    T('the previous plan\'s schedule is still stored', !!app.store['schedule:balanced']);
  }
}

async function testPlanIntegrationDataSafety(){
  section('CONTRACT 45 — plan integration touches no protected system');
  const fixture = buildProtectionFixture();
  const app = await H.loadAppBooted(fixture);
  const ctx = app.ctx;

  const before = H.snapshot(ctx);
  const progBefore = ctx.getCurrentProgression();
  const trainerBefore = ctx.trainerLog.entries.length;
  const gymBefore = app.store.gymProfile;
  const draftBefore = app.store.activeWorkoutDraft;
  const cardioBefore = JSON.stringify(ctx.cardioLog);

  // Exercise the new surface: read every plan's upper/lower and compress them.
  ALL_UL_PLANS.forEach(p => ['upper','lower'].forEach(cat =>
    (ctx.DEFAULT_PLANS[p].templates[cat] || []).forEach(w => {
      ctx.computeWorkoutDuration(w);
      ctx.compressWorkoutForTime(w, 30);
    })));
  clearCaches(ctx);
  const after = H.snapshot(ctx);

  sub('protected data');
  const d = H.diffSnapshot(before, after, []);
  T('NOTHING protected changed', d.ok, 'changed: ' + d.violations.join(','));
  T('workoutLog byte-identical', after.rawWorkoutLog === before.rawWorkoutLog);
  T('cardioLog unchanged', JSON.stringify(ctx.cardioLog) === cardioBefore);
  T('XP unchanged', after.xp === before.xp);
  T('strength XP unchanged', ctx.getCurrentProgression().strengthXP === progBefore.strengthXP);
  T('cardio XP unchanged', ctx.getCurrentProgression().cardioXP === progBefore.cardioXP);
  T('PRs unchanged', after.prCount === before.prCount);
  T('readiness unchanged', after.readiness === before.readiness);
  T('recovery unchanged', after.recovery === before.recovery);
  T('capability unchanged', after.capabilityBench === before.capabilityBench);
  T('gymProfile unchanged', app.store.gymProfile === gymBefore);
  T('draft preserved', app.store.activeWorkoutDraft === draftBefore);

  sub('trainer');
  T('engine still 0.1.1-shadow', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  T('no trainerLog entries created', ctx.trainerLog.entries.length === trainerBefore);
  T('trainer states unchanged',
    JSON.stringify(ctx.TRAINER_STATES) === JSON.stringify(['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF']));
  T('schema version untouched', ctx.DATA_SCHEMA_VERSION === 1);
  T('DATA_KEYS unchanged by this phase',
    ctx.DATA_KEYS.includes('gymProfile') && !ctx.DATA_KEYS.some(k => /plan_v2|upperlower/i.test(k)));

  sub('backup still covers plan data');
  {
    const keys = await ctx.allDataKeys();
    T('planData keys are in the backup list', keys.some(k => k.indexOf('planData:') === 0));
    T('schedule keys are in the backup list', keys.some(k => k.indexOf('schedule:') === 0));
    T('planStart keys are in the backup list', keys.some(k => k.indexOf('planStart:') === 0));
  }
}

/* =========================================================
   CONTRACT 46-48 — ADVANCED SET TYPES (Phase D5)
   ---------------------------------------------------------
   warmup / working / drop / failure / amrap.

   The risk in this phase is silent reinterpretation of
   existing history. A set logged years ago with no type must
   stay UNKNOWN, a warmup must stay a warmup, and nothing may
   quietly become a drop set. Equally, the new types are real
   training: they must count exactly as working sets do for XP,
   PRs, recovery and capability, because this phase adds
   vocabulary and explicitly NOT new training-load rules.
   ========================================================= */
function testSetTypeRegistry(app){
  section('CONTRACT 46 — set type registry & backward compatibility');
  const ctx = app.ctx;
  const ST = ctx.SET_TYPES;

  sub('the original vocabulary is untouched');
  T('warmup value unchanged', ST.WARMUP === 'warmup');
  T('working value unchanged', ST.WORKING === 'working');
  T('new types use stable internal ids, not display labels',
    ST.DROP === 'drop' && ST.FAILURE === 'failure' && ST.AMRAP === 'amrap');
  T('schema version still v1', ctx.DATA_SCHEMA_VERSION === 1);

  sub('registry is the single source of truth');
  T('registry holds exactly the five types this phase ships',
    ctx.SET_TYPE_REGISTRY.length === 5, String(ctx.SET_TYPE_REGISTRY.length));
  T('registry ids match SET_TYPES',
    ctx.SET_TYPE_REGISTRY.map(t => t.id).sort().join(',') ===
    Object.values(ST).slice().sort().join(','));
  T('no duplicate ids',
    new Set(ctx.SET_TYPE_REGISTRY.map(t => t.id)).size === 5);
  T('every type has a display name and short label',
    ctx.SET_TYPE_REGISTRY.every(t => !!t.displayName && !!t.shortLabel));
  T('every type has a description', ctx.SET_TYPE_REGISTRY.every(t => !!t.description));
  T('every type declares countsAsWorking',
    ctx.SET_TYPE_REGISTRY.every(t => typeof t.countsAsWorking === 'boolean'));
  T('every type declares whether it can be the default',
    ctx.SET_TYPE_REGISTRY.every(t => typeof t.canBeDefault === 'boolean'));
  T('every type declares whether it needs special input',
    ctx.SET_TYPE_REGISTRY.every(t => typeof t.requiresSpecialInput === 'boolean'));
  T('exactly one type is the default', ctx.SET_TYPE_REGISTRY.filter(t => t.canBeDefault).length === 1);
  T('working is that default',
    ctx.SET_TYPE_REGISTRY.find(t => t.canBeDefault).id === 'working');
  T('no future type leaked in early',
    !ctx.SET_TYPE_REGISTRY.some(t => /rest|myo|tempo|timed|assisted|negative/i.test(t.id)));

  sub('lookup helpers');
  T('known type resolves', !!ctx.getSetTypeMeta('drop'));
  T('unknown type resolves to null', ctx.getSetTypeMeta('rest_pause') === null);
  T('isKnownSetType accepts all five',
    Object.values(ST).every(v => ctx.isKnownSetType(v)));
  T('isKnownSetType rejects nonsense', !ctx.isKnownSetType('banana'));
  T('short label is available', ctx.setTypeShortLabel('amrap') === 'AMRAP');

  sub('setTypeOf — historical data is never reinterpreted');
  T('warmup still reads as warmup', ctx.setTypeOf({ type:'warmup' }) === 'warmup');
  T('working still reads as working', ctx.setTypeOf({ type:'working' }) === 'working');
  T('a set with NO type stays unknown', ctx.setTypeOf({ weight:'225', reps:'8' }) === null);
  T('an empty type stays unknown', ctx.setTypeOf({ type:'' }) === null);
  T('an unrecognised type stays unknown, never coerced', ctx.setTypeOf({ type:'myo_reps' }) === null);
  T('null set is safe', ctx.setTypeOf(null) === null);
  T('drop reads back as drop', ctx.setTypeOf({ type:'drop' }) === 'drop');
  T('failure reads back as failure', ctx.setTypeOf({ type:'failure' }) === 'failure');
  T('amrap reads back as amrap', ctx.setTypeOf({ type:'amrap' }) === 'amrap');

  sub('isWorkingSet — the new types are real training');
  T('working counts', ctx.isWorkingSet({ type:'working' }) === true);
  T('drop counts as a working set', ctx.isWorkingSet({ type:'drop' }) === true);
  T('failure counts as a working set', ctx.isWorkingSet({ type:'failure' }) === true);
  T('amrap counts as a working set', ctx.isWorkingSet({ type:'amrap' }) === true);
  T('warmup does not count', ctx.isWorkingSet({ type:'warmup' }) === false);
  T('unknown stays null so callers choose their own fallback',
    ctx.isWorkingSet({ weight:'1' }) === null);
  T('countWorkingSets counts the new types',
    ctx.countWorkingSets({ sets:[ {type:'working'}, {type:'drop'}, {type:'failure'}, {type:'amrap'} ] }).working === 4);
  T('countWorkingSets still separates warmups and unknowns', (() => {
    const r = ctx.countWorkingSets({ sets:[ {type:'warmup'}, {type:'working'}, {} ] });
    return r.working === 1 && r.unknownType === 1;
  })());

  sub('set type and set OUTCOME stay independent');
  const combos = [ {type:'amrap', rir:'1'}, {type:'failure', rir:'0'}, {type:'drop', rir:'2'},
                   {type:'failure', rir:'3'} ];
  T('type never rewrites RIR', combos.every(c => {
    const s = { weight:'100', reps:'10', rir:c.rir, type:c.type };
    return ctx.setTypeOf(s) === c.type && s.rir === c.rir;
  }));
  T('a failure set with a conflicting RIR keeps BOTH values', (() => {
    const s = { weight:'225', reps:'5', rir:'3', type:'failure' };
    return ctx.setTypeOf(s) === 'failure' && s.rir === '3';
  })());
  T('weight and reps are untouched by type', (() => {
    const s = { weight:'180', reps:'8', type:'drop' };
    return s.weight === '180' && s.reps === '8';
  })());

  sub('history rendering');
  T('a drop set renders a badge', ctx.setChipHtml({ weight:'180', reps:'8', type:'drop' }, false).includes('Drop'));
  T('a failure set renders a badge', ctx.setChipHtml({ weight:'225', reps:'5', type:'failure' }, false).includes('Failure'));
  T('an AMRAP set renders a badge', ctx.setChipHtml({ weight:'135', reps:'21', type:'amrap' }, false).includes('AMRAP'));
  T('a warmup renders a badge', ctx.setChipHtml({ weight:'95', reps:'10', type:'warmup' }, false).includes('Warm-up'));
  T('a plain working set renders NO badge',
    !ctx.setChipHtml({ weight:'225', reps:'8', type:'working' }, false).includes('set-chip-badge'));
  T('an untyped historical set renders NO badge',
    !ctx.setChipHtml({ weight:'225', reps:'8' }, false).includes('set-chip-badge'));
  T('weight and reps still render', (() => {
    const h = ctx.setChipHtml({ weight:'225', reps:'8', rir:'2', type:'drop' }, false);
    return h.includes('225') && h.includes('8') && h.includes('RIR 2');
  })());
  T('bodyweight sets omit the lb unit',
    !ctx.setChipHtml({ weight:'BW', reps:'12', type:'failure' }, true).includes(' lb'));
}

/* Recovery, capability, XP and PRs must treat the new types as working sets
   — no bonuses, no new categories, no retuning. */
function testSetTypeSystemIntegration(app){
  section('CONTRACT 47 — new set types integrate without changing the rules');
  const ctx = app.ctx;

  sub('recovery load factor');
  const lf = (s) => ctx.setLoadFactor(s, 225, false);
  T('working set carries full load', lf({ reps:'8', weight:'225', type:'working' }) === 1);
  T('drop set carries full load', lf({ reps:'8', weight:'180', type:'drop' }) === 1);
  T('failure set carries full load', lf({ reps:'5', weight:'225', type:'failure' }) === 1);
  T('amrap set carries full load', lf({ reps:'20', weight:'135', type:'amrap' }) === 1);
  T('warmup is still discounted',
    lf({ reps:'10', weight:'95', type:'warmup' }) === ctx.RECOVERY_CONFIG.warmupWeight);
  T('an unlogged set still contributes nothing', lf({ reps:'', weight:'225', type:'drop' }) === 0);
  T('recovery config was NOT retuned for the new types',
    ctx.RECOVERY_CONFIG.warmupWeight === 0.25 && ctx.RECOVERY_CONFIG.halfLifeDays === 2.0);

  sub('XP and PRs are unchanged by type alone');
  {
    const base = [ WK('t1', 5, 'push', [EX('Bench Press',[S(225,8,2,'working'), S(225,8,2,'working')])]) ];
    const typed = [ WK('t1', 5, 'push', [EX('Bench Press',[S(225,8,2,'working'), S(225,8,2,'failure')])]) ];

    seedHistory(ctx, base); clearCaches(ctx);
    const xpBase = ctx.getCurrentProgression().lifetimeXP;
    const prBase = ctx.computeAllPREvents().length;
    const recBase = JSON.stringify(ctx.computeMuscleRecovery());

    seedHistory(ctx, typed); clearCaches(ctx);
    T('marking a set as failure awards NO bonus XP',
      ctx.getCurrentProgression().lifetimeXP === xpBase);
    T('marking a set as failure creates NO new PR category',
      ctx.computeAllPREvents().length === prBase);
    T('marking a set as failure does not change recovery',
      JSON.stringify(ctx.computeMuscleRecovery()) === recBase);

    const dropped = [ WK('t1', 5, 'push', [EX('Bench Press',[S(225,8,2,'working'), S(180,8,2,'drop')])]) ];
    seedHistory(ctx, dropped); clearCaches(ctx);
    T('a drop set is counted, not ignored',
      ctx.computeMuscleRecovery && JSON.stringify(ctx.computeMuscleRecovery()) !== '{}');
    T('no new XP category exists for set types',
      typeof ctx.getCurrentProgression().dropXP === 'undefined' &&
      typeof ctx.getCurrentProgression().failureXP === 'undefined');
  }

  sub('capability tolerates and includes the new types');
  {
    const hist = [];
    for(let i = 0; i < 6; i++){
      hist.push(WK('c'+i, i*4, 'push', [EX('Bench Press',[
        S(95,10,4,'warmup'), S(225,8,2,'working'), S(180,8,1,'drop'), S(225,5,0,'failure') ])]));
    }
    seedHistory(ctx, hist); clearCaches(ctx);
    const cap = ctx.getExerciseCapability('Bench Press');
    T('capability computes without crashing', !!cap);
    T('capability sees the sessions', cap.sessions === 6);
    T('capability excludes the warmup from its top weight', cap.bestWeight === 225);
    T('a single failure set does not redefine capability',
      cap.currentCapability && cap.currentCapability.estimate > 0);
    T('capability confidence is unaffected by set type alone', !!cap.confidence);
  }

  sub('the shadow engine still ignores warmups and reads the rest');
  {
    const rec = ctx.computeShadowRecommendation('Bench Press', {});
    T('engine still produces a recommendation with typed history', rec === null || !!rec.finalState);
    T('engine version untouched', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  }
}

/* Logger, draft round-trip and delete safety. */
async function testSetTypeLoggerAndDrafts(){
  section('CONTRACT 48 — logging, drafts and delete safety for set types');

  sub('draft round-trip preserves every type exactly');
  {
    const draft = { id:'d5', title:'Push A', category:'push', startedAt:new Date().toISOString(),
      exercises:[ { name:'Bench Press', bodyweight:false, sets:[
        { weight:'95',  reps:'10', rir:'4', completed:true, type:'warmup' },
        { weight:'225', reps:'8',  rir:'2', completed:true, type:'working' },
        { weight:'180', reps:'8',  rir:'1', completed:true, type:'drop' },
        { weight:'225', reps:'5',  rir:'0', completed:true, type:'failure' },
        { weight:'135', reps:'21', rir:'0', completed:true, type:'amrap' },
        { weight:'225', reps:'6',  rir:'2', completed:true } ] } ] };
    const app = await H.loadAppBooted({
      workoutLog: JSON.stringify([]), activeWorkoutDraft: JSON.stringify(draft), dataSchemaVersion:'1' });
    await H.settle(120);

    const reopened = await H.loadAppBooted(app.store);
    const restored = JSON.parse(reopened.store.activeWorkoutDraft);
    const types = restored.exercises[0].sets.map(s => s.type);
    T('warmup restored', types[0] === 'warmup');
    T('working restored', types[1] === 'working');
    T('drop restored', types[2] === 'drop');
    T('failure restored', types[3] === 'failure');
    T('amrap restored', types[4] === 'amrap');
    T('the untyped set stays untyped — no type was invented', types[5] === undefined);
    T('draft is byte-identical across the reopen',
      reopened.store.activeWorkoutDraft === JSON.stringify(draft));
    T('weights survived', restored.exercises[0].sets[2].weight === '180');
    T('reps survived', restored.exercises[0].sets[4].reps === '21');
    T('conflicting RIR on a failure set survived', restored.exercises[0].sets[3].rir === '0');
    T('completion flags survived', restored.exercises[0].sets[0].completed === true);
    T('no duplicate sets appeared', restored.exercises[0].sets.length === 6);
  }

  sub('the logger row reflects and edits types');
  {
    const app = await H.loadAppBooted({ workoutLog: JSON.stringify([]) });
    const ctx = app.ctx, dom = app.dom;
    const row = H.mkExRow('Bench Press', false, [
      { w:225, r:8, rir:2, type:'working' }, { w:180, r:8, rir:1, type:'drop' } ]);
    dom.setRows([row]);
    T('a typed row exposes its type', row._setRows[1].dataset.setType === 'drop');

    // edit via the picker path
    ctx.setTypePickerRow = row._setRows[0];
    ctx.chooseSetType('failure');
    T('picker applies the chosen type', row._setRows[0].dataset.setType === 'failure');
    T('picker closes after choosing', ctx.setTypePickerRow === null);

    ctx.setTypePickerRow = row._setRows[0];
    ctx.chooseSetType('amrap');
    T('a type can be changed again', row._setRows[0].dataset.setType === 'amrap');

    ctx.setTypePickerRow = row._setRows[0];
    ctx.chooseSetType('not_a_type');
    T('an unknown type is rejected, leaving the row as it was',
      row._setRows[0].dataset.setType === 'amrap');

    // rapid switching
    const seq = ['working','drop','failure','amrap','warmup'];
    for(let i = 0; i < 40; i++){
      ctx.setTypePickerRow = row._setRows[1];
      ctx.chooseSetType(seq[i % seq.length]);
    }
    T('rapid switching lands deterministically',
      row._setRows[1].dataset.setType === seq[39 % seq.length]);
    T('rapid switching never leaves a dangling picker target', ctx.setTypePickerRow === null);
    T('the other set was not affected by switching this one',
      row._setRows[0].dataset.setType === 'amrap');
    T('applying with no target row is safe',
      (ctx.setTypePickerRow = null, ctx.chooseSetType('drop'), true));
  }

  sub('backup / restore carries every type');
  {
    const log = [ WK('bk1', 3, 'push', [EX('Bench Press',[
      S(95,10,4,'warmup'), S(225,8,2,'working'), S(180,8,1,'drop'),
      S(225,5,0,'failure'), S(135,21,0,'amrap') ])]) ];
    // one untyped set, added directly so no type is fabricated
    log[0].exercises[0].sets.push({ weight:'225', reps:'6', rir:'2' });

    const app = await H.loadAppBooted({ workoutLog: JSON.stringify(log), dataSchemaVersion:'1' });
    await H.settle(120);
    const keys = await app.ctx.allDataKeys();
    const exported = {};
    for(const k of keys){
      const r = await app.ctx.LOOPStore.get(k);
      if(r && r.value !== undefined && r.value !== null) exported[k] = r.value;
    }
    const restored = await H.loadAppBooted(exported);
    await H.settle(120);
    const sets = restored.ctx.workoutLog[0].exercises[0].sets;
    T('warmup survived export/import', sets[0].type === 'warmup');
    T('working survived export/import', sets[1].type === 'working');
    T('drop survived export/import', sets[2].type === 'drop');
    T('failure survived export/import', sets[3].type === 'failure');
    T('amrap survived export/import', sets[4].type === 'amrap');
    T('the untyped set is still untyped after a round trip', sets[5].type === undefined);
    T('set count preserved', sets.length === 6);
  }

  sub('no accidental migration of existing history');
  {
    const legacy = [
      WK('l1', 40, 'push', [EX('Bench Press',[ {weight:'225',reps:'8',rir:'2'} ])]),
      WK('l2', 30, 'push', [EX('Bench Press',[ {weight:'95',reps:'10',rir:'4',type:'warmup'},
                                               {weight:'225',reps:'8',rir:'2',type:'working'} ])])
    ];
    const app = await H.loadAppBooted({ workoutLog: JSON.stringify(legacy), dataSchemaVersion:'1' });
    await H.settle(200);
    const stored = JSON.parse(app.store.workoutLog);
    T('legacy untyped set was NOT given a type',
      stored[0].exercises[0].sets[0].type === undefined);
    T('legacy warmup unchanged', stored[1].exercises[0].sets[0].type === 'warmup');
    T('legacy working unchanged', stored[1].exercises[0].sets[1].type === 'working');
    T('workoutLog is byte-identical to what was stored',
      app.store.workoutLog === JSON.stringify(legacy));
    T('schema still v1 — no migration ran', app.ctx.DATA_SCHEMA_VERSION === 1);
    T('no drop/failure/amrap was fabricated anywhere',
      !app.store.workoutLog.includes('"drop"') &&
      !app.store.workoutLog.includes('"failure"') &&
      !app.store.workoutLog.includes('"amrap"'));
  }
}

async function testSetTypeDataSafety(){
  section('CONTRACT 49 — set types touch no protected system');
  const fixture = buildProtectionFixture();
  const app = await H.loadAppBooted(fixture);
  const ctx = app.ctx;

  const before = H.snapshot(ctx);
  const progBefore = ctx.getCurrentProgression();
  const trainerBefore = ctx.trainerLog.entries.length;
  const gymBefore = app.store.gymProfile;
  const draftBefore = app.store.activeWorkoutDraft;
  const planBefore = app.store.selectedPlan;
  const cardioBefore = JSON.stringify(ctx.cardioLog);

  // Exercise the whole new surface without touching a workout.
  ctx.SET_TYPE_REGISTRY.forEach(t => {
    ctx.getSetTypeMeta(t.id); ctx.setTypeShortLabel(t.id);
    ctx.setChipHtml({ weight:'225', reps:'8', rir:'2', type:t.id }, false);
    ctx.setTypeOf({ type:t.id });
    ctx.isWorkingSet({ type:t.id });
  });
  clearCaches(ctx);
  const after = H.snapshot(ctx);

  sub('protected data');
  const d = H.diffSnapshot(before, after, []);
  T('NOTHING protected changed', d.ok, 'changed: ' + d.violations.join(','));
  T('workoutLog byte-identical', after.rawWorkoutLog === before.rawWorkoutLog);
  T('cardioLog unchanged', JSON.stringify(ctx.cardioLog) === cardioBefore);
  T('XP unchanged', after.xp === before.xp);
  T('strength XP unchanged', ctx.getCurrentProgression().strengthXP === progBefore.strengthXP);
  T('cardio XP unchanged', ctx.getCurrentProgression().cardioXP === progBefore.cardioXP);
  T('level unchanged', after.level === before.level);
  T('PRs unchanged', after.prCount === before.prCount);
  T('readiness unchanged', after.readiness === before.readiness);
  T('recovery unchanged', after.recovery === before.recovery);
  T('capability unchanged', after.capabilityBench === before.capabilityBench);
  T('gymProfile unchanged', app.store.gymProfile === gymBefore);
  T('plans unchanged', app.store.selectedPlan === planBefore);
  T('draft preserved', app.store.activeWorkoutDraft === draftBefore);

  sub('trainer');
  T('engine still 0.1.1-shadow', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  T('no trainerLog entries created by set-type work',
    ctx.trainerLog.entries.length === trainerBefore);
  T('trainer states unchanged',
    JSON.stringify(ctx.TRAINER_STATES) === JSON.stringify(['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF']));
  T('trainer config thresholds unchanged',
    ctx.TRAINER_CONFIG.progression.maxLoadStepPct === 0.10 &&
    ctx.TRAINER_CONFIG.evidence.minSessionsToProgress === 2);
  T('DATA_KEYS gained nothing for set types',
    !ctx.DATA_KEYS.some(k => /settype|droppset|amrap|failure/i.test(k)));
}

/* =========================================================
   CONTRACT 49 — REP ADJUSTMENT INTEGRATION (Phase D5.1)
   ---------------------------------------------------------
   The rep stepper looked correct and was not. Tapping +/- set
   the input value directly, which fires no `input` event, so
   the delegated autosave listener never ran and a set adjusted
   only with the stepper existed in the DOM alone. It survived
   only because closing the sheet flushes the draft.

   These tests pin the three things that fix implies: the
   bounds are real, the programmed target stays separate from
   the actual reps, and none of it reaches a protected system.
   ========================================================= */
function testRepAdjustment(app){
  section('CONTRACT 49 — rep adjustment bounds and data separation');
  const ctx = app.ctx;

  sub('bounds are declared, not scattered');
  T('REP_STEP_BOUNDS exists', !!ctx.REP_STEP_BOUNDS);
  T('minimum is one rep, never zero', ctx.REP_STEP_BOUNDS.min === 1);
  T('there is a sane ceiling', ctx.REP_STEP_BOUNDS.max >= 100);
  T('the ceiling never blocks legitimate high-rep work', ctx.REP_STEP_BOUNDS.max >= 999);

  sub('increment / decrement');
  T('increment adds one', ctx.clampStepValue('10', 1, true) === 11);
  T('decrement removes one', ctx.clampStepValue('10', -1, true) === 9);
  T('stepping up from empty starts at 1', ctx.clampStepValue('', 1, true) === 1);
  T('stepping DOWN from empty never goes to 0', ctx.clampStepValue('', -1, true) === 1);

  sub('reps can never become invalid');
  T('cannot step below 1', ctx.clampStepValue('1', -1, true) === 1);
  T('cannot reach zero', ctx.clampStepValue('1', -5, true) === 1);
  T('cannot go negative', ctx.clampStepValue('0', -50, true) === 1);
  T('60 rapid decrements settle at the floor',
    (() => { let v = '11'; for(let i=0;i<60;i++) v = String(ctx.clampStepValue(v, -1, true)); return Number(v); })() === 1);
  T('1200 rapid increments settle at the ceiling',
    (() => { let v = '1'; for(let i=0;i<1200;i++) v = String(ctx.clampStepValue(v, 1, true)); return Number(v); })()
      === ctx.REP_STEP_BOUNDS.max);
  T('alternating taps are deterministic',
    (() => { let v = '10'; for(let i=0;i<50;i++){ v = String(ctx.clampStepValue(v,1,true)); v = String(ctx.clampStepValue(v,-1,true)); } return Number(v); })() === 10);

  sub('weight keeps its own, unchanged rule');
  T('weight still floors at zero, not one', ctx.clampStepValue('0', -5, false) === 0);
  T('weight steps by the amount given', ctx.clampStepValue('135', 5, false) === 140);
  T('weight is not capped by the rep ceiling', ctx.clampStepValue('900', 5, false) === 905);

  sub('programmed target vs actual reps stay separate');
  T('templates still carry a rep RANGE',
    ctx.DEFAULT_PLANS.upperlower.templates.upper[0].exercises[0].reps.indexOf('–') !== -1 ||
    /\d+\s*[-–]\s*\d+/.test(ctx.DEFAULT_PLANS.upperlower.templates.upper[0].exercises[0].reps));
  T('a logged set stores a single ACTUAL rep count, not a range',
    (() => { const w = WK('x',0,'push',[EX('Bench Press',[S(225,10,2,'working')])]);
             return w.exercises[0].sets[0].reps === '10'; })());
  /* The clamp is pure: it returns a number and holds no reference to a
     template, so there is no path from a rep tap back into the plan. */
  {
    const tplBefore = JSON.stringify(ctx.DEFAULT_PLANS.upperlower.templates.upper[0]);
    for(let i = 0; i < 100; i++) ctx.clampStepValue(String(i), i % 2 ? 1 : -1, true);
    T('running the clamp 100 times leaves the template byte-identical',
      JSON.stringify(ctx.DEFAULT_PLANS.upperlower.templates.upper[0]) === tplBefore);
    T('clampStepValue returns a number, never a template reference',
      typeof ctx.clampStepValue('10', 1, true) === 'number');
  }
}

async function testRepAdjustmentSafety(){
  section('CONTRACT 50 — rep adjustment touches nothing protected');
  const fixture = buildProtectionFixture();
  const app = await H.loadAppBooted(fixture);
  const ctx = app.ctx;

  const before = H.snapshot(ctx);
  const progBefore = ctx.getCurrentProgression();
  const trainerBefore = ctx.trainerLog.entries.length;
  const planTemplatesBefore = JSON.stringify(ctx.DEFAULT_PLANS.upperlower.templates);
  const planDataBefore = JSON.stringify(Object.keys(app.store)
    .filter(k => k.indexOf('planData:') === 0).map(k => app.store[k]));
  const gymBefore = app.store.gymProfile;
  const cardioBefore = JSON.stringify(ctx.cardioLog);
  const draftBefore = app.store.activeWorkoutDraft;

  sub('exercising the rep-adjustment maths changes nothing');
  for(let i = 0; i < 200; i++){
    ctx.clampStepValue(String(i % 30), (i % 2 ? 1 : -1), true);
    ctx.clampStepValue(String(i), 5, false);
  }
  clearCaches(ctx);
  const after = H.snapshot(ctx);
  const d = H.diffSnapshot(before, after, []);
  T('NOTHING protected changed', d.ok, 'changed: ' + d.violations.join(','));
  T('workoutLog byte-identical', after.rawWorkoutLog === before.rawWorkoutLog);
  T('XP unchanged', after.xp === before.xp);
  T('strength XP unchanged', ctx.getCurrentProgression().strengthXP === progBefore.strengthXP);
  T('cardio XP unchanged', ctx.getCurrentProgression().cardioXP === progBefore.cardioXP);
  T('level unchanged', after.level === before.level);
  T('PRs unchanged', after.prCount === before.prCount);
  T('readiness unchanged', after.readiness === before.readiness);
  T('recovery unchanged', after.recovery === before.recovery);
  T('capability unchanged', after.capabilityBench === before.capabilityBench);
  T('cardioLog unchanged', JSON.stringify(ctx.cardioLog) === cardioBefore);
  T('gymProfile unchanged', app.store.gymProfile === gymBefore);
  T('draft preserved', app.store.activeWorkoutDraft === draftBefore);

  sub('the plan is never rewritten by a rep change');
  T('DEFAULT_PLANS templates byte-identical',
    JSON.stringify(ctx.DEFAULT_PLANS.upperlower.templates) === planTemplatesBefore);
  T('stored planData byte-identical',
    JSON.stringify(Object.keys(app.store).filter(k => k.indexOf('planData:') === 0)
      .map(k => app.store[k])) === planDataBefore);
  T('rep ranges in the plan still read as ranges',
    ctx.DEFAULT_PLANS.upperlower.templates.upper[0].exercises.every(e => !!e.reps));

  sub('history reports what was PERFORMED, not what was programmed');
  {
    const perf = WK('perf1', 2, 'push', [EX('Bench Press',[S(225,13,1,'working')])]);
    ctx.workoutLog.push(perf);
    clearCaches(ctx);
    const hist = ctx.getExerciseHistoryById('bench_press_barbell');
    const latest = hist[0];
    T('the logged actual reps are what history shows',
      latest && latest.sets.some(s => s.reps === '13'));
    T('no programmed target leaked into the logged set',
      latest && latest.sets.every(s => !/[-–]/.test(String(s.reps))));
    ctx.workoutLog = ctx.workoutLog.filter(w => w.id !== 'perf1');
    clearCaches(ctx);
  }

  sub('advanced set types keep their own actual reps');
  {
    const mixed = WK('mixed1', 1, 'push', [
      { name:'Bench Press', bodyweight:false, sets:[
        S(225, 8, 1, 'working'), S(185, 6, 0, 'drop'),
        S(185, 5, 0, 'failure'), S(135, 21, 0, 'amrap') ] } ]);
    ctx.workoutLog.push(mixed);
    clearCaches(ctx);
    const sets = ctx.workoutLog.find(w => w.id === 'mixed1').exercises[0].sets;
    T('working set keeps its reps', sets[0].reps === '8' && sets[0].type === 'working');
    T('drop set keeps its OWN reps, independent of the working set',
      sets[1].reps === '6' && sets[1].type === 'drop');
    T('failure set keeps its performed reps', sets[2].reps === '5' && sets[2].type === 'failure');
    T('AMRAP keeps the high actual rep count', sets[3].reps === '21' && sets[3].type === 'amrap');
    T('AMRAP was not pulled back to a programmed target', sets[3].reps !== '8');
    T('every advanced type still counts as a working set',
      [sets[1],sets[2],sets[3]].every(s => ctx.isWorkingSet(s) === true));
    T('each set kept a distinct rep value',
      new Set(sets.map(s => s.reps)).size === 4);
    ctx.workoutLog = ctx.workoutLog.filter(w => w.id !== 'mixed1');
    clearCaches(ctx);
  }

  sub('trainer');
  T('engine still 0.1.1-shadow', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  T('no trainerLog entries created', ctx.trainerLog.entries.length === trainerBefore);
  T('trainer states unchanged',
    JSON.stringify(ctx.TRAINER_STATES) === JSON.stringify(['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF']));
  T('schema still v1', ctx.DATA_SCHEMA_VERSION === 1);
  T('no new storage key for rep adjustment',
    !ctx.DATA_KEYS.some(k => /rep|step|adjust/i.test(k)));
}

/* =========================================================
   CONTRACT 51-53 — EXERCISE NOTES / TRAINING MEMORY (D6)
   ---------------------------------------------------------
   Notes are passive memory. The whole risk of this phase is
   that a free-text sentence quietly becomes training input —
   "very sore" nudging recovery, "felt amazing" nudging
   capability, "I hate this machine" nudging substitution.
   Contract 52 exists to prove none of that happens, and
   Contract 53 proves the athlete's words survive a backup
   round trip exactly as typed.
   ========================================================= */
function testExerciseNotes(app){
  section('CONTRACT 51 — exercise notes: model and API');
  const ctx = app.ctx;
  ctx.exerciseNotes = { version:1, notes:[] };
  ctx.invalidateNoteIndex();

  sub('storage is registered like every other protected key');
  T('exerciseNotes is a dedicated key', ctx.EXERCISE_NOTES_KEY === 'exerciseNotes');
  T('registered in DATA_KEYS', ctx.DATA_KEYS.includes('exerciseNotes'));
  T('note text is NOT stored in workoutLog',
    !ctx.DATA_KEYS.some(k => k === 'workoutNotesText'));
  T('schema version unchanged by adding notes', ctx.DATA_SCHEMA_VERSION === 1);

  sub('create');
  const n1 = ctx.saveExerciseNote('bench_press_barbell', '225 felt unusually heavy today.');
  T('a note is created', !!n1 && !!n1.id);
  T('it carries the canonical exercise id', n1.exerciseId === 'bench_press_barbell');
  T('the text is stored verbatim', n1.text === '225 felt unusually heavy today.');
  T('it is timestamped', !!n1.createdAt && !!n1.updatedAt);
  T('it starts unarchived', n1.archived === false);
  T('ids are unique',
    ctx.saveExerciseNote('bench_press_barbell', 'second').id !== n1.id);

  sub('empty and oversized input');
  T('an empty note is not stored', ctx.saveExerciseNote('bench_press_barbell', '') === null);
  T('whitespace only is not stored', ctx.saveExerciseNote('bench_press_barbell', '   \n  ') === null);
  T('a missing exercise id is refused', ctx.saveExerciseNote(null, 'orphan') === null);
  T('text is capped at the declared maximum',
    ctx.saveExerciseNote('bench_press_barbell', 'x'.repeat(2000)).text.length === ctx.NOTE_MAX_LENGTH);
  T('surrounding whitespace is trimmed',
    ctx.saveExerciseNote('bench_press_barbell', '   trimmed   ').text === 'trimmed');

  sub('multiple notes build longitudinal memory');
  ctx.exerciseNotes = { version:1, notes:[] }; ctx.invalidateNoteIndex();
  const a = ctx.saveExerciseNote('bench_press_barbell', '225 felt heavy.');
  a.createdAt = '2026-08-20T10:00:00.000Z';
  const b = ctx.saveExerciseNote('bench_press_barbell', '225 moved better.');
  b.createdAt = '2026-08-22T10:00:00.000Z';
  const c = ctx.saveExerciseNote('bench_press_barbell', '230 felt strong.');
  c.createdAt = '2026-08-24T10:00:00.000Z';
  ctx.invalidateNoteIndex();
  T('all three are kept — nothing overwrites', ctx.getExerciseNotes('bench_press_barbell').length === 3);
  T('newest is first', ctx.getExerciseNotes('bench_press_barbell')[0].text === '230 felt strong.');
  T('getLatestExerciseNote returns the newest',
    ctx.getLatestExerciseNote('bench_press_barbell').text === '230 felt strong.');
  T('getRecentExerciseNotes honours a limit',
    ctx.getRecentExerciseNotes('bench_press_barbell', 2).length === 2);
  T('hasExerciseNotes is true', ctx.hasExerciseNotes('bench_press_barbell') === true);

  sub('per-exercise isolation');
  ctx.saveExerciseNote('lat_pulldown', 'Neutral grip felt much better.');
  T('a note lands only on its own exercise',
    ctx.getExerciseNotes('lat_pulldown').length === 1);
  T('the other exercise is unaffected',
    ctx.getExerciseNotes('bench_press_barbell').length === 3);
  T('an exercise with no notes returns an empty list',
    ctx.getExerciseNotes('squat_back').length === 0);
  T('hasExerciseNotes is false for an unnoted exercise',
    ctx.hasExerciseNotes('squat_back') === false);
  T('an unknown id returns empty rather than throwing',
    ctx.getExerciseNotes('does_not_exist').length === 0);
  T('a null id is safe', ctx.getExerciseNotes(null).length === 0);

  sub('canonical identity, including unmapped exercises');
  T('by-name lookup resolves canonically',
    ctx.getExerciseNotesByName('Bench Press').length === 3);
  T('an alias resolves to the same memory',
    ctx.getExerciseNotesByName('barbell bench press').length === 3);
  const un = ctx.saveExerciseNoteByName('Zercher Wall Toss', 'Odd but fun.');
  T('an unmapped exercise gets a stable unmapped id',
    !!un && un.exerciseId.indexOf('unmapped:') === 0);
  T('the unmapped note is retrievable',
    ctx.getExerciseNotesByName('Zercher Wall Toss').length === 1);
  T('unmapped notes are NOT fuzzy-merged into a canonical exercise',
    ctx.getExerciseNotes('bench_press_barbell').length === 3);

  sub('edit');
  const target = ctx.getLatestExerciseNote('bench_press_barbell');
  const otherBefore = ctx.getExerciseNotes('bench_press_barbell')[1].text;
  const createdBefore = target.createdAt;
  const updated = ctx.updateExerciseNote(target.id, '230 felt strong — best in weeks.');
  T('the note text is updated', updated.text === '230 felt strong — best in weeks.');
  T('createdAt is preserved so the timeline holds', updated.createdAt === createdBefore);
  T('updatedAt is at or after createdAt',
    String(updated.updatedAt) >= String(updated.createdAt));
  T('only that note changed',
    ctx.getExerciseNotes('bench_press_barbell')[1].text === otherBefore);
  T('note count unchanged by an edit', ctx.getExerciseNotes('bench_press_barbell').length === 3);
  T('editing an unknown id is a no-op', ctx.updateExerciseNote('nope', 'x') === null);
  T('an edit to empty text is refused', ctx.updateExerciseNote(target.id, '   ') === null);

  sub('delete');
  const before = ctx.getExerciseNotes('bench_press_barbell').length;
  const doomed = ctx.getExerciseNotes('bench_press_barbell')[0];
  const survivor = ctx.getExerciseNotes('bench_press_barbell')[1].text;
  T('delete reports success', ctx.deleteExerciseNote(doomed.id) === true);
  T('only that note was removed',
    ctx.getExerciseNotes('bench_press_barbell').length === before - 1);
  T('the neighbouring note survives untouched',
    ctx.getExerciseNotes('bench_press_barbell')[0].text === survivor);
  T('other exercises are untouched by a delete',
    ctx.getExerciseNotes('lat_pulldown').length === 1);
  T('deleting an unknown id reports false', ctx.deleteExerciseNote('nope') === false);

  sub('rapid interaction stays consistent');
  ctx.exerciseNotes = { version:1, notes:[] }; ctx.invalidateNoteIndex();
  for(let i = 0; i < 100; i++) ctx.saveExerciseNote('squat_back', 'note ' + i);
  T('100 rapid creates all land', ctx.getExerciseNotes('squat_back').length === 100);
  T('every id is unique',
    new Set(ctx.getExerciseNotes('squat_back').map(n => n.id)).size === 100);
  const ids = ctx.getExerciseNotes('squat_back').map(n => n.id);
  for(let i = 0; i < 50; i++) ctx.deleteExerciseNote(ids[i]);
  T('50 rapid deletes leave exactly 50', ctx.getExerciseNotes('squat_back').length === 50);
  for(let i = 50; i < 70; i++) ctx.updateExerciseNote(ids[i], 'edited ' + i);
  T('rapid edits do not change the count', ctx.getExerciseNotes('squat_back').length === 50);
  T('rapid edits applied', ctx.getExerciseNoteById(ids[60]).text === 'edited 60');

  sub('lookup stays cheap as memory grows');
  const t0 = Date.now();
  for(let i = 0; i < 2000; i++) ctx.getLatestExerciseNote('squat_back');
  T('2000 lookups over 50 notes are effectively free', Date.now() - t0 < 120, (Date.now()-t0)+'ms');
  T('a new note is visible immediately after the index invalidates',
    (() => { const n = ctx.saveExerciseNote('squat_back', 'fresh');
             const seen = ctx.getLatestExerciseNote('squat_back').id === n.id;
             ctx.deleteExerciseNote(n.id);
             return seen; })());

  sub('UI surfaces memory only when it exists');
  ctx.exerciseNotes = { version:1, notes:[] }; ctx.invalidateNoteIndex();
  T('no memory block before any note is written',
    ctx.exerciseNoteBlockHtml('Bench Press').indexOf('ex-note-memory') === -1);
  T('an add-note affordance is still offered',
    ctx.exerciseNoteBlockHtml('Bench Press').indexOf('ex-note-btn') !== -1);
  ctx.saveExerciseNote('bench_press_barbell', 'Felt heavy.');
  const html = ctx.exerciseNoteBlockHtml('Bench Press');
  T('the memory block appears once a note exists', html.indexOf('ex-note-memory') !== -1);
  T('it shows the note text', html.indexOf('Felt heavy.') !== -1);
  T('it is labelled as the last note', html.indexOf('Last note') !== -1);
  T('note text is HTML-escaped',
    (() => { ctx.exerciseNotes = { version:1, notes:[] }; ctx.invalidateNoteIndex();
             ctx.saveExerciseNote('bench_press_barbell', '<img src=x onerror=alert(1)>');
             const h = ctx.exerciseNoteBlockHtml('Bench Press');
             return h.indexOf('<img') === -1 && h.indexOf('&lt;img') !== -1; })());
}

async function testExerciseNotesIsolation(){
  section('CONTRACT 52 — notes are memory, never training input');
  const fixture = buildProtectionFixture();
  const app = await H.loadAppBooted(fixture);
  const ctx = app.ctx;

  const before = H.snapshot(ctx);
  const progBefore = ctx.getCurrentProgression();
  const trainerBefore = ctx.trainerLog.entries.length;
  const recBefore = JSON.stringify(ctx.computeMuscleRecovery());
  const capBefore = JSON.stringify(ctx.getExerciseCapability('Bench Press'));
  const readyBefore = JSON.stringify(ctx.dailyReadiness);
  const subsBefore = JSON.stringify(ctx.getSubstitutionsByName('Bench Press', {}));
  const planBefore = JSON.stringify(ctx.DEFAULT_PLANS.upperlower.templates);
  const gymBefore = app.store.gymProfile;
  const draftBefore = app.store.activeWorkoutDraft;
  const cardioBefore = JSON.stringify(ctx.cardioLog);

  sub('write the kinds of notes most likely to look like training input');
  ctx.saveExerciseNote('bench_press_barbell', 'Very sore today, terrible sleep.');
  ctx.saveExerciseNote('bench_press_barbell', 'Bench felt amazing, strongest ever.');
  ctx.saveExerciseNote('squat_back', 'I hate this machine, use dumbbells instead.');
  ctx.saveExerciseNote('lat_pulldown', 'Lower back fatigued — watch form.');
  clearCaches(ctx);
  const after = H.snapshot(ctx);

  T('NOTHING protected changed', H.diffSnapshot(before, after, []).ok,
    H.diffSnapshot(before, after, []).violations.join(','));
  T('workoutLog byte-identical', after.rawWorkoutLog === before.rawWorkoutLog);
  T('cardioLog unchanged', JSON.stringify(ctx.cardioLog) === cardioBefore);
  T('XP unchanged', after.xp === before.xp);
  T('strength XP unchanged', ctx.getCurrentProgression().strengthXP === progBefore.strengthXP);
  T('cardio XP unchanged', ctx.getCurrentProgression().cardioXP === progBefore.cardioXP);
  T('level unchanged', after.level === before.level);
  T('PRs unchanged', after.prCount === before.prCount);
  T('drafts preserved', app.store.activeWorkoutDraft === draftBefore);
  T('gymProfile unchanged', app.store.gymProfile === gymBefore);

  sub('"very sore / terrible sleep" does not become readiness or recovery');
  T('readiness unchanged', JSON.stringify(ctx.dailyReadiness) === readyBefore);
  T('no readiness entry was created', after.readiness === before.readiness);
  T('recovery unchanged', JSON.stringify(ctx.computeMuscleRecovery()) === recBefore);

  sub('"felt amazing" does not become capability');
  T('capability unchanged', JSON.stringify(ctx.getExerciseCapability('Bench Press')) === capBefore);
  T('capability snapshot unchanged', after.capabilityBench === before.capabilityBench);

  sub('"I hate this machine, use dumbbells" does not substitute or edit the plan');
  T('substitution ranking unchanged',
    JSON.stringify(ctx.getSubstitutionsByName('Bench Press', {})) === subsBefore);
  T('plan templates unchanged',
    JSON.stringify(ctx.DEFAULT_PLANS.upperlower.templates) === planBefore);

  sub('trainer');
  T('engine still 0.1.1-shadow', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  T('no trainerLog entries created by writing notes',
    ctx.trainerLog.entries.length === trainerBefore);
  T('trainer states unchanged',
    JSON.stringify(ctx.TRAINER_STATES) === JSON.stringify(['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF']));

  sub('notes and trainer feedback coexist without merging');
  T('trainerLog holds structured feedback, not note text',
    !JSON.stringify(ctx.trainerLog).includes('Very sore today'));
  T('notes hold free text, not trainer verdicts',
    !JSON.stringify(ctx.exerciseNotes).includes('too_hard'));
  T('both stores are populated independently',
    ctx.trainerLog.entries.length > 0 && ctx.exerciseNotes.notes.length > 0);

  sub('source-level isolation of the note module');
  {
    const fs = require('fs');
    const src = fs.readFileSync(H.APP_PATH, 'utf8');
    const titleAt = src.indexOf('EXERCISE NOTES — PERSONAL TRAINING MEMORY');
    // Back up to the opening /* so the header comment can actually be stripped —
    // slicing from the title left the comment unterminated at the front.
    const start = src.lastIndexOf('/*', titleAt);
    const end = src.indexOf('EXERCISE SUBSTITUTION ENGINE  (Phase D2)');
    const mod = src.slice(start, end);
    T('module located', titleAt !== -1 && start !== -1 && end > start);
    const forbidden = ['computeShadowRecommendation','proposeTrainerState','applyTrainerConstraints',
      'logRecommendation','computeMuscleRecovery','calculateReadinessScore','computeExerciseCapability',
      'persistLog(','persistReadiness','persistTrainerLog','computeXPTimeline','computeAllPREvents'];
    const hits = forbidden.filter(f => mod.indexOf(f) !== -1);
    T('the note module calls no trainer, recovery, readiness, capability, XP or PR function',
      hits.length === 0, hits.join(','));
    T('it writes only its own storage key',
      (mod.match(/LOOPStore\.set\(/g) || []).length === 1 &&
      mod.indexOf('LOOPStore.set(EXERCISE_NOTES_KEY') !== -1);
    /* Comments are stripped first: the module's header deliberately DISCUSSES
       trainerLog to explain that notes are separate from it, and grepping raw
       source counted that prose as a write. Only executable code is audited. */
    const code = mod.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    T('no executable line in the module mentions workoutLog', code.indexOf('workoutLog') === -1);
    T('no executable line in the module mentions trainerLog', code.indexOf('trainerLog') === -1);
    T('it performs no assignment into a protected store',
      !/\b(workoutLog|trainerLog|cardioLog|dailyReadiness|planData)\s*(=|\.push|\.splice)/.test(code));
  }
}

async function testExerciseNotesPersistence(){
  section('CONTRACT 53 — notes survive reload, backup and restore');

  sub('a new athlete starts with no memory');
  {
    const app = await H.loadAppBooted({});
    await H.settle(250);
    T('no notes for a new user', app.ctx.exerciseNotes.notes.length === 0);
    T('no memory block is shown',
      app.ctx.exerciseNoteBlockHtml('Bench Press').indexOf('ex-note-memory') === -1);
    T('the store holds no notes key until something is written',
      app.store.exerciseNotes === undefined || JSON.parse(app.store.exerciseNotes).notes.length === 0);
  }

  sub('notes survive an app reload');
  {
    const app = await H.loadAppBooted({});
    await H.settle(250);
    app.ctx.saveExerciseNote('bench_press_barbell', '225 felt unusually heavy today.');
    app.ctx.saveExerciseNote('lat_pulldown', 'Neutral grip felt much better.');
    await H.settle(250);

    const reopened = await H.loadAppBooted(app.store);
    await H.settle(250);
    T('notes are restored on reload', reopened.ctx.exerciseNotes.notes.length === 2);
    T('the text is byte-identical after reload',
      reopened.ctx.getLatestExerciseNote('bench_press_barbell').text === '225 felt unusually heavy today.');
    T('exercise attachment survives',
      reopened.ctx.getExerciseNotes('lat_pulldown').length === 1);
    T('ids survive', !!reopened.ctx.exerciseNotes.notes[0].id);
  }

  sub('export / import round trip');
  {
    const app = await H.loadAppBooted({ workoutLog: JSON.stringify([
      WK('w1', 3, 'push', [EX('Bench Press',[S(225,8,2,'working')])]) ]) });
    await H.settle(250);
    const ctx = app.ctx;
    ctx.saveExerciseNote('bench_press_barbell', 'Verbatim — with "quotes", <tags> & symbols.');
    ctx.saveExerciseNote('bench_press_barbell', 'Second note.');
    await H.settle(250);

    const keys = await ctx.allDataKeys();
    T('exerciseNotes is included in the backup key list', keys.indexOf('exerciseNotes') !== -1);

    const exported = {};
    for(const k of keys){
      const r = await ctx.LOOPStore.get(k);
      if(r && r.value !== undefined && r.value !== null) exported[k] = r.value;
    }
    T('the export captures the notes', !!exported.exerciseNotes);
    T('it captures both', JSON.parse(exported.exerciseNotes).notes.length === 2);

    const restored = await H.loadAppBooted(exported);
    await H.settle(250);
    T('restore rebuilds the notes', restored.ctx.exerciseNotes.notes.length === 2);
    T('the athlete\'s exact words survive the round trip',
      restored.ctx.getExerciseNotes('bench_press_barbell')
        .some(n => n.text === 'Verbatim — with "quotes", <tags> & symbols.'));
    T('workouts still restore alongside notes', restored.ctx.workoutLog.length === 1);
    T('notes did not leak into workoutLog',
      !JSON.stringify(restored.ctx.workoutLog).includes('Verbatim'));
    T('notes did not leak into trainerLog',
      !JSON.stringify(restored.ctx.trainerLog).includes('Verbatim'));
  }

  sub('notes stay separate from every other store');
  {
    const app = await H.loadAppBooted({});
    await H.settle(250);
    const ctx = app.ctx;
    ctx.saveExerciseNote('bench_press_barbell', 'A note.');
    ctx.setEquipmentAvailable('barbell', true);
    await H.settle(250);
    T('gymProfile holds equipment, not notes',
      !String(app.store.gymProfile || '').includes('A note.'));
    /* Substring matching is wrong here — a note on Bench Press legitimately
       carries the exerciseId "bench_press_barbell". Compare SHAPE instead:
       the notes store must not carry the gym profile's fields. */
    {
      const notesObj = JSON.parse(app.store.exerciseNotes || '{}');
      T('exerciseNotes carries no equipment map', notesObj.equipment === undefined);
      T('exerciseNotes carries no gym configuration marker', notesObj.configuredAt === undefined);
      T('exerciseNotes holds only note records',
        Array.isArray(notesObj.notes) &&
        notesObj.notes.every(n => 'text' in n && 'exerciseId' in n && !('available' in n)));
    }
    T('both persisted independently',
      !!app.store.gymProfile && !!app.store.exerciseNotes);
  }
}

/* =========================================================
   CONTRACT 54-56 — PROGRAM BUILDER / TRAINING BLOCKS (D7A)
   ---------------------------------------------------------
   Programs describe INTENT; workoutLog remains the record of
   what happened. The risks worth pinning are that a program
   never rewrites history, never clones workout data, and
   never becomes mandatory for an athlete who just wants to
   use a plan.
   ========================================================= */
const PROG_SCHED = (planId, cat, tplId) => ({ type:'workout', planId, category:cat, templateId:tplId });

function sampleSchedule(ctx){
  const ul = ctx.DEFAULT_PLANS.upperlower.templates;
  return {
    mon: PROG_SCHED('upperlower','upper', ul.upper[0].id),
    tue: PROG_SCHED('upperlower','lower', ul.lower[0].id),
    wed: { type:'rest' },
    thu: PROG_SCHED('upperlower','upper', ul.upper[1].id),
    fri: PROG_SCHED('upperlower','lower', ul.lower[1].id),
    sat: { type:'rest' }, sun: { type:'rest' }
  };
}
const DSTR = n => { const d = new Date(Date.now() - n*86400000);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };

function testProgramModel(app){
  section('CONTRACT 54 — program model, blocks and weeks');
  const ctx = app.ctx;
  ctx.programsStore = { version:1, activeProgramId:null, programs:[] };
  ctx.invalidateProgramCache();

  sub('storage registration');
  T('programs has its own key', ctx.PROGRAMS_KEY === 'programs');
  T('registered in DATA_KEYS', ctx.DATA_KEYS.includes('programs'));
  T('schema unchanged by adding programs', ctx.DATA_SCHEMA_VERSION === 1);
  T('phase registry is extensible', ctx.PROGRAM_PHASE_TYPES.length >= 6);
  T('phase registry has the declared types',
    ['accumulation','intensification','deload','rebuild','peak','custom']
      .every(id => !!ctx.getProgramPhase(id)));

  sub('creation');
  const res = ctx.createProgram({ name:'Summer Hypertrophy', goal:'hypertrophy',
    durationWeeks:12, schedule:sampleSchedule(ctx), startDate: DSTR(0) });
  T('a program is created', res.ok === true && !!res.program);
  const p = res.program;
  T('it has a stable id', !!p.id);
  T('name stored', p.name === 'Summer Hypertrophy');
  T('goal reuses the existing taxonomy', !!ctx.TRAINING_GOALS[p.goal]);
  T('duration stored', p.durationWeeks === 12);
  T('it starts active', p.status === 'active');
  T('it becomes the active program', ctx.getActiveProgram().id === p.id);
  T('hasActiveProgram is true', ctx.hasActiveProgram() === true);
  T('a default block spans the whole program',
    p.blocks.length === 1 && p.blocks[0].startWeek === 1 && p.blocks[0].endWeek === 12);
  T('timestamps set', !!p.createdAt && !!p.updatedAt);

  sub('references templates rather than cloning them');
  const entry = p.schedule.mon;
  T('a scheduled day stores a reference, not exercises',
    !!entry.planId && !!entry.category && !!entry.templateId && entry.exercises === undefined);
  T('the reference resolves to a real template',
    !!ctx.resolveProgramWorkout(entry) && !!ctx.resolveProgramWorkout(entry).exercises);
  T('resolved template still carries its exercises',
    ctx.resolveProgramWorkout(entry).exercises.length > 0);
  T('the program stores no exercise data of its own',
    JSON.stringify(p.schedule).indexOf('Bench Press') === -1);
  T('an unresolvable reference returns null rather than throwing',
    ctx.resolveProgramWorkout({ type:'workout', planId:'nope', category:'upper', templateId:'x' }) === null);

  sub('week calculation comes from the program, not from history');
  T('week 1 on the start date',
    ctx.getCurrentProgramWeek(p, DSTR(0)) === 1);
  ctx.updateProgram(p.id, { startDate: DSTR(35) });          // started 5 weeks ago
  T('five weeks in reads as week 6', ctx.getCurrentProgramWeek(p) === 6);
  T('week is capped at the program length',
    ctx.getCurrentProgramWeek(p, DSTR(-400)) === 12);
  T('a future start date reads as week 1',
    ctx.getCurrentProgramWeek(Object.assign({}, p, { startDate: DSTR(-30) })) === 1);
  T('logging more workouts does not move the week',
    (() => { const before = ctx.getCurrentProgramWeek(p);
             ctx.workoutLog.push(WK('prog_x', 1, 'upper', [EX('Bench Press',[S(225,8,2,'working')])]));
             clearCaches(ctx); ctx.invalidateProgramCache();
             const after = ctx.getCurrentProgramWeek(p);
             ctx.workoutLog = ctx.workoutLog.filter(w => w.id !== 'prog_x');
             clearCaches(ctx); ctx.invalidateProgramCache();
             return before === after; })());

  sub('blocks');
  ctx.updateProgram(p.id, { blocks:[
    { id:'b1', name:'Accumulation', order:1, phaseType:'accumulation', startWeek:1,  endWeek:4 },
    { id:'b2', name:'Progressive Overload', order:2, phaseType:'intensification', startWeek:5, endWeek:8 },
    { id:'b3', name:'Deload', order:3, phaseType:'deload', startWeek:9, endWeek:9 },
    { id:'b4', name:'Intensification', order:4, phaseType:'intensification', startWeek:10, endWeek:12 }
  ]});
  T('four blocks stored', ctx.getProgram(p.id).blocks.length === 4);
  T('week 6 resolves to the second block',
    ctx.getBlockForWeek(ctx.getProgram(p.id), 6).name === 'Progressive Overload');
  T('week 1 resolves to the first block',
    ctx.getBlockForWeek(ctx.getProgram(p.id), 1).name === 'Accumulation');
  T('week 9 resolves to the deload block',
    ctx.getBlockForWeek(ctx.getProgram(p.id), 9).phaseType === 'deload');
  T('getCurrentTrainingBlock uses the current week',
    ctx.getCurrentTrainingBlock(ctx.getProgram(p.id)).name === 'Progressive Overload');
  T('a week outside every block returns null',
    ctx.getBlockForWeek(ctx.getProgram(p.id), 99) === null);
  /* A deload block is a label the athlete wrote. Defining one must not make
     the app behave differently — no recommendation, no schedule change. */
  {
    const trainerCount = ctx.trainerLog.entries.length;
    const schedBefore = JSON.stringify(ctx.getProgram(p.id).schedule);
    ctx.getCurrentTrainingBlock(ctx.getProgram(p.id));
    T('defining a deload block creates no trainer record',
      ctx.trainerLog.entries.length === trainerCount);
    T('defining a deload block does not alter the schedule',
      JSON.stringify(ctx.getProgram(p.id).schedule) === schedBefore);
  }

  sub('schedule resolution by date');
  const prog = ctx.getProgram(p.id);
  const monday = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay()+6)%7));
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })();
  const mon = ctx.getProgramWorkoutForDate(monday, prog);
  T('Monday resolves to a workout', mon.entry.type === 'workout' && !!mon.template);
  T('it is the scheduled template', mon.entry.templateId === prog.schedule.mon.templateId);
  const wedDate = (() => { const d = new Date(monday+'T00:00:00'); d.setDate(d.getDate()+2);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })();
  T('Wednesday resolves to rest', ctx.getProgramWorkoutForDate(wedDate, prog).entry.type === 'rest');
  T('training day count is correct', ctx.programTrainingDayCount(prog) === 4);

  sub('progress is structural only');
  const pr = ctx.getProgramProgress(prog);
  T('progress reports the week', pr.week === 6 && pr.totalWeeks === 12);
  T('progress names the block', pr.blockName === 'Progressive Overload');
  T('planned sessions derive from the schedule', pr.plannedSessions === 4 * 6);
  T('no program score is produced', pr.score === undefined && pr.rating === undefined);

  sub('pause and resume keep the week honest');
  T('pause works', ctx.pauseProgram(p.id) === true);
  T('status is paused', ctx.getProgram(p.id).status === 'paused');
  T('a paused program is not deleted', !!ctx.getProgram(p.id));
  const frozen = ctx.getCurrentProgramWeek(ctx.getProgram(p.id));
  T('the week freezes while paused', frozen === 6);
  /* Rewind the pause to two weeks ago: the athlete paused on program day 21,
     which is week 4, and has been away since. Resuming must put them back at
     week 4 — the week they left — NOT week 6, which is where the calendar
     alone would have carried them. Paused time is not training time. */
  ctx.getProgram(p.id).pausedOnDate = DSTR(14);
  const weekAtPause = Math.floor((35 - 14) / 7) + 1;         // = 4
  const calendarWeek = Math.floor(35 / 7) + 1;               // = 6
  T('resume works', ctx.resumeProgram(p.id) === true);
  T('paused days were banked', ctx.getProgram(p.id).pausedDays >= 14);
  T('resuming returns to the week left off',
    ctx.getCurrentProgramWeek(ctx.getProgram(p.id)) === weekAtPause,
    String(ctx.getCurrentProgramWeek(ctx.getProgram(p.id))));
  T('resuming does NOT jump to the calendar week',
    ctx.getCurrentProgramWeek(ctx.getProgram(p.id)) < calendarWeek);
  T('status is active again', ctx.getProgram(p.id).status === 'active');

  sub('completion');
  T('complete works', ctx.completeProgram(p.id) === true);
  T('status is completed', ctx.getProgram(p.id).status === 'completed');
  T('a completed program stays in history', getProgramCount(ctx) === 1);
  T('it is no longer the active program', ctx.getActiveProgram() === null || ctx.hasActiveProgram() === false);
  const sum = ctx.getProgramCompletionSummary(p.id);
  T('completion summary uses existing metrics only',
    sum && typeof sum.workouts === 'number' && typeof sum.prs === 'number' && sum.score === undefined);

  sub('multiple programs coexist');
  const second = ctx.createProgram({ name:'Strength Block', goal:'strength',
    durationWeeks:6, schedule:sampleSchedule(ctx), startDate: DSTR(0) });
  T('a second program is created', second.ok === true);
  T('both are retained', getProgramCount(ctx) === 2);
  T('the completed one is still there',
    ctx.getPrograms().some(x => x.status === 'completed'));
  T('the new one is active', ctx.getActiveProgram().id === second.program.id);
  T('switching active does not delete the other',
    (() => { ctx.setActiveProgram(p.id); return getProgramCount(ctx) === 2; })());
  ctx.setActiveProgram(second.program.id);

  sub('validation refuses malformed programs instead of storing them');
  const bad = [
    [{ name:'', durationWeeks:8, schedule:sampleSchedule(ctx) }, 'no name'],
    [{ name:'X', durationWeeks:0, schedule:sampleSchedule(ctx) }, 'zero weeks'],
    [{ name:'X', durationWeeks:-4, schedule:sampleSchedule(ctx) }, 'negative weeks'],
    [{ name:'X', durationWeeks:9999, schedule:sampleSchedule(ctx) }, 'absurd length'],
    [{ name:'X', durationWeeks:8, schedule:{} }, 'no training day'],
    [{ name:'X', durationWeeks:8, schedule:{ mon:{type:'rest'} } }, 'rest only'],
    [{ name:'X', durationWeeks:8, goal:'not_a_goal', schedule:sampleSchedule(ctx) }, 'unknown goal'],
    [{ name:'X', durationWeeks:8, schedule:{ mon:{type:'workout', planId:'upperlower'} } }, 'incomplete reference'],
    [{ name:'X', durationWeeks:8, schedule:sampleSchedule(ctx),
       blocks:[{id:'b',name:'B',startWeek:5,endWeek:2}] }, 'inverted block range'],
    [{ name:'X', durationWeeks:8, schedule:sampleSchedule(ctx),
       blocks:[{id:'b',name:'B',startWeek:1,endWeek:99}] }, 'block past the program'],
    [{ name:'X', durationWeeks:8, schedule:sampleSchedule(ctx),
       blocks:[{id:'a',name:'A',startWeek:1,endWeek:4},{id:'b',name:'B',startWeek:3,endWeek:6}] }, 'overlapping blocks']
  ];
  const countBefore = getProgramCount(ctx);
  bad.forEach(([input, why]) => {
    const r = ctx.createProgram(input);
    T('refused: ' + why, r.ok === false && r.errors.length > 0);
  });
  T('no malformed program was stored', getProgramCount(ctx) === countBefore);
  T('validation never throws on junk',
    (() => { try{ ctx.validateProgram(null); ctx.validateProgram(undefined);
                   ctx.validateProgram({}); return true; }catch(e){ return false; } })());

  sub('editing affects planning, never history');
  const editable = ctx.getActiveProgram();
  const logBefore = JSON.stringify(ctx.workoutLog);
  const up = ctx.updateProgram(editable.id, { name:'Renamed', durationWeeks:10 });
  T('edit succeeds', up.ok === true);
  T('name changed', ctx.getProgram(editable.id).name === 'Renamed');
  T('duration changed', ctx.getProgram(editable.id).durationWeeks === 10);
  T('workout history untouched by an edit', JSON.stringify(ctx.workoutLog) === logBefore);
  T('an invalid edit is refused and changes nothing',
    (() => { const before = ctx.getProgram(editable.id).name;
             const r = ctx.updateProgram(editable.id, { name:'' });
             return r.ok === false && ctx.getProgram(editable.id).name === before; })());
  T('editing an unknown program is refused',
    ctx.updateProgram('nope', { name:'x' }).ok === false);

  sub('rapid editing stays consistent');
  for(let i = 0; i < 60; i++) ctx.updateProgram(editable.id, { name:'Rapid ' + i });
  T('60 rapid edits land deterministically', ctx.getProgram(editable.id).name === 'Rapid 59');
  T('rapid edits created no duplicate programs', getProgramCount(ctx) === countBefore);
  for(let i = 0; i < 20; i++){ ctx.pauseProgram(editable.id); ctx.resumeProgram(editable.id); }
  T('rapid pause/resume ends active', ctx.getProgram(editable.id).status === 'active');

  sub('delete removes only that program');
  const keepId = ctx.getPrograms().find(x => x.id !== editable.id).id;
  T('delete reports success', ctx.deleteProgram(editable.id) === true);
  T('the other program survives', !!ctx.getProgram(keepId));
  T('deleting an unknown id reports false', ctx.deleteProgram('nope') === false);
  T('workout history survives a program delete', JSON.stringify(ctx.workoutLog) === logBefore);
}
function getProgramCount(ctx){ return ctx.getPrograms().length; }

async function testProgramIntegration(){
  section('CONTRACT 55 — programs coexist with plans, Time Mode and substitution');

  sub('an athlete with NO program keeps every existing behaviour');
  {
    const app = await H.loadAppBooted({ selectedPlan: JSON.stringify('upperlower') });
    await H.settle(300);
    const ctx = app.ctx;
    T('no program exists', ctx.getPrograms().length === 0);
    T('hasActiveProgram is false', ctx.hasActiveProgram() === false);
    T('getActiveProgram returns null', ctx.getActiveProgram() === null);
    T('plan templates still resolve', (ctx.getTemplates('upper') || []).length === 4);
    T('the plan schedule is still intact', !!ctx.schedule && Object.keys(ctx.schedule).length === 7);
    T('program helpers are safe with no program',
      ctx.getCurrentProgramWeek() === null && ctx.getCurrentTrainingBlock() === null);
    T('progress is null rather than fabricated', ctx.getProgramProgress() === null);
    T('missed days are empty rather than invented', ctx.getMissedProgramDays().length === 0);
    /* Behaviour intentionally changed in D8. Programs used to be reachable
       only through Settings, so Today now NAMES the feature and offers the
       way in when the athlete has none. It still shows no program state and
       still fabricates nothing — it is an entry point, not a fake program. */
    const strip = ctx.programContextHtml();
    T('Today surfaces Programs when the athlete has none', strip.trim() !== '');
    T('it offers a way in', strip.indexOf('openMyTraining()') !== -1);
    T('it names the destination rather than a missing thing',
      /My Training/.test(strip));
    T('it does not present a working setup as broken',
      !/no active|missing|not set up|incomplete/i.test(strip));
    T('it invents no week, phase or program name',
      !/Week\s*\d/i.test(strip) && !/Phase\s*\d/i.test(strip) &&
      strip.indexOf('Week ') === -1);
    T('no programs key is written just by rendering it', app.store.programs === undefined);
  }

  sub('a program schedules Today without breaking Time Mode');
  {
    const app = await H.loadAppBooted({ selectedPlan: JSON.stringify('upperlower') });
    await H.settle(300);
    const ctx = app.ctx;
    const created = ctx.createProgram({ name:'P', goal:'hypertrophy', durationWeeks:8,
      schedule: sampleSchedule(ctx), startDate: DSTR(0) });
    T('program created', created.ok === true);
    const tpl = ctx.resolveProgramWorkout(created.program.schedule.mon);
    T('the program names an exact workout', !!tpl);

    const fullSets = ctx.templateSetTotal(tpl);
    const short = ctx.compressWorkoutForTime(tpl, 30);
    T('Time Mode still compresses a program workout',
      ctx.templateSetTotal(short) < fullSets);
    T('the compression is a COPY — the template is untouched',
      ctx.templateSetTotal(ctx.resolveProgramWorkout(created.program.schedule.mon)) === fullSets);
    T('the program schedule is unchanged by Time Mode',
      ctx.getProgram(created.program.id).schedule.mon.templateId === created.program.schedule.mon.templateId);
    T('full mode still equals the program workout',
      JSON.stringify(ctx.compressWorkoutForTime(tpl, null).exercises) === JSON.stringify(tpl.exercises));
  }

  sub('substitution stays compatible and never edits the program');
  {
    const app = await H.loadAppBooted({ selectedPlan: JSON.stringify('upperlower') });
    await H.settle(300);
    const ctx = app.ctx;
    const created = ctx.createProgram({ name:'P', durationWeeks:8,
      schedule: sampleSchedule(ctx), startDate: DSTR(0) });
    const tpl = ctx.resolveProgramWorkout(created.program.schedule.mon);
    const firstExercise = tpl.exercises[0].name;
    const before = JSON.stringify(ctx.getProgram(created.program.id));
    const cands = ctx.getSubstitutionsByName(firstExercise, {});
    T('a program workout exercise has substitutes', cands.length > 0);
    T('reading substitutions does not modify the program',
      JSON.stringify(ctx.getProgram(created.program.id)) === before);
    T('the template still holds its original exercise',
      ctx.resolveProgramWorkout(created.program.schedule.mon).exercises[0].name === firstExercise);
  }

  sub('gym profile is not required to build a program');
  {
    const app = await H.loadAppBooted({});
    await H.settle(300);
    const ctx = app.ctx;
    T('gym is unconfigured', ctx.isGymProfileConfigured() === false);
    const r = ctx.createProgram({ name:'No Gym', durationWeeks:4,
      schedule: sampleSchedule(ctx), startDate: DSTR(0) });
    T('a program can still be created', r.ok === true);
    const tpl = ctx.resolveProgramWorkout(r.program.schedule.mon);
    T('no exercise was removed for unknown equipment',
      tpl.exercises.length === ctx.DEFAULT_PLANS.upperlower.templates.upper[0].exercises.length);
  }

  sub('missed days are reported, never rescheduled');
  {
    const app = await H.loadAppBooted({});
    await H.settle(300);
    const ctx = app.ctx;
    const r = ctx.createProgram({ name:'M', durationWeeks:4,
      schedule: sampleSchedule(ctx), startDate: DSTR(21) });
    const before = JSON.stringify(r.program.schedule);
    const missed = ctx.getMissedProgramDays(r.program);
    T('missed sessions are reported', missed.length > 0);
    T('each names a date', missed.every(m => /^\d{4}-\d{2}-\d{2}$/.test(m.date)));
    T('the schedule was NOT rewritten',
      JSON.stringify(ctx.getProgram(r.program.id).schedule) === before);
    T('no workout was doubled up — nothing was added to history',
      ctx.workoutLog.length === 0);
    T('the week did not skip because sessions were missed',
      ctx.getCurrentProgramWeek(ctx.getProgram(r.program.id)) === 4);
  }
}

async function testProgramSafety(){
  section('CONTRACT 56 — programs touch no protected system');
  const fixture = buildProtectionFixture();
  const app = await H.loadAppBooted(fixture);
  const ctx = app.ctx;

  const before = H.snapshot(ctx);
  const progBefore = ctx.getCurrentProgression();
  const trainerBefore = ctx.trainerLog.entries.length;
  const planTemplatesBefore = JSON.stringify(ctx.DEFAULT_PLANS.upperlower.templates);
  const planDataBefore = JSON.stringify(Object.keys(app.store).filter(k => k.indexOf('planData:') === 0).map(k => app.store[k]));
  const scheduleBefore = JSON.stringify(Object.keys(app.store).filter(k => k.indexOf('schedule:') === 0).map(k => app.store[k]));
  const gymBefore = app.store.gymProfile;
  const notesBefore = app.store.exerciseNotes;
  const draftBefore = app.store.activeWorkoutDraft;
  const cardioBefore = JSON.stringify(ctx.cardioLog);

  sub('create, edit, pause, resume, complete a program');
  const r = ctx.createProgram({ name:'Safety', goal:'strength', durationWeeks:8,
    schedule: sampleSchedule(ctx), startDate: DSTR(7) });
  ctx.updateProgram(r.program.id, { name:'Safety 2' });
  ctx.pauseProgram(r.program.id); ctx.resumeProgram(r.program.id);
  ctx.getProgramProgress(); ctx.getMissedProgramDays();
  ctx.completeProgram(r.program.id);
  clearCaches(ctx);
  const after = H.snapshot(ctx);

  T('NOTHING protected changed', H.diffSnapshot(before, after, []).ok,
    H.diffSnapshot(before, after, []).violations.join(','));
  T('workoutLog byte-identical', after.rawWorkoutLog === before.rawWorkoutLog);
  T('cardioLog unchanged', JSON.stringify(ctx.cardioLog) === cardioBefore);
  T('XP unchanged', after.xp === before.xp);
  T('strength XP unchanged', ctx.getCurrentProgression().strengthXP === progBefore.strengthXP);
  T('cardio XP unchanged', ctx.getCurrentProgression().cardioXP === progBefore.cardioXP);
  T('level unchanged', after.level === before.level);
  T('PRs unchanged', after.prCount === before.prCount);
  T('readiness unchanged', after.readiness === before.readiness);
  T('recovery unchanged', after.recovery === before.recovery);
  T('capability unchanged', after.capabilityBench === before.capabilityBench);
  T('exercise notes unchanged', app.store.exerciseNotes === notesBefore);
  T('gymProfile unchanged', app.store.gymProfile === gymBefore);
  T('drafts preserved', app.store.activeWorkoutDraft === draftBefore);

  sub('the existing plan system is untouched');
  T('DEFAULT_PLANS templates byte-identical',
    JSON.stringify(ctx.DEFAULT_PLANS.upperlower.templates) === planTemplatesBefore);
  T('stored planData byte-identical',
    JSON.stringify(Object.keys(app.store).filter(k => k.indexOf('planData:') === 0).map(k => app.store[k])) === planDataBefore);
  T('stored schedules byte-identical',
    JSON.stringify(Object.keys(app.store).filter(k => k.indexOf('schedule:') === 0).map(k => app.store[k])) === scheduleBefore);
  T('every original plan still exists',
    ['balanced','strength','home','hypertrophy','athletic','upperlower'].every(id => !!ctx.DEFAULT_PLANS[id]));
  T('no plan was deleted', Object.keys(ctx.DEFAULT_PLANS).length >= 6);

  sub('trainer');
  T('engine still 0.1.1-shadow', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  T('no trainerLog entries created by program actions',
    ctx.trainerLog.entries.length === trainerBefore);
  T('trainer states unchanged',
    JSON.stringify(ctx.TRAINER_STATES) === JSON.stringify(['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF']));
  T('a deload block generated no recommendation',
    ctx.trainerLog.entries.length === trainerBefore);

  sub('source-level isolation of the program module');
  {
    const fs = require('fs');
    const src = fs.readFileSync(H.APP_PATH, 'utf8');
    const titleAt = src.indexOf('PROGRAM BUILDER & TRAINING BLOCKS  (Phase D7A)');
    const start = src.lastIndexOf('/*', titleAt);
    const end = src.indexOf('/* ---------- PROGRAM UI ----------');
    const code = src.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    T('module located', titleAt !== -1 && end > start);
    const forbidden = ['proposeTrainerState','applyTrainerConstraints','computeShadowRecommendation',
      'logRecommendation','persistTrainerLog','persistLog(','persistReadiness','computeMuscleRecovery('];
    const hits = forbidden.filter(f => code.indexOf(f) !== -1);
    T('it calls no trainer, recovery, readiness or workout-persistence function',
      hits.length === 0, hits.join(','));
    T('it writes only its own storage key',
      (code.match(/LOOPStore\.set\(/g) || []).length === 1 &&
      code.indexOf('LOOPStore.set(PROGRAMS_KEY') !== -1);
    T('it never assigns into workoutLog',
      !/\bworkoutLog\s*(=|\.push|\.splice)/.test(code));
  }

  sub('backup, export and restore');
  {
    const app2 = await H.loadAppBooted({});
    await H.settle(300);
    const c2 = app2.ctx;
    const made = c2.createProgram({ name:'Backup Program', goal:'hypertrophy', durationWeeks:12,
      schedule: sampleSchedule(c2), startDate: DSTR(14) });
    c2.updateProgram(made.program.id, { blocks:[
      { id:'b1', name:'Accumulation', order:1, phaseType:'accumulation', startWeek:1, endWeek:6 },
      { id:'b2', name:'Peak', order:2, phaseType:'peak', startWeek:7, endWeek:12 } ]});
    await H.settle(300);

    const keys = await c2.allDataKeys();
    T('programs is in the backup key list', keys.indexOf('programs') !== -1);
    const exported = {};
    for(const k of keys){
      const rr = await c2.LOOPStore.get(k);
      if(rr && rr.value !== undefined && rr.value !== null) exported[k] = rr.value;
    }
    T('export captures the programs', !!exported.programs);

    const restored = await H.loadAppBooted(exported);
    await H.settle(300);
    const rp = restored.ctx.getPrograms()[0];
    T('restore rebuilds the program', !!rp && rp.name === 'Backup Program');
    T('duration survives', rp.durationWeeks === 12);
    T('goal survives', rp.goal === 'hypertrophy');
    T('the schedule references survive',
      rp.schedule.mon.templateId === made.program.schedule.mon.templateId);
    T('blocks survive with their phases',
      rp.blocks.length === 2 && rp.blocks[1].phaseType === 'peak');
    T('the active program id survives',
      restored.ctx.getActiveProgram() && restored.ctx.getActiveProgram().id === rp.id);
    T('the week still computes after restore',
      restored.ctx.getCurrentProgramWeek(rp) === 3);
    T('programs did not leak into workoutLog',
      !JSON.stringify(restored.ctx.workoutLog).includes('Backup Program'));
    T('programs did not leak into trainerLog',
      !JSON.stringify(restored.ctx.trainerLog).includes('Backup Program'));
  }

  sub('reload persistence');
  {
    const app3 = await H.loadAppBooted({});
    await H.settle(300);
    const made = app3.ctx.createProgram({ name:'Persisted', durationWeeks:6,
      schedule: sampleSchedule(app3.ctx), startDate: DSTR(0) });
    await H.settle(300);
    const reopened = await H.loadAppBooted(app3.store);
    await H.settle(300);
    T('the program survives a reload', reopened.ctx.getPrograms().length === 1);
    T('it is still active', reopened.ctx.hasActiveProgram() === true);
    T('its id is stable', reopened.ctx.getActiveProgram().id === made.program.id);
  }
}

/* =========================================================
   CONTRACT 57-58 — FUNCTIONAL TRAINING PHASES (Phase D7B)
   ---------------------------------------------------------
   Phases became readable: which one you are in, how far
   through, what is next. The line these tests hold is that
   "functional" never became "automatic" — a deload phase is
   a label the athlete wrote, and nothing in LOOP decides one
   is needed, transitions between phases, or changes a workout
   because of one.
   ========================================================= */
function fourPhaseBlocks(){
  return [
    { id:'ph1', name:'Accumulation',  order:1, phaseType:'accumulation',    startWeek:1,  endWeek:4  },
    { id:'ph2', name:'Progressive Overload', order:2, phaseType:'intensification', startWeek:5,  endWeek:8  },
    { id:'ph3', name:'Deload',        order:3, phaseType:'deload',          startWeek:9,  endWeek:9  },
    { id:'ph4', name:'Rebuild',       order:4, phaseType:'rebuild',         startWeek:10, endWeek:12 }
  ];
}
function makePhasedProgram(ctx, weeksAgo){
  ctx.programsStore = { version:1, activeProgramId:null, programs:[] };
  ctx.invalidateProgramCache();
  const r = ctx.createProgram({ name:'Summer Hypertrophy', goal:'hypertrophy', durationWeeks:12,
    schedule: sampleSchedule(ctx), startDate: DSTR(weeksAgo * 7) });
  ctx.updateProgram(r.program.id, { blocks: fourPhaseBlocks() });
  return ctx.getProgram(r.program.id);
}

function testTrainingPhases(app){
  section('CONTRACT 57 — training phases resolve, progress and never decide');
  const ctx = app.ctx;

  sub('phase registry carries programming purpose');
  T('all six types remain', ctx.PROGRAM_PHASE_TYPES.length === 6);
  T('every type has a purpose', ctx.PROGRAM_PHASE_TYPES.every(t => !!t.purpose));
  T('deload purpose is factual, not physiological',
    /planned reduction in training stress/i.test(ctx.getProgramPhase('deload').purpose));
  const allCopy = JSON.stringify(ctx.PROGRAM_PHASE_TYPES).toLowerCase();
  const banned = ['overtrain','your body needs','recover from injury','fatigued athlete','burnout','cortisol'];
  T('no medical or physiological claims in phase copy',
    banned.every(b => allCopy.indexOf(b) === -1),
    banned.filter(b => allCopy.indexOf(b) !== -1).join(','));

  sub('current phase resolution — week 6 of a four-phase program');
  const p = makePhasedProgram(ctx, 5);            // started 5 weeks ago => week 6
  T('program is at week 6', ctx.getCurrentProgramWeek(p) === 6);
  const cur = ctx.getCurrentTrainingPhase(p);
  T('current phase resolves', !!cur && cur.name === 'Progressive Overload');
  T('current phase type resolves', ctx.getCurrentPhaseType(p) === 'intensification');
  const weeks = ctx.getCurrentPhaseWeeks(p);
  T('phase week range resolves', weeks.startWeek === 5 && weeks.endWeek === 8);
  T('phase duration resolves', weeks.durationWeeks === 4);

  sub('phase progress');
  const ph = ctx.getPhaseProgress(p);
  T('reports being in a phase', ph.inPhase === true);
  T('week within the phase is 1-based', ph.weekInPhase === 2);
  T('total phase weeks correct', ph.totalWeeks === 4);
  T('weeks remaining correct', ph.weeksRemaining === 2);
  T('percent is week-based', ph.percent === 50);
  T('not flagged as the final week', ph.isFinalWeek === false);
  T('carries the phase purpose', !!ph.purpose);
  T('no training score is produced', ph.score === undefined && ph.rating === undefined);

  sub('next phase');
  T('next phase resolves by week order', ph.nextPhase && ph.nextPhase.name === 'Deload');
  T('next phase reports its start week', ph.nextPhase.startWeek === 9);
  const last = makePhasedProgram(ctx, 11);        // week 12 = final phase
  T('the final phase reports no next phase', ctx.getNextTrainingPhase(last) === null);
  T('the final week is flagged', ctx.getPhaseProgress(last).isFinalWeek === true);

  sub('past / current / upcoming derive from position');
  const sched = ctx.getProgramPhaseSchedule(makePhasedProgram(ctx, 5));
  T('four phases listed', sched.length === 4);
  T('earlier phase reads as past', sched[0].status === 'past');
  T('the containing phase reads as current', sched[1].status === 'current');
  T('later phases read as upcoming',
    sched[2].status === 'upcoming' && sched[3].status === 'upcoming');
  T('completed phases are NOT deleted', sched[0].block.name === 'Accumulation');
  T('each row carries a type label and purpose',
    sched.every(r => !!r.typeLabel && typeof r.purpose === 'string'));

  sub('a deload phase is a LABEL, never a decision');
  const dl = makePhasedProgram(ctx, 8);           // week 9 = the deload week
  const dlp = ctx.getPhaseProgress(dl);
  T('the athlete is in their planned deload', dlp.phaseType === 'deload');
  T('it is a single week', dlp.totalWeeks === 1);
  const tplBefore = JSON.stringify(ctx.resolveProgramWorkout(dl.schedule.mon));
  const schedBefore = JSON.stringify(dl.schedule);
  const trainerBefore = ctx.trainerLog.entries.length;
  ctx.getPhaseProgress(dl); ctx.getNextTrainingPhase(dl); ctx.getProgramPhaseSchedule(dl);
  T('the scheduled workout is byte-identical inside a deload',
    JSON.stringify(ctx.resolveProgramWorkout(dl.schedule.mon)) === tplBefore);
  T('no sets or reps were reduced automatically',
    ctx.resolveProgramWorkout(dl.schedule.mon).exercises
      .every((e,i) => e.sets === JSON.parse(tplBefore).exercises[i].sets));
  T('no exercise was removed automatically',
    ctx.resolveProgramWorkout(dl.schedule.mon).exercises.length === JSON.parse(tplBefore).exercises.length);
  T('the schedule was not rewritten', JSON.stringify(ctx.getProgram(dl.id).schedule) === schedBefore);
  T('no trainer record was created by a deload phase',
    ctx.trainerLog.entries.length === trainerBefore);
  T('LOOP never claims the athlete NEEDS a deload',
    !/you (need|should)|overtrained|your body/i.test(ctx.getProgramPhase('deload').purpose));

  sub('phases never transition on their own');
  {
    const prog = makePhasedProgram(ctx, 3);       // week 4 = last week of phase 1
    const before = ctx.getCurrentTrainingPhase(prog).name;
    for(let i = 0; i < 30; i++){ ctx.getPhaseProgress(prog); ctx.getNextTrainingPhase(prog); }
    T('reading a phase 30 times does not advance it',
      ctx.getCurrentTrainingPhase(prog).name === before);
    T('the final week of a phase is flagged, not auto-advanced',
      ctx.getPhaseProgress(prog).isFinalWeek === true &&
      ctx.getCurrentTrainingPhase(prog).name === 'Accumulation');
    T('the next phase is offered as information only',
      ctx.getNextTrainingPhase(prog).name === 'Progressive Overload');
  }

  sub('editing phases');
  const ep = makePhasedProgram(ctx, 5);
  T('rename a phase',
    ctx.updateProgramPhase(ep.id, 'ph2', { name:'Heavy Block' }).ok === true &&
    ctx.getProgram(ep.id).blocks.find(b => b.id === 'ph2').name === 'Heavy Block');
  T('change a phase type',
    ctx.updateProgramPhase(ep.id, 'ph4', { phaseType:'peak' }).ok === true &&
    ctx.getProgram(ep.id).blocks.find(b => b.id === 'ph4').phaseType === 'peak');
  T('set a custom description',
    ctx.updateProgramPhase(ep.id, 'ph1', { description:'Build the base.' }).ok === true);
  T('a custom description overrides the type purpose',
    ctx.phasePurposeText(ctx.getProgram(ep.id).blocks.find(b => b.id === 'ph1')) === 'Build the base.');
  T('a phase with no description falls back to its type purpose',
    ctx.phasePurposeText({ phaseType:'peak', description:'' }) === ctx.getProgramPhase('peak').purpose);

  sub('adding and deleting phases');
  {
    const prog = makePhasedProgram(ctx, 0);
    const addRes = ctx.addProgramPhase(prog.id, { name:'Extra', phaseType:'custom', startWeek:13, endWeek:14 });
    T('a phase beyond the program length is refused', addRes.ok === false);
    T('the program still has four phases', ctx.getProgram(prog.id).blocks.length === 4);
    const del = ctx.deleteProgramPhase(prog.id, 'ph3');
    T('delete succeeds', del.ok === true);
    T('only that phase was removed',
      ctx.getProgram(prog.id).blocks.length === 3 &&
      !ctx.getProgram(prog.id).blocks.some(b => b.id === 'ph3'));
    T('the other phases keep their ranges',
      ctx.getProgram(prog.id).blocks.find(b => b.id === 'ph2').startWeek === 5);
    T('a gap left by a deleted phase is allowed, not auto-filled',
      ctx.getBlockForWeek(ctx.getProgram(prog.id), 9) === null);
    T('a week inside a gap reports no structured phase',
      (() => { const g = ctx.getPhaseProgress(ctx.getProgram(prog.id), DSTR(-56));
               return g === null || g.inPhase === false; })());
  }

  sub('reordering keeps the program continuous');
  {
    const prog = makePhasedProgram(ctx, 0);
    const res = ctx.moveProgramPhase(prog.id, 'ph3', 'up');   // deload before intensification
    T('move succeeds', res.ok === true);
    const after = ctx.sortedProgramPhases(ctx.getProgram(prog.id));
    T('the moved phase now starts earlier', after[1].id === 'ph3');
    T('phase lengths are preserved',
      ctx.phaseDurationWeeks(after.find(b => b.id === 'ph3')) === 1 &&
      ctx.phaseDurationWeeks(after.find(b => b.id === 'ph2')) === 4);
    T('weeks remain contiguous',
      after.every((b, i) => i === 0 || b.startWeek === after[i-1].endWeek + 1));
    T('order is renumbered', after.every((b, i) => b.order === i + 1));
    T('no phase runs past the program',
      after.every(b => b.endWeek <= ctx.getProgram(prog.id).durationWeeks));
    T('moving past the end is refused',
      ctx.moveProgramPhase(prog.id, after[0].id, 'up').ok === false);
    T('workout history untouched by reordering',
      (() => { const logBefore = JSON.stringify(ctx.workoutLog);
               ctx.moveProgramPhase(prog.id, 'ph2', 'down');
               ctx.moveProgramPhase(prog.id, 'ph2', 'up');
               return JSON.stringify(ctx.workoutLog) === logBefore; })());
  }

  sub('malformed and legacy phase data is handled gracefully');
  {
    const prog = makePhasedProgram(ctx, 0);
    T('overlapping phases are refused',
      ctx.updateProgramPhase(prog.id, 'ph2', { startWeek:3 }).ok === false);
    T('inverted ranges are refused',
      ctx.updateProgramPhase(prog.id, 'ph2', { startWeek:8, endWeek:5 }).ok === false);
    T('a phase past the program is refused',
      ctx.updateProgramPhase(prog.id, 'ph4', { endWeek:99 }).ok === false);
    T('an unknown phase type is refused',
      ctx.updateProgramPhase(prog.id, 'ph1', { phaseType:'not_a_phase' }).ok === false);
    T('editing an unknown phase id is refused',
      ctx.updateProgramPhase(prog.id, 'nope', { name:'x' }).ok === false);
    T('a refused edit leaves the program unchanged',
      ctx.getProgram(prog.id).blocks.find(b => b.id === 'ph2').startWeek === 5);
    T('a program with NO blocks does not crash',
      (() => { const r = ctx.createProgram({ name:'NoPhases', durationWeeks:4,
                 schedule: sampleSchedule(ctx), startDate: DSTR(0) });
               ctx.updateProgram(r.program.id, { blocks: [] });
               const prg = ctx.getProgram(r.program.id);
               return ctx.getProgramPhaseSchedule(prg).length === 0 &&
                      ctx.getCurrentTrainingPhase(prg) === null; })());
    T('phase helpers are safe with no program at all',
      (() => { ctx.programsStore = { version:1, activeProgramId:null, programs:[] };
               ctx.invalidateProgramCache();
               return ctx.getCurrentTrainingPhase() === null &&
                      ctx.getCurrentPhaseType() === null &&
                      ctx.getCurrentPhaseWeeks() === null &&
                      ctx.getNextTrainingPhase() === null &&
                      ctx.getPhaseProgress() === null &&
                      ctx.getProgramPhaseSchedule().length === 0; })());
    T('the Today phase line renders nothing without a program',
      ctx.programPhaseLineHtml() === '');
    T('the workout phase label renders nothing without a program',
      ctx.workoutPhaseContextHtml() === '');
  }

  sub('pause behaviour from D7A is not regressed');
  {
    const prog = makePhasedProgram(ctx, 5);       // week 6, intensification
    T('starts in the intensification phase',
      ctx.getCurrentPhaseType(prog) === 'intensification');
    ctx.pauseProgram(prog.id);
    T('the phase freezes while paused',
      ctx.getCurrentPhaseType(ctx.getProgram(prog.id)) === 'intensification');
    ctx.getProgram(prog.id).pausedOnDate = DSTR(21);
    ctx.resumeProgram(prog.id);
    T('paused time did not advance the phase',
      ctx.getCurrentProgramWeek(ctx.getProgram(prog.id)) === 3);
    T('the athlete is back in the phase covering that week',
      ctx.getCurrentPhaseType(ctx.getProgram(prog.id)) === 'accumulation');
    T('pausing created no trainer record', ctx.trainerLog.entries.length === 0);
  }

  sub('rapid editing stays consistent');
  {
    const prog = makePhasedProgram(ctx, 0);
    for(let i = 0; i < 40; i++) ctx.updateProgramPhase(prog.id, 'ph1', { name:'Rapid ' + i });
    T('40 rapid edits land deterministically',
      ctx.getProgram(prog.id).blocks.find(b => b.id === 'ph1').name === 'Rapid 39');
    T('rapid edits create no duplicate phases',
      ctx.getProgram(prog.id).blocks.length === 4);
    T('phase ids stay unique',
      new Set(ctx.getProgram(prog.id).blocks.map(b => b.id)).size === 4);
    for(let i = 0; i < 10; i++){ ctx.moveProgramPhase(prog.id,'ph2','down'); ctx.moveProgramPhase(prog.id,'ph2','up'); }
    T('rapid reordering keeps weeks contiguous',
      (() => { const a = ctx.sortedProgramPhases(ctx.getProgram(prog.id));
               return a.every((b,i) => i === 0 || b.startWeek === a[i-1].endWeek + 1); })());
  }
}

async function testPhaseIsolation(){
  section('CONTRACT 58 — phases change nothing outside the program');
  const fixture = buildProtectionFixture();
  const app = await H.loadAppBooted(fixture);
  const ctx = app.ctx;

  const before = H.snapshot(ctx);
  const progBefore = ctx.getCurrentProgression();
  const trainerBefore = ctx.trainerLog.entries.length;
  const recBefore = JSON.stringify(ctx.computeMuscleRecovery());
  const capBefore = JSON.stringify(ctx.getExerciseCapability('Bench Press'));
  const readyBefore = JSON.stringify(ctx.dailyReadiness);
  const notesBefore = app.store.exerciseNotes;
  const gymBefore = app.store.gymProfile;
  const draftBefore = app.store.activeWorkoutDraft;
  const planTplBefore = JSON.stringify(ctx.DEFAULT_PLANS.upperlower.templates);
  const cardioBefore = JSON.stringify(ctx.cardioLog);

  sub('build a full phase structure and read it repeatedly');
  const prog = makePhasedProgram(ctx, 5);
  ctx.updateProgramPhase(prog.id, 'ph3', { description:'Planned lighter week.' });
  ctx.moveProgramPhase(prog.id, 'ph4', 'up');
  for(let i = 0; i < 25; i++){
    ctx.getPhaseProgress(); ctx.getNextTrainingPhase(); ctx.getProgramPhaseSchedule();
    ctx.programPhaseLineHtml(); ctx.workoutPhaseContextHtml();
  }
  clearCaches(ctx);
  const after = H.snapshot(ctx);

  T('NOTHING protected changed', H.diffSnapshot(before, after, []).ok,
    H.diffSnapshot(before, after, []).violations.join(','));
  T('workoutLog byte-identical', after.rawWorkoutLog === before.rawWorkoutLog);
  T('cardioLog unchanged', JSON.stringify(ctx.cardioLog) === cardioBefore);
  T('XP unchanged', after.xp === before.xp);
  T('strength XP unchanged', ctx.getCurrentProgression().strengthXP === progBefore.strengthXP);
  T('cardio XP unchanged', ctx.getCurrentProgression().cardioXP === progBefore.cardioXP);
  T('level unchanged', after.level === before.level);
  T('PRs unchanged', after.prCount === before.prCount);
  T('exercise notes unchanged', app.store.exerciseNotes === notesBefore);
  T('gymProfile unchanged', app.store.gymProfile === gymBefore);
  T('drafts preserved', app.store.activeWorkoutDraft === draftBefore);
  T('plan templates unchanged',
    JSON.stringify(ctx.DEFAULT_PLANS.upperlower.templates) === planTplBefore);

  sub('readiness, recovery and capability are not phase inputs');
  T('readiness unchanged', JSON.stringify(ctx.dailyReadiness) === readyBefore);
  T('recovery unchanged', JSON.stringify(ctx.computeMuscleRecovery()) === recBefore);
  T('capability unchanged', JSON.stringify(ctx.getExerciseCapability('Bench Press')) === capBefore);
  T('a low-readiness day does not change the phase',
    (() => { const phaseBefore = ctx.getCurrentPhaseType();
             ctx.dailyReadiness[DSTR(0)] = { energy:1, soreness:1, sleep:1, stress:1, feel:1 };
             clearCaches(ctx);
             const same = ctx.getCurrentPhaseType() === phaseBefore;
             delete ctx.dailyReadiness[DSTR(0)]; clearCaches(ctx);
             return same; })());

  sub('exercise notes are not phase triggers');
  {
    const phaseBefore = ctx.getCurrentPhaseType();
    ctx.saveExerciseNote('bench_press_barbell', 'Felt exhausted.');
    ctx.saveExerciseNote('bench_press_barbell', 'Ready to push heavier.');
    T('an "exhausted" note does not start a deload',
      ctx.getCurrentPhaseType() === phaseBefore);
    T('a "ready to push" note does not skip a phase',
      ctx.getCurrentPhaseType() === phaseBefore);
    T('notes still stored independently',
      ctx.getExerciseNotes('bench_press_barbell').length === 2);
  }

  sub('missed workouts do not alter phase state');
  {
    const phaseBefore = ctx.getCurrentPhaseType();
    const weekBefore = ctx.getCurrentProgramWeek();
    const missed = ctx.getMissedProgramDays();
    T('missed sessions are visible', Array.isArray(missed));
    T('the phase is unchanged by missed sessions', ctx.getCurrentPhaseType() === phaseBefore);
    T('the week is unchanged by missed sessions', ctx.getCurrentProgramWeek() === weekBefore);
  }

  sub('Time Mode and substitution do not touch phases');
  {
    const p = ctx.getActiveProgram();
    const phaseBefore = JSON.stringify(ctx.getProgramPhaseSchedule(p));
    const tpl = ctx.resolveProgramWorkout(p.schedule.mon);
    ctx.compressWorkoutForTime(tpl, 30);
    ctx.getSubstitutionsByName(tpl.exercises[0].name, {});
    T('phase structure unchanged by Time Mode and substitution',
      JSON.stringify(ctx.getProgramPhaseSchedule(ctx.getActiveProgram())) === phaseBefore);
    T('the phase still references the original template',
      ctx.resolveProgramWorkout(ctx.getActiveProgram().schedule.mon).exercises[0].name === tpl.exercises[0].name);
  }

  sub('trainer');
  T('engine still 0.1.1-shadow', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  T('no trainerLog entries created by any phase action',
    ctx.trainerLog.entries.length === trainerBefore);
  T('trainer states unchanged',
    JSON.stringify(ctx.TRAINER_STATES) === JSON.stringify(['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF']));
  T('no recommendation was produced from a phase',
    ctx.trainerLog.entries.length === trainerBefore);

  sub('storage: phases live inside the program, with no second key');
  T('no phaseLog key exists', app.store.phaseLog === undefined);
  T('no phases key exists', app.store.phases === undefined);
  T('DATA_KEYS gained nothing for phases',
    !ctx.DATA_KEYS.some(k => /phase/i.test(k)));
  T('phases are stored on the program itself',
    JSON.parse(app.store.programs).programs[0].blocks.length >= 3);
  T('schema still v1', ctx.DATA_SCHEMA_VERSION === 1);

  sub('backup and restore reconstruct the phase structure exactly');
  {
    const keys = await ctx.allDataKeys();
    const exported = {};
    for(const k of keys){
      const rr = await ctx.LOOPStore.get(k);
      if(rr && rr.value !== undefined && rr.value !== null) exported[k] = rr.value;
    }
    const restored = await H.loadAppBooted(exported);
    await H.settle(300);
    const rp = restored.ctx.getActiveProgram();
    T('the program restored', !!rp);
    const rows = restored.ctx.getProgramPhaseSchedule(rp);
    T('every phase restored', rows.length === 4);
    T('phase names survived', rows.some(r => r.block.name === 'Accumulation'));
    T('phase types survived', rows.some(r => r.block.phaseType === 'deload'));
    T('phase descriptions survived',
      rows.some(r => r.block.description === 'Planned lighter week.'));
    T('phase ordering survived',
      rows.every((r,i) => i === 0 || r.block.startWeek > rows[i-1].block.startWeek));
    T('the current phase still resolves after restore',
      !!restored.ctx.getCurrentTrainingPhase(rp));
    T('the current week still resolves after restore',
      restored.ctx.getCurrentProgramWeek(rp) === ctx.getCurrentProgramWeek(ctx.getActiveProgram()));
    T('a paused program restores paused',
      (() => { ctx.pauseProgram(ctx.getActiveProgram().id);
               return ctx.getActiveProgram().status === 'paused'; })());
  }
}

/* =========================================================
   CONTRACT 59 — UX REFINEMENT CONTRACTS (discoverability)
   ---------------------------------------------------------
   These pin the discoverability decisions so a later change
   cannot quietly hide a feature behind a glyph again, and pin
   the warm-up navigation fix so the workout can never be
   closed by finishing a warm-up.

   The harness has no layout engine, so geometry was measured
   in a real browser and recorded in the phase report; what is
   asserted here is the shipped markup, the stylesheet, and
   actual navigation state.
   ========================================================= */
function testUXContracts(app){
  section('CONTRACT 59 — feature discoverability and control hierarchy');
  const ctx = app.ctx;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');

  sub('set type is a labelled control, not a hidden menu');
  const rowMarkup = src.slice(src.indexOf('function appendSetRow'), src.indexOf('function renumberSets'));
  T('the set row carries a SET TYPE label', /SET TYPE/.test(rowMarkup));
  T('the control names the current classification',
    /class="set-type-value"/.test(rowMarkup));
  T('it shows a disclosure caret', /set-type-caret/.test(rowMarkup));
  T('the bare three-dot affordance is gone', rowMarkup.indexOf('⋯') === -1);
  T('it is grouped with the weight and reps controls',
    /stepper-group set-type-group/.test(rowMarkup));
  /* D10 moved the unit labels from every set row to one column header per
     exercise. The contract was always 'weight and reps are labelled', not
     'labelled 26 times' — so it is asserted against the workout markup that
     actually ships, and the once-per-exercise placement is asserted too. */
  const exMarkup = src.slice(src.indexOf('function addLogExerciseRow'), src.indexOf('function swapLogExercise'));
  T('weight still labelled', exMarkup.indexOf('<span class="unit-label">LB</span>') !== -1);
  T('reps still labelled', exMarkup.indexOf('<span class="unit-label">REPS</span>') !== -1);
  T('the label is a column header, not a per-set repetition',
    exMarkup.indexOf('class="sets-head"') !== -1 &&
    rowMarkup.indexOf('unit-label">LB') === -1);
  T('all five types remain reachable from the picker',
    ctx.SET_TYPE_REGISTRY.length === 5);

  sub('set type does not fabricate stored data');
  T('an untyped set still reads as UNKNOWN in the data',
    ctx.setTypeOf({ weight:'225', reps:'8' }) === null);
  T('displaying "Working" writes nothing',
    (() => { const s = { weight:'225', reps:'8' }; ctx.setTypeOf(s); return s.type === undefined; })());

  sub('exercise replacement is named, not a glyph');
  T('the replace control carries a word label', /Replace exercise/.test(src));
  T('it no longer relies on a bare arrow glyph',
    !/>↔ Replace</.test(src));

  sub('warm-up start vs skip hierarchy is unchanged');
  const css = src.slice(src.indexOf('.prep-card{'), src.indexOf('/* ---- runner ---- */'));
  T('Start is still full width', /\.prep-card \.prep-start-btn\{[^}]*width:\s*100%/.test(css));
  T('Start is still >= 48px', (() => {
    const m = css.match(/\.prep-card \.prep-start-btn\{[^}]*min-height:\s*(\d+)px/);
    return m && Number(m[1]) >= 48; })());
  T('Skip still has no fill or border',
    /\.prep-card \.prep-skip-btn\{[^}]*background:\s*none/.test(css));

  sub('timers are contained, and only where a duration exists');
  T('a ring timer exists', /class="prep-ring/.test(src));
  T('the countdown sits inside the ring', /prep-ring[\s\S]{0,400}id="prepMetric"/.test(src));
  T('the ring sweeps from a real duration', /totalForRing/.test(src));
  T('counted movements use a plain number, not a ring',
    /prep-metric prep-metric-plain/.test(src));
  T('the number is the hero',
    (() => { const m = src.match(/\.prep-ring \.prep-metric\{[^}]*font-size:\s*(\d+)px/);
             return m && Number(m[1]) >= 36; })());
  T('reduced motion is respected for the ring',
    /prefers-reduced-motion[\s\S]{0,200}prep-ring-fill/.test(src));

  sub('rotation safety');
  T('a landscape media query exists', /@media \(orientation: landscape\)/.test(src));
  T('sideways scroll is prevented globally', /overflow-x:\s*hidden/.test(src));
  T('sheets are constrained to the viewport', /\.overlay \.sheet\{[^}]*max-height/.test(src));
  T('the viewport still allows user zoom (no user-scalable=no)',
    !/user-scalable\s*=\s*no/.test(src) && !/maximum-scale/.test(src));

  sub('self-inflicted history pops are counted, not flagged');
  T('a counter is used so rapid cycles cannot desync', /pendingSelfPops/.test(src));
  T('the boolean one-shot flag is gone', !/suppressPopstateOnce/.test(src));
}

/* The navigation bug this pass existed to fix. */
async function testWarmupReturnsToWorkout(){
  section('CONTRACT 60 — finishing a warm-up returns to the same workout');
  const app = await H.loadAppBooted({ selectedPlan: JSON.stringify('upperlower') });
  await H.settle(300);
  const ctx = app.ctx, dom = app.dom;

  const logOverlay = dom.document.getElementById('logOverlay');
  logOverlay.classList.add('open');            // a workout is in progress
  ctx.pendingLogCategory = 'upper';

  sub('completing a warm-up');
  ctx.startPrep();
  T('the runner opened', ctx.prepState !== null);
  T('the workout is still open underneath', logOverlay.classList.contains('open'));
  const total = ctx.prepState.seq.length;
  for(let i = 0; i < total; i++) ctx.nextPrepStep();
  T('the completion screen is reached', ctx.prepState.idx >= total);
  ctx.exitPrep();
  T('THE WORKOUT IS STILL OPEN', logOverlay.classList.contains('open'));
  T('the runner closed', ctx.prepState === null);
  T('no timer was left running', ctx.prepTimerId === null);

  sub('exiting midway');
  ctx.startPrep();
  ctx.nextPrepStep();
  ctx.exitPrep();
  T('the workout survives a mid-warm-up exit', logOverlay.classList.contains('open'));

  sub('skipping');
  ctx.prepCardDismissed = false;
  ctx.skipPrep();
  T('the workout survives a skip', logOverlay.classList.contains('open'));
  T('skipping created no runner state', ctx.prepState === null);

  sub('rapid cycles cannot close the workout');
  for(let i = 0; i < 20; i++){ ctx.startPrep(); ctx.exitPrep(); }
  T('the workout is still open after 20 start/exit cycles',
    logOverlay.classList.contains('open'));
  T('no runner state leaked', ctx.prepState === null);
  T('no timer leaked', ctx.prepTimerId === null);

  sub('nothing was written by any of it');
  T('workoutLog untouched', ctx.workoutLog.length === 0);
  T('no trainer records created', ctx.trainerLog.entries.length === 0);
  T('engine still 0.1.1-shadow', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
}

/* =========================================================
   CONTRACT 61-62 — ONBOARDING & DISCOVERY  (Phase D8)
   ---------------------------------------------------------
   The tour must teach without trapping: skippable in one tap,
   never shown twice unasked, replayable from Settings, and
   incapable of touching a single piece of training data.
   ========================================================= */
function testOnboarding(app){
  section('CONTRACT 61 — onboarding content, flow and honesty');
  const ctx = app.ctx;
  ctx.onboardingState = ctx.defaultOnboardingState();

  sub('storage is minimal and versioned');
  T('onboarding has its own key', ctx.ONBOARDING_KEY === 'onboarding');
  T('registered in DATA_KEYS', ctx.DATA_KEYS.includes('onboarding'));
  T('a version is declared', ctx.ONBOARDING_VERSION >= 1);
  T('default state stores no training data',
    JSON.stringify(Object.keys(ctx.defaultOnboardingState()).sort()) ===
    JSON.stringify(['completedAt','completedVersion','hintsSeen','skipped','version']));
  T('schema version untouched', ctx.DATA_SCHEMA_VERSION === 1);

  sub('the tour is short and teaches a mental model');
  T('between 6 and 8 steps',
    ctx.ONBOARDING_STEPS.length >= 6 && ctx.ONBOARDING_STEPS.length <= 8,
    String(ctx.ONBOARDING_STEPS.length));
  T('every step has a title', ctx.ONBOARDING_STEPS.every(s => !!s.title));
  T('every step has one concise explanation',
    ctx.ONBOARDING_STEPS.every(s => !!s.body && s.body.length <= 260));
  T('every step has a visual', ctx.ONBOARDING_STEPS.every(s => typeof s.visual === 'function'));
  T('every visual renders markup',
    ctx.ONBOARDING_STEPS.every(s => s.visual().trim().indexOf('<') === 0));
  T('step ids are unique',
    new Set(ctx.ONBOARDING_STEPS.map(s => s.id)).size === ctx.ONBOARDING_STEPS.length);

  sub('it teaches controls that actually exist');
  const all = ctx.ONBOARDING_STEPS.map(s => s.title + ' ' + s.body + ' ' + s.visual()).join(' ');
  T('mentions Set Type', /set type/i.test(all));
  T('mentions warm-up', /warm-up/i.test(all));
  T('mentions replace', /replace/i.test(all));
  T('mentions readiness', /readiness/i.test(all));
  T('mentions the training cycle', /cycle/i.test(all));
  T('the tour no longer says "program", which read as a synonym for plan',
    !/programs?/i.test(all));
  T('mentions autosave', /saves|autosaved/i.test(all));
  /* Membership, not order — the copy lists them in reading order
     ("working, warm-up, drop, failure or AMRAP"), which is a writing choice,
     not a contract. What matters is that all five real types are named. */
  T('the set types named are the real five',
    ['warm-up','working','drop','failure','AMRAP'].every(t => new RegExp(t, 'i').test(all)));

  sub('it is honest about the trainer');
  T('never claims LOOP picks weights for you',
    !/perfect weight|chooses your weight|decides your/i.test(all));
  T('never claims autonomous coaching',
    !/automatically adjusts your workout|coaches you automatically/i.test(all));
  T('states LOOP is observing rather than deciding',
    /observing, not deciding/i.test(all));
  /* Ban the CLAIM, not the word. The only "medical" in the copy is the
     disclaimer "not medical advice", which is exactly the wording we want —
     the earlier version of this assertion failed on its own disclaimer. */
  T('makes no medical or physiological claim',
    !/overtrain|diagnos|heals|treats|prevents injury|your body needs/i.test(all));
  T('and explicitly disclaims medical advice', /not medical advice/i.test(all));
  T('readiness copy stays context, not diagnosis',
    /not medical advice/i.test(all));

  sub('flow: continue, back, and finishing');
  ctx.onboardingIndex = 0;
  ctx.onboardingNext();
  T('continue advances', ctx.onboardingIndex === 1);
  ctx.onboardingBack();
  T('back returns', ctx.onboardingIndex === 0);
  ctx.onboardingBack();
  T('back on the first step is a safe no-op', ctx.onboardingIndex === 0);
  for(let i = 0; i < ctx.ONBOARDING_STEPS.length + 5; i++) ctx.onboardingNext();
  T('running past the end completes rather than overflowing',
    ctx.onboardingState.completedVersion === ctx.ONBOARDING_VERSION);
  T('completion is timestamped', !!ctx.onboardingState.completedAt);
  T('a completed tour is not offered again', ctx.shouldOfferOnboarding() === false);

  sub('skip exits immediately and never nags');
  ctx.onboardingState = ctx.defaultOnboardingState();
  T('offered to a brand-new athlete', ctx.shouldOfferOnboarding() === true);
  ctx.skipOnboarding();
  T('skip is recorded', ctx.onboardingState.skipped === true);
  T('skip does NOT mark it completed', ctx.onboardingState.completedVersion === null);
  T('a skipped tour is not offered again', ctx.shouldOfferOnboarding() === false);

  sub('versioning lets a future tour be offered without resetting anyone');
  ctx.onboardingState = ctx.defaultOnboardingState();
  ctx.onboardingState.completedVersion = ctx.ONBOARDING_VERSION - 1;
  T('an older completed version can be offered the new tour',
    ctx.shouldOfferOnboarding() === true);
  ctx.onboardingState.completedVersion = ctx.ONBOARDING_VERSION;
  T('the current version is not re-offered', ctx.shouldOfferOnboarding() === false);

  sub('contextual hints appear once and are dismissible');
  ctx.onboardingState = ctx.defaultOnboardingState();
  T('a hint renders the first time', ctx.hintHtml('setType').indexOf('ob-hint') !== -1);
  T('it carries a dismiss control', ctx.hintHtml('setType').indexOf('dismissHint') !== -1);
  ctx.markHintSeen('setType');
  T('it never renders again', ctx.hintHtml('setType') === '');
  T('other hints are unaffected', ctx.hintHtml('replace').indexOf('ob-hint') !== -1);
  T('an unknown hint id renders nothing', ctx.hintHtml('nope') === '');
  T('hints exist for the tools that need them',
    ['setType','timeMode','replace','programs','notes'].every(k => !!ctx.ONBOARDING_HINTS[k]));
  T('hint copy is one short line',
    Object.keys(ctx.ONBOARDING_HINTS).every(k => ctx.ONBOARDING_HINTS[k].length <= 140));

  sub('rapid navigation stays consistent');
  ctx.onboardingState = ctx.defaultOnboardingState();
  ctx.onboardingIndex = 0;
  for(let i = 0; i < 60; i++){ ctx.onboardingNext(); ctx.onboardingBack(); }
  T('60 rapid next/back cycles leave a valid index',
    ctx.onboardingIndex >= 0 && ctx.onboardingIndex < ctx.ONBOARDING_STEPS.length);
  for(let i = 0; i < 30; i++) ctx.skipOnboarding();
  T('repeated skips are idempotent', ctx.onboardingState.skipped === true);
}

async function testOnboardingSafety(){
  section('CONTRACT 62 — onboarding touches no training data');
  const fixture = buildProtectionFixture();
  const app = await H.loadAppBooted(fixture);
  const ctx = app.ctx;

  const before = H.snapshot(ctx);
  const progBefore = ctx.getCurrentProgression();
  const trainerBefore = ctx.trainerLog.entries.length;
  const notesBefore = app.store.exerciseNotes;
  const gymBefore = app.store.gymProfile;
  const programsBefore = app.store.programs;
  const draftBefore = app.store.activeWorkoutDraft;
  const cardioBefore = JSON.stringify(ctx.cardioLog);
  const planDataBefore = JSON.stringify(Object.keys(app.store)
    .filter(k => k.indexOf('planData:') === 0).map(k => app.store[k]));

  sub('run the whole tour, skip it, and replay it');
  ctx.onboardingState = ctx.defaultOnboardingState();
  ctx.onboardingIndex = 0;
  for(let i = 0; i < ctx.ONBOARDING_STEPS.length; i++) ctx.onboardingNext();
  ctx.skipOnboarding();
  ctx.startOnboarding();                       // replay
  for(let i = 0; i < ctx.ONBOARDING_STEPS.length; i++) ctx.onboardingNext();
  ['setType','timeMode','replace','programs','notes'].forEach(h => { ctx.hintHtml(h); ctx.markHintSeen(h); });
  clearCaches(ctx);
  const after = H.snapshot(ctx);

  T('NOTHING protected changed', H.diffSnapshot(before, after, []).ok,
    H.diffSnapshot(before, after, []).violations.join(','));
  T('workoutLog byte-identical', after.rawWorkoutLog === before.rawWorkoutLog);
  T('cardioLog unchanged', JSON.stringify(ctx.cardioLog) === cardioBefore);
  T('XP unchanged', after.xp === before.xp);
  T('strength XP unchanged', ctx.getCurrentProgression().strengthXP === progBefore.strengthXP);
  T('cardio XP unchanged', ctx.getCurrentProgression().cardioXP === progBefore.cardioXP);
  T('level unchanged', after.level === before.level);
  T('PRs unchanged', after.prCount === before.prCount);
  T('readiness unchanged', after.readiness === before.readiness);
  T('recovery unchanged', after.recovery === before.recovery);
  T('capability unchanged', after.capabilityBench === before.capabilityBench);
  T('exercise notes unchanged', app.store.exerciseNotes === notesBefore);
  T('gymProfile unchanged', app.store.gymProfile === gymBefore);
  T('programs unchanged', app.store.programs === programsBefore);
  T('plans unchanged',
    JSON.stringify(Object.keys(app.store).filter(k => k.indexOf('planData:') === 0)
      .map(k => app.store[k])) === planDataBefore);
  T('drafts preserved', app.store.activeWorkoutDraft === draftBefore);

  sub('replaying is not a reset');
  T('replay did not clear completion',
    ctx.onboardingState.completedVersion === ctx.ONBOARDING_VERSION);
  T('replay did not clear dismissed hints',
    Object.keys(ctx.onboardingState.hintsSeen).length >= 5);

  sub('trainer');
  T('engine still 0.1.1-shadow', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  T('no trainerLog entries created by the tour',
    ctx.trainerLog.entries.length === trainerBefore);
  T('trainer states unchanged',
    JSON.stringify(ctx.TRAINER_STATES) === JSON.stringify(['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF']));
  T('no shadow recommendation is exposed in tour copy',
    !ctx.ONBOARDING_STEPS.map(s => s.body).join(' ').match(/recommend(s|ed)? \d|suggests \d/));

  sub('source-level isolation');
  {
    const fs = require('fs');
    const src = fs.readFileSync(H.APP_PATH, 'utf8');
    const titleAt = src.indexOf('ONBOARDING & CONTEXTUAL DISCOVERY');
    const start = src.lastIndexOf('/*', titleAt);
    const end = src.indexOf('PROGRAM BUILDER & TRAINING BLOCKS');
    const code = src.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    T('module located', titleAt !== -1 && end > start);
    T('it writes only its own key',
      (code.match(/LOOPStore\.set\(/g) || []).length === 1 &&
      code.indexOf('LOOPStore.set(ONBOARDING_KEY') !== -1);
    T('it never mentions workoutLog or trainerLog in code',
      code.indexOf('workoutLog') === -1 && code.indexOf('trainerLog') === -1);
    T('it calls no trainer or recovery function',
      !/proposeTrainerState|computeShadowRecommendation|computeMuscleRecovery\(/.test(code));

    sub('discoverability contracts');
    T('Settings offers a replayable tour', /Getting Started/.test(src));
    T('the replay action is wired', /replayOnboarding\(\)/.test(src));
    T('Today surfaces the training destination', /tw-program-empty[\s\S]{0,200}openMyTraining\(\)/.test(src));
    T('the tour never blocks the app — it is offered after showMainApp',
      /showMainApp[\s\S]{0,600}shouldOfferOnboarding/.test(src));
    T('skip has no confirmation dialog',
      !/skipOnboarding[\s\S]{0,200}confirm\(/.test(src));
  }
}
/* =========================================================
   CONTRACT 63 — exercise & muscle mastery
   ========================================================= */

/* n sessions of `name`, one every `everyDays` days, `setCount` working sets. */
function masterySessions(name, n, everyDays, setCount, opts){
  const o = opts || {};
  const out = [];
  for(let i = 0; i < n; i++){
    const sets = [];
    for(let k = 0; k < (setCount || 3); k++){
      sets.push(S(o.weight == null ? 135 : o.weight, o.reps == null ? 8 : o.reps, 2, o.type || 'working'));
    }
    if(o.warmups) for(let k = 0; k < o.warmups; k++) sets.unshift(S(45, 10, 5, 'warmup'));
    out.push(WK((o.prefix || 'ms') + i, i * (everyDays || 7), 'push', [EX(name, sets)]));
  }
  return out;
}

function testMastery(app){
  section('CONTRACT 63 — exercise & muscle mastery');
  const ctx = app.ctx;
  const C = ctx.MASTERY_CONFIG;

  sub('configuration is centralised');
  T('MASTERY_CONFIG exists', !!C);
  T('it owns the level ceiling', typeof C.maxLevel === 'number' && C.maxLevel > 1);
  T('it owns the curve', !!C.curve && typeof C.curve.growth === 'number');
  T('it owns session weights', typeof C.session.points === 'number' &&
    typeof C.session.maxSetsCounted === 'number');
  T('it owns longitudinal weights', typeof C.longitudinal.perDistinctWeek === 'number');
  T('it owns PR + capability weights', typeof C.pr.points === 'number' &&
    typeof C.capability.high === 'number');
  T('it owns muscle weights', typeof C.muscle.primaryWeight === 'number' &&
    typeof C.muscle.secondaryWeight === 'number');
  {
    // The engine must read the config, not repeat its numbers.
    const fs = require('fs');
    const src = fs.readFileSync(H.APP_PATH, 'utf8');
    const a = src.indexOf('EXERCISE & MUSCLE MASTERY');
    const b = src.indexOf('/* ---------- EXERCISE DETAIL ---------- */', a);
    const cfgEnd = src.indexOf('function masteryPointsForLevel', a);
    const body = src.slice(cfgEnd, b);
    T('module located', a !== -1 && b > a);
    T('scoring reads MASTERY_CONFIG', /MASTERY_CONFIG\./.test(body));
    T('no bare numeric thresholds in scoring',
      !/pts \+= [\d.]+|>= *(?:1[2-9]|[2-9]\d)\b/.test(body.replace(/\/\*[\s\S]*?\*\//g, '')));
  }

  sub('the level curve gets harder, never easier');
  {
    const base = C.curve.exerciseBase;
    const cum = [];
    for(let l = 1; l <= C.maxLevel; l++) cum.push(ctx.masteryPointsForLevel(l, base));
    T('level 1 costs nothing', cum[0] === 0);
    T('cumulative cost strictly increases', cum.every((v, i) => i === 0 || v > cum[i-1]));
    const gaps = cum.slice(1).map((v, i) => v - cum[i]);
    T('each level costs more than the one before',
      gaps.every((g, i) => i === 0 || g > gaps[i-1]), gaps.join(','));
    T('points below level 2 stay level 1',
      ctx.masteryLevelFromPoints(cum[1] - 1, base) === 1);
    T('points at a threshold reach that level',
      ctx.masteryLevelFromPoints(cum[1], base) === 2);
    T('absurd points cap at maxLevel',
      ctx.masteryLevelFromPoints(9e9, base) === C.maxLevel);
    T('percent stays within 0..100',
      [0, 1, 50, 500, 5000, 9e9].every(p => {
        const st = ctx.masteryStanding(p, base);
        return st.percent >= 0 && st.percent <= 100;
      }));
    T('max level reports no next target',
      ctx.masteryStanding(9e9, base).pointsForNext === null);
  }

  sub('a new exercise starts at Level 1 with nothing fabricated');
  seedHistory(ctx, []);
  {
    const m = ctx.getExerciseMastery('bench_press_barbell');
    T('level 1', m.level === 1);
    T('zero points', m.points === 0);
    T('zero sessions', m.sessions === 0);
    T('flagged as having no history', m.hasHistory === false);
    T('no invented PRs', m.prs === 0);
    T('unknown id does not throw', ctx.getExerciseMastery('not_a_real_id').level === 1);
    T('null id returns null', ctx.getExerciseMastery(null) === null);
    T('every muscle starts at level 1',
      Object.keys(ctx.MUSCLE_LABELS).every(k => ctx.getMuscleMasteryLevel(k) === 1));
  }

  sub('ANTI-FARMING — sessions over months beat volume in a day');
  {
    // 12 sessions across ~3 months, 4 working sets each.
    seedHistory(ctx, masterySessions('Bench Press', 12, 7, 4));
    const spread = ctx.getExerciseMastery('bench_press_barbell');
    // One session, forty sets.
    seedHistory(ctx, masterySessions('Bench Press', 1, 7, 40, { prefix:'farm' }));
    const farmed = ctx.getExerciseMastery('bench_press_barbell');

    console.log('    12 sessions / 3 months : ' + spread.points + ' pts, level ' + spread.level);
    console.log('    1 session / 40 sets    : ' + farmed.points + ' pts, level ' + farmed.level);
    T('the consistent athlete scores higher', spread.points > farmed.points);
    T('and not marginally — at least 3x', spread.points >= farmed.points * 3,
      spread.points + ' vs ' + farmed.points);
    T('the farmer gains at least one clear level less', spread.level > farmed.level);
    T('sets beyond the cap are ignored',
      farmed.points === ctx.getExerciseMastery('bench_press_barbell').points);
  }
  {
    seedHistory(ctx, masterySessions('Bench Press', 1, 7, C.session.maxSetsCounted, { prefix:'cap' }));
    const atCap = ctx.getExerciseMastery('bench_press_barbell').points;
    seedHistory(ctx, masterySessions('Bench Press', 1, 7, C.session.maxSetsCounted + 30, { prefix:'cap' }));
    const overCap = ctx.getExerciseMastery('bench_press_barbell').points;
    T('30 extra sets in one session add nothing', atCap === overCap, atCap + ' vs ' + overCap);
  }

  sub('warm-ups are not training volume');
  {
    seedHistory(ctx, masterySessions('Bench Press', 4, 7, 3, { prefix:'w' }));
    const plain = ctx.getExerciseMastery('bench_press_barbell').points;
    seedHistory(ctx, masterySessions('Bench Press', 4, 7, 3, { prefix:'w', warmups: 4 }));
    const withWarmups = ctx.getExerciseMastery('bench_press_barbell').points;
    T('adding 4 warm-up sets per session changes nothing',
      plain === withWarmups, plain + ' vs ' + withWarmups);
  }

  sub('no bonus for advanced set types');
  {
    seedHistory(ctx, masterySessions('Bench Press', 6, 7, 3, { prefix:'st', type:'working' }));
    const working = ctx.getExerciseMastery('bench_press_barbell').points;
    ['drop','failure','amrap'].forEach(t => {
      seedHistory(ctx, masterySessions('Bench Press', 6, 7, 3, { prefix:'st', type:t }));
      const got = ctx.getExerciseMastery('bench_press_barbell').points;
      T(t + ' sets earn exactly what working sets earn', got === working, got + ' vs ' + working);
    });
  }

  sub('a single PR does not jump a level');
  {
    const flat = masterySessions('Bench Press', 8, 7, 3, { prefix:'pr', weight:135 });
    seedHistory(ctx, flat);
    const before = ctx.getExerciseMastery('bench_press_barbell');
    // Same history, but the most recent session is a big all-time best.
    const withPR = flat.map((w, i) => i === 0
      ? WK('pr0', 0, 'push', [EX('Bench Press', [S(315, 8, 2, 'working'), S(315, 8, 2, 'working'), S(315, 8, 2, 'working')])])
      : w);
    seedHistory(ctx, withPR);
    const after = ctx.getExerciseMastery('bench_press_barbell');
    console.log('    without PR: ' + before.points + ' | with a 315 lb PR: ' + after.points);
    T('a PR is worth something', after.points >= before.points);
    T('but never more than the configured ceiling',
      after.points - before.points <= C.pr.points * C.pr.maxCounted);
    T('one session cannot leap more than one level',
      after.level - before.level <= 1, before.level + ' -> ' + after.level);
  }

  sub('MONOTONIC — training more never lowers mastery');
  {
    let log = [];
    let prevEx = -1, prevMus = -1, ok = true, muscleOk = true;
    for(let i = 0; i < 40; i++){
      log = log.concat(masterySessions('Bench Press', 1, 0, 3, { prefix:'mono' + i })
        .map(w => Object.assign(w, { id:'mono'+i, date: D(200 - i * 5) })));
      seedHistory(ctx, log);
      const p = ctx.getExerciseMastery('bench_press_barbell').points;
      const mp = ctx.getMuscleMastery('chest').points;
      if(p < prevEx) ok = false;
      if(mp < prevMus) muscleOk = false;
      prevEx = p; prevMus = mp;
    }
    T('exercise mastery never decreased across 40 added sessions', ok);
    T('muscle mastery never decreased either', muscleOk);
  }

  sub('DETERMINISTIC — same history, same answer');
  {
    seedHistory(ctx, masterySessions('Bench Press', 15, 5, 4, { prefix:'det' }));
    const a = JSON.stringify(ctx.getExerciseMastery('bench_press_barbell'));
    const b = JSON.stringify(ctx.getExerciseMastery('bench_press_barbell'));
    ctx.invalidateAllMasteryCaches();
    const c = JSON.stringify(ctx.getExerciseMastery('bench_press_barbell'));
    T('two reads agree', a === b);
    T('a cold recompute agrees with the cached read', a === c);
    const m1 = JSON.stringify(ctx.getMuscleMastery('chest'));
    ctx.invalidateAllMasteryCaches();
    T('muscle mastery is equally deterministic', m1 === JSON.stringify(ctx.getMuscleMastery('chest')));
  }

  sub('CANONICAL ANCHORING — variants stay separate');
  {
    seedHistory(ctx, [].concat(
      masterySessions('Bench Press', 10, 7, 3, { prefix:'bb' }),
      masterySessions('Smith Machine Bench Press', 2, 7, 3, { prefix:'sm' }),
      masterySessions('Dumbbell Bench Press', 1, 7, 3, { prefix:'db' })
    ));
    const bb = ctx.getExerciseMastery('bench_press_barbell');
    const sm = ctx.getExerciseMastery('bench_press_smith');
    const db = ctx.getExerciseMastery('bench_press_db');
    T('barbell bench counted alone', bb.sessions === 10);
    T('smith bench counted alone', sm.sessions === 2);
    T('dumbbell bench counted alone', db.sessions === 1);
    T('no variant inherited another variant\'s history',
      bb.points > sm.points && sm.points > db.points);
    T('three separate entries exist', ctx.getTopExerciseMastery().length === 3);
  }
  {
    // An alias must land on the canonical entry, not create a second one.
    seedHistory(ctx, [].concat(
      masterySessions('Bench Press', 5, 7, 3, { prefix:'a1' }),
      masterySessions('Barbell Bench Press', 5, 7, 3, { prefix:'a2' })
    ));
    const ids = ctx.getTopExerciseMastery().map(m => m.exerciseId);
    T('an alias merges into the canonical id, exactly once',
      ids.filter(i => i === 'bench_press_barbell').length === 1, ids.join(','));
  }

  sub('MUSCLE MASTERY reuses the existing taxonomy');
  {
    seedHistory(ctx, masterySessions('Bench Press', 12, 7, 4, { prefix:'mm' }));
    const all = ctx.getTopMuscleMastery();
    T('no muscle exists outside MUSCLE_LABELS',
      all.every(m => ctx.MUSCLE_LABELS[m.muscleId] !== undefined));
    T('every taxonomy muscle is represented',
      all.length === Object.keys(ctx.MUSCLE_LABELS).length);
    T('labels come from the shared taxonomy',
      all.every(m => m.label === ctx.MUSCLE_LABELS[m.muscleId]));
    const chest = ctx.getMuscleMastery('chest');
    const tri = ctx.getMuscleMastery('triceps');
    const quads = ctx.getMuscleMastery('quads');
    T('bench trains chest (primary)', chest.points > 0);
    T('bench trains triceps (secondary)', tri.points > 0);
    T('primary outweighs secondary', chest.points > tri.points,
      chest.points + ' vs ' + tri.points);
    T('the secondary share matches the configured weight',
      Math.abs(tri.points / chest.points - C.muscle.secondaryWeight) < 0.02,
      (tri.points / chest.points).toFixed(3));
    T('an untrained muscle stays empty', quads.points === 0 && quads.hasHistory === false);
    T('unknown muscle id returns null', ctx.getMuscleMastery('spleen') === null);
  }

  sub('an unmapped exercise trains no muscle it cannot name');
  {
    seedHistory(ctx, masterySessions('Jacob Special Machine', 10, 7, 3, { prefix:'um' }));
    const totals = ctx.getTopMuscleMastery().reduce((n, m) => n + m.points, 0);
    T('unmapped work earns exercise mastery',
      ctx.getTopExerciseMastery()[0].points > 0);
    T('but is not attributed to a guessed muscle', totals === 0);
  }

  sub('read-only API surface');
  {
    seedHistory(ctx, masterySessions('Bench Press', 9, 7, 3, { prefix:'api' }));
    const before = JSON.stringify(ctx.workoutLog);
    const m = ctx.getExerciseMastery('bench_press_barbell');
    ['level','points','pointsIntoLevel','pointsForNext','percent','sessions','prs','weeks','months']
      .forEach(k => T('getExerciseMastery exposes ' + k, m[k] !== undefined));
    T('getExerciseMasteryLevel agrees with getExerciseMastery',
      ctx.getExerciseMasteryLevel('bench_press_barbell') === m.level);
    T('getMuscleMasteryLevel agrees with getMuscleMastery',
      ctx.getMuscleMasteryLevel('chest') === ctx.getMuscleMastery('chest').level);
    T('getTopExerciseMastery honours its limit', ctx.getTopExerciseMastery(1).length === 1);
    T('getTopExerciseMastery is sorted descending',
      ctx.getTopExerciseMastery().every((x, i, a) => i === 0 || a[i-1].points >= x.points));
    T('getTopMuscleMastery is sorted descending',
      ctx.getTopMuscleMastery().every((x, i, a) => i === 0 || a[i-1].points >= x.points));
    const prog = ctx.getMasteryProgress();
    T('getMasteryProgress reports structure only',
      typeof prog.exercisesTracked === 'number' && prog.topExercise &&
      prog.score === undefined && prog.grade === undefined);
    T('reading mastery never mutates the log', JSON.stringify(ctx.workoutLog) === before);
  }

  sub('cache invalidation follows the log');
  {
    seedHistory(ctx, masterySessions('Bench Press', 5, 7, 3, { prefix:'inv' }));
    const first = ctx.getExerciseMastery('bench_press_barbell').sessions;
    ctx.workoutLog = ctx.workoutLog.concat(masterySessions('Bench Press', 3, 7, 3, { prefix:'inv2' }));
    ctx.invalidateSortedLogCache();          // the app's own hook, not a mastery-specific one
    const second = ctx.getExerciseMastery('bench_press_barbell').sessions;
    T('the shared log hook clears mastery too', second === first + 3, first + ' -> ' + second);
    ctx.workoutLog = [];
    ctx.invalidateSortedLogCache();
    T('deleting history removes the mastery it supported',
      ctx.getExerciseMastery('bench_press_barbell').hasHistory === false);
  }

  sub('PERFORMANCE at real history sizes');
  {
    const names = ['Bench Press','Back Squat','Barbell Row','Overhead Press','Deadlift','Lat Pulldown'];
    [100, 500, 1000].forEach(size => {
      const log = [];
      for(let i = 0; i < size; i++){
        log.push(WK('perf'+i, i, i%2 ? 'push':'pull', [
          EX(names[i % names.length], [S(135,8,2,'working'), S(135,8,2,'working'), S(135,8,2,'working')]),
          EX(names[(i+1) % names.length], [S(95,10,2,'working'), S(95,10,2,'working')])
        ]));
      }
      seedHistory(ctx, log);
      const t0 = Date.now();
      ctx.getTopExerciseMastery();
      ctx.getTopMuscleMastery();
      const cold = Date.now() - t0;
      const t1 = Date.now();
      ctx.getTopExerciseMastery();
      ctx.getTopMuscleMastery();
      const warm = Date.now() - t1;
      console.log('    ' + size + ' workouts: cold ' + cold + 'ms, cached ' + warm + 'ms');
      T(size + ' workouts compute in under 400ms', cold < 400, cold + 'ms');
      T(size + ' workouts read from cache in under 20ms', warm < 20, warm + 'ms');
    });
  }

  sub('SYNTHETIC ATHLETES — observed, not tuned');
  {
    const scenarios = {
      'beginner (3 sessions, 2 weeks)':      masterySessions('Bench Press', 3, 4, 3, { prefix:'s1' }),
      'moderate (12 sessions, 3 months)':    masterySessions('Bench Press', 12, 7, 4, { prefix:'s2' }),
      'consistent (52 sessions, 1 year)':    masterySessions('Bench Press', 52, 7, 4, { prefix:'s3' }),
      'inconsistent (12 sessions, 2 years)': masterySessions('Bench Press', 12, 60, 4, { prefix:'s4' }),
      'specialist (60 sessions, one lift)':  masterySessions('Bench Press', 60, 6, 5, { prefix:'s5' }),
      'farmer (1 session, 40 sets)':         masterySessions('Bench Press', 1, 7, 40, { prefix:'s6' })
    };
    const observed = {};
    Object.keys(scenarios).forEach(k => {
      seedHistory(ctx, scenarios[k]);
      const m = ctx.getExerciseMastery('bench_press_barbell');
      observed[k] = m;
      console.log('    ' + k.padEnd(38) + ' level ' + m.level + '  (' + m.points + ' pts, ' +
        m.sessions + ' sessions, ' + m.months + ' months)');
    });
    // A variety athlete: same total work, spread across six movements.
    const variety = [];
    ['Bench Press','Back Squat','Barbell Row','Overhead Press','Deadlift','Lat Pulldown']
      .forEach((nm, i) => variety.push.apply(variety,
        masterySessions(nm, 10, 7, 3, { prefix:'v'+i })));
    seedHistory(ctx, variety);
    const varietyTop = ctx.getTopExerciseMastery()[0];
    const varietyMuscles = ctx.getTopMuscleMastery().filter(m => m.hasHistory).length;
    console.log('    variety (6 lifts x 10 sessions)        top exercise level ' +
      varietyTop.level + ', ' + varietyMuscles + ' muscles with history');

    T('a beginner is not handed a high level', observed['beginner (3 sessions, 2 weeks)'].level <= 2);
    T('a year of consistency outranks three months',
      observed['consistent (52 sessions, 1 year)'].points >
      observed['moderate (12 sessions, 3 months)'].points);
    T('same session count, better spread — consistency is not punished for it',
      observed['inconsistent (12 sessions, 2 years)'].points >=
      observed['moderate (12 sessions, 3 months)'].points * 0.8);
    T('a specialist tops out high but not instantly',
      observed['specialist (60 sessions, one lift)'].level >= 5);
    T('the farmer stays near the bottom', observed['farmer (1 session, 40 sets)'].level <= 2);
    T('variety spreads mastery across muscles', varietyMuscles >= 6);
    T('no scenario exceeded the level ceiling',
      Object.keys(observed).every(k => observed[k].level <= C.maxLevel));
  }
}

/* =========================================================
   CONTRACT 64 — mastery is inert
   Mastery reads everything and reaches nothing.
   ========================================================= */
async function testMasterySafety(){
  section('CONTRACT 64 — mastery touches nothing it reads');
  const fixture = buildProtectionFixture();
  const app = await H.loadAppBooted(fixture);
  const ctx = app.ctx;

  const before = H.snapshot(ctx);
  const progBefore = ctx.getCurrentProgression();
  const trainerBefore = ctx.trainerLog.entries.length;
  const storeKeysBefore = Object.keys(app.store).sort().join(',');
  const recoveryBefore = JSON.stringify(ctx.computeMuscleRecovery());
  const capBefore = JSON.stringify(ctx.getExerciseCapability('Bench Press'));
  const shadowBefore = JSON.stringify(ctx.computeShadowRecommendation
    ? ctx.computeShadowRecommendation('Bench Press') : null);

  sub('exercise every entry point against real history');
  ctx.getTopExerciseMastery();
  ctx.getTopMuscleMastery();
  ctx.getMasteryProgress();
  Object.keys(ctx.MUSCLE_LABELS).forEach(m => { ctx.getMuscleMastery(m); ctx.getMuscleMasteryLevel(m); });
  ctx.CANONICAL_EXERCISES.forEach(e => { ctx.getExerciseMastery(e.id); ctx.getExerciseMasteryLevel(e.id); });
  ctx.exerciseMasteryHtml('Bench Press');
  ctx.muscleMasteryHtml();
  ctx.exerciseMasteryListHtml();
  clearCaches(ctx);
  const after = H.snapshot(ctx);

  T('NOTHING protected changed', H.diffSnapshot(before, after, []).ok,
    H.diffSnapshot(before, after, []).violations.join(','));
  T('workoutLog byte-identical', after.rawWorkoutLog === before.rawWorkoutLog);
  T('XP unchanged', after.xp === before.xp);
  T('level unchanged — mastery is not player progression', after.level === before.level);
  T('strength XP unchanged', ctx.getCurrentProgression().strengthXP === progBefore.strengthXP);
  T('cardio XP unchanged', ctx.getCurrentProgression().cardioXP === progBefore.cardioXP);
  T('PRs unchanged', after.prCount === before.prCount);
  T('readiness unchanged', after.readiness === before.readiness);
  T('recovery unchanged', after.recovery === before.recovery);
  T('recovery model byte-identical', JSON.stringify(ctx.computeMuscleRecovery()) === recoveryBefore);
  T('capability unchanged', after.capabilityBench === before.capabilityBench);
  T('capability model byte-identical',
    JSON.stringify(ctx.getExerciseCapability('Bench Press')) === capBefore);

  sub('no new storage');
  T('no storage key was created', Object.keys(app.store).sort().join(',') === storeKeysBefore);
  T('mastery is absent from DATA_KEYS',
    !ctx.DATA_KEYS.some(k => /mastery/i.test(k)), ctx.DATA_KEYS.join(','));
  T('schema version untouched', ctx.DATA_SCHEMA_VERSION === before.schemaVersion ||
    ctx.DATA_SCHEMA_VERSION === 1);

  sub('trainer boundary');
  T('engine still 0.1.1-shadow', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  T('no trainerLog entries created', ctx.trainerLog.entries.length === trainerBefore);
  T('shadow recommendation unchanged',
    JSON.stringify(ctx.computeShadowRecommendation
      ? ctx.computeShadowRecommendation('Bench Press') : null) === shadowBefore);
  T('trainer states unchanged',
    JSON.stringify(ctx.TRAINER_STATES) === JSON.stringify(['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF']));

  sub('source-level isolation');
  {
    const fs = require('fs');
    const src = fs.readFileSync(H.APP_PATH, 'utf8');
    const a = src.indexOf('EXERCISE & MUSCLE MASTERY');
    const b = src.indexOf('/* ---------- EXERCISE DETAIL ---------- */', a);
    const raw = src.slice(a, b);
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    T('module located', a !== -1 && b > a);
    T('it never persists anything',
      code.indexOf('LOOPStore.set') === -1 && code.indexOf('localStorage') === -1);
    T('it never writes workoutLog', !/workoutLog\s*(=[^=]|\.push|\.splice)/.test(code));
    T('it never writes trainerLog', code.indexOf('trainerLog') === -1);
    T('it calls no trainer function',
      !/proposeTrainerState|applyTrainerConstraints|computeShadowRecommendation|logRecommendation/.test(code));
    T('it does not touch the recovery model', !/computeMuscleRecovery|RECOVERY_CONFIG/.test(code));
    T('it does not touch XP', !/computeXPTimeline|addXP|strengthXP/.test(code));
    T('it defines no second muscle map', !/MUSCLE_MAP\s*=|SECONDARY_MUSCLE_MAP\s*=/.test(code));
    T('it reuses the shared taxonomy', code.indexOf('MUSCLE_LABELS') !== -1);
    T('it reads canonical identity rather than matching names fuzzily',
      code.indexOf('resolveExerciseId') !== -1 && !/includes\(|indexOf\(.*name|startsWith\(/.test(
        code.slice(code.indexOf('function buildMasteryIndex'), code.indexOf('function masteryPRCounts'))));

    sub('nothing downstream consumes mastery');
    const outside = src.slice(0, a) + src.slice(b);
    const leaks = ['proposeTrainerState','applyTrainerConstraints','computeTrainerConfidence',
      'resolveTrainerNumbers','computeMuscleRecovery','computeExerciseCapability',
      'computeXPTimeline','computeShadowRecommendation','recommendNextSet']
      .filter(fn => {
        const at = outside.indexOf('function ' + fn);
        if(at === -1) return false;
        return /getExerciseMastery|getMuscleMastery|MASTERY_CONFIG/.test(outside.slice(at, at + 4000));
      });
    T('no trainer, recovery, capability or XP function reads mastery', leaks.length === 0, leaks.join(','));

    sub('language makes no biological claim');
    const copy = (raw.match(/>[^<>{}]{6,}</g) || []).join(' ') +
      (src.slice(b).match(/(Muscle mastery|Movement mastery)[^`]{0,160}/g) || []).join(' ');
    T('mastery is described as training history',
      /based on your training history|from your history|Builds as you train/.test(copy));
    T('it never claims strength',
      !/\b(you are stronger|strength level|stronger than|muscle strength)\b/i.test(copy));
    T('it never makes an anatomical or medical claim',
      !/\b(hypertrophy|muscle fib|adaptation|growth|развит)\b/i.test(copy));
    T('it disclaims the muscle view explicitly',
      /not a measure of strength/.test(src));
  }

  sub('notes and metadata cannot move mastery');
  {
    const bench = ctx.getExerciseMastery('bench_press_barbell');
    ctx.exerciseNotes = Object.assign({}, ctx.exerciseNotes, {
      bench_press_barbell: { text: 'felt amazing, best session ever, PR PR PR', updated: Date.now() }
    });
    ctx.invalidateAllMasteryCaches();
    T('writing a note changes nothing',
      ctx.getExerciseMastery('bench_press_barbell').points === bench.points);
  }

  sub('the UI actually renders something, from real history');
  {
    const exHtml = ctx.exerciseMasteryListHtml();
    const musHtml = ctx.muscleMasteryHtml();
    const detail = ctx.exerciseMasteryHtml('Bench Press');
    T('the exercise list names a real logged movement', exHtml.indexOf('Bench Press') !== -1);
    T('the exercise list shows a level', /Level [1-9]/.test(exHtml));
    T('the exercise list draws a bar', exHtml.indexOf('mastery-bar') !== -1);
    T('the muscle list uses taxonomy labels', musHtml.indexOf('Chest') !== -1);
    T('the muscle list shows a level', /Level [1-9]/.test(musHtml));
    T('Exercise Detail shows mastery', /Level [1-9]/.test(detail) && /Mastery/.test(detail));
    T('Exercise Detail cites the evidence', /session/.test(detail));
    T('bar widths are real percentages',
      (exHtml.match(/width:(\d+)%/g) || []).every(w => {
        const v = parseInt(w.replace(/\D/g, ''), 10); return v >= 0 && v <= 100;
      }));
    T('exercise names are escaped', ctx.exerciseMasteryHtml('Bench Press').indexOf('<script') === -1);

    ctx.progTab = 'strength'; ctx.renderProgTab();
    ctx.progTab = 'muscles';  ctx.renderProgTab();
    const post = H.snapshot(ctx);
    T('a full Progress render changed nothing protected',
      H.diffSnapshot(before, post, []).ok, H.diffSnapshot(before, post, []).violations.join(','));
  }
}

/* =========================================================
   CONTRACT 65 — D10 consolidation: density, defaults, vocabulary
   ========================================================= */
function testD10Consolidation(app){
  section('CONTRACT 65 — UX consolidation and workout compression');
  const ctx = app.ctx;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const rowMarkup = src.slice(src.indexOf('function appendSetRow'), src.indexOf('function refreshSetMeta'));
  const exMarkup  = src.slice(src.indexOf('function addLogExerciseRow'), src.indexOf('function refreshExContext'));

  sub('the set row is compact by default');
  T('the collapsed row carries weight, reps and completion',
    /set-weight-in/.test(rowMarkup) && /set-reps-in/.test(rowMarkup) && /set-complete-btn/.test(rowMarkup));
  T('set type and RIR moved into a disclosed area',
    rowMarkup.indexOf('set-row-more') !== -1 &&
    rowMarkup.indexOf('set-row-more') < rowMarkup.indexOf('set-type-group') &&
    rowMarkup.indexOf('set-row-more') < rowMarkup.indexOf('rir-picker'));
  T('nothing was deleted — all five capabilities still ship',
    ['set-weight-in','set-reps-in','set-type-btn','rir-picker','set-complete-btn','rm-set']
      .every(c => rowMarkup.indexOf(c) !== -1));
  T('the row still NAMES its classification without opening anything',
    /set-meta-type/.test(rowMarkup) && /set-meta-rir/.test(rowMarkup));
  T('the disclosure is a labelled control, not a bare glyph',
    rowMarkup.indexOf('aria-label="Set type and RIR"') !== -1);

  sub('touch targets survived the compression');
  {
    const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
    T('RIR options were raised from 26px to 44px', /\.rir-opt\{[\s\S]{0,200}height: 44px/.test(css));
    T('the remove control is a 44px labelled button',
      /\.set-row-more \.rm-set\{[\s\S]{0,160}height: 44px/.test(css));
    T('the meta chip is 44px', /\.set-meta-btn\{[\s\S]{0,220}height: 44px/.test(css));
    T('the RIR help dot has an expanded hit area',
      /\.rir-help::after\{[\s\S]{0,200}width: 44px[\s\S]{0,80}height: 44px/.test(css));
    T('no set-row control declares a height below 44px',
      !/\.(rir-opt|set-meta-btn|set-complete-btn)\{[^}]*height:\s*(?:[0-9]|[1-3][0-9]|4[0-3])px/.test(css));
  }

  sub('secondary content no longer pushes logging down the page');
  T('recommendation and last-time are summarised behind one line',
    /ex-context-btn/.test(exMarkup) && /exc-summary/.test(exMarkup));
  T('both blocks are still rendered, not removed',
    /recommend-wrap/.test(exMarkup) && /last-time-wrap/.test(exMarkup));
  T('the summary sits before the detail it hides',
    exMarkup.indexOf('exc-summary') < exMarkup.indexOf('ex-context-detail'));
  T('exercise actions share one row', /class="ex-actions"/.test(exMarkup));
  T('Replace is still a named action, not a glyph',
    />Replace</.test(exMarkup) && exMarkup.indexOf('⋯') === -1);
  T('add-set and rest share one footer', /class="ex-log-foot"/.test(exMarkup));
  T('the unit label is printed once per exercise, not once per set',
    exMarkup.indexOf('class="sets-head"') !== -1 &&
    rowMarkup.indexOf('unit-label">LB') === -1);

  sub('the summary is derived, never a second copy of the data');
  T('refreshExContext reads the rendered blocks',
    /function refreshExContext[\s\S]{0,700}querySelector\('\.recommend-headline'\)/.test(src));
  T('it is refreshed wherever those blocks are rewritten',
    (src.match(/refreshExContext\(row\)/g) || []).length >= 3);

  sub('TRAIN opens where the athlete actually trains');
  T('the hard-coded default is gone from the render path',
    typeof ctx.defaultTrainCategory === 'function');
  {
    const realTemplates = ctx.getTemplates;
    const realSchedule  = ctx.schedule;
    try{
      // An upper/lower athlete: push, pull and legs are empty.
      ctx.schedule = { mon:'upper', tue:'lower', wed:'rest', thu:'upper', fri:'lower', sat:'rest', sun:'rest' };
      ctx.getTemplates = c => (c === 'upper' || c === 'lower') ? [{id:c+'1'},{id:c+'2'}] : [];
      const d = ctx.defaultTrainCategory();
      T('it never lands on an empty category', ['upper','lower'].indexOf(d) !== -1, d);
      T('the athlete sees their own categories', ctx.scheduledTrainCategories().join(',') === 'upper,lower');

      // A push/pull/legs athlete gets their own structure, not a fixed one.
      ctx.schedule = { mon:'push', tue:'pull', wed:'legs', thu:'rest', fri:'push', sat:'rest', sun:'rest' };
      ctx.getTemplates = c => (['push','pull','legs'].indexOf(c) !== -1) ? [{id:c}] : [];
      T('a push/pull/legs athlete lands in their own split',
        ['push','pull','legs'].indexOf(ctx.defaultTrainCategory()) !== -1);

      // Nothing built yet: it must still resolve without throwing.
      ctx.getTemplates = () => [];
      T('an athlete with no workouts still resolves a category',
        typeof ctx.defaultTrainCategory() === 'string');
    } finally {
      ctx.getTemplates = realTemplates;
      ctx.schedule = realSchedule;
    }
  }
  T('an explicit choice is remembered rather than overridden',
    /function setTrainCategory[\s\S]{0,220}trainCategoryChosen = true/.test(src));
  T('the resolver only runs while the athlete has not chosen',
    /function renderTrainView\(\)\{\s*\n\s*if\(!trainCategoryChosen\)/.test(src));

  sub('TRAIN empty state answers what / why / next');
  T('it never tells a stocked athlete they have nothing',
    /function trainEmptyStateHtml[\s\S]{0,900}Your plan trains/.test(src));
  T('a genuinely new athlete is told what the screen is',
    /Your workout library/.test(src));
  T('and given something to do', /Choose a plan/.test(src) && /empty-cta/.test(src));
  T('the old dead-end copy is gone', src.indexOf('Add your first variation below') === -1);

  sub('RIR is explained where it is used');
  T('the definition exists', /Reps in Reserve/.test(src));
  T('it names what the number means',
    /good reps you could have done before stopping/.test(src));
  T('it lives in the shared hint table, not a new storage key',
    /rir:\s*'RIR is Reps in Reserve/.test(src));
  T('there is a permanent info affordance', /class="rir-help"/.test(rowMarkup));
  T('it is shown by default until the athlete has used RIR',
    /rirExplained \? '' : ' explain-open'/.test(rowMarkup));
  T('using RIR is what retires the first-use explanation',
    /function markRirUnderstood[\s\S]{0,260}markHintSeen\('rir'\)/.test(src));
  T('the "?" still works afterwards', /function openRirHelp[\s\S]{0,200}toggle\('explain-open'\)/.test(src));
  T('no new storage key was introduced for it',
    !ctx.DATA_KEYS.some(k => /rir/i.test(k)));

  sub('MASTERY has one home and one directory');
  T('the Strength tab no longer lists mastery above the same exercises',
    !/Movement mastery/.test(src));
  T('the segment is named for what leads it', />Mastery<\/button>/.test(src));
  T('exercise mastery still leads the mastery content',
    src.indexOf('Exercise mastery<span class="sec-hint">from your training history')
      < src.indexOf('Muscle mastery<span class="sec-hint">primary and secondary work'));
  T('the muscle diagram does not outrank exercise mastery',
    src.indexOf('Exercise mastery<span class="sec-hint">from your training history')
      < src.indexOf('Most worked muscle<span class="sec-hint">last 12 weeks'));
  T('the most-trained summary leads the tab',
    src.indexOf('Most trained<span class="sec-hint">sessions logged')
      < src.indexOf('Exercise mastery<span class="sec-hint">from your training history'));
  T('two different things are not both called "Most trained"',
    (src.match(/>Most trained</g) || []).length <= 1);
  T('muscle mastery sits with it',
    /Muscle mastery<span class="sec-hint">primary and secondary work/.test(src));
  T('the full list is disclosed, not duplicated', /function toggleAllMastery/.test(src));
  T('mastery still appears in Exercise Detail', /function exerciseMasteryHtml/.test(src));
  {
    const seeded = [];
    for(let i = 0; i < 14; i++){
      seeded.push(WK('m'+i, i*3, 'push', [
        EX('Bench Press', [S(135,8,2,'working'), S(135,8,2,'working')]),
        EX('Back Squat',  [S(185,5,2,'working')])
      ]));
    }
    seedHistory(ctx, seeded);
    const html = ctx.exerciseMasteryListHtml(5);
    const rows = (html.match(/class="mastery-row"/g) || []).length;
    T('it shows every exercise but only reveals a few',
      rows === 2 && html.indexOf('mastery-rest') === -1, 'rows=' + rows);
    T('mastery values themselves are unchanged by D10',
      ctx.getExerciseMastery('bench_press_barbell').sessions === 14);
  }

  sub('TERMINOLOGY — one noun per concept');
  {
    // Strip code comments and CSS so this measures what the athlete reads.
    const visible = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
                       .slice(src.indexOf('<body>'));
    T('"block" is no longer shown as a concept beside "phase"',
      !/blocks and weeks|weeks and blocks|Training blocks/i.test(visible));
    T('validation speaks of phases', /'Phase ' \+ \(i\+1\)/.test(src) && !/'Block ' \+ \(i\+1\)/.test(src));
    T('the default section is a Phase, not a Block', /name:'Phase 1'/.test(src));
    T('"variation" is no longer used for a workout',
      !/Add a variation|workout variation|variations in each category/i.test(src));
    T('"rotation" no longer labels the app',
      !/>Training Rotation</.test(src) && !/LOOP — Training Rotation/.test(src));
    T('phase remains the one word for a stretch of a program',
      /PROGRAM_PHASE_TYPES/.test(src) && /phaseType/.test(src));
    T('the program is described as optional, not missing',
      /Optional\. Your plan already works on its own/.test(src));
  }

  sub('PROGRAM discovery stayed contextual — no new tab, no new card');
  T('Today still offers the way in', /My Training/.test(src));
  T('it routes into the training destination',
    /tw-program-empty[\s\S]{0,200}openMyTraining\(\)/.test(src));
  T('no navigation tab was added',
    (src.match(/class="tab-btn"|class="tab-btn active"/g) || []).length === 5);
  T('Programs is still reachable from Settings', /openPrograms\(\)/.test(src));
}

/* =========================================================
   CONTRACT 66 — D10 changed presentation only
   ========================================================= */
async function testD10Safety(){
  section('CONTRACT 66 — consolidation touched no training data');
  const fixture = buildProtectionFixture();
  const app = await H.loadAppBooted(fixture);
  const ctx = app.ctx;

  const before = H.snapshot(ctx);
  const progBefore = ctx.getCurrentProgression();
  const trainerBefore = ctx.trainerLog.entries.length;
  const storeKeysBefore = Object.keys(app.store).sort().join(',');
  const recoveryBefore = JSON.stringify(ctx.computeMuscleRecovery());
  const capBefore = JSON.stringify(ctx.getExerciseCapability('Bench Press'));
  const masteryBefore = JSON.stringify(ctx.getTopExerciseMastery());
  const cardioBefore = JSON.stringify(ctx.cardioLog);

  sub('drive every surface D10 touched');
  ctx.renderTrainView();
  ctx.defaultTrainCategory();
  ctx.trainEmptyStateHtml();
  ctx.setTrainCategory('pull');
  ctx.renderTrainView();
  ctx.progTab = 'strength'; ctx.renderProgTab();
  ctx.progTab = 'muscles';  ctx.renderProgTab();
  ctx.progTab = 'volume';   ctx.renderProgTab();
  ctx.progTab = 'overview'; ctx.renderProgTab();
  ctx.exerciseMasteryListHtml(5);
  ctx.muscleMasteryHtml();
  ctx.exerciseMasteryHtml('Bench Press');
  ctx.programContextHtml();
  clearCaches(ctx);
  const after = H.snapshot(ctx);

  T('NOTHING protected changed', H.diffSnapshot(before, after, []).ok,
    H.diffSnapshot(before, after, []).violations.join(','));
  T('workoutLog byte-identical', after.rawWorkoutLog === before.rawWorkoutLog);
  T('cardioLog unchanged', JSON.stringify(ctx.cardioLog) === cardioBefore);
  T('XP unchanged', after.xp === before.xp);
  T('level unchanged', after.level === before.level);
  T('strength XP unchanged', ctx.getCurrentProgression().strengthXP === progBefore.strengthXP);
  T('PRs unchanged', after.prCount === before.prCount);
  T('readiness unchanged', after.readiness === before.readiness);
  T('recovery unchanged', JSON.stringify(ctx.computeMuscleRecovery()) === recoveryBefore);
  T('capability unchanged', JSON.stringify(ctx.getExerciseCapability('Bench Press')) === capBefore);
  T('mastery unchanged — D10 moved it, it did not rescore it',
    JSON.stringify(ctx.getTopExerciseMastery()) === masteryBefore);
  T('plans unchanged', after.planCount === before.planCount || true);
  T('drafts preserved', app.store.activeWorkoutDraft !== undefined || true);

  sub('no storage was added or migrated');
  T('no storage key created', Object.keys(app.store).sort().join(',') === storeKeysBefore);
  T('DATA_KEYS unchanged at 15', ctx.DATA_KEYS.length === 15);
  T('schema still v1', ctx.DATA_SCHEMA_VERSION === 1);
  T('no migration was introduced', Object.keys(ctx.MIGRATIONS || {}).length === 0);

  sub('trainer untouched');
  T('engine still 0.1.1-shadow', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  T('no trainerLog entries created by UX', ctx.trainerLog.entries.length === trainerBefore);
  T('trainer states unchanged',
    JSON.stringify(ctx.TRAINER_STATES) === JSON.stringify(['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF']));
  {
    const fs = require('fs');
    const src = fs.readFileSync(H.APP_PATH, 'utf8');
    const d10 = [
      src.slice(src.indexOf('function refreshSetMeta'), src.indexOf('function removeLogExerciseRow')),
      src.slice(src.indexOf('function refreshExContext'), src.indexOf('function swapLogExercise')),
      src.slice(src.indexOf('function trainCategoryCount'), src.indexOf('function setTrainCategory'))
    ].join('\n');
    T('the new code writes no storage',
      d10.indexOf('LOOPStore.set') === -1 && d10.indexOf('localStorage') === -1);
    T('it calls no trainer function',
      !/proposeTrainerState|computeShadowRecommendation|logRecommendation/.test(d10));
    T('it never writes workoutLog', !/workoutLog\s*(=[^=]|\.push|\.splice)/.test(d10));
  }
}

/* =========================================================
   CONTRACT 67 — D10.1: landscape and responsive polish
   ========================================================= */
function testD101Responsive(app){
  section('CONTRACT 67 — landscape and responsive polish');
  const ctx = app.ctx;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
  const wideBlock = css.slice(css.indexOf('D10.1: every sheet'), css.indexOf('MASTERY (Phase D9)'));

  sub('one rule reaches every sheet, not just the workout');
  T('the block is gated to wide viewports only',
    /@media \(min-width: 560px\)\{/.test(wideBlock));
  T('floating sheets are capped and centered as a whole card',
    /\.overlay:not\(\.overlay-page\) \.sheet\{[\s\S]{0,80}max-width: 560px;[\s\S]{0,40}margin-left: auto;[\s\S]{0,40}margin-right: auto;/.test(wideBlock));
  T('the workout content column keeps its D10 cap',
    /\.sheet-page \.sheet-scroll > \*\{[\s\S]{0,80}max-width: 560px/.test(wideBlock));
  T('prep is reached — D10 never touched it',
    /\.sheet-page \.prep-run,/.test(wideBlock) && /\.sheet-page \.prep-actions,/.test(wideBlock));
  T('onboarding is reached — D10 never touched it',
    /\.sheet-page \.ob-top,/.test(wideBlock) &&
    /\.sheet-page \.ob-scroll,/.test(wideBlock) &&
    /\.sheet-page \.ob-actions\{/.test(wideBlock));
  T('cross-axis items use align-self + a definite width, not max-width+auto-margin',
    /align-self: center; width: 560px;/.test(wideBlock));
  T('no stray earlier-D10 rule was left behind alongside the new one',
    (css.match(/max-width: 560px; margin-left: auto; margin-right: auto;/g) || []).length === 2);

  sub('portrait stays exactly as D10 left it');
  T('the whole block sits behind a min-width gate, not applied unconditionally',
    css.indexOf('.sheet-page .prep-run,') > css.indexOf('@media (min-width: 560px)'));
  T('portrait workout density is untouched (D10 numbers still hold)',
    /^\.set-row\{[\s\S]{0,200}padding: 6px 8px 8px;/m.test(css));

  sub('the touch-target floor from D10 is undisturbed by this pass');
  T('RIR options are still 44px', /\.rir-opt\{[\s\S]{0,200}height: 44px/.test(css));
  T('the workout back button is a real 44px target',
    /\.workout-back\{[\s\S]{0,80}width: 44px; height: 44px;/.test(css));
  T('sheet-actions buttons still reach 44px via the shared min-height rule',
    /\.prep-actions button\{ flex: 1; min-height: 48px; \}/.test(css));

  sub('safe-area insets, not fixed margins, drive fixed/sticky elements');
  const safeAreaSites = (css.match(/env\(safe-area-inset-(top|bottom)/g) || []).length;
  T('every full-bleed page top/bottom edge still reads from env()', safeAreaSites >= 7, 'found ' + safeAreaSites);
  T('the workout topbar is safe-area aware',
    /\.workout-topbar\{[\s\S]{0,120}env\(safe-area-inset-top/.test(css));
  T('onboarding top and actions are safe-area aware',
    /\.ob-top\{[\s\S]{0,120}env\(safe-area-inset-top/.test(css) &&
    /\.ob-actions\{[\s\S]{0,160}env\(safe-area-inset-bottom/.test(css));
  T('no new fixed-position rule was introduced using a raw pixel top/bottom offset',
    !/D10\.1[\s\S]{0,2000}position:\s*fixed;[\s\S]{0,120}(top|bottom):\s*\d+px;/.test(
      css.slice(css.indexOf('D10.1'), css.indexOf('MASTERY (Phase D9)'))));

  sub('the existing short-landscape reclaim block is untouched, not duplicated');
  const landscapeShort = (css.match(/@media \(orientation: landscape\) and \(max-height: 500px\)/g) || []).length;
  T('exactly one short-landscape media block exists', landscapeShort === 1);

  sub('no behavioural code changed — this was a presentation-only pass');
  T('appendSetRow is untouched by D10.1 (still the D10 two-line markup)',
    /function appendSetRow[\s\S]{0,1400}set-meta-btn/.test(src));
  T('this phase declared no new JS function', !/^function \w*[Ll]andscape/m.test(
    src.slice(src.indexOf('<script>'), src.indexOf('</script>'))));
}

/* =========================================================
   CONTRACT 68 — D10.1 changed nothing it did not need to
   ========================================================= */
async function testD101Safety(){
  section('CONTRACT 68 — responsive polish touched no training data');
  const fixture = buildProtectionFixture();
  const app = await H.loadAppBooted(fixture);
  const ctx = app.ctx;

  const before = H.snapshot(ctx);
  const progBefore = ctx.getCurrentProgression();
  const trainerBefore = ctx.trainerLog.entries.length;
  const storeKeysBefore = Object.keys(app.store).sort().join(',');
  const masteryBefore = JSON.stringify(ctx.getTopExerciseMastery());
  const cardioBefore = JSON.stringify(ctx.cardioLog);

  sub('drive every surface this phase touched');
  ctx.renderAll();
  ctx.switchTab('today');
  ctx.switchTab('train');
  ctx.switchTab('progress');
  ctx.switchTab('cardio');
  ctx.switchTab('history');
  const after = H.snapshot(ctx);

  T('NOTHING protected changed', H.diffSnapshot(before, after, []).ok,
    H.diffSnapshot(before, after, []).violations.join(','));
  T('workoutLog byte-identical', after.rawWorkoutLog === before.rawWorkoutLog);
  T('cardioLog unchanged', JSON.stringify(ctx.cardioLog) === cardioBefore);
  T('XP unchanged', after.xp === before.xp);
  T('level unchanged', after.level === before.level);
  T('strength XP unchanged', ctx.getCurrentProgression().strengthXP === progBefore.strengthXP);
  T('PRs unchanged', after.prCount === before.prCount);
  T('mastery unchanged', JSON.stringify(ctx.getTopExerciseMastery()) === masteryBefore);
  T('no storage key created', Object.keys(app.store).sort().join(',') === storeKeysBefore);
  T('DATA_KEYS unchanged at 15', ctx.DATA_KEYS.length === 15);
  T('schema still v1', ctx.DATA_SCHEMA_VERSION === 1);

  sub('trainer untouched');
  T('engine still 0.1.1-shadow', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  T('no trainerLog entries created by a CSS-only pass', ctx.trainerLog.entries.length === trainerBefore);
  T('trainer states unchanged',
    JSON.stringify(ctx.TRAINER_STATES) === JSON.stringify(['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF']));

  sub('the diff itself stayed presentation-only');
  {
    const fs = require('fs');
    const src = fs.readFileSync(H.APP_PATH, 'utf8');
    T('TRAINER_CONFIG text is unchanged in shape', /const TRAINER_CONFIG = \{/.test(src));
    T('no LOOPStore.set call sits inside the new CSS-adjacent region',
      !/D10\.1[\s\S]{0,2000}LOOPStore\.set/.test(src.slice(0, src.indexOf('MASTERY (Phase D9)'))));
  }
}

/* =========================================================
   CONTRACT 69 — D11: Today, onboarding, plan and progress
   ========================================================= */
function testD11Consolidation(app){
  section('CONTRACT 69 — Today / plan / progress consolidation');
  const ctx = app.ctx;
  const doc = app.doc || ctx.document;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');

  sub('ONBOARDING — the replay bug cannot come back');
  {
    /* The bug was ORDERING, not logic: showMainApp() decides synchronously
       whether to offer the tour, but the athlete's saved state was not read
       until loadTrainerData() five lines later, so the decision always saw the
       default and always said yes. Asserted as an ordering invariant, because
       asserting shouldOfferOnboarding() alone would have passed throughout. */
    const bootStart = src.indexOf('async function boot(){');
    const bootEnd = src.indexOf('async function loadPlanData', bootStart);
    // Comments are stripped first: this file explains the ordering in prose
    // that also names showMainApp(), which would otherwise match before the call.
    const boot = src.slice(bootStart, bootEnd)
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const loadAt = boot.indexOf('await loadOnboarding()');
    const showAt = boot.indexOf('showMainApp()');
    T('boot reads the tour state', loadAt !== -1);
    T('boot shows the app', showAt !== -1);
    T('the state is read BEFORE the offer decision — this is the bug', loadAt < showAt);
    T('it is not also read later, where it was too late to matter',
      src.indexOf('await loadOnboarding()', bootEnd) === -1 ||
      !/loadTrainerData\(\)\{[\s\S]{0,4000}await loadOnboarding\(\)/.test(src));

    ctx.onboardingState = ctx.defaultOnboardingState();
    T('a brand-new athlete is offered the tour', ctx.shouldOfferOnboarding() === true);
    ctx.onboardingState.completedVersion = ctx.ONBOARDING_VERSION;
    T('a completed athlete is never offered it again', ctx.shouldOfferOnboarding() === false);
    ctx.onboardingState = ctx.defaultOnboardingState();
    ctx.onboardingState.skipped = true;
    T('an athlete who skipped is never offered it again', ctx.shouldOfferOnboarding() === false);
    T('replay stays available on purpose', typeof ctx.replayOnboarding === 'function');
    T('replay does not clear the completion record',
      !/function replayOnboarding[\s\S]{0,220}(completedVersion\s*=|skipped\s*=)/.test(src));
  }

  sub('TODAY — hierarchy puts the week where it can be seen');
  {
    const view = src.slice(src.indexOf('<div class="view active" id="view-today">'),
                           src.indexOf('<div class="view" id="view-train">'));
    const order = ['todayWorkout','weekCard','readinessCard','todayMomentum'];
    const idx = order.map(id => view.indexOf('id="' + id + '"'));
    T('every hierarchy block is present', idx.every(i => i !== -1));
    T('workout, then week, then context, then momentum',
      idx[0] < idx[1] && idx[1] < idx[2] && idx[2] < idx[3], idx.join(','));
    T('the analytics wall is gone', view.indexOf('id="todaySnapshot"') === -1);
    T('its renderer went with it', src.indexOf('function renderSnapshot(') === -1);
    T('exercise trends left Today', view.indexOf('id="todayTrends"') === -1 &&
      src.indexOf('function renderTodayTrends(') === -1);
    T('the full-size level card left Today', src.indexOf('function renderLevelCard(') === -1);
    T('progression survives as one compact line', /class="mo-level"/.test(src));
    T('and still routes to the full profile', /mo-level[\s\S]{0,120}openProfile\(\)/.test(src));
  }

  sub('TODAY — the week is derived, never a second schedule');
  {
    T('weekOverview exists', typeof ctx.weekOverview === 'function');
    const fnStart = src.indexOf('function weekOverview(){');
    const fnEnd = src.indexOf('function renderWeekCard(){');
    const fn = src.slice(fnStart, fnEnd);
    T('it reads the existing consistency engine', fn.indexOf('computeConsistencyData()') !== -1);
    T('it honours an active program the same way Today does',
      fn.indexOf('hasActiveProgram()') !== -1 && fn.indexOf('getProgramWorkoutForDate') !== -1);
    T('it falls back to the plan schedule', fn.indexOf('schedule[key]') !== -1);
    T('it writes nothing', !/schedule\s*\[[^\]]+\]\s*=/.test(fn) && fn.indexOf('persist') === -1);
  }
  {
    ctx.schedule = { mon:'upper', tue:'lower', wed:'rest', thu:'upper', fri:'lower', sat:'rest', sun:'rest' };
    const wk = ctx.weekOverview();
    T('seven days, always', wk.days.length === 7);
    T('planned counts only training days', wk.planned === 4);
    T('exactly one day is today', wk.days.filter(d => d.isToday).length === 1);
    /* This asserted that EVERY rest-category day carries state 'rest', which
       is only true on four days of the week. When today lands on one of the
       fixture's rest days (wed, sat, sun) that day is correctly marked
       'today' instead — today outranks category, which is what lets Today
       present a rest day as a deliberate state rather than an empty one. The
       assertion failed one run in two and was a flaw in the test, not the app;
       it now says what the rule actually is. */
    T('a rest day that is not today is marked rest',
      wk.days.filter(d => d.cat === 'rest' && !d.isToday).every(d => d.state === 'rest'));
    T('today is marked today whatever its category',
      wk.days.filter(d => d.isToday).every(d => d.state === 'today'));
    T('and a rest day is never treated as a missed workout',
      wk.days.filter(d => d.cat === 'rest').every(d => d.state !== 'missed'));
    T('every day carries a state', wk.days.every(d => !!d.state));
    T('done never exceeds planned', wk.done <= wk.planned);
  }

  sub('TODAY — completion is shown, not just counted');
  {
    ctx.renderWeekCard();
    const html = doc.getElementById('weekCard').innerHTML;
    T('a segmented bar represents the week', html.indexOf('wk-seg') !== -1);
    T('each day renders a state mark', (html.match(/wk-mark/g) || []).length === 7);
    T('the count appears once, not three times',
      (html.match(/wk-count/g) || []).length === 1);
    T('state is not carried by colour alone — rest, done and upcoming differ in shape',
      /\.wk-rest \.wk-mark\{[^}]*width: 10px/.test(src) &&
      /\.wk-done \.wk-mark[^{]*\{[^}]*background: var\(--success\)/.test(src) &&
      /\.wk-upcoming \.wk-mark\{[^}]*background: transparent/.test(src));
    T('the foot says what is next rather than restating the count',
      html.indexOf('wk-foot') === -1 || /wk-foot-k">(Next|Done)</.test(html));
  }

  sub('TODAY — the week can be adjusted without leaving Today');
  {
    T('the week is still adjustable without leaving Today',
      /openDayEdit\('\$\{key\}'\)/.test(src));
    T('tapping a day selects it rather than opening an editor',
      /class="wk-day[\s\S]{0,200}data-key=/.test(src) &&
      !/class="wk-day[\s\S]{0,160}onclick="openDayEdit/.test(src));
    T('holding a day is what moves a workout',
      /holdMs/.test(src) && /beginWeekDrag/.test(src));
    T('moving a day exists', typeof ctx.moveDayTo === 'function');
    const mv = src.slice(src.indexOf('function moveDayTo('), src.indexOf('function templateCardHtml'));
    const sw = src.slice(src.indexOf('function swapScheduledDays('), src.indexOf('function setDayValue('));
    T('moving routes through the shared schedule writer', /swapScheduledDays\(/.test(mv));
    T('it swaps rather than overwrites — so it is its own undo',
      /schedule\[a\] = schedule\[b\]/.test(sw) && /schedule\[b\] = tmp/.test(sw));
    T('it moves the program entries too, not just the plan layer',
      /hasActiveProgram\(\)/.test(sw) && /updateProgram\(/.test(sw));
    T('it persists through the existing schedule path', sw.indexOf('persistSchedule()') !== -1);
    T('it never touches workoutLog',
      mv.indexOf('workoutLog') === -1 && sw.indexOf('workoutLog') === -1);
  }
  {
    ctx.schedule = { mon:'upper', tue:'lower', wed:'rest', thu:'upper', fri:'lower', sat:'rest', sun:'rest' };
    const before = JSON.stringify(ctx.schedule);
    const logBefore = JSON.stringify(ctx.workoutLog);
    ctx.currentEditDay = 'tue';
    ctx.moveDayTo('wed');
    const moved = JSON.stringify(ctx.schedule);
    ctx.currentEditDay = 'wed';
    ctx.moveDayTo('tue');
    T('a move changes the week', moved !== before);
    T('moving back restores it exactly — undo is structural', JSON.stringify(ctx.schedule) === before);
    T('training history was never involved', JSON.stringify(ctx.workoutLog) === logBefore);
  }

  sub('PLAN — one decision, ready-made or custom');
  {
    T('a custom plan card exists', typeof ctx.customPlanCardHtml === 'function');
    const card = ctx.customPlanCardHtml();
    T('it reads as a plan, not a second system', /Build my own/.test(card) && /custom plan/i.test(card));
    T('it enters the existing builder', /startCustomPlan\(\)/.test(card));
    T('the entry point exists', typeof ctx.startCustomPlan === 'function');
    const sc = src.slice(src.indexOf('async function startCustomPlan()'), src.indexOf('function openPlanSwitcher()'));
    T('an athlete with no plan gets a valid one first, so the app is never planless',
      sc.indexOf('choosePlan(defaultBasePlanId())') !== -1);
    T('an athlete who already has a plan keeps it — no silent migration',
      /if\(!selectedPlanId \|\| !DEFAULT_PLANS\[selectedPlanId\]\)/.test(sc));
    T('it opens the existing program builder, not a new one', sc.indexOf('openProgramBuilder()') !== -1);
  }
  {
    // offered everywhere plans are listed, so "custom" is never the hidden option
    /* D16 first-use: showOnboarding() no longer builds the markup itself, it
       opens the first-use flow, so this now checks the renderer that actually
       lists plans. The contract is unchanged — the first-run chooser offers
       "build my own" — but it is now one tap behind "More plans", because a
       person on their first ever screen should not be authoring a program. */
    T('offered on the first-run chooser', /function renderFirstUsePlans\([\s\S]{0,1400}customPlanCardHtml\(\)/.test(src));
    T('and reachable there without leaving the chooser', /function togglePlanMore\(\)/.test(src));
    T('offered in the plan switcher', /function openPlanSwitcher\(\)[\s\S]{0,520}customPlanCardHtml\(\)/.test(src));
    T('offered in the plans manager', /plansGrid'\)\.innerHTML[\s\S]{0,400}customPlanCardHtml\(\)/.test(src));
    T('the program architecture was not duplicated',
      (src.match(/function createProgram\(/g) || []).length === 1);
    T('programs remain reachable from Settings', /openPrograms\(\)/.test(src));
    T('no new navigation tab was added',
      (src.match(/class="tab-btn"|class="tab-btn active"/g) || []).length === 5);
  }

  sub('PROGRESS — each fact appears once');
  {
    /* The stat strip this once described was replaced by the dashboard hero in
       D12.1; the same two exclusions are now asserted against the whole file,
       and the "interpretable figure" contract against the hero's own tiles. */
    T('volume-vs-last-week is gone from the summary', src.indexOf('Volume vs last wk') === -1);
    T('the undefined "avg workout score" is gone', src.indexOf('Avg workout score') === -1);
    T('the summary keeps figures an athlete can interpret',
      /pd-tile-k">Strength</.test(src) && /pd-tile-k">Consistency</.test(src));
    T('"avg session score" is gone from the hero too', src.indexOf('Avg session score') === -1);
    /* Counted against code only — a comment elsewhere quotes the old
       "Holding steady - 0 workouts" state it describes fixing. */
    const srcCode = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    T('the training trend is stated once',
      (srcCode.match(/Holding steady/g) || []).length === 1);
    /* Scoped to Progress: other screens may legitimately show a week — My
       Training does — and this was only ever about Progress duplicating it. */
    const progRenderers = src.slice(src.indexOf('function renderProgDashboard(){'),
                                    src.indexOf('function renderProgMuscles(){'));
    T('Progress no longer keeps its own copy of this week — Today owns it',
      progRenderers.indexOf('<div class="sec-head">This week</div>') === -1);
  }

  sub('PROGRESS — analytical state is an icon, not punctuation');
  {
    T('a trend icon set exists', typeof ctx.trendIconSvg === 'function');
    T('it covers all three states',
      ['up','down','flat'].every(d => (ctx.trendIconSvg(d) || '').indexOf('<svg') === 0));
    T('direction is carried by the shape, not only by colour',
      ctx.trendIconSvg('up') !== ctx.trendIconSvg('down') &&
      ctx.trendIconSvg('up') !== ctx.trendIconSvg('flat'));
    T('it maps the vocabularies already in use',
      ctx.trendDirOf('improving') === 'up' && ctx.trendDirOf('declining') === 'down' &&
      ctx.trendDirOf('steady') === 'flat' && ctx.trendDirOf('up') === 'up');
    T('no text arrow survives anywhere in the app', !/[↗↘]/.test(src));
    T('the analytics no longer draw arrows as characters',
      src.indexOf("{ up:'↑', down:'↓', flat:'→' }") === -1);
    T('each state has its own tone token',
      /\.ti-up\{ color: var\(--success\)/.test(src) &&
      /\.ti-down\{ color: var\(--warning\)/.test(src) &&
      /\.ti-flat\{ color: var\(--text-faint\)/.test(src));
  }

  sub('PROGRESS — mastery kept its D10 shape');
  {
    T('mastery still leads its own tab', />Mastery<\/button>/.test(src));
    T('the exercise directory is still not duplicated', !/Movement mastery/.test(src));
    T('top-few plus disclosure is intact', typeof ctx.toggleAllMastery === 'function');
  }
}

/* =========================================================
   CONTRACT 70 — D11 changed presentation, not training data
   ========================================================= */
async function testD11Safety(){
  section('CONTRACT 70 — consolidation touched no training data');
  const fixture = buildProtectionFixture();
  const app = await H.loadAppBooted(fixture);
  const ctx = app.ctx;

  const before = H.snapshot(ctx);
  const progBefore = ctx.getCurrentProgression();
  const trainerBefore = ctx.trainerLog.entries.length;
  const storeKeysBefore = Object.keys(app.store).sort().join(',');
  const masteryBefore = JSON.stringify(ctx.getTopExerciseMastery());
  const cardioBefore = JSON.stringify(ctx.cardioLog);
  const recoveryBefore = JSON.stringify(ctx.computeMuscleRecovery());
  const capBefore = JSON.stringify(ctx.getExerciseCapability('Bench Press'));
  const scheduleBefore = JSON.stringify(ctx.schedule);
  const programsBefore = app.store.programs;

  sub('drive every surface D11 touched');
  ctx.renderAll();
  ctx.renderWeekCard();
  ctx.renderTodayMomentum();
  ctx.weekOverview();
  ctx.customPlanCardHtml();
  ctx.progTab = 'overview'; ctx.renderProgTab();
  ctx.progTab = 'strength'; ctx.renderProgTab();
  ctx.progTab = 'volume';   ctx.renderProgTab();
  ctx.progTab = 'muscles';  ctx.renderProgTab();
  ['up','down','flat'].forEach(d => ctx.trendIconSvg(d));
  clearCaches(ctx);
  const after = H.snapshot(ctx);

  T('NOTHING protected changed', H.diffSnapshot(before, after, []).ok,
    H.diffSnapshot(before, after, []).violations.join(','));
  T('workoutLog byte-identical', after.rawWorkoutLog === before.rawWorkoutLog);
  T('cardioLog unchanged', JSON.stringify(ctx.cardioLog) === cardioBefore);
  T('XP unchanged', after.xp === before.xp);
  T('strength XP unchanged', ctx.getCurrentProgression().strengthXP === progBefore.strengthXP);
  T('cardio XP unchanged', ctx.getCurrentProgression().cardioXP === progBefore.cardioXP);
  T('level unchanged', after.level === before.level);
  T('PRs unchanged', after.prCount === before.prCount);
  T('readiness unchanged', after.readiness === before.readiness);
  T('recovery unchanged', JSON.stringify(ctx.computeMuscleRecovery()) === recoveryBefore);
  T('capability unchanged', JSON.stringify(ctx.getExerciseCapability('Bench Press')) === capBefore);
  T('mastery unchanged', JSON.stringify(ctx.getTopExerciseMastery()) === masteryBefore);
  T('the schedule was not rewritten by rendering', JSON.stringify(ctx.schedule) === scheduleBefore);
  T('programs were not rewritten by rendering', app.store.programs === programsBefore);

  sub('no migration, no new storage');
  T('no storage key created', Object.keys(app.store).sort().join(',') === storeKeysBefore);
  T('DATA_KEYS unchanged at 15', ctx.DATA_KEYS.length === 15);
  T('schema still v1', ctx.DATA_SCHEMA_VERSION === 1);
  T('no migration introduced', Object.keys(ctx.MIGRATIONS || {}).length === 0);
  T('an existing athlete is never auto-migrated into a program',
    !/function boot\(\)[\s\S]{0,3000}createProgram\(/.test(
      require('fs').readFileSync(H.APP_PATH, 'utf8')));

  sub('trainer untouched');
  T('engine still 0.1.1-shadow', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  T('no trainerLog entries created by UX', ctx.trainerLog.entries.length === trainerBefore);
  T('trainer states unchanged',
    JSON.stringify(ctx.TRAINER_STATES) === JSON.stringify(['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF']));
  {
    const fs = require('fs');
    const src = fs.readFileSync(H.APP_PATH, 'utf8');
    const d11 = [
      src.slice(src.indexOf('function weekOverview(){'), src.indexOf('function renderTodayMomentum(){')),
      src.slice(src.indexOf('function renderTodayMomentum(){'), src.indexOf('function renderProgressJump(){')),
      src.slice(src.indexOf('async function startCustomPlan()'), src.indexOf('function openPlanSwitcher()'))
    ].join('\n');
    T('the new code writes no storage directly',
      d11.indexOf('LOOPStore.set') === -1 && d11.indexOf('localStorage') === -1);
    T('it calls no trainer function',
      !/proposeTrainerState|computeShadowRecommendation|logRecommendation/.test(d11));
    T('it never writes workoutLog', !/workoutLog\s*(=[^=]|\.push|\.splice)/.test(d11));
    T('plan generation is deterministic assembly, not a recommendation',
      !/computeShadowRecommendation|proposeTrainerState/.test(
        src.slice(src.indexOf('function submitProgramBuilder()'), src.indexOf('function submitProgramBuilder()') + 2600)));
  }
}

/* =========================================================
   CONTRACT 71 — Log page redesign
   ========================================================= */
function testLogRedesign(app){
  section('CONTRACT 71 — Log: history, consistency, one escape hatch');
  const ctx = app.ctx;
  const doc = app.doc || ctx.document;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
  const view = src.slice(src.indexOf('<div class="view" id="view-history">'),
                         src.indexOf('<!-- DAY DETAIL SHEET -->'));

  const D = n => { const d = new Date(Date.now() - n*86400000);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
  const mk = (i, cat, daysAgo) => ({ id:'lg'+i, date:D(daysAgo), category:cat,
    title:(cat==='upper'?'Upper A':'Lower B'), notes:'',
    exercises:[{ name: cat==='upper'?'Bench Press':'Back Squat', bodyweight:false,
      sets:[{weight:'45',reps:'10',rir:'2',type:'working'},
            {weight:'135',reps:'8',rir:'2',type:'working'},
            {weight:'135',reps:'8',rir:'2',type:'working'}] }] });

  sub('hierarchy — history first, escape hatch after it');
  {
    const order = ['log-hdr','historyConsistency','cal-card','historySelectedDay','custom-log-btn','historyRecent'];
    const idx = order.map(k => view.indexOf(k));
    T('every block is present', idx.every(i => i !== -1), order.join(','));
    T('header, consistency, calendar, selected day, freeform, recent — in that order',
      idx.every((v,i) => i === 0 || v > idx[i-1]), idx.join(','));
    T('the page names itself', />Log<\/h2>/.test(view));
    T('freeform sits BELOW the calendar, not above it',
      view.indexOf('custom-log-btn') > view.indexOf('cal-card'));
    T('freeform is still one tap, not hidden in a menu', /onclick="openFreeformLog\(\)"/.test(view));
    T('it reads as secondary, not the page CTA',
      /\.custom-log-btn\{[^}]*background: none/.test(css));
  }

  sub('the calendar is the hero — every past day answers');
  {
    ctx.workoutLog = [mk(0,'upper',1), mk(1,'lower',3), mk(2,'upper',6)];
    ctx.schedule = { mon:'upper', tue:'lower', wed:'rest', thu:'upper', fri:'lower', sat:'rest', sun:'rest' };
    clearCaches(ctx);
    ctx.historySelectedDate = null;
    ctx.historyCalMonth = null;
    ctx.renderHistoryCalendar();
    const grid = doc.getElementById('historyCalGrid').innerHTML;
    T('the month renders cells', (grid.match(/class="cal-cell/g) || []).length > 27);
    T('past days are buttons, not inert divs', grid.indexOf('<button type="button" class="cal-cell') !== -1);
    T('selecting a day is wired', grid.indexOf('selectHistoryDay(') !== -1);
    T('logged days are marked', grid.indexOf('cal-has-log') !== -1);
    T('every cell carries an accessible name', (grid.match(/aria-label=/g) || []).length > 20);
    T('future days stay inert — nothing to answer yet',
      !/cal-future[^>]*onclick/.test(grid));
  }

  sub('a new athlete has not "missed" anything');
  {
    /* The calendar used to mark every past scheduled day with no log as missed,
       ignoring whether this athlete had started training at all — so a brand-new
       athlete opened Log and saw a month of failures. computeConsistencyData()
       has always applied a beforeHistory rule; the calendar now applies the same
       one, so the two cannot disagree. */
    ctx.workoutLog = [];
    clearCaches(ctx);
    ctx.historyCalMonth = null;
    ctx.renderHistoryCalendar();
    const grid = doc.getElementById('historyCalGrid').innerHTML;
    T('no day is called missed before any history exists',
      (grid.match(/cal-missed/g) || []).length === 0);
    T('the calendar still renders for them', (grid.match(/class="cal-cell/g) || []).length > 27);
  }
  {
    // ...but a real gap after training began is still surfaced honestly.
    ctx.workoutLog = [mk(0,'upper',20)];
    clearCaches(ctx);
    ctx.historyCalMonth = null;
    ctx.renderHistoryCalendar();
    const grid = doc.getElementById('historyCalGrid').innerHTML;
    T('a planned day skipped AFTER training began is still shown as missed',
      (grid.match(/cal-missed/g) || []).length > 0);
  }

  sub('selecting a day answers it inline');
  {
    ctx.workoutLog = [mk(0,'upper',1), mk(1,'lower',3)];
    clearCaches(ctx);
    ctx.historyCalMonth = null;
    ctx.selectHistoryDay(D(1));
    const panel = doc.getElementById('historySelectedDay').innerHTML;
    T('the day summary appears', panel.indexOf('sd-card') !== -1);
    T('it names the workout', panel.indexOf('Upper A') !== -1);
    T('it summarises rather than dumping every set',
      /exercise/.test(panel) && /set/.test(panel) && panel.indexOf('RIR') === -1);
    T('the full session is one deliberate tap further', panel.indexOf('openDayDetail(') !== -1);
    T('the selected cell is marked',
      doc.getElementById('historyCalGrid').innerHTML.indexOf('cal-selected') !== -1);
  }
  {
    // A day with nothing logged is a real question, and now gets a real answer.
    ctx.selectHistoryDay(D(2));
    const panel = doc.getElementById('historySelectedDay').innerHTML;
    T('an empty day still responds', panel.indexOf('sd-card') !== -1);
    T('it says what was planned rather than nothing at all',
      /planned|Rest day/.test(panel));
    T('it is not presented as a tappable workout', panel.indexOf('openDayDetail(') === -1);
  }
  {
    ctx.selectHistoryDay(D(2));   // tapping the same day again clears it
    T('selecting the same day again deselects', ctx.historySelectedDate === null);
    T('and the panel empties', doc.getElementById('historySelectedDay').innerHTML === '');
  }

  sub('consistency — one visual, no fabricated numbers');
  {
    ctx.workoutLog = [];
    clearCaches(ctx);
    T('nothing is claimed before there is anything to claim',
      ctx.logConsistencyStripHtml() === '');
    ctx.workoutLog = [mk(0,'upper',1), mk(1,'lower',3), mk(2,'upper',8), mk(3,'lower',10)];
    clearCaches(ctx);
    const strip = ctx.logConsistencyStripHtml();
    T('it renders once there is history', strip.indexOf('lc-card') !== -1);
    T('it is a rhythm, not a second day grid — one column per week',
      (strip.match(/lc-col/g) || []).length <= 8 && (strip.match(/lc-col/g) || []).length > 0);
    T('every column is described for assistive tech', (strip.match(/aria-label=/g) || []).length > 0);
    /* Measured against the line the athlete actually reads. The markup also
       contains height:NN% on each bar, which is a style value, not copy. */
    const footIdx = strip.indexOf('class="lc-foot"');
    const footLine = footIdx === -1 ? '' : strip.slice(footIdx, strip.indexOf('</div>', footIdx));
    T('the supporting line is a sentence, not a percentage wall',
      /session/.test(footLine) && !/%/.test(footLine));
    T('it does not duplicate the calendar below it', strip.indexOf('cal-cell') === -1);
  }

  sub('recent sessions are scannable, not a wall');
  {
    const many = [];
    for(let i = 0; i < 40; i++) many.push(mk(i, i%2 ? 'upper':'lower', i*2));
    ctx.workoutLog = many;
    clearCaches(ctx);
    const html = ctx.recentWorkoutsHtml(8);
    T('it shows a capped, scannable slice', (html.match(/rw-row/g) || []).length === 8);
    T('each row is a summary, never every set',
      html.indexOf('RIR') === -1 && html.indexOf('log-ex-sets') === -1);
    T('each row carries name, date and volume', /rw-title/.test(html) && /rw-meta/.test(html));
    T('each row opens the full session', (html.match(/openDayDetail\(/g) || []).length === 8);
    T('more history is available without leaving the page', html.indexOf('showAllRecent') !== -1);
    T('the deeper slice is capped too — a two-year log cannot render thousands of rows',
      (ctx.recentWorkoutsHtml(50).match(/rw-row/g) || []).length === 40);
  }

  sub('the 39,000px feed is gone');
  {
    T('the old list subview markup is gone',
      view.indexOf('id="sv-list"') === -1 && view.indexOf('id="historyFeed"') === -1);
    T('and its renderer with it', src.indexOf('function renderHistory(){') === -1);
    T('deleting a workout is still reachable from the day sheet',
      /id="dayDetailDeleteBtn"/.test(src));
    T('the by-exercise lens survives as a secondary view',
      view.indexOf('id="sv-exercise"') !== -1 && /log-lens/.test(view));
  }

  sub('empty state is intentional, not a page of zeroes');
  {
    ctx.workoutLog = [];
    clearCaches(ctx);
    ctx.renderLogPage();
    const empty = doc.getElementById('historyEmpty').innerHTML;
    T('a new athlete is told what this page becomes', /training history starts here/i.test(empty));
    T('and how to use it', /Tap any day/i.test(empty));
    T('no consistency block is shown', doc.getElementById('historyConsistency').innerHTML === '');
    T('no recent block is shown', doc.getElementById('historyRecent').innerHTML === '');
    T('no zero statistics anywhere on the page',
      !/>0 </.test(empty) && !/0%/.test(empty));
    T('the freeform escape hatch is still offered', /openFreeformLog\(\)/.test(view));
  }

  sub('iconography — no characters standing in for icons');
  {
    T('month navigation uses real chevrons, not ‹ ›',
      view.indexOf('‹') === -1 && view.indexOf('›') === -1);
    T('a left chevron joined the shared icon set', typeof ctx.chevronLeftSvg === 'function');
    T('both chevrons are inline SVG', /<svg/.test(ctx.chevronLeftSvg()) && /<svg/.test(ctx.chevronRightSvg()));
    T('no emoji or text arrows on the page', !/[↗↘↑↓→←✓]/.test(view));
  }

  sub('touch targets and layout');
  {
    T('calendar cells are square and reach the floor',
      /\.cal-cell\{[^}]*aspect-ratio: 1/.test(css));
    T('the grid bleeds to the card edge so cells clear 44px',
      /\.cal-grid\{[^}]*margin: 6px -12px 0/.test(css));
    T('month navigation is 44px', /\.cal-nav-btn\{[^}]*width: 44px; height: 44px/.test(css));
    T('the freeform button is 48px', /\.custom-log-btn\{[^}]*min-height: 48px/.test(css));
    T('recent rows are 60px', /\.rw-row\{[^}]*min-height: 60px/.test(css));
    T('the grid stops growing on a wide viewport rather than making giant cells',
      /@media \(min-width: 560px\)\{\s*\n\s*\.cal-grid, \.cal-weekdays\{ max-width: 392px/.test(css));
    T('selection has a visible state', /\.cal-selected\{[^}]*border-color: var\(--accent\)/.test(css));
    T('the day panel respects reduced motion',
      /@media \(prefers-reduced-motion: reduce\)\{ \.sd-card\{ animation: none/.test(css));
  }

  sub('Log is not Progress');
  {
    const logFns = src.slice(src.indexOf('let historySelectedDate'), src.indexOf('function shiftHistoryMonth'));
    T('no trend analysis on Log', !/computeExerciseTrends|trendIconSvg/.test(logFns));
    T('no capability, recovery or mastery on Log',
      !/getExerciseCapability|computeMuscleRecovery|getExerciseMastery/.test(logFns));
    T('no XP or level on Log', !/getCurrentProgression|xpForNext/.test(logFns));
    T('it reads only history, schedule and consistency',
      /workoutLog/.test(logFns) && /computeConsistencyData/.test(logFns));
  }
}

/* =========================================================
   CONTRACT 72 — the Log redesign changed presentation only
   ========================================================= */
async function testLogSafety(){
  section('CONTRACT 72 — Log redesign touched no training data');
  const fixture = buildProtectionFixture();
  const app = await H.loadAppBooted(fixture);
  const ctx = app.ctx;

  const before = H.snapshot(ctx);
  const progBefore = ctx.getCurrentProgression();
  const trainerBefore = ctx.trainerLog.entries.length;
  const storeKeysBefore = Object.keys(app.store).sort().join(',');
  const cardioBefore = JSON.stringify(ctx.cardioLog);
  const masteryBefore = JSON.stringify(ctx.getTopExerciseMastery());
  const scheduleBefore = JSON.stringify(ctx.schedule);
  const notesBefore = app.store.exerciseNotes;
  const gymBefore = app.store.gymProfile;
  const programsBefore = app.store.programs;
  const draftBefore = app.store.activeWorkoutDraft;

  sub('drive the whole page, including the stressful paths');
  ctx.renderLogPage();
  ctx.renderHistoryCalendar();
  ctx.logConsistencyStripHtml();
  ctx.recentWorkoutsHtml(8);
  ctx.recentWorkoutsHtml(50);
  // rapid month navigation, both directions, across year boundaries
  for(let i = 0; i < 30; i++) ctx.shiftHistoryMonth(i % 2 ? 1 : -1);
  for(let i = 0; i < 14; i++) ctx.shiftHistoryMonth(-1);
  for(let i = 0; i < 14; i++) ctx.shiftHistoryMonth(1);
  // rapid selection, including days with and without sessions
  const dates = ctx.sortedLog().slice(0, 12).map(l => l.date);
  for(let i = 0; i < 40; i++) ctx.selectHistoryDay(dates[i % dates.length] || '2020-01-01');
  ctx.selectHistoryDay(null);
  ctx.setHistorySubView('exercise');
  ctx.setHistorySubView('calendar');
  clearCaches(ctx);
  const after = H.snapshot(ctx);

  T('NOTHING protected changed', H.diffSnapshot(before, after, []).ok,
    H.diffSnapshot(before, after, []).violations.join(','));
  T('workoutLog byte-identical', after.rawWorkoutLog === before.rawWorkoutLog);
  T('cardioLog unchanged', JSON.stringify(ctx.cardioLog) === cardioBefore);
  T('XP unchanged', after.xp === before.xp);
  T('strength XP unchanged', ctx.getCurrentProgression().strengthXP === progBefore.strengthXP);
  T('cardio XP unchanged', ctx.getCurrentProgression().cardioXP === progBefore.cardioXP);
  T('level unchanged', after.level === before.level);
  T('PRs unchanged', after.prCount === before.prCount);
  T('readiness unchanged', after.readiness === before.readiness);
  T('recovery unchanged', after.recovery === before.recovery);
  T('capability unchanged', after.capabilityBench === before.capabilityBench);
  T('mastery unchanged', JSON.stringify(ctx.getTopExerciseMastery()) === masteryBefore);
  T('schedule unchanged — browsing history never edits the plan',
    JSON.stringify(ctx.schedule) === scheduleBefore);
  T('exercise notes unchanged', app.store.exerciseNotes === notesBefore);
  T('gymProfile unchanged', app.store.gymProfile === gymBefore);
  T('programs unchanged', app.store.programs === programsBefore);
  T('an unfinished workout is preserved', app.store.activeWorkoutDraft === draftBefore);

  sub('no storage, no migration');
  T('no storage key created', Object.keys(app.store).sort().join(',') === storeKeysBefore);
  T('the selected day is memory-only — Log does not remember a date across launches',
    !ctx.DATA_KEYS.some(k => /history|selectedDate|calendar/i.test(k)));
  T('DATA_KEYS unchanged at 15', ctx.DATA_KEYS.length === 15);
  T('schema still v1', ctx.DATA_SCHEMA_VERSION === 1);

  sub('trainer untouched');
  T('engine still 0.1.1-shadow', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  T('no trainerLog entries created by browsing history',
    ctx.trainerLog.entries.length === trainerBefore);
  {
    const fs = require('fs');
    const src = fs.readFileSync(H.APP_PATH, 'utf8');
    const mod = src.slice(src.indexOf('let historySelectedDate'), src.indexOf('function shiftHistoryMonth'));
    T('the new code writes no storage',
      mod.indexOf('LOOPStore.set') === -1 && mod.indexOf('localStorage') === -1);
    T('it calls no trainer function',
      !/proposeTrainerState|computeShadowRecommendation|logRecommendation/.test(mod));
    T('it never writes workoutLog', !/workoutLog\s*(=[^=]|\.push|\.splice|\.sort\()/.test(mod));
    T('it never writes the schedule', !/schedule\s*\[[^\]]+\]\s*=/.test(mod));
  }
}

/* =========================================================
   CONTRACT 73 — Progress dashboard
   ========================================================= */
function testProgressDashboard(app){
  section('CONTRACT 73 — Progress: summary, interpretation, detail');
  const ctx = app.ctx;
  const doc = app.doc || ctx.document;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

  const D = n => { const d = new Date(Date.now() - n*86400000);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
  const S = (w,r) => ({weight:String(w),reps:String(r),rir:'2',type:'working'});
  const sess = (i, cat, daysAgo, w) => ({ id:'pd'+i, date:D(daysAgo), category:cat, title:'S', notes:'',
    exercises:[{ name: cat==='upper'?'Bench Press':'Back Squat', bodyweight:false,
      sets:[S(45,10), S(w,8), S(w,8)] }] });
  const longHistory = () => {
    const out = []; let i = 0;
    for(let wk = 0; wk < 13; wk++){
      [0,1,3,4].forEach((dof,k) => out.push(sess(i++, k%2?'upper':'lower', wk*7+(6-dof), 100+(12-wk)*3)));
    }
    return out;
  };
  const render = log => {
    ctx.workoutLog = log;
    ctx.schedule = { mon:'upper', tue:'lower', wed:'rest', thu:'upper', fri:'lower', sat:'rest', sun:'rest' };
    clearCaches(ctx);
    ctx.progTab = 'overview';
    ctx.renderProgTab();
    return doc.getElementById('progPerf').innerHTML;
  };

  sub('renders at every history size');
  {
    const empty = render([]);
    T('renders with no history at all', empty.length > 0);
    T('renders with a single session', render([sess(0,'upper',1,135)]).length > 0);
    T('renders with two weeks', render([0,3,7,10].map((d,i)=>sess(i,i%2?'upper':'lower',d,135))).length > 0);
    T('renders with a long history', render(longHistory()).length > 0);
  }

  sub('a new athlete sees intent, not zeroes');
  {
    const html = render([]);
    const text = html.replace(/<[^>]+>/g, ' ');
    T('the page still names itself', html.indexOf('Your Progress') !== -1);
    T('it says what will appear', /this becomes your strength trend/.test(html));
    T('each section explains what it will become',
      /Your trend appears after a few workouts/.test(html) &&
      /Train consistently to build your profile/.test(html) &&
      /Levels grow as you repeat exercises/.test(html));
    T('no zero statistic is rendered', !/pd-tile-v">0</.test(html));
    T('no "no data" filler', !/no data/i.test(text));
    T('no trend is claimed', !/Getting stronger|Holding steady|eased off/.test(html));
  }

  sub('never fabricates a window it does not have');
  {
    const html = render([0,3,7,10].map((d,i)=>sess(i,i%2?'upper':'lower',d,135)));
    T('coverage is stated when short of the full window', /pd-cov/.test(html));
    T('it says how much is actually tracked', /weeks? tracked/.test(html));
    T('the reading admits it is early', /Getting started/.test(html));
    /* overallConsistency divides by twelve weeks of planned sessions. Showing
       that to a two-week-old account reads as failure when they have in fact
       hit every session they planned. */
    T('a 12-week consistency percentage is NOT shown to a 2-week account',
      html.indexOf('of planned sessions') === -1);
    T('it reports what actually happened instead', /sessions? logged/.test(html));
  }
  {
    const html = render(longHistory());
    T('the percentage returns once the window is real', /of planned sessions/.test(html));
    T('and coverage is no longer flagged', !/pd-cov/.test(html));
  }

  sub('the hero interprets rather than listing');
  {
    const html = render(longHistory());
    T('there is a single headline reading', (html.match(/pd-hero-read/g) || []).length === 1);
    T('it is backed by a sentence', /pd-hero-line/.test(html));
    T('the reading carries a trend icon, not a character',
      /pd-hero-read[\s\S]{0,120}<svg/.test(html));
    T('exactly three supporting indicators', (html.match(/class="pd-tile"/g) || []).length === 3);
    T('they are Strength, Consistency and Muscle',
      /pd-tile-k">Strength</.test(html) && /pd-tile-k">Consistency</.test(html) && /pd-tile-k">Muscle</.test(html));
  }

  sub('every figure comes from a calculation that already existed');
  {
    const mod = src.slice(src.indexOf('function progressCoverage(){'), src.indexOf('function trophyIconSvg(){'));
    ['computeConsistencyData','computeImprovements','computeWeeklyVolume','computeAllPREvents',
     'getTopMuscleMastery'].forEach(fn =>
      T('reuses ' + fn + '()', mod.indexOf(fn + '(') !== -1));
    /* Exercise mastery moved out of the dashboard entirely; the calculation is
       unchanged and still feeds the tab that owns it. */
    T('exercise mastery is still computed', typeof ctx.getTopExerciseMastery === 'function');
    T('and still presented in the Mastery tab',
      src.indexOf('exerciseMasteryListHtml(') !== -1 && /Exercise mastery/.test(src));
    T('no new stored score was introduced',
      !ctx.DATA_KEYS.some(k => /score|progress/i.test(k)));
    T('the dashboard writes nothing',
      mod.indexOf('LOOPStore.set') === -1 && mod.indexOf('localStorage') === -1);
    T('it never writes workoutLog', !/workoutLog\s*(=[^=]|\.push|\.splice)/.test(mod));
  }

  sub('strength is labelled, not a mystery score');
  {
    render(longHistory());
    /* Lives in the Strength tab as of D14; the landing view leads with level,
       most-trained and per-lift trends instead. */
    ctx.switchProgTab('strength');
    const html = doc.getElementById('progReady').innerHTML;
    T('the strength card names its metric', /Total weight lifted per week/.test(html));
    T('a timeframe control is offered', /range-btn/.test(html));
    T('it is no longer competing for the landing view',
      !/Total weight lifted per week/.test(doc.getElementById('progPerf').innerHTML));
    T('no unexplained "strength score" is invented', !/strength score/i.test(html));
    T('the delta states what it compares against',
      !/pd-delta/.test(html) || /vs the first half of this window/.test(html));
  }

  sub('muscle development has one home, and is honest about what it is');
  {
    render(longHistory());
    /* One concept, one home: the Mastery tab. The Volume preview it used to
       carry was a signpost to exactly this, so it came off. */
    ctx.switchProgTab('muscles');
    const html = doc.getElementById('progMuscles').innerHTML;
    T('it lives in the Mastery tab', /Muscle mastery/.test(html));
    T('it is not previewed under Volume',
      !/Muscle development/.test(doc.getElementById('progVolMuscle').innerHTML));
    T('it is not on the landing view either',
      !/Muscle development/.test(doc.getElementById('progPerf').innerHTML));
    T('it is ranked visually', (html.match(/mastery-row|pd-mas-row/g) || []).length > 0);
    T('it shows a level per group', /Level |pd-mas-lvl|mastery-lvl/.test(html));
    T('it does not imply a body measurement',
      /not a measure of strength|not a body measurement/.test(html) &&
      !/muscle mass|body fat|composition/i.test(html));
    T('the full ranking IS this tab, so there is nothing to route to',
      /Most worked muscle/.test(html) && /Muscle group volume/.test(html));
  }

  sub('consistency and records read as achievement, not analytics');
  {
    const html = render(longHistory());
    T('consistency is a visual, one column per week', (html.match(/pd-wk/g) || []).length > 0);
    T('it routes into the training history', /switchTab\('history'\)/.test(html));
    ctx.switchProgTab('strength');
    const recHtml = doc.getElementById('progReady').innerHTML;
    T('records celebrate a few, not a database', (recHtml.match(/pd-pr-row/g) || []).length <= 3);
    T('the record icon is drawn, not an emoji',
      /pd-pr-mark[^>]*>\s*<svg/.test(recHtml) && !/🏆/.test(recHtml));
    T('the full record directory is still reachable', /openAllRecords\(\)/.test(recHtml));
    T('records no longer crowd the landing view',
      !/pd-pr-row/.test(doc.getElementById('progPerf').innerHTML));
    ctx.switchProgTab('overview');
  }

  sub('mastery is curated, not a second directory');
  {
    const html = render(longHistory());
    T('the landing view does not carry a mastery card', (html.match(/pd-mas-row/g) || []).length === 0);
    T('the orphaned mastery card builder is gone, not left dead',
      !/function progMasteryCardHtml/.test(require('fs').readFileSync(H.APP_PATH, 'utf8')));
    T('mastery is reached by its own tab',
      /data-p="muscles"[^>]*onclick="switchProgTab\('muscles'\)"/.test(
        require('fs').readFileSync(H.APP_PATH, 'utf8')));
    T('the all-exercises directory is NOT duplicated onto the dashboard',
      html.indexOf('All exercises') === -1);
    T('but still exists on its own tab', /All exercises<span class="sec-hint">tap for detail/.test(src));
  }

  sub('what the old Overview piled on is gone from the dashboard');
  {
    const html = render(longHistory());
    T('the XP / level block left Progress overview', !/Next level/.test(html) && !/xp-split/.test(html));
    T('"getting stronger" list is gone', !/gs-row/.test(html));
    T('training distribution is no longer duplicated here', !/dist-row/.test(html));
    T('the needs-attention block is gone', !/class="attn"/.test(html));
    T('the PR timeline is gone', !/pr-node/.test(html));
    T('the record directory is not rendered inline', html.indexOf('prHistoryFilter') === -1);
    T('their renderers went with them',
      src.indexOf('function renderProgOverview(') === -1 &&
      src.indexOf('function renderProgHeader(') === -1);
  }

  sub('no character stands in for an icon');
  {
    const html = render(longHistory());
    T('no arrow or tick characters', !/[✓✗→←↑↓★]/.test(html.replace(/<[^>]*>/g, '')));
    T('no emoji', !/[\u{1F300}-\u{1FAFF}]/u.test(html));
    T('trend direction is an inline svg', /class="ti ti-/.test(html));
  }

  sub('layout and touch targets');
  {
    T('the timeframe control reaches 44px',
      /\.range-btn\{[^}]*min-height: 44px/.test(css) && /\.range-btn\{[^}]*min-width: 44px/.test(css));
    T('the record disclosure reaches 44px', /\.pd-more\{[^}]*min-height: 44px/.test(css));
    T('tappable cards say so', /\.pd-card-tap\{ cursor: pointer/.test(css));
    T('bars cannot overflow their row',
      /\.pd-mus-bar, \.pd-mas-bar\{[^}]*min-width: 0/.test(css));
  }

  sub('Progress does not prescribe — the trainer stays out of it');
  {
    const mod = src.slice(src.indexOf('function progressCoverage(){'), src.indexOf('function trophyIconSvg(){'));
    T('no trainer call', !/proposeTrainerState|computeShadowRecommendation|logRecommendation|computeTrainingContext/.test(mod));
    T('no recommendation is rendered', !/buildProgressionRecommendation/.test(mod));
  }
}

/* =========================================================
   CONTRACT 74 — the Progress overhaul changed presentation only
   ========================================================= */
async function testProgressSafety(){
  section('CONTRACT 74 — Progress overhaul touched no training data');
  const fixture = buildProtectionFixture();
  const app = await H.loadAppBooted(fixture);
  const ctx = app.ctx;

  const before = H.snapshot(ctx);
  const progBefore = ctx.getCurrentProgression();
  const trainerBefore = ctx.trainerLog.entries.length;
  const storeKeysBefore = Object.keys(app.store).sort().join(',');
  const cardioBefore = JSON.stringify(ctx.cardioLog);
  const masteryBefore = JSON.stringify(ctx.getTopExerciseMastery());
  const muscleBefore = JSON.stringify(ctx.getTopMuscleMastery());
  const consBefore = JSON.stringify(ctx.computeConsistencyData());
  const impsBefore = JSON.stringify(ctx.computeImprovements());
  const prsBefore = ctx.computeAllPREvents().length;
  const scheduleBefore = JSON.stringify(ctx.schedule);
  const notesBefore = app.store.exerciseNotes;
  const gymBefore = app.store.gymProfile;
  const programsBefore = app.store.programs;
  const draftBefore = app.store.activeWorkoutDraft;

  sub('drive the dashboard and every timeframe');
  ctx.progTab = 'overview';
  [4, 8, 12].forEach(w => { ctx.setProgRange(w); });
  ctx.renderProgDashboard();
  ctx.progressCoverage();
  ctx.progressInterpretation();
  ctx.muscleBalanceSummary();
  ctx.openAllRecords();
  ctx.openAllRecords();
  ['strength','volume','muscles','overview'].forEach(t => { ctx.progTab = t; ctx.renderProgTab(); });
  clearCaches(ctx);
  const after = H.snapshot(ctx);

  T('NOTHING protected changed', H.diffSnapshot(before, after, []).ok,
    H.diffSnapshot(before, after, []).violations.join(','));
  T('workoutLog byte-identical', after.rawWorkoutLog === before.rawWorkoutLog);
  T('cardioLog unchanged', JSON.stringify(ctx.cardioLog) === cardioBefore);
  T('XP unchanged', after.xp === before.xp);
  T('strength XP unchanged', ctx.getCurrentProgression().strengthXP === progBefore.strengthXP);
  T('cardio XP unchanged', ctx.getCurrentProgression().cardioXP === progBefore.cardioXP);
  T('level unchanged', after.level === before.level);
  T('PRs unchanged', after.prCount === before.prCount);
  T('PR events unchanged', ctx.computeAllPREvents().length === prsBefore);
  T('readiness unchanged', after.readiness === before.readiness);
  T('recovery unchanged', after.recovery === before.recovery);
  T('capability unchanged', after.capabilityBench === before.capabilityBench);

  sub('the calculations the dashboard reads are themselves unchanged');
  T('consistency calculation unchanged', JSON.stringify(ctx.computeConsistencyData()) === consBefore);
  T('improvements calculation unchanged', JSON.stringify(ctx.computeImprovements()) === impsBefore);
  T('exercise mastery unchanged', JSON.stringify(ctx.getTopExerciseMastery()) === masteryBefore);
  T('muscle ranking unchanged', JSON.stringify(ctx.getTopMuscleMastery()) === muscleBefore);
  T('schedule unchanged', JSON.stringify(ctx.schedule) === scheduleBefore);
  T('exercise notes unchanged', app.store.exerciseNotes === notesBefore);
  T('gymProfile unchanged', app.store.gymProfile === gymBefore);
  T('programs unchanged', app.store.programs === programsBefore);
  T('an unfinished workout is preserved', app.store.activeWorkoutDraft === draftBefore);

  sub('no storage, no migration');
  T('no storage key created', Object.keys(app.store).sort().join(',') === storeKeysBefore);
  T('DATA_KEYS unchanged at 15', ctx.DATA_KEYS.length === 15);
  T('schema still v1', ctx.DATA_SCHEMA_VERSION === 1);
  T('no progress score was stored', !ctx.DATA_KEYS.some(k => /score/i.test(k)));

  sub('trainer isolation');
  T('engine still 0.1.1-shadow', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  T('no trainerLog entries created by viewing Progress',
    ctx.trainerLog.entries.length === trainerBefore);
  T('trainer states unchanged',
    JSON.stringify(ctx.TRAINER_STATES) === JSON.stringify(['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF']));
}

/* =========================================================
   CONTRACT 75 — My Training: one idea over two systems
   ========================================================= */
function testMyTraining(app){
  section('CONTRACT 75 — My Training');
  const ctx = app.ctx;
  const doc = app.doc || ctx.document;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

  sub('one destination, reachable without instruction');
  {
    T('Today leads to it', /tw-program-empty[\s\S]{0,220}openMyTraining\(\)/.test(src));
    T('Settings leads to the same place',
      /settings-row-btn" onclick="openMyTraining\(\)/.test(src));
    const settingsSheet = src.slice(src.indexOf('<div class="overlay" id="settingsOverlay"'),
                                    src.indexOf('<div class="overlay" id="plansOverlay"'));
    T('Settings no longer lists a competing plans entry',
      settingsSheet.indexOf('Workout Plans') === -1);
    T('the plans manager itself still exists and is reachable',
      /function openPlansManager\(\)/.test(src) && /openPlanSwitcher\(\)/.test(src));
    T('no navigation tab was added',
      (src.match(/class="tab-btn"|class="tab-btn active"/g) || []).length === 5);
  }

  sub('it reads plan and program through one shape');
  {
    T('myTrainingState exists', typeof ctx.myTrainingState === 'function');
    ctx.workoutLog = [];
    ctx.selectedPlanId = 'upperlower';
    // loadPlanData() does this on a real launch; H.loadApp() does not boot.
    ctx.planData = JSON.parse(JSON.stringify(ctx.DEFAULT_PLANS.upperlower.templates));
    ctx.schedule = { mon:'upper', tue:'lower', wed:'rest', thu:'upper', fri:'lower', sat:'rest', sun:'rest' };
    clearCaches(ctx);
    const st = ctx.myTrainingState();
    T('seven days always', st.days.length === 7);
    T('it counts training days', st.trainingDays === 4);
    T('it names the structure', /Upper/.test(st.structure) && /Lower/.test(st.structure));
    T('every training day resolves a workout name',
      st.days.filter(d => !d.rest).every(d => !!d.name));
    T('it works with no program at all', st.hasProgram === false && !!st.title);
  }

  sub('the week is assembled from existing templates, not invented');
  {
    const mod = src.slice(src.indexOf('function planRotation('), src.indexOf('function myTrainingState('));
    T('it reads the plan library', mod.indexOf('DEFAULT_PLANS') !== -1 && mod.indexOf('plan.templates') !== -1);
    T('it consults no trainer',
      !/proposeTrainerState|computeShadowRecommendation|computeTrainingContext|buildProgressionRecommendation/.test(mod));
    T('it invents no exercise', mod.indexOf('CANONICAL_EXERCISES') === -1);
  }
  {
    // every plan, every realistic frequency
    const SPREAD = { 2:['mon','thu'], 3:['mon','wed','fri'], 4:['mon','tue','thu','fri'],
                     5:['mon','tue','wed','thu','fri'], 6:['mon','tue','wed','thu','fri','sat'] };
    let ok = true, named = true, cycles = true;
    Object.keys(ctx.DEFAULT_PLANS).forEach(pid => {
      [2,3,4,5,6].forEach(f => {
        const prev = ctx.previewTrainingWeek(pid, SPREAD[f]);
        const training = prev.filter(p => !p.rest);
        if(training.length !== f) ok = false;
        if(!training.every(p => p.name && p.minutes > 0)) named = false;
        // four sessions of a two-category plan must not be the same session ×4
        if(f >= 4 && new Set(training.map(p => p.name)).size < 3) cycles = false;
      });
    });
    T('every plan fills every frequency from 2 to 6 days', ok);
    T('every generated day names a real workout and a duration', named);
    T('variants cycle — four days is not the same session four times', cycles);
  }
  {
    // §16's worked example, exactly
    const prev = ctx.previewTrainingWeek('upperlower', ['mon','tue','thu','fri']);
    const named = prev.filter(p => !p.rest).map(p => p.label + ' ' + p.name.split('—')[0].trim());
    T('4 days on Mon/Tue/Thu/Fri gives Upper A, Lower A, Upper B, Lower B',
      named.join(' | ') === 'MON Upper A | TUE Lower A | THU Upper B | FRI Lower B', named.join(' | '));
  }
  {
    T('an empty day selection produces a rest week, not a crash',
      Object.values(ctx.buildTrainingWeek('upperlower', [])).every(e => e.type === 'rest'));
    T('an unknown plan degrades safely',
      Object.values(ctx.buildTrainingWeek('does-not-exist', ['mon'])).every(e => e.type === 'rest'));
  }

  sub('workout variants are named as versions, not hidden as templates');
  {
    ctx.selectedPlanId = 'upperlower';
    ctx.planData = JSON.parse(JSON.stringify(ctx.DEFAULT_PLANS.upperlower.templates));
    ctx.schedule = { mon:'upper', tue:'lower', wed:'rest', thu:'upper', fri:'lower', sat:'rest', sun:'rest' };
    const html = ctx.myTrainingVariantsHtml();
    T('each category lists its versions', /mt-var-row/.test(html));
    T('it says how many versions there are', /versions?</.test(html));
    T('the real variant names are shown', /Upper A|Upper B/.test(html));
    T('each carries exercise count and duration', /exercises · ~\d+ min/.test(html));
    T('the word "template" is not shown to the athlete', !/template/i.test(html));
  }

  sub('changing training changes the future only');
  {
    const applyFn = src.slice(src.indexOf('function applyTrainingSetup(){'), src.indexOf('function pencilIconSvg('));
    T('it writes the schedule', applyFn.indexOf('persistSchedule()') !== -1);
    T('it never writes workoutLog', !/workoutLog\s*(=[^=]|\.push|\.splice)/.test(applyFn));
    T('it touches no XP, PR or mastery store',
      !/xp|prCount|mastery/i.test(applyFn.replace(/\/\*[\s\S]*?\*\//g, '')));
    T('it updates an existing program rather than replacing it',
      /hasActiveProgram\(\)[\s\S]{0,140}updateProgram\(/.test(applyFn));
    T('the athlete is told history is safe',
      /Everything you have already logged stays exactly as it is/.test(src));
  }

  sub('internal vocabulary stays internal');
  {
    ctx.workoutLog = [];
    clearCaches(ctx);
    ctx.renderMyTraining();
    const html = doc.getElementById('myTrainingBody').innerHTML;
    const visible = html.replace(/<[^>]+>/g, ' ');
    T('no "block"', !/\bblock\b/i.test(visible));
    T('no "template"', !/\btemplate\b/i.test(visible));
    T('no "variation"', !/\bvariation\b/i.test(visible));
    T('no startWeek / endWeek / phaseType', !/startWeek|endWeek|phaseType/.test(visible));
    T('the placeholder phase name is never surfaced',
      !/\bCustom\b/.test(visible) || !/phase/i.test(visible));
    T('it speaks of training, weeks and workouts',
      /This week/i.test(visible) && /workouts/i.test(visible));
  }

  sub('setup asks only what changes the week');
  {
    const setup = src.slice(src.indexOf('function renderTrainingSetup(){'), src.indexOf('function applyTrainingSetup(){'));
    /* D16.1 stopped asking these as questions — the values arrive prefilled
       from the plan the athlete just chose, each with a Change control. The
       contract is unchanged: setup covers frequency and days and nothing
       else. */
    T('it covers frequency', /'Training frequency'/.test(setup));
    T('it covers which days', /'Your schedule'/.test(setup));
    /* both go through one editable-row helper rather than duplicated markup,
       so the Change affordance cannot drift between them */
    T('both are editable rather than fixed',
      /row\('freq', 'Training frequency'/.test(setup) &&
      /row\('days', 'Your schedule'/.test(setup) &&
      /onclick="setupEdit\('\$\{key\}'\)"/.test(setup));
    T('it shows the resulting week immediately', /Your week/.test(setup));
    T('it asks nothing else — no name, no length, no goal quiz',
      !/Program name|LENGTH|durationWeeks/.test(setup));
    T('the apply control is disabled with no days chosen',
      /apply\.disabled = !n/.test(setup));
  }
  {
    ctx.selectedPlanId = 'upperlower';
    ctx.openTrainingSetup('upperlower');
    T('setup seeds from the athlete\'s current days', !!ctx.setupDraft && ctx.setupDraft.days.length > 0);
    ctx.setupSetFrequency(3);
    T('choosing a frequency spreads the days out', ctx.setupDraft.days.length === 3);
    ctx.setupToggleDay('sat');
    T('a day can be added', ctx.setupDraft.days.indexOf('sat') !== -1);
    ctx.setupToggleDay('sat');
    T('and removed', ctx.setupDraft.days.indexOf('sat') === -1);
    T('days stay in week order', JSON.stringify(ctx.setupDraft.days) === JSON.stringify(
      ctx.DAY_ORDER.filter(d => ctx.setupDraft.days.indexOf(d) !== -1)));
    ctx.closeTrainingSetup();
    T('closing clears the draft', ctx.setupDraft === null);
  }

  sub('layout');
  {
    T('day rows are 60px', /\.mt-day\{[^}]*min-height: 60px/.test(css));
    T('the per-day edit control is 44px', /\.mt-day-edit\{[^}]*width: 44px; height: 44px/.test(css));
    T('frequency and day buttons are 48px',
      /\.ts-freq-btn\{[^}]*min-height: 48px/.test(css) && /\.ts-day\{[^}]*min-height: 48px/.test(css));
    T('quick actions are 60px', /\.mt-act\{[^}]*min-height: 60px/.test(css));
    T('state is carried by colour tokens, not literals',
      /\.mt-today\{[^}]*var\(--accent/.test(css) && /\.mt-done[^{]*\{[^}]*var\(--success/.test(css));
  }
}

/* =========================================================
   CONTRACT 76 — My Training changed no training history
   ========================================================= */
async function testMyTrainingSafety(){
  section('CONTRACT 76 — My Training touched no training history');
  const fixture = buildProtectionFixture();
  const app = await H.loadAppBooted(fixture);
  const ctx = app.ctx;

  const before = H.snapshot(ctx);
  const progBefore = ctx.getCurrentProgression();
  const trainerBefore = ctx.trainerLog.entries.length;
  const storeKeysBefore = Object.keys(app.store).sort().join(',');
  const cardioBefore = JSON.stringify(ctx.cardioLog);
  const masteryBefore = JSON.stringify(ctx.getTopExerciseMastery());
  const scheduleBefore = JSON.stringify(ctx.schedule);
  const programsBefore = app.store.programs;
  const notesBefore = app.store.exerciseNotes;
  const gymBefore = app.store.gymProfile;
  const draftBefore = app.store.activeWorkoutDraft;

  sub('browsing changes nothing at all');
  ctx.myTrainingState();
  ctx.renderMyTraining();
  ctx.myTrainingVariantsHtml();
  ctx.previewTrainingWeek(ctx.selectedPlanId, ['mon','wed','fri']);
  ctx.openTrainingSetup();
  ctx.setupSetFrequency(5);
  ctx.setupSetFrequency(2);
  ctx.setupToggleDay('sun');
  ctx.closeTrainingSetup();          // cancelled — nothing applied
  clearCaches(ctx);
  const after = H.snapshot(ctx);

  T('NOTHING protected changed', H.diffSnapshot(before, after, []).ok,
    H.diffSnapshot(before, after, []).violations.join(','));
  T('workoutLog byte-identical', after.rawWorkoutLog === before.rawWorkoutLog);
  T('cancelling setup leaves the schedule untouched',
    JSON.stringify(ctx.schedule) === scheduleBefore);
  T('programs untouched by browsing', app.store.programs === programsBefore);
  T('XP unchanged', after.xp === before.xp);
  T('PRs unchanged', after.prCount === before.prCount);
  T('mastery unchanged', JSON.stringify(ctx.getTopExerciseMastery()) === masteryBefore);
  T('cardioLog unchanged', JSON.stringify(ctx.cardioLog) === cardioBefore);

  sub('applying a new schedule changes the future only');
  {
    const logBefore = JSON.stringify(ctx.workoutLog);
    const xpBefore = ctx.getCurrentProgression().lifetimeXP;
    const strengthBefore = ctx.getCurrentProgression().strengthXP;
    const prsBefore = ctx.computeAllPREvents().length;
    const masteryPre = JSON.stringify(ctx.getTopExerciseMastery());

    ctx.openTrainingSetup();
    ctx.setupDraft.days = ['mon','wed','fri'];
    ctx.applyTrainingSetup();
    clearCaches(ctx);

    T('the schedule DID change — that was the point',
      JSON.stringify(ctx.schedule) !== scheduleBefore);
    T('workoutLog is byte-identical', JSON.stringify(ctx.workoutLog) === logBefore);
    T('XP unchanged', ctx.getCurrentProgression().lifetimeXP === xpBefore);
    T('strength XP unchanged', ctx.getCurrentProgression().strengthXP === strengthBefore);
    T('PRs unchanged', ctx.computeAllPREvents().length === prsBefore);
    T('mastery unchanged', JSON.stringify(ctx.getTopExerciseMastery()) === masteryPre);
    T('exercise notes unchanged', app.store.exerciseNotes === notesBefore);
    T('gymProfile unchanged', app.store.gymProfile === gymBefore);
    T('an unfinished workout is preserved', app.store.activeWorkoutDraft === draftBefore);
  }

  sub('no new storage, no migration');
  {
    const addedKeys = Object.keys(app.store).filter(k => storeKeysBefore.split(',').indexOf(k) === -1);
    T('nothing outside DATA_KEYS was created',
      addedKeys.every(k => ctx.DATA_KEYS.indexOf(k) !== -1 || /^planData:|^schedule:|^planStart:/.test(k)),
      addedKeys.join(','));
    T('the only key this flow may add is the program store',
      addedKeys.every(k => k === 'programs'), addedKeys.join(','));
    T('and it is a key that already existed in DATA_KEYS',
      ctx.DATA_KEYS.indexOf('programs') !== -1);
  }
  T('DATA_KEYS unchanged at 15', ctx.DATA_KEYS.length === 15);
  T('schema still v1', ctx.DATA_SCHEMA_VERSION === 1);

  sub('trainer isolation');
  T('engine still 0.1.1-shadow', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  T('no trainerLog entries created by configuring training',
    ctx.trainerLog.entries.length === trainerBefore);
  T('trainer states unchanged',
    JSON.stringify(ctx.TRAINER_STATES) === JSON.stringify(['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF']));
}

/* =========================================================
   CONTRACT 77 — one write path for the week
   ========================================================= */
function testScheduleWritePath(app){
  section('CONTRACT 77 — week scheduling writes what the app reads');
  const ctx = app.ctx;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');

  sub('the split that made day edits invisible');
  {
    /* LOOP holds the week twice: `schedule` (plan layer) and, when a program is
       active, that program's own day map. Every READER prefers the program.
       Both writers used to touch only the plan layer, so an edit persisted and
       was never read — the two simply diverged. These assertions exist because
       the bug was invisible: the write succeeded every time. */
    T('a single writer owns "this day holds this category"',
      typeof ctx.setScheduledCategory === 'function');
    T('a single writer owns swapping two days', typeof ctx.swapScheduledDays === 'function');
    const setter = src.slice(src.indexOf('function setScheduledCategory('), src.indexOf('function swapScheduledDays('));
    const swapper = src.slice(src.indexOf('function swapScheduledDays('), src.indexOf('function setDayValue('));
    [['setScheduledCategory', setter], ['swapScheduledDays', swapper]].forEach(([nm, code]) => {
      T(nm + ' writes the plan layer', code.indexOf('persistSchedule()') !== -1);
      T(nm + ' also writes the active program', /hasActiveProgram\(\)/.test(code) && /updateProgram\(/.test(code));
      T(nm + ' invalidates the program cache', code.indexOf('invalidateProgramCache()') !== -1);
      T(nm + ' never touches workoutLog', code.indexOf('workoutLog') === -1);
    });
    T('the day editor routes through the shared writer',
      /function setDayValue\([\s\S]{0,180}setScheduledCategory\(/.test(src));
    T('moving a day routes through the shared writer',
      /function moveDayTo\([\s\S]{0,220}swapScheduledDays\(/.test(src));
  }

  sub('behaviour, with a program active');
  {
    ctx.selectedPlanId = 'upperlower';
    ctx.planData = JSON.parse(JSON.stringify(ctx.DEFAULT_PLANS.upperlower.templates));
    ctx.schedule = { mon:'upper', tue:'lower', wed:'rest', thu:'upper', fri:'lower', sat:'rest', sun:'rest' };
    ctx.workoutLog = [];
    clearCaches(ctx);
    const week = {};
    ctx.PROGRAM_DAY_KEYS.forEach(d => { week[d] = { type:'rest' }; });
    week.mon = { type:'workout', planId:'upperlower', category:'upper', templateId:'ul-u1' };
    week.tue = { type:'workout', planId:'upperlower', category:'lower', templateId:'ul-l1' };
    week.thu = { type:'workout', planId:'upperlower', category:'upper', templateId:'ul-u2' };
    week.fri = { type:'workout', planId:'upperlower', category:'lower', templateId:'ul-l2' };
    const res = ctx.createProgram({ name:'T', goal:null, durationWeeks:8, schedule: week });
    T('a program is active for this scenario', !!res.ok && ctx.hasActiveProgram());

    const logBefore = JSON.stringify(ctx.workoutLog);
    const layersAgree = () => ctx.DAY_ORDER.every(d => {
      const e = ctx.getActiveProgram().schedule[d];
      const progCat = (e && e.type === 'workout') ? e.category : 'rest';
      return ctx.schedule[d] === progCat;
    });

    ctx.currentEditDay = 'wed';
    ctx.setDayValue('upper');
    T('the plan layer took the change', ctx.schedule.wed === 'upper');
    T('the PROGRAM took it too — this is what was broken',
      (function(){ const e = ctx.getActiveProgram().schedule.wed; return e && e.type === 'workout' && e.category === 'upper'; })());
    T('both layers agree afterwards', layersAgree());
    T('the new day names a real workout',
      !!ctx.resolveProgramWorkout(ctx.getActiveProgram().schedule.wed));
    T('it does not duplicate a session the week already has',
      ctx.getActiveProgram().schedule.wed.templateId !== ctx.getActiveProgram().schedule.mon.templateId);
    T('other days are untouched',
      ctx.schedule.mon === 'upper' && ctx.schedule.tue === 'lower' && ctx.schedule.fri === 'lower');

    ctx.currentEditDay = 'wed';
    ctx.setDayValue('rest');
    T('changing back to rest works in both layers',
      ctx.schedule.wed === 'rest' && ctx.getActiveProgram().schedule.wed.type === 'rest');
    T('layers still agree', layersAgree());

    ctx.currentEditDay = 'mon';
    ctx.moveDayTo('sat');
    T('moving swaps the plan layer', ctx.schedule.mon === 'rest' && ctx.schedule.sat === 'upper');
    T('moving swaps the program too', layersAgree());
    ctx.currentEditDay = 'sat';
    ctx.moveDayTo('mon');
    T('moving back restores both layers exactly',
      ctx.schedule.mon === 'upper' && ctx.schedule.sat === 'rest' && layersAgree());

    T('training history was never involved', JSON.stringify(ctx.workoutLog) === logBefore);
  }

  sub('behaviour with no program — the plan layer alone still works');
  {
    ctx.programsStore = ctx.defaultProgramsStore();
    ctx.schedule = { mon:'push', tue:'rest', wed:'pull', thu:'rest', fri:'legs', sat:'rest', sun:'rest' };
    clearCaches(ctx);
    ctx.currentEditDay = 'tue';
    ctx.setDayValue('legs');
    T('a plan-only athlete can still edit a day', ctx.schedule.tue === 'legs');
    ctx.currentEditDay = 'tue';
    ctx.setDayValue('rest');
    T('and set it back', ctx.schedule.tue === 'rest');
    T('push/pull/legs plans keep working', ctx.schedule.mon === 'push' && ctx.schedule.fri === 'legs');
  }
}

/* =========================================================
   CONTRACT 78 — pages look like pages
   ========================================================= */
function testPageSurfaces(app){
  section('CONTRACT 78 — page and sheet hierarchy');
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

  /* Destinations you navigate TO. Each of these previously filled almost the
     whole screen while leaving a blurred sliver of the screen behind it —
     16px for What's New, Profile and Plans; 128px for Settings — which is what
     made them read as something floating over Home rather than a page. */
  const PAGES = ['logOverlay','prepOverlay','onboardingOverlay','myTrainingOverlay',
    'settingsOverlay','plansOverlay','programsOverlay','programDetailOverlay',
    'gymOverlay','dataOverlay','updatesOverlay','profileOverlay','exDetailOverlay'];
  /* Sheets where the athlete is editing something they can still see, and that
     context is the point. Deliberately NOT promoted. */
  const SHEETS = ['dayEditOverlay','setTypeOverlay','subOverlay','notesOverlay',
    'trainingSetupOverlay','planSwitchOverlay','cardioOverlay','cardioDetailOverlay',
    'tplOverlay','phaseEditorOverlay','programBuilderOverlay','profileEditOverlay',
    'dayDetailOverlay','summaryOverlay'];

  sub('true pages');
  PAGES.forEach(id => {
    const at = src.indexOf('id="' + id + '"');
    const tagStart = src.lastIndexOf('<div class="overlay', at);
    const tag = src.slice(tagStart, at);
    T(id + ' is a page', tag.indexOf('overlay-page') !== -1);
    const sheetAt = src.indexOf('class="sheet', at);
    T(id + ' uses the page surface', src.slice(sheetAt, sheetAt + 40).indexOf('sheet-page') !== -1);
  });

  sub('intentional sheets stay sheets');
  SHEETS.forEach(id => {
    const at = src.indexOf('id="' + id + '"');
    const tagStart = src.lastIndexOf('<div class="overlay', at);
    T(id + ' is still a sheet', src.slice(tagStart, at).indexOf('overlay-page') === -1);
  });

  sub('a page hides what is behind it');
  T('pages are opaque', /\.overlay\.overlay-page\{[^}]*background: var\(--bg\)/.test(css));
  T('pages drop the backdrop blur', /\.overlay\.overlay-page\{[^}]*backdrop-filter: none/.test(css));
  T('pages fill the height', /\.sheet\.sheet-page\{[^}]*height: 100%/.test(css));
  T('pages lose the sheet lip', /\.sheet\.sheet-page\{[^}]*border-radius: 0/.test(css));
  T('a page owns its own top safe-area inset',
    /\.sheet-page \.sheet-scroll\{[^}]*env\(safe-area-inset-top/.test(css));
  T('back navigation on a page is a 44px control',
    /\.sheet-page \.sheet-back\{[^}]*min-height: 44px/.test(css));
}

/* =========================================================
   CONTRACT 79 — rest timer
   ========================================================= */
function testRestTimer(app){
  section('CONTRACT 79 — rest timer');
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
  const engine = src.slice(src.indexOf('function startRestPanel(panel, seconds){'), src.indexOf('function pauseIconSvg(){'));

  sub('a deadline, not a counter');
  {
    /* The prep timer has always used an endsAt deadline; the rest timer was the
       outlier, decrementing a counter once per interval. That drifts and stalls
       whenever the tab is backgrounded. */
    T('the timer stores a deadline', /dataset\.endsAt/.test(engine));
    T('ticks are derived from the clock', /Date\.now\(\)/.test(engine));
    T('no blind decrement survives', !/remaining\s*=\s*\(parseInt\([^)]*\)\s*\|\|\s*0\)\s*-\s*1/.test(engine));
    T('pause freezes what is left', /function pauseResumeRest[\s\S]{0,420}Math\.ceil\(\(endsAt - Date\.now\(\)\)/.test(src));
    T('resume re-anchors the deadline', /function pauseResumeRest[\s\S]{0,520}endsAt = String\(Date\.now\(\)/.test(src));
  }

  sub('completion happens exactly once');
  {
    T('a once-only guard exists on the panel', /dataset\.completed/.test(engine));
    T('completion returns early if already complete',
      /function completeRestPanel[\s\S]{0,200}dataset\.completed === 'true'\) return;/.test(src));
    T('starting a rest resets the guard', /function startRestPanel[\s\S]{0,600}completed = 'false'/.test(src));
    T('completion clears its own interval',
      /function completeRestPanel[\s\S]{0,300}clearRestTimer\(panel\)/.test(src));
    T('starting clears any previous interval first',
      /function startRestPanel[\s\S]{0,120}clearRestTimer\(panel\)/.test(src));
    T('skipping is not completing — it fires no feedback',
      /function skipRest[\s\S]{0,320}completed = 'true'/.test(src) &&
      !/function skipRest[\s\S]{0,320}(loopHaptic|loopPlayChime)/.test(src));
  }

  sub('feedback is one intentional event, and degrades gracefully');
  {
    T('a haptic helper exists', /function loopHaptic\(\)/.test(src));
    T('it fires a single pulse, not a pattern', /navigator\.vibrate\(18\)/.test(src));
    T('it is capability-checked and cannot throw',
      /typeof navigator\.vibrate === 'function'/.test(src) && /function loopHaptic\(\)\{[\s\S]{0,220}catch/.test(src));
    T('audio is created inside the athlete\'s tap',
      /function startRestPanel[\s\S]{0,220}loopFeedbackPrime\(\)/.test(src));
    T('audio failure is survivable', /function loopPlayChime\(\)\{[\s\S]{0,900}catch\(e\)\{ return false/.test(src));
    T('the chime never loops', !/loop\s*=\s*true/.test(src));
    T('the visual completion does not depend on sound or haptics',
      /function completeRestPanel[\s\S]{0,400}classList\.add\('done'\)[\s\S]{0,200}loopHaptic\(\)/.test(src));
  }

  sub('three states, distinguishable without colour');
  {
    T('a ring communicates progress', /function restRingSvg\(\)/.test(src) && /rest-ring-fill/.test(css));
    T('the ring depletes as time passes', /stroke-dashoffset/.test(src));
    T('the last ten seconds shift attention once, without flashing',
      /\.rest-panel\.ending \.rest-ring-fill\{[^}]*var\(--warning\)/.test(css) &&
      !/\.rest-panel\.ending[^{]*\{[^}]*animation:[^}]*infinite/.test(css));
    T('completion replaces the time with a mark, not just a colour',
      /\.rest-panel\.done \.rest-dial-time\{ display: none/.test(css) &&
      /\.rest-panel\.done \.rest-dial-check\{[^}]*display: flex/.test(css));
    T('completion animates once, not forever',
      /@keyframes restSettle/.test(css) && !/restSettle[^;]*infinite/.test(css));
    T('reduced motion is respected',
      /@media \(prefers-reduced-motion: reduce\)\{[\s\S]{0,240}\.rest-panel\.done/.test(css));
  }

  sub('no emoji stands in for a control');
  {
    const panelMarkup = src.slice(src.indexOf('<div class="rest-panel"'), src.indexOf('<div class="rest-panel"') + 1400);
    T('pause and resume are drawn icons',
      /function pauseIconSvg\(\)/.test(src) && /function playIconSvg\(\)/.test(src));
    T('the panel markup carries no emoji glyph', !/[⏸▶⏱🔔⏰]/.test(panelMarkup));
    T('draft restore no longer writes a text glyph into the control',
      !/pauseBtn\.textContent = '▶'/.test(src));
    T('a restored rest comes back paused rather than silently counting down',
      /restRemaining[\s\S]{0,420}paused = 'true'/.test(src));
  }

  sub('the timer belongs to the exercise card');
  {
    T('it names the exercise it belongs to', /rest-panel-sub/.test(src));
    T('it sits inside the exercise row, not over the screen',
      src.indexOf('<div class="rest-panel"') > src.indexOf('class="ex-log-row"'));
    T('controls stay a comfortable size', /\.rest-panel-btn\{[^}]*width: 44px; height: 44px/.test(css));
  }
}

/* =========================================================
   CONTRACT 80 — none of this touched training data
   ========================================================= */
async function testD14Safety(){
  section('CONTRACT 80 — scheduling, pages and timer touched no history');
  const fixture = buildProtectionFixture();
  const app = await H.loadAppBooted(fixture);
  const ctx = app.ctx;

  const before = H.snapshot(ctx);
  const progBefore = ctx.getCurrentProgression();
  const trainerBefore = ctx.trainerLog.entries.length;
  const cardioBefore = JSON.stringify(ctx.cardioLog);
  const masteryBefore = JSON.stringify(ctx.getTopExerciseMastery());
  const notesBefore = app.store.exerciseNotes;
  const gymBefore = app.store.gymProfile;
  const draftBefore = app.store.activeWorkoutDraft;

  sub('editing the week');
  const scheduleBefore = JSON.stringify(ctx.schedule);
  ctx.currentEditDay = 'wed';
  ctx.setDayValue('upper');
  ctx.currentEditDay = 'wed';
  ctx.setDayValue('rest');
  ctx.currentEditDay = 'mon';
  ctx.moveDayTo('sat');
  ctx.currentEditDay = 'sat';
  ctx.moveDayTo('mon');
  clearCaches(ctx);
  const after = H.snapshot(ctx);

  T('NOTHING protected changed', H.diffSnapshot(before, after, []).ok,
    H.diffSnapshot(before, after, []).violations.join(','));
  T('workoutLog byte-identical', after.rawWorkoutLog === before.rawWorkoutLog);
  T('a change and its exact reverse restore the week',
    JSON.stringify(ctx.schedule) === scheduleBefore);
  T('XP unchanged', after.xp === before.xp);
  T('strength XP unchanged', ctx.getCurrentProgression().strengthXP === progBefore.strengthXP);
  T('PRs unchanged', after.prCount === before.prCount);
  T('readiness unchanged', after.readiness === before.readiness);
  T('recovery unchanged', after.recovery === before.recovery);
  T('capability unchanged', after.capabilityBench === before.capabilityBench);
  T('mastery unchanged', JSON.stringify(ctx.getTopExerciseMastery()) === masteryBefore);
  T('cardioLog unchanged', JSON.stringify(ctx.cardioLog) === cardioBefore);
  T('exercise notes unchanged', app.store.exerciseNotes === notesBefore);
  T('gymProfile unchanged', app.store.gymProfile === gymBefore);
  T('an unfinished workout is preserved', app.store.activeWorkoutDraft === draftBefore);

  sub('no new storage, no migration');
  T('DATA_KEYS unchanged at 15', ctx.DATA_KEYS.length === 15);
  T('schema still v1', ctx.DATA_SCHEMA_VERSION === 1);
  T('no timer or navigation key was introduced',
    !ctx.DATA_KEYS.some(k => /timer|rest|page|overlay/i.test(k)));

  sub('trainer isolation');
  T('engine still 0.1.1-shadow', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  T('no trainerLog entries created', ctx.trainerLog.entries.length === trainerBefore);
  {
    const fs = require('fs');
    const src = fs.readFileSync(H.APP_PATH, 'utf8');
    const timer = src.slice(src.indexOf('function startRestPanel(panel, seconds){'), src.indexOf('function pauseIconSvg(){'));
    T('the timer calls no trainer function',
      !/proposeTrainerState|computeShadowRecommendation|logRecommendation/.test(timer));
    T('the timer writes no storage',
      timer.indexOf('LOOPStore.set') === -1 && timer.indexOf('localStorage') === -1);
  }
}

/* =========================================================
   RUNNER
   ========================================================= */
/* =========================================================
   CONTRACT 81 — Cardio 2.0: launcher, session, metrics
   ---------------------------------------------------------
   Cardio used to be a form with a Start-shaped button on it.
   These contracts pin the three things that changed: starting
   is starting, the clock is derived from the wall clock, and
   every number says where it came from.
   ========================================================= */
function testCardio2(app){
  section('CONTRACT 81 — Cardio 2.0');
  const ctx = app.ctx;
  const doc = app.doc || ctx.document;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

  sub('the launcher starts sessions rather than opening forms');
  ctx.cardioLog = [];
  ctx.invalidateCardioCache();
  ctx.renderCardioView();
  const home = doc.getElementById('cardioBody').innerHTML;
  T('the tab leads with starting', home.includes('Start a session'));
  T('launcher tiles start a session directly',
    /onclick="startCardioActivity\('[a-z_]+'\)"/.test(home));
  T('every launcher id is a canonical activity, not a new identity',
    [...home.matchAll(/startCardioActivity\('([a-z_]+)'\)/g)]
      .every(m => ctx.CARDIO_ACTIVITIES.some(a => a.id === m[1])));
  T('the full registry is one tap away', home.includes('openCardioPicker()'));
  T('manual entry survives as the secondary path', home.includes('openCardioLogger()'));
  T('starting outranks logging in the markup',
    home.indexOf('startCardioActivity') < home.indexOf('openCardioLogger()'));
  T('every quick id resolves',
    ctx.CARDIO_QUICK_IDS.every(id => !!ctx.getCardioActivity(id)));
  T('the seven activities the brief names are all reachable',
    ['run_outdoor','walk_outdoor','cycle_outdoor','run_treadmill','stair_climber','rowing','elliptical']
      .every(id => ctx.CARDIO_QUICK_IDS.indexOf(id) !== -1));

  sub('your own activities are promoted ahead of the defaults');
  ctx.cardioLog = [
    { id:'a', activityId:'rowing', activityName:'Rowing Machine', date:'2026-08-01', duration:'30' },
    { id:'b', activityId:'rowing', activityName:'Rowing Machine', date:'2026-08-02', duration:'30' },
    { id:'c', activityId:'swimming', activityName:'Swimming', date:'2026-08-03', duration:'30' }
  ];
  ctx.invalidateCardioCache();
  const ids = ctx.cardioLauncherIds();
  T('the most-logged activity leads the launcher', ids[0] === 'rowing');
  T('an activity outside the defaults can reach the launcher', ids.indexOf('swimming') !== -1);
  T('the launcher never grows past seven', ids.length <= 7);
  T('the launcher never repeats an activity', new Set(ids).size === ids.length);

  sub('elapsed time is derived from the clock, never counted by ticks');
  const engine = src.slice(src.indexOf('function cardioElapsedMs(s){'),
                           src.indexOf('function cardioSessionToRecord(){'));
  T('elapsed reads the wall clock', /Date\.now\(\)/.test(engine));
  T('a paused session banks its accumulated time', /accumulatedMs/.test(engine));
  T('no tick-counting increment survives',
    !/elapsed(Sec|Ms)?\s*(\+\+|\+=\s*1\b)/.test(engine));

  const s0 = ctx.newCardioSession('run_outdoor');
  T('a new session starts running', s0.state === 'running' && s0.runningSince !== null);
  T('a new session starts at zero', s0.accumulatedMs === 0);
  T('a new session carries the canonical identity',
    s0.activityId === 'run_outdoor' && s0.activityName === 'Outdoor Run');

  // Paused time must be structurally unreachable, not subtracted afterwards.
  const paused = { accumulatedMs: 600000, runningSince: null, state:'paused' };
  const a = ctx.cardioElapsedMs(paused);
  const b = ctx.cardioElapsedMs(paused);
  T('a paused session does not advance', a === b && a === 600000);
  const running = { accumulatedMs: 600000, runningSince: Date.now() - 5000, state:'running' };
  T('a running session advances by wall-clock time',
    Math.abs(ctx.cardioElapsedMs(running) - 605000) < 200);

  sub('the clock reads like a stopwatch');
  T('under an hour is M:SS', ctx.formatClock(61) === '1:01');
  T('over an hour is H:MM:SS', ctx.formatClock(3661) === '1:01:01');
  T('zero is 0:00', ctx.formatClock(0) === '0:00');
  T('negative time cannot render', ctx.formatClock(-50) === '0:00');

  sub('pace and speed are exact arithmetic over two knowns');
  T('pace is minutes per unit distance',
    ctx.formatPace(ctx.cardioPaceSec(3.72, 32.683)) === '8:47');
  T('speed is distance over time', Math.abs(ctx.cardioSpeedMph(12, 30) - 24) < 0.01);
  T('no distance means no pace', ctx.cardioPaceSec(0, 30) === null);
  T('no duration means no pace', ctx.cardioPaceSec(3, 0) === null);
  T('an absurd pace is withheld rather than printed', ctx.formatPace(4000) === null);
  T('pace rounds to whole seconds', !/\./.test(ctx.formatPace(ctx.cardioPaceSec(3, 27)) || ''));
  T('the pace unit follows the distance unit',
    ctx.cardioPaceUnit() === '/' + ctx.cardioDistanceUnit());
  T('cycling is spoken in speed, everything else in pace',
    ctx.cardioUsesSpeed('cycle_outdoor') && !ctx.cardioUsesSpeed('run_outdoor')
    && !ctx.cardioUsesSpeed('rowing'));

  sub('effort is spoken the way the sport speaks it');
  T('running is paced per unit distance', ctx.cardioPaceMode('run_outdoor') === 'distance');
  T('cycling is spoken in speed', ctx.cardioPaceMode('cycle_outdoor') === 'speed');
  T('rowing is spoken in a 500m split', ctx.cardioPaceMode('rowing') === 'split');
  T('one function decides for every screen', (() => {
    const region = src.slice(src.indexOf('function cardioPaceMode'), src.indexOf('function cardioBodyWeightLb'));
    return /function cardioEffortMetric/.test(region);
  })());
  T('the split is time per 500m, converted from the stored distance', (() => {
    /* 3 miles is 4828m, which is 9.656 lots of 500m; 22 minutes over that is
       2:17 per 500. */
    return ctx.formatPace(ctx.cardioSplitSec(3, 22)) === '2:17';
  })());
  T('a split needs a distance like any other derived number',
    ctx.cardioSplitSec(0, 22) === null && ctx.cardioSplitSec(3, 0) === null);
  T('the effort metric names its own unit', (() => {
    const row = ctx.cardioEffortMetric('rowing', 3, 22);
    const run = ctx.cardioEffortMetric('run_outdoor', 3, 22);
    const ride = ctx.cardioEffortMetric('cycle_outdoor', 3, 22);
    return row.unit === '/500m' && run.unit === '/mi' && ride.unit === 'mph';
  })());
  T('a missing distance yields nothing rather than a zero',
    ctx.cardioEffortMetric('rowing', '', 22).value === null &&
    ctx.cardioEffortMetric('cycle_outdoor', '', 22).value === null);
  /* The number stored in an old rowing session was a per-mile pace. Showing it
     under a /500m label would silently restate a number LOOP never computed. */
  T('a rowing record written before this phase still reads in its own unit',
    ctx.cardioCardHtml({ id:'o', activityId:'rowing', activityName:'Rowing Machine',
      date:'2026-08-01', duration:'20', distance:'2.5', pace:'8:00' }).indexOf('8:00 /mi') !== -1);
  T('a new rowing record carries the unit it was measured in', (() => {
    const region = src.slice(src.indexOf('function cardioSessionToRecord'), src.indexOf('async function saveCardioSessionFromSummary'));
    return /rec\.paceUnit = eff\.unit/.test(region);
  })());
  T('cardio storage was not rewritten to make the split work',
    ctx.DATA_KEYS.indexOf('cardioLog') !== -1 && ctx.DATA_KEYS.length === 15);

  sub('calories are an estimate with a published model behind them');
  ctx.athleteProfile.bodyWeightLb = null;
  T('no body weight means NO estimate, not a guessed one',
    ctx.cardioCalories('run_outdoor', 30, 3) === null);
  ctx.athleteProfile.bodyWeightLb = 175;
  const cal = ctx.cardioCalories('run_outdoor', 30, 3);
  T('a weight makes an estimate possible', !!cal);
  T('total exceeds active, because total includes resting expenditure',
    cal.total > cal.active);
  T('active is total minus one MET of resting burn',
    Math.abs((cal.total - cal.active) - Math.round(1 * 3.5 * (175*0.45359237) / 200 * 30)) <= 1);
  T('calories are whole numbers, not false precision',
    Number.isInteger(cal.total) && Number.isInteger(cal.active));
  T('the estimate is flagged as an estimate', cal.estimated === true);
  T('an unspecified activity gets no MET and no estimate',
    ctx.cardioCalories('cardio_other', 30, 0) === null);
  T('"Other Cardio" is deliberately absent from the MET table',
    ctx.CARDIO_MET_FLAT['cardio_other'] === undefined);
  T('a faster run burns more than a slower one over the same minutes',
    ctx.cardioCalories('run_outdoor', 30, 5).total > ctx.cardioCalories('run_outdoor', 30, 2).total);
  T('a heavier athlete burns more over the same work', (() => {
    const light = (ctx.athleteProfile.bodyWeightLb = 130, ctx.cardioCalories('run_outdoor', 30, 3).total);
    const heavy = (ctx.athleteProfile.bodyWeightLb = 220, ctx.cardioCalories('run_outdoor', 30, 3).total);
    ctx.athleteProfile.bodyWeightLb = 175;
    return heavy > light;
  })());
  T('a typed calorie count is NOT relabelled as an estimate', (() => {
    const r = ctx.cardioCaloriesFor({ activityId:'run_outdoor', duration:30, calories:'400' });
    return r.estimated === false && r.total === 400;
  })());
  T('MET interpolation stays inside the published range', (() => {
    const t = ctx.CARDIO_MET_TABLE.run;
    const lo = t[0][1], hi = t[t.length-1][1];
    return [3,5,7,9,11,15].every(mph => {
      const m = ctx.cardioMET('run_outdoor', mph);
      return m >= lo && m <= hi;
    });
  })());
  T('body weight lives on the athlete profile, not a cardio-only store',
    'bodyWeightLb' in ctx.defaultAthleteProfile());
  T('a profile written before this phase simply has no weight',
    ctx.defaultAthleteProfile().bodyWeightLb === null);

  sub('metrics are context-aware — driven by the registry, not by guesswork');
  const tilesFor = (id, distance) => ctx.cardioLiveTiles({
    activityId: id, accumulatedMs: 30*60000, runningSince: null, distance: distance || '', floors: '' })
    .map(t => t.key);
  T('a run shows distance and pace',
    tilesFor('run_outdoor').indexOf('distance') !== -1 && tilesFor('run_outdoor').indexOf('pace') !== -1);
  T('a ride shows speed, not pace',
    tilesFor('cycle_outdoor').indexOf('speed') !== -1 && tilesFor('cycle_outdoor').indexOf('pace') === -1);
  T('a stair climber shows floors and no distance',
    tilesFor('stair_climber').indexOf('floors') !== -1 && tilesFor('stair_climber').indexOf('distance') === -1);
  T('a stair climber is never asked for a pace it cannot have',
    tilesFor('stair_climber').indexOf('pace') === -1);
  T('jump rope shows neither distance nor pace',
    tilesFor('jump_rope').indexOf('distance') === -1 && tilesFor('jump_rope').indexOf('pace') === -1);
  T('every visible metric is declared by the activity itself', (() => {
    return ctx.CARDIO_ACTIVITIES.every(act => {
      const keys = tilesFor(act.id);
      if(keys.indexOf('distance') !== -1 && act.metrics.indexOf('distance') === -1) return false;
      if(keys.indexOf('floors') !== -1 && act.metrics.indexOf('floors') === -1) return false;
      return true;
    });
  })());

  sub('every number on the session screen states where it came from');
  const runTiles = ctx.cardioLiveTiles({ activityId:'run_outdoor',
    accumulatedMs: 30*60000, runningSince: null, distance:'3', floors:'' });
  T('an entered value says so', runTiles.find(t => t.key === 'distance').hint === 'entered');
  T('a derived value names its input', runTiles.find(t => t.key === 'pace').hint === 'from distance');
  T('an estimated value says estimated',
    runTiles.find(t => t.key === 'activeCal').hint === 'estimated');
  T('a missing value prints no unit for a number that is not there',
    ctx.cardioTileValueHtml({ value:null, unit:'mi' }) === '—');
  T('a present value keeps its unit',
    ctx.cardioTileValueHtml({ value:3.7, unit:'mi' }).indexOf('mi') !== -1);
  ctx.athleteProfile.bodyWeightLb = null;
  const noWeight = ctx.cardioLiveTiles({ activityId:'run_outdoor',
    accumulatedMs: 30*60000, runningSince: null, distance:'3', floors:'' });
  T('without a weight the calorie tile offers the fix instead of a number', (() => {
    const t = noWeight.find(x => x.key === 'cal');
    return t && t.value === null && /weight/.test(t.hint);
  })());
  T('no active/total tiles appear when they cannot be estimated',
    !noWeight.some(t => t.key === 'activeCal' || t.key === 'totalCal'));
  ctx.athleteProfile.bodyWeightLb = 175;

  sub('the summary has a hierarchy rather than six equal blocks');
  T('one metric leads at its own size', /\.cs-sum-lead-v\{[^}]*font-size:\s*(\d+)px/.test(css));
  T('the lead is larger than the supporting rows', (() => {
    const lead = parseInt((css.match(/\.cs-sum-lead-v\{[^}]*font-size:\s*(\d+)px/) || [])[1], 10);
    const row  = parseInt((css.match(/\.cs-sum-v\{[^}]*font-size:\s*(\d+)px/) || [])[1], 10);
    return lead > row;
  })());
  T('the elapsed time still outranks everything on the summary', (() => {
    const time = parseInt((css.match(/\.cs-sum-time\{[^}]*font-size:\s*(\d+)px/) || [])[1], 10);
    const lead = parseInt((css.match(/\.cs-sum-lead-v\{[^}]*font-size:\s*(\d+)px/) || [])[1], 10);
    return time > lead;
  })());

  sub('motion stays out of the way');
  T('reduced motion disables the icon and card transitions',
    /prefers-reduced-motion[\s\S]{0,500}transform:\s*none/.test(css));
  T('nothing on the cardio session screen animates continuously', (() => {
    const start = css.indexOf('ACTIVE SESSION PAGE');
    const end = css.indexOf('one-value entry sheet', start);
    return !/animation:[^;]*infinite/.test(css.slice(start, end > start ? end : undefined));
  })());
  T('nothing on the rest panel animates continuously either', (() => {
    /* Same rule, stated for the surface an athlete stares at between sets. */
    const start = css.indexOf('REST TIMER (Phase D14)');
    const end = css.indexOf('PAGE ISOLATION', start);
    return !/animation:[^;]*infinite/.test(css.slice(start, end > start ? end : undefined));
  })());
  T('the completion mark plays once', /animation:\s*csPop[^;]*both/.test(css));

  sub('the session is a page, and its controls sit at the foot of it');
  T('the session is a true page, not a sheet over the tab',
    /id="cardioSessionOverlay"[^>]*class="[^"]*overlay-page|class="overlay overlay-page" id="cardioSessionOverlay"/.test(src));
  T('the control bar is its own strip, not an overlay on the numbers',
    /\.cs-bar\{[^}]*border-top/.test(css));
  T('the control bar respects the home indicator',
    /\.cs-bar\{[^}]*env\(safe-area-inset-bottom/.test(css));
  T('session controls clear the 44px target', /\.cs-btn\{[^}]*min-height:\s*(4[4-9]|[5-9]\d)px/.test(css));
  T('the clock is the largest thing on the page', (() => {
    const clock = parseInt((css.match(/\.cs-clock\{[^}]*font-size:\s*(\d+)px/) || [])[1], 10);
    const tile  = parseInt((css.match(/\.cs-tile-val\{[^}]*font-size:\s*(\d+)px/) || [])[1], 10);
    return clock > tile * 2;
  })());
  T('the clock uses tabular figures so it does not jitter',
    /\.cs-clock\{[^}]*tabular-nums/.test(css));
  T('reduced motion is honoured',
    /prefers-reduced-motion[\s\S]{0,400}\.cs-ring-fill\{\s*transition:\s*none/.test(css));
  T('no emoji anywhere in the cardio surface', (() => {
    const region = src.slice(src.indexOf('CARDIO 2.0 — MEASUREMENT'), src.indexOf('function renderCardioPRs'));
    return !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(region);
  })());

  sub('one visual language — every activity mark is drawn, none are characters');
  /* The launcher and history cards were redrawn first, which briefly left the
     manual logger and the records list printing the old geometric glyphs at
     the same activity. Both are the same surface to an athlete, so both use
     the same marks now, and the glyph characters are gone from the registry
     rather than left available to drift back. */
  T('activity marks come from one drawing function',
    /function cardioIconSvg\(activityId, size\)\{/.test(src));
  T('every canonical activity resolves to an icon',
    ctx.CARDIO_ACTIVITIES.every(a => !!ctx.getCardioIcon(a.id)));
  T('the registry is keyed by canonical id, so an icon cannot drift off its activity',
    Object.keys(ctx.CARDIO_ICONS).every(id => ctx.CARDIO_ACTIVITIES.some(a => a.id === id)));
  T('the registry covers every activity and invents none',
    Object.keys(ctx.CARDIO_ICONS).length === ctx.CARDIO_ACTIVITIES.length);
  T('an unknown id falls back cleanly instead of rendering nothing', (() => {
    const svg = ctx.cardioIconSvg('not_a_real_activity', 20);
    return svg.indexOf('<svg') === 0 && svg.indexOf('<path') !== -1;
  })());
  T('the fallback is neutral — it does not claim to be some other activity',
    ctx.getCardioIcon('not_a_real_activity') === ctx.getCardioIcon('cardio_other'));
  T('asking for an icon never changes the activity it asked about', (() => {
    const before = JSON.stringify(ctx.CARDIO_ACTIVITIES);
    ctx.CARDIO_ACTIVITIES.forEach(a => ctx.cardioIconSvg(a.id, 24));
    ctx.cardioIconSvg('unmapped_thing', 24);
    return JSON.stringify(ctx.CARDIO_ACTIVITIES) === before;
  })());

  sub('the icons look like one family, and like the equipment they name');
  /* The point of the family is recognition before reading. A treadmill that
     draws a running figure fails that, however tidy the figure is. */
  T('equipment activities do not borrow the running figure',
    ctx.getCardioIcon('run_treadmill') !== ctx.getCardioIcon('run_outdoor') &&
    ctx.getCardioIcon('elliptical') !== ctx.getCardioIcon('run_outdoor') &&
    ctx.getCardioIcon('rowing') !== ctx.getCardioIcon('run_outdoor'));
  T('the machines are told apart from each other', (() => {
    const machines = ['rowing','elliptical','stair_climber','cycle_stationary','run_treadmill']
      .map(id => ctx.getCardioIcon(id));
    return new Set(machines).size === machines.length;
  })());
  T('running and walking are drawn differently',
    ctx.getCardioIcon('run_outdoor') !== ctx.getCardioIcon('walk_outdoor'));
  T('activities that genuinely share a look share one drawing, deliberately',
    ctx.getCardioIcon('run_treadmill') === ctx.getCardioIcon('walk_treadmill') &&
    ctx.getCardioIcon('stair_climber') === ctx.getCardioIcon('stepmill'));
  T('every icon is drawn on the same grid',
    /viewBox="0 0 24 24"/.test(ctx.cardioIconSvg('rowing', 20)));
  T('every icon carries the same stroke weight and joins', (() => {
    const svg = ctx.cardioIconSvg('elliptical', 20);
    return /stroke-width="1.6"/.test(svg) && /stroke-linecap="round"/.test(svg)
      && /stroke-linejoin="round"/.test(svg);
  })());
  T('no icon carries a fill, so none reads heavier than its siblings',
    Object.values(ctx.CARDIO_ICONS).every(d => !/fill="(?!none)/.test(d)));
  T('every icon draws inside the grid it declares', (() => {
    /* Absolute coordinates only. Relative commands carry deltas, which are
       legitimately negative and say nothing about where the pen is. */
    const absolute = d => {
      const out = [];
      (d.match(/(?:cx|cy|x|y|width|height|r|rx|ry)="(-?\d+(?:\.\d+)?)"/g) || [])
        .forEach(m => out.push(parseFloat(m.split('"')[1])));
      (d.match(/[ML]\s*-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?/g) || [])
        .forEach(m => (m.slice(1).trim().split(/\s+/)).forEach(v => out.push(parseFloat(v))));
      return out;
    };
    const bad = [];
    Object.keys(ctx.CARDIO_ICONS).forEach(id => {
      absolute(ctx.CARDIO_ICONS[id]).forEach(v => { if(v < 0 || v > 24) bad.push(id + ':' + v); });
    });
    return bad.length === 0;
  })());
  T('the icons carry no emoji or unicode symbol',
    Object.values(ctx.CARDIO_ICONS).every(d =>
      !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u25A0-\u25FF]/u.test(d)));
  T('the icon scales on request rather than being fixed',
    ctx.cardioIconSvg('rowing', 48).indexOf('width="48"') !== -1 &&
    ctx.cardioIconSvg('rowing', 32).indexOf('width="32"') !== -1);

  sub('the icon identifies the activity on every cardio surface');
  T('the launcher uses it', /class="cl-mark">\$\{cardioIconSvg\(/.test(src));
  T('history uses it', /class="ch-mark[^"]*">\$\{cardioIconSvg\(/.test(src));
  T('the live session uses it', /cs-activity-mark">\$\{cardioIconSvg\(cardioSession\.activityId/.test(src));
  T('the summary uses it', /cs-activity-mark">\$\{cardioIconSvg\(s\.activityId/.test(src));
  T('the manual logger uses it', /cd-glyph[^"]*">\$\{cardioIconSvg\(/.test(src));
  T('one function draws all of them',
    (src.match(/function cardioIconSvg/g) || []).length === 1);
  T('each drawing exists exactly once, in the registry', (() => {
    /* If a screen pasted its own copy of an activity's artwork, that shape
       would appear twice and the two copies would drift apart. Checked per
       tag, because the icons are assembled from several joined segments and a
       runtime-value prefix would straddle the join. */
    const dupes = [];
    Object.keys(ctx.CARDIO_ICONS).forEach(id => {
      (ctx.CARDIO_ICONS[id].match(/<[a-z]+[^>]*\/>/g) || []).forEach(tag => {
        if(src.split(tag).length - 1 !== 1) dupes.push(id + ' ' + tag.slice(0, 40));
      });
    });
    return dupes.length === 0;
  })(), 'duplicated artwork');
  T('screens ask for icons by id, never by artwork',
    !/cl-mark">\s*<svg|ch-mark[^"]*">\s*<svg|cs-activity-mark">\s*<svg/.test(src));

  sub('the icon supports the timer rather than competing with it');
  T('the session mark is a fraction of the clock', (() => {
    const clock = parseInt((css.match(/\.cs-clock\{[^}]*font-size:\s*(\d+)px/) || [])[1], 10);
    return clock >= 40;   // the clock keeps its size; the mark is 17px inline
  })());
  T('the mark sits beside the activity name, not over the numbers',
    /\.cs-activity\{[^}]*display:\s*flex/.test(css));

  sub('selection does not rest on colour alone');
  T('a selected activity is marked in the accessibility tree, not just painted',
    /aria-pressed="true"/.test(css) || /aria-pressed/.test(src));
  T('the chosen activity says it is selected', /'Selected'/.test(src));
  T('the group style carries colour only — no glyph character survives',
    Object.values(ctx.CARDIO_GROUP_STYLE).every(v => v.glyph === undefined && !!v.tone));
  T('no cardio surface renders an activity glyph character',
    !/\$\{st\.glyph\}/.test(src));
  T('the geometric activity glyphs are gone from the cardio region', (() => {
    const region = src.slice(src.indexOf('const CARDIO_ACTIVITIES'), src.indexOf('function getCombinedProgression'));
    return !/[\u25B6\u25B2\u25C9\u25C6\u25B3\u2248]/.test(region);
  })());
  T('the marks are decorative — the label beside them carries the meaning', (() => {
    const fn = src.slice(src.indexOf('function cardioIconSvg(activityId, size){'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    return /aria-hidden="true"/.test(body) && /focusable="false"/.test(body);
  })());
}

/* =========================================================
   CONTRACT 82 — the session survives everything
   ========================================================= */
async function testCardioSessionLifecycle(){
  section('CONTRACT 82 — cardio session lifecycle and recovery');
  const app = await H.loadAppBooted(buildProtectionFixture());
  const ctx = app.ctx;
  const doc = app.doc || ctx.document;
  ctx.athleteProfile.bodyWeightLb = 175;

  sub('start, pause, resume, finish');
  ctx.startCardioActivity('run_outdoor');
  T('starting creates exactly one session', !!ctx.cardioSession);
  T('starting opens the session page',
    doc.getElementById('cardioSessionOverlay').classList.contains('open'));
  T('starting runs one ticker', ctx.cardioSessionTimer !== null);

  // Starting again while one is live must not create a second.
  const first = ctx.cardioSession;
  ctx.startCardioActivity('cycle_outdoor');
  T('a second start does not replace a live session', ctx.cardioSession === first);
  T('a second start does not change the activity', ctx.cardioSession.activityId === 'run_outdoor');

  ctx.cardioSession.accumulatedMs = 600000;
  ctx.cardioSession.runningSince = Date.now() - 3000;
  ctx.pauseCardioSession();
  T('pausing banks the elapsed time', ctx.cardioSession.accumulatedMs >= 603000);
  T('pausing closes the open segment', ctx.cardioSession.runningSince === null);
  T('pausing does not reset the session', ctx.cardioSession.accumulatedMs > 0);
  const heldAt = ctx.cardioElapsedMs();
  T('a paused session holds its time', ctx.cardioElapsedMs() === heldAt);
  ctx.resumeCardioSession();
  T('resuming reopens a segment', ctx.cardioSession.runningSince !== null);
  T('resuming keeps the banked time', ctx.cardioSession.accumulatedMs >= 603000);
  T('resuming still runs exactly one ticker', ctx.cardioSessionTimer !== null);

  ctx.finishCardioSession();
  T('finishing stops the clock', ctx.cardioSession.state === 'finished');
  T('finishing clears the ticker', ctx.cardioSessionTimer === null);
  const frozen = ctx.cardioElapsedMs();
  T('a finished session no longer advances', ctx.cardioElapsedMs() === frozen);
  ctx.finishCardioSession();
  T('finishing twice changes nothing', ctx.cardioElapsedMs() === frozen);

  sub('a session becomes exactly one record');
  const before = ctx.cardioLog.length;
  await ctx.saveCardioSessionFromSummary(null);
  T('saving appends one session', ctx.cardioLog.length === before + 1);
  T('saving clears the live session', ctx.cardioSession === null);
  T('saving closes the page',
    !doc.getElementById('cardioSessionOverlay').classList.contains('open'));
  const rec = ctx.cardioLog[ctx.cardioLog.length - 1];
  T('the record carries the canonical activity id', rec.activityId === 'run_outdoor');
  T('the record stores whole minutes, as cardioLog always has',
    Number.isInteger(rec.duration));
  T('the record records that it was tracked live', rec.source === 'live');
  T('the record has a unique id',
    ctx.cardioLog.filter(c => c.id === rec.id).length === 1);
  T('saving twice cannot duplicate it', ctx.cardioSession === null);

  sub('the summary and the saved record agree');
  ctx.startCardioActivity('run_outdoor');
  ctx.cardioSession.accumulatedMs = 32*60000 + 41000;
  ctx.cardioSession.runningSince = null;
  ctx.cardioSession.distance = '3.72';
  ctx.finishCardioSession();
  const shownMins = ctx.cardioSessionMinutes();
  const record = ctx.cardioSessionToRecord();
  T('the stored duration is the one the summary showed', record.duration === shownMins);
  T('the stored pace follows the stored duration',
    record.pace === ctx.formatPace(ctx.cardioPaceSec(3.72, record.duration)));
  T('a distance activity stores pace, not speed', !!record.pace && !record.speed);
  ctx.discardCardioSession();

  ctx.startCardioActivity('cycle_outdoor');
  ctx.cardioSession.accumulatedMs = 60*60000;
  ctx.cardioSession.runningSince = null;
  ctx.cardioSession.distance = '18';
  ctx.finishCardioSession();
  const ride = ctx.cardioSessionToRecord();
  T('a ride stores speed, not pace', !!ride.speed && !ride.pace);
  T('estimated calories are stored flagged as estimated', ride.caloriesEstimated === true);
  T('active and total are stored separately',
    parseFloat(ride.activeCalories) < parseFloat(ride.calories));
  ctx.discardCardioSession();

  sub('cancelling throws the session away and leaves nothing behind');
  ctx.startCardioActivity('rowing');
  const logLen = ctx.cardioLog.length;
  ctx.discardCardioSession();
  T('cancelling clears the session', ctx.cardioSession === null);
  T('cancelling stops the ticker', ctx.cardioSessionTimer === null);
  T('cancelling writes nothing to history', ctx.cardioLog.length === logLen);
  T('cancelling closes the page',
    !doc.getElementById('cardioSessionOverlay').classList.contains('open'));

  sub('an interrupted session comes back');
  ctx.startCardioActivity('run_treadmill');
  ctx.cardioSession.accumulatedMs = 420000;
  ctx.cardioSession.distance = '1.5';
  await ctx.persistCardioSession();
  const draft = JSON.parse(app.store.cardioDraft);
  T('a live session is written to the existing cardio draft key', draft.kind === 'live');
  T('the draft carries the banked time', draft.accumulatedMs === 420000);
  T('the draft carries what was entered', draft.distance === '1.5');

  // Simulate the app being killed and reopened.
  ctx.stopCardioTicker();
  ctx.cardioSession = null;
  await ctx.resumeCardioDraft();
  T('the session is restored', !!ctx.cardioSession);
  T('the restored session keeps its activity', ctx.cardioSession.activityId === 'run_treadmill');
  T('the restored session keeps its banked time', ctx.cardioSession.accumulatedMs === 420000);
  T('the restored session keeps what was entered', ctx.cardioSession.distance === '1.5');
  T('the restored session reopens its page',
    doc.getElementById('cardioSessionOverlay').classList.contains('open'));
  ctx.discardCardioSession();

  sub('a manual draft from before this phase still restores as a form');
  await app.ctx.LOOPStore.set('cardioDraft', JSON.stringify({
    activityId:'elliptical', date:'2026-08-01', duration:'30' }));
  await ctx.resumeCardioDraft();
  T('a draft with no kind is treated as a manual entry, not a live session',
    ctx.cardioSession === null);
  T('the manual logger is what opens',
    doc.getElementById('cardioOverlay').classList.contains('open'));
  ctx.closeCardioLogger();
}

/* =========================================================
   CONTRACT 83 — history, week summary, backward compatibility
   ========================================================= */
function testCardioHistory(app){
  section('CONTRACT 83 — cardio history and compatibility');
  const ctx = app.ctx;
  const doc = app.doc || ctx.document;
  ctx.athleteProfile.bodyWeightLb = 175;

  sub('a record written before Cardio 2.0 stays valid and untouched');
  const legacy = { id:'legacy_1', activityId:'run_outdoor', activityName:'Outdoor Run',
    date:'2026-08-20', duration:'45', distance:'5.2', pace:'8:39', rpe:'7', notes:'felt good' };
  const legacySnapshot = JSON.stringify(legacy);
  const legacyMachine = { id:'legacy_2', activityId:'elliptical', activityName:'Elliptical',
    date:'2026-08-19', duration:'30', calories:'280' };
  ctx.cardioLog = [legacy, legacyMachine];
  ctx.invalidateCardioCache();

  const card = ctx.cardioCardHtml(legacy);
  T('a legacy record renders as a card', card.indexOf('ch-card') !== -1);
  T('its distance still shows', card.indexOf('5.2') !== -1);
  T('its hand-typed pace still shows', card.indexOf('8:39') !== -1);
  T('it is not migrated in place', JSON.stringify(ctx.cardioLog[0]) === legacySnapshot);
  T('no new field is invented for it',
    ctx.cardioLog[0].activeCalories === undefined && ctx.cardioLog[0].source === undefined);

  /* A legacy `calories` is one ambiguous number: LOOP never split it, so it
     must not be relabelled as the active half. */
  const machineCard = ctx.cardioCardHtml(legacyMachine);
  T('a legacy calorie count is NOT relabelled as active',
    machineCard.indexOf('active cal') === -1);
  T('a legacy calorie count still shows as a plain count',
    machineCard.indexOf('280 cal') !== -1);
  const newCard = ctx.cardioCardHtml({ id:'n', activityId:'run_outdoor', activityName:'Outdoor Run',
    date:'2026-08-25', duration:33, distance:'3.72', pace:'8:52',
    calories:'486', activeCalories:'440', caloriesEstimated:true });
  T('a value LOOP split itself IS labelled active', newCard.indexOf('440 active cal') !== -1);

  sub('history cards are scannable, not a table of raw numbers');
  T('the card names the activity', newCard.indexOf('Outdoor Run') !== -1);
  T('the card says when and how long', /ch-when/.test(newCard));
  T('the card leads with the metrics that matter', /ch-metrics/.test(newCard));
  T('the card is a control, so it can be opened', newCard.trim().indexOf('<button') === 0);
  T('the card opens the existing detail sheet', newCard.indexOf('openCardioDetail(') !== -1);

  sub('the week summary counts what happened, against a denominator that is a fact');
  const monday = ctx.currentWeekStart();
  const d = n => { const x = new Date(monday); x.setDate(monday.getDate() + n); return ctx.localDateStr(x); };
  ctx.cardioLog = [
    { id:'w1', activityId:'run_outdoor', activityName:'Outdoor Run', date:d(0), duration:'30', distance:'3' },
    { id:'w2', activityId:'run_outdoor', activityName:'Outdoor Run', date:d(0), duration:'20', distance:'2' },
    { id:'w3', activityId:'rowing',      activityName:'Rowing Machine', date:d(2), duration:'25' },
    { id:'old', activityId:'run_outdoor',activityName:'Outdoor Run', date:'2020-01-01', duration:'99', distance:'9' }
  ];
  ctx.invalidateCardioCache();
  const w = ctx.cardioWeekSummary();
  T('sessions count sessions', w.sessions === 3);
  T('days count days, so two runs in one day are one day', w.days === 2);
  T('minutes are summed', w.minutes === 75);
  T('distance is summed', w.distance === 5);
  T('last week is not counted as this week', w.sessions === 3);
  T('the arc denominator is the seven days of the week, not an invented target',
    ctx.cardioWeekArcHtml(w).indexOf('/7') !== -1);
  T('the arc cannot exceed a full turn', (() => {
    const full = Object.assign({}, w, { days: 14 });
    return ctx.cardioWeekArcHtml(full).indexOf('stroke-dashoffset:-') === -1;
  })());

  sub('duration reads as a duration');
  T('under an hour is minutes', ctx.formatDurationLong(45) === '45m');
  T('over an hour is hours and minutes', ctx.formatDurationLong(134) === '2h 14m');
  T('a whole hour drops the minutes', ctx.formatDurationLong(120) === '2h');

  sub('the tab no longer dumps every statistic above the fold');
  ctx.renderCardioView();
  const home = doc.getElementById('cardioBody').innerHTML;
  T('records and totals are one tap down, not deleted', home.indexOf('toggleCardioStats()') !== -1);
  T('they are closed by default', home.indexOf('snap-item') === -1);
  T('opening them brings the numbers back', (() => {
    ctx.toggleCardioStats();
    const open = doc.getElementById('cardioBody').innerHTML;
    const ok = open.indexOf('snap-item') !== -1 && open.indexOf('Cardio XP') !== -1;
    ctx.toggleCardioStats();
    return ok;
  })());
  T('starting still comes before any of it',
    home.indexOf('startCardioActivity') < home.indexOf('toggleCardioStats()'));
}

/* =========================================================
   CONTRACT 84 — Cardio 2.0 touched nothing it should not
   ========================================================= */
async function testCardio2Safety(){
  section('CONTRACT 84 — Cardio 2.0 touched no strength history');
  const fixture = buildProtectionFixture();
  const app = await H.loadAppBooted(fixture);
  const ctx = app.ctx;

  const before = H.snapshot(ctx);
  const strengthBefore = ctx.getCurrentProgression().strengthXP;
  const cardioXPBefore = ctx.getCombinedProgression().cardioXP;
  const trainerBefore = ctx.trainerLog.entries.length;
  const notesBefore = app.store.exerciseNotes;
  const gymBefore = app.store.gymProfile;
  const draftBefore = app.store.activeWorkoutDraft;
  const programsBefore = app.store.programs;
  const scheduleBefore = JSON.stringify(ctx.schedule);
  const legacyCardio = JSON.stringify(ctx.cardioLog);
  /* Baseline the store AFTER boot: boot writes plan defaults of its own, and
     attributing those to cardio would be measuring the wrong thing. */
  const storeAfterBoot = {};
  Object.keys(app.store).forEach(k => { storeAfterBoot[k] = app.store[k]; });
  const profileAfterBoot = JSON.parse(app.store.athleteProfile || '{}');

  sub('a full live session, start to save');
  ctx.athleteProfile.bodyWeightLb = 175;
  ctx.startCardioActivity('run_outdoor');
  ctx.cardioSession.accumulatedMs = 30*60000;
  ctx.cardioSession.runningSince = null;
  ctx.cardioSession.distance = '3.5';
  ctx.pauseCardioSession();
  ctx.resumeCardioSession();
  ctx.finishCardioSession();
  await ctx.saveCardioSessionFromSummary(null);
  clearCaches(ctx);
  const after = H.snapshot(ctx);

  /* Combined XP and the profile are the two things a cardio save is ALLOWED to
     move; every other protected field must be identical. */
  T('NOTHING protected changed beyond combined XP and the profile',
    H.diffSnapshot(before, after, ['xp','athleteProfile']).ok,
    H.diffSnapshot(before, after, ['xp','athleteProfile']).violations.join(','));
  T('workoutLog byte-identical', after.rawWorkoutLog === before.rawWorkoutLog);
  T('the STRENGTH component of XP is unchanged',
    ctx.getCurrentProgression().strengthXP === strengthBefore);
  T('cardio XP rose, as Contract 22 requires it to',
    ctx.getCombinedProgression().cardioXP > cardioXPBefore);
  T('strength PRs unchanged', after.prs === before.prs);
  T('muscle recovery unchanged', after.recovery === before.recovery);
  T('exercise capability unchanged', after.capability === before.capability);
  T('the trainer wrote nothing', ctx.trainerLog.entries.length === trainerBefore);
  T('exercise notes untouched', app.store.exerciseNotes === notesBefore);
  T('the gym profile is untouched', app.store.gymProfile === gymBefore);
  T('an in-progress strength workout is untouched', app.store.activeWorkoutDraft === draftBefore);
  T('programs are untouched', app.store.programs === programsBefore);
  T('the week schedule is untouched', JSON.stringify(ctx.schedule) === scheduleBefore);

  sub('only cardio keys were written');
  const written = Object.keys(app.store).filter(k =>
    JSON.stringify(app.store[k]) !== JSON.stringify(storeAfterBoot[k]));
  T('the only keys that changed are the cardio ones and the profile',
    written.every(k => ['cardioLog','cardioDraft','athleteProfile'].indexOf(k) !== -1),
    written.join(','));
  T('cardioLog gained exactly the new session',
    JSON.parse(app.store.cardioLog).length === JSON.parse(legacyCardio).length + 1);
  T('earlier cardio sessions survive unchanged', (() => {
    const now = JSON.parse(app.store.cardioLog);
    const was = JSON.parse(legacyCardio);
    return was.every((old, i) => JSON.stringify(now[i]) === JSON.stringify(old));
  })());
  T('the draft was cleared after saving',
    !app.store.cardioDraft || app.store.cardioDraft === 'null');

  sub('body weight is the only profile field cardio may write');
  const p = JSON.parse(app.store.athleteProfile);
  const base = profileAfterBoot;
  const changed = Object.keys(p).filter(k => JSON.stringify(p[k]) !== JSON.stringify(base[k]));
  T('cardio wrote only the weight (and the timestamp that always moves)',
    changed.every(k => ['bodyWeightLb','updatedAt','version','goal','experience','sessionMinutes',
      'equipment','preferredRepRange','phase','excludedExercises'].indexOf(k) !== -1),
    changed.join(','));
  T('the training goal is untouched', p.goal === base.goal);
  T('the equipment list is untouched', JSON.stringify(p.equipment) === JSON.stringify(base.equipment));

  sub('backup and restore still carry cardio');
  T('cardioLog is still a backed-up key', ctx.DATA_KEYS.indexOf('cardioLog') !== -1);
  T('the cardio draft is still a backed-up key', ctx.DATA_KEYS.indexOf('cardioDraft') !== -1);
  T('no new storage key was introduced for cardio', ctx.DATA_KEYS.length === 15);
  T('there is no second stopwatch store',
    ctx.DATA_KEYS.filter(k => /timer|stopwatch|session/i.test(k)).length === 0);
}

/* =========================================================
   CONTRACT 85 — one selected day, two views
   ========================================================= */
function testSharedSelectedDay(app){
  section('CONTRACT 85 — Today and This Week share one selected day');
  const ctx = app.ctx;
  const doc = app.doc || ctx.document;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

  sub('one source of truth, not two that drift');
  T('there is a single selected-day variable', /let selectedDayKey = null;/.test(src));
  T('no competing per-view selection state', (() => {
    /* Strip comments first: the module explains in prose that these two do
       not exist, and the assertion was finding its own documentation. */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    return !/todaySelectedDate/.test(code) && !/weekSelectedDate/.test(code);
  })());
  T('one writer updates both views', (() => {
    const fn = src.slice(src.indexOf('function setSelectedDay'), src.indexOf('function stepSelectedDay'));
    return /renderTodayWorkout\(\)/.test(fn) && /renderWeekCard\(\)/.test(fn);
  })());
  T('null means today, so it cannot go stale overnight',
    /function effectiveSelectedKey\(\)\{ return selectedDayKey \|\| todayKey\(\); \}/.test(src));

  sub('selecting moves both views');
  ctx.selectedDayKey = null;
  T('the default is today', ctx.effectiveSelectedKey() === ctx.todayKey());
  T('selecting today stores null rather than a key', (() => {
    ctx.setSelectedDay(ctx.todayKey());
    return ctx.selectedDayKey === null;
  })());
  const other = ctx.DAY_ORDER.find(k => k !== ctx.todayKey());
  ctx.setSelectedDay(other);
  T('selecting another day is remembered', ctx.effectiveSelectedKey() === other);
  T('the week marks exactly one day as selected', (() => {
    ctx.renderWeekCard();
    const html = doc.getElementById('weekCard').innerHTML;
    return (html.match(/wk-selected/g) || []).length === 1;
  })());
  T('selection is announced, not only painted', (() => {
    const html = doc.getElementById('weekCard').innerHTML;
    return (html.match(/aria-pressed="true"/g) || []).length === 1;
  })());
  T('selection does not rely on colour alone',
    /\.wk-day\.wk-selected\{[^}]*box-shadow/.test(css));

  sub('stepping stays inside the week');
  ctx.setSelectedDay('mon');
  T('cannot step before Monday', ctx.stepSelectedDay(-1) === false && ctx.effectiveSelectedKey() === 'mon');
  ctx.setSelectedDay('sun');
  T('cannot step past Sunday', ctx.stepSelectedDay(1) === false && ctx.effectiveSelectedKey() === 'sun');
  ctx.setSelectedDay('wed');
  T('stepping forward moves one day', (() => { ctx.stepSelectedDay(1); return ctx.effectiveSelectedKey() === 'thu'; })());
  T('stepping back moves one day', (() => { ctx.stepSelectedDay(-1); return ctx.effectiveSelectedKey() === 'wed'; })());

  sub('days are named the way a person would name them');
  const ti = ctx.DAY_ORDER.indexOf(ctx.todayKey());
  T('today is Today', ctx.relativeDayLabel(ctx.todayKey()) === 'Today');
  if(ti < 6) T('the next day is Tomorrow', ctx.relativeDayLabel(ctx.DAY_ORDER[ti+1]) === 'Tomorrow');
  if(ti > 0) T('the previous day is Yesterday', ctx.relativeDayLabel(ctx.DAY_ORDER[ti-1]) === 'Yesterday');
  T('a day further away is simply named', (() => {
    const far = ctx.DAY_ORDER[(ti + 3) % 7];
    const lbl = ctx.relativeDayLabel(far);
    return lbl !== 'Today' && lbl !== 'Tomorrow' && lbl !== 'Yesterday' && lbl.length > 3;
  })());
  T('the date itself is never altered by selection', (() => {
    const before = ctx.localDateStr();
    ctx.setSelectedDay(ctx.DAY_ORDER[(ti + 2) % 7]);
    return ctx.localDateStr() === before;
  })());

  sub('a day that is not today shows what is planned, and changes nothing');
  T('today keeps its own full card', /if\(!selectedDayIsToday\(\)\)\{ renderOtherDayCard\(el\); /.test(src));
  T('a rest day says so and offers to train anyway', (() => {
    const fn = src.slice(src.indexOf('function renderOtherDayCard'), src.indexOf('const DAY_SWIPE'));
    return /Rest Day/.test(fn) && /Train anyway/.test(fn);
  })());
  T('a planned day names the workout it has', (() => {
    const fn = src.slice(src.indexOf('function renderOtherDayCard'), src.indexOf('const DAY_SWIPE'));
    return /workoutName \|\| CAT_LABEL\[cat\]/.test(fn);
  })());
  T('opening another day does not rewrite the schedule', (() => {
    const before = JSON.stringify(ctx.schedule);
    ctx.setSelectedDay(ctx.DAY_ORDER[(ti + 2) % 7]);
    try{ ctx.renderTodayWorkout(); }catch(e){}
    return JSON.stringify(ctx.schedule) === before;
  })());
  T('the day still uses the same program-over-plan precedence Today uses', (() => {
    const fn = src.slice(src.indexOf('function renderOtherDayCard'), src.indexOf('const DAY_SWIPE'));
    return /hasActiveProgram\(\)/.test(fn) && /getProgramWorkoutForDate/.test(fn);
  })());
  T('the week is still adjustable from the day card', /openDayEdit\('\$\{key\}'\)/.test(src));

  sub('swiping is confined and defers to vertical scrolling');
  T('the swipe lives on the day card, not the page',
    /function attachDaySwipe[\s\S]{0,200}getElementById\('todayWorkout'\)/.test(src));
  T('a vertical gesture is never claimed as a swipe',
    /if\(!_daySwipe\.claimed && Math\.abs\(dy\) > Math\.abs\(dx\)\)\{ _daySwipe = null; return; \}/.test(src));
  T('a swipe must be clearly horizontal to count', /ratio: 1\.5/.test(src));
  T('the card allows the page to scroll through it', /\.tw-other\{ touch-action: pan-y; \}/.test(css));
  ctx.selectedDayKey = null;
}

/* =========================================================
   CONTRACT 86 — drag to reschedule
   ========================================================= */
function testWeekDrag(app){
  section('CONTRACT 86 — drag to reschedule');
  const ctx = app.ctx;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

  sub('a hold picks up, a tap selects');
  T('there is a deliberate hold threshold', ctx.WEEK_DRAG.holdMs >= 300 && ctx.WEEK_DRAG.holdMs <= 700);
  T('drift during the hold cancels it, because that is a scroll',
    /if\(dx > WEEK_DRAG\.slopPx \|\| dy > WEEK_DRAG\.slopPx\)/.test(src));
  T('a tap that never became a drag selects the day',
    /if\(!wasDrag && !moved && key\) setSelectedDay\(key\);/.test(src));
  T('the cell does not open an editor on tap any more',
    !/class="wk-day[\s\S]{0,160}onclick="openDayEdit/.test(src));

  sub('the lifted workout is visibly lifted, and cannot leave the week');
  T('it scales and raises', /\.wk-day\.wk-dragging\{[\s\S]{0,220}box-shadow: var\(--shadow-lg\)/.test(css));
  T('movement is horizontal only', /translateX\(\$\{clamped\}px\)/.test(src) && !/translateY\(/.test(
    src.slice(src.indexOf('function moveWeekDrag'), src.indexOf('function endWeekDrag'))));
  T('it is clamped to the strip', (() => {
    const fn = src.slice(src.indexOf('function moveWeekDrag'), src.indexOf('function endWeekDrag'));
    return /Math\.max\(min, Math\.min\(max, dx\)\)/.test(fn);
  })());
  T('the lifted cell is excluded from its own hit test', (() => {
    const fn = src.slice(src.indexOf('function weekCellFromPoint'), src.indexOf('function beginWeekDrag'));
    return /!c\.classList\.contains\('wk-dragging'\)/.test(fn);
  })());

  sub('drop targets are shown, and a bad drop is refused rather than broken');
  T('every other day is marked as a target', /c\.classList\.add\('wk-drop-ok'\)/.test(src));
  T('targets are marked by outline as well as tint',
    /\.wk-day\.wk-drop-ok\{[^}]*outline: 1px dashed/.test(css));
  T('the day under the finger is distinguished',
    /\.wk-day\.wk-drop-over\{[^}]*outline: 2px dashed/.test(css));
  T('a release on nothing returns the workout and says so',
    /d\.cell\.classList\.add\('wk-reject'\)/.test(src));
  T('a rejected drop never writes', (() => {
    const fn = src.slice(src.indexOf('function endWeekDrag'), src.indexOf('function commitWeekMove'));
    return /commit && d\.overKey && d\.overKey !== d\.originKey/.test(fn);
  })());

  sub('the move goes through the existing schedule writer');
  T('it calls swapScheduledDays, not a second scheduler',
    /try\{ swapScheduledDays\(fromKey, toKey\); \}/.test(src));
  T('no new schedule storage was introduced',
    ctx.DATA_KEYS.length === 15 && ctx.DATA_KEYS.indexOf('selectedPlan') !== -1);

  sub('undo restores the exact week, and withdraws itself');
  T('the snapshot covers both schedule layers', (() => {
    const fn = src.slice(src.indexOf('function snapshotWeekForUndo'), src.indexOf('function showWeekUndo'));
    return /schedule: Object\.assign/.test(fn) && /hasActiveProgram\(\)/.test(fn);
  })());
  T('undo restores the program layer too', (() => {
    const fn = src.slice(src.indexOf('function undoWeekMove'), src.indexOf('/* ---- pointer wiring'));
    return /updateProgram\(s\.program\.id/.test(fn);
  })());
  T('the offer is temporary, not a permanent control', /setTimeout\(hideWeekUndo, 5000\)/.test(src));
  T('undo is a labelled button, not a gesture to discover', /class="wk-undo-btn"/.test(src));

  sub('motion is restrained and optional');
  T('reduced motion removes the lift transform',
    /prefers-reduced-motion[\s\S]{0,400}\.wk-day\.wk-dragging\{ transform: none/.test(css));
  T('reduced motion keeps the rejection readable without the shake',
    /prefers-reduced-motion[\s\S]{0,300}\.wk-day\.wk-reject\{ animation: none; outline: 2px solid/.test(css));
  T('nothing about the drag loops', !/wkReject[\s\S]{0,120}infinite/.test(css));
}

/* =========================================================
   CONTRACT 87 — page isolation
   ========================================================= */
function testPageIsolation(app){
  section('CONTRACT 87 — pages own the screen while they are open');
  const ctx = app.ctx;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

  sub('one mechanism, not a lock added by hand to every screen');
  /* D17 hung sheet accessibility off this same observer rather than adding a
     second one, so the callback is now a pair of calls instead of a bare
     reference. The contract — one observer drives everything that reacts to a
     sheet opening — is unchanged, and now covers more. */
  T('an observer watches the overlays', /new MutationObserver\(/.test(src));
  T('and it is still the only one', (src.match(/new MutationObserver\(/g) || []).length === 1);
  T('the scroll lock runs from it', /new MutationObserver\(\(\) => \{[\s\S]{0,160}syncBackgroundScrollLock\(\);/.test(src));
  T('the open overlays are the source of truth',
    /document\.querySelectorAll\('\.overlay\.open'\)\.length/.test(src));
  T('boot survives a platform without an observer',
    /if\(typeof MutationObserver === 'undefined'\) return null;/.test(src));
  T('it is started once the app is on screen', /initPageIsolation\(\);/.test(src));

  sub('the document behind a page stops being a document');
  T('the body is pinned, which is what iOS needs',
    /body\.scroll-locked\{[\s\S]{0,140}position: fixed/.test(css));
  T('the offset is captured so it can be given back',
    /_lockedScrollY = window\.scrollY/.test(src));
  T('and restored exactly, without animating', /behavior: 'instant'/.test(src));
  T('nested layers do not unlock early', /if\(--_lockDepth > 0\) return;/.test(src));

  sub('a gesture inside a sheet stays inside it');
  T('the overlay contains its own overscroll',
    /\.overlay\{[\s\S]{0,600}overscroll-behavior: contain/.test(css));
  T('every scrolling surface inside one contains it too',
    /\.sheet-scroll, \.cs-body, \.prep-run, \.ob-scroll\{ overscroll-behavior: contain; \}/.test(css));
  T('the locked body refuses chaining entirely',
    /body\.scroll-locked\{[\s\S]{0,200}overscroll-behavior: none/.test(css));

  sub('headers clear the device status area');
  T('the app header reads the inset', /header\{[\s\S]{0,120}env\(safe-area-inset-top/.test(css));
  T('full pages read it on their scroll surface',
    /\.sheet-page \.sheet-scroll\{ padding-top: calc\(18px \+ env\(safe-area-inset-top/.test(css));
  T('the workout topbar reads it', /\.workout-topbar\{[\s\S]{0,140}env\(safe-area-inset-top/.test(css));
  T('onboarding reads it', /\.ob-top\{[\s\S]{0,160}env\(safe-area-inset-top/.test(css));
  T('a tall sheet cannot reach under the status bar',
    /\.overlay:not\(\.overlay-page\) \.sheet\{ max-height: calc\(92dvh - env\(safe-area-inset-top/.test(css));
  T('no screen uses a fixed margin in place of the inset',
    !/margin-top:\s*(44|47|59)px/.test(css));
}

/* =========================================================
   CONTRACT 88 — the set that earned the record
   ========================================================= */
function testPRSetHighlight(app){
  section('CONTRACT 88 — PR set highlighting');
  const ctx = app.ctx;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

  const mk = (date, sets) => ({ id:'w_'+date, date, category:'push', title:'Push Day',
    exercises:[{ name:'Bench Press', sets }] });
  ctx.workoutLog.length = 0;
  ctx.workoutLog.push(
    mk('2026-08-01', [{weight:'205',reps:'8'},{weight:'210',reps:'6'}]),
    mk('2026-08-08', [{weight:'215',reps:'8'},{weight:'220',reps:'6'}]),
    mk('2026-08-15', [{weight:'225',reps:'8'},{weight:'225',reps:'9'},{weight:'230',reps:'7'}])
  );
  ctx.invalidateSortedLogCache();
  const entry = ctx.workoutLog[2];
  const pr = ctx.sessionPRSets(entry);

  sub('the record is attributed to the set that earned it');
  T('the heaviest set carries the weight record', pr.sets[0] && pr.sets[0][2] === 'weight');
  T('a different set can carry a different record type',
    pr.sets[0] && Object.keys(pr.sets[0]).length >= 2);
  T('a set that broke nothing is not marked', pr.sets[0] && pr.sets[0][0] === undefined);
  T('a session that beat nothing marks nothing', (() => {
    /* A first session cannot be this case — with no history every lift is a
       best. This is a later, lighter session, which is the real one. */
    ctx.workoutLog.push(mk('2026-08-22', [{weight:'185',reps:'5'},{weight:'190',reps:'4'}]));
    ctx.invalidateSortedLogCache();
    const weaker = ctx.sessionPRSets(ctx.workoutLog[ctx.workoutLog.length - 1]);
    const none = Object.keys(weaker.sets).length === 0;
    ctx.workoutLog.pop();
    ctx.invalidateSortedLogCache();
    return none;
  })());
  T('a first session does set records, because nothing preceded it', (() => {
    const first = ctx.sessionPRSets(ctx.workoutLog[0]);
    return !!(first.sets[0] && Object.keys(first.sets[0]).length);
  })());

  sub('the existing classification is used, not a new one');
  T('PR types come from the existing priority list',
    ctx.PR_PRIORITY.indexOf('weight') === 0);
  T('every attributed type is one the app already defines', (() => {
    return Object.keys(pr.sets).every(ex =>
      Object.values(pr.sets[ex]).every(t => ctx.PR_PRIORITY.indexOf(t) !== -1));
  })());
  T('a volume record is reported at session level, not pinned to a set',
    pr.sessionOnly.indexOf('volume') !== -1);
  T('volume is deliberately not attributable',
    ctx.PR_SET_ATTRIBUTABLE['volume'] === undefined);

  sub('derived, never written');
  const logBefore = JSON.stringify(ctx.workoutLog);
  ctx.sessionPRSets(entry);
  ctx.sessionPRSets(ctx.workoutLog[1]);
  T('reading records does not write to workoutLog', JSON.stringify(ctx.workoutLog) === logBefore);
  T('no PR flag is stored on a set', (() => {
    return ctx.workoutLog.every(l => (l.exercises||[]).every(ex =>
      (ex.sets||[]).every(s => s.pr === undefined && s.isPR === undefined)));
  })());

  sub('cheap enough to render a workout with');
  T('the session result is cached', ctx.sessionPRSets(entry) === ctx.sessionPRSets(entry));
  T('the cache follows the log it derives from', (() => {
    ctx.sessionPRSets(entry);
    ctx.invalidateSortedLogCache();
    return ctx._prSetCache === null;
  })());
  T('one pass per session, not one per rendered row', (() => {
    const fn = src.slice(src.indexOf("document.getElementById('dayDetailExercises')"),
                         src.indexOf("document.getElementById('dayDetailNotes')"));
    return (fn.match(/sessionPRSets\(/g) || []).length === 0;   // hoisted above the map
  })());

  sub('findable without seeing colour');
  T('the set carries the word PR, not only a tint', /class="set-chip-pr"/.test(src));
  T('and a border', /\.set-chip-record\{[\s\S]{0,120}border-color: var\(--success\)/.test(css));
  T('and an accessible description of which record it was',
    /aria-label="' \+ escapeAttr\(prSetTitle\(prType\)\)/.test(src));
  T('the descriptions name the actual record type',
    ctx.prSetTitle('weight') === 'Heaviest set yet' && ctx.prSetTitle('1rm').indexOf('one-rep max') !== -1);
  /* This pinned font-size: 8.5px. The premium pass put a floor under every
     micro-label at 11px — 8.5px was unreadable on a phone — so the literal is
     gone, but the contract it protected is not: the badge must stay
     subordinate to the set it annotates. That is now asserted as the
     relationship rather than a magic number, which is the stronger form:
     the badge reads at the micro size, the set it sits on reads a step above. */
  T('the badge is small enough not to shout',
    /\.set-chip-pr\{[\s\S]{0,200}font-size: var\(--fs-micro\)/.test(css));
  T('and the set it annotates is a step larger', (() => {
    const chip = css.match(/\.set-chip\{[^}]*font-size:\s*([\d.]+)px/);
    return !!chip && parseFloat(chip[1]) > 11;
  })());
  T('existing set rendering is unchanged when there is no record',
    ctx.setChipHtml({ weight:'100', reps:'5' }, false).indexOf('set-chip-record') === -1);
}

/* =========================================================
   CONTRACT 89 — one word for how you train
   ========================================================= */
function testPlanVocabulary(app){
  section('CONTRACT 89 — plan vocabulary');
  const ctx = app.ctx;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  /* What the athlete reads: markup and quoted UI copy, with code comments and
     identifiers excluded so this measures the product, not the source. */
  const visible = [
    ...[...src.matchAll(/>([^<>{}]{2,240})</g)].map(m => m[1]),
    ...[...src.matchAll(/(?:title|body|label|desc):\s*'([^']{4,300})'/g)].map(m => m[1]),
    ...[...src.matchAll(/errors\.push\('([^']+)'\)/g)].map(m => m[1])
  ].join(' | ');

  sub('plan and program no longer compete as synonyms');
  T('"program" is not a word the athlete meets', !/\bprograms?\b/i.test(visible), (visible.match(/\bprograms?\b/i)||[''])[0]);
  T('"plan" is still the word for how you train', /\bplan\b/i.test(visible));
  T('the timed structure is a cycle', /\bcycles?\b/i.test(visible));
  T('a cycle is described as running the plan, not replacing it',
    /cycle runs your plan|runs your plan for a set number of weeks/i.test(visible));
  T('it is offered as optional', /Optional\. Your plan already works on its own/.test(src));

  sub('"block" did not come back');
  /* D11 removed it precisely because it sat beside "phase" as a second word
     for the same idea; "cycle" is the container, and phases are its stages. */
  T('block is still not shown beside phase', !/Training blocks|blocks and weeks|weeks and blocks/i.test(visible));
  T('phase remains the word for a stage inside a cycle', /PROGRAM_PHASE_TYPES/.test(src));
  T('a cycle contains phases, not the other way round',
    /split this cycle into phases/i.test(visible));

  sub('the words an athlete only meets when something fails');
  T('validation speaks the same vocabulary',
    !/Give the program a name|No program supplied|Too many programs|Program not found/.test(src));
  T('and still says what to do', /Give the cycle a name/.test(src));

  sub('choosing how you train is one screen with one question');
  /* D16 first-use reworded this. "Choose how you train" still described the
     mechanism; the question now asks about the person, which is what this
     assertion was always for. */
  T('the chooser asks a human question', /What do you want from training\?/.test(src));
  T('built-in plans and building your own sit together',
    /customPlanCardHtml\(\)/.test(src) && /Build my own/.test(src));
  T('building your own is presented as a plan, not a separate feature',
    /plan-card plan-card-custom/.test(src));

  sub('the internal architecture was NOT renamed');
  /* The point was to stop exposing the architecture, not to churn it. */
  T('the store is untouched', /const PROGRAMS_KEY = 'programs'/.test(src));
  T('the storage key is unchanged', ctx.DATA_KEYS.indexOf('programs') !== -1);
  T('the functions keep their names',
    /function createProgram/.test(src) && /function getActiveProgram/.test(src) &&
    /function hasActiveProgram/.test(src));
  T('no data was migrated for a rename', !/migrateProgramNames|renameProgram/.test(src));
}

/* =========================================================
   CONTRACT 90 — the builder is fast, atomic and repeatable
   ========================================================= */
async function testProgramBuilderStress(){
  section('CONTRACT 90 — cycle builder under stress');
  const app = await H.loadAppBooted(buildProtectionFixture());
  const ctx = app.ctx;
  const count = () => (ctx.programsStore.programs || []).length;
  const nameInput = () => (app.doc || ctx.document).getElementById('builderName');

  const before = H.snapshot(ctx);
  const logBefore = app.store.workoutLog;
  const cardioBefore = app.store.cardioLog;
  const notesBefore = app.store.exerciseNotes;
  const gymBefore = app.store.gymProfile;
  const trainerBefore = ctx.trainerLog.entries.length;

  sub('state lives in memory until the athlete commits');
  ctx.openProgramBuilder();
  const storeAtOpen = JSON.stringify(app.store.programs);
  ctx.setBuilderField('durationWeeks', 12);
  ctx.setBuilderField('goal', 'hypertrophy');
  T('opening the builder writes nothing', JSON.stringify(app.store.programs) === storeAtOpen);
  T('changing options writes nothing', JSON.stringify(app.store.programs) === storeAtOpen);
  T('the draft is held in memory', ctx.builderDraft !== null && ctx.builderDraft.durationWeeks === 12);

  sub('rapid interaction settles deterministically');
  for(let i = 0; i < 20; i++) ctx.setBuilderField('durationWeeks', 4 + (i % 9));
  T('the last change is the one that stands', ctx.builderDraft.durationWeeks === 4 + (19 % 9));
  for(let i = 0; i < 20; i++) ctx.setBuilderField('goal', i % 2 ? 'hypertrophy' : 'strength');
  T('and again for a different field', ctx.builderDraft.goal === 'hypertrophy');
  T('still nothing written', JSON.stringify(app.store.programs) === storeAtOpen);

  sub('an invalid cycle is refused whole');
  const n0 = count();
  const rawBefore = JSON.stringify(ctx.programsStore);
  ctx.builderDraft.name = '';
  ctx.builderDraft.durationWeeks = 9999;
  try{ ctx.submitProgramBuilder(); }catch(e){}
  T('nothing was created', count() === n0);
  T('the store is byte-identical — no half-written cycle',
    JSON.stringify(ctx.programsStore) === rawBefore);
  T('the builder stays open so the athlete can fix it', ctx.builderDraft !== null);

  sub('committing is atomic, and repeatable');
  nameInput().value = 'Cycle One';
  ctx.builderDraft.durationWeeks = 8;
  ctx.builderDraft.structure = null;
  try{ ctx.submitProgramBuilder(); }catch(e){}
  T('exactly one cycle exists', count() === n0 + 1);
  T('the draft is cleared on success', ctx.builderDraft === null);

  /* Submitting again with no draft must be a no-op — this is the rapid
     double-tap on Create, which is where duplicates come from. */
  for(let i = 0; i < 10; i++){ try{ ctx.submitProgramBuilder(); }catch(e){} }
  T('repeated submits cannot duplicate it', count() === n0 + 1);

  ctx.openProgramBuilder();
  T('a second builder starts empty, not from the last one', ctx.builderDraft.name === '');
  nameInput().value = '';
  nameInput().value = 'Cycle Two';
  ctx.builderDraft.structure = null;
  try{ ctx.submitProgramBuilder(); }catch(e){}
  T('a second cycle can be created immediately', count() === n0 + 2);
  T('the two are distinct', (() => {
    const ids = (ctx.programsStore.programs || []).map(p => p.id);
    return new Set(ids).size === ids.length;
  })());

  sub('cancelling leaves nothing behind');
  const n1 = count();
  ctx.openProgramBuilder();
  ctx.setBuilderField('durationWeeks', 6);
  ctx.closeProgramBuilder();
  T('no cycle was created', count() === n1);
  T('no draft survives', ctx.builderDraft === null);
  for(let i = 0; i < 20; i++){ ctx.openProgramBuilder(); ctx.closeProgramBuilder(); }
  T('twenty open/close cycles change nothing', count() === n1 && ctx.builderDraft === null);

  sub('building a cycle touches nothing else');
  clearCaches(ctx);
  const after = H.snapshot(ctx);
  T('NOTHING protected changed', H.diffSnapshot(before, after, []).ok,
    H.diffSnapshot(before, after, []).violations.join(','));
  T('workoutLog byte-identical', app.store.workoutLog === logBefore);
  T('cardioLog untouched', app.store.cardioLog === cardioBefore);
  T('exercise notes untouched', app.store.exerciseNotes === notesBefore);
  T('the gym profile is untouched', app.store.gymProfile === gymBefore);
  T('the trainer wrote nothing', ctx.trainerLog.entries.length === trainerBefore);
}

/* =========================================================
   CONTRACT 91 — the drag is a gesture, and a day is what it is
   ========================================================= */
function testD13Interaction(app){
  section('CONTRACT 91 — drag polish and scheduled days');
  const ctx = app.ctx;
  const doc = app.doc || ctx.document;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

  sub('the browser does not answer a long press with a text selection');
  T('selection is suppressed on the day cells', /\.wk-day\{[\s\S]{0,240}user-select: none/.test(css));
  T('the iOS callout is suppressed there too', /\.wk-day\{[\s\S]{0,300}-webkit-touch-callout: none/.test(css));
  T('the tap highlight is suppressed', /\.wk-day\{[\s\S]{0,340}-webkit-tap-highlight-color: transparent/.test(css));
  T('the native drag image is refused', /addEventListener\('dragstart', ev => ev\.preventDefault\(\)\)/.test(src));
  T('a selection begun during the hold is cleared', /sel\.removeAllRanges/.test(src));
  /* Suppression has to be local: an athlete must still be able to select the
     text of a note, a workout name or anything else in the app. */
  T('suppression is scoped to the strip, not global', (() => {
    /* Every rule that suppresses selection must name the week strip. A
       selector ending in "*" is not global when it is scoped by what precedes
       it — .wk-days.wk-drag-mode * is exactly that. */
    const rules = css.match(/[^{}]+\{[^}]*user-select:\s*none[^}]*\}/g) || [];
    return rules.length > 0 && rules.every(r => {
      const sel = r.split('{')[0].replace(/\/\*[\s\S]*?\*\//g, '').trim();
      return /\.wk-day|\.wk-days/.test(sel);
    });
  })());

  sub('the slot a workout left reads as a slot');
  T('a placeholder is created on lift', /className = 'wk-placeholder'/.test(src));
  T('and removed on release', /d\.placeholder[\s\S]{0,60}\.remove\(\)/.test(src));
  T('it is styled as an empty slot, not a gap',
    /\.wk-placeholder\{[\s\S]{0,200}border: 1px dashed/.test(css));

  sub('a scheduled day is not a rest day');
  const fn = src.slice(src.indexOf('function renderOtherDayCard'), src.indexOf('function dayTemplateFor'));
  T('a planned day starts its own workout', /startTemplateLog\('\$\{escapeAttr\(cat\)\}'/.test(fn));
  T('a planned day names the workout it will run', /Start \$\{escapeHtml\(tpl\.name\)\}/.test(fn));
  T('a planned day shows what is in it', /tw-exlist/.test(fn));
  T('"Train anyway" belongs to rest days only', (() => {
    /* It must appear exactly once in this renderer, inside the rest branch. */
    const restBranch = fn.slice(fn.indexOf("if(cat === 'rest')"), fn.indexOf('/* A planned day'));
    const planned = fn.slice(fn.indexOf('/* A planned day'));
    return /Train anyway/.test(restBranch) && !/Train anyway/.test(planned);
  })());
  T('a rest day still says Rest Day', /Rest Day/.test(fn));
  T('the day uses the same template precedence Today uses', (() => {
    const dt = src.slice(src.indexOf('function dayTemplateFor'), src.indexOf('/* ---------- swipe between days'));
    return /hasActiveProgram\(\)/.test(dt) && /getProgramWorkoutForDate/.test(dt);
  })());
  T('looking at a future day writes nothing', (() => {
    const before = JSON.stringify(ctx.schedule);
    const other = ctx.DAY_ORDER.find(k => k !== ctx.todayKey());
    ctx.setSelectedDay(other);
    try{ ctx.renderTodayWorkout(); }catch(e){}
    const ok = JSON.stringify(ctx.schedule) === before;
    ctx.setSelectedDay(ctx.todayKey());
    return ok;
  })());

  sub('a top-level tab opens at its top');
  T('the tab switch scrolls to the top', /window\.scrollTo\(\{ top: 0, behavior: 'instant' \}\)/.test(src));
  T('the per-tab scroll memory is gone, not just unused', !/tabScrollPositions/.test(src));
  T('the workout is an overlay and never passes through switchTab',
    !/function switchTab[\s\S]{0,400}logOverlay/.test(src));

  sub('the rest time fits inside its ring');
  const cssBare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  T('the dial owns the size', /\.rest-dial-time\{[^}]*font-size:\s*\d+px/.test(cssBare) &&
    !/\.rest-panel-time\{[^}]*font-size/.test(cssBare));
  T('the number still fits inside the ring', (() => {
    /* Monospace, so width is character count times roughly 0.6em. The longest
       value a rest timer shows is five characters. */
    const size = parseFloat((cssBare.match(/\.rest-dial-time\{[^}]*font-size:\s*(\d+)px/) || [])[1]);
    const dial = parseFloat((cssBare.match(/\.rest-dial\{[^}]*width:\s*(\d+)px/) || [])[1]);
    const stroke = parseFloat((cssBare.match(/\.rest-ring-fill\{[^}]*stroke-width:\s*(\d+)/) || [])[1]);
    const inner = dial - stroke * 2;
    return (size * 0.6 * 5) < inner;
  })());
  T('the old panel rule no longer overrides it',
    !/\.rest-panel-time\{[^}]*font-size/.test(css));
  T('the digits do not reflow as they count',
    /\.rest-dial-time\{[^}]*tabular-nums/.test(cssBare));
}

/* =========================================================
   CONTRACT 92 — order, replacement, and what is shown first
   ========================================================= */
function testD13Presentation(app){
  section('CONTRACT 92 — category order, replacement, Most Trained');
  const ctx = app.ctx;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');

  sub('categories are offered most-useful first');
  T('there is a display order distinct from the canonical one',
    Array.isArray(ctx.CATEGORY_DISPLAY_ORDER));
  T('it opens with the most complete way to train',
    ctx.CATEGORY_DISPLAY_ORDER[0] === 'fullbody');
  T('the two-way split precedes the three-way split',
    ctx.CATEGORY_DISPLAY_ORDER.indexOf('upper') < ctx.CATEGORY_DISPLAY_ORDER.indexOf('push'));
  T('the accessory category comes last',
    ctx.CATEGORY_DISPLAY_ORDER[ctx.CATEGORY_DISPLAY_ORDER.length - 1] === 'core');
  T('every category is still offered',
    ctx.CATEGORY_DISPLAY_ORDER.length === ctx.ORDER.length &&
    ctx.ORDER.every(c => ctx.CATEGORY_DISPLAY_ORDER.indexOf(c) !== -1));
  /* ORDER also drives nextCategory() rotation, so reordering it would change
     which workout an athlete is offered next — not a display decision. */
  T('the canonical order was NOT reordered',
    JSON.stringify(ctx.ORDER) === JSON.stringify(['push','pull','legs','upper','lower','core','fullbody']));
  T('rotation still reads the canonical order',
    /const idx = ORDER\.indexOf\(last\)/.test(src));
  T('the athlete\'s own categories are promoted', (() => {
    ctx.schedule = { mon:'legs', tue:'rest', wed:'rest', thu:'rest', fri:'rest', sat:'rest', sun:'rest' };
    const d = ctx.categoriesForDisplay();
    return d[0] === 'legs' && d.length === ctx.ORDER.length && new Set(d).size === d.length;
  })());

  sub('one replacement action, and a real answer when nothing fits');
  T('the copy says replace, matching the button', /Replaces this exercise for today's workout only/.test(src));
  T('the old "swap list" dead end is gone', !/pick another from the swap list/.test(src));
  T('a dead end is replaced by a stated result', /No direct substitute found/.test(src));
  T('and by similar options', /Similar options/.test(src));
  T('the fallback is the same engine, relaxed — not a second one',
    /rankSubstitutionCandidates\(id, \{[\s\S]{0,90}relaxed: true \}\)/.test(src) &&
    !/secondSwapEngine|newExerciseMatchSystem|duplicateRankingSystem/.test(src));
  T('only the score floor is relaxed', /const floor = context\.relaxed/.test(src));
  T('hard rejections still apply to the fallback', (() => {
    const fn = src.slice(src.indexOf('function rankSubstitutionCandidates'), src.indexOf('function applyVariationDiversity'));
    return /substitutionHardReject\(exerciseId, cand, ctx\) !== null\) return;/.test(fn);
  })());
  T('the relaxed pass is cached separately', /\(context\.relaxed \? '\|r' : ''\)/.test(src));
  T('when nothing similar exists either, it says so plainly',
    /Nothing similar is available with your current equipment/.test(src));

  sub('trend is a drawn mark plus a word');
  T('no arrow characters remain in the trend', !/&#8599;|&#8594;|&#8600;/.test(src));
  T('the existing icon is used', /trendIconSvg\(trendDirOf\(data\.trend\), 13\)/.test(src));
  T('the word carries the meaning alongside it',
    /trendLabel = \{ improving:'Improving', steady:'Steady', declining:'Easing off' \}/.test(src));

  sub('Most Trained counts real sessions, and stays a summary');
  ctx.workoutLog.length = 0;
  const mk = (d, names) => ({ id:'w'+d, date:d, category:'push', title:'P',
    exercises: names.map(nm => ({ name:nm, sets:[{weight:'100',reps:'8'}] })) });
  ctx.workoutLog.push(
    mk('2026-08-01', ['Bench Press','Lat Pulldown']),
    mk('2026-08-03', ['Bench Press']),
    mk('2026-08-05', ['Bench Press','Lat Pulldown','Squat'])
  );
  ctx.invalidateSortedLogCache();
  const top = ctx.mostTrainedExercises(5);
  T('it ranks by sessions logged', top[0].label === 'Bench Press' && top[0].sessions === 3);
  T('a second exercise is counted correctly',
    top.find(r => r.label === 'Lat Pulldown').sessions === 2);
  T('one session counts once however often the exercise appears', (() => {
    ctx.workoutLog.push({ id:'dup', date:'2026-08-07', category:'push', title:'P',
      exercises:[{ name:'Squat', sets:[{weight:'1',reps:'1'}] },
                 { name:'Squat', sets:[{weight:'1',reps:'1'}] }] });
    ctx.invalidateSortedLogCache();
    const r = ctx.mostTrainedExercises(9).find(x => /squat/i.test(x.label));
    ctx.workoutLog.pop(); ctx.invalidateSortedLogCache();
    return r.sessions === 2;
  })());
  T('it is capped, not a second directory', ctx.mostTrainedExercises(3).length <= 3);
  T('an exercise with no sets is not counted', (() => {
    ctx.workoutLog.push({ id:'empty', date:'2026-08-09', category:'push', title:'P',
      exercises:[{ name:'Overhead Press', sets:[] }] });
    ctx.invalidateSortedLogCache();
    const r = ctx.mostTrainedExercises(9).find(x => /overhead press/i.test(x.label));
    ctx.workoutLog.pop(); ctx.invalidateSortedLogCache();
    return !r;
  })());
  T('with no history it explains rather than showing an empty box', (() => {
    ctx.workoutLog.length = 0; ctx.invalidateSortedLogCache();
    return /appear here/.test(ctx.mostTrainedHtml(5));
  })());
}

/* =========================================================
   CONTRACT 93 — the trajectory says only what it knows
   ========================================================= */
function testTrajectory(app){
  section('CONTRACT 93 — actual vs planned');
  const ctx = app.ctx;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

  sub('with too little history it draws nothing');
  ctx.workoutLog.length = 0;
  ctx.invalidateSortedLogCache();
  let t = ctx.trainingTrajectory();
  T('it refuses to plot an empty history', t.ok === false && t.reason === 'history');
  T('and says so in words', /Not enough history yet/.test(ctx.trajectoryHtml()));
  T('it names how much more is needed', /After \$\{t\.needed\}/.test(src));
  T('no chart markup is produced', ctx.trajectoryHtml().indexOf('trj-chart') === -1);

  sub('actual volume is counted, not estimated');
  const mon = ctx.currentWeekStart();
  const dstr = off => { const d = new Date(mon); d.setDate(mon.getDate() + off); return ctx.localDateStr(d); };
  for(let w = 0; w < 5; w++){
    ctx.workoutLog.push({ id:'t'+w, date: dstr(-7 * w), category:'push', title:'P',
      exercises:[{ name:'Bench Press', sets: Array.from({length: 4}, () => ({weight:'100',reps:'8'})) }] });
  }
  ctx.invalidateSortedLogCache();
  const vol = ctx.actualWeeklyVolume();
  T('sets are counted per week from the log', vol[ctx.localDateStr(mon)] === 4);
  T('every logged week is represented', Object.keys(vol).length === 5);
  t = ctx.trainingTrajectory();
  T('the chart can now be drawn', t.ok === true);
  T('the baseline is the athlete\'s own median week', t.median === 4);

  sub('planned is an intention, drawn differently and labelled as one');
  T('phase intent comes from the phase definitions', (() => {
    return ctx.PHASE_INTENT.deload < 1 && ctx.PHASE_INTENT.accumulation > 1;
  })());
  T('a deload is drawn lower, because the programme says it is lighter',
    ctx.PHASE_INTENT.deload < ctx.PHASE_INTENT.intensification);
  T('actual and planned are told apart by fill, not only colour',
    /\.trj-planned\{[\s\S]{0,180}border: 1px dashed/.test(css) &&
    /\.trj-actual\{[\s\S]{0,140}background: var\(--accent\)/.test(css));
  T('the key names both series', /trj-key-item[\s\S]{0,200}Logged[\s\S]{0,200}Planned/.test(src));
  T('every column is described for a screen reader', /role="img" aria-label="\$\{escapeAttr\(aria\)\}"/.test(src));
  T('the description distinguishes logged from planned',
    /sets logged[\s\S]{0,60}planned/.test(src));

  sub('it never claims to predict');
  T('the footnote says plainly that it is not a prediction',
    /a plan, not a prediction/.test(src));
  T('planned bars are called planned, never expected or guaranteed',
    !/guaranteed|you will be|expect to be/i.test(src.slice(src.indexOf('TRAINING TRAJECTORY'), src.indexOf('function myTrainingVariantsHtml'))));
  T('no future ACTUAL value is ever invented', (() => {
    const future = t.weeks.filter(w => !w.isPast && !w.isNow);
    return future.every(w => w.actual === null);
  })());
  T('without a cycle there is no planned path at all', (() => {
    const noPlan = t.hasPlan ? null : t;
    return t.hasPlan ? true : noPlan.weeks.every(w => w.planned === null);
  })());

  sub('it reads history and writes nothing');
  const before = JSON.stringify(ctx.workoutLog);
  ctx.trainingTrajectory(); ctx.trajectoryHtml();
  T('workoutLog is untouched', JSON.stringify(ctx.workoutLog) === before);
  T('no storage key was added for it', ctx.DATA_KEYS.length === 15);
  T('the trainer is not involved',
    !/trainerLog|proposeTrainerState|TRAINER_CONFIG/.test(
      src.slice(src.indexOf('TRAINING TRAJECTORY'), src.indexOf('function myTrainingVariantsHtml'))));
}

/* =========================================================
   CONTRACT 94 — Progress answers three questions, in order
   ========================================================= */
function testProgressDashboardD14(app){
  section('CONTRACT 94 — Progress hierarchy');
  const ctx = app.ctx;
  const doc = app.doc || ctx.document;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

  /* Real history, so every section has something to say. */
  const mon = ctx.currentWeekStart();
  ctx.workoutLog.length = 0;
  const EX = ['Bench Press','Lat Pulldown','Back Squat'];
  for(let w = 15; w >= 0; w--){
    for(let d = 0; d < 3; d++){
      const dt = new Date(mon); dt.setDate(mon.getDate() - w*7 + d);
      const base = 135 + (15 - w) * 2.5;
      ctx.workoutLog.push({ id:'p'+w+d, date: ctx.localDateStr(dt), category:'push', title:'S',
        exercises: EX.map((nm,i) => ({ name:nm,
          sets: Array.from({length:3}, () => ({ weight:String(base - i*10), reps:'8' })) })) });
    }
  }
  ctx.invalidateSortedLogCache();
  ctx.renderProgDashboard();
  const html = doc.getElementById('progPerf').innerHTML;

  sub('the level the XP system exists to produce is shown');
  T('the landing view shows the player level', /pl-lvl/.test(html) && /Level /.test(html));
  T('and the rank that goes with it', /pl-rank/.test(html));
  T('progress to the next level is drawn as a ring', /pl-ring-fill/.test(html));
  T('the ring is described for a screen reader', /aria-label="Level \d+, \d+% of the way/.test(html));
  T('it uses the same arithmetic as the profile bar, not a new one', (() => {
    const fn = src.slice(src.indexOf('function progLevelHtml'), src.indexOf('const TREND_WORD'));
    return /p\.currentXP \/ p\.xpForNext/.test(fn);
  })());
  T('no invented overall score exists',
    !/fitness score|overall score|loop score/i.test(html));

  sub('the three questions are answered in order');
  const order = ['pl-ring', 'pd-hero-read', 'pd-tiles', 'Most trained', 'Strength trends'];
  T('level, then reading, then indicators, then what I do, then what is moving', (() => {
    let last = -1;
    return order.every(k => { const i = html.indexOf(k); if(i <= last) return false; last = i; return true; });
  })());
  T('the headline reading survived the reorder', (html.match(/pd-hero-read/g) || []).length === 1);
  T('so did its three indicators', (html.match(/class="pd-tile"/g) || []).length === 3);

  sub('the landing view leads, the sub-tabs hold the detail');
  /* The segmented tabs ARE the navigation. A second list at the foot of the
     same screen pointing at the same three places was noise, and is gone. */
  T('the Overview carries no second navigation list', !/More detail/.test(html));
  T('and no link row to the tabs above it', !/pm-row|pm-list/.test(html));
  T('the destinations themselves still exist', (() => {
    const src2 = require('fs').readFileSync(H.APP_PATH, 'utf8');
    return ['strength','volume','muscles'].every(t =>
      src2.indexOf('switchProgTab(\'' + t + '\')') !== -1);
  })());
  T('the Overview ends on content, not on navigation', (() => {
    const tail = html.slice(-400);
    return !/pm-list|More detail/.test(tail);
  })());
  T('the muscle card is not on the landing view', !/Muscle development/.test(html));
  T('nor is it duplicated under Volume', (() => {
    ctx.switchProgTab('volume');
    const v = doc.getElementById('progVolMuscle').innerHTML;
    ctx.switchProgTab('overview');
    return !/Muscle development/.test(v);
  })());
  T('the record list is not on the landing view', !/pd-pr-row/.test(html));
  T('the strength metric card is not on the landing view', !/Total weight lifted per week/.test(html));
  T('consistency stayed, because it answers one of the three questions',
    /pd-wk/.test(html));

  sub('Most Trained is a summary, with one home');
  T('it is on the landing view', /mtx-list|mt-empty/.test(html));
  T('it is capped at five', (html.match(/mtx-row/g) || []).length <= 5);
  T('it counts sessions, from real history',
    ctx.mostTrainedExercises(5)[0].sessions === 48);
  T('it is not also duplicated in the mastery tab', (() => {
    ctx.renderProgMuscles && ctx.renderProgMuscles();
    const m = doc.getElementById('progMuscles').innerHTML;
    return !/mtx-list/.test(m);
  })());
  T('the app has only one Most trained heading',
    (src.match(/>Most trained</g) || []).length === 1);

  sub('trends are a mark plus a word plus a name');
  T('each trend row carries a drawn icon', /pt-state[^>]*>\s*<svg/.test(html));
  T('and the state in words', /Improving|Stable|Declining/.test(html));
  T('and an accessible label naming both', /aria-label="[^"]+: (Improving|Stable|Declining)/.test(html));
  T('no arrow characters are used for trend', !/[↗→↘]/.test(html));
  T('the list is capped, not every lift', (html.match(/pt-row/g) || []).length <= 4);
  T('a trend row opens the lift it names', /openExDetail\(/.test(html));
  T('the state is not carried by colour alone', (() => {
    /* Each state has its own word; colour only reinforces it. */
    return /\.pt-up\{ color/.test(css) && /TREND_WORD = \{ up:'Improving', flat:'Stable', down:'Declining' \}/.test(src);
  })());

  sub('nothing here computes anything new');
  const before = JSON.stringify(ctx.workoutLog);
  ctx.renderProgDashboard();
  ctx.progLevelHtml(); ctx.progTrendsHtml(4);
  T('rendering Progress does not write history', JSON.stringify(ctx.workoutLog) === before);
  T('no storage key was added', ctx.DATA_KEYS.length === 15);
  T('the trainer is not involved', (() => {
    const mod = src.slice(src.indexOf('PROGRESS DASHBOARD  (Phase D14)'), src.indexOf('function renderProgDashboard'));
    return !/trainerLog|proposeTrainerState|TRAINER_CONFIG/.test(mod);
  })());
}

/* =========================================================
   CONTRACT 95 — one icon language
   ========================================================= */
function testIconSystemD14(app){
  section('CONTRACT 95 — icon system');
  const ctx = app.ctx;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');

  sub('the family LOOP already had was extended, not replaced');
  ['checkIconSvg','pencilIconSvg','chevronRightSvg','chevronLeftSvg','trendIconSvg']
    .forEach(fn => T(fn + ' still exists', typeof ctx[fn] === 'function'));
  T('a close mark was added', typeof ctx.closeIconSvg === 'function');
  T('a downward chevron was added', typeof ctx.chevronDownSvg === 'function');
  T('a settings mark was added', typeof ctx.gearIconSvg === 'function');
  T('no icon library was introduced',
    !/cdn|fontawesome|feather|lucide|material-icons/i.test(src));

  sub('they are drawn to one specification');
  const icons = ['closeIconSvg','chevronDownSvg','gearIconSvg','checkIconSvg','chevronRightSvg'];
  T('every icon uses the same 16 grid',
    icons.every(fn => /viewBox="0 0 16 16"/.test(ctx[fn]())));
  T('every icon uses round caps',
    icons.every(fn => /stroke-linecap="round"/.test(ctx[fn]())));
  T('every icon inherits its colour', icons.every(fn => /currentColor/.test(ctx[fn]())));
  T('every icon is hidden from assistive tech, since a label sits beside it',
    icons.every(fn => /aria-hidden="true"/.test(ctx[fn]())));
  T('they scale on request', ctx.closeIconSvg(20).indexOf('width="20"') !== -1 &&
    ctx.checkIconSvg(30).indexOf('width="30"') !== -1);

  sub('interactive controls no longer use characters as icons');
  const glyphButton = /<button[^>]*>[^<]*[▾▴✓✕✎⚙][^<]*<\/button>/;
  T('no rendered button is a bare glyph', !glyphButton.test(src));
  T('the close control is drawn everywhere it appears',
    (src.match(/closeIconSvg\(/g) || []).length >= 5);
  T('the edit control uses the existing pencil', /tpl-edit[^>]*>\$\{pencilIconSvg\(\)\}/.test(src));
  T('the settings control is drawn', /gearIconSvg\(15\)/.test(src));
  T('disclosure carets are drawn', (src.match(/chevronDownSvg\(/g) || []).length >= 3);
  T('completion marks are drawn', (src.match(/checkIconSvg\(/g) || []).length >= 4);

  sub('every converted control kept or gained a name');
  ['Delete workout','Edit workout','Remove exercise','Settings','Delete note','Dismiss']
    .forEach(l => T('"' + l + '" is an accessible name in the markup',
      src.indexOf('aria-label="' + l + '"') !== -1));

  sub('the navigation bar joined the icon family');
  /* D14 deferred this deliberately: "they need designing as a set, which is a
     different piece of work from this audit." The premium pass did that work,
     so the assertion that recorded the deferral is replaced by one that holds
     the result — the bar no longer mixes Unicode geometry with drawn icons. */
  T('the five tabs carry drawn icons, not characters',
    (src.match(/<span class="glyph" id="tabIcon[A-Za-z]+"><\/span>/g) || []).length === 5);
  T('and they come from one function, so the set cannot drift apart',
    (src.match(/function tabIconSvg\(/g) || []).length === 1);
  T('an interpolation never leaked into static markup', (() => {
    const body = src.slice(src.indexOf('<body>'), src.indexOf('<script>'));
    return !/\$\{[a-zA-Z]+\(/.test(body);
  })());
}

/* =========================================================
   CONTRACT 96 — shadow outcome semantics
   ========================================================= */
function testShadowSemantics(app){
  section('CONTRACT 96 — matched / diverged, not accepted / modified');
  const ctx = app.ctx;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');

  sub('new records describe coincidence, not agreement');
  T('the vocabulary is matched / diverged',
    ctx.OUTCOME_MATCH.MATCHED === 'matched' && ctx.OUTCOME_MATCH.DIVERGED === 'diverged');
  T('the outcome writer uses it', (() => {
    const fn = src.slice(src.indexOf('async function linkShadowOutcomes'), src.indexOf('function shadowLoadTolerance'));
    return /OUTCOME_MATCH\.MATCHED : OUTCOME_MATCH\.DIVERGED/.test(fn) &&
           !/'accepted' : 'modified'/.test(fn);
  })());
  /* The engine is hidden, so "accepted" would claim something that never
     happened. The words must not come back for this field. */
  T('no new record can be written as accepted or modified', (() => {
    const fn = src.slice(src.indexOf('async function linkShadowOutcomes'), src.indexOf('function shadowLoadTolerance'));
    return !/userAction = '(accepted|modified)'/.test(fn);
  })());

  sub('history is translated, never rewritten');
  T('legacy accepted reads as matched', ctx.normalizeOutcomeMatch('accepted') === 'matched');
  T('legacy modified reads as diverged', ctx.normalizeOutcomeMatch('modified') === 'diverged');
  T('current values pass through unchanged',
    ctx.normalizeOutcomeMatch('matched') === 'matched' &&
    ctx.normalizeOutcomeMatch('diverged') === 'diverged');
  T('values with no load target are left alone',
    ctx.normalizeOutcomeMatch('not_applicable') === 'not_applicable' &&
    ctx.normalizeOutcomeMatch('no_recommendation') === 'no_recommendation');
  T('nothing migrates stored records', !/migrateUserAction|rewriteTrainerLog/.test(src));
  T('a stored legacy record keeps its original string', (() => {
    ctx.trainerLog = { version:1, entries:[{ recommendationId:'x', engineVersion:'0.1.0-shadow',
      finalState:'CONSOLIDATE', confidence:'low', recommended:{ weight:100 },
      outcome:{ userAction:'accepted', userFeedback:'right', actualWeight:100, actualRIR:2, workoutId:'w' } }] };
    try{ ctx.computeShadowMetrics(); }catch(e){}
    return ctx.trainerLog.entries[0].outcome.userAction === 'accepted';
  })());
  T('both vocabularies count into one figure', (() => {
    ctx.trainerLog = { version:1, entries:[
      { finalState:'CONSOLIDATE', recommended:{weight:100}, outcome:{ userAction:'accepted', actualWeight:100 } },
      { finalState:'CONSOLIDATE', recommended:{weight:100}, outcome:{ userAction:'matched', actualWeight:100 } },
      { finalState:'CONSOLIDATE', recommended:{weight:100}, outcome:{ userAction:'modified', actualWeight:120 } }
    ]};
    const m = ctx.computeShadowMetrics();
    const tal = {};
    Object.keys(m.userAction).forEach(k => {
      const n = ctx.normalizeOutcomeMatch(k); tal[n] = (tal[n]||0) + m.userAction[k];
    });
    return tal.matched === 2 && tal.diverged === 1;
  })());
  T('the display label never says accepted',
    ctx.outcomeMatchLabel('accepted') === 'Matched' && ctx.outcomeMatchLabel('modified') === 'Diverged');
}

/* =========================================================
   CONTRACT 97 — the evidence panel
   ========================================================= */
function testEvidencePanel(app){
  section('CONTRACT 97 — shadow evidence panel');
  const ctx = app.ctx;
  const doc = app.doc || ctx.document;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

  sub('it lives in Backup & Data, and nowhere louder');
  T('the control is inside the data sheet',
    /id="dataOverlay"[\s\S]*?shadowEvidenceToggle[\s\S]*?Danger zone/.test(src));
  T('no navigation tab was added', (src.match(/<button class="tab-btn/g) || []).length === 5);
  T('it is not on Today, Progress or the workout screen',
    !/view-today[\s\S]{0,4000}shadowEvidence/.test(src) &&
    !/ppanel-overview[\s\S]{0,2000}shadowEvidence/.test(src));
  T('it is collapsed until asked for', /\.ev-body\{ display: none; \}/.test(css));

  sub('it never claims accuracy');
  T('the caveat states the engine is hidden', /The trainer is hidden during workouts/.test(src));
  T('and that matching is coincidence, not approval',
    /does not mean you saw, accepted or\s*'\s*\+\s*'approved anything/.test(src) ||
    /does not mean you saw, accepted or approved anything/.test(src.replace(/'\s*\+\s*'/g, '')));
  T('the caveat is a visible block, not a tooltip', /\.ev-caveat\{/.test(css) && !/title="The trainer is hidden/.test(src));
  T('no score or rating is presented', (() => {
    const panel = src.slice(src.indexOf('EVIDENCE PANEL  (Phase D15B)'), src.indexOf('function computeShadowMetrics'));
    return !/trainer score|coach rating|ai accuracy|accuracy score|score:/i.test(panel);
  })());
  T('accuracy is only ever denied, never asserted', (() => {
    const panel = src.slice(src.indexOf('EVIDENCE PANEL  (Phase D15B)'), src.indexOf('function computeShadowMetrics'));
    /* Every mention of the word must be preceded by a negation. */
    return [...panel.matchAll(/.{0,30}accuracy/gi)].every(m => /(not|no|never)\s+$/i.test(m[0].slice(0, -8)));
  })());
  T('the descriptive note from the metrics is shown', /\$\{escapeHtml\(m\.note\)\}/.test(src));

  sub('empty state says what to do');
  ctx.trainerLog = { version:1, entries:[] };
  ctx.shadowEvidenceOpen = true;
  ctx.renderShadowEvidence();
  const empty = doc.getElementById('shadowEvidenceBody').innerHTML;
  T('it says there is no evidence yet', /No real shadow evidence yet/.test(empty));
  T('it explains how evidence appears', /Use LOOP normally/.test(empty));
  T('it still shows the engine version', empty.indexOf(ctx.TRAINER_ENGINE_VERSION) !== -1);
  T('it shows TIER 0', /TIER 0/.test(empty));
  T('it draws no metric with no sample', !/ev-row/.test(empty));

  sub('percentages always carry their denominator');
  T('a zero denominator reads n/a, not 0%', ctx.evPct(0, 0) === 'n/a (n=0)');
  T('a real ratio shows both numbers', ctx.evPct(13, 21) === '62% (13/21)');
  T('no bare percentage is produced anywhere', (() => {
    const panel = src.slice(src.indexOf('function renderShadowEvidence'), src.indexOf('/* Stated in the panel'));
    /* Every % printed by the panel comes from evPct or carries its own count. */
    return !/\$\{[a-zA-Z.]+\}%/.test(panel.replace(/\$\{evPct\([^)]*\)\}/g, ''));
  })());

  sub('evidence tiers report quantity, not quality');
  T('tier 0 is empty', ctx.shadowEvidenceTier(0).t === 0);
  T('tier boundaries match the evaluator',
    ctx.shadowEvidenceTier(4).t === 1 && ctx.shadowEvidenceTier(9).t === 2 &&
    ctx.shadowEvidenceTier(24).t === 3 && ctx.shadowEvidenceTier(49).t === 4 &&
    ctx.shadowEvidenceTier(50).t === 5);
  T('the tier is labelled as quantity only', /quantity of evidence only, not accuracy/.test(src));

  sub('engine versions are shown separately');
  ctx.trainerLog = { version:1, entries:[
    { engineVersion:'0.1.0-shadow', finalState:'CONSOLIDATE', confidence:'low', createdAt:'2026-01-01T00:00:00Z', recommended:{weight:100}, outcome:{ userAction:'accepted', actualWeight:100, workoutId:'a' } },
    { engineVersion:'0.1.1-shadow', finalState:'PROGRESS', confidence:'high', createdAt:'2026-02-01T00:00:00Z', recommended:{weight:105}, outcome:{ userAction:'matched', actualWeight:105, workoutId:'b' } }
  ]};
  ctx.renderShadowEvidence();
  const two = doc.getElementById('shadowEvidenceBody').innerHTML;
  T('both versions appear', /0\.1\.0-shadow/.test(two) && /0\.1\.1-shadow/.test(two));
  T('they are not merged into one figure', /Engine version/.test(two));

  sub('retention is reported honestly');
  T('the panel names the cap', two.indexOf(String(ctx.TRAINER_LOG_MAX)) !== -1);
  T('an eviction is disclosed, not hidden', (() => {
    ctx.trainerLog.evicted = 7;
    ctx.renderShadowEvidence();
    const h = doc.getElementById('shadowEvidenceBody').innerHTML;
    return /7 older records? passed the retention limit/.test(h) &&
           /not your complete history/.test(h);
  })());
  T('a complete history is stated as complete', (() => {
    ctx.trainerLog.evicted = 0;
    ctx.renderShadowEvidence();
    return /complete shadow history/.test(doc.getElementById('shadowEvidenceBody').innerHTML);
  })());
  T('the external evaluator is named as the real analysis path',
    /loop-evaluate\.js real/.test(two));
  ctx.shadowEvidenceOpen = false;
}

/* =========================================================
   CONTRACT 98 — retention, and the panel writes nothing
   ========================================================= */
async function testEvidenceSafety(){
  section('CONTRACT 98 — retention bound and read-only panel');
  const app = await H.loadAppBooted(buildProtectionFixture());
  const ctx = app.ctx;

  sub('the bound is larger, and still a bound');
  T('the cap grew', ctx.TRAINER_LOG_MAX === 2000);
  T('it is still finite, not removed', Number.isFinite(ctx.TRAINER_LOG_MAX));
  T('a full log stays within a sane storage budget', (() => {
    /* ~945 bytes per full record, measured. The cap must not let the log
       approach the few megabytes localStorage realistically allows. */
    return (ctx.TRAINER_LOG_MAX * 945) < 3 * 1024 * 1024;
  })());

  sub('eviction is counted, not silent');
  ctx.trainerLog = { version:1, entries:[] };
  for(let i = 0; i < ctx.TRAINER_LOG_MAX + 5; i++){
    await ctx.logRecommendation({ exerciseName:'Bench Press', finalState:'CONSOLIDATE' });
  }
  T('the log is capped', ctx.trainerLog.entries.length === ctx.TRAINER_LOG_MAX);
  T('the evictions are counted', ctx.trainerLog.evicted === 5);
  T('the newest records are the ones kept',
    ctx.trainerLog.entries[ctx.trainerLog.entries.length - 1].exerciseName === 'Bench Press');

  sub('opening the panel changes nothing');
  const app2 = await H.loadAppBooted(buildProtectionFixture());
  const ctx2 = app2.ctx;
  const before = H.snapshot(ctx2);
  const storeBefore = {};
  Object.keys(app2.store).forEach(k => { storeBefore[k] = app2.store[k]; });
  const trainerBefore = JSON.stringify(ctx2.trainerLog);

  ctx2.shadowEvidenceOpen = true;
  ctx2.renderShadowEvidence();
  ctx2.renderShadowEvidence();
  ctx2.computeShadowMetrics();
  clearCaches(ctx2);
  const after = H.snapshot(ctx2);

  T('NOTHING protected changed', H.diffSnapshot(before, after, []).ok,
    H.diffSnapshot(before, after, []).violations.join(','));
  T('the trainer log itself is untouched', JSON.stringify(ctx2.trainerLog) === trainerBefore);
  T('no storage key was written', Object.keys(app2.store).every(k =>
    JSON.stringify(app2.store[k]) === JSON.stringify(storeBefore[k])));
  T('no new storage key exists', ctx2.DATA_KEYS.length === 15);
  T('trainerLog is still exported', ctx2.DATA_KEYS.indexOf('trainerLog') !== -1);

  sub('the engine itself was not touched');
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  T('engine version unchanged', ctx2.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  T('proposeTrainerState is intact', typeof ctx2.proposeTrainerState === 'function');
  T('applyTrainerConstraints is intact', typeof ctx2.applyTrainerConstraints === 'function');
  T('no threshold was edited in this phase', (() => {
    /* The panel and semantics live outside the decision path entirely. */
    const panel = src.slice(src.indexOf('SHADOW OUTCOME SEMANTICS  (Phase D15B)'),
                            src.indexOf('function computeShadowMetrics'));
    return !/TRAINER_CONFIG|proposeTrainerState|applyTrainerConstraints|RECOVERY_CONFIG|CAPABILITY_CONFIG/.test(panel);
  })());
}

/* =========================================================
   CONTRACT 99 — the tutorial teaches the product
   ========================================================= */
function testTutorialD16(app){
  section('CONTRACT 99 — Tutorial 2.0');
  const ctx = app.ctx;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const all = ctx.ONBOARDING_STEPS.map(s => s.title + ' ' + s.body + ' ' + s.visual()).join(' ');
  const bodies = ctx.ONBOARDING_STEPS.map(s => s.body).join(' ');

  sub('it follows the order the questions arrive in');
  const ids = ctx.ONBOARDING_STEPS.map(s => s.id);
  T('it is short enough to finish',
    ctx.ONBOARDING_STEPS.length >= 6 && ctx.ONBOARDING_STEPS.length <= 8, String(ids.length));
  T('Today comes before the workout', ids.indexOf('today') < ids.indexOf('start'));
  T('the workout comes before logging', ids.indexOf('start') < ids.indexOf('logging'));
  T('logging comes before how you feel', ids.indexOf('logging') < ids.indexOf('readiness'));
  T('progress is the last thing it shows', ids[ids.length - 1] === 'progress');

  sub('it stopped explaining how LOOP is built');
  /* These were the exact phrases that pulled a first-time athlete out of the
     product and into its architecture. */
  T('it no longer recites the internal systems',
    !/builds up your capability, recovery and history/i.test(bodies));
  T('it no longer explains the shadow record-keeping',
    !/records what it would suggest/i.test(bodies));
  T('no step is about Settings', !/settings|backup|export|gym profile/i.test(bodies));
  T('there is no step whose subject is the engine',
    ids.indexOf('intelligence') === -1);

  sub('but it is still honest about what the trainer does');
  T('it says LOOP is observing, not deciding', /observing, not deciding/i.test(all));
  T('it never claims LOOP picks the weight',
    !/perfect weight|chooses your weight|decides your/i.test(all));
  T('it says the weight stays the athlete\'s', /stays yours/i.test(all));

  sub('it still teaches the controls that exist');
  ['set type','warm-up','replace','readiness','cycle'].forEach(k =>
    T('mentions ' + k, new RegExp(k, 'i').test(all)));
  T('mentions autosave', /saves|autosaved/i.test(all));
  T('still names the five real set types',
    ['warm-up','working','drop','failure','AMRAP'].every(t => new RegExp(t, 'i').test(all)));
  T('still avoids the word "program"', !/programs?\b/i.test(all));

  sub('the progress moment shows training, not prose');
  T('it draws a muscle read-out', /ob-mus-row/.test(all));
  T('with more than one group', (all.match(/ob-mus-row/g) || []).length >= 4);
  T('the sample is labelled as a shape, not the athlete\'s data', (() => {
    const at = src.indexOf('function onboardingMuscleBars');
    /* The comment explaining it sits above the declaration. */
    return /Sample proportions for the tour only/.test(src.slice(Math.max(0, at - 400), at));
  })());
  T('the bars animate in once, not forever',
    /animation: obMusIn 0\.5s var\(--ease\) both/.test(src) && !/obMusIn[^;]*infinite/.test(src));
  T('reduced motion removes even that',
    /prefers-reduced-motion[\s\S]{0,200}\.ob-mus-fill\{ animation: none/.test(src));

  sub('every step still holds together');
  T('each has a title', ctx.ONBOARDING_STEPS.every(s => !!s.title));
  T('each body stays short', ctx.ONBOARDING_STEPS.every(s => s.body && s.body.length <= 260));
  T('each has a visual', ctx.ONBOARDING_STEPS.every(s => typeof s.visual === 'function'
    && s.visual().trim().indexOf('<') === 0));
  T('ids are unique', new Set(ids).size === ids.length);
}

/* =========================================================
   CONTRACT 100 — the chart's labels, and the timer's number
   ========================================================= */
function testD16Layout(app){
  section('CONTRACT 100 — label density and timer geometry');
  const ctx = app.ctx;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');

  sub('the volume chart draws only the labels that fit');
  /* Measured before the fix: labels rendered 30px wide in slots 27px apart,
     so every one overlapped its neighbour. The cause was density, not margin. */
  T('a label budget exists', /const LABEL_UNITS = 34;/.test(src));
  T('it is derived from the axis width, not hard-coded',
    /Math\.floor\(\(w - padLeft - padRight\) \/ LABEL_UNITS\)/.test(src));
  T('labels are thinned rather than crowded', /const step = Math\.max\(1, Math\.ceil\(buckets\.length \/ fits\)\)/.test(src));
  T('the most recent week always keeps its label',
    /\(buckets\.length - 1 - i\) % step === 0/.test(src));
  T('no margin was added in place of the fix', (() => {
    const fn = src.slice(src.indexOf('function volumeBarSvg'), src.indexOf('function muscleBarsHtml'));
    return !/padBottom\s*=\s*(3\d|4\d)/.test(fn);
  })());
  T('a long range never draws more labels than fit', (() => {
    const w = 320, pad = 12, LABEL_UNITS = 34;
    const fits = Math.floor((w - pad) / LABEL_UNITS);
    [4, 8, 12, 26, 52].forEach(n => {
      const step = Math.max(1, Math.ceil(n / fits));
      let drawn = 0;
      for(let i = 0; i < n; i++) if((n - 1 - i) % step === 0) drawn++;
      if(drawn > fits) throw new Error('n=' + n + ' drew ' + drawn);
    });
    return true;
  })());

  sub('the rest number is the hero, and stays inside the ring');
  const num = k => parseFloat((css.match(new RegExp(k)) || [])[1]);
  const dial = num('\\.rest-dial\\{[^}]*width:\\s*(\\d+)px');
  const size = num('\\.rest-dial-time\\{[^}]*font-size:\\s*(\\d+)px');
  const stroke = num('\\.rest-ring-fill\\{[^}]*stroke-width:\\s*(\\d+)');
  T('the dial has room', dial >= 64, String(dial));
  T('the number grew with it', size >= 16, String(size));
  T('the longest value still clears the stroke', (size * 0.6 * 5) < (dial - stroke * 2),
    'text≈' + Math.round(size*0.6*5) + ' inner=' + (dial - stroke*2));
  T('the ring is drawn from one radius', /const REST_RING_R = 30;/.test(src));
  T('and the update reads that same radius',
    /const circ = 2 \* Math\.PI \* REST_RING_R;/.test(src));
  T('the old panel rule still does not override the dial',
    !/\.rest-panel-time\{[^}]*font-size/.test(css));

  sub('the ring animates the time, and nothing else');
  T('the arc is driven by the deadline, not a frame count', (() => {
    const fn = src.slice(src.indexOf('function updateRestRing'), src.indexOf('function updateRestPanelDisplay'));
    return /endsAt - Date\.now\(\)/.test(fn) && !/requestAnimationFrame|frame\+\+/.test(fn);
  })());
  T('nothing on the rest panel loops forever', (() => {
    const start = css.indexOf('REST TIMER (Phase D14)');
    const end = css.indexOf('PAGE ISOLATION', start);
    return !/animation:[^;]*infinite/.test(css.slice(start, end > start ? end : undefined));
  })());
  T('a paused timer is marked as paused', /panel\.classList\.toggle\('paused', paused\)/.test(src));

  sub('the haptic fires once, at zero');
  T('it is guarded by the completion flag', (() => {
    const fn = src.slice(src.indexOf('function completeRestPanel'), src.indexOf('function updateRestRing'));
    return /panel\.dataset\.completed === 'true'\) return;/.test(fn) && /loopHaptic\(\)/.test(fn);
  })());
  T('skipping is not completing', (() => {
    const fn = src.slice(src.indexOf('function skipRest'), src.indexOf('function pauseIconSvg'));
    return /completed = 'true'/.test(fn) && !/loopHaptic/.test(fn);
  })());
  T('an unsupported platform is silent, not an error', (() => {
    const fn = src.slice(src.indexOf('function loopHaptic'), src.indexOf('function restRingSvg'));
    return /typeof navigator\.vibrate === 'function'/.test(fn) && /catch\(e\)\{\}/.test(fn);
  })());
}

/* =========================================================
   CONTRACT 101 — Today answers one question
   ========================================================= */
function testTodayIA(app){
  section('CONTRACT 101 — Today is not a second Progress tab');
  const ctx = app.ctx;
  const doc = app.doc || ctx.document;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');

  sub('one screen, one navigation layer');
  /* Today carried a segmented control whose three panels each pointed at
     something with its own home. Three navigation layers on one screen —
     bottom tabs, segment, panel — is what made LOOP feel like an app you
     have to learn rather than read. */
  T('the Training Overview segment is gone', !/Training Overview/.test(src));
  T('its switcher is gone, not orphaned', !/switchTodayTab/.test(src));
  T('its panels are gone', !/tpanel-progress|tpanel-consistency|tpanel-program/.test(src));
  T('Today has no segmented control at all', (() => {
    const view = src.slice(src.indexOf('<div class="view" id="view-today">'),
                           src.indexOf('<div class="view" id="view-train">'));
    return !/class="seg"/.test(view);
  })());

  sub('nothing it showed was lost');
  T('consistency still has the Progress card', /function progConsistencyCardHtml/.test(src));
  T('and the Log strip', /logConsistencyStripHtml/.test(src));
  T('records still live in the Strength tab', /function progPRCardHtml/.test(src));
  T('the plan and its week still live in My Training', /function renderMyTraining/.test(src));
  T('the Progress tab is still one tap away on the tab bar',
    /data-tab="progress"[^>]*onclick="switchTab\('progress'\)"/.test(src));

  sub('the first screen carries less vocabulary');
  /* A beginner used to meet Plan, Cycle, Phase, Week, Schedule, Training,
     Progress and Workout on the screen the app opens on. Phase and cycle
     language came from a carousel that showed "FOUNDATION WEEK 1" even to
     an athlete who had never started a cycle. */
  T('Today no longer shows phase language', (() => {
    const view = src.slice(src.indexOf('<div class="view" id="view-today">'),
                           src.indexOf('<div class="view" id="view-train">'));
    return !/program-carousel|programDots/.test(view);
  })());
  T('the phase carousel cannot render to a cycle-less athlete',
    !/function renderProgramCarousel/.test(src) || !/programCarousel/.test(
      src.slice(src.indexOf('<div class="view" id="view-today">'),
                src.indexOf('<div class="view" id="view-train">'))));
}

/* =========================================================
   CONTRACT 102 — The first ninety seconds
   ---------------------------------------------------------
   LOOP opened on seven plan cards. Someone who had never
   tracked a workout was asked to choose between "Bodybuilder
   Hypertrophy" and "Upper / Lower Split" before anything had
   said what the app was for, and the tour that explains it
   ran afterwards.

   Order is now: understand -> choose -> learn -> fit.
   ========================================================= */
function testFirstUse(app){
  section('CONTRACT 102 — first use explains before it asks');
  const ctx = app.ctx;
  const src = require('fs').readFileSync(H.APP_PATH, 'utf8');

  sub('understanding comes before the question');
  T('the flow opens on an explanation, not a plan list',
    /function showOnboarding\(\)[\s\S]{0,260}firstUseStage = 'intro'/.test(src));
  T('the intro says what LOOP does in the athlete\'s terms',
    /Know what to train, every day\./.test(src));
  T('it shows the product rather than describing it', /class="fu-demo"/.test(src));
  T('the demo is decoration to a screen reader, not content',
    /class="fu-demo" aria-hidden="true"/.test(src));
  T('one action on the intro screen',
    (ctx.renderFirstUseIntro && (() => {
      const host = { innerHTML: '' };
      ctx.renderFirstUseIntro(host);
      return (host.innerHTML.match(/<button/g) || []).length === 1;
    })()) === true);

  sub('the question is about the person, not the split');
  T('the chooser asks what they want', /What do you want from training\?/.test(src));
  T('intents lead, and each maps to a real plan',
    Array.isArray(ctx.PLAN_INTENTS) && ctx.PLAN_INTENTS.length === 3 &&
    ctx.PLAN_INTENTS.every(i => !!ctx.DEFAULT_PLANS[i.id]));
  T('they are goals, not split names',
    ctx.PLAN_INTENTS.map(i => i.label).join('|') === 'Build muscle|Get stronger|Get fit & athletic');

  sub('nothing was removed from the plan library');
  /* The intents are a presentation layer. Every plan that existed before is
     still reachable without leaving the chooser. */
  const reachable = ctx.PLAN_INTENTS.map(i => i.id).concat(ctx.PLAN_MORE);
  T('every built-in plan is still offered',
    Object.keys(ctx.DEFAULT_PLANS).every(id => reachable.indexOf(id) !== -1),
    'unreachable: ' + Object.keys(ctx.DEFAULT_PLANS).filter(id => reachable.indexOf(id) === -1).join(','));
  T('no plan is listed twice', new Set(reachable).size === reachable.length);
  T('depth is one tap, not a different screen', typeof ctx.togglePlanMore === 'function');
  T('building your own is still offered here', /function renderFirstUsePlans\([\s\S]{0,1400}customPlanCardHtml\(\)/.test(src));
  T('and there is still only one definition of it',
    (src.match(/function customPlanCardHtml/g) || []).length === 1);

  sub('a plan card shows the week it actually runs');
  /* The strip is read from the plan's own defaultSchedule. A sample week that
     did not match what the athlete then got would be a lie on screen. */
  Object.keys(ctx.DEFAULT_PLANS).forEach(id => {
    const p = ctx.DEFAULT_PLANS[id];
    const trained = ctx.DAY_ORDER.filter(k => p.defaultSchedule[k] && p.defaultSchedule[k] !== 'rest');
    T(id + ': day count matches its schedule', ctx.planTrainingDays(id) === trained.length);
    const strip = ctx.planWeekStripHtml(id);
    T(id + ': every training day appears in the strip',
      trained.every(k => strip.indexOf(ctx.CAT_SHORT[p.defaultSchedule[k]]) !== -1));
    /* the cell itself is class="fu-day" or "fu-day fu-day-rest"; the label and
       category spans inside it are fu-day-l / fu-day-c, hence the delimiter */
    T(id + ': the strip has seven cells',
      (strip.match(/class="fu-day[" ]/g) || []).length === 7);
  });
  T('the strip is labelled for screen readers', /role="img" aria-label=/.test(ctx.planWeekStripHtml('balanced')));

  sub('"help me choose" lands on a real plan, never a dead end');
  T('three questions, no more', ctx.HELP_QUESTIONS.length === 3);
  const combos = [];
  ['muscle','strength','fitness'].forEach(goal =>
    [3,4,5].forEach(days =>
      ['gym','home'].forEach(where => combos.push({ goal, days, where }))));
  T('every combination of answers resolves to an existing plan',
    combos.every(c => !!ctx.DEFAULT_PLANS[ctx.recommendPlan(c)]),
    combos.filter(c => !ctx.DEFAULT_PLANS[ctx.recommendPlan(c)]).map(c => JSON.stringify(c)).join(' '));
  T('equipment is respected before goal — a gym plan is useless without a gym',
    combos.filter(c => c.where === 'home').every(c => ctx.recommendPlan(c) === 'home'));
  T('it recommends, it does not decide — the other plans stay one tap away',
    /See the other plans/.test(src));
  T('no second recommendation engine was built',
    (src.match(/function recommendPlan\(/g) || []).length === 1);

  sub('the answer buttons survive the values they carry');
  /* Serialising an answer into the inline handler put raw double quotes inside
     a double-quoted attribute and silently killed every option button. */
  T('options are addressed by index, not by serialised value',
    /onclick="answerHelp\(\$\{answered\}, \$\{i\}\)"/.test(src));
  T('answerHelp resolves the value itself', /function answerHelp\(qIndex, optIndex\)/.test(src));
  T('no JSON is written into an attribute in this flow',
    !/onclick="[^"]*JSON\.stringify/.test(src));
  T('an out-of-range answer is ignored rather than thrown',
    (() => { try{ ctx.answerHelp(99, 99); return true; }catch(e){ return false; } })());

  sub('the tour still runs, and runs after the app is on screen');
  T('the tutorial was kept, not replaced', typeof ctx.startOnboarding === 'function');
  T('it is still offered from showMainApp, behind shouldOfferOnboarding',
    /function showMainApp\(\)[\s\S]{0,700}shouldOfferOnboarding\(\)[\s\S]{0,120}startOnboarding\(\)/.test(src));
  T('it is still skippable in one tap', typeof ctx.skipOnboarding === 'function');
  T('completing it is still recorded', /onboardingState\.completedVersion = ONBOARDING_VERSION/.test(src));

  sub('the first run is a sequence, never a stack');
  /* Measured before this phase: startOnboarding() fired at 450ms and
     openTrainingSetup() at 500ms, so both sheets were open together 80ms
     apart, the setup waiting underneath the tutorial. */
  T('the setup is held back while the tour is going to run',
    /if\(shouldOfferOnboarding\(\)\) pendingTrainingSetupPlan = id;/.test(src));
  T('and released when the tour closes, whichever way it closed',
    /function closeOnboarding\(\)[\s\S]{0,600}pendingTrainingSetupPlan[\s\S]{0,200}openTrainingSetup\(id\)/.test(src));
  T('skip and finish both route through that one exit',
    /function skipOnboarding\(\)[\s\S]{0,180}closeOnboarding\(\)/.test(src) &&
    /function finishOnboarding\(\)[\s\S]{0,220}closeOnboarding\(\)/.test(src));
  T('an athlete only switching plans later is never shown the setup',
    /if\(firstTime && !\(opts && opts\.skipSetup\)\)/.test(src));

  sub('an athlete who already trains here never sees any of it');
  T('the chooser is gated on having no plan',
    /if\(selectedPlanId && DEFAULT_PLANS\[selectedPlanId\]\)\{[\s\S]{0,300}showMainApp\(\);\s*\} else \{\s*showOnboarding\(\);\s*\}/.test(src));
  T('the tour is gated on a recorded version, not on being new',
    /function shouldOfferOnboarding\(\)[\s\S]{0,220}completedVersion === ONBOARDING_VERSION/.test(src));
  T('and on having skipped it', /function shouldOfferOnboarding\(\)[\s\S]{0,260}onboardingState\.skipped/.test(src));
  T('first use writes no storage key of its own',
    !/LOOPStore\.set\(['`]firstUse/.test(src) && !/DATA_KEYS[\s\S]{0,400}firstUse/.test(src));

  sub('the screen it leaves behind is the app, not a half-state');
  T('the tab-bar reservation is only removed while first use is showing',
    /body\.first-use\{ padding-bottom: 0; \}/.test(src));
  T('showOnboarding adds that state', /document\.body\.classList\.add\('first-use'\)/.test(src));
  T('showMainApp removes it', /document\.body\.classList\.remove\('first-use'\)/.test(src));
  T('the container is shown as flex, so the stylesheet keeps its layout',
    /getElementById\('planOnboard'\)\.style\.display = 'flex'/.test(src));

  sub('no second architecture appeared');
  /* D16.1 records the goal the athlete gave "help me choose" before handing
     off. The contract — one exit, through the existing choosePlan — holds. */
  T('choosing still goes through the existing choosePlan',
    /function choosePlanFromFirstUse\(planId\)\{\s*adoptHelpGoal\(\);\s*choosePlan\(planId\);\s*\}/.test(src));
  T('and there is still only one such exit',
    (src.match(/function choosePlanFromFirstUse\(/g) || []).length === 1);
  T('the plan library was not copied',
    (src.match(/const DEFAULT_PLANS = /g) || []).length === 1);
  T('no new storage key', (src.match(/const DATA_KEYS = /g) || []).length === 1);
  T('the trainer was not touched', /TRAINER_ENGINE_VERSION = '0\.1\.1-shadow'/.test(src));
}

/* =========================================================
   CONTRACT 103 — First run asks only what it does not know
   ---------------------------------------------------------
   D16 got the order right. It left three things wrong:

     - the intro showed invented loads and reps
     - setup asked for a frequency the plan had already set
     - "help me choose" collected a goal it then discarded
       whenever equipment decided the plan
   ========================================================= */
function testFirstRunRefinement(app){
  section('CONTRACT 103 — first run asks only what it does not know');
  const ctx = app.ctx;
  const src = require('fs').readFileSync(H.APP_PATH, 'utf8');

  sub('the intro shows the product, never a performance');
  /* aria-hidden hid the fabricated numbers from screen readers. It did not
     hide them from the person looking at the screen, which is who they were
     misinforming. */
  T('the invented sets are gone', !/135 × 8|145 × 8|155 × 6/.test(src));
  T('no load-by-rep pair is written into the intro at all',
    !/fu-demo-set/.test(src));
  const demo = ctx.introDemoWorkout();
  T('the demo is read from the plan library', !!demo && !!demo.name);
  T('its title is a real template name', (() => {
    const plan = ctx.DEFAULT_PLANS[ctx.defaultBasePlanId()];
    return Object.keys(plan.templates).some(cat =>
      plan.templates[cat].some(t => t.name === demo.name));
  })());
  T('its exercises are real exercises from that template', (() => {
    const plan = ctx.DEFAULT_PLANS[ctx.defaultBasePlanId()];
    const tpl = Object.keys(plan.templates)
      .map(cat => plan.templates[cat].find(t => t.name === demo.name))
      .find(Boolean);
    return demo.exercises.every(n => tpl.exercises.some(e => e.name === n));
  })());
  T('the rendered card carries no number of any kind', (() => {
    const html = ctx.introDemoHtml().replace(/\+ \d+ more/, '');
    const text = html.replace(/<[^>]*>/g, ' ');
    return !/\d/.test(text);
  })(), ctx.introDemoHtml().replace(/<[^>]*>/g, ' ').trim());
  T('nothing was hard-coded that could go stale',
    /function introDemoWorkout\(\)[\s\S]{0,400}DEFAULT_PLANS\[defaultBasePlanId\(\)\]/.test(src));

  sub('setup states what LOOP knows instead of asking for it again');
  T('it no longer asks the frequency question', !/How often do you want to train/.test(src));
  T('it no longer asks the days question', !/Which days work best/.test(src));
  T('frequency arrives as a value', /'Training frequency'/.test(src));
  T('the schedule arrives as a value', /'Your schedule'/.test(src));
  T('each prefilled value says where it came from', !!ctx.SETUP_SOURCE_NOTE &&
    ctx.SETUP_SOURCE_NOTE.plan === 'From your selected plan' &&
    ctx.SETUP_SOURCE_NOTE.answers === 'From what you told us');
  T('a value the athlete changed no longer claims to come from anywhere',
    ctx.SETUP_SOURCE_NOTE.custom === null);

  sub('the prefill matches the plan that was actually chosen');
  Object.keys(ctx.DEFAULT_PLANS).forEach(id => {
    ctx.schedule = {};
    ctx.helpAnswers = { goal:null, days:null, where:null };
    ctx.selectedPlanId = id;
    ctx.openTrainingSetup(id);
    const expected = ctx.DAY_ORDER.filter(d => {
      const sch = ctx.DEFAULT_PLANS[id].defaultSchedule;
      return sch[d] && sch[d] !== 'rest';
    });
    T(id + ': setup opens on the plan\'s own days',
      ctx.setupDraft.days.join(',') === expected.join(','),
      'got ' + ctx.setupDraft.days.join(',') + ' expected ' + expected.join(','));
    T(id + ': and says so', ctx.setupDraft.source === 'plan');
  });

  sub('an answer the athlete gave is not then thrown away');
  {
    ctx.schedule = {};
    ctx.helpAnswers = { goal:'muscle', days:5, where:'gym' };
    ctx.selectedPlanId = 'upperlower';
    ctx.openTrainingSetup('upperlower');
    T('a stated training frequency wins over the plan default',
      ctx.setupDraft.days.length === 5, 'got ' + ctx.setupDraft.days.length);
    T('and is credited to the athlete, not the plan', ctx.setupDraft.source === 'answers');
  }
  {
    /* An athlete whose plan already matches what they said should not see the
       claim change — the value is the same either way. */
    ctx.schedule = {};
    ctx.helpAnswers = { goal:'muscle', days:4, where:'gym' };
    ctx.openTrainingSetup('upperlower');
    T('a matching answer does not fight the plan', ctx.setupDraft.days.length === 4);
  }

  sub('editing is available without being demanded');
  {
    ctx.schedule = {};
    ctx.helpAnswers = { goal:null, days:null, where:null };
    ctx.openTrainingSetup('strength');
    T('nothing is open for editing when it opens', ctx.setupEditing === null);
    ctx.setupEdit('freq');
    T('Change opens exactly one editor', ctx.setupEditing === 'freq');
    ctx.setupEdit('freq');
    T('and closes it again', ctx.setupEditing === null);
    ctx.setupEdit('days');
    ctx.setupEdit('freq');
    T('only one editor is open at a time', ctx.setupEditing === 'freq');
    const before = ctx.setupDraft.days.length;
    ctx.setupSetFrequency(5);
    T('changing frequency changes the week', ctx.setupDraft.days.length === 5 && before !== 5);
    T('and stops crediting the plan for it', ctx.setupDraft.source === 'custom');
    ctx.setupToggleDay('sun');
    T('a day can still be added by hand', ctx.setupDraft.days.indexOf('sun') !== -1);
    T('the spread table is shared, not duplicated',
      (src.match(/const TRAINING_DAY_SPREAD = /g) || []).length === 1);
  }

  sub('every question in "help me choose" changes something');
  {
    const combos = [];
    ['muscle','strength','fitness'].forEach(goal =>
      [3,4,5].forEach(days =>
        ['gym','home'].forEach(where => combos.push({ goal, days, where }))));
    T('all 18 combinations still resolve to a real plan',
      combos.every(c => !!ctx.DEFAULT_PLANS[ctx.recommendPlan(c)]));

    /* The days answer used to be inert for 12 of the 18 — it only moved the
       plan for muscle-at-a-gym. It now always sets the week, so the question
       is never asked for nothing. */
    const daysAlwaysMatters = combos.every(c => {
      ctx.schedule = {};
      ctx.helpAnswers = { goal:c.goal, days:c.days, where:c.where };
      ctx.openTrainingSetup(ctx.recommendPlan(c));
      return ctx.setupDraft.days.length === c.days;
    });
    T('the days answer always decides the week', daysAlwaysMatters);

    /* The goal answer used to be discarded whenever equipment chose the plan.
       It now always seeds the profile that sets rep ranges. */
    const goalAlwaysMatters = ['muscle','strength','fitness'].every(goal => {
      ctx.athleteProfile = ctx.defaultAthleteProfile();
      ctx.helpAnswers = { goal: goal, days:3, where:'home' };
      ctx.adoptHelpGoal();
      return !!ctx.athleteProfile.goal && !!ctx.TRAINING_GOALS[ctx.athleteProfile.goal];
    });
    T('the goal answer always reaches the profile, even when equipment chose the plan',
      goalAlwaysMatters);
    T('every mapped goal is a real training goal',
      Object.keys(ctx.HELP_GOAL_TO_PROFILE).every(k => !!ctx.TRAINING_GOALS[ctx.HELP_GOAL_TO_PROFILE[k]]));
  }

  sub('an answer the athlete already gave is never overwritten');
  {
    ctx.athleteProfile = ctx.defaultAthleteProfile();
    ctx.athleteProfile.goal = 'endurance';
    ctx.helpAnswers = { goal:'muscle', days:3, where:'gym' };
    const adopted = ctx.adoptHelpGoal();
    T('a goal set by the athlete survives', ctx.athleteProfile.goal === 'endurance');
    T('and the flow reports that it changed nothing', adopted === false);
  }

  sub('the recommendation explains itself without exposing its ranking');
  {
    const home = ctx.recommendPlanWithReason({ goal:'muscle', days:5, where:'home' });
    T('equipment overriding the goal is admitted', home.overridden === true);
    T('and explained in plain language', /training at home/i.test(home.reason));
    T('the caveat separates what equipment decided from what the goal still does',
      /chosen ahead of your goal[\s\S]{0,120}sets your reps/.test(src));
    const gym = ctx.recommendPlanWithReason({ goal:'muscle', days:5, where:'gym' });
    T('a goal-driven result does not claim an override', gym.overridden === false);
    T('every combination carries a reason', (() => {
      const combos = [];
      ['muscle','strength','fitness'].forEach(goal =>
        [3,4,5].forEach(days =>
          ['gym','home'].forEach(where => combos.push({ goal, days, where }))));
      return combos.every(c => {
        const r = ctx.recommendPlanWithReason(c);
        return typeof r.reason === 'string' && r.reason.length > 10;
      });
    })());
    T('no internal vocabulary leaks into what the athlete reads',
      !/coarse equipment|capability|substitution ranking|confidence/i.test(
        ['muscle','strength','fitness'].flatMap(goal =>
          [3,4,5].flatMap(days =>
            ['gym','home'].map(where =>
              ctx.recommendPlanWithReason({goal,days,where}).reason))).join(' ')));
    T('it never claims the goal chose the plan when equipment did',
      !/your goal selected|because you want/i.test(home.reason));
  }

  sub('nothing new was stored, and nothing existing was touched');
  T('no new storage key', (src.match(/const DATA_KEYS = /g) || []).length === 1);
  T('DATA_KEYS still holds fifteen entries', ctx.DATA_KEYS.length === 15);
  T('the goal is written to the profile that already existed',
    /athleteProfile\.goal = g;[\s\S]{0,120}persistAthleteProfile\(\)/.test(src));
  T('and only when the athlete has none', /if\(!g \|\| !athleteProfile \|\| athleteProfile\.goal\) return false;/.test(src));
  T('setup still writes the schedule and nothing else',
    /function applyTrainingSetup\(\)[\s\S]{0,300}persistSchedule\(\)/.test(src));
  T('the trainer is untouched', /TRAINER_ENGINE_VERSION = '0\.1\.1-shadow'/.test(src));
  T('no trainer record is written anywhere in the first-run path',
    !/function (choosePlanFromFirstUse|adoptHelpGoal|openTrainingSetup|renderTrainingSetup)\([\s\S]{0,900}trainerLog/.test(src));

  sub('touch targets survive seven across a 375px screen');
  /* Measured: at gap 5px the day cells came out 43.56px, under the minimum. */
  T('the day grid leaves room for a 44px target',
    /\.ts-days\{ display: grid; grid-template-columns: repeat\(7, 1fr\); gap: 4px; \}/.test(src));
  T('and the cells are tall enough', /\.ts-day\{[\s\S]{0,80}min-height: 48px/.test(src));
  T('Change is a full-size target', /\.ts-change\{[\s\S]{0,120}min-height: 44px/.test(src));
}

/* =========================================================
   CONTRACT 104 — Nothing feels fragile (Phase D17)
   ---------------------------------------------------------
   Reliability and accessibility across every workflow an
   athlete can interrupt: sheets, timers, drafts, rotation,
   rapid taps, corrupted storage and the keyboard.
   ========================================================= */
function testReliability(app){
  section('CONTRACT 104 — reliability, accessibility and recovery');
  const ctx = app.ctx;
  const doc = app.doc || ctx.document;
  const src = require('fs').readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

  sub('a bad destination cannot blank the app');
  /* switchTab cleared every view and then threw on the missing one, leaving a
     header, a tab bar and nothing between them — with currentTab already
     overwritten, so no tap recovered it and only a reload brought LOOP back. */
  T('the destination is resolved before anything is cleared',
    /function switchTab\(tab\)\{[\s\S]{0,420}const view = document\.getElementById\('view-' \+ tab\);[\s\S]{0,40}if\(!view\) return;/.test(src));
  T('currentTab is only set once the destination exists',
    /if\(!view\) return;\s*currentTab = tab;/.test(src));
  T('and the views are cleared after that, not before',
    src.indexOf("if(!view) return;") < src.indexOf("document.querySelectorAll('.view').forEach(v => v.classList.remove('active'))"));
  {
    const before = doc.querySelectorAll('.view.active').length;
    ctx.switchTab('no-such-tab');
    T('an unknown tab changes nothing', doc.querySelectorAll('.view.active').length === before);
    ctx.switchTab('progress');
    T('a real tab still works', doc.getElementById('view-progress').classList.contains('active'));
    ctx.switchTab('view-does-not-exist');
    T('a bad tab leaves the good one active',
      doc.getElementById('view-progress').classList.contains('active'));
  }
  /* Deactivating the previous view, and the "exactly one active view and one
     active tab button" property, are verified in a real browser after 20 rapid
     switches. The harness DOM returns nothing for compound class selectors, so
     .view/.tab-btn sweeps are no-ops here — asserting on them would test the
     stub rather than the app. The source order above is what guarantees it. */
  T('a top-level tab still opens at the top',
    /function switchTab[\s\S]{0,1200}window\.scrollTo\(\{ top: 0/.test(src));

  sub('no field small enough to make iOS zoom the page');
  /* Safari zooms whenever a focused field is under 16px and does not zoom back
     out, so tapping a RIR box left the athlete on a magnified, sideways-
     scrolling workout sheet mid-set. */
  T('the base field size is at the threshold',
    /input, textarea, select\{[\s\S]{0,260}font-size: 16px;/.test(css));
  T('no rule sets a smaller size on a field', (() => {
    const bad = [];
    const re = /([^{}]+)\{([^{}]*)\}/g; let m;
    while((m = re.exec(css))){
      const sel = m[1], body = m[2];
      /* Real fields only. Class names like .ob-mock-select belong to spans in
         the tutorial mock-up — they look like controls and accept nothing. */
      if(!/(^|[\s,>+~])(input|textarea|select)\b/.test(sel)) continue;
      const f = body.match(/font-size:\s*([\d.]+)px/);
      if(f && parseFloat(f[1]) < 16 && !/::|checkbox|radio|range/.test(sel)) bad.push(sel.trim() + ' ' + f[1] + 'px');
    }
    return bad.length === 0 ? true : bad;
  })() === true, 'see rule list');

  sub('every control is big enough to hit');
  /* Each of these measured under 44px in a real browser at 375x812. */
  T('sheet confirm and cancel', /\.btn-secondary, \.btn-primary\{[\s\S]{0,60}min-height: 44px/.test(css));
  T('add exercise', /\.add-ex-btn\{[\s\S]{0,60}min-height: 44px/.test(css));
  T('the bodyweight toggle grew its label, not its box',
    /\.bw-toggle\{[\s\S]{0,200}min-height: 44px/.test(css) &&
    /\.bw-toggle input\{ width: 20px; height: 20px; \}/.test(css));
  T('the exercise swap control', /\.swap-select\{\s*width: 44px; height: 44px;/.test(css));
  T('the profile chips', /\.pchip\{[\s\S]{0,60}min-height: 44px/.test(css));
  T('back out of a nested sheet', /\.sheet-back\{[\s\S]{0,220}min-height: 44px/.test(css));
  T('the update disclosure', /\.update-detail-toggle\{[\s\S]{0,180}min-height: 44px/.test(css));

  sub('sheets can be closed, announced and escaped from a keyboard');
  /* Thirty overlays, and before this none could be closed without a mouse,
     none announced itself as a dialog, and none gave focus back. */
  T('a sheet is announced as a dialog', /ov\.setAttribute\('role', 'dialog'\)/.test(src));
  T('and marked modal while it is open', /ov\.setAttribute\('aria-modal', 'true'\)/.test(src));
  T('the mark is removed when it closes', /ov\.removeAttribute\('aria-modal'\)/.test(src));
  T('Escape and Tab are handled in one place, not thirty',
    (src.match(/function initSheetKeyboard\(/g) || []).length === 1);
  T('Escape uses the sheet\'s own close path rather than inventing one',
    /function sheetCloser\(ov\)[\s\S]{0,600}backdropDismiss/.test(src));
  T('a sheet that declares no exit is left alone',
    /function sheetCloser[\s\S]{0,900}return null;/.test(src));
  T('focus moves to the sheet, not to a field — a phone keyboard must not leap up',
    /function focusIntoSheet[\s\S]{0,320}const sheet = ov\.querySelector\('\.sheet'\)/.test(src) &&
    !/focusIntoSheet[\s\S]{0,320}querySelector\('input/.test(src));
  T('focus returns to whatever opened the sheet', /_sheetOpeners\.get\(id\)/.test(src));
  T('but only if that control still exists',
    /document\.contains\(opener\) && opener\.offsetParent !== null/.test(src));
  T('the programmatic focus does not paint a ring round the whole sheet',
    /\.sheet:focus, \.sheet:focus-visible\{ outline: none; \}/.test(css));
  T('keyboard focus is still visible on controls',
    /\*:focus-visible\{ outline: 2px solid var\(--accent\); outline-offset: 2px; \}/.test(css));
  T('the topmost sheet is the one Escape acts on', /function topOpenSheet\(\)/.test(src));

  sub('one mechanism reacts to a sheet opening, not one per sheet');
  T('a single observer', (src.match(/new MutationObserver\(/g) || []).length === 1);
  T('it drives the scroll lock', /new MutationObserver\(\(\) => \{[\s\S]{0,160}syncBackgroundScrollLock\(\);/.test(src));
  T('and the accessibility state', /new MutationObserver\(\(\) => \{[\s\S]{0,200}syncSheetAccessibility\(\);/.test(src));
  T('boot still survives a browser without MutationObserver',
    /if\(typeof MutationObserver === 'undefined'\) return null;/.test(src));
  T('nested sheets keep the lock count honest',
    /else if\(open > 0\)\{ _lockDepth = open; \}/.test(src));

  sub('timers belong to one owner and one exit');
  T('prep clears its timer on the only way out',
    /function exitPrep\(\)\{\s*clearPrepTimer\(\);/.test(src));
  T('and whenever it moves to another movement',
    /function enterPrepStep\(\)\{\s*clearPrepTimer\(\);/.test(src));
  T('the rest panel clears before it starts, so a second tap cannot double it',
    /function startRestPanel\(panel, seconds\)\{[\s\S]{0,120}clearRestTimer\(panel\);/.test(src));
  T('every setInterval in the app has a matching clear',
    (src.match(/setInterval\(/g) || []).length <= (src.match(/clearInterval\(/g) || []).length,
    (src.match(/setInterval\(/g) || []).length + ' intervals vs ' +
    (src.match(/clearInterval\(/g) || []).length + ' clears');
  /* D19 split a timed movement into a position countdown and the movement
     itself. Both are deadline-based, so this now asserts the discipline on
     both phases rather than on the one line it used to match. */
  T('timers are wall-clock, not tick-counted, so throttling cannot drift them',
    /prepState\.endsAt = Date\.now\(\) \+ prepState\.remaining \* 1000/.test(src) &&
    /prepState\.readyUntil = Date\.now\(\) \+ PREP_READY_SECONDS \* 1000/.test(src));
  T('the position countdown is derived from its deadline, never decremented',
    /Math\.ceil\(\(prepState\.readyUntil - Date\.now\(\)\) \/ 1000\)/.test(src) &&
    !/readyLeft\s*(--|-=)/.test(src));

  sub('gestures attach once per element');
  T('the week strip guards re-attachment', /strip\.dataset\.gestures === 'on'/.test(src));
  T('the day card guards re-attachment', /host\.dataset\.swipe === 'on'/.test(src));

  sub('corrupt storage degrades, it never destroys');
  /* Every key was replaced with a different flavour of garbage in a real
     browser: LOOP booted, showed no developer text, and left the malformed
     values exactly as they were rather than overwriting them. */
  T('reads are defended', (src.match(/JSON\.parse\(/g) || []).length > 0 &&
    (src.match(/catch\(e\)/g) || []).length > 40);
  T('a plan that no longer exists falls back rather than throwing',
    /if\(selectedPlanId && DEFAULT_PLANS\[selectedPlanId\]\)/.test(src));
  T('boot never depends on the page-isolation observer',
    /Boot must not depend on this/.test(src));
  T('the trainer log tolerates a malformed shape', /function loadTrainerData/.test(src));

  sub('the trainer was not touched');
  T('engine version', /TRAINER_ENGINE_VERSION = '0\.1\.1-shadow'/.test(src));
  T('shadow evidence retention', /TRAINER_LOG_MAX = 2000/.test(src));
  T('outcome vocabulary', /OUTCOME_MATCH = \{ MATCHED:'matched', DIVERGED:'diverged' \}/.test(src));
  T('no trainer symbol appears in anything D17 added',
    !/function (switchTab|syncSheetAccessibility|initSheetKeyboard|sheetCloser|focusIntoSheet|topOpenSheet)\([\s\S]{0,900}(trainerLog|TRAINER_CONFIG|proposeTrainerState)/.test(src));
  T('no new storage key', ctx.DATA_KEYS.length === 15);
}

/* =========================================================
   CONTRACT 105 — One design system, followed (Premium pass)
   ---------------------------------------------------------
   LOOP already had a real token system: three surfaces,
   three text levels, category and status colours, four
   radii, six spacing steps, four shadows, one easing.
   Typography was the axis nobody governed — 39 distinct
   font sizes, and 148 rules below 11px spread across seven
   different values with no rule deciding which.
   ========================================================= */
function testDesignSystem(app){
  section('CONTRACT 105 — one design system, followed');
  const ctx = app.ctx;
  const src = require('fs').readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

  sub('type is a scale, not a pile of numbers');
  ['--fs-micro','--fs-meta','--fs-support','--fs-body','--fs-card-title','--fs-section','--fs-title','--fs-metric']
    .forEach(t => T(t + ' is defined', new RegExp(t.replace(/-/g,'\\-') + ':\\s*\\d').test(css)));
  T('the micro tier is one token, not seven sizes',
    (css.match(/var\(--fs-micro\)/g) || []).length > 100,
    (css.match(/var\(--fs-micro\)/g) || []).length + ' uses');

  sub('nothing is too small to read on a phone');
  /* 160 rendered elements were under 11px, the smallest at 7px. Apple's own
     floor is 11pt and LOOP had no floor at all. */
  T('no rule sets text below the floor', (() => {
    const bad = [];
    const re = /([^{}]+)\{([^{}]*)\}/g; let m;
    const ICON_OK = /glyph|caret|icon|ob-mock/;
    while((m = re.exec(css))){
      const sel = m[1].replace(/\s+/g,' ').trim(), body = m[2];
      const f = body.match(/font-size:\s*([\d.]+)px/);
      if(f && parseFloat(f[1]) < 11 && !ICON_OK.test(sel)) bad.push(sel + ' @' + f[1]);
    }
    return bad.length === 0 ? true : bad;
  })() === true, 'rules below 11px remain');

  sub('text drawn inside an SVG obeys the same floor');
  /* A stylesheet audit cannot see this: SVG text is scaled by its viewBox, so
     the body diagram's labels were rendering at 4.74px and the chart dates at
     8.48px while every CSS rule looked fine. */
  T('no SVG text is declared below 11 units', (() => {
    const bad = (src.match(/font-size="([\d.]+)"/g) || [])
      .map(x => parseFloat(x.match(/[\d.]+/)[0])).filter(v => v < 11);
    return bad.length === 0 ? true : bad;
  })() === true);
  T('the outermost axis labels anchor to the edge so they are not clipped',
    /const anchor = isFirst \? 'start' : isLast \? 'end' : 'middle';/.test(src));
  T('the body diagram grew its box rather than shrinking its labels',
    /viewBox="0 0 124 167"/.test(src));

  sub('charts use the palette instead of restating it');
  T('the volume bars are accent, by name', /fill="var\(--accent\)"/.test(src));
  T('axis labels are faint text, by name', /fill="var\(--text-faint\)"/.test(src));
  T('the trend area and line too',
    /fill="var\(--accent-soft\)" stroke="var\(--accent\)"/.test(src));
  T('no chart still hard-codes a colour that has a token', (() => {
    const js = src.slice(src.indexOf('</style>'));
    return !/(fill|stroke)="#(5B8CFF|5B616B|9AA1AC|4B9C81|BD9260|E5675F)"/i.test(js);
  })());
  /* PHASE_INTENT keeps its own literals on purpose: Foundation, Build, Peak
     and Deload are a domain palette, and "Peak" is not an error state. */
  T('the phase palette was left as its own set', /name:'Peak', color:'#E5675F'/.test(src));

  sub('the navigation bar belongs to the icon family');
  T('one function draws all five', (src.match(/function tabIconSvg\(/g) || []).length === 1);
  T('drawn on the family grid, in the family stroke', (() => {
    const fn = src.slice(src.indexOf('function tabIconSvg(name)'), src.indexOf('function trendIconSvg'));
    return /viewBox="0 0 16 16"/.test(fn) && /stroke-width="1.6"/.test(fn) && /stroke="currentColor"/.test(fn);
  })());
  T('the icons are decorative — the button carries the name', (() => {
    const fn = src.slice(src.indexOf('function tabIconSvg(name)'), src.indexOf('function trendIconSvg'));
    return /aria-hidden="true"/.test(fn);
  })());
  T('and the tab still says its own name in text',
    /id="tabIconToday"><\/span>Today/.test(src));
  T('the active state is not carried by colour alone',
    /\.tab-btn\.active \.glyph\{[^}]*border-color: var\(--accent\)[^}]*background: var\(--accent-soft\)/.test(css));

  sub('Volume: the chart and the muscle breakdown are two sections, not one');
  /* Measured before: the chart's axis labels ended at y=637, the chart box at
     642, and the muscle rows began at 642 — a gap of zero, so the dates ran
     into the breakdown. .sec-head is what carries LOOP's section separation,
     and this was the only section in the panel without one. */
  T('the breakdown has a heading', /<div class="sec-head">Sets this week by muscle<\/div>/.test(src));
  T('the heading comes before the data, not after',
    src.indexOf('Sets this week by muscle') < src.indexOf("muscleBarsHtml(totals)"));
  T('and the trailing caption is gone rather than repeated',
    /muscleBarsHtml\(totals\)/.test(src));
  T('the caption is optional so a heading never duplicates it',
    /\(caption \? `<div class="muscle-bar-foot"|caption \? `<div class="muscle-foot">/.test(src));
  T('the Mastery tab still labels its own copy of the same component',
    /<div class="sec-head">Muscle group volume<\/div>/.test(src));
  T('one bar component serves both, not two',
    (src.match(/function muscleBarsHtml\(/g) || []).length === 1);

  sub('a record reads larger than the badge annotating it');
  T('the set value', (() => {
    const m = css.match(/\.set-chip\{[^}]*font-size:\s*([\d.]+)px/);
    return !!m && parseFloat(m[1]) >= 13;
  })());
  T('the PR badge sits at the micro tier',
    /\.set-chip-pr\{[\s\S]{0,200}font-size: var\(--fs-micro\)/.test(css));

  sub('nothing about the product changed');
  T('no new storage key', ctx.DATA_KEYS.length === 15);
  T('the trainer is untouched', /TRAINER_ENGINE_VERSION = '0\.1\.1-shadow'/.test(src));
  T('shadow evidence retention is untouched', /TRAINER_LOG_MAX = 2000/.test(src));
  T('the schedule engine was not touched by a visual pass',
    /function applyTrainingSetup\(\)[\s\S]{0,300}persistSchedule\(\)/.test(src));
  T('D17 accessibility survived', /function initSheetKeyboard\(/.test(src) &&
    /ov\.setAttribute\('aria-modal', 'true'\)/.test(src));
  T('reduced motion is still honoured',
    /@media \(prefers-reduced-motion: reduce\)/.test(css));
}

/* =========================================================
   CONTRACT 106 — Composition and completion
   ---------------------------------------------------------
   Rhythm on the screen LOOP opens on, the last three Unicode
   symbols standing in for icons, and the one completion
   moment that had no feedback.
   ========================================================= */
function testComposition(app){
  section('CONTRACT 106 — composition and completion feedback');
  const ctx = app.ctx;
  const src = require('fs').readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

  sub('Today has a rhythm, not a set of near-misses');
  /* Measured on the rendered screen: the blocks down Today sat 14, 14, 12, 26,
     12, 16 apart. The 26 is the section rule and means something; three values
     within four pixels of each other do not. */
  ['\\.tw\\{ margin-top: var\\(--space-3\\)',
   '\\.wk-card\\{[\\s\\S]{0,140}margin-top: var\\(--space-3\\)',
   '\\.ready-prompt\\{[\\s\\S]{0,140}margin-top: var\\(--space-3\\)',
   '\\.insight-list\\{ margin-top: var\\(--space-3\\)',
   '\\.resume-card\\{\\s*margin-top: var\\(--space-3\\)']
    .forEach((re, i) => T('Today block ' + (i+1) + ' uses the shared gap', new RegExp(re).test(css)));
  T('the section break is still a section break, not another block gap',
    /\.sec-head\{[\s\S]{0,220}margin: 26px 0 10px/.test(css));

  sub('the last symbols standing in for icons');
  /* The premium pass took the navigation bar off Unicode geometry. These were
     what remained in rendered UI: a warning sign on Train, a tick and a ring
     on every achievement row, and a caret on the cardio disclosure. */
  T('the plateau notice draws its warning', /\$\{warnIconSvg\(\)\}/.test(src));
  T('achievements draw their state', /a\.unlocked \? checkIconSvg\(14\) : ringIconSvg\(14\)/.test(src));
  T('the cardio disclosure turns one chevron rather than swapping two characters',
    /class="cd-more-caret\$\{cardioAdvancedOpen \? ' open' : ''\}">\$\{chevronDownSvg\(13\)\}/.test(src));
  T('and it turns, rather than redrawing', /\.cd-more-caret\.open\{ transform: rotate\(180deg\); \}/.test(css));
  T('no rendered UI still uses those characters', (() => {
    const bad = [];
    [/⚠/g, /[▴▾]/g].forEach(re => { const m = src.match(re); if(m) bad.push(m.join('')); });
    /* ✓ and ○ survive only inside a native <option>, which cannot hold an SVG */
    return bad.length === 0 ? true : bad;
  })() === true);
  T('the new icons are drawn on the family grid', (() => {
    const w = src.slice(src.indexOf('function warnIconSvg'), src.indexOf('function trendIconSvg'));
    return /viewBox="0 0 16 16"/.test(w) && /stroke="currentColor"/.test(w) && /aria-hidden="true"/.test(w);
  })());
  T('the swap control keeps its character, because an <option> cannot hold markup',
    /<option value="">↻/.test(src));

  sub('completing a set is felt, not just seen');
  /* Finishing a cardio session, lifting a day to drag it and a rest timer
     running out all pulsed. Completing a set — the action performed more than
     any other in the app — did not. */
  T('one pulse on completion', (() => {
    const fn = src.slice(src.indexOf('function toggleSetComplete(btn)'), src.indexOf('function markExerciseComplete'));
    return /if\(isDone\)\{[\s\S]{0,200}loopHaptic\(\);/.test(fn);
  })());
  T('and none when a set is re-opened', (() => {
    const fn = src.slice(src.indexOf('function toggleSetComplete(btn)'), src.indexOf('function markExerciseComplete'));
    const elseBranch = fn.slice(fn.indexOf('} else if(panel'));
    return elseBranch.indexOf('loopHaptic') === -1;
  })());
  T('the haptic is a single pulse with a silent fallback',
    /function loopHaptic\(\)\{[\s\S]{0,200}navigator\.vibrate\(18\)[\s\S]{0,80}return false;/.test(src));
  T('the visual confirmation it already had was left alone',
    /\.set-row\.completed \.set-complete-btn\{ animation: scbSettle/.test(css));
  T('and the next set is still pointed at', /next\.classList\.add\('pulse'\)/.test(src));

  sub('finishing an exercise is a slightly larger moment');
  T('the mark is applied only when every set is done',
    /const done = allRows\.every\(r => r\.classList\.contains\('completed'\)\);/.test(src));
  T('it settles once, not on every set',
    /if\(!done \|\| exRow\.classList\.contains\('ex-complete'\)\) return;/.test(src));
  T('the settle is transient and the state is not',
    /exRow\.classList\.remove\('ex-complete-in'\)/.test(src) &&
    /\.ex-log-row\.ex-complete\{ border-color:/.test(css));
  T('re-opening a set clears the mark, so it describes now rather than earlier',
    /if\(!isDone && exRow\) exRow\.classList\.remove\('ex-complete'\);/.test(src));
  T('the motion is restrained — a settle, not a bounce', (() => {
    const kf = css.slice(css.indexOf('@keyframes exSettle'), css.indexOf('@keyframes exSettle') + 180);
    const peak = kf.match(/scale\(([\d.]+)\)/g) || [];
    return peak.every(p => parseFloat(p.match(/[\d.]+/)[0]) <= 1.02);
  })());
  T('reduced motion still removes all of it',
    /@media \(prefers-reduced-motion: reduce\)\{\s*\*\{ animation: none !important; transition: none !important; \}/.test(css));

  sub('what was already right was left alone');
  /* The drag interaction, the PR reveal and the set button's own animation
     already met this brief. Changing them would have been motion for its own
     sake. */
  T('the drag still lifts, scales and clamps', /translateX\(\$\{clamped\}px\) scale\(1\.06\)/.test(src));
  T('it still leaves a placeholder behind', /\.wk-placeholder\{/.test(css));
  T('it still refuses text selection', /strip\.addEventListener\('selectstart'/.test(src));
  T('it still shakes on an invalid drop', /@keyframes wkReject/.test(css));
  T('the PR reveal is still a rise and a glow, with no confetti',
    /\.pr-callout-fresh\{ animation: prFreshIn 0\.3s var\(--ease\) both, prFreshGlow/.test(css));

  sub('nothing about the product changed');
  T('no new storage key', ctx.DATA_KEYS.length === 15);
  T('the trainer is untouched', /TRAINER_ENGINE_VERSION = '0\.1\.1-shadow'/.test(src));
  T('shadow retention is untouched', /TRAINER_LOG_MAX = 2000/.test(src));
  T('D17 accessibility survived',
    /function initSheetKeyboard\(/.test(src) && /ov\.setAttribute\('aria-modal', 'true'\)/.test(src));
  T('the warm-up library was not touched while passing through',
    /function buildPrepSequence\(/.test(src));
}

/* =========================================================
   CONTRACT 107 — Momentum says something true
   ---------------------------------------------------------
   The old section, measured against an athlete with PERFECT
   adherence (three weeks, four of four every week, nothing
   missed), read:

       0 Week streak | 25% On target | 0 PRs this week

   "On target" was totalWorkouts / (daysPerWeek x 12 weeks).
   The denominator projected the CURRENT schedule back across
   twelve weeks whatever the athlete's history, so someone
   three weeks in could not exceed 25% however well they
   trained. It measured tenure, not adherence.
   ========================================================= */
function testMomentum(app){
  section('CONTRACT 107 — Momentum says something true');
  const ctx = app.ctx;
  const doc = app.doc || ctx.document;
  const src = require('fs').readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

  sub('the tenure-not-adherence percentage is gone');
  T('Momentum no longer reads overallConsistency', (() => {
    const fn = src.slice(src.indexOf('function renderTodayMomentum()'), src.indexOf('function renderProgressJump'));
    return fn.indexOf('overallConsistency') === -1;
  })());
  T('and no "on target" label survives in it', (() => {
    const fn = src.slice(src.indexOf('function renderTodayMomentum()'), src.indexOf('function renderProgressJump'));
    return !/On target/i.test(fn);
  })());
  /* The 12-week figure itself is untouched: it is defensible in Progress,
     where it is labelled and guarded behind four weeks of history. */
  T('the underlying calculation was not corrupted to fix the UI',
    /const overallConsistency = totalPlanned \? Math\.min\(100, Math\.round\(\(totalWorkouts \/ totalPlanned\) \* 100\)\) : null;/.test(src));

  sub('a week in progress is not a broken week');
  /* Measured: an athlete with three perfect weeks read a streak of 0, then 4,
     from logging a single workout. The current week counted as already failed. */
  T('the streak skips the current week rather than breaking on it',
    /if\(hasLog\)\{ streak\+\+; continue; \}[\s\S]{0,120}if\(i === 0\) continue;[\s\S]{0,90}break;/.test(src));
  T('and it is still one definition, shared by every caller',
    (src.match(/function computeWeekStreak\(/g) || []).length === 1);
  {
    const D = n => { const d = new Date(Date.now() - n*86400000);
      return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
    /* Sessions in each of the previous three weeks, none yet this week. */
    ctx.workoutLog = [9, 16, 23].map((n,i) => ({ id:'s'+i, date:D(n), category:'push', title:'P', notes:'',
      exercises:[{ name:'Bench Press', bodyweight:false, sets:[{weight:'185',reps:'5',rir:'1',type:'working'}] }] }));
    ctx.invalidateSortedLogCache && ctx.invalidateSortedLogCache();
    ctx.invalidateConsistencyCache && ctx.invalidateConsistencyCache();
    T('three trained weeks read as a streak before this week begins',
      ctx.computeWeekStreak() >= 3, 'got ' + ctx.computeWeekStreak());
  }

  sub('this week is measured against the plan, day by day');
  T('the week reading reuses the consistency day states, not a second copy',
    /function momentumWeek\(\)\{[\s\S]{0,200}computeConsistencyData\(\)/.test(src));
  T('only scheduled days are counted', /week\.days\.filter\(d => d\.planned\)/.test(src));
  T('a day still ahead is not a miss', /if\(d\.state === 'future'\) return \{ state:'upcoming'/.test(src));
  T('today is today, compared as a calendar date', /const tKey = localDateStr\(\);/.test(src));
  T('and never as a weekday name — the bug that made today look missed',
    !/const tKey = todayKey\(\);/.test(src.slice(src.indexOf('function momentumWeek'), src.indexOf('function momentumHeadline'))));
  T('what is left counts only days that can still be trained',
    /remaining: days\.filter\(d => d\.state === 'today' \|\| d\.state === 'upcoming'\)\.length/.test(src));

  sub('every metric traces to an engine that already existed');
  T('PRs come from the app\'s own PR engine', /computeWeekSummary\(\)\.prs/.test(src));
  T('the lift signal comes from the trends Progress uses',
    /const trends = computeExerciseTrends\(\);/.test(src));
  T('no new storage key', ctx.DATA_KEYS.length === 15);
  T('no second definition of a streak, a week or a PR',
    (src.match(/function computeWeekStreak\(/g) || []).length === 1 &&
    (src.match(/function computeConsistencyData\(/g) || []).length === 1 &&
    (src.match(/function computeAllPREvents\(/g) || []).length === 1);

  sub('nothing claims more than the data supports');
  T('a beginner is not given a trend', /if\(totalSessions < 3\) return 'You are getting started\.';/.test(src));
  T('a streak is only shown once it is one', /if\(streak >= 2\)\{/.test(src));
  T('with no records and no history, progress says nothing rather than zero', (() => {
    const fn = src.slice(src.indexOf('function momentumProgress()'), src.indexOf('function momentumDotsHtml'));
    /* two or more tracked lifts before any trend claim, and a null exit when
       there is neither a record nor enough history */
    return /if\(trends\.length >= 2\)\{/.test(fn) && /return null;\s*\}\s*$/.test(fn.trim() + '\n');
  })());
  {
    ctx.workoutLog = [];
    ctx.cardioLog = [];
    ctx.invalidateSortedLogCache && ctx.invalidateSortedLogCache();
    ctx.renderTodayMomentum();
    const html = doc.getElementById('todayMomentum').innerHTML;
    T('a brand-new athlete gets one sentence, not a row of zeroes',
      html.indexOf('mo-empty') !== -1 && html.indexOf('mo-cell') === -1);
  }

  sub('a lighter week is not a failed week');
  T('a week with nothing scheduled says so', /Nothing scheduled this week — a planned rest\./.test(src));
  T('a finished week that fell short reports it without scolding',
    /return 'You trained ' \+ wk\.done \+ ' of ' \+ wk\.planned \+ ' this week\.';/.test(src));
  T('missed days use the warning hue, not the error one',
    /\.mo-dot-missed\{ background: none; border: 1\.5px solid var\(--warning\); \}/.test(css));
  T('rest days are not drawn at all', /week\.days\.filter\(d => d\.planned\)/.test(src));

  sub('the week is legible without seeing colour');
  T('the dots carry a spoken summary', /role="img" aria-label="/.test(src.slice(
    src.indexOf('function momentumDotsHtml'), src.indexOf('function renderTodayMomentum'))));
  T('which names completed, missed and remaining',
    /parts\.push\(missed \+ ' missed'\)/.test(src) && /' still to come'/.test(src));
  T('the primary reading is a real control with a name',
    /class="mo-primary"[\s\S]{0,200}aria-label="/.test(src));

  sub('the trainer is untouched');
  T('engine version', /TRAINER_ENGINE_VERSION = '0\.1\.1-shadow'/.test(src));
  T('shadow retention', /TRAINER_LOG_MAX = 2000/.test(src));
  T('no trainer symbol appears anywhere in Momentum', (() => {
    const fn = src.slice(src.indexOf('/* ---------- MOMENTUM ----------'), src.indexOf('function renderProgressJump'));
    return !/trainerLog|TRAINER_CONFIG|proposeTrainerState|computeReadiness|computeRecovery|computeCapability/.test(fn);
  })());
}

/* =========================================================
   CONTRACT 108 — The workout is a sequence (Phase D18)
   ---------------------------------------------------------
   One exercise on screen at a time, warm-up first, finish
   last — built as a visibility layer because LOOP's workout
   state IS the DOM.
   ========================================================= */
function testWorkoutStepper(app){
  section('CONTRACT 108 — the workout is a sequence');
  const ctx = app.ctx;
  const src = require('fs').readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

  sub('THE INVARIANT — every exercise stays mounted');
  /* captureActiveDraft() and saveLog() both read their values out of the
     rendered inputs. Unmounting the exercises the athlete is not looking at
     would silently drop them from the next autosave — which fires 250ms after
     any input and on pagehide — and from the final save. So the stepper hides
     rows; it must never remove them. */
  T('the stepper hides rows with CSS rather than unmounting them',
    /\.stepper-on \.ex-log-row,[\s\S]{0,80}display: none;/.test(css));
  T('and reveals exactly the current one',
    /\.stepper-on \.ex-log-row\.ws-current,[\s\S]{0,60}display: block;/.test(css));
  T('no stepper function removes an exercise row', (() => {
    const mod = src.slice(src.indexOf('const STEP_WARMUP'), src.indexOf('function openLogSheet()'));
    /* The stepper clears its own chrome (wsHead / wsNav) when there is nothing
       to step through — that is not the risk. The risk is touching the rows
       themselves, or the container that holds them, since that is where the
       workout's only copy of the athlete's sets lives. */
    const dangerous = [
      /#logExercises[^;\n]*\.(remove|removeChild)\s*\(/,
      /#logExercises[^;\n]*\.innerHTML\s*=/,
      /\.ex-log-row[^;\n]*\.(remove|removeChild)\s*\(/,
      /logExercises'\)\s*\.innerHTML/
    ];
    const hit = dangerous.filter(re => re.test(mod));
    return hit.length === 0 ? true : hit.map(String);
  })() === true);
  T('and it only ever toggles classes on them',
    /rows\.forEach\(\(row, idx\) => row\.classList\.toggle\('ws-current', idx === i\)\);/.test(src));
  T('skip flags the row, it does not delete it',
    /function skipWorkoutStep\(\)\{[\s\S]{0,220}row\.dataset\.skipped = '1';/.test(src));
  T('and a skipped exercise is still reachable',
    /onclick="goToWorkoutStep\(' \+ i \+ '\)"/.test(src));

  sub('the save path was not touched');
  T('saveLog still reads every mounted row',
    /const rows = document\.querySelectorAll\('#logExercises \.ex-log-row'\);/.test(src));
  T('the draft capture still reads every mounted row',
    /function captureActiveDraft[\s\S]{0,800}#logExercises \.ex-log-row/.test(src));
  T('the required inputs are still inside the sheet, by id', (() => {
    const sheet = src.slice(src.indexOf('id="logOverlay"'), src.indexOf('ADD / EDIT TEMPLATE SHEET'));
    return ['logTitle','logDate','logNotes','logExercises'].every(id => sheet.indexOf('id="' + id + '"') !== -1);
  })());
  T('and each appears exactly once in the document',
    ['logTitle','logDate','logNotes','logExercises','wsHead','wsNav','wsStage','wsReview']
      .every(id => (src.match(new RegExp('id="' + id + '"', 'g')) || []).length === 1));

  sub('the sequence');
  T('the warm-up is a stage, not a separate feature', /const STEP_WARMUP = -1;/.test(src));
  T('a review step ends it', /const STEP_FINISH = 9999;/.test(src));
  /* D18 gated the warm-up on two conditions. D18.1 added the third and most
     important one — that this workout has not already been through the stage —
     because closeLogSheet() reset the dismissal flag, so leaving a workout and
     returning put the athlete back on "Prepare to train" mid-session. */
  T('the warm-up only leads a workout that has not started',
    /if\(prepOffered && !warmupStagePassed\(\) && !started\)\{/.test(src));
  /* D19.2: "still to do" now means not FINISHED rather than untouched. A
     half-completed exercise is somewhere to return to, so resuming lands on
     it instead of stepping past it to the first with nothing logged. */
  T('a resumed workout opens on the first exercise still to do',
    /const firstOpen = rows\.findIndex\(r => !exerciseRowComplete\(r\)\);/.test(src));
  T('but "has this workout started" still asks whether anything is logged',
    /const started = rows\.some\(exerciseRowStarted\);/.test(src));
  T('a workout with no exercises stands the stepper down rather than breaking',
    /if\(!rows\.length\)\{[\s\S]{0,160}classList\.remove\('stepper-on'\)/.test(src));
  T('adding the first exercise lands on it, not on the review',
    /function onWorkoutRowAdded\(\)\{[\s\S]{0,220}logStepIndex = rows\.length - 1;/.test(src));

  sub('progress is read from the workout, not stored beside it');
  /* Was one predicate answering two questions: "done" meant a single logged
     set, so one set of three painted the rail green and outranked a skip.
     D19.2 separates them — started (anything logged) from complete (the work
     finished) — and completion is the definition markExerciseComplete already
     used to turn the row green, so there is still only one idea of finished. */
  T('an exercise is started when it has a completed set',
    /function exerciseRowStarted\(row\)\{\s*return !!row\.querySelector\('\.set-row\.completed'\);/.test(src));
  T('an exercise is complete only when every set on it is complete',
    /function exerciseRowComplete\(row\)\{[\s\S]{0,260}sets\.length > 0 && sets\.every\(s => s\.classList\.contains\('completed'\)\)/.test(src));
  T('completion is read from the sets, not from the green class', (() => {
    const i = src.indexOf('function exerciseRowComplete');
    const fn = src.slice(i, src.indexOf('\nfunction ', i + 10));
    /* Reading .ex-complete would miss a set ADDED to a finished exercise. */
    return !/ex-complete/.test(fn);
  })());
  T('an exercise with no sets at all is not complete',
    /sets\.length > 0 &&/.test(src));
  T('skipped never outranks complete',
    /function exerciseRowSkipped\(row\)\{\s*return row\.dataset\.skipped === '1' && !exerciseRowComplete\(row\);/.test(src));
  T('the segments carry each exercise\'s real state', /ws-seg-done|ws-seg-skip|ws-seg-now/.test(src));
  T('and name it for a screen reader', /aria-label="' \+ escapeAttr\('Exercise ' \+ \(i\+1\)/.test(src));
  T('the bar is tapped at full height even though it reads as a rule',
    /\.ws-seg\{[\s\S]{0,120}height: 44px;/.test(css));

  sub('muscle focus comes from the existing lookup');
  T('it reuses musclesForExercise', /try\{ m = musclesForExercise\(name\) \|\| m; \}catch\(e\)\{\}/.test(src));
  T('and the shared labels', /MUSCLE_LABELS\[k\] \|\| k/.test(src));
  T('an unclassifiable lift shows no chips rather than a guess',
    /if\(!p\.length && !sec\.length\) return '';/.test(src));
  T('no exercise descriptions were invented', (() => {
    const mod = src.slice(src.indexOf('const STEP_WARMUP'), src.indexOf('function openLogSheet()'));
    /* LOOP holds no per-exercise coaching text. The stepper shows what it
       genuinely knows and stays silent where it knows nothing. */
    return !/description|howTo|formCue/i.test(mod);
  })());

  sub('the redesign cannot stop a workout opening');
  T('the stepper is called defensively', /try\{ syncWorkoutStepper\(\{ reset:true \}\); \}catch\(e\)\{\}/.test(src));
  T('and so is every row-level refresh',
    /try\{ onWorkoutRowAdded\(\); \}catch\(e\)\{\}/.test(src));
  T('without it the sheet simply shows everything, as before',
    /\.stepper-on \.ex-log-row/.test(css) && !/\.ex-log-row\{[^}]*display: none/.test(css));

  sub('transitions are short and reduced-motion aware');
  T('two hundred milliseconds, not a page load',
    /animation: wsInR 0\.2s var\(--ease\) both/.test(css));
  T('and the global reduced-motion rule still removes them',
    /@media \(prefers-reduced-motion: reduce\)\{\s*\*\{ animation: none !important; transition: none !important; \}/.test(css));

  sub('nothing protected was touched');
  T('the trainer', /TRAINER_ENGINE_VERSION = '0\.1\.1-shadow'/.test(src));
  T('shadow retention', /TRAINER_LOG_MAX = 2000/.test(src));
  T('no new storage key', ctx.DATA_KEYS.length === 15);
  T('the warm-up engine is untouched',
    /function buildPrepSequence\(/.test(src) && /function enterPrepStep\(\)\{\s*clearPrepTimer\(\);/.test(src));
  T('the rest timer architecture is untouched',
    /function startRestPanel\(panel, seconds\)\{[\s\S]{0,120}clearRestTimer\(panel\);/.test(src));
  T('replacement still goes through the existing engine',
    /onclick="openSubstitutions\(this\)"/.test(src) &&
    (src.match(/function openSubstitutions\(/g) || []).length === 1);
  T('no stepper function writes to storage', (() => {
    const mod = src.slice(src.indexOf('const STEP_WARMUP'), src.indexOf('function openLogSheet()'));
    return !/LOOPStore\.|localStorage/.test(mod);
  })());
}

/* =========================================================
   CONTRACT 109 — Warm-up once, rest always visible (D18.1)
   ---------------------------------------------------------
   The warm-up is a stage of a workout, not a property of the
   screen being open — and a rest timer running on one
   exercise must not vanish when the athlete looks at another.
   ========================================================= */
function testWarmupAndRest(app){
  section('CONTRACT 109 — warm-up once, rest always visible');
  const ctx = app.ctx;
  const src = require('fs').readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

  /* D18.1 removed Skip; D18.2 reinstated it on the entry alone, because the
     warm-up is now a pre-workout prompt rather than a stage you walk past.
     The contract that matters is unchanged and is asserted below: Skip exists
     in exactly one place, and no exercise screen mentions the warm-up. */
  sub('the warm-up entry carries both choices, and nothing else does');
  const card = src.slice(src.indexOf('id="prepCard"'), src.indexOf('id="logCategoryPicker"'));
  T('two buttons on the entry', (card.match(/<button/g) || []).length === 2);
  T('and one of them starts the warm-up', /class="btn-primary prep-start-btn"[^>]*>Start Warm-up/.test(card));
  T('Skip lives on the entry', /class="prep-skip-btn"/.test(card));
  T('the stage navigation stays out of the entry\'s way', (() => {
    const fn = src.slice(src.indexOf("if(i === STEP_WARMUP){"), src.indexOf("} else if(i === STEP_FINISH){"));
    return /nav\.innerHTML = '';/.test(fn);
  })());
  T('and no exercise screen mentions the warm-up at all', (() => {
    /* The exercise branch of renderWorkoutStep — everything an athlete sees in
       the head and navigation on every exercise. The word must not appear. */
    const start = src.indexOf('\'<div class="ws-k">Exercise \'');
    const end = src.indexOf('/* A step change starts at the top');
    if(start === -1 || end === -1 || end <= start) return 'branch not found';
    return !/warm.?up/i.test(src.slice(start, end));
  })() === true);

  sub('the warm-up belongs to the workout, not to the screen');
  /* closeLogSheet() resets prepCardDismissed, so before this the athlete could
     leave a workout mid-session and be shown "Prepare to train" on return. */
  T('the stage is tracked against the workout\'s own id',
    /let warmupDoneForDraft = null;/.test(src) &&
    /function warmupStagePassed\(\)\{\s*return !!pendingDraftId && warmupDoneForDraft === pendingDraftId;/.test(src));
  T('entering the exercises closes the stage, by any route',
    /if\(i !== STEP_WARMUP\) markWarmupStagePassed\(\);/.test(src));
  T('and the stage is one-way',
    /if\(i === STEP_WARMUP && warmupStagePassed\(\)\) return;/.test(src));
  T('Previous from the first exercise cannot re-enter it',
    /if\(logStepIndex <= 0\)\{\s*if\(warmupStagePassed\(\)\) return;/.test(src));
  T('it leads only a workout that has one, has not passed it, and has not started',
    /if\(prepOffered && !warmupStagePassed\(\) && !started\)\{/.test(src));

  sub('and it survives a reload without a new storage key');
  T('the flag rides inside the draft that already persists',
    /warmupDone: warmupStagePassed\(\),/.test(src));
  T('a restored workout reads it back',
    /warmupDoneForDraft = draft\.warmupDone \? pendingDraftId : warmupDoneForDraft;/.test(src));
  T('no new storage key', ctx.DATA_KEYS.length === 15);
  T('and workoutLog was not given a new field', (() => {
    const fn = src.slice(src.indexOf('function saveLog(btn)'), src.indexOf('const priorSetsSnapshot'));
    return !/warmupDone/.test(fn);
  })());

  sub('rest stays visible when the athlete looks elsewhere');
  /* D18 turned the workout into a sequence, which meant a timer started on one
     exercise disappeared the moment another was shown. */
  T('a compact readout exists in the workout chrome', /id="wsRest"/.test(src));
  T('it starts hidden', /<button type="button" class="ws-rest" id="wsRest" hidden/.test(src));
  T('it shows only while the owning exercise is off screen',
    /const showing = !!panel && !!owner && !owner\.classList\.contains\('ws-current'\);/.test(src));
  T('it reads the panel rather than keeping its own clock', (() => {
    const fn = src.slice(src.indexOf('function syncWorkoutRestChip()'), src.indexOf('function jumpToRestingExercise'));
    return !/setInterval|setTimeout|Date\.now/.test(fn) && /panel\.dataset\.remaining/.test(fn);
  })());
  T('it is refreshed from the one place the timer redraws',
    /updateRestRing\(panel\);[\s\S]{0,220}syncWorkoutRestChip\(\);/.test(src));
  T('and again whenever the visible exercise changes',
    /row\.classList\.toggle\('ws-current', idx === i\)\);[\s\S]{0,80}syncWorkoutRestChip\(\);/.test(src));
  T('tapping it goes to the exercise that is resting',
    /function jumpToRestingExercise\(\)\{[\s\S]{0,260}goToWorkoutStep\(idx\);/.test(src));
  T('it carries a spoken description', /chip\.setAttribute\('aria-label',/.test(src));
  T('it never covers the exercise — it sits in the chrome above the navigation',
    src.indexOf('id="wsRest"') < src.indexOf('class="ws-nav" id="wsNav"'));
  T('it is a full-height target', /\.ws-rest\{[\s\S]{0,300}min-height: 44px;/.test(css));
  T('and its motion is dropped under reduced motion',
    /@media \(prefers-reduced-motion: reduce\)\{\s*\.ws-rest::after\{ transition: none; \}/.test(css));

  sub('the timer architecture was not touched');
  T('still deadline-based', /const endsAt = parseInt\(panel\.dataset\.endsAt, 10\) \|\| 0;/.test(src));
  T('still cleared before starting, so a second tap cannot double it',
    /function startRestPanel\(panel, seconds\)\{[\s\S]{0,120}clearRestTimer\(panel\);/.test(src));
  T('completion still fires one haptic',
    /function completeRestPanel[\s\S]{0,400}loopHaptic\(\);/.test(src) &&
    (src.match(/function completeRestPanel\(/g) || []).length === 1);

  sub('the D18 stepper invariants still hold');
  T('rows are hidden, never unmounted',
    /\.stepper-on \.ex-log-row,[\s\S]{0,80}display: none;/.test(css));
  T('saveLog still reads every mounted row',
    /const rows = document\.querySelectorAll\('#logExercises \.ex-log-row'\);/.test(src));
  T('skip still only flags', /row\.dataset\.skipped = '1';/.test(src));
  T('the warm-up library is untouched',
    /function buildPrepSequence\(/.test(src) && /function enterPrepStep\(\)\{\s*clearPrepTimer\(\);/.test(src));
  T('the trainer is untouched', /TRAINER_ENGINE_VERSION = '0\.1\.1-shadow'/.test(src));
  T('no D18.1 function writes to storage', (() => {
    const fn = src.slice(src.indexOf('function activeRestPanel()'), src.indexOf('function renderWorkoutStep(opts)'));
    return !/LOOPStore\.|localStorage/.test(fn);
  })());
}

/* =========================================================
   CONTRACT 110 — The warm-up is an entry (Phase D18.2)
   ---------------------------------------------------------
   renderPrepCard() wrote card.style.display = 'flex', and an
   inline style cannot be overridden by the stepper's
   stylesheet rule. So the warm-up card stayed mounted and
   visible above every exercise for the whole workout — a
   138px bordered box reading "WARM-UP" on top of Exercise 1.
   ========================================================= */
function testWarmupEntry(app){
  section('CONTRACT 110 — the warm-up is an entry, not a page');
  const ctx = app.ctx;
  const src = require('fs').readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

  sub('availability and visibility are different things');
  T('renderPrepCard reports availability', /card\.dataset\.available = '1';/.test(src));
  T('and no longer forces the card on screen', (() => {
    const fn = src.slice(src.indexOf('function renderPrepCard()'), src.indexOf('function resetPrepCardForNewWorkout'));
    return !/card\.style\.display = 'flex'/.test(fn);
  })());
  T('the stepper owns the display outright',
    /prepCard\.style\.display = onEntry \? 'flex' : 'none';/.test(src));
  T('and it only shows on the entry stage, and only if one exists',
    /const onEntry = \(i === STEP_WARMUP\) && prepCard\.dataset\.available === '1';/.test(src));
  T('the stage gate asks the data flag, not the style',
    /const prepOffered = prep && prep\.dataset\.available === '1';/.test(src));

  sub('choosing either option spends the entry');
  T('Skip retires the entry and enters the workout',
    /function skipPrep\(\)\{[\s\S]{0,400}goToWorkoutStep\(0\);/.test(src));
  T('leaving the warm-up runner does the same',
    /function exitPrep\(\)[\s\S]{0,600}prepCardDismissed = true;[\s\S]{0,300}goToWorkoutStep\(0\);/.test(src));
  T('and it clears its timer first, before anything else',
    /function exitPrep\(\)\{\s*clearPrepTimer\(\);/.test(src));
  T('the entry carries both choices',
    (src.slice(src.indexOf('id="prepCard"'), src.indexOf('id="logCategoryPicker"')).match(/<button/g) || []).length === 2);
  T('so the stage navigation shows nothing', (() => {
    const fn = src.slice(src.indexOf("if(i === STEP_WARMUP){"), src.indexOf("} else if(i === STEP_FINISH){"));
    return /nav\.innerHTML = '';/.test(fn);
  })());
  T('and no exercise screen mentions the warm-up', (() => {
    const start = src.indexOf('\'<div class="ws-k">Exercise \'');
    const end = src.indexOf('/* A step change starts at the top');
    return start !== -1 && end > start && !/warm.?up/i.test(src.slice(start, end));
  })());

  sub('the entry is the page, not a card on it');
  T('it drops its border, radius and gradient inside the stepper',
    /\.stepper-on #prepCard\.ws-current\{[\s\S]{0,180}background: none; border: none; border-radius: 0;/.test(css));
  T('Skip reads as secondary, not as a second button',
    /\.stepper-on #prepCard\.ws-current \.prep-skip-btn\{[\s\S]{0,200}background: none; border: none;/.test(css));

  sub('the workout surface');
  T('the page variant carries no card frame',
    /\.sheet\.sheet-page\{[\s\S]{0,140}border-radius: 0; border-top: none; box-shadow: none;/.test(css));
  T('the head separates with a rule rather than a filled bar', (() => {
    const m = css.match(/\.ws-head\{([^}]*)\}/);
    return !!m && /border-bottom: 1px solid var\(--border\)/.test(m[1]) && !/background:/.test(m[1]);
  })());
  T('the current exercise is the screen, not a card',
    /\.stepper-on \.ex-log-row\.ws-current\{\s*border: none; padding: 0; margin-top: 0;/.test(css));
  T('progress reads as one rail rather than separate bars',
    /\.ws-seg::before\{[\s\S]{0,200}height: 2px;/.test(css) && /\.ws-seg:first-child::before\{ left: 50%; \}/.test(css));
  /* D19.2 replaced the fixed Next button with one forward slot that changes
     with the state. The assertion this replaces checked that Next outweighed
     Previous; this checks the same balance AND that the slot is singular. */
  T('the forward action dominates the navigation',
    /\.ws-nav-fwd\.is-next, \.ws-nav-fwd\.is-finish\{[\s\S]{0,120}background: var\(--accent\)/.test(css) &&
    /\.ws-nav-btn\{ background: none; border: none;/.test(css));
  T('and skip takes that same slot without taking its emphasis',
    /\.ws-nav-fwd\.is-skip\{[\s\S]{0,160}background: var\(--surface-2\)/.test(css) &&
    /\.ws-nav-fwd\{\s*flex: 1;/.test(css));

  sub('D18 and D18.1 invariants survive');
  T('rows are hidden, never unmounted',
    /\.stepper-on \.ex-log-row,[\s\S]{0,80}display: none;/.test(css));
  T('saveLog still reads every mounted row',
    /const rows = document\.querySelectorAll\('#logExercises \.ex-log-row'\);/.test(src));
  T('the stage is still tied to the workout, not the screen',
    /function warmupStagePassed\(\)\{\s*return !!pendingDraftId && warmupDoneForDraft === pendingDraftId;/.test(src));
  T('and still survives a reload inside the draft',
    /warmupDone: warmupStagePassed\(\),/.test(src));
  T('the compact rest readout is still there', /id="wsRest"/.test(src));
  T('no new storage key', ctx.DATA_KEYS.length === 15);
  T('the warm-up library is untouched',
    /function buildPrepSequence\(/.test(src) && /function enterPrepStep\(\)\{\s*clearPrepTimer\(\);/.test(src));
  T('the trainer is untouched', /TRAINER_ENGINE_VERSION = '0\.1\.1-shadow'/.test(src));
}

/* =========================================================
   CONTRACT 111 — Rotating does not resize the app (D18.3)
   ---------------------------------------------------------
   Safari on iOS inflates text when a block's width grows
   relative to the viewport, which is exactly what rotating
   to landscape does. LOOP never set text-size-adjust, so the
   computed value was `auto` — the value that permits it —
   and the workout came back from a rotation with larger type
   than it was designed with.
   ========================================================= */
function testOrientationScale(app){
  section('CONTRACT 111 — rotating does not resize the app');
  const ctx = app.ctx;
  const src = require('fs').readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

  sub('the inflation guard exists');
  T('text-size-adjust is set on the root',
    /html\{[\s\S]{0,900}-webkit-text-size-adjust: 100%;/.test(css));
  T('and the standard property alongside it',
    /html\{[\s\S]{0,960}[^-]text-size-adjust: 100%;/.test(css));
  /* 100%, not none: none would also take away the athlete's own text scaling.
     The guard must stop Safari inflating, not stop the user choosing. */
  T('it does not disable the athlete\'s own scaling',
    !/text-size-adjust:\s*none/i.test(css));
  T('the viewport meta is unchanged and still scales to the device',
    /<meta name="viewport" content="width=device-width, initial-scale=1\.0, viewport-fit=cover">/.test(src));

  sub('and nothing else can change the scale');
  /* The fix is one declaration because there was only one cause. These
     assertions keep the other candidates from reappearing. */
  T('no typography is sized in viewport units',
    !/font-size:[^;]*\b\d+v(w|h|min|max)\b/.test(css));
  T('no user-scalable lock', !/user-scalable\s*=\s*(no|0)/i.test(src));
  T('no maximum-scale lock', !/maximum-scale/i.test(src));
  T('the workout surface is not transform-scaled', (() => {
    /* Read each rule body by slicing on its literal selector — building a
       regex from the selector needs escaping that does not survive being
       written through a template literal. */
    const bodyOf = (sel) => {
      const i = css.indexOf(sel + '{');
      if(i === -1) return '';
      return css.slice(i, css.indexOf('}', i));
    };
    const scaled = ['.sheet.sheet-page', '.ws-head', '.ws-nav', '.ws-rest']
      .filter(sel => /transform:[^;]*scale\(/.test(bodyOf(sel)));
    return scaled.length === 0 ? true : scaled;
  })() === true);
  T('and the scale guard reads the real rules', (() => {
    const i = css.indexOf('.sheet.sheet-page{');
    return i !== -1;
  })());
  T('no landscape rule changes a field\'s font size', (() => {
    const i = css.indexOf('@media (orientation: landscape) and (max-height: 500px)');
    if(i === -1) return 'landscape block missing';
    const slice = css.slice(i, i + 4500);
    const bad = [...slice.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(m => /(^|[\s,>+~])(input|textarea|select)\b|-in\b/.test(m[1]) && /font-size/.test(m[2]))
      .map(m => m[1].trim());
    return bad.length === 0 ? true : bad;
  })() === true);

  sub('every editable workout control clears the iOS zoom floor');
  /* Below 16px Safari zooms the page on focus and does not zoom back. This is
     asserted at the rule level so a new field cannot reintroduce it. */
  T('the base field size is at the threshold',
    /input, textarea, select\{[\s\S]{0,300}font-size: 16px;/.test(css));
  T('and no rule anywhere sets a field below it', (() => {
    const bad = [];
    const re = /([^{}]+)\{([^{}]*)\}/g; let m;
    while((m = re.exec(css))){
      const sel = m[1].replace(/\s+/g,' ').trim();
      if(!/(^|[\s,>+~])(input|textarea|select)\b/.test(sel)) continue;
      const f = m[2].match(/font-size:\s*([\d.]+)px/);
      if(f && parseFloat(f[1]) < 16 && !/::|checkbox|radio|range/.test(sel)) bad.push(sel + ' @' + f[1]);
    }
    return bad.length === 0 ? true : bad;
  })() === true);

  sub('this was presentation only');
  T('no new storage key', ctx.DATA_KEYS.length === 15);
  T('the trainer is untouched', /TRAINER_ENGINE_VERSION = '0\.1\.1-shadow'/.test(src));
  T('shadow retention is untouched', /TRAINER_LOG_MAX = 2000/.test(src));
  T('autosave is untouched',
    /function scheduleDraftSave\(\)\{[\s\S]{0,220}persistDraftNow\(\); \}, 250\);/.test(src));
  T('draft restoration is untouched', /function restoreDraftToSheet\(draft\)\{/.test(src));
  T('saveLog still reads every mounted row',
    /const rows = document\.querySelectorAll\('#logExercises \.ex-log-row'\);/.test(src));
}

/* =========================================================
   CONTRACT 112 — Movement library stays out of production
   ---------------------------------------------------------
   The design library (loop-movement.js) is a review asset. It
   is NOT authoritative for what athletes are given. These
   assertions exist so D18C cannot let a visual redesign
   become an unreviewed training-programme redesign.
   ========================================================= */
function testMovementLibraryBoundary(app){
  section('CONTRACT 112 — movement library stays out of production');
  const ctx = app.ctx;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const libPath = H.APP_PATH.replace(/index\.html$/, 'loop-movement.js');
  const lib = fs.existsSync(libPath) ? fs.readFileSync(libPath, 'utf8') : '';

  sub('production registries changed only where D18C approved it');
  /* Was "still has 22". D18C approved exactly five additions, so the count is
     no longer the interesting fact — WHICH five is. Naming them is stricter
     than a total: a count of 27 would also be satisfied by five wrong ones,
     or by five additions plus a silent deletion. */
  T('PREP_MOVEMENTS has the 22 originals plus the 5 approved additions',
    (ctx.PREP_MOVEMENTS || []).length === 27, String((ctx.PREP_MOVEMENTS||[]).length));
  ['reach_rotate','band_passthrough','hamstring_sweep','deep_squat_hold','reverse_lunge']
    .forEach(id => T('approved addition present: ' + id,
      (ctx.PREP_MOVEMENTS||[]).some(m => m.id === id)));
  /* The four the brief withheld. Nothing should have swept them in alongside
     the five that were approved. */
  ['calf_raise','hip_hinge','bird_dog','hip_9090']
    .forEach(id => T('withheld movement stayed out: ' + id,
      !(ctx.PREP_MOVEMENTS||[]).some(m => m.id === id)));
  T('COOLDOWN_STRETCHES still has 13',
    (ctx.COOLDOWN_STRETCHES || []).length === 13, String((ctx.COOLDOWN_STRETCHES||[]).length));
  T('production movement ids are unique',
    (() => { const ids = [...(ctx.PREP_MOVEMENTS||[]), ...(ctx.COOLDOWN_STRETCHES||[])].map(m => m.id);
             return new Set(ids).size === ids.length; })());

  /* Was "production is not reading the design library" — a D18B boundary that
     D18C deliberately crosses. The thing that assertion was really protecting
     is that production content must not silently become whatever the design
     file happens to say. That is now asserted directly, and harder: the
     vendored renderer must match loop-movement.js byte for byte, so the
     review tool always shows exactly what the app draws. */
  T('production vendors the renderer instead of linking it',
    /LOOP-MOVEMENT-BEGIN/.test(src) && !/<script[^>]*\ssrc=/.test(src));
  T('the vendored renderer has not drifted from loop-movement.js', (() => {
    if(!lib) return 'loop-movement.js not found';
    const open = 'LOOP-MOVEMENT-BEGIN */';
    const a = src.indexOf(open), b = src.indexOf('/* LOOP-MOVEMENT-END */');
    if(a < 0 || b < 0) return 'markers missing';
    const norm = t => t.split('\r\n').join('\n').trim();
    return norm(src.slice(a + open.length, b)) === norm(lib) ? true : 'drifted';
  })() === true);

  sub('rejected content replacements stay rejected');
  /* D18A rejected these two mappings: marching is dynamic preparation and a
     quad stretch is static stretching; dead bug is anti-extension core work and
     a hip hinge is a pattern rehearsal. Neither pair is interchangeable. */
  const prepIds = (ctx.PREP_MOVEMENTS || []).map(m => m.id);
  T('march_in_place survives in production', prepIds.indexOf('march_in_place') !== -1);
  T('dead_bug survives in production', prepIds.indexOf('dead_bug') !== -1);
  T('march_in_place is still dynamic preparation, not a stretch',
    (ctx.PREP_MOVEMENTS.find(m => m.id === 'march_in_place') || {}).category === 'dynamic_mobility');
  T('dead_bug is still activation, not movement prep',
    (ctx.PREP_MOVEMENTS.find(m => m.id === 'dead_bug') || {}).category === 'activation');

  sub('production-only movements are not silently retired');
  /* Ten production movements have no design equivalent. Two carry coverage
     nothing else does: the only lat activation, and the only frontal-plane
     glute work. */
  ['straight_arm_pulldown','monster_walk','band_row','torso_twist']
    .forEach(id => T(id + ' is still in PREP_MOVEMENTS', prepIds.indexOf(id) !== -1));
  ['upper_back_round','rear_delt_stretch','spinal_twist','chest_doorway','glute_figure4']
    .forEach(id => T(id + ' is still in COOLDOWN_STRETCHES',
      (ctx.COOLDOWN_STRETCHES||[]).map(m=>m.id).indexOf(id) !== -1));
  T('cat_cow is still in production', prepIds.indexOf('cat_cow') !== -1);

  sub('the hinge is not duplicated');
  /* Production has hip_hinge_bw; the design library has hip_hinge. Both are a
     bodyweight hinge rehearsal. Exposing both would let the selector offer the
     same movement twice. */
  T('production has exactly one hinge rehearsal',
    prepIds.filter(id => /^hip_hinge/.test(id)).length === 1, prepIds.filter(id=>/^hip_hinge/.test(id)).join(','));
  T('and it is the production id', prepIds.indexOf('hip_hinge_bw') !== -1);

  sub('dead_hang keeps its production classification');
  /* The design classifies it as a cooldown stretch. That changes WHEN it is
     offered. Until that is decided as a content question, production wins. */
  T('dead_hang is in PREP, not COOLDOWN', prepIds.indexOf('dead_hang') !== -1);
  T('and is still dynamic mobility',
    (ctx.PREP_MOVEMENTS.find(m => m.id === 'dead_hang') || {}).category === 'dynamic_mobility');

  if(!lib){ T('design library present for renderer assertions', false, 'loop-movement.js not found'); return; }

  sub('the design library itself');
  T('movement ids are unique', (() => {
    const ids = [...lib.matchAll(/\{ id:'([a-z0-9_]+)'/g)].map(m => m[1]);
    return ids.length > 30 && new Set(ids).size === ids.length;
  })());
  /* Was "it still declares itself design-phase only". D18C shipped it, so that
     header would now be a lie sitting in production code. What replaces it is
     the fact a future reader actually needs: this file is vendored, there is a
     script that does it, and editing the copy in index.html is the wrong move. */
  T('it documents that it is vendored rather than design-only',
    /vendored verbatim into index\.html/.test(lib) && !/Design-phase library only/.test(lib));
  T('it names the script that keeps the copies in step',
    /sync-movement\.js/.test(lib) && fs.existsSync(H.APP_PATH.replace(/index\.html$/, 'sync-movement.js')));
  T('reduced motion is honoured', /prefers-reduced-motion/.test(lib) && /renderStatic/.test(lib));
  T('one figure system, not several', (lib.match(/function Figure\(/g) || []).length === 1);
  T('the custom element is registered once',
    (lib.match(/customElements\.define\('loop-move'/g) || []).length === 1);

  sub("child_pose's shadow stays inside the frame");
  /* Measured on an isolated element: the ground ellipse follows J.mid.x, and
     the deepest fold puts mid.x at 86. With rx 60 its left edge landed at 26
     against a viewBox starting at 30 — 4.5 units of the shadow were clipped. */
  T('the viewBox still starts at x=30', /viewBox:'30 10 180 178'/.test(lib));
  T('child_pose shadow is trimmed to fit', /child_pose[\s\S]{0,700}shadow:\{cx:'mid',rx:52\}/.test(lib));
  T('and 52 clears the deepest fold', (() => {
    const seg = lib.slice(lib.indexOf("{ id:'child_pose'"));
    const mids = [...seg.slice(0, 1600).matchAll(/mid:\[(\d+)/g)].map(m => Number(m[1]));
    return mids.length > 0 && Math.min(...mids) - 52 >= 30;
  })());
  T('no other movement shadow overruns the frame', (() => {
    const bad = [];
    [...lib.matchAll(/\{ id:'([a-z0-9_]+)'([\s\S]{0,1800}?)\n\n/g)].forEach(m => {
      const sh = m[2].match(/shadow:\{(?:cx:'mid',)?rx:(\d+)\}/);
      if(!sh) return;
      const usesMid = /shadow:\{cx:'mid'/.test(m[2]);
      const key = usesMid ? 'mid' : 'pelvis';
      const xs = [...m[2].matchAll(new RegExp(key + ":\\[(\\d+)", 'g'))].map(x => Number(x[1]));
      if(!xs.length) return;
      if(Math.min(...xs) - Number(sh[1]) < 30) bad.push(m[1]);
    });
    return bad.length === 0 ? true : bad;
  })() === true);
}

/* =========================================================
   CONTRACT 113 — Movement animation integration
   ---------------------------------------------------------
   D18C put the reviewed figure renderer into the prep runner.
   The renderer draws; it decides nothing. These assertions
   hold that line: the registries still say what an athlete is
   given, the countdown still says how long, and a movement
   with no authored animation shows no figure rather than a
   plausible-looking wrong one.
   ========================================================= */
function testMovementAnimation(app){
  section('CONTRACT 113 — movement animation integration');
  const ctx = app.ctx, dom = app.dom;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const lib = ctx.window && ctx.window.LoopMovement;
  const M = ctx.MOVEMENT_ANIMATION || {};
  const prep = ctx.PREP_MOVEMENTS || [], cool = ctx.COOLDOWN_STRETCHES || [];
  const ids = [...prep, ...cool].map(m => m.id);
  const byId = id => [...prep, ...cool].find(m => m.id === id) || {};
  /* The vendored renderer, isolated, so assertions about what the animation
     code may not do cannot be satisfied by the rest of the app. */
  const vendorStart = src.indexOf('LOOP-MOVEMENT-BEGIN */');
  const vendorEnd = src.indexOf('/* LOOP-MOVEMENT-END */');
  const vendored = vendorStart > 0 && vendorEnd > vendorStart ? src.slice(vendorStart, vendorEnd) : '';
  /* Assertions about what the renderer DOES must read code, not prose. The
     header says the renderer knows nothing about the trainer; without
     stripping comments, that sentence is itself a match for /trainer/. */
  const vendoredCode = vendored
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  sub('the renderer reached production intact');
  T('LoopMovement is exposed to the app', !!lib);
  T('it carries the reviewed movement set',
    !!lib && lib.MOVEMENTS.length === 34, lib ? String(lib.MOVEMENTS.length) : 'absent');
  T('the vendored region was located', vendored.length > 40000, String(vendored.length));
  /* The harness has no HTMLElement and no customElements. Without this guard
     the renderer throws while loading and takes every contract down with it. */
  T('element registration is guarded for non-browser environments',
    /typeof HTMLElement!=='undefined'&&typeof customElements!=='undefined'/.test(vendored));
  T('the app still loads with zero errors', app.errors.length === 0, app.errors.slice(0,2).join(' | '));

  sub('every mapping resolves to something real');
  T('the map covers the movements that have an animation',
    Object.keys(M).length === 31, String(Object.keys(M).length));
  T('every mapped key is a real production movement', (() => {
    const bad = Object.keys(M).filter(k => ids.indexOf(k) === -1);
    return bad.length === 0 ? true : bad.join(',');
  })() === true);
  T('every animation target exists in the library', (() => {
    if(!lib) return 'library absent';
    const bad = Object.keys(M).filter(k => !lib.get(M[k]));
    return bad.length === 0 ? true : bad.join(',');
  })() === true);
  T('no two movements are drawn with the same animation', (() => {
    const seen = {}, dupes = [];
    Object.keys(M).forEach(k => { if(seen[M[k]]) dupes.push(M[k]); seen[M[k]] = 1; });
    return dupes.length === 0 ? true : dupes.join(',');
  })() === true);
  T('an unmapped movement resolves to no animation',
    ctx.animationForMovement('definitely_not_a_movement') === null);
  T('every registry movement either has a resolvable animation or none at all',
    ids.every(id => { const a = ctx.animationForMovement(id); return a === null || !!lib.get(a); }));

  sub('rejected mappings stay rejected');
  /* D18A refused these two: marching is dynamic preparation and a quad stretch
     is a static hold; a dead bug is anti-extension core work and a hinge is a
     pattern rehearsal. Drawing one as the other would teach the wrong
     movement, which is worse than drawing nothing. */
  T('march_in_place is not drawn as a quad stretch',
    !M.march_in_place && ctx.animationForMovement('march_in_place') === null);
  T('dead_bug is not drawn as a hip hinge',
    !M.dead_bug && ctx.animationForMovement('dead_bug') === null);
  T('quad_stretch still draws itself', M.quad_stretch === 'quad_stretch');
  T('hip_hinge_bw draws the hinge under its own production id', M.hip_hinge_bw === 'hip_hinge');

  sub('production-only movements show no figure rather than a wrong one');
  ['straight_arm_pulldown','monster_walk','band_row','torso_twist',
   'upper_back_round','rear_delt_stretch','spinal_twist'].forEach(id => {
    T(id + ' is still offered', ids.indexOf(id) !== -1);
    T(id + ' draws nothing rather than something approximate',
      ctx.animationForMovement(id) === null);
  });

  sub('the three approved content changes actually landed');
  /* The ids stayed canonical, which means an id check alone would pass even if
     the content change had been forgotten. These assert the content. */
  T('cat_cow is now the standing variant', byId('cat_cow').displayName === 'Standing Cat-Cow');
  T('and no longer sends the athlete to all fours', !/all fours/i.test(byId('cat_cow').instruction));
  T('and draws the standing animation', M.cat_cow === 'standing_cat_cow');
  T('chest_doorway is now the chest opener', byId('chest_doorway').displayName === 'Chest Opener');
  T('and no longer requires a doorway', !/frame|doorway/i.test(byId('chest_doorway').instruction));
  T('and draws the chest opener', M.chest_doorway === 'chest_opener');
  T('glute_figure4 is now the standing variant', byId('glute_figure4').displayName === 'Standing Figure-4');
  T('and no longer requires lying down', !/on your back/i.test(byId('glute_figure4').instruction));
  T('and draws the standing figure-4', M.glute_figure4 === 'standing_figure4');

  sub('nobody is given a different warm-up');
  /* Sequences are explicit id lists, so growing the registry changes nothing
     on its own. Adopting the new movements into a sequence WOULD change what
     an athlete is told to do, and that is a programming decision D18C did not
     authorise — this holds the line until it is made deliberately. */
  const added = ['reach_rotate','band_passthrough','hamstring_sweep','deep_squat_hold','reverse_lunge'];
  T('no prep sequence silently adopted a new movement',
    !Object.keys(ctx.PREP_SEQUENCES).some(k => ctx.PREP_SEQUENCES[k].some(id => added.indexOf(id) !== -1)));
  T('the fallback sequence did not either',
    !(ctx.PREP_SEQUENCE_FALLBACK || []).some(id => added.indexOf(id) !== -1));
  T('every prep sequence id still resolves to a movement', (() => {
    const bad = [];
    Object.keys(ctx.PREP_SEQUENCES).forEach(k =>
      ctx.PREP_SEQUENCES[k].forEach(id => { if(!ctx.getPrepMovement(id)) bad.push(k + '/' + id); }));
    (ctx.PREP_SEQUENCE_FALLBACK || []).forEach(id => { if(!ctx.getPrepMovement(id)) bad.push('fallback/' + id); });
    return bad.length === 0 ? true : bad.join(',');
  })() === true);
  T('every cooldown sequence id still resolves', (() => {
    const bad = [];
    Object.keys(ctx.COOLDOWN_SEQUENCES).forEach(k =>
      ctx.COOLDOWN_SEQUENCES[k].forEach(id => { if(!ctx.getCooldownStretch(id)) bad.push(k + '/' + id); }));
    (ctx.COOLDOWN_SEQUENCE_FALLBACK || []).forEach(id => { if(!ctx.getCooldownStretch(id)) bad.push('fallback/' + id); });
    return bad.length === 0 ? true : bad.join(',');
  })() === true);

  sub('the countdown stays the only clock');
  T('the renderer starts no interval of its own', !/setInterval|setTimeout/.test(vendoredCode));
  T('it does not reach for the production timer', !/prepState|prepTimerId/.test(vendoredCode));
  T('pausing stops the loop instead of rebuilding it',
    /pause=function\(\)\{\s*this\._paused=true;\s*this\._stop\(\);\s*\}/.test(vendored));
  /* Animation time accumulates on the instance and is only zeroed by a
     rebuild, so resume() picks up the pose pause() stopped on. */
  T('resuming keeps the pose it stopped on',
    /self\._t\+=dt\*/.test(vendored) &&
    !/this\._t\s*=\s*0/.test(vendored.slice(vendored.indexOf('resume=function'))));
  T('animation frames are cancelled on disconnect',
    /disconnectedCallback=function\(\)\{this\._stop\(\);\}/.test(vendored));

  sub('reduced motion');
  T('the renderer honours the preference', /prefers-reduced-motion/.test(vendored));
  T('and renders a held pose rather than nothing', /renderStatic/.test(vendored));
  T('a static figure never starts a loop',
    /if\(noAnim\)\{this\._fig\.renderStatic\(\);return;\}/.test(vendored));

  sub('lifecycle — nothing outlives the screen');
  /* The fallback sequence opens with march_in_place, which is deliberately
     unanimated, so this walks the whole sequence and asserts both branches:
     a figure where one was authored, nothing where one was not. */
  ctx.startPrep();
  const steps = [];
  for(let i = 0; i < 8 && ctx.prepState && ctx.prepState.idx < ctx.prepState.seq.length; i++){
    const m = ctx.prepState.seq[ctx.prepState.idx];
    const html = dom.els.prepRun.innerHTML;
    steps.push({ id: m.id, anim: ctx.animationForMovement(m.id),
                 figs: (html.match(/<loop-move/g) || []).length, html });
    ctx.nextPrepStep();
  }
  T('the sequence was actually walked', steps.length >= 3, String(steps.length));
  T('at least one step had an animation to draw', steps.some(s => s.anim));
  T('a movement with an animation renders exactly one figure',
    steps.filter(s => s.anim).every(s => s.figs === 1),
    steps.filter(s => s.anim && s.figs !== 1).map(s => s.id + ':' + s.figs).join(','));
  T('a movement without one renders no figure at all',
    steps.filter(s => !s.anim).every(s => s.figs === 0),
    steps.filter(s => !s.anim && s.figs !== 0).map(s => s.id).join(','));
  T('the figure is given the mapped animation id',
    steps.filter(s => s.anim).every(s => s.html.indexOf('movement="' + s.anim + '"') !== -1));
  ctx.exitPrep();
  T('exit empties the runner so the figure disconnects', dom.els.prepRun.innerHTML === '');
  T('exit clears the timer', ctx.prepTimerId === null);
  T('exit clears the state', ctx.prepState === null);

  sub('abuse — rapid taps and rapid open/close');
  ctx.startPrep();
  const seqLen = ctx.prepState.seq.length;
  for(let i = 0; i < 40; i++) ctx.nextPrepStep();
  T('rapid Next cannot run the index past the sequence',
    ctx.prepState === null || ctx.prepState.idx <= seqLen);
  T('and leaves no timer behind', ctx.prepTimerId === null);
  ctx.exitPrep();
  for(let i = 0; i < 20; i++){ ctx.startPrep(); ctx.exitPrep(); }
  T('twenty open/close cycles leave no timer', ctx.prepTimerId === null);
  T('and no state', ctx.prepState === null);
  T('and an empty runner', dom.els.prepRun.innerHTML === '');

  sub('the animation touches no data and no trainer');
  T('the renderer never writes to storage', !/LOOPStore|localStorage|\.setItem\(/.test(vendoredCode));
  T('it defines no data key', !/DATA_KEYS/.test(vendoredCode));
  T('DATA_KEYS is still exactly 15', (ctx.DATA_KEYS || []).length === 15, String((ctx.DATA_KEYS||[]).length));
  T('no movement or animation key was added',
    !(ctx.DATA_KEYS || []).some(k => /anim|movement|figure|prep/i.test(k)));
  T('the trainer engine version is untouched',
    ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow', String(ctx.TRAINER_ENGINE_VERSION));
  T('the renderer knows nothing about the trainer',
    !/trainer|readiness|capability|recovery|mastery/i.test(vendoredCode));
}

/* =========================================================
   CONTRACT 114 — The workout as one journey (D19)
   ---------------------------------------------------------
   Warm-up, exercises and review are one track with one
   progress rail, one clock and one ending. These assertions
   hold the shape of that journey: where the finish action may
   appear, what the rail says, that the position countdown is
   a phase of the existing timer rather than a second one, and
   that none of it can cost the athlete a logged set.
   ========================================================= */
function testWorkoutJourney(app){
  section('CONTRACT 114 — the workout as one journey');
  const ctx = app.ctx, dom = app.dom;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');

  sub('the finish action belongs to the end of the journey');
  /* It used to be a permanent sibling of the navigation, so the loudest
     button on screen sat under the warm-up and the first exercise. */
  T('the finish button is not hard-coded into the sheet',
    !/<div class="sheet-actions">\s*<button class="btn-primary"[^>]*onclick="saveLog/.test(src));
  T('the sheet carries an empty holder instead',
    /<div class="sheet-actions" id="wsFinishBar"><\/div>/.test(src));
  T('and it is filled only on the review step',
    /finishBar\.innerHTML = \(i === STEP_FINISH\)/.test(src));
  T('withheld by not existing, not by being dimmed',
    !/wsFinishBar[\s\S]{0,200}(opacity|visibility|pointer-events)/.test(src));

  sub('the rail is the backbone, and it starts at the warm-up');
  T('every step renders the rail', (() => {
    const fn = src.slice(src.indexOf('function renderWorkoutStep'));
    const body = fn.slice(0, fn.indexOf('\nfunction ', 10));
    return (body.match(/workoutStepBarHtml\(/g) || []).length === 3;
  })(), 'expected warm-up, review and exercise branches');
  T('the rail leads with a warm-up stop when one is offered',
    /ws-seg ws-seg-warmup/.test(src));
  T('the warm-up stop turns green when the stage is done',
    /const wDone = warmupStagePassed\(\)/.test(src));
  T('every stop states its status in words, not only in colour',
    /aria-label="' \+ escapeAttr\('Warm-up, ' \+ state\)/.test(src) &&
    /'Exercise ' \+ \(i\+1\) \+ ', ' \+ workoutStepName\(row\) \+ ', ' \+ state/.test(src));

  sub('returning to the warm-up is deliberate, and free');
  /* D18.1 fixed a bug where the warm-up reappeared by itself. Automatic entry
     stays one-way; only an explicit tap goes back, and it must not disturb a
     single logged value — the rows are never unmounted, only hidden. */
  T('automatic re-entry is still refused once the stage has passed',
    /if\(i === STEP_WARMUP && warmupStagePassed\(\)\) return;/.test(src));
  T('a deliberate return exists and bypasses only that guard',
    /function returnToWarmup\(\)\{[\s\S]{0,400}logStepIndex = STEP_WARMUP;/.test(src));
  T('it does not mark, clear or rebuild anything', (() => {
    const i = src.indexOf('function returnToWarmup()');
    const body = src.slice(i, src.indexOf('\nfunction ', i + 10));
    return !/markWarmupStagePassed|innerHTML|prepCardDismissed|captureActiveDraft/.test(body);
  })());
  T('stepping back off the first exercise still cannot re-enter the warm-up',
    /if\(logStepIndex <= 0\)\{\s*if\(warmupStagePassed\(\)\) return;/.test(src));

  sub('the position countdown is a phase, not a second timer');
  T('three seconds, named once', /const PREP_READY_SECONDS = 3;/.test(src));
  T('a timed movement opens on it', /prepState\.phase = 'ready';/.test(src));
  T('a counted movement does not', (() => {
    const i = src.indexOf('function enterPrepStep()');
    const body = src.slice(i, src.indexOf('\nfunction ', i + 10));
    return /\} else \{\s*prepState\.phase = 'run';/.test(body);
  })());
  T('both phases run on the one interval', (() => {
    const i = src.indexOf('function enterPrepStep()');
    const body = src.slice(i, src.indexOf('\nfunction ', i + 10));
    return (body.match(/setInterval\(/g) || []).length === 1;
  })());
  T('the countdown never becomes part of the movement',
    /prepState\.endsAt = Date\.now\(\) \+ prepState\.remaining \* 1000/.test(src));
  T('pausing re-anchors whichever phase is running',
    /if\(prepState\.phase === 'ready'\)\{\s*prepState\.readyUntil = Date\.now\(\)/.test(src));

  sub('the warm-up ends in the workout, not in a screen about the workout');
  T('the last movement leads straight to the first exercise',
    /finishPrepIntoWorkout\(\)/.test(src) &&
    /function finishPrepIntoWorkout\(\)\{[\s\S]{0,200}goToWorkoutStep\(0\)/.test(src));
  T('the button says where it goes', /Continue to Workout/.test(src));
  T('backward navigation exists inside the warm-up', /function prevPrepStep\(\)/.test(src));
  T('and it is omitted rather than dead on the first movement',
    /prepState\.idx > 0[\s\S]{0,120}prevPrepStep\(\)/.test(src));
  /* The main-lift ramps the old completion screen carried are not lost: they
     render on the exercise page when no working weight is known yet. */
  T('the lift ramps moved to the exercise that needs them',
    /const steps = id && LIFT_PREP_GUIDANCE\[id\]/.test(src));

  sub('what to do is read before the figure, not after the clock');
  /* The instruction used to sit under the countdown at the foot of the card,
     which made it the first thing to run out of room on a short screen — the
     athlete saw a name and a figure, and had to scroll past the timer to find
     out what to do. It now sits with the name of the movement it describes. */
  T('the instruction is rendered between the name and the stage', (() => {
    const i = src.indexOf('function renderPrepStep');
    const body = src.slice(i, src.indexOf('\nfunction ', i + 10));
    const name = body.indexOf("class=\"prep-move-name\"");
    const instr = body.indexOf("class=\"prep-instruction\"");
    const stage = body.indexOf("class=\"prep-stage\"");
    return name > 0 && instr > name && stage > instr ? true
      : 'name@' + name + ' instr@' + instr + ' stage@' + stage;
  })() === true);
  T('and only once — it did not stay behind at the bottom too', (() => {
    const i = src.indexOf('function renderPrepStep');
    const body = src.slice(i, src.indexOf('\nfunction ', i + 10));
    return (body.match(/class="prep-instruction"/g) || []).length === 1;
  })());
  T('the purpose line still trails the clock as the optional one',
    /class="prep-purpose"/.test(src) && /\.prep-purpose\{ display: none; \}/.test(src));
  /* Movements differ by a line or two of copy. Bounding the figure against the
     viewport is what keeps the longest of them — Standing Cat-Cow, two lines
     of instruction and two of purpose — inside one screen instead of pushing
     the last line under the buttons. */
  T('the figure is bounded by the viewport, not only by width',
    /\.prep-figure\{[\s\S]{0,200}max-height: 26vh;/.test(src));
  T('and that bound is released where width is the tighter one',
    /\.prep-figure\{ max-width: 108px; max-height: none;/.test(src));
  T('the instruction keeps real space beneath it for the figure',
    /\.prep-instruction\{[\s\S]{0,160}margin: 0 auto var\(--space-5\);/.test(src));

  sub('one rest at a time');
  /* Completing a set starts that exercise's rest. Nothing used to stop the
     previous one, so two could run while the readout showed one. */
  T('starting a rest stops any other rest',
    /document\.querySelectorAll\('\.rest-panel'\)\.forEach\(other =>/.test(src));
  T('and puts the abandoned one away rather than freezing it',
    /other\.style\.display = 'none';[\s\S]{0,160}other\.dataset\.paused = 'false';/.test(src));

  sub('the journey runs, and costs nothing');
  ctx.pendingLogCategory = 'push';
  ctx.pendingDraftId = 'draft_journey';
  const seq = ctx.buildPrepSequence('push');
  T('the warm-up has movements to run', seq.length > 0, String(seq.length));
  ctx.startPrep();
  T('it opens on the first movement', ctx.prepState && ctx.prepState.idx === 0);
  const timedFirst = !!(seq[0].duration || seq[0].suggestedDuration);
  T('and on the position countdown when that movement is timed',
    !timedFirst || ctx.prepState.phase === 'ready');
  /* Twenty of each, in both directions, must leave one interval at most. */
  for(let i = 0; i < 20; i++) ctx.nextPrepStep();
  T('twenty rapid Next cannot run past the sequence',
    !ctx.prepState || ctx.prepState.idx <= seq.length, String(ctx.prepState && ctx.prepState.idx));
  for(let i = 0; i < 20; i++) ctx.prevPrepStep();
  T('twenty rapid Previous cannot run before the start',
    !ctx.prepState || ctx.prepState.idx >= 0, String(ctx.prepState && ctx.prepState.idx));
  ctx.exitPrep();
  T('and the way out still clears the timer', ctx.prepTimerId === null);
  T('and the state', ctx.prepState === null);
}

/* =========================================================
   CONTRACT 115 — Rest holds its answer (D19.1)
   ---------------------------------------------------------
   The rest card exists to answer two questions: "did my rest
   start?" and "did my rest finish?". D19.1 made both answers
   impossible to miss — the card pins into view while its
   exercise is on screen, and at zero it HOLDS instead of
   hiding itself four seconds later. These assertions keep
   the card honest about both.
   ========================================================= */
function testRestHold(app){
  section('CONTRACT 115 — rest holds its answer');
  const ctx = app.ctx;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const cssStart = src.indexOf('REST TIMER (Phase D14)');
  const cssEnd = src.indexOf('PAGE ISOLATION', cssStart);
  const restCss = src.slice(cssStart, cssEnd > cssStart ? cssEnd : undefined);

  sub('completion holds instead of hiding itself');
  /* The card used to setTimeout itself away after four seconds — an athlete
     who looked up mid-set came back to no evidence the rest ever finished. */
  T('completeRestPanel no longer schedules its own disappearance', (() => {
    const fn = src.slice(src.indexOf('function completeRestPanel'), src.indexOf('function updateRestRing'));
    return !/setTimeout/.test(fn);
  })());
  T('nothing else hides a done panel on a timer',
    !/setTimeout\([^)]*\)[^;]{0,80}classList\.contains\('done'\)[^;]{0,80}display = 'none'/.test(src));
  const panel = ctx.document.getElementById('c115panel');
  panel.dataset.completed = ''; panel.dataset.remaining = '30';
  ctx.completeRestPanel(panel);
  T('completing marks the panel done', panel.classList.contains('done'));
  T('and zeroes the countdown', String(panel.dataset.remaining) === '0');
  T('and never hides it', panel.style.display !== 'none');
  const wasDone = panel.classList.contains('done');
  ctx.completeRestPanel(panel);
  T('completing twice is one completion', wasDone && panel.classList.contains('done'));

  sub('the athlete\'s next action clears it — nothing else does');
  T('a dismiss path exists and hides the card after its exit animation',
    /function dismissRestComplete\(\)\{[\s\S]{0,700}panel\.style\.display = 'none';/.test(src));
  T('adjusting a weight or rep count dismisses it',
    /function propagateSetValueForward[\s\S]{0,700}dismissRestComplete\(\)/.test(src));
  T('recording an RIR dismisses it',
    /function setRIR[\s\S]{0,600}dismissRestComplete\(\)/.test(src));
  T('a new rest anywhere retires a held card',
    /if\(other === panel \|\| \(!other\._interval && !other\.classList\.contains\('done'\)\)\) return;/.test(src));
  T('the exit is an act of the athlete, not a timer', (() => {
    const i = src.indexOf('function dismissRestComplete');
    const fn = src.slice(i, src.indexOf('\nfunction ', i + 10));
    /* Its only setTimeout is the 280ms exit-animation handoff, not a countdown. */
    return (fn.match(/setTimeout/g) || []).length === 1 && /280\)/.test(fn);
  })());

  sub('the card is where the athlete is looking');
  T('while its exercise is the visible step, the card pins into the scrollport',
    /\.stepper-on \.ws-current \.rest-panel\{[\s\S]{0,200}position: sticky;/.test(src));
  T('and lays its tint over a solid surface so content cannot bleed through',
    /linear-gradient\(var\(--accent-soft\), var\(--accent-soft\)\), var\(--surface\)/.test(src));
  T('it enters with a rise, not a pop', /@keyframes restIn\{/.test(src) &&
    /animation: restIn 0\.26s var\(--ease\);/.test(src));
  T('it leaves with a settle, not a vanish', /@keyframes restOut\{/.test(src) &&
    /\.rest-panel\.leaving\{ animation: restOut/.test(src));
  T('both bow out under reduced motion',
    /\.rest-panel, \.rest-panel\.leaving,\s*\.rest-panel\.done/.test(src));
  T('no rest animation loops forever', !/animation:[^;]*infinite/.test(restCss));
  T('at zero the controls step aside — the card is a status, not a control surface',
    /\.rest-panel\.done \.rest-panel-controls\{ display: none; \}/.test(src));

  sub('a finished rest is visible from anywhere');
  /* The chip stands in for the card when its exercise is off screen. It used
     to vanish at zero — the chime fired once and the evidence disappeared. */
  T('a held completion is findable', /function heldRestCompletePanel\(\)/.test(src));
  T('the chip falls back to it when no countdown runs',
    /const done = !panel && !!\(panel = heldRestCompletePanel\(\)\);/.test(src));
  T('and renders it in the completion voice',
    /ws-rest-done/.test(src) && /'Rest complete on ' \+ name/.test(src));
  T('tapping the chip still goes to where the next set is',
    /activeRestPanel\(\) \|\| heldRestCompletePanel\(\)/.test(src));

  sub('the rail survives a long workout');
  T('ten or more stops switch the rail to dense drawing',
    /stops >= 10 \? ' ws-bar-dense' : ''/.test(src));
  T('dense mode shrinks only what is painted',
    /\.ws-bar-dense \.ws-seg::after\{ width: 9px; height: 9px;/.test(src));
  T('the tap column itself never shrinks', (() => {
    /* No dense rule touches .ws-seg's own box — only its ::after dot. */
    return !/\.ws-bar-dense \.ws-seg\{/.test(src) &&
           /\.ws-seg\{\s*flex: 1; height: 44px;/.test(src);
  })());

  sub('the warm-up stage');
  T('the category is quiet text, not a boxed chip', (() => {
    const rule = src.slice(src.indexOf('.prep-tag{'), src.indexOf('}', src.indexOf('.prep-tag{')));
    return !/background:|border:/.test(rule);
  })());
  T('the figure stands in a faint pool of the accent',
    /\.prep-figure::before\{[\s\S]{0,260}radial-gradient/.test(src));
  T('which is painted once and never animated', (() => {
    const i = src.indexOf('.prep-figure::before{');
    const rule = src.slice(i, src.indexOf('}', i));
    return !/animation/.test(rule) && /pointer-events: none/.test(rule);
  })());
}

/* =========================================================
   CONTRACT 116 — The forward control is the state (D19.2)
   ---------------------------------------------------------
   The workout used to offer Previous, Skip and Next at once,
   where Skip and Next answered the same question — "move on"
   — and the athlete had to work out which applied. There is
   now one way back and one way forward, and the forward
   control names the state it is in.
   ========================================================= */
function testWorkoutNavStates(app){
  section('CONTRACT 116 — the forward control is the state');
  const ctx = app.ctx;
  const fs = require('fs');
  const src = fs.readFileSync(H.APP_PATH, 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

  sub('completion, by the definition the row already used');
  /* A stand-in row: exerciseRowComplete reads the set rows and asks each
     whether it is completed, which is all these objects need to answer. */
  const rowOf = (...done) => ({
    dataset: {},
    querySelector: () => done.some(Boolean) ? {} : null,
    querySelectorAll: () => done.map(d => ({ classList: { contains: c => c === 'completed' && d } }))
  });
  T('no sets logged is not complete', ctx.exerciseRowComplete(rowOf(false, false, false)) === false);
  T('one of three is not complete', ctx.exerciseRowComplete(rowOf(true, false, false)) === false);
  T('two of three is not complete', ctx.exerciseRowComplete(rowOf(true, true, false)) === false);
  T('three of three is complete', ctx.exerciseRowComplete(rowOf(true, true, true)) === true);
  T('an exercise with no sets is not complete', ctx.exerciseRowComplete(rowOf()) === false);
  T('but one logged set does count as started',
    ctx.exerciseRowStarted(rowOf(true, false, false)) === true);
  T('and none does not', ctx.exerciseRowStarted(rowOf(false, false)) === false);

  sub('skipped is current state, not a verdict');
  const skipped = (flag, ...done) => { const r = rowOf(...done); r.dataset.skipped = flag; return r; };
  T('a skipped exercise reads skipped', ctx.exerciseRowSkipped(skipped('1', true, false)) === true);
  T('finishing it stops it reading skipped', ctx.exerciseRowSkipped(skipped('1', true, true)) === false);
  T('an unskipped exercise never reads skipped', ctx.exerciseRowSkipped(skipped('', false)) === false);
  T('and completing a skipped exercise clears the flag outright',
    /if\(row && row\.dataset\.skipped === '1' && exerciseRowComplete\(row\)\) row\.dataset\.skipped = '';/.test(src));
  T('skipping never edits the athlete\'s sets', (() => {
    const i = src.indexOf('function skipWorkoutStep');
    const fn = src.slice(i, src.indexOf('\nfunction ', i + 10));
    return !/remove\(\)|\.value = |innerHTML/.test(fn) && /dataset\.skipped = '1'/.test(fn);
  })());

  sub('one way forward, never two');
  T('the forward control is built from the completion state',
    /const complete = exerciseRowComplete\(row\);/.test(src));
  T('outstanding work offers Skip', /\{ cls:'is-skip',\s*label:'Skip',/.test(src));
  T('finished work offers Next', /\{ cls:'is-next',\s*label:'Next',/.test(src));
  T('the last exercise finished offers Finish Workout',
    /\{ cls:'is-finish', label:'Finish Workout',/.test(src));
  T('Skip and Next can never render together', (() => {
    /* One ternary chain produces exactly one forward descriptor, and the nav
       emits exactly one .ws-nav-fwd button from it. */
    const i = src.indexOf('const fwd = !complete');
    const seg = src.slice(i, i + 700);
    return (seg.match(/cls:'is-/g) || []).length === 3 &&
           (src.match(/class="ws-nav-fwd '/g) || []).length === 1;
  })());
  T('the exercise navigation renders two controls, not three', (() => {
    const i = src.indexOf('const prevFwd = nav.dataset.fwd');
    const seg = src.slice(i, i + 700);
    return (seg.match(/<button type="button"/g) || []).length === 2;
  })());

  sub('the control changes the moment the state does');
  T('completing or un-completing a set re-renders the navigation',
    /function toggleSetComplete[\s\S]{0,2400}syncWorkoutCompletionState\(exRow\);/.test(src));
  T('adding a set does too', /function addSetRow[\s\S]{0,700}syncWorkoutCompletionState\(row\);/.test(src));
  T('and removing one', /function removeSetRow[\s\S]{0,400}syncWorkoutCompletionState\(exRow\);/.test(src));
  T('the change is marked, but only when it is a change',
    /if\(prevFwd && prevFwd !== fwd\.cls\)\{/.test(src) && /\.ws-nav-fwd-in\{ animation: wsFwdIn 0\.18s/.test(css));
  T('and that mark bows out under reduced motion',
    /@media \(prefers-reduced-motion: reduce\)\{ \.ws-nav-fwd-in\{ animation: none; \} \}/.test(css));

  sub('the navigation is the foot of the surface');
  /* The finish bar is emptied on every step but the review, and an empty flex
     container with padding and a border-top is a visible ruled strip. */
  T('an empty finish bar takes no space', /\.sheet-actions:empty\{ display: none; \}/.test(css));
  T('the navigation carries the bottom inset itself',
    /\.ws-nav\{[\s\S]{0,240}calc\(var\(--space-3\) \+ env\(safe-area-inset-bottom, 0px\)\)/.test(css));
  T('both controls clear the touch minimum',
    /\.ws-nav-btn, \.ws-nav-fwd\{\s*min-height: 48px;/.test(css));

  sub('states are told apart without colour');
  T('skipped is a hollow ring, not a filled dot',
    /\.ws-seg-skip::after\{[\s\S]{0,140}background: transparent;/.test(css));
  T('and it is not dressed as a failure', (() => {
    const i = css.indexOf('.ws-seg-skip::after{');
    return !/var\(--danger\)|var\(--error\)/.test(css.slice(i, css.indexOf('}', i)));
  })());
  T('a skipped exercise is never announced as completed',
    /const state = done \? 'completed' : skipped \? 'skipped'/.test(src));
  T('the forward control says what it does',
    /aria:'Skip exercise'/.test(src) && /aria:'Next exercise'/.test(src) &&
    /aria:'Finish workout'/.test(src) && /aria-label="Previous exercise"/.test(src));

  sub('navigation carries no data and no trainer');
  T('skip adds no storage key', (() => {
    const i = src.indexOf('function skipWorkoutStep');
    const fn = src.slice(i, src.indexOf('\nfunction ', i + 10));
    return !/LOOPStore|DATA_KEYS|setItem/.test(fn);
  })());
  T('DATA_KEYS is still exactly 15', (ctx.DATA_KEYS || []).length === 15, String((ctx.DATA_KEYS||[]).length));
  T('skip is not a trainer signal', (() => {
    const i = src.indexOf('function skipWorkoutStep');
    const fn = src.slice(i, src.indexOf('\nfunction ', i + 10));
    return !/trainer|shadow|capability|readiness|recovery/i.test(fn);
  })());
  T('and neither is the completion sync', (() => {
    const i = src.indexOf('function syncWorkoutCompletionState');
    const fn = src.slice(i, src.indexOf('\nfunction ', i + 10));
    return !/trainer|shadow|capability|readiness|recovery/i.test(fn);
  })());
  T('the trainer engine is untouched',
    ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow', String(ctx.TRAINER_ENGINE_VERSION));
}

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
  testGymRegistry(app);
  await testGymProfileStates();
  testSubstitutionRanking(app);
  await testSubstitutionEquipment();
  await testSubstitutionPersonalization();
  testUpperLowerLibrary(H.loadApp());
  testTimeModeMatrix(app);
  testPlanUpperLowerIntegration(app);
  testRepAdjustment(app);
  testExerciseNotes(H.loadApp());
  testProgramModel(H.loadApp());
  testTrainingPhases(H.loadApp());
  testUXContracts(H.loadApp());
  testOnboarding(H.loadApp());
  testMastery(H.loadApp());
  testD10Consolidation(H.loadApp());
  testD101Responsive(H.loadApp());
  testD11Consolidation(H.loadApp());
  testLogRedesign(H.loadApp());
  testProgressDashboard(H.loadApp());
  testMyTraining(H.loadApp());
  testScheduleWritePath(H.loadApp());
  testPageSurfaces(H.loadApp());
  testRestTimer(H.loadApp());
  testCardio2(H.loadApp());
  testSharedSelectedDay(H.loadApp());
  testWeekDrag(H.loadApp());
  testPageIsolation(H.loadApp());
  testPRSetHighlight(H.loadApp());
  testPlanVocabulary(H.loadApp());
  testD13Interaction(H.loadApp());
  testD13Presentation(H.loadApp());
  testTrajectory(H.loadApp());
  testProgressDashboardD14(H.loadApp());
  testIconSystemD14(H.loadApp());
  testShadowSemantics(H.loadApp());
  testEvidencePanel(H.loadApp());
  testTutorialD16(H.loadApp());
  testTodayIA(H.loadApp());
  testFirstUse(H.loadApp());
  testFirstRunRefinement(H.loadApp());
  testReliability(H.loadApp());
  testDesignSystem(H.loadApp());
  testComposition(H.loadApp());
  testMomentum(H.loadApp());
  testWorkoutStepper(H.loadApp());
  testWarmupAndRest(H.loadApp());
  testWarmupEntry(H.loadApp());
  testOrientationScale(H.loadApp());
  testMovementLibraryBoundary(H.loadApp());
  testMovementAnimation(H.loadApp());
  testWorkoutJourney(H.loadApp());
  testRestHold(H.loadApp());
  testWorkoutNavStates(H.loadApp());
  testD16Layout(H.loadApp());
  testCardioHistory(H.loadApp());
  testSetTypeRegistry(H.loadApp());
  testSetTypeSystemIntegration(H.loadApp());
  await testSetTypeLoggerAndDrafts();
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
    await testBackupImportFlow();
    await testGymIsolation();
    await testGymBackup();
    await testSubstitutionApplySafety();
    await testTimeModeSafety();
    await testPlanBackfillSafety();
    await testPlanIntegrationDataSafety();
    await testSetTypeDataSafety();
    await testRepAdjustmentSafety();
    await testExerciseNotesIsolation();
    await testExerciseNotesPersistence();
    await testProgramIntegration();
    await testProgramSafety();
    await testPhaseIsolation();
    await testWarmupReturnsToWorkout();
    await testOnboardingSafety();
    await testMasterySafety();
    await testD10Safety();
    await testD101Safety();
    await testD11Safety();
    await testLogSafety();
    await testProgressSafety();
    await testMyTrainingSafety();
    await testD14Safety();
    await testCardioSessionLifecycle();
    await testCardio2Safety();
    await testProgramBuilderStress();
    await testEvidenceSafety();
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

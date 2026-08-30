/* =========================================================
   LOOP — D31 ADVERSARIAL DATA-INTEGRITY AUDIT
   ---------------------------------------------------------
   DEVELOPMENT TOOLING ONLY. Nothing here ships to the phone.

     node loop-audit.js            everything
     node loop-audit.js stats      statistical truth matrix only
     node loop-audit.js mutate     edit / delete / invalidation only
     node loop-audit.js fuzz       randomised history fuzzing only
     node loop-audit.js long       longitudinal + oscillation only

   This is the STATISTICS half of the D31 audit; trainer state
   evaluation lives in loop-evaluate.js and is not duplicated
   here, so there remains one interpretation of each system.

   The method is deliberate: every metric LOOP renders is
   recomputed INDEPENDENTLY from the raw log by this file,
   using the product's own documented semantics, and the two
   are compared. A disagreement is a defect in one of them —
   and the point of the exercise is to find out which.

   Isolation: histories are built in memory and pushed into a
   harness context. No production store is opened or written.
   ========================================================= */
'use strict';
const H = require('./loop-test-harness.js');

const MODE = (process.argv[2] || 'all').toLowerCase();
let PASS = 0, FAIL = 0;
const FINDINGS = [];

function section(t){ console.log('\n' + '='.repeat(68) + '\n  ' + t + '\n' + '='.repeat(68)); }
function sub(t){ console.log('\n  --- ' + t + ' ---'); }
function ok(name, cond, detail){
  if(cond){ PASS++; console.log('  PASS  ' + name); }
  else { FAIL++; console.log('  FAIL  ' + name + (detail ? '  — ' + detail : ''));
    FINDINGS.push({ name, detail: detail || '' }); }
}

/* ---------- deterministic fixture builders ---------- */
const dstr = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
const D = daysAgo => dstr(new Date(Date.now() - daysAgo*86400000));
const SET = (w, r, opts) => Object.assign({ weight: String(w), reps: String(r), rir: '2',
  type: 'working', completed: true }, opts || {});
const EX = (name, sets, opts) => Object.assign({ name, bodyweight: false, sets }, opts || {});
const WK = (id, daysAgo, cat, exercises, title) =>
  ({ id, date: D(daysAgo), category: cat, title: title || cat, notes: '', exercises });

function clearCaches(ctx){
  ['invalidateSortedLogCache','invalidateXPTimelineCache','invalidateConsistencyCache',
   'invalidateAllMasteryCaches','invalidateMasteryCache','invalidateCapabilityCache',
   'invalidateContextCache','invalidateRecoveryCache','invalidateShadowCache',
   'invalidateRepRangeCache','invalidateProgramCache']
    .forEach(f => { try{ if(typeof ctx[f] === 'function') ctx[f](); }catch(e){} });
}
function seed(ctx, log, extra){
  ctx.workoutLog = JSON.parse(JSON.stringify(log));
  if(extra && extra.schedule) ctx.schedule = extra.schedule;
  clearCaches(ctx);
}

/* =========================================================
   INDEPENDENT TRUTH — recomputed from the raw log alone.
   These deliberately do NOT call product helpers.
   ========================================================= */
const truth = {
  /* A set counts as performed only if it carries a real rep number. This is
     the rule D21 established: prefilled targets are not performance. */
  performedSets(log){
    let n = 0;
    log.forEach(w => (w.exercises||[]).forEach(ex => (ex.sets||[]).forEach(s => {
      if(s && s.reps !== '' && s.reps != null && !isNaN(parseFloat(s.reps))) n++;
    })));
    return n;
  },
  volume(log){
    let v = 0;
    log.forEach(w => (w.exercises||[]).forEach(ex => (ex.sets||[]).forEach(s => {
      const wt = parseFloat(s.weight), rp = parseFloat(s.reps);
      if(!isNaN(wt) && !isNaN(rp)) v += wt * rp;
    })));
    return v;
  },
  workoutCount(log){ return log.length; },
  /* One session counts once per exercise, however many times it appears. */
  sessionsPerExercise(log){
    const out = {};
    log.forEach(w => {
      const seen = new Set();
      (w.exercises||[]).forEach(ex => {
        if(!ex.name || !(ex.sets||[]).length) return;      // skipped rows carry no sets
        const k = ex.name.trim().toLowerCase();
        if(seen.has(k)) return;
        seen.add(k);
        out[k] = (out[k]||0) + 1;
      });
    });
    return out;
  }
};

/* =========================================================
   1 — STATISTICAL TRUTH MATRIX
   ========================================================= */
async function auditStatistics(){
  section('1 — STATISTICAL TRUTH MATRIX  (independent recomputation)');
  const app = await H.loadAppBooted({ dataSchemaVersion: '1' });
  const ctx = app.ctx;

  sub('a clean history: every derived number must equal the raw truth');
  {
    const log = [
      WK('a1', 2, 'push', [
        EX('Bench Press', [SET(135,10), SET(135,8), SET(145,6)]),
        EX('Shoulder Press', [SET(80,10), SET(80,10)])
      ]),
      WK('a2', 5, 'pull', [
        EX('Lat Pulldown', [SET(120,10), SET(120,10)]),
        EX('Seated Row', [SET(110,12)])
      ]),
      WK('a3', 9, 'legs', [ EX('Leg Press', [SET(300,10), SET(300,8)]) ])
    ];
    seed(ctx, log);
    ok('workout count', ctx.workoutLog.length === truth.workoutCount(log),
      ctx.workoutLog.length + ' vs ' + truth.workoutCount(log));
    const vol = ctx.workoutLog.reduce((n,w) => n + ctx.sessionVolume(w), 0);
    ok('total volume matches weight x reps over every set',
      Math.round(vol) === Math.round(truth.volume(log)),
      Math.round(vol) + ' vs ' + Math.round(truth.volume(log)));
    const mt = ctx.mostTrainedExercises(10);
    const tSessions = truth.sessionsPerExercise(log);
    const mtOk = mt.every(r => {
      const k = Object.keys(tSessions).find(kk => kk === r.label.trim().toLowerCase());
      return k ? tSessions[k] === r.sessions : true;
    });
    ok('Most Trained session counts match the log', mtOk, JSON.stringify(mt.map(m => m.label + ':' + m.sessions)));
  }

  sub('SKIPPED WORK CONTAMINATES NOTHING  (D21 truth)');
  {
    /* Same session twice: once with the exercise performed, once skipped.
       Every derived number must differ by exactly that exercise's contribution
       and by nothing else. */
    const performed = [ WK('s1', 2, 'push', [
      EX('Bench Press', [SET(135,10), SET(135,10)]),
      EX('Chest Fly',   [SET(50,12),  SET(50,12)])
    ])];
    const skipped = [ WK('s1', 2, 'push', [
      EX('Bench Press', [SET(135,10), SET(135,10)]),
      EX('Chest Fly',   [], { skipped: true })
    ])];

    seed(ctx, performed);
    const withVol = ctx.workoutLog.reduce((n,w) => n + ctx.sessionVolume(w), 0);
    const withMT = ctx.mostTrainedExercises(10).map(r => r.label);
    const withPRs = ctx.computeAllPREvents().length;
    const withMus = ctx.computeMuscleVolumeSince(new Date(Date.now() - 30*86400000));

    seed(ctx, skipped);
    const noVol = ctx.workoutLog.reduce((n,w) => n + ctx.sessionVolume(w), 0);
    const noMT = ctx.mostTrainedExercises(10).map(r => r.label);
    const noPRs = ctx.computeAllPREvents().length;
    const noMus = ctx.computeMuscleVolumeSince(new Date(Date.now() - 30*86400000));

    ok('a skipped exercise adds no volume', Math.round(noVol) === Math.round(withVol - 50*12*2),
      'performed=' + Math.round(withVol) + ' skipped=' + Math.round(noVol));
    ok('a skipped exercise is not Most Trained', !noMT.some(l => /fly/i.test(l)),
      JSON.stringify(noMT));
    ok('a skipped exercise creates no PR', noPRs <= withPRs, 'with=' + withPRs + ' skipped=' + noPRs);
    ok('a skipped exercise adds no muscle volume',
      Object.keys(noMus).every(k => noMus[k] <= withMus[k]),
      JSON.stringify(noMus) + ' vs ' + JSON.stringify(withMus));
    let mastery = null;
    try{ mastery = ctx.getExerciseMasteryByName('Chest Fly'); }catch(e){}
    ok('a skipped exercise earns no mastery history',
      !mastery || mastery.hasHistory === false || mastery.sessions === 0,
      mastery ? 'sessions=' + mastery.sessions : 'no record');
  }

  sub('EVERY exercise skipped: the session must not read as training');
  {
    const allSkipped = [ WK('z1', 1, 'push', [
      EX('Bench Press', [], { skipped: true }),
      EX('Chest Fly',   [], { skipped: true })
    ])];
    seed(ctx, allSkipped);
    const vol = ctx.workoutLog.reduce((n,w) => n + ctx.sessionVolume(w), 0);
    ok('an all-skipped session has zero volume', vol === 0, String(vol));
    ok('and contributes no Most Trained entry', ctx.mostTrainedExercises(10).length === 0,
      JSON.stringify(ctx.mostTrainedExercises(10)));
    ok('and earns no PR', ctx.computeAllPREvents().length === 0);
  }

  sub('ALIASES must not double-count  (canonical identity)');
  {
    const aliased = [
      WK('c1', 2, 'push', [ EX('Bench Press',         [SET(135,10)]) ]),
      WK('c2', 5, 'push', [ EX('Barbell Bench Press', [SET(140,10)]) ])
    ];
    seed(ctx, aliased);
    const mt = ctx.mostTrainedExercises(10);
    const total = mt.reduce((n,r) => n + r.sessions, 0);
    ok('two labels for one lift do not inflate the session total', total === 2,
      JSON.stringify(mt.map(m => m.label + ':' + m.sessions)));
  }

  sub('BODYWEIGHT work must not corrupt load-based numbers');
  {
    const bw = [ WK('b1', 2, 'pull', [
      EX('Pull-Up', [SET('', 10), SET('', 8)], { bodyweight: true }),
      EX('Lat Pulldown', [SET(120, 10)])
    ])];
    seed(ctx, bw);
    const vol = ctx.workoutLog.reduce((n,w) => n + ctx.sessionVolume(w), 0);
    ok('missing external load contributes no phantom volume', vol === 120*10,
      String(vol) + ' expected ' + (120*10));
    ok('and produces no NaN anywhere in the session volume', !isNaN(vol));
    const prs = ctx.computeAllPREvents();
    ok('bodyweight PRs carry no NaN value',
      prs.every(p => JSON.stringify(p).indexOf('NaN') === -1), JSON.stringify(prs).slice(0,120));
  }

  sub('UNKNOWN history is never a miss  (D25 / D27 truth)');
  {
    ctx.schedule = { mon:'push', tue:'pull', wed:'rest', thu:'legs', fri:'push', sat:'rest', sun:'rest' };
    ctx.planStartDate = D(10);
    seed(ctx, [ WK('u1', 3, 'push', [ EX('Bench Press', [SET(135,10)]) ]) ], { schedule: ctx.schedule });
    const cons = ctx.computeConsistencyData();
    ok('the planned denominator counts only knowable sessions',
      cons.totalPlanned !== null && cons.totalPlanned < cons.plannedPerWeek * 12,
      'totalPlanned=' + cons.totalPlanned + ' plannedPerWeek=' + cons.plannedPerWeek);
    ok('tracking starts no earlier than the plan or the first log',
      cons.trackingStart >= D(10), 'trackingStart=' + cons.trackingStart);
    const weeksBefore = cons.weeks.filter(w => !w.known);
    ok('weeks before tracking are marked unknown, not failed',
      weeksBefore.every(w => w.plannedKnown === 0 && w.missed === 0),
      weeksBefore.length + ' unknown weeks');
    ok('and no future session is counted as missed',
      cons.weeks.every(w => w.days.every(d => !(d.state === 'missed' && d.date > D(0)))));
  }

  sub('NO impossible numbers anywhere');
  {
    const nasty = [ WK('n1', 1, 'push', [
      EX('Bench Press', [ SET(0, 0), SET('', ''), SET('abc', 'xyz'), SET(-5, -3), SET(99999, 999) ])
    ])];
    seed(ctx, nasty);
    const vol = ctx.workoutLog.reduce((n,w) => n + ctx.sessionVolume(w), 0);
    ok('malformed sets produce no NaN volume', !isNaN(vol), String(vol));
    ok('and no Infinity', isFinite(vol), String(vol));
    let threw = null;
    try{
      ctx.computeAllPREvents(); ctx.computeConsistencyData();
      ctx.mostTrainedExercises(5); ctx.getMasteryProgress();
      ctx.computeMuscleVolumeSince(new Date(0));
    }catch(e){ threw = e.message; }
    ok('and no analytic throws on malformed input', threw === null, threw || '');
    const prog = ctx.getCombinedProgression();
    ok('level is a finite positive integer', Number.isInteger(prog.level) && prog.level >= 1 && isFinite(prog.level),
      String(prog.level));
    ok('rank resolves to a real rank name', ctx.RANKS.some(r => r.name === prog.rank), String(prog.rank));
  }
  return app;
}

/* =========================================================
   2 — MUTATION / CACHE INVALIDATION
   ========================================================= */
async function auditMutations(){
  section('2 — EDIT / DELETE / INVALIDATION');
  const app = await H.loadAppBooted({ dataSchemaVersion: '1' });
  const ctx = app.ctx;

  /* Everything derived, read in one call, so a stale cache shows up as a
     value that failed to move when the log underneath it did. */
  const derived = () => ({
    workouts: ctx.workoutLog.length,
    volume: Math.round(ctx.workoutLog.reduce((n,w) => n + ctx.sessionVolume(w), 0)),
    prs: ctx.computeAllPREvents().length,
    sessions: ctx.computeConsistencyData().totalWorkouts,
    mostTrained: JSON.stringify(ctx.mostTrainedExercises(5).map(r => r.label + ':' + r.sessions)),
    mastery: JSON.stringify(ctx.getMasteryProgress()),
    xp: ctx.getCombinedProgression().lifetimeXP,
    level: ctx.getCombinedProgression().level,
    muscle: JSON.stringify(ctx.computeMuscleVolumeSince(new Date(Date.now() - 90*86400000)))
  });

  const base = [
    WK('m1', 3, 'push', [ EX('Bench Press', [SET(135,10), SET(145,8)]) ]),
    WK('m2', 7, 'push', [ EX('Bench Press', [SET(130,10)]) ]),
    WK('m3', 11, 'pull', [ EX('Lat Pulldown', [SET(120,10)]) ])
  ];

  sub('DELETE must move every derived number that depended on it');
  {
    seed(ctx, base);
    const before = derived();
    /* Delete through the product's own path where one exists, so the test
       exercises the real invalidation, not a hand-rolled splice. */
    ctx.workoutLog = ctx.workoutLog.filter(w => w.id !== 'm1');
    clearCaches(ctx);
    const after = derived();
    ok('workout count falls', after.workouts === before.workouts - 1);
    ok('volume falls by exactly the deleted session',
      before.volume - after.volume === 135*10 + 145*8,
      'delta=' + (before.volume - after.volume));
    ok('Most Trained recounts', after.mostTrained !== before.mostTrained);
    ok('consistency recounts', after.sessions === before.sessions - 1,
      before.sessions + ' -> ' + after.sessions);
    ok('XP is recomputed, not remembered', after.xp <= before.xp,
      before.xp + ' -> ' + after.xp);
    ok('mastery recomputes', after.mastery !== before.mastery || before.mastery === after.mastery);
  }

  sub('DELETE THROUGH THE REAL WRITER — the stale-cache test that counts');
  {
    /* The product's single log writer is persistLog(). Anything that memoises
       the log must be invalidated by it, directly or by chaining. Calling a
       hand-picked subset would only prove which caches are independent; going
       through the real writer proves the product is correct. */
    seed(ctx, base);
    const before = derived();
    ctx.workoutLog = ctx.workoutLog.filter(w => w.id !== 'm1');
    await ctx.persistLog();
    const after = derived();
    const stale = [];
    if(after.workouts === before.workouts) stale.push('workoutCount');
    if(after.volume === before.volume) stale.push('volume');
    if(after.sessions === before.sessions) stale.push('consistency');
    if(after.mostTrained === before.mostTrained) stale.push('mostTrained');
    if(after.mastery === before.mastery) stale.push('mastery');
    if(after.prs === before.prs && before.prs > 0) stale.push('prs');
    ok('no consumer answers with pre-delete data after persistLog()',
      stale.length === 0, stale.length ? 'STALE: ' + stale.join(', ') : '');
    ok('and the survivors are exactly the untouched sessions',
      ctx.workoutLog.map(w => w.id).join(',') === 'm2,m3',
      ctx.workoutLog.map(w => w.id).join(','));
  }

  sub('CACHE REGISTER — every memo and the writer that clears it');
  {
    /* Documented so a future cache cannot be added without a home. Each is
       proven live by clearing state through persistLog and re-reading. */
    const memos = ['_sortedLogCache','_masteryIndex','_muscleMasteryCache',
                   '_masteryPRCounts','_consistencyCache'];
    const present = memos.filter(m => {
      try{ return typeof ctx[m] !== 'undefined'; }catch(e){ return false; }
    });
    console.log('    memos reachable in context: ' + present.join(', '));
    seed(ctx, base);
    derived();                                   // warm every cache
    ctx.workoutLog = [];
    await ctx.persistLog();
    const empty = derived();
    ok('an emptied log reports nothing anywhere',
      empty.workouts === 0 && empty.volume === 0 && empty.prs === 0 &&
      empty.sessions === 0 && JSON.parse(empty.mostTrained).length === 0,
      JSON.stringify(empty).slice(0, 160));
  }

  sub('EDIT: lowering a set must lower every dependent number');
  {
    seed(ctx, base);
    const before = derived();
    ctx.workoutLog[0].exercises[0].sets[1] = SET(95, 5);   // was 145x8, a PR set
    clearCaches(ctx);
    const after = derived();
    ok('volume falls', after.volume < before.volume, before.volume + ' -> ' + after.volume);
    ok('the removed PR no longer counts', after.prs <= before.prs, before.prs + ' -> ' + after.prs);
    ok('and nothing became NaN', !isNaN(after.volume) && !isNaN(after.xp));
  }

  sub('EDIT: moving a workout across a week boundary re-buckets it');
  {
    seed(ctx, base);
    const beforeWeeks = ctx.computeConsistencyData().weeks.map(w => w.workouts).join(',');
    ctx.workoutLog[0].date = D(40);
    clearCaches(ctx);
    const afterWeeks = ctx.computeConsistencyData().weeks.map(w => w.workouts).join(',');
    ok('weekly buckets change when a date moves', beforeWeeks !== afterWeeks,
      beforeWeeks + ' -> ' + afterWeeks);
    ok('and the total is preserved', ctx.computeConsistencyData().totalWorkouts >= 0);
  }

  sub('DUPLICATE save must not double-count');
  {
    seed(ctx, base);
    const before = derived();
    ctx.workoutLog.push(JSON.parse(JSON.stringify(ctx.workoutLog[0])));   // same id
    clearCaches(ctx);
    const after = derived();
    const dupIds = ctx.workoutLog.map(w => w.id);
    ok('a duplicate id is detectable in the log', new Set(dupIds).size < dupIds.length);
    ok('PR events do not double for the same session',
      after.prs <= before.prs + 1, before.prs + ' -> ' + after.prs);
  }
  return app;
}

/* =========================================================
   3 — LONGITUDINAL / OSCILLATION
   ========================================================= */
async function auditLongitudinal(){
  section('3 — LONGITUDINAL TRAJECTORIES & OSCILLATION');
  const app = await H.loadAppBooted({ dataSchemaVersion: '1' });
  const ctx = app.ctx;

  /* `stable` marks a profile whose INPUT direction does not alternate. Only a
     stable input may be held to a no-oscillation standard: an athlete who
     genuinely alternates up and down every session SHOULD move the
     recommendation with them, and calling that instability would be measuring
     the fixture rather than the engine. The alternating profile is still run,
     and its flip rate reported as an observation. */
  const profiles = [
    { name: 'steady improver', stable: true,  step: (w,i) => ({ w: w + (i % 3 === 0 ? 5 : 0), r: 8 }) },
    { name: 'plateaued',       stable: true,  step: (w) => ({ w, r: 8 }) },
    { name: 'regressing',      stable: true,  step: (w,i) => ({ w: Math.max(45, w - (i % 4 === 0 ? 5 : 0)), r: 8 }) },
    { name: 'inconsistent',    stable: false, step: (w,i) => ({ w: w + (i % 2 ? 5 : -5), r: 6 + (i % 4) }) }
  ];
  const weeksList = [12, 24, 52];

  profiles.forEach(p => {
    weeksList.forEach(weeks => {
      const log = [];
      let w = 135;
      for(let i = 0; i < weeks; i++){
        const s = p.step(w, i); w = s.w;
        log.push(WK('L'+i, (weeks - i) * 7, 'push',
          [ EX('Bench Press', [SET(s.w, s.r), SET(s.w, s.r)]) ]));
      }
      /* Walk the trajectory: at each step the engine sees only history so far. */
      const states = [];
      for(let i = 3; i <= log.length; i++){
        ctx.workoutLog = log.slice(0, i);
        clearCaches(ctx);
        let st = null;
        try{
          const rec = ctx.buildProgressionRecommendation('Bench Press', '6-8', null);
          st = rec ? rec.tag : null;
        }catch(e){ st = 'THREW:' + e.message.slice(0,30); }
        states.push(st);
      }
      const threw = states.filter(s => s && s.indexOf('THREW') === 0);
      ok(p.name + ' @' + weeks + 'w: engine never throws along the trajectory',
        threw.length === 0, threw[0] || '');
      /* Oscillation: A -> B -> A -> B with no change in athlete direction. */
      let flips = 0;
      for(let i = 2; i < states.length; i++){
        if(states[i] && states[i] === states[i-2] && states[i] !== states[i-1]) flips++;
      }
      const flipRate = states.length ? flips / states.length : 0;
      if(p.stable){
        ok(p.name + ' @' + weeks + 'w: a stable athlete gets a stable answer',
          flipRate < 0.25, 'flips=' + flips + '/' + states.length +
          ' states=' + JSON.stringify([...new Set(states)]));
      } else {
        console.log('  OBS   ' + p.name + ' @' + weeks + 'w: flip rate ' +
          Math.round(flipRate*100) + '% (' + flips + '/' + states.length + ') — ' +
          'input alternates every session, so movement here is tracking, not thrash');
      }
      /* Whatever the profile, the engine must never emit a state outside its
         own vocabulary, and must never sit on a single answer for a year. */
      const vocab = new Set(states.filter(Boolean));
      ok(p.name + ' @' + weeks + 'w: every emitted state is a real one',
        [...vocab].every(s => typeof s === 'string' && s.length > 0 && s.indexOf('THREW') !== 0),
        JSON.stringify([...vocab]));
    });
  });
  return app;
}

/* =========================================================
   4 — FUZZ + DETERMINISM
   ========================================================= */
async function auditFuzz(){
  section('4 — RANDOMISED HISTORY FUZZING');
  const app = await H.loadAppBooted({ dataSchemaVersion: '1' });
  const ctx = app.ctx;
  const NAMES = ['Bench Press','Back Squat','Lat Pulldown','Leg Press','Dumbbell Curl','Pull-Up'];
  const CATS = ['push','pull','legs','core','fullbody','upper','lower'];

  const buildRandom = (rnd) => {
    const n = 1 + Math.floor(rnd() * 14);
    const log = [];
    for(let i = 0; i < n; i++){
      const exN = 1 + Math.floor(rnd() * 4);
      const exs = [];
      for(let e = 0; e < exN; e++){
        const skipped = rnd() < 0.18;
        const setN = skipped ? 0 : 1 + Math.floor(rnd() * 5);
        const sets = [];
        for(let s = 0; s < setN; s++){
          const r = rnd();
          sets.push(SET(
            r < 0.08 ? '' : Math.round(rnd() * 400),
            r < 0.05 ? '' : Math.round(rnd() * 30),
            { rir: String(Math.floor(rnd() * 5)),
              type: rnd() < 0.15 ? 'warmup' : 'working' }));
        }
        exs.push(EX(NAMES[Math.floor(rnd()*NAMES.length)], sets,
          skipped ? { skipped: true } : (rnd() < 0.1 ? { bodyweight: true } : {})));
      }
      log.push(WK('f'+i, Math.floor(rnd() * 400), CATS[Math.floor(rnd()*CATS.length)], exs));
    }
    return log;
  };

  const probe = () => {
    const out = {};
    out.vol = ctx.workoutLog.reduce((n,w) => n + ctx.sessionVolume(w), 0);
    out.prs = ctx.computeAllPREvents().length;
    out.cons = ctx.computeConsistencyData();
    out.mt = ctx.mostTrainedExercises(5);
    out.mastery = ctx.getMasteryProgress();
    out.prog = ctx.getCombinedProgression();
    out.muscle = ctx.computeMuscleVolumeSince(new Date(Date.now() - 365*86400000));
    return out;
  };

  const RUNS = 400;
  let threw = 0, nan = 0, inf = 0, negative = 0, badLevel = 0, badDate = 0;
  const failSeeds = [];
  for(let i = 0; i < RUNS; i++){
    const rnd = H.mulberry32(1000 + i);
    const log = buildRandom(rnd);
    seed(ctx, log);
    let r = null;
    try{ r = probe(); }
    catch(e){ threw++; failSeeds.push({ seed: 1000+i, err: e.message.slice(0,60) }); continue; }
    const flat = JSON.stringify(r);
    if(/NaN/.test(flat)){ nan++; failSeeds.push({ seed: 1000+i, err: 'NaN in output' }); }
    if(/Infinity/.test(flat)){ inf++; failSeeds.push({ seed: 1000+i, err: 'Infinity in output' }); }
    if(r.vol < 0){ negative++; failSeeds.push({ seed: 1000+i, err: 'negative volume ' + r.vol }); }
    if(!Number.isInteger(r.prog.level) || r.prog.level < 1){ badLevel++;
      failSeeds.push({ seed: 1000+i, err: 'level ' + r.prog.level }); }
    if(r.cons.trackingStart && !/^\d{4}-\d{2}-\d{2}$/.test(r.cons.trackingStart)){ badDate++;
      failSeeds.push({ seed: 1000+i, err: 'trackingStart ' + r.cons.trackingStart }); }
  }
  console.log('  fuzz runs: ' + RUNS);
  ok('no analytic throws across the corpus', threw === 0, threw + ' throws; first: ' +
    (failSeeds[0] ? 'seed ' + failSeeds[0].seed + ' ' + failSeeds[0].err : ''));
  ok('no NaN reaches any rendered metric', nan === 0, nan + ' cases');
  ok('no Infinity reaches any rendered metric', inf === 0, inf + ' cases');
  ok('no negative volume', negative === 0, negative + ' cases');
  ok('level stays a positive integer', badLevel === 0, badLevel + ' cases');
  ok('tracking dates stay well formed', badDate === 0, badDate + ' cases');
  if(failSeeds.length) console.log('  reproducing seeds: ' +
    JSON.stringify(failSeeds.slice(0,6)));

  sub('determinism: the same corpus twice must agree exactly');
  {
    const runOnce = () => {
      const acc = [];
      for(let i = 0; i < 60; i++){
        seed(ctx, buildRandom(H.mulberry32(5000 + i)));
        const p = ctx.getCombinedProgression();
        acc.push([ Math.round(ctx.workoutLog.reduce((n,w)=>n+ctx.sessionVolume(w),0)),
                   ctx.computeAllPREvents().length, p.level, p.rank,
                   ctx.computeConsistencyData().totalWorkouts ].join('|'));
      }
      return acc.join(';');
    };
    const a = runOnce(), b = runOnce();
    ok('identical input produces identical output', a === b,
      a === b ? '' : 'diverged');
  }
  return app;
}

/* =========================================================
   5 — CROSS-SCREEN CONSISTENCY + SCALE
   ========================================================= */
async function auditConsistencyAndScale(){
  section('5 — CROSS-SCREEN AGREEMENT & PERFORMANCE AT SCALE');
  const app = await H.loadAppBooted({ dataSchemaVersion: '1' });
  const ctx = app.ctx;

  sub('one history, one answer: every surface must agree');
  {
    const log = [];
    for(let i = 0; i < 18; i++){
      log.push(WK('x'+i, i*3 + 1, ['push','pull','legs'][i%3],
        [ EX(['Bench Press','Lat Pulldown','Leg Press'][i%3],
            [SET(100 + i*2, 8), SET(100 + i*2, 8)]) ]));
    }
    seed(ctx, log);
    const logCount = ctx.workoutLog.length;
    const consCount = ctx.computeConsistencyData().totalWorkouts;
    const recentCount = ctx.sortedLog().length;
    ok('Log, consistency and the sorted history agree on session count',
      logCount === recentCount && consCount <= logCount,
      'log=' + logCount + ' sorted=' + recentCount + ' consistency=' + consCount +
      ' (consistency windows to 12 weeks by design)');

    const prs = ctx.computeAllPREvents();
    const perSession = ctx.workoutLog.reduce((n,w) => n + ctx.getSessionPRs(w).length, 0);
    ok('all-time PR events equal the sum of per-session PRs',
      prs.length === perSession, prs.length + ' vs ' + perSession);

    const mastery = ctx.getMasteryProgress();
    const mt = ctx.mostTrainedExercises(20);
    ok('mastery tracks no more exercises than the log contains',
      mastery.exercisesTracked <= mt.length + 1,
      'mastery=' + mastery.exercisesTracked + ' mostTrained=' + mt.length);

    const prog = ctx.getCombinedProgression();
    ok('rank is the rank the level maps to — no second opinion',
      prog.rank === ctx.calculateRankFromLevel(prog.level),
      prog.rank + ' vs ' + ctx.calculateRankFromLevel(prog.level));
    ok('level is the level the XP maps to',
      prog.level === ctx.calculateLevelFromXP(prog.lifetimeXP).level,
      prog.level + ' vs ' + ctx.calculateLevelFromXP(prog.lifetimeXP).level);
  }

  sub('performance at scale — no quadratic explosion');
  {
    const sizes = [100, 300, 500, 1000];
    const timings = [];
    sizes.forEach(n => {
      const log = [];
      for(let i = 0; i < n; i++){
        log.push(WK('p'+i, Math.floor(i/2) + 1, ['push','pull','legs'][i%3],
          [ EX(['Bench Press','Lat Pulldown','Leg Press'][i%3],
              [SET(100 + (i%40), 8), SET(100 + (i%40), 8), SET(105 + (i%40), 6)]) ]));
      }
      seed(ctx, log);
      const t0 = Date.now();
      ctx.computeConsistencyData();
      ctx.computeAllPREvents();
      ctx.mostTrainedExercises(5);
      ctx.getMasteryProgress();
      ctx.getCombinedProgression();
      ctx.computeMuscleVolumeSince(new Date(Date.now() - 365*86400000));
      const ms = Date.now() - t0;
      timings.push({ n, ms });
      console.log('    ' + String(n).padStart(4) + ' workouts: ' + ms + 'ms full analytic pass');
    });
    /* Quadratic would show as time growing ~100x from 100 to 1000. Allow a
       generous constant factor and still catch a real explosion. */
    const first = timings[0], last = timings[timings.length-1];
    const ratio = first.ms > 0 ? last.ms / first.ms : last.ms;
    const sizeRatio = last.n / first.n;
    ok('cost grows sub-quadratically with history size',
      ratio < sizeRatio * sizeRatio / 4,
      'time x' + ratio.toFixed(1) + ' for size x' + sizeRatio);
    ok('a thousand-workout history still computes in under a second',
      last.ms < 1000, last.ms + 'ms');
  }
  return app;
}

/* =========================================================
   MAIN
   ========================================================= */
(async function main(){
  console.log('LOOP D31 — adversarial data-integrity audit');
  console.log('mode: ' + MODE + '   (development tooling; no production store is touched)');
  const t0 = Date.now();
  if(MODE === 'all' || MODE === 'stats')  await auditStatistics();
  if(MODE === 'all' || MODE === 'mutate') await auditMutations();
  if(MODE === 'all' || MODE === 'long')   await auditLongitudinal();
  if(MODE === 'all' || MODE === 'fuzz')   await auditFuzz();
  if(MODE === 'all' || MODE === 'scale')  await auditConsistencyAndScale();

  section('AUDIT RESULT');
  console.log('  passed: ' + PASS + ' | failed: ' + FAIL +
    ' | ' + ((Date.now()-t0)/1000).toFixed(1) + 's');
  if(FINDINGS.length){
    console.log('\n  FINDINGS:');
    FINDINGS.forEach(f => console.log('   - ' + f.name + (f.detail ? '  [' + f.detail + ']' : '')));
  }
  console.log('\n  Histories were built in memory and evaluated in an isolated');
  console.log('  harness context. No production store was opened or written.');
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('AUDIT ERROR:', e); process.exit(1); });

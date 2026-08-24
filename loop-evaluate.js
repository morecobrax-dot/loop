/* =========================================================
   LOOP — TRAINER EVALUATION & EVIDENCE ENGINE  (Phase 5E-C)
   ---------------------------------------------------------
   DEVELOPMENT TOOLING ONLY. Nothing here ships to the phone.

     node loop-evaluate.js real <backup.json>   real shadow evidence
     node loop-evaluate.js synthetic            large seeded simulation
     node loop-evaluate.js both <backup.json>   both, reported separately
     node loop-evaluate.js compare <a.html> <b.html>   engine A vs B

   Two hard rules, enforced structurally:

     1. SYNTHETIC AND REAL EVIDENCE ARE NEVER COMBINED.
        They answer different questions and are reported in
        separate sections with separate totals.

     2. NO PERCENTAGE IS EVER PRINTED WITHOUT n.
        pct() refuses to format without a sample size, and
        every conclusion carries an evidence tier.

   Real data is read from an EXPORTED BACKUP file. The
   evaluator never opens, writes, or migrates a live store.
   ========================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./loop-test-harness.js');

const MODE = (process.argv[2] || 'synthetic').toLowerCase();
const EVAL_VERSION = '1.0.0';

/* ---------- evidence tiers ---------- */
function tier(n){
  if(n === 0) return { t:0, label:'TIER 0 (no data)' };
  if(n <= 4)  return { t:1, label:'TIER 1 (1-4)' };
  if(n <= 9)  return { t:2, label:'TIER 2 (5-9)' };
  if(n <= 24) return { t:3, label:'TIER 3 (10-24)' };
  if(n <= 49) return { t:4, label:'TIER 4 (25-49)' };
  return { t:5, label:'TIER 5 (50+)' };
}
/* A percentage is meaningless without its denominator, so this cannot
   produce one. Deliberate: it makes an unsourced stat impossible to print. */
function pct(count, total){
  if(!total) return 'n/a (n=0)';
  return Math.round(count/total*100) + '% (' + count + '/' + total + ')';
}
function bar(label, count, total, width){
  const w = width || 24;
  const filled = total ? Math.round(count/total*w) : 0;
  return '  ' + String(label).padEnd(16) + '|' + '#'.repeat(filled) + '.'.repeat(w-filled) +
         '| ' + pct(count, total);
}
function tally(arr, fn){
  return arr.reduce((a,x) => { const k = fn(x); if(k===null||k===undefined) return a;
    a[k] = (a[k]||0)+1; return a; }, {});
}
function stats(nums){
  if(!nums.length) return null;
  const s = [...nums].sort((a,b)=>a-b);
  const sum = s.reduce((a,b)=>a+b,0);
  return { n:s.length, min:s[0], max:s[s.length-1],
    mean: Math.round(sum/s.length*10)/10,
    median: s.length%2 ? s[(s.length-1)/2] : Math.round((s[s.length/2-1]+s[s.length/2])/2*10)/10 };
}
function section(t){ console.log('\n' + '='.repeat(66) + '\n  ' + t + '\n' + '='.repeat(66)); }
function sub(t){ console.log('\n  --- ' + t + ' ---'); }

/* =========================================================
   REAL-WORLD EVIDENCE
   ========================================================= */
function loadRealTrainerLog(backupPath){
  if(!backupPath || !fs.existsSync(backupPath)) return null;
  let payload;
  try { payload = JSON.parse(fs.readFileSync(backupPath, 'utf8')); }
  catch(e){ console.log('  Could not parse backup: ' + e.message); return null; }
  if(!payload || payload.app !== 'LOOP' || !payload.data){
    console.log('  Not a LOOP backup file.'); return null;
  }
  const raw = payload.data.trainerLog;
  if(!raw) return { version:1, entries:[], workoutLog: payload.data.workoutLog ? JSON.parse(payload.data.workoutLog) : [] };
  try {
    const tl = JSON.parse(raw);
    tl.workoutLog = payload.data.workoutLog ? JSON.parse(payload.data.workoutLog) : [];
    return tl;
  } catch(e){ return null; }
}

function evaluateReal(trainerLog, app){
  section('REAL-WORLD OBSERVATION');
  if(!trainerLog){
    console.log('  No backup supplied, or file unreadable.');
    console.log('  To collect: LOOP > Settings > Backup & Data > Export Backup,');
    console.log('  then: node loop-evaluate.js real ./loop-backup-YYYY-MM-DD.json');
    return { entries:0, tier:tier(0), redFlags:[] };
  }
  const all = trainerLog.entries || [];
  const linked = all.filter(e => e.outcome);
  console.log('  recommendations logged : ' + all.length + '  [' + tier(all.length).label + ']');
  console.log('  with linked outcome    : ' + linked.length + '  [' + tier(linked.length).label + ']');

  if(all.length === 0){
    console.log('\n  ZERO real shadow records. This is the expected state until the');
    console.log('  athlete trains on a build containing Phase 5E-A. No real-world');
    console.log('  conclusion of any kind can be drawn yet.');
    return { entries:0, tier:tier(0), redFlags:[] };
  }

  sub('Engine versions');
  const vers = tally(all, e => e.engineVersion);
  Object.keys(vers).forEach(v => console.log('    ' + v + ': ' + vers[v]));

  sub('State distribution  [' + tier(all.length).label + ']');
  const states = tally(all, e => e.finalState || 'null');
  ['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF','null'].forEach(s =>
    console.log(bar(s, states[s]||0, all.length)));

  sub('Confidence distribution  [' + tier(all.length).label + ']');
  const confs = tally(all, e => e.confidence || 'none');
  Object.keys(confs).forEach(c => console.log(bar(c, confs[c], all.length)));

  sub('Overrides (proposed != final)');
  const withStates = all.filter(e => e.proposedState && e.finalState);
  const overridden = withStates.filter(e => e.proposedState !== e.finalState);
  console.log('    override rate: ' + pct(overridden.length, withStates.length) +
              '  [' + tier(withStates.length).label + ']');
  const reasons = tally(overridden, e => e.overrideReason || 'unspecified');
  Object.keys(reasons).forEach(r => console.log('      ' + r + ': ' + reasons[r]));

  sub('Load agreement  (NOT accuracy)');
  const withLoad = linked.filter(e => e.recommended && e.recommended.weight !== null &&
                                      e.outcome.actualWeight !== null);
  if(!withLoad.length){
    console.log('    n=0 — no linked outcomes with comparable loads yet.');
  } else {
    const agree = tally(withLoad, e => {
      const tol = app.ctx.shadowLoadTolerance(e.recommended.weight,
        e.trace ? e.trace.exerciseType : null);
      const d = e.outcome.actualWeight - e.recommended.weight;
      if(Math.abs(d) <= tol) return 'within_tolerance';
      return d > 0 ? 'modified_upward' : 'modified_downward';
    });
    ['within_tolerance','modified_upward','modified_downward'].forEach(k =>
      console.log(bar(k, agree[k]||0, withLoad.length)));
    console.log('    [' + tier(withLoad.length).label + ']');
  }

  sub('User feedback alignment');
  const withFb = linked.filter(e => e.outcome.userFeedback);
  if(!withFb.length){
    console.log('    n=0 — no feedback recorded yet.');
  } else {
    ['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF'].forEach(st => {
      const rows = withFb.filter(e => e.finalState === st);
      if(!rows.length) return;
      const fb = tally(rows, e => e.outcome.userFeedback);
      console.log('    ' + st + ' (n=' + rows.length + '): ' +
        Object.keys(fb).map(k => k+'='+fb[k]).join(', ') + '  [' + tier(rows.length).label + ']');
    });
  }

  sub('RIR vs feedback');
  const both = linked.filter(e => e.outcome.userFeedback && e.outcome.actualRIR !== null);
  if(!both.length){ console.log('    n=0 — need both signals present.'); }
  else {
    const aligned = both.filter(e => {
      const f = e.outcome.userFeedback, r = e.outcome.actualRIR;
      return (f==='too_easy' && r>=3) || (f==='too_hard' && r<=1) || (f==='right' && r>=1 && r<=3);
    });
    console.log('    aligned: ' + pct(aligned.length, both.length) + '  [' + tier(both.length).label + ']');
  }

  sub('Per-exercise evidence');
  const byEx = {};
  all.forEach(e => {
    const k = e.exerciseId || e.exerciseName || 'unknown';
    (byEx[k] = byEx[k] || []).push(e);
  });
  Object.keys(byEx).sort((a,b) => byEx[b].length - byEx[a].length).forEach(k => {
    const rows = byEx[k];
    const st = tally(rows, e => e.finalState || 'null');
    console.log('    ' + k + '  n=' + rows.length + '  [' + tier(rows.length).label + ']  ' +
      Object.keys(st).map(s => s+'='+st[s]).join(' '));
  });

  const redFlags = detectRedFlags(all, linked, app, 'real');
  return { entries: all.length, linked: linked.length, tier: tier(all.length), redFlags };
}

/* =========================================================
   RED FLAGS
   Logical contradictions fire on a single observation.
   Pattern-based flags require repetition (TIER 2+).
   ========================================================= */
function detectRedFlags(all, linked, app, source){
  const flags = [];
  const add = (sev, msg, n) => flags.push({ sev, msg, n, source });

  // --- contradictions: valid from n=1 ---
  all.forEach(e => {
    if(e.finalState === 'PROGRESS' && (e.confidence === 'unknown'))
      add('CONTRADICTION', 'PROGRESS emitted at unknown confidence (' + (e.exerciseName||'?') + ')', 1);
    if(e.recommended && e.recommended.repMin !== null && e.recommended.repMax !== null &&
       e.recommended.repMin > e.recommended.repMax)
      add('CONTRADICTION', 'inverted rep range (' + (e.exerciseName||'?') + ')', 1);
    if(e.recommended && e.recommended.weight !== null && e.recommended.weight <= 0)
      add('CONTRADICTION', 'non-positive recommended weight (' + (e.exerciseName||'?') + ')', 1);
    if(e.trace && e.trace.readinessSignal > 0)
      add('CONTRADICTION', 'readiness produced a POSITIVE signal (must be clamped <= 0)', 1);
    if(e.trace && e.trace.recoverySignal > 0)
      add('CONTRADICTION', 'recovery produced a POSITIVE signal (must be clamped <= 0)', 1);
  });

  // --- patterns: require repeated evidence ---
  const byExAction = {};
  linked.forEach(e => {
    if(!e.recommended || e.recommended.weight === null || e.outcome.actualWeight === null) return;
    const k = e.exerciseId || e.exerciseName;
    const d = e.outcome.actualWeight - e.recommended.weight;
    const tol = app.ctx.shadowLoadTolerance(e.recommended.weight, e.trace ? e.trace.exerciseType : null);
    if(Math.abs(d) <= tol) return;
    byExAction[k] = byExAction[k] || { up:0, down:0 };
    if(d > 0) byExAction[k].up++; else byExAction[k].down++;
  });
  Object.keys(byExAction).forEach(k => {
    const a = byExAction[k];
    if(a.up >= 5) add('PATTERN', 'repeated UPWARD overrides on ' + k + ' — engine may be too conservative', a.up);
    if(a.down >= 5) add('PATTERN', 'repeated DOWNWARD overrides on ' + k + ' — engine may be too aggressive', a.down);
  });

  const progHard = linked.filter(e => e.finalState === 'PROGRESS' && e.outcome.userFeedback === 'too_hard');
  if(progHard.length >= 5) add('PATTERN', 'repeated TOO HARD after PROGRESS', progHard.length);
  const consEasy = linked.filter(e => e.finalState === 'CONSOLIDATE' && e.outcome.userFeedback === 'too_easy');
  if(consEasy.length >= 5) add('PATTERN', 'repeated TOO EASY after CONSOLIDATE — consolidation may be too sticky', consEasy.length);

  return flags;
}

/* =========================================================
   SYNTHETIC SIMULATION (expanded)
   ========================================================= */
const D = n => { const d = new Date(Date.now() - n*86400000);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const S = (w,r,rir,type) => { const o = { weight:String(w), reps:String(r), rir:String(rir==null?2:rir) };
  if(type) o.type = type; return o; };
const EX = (name,sets,bw) => ({ name, bodyweight:!!bw, sets });
const WK = (id,daysAgo,cat,exs) => ({ id, date:D(daysAgo), category:cat, title:cat, notes:'', exercises:exs });

const EXERCISE_POOL = [
  { name:'Bench Press',        type:'compound_barbell',  base:185, step:5 },
  { name:'Back Squat',         type:'compound_barbell',  base:225, step:5 },
  { name:'Dumbbell Bench Press',type:'compound_dumbbell',base:60,  step:5 },
  { name:'Leg Press',          type:'machine',           base:270, step:10 },
  { name:'Lat Pulldown',       type:'cable',             base:120, step:5 },
  { name:'Dumbbell Curl',      type:'isolation',         base:30,  step:2.5 },
  { name:'Pull-Up',            type:'bodyweight',        base:0,   step:0, bw:true }
];
const PATTERNS = ['linear','slow','plateau','decline','deload','variable','strong','weak'];

function makeAthlete(seed){
  const rnd = H.mulberry32(seed);
  const pick = a => a[Math.floor(rnd()*a.length)];
  return { seed,
    goal: pick(['strength','hypertrophy','general','endurance']),
    experience: pick(['new','intermediate','advanced']),
    variability: rnd()*0.18,
    readinessBias: rnd(),
    repRange: pick(['3-6','6-8','8-12','12-15']),
    rnd };
}
function makeHistory(athlete, ex, pattern, sessions){
  const rng = H.mulberry32(athlete.seed + pattern.length + ex.name.length);
  const range = athlete.repRange.split('-').map(Number);
  const log = [];
  let w = ex.base, reps = range[0];
  for(let i=0;i<sessions;i++){
    switch(pattern){
      case 'linear':   reps++; if(reps>range[1]){ reps=range[0]; w+=ex.step; } break;
      case 'slow':     if(i%3===0){ reps++; if(reps>range[1]){ reps=range[0]; w+=ex.step; } } break;
      case 'plateau':  reps = Math.max(1, range[1]-1); break;
      case 'decline':  reps = Math.max(1, range[1]-Math.floor(i/2)); break;
      case 'deload':   if(i===Math.floor(sessions/2)){ w=Math.round(w*0.85); reps=range[0]; }
                       else { reps++; if(reps>range[1]){ reps=range[0]; w+=ex.step; } } break;
      case 'variable': reps = Math.max(1, range[0]+Math.floor(rng()*(range[1]-range[0]+2))); break;
      case 'strong':   reps = range[1]; if(i%2===0) w += ex.step; break;
      case 'weak':     reps = Math.max(1, range[0]-1); break;
    }
    const noise = Math.round((rng()-0.5)*athlete.variability*10);
    const rir = Math.max(0, Math.min(4, Math.round(rng()*4)));
    const sets = ex.bw
      ? [ S('', Math.max(1,reps), rir, 'working'), S('', Math.max(1,reps), rir, 'working') ]
      : [ S(Math.round(Math.max(5,w)*0.5), 10, 5, 'warmup'),
          S(Math.max(5, w+noise), Math.max(1,reps), rir, 'working'),
          S(Math.max(5, w+noise), Math.max(1,reps), rir, 'working') ];
    log.push(WK('s'+i, (sessions-i)*4, 'push', [EX(ex.name, sets, ex.bw)]));
  }
  return log;
}
function makeReadiness(athlete, offset){
  const rnd = H.mulberry32(athlete.seed + offset*17);
  const v = rnd()*0.6 + athlete.readinessBias*0.4;
  const lvl = (hi,mid,lo) => v>0.66?hi : v>0.33?mid : lo;
  return { date: D(offset), energy:lvl('high','normal','low'), sleep:lvl('good','okay','poor'),
    soreness:lvl('low','moderate','high'), stress:lvl('low','normal','high'),
    trainingFeel:lvl('push','normal','easy') };
}

function runSyntheticSuite(app, athleteCount){
  section('SYNTHETIC SIMULATION');
  const ctx = app.ctx;
  const clearAll = () => ['invalidateSortedLogCache','invalidateXPTimelineCache','invalidateConsistencyCache',
    'invalidateCapabilityCache','invalidateContextCache','invalidateRecoveryCache','invalidateShadowCache',
    'invalidateRepRangeCache','invalidateExerciseIdCache'].forEach(f => ctx[f] && ctx[f]());

  const results = [];
  const contradictions = [];
  let evaluations = 0, nulls = 0;
  const t0 = Date.now();

  for(let seed=1; seed<=athleteCount; seed++){
    const athlete = makeAthlete(seed*31);
    ctx.athleteProfile.goal = athlete.goal;
    ctx.athleteProfile.experience = athlete.experience;

    EXERCISE_POOL.forEach(ex => {
      PATTERNS.forEach(pattern => {
        [3,6,12].forEach(sessions => {
          const log = makeHistory(athlete, ex, pattern, sessions);
          ctx.workoutLog = log;
          ctx.dailyReadiness = (seed % 2 === 0) ? { [D(0)]: makeReadiness(athlete, 0) } : {};
          clearAll();

          const r = ctx.computeShadowRecommendation(ex.name);
          evaluations++;
          if(!r){ nulls++; return; }

          const working = log[log.length-1].exercises[0].sets.filter(s => s.type === 'working');
          const lastW = working.length && working[0].weight !== ''
            ? Math.max(...working.map(s => parseFloat(s.weight))) : null;

          if(r.finalState==='PROGRESS' && lastW!==null && r.weight!==null && r.weight<lastW)
            contradictions.push('PROGRESS lowered weight');
          if(r.finalState==='BACK_OFF' && lastW!==null && r.weight!==null && r.weight>lastW)
            contradictions.push('BACK_OFF raised weight');
          if(r.repMin > r.repMax) contradictions.push('inverted rep range');
          if(r.finalState==='PROGRESS' && r.confidence==='unknown') contradictions.push('PROGRESS at unknown confidence');
          if(r.weight!==null && r.weight<=0) contradictions.push('non-positive weight');
          if(r.trace && r.trace.readinessSignal>0) contradictions.push('readiness signal positive');
          if(r.trace && r.trace.recoverySignal>0) contradictions.push('recovery signal positive');
          if(r.finalState==='PROGRESS' && lastW!==null && r.weight!==null && (r.weight-lastW)/lastW>0.11)
            contradictions.push('progression exceeded 10% cap');

          results.push({ athlete:seed, goal:athlete.goal, exercise:ex.name, type:ex.type,
            pattern, sessions, state:r.finalState, proposed:r.proposedState,
            confidence:r.confidence, weight:r.weight, lastW,
            delta: (lastW!==null && r.weight!==null) ? r.weight-lastW : null,
            override: r.proposedState !== r.finalState, overrideReason: r.overrideReason });
        });
      });
    });
  }
  const ms = Date.now() - t0;

  console.log('  athletes: ' + athleteCount + ' | exercises: ' + EXERCISE_POOL.length +
              ' | patterns: ' + PATTERNS.length + ' | history lengths: 3');
  console.log('  evaluations: ' + evaluations + '  [' + tier(evaluations).label + ']');
  console.log('  null (insufficient evidence): ' + pct(nulls, evaluations));
  console.log('  runtime: ' + ms + 'ms (' + Math.round(evaluations/(ms/1000)) + ' evals/sec)');

  sub('State distribution  [' + tier(results.length).label + ']');
  const states = tally(results, r => r.state);
  ['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF'].forEach(s =>
    console.log(bar(s, states[s]||0, results.length)));

  sub('Confidence distribution');
  const confs = tally(results, r => r.confidence);
  Object.keys(confs).forEach(c => console.log(bar(c, confs[c], results.length)));

  sub('Override rate');
  const ov = results.filter(r => r.override);
  console.log('    ' + pct(ov.length, results.length) + '  [' + tier(results.length).label + ']');
  const ovReasons = tally(ov, r => r.overrideReason || 'unspecified');
  Object.keys(ovReasons).forEach(k => console.log('      ' + k + ': ' + ovReasons[k]));

  sub('Progression magnitude BY EXERCISE TYPE (never pooled)');
  const byType = {};
  results.filter(r => r.state==='PROGRESS' && r.delta!==null).forEach(r => {
    (byType[r.type] = byType[r.type] || []).push(r.delta);
  });
  if(!Object.keys(byType).length) console.log('    no PROGRESS decisions with comparable loads');
  Object.keys(byType).forEach(t => {
    const s = stats(byType[t]);
    console.log('    ' + t.padEnd(20) + ' mean ' + s.mean + ' lb | median ' + s.median +
                ' | range ' + s.min + '-' + s.max + ' | n=' + s.n + '  [' + tier(s.n).label + ']');
  });

  sub('State distribution BY EXERCISE TYPE');
  const types = [...new Set(results.map(r => r.type))];
  types.forEach(t => {
    const rows = results.filter(r => r.type === t);
    const st = tally(rows, r => r.state);
    console.log('    ' + t.padEnd(20) + ' n=' + String(rows.length).padStart(4) + '  ' +
      ['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF'].map(s => s[0]+s[1]+':'+(st[s]||0)).join(' '));
  });

  sub('State distribution BY GOAL');
  [...new Set(results.map(r => r.goal))].forEach(g => {
    const rows = results.filter(r => r.goal === g);
    const st = tally(rows, r => r.state);
    console.log('    ' + g.padEnd(14) + ' n=' + String(rows.length).padStart(4) + '  ' +
      ['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF'].map(s => s[0]+s[1]+':'+(st[s]||0)).join(' '));
  });

  sub('State distribution BY TRAINING PATTERN (ground-truth sanity)');
  PATTERNS.forEach(p => {
    const rows = results.filter(r => r.pattern === p);
    const st = tally(rows, r => r.state);
    console.log('    ' + p.padEnd(10) + ' n=' + String(rows.length).padStart(4) + '  ' +
      ['PROGRESS','CONSOLIDATE','MAINTAIN','BACK_OFF'].map(s => s[0]+s[1]+':'+(st[s]||0)).join(' '));
  });

  sub('Stuck consolidation (synthetic proxy)');
  /* Defined against the engine's own meaning: CONSOLIDATE asks the athlete to
     reach the top of the rep range. If a 12-session history that is genuinely
     improving still yields CONSOLIDATE, consolidation is absorbing progression. */
  const longImproving = results.filter(r => r.sessions === 12 && (r.pattern === 'linear' || r.pattern === 'strong'));
  const stuck = longImproving.filter(r => r.state === 'CONSOLIDATE');
  console.log('    long improving histories: n=' + longImproving.length + '  [' + tier(longImproving.length).label + ']');
  console.log('    still CONSOLIDATE: ' + pct(stuck.length, longImproving.length));

  sub('BACK_OFF firing conditions');
  const bo = results.filter(r => r.state === 'BACK_OFF');
  console.log('    total: ' + pct(bo.length, results.length) + '  [' + tier(bo.length).label + ']');
  const boPatterns = tally(bo, r => r.pattern);
  Object.keys(boPatterns).sort((a,b)=>boPatterns[b]-boPatterns[a]).forEach(p =>
    console.log('      ' + p + ': ' + boPatterns[p]));

  sub('Contradictions');
  if(contradictions.length === 0) console.log('    NONE across ' + evaluations + ' evaluations');
  else {
    const c = tally(contradictions.map(x=>({x})), o=>o.x);
    Object.keys(c).forEach(k => console.log('    ' + k + ': ' + c[k]));
  }

  return { evaluations, nulls, results, contradictions, states, ms };
}

/* ---------- differential / monotonicity ---------- */
function runDifferentialTests(app){
  section('DIFFERENTIAL TESTING (one variable at a time)');
  const ctx = app.ctx;
  const clearAll = () => ['invalidateSortedLogCache','invalidateXPTimelineCache','invalidateConsistencyCache',
    'invalidateCapabilityCache','invalidateContextCache','invalidateRecoveryCache','invalidateShadowCache',
    'invalidateRepRangeCache','invalidateExerciseIdCache'].forEach(f => ctx[f] && ctx[f]());
  const rank = { BACK_OFF:0, MAINTAIN:1, CONSOLIDATE:2, PROGRESS:3 };
  const bench = arr => arr.map((s,i) => WK('d'+i, i*6, 'push', [EX('Bench Press', s)]));
  const run = (log, readiness) => { ctx.workoutLog = log; ctx.dailyReadiness = readiness||{};
    clearAll(); return ctx.computeShadowRecommendation('Bench Press'); };
  ctx.athleteProfile.goal = 'hypertrophy';

  const flat = bench([[S(225,9,2,'working')],[S(225,9,2,'working')],[S(225,9,2,'working')],[S(225,9,2,'working')]]);
  const up   = bench([[S(225,12,3,'working')],[S(225,12,3,'working')],[S(225,11,2,'working')],[S(225,10,2,'working')]]);
  const down = bench([[S(225,5,0,'working')],[S(225,6,0,'working')],[S(225,9,2,'working')],[S(225,9,2,'working')]]);
  const hiR = { [D(0)]:{ date:D(0), energy:'high', sleep:'good', soreness:'low', stress:'low', trainingFeel:'push' } };
  const loR = { [D(0)]:{ date:D(0), energy:'low', sleep:'poor', soreness:'high', stress:'high', trainingFeel:'easy' } };

  const checks = [];
  const rFlat = run(flat), rUp = run(up), rDown = run(down);
  checks.push(['performance improving is never more conservative',
    rank[rUp.finalState] >= rank[rFlat.finalState], rFlat.finalState+' -> '+rUp.finalState]);
  checks.push(['performance declining is never more aggressive',
    rank[rDown.finalState] <= rank[rFlat.finalState], rFlat.finalState+' -> '+rDown.finalState]);

  const rHi = run(up, hiR), rLo = run(up, loR), rNone = run(up, {});
  checks.push(['lower readiness never strengthens progression',
    rank[rLo.finalState] <= rank[rHi.finalState], rHi.finalState+' vs '+rLo.finalState]);
  checks.push(['readiness alone never creates progression beyond evidence',
    rank[rHi.finalState] <= rank[rNone.finalState], rNone.finalState+' vs '+rHi.finalState]);

  const fatigued = [0,1,2,3].map(i => WK('f'+i, i, 'push',
    [EX('Bench Press', Array.from({length:6},()=>S(225,12,3,'working')))]));
  const rFat = run(fatigued), rRest = run(up);
  checks.push(['lower recovery never strengthens progression',
    rank[rFat.finalState] <= rank[rRest.finalState], rRest.finalState+' vs '+rFat.finalState]);

  // confidence: thin history must not produce a LARGER step than rich history
  const thin = bench([[S(225,12,3,'working')],[S(225,12,3,'working')]]);
  const rich = bench(Array.from({length:12},()=>[S(225,12,3,'working')]));
  const rThin = run(thin), rRich = run(rich);
  const stepThin = rThin && rThin.weight!==null ? rThin.weight-225 : 0;
  const stepRich = rRich && rRich.weight!==null ? rRich.weight-225 : 0;
  checks.push(['lower confidence never increases magnitude',
    stepThin <= stepRich, 'thin +'+stepThin+' vs rich +'+stepRich]);

  let failed = 0;
  checks.forEach(([n,ok,detail]) => {
    console.log('  ' + (ok?'PASS':'FAIL') + '  ' + n + '  (' + detail + ')');
    if(!ok) failed++;
  });
  return { total: checks.length, failed };
}

/* ---------- engine version comparison ---------- */
async function compareEngines(pathA, pathB){
  section('ENGINE VERSION COMPARISON');
  if(!fs.existsSync(pathA) || !fs.existsSync(pathB)){
    console.log('  Need two app files: node loop-evaluate.js compare <a.html> <b.html>');
    return;
  }
  const load = p => { process.env.LOOP_APP = p; delete require.cache[require.resolve('./loop-test-harness.js')];
    const HH = require('./loop-test-harness.js'); return { HH, app: HH.loadApp() }; };

  const A = load(pathA), B = load(pathB);
  console.log('  A: ' + path.basename(pathA) + '  engine ' + A.app.ctx.TRAINER_ENGINE_VERSION);
  console.log('  B: ' + path.basename(pathB) + '  engine ' + B.app.ctx.TRAINER_ENGINE_VERSION);

  const scenarios = [];
  for(let seed=1; seed<=25; seed++){
    const a = makeAthlete(seed*31);
    EXERCISE_POOL.slice(0,3).forEach(ex => PATTERNS.forEach(p =>
      scenarios.push({ athlete:a, ex, pattern:p, sessions:6 })));
  }
  const evalOn = (app, sc) => {
    const ctx = app.ctx;
    ['invalidateSortedLogCache','invalidateXPTimelineCache','invalidateConsistencyCache',
     'invalidateCapabilityCache','invalidateContextCache','invalidateRecoveryCache','invalidateShadowCache',
     'invalidateRepRangeCache','invalidateExerciseIdCache'].forEach(f => ctx[f] && ctx[f]());
    ctx.athleteProfile.goal = sc.athlete.goal;
    ctx.workoutLog = makeHistory(sc.athlete, sc.ex, sc.pattern, sc.sessions);
    ctx.dailyReadiness = {};
    return ctx.computeShadowRecommendation(sc.ex.name);
  };

  let same = 0, stateChanged = 0, weightChanged = 0, confChanged = 0, nullChanged = 0;
  scenarios.forEach(sc => {
    const ra = evalOn(A.app, sc), rb = evalOn(B.app, sc);
    if(!ra && !rb){ same++; return; }
    if(!ra || !rb){ nullChanged++; return; }
    if(ra.finalState !== rb.finalState) stateChanged++;
    if(ra.weight !== rb.weight) weightChanged++;
    if(ra.confidence !== rb.confidence) confChanged++;
    if(ra.finalState===rb.finalState && ra.weight===rb.weight && ra.confidence===rb.confidence) same++;
  });
  const n = scenarios.length;
  console.log('  scenarios: ' + n + '  [' + tier(n).label + ']');
  console.log('  identical decisions : ' + pct(same, n));
  console.log('  state changed       : ' + pct(stateChanged, n));
  console.log('  weight changed      : ' + pct(weightChanged, n));
  console.log('  confidence changed  : ' + pct(confChanged, n));
  console.log('  null status changed : ' + pct(nullChanged, n));
  process.env.LOOP_APP = '';
}

/* ========================= RUNNER ========================= */
async function main(){
  console.log('LOOP TRAINER EVALUATION & EVIDENCE ENGINE  v' + EVAL_VERSION);
  console.log('mode: ' + MODE);

  if(MODE === 'compare'){
    await compareEngines(process.argv[3], process.argv[4]);
    return;
  }

  const app = H.loadApp();
  console.log('engine: ' + app.ctx.TRAINER_ENGINE_VERSION + ' | schema v' + app.ctx.DATA_SCHEMA_VERSION);

  let realResult = null, synthResult = null, diffResult = null;

  if(MODE === 'real' || MODE === 'both'){
    const backupPath = process.argv[3];
    realResult = evaluateReal(loadRealTrainerLog(backupPath), app);
  }
  if(MODE === 'synthetic' || MODE === 'both'){
    const count = parseInt(process.env.LOOP_ATHLETES) || 100;
    synthResult = runSyntheticSuite(app, count);
    diffResult = runDifferentialTests(app);
  }

  section('RED FLAGS');
  const flags = [];
  if(realResult) flags.push(...realResult.redFlags);
  if(synthResult && synthResult.contradictions.length){
    const t = tally(synthResult.contradictions.map(x=>({x})), o=>o.x);
    Object.keys(t).forEach(k => flags.push({ sev:'CONTRADICTION', msg:k, n:t[k], source:'synthetic' }));
  }
  if(diffResult && diffResult.failed) flags.push({ sev:'CONTRADICTION', msg: diffResult.failed + ' monotonicity failure(s)', n:diffResult.failed, source:'synthetic' });
  if(!flags.length) console.log('  none detected');
  else flags.forEach(f => console.log('  [' + f.sev + '] (' + f.source + ', n=' + f.n + ') ' + f.msg));

  section('DATA SAFETY');
  console.log('  Real evidence read from an exported backup file (read-only).');
  console.log('  Simulation ran against an isolated in-memory store.');
  console.log('  No production workoutLog / XP / PR / plan / readiness / profile touched.');
  console.log('  trainerLog was never written during evaluation.');

  section('EVIDENCE SUMMARY');
  if(realResult) console.log('  REAL      : n=' + realResult.entries + '  [' + realResult.tier.label + ']');
  if(synthResult) console.log('  SYNTHETIC : n=' + synthResult.evaluations + '  [' + tier(synthResult.evaluations).label + ']');
  console.log('  These are reported separately and are never combined.');
  process.exit(flags.filter(f => f.sev === 'CONTRADICTION').length ? 1 : 0);
}

main().catch(e => { console.error('EVALUATION ERROR:', e); process.exit(1); });

/* =========================================================
   LOOP — TEST HARNESS
   ---------------------------------------------------------
   Loads the production app script into an isolated Node
   context with a DOM stub, so every intelligence system can
   be exercised without rendering.

   ISOLATION GUARANTEE: the harness never touches real user
   data. It loads index.html as TEXT, evaluates the script
   against an in-memory store, and exits. Nothing is written
   to disk, and the deployed app is never modified.

   Usage:
     node loop-tests.js quick      — fast contract checks
     node loop-tests.js full       — quick + update-safety + perf
     node loop-tests.js trainer    — full + simulation harness
   ========================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_PATH = process.env.LOOP_APP || path.join(__dirname, 'index.html');

/* ---------- deterministic PRNG (same seed => same athlete) ---------- */
function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- DOM stub ---------- */
function buildDomStub(){
  const els = {};
  let rows = [];
  const mkEl = (id) => {
    const e = {
      id, style:{}, dataset:{}, innerHTML:'', textContent:'', value:'', checked:false, files:[],
      _cls:new Set(),
      classList:{
        add:c=>e._cls.add(c), remove:c=>e._cls.delete(c),
        toggle:(c,f)=>{ if(f===undefined){ e._cls.has(c)?e._cls.delete(c):e._cls.add(c); } else { f?e._cls.add(c):e._cls.delete(c); } },
        contains:c=>e._cls.has(c)
      },
      appendChild(){}, removeChild(){}, remove(){}, insertAdjacentElement(){}, insertAdjacentHTML(){},
      focus(){}, setAttribute(){}, getAttribute(){ return null; },
      addEventListener(){}, removeEventListener(){},
      querySelector(){ return null; }, querySelectorAll(){ return []; }, closest(){ return null; },
      scrollIntoView(){}, scrollTo(){}, click(){},
      offsetLeft:0, offsetWidth:100, clientWidth:100, parentNode:{}
    };
    return e;
  };
  return {
    mkEl,
    setRows(r){ rows = r; },
    document: {
      getElementById: id => (els[id] || (els[id] = mkEl(id))),
      querySelector: () => null,
      querySelectorAll: sel => sel === '#logExercises .ex-log-row' ? rows : [],
      createElement: () => mkEl('new'),
      addEventListener(){},
      body: mkEl('body'),
      visibilityState: 'visible',
      documentElement: mkEl('html')
    },
    els
  };
}

/* Row builders used by shadow-observation tests. */
function mkInput(v){ return { value:String(v), checked:false, dataset:{},
  classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } } }; }

function mkSetRow(s){
  const inputs = { '.set-weight-in':mkInput(s.w===undefined?'':s.w),
                   '.set-reps-in':mkInput(s.r===undefined?'':s.r),
                   '.set-rir-in':mkInput(s.rir===undefined?'':s.rir) };
  const cls = new Set(); if(s.completed) cls.add('completed');
  return { dataset: s.type ? { setType:s.type } : {},
    classList:{ add:c=>cls.add(c), remove:c=>cls.delete(c), toggle(){}, contains:c=>cls.has(c) },
    querySelector: sel => inputs[sel] || null, querySelectorAll: () => [] };
}

function mkExRow(name, bodyweight, sets, meta){
  const setRows = sets.map(mkSetRow);
  const nameIn = mkInput(name);
  const bwIn = mkInput(''); bwIn.checked = !!bodyweight;
  const row = {
    dataset: meta ? { meta: JSON.stringify(meta) } : {},
    querySelector: sel => ({
      '.ex-name-in': nameIn, '.ex-bw-in': bwIn,
      '.sets-list': null, '.rest-panel': null, '.fb-strip': null,
      '.set-row.completed': setRows.find(x => x.classList.contains('completed')) || null
    })[sel] || null,
    querySelectorAll: sel => sel === '.set-row' ? setRows : [],
    closest: () => row,
    _setRows: setRows
  };
  return row;
}

/* ---------- load the app into an isolated context ---------- */
function loadApp(initialStore){
  const html = fs.readFileSync(APP_PATH, 'utf8');
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if(!blocks.length) throw new Error('no <script> block found in ' + APP_PATH);
  const main = blocks.reduce((a,b) => (b[1].length > a[1].length ? b : a));
  const src = main[1];

  const dom = buildDomStub();
  const store = Object.assign({
    workoutLog: JSON.stringify([]),
    selectedPlan: JSON.stringify('balanced'),
    dataSchemaVersion: '1',
    dismissedMissed: '[]'
  }, initialStore || {});

  const errors = [];
  const sandbox = {
    console: { log(){}, warn(){}, error:(...a)=>errors.push(a.join(' ')) },
    document: dom.document,
    navigator: { serviceWorker:{ register: async()=>{} } },
    location: { protocol:'https:', reload(){}, href:'' },
    history: { pushState(){}, back(){} },
    alert(){}, confirm(){ return true; },
    Blob: class {}, URL: { createObjectURL:()=>'', revokeObjectURL(){} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: f => f(),
    Math, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Error,
    parseInt, parseFloat, isNaN, Promise, Set, Map,
    __errors: errors, __store: store
  };
  sandbox.window = {
    storage: {
      get: async k => store[k] !== undefined ? { value: store[k] } : null,
      set: async (k,v) => { store[k] = v; },
      delete: async k => { delete store[k]; },
      list: async () => ({ keys: Object.keys(store) })
    },
    addEventListener(){},
    localStorage: { getItem:()=>null, setItem(){}, removeItem(){}, key:()=>null, length:0 },
    matchMedia: () => ({ matches:false, addEventListener(){} })
  };
  sandbox.globalThis = sandbox;
  /* Top-level `let`/`const` in a VM context create LEXICAL bindings that are
     not attached to globalThis (unlike function declarations). A direct eval
     appended to the same scope can still see them, so we bridge each one to a
     live accessor property — reads and writes hit the real binding. */
  const BRIDGE = ['workoutLog','dailyReadiness','athleteProfile','exercisePrefs','trainerLog',
    'selectedPlanId','schedule','planData','planStartDate',
    'DATA_SCHEMA_VERSION','DATA_KEYS','TRAINER_ENGINE_VERSION','SIM_UNUSED',
    '_simulatedNow','SET_TYPES','FEEDBACK_VALUES','TRAINER_CONFIG','RECOVERY_CONFIG',
    'CAPABILITY_CONFIG','REPLAY_CONFIG','TRAINING_GOALS','MUSCLE_MAP','MUSCLE_LABELS',
    'CANONICAL_EXERCISES','TRAINER_STATES','READINESS_OPTIONS','DEFAULT_PLANS','ORDER','CAT_LABEL','LOOPStore','SCHEMA_KEY','BACKUP_PREFIX','CARDIO_ACTIVITIES','CARDIO_FIELDS','CARDIO_KEY','CARDIO_DRAFT_KEY','cardioLog','CARDIO_XP_CONFIG','CARDIO_MILESTONES','LOOP_UPDATES',
    'PREP_MOVEMENTS','COOLDOWN_STRETCHES','PREP_SEQUENCES','COOLDOWN_SEQUENCES','LIFT_PREP_GUIDANCE',
    'prepState','prepTimerId','prepCardDismissed','pendingLogCategory',
    'GYM_EQUIPMENT','GYM_CATEGORIES','EXERCISE_EQUIPMENT','GYM_STATUS','GYM_PROFILE_KEY',
    'gymProfile','EQUIPMENT_OPTIONS',
    'SUBSTITUTION_CONFIG','substitutionTargetRow'];
  const bootstrap = '\n;(function(){var __N=' + JSON.stringify(BRIDGE) + ';' +
    '__N.forEach(function(n){try{' +
    'var probe=eval(n);' +
    'Object.defineProperty(globalThis,n,{configurable:true,' +
    'get:function(){return eval(n);},' +
    'set:function(v){try{eval(n+"=v");}catch(e){}}});' +
    '}catch(e){}});})();';

  vm.createContext(sandbox);
  vm.runInContext(src + bootstrap, sandbox, { filename:'loop-app.js' });
  return { ctx: sandbox, dom, store, errors };
}

/* ---------- baseline snapshot with expected-change awareness ---------- */
const SNAPSHOT_FIELDS = {
  rawWorkoutLog:  ctx => JSON.stringify(ctx.workoutLog),
  workoutCount:   ctx => ctx.workoutLog.length,
  setCount:       ctx => ctx.workoutLog.reduce((n,l)=>n+l.exercises.reduce((m,e)=>m+(e.sets||[]).length,0),0),
  exerciseCount:  ctx => ctx.workoutLog.reduce((n,l)=>n+l.exercises.length,0),
  xp:             ctx => ctx.getCurrentProgression().lifetimeXP,
  level:          ctx => ctx.getCurrentProgression().level,
  rank:           ctx => ctx.getCurrentProgression().rank,
  prCount:        ctx => ctx.computeAllPREvents().length,
  plan:           ctx => ctx.selectedPlanId,
  readiness:      ctx => JSON.stringify(ctx.dailyReadiness),
  athleteProfile: ctx => JSON.stringify(ctx.athleteProfile),
  recovery:       ctx => JSON.stringify(ctx.computeMuscleRecovery()),
  capabilityBench:ctx => JSON.stringify(ctx.getExerciseCapability('Bench Press')),
  trainerLogCount:ctx => ctx.trainerLog.entries.length,
  schemaVersion:  ctx => ctx.DATA_SCHEMA_VERSION
};

function snapshot(ctx){
  const s = {};
  Object.keys(SNAPSHOT_FIELDS).forEach(k => {
    try { s[k] = SNAPSHOT_FIELDS[k](ctx); } catch(e){ s[k] = 'ERR:' + e.message; }
  });
  return s;
}

/* Compares two snapshots against a contract of fields ALLOWED to change.
   Anything else changing is a violation — this is what catches silent
   cross-system damage from unrelated edits. */
function diffSnapshot(before, after, allowedToChange){
  const allowed = new Set(allowedToChange || []);
  const changed = [], violations = [];
  Object.keys(before).forEach(k => {
    if(before[k] !== after[k]){
      changed.push(k);
      if(!allowed.has(k)) violations.push(k);
    }
  });
  return { changed, violations, ok: violations.length === 0 };
}

/* boot() is async — the app hydrates from the store on a microtask/timer.
   Callers that depend on persisted data must settle first. */
function settle(ms){ return new Promise(r => setTimeout(r, ms === undefined ? 250 : ms)); }
async function loadAppBooted(initialStore, ms){
  const app = loadApp(initialStore);
  await settle(ms);
  return app;
}

module.exports = { mulberry32, buildDomStub, mkExRow, mkSetRow, mkInput, loadApp,
                   loadAppBooted, settle, snapshot, diffSnapshot, SNAPSHOT_FIELDS, APP_PATH };

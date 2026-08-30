/* =========================================================
   LOOP — D31.1 TIME & DATE INTEGRITY AUDIT
   ---------------------------------------------------------
   DEVELOPMENT TOOLING ONLY. Nothing here ships to the phone.

     node loop-date-audit.js              current TZ only
     node loop-date-audit.js --matrix     re-runs itself under every TZ
     TZ=Asia/Tokyo node loop-date-audit.js

   Determinism comes from two independent controls:

     1. THE TIMEZONE is the real one. Node applies the TZ
        environment variable to every Date operation, so DST
        rules, offsets and transitions are the platform's,
        not a simulation of them.

     2. THE WALL CLOCK is stubbed inside the sandbox. The app
        reads the global Date, so swapping it for a fixed-now
        subclass makes "today" whatever a scenario needs
        without touching any production code.

   THE ORACLE IS INDEPENDENT. Expected calendar dates are
   computed with Intl.DateTimeFormat in the target zone — a
   different code path from the product's getFullYear /
   getMonth / getDate formatting — so agreement means two
   implementations agree, not that one was called twice.
   ========================================================= */
'use strict';
const H = require('./loop-test-harness.js');
const { execFileSync } = require('child_process');

const TZ_MATRIX = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver',
                   'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo'];

let PASS = 0, FAIL = 0;
const FINDINGS = [];
const TZ = process.env.TZ || 'system-default';

function section(t){ console.log('\n' + '='.repeat(68) + '\n  ' + t + '\n' + '='.repeat(68)); }
function sub(t){ console.log('\n  --- ' + t + ' ---'); }
function ok(name, cond, detail){
  if(cond){ PASS++; console.log('  PASS  ' + name); }
  else { FAIL++; console.log('  FAIL  ' + name + (detail ? '  — ' + detail : ''));
    FINDINGS.push({ tz: TZ, name, detail: detail || '' }); }
}

/* ---------- the independent oracle ---------- */
/* Local calendar date of an instant, computed by a different mechanism than
   the product uses. en-CA formats as YYYY-MM-DD. */
function oracleLocalDate(instantMs, tz){
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz === 'system-default' ? undefined : tz,
    year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(new Date(instantMs));
}
function oracleWeekday(instantMs, tz){
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz === 'system-default' ? undefined : tz,
    weekday: 'short' });
  return f.format(new Date(instantMs));
}
/* Monday of the week containing a YYYY-MM-DD, by pure arithmetic on the parts —
   no Date object at all, so it cannot inherit a timezone bug. */
function oracleMondayOf(ymd){
  const [y, m, d] = ymd.split('-').map(Number);
  /* Zeller-style day index: 0=Sunday. Uses UTC purely as a calendar calculator
     on values that carry no time, which is safe because nothing is displayed. */
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const back = (dow + 6) % 7;
  const t = Date.UTC(y, m - 1, d) - back * 86400000;
  const dt = new Date(t);
  return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') +
         '-' + String(dt.getUTCDate()).padStart(2, '0');
}

/* ---------- clock control ---------- */
function withClock(ctx, isoInstant, fn){
  const RealDate = ctx.Date;
  const fixed = new RealDate(isoInstant).getTime();
  function FakeDate(...args){
    if(args.length === 0) return new RealDate(fixed);
    return new RealDate(...args);
  }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => fixed;
  FakeDate.UTC = RealDate.UTC;
  FakeDate.parse = RealDate.parse;
  ctx.Date = FakeDate;
  try { return fn(); }
  finally { ctx.Date = RealDate; }
}

const SET = (w, r) => ({ weight: String(w), reps: String(r), rir: '2', type: 'working', completed: true });
const WK = (id, ymd, cat, name) => ({ id, date: ymd, category: cat || 'push', title: 'S', notes: '',
  exercises: [{ name: name || 'Bench Press', bodyweight: false, sets: [SET(135, 10), SET(135, 8)] }] });

function clearCaches(ctx){
  ['invalidateSortedLogCache','invalidateXPTimelineCache','invalidateConsistencyCache',
   'invalidateAllMasteryCaches','invalidateCapabilityCache','invalidateContextCache']
    .forEach(f => { try{ ctx[f] && ctx[f](); }catch(e){} });
}

/* =========================================================
   THE AUDIT
   ========================================================= */
async function run(){
  section('D31.1 DATE INTEGRITY — TZ=' + TZ);
  const app = await H.loadAppBooted({ dataSchemaVersion: '1' });
  const ctx = app.ctx;

  /* ---------------------------------------------------------
     A — the local day key must equal the real local calendar day
     --------------------------------------------------------- */
  sub('localDateStr() agrees with an independent formatter, at every hour');
  {
    const instants = [
      '2026-03-08T06:59:00Z', '2026-03-08T07:00:00Z', '2026-03-08T07:01:00Z',  // US spring forward
      '2026-11-01T05:59:00Z', '2026-11-01T06:00:00Z', '2026-11-01T06:01:00Z',  // US fall back
      '2026-03-29T00:59:00Z', '2026-03-29T01:00:00Z',                           // EU spring forward
      '2026-10-25T00:59:00Z', '2026-10-25T01:00:00Z',                           // EU fall back
      '2026-12-31T23:59:00Z', '2027-01-01T00:00:00Z',
      '2028-02-29T12:00:00Z', '2026-08-31T23:30:00Z'
    ];
    let mismatches = [];
    instants.forEach(iso => {
      withClock(ctx, iso, () => {
        const loop = ctx.localDateStr();
        const oracle = oracleLocalDate(new Date(iso).getTime(), TZ);
        if(loop !== oracle) mismatches.push(iso + ': loop=' + loop + ' oracle=' + oracle);
      });
    });
    ok('every instant maps to the same local calendar day', mismatches.length === 0,
      mismatches.slice(0, 3).join(' | '));
  }

  sub('todayKey() names the real local weekday');
  {
    const M = { Sun:'sun', Mon:'mon', Tue:'tue', Wed:'wed', Thu:'thu', Fri:'fri', Sat:'sat' };
    const bad = [];
    ['2026-03-08T07:30:00Z','2026-11-01T06:30:00Z','2026-12-31T23:59:00Z',
     '2027-01-01T00:30:00Z','2026-10-25T01:30:00Z'].forEach(iso => {
      withClock(ctx, iso, () => {
        const loop = ctx.todayKey();
        const oracle = M[oracleWeekday(new Date(iso).getTime(), TZ)];
        if(loop !== oracle) bad.push(iso + ': loop=' + loop + ' oracle=' + oracle);
      });
    });
    ok('weekday key matches the independent formatter', bad.length === 0, bad.join(' | '));
  }

  /* ---------------------------------------------------------
     B — week keys
     --------------------------------------------------------- */
  sub('weekStartKey() returns the true Monday, across DST and year ends');
  {
    const dates = ['2026-03-07','2026-03-08','2026-03-09',       // US DST weekend
                   '2026-10-24','2026-10-25','2026-10-26',       // EU DST weekend
                   '2026-11-01','2026-11-02',
                   '2026-12-28','2026-12-31','2027-01-01','2027-01-03','2027-01-04',
                   '2028-02-28','2028-02-29','2028-03-01',
                   '2026-08-30','2026-08-31','2026-09-01'];
    const bad = [];
    dates.forEach(d => {
      const loop = ctx.weekStartKey(d);
      const oracle = oracleMondayOf(d);
      if(loop !== oracle) bad.push(d + ': loop=' + loop + ' oracle=' + oracle);
    });
    ok('every date resolves to the correct Monday', bad.length === 0, bad.join(' | '));
    ok('a week spanning December and January is ONE week',
      ctx.weekStartKey('2026-12-31') === ctx.weekStartKey('2027-01-01'),
      ctx.weekStartKey('2026-12-31') + ' vs ' + ctx.weekStartKey('2027-01-01'));
    ok('a week spanning two months is ONE week',
      ctx.weekStartKey('2026-08-31') === ctx.weekStartKey('2026-09-01'),
      ctx.weekStartKey('2026-08-31') + ' vs ' + ctx.weekStartKey('2026-09-01'));
    ok('a week containing a DST transition is ONE week',
      ctx.weekStartKey('2026-03-07') === ctx.weekStartKey('2026-03-08') &&
      ctx.weekStartKey('2026-11-01') !== ctx.weekStartKey('2026-11-02'),
      'Mar7=' + ctx.weekStartKey('2026-03-07') + ' Mar8=' + ctx.weekStartKey('2026-03-08') +
      ' Nov1=' + ctx.weekStartKey('2026-11-01') + ' Nov2=' + ctx.weekStartKey('2026-11-02'));
    ok('the week key is idempotent — a Monday keys to itself',
      ctx.weekStartKey(ctx.weekStartKey('2026-03-08')) === ctx.weekStartKey('2026-03-08'));
  }

  /* ---------------------------------------------------------
     C — Sunday/Monday turnover
     --------------------------------------------------------- */
  sub('the week turns over at Monday, not Sunday');
  {
    /* Sunday belongs to the week that STARTED the previous Monday. */
    ok('Sunday belongs to the outgoing week',
      ctx.weekStartKey('2026-03-08') === '2026-03-02',
      ctx.weekStartKey('2026-03-08'));
    ok('the following Monday starts a new one',
      ctx.weekStartKey('2026-03-09') === '2026-03-09',
      ctx.weekStartKey('2026-03-09'));
    ok('and they are different weeks',
      ctx.weekStartKey('2026-03-08') !== ctx.weekStartKey('2026-03-09'));
  }

  /* ---------------------------------------------------------
     D — streaks across boundaries
     --------------------------------------------------------- */
  sub('streaks count weeks, not 168-hour blocks');
  {
    /* Four consecutive Mondays spanning the US spring-forward week. The week
       of Mar 9 contains only 167 hours; a streak that divides elapsed time by
       a week would lose it. */
    const log = ['2026-02-23','2026-03-02','2026-03-09','2026-03-16'].map((d,i) => WK('s'+i, d));
    ctx.workoutLog = log; clearCaches(ctx);
    withClock(ctx, '2026-03-18T12:00:00Z', () => {
      clearCaches(ctx);
      ok('a DST week does not break a strength streak',
        ctx.computeWeekStreak() === 4, 'streak=' + ctx.computeWeekStreak());
    });
    /* And the autumn 169-hour week must not count twice. */
    const log2 = ['2026-10-12','2026-10-19','2026-10-26','2026-11-02'].map((d,i) => WK('f'+i, d));
    ctx.workoutLog = log2; clearCaches(ctx);
    withClock(ctx, '2026-11-04T12:00:00Z', () => {
      clearCaches(ctx);
      ok('a fall-back week counts once, not twice',
        ctx.computeWeekStreak() === 4, 'streak=' + ctx.computeWeekStreak());
    });
    /* A genuine gap must still break it. */
    const log3 = ['2026-02-23','2026-03-09','2026-03-16'].map((d,i) => WK('g'+i, d));
    ctx.workoutLog = log3; clearCaches(ctx);
    withClock(ctx, '2026-03-18T12:00:00Z', () => {
      clearCaches(ctx);
      ok('a real missed week still breaks the streak',
        ctx.computeWeekStreak() === 2, 'streak=' + ctx.computeWeekStreak());
    });
    /* The current week in progress is not held against the athlete. */
    const log4 = ['2026-03-02','2026-03-09'].map((d,i) => WK('c'+i, d));
    ctx.workoutLog = log4; clearCaches(ctx);
    withClock(ctx, '2026-03-18T12:00:00Z', () => {
      clearCaches(ctx);
      ok('an untrained current week does not zero the streak',
        ctx.computeWeekStreak() >= 2, 'streak=' + ctx.computeWeekStreak());
    });
  }

  /* ---------------------------------------------------------
     E — midnight ownership
     --------------------------------------------------------- */
  sub('a workout belongs to its stored calendar date, on every surface');
  {
    /* The stored `date` is the product's ownership rule: one string, written
       once. These assert every consumer reads THAT, not a re-derived instant. */
    ctx.workoutLog = [ WK('mid', '2026-03-09', 'push') ];
    ctx.schedule = { mon:'push', tue:'pull', wed:'rest', thu:'legs', fri:'push', sat:'rest', sun:'rest' };
    clearCaches(ctx);
    withClock(ctx, '2026-03-10T12:00:00Z', () => {
      clearCaches(ctx);
      const cons = ctx.computeConsistencyData();
      const day = cons.weeks.flatMap(w => w.days).find(d => d.date === '2026-03-09');
      ok('consistency files it on its stored date', !!day && day.state !== 'rest',
        day ? day.state : 'not found');
      ok('its week is the week of its stored date',
        ctx.weekStartKey('2026-03-09') === '2026-03-09');
      const prs = ctx.computeAllPREvents();
      ok('a PR carries the same date as the session',
        prs.every(p => p.date === '2026-03-09'), JSON.stringify(prs.map(p => p.date)));
      let m = null;
      try{ m = ctx.getExerciseMasteryByName('Bench Press'); }catch(e){}
      ok('mastery records the same first and last date',
        !m || (m.firstDate === '2026-03-09' && m.lastDate === '2026-03-09'),
        m ? m.firstDate + '/' + m.lastDate : 'none');
    });
  }
  sub('exact midnight instants land on the right day');
  {
    const cases = [['2026-03-09T04:59:59Z', -1], ['2026-03-09T05:00:00Z', 0]];
    const bad = [];
    cases.forEach(([iso]) => {
      withClock(ctx, iso, () => {
        const loop = ctx.localDateStr();
        const oracle = oracleLocalDate(new Date(iso).getTime(), TZ);
        if(loop !== oracle) bad.push(iso + ' loop=' + loop + ' oracle=' + oracle);
      });
    });
    ok('23:59:59 and 00:00:00 differ by exactly one day where they should',
      bad.length === 0, bad.join(' | '));
  }

  /* ---------------------------------------------------------
     F — consistency truth across boundaries (D27)
     --------------------------------------------------------- */
  sub('consistency keeps D27 truth at every boundary');
  {
    ctx.schedule = { mon:'push', tue:'pull', wed:'rest', thu:'legs', fri:'push', sat:'rest', sun:'rest' };
    ctx.planStartDate = '2026-12-28';
    ctx.workoutLog = [ WK('y1', '2026-12-28'), WK('y2', '2026-12-31'), WK('y3', '2027-01-04') ];
    withClock(ctx, '2027-01-06T12:00:00Z', () => {
      clearCaches(ctx);
      const cons = ctx.computeConsistencyData();
      ok('nothing before tracking is counted as planned',
        cons.trackingStart === '2026-12-28', 'trackingStart=' + cons.trackingStart);
      ok('the denominator never exceeds what was knowable',
        cons.totalPlanned <= cons.plannedPerWeek * 2 + 2,
        'totalPlanned=' + cons.totalPlanned);
      const future = cons.weeks.flatMap(w => w.days).filter(d => d.date > '2027-01-06');
      ok('no future day is marked missed',
        future.every(d => d.state !== 'missed'), future.length + ' future days');
      ok('a rest day is never a miss',
        cons.weeks.flatMap(w => w.days).filter(d => !d.planned).every(d => d.state !== 'missed'));
      ok('the year boundary does not split a week',
        ctx.weekStartKey('2026-12-31') === ctx.weekStartKey('2027-01-01'));
    });
  }

  /* ---------------------------------------------------------
     G — same stored record, different viewing timezone
     --------------------------------------------------------- */
  sub('a stored workout keeps its date wherever it is viewed');
  {
    /* The stored date is a plain calendar string. Reading it must not depend
       on where the athlete is standing. */
    ctx.workoutLog = [ WK('tz', '2026-06-15') ];
    clearCaches(ctx);
    const wk = ctx.weekStartKey('2026-06-15');
    const month = ctx.monthKeyOf ? ctx.monthKeyOf('2026-06-15') : '2026-06';
    ok('its week key is timezone independent', wk === '2026-06-15', wk);
    ok('its month key is a pure string slice', month === '2026-06', month);
    ok('and the record itself is unchanged by reading it',
      ctx.workoutLog[0].date === '2026-06-15');
  }

  /* ---------------------------------------------------------
     H — grouping and ordering
     --------------------------------------------------------- */
  sub('history grouping and ordering stay deterministic');
  {
    ctx.workoutLog = [
      WK('o1', '2026-12-31'), WK('o2', '2027-01-01'),
      WK('o3', '2026-03-08'), WK('o4', '2026-03-09'),
      WK('o5', '2026-06-15'), WK('o6', '2026-06-15')      // same day, two sessions
    ];
    clearCaches(ctx);
    const sorted = ctx.sortedLog().map(l => l.date);
    const desc = sorted.every((d, i) => i === 0 || sorted[i-1] >= d);
    ok('newest-first ordering holds across year and DST boundaries', desc, sorted.join(','));
    ok('two workouts on one day remain two records',
      ctx.workoutLog.filter(l => l.date === '2026-06-15').length === 2);
    const a = ctx.sortedLog().map(l => l.id).join(',');
    clearCaches(ctx);
    const b = ctx.sortedLog().map(l => l.id).join(',');
    ok('and the order is stable between runs', a === b, a + ' vs ' + b);
  }

  /* ---------------------------------------------------------
     H2 — the one suspicious pattern in the codebase
     ---------------------------------------------------------
     Strength derives week keys from local parts (weekStartKey). Cardio has
     its own inline key built with toISOString().slice(0,10), which in any
     UTC+ zone names the PREVIOUS calendar day. That is a real inconsistency
     in FORM; these tests ask whether it is a defect in BEHAVIOUR, which is
     the only thing that licenses changing production code.
     --------------------------------------------------------- */
  sub('cardio week bucketing under a UTC+ zone and across DST');
  {
    /* duration, not minutes — computeCardioSessionXP reads session.duration. */
    const CARDIO = (id, ymd) => ({ id, date: ymd, activity: 'run', activityName: 'Run',
      duration: 30, minutes: 30, distance: 5, unit: 'km', notes: '' });
    /* Monday and the Sunday six days later are ONE training week. If the key
       shifted inconsistently they would fall in two, and the weekly XP cap
       would be applied twice. */
    ctx.cardioLog = [ CARDIO('c1', '2026-06-15'), CARDIO('c2', '2026-06-21') ];
    if(ctx.invalidateCardioXPCache) ctx.invalidateCardioXPCache();
    clearCaches(ctx);
    withClock(ctx, '2026-06-22T12:00:00Z', () => {
      clearCaches(ctx);
      if(ctx.invalidateCardioXPCache) ctx.invalidateCardioXPCache();
      let tl = null;
      try{ tl = ctx.computeCardioXPTimeline(); }catch(e){}
      const buckets = tl ? Object.keys(tl.weeklyTotals || {}) : [];
      ok('Monday and the following Sunday share one cardio week bucket',
        buckets.length === 1, 'buckets=' + JSON.stringify(buckets));
    });
    /* Four consecutive cardio weeks spanning the autumn DST change. */
    ctx.cardioLog = ['2026-10-12','2026-10-19','2026-10-26','2026-11-02']
      .map((d,i) => CARDIO('d'+i, d));
    withClock(ctx, '2026-11-04T12:00:00Z', () => {
      clearCaches(ctx);
      if(ctx.invalidateCardioXPCache) ctx.invalidateCardioXPCache();
      let st = null;
      try{ st = ctx.computeCardioStreakWeeks(); }catch(e){ st = { err: e.message }; }
      ok('a cardio streak survives the DST week', st && st.maxEver === 4,
        JSON.stringify(st));
      ok('and the current cardio streak counts the same weeks', st && st.current === 4,
        JSON.stringify(st));
    });
    /* A genuine gap must still break it, in every zone. */
    ctx.cardioLog = ['2026-10-12','2026-10-26','2026-11-02'].map((d,i) => CARDIO('e'+i, d));
    withClock(ctx, '2026-11-04T12:00:00Z', () => {
      clearCaches(ctx);
      if(ctx.invalidateCardioXPCache) ctx.invalidateCardioXPCache();
      let st = null;
      try{ st = ctx.computeCardioStreakWeeks(); }catch(e){ st = { err: e.message }; }
      ok('a missed cardio week still breaks the streak', st && st.current === 2,
        JSON.stringify(st));
    });
    /* Spring forward, the 167-hour week. */
    ctx.cardioLog = ['2026-02-23','2026-03-02','2026-03-09'].map((d,i) => CARDIO('f'+i, d));
    withClock(ctx, '2026-03-11T12:00:00Z', () => {
      clearCaches(ctx);
      if(ctx.invalidateCardioXPCache) ctx.invalidateCardioXPCache();
      let st = null;
      try{ st = ctx.computeCardioStreakWeeks(); }catch(e){ st = { err: e.message }; }
      ok('a cardio streak survives the spring-forward week', st && st.current === 3,
        JSON.stringify(st));
    });
    ctx.cardioLog = [];
    if(ctx.invalidateCardioXPCache) ctx.invalidateCardioXPCache();
  }

  /* ---------------------------------------------------------
     I — date fuzz concentrated on boundaries
     --------------------------------------------------------- */
  sub('boundary fuzz');
  {
    const rnd = H.mulberry32(31100);
    const boundaries = ['2026-03-08','2026-11-01','2026-03-29','2026-10-25',
                        '2026-12-31','2027-01-01','2028-02-29','2026-08-31',
                        '2026-01-31','2026-04-30','2026-02-28'];
    let bad = 0; const seeds = [];
    for(let i = 0; i < 600; i++){
      const base = boundaries[Math.floor(rnd() * boundaries.length)];
      const shift = Math.floor(rnd() * 7) - 3;
      const [y, m, d] = base.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d + shift));
      const ymd = dt.getUTCFullYear() + '-' + String(dt.getUTCMonth()+1).padStart(2,'0') +
                  '-' + String(dt.getUTCDate()).padStart(2,'0');
      let wk = null, err = null;
      try{ wk = ctx.weekStartKey(ymd); }catch(e){ err = e.message; }
      const oracle = oracleMondayOf(ymd);
      if(err || wk !== oracle || !/^\d{4}-\d{2}-\d{2}$/.test(wk)){
        bad++; if(seeds.length < 4) seeds.push({ i, ymd, wk, oracle, err });
      }
    }
    ok('600 boundary dates all key to the correct Monday', bad === 0,
      bad + ' mismatches ' + JSON.stringify(seeds));
  }

  section('RESULT — TZ=' + TZ);
  console.log('  passed: ' + PASS + ' | failed: ' + FAIL);
  if(FINDINGS.length){
    console.log('\n  FINDINGS:');
    FINDINGS.forEach(f => console.log('   - [' + f.tz + '] ' + f.name +
      (f.detail ? '  {' + f.detail + '}' : '')));
  }
  return FAIL;
}

/* ---------- matrix driver ---------- */
if(process.argv.includes('--matrix')){
  let total = 0;
  const summary = [];
  TZ_MATRIX.forEach(tz => {
    let out = '', code = 0;
    try{
      out = execFileSync(process.execPath, [__filename], {
        env: Object.assign({}, process.env, { TZ: tz }), encoding: 'utf8' });
    }catch(e){ out = (e.stdout || '') + (e.stderr || ''); code = 1; }
    const m = out.match(/passed: (\d+) \| failed: (\d+)/);
    const p = m ? +m[1] : 0, f = m ? +m[2] : -1;
    total += f > 0 ? f : 0;
    summary.push({ tz, passed: p, failed: f });
    if(f !== 0){
      console.log('\n########## ' + tz + ' ##########');
      console.log(out.split('\n').filter(l => /FAIL|FINDINGS|^   -/.test(l)).join('\n'));
    }
  });
  console.log('\n' + '='.repeat(68) + '\n  TIMEZONE MATRIX\n' + '='.repeat(68));
  summary.forEach(s => console.log('  ' + s.tz.padEnd(24) +
    'passed ' + String(s.passed).padStart(3) + '   failed ' + s.failed));
  console.log('\n  total failures across matrix: ' + total);
  process.exit(total ? 1 : 0);
} else {
  run().then(f => process.exit(f ? 1 : 0))
       .catch(e => { console.error('DATE AUDIT ERROR:', e); process.exit(1); });
}

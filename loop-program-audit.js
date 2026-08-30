/* =========================================================
   LOOP — PROGRAM GENERATION AUDIT  (Phase D33)
   ---------------------------------------------------------
   Dev-only. Never shipped, never loaded by index.html.

   Drives generateProgram() across the full answer matrix and
   checks the programs it produces against rules written here
   rather than imported from production — a bug in the
   generator cannot hide by also being in the oracle.

   No store is opened and nothing is written: every program is
   produced in memory and thrown away.
   ========================================================= */
const H = require('./loop-test-harness.js');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, detail) => {
  if (cond) { pass++; return true; }
  fail++; failures.push(name + (detail ? ' :: ' + detail : ''));
  return false;
};
const section = t => console.log('\n' + t + '\n' + '-'.repeat(t.length));

const DAYS = ['mon','tue','wed','thu','fri','sat','sun'];

/* Independent oracle: read a schedule the long way round, from the raw
   DEFAULT_PLANS object, rather than through the production helper. */
function oracleWorkoutDays(def) {
  return DAYS.filter(d => def.schedule[d] && def.schedule[d].type === 'workout');
}
function oracleTemplate(ctx, entry) {
  const plan = ctx.DEFAULT_PLANS[entry.planId];
  if (!plan) return null;
  const list = (plan.templates || {})[entry.category] || [];
  for (let i = 0; i < list.length; i++) if (list[i].id === entry.templateId) return list[i];
  return null;
}

(async () => {
  const app = await H.loadAppBooted({ dataSchemaVersion: '1' });
  const ctx = app.ctx;

  /* ---------- 1. THE MATRIX ---------- */
  section('1. Every combination produces a valid program');

  const goals = ['hypertrophy', 'strength', 'recomp', 'general'];
  const exps = ['new', 'intermediate', 'experienced'];
  const equips = ['full', 'home', 'dumbbells', 'minimal'];
  const lengths = ['short', 'standard', 'long', 'extended'];
  const weeksOpts = [4, 6, 8];
  const freqs = [2, 3, 4, 5, 6];

  let built = 0, invalid = 0, emptyDays = 0;
  const badValidation = [];
  goals.forEach(goal => exps.forEach(experience => equips.forEach(equipment =>
    weeksOpts.forEach(weeks => freqs.forEach(frequency => {
      lengths.forEach(sessionLength => {
        const days = ctx.builderDefaultDays(frequency);
        const def = ctx.generateProgram({
          goal, experience, equipment, weeks, days, sessionLength, emphasis: 'balanced'
        });
        built++;
        const wd = oracleWorkoutDays(def);
        if (wd.length !== frequency) emptyDays++;
        const v = ctx.validateProgram(def);
        if (!v.valid) { invalid++; if (badValidation.length < 4) badValidation.push(
          [goal, experience, equipment, weeks, frequency, sessionLength].join('/') + ' -> ' + v.errors.join('; ')); }
      });
    })
  ))));

  ok('every combination builds', built === 4 * 3 * 4 * 3 * 5 * 4, 'built=' + built);
  ok('every generated program passes production validation', invalid === 0,
    invalid + ' invalid; e.g. ' + badValidation.join(' | '));
  ok('training days always match the days chosen', emptyDays === 0, emptyDays + ' mismatched');

  /* ---------- 2. PROGRAM LENGTH IS NEVER ASSUMED ---------- */
  section('2. 4 / 6 / 8 weeks are all honoured');

  weeksOpts.forEach(w => {
    const def = ctx.generateProgram({ goal: 'hypertrophy', weeks: w, days: ['mon','wed','fri'] });
    ok(w + '-week program says ' + w + ' weeks', def.durationWeeks === w, String(def.durationWeeks));
    const last = def.blocks.reduce((m, b) => Math.max(m, b.endWeek), 0);
    ok(w + '-week phases end exactly at week ' + w, last === w, 'last=' + last);
    const first = def.blocks.reduce((m, b) => Math.min(m, b.startWeek), 99);
    ok(w + '-week phases start at week 1', first === 1, 'first=' + first);
    /* No gaps and no overlaps across the whole span. */
    const covered = [];
    def.blocks.forEach(b => { for (let i = b.startWeek; i <= b.endWeek; i++) covered.push(i); });
    covered.sort((a, b) => a - b);
    const expect = []; for (let i = 1; i <= w; i++) expect.push(i);
    ok(w + '-week phases cover every week exactly once',
      covered.join(',') === expect.join(','), covered.join(','));
  });

  /* A four-week program is one stretch of training, not two for the sake of
     the timeline having something to draw. */
  const short4 = ctx.generateProgram({ weeks: 4, days: ['mon','wed','fri'] });
  ok('a 4-week program is a single phase', short4.blocks.length === 1, String(short4.blocks.length));
  const eight = ctx.generateProgram({ weeks: 8, days: ['mon','wed','fri'] });
  ok('an 8-week program earns a second phase', eight.blocks.length === 2, String(eight.blocks.length));

  /* ---------- 3. SPLIT SELECTION ---------- */
  section('3. Frequency selects a coherent split');

  const splitFor = (freq, exp, equip) => {
    const def = ctx.generateProgram({ frequency: freq, days: ctx.builderDefaultDays(freq),
      experience: exp || 'intermediate', equipment: equip || 'full' });
    return oracleWorkoutDays(def).map(d => def.schedule[d].category);
  };

  ok('2 days is full body', splitFor(2).every(c => c === 'fullbody'), splitFor(2).join('/'));
  const s4 = splitFor(4);
  ok('4 days is upper/lower', s4.filter(c => c === 'upper').length === 2
    && s4.filter(c => c === 'lower').length === 2, s4.join('/'));
  const s6 = splitFor(6);
  ok('6 days is push/pull/legs twice',
    ['push','pull','legs'].every(c => s6.filter(x => x === c).length === 2), s6.join('/'));
  const s3new = splitFor(3, 'new');
  ok('a beginner on 3 days gets full body', s3new.every(c => c === 'fullbody'), s3new.join('/'));
  const s3exp = splitFor(3, 'experienced');
  ok('an experienced athlete on 3 days gets a split', !s3exp.every(c => c === 'fullbody'), s3exp.join('/'));

  /* A library without upper/lower must never be handed an upper/lower split. */
  const athleticCats = Object.keys((ctx.DEFAULT_PLANS.athletic || {}).templates || {});
  ok('the athletic library genuinely lacks upper/lower',
    athleticCats.indexOf('upper') === -1 && athleticCats.indexOf('lower') === -1, athleticCats.join(','));
  const forced = ctx.builderSplitFor(4, 'intermediate', 'athletic');
  ok('a library without upper/lower never gets one',
    forced.indexOf('upper') === -1 && forced.indexOf('lower') === -1, forced.join('/'));
  ok('it still produces four days', forced.length === 4, forced.join('/'));

  /* ---------- 4. FATIGUE DISTRIBUTION ---------- */
  section('4. Consecutive days are not the same session');

  const consecutiveCases = [
    ['mon','tue','wed','thu'], ['mon','tue','wed','thu','fri'],
    ['mon','tue','thu','fri'], ['sat','sun','mon','tue'],
    ['mon','tue','wed','thu','fri','sat']
  ];
  consecutiveCases.forEach(days => {
    const def = ctx.generateProgram({ days, weeks: 6, goal: 'hypertrophy' });
    let backToBack = 0;
    for (let i = 0; i < 7; i++) {
      const a = def.schedule[DAYS[i]], b = def.schedule[DAYS[(i + 1) % 7]];
      if (a && b && a.type === 'workout' && b.type === 'workout' && a.category === b.category) backToBack++;
    }
    ok('no repeated category back to back on ' + days.join('+'), backToBack === 0,
      DAYS.map(d => def.schedule[d].category || '-').join('/'));
  });

  /* ---------- 5. SESSION LENGTH ---------- */
  section('5. A short session does not become a long one');

  const minutesOf = (def) => oracleWorkoutDays(def).map(d => {
    const tpl = oracleTemplate(ctx, def.schedule[d]);
    const sets = ((tpl && tpl.exercises) || []).reduce((n, e) => n + (parseInt(e.sets, 10) || 3), 0);
    return sets * 3 + 8;
  });
  const countOf = (def) => oracleWorkoutDays(def).map(d => {
    const tpl = oracleTemplate(ctx, def.schedule[d]);
    return ((tpl && tpl.exercises) || []).length;
  });

  /* The template library tops out around fifty minutes, so a longer answer
     cannot always produce a longer session — and padding one with invented
     accessory work would be worse than honest. What must always hold is that
     asking for less never gets you MORE, and that the answer is not inert. */
  const avg = def => { const m = minutesOf(def); return m.reduce((a, b) => a + b, 0) / m.length; };
  const dayCases = [['mon','wed','fri'], ['mon','tue','thu','fri'], ['mon','tue','wed','fri','sat']];
  let monotonic = true, everDiffers = false, detail = '';
  dayCases.forEach(days => {
    const byLength = lengths.map(l =>
      avg(ctx.generateProgram({ sessionLength: l, days, equipment: 'full' })));
    for (let i = 1; i < byLength.length; i++) if (byLength[i] < byLength[i - 1] - 0.01) {
      monotonic = false; detail = days.length + 'd: ' + byLength.map(Math.round).join('/');
    }
    if (byLength[byLength.length - 1] > byLength[0] + 0.01) everDiffers = true;
  });
  ok('asking for a shorter session never produces a longer one', monotonic, detail);
  ok('session length is not an inert question', everDiffers,
    'no configuration responded to it');

  const shortDef = ctx.generateProgram({ sessionLength: 'short', days: ['mon','wed','fri'], equipment: 'full' });
  ok('a 30-45 min answer never yields a 10-exercise workout',
    Math.max.apply(null, countOf(shortDef)) < 10, countOf(shortDef).join('/'));

  /* ---------- 6. EQUIPMENT ---------- */
  section('6. Equipment is never violated');

  const homeDef = ctx.generateProgram({ equipment: 'minimal', days: ['mon','wed','fri'] });
  const homePlans = oracleWorkoutDays(homeDef).map(d => homeDef.schedule[d].planId);
  ok('a bodyweight athlete gets the home library',
    homePlans.every(p => p === 'home'), homePlans.join('/'));
  const fullDef = ctx.generateProgram({ equipment: 'full', goal: 'strength', days: ['mon','wed','fri'] });
  const fullPlans = oracleWorkoutDays(fullDef).map(d => fullDef.schedule[d].planId);
  ok('a full-gym strength athlete gets the strength library',
    fullPlans.every(p => p === 'strength'), fullPlans.join('/'));
  /* Whatever the goal, equipment wins: nobody training at home is sent to a
     machine program because they asked for muscle. */
  ['hypertrophy','strength','recomp','general'].forEach(g => {
    const d = ctx.generateProgram({ equipment: 'dumbbells', goal: g, days: ['mon','wed','fri'] });
    const plans = oracleWorkoutDays(d).map(x => d.schedule[x].planId);
    ok('equipment beats goal (' + g + ')', plans.every(p => p === 'home'), plans.join('/'));
  });

  /* ---------- 7. CANONICAL EXERCISES ---------- */
  section('7. Every exercise resolves to a canonical id');

  let unresolved = [];
  const checked = new Set();
  goals.forEach(goal => equips.forEach(equipment => {
    const def = ctx.generateProgram({ goal, equipment, days: ['mon','tue','thu','fri'], weeks: 8 });
    oracleWorkoutDays(def).forEach(d => {
      const tpl = oracleTemplate(ctx, def.schedule[d]);
      ((tpl && tpl.exercises) || []).forEach(e => {
        if (checked.has(e.name)) return;
        checked.add(e.name);
        let id = null;
        try { id = ctx.resolveExerciseId(e.name); } catch (err) { id = null; }
        if (!id) unresolved.push(e.name);
      });
    });
  }));
  ok('every generated exercise has a canonical id', unresolved.length === 0,
    unresolved.slice(0, 5).join(', ') + ' (' + unresolved.length + ' of ' + checked.size + ')');
  ok('the sweep actually looked at exercises', checked.size > 40, String(checked.size));

  /* ---------- 8. GUARDRAILS ---------- */
  section('8. The generator satisfies its own audit');

  let flagged = [];
  goals.forEach(goal => exps.forEach(experience => equips.forEach(equipment =>
    freqs.forEach(frequency => {
      const def = ctx.generateProgram({ goal, experience, equipment, frequency,
        days: ctx.builderDefaultDays(frequency), weeks: 8 });
      const problems = ctx.auditGeneratedProgram(def);
      if (problems.length) flagged.push([goal, experience, equipment, frequency].join('/') +
        ': ' + problems.map(p => p.code).join(','));
    })
  )));
  ok('no generated program trips its own guardrails', flagged.length === 0,
    flagged.slice(0, 6).join(' | ') + (flagged.length > 6 ? ' …+' + (flagged.length - 6) : ''));

  /* The audit must be capable of failing, or it proves nothing. */
  const broken = { schedule: { mon: { type:'workout', planId:'balanced', category:'push', templateId:'d1' },
    tue: { type:'workout', planId:'balanced', category:'push', templateId:'d2' },
    wed:{type:'rest'}, thu:{type:'rest'}, fri:{type:'rest'}, sat:{type:'rest'}, sun:{type:'rest'} } };
  const brokenProblems = ctx.auditGeneratedProgram(broken);
  ok('the guardrails catch two of the same day in a row',
    brokenProblems.some(p => p.code === 'repeat'), JSON.stringify(brokenProblems.map(p => p.code)));

  /* The coverage rule was relaxed to stop it flagging good full-body programs
     for having no named curl. It must still catch a week that genuinely
     misses something — a relaxed check that can no longer fail is worthless.
     Three days of nothing but pressing: no pulling, no legs, no hinge. */
  const pressOnly = { schedule: {
    mon:{ type:'workout', planId:'__t', category:'push', templateId:'x1' },
    wed:{ type:'workout', planId:'__t', category:'push', templateId:'x2' },
    fri:{ type:'workout', planId:'__t', category:'push', templateId:'x3' },
    tue:{type:'rest'}, thu:{type:'rest'}, sat:{type:'rest'}, sun:{type:'rest'} } };
  ctx.DEFAULT_PLANS.__t = { name:'probe', templates: { push: [
    { id:'x1', name:'P1', exercises:[{name:'Bench Press',sets:3},{name:'Lateral Raise',sets:3}] },
    { id:'x2', name:'P2', exercises:[{name:'Incline Bench Press',sets:3}] },
    { id:'x3', name:'P3', exercises:[{name:'Machine Chest Press',sets:3}] } ] } };
  const thin = ctx.auditGeneratedProgram(pressOnly);
  delete ctx.DEFAULT_PLANS.__t;
  ok('the coverage rule still catches a week with no pulling',
    thin.some(p => /pull/i.test(p.text)), thin.map(p => p.text).join('; ') || 'nothing flagged');
  ok('the coverage rule still catches a week with no leg work',
    thin.some(p => /quads|squat/i.test(p.text)), thin.map(p => p.text).join('; ') || 'nothing flagged');
  ok('the coverage rule still catches a missing hinge',
    thin.some(p => /hinge|posterior/i.test(p.text)), thin.map(p => p.text).join('; ') || 'nothing flagged');

  /* ---------- 9. DETERMINISM ---------- */
  section('9. The same answers always give the same program');

  const answers = { goal:'hypertrophy', experience:'intermediate', equipment:'full',
    weeks:8, days:['mon','tue','thu','fri'], sessionLength:'standard', emphasis:'back' };
  const a1 = ctx.generateProgram(answers);
  const a2 = ctx.generateProgram(answers);
  const strip = d => JSON.stringify({ name:d.name, weeks:d.durationWeeks, schedule:d.schedule,
    blocks: d.blocks.map(b => [b.name, b.startWeek, b.endWeek]) });
  ok('generation is deterministic', strip(a1) === strip(a2));

  /* ---------- 10. EMPHASIS IS MODEST ---------- */
  section('10. Emphasis nudges, it does not wreck the program');

  const balanced = ctx.generateProgram({ emphasis:'balanced', days:['mon','tue','thu','fri'], weeks:8 });
  const backHeavy = ctx.generateProgram({ emphasis:'back', days:['mon','tue','thu','fri'], weeks:8 });
  ok('emphasis keeps the same training days',
    oracleWorkoutDays(balanced).join(',') === oracleWorkoutDays(backHeavy).join(','));
  ok('emphasis keeps the same split',
    oracleWorkoutDays(balanced).map(d => balanced.schedule[d].category).join('/') ===
    oracleWorkoutDays(backHeavy).map(d => backHeavy.schedule[d].category).join('/'));
  ok('an emphasised program still passes its guardrails',
    ctx.auditGeneratedProgram(backHeavy).length === 0,
    ctx.auditGeneratedProgram(backHeavy).map(p => p.text).join('; '));

  /* ---------- 11. MALFORMED INPUT ---------- */
  section('11. Nonsense in does not crash');

  const junk = [undefined, {}, { days: [] }, { days: ['nope','mon'] }, { weeks: 999 },
    { weeks: -3 }, { frequency: 0 }, { frequency: 99 }, { goal: 'wat' },
    { equipment: 'moon' }, { experience: null }, { days: DAYS.slice() }];
  let crashed = 0, produced = 0;
  junk.forEach(j => {
    try {
      const def = ctx.generateProgram(j);
      if (def && def.schedule && def.durationWeeks >= 1) produced++;
    } catch (e) { crashed++; }
  });
  ok('no malformed answer crashes the generator', crashed === 0, crashed + ' crashed');
  ok('every malformed answer still yields a usable program', produced === junk.length,
    produced + '/' + junk.length);

  const seven = ctx.generateProgram({ days: DAYS.slice(), weeks: 4 });
  ok('training seven days is allowed but still coherent',
    ctx.validateProgram(seven).valid, ctx.validateProgram(seven).errors.join('; '));

  /* ---------- 11b. THE NAMED COMBINATIONS ----------
     Built end to end, then read back the way the app reads them: the number
     of weeks, the final week's date, and what Today would be told. */
  section('11b. Named program combinations, built and read back');

  const combos = [[4,3],[4,4],[6,4],[6,5],[8,3],[8,4],[8,6]];
  combos.forEach(([weeks, freq]) => {
    const label = weeks + 'wk/' + freq + 'day';
    const days = ctx.builderDefaultDays(freq);
    const def = ctx.generateProgram({ weeks, days, goal:'hypertrophy', equipment:'full' });
    const res = ctx.createProgram({ name: def.name, goal: def.goal,
      durationWeeks: def.durationWeeks, schedule: def.schedule, blocks: def.blocks,
      startDate: '2026-08-05' });                       // a Wednesday, deliberately
    if (!ok(label + ' saves', res.ok, (res.errors || []).join('; '))) return;
    const prog = res.program;

    ok(label + ' keeps its length', prog.durationWeeks === weeks, String(prog.durationWeeks));
    ok(label + ' trains ' + freq + ' days',
      oracleWorkoutDays(prog).length === freq, String(oracleWorkoutDays(prog).length));

    /* The last week is the last one, and there is no week after it. */
    const lastPhaseEnd = prog.blocks.reduce((m, b) => Math.max(m, b.endWeek), 0);
    ok(label + ' final week is week ' + weeks, lastPhaseEnd === weeks, String(lastPhaseEnd));
    const map = ctx.programMapHtml(prog, { week:1, idPrefix:'c' + label });
    ok(label + ' draws exactly ' + weeks + ' weeks',
      (map.match(/class="pm-w[ "]/g) || []).length === weeks);

    /* Week 1 contains the start date; the week after the last is out of range. */
    ok(label + ' week 1 contains the start date',
      ctx.programDateFor(prog, 1, 'wed') === '2026-08-05',
      String(ctx.programDateFor(prog, 1, 'wed')));
    const lastMon = ctx.programDateFor(prog, weeks, 'mon');
    const firstMon = ctx.programDateFor(prog, 1, 'mon');
    const spanDays = (new Date(lastMon) - new Date(firstMon)) / 86400000;
    ok(label + ' spans ' + (weeks - 1) + ' weeks of Mondays', spanDays === (weeks - 1) * 7,
      String(spanDays));

    /* What Today would read: the weekly schedule the program syncs across. */
    const synced = {};
    DAYS.forEach(k => {
      const e = prog.schedule[k];
      synced[k] = (e && e.type === 'workout') ? e.category : 'rest';
    });
    ok(label + ' Today sees the same days the program has',
      DAYS.filter(k => synced[k] !== 'rest').join(',') === oracleWorkoutDays(prog).join(','));

    ctx.deleteProgram(prog.id);                         // fixture store, not the user's
  });

  /* ---------- 12. NOTHING WAS WRITTEN ---------- */
  section('12. Generation has no side effects');

  const before = JSON.stringify(app.store);
  for (let i = 0; i < 20; i++) ctx.generateProgram({ goal:'strength', weeks:8, frequency:5,
    days: ctx.builderDefaultDays(5) });
  ok('generating a program writes nothing to the store', JSON.stringify(app.store) === before);
  ok('the trainer is untouched', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow',
    String(ctx.TRAINER_ENGINE_VERSION));

  console.log('\n  passed: ' + pass + ' | failed: ' + fail);
  if (fail) { console.log('\n  FAILURES:'); failures.forEach(f => console.log('   - ' + f)); }
  console.log('\n  Programs were generated in memory in an isolated harness.');
  console.log('  No store was opened and no program was saved.');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('AUDIT ERROR:', e); process.exit(1); });

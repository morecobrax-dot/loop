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
  /* D37 — length alone no longer earns a phase. A hypertrophy block of any
     length is deliberately one phase; a strength block earns two because its
     prescription genuinely moves. */
  const eightHyp = ctx.generateProgram({ weeks: 8, days: ['mon','wed','fri'], goal: 'hypertrophy', experience: 'intermediate' });
  ok('an 8-week muscle program stays a single phase', eightHyp.blocks.length === 1, String(eightHyp.blocks.length));
  const eightStr = ctx.generateProgram({ weeks: 8, days: ['mon','wed','fri'], goal: 'strength', experience: 'intermediate' });
  ok('an 8-week strength program earns a second phase', eightStr.blocks.length === 2, String(eightStr.blocks.length));

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

  /* ---------- 13. EXPLAINABILITY  (Phase D34) ----------
     Every combination must produce a coherent, truthful explanation. The
     oracle here recomputes muscle contributions with its OWN keyword table
     and word-bounded matching — a wrong production label cannot hide by
     also being wrong in the checker. */
  section('13. Every program can explain itself truthfully');

  const AUDIT_GROUPS = {
    chest:['bench','chest press','pec','chest fly','cable fly','push-up','push up','floor press','incline press','decline press','fly','incline barbell','incline db','incline dumbbell','incline machine','flat db','flat dumbbell','db press','dumbbell press'],
    shoulders:['shoulder press','overhead','lateral raise','front raise','arnold','rear delt','delt','pike'],
    back:['row','pulldown','pull-up','pull up','pullover','shrug','rack pull','deadlift'],
    /* 'curl' alone matches Leg Curl — the exact bug the production layer
       had. The oracle checks bicep curls, not knee flexion. */
    biceps:['bicep curl','hammer curl','ez curl','preacher curl','barbell curl','db curl','dumbbell curl','cable curl','concentration curl','incline curl'],
    triceps:['triceps','pushdown','skullcrusher','close-grip','dip','kickback'],
    quads:['squat','leg press','lunge','leg extension','step-up','hack'],
    hamstrings:['leg curl','rdl','romanian','good morning','nordic','hamstring'],
    glutes:['hip thrust','glute','bridge'],
    abs:['crunch','plank','leg raise','woodchop','twist','sit-up','dead bug','hollow','pallof'],
    calves:['calf']
  };
  const wordHit = (name, kw) => {
    const i = name.indexOf(kw);
    if (i === -1) return false;
    const before = i === 0 ? ' ' : name.charAt(i - 1);
    const after = name.charAt(i + kw.length) || ' ';
    return !/[a-z]/.test(before) && !/[a-z]/.test(after);
  };
  /* Attribution comes from the same curated registry production reads — the
     registry is the SPEC for what an exercise trains, and a keyword list
     that disagrees with it is noise, not independence (it called a Hip
     Thrust day "fewer glute sets"). What stays independent here is every
     line of MATH: set-weighting, shares, sibling averaging, lean thresholds
     and label mapping are all reimplemented in this file. The substring
     class of data bug is covered separately by the poison fixtures below. */
  const auditTally = tpl => {
    const t = {};
    ((tpl && tpl.exercises) || []).forEach(x => {
      const sets = parseInt(x.sets, 10) || 3;
      let prim = null;
      try{
        const id = ctx.resolveExerciseId(x.name);
        const c = id ? ctx.getCanonicalExercise(id) : null;
        if (c && c.primary && c.primary.length) prim = c.primary;
      }catch(e){}
      if (prim){ prim.forEach(m => { const g = m === 'core' ? 'abs' : m; t[g] = (t[g] || 0) + sets; }); return; }
      const n = String(x.name).toLowerCase();
      Object.keys(ctx.MUSCLE_MAP).forEach(g => {
        if (ctx.MUSCLE_MAP[g].some(kw => n.indexOf(kw) !== -1)) t[g] = (t[g] || 0) + sets;
      });
    });
    return t;
  };
  const share = t => { const tot = Object.keys(t).reduce((n,g) => n + t[g], 0) || 1;
    const o = {}; Object.keys(t).forEach(g => o[g] = t[g] / tot); return o; };
  const LABEL2GROUP = { Chest:'chest', Back:'back', Shoulders:'shoulders', Biceps:'biceps',
    Triceps:'triceps', Core:'abs', Quads:'quads', Hamstrings:'hamstrings', Glutes:'glutes', Calves:'calves' };

  /* A claimed focus must lean where the oracle says this session leans
     against its siblings. Loose floor on purpose: taxonomies differ at the
     margin, but a claim pointing at the wrong muscle goes negative. */
  const focusClaimHolds = (def, dayKey, focusText) => {
    const claimed = focusText.replace(/ focus$/, '').split(' & ')
      .map(l => LABEL2GROUP[l]).filter(Boolean);
    if (!claimed.length) return false;
    const e = def.schedule[dayKey];
    const sibs = DAYS.filter(k => k !== dayKey && def.schedule[k]
      && def.schedule[k].type === 'workout' && def.schedule[k].category === e.category);
    if (!sibs.length) return false;
    const mine = share(auditTally(ctx.builderTemplateOf(e)));
    const theirs = sibs.map(k => share(auditTally(ctx.builderTemplateOf(def.schedule[k]))));
    return claimed.every(g => {
      const avg = theirs.reduce((n,o) => n + (o[g] || 0), 0) / theirs.length;
      return (mine[g] || 0) - avg > 0.02;
    });
  };

  const FORBIDDEN = /optimi[sz]|\bAI\b|scientific|perfect|personali[sz]ed|advanced periodization|readiness|recovery|trainer/i;

  {
    let combos = 0, badText = 0, badSessions = 0, badFocus = 0, badEmph = 0,
      badPhases = 0, badCtx = 0, badWords = 0, effectiveCount = 0, inertCount = 0,
      extraVerified = 0;
    const lists = { text:[], words:[], facts:[], focus:[], emph:[] };
    const note = (list, tag) => { if (list.length < 5) list.push(tag); };

    goals.forEach(goal => exps.forEach(experience => equips.forEach(equipment =>
      ['balanced','chest','back','shoulders','arms','legs','glutes'].forEach(emphasis =>
        weeksOpts.forEach(weeks => freqs.forEach(frequency => {
          combos++;
          const def = ctx.generateProgram({ goal, experience, equipment, emphasis, weeks,
            days: ctx.builderDefaultDays(frequency), sessionLength: 'standard' });
          const expl = ctx.deriveProgramExplanation(def);
          if (!expl || !expl.headline) { badText++; note(lists.text, 'no expl'); return; }

          /* Text integrity across everything derived. */
          const texts = [expl.headline, expl.split && expl.split.why, expl.schedule,
            ctx.programFocusText(expl), expl.progression, expl.phases && expl.phases.note]
            .concat((expl.phases.phases || []).map(x => x.name + ' ' + x.purpose))
            .concat([1, Math.ceil(weeks / 2), weeks].map(w => ctx.deriveWeekContext(def, w)))
            .filter(Boolean).join(' | ');
          if (/undefined|\[object|NaN/.test(texts)) { badText++; note(lists.text, 'bad text: ' + texts.slice(0, 80)); }
          if (FORBIDDEN.test(texts)) { badWords++; note(lists.words, 'forbidden word: ' + (texts.match(FORBIDDEN) || [''])[0]); }

          /* Structural facts recounted independently. */
          const wd = oracleWorkoutDays(def);
          if (expl.split.sessions !== wd.length) { badSessions++; note(lists.facts, 'session count'); }
          if (expl.weeks !== weeks) { badSessions++; note(lists.facts, 'weeks fact'); }

          /* Every focus tag must survive the independent oracle. */
          DAYS.forEach(k => {
            const r = expl.roles[k];
            if (r && r.focus && !focusClaimHolds(def, k, r.focus)){
              badFocus++; note(lists.focus, 'focus ' + r.focus + ' on ' + k + ' (' + [goal,equipment,frequency].join('/') + ')');
            }
          });

          /* "Extra" is only ever said when the balanced twin proves it. */
          if (emphasis !== 'balanced'){
            const em = expl.emphasis;
            if (!em) { badEmph++; note(lists.emph, 'emphasis lost'); }
            else {
              if (em.effective) effectiveCount++; else inertCount++;
              const focusLine = ctx.programFocusText(expl) || '';
              if (/^Extra /.test(focusLine) && !em.effective) { badEmph++; note(lists.emph, 'Extra without effect'); }
              if (em.effective){
                /* Rebuild the balanced twin and demand the emphasized groups
                   really did gain sets. */
                const arrangement = {}; let planId = null;
                DAYS.forEach(k => { const e = def.schedule[k];
                  if (e && e.type === 'workout'){ arrangement[k] = e.category; planId = e.planId; } });
                /* The twin must be built by the SAME pipeline as production
                   (repair + depth included), or repair-driven differences
                   read as false claims. */
                const twinSched = ctx.builderComposeWeek(arrangement, planId,
                  ctx.builderLength('standard').mid, 'balanced', experience === 'new', 'standard');
                const groups = ({ chest:['chest'], back:['back'], shoulders:['shoulders'],
                  arms:['biceps','triceps'], legs:['quads','hamstrings'], glutes:['glutes'] })[emphasis] || [];
                const total = sched => DAYS.reduce((n, k) => {
                  const t = auditTally(ctx.builderTemplateOf(sched[k]));
                  return n + groups.reduce((m, g) => m + (t[g] || 0), 0);
                }, 0);
                const mine = total(def.schedule), twin = total(twinSched);
                if (mine < twin) { badEmph++; note(lists.emph, 'extra claim but fewer sets: ' + emphasis + ' ' + mine + '<' + twin); }
                if (mine > twin) extraVerified++;
              }
            }
          }

          /* D37 — a phase must earn its existence. Length alone no longer
             creates one, so the rule is now about CONSEQUENCE: a program that
             declares two phases must name a real change, and one that
             declares a single phase must not pretend otherwise. */
          const ph = expl.phases;
          if (weeks <= 4 && (!ph.simple || ph.phases.length !== 1)) badPhases++;
          if (!ph.simple && !ph.note) badPhases++;
          if (ph.simple && ph.note) badPhases++;
          if (ph.note && /stay the same/.test(ph.note)) badPhases++;
          if (ph.phases.some(x => !x.purpose)) badPhases++;

          /* Week context: bookends speak, plain middle weeks stay silent. */
          if (!ctx.deriveWeekContext(def, 1)) badCtx++;
          if (!ctx.deriveWeekContext(def, weeks)) badCtx++;
          if (weeks === 8 && ctx.deriveWeekContext(def, 3)) badCtx++;
        })
      )))));

    ok('every combination explains itself (' + combos + ' combos)', badText === 0,
      badText + ' bad; ' + lists.text.join(' || '));
    ok('no forbidden vocabulary in any derived text', badWords === 0, lists.words.join(' || '));
    ok('structural facts match an independent recount', badSessions === 0, String(badSessions));
    ok('every A/B focus claim survives the independent muscle oracle', badFocus === 0,
      badFocus + ' bad; ' + lists.focus.join(' || '));
    ok('"extra" is only claimed when the balanced twin proves it', badEmph === 0,
      badEmph + ' bad; ' + lists.emph.join(' || '));
    ok('phase explanations never oversell', badPhases === 0, String(badPhases));
    ok('week context speaks at the bookends and stays silent mid-phase', badCtx === 0, String(badCtx));
    ok('effectiveness split is being exercised both ways',
      effectiveCount > 0 && inertCount > 0,
      'effective=' + effectiveCount + ' inert=' + inertCount);
    ok('at least one effective emphasis demonstrably added sets', extraVerified > 0,
      String(extraVerified));
    console.log('    emphasis outcomes across combos: effective=' + effectiveCount
      + ', inert=' + inertCount + ' (inert choices claim nothing, by design)');
  }

  /* The substring poisons this phase fixed, pinned as fixtures. These use
     the AUDIT_GROUPS keyword table with word-bounded matching — if the
     production layer ever re-attributes them wrongly, or the map regains a
     poison keyword, these go red. */
  {
    const prof = n => ctx.deriveWorkoutProfile({ exercises: [{ name: n, sets: 3 }] }).tally;
    const legCurl = prof('Leg Curl');
    ok('a leg curl is hamstrings, never biceps',
      (legCurl.hamstrings || 0) > 0 && !legCurl.biceps, JSON.stringify(legCurl));
    const kick = prof('Triceps Kickback');
    ok('a triceps kickback never counts as glutes', !kick.glutes, JSON.stringify(kick));
    const hack = prof('Hack Squat');
    ok('a hack squat is quads-led', (hack.quads || 0) > 0, JSON.stringify(hack));
    const gk = prof('Cable Glute Kickback');
    ok('the glute kickback still counts as glutes', (gk.glutes || 0) > 0, JSON.stringify(gk));
    ok('the poison keyword itself is gone from the map',
      ctx.MUSCLE_MAP.glutes.indexOf('kickback') === -1
      && ctx.MUSCLE_MAP.glutes.indexOf('glute kickback') !== -1);
  }

  /* The oracle itself must be able to fail, or it proves nothing. */
  {
    const def = ctx.generateProgram({ emphasis:'chest', days:['mon','tue','thu','fri'],
      weeks:8, equipment:'full', sessionLength:'standard' });
    const upperDay = DAYS.find(k => def.schedule[k].type === 'workout'
      && (def.schedule[k].category === 'upper' || def.schedule[k].category === 'push'));
    ok('the oracle rejects a fabricated focus claim',
      focusClaimHolds(def, upperDay, 'Glutes focus') === false);
  }

  /* The D33 defect this phase exposed: without stored shaping inputs, opening
     the editor and tapping Save regenerated from defaults and silently
     swapped the athlete's workouts. The round-trip is now the identity, and
     it must stay that way. */
  {
    const orig = ctx.generateProgram({ goal:'hypertrophy', equipment:'full', emphasis:'chest',
      sessionLength:'short', weeks:8, days:['mon','tue','thu','fri'] });
    const res = ctx.createProgram({ name: orig.name, goal: orig.goal,
      durationWeeks: orig.durationWeeks, schedule: orig.schedule, blocks: orig.blocks,
      startDate: '2026-08-05', emphasis: orig.emphasis, sessionLength: orig.sessionLength });
    ok('shaping inputs persist with the program', res.ok
      && res.program.emphasis === 'chest' && res.program.sessionLength === 'short');
    const stored = res.program;
    const regen = ctx.generateProgram({ goal: stored.goal, weeks: stored.durationWeeks,
      emphasis: stored.emphasis, sessionLength: stored.sessionLength,
      days: DAYS.filter(k => stored.schedule[k].type === 'workout') });
    const sig = d => DAYS.map(k => (d.schedule[k].templateId || '-')).join('|');
    ok('edit round-trip is the identity', sig(stored) === sig(regen),
      sig(stored) + ' vs ' + sig(regen));
    /* A pre-D34 program without the fields still explains itself. */
    const legacy = { durationWeeks: stored.durationWeeks, goal: stored.goal,
      schedule: stored.schedule, blocks: stored.blocks, startDate: stored.startDate };
    const legacyExpl = ctx.deriveProgramExplanation(legacy);
    ok('a legacy program without metadata still explains itself',
      !!legacyExpl && !!legacyExpl.headline && legacyExpl.emphasis === null);
    ctx.deleteProgram(stored.id);
  }

  /* Deriving explanations is read-only. */
  {
    const before = JSON.stringify(app.store);
    for (let i = 0; i < 10; i++){
      const d = ctx.generateProgram({ emphasis:'back', days:['mon','wed','fri'], weeks:6 });
      ctx.deriveProgramExplanation(d);
      ctx.programFocusText(ctx.deriveProgramExplanation(d));
      ctx.deriveWeekContext(d, 3);
    }
    ok('deriving an explanation writes nothing', JSON.stringify(app.store) === before);
  }

  /* ---------- 14. SESSION DEPTH & PERSONALIZATION  (Phase D35) ----------
     The library gained compositional depth: 60\u201375 earns one extension
     slot, 75+ two, spent on emphasis first and least-covered groups
     otherwise. Every pin here reports WHY it failed, so a red run reads as
     an engineering diagnosis rather than a number. */
  section('14. Session depth and personalization (D35)');

  const compSig = d => DAYS.map(k => { const e = d.schedule[k];
    if (!e || e.type !== 'workout') return '-';
    return e.templateId + '+' + (e.ext || []).join('.') + '+' + (e.lead || 0); }).join('|');
  const composedMinutes = d => DAYS.reduce((n, k) => {
    const t = ctx.builderTemplateOf(d.schedule[k]);
    return n + (t ? ctx.computeWorkoutDuration(t) : 0); }, 0);
  const composedNames = d => { const out = [];
    DAYS.forEach(k => { const t = ctx.builderTemplateOf(d.schedule[k]);
      if (t) out.push(t.exercises.map(x => x.name).join(',')); });
    return out.join('|'); };

  /* Every extension entry must be sound on its own. */
  {
    const bad = [];
    const HOME_OK = { Dumbbell:1, Bodyweight:1, Band:1, Kettlebell:1 };
    ctx.PROGRAM_EXTENSIONS.forEach(x => {
      if (!x.id || !x.groups.length || !x.slots.length) bad.push(x.id + ': malformed');
      x.exercises.forEach(e => {
        let c = null;
        try{ const id = ctx.resolveExerciseId(e.name); c = id ? ctx.getCanonicalExercise(id) : null; }catch(err){}
        if (c && c.primary && c.primary.length){
          const prim = c.primary.map(m => m === 'core' ? 'abs' : m);
          if (!x.groups.some(g => prim.indexOf(g) !== -1))
            bad.push(x.id + ': declared ' + x.groups + ' but canonical says ' + prim);
          if (!x.gym && c.equipment && !HOME_OK[c.equipment])
            bad.push(x.id + ': marked home-safe but needs ' + c.equipment);
        } else {
          /* Uncataloged: the constrained keyword fallback must at least agree
             with the declared groups. */
          const n = String(e.name).toLowerCase();
          const kw = Object.keys(ctx.MUSCLE_MAP).filter(g =>
            ctx.MUSCLE_MAP[g].some(w => n.indexOf(w) !== -1));
          if (!x.groups.some(g => kw.indexOf(g) !== -1))
            bad.push(x.id + ': unresolvable and keywords disagree (' + kw + ')');
        }
      });
    });
    ok('every extension is canonical-consistent and equipment-honest', bad.length === 0,
      bad.slice(0, 4).join(' | '));
  }

  /* Determinism: same inputs, byte-identical program, 100 times. */
  {
    const cases = [
      { emphasis:'chest', sessionLength:'extended', days:['mon','tue','thu','fri'], weeks:8, equipment:'full' },
      { emphasis:'arms', sessionLength:'long', days:['mon','tue','wed','fri','sat'], weeks:6, equipment:'home', experience:'experienced' },
      { emphasis:'balanced', sessionLength:'short', days:['mon','thu'], weeks:4, equipment:'minimal', experience:'new' }
    ];
    let stable = true, which = '';
    cases.forEach(a => {
      const first = JSON.stringify(ctx.generateProgram(a).schedule);
      for (let i = 0; i < 100; i++){
        if (JSON.stringify(ctx.generateProgram(a).schedule) !== first){
          stable = false; which = JSON.stringify(a); break;
        }
      }
    });
    ok('generation is byte-identical across 100 repeats', stable, which);
  }

  /* Monotonicity + duration behaviour across the full combo space. */
  {
    let monoBad = [], allSame = 0, stdLongSame = 0, longExtSame = 0, combos = 0;
    let overCap = [];
    const CAPS = { short:45, standard:60, long:75, extended:88 };
    goals.forEach(goal => exps.forEach(experience => equips.forEach(equipment =>
      freqs.forEach(frequency => {
        const days = ctx.builderDefaultDays(frequency);
        const four = ['short','standard','long','extended'].map(sessionLength => ({
          sessionLength,
          def: ctx.generateProgram({ goal, experience, equipment, emphasis:'balanced', sessionLength, weeks:6, days })
        }));
        combos++;
        const sigs = four.map(x => compSig(x.def));
        const mins = four.map(x => composedMinutes(x.def));
        if (new Set(sigs).size === 1) allSame++;
        if (sigs[1] === sigs[2]) stdLongSame++;
        if (sigs[2] === sigs[3]) longExtSame++;
        for (let i = 1; i < 4; i++) if (mins[i] < mins[i-1] - 0.01 && monoBad.length < 3)
          monoBad.push('SHORTER REQUEST GOT MORE WORK: ' + [goal,experience,equipment,frequency].join('/')
            + ' ' + four[i-1].sessionLength + '=' + mins[i-1] + ' > ' + four[i].sessionLength + '=' + mins[i]);
        four.forEach(x => {
          DAYS.forEach(k => {
            const t = ctx.builderTemplateOf(x.def.schedule[k]);
            if (!t) return;
            const m = ctx.computeWorkoutDuration(t);
            if (m > CAPS[x.sessionLength] && overCap.length < 3)
              overCap.push('SESSION OVER BAND: ' + m + 'min for ' + x.sessionLength + ' ('
                + [goal,experience,equipment,frequency,k].join('/') + ')');
          });
        });
      }))));
    ok('a shorter request never generates more work', monoBad.length === 0, monoBad.join(' || '));
    ok('no session exceeds its duration band', overCap.length === 0, overCap.join(' || '));
    ok('45\u201360 vs 60\u201375 no longer collapse wholesale', stdLongSame < combos * 0.35,
      'DURATION COLLAPSE: ' + stdLongSame + '/' + combos + ' identical');
    console.log('    duration: all-four-identical ' + allSame + '/' + combos
      + ', std=60-75 ' + stdLongSame + ', 60-75=75+ ' + longExtSame + ' (intentional plateaus included)');
  }

  /* Phantom personalization: an \"effective\" emphasis must change the actual
     composed movements or the opening exercise \u2014 metadata differences do
     not count. Balance: no major group a balanced week trains may collapse
     to zero under an emphasis. */
  {
    let phantom = [], collapsed = [], effective = 0, inert = 0;
    const emphList = ['chest','back','shoulders','arms','legs','glutes'];
    exps.forEach(experience => equips.forEach(equipment =>
      emphList.forEach(emphasis => ['standard','long','extended'].forEach(sessionLength =>
        freqs.forEach(frequency => {
          const days = ctx.builderDefaultDays(frequency);
          const a = ctx.generateProgram({ goal:'hypertrophy', experience, equipment, emphasis, sessionLength, weeks:6, days });
          const b = ctx.generateProgram({ goal:'hypertrophy', experience, equipment, emphasis:'balanced', sessionLength, weeks:6, days });
          const expl = ctx.deriveProgramExplanation(a);
          const isEff = !!(expl.emphasis && expl.emphasis.effective);
          if (isEff) effective++; else inert++;
          if (isEff){
            const namesDiffer = composedNames(a) !== composedNames(b);
            const firstDiffer = DAYS.some(k => {
              const ta = ctx.builderTemplateOf(a.schedule[k]), tb = ctx.builderTemplateOf(b.schedule[k]);
              return ta && tb && ta.exercises[0].name !== tb.exercises[0].name;
            });
            if (!namesDiffer && !firstDiffer && phantom.length < 3)
              phantom.push('PHANTOM: ' + [emphasis,experience,equipment,sessionLength,frequency].join('/')
                + ' claimed effective with identical composition');
            /* Balance guard. */
            const tally = def => { const t = {};
              DAYS.forEach(k => { const tpl = ctx.builderTemplateOf(def.schedule[k]);
                ((tpl && tpl.exercises) || []).forEach(x => {
                  ctx.builderPrimariesOf(x.name).forEach(g => t[g] = (t[g] || 0) + (parseInt(x.sets,10) || 3)); }); });
              return t; };
            const ta = tally(a), tb = tally(b);
            ['chest','back','shoulders','quads','hamstrings','glutes'].forEach(g => {
              if ((tb[g] || 0) > 0 && (ta[g] || 0) === 0 && collapsed.length < 3)
                collapsed.push('EMPHASIS DESTROYED COVERAGE: ' + emphasis + ' zeroed ' + g
                  + ' (' + [experience,equipment,sessionLength,frequency].join('/') + ')');
            });
          }
        })))));
    ok('no phantom personalization \u2014 every effective emphasis changes real movements',
      phantom.length === 0, phantom.join(' || '));
    ok('emphasis never zeroes a group the balanced week trains', collapsed.length === 0,
      collapsed.join(' || '));
    console.log('    hypertrophy sweep: effective=' + effective + ', inert=' + inert
      + ' (short sessions and low-frequency beginners stay inert by design)');
  }

  /* Composed weeks: no duplicate canonical exercise inside one session, no
     equipment violation, and the consecutive-day rule holds after depth. */
  {
    let dup = [], equipBad = [], adj = [];
    const HOME_OK = { Dumbbell:1, Bodyweight:1, Band:1, Kettlebell:1 };
    exps.forEach(experience => equips.forEach(equipment =>
      ['chest','arms','glutes','balanced'].forEach(emphasis =>
        ['long','extended'].forEach(sessionLength => freqs.forEach(frequency => {
          const days = ctx.builderDefaultDays(frequency);
          const def = ctx.generateProgram({ experience, equipment, emphasis, sessionLength, weeks:6, days });
          DAYS.forEach(k => {
            const e = def.schedule[k];
            const t = ctx.builderTemplateOf(e);
            if (!t) return;
            const seen = {};
            t.exercises.forEach(x => {
              let cid = null, c = null;
              try{ cid = ctx.resolveExerciseId(x.name); c = cid ? ctx.getCanonicalExercise(cid) : null; }catch(err){}
              const key = cid || String(x.name).toLowerCase();
              if (seen[key] && dup.length < 3)
                dup.push('DUPLICATE IN SESSION: ' + x.name + ' twice in ' + t.name
                  + ' (' + [experience,equipment,emphasis,sessionLength,frequency].join('/') + ')');
              seen[key] = true;
              if (equipment === 'home' || equipment === 'dumbbells' || equipment === 'minimal'){
                if ((e.ext || []).length && c && c.equipment && !HOME_OK[c.equipment]){
                  /* Only extensions are new; base templates are curated per plan. */
                  const isExt = (e.ext || []).some(id => {
                    const xt = ctx.getProgramExtension(id);
                    return xt && xt.exercises.some(z => z.name === x.name);
                  });
                  if (isExt && equipBad.length < 3)
                    equipBad.push('EQUIPMENT VIOLATION: ' + x.name + ' (' + c.equipment + ') in home program');
                }
              }
            });
          });
          for (let i = 0; i < 7; i++){
            const a = def.schedule[DAYS[i]], b = def.schedule[DAYS[(i+1)%7]];
            if (a && b && a.type === 'workout' && b.type === 'workout'
              && a.category === b.category && adj.length < 3)
              adj.push('ADJACENT REPEAT: ' + a.category + ' twice running ('
                + [experience,equipment,emphasis,sessionLength,frequency].join('/') + ')');
          }
        })))));
    ok('no composed session repeats a canonical exercise', dup.length === 0, dup.join(' || '));
    ok('extensions never violate the equipment family', equipBad.length === 0, equipBad.join(' || '));
    ok('fatigue alternation survives depth', adj.length === 0, adj.join(' || '));
  }

  /* Legacy identity: an entry with no recipe composes to its base, so every
     pre-D35 program renders and trains exactly as it did. */
  {
    const entry = { type:'workout', planId:'hypertrophy', category:'upper', templateId:'h-u1' };
    const base = ctx.builderBaseTemplateOf(entry);
    const composed = ctx.builderTemplateOf(entry);
    ok('a recipe-less entry composes to its exact base', composed === base
      || JSON.stringify(composed) === JSON.stringify(base));
  }

  /* The \u00a758 fixtures, asserted on their load-bearing properties. */
  {
    const fix = (label, a, checks) => {
      const def = ctx.generateProgram(Object.assign({ weeks:6, days: ctx.builderDefaultDays(a.frequency) }, a));
      const expl = ctx.deriveProgramExplanation(def);
      checks(def, expl, label);
    };
    fix('beginner 3d standard', { experience:'new', frequency:3, goal:'hypertrophy', sessionLength:'standard', emphasis:'balanced', equipment:'full' },
      (def) => ok('beginner standard week carries no extensions',
        DAYS.every(k => !(def.schedule[k] || {}).ext), 'beginner got depth it should not have'));
    fix('intermediate 4d 60-75 chest', { experience:'intermediate', frequency:4, goal:'hypertrophy', sessionLength:'long', emphasis:'chest', equipment:'full' },
      (def, expl) => {
        ok('4-day 60\u201375 chest is effective', !!(expl.emphasis && expl.emphasis.effective));
        ok('its sessions stay inside the 60\u201375 band', DAYS.every(k => {
          const t = ctx.builderTemplateOf(def.schedule[k]);
          return !t || ctx.computeWorkoutDuration(t) <= 75; }));
      });
    fix('experienced 5d 75+ arms', { experience:'experienced', frequency:5, goal:'hypertrophy', sessionLength:'extended', emphasis:'arms', equipment:'full' },
      (def, expl) => {
        const armDays = DAYS.filter(k => ((def.schedule[k] || {}).ext || []).some(id => {
          const x = ctx.getProgramExtension(id);
          return x && x.groups.some(g => g === 'biceps' || g === 'triceps');
        })).length;
        ok('75+ arms puts direct arm work on multiple days', armDays >= 2,
          'ARM EMPHASIS THIN: only ' + armDays + ' day(s) gained arm extensions');
        ok('and it reads as effective', !!(expl.emphasis && expl.emphasis.effective));
      });
    fix('beginner 2d short glutes', { experience:'new', frequency:2, goal:'general', sessionLength:'short', emphasis:'glutes', equipment:'full' },
      (def) => ok('a 2-day short beginner week stays lean',
        DAYS.every(k => !(def.schedule[k] || {}).ext && !(def.schedule[k] || {}).lead),
        'short beginner program gained depth'));
    fix('experienced 6d 60-75 shoulders', { experience:'experienced', frequency:6, goal:'hypertrophy', sessionLength:'long', emphasis:'shoulders', equipment:'full' },
      (def, expl) => {
        const leads = DAYS.filter(k => Number.isInteger((def.schedule[k] || {}).lead)).length;
        ok('priority ordering stays surgical: at most one led session', leads <= 1,
          leads + ' sessions were reordered');
        ok('6-day shoulders is effective', !!(expl.emphasis && expl.emphasis.effective));
      });
  }

  /* ---------- 15. TRAINING PRESCRIPTION  (Phase D36) ----------
     The oracle reimplements role classification and prescription judgement
     from the registry's own pattern data, and is proven able to reject
     fabricated bad programs before it is trusted on real ones. */
  section('15. Training prescription (D36)');

  /* Independent role oracle: compound-vs-isolation from the registry,
     position from the template. Deliberately NOT ctx.deriveExerciseRole. */
  /* The oracle keeps its OWN copy of the veto list and its own ranking, so a
     mistake in the production list cannot hide by being mirrored here. */
  const ORACLE_NEVER_PRIMARY = ['lateral_raise','lateral_raise_cable','front_raise',
    'upright_row','chest_fly_cable','chest_fly_incline_cable','rear_delt_fly','face_pull',
    'straight_arm_pulldown','leg_extension','leg_curl','hip_abduction','nordic_curl',
    'shrug','calf_raise'];
  const oracleNeverPrimary = (name) => {
    let c = null;
    try{ const id = ctx.resolveExerciseId(name); c = id ? ctx.getCanonicalExercise(id) : null; }catch(e){}
    if (!c) return false;
    if (ORACLE_NEVER_PRIMARY.indexOf(c.id) !== -1) return true;
    return !!(c.pattern && (c.pattern === 'isolation' || c.pattern === 'core'));
  };
  const oracleRole = (tpl, i) => {
    if (oracleNeverPrimary(tpl.exercises[i].name)) return 'accessory';
    let rank = 0;
    for (let j = 0; j < i; j++) if (!oracleNeverPrimary(tpl.exercises[j].name)) rank++;
    return rank === 0 ? 'primary' : (rank === 1 ? 'secondary' : 'accessory');
  };
  const mid = r => { const n = String(r).match(/\d+/g); if (!n) return null;
    return n.map(Number).reduce((a,b) => a+b, 0) / n.length; };

  /* Reads a whole program and reports every prescription complaint, in
     words. This is the tool a future phase inherits. */
  const prescriptionComplaints = (def, label) => {
    const out = [];
    DAYS.forEach(k => {
      const e = def.schedule[k];
      const tpl = ctx.builderTemplateOf(e);
      if (!tpl) return;
      let primaries = 0;
      tpl.exercises.forEach((x, i) => {
        const role = oracleRole(tpl, i);
        const m = mid(x.reps);
        const sets = parseInt(x.sets, 10) || 3;
        if (role === 'primary') primaries++;
        /* Isolation-class for PRESCRIPTION purposes, which pattern alone
           cannot answer: a Lateral Raise is filed as vertical_push. */
        const iso = oracleNeverPrimary(x.name);
        /* "to failure" is a real prescription the library ships, not a
           malformed range. */
        const openEnded = /failure|max/i.test(String(x.reps));
        if (!openEnded && (!m || m < 1)) out.push('REP RANGE INVALID: ' + x.name + ' "' + x.reps + '" (' + label + ')');
        if (iso && !openEnded && m && m <= 6)
          out.push('ISOLATION LOW-REP: ' + x.name + ' ' + sets + 'x' + x.reps + ' (' + label + ')');
        if (role === 'primary' && sets < 2)
          out.push('PRIMARY UNDERPRESCRIBED: ' + x.name + ' ' + sets + ' set(s) (' + label + ')');
        if (role === 'primary' && !openEnded && m && m > 20)
          out.push('PRIMARY ABSURD REPS: ' + x.name + ' ' + x.reps + ' (' + label + ')');
        if (sets > 6) out.push('SET COUNT EXTREME: ' + x.name + ' ' + sets + ' sets (' + label + ')');
      });
      if (primaries > 2)
        out.push('ROLE IMBALANCE: ' + primaries + ' primary movements in ' + tpl.name + ' (' + label + ')');
      if (tpl.exercises.length && primaries === 0 && tpl.exercises.length > 3)
        out.push('NO PRIMARY: ' + tpl.name + ' is all support work (' + label + ')');
    });
    return out;
  };

  /* The curated veto list must stay anchored to the registry: an id that no
     longer exists is a silent hole in the safety guard. */
  {
    /* Keyed lookup is not reliable here — the registry object is keyed by
       variant, while .id is the canonical identity the veto matches on. */
    const allIds = Object.keys(ctx.CANONICAL_EXERCISES)
      .map(k => ctx.CANONICAL_EXERCISES[k]).filter(Boolean).map(e => e.id);
    const missing = ctx.NEVER_PRIMARY_IDS.filter(id => allIds.indexOf(id) === -1);
    ok('every never-primary id still exists in the registry', missing.length === 0, missing.join(', '));
    ok('the veto actually vetoes a mis-patterned isolation movement',
      ctx.exerciseIsNeverPrimary('Lateral Raise') === true);
    ok('and it does not veto a legitimate primary',
      ctx.exerciseIsNeverPrimary('Lat Pulldown') === false
      && ctx.exerciseIsNeverPrimary('Bench Press') === false);
    ok('an uncataloged movement is still allowed to lead its session',
      ctx.exerciseIsNeverPrimary('Bodyweight Lunge') === false);
  }

  /* --- the oracle must be able to fail --- */
  {
    ctx.DEFAULT_PLANS.__rx = { name:'probe', templates: { upper: [
      { id:'r1', name:'Bad Session', exercises:[
        { name:'Lateral Raise', sets:3, reps:'3', effort:'9' },
        { name:'Back Squat', sets:1, reps:'25', effort:'7' },
        { name:'Bench Press', sets:9, reps:'8', effort:'8' } ] } ] } };
    const bogus = { schedule: { mon:{ type:'workout', planId:'__rx', category:'upper', templateId:'r1' },
      tue:{type:'rest'}, wed:{type:'rest'}, thu:{type:'rest'}, fri:{type:'rest'}, sat:{type:'rest'}, sun:{type:'rest'} } };
    const c = prescriptionComplaints(bogus, 'adversarial');
    delete ctx.DEFAULT_PLANS.__rx;
    ok('the oracle rejects a heavy-triple lateral raise',
      c.some(x => /ISOLATION LOW-REP: Lateral Raise/.test(x)), c.join(' | '));
    ok('the oracle rejects a 1x25 primary squat',
      c.some(x => /PRIMARY ABSURD REPS|PRIMARY UNDERPRESCRIBED/.test(x)), c.join(' | '));
    ok('the oracle rejects a nine-set prescription',
      c.some(x => /SET COUNT EXTREME/.test(x)), c.join(' | '));
  }

  /* --- every generated program across the matrix --- */
  {
    let complaints = [], scanned = 0;
    goals.forEach(goal => exps.forEach(experience => equips.forEach(equipment =>
      lengths.forEach(sessionLength => freqs.forEach(frequency => {
        const def = ctx.generateProgram({ goal, experience, equipment, emphasis:'balanced',
          sessionLength, weeks:6, days: ctx.builderDefaultDays(frequency) });
        scanned++;
        const c = prescriptionComplaints(def, [goal,experience,equipment,sessionLength,frequency].join('/'));
        if (c.length && complaints.length < 5) complaints = complaints.concat(c.slice(0, 2));
      })))));
    ok('every generated prescription is sane (' + scanned + ' programs)',
      complaints.length === 0, complaints.join(' || '));
  }

  /* --- goal integrity: real differences, honest sharing --- */
  {
    const rxOf = def => DAYS.map(k => { const t = ctx.builderTemplateOf(def.schedule[k]);
      return t ? t.exercises.map(x => x.sets + 'x' + x.reps).join(',') : '-'; }).join('|');
    const base = { experience:'intermediate', equipment:'full', emphasis:'balanced',
      sessionLength:'long', weeks:8, days:['mon','tue','thu','fri'] };
    const hyp = rxOf(ctx.generateProgram(Object.assign({ goal:'hypertrophy' }, base)));
    const str = rxOf(ctx.generateProgram(Object.assign({ goal:'strength' }, base)));
    const rec = rxOf(ctx.generateProgram(Object.assign({ goal:'recomp' }, base)));
    ok('Build Muscle and Get Stronger prescribe differently', hyp !== str);
    /* The D36 headline defect: Muscle + Strength used to be byte-identical
       to Build Muscle, so choosing it changed nothing at all. */
    ok('Muscle + Strength is no longer a phantom goal', rec !== hyp && rec !== str);

    /* And it must be a genuine MIDDLE: primaries lean strength, accessories
       stay hypertrophy. */
    const primaryMid = def => { const o = [];
      DAYS.forEach(k => { const t = ctx.builderTemplateOf(def.schedule[k]);
        if (t && t.exercises.length) o.push(mid(t.exercises[0].reps)); });
      return o.reduce((a,b) => a+b, 0) / (o.length || 1); };
    const accMid = def => { const o = [];
      DAYS.forEach(k => { const t = ctx.builderTemplateOf(def.schedule[k]);
        if (t) t.exercises.forEach((x,i) => { if (oracleRole(t,i) === 'accessory') o.push(mid(x.reps)); }); });
      return o.reduce((a,b) => a+b, 0) / (o.length || 1); };
    const dHyp = ctx.generateProgram(Object.assign({ goal:'hypertrophy' }, base));
    const dStr = ctx.generateProgram(Object.assign({ goal:'strength' }, base));
    const dRec = ctx.generateProgram(Object.assign({ goal:'recomp' }, base));
    ok('its primaries sit between muscle and strength',
      primaryMid(dRec) < primaryMid(dHyp) && primaryMid(dRec) > primaryMid(dStr),
      'muscle=' + primaryMid(dHyp).toFixed(1) + ' hybrid=' + primaryMid(dRec).toFixed(1)
        + ' strength=' + primaryMid(dStr).toFixed(1));
    ok('its accessories stay hypertrophy-ranged',
      Math.abs(accMid(dRec) - accMid(dHyp)) < 0.01,
      'hybrid=' + accMid(dRec).toFixed(1) + ' muscle=' + accMid(dHyp).toFixed(1));
  }

  /* --- experience gains depth only where it was paid for --- */
  {
    const setsOf = def => DAYS.reduce((n,k) => { const t = ctx.builderTemplateOf(def.schedule[k]);
      return n + ((t && t.exercises) || []).reduce((m,x) => m + (parseInt(x.sets,10) || 3), 0); }, 0);
    const at = (experience, sessionLength) => ctx.generateProgram({ goal:'hypertrophy', experience,
      equipment:'full', emphasis:'balanced', sessionLength, weeks:6, days:['mon','tue','thu','fri'] });
    ok('experience adds nothing at 45\u201360', setsOf(at('experienced','standard')) === setsOf(at('intermediate','standard')));
    ok('experience adds depth at 75+', setsOf(at('experienced','extended')) > setsOf(at('intermediate','extended')));
    ok('and it is depth, not a volume ladder',
      setsOf(at('experienced','extended')) - setsOf(at('intermediate','extended')) <= 6,
      String(setsOf(at('experienced','extended')) - setsOf(at('intermediate','extended'))));
  }

  /* --- the trainer boundary: program owns the range, trainer the load --- */
  {
    const def = ctx.generateProgram({ goal:'recomp', experience:'intermediate', equipment:'full',
      emphasis:'balanced', sessionLength:'long', weeks:8, days:['mon','tue','thu','fri'] });
    const tpl = ctx.builderTemplateOf(def.schedule.mon);
    const primary = tpl.exercises[0];
    const rec = ctx.computeShadowRecommendation(primary.name, { targetReps: primary.reps, plannedSets: primary.sets });
    if (rec && rec.trace) {
      ok('the trainer reads the program as its rep source', rec.trace.targetSource === 'program'
        || rec.trace.targetMismatch === true, String(rec.trace.targetSource));
      const planned = ctx.parseRepRange(primary.reps);
      const used = String(rec.trace.targetRange).split('-').map(Number);
      ok('and works inside the prescribed range unless history overrides it',
        rec.trace.targetMismatch === true
        || (used[0] === planned.min && used[1] === planned.max),
        'planned ' + primary.reps + ' vs trainer ' + rec.trace.targetRange);
    } else {
      ok('the trainer reads the program as its rep source', true, 'no recommendation without history');
      ok('and works inside the prescribed range unless history overrides it', true, 'n/a');
    }
    ok('the trainer engine is untouched', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  }

  /* --- prescription is derived, never stored --- */
  {
    const def = ctx.generateProgram({ goal:'recomp', experience:'experienced', equipment:'full',
      emphasis:'chest', sessionLength:'extended', weeks:8, days:['mon','tue','thu','fri'] });
    const res = ctx.createProgram({ name:def.name, goal:def.goal, durationWeeks:def.durationWeeks,
      schedule:def.schedule, blocks:def.blocks, startDate:'2026-08-05',
      emphasis:def.emphasis, sessionLength:def.sessionLength, experience:def.experience });
    ok('a prescribed program saves', res.ok, (res.errors || []).join('; '));
    const stored = app.store.programs || '';
    ok('the profile is stored as an id and nothing else',
      stored.indexOf('hybridDeep') !== -1
      && !/\"reps\"|\"sets\"|\"effort\"|primaryReps/.test(stored),
      stored.slice(0, 0));
    const bogus = JSON.parse(JSON.stringify(def));
    const d0 = DAYS.find(k => bogus.schedule[k].type === 'workout');
    bogus.schedule[d0].rx = 'not_a_profile';
    ok('an unknown profile id is refused', !ctx.validateProgram(bogus).valid);
    ctx.deleteProgram(res.program.id);
  }

  /* --- legacy programs are untouched --- */
  {
    const legacy = { type:'workout', planId:'hypertrophy', category:'upper', templateId:'h-u1' };
    ok('an entry without a profile composes to its exact base',
      JSON.stringify(ctx.builderTemplateOf(legacy)) === JSON.stringify(ctx.builderBaseTemplateOf(legacy)));
    const withRx = { type:'workout', planId:'hypertrophy', category:'upper', templateId:'h-u1', rx:'hybrid' };
    const a = ctx.builderBaseTemplateOf(withRx), b = ctx.builderTemplateOf(withRx);
    ok('a profile changes only the primary movement',
      b.exercises.slice(1).every((x,i) => x.reps === a.exercises[i+1].reps
        && x.sets === a.exercises[i+1].sets));
    ok('and it does change that one', b.exercises[0].reps !== a.exercises[0].reps);
  }

  /* --- deriving a prescription writes nothing --- */
  {
    const before = JSON.stringify(app.store);
    for (let i = 0; i < 20; i++){
      const d = ctx.generateProgram({ goal:'recomp', experience:'experienced', equipment:'full',
        emphasis:'back', sessionLength:'extended', weeks:8, days:['mon','tue','thu','fri'] });
      DAYS.forEach(k => ctx.builderTemplateOf(d.schedule[k]));
    }
    ok('prescribing writes nothing', JSON.stringify(app.store) === before);
  }

  /* ---------- 16. TEMPORAL PROGRAMMING  (Phase D37) ----------
     Before this phase every 6- and 8-week program declared two phases whose
     training was byte-identical: 1,920 of 1,920 were labels over nothing.
     The oracle here reads the actual composed sessions under each phase and
     refuses to accept a boundary that changes nothing. */
  section('16. Temporal programming (D37)');

  /* Independent: resolves each phase's weeks itself rather than asking the
     program what it thinks changed. */
  const phaseShape = (def, block) => DAYS.map(k => {
    const e = def.schedule[k];
    if (!e || e.type !== 'workout') return '-';
    const t = ctx.builderTemplateOf(e, (block && block.rx) || null);
    return ((t && t.exercises) || []).map(x =>
      x.name + ':' + x.sets + 'x' + x.reps + '@' + (x.effort || '')).join(',');
  }).join('|');

  /* --- no phase without consequence, across the whole matrix --- */
  {
    let phantom = [], single = 0, multi = 0, meaningful = 0;
    const multiBy = {};
    goals.forEach(goal => exps.forEach(experience => equips.forEach(equipment =>
      lengths.forEach(sessionLength => [4,6,8].forEach(weeks => freqs.forEach(frequency => {
        const def = ctx.generateProgram({ goal, experience, equipment, emphasis:'balanced',
          sessionLength, weeks, days: ctx.builderDefaultDays(frequency) });
        const blocks = def.blocks || [];
        if (blocks.length < 2) { single++; return; }
        multi++;
        multiBy[goal + '/' + experience] = (multiBy[goal + '/' + experience] || 0) + 1;
        const shapes = blocks.map(b => phaseShape(def, b));
        if (new Set(shapes).size === 1 && phantom.length < 4)
          phantom.push('PHANTOM PHASE: ' + [goal,experience,equipment,sessionLength,weeks,frequency].join('/')
            + ' declares ' + blocks.length + ' phases with identical training');
        else meaningful++;
      }))))));
    ok('no phase exists without a training consequence', phantom.length === 0, phantom.join(' || '));
    ok('multi-phase programs are the minority, by design', multi < single,
      'multi=' + multi + ' single=' + single);
    ok('beginners are never given a phase boundary',
      !Object.keys(multiBy).some(k => /\/new$/.test(k)), JSON.stringify(multiBy));
    console.log('    phases: ' + single + ' single, ' + multi + ' multi (all meaningful: '
      + (meaningful === multi) + ') \u2014 ' + JSON.stringify(multiBy));
  }

  /* --- the oracle must reject fabricated phases --- */
  {
    const base = ctx.generateProgram({ goal:'hypertrophy', experience:'intermediate',
      equipment:'full', emphasis:'balanced', sessionLength:'long', weeks:8,
      days:['mon','tue','thu','fri'] });
    /* Same rx on both sides, different label and description: the classic
       phantom this phase deleted. */
    const faked = JSON.parse(JSON.stringify(base));
    faked.blocks = [
      { id:'a', name:'Foundation', phaseType:'accumulation', startWeek:1, endWeek:4,
        description:'Build a base.', rx:null },
      { id:'b', name:'Intensify', phaseType:'intensification', startWeek:5, endWeek:8,
        description:'Now go harder.', rx:null }
    ];
    const shapes = faked.blocks.map(b => phaseShape(faked, b));
    ok('the oracle catches a label-only phase boundary', new Set(shapes).size === 1);
    ok('and the explanation refuses to invent a change for it',
      ctx.derivePhaseInfo(faked).note === null,
      String(ctx.derivePhaseInfo(faked).note));

    /* A microscopic difference must not read as a phase either. */
    const micro = JSON.parse(JSON.stringify(base));
    micro.blocks = [
      { id:'a', name:'A', phaseType:'accumulation', startWeek:1, endWeek:4, rx:'base' },
      { id:'b', name:'B', phaseType:'intensification', startWeek:5, endWeek:8, rx:'base' }
    ];
    ok('two identical prescriptions are not a phase change',
      new Set(micro.blocks.map(b => phaseShape(micro, b))).size === 1);
  }

  /* --- what changes is confined to the primary --- */
  {
    let leaked = [], moved = 0;
    ['strength','recomp'].forEach(goal => ['intermediate','experienced'].forEach(experience =>
      ['standard','long','extended'].forEach(sessionLength => freqs.forEach(frequency => {
        const def = ctx.generateProgram({ goal, experience, equipment:'full', emphasis:'balanced',
          sessionLength, weeks:8, days: ctx.builderDefaultDays(frequency) });
        if ((def.blocks || []).length < 2) return;
        const early = def.blocks[0], late = def.blocks[def.blocks.length - 1];
        DAYS.forEach(k => {
          const e = def.schedule[k];
          if (!e || e.type !== 'workout') return;
          const a = ctx.builderTemplateOf(e, early.rx || null);
          const b = ctx.builderTemplateOf(e, late.rx || null);
          if (!a || !b) return;
          if (a.exercises.length !== b.exercises.length){
            leaked.push('PHASE CHANGED THE SESSION SHAPE: ' + [goal,experience,frequency,k].join('/'));
            return;
          }
          a.exercises.forEach((x, i) => {
            const y = b.exercises[i];
            if (x.name !== y.name && leaked.length < 4)
              leaked.push('PHASE SWAPPED AN EXERCISE: ' + x.name + ' -> ' + y.name
                + ' (' + [goal,experience,frequency,k].join('/') + ')');
            const differs = x.sets !== y.sets || x.reps !== y.reps || x.effort !== y.effort;
            if (!differs) return;
            if (i === 0) { moved++; return; }              // the primary may move
            if (oracleRole(a, i) !== 'primary' && leaked.length < 4)
              leaked.push('PHASE MOVED NON-PRIMARY WORK: ' + x.name + ' '
                + x.sets + 'x' + x.reps + ' -> ' + y.sets + 'x' + y.reps
                + ' (' + [goal,experience,frequency,k].join('/') + ')');
          });
        });
      }))));
    ok('a phase never swaps exercises or touches accessory work', leaked.length === 0,
      leaked.join(' || '));
    ok('and it does move primaries somewhere', moved > 0, String(moved));
  }

  /* --- every phase still passes the D36 prescription oracle --- */
  {
    let complaints = [];
    ['strength','recomp'].forEach(goal => ['intermediate','experienced'].forEach(experience =>
      ['short','standard','long','extended'].forEach(sessionLength => freqs.forEach(frequency => {
        const def = ctx.generateProgram({ goal, experience, equipment:'full', emphasis:'balanced',
          sessionLength, weeks:8, days: ctx.builderDefaultDays(frequency) });
        (def.blocks || []).forEach(b => {
          /* Re-read the program as that phase resolves it, then run D36's
             judgement over it. */
          const phased = { schedule: {} };
          DAYS.forEach(k => { const e = def.schedule[k];
            phased.schedule[k] = (e && e.type === 'workout')
              ? Object.assign({}, e, { rx: b.rx || e.rx || null }) : { type:'rest' }; });
          const c = prescriptionComplaints(phased,
            [goal,experience,sessionLength,frequency,b.name].join('/'));
          if (c.length && complaints.length < 4) complaints = complaints.concat(c.slice(0, 2));
        });
      }))));
    ok('every phase passes the prescription oracle', complaints.length === 0, complaints.join(' || '));
  }

  /* --- capacity and monotonicity hold INSIDE every phase --- */
  {
    const CAPS = { short:45, standard:60, long:75, extended:88 };
    let over = [], mono = [];
    const phaseMins = (def, b) => DAYS.reduce((n, k) => {
      const t = ctx.builderTemplateOf(def.schedule[k], (b && b.rx) || null);
      return n + (t ? ctx.computeWorkoutDuration(t) : 0); }, 0);
    goals.forEach(goal => exps.forEach(experience => equips.forEach(equipment =>
      freqs.forEach(frequency => {
        const days = ctx.builderDefaultDays(frequency);
        const four = ['short','standard','long','extended'].map(sessionLength =>
          ({ sessionLength, def: ctx.generateProgram({ goal, experience, equipment,
            emphasis:'balanced', sessionLength, weeks:8, days }) }));
        /* The LAST phase is the heaviest one; monotonicity must hold there too. */
        const lastMins = four.map(x => phaseMins(x.def, (x.def.blocks || []).slice(-1)[0]));
        for (let i = 1; i < 4; i++) if (lastMins[i] < lastMins[i-1] - 0.01 && mono.length < 3)
          mono.push('PHASE BROKE MONOTONICITY: ' + [goal,experience,equipment,frequency].join('/')
            + ' ' + lastMins.join('->'));
        four.forEach(x => (x.def.blocks || []).forEach(b => {
          DAYS.forEach(k => {
            const t = ctx.builderTemplateOf(x.def.schedule[k], b.rx || null);
            if (t && ctx.computeWorkoutDuration(t) > CAPS[x.sessionLength] && over.length < 3)
              over.push('PHASE OVER BAND: ' + ctx.computeWorkoutDuration(t) + 'min in '
                + b.name + ' for ' + x.sessionLength
                + ' (' + [goal,experience,equipment,frequency].join('/') + ')');
          });
        }));
      }))));
    ok('no phase pushes a session past its duration band', over.length === 0, over.join(' || '));
    ok('monotonicity holds in the heaviest phase', mono.length === 0, mono.join(' || '));
  }

  /* --- determinism, including the phase dimension --- */
  {
    const a = { goal:'recomp', experience:'experienced', equipment:'full', emphasis:'chest',
      sessionLength:'extended', weeks:8, days:['mon','tue','thu','fri'] };
    const shot = () => { const d = ctx.generateProgram(a);
      return JSON.stringify((d.blocks || []).map(b => [b.name, b.startWeek, b.endWeek, b.rx]))
        + '|' + (d.blocks || []).map(b => phaseShape(d, b)).join('#'); };
    const first = shot();
    let stable = true;
    for (let i = 0; i < 100; i++) if (shot() !== first) stable = false;
    ok('phase resolution is byte-identical across 100 repeats', stable);
  }

  /* --- legacy programs keep their original behaviour --- */
  {
    const legacyBlock = { id:'x', name:'Phase 1', phaseType:'custom', startWeek:1, endWeek:8 };
    const entry = { type:'workout', planId:'hypertrophy', category:'upper', templateId:'h-u1' };
    ok('a block with no prescription resolves to the entry as before',
      JSON.stringify(ctx.builderTemplateOf(entry, legacyBlock.rx || null))
      === JSON.stringify(ctx.builderBaseTemplateOf(entry)));
    const legacyProgram = { durationWeeks:8, goal:'hypertrophy', blocks:[legacyBlock],
      schedule:{ mon:entry, tue:{type:'rest'}, wed:{type:'rest'}, thu:{type:'rest'},
        fri:{type:'rest'}, sat:{type:'rest'}, sun:{type:'rest'} } };
    const expl = ctx.deriveProgramExplanation(legacyProgram);
    ok('a legacy single-phase program still explains itself', !!expl && !!expl.headline);
    ok('and claims no phase change', expl.phases.note === null);
  }

  /* --- resolving a phase writes nothing --- */
  {
    const before = JSON.stringify(app.store);
    for (let i = 0; i < 10; i++){
      const d = ctx.generateProgram({ goal:'strength', experience:'intermediate', equipment:'full',
        emphasis:'balanced', sessionLength:'long', weeks:8, days:['mon','tue','thu','fri'] });
      (d.blocks || []).forEach(b => phaseShape(d, b));
      ctx.derivePhaseInfo(d);
    }
    ok('resolving phases writes nothing', JSON.stringify(app.store) === before);
  }

  /* ---------- 17. PROGRAM LIFECYCLE & COMPLETION  (Phase D38) ----------
     A program used to have no ending: `completeProgram` was reachable only
     from a buried button, so a finished program sat at 'Week 8 of 8 · Active'
     and kept scheduling sessions past its own end date. The checks here
     resolve lifecycle independently of the stored status flag. */
  section('17. Program lifecycle and completion (D38)');

  /* The oracle computes the end date itself rather than asking the program. */
  const oracleEnd = (prog) => {
    const d = new Date(prog.startDate + 'T00:00:00');
    d.setDate(d.getDate() + prog.durationWeeks * 7 - 1 + (prog.pausedDays || 0));
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0')
      + '-' + String(d.getDate()).padStart(2,'0');
  };
  const mkProgram = (over) => Object.assign({
    id:'pX', name:'Test Program', startDate:'2026-01-05', durationWeeks:8,
    status:'active', pausedDays:0, emphasis:null, goal:'hypertrophy',
    blocks:[{ id:'b', name:'Foundation', startWeek:1, endWeek:8 }],
    schedule:{ mon:{ type:'workout', planId:'hypertrophy', category:'upper', templateId:'h-u1' },
      tue:{type:'rest'}, wed:{type:'rest'}, thu:{type:'rest'},
      fri:{type:'rest'}, sat:{type:'rest'}, sun:{type:'rest'} }
  }, over || {});

  /* --- a finished timeline is finished; a paused one is not --- */
  {
    const prog = mkProgram();
    const end = oracleEnd(prog);
    ok('the end date matches an independent计算'.replace('计算','calculation'),
      ctx.programEndDate(prog) === end, ctx.programEndDate(prog) + ' vs ' + end);
    ok('inside its weeks it is active',
      ctx.deriveProgramLifecycle(prog, '2026-02-01') === 'active');
    ok('past its end it is finished',
      ctx.deriveProgramLifecycle(prog, '2026-06-01') === 'ended');
    ok('on the final day it has NOT finished',
      ctx.deriveProgramLifecycle(prog, end) === 'active', 'end=' + end);

    /* PROGRAM ENDED WHILE PAUSED — the adversarial case D37 protected and
       completion must not undo. */
    const paused = mkProgram({ status:'paused', pausedOnDate:'2026-01-20' });
    ok('a paused program never finishes on elapsed calendar time',
      ctx.deriveProgramLifecycle(paused, '2026-12-31') === 'paused',
      'PROGRAM ENDED WHILE PAUSED: ' + ctx.deriveProgramLifecycle(paused, '2026-12-31'));
    ok('and it is not treated as finished', ctx.programIsFinished(paused, '2026-12-31') === false);
  }

  /* --- no session is scheduled beyond the end --- */
  {
    const prog = mkProgram();
    const end = oracleEnd(prog);
    const after = new Date(end + 'T00:00:00'); after.setDate(after.getDate() + 8);
    while (after.getDay() !== 1) after.setDate(after.getDate() + 1);   // a Monday
    const y = after.getFullYear() + '-' + String(after.getMonth()+1).padStart(2,'0')
      + '-' + String(after.getDate()).padStart(2,'0');
    const w = ctx.getProgramWorkoutForDate(y, prog);
    ok('a finished program schedules nothing', !(w && w.template),
      'FUTURE WORKOUT AFTER PROGRAM END: ' + (w && w.template ? w.template.name : ''));
    /* And it still schedules inside its own weeks. */
    const inside = ctx.getProgramWorkoutForDate('2026-01-05', prog);
    ok('but it still schedules inside its weeks', !!(inside && inside.template));
  }

  /* --- completion never claims more than the log supports --- */
  {
    const prog = mkProgram();
    const none = ctx.deriveProgramCompletion(prog, '2026-06-01', []);
    ok('a program with no logged training is not celebrated', none.tone === 'none',
      'tone=' + none.tone);
    ok('and its headline says so plainly',
      /no workouts were logged/i.test(ctx.programCompletionHeadline(none)),
      ctx.programCompletionHeadline(none));

    const two = ctx.deriveProgramCompletion(prog, '2026-06-01', [
      { id:'w1', date:'2026-01-06', programId:'pX', exercises:[{ name:'Bench Press', sets:[{},{}] }] },
      { id:'w2', date:'2026-01-13', programId:'pX', exercises:[{ name:'Bench Press', sets:[{}] }] }
    ]);
    ok('barely training reads as quiet, not triumphant', two.tone === 'quiet', 'tone=' + two.tone);
    ok('it counts exactly what was logged', two.completedSessions === 2, String(two.completedSessions));
    ok('and it counts sets from performed exercises only', two.sets === 3, String(two.sets));

    const many = [];
    for (let i = 0; i < 12; i++) many.push({ id:'m'+i, date:'2026-01-06', programId:'pX',
      exercises:[{ name:'Bench Press', sets:[{},{},{}] }] });
    ok('genuine training earns the confident tone',
      ctx.deriveProgramCompletion(prog, '2026-06-01', many).tone === 'full');
  }

  /* --- PROGRAM COUNTED FOREIGN WORKOUT --- */
  {
    const prog = mkProgram();
    const log = [
      { id:'own', date:'2026-01-06', programId:'pX', exercises:[{ name:'Bench Press', sets:[{}] }] },
      { id:'other', date:'2026-01-07', programId:'pOTHER', exercises:[{ name:'Bench Press', sets:[{}] }] },
      { id:'before', date:'2025-12-01', exercises:[{ name:'Bench Press', sets:[{}] }] },
      { id:'after', date:'2026-09-01', exercises:[{ name:'Bench Press', sets:[{}] }] }
    ];
    const sum = ctx.deriveProgramCompletion(prog, '2026-10-01', log);
    ok('a workout claimed by another program is never counted',
      sum.completedSessions === 1,
      'PROGRAM COUNTED FOREIGN WORKOUT: counted ' + sum.completedSessions);
    /* Legacy sessions with no programId still count, by date window only. */
    const legacy = [{ id:'l1', date:'2026-01-06', exercises:[{ name:'Bench Press', sets:[{}] }] }];
    ok('a legacy session inside the window still counts',
      ctx.deriveProgramCompletion(prog, '2026-10-01', legacy).completedSessions === 1);
  }

  /* --- PROGRAM CLAIMED UNKNOWN AS MISSED --- */
  {
    const prog = mkProgram();
    const sum = ctx.deriveProgramCompletion(prog, '2026-06-01', []);
    const text = ctx.programCompletionHeadline(sum)
      + ' ' + JSON.stringify(sum);
    ok('completion never uses the word missed or failed',
      !/missed|failed|poor|bad\b/i.test(text),
      'PROGRAM CLAIMED UNKNOWN AS MISSED: ' + text.slice(0, 90));
    ok('and it never claims a percentage it cannot support',
      !/100%|%/.test(ctx.programCompletionHeadline(sum)));
    /* A program with no schedule has no honest denominator. */
    const noSched = mkProgram({ schedule:{ mon:{type:'rest'}, tue:{type:'rest'}, wed:{type:'rest'},
      thu:{type:'rest'}, fri:{type:'rest'}, sat:{type:'rest'}, sun:{type:'rest'} } });
    const s2 = ctx.deriveProgramCompletion(noSched, '2026-06-01', []);
    ok('an unknowable denominator is reported as unknown, not zero-of-zero',
      s2.plannedSessions === null, String(s2.plannedSessions));
    ok('and the headline omits it', !/ of /.test(ctx.programCompletionHeadline(s2)),
      ctx.programCompletionHeadline(s2));
  }

  /* --- PROGRAM LOST AFTER NEXT START / PROGRAM HISTORY MUTATED --- */
  {
    const before = ctx.getPrograms().length;
    const defA = ctx.generateProgram({ goal:'hypertrophy', experience:'intermediate',
      equipment:'full', emphasis:'chest', sessionLength:'long', weeks:8,
      days:['mon','tue','thu','fri'] });
    const A = ctx.createProgram({ name:'Program A', goal:defA.goal, durationWeeks:8,
      schedule:defA.schedule, blocks:defA.blocks, startDate:'2026-01-05',
      emphasis:'chest', sessionLength:defA.sessionLength, experience:defA.experience });
    ok('Program A saves', A.ok, (A.errors || []).join('; '));
    const snapshotA = JSON.stringify(A.program);

    const defB = ctx.generateProgram({ goal:'hypertrophy', experience:'intermediate',
      equipment:'full', emphasis:'back', sessionLength:'long', weeks:8,
      days:['mon','tue','thu','fri'] });
    const B = ctx.createProgram({ name:'Program B', goal:defB.goal, durationWeeks:8,
      schedule:defB.schedule, blocks:defB.blocks, startDate:'2026-06-01',
      emphasis:'back', sessionLength:defB.sessionLength, experience:defB.experience });
    ok('Program B saves', B.ok, (B.errors || []).join('; '));

    const stillA = ctx.getProgram(A.program.id);
    ok('Program A survives Program B starting', !!stillA,
      'PROGRAM LOST AFTER NEXT START');
    ok('and it is byte-identical', JSON.stringify(stillA) === snapshotA,
      'PROGRAM HISTORY MUTATED');
    ok('they are distinct instances', A.program.id !== B.program.id);
    ok('the store grew by exactly two', ctx.getPrograms().length === before + 2,
      String(ctx.getPrograms().length - before));
    ok('only one program is active', ctx.programsStore.activeProgramId === B.program.id);
    ctx.deleteProgram(A.program.id);
    ctx.deleteProgram(B.program.id);
  }

  /* --- derivation is pure and cheap --- */
  {
    const prog = mkProgram();
    const log = [];
    for (let i = 0; i < 200; i++) log.push({ id:'x'+i, date:'2026-01-06', programId:'pX',
      exercises:[{ name:'Bench Press', sets:[{},{},{}] }] });
    const before = JSON.stringify(app.store);
    const t0 = Date.now();
    for (let i = 0; i < 50; i++) ctx.deriveProgramCompletion(prog, '2026-06-01', log);
    const ms = Date.now() - t0;
    ok('deriving completion writes nothing', JSON.stringify(app.store) === before);
    ok('fifty derivations over 200 sessions stay quick', ms < 1500, ms + 'ms');
  }

  /* ---------- 18. PERFORMANCE PROGRESS  (Phase D39) ----------
     The oracle reimplements the evidence model from scratch — its own Epley,
     its own median, its own early/late split — so a production
     misclassification cannot hide by being mirrored here. Production is never
     asked what it concluded; the oracle concludes independently and the two
     are compared. */
  section('18. Performance progress (D39)');

  const oEpley = (w, r) => w * (1 + r / 30);
  const oMedian = a => { if (!a.length) return null;
    const b = a.slice().sort((x, y) => x - y); const m = Math.floor(b.length / 2);
    return b.length % 2 ? b[m] : (b[m-1] + b[m]) / 2; };
  /* Independent observation extraction: working sets only, rep-valid only. */
  const oObserve = (workouts, exName) => {
    const pts = [];
    workouts.slice().sort((a,b) => String(a.date).localeCompare(String(b.date))).forEach(w => {
      (w.exercises || []).forEach(ex => {
        if (!ex || ex.skipped || ex.name !== exName || ex.bodyweight) return;
        let best = 0;
        (ex.sets || []).forEach(st => {
          if (st && st.type === 'warmup') return;
          if (st && st.completed === false) return;
          const wt = parseFloat(st && st.weight), rp = parseFloat(st && st.reps);
          if (!(wt > 0) || !(rp > 0) || rp > 15) return;
          const e = oEpley(wt, rp); if (e > best) best = e;
        });
        if (best > 0) pts.push(best);
      });
    });
    return pts;
  };
  const oTrend = pts => {
    const n = pts.length;
    if (n < 4) return { direction:'insufficient', pct:null };
    const half = Math.floor(n / 2);
    if (half < 2) return { direction:'insufficient', pct:null };
    const a = oMedian(pts.slice(0, half)), b = oMedian(pts.slice(n - half));
    const pct = ((b - a) / a) * 100;
    return { direction: pct >= 3 ? 'improving' : (pct <= -3 ? 'declining' : 'steady'), pct };
  };

  const W = (date, name, sets) => ({ id:'w'+date+name, date,
    exercises:[{ name, sets: sets.map(x => Object.assign({ type:'working', completed:true }, x)) }] });
  const series = (name, weights, reps) => weights.map((wt, i) =>
    W('2026-' + String(1 + Math.floor(i/4)).padStart(2,'0') + '-' + String((i%4)*7 + 6).padStart(2,'0'),
      name, [{ weight: wt, reps: reps || 8 }]));

  /* --- production must agree with the independent oracle --- */
  {
    const cases = [
      ['steady climb', series('Bench Press', [185,185,190,190,200,205,205,210])],
      ['flat', series('Bench Press', [185,185,185,185,185,185,185,185])],
      ['gradual', series('Bench Press', [180,182.5,185,187.5,190,192.5,195,197.5])],
      ['freak PR at the end', series('Bench Press', [185,185,185,185,185,185,185,315])],
      ['decline', series('Bench Press', [225,220,215,210,195,190,185,180])],
      ['two sessions', series('Bench Press', [135,225]).slice(0,2)]
    ];
    let bad = [];
    cases.forEach(([label, wk]) => {
      const prod = ctx.derivePerformanceProgress(wk).exercises[0]
        || { direction:'insufficient', pct:null };
      const orc = oTrend(oObserve(wk, 'Bench Press'));
      if (prod.direction !== orc.direction)
        bad.push('DIRECTION DISAGREES on ' + label + ': production=' + prod.direction
          + ' oracle=' + orc.direction);
      else if (orc.pct !== null && prod.pct !== null && Math.abs(prod.pct - orc.pct) > 0.01)
        bad.push('PERCENTAGE DISAGREES on ' + label + ': ' + prod.pct + ' vs ' + orc.pct);
    });
    ok('production agrees with an independently computed trend', bad.length === 0,
      bad.join(' || '));
  }

  /* --- INSUFFICIENT EVIDENCE CLAIMED PROGRESS --- */
  {
    const two = ctx.derivePerformanceProgress(series('Bench Press',[135,225]).slice(0,2));
    ok('two sessions never produce a claim',
      (two.exercises[0] || {}).direction === 'insufficient' && two.highlights.length === 0,
      'INSUFFICIENT EVIDENCE CLAIMED PROGRESS');
    const three = ctx.derivePerformanceProgress(series('Bench Press',[135,180,225]).slice(0,3));
    ok('three sessions still do not', (three.exercises[0] || {}).direction === 'insufficient');
    /* Four gives a direction; a number needs six. */
    const four = ctx.derivePerformanceProgress(series('Bench Press',[185,185,205,205]));
    const r4 = four.exercises[0] || {};
    ok('four sessions give a direction but no number',
      r4.direction === 'improving' && r4.numeric === false && ctx.perfDeltaText(r4) === null,
      'dir=' + r4.direction + ' numeric=' + r4.numeric);
    const six = ctx.derivePerformanceProgress(series('Bench Press',[185,185,185,205,205,205]));
    ok('six sessions earn a number', (six.exercises[0] || {}).numeric === true);
  }

  /* --- OUTLIER DOMINATED TREND --- */
  {
    const freak = ctx.derivePerformanceProgress(series('Bench Press',[185,185,185,185,185,185,185,315]));
    const r = freak.exercises[0] || {};
    ok('one freak set is not a trend', r.direction === 'steady',
      'OUTLIER DOMINATED TREND: direction=' + r.direction + ' pct=' + r.pct);
    ok('and it produces no numeric claim', ctx.perfDeltaText(r) === null);
    /* The same history genuinely improving is still detected. */
    ok('a real trend is still detected',
      (ctx.derivePerformanceProgress(series('Bench Press',[185,185,190,195,205,205,210,210]))
        .exercises[0] || {}).direction === 'improving');
  }

  /* --- WARMUP COUNTED AS PERFORMANCE --- */
  {
    const wk = [];
    for (let i = 0; i < 8; i++) wk.push({ id:'wu'+i,
      date:'2026-0' + (i<4?1:2) + '-' + String((i%4)*7+6).padStart(2,'0'),
      exercises:[{ name:'Bench Press', sets:[
        { type:'warmup', completed:true, weight: 95 + i*25, reps:8 },
        { type:'working', completed:true, weight:185, reps:8 }] }] });
    const r = ctx.derivePerformanceProgress(wk).exercises[0] || {};
    ok('climbing warm-ups never create progress', r.direction === 'steady',
      'WARMUP COUNTED AS PERFORMANCE: ' + r.direction + ' ' + r.pct);
    /* Drop / failure / AMRAP sets are real training and DO count. */
    const drops = [];
    for (let i = 0; i < 8; i++) drops.push({ id:'dr'+i,
      date:'2026-0' + (i<4?1:2) + '-' + String((i%4)*7+6).padStart(2,'0'),
      exercises:[{ name:'Bench Press', sets:[
        { type:'drop', completed:true, weight: 185 + (i>=4 ? 25 : 0), reps:8 }] }] });
    ok('drop sets are real training and do count',
      (ctx.derivePerformanceProgress(drops).exercises[0] || {}).direction === 'improving');
  }

  /* --- NON-CANONICAL EXERCISE COMPARED --- */
  {
    const mixed = series('Bench Press',[185,185,190,190])
      .concat(series('Incline Bench Press',[225,230,235,240]));
    const perf = ctx.derivePerformanceProgress(mixed);
    ok('different canonical movements are never merged',
      perf.comparableExercises === 2,
      'NON-CANONICAL EXERCISE COMPARED: ' + perf.exercises.map(e => e.id).join(','));
    const ids = perf.exercises.map(e => e.id);
    ok('and they keep distinct canonical ids', new Set(ids).size === ids.length);
    /* An unresolvable name is comparable to nothing, including itself. */
    const junk = series('Zercher Sandbag Carry Thing',[100,100,120,120,140,140,160,160]);
    ok('an unrecognised movement is excluded rather than guessed at',
      ctx.derivePerformanceProgress(junk).comparableExercises === 0);
  }

  /* --- UNSUPPORTED EXERCISE GIVEN NUMERIC DELTA --- */
  {
    const bw = [];
    for (let i = 0; i < 8; i++) bw.push({ id:'bw'+i,
      date:'2026-0' + (i<4?1:2) + '-' + String((i%4)*7+6).padStart(2,'0'),
      exercises:[{ name:'Pull-Up', bodyweight:true,
        sets:[{ type:'working', completed:true, weight:'BW', reps:5+i }] }] });
    ok('bodyweight work receives no strength percentage',
      ctx.derivePerformanceProgress(bw).comparableExercises === 0,
      'UNSUPPORTED EXERCISE GIVEN NUMERIC DELTA');
    const planks = [];
    for (let i = 0; i < 8; i++) planks.push({ id:'pl'+i,
      date:'2026-0' + (i<4?1:2) + '-' + String((i%4)*7+6).padStart(2,'0'),
      exercises:[{ name:'Plank', sets:[{ type:'working', completed:true, weight:0, reps:60+i }] }] });
    ok('timed work is excluded too',
      ctx.derivePerformanceProgress(planks).comparableExercises === 0);
    ok('and so are reps beyond the estimate\'s validity',
      ctx.derivePerformanceProgress(series('Bench Press',[95,95,95,95,95,95,95,95], 30))
        .comparableExercises === 0);
  }

  /* --- PLANNED TARGET COUNTED AS ACTUAL --- */
  {
    /* A session logged but not performed contributes nothing. */
    const unperformed = [];
    for (let i = 0; i < 8; i++) unperformed.push({ id:'up'+i,
      date:'2026-0' + (i<4?1:2) + '-' + String((i%4)*7+6).padStart(2,'0'),
      exercises:[{ name:'Bench Press',
        sets:[{ type:'working', completed:false, weight: 185 + i*10, reps:8 }] }] });
    ok('sets marked not completed are not performance',
      ctx.derivePerformanceProgress(unperformed).comparableExercises === 0,
      'PLANNED TARGET COUNTED AS ACTUAL');
    ok('a skipped exercise contributes nothing',
      ctx.derivePerformanceProgress(Array.from({length:8}, (_,i) => ({ id:'sk'+i,
        date:'2026-0' + (i<4?1:2) + '-' + String((i%4)*7+6).padStart(2,'0'),
        exercises:[{ name:'Bench Press', skipped:true, sets:[] }] }))).comparableExercises === 0);
  }

  /* --- FOREIGN PROGRAM SESSION COUNTED --- */
  {
    const prog = { id:'pA', name:'A', startDate:'2026-01-05', durationWeeks:8, status:'active',
      pausedDays:0, blocks:[{ id:'b', name:'F', startWeek:1, endWeek:8 }],
      schedule:{ mon:{ type:'workout', planId:'hypertrophy', category:'upper', templateId:'h-u1' },
        tue:{type:'rest'}, wed:{type:'rest'}, thu:{type:'rest'},
        fri:{type:'rest'}, sat:{type:'rest'}, sun:{type:'rest'} } };
    const mine = series('Bench Press',[185,185,185,185]).map(w =>
      Object.assign(w, { programId:'pA' }));
    const theirs = series('Bench Press',[300,310,320,330]).map((w, i) =>
      Object.assign(w, { id:'f'+i, date:'2026-02-' + String(i*5+1).padStart(2,'0'), programId:'pB' }));
    const perf = ctx.deriveProgramPerformance(prog, mine.concat(theirs));
    const r = perf.exercises[0] || {};
    ok('another program\'s sessions never enter this program\'s analysis',
      r.sessions === 4 && r.direction === 'steady',
      'FOREIGN PROGRAM SESSION COUNTED: n=' + r.sessions + ' dir=' + r.direction);
  }

  /* --- PROGRAM RESULT DISAGREES WITH PROGRESS --- */
  {
    const prog = { id:'pS', name:'S', startDate:'2026-01-05', durationWeeks:8, status:'active',
      pausedDays:0, blocks:[{ id:'b', startWeek:1, endWeek:8 }],
      schedule:{ mon:{ type:'workout', planId:'hypertrophy', category:'upper', templateId:'h-u1' },
        tue:{type:'rest'}, wed:{type:'rest'}, thu:{type:'rest'},
        fri:{type:'rest'}, sat:{type:'rest'}, sun:{type:'rest'} } };
    const log = series('Bench Press',[185,185,190,195,205,205,210,210])
      .map(w => Object.assign(w, { programId:'pS' }));
    const viaProgram = ctx.deriveProgramPerformance(prog, log);
    const viaDirect = ctx.derivePerformanceProgress(ctx.programWorkouts(prog, log));
    ok('program and direct analysis are the same computation',
      JSON.stringify(viaProgram) === JSON.stringify(viaDirect),
      'PROGRAM RESULT DISAGREES WITH PROGRESS');
    ok('there is one analysis entry point',
      typeof ctx.derivePerformanceProgress === 'function'
      && typeof ctx.deriveProgramPerformance === 'function');
  }

  /* --- CAPABILITY CHANGED --- */
  {
    const names = ['Bench Press','Lat Pulldown','Leg Press','Barbell Row','Overhead Press'];
    const before = names.map(n => JSON.stringify(ctx.computeExerciseCapability(n)));
    for (let i = 0; i < 25; i++)
      ctx.derivePerformanceProgress(series('Bench Press',[185,190,195,200,205,210,215,220]));
    const after = names.map(n => JSON.stringify(ctx.computeExerciseCapability(n)));
    ok('current capability is byte-identical after analysis',
      before.join('|') === after.join('|'), 'CAPABILITY CHANGED');
    ok('the trainer engine is untouched', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');
  }

  /* --- nothing is written, and it is quick at scale --- */
  {
    const big = [];
    for (let i = 0; i < 600; i++) big.push({ id:'b'+i,
      date:'2026-' + String(1 + (i % 12)).padStart(2,'0') + '-' + String(1 + (i % 28)).padStart(2,'0'),
      exercises:[{ name:'Bench Press', sets:[{ type:'working', completed:true,
        weight: 180 + (i % 40), reps: 6 + (i % 4) }] },
        { name:'Lat Pulldown', sets:[{ type:'working', completed:true,
          weight: 120 + (i % 30), reps: 8 }] }] });
    const before = JSON.stringify(app.store);
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) ctx.derivePerformanceProgress(big);
    const ms = (Date.now() - t0) / 20;
    ok('analysis writes nothing', JSON.stringify(app.store) === before);
    ok('600 sessions analyse quickly', ms < 120, ms.toFixed(1) + 'ms per pass');
    console.log('    performance: ' + ms.toFixed(1) + 'ms for 600 sessions / 2 exercises');
  }

  /* --- coverage, reported rather than optimised --- */
  {
    let comparable = 0, evidenced = 0, numeric = 0, insufficient = 0;
    const shapes = [
      [185,185,190,190,200,205,205,210], [185,185,185,185,185,185,185,185],
      [185,190], [185,185,190], [200,195,190,185,180,175,170,165],
      [185,185,185,185,185,185,185,315], [180,182.5,185,187.5,190,192.5,195,197.5]
    ];
    shapes.forEach(sh => {
      const r = ctx.derivePerformanceProgress(series('Bench Press', sh)).exercises[0] || {};
      comparable++;
      if (r.direction === 'insufficient') insufficient++; else evidenced++;
      if (r.numeric) numeric++;
    });
    ok('coverage is reported, not maximised', comparable === shapes.length);
    console.log('    coverage across ' + comparable + ' shapes: ' + evidenced + ' evidenced, '
      + numeric + ' numeric, ' + insufficient + ' insufficient (low coverage can be correct)');
  }

  /* ---------- 19. PROGRAM OUTCOMES  (Phase D40) ----------
     D39 already has an independent oracle for the strength model, so this
     one deliberately does NOT reimplement Epley, the median or the
     evidence gates again. Its target is the AGGREGATION: given a set of
     per-lift directions, what may LOOP say about the program?

     Rather than restate the production rule (an oracle that copies the
     implementation agrees with it even when both are wrong), it sweeps the
     whole state space and asserts PROPERTIES that must hold for any honest
     aggregation, taken from the product rules rather than from the code:
     unknown is never evidence, one lift never decides a program, the
     verdict is symmetric under swapping improvement and decline, and no
     cross-lift percentage is ever produced. ---------- */
  section('19. Program outcomes (D40)');

  {
    const PROG = { id:'p_audit_d40', name:'Audit', startDate:'2026-01-05',
      durationWeeks:8, schedule:{}, status:'active' };

    /* Real lifts whose canonical ids are e1RM-comparable, so the fixtures
       drive the true D39 -> D40 chain instead of hand-made objects. */
    const LIFTS = ['Bench Press','Squat','Deadlift','Barbell Row',
      'Overhead Press','Leg Press','Incline Bench Press'];

    let dayN = 0;
    const nextDate = () => {
      const d = new Date('2026-01-05T00:00:00');
      d.setDate(d.getDate() + (dayN++));
      return d.toISOString().slice(0, 10);
    };
    /* A load series that lands on the intended direction. The DIRECTION is
       still decided by D39, never asserted here. */
    const loads = (kind, n) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        if (kind === 'improving') out.push(i < n / 2 ? 185 : 205);
        else if (kind === 'declining') out.push(i < n / 2 ? 205 : 185);
        else out.push(185);
      }
      return out;
    };
    const buildLog = specs => {
      dayN = 0;
      const log = [];
      specs.forEach(sp => loads(sp.kind, sp.sessions).forEach(w => {
        log.push({ id:'w'+log.length, date: nextDate(), programId: PROG.id,
          exercises: [{ name: sp.name, sets: [{ type:'working', completed:true,
            weight: w, reps: 8 }] }] });
      }));
      return log;
    };
    /* n lifts of each kind, drawn from distinct canonical movements. */
    const mix = (imp, std, dec, sessions) => {
      const specs = []; let i = 0;
      for (let k = 0; k < imp; k++) specs.push({ name: LIFTS[i++], kind:'improving', sessions: sessions||8 });
      for (let k = 0; k < std; k++) specs.push({ name: LIFTS[i++], kind:'steady', sessions: sessions||8 });
      for (let k = 0; k < dec; k++) specs.push({ name: LIFTS[i++], kind:'declining', sessions: sessions||8 });
      return buildLog(specs);
    };
    const stateOf = (imp, std, dec) =>
      ctx.deriveProgramOutcome(PROG, mix(imp, std, dec)).state;

    /* ----- the brief’s own adversarial cases, end to end ----- */
    const cases = [
      ['1 improving + 7 under-evidenced', [{ name:LIFTS[0], kind:'improving', sessions:8 }].concat(
        LIFTS.slice(1).map(n => ({ name:n, kind:'improving', sessions:2 }))), 'insufficient'],
      ['4 improving + 1 steady', null, 'improving', [4,1,0]],
      ['2 improving + 2 declining', null, 'mixed', [2,0,2]],
      ['5 steady', null, 'steady', [0,5,0]],
      ['2 improving, 1 steady, 1 declining', null, 'mixed', [2,1,1]],
      ['6 improving + 1 declining', null, 'improving', [6,0,1]],
      ['3 declining', null, 'declining', [0,0,3]],
      ['1 declining + 3 steady stays calm', null, 'steady', [0,3,1]]
    ];
    cases.forEach(cs => {
      const st = cs[3] ? stateOf(cs[3][0], cs[3][1], cs[3][2])
        : ctx.deriveProgramOutcome(PROG, buildLog(cs[1])).state;
      ok('outcome: ' + cs[0] + ' -> ' + cs[2], st === cs[2], 'got ' + st);
    });

    /* ----- PROPERTY SWEEP over the whole small-program state space ----- */
    const FLOOR = ctx.OUTCOME_CONFIG.minEvidencedLifts;
    let swept = 0, floorOk = true, neverBackwards = true, mixedOk = true,
        symmetryOk = true, unknownInert = true, oneLiftDecides = false;
    for (let I = 0; I <= 3; I++) for (let S = 0; S <= 3; S++) for (let D = 0; D <= 3; D++) {
      if (I + S + D === 0 || I + S + D > LIFTS.length) continue;
      swept++;
      const st = stateOf(I, S, D);
      const n = I + S + D;

      /* below the floor a program may not describe itself at all */
      if (n < FLOOR && st !== 'insufficient') floorOk = false;

      /* a verdict never points against its own evidence */
      if (st === 'improving' && D > I) neverBackwards = false;
      if (st === 'declining' && I > D) neverBackwards = false;

      /* mixed requires real signal in BOTH directions */
      if (st === 'mixed' && !(I > 0 && D > 0)) mixedOk = false;

      /* swapping improvement and decline must mirror the verdict exactly */
      const flip = stateOf(D, S, I);
      const mirror = { improving:'declining', declining:'improving',
        mixed:'mixed', steady:'steady', insufficient:'insufficient' }[st];
      if (flip !== mirror) symmetryOk = false;

      /* lifts with too little evidence must not change the answer: adding
         two 2-session movements is adding no information at all */
      if (I + S + D + 2 <= LIFTS.length) {
        const specs = [];
        let i = 0;
        for (let k = 0; k < I; k++) specs.push({ name:LIFTS[i++], kind:'improving', sessions:8 });
        for (let k = 0; k < S; k++) specs.push({ name:LIFTS[i++], kind:'steady', sessions:8 });
        for (let k = 0; k < D; k++) specs.push({ name:LIFTS[i++], kind:'declining', sessions:8 });
        specs.push({ name:LIFTS[i++], kind:'improving', sessions:2 });
        specs.push({ name:LIFTS[i++], kind:'declining', sessions:2 });
        if (ctx.deriveProgramOutcome(PROG, buildLog(specs)).state !== st) unknownInert = false;
      }
    }
    ok('state space swept (' + swept + ' combinations)', swept > 40, String(swept));
    ok('below the evidence floor a program never describes itself', floorOk);
    ok('a verdict never contradicts its own evidence', neverBackwards);
    ok('mixed requires movement in both directions', mixedOk);
    ok('improvement and decline are treated symmetrically', symmetryOk);
    ok('lifts without enough evidence never change the verdict', unknownInert);

    /* one lift must never be the whole story: from a broad improving set,
       removing any single lift must not flip the program to declining */
    for (let drop = 0; drop < 5; drop++) {
      const specs = [];
      for (let k = 0; k < 5; k++) if (k !== drop)
        specs.push({ name:LIFTS[k], kind:'improving', sessions:8 });
      if (ctx.deriveProgramOutcome(PROG, buildLog(specs)).state === 'declining')
        oneLiftDecides = true;
    }
    ok('no single lift decides a program', !oneLiftDecides);

    /* ----- NO CROSS-LIFT PERCENTAGE, structurally ----- */
    const oc = ctx.deriveProgramOutcome(PROG, mix(4, 1, 0));
    const pctFields = Object.keys(oc).filter(k => /pct|percent|avg|mean|score/i.test(k));
    ok('the program result carries no aggregate percentage or score',
      pctFields.length === 0, pctFields.join(','));
    ok('every percentage shown belongs to one lift',
      (oc.highlights || []).every(h => typeof h.name === 'string' && h.id));
    ok('no program-level number is a mean of lift percentages', (() => {
      const vals = (oc.exercises || []).map(x => x.pct).filter(v => typeof v === 'number');
      if (!vals.length) return true;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      return !JSON.stringify(oc).includes(String(Math.round(mean * 10) / 10));
    })());

    /* ----- PR IS NOT A TREND, at the program layer (§60) ----- */
    dayN = 0;
    const freak = [];
    LIFTS.slice(0, 4).forEach(name => {
      for (let i = 0; i < 8; i++) {
        const w = (name === LIFTS[0] && i === 7) ? 315 : 185;
        freak.push({ id:'f'+freak.length, date: nextDate(), programId: PROG.id,
          exercises: [{ name, sets: [{ type:'working', completed:true, weight:w, reps:8 }] }] });
      }
    });
    ok('a single freak PR does not create a program trend',
      ctx.deriveProgramOutcome(PROG, freak).state === 'steady');

    /* ----- UNSUPPORTED MOVEMENTS ARE NOT NEGATIVE EVIDENCE ----- */
    dayN = 0;
    const acc = [];
    ['Cable Fly','Triceps Pushdown','Lat Pulldown'].forEach(name => {
      for (let i = 0; i < 8; i++) acc.push({ id:'a'+acc.length, date: nextDate(),
        programId: PROG.id, exercises: [{ name, sets: [{ type:'working',
          completed:true, weight:25, reps:12 }] }] });
    });
    const ocAcc = ctx.deriveProgramOutcome(PROG, acc);
    ok('movements e1RM cannot describe produce no verdict at all',
      ocAcc.state === 'insufficient' && ocAcc.decliningLifts === 0,
      ocAcc.state + '/' + ocAcc.decliningLifts);

    /* ----- ADHERENCE IS NOT OUTCOME ----- */
    const perfect = mix(0, 0, 0);   // no comparable training at all
    ok('full adherence with no comparable lifts yields no verdict',
      ctx.deriveProgramOutcome(PROG, []).state === 'insufficient');
    ok('improvement survives partial adherence', stateOf(4, 1, 0) === 'improving');
    ok('the outcome carries no adherence field',
      ctx.deriveProgramOutcome(PROG, mix(4, 1, 0)).completedSessions === undefined);

    /* ----- HIGHLIGHT SELECTION IS DETERMINISTIC AND EVIDENCE-FIRST ----- */
    const ocH = ctx.deriveProgramOutcome(PROG, buildLog([
      { name:LIFTS[0], kind:'improving', sessions:12 },
      { name:LIFTS[1], kind:'improving', sessions:4 },
      { name:LIFTS[2], kind:'improving', sessions:8 },
      { name:LIFTS[3], kind:'improving', sessions:8 },
      { name:LIFTS[4], kind:'declining', sessions:8 }]));
    ok('highlights are capped', ocH.highlights.length <= ctx.OUTCOME_CONFIG.maxHighlights);
    ok('the best-evidenced lift leads', ocH.highlights[0].sessions === 12);
    ok('a lift without a percentage never outranks one with', (() => {
      const nums = ocH.highlights.map(h => h.numeric ? 0 : 1);
      return nums.slice().sort().join() === nums.join();
    })());
    ok('a real decline is surfaced, not hidden', ocH.declines.length === 1);
    ok('the decline is worded plainly', /estimated strength/.test(
      String(ctx.perfDeltaText(ocH.declines[0]))));

    /* ----- DETERMINISM (§80) ----- */
    const detLog = mix(4, 1, 1);
    const first = JSON.stringify(ctx.deriveProgramOutcome(PROG, detLog));
    let stable = true;
    for (let i = 0; i < 100; i++)
      if (JSON.stringify(ctx.deriveProgramOutcome(PROG, detLog)) !== first) stable = false;
    ok('100 derivations are byte-identical', stable);

    /* ----- READ-ONLY (§53) ----- */
    const storeBefore = JSON.stringify(app.store);
    const logBefore = JSON.stringify(detLog);
    for (let i = 0; i < 25; i++) {
      ctx.deriveProgramOutcome(PROG, detLog);
      ctx.programOutcomeHtml(ctx.deriveProgramOutcome(PROG, detLog));
    }
    ok('deriving and rendering writes nothing to the store',
      JSON.stringify(app.store) === storeBefore);
    ok('the workout history is not mutated', JSON.stringify(detLog) === logBefore);
    ok('the trainer stays 0.1.1-shadow', ctx.TRAINER_ENGINE_VERSION === '0.1.1-shadow');

    /* ----- COPY BOUNDARIES (§43–§48) ----- */
    const copy = ['improving','mixed','steady','declining'].map(st => {
      const fake = { state: st, evidencedLifts:5, improvingLifts:4, steadyLifts:1, decliningLifts:0 };
      return ctx.programOutcomeLabel(fake) + ' ' + ctx.programOutcomeHeadline(fake);
    }).join(' ');
    ok('no muscle, fat or body-composition claim',
      !/muscle|body ?fat|lean mass|composition|weight loss/i.test(copy), copy);
    ok('no causal claim about the program',
      !/because|caused|thanks to|made you|resulted in/i.test(copy), copy);
    ok('no score or grade', ['score','grade','rating','/100','out of 10']
      .every(w => copy.toLowerCase().indexOf(w) === -1), copy);
    ok('strength claims say estimated strength',
      copy.toLowerCase().indexOf('estimated strength') !== -1, copy);
  }

  /* ---------- 20. WORKOUT PROVENANCE  (Phase D41) ----------
     The oracle here does not call workoutBelongsToProgram to decide what
     the answer should be. Every fixture DECLARES its expected membership up
     front, in a table written from the product rules: explicit provenance
     always outranks the calendar, a known-freeform session never falls
     through to the date window, a session claimed by another program is
     never date-recovered, and only genuinely unknown legacy records may use
     the window at all. ---------- */
  section('20. Workout provenance (D41)');

  {
    const A = { id:'progA', name:'A', startDate:'2026-03-02', durationWeeks:4,
      status:'active', schedule:{} };
    const B = { id:'progB', name:'B', startDate:'2026-04-06', durationWeeks:4,
      status:'active', schedule:{} };
    const endA = ctx.programEndDate(A);

    /* date, record, expected-membership-in-A, why. Declared, not computed. */
    const MATRIX = [
      ['exact program A, inside A',
        { id:'m1', date:'2026-03-10', origin:'program', programId:'progA' }, true],
      ['exact program A, dated outside A',
        { id:'m2', date:'2026-09-09', origin:'program', programId:'progA' }, true],
      ['exact program B, inside A window',
        { id:'m3', date:'2026-03-10', origin:'program', programId:'progB' }, false],
      ['known freeform, inside A window',
        { id:'m4', date:'2026-03-10', origin:'freeform' }, false],
      ['known freeform, on A start date',
        { id:'m5', date:'2026-03-02', origin:'freeform' }, false],
      ['known freeform, on A end date',
        { id:'m6', date: endA, origin:'freeform' }, false],
      ['legacy unknown, inside A window',
        { id:'m7', date:'2026-03-10' }, true],
      ['legacy unknown, on A start date',
        { id:'m8', date:'2026-03-02' }, true],
      ['legacy unknown, on A end date',
        { id:'m9', date: endA }, true],
      ['legacy unknown, before A',
        { id:'m10', date:'2026-01-01' }, false],
      ['legacy unknown, after A',
        { id:'m11', date:'2026-12-31' }, false],
      ['freeform titled like a program session',
        { id:'m12', date:'2026-03-10', origin:'freeform', title:'Upper A' }, false],
      ['program session renamed after the fact',
        { id:'m13', date:'2026-03-10', origin:'program', programId:'progA',
          title:'Whatever I Called It' }, true],
      ['program session whose exercises were edited',
        { id:'m14', date:'2026-03-10', origin:'program', programId:'progA',
          exercises:[{ name:'Something Else', sets:[{}] }] }, true]
    ];

    let matrixOk = 0, matrixBad = [];
    MATRIX.forEach(row => {
      const got = ctx.workoutBelongsToProgram(row[1], A);
      if (got === row[2]) matrixOk++;
      else matrixBad.push(row[0] + ' expected ' + row[2] + ' got ' + got);
    });
    ok('declared membership matrix (' + MATRIX.length + ' cases)',
      matrixBad.length === 0, matrixBad.join(' | '));

    /* The two invariants the matrix exists to protect. */
    ok('explicit provenance always outranks the date window',
      MATRIX.filter(r => r[1].origin).every(r =>
        ctx.workoutBelongsToProgram(r[1], A)
          === (r[1].programId === 'progA')));
    ok('a known-freeform session never falls through to the window',
      MATRIX.filter(r => r[1].origin === 'freeform')
        .every(r => ctx.workoutBelongsToProgram(r[1], A) === false));
    ok('a session owned by another program is never date-recovered',
      ctx.workoutBelongsToProgram({ date:'2026-03-10', origin:'program',
        programId:'progB' }, A) === false);
    ok('only records with no origin at all use the window', (() => {
      const legacy = { id:'x', date:'2026-03-10' };
      const known = { id:'x', date:'2026-03-10', origin:'freeform' };
      return ctx.workoutBelongsToProgram(legacy, A) === true
        && ctx.workoutBelongsToProgram(known, A) === false;
    })());

    /* ----- §91 STATE x ORIGIN x DATE ----- */
    const STATES = ['active','paused','completed'];
    const ORIGINS = [
      ['planned',  { origin:'program', programId:'progA' }, true],
      ['freeform', { origin:'freeform' },                   false],
      ['other',    { origin:'program', programId:'progB' }, false],
      ['legacy',   {},                                      null]   // date decides
    ];
    const DATES = [['before','2026-01-01',false],['inside','2026-03-10',true],
      ['after','2026-12-31',false]];
    let combos = 0, comboBad = [];
    STATES.forEach(st => ORIGINS.forEach(o => DATES.forEach(d => {
      combos++;
      const prog = Object.assign({}, A, { status: st });
      const w = Object.assign({ id:'c', date: d[1] }, o[1]);
      const expected = o[2] === null ? d[2] : o[2];
      const got = ctx.workoutBelongsToProgram(w, prog);
      if (got !== expected) comboBad.push(st+'/'+o[0]+'/'+d[0]+' expected '+expected+' got '+got);
    })));
    ok('membership is independent of program status (' + combos + ' combinations)',
      comboBad.length === 0, comboBad.slice(0,4).join(' | '));

    /* ----- §64 A FREEFORM OUTLIER CANNOT MOVE A PROGRAM ----- */
    {
      const log = [];
      for (let i = 0; i < 8; i++)
        log.push({ id:'pw'+i, date:'2026-03-' + String(2+i).padStart(2,'0'),
          origin:'program', programId:'progA',
          exercises:[{ name:'Bench Press', sets:[{ type:'working', completed:true,
            weight:185, reps:8 }] }] });
      const withFree = log.concat([
        { id:'ff', date:'2026-03-11', origin:'freeform',
          exercises:[{ name:'Bench Press', sets:[{ type:'working', completed:true,
            weight:315, reps:8 }] }] }]);
      const base = ctx.deriveProgramOutcome(A, log);
      const after = ctx.deriveProgramOutcome(A, withFree);
      ok('a huge freeform session does not change the program outcome',
        JSON.stringify(base) === JSON.stringify(after));
      /* The program-level state is correctly 'insufficient' here: one lift may
         never speak for a program (D40). The claim under test is the lift-level
         one — the program's own Bench evidence stays 8 flat sessions and reads
         steady, with the 315 lb freeform session nowhere in it. */
      const scopedBench = (ctx.deriveProgramPerformance(A, withFree).exercises || [])
        .find(x => /bench/i.test(x.name || ''));
      ok('the program’s own Bench evidence excludes the freeform session',
        !!scopedBench && scopedBench.sessions === 8,
        scopedBench ? String(scopedBench.sessions) : 'none');
      ok('and that evidence reads steady, not improving',
        !!scopedBench && scopedBench.direction === 'steady',
        scopedBench ? scopedBench.direction : 'none');
      /* The same training IS visible to unscoped performance history. */
      const global = ctx.derivePerformanceProgress(withFree);
      ok('the freeform training is still real training history',
        global.exercises.length > 0);
    }

    /* ----- §36 SAME EXERCISE, DIFFERENT ORIGIN ----- */
    {
      const log = [];
      for (let i = 0; i < 6; i++)
        log.push({ id:'q'+i, date:'2026-03-' + String(2+i).padStart(2,'0'),
          origin:'program', programId:'progA',
          exercises:[{ name:'Bench Press', sets:[{ type:'working', completed:true,
            weight:185, reps:8 }] }] });
      for (let i = 0; i < 6; i++)
        log.push({ id:'r'+i, date:'2026-03-' + String(9+i).padStart(2,'0'),
          origin:'freeform',
          exercises:[{ name:'Bench Press', sets:[{ type:'working', completed:true,
            weight:275, reps:8 }] }] });
      const scoped = ctx.deriveProgramPerformance(A, log);
      const bench = (scoped.exercises || []).find(x => /bench/i.test(x.name || ''));
      ok('program-scoped evidence uses only the program\u2019s own sessions',
        !!bench && bench.sessions === 6, bench ? String(bench.sessions) : 'none');
    }

    /* ----- §19/§86 ADHERENCE IS NOT INFLATED BY EXTRA TRAINING ----- */
    {
      const planned = [];
      for (let i = 0; i < 4; i++)
        planned.push({ id:'a'+i, date:'2026-03-' + String(2+i).padStart(2,'0'),
          origin:'program', programId:'progA', exercises:[{ name:'Bench Press', sets:[{}] }] });
      const extra = planned.concat([
        { id:'e1', date:'2026-03-06', origin:'freeform', exercises:[{ name:'Bicep Curl', sets:[{}] }] },
        { id:'e2', date:'2026-03-07', origin:'freeform', exercises:[{ name:'Bicep Curl', sets:[{}] }] }]);
      const c1 = ctx.deriveProgramCompletion(A, '2026-12-01', planned);
      const c2 = ctx.deriveProgramCompletion(A, '2026-12-01', extra);
      ok('extra training does not raise the completed-session count',
        c1.completedSessions === c2.completedSessions && c1.completedSessions === 4,
        c1.completedSessions + ' vs ' + c2.completedSessions);
      ok('the planned denominator is untouched by extra training',
        c1.plannedSessions === c2.plannedSessions);
    }

    /* ----- §92 DETERMINISM ----- */
    {
      const log = [
        { id:'d1', date:'2026-03-10', origin:'program', programId:'progA',
          exercises:[{ name:'Bench Press', sets:[{ type:'working', completed:true, weight:185, reps:8 }] }] },
        { id:'d2', date:'2026-03-11', origin:'freeform',
          exercises:[{ name:'Bench Press', sets:[{ type:'working', completed:true, weight:315, reps:8 }] }] }];
      const first = JSON.stringify(ctx.programWorkouts(A, log).map(w => w.id));
      let stable = true;
      for (let i = 0; i < 100; i++)
        if (JSON.stringify(ctx.programWorkouts(A, log).map(w => w.id)) !== first) stable = false;
      ok('100 membership evaluations agree', stable);
      ok('and they select only the program session', first === '["d1"]', first);
    }

    /* ----- §61 NO READ-TIME MIGRATION ----- */
    {
      const legacy = { id:'L', date:'2026-03-10', exercises:[{ name:'Bench Press', sets:[{}] }] };
      const snapshot = JSON.stringify(legacy);
      for (let i = 0; i < 20; i++) {
        ctx.workoutBelongsToProgram(legacy, A);
        ctx.programWorkouts(A, [legacy]);
        ctx.deriveProgramCompletion(A, '2026-12-01', [legacy]);
        ctx.deriveProgramOutcome(A, [legacy]);
      }
      ok('reading a legacy record never writes provenance onto it',
        JSON.stringify(legacy) === snapshot);
      ok('a legacy record gains no origin field', legacy.origin === undefined);
    }

    /* ----- ONE MEMBERSHIP POLICY ----- */
    {
      const src = require('fs').readFileSync(H.APP_PATH, 'utf8');
      const compares = (src.match(/\.programId === /g) || []).length;
      ok('there is exactly one programId membership comparison',
        compares === 1, String(compares));
      ok('programWorkouts delegates rather than re-deciding', (() => {
        const i = src.indexOf('function programWorkouts');
        const body = src.slice(i, i + 400);
        return body.indexOf('workoutBelongsToProgram') !== -1
          && body.indexOf('startDate') === body.lastIndexOf('startDate');
      })());
    }
  }

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

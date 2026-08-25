# LOOP — Trainer Protection Contract

**Status:** ACTIVE · Engine `0.1.1-shadow` · Phase 5F **LOCKED**

This is the permanent development contract for LOOP. It exists so the app can
keep evolving quickly — new UI, new features, refactors — without silently
damaging the intelligence systems or a single row of real training history.

Run `npm run verify` before shipping anything.

---

## 0. For a future Claude session — read this first

> LOOP is a production app with real training history. Before changing it,
> understand the protected systems below. After changing it, run
> `npm run verify`. If trainer tests fail, **investigate the cause — do not
> weaken the test**. Never reset or replace user data. Never enable live
> trainer enforcement without explicit approval. The trainer is
> **shadow-only**; Phase 5F is locked pending real-world evidence.

---

## 1. Protected systems

Changing any of these without intent is a regression, not a refactor.

| System | Storage / source | Guardian test |
|---|---|---|
| Workout history | `workoutLog` | Contracts 2, 3, 12, 13 |
| Sets, reps, weights, RIR | inside `workoutLog` | Contract 12 |
| Set types | `sets[].type` (optional) | Contract 13 |
| XP / level / rank | **derived** from `workoutLog` | Contracts 4, 12 |
| PRs | **derived** from `workoutLog` | Contracts 4, 12 |
| Plans & schedule | `selectedPlan`, `planData:*`, `schedule:*` | Contracts 3, 12 |
| Daily readiness | `dailyReadiness` | Contracts 5, 12, 17 |
| Athlete profile | `athleteProfile` | Contracts 12, 13 |
| Exercise preferences | `exercisePrefs` | Contract 12 |
| Unfinished workout | `activeWorkoutDraft` | Contracts 13, 18 |
| Recovery calculations | derived | Contracts 5, 17 |
| Capability calculations | derived | Contracts 5, 17 |
| Canonical exercise IDs | derived, registry-backed | Contracts 8, 17 |
| Trainer log | `trainerLog` | Contracts 12, 13, 16 |
| Recommendation outcomes | inside `trainerLog` | Contracts 13, 18 |
| User feedback | inside `trainerLog` | Contracts 13, 15 |
| Engine version history | inside `trainerLog` | Contract 16 |
| Trainer caches | in-memory | Contract 17 |
| Evaluation tooling | `loop-*.js` | — |

---

## 2. Change risk tiers

### SAFE TO CHANGE — run `npm test` (quick)
Visual design, colours, spacing, typography, animations, icons, copy,
navigation layout, tab order, empty states, charts, Settings presentation,
What's New content.

*Nothing here touches trainer inputs. Quick regression is sufficient.*

### REQUIRES TRAINER REGRESSION — run `npm run verify`
Anything touching workout logging or its data shape: the log sheet, set rows,
draft capture/restore, `saveLog`, `persistLog`, storage keys, migrations,
boot order, cache invalidation, exercise naming, set types, plan/schedule
structure, readiness capture.

*These are trainer **inputs**. A change here can silently alter every
downstream calculation without any visible symptom.*

### HIGH RISK — requires explicit review before shipping
- Trainer decision logic (`proposeTrainerState`, `applyTrainerConstraints`,
  `computeTrainerConfidence`, `resolveTrainerNumbers`)
- `TRAINER_CONFIG`, `RECOVERY_CONFIG`, `CAPABILITY_CONFIG` thresholds
- `DATA_SCHEMA_VERSION` or any migration
- `TRAINER_ENGINE_VERSION`
- Canonical exercise registry / alias table
- Anything that would make a recommendation *enforceable*

**Do not tune trainer thresholds.** The 56% synthetic CONSOLIDATE rate is an
observation, not a defect. Real-world evidence gates any calibration change.

---

## 3. Dependency map

Derived from the actual code, not an idealised diagram.

```
  WORKOUT LOGGER (UI)
    appendSetRow / toggleSetComplete / toggleSetType
    captureActiveDraft / restoreDraftToSheet
          |
          v
  CORE DATA
    workoutLog   (saveLog -> persistLog)
    dailyReadiness (setReadinessField -> persistReadiness)
    athleteProfile (setProfileField -> persistAthleteProfile)
          |
          +--> sortedLog() ------------> computeXPTimeline -> getCurrentProgression
          |                              computeExercisePREvents -> computeAllPREvents
          |                              computeConsistencyData -> quality / streaks
          |
          +--> resolveExerciseId() ----> canonical identity (registry + aliases)
          |
          +--> computeMuscleRecovery()   [reads workoutLog + set types]
          +--> computeExerciseCapability() [reads workoutLog + repRangeForExercise]
          +--> calculateReadinessScore()  [reads dailyReadiness]
                       |
                       v
             computeTrainingContext()   (aggregates all three, mutates none)
                       |
                       v
             computeShadowRecommendation()      <-- THE ENGINE
               extractPerformanceSignal / extractCapabilitySignal
               extractRecoverySignal / extractReadinessSignal   (clamped <= 0)
               proposeTrainerState  ->  applyTrainerConstraints
               computeTrainerConfidence -> resolveTrainerNumbers
                       |
                       v
             captureShadowForOpenWorkout()  -> logRecommendation()  -> trainerLog
             linkShadowOutcomes()           -> linkRecommendationOutcome()
                       |
                       v
             computeShadowMetrics() / runHistoricalReplay() / loop-evaluate.js
```

**If you modify… these may be affected:**

| You change | At risk |
|---|---|
| Set row DOM / classes | draft capture, set types, shadow outcome linking |
| `saveLog` / `persistLog` | XP, PRs, recovery, capability, consistency, outcome linking |
| Exercise name handling | canonical IDs → capability history → every recommendation |
| Cache invalidation | stale capability/recovery → wrong recommendations |
| `dailyReadiness` shape | readiness signal → constraint layer |
| Storage keys | backup, restore, reset, migration |
| Plan/schedule shape | consistency %, rep-range resolution, program intent |

---

## 4. Non-enforcement contract

The shadow trainer **may**: read workout inputs, calculate, log
recommendations, link outcomes, analyse.

The shadow trainer **must never**: write a weight, reps or RIR input; add or
remove sets; modify a workout; change XP or PRs; force a recommendation;
change plans; start a workout; or prevent the athlete from overriding
anything.

Proven by Contract 15, which deliberately produces a recommendation that
*differs* from the current input — so if enforcement were ever introduced,
the test would see the input change.

---

## 5. Module purity rules

| Module | Contract |
|---|---|
| Muscle Recovery | pure — no writes, no DOM |
| Exercise Capability | pure — no writes, no DOM |
| Shadow Engine | pure — no writes, no DOM |
| Replay / Evaluation | **sandbox** — may substitute `workoutLog` **only** if restored in a `finally`, and must clear `_simulatedNow`; never persists, never touches the DOM |
| Instrumentation | persistence allowed to `trainerLog` only |
| Shadow Observation | reads inputs; writes only `trainerLog` |

Contract 14 enforces both directions: forbidden writes must be **absent**,
and legitimate persistence functions must still **exist** — so a change that
deletes saving can't pass by making the audit trivially clean.

---

## 6. Engine versioning

- Every recommendation records the engine version that produced it.
- New engine versions **append**; they never rewrite history.
- `0.1.0-shadow` and `0.1.1-shadow` records must stay distinguishable.
- Bump `TRAINER_ENGINE_VERSION` on any decision-logic change.
- Compare builds: `node loop-evaluate.js compare old.html new.html`.

---

## 7. Migration rules

No migration is required today (schema v1). If one ever is, it must:

1. Detect the existing version.
2. Back up before migrating.
3. Preserve workouts, XP, PRs, plans, readiness, profile, drafts, trainerLog,
   **and historical engine versions**.
4. Roll back on failure, leaving original data intact.
5. Be idempotent — rerunning must not duplicate or corrupt.

---

## 8. Backup / restore — known behaviour

**Reported, not silently changed** (per the phase brief):

- `trainerLog` **is** included in backup — it's in `DATA_KEYS` and verified by
  Contract 18 (export captures 24 outcomes, feedback, and both engine versions;
  restore rebuilds all of it).
- **Import is gap-fill for non-workout keys.** Workouts merge by ID, but
  `trainerLog`, `athleteProfile`, `dailyReadiness` etc. are only written if the
  target device has no value for that key. Importing into a device that already
  has a trainerLog will **not** overwrite it.
- That is a deliberate safety property (import can't destroy local data), but
  it means a backup is not a full two-way sync for trainer records. Worth
  revisiting if cross-device trainer history ever matters.
- **Fixed 2026-08-24:** gap-fill used to run only inside an `if(incoming.workoutLog)`
  block, so a backup with no workout history (cardio-only or trainer-only use)
  silently imported nothing — no error, no message, just a reload. Gap-fill and
  the success report now run independently of whether the backup has a
  `workoutLog`. Workout merge-by-ID, schema/invalid-file rejection, and
  pre-import rollback are unchanged.

---

## 9. Test tiers

| Command | Runtime | Use |
|---|---|---|
| `npm test` | ~0.3s | visual / UI changes |
| `npm run test:contract` | ~3s | anything touching data or trainer inputs |
| `npm run test:full` | ~1s | storage, persistence, boot |
| `npm run test:trainer` | ~1s | intelligence changes |
| `npm run verify` | ~4s | **before every deploy** |

`npm run verify` runs syntax validation, core regression, data integrity,
trainer integrity, protection contracts, non-enforcement, cache safety,
backup coverage, engine determinism, lookahead protection, monotonicity,
and the 16,800-evaluation simulation.

---

## 10. Failure protocol

When a protected contract breaks, the suite prints the **system**, the
**field**, and the **before/after values**. Then:

1. **Is it intended?** If the change genuinely should alter that data, update
   the test's `allowed` list *and say so in the report*.
2. **Is it harmless?** Derived values may legitimately change when training
   data changes. Raw `workoutLog` changing without a workout operation never is.
3. **Is it a real regression?** Fix the cause.
4. **Is it a test defect?** Fix the test — and state plainly that the test was
   wrong, not the app.

**Never make a failing test pass by loosening it without explanation.**

---

## 11. Product quality gate (from Phase D8)

Functional correctness is no longer the bar. A feature that works but cannot
be found has not shipped. Before considering any future change complete, answer:

| | |
|---|---|
| **Discoverability** | Can a new user find it without being told? |
| **Clarity** | Do they understand what it does before tapping? |
| **Context** | Does it appear where it is actually needed? |
| **Hierarchy** | Is its importance obvious from the layout? |
| **Friction** | How many taps does the common path take? |
| **Learnability** | Would a first-time user work it out unaided? |
| **Recovery** | Can they escape or undo? |
| **Consistency** | Does it behave like similar features in LOOP? |
| **Mobile** | Verified at 375×812 and 390×844, portrait and landscape? |

Working rules that follow from this:

- **A label beats an icon** for anything non-universal. `SET TYPE / Working ▾`
  rather than `⋯`. Back, close and settings icons are fine as-is.
- **Don't add a button because a feature exists.** Ask where a user would
  naturally look for it, and put it there. Programs living only in Settings
  was the example that motivated this rule.
- **Don't make everything louder — make everything clearer.** Solve
  discoverability with hierarchy and progressive disclosure, not by surfacing
  every control at once. A beginner should see simplicity; depth should be
  discoverable.
- **Onboarding must stay true.** `ONBOARDING_STEPS` teaches real controls. If
  a control is renamed or removed, update the step in the same commit — the
  tour is data, so this is a one-line change.
- **Never overstate the trainer.** It is shadow-only. Copy may say LOOP is
  learning and records what it would suggest; it may not say LOOP decides,
  adjusts, or knows the right weight.
- **Measure, don't assume.** Geometry claims (touch targets, overflow, font
  sizes) come from a real rendered browser, not from reading CSS.

---

## 12. Mastery (Phase D9)

Mastery is a **third progression layer**, sitting beside the player and beneath
nothing: `PLAYER → EXERCISE → MUSCLE`. It answers one question only — *how much
training history does LOOP have here* — and it is deliberately inert.

### What it is not

| It is not | Which is |
|---|---|
| a strength score | capability |
| a fatigue score | recovery |
| account progression | player XP / level / rank |
| a recommendation input | the shadow trainer |

Mastery reads all four. **None of them read mastery**, and Contract 64 proves
it by scanning every trainer, recovery, capability and XP function for a
reference. Adding one is a regression, not a feature.

### Derived, never stored

There is no mastery storage key and `DATA_KEYS` is unchanged. Every value is
recomputed from `workoutLog`, the canonical registry and the existing muscle
taxonomy. Three consequences worth keeping:

- Editing or deleting a workout corrects mastery automatically.
- No migration can ever be needed for it.
- The cache **must** stay chained to `invalidateSortedLogCache()`. It is derived
  from the same log; if that hook stops clearing it, the UI will show a level the
  history no longer supports.

### Anti-farming is the design, not a filter

Sessions are the unit, not sets. `MASTERY_CONFIG.session.maxSetsCounted` caps
what a single session can contribute, and most points come from returning to a
movement across distinct weeks and months. Observed on synthetic athletes:

| Athlete | Level |
|---|---|
| 12 sessions over 3 months | 3 (323 pts) |
| 1 session of 40 sets | 1 (48 pts) |
| 52 sessions over a year | 8 |
| 3 sessions over 2 weeks | 2 |

**All thresholds live in `MASTERY_CONFIG`.** Contract 63 fails if the scoring
code grows a bare numeric threshold, so tuning stays a one-place change.

### Known characteristic — calendar span is weighted heavily

At equal session counts, a longer calendar span scores higher: 12 sessions over
two years (431 pts) outscores 12 sessions over three months (323 pts). That
follows from `longitudinal.perDistinctMonth` and is consistent with mastery
meaning *familiarity over time* — but it does mean sporadic training can
outscore dense training at equal volume. **Reported, not tuned.** If it should
change, change `MASTERY_CONFIG.longitudinal`, not the tests.

### Identity rules

- Anchored to canonical exercise ID. Barbell, Smith and dumbbell bench are three
  separate masteries and must stay that way.
- Aliases merge into their canonical entry exactly once.
- An unmapped exercise earns exercise mastery but is attributed to **no** muscle
  — LOOP does not guess anatomy it cannot resolve.
- Muscle mastery uses `CANONICAL_EXERCISES[].primary` / `.secondary` weighted by
  `MASTERY_CONFIG.muscle`. It does **not** read or alter the recovery model,
  which keeps its own weights.

### Language

Mastery describes history, never biology. "Chest Mastery — based on your
training history" is correct; anything implying strength, hypertrophy or
adaptation is not. Contract 64 asserts this against the rendered copy.

---

## 13. Consolidation (Phase D10)

The first phase since D1 that **removed and combined rather than added**. No new
feature, no new tab, no new storage key, no schema change. Every capability that
existed before D10 still exists after it.

### The workout screen

Measured in a real browser at 375×812, same eight-exercise session before and after:

| | Before | After |
|---|---|---|
| Scroll distance | 16.4 screens | **8.9 screens** |
| Content height | 11,112px | **5,999px** |
| Set row | 265px | **112px** |
| Exercise block | 1,507 / 1,233px | **753 / 631px** |
| Set-row controls under 44px | 4 kinds | **none** |

Nothing was deleted to get there. Weight, reps, set type, RIR, completion,
notes, replace, warm-up, timers, last-time and the recommendation all still
ship — they are **disclosed** rather than permanently expanded:

- The set row is two lines: identity + completion, then the two numbers.
  Set type, RIR and remove live one tap away in `.set-row-more`.
- **The collapsed row still names its own classification.** D8 required the set
  type be readable at a glance rather than hidden behind a glyph; that still
  holds via the meta chip (`Working · RIR 2`). What moved is the *control*, not
  the label — and `refreshSetMeta()` is the single place that writes it, so the
  warm-up toggle, the picker and draft restore cannot disagree.
- The recommendation and last-time blocks are still rendered in full; a derived
  one-line summary sits in front of them. `refreshExContext()` reads the
  rendered blocks rather than keeping a second copy, so the summary cannot
  drift from the detail it hides.
- The unit label is a column header printed once per exercise, not 26 times.

**Do not "simplify" this by deleting the collapsed state.** The height is the
feature; a beginner sees weight, reps and a checkmark, and depth is one tap
away. That is §11's rule applied to the screen that was breaking it.

### Train no longer opens on an empty category

`activeTrainCategory` used to be hard-coded to `'push'`, so an Upper/Lower
athlete opened their own library and was told it was empty while eight real
workouts sat two taps away. `defaultTrainCategory()` now resolves: today's
scheduled session → the rest of this athlete's week → anything they have built →
a fixed fallback. An explicit choice sets `trainCategoryChosen` and is never
overridden. Categories the plan does not use recede rather than disappearing.

### Terminology — one noun per concept

| Retired | Now | Why |
|---|---|---|
| Block | **Phase** | They were the same object: `blocks[]`, each with a `phaseType`. The data model is unchanged; only the vocabulary collapsed. |
| Variation | **Workout** | The athlete sees "Upper A", not "a variation". |
| Rotation | *(nothing)* | It named nothing the athlete does. Removed from the masthead, title and copy. |

The mental model is now one sentence: **a program organises your training into
phases, weeks and workouts.** Programs is described as optional, because a plan
already works on its own — Today offers a program instead of reporting a
missing one.

### RIR

Explained where it is used, via the **existing hint record** — no new key. The
definition shows by default until the athlete actually uses RIR
(`markRirUnderstood()`), then recedes to a permanent "?" affordance with a 44px
hit area. Using the control is what retires the explanation, not a dismiss
button they have to find.

### Mastery

D9 put mastery directly above All Exercises on the Strength tab; the audit found
the same lifts listed twice, seven rows apart. Mastery now leads the tab named
for it, shows the top five with the rest disclosed behind **View all**, and
Strength keeps a single exercise directory. Exercise Detail still shows a level.
The scoring is untouched — Contract 66 asserts mastery values are byte-identical
across D10.

### Guardrails

Contracts 65 and 66 (+82 assertions) hold the line: the compressed row still
carries every capability, no set-row control drops below 44px, the context
summary stays derived, Train never lands on an empty category, the retired nouns
stay retired, and D10 created no storage key, no migration and no trainer record.
Engine remains `0.1.1-shadow`.

---

## 14. Landscape and responsive polish (Phase D10.1)

D10 capped only the workout's own content column (`.sheet-scroll > *`) to
560px on wide viewports. Everything else it never reached still went
edge-to-edge: a 772px Settings row, a 688px prep "Next" button, an onboarding
Next button at 695px. D10.1 is the follow-up that reaches the rest — CSS only,
26 insertions, no JS function touched.

### Two centering techniques, not one

Measurement (not assumption) showed `max-width` + `margin: auto` centers
correctly for a flex item on the **row** axis — proven by the floating sheets
(Settings, Programs, Replace, Notes, Set Type, Add Workout), which are direct
children of `.overlay` (`display:flex`, default row direction). It measurably
**fails** for a flex item on the **cross** axis of a **column** flex
container — `.prep-run`/`.prep-actions` inside `.sheet-page`, and
`.ob-top`/`.ob-scroll`/`.ob-actions` inside `.ob-sheet`. There, `max-width` +
auto margins resolved to a 352px box with 0px margins, not 560px centered.
`align-self: center` with a definite `width: 560px` is what actually measures
correctly for that case — verified live before it was written into the
stylesheet, not assumed from the spec.

```css
@media (min-width: 560px){
  .overlay:not(.overlay-page) .sheet{ max-width:560px; margin-left:auto; margin-right:auto; }
  .sheet-page .sheet-scroll > *{ max-width:560px; margin-left:auto; margin-right:auto; }
  .sheet-page .prep-run, .sheet-page .prep-actions,
  .sheet-page .ob-top, .sheet-page .ob-scroll, .sheet-page .ob-actions{
    align-self: center; width: 560px;
  }
}
```

**If a future phase caps another cross-axis item inside a column flex
container and reaches for `max-width`+`margin:auto`, measure it in a real
browser first.** It will silently produce a 0-margin, wrong-width box rather
than erroring.

### A testing-environment trap worth recording

Mid-phase, `location.reload()` intermittently served a stale, pre-edit
version of the stylesheet — CSSOM inspection showed the *old* D10-only rule
still active after an edit that should have replaced it, even though
`fetch('/index.html?cachebust')` proved the server had the new content. A
cache-busted `navigate()` resolved it every time; `location.reload()` did
not, reliably, in this environment. **Prefer a fresh `navigate()` with a
unique query string over `location.reload()` when verifying a CSS change
mid-session.** Recorded here so the next session doesn't re-diagnose it from
scratch.

### Verified in a real browser, not asserted from source alone

| Surface | 812×375 | 844×390 | 667×375 |
|---|---|---|---|
| Workout content column | 560px, centered | 560px, centered | 560px, centered |
| Prep run / actions | 560px, centered | — | — |
| Onboarding top/scroll/actions | 560px, centered | — | — |
| Settings / Programs / Replace / Notes / Set Type / Add Workout | 560px, centered | — | — |
| Collapsed set row vs. scroll viewport | 111px fits 239px | 111px fits 254px | 111px fits 239px |
| Prep "Next" button | 436px (was 688px) | — | — |
| Horizontal overflow | none | none | none |

Timer persistence through rotation was measured with real elapsed time
(`Date.now()`, not wall-clock guessing): 1.00x speed across a rotation,
pause survives rotation at the exact paused value, resume re-anchors and
continues at 1x. Workout state (weight, reps, RIR, set type) survives a
rotation mid-entry — confirmed for real, not assumed, since nothing in this
phase touches JS state; only layout.

Portrait (375×812, 390×844) is untouched: the entire block sits behind
`@media (min-width:560px)`, confirmed both by `matchMedia().matches` reading
`false` at 375 and by re-measuring D10's own numbers (8.8 screens, 111px set
row) unchanged.

### Contracts 67–68 (+35 assertions)

Contract 67 asserts the CSS itself: both centering techniques present with
their correct selectors, no stray duplicate of the old D10-only rule, the
44px floor undisturbed, every full-bleed page still safe-area aware via
`env()`, the existing short-landscape reclaim block not duplicated, and no
JS function changed. Contract 68 is the standard isolation pass — protected
snapshot before/after driving every touched surface, no storage key, no
trainer record, engine still `0.1.1-shadow`.

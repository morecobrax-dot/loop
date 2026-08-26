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

---

## 15. Today, plan and progress consolidation (Phase D11)

### The onboarding replay bug — an ordering defect, not a logic one

`showMainApp()` decides **synchronously** whether to offer the tour. The
athlete's saved onboarding record was not read until `loadTrainerData()`, five
lines later in `boot()`. So `shouldOfferOnboarding()` always inspected the
default state (`completedVersion:null`, `skipped:false`) and always returned
true. **The tour reappeared on every launch, for every returning athlete,
deterministically** — while their completion sat correctly on disk the whole
time.

Reproduced in a browser before the fix: overlay open, storage reading
`completedVersion: 1`, and `shouldOfferOnboarding()` returning `false` *when
asked afterwards*. The function was right; it was asked too early.

`await loadOnboarding()` now runs in `boot()` before the branch that can call
`showMainApp()`, and no longer runs inside `loadTrainerData()`. **The guardian
test asserts the ORDERING, not the logic** — a logic-only assertion passed
throughout the bug's entire life.

> If a decision is computed synchronously during boot, assert that its inputs
> are loaded *before* it, not merely that the function is correct.

### Today — hierarchy

The week sat at y=956 on an 812px screen: an athlete had to scroll to see their
own week. Order is now **workout → week → context → momentum → secondary**, and
both "what am I doing today" and "how is my week going" are answerable without
scrolling (verified for a brand-new athlete at 375×812).

| Removed | Why |
|---|---|
| Training Snapshot | Volume-vs-last-week and "avg workout score" were the two figures the D-audit found uninterpretable. Replaced by Momentum: streak, on-target, PRs. |
| Exercise Trends | Duplicated Progress ▸ Strength without adding to it. Replaced by a one-line route into Progress. |
| Full-size level card | Progression is now one compact line (`.mo-level`) that still opens the profile. The system is unchanged; Progress still presents it properly. |

`renderSnapshot`, `renderTodayTrends` and `renderLevelCard` were **deleted**,
not left orphaned.

**The week card is derived, never stored.** `weekOverview()` reads
`computeConsistencyData()` for what happened, honours an active program via
`getProgramWorkoutForDate()` with the same precedence `renderTodayWorkout()`
uses — so Today and This Week can never disagree — and falls back to the plan
schedule. It writes nothing.

State is carried by **shape**, not colour alone: done is a filled disc, upcoming
a ring, rest a dash. The count appears **once**; the segmented bar and the day
marks show the same fact in different registers rather than repeating the number.

### Adjusting the week

Moving a session is a **swap**, not an overwrite — so the operation is its own
undo, which is why no undo stack exists. Verified: move Tue→Wed then Wed→Tue
restores the week exactly, and `workoutLog` is never involved. Schedule intent
and training history stay separate.

### Plan and Program are one decision

Plan and Program read as two products an athlete had to learn in order. They are
now **one choice on one screen**: pick a ready-made plan, or *Build my own*. The
program architecture is completely untouched — it is simply presented as what it
already was, **the custom kind of plan**.

The custom card appears in all three places plans are listed (first-run chooser,
plan switcher, plans manager), so "custom" is never the hidden option.
`startCustomPlan()` gives a planless athlete a valid base plan first, so the app
is never left without a schedule underneath the builder; an athlete who already
has a plan keeps it untouched unless they finish a build.

**No existing athlete is migrated.** Nothing in `boot()` creates a program, and
Contract 70 asserts it.

### Progress — each fact once

Trend was stated in the header *and* the hero; an average score appeared in both
under two different names; Progress kept its own copy of this week that Today now
owns. Each survives exactly once, or not at all.

**Analytical state is an icon, not punctuation.** `trendIconSvg()` covers
up/down/flat with direction carried by the **shape**; `.ti-up/.ti-down/.ti-flat`
add tone as reinforcement only. Zero `↗ ↘ ↑ ↓ →` characters remain in the app.

### A testing lesson worth keeping

Two D11 assertions failed against **their own explanatory comments** —
`indexOf('showMainApp()')` matched a sentence describing the ordering, and a
`Holding steady` count matched a comment quoting the old copy. Both now strip
comments before measuring.

> When an assertion greps the source for a UI string or a call, strip comments
> first. This file explains itself in prose that names the very symbols the
> tests look for.

---

## 16. Log redesign (Phase D12)

Log answers **"what have I done"**, secondarily "how consistent have I been",
and offers one escape hatch for unplanned training. It is deliberately **not** a
second Progress: Contract 71 asserts the Log module calls no trend, capability,
recovery, mastery or XP function.

### Two real defects found by auditing before building

**A brand-new athlete was shown a month of failures.** The calendar marked any
past scheduled day with no logged session as `cal-missed`, without asking
whether this athlete had started training at all — so someone who installed
LOOP that morning opened Log and saw **14 days marked Missed**, including today.
`computeConsistencyData()` has always applied a `beforeHistory` rule; the
calendar did not. Same rule now, one source of truth. Measured after the fix:
**0 missed days for a new athlete**, while a genuine gap *after* training began
is still surfaced honestly.

**The history feed was 39,305px.** Every workout rendered as a 730–822px card
containing every exercise and every set. Fifty sessions came to **48.4 screens**,
so finding a workout from two weeks ago meant scrolling past roughly ten full
screens. The detail was not deleted — it moved one tap away into the day sheet,
where it is actually read.

| | Before | After |
|---|---|---|
| Find a 2-week-old session | switch subview, scroll ~7,000px | **2 taps, no scrolling** |
| Recent history | 48.4 screens | 8 rows, ~60px each |
| Tappable calendar days | 12 of 31 | **25 of 31** (future days correctly inert) |
| New-athlete "missed" days | 14 | **0** |

### Hierarchy

Header → consistency → calendar → selected day → freeform → recent → exercise
lens. All five §13 elements land within the first 812px screen (title 111,
consistency 144, calendar 282, freeform 699).

The freeform action **moved from the top of the page to below the calendar** and
changed from a filled surface to an outlined control: it is important, but it is
not what the page is for.

### The calendar is the hero

Every past day is a `<button>` that answers. Tapping an empty day used to do
nothing at all; it now says *"Upper Body was planned — nothing logged"* or
*"Rest day"*. Selection is answered **inline** beneath the calendar rather than
by throwing a modal; the full session is one deliberate further tap.

State marks carry meaning in **shape** — filled disc trained, ring planned,
hollow ring missed — so the four-item legend the page used to need is gone.
`.cal-cat-upper` / `.cal-cat-lower` were also added: the default plan's own two
categories previously had **no category colour at all**.

### One consistency visual, not two

Eight weekly columns, sessions against that week's target. Deliberately **not**
another day grid — the calendar directly below already shows a month of days,
and repeating that shape twice would say the same thing in the same way. It
renders nothing at all until there is history to describe.

### Storage

None. `historySelectedDate` is memory-only: a page you return to should not
remember a date you tapped last week. No new key, no migration, `DATA_KEYS`
unchanged at 15.

### A testing lesson, again

One assertion checked the whole consistency markup for `%` to prove the copy was
not a percentage wall — and caught `height:NN%` on the bars, a style value, not
copy. **Assert against the string the athlete reads, not the markup that
contains it.** This is the third phase in a row where a source-grep proxy was
wrong in a new way; prefer extracting the rendered text.

---

## 17. Progress dashboard (Phase D12.1)

Visual summary → interpretation → detail. The Overview was nine stacked blocks
over **4.34 screens**; it is now a hero reading plus five equal cards over
**1.68 screens** — a 61% reduction that *gained* a strength chart, muscle
development and a written interpretation.

**Every figure reuses a calculation that already existed.** No new score, no new
storage key, and Contract 73 asserts the module calls
`computeConsistencyData`, `computeImprovements`, `computeWeeklyVolume`,
`computeAllPREvents`, `getTopMuscleMastery` and `getTopExerciseMastery` rather
than recomputing anything. Contract 74 asserts each of those calculations
returns byte-identical results before and after.

### Removed from the dashboard

The XP/level row, the "getting stronger" list, a duplicated training-distribution
block, needs-attention, the PR timeline, and an inline record directory —
together with `renderProgOverview`, `renderProgHeader`, `heroRingSvg` and
**54 dead CSS rules**. The record directory survives one tap deeper behind a
disclosure; the all-exercises directory stays on its own tab and is explicitly
asserted *not* to be duplicated onto the dashboard.

### Two honesty rules the dashboard enforces

**It states its own coverage.** `progressCoverage()` reports weeks actually
tracked, and the hero says "2 weeks tracked" rather than drawing a 12-week trend
across two weeks of data.

**It will not show a 12-week percentage to a 2-week account.**
`overallConsistency` divides completed sessions by twelve weeks of planned ones.
Shown to someone two weeks in, that reads "8%" — which looks like failure when
they have in fact hit every session they planned. The calculation is correct for
its own window and is **not changed**; below four weeks the tile reports sessions
logged instead. Contract 73 asserts both halves of this.

> Promoting a metric to a hero position changes what it has to be honest about.
> A figure that was fine buried on a sub-tab can mislead once it is the first
> thing an athlete reads.

### Muscle development

The existing muscle-mastery ranking, promoted to the dashboard as a ranked bar
list. Its subtitle says *"From what you have trained, not a body measurement"*,
and Contract 73 asserts the card never uses the words muscle mass, body fat or
composition — LOOP knows training history, not body composition.

### Interaction

Muscle development and Exercise mastery route to the Mastery tab; Consistency
routes to Log; Records disclose in place. Cards that are tappable carry
`pd-card-tap` and a chevron; cards that are not, do not.

### Trainer

Progress remains observational. Contract 73 asserts the dashboard calls no
trainer function and renders no recommendation. Engine stays `0.1.1-shadow`.

---

## 18. My Training (Phase D13)

Plan and Program were two things the athlete had to learn in order. **My
Training** is one user-facing idea over both: `myTrainingState()` reads a plan
alone or a plan with a program through the same shape, so no screen has to
explain which one this athlete happens to have. The internal architecture is
untouched.

### The flow

**Before:** choose one of six plan cards → dropped onto Today with the plan's
default week → discover Settings ▸ Programs → type a program name, pick a goal,
a length, a plan and a structure → no preview of the resulting week.

**After:** choose a plan → *Make this training yours* opens automatically →
frequency and preferred days, with the week rendering live as you change them →
*Use this week*. Everything else is reachable later from one destination.

§16's worked example is asserted verbatim: 4 days on Mon/Tue/Thu/Fri produces
**Upper A, Lower A, Upper B, Lower B** — not the same session four times.

### One destination

Today's card and Settings both open **My Training**. Settings' separate
"Workout Plans" row is gone — it was the same Plan/Program split under new
names. The plans manager still exists and is reached from *Change plan* inside
My Training, from the Train empty state, and from the Programs sheet.

All ten discoverability questions from the brief are answerable by clicking:
schedule, workouts, goal, phases, pause, and how to get back are each one or two
taps from Today.

### Configuration, not recommendation

`buildTrainingWeek()` assembles a week from the plan's own templates, cycling
each category's variants. Contract 75 asserts it consults no trainer function
and invents no exercise. Verified across **all 6 plans × 5 frequencies**: every
generated day names a real workout with a real duration.

### Two defects found while building

**`resolveProgramWorkout()` returns the template itself**, not `{template}` —
`getProgramWorkoutForDate()` is the one that wraps it. Reading `.template` off
the bare return silently yielded `undefined`, so every program day fell through
to the category's first variant and the week showed Upper A twice instead of
Upper A and Upper B. Caught by comparing the setup preview against the
dashboard.

**Every new program carries one auto-created phase typed `custom`**, so the
dashboard was showing a chip reading "CUSTOM" — internal vocabulary presented as
information. A phase is now named only once the athlete has given it a purpose.

### History is never rewritten

Applying a schedule writes the plan schedule and the program's week. Contract 76
proves `workoutLog`, XP, strength XP, PRs, mastery, notes, gym profile and an
unfinished draft are all byte-identical across an intentional schedule change,
and that cancelling the setup leaves the schedule untouched. The dashboard says
so in plain language too.

`applyTrainingSetup()` may write the **existing** `programs` key — that is the
mechanism that makes variants rotate. Contract 76 asserts nothing outside
`DATA_KEYS` is ever created and that `programs` is the only key this flow adds.

> An assertion that snapshots the whole store cannot tell an intended write from
> a leak. Assert *which* keys may change, not that none may.

---

## 19. Week writes, page surfaces, rest timer (Phase D14)

### The split-brain schedule — a bug that always "worked"

LOOP holds the week in **two** places: `schedule` (the plan layer) and, when a
program is active, that program's own day map naming exact workouts. Every
**reader** — `renderTodayWorkout`, `weekOverview`, `myTrainingState` — prefers
the program. Both **writers** (`setDayValue`, `moveDayTo`) wrote only the plan
layer.

So a day edit wrote a value nothing read. It persisted, survived reload, and was
still invisible; the two stores simply diverged. Measured before the fix: plan
said `wed:upper`, program still said `wed:rest`, the week card showed rest.

**This was latent until D13**, which creates a program for every athlete who
runs the setup — turning *"most people have no program, so the plan layer is
authoritative"* into *"most people have one, so it is not"*. D13 did not write
the bug; it made it reachable.

The fix is **not a third store**: `setScheduledCategory()` and
`swapScheduledDays()` are the only writers, and each updates whichever layers
exist. A newly assigned day takes the variant the week uses least, so changing a
rest day to Upper yields a session the week does not already contain.

> Two representations with one writer is a bug that reports success. If a value
> is read from one place, it must be written there.

### Pages vs sheets — classified by measurement

Each destination was measured before being reclassified. What's New, Profile and
Plans left a **16px** blurred sliver of the screen behind them; My Gym 44px,
Backup 96px, Settings 128px. That sliver is what made them read as something
floating over Home rather than a page.

**Promoted to true pages (13):** the workout, prep, onboarding, My Training,
Settings, Plans, Programs, Program detail, My Gym, Backup & Data, What's New,
Profile, Exercise detail.

**Deliberately left as sheets (14):** day edit, set type, replace exercise,
notes, training setup, plan switch, cardio log and detail, add workout, phase
editor, program builder, profile edit, logged-day detail, post-workout summary —
in each of these the athlete is editing something they can still see, and that
context is the point. Contract 78 asserts both lists, so a future phase cannot
quietly promote a sheet that should stay one.

### Rest timer

Rebuilt on an **`endsAt` deadline** rather than a counter decremented per tick —
matching the prep timer, which has always worked that way. Interval counting
drifts and stalls when the tab is backgrounded; the rest timer was the outlier.

**Completion fires exactly once.** The guard is `panel.dataset.completed`, so a
stray interval, a rotation re-render or a double tap cannot double-fire the
haptic, the chime or the animation. Verified: 20 rapid starts leave one
interval; completion produces exactly one haptic and one chime; ten further
ticks and two explicit completion calls produce none. **Skipping is not
completing** — it fires no feedback.

Three states, each distinguishable **without colour**: running (ring depleting),
ending (one held colour shift in the last ten seconds — no flashing), complete
(ring closed, a check replaces the time). `prefers-reduced-motion` is respected.

Haptics are a single 18ms pulse behind a capability check. Audio is a short
two-tone WebAudio chime primed inside the athlete's own tap, so it is always
born in a user-gesture context; if it cannot play, nothing else is affected —
**the visual completion is the source of truth**.

Draft restore also had to change: it wrote `'▶'` as text into what is now an
icon button, and left the ring uninitialised. A restored rest now comes back
**paused**, which is the honest state — it never silently counts down time the
athlete spent away from the app.

---

## 20. Cardio 2.0 — tracking instead of recording (Phase D15)

### What was actually wrong

The Cardio tab had a button labelled **Start Cardio**. It opened a form. There
was no clock anywhere in the feature: every session was typed in from memory
after the fact, and `pace` was a free-text field the athlete filled in by hand.
The tab below that button was six stacked analytics blocks — totals, personal
bests, XP contribution, achievements — so the first thing between an athlete and
their workout was a scoreboard.

Everything underneath was sound and has been kept: 17 canonical activities each
declaring the metrics it actually has, `cardioLog`, the draft key, the stats,
the PRs, the XP timeline and its weekly caps. Cardio 2.0 adds the missing half —
a session you can start — and re-orders what was already there.

> The registry already knew a stair climber has floors and no pace. The old form
> knew it too. The new session screen reads the same array; it did not need a
> second opinion about what a stair climber is.

### Three kinds of number, and the UI must not blur them

LOOP has no GPS, no heart-rate strap and no Health import, so a cardio screen is
mostly numbers of uncertain parentage. Each one now states where it came from,
in the tile, underneath the value:

| | | |
|---|---|---|
| **measured** | time | LOOP counts it against the wall clock |
| **entered** | distance, floors | read off a console or a known route |
| **estimated** | pace, speed, calories | derived from the two above |

Pace and speed are exact arithmetic and are labelled *from distance*. Calories
are a model and are labelled *estimated* everywhere they appear, including in
the saved record (`caloriesEstimated: true`).

### Calories: a published model, or nothing

Energy expenditure scales with body mass, and LOOP had no body weight. The
honest options were to ask for one or to not estimate — not to pick a plausible
number.

`athleteProfile` gains exactly one field, `bodyWeightLb`, defaulting to `null`.
Profiles written before this phase load through
`Object.assign(defaultAthleteProfile(), parsed)` and simply arrive without it,
which reads as *unknown*. **Unknown means no estimate**: the tile shows a dash
and offers the fix, and manual calorie entry stays available.

With a weight, MET values come from the Compendium of Physical Activities, and
where a distance makes the average speed known the MET is interpolated within
that activity's own published table rather than using one flat number for every
effort. `cardio_other` is deliberately absent from the table — "Other" says
nothing about intensity, so there is no defensible MET for it.

**Active and total are a real distinction, not two labels on one number.** Total
is everything burned during the session; resting is what the body would have
spent lying still for the same minutes, which is 1 MET by definition; active is
the difference. Total is therefore always the larger. Both round to whole
numbers — `440 active cal`, never `439.7`.

### The clock

Elapsed time is derived from the wall clock, never counted by ticks:
`accumulatedMs` banks completed segments and `runningSince` marks the open one.
Pausing closes the segment; resuming opens a new one. **Paused time is therefore
structurally unreachable rather than subtracted afterwards** — measured at 0ms
drift across a real pause.

The same property makes interruption recovery fall out for free. A session that
was running when the app went away is restored from the draft still running,
with the time that passed counted — closing the tab mid-run is an interruption,
not a pause, and treating it as one would silently shorten the workout.

There is **one** ticker and **one** store. `startCardioTicker()` clears before it
sets, so 20 rapid Starts leave one interval; finishing and cancelling both clear
it. The session persists to `cardioDraft`, the key cardio already had, with a
`kind` discriminator — drafts written before this phase have no `kind` and still
restore as manual entries.

`resumeCardioDraft()` had existed since cardio shipped and was **never called**,
so an interrupted entry was written and then silently dropped. It is now wired
into boot, which fixes live sessions and the original manual drafts together.

### One visual language

The launcher and history cards were redrawn with line marks first, which briefly
left the manual logger, the records list and Today's cardio link printing the old
geometric glyphs (`▶ ▲ ◉ ◆`) at the same activities. To an athlete that is one
surface wearing two design languages. Every cardio mark now comes from
`cardioIconSvg()`, one per activity *group* rather than per activity — eight
marks, not seventeen, so the launcher does not become an icon catalogue. The
`glyph` characters are gone from `CARDIO_GROUP_STYLE` entirely rather than left
available to drift back; the object carries colour only.

The app-wide caret (`▾`) and tick (`✓`) are untouched — they are LOOP's existing
vocabulary in six other places each, and changing them only inside cardio would
create the inconsistency this section is about removing.

### Where things sit

The session is an `overlay-page`, so it reads as a page the athlete moved to
rather than a panel over the tab they left. Its controls live in their own strip
at the foot of the page: always under the thumb, never over the numbers. One
value at a time is edited in a sheet, which is the D14 rule — the athlete is
changing one thing on a screen they can still see.

The statistics that used to fill the tab are one tap down, behind
**Records & totals**. Nothing was deleted; it stopped being the first thing
between an athlete and Start.

### Consistency without a target

The week arc's denominator is **the seven days of the week** — a fact. LOOP has
no cardio goal, and inventing one would mean shipping a ring most athletes are
designed to fall short of. Three sessions in one day is one day, because the
question the arc answers is *how often*, not *how much*.

---

## 21. The cardio icon family (Phase D16)

### What the group marks could not say

D15 drew eight marks, one per activity *group*. That was enough to remove the
geometric glyphs, and not enough to be an icon system: a treadmill drew the
running figure, a rower and an elliptical drew the same ellipse, and jump rope
drew a clock face. The test an icon has to pass is recognition **before**
reading, and a group mark cannot pass it, because the group is not what the
athlete is looking at.

There are now seventeen entries in `CARDIO_ICONS`, keyed by the canonical id
that already identifies each activity. An icon is presentation hanging off an
id the registry owns — nothing here introduces an activity, renames one, or
gives one a second identity.

**Shared where sharing is true.** Running and walking on a treadmill are the
same machine; a stair climber and a stepmill are the same machine. Those pairs
share one drawing rather than inventing a difference that does not exist in the
gym. Everything else is drawn for what it actually is: the rower has a
flywheel, a rail, a seat and a handle; the elliptical has a column, splayed
handles and two pedal arms; the treadmill has a deck, an upright, a console and
a rail.

### One grid, measured rather than eyeballed

Screenshots were unavailable while this was built, so family cohesion was
**measured**: bounding box, ink length, segment count, centre of mass and
smallest feature, for every icon.

That found three the eye would have caught and the tests never would. The
neutral pulse was the shortest *and* lightest mark in the set, so "Other" read
as a smaller-grade icon rather than a quieter one. The star jump was drawn too
closed to be a star jump. The rower, at 13 units against a family averaging 16,
sat visibly small in the same box — fixed by letting the flywheel cage carry the
height, which is also truer to the machine.

After refinement the family holds to one grid: heights 14.1–17.7 in a 24-unit
box, centres at 11.9/11.9 against a target of 12, and no feature below 1.8 units
— about 1.5px at the smallest size the icons are rendered, so nothing mushes.

> A contract can assert that every activity has an icon. It cannot assert that
> the icons look like they came from the same hand. Measuring the geometry is
> the closest thing to that, and it earned its place by finding real problems.

### The same mark everywhere

Launcher, picker, live session, summary, history, manual logger and Today's
cardio link all call `cardioIconSvg(id)`. Each drawing exists exactly once in
the file, which a contract now checks tag by tag — if a screen ever pasted its
own copy, the two would drift.

On the two session screens the mark is deliberately 17px beside a 46px clock.
It answers *which activity*; the clock answers everything else.

An unknown id returns the neutral pulse rather than an empty box, so no screen
has to guard against a missing icon, and the fallback never claims to be some
other activity.

### Rowing is spoken in splits

`cardioPaceMode()` already chose between pace and speed for every screen; rowing
is a third mode there rather than a special case inside a component. A rower
judges every piece in time per 500m, so `/mi` was a number no rower reads.

The stored distance is untouched — the conversion happens at display. A new
record carries `paceUnit` alongside its pace, so a card never has to infer the
unit from the activity, and **a rowing session written before this phase still
reads in `/mi`**: its stored number was a per-mile pace, and relabelling it a
split would restate a number LOOP never computed.

The remaining half of this is entry, which still asks for rowing distance in
miles. Fixing that means a per-activity distance unit, which is storage
semantics rather than presentation, and is left as its own phase.

### Summary hierarchy

Four equally weighted tiles said everything mattered the same amount. The
activity's own primary metric — distance, or floors — now leads at its own size,
the effort metric and the two calorie figures support it, and the elapsed time
still outranks all of it. Three tiers: 54px, 30px, 18px.

---

## 22. One plan, direct manipulation, isolated pages (Phase D12)

### The word that needed explaining

A first-time athlete needed the difference between a **plan** and a **program**
explained to them. In ordinary speech those are synonyms, so no amount of copy
was going to separate them — LOOP was showing its own architecture and asking
the athlete to learn it.

The user-facing model is now one concept: **your plan** is how you train. What
the code calls a program is a plan with a start date, an end date and phases —
a **training cycle**, which is the word LOOP's own copy already used
(*"plan a longer cycle"*), and which reads as part of a plan rather than a
rival to one.

**"Block" was considered and rejected.** D11 removed that word deliberately
because it sat beside "phase" as a second name for the same idea, and its
guardian test correctly refused to let it back in. A cycle is the container;
phases are its stages. That hierarchy has one word at each level.

The rename is **presentation only**. `programsStore`, `PROGRAMS_KEY`,
`PROGRAM_PHASE_TYPES`, `createProgram()` and every other identifier are
untouched, and nothing was migrated. Contract 89 asserts both halves: the
athlete never reads "program", and the architecture still says it.

> Terminology has to reach the strings an athlete only meets when something
> goes wrong. "Give the program a name" on a validation error is exactly where
> the old vocabulary would have reappeared and undone the rest.

### One selected day, two views

Today and This Week are two views of one thing, so there is **one** piece of
state behind them — `selectedDayKey`, deliberately not a `todaySelectedDate`
beside a `weekSelectedDate` to drift apart. `null` means today, so it resets at
midnight without anything having to notice.

Today keeps its own full renderer: it carries Start, the time picker and the
workout picker, and it is the screen the app opens on. Another day gets a
smaller card that answers a smaller question — what is planned, and can I do
it — using the same program-over-plan precedence Today uses. Opening another
day never rewrites the schedule.

### Hold to move, tap to select

A tap selects; a **420ms hold** picks a workout up. Drift beyond 8px during the
hold cancels it, because that is a scroll, not a grab. Movement is horizontal
and clamped to the strip, so a workout cannot be flung into the page.

The lifted cell is **excluded from its own hit test** — it has been translated
under the finger, so its rect sits over whatever it is being dragged towards,
and including it made every drop read as "back where it started". That bug was
invisible to the test suite and only appeared under real pointer events.

The write goes through `swapScheduledDays()`, the writer D14 established as the
only one that keeps the plan layer and the active program in step. Undo
restores **both** layers exactly and withdraws itself after five seconds.

Tapping a day used to open the day editor, and the gesture split removed that.
The capability came back on the selected day's card, where it has room for a
label instead of being an invisible behaviour of a 40px cell.

### Pages own the screen

While any page or sheet is open the document behind it stops being a
scrollable document. This is **one** observer watching for `.overlay.open`,
not a lock/unlock pair added to each of the twenty-seven open/close functions —
those pair up by hand, and a future overlay that forgets one half would
reintroduce the bug silently.

iOS needs `position: fixed`, not just `overflow: hidden`, so the scroll offset
is captured and restored exactly. Nested layers keep a depth count, so closing
an inner sheet does not unlock the page under an outer one.

Boot does not depend on it: without `MutationObserver` the app still starts and
simply does not lock. A guardian test caught that — scrolling behind a sheet is
a far smaller failure than a blank screen.

### The set that earned the record

The log already said a session contained records; it could not say **which
set**. Nothing here redefines a PR — the classification comes from
`computeExercisePREvents()`, and this only answers a second question about its
output.

Not every PR type belongs to a set. A **volume** record is a property of the
whole session, so it is reported at session level and no row is marked;
attributing it to an arbitrary set would be a small lie. Derived, never stored,
and cached per session id because the naive form walks the whole history once
per exercise.

The badge is a border, a tint **and** the word "PR", with an aria-label naming
which record it was — three signals, one of them colour.

---

## 23. Premium polish, honest visualisation (Phase D13)

### A gesture the browser does not argue with

Holding a day was raising the browser's own text-selection machinery —
highlight boxes, the iOS callout, and a native drag ghost running a second
competing drag. All three are suppressed, **on the week strip only**: selection
stays available everywhere else, and a contract checks that every rule which
disables it names `.wk-day` or `.wk-days`. A selection that began during the
hold is cleared as the lift starts, and the slot the workout left now holds
its shape with a real placeholder element rather than becoming a gap.

### A scheduled day is a scheduled day

D12 gave every non-today card the rest-day action, so a Thursday that already
had Upper C offered *"Train anyway"* — which reads as though nothing was
planned. That was a regression introduced by the previous phase, not an
original defect.

A planned day now names its workout, shows what is in it, and starts it.
*"Train anyway"* belongs to rest days, and a contract asserts it appears in the
rest branch and **not** in the planned branch, so the two cannot merge again.

### Order that helps, without changing behaviour

`ORDER` is not just a list — `nextCategory()` rotates through it, so reordering
the array would silently change which workout every athlete is offered next.
The offered order is therefore its own constant, and `ORDER` keeps its job.

Presentation runs most-complete to most-specialised — Full Body, Upper/Lower,
Push/Pull/Legs, Core — with the categories the athlete's own week actually uses
promoted ahead of it. Insertion order had it exactly backwards.

### The time fits its ring

`.rest-panel-time` carried a 20px size from before the dial existed, and being
declared later in the stylesheet it beat the 14px the dial asked for. Measured:
"3:00" left **2px** of clearance and "10:00" **overflowed the ring**. The dial
owns the size now; every value from `0:05` to `10:00` clears the stroke.

### One replacement, and a real answer when nothing fits

There was only ever one action; the copy called it two things, saying "Swaps
this exercise" under a button labelled Replace and pointing at a "swap list"
that does not exist by that name.

The substantive change is the dead end. "No close alternative found" left the
athlete with nothing to do. The **same engine** now runs a second pass with a
lower score floor — `substitutionHardReject` is untouched, so a fallback can
still never be an exercise already in today's workout, one needing equipment
the gym lacks, or one the movement rules forbid. Only the floor moves.

### Actual vs planned, and nothing more

Two series, drawn differently on purpose:

- **Actual** — solid. Working sets really logged, counted from `workoutLog`.
- **Planned** — outlined. What the cycle *intends* for that week, from its phase.

The planned height is the athlete's own **median** weekly volume scaled by the
phase's stated purpose. A deload is drawn lower because the programme says a
deload is lighter — not because LOOP predicts anything. The footnote says so in
the product, not just here: *a plan, not a prediction*.

Below three logged weeks there is no honest baseline, so no shape is drawn at
all and the card says **"Not enough history yet"**. Without a cycle there is no
planned series — the chart shows real weeks only and says what would give it a
path to compare against. No future week ever carries an actual value.

> A graph is not premium because it is a graph. Drawing a confident line
> through data that cannot support one is the least premium thing an app can do.

### Tabs open at their top

Restoring per-tab scroll left the athlete halfway down a screen they had just
asked to see, and made the same tap give a different result each time. The five
bottom tabs now open at their top; the per-tab memory is deleted rather than
left unused. The workout is an overlay and never passes through `switchTab`, so
nothing about draft state is touched.

---

## 24. Progress as a dashboard, one icon language (Phase D14)

### The three questions, in the order they get asked

The landing view answered *"am I improving"* well and the other two not at all.
It never showed the **level the whole XP system exists to produce**, and it
never said **what the athlete actually trains**. Below the hero sat five
equally-weighted cards, three of which restated content that already had a home
in the sub-tabs — a collection of analytics rather than a dashboard.

The order is now the order the questions get asked in: level → reading →
indicators → most trained → strength trends → consistency → sub-tabs.

Measured on 62 real sessions: **1674px → 1371px** of scroll (2.06 → 1.69
screens), the panel itself **1381px → 1078px**, rendering in **2ms**.

The headline reading and its three indicators are untouched — contracts
protect both, and the level sits above them rather than replacing them.

### Relocated, not deleted

Removing the three cards outright took the **record directory offline**: it is
a disclosure, and that card was the only thing that opened it. The guardian
tests caught it, and they were right to.

They are now in the sub-tabs — the strength metric card and record list with
the lifts they describe, muscle development with the volume it is computed
from. Every behaviour those contracts protect was verified still present before
a single assertion was re-pointed, and new assertions now hold the *hierarchy*
in place: each card must be in its tab **and not** on the landing view.

### Most Trained has one home

It leads the Progress landing view, so the copy inside the Mastery tab was the
same list twice. One heading exists in the app, and a contract counts it.

### One icon language

LOOP already had a native family — `checkIconSvg`, `pencilIconSvg`,
`chevronRightSvg`, `trendIconSvg`, and the cardio set — all on a 16 or 24 box
with a 1.5–1.7 stroke and round caps. Three members were missing, so controls
that needed them were still printing Unicode: **close**, **chevron-down**, and
**gear**. `checkIconSvg` gained the size argument the rest of the family takes.

Converted: close/delete (five sites), edit, three disclosure carets, three
completion marks, the settings gear, and the What's New toggle. Every one kept
or gained an accessible name. **No rendered button is a bare glyph.**

Two traps worth recording. The gear lives in the **static header**, not a
template literal, so an interpolation there renders as the literal text
`${gearIconSvg(15)}` — it is filled at boot instead, and a contract now scans
the static body for that whole class of mistake. And `chevronLeftSvg` turned
out to be defined **twice**, byte-identical, from D12; the duplicate is gone.

**Deliberately retained:** the five navigation glyphs (`◆ ▤ ▲ ◉ ≡`). They are a
coherent set of their own, always on screen, and swapping them one at a time
would produce a mixed bar. They need designing as a set — different work from
an audit.

---

## 25. Closing the evidence loop (Phase D15B)

The D15A audit returned **n = 0**. Not because the trainer had failed, but
because nothing had ever read it: the evidence sat in `localStorage` on one
phone with no route out except a manual export nobody had run. This phase
builds the route.

### "Accepted" was never true

The outcome field recorded `accepted` or `modified`. **The athlete never sees
a shadow recommendation**, so neither word described anything that happened.
All that occurred is that the load actually performed either did or did not
coincide with a number the engine kept to itself.

New records say **MATCHED** and **DIVERGED**. Records written before this phase
keep their original strings — history is not rewritten to make a report tidier
— and are translated at read time by a one-way legacy map, so both vocabularies
count into one honest figure.

> "62% accepted" would have been the most quotable number in the dataset and
> the most wrong. It reads as endorsement of a recommendation the athlete was
> never shown.

### Retention: a bigger bound, not no bound

Measured: one full record with its outcome and set detail is **945 bytes**. The
old cap of 500 was ~4.8 months at four sessions a week — the oldest records,
which establish the baseline, were the first destroyed.

The cap is now **2000** (~1.8MB, ~19 months), which spans several programs and
their phases. It stays **finite on purpose**: an unbounded log is a storage
failure waiting for the athlete who trains for five years. Evictions are
**counted**, and the panel says plainly when the visible history is not the
whole history. A log that quietly forgets is worse than one that admits it.

### A panel that cannot imply a result

`computeShadowMetrics()` existed and was rendered nowhere. It now backs a
read-only panel in Settings → Backup & Data, collapsed by default, consuming
that function's output rather than recomputing anything.

Three rules make the panel unable to overclaim:

- **Every percentage carries its denominator.** `evPct(0, 0)` returns
  `n/a (n=0)`, never `0%`.
- **A metric with no sample is not drawn at all.**
- **The caveat is a visible block**, not a tooltip: the trainer is hidden, a
  match is coincidence, and none of it affects the workout.

The tier is labelled *quantity of evidence only, not accuracy*. The word
"accuracy" appears exactly once in the panel, negated — a contract asserts that
every occurrence is preceded by a negation.

One bug found while wiring it: the override rate is computed over entries
having **both** a proposed and a final state, but the panel labelled it "of N
recommendations" — naming a denominator it did not have. The metrics function
now returns the sample it actually divided by.

`loop-evaluate.js real <backup.json>` remains the authoritative analysis path;
the panel is for a glance. Verified end to end: export → restore keeps entries,
both engine versions, both vocabularies, feedback, RIR and the eviction count.

---

## 26. Premium polish, and one request declined (Phase D16)

### The tutorial stopped explaining how LOOP is built

Its last two moments recited the internals — *"builds up your capability,
recovery and history"*, *"records what it would suggest so the guidance can be
checked against real training"*. All true, none of it useful to someone who has
just opened the app.

Eight steps became **seven**, ordered the way the questions actually arrive:
Today → workout → logging → tools → readiness → **progress**. The two
architecture moments collapse into one progress moment that shows the athlete a
muscle read-out instead of describing the machinery behind it.

The honesty the old step carried is **not** optional and did not go with it. A
guardian test caught its removal, correctly: a first-time athlete must not
finish the tour believing LOOP picks their weights. It is now stated in product
language — *"LOOP is observing, not deciding — every weight on the bar stays
yours"* — rather than in the vocabulary of the engine.

### The chart's labels collided because there were too many of them

Measured: each date label rendered **30px wide in slots 27px apart**, so every
label overlapped its neighbour by 3px. The chart drew one label per bucket
regardless of how many could fit, so the collision arrived the moment a range
held more than about nine weeks.

The fix is **density, not margin**. A label budget derived from the axis width
decides how many are drawn, and the count is stepped back from the end so the
**most recent week always keeps its label** — it is the one an athlete looks
for. Verified at 4W, 8W and 12W across five viewports: zero overlaps.

### A request I did not implement as asked

The ring was reported as *"too static"*. Measurement explained why: over a
three-minute rest the arc advances about **half a percent of its circumference
per second** — roughly a third of a pixel on a 56px dial. It was animating
correctly the whole time; the motion was simply below the threshold of visible
change.

I first added a slow pulse to the stroke. A D13 guardian test rejected it, and
it was right to: **nothing on a training screen animates continuously**, and a
pulsing ring in an athlete's peripheral vision for three minutes is exactly the
distraction that rule exists to prevent. A pulse would also not have fixed the
complaint — it adds motion carrying no information, while the arc's actual rate
is fixed by the duration and must stay honest.

What legibility actually needed was **size**: the dial went 56 → 64px and the
stroke 4 → 5, so the arc's position reads at a glance. The number grew with it,
16px → 17px, and still clears the stroke at every value — measured at 10:00,
3:00, 1:42, 0:30 and 0:05, with 6px of clearance at the worst case.

> Speeding the ring up would have made it lie about the time. The number ticking
> every second is the real motion on that panel; the ring's job is proportion.

### What the sweep found

Nothing. Across five viewports and nine surfaces: **zero** touch targets under
44px, **zero** inputs under 16px, **zero** document overflow, **zero** dangling
timers after closing a cardio session, and no duplicate listeners after twenty
re-renders. `renderAll` fires **zero** times during tab switches, day selection
and sheet open/close — the app renders surgically.

Thirteen apparent overflow findings were the `pageIn` animation frozen at its
first frame because the test pane was not compositing; with animations
neutralised every sheet measures exactly the viewport width.

## §27 — First use: understand, choose, learn, fit (Phase D16)

LOOP opened on seven plan cards. Someone who had never tracked a workout was
asked to choose between "Bodybuilder Hypertrophy" and "Upper / Lower Split"
before anything had told them what the app was for, and the tour that explains
it ran afterwards. The order was backwards.

The first run is now four stages, in this order and never overlapping:

1. **Understand** — one screen: "Know what to train, every day." A slice of the
   real product sits under it (a workout card with logged sets) rather than a
   description of one. One button.
2. **Choose** — "What do you want from training?" Three intents lead — Build
   muscle, Get stronger, Get fit & athletic — each mapping to an existing plan.
   Every card shows the plan's **actual** `defaultSchedule`, not a sample week,
   plus how many days a week it runs. The plan's own name sits underneath, so
   the vocabulary is available without being the question.
3. **Learn** — the existing seven-step tutorial, unchanged, still gated on
   `shouldOfferOnboarding()`, still skippable in one tap.
4. **Fit** — the existing "Make this training yours" setup.

### What this phase must never do

- **No plan may become unreachable.** The three intents are a presentation
  layer over `DEFAULT_PLANS`, not a replacement for it. The remaining three
  plans and "Build my own" sit behind **More plans**, one tap away and without
  leaving the screen. A contract asserts every key of `DEFAULT_PLANS` is
  reachable, so adding a plan without listing it fails the suite.
- **The week strip is read, never authored.** `planWeekStripHtml()` renders
  `plan.defaultSchedule` directly. A hand-written sample week that did not
  match what the athlete then received would be a lie on screen.
- **"Help me choose" recommends; it does not decide.** Three questions, then a
  plan, with "See the other plans" always present. `recommendPlan()` selects
  from the existing library — it is a lookup, not a second engine. All 18
  answer combinations are asserted to resolve to a real plan. Equipment is the
  first constraint: a gym plan is useless to someone training at home.
- **Existing athletes never see any of it.** The chooser is gated on having no
  `selectedPlanId`; the tour on a recorded `completedVersion`/`skipped`. First
  use writes no storage key of its own, adds nothing to `DATA_KEYS`, and
  performs no migration.

### The stacking defect this phase fixed

Measured on a clean first run before the change: `startOnboarding()` fired at
450ms from `showMainApp()`, and `openTrainingSetup()` at 500ms from
`choosePlan()`. Both sheets were open 80ms apart and **both stayed open** — the
tutorial on top, the setup waiting underneath it. Two independent timers that
never knew about each other; the first thing an athlete met after their first
decision was two stacked modals.

They are now a sequence. `choosePlan()` holds the setup in
`pendingTrainingSetupPlan` when the tour is going to run, and
`closeOnboarding()` — the single exit that both skip and finish route through —
releases it. An athlete switching plans later still never sees the setup.

### Contract 102

Thirty-eight assertions covering: the intro precedes the chooser and carries
one action; the question is about the person; every plan stays reachable and
listed once; each plan's strip matches its own schedule and has seven cells;
all 18 help combinations resolve; options are addressed by index rather than a
value serialised into an inline handler (raw double quotes inside a
double-quoted attribute had silently killed every option button); the tour is
kept and still gated; the setup is deferred and released; and no second plan
library, storage key, or recommendation engine was introduced.

**Two earlier assertions were re-pointed, not weakened.** `offered on the
first-run chooser` matched `showOnboarding()` building the markup itself, which
it no longer does — it now matches `renderFirstUsePlans()`, the function that
actually lists plans, and a companion assertion covers the disclosure. `the
chooser asks a human question` pinned the literal string "Choose how you train";
it now pins "What do you want from training?", which is the same contract
against the current copy.

### Measured, not assumed

At 375×812, 390×844, 812×375, 844×390 and 932×430: no horizontal scroll, no
clipped control, no touch target under 44px, and the intro fits without
scrolling at every size. Landscape gets the two-column treatment `.cs-stage`
already uses — text beside the demo — because shrinking type alone still left
the only button 35px below the fold.

Contrast was measured against the **composited** background rather than the
token, which is what exposed `.fu-card-plan` at 2.88:1 and the day initials at
2.45:1; both moved off `--text-faint`, which is for marks that carry no
information on their own.

The trainer is untouched and remains `0.1.1-shadow`.

## §28 — First run asks only what it does not know (Phase D16.1)

D16 got the order right — understand, choose, learn, fit. It left three things
wrong, all of them the same mistake in different places: the app talking as if
it knew less than it did, or more.

### The intro was showing invented performance

The demo card read `135 × 8 / 145 × 8 / 155 × 6` under a workout title. Those
numbers were fabricated. `aria-hidden` kept them from screen readers, which is
not who they were misinforming.

The card is now built by `introDemoWorkout()`, which reads `DEFAULT_PLANS` at
render time: a real template name and its real first three exercises, with no
load, no reps and no duration. It renders "Upper A — Strength Emphasis / Bench
Press / Barbell Row / Overhead Press / + 5 more". Reading the library rather
than restating it also means the card cannot go stale when plans change. A
contract asserts the rendered card contains no digit other than the "+ N more"
count.

### Setup asked for what the plan had already answered

`openTrainingSetup()` already prefilled its days from the plan's own schedule.
It then rendered that prefilled state as two open questions, so an athlete who
had just chosen a 3-day plan was immediately asked how often they wanted to
train. The data was right; the screen refused to admit it already had it.

Setup now opens as a summary — plan, training frequency, schedule, and goal
where known — each value carrying where it came from and a single **Change**
control that reveals the existing editor in place. Visible controls on that
screen went from **14** (2 questions, 5 frequency buttons, 7 day buttons, plus
cancel and apply) to **4**.

Provenance is itself a claim, so it is held to the same standard: the note only
says "Your current schedule" when the schedule actually differs from the plan
default — on a first run it says "From your selected plan" — and it disappears
entirely once the athlete edits the value, because at that point it did not
come from anywhere but them.

### "Help me choose" collected an answer and discarded it

For six of the eighteen answer combinations the goal changed nothing: training
at home selects the home plan whatever the goal is. The days answer was inert
for twelve of eighteen — it only moved the plan for muscle-at-a-gym.

Both now always do something, which is the honest version of Part 5A's third
option — reframe the question as a preference that affects setup:

- **days** always decides the prefilled week, whether or not it changed the plan
- **goal** always seeds `athleteProfile.goal`, which sets rep ranges, even when
  equipment chose the plan

And where equipment did override the goal, the screen says so:

> Your equipment limits which plans fit, so this one was chosen ahead of your
> goal. Your goal still shapes how LOOP sets your reps.

`recommendPlanWithReason()` returns `{ id, overridden, reason }`;
`recommendPlan()` remains as the id-only wrapper, so there is still one
decision function. A contract asserts no reason contains internal vocabulary
(capability, confidence, substitution ranking) and that a goal-driven result
never claims an override.

### What may never happen here

- **A goal the athlete set themselves is never overwritten.** `adoptHelpGoal()`
  returns false and writes nothing when `athleteProfile.goal` is already set.
- **No new storage key.** The goal is written to `athleteProfile`, which has
  been a `DATA_KEYS` entry since the profile existed. `DATA_KEYS` still holds
  fifteen entries.
- **Setup still writes only the schedule.** `applyTrainingSetup()` is unchanged.
- **No trainer record is created by navigating first run.** Asserted directly.

### Contract 103

Sixty-one assertions: fabricated metrics gone and unreproducible; the demo read
from the library; setup prefilled correctly for every plan in the library and
labelled with its true source; a stated frequency beating the plan default; one
editor open at a time; all 18 combinations resolving, carrying a reason, and
never leaking ranking vocabulary; the goal reaching the profile for every goal
and never overwriting an existing one; and the touch-target geometry below.

Three earlier assertions were re-pointed, not weakened, and all three because
this brief deliberately changed what they pinned: `it asks frequency` and `it
asks which days` matched the question strings D16.1 removed, and now match the
labels of the prefilled rows plus the shared editable-row helper; `choosing
still goes through the existing choosePlan` now allows the goal to be recorded
before the handoff, with a companion assertion that there is still exactly one
such exit.

### Measured, not assumed

Seven day cells across a 375px screen measured **43.56px** at gap 5px — under
the 44px minimum. The gap is 4px and they measure 44.42px. Pre-existing, found
by measuring rather than reading.

At 375×812, 390×844, 812×375, 844×390 and 932×430, with both editors open: no
horizontal scroll, no clipped control, no target under 44px, no input under
16px, and the sheet within the viewport at every size.

First launch to a personalised Today: **4 taps** (Get started → a plan → skip
tutorial → Use this week), landing on the correct plan, schedule, current day
and week, with honest empty states and no placeholder metrics.

The trainer is untouched and remains `0.1.1-shadow`.

## §29 — Nothing feels fragile (Phase D17)

A reliability and accessibility pass across every workflow an athlete can
interrupt. No feature was added. The trainer was not touched.

### The defect that could strand the app

`switchTab()` set `currentTab`, cleared the active class from every view, and
then threw on `document.getElementById('view-' + tab)` when the tab did not
exist. The athlete was left with a header, a tab bar, and nothing between them
— and because `currentTab` had already been overwritten, no further tap
recovered it. Only a reload brought LOOP back.

Reproduced in a browser, and it is not hypothetical: `switchTab` is called from
card links and CTAs as well as the five tab buttons, so one wrong string
anywhere blanks the app. The destination is now resolved first and an unknown
tab is a no-op that leaves the current screen alone.

### Fields small enough to zoom the page

Safari on iOS zooms whenever a focused field is under 16px, and it does not
zoom back out. The base `input, textarea, select` rule was **14.5px**, so
tapping a RIR box mid-set left the athlete on a magnified, sideways-scrolling
workout sheet. `.ex-grid input` was 12.5px and `.swap-select` 15px.

All are now at the threshold, and the base rule carries it so a new field
cannot reintroduce the problem. A contract scans every CSS rule targeting a
real field element and fails on any font-size below 16px — class names like
`.ob-mock-select` are excluded because those are spans in the tutorial mock-up
that accept no input.

### Touch targets measured, not assumed

Seven controls measured under 44px in a real browser at 375×812:

| control | was | now |
|---|---|---|
| `.btn-primary` / `.btn-secondary` (every sheet's confirm and cancel) | 43px | 44px |
| `.add-ex-btn` | 37px | 44px |
| `.bw-toggle` checkbox | 20×20 | label is the 44px target, box stays 20px |
| `.swap-select` | 36×36 | 44×44 |
| `.pchip` (two dozen on the profile sheet) | 40px | 44px |
| `.sheet-back` | 26px tall | 44px |
| `.update-detail-toggle` | 25px tall | 44px |

`.wk-day` measures 43.94px — 0.06px under, below one device pixel. Left alone;
tightening the grid gap would visibly compress the week strip for no
perceptible gain.

### Thirty sheets, no keyboard

Before this phase no overlay could be closed without a pointer, none announced
itself as a dialog, and none returned focus. All of it now hangs off the single
MutationObserver D12 already runs on `.overlay` class changes, rather than
thirty separate call sites:

- `role="dialog"` and `aria-modal="true"` while open, cleared on close
- focus moves to the **sheet**, never to a field — focusing an input would
  throw a phone keyboard over the screen just opened
- Escape closes the topmost sheet **through that sheet's own close path**,
  read from its `backdropDismiss(event, fn)` handler or its own close button.
  Nothing is invented: a sheet that declares no exit (an active cardio session,
  the tutorial) is left alone rather than torn down by a mechanism that does
  not know its cleanup.
- Tab wraps inside the top sheet, and Escape is handled before anything can
  swallow it, so there is no way to be trapped
- focus returns to the control that opened the sheet, but only if it still
  exists — after saving a workout the button that started it is gone

### What was measured and found clean

Instrumented `addEventListener`, `setInterval` and `MutationObserver` in a real
browser, then exercised: 20 rapid sheet open/close cycles, 20 rapid tab
switches, 20 rapid toggles, nested sheets three deep, portrait → landscape →
portrait with a workout open and a rest timer running, a full cardio session
with pause and reload, and a workout interrupted by reload.

Result: **zero intervals left running, zero net listeners retained, zero stray
overlays, no leaked scroll lock**, and `workoutLog` unchanged throughout. The
existing single-exit discipline (`exitPrep`, `clearRestTimer` before
`startRestPanel`, dataset-guarded gesture attachment) held under all of it.
Double-resuming a cardio session still yields exactly one ticker.

Draft recovery was verified end to end: weight, reps and RIR restored exactly,
23 set rows and no duplicates, set-type label correctly reflecting the restored
RIR.

Pure navigation — five tabs and eleven sheets opened and closed — wrote
**nothing**: all fifteen `DATA_KEYS` byte-identical before and after.

### Corrupt storage degrades, it never destroys

Every key was replaced with a different flavour of garbage — truncated JSON,
`null`, an array where an object belongs, a bare number, a string, a plan id
that does not exist. LOOP booted, showed no developer terminology, fell back to
first run because the plan could not be resolved, and after recovery the
malformed `workoutLog` was still there **byte for byte** rather than
overwritten.

### Empty states

Audited against what is this / why does it matter / what next. Today, Log,
Progress, Cardio and Train all already answer them in one or two lines. No
changes: the brief's own rule is that the absence of unnecessary information is
a feature.

### Contract 104

Forty-nine assertions covering tab validation and ordering, the 16px floor as a
rule-level scan, every touch target above, dialog semantics, the single close
path, focus in and out, one observer rather than two, timer ownership and
single exits, gesture re-attachment guards, corrupt-storage tolerance, and
trainer isolation.

**One earlier assertion was re-pointed, not weakened**: `an observer watches the
overlays` matched the literal `new MutationObserver(syncBackgroundScrollLock)`.
The callback now calls two functions, so it matches the constructor plus two
companion assertions — that there is still exactly one observer, and that the
scroll lock still runs from it. The contract it protects (one mechanism, not a
lock per screen) is unchanged and now covers more.

Two assertions were deliberately **not** written as harness tests: "exactly one
active view" and "switching away deactivates the previous view". The harness DOM
returns nothing for compound class selectors, so `.view` sweeps are no-ops in
it and those assertions would have tested the stub rather than the app. Both
are verified in a real browser after 20 rapid switches.

The trainer is untouched and remains `0.1.1-shadow`.

## §30 — One design system, followed (Premium design pass)

An audit-first visual pass. No feature added, no engine touched.

### What the audit found

LOOP already had a real token system — three surfaces, three text levels,
category and status colours, four radii, six spacing steps, four shadows, one
easing — and it was followed reasonably well: 209 radius token uses against 44
raw values, 233 spacing token uses, 128 uses of `--ease`.

**Typography was the axis nobody governed.** 39 distinct font sizes. 148 CSS
rules below 11px, spread across 7, 8, 8.5, 9, 9.5, 10 and 10.5 with no rule
deciding which. In the running app that produced **160 rendered elements under
11px**, including 8px "Plan", 9px "Today", 9.5px week-day letters and 10px
"Tap a day to see it".

The brief's own words: *avoid tiny text as a solution to density*.

### The type scale

Eight tokens, one per role — micro, meta, support, body, card title, section,
title, metric. The 141 micro-label rules that were doing the same job at seven
different sizes collapse to `--fs-micro`, at 11px, which is the floor Apple's
guidance sets and the app had none of.

Icon-like rules were left alone deliberately — carets and glyph boxes are sized
as shapes, not as text.

### Text inside SVG, which no stylesheet audit can see

SVG text is scaled by its viewBox, so a CSS floor never reaches it. Measured
rendered sizes:

| label | before | after |
|---|---|---|
| body diagram FRONT / BACK | **4.74px** | 10.16px |
| strength chart dates | 8.48px | 10.37px |
| volume chart dates | 8.48px | 11.52px |
| chart min / max | 8px declared | 11 |

Making them readable pushed the outermost labels outside the viewBox, where
`overflow:hidden` clipped them — "Aug 24" lost its last characters. The first
and last labels now anchor to their edge instead of centring on their bar, and
the body diagram's box grew by five units rather than its labels shrinking.

### The Volume / muscle-breakdown overlap

Named in the brief and reproduced exactly. The chart's axis labels ended at
y=637, the chart box at 642, and the muscle rows began at **642 — a gap of
zero**. The dates ran straight into the breakdown.

The cause was not spacing but structure: `.sec-head` is what carries LOOP's
section separation (26px plus a rule), and the muscle breakdown was the only
section in the panel without one. It also placed its caption *below* the data,
so the reader met six bars before learning what they counted. The Mastery tab
already renders the same component the right way round.

It now has a heading — "Sets this week by muscle" — before the data, and the
redundant trailing caption is gone. **Gap: 0px → 26px.** `muscleBarsHtml()`
takes an optional caption so one component still serves both callers.

### The navigation bar joined the icon family

The bottom bar is the one component on screen at all times, and it was the only
one still drawing itself with Unicode geometry: ◆ ▤ ▲ ◉ ≡. Those characters
render differently on every platform, have no relationship to each other, and
belong to no family — while the rest of LOOP has a real icon set.

`tabIconSvg()` draws all five on the family's own 16 grid, no fill,
`currentColor`, 1.6 stroke, round joins, `aria-hidden` because the button
already carries its name in text. Each says what its tab is *for*: the ring
LOOP is named after with the day marked inside it, a bar with plates, three
rising columns, a heartbeat, a calendar. The bordered glyph box and its active
treatment are unchanged, so the bar still looks like LOOP.

**D14 deferred this deliberately** — "they need designing as a set, which is a
different piece of work from this audit" — and the assertion recording that
deferral is now replaced by one holding the result.

### Charts use the palette instead of restating it

Sixteen hex literals in generated markup duplicated existing tokens. All are
now `var(--accent)`, `var(--text-faint)`, `var(--text-dim)`, `var(--accent-soft)`.

`PHASE_INTENT` keeps its own literals **on purpose**: Foundation, Build, Peak
and Deload are a domain palette that happens to share values with semantic
tokens, and "Peak" is not an error state.

### Contract 105

Thirty-seven assertions: the eight type tokens exist; no CSS rule and no SVG
attribute sets text below the floor; edge labels anchor rather than clip; charts
use named colours; the phase palette stays its own set; one function draws all
five tab icons on the family grid; the active tab is not indicated by colour
alone; the Volume breakdown has a heading before its data; a set value reads
larger than the PR badge annotating it; and nothing about storage, the trainer
or D17's accessibility changed.

**Three assertions were replaced, not weakened**, all because the UI contract
this brief set deliberately changed what they pinned:

- `all tab glyphs are symbols, not letters` and `five tabs present` read the
  Unicode characters out of the markup. Replaced by five assertions: five
  distinct icon slots, no tab borrowing a letterform, every slot painted from
  the shared function, drawn in the family's language, and a path present for
  each of the five so none renders empty.
- `the navigation glyphs are untouched and still a complete set` recorded D14's
  deferral. Replaced by the result plus a check that one function owns the set.
- `the badge is small enough not to shout` pinned `font-size: 8.5px`. The
  relationship it protected is now asserted directly — the badge sits at the
  micro tier and the set it annotates reads a step above it — which is the
  stronger form.

### A pre-existing test bug found at baseline

`rest days are marked rest` asserted that *every* rest-category day carries
state `'rest'`. When today falls on one of the fixture's rest days it is
correctly marked `'today'` instead — today outranks category, which is what
lets Today present a rest day as a deliberate state rather than an empty one.
The assertion passed four days a week and failed three. It now states the
actual rule, plus that a rest day is never counted as a missed workout.

### Measured

375×812, 390×844, 812×375, 844×390 and 932×430, across five tabs, four Progress
sub-tabs, nine sheets and the open workout: **no clipping, no text under 11px,
no control under 44px, no field under 16px, no horizontal overflow.** Rest timer
text fits inside its ring at every value from 0:30 to 12:30 (worst case 1.7px
clearance).

Pure visual navigation writes nothing: all fifteen `DATA_KEYS` byte-identical,
XP unchanged, 35 logged sessions intact.

The trainer is untouched and remains `0.1.1-shadow`.

## §31 — Composition and completion (Visual composition pass)

An audit-first pass on rhythm, the last Unicode standing in for icons, and the
completion moment that had no feedback. Most of what this brief asked for was
already built; the value was in finding the three places it was not.

### Today's rhythm

Measured on the rendered screen, the blocks down Today sat **14, 14, 12, 26,
12, 16** pixels apart. The 26 is real — it comes from `.sec-head` and marks the
break between "what am I doing today" and "how have I been doing". The 12, 14
and 16 are three different answers to the same question, none of them chosen,
and three values within four pixels read as accidental rather than composed.

Two gaps now carry the screen: `--space-3` between blocks that belong together,
and the section rule between groups that do not. **Four distinct gaps → two.**

The wider stylesheet has 19 distinct raw `margin-top` values across 268
declarations. That was deliberately **not** swept: most are intra-component
spacing where a token grid would be wrong, and rewriting them is the
"blindly fix everything" trap this brief warns against. Block-level rhythm is
what a reader perceives, and that is what changed.

### The last symbols standing in for icons

The premium pass took the navigation bar off Unicode geometry. Four remained in
rendered UI:

| where | was | now |
|---|---|---|
| Train, plateau notice | `⚠` | `warnIconSvg()` |
| Profile, achievement rows | `✓` / `○` | `checkIconSvg()` / `ringIconSvg()` |
| Cardio, details disclosure | `▴` / `▾` swap | one `chevronDownSvg()` that rotates |
| Tutorial, mock set-type control | `▾` | `chevronDownSvg()` |

The tutorial one is worth naming: the real set-type control already used
`chevronDownSvg()`, so the mock was depicting LOOP **less accurately than
reality**. Fixing it made the tour honest, not just consistent.

The swap control keeps its character deliberately — it lives inside a native
`<option>`, which cannot hold markup.

### Completing a set is now felt

Finishing a cardio session, lifting a day to drag it, and a rest timer running
out all pulsed. **Completing a set — the action an athlete performs more than
any other, twenty-odd times a session — did not.**

The visual side was already right: the button's ring fills and its check draws
(`scbSettle`), and the next set pulses so the eye knows where to go. Only the
touch was missing. One pulse, inside the athlete's own tap so iOS permits it,
silent on anything that cannot vibrate, and **not** fired when a set is
re-opened.

Finishing the last set of an exercise is a slightly larger moment, so the row
settles once and keeps a success edge. Re-opening a set clears the mark, so it
always describes the current state rather than something that happened earlier.
The settle peaks at scale 1.012 — a settle, not a bounce — and reduced motion
removes it with everything else.

### What was already right, and left alone

The brief asked for polish in several places that already had it. Changing them
would have been motion for its own sake:

- **Drag** (Phase 12) already lifts with `scale(1.06)`, leaves a dashed
  placeholder, outlines valid targets, highlights the one under the finger,
  shakes on an invalid drop, fires a haptic on pickup, and suppresses text
  selection three different ways.
- **PR reveal** (Phase 11) already rises and pulses a success ring — no emoji,
  no confetti.
- **Rest timer** (Phase 13) already uses deadline-based timing, keeps its text
  inside the ring at every value, fires one haptic and one chime.
- **Card structure** (Phase 3) — the audit found 8 apparently nested cards on
  Train; they are buttons and alert flags inside workout cards, which is correct
  composition. No card was removed.
- **Warm-up library** (Phase 20) untouched, as instructed.

### Contract 106

Thirty-four assertions: Today's five block gaps share one token and the section
rule is still a section rule; each replaced symbol draws from the family grid;
no rendered UI still carries those characters; the haptic fires on completion
and not on re-opening; the exercise mark applies once and clears when a set
re-opens; the settle stays under 1.02; and the drag, PR reveal and set button
animations are all still present.

No assertion was re-pointed this phase.

### Measured

375×812, 390×844, 812×375, 844×390 and 932×430, across five tabs, four Progress
sub-tabs and six sheets: **no clipping, no text under 11px, no control under
44px, no field under 16px, no horizontal overflow.**

Performance: 20 tab switches in **39.5ms (1.98ms each)**; 20 sheet open/close
cycles in **0.5ms (0.03ms each)**; zero intervals leaked, zero listeners
retained, one active view and one active tab throughout.

Data: fifteen `DATA_KEYS` byte-identical after the full sweep. D17 accessibility
intact — dialog role, focus in and out, Escape, scroll lock. The trainer is
untouched and remains `0.1.1-shadow`.

## §32 — Momentum says something true

Momentum was three numbers. Measured against a real athlete with **perfect
adherence** — three weeks, four of four every week, nothing missed — it read:

> **0** Week streak · **25%** On target · **0** PRs this week

Every one of those was wrong or misleading.

### What "on target" actually was

```
overallConsistency = totalWorkouts / (plannedPerWeek × 12 weeks)
```

The denominator projected the **current** schedule back across twelve weeks
regardless of how long the athlete had been training. Someone three weeks into
a four-day plan has a ceiling of 12/48 = **25%**, no matter how perfectly they
train. It measured **tenure, not adherence** — and it punished new users, plan
changes and deloads, which is precisely backwards.

It was removed rather than reworded. The underlying calculation is untouched:
it remains defensible in Progress, where it is labelled and guarded behind four
weeks of history.

### The streak bug

`computeWeekStreak()` counted the week in progress as already broken. An
athlete who had trained eleven weeks running read **0** from Monday morning
until their first session of the new week. Measured directly: the same athlete
read **0**, then **4**, from logging one workout.

Fixed in `computeWeekStreak()` itself — a week that has not finished cannot
have been missed — so all five callers get the correct number. One definition,
repaired, not a second one.

### The information model

Three questions, in the order a *Today* screen should ask them:

| | reading | source |
|---|---|---|
| **This week** (primary) | `3 of 4` plus one dot per scheduled day | `computeConsistencyData().weeks[last].days` |
| **Consistency** | week streak, shown only at 2+ | `computeWeekStreak()` |
| **Progress** | PRs this week, else "N of M lifts improving" | `computeWeekSummary().prs`, `computeExerciseTrends()` |

**This week leads because it is the only reading the athlete can still act on
today.** Consistency and progress are history; this week is a decision. Three
peer tiles were rejected for exactly that reason — equal weight answers none of
the three questions first.

Every number traces to an engine that already existed and is used elsewhere. No
new storage key, no second definition of a workout, streak, PR or week.

### Nothing claims more than the data supports

- Under three sessions: "You are getting started." No trend, no streak.
- A streak appears at two weeks. A broken streak shows **nothing** — not "0".
- No PRs and fewer than two tracked lifts: progress says nothing at all rather
  than showing a zero.
- Nothing scheduled: "Nothing scheduled this week — a planned rest."
- A finished week that fell short: "You trained 2 of 4 this week." Stated, not
  scolded — the dots already show which days went.
- Missed days use `--warning`, never `--error`.
- Rest days are not drawn, because nothing was asked of them.

### A second bug, found by testing more than one plan

`momentumWeek()` compared a day's calendar date against `todayKey()`, which
returns a **weekday name**. The comparison never matched, so a session
scheduled for today read as **already missed**. It was invisible on every plan
that rests on the current weekday and only surfaced on a five-day plan. Fixed
to `localDateStr()`.

A third, in the same pass: `remaining` was `planned − done`, which counted days
that had already gone past as still trainable — on a Wednesday it promised four
workouts left when only Thursday and Friday remained. It now counts only days
that can still be trained.

### Edge cases verified in a real browser

Brand-new · 1 session · 2 sessions · complete week · week in progress · missed
days with days still ahead · deload (plan cut to two days — reads *on track*,
not failing) · full rest week · broken streak · multiple PRs · no PRs with
lifts trending up · 3-day, 4-day and 5-day plans · today trained vs untrained.

### Contract 107

Thirty assertions: the tenure percentage is gone from Momentum but intact in
`computeConsistencyData`; the streak skips the in-progress week and is still one
function; the week reading reuses the consistency day states; today is compared
as a date; remaining counts only trainable days; every metric traces to an
existing engine; a beginner gets no trend; a broken streak shows nothing; rest
is not a miss; missed uses the warning hue; the dots carry a spoken summary; and
no trainer symbol appears anywhere in the section.

**One assertion was re-pointed**: `Today momentum returns with data` checked for
`mo-val`, the value class of the three tiles that no longer exist. Replaced by
three stronger checks — an athlete with data gets a real reading rather than the
empty state, it leads with this week, and the projected-target percentage never
appears.

### Safety

Twenty-five consecutive Momentum renders plus a full tab sweep wrote **nothing**:
fifteen `DATA_KEYS` byte-identical, XP unchanged, PR count unchanged, trainer log
untouched. `DATA_KEYS` still holds fifteen entries. The trainer remains
`0.1.1-shadow`.

## §33 — The workout is a sequence (Phase D18)

The workout was one long page: every exercise stacked, so finding the lift you
were on meant scrolling past the ones you had finished. It is now warm-up →
one exercise at a time → finish.

### The architectural constraint that decided the design

**LOOP's workout state IS the DOM.** `captureActiveDraft()` and `saveLog()` both
read their values straight out of the rendered inputs — every `.ex-log-row`,
every `.set-row`, `#logTitle`, `#logDate`, `#logNotes`.

So the obvious implementation of "one exercise per screen" — render only the
current exercise — **would have silently destroyed workout data.** Autosave
fires 250ms after any input and on `pagehide`; the moment the athlete moved to
exercise 2, exercise 1's sets would have been absent from the DOM and therefore
absent from the next write. Mid-workout, invisibly, on real users.

Therefore: **every exercise row stays mounted, always.** This is a visibility
layer. The stepper decides which row is visible and nothing else. Autosave,
draft restore, rest timers, recommendations, PR detection and replacement all
still see the whole workout, and none of them were modified.

Proven end to end in a browser: sets logged on exercises 1, 2 and 3 while
stepping between them appeared in the persisted draft with their distinct
values, survived a reload, and saved to `workoutLog` as one entry containing
all eight exercises.

### What the athlete gets

- **Warm-up as stage zero**, using the existing prep system untouched. It only
  leads a workout that has not started — resuming one with three exercises
  logged opens on the fourth, not on "Prepare to train".
- **One exercise per screen**: number, a segmented bar, the name, and muscle
  chips from the existing `musclesForExercise()` lookup.
- **A segmented progress bar that is also the navigation** — each segment
  carries that exercise's real state (done / skipped / current) and jumps to it.
  It reads as a 4px rule and is tapped as a 44px one.
- **Previous / Skip / Next**, with skip meaning "move past this for now":
  the row keeps everything in it, the segment shows it as skipped, and tapping
  that segment returns to it. Row count before and after a skip: 8 and 8.
- **A finish step** carrying the workout name, date and notes — the fields did
  not move out of the sheet, so every existing reader still finds them by id.
- **200ms transitions**, removed entirely under reduced motion.

### What was deliberately not built

**Exercise descriptions.** The brief asked for a one-line explanation per lift.
LOOP holds no per-exercise coaching text, and writing form cues for 200+
movements is a content project, not a UI phase — inventing them would be both
fabrication and, for form advice, unsafe. The screen shows what LOOP genuinely
knows: muscle focus, the recommendation, last time, and the athlete's own note.

**Swipe navigation.** The brief said to implement it only if it can be made
reliable. The exercise screen contains number inputs, a select, RIR buttons and
a scrolling set list; a horizontal gesture over that surface competes with
every one of them and with the iOS back-edge gesture. Explicit navigation is
used instead, which is what the brief asked for in that case.

### Two bugs found by testing paths rather than the happy path

- **Resume opened on the warm-up** even with three exercises already logged.
  Now lands on the first unfinished exercise.
- **Freeform workouts open with zero rows**, so the stepper stood down (correct)
  but "Next" went to the review, and adding the first exercise left the athlete
  on a review screen for a workout they had not started. Adding the first row
  now lands on that row.

### Contract 108

Thirty-seven assertions. The first group is the invariant: rows are hidden by
CSS and never unmounted, no stepper function touches `#logExercises` or a
`.ex-log-row` with `remove`/`removeChild`/`innerHTML=`, skip only sets a flag,
`saveLog` still queries every mounted row, and all eight ids appear exactly once.
Then the sequence, the state reading, the muscle lookup, the defensive wrapping
(a stepper failure leaves the old all-visible sheet, which is what it did
before), and that no stepper function writes to storage.

### Measured

375×812, 390×844, 812×375, 844×390, 932×430: no clipping, no control under
44px, no field under 16px, no horizontal overflow. 40 rapid step changes in
87ms (2.17ms each) with rows still mounted and exactly one visible. A rest timer
started on one exercise keeps running while the athlete steps away, completes
correctly off-screen and clears its interval. After a full session — open, step
through 24 times, close, discard — zero intervals left, zero listeners retained,
`workoutLog` and `trainerLog` byte-identical, fifteen `DATA_KEYS` unchanged.

The warm-up library, the rest timer architecture, the replacement engine and
the trainer are untouched. The trainer remains `0.1.1-shadow`.

## §34 — Warm-up once, rest always visible (Phase D18.1)

A refinement pass on D18. The stepper architecture is unchanged: every exercise
row stays mounted, the stepper controls visibility.

### The warm-up is a stage of a workout, not of the screen

Before: `closeLogSheet()` called `resetPrepCardForNewWorkout()`, clearing the
dismissal flag. So leaving a workout and returning put the athlete back on
"Prepare to train" — mid-session, with sets already logged. Stepping back from
exercise 1 re-entered it too.

The stage is now tied to the workout's own identity. `pendingDraftId` already
names a workout: `startTemplateLog()` and `openFreeformLog()` mint a new one,
`restoreDraftToSheet()` carries the saved one back. `warmupDoneForDraft` records
which workout has passed the stage, and it closes on **every** route into the
exercises — the button, a segment, Next, a restored draft — because it is
recorded inside `goToWorkoutStep()` rather than in one navigation path.

Three guards make it one-way:

- `goToWorkoutStep(STEP_WARMUP)` returns early once the stage has passed
- `prevWorkoutStep()` from exercise 1 does nothing rather than stepping back
- the opening stage requires all of: a warm-up exists, the stage has not passed,
  and no set has been logged

**It survives a reload without a new storage key.** The flag rides inside the
draft, which is already persisted. `workoutLog` was not given a new field and
`DATA_KEYS` still holds fifteen entries.

Verified: new workout opens on the warm-up; entering the exercises and then
navigating next / previous / by segment / off the sheet and back never brings it
back; a reload with no sets logged resumes on Exercise 1, not the warm-up.

### Skip is gone

The card has exactly one button — Start Warm-up — and the stage navigation has
one forward action. No control anywhere in the warm-up says Skip.

`skipPrep()` is left in place, now without a caller. It is three lines, it is
the warm-up system's own function, and this brief forbids removing warm-up
functionality; deleting it to tidy up would be the riskier choice.

### The D18 rest regression, fixed

D18 made the workout a sequence, which meant a rest timer started on one
exercise disappeared the moment another was shown. The timer kept running
correctly — it was simply off screen, which is worse than useless.

A compact readout now sits in the workout chrome, above the navigation, so it
covers nothing: not the exercise, the chips, the set inputs or the controls. It
shows **only** while the owning exercise is off screen, because on that exercise
the full dial is already there.

It holds no clock of its own. `updateRestPanelDisplay()` is the single place the
timer's visible state changes, so the readout is refreshed from there and from
the step change — it reads `panel.dataset.remaining` and cannot disagree with
the dial. Tapping it goes to the exercise that is resting.

Measured: `REST 1:15 Barbell Row`, 335×46 in portrait and 892×46 at 932 wide,
inside the viewport at every size, counting down, one interval throughout.

### Timer verification

Text fits inside the ring with **6.15px clearance at all seven required
durations** — 3:00, 2:00, 1:00, 0:30, 0:10, 0:01, 0:00. Completion fires
**exactly one** haptic, the ring completes, the interval clears, the readout
hides, and navigating between exercises afterwards does not restart it (haptic
total stayed at 1, running intervals 0).

Portrait → landscape → portrait with a live timer: stage, timer, readout, all
eight mounted rows and every logged value intact, one interval throughout.

### Contract 109

Thirty-four assertions across the warm-up stage, its persistence, the readout,
the timer architecture and the D18 invariants.

**Two existing assertions were replaced**, both because this brief deliberately
changed what they pinned:

- `the card offers exactly two actions` — the card now offers one. Its whole
  sub-block was framed "Start is the primary action, Skip is secondary", which
  describes a card that no longer exists. Replaced by: exactly one button, it is
  Start with primary treatment, and no skip control remains anywhere on it.
- `the warm-up only leads a workout that has not started` — D18's two-condition
  gate. Now pins the three-condition one, the third being the fix this phase
  exists for.

### Performance

60 rapid step transitions in 76ms (1.27ms each), rows still mounted, logged
values intact, zero leaked intervals, zero retained listeners.

The warm-up library, the rest timer architecture, the replacement engine and the
trainer are untouched. The trainer remains `0.1.1-shadow`.

## §35 — The warm-up is an entry (Phase D18.2)

### The bug

`renderPrepCard()` set `card.style.display = 'flex'` — an **inline** style, which
cannot be overridden by the stepper's `.stepper-on #prepCard{ display:none }`
rule. So the warm-up card stayed mounted and visible above every exercise for
the whole workout: measured on Exercise 1, a **138px bordered gradient box**
reading "WARM-UP ~4 MIN Prepare your body for today's workout".

That box is what made the workout feel like a container inside a container. It
was introduced by D18 — the CSS was right in intent and lost to a pre-existing
inline write.

**Availability and visibility are now different things.** `renderPrepCard()`
sets `dataset.available` and writes `display:none`; the stepper writes the
display outright, because a stylesheet cannot win against an inline style. The
stage gate asks the data flag rather than the style.

### The entry

Two choices, on the entry and nowhere else: **Start Warm-up** (primary) and
**Skip** (plain text). Either one spends the entry — `skipPrep()` and
`exitPrep()` both retire the card and call `goToWorkoutStep(0)`. The stage
navigation renders nothing, because the entry carries its own actions.

Inside the stepper the card drops its border, radius and gradient: on that
stage the warm-up is the only thing on screen, so a box around it wraps a
container in a container. Measured: `border 0px, radius 0px, no gradient`.

**Verified: the string "warm-up" appears in no visible element of any exercise
screen** — checked per element, not by scanning `innerText`.

### Skip came back, deliberately

D18.1 removed Skip entirely. D18.2 reinstates it on the entry alone, because
the warm-up became a pre-workout prompt — a decision with two answers — rather
than a stage to walk past. Three D18.1 assertions had to change with it; they
are listed below.

### Surface

`.sheet-page` already stripped the radius, border and shadow, so the workout was
never framed — the prep card was the frame. Beyond removing it: the head
separates with a rule instead of a filled bar (`.sheet` is already `--surface`,
so the background repeated it), the current exercise drops its border inside the
stepper, progress reads as one rail (a 2px line between round stops rather than
detached bars), and the forward action carries the accent while Previous and
Skip are plain text.

### Tests

**4117 → 4143.** Contract 110 adds 26 assertions.

**Four assertions were replaced**, three of them because this brief reversed a
D18.1 decision and one because it fixed a D18 bug:

- `prep card is shown when a workout opens` asserted `renderPrepCard()` sets
  `display:flex` — the exact write that caused this bug. Split into three
  stronger checks: the card reports availability, availability does not put it
  on screen, and the stepper is what decides.
- `the card offers exactly one action` / `and it is Start — no skip control
  remains` (D18.1) → the entry offers exactly two choices, Skip carries no
  button treatment, and skipping enters the workout.
- `exactly one button on the card` / `no skip control on the card` /
  `the warm-up stage offers a single forward action` (Contract 109) → two
  buttons on the entry, Skip lives there, the stage navigation stays empty, and
  no exercise screen mentions the warm-up.

One real regression was caught by the suite and fixed rather than accommodated:
my `exitPrep()` edit had moved `clearPrepTimer()` off the first line. It is
first again — the timer is cleared before anything else on the only way out.

### Measured

New workout → entry with both actions → Skip → Exercise 1, no warm-up anywhere,
and navigating next/previous/by segment never brings it back. Start Warm-up →
runner → exit → Exercise 1, no warm-up anywhere. Reload with three exercises
logged → **Exercise 1 with 100×5, 110×6, 120×7 intact**, 8 rows mounted, 1
visible, no warm-up. Save → one entry, 8 exercises, all three values correct,
draft cleared.

375×812, 390×844, 812×375, 932×430: no clipping, nothing under 44px, no field
under 16px, no horizontal overflow. 60 transitions in 463ms (7.7ms each), zero
leaked intervals, zero retained listeners.

The warm-up library, the rest timer, `saveLog` and the trainer are untouched.
The trainer remains `0.1.1-shadow`.

## §36 — Rotating does not resize the app (Phase D18.3)

### The root cause, and why it is one line

`-webkit-text-size-adjust` was **absent from the entire file**, so the computed
value on `<html>` was `auto`. That is the value that permits Safari's text
autosizing: iOS inflates text when a block's width grows relative to the
viewport, which is precisely what rotating to landscape does. The workout came
back from a rotation with larger type than it was designed with.

Every other candidate was checked and ruled out before changing anything:

| candidate | finding |
|---|---|
| viewport meta | already `width=device-width, initial-scale=1.0, viewport-fit=cover` |
| vw/vh typography | none in the file |
| `scale()` on the workout surface | none — the only `scale()` uses are keyframes and `:active` feedback |
| landscape rules changing field font size | none; the landscape block touches no field |
| fields below the 16px iOS zoom floor | **none** — measured 16px and 17px across every workout input |
| `user-scalable` / `maximum-scale` locks | absent |

So the fix is one declaration, and Contract 111 keeps each of the ruled-out
causes from reappearing.

**`100%`, not `none`.** `none` would also remove the athlete's own text
scaling. `100%` switches off Safari's *automatic* inflation while leaving pinch
zoom and Dynamic Type working exactly as before.

### Honest limitation

**The inflation itself could not be reproduced in this environment.** The
preview browser is Chromium-based and does not implement Safari's text
autosizing — measured font sizes were already identical between portrait and
landscape here. What is proven: the guard was missing (`auto` computed), it is
now `100%`, no other cause exists, and nothing regressed. The fix is the
documented remedy for the reported symptom, but the symptom is not observable
on this engine.

### Measured across the rotation cycle

Portrait 375×812 → landscape 812×375 → portrait → landscape 932×430 → 844×390,
with a live workout carrying three logged exercises, a RIR on each, a skipped
exercise and a running rest timer:

- **every font size identical at every orientation** — title 24px, chips 11px,
  exercise number 11px, navigation 14px
- values intact: `100×5@1`, `110×6@2`, `120×7@3`
- skipped state, current exercise and 8 mounted rows / 1 visible unchanged
- **exactly one rest timer** throughout, still running
- `visualViewport.scale` 1 at every size, zero horizontal overflow
- zero fields under 16px

Reloading **while in landscape**: the guard persists, the draft restores with
all three values and their RIR, the title is still 24px, and no warm-up appears.

**Data safety:** eleven storage keys compared before and after the full rotation
and reload cycle — **zero changed**. `workoutLog`, `trainerLog`, autosave, draft
restoration and `saveLog` are untouched, and the diff to `index.html` is this
one rule.

The trainer remains `0.1.1-shadow`.

## §37 — D18C: animated movement demonstrations

The reviewed figure renderer now ships. Every prep and cooldown movement that
has an authored animation shows a moving figure above the countdown; every
movement that does not shows the card exactly as before.

**The renderer decides nothing.** `PREP_MOVEMENTS` and `COOLDOWN_STRETCHES`
remain the sole source of truth for what an athlete is given.
`MOVEMENT_ANIMATION` maps a production movement id to an animation id and does
nothing else, so the production id stays canonical even where the drawing is
named differently. `animationForMovement()` returns `null` for anything
unmapped or unknown, and a `null` means no figure — never a substitute.

**Nine movements deliberately have no animation.** Seven are production-only
with nothing authored yet: `straight_arm_pulldown`, `monster_walk`, `band_row`,
`torso_twist`, `upper_back_round`, `rear_delt_stretch`, `spinal_twist`. Two are
the mappings D18A rejected: `march_in_place` is not drawn as a quad stretch and
`dead_bug` is not drawn as a hip hinge. Drawing either would teach the wrong
movement, which is worse than drawing nothing.

**One clock.** The renderer starts no interval and never reads `prepState`. The
existing countdown remains the only source of truth for duration; pausing calls
`pause()` on the figure and resuming calls `resume()`, which continues from the
pose it stopped on rather than restarting. Pausing no longer re-renders the
step — a rebuild would snap the demonstration back to its first frame on every
tap. Disconnecting cancels the animation frame, and `exitPrep()` empties the
runner so nothing draws behind a closed overlay. Measured: **zero** live
animation frames after twenty open/close cycles and forty rapid Next taps.

**Landscape.** Stacked, the figure and the countdown are together taller than a
375px screen and pushed the instruction off the bottom. They now share a
`.prep-stage` that becomes a row under `(orientation: landscape) and
(max-height: 500px)`, with the figure capped to the ring's height. Verified at
375×812, 390×844, 812×375, 844×390 and 932×430: no horizontal overflow, no
vertical overflow, instruction visible at every size. The
`-webkit-text-size-adjust` guard from D18.3 is untouched.

**Geometry.** All 31 animations swept across a full twelve-second cycle against
the `30 10 180 178` viewBox: **zero clipping**, tightest margin 2.2 units.

**Content.** Three approved replacements, ids unchanged: `cat_cow` →
Standing Cat-Cow, `chest_doorway` → Chest Opener, `glute_figure4` → Standing
Figure-4 — all three now doable beside a rack rather than on the floor. Five
movements added to the registry: `reach_rotate`, `band_passthrough`,
`hamstring_sweep`, `deep_squat_hold`, `reverse_lunge`. **No sequence was
changed**, so no athlete is given a different warm-up; adopting the new
movements into `PREP_SEQUENCES` is a programming decision, not a rendering one,
and is left open deliberately.

**Vendoring.** `loop-movement.js` is the source of truth and is copied into
index.html by `node sync-movement.js`. A contract holds the two byte-identical,
so forgetting to sync fails the suite instead of shipping a renderer that
disagrees with the review tool. It is inlined rather than linked because a
linked file would need its own service-worker cache entry to survive a gym with
no signal, and because the harness only evaluates the largest inline block.

**Isolation.** `DATA_KEYS` is still exactly 15. The renderer writes nothing,
defines no key, and references no trainer symbol. Zero protected-symbol lines
appear in the `index.html` diff.

The trainer remains `0.1.1-shadow`.

## §38 — D19: the workout as one journey

Warm-up, exercises and review are now one track rather than three screens that
happen to follow each other.

**The finish action belongs to the end.** "Finish Workout" was a permanent
sibling of the navigation, so the loudest button on screen sat under the
warm-up and under exercise 1 — offering to end a workout against work the
athlete had not started. It is now rendered only on the review step (and on a
workout with no exercises at all, which never enters the stepper). It is
withheld by not existing, not by opacity: there is nothing to tap and nothing
to reach by keyboard. The final exercise's forward action reads **Finish
Workout** and leads to the review, which carries the save.

**The rail is the backbone and starts at the warm-up.** `workoutStepBarHtml()`
renders on all three branches — warm-up, exercise, review — and leads with a
warm-up stop whenever one is offered. Completed stops are filled, the current
one is filled, ringed and scaled, untouched ones are flat grey: three states
that differ in shape as well as hue. Every stop names its own status in its
`aria-label`, including the genuine "complete, current" of a warm-up an athlete
has tapped back into.

**Returning to the warm-up is deliberate and free.** Automatic re-entry stays
one-way — D18.1 fixed a bug where the warm-up reappeared by itself, and
`goToWorkoutStep()` still refuses `STEP_WARMUP` once the stage has passed.
`returnToWarmup()` bypasses only that guard. Nothing is unmounted, marked or
rebuilt: measured across a return trip, weight, reps, RIR, set type and
completion all survive unchanged, with all eight rows still mounted.

**The position countdown is a phase, not a second timer.** Timed warm-up
movements open on a three-second "Get ready" count driven by the *same*
interval as the movement, with the same wall-clock deadline discipline
(`readyUntil` then `endsAt`). The three seconds sit in front of the movement,
never inside it — a 30-second stretch still gets 30 seconds. Rep-based
movements are untouched: no countdown, no timer, no pause. Pausing re-anchors
whichever phase is running. Measured: never more than **one** interval across
20 rapid Next, 20 rapid Previous and 20 open/close cycles, and zero after exit.

**The warm-up ends in the workout.** The last movement's primary action is
**Continue to Workout** and lands on exercise 1. The old "Prep Complete" screen
existed to carry the main-lift ramps; those now render on the exercise page
when no working weight is known yet, in front of the lift they describe, so
nothing was lost by removing the screen.

**One rest at a time.** Completing a set starts that exercise's rest, and
nothing used to stop the previous one — two countdowns could run while the
workout's rest readout pointed at only one and the other ran down unseen.
Starting a rest now stops and puts away any other. Measured across three
exercises: exactly one live rest timer at every point.

**Set rows are a list, not a card stack.** Each set was a filled, bordered,
rounded box containing two more filled, bordered, rounded boxes — three
container layers for two numbers. In the stepper the outer layer is gone,
leaving a hairline separator and the steppers as the only things that look
tappable. Measured: 18 rounded containers per exercise down to 14. Completion
reads as an inset success edge plus the existing animated tick.

**Measured.** Portrait 375×812 and 390×844, landscape 812×375, 844×390 and
932×430: the whole warm-up fits one viewport in both phases with no scrolling,
zero horizontal overflow in seven workout states, inputs at 16px, touch targets
at 44px, and identical type sizes across rotation with a live workout. Rail
render 0.46ms, exercise transition 7.6ms, set completion 2.95ms; exercise rows
keep node identity across 30 transitions, so stepping re-renders nothing.

`DATA_KEYS` is still exactly 15. Zero protected-symbol lines appear in the
`index.html` diff. The trainer remains `0.1.1-shadow`.

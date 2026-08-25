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

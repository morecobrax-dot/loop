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

## §39 — D19.1: rest holds its answer

The rest card exists to answer two questions — *did my rest start?* and *did my
rest finish?* — and before this phase it answered neither reliably.

**It starts where the athlete can see it.** The card lived at the bottom of the
exercise row's content, which on any real exercise is below the fold: measured
at 375×812, completing a set produced a card at y=1125 on an 812px screen —
no visible change at all. While its exercise is the visible step the card now
pins to the foot of the scrollport (`position: sticky`), laying its 12%-alpha
tint over a solid surface so scrolling content cannot bleed through, and enters
with a short rise. Measured after the change: completing a set puts the card at
627–713, fully in view, at every tested viewport; in short landscape it pins
within the scrollport at the athlete's actual completion scroll position.

**It holds at zero.** `completeRestPanel` used to hide the card four seconds
after completion. It now holds the done state — green ring, check, "Rest
complete", controls stepped aside — until the athlete demonstrably starts
working again: adjusting a weight or rep count (both entry paths funnel through
`propagateSetValueForward`), recording an RIR, or completing the next set
(which starts a new rest and resets the panel). `dismissRestComplete()`'s only
timer is the 280ms exit-animation handoff. Measured: still visible and still
done 4.5 seconds after zero; dismissed with a settle on the next stepper tap.

**A finished rest is visible from anywhere.** The compact chip used to vanish
at zero — the chime fired once and the evidence disappeared with the hidden
row. It now falls back to a held completion (`heldRestCompletePanel`) and
renders it in the same green completion voice; tapping it still jumps to the
exercise where the next set is. A new rest anywhere retires a held card, so
exactly one rest surface exists at all times — measured across three
exercises, twenty rapid pause/resume cycles, and repeated forced completions
(one haptic, one live interval, deterministic state throughout).

**The rail survives a long workout.** At ten or more stops the rail switches to
dense drawing: 9px dots (13.4px gaps — wider than the dots, so the row still
reads as stations) while every stop keeps its full-height, full-column touch
area. Off at nine or fewer. Measured at 13 stops: no horizontal overflow, 44px
column heights unchanged.

**The warm-up stage.** The category chip — the only boxed element on the card —
became quiet letterspaced text, the movement name gained a step (26→28px), and
the figure stands in a faint static pool of the accent
(`radial-gradient`, painted once, never animated). Re-audited after the
changes: 97 warm-up/cooldown states across 31 movements at five viewports,
zero overflow, zero clipping.

Zero protected-symbol lines in the diff. `DATA_KEYS` still 15. The rest states
are presentation only — nothing here writes storage. The trainer remains
`0.1.1-shadow`.

## §40 — D19.2: the forward control is the state

The workout offered Previous, Skip and Next at once. Skip and Next answered the
same question — *move on* — and left the athlete to work out which one applied
to them. There is now one way back and one way forward, and the forward control
names the state it is in.

| Current exercise | Left | Right |
|---|---|---|
| Incomplete | Previous | **Skip** |
| Complete, not last | Previous | **Next** |
| Last, incomplete | Previous | **Skip** |
| Last, complete | Previous | **Finish Workout** |

Skip and Next can never render together: one ternary chain produces exactly one
forward descriptor and the navigation emits exactly one `.ws-nav-fwd` button
from it. Skip takes the same slot and size — the thumb never hunts — but is
outlined rather than filled, because moving on without finishing is a choice
the interface offers, not one it urges. `#wsFinishBar` stays empty on every
exercise, so the actual save still lives only on the review step.

**One idea of "finished", finally named.** `exerciseRowDone()` answered two
different questions with one test: it returned true when *any* set was
completed. One logged set of three painted the rail green and outranked a skip,
making a half-done exercise indistinguishable from a finished one. It is now
split — `exerciseRowStarted()` (anything logged, which is what decides whether
a workout is under way) and `exerciseRowComplete()` (every set on the exercise
completed, the same test `markExerciseComplete()` already used to turn the row
green). Completion is read from the set rows rather than the `.ex-complete`
class, so adding a set to a finished exercise correctly makes it unfinished
again. A warm-up set left unticked keeps the exercise incomplete, so warm-up
work can never unlock Next while working sets remain.

**Skipped is current state, not a verdict.** Skipping sets a DOM flag and moves
on; it never touches the athlete's sets, writes no storage, and adds no key —
the draft has no `skipped` field. Returning to a skipped exercise shows every
set exactly as it was left. Completing the outstanding work clears the skip
outright: `skipped → completed` on the rail, `Skip → Next` in the navigation,
no reload. Measured end to end: 2 of 4 sets logged → Skip → rail reads skipped
with both sets preserved → return → finish the remaining sets → rail reads
completed and the flag is cleared.

**The control changes when the state does.** `syncWorkoutCompletionState()` runs
on set completion, un-completion, addition and removal, repainting the rail and
the forward control under the athlete's thumb. A 0.18s fade marks a genuine
change of forward action and does not replay when merely moving between
exercises; it bows out under reduced motion.

**The navigation is the foot of the surface.** `.ws-nav` had no bottom padding
and no safe-area inset, and sat flush against an emptied `#wsFinishBar` that
still painted its own background and `border-top` — a 29px ruled strip of
nothing under the controls on every exercise. The bar now hides when empty
(`.sheet-actions:empty`), and the inset lives on the navigation where the
controls actually are. Measured at all five viewports: dead space below the
navigation **0px**, both controls 48px, no content covered, no horizontal
overflow.

**Skipped reads without colour.** The rail's skipped stop is a hollow ring in
the muted warning tone — the shape says "nothing filled in here" on its own,
and it never reaches for the danger red that would call it a failure. Solid
green for complete, hollow amber for skipped, flat grey for untouched, filled
and ringed for current. Every stop still states its status in words, and a
skipped exercise is never announced as completed.

Rapid interaction is deterministic: 20 Skip, 20 Next, 20 Previous and 20
alternating Previous/Skip each settle to a valid step with the rail intact, 8
rows mounted, and exactly one live interval throughout. Five consecutive skips
wrote nothing — `workoutLog`, `cardioLog`, `trainerLog`, XP, level, PRs,
`exerciseNotes`, `gymProfile` and `programs` all byte-identical before and
after. `DATA_KEYS` is still 15. Skip is not a trainer signal and does not reach
one. The trainer remains `0.1.1-shadow`.

## §40.1 — D19.2.1: completion visuals read the same truth

D19.2 left one surface behind. `markExerciseComplete()` only ever *adds*
`.ex-complete`, and `toggleSetComplete()` only removes it when a set is
un-ticked — so a set **added** to a finished exercise left the row green while
the navigation correctly showed Skip. Two surfaces describing one state, and
disagreeing.

`syncExerciseCompleteVisual()` recomputes the class from
`exerciseRowComplete()` — the same predicate the navigation and the rail use —
and runs from `syncWorkoutCompletionState()`, which already fires on all four
mutations: complete, un-complete, add, remove. The class is never the source of
truth; it is read only to decide whether the settle animation should replay, so
re-syncing an already-complete row does not re-animate it.

Verified through the real UI at 375×812: fresh → all complete → add an
incomplete set → complete it → remove one, with the class, `exerciseRowComplete`
and the forward control agreeing at every step. Geometry is byte-identical at
375×812, 390×844, 812×375, 844×390 and 932×430 — the change is additive
JavaScript, with no CSS and no layout touched. `DATA_KEYS` still 15, trainer
still `0.1.1-shadow`.

## §41 — D20: editing a completed workout

A saved workout is what actually happened; a template is what was intended.
The editor changes the former and only the former.

**Entry.** Secondary actions on both completed-workout surfaces: `Edit` beside
`Done` on the post-save summary (Done stays primary), and `Edit` in the day
detail beside Close and Delete. Existing deletion is untouched.

**The edit lives in memory.** `openWorkoutEditor()` takes a deep copy; typing
writes to that copy and never re-renders the form (only adding or removing a
set or exercise redraws). No new storage key exists — `DATA_KEYS` is still 15 —
so an interrupted edit simply evaporates rather than half-persisting. Cancel
writes nothing, and warns first when there are unsaved changes.

**Save is one write of one record.** The workout is found by its own id and
replaced in place; the editor never pushes, never reassigns `workoutLog`, and
never calls `LOOPStore.set` — persistence goes through the same `persistLog()`
every other history change already uses, which is also what invalidates the
derived caches. A failed write puts the original back. A second tap while
saving is ignored. Identity and provenance — `id`, `category`, `startedAt`,
`endedAt` — are carried over rather than regenerated.

**What it writes matches what a live workout writes.** The record is rebuilt
exactly as `saveLog()` builds one: empty sets dropped, exercises left with no
sets dropped, `effort` re-derived from the RIR actually recorded, bodyweight
exercises still storing `BW`. A set type that was never recorded stays absent
rather than becoming "Working" — the editor's type control carries an explicit
*Not recorded* option for exactly this. A set added in the editor is empty; it
fabricates no performance data.

**Sets have no identity of their own** — they are positional. Removal splices
by index so neighbours keep their values, and destructive removals ask first.

**Derived systems recompute; none is reinvented.** XP, PRs, consistency,
mastery, substitution ranking and volume all derive from `workoutLog` and
recompute through `persistLog()`'s existing invalidation. Records are read
through the existing `computeExercisePREvents()`, and no PR snapshot is
persisted to paper over a record an edit invalidated. One addition:
`invalidateProgramCache()`, because `getProgramProgress()` counts sessions in a
date window but keys its cache on the log's *length*, which an edit never
changes.

**The trainer never sees a correction.** No shadow outcome is linked, no
`trainerLog` entry appended, no recommendation generated — asserted against the
editor's source, not just its behaviour. A historical correction is not a new
observation and must not contaminate the active shadow experiment.

**Measured** against a populated fixture (3 workouts, 5 set types, bodyweight
and barbell exercises, cardio, notes, trainer log, gym profile): editing one
workout left `wB`, `wC`, `cardioLog`, `trainerLog`, `exerciseNotes`,
`gymProfile`, `programs`, the log length and the engine version **all
byte-identical**. XP recomputed 367 → 349 after a set was removed. 20 rapid
Save taps produced one workout with two sets and no duplicates. A record
changed underneath the editor prompts rather than overwriting; one deleted
underneath it is not resurrected. Backup round-trip preserves ids, set types,
RIR and notes. Five viewports: no overflow, inputs 16px, controls 44px.

The trainer remains `0.1.1-shadow`.

## §41.1 — Premium editor polish

D20's editor worked but read as a database form. Measured before the pass, on
one workout of three exercises: **30 bordered boxes**, **23 visible labels for
26 inputs**, the workout title set at the same 16px/400 as every field, and
1790px of content in a 673px viewport.

**Header.** The title is now set as the heading of the thing being edited —
24px/700 Space Grotesk, borderless — with the date beside it as a line of text
rather than a boxed field. The native date control is kept: it is the reliable
one, and the brief is right that a custom picker would be a downgrade.

**Sets are columns.** The per-field labels became one column header per
exercise (`Weight · Reps · RIR · Type`), and the fields inside a row lost their
borders — the row is the container now, not each input in it. Weight and reps
take the free space in mono at 16px/700; RIR and Type are sized to content and
carry secondary colour. Removal is a quiet × at 55% opacity that reaches
danger red on hover, rather than every row wearing a permanent red control.

**Result:** 30 boxes → **5**, 23 visible labels → **0** with every one of the
26 controls still carrying an accessible name, content height 1790 → **1085px**.

**Two mobile regressions I introduced and fixed.** Shrinking controls for
visual quiet put four of them under 44px and three inputs under 16px — the
latter would re-introduce the iOS focus-zoom that D18.3 fixed globally. Both
are now contract-guarded: every editor control declares `min-height: 44px` and
every editor input declares at least 16px, asserted rule by rule.

**Two performance regressions, likewise.** The 211-option exercise suggestion
list was being re-parsed on every redraw (render 3.4 → 10.8ms), and focusing a
newly added set forced a synchronous layout costing **26.7ms** on its own —
adding a set took 27.7ms, well over a frame. The list is now built once outside
the redrawn region and the focus is deferred by a tick. Measured after:
add set **7.1ms**, remove set **6.0ms**, redraw **6.6ms**, keystroke
**0.0035ms** — typing still never redraws anything.

**Add exercise** reuses `EXERCISE_LIBRARY` through a native suggestion list on
the name field: a picker and free text in one control, no intermediate screen,
no second registry.

Behaviour is unchanged from D20 and re-verified: save is still one atomic write
through `persistLog()`, effort still derives from RIR (8 → 5 on edit), the
conflict and deleted-underneath guards still hold, 20 rapid saves still produce
one record, and editing one workout left the other workout, `cardioLog`,
`trainerLog`, `exerciseNotes` and the engine version byte-identical.
`persistLog`, `saveLog` and `deleteLog` are untouched by this diff, no new
storage write exists, `DATA_KEYS` is still 15, and the trainer remains
`0.1.1-shadow`.

## §41.2 — Editor polish: affordance, removal, long titles

Three limitations I flagged at the end of D20.1, each measured before it was
touched.

**Editable values looked static.** Measured: transparent background, `0px`
border — a weight was indistinguishable from a label. Each editable value now
carries a single hairline beneath it, drawn as `box-shadow: inset 0 -1px 0
var(--border)` rather than a border, so focus can thicken it to 2px in the
accent without moving the layout by a pixel. A disabled field (a bodyweight
load) drops the line entirely: nothing to change there, so no invitation. The
selects gained a small caret, because a value that reads as a word ("Working")
gives no other sign it opens a menu once `appearance: none` removes the native
arrow. No boxes returned — the row is still the container.

**Focus had no state at all.** Measured: `outline: 3px none`, no shadow, no
background change. Focus now takes the accent underline and accent text, at
0.14s, with no layout shift and no glow.

**Removal was 30px wide at 55% opacity.** Below the 44px touch minimum and
hard to find. It is now a full 44×44 target with a faint neutral circle at
rest, reaching danger red only on hover or keyboard focus. Quiet, but shaped —
and the circle is what makes the touch area visible rather than merely present.

**Long titles were clipped.** Measured: a 75-character name reported
`scrollWidth 915` against `clientWidth 335` — 580px scrolled out of sight
inside a single-line input. The title is now a textarea that wraps and sizes to
its own content (44px at one line, 118px at three on a 375px screen), while
remaining a single value: newlines are stripped on input. It keeps 24px/700.

Two bugs found and fixed while doing this, both mine:

- Sizing the title inside `renderWorkoutEditor()` measured a **hidden**
  element — `scrollHeight` reads zero before the sheet opens, which left a
  wrapped title clipped to one line rather than grown. It is now sized after
  the overlay opens.
- That same measurement forces a synchronous layout, and doing it inside the
  redraw put every operation over a frame (render 6.6 → 26.3ms, add set 7.1 →
  28.7ms). Deferred by a tick, as the focus call already was. After:
  render **7.5ms**, add set **9.0ms**, remove set **7.3ms**, keystroke
  **0.0035ms** — all inside a frame, typing still redraws nothing.

Verified at 375×812, 390×844, 812×375, 844×390 and 932×430 across short,
normal, long-title and eight-exercise workouts: no horizontal overflow, no
control under 44px, no input under 16px, every control accessibly named, the
title fully shown in every case, and Save/Cancel on screen.

Behaviour is unchanged and re-verified: atomic save, derived effort, conflict
and deleted-underneath guards, cancel discarding, 20 rapid saves producing one
record, and editing one workout leaving the other workout, `cardioLog`,
`trainerLog`, `exerciseNotes` and `gymProfile` byte-identical. The diff touches
no persistence function, adds no storage write and contains no data logic —
`persistLog`, `saveLog` and `deleteLog` do not appear in it. `DATA_KEYS` is
still 15 and the trainer remains `0.1.1-shadow`.

## §41.3 — Edit opens on the first tap

**The bug.** From the completed-workout summary, tapping Edit appeared to do
nothing; the editor only became visible after a second, unrelated tap.

**Root cause, traced not guessed.** Every overlay in LOOP shares `z-index: 60`,
so which one is seen comes down to document order — and `#summaryOverlay`
(line ~5517) sits *below* `#editWorkoutOverlay` (line ~4951) in the markup.
`openWorkoutEditor()` opened the editor correctly, but left the summary open on
top of it. Measured after a single tap: `editorOpen: true`, editor rendered at
`top: 0` × full height — and `document.elementFromPoint()` at the centre of the
screen returned `stat-num`, **inside the summary**. The athlete's next tap
landed on the summary's backdrop, which runs `backdropDismiss(closeSummary)`,
dismissing it and revealing an editor that had been there the whole time.

**The fix is ordering, not stacking.** Opening the editor from the summary now
stands the summary down, and backing out puts it back exactly as it was —
nothing changed while it was away. No `z-index` value was altered; a contract
asserts the editor's `openWorkoutEditor` contains no stacking change (reading
code, not the comment that explains why). Save is unaffected: it already
rebuilt the summary from the corrected record.

**A second broken button, found by the required audit.** After one successful
save, `#ewSaveBtn` stayed `disabled`, labelled "Saved", carrying `is-saved` —
the element is static markup, so reopening the editor presented a green button
that did nothing. A second edit could never be saved. Introduced by the D20.2
save-feedback state; the button is now reset every time the editor opens.
Verified by saving twice in one session: the second save lands.

**Every button audited, one tap each.** Summary: Edit, Done, Delete (declining
leaves the workout intact). Editor: Back, Cancel, Save, Add set, Remove set,
Add exercise, Remove exercise, title/date/notes, and every set field. A
hit-test over each editor button confirmed nothing invisible intercepts it.

**Rapid taps.** Twenty consecutive taps on Edit leave exactly one open overlay
and one editor state; a repeat tap while the editor is up is ignored rather
than reopening, so typed changes survive it.

**Lifecycle.** Edit→Cancel ×3, Edit→Save, reopen→Edit→Cancel, then a second
Save: every edit step shows the editor and only the editor; every cancel step
returns to the summary with state cleared; overlays never stack.

Verified at 375×812, 390×844, 812×375, 844×390 and 932×430 — the editor opens
at `top: 0`, never below the fold, with Save and Cancel hit-testable in all
five. Cancel writes nothing (storage byte-identical); save writes only the
intended record, with `wB`, `cardioLog`, `trainerLog`, `exerciseNotes` and
`gymProfile` unchanged. `DATA_KEYS` is still 15 and the trainer remains
`0.1.1-shadow`. The diff touches no persistence function and adds no storage
write.

## §42 — D21: training truth and the premium surface

**The lie, found where it was made.** A template prefills weight and reps into
every set, and `saveLog()` recorded any set whose input held a value — so a
skipped exercise saved with the plan's full numbers as if performed, and could
mint a PR for a lift that never happened. Worse, `linkShadowOutcomes()` read
the same raw inputs and scored the shadow recommendation MATCHED or DIVERGED
against them, contaminating the live experiment with fabricated agreement. And
`captureActiveDraft()` never carried the skip, so leaving and resuming a
workout silently un-skipped everything.

**The rule, applied at both mouths.** On a skipped row, only sets the athlete
ticked complete are performance. A fully skipped exercise saves as
`{ skipped: true, sets: [] }` — present in the record as a decision, absent
from it as training. A partial skip keeps exactly the completed sets. Rows the
athlete did not skip keep the long-standing behaviour (typed-but-unticked
logging predates the stepper and is not thrown away). The shadow snapshot
applies the identical rule, and with no sets and no explicit feedback, no
outcome is recorded at all: the trainer sees *not performed*, never
*performed the plan*. The draft now carries `skipped` per exercise and the
restore reapplies it.

**Every derived system is truthful by construction** — they all read sets, and
a skip has none. Measured behaviourally: two identical histories, one with an
extra skipped exercise — XP, PR count and session volume byte-equal; no PR
exists for the skipped movement; the performed work in the same session keeps
its volume and its PR. Browser flows: a real template workout with prefilled
values, one exercise completed, one skipped → saved with `skipped: true`,
zero sets, no PR on that date, one trainer outcome recorded and it carries
`actualSets > 0`. Correction: Edit Workout shows the amber **Skipped** chip
and *Not performed*, with no green and no fake rows; recording 3×8@155 clears
the skip, derives effort from RIR, and mints the now-legitimate PR — while the
other five skips stay skipped. `workoutLog.push` exists in exactly one place,
so no schedule can fabricate history.

**The premium surface is a token change, not a paint job.** The base moved a
few degrees toward navy at the same lightness steps (`#070B12 → #0E141F →
#151D2B → #1C2636`), the accent stepped to a luminous cyan pair
(`#4CC2FF` / `#2E6BFF`), and three tokens were added: `--grad-accent` (built
only from that pair), `--glass-bg`, `--glass-border`. The gradient appears in
exactly two places — `.btn-primary` and the workout's forward control — the
glass on exactly one, the tab bar (blur 14px; three `backdrop-filter`
declarations in the whole app, overlay included). The rail's current stop
gains one restrained 9px luminous halo. Category and cardio hues keep their
own identities. Contrast is contract-computed, not eyeballed: text on surface
≥ 7:1, dim text ≥ 4.5:1, accent on bg ≥ 3:1, dark-on-accent ≥ 4.5:1.

Zero trainer symbols, zero storage writes and zero XP/PR functions appear in
the diff — the truth work changed only what feeds them. `DATA_KEYS` is still
15. The trainer remains `0.1.1-shadow`.

## §42.1 — D22: the standing leads Home; nothing zooms; the choosing surface

**Level moved to the header.** It sat at the foot of Momentum, a scroll below
the greeting. It is now a compact chip across from "Good evening" — level
number over a 3px gradient progress bar, 44px minimum, reading the same
`getCurrentProgression()` as everywhere else with no arithmetic of its own,
routing to the same profile, and wrapped so a progression failure cannot take
the greeting down. The Momentum copy is gone: one number, one place. Contracts
assert the header row, the shared read, the spoken label, and that no second
copy exists.

**A tap can never zoom.** The audit found this already architecturally closed
— `touch-action: manipulation` on `html`, `body` and `*` removes double-tap
zoom and the 300ms delay while keeping pinch; the only overrides are `pan-y`
and drag-lock `none`, which also refuse zoom; the viewport meta pins no
`maximum-scale`, so pinch stays available; and the D18.3 text-inflation guard
stands. What changed is that this is now contract-held: no rule may opt back
into `touch-action: auto`, and any new override must be a pan or a lock.
Measured: twenty rapid taps leave `visualViewport.scale` at 1.

**The Train card is the choosing surface.** It gains the deep gradient surface
and a 17px/700 heading; Start This Workout carries the same accent gradient as
every other primary forward action (fourth and final use of the budgeted
token); interaction answers with a border, not a glow. Information was neither
added nor removed — the card already said exercises, duration, muscles, focus
and plateau; the hierarchy just stopped being flat.

**FRONT / BACK resolved.** The body diagram's view labels were declared at 15
SVG units — ~18px rendered, larger than the workout's own name, in bare mono:
the "stray control". They are meaningful (two anatomical views), so they were
redesigned, not removed: 11 units — exactly the SVG floor a previous phase
established after finding these same labels at 4.74px — letterspaced into the
app's micro-label voice, rendering ~14px, now smaller than the name.

**The warm-up says how, and only how.** The focus line ("why this movement")
sat against the actions at the foot of the card, fighting Next for the same
ground. It is gone from the runner; the instruction — the how — keeps its
place between the name and the figure, asserted by position. The runner is a
centered column, so nothing is left holding a hole; the registry keeps its
purpose text for any future surface. The D19 assertion that the purpose line
trails the clock was replaced by its D22 inverse.

Storage-neutral: zero writes in the diff, `DATA_KEYS` still 15, three
backdrop-filters and four gradient uses in the whole app, trainer at
`0.1.1-shadow`.

## §43 — D23: rank identity — presentation over the same numbers

**One taxonomy, dressed.** The eight canonical ranks — ROOKIE through LEGEND —
and their level ranges are byte-identical to before; a contract pins the
lookup function's exact source. `RANK_VISUALS` adds only appearance: metal
pair, gem pair, card gradient, glow strength per rank. Hex values live in that
one config and nowhere else. XP and Level remain the only numbers; the
showcase computes none of its own.

**One medal, eight materials.** `rankMedalSvg()` is the single renderer for
every surface — the Home chip at 30px, the profile hero at 72, the showcase at
128, the promotion at 88. Drawn geometry only: bevelled metal ring, dark inner
well, faceted gem lit from above, a specular arc. Prestige is earned through
geometry and light, not ornament count — wings join at ELITE, the apex only at
LEGEND, glow rises with tier — and nothing on a medal animates. No emoji, no
raster assets.

**The showcase answers "where am I?" first.** It opens centered on the current
rank every time — never Rookie, never a remembered position — and a second tap
cannot open it twice. The carousel is pointer-driven with `touch-action:
pan-y`, so vertical stays the browser's; release resolves deterministically
(a third of a card or a flick moves one; anything less settles back), the
index is clamped to the taxonomy, and arrows and arrow keys are equals with
the swipe. Positioning reads the target card's own `offsetLeft` rather than
index × step — measured drift across all eight stops: ≤1px, after two real
bugs were found and fixed (transformed-width measurement, then per-step
integer rounding).

**States are worn, not hidden.** Achieved ranks stay fully visible; the
current card carries `CURRENT RANK` and one progress line (level, bar,
next-rank threshold — 48% measured for a level-17 COMPETITOR); locked ranks
show their full design dimmed with `REACHED AT LEVEL n` — aspiration, never a
question mark. Every card speaks its whole meaning
(`"LEGEND. Level 50+. Locked."`).

**The promotion is read, not invented.** A rank boundary is detected by
comparing `calculateRankFromLevel` across the level-before/after the XP
timeline already recorded — no second detector, no new event. The medal gets
one 0.9s settle and then holds; reduced motion removes it.

**Routes.** The Home chip now reads medal + level + rank and opens the
showcase; the showcase carries the one route on to the full profile, which
gained the same medal. Home previews, the showcase explores, the profile keeps
stats and achievements — no duplicated rank surfaces.

The system reads and never writes: zero storage calls in the whole rank
region, no remembered carousel position, `DATA_KEYS` still 15, gradient budget
still 4 and glass still 3, and the trainer remains `0.1.1-shadow`. Measured:
showcase opens in 13ms, a swipe step costs 0.9ms, Home renders in 7ms.

## §44 — D24: one job per surface

**Today: one hero, three states.** An active draft used to render a full
"Workout in progress" card *and* let the planned card render beneath it with a
second Resume — the same workout twice, half a screen saying one thing.
`renderResumeBanner()` now only resolves the draft truth; the hero itself
changes state. ACTIVE outranks everything, including a rest day the athlete
decided to train through (it returns before the rest branch — a placement bug
caught and fixed mid-implementation). COMPLETED says "Workout complete" and
offers View Summary; Resume ceases to exist anywhere on the page. The planned
branch structurally cannot offer Resume — those states return before it.
Measured: one hero and exactly one Resume in the active state; zero Resume
buttons after completion; the resume banner byte-empty; This Week visible
without scrolling (its position and Momentum's one-visual-two-signals shape
already satisfied §5–8 from earlier phases — reported, not rebuilt).

**Train: the card stops shouting.** The default face is name → emphasis line
(primary muscles bright, secondary faint, same `computeMuscleTotals` truth) →
two facts → body visual → Start. The radar, the exercise preview, the
primary/secondary rows, and Edit/Delete all live behind one native `<details>`
disclosure — still one tap, 44px summary, no JS state. Delete keeps its
confirmation and no longer stands beside Start. Measured at 375×812: default
card **359px** with **460px** of content moved behind Details (819px open),
and a second workout is discoverable without scrolling.

**Workout Complete: accomplishment first.** Delete left the hero corner for
the quiet foot of the scroll, same confirmation. The quality score now says
what it is out of ("80 **/ 100**") and carries a one-word band read off the
score itself — Excellent ≥85, Strong ≥70, Solid ≥50, else "Session logged" —
with the existing factor line as its explanation; the calculation is
untouched. The five equal stat cards became three (volume, sets, minutes);
the week streak rides the new identity line as a small reward chip beside the
D23 medal and level bar — the same renderer and the same
`getCurrentProgression()` read, with a plain-text fallback if progression
ever fails. Measured: Edit still opens the editor in one visible tap, Cancel
restores the summary, Save returns to it updated, and declining Delete leaves
the workout intact.

Storage-neutral throughout: zero writes in the diff, `DATA_KEYS` still 15, no
trainer symbol anywhere in it, trainer at `0.1.1-shadow`. Five viewports and
rotation: no overflow, no sub-44 controls on the touched surfaces.

## §43.1 — D23.1: the medal builds itself

D23's eight medals shared one geometry and differed mostly by colour — the
name said "ranked up", the emblem did not. The renderer now BUILDS: every tier
keeps everything below it and adds one structural idea, so the family reads as
a single medal growing more prestigious.

| Tier | Adds |
|---|---|
| ROOKIE | the foundation — one ring, dark well, four-facet gem |
| TRAINEE | a second hairline ring |
| ATHLETE | the hexagonal frame — first break of the circle |
| COMPETITOR | armored ring segmentation and a top crest tip |
| ELITE | full geometric wings, an inner halo, a lower rim light |
| VETERAN | weight — heavier ring, broader wings, the lower crest point |
| MASTER | the crown begins: upper crest, split outer arcs, an inner gem layer |
| LEGEND | the finished pinnacle, an outer armor octagon, and the one dual-material gem — violet heart in gold outer facets |

The gem evolves the same way (4 facets → kites → gleam → deep split → inner
layer → dual material), and the glow rises on a fixed ladder (0 → .06 → .10 →
.16 → .21 → .25 → .30 → .38) that a contract holds monotone and capped.

**The no-text test, in numbers.** Rendered and measured with the glow
excluded: element counts run 8 → 12 → 14 → 17 → 24 → 27 → 30 → 34, strictly
rising, and silhouette area runs 81 → 94 → 99 → 102 → 113 → 120 → 121 → 128
(×100 units²), monotone with LEGEND largest — the medals order themselves by
structure alone, which is also the greyscale guarantee. One real bug was
caught by that measurement: MASTER and LEGEND's widened wings overflowed the
viewBox (124 and 130 units against 120) and were silently clipped; the span
is now capped at 58 units and their extra breadth comes from crown, arcs and
armor instead. All eight verified fully in-box.

**Presence and states.** Each card's medal now casts a faint rank-coloured
pool into the card behind it (`gem[0]` at 8% alpha, closest-side radial —
never flooding). The current medal is 5% crisper and owns the family's only
motion: a 0.45s entrance settle when the showcase opens, removed under
reduced motion. Achieved medals keep ~92% of their light; locked medals stay
dimmed-but-visible, with the over-pinned exact filter values in the D23
contract replaced by a bounds check on the mechanism.

Everything else stands: the carousel, cards, ranges, names, XP, Level, and
promotion detection are untouched; the two pinned renderer lines (`wings =
tier >= 4`, `apex === 'LEGEND'`) survive verbatim. Contracts pin the ladder
itself — sixteen assertions covering per-tier layer arrival, monotone
complexity, ROOKIE-simplest, LEGEND-most-complete, determinism, and the glow
ladder. Rendering the whole family costs 0.27ms; a swipe step 0.84ms.
Presentation only: zero storage writes, zero trainer symbols, `DATA_KEYS`
still 15, trainer at `0.1.1-shadow`.

## §45 — D25: Progress tells the truth

Progress answers four questions — overall, strength, volume, mastery — and the
data behind them was already there. What changed is honesty and hierarchy, not
analytics: no new system, no new tabs, no new scores, no new storage.

**Guardian rules, now contract-held (Contract 122):**

- **UNKNOWN ≠ ZERO.** A 12-week chart over a 2-week-old log used to draw ten
  fabricated zero-weeks that read as ten weeks of not lifting. Every weekly
  chart now clamps its window to the weeks LOOP has actually tracked
  (`knownWeeklyBuckets`), draws only real history, and writes the clamp under
  the chart ("Showing all 2 weeks LOOP has tracked"). A tracked week with
  nothing logged keeps its faint stub — that is a real zero. Sparse charts
  are compact (104 units); real 12-week history draws full height with the
  current week as the one emphasized bar.
- **PARTIAL ≠ COMPLETE.** "This week vs last" scored a half-run week against
  a finished one and drew a down-arrow for every metric a Tuesday cannot yet
  have. The comparison is now *this week so far vs the same point last week* —
  both sides cover the same number of days, the foot says "Day N of 7 — last
  week is measured through the same day", and the deltas are neutral: lower
  is DOWN, not bad. The judged `cmpRow` is gone from the app.
- **Skipped work contributes nothing** (D21 truth preserved): a skipped
  exercise's empty set list adds no volume, no muscle sets, no Most Trained
  sessions — asserted behaviourally.
- **Words match calculations.** The "Strength" card measured tonnage; it is
  now **Training load — total weight lifted per week, volume load, not peak
  strength**. "30 set in the last 30 days" counted PR events; it now says
  "30 records in the last 30 days".

**One rank identity.** The Overview's generic level ring is gone. Progress
renders the same shared D23 medal every other rank surface uses (one
`rankMedalSvg` in the app, held by contract) with rank, level and a plain XP
bar from the same `currentXP / xpForNext` arithmetic as the profile — one tap
opens the existing rank showcase; the carousel is not reproduced. The early
state stopped implying the athlete is a beginner: "Building your baseline —
N sessions logged · N weeks tracked", with coverage attached to the reading
it qualifies instead of floating between sections.

**Consolidation.** "Most worked muscle" and "Muscle group volume" were the
same information twice; they are now ONE Muscle volume card — body figure,
top muscle named with its share, ranked bars — and the top value prints once.
Training distribution is one segmented bar with a counted legend (shares of
one whole, not four disconnected tracks), still explicitly not a judgement.
Mastery gained a summary (top exercise / top muscle / count — from
`getMasteryProgress`, nothing invented), level chips that climb a restrained
accent ladder (never rank materials), per-row progress toward the next level
from the existing deterministic standing, and disclosure controls that read
as part of the section. Muscle mastery is top-5 plus disclosure. The broken
"All records" tap — which toggled a container inside a different, hidden
panel — now discloses beside the Records card that opens it.

**Shell.** A fixed scrim (`z-index 55`, pointer-transparent, sized by
`env(safe-area-inset-top)`) paints the status-bar band in the page ground so
scrolled Progress text can never collide legibly with the system UI. Content
clears the bottom nav via the body's real `84px + inset` padding — measured
32px of daylight above the tab bar on every section. Subtabs reset scroll to
top like every other tab, and became quiet underline navigation (still 44px).

Verified in-browser: sparse (2-week) and rich (14-week) fixtures, same-point
week comparison against the mirrored day count, mastery disclosure round
trip, rank-hero → showcase → back, five viewports with zero overflow and no
clipped chart text, inputs at the 16px zoom floor, warm renders 9–13ms.
Presentation only: zero protected-symbol lines in the diff, zero storage
writes, `DATA_KEYS` 15, trainer `0.1.1-shadow`.

## §46 — D26: the phone is respected on every surface

D25 fixed Progress. The same defect lived in every full-screen overlay, and
this pass found its actual cause rather than its symptom.

**Root cause.** The device inset was carried as `padding-top` *inside* the
scrolling box (`.sheet-page .sheet-scroll`). Padding scrolls away. So on a
notched phone the content simply travelled up into the status region and sat
there perfectly readable behind the clock and the Dynamic Island. Measured,
with a 47px inset simulated across the 32-overlay inventory: **five pages
leaked** — Backup & Data (its own title at y=11), Athlete Profile
("Legendary Numbers" at y=32), Updates, My Gym, Plans.

**The fix, in three CSS rules.** The inset now *also* gets a painted band:
`.sheet.sheet-page::before` at the height of `env(safe-area-inset-top)`, in
the page's own `--surface` ground, `pointer-events: none` so it never eats a
tap. Scrolled content passes UNDER it instead of through it. An overlay that
brings its own opaque header keeps it — `.workout-topbar` is raised above the
band, so the band never paints over a title or a back control. Both sit above
every z-index used inside page content (the pinned rest card at 5 is the
highest), so no future sticky element can rise through the band. Pure CSS: no
listener, no measurement, no blur, one paint.

**A second defect fell out of the audit:** pages that already had an inset
header were paying the inset *twice* — the workout page had a **65px blank
strip** below its own topbar. `.workout-topbar + .sheet-scroll` now takes
plain padding, and the gap measured 18px after.

**Inventory: 32 overlays.** 16 full-screen pages (all now band-protected,
verified by hit-testing the status band at three x-positions on each, at all
five viewports) and 16 bottom sheets, which were already safe by their
`92dvh - inset` height cap — tops measured from 367px to 760px, none within
the band. No overlay was rewritten; the shared primitive was corrected once.

**What the audit confirmed already correct** (measured, not assumed): the
single body-lock/`MutationObserver` mechanism pins the background at
`position: fixed` with the exact offset (700px in, 700px out, no jump);
nesting reaches depth 2 with only the topmost surface hit-testable and the
page beneath unreachable; overscroll is contained on `.sheet-scroll`,
`.cs-body`, `.prep-run`, `.ob-scroll`, the overlay and the locked body; every
bottom action bar pads for the home indicator with 0px dead strip and ≥44px
controls; no input anywhere is under 16px; pinch zoom is still permitted
(`viewport-fit=cover`, no `maximum-scale`) while `touch-action: manipulation`
blocks tap zoom. A full workout — values, completed state, set type, RIR,
open sheets, row count — survived portrait→landscape→portrait unchanged.

**Rank.** "Full profile & achievements" genuinely opens the profile but was
drawn in the faint caption grey, which reads as disabled. It now uses the
accent — the app's own language for a secondary text link, the same voice as
`.sheet-back` — and still reaches 44px.

Contract 123 holds all of it. Layout only: the `index.html` diff is 34 added
lines of CSS with **zero JavaScript**, zero protected symbols, zero storage
writes; cycling all 32 overlays left `workoutLog`, `cardioLog`, `trainerLog`,
notes, gym, programs, XP, PRs and mastery byte-identical. `DATA_KEYS` 15,
trainer `0.1.1-shadow`. Overlay open/close 0.11ms, workout page 1.13ms.

## §47 — D27: Today and Log tell the truth

Three problems, one theme: the app was stating things it did not know.

**The adherence denominator was fiction.** Log's consistency card read
**"6 of 32 planned sessions"** to an athlete who had been using LOOP for two
weeks — twenty-six failures they were never given the chance to attend. The
per-day model had always refused to call a pre-history day *missed*; the
aggregate ignored that rule and multiplied the current plan across all twelve
weeks (`plannedPerWeek × CONSISTENCY_WEEKS`).

A day now counts as planned only from `trackingStart` — the earlier of the
plan's own activation date (`planStart:<id>`, already stored) and the first
logged session — and only once it is actually due. Both provenance sources
existed; nothing new is recorded to answer this. Measured on the same
fixture: **"6 of 32" became "6 of 8", and adherence went from 13% to 75%.**
The experienced fixture is unaffected — 14 weeks of history still reports
"14 of 32 planned sessions" over the last eight weeks, with all eight genuine
misses intact, including a deliberately skipped week. Unknown is not zero;
a real gap is still a real gap.

**Unknown had no visual language.** A week before tracking now draws as a
dashed outline rather than an empty bar, the strip says "N weeks tracked"
(from the same `progressCoverage` helper Progress uses, so the two screens
cannot quote different numbers), and the calendar gained `cal-unknown` —
quieter than a rest day, which it is not, and nothing like a miss. The
calendar's state model is now written down: outline = category, filled mark =
completed, hollow = planned, dashed = missed, faint = unknown, plus a
two-item legend naming the marks.

**Today said the week twice.** "This week 2 of 4" with seven dots sat in
Momentum a few hundred pixels below the same reading in This Week. Momentum's
copy is gone, along with `momentumDotsHtml`, `momentumDotsAria` and the
`.mo-primary` / `.mo-week` / `.mo-dot-*` styles — removed, not orphaned.
Momentum now carries only what This Week cannot: a headline, the streak, and
records this week, all from engines that already existed.

**A rest day is now a plan.** It names what is next from the real template —
"Monday · Push A — Chest Focus · 8 exercises · ~40 min" (it previously said
only "Next up · Monday · Push"), with no recovery advice and no explanation
of why rest is needed. Training anyway stays one tap but became the quiet
44px accent control it always should have been, since rest is the plan and
training is the override. The greeting lost "Still up" — it guessed at the
athlete's night — and now reads only the clock.

**Landscape had no horizontal safe area at all.** `env(safe-area-inset-left/
right)` appeared zero times, and with a 44px side inset simulated the probe
found the settings gear at x 748–792 on an 812px viewport, the workout back
control at 22–66, and Settings' Close button spanning 34–806 — all under the
island or the rounded corner. Four shells own a physical edge — `header`,
`.view`, `.tabbar`, `.sheet` — and each now adds the inset to its own
padding, so the surface still reaches the edge while its content never does.
Zero collisions afterwards across 812×375, 844×390, 932×430 and 667×375, on
five tabs and ten overlays; the 560px centred sheet still centres exactly
(82px each side), so D10.1 is intact.

**Heights, same fixture:** Today 1080 → 1014 (training day), 795 → 753
(rest); Log 1167 → 1156 with the freeform action moved out of the history
spine into the header. Today renders in 5.1ms, Log 11.0ms, month navigation
7.1ms; the consistency cache still serves repeated reads at 0ms and no second
cache was introduced. Records now say "2 PRs" where there were two, from the
existing PR engine.

Contract 124 holds all of it. Presentation and provenance only: zero
protected-symbol lines, zero storage writes, `DATA_KEYS` 15, trainer
`0.1.1-shadow`; browsing every calendar day, month and recent row left every
log, XP, PR and mastery value byte-identical.

## §48 — D28: luminous depth is a system, not decoration

Four reference images set the direction; their principles were extracted, not
their pixels: information glows out of a dark surface, light pools from the
data itself, big values anchor compositions, and borders give way to tone.

**Tokens (once, in :root):** `--edge-hi` (1px inner top light — the glass
read), `--border-quiet` (half-strength boundary), `--shadow-ambient`, and
three pools — `--pool-accent`, `--pool-success`, `--pool-rest` — each a
static radial rising from a surface's foot. No blur, no filter, no animation:
one gradient paint each, and measured renders CONFIRMED it (Today 2.3ms, Log
8.3ms, Train 6.4ms — all at or below their D27 numbers).

**One recipe, applied once:** a single late-cascade selector list gives every
card the quiet boundary, inner top light and ambient shadow — nineteen
component classes converge on one material without touching 149 scattered
border rules. The daily hero keeps its thin category bar (the reference's
event-accent idea): only its other three sides go quiet.

**Light pools per MEANING:** the hero pools in its category's colour (seven
category radials), rest pools quiet neutral, completion pools green, the
active workout carries the app's ONE edge light. Train cards take a fainter
version of the same category light (`templateCardHtml` now stamps `cat-*` —
the one markup change). The current calendar day is the one lit cell;
the consistency strip's current column takes the accent; the tab bar's
active glyph earns a 12px local light. D27's truth states — `cal-unknown`
0.22, dashed `lc-unknown` — pass through unchanged, contract-held.

**Big values as anchors:** the week count ("**2** of 4") and consistency
count ("**6** of 8") became Space Grotesk anchors at 28/22px; Workout
Complete's three bordered stat boxes became ONE composed metric strip
divided by hairlines, numbers at 24px — the reference's distance·time·kcal
row, not three cards.

**Charts:** the exercise trend line gained a gradient underfill and ONE lit
datum — the most recent point gets a halo (two circles, zero filters) while
intermediate sessions recede to small marks; the weekly bar chart grounds a
soft light under the current week's bar. Sparse-history clamps untouched.

**The tutorial is the same app:** its hero pools like production, its
9.5px micro-label (below the app's own floor) was raised to `--fs-micro`,
and its timer demo was confirmed to be the production `prep-ring`. The
warm-up figure's stage pool rose 10%→13% and gained a soft ground shadow —
grounded, not floating. Set rows became recessed instrument wells (inset
shadow) against the raised cards around them. The Check-in dashed box became
a quiet solid glass row. The workout-quality block's full-accent outline
dropped to 30% — it was shouting over its own score.

**Budgets held as hard numbers:** `--grad-accent` still ≤4, backdrop-filter
still 3 of 6, exactly one edge-light rule, no pool animates, reduced-motion
count unchanged, safe-area systems byte-identical (the four side-inset
shells still count exactly 4). Contract 125. Zero protected symbols, zero
storage writes, seven JS lines total (both chart renderers), `DATA_KEYS` 15,
trainer `0.1.1-shadow`.

## §49 — D28.1: the visual system, verified and locked

D28 built the language. This phase checked it against the real product at
every required viewport, corrected what it actually found, and locked it.

**Viewport coverage, now complete.** 375×812 · 390×844 · 812×375 · 844×390 ·
932×430 · 667×375 — the last three were never swept in D28. All six clean
across five tabs and four Progress sections: no document overflow, no clipped
chart text, no control under 44px. Two probe false-positives were identified
rather than "fixed": `#trainChips` is an intentional horizontal scroller
(556px of chips in a 335px rail — the document does not overflow), and the
667px landscape case leaves the 640px centred layout 13px of margin, which
the D27 side-inset padding sits inside.

**The real finding: 107 surfaces never received the D28 material.** Static
analysis said 107; the live DOM said **17** actually render (the rest are
unreached states or dynamically-composed classes). They were corrected by
D28's own precedent rather than a new one — standalone cards (`wk-card`,
`today-cardio-link`, `cl-empty`, `cw-card`, `log-lens`, `gym-summary`) take
the full material; repeated rows and tiles (`achievement-row`,
`xp-history-row`, `wk-day`, `mt-day/var/act`, `filter-chip`, `cal-nav-btn`,
`mastery-lvl-chip`, `cal-cell`) take the quiet boundary only, because
fourteen ambient shadows in one list is cost without meaning; and
`.btn-secondary`, the shared secondary button, became a raised control so it
can never be mistaken for disabled. Re-measured after: **zero surfaces
remain on the old material.**

**Calibration: correct, and left alone.** Composited luminance ratios against
the card surface — accent pool 1.28×, calendar-today 1.27×, success 1.25×,
rest 1.10×, inner edge light 1.14×, the one edge light 1.94×. None neon, none
invisible. D28's values are right and were NOT churned.

**Light budget: one luminous object per screen.** Measured with correct
alpha compositing against the app ground: surfaces sit at 1.07–1.28×, and the
only object above 2× on any screen is Today's primary action at 9.8×. An
earlier probe that dropped the alpha channel appeared to show six shouting
calendar cells; corrected, completed days sit at 1.22–1.26× — a whisper. The
category outlines were still softened to 55% (they had been full strength),
which is a real improvement, but the backgrounds were correctly left alone.

**Contrast was the one genuine accessibility defect.** `--text-faint`
measured **2.99:1** on the lit hero label and 3.26:1 on Progress tile labels —
micro-copy below comfortable reading, worst exactly where a pool lifts the
surface beneath it. Fixed at the token level (`#5D6878` → `#737E92`): every
micro-label now measures **4.13–4.50:1**, nothing below 3.0, and `--text-dim`
stays at 8.0:1 so the hierarchy is unchanged — only legibility moved.

**Cardio needed no redesign.** D28 flagged it as possible future work; with
real sessions seeded, its tiles already carry the material and its history
rows the quiet boundary. One card (`cw-card`) was stale and is now corrected.
That is the whole of it.

---

### THE LOCK

**LOOP's visual system is now the default. New work inherits it.**

A new surface should reach for what exists before inventing anything:

| Need | Use |
|---|---|
| A card | the shared recipe: `--border-quiet` + `inset 0 1px 0 var(--edge-hi)` + `--shadow-ambient` |
| A repeated row | `--border-quiet` only — no per-row shadow |
| State light | a pool: `--pool-accent` / `--pool-success` / `--pool-rest`, or a category radial |
| The live thing | the single edge-light treatment — there is exactly one, and it belongs to the active workout |
| A primary action | `--grad-accent` — one gradient token, budget of 4 uses |
| A category | the `:root` palette. There is no second one |
| A rank | `rankMedalSvg` — the one renderer |
| A chart | gradient underfill, recessive history, one lit current datum |
| Micro-copy | `--text-faint`, which now carries ≥4:1 |

**Contract 126 enforces this.** It fails if a second card material appears, if
the category palette is redefined, if a second edge light is introduced, if
`--text-faint` drops below 4:1, if the medal renderer is duplicated, or if the
recipe is scattered per-component instead of applied in grouped rules.

A future phase may deviate only where product semantics genuinely require it —
and should say so in this document when it does. Visual iteration for its own
sake ends here.

Verified: 4809 passing. Zero protected symbols, zero storage writes,
`DATA_KEYS` 15, trainer `0.1.1-shadow`.

## §50 — D29: production UX integrity

A hardening pass. Not a redesign, not a feature — the question was only
whether LOOP survives being used impatiently.

**What was actually driven.** ~94 visible controls clicked across all five
tabs; 20-tap bursts on set completion and Add Set; 30 pause/resume cycles and
20 "+15s" taps on a live rest timer; 250 overlay open/close cycles; 200 tab
and month navigations; a live 17-set workout rotated to landscape and back and
tab-switched 30 times; an athlete emptied to nothing and restored.

**Two real defects, both fixed.**

1. **Today could be stranded on another day.** `selectedDayKey` had exactly one
   writer and *nothing* that cleared it, so peeking at Thursday in the week
   strip left the Today tab showing Thursday across every subsequent tab
   switch — indefinitely, on the one screen whose whole job is "what do I do
   now". `switchTab` now ends the preview when the athlete returns to Today.
   The preview still behaves exactly as before while they are on the tab
   (D27 §9 preserved), it routes through the same single writer, it is a
   no-op when already on today, and it is wrapped so it can never take a tab
   switch down with it.

2. **Retired vocabulary was still on screen.** The template sheet — reached
   from a button reading "+ Add a workout" — said "New Variation", "Save
   Variation", "Edit Variation" and "Add a rotation option for Push day".
   *Variation* and *rotation* were consolidated out of the product language
   long ago. Now "New Workout" / "Save Workout" / "Edit Workout" and "Another
   workout you can run on Push day." Function names that legitimately contain
   the word (`applyVariationDiversity`, `coefficientOfVariation`) are
   untouched; a contract now separates rendered copy from code identifiers.

**Five things that looked like defects and were not** — each investigated and
deliberately left alone, which matters as much as the fixes:

- The **set-complete button** measured 40×40. The CSS is 44×44; the reading is
  `scbSettle` frozen at `scale(0.9)` in a pane that does not composite.
- The **scroll lock** appeared stuck with no overlay open. It was read inside
  the same synchronous tick; D26's observer had already released it, and the
  page scrolled freely.
- **Six "dead" controls** (Start Workout, + Log workout, Start This Workout,
  View all N, and the already-active Push / Overview) were async paths, a
  class toggle, and correctly-inert current selections.
- **Week-day cells** ignored `.click()` because they are driven by pointer
  events; a real pointer sequence works.
- **"LOOP's hidden engine"** copy sits inside the Advanced / Shadow Evidence
  area, where implementation language is explicitly permitted.

**Confirmed invariants** (measured, now contract-held): exactly one live rest
timer under abuse; one forward workout action, never Skip and Next; completion
read from the sets and never from the green class; one background-lock
implementation deriving depth from the DOM, restoring scroll to the exact
pixel (520 → 520); zero interval, RAF or listener growth across the full
stress run; zero horizontal overflow; every workout input ≥16px; no console
error from LOOP code in any flow; every empty state explains a next step
without fake numbers or blame.

Contract 127. Pure navigation across the whole app left `workoutLog`,
`cardioLog`, `trainerLog`, notes, gym, programs, XP, PRs and mastery
byte-identical. `DATA_KEYS` 15, trainer `0.1.1-shadow`. 4828 passing.

## §51 — D30.5: the rank showcase becomes a swipe experience

A presentation pass over a finished system. The ladder, thresholds, XP
arithmetic, current-rank logic and the one shared medal renderer are all
untouched; what changed is how the page carries them.

**The gesture is the navigation.** Both arrow buttons are gone — on a phone
they were the least premium thing on the screen, and the swipe already did
the work. The settle rule D23 tuned is unchanged (a third of a card, or a
flick), but the flick floor rose from 24px to **36px**: at 24 it sat inside
the range a finger wanders during an ordinary tap (~10-16px of slop), so a
sloppy press could change rank. The ends now **rubber-band** at 0.32 rather
than dead-stopping. Keyboard stepping and the focusable, named region remain,
so the ladder is still reachable without the gesture.

**A rotation bug was found and fixed.** The track is positioned in pixels, so
a viewport change left it holding stale geometry — measured, rotating to
landscape put the centred card **215px off-centre** until the next swipe.
This predates D30.5; the carousel never had a resize handler. It now
re-centres on `resize` and `orientationchange`, wired once with the rest of
the carousel and inert while the showcase is closed.

**The card was being clipped in short landscape.** Measured 11px of overflow
past the clipped track — the current rank's progress bar was cut off. The
track's own padding yields the room, and the footer (which replaced the arrow
nav, leaving that landscape rule dead) compacts with it. Card, progress bar
and footer all verified whole at 812×375.

**The page wears the rank.** A single atmosphere layer, behind all content and
pointer-inert, painted from that rank's OWN `RANK_VISUALS` material — gem
above, metal below, card colour as the ground — so the page can never drift
out of step with the medal, and no second palette exists to maintain.
Intensity rides the existing glow ladder. Measured against the page ground,
elevation runs **1.18× at ROOKIE → 2.06× at LEGEND**; the alpha ladder itself
is strictly monotone (0.10 → 0.29). Two neighbours invert in raw luminance
(MASTER's gold is intrinsically brighter than LEGEND's violet, ATHLETE's cyan
than COMPETITOR's blue) — that is the rank palette speaking, it is under 5%,
and it was deliberately not flattened. The atmosphere follows the gesture
rather than only the release, and cross-fades without animating.

**Emblems: lit metal, same ladder.** The metal gradient went from a two-stop
vertical ramp to a four-stop angled one carrying a specular band derived from
the rank's own metal (`mixHex`, no new palette), the gem gained a bright core,
and every tier gained the same top bevel arc — one element added uniformly, so
D23.1's monotonic complexity, ROOKIE-simplest and LEGEND-most-complete all
still hold, along with every pinned path, radius and dasharray.

**Page-only shine.** A narrow light band crosses the centred emblem on a 4.6s
cycle. It lives in CSS scoped to `.rank-card`, never in `rankMedalSvg` — so
the home chip, the summary identity and the promotion medal, which all call
the same renderer, are untouched, and the contract that the renderer animates
nothing still passes. Composited on transform and opacity alone. Reduced
motion keeps the light and drops the travel.

**The footer is anchored**, not floating: one grounded band with a hairline
and a soft ground, holding the ladder indicator (the current rung drawn as a
longer filled bar, so position reads without counting) and the route to the
full profile.

Verified: opens on the athlete's own rank, centring drift ≤1px at all eight
stops, clamped at both ends, full gesture matrix correct (tap jitter ignored,
slow small drag settles back, flick advances one, decisive drag advances),
both controls ≥44px with actions, no horizontal overflow, atmosphere behind
D26's status band. Open/close 12.4ms, reposition 2.1ms, atmosphere repaint
**0.03ms**. Contract 128. Zero protected symbols, zero storage writes,
`DATA_KEYS` 15, trainer `0.1.1-shadow`. 4857 passing.

## §52 — D30.6: the rank showcase, corrected

D30.5 went the wrong way. On device it was a mostly-empty bordered card with a
grey diagonal slab crossing it and a flat ring-plus-diamond in the middle.
This corrects all three.

**The card is gone.** Not restyled — removed. `.rank-card` no longer exists
anywhere in the source. Each rank is now a transparent column of type and
emblem composed directly on the page, and the page itself carries the rank's
atmosphere. Verified: the panel paints no background, no border and no shadow.

**The shine was the worst of it, and its cause was architectural.** It was a
CSS pseudo-element clipped to a *rectangular* wrapper, which is exactly why it
rendered as a grey parallelogram rather than light on an object. It now lives
inside the SVG, clipped to the emblem's own generated outline (a 1058-character
path), so light can only ever appear ON the emblem. It passes once when a rank
settles into the centre — not a loop — and only on the centred emblem. Nothing
else on the page animates by itself.

**The emblems were rebuilt on three rules.** The silhouette is ONE closed
outline: a shoulder, wing, keel or crown is a longer *radius* at that bearing,
generated by `rankFramePts`, so an extension is a vertex of the same chassis
and cannot read as a triangle stuck to a ring. Light is *computed*, not drawn:
`facetShade` shades every facet by the angle its normal makes with one fixed
light, which is what separates a polished object from a flat polygon —
measured, ROOKIE's stone renders 16 facet polygons in **14 distinct computed
fills**. And the stone is a real cut: pavilion, crown facets, star facets,
table and girdle, earning 6 → 8 → 10 facets up the ladder.

**The ladder is now readable from the silhouette alone**, which is the claim
D23.1 always made and can now be measured directly rather than through token
proxies: outline area rises strictly **5023 → 6435** with ROOKIE smallest and
LEGEND largest, no two ranks share an outline, and every vertex stays inside
the box. Each idea arrives at its own rank and is measured on the outline it
produces — TRAINEE's bezel, ATHLETE's hexagon, COMPETITOR's shoulders (+2.3
units at the flank), ELITE extending them into wings (+7.8), VETERAN's weight
below (46 → 53.5), MASTER's crest above (46 → 52), LEGEND finishing it (→ 56).

**Two real bugs were found and fixed during the rebuild.** The angular
falloff helper inverted its distance, which put VETERAN's keel *above* the
emblem and MASTER's crest *below* it. And LEGEND's crown reached radius 61 in
a 120-unit box and was being clipped; the radius is now capped at 56.

**Arrows are gone entirely** — not hidden — and the carousel suppresses text
selection, callout and tap highlight, scoped to the panel exactly as the week
strip scopes its own.

Verified at all six viewports: centring exact at all eight stops, a symmetric
13px neighbour peek, no clipped emblem or panel, no document overflow, the
profile link at 44px and on screen, eight dots. Emblem render 1.2ms, carousel
reposition 1.5ms. 50 forward and 50 back swipes clamp correctly; rapid
direction reversal stays in range.

Two measurements that looked like defects were neither: the front panel
appearing 14px off-centre is `pageIn`'s `translateX(14px)` start frame frozen
in a pane that does not composite (with the animation neutralised, centring is
exactly 0 and the peek symmetric), and mid-transition panel widths read as
scaled because the 0.3s scale had not finished.

Rank truth is untouched: same thresholds, same XP arithmetic, same
current-rank logic, one shared renderer. `opts.showcase` adds only the clip
and the light pass — every reused medal (Home chip, Progress, Profile,
promotion) is verified to contain neither. Contract 128 extended; the D23.1
ladder assertions were rewritten against the new geometry and are stronger for
it, each documented above. Zero protected symbols, zero storage writes,
`DATA_KEYS` 15, trainer `0.1.1-shadow`. 4872 passing.

## §53 — D31: adversarial simulation and data-integrity audit

The instruction was to try to break LOOP rather than confirm it. This records
what broke, what held, and — as importantly — what was left alone.

**Scale.** The existing trainer evaluator was re-run rather than replaced:
**16,800 recommendation evaluations** across 8 training patterns, 4 goals, 6
exercise classes, 3 experience levels — zero contradictions, 6/6 differential
tests passing. A new development-only companion, `loop-audit.js`
(`npm run audit`), adds the statistics half: **87 integrity checks**, 400
randomised fuzz histories, longitudinal trajectories at 12/24/52 weeks across
4 behavioural profiles, and scale runs to 1,000 workouts. Every derived metric
is recomputed independently from the raw log inside the audit and compared
against the product's answer, so a disagreement indicts one of them.

**Two real defects were found and fixed.**

1. **Skipped work earned mastery.** `buildMasteryIndex` counted a session from
   the exercise ROW being present and only consulted the sets when counting
   sets — so a skipped exercise earned a session, a distinct week, a distinct
   month and the points attached to all three. Volume, Most Trained, PRs,
   muscle volume and the capability history all already excluded it; mastery
   was the single place D21's skip truth still leaked. Fixed at the source: a
   row now counts only if at least one set carries real reps.

2. **The session score was anonymous.** Workout Complete rendered a 38px
   "87 / 100" directly under the title with no label. Forty of those hundred
   points are simply completion, so an unnamed number in that position reads
   as an objective grade of the workout. It is now labelled *Session score*.
   The arithmetic is untouched and contract-pinned as untouched.

**One duplication was removed.** Momentum's short-week headline restated This
Week's exact "N of M" a few hundred pixels below it. The line was written to
caption Momentum's own week dots, which D27 removed — leaving a bare
duplicate. This Week owns the count; Momentum now says what the count cannot,
that the week has finished. A visible-text scan of all nine surfaces afterwards
found **zero duplicated concepts**.

**What held.** Volume, workout counts, Most Trained, PR events, muscle volume,
alias handling (no double-counting), bodyweight work (no phantom load),
unknown-history truth, and the level/rank/XP chain all matched independent
recomputation exactly. Delete through the real writer (`persistLog`) leaves no
consumer stale — mastery is reached through the `invalidateSortedLogCache`
chain. 400 fuzz histories produced no throw, no NaN, no Infinity, no negative
volume, no malformed date, and identical output on repeat runs. A 1,000-workout
history completes a full analytic pass in **82ms**, growing near-linearly from
7ms at 100.

**Three findings were investigated and deliberately NOT changed.**

- *Oscillation in the "inconsistent" profile* (30–46% flip rate) is the engine
  correctly tracking an athlete whose input alternates every session by
  construction. Only stable inputs are now held to a no-oscillation standard;
  the alternating profile is reported as an observation.
- *56% of long improving synthetic histories remain CONSOLIDATE* — the
  over-conservatism signal. This is a **CALIBRATION CANDIDATE**, not a logic
  bug: the evidence chain is internally consistent. Per policy it is reported,
  not tuned. Real athlete evidence remains the calibration gate.
- *The `plateau` and `weak` patterns never reach BACK_OFF* (0/2100 each).
  Consistent with the engine's own rule that BACK_OFF answers decline rather
  than absence of progress. Reported, not changed.

**Trainer verdict, kept separate as required.** Logical robustness: **8/10** —
no contradictions across 16,800 evaluations, all differentials monotone, no
impossible loads or rep targets, deterministic. Real-world validation: **TIER 1**
— the phone's shadow log is the only real evidence and it is small; nothing
here changes that. Calibration confidence: **LOW** — synthetic distributions
cannot license a threshold change, and none was made.

`TRAINER_ENGINE_VERSION` remains `0.1.1-shadow`; no trainer threshold,
weighting or state rule was altered. The audit tooling is development-only:
it never opens a store, contains zero `LOOPStore`/`localStorage` references,
is not loaded or executed by the app, and is not cached by the service worker
— all contract-held. `DATA_KEYS` 15. Contract 129. 4891 passing.

## §54 — D31.1: date integrity audit (no production change)

D31 closed by admitting DST and timezone behaviour had never been exercised.
This phase exercised it. **No production defect was found, so no production
code changed** — `index.html` and `sw.js` are byte-identical, and the service
worker was deliberately not bumped so no phone is asked to re-download an app
that did not change.

**The date model, as it actually is.** A workout's identity is a plain
`YYYY-MM-DD` calendar string, written once and never re-derived from an
instant — which is why viewing a session from another timezone cannot move it.
`localDateStr()` builds that string from `getFullYear/getMonth/getDate`;
`weekStartKey()` parses with an explicit `+'T00:00:00'` (local midnight, not
the UTC parse a bare `new Date('YYYY-MM-DD')` would give) and formats back
through local parts; `monthKeyOf()` is a pure string slice and cannot have a
timezone at all. 46 parse sites use the local-safe form.

**How it was tested.** A new development-only tool, `loop-date-audit.js`
(`npm run audit:dates`), with two independent controls: the timezone is the
platform's real one (Node's `TZ`, so DST rules and transitions are genuine,
not simulated), and the wall clock is stubbed inside the sandbox by swapping
the global `Date` — no production code is touched to make a scenario. The
oracle is genuinely independent: expected dates come from
`Intl.DateTimeFormat` and from pure part-arithmetic, never from calling the
product's own helper twice.

**Result: 36 checks × 7 real timezones = 252, zero failures.** UTC,
America/New_York, America/Chicago, America/Denver, America/Los_Angeles,
Europe/London, Asia/Tokyo. Covered: US and EU spring-forward and fall-back
instants either side of the transition; exact midnight boundaries; the
Sunday→Monday turnover; weeks spanning two months, two years and a DST
change; leap day; streaks across the 167-hour and 169-hour weeks; a genuinely
missed week still breaking a streak; D27's tracking-start, future-day and
rest-day truth at the year boundary; two sessions on one day staying two
records; ordering stability; and 600 fuzzed boundary dates.

**One inconsistency found, tested, and deliberately left alone.** Strength
derives week keys from local parts; **cardio has its own inline key built with
`toISOString().slice(0,10)`**, which in any UTC+ zone names the *previous*
calendar day. That is a real inconsistency in form, and exactly the pattern
D31.1 lists as a bug class — so it was tested rather than assumed. Both the
key set and the cursor walk derive from local-midnight Mondays, so they shift
together: the cardio streak survives the DST week, a missed week still breaks
it, and Monday and the following Sunday share one weekly-XP bucket — in all
seven zones. It is cosmetic, not behavioural, and the gate says code changes
require a demonstrated wrong output. Recorded here so a future phase can
tidy it deliberately rather than discover it again.

**Also proven harmless.** Eight bare `new Date(x.date)` calls are all sort
comparators: both operands shift identically, so ordering is unaffected —
asserted by the ordering tests across year and DST boundaries.

**Limits.** Zones whose DST transition occurs at local midnight (so local
midnight does not exist) were not exercised; the matrix uses the seven common
zones the environment supports reliably. And `TZ=x node …` does not propagate
in this Git Bash environment — the matrix therefore spawns child processes
with an explicit `env`, which was verified to change the offset before any
result was trusted.

Contract 130 keeps the always-on regressions. 4912 passing, 87 data-integrity
checks, 252 date checks. `DATA_KEYS` 15, trainer `0.1.1-shadow`.

## §55 — Cardio measurement (D32, loop-v101)

Cardio stopped being a timer with a text box. Outdoor activities — outdoor run,
outdoor walk, outdoor cycle, hiking, rucking — are measured by
`navigator.geolocation.watchPosition()`. Indoor activities never are: a
treadmill has nowhere to go, so it is never offered location and never carries a
route.

**The engine is pure.** `gpsHaversineM`, `gpsPointUsable`, `gpsSegmentVerdict`,
`gpsReduce`, `gpsCurrentPaceSec`, `gpsSplits`, `gpsSimplifyRoute` and
`gpsSessionMetrics` take points and return numbers. Nothing in them touches
`navigator`, so the same sequence replayed from a fixture and observed on a
phone produce identical output. `loop-gps-audit.js` (43 checks,
`npm run audit:gps`) checks them against an independent equirectangular oracle —
deliberately a different formula from the production Haversine.

**Distance is the sum of accepted segments, never start-to-finish.** A loop that
ends where it began still measures its full length. Filtering is deterministic
and conservative: a fix is rejected for bad coordinates, an accuracy worse than
the activity's limit, a gap over 30s, movement inside the combined accuracy
noise floor, or an implied speed above the activity's ceiling. A rejected spike
does not become the next anchor — otherwise the following good fix would measure
from a place the athlete never was.

**A pause is a hard break.** `pauseCardioSession` clears the watcher and releases
the wake lock; resuming sets `brk` on the next fix, and `gpsSegmentVerdict`
treats an explicit break as a gap regardless of elapsed time. Distance can never
accumulate across a pause, however short.

**A reload is an interruption, not a reset.** The draft carries `gpsPoints`,
`gpsState` and `gpsOptOut`, checkpointed every 20 fixes. Restoring a running
session restarts the watcher with a break, so the unobserved stretch reads as a
gap rather than a straight line across it.

**The wake lock is epoch-guarded.** `navigator.wakeLock.request()` is
asynchronous, so a session can end while the request is in flight.
`releaseCardioWakeLock` bumps an epoch; a lock arriving for a stale epoch is
released instead of adopted. Without this, finishing quickly held the screen on
after the workout was over — found by `loop-cardio-stress.js` (261 checks,
`npm run audit:cardio`), which leaked 34 locks across 20 sessions before the fix.

**Measured and entered are distinct, everywhere.** `cardioSessionDistance()`
returns `{value, source}`; the record stores `distanceSource`, `trackingMode`,
`movingSeconds`, `splits`, `gpsQuality` and a Douglas-Peucker–simplified
`route`. The route is simplified for storage and display only — distance was
computed from every accepted point and is never recalculated from the simplified
path. A final partial mile is labelled `Final 0.41 mi`, never listed as a split
to compare against full ones.

**The route trace is a drawing, not a map.** Normalised SVG with cosine-latitude
correction, the pen lifted across gaps. No tile provider, no API key, no
billing, no third-party request of any kind.

**The workout is never held hostage to the measuring.** `cardioGpsGate()` covers
denied, unavailable and slow-acquisition, and every state offers a way forward —
`cardioContinueWithoutGps()` keeps the session as a timed workout with a typed
distance. Calories remain labelled estimated. Nothing fabricates heart rate,
steps, VO2 or HealthKit data, and no copy promises background tracking, which a
PWA cannot deliver.

**Import defect found and fixed.** `importAllData` merged `workoutLog` by id but
fell through to a fill-only rule for every other key — so importing onto a phone
that already had any cardio history silently dropped every cardio session in the
backup, routes included, while the dialog promised they would be merged in.
Cardio history now merges by id on the same terms as strength history. Two
existing assertions encoded the old fill-only behaviour and were updated to
assert the merge; the intent they protected — the athlete's own data is never
overwritten — still holds.

Contract 131 keeps the always-on subset. 4939 passing, 43 GPS checks, 261
lifecycle checks, 87 data-integrity checks, 252 date checks. `DATA_KEYS` 15,
trainer `0.1.1-shadow`.

## §56 — The program experience (D33, loop-v102)

**The navigation defect, and what actually caused it.** Every `.overlay` shared
one `z-index: 60`, so the browser painted them in DOCUMENT order. A surface
opened from a surface declared later in the file was painted *underneath* it:
the athlete tapped Edit, saw nothing change, and had to close the page they were
on to find the editor waiting behind it. Seven of eight sampled transitions did
this — Settings→Plan switcher, My Gym→Exercise, Program detail→Phase editor
among them. It was never one broken button.

Stacking now follows the order things were opened in. `_openSheetStack` already
recorded that for focus and Escape handling; `paintSheetStackOrder()` assigns
`z-index` from it on the same MutationObserver that drives the scroll lock, so
it covers every overlay however it was opened — including boot and draft
restore, which call no `open*` function at all. Closing an overlay returns its
`z-index` to the stylesheet. Same reasoning as the scroll lock: one mechanism
that cannot be forgotten, not a rule each of thirty-two overlays must remember.

Tearing down the page underneath was tried and rejected. It fixed the burying
and introduced stranding: closing an exercise opened from My Gym dropped the
athlete on the root tab instead of back in their gym. The page below is not a
hidden destination — the top of the stack is always what the athlete just
navigated to — it is the way back, inert to screen readers through the
`aria-modal` the stack already sets.

**Vocabulary.** The athlete's word is now PROGRAM. Contract 89 previously made
it "cycle" so "plan" and "program" could not read as two words for one thing;
D33 §1 resolves that collision the other way. The contract is unchanged in
substance — exactly one word for the idea — only in which word won. 22 copy
strings changed; every identifier was left alone. The `ob-cycle` CSS class was
renamed `ob-rotator`, since it was a fade rotator and only ever collided with
the vocabulary check by accident.

**Generation is deterministic and has no side effects.** `generateProgram(answers)`
returns a definition and the reasons for it; nothing is written until the athlete
taps Start. Equipment decides which template library is even possible and goal
only refines within it, so a home athlete never receives a machine program
however they answered. Frequency picks the split, checked against the categories
the chosen library actually has — a library without upper/lower can never be
handed an upper/lower split. Day assignment rotates the split's starting offset
and keeps the arrangement with the fewest same-category adjacencies, counting
Sunday→Monday because the week repeats.

`loop-program-audit.js` (111 checks, `npm run audit:program`) drives 720 answer
combinations through it against rules written in the audit rather than imported
from production. It found two real defects:

- **Beginners got one workout photocopied.** "Repeated exposure" was implemented
  as literally the same template three times a week, which left a 3-day beginner
  with no direct shoulder, glute or triceps work at all. The repetition a
  beginner benefits from is of movement PATTERNS, which full-body templates
  already deliver; they now get different templates, biased toward the shorter
  end so sessions stay simple.

- **"Machine" contains "chin".** The coverage check matched pattern keywords by
  bare substring, so every machine exercise satisfied the pulling requirement.
  A press-only week passed. Keywords are matched on whole words now.

The coverage rule itself was also wrong in the other direction: it demanded
named isolation work for eight muscle groups and flagged well-built full-body
programs for having no curl. Prime movers need direct work; arms and shoulders
count as covered by the compounds that train them. The audit proves the relaxed
rule still catches a week with no pulling, no legs and no hinge.

**One estimator.** The builder scored templates with its own duration formula
until it was noticed that LOOP already has `computeWorkoutDuration()`, rest
intervals and all, and that My Training shows that number. Two estimators would
eventually have printed two durations for one workout, so the builder delegates.
The template library tops out near fifty minutes, so a "75+ min" answer cannot
produce a longer session — padding one with invented accessory work would be
worse than honest. What is guaranteed is that asking for less never gets you
more.

**Starting is one action.** Save, activate, set the chronology, sync the weekly
schedule, land on Today. Order is load-bearing: the selected plan lives under its
own key and the schedule is stored PER PLAN (`schedule:<planId>`), so the plan
must be chosen and written first or the schedule lands under the old plan's key
and the next launch loads the previous week back. The plan chip in the header was
painted once at boot and is now painted with every render, so it cannot name a
plan the athlete has left.

**Editing changes the plan, never the past.** Edit opens on the program, not on
question one, with each question a tap away. It writes through `updateProgram`
and deliberately does not touch `startDate` — moving it would silently re-date
every week already trained through. Verified against a week-4-of-8 athlete with
six logged workouts, PRs and trainer evidence: changing the training days left
`workoutLog`, `trainerLog`, XP, PR history and the current week byte-identical.

**Nothing assumes eight weeks.** Every surface derives from `durationWeeks`. Four
weeks is one phase and is drawn as one line, not a band chart of a single bar;
six and eight earn a real second phase. Week 1 is the week CONTAINING the start
date, so a Wednesday start still has a Monday in week 1 — in the past, and
therefore never marked missed. D27's rule holds: unknown is not missed, and a
program created today invents no failures in the weeks before it existed.

Contract 132 keeps the always-on subset. 5001 passing, 111 program checks, 43
GPS checks, 261 cardio-lifecycle checks, 87 data-integrity checks, 252 date
checks. `DATA_KEYS` 15, trainer `0.1.1-shadow`.

## §57 — Program explainability (D34, loop-v104)

Programs now explain themselves, and every sentence is derived from the program
it describes. One pure layer — `deriveProgramExplanation(program)` and its
helpers, inserted alongside the D33 flow — feeds the builder review, My
Training and the program map, so no two surfaces can tell different stories.
Nothing derived is persisted: the stored program gains exactly two id fields
(`emphasis`, `sessionLength`) and no prose. `DATA_KEYS` stays 15.

**What the layer derives.** Set-weighted muscle profiles per session (curated
canonical registry first, keyword fallback for uncataloged names); primary vs
secondary areas; a focus tag when a session genuinely leans ≥10 share-points
away from its same-category sibling — that is what makes Upper A and Upper B
read as intended; split and schedule rationale recomputed from the actual week
(exposure counts, rest-day spacing, category alternation); phase purposes;
one context line for weeks whose position says something (week 1, phase
boundaries, the final week — plain middle weeks get silence); a progression
statement that claims only what LOOP does: consistent sessions plus the log.

**"Extra" is proven, never assumed.** An emphasis claim is only worded as
extra work when a balanced re-pick of the same week (same pick loop, factored
so the two cannot drift) would have chosen different sessions. Across the
audit's 4,320 combinations: 1,881 effective, 2,439 inert — inert choices claim
nothing, and the review's rationale no longer says "extra arms work" when
nothing was added. The rationale also states measured session minutes instead
of echoing the requested bucket the library cannot always fill (§7 honesty
preserved: 75+ answers show the real ~35–50 min).

**Phases stay honest.** Generated phases are the same sessions every week; the
copy now says exactly that ("Same sessions — now push the loads up", and the
note "The sessions stay the same across phases — what changes is what you
chase in them"). No periodization is implied that the program does not
contain. The position line now uses the block's own name — it used to say
"Accumulation" beside a band saying "Foundation".

**Four production defects found by explainability and fixed, with regression
coverage:**

1. *Edit round-trip swapped workouts.* Emphasis and session length were not
   stored, so opening the editor and tapping Save regenerated from defaults
   and silently replaced the athlete's sessions. The two ids now travel with
   the program, the editor prefills them, and the round-trip is asserted to be
   the identity.

2. *"Leg Curl" counted as biceps, "Hack Squat" as glutes.* The keyword map's
   substring semantics fed focus tags naming muscles the session did not
   emphasize. The explanation layer attributes through the curated canonical
   registry (Leg Curl → hamstrings, Hack Squat → quads), keywords only as
   fallback.

3. *Every triceps kickback inflated glute volume.* `MUSCLE_MAP.glutes`
   contained bare `kickback`; the volume chart and the tags both misattributed
   it. The keyword is now `glute kickback`, and the one ambiguous template
   exercise ("Cable Kickback" on a push day) is named "Triceps Kickback".

4. *Emphasis scoring chased junk matches.* The scorer's own keyword list
   counted "Leg Extension" as arms work and "Hanging Leg Raise" as legs work,
   so an emphasis could select templates that added nothing for its muscle —
   which the review then described as extra work. Scoring now sums the same
   canonical contributions the claims are made from, through one shared
   group mapping.

**Validation.** `npm run audit:program` grew to 130 checks: a 4,320-combination
explainability sweep in which every focus tag must survive an oracle that
reimplements all of the math (set-weighting, shares, sibling leans, label
mapping) independently, every "extra" claim must beat its balanced twin under
that oracle, forbidden vocabulary (optimise/AI/trainer/recovery/scientific/
personalised) must never appear in derived copy, and the substring poisons are
pinned as fixtures. The oracle demonstrably rejects a fabricated claim.
Contract 133 keeps 38 always-on guards: one derivation entry point referenced
by both surfaces, ids-not-prose persistence, edit-identity, grounded claims,
honest phases, purity (50 derivations < 1s, zero writes), reduced-motion, and
trainer isolation. Contract 132's fixed-length isolation windows became
marker-bounded so region growth can never silently shrink their coverage.

5,045 passing. Trainer `0.1.1-shadow`, untouched.

## §58 — Session depth & personalization (D35, loop-v105)

The library gained COMPOSITIONAL depth rather than more templates. A schedule
entry may carry a recipe — extension ids and a lead index — and one composer
turns (base template + recipe) into the session every surface shows and the
athlete actually trains. Extensions are references into a 22-entry curated
list (`PROGRAM_EXTENSIONS`), exactly as `templateId` references the plan
library: no copies, no persisted analysis, ids only. An entry without a recipe
composes to its exact base, so every pre-D35 program renders, edits and trains
unchanged — no boot migration, ever.

**Session length is capacity, not a quota.** Short and standard weeks keep the
exact library baseline (asserted). 60–75 earns one extension slot per session,
75+ two — spent on the athlete's emphasis first and the week's least-covered
groups otherwise, and left unspent when the estimator says the session would
leave its band. Beginners cap at one slot and only at 4+ days; two-day weeks
cap at one. Before: 45–60/60–75/75+ produced structurally identical programs
in 234/240 combos and 75+ NEVER differed from 60–75. After: 32/240 identical
(intentional plateaus included), 208/240 length-responsive, monotonicity
0 violations across the full matrix. Emphasis effectiveness rose from
2,442/5,760 (42%) to 3,533 (61%), with the 2,227 inert cases concentrated
exactly where the classification says they belong: 2–3 day weeks, short and
standard sessions, and beginners.

**Balance outranks specialization.** Three rules keep an emphasis from
damaging the program, all shared by generation and every balanced-twin
comparison so "effective" can never be a pipeline artefact:

- *Coverage repair*: template selection may never zero a major group
  (chest/back/shoulders/quads/hamstrings/glutes) for the week. Repair swaps
  one session to the shortest qualifying sibling inside the duration band;
  two-day same-category weeks get an exhaustive six-pair search.
- *Zero-fill priority*: an extension slot goes to a major group at zero weekly
  sets before any emphasis — which honestly leaves a home two-day arms
  emphasis inert, the right answer.
- *Directional effectiveness*: "extra X work" now additionally requires the
  emphasized week to carry at least as many canonical sets for X as the
  balanced twin. Different-but-worse never claims extra.

**Defects found by the new pins, all fixed with the pin as regression:**
three extension entries lied about home equipment against the registry
(Rear Delt Fly→Machine, Overhead Triceps Extension→Cable, Glute Bridge→
Barbell); the derive-side balanced twin GUESSED experience from the live
profile while generation used the answer, producing phantom "effective"
beginners — `experience` now persists beside `emphasis`/`sessionLength` (same
disease, same cure as D34's edit bug); chest emphasis on two-day weeks zeroed
shoulders; coverage repair initially ignored duration caps and inflated a
short week to 85 minutes; and a legs emphasis could end with FEWER leg sets
than balanced after glute repair, which the directional rule now converts to
honest inert.

**Substring semantics retired from program logic (§24).** The weekly guardrail
and Main/Build/Finish grouping read canonical `pattern` first; the emphasis
scorer and allocator attribute through canonical `primary`. Keyword lists
remain only as the constrained fallback for uncataloged names, pinned by the
poison fixtures.

**Shown = trained.** `resolveProgramWorkout` and `builderTemplateOf` both
compose; `startTemplateLog` resolves through `getProgramWorkoutForDate` when
today's program session is the one being started — verified end to end in the
browser: all ten composed exercises, extensions included, appear as live log
rows.

**What's New is now a release requirement.** `LOOP_UPDATES` gained v2-8
("LOOP 2.8 — Deeper Programs"), and its `swVersion` field must equal sw.js's
`CACHE_VERSION` — Contract 134 makes shipping a version without its release
note a test failure, permanently.

Validation: `npm run audit:program` grew to 149 checks with human-readable
failure reasons (PHANTOM/DURATION COLLAPSE/EMPHASIS DESTROYED COVERAGE/
SESSION OVER BAND…), 100-repeat byte-determinism, full-matrix monotonicity,
canonical-duplicate and equipment sweeps, and the §58 fixtures asserted on
their load-bearing properties. Contract 134 adds 22 always-on guards.
5,067 passing. Generation ~0.8ms. Trainer `0.1.1-shadow`, untouched.

## §59 — Training prescription (D36, loop-v106)

The baseline audit found the library was already good at prescription: 131 of
140 templates give the opening movement different sets and reps from the
closing one, and the strength library genuinely opens 5×3–5 @8–9 where the
hypertrophy library opens 4×8–12 @7–8. D36 therefore does NOT re-prescribe
what the library already says well. It fills the two places the library could
not express, and closes one safety hole.

**"Muscle + Strength" was a phantom goal.** It resolved to the hypertrophy
library and produced a byte-identical program to "Build Muscle" — an answer
the athlete could change that changed nothing. It now leans its PRIMARY
movements toward strength (4×5–8 @8) while secondary and accessory work stays
hypertrophy-ranged, which is the actual middle ground. The band is deliberately
5–8: its midpoint sits just above the 6-rep line where restSecondsForReps
jumps to 150s, so the session leans heavier without silently becoming longer.
Verified structurally: primary rep midpoint now sits strictly between strength
and hypertrophy.

**Experience stopped mattering above beginner.** Intermediate and experienced
produced identical prescriptions. An experienced athlete who has told LOOP they
have 75+ minutes now gets one more working set on the session's primary — the
only place extra volume is both wanted and paid for. Nothing changes at 30–45
or 45–60, and beginners never receive a set bump.

**Role is one taxonomy with a curated veto.** deriveExerciseRole ranks by
position (templates are written main-lift-first), and exerciseIsNeverPrimary
is the veto. The veto had to be curated because neither existing registry field
answers it: pattern describes DIRECTION, so a Lateral Raise is filed under
vertical_push beside the Overhead Press — trusting it would have let a
strength-leaning profile prescribe 4×5–8 on lateral raises, exactly the failure
this phase was told to prevent. supports1RM does not separate them either: it
is false for Lat Pulldown and Pull-Up, which are perfectly good primaries.
Uncataloged movements are never vetoed, so the home library keeps working.

**Defect found by the new registry-anchor pin:** three ids in the curated veto
list (cable_lateral_raise, cable_fly, incline_cable_fly) did not exist — the
real ids are lateral_raise_cable, chest_fly_cable, chest_fly_incline_cable.
Those three movements were silently unprotected. The pin now fails if any
vetoed id stops resolving, so the list cannot rot.

**Defect found by the release guard:** the two newest What's New entries shared
a date, and updatesNewestFirst breaks ties by array position — so the D36 entry
sorted behind D35 and the guard correctly refused the release. The array is now
ordered oldest→newest, matching its own convention. Contract 134's release-id
assertion was also replaced: naming a specific version would fail on every
future ship and teach the next phase to edit the guard rather than trust it.
The durable invariant — newest entry is well-formed and names the deployed
CACHE_VERSION — is what remains.

**The trainer boundary already existed and is now pinned.** startTemplateLog
passes each row targetSets/targetReps from the composed session, and the engine
records targetSource 'program' for a supplied range. The program owns the rep
range; the trainer chooses the load inside it, and may only depart from the
range through its existing targetMismatch path when three consecutive sessions
fall outside it. D36 changed no threshold, no state decision and no
calibration. TRAINER_ENGINE_VERSION remains 0.1.1-shadow.

**Prescription is an id, never stored numbers.** A schedule entry may carry rx
— a profile id resolved through PRESCRIPTION_PROFILES at read time, exactly as
templateId resolves through the plan library. No sets, reps or effort values
are ever written to storage. An entry without rx — every program built before
D36 — composes with its curated prescription untouched, so there is no boot
migration and no active program changes shape.

**Goal classification (§18).** A: Get Stronger and Build Muscle materially
differ, by library and by prescription. A: Muscle + Strength now differs from
both, by prescription only — deliberately sharing the exercise library, since
the movements are not what makes it a middle ground. C: Recomp shares Build
Muscle's resistance-training prescription entirely — LOOP has no calorie or
body-composition context, and there is no separate "recomp lifting style" to
implement; inventing one would be fiction. B: General Fitness shares the
balanced library with moderate prescriptions.

Validation: npm run audit:program grew to 174 checks, including an oracle that
keeps its OWN copy of the veto list and its own role ranking, adversarial
fixtures (heavy-triple lateral raise, 1×25 primary squat, nine-set
prescription) proven to be caught, a 960-program prescription sweep, and
human-readable failures (ISOLATION LOW-REP, PRIMARY UNDERPRESCRIBED,
ROLE IMBALANCE, SET COUNT EXTREME). Contract 135 adds 26 always-on guards.
5,094 passing. Full-matrix duration monotonicity 0 violations, 0 sessions over
band, byte-identical across 100 repeats, generation ~0.8ms.

## §60 — Temporal programming (D37, loop-v107)

The baseline was unambiguous: **1,920 of 1,920 generated multi-phase programs
were phantoms.** Every 6- and 8-week program declared two phases whose training
was byte-identical, and no resolver accepted a week, so the architecture could
not have expressed a phase difference even if one had been intended. D34's
"same sessions, different focus" copy was truthful precisely because nothing
changed.

**A phase now requires a consequence, and the generator proves it.**
`builderPhasePlan` proposes a boundary only for goals whose training has a
defensible development — Get Stronger and Muscle + Strength — and only at six
weeks or more, and never for beginners. `builderJustifyPhases` then resolves
the real schedule under both candidate prescriptions and collapses the boundary
to a single phase when nothing moves. That collapse is not theoretical: a
3-day strength week whose primary is already 4–6 sits inside the Foundation
band, so both phases would have trained identically. The generator deletes that
boundary rather than shipping a label over nothing.

Result across the full matrix: **phantom phases 1,920 → 0.** Multi-phase
programs fell 1,920 → 400, every one meaningful; single-phase rose 960 → 2,480.
Fewer phases is the correct outcome, not a regression.

**What a phase may change, and what it may not.** Only the session's PRIMARY
movement moves — rep range, effort intent, and (for experienced athletes at
75+) set depth. Exercises are never swapped, session shape never changes, and
accessory work is never touched, so week 7 still reads as the same program as
week 1. Pinned: the audit walks every phased program and fails on
`PHASE SWAPPED AN EXERCISE`, `PHASE MOVED NON-PRIMARY WORK`, or
`PHASE CHANGED THE SESSION SHAPE`.

Strength: Foundation raises the library's 3–5 primaries to 6–8 at eased effort
so performance is established first, then the library's own heavy prescription
arrives on purpose rather than on day one. Muscle + Strength: Foundation trains
the plain hypertrophy prescription, then the D36 hybrid band — its mixed
identity survives because the accessories never move. Build Muscle, General
Fitness and Recomp remain single-phase by design: their programming earns
results from repeating the same movements long enough to load them.

**Time is resolved once.** `programPhaseRxForWeek(program, week)` is the single
place a week's prescription is decided; `resolveProgramWorkout` and
`builderTemplateOf` accept it, Today passes the actual program week, and the
map passes the selected week. Verified live end to end on one program: week 1
Bench Press 5×**6–8**, week 6 Bench Press 5×**3–5**, same seven-exercise
session, accessory Cable Crunch unchanged at 3×12–15 — and the changed target
reached the live log rows, not just the preview.

**The explanation follows the training.** `derivePhaseChangeNote` compares the
composed sessions under each phase and reports the movement that actually
changes ("Your main lifts move from 6–8 to 3–5 reps. The rest of each session
stays as it is."). A boundary that changes nothing produces no note — proven
against a fabricated label-only phase. The stale "stay the same" copy is gone,
and its contract was inverted to forbid it.

**Defects found and fixed:**

- *Phase note sampled one day.* It read only the first training day, so a
  program whose change landed on a later session reported "nothing changed"
  while genuinely having two phases. It now scans every training day for the
  first primary that moves.
- *A fixed 46,000-character audit window* had silently shrunk again as the
  generation region grew, hiding the reference-not-copy assertion. Marker-
  bounded, like the two D36 windows, plus a pin that the region is measured
  whole.

**Ownership is one-directional.** The trainer never selects a phase; the
calendar does. Phase transitions are deterministic and derive from
`getCurrentProgramWeek`, which already freezes during a pause — pinned: a
program paused in week 3 and read two months later is still in week 3, and
still in its Foundation phase. The program owns rep intent, the trainer chooses
load inside it, and a phase change simply hands the trainer a new range.
`TRAINER_ENGINE_VERSION` remains `0.1.1-shadow`; no threshold, state,
calibration or evidence semantics changed, and no historical evidence is
reinterpreted.

**Storage is ids.** A block may carry `rx`, a prescription profile id resolved
through `PRESCRIPTION_PROFILES` at read time — the same architecture D36
introduced, extended rather than duplicated. No sets, reps or effort values are
persisted. A block without `rx` (every program built before D37) resolves to
the entry's own profile, which is exactly its previous behaviour: no boot
migration, no active program changes shape, `DATA_KEYS` still 15.

Validation: `npm run audit:program` grew to 191 checks with an oracle that
resolves each phase itself rather than reading its label, adversarial fixtures
(label-only boundary, identical-prescription boundary) proven caught, and
per-phase duration-band and monotonicity sweeps. Contract 136 adds 33
always-on guards. 5,130 passing. Phase resolution byte-identical across 100
repeats; generation still ~0.8ms.

## §61 — Program lifecycle & completion (D38, loop-v108)

**D37 pre-flight.** The D37 report contained two statements that could not both
be true about Recomp phases. Production was inspected rather than guessed:
`builderPhasePlan` returns two phases for `strength` and `recomp`, and the
sweep confirms Recomp earns a boundary in 160/160 intermediate and experienced
combinations at 6 and 8 weeks (Strength: 40/160, the rest collapsing correctly
where its primaries already sit inside the Foundation band). Build Muscle and
General Fitness are single-phase at every length. The D37 report's second
statement wrongly included Recomp in that list — **a report wording error, no
code defect.** No behaviour changed; the classification is now pinned by
Contract 137's phase checks and the audit's per-goal breakdown.

**A program had no ending.** `completeProgram` existed but was reachable only
from a "Mark complete" button buried in program detail, so a program whose
eight weeks had elapsed sat at "Week 8 of 8 · Active" indefinitely — and kept
scheduling sessions into dates past its own end (verified: a workout offered
16 days after the end date, still claiming week 8).

Lifecycle is now DERIVED, never migrated. `deriveProgramLifecycle` returns
`active | paused | ended | past | completed` from fields the program already
stores, so a program saved months ago reads correctly the moment this ships and
nothing is rewritten at boot. `programTimelineEnded` builds on
`programEndDate`, which already accounts for paused days — a program paused in
week 3 and read in December is still paused, never finished. `DATA_KEYS`
remains 15.

**Completion states only what was logged.** `deriveProgramCompletion` is pure:
program truth plus immutable history in, facts out, nothing persisted. Tone is
graded by evidence — zero sessions reads "Your program period has ended. No
workouts were logged."; one or two reads quiet; genuine training earns the
confident tone. The words *missed*, *failed* and *poor* appear nowhere, and an
unknowable denominator (a program with no scheduled days) reports `null` rather
than a fabricated zero-of-zero, which is D27's rule applied at program scale.

**Program membership is exact going forward, honest about the past.** Newly
logged workouts record `programId` when a program is genuinely running —
optional, exactly like the existing duration fields, written in the one save
path. Sessions logged before D38 have none and fall back to the program's date
window, and that fallback explicitly excludes anything already claimed by a
different program, so two programs can never both count the same workout.
Nothing historical is backfilled.

**History was already durable; it was not reachable.** `programsStore.programs`
is an array and completed programs were never destroyed — the gap was that
nothing surfaced them. My Training now shows the finished program's summary in
place of active-program chrome (the hero, progress line and "next session" row
all stand down, so one screen cannot say "Active" above "Program finished"),
followed by a quiet Past programs list. Past-program detail is read-only and
reuses the completion panel, so there is one description of a finished program
rather than two that can drift.

**Continuation is offered, never taken.** "Build next program" opens D33's
builder in create mode with the finished program's goal, experience, session
length, emphasis, duration and days copied in — copied, never referenced, so
editing the draft cannot reach back into the finished program. Verified:
changing the new draft to Back emphasis left Program A on Chest, byte-identical
in name, start date, blocks and schedule, while Program B became a distinct
instance starting today. D33's "writes nothing until Start" is untouched: LOOP
never decides the next program.

**Defect found: program history was silently dropped on import.** Exactly the
D32 cardio defect, repeated. `importAllData` merged `workoutLog` and
`cardioLog` by id but let `programs` fall through to the fill-only rule, so
importing a backup onto a device that already had any program discarded every
program in it — a real integrity failure now that a finished program is a
record of training. Programs merge by id like the other histories, the device's
own active program is never displaced by an imported one, and the import
reports what it restored. Verified live: first import "1 new program added",
second import of the same file "0 new programs added", zero duplicates.

**Boundaries held.** No trainer coupling: completion reads performed history
and never asks the trainer anything, creates no evidence, and awards no XP or
mastery for reaching a date. `TRAINER_ENGINE_VERSION` remains `0.1.1-shadow`.
Starting Program B left `workoutLog`, `trainerLog`, XP, PR history and
`cardioLog` byte-identical.

Validation: `npm run audit:program` grew to 220 checks, including an oracle
that computes end dates independently and adversarial fixtures proven caught —
`PROGRAM ENDED WHILE PAUSED`, `FUTURE WORKOUT AFTER PROGRAM END`,
`PROGRAM COUNTED FOREIGN WORKOUT`, `PROGRAM CLAIMED UNKNOWN AS MISSED`,
`PROGRAM LOST AFTER NEXT START`, `PROGRAM HISTORY MUTATED`. Contract 137 adds
37 always-on guards. 5,167 passing; 87 data-integrity, 261 cardio-lifecycle and
43 GPS checks still green. Completion derivation over 200 sessions stays well
inside a second.

## §62 — Performance progress & outcome integrity (D39, loop-v109)

**One strength model, not a second one.** LOOP already had `estimate1RM`
(Epley), `classifyExerciseType`, `supports1RMEstimate`, `isWorkingSet` and the
`CAPABILITY_CONFIG` thresholds. D39 reuses every one of them and adds no rival
formula. `PERF_CONFIG` holds no numbers of its own — its fields are getters that
derive from `CAPABILITY_CONFIG`, so tuning capability tunes progress with it and
the two surfaces cannot drift into disagreeing about the same lift.

**No progress claim without comparable evidence.** A movement is reported only
if it is comparable in principle (`supports1RMEstimate` on its classified type;
bodyweight movements are excluded because their load is not recorded) and
evidenced in fact. A direction needs 4 sessions with at least 2 in each half; a
numeric percentage needs 6 with at least 3 in each half. Below that the exercise
is carried as insufficient and the surface renders nothing at all — an absent
section, never an empty one, and never a hedged claim.

**A PR is not a trend.** Each session contributes one observation: the best
valid estimated 1RM from its working sets. Warm-ups are dropped
(`isWorkingSet(st) === false`), uncompleted sets are dropped, reps beyond
`maxRepsFor1RM` are dropped because Epley stops being meaningful there, and
skipped exercises contribute nothing. The two halves are compared by MEDIAN,
not mean or max, so a single freak session cannot manufacture a trend: a flat
history plus one 315 lb outlier against 185 lb working sets reports Steady at
0.0%, which is the correct answer and the one a max-based comparison gets wrong.
The halves are equal and disjoint, with an odd middle session dropped rather
than double-counted.

**Identity is canonical or the exercise does not exist.** Grouping runs through
`resolveExerciseId` and rejects anything resolving to `unmapped:`. No substring
matching, no name inference — the D34 class of bug (Leg Curl attributed to
biceps, "machine" containing "chin") cannot recur here. Bench Press and Incline
Bench Press stay separate lifts.

**Read-only, and proven so.** The layer derives; it persists nothing.
`DATA_KEYS` remains 15 and no localStorage key was added. Rendering every D39
surface three times over leaves `workoutLog`, `trainerLog`, `programs`,
combined progression, PR events, `cardioLog`, capability output and the
localStorage key set byte-identical. `TRAINER_ENGINE_VERSION` remains
`0.1.1-shadow`: no threshold, calibration, state or evidence rule was touched.
§7 holds — `computeExerciseCapability` returns exactly what it returned before.

**One function, three surfaces.** `performanceHighlightsHtml` renders the
program completion panel, the past-program overlay and My Training’s "Progress
so far". They cannot report different numbers for the same training because
they are the same call. Wording is bounded by what the evidence supports:
"+9% estimated strength" only where numeric evidence exists, "Trending up" or
"Steady" otherwise, and nothing where neither holds. Declines are never painted
as alarms. There is no confidence score, no program score, no causal claim that
the program produced the change, and no body-composition claim — all four are
pinned by Contract 138 against comment-stripped source, so only shipped code
can violate them.

**Verification.** 5,202 assertions across 138 always-on contracts. The program
audit reached 246 checks; its section 18 reimplements Epley, the median, the
observation filter and the half-split from scratch as an independent oracle and
agrees with production on every fixture. 87 data-integrity, 261
cardio-lifecycle, 43 GPS and 252 date checks still green. Deriving progress
over 600 sessions takes 2.5 ms.

## §63 — Program outcomes & completion integrity (D40, loop-v110)

**Composition, not a second model.** D39 answers "am I improving on this
lift?". D40 answers "did this program produce meaningful training progress?"
by reading D39’s per-lift directions — nothing more. `deriveProgramOutcome`
calls `deriveProgramPerformance` and never touches `estimate1RM`,
`perfMedian`, `isWorkingSet` or `perfSessionObservation`; Contract 139 reads
the function body and fails if any of those names appear inside it. The
evidence gates stay exactly where D39 put them: 4 sessions for a direction,
6 for a percentage, unchanged and unweakened.

**Never a cross-lift percentage.** Bench +10%, Squat +4% and Row +8% do not
make a program "+7.3% stronger" — different movements carry different
absolute loads and different evidence quality, so the average would be a
number with no referent. The program answer is SEMANTIC: it counts how many
comparable lifts moved which way. The audit computes the mean of the lift
percentages itself and asserts that number appears nowhere in the result,
and the contract fails if `reduce(` ever enters the derivation.

**The evidence floor was measured, not chosen.** Sweeping all 75
goal/frequency/length combinations of the generated library: at full
adherence every program yields at least 5 comparable lifts clearing D39’s
4-session gate (median 14), and even the smallest — a 2-day program — yields
5. So `OUTCOME_CONFIG.minEvidencedLifts = 3` stays reachable for the smallest
real program while refusing to let one or two lifts speak for a training
block. The same sweep shows 4-week programs mostly CANNOT clear the
6-session percentage gate — that is correct and was left alone rather than
tuned away.

**Five states, and a 3:1 rule.** `improving` and `declining` each require 3
lifts on that side outnumbering the other 3:1, so a real result survives the
one movement that always misbehaves while 5 improving lifts can never bury 2
that fell; `mixed` needs genuine movement in both directions; `steady` means
enough evidence, mostly stable; `insufficient` means the program says nothing
about itself. The rule lives in one config, not scattered through renderers.
The audit sweeps the whole small-program state space and asserts properties
taken from the product rules rather than from the code — a verdict never
contradicts its own evidence, improvement and decline are treated
symmetrically, no single lift decides a program, and lifts without enough
evidence never change the answer.

**Unknown is not steady; unsupported is not decline.** A movement e1RM cannot
describe (cable flies, pushdowns, lat pulldowns) contributes to no count in
either direction. A hypertrophy program built almost entirely from such
movements returns `insufficient`, never a negative result.

**Adherence and outcome never impersonate each other.** They are separate
derivations: the outcome object carries no `completedSessions`,
`plannedSessions` or `prs` field, and a PR count cannot move a verdict. The
seven-at-185 plus one-at-315 fixture still reports `steady` at the program
layer, exactly as it does at the lift layer.

**What LOOP may say.** Wording is bounded by the evidence type: D39 measures
ESTIMATED STRENGTH from completed working sets, so the sentence says that
whatever the program’s goal was. A hypertrophy program is never described as
having built muscle, a recomp program is never described as recomposition,
and a general-fitness program is never described as improved fitness. Nothing
claims the program CAUSED the change — only that performance moved while it
was being trained. No score, no grade, no next-program recommendation.

**Two defects found and fixed.**

*A second program-history calculator was still shipping.*
`getProgramCompletionSummary` predated D38 and attributed workouts to a
program by date window alone, ignoring `programId` entirely — so it could
claim sessions belonging to another program. It powered the "Mark complete"
alert, which meant that alert could report a different workout and PR count
than the completion panel shown seconds later for the same program. It is
deleted; `doCompleteProgram` now uses `deriveProgramCompletion`, the
canonical rule. Contract pin: the superseded assertion was repointed at the
canonical derivation and a new one fails if the legacy function ever returns.

*37 font-size declarations had been resolving to nothing since D33.* The
program CSS written across D33–D39 used a t-shirt token vocabulary
(`--fs-xs/sm/base/lg/xl`) that the design system never defined — its real
scale is `--fs-micro/meta/support/body/section/title/metric`. Every one of
those declarations was invalid and dropped, so the elements silently
inherited: on the completion panel the program name, its supporting line and
its metric numerals all rendered at 16px body size, and a builder question’s
subtitle rendered nearly as large as the question. Verified by computed style
on the live panel before the fix. The phantom names are now aliased onto the
roles they meant rather than given values of their own, so the scale keeps
one number per role.

**Read-only, and proven so.** Rendering every D40 surface five times over
leaves `workoutLog`, `trainerLog`, `programs`, `cardioLog`, PR events, XP,
level, rank, recovery, readiness, mastery, capability output, the
localStorage key set AND the full localStorage contents byte-identical.
`DATA_KEYS` remains 15, no key was added, and no outcome is persisted or
cached — an edited or deleted workout changes the answer the next time it is
asked. `TRAINER_ENGINE_VERSION` remains `0.1.1-shadow`.

**One function, three surfaces.** Program completion, My Training’s finished
program and the past-program overlay all render through
`programCompletionHtml`, which derives the outcome itself rather than being
handed one, so they cannot disagree. Verified live: identical kicker,
headline, rows and aria-label on completion and archive, and identical again
after a reload. An ACTIVE program still shows D39’s "Progress so far" and is
given no final verdict.

**Verification.** 5,236 assertions across 139 always-on contracts; the
program audit reached 282 checks. 87 data-integrity, 261 cardio-lifecycle, 43
GPS and the full date matrix still green. 100 repeat derivations are
byte-identical; 50 derivations over 40 sessions take 5 ms. Six viewports
clean with worst-case content — a mixed outcome heading above "Dumbbell
Bulgarian Split Squat +14% estimated strength" and "Standing Barbell Overhead
Press −11% estimated strength" — 0 offscreen, 0 clipped, 0 horizontal
overflow.

## §64 — Workout provenance & program evidence integrity (D41, loop-v111)

**A workout can be real training without being PROGRAM training.** D40 left
this open and said so: every workout saved while a program was running
inherited that program’s id, so a rest-day arm session became evidence the
program had prescribed it. The root cause was a single line in the one save
path — `newEntry.programId = _ap.id` — which read the ACTIVE program at save
time and knew nothing about how the session had been started.

**Origin is decided when a workout begins, not when it is saved.**
`openFreeformLog` records `freeform`. `startTemplateLog` asks
`programPrescribesTemplate`, which reads the program’s own schedule — its
STRUCTURE, never today’s date — so Monday’s Upper A trained on Tuesday is
still the program’s work (§56), while a movement the program does not contain
is extra training however convenient the calendar. "Train anyway" on a rest
day was traced rather than guessed from its wording: it opens the workout
picker, so picking something the program does not prescribe is correctly
freeform, and picking a session it does prescribe is correctly program work.

**One field, not a policy record.** The workout carries `origin`
(`program` | `freeform`) plus the existing `programId`. Nothing stores
`countsForCompletion`, `countsForOutcome` or any other interpretation — those
may change, and history records what happened, not how to read it. No
localStorage key was added; `DATA_KEYS` remains 15.

**Three states, deliberately distinct.** `origin:'program'` with an id is
exact and outranks every date consideration. `origin:'freeform'` is
explicitly not program work and NEVER falls through to the date window.
Absence of `origin` means UNKNOWN — logged before provenance existed — and
only those records may use the window. Conflating "explicitly not this
program" with "we do not know" was the specific trap §16 warned about, and
the audit pins that a known-freeform session and a legacy session at the same
date inside the same window resolve differently.

**One membership policy.** `workoutBelongsToProgram` is the only place a
membership decision is made; the source now contains exactly one
`.programId ===` comparison and a contract fails if a second appears.
`programWorkouts` delegates to it, and every program consumer — completion,
adherence, program PR counts and the D40 outcome — goes through
`programWorkouts`.

**A third calculator was found and consolidated.** `getProgramProgress`, which
powers "sessions done" on Today and My Training, counted EVERY workout inside
the program’s date window. An extra rest-day session therefore raised the
program’s completion count directly in the UI. It now counts membership,
capped at today.

**Program PR counts were date-only.** PR events carry no workout id, so the
program recap matched them by date alone: a record set in an extra session on
the same day as a program workout was credited to the program. Matching is now
by date AND exercise. Verified live — 9 global PRs, 8 program PRs, with the
freeform Bench record real everywhere and absent from the program.

**Freeform is still real training.** D41 restricts PROGRAM-ATTRIBUTED claims
and nothing else. The membership helper references no capability, trainer,
recovery, mastery or XP symbol, and a contract fails if it ever does. Verified
live: an extra Bench session at 315 lb appears in global performance history,
sets a real PR, and feeds capability — while being wholly absent from the
program’s own Bench evidence, which stayed 8 flat sessions reading steady.

**Drafts keep their origin.** Provenance is written into the draft and
restored on resume, so activating, switching or finishing a program midway
through a workout cannot retroactively change what that workout is. Older
drafts carry none and stay unknown rather than being guessed into a program.

**Nothing historical was touched.** No migration, no backfill, no inference
from titles or dates. Browsing every program surface twenty times leaves a
legacy record byte-identical, with no `origin` field added — there is no
read-time normalization.

**Backup round-trip.** Provenance rides on the workout record, so no new
top-level backup key was needed. A modern export/import preserves origin
exactly and reproduces an identical program outcome and completion. A
pre-D41 backup imports with no invented provenance and falls back to the date
window — demonstrated by the same two workouts attributing as 1 session
(modern, exact) versus 2 (legacy, approximate).

**Verification.** 5,272 assertions across 140 always-on contracts; the program
audit reached 301 checks, including a declared 14-case membership matrix whose
expectations are written from the product rules rather than computed by the
function under test, and a 36-combination status × origin × date sweep. 87
data-integrity, 261 cardio, 43 GPS and the full date matrix still green. D39’s
gates (4 sessions / 6 for a percentage) and D40’s aggregation thresholds are
pinned unchanged. `TRAINER_ENGINE_VERSION` remains `0.1.1-shadow`.

**Remaining limitation, stated plainly.** Workouts logged before this release
carry no origin and are still attributed by date window, so a pre-D41 extra
session inside a program’s dates still counts toward that program. That
ambiguity is historical and is left honest rather than repaired by guessing.
Attribution is exact from this release forward.

## §65 — Next program continuity & post-program guidance (D42, loop-v112)

**Finishing a program was the end of the product.** The completion panel
offered one button, "Build next program", which always prefilled everything
and jumped to the review. There was no way to say "similar, but not the
same", and no way to reconsider without abandoning the flow entirely.

**Three ways forward, one builder.** Keep the goal, change what it focuses
on, or start from scratch. All three call the same `startNextProgramFrom`,
which opens the same D33 builder — there is no continuation generator beside
the real one. A contract fails if a second entry point, a second prefill
helper, or a `continueProgramGenerator`-shaped function ever appears.

**Intent decides the landing point, not a different code path.** Keeping the
goal lands on the review it can be edited from; changing focus drops the
emphasis and lands on the question that exists to ask it; starting fresh
assumes nothing and begins at question one. `deriveNextProgramPrefill` is a
pure function returning ANSWERS — it cannot create a program, and a contract
reads its body to prove it never calls `createProgram`, `setActiveProgram`,
`pbCommit` or any store write.

**Prefill is history, never today.** Goal, experience, session length,
emphasis, length and training days come from the finished program itself —
what the athlete actually chose when they built it — so changing a profile
later cannot rewrite what the previous block was. Values arrive as copies:
pushing a day onto the prefilled schedule leaves the finished program
byte-identical, which is pinned. A legacy program missing metadata prefills
only what it genuinely has and lets the builder default the rest; nothing is
invented.

**Outcome is context, never cause.** D40 can see that performance moved
DURING a program; it cannot run the counterfactual. The rationale line says
at most "Your goal is still Build Muscle, and this program showed measurable
progress on 4 of 5 comparable lifts." Contracts reject `made you`, `caused`,
`because this program`, `this program failed` and `proves`, and separately
reject `you need a`, `you should`, `deload`, `switch to` and `replace your`:
D42 may report, never prescribe. A decline is stated by the outcome above and
then left alone — no recovery, nutrition, overtraining or plateau language
appears anywhere, because LOOP does not know which of those it was.

**A louder button is not evidence.** A primary action is offered ONLY when
the outcome is `improving`. Mixed, steady, declining and insufficient all get
a level hierarchy of three equal secondary buttons — pinned, so a future
redesign cannot quietly manufacture confidence the evidence does not support.
There is no score, confidence figure or rating in the result object.

**Nothing starts itself.** Rendering the completion panel, opening a past
program and deriving the next step five times over leaves `programs`,
`workoutLog`, `trainerLog`, `cardioLog`, PR events, XP, level, rank,
recovery, readiness, mastery, capability output, the localStorage key set and
the full localStorage contents byte-identical. Opening all three intents in
the builder and closing it again leaves the programs store byte-identical: a
program exists only after the athlete taps Start.

**The athlete outranks the suggestion.** Verified live: the builder opens
prefilled with `hypertrophy`, the athlete picks `strength`, and `strength`
wins. The prefill is a starting point, not a decision.

**Completion and review agree, but do not nag.** Both render through
`programNextStepHtml` and the same `deriveNextStep`, so they can never frame
the same block differently. The just-finished panel asks the full three-way
question; reviewing a program months later offers a single quiet "Use as a
starting point" instead. Same truth, different volume.

**History survives the next program.** Starting Program B produced a new id
and a new start date, and left Program A’s outcome, completion summary, next
step and stored record byte-identical. Then eight heavy Bench sessions inside
B changed nothing about A: A’s Bench evidence stayed 8 sessions while B
carried its own 8, and global Bench history spanned all 16 — the athlete’s
strength history is continuous even though the programs are isolated. XP and
PR totals were unchanged by starting a new program: a new program is not a
new athlete.

**Not a second trainer.** `deriveNextStep` references no `trainerLog`,
`computeExerciseCapability`, readiness, recovery or `TRAINER_CONFIG` symbol,
and a contract fails if it ever does. `TRAINER_ENGINE_VERSION` remains
`0.1.1-shadow`; D39’s gates (4 sessions / 6 for a percentage) and D40’s
aggregation thresholds are pinned unchanged. `DATA_KEYS` remains 15 and no
recommendation is persisted — `nextRecommendation`, `recommendedNextProgram`,
`shouldRepeat` and `outcomeDecision` are all rejected by name.

**Verification.** 5,309 assertions across 141 always-on contracts; 301
program-audit checks, 87 data-integrity, 261 cardio, 43 GPS and the full date
matrix green. 100 next-step derivations and 100 prefills are byte-identical,
and the layer contains no `Math.random`. Six viewports clean with the
next-step block actually on screen: 3 buttons, all 48px, 0 offscreen, 0
clipped, 0 horizontal overflow.

**Remaining limitation.** The manual on-device checklist in the D42 brief
(§96) was not physically performed — everything above was verified in the
desktop browser at phone viewports, which is not the same as a real iPhone.

## §66 — Planned vs performed integrity (D43, loop-v113)

**The completion summary divided one population by another.** The numerator
counted every workout belonging to the program; the denominator counted the
sessions the program planned. An athlete who trained more than the plan asked
read "48 workouts of 32 planned" — a ratio with no meaning. Reproduced live,
then fixed at the semantics rather than the surface.

**The fix is not a clamp.** `min(48, 32)` would have hidden the defect and
left the arithmetic wrong; a contract now reads the derivation body and fails
if `Math.min(` appears in it. Instead `deriveProgramPlanFulfillment` assigns
every program-member workout to at most one planned slot, and every planned
slot to at most one workout. Adherence above 100% is impossible by
construction rather than by truncation.

**Four facts, no longer impersonating each other.** Program workouts (what
belonged to the program), planned sessions (what it asked for), fulfilled
planned sessions (the only honest numerator), and additional sessions
(training beyond the plan). The live 48/32 fixture now reports 32 of 32
planned, 48 workouts, 16 additional — all three true at once.

**Matching, strongest identity first.** The slot’s own date and category;
then the same program week and category within `PLAN_SHIFT_DAYS` (2), so a
session moved a day is the same session rather than a miss plus an extra;
then the date alone, but ONLY where one side does not record a category — a
known mismatch never fulfils, so training core on the day an upper session
was planned leaves that upper session outstanding. The window is declared
once, not scattered through renderers. Within each pass the pool is walked
oldest-first with the id as tiebreak, so the order history arrives in cannot
decide adherence: pinned by deriving against a reversed log.

**Three more defects found by the same audit.**

*`programDayState` marked a planned day done if ANY workout shared its date*,
ignoring membership entirely — a freeform session completed the program’s day.
It now reads the fulfilment slot.

*`getMissedProgramDays` had the same blindness*, suppressing a missed mark for
any workout on the date. It now considers only this program’s own fulfilments.

*`getProgramProgress` compared membership-to-date against planned-to-date*, so
extra training pushed "sessions done" past the number planned in the live UI.
Both sides now describe planned sessions; verified that completed never
exceeds planned-to-date on an active program.

**Unknown is not zero.** A program whose schedule cannot be reconstructed
reports `planningKnown: false`, `plannedSessions: null` and
`fulfilledSessions: null`, and its headline states the workout count instead
of a ratio. No `NaN`, no `Infinity`, no "0 of 0". Its real training is still
counted. Nothing is backfilled and no history is guessed from titles or dates.

**Extra training is neither credit nor fault.** Adding unmatched program
sessions cannot raise planned completion and cannot lower it; adding a genuine
fulfilment raises it by exactly one. All three are pinned. The extra sessions
remain in history, in membership, in D40 evidence, in PRs, mastery, capability
and recovery — D43 corrected a read model, it did not erase work.

**Nothing foreign fulfils a plan.** A freeform session on a planned day, a
freeform session titled like the plan, and a workout owned by another program
all fulfil nothing and are not even members — D41 still decides who may reach
this layer at all.

**Derived, never stored.** No workout is stamped fulfilled, extra or missed;
no adherence is persisted; `DATA_KEYS` remains 15 and the backup schema is
unchanged. Browsing every surface five times leaves programs, workoutLog,
trainerLog, PR events, XP, the localStorage key set and its full contents
byte-identical.

**The phases underneath are untouched.** `TRAINER_ENGINE_VERSION` remains
`0.1.1-shadow` and the trainer never consumes adherence. D39’s gates and
D40’s aggregation thresholds are pinned unchanged, and D40 outcomes are
deliberately NOT restricted to fulfilling workouts — an extra program session
is still program performance evidence. D42’s next-step flow is unchanged.

**A separate pre-existing defect, fixed in the tests only.** Four calendar
assertions were failing on the pristine commit before any D43 change: the
suite ran on the 1st of a month, the calendar correctly rendered the current
month, and the fixture placed its sessions 1/3/6 days earlier — in the
previous month. The product was right; the fixture assumed the suite never
runs early in a month. Offsets are now clamped into the rendered month
(historyCalMonth is module-scope and cannot be pointed elsewhere from the
harness), the accessible-name count is measured against the days the month
actually has in the past, and the pre-tracking assertion demands the mark only
where such a day exists while asserting the underlying rule unconditionally.
This is the second date-fragile fixture found in two phases.

**Verification.** 5,344 assertions across 142 always-on contracts; the program
audit reached 327 checks, including a hand-declared fulfilment table whose
expected numbers are worked out from the product rules rather than computed by
the code under test. 87 data-integrity, 261 cardio, 43 GPS and the full date
matrix green. 100 derivations byte-identical. Six viewports clean.

**Remaining limitations.** LOOP stores only the CURRENT program schedule, so a
program edited mid-cycle is measured against the plan as it stands now, not as
it stood three weeks ago — historical plan revisions are not recoverable and
are not guessed. The plans consistency percentage (a separate subsystem from
programs) still divides workouts-in-week by planned-days-in-week and clamps
the result to 100%, which is the same class of defect in a different place;
it was audited here and deliberately left for its own phase rather than
changed alongside program adherence.

## §67 — Plan consistency integrity (D44, loop-v114)

**The same defect D43 fixed for programs, in the plans subsystem.** Weekly
consistency divided workouts performed by planned days known:
`Math.min(100, Math.round((workouts / target) * 100))`. Training on an
unplanned day pushed the ratio past 100% and the clamp hid it — so a week
where the athlete skipped Wednesday but trained Tuesday and Saturday still
read 100%.

**One matcher now, not two.** D43’s assignment was extracted into
`assignWorkoutsToPlannedSlots(slots, workouts, weekOf)` and both callers share
it: a program schedule and the athlete’s weekly schedule differ in where their
slots come from, not in what fulfilling one means. `PLAN_SHIFT_DAYS` is still
declared exactly once. Contracts fail if a second assignment implementation, a
second shift constant, or a per-surface consistency calculator appears.

**Consistency is fulfilled plans over knowable planned days.** Each planned
day in the window becomes one opportunity, matched to at most one session, and
each session can satisfy at most one opportunity. `fulfilled <= target` holds
by construction, so the clamp was deleted rather than adjusted — a contract
reads the function body and fails if `Math.min(100` returns.

**Verified live, on the exact defect.** A week planning push/pull/legs where
the athlete trained Monday and Friday plus three unrelated extra sessions:
five workouts logged, and consistency reads **2 of 3 — 67%**. The old code
produced `min(100, 5/3)` = 100%. Extras cannot raise the percentage, cannot
lower it, and fulfilling a genuinely missed day raises it by exactly one
session; all three are pinned.

**What still counts as fulfilment.** A session trained a day or two off its
planned day is that session, not a miss plus an extra — the same narrow
window program plans use. A category mismatch on a planned date never fulfils:
an arms session on a planned push day leaves push outstanding. Two matching
sessions on one planned day earn one credit.

**Future and unknown are not failures.** Only planned days that are knowable
and already due enter the denominator, so future sessions cannot drag the
number down. A plan LOOP does not know reports `null` for both planned and
consistency rather than 0%, and that training is still counted as training. No
NaN, no Infinity.

**A dead rendering path found.** `renderHeatmap()` — which draws the Log
consistency block: the large percentage, the "of your Nx/week target" label
and the "X of Y planned sessions completed" line — looks up
`document.getElementById('heatmapCard')`. **No element with that id exists**
anywhere in the markup (the CSS class is `.heatmap-card`), so the function
returns at its first guard, and its only callers are onclick handlers that the
unreachable block itself generates. That entire Log surface has never
rendered. Its copy was corrected to read fulfilled plans along with everything
else, but the surface was deliberately NOT resurrected here: mounting an
unseen UI inside a metric-integrity phase would be shipping a new screen under
cover of a bug fix, and there is no way to know where it was meant to sit.
Recorded for its own decision.

**Nothing else moved.** `totalWorkouts` still counts workouts — volume and the
training trend are genuinely volume questions and keep their own numerator.
Momentum still does not read the 12-week percentage. The trainer never reads
consistency and remains `0.1.1-shadow`; D39, D40, D41, D42 and D43 thresholds
are pinned unchanged, and the D43 program audit still passes at 327. Nothing
is persisted and `DATA_KEYS` remains 15.

**Two superseded contracts repointed.** One pinned the literal
`Math.min(100, (totalWorkouts / totalPlanned) * 100)` — that line WAS the
defect, so the contract now pins the corrected numerator plus the absence of a
clamp. The other pinned the exact statement `if(...) plannedKnown++;`, which
became a block that also records the opportunity; it now follows the
condition rather than the statement.

**Verification.** 5,374 assertions across 143 always-on contracts; 327
program-audit checks, 87 data-integrity, 261 cardio, 43 GPS and the full date
matrix green. A hand-declared consistency table of 7 cases, 100 derivations
byte-identical, reversed history identical, and the window proven to span a
month boundary while still agreeing. Six viewports clean with no percentage
above 100 anywhere on screen.

**Remaining limitations.** LOOP stores only the CURRENT weekly schedule, so a
schedule changed today re-describes past weeks — historical schedule
revisions are not stored and are not guessed, which is the same honest
limitation program adherence carries. The Log consistency block remains
unreachable, as above. Neither the phone checklist nor the PWA update was
physically performed on a device.

## §68 — Core experience refinement (D45B, loop-v115)

**The first phase driven by physical use.** D45A changed nothing and produced a
checklist; the owner trained with LOOP 3.7 on iPhone and rated it 8/10, marking
the logger, rest timer and Log as Smooth and naming five points of friction.
Everything below answers one of those, or was found while answering one.

**Correcting a workout now uses the controls it was logged with.** The owner's
words were that going back to fix a set "should reload back in the workout page
not some different logging page — this feels inconsistent". Reproduced exactly:
the logger gives ±5/±1 steppers at 44px, a six-option RIR picker and one
exercise filling the screen; the editor gave bare text inputs and `<select>`
dropdowns in a six-column spreadsheet grid. The grid could not hold a stepper —
weight and reps had ~73px each at 375px — so the set row became two lines: what
the set WAS on top, the logger's own steppers underneath. `ewStep` reuses the
logger's `clampStepValue` and writes through the one canonical `editSetField`;
it deliberately does not reuse `stepValue`, which propagates a weight forward
into later sets and saves the live draft, neither of which belongs in a
correction to history. The shared column header went with the grid it labelled.

**The session score was removed, not restyled.** The owner asked for a score
that "feels REAL, not arbitrary". Audited: `completion(40) + repTargets(25) +
progress(20) + records(15)`. Completion was near-constant, because saving a
workout already drops empty sets, so it scored 40/40 for essentially every
session. Rep targets did not measure a target — it compared reps against the
most reps done last time, so adding weight and doing fewer reps, the ordinary
way a lift progresses, scored as a miss. Progress compared volume against the
last session of the same category, so matching last week scored 10/20 and a
deliberate lighter week read as failure. The practical range was roughly 68–100
with no way for the athlete to predict or check it. D31 had already noticed the
shape of this — "an unnamed number there reads as an objective grade of the
workout when 40 of its 100 points are simply completion" — and answered by
naming it. D45B finished the thought: the grade is gone and what remains is the
evidence it was built from, stated as facts the athlete can verify against their
own sets. Four contracts that existed to make the number less misleading were
replaced by one stronger guarantee: completion states facts and grades nothing.

**Momentum was removed and its one unique reading kept.** D22 moved the level
out of it; D27 removed its copy of the week, noting This Week already showed
"2 of 4" a few hundred pixels up the same screen. What survived was a sentence
restating that card and a lifts reading restating Progress — which the button
directly beneath it opens. The owner marked it friction. The section, its
headline, its progress reading, its renderer and twelve `.mo-*` rules are gone;
the week streak moved into This Week, beside the week it counts. `momentumWeek`
survives under its own heading because This Week reads it. Its section header
had been left labelling the insights block below it, which is now titled
"Worth knowing" and renders its own heading, fixing a latent bug where a new
athlete saw a bare heading over nothing.

**The dead heatmap is retired.** D45A classified it RETIRE CANDIDATE; the Owner
QA then reported Log as Smooth with nothing missing, so the evidence was in.
`renderHeatmap`, `scoreRingSvg`, `scoreBand`, both selection handlers, both
selection variables and fifty `.cons-*` / `.score-ring` rules are removed —
13.4KB that could never execute. Two harness module boundaries that used
`let selectedConsistencyWeek` as a landmark now use the CARDIO SYSTEM header,
which is a real boundary rather than an incidental declaration.

**A live defect the dead code had been hiding.** D44 corrected "X of Y planned
sessions" inside `renderHeatmap` — copy that never rendered. The LIVE Log strip,
`logConsistencyStripHtml`, still summed `w.workouts` against `w.plannedKnown`,
so a week trained beyond its plan could read "12 of 8 planned sessions". Its
footer, its on-target bar state and its spoken labels now use `w.fulfilled`;
bar height stays on sessions trained, because that is a picture of the work
done rather than a claim about the plan. Correcting dead text is precisely why
this survived D44, and the contract that pinned it now follows the strip an
athlete can see.

**Not attempted, and why.** Progress Overview and My Training were both marked
friction and are not addressed here. Both are substantial information-design
efforts on surfaces the owner otherwise rated workable, and rushing them
alongside five other changes risked the card soup the brief warns against.
They are carried forward whole rather than half-done.

**Verification.** 5,371 assertions, 327 program-audit checks, 87
data-integrity, 261 cardio, 43 GPS and the full date matrix — all green.
`index.html` is 14,622 bytes smaller. Six viewports clean across the editor,
completion and Today. `DATA_KEYS` remains 15 and `TRAINER_ENGINE_VERSION`
remains `0.1.1-shadow`; no threshold, calibration or state was touched, and
D39–D44 arithmetic is unchanged apart from the Log strip correction above,
which applies D44's own rule to the surface that renders.

---

## §69 — D46: What you trained, and a week allowed to be complete

**Status.** Shipped in LOOP 3.9 (`loop-v116`).

### The regression D45B introduced

D45B repointed the Log week strip at `deriveProgramPlanFulfillment` so a week
trained beyond its plan could no longer read "12 of 8". That was correct, and
it exposed a second defect underneath it: the fulfilment matcher requires a
performed workout's category to match the planned slot's category before it
will fill that slot. On the planner that is right — it is how D43 refuses to
call a push day satisfied by a run. On the Log strip it was wrong, and it cost
the athlete the green completed state on weeks they had actually completed.

The athlete does not label sessions the way the planner does. A day planned as
`pull` gets logged as `back`, or `arms`, or left on the default. Before D45B
the strip counted sessions, so this never showed; after D45B it counted
fulfilled slots, so a fully trained week rendered as partial.

`assignWorkoutsToPlannedSlots` now takes `opts.requireCategory`, defaulting to
`true`. The planner passes `true` and is unchanged in every respect. The Log
strip passes `false`, which adds one further pass over slots still unfilled:

```js
if(!requireCategory){
  slots.forEach(slot => {
    if(slot.workoutId) return;
    const hit = pool.find(w => !used[w.id] && w.date === slot.date);
    if(hit) claim(slot, hit);
  });
}
```

**That pass is same-day only, and the restriction is the whole point.** The
first implementation searched within the week, and the fixtures caught what
that meant: training twice on Tuesday rescued a missed Thursday. That is
exactly the substitution D44 exists to refuse, and relaxing the category must
not smuggle it back. Showing up on a planned day and calling the session
something else is a labelling difference. Not showing up is a missed day, and
no amount of training elsewhere converts one into the other.

Contract 143's declared table records both halves, so a future relaxation of
the day constraint fails a test rather than passing silently:

- *a session on a planned day counts whatever it was called* → 3 of 3, 100%
- *but training on an unplanned day never fills a planned one* → 2 of 3, 67%

### What you trained this week

Today ends with a block the athlete can read in one glance: two body
silhouettes with the muscles they trained this week shaded by volume, and the
top four listed with set counts.

`deriveWeekMuscleSets()` counts performed sets. A set is counted when it was
actually done — `isWorkingSet(st) === false` is excluded, so warm-ups do not
inflate it; `st.completed === false`, `reps <= 0` and `ex.skipped` are
excluded, so a planned-then-abandoned set is not credited. Legacy sets where
`isWorkingSet` returns `null` are counted, matching every other consumer of
that predicate: unknown provenance has always meant *count it*, and changing
that here would silently restate history.

Attribution is **primary muscle only**, through `musclesForExercise`. Secondary
involvement is real but it is not what the athlete is asking; crediting it
would make every pressing movement shade the triceps and every hinge shade the
whole posterior chain, and the picture would stop discriminating.

The header reports `setsLogged`, not the sum across muscles. Those differ, and
the difference is not a rounding artefact: an RDL is attributed to back and to
glutes, so summing the per-muscle counts double-counts every multi-primary
exercise. During QA the header read "40 sets" for a week in which the athlete
logged 30. `setsLogged` is the count of distinct performed sets; the per-muscle
figures sum higher and are labelled per muscle, where that is the correct
reading.

**This block makes no claim about stimulus, growth, hypertrophy, activation,
adequacy or balance.** It reports how many sets went to each muscle. It does
not say whether that was enough, and no threshold, target or colour-coded
judgement is attached to it. A contract asserts the absence of that
vocabulary in the derivation, so the block cannot quietly acquire an opinion
later. Shading is relative to the athlete's own top muscle for the week — it
encodes *their* distribution, not a comparison against a prescription that
does not exist.

Tapping the block opens the muscle detail in Progress. The block is one
`.tm-card` button, and it joins the shared surface recipe rather than
redeclaring its own elevation.

### Not attempted, and why

The Progress Overview command-centre rebuild is not in this release, and it
was the owner's stated first priority. The reason is D45B: a partial redesign
shipped alongside five other changes coincided with the rating falling from
8 to 7, and the correct lesson from that is not to do it again faster.
Overview is a full information-design pass on the surface the owner spends the
most time in. It is carried whole into D47 rather than half-built here.

Program visibility on Today and the My Training hierarchy are carried with it,
for the same reason and because they share the same surfaces.

### D47 feasibility — Session Score

Specification only. Nothing scored, persisted, computed or displayed.

**The finding that governs it.** A saved set is constructed as
`{ weight, reps, rir }` plus optional `type` and `completed`. The effective
prescription — `targetSets`, `targetReps`, the progression recommendation —
exists during the live session as DOM meta passed into `addLogExerciseRow`,
and is discarded at save.

So LOOP cannot presently score a past session against what it actually asked
for. Re-deriving the prescription from today's program is not a substitute:
the program may have been edited since, phase week mapping may have advanced,
and any trainer adjustment that applied at the time is gone. §51 requires
execution to be judged against the *effective* prescription rather than a
stale original, and a re-derived one is precisely the stale original.

**Therefore D47's first requirement is forward-only capture, not a formula.**
Record the effective prescription on the workout at save time, following the
`origin` precedent from D41: new sessions carry it, historical sessions are
never migrated or normalised at read time, and any score is available only for
sessions that carry it. Sessions without it are not scored, not estimated, and
not shown a placeholder — the same discipline D39 and D40 apply to
insufficient evidence.

A score computed before that capture exists would be a number about the
program's present state wearing the timestamp of a past session, which is the
class of defect D43 and D44 were spent removing.

### Verification

5,386 assertions (144 contracts), 327 program-audit checks, 87
data-integrity, 261 cardio, 43 GPS, and the date matrix across three zones —
all green. Six viewports clean on Today with the new block, zero horizontal
overflow at every width. `DATA_KEYS` remains 15 and `TRAINER_ENGINE_VERSION`
remains `0.1.1-shadow`; no threshold, calibration, readiness, recovery or
capability logic was touched, and no new persistence was added.

---

## §70 — D46B: Progress becomes a command centre

**Status.** Shipped in LOOP 4.0 (`loop-v117`).

### Why this phase existed

D46 shipped the Log completion fix and a first muscle block, and deferred the
Progress rebuild that was the owner's stated first priority. The Owner QA that
followed rated the release 8/10 and confirmed the deferral was right on quality
and wrong on scope: Progress was still marked friction, the muscle block "does
not sufficiently fit LOOP's style", and its tap opened the wrong surface. D46B
finishes that work.

### The headline came from the weakest calculator in the app

Progress opened with "Getting stronger", derived from `computeImprovements()`:
the athlete's FIRST logged top set against their LAST. One good day moves it
permanently and one bad day it cannot see.

D39 exists because that comparison is not evidence. It takes medians of two
equal, disjoint windows measured in performed sessions, requires four sessions
before it will name a direction and six before it will attach a number. It was
built in D39, used inside program outcomes in D40, and **never reached the
Progress landing screen** — the most-read surface in the app was making its
most prominent claim with the weakest arithmetic available to it, while the
strongest sat two tabs away.

The hero now reads `derivePerformanceProgress` over a twelve-week window — the
same window consistency and the Log strip use, so the three agree about what
"recently" means. `computeImprovements` is gone from the app.

There is still no aggregate score. Not a progress score, not a training quality
figure, not a fitness number. LOOP has no defensible way to add a squat and a
curl into one value, and a contract asserts the absence.

### Below the hero sat a reprint of the Strength tab

"Strength trends" rendered `computeExerciseTrends()` — the same list, from the
same function, that the Strength tab renders in full. A summary layer does not
reprint a specialist tab. It was retired, along with the three-tile strip whose
Strength tile counted `computeImprovements` and whose Muscle tile described a
mastery spread rather than training.

"Most trained" counts sessions per EXERCISE, which is per-exercise information,
so its home moved to Strength where per-exercise information lives. The
contract requiring it to have exactly one home still requires that; the home is
different.

Five blocks now, each answering one question, each one tap from the surface
that explains it:

| block | question | source | opens |
|---|---|---|---|
| Your training | am I getting better | D39 `derivePerformanceProgress` | Strength |
| Program | how is my program going | program map + D43 fulfilment | My Training |
| This week | what have I trained | `deriveWeekMuscleSets` | Volume |
| Consistency | what do my weeks look like | D44 `computeConsistencyData` | Log |
| Rank | where am I overall | `getCombinedProgression` | Rank showcase |

Measured at 390x844 against a mature 53-session history: **879px and six blocks
before, 780px and four blocks after** (the program block is absent without a
running program). Three answers are visible in the first viewport in both, but
they are now three DIFFERENT answers rather than a reading, a ranked text list
and the top of a second ranked text list. Rendering the dashboard took 4ms
before and 1ms after.

The order inverted deliberately. Level led the old Overview because the XP
system needed somewhere to show itself; it is identity, not progress, and it
answered none of the three questions. The reading leads now and level closes.

### A summary and the surface it opens must be the same arithmetic

Today's muscle block used `deriveWeekMuscleSets` — working sets only, mapped
through the canonical registry. The Muscle Volume tab it opened used
`computeMuscleVolumeSince` — every logged set including warm-ups, including
exercises the athlete skipped, mapped by raw substring. On a week with one
warm-up and one skipped squat the two read:

    Today          chest 2
    Muscle Volume  chest 3, quads 1, glutes 1

An athlete who taps a figure to check it must find that figure. There is now
one week-by-muscle calculation and both surfaces read it. A contract pulls
every number off both rendered surfaces and requires them to match exactly,
rather than requiring the code to merely look similar.

### One body, not two

The block drew its own front and back silhouettes. LOOP already had
`bodyDiagramSvg`, used by the plan preview, the workout template card and
Mastery's muscle volume card — so the block was a fourth body in an app that
had one, which is exactly why it read as a widget embedded in LOOP rather than
part of it.

`bodyDiagramSvg` gained an optional pre-computed totals argument so a caller
can supply counts it has derived accurately instead of having them re-inferred
from exercise names. All three original callers are unchanged in behaviour. The
block now composes that figure and the existing muscle bar list, on the same
geometry as the card it opens.

Glanceability was the other half of the complaint — the owner read the list
instead of the diagram. The figure now uses LOOP's own intensity ramp rather
than an accent opacity, and a callout names the leading muscle in 22px type
beside it. The answer is stated in words and in colour before the list is
reached; the list remains the accessible reading and the aria-label spells out
every figure.

Tapping it calls `openMuscleVolume()`, which selects the **Volume** tab and
scrolls its existing muscle section into view. No second muscle screen was
created, and a contract asserts there is still exactly one `renderProgMuscles`.

### Program functionality survives having no program

`programContextHtml` returned nothing at all unless the program library was
empty, so an athlete who had ever saved a program lost every trace of the
feature from Today. It was also called only on the training-day branch, so on
a rest day it was absent regardless. The feature disappeared for the two states
most likely to need it.

Both states now offer one quiet row — the builder when the library is empty,
the library when it is not — and the rest-day branch renders it too. My
Training states the way in above the week rather than as the fourth row of
"Adjust" below it, paired with a line keeping training without a program a
legitimate choice. When a program has just finished, D42's "What's next?"
already owns that surface and this stays out of its way. One builder,
`openProgramBuilderFlow`, in every case.

### Found and not fixed

`musclesForExercise` returns **no primary muscle** for the incline and decline
press family (`Incline Dumbbell Press`, `Incline Barbell Press`, `Flat DB
Press`, `Decline Dumbbell Press`), and for `Chin-Up`, `Face Pull`, `Cable
Crossover`, `Back Extension`, `Kettlebell Swing`, `Hanging Knee Raise` and
`Wall Sit`. It returns **biceps** for every leg curl variant, because
`MUSCLE_MAP.biceps` matches the bare substring `curl`.

This predates the phase, but making the data prominent makes it visible, and a
body diagram that lights the arms for a leg curl is wrong in a way a bar chart
hid.

It is deliberately NOT fixed here. `musclesForExercise` is consumed by
`computeMuscleRecovery`, so editing `MUSCLE_OVERRIDES` changes recovery state
for every athlete — which §35 of the brief forbids and which needs recovery
tests rather than visual ones. It is the first recommendation for the next
phase.

### Verification

5,415 assertions across 145 contracts, 327 program-audit checks, 87
data-integrity, 261 cardio, 43 GPS and the date matrix across three zones — all
green. Every contract that pinned the D14 Overview was repointed at the
mechanism that replaced it; none was deleted or weakened, and two were made
stronger: coverage must now sit INSIDE the reading rather than near it, and the
hero must show exactly the evidence D39 supports rather than a fixed three.

Six viewports clean across Progress Overview, sparse Progress, Muscle Volume,
Today's block, Today with no program and My Training with no program: zero
horizontal overflow, zero clipping, zero interactive targets under 44px, with
deliberately long exercise names. `DATA_KEYS` remains 15 and
`TRAINER_ENGINE_VERSION` remains `0.1.1-shadow`; no threshold, calibration,
readiness, recovery or capability logic was touched, and nothing about the
Overview is persisted.

---

## §71 — D47: Workout execution intelligence

**Status.** Shipped in LOOP 4.1 (`loop-v118`).

### The finding that had to come first

D46 established that a saved set was `{ weight, reps, rir }` plus optional
`type` and `completed`, and that the prescription — `targetSets`, `targetReps`,
the progression engine's chosen load — lived only as DOM state during the live
session and was discarded at save. LOOP could not compare execution against
what it had actually asked for, because it never wrote down what it asked.

So D47 begins with capture, not with a formula. `capturedPrescription(row)`
reads the logger row at save time and writes `ex.rx = { sets, reps, effort,
load }`. Only fields genuinely known are written; an exercise typed in by hand
carries no `rx` rather than an invented one.

**Forward-only, exactly as `origin` was in D41.** No migration, no read-time
normalisation, no retroactive scoring. Every workout logged before this carries
no prescription and is reported as unscoreable — which is the honest answer,
because the alternative is scoring a past session against a program that may
have been edited since. `DATA_KEYS` is unchanged at 15: `rx` is a field inside
existing workout entries, not a new store.

### Ownership, and the second engine that was not built

LOOP has two progression systems and they are not equals:

- `buildProgressionRecommendation` — **live**. It chooses the weight the
  logger puts in front of the athlete.
- `computeShadowRecommendation` — `0.1.1-shadow`. It observes and records.
  It does not drive the logger.

D47 reads and displays the **live** one. Scoring against the shadow trainer
would judge an athlete on advice they were never given, and a "Next Time"
panel showing the shadow's number would disagree with what the logger hands
over next session. The completion screen calls the same function the logger
will call, so the two cannot diverge.

`TRAINER_ENGINE_VERSION` remains `0.1.1-shadow`. Nothing in the trainer, its
thresholds, its calibration, readiness, recovery or capability was touched.

### The live engine could not say "less"

Probed against the phase's own cases, `buildProgressionRecommendation` handled
under-challenge, on-target, top-reps-at-wrong-RIR and mixed evidence correctly.
It had no answer at all for repeated over-challenge:

```
5 @ 0 / 4 @ 0 / 4 @ 0, twice, at the same weight
  →  "Beat last session — aim for 6 reps at 135 lb"
```

Every tier either added weight or held it, so an athlete already grinding at
zero reps in reserve was told to push harder. That is the only advice in this
engine that could make training worse rather than merely slower.

A reduction tier now exists, and it is deliberately expensive to trigger:
**two consecutive sessions, at the same weight, both below the bottom of the
range, both at 0.5 RIR or less.** Missing RIR fails the last condition and
holds — unknown effort is not evidence of struggle. The step down is
`progressionIncrement()`, the same equipment-aware amount the increase uses, so
the ladder an athlete climbs is the ladder they come back down; it is never a
percentage that lands on a weight no gym has.

`computeNextTimeNotes` did not list `reduce` among the tags it surfaced, so
the one recommendation that takes weight off the bar would have been computed
and then discarded. It is now shown, with the actual target beside it.

### Session Score

**"How well did I execute the training LOOP actually prescribed?"** Not
strength, not effort, not volume, not PRs.

D45B removed a score for three specific reasons, and this one is built against
each:

| the old /100 | why it failed | D47 |
|---|---|---|
| completion = sets filled ÷ sets present | 100% for every saved session | sets performed ÷ sets **prescribed** |
| rep targets vs last session's reps | adding weight scored as a miss | reps vs the **prescribed range** |
| progress = volume vs last session | a deliberate lighter week read as failure | **no volume term at all** |

Weights are `completion 0.40 / reps 0.30 / effort 0.18 / load 0.12`. Completion
leads because it is the only dimension the athlete fully controls and the only
unambiguous one. Load appropriateness is smallest because it is an inference
about the *prescription* rather than about the athlete. Equal weighting was
rejected: it would let a session with half the sets missing score 75 on the
strength of three tidy dimensions.

**Effort is judged symmetrically.** Two reps in reserve against a target of one
and zero in reserve against a target of one score identically. That single rule
is what stops the score rewarding ego lifting, and a contract asserts it.

**Missing RIR is missing evidence.** It is neither zero nor perfect: the
dimension is absent, the score is renormalised over what was measured, and
coverage is reported. `confidentCoverage` sits at 0.75, deliberately above
completion + reps (0.70), because a session with no effort recorded anywhere
was landing exactly on the threshold and describing itself as confident.

**A skipped exercise scores zero on every dimension, not null.** Absent
dimensions are averaged out of existence, so a skipped exercise could only ever
touch completion — meaning half a session abandoned still scored 80, and a
session where *nothing* was done scored 60. Skipping is not missing evidence;
it is a complete answer about work LOOP asked for. The ladder is now
100 / 75 / 50 / 25 / 0 across four exercises. Sets left undone inside an
exercise that *was* trained remain a completion matter only — those reps were
never attempted, and counting them against rep accuracy would penalise the same
shortfall twice.

Extra sets are capped at the prescription, so junk volume cannot inflate
anything. A PR appears in the analysis nowhere at all: one heavy single with
the rest of the work abandoned scores 34.

### Warm-ups

`~70% × 3` requires knowing today's working weight, multiplying, and rounding
to something loadable — three steps, mid-session, to answer a question LOOP
already knows. Steps now resolve against **today's effective load**, with the
percentage kept as the secondary reading:

```
Bench Press, working 185
  Empty bar × 10  ·  95 lb × 5 (50%)  ·  130 lb × 3 (70%)  ·  155 lb × 1 (85%)
```

Rounding is by implement — 2.5 for light isolation, 5 for barbells, dumbbells
and stacks, 5 for anything unrecognised. This is a separate question from
`progressionIncrement()`, which asks what is worth *adding between sessions*
and correctly returns 10 for a heavy barbell; a warm-up single at 152.5 is fine
arithmetic and an impossible bar. Bodyweight exercises resolve to no load and
keep their existing guidance. With no working load known the percentage is left
exactly as authored — a percentage of nothing is not a number.

### Redundant preparation, reduced by movement and never by muscle

The forbidden rule is "same muscles trained, remove the warm-up". A squat and a
Romanian deadlift share the entire posterior chain and prepare each other
barely at all, because the joint they load and the range they load it through
are different. What transfers is the **movement**, so that is what is compared.

`generalPrepSatisfiedBy` grants a reduction only when the same movement pattern
has already been worked **in this session**, at a load **at least as heavy**,
with sets actually ticked complete. Anything unknown returns null, and null
always means warm up properly. Verified live:

- Back Squat @225 → Bulgarian Split Squat: *"Warm-up · already prepared —
  55 lb × 2. Shortened: you already worked up to 225 lb on Back Squat."*
- Back Squat @225 → Romanian Deadlift: **full ramp preserved**
- Back Squat @45 → Bulgarian Split Squat: **full ramp preserved**
- Before the squat is completed: **full ramp preserved**

Even when granted, the ramp is shortened rather than removed — one acclimation
set at the top is kept, because the movement-specific half is the part that
does not transfer. Nothing is persisted; there is no `warmedMuscles` store.

### Unilateral warm-ups

Six of the twenty-seven prep movements are timed *and* two-sided, and two of
them (`leg_swing_front`, `leg_swing_side`) are in every legs sequence. A leg
swing counted 30 seconds against an instruction reading "swing one leg forward
and back, then switch" — leaving the athlete to decide when half of it had
gone, which is the one thing a countdown exists to remove.

The authored duration is the whole movement, so it is **split, not doubled**: a
leg day does not get longer because the instruction got clearer. 30 seconds
becomes "15 sec each side", with `Switch sides` cued in words, an accent state,
a haptic pulse, and `aria-live="assertive"` so it is heard as well as seen.

**One timer.** This adds a side to the existing run phase rather than a second
interval, and every deadline stays wall-clock (`endsAt`), so locking the phone
and returning shows the correct side and the correct remaining time. Counted
two-sided movements are untouched — "10 reps" beside "both sides" was never
ambiguous.

### Not attempted

Readiness does not adjust the prescribed load anywhere in the live path today —
there is no `applyReadinessToTemplate` or equivalent, and the trainer is
shadow-only. The brief's example of a trainer reducing 145 to 135 therefore
describes a capability LOOP does not yet have. The effective prescription
captured here is the template's targets plus the live progression engine's
chosen load, which is genuinely what the athlete was asked for. If readiness
ever adjusts prescriptions, it will flow into `rx` with no change to the
scoring model.

### Verification

5,480 assertions across 146 contracts, 327 program-audit checks, 87
data-integrity, 261 cardio, 43 GPS and the date matrix — all green. Contract
146 states each fixture's prescription and its expected ordering independently
of the implementation. Six viewports clean on the score, its expanded
breakdown, the prep runner mid-switch and the warm-up box, with long exercise
names: zero overflow, zero clipping, zero targets under 44px, zero inputs under
16px. Browser storage was byte-identical before and after the whole QA pass.

`DATA_KEYS` remains 15, `TRAINER_ENGINE_VERSION` remains `0.1.1-shadow`, and
nothing about the score, its breakdown, warm state or next-load explanation is
persisted.

---

## §72 — D48: One answer to "what muscle does this train?"

**Status.** Shipped in LOOP 4.2 (`loop-v119`).

### The registry already existed. Nothing asked it.

`CANONICAL_EXERCISES` has carried `primary`, `secondary`, `pattern` and
`equipment` for 62 movements since the trainer was built, resolved by **exact
normalized alias** — the strongest identity LOOP has. It is correct. It says
Leg Curl is hamstrings, Incline Dumbbell Press is chest, Face Pull is
shoulders, Hanging Leg Raise is abs.

`musclesForExercise()` never consulted it. It matched raw display-name
substrings against `MUSCLE_MAP`, which produced three distinct classes of wrong
answer:

**LOST.** `MUSCLE_MAP.chest` holds the phrase `"incline press"`. The string
"Incline Dumbbell Press" does not contain it, so the exercise matched nothing
and contributed to no muscle anywhere in the app. Face Pull, Chin-Up, Push-Up,
Pull-Up, Military Press, Skull Crusher, Cable Crossover and thirty others were
likewise invisible — and the registry knew every one of them.

**WRONG.** `MUSCLE_MAP.biceps` is the single token `"curl"`. Every leg curl
trained the biceps. "Hamstring Curl" resolved to biceps and **not** hamstrings.

**INFLATED.** `MUSCLE_MAP.glutes` contains the bare tokens `"squat"`,
`"lunge"` and `"deadlift"`. Every squat was primary quads **and** primary
glutes; every deadlift was primary back, hamstrings **and** glutes. Assisting
muscles were being promoted to principal ones, and every compound lift counted
two or three times in muscle volume.

Measured across the 431 exercise names the product can reach: **77 disagreed
with the registry and 68 had no primary muscle at all**, 35 of which the
registry answered correctly and was never asked.

### One resolver, explicit precedence

```
1. CANONICAL ID    exact alias → the registry. Authoritative.
2. EXACT OVERRIDE  MUSCLE_OVERRIDES, for names the registry lacks.
3. FAMILY RULE     ordered phrase table, for variants the registry
                   does not name individually.
4. KEYWORD         the old MUSCLE_MAP scan, kept but demoted.
5. UNKNOWN         empty. Never guessed.
```

Tier 3 exists because "Sumo Deadlift" is not the same exercise as "Deadlift"
and must not become an alias of it — but it is the same family and its anatomy
is not in doubt. The table is **ordered**, and the generic `curl` token is
declared last, below `leg curl`, so a broad token can never pre-empt a specific
phrase. This is the same precedence `movementPatternFor()` has always used,
which is exactly why patterns never developed the leg-curl bug that anatomy
did.

Where gym and author word order genuinely varies — "Incline Machine Press",
"Machine Incline Press", "Decline Dumbbell Press" — rules match on **all tokens
present** rather than adjacency. Both tokens are required, which is what keeps
"Incline Curl" and "Decline Sit-Up" away from a pressing rule.

**Primary means primary.** Secondary involvement is real and still reported; it
stays in `secondary`. A squat is quads, with glutes and hamstrings assisting.

### Six consumers, one anatomy

The defect had to be fixed in six places or not at all, because six surfaces
each ran their own `MUSCLE_MAP` substring scan: the body diagram
(`computeMuscleTotals`), the all-time breakdown, muscle volume, days-since-last-
trained, the program builder's two allocators, and the trainer's recovery
signal. Every one now reads `musclesForExercise()`. The only keyword scan left
in the file is the one inside it.

The trainer's site is worth naming: it already *preferred* canonical metadata
and fell back to the raw scan — and that fallback is precisely what fired for
any exercise the registry does not name. Both branches now collapse into one
call whose first tier is the same canonical lookup.

### Recovery

`computeMuscleRecovery` was already correct. It consumes `musclesForExercise`
and applies `RECOVERY_CONFIG.primaryWeight` / `secondaryWeight` — an intentional
weighted model, so a bench set is not counted as a full chest set *plus* a full
triceps set. It simply had bad input. No recovery mathematics were changed.

Fixture — Incline Dumbbell Press ×3, Seated Leg Curl ×3, Barbell Curl ×2:

| surface | before | after |
|---|---|---|
| Today weekly block | Biceps 5 | Chest 3, Hamstrings 3, Biceps 2 |
| Muscle Volume | Biceps 5 | Chest 3, Hamstrings 3, Biceps 2 |
| Recovery | biceps only | chest 0.9, hamstrings 0.9, biceps 0.6, plus shoulders 0.4 and triceps 0.4 as weighted secondary |

**Derived historical recovery changes, and that is the point.** Recovery is
derived on every read, so a leg curl logged last month now loads the hamstrings
instead of the biceps. No workout was rewritten, no migration ran, and nothing
is normalised at read time — the stored history is untouched and the derivation
over it is simply no longer wrong.

**Trainer inputs change as a consequence**, and that is a bug fix rather than
calibration. `TRAINER_ENGINE_VERSION` remains `0.1.1-shadow`; no threshold,
state, readiness, capability or PROGRESS/CONSOLIDATE/MAINTAIN/BACK_OFF logic was
touched.

### The audit's oracle was not independent

Correcting the product broke two program-audit checks. The cause was
instructive: `auditTally` mirrored the product's own fallback — canonical first,
then the same `MUSCLE_MAP` substring scan — so it still credited glutes for
every squat while the product no longer did. An oracle that copies the thing it
validates is not an oracle.

It is now a hand-declared primary-muscle table written in the audit file from
domain knowledge, ordered, supporting multi-primary entries. Under it, both
checks pass and 11,601 program focus claims hold.

One product behaviour genuinely shifted: a day's claimed A/B focus is computed
from muscle share against its same-category siblings, and correcting the
anatomy changed those shares. The claim rule itself (a 0.10 share lead) is
unchanged and every claim the builder now makes survives the independent
oracle.

### Coverage

431 reachable exercise names · 309 resolve to a canonical id · **0 disagree
with the registry** · **0 invalid muscle names** · 14 without a primary, of
which 4 are plan titles that are not exercises at all.

The remaining ten are intentional: Sled Push, Sled Pull, Farmer's Carry,
Turkish Get-Up, Power Clean, Battle Rope Slams, Battle Rope Waves, Broad Jump,
Lateral Bound, Med Ball Slam. These are carries, jumps and conditioning where
naming a single principal muscle would be a guess, and §19's rule is that
unknown stays unknown. They contribute to no muscle surface and are not
counted as trained.

### Strength-profile readiness

Every major group now has strength-relevant lift coverage through the canonical
registry: chest, back, shoulders, biceps, triceps, quads, hamstrings, glutes,
calves and abs all resolve from multiple mapped movements with `supports1RM`
flags already present. The blocker for a future body-area system is no longer
anatomy. It is that bodyweight and height cannot rank a muscle group, and no
muscle rank is implemented here.

### Verification

5,521 assertions across 147 contracts, 327 program-audit checks, 87
data-integrity, 261 cardio, 43 GPS and the date matrix across three zones — all
green. Contract 147's oracle is hand-declared and never calls
`musclesForExercise` to decide what the answer should be.

Two contracts were repointed rather than weakened. One asserted Back Squat as
primary `quads,glutes` and Deadlift as `back,hamstrings,glutes` — snapshots of
the over-attribution — and now asserts that the glutes did not disappear but
moved to the tier that describes them honestly. The other used a Romanian
deadlift as its example of a multi-primary lift; an RDL is a hamstring
movement, so it now uses a conventional deadlift, which genuinely is.

A pre-existing date-fragile fixture was also repaired: the Log calendar's
"empty day" block selected a hard-coded offset that stopped being empty on the
third of a month, when two clamped fixture offsets collide. It now derives an
unused day.

Six viewports clean on Today's muscle block, Muscle Volume, Mastery and
Progress Overview. `DATA_KEYS` remains 15, no storage key was added, no backup
format changed, and browser storage was byte-identical across the whole QA pass.

---

## §73 — D49: Specificity must be earned

**Status.** Shipped in LOOP 4.3 (`loop-v120`).

### The rule

> The more specific a recommendation is, the stronger the evidence behind it
> must be.

| output | evidence required |
|---|---|
| `6–8 reps` | the prescription. Always sayable. |
| `aim for 7` | the prescription was actually performed. |
| `go to 145` | that, plus recorded effort showing the load was owned, and a load that has not just moved. |
| `drop to 125` | two consecutive qualifying sessions (D47, unchanged). |

**Insufficient evidence is a valid recommendation state.** The completion
screen has a slot for guidance; that is not a reason to invent some.

### Four defects, one boundary

The phase was scoped around a single known limitation. Probing the live engine
found four, three of them worse than the one named.

**1 — A specific rep target from a sparse session.** Tier 4 computed
`Math.min(range.max, last.topReps + 1)` — last-seen reps plus one, from
whatever happened to be in the log. One set of six reps with no effort recorded
produced *"aim for 7 reps at 135 lb"*. That is arithmetic, not a
recommendation.

**2 — Missing RIR read as spare RIR.** The headroom test was
`last.avgRir === null || last.avgRir >= 1.5`. Three sets at the top of the
range with **no effort recorded anywhere** earned a load increase, justified on
screen as *"You hit 8 reps last session — ready for a small increase."* LOOP
had no way of knowing there was anything in reserve. Missing effort is neither
spare capacity nor failure; it is missing.

**3 — Warm-ups counted as performance.** `exerciseSessionHistory` read every
set on the exercise. A warm-up of 95 × 10 at 5 RIR beside three working sets of
135 × 6 at 1 RIR reported `topReps 10, avgRir 2` — the top of the range with
reps to spare — and the engine added weight to a session the athlete had ground
out at the **bottom** of the range. This is the one with a safety edge.

**4 — One good set impersonating a prescription.** A single set of 8 at RIR 2,
out of three prescribed, earned an increase. Nothing measured how much of the
prescription had been done.

And a fifth, found in the UI while verifying:

**5 — Next Time judged a finished session against today's templates.**
`computeNextTimeNotes` resolved the rep range with `repRangeForExercise`, which
reads the athlete's current templates. A session prescribed 6–8 was being
judged against an 8–12 template range, and editing a program later silently
rewrote the advice given about a workout already finished. It now reads
`ex.rx.reps` — D47's forward-only record of what LOOP actually asked that day —
and falls back to the template lookup only for legacy sessions that carry no
prescription.

### The evidence model

`exerciseSessionHistory` now reports evidence alongside measurement:
`workingSets`, `rirSets`, `prescribedSets`, `targetRir`, `prescribedLoad` —
with `topReps` and `avgRir` computed over **working sets only**, using the same
predicate the rest of the app uses (a set whose type was never recorded still
counts, because unknown is not a warm-up).

`progressionEvidence(session, prev)` derives four facts and nothing else:

- **complete** — `workingSets >= prescribedSets` where the prescription was
  recorded, otherwise at least two working sets. A single set is never a
  prescription, whatever it contains. Extra sets do not make it more complete
  than complete.
- **rirKnown** — at least one working set carried an effort reading.
- **headroom** — only when `rirKnown`, and measured against the effort that was
  *asked for*: `avgRir >= targetRir + 1`, falling back to the long-standing
  absolute 1.5 when no target was recorded.
- **loadJustChanged** — the previous session was heavier.

That last fact is how a deload stays a deload **without a separate deload
rule**, which §26 forbids. A deload is a load the program deliberately lowered;
one easy session at a weight chosen to be easy is not evidence for going
heavier. The same fact stops a reduction bouncing straight back up: the first
exposure at a changed load holds, and the second can progress, so the athlete
is never stuck.

Nothing is persisted. There is no confidence score, no percentage, and
`DATA_KEYS` remains 15.

### Declared cases

Contract 148 states each case's prescription, its performance and the answer a
coach would give — declared, never read off the engine.

| case | before | after |
|---|---|---|
| 1 of 3 sets, 6 reps, no RIR | build · *aim for 7* | **insufficient** · hold 135, work inside 6–8 |
| 1 of 3 sets, 8 reps @ RIR 2 | increase → 140 | **insufficient** · hold 135 |
| 3 of 3 at top of range, no RIR | increase → 140 | **hold** 135 |
| 3 of 3, 8@3 8@2 8@2 | increase → 140 | **increase → 140** (unchanged) |
| 3 of 3, 7@2 7@2 6@2 | build · aim for 8 | **build** (unchanged) |
| one grinding session | build | **build** (unchanged — one session is not evidence) |
| two grinding sessions | reduce → 130 | **reduce → 130** (unchanged) |
| deload followed exactly | increase → 110 | **hold** 105 |
| warm-up + 3 working sets of 6 | increase → 140 | **build** · aim for 7 |
| partial RIR, prescription complete | increase | **increase** (partial coverage is still evidence) |
| legacy session, no `rx` | build | **build** (safe legacy behaviour) |

The engine did not become timid: every case that earned a change before still
earns it.

### What did not change

Session Score is untouched — weights `40 / 30 / 18 / 12`, missing-RIR
renormalisation, prescription snapshot, all as D47 shipped them. A contract
asserts the progression engine never reads the score, because **a high score
must not mean add weight**: a session can execute its prescription perfectly
and still be told to hold, and those are different questions.

`TRAINER_ENGINE_VERSION` remains `0.1.1-shadow`. No trainer threshold, state,
readiness, recovery, capability or promotion logic was touched, and the shadow
trainer is not consulted for live progression. D48's registry and recovery
anatomy are untouched. `progressionIncrement` and equipment rounding are
unchanged, so the ladder an athlete climbs is still the ladder they come down.

### Verification

5,556 assertions across 148 contracts, 327 program-audit checks, 87
data-integrity, 261 cardio, 43 GPS and the date matrix across three zones — all
green. Determinism confirmed over 100 evaluations, and reversing irrelevant
earlier history changes nothing. Six viewports clean across the increase, hold,
reduce and insufficient states with a deliberately long exercise name; browser
storage was byte-identical across the whole QA pass.

One older assertion was repointed: Contract 146's check that a load reduction
reaches the athlete was bounded by a character count, which broke the moment
the function it measured grew. It is now bounded by the next function — a
property of the code rather than of the ruler. This is the second such fix; the
pattern is worth watching for.

### Remaining limitation, carried forward

One grinding session below the rep range still returns *"aim for 6 reps"* — a
build instruction to an athlete who is struggling. D47 decided deliberately
that one session is not enough evidence to change the load, and D49 preserves
that. The copy is the weak part rather than the decision, and changing it would
re-litigate D47 without new evidence.

---

## §74 — D50B: A coach between sets

**Status.** Shipped in LOOP 4.4 (`loop-v121`).

### Three horizons, one reading of a set

| owner | question | window |
|---|---|---|
| `deriveNextSetCoach` | what should the **next set** be | today, this exercise |
| `buildProgressionRecommendation` | what should I **start with next time** | across sessions |
| `computeShadowRecommendation` | longitudinal observation | `0.1.1-shadow`, still not driving anything |

They are separate **policies**, not separate brains. All three read the same
primitives: `parseRepRange` for the target, `effortToRir` for what the
prescription asked of the athlete, `isWorkingSet` for what counts as work, and
`progressionIncrement` for what a gym can actually load. LOOP has one
interpretation of RIR and one increment policy; D50B added neither.

`deriveNextSetCoach` is **pure**. It takes a prescription and the sets already
performed and returns the same answer forever. It reads no store, no history,
no readiness and no Session Score — a score judges execution, and must never
become the thing that decides what goes on the bar. A contract asserts each of
those absences.

### Day one

Before any set is completed the coach states the prescription and nothing more:
*"Today's target is 8–10 reps at about 1 rep in reserve."* That is the honest
answer with no evidence — it does not pretend to know a weight. After the first
working set it is coaching from real evidence, with no history required at all.
History is not consulted by this layer; the starting load still comes from
`buildProgressionRecommendation` as it always did.

### The policy

```
easyOverTarget      2    RIR above the prescribed target before a single set
                         counts as evidence the load is light
hardMissWithoutRir  2    reps below the range that count as objective failure
                         when no effort was recorded
hardRir             0.5  grinding, when effort IS recorded
maxChangesPerExercise 1  at most one load change per exercise per session
maxIncrementsFromRx   1  never more than one increment from the prescription
```

`easyOverTarget` is deliberately larger than the session-level bar in
`PROGRESSION_EVIDENCE`: one set is thinner evidence than a completed
prescription, and the cost of being wrong is paid immediately rather than next
week.

The last two knobs are the stability guarantee. Together they make the
+15 / −20 / +15 experience **structurally impossible**, and they stop the coach
quietly rewriting the session it was handed: the largest deviation from the
program in a session is a single increment, once.

### Verified behaviour

The brief's own example, with 120 lb coming from `progressionIncrement` rather
than from anywhere in the copy:

```
before any set     prescribed  115 lb   Today's target is 8–10 reps at about 1 rep in reserve.
115 × 10 @ RIR 5   increase    120 lb   That set was 5 reps in reserve against a target of
                                        1 rep. Add 5 lb and stay in 8–10.
120 × 8  @ RIR 2   hold        120 lb   Load already adjusted this exercise. Hold 120 lb.
```

| case | result |
|---|---|
| on target, 9 @ 2 | hold |
| below range at 0 RIR | reduce one increment |
| 10 @ 2 then 9 @ 2 — ordinary fatigue | **hold**, no reduction |
| top reps, effort not logged | hold, and never says "in reserve" |
| missed the range badly, no RIR | reduce, worded as **reps** not effort |
| deload, 10 @ 5, planned lighter week | **hold** — "keep the prescribed load even if it feels easy" |
| the identical set outside a deload | increase |
| strength, 3–5 @ 0.5 RIR | respects the range and steps by the barbell increment |
| already one increment above the prescription | hold |
| no prescription at all | insufficient — "nothing to coach against" |

Missing RIR is never spare RIR and never failure. Reps alone remain objective —
five reps against a prescription of 8–10 is a missed prescription whatever it
felt like — and that case is worded as reps so it cannot be mistaken for an
effort claim.

Deload is read from `getCurrentTrainingPhase`, which is program truth. There is
no second phase policy.

### The header

The old surface was headed **Recommended** and read as *"beat what you did last
time"* — a comparison rather than a plan. Worse, it lived inside
`.ex-context-detail`, the collapsed disclosure, so the athlete had to tap to
discover what LOOP wanted. That is why it read as an afterthought.

**LOOP Coach** sits in the exercise header now: the load large, the rep range
and effort target under it, one sentence of reasoning, and the working-out one
tap away — target, last set, decision. The disclosure keeps what it is
genuinely for, which is last time.

No per-set score. `SESSION SCORE` already exists and answers a different
question; gamifying every set was explicitly refused.

### The athlete stays in control

An input the athlete typed into or stepped is **theirs**, marked from `oninput`
— which only user interaction fires, so a programmatic assignment cannot
counterfeit it. The coach writes only to suggestions nobody has touched, and
never to a completed set.

This exposed an existing defect: `propagateSetValueForward` overwrote *every*
later uncompleted set. Choosing 125 for the last set and then adjusting the
first silently discarded that choice. Propagation now respects the same
ownership.

Verified live: with 125 entered by hand into set 2, a coach recommendation of
120 lb left set 2 at **125** and moved only the untouched set 3.

### Live behaviour

`refreshSetCoach` runs inside `toggleSetComplete` **after** `startRestPanel`, so
a recommendation can never delay the thing the athlete is waiting on. Measured
at **0.26 ms per call** — it reads the rows already on screen and nothing else,
so there is no history scan per set. Re-opening a set removes evidence and the
coach reconsiders.

A value that moves gets one short background mark; nothing resizes, so the page
cannot jump while the athlete is resting. Reduced motion removes it. A single
polite live region announces the change once, only when a value actually moved.

### Verification

5,590 assertions across 149 contracts, 327 program-audit checks, 87
data-integrity, 261 cardio, 43 GPS and the date matrix — all green. Contract
149 declares eleven cases and asserts the stability, ownership, purity and
separation properties. Six viewports clean across the prescribed, increase,
reduce and missing-RIR states with the detail expanded and the rest timer
running, using a deliberately long exercise name.

`DATA_KEYS` remains 15. Nothing about a recommendation is persisted, and the
calculation was proved read-only across 25 repeated calls.
`TRAINER_ENGINE_VERSION` remains `0.1.1-shadow` with no calibration, threshold,
state or promotion change; Session Score keeps `40 / 30 / 18 / 12`; D49's
next-exposure evidence rules are untouched.

### A testing weakness worth naming

Three contracts failed during this phase because they read **source text
including comments**, and a comment that merely *named* a symbol or an element
counted as the thing itself. One was tripped by the Live Set Coach's banner
explaining that it does **not** consult the shadow trainer; another by a comment
naming `ex-context-detail` while explaining the markup around it.

Each is now comment-stripped, and each is stronger for it. But this is the
third phase in a row where an assertion has been fooled by prose. Assertions
that slice source should strip comments as a rule rather than one at a time —
worth a dedicated pass.

### Found and not fixed

`.set-complete-btn` declares 44×44 and renders at 40×40 once completed, because
the pressed state applies `scale(0.9)`. It is pre-existing, untouched by this
phase, and affects only a button the athlete has already hit — but it is below
the target size while still being interactive, since tapping it again re-opens
the set.

---

## §75 — D51: Program schedule revisions

**Status.** Shipped in LOOP 4.5 (`loop-v122`). This is the mandatory
foundation of Program Studio, not the whole of it — see *Scope* below.

### The audit came first, and it changed the plan

D51's brief asked for a large Program Studio. §46 required a specific question
be answered before any of it: does making schedule editing first-class require
a historical revision model? That question was answered empirically rather than
assumed, and the answer was yes.

A program carried **one schedule** — a single weekday map — and every consumer
of "what was planned" read it for every week of the program's life. D43
fulfilment, D44 consistency, missed days and the week map all resolved week 1
and week 8 against the same mutable object.

Measured on a three-week-old program whose athlete had trained exactly as
planned:

| schedule | planned | fulfilled | adherence |
|---|---|---|---|
| Mon/Thu, as trained | 16 | 6 | 38% |
| edited to Mon/Wed/Fri | **24** | 6 | **25%** |

Their adherence fell for weeks that were already over, because they added a
training day *going forward*.

Worth recording what did **not** reproduce it: moving Mon/Thu to Tue/Fri, or
even to Wed/Sat, left the past untouched — D43's ±2 day shift tolerance absorbs
a moved day. It is the **count** of planned days that rewrites history, not
their identity. That is why the defect had survived: the obvious test passes.

### The model

```
revisions: [
  { effectiveFrom: '2026-03-02', schedule: {…}, baseline: true },
  { effectiveFrom: '2026-03-30', schedule: {…} }
]
```

`programScheduleOn(program, date)` returns the revision in force on that date.
`programPlannedSlots` now resolves each week against the plan that was in force
when that week happened, instead of reading one schedule for all of them.

`addProgramRevision` defaults to the **Monday after today**, so an edit made
mid-week never restates a week the athlete has already partly trained.

**The first edit writes down what came before it.** Without that baseline the
weeks before a new revision fall through to `program.schedule` — which the edit
is about to overwrite — and the rewrite happens anyway. This was caught in
testing: the first implementation still moved planned from 16 to 24. The
baseline is dated from the program's own start and records what LOOP actually
knows; it does not claim the schedule was never edited before revisions
existed.

### The live path, which is where it mattered

`updateProgram` is what the builder calls when editing an active program, and
it assigned the new schedule straight onto the program. That was the actual
route to the defect, and it now routes through `addProgramRevision`.

A program that has **not started yet** has no past to protect and is simply
assigned, so draft and future-dated editing accumulate no revision noise.

Verified end to end through `updateProgram`: planned grew 16 → 20 rather than
16 → 24, completed weeks kept their fulfilment, and the athlete sees the new
schedule from now on.

### Compatibility

`schedule` remains the current plan, so every existing reader keeps working
untouched. A program with no `revisions` behaves exactly as it always did.
There is **no migration**, **no new `DATA_KEY`**, and nothing is rewritten —
revisions round-trip through backup as ordinary program fields.

### Scope, stated plainly

D51's brief describes a full Program Studio: three entry paths, an editable
draft, session and exercise editing, prescription authoring, session
templates, outside-activity blocks, mixed generated/custom programs, and a
flagship visual treatment. That is several phases of work.

**Shipped here:** the schedule revision model and the safety of the live edit
path — the part that is mandatory before any of the rest, and the part that is
impossible to retrofit once athletes start editing schedules against real
history.

**Not shipped, and why:** everything above the data model. The audit also
corrected two assumptions in the brief's framing that change what remains:

- The builder **already asks which days you can train** (`PB_STEPS` includes a
  `days` step), and `generateProgram` honours them exactly — verified for
  Sat/Sun and Mon/Thu/Sat. §7 and §65 are largely already satisfied.
- A **review step already exists** (`pbReviewHtml`) with a week map and
  rationale.

The real rigidity is narrower than "LOOP picks everything": `pbReviewHtml`
calls `pbGenerate()` on every render, so the review is a *regenerated* program
rather than an editable one. Any direct edit would be discarded on the next
repaint. Making the draft hold its own edits is the next unlock, and it is now
safe to build because the history underneath it can no longer be rewritten.

### Verification

5,617 assertions across 150 contracts, 327 program-audit checks, 87
data-integrity, 261 cardio, 43 GPS and the date matrix — all green.

Contract 150 uses **deliberate fixed dates** (a program starting Monday 2 March
2026) with expected counts worked out by hand, because several suites in this
file have been broken by fixtures built from "today minus N days". One
assertion was rewritten during the phase for exactly that reason: it asserted a
planned count for a fixture whose remaining weeks depend on when the suite runs,
and it now asserts the calendar-independent guarantee instead — the edit takes
effect in the future, and weeks before it keep the plan they were trained
under. Its source-slicing assertion strips comments, per the rule D50B's report
asked for.

`DATA_KEYS` remains 15 and `TRAINER_ENGINE_VERSION` remains `0.1.1-shadow`,
with no calibration, threshold, state or promotion change. D39–D50B are
untouched.

---

## §76 — D51B: The draft the athlete approved

**Status.** Shipped in LOOP 4.6 (`loop-v123`).

### The root defect

`pbGenerate()` built a fresh program from the answers every time it was called,
and it was called from two places: the review renderer and the commit.

So the review was never a draft. It was a generation, displayed once. An edit
was destroyed by the next repaint — and an edit that somehow survived was
thrown away at activation regardless, because commit generated again before
creating the program. **The athlete approved one program and started a
different one.**

That is why the program felt like something to accept: there was nothing to
shape. The only lever was to change an answer and hope the generator landed
closer.

### Generation is an event

`pbGenerate()` no longer generates. It returns the draft, which
`pbRegenerateDraft()` builds **once**. Generation now happens on exactly three
occasions: finishing the questions, changing a constraint, and asking for a
fresh plan. Drawing the screen is not one of them.

When a regeneration would discard work, the athlete is asked first — and
declining a constraint change restores the previous answer rather than half-
applying it.

### The bridge that made editing real

`composeProgramSession(entry, base)` returned the template untouched. A program
entry was a *reference* — plan, category, templateId — so an edited or
hand-built session would have been silently replaced by the generated one at
the moment it was trained.

**A session that carries its own `exercises` now IS the session.** That single
change flows through the one path every consumer already uses: the workout
screen, `ex.rx`, Live Set Coach, Session Score, progression and adherence. An
athlete-authored session is an ordinary program session everywhere, with no
second-class branch anywhere in the app.

The first edit to a generated session deep-copies its template's exercises onto
the entry, so editing your program never reaches the template — or any other
program built on it. Verified: the shared template is byte-identical after an
exercise is removed from a program that used it.

### Editing

Sessions rename, move to another day, and can be added or removed. Exercises
add, remove and reorder. Sets, reps and target effort edit in place.

**Reorder is buttons, not a drag handle** — a drag handle is the one control
that cannot be used one-handed or by a screen reader, and each button names the
exercise it moves.

Prescription editing refuses nonsense instead of storing it: `8-6` and `0-10`
are rejected and the previous value kept; set counts clamp to at least one.
An added exercise arrives with a real prescription looked up from
`PROGRAM_EXTENSIONS`, the canonical pool the generator already uses — so there
is no second prescription engine. **No starting load is fabricated**; LOOP
does not invent a weight it has no evidence for, and the coach becomes useful
after the first working set instead.

### Activation

`pbCommit` reads the draft and validates it before creating anything. Only
genuinely broken states block — no sessions, a session with no exercises, an
invalid set count or rep range. An unusual split is a choice, not an error.

### The guarantee that mattered

An athlete authoring `Lat Pulldown · 3 × 8–10 · effort 8` produces, with no
separate path anywhere:

```
before any set      prescribed  115 lb   Today's target is 8–10 reps at about 1 rep in reserve.
115 × 10 @ RIR 5    increase    120 lb   That set was 5 reps in reserve against a target of
                                         1 rep. Add 5 lb and stay in 8–10.
120 × 8  @ RIR 2    hold        120 lb
```

Session Score reads it (100 on a clean execution). D49 progression reads it.
`effort 8` resolves to a 1-rep-in-reserve target through `effortToRir`, the
same helper generated prescriptions use. This is the exact §50 fixture, and it
closes the gap D50B named.

### Scope

Shipped: the draft model, generation/render separation, session and exercise
editing, prescription authoring, custom sessions, the composition bridge, and
activation from the edited draft.

Not shipped: templates, the three-way entry screen, outside-activity blocks,
and **draft persistence across a reload** — the draft lives in `pbState` for
the builder session. Persisting it needs a storage decision the brief asked to
be justified rather than assumed, and it is the first thing D51C should settle.

**Active-program exercise and prescription editing remains deferred**, and
deliberately so. D51 revisioned the schedule; exercise and prescription changes
on a running program still mutate one object, and `ex.rx` protects only
workouts already performed — future planned prescriptions have no revision
history. Exposing that editing without the revision model would reintroduce
exactly the rewrite D51 removed. Draft editing is fully safe because a draft
has no history to damage.

### Verification

5,656 assertions across 151 contracts, 327 program-audit checks, 87
data-integrity, 261 cardio, 43 GPS and the date matrix — all green. Six
viewports clean on the studio with a session open: zero overflow, zero
clipping, every control at least 44px, every input 16px. Browser storage was
byte-identical across the pass, and an edit survived every repaint at every
width.

`DATA_KEYS` remains 15, `TRAINER_ENGINE_VERSION` remains `0.1.1-shadow`, and
D39–D51 are untouched.

### The ruler problem, a fourth time

Two contracts failed because they matched `function pbCommit` followed by a
character-count window, and adding a validation step pushed their landmarks out
of range. A character count measures the ruler, not the code. Both are now
bounded by the function and stripped of comments.

This file has now rediscovered the same two conventions — bound by structure,
strip comments — in four consecutive phases. Contract 151 follows both by
construction. A pass that applies them to every existing source-slicing
assertion is overdue and would be cheap.

---

## §77 — D51C: A program you can live with

**Status.** Shipped in LOOP 4.7 (`loop-v124`).

D51B made a generated program editable. D51C makes it *durable*: the work
survives interruption, changes to a running program apply forward, and choosing
an exercise stopped being a `prompt()`.

### One timeline, not four

The brief asked for a single canonical owner of temporal plan truth, and warned
against `scheduleRevisions` + `prescriptionRevisions` + `exerciseRevisions` that
would later have to be reconciled. That turned out to need **no new shape at
all**.

D51 stored the *schedule* of each revision. After D51B, a schedule entry carries
its own name, exercises and prescriptions — so the record D51 was already
writing IS the whole plan: days, sessions, exercises and prescriptions together.
Broadening it into a **program plan** cost one rename and a materialisation
step. There is exactly one revision list, and `programPlanOn(program, date)` is
the one function that reads it.

```
Program
  schedule      the current plan, unchanged, for every existing reader
  revisions[]   { effectiveFrom, schedule }  — the plan in force from a date
```

`programScheduleOn` survives as a narrow wrapper over `programPlanOn`, because
"schedule" is what most callers are actually asking about.

### Materialisation: a snapshot must stand alone

A generated entry is a *reference* — planId + category + templateId, with the
exercises living in a shared template. A reference cannot record what was
planned *then*: edit the template later and every historical week silently moves
with it.

So a plan recorded as history takes a private copy of the exercises it resolves
to, **keeping the reference alongside** — planId, category and templateId still
identify the session, so provenance, adherence and template matching are
untouched. It captures only what is knowable today. It reconstructs nothing.

### Per slot date, not per week

`programPlannedSlots` resolved a whole week from its Monday. That was right
while revisions could only start on one, but it meant a mid-week change would
have restated the days before it. Each slot now asks what was planned for **its
own day**, which makes the guarantee structural: a revision effective from a
date cannot alter any date before it, at any granularity.

Three more readers were asking today's plan about other days and now do not:
the workout for a date, the missed-day scan, and This Week — the last of which
was showing a change the athlete had been told applies *next* week.

### The effective date can only point forward

Program weeks are Monday-aligned, so "the next program week" and "next Monday"
are the same date; that is the default. The sooner option is *from tomorrow*,
which reaches the very next session without touching a day that may already have
been trained.

The guard is the absence of the expression, not a check somebody has to
remember: `programRevisionDate` can return only those two values, and
`reviseProgramPlan` — the one live write path — takes a *choice*, never a
caller-supplied date. `addProgramRevision` still accepts an explicit date,
because the model must be able to place a revision anywhere; the product cannot
reach it.

### The draft lives in the programs store

Before this it lived in `pbState` and nowhere else. Closing the builder,
switching apps, or the PWA being evicted destroyed every edit.

It now sits beside `programs` in the store that already owns everything about an
athlete's programs — no new `DATA_KEY`, and backup, export and restore for free.
**And it cannot be mistaken for a program**: not because a filter remembers to
exclude it, but because it is not in the `programs` array, which is the only
place `getPrograms`, adherence, consistency, outcomes, the trainer and readiness
ever look.

Persisted: the answers needed to resume, the plan as edited, which program is
being edited. Not persisted: which session is expanded, scroll position, the
step — none of that is the athlete's work.

Ending a draft is **one operation**, because it lives in two places. `pbClose`
persists on the way out — that is what makes backgrounding safe — so clearing
only storage wrote the draft straight back underneath the caller. That happened
twice before `pbEndDraft` existed: activation offered to resume a program that
was already running, and Discard did not discard.

### The picker

`prompt('Add exercise…')` is gone. One surface adds and replaces, reading
`CANONICAL_EXERCISES` for names, aliases, muscles and equipment, and
`PROGRAM_EXTENSIONS` for suggestions — the same pool the generator draws on.

Two things it does that a list of names would not. **One entry per movement**:
the templates name the same lift several ways, and the registry already declares
them identical, so they collapse — 216 rows became 185 without adding a single
fact. **Filters mean what they say**: filtering by triceps returned Bench Press,
Push-Up and Overhead Press until it read *primary* muscles, which is the
ownership D48 made canonical. Fifty-five results became sixteen.

Replacing keeps the prescription. Swapping Bench Press for Incline DB Press
changes what is trained, not how much of it.

### Five defects, four of them shipped

1. **Editing a running program regenerated it.** `openProgramBuilderFlow('edit')`
   seeded answers and let the review generate — so the editor opened on a
   freshly built program with the athlete's own sessions gone, and Save wrote
   that over theirs. Measured: a program named "My Program" with a hand-authored
   Upper A opened as "2-Day Full Body Muscle Growth". This is D51B's root defect
   on the active side, and it is why active editing could not be offered at all.
2. **A custom session could not be activated.** `validateProgram` required
   `planId + templateId` on every training day — the only shape an entry had
   before D51B. A session that owns its exercises was refused as *"Incomplete
   workout on tue"* with no way forward.
3. **…and the app could not resolve one either.** `resolveProgramWorkout`
   returned null the moment `DEFAULT_PLANS` had no entry for `planId`, before
   ever looking at what the session contained. The builder showed custom
   sessions; the workout screen could not open them. Both halves shipped in
   D51B, and neither was reachable from the other's test.
4. **The length and rename controls did nothing.** Both set an answer and
   repainted, which worked only while every repaint regenerated. After D51B the
   two controls that changed an answer *without* going through `pbAnswer` stopped
   reaching the program: tapping 12 weeks left the draft at 6 and the segment
   never even moved.
5. **Restoring a backup could drop a draft while reporting success.** The
   programs merge was a fresh object literal naming three fields, so anything
   else the store carried was silently discarded. It now spreads the existing
   store, so a future field survives without anyone remembering.

### The ruler problem, ended

D51B reported the fourth consecutive phase lost to character-count source
assertions. It happened twice more here before the fix landed.

`fnSrc(src, name)` returns a function bounded by the **next top-level
declaration**, comment-stripped, and `stripComments` / `cssRule` sit beside it.
Ninety function-anchored rulers across sixty-six functions were converted
mechanically; two negative assertions got *stronger* in the process, because a
ruler-bounded negative was always weaker than it read. Assertion count is
unchanged, so nothing was lost in the conversion.

Two conversions ran across into a neighbouring assertion and were repaired by
hand — worth recording, because the failure was silent in one direction: the
suite still passed while asserting the wrong thing.

CSS-property rulers were deliberately left alone. None has ever caused one of
these failures, and converting 200 more of them is the framework migration the
brief said not to do.

### Verification

5,763 assertions across 152 contracts, plus 327 program-audit, 87
data-integrity, 261 cardio, 43 GPS and the three-zone date matrix — all green.
The temporal oracle hand-declares every expected count from the calendar: eight
weeks of two days is 16 slots; a third day from week 4 makes it 21, never 24;
three windows make it 18.

Six viewports clean on the studio and on the picker: zero overflow, zero
clipping, every control at least 44px, every input 16px.

`DATA_KEYS` remains 15. `TRAINER_ENGINE_VERSION` remains `0.1.1-shadow`. No
migration. D39–D51B untouched.

### Scope

Not shipped, and still deliberately so: the template library, the three-way
entry screen, and outside-activity blocks. The architecture is now ready for all
three — a session that owns its exercises is exactly what a template is.

---

## §78 — D51D: A program you can see

**Status.** Shipped in LOOP 4.8 (`loop-v125`).

D51C built the durable, forward-safe program architecture. Owner QA rated it
8/10 and named four things that had nothing to do with storage: *couldn't find
the draft again*, *couldn't change the workouts to what I want*, *feels like a
form*, and *I don't want the program to be false either*. Plus two on Progress:
the rank block doesn't fit, and the medals look unfinished up close.

Every one of them turned out to be a real, reproducible defect.

### "Couldn't find it again"

The draft was persisted correctly and had **nowhere to be found**. The only
surface that mentioned one was the builder itself, reached from the fourth row
of a section called *Adjust*, below the fold on My Training. Persisted and
undiscoverable is the same as lost.

It has a home now: a block on My Training, above the fold, naming what it is,
how big it is and when it was last touched, with **Continue** and **Discard**.
It is secondary to the program being trained, and it never opens itself —
arriving at My Training must not throw anyone into a draft they were not asking
for.

### "Couldn't change the workouts to what I want"

Not hidden capability, and not a misunderstanding. With a program running, My
Training rendered a **read-only** program map; the day rows carrying edit
controls only ever rendered when there was *no* program. So the athlete could
see their week and could not touch it, and the single way in was a button
labelled "Edit program — Days, workouts, goal and length" at the bottom of
Adjust.

Every session in the week is now listed, and **the whole row is the control** —
tap it and the editor opens on that session, scrolled to it. Add a session is
offered in the same place, and creates the session and opens it. A pencil icon
at the end of a row is the affordance that cannot be hit one-handed; there
isn't one.

### "I don't want the program to be false either"

`deriveSplitInfo` counted **stored categories** and announced "Push / Pull /
Legs" from them alone. No editor changes a category — correctly, since category
is how adherence identifies a planned session — so an athlete could rewrite
Monday's push session into a leg day and LOOP would keep describing the program
as PPL in the headline, in the My Training hero, and in the program's own name
at the top of the screen.

The session's exercises decide now. Its dominant muscle group has to be one its
category promises; when it is not, the confident split name is withheld and the
program reads *"Your own split"*. Measured:

```
generated      3-Day Push / Pull / Legs Muscle Growth
               3 days a week · Push / Pull / Legs · Muscle Growth
               "3 days a week of push / pull / legs training for muscle growth."

push day rewritten as legs
               3-Day Muscle Growth
               3 days a week · Your own split · Muscle Growth
               "3 days a week of your own training for muscle growth."
```

Nothing is renamed and no session is reclassified. LOOP simply stops asserting
a shape it can no longer support. Swapping one accessory is **not** a
contradiction, and the goal the athlete chose survives everything — §17's
distinction between intent and derived composition, made structural.

The program **name** needed the same treatment and one more rule, because it is
the loudest claim on the screen. `nameByAthlete` has three states: `true` is
the athlete's and is never touched, `false` is the generator's and is
re-derived, and **absent is unknown** — a program from some other path, whose
name LOOP leaves alone unless it is recognisably its own handwriting. Coercing
absent to false renamed "My Old Program" to "1-Day Muscle Growth" for exactly
one test run before that was caught.

Emphasis already self-corrected. The brief's own example was the one thing that
was already right.

### "Form, want it to feel premium"

D51B put three text inputs on every exercise, permanently. A six-exercise
session was eighteen input boxes stacked down the screen. What an athlete wants
when they open a session is what the session *is* — and a form cannot show
that, because every value is wearing a box.

```
BENCH PRESS
4 × 6–8 · effort 8
```

One tap turns that row into its editor: a stepper for sets, the app's own
numeric fields for reps and effort, and the controls that restructure the
session — Replace, ↑ Earlier, ↓ Later, Remove — appearing *with* the fields
rather than sitting on every row waiting to be hit by accident. One exercise
open at a time. Everything is one tap deep; nothing is hidden.

Three defects fell out of building it:

- **The columns never lined up.** A global `label { margin-bottom: 6px }` rule
  for LOOP's older forms was reaching into the grid. Reps and Effort are
  labels and Sets is a div, so two of three columns picked up 14px of top
  margin and the row grew to 83px to hold a 63px control. The SETS label sat
  14px above the other two — since D51B.
- **Remove was the loudest control on the screen.** Four equal buttons wrapped,
  and the destructive one became a full-width red bar.
- **The stepper buttons were 42×42.** A 44px box with a 1px border leaves 42
  inside. Both the stepper and the inputs are 46 outer / 44 interactive now, so
  they match each other as well as the minimum.

### The rank emblems

Measured rather than squinted at. Every rank draws into the same 120-unit box,
and three of them are not centred in it — VETERAN's keel put its silhouette
**3.75 units low**, which is 6.5px at showcase size. ROOKIE's ink covered 74%
of the width LEGEND's did, so the medals visibly changed size along the ladder.
And LEGEND's apex — the single point the top rank's whole silhouette builds
toward — sat exactly on the `R = 56` clamp, cut off square.

The fix is not seven nudges. One transform per emblem, derived from its own
bounds: centre it, then scale it to a common extent. The bezel, the hexagon,
the shoulders, the wings, the keel, the crest and the apex are untouched, and
the ladder still reads from the outline alone. Only the fit changes, and the
clamp is gone because fitting now guarantees the box.

```
                 before                        after
ROOKIE       80.0 × 80.0   (60.0, 60.0)   104.0 × 104.0   (60, 60)
VETERAN     107.6 × 99.4   (60.0, 63.8)   104.0 ×  96.1   (60, 60)
LEGEND      107.6 × 109.4  (60.0, 58.8)   102.3 × 104.0   (60, 60)
```

Worst centring error: 0.0000. Extent spread: 0.0000, from 29.4.

### The rank block on Progress

Every other section of the overview is a card with `margin-top: 12px`. This was
a bare flex row with the margin on the **wrong side** — `margin-bottom` and no
`margin-top` — so it collided with the card above it (0px where every other
join is 12px) and left 16px of dead space below itself at the end of the panel,
with nothing after it. That is the spacing the owner could see, and the reason
the rank "didn't fit": it was composed as the last row of a header, in a column
of cards. The joins now measure 12 / 12 / 12.

The order is unchanged and deliberate: how am I doing now → am I following my
plan → what did I train → am I consistent → how far I've come. The long view
closes the page.

### Progression: deliberately unchanged

The owner asked for rep guidance to be "a little more accurate", and almost
every progression reality-check answer was DIDN'T TEST. That is real feedback
with no evidence behind it yet, so D49's thresholds, increase, hold, reduction
and RIR-sufficiency rules are all untouched. The question stays in Owner QA
until there are real gym exposures to calibrate against.

### Verification

5,835 assertions across 153 contracts, plus 327 program-audit, 87
data-integrity, 261 cardio, 43 GPS and the date matrix — all green, and D51C's
temporal oracle (42) and durability probe (58) still pass unchanged.

Six viewports clean across My Training, the session editor with an exercise
open, and the Progress overview: zero overflow, zero clipping, every control at
least 44px, every input 16px.

`DATA_KEYS` remains 15 — this phase added no storage at all. No migration.
`TRAINER_ENGINE_VERSION` remains `0.1.1-shadow`. Session Score, Live Set Coach,
D49 progression, D51C plan revisions and the picker are untouched.

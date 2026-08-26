# D19 — The workout as a premium training journey

Commits `a45d4a6` + `300d4ad` · `loop-v77` · deployed and verified live
**4315 passing / 0 failing** (baseline 4276).

---

## WARM-UP

**Entry experience.** The warm-up opens as an introduction rather than a form.
Measured composition at the entry step: progress rail → `WARM-UP` label →
"Prepare to train" → one lede line → a flat card (no border, no fill, no
radius) → **Start Warm-up** (accent, 52px, weight 700, full width) →
**Skip** (transparent, dim text, 44px). The two never compete — Skip has no
background at all — and the navigation bar and finish action are both empty
here, so the entry has exactly two actions.

**One screen.** The whole active warm-up fits one viewport in **both** phases at
every required size, with no scrolling and nothing below the fold:

| Viewport | Layout | Content height / available | Everything visible |
|---|---|---|---|
| 375×812 | stacked | 683 / 683 | yes |
| 390×844 | stacked | 715 / 715 | yes |
| 812×375 | figure beside clock | 250 / 250 | yes |
| 844×390 | figure beside clock | 265 / 265 | yes |
| 932×430 | figure beside clock | 305 / 305 | yes |

Getting there needed three reclamations in short landscape: the get-ready block
is capped to the ring's height (a 60px jump for three seconds otherwise pushed
the instruction off the bottom exactly as the movement began), the progress rail
keeps its shape at a smaller scale, and the written "1 OF 5" gives up its line
because the rail beneath it already says the same thing — the position moved
onto the rail's own `aria-label`, so nothing is lost to a screen reader.

**Three-second countdown.** Timed movements open on `GET READY / 3 / 2 / 1`
in success green, occupying the clock's position so the screen says one thing at
a time. It is **a phase of the existing timer, not a second one**: the same
`prepTimerId` interval drives both, `readyUntil` hands over to `endsAt`, and
both are wall-clock deadlines rather than tick counts. The three seconds sit in
front of the movement — a 30-second stretch still receives its full 30 seconds,
asserted directly.

Rep-based movements get **no** countdown, no timer and no Pause, exactly as
before. Verified against the live sequence: `arm_circles` (30s) counts in,
`band_pull_apart` (15 reps) does not.

Safety, measured: the countdown survives three re-renders with its deadline
unchanged, freezes on pause, re-anchors on resume, and **never exceeds one
interval** across 20 rapid Next, 20 rapid Previous and 20 open/close cycles —
zero after exit, with no figures left in the DOM.

**Navigation.** Previous appears from the second movement onward and is omitted
rather than disabled on the first — a control that can never do anything is
noise. The last movement's primary reads **Continue to Workout** and lands
directly on exercise 1.

**No completion screen.** The old "Prep Complete" page existed to carry the main
lift ramps (`Empty bar × 10 · ~50% × 5 · ~70% × 3 · ~85% × 1`). Those now render
on the exercise page whenever no working weight is known yet, in front of the
lift they describe, so removing the screen deleted nothing — it moved content
from a page athletes tap past to the place they actually read.

**Progress integration.** The runner's dots became the workout's rail at a finer
grain: a connected track, green behind, accent on the current stop. Same visual
language, not a second progress idiom.

## WORKOUT

**Finish Workout is reserved for the end.** It was a permanent sibling of the
navigation — measured at 44px, in-viewport, on the warm-up entry *and* on
exercise 1. It is now rendered only on the review step, and **withheld by not
existing**: `#wsFinishBar` is empty, so there is nothing to tap and nothing to
reach by keyboard. The final exercise's forward action reads *Finish Workout*
and leads to the review, which carries the save.

Verified across the journey: warm-up EMPTY · exercise 1 EMPTY · middle EMPTY ·
final exercise EMPTY · review PRESENT.

**Exercise page.** Each set was a filled, bordered, rounded box containing two
more filled, bordered, rounded boxes — three container layers for two numbers.
In the stepper the outer layer is gone, replaced by a hairline separator, so the
steppers are the only things that look tappable, which is what they are.
Measured: **18 rounded containers per exercise down to 14**. Completion reads as
an inset success edge plus the existing animated tick, rather than a filled card.

At 375×812 the entire first set sits above the fold with **zero** scrolling
required — name, context, actions, lift ramp and the full first set all land
above the navigation.

**Set logging, set type, RIR.** Nothing was removed. Weight, reps, RIR, set
type, completion, notes, replace, recommendation and last-time are all intact.
Set Type remains *named* on the always-visible meta row (`Working`, `RIR —`) —
no return to three-dot discovery — with the full labelled controls one tap away.
Recommendation and last-time stay collapsed into the one-line context summary.

**Navigation.** One primary and two quiet actions: Previous and Skip are text,
Next carries the accent. Skip now sits a step quieter than Previous, being the
only one that leaves work undone.

## PROGRESS

`workoutStepBarHtml()` renders on **all three** branches — warm-up, exercise,
review — and leads with a warm-up stop whenever one is offered. The workout no
longer appears to begin at exercise 1.

States differ in shape as well as hue: untouched is a flat grey dot, complete is
filled, current is filled *and* ringed *and* scaled up. Every stop names its own
status aloud — `"Warm-up, complete"`, `"Exercise 1, Bench Press, completed"`,
`"Exercise 2, Barbell Row, not started"` — including the genuine
`"complete, current"` of a warm-up an athlete has tapped back into.

**Returning to the warm-up costs nothing.** Automatic re-entry stays one-way
(D18.1 fixed a bug where it reappeared by itself). `returnToWarmup()` bypasses
only that guard: it marks nothing, clears nothing and rebuilds nothing.
Measured across a return trip — weight `135`, reps `8`, RIR `2`, set type
`dropset`, all eight rows still mounted, byte-identical before and after.

## MOTION

Transitions use the existing 0.2s step animation; nothing new was added. The
countdown number has a 0.28s scale-in, disabled under `prefers-reduced-motion`.
Set completion keeps its existing tick animation and single haptic.

## MOBILE

Zero horizontal overflow in **seven** workout states at 375px: warm-up entry,
exercise 1, middle exercise, final exercise, review, set controls expanded,
context expanded. Inputs 16px, touch targets 44px, no state below either.

Rotation with a live workout (portrait → landscape → portrait), carrying logged
values and a running rest timer: step, weights `90`/`95`, reps, completed-exercise
state, exactly one rest timer, 24px title and 16px inputs — **identical at every
orientation**.

## PERFORMANCE

| Operation | Mean |
|---|---|
| Progress rail render | 0.46 ms |
| Warm-up movement change | 1.21 ms |
| Set completion toggle | 2.95 ms |
| Final exercise render | 3.81 ms |
| Exercise transition | 7.56 ms |

All inside one frame. Exercise rows keep **node identity** across 30
transitions with the count stable at 8 — stepping re-renders nothing and
rebuilds no DOM.

**A rest timer defect found and fixed while testing.** Completing a set starts
that exercise's rest, and nothing stopped the previous one — two countdowns
could run at once while the workout's rest readout pointed at only one and the
other ran down unseen. Starting a rest now stops and puts away any other.
Measured across three exercises: exactly **one** live rest timer at every point,
abandoned panels hidden rather than frozen, and the chip correctly naming the
live one.

## DATA SAFETY

End-to-end save through the new flow: warm-up run to completion created **no**
training entry and no XP, then a saved workout wrote one log with 8 exercises
and the correct weights, reps and completion — `{completed: true, weight: "155",
reps: "5"}` captured straight from the DOM by the same path `saveLog` uses.
`cardioLog` untouched, XP and PRs recomputed correctly.

`DATA_KEYS` is still exactly **15**. No new key, no migration.

## TRAINER

`TRAINER_ENGINE_VERSION` remains **`0.1.1-shadow`**, confirmed in the live
bytes. **Zero** protected-symbol lines appear in the `index.html` diff —
`trainerLog`, `shadowEvidence`, `capability`, `recovery`, `readiness`, XP, PR,
`workoutLog`, `cardioLog`, `programs`, `mastery` and every trainer config are
all absent from it. Only `index.html`, `loop-tests.js`, `sw.js` and
`TRAINER-CONTRACT.md` changed; no unrelated product area was touched.

## TESTING

4276 → **4315 passing, 0 failing**. New Contract 114 covers the finish action's
placement, the rail and its warm-up stop, deliberate return without loss, the
countdown as a phase rather than a second timer, warm-up navigation, the lift
ramps' new home, one-rest-at-a-time, and rapid interaction in both directions.

**Three existing assertions changed. None weakened:**

1. `resume re-anchors the deadline` observed one phase. Replaced with assertions
   covering **both** — the countdown re-anchors, the movement clock has not yet
   started, the handover happens, the movement still gets its full programmed
   time, and both phases freeze when paused.
2. `timers are wall-clock, not tick-counted` matched one source line that no
   longer exists. Replaced with the same discipline asserted on **both** phases,
   plus an assertion that the countdown is never decremented.
3. Six rest-timer assertions failed when I inserted code near the top of
   `startRestPanel`. Their intent was intact, so rather than widening their
   match windows I **moved my code to the end of the function** — identical
   behaviour, and all six original patterns match unmodified.

Browser flows all verified: **A** (warm-up intro → countdown → movement → final
→ Continue to Workout → exercise 1), **B** (log, navigate away, return, values
intact), **C** (rotation with active workout), **D** (final exercise → finish →
review), **E** (warm-up back/forward), **F** (20 rapid Next, 20 rapid Previous).

## GIT

`a45d4a6` journey structure and warm-up runner · `300d4ad` exercise page, rest
fix, contracts and docs · pushed to `origin/main` · Pages deployed ·
`loop-v77` live · D18C's movement renderer confirmed still live with all 34
animations.

---

## REMAINING ISSUES

Deliberate future polish, not defects:

1. **The warm-up entry's lede is generic.** "A few minutes of movement before
   your first working set" says nothing about *today's* workout. It could name
   the muscles being prepared.
2. **Skip has no confirmation.** Tapping it on the entry ends the warm-up stage
   immediately. That is intentional today, but a returning athlete who taps it
   by accident has to use the rail to get back.
3. **`ws-seg` width on long workouts.** With a warm-up stop plus 8+ exercises,
   each stop is under 44px wide. The rail is a shortcut, not the only route —
   Previous, Skip and Next are all full-size — but on a 12-exercise workout the
   stops get genuinely small.
4. **The exercise page is still ~1000px tall** with the lift ramp showing.
   Everything primary is above the fold, but the secondary content below it
   could be tightened further.
5. **No cross-exercise rest queue.** Now that only one rest runs at a time,
   starting a second one silently discards the first rather than asking.

## Honest assessment

The structural work is solid and measured: the finish action genuinely does not
exist before the end, the rail genuinely spans the journey, the countdown
genuinely shares one interval, and returning to the warm-up genuinely costs
nothing. The rest-timer defect was a real bug found by testing rather than by
reading.

What I cannot claim: **I have not seen any of this rendered.** This environment
does not composite — no screenshots. Every visual claim above is geometry,
computed style and node identity: box counts, fold positions, overflow, font
sizes, colour values. That establishes the composition is correct and nothing is
clipped or competing. It does not establish that it *feels* premium — whether
the countdown reads as urgent enough, whether the flattened set rows feel calm
or merely plain, whether the rail is legible at a glance mid-set. Item 3 above
is where I would expect your first disagreement.

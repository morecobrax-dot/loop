# D19.2 — Smart exercise navigation, skip states & bottom action refinement

Commit `e72d045` · `loop-v80` · deployed and verified live
**4389 passing / 0 failing** (baseline 4349).

---

## NAVIGATION — the final state matrix

| Current exercise | Left | Right | Verified |
|---|---|---|---|
| Incomplete | Previous | **Skip** | `Previous(btn,disabled) · Skip(is-skip)` |
| Complete, not last | Previous | **Next** | `Previous(btn) · Next(is-next)` |
| Last, incomplete | Previous | **Skip** | `Previous(btn) · Skip(is-skip)` |
| Last, complete | Previous | **Finish Workout** | `Previous(btn) · Finish Workout(is-finish)` |

**Skip and Next can never render together.** One ternary chain produces exactly
one forward descriptor, and the navigation emits exactly one `.ws-nav-fwd`
button from it — both asserted structurally, not just observed. `ws-nav-next`
no longer exists anywhere in the source.

**Previous** is quiet text, disabled on the first exercise. It moves one stage
back and does nothing else: no data erased, no completion undone, no skip
changed, no timer restarted. Returning to an exercise shows its actual state.

**Skip** takes the same slot and size as Next — the thumb never hunts — but is
outlined (`--surface-2` + border) rather than filled, because moving on without
finishing is a choice the interface offers, not one it urges.

**Finish Workout** appears only on the last exercise once complete, and leads
to the review, which still carries the actual save. `#wsFinishBar` stays empty
on every exercise step, so D19's rule is intact.

Accessible labels: `Previous exercise` · `Skip exercise` · `Next exercise` ·
`Finish workout`.

## THE STATE MODEL — one idea of "finished", finally named

The audit found the real blocker: **`exerciseRowDone()` answered two different
questions with one test.** It returned true when *any* set was completed. One
logged set of three painted the progress rail green and outranked a skip,
making a half-finished exercise indistinguishable from a finished one — so the
spec's `2/3 → Skip → rail shows SKIPPED` was impossible to satisfy.

It is now split, using the definition production already had rather than a new
one:

- **`exerciseRowStarted(row)`** — anything logged. Decides whether a workout is
  under way (the warm-up gate still uses exactly this).
- **`exerciseRowComplete(row)`** — every set on the exercise completed. This is
  the same test `markExerciseComplete()` already used to turn the row green, so
  there is still only one idea of finished; it just has a name now.

Completion is read **from the set rows, not the `.ex-complete` class** — a
contract asserts the function never mentions that class — so adding a set to a
finished exercise correctly makes it unfinished again. An exercise with no sets
is not complete.

**Warm-up sets:** since every set must be ticked, a warm-up set left unticked
keeps the exercise incomplete. Warm-up work can never unlock Next while working
sets remain — the failure mode Part 3 named. Drop, failure and AMRAP sets all
count the same way, with no special-casing.

Behavioural contracts cover 0/3, 1/3, 2/3, 3/3 and the empty case directly.

## SKIP

**Representation.** A DOM flag on the row. No storage key, no skip history, no
second progress model — the draft has no `skipped` field, and `DATA_KEYS` is
still 15.

**It never edits the athlete's work.** A contract asserts `skipWorkoutStep`
contains no `.remove()`, no `.value =`, no `innerHTML`.

**Partial completion → skipped → completed**, measured end to end:

| Step | Rail | Nav | Sets kept |
|---|---|---|---|
| 2 of 4 logged | current | `Skip` | 2 |
| Skip tapped | **skipped** (`aria: "…, skipped"`) | — | 2 |
| Returned | skipped | `Skip` | 2 |
| Remaining sets done | **completed** (`aria: "…, completed"`) | `Next` | 4 |

Completing a skipped exercise **clears the flag outright** — skipped is current
workout state, not an immutable verdict.

## LAYOUT

`.ws-nav` had `padding: 12px 20px 0` — no bottom padding, no safe-area — and
sat flush against an emptied `#wsFinishBar` that still painted its
`.sheet-actions` padding, background and `border-top`: **a 29px ruled strip of
nothing under the controls on every exercise step.** The bar now hides when
empty; the inset moved to the navigation where the controls actually are.

| Viewport | Dead space below nav | Controls | Content covered | H-overflow |
|---|---|---|---|---|
| 375×812 | **0px** (was 29) | 48px | no | none |
| 390×844 | 0px | 48px | no | none |
| 812×375 | 0px | 48px | no | none |
| 844×390 | 0px | 48px | no | none |
| 932×430 | 0px | 48px | no | none |

Bottom padding is `calc(var(--space-3) + env(safe-area-inset-bottom, 0px))`.
No spacer element was added — the fix is one `:empty` rule and the padding
moving to the right element.

## PROGRESS RAIL

Unchanged concept, corrected states:

- **Current** — filled accent, scaled, haloed
- **Completed** — solid green (now genuinely means *all* sets done)
- **Skipped** — **hollow amber ring**: the shape says "nothing filled in here"
  on its own, so the state survives being read by someone who cannot separate
  it from grey by colour, and it never reaches for the danger red that would
  call it a failure
- **Upcoming** — flat grey

At 12 exercises (13 stops) D19.1's dense mode still engages: 9px painted dots,
**every touch column still 44px**, no horizontal overflow. A skipped exercise
is never announced as completed.

## REST COMPATIBILITY

Navigation touches no timers. Across 20 Skip, 20 Next, 20 Previous and 20
alternating Previous/Skip taps: **exactly one live interval throughout**, rail
intact, 8 rows mounted, final step always valid. D19.1's rest hold and
`dismissRestComplete` are untouched and confirmed live.

## PERFORMANCE

`syncWorkoutCompletionState()` repaints the rail and forward control on set
completion, un-completion, add and remove — measured at 0.52 ms per rail
render in D19.1, and it re-renders only `#wsHead` and `#wsNav`, never the
exercise rows. A 0.18s fade marks a genuine change of forward action and does
**not** replay when merely moving between exercises (the previous state is
compared first); it bows out under reduced motion.

## DATA SAFETY

Five consecutive skips, then a full snapshot comparison: `workoutLog`,
`cardioLog`, `trainerLog`, XP, level, PRs, `exerciseNotes`, `gymProfile` and
`programs` **byte-identical before and after**. Navigation writes no history.

## TRAINER

`TRAINER_ENGINE_VERSION` remains **`0.1.1-shadow`**, confirmed in live bytes.
**Zero** protected-symbol lines in the `index.html` diff. Contracts assert that
neither `skipWorkoutStep` nor `syncWorkoutCompletionState` mentions any trainer,
shadow, capability, readiness or recovery symbol — **skip is not a trainer
signal and cannot become one by accident.**

## TESTING

4349 → **4389 passing, 0 failing**. New Contract 116 covers the completion
predicate behaviourally (0/3, 1/3, 2/3, 3/3, empty), started-vs-complete, skip
semantics and flag clearing, the four navigation states, the structural
impossibility of Skip+Next together, two-controls-not-three, live re-render on
all four set mutations, the change-only fade and its reduced-motion opt-out,
empty-bar collapse, safe-area inset, 48px targets, shape-distinct skipped
state, accessible labels, and data/trainer isolation.

**Four existing assertions changed. None weakened:**

1. `an exercise is done when it has a completed set` → split into *started*
   and *complete*, plus two new assertions (completion is not read from the
   green class; an exercise with no sets is not complete).
2. `skipped never outranks done` → `skipped never outranks complete`.
3. `a resumed workout opens on the first exercise still to do` → now means the
   first *unfinished* exercise, with a companion assertion that "has this
   workout started" still asks whether anything is logged.
4. `the forward action dominates the navigation` → same balance asserted, plus
   that the forward slot is singular and that Skip takes it without taking its
   emphasis.

One of my own new assertions failed first — a 500-char window against a
571-char offset in `addSetRow`. My test, widened; the code was correct.

Browser flows driven: **A** (first exercise → Previous/Skip), **B** (complete →
Next, and un-complete → back to Skip), **C** (2/4 → Skip → rail skipped),
**D** (return → complete → skipped becomes completed, Skip becomes Next),
**E** (final incomplete → Skip), **F** (final complete → Finish Workout →
review), **G** (all five viewports), **H** (12-exercise rail).

## GIT

`e72d045` pushed to `origin/main` · Pages deployed · `loop-v80` live · D18C's
movement renderer and D19.1's rest hold both confirmed intact in live bytes.

---

## REMAINING ISSUES (deliberate future work)

1. **Skip has no undo.** Tapping Skip moves on immediately (correct — Part 29
   forbids a confirmation modal), and the way back is Previous or the rail.
   Fine, but there is no "unskip" affordance short of completing the work.
2. **A skipped exercise stays skipped in the review summary** as "N skipped",
   which is right, but the review offers no way to jump back to just those.
3. **`ex-complete` green row styling** still keys off the class, which
   `addSetRow` does not clear — the *navigation* is correct because it reads the
   sets, but the row's green tint can briefly lag until the next completion
   toggle. Cosmetic only, and worth folding into a later pass.
4. **Edit Workout** — the next product task, per Part 18. Not started, no
   placeholder controls added.

## Honest assessment

The state model was the real work here, and it was a genuine defect rather than
a cosmetic one: "done" meaning "started" is why the rail could not represent a
half-finished exercise at all. Splitting it fixed the navigation, the rail, the
resume position and the summary count in one move, without inventing a second
definition of completion.

What I cannot claim: **I have not seen the new navigation rendered.** This
environment does not composite. Every claim above is geometry, computed style,
predicate behaviour, and state — button widths, dead space, dot fills, aria
strings. That establishes the state machine is right and nothing overlaps or
overflows. It does not establish that the outlined Skip reads as "available but
not urged" rather than "disabled", which is the judgement call most likely to
need your eyes. Item 3 above is the one known cosmetic lag.

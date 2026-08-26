# D19.1 — Workout journey polish & rest-state refinement

Commit `6d0f008` · `loop-v79` · deployed and verified live
**4349 passing / 0 failing** (baseline 4321).

---

## REST TIMER — the headline of this phase

The audit found the rest card failing both of its questions:

- **"Did my rest start?"** The card rendered at the bottom of the exercise
  row's content — measured at y=1125 on an 812px screen. Completing a set
  produced **no visible change at all** unless the athlete scrolled.
- **"Did my rest finish?"** `completeRestPanel` hid the card four seconds
  after zero. Look up mid-set, look back: nothing.

**Canonical card, pinned in view.** While its exercise is the visible step the
card is `position: sticky` at the foot of the scrollport — no second UI, no
reparenting, the same element it always was. Its 12%-alpha tint now lays over
a solid surface so scrolling content can't bleed through, and it enters with a
short rise (`restIn`, 0.26s). Measured after: completing a set puts the card at
627–713, fully in view; in short landscape it pins inside the scrollport at
the athlete's actual completion scroll position (194–280 in a 65–290 port).

**Completion holds.** At zero: ring completes green, check settles in (the
existing 0.34s animation), label reads "Rest complete", and the +15s / pause /
skip controls step aside — the card is a status now, not a control surface.
Then it **stays**. Measured 4.5 seconds after zero: still visible, still done.
Nothing re-animates while it waits.

**The athlete's next action clears it.** Adjusting a weight or rep count (typed
and stepper paths both funnel through `propagateSetValueForward`), recording an
RIR, or completing the next set (which starts a new rest and resets the panel).
`dismissRestComplete()`'s only timer is the 280ms exit-animation handoff — a
contract asserts exactly one `setTimeout` and that it is that one. No cleanup
tap exists or is needed.

**Visible from anywhere.** The compact chip used to vanish at zero — chime
fired once, evidence gone with the hidden row. It now falls back to a held
completion and renders it in the same green voice: `Done · Rest complete ·
Bench Press`, spoken as "Rest complete on Bench Press. Tap to open." Tapping
jumps to the exercise where the next set is; landing there hides the chip and
shows the held card. A new rest anywhere retires a held card, so **exactly one
rest surface exists at all times**.

**Interruption matrix, measured:** pause freezes the remaining time, resume
re-anchors the deadline; 20 rapid pause/resume cycles end deterministic with
one live interval; three forced completions plus two direct `completeRestPanel`
calls fire **one** haptic (the `dataset.completed` guard); rotation with a held
card preserves done/visible state; dial text centered and inside the ring at
`10:00`, `3:00`, `1:42`, `0:30`, `0:05` (48px worst case, exactly the ring's
budget).

## PROGRESS RAIL

At 13 stops the 12px dots had 9.8px gaps — narrower than the dots, reading as
a dashed line. **Dense mode** engages at ten or more stops: 9px dots (8px for
the warm-up stop), gaps now 13.4px — wider than the dots, so the row reads as
stations again. Only the *painted* dot shrinks: every stop keeps its
full-height 44px flex column, and Previous / Skip / Next still reach every
exercise at full size. Off at nine or fewer (12px dots return). No horizontal
overflow at 13 stops; a contract holds that no dense rule touches the
`.ws-seg` box itself.

## WARM-UP

Restraint over addition, per Part 17:

- The category chip — the only boxed element on the card — became quiet
  letterspaced mono text. One container removed, nothing added.
- The movement name gained a step (26→28px, −0.01em tracking): the hierarchy
  now runs name → instruction → figure without a boxed label interrupting it.
- The figure stands in a **faint static pool of the accent** (radial gradient
  at 9% alpha, painted once behind the SVG, `pointer-events: none`, never
  animated — it costs nothing while the figure moves).

Re-audited after the changes: **97 warm-up/cooldown states across 31 distinct
movements, both countdown and running phases, at five viewports — zero
overflow, zero clipping, zero problems.** The one-viewport guarantee from the
previous pass holds with the larger name.

## WORKOUT PAGE

No structural change — D19's hierarchy stands. This phase's page-level work was
the rest card's relationship to the page (above), which removes the one moment
where the page visibly failed to respond to the athlete's primary action.
Finish Workout placement re-verified: absent through warm-up and every
exercise, present on review only.

## PERFORMANCE

| Operation | Mean |
|---|---|
| Rail render (12 stops) | 0.52 ms |
| Start warm-up | 1.7 ms |
| Warm-up movement change | 1.6 ms |

One live interval at every point in every abuse test; the sticky card adds no
listeners and no timers (CSS-only positioning); the stage glow is a static
paint. No animation in the rest section loops (`infinite` is contract-banned in
that CSS range).

## MOBILE

375×812 · 390×844 · 812×375 · 844×390 · 932×430: warm-up audit clean at all
five; workout states (exercise + live rest, middle, last, review) show zero
horizontal overflow; rotation with a held completion card preserves state.
Touch columns 44px; dial and chip text unchanged in size across orientation.

## DATA SAFETY

The rest states are presentation only: the diff contains zero occurrences of
`LOOPStore`, `setItem`, or `localStorage`. Warm-up presentation still creates
no workout history. `DATA_KEYS` is exactly **15**.

## TRAINER

`TRAINER_ENGINE_VERSION` remains **`0.1.1-shadow`**, confirmed in live bytes.
Zero protected-symbol lines in the diff — no trainer, shadow-evidence,
capability, recovery, readiness, XP, PR, or log symbol appears in it. Two files
changed (`index.html`, `loop-tests.js`) plus `sw.js` and the contract doc.

## TESTING

4321 → **4349 passing, 0 failing**. New Contract 115 covers: completion holds
(source + behavioral idempotence on a stub panel), dismissal wiring from all
three athlete-action paths, the new-rest-retires-held guard, the 280ms-only
exit timer, sticky pinning with solid backdrop, enter/leave animations and
their reduced-motion opt-outs, controls hidden at zero, the chip's completion
fallback and voice, dense-rail engagement and its touch-column invariant, and
the warm-up's unboxed tag and static stage glow.

**No existing contract was weakened.** One of my new assertions failed on
first run — it sliced the source between two functions that sit in the
opposite order in the file — and one earlier failure was my own comment
pushing `jumpToRestingExercise`'s matched line past an existing assertion's
260-char window; I shortened my insertion rather than widening their window,
same policy as D19.

Browser flows driven end to end: **A** (warm-up → countdown → movement →
Continue to Workout), **B** (complete set → card appears in view → zero →
holds → next-set input dismisses), **C** (pause/resume exact timing), **D/E**
(rotation during warm-up and with a held rest), **F** (warm-up backward), **G**
(exercise round trip, values intact), **H** (final → review), **I**
(12-exercise rail).

## GIT

`6d0f008` pushed to `origin/main` · Pages deployed · `loop-v79` live ·
D18C's movement renderer confirmed intact in the live bytes.

---

## REMAINING ISSUES (deliberate future polish)

1. **Landscape cold-landing clamp.** If the athlete lands on an exercise at
   scroll-top in short landscape, a running rest card sits below the 225px
   scrollport until they scroll (~200px) — sticky cannot escape its row's top
   edge. The real completion path always has the sets (and therefore the pinned
   card) in view, so this only affects arriving at an exercise whose rest was
   started elsewhere.
2. **Held card on an abandoned exercise.** A done card on a row the athlete
   never returns to simply stays hidden with the row — harmless, but a future
   sweep could retire it when the workout is saved.
3. **Dense rail below ~340px widths.** At 13 stops on very narrow viewports
   the gaps approach the dots again; a second density step is possible if a
   14-exercise workout ever ships.
4. **Edit Workout** — next product task, per Part 18. Not started, no
   placeholder controls added.

## Honest assessment

The rest-state machine is now genuinely deterministic under abuse, and the
below-the-fold entry was a real, measured failure — the card was invisible at
the exact moment it mattered most. What I cannot claim: whether the rise-in
feels smooth, whether the held green card reads as satisfying rather than
lingering, whether the stage glow is visible at 9% alpha on a real OLED or
disappears entirely. This environment does not composite — every claim above
is geometry, computed style, and state, not eyes on pixels. The glow's alpha
(item most likely to need a nudge) is one number in one rule if it does.

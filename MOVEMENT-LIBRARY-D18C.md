# D18C — Premium movement animation system, integrated

Commit `330e4bb` · `loop-v76` · deployed and verified live · 4276 passing / 0 failing
(baseline was 4192).

---

## A. What shipped

Prep and cooldown movements now show an animated figure above the countdown.
The architecture is the one the brief specified and nothing more:

```
production movement id  →  MOVEMENT_ANIMATION  →  shared SVG figure renderer
```

One renderer, one figure system, one `customElements.define`. No per-movement
component, no second SVG system, no second animation engine, no second timer.

The review tool (`movement-library.html`), its grid, its debug controls and its
highlight/tempo/auto-advance switches were **not** imported. The runner is still
name, figure, timer-or-reps, instruction, Pause, Next.

## B. How the renderer got in

`loop-movement.js` stays the source of truth. `sync-movement.js` copies it into
a marked region of `index.html`, and a contract holds the two byte-identical —
so forgetting to sync fails the suite rather than shipping a renderer that
disagrees with the review tool.

It is inlined rather than linked for two concrete reasons:

- **Offline.** `index.html` is the whole app. A linked file would need its own
  `sw.js` ASSETS entry to survive a gym with no signal. `ASSETS` is unchanged,
  so the offline story is exactly what it was.
- **Testability.** The harness evaluates only the *largest* inline `<script>`
  block. A linked file — or even a separate inline block — is invisible to
  every contract. I found this by putting the engine in its own block first and
  watching `window.LoopMovement` come back `undefined` under test.

Two changes were needed in the renderer itself, both upstream in
`loop-movement.js` so the review tool and production stay identical:

1. **Registration guard.** The harness has no `HTMLElement` and no
   `customElements`. `LoopMove.prototype = Object.create(HTMLElement.prototype)`
   throws at load there, which would have taken all 4276 contracts down before
   one ran. Registration is now guarded; the movement data below it still loads.
2. **`pause()` / `resume()`.** Methods, not attributes — `attributeChangedCallback`
   rebuilds, and a rebuild is the one thing pausing must not do. Animation time
   lives on the instance, so resume continues from the pose it stopped on.

## C. Mapping

31 of 40 movements have an animation. Every target exists in the library, no
two movements share one, and no mapped key is absent from the registries.

| Production id | Animation | Note |
|---|---|---|
| `arm_circles`, `band_pull_apart`, `scap_pushup`, `wall_slide`, `thoracic_rotation`, `push_up_slow`, `dead_hang`, `face_pull_light`, `leg_swing_front`, `leg_swing_side`, `glute_bridge`, `bodyweight_squat`, `ankle_rock`, `world_greatest` | same id | exact match |
| `shoulder_cross_body`, `triceps_overhead`, `lat_stretch`, `quad_stretch`, `hamstring_stretch`, `hip_flexor_stretch`, `calf_stretch`, `child_pose` | same id | exact match |
| `cat_cow` | `standing_cat_cow` | approved content change |
| `chest_doorway` | `chest_opener` | approved content change |
| `glute_figure4` | `standing_figure4` | approved content change |
| `hip_hinge_bw` | `hip_hinge` | production id stays canonical — **no duplicate hinge** |
| `reach_rotate`, `band_passthrough`, `hamstring_sweep`, `deep_squat_hold`, `reverse_lunge` | same id | added in D18C |

`dead_hang` stays a prep mobility movement, as D18B decided.

### Nine movements draw nothing, on purpose

Two because D18A rejected the mapping and it stays rejected:

- `march_in_place` is **not** drawn as a quad stretch
- `dead_bug` is **not** drawn as a hip hinge

Seven because they are production-only with nothing authored yet:
`straight_arm_pulldown`, `monster_walk`, `band_row`, `torso_twist`,
`upper_back_round`, `rear_delt_stretch`, `spinal_twist`.

All nine render the text card exactly as before. A wrong figure would teach the
wrong movement, which is worse than no figure.

## D. Content changes

Three approved replacements. **Production ids are unchanged** — the id is an
internal key, the athlete reads `displayName`, and keeping it canonical means
nothing downstream has to care:

| id | was | now |
|---|---|---|
| `cat_cow` | Cat-Cow, "on all fours" | **Standing Cat-Cow**, hands on thighs |
| `chest_doorway` | Doorway Chest Stretch | **Chest Opener**, hands clasped behind |
| `glute_figure4` | Figure-4 Glute Stretch, "on your back" | **Standing Figure-4** |

All three are now doable beside a rack instead of on the floor.

Because the ids stayed put, an id-based test would pass even if the content
change had been forgotten — so the contracts assert the content directly
(display name changed *and* the old instruction wording is gone).

## E. Five movements added — and a decision left open

`reach_rotate`, `band_passthrough`, `hamstring_sweep`, `deep_squat_hold`,
`reverse_lunge` are in `PREP_MOVEMENTS` (22 → 27). The four the brief withheld
— `calf_raise`, `hip_hinge`, `bird_dog`, `hip_9090` — stayed out, and a
contract asserts it.

**They are not in any sequence, so no athlete's warm-up changed.**

`PREP_SEQUENCES` is a set of explicit id lists; the registry is only reachable
through them. Adding these five to a sequence would change what athletes are
told to do, which is a programming decision the brief did not authorise and
§3's "0 recommendation changes" argues against. So the movements are integrated,
animated and ready, and adoption is yours to call. Suggested placements when you
want them:

- `fullbody` — swap `march_in_place` (no animation) for `reach_rotate`
- `legs`/`lower` — `hamstring_sweep` or `deep_squat_hold` in place of `ankle_rock`
- `push`/`upper` — `band_passthrough` alongside `band_pull_apart`
- `legs` — `reverse_lunge` before `bodyweight_squat`

A contract currently asserts no sequence references them, so it will fail
deliberately when you change this — that is the reminder, not an obstacle.

## F. Timer ownership

The countdown is still the only clock. The renderer starts no interval, no
timeout, and never reads `prepState` — asserted against the vendored source
with comments stripped, so the guarantee is about code rather than prose.

Pausing previously called `renderPrepStep()`, which rebuilds `#prepRun`. Once
the figure lives there, that restarts the demonstration from frame 0 on every
Pause **and** every Resume. `togglePrepPause()` now calls `syncPrepPauseUI()`,
which touches only the ring class, the button label and the figure.

Measured in the browser: pausing changes the rendered markup by exactly 7
characters (`prep-ring` → `prep-ring paused`), and the `<loop-move>` node and
its `<svg>` are identical object references before and after. No rebuild.

**Leak audit** — instrumented `requestAnimationFrame`/`cancelAnimationFrame`:

| Scenario | Live frames after |
|---|---|
| 20 × open/close prep | **0** |
| 40 × rapid Next through a 4-step sequence | **0** |
| `exitPrep()` | **0**, runner emptied, `<loop-move>` count 0 |

Rapid Next clamps at `idx === seq.length` and leaves no timer.

## G. Reduced motion

Honoured by the renderer: `prefers-reduced-motion` renders a held pose and
starts no loop. Verified that a static figure also refuses to start one on
`resume()` — `_static` is checked, so a reduced-motion user who pauses and
resumes never gets motion.

## H. Geometry and viewport QA

**All 31 animations** swept at 0.25s intervals across a 12-second cycle,
union bounding box of every drawn node against the `30 10 180 178` viewBox:

- **zero clipped**, tightest margin 2.2 units (child_pose — the D18B shadow fix
  holds under a full sweep)

**Viewports** — prep runner open on an animated movement:

| Viewport | Figure | Layout | H-overflow | V-overflow | Instruction |
|---|---|---|---|---|---|
| 375×812 | 240×237 | stacked | none | none | visible |
| 390×844 | 240×237 | stacked | none | none | visible |
| 812×375 | 108×107 | **row** | none | none | visible |
| 844×390 | 108×107 | **row** | none | none | visible |
| 932×430 | 108×107 | **row** | none | none | visible |

### A regression I introduced and fixed

At 812×375 the figure pushed the instruction to `bottom: 378px` on a 375px
screen — off the bottom, behind the buttons. Stacked, figure + ring alone
exceed the height available.

Fixed by giving them a shared `.prep-stage` that becomes a flex row under
`(orientation: landscape) and (max-height: 500px)`, with the figure capped to
the ring's 108px — the stage is as tall as its tallest child, so any extra on
the figure is height the instruction loses. Overflow went 313→254→251 against a
250px box across two iterations. The same pattern the cardio stage already uses.

`-webkit-text-size-adjust: 100%` from D18.3 is untouched (3 occurrences intact).

## I. Data and trainer safety

- `DATA_KEYS` **exactly 15**, unchanged. No new key, no migration, no write.
- **Zero** protected-symbol lines in the whole `index.html` diff (`trainerLog`,
  `workoutLog`, `cardioLog`, `programs`, `mastery`, `recovery`, `readiness`,
  `capability`, XP, PR, `LOOPStore`, `localStorage`, `setItem` — all absent).
- Trainer remains **`0.1.1-shadow`**.
- The renderer references no trainer symbol and writes nothing.
- Live check ran read-only: a detached figure, `prepState` still `null`, no
  elements left in the DOM.

## J. Testing

4192 → **4276 passing, 0 failing**. New Contract 113 covers mapping validity,
unique targets, unknown-id handling, rejected mappings, production-only
preservation, content changes, sequence stability, timer ownership, lifecycle
cleanup, rapid-tap and rapid-open/close abuse, reduced motion, and data/trainer
isolation.

**Three existing assertions changed. None was weakened, none deleted:**

1. `PREP_MOVEMENTS still has 22` → asserts the count *and names all five
   additions* and *names the four withheld ones as absent*. A bare count of 27
   would pass with five wrong movements, or five additions plus a deletion.
2. `production is not reading the design library` → a D18B boundary D18C
   deliberately crosses. Replaced with the stronger fact it was protecting: the
   vendored renderer must match `loop-movement.js` **byte for byte**.
3. `pause is reflected in the UI` compared rebuilt markup. Replaced with a spy
   that counts `renderPrepStep` calls and asserts **zero** on pause and resume —
   plus a sentinel assertion proving the spy observes a real render, so the two
   zero-checks cannot pass vacuously.

Two of my own new assertions failed first and were wrong, not the code: one
regex looked for `this._t` where the source says `self._t`, and one assumed the
first prep step is animated when the fallback sequence opens with
`march_in_place` — which is *correctly* unanimated. The second became a stronger
test that walks the whole sequence and asserts both branches.

One assertion passed for the wrong reason and was rewritten: comparing
`prepRun.innerHTML` across a pause passes in the harness only because its DOM
stub can't resolve the compound selector `#prepRun .prep-ring`. The browser
showed the markup legitimately changes by one class, so the harness was
agreeing by accident.

---

## FUTURE MOVEMENT POLISH

Not blockers. Deferred deliberately per "ship what is currently there".

1. **90/90 hip switch** (`hip_9090`) — compression artefacts; withheld from
   production, animation exists in the library.
2. **Bird Dog** (`bird_dog`) — same; withheld.
3. **`world_greatest` geometry** — shipped and inside the viewBox, but the deep
   lunge reads less clearly than the rest of the set.
4. **Dynamic tempo** — the renderer supports a `tempo` attribute; production
   never sets it. Matching tempo to the movement (slow for stretches, brisk for
   dynamic work) is an obvious upgrade.
5. **Animations for the seven production-only movements** —
   `straight_arm_pulldown` and `monster_walk` matter most; they carry coverage
   nothing else does (only lat activation, only frontal-plane glute work).
6. **Sequence adoption for the five new movements** — section E.

## Honest assessment

The integration is sound: one renderer, one clock, no leaks, no data or trainer
exposure, and it degrades to the old text card wherever no animation exists.
The landscape regression was real and is fixed and measured.

What I cannot claim: **I have not seen it move.** This environment does not
composite — `requestAnimationFrame` fires zero frames and screenshots are
unavailable. Every animation claim here comes from driving `_fig.tick(t)`
manually and diffing path geometry. That proves the figures are anatomically
in-frame and that the poses change over time. It does not prove the motion
*reads well* on a phone — whether the tempo feels right, whether a given
movement is recognisable at a glance. That needs your eyes on the device, and
section 3 of the polish list above is where I would expect the first
disagreement.

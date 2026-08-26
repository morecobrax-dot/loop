# Movement Library — D18B Report

**Status: renderer stabilised, production untouched.**
`index.html` and `sw.js` have no changes. `PREP_MOVEMENTS`, `COOLDOWN_STRETCHES`, the
trainer (`0.1.1-shadow`), storage and every athlete-facing behaviour are exactly as they
were. Changes are confined to `loop-movement.js` (the design library) and `loop-tests.js`.

---

## A. Renderer fixes

### A.1 A measurement correction that affects everything below

Every bounds measurement in D18A — and my first four attempts in this phase — was
**racing the review tool's own render loop**. `movement-library.html` rewrites
`fig.setAttribute('movement', …)` every 250 ms, so any measurement that set the attribute
and waited longer than that was silently measuring whatever the *runner* was showing.

That produced contradictory readings: `child_pose` measured as clipped, then clean, then
clipped again. All subsequent numbers here were taken on an **isolated `<loop-move>`
element** outside the tool's control, with `settledCorrectly` asserted on every sample.

### A.2 `child_pose` — CONFIRMED and FIXED

The D18A finding was correct, and the cause is precise:

- The ground shadow is an `<ellipse>` anchored to `J.mid.x` with `rx: 60`.
- The deepest fold puts `mid.x` at **86**, so the ellipse's left edge landed at **26**.
- The viewBox starts at **x = 30** → **4.5 units of the shadow were clipped.**
- The *figure* was never clipped. Only the shadow under it.

**Fix:** `rx: 60 → 52`. Left edge now lands at 34, four units inside the frame, and the
shadow is still wide enough to read as a long low pose.

**Verified** on the isolated rig across start / 25% / 50% / 75% / end / loop-return, and
in the reduced-motion static pose: **0 overflow**. Re-checked at all five viewports.

### A.3 `world_greatest` — new finding, 1 unit bottom overflow

Not previously reported. During the lunge transition a shin path reaches
`y = 184.7` with an 8.6-unit stroke → 189 against a bound of 188.

**Cause is structural, not a bad pose.** The engine converts poses to polar bone params so
tweens travel in arcs rather than chords — a deliberate v2 feature. During the lunge
transition that arc carries the trailing shin marginally below the ground line.

**Recommendation: ACCEPT.** One unit out of 178 is 0.56%, visible only as a foot tip
touching the frame edge for a few frames mid-transition. Fixing it means either editing
authored pose data or special-casing the tween — both worse than the symptom.

### A.4 Full bounds sweep

**32 of 34 movements clean** at every phase of the cycle. After the `child_pose` fix:
**33 of 34**, with `world_greatest` the accepted 1-unit case.

---

## B. Visual-only upgrade list — 21 movements

Safe for D18C. Same ID, same category, same purpose, same selection. Renderer only.

`arm_circles` · `world_greatest` · `leg_swing_front` · `leg_swing_side` ·
`thoracic_rotation` · `wall_slide` · `ankle_rock` · `band_pull_apart` · `face_pull_light` ·
`scap_pushup` · `glute_bridge` · `push_up_slow` · `bodyweight_squat` ·
`hip_flexor_stretch` · `hamstring_stretch` · `quad_stretch` · `calf_stretch` ·
`shoulder_cross_body` · `triceps_overhead` · `lat_stretch` · `child_pose`

**One-to-one, no content change.** `child_pose` is included now that its shadow is fixed.
`dead_hang` is deliberately excluded — see G.

---

## C. Content replacement candidates

### C.1 `cat_cow` → `standing_cat_cow` — **APPROVE**

| | |
|---|---|
| Current | On all fours. Round the back, then arch it. |
| Proposed | Hands on thighs. Round your back, then arch it. |
| Why | Identical spinal flexion/extension cycle, performed standing. |
| Beginner | No getting down to and up from the floor. |
| Advanced | Neutral — same segmental control, less setup. |
| Gym practicality | **Strong.** No floor space, no mat, no hygiene issue. |
| Movement purpose | Unchanged: spinal articulation. |
| Overlap risk | **Low.** Nothing else in the library cycles the spine. |
| Animation | 80%+ frame use, reads clearly. |

### C.2 `glute_figure4` → `standing_figure4` — **APPROVE**

| | |
|---|---|
| Current | On your back, ankle over the opposite knee. |
| Proposed | Ankle over the opposite knee, hold support, sit back. |
| Why | Same joint angle and target, upright with support. |
| Beginner | Easier entry and exit; support removes the balance barrier. |
| Advanced | Adds a mild balance demand. |
| Gym practicality | **Strong.** Needs a rack upright, not floor space. |
| Movement purpose | Unchanged: glute/piriformis stretch. |
| Overlap risk | **Low.** |
| Animation | Standing pose, reads well. |

### C.3 `chest_doorway` → `chest_opener` — **HOLD**

| | |
|---|---|
| Current | Forearm on the door frame, elbow at shoulder height, step through. |
| Proposed | Clasp hands behind the back, straighten arms, lift the chest. |
| Why | Removes the doorway dependency. |
| Beginner | Simpler; nothing to find. |
| Advanced | **Loss.** The doorway version gives a stronger, angle-controlled pec stretch. The clasped version is capped by shoulder mobility and reaches a different tissue. |
| Gym practicality | **Gain** — gym floors rarely have a usable doorway. |
| Movement purpose | **Changed.** Doorway = targeted pec stretch. Clasp = anterior shoulder/chest opener. Related, not equivalent. |
| Overlap risk | **Medium** — the clasp overlaps `shoulder_cross_body` and `rear_delt_stretch` more than the doorway version does. |
| Animation | Good. |

**HOLD, not approve.** The practicality argument is real, but this one changes what is
being stretched. Better resolved by keeping both — doorway where available, opener as the
fallback — than by replacing.

---

## D. Rejected replacements — preserved

Both remain rejected, and Contract 112 now enforces it.

| Proposed | Verdict | Reason |
|---|---|---|
| `march_in_place` → `quad_stretch` | **REJECT** | Marching is dynamic preparation; a quad stretch is static stretching. Swapping them makes a programming decision silently. |
| `dead_bug` → `hip_hinge` | **REJECT** | Dead bug is anti-extension core work; a hip hinge is a pattern rehearsal. Different jobs. |

`hip_hinge` may still be **added** on its own merits — see G.

---

## E. New movements

| Design ID | Verdict | Note |
|---|---|---|
| `reach_rotate` | **ADD** | Standing thoracic rotation. Complements `thoracic_rotation`, which is on all fours. |
| `band_passthrough` | **ADD** | One band covers the full shoulder arc. |
| `hamstring_sweep` | **ADD** | Dynamic counterpart to the static hamstring stretch. |
| `deep_squat_hold` | **ADD** | Hips, ankles and low back in one position — efficient for a 3–5 min warm-up. |
| `reverse_lunge` | **ADD** | Single-leg prep needing one step of space. |
| `calf_raise` | **HOLD** | Fine, but marginal beside `ankle_rock`. Low priority. |
| `hip_hinge` | **HOLD** | See G — reconcile with `hip_hinge_bw` first. |
| `standing_cat_cow` | ADD via C.1 | |
| `standing_figure4` | ADD via C.2 | |
| `chest_opener` | HOLD via C.3 | |
| `bird_dog` | **HOLD** | Device review — see H. Also a new floor movement. |
| `hip_9090` | **HOLD** | Device review — see H. Also a new floor movement. |

---

## F. Production-only movements

None should be retired by adopting the design library. Two carry coverage nothing else has:

| Production ID | Verdict | Reason |
|---|---|---|
| `straight_arm_pulldown` | **KEEP · future animation** | The **only lat activation** in either registry. Dropping it leaves lats with `dead_hang` and `lat_stretch` only. |
| `monster_walk` | **KEEP · future animation** | The **only frontal-plane glute work** in either registry. |
| `band_row` | **KEEP · future animation** | `band_pull_apart` and `face_pull_light` overlap but are not a row. |
| `torso_twist` | **KEEP, review later** | Overlaps `reach_rotate`; a real consolidation candidate once `reach_rotate` ships. |
| `march_in_place` | **KEEP** | See D. |
| `dead_bug` | **KEEP** | See D. |
| `cat_cow` | REPLACE via C.1 | |
| `glute_figure4` | REPLACE via C.2 | |
| `chest_doorway` | **KEEP** (hold) | See C.3. |
| `upper_back_round` | **KEEP · future animation** | No design equivalent. |
| `rear_delt_stretch` | **KEEP, review later** | Overlaps `shoulder_cross_body`; no explicit mapping was ever given. |
| `spinal_twist` | **RETIRE candidate** | Floor-based, no design equivalent, and `child_pose` already closes the session. The one production movement whose retirement is defensible on the stated floor preference. |

---

## G. Duplicate and identity issues

### G.1 `hip_hinge` vs `hip_hinge_bw` — **map to production**

| | Production `hip_hinge_bw` | Design `hip_hinge` |
|---|---|---|
| Name | Bodyweight Hinge | Hip Hinge |
| Category | movement_prep | movement_prep |
| Target | hamstrings | hamstrings |
| Equipment | bodyweight | none |
| Prescription | 10 reps | 30 s |

Same pattern, same target, same category, same equipment. The only differences are the ID,
the label, and reps-vs-duration.

**Recommendation: option A — map design `hip_hinge` onto production `hip_hinge_bw`.**
Keep the production ID (it is what athlete history is written against), take the design
animation. Do **not** expose both.

### G.2 `dead_hang` classification — **keep production**

Production: prep mobility. Design: cooldown stretch (`role: both`).

**Recommendation: preserve the production classification.** Two reasons. First, LOOP
already offers `dead_hang` in warm-ups and athletes' expectations are set by that.
Second, the design's own record marks it `role: 'both'`, which means the design does not
actually insist on cooldown-only — production's placement is inside the design's own
allowance. This is a change with no upside and a real cost, so it should not be made.

**This is explicitly the safe choice, stated as such.** It is not deferred; it is decided.

---

## H. Device-review blockers

### H.1 Can the compression be improved? — Tested, no

The engine uses one hardcoded viewBox (`30 10 180 178`, near-square) for every movement,
with `preserveAspectRatio: xMidYMid meet`. A quadruped pose is roughly 2:1 wide; a standing
pose is roughly 1:2. One fixed frame cannot show both at the same scale.

I tested a per-movement cropped viewBox on both flagged movements, measured in the runner's
actual container (346 × 511):

| | current area used | cropped | gain |
|---|---|---|---|
| `bird_dog` | 26.7% | 29.3% | +2.6 pts |
| `hip_9090` | 31.2% | 34.2% | +3.0 pts |

**Not material.** The figure already uses 93–94% of the viewBox *width*, and width is the
binding dimension in a portrait container — cropping vertically cannot help. A real fix
means a per-movement camera or non-uniform scaling, which is exactly the "unnecessary
complexity" Part 2 rules out.

**Both therefore remain DEVICE REVIEW REQUIRED.**

### H.2 `hip_9090` — DEVICE REVIEW REQUIRED

Renders at **48% vertical frame use**. On an iPhone, confirm specifically:

- Are **both feet visibly planted** through the switch, or do they read as floating?
- Is the **knee alignment** (front shin across, back shin behind) distinguishable, or do
  the two shins merge into one shape at the halfway point?
- Does the **hip rotation** read as rotation, or as the whole figure sliding sideways?
- Does the **torso stay upright** through the transition?
- At the side-to-side switch, is it obvious which leg is which?

### H.3 `bird_dog` — DEVICE REVIEW REQUIRED

Renders at **43% vertical frame use** — the most compressed movement in the library, and
worse than the 90/90 the brief flagged.

- Is the **contralateral pairing** (left arm + right leg) readable, or do the raised limbs
  read as one diagonal line?
- Do the **planted hand and knee** stay visibly in contact with the floor?
- Is there **visual separation** between the supporting and raised limbs?
- Does the **torso stay level**, or does it appear to rock?

**If either remains hard to read on device, recommend replacement rather than forcing it
into production.** For `bird_dog`, production's `dead_bug` already covers anti-extension
core work — so there is a ready alternative and no need to ship a hard-to-read animation.

---

## I. Final recommended production mapping

**Phase 1 — renderer only (ready for D18C).** 21 movements from section B. Zero content
change, zero selection change, one-to-one ID mapping.

**Phase 2 — one identity reconciliation.** Map design `hip_hinge` → production
`hip_hinge_bw`, keeping the production ID.

**Phase 3 — content additions.** `reach_rotate`, `band_passthrough`, `hamstring_sweep`,
`deep_squat_hold`, `reverse_lunge`.

**Phase 4 — content replacements.** `cat_cow → standing_cat_cow` and
`glute_figure4 → standing_figure4`. Both approved.

**Phase 5 — held.** `chest_opener` (keep both), `calf_raise` (marginal), `hip_9090` and
`bird_dog` (device review).

**Rejected.** `march_in_place → quad_stretch`, `dead_bug → hip_hinge`.

**Retire candidate.** `spinal_twist` only.

Production ends at roughly 38 movements with the selector still showing 3–5. Architecture
unchanged.

---

## Supporting measurements

**Animation quality (Part 12).** All 34 movements sampled at 120 points across the cycle.
**No genuine snapping: nothing moves more than 25% of its own range in a single frame.**

An earlier max/median metric flagged 23 movements — that was an artifact. Stretches
deliberately hold still (median step ≈ 0.2 u), so a hold-then-transition profile produces a
huge ratio without any teleport. Measuring each step against the movement's own range
instead shows the library is smooth throughout.

**Tempo (Part 13).** Time spent effectively stationary, by category:

- Stretches hold 40–57% — correct for the category.
- `deep_squat_hold` 57% — correct, it is a hold.
- But several **dynamic mobility** movements are also largely static:
  `ankle_rock` 53%, `wall_slide` 48%, `hip_9090` 43%, `thoracic_rotation` 43%.
  Part 13 asks dynamic mobility to read as *smooth continuous motion*.

**This is an observation, not a defect.** The `rest:` field is an authored parameter and
those may be deliberate. Worth a design pass before D18C if continuous motion is wanted.

**Anatomical consistency (Part 11).** One shared figure system throughout — a single
`Figure()` and a single `customElements.define('loop-move')`, asserted in Contract 112. No
disconnected geometry found: the only two bounds violations were the shadow ellipse and the
one arc-tween dip, both addressed above.

**Data and trainer safety.** `index.html` and `sw.js` unchanged; no storage writes; no new
keys; trainer `0.1.1-shadow` untouched. Suite **4161 → 4192**.

**Not verifiable here.** `requestAnimationFrame` is suspended in this browser pane
(`document.hidden === true`, 0 frames in 800 ms), so nothing was observed in motion. Every
figure was driven through `tick()` directly. Geometry, bounds and step continuity are solid;
how the movements *look* moving — and the 90/90 and Bird Dog readability in particular —
still requires a device.

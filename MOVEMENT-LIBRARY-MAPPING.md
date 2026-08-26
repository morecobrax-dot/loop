# Movement Library — Integration Mapping (D18A)

**Status: ANALYSIS ONLY. Nothing in production was changed.**
`PREP_MOVEMENTS`, `COOLDOWN_STRETCHES`, the trainer, storage and every athlete-facing
behaviour are untouched. This document exists so the content decision can be made
separately from the rendering decision.

- **Production:** 22 `PREP_MOVEMENTS` + 13 `COOLDOWN_STRETCHES` = 35 movements, data only, no figure engine.
- **Design (`loop-movement.js`):** 34 movements with a shared animated SVG figure engine.
- **Exact ID matches: 22.** Design-only: 12. Production-only: 13.

---

## 1 · Exact matches — 22

These IDs exist in both registries. Twenty-one also agree on category; one does not.

| ID | Production registry | Category (prod → design) |
|---|---|---|
| `arm_circles` | PREP | dynamic_mobility → same |
| `world_greatest` | PREP | dynamic_mobility → same |
| `leg_swing_front` | PREP | dynamic_mobility → same |
| `leg_swing_side` | PREP | dynamic_mobility → same |
| `thoracic_rotation` | PREP | dynamic_mobility → same |
| `wall_slide` | PREP | dynamic_mobility → same |
| `ankle_rock` | PREP | dynamic_mobility → same |
| `band_pull_apart` | PREP | activation → same |
| `face_pull_light` | PREP | activation → same |
| `scap_pushup` | PREP | activation → same |
| `glute_bridge` | PREP | activation → same |
| `push_up_slow` | PREP | movement_prep → same |
| `bodyweight_squat` | PREP | movement_prep → same |
| `hip_flexor_stretch` | COOLDOWN | static_stretch → same |
| `hamstring_stretch` | COOLDOWN | static_stretch → same |
| `quad_stretch` | COOLDOWN | static_stretch → same |
| `calf_stretch` | COOLDOWN | static_stretch → same |
| `shoulder_cross_body` | COOLDOWN | static_stretch → same |
| `triceps_overhead` | COOLDOWN | static_stretch → same |
| `lat_stretch` | COOLDOWN | static_stretch → same |
| `child_pose` | COOLDOWN | decompression → same |
| **`dead_hang`** | **PREP** | **dynamic_mobility → static_stretch ⚠** |

> **`dead_hang` is the one classification disagreement.** Production treats it as prep
> mobility; the design classifies it as a cooldown stretch (`role: both`). This changes
> *when the athlete is offered it*, not how it looks. Resolve before any selection-layer
> integration; it is harmless for a renderer-only swap.

---

## 2 · Visual-only upgrades — the safe first integration

**21 movements can take the new renderer with zero content change.** Same ID, same
category, same training role. The only thing that changes is that the athlete sees an
animated figure instead of text.

All 22 exact matches above, minus `dead_hang` (hold that one until its category is settled).

**Recommendation: KEEP PRODUCTION content, REPLACE the visual renderer.**
This is the entire low-risk surface, and it is most of the library.

---

## 3 · Proposed content replacements — 5

The design engine's own header states its replacement intent. These are **explicit
authored mappings**, not similarity guesses:

```
cat_cow        → standing_cat_cow
dead_bug       → hip_hinge
glute_figure4  → standing_figure4
chest_doorway  → chest_opener
march_in_place → quad_stretch  (promoted to warm-up)
```

Two further mappings in that header — `open_book → reach_rotate` and
`thread_needle → band_passthrough` — refer to movements **that are not in LOOP
production**. They are historical, from an earlier design iteration. `reach_rotate` and
`band_passthrough` are therefore *new additions* to LOOP, not replacements.

### 3.1 `cat_cow` → `standing_cat_cow`

| | |
|---|---|
| **Current** | Cat-Cow — "On all fours. Round the back, then arch it." |
| **Proposed** | Standing Cat-Cow — "Hands on your thighs. Round your back, then arch it." |
| **Why** | Same spinal flexion/extension cycle, performed standing. |
| **Beginner** | Removes getting down and up off the floor — a real barrier in a busy gym. |
| **Advanced** | Neutral. Same segmental control, less setup. |
| **Gym practicality** | **Strong gain.** No floor space, no mat, no hygiene concern. |
| **Public comfort** | **Strong gain.** All-fours in a commercial gym is the single most avoided warm-up position. |
| **Animation quality** | Standing figure, 80%+ vertical frame use. Reads clearly. |
| **Confidence** | **High — recommend REPLACE.** |

### 3.2 `glute_figure4` → `standing_figure4`

| | |
|---|---|
| **Current** | Figure-4 Glute Stretch — "On your back, ankle over the opposite knee." |
| **Proposed** | Standing Figure-4 — "Ankle over the opposite knee, hold support, sit back gently." |
| **Why** | Same target and joint angle, upright, with support. |
| **Beginner** | Easier to enter/exit; balance support makes it accessible. |
| **Advanced** | Adds a balance demand — mild positive. |
| **Gym practicality** | **Strong gain.** Needs a rack upright or wall, not floor space. |
| **Public comfort** | **Strong gain.** |
| **Animation quality** | Standing pose, reads well. |
| **Confidence** | **High — recommend REPLACE.** |

### 3.3 `chest_doorway` → `chest_opener`

| | |
|---|---|
| **Current** | Doorway Chest Stretch — "Forearm on the frame, elbow at shoulder height." |
| **Proposed** | Chest Opener — "Clasp your hands behind your back, straighten the arms, lift the chest." |
| **Why** | Removes the doorway dependency. |
| **Beginner** | Simpler to execute; no equipment hunting. |
| **Advanced** | **Mild loss.** The doorway version gives a stronger, more targeted pec stretch at a controlled angle. The clasped version is limited by shoulder mobility. |
| **Gym practicality** | **Gain** — most gym floors have no usable doorway; racks are occupied. |
| **Public comfort** | Neutral. |
| **Animation quality** | Good — clean standing silhouette. |
| **Confidence** | **Medium — recommend REPLACE, but note the reduced stretch intensity.** Consider keeping the doorway variant as an alternate rather than deleting it. |

### 3.4 `dead_bug` → `hip_hinge`

| | |
|---|---|
| **Current** | Dead Bug — "On your back, arms up, knees at 90. Lower opposite arm and leg." (activation / trunk) |
| **Proposed** | Hip Hinge — "Hands behind your head. Push the hips back with a flat back." (movement_prep / hamstrings) |
| **Why** | The design's stated rationale is "the one pattern rehearsal the library was missing." |
| **Assessment** | **These are not the same movement and do not serve the same purpose.** Dead Bug is anti-extension core activation; Hip Hinge is a hinge-pattern rehearsal. Calling this a replacement conflates two different jobs. |
| **Confidence** | **Low as a replacement. Recommend: ADD `hip_hinge` as new; decide `dead_bug` separately.** |

> Note also that production already has **`hip_hinge_bw` ("Bodyweight Hinge")** —
> movement_prep / hamstrings, 10 reps. The design's `hip_hinge` is a **near-duplicate
> under a different ID.** If `hip_hinge` is adopted, `hip_hinge_bw` should be retired or
> the IDs reconciled — otherwise the selector can offer the same movement twice.

### 3.5 `march_in_place` → `quad_stretch` ⚠

| | |
|---|---|
| **Current** | March in Place — dynamic_mobility / general / 45s |
| **Proposed** | Quad Stretch — static_stretch / quads, "promoted to warm-up" |
| **Assessment** | **Reject as stated.** Swapping a general dynamic warm-up for a *static stretch* changes the training intent, not just the movement. Static stretching in a warm-up is a deliberate programming choice, and this mapping makes it silently. `quad_stretch` already exists in production as a cooldown movement. |
| **Confidence** | **Very low. Recommend: DO NOT USE this mapping.** Retire or keep `march_in_place` on its own merits. |

---

## 4 · New movements — 10

Genuinely new to LOOP. None has a production equivalent.

| Design ID | Name | Category | Floor? | Assessment |
|---|---|---|---|---|
| `reach_rotate` | Standing Reach & Rotate | dynamic_mobility | No | **ADD.** Standing thoracic rotation — good gym-practical complement to `thoracic_rotation` (which is on all fours). |
| `band_passthrough` | Band Pass-Through | dynamic_mobility | No | **ADD.** One band covers the full shoulder arc. Strong warm-up value. |
| `hamstring_sweep` | Hamstring Sweep | dynamic_mobility | No | **ADD.** Dynamic counterpart to the static hamstring stretch. |
| `deep_squat_hold` | Deep Squat Hold | dynamic_mobility | No | **ADD.** Covers hips, ankles and low back in one position. Efficient for a 3–5 min warm-up. |
| `calf_raise` | Calf Raise | activation | No | **ADD (low priority).** Pairs with `ankle_rock`; marginal on its own. |
| `reverse_lunge` | Reverse Lunge | movement_prep | No | **ADD.** Single-leg prep needing one step of space. |
| `hip_hinge` | Hip Hinge | movement_prep | No | **ADD — but reconcile with `hip_hinge_bw` first** (see 3.4). |
| `standing_cat_cow` | Standing Cat-Cow | dynamic_mobility | No | Replacement — see 3.1. |
| `standing_figure4` | Standing Figure-4 | static_stretch | No | Replacement — see 3.2. |
| `chest_opener` | Chest Opener | static_stretch | No | Replacement — see 3.3. |
| `bird_dog` | Bird Dog | activation | **Yes — all fours** | **HOLD.** See §7 and §5. |
| `hip_9090` | 90/90 Hip Switch | dynamic_mobility | **Yes — seated** | **DEVICE REVIEW REQUIRED.** See §7. |

---

## 5 · Floor-movement audit

Against the stated preference to avoid unnecessary floor-based warm-ups:

**Production floor movements (8):** `thoracic_rotation`, `cat_cow`, `glute_bridge`,
`ankle_rock` (half-kneeling), `dead_bug`, `hip_flexor_stretch` (half-kneeling),
`glute_figure4`, `spinal_twist`

**Design floor movements (6):** `thoracic_rotation`, `glute_bridge`, `ankle_rock`,
`hip_flexor_stretch`, **`bird_dog` (new)**, **`hip_9090` (new)**

The design removes four floor movements (`cat_cow`, `dead_bug`, `glute_figure4`,
`spinal_twist`) and **adds two new ones** (`bird_dog`, `hip_9090`).

**Net: −2.** Directionally right, but not the clean win the "standing, gym-friendly
alternatives" framing implies — two of the twelve new movements put the athlete back on
the floor, and both are among the worst-rendering (see §7).

---

## 6 · Movements to retire — decisions required

Eight production movements have **no stated design mapping**. They were dropped silently,
which is not the same as a decision to retire them.

| Production ID | Name | Note |
|---|---|---|
| `band_row` | Band Row | activation / upper_back. No design equivalent. `band_pull_apart` and `face_pull_light` overlap but are not the same pull. |
| `straight_arm_pulldown` | Straight-Arm Pulldown | activation / lats. Only lat *activation* in either registry — dropping it leaves lats with `dead_hang` and `lat_stretch` only. |
| `monster_walk` | Banded Side Walk | activation / glutes. Only frontal-plane glute work in either registry. |
| `torso_twist` | Standing Torso Twist | Overlaps `reach_rotate` / `thoracic_rotation`, but no explicit mapping was given. |
| `march_in_place` | March in Place | See 3.5 — proposed mapping rejected. |
| `dead_bug` | Dead Bug | See 3.4 — proposed mapping rejected. |
| `upper_back_round` | Upper-Back Stretch | COOLDOWN. No design equivalent. |
| `rear_delt_stretch` | Rear Shoulder Stretch | COOLDOWN. Overlaps `shoulder_cross_body`; no explicit mapping. |
| `spinal_twist` | Lying Spinal Twist | COOLDOWN, floor. No design equivalent. Retiring it aligns with §5. |
| `chest_doorway` | Doorway Chest Stretch | See 3.3. |
| `cat_cow` / `glute_figure4` | | Replacements accepted — see 3.1, 3.2. |

**None of these should be retired implicitly by adopting the design registry.** Each is a
separate call.

---

## 7 · Rendering quality — measured, not assumed

The figure engine uses a fixed 2-D camera with a shared viewBox (`30 10 180 178`). Movements
that are wide-and-low fill far less of the frame than upright ones. Measured vertical frame
usage:

| Movement | Vertical frame use | Posture |
|---|---|---|
| `wall_slide` | **93%** | standing |
| `arm_circles`, `band_pull_apart` | **80%** | standing |
| `reverse_lunge` | 64% | lunge |
| `hip_flexor_stretch`, `ankle_rock`, `world_greatest` | 60–61% | half-kneeling / lunge |
| `deep_squat_hold` | 53% | deep squat |
| **`hip_9090`** | **48%** | **seated** |
| `thoracic_rotation` | 47% | all fours |
| **`bird_dog`** | **43%** | **all fours** |
| `glute_bridge` | 32% | supine |
| **`child_pose`** | **32% — and geometry extends outside the viewBox (clipped)** | prone |

### 90/90 Hip Switch — DEVICE REVIEW REQUIRED

Confirmed. `hip_9090` renders at **48% vertical frame use** — roughly half the visual size
of a standing movement in the same frame. It technically renders; it is compressed. **Do
not mark production-ready until visually confirmed on a device.**

### Two further flags the brief did not anticipate

- **`bird_dog` at 43%** is *more* compressed than 90/90 and is also a new floor addition.
  **Flag DEVICE REVIEW REQUIRED.**
- **`child_pose` is clipped** — drawn geometry exceeds the viewBox bounds. This is an
  existing production movement, so the defect would ship with a renderer-only integration.
  **Fix before any integration.**

---

## 8 · Recommended production mapping

**Phase 1 — renderer only, no content change (safe now)**
Adopt the animated figure for the 21 clean exact matches. Production selection, IDs,
categories, durations and instructions all stay exactly as they are.
Blocked on: fixing `child_pose` clipping.

**Phase 2 — settle one classification**
Decide whether `dead_hang` is prep mobility or a cooldown stretch. Renderer-only
integration does not depend on this.

**Phase 3 — content additions (product approval)**
Add `reach_rotate`, `band_passthrough`, `hamstring_sweep`, `deep_squat_hold`,
`reverse_lunge`, and `calf_raise`. All standing, all gym-practical, none duplicating
existing production content.

**Phase 4 — content replacements (product approval, one at a time)**
`cat_cow → standing_cat_cow` (high confidence) · `glute_figure4 → standing_figure4` (high)
· `chest_doorway → chest_opener` (medium — note intensity loss).

**Phase 5 — held pending device review**
`hip_9090`, `bird_dog`.

**Rejected**
`march_in_place → quad_stretch` · `dead_bug → hip_hinge` as a *replacement*
(`hip_hinge` may still be added on its own merits, after reconciling with `hip_hinge_bw`).

**Library size:** even adopting everything recommended, production stays around 35–40
movements, with the selector continuing to show 3–5. The architecture is unchanged.

---

## 9 · What should NOT be changed

- `PREP_MOVEMENTS` and `COOLDOWN_STRETCHES` — no edits made, none recommended until the
  above is approved item by item.
- Selection logic (`buildPrepSequence`) — the design's five preset sequences are a *review
  fixture*, not a proposal to change how LOOP selects.
- The trainer (`0.1.1-shadow`), readiness, recovery, capability, XP, PRs, programs, phases,
  `workoutLog`, `trainerLog` — untouched and out of scope.
- The 34-movement design registry should **not** be adopted wholesale. It is a superset in
  some places and a subset in others; ten production movements have no design equivalent.

---

## Review-tool QA (supporting)

- **Viewports** 375×812, 390×844, 812×375, 844×390, 932×430 — no clipping of any figure
  within its box, no horizontal page overflow, phone frame fits at every size.
- **Performance** 0.12 ms per movement switch; 5.9 ms to rebuild all 34 thumbnail figures;
  27 ms DOMContentLoaded, 64 ms load. **No external libraries** — one 55 KB local script.
- **Reduced motion** honoured by the engine (`prefers-reduced-motion` → static pose), and
  the tool's Motion toggle exercises the same path.
- **Not verifiable here:** animation could not be observed. `requestAnimationFrame` is
  suspended in this browser pane (`document.hidden === true`, 0 frames in 800 ms). The tween
  logic was verified by driving `tick()` directly — four distinct poses across five ticks —
  but how the movements *look* in motion, and the 90/90 and Bird Dog compression in
  particular, require a real device.

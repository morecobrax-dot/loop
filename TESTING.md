# LOOP — Development Testing Protocol

Permanent safety net for LOOP. Run these after **any** change, before considering an update complete.

---

## Quick start

```bash
cd loop-app
npm run verify                # EVERYTHING — run before any deploy (~4s)

npm test                      # quick contracts (~0.3s)
npm run test:contract         # + trainer protection contracts (~3s)
npm run test:full             # + update-safety + performance
npm run test:trainer          # + simulation, monotonicity, sweep
```

See **TRAINER-CONTRACT.md** for what is protected and which tier to run.

Exit code `0` = pass, `1` = failure. Failures are listed at the end.

### Evaluation (Phase 5E-C)

```bash
node loop-evaluate.js synthetic                    # 16,800 seeded evaluations
node loop-evaluate.js real ./loop-backup.json      # real shadow evidence
node loop-evaluate.js both ./loop-backup.json      # both, reported separately
node loop-evaluate.js compare old.html new.html    # engine A vs engine B
LOOP_ATHLETES=250 node loop-evaluate.js synthetic  # larger sweep
```

To collect real evidence: **LOOP → Settings → Backup & Data → Export Backup**, then point
`loop-evaluate.js real` at the file. The evaluator only ever *reads* it.

Files:
- `loop-test-harness.js` — DOM stub, app loader, snapshot/diff engine
- `loop-tests.js` — regression suite
- `loop-evaluate.js` — trainer evaluation & evidence engine

**These files are development tooling. They are never deployed** — only `index.html`, `sw.js`, `manifest.webmanifest`, and the icons go to GitHub Pages.

---

## Which tier to run

| You changed… | Run |
|---|---|
| CSS, copy, layout, icons | `quick` |
| UI logic, navigation, a screen | `quick` |
| Storage, persistence, migrations, boot | `full` |
| XP, PRs, levels, achievements | `full` |
| Recovery, capability, readiness, context | `trainer` |
| The adaptive engine, replay, calibration | `trainer` |
| Anything before a deploy | `full` minimum |

When in doubt, run `trainer` — it takes about a second.

---

## The stability contract

These are the invariants the suite enforces. If a change breaks one, the change is wrong until proven otherwise.

**Core data**
- `workoutLog` is the single source of truth for training history
- Raw workout data never changes unless a workout is created, edited, or deleted
- Set types are optional; missing type means UNKNOWN, never a fabricated value

**Progression**
- XP, levels, ranks, PRs, achievements are **pure derivations** of `workoutLog` — never stored accumulators
- Recomputing any of them any number of times yields identical results
- Deleting a workout returns every derived value to its exact prior state

**Intelligence isolation**
- Readiness changes must not alter capability or recovery
- Adding training must not rewrite readiness history
- Recovery derives from training data; capability derives from exercise performance
- The shadow engine consumes all three and mutates none

**UI separation**
- Recovery, Capability, Shadow Engine, and Replay contain **zero** `document.`, `querySelector`, `getElementById`, or input assignment
- All trainer logic is callable and testable without rendering

**Shadow non-enforcement**
- A recommendation is never written into any input
- Re-opening a workout never duplicates a recommendation record

**Persistence**
- Schema changes require a migration; migrations are non-destructive, idempotent, rerunnable
- An app update preserves 100% of user data including an unfinished workout

---

## What each tier covers

### `quick` — 78 assertions
System presence, data-integrity contracts (readiness-only change touches only readiness; 25 read cycles change nothing), workout lifecycle (create/edit/delete with exact restoration), XP/PR duplication safety, intelligence isolation, cache invalidation (cold vs warm), UI/data separation, migration idempotency, shadow non-enforcement.

### `full` — adds 20
Simulated app update against a store containing 100 workouts, XP, PRs, plans, readiness history, athlete profile, and an active draft — verifying every value survives. Plus performance thresholds at 300 workouts / 1,800 sets.

### `trainer` — adds 23
Ground-truth decision scenarios, monotonicity (improving performance never yields a more conservative decision; lower readiness never strengthens progression), no-lookahead enforcement, sensitivity (one variable at a time), and a 384-evaluation combinatorial sweep across 8 seeded synthetic athletes × 8 training patterns × 3 history lengths × readiness on/off.

---

## Update workflow

1. Make the change.
2. `node --check` the extracted script (the suite does this implicitly by loading it).
3. Run the tier from the table above.
4. If anything fails: **fix the cause, not the test** — unless the test encodes a wrong expectation, in which case fix the test *and say so*.
5. Re-run.
6. Bump `CACHE_VERSION` in `sw.js`.
7. Deploy.

---

## Adding tests

When you fix a bug, add an assertion that would have caught it. That's how this suite stays valuable rather than becoming decoration.

Snapshot fields live in `SNAPSHOT_FIELDS` (harness). Add a field there and every integrity test picks it up automatically.

`diffSnapshot(before, after, allowedToChange)` is the core primitive: it distinguishes **expected** changes from **violations**, so tests express intent rather than freezing every value forever.

---

## Determinism

Synthetic athletes are generated from a seeded PRNG (`mulberry32`). The same seed always produces the same athlete, history, and readiness pattern — so a simulation failure is always reproducible.

Current seeds: `1, 7, 13, 42, 99, 123, 777, 2024`.

Simulation results are stamped with the engine version so runs stay comparable across engine changes.


---

## Evaluation rules (Phase 5E-C)

Two rules are enforced structurally, not by convention:

1. **Synthetic and real evidence are never combined.** They answer different
   questions — "is the engine logical?" vs "how does it behave with this
   athlete?" — and are reported in separate sections with separate totals.

2. **No percentage prints without n.** The `pct()` helper cannot format a
   number without a denominator, so an unsourced statistic is impossible to
   produce by accident.

**Evidence tiers** accompany every conclusion:

| Tier | Observations | Use for |
|---|---|---|
| 0 | 0 | nothing |
| 1 | 1–4 | logical contradictions only |
| 2 | 5–9 | hypotheses |
| 3 | 10–24 | weak trends |
| 4 | 25–49 | provisional conclusions |
| 5 | 50+ | tuning decisions |

**Never make a tuning decision from Tier 1–2 evidence.**

**Red flags** come in two kinds. *Contradictions* (inverted rep range,
progression at unknown confidence, a positive readiness/recovery signal) are
valid from a single observation because they are logically impossible.
*Patterns* (repeated overrides, repeated too-hard feedback) require Tier 2+
before they are reported at all.

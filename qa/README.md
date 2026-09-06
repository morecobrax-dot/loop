# TEMPORARY — delete this folder

This is **not** part of LOOP. It exists so the D52B social layer can be tested
from a real installed iPhone PWA, which needs HTTPS, and it should be removed
the moment that test is done.

```bash
git rm -r qa && git commit -m "chore: remove temporary D52B QA build" && git push
```

Nothing else has to be undone. Production `index.html`, `sw.js` and
`manifest.webmanifest` were never touched to create this.

---

## What it is

`https://morecobrax-dot.github.io/loop/qa/` — a copy of the working-tree
`index.html` with three changes, and copies of `sw.js` and the manifest with
two more. Everything else is byte-identical, so the auth and Friends screens
under test are exactly the ones that would ship.

### index.html — 3 changes

| Change | Why |
|---|---|
| `LOOP_SOCIAL` filled in | Points at the real Supabase project, with the **browser-safe publishable key**. No secret or `service_role` credential exists in this folder. |
| `PREFIX` → `loopqa_` | **Storage isolation.** See below — this is the important one. |
| `<title>` → LOOP QA | So a browser tab is never mistaken for the real app. |

### sw.js — 2 changes

| Change | Why |
|---|---|
| `CACHE_VERSION` → `loop-qa-v1` | Its own cache namespace. |
| activate cleanup scoped to `loop-qa-` | **Protects the production app.** The shipped handler deletes every cache that is not its own, and Cache Storage is per *origin*. Installed beside the real LOOP, this worker would have deleted `loop-v127` the first time it activated, leaving the production app with no offline shell — which, in a basement with no signal, is the app failing to open. It now cleans up only after itself. |

### manifest — renamed, amber splash

`LOOP QA` on the home screen instead of `LOOP`, and `#BD9260` instead of
`#0A0C10`, so an accidental launch is obvious before a single tap.

---

## Storage isolation, and why it was necessary

`localStorage` is scoped to an **origin**, not a path. `\/loop\/` and
`\/loop\/qa\/` are the same origin, so without this change the QA build would
have opened, read and written the real training history on the phone.

Changing the key prefix makes that impossible rather than merely unlikely.
Verified physically, not assumed: with `loop_workoutLog` holding a canary
value, the QA build read `null`, wrote to `loopqa_workoutLog`, and left the
canary byte-identical.

**The consequence, which matters when using it:** the QA build starts with an
empty training log and 0 XP. That is correct and expected. It is a different
app as far as the phone is concerned.

**Do not log real workouts here.** They go into a separate keyspace and
disappear when this folder does.

---

## What this build does NOT mean

- Social is **not** shipped. Production `index.html` still has an empty
  `LOOP_SOCIAL` and still renders no Friends entry at all.
- No release was cut. `CACHE_VERSION` in the production `sw.js` is untouched
  at `loop-v127`, and no What's New entry was written.
- The D52B source changes are still uncommitted in the working tree. This
  folder is a snapshot for testing, not the release.

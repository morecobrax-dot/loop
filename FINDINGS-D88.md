# D88 — findings carried forward

Everything below was found during the D88 stabilization audit of LOOP 8.9,
reproduced, and then **deliberately not fixed in 9.0**. Each one is either a
product decision, a change to semantics D88 was told to protect, or a refactor
whose blast radius is wider than a stabilization pass should be.

Anything D88 *did* fix is in the 9.0 commit and held by Contract 189; it is not
repeated here.

Confidence is stated the way the audit stated it: **PROVEN** means the exact
inputs and the wrong output were both produced; **HIGH** means the code path is
certain but the end-to-end trigger was reasoned rather than executed.

---

## E1 — Program weeks are numbered from two different anchors · P1 · **CLOSED in D89 (LOOP 9.1)**

> **Closed.** One origin (`programWeekMonday`), two named quantities:
> `programCalendarWeek` for WHERE a date sits in the layout, and
> `getCurrentProgramWeek` for HOW FAR the athlete has got. Identical whenever
> nothing has been banked by a pause. The fulfilment matcher, the progress
> ratio, the planned-slot set and the end date all count from that one origin
> now. See TRAINER-CONTRACT.md §111 and Contract 190. The original analysis is
> kept below because it is what the fix was measured against.


`getCurrentProgramWeek` (`index.html`, "week counted from the START DATE")
counts weeks from the program's start date. `programDateFor` /
`programPlannedSlots` lay the slot grid out from the **Monday of** that start
date. `assignWorkoutsToPlannedSlots` then compares one against the other
(`weekOf(w.date) === slot.week`), and `getProgramProgress` puts both on the same
card: `completedSessions` from the Monday-anchored grid, `plannedSessions` from
the start-anchored count.

For a program started on a Monday the two agree. For any other start day they do
not.

**Reproducer A.** Build a program with *Start today* on a Wednesday
(start `2026-03-04`, 8 weeks, Mon/Wed/Fri). Train the three week-1 sessions and
the following Monday. The program card renders **"4 of 3 planned sessions
logged"**. The identical program started on a Monday reads "4 of 6".

**Reproducer B.** Same program. The Monday session is trained one day late on
Tuesday — inside `PLAN_SHIFT_DAYS = 2`. The planned session is reported
unfulfilled and the training counted as *additional*, purely because of the
start weekday. `programEndDate` is also two days past the last planned slot.

**Why it was not fixed here.** Choosing an anchor changes what "week 2" means
for programs athletes are training right now, and D88 was told Program history
semantics are a protected baseline. Adherence, the progress card and the block
layer all read these numbers. This needs a decision about which anchor is
canonical and, if it is the Monday grid, a migration story for in-flight
programs — a phase of its own, not a stabilization fix.

---

## E2 — Every program mutation reports success before its write can land · P1 · **CLOSED in D89 (LOOP 9.1)**

> **Closed.** `commitProgramChange` snapshots the store, applies the change,
> AWAITS the write, and restores the snapshot whole if the store refused it. All
> eight mutators are async and every caller — app and suites — awaits them. See
> TRAINER-CONTRACT.md §111 and Contract 190. Original analysis below.


`createProgram`, `updateProgram`, `setActiveProgram`, `pauseProgram`,
`resumeProgram`, `completeProgram`, the draft save/clear pair and the block
rebuild are all **synchronous** functions that call an **async**
`persistPrograms()` without awaiting it, then `return { ok:true, … }` in the
same tick. The returned `ok` is structurally incapable of describing the write.

**Symptom.** Finish the program builder on a device whose store refuses the
write: the builder reports success, switches you onto the new program, and Today
starts prescribing from it. On the next launch the program does not exist and
Today silently reverts to the plan schedule. The same applies to pausing,
completing and deleting.

**Why it was not fixed here.** The honest fix makes all eight mutators async and
updates every caller, including the builder's step machine and the block-action
sheet. That is a signature change across the program layer. D88 fixed the same
class of bug where it was one line (`persistLog`, `deleteLog`, `backupAllData`);
this one is a refactor.

---

## E3 — The service worker is network-first with no timeout · P1 · HIGH

`sw.js` answers every same-origin GET, including the navigation for
`index.html`, with a bare `fetch(req)`. There is no `AbortController`, no race
against `caches.match`, and no navigation preload. The cache is consulted only
once `fetch` **rejects**.

On a dead network `fetch` rejects immediately and this is fine. On *lie-fi* — a
connected-but-useless signal, which is exactly what the file header names as its
reason to exist — `fetch` does not reject; it hangs until the browser's own
timeout. The launch overlay's 6-second failsafe then lifts onto an app that has
not received its HTML.

**Why it was not fixed here.** Cache-first-then-revalidate, or a ~2s race, fixes
it — but both change the update story, which is the reason network-first was
chosen. That is a deliberate trade to make with the owner, not to flip during a
stabilization pass. D88 fixed the two SW defects that had no trade-off: a failed
install no longer activates, and the app-shell fallback no longer answers
non-navigation requests.

---

## E4 — There is no service-worker update detection at all · P2 · PROVEN

The entire page-side service-worker code is a `register('sw.js')` call. Count of
`registration.waiting`, `registration.installing`, `updatefound`,
`controllerchange`, `serviceWorker.controller`, `getRegistration` and `.update()`
across `index.html`: **zero**.

With `skipWaiting()` on install and `clients.claim()` on activate, a version
deployed while the app is open activates and claims the running page, but the
page keeps executing the **old** `index.html` until the user fully closes and
relaunches. On an installed iOS PWA that can be days. The What's New dot is baked
into that same old HTML, so it stays silent for the same period.

The upside, and the reason this is P2 rather than P1: there is correspondingly
no reload loop, because there is no reload.

---

## E5 — Date-dependent caches are not keyed by day and never roll over · P2 · HIGH

`_programProgressCache` and the plan-fulfilment cache deliberately put `today`
in their key. Five siblings that are just as date-dependent do not:
`_consistencyCache`, `_recoveryCache`, `_capabilityCache`, `_contextCache` and
`_cardioCache`. The mastery caches inherit it through `getExerciseCapability`.
There is no midnight, rollover or resume handler anywhere — the only
`visibilitychange` listeners flush the draft and the cardio watcher.

**Symptom.** Leave LOOP open (the normal state for an installed PWA) from Sunday
23:50 to Monday 00:10 and open Progress. `computeWeeklyVolume` is uncached and
rolls over to the new week; `computeConsistencyData` still returns Sunday's
`thisMonday`. Two panels on the same tab disagree, and today's square still reads
as `future`. Same shape for "last trained N days ago".

Nothing is persisted — every value is derived — so this reads to the athlete as
"it didn't update".

---

## E6 — `computePRs` latches a loaded lift to bodyweight, permanently · P2 · PROVEN

```js
const isBW = ex.bodyweight || isNaN(w);
if(!map[key]){ map[key] = { …, isBW, … }; return; }
if(map[key].isBW !== isBW) return;
```

`isNaN(w)` is used to **reclassify** rather than to reject. The logger stores a
set when *either* field is filled, so a set with reps and a blank weight is real
data. If that is the earliest set seen for a loaded lift, the map is seeded
`isBW: true` and every weighted set afterwards is discarded forever.

**Reproducer.** Log Bench Press (bodyweight unchecked) with set 1 = reps 10,
weight blank; set 2 = 135×8. Then 145×8 and 155×6 in later sessions.
`computePRs` returns `{isBW:true, weight:null, reps:10}`; the control returns
`{isBW:false, weight:155}`. `computeExercisePREvents` — the *other* PR engine —
reads `ex.bodyweight` directly and disagrees permanently.

**Why it was not fixed here.** The PR definition is a protected baseline, and
the correct repair is a judgement about what a blank weight *means* (a
bodyweight set? an unrecorded load? a typo?), which changes which PRs exist.
Blast radius today is narrow — the only caller is
`buildProgressionRecommendation`, so the visible effect is a coach line that
never appears rather than a wrong number — but the return value is objectively
wrong and a second consumer would inherit it.

---

## E7 — Four sites still divide milliseconds by 86400000 · P3 · PROVEN

`daysBetweenDates` is the corrected helper — both ends at local midnight,
`Math.round`. These four take a time-of-day-bearing `now` and `Math.floor`:

| site | what it feeds |
|---|---|
| Train card `daysAgo` | "Last done Nd ago" |
| `computeExerciseCapability.daysSinceLast` | the `stale` capability state |
| `_contextCache` per-muscle `lastTrained` | muscle freshness |
| `progressCoverage.weeksTracked` | how long Progress says it has tracked |

In America/New_York: a session done 3 days ago reads **"Last done 4d ago"** to
anyone opening the app after 23:00 between November and March, and a two-day-old
session reads "yesterday" just after midnight between March and November.
`daysSinceLast` crosses `CAPABILITY_CONFIG.staleDays` a day early or late by the
same mechanism.

The recovery decay site has the same one-hour skew but is unfloored and feeds an
exponential, so it stays below display precision — not a defect.

---

## E8 — Import accepts an older schema and never migrates it · P2 · PROVEN by inspection

`importAllData` handles `payload.schemaVersion > DATA_SCHEMA_VERSION` and
returns. An *older* schema is written straight into storage; the reload then runs
`runMigrations`, which reads `SCHEMA_KEY` — already current on this device, and
deliberately excluded from the gap-fill loop. Migrations never run on the
imported data.

Entirely latent while `DATA_SCHEMA_VERSION === 1` and `MIGRATIONS` is empty. It
arms itself the moment the first migration is added, which is exactly when
nobody will be looking at the importer.

---

## E9 — Supabase policy notes · P2 · for owner-applied SQL

All 8 tables have RLS enabled, no policy uses `USING (true)` or
`WITH CHECK (true)` on user data, no `SECURITY DEFINER` function is executable
by `anon`, and all 18 pin `search_path` and gate on `auth.uid()`. The three
policy-less tables are intentionally function-only with grants revoked. Invite
*link* tokens are sound: 244 bits, SHA-256 at rest, expiry and use caps.

Four things worth a later pass, none exploitable as shipped:

1. `profiles_select` grants the whole row, so `invite_code` is readable by any
   friend **and by anyone you have sent a request to**.
2. Migration `0001` revokes from `anon` but not from `authenticated` / `public`,
   leaving Supabase's default `GRANT ALL` latent. Later migrations use the
   correct pattern.
3. 8-character invite codes come from non-CSPRNG `random()` over a **31**-character
   alphabet — about 2^39.6, not the 2^40 the comment claims.
4. `loop_are_friends` and `loop_request_between` are unscoped two-UUID oracles.

These are server-side and owner-applied; a client release cannot change them.

---

## E10 — A pause is banked in days, but the grid is pinned to weekdays · P2 · **CLOSED in D90 (LOOP 9.2), forward only**

> **Closed for pauses recorded from D90 on.** A pause is now a SPAN of civil
> dates on the program record, and a planned opportunity inside one did not
> exist: not due, not missed, not fulfillable, not in any denominator. The grid
> keeps its weekdays and simply runs longer, until the number of opportunities
> the program originally asked for has existed.
>
> **The historical boundary is real and is not papered over.** Before D90 a
> resume nulled `pausedOnDate` and only added to a running `pausedDays` total,
> so for any pause already resumed the start is destroyed, the end was never
> written, and the total cannot be decomposed. Those programs are NOT repaired
> and NOT guessed at — a program with no `pauses` array behaves exactly as it
> did before, including the old end-date rule.
>
> Also fixed while auditing: completing a paused program used to leave
> `pausedOnDate` set for ever and bank none of its days, and three Program
> Detail handlers never awaited the async mutators despite §111 claiming every
> caller did. See TRAINER-CONTRACT.md §112 and Contract 191. Original analysis
> below.


Found while closing E1, and deliberately left alone rather than folded into it.

`pausedDays` is an integer count of days. It is subtracted by the athlete's week
counter and added to the program's end date, and **ignored by the slot grid** —
`programDateFor` has no `pausedDays` term and cannot sensibly have one, because
shifting a weekday-pinned schedule by an arbitrary number of days lands Monday's
session on a Thursday.

So a program paused for two weeks keeps its slots on their original calendar
dates. Those two weeks of opportunities sit in the past, unfulfilled, while the
athlete's counter correctly says they are still in the week they left. Adherence
is charged for sessions that were never trainable.

D89 made both sides of the *matcher* pause-blind, which fixed the separate and
worse defect where the shift window stopped working entirely from the third week
of any paused program. It did not change what a pause means, and the contracted
rule that paused time is not training time is untouched.

Fixing this properly is a schedule-model decision, not a chronology one — either
pauses are banked in whole weeks, or the grid gains a notion of suspended spans.
Both change what a program *is*, which is why it is written down here instead.

---

## Not findings — checked and clean

Recorded so a later pass does not re-litigate them.

- **Secrets.** All 61 tracked files swept. Zero JWTs, zero private keys, zero
  bearer literals. One key literal exists and it is the browser-safe publishable
  key. Every `service_role` hit is prose in docs or an assertion guarding against
  exactly this.
- **Dangerous sinks.** Zero `eval`, `new Function`, `document.write`, `outerHTML =`,
  `srcdoc`, and zero string-argument `setTimeout`/`setInterval` in `index.html`
  and `sw.js`. Three `insertAdjacentHTML` calls, all on registry-canonical ids.
- **URL handling.** The address bar is read in exactly one place, for `?invite`.
  It is stripped via `history.replaceState` immediately and gated by anchored
  allowlists. No `location.hash` read anywhere.
- **Network.** Exactly one `fetch` in the app, to the hardcoded Supabase host.
  No user data reaches any third party.
- **Storage key coverage.** All 36 `LOOPStore.set` sites enumerated; all 22
  distinct keys accounted for. No user-data key is missed by export.
- **Unguarded `JSON.parse`.** All 45 sites checked. Every parse of stored or
  imported data is inside a try/catch. The gap was shape validation, which 9.0
  fixed — not missing try/catch.
- **Double-tap on save.** `saveLog` disables its button and tears down rows
  synchronously; `saveWorkoutEdits` and `saveActivity` use busy flags.
- **Event listener leaks.** 38 `addEventListener` sites; every attach on a
  repeated path is idempotent behind a dataset or module flag.
- **Scoring maths.** `deriveSessionExecution` executed against zero working sets,
  an `rx` with no sets, an unparseable rep string, no RIR anywhere, a skipped
  exercise and bodyweight-at-0. No `NaN`, `Infinity` or `-0` reaches a score.
- **Comparators.** All end in a deterministic tie-break; no in-place sort on a
  shared cached reference.
- **Cache invalidation on mutation.** Every `workoutLog` write reaches
  `invalidateSortedLogCache` and its cascade; all eight program mutators call
  `invalidateProgramCache`. The only gap is the *time* dimension — E5.
- **Version gate.** `hasUnreadUpdate` is strict id equality and updates sort by
  real `Date`. No string-version comparison, so `loop-v9 > loop-v166` cannot
  occur.
- **Boot is network-independent.** Boot completes with no `fetch` global at all.
- **Layout.** 80 views at 320/375/390/430 across every tab and every overlay with
  a zero-argument opener: no page-level horizontal overflow, no duplicate runtime
  element ids, no console errors, no sub-32px tap targets.

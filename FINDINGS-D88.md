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

## E3 — The service worker is network-first with no timeout · P1 · HIGH · **CLOSED in D92 (LOOP 9.4)**

> **Closed, and it was worse than recorded here.** Real lie-fi stalls every
> host, not only LOOP's. The web fonts were `@import`ed inside LOOP's own
> stylesheet, so the page waited on fonts.googleapis.com before it painted or
> ran a line of script: with the shell served from cache on time, LOOP still sat
> at `readyState: 'loading'` for as long as that host stayed silent.
>
> The app shell is still network-first — a good connection still delivers a
> fresh deploy — but with a **2.5-second deadline over the whole body** (`fetch`
> resolves at headers, and the shell is 2.7 MB, 732 KB gzipped). Measured on
> the real worker path, the shell arrives whole in 1.5 s at 4 Mbps and 2.0 s at
> 3 Mbps, so a connection an athlete would call working beats the deadline.
> Past it, the copy this version keeps opens, and a network copy that arrives
> whole later refreshes it. Only a complete 2xx is ever kept: 9.3 kept a single
> 503 as its offline copy and then opened offline as "failure 503". Every other
> same-origin file comes from this version's cache first. The fonts load beside
> the app and switch themselves on when they arrive. On 9.3 a stalled
> connection never opened LOOP within 20 s; 9.4 opens it at the deadline with
> every host stalled. See TRAINER-CONTRACT.md §114 and Contract 193. Original
> analysis below.


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

## E4 — There is no service-worker update detection at all · P2 · PROVEN · **CLOSED in D92 (LOOP 9.4)**

> **Closed.** Reproduced on 9.3 first: a deploy while LOOP was open installed,
> skipped waiting, claimed the running page and deleted its cache, and nothing
> told the athlete — the page stayed on the old build until a relaunch. Now a
> new version installs and WAITS. The page learns of it from the lifecycle
> itself (`registration.waiting` and `.installing`, `updatefound` then
> `installed`, and `registration.update()` on a return to the foreground at
> most every 15 minutes and hourly while open) and shows "LOOP update ready" as
> a row of the tab bar — never on a first install, never over a sheet, so never
> over a workout. Update is the athlete's tap: the waiting worker is told to
> take over and the page reloads exactly once, on `controllerchange`, with the
> workout draft written first. A waiting worker that is already this page's own
> build is adopted quietly. See TRAINER-CONTRACT.md §114 and Contract 193.
> Original analysis below.


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

## E5 — Date-dependent caches are not keyed by day and never roll over · P2 · HIGH · **CLOSED in D93 (LOOP 9.5)**

> **Closed, and there were ten caches, not five.** Reproduced on 9.4 in eight
> zones with LOOP left open from Sunday 23:58 to Monday 00:02 and nothing
> written: 8 of 11 day-sensitive readings were still Sunday's. Beyond the five
> named below, Muscle Mastery (summed from exercise points that include
> capability confidence), the shadow trainer, the swap ranking, the cardio XP
> streak — and the plan-fulfilment memo, which this entry wrongly lists as
> already keyed by today: an unended pause runs to today, so a paused program's
> slots moved every midnight under a key that never did. Every one now keeps the
> local civil day it was worked out on and checks it at each read
> (`currentDayKey`, or `trainerDayKey` where the engine reads the backtest-aware
> clock), so a new day, a moved clock or a new timezone simply misses. And LOOP
> notices the day itself: on returning to the foreground, and at the next local
> midnight while it stays on screen, it redraws the tabs — never an open sheet.
> Same-day renders are unchanged. See TRAINER-CONTRACT.md §115 and Contract 194.
> Original analysis below.


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

## E6 — `computePRs` latches a loaded lift to bodyweight, permanently · P2 · **CLOSED in D91 (LOOP 9.3)**

> **Closed, and it was wider than recorded here.** LOOP answered "is this lift
> loaded or bodyweight?" in four places, each its own way: `computePRs` (the
> first stored SET, blank ⇒ bodyweight), `computeExercisePREvents` and
> `computeXPTimeline` (the earliest session's box), `renderExDetail` (the
> latest session's). The root cause is a sentinel collision: `saveLog` writes
> `'BW'` for a bodyweight row and `''` for a blank loaded row, and both parse
> to `NaN`.
>
> One rule now, `deriveExercisePRMode`, computed once per log for every lift
> (`prModesByLift`) and read by all four through `prModeOf`. A lift is what its
> EARLIEST DECLARING session said — the rule the event and XP engines already
> used — where a tick (or `'BW'`) declares bodyweight, a load above zero on an
> unticked row declares loaded, and blank, zero or unreadable weights declare
> nothing. With no declaration anywhere: the registry's bodyweight flag, then
> zeros keep a lift loaded as they always did, then UNKNOWN, with no PR invented.
>
> Measured against 9.2 on 400 generated histories in which every lift's first
> session declares its kind: records, the timeline, Mastery's record count, XP
> and levels are byte-identical. Every change elsewhere traces to 9.2 taking a
> lift's kind from a session that declared nothing, or from storage order
> between same-day sessions. `computePRs` named a different record from the
> event engine in 860 of 2,000 lifts on 9.2 — ties credited by storage order
> among them — and in 0 now. See TRAINER-CONTRACT.md §113 and Contract 192.
> What D91 found and deliberately left is E11–E16 below. Original analysis below.


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

## E7 — Four sites still divide milliseconds by 86400000 · P3 · PROVEN · **CLOSED in D93 (LOOP 9.5)**

> **Closed, and there were nine.** All four below, plus the XP history's
> TODAY / YESTERDAY label, the weekly volume comparison's day of the week, the
> cardio streak's week gap (whole only because rounding absorbed the spans its
> UTC week keys made), and two that no athlete reaches — the Recent PR card and
> the plan-phase carousel, whose renderers are never called. Reproduced wrong on
> 9.4 at both clock changes in every DST zone of the matrix, Lord Howe's
> 30-minute ones included. Every calendar count now goes through
> `daysBetweenDates`, which counts civil date boundaries (`civilDayNumber`)
> instead of rounding elapsed time; cardio weeks are local civil Mondays, proven
> to keep every session in the same week and every streak identical. Recovery's
> decay stays elapsed time on purpose, as this entry judged. The symptom quoted
> below happens only across a clock change (the span must contain one), not all
> winter. See TRAINER-CONTRACT.md §115 and Contract 194. Original analysis below.


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

## E8 — Import accepts an older schema and never migrates it · P2 · PROVEN by inspection · **CLOSED in D94 (LOOP 9.6)**

> **Closed, and it was wider.** Reproduced on 9.5 by running it, not only by
> reading: schema 0, a missing `schemaVersion`, `null`, `"1"`, `"NaN"`, -1,
> 0.5 and `true` were all imported as current, with "Import complete". Beside
> it on the same build: a write the store refused was ignored, so a full phone
> took part of a backup and LOOP said "Import complete"; a failed import's undo
> left behind keys the import had created while saying nothing was lost; values
> were written without checking their type; and workouts whose id was
> `__proto__` or `constructor` were dropped by the merge. No LOOP ever wrote
> a backup older than schema 1, so there was no migration to add and none was
> invented: the file's own version now decides the path, a missing or
> unrecognised one is refused, a pure migration chain stands ready (empty) for
> the first real step, and the import is all or nothing — a verified safety
> copy, every write checked and read back, and an undo judged by reading the
> store. See TRAINER-CONTRACT.md §116 and Contract 195. Original analysis below.

`importAllData` handles `payload.schemaVersion > DATA_SCHEMA_VERSION` and
returns. An *older* schema is written straight into storage; the reload then runs
`runMigrations`, which reads `SCHEMA_KEY` — already current on this device, and
deliberately excluded from the gap-fill loop. Migrations never run on the
imported data.

Entirely latent while `DATA_SCHEMA_VERSION === 1` and `MIGRATIONS` is empty. It
arms itself the moment the first migration is added, which is exactly when
nobody will be looking at the importer.

---

## E9 — Supabase policy notes · P2 · **CLOSED in D95 (production migration 0005, applied 2026-09-20)**

> **Closed: the database itself now says no.** The owner applied
> `supabase/migrations/0005_e9_security_closure.sql` as committed on 2026-09-20,
> and it was verified live the same day. From outside, with nothing but the
> publishable key: `invite_code_misses` answers 401 `42501` where it answered
> 404 `PGRST205` before, so the migration is live and PostgREST has re-read the
> schema; all nine tables and all twenty functions the client calls still answer
> an anonymous caller `42501`. From inside, the four catalog queries returned
> the marker `csprng-v1`, `profiles_select` as `(user_id = auth.uid())`, exactly
> five tables holding anything for `authenticated` (profiles SELECT;
> social_stats and social_weekly INSERT,SELECT,UPDATE; friend_requests and
> friendships DELETE,SELECT — no TRUNCATE, REFERENCES or TRIGGER anywhere), and
> `loop_request_between`, `loop_touch_updated_at` and `loop_profiles_guard` all
> non-executable. Those four answers were checked against the committed
> migration statement by statement, and reproduced exactly on a real PostgreSQL
> carrying the same chain; the pre-0005 chain produces different answers (the
> wide policy, and TRUNCATE still held), so they are distinctive of 0005.
> Behaviour behind the door — every attack run as the athlete who would make it
> — is proven by `supabase/tests/e9-security.js` (168 checks: invite-code
> capability 17, privileges 41, codes 22, oracles 16, definer safety 10, invite
> links 15, friendships 11, weekly 10, shared workouts 14, anonymous 10) and by
> LOOP 10.0's own client driven against the same chain (528 checks). No client
> release was needed. **Known limitation:** 0005's new `rate_limited` status is
> unknown to the 10.0 client, which shows its generic "That did not send." A
> signed-in probe was not run against the live project, because that would mean
> creating a production account; the authenticated boundary is evidenced by
> production's own catalog state plus the real-PostgreSQL replica above.
> D95 also found the notes were slightly short: a friend could
> read `invite_code` because `profiles_select` allowed it, `authenticated` also
> held `TRUNCATE` (which bypasses row level security) on four tables, an athlete
> could insert a profile with a chosen `invite_code` (a code-existence oracle),
> and `loop_are_friends` / `loop_request_between` answered for any two UUIDs.
> Contract 198 and `supabase/tests/e9-security.js` hold the result.

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

## E11 — Within a lift's kind, the XP engine and the records count different sessions · P3 · PROVEN

Found in D91. The event engine — records, the timeline, the summary's New
Records — counts reps from EVERY session of a bodyweight lift, including a
weighted one and a row saved unticked with no weight (the history editor adds
rows that way, with no bodyweight toggle). The XP engine counts only sessions
whose box matches the lift's kind. So such a session can show a record on the
workout summary with no XP line beside it.

Pre-existing: 259 of 2,000 lifts across 400 ordinary generated histories on both
9.2 and 9.3. In histories where 9.2 took a lift's kind from a session that
declared nothing, 342 → 451 on 9.3, because those lifts now have records at all.

**Why it was not fixed in D91.** D91 made the XP engine take the lift's KIND from
the shared rule; which sessions count within it is untouched. Aligning the two
was tried and measured: it moved lifetime XP in 83 of 400 ordinary histories and
levels in 3. XP is Rank's input, which D91 was told not to touch. It needs a
decision on which rule is right — most likely "a session that declares nothing
counts toward the lift's own kind in both" — and then its own phase.

The same phase should give the XP engine's `prTrackers` a null prototype, as D91
gave the PR engines' maps: keyed by what athletes type, a lift named
"constructor" or "__proto__" finds an inherited value there and never earns PR
XP. (On 9.2 `computePRs` dropped those names too; it no longer does.)

## E12 — The Log's PR marks judge each session inside its own box · P3 · PROVEN

Found in D91. `getSessionPRs` / `wasSessionPR` — the Log calendar's PR dot, a
day's "N new records", the Recent list's chip, the Day Detail callout and the
consistency view's `'pr'` day — compare a session's heaviest weight (most reps if
ticked) only with earlier sessions with the SAME box, and know nothing of
reps-at-weight, 1RM or volume records. For a lift that changes kind (bodyweight
dips, then weighted) they mark sessions the records never call PRs; for a rep PR
at an unchanged load they mark nothing. They never read a blank weight as
bodyweight and do not depend on storage order, so E6 itself does not occur here.

**Why it was not fixed in D91.** Their count feeds `computeWorkoutQuality`
(Session Score) and the D44 consistency view, both protected in D91. Moving them
onto the shared mode and the event engine is a Session Score / D44 decision.

## E13 — Case variants of one name are counted twice by `computeAllPREvents` · P3 · PROVEN

Found by the D91 mapping. Every PR engine groups by the trimmed, lower-cased
name, but `getAllLoggedExerciseNames` lists raw spellings. So "Bench Press" and
"bench press" both call `computeExercisePREvents`, and each returns the SAME
events: counts double on the Records card, All records, Volume's Records cell and
Mastery's record count, and the lift appears twice among Personal Best Timeline
candidates. Separately, one canonical exercise spelled two ways in LOOP's own
plans ("Barbell Bench Press" / "Bench Press") splits PR history — that one is
contracted (Contract 172, §95: records are read by the name logged).

**Why it was not fixed in D91.** De-duplicating changes Mastery scoring, which
D91 was told not to touch, and the name-versus-identity question is the
exercise-identity phase D91 was told not to open.

## E14 — "1e999" or "Infinity" typed as a weight is read as an infinite load outside the PR engines · P3 · PROVEN

The weight field is text, and `parseFloat` turns both into `Infinity`. On 9.2 that
produced "Weight PR: Infinity lb", +15 XP, an "Infinity lb" timeline hero and a
broken Exercise Detail chart; D91 made every PR engine, the timeline and
Exercise Detail refuse it. The Training Load card still reads it through weekly
volume and prints "+Infinity% vs the first half of this window", and other
volume and trainer code reads the same value.

**Why it was not fixed in D91.** The root repair is validating the field when a
set is saved — a logging change, not a PR one.

## E15 — Two value details still differ between PR surfaces · P4 · PROVEN

Found by the D91 mapping; D91 changed WHICH kind applies, not these values.
(a) Every PR engine reads only the FIRST row of a name in a workout, so a lift
typed twice in one workout never counts its second row toward a record. On 9.2
`computePRs` alone read both and could name a record the rest ignored; D91
aligned it for agreement. Whether a mid-exercise split can produce this in the
UI was not reproduced. (b) Exercise Detail's "Best ever" counts a heaviest set
logged with no reps, carrying the reps shown from another set; the event engine
needs reps beside a load before it is a record.

**Why it was not fixed in D91.** Both change what a session's best IS — PR
definitions D91 was told not to recalibrate.

## E16 — The trainer's capability model still reads the latest session's box · P4 · HIGH

`computeExerciseCapability` classifies a lift from `sessions[0].bodyweight`, the
newest session. It names no record and is not a PR surface, but it is a fifth
answer to the same question. The trainer is 0.1.1-shadow and was protected in
D91; a later trainer phase should read `prModeOf`.

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
  *D92 correction: true of the script, not of the page. The harness never
  parses CSS, and in a real browser the web fonts, imported inside LOOP's own
  stylesheet, held the first paint and every script until fonts.googleapis.com
  answered. Fixed in 9.4 (E3); Contract 193 holds it.*
- **Layout.** 80 views at 320/375/390/430 across every tab and every overlay with
  a zero-argument opener: no page-level horizontal overflow, no duplicate runtime
  element ids, no console errors, no sub-32px tap targets.

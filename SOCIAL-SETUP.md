# LOOP — social setup (D52 / D52B / D80A)

Friends and the private leaderboard need a backend. The code is shipped and
tested; the project is not created, because credentials cannot be invented.

**Until the two values in step 4 are filled in, LOOP has no social layer at
all** — no Friends entry in Settings, no network call, no behaviour change of
any kind. That is the shipped default and it is safe to deploy as-is.

Everything below is about fifteen minutes.

---

## What this adds, and what it does not

Crosses the network: a **username**, your **friendships**, the **XP, level
and rank you already earned**, and — since D80A — for each week you publish,
that week's **weekly XP** and **workout count** (strength workouts plus cardio
sessions, counted by LOOP's own XP timelines, under the Monday of the week they
were logged in). Invite links add one more thing the server holds but nobody can
read: a SHA-256 hash of each link's token, who made it, and when it expires.

Never crosses it: workouts, exercises, loads, reps, RIR, bodyweight, readiness,
programs, notes, PRs, settings — and your **email**, which belongs to
authentication and is never visible to a friend.

Signing in adds identity. It does not move your training anywhere.

---

## 1. Create the project

1. <https://supabase.com> → **New project**.
2. Any name. Choose the region closest to you — it decides leaderboard latency.
3. Save the database password somewhere. It is the project's admin password
   and has nothing to do with the passwords athletes sign in with — LOOP never
   uses it.

## 2. Apply the schema

The whole backend is two checked-in files, applied in order:

1. `supabase/migrations/0001_social_foundation.sql` — profiles, stats,
   requests, friendships (D52)
2. `supabase/migrations/0002_friends_links_and_weeks.sql` — invite links, the
   weekly leaderboard, and the one-query Friends screen (D80A)

Either:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

or open **SQL Editor → New query**, paste the file, and run it.

0001 creates four tables, enables row level security on every one of them, and
installs the functions that are the only way to create a friend request or a
friendship. 0002 adds `friend_invites` (row level security on, **no policy at
all** — only its functions reach it) and `social_weekly` (readable by the
athlete and accepted friends, writable only by its owner), and the functions
`loop_create_invite_link`, `loop_preview_invite_link`,
`loop_accept_invite_link`, `loop_revoke_invite_links` and
`loop_friends_hub`. Both files are safe to run again. Nothing in either is
optional.

### Applying 0002 to a project that already runs 0001

Open **SQL Editor → New query**, paste `0002_friends_links_and_weeks.sql`, run
it. Nothing else changes and no data moves.

Until it is applied, the shipped app still works: it detects the missing
functions and falls back to 0001 — invite links carry the invite **code**,
adding someone sends a request they accept, and the leaderboard ranks **total
XP** and says so. Once it is applied, the next time anyone opens Friends they
get links that connect in one tap and the weekly leaderboard.

To check from outside, with nothing but the publishable key (no account):

```bash
curl -s -X POST "https://<ref>.supabase.co/rest/v1/rpc/loop_friends_hub" \
  -H "apikey: <publishable key>" -H "Content-Type: application/json" \
  -d '{"p_week":"2026-09-14"}'
```

- `{"code":"PGRST202",...}` (404) — 0002 is **not** applied yet.
- `{"code":"42501",...,"message":"permission denied for function loop_friends_hub"}`
  (401) — 0002 **is** applied, and anonymous callers are refused, as they must be.

## 3. Turn on email and password

**Authentication → Providers → Email**

- **Enable email provider** — on
- **Confirm email** — on

That is the whole configuration. Nothing else on this page needs changing, and
no email template needs editing — Supabase's default confirmation email is
what LOOP uses.

**Authentication → URL Configuration** → set **Site URL** to
`https://morecobrax-dot.github.io/loop/`. This is where the confirmation link
sends the athlete after they click it.

### Why a password rather than an emailed code

A password costs **one email, ever** — the confirmation, at signup. A code
flow costs one on **every sign-in**, and Supabase's built-in mailer sends only
a handful an hour, so the athlete who reinstalls the app, or the second person
on a shared phone, hits a wall that looks exactly like the app being broken.

The confirmation link opens in a browser rather than in the installed PWA, and
that is fine here in a way it would not be for a magic link. Supabase does
append tokens to the page it redirects to — that is its normal behaviour —
but **LOOP does not read them.** Reading a session out of a redirect is
exactly the magic-link failure: the session ends up in Safari and the
installed app cannot see it. What the trip accomplishes is the confirmation.
The athlete then returns to LOOP and signs in with what they already know, so
nothing depends on a session surviving that trip.

**No custom domain and no SMTP provider are required.** The built-in mailer is
sufficient for one confirmation per account.

## 4. Point LOOP at it

In `index.html`, find:

```js
const LOOP_SOCIAL = {
  url: '',
  anonKey: ''
};
```

Fill in **Project Settings → API**:

- `url` — the Project URL, `https://<ref>.supabase.co`
- `anonKey` — the **browser-safe publishable key**

Supabase has two generations of browser key and either works here, because
both are sent as the `apikey` header and neither authorises anything on its
own:

- newer projects: **Publishable key**, `sb_publishable_…`
- older projects: **anon / public**, a JWT beginning `eyJ…`

**Never the secret key** — `sb_secret_…` on newer projects, `service_role` on
older ones. Both bypass row level security completely, and anything in
`index.html` is public. The field is called `anonKey` for continuity; what
belongs in it is whichever browser-safe key the project exposes.

Bump `CACHE_VERSION` in `sw.js`, commit, push.

---

## 5. Check it before trusting it

**Two accounts, on two devices or two browser profiles.** A social system
cannot be verified from one account — half of what matters is what the *other*
person can and cannot see.

1. Alice creates an account, clicks the confirmation email, signs in, takes a
   username, and sees herself alone on the weekly leaderboard.
2. Bob does the same.
3. Alice taps **Invite friend** and sends Bob the link. Bob opens it, sees
   "@alice invited you to connect on LOOP", and taps **Add friend**. Both
   Friends screens now show both athletes, and the weekly leaderboard is in the
   same order on both phones.
4. Alice opens her own link: LOOP says it is her own. Alice taps **Reset link**;
   Bob opening the old link is told it was reset.
5. Alice removes Bob (open Bob → ••• → Remove friend → Remove). Both lists
   drop back to one.

Then the part that matters more:

6. **Bob cannot see Alice's email.** In the SQL editor, run
   `select * from auth.users;` — that table has no client policy, and nothing
   in LOOP reads it.
7. **Bob cannot write Alice's stats.** With Bob signed in, from the browser
   console:
   ```js
   fetch(LOOP_SOCIAL.url + '/rest/v1/social_stats', {
     method: 'POST',
     headers: { apikey: LOOP_SOCIAL.anonKey,
                Authorization: 'Bearer ' + socialState.session.access_token,
                'Content-Type': 'application/json' },
     body: JSON.stringify({ user_id: '<alice-uuid>', lifetime_xp: 999999 })
   }).then(r => r.status)
   ```
   This must return **401 or 403**. If it returns 201, row level security did
   not apply and you must not use the project until it does.
8. **A stranger sees nothing.** With no friendship between them, Bob querying
   `/rest/v1/profiles?user_id=eq.<alice-uuid>` must return `[]`.

Two for D80A:

- **Bob cannot write Alice's week.** Same console call as step 7, to
  `/rest/v1/social_weekly` with body
  `{ "user_id": "<alice-uuid>", "week_start": "<a Monday>", "weekly_xp": 99999 }`.
  It must return **401 or 403**.
- **Signing out is local.** Signed in as Alice on two devices, sign out on one.
  The other stays signed in — including after an hour, when its token renews.

Two more, specific to a password:

9. **An unconfirmed account cannot sign in.** Create one and try before
   clicking the link. LOOP must say to confirm first, and must not produce a
   session — an unconfirmed address is not an identity.
10. **A wrong password is refused and says nothing more.** The message must not
    reveal whether the address has an account.

## 6. On the actual phone

Install LOOP to the home screen and create the account **from the installed
app**, not from Safari. Check that:

- the confirmation email arrives, and that clicking it — in whatever browser
  iOS chooses — is enough to make the following sign-in work;
- iOS offers to save the password, and offers it back on the sign-in screen;
- focusing a field does **not** zoom the page;
- the session is still there after force-quitting and reopening — and after
  an hour away, and after finishing a workout with poor signal;
- an invite link tapped on the phone opens in Safari, not the installed app
  (iOS does not hand links to home-screen apps). Either accept it there, or
  copy the link and use **Have an invite link? Paste it** inside the app.

---

## Removing an account

`select public.loop_delete_account();` while signed in as that user removes the
profile, the stats, the requests and the friendships — and, through their
foreign keys, the weekly rows and invite links. It cannot touch anything
on a phone: the training lives there, not here.

## Optional, later: a branded confirmation email

**Not required.** LOOP works exactly as described above on the built-in mailer,
with no domain and no third-party service. Skip this section unless one of the
two reasons below actually applies.

The default confirmation email comes from a Supabase address and says Supabase
on it. If LOOP ever has enough athletes that signups outpace the built-in
mailer's hourly allowance, or the email looking like someone else's product
starts to matter, add an SMTP provider under **Project Settings → Auth → SMTP**
and edit **Authentication → Email Templates → Confirm signup**.

That needs a domain you control, because a sending provider has to verify one.
Nothing in LOOP changes: the client does not know or care which mailer sent
the message.

## What this is not

The leaderboard is **not cheat-proof**, and it is not pretending to be. LOOP's
XP is computed on the device from workouts the athlete logged themselves, so a
determined person could publish a number they did not earn. Making it
tamper-proof would mean uploading workout history and recomputing XP on a
server — which is the local-first architecture this phase exists to preserve.

For a private leaderboard between people who train together, that trade is the
right way round. It is worth knowing before it is ever described as a ranking.
The weekly numbers are the same kind of claim: computed on the athlete's own
phone, bounded by the database to sane values, and not proof.

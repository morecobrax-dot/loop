# LOOP — social setup (D52)

Friends and the private leaderboard need a backend. The code is shipped and
tested; the project is not created, because credentials cannot be invented.

**Until the two values in step 4 are filled in, LOOP has no social layer at
all** — no Friends entry in Settings, no network call, no behaviour change of
any kind. That is the shipped default and it is safe to deploy as-is.

Everything below is about fifteen minutes.

---

## What this adds, and what it does not

Crosses the network: a **username**, your **friendships**, and the **XP, level
and rank you already earned**.

Never crosses it: workouts, exercises, loads, reps, RIR, bodyweight, readiness,
programs, notes, PRs, settings — and your **email**, which belongs to
authentication and is never visible to a friend.

Signing in adds identity. It does not move your training anywhere.

---

## 1. Create the project

1. <https://supabase.com> → **New project**.
2. Any name. Choose the region closest to you — it decides leaderboard latency.
3. Save the database password somewhere; you will not need it for LOOP.

## 2. Apply the schema

The whole backend is one checked-in file:
`supabase/migrations/0001_social_foundation.sql`

Either:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

or open **SQL Editor → New query**, paste the file, and run it.

It creates four tables, enables row level security on every one of them, and
installs the functions that are the only way to create a friend request or a
friendship. Nothing in it is optional.

## 3. Turn on email codes, and turn off links

**Authentication → Providers → Email**

- **Enable email provider** — on
- **Confirm email** — on
- **Enable email OTP** — on

**Authentication → Email Templates → Magic Link**

The default template sends a clickable link. LOOP asks for a **code**, because
a link has to leave the installed PWA, open Safari, and come back — which on
iOS leaves the athlete signed in to a browser the app cannot see. Change the
template body to send the token instead:

```html
<h2>Your LOOP sign-in code</h2>
<p>{{ .Token }}</p>
<p>This code expires in an hour. If you did not ask for it, ignore this email.</p>
```

**Authentication → URL Configuration** → set **Site URL** to
`https://morecobrax-dot.github.io/loop/`.

> Supabase's built-in mail service is rate-limited and meant for development.
> For real use, add an SMTP provider under **Project Settings → Auth → SMTP**,
> or codes will stop arriving under load.

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
- `anonKey` — the **anon / public** key

**Use the anon key. Never the `service_role` key** — that one bypasses row
level security completely, and anything in `index.html` is public.

Bump `CACHE_VERSION` in `sw.js`, commit, push.

---

## 5. Check it before trusting it

**Two accounts, on two devices or two browser profiles.** A social system
cannot be verified from one account — half of what matters is what the *other*
person can and cannot see.

1. Alice signs in, takes a username, and sees herself alone on the leaderboard.
2. Bob signs in, takes a username.
3. Alice copies her invite code to Bob. Bob enters it.
4. Alice accepts. Both leaderboards show both athletes, in the same order.
5. Alice removes Bob. Both lists drop back to one.

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

## 6. On the actual phone

Install LOOP to the home screen and sign in **from the installed app**, not
from Safari. Check that the code arrives, that entering it signs you in, and
that the session is still there after force-quitting and reopening.

---

## Removing an account

`select public.loop_delete_account();` while signed in as that user removes the
profile, the stats, the requests and the friendships. It cannot touch anything
on a phone: the training lives there, not here.

## What this is not

The leaderboard is **not cheat-proof**, and it is not pretending to be. LOOP's
XP is computed on the device from workouts the athlete logged themselves, so a
determined person could publish a number they did not earn. Making it
tamper-proof would mean uploading workout history and recomputing XP on a
server — which is the local-first architecture this phase exists to preserve.

For a private leaderboard between people who train together, that trade is the
right way round. It is worth knowing before it is ever described as a ranking.

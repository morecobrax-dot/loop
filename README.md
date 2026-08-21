# LOOP — Deploy to GitHub Pages

One-time setup, then LOOP lives at a permanent URL on your iPhone Home Screen.

---

## Part 1 — Put it on GitHub (one time, ~5 minutes)

1. Go to **github.com** and sign in (create a free account if you don't have one).

2. Click the **+** in the top right → **New repository**.

3. Name it exactly:
   ```
   loop
   ```
   Set it to **Public**. Leave everything else alone. Click **Create repository**.

4. On the next page click **uploading an existing file**.

5. Drag in **all five files** from this folder:
   - `index.html`
   - `manifest.webmanifest`
   - `sw.js`
   - `icon-192.png`
   - `icon-512.png`

6. Click **Commit changes**.

7. Go to the **Settings** tab of the repo → **Pages** in the left sidebar.

8. Under **Branch**, choose **main**, folder **/ (root)**, click **Save**.

9. Wait about a minute, then refresh. GitHub will show your live URL:
   ```
   https://YOURUSERNAME.github.io/loop/
   ```

That URL is permanent. It never changes.

---

## Part 2 — Add to your iPhone Home Screen

1. Open that URL **in Safari** (must be Safari, not Chrome).
2. Tap the **Share** button (square with the up arrow).
3. Scroll down → **Add to Home Screen**.
4. Tap **Add**.

LOOP now launches fullscreen from an icon, with no browser bars. It works offline
after the first load, so a gym basement with no signal is fine.

---

## Part 3 — Moving existing data over (only if you need it)

If you already have workout history in the claude.ai version:

1. Open the **claude.ai** version → gear icon → **Export Backup**. Save the file.
2. Open your **new GitHub Pages** version → gear icon → **Import Backup**.
3. Pick the file.

Import **merges** — it never overwrites. Re-importing the same file does nothing.

---

## Updating LOOP later

When you get a new version:

1. Go to your repo on GitHub.
2. Click `index.html` → the **pencil** icon → select all → paste the new version → **Commit**.
   (Or delete it and re-upload the new file.)
3. **Also update `sw.js`**: change `CACHE_VERSION = 'loop-v1'` to `'loop-v2'`, then `'loop-v3'`, etc.
   This is what tells phones to grab the new code instead of the cached copy.

**Your workout data is untouched by any of this.** It lives in your browser's
storage, keyed to the URL — not inside `index.html`. Replacing the app code
cannot delete your history, PRs, XP, or an unfinished workout.

---

## Troubleshooting

**"404 — not found"** — Pages takes a minute after first setup. Wait and refresh.

**Icon didn't appear / app opens in a browser tab** — Make sure you used Safari,
and that `manifest.webmanifest` and both icon PNGs uploaded alongside `index.html`.

**Update didn't show up** — You forgot to bump `CACHE_VERSION` in `sw.js`. Bump it
and commit. If it's still stubborn: delete the Home Screen icon and re-add it.
Your data survives that — it's tied to the URL, not the icon.

**Wiped data?** — Only two things can do it: tapping *Reset All Data* in Settings,
or clearing Safari website data for the site. Export a backup now and then if you
want a safety net you control.

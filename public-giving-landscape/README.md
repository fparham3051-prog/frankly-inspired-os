# The public Giving Landscape page

Built after the ethics/legal research in `safest-path-decision-memo.md` (delivered alongside this bundle) — read that first for the reasoning. This README is about what's in this specific bundle.

## What changed

- **`schema.sql`** — one new column, `gifts.public_ok`, defaulting to `false`.
- **`server.js`** —
  - `POST /api/gifts/:id/public` (authenticated): flips `public_ok` for one gift.
  - `GET /api/public/giving-landscape` (no login required): returns only gifts with `public_ok = true`, and only a fixed whitelist of columns (donor, org, state, category, amount, headline, summary, source, url, announced date). It never selects `gift_type`, `restriction`, `impact`, `trend_signal`, or `playbook` — your own case-study analysis of a gift — and has no code path into the 990 (`org_financials`/`org_ein_links`) tables at all.
  - New static routes for `/giving-landscape` and its script, both intentionally outside `requireAuth`.
  - Basic rate limiting on `/api/login` (8 attempts per 15 minutes per IP) — the login endpoint had none before, and with a single shared password it's the entire attack surface. Added `app.set("trust proxy", 1)` so that limiting is keyed on the real visitor IP behind Render's proxy, not the proxy's own address.
- **`public/app.js` / `public/styles.css`** — every gift card on the (authenticated) Giving Landscape ticker now has an "Add to public page" / "On public page" toggle button next to Remove.
- **`public/giving-landscape-public.html` / `public/giving-landscape-public.js`** — new, unauthenticated. A small standalone page (its own script, never loads the authenticated `app.js`) that fetches the public endpoint and renders the feed with source links and a short methodology note.

## Why gift-level opt-in, not a global switch

Even though the underlying premise (only publicly-announced gifts get logged at all) makes this low-risk in general, individual judgment calls still apply — a source article could be disputed, a gift could be under an embargo you didn't know about, or you might simply not want everything you've ever logged surfaced at once. Gift-by-gift means you're never surprised by what's on the page.

## What I verified

- The public page renders correctly in light, dark, mobile, and empty states, with mocked data standing in for the real API (screenshots below) — this was checked as a static page against a mocked `fetch`, not against your live Postgres.
- The toggle button on the internal ticker: clicking it sends `POST /api/gifts/<id>/public` with the correct id and body, and the button visually flips from "Add to public page" to "On public page" once the (mocked) request succeeds, in both themes.
- `node --check` on `server.js` and `app.js`.

## What I did not verify

Same standing limitation as every prior delivery in this engagement: I can't run this against your live Postgres or a live deploy from here. Once this is live, worth a quick pass of: log in, flip one real gift's toggle on, open `/giving-landscape` in an incognito window, confirm it shows only what you expect and nothing else — then flip it back off and confirm it disappears.

## Screenshots

- `publicgiving-light.png` / `publicgiving-dark.png` — the public page with two sample gifts, both themes.
- `publicgiving-empty.png` — before anything's been marked public.
- `publicgiving-mobile.png` — 400px width.
- `toggle-light-1-before.png` / `toggle-light-2-after.png` / `toggle-dark-2-after.png` — the internal ticker's new button, before and after a click.

## Apply it

```
cd frankly-inspired-os
git apply public-giving-landscape.patch
git add public/app.js public/styles.css public/giving-landscape-public.html public/giving-landscape-public.js schema.sql server.js
git commit -m "Add an opt-in, no-login public Giving Landscape page"
git push origin main
```

The schema change is additive and idempotent (`ADD COLUMN IF NOT EXISTS`), applied automatically on next boot the same way every prior schema change in this app has been — no manual migration step.

## Not in this bundle

The single-tenant-vs-productization question — see the memo for why that's deliberately not built yet, and what the real first step would be if you decide to go that way.

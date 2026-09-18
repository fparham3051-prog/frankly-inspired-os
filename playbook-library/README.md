# Playbook Library

The last of today's three "move forward with the suggestions" items — flag-as-prospect and the Prospecting 990 lookup shipped earlier today; this is #3.

## What it is

A new "Playbook Library" view under Reference. Every gift on the Giving Landscape ticker can already carry a case-study read — impact, trend signal, replication idea, gift type, restriction — but the only way to see it was opening that one gift's disclosure on the ticker. This view pulls every gift that has any of those fields filled in into one place, with:

- A search box matching across org, donor, headline, and all five case-study fields.
- The same category filter chips the ticker already uses.
- Each match shown with its case-study fields always visible (no click-to-expand — browsing them is the point of this view).

It's entirely client-side: no new API route, no schema change, just a new way of looking at data already in `state.gifts`. It's also deliberately unreachable from the public Giving Landscape page — this is exactly the analysis layer that page is built to leave out.

## What I verified

Light, dark, and mobile (400px), plus: the search box narrowing correctly, a category filter narrowing correctly (and showing "Nothing matches this search or filter" when nothing does), and the empty state (no gift has any case-study field yet) with guidance on how to populate it. `node --check` on `app.js`.

## Files

- `playbook-library.patch` — the change (`public/app.js`, `public/index.html`, `public/styles.css`), on top of the previous commit.
- `app.js`, `index.html`, `styles.css` — full files.
- `playbook-light-1-all.png` / `playbook-dark-1-all.png` — the full view, both themes.
- `playbook-light-2-search.png` — searching "facility tour," narrowed to one match.
- `playbook-light-3-category.png` — a category filter applied.
- `playbook-empty.png` — before any gift has a case-study field filled in.
- `playbook-mobile.png` — 400px width.

## Apply it

```
cd frankly-inspired-os
git apply playbook-library.patch
git add public/app.js public/index.html public/styles.css
git commit -m "Add a searchable Playbook Library view"
git push origin main
```

## Where things stand now

All three suggestions from the original analysis are built: flag-as-prospect, the Prospecting 990 lookup, and this. Also shipped today: the app-wide design rollout, the opt-in public Giving Landscape page (with the safest-path research behind it), login rate limiting, and a `.gitignore` for the pre-migration backup file. The full current app is in the other zip I sent — this bundle is just today's newest piece, isolated for review.

Still waiting on your call, not built: the single-tenant-vs-productization question, and anything closer to "public 990 flags" than what's already live.

# Architecture

How the LCKDIN Study Hub system fits together, what trusts what, and where to look when
something breaks.

## Three parts

```text
Guest / staff phone            Vercel (static)                Google
┌──────────────────┐      ┌──────────────────────┐      ┌─────────────────────────┐
│ index.html       │ ───> │ lckdin-hub.vercel.app│      │ Apps Script web app     │
│ staff.html       │      │  HTML/ only          │ ───> │ doGet / doPost          │
│ app.js staff.js  │      │  no secrets, no data │      │        │                │
└──────────────────┘      └──────────────────────┘      │        v                │
                                                        │ Google Sheet (database) │
                                                        └─────────────────────────┘
```

- **Front end** — plain HTML/CSS/JS, no build step, no framework. Vercel project
  `lckdin-hub`, Root Directory `HTML`. It holds no data; every screen is rendered from
  a JSON reply.
- **Backend** — one Apps Script project bound to the LCKDIN Google Sheet. Source lives in
  `backend/`. It is the only thing allowed to touch the sheet.
- **Database** — the Google Sheet itself. Day tabs hold visits, Visit Log holds closed
  visits, plus Shifts, Passes, Tags, Settings and summary tabs.

## Request flow

| Action | Called from | What the backend does |
|---|---|---|
| `config` | booking page, staff page | Returns rooms, rates, staff names (cached 5 min) |
| `visit` | booking, tap, admin | Creates or updates a visit row |
| `tap` | NFC link `?t=TOKEN` | Looks up the card, then checks in/out/extends |
| `checkPin` | admin dashboard | Verifies the shared admin PIN |
| `staffStatus` / `staffClock` / `staffPin` | staff page | Duty list and clock in/out |
| `dashboard` | admin dashboard | Aggregates sales, visitors, staff, passes |

All replies are JSON with `version` first. Failed actions return
`{ ok: false, error, version }`; the backend also logs
`Action <name> failed: <message>` to **Executions** so a failure can be traced by action
name instead of guessing.

## Trust boundaries

1. **Browser is untrusted.** Every value is re-checked in Apps Script: name/category
   length, date format and range (−1 to +365 days), `HH:MM` times, guest lines, purpose.
   The front end's checks are only for friendly messages.
2. **PINs are the only identity.** Admin PIN lives in Script Properties (`ADMIN_PIN`);
   staff PINs live in Settings column H. Wrong guesses are throttled per key — 10 tries
   per 10 minutes for admin, 6 for a staff name — and the counter survives a correct PIN
   until the window expires.
3. **NFC token is the card's credential.** Anyone holding the link can tap that card.
   Treat printed cards like keys; delete a row in Tags/Passes to revoke.
4. **The sheet is the database, and it is shared.** Whoever can open the sheet can read
   every PIN and edit every visit. Keep sharing restricted to the owner and trusted
   staff; the script's row protections stop accidents, not people with edit access.
5. **The front end is static and public.** Never place a secret, real PIN, or private key
   in `HTML/`. Anything there is downloadable.

## Security controls in place

- **CSP** (see `HTML/vercel.json`): scripts only from the site itself, styles from the
  site plus Google Fonts, network calls only to `script.google.com` and
  `script.googleusercontent.com`.
- `X-Frame-Options: DENY` + `frame-ancestors 'none'` — no embedding in another site.
- `X-Content-Type-Options: nosniff`, strict referrer policy, camera/mic/geolocation off.
- HTML is never cached (`max-age=0, must-revalidate`); versioned assets are cached for a
  year and busted by changing `?v=`.
- No inline `<script>` or `onclick=` anywhere, so the CSP can stay strict.
- Dashboard output is HTML-escaped with `esc()` before insertion.

## Versioning and why it matters for support

Three independent version markers:

| Marker | Where | Meaning |
|---|---|---|
| `APP_VERSION` (e.g. `v108`) | `backend/Config.gs`, returned in every reply | Backend build |
| `WEB_VERSION` (e.g. `2026-11-14.2`) | `HTML/app.js`, `HTML/staff.js` | Front-end build |
| `?v=` query on CSS/JS/images | `HTML/*.html` | Cache-bust for that asset |

Both pages log one line to the browser console on load:

```text
LCKDIN web 2026-11-14.2 · server v108
```

If that says `server unknown`, the browser is talking to an old deployment or the wrong
URL. Bump `?v=` whenever a CSS/JS file changes, otherwise returning visitors keep the old
file for a year.

## Repo layout

```text
LCKDIN-HUB/
├── HTML/                 deployed to Vercel (Root Directory)
│   ├── index.html style.css app.js      booking, tap, admin
│   ├── staff.html staff.css staff.js    staff clock in/out
│   ├── vercel.json                      headers and caching
│   └── logo-* gcash-qr-*                optimized images
├── backend/              Apps Script source (pushed with clasp)
├── docs/                 this file and RUNBOOK.md
├── assets-src/           original oversized images, not deployed
└── README.md             day-to-day guide
```

# Runbook

Short, repeatable steps for deploying, checking, and fixing the LCKDIN Study Hub.
For how the parts fit together, see [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Before you change anything

1. Note what you are about to change (front end, back end, or both).
2. Make sure the live site and the repo agree — open the booking page, F12, and read the
   console line `LCKDIN web … · server …`.
3. Know how to roll back (section 6). Both parts roll back in under a minute.

## 2. Front-end deploy (Vercel)

1. Commit and push to `main` (`klasikfades/LCKDIN-HUB`).
2. Vercel builds the `HTML` folder; wait for **Ready** in the Vercel dashboard.
3. Open https://lckdin-hub.vercel.app/ with **Ctrl+F5**.
4. Check the console line shows the new `WEB_VERSION`.

Every changed CSS/JS/image needs its `?v=` query bumped in the HTML that loads it, or
returning visitors will keep the old file for a year.

## 3. Backend deploy (Apps Script)

From `backend/`:

```bash
clasp push -f                          # upload code
clasp deploy -i <DEPLOYMENT_ID> -d "v108 …"   # promote to the live URL
```

Promoting changes the live booking system for real customers. Do it only with the owner's
explicit OK, and only outside peak hours.

The `<DEPLOYMENT_ID>` is the `AKfycb...` part of `API_URL` in `HTML/app.js` and
`HTML/staff.js`. After deploying, `?action=config` must return `"version":"v108"` (or the
version you just set). If it still says `unknown`, the deployment did not promote.

## 4. Post-deploy check (2 minutes)

| Check | Expected |
|---|---|
| Booking page loads rooms | Room dropdown filled, Open time selected |
| Console line | Web and server versions match what you deployed |
| Save a test booking | Row appears on the day tab with status `Booked` |
| Tap a card (`?t=TOKEN`) | Check-in screen appears, check-out computes a bill |
| `staff.html` | Names listed, PIN clock in/out works, one-on-duty rule holds |
| `?admin=1` + admin PIN | Dashboard totals load; wrong PIN twice still allowed, correct PIN works |
| Headers | `curl -sI https://lckdin-hub.vercel.app/` shows `Content-Security-Policy` and `X-Frame-Options: DENY` |

Delete the test booking row afterwards (or leave it with a clear name like "TEST") so it
does not pollute sales.

## 5. Common failures and where to look

| Symptom | First look | Then |
|---|---|---|
| Page blank or unstyled | F12 console | A blocked request means a missing/renamed file or a CSP mistake in `vercel.json` |
| "Cannot reach the server" | Open `API_URL` in a tab | No JSON → deployment access is not "Anyone" or the deployment is gone |
| "Unknown action" | Reply's `version` | Backend is an older deployment; redeploy |
| "Too many wrong PINs" | Apps Script Executions | Someone guessed repeatedly. Wait 10 minutes; there is no manual unlock. Clear only if you control the cache window — it expires on its own |
| Booking rejected with a field error | Apps Script `Action visit failed: …` | The browser sent something the server rejected; check the field named in the message |
| Dashboard totals stale | Visit Log | Run `syncAllDays` from the Apps Script editor |
| Staff list empty | Settings column B | Blank rows in the middle of the name range break the list |
| Clock in says still on duty | Shifts tab | Fill the missing Clock Out, then retry |
| Everything slow or timing out | Vercel deployment list | Free-tier cold start; retry. Persistent → check Apps Script quota in Executions |
| Works on desktop, not phone | Hard refresh phone | Old cached `?v=` asset |

## 6. Rollback

**Front end:** Vercel → project `lckdin-hub` → Deployments → previous deployment → **…
→ Promote to Production**. Takes seconds.

**Backend:** Apps Script → **Deploy → Manage deployments → Edit** → choose the previous
version → **Deploy**. The URL and deployment ID stay the same, so the front end keeps
working.

If the sheet data itself is wrong, fix rows by hand, then run `syncAllDays` to rebuild the
Visit Log. Take a sheet copy (**File → Make a copy**) before any bulk repair.

## 7. Secrets and access

| Secret | Where | Rotation |
|---|---|---|
| Admin PIN | Script Properties `ADMIN_PIN` | Run `setAdminPin` (resets to `0000`), then set a real value |
| Staff PINs | Settings column H (plain text) | Edit the cell; takes effect on next check |
| clasp login token | `~/.clasprc.json` on the owner's PC | `clasp login` again |
| NFC card links | Tags / Passes tabs | Delete the row to revoke a card |

Never commit `.clasprc.json`, and never paste a PIN into `HTML/` — that folder is public.

## 8. Useful editor functions

Run from the Apps Script editor, in the function dropdown:

`clearConfigCache` · `setAdminPin` · `setDefaultStaffPins` · `hideStaffPins` ·
`syncAllDays` · `buildShiftSummary` · `buildPassSales` · `backfillPersonnel` ·
`protectAllDayTabs`

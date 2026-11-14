# Backend source (Google Apps Script)

This folder is the **source of truth** for the LCKDIN backend. The live copy runs in the
Apps Script editor; this folder is what gets pushed to it.

| File | Responsibility |
|---|---|
| `Config.gs` | Constants, `APP_VERSION`, spreadsheet helpers, Settings reader, pricing |
| `Api.gs` | Single entry point `doGet` / `doPost`, action routing, error logging |
| `Visits.gs` | Booking, tap in/out, check-out, input validation |
| `Sheets.gs` | Day tabs, Visit Log, summaries, protections |
| `Staff.gs` | Staff clock in/out, admin and staff PIN checks, PIN throttling |
| `Dashboard.gs` | `getDashboard` totals and lists |
| `appsscript.json` | Manifest: V8 runtime, Asia/Manila, web app runs as deployer, access "anyone" |

## Pushing changes

These commands are for the local terminal, with `clasp` logged in as the owner account.
Run them from this folder.

```bash
clasp push -f                 # uploads code to the Apps Script project (not live yet)
clasp deploy -i <DEPLOYMENT>  # promotes a new version to the live /exec URL
```

The deployment ID is the long `AKfycb...` string in `API_URL` at the top of
`HTML/app.js` and `HTML/staff.js`. Promoting to production changes the live site for
real customers, so it is done only with the owner's explicit go-ahead.

Never commit `.clasprc.json` (it contains the clasp login token).

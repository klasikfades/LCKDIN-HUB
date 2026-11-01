# LCKDIN Study Hub

Booking, NFC tap in/out, staff clock in/out, and admin dashboard for LCKDIN Study Hub.

- **Front end:** static files in the `HTML` folder, hosted on Vercel
- **Back end:** Google Apps Script attached to the LCKDIN Study Hub Google Sheet

---

## Live links

| Page | Link |
|---|---|
| Booking | https://lckdin-hub.vercel.app/ |
| Tap in/out (NFC) | https://lckdin-hub.vercel.app/?t=TOKEN |
| Admin dashboard | https://lckdin-hub.vercel.app/?admin=1 |
| Staff clock in/out | https://lckdin-hub.vercel.app/staff.html |

---


## Project structure

```text
HTML/
├── index.html            Booking, tap in/out, and admin dashboard
├── style.css             Styles for index.html
├── app.js                Logic for index.html
├── staff.html            Staff clock in/out page
├── staff.css             Styles for staff.html
├── staff.js              Logic for staff.html
├── logo-mark.png.jpg
├── logo-wordmark.png.jpg
├── gcash-qr.png.jpg
└── README.md
```


---

## File guide

| File | Purpose | Edit it when |
|---|---|---|
| `index.html` | Page layout for booking, tap, and admin. Markup only. | You want to add, remove, or move a section or button. |
| `style.css` | All styles for `index.html`. | You want to change how a page looks. |
| `app.js` | Logic for `index.html`: booking, tap in/out, admin PIN, charts. | You want to change how booking, check-in, or the dashboard behaves. |
| `staff.html` | Layout for the staff clock in/out page. | You want to change the staff page text or layout. |
| `staff.css` | Styles for `staff.html`. | You want to change the staff page look. |
| `staff.js` | Logic for `staff.html`: staff list, clock in/out, one-person-on-duty rule. | You want to change how clocking in or out works. |
| `logo-mark.png.jpg` | Round logo badge. | You have a new logo. Use a transparent background. |
| `logo-wordmark.png.jpg` | "LCKDIN STUDY HUB" wordmark. | You have a new wordmark. |
| `gcash-qr.png.jpg` | GCash QR code on the payment step. | Your QR changes. Keep it square, at least 400 px. |
| `README.md` | This file. | Keep it current after every change. |

---

## Key settings

| Setting | Where | Notes |
|---|---|---|
| Apps Script URL (`API_URL`) | Top of `app.js` and `staff.js` | Change only if you create a new deployment. |
| Admin PIN | Apps Script, Project Settings > Script Properties, key `ADMIN_PIN` | Takes effect immediately. |
| Staff PINs | Settings tab, column H | Plain text, keep leading zeros. Default `0000`. |
| Staff names | Settings tab, column B (rows 2 to 26) | Up to 25 staff. |
| Rooms, rates, limits | Settings tab, columns D to G | Pass prices are in column E. |
| Page titles | `<title>` in `index.html` and `document.title` in `app.js` | Booking: "LCKDIN Bookings". Admin: "LCKDIN Admin". |

---

## Making an edit

1. Open the file on GitHub (repository `LCKDIN-HUB`, folder `HTML`).
2. Click the pencil icon, make the change, and check the first and last lines.
3. Click **Commit changes**.
4. Wait for Vercel to show **Ready**.
5. Hard refresh with **Ctrl+F5** (or **Cmd+Shift+R** on Mac).

**Back-end changes** are made in the Apps Script editor. Then go to **Deploy > Manage deployments > Edit > New version > Deploy**.

---

## Important reminders

- Do not paste `<style>` or `<script>` tags into `style.css`, `app.js`, `staff.css`, or `staff.js`.
- Keep file names exact. `index.html` links to `style.css` and `app.js`. `staff.html` links to `staff.css` and `staff.js`.
- Keep the images beside the HTML.
- Deploy a new version of the Apps Script after any back-end change.
- Only one person can be on duty at a time. Fix a forgotten clock-out in the **Shifts** tab.
- The admin PIN is shared. Change it if it leaks.
- Staff PINs live in the Settings sheet. Share the sheet only with your team.
- Test after every change: booking, a tap link, `?admin=1`, and `staff.html`.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Page is unstyled | Check `style.css` and `staff.css` names. Hard refresh. |
| Buttons do nothing | Open F12 > Console and read the first red error. |
| "Cannot reach the server" | Set Who has access to **Anyone**, deploy a new version, check `API_URL`. |
| "Unknown action" | Deploy a new version of the Apps Script. |
| "Wrong PIN" | Check Settings column H (staff) or Script Properties `ADMIN_PIN` (admin). |
| Personnel column blank | Pick the name from the dropdown, or run `backfillPersonnel`. |
| Images broken | Upload the image beside `index.html` with the exact name. |
| Old title or design showing | Hard refresh with Ctrl+F5. |

---

## Back end (Apps Script)

Split into six files: **Config**, **Api**, **Visits**, **Sheets**, **Staff**, and **Dashboard**.

Run manually from the editor when needed: `setAdminPin`, `setDefaultStaffPins`, `hideStaffPins`, `buildShiftSummary`, `buildPassSales`, `backfillPersonnel`, `protectAllDayTabs`.

---

## Links

- **Repository:** https://github.com/klasikfades/LCKDIN-HUB
- **Spreadsheet:** LCKDIN Study Hub (Google Sheets)
- **Hosting:** Vercel, project `lckdin-hub`

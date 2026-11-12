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
## How the system works

### The big picture

Three parts work together:

1. **The web pages** (`index.html`, `staff.html`) run in the browser and are hosted on Vercel. They hold no data.
2. **The Apps Script** (the back end) receives every request from the pages, reads and writes the Google Sheet, and sends back JSON.
3. **The Google Sheet** is the database. Every visit, shift, pass, and setting lives there.

No data is stored on the web pages. Refreshing a page only reloads what the Apps Script sends back.

### Booking a visit (website)

1. A guest opens the booking page and fills in name, date, room, people, time in, duration, purpose, and payment option.
2. The page checks the room's people limit, then shows a billing summary.
3. The guest continues to the payment step and scans the GCash QR code.
4. **Save booking** sends the visit to the Apps Script, which adds a row to the day tab for that date with status **Booked**.
5. The price is the room's hourly rate. Rooms that bill per person multiply the rate by the number of people. Flat-rate rooms do not.
6. With **50% downpayment**, the sheet records half the total as paid now and the rest as the balance.

### Tap in and out (NFC card)

Each NFC card has a link with a token, for example `?t=ABC123`. Tapping the card opens the tap screen.

**First tap (no open visit):**
- A form asks for the guest's name, Work or School, and the duration.
- **Check in** creates a row on today's day tab with status **In** and the exact time of the tap.
- The Personnel column is filled automatically only if exactly one staff member is on duty.

**Tap while checked in:**
- The screen shows the end time, the bill so far, and buttons to extend or check out.
- Extending adds time to the end time and updates the bill.

**Check out:**
- The row changes to status **Out** and the visit is copied into the Visit Log.
- The screen shows the time used and the total due.

**Pass cards** (Weekly or Monthly) are not billed per visit. They show the time left today, and they are capped at 9 hours per day.

### Billing rule

| Time stayed | Billed |
|---|---|
| 0 to 80 min (60 min + 20 min grace) | 1 hr |
| 81 to 140 min | 2 hrs |
| 141 to 200 min | 3 hrs |

Minimum is 1 hour. The total is billed hours multiplied by the rate.

### Staff clock in and out (staff.html)

1. Staff open `staff.html`, choose their name, and enter their PIN.
2. **Clock in** adds a row to the **Shifts** tab with the date and the time.
3. Only one person can be on duty at a time. Clock in is blocked while someone else is still on duty.
4. **Clock out** fills in the Clock Out time and shows the hours for that shift.
5. Any walk-in still in progress when someone clocks in is given that person's name in Personnel.

The "On duty now" list refreshes every minute.

### Day tabs, Visit Log, and summaries

- **Day tabs** (for example `Oct 31, 2026`) hold every visit for that date. This is where staff edit Time Out, Status, Paid, Payment method, Downpayment, and Balance.
- **Visit Log** is a read-only copy of closed visits, sorted newest first. The dashboard and summaries read from it.
- The log refreshes when a visit changes, and every 5 minutes as a backup.
- **Visit Lookup** and **Shift Summary** show totals for a chosen date, and Shift Summary shows totals per staff member.
- **Pass Sales** shows passes sold and active, updated from the Passes tab.

### Admin dashboard (?admin=1)

- Opens after the admin PIN is entered. The PIN is kept in memory only, so a page refresh locks the dashboard again.
- Shows who is on duty, sales and visitors for the day, week, or month, the past 3, 7, or 14 days, staff performance, payment methods, pass sales, and averages.
- **Sales** counts the downpayment when one was recorded, otherwise the full total if the visit is Paid.
- **Unpaid balance** adds up balances still owed on downpayment bookings, plus unpaid visits with no downpayment.
- Passes are counted separately from sales.
- The dashboard refreshes every 5 minutes.
- Layout: business numbers on the left, **Who's in right now** (open visits) on the right. On narrow screens the right panel moves below.
- Each menu item opens its own page: **Dashboard** (overview), **Who's in**, **Past days**, **Sales trends**, **Staff**, **Pass sales** and **NFC cards**. Every page has a short description, a row of summary tiles, then the details. The Day / Week / Month switch shows only on pages that use it.
- Pages have their own links, e.g. `?admin=1#/staff`, so the back button and bookmarks work.
- The 3 / 7 / 14 days switch controls both the Past days tiles and the chart in Day view. The chart skips leading days with no data.
- Staff with no clients or payments in the period are hidden from Staff performance.

#### Optional fields the dashboard reads from `getDashboard`

The page works without these. Add them in Apps Script to turn the features on:

| Field | Shape | What it turns on |
|---|---|---|
| `openVisits` | `[{ room, guest, timeIn, bill }]` (`timeIn` is ISO or `HH:MM`, `bill` is the running total in pesos) | The **Who's in right now** list. Without it the panel shows a short note. |
| `yesterdaySoFar` | `{ sales, visitors }` for yesterday up to the current clock time | Day view compares **vs same time yesterday**. Without it the label says **vs all of yesterday**. |
| `prevSoFar` | `{ week: { sales, visitors }, month: { sales, visitors } }` for last week / last month up to the same point as now | Week and Month views compare **vs same point last week / month**. |
| `unpaidList` | `[{ name, date, amount }]`, newest first | Names in **Needs attention**. Without it only the unpaid total shows. |
| `recent` | `[{ type: 'in' or 'out', room, name, time, amount, pass }]`, newest first | The **Recent activity** list. |
| `cards` | `[{ name, category, url }]` | The **Your cards** list on the NFC cards page. |

### Where each thing is stored

| Data | Stored in |
|---|---|
| Visits (booking, walk-in) | Day tabs |
| Closed visits used for totals | Visit Log |
| NFC cards (category) | Tags tab |
| NFC cards (pass) and pass sales | Passes tab |
| Staff shifts and clock times | Shifts tab |
| Rooms, rates, staff names, staff PINs | Settings tab |
| Admin PIN | Apps Script Script Properties (`ADMIN_PIN`) |

### Quick flow check

If something seems wrong, follow the path in order:

1. Did the page load? Check the **Connection** errors in the Troubleshooting section.
2. Did the Apps Script receive the request? Check **Executions** in Apps Script.
3. Is the row on the right day tab with the right status?
4. Has the Visit Log updated? Run `syncAllDays` if not.
5. Does the total match the billing rule above?
## Troubleshooting

### Website and pages

| Problem | Fix |
|---|---|
| Page is unstyled or looks plain | Check that `style.css` and `staff.css` exist with those exact names. Hard refresh with Ctrl+F5. |
| CSS file shows `<style>` at the top | Remove the `<style>` and `</style>` tags. The file must start with CSS. |
| Buttons do nothing | Open F12 > Console and read the first red error. A missing `app.js` or `staff.js` causes this. |
| Page shows the old design or old tab name | Browser cache. Hard refresh with Ctrl+F5. If it persists, check that Vercel shows the latest commit as **Ready**. |
| Tab title did not change | Check the `<title>` in `index.html`, then hard refresh. The admin title is set in `app.js` and only applies after `?admin=1` loads. |
| Images broken or missing | Upload the image beside `index.html` with the exact name, including `.jpg`. |
| Logo has square edges or a light box around it | Re-save the logo with a transparent background, then re-upload. |
| Wordmark text is wrong | The text is part of the image. Edit `logo-wordmark.png.jpg`. Changing the `alt` text does not change what is shown. |
| Loading screen stays on "Loading rooms" | Apps Script is not reachable. Check the deployment access and `API_URL`. |
| Vercel did not update after a commit | Confirm the commit went to the `main` branch and the folder is `HTML`. Wait for **Ready**, then hard refresh. |
| Edits made on GitHub do not appear | You may be editing an old copy. Open the file on GitHub and confirm the content is the latest version. |
| Mobile layout is cramped or cut off | Check the media query at the bottom of `style.css`. Test in a phone-sized window with F12 > device toolbar. |

### Connection and deployment

| Problem | Fix |
|---|---|
| "Cannot reach the server" | In Apps Script, set Who has access to **Anyone**, then deploy a new version. Check `API_URL` in `app.js` and `staff.js`. |
| "Server reply was not valid" | The URL is wrong or the deployment is missing. Open `API_URL` in a browser tab. You should see JSON text. |
| "Unknown action" | The live Apps Script is an old version. Deploy a new version (**Deploy > Manage deployments > Edit > New version > Deploy**). |
| Apps Script change has no effect | You saved but did not deploy. Save, then deploy a new version. |
| Function not found after splitting files | The function is in a file that is not saved, or the name is duplicated across two files. Save all files, then check for duplicate names. |
| Authorization or permission prompt | Click **Review permissions**, choose your Google account, and allow access. Run the function once from the editor to approve it. |
| Errors in the back end | Open **Executions** (clock icon in the Apps Script sidebar) and read the file and line number of the failing run. |

### Staff PINs and clock in/out

| Problem | Fix |
|---|---|
| "Choose your name" | Pick a name from the dropdown. The name must match Settings column B exactly. |
| "No PIN is set for [name]" | Add the PIN in Settings column H on that person's row. Run `setDefaultStaffPins` to fill the defaults. |
| "Wrong PIN" (staff) | Check Settings column H. Plain text must keep leading zeros, so `0000` must not show as `0`. |
| PIN shows as `0` instead of `0000` | The cell is not formatted as plain text. Select column H, set Format > Number > Plain text, then retype `0000`. |
| PIN column is hidden and needs editing | Select columns G and I, right-click, choose **Unhide**. Edit the PIN, then hide column H again with `hideStaffPins`. |
| "[name] is still on duty. They must clock out first." | That person forgot to clock out. They clock out with their PIN, or you type the Clock Out time in the **Shifts** tab. |
| "You are already clocked in" | The name already has an open shift. Clock out first, or check the Shifts tab for a duplicate open row. |
| "You are not clocked in" | There is no open shift for that name. Check the Shifts tab, or clock in first. |
| Clock out gives 0 hours | The Clock In row was edited or the time is the same as Clock Out. Check the row in Shifts. |
| Staff list is empty or missing names | Names must be in Settings column B, rows 2 to 26. Remove blank rows in between. |
| Staff member is missing from Shift Summary | Shift Summary holds 25 staff. Run `buildShiftSummary` after adding names. |
| "Staff PIN is not set up yet" (admin) | Run `setAdminPin` once from the editor. |
| "Wrong PIN" (admin dashboard or card maker) | Check Script Properties, key `ADMIN_PIN`. Running `setAdminPin` resets it to `0000`, so do not run it again unless you want that. |

### Bookings and tap in/out

| Problem | Fix |
|---|---|
| "Name, date and room are required" | Fill in all three fields before continuing. |
| "[room] allows X to Y persons" | The people count is outside the room limits in Settings columns F and G. Change the count. |
| "Enter a Time In before a Time Out" | Enter the Time In first on the day tab. |
| "Time Out must be after Time In" | Check the times. A Time Out earlier than Time In is rejected on the day tab. |
| "Unknown NFC card" | The tag was not created in the card maker, or it was deleted from Tags or Passes. Make a new card. |
| "This card has no category" | The Tags row has no category. Make a new card with a valid category. |
| "This card is already checked in" | The card has an open visit. Check out first, or check the day tab for a stuck In row. |
| Tap screen shows "Unexpected reply" | Reload the link. If it repeats, check Executions for the error. |
| "This pass expired on [date]" | The pass has passed its last day. Sell a new pass. |
| "You have used your 9 hours for today" | The weekly or monthly pass hit its daily cap. It resets the next day. |
| Pass card says "Unknown NFC card" | The pass row was deleted from the Passes tab, or the pass was for Day Pass, which has been removed. |
| Check-out total looks wrong | Billing: 1 hr covers up to 80 minutes (60 min + 20 min grace). From 81 minutes, the bill goes to 2 hrs, then each started hour adds 1 more. Check Time In and Time Out on the day tab. |
| Booking saved but not on the dashboard | Only closed visits (status Out) count toward sales. Check the status. |
| Dashboard sales show zero after a visit | Make sure the visit has a Time Out and status Out. Run `syncAllDays` if the Visit Log is behind. |

### Sheets and data

| Problem | Fix |
|---|---|
| Date shows "Jan 1, 1900" | A count was formatted as a date. Run `buildShiftSummary` again, which sets the number format. |
| Personnel column is blank | Nobody was clocked in at that time, or two people were on duty. Pick the name from the dropdown, or run `backfillPersonnel`. |
| Personnel shows a name but the wrong person | Auto-fill uses the shift at the walk-in's Time In. Correct it by hand. Manual entries are never overwritten. |
| Personnel dropdown is missing names | Refresh the dropdown with `refreshPersonnelDropdowns`. Check that the name is in Settings column B. |
| Visit Log is out of date | Run `syncAllDays` from the editor. It also refreshes the Visit Log order. |
| Visit Log rows are out of order | The log sorts newest first by Date and Time In. Run `syncAllDays` to re-sort. |
| Pass Sales tab shows "No pass sold yet" | No passes exist in the Passes tab yet, or the pass type name does not match. Run `buildPassSales` if the tab is broken. |
| Cannot edit a day tab column | Columns A to D and F to J are locked for staff by design. Only the owner can edit them. |
| Cannot edit a closed visit name or status | Closed rows are locked from name to status. Edit only Paid, Downpayment, and Balance. |
| Status changed by mistake on a closed visit | Use the owner account to unprotect the row, fix it, then run `syncAllDays`. |
| Settings room or rate change not showing | The app caches settings until the script restarts. Deploy a new version or wait a few minutes. |
| Shift Summary totals wrong for a date | Pick the date in cell B4. Totals count closed visits only. |

---

## Back end (Apps Script)

Split into six files: **Config**, **Api**, **Visits**, **Sheets**, **Staff**, and **Dashboard**.

Run manually from the editor when needed: `setAdminPin`, `setDefaultStaffPins`, `hideStaffPins`, `buildShiftSummary`, `buildPassSales`, `backfillPersonnel`, `protectAllDayTabs`.

---

## Links

- **Repository:** https://github.com/klasikfades/LCKDIN-HUB
- **Spreadsheet:** LCKDIN Study Hub (Google Sheets)
- **Hosting:** Vercel, project `lckdin-hub`

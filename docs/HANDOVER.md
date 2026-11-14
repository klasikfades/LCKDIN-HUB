# Handover to a client

This guide moves the whole LCKDIN Study Hub from your accounts to your client's accounts
without breaking bookings, tap cards, staff clock-in, or the dashboard.

Read the three warnings in section 2 first. They are the only places a handover usually
goes wrong.

---

## 1. What is being handed over

| Piece | Where it lives now | What the client ends up owning |
|---|---|---|
| Web pages | GitHub `klasikfades/LCKDIN-HUB`, deployed by Vercel project `lckdin-hub` (account `gearsfade-4987`) | The GitHub repo and the Vercel project |
| Backend | Google Apps Script bound to the LCKDIN sheet, script ID `1mE27w73…`, deployment `AKfycbzl…` | The sheet, the bound script, and a deployment made under their own account |
| Database | Google Sheet `1A4blo-ANPeep8Ec2qPMK6P1qPBA9ZPZafAP3AJ0fSD4` | The sheet itself, including all history |
| Tap cards | NFC tags encoded with `https://lckdin-hub.vercel.app/?t=<token>` | The tags (URLs may need rewriting, see 2.3) |
| Source backup | `LCKDIN-HUB` folder on your PC | A zip copy, even though the repo is the real source |
| Instructions | `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`, `backend/README.md` | The same files, already inside the repo |

The desktop folder is only a copy. The live system is the repo, Vercel, and Google. If the
desktop folder were lost tomorrow, nothing customer-facing would break.

---

## 2. The three things that break in a handover

### 2.1 The backend URL is written into the web pages

`HTML/app.js` and `HTML/staff.js` each begin with `API_URL`. That address points at your
deployment ID. When the client deploys the backend under their own Google account, the
deployment gets a **new** `AKfycb…` address. Until both files are updated and Vercel
redeploys, the site will show "Cannot reach the server".

### 2.2 The site address is written into every tap card

Every NFC tag holds `https://lckdin-hub.vercel.app/?t=<token>`. If the site moves to a new
`*.vercel.app` address, **all cards stop working**, even though the backend is fine. That is
why the Vercel project is transferred rather than re-created: transferring usually keeps the
address, while importing the repo as a new project creates a new one.

Check the address right after the Vercel transfer: **Project → Settings → Domains**. If
`lckdin-hub.vercel.app` is listed, cards keep working. If it changed, every tag must be
re-encoded to the new address plus the old token.

### 2.3 Triggers and the deployment run as the person who made them

Two installable triggers (On edit, and a 5-minute timer for `syncAllDays`) belong to your
Google account, and the live deployment "executes as" you. After ownership moves, they must
be recreated by the client. Steps are in section 5.3 and 5.4.

Keeping your account as a collaborator forever would hide these problems, but it also means
the system is not really handed over. Do not do that unless the client asks for a support
window, and end it on a date.

---

## 3. Before you start

Ask the client for three things:

1. A **GitHub** account (username).
2. A **Vercel** account (they can sign in with GitHub).
3. A **Google** account that will own the sheet, plus a decision on the site address
   (keep `lckdin-hub.vercel.app` is strongly recommended).

Then, on your side:

- [ ] Open the sheet and make a full copy: **File → Make a copy**. Name it
      `LCKDIN Study Hub — handover backup <date>`. This is your safety net, not the
      client's copy.
- [ ] Confirm `LCKDIN-HUB` is committed and pushed; `git status` should be clean.
- [ ] Record the current deployment URL and ID (Apps Script → Deploy → Manage deployments).
- [ ] Export a zip of the repo for offline handing (the pack built beside this guide).
- [ ] Delete test data you do not want the client to inherit (for example the QA row in the
      Nov 14 tab).
- [ ] Decide where the PINs will be communicated. Never in the repo, the zip, or email.

---

## 4. Accounts, in this order

### 4.1 GitHub repository

1. Repo → **Settings → General → Danger Zone → Transfer ownership**.
2. Enter the client's GitHub username and confirm.
3. The client accepts from the email GitHub sends them.
4. On their side, clone it once and confirm `HTML/` and `backend/` are present.

If the client prefers their own organisation, transfer to the organisation instead of the
personal account; the rest of this guide is unchanged.

### 4.2 Vercel

Preferred (keeps the address and the deployment history):

1. Vercel → project `lckdin-hub` → **Settings → Advanced → Transfer Project**.
2. Choose the client's account or team.
3. The client opens the project and checks **Settings → Domains** for
   `lckdin-hub.vercel.app`.
4. Open **Settings → Git** and reconnect the repository if the connection shows as broken
   after the GitHub transfer.

Fallback, only if transfer is unavailable: the client imports their copy of the repo as a
new project with Root Directory `HTML`. It builds identically but gets a new address, which
means all tap cards must be re-encoded and `SITE_URL` in `Config.gs` updated.

Either way, confirm the build uses **Root Directory = `HTML`**. That setting is what makes
`lckdin-hub.vercel.app/` serve `index.html` and not the repo root.

### 4.3 Google Sheet and Apps Script

1. In the sheet, **Share** with the client's Google account as **Editor**. Ask them to open
   it once.
2. As the current owner, share → their name → **Transfer ownership** (Google may require
   you to confirm by email).
3. The client opens the sheet and checks **Extensions → Apps Script**. The script should be
   there with the six files.
4. If the script is missing or not editable, do this instead: client creates a new script
   from **Extensions → Apps Script**, and pastes the six files from `backend/` into it.
   Nothing is lost; `backend/` is the source of truth. Then continue with 5.1.

While you still have access, open **Project Settings → Script Properties** and note whether
`ADMIN_PIN` and `layoutVersion` exist. The client will set their own admin PIN in 5.2.

---

## 5. Backend, as the client

Do these steps signed in as the client, not you.

### 5.1 Check it runs

In the Apps Script editor, choose `syncAllDays` in the function dropdown and click **Run**.
Approve the permission prompt. The sheet should update without errors. This also proves the
script can still read the sheet after the ownership transfer.

### 5.2 Set a fresh admin PIN

1. Run `setAdminPin` once. This creates `ADMIN_PIN` with the value `0000`.
2. **Project Settings → Script Properties → `ADMIN_PIN` → Edit** and replace `0000` with the
   real PIN. Do not leave `0000`.
3. Staff PINs are separate: Settings tab, column H. Change any PIN that you or staff used
   before the handover.

### 5.3 Deploy under the client's account

1. **Deploy → Manage deployments → pencil icon** on the existing deployment.
2. Version: **New version**. Execute as: **Me**. Who has access: **Anyone**.
3. Deploy. Copy the new `/exec` URL.
4. Open that URL with `?action=config` appended in a browser. It must show
   `"version":"v108"` (or the current version) and the room list.

If step 1 does not offer the existing deployment, use **Deploy → New deployment → Web app**
with the same Execute as / access settings. That gives a new URL, which is fine — section 2.1
already covers updating it.

### 5.4 Recreate the triggers

Apps Script → **Triggers** (clock icon) → **Add trigger**, twice:

| Function | Event source | Event type |
|---|---|---|
| `onEdit` | From spreadsheet | On edit |
| `syncAllDays` | Time-driven | Minutes timer, every 5 minutes |

Delete any old triggers that point at the previous account if they are still listed.

---

## 6. Front end wiring

The client edits two files in the repo, or you do it before the transfer if they prefer.

1. `HTML/app.js` line 3 and `HTML/staff.js` line 2: replace `API_URL` with the new `/exec`
   URL.
2. If the site address changed, update `SITE_URL` in `backend/Config.gs` (it is only used to
   print new card links). If you changed `Config.gs`, push and redeploy the backend.
3. Bump the cache version in `HTML/index.html` and `HTML/staff.html`:
   `app.js?v=…` and `staff.js?v=…` must change, or returning browsers keep the old file for
   a year.
4. Commit and push. Wait for Vercel **Ready**, then hard refresh with **Ctrl+F5**.

---

## 7. Tap cards

- If `lckdin-hub.vercel.app` survived the transfer and the backend URL was updated, the
  **existing tags keep working**. Only new cards need anything.
- If the site address changed, every tag must be rewritten: read the old token from the tag,
  write `https://<new-address>/?t=<old token>`. The tokens live in the Tags and Passes tabs,
  so nothing is lost; they just need re-encoding.
- Old cards for removed cards or passes should be wiped or collected, not left active. To
  revoke a card, delete its row in Tags or Passes.

Keep the old Apps Script deployment alive until every card is confirmed working. Then
archive it: **Deploy → Manage deployments → Archive** on the old one.

---

## 8. Verification, before you call it done

Run this with the client watching. Every line has a full procedure in `docs/RUNBOOK.md`
section 4.

- [ ] Booking page loads 6 rooms, Open time selected, no console errors.
- [ ] Console line reads `LCKDIN web … · server v108` with the new backend.
- [ ] A real booking saves to the correct day tab.
- [ ] One tap card checks in, extends, and checks out with a correct bill.
- [ ] `staff.html` lists names, PIN clock in/out works, the one-on-duty rule holds.
- [ ] `?admin=1` opens with the **new** admin PIN, totals look right.
- [ ] A wrong admin PIN still gets a normal "Wrong PIN"; do not test ten times in a row.
- [ ] `curl -sI https://lckdin-hub.vercel.app/` shows `Content-Security-Policy` and
      `X-Frame-Options: DENY`.

---

## 9. Close out your side

- [ ] Remove your access from the Vercel project and the GitHub repo (owner transfer does
      this automatically; check anyway).
- [ ] Ask the client to remove your Google account from the sheet sharing list.
- [ ] Rotate the admin PIN and any staff PINs you knew.
- [ ] Archive the old Apps Script deployment after cards are confirmed.
- [ ] Keep your sheet backup and the repo zip for at least 30 days, then delete.
- [ ] Send the client this file plus `docs/RUNBOOK.md`, and tell them the console line is
      the first thing to check when something looks wrong.

---

## 10. What never to hand over

- Your Google, GitHub, or Vercel password, or any 2FA code. Transfer ownership instead;
  every platform above supports it.
- `~/.clasprc.json` (clasp's login token). The client does not need clasp at all; the Apps
  Script editor is enough.
- The `ADMIN_PIN` by email or chat. Write it on paper or use a password manager.
- The sheet backup with real customer history, unless the client asks for it.

---

## 11. One-page summary

1. Client accounts ready.
2. Transfer GitHub repo → accept.
3. Transfer Vercel project → confirm the address.
4. Transfer the sheet → verify Apps Script access.
5. Client runs `syncAllDays`, sets a new PIN, deploys, copies the new URL.
6. Recreate the two triggers.
7. Update `API_URL`, bump `?v=`, push, wait for Ready.
8. Retag cards only if the address changed.
9. Verify booking, tap, staff, admin.
10. Rotate PINs, remove your access, keep backups for 30 days.

// ============================================================
// STAFF: PINs, clock in/out, one-person-on-duty rule, Personnel auto-fill
// ============================================================

// ---------- Admin PIN (card maker and dashboard) ----------

// Run setAdminPin after changing the value to your real PIN.
function setAdminPin() {
  PropertiesService.getScriptProperties().setProperty('ADMIN_PIN', '0000');
}

// ---------- PIN throttling ----------
// Wrong PINs are counted in the script cache. Once the limit is reached the
// PIN is refused for 10 minutes, so a short PIN cannot be brute-forced.
const PIN_WINDOW_SECONDS = 10 * 60;
const ADMIN_PIN_TRIES = 10;
const STAFF_PIN_TRIES = 6;

function pinKey(kind, id) {
  return 'pinFail:' + kind + ':' + String(id || '').toLowerCase();
}

function pinLocked(key, max) {
  return Number(CacheService.getScriptCache().get(key) || 0) >= max;
}

// Records one wrong PIN. Always throws, so callers can use it as the failure branch.
function pinFailed(key, max) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(n), PIN_WINDOW_SECONDS);
  throw new Error(n >= max
    ? 'Too many wrong PINs. Try again in 10 minutes.'
    : 'Wrong PIN');
}

function checkPin(pin) {
  const saved = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN');
  if (!saved) throw new Error('Staff PIN is not set up yet');
  const key = pinKey('admin', 'admin');
  if (pinLocked(key, ADMIN_PIN_TRIES)) throw new Error('Too many wrong PINs. Try again in 10 minutes.');
  if (String(pin || '') !== saved) pinFailed(key, ADMIN_PIN_TRIES);
  CacheService.getScriptCache().remove(key);
}

// ---------- Staff PINs in Settings column H ----------

// Sets every staff PIN in Settings column H to 0000 (plain text, so leading zeros are kept)
function setDefaultStaffPins() {
  const sh = ss().getSheetByName('Settings');
  sh.getRange('H1').setValue('PIN')
    .setFontWeight('bold').setHorizontalAlignment('center');
  const pins = [];
  for (let i = 0; i < 25; i++) pins.push(['0000']);
  sh.getRange('H2:H26').setNumberFormat('@').setValues(pins).setHorizontalAlignment('center');
}

// Hides the PIN column in Settings and locks it, so PINs are not visible on the sheet.
// The staff page still works, because the script reads hidden columns too.
function hideStaffPins() {
  const sh = ss().getSheetByName('Settings');
  sh.hideColumns(8);   // column H
  const p = sh.getRange('H:H').protect().setDescription('Staff PINs: hidden');
  p.removeEditors(p.getEditors());
}

// PIN is in Settings column H, on the same row as the name in column B.
// Returns null if the name is not on the staff list.
function staffPinFor(name) {
  const rows = ss().getSheetByName('Settings').getDataRange().getValues();
  const row = rows.find(r => String(r[0]).indexOf('Default In-charge') === 0 && String(r[1]).trim() === name);
  if (!row) return null;
  return String(row[7] || '').trim();
}

// Checks the staff name and PIN sent from the staff page. Returns the name.
function checkStaffPin(b) {
  const name = String(b.staff || '').trim();
  const expected = staffPinFor(name);
  if (expected === null) throw new Error('Choose your name');
  if (!expected) throw new Error('No PIN is set for ' + name + ' in Settings');
  const key = pinKey('staff', name);
  if (pinLocked(key, STAFF_PIN_TRIES)) {
    throw new Error('Too many wrong PINs for ' + name + '. Try again in 10 minutes.');
  }
  if (String(b.pin || '').trim() !== expected) pinFailed(key, STAFF_PIN_TRIES);
  CacheService.getScriptCache().remove(key);
  return name;
}

// ---------- Shifts tab ----------

// Gets the Shifts tab, creating it the first time someone clocks in
function getOrCreateShifts() {
  const s = ss();
  let sh = s.getSheetByName(SHIFTS_TAB);
  if (!sh) {
    sh = s.insertSheet(SHIFTS_TAB);
    sh.appendRow(SHIFT_HEADERS);
    sh.setFrozenRows(1);
    styleHeader(sh.getRange(1, 1, 1, SHIFT_HEADERS.length));
    sh.setHiddenGridlines(true);
    sh.setTabColor('#6B7356');
    sh.setColumnWidth(1, 170);
    sh.setColumnWidth(2, 120);
    sh.setColumnWidth(3, 120);
    sh.setColumnWidth(4, 120);
    sh.setColumnWidth(5, 90);
  }
  return sh;
}

// Row number of the newest shift with no Clock Out for this name, or 0
function openShiftRow(name) {
  const data = getOrCreateShifts().getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]).trim() === name && data[i][3] === '') return i + 1;
  }
  return 0;
}

// Everyone currently clocked in
function onDutyList() {
  const data = getOrCreateShifts().getDataRange().getValues();
  const seen = {};
  const list = [];
  for (let i = 1; i < data.length; i++) {
    const name = String(data[i][0]).trim();
    if (name && data[i][2] instanceof Date && data[i][3] === '' && !seen[name]) {
      seen[name] = true;
      list.push({ name: name, since: data[i][2].toISOString() });
    }
  }
  return list;
}

// Every staff member from Settings, with whether they are on duty now
function staffStatusList() {
  const on = onDutyList();
  return getConfig().personnel.map(name => {
    const hit = on.find(o => o.name === name);
    return { name: name, onDuty: !!hit, since: hit ? hit.since : '' };
  });
}

// ---------- Personnel auto-fill ----------

// Staff name for new walk-ins: only when exactly one person is on duty
function autoPersonnel() {
  const on = onDutyList();
  return on.length === 1 ? on[0].name : '';
}

// When someone clocks in, any walk-in still in progress with no staff name gets their name
function claimOpenVisits(name) {
  const sh = ss().getSheetByName(tabNameFor(todayStr()));
  if (!sh || sh.getLastRow() < 2) return;
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, LAST_COL).getValues();
  vals.forEach((v, i) => {
    if (v[C.status - 1] === 'In' && v[C.tag - 1] && v[C.personnel - 1] === '') {
      sh.getRange(i + 2, C.personnel).setValue(name);
    }
  });
}

// Fills blank Personnel on any visit that has already started (walk-in, pass or booking),
// using whoever was clocked in at its Time In. Only blank cells are filled, so manual
// entries are never overwritten. Pass one day tab to limit it, or leave empty for all day tabs.
function backfillPersonnel(onlySheet) {
  const shifts = getOrCreateShifts().getDataRange().getValues().slice(1)
    .filter(r => r[0] !== '' && r[2] instanceof Date)
    .map(r => ({
      name: String(r[0]).trim(),
      start: r[2],
      end: r[3] instanceof Date ? r[3] : null   // null = still on duty
    }));
  if (!shifts.length) return;

  const now = new Date();
  const sheets = onlySheet
    ? [onlySheet]
    : ss().getSheets().filter(sh => isDayTab(sh.getName()));

  sheets.forEach(sh => {
    const last = sh.getLastRow();
    if (last < 2) return;
    const vals = sh.getRange(2, 1, last - 1, LAST_COL).getValues();
    vals.forEach((v, i) => {
      if (v[C.personnel - 1] !== '' || !v[C.name - 1]) return;
      const tIn = v[C.timeIn - 1];
      if (!(tIn instanceof Date) || tIn > now) return;   // not started yet
      const hit = shifts.find(s => tIn >= s.start && (!s.end || tIn <= s.end));
      if (hit) sh.getRange(i + 2, C.personnel).setValue(hit.name);
    });
  });
}

// ---------- Clock in / clock out ----------

// Clock in. Only one person may be on duty at a time.
function staffClockIn(b) {
  const name = checkStaffPin(b);
  if (openShiftRow(name)) throw new Error('You are already clocked in');

  const busy = onDutyList();
  if (busy.length) throw new Error(busy[0].name + ' is still on duty. They must clock out first.');

  const now = new Date();
  now.setSeconds(0, 0);
  const sh = getOrCreateShifts();
  sh.appendRow([name, new Date(todayStr() + 'T00:00:00+08:00'), now, '', '']);
  const r = sh.getLastRow();
  sh.getRange(r, 2).setNumberFormat(DATE_FMT).setHorizontalAlignment('center');
  sh.getRange(r, 3, 1, 2).setNumberFormat(TIME_FMT).setHorizontalAlignment('center');
  sh.getRange(r, 5).setFormula(`=IF(ISNUMBER(D${r}),ROUND((D${r}-C${r})*24,2),"")`)
    .setNumberFormat('0.00')
    .setHorizontalAlignment('center');

  claimOpenVisits(name);
  return { name: name, at: now.toISOString() };
}

// Clock out and return the hours for that shift
function staffClockOut(b) {
  const name = checkStaffPin(b);
  const r = openShiftRow(name);
  if (!r) throw new Error('You are not clocked in');

  const sh = getOrCreateShifts();
  const now = new Date();
  now.setSeconds(0, 0);
  sh.getRange(r, 4).setValue(now);
  SpreadsheetApp.flush();

  const inAt = sh.getRange(r, 3).getValue();
  const hours = inAt instanceof Date ? Math.round((now - inAt) / 3600000 * 100) / 100 : 0;
  return { name: name, at: now.toISOString(), hours: hours };
}
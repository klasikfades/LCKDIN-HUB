// ============================================================
// VISITS: booking, tap in/out, extend, check-out, NFC cards, passes, bills
// ============================================================

// ---------- Tags and cards ----------

function getOrCreateTags() {
  const s = ss();
  let sh = s.getSheetByName('Tags');
  if (!sh) {
    sh = s.insertSheet('Tags');
    sh.appendRow(['Token', 'Name', 'Category', 'Created']);
    sh.setFrozenRows(1);
  }
  return sh;
}

// Finds a card in Tags (category cards) or Passes (pass cards).
// Found cards are cached for 1 minute, so repeat taps within a minute skip the sheet reads.
function findTag(token) {
  const cache = CacheService.getScriptCache();
  const key = 'tag:' + token;
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  let found = null;
  const t = ss().getSheetByName('Tags');
  if (t) {
    const row = t.getDataRange().getValues().slice(1)
      .find(r => String(r[0]) === String(token));
      if (row) found = { name: String(row[1]), category: String(row[2] || '').trim() };
  }
  if (!found) {
    const p = ss().getSheetByName(PASSES_TAB);
    if (p) {
      const row = p.getDataRange().getValues().slice(1)
        .find(r => String(r[0]) === String(token));
      if (row) found = {
        name: String(row[1]),
        category: String(row[2]).trim(),
        isPass: true,
        expires: toIso(row[5])
      };
    }
  }
  if (found) cache.put(key, JSON.stringify(found), 60);
  return found;
}

// Card maker: category cards use the category rate. Pass types create a pass card.
function newToken(name, category) {
  if (!name) throw new Error('Enter the card name first');
  if (!category) throw new Error('Choose a category');
  if (PASS_TYPES[category]) return createPass(name, category);

  getRate(category);   // throws if the category is not in Settings
  const token = makeToken();
  const tagsSheet = getOrCreateTags();
  tagsSheet.appendRow([token, name, category, new Date()]);
  const lastRow = tagsSheet.getLastRow();
  tagsSheet.getRange(lastRow, 4).setNumberFormat(DATE_FMT).setHorizontalAlignment('center');
  return { token, url: SITE_URL + '?t=' + token };
}

// ---------- Passes ----------

function getOrCreatePasses() {
  const s = ss();
  let sh = s.getSheetByName(PASSES_TAB);
  if (!sh) {
    sh = s.insertSheet(PASSES_TAB);
    sh.appendRow(PASS_HEADERS);
    sh.setFrozenRows(1);
    styleHeader(sh.getRange(1, 1, 1, PASS_HEADERS.length));
    sh.setHiddenGridlines(true);
    sh.setTabColor('#6B7356');
  }
  return sh;
}

// Sells a pass: creates a row in the Passes tab with real dates, and returns the card link
function createPass(name, passType) {
  const p = PASS_TYPES[passType];
  const token = makeToken();
  const start = todayStr();
  const expires = addDaysStr(start, p.days - 1);
  const sh = getOrCreatePasses();
  sh.appendRow([token, name, passType, getPassPrice(passType),
    new Date(start + 'T00:00:00+08:00'),
    new Date(expires + 'T00:00:00+08:00'),
    new Date()]);
  const row = sh.getLastRow();
  sh.getRange(row, 5, 1, 2).setNumberFormat(DATE_FMT).setHorizontalAlignment('center');
  sh.getRange(row, 7).setNumberFormat(DATETIME_FMT);
  ensurePassSales();
  return { token, url: SITE_URL + '?t=' + token };
}

// Every pass sold, for the dashboard's Pass sales panel
function passSalesList() {
  const sh = ss().getSheetByName(PASSES_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, PASS_HEADERS.length).getValues()
    .filter(r => r[0] !== '')
    .map(r => ({
      name: String(r[1]),
      pass: String(r[2]),
      price: Number(r[3]) || 0,
      sold: r[6] instanceof Date ? toIso(r[6]) : toIso(r[4]),
      expires: toIso(r[5])
    }));
}

// Throws if the pass has expired
function passCheckValid(tag) {
  if (tag.expires < todayStr()) throw new Error('This pass expired on ' + tag.expires);
}

// Actual minutes this pass has been used today, across all of its visits.
// Finished visits use real Time In to Time Out. A visit still In counts up to now.
// exceptRow skips one row (used when extending, so the current visit is not counted twice).
function passMinutesUsedToday(token, exceptRow) {
  const sh = ss().getSheetByName(tabNameFor(todayStr()));
  if (!sh) return 0;
  const now = new Date();
  const data = sh.getDataRange().getValues();
  let used = 0;
  for (let i = 1; i < data.length; i++) {
    if (exceptRow && i + 1 === exceptRow) continue;
    const row = data[i];
    if (String(row[C.tag - 1]) !== String(token)) continue;
    const tIn = row[C.timeIn - 1];
    if (!(tIn instanceof Date)) continue;
    const status = row[C.status - 1];
    if (status === 'Out') {
      const tOut = row[C.timeOut - 1];
      if (tOut instanceof Date) used += (tOut - tIn) / 60000;
    } else if (status === 'In') {
      used += (now - tIn) / 60000;
    }
  }
  return used;
}

// Whole minutes left today for a pass.
function passMinutesLeftToday(tag, token, exceptRow) {
  const cap = PASS_TYPES[tag.category].dailyCap;
  if (!cap) return null;
  return Math.max(0, Math.floor(cap * 60 - passMinutesUsedToday(token, exceptRow)));
}

// ---------- Pricing ----------

// Price for a room over billed hours, times the people multiplier.
// Walk-ins use multiplier 1. Bookings use the number of people (flat rooms use 1).
function priceFor(room, hours, multiplier) {
  const cat = getConfig().categories.find(c => c.name === String(room).trim());
  if (!cat) return 0;
  return r2(tierPrice(hours, cat.tiers) * multiplier);
}

// Saves the room and people multiplier on the row, so the price can be recalculated later
function setVisitHelpers(sh, r, room, mult) {
  sh.getRange(r, ROOM_HELPER_COL, 1, 2).setValues([[room, mult]]);
}

// Table and guest names for a booking, in their own columns (S and T).
// Guests are one per line, already tagged with the room.
function setTableAndGuests(sh, r, room, guests) {
  sh.getRange(r, TABLE_COL, 1, 2).setValues([['Table: ' + room, guests]]);
  sh.getRange(r, GUESTS_COL).setWrap(true).setVerticalAlignment('top');
  const lines = String(guests || '').split('\n').filter(Boolean).length;
  sh.setRowHeight(r, Math.max(30, 18 * Math.max(1, lines) + 8));
}

// Writes the Total for one visit from its room, billed hours and multiplier.
// Pass visits stay at 0. Rows with no saved room (old rows) are left unchanged.
function recalcTotal(sh, r) {
  normalizeVisitTimes(sh, r);
  SpreadsheetApp.flush();
  const helpers = sh.getRange(r, ROOM_HELPER_COL, 1, 2).getValues()[0];
  const room = String(helpers[0] || '').trim();
  if (!room) return null;
  const row = sh.getRange(r, 1, 1, LAST_COL).getValues()[0];
  const isPass = String(row[C.payment - 1]).trim() === 'Pass';
  const hours = Number(row[C.hours - 1]) || 0;
  const mult = Number(helpers[1]) || 1;
  const total = isPass ? 0 : priceFor(room, hours, mult);
  sh.getRange(r, C.total).setValue(total);
  syncBalance(sh, r);
  return total;
}

// ---------- Money (one rule for the sheet, Visit Log and dashboard) ----------

// Collected cash and outstanding balance for one visit row.
// Paid wins: a visit marked Paid is fully collected, whatever an older balance cell says.
// Otherwise the recorded Downpayment is collected and the rest is owed.
function visitMoney(row) {
  const total = r2(Number(row[C.total - 1]) || 0);
  const paid = String(row[C.paid - 1] || '').trim() === 'Paid';
  if (paid) return { total: total, collected: total, owed: 0 };
  const downRaw = row[C.downpayment - 1];
  const down = isNumeric(downRaw) ? Math.max(0, Number(downRaw)) : 0;
  const collected = r2(Math.min(total, down));
  return { total: total, collected: collected, owed: r2(Math.max(0, total - collected)) };
}

// Writes the Balance cell from the rule above, so the day tab matches the dashboard.
// Paid rows show 0; unpaid rows show Total minus Downpayment.
function syncBalance(sh, r) {
  SpreadsheetApp.flush();
  const row = sh.getRange(r, 1, 1, LAST_COL).getValues()[0];
  // Keep the recorded amount as a plain value, so changing Balance cannot rewrite history
  const downRaw = row[C.downpayment - 1];
  if (isNumeric(downRaw)) {
    row[C.downpayment - 1] = r2(Math.max(0, Number(downRaw)));
    sh.getRange(r, C.downpayment).setValue(row[C.downpayment - 1]);
  }
  const owed = visitMoney(row).owed;
  sh.getRange(r, C.balance).setValue(owed);
  return owed;
}

// ---------- Bill summary (tap screen) ----------

// Hours billed for a stay. Same rule as the Hours formula on the day tabs:
// 1 hr covers up to 80 minutes (60 min + 20 min grace). Each extra started hour counts after that.
function billedHours(minutes) {
  return Math.max(MIN_HOURS, Math.ceil((Math.round(minutes) - 20) / 60));
}

// Bill for one visit row. Used after check-in, extend and check-out.
// Reads Time In, Time Out and the saved Total, so the figures match the day tab.
function visitBill(sh, r, tag) {
  const row = sh.getRange(r, 1, 1, LAST_COL).getValues()[0];
  const tIn = row[C.timeIn - 1];
  const tOut = row[C.timeOut - 1];
  const minutes = (tIn instanceof Date && tOut instanceof Date)
    ? Math.max(0, (tOut - tIn) / 60000) : 0;
  const hours = billedHours(minutes);
  const isPass = String(row[C.payment - 1]).trim() === 'Pass';
  return {
    name: String(row[C.name - 1]),
    room: tag && tag.category ? tag.category : '',
    rate: Number(row[C.rate - 1]) || 0,
    timeIn: fmt(tIn),
    timeOut: fmt(tOut),
    minutes: Math.round(minutes),
    hours: hours,
    total: isPass ? 0 : r2(Number(row[C.total - 1]) || 0),
    isPass: isPass
  };
}

// ---------- Booking (website form) ----------

// Booking form. Price is the room's package price for the duration, times the number of people
// (flat rooms are not multiplied). Each room has a minimum and maximum number of people,
// set in Settings columns F and G.
// mode = Hour: fixed hours, full payment or 50% downpayment.
// mode = Open: no fixed hours; the bill is computed when Time Out is entered at check-out.
// Table and every guest name are stored in their own columns (S and T).
// Trims a value from the website and caps its length, so a malformed
// request cannot bloat a cell or add line breaks to a sheet row.
function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

// Accepts "09:00" and rejects "9:00" / "99:99" (the website always zero-pads)
function isClockTime(value) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  return !!m && Number(m[1]) < 24 && Number(m[2]) < 60;
}

function handleVisit(d) {
  const name = cleanText(d.name, 80);
  const date = String(d.date || '').trim();
  const category = cleanText(d.category, 60);
  if (!name || !date || !category) throw new Error('Name, date and room are required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Pick a valid date');

  const dateObj = new Date(date + 'T00:00:00+08:00');
  if (isNaN(dateObj)) throw new Error('Pick a valid date');
  const today = new Date(todayStr() + 'T00:00:00+08:00');
  const daysAhead = Math.round((dateObj - today) / 86400000);
  if (daysAhead < -1 || daysAhead > 365) throw new Error('Pick a date within the next year');

  if (d.timeIn && d.timeIn !== 'Open' && !isClockTime(d.timeIn)) throw new Error('Pick a valid time in');
  if (d.timeOut && !isClockTime(d.timeOut)) throw new Error('Pick a valid time out');

  const people = Math.max(1, Number(d.people) || 1);
  const isOpenMode = String(d.mode || '').toLowerCase() === 'open';

  const lim = getConfig().categories.find(c => c.name === category);
  if (!lim) throw new Error('Unknown room: ' + category);
  if (people < lim.minPeople || people > lim.maxPeople) {
    throw new Error(lim.name + ' allows ' + lim.minPeople + ' to ' + lim.maxPeople + ' persons');
  }

  const mult = lim.flat ? 1 : people;   // bookings: price x people
  const sh = dayTab(date);

  const openTime = !d.timeIn || d.timeIn === 'Open';
  const hasOut = !isOpenMode && !!d.timeOut;
  if (hasOut && openTime) throw new Error('Enter a Time In before a Time Out');

  const timeIn = openTime ? 'Open' : new Date(date + 'T' + d.timeIn + ':00+08:00');
  let timeOut = '';
  if (hasOut) {
    timeOut = new Date(date + 'T' + d.timeOut + ':00+08:00');
    if (timeOut <= timeIn) timeOut = new Date(timeOut.getTime() + 24 * 60 * 60 * 1000);
  }

  // Open-time bookings show the blue Open pill until the guest is checked out
  const status = (isOpenMode || openTime) ? 'Open' : 'Booked';
  const hasPlan = !isOpenMode && d.balance !== undefined && d.balance !== '' && d.balance !== null;
  const balance = hasPlan ? Math.max(0, Math.round((Number(d.balance) || 0) * 100) / 100) : 0;

  // A visit is Paid only when nothing is left to pay. A downpayment stays Unpaid.
  const paidStatus = (!isOpenMode && balance <= 0) ? 'Paid' : 'Unpaid';
  const payment = isOpenMode ? '' : (d.payment || 'GCash');
  const purpose = cleanText(d.purpose, 120) || 'Work';

  // One guest per line, tagged with the room: "Huddle : king"
  const lines = String(d.guests || '').replace(/\r/g, '').split('\n')
    .map(s => cleanText(s, 60)).filter(Boolean).slice(0, 30);
  const guests = lines.length ? lines.join('\n') : (shortRoomName(lim.name) + ' : ' + name);

  sh.appendRow([name, dateObj, purpose, timeIn, timeOut, '',
                '', lim.rate, '', d.token || '', status, paidStatus, payment,
                '', balance]);
  const r = sh.getLastRow();
  formatTimes(sh, r);
  writeFormulas(sh, r);
  setVisitHelpers(sh, r, lim.name, mult);
  const total = recalcTotal(sh, r);

  // Amount already paid: the rest of the package, or everything for full payment
  const paidNow = isOpenMode ? '' : (hasPlan ? r2(Math.max(0, total - balance)) : total);
  sh.getRange(r, C.downpayment).setValue(paidNow);
  syncBalance(sh, r);
  setTableAndGuests(sh, r, lim.name, guests);
  return { action: 'booked' };
}

// ---------- Tap in / out ----------

// Latest open visit for this card. Checks today's tab and yesterday's tab,
// so a visit that started before midnight can still be checked out.
function findOpenRow(token) {
  for (let back = 0; back <= 1; back++) {
    const iso = Utilities.formatDate(new Date(Date.now() - back * 86400000), TZ, 'yyyy-MM-dd');
    const sh = ss().getSheetByName(tabNameFor(iso));
    if (!sh) continue;
    const data = sh.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][C.tag - 1]) === String(token) && data[i][C.status - 1] !== 'Out') {
        return { sh: sh, r: i + 1, status: data[i][C.status - 1] };
      }
    }
  }
  return null;
}

function handleTap(token) {
  const tag = findTag(token);
  if (!tag) throw new Error('Unknown NFC card');
  if (tag.isPass) passCheckValid(tag);
  if (!tag.isPass && !tag.category) throw new Error('This card has no category. Make a new card.');

  const open = findOpenRow(token);

  // Already checked in: passes get a reminder and check-out only. Category cards can extend.
  if (open && open.status === 'In') {
    const end = open.sh.getRange(open.r, C.timeOut).getValue();
    const bill = visitBill(open.sh, open.r, tag);
    if (tag.isPass) {
      // No exceptRow: the current visit's elapsed time counts toward the used minutes
      const left = passMinutesLeftToday(tag, token);
      return { action: 'ask', name: tag.name, endTime: fmt(end), isPass: true,
               remainingMin: left, canExtend: false, noExtend: left === 0, bill: bill };
    }
    return { action: 'ask', name: tag.name, endTime: fmt(end), isPass: false,
             remainingMin: null, canExtend: true, noExtend: false, bill: bill };
  }

  if (open) {
    const sh = open.sh, r = open.r;
    const now = new Date();
    const cur = sh.getRange(r, C.timeOut).getValue();
    sh.getRange(r, C.timeIn).setValue(now);
    if (!(cur instanceof Date) || cur <= now) {
      sh.getRange(r, C.timeOut).setValue(new Date(now.getTime() + MIN_HOURS * 3600000));
    }
    formatTimes(sh, r);
    sh.getRange(r, C.status).setValue('In');
    SpreadsheetApp.flush();
    recalcTotal(sh, r);
    const end = sh.getRange(r, C.timeOut).getValue();
    return { action: 'in', time: fmt(now), name: tag.name, endTime: fmt(end),
             bill: visitBill(sh, r, tag) };
  }

  if (tag.isPass) {
    const left = passMinutesLeftToday(tag, token);
    if (left === 0) throw new Error('You have used your ' + PASS_DAILY_CAP_HOURS + ' hours for today. Please come back tomorrow.');
    return { action: 'form', name: tag.name, category: tag.category, isPass: true,
             remainingMin: left, maxHours: left === null ? 24 : Math.min(24, Math.ceil(left / 60)) };
  }
  return { action: 'form', name: tag.name, category: tag.category, isPass: false,
           remainingMin: null, maxHours: 24 };
}

// Form submitted on the first tap: creates today's visit as In.
// The Name column shows the card name and guest name, for example "Sync 1 : Jiji".
// The Personnel column is filled only when exactly one staff member is on duty.
// Walk-ins always use multiplier 1. Pass visits are recorded at 0.
// A pass visit is capped at the minutes left today.
function handleCheckin(b) {
  const tag = findTag(b.token);
  if (!tag) throw new Error('Unknown NFC card');
  if (findOpenRow(b.token)) throw new Error('This card is already checked in');

  const guest = String(b.name || '').trim();
  if (!guest) throw new Error('Type your name');

  const school = String(b.school || '').trim();
  if (b.purpose === 'School' && !school) throw new Error('Type the name of your school');
  const purpose = b.purpose === 'School' ? 'School: ' + school : 'Work';

  const duration = Number(b.duration);
  if (!(duration >= 1 && duration <= 24)) throw new Error('Choose a duration');

  let minutes = duration * 60;
  let paid, payment;
  if (tag.isPass) {
    passCheckValid(tag);
    const left = passMinutesLeftToday(tag, b.token);
    if (left !== null) {
      if (left <= 0) throw new Error('You have used your ' + PASS_DAILY_CAP_HOURS + ' hours for today. Please come back tomorrow.');
      minutes = Math.min(minutes, left);   // stay cannot run past today's limit
    }
    paid = 'Paid'; payment = 'Pass';
  } else {
    if (!tag.category) throw new Error('This card has no category. Make a new card.');
    getRate(tag.category);   // throws if not in Settings
    paid = 'Unpaid'; payment = '';
  }

  const timeIn = new Date();
  timeIn.setSeconds(0, 0);
  const timeOut = new Date(timeIn.getTime() + minutes * 60000);
  const today = Utilities.formatDate(timeIn, TZ, 'yyyy-MM-dd');
  const rate = tag.isPass ? 0 : getRate(tag.category);

  // Room tag shown in the Name column, for example "Sync 1 : Jiji" or "Weekly Pass : Jiji"
  const roomName = (tag.isPass ? tag.category : tag.name) + ' : ' + guest;

  const sh = dayTab(today);
  sh.appendRow([roomName, new Date(today + 'T00:00:00+08:00'), purpose, timeIn, timeOut, autoPersonnel(),
                '', rate, '', b.token, 'In', paid, payment, '', '']);
  const r = sh.getLastRow();
  formatTimes(sh, r);
  writeFormulas(sh, r);
  setVisitHelpers(sh, r, tag.category, 1);
  recalcTotal(sh, r);

  return { action: 'in', time: fmt(timeIn), name: roomName, endTime: fmt(timeOut),
           bill: visitBill(sh, r, tag) };
}

function handleExtend(b) {
  const open = findOpenRow(b.token);
  if (!open || open.status !== 'In') throw new Error('No active visit to extend');

  const tag = findTag(b.token);
  if (tag && tag.isPass) throw new Error('Pass visits cannot be extended. Please check out.');

  const hours = Number(b.hours);
  if (!(hours >= 1 && hours <= 24)) throw new Error('Choose 1 to 24 hours');

  const sh = open.sh, r = open.r;
  const cur = sh.getRange(r, C.timeOut).getValue();
  const base = cur instanceof Date ? Math.max(cur.getTime(), Date.now()) : Date.now();
  const newEnd = new Date(base + hours * 3600000);

  sh.getRange(r, C.timeOut).setValue(newEnd);
  formatTimes(sh, r);
  SpreadsheetApp.flush();
  recalcTotal(sh, r);
  return { action: 'ask', extended: true, added: hours, name: tag ? tag.name : '',
           endTime: fmt(newEnd), isPass: false, remainingMin: null,
           canExtend: true, noExtend: false, bill: visitBill(sh, r, tag) };
}

function handleLeave(token) {
  const open = findOpenRow(token);
  if (!open || open.status !== 'In') throw new Error('No active visit to check out');

  const sh = open.sh, r = open.r;
  const tag = findTag(token);
  const tIn = sh.getRange(r, C.timeIn).getValue();

  const now = new Date();
  now.setSeconds(0, 0);
  const outAt = now;   // bill actual time, including any overtime

  sh.getRange(r, C.timeOut).setValue(outAt);
  sh.getRange(r, C.status).setValue('Out');
  formatTimes(sh, r);
  SpreadsheetApp.flush();
  recalcTotal(sh, r);

  snapshotVisit(sh, r);
  const bill = visitBill(sh, r, tag);

  // Exact minutes used by this visit (not billed hours)
  const usedMin = tIn instanceof Date ? Math.max(0, Math.round((outAt - tIn) / 60000)) : 0;
  const isPass = !!(tag && tag.isPass);
  const leftMin = isPass ? passMinutesLeftToday(tag, token) : null;

  const hours = sh.getRange(r, C.hours).getValue();
  const total = sh.getRange(r, C.total).getValue();
  const name = sh.getRange(r, C.name).getValue();
  return { action: 'out', time: fmt(outAt), name: name, isPass: isPass,
           usedMin: usedMin, leftMin: leftMin, hours: hours, total: total, bill: bill };
}
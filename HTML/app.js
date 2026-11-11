// ---- Connection ----
// Must be the URL of the CURRENT deployment (Deploy > Manage deployments > New version)
const API_URL = 'https://script.google.com/macros/s/AKfycbzlzbiuTATPOKUXBTQubIVFvLIgiHbWeUeZXTaUEgXV8NgiZb1JxZKf0HACJ4--dHHomA/exec';
const TZ = 'Asia/Manila';
const REFRESH_MS = 5 * 60 * 1000;   // reload the numbers every 5 minutes

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const PASS_NAMES = ['Weekly Pass', 'Monthly Pass'];
const $ = id => document.getElementById(id);

// Kept in memory only, so a page refresh locks the dashboard again
let staffPin = '';
let data = null;          // last dashboard response
let lastUpdated = '';     // time of the last good load, shown if a refresh fails
let period = 'daily';     // daily | weekly | monthly
let recentRange = 7;      // days shown in the Past days panel
let selectedStaff = null; // staff member whose clients are listed
let refreshTimer = null;

// ---- Formatting helpers ----

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 1234.5 -> "₱1,234.50", 120 -> "₱120" (no .00 on whole pesos)
function peso(n) {
  const v = Math.round(Number(n || 0) * 100) / 100;
  const whole = v % 1 === 0;
  return '₱' + v.toLocaleString('en-PH', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

// Small line icons (Lucide shapes) for the dashboard cards
const ICONS = {
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>'
};
function icon(name) {
  return `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

// Rounds to 2 decimals (centavos)
function r2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString('en-PH');
}

// Averages can be fractions, so show up to one decimal
function fmtAvg(n) {
  return Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 1 });
}

// '2026-10-22' -> 'Oct 22, 2026'  (month, day, year)
function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return MONTHS[m - 1] + ' ' + d + ', ' + y;
}

// Full label for tables and tooltips
function fullLabel(p, label) {
  if (p === 'daily') return dayLabel(label);
  if (p === 'weekly') return 'Week of ' + dayLabel(label);
  const [y, m] = label.split('-').map(Number);
  return MONTHS[m - 1] + ' ' + y;
}

// Short label under each bar
function shortLabel(p, label) {
  if (p === 'daily') return String(Number(label.split('-')[2]));
  if (p === 'weekly') {
    const [, m, d] = label.split('-').map(Number);
    return MONTHS[m - 1] + ' ' + d;
  }
  return MONTHS[Number(label.split('-')[1]) - 1];
}

// Short weekday name for a 'yyyy-MM-dd' date, in Manila time
function weekdayOf(iso) {
  return new Date(iso + 'T00:00:00+08:00').toLocaleDateString('en-PH', { weekday: 'short', timeZone: TZ });
}

// Monday of a 'yyyy-MM-dd' date (same rule as the server)
function mondayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt.toISOString().slice(0, 10);
}

// Percent change, or null when there is no earlier value to compare with
function pctChange(cur, prev) {
  if (!prev) return cur ? null : 0;
  return Math.round((cur - prev) / prev * 100);
}

// Green arrow up, red arrow down, grey for no change
function chgTag(pct, text) {
  if (pct === null) return `<span class="chg up">▲ New</span><span class="chg-sub">${esc(text)}</span>`;
  if (pct === 0) return `<span class="chg">No change</span><span class="chg-sub">${esc(text)}</span>`;
  return pct > 0
    ? `<span class="chg up">▲ ${pct}%</span><span class="chg-sub">${esc(text)}</span>`
    : `<span class="chg down">▼ ${Math.abs(pct)}%</span><span class="chg-sub">${esc(text)}</span>`;
}

function periodWord() {
  return { daily: 'today', weekly: 'this week', monthly: 'this month' }[period];
}

// Key used by the server's staff data for the selected period
function periodKey() {
  return { daily: 'today', weekly: 'week', monthly: 'month' }[period];
}

// Minutes -> "2 hr 15 min"
function fmtMin(m) {
  m = Math.max(0, Math.round(Number(m) || 0));
  const h = Math.floor(m / 60), mm = m % 60;
  return (h ? h + ' hr ' : '') + mm + ' min';
}

// Clock-in time, in Manila time: "9:48 PM"
function clockTime(iso) {
  return new Date(iso).toLocaleTimeString('en-PH', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
}

// Time since clock-in: "2 hr 15 min"
function elapsedSince(iso) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 60000));
  const h = Math.floor(m / 60), mm = m % 60;
  return (h ? h + ' hr ' : '') + mm + ' min';
}

// 12-hour picker values -> 'HH:MM' (24-hour), for the server
const pad = n => String(n).padStart(2, '0');

function to24(h, m, ap) {
  let hh = Number(h) % 12;
  if (ap === 'PM') hh += 12;
  return pad(hh) + ':' + m;
}

// 'HH:MM' (24-hour) -> '2:00 PM'
function fmt12str(hhmm) {
  let [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + pad(m) + ' ' + ap;
}

// Same package rule as the server: packages only if they fit inside the hours.
// Examples: 7 hrs Focus = 195, 8 hrs Focus = 230, 10 hrs Focus = 200.
function tierPriceJs(hours, t) {
  if (!t || hours <= 0) return 0;
  const bundles = [[1, t.h1], [3, t.h3], [6, t.h6], [10, t.h10]].filter(b => b[1] > 0);
  if (!bundles.length) return 0;
  const cost = [0];
  for (let h = 1; h <= hours; h++) {
    let best = Infinity;
    bundles.forEach(([n, p]) => {
      if (n > h) return;
      const v = cost[h - n] + p;
      if (v < best) best = v;
    });
    cost[h] = best;
  }
  return cost[hours];
}

// ---- Page helpers ----

function show(id) {
  ['booking', 'tap', 'pin', 'dash'].forEach(v => { $(v).hidden = v !== id; });
  $('loading').hidden = true;
}

// Shows a spinner on a button and blocks clicks while work is running
function setBusy(btn, on) {
  btn.classList.toggle('busy', on);
  btn.disabled = on;
}

function fail(msg) {
  $('loading').hidden = true;
  $('error').hidden = false;
  $('error').textContent = 'Error: ' + msg;
}

// Reads the reply as text first, so a non-JSON page gives a clear message
async function parseReply(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('Server reply was not valid. Check the Apps Script deployment.');
  }
}

async function post(body) {
  let res;
  try {
    res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(body) });
  } catch (e) {
    throw new Error('Cannot reach the server. In Apps Script, set Who has access to Anyone, then deploy a new version.');
  }
  return parseReply(res);
}

// Package prices for a room, as sent by the server. Throws if they are missing,
// so an out-of-date server can never produce a wrong price.
function tiersOf(c) {
  if (!c.tiers || c.tiers.h1 === undefined) {
    throw new Error('Server is out of date for ' + c.name + '. Deploy a new version of the Apps Script, then reload.');
  }
  return c.tiers;
}

// ---- Booking flow (root link) ----
const TIERS = {};     // room name -> { h1, h3, h6, h10 } package prices
const FLAT = {};      // room name -> true if billed a flat rate (not per person)
const LIMITS = {};    // room name -> { min, max } people
let S = {};           // booking in progress
let plan = 'Full';    // Full | Down (50% downpayment)

// Shows the chosen date as "Oct 31, 2026"
function syncDate() {
  const v = $('bookDate').value;
  $('dateTxt').textContent = v ? dayLabel(v) : 'Pick a date';
}
$('bookDate').onchange = syncDate;
$('bookDate').oninput = syncDate;

// Moves between the three booking steps and updates the progress bar
function goStep(n) {
  [1, 2, 3].forEach(i => { $('step' + i).hidden = i !== n; });
  $('stepLabel').textContent = 'Step ' + n + ' of 3';
  [1, 2, 3].forEach(i => $('sb' + i).classList.toggle('on', i <= n));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function showBooking() {
  show('booking');
  goStep(1);
  $('bookDate').value = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  syncDate();

  $('bookHour').innerHTML = [...Array(12)].map((_, i) => `<option>${i + 1}</option>`).join('');
  $('bookHour').value = '9';
  $('bookMin').innerHTML = ['00', '15', '30', '45'].map(m => `<option>${m}</option>`).join('');
  $('bookAmpm').value = 'AM';
  $('bookHours').innerHTML = [...Array(24)].map((_, i) =>
    `<option value="${i + 1}">${i + 1} ${i === 0 ? 'hr' : 'hrs'}</option>`).join('');
  $('bookHours').value = '1';

  $('bookCategory').innerHTML = '<option>Loading rooms…</option>';
  $('bookCategory').disabled = true;
  setBusy($('next1'), true);
  try {
    const res = await fetch(API_URL);
    const r = await parseReply(res);
    if (!r.ok) throw new Error(r.error || 'Could not load rooms');
    r.categories.forEach(c => {
      TIERS[c.name] = tiersOf(c);
      FLAT[c.name] = !!c.flat;
      LIMITS[c.name] = { min: c.minPeople, max: c.maxPeople };
    });
    $('bookCategory').innerHTML = r.categories.map(c =>
      `<option value="${esc(c.name)}">${esc(c.name)} (₱${esc(TIERS[c.name].h1)}/hr)</option>`).join('');
    updatePeopleLimit();
  } catch (e) {
    fail(e.message);
  } finally {
    $('bookCategory').disabled = false;
    setBusy($('next1'), false);
  }
}

// Keeps the People box within the chosen room's limits
function updatePeopleLimit() {
  const lim = LIMITS[$('bookCategory').value];
  if (!lim) return;
  const p = $('bookPeople');
  p.min = lim.min;
  p.max = lim.max;
  if (Number(p.value) < lim.min || Number(p.value) > lim.max) p.value = lim.min;
  $('peopleHint').textContent = 'Holds ' + lim.min + ' to ' + lim.max + ' persons';
}
$('bookCategory').onchange = updatePeopleLimit;

// Work or School
document.querySelectorAll('[data-purpose]').forEach(btn => {
  btn.onclick = () => {
    const isSchool = btn.dataset.purpose === 'School';
    document.querySelectorAll('[data-purpose]').forEach(b =>
      b.setAttribute('aria-pressed', String(b === btn)));
    $('schoolWrap').hidden = !isSchool;
  };
});

// Full payment or 50% downpayment
document.querySelectorAll('[data-plan]').forEach(btn => {
  btn.onclick = () => {
    plan = btn.dataset.plan;
    document.querySelectorAll('[data-plan]').forEach(b =>
      b.setAttribute('aria-pressed', String(b === btn)));
  };
});

// Step 1 -> Step 2
$('next1').onclick = () => {
  const name = $('bookName').value.trim();
  const date = $('bookDate').value;
  const category = $('bookCategory').value;
  const people = Math.max(1, Number($('bookPeople').value) || 1);
  const isSchool = !$('schoolWrap').hidden;
  const school = $('bookSchool').value.trim();

  if (!name || !date || !category) {
    $('msg1').textContent = 'Name, date and room are required';
    return;
  }
  const lim = LIMITS[category];
  if (lim && (people < lim.min || people > lim.max)) {
    $('msg1').textContent = category + ' allows ' + lim.min + ' to ' + lim.max + ' persons';
    return;
  }
  if (isSchool && !school) {
    $('msg1').textContent = 'Type the name of the school';
    return;
  }

  const hours = Number($('bookHours').value);
  const startHHMM = to24($('bookHour').value, $('bookMin').value, $('bookAmpm').value);
  const [sh, sm] = startHHMM.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = (startMin + hours * 60) % 1440;
  const nextDay = startMin + hours * 60 >= 1440;

  const perPerson = tierPriceJs(hours, TIERS[category]);
  const total = r2(perPerson * (FLAT[category] ? 1 : people));   // bookings: price x people
  const down = plan === 'Down' ? r2(total / 2) : total;           // amount paid now
  const balance = r2(total - down);                               // left to pay later

  S = {
    name, date, category, people, hours,
    purpose: isSchool ? 'School: ' + school : 'Work',
    startHHMM,
    endHHMM: pad(Math.floor(endMin / 60)) + ':' + pad(endMin % 60),
    nextDay,
    perPerson, total, down, balance, plan
  };

  $('msg1').textContent = '';
  renderSummary();
  goStep(2);
};

function renderSummary() {
  const rows = [
    ['Name', S.name],
    ['Date', dayLabel(S.date)],
    ['Room', S.category],
    ['People', S.people],
    ['Purpose', S.purpose],
    ['Time in', fmt12str(S.startHHMM)],
    ['Time out', fmt12str(S.endHHMM) + (S.nextDay ? ' (next day)' : '')],
    ['Duration', S.hours + (S.hours === 1 ? ' hr' : ' hrs')],
    ['Price per person', peso(S.perPerson)],
    ['Payment option', S.plan === 'Down' ? '50% downpayment' : 'Full payment'],
  ];

  let bottom;
  if (S.plan === 'Down') {
    bottom =
      `<tr><td>Total</td><td>${peso(S.total)}</td></tr>` +
      `<tr><td>Downpayment (50%) due now</td><td>${peso(S.down)}</td></tr>` +
      `<tr class="total"><td>Balance (50%) to pay later</td><td>${peso(S.balance)}</td></tr>`;
  } else {
    bottom = `<tr class="total"><td>Total due</td><td>${peso(S.total)}</td></tr>`;
  }

  $('summary').innerHTML =
    rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('') + bottom;
}

// Step 2 -> Step 3
$('next2').onclick = () => {
  $('dueAmt').textContent = peso(S.down);
  $('dueLabel').textContent = S.plan === 'Down' ? 'Downpayment due now' : 'Amount due';
  $('balNote').hidden = S.plan !== 'Down';
  $('balNote').textContent = 'Remaining balance of ' + peso(S.balance) + ' to be paid later.';
  goStep(3);
};

$('back2').onclick = () => goStep(1);
$('back3').onclick = () => goStep(2);

// Step 3: save the booking (GCash is the only payment method)
$('saveBtn').onclick = async () => {
  setBusy($('saveBtn'), true);
  $('bookMsg').textContent = '';
  try {
    const r = await post({
      action: 'visit',
      name: S.name,
      date: S.date,
      category: S.category,
      people: S.people,
      timeIn: S.startHHMM,
      timeOut: S.endHHMM,
      purpose: S.purpose,
      payment: 'GCash',
      plan: S.plan,
      downpayment: S.down,
      balance: S.balance
    });
    if (!r.ok) throw new Error(r.error);

    // Clear the form and go back to step 1
    $('bookName').value = '';
    $('bookSchool').value = '';
    $('bookPeople').value = '1';
    S = {};
    plan = 'Full';
    document.querySelectorAll('[data-plan]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.plan === 'Full')));
    updatePeopleLimit();
    goStep(1);
    $('msg1').className = 'msg ok';
    $('msg1').textContent = 'Booking saved.';
  } catch (e) {
    $('bookMsg').className = 'msg err';
    $('bookMsg').textContent = e.message;
  } finally {
    setBusy($('saveBtn'), false);
  }
};

// ---- NFC tap in / out (?t=TOKEN) ----
const TAP_TOKEN = new URLSearchParams(location.search).get('t');

async function tapAction(body) {
  $('tapBody').innerHTML = '<div class="loader"><span class="spin"></span>Please wait…</div>';
  try {
    const r = await post(body);
    if (!r.ok) throw new Error(r.error);
    renderTap(r, body.token);
  } catch (e) {
    $('tapBody').innerHTML = `<div class="status err">${esc(e.message)}</div>`;
  }
}

function startTap(token) {
  show('tap');
  tapAction({ action: 'tap', token });
}

// Bill summary card for the tap screen.
// label: the line above the amount, for example "Estimated total" or "Total due"
function billHtml(b, label) {
  if (!b) return '';
  const lines = [
    ['Room', b.room || '-'],
    ['Time in', fmt12str(b.timeIn)],
    ['Time out', fmt12str(b.timeOut)],
    ['Time used', fmtMin(b.minutes)],
    ['Billed', b.hours + (b.hours === 1 ? ' hr' : ' hrs')]
  ];

  const rows = lines.map(([k, v]) =>
    `<div class="bill-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');

  const total = b.isPass
    ? `<div class="bill-total"><span>Covered by your pass</span><b>${peso(0)}</b></div>`
    : `<div class="bill-total"><span>${esc(label)}</span><b>${peso(b.total)}</b></div>
       <p class="bill-note">1 hour covers up to 80 minutes (60 min + 20 min grace). Longer stays use the rate card packages.</p>`;

  return `<div class="bill"><div class="bill-title">Bill summary</div>${rows}${total}</div>`;
}

function renderTap(r, token) {
  const body = $('tapBody');
  const name = esc(r.name || '');

  // First tap: walk-in form (guest name, Work or School, then duration)
  if (r.action === 'form') {
    const max = r.maxHours || 24;
    const opts = [...Array(max)].map((_, i) =>
      `<option value="${i + 1}">${i + 1} ${i === 0 ? 'hr' : 'hrs'}</option>`).join('');
    const passNote = r.isPass && r.remainingMin !== null
      ? `<p class="hint">Pass time left today: ${fmtMin(r.remainingMin)}</p>` : '';

    body.innerHTML = `
      <div class="title">Welcome, LCKieee!</div>
      <p class="subtitle">Check in for a visit</p>
      <label for="tName">Your name</label>
      <input id="tName" autocomplete="name">
      <label>Purpose</label>
      <div class="seg full">
        <button type="button" id="tWork" aria-pressed="true">Work</button>
        <button type="button" id="tSchool" aria-pressed="false">School</button>
      </div>
      <div id="tSchoolWrap" hidden>
        <label for="tSchoolName">School name</label>
        <input id="tSchoolName">
      </div>
      <label for="tDur">Duration</label>
      <select id="tDur">${opts}</select>
      ${passNote}
      <button type="button" id="tStart" class="dark">Check in</button>
      <p id="tMsg" class="msg err" role="alert"></p>`;

    let purpose = 'Work';
    const setPurpose = p => {
      purpose = p;
      $('tWork').setAttribute('aria-pressed', String(p === 'Work'));
      $('tSchool').setAttribute('aria-pressed', String(p === 'School'));
      $('tSchoolWrap').hidden = p !== 'School';
    };
    $('tWork').onclick = () => setPurpose('Work');
    $('tSchool').onclick = () => setPurpose('School');

    $('tStart').onclick = () => {
      const guest = $('tName').value.trim();
      if (!guest) {
        $('tMsg').textContent = 'Type your name';
        return;
      }
      const school = $('tSchoolName').value.trim();
      if (purpose === 'School' && !school) {
        $('tMsg').textContent = 'Type the name of your school';
        return;
      }
      tapAction({ action: 'checkin', token, name: guest, purpose, school, duration: $('tDur').value });
    };
    return;
  }

  // Checked in, already checked in, or just extended: time, bill summary, extend, check out
  if (r.action === 'in' || r.action === 'ask') {
    const isNew = r.action === 'in';
    const canExtend = r.action === 'ask' && r.canExtend && !r.noExtend;
    const billLabel = isNew ? 'Estimated total' : (r.extended ? 'Updated total' : 'Current total');

    const when = r.time ? 'Checked in at ' + esc(fmt12str(r.time)) + '. ' : '';
    const added = r.extended
      ? `<p class="hint">Added ${esc(r.added)} ${Number(r.added) === 1 ? 'hr' : 'hrs'}. The total below is updated.</p>` : '';
    const passLeft = r.isPass && r.remainingMin !== null
      ? `<p class="hint">Pass time left today: ${fmtMin(r.remainingMin)}</p>` : '';
    const usedUp = r.noExtend
      ? '<p class="hint">Your daily pass hours are used up. Check out when you leave.</p>' : '';
    const extendBlock = canExtend ? `
      <label for="tExtHours">Add time</label>
      <select id="tExtHours">${[...Array(24)].map((_, i) =>
        `<option value="${i + 1}">${i + 1} ${i === 0 ? 'hr' : 'hrs'}</option>`).join('')}</select>
      <button type="button" id="tExtend" class="ghost">Extend</button>` : '';

    body.innerHTML = `
      <div class="title">${isNew ? 'Checked in' : 'Currently checked in'}</div>
      <p class="subtitle">${name}</p>
      <div class="status">${when}Until ${esc(fmt12str(r.endTime))}</div>
      ${added}
      ${passLeft}
      ${usedUp}
      ${billHtml(r.bill, billLabel)}
      ${extendBlock}
      <button type="button" id="tLeave" class="dark">Check out</button>`;

    if (canExtend) {
      $('tExtend').onclick = () => tapAction({ action: 'extend', token, hours: $('tExtHours').value });
    }
    $('tLeave').onclick = () => tapAction({ action: 'leave', token });
    return;
  }

  // Checked out: time out, bill summary with the total due
  if (r.action === 'out') {
    const passLeft = r.isPass && r.leftMin !== null
      ? `<div>Pass time left today ${fmtMin(r.leftMin)}</div>` : '';

    body.innerHTML = `
      <div class="title">Checked out</div>
      <p class="subtitle">${name}</p>
      <div class="status">
        <div>Time out ${esc(fmt12str(r.time))}</div>
        ${passLeft}
      </div>
      ${billHtml(r.bill, 'Total due')}
      <p class="hint">Thank you for visiting LCKDIN Study Hub.</p>`;
    return;
  }

  body.innerHTML = '<div class="status err">Unexpected reply. Please try again.</div>';
}

// ---- Staff sign in ----
async function unlock(pin) {
  const r = await post({ action: 'checkPin', pin });
  if (!r.ok) throw new Error(r.error);
  staffPin = pin;
}

function askPin() {
  show('pin');
  $('pinInput').value = '';
  $('pinMsg').textContent = '';
  $('pinBtn').onclick = async () => {
    setBusy($('pinBtn'), true);
    try {
      await unlock($('pinInput').value);
      await loadConfig();
      await loadDashboard();
      show('dash');
      clearInterval(refreshTimer);
      refreshTimer = setInterval(loadDashboard, REFRESH_MS);
    } catch (e) {
      $('pinMsg').textContent = e.message;
    } finally {
      setBusy($('pinBtn'), false);
    }
  };
  // Enter key unlocks too
  $('pinInput').onkeydown = e => { if (e.key === 'Enter') $('pinBtn').click(); };
}

// ---- Dashboard data ----

// Placeholder shapes shown on the dashboard until the first data arrives
function showDashSkeleton() {
  $('kpis').innerHTML = [0, 1, 2, 3].map(() => '<div class="skel" style="height:112px"></div>').join('');
  $('recentGrid').innerHTML = [0, 1, 2, 3, 4, 5, 6].map(() => '<div class="skel" style="height:170px"></div>').join('');
  $('recentSum').textContent = '';
  $('chartBox').innerHTML = '<div class="skel" style="height:260px"></div>';
  $('staffBody').innerHTML = '<tr><td colspan="5"><div class="skel" style="height:120px"></div></td></tr>';
  $('liveList').innerHTML = [0, 1, 2].map(() => '<li><div class="skel" style="height:40px;grid-column:1/-1"></div></li>').join('');
  $('liveWord').textContent = '';
  $('liveCount').textContent = '';
  $('updated').textContent = 'Loading…';
}

async function loadDashboard() {
  setBusy($('refreshBtn'), true);
  $('dashErr').hidden = true;
  if (!data) showDashSkeleton();
  else $('updated').textContent = 'Updating…';
  try {
    const r = await post({ action: 'dashboard', pin: staffPin });
    if (!r.ok) throw new Error(r.error);
    data = r;
    renderAll();
    lastUpdated = new Date().toLocaleTimeString('en-PH', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
    $('updated').textContent = 'Updated ' + lastUpdated;
  } catch (e) {
    if (/PIN/.test(e.message)) {
      staffPin = '';
      location.reload();
      return;
    }
    $('dashErr').hidden = false;
    $('dashErr').textContent = 'Could not load the dashboard: ' + e.message;
    if (lastUpdated) $('updated').textContent = 'Updated ' + lastUpdated;
  } finally {
    setBusy($('refreshBtn'), false);
  }
}

// Header chip: who is clocked in right now
function renderOnDuty() {
  const list = data.onDuty || [];
  const chip = $('dutyChip');
  chip.classList.toggle('off', !list.length);
  if (!list.length) {
    chip.innerHTML = '<i class="dot"></i>No one on duty';
    chip.title = '';
  } else if (list.length === 1) {
    const s = list[0];
    chip.innerHTML = `<i class="dot"></i>${esc(s.name)} on duty <small>· ${esc(elapsedSince(s.since))}</small>`;
    chip.title = 'Clocked in ' + clockTime(s.since);
  } else {
    chip.innerHTML = `<i class="dot"></i>${list.length} on duty`;
    chip.title = list.map(s => s.name + ' since ' + clockTime(s.since)).join('\n');
  }
}

// Time in from the server: ISO date-time or 'HH:MM' (today, Manila time)
function timeInDate(t) {
  if (!t) return null;
  if (/^\d{1,2}:\d{2}$/.test(t)) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
    return new Date(today + 'T' + t.padStart(5, '0') + ':00+08:00');
  }
  const d = new Date(t);
  return isNaN(d) ? null : d;
}

// Live rail: open visits (checked in, not yet checked out).
// Needs `openVisits` in the dashboard response from Apps Script:
// [{ room, guest, timeIn, bill }]
function renderLive() {
  const list = data.openVisits;
  if (!Array.isArray(list)) {
    $('liveCount').textContent = '';
    $('liveWord').textContent = '';
    $('liveList').innerHTML = '<li class="empty">Live visits will show here once the Apps Script sends open visits.</li>';
    return;
  }
  const rows = list.slice().sort((a, b) => (timeInDate(a.timeIn) || 0) - (timeInDate(b.timeIn) || 0));
  $('liveCount').textContent = rows.length;
  $('liveWord').textContent = rows.length
    ? 'Checked in and not yet checked out · running bill so far'
    : '';
  $('liveList').innerHTML = rows.length
    ? rows.map(v => {
        const d = timeInDate(v.timeIn);
        const when = d ? 'In ' + clockTime(d) + ' · ' + elapsedSince(d) : '';
        return `
        <li>
          <span class="room">${esc(v.room || 'Walk-in')} <span class="guest">· ${esc(v.guest || 'Guest')}</span></span>
          <b class="amt">${v.bill == null ? '' : peso(v.bill)}</b>
          <span class="when">${esc(when)}</span>
        </li>`;
      }).join('')
    : '<li class="empty">No one is checked in right now.</li>';
}

// Redraws every dashboard section from the last response
function renderAll() {
  if (!data) return;
  renderOnDuty();
  renderLive();
  renderKpis();
  renderRecent();
  renderChart();
  renderTable();
  renderStaff();
  renderClients();
  renderPayMethods();
  renderPasses();
  renderAverages();
}

// Headline cards: sales, visitors, average sale, unpaid
function renderKpis() {
  const ser = data[period];
  const cur = ser[ser.length - 1];
  let prev = ser[ser.length - 2] || { sales: 0, visitors: 0 };

  const curName = { daily: 'today', weekly: 'this week', monthly: 'this month' }[period];
  let vsName = { daily: 'vs all of yesterday', weekly: 'vs last week', monthly: 'vs last month' }[period];

  // Day view: compare with yesterday up to the same time, when the server sends it,
  // so a morning isn't measured against a full day.
  const ySoFar = data.yesterdaySoFar;
  if (period === 'daily' && ySoFar && typeof ySoFar.sales === 'number') {
    prev = { sales: ySoFar.sales, visitors: ySoFar.visitors || 0 };
    vsName = 'vs same time yesterday';
  }

  const avgCur = cur.visitors ? cur.sales / cur.visitors : 0;
  const avgPrev = prev.visitors ? prev.sales / prev.visitors : 0;
  const unpaid = data.totals.unpaid;

  $('kpis').innerHTML = `
    <div class="kcard">
      <div class="klabel">${icon('wallet')}Sales ${curName}</div>
      <div class="kvalue">${peso(cur.sales)}</div>
      <div>${chgTag(pctChange(cur.sales, prev.sales), vsName)}</div>
    </div>
    <div class="kcard">
      <div class="klabel">${icon('users')}Visitors ${curName}</div>
      <div class="kvalue">${fmtNum(cur.visitors)}</div>
      <div>${chgTag(pctChange(cur.visitors, prev.visitors), vsName)}</div>
    </div>
    <div class="kcard">
      <div class="klabel">${icon('receipt')}Avg sale per visit</div>
      <div class="kvalue">${peso(avgCur)}</div>
      <div>${chgTag(pctChange(Math.round(avgCur), Math.round(avgPrev)), vsName)}</div>
    </div>
    <div class="kcard ${unpaid > 0 ? 'alert' : ''}">
      <div class="klabel">${icon('alert')}Unpaid balance</div>
      <div class="kvalue">${peso(unpaid)}</div>
      <div class="ksub">${unpaid > 0 ? 'All time · visits not yet fully paid' : 'Nothing outstanding'}</div>
    </div>`;
}

// Past days: one tile per day, visitors first, sales underneath.
// The bar is sized to that day's visitors.
function renderRecent() {
  const n = recentRange;
  const days = data.daily.slice(-n);
  const todayIso = data.daily[data.daily.length - 1].label;
  const max = Math.max(1, ...days.map(d => d.visitors));

  const totV = days.reduce((a, d) => a + d.visitors, 0);
  const totS = days.reduce((a, d) => a + d.sales, 0);
  const avgDay = totS / n;

  $('recentWord').textContent = 'Last ' + n + ' days, including today';

  $('recentGrid').innerHTML = days.map(d => {
    const h = Math.max(4, Math.round(d.visitors / max * 100));
    const short = dayLabel(d.label).replace(/,\s\d{4}$/, '');
    const isToday = d.label === todayIso;
    return `
      <div class="day ${isToday ? 'today' : ''}" title="${esc(dayLabel(d.label))}">
        <div class="dw">${isToday ? '<span class="tag">Today</span>' : esc(weekdayOf(d.label))}</div>
        <div class="dd">${esc(short)}</div>
        <div class="dbar"><i style="height:${h}%"></i></div>
        <div class="dv">${fmtNum(d.visitors)}<small>visitor${d.visitors === 1 ? '' : 's'}</small></div>
        <div class="ds">${peso(d.sales)}</div>
      </div>`;
  }).join('');

  $('recentSum').innerHTML =
    '<b>' + fmtNum(totV) + '</b> visitors and <b>' + peso(totS) + '</b> sales over these ' + n +
    ' days. Average per day: <b>' + fmtAvg(totV / n) + '</b> visitors, <b>' + peso(avgDay) + '</b> sales.';
}

// Round step for an axis: 1, 2, 2.5 or 5 times a power of ten
function niceStep(raw) {
  if (raw <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

// Periods shown in the chart. Day view follows the Past days switch (3/7/14).
// Leading periods with no visits and no sales are dropped, so the chart starts
// where the data starts.
function chartSeries() {
  let ser = data[period];
  if (period === 'daily') ser = ser.slice(-recentRange);
  const first = ser.findIndex(s => s.visitors > 0 || s.sales > 0);
  return first > 0 ? ser.slice(first) : ser;
}

// Combo chart: visitors as bars (left scale), sales as a line (right scale).
// The current period's point is orange; the busiest period gets a small label.
function renderChart() {
  const ser = chartSeries();
  const n = ser.length;
  const curLabel = data[period][data[period].length - 1].label;

  const W = 700, H = 280, pl = 40, pr = 56, pt = 22, pb = 32;
  const iw = W - pl - pr, ih = H - pt - pb;

  const vRaw = Math.max(0, ...ser.map(s => s.visitors));
  const sRaw = Math.max(0, ...ser.map(s => s.sales));
  const vStep = niceStep(vRaw / 4 || 2.5), sStep = niceStep(sRaw / 4 || 250);
  const ticks = Math.max(1, Math.ceil(vRaw / vStep), Math.ceil(sRaw / sStep));
  const vMax = vStep * ticks, sMax = sStep * ticks;

  let peak = 0;
  ser.forEach((s, i) => { if (s.visitors > ser[peak].visitors) peak = i; });

  const slot = iw / n;
  const bw = Math.max(6, Math.min(32, slot * 0.55));
  const cx = i => pl + slot * i + slot / 2;
  const yV = v => pt + ih - (v / vMax) * ih;
  const yS = v => pt + ih - (v / sMax) * ih;

  // Grid lines and both axis scales
  let grid = '';
  for (let k = 0; k <= ticks; k++) {
    const y = pt + ih - ih * k / ticks;
    grid += `<line class="grid${k === 0 ? ' base' : ''}" x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}"></line>`;
    grid += `<text class="axis" x="${pl - 8}" y="${y + 4}" text-anchor="end">${fmtNum(vStep * k)}</text>`;
    grid += `<text class="axis" x="${W - pr + 8}" y="${y + 4}" text-anchor="start">₱${fmtNum(sStep * k)}</text>`;
  }

  // Bars: visitors, with a tooltip on each
  let bars = '';
  ser.forEach((s, i) => {
    const y = yV(s.visitors);
    const h = Math.max(0, pt + ih - y);
    const cls = s.label === curLabel ? 'bar today' : 'bar';
    bars += `<rect class="${cls}" x="${(cx(i) - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="4">
      <title>${esc(fullLabel(period, s.label))}: ${fmtNum(s.visitors)} visitors</title></rect>`;
  });
  const pk = ser[peak];
  const peakLbl = pk && pk.visitors
    ? `<text class="peak-lbl" x="${cx(peak).toFixed(1)}" y="${(yV(pk.visitors) - 6).toFixed(1)}" text-anchor="middle">${fmtNum(pk.visitors)}</text>`
    : '';

  // Sales line with dots
  const pathS = ser.map((s, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)},${yS(s.sales).toFixed(1)}`).join(' ');
  let dots = '';
  ser.forEach((s, i) => {
    const cls = s.label === curLabel ? 'dot-s today' : 'dot-s';
    dots += `<circle class="${cls}" cx="${cx(i).toFixed(1)}" cy="${yS(s.sales).toFixed(1)}" r="${s.label === curLabel ? 5 : 3.5}">
      <title>${esc(fullLabel(period, s.label))}: ${peso(s.sales)} sales</title></circle>`;
  });

  // X-axis labels: about 8 labels so they don't crowd together
  const step = Math.max(1, Math.ceil(n / 8));
  let xLabels = '';
  ser.forEach((s, i) => {
    if (i % step === 0 || i === n - 1) {
      xLabels += `<text class="axis" x="${cx(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(shortLabel(period, s.label))}</text>`;
    }
  });

  const periodWord2 = { daily: 'day', weekly: 'week', monthly: 'month' }[period];
  $('chartWord').textContent = period === 'daily'
    ? 'Last ' + n + ' day' + (n === 1 ? '' : 's') + ' · follows the Past days switch'
    : 'By ' + periodWord2;
  $('chartBox').innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Visitors as bars and sales as a line, by ${periodWord2}">
      ${grid}
      ${bars}
      ${peakLbl}
      <path class="line-s" d="${pathS}"></path>
      ${dots}
      ${xLabels}
    </svg>`;

  $('peakNote').textContent = pk && pk.visitors
    ? 'Busiest ' + periodWord2 + ': ' + fullLabel(period, pk.label) + ' with ' + fmtNum(pk.visitors) + ' visitors.'
    : 'No visits in this period yet.';
}

// Period table, newest first, with the average sale per visit
function renderTable() {
  $('seriesBody').innerHTML = data[period].slice().reverse().map(s => {
    const avg = s.visitors ? s.sales / s.visitors : 0;
    return `
    <tr>
      <td>${esc(fullLabel(period, s.label))}</td>
      <td class="num">${fmtNum(s.visitors)}</td>
      <td class="num">${peso(s.sales)}</td>
      <td class="num">${peso(avg)}</td>
    </tr>`;
  }).join('');
}

// Staff performance: clients, collected, GCash and cash for the selected period
function renderStaff() {
  const all = (data.staff || {})[periodKey()] || [];
  // Only staff with clients or payments in the period; no rows of zeros
  const rows = all
    .filter(s => s.clients > 0 || s.collected > 0)
    .sort((a, b) => b.collected - a.collected || b.clients - a.clients);

  $('staffWord').textContent = 'Showing ' + periodWord() + ' · collected = amount paid so far' +
    (all.length > rows.length && rows.length ? ' · ' + (all.length - rows.length) + ' with no activity hidden' : '');

  $('staffBody').innerHTML = rows.length ? rows.map(s => `
    <tr class="staff-row ${s.name === selectedStaff ? 'sel' : ''}" data-staff="${esc(s.name)}">
      <td>${esc(s.name)}</td>
      <td class="num">${fmtNum(s.clients)}</td>
      <td class="num">${peso(s.collected)}</td>
      <td class="num">${peso(s.gcash)}</td>
      <td class="num">${peso(s.cash)}</td>
    </tr>`).join('')
    : `<tr><td colspan="5" class="empty">${all.length ? 'No staff activity ' + periodWord() + ' yet.' : 'No staff set up in Settings.'}</td></tr>`;

  // Keep a valid selection: the top earner if the current one is gone
  if (!rows.some(s => s.name === selectedStaff)) {
    const top = rows.find(s => s.clients > 0) || rows[0];
    selectedStaff = top ? top.name : null;
    $('staffBody').querySelectorAll('tr.staff-row').forEach(tr =>
      tr.classList.toggle('sel', tr.dataset.staff === selectedStaff));
  }
}

// Clicking a staff row selects it and lists their clients
$('staffBody').onclick = e => {
  const tr = e.target.closest('tr[data-staff]');
  if (!tr) return;
  selectedStaff = tr.dataset.staff;
  renderStaff();
  renderClients();
};

// Client list for the selected staff member
function renderClients() {
  const rows = (data.staff || {})[periodKey()] || [];
  const s = rows.find(r => r.name === selectedStaff);

  $('clientTitle').textContent = s ? 'Clients of ' + s.name : 'Clients';
  $('clientWord').textContent = s
    ? fmtNum(s.clients) + ' client' + (s.clients === 1 ? '' : 's') + ' ' + periodWord() + (s.clients > s.list.length ? ' · showing latest ' + s.list.length : '')
    : 'Pick a staff member above.';

  if (!s || !s.list.length) {
    $('clientList').innerHTML = '<li><span>No clients in this period.</span></li>';
    return;
  }
  $('clientList').innerHTML = s.list.map(c => `
    <li>
      <span>${esc(c.name)}<small>${esc(dayLabel(c.date))} · ${esc(c.method || 'Unpaid')}</small></span>
      <b>${peso(c.amount)}</b>
    </li>`).join('');
}

// Payment methods: how much was collected by GCash and by cash for all staff in the period
function renderPayMethods() {
  const rows = (data.staff || {})[periodKey()] || [];
  const g = rows.reduce((a, s) => a + s.gcash, 0);
  const c = rows.reduce((a, s) => a + s.cash, 0);
  const tot = g + c;
  const pct = v => tot ? Math.round(v / tot * 100) : 0;

  $('payWord').textContent = 'Collected ' + periodWord();
  $('payTotal').textContent = peso(tot);
  $('payMethods').innerHTML = `
    <div class="pm">
      <div class="pmrow"><span>GCash</span><span>${peso(g)}</span></div>
      <div class="mbar"><i style="width:${pct(g)}%"></i></div>
      <small>${pct(g)}% of collected</small>
    </div>
    <div class="pm">
      <div class="pmrow"><span>Cash</span><span>${peso(c)}</span></div>
      <div class="mbar"><i style="width:${pct(c)}%"></i></div>
      <small>${pct(c)}% of collected</small>
    </div>`;
}

// Is a pass sold on this date inside the period being viewed?
function inCurrentPeriod(iso) {
  const ser = data[period];
  const label = ser[ser.length - 1].label;
  if (period === 'daily') return iso === label;
  if (period === 'weekly') return mondayOf(iso) === label;
  return iso.slice(0, 7) === label;   // monthly label is 'yyyy-MM'
}

// Pass sales panel: sold, revenue and active passes for each pass type in the selected period
function renderPasses() {
  const list = data.passes || [];
  const today = data.daily[data.daily.length - 1].label;

  $('passPeriod').textContent = 'Showing: ' + periodWord() + ' · active = not yet expired today';

  let totSold = 0, totRev = 0, totActive = 0;
  const rows = PASS_NAMES.map(name => {
    const sold = list.filter(p => p.pass === name && inCurrentPeriod(p.sold));
    const active = list.filter(p => p.pass === name && p.expires >= today).length;
    const rev = sold.reduce((a, p) => a + p.price, 0);
    totSold += sold.length;
    totRev += rev;
    totActive += active;
    return `
      <tr>
        <td>${esc(name)}</td>
        <td class="num">${fmtNum(sold.length)}</td>
        <td class="num">${peso(rev)}</td>
        <td class="num">${fmtNum(active)}</td>
      </tr>`;
  }).join('');

  $('passBody').innerHTML = rows + `
    <tr class="total-row">
      <td><b>Total</b></td>
      <td class="num"><b>${fmtNum(totSold)}</b></td>
      <td class="num"><b>${peso(totRev)}</b></td>
      <td class="num"><b>${fmtNum(totActive)}</b></td>
    </tr>`;

  // Ten most recent passes sold, newest first
  const recent = list.slice().reverse().slice(0, 10);
  $('passRecent').innerHTML = recent.length
    ? recent.map(p => `
      <tr>
        <td>${p.sold ? esc(dayLabel(p.sold)) : '-'}</td>
        <td>${esc(p.name)}</td>
        <td>${esc(p.pass)}</td>
        <td class="num">${peso(p.price)}</td>
        <td>${p.expires ? esc(dayLabel(p.expires)) : '-'}</td>
      </tr>`).join('')
    : '<tr><td colspan="5">No passes sold yet.</td></tr>';
}

// Average sales and average visitors per day, week and month
function renderAverages() {
  const a = data.averages;
  const tile = (label, v) => `
    <div class="avgtile">
      <div class="label">${label}</div>
      <div class="value">${v}</div>
    </div>`;

  $('avgSales').innerHTML =
    tile('Per day', peso(a.perDay.sales)) +
    tile('Per week', peso(a.perWeek.sales)) +
    tile('Per month', peso(a.perMonth.sales));

  $('avgVisitors').innerHTML =
    tile('Per day', fmtAvg(a.perDay.visitors)) +
    tile('Per week', fmtAvg(a.perWeek.visitors)) +
    tile('Per month', fmtAvg(a.perMonth.visitors));
}

// Period switches: one set of buttons drives the headline cards, chart and staff
document.querySelectorAll('[data-period]').forEach(btn => {
  btn.onclick = () => {
    period = btn.dataset.period;
    document.querySelectorAll('[data-period]').forEach(b =>
      b.setAttribute('aria-pressed', String(b === btn)));
    renderAll();
  };
});

// Past days switch: 3, 7 or 14 days
document.querySelectorAll('[data-range]').forEach(btn => {
  btn.onclick = () => {
    recentRange = Number(btn.dataset.range);
    document.querySelectorAll('[data-range]').forEach(b =>
      b.setAttribute('aria-pressed', String(b === btn)));
    if (data) { renderRecent(); renderChart(); }
  };
});

// Keep the "time inside" and on-duty durations current between server refreshes
setInterval(() => { if (data && !$('dash').hidden) { renderOnDuty(); renderLive(); } }, 60 * 1000);

$('refreshBtn').onclick = loadDashboard;

// Sidebar: highlight the clicked link, sign out, and the shortcut to the card maker
document.querySelectorAll('.side nav a[href^="#"]').forEach(a => {
  a.onclick = e => {
    if (a.id === 'signOut') {
      e.preventDefault();
      staffPin = '';
      location.reload();
      return;
    }
    document.querySelectorAll('.side nav a').forEach(x => x.classList.toggle('on', x === a));
  };
});

// ---- NFC card maker ----
async function loadConfig() {
  const res = await fetch(API_URL);
  const r = await parseReply(res);
  if (!r.ok) throw new Error(r.error || 'Could not load settings');

  const full = r.categories.map(c =>
    `<option value="${esc(c.name)}">${esc(c.name)} (₱${esc(tiersOf(c).h1)}/hr)</option>`).join('');
  const passes = Object.keys(r.passes || {}).map(p =>
    `<option value="${esc(p)}">${esc(p)} (₱${esc(r.passes[p])})</option>`).join('');
  $('cardCategory').innerHTML = full + passes;
}

$('mkToken').onclick = async () => {
  const name = $('cardName').value.trim();
  if (!name) return alert('Enter the card name first');
  const category = $('cardCategory').value;
  if (!category) return alert('Choose a category');
  setBusy($('mkToken'), true);
  try {
    const r = await post({ action: 'newToken', name, category, pin: staffPin });
    if (!r.ok) throw new Error(r.error);
    $('cardToken').textContent = r.token;
    $('cardUrl').textContent = r.url;
    $('cardResult').hidden = false;
    $('cardName').value = '';
  } catch (e) {
    if (/PIN/.test(e.message)) {
      staffPin = '';
      location.reload();
    } else {
      alert(e.message);
    }
  } finally {
    setBusy($('mkToken'), false);
  }
};

// ---- Start ----
// NFC tap (?t=TOKEN): tap in / out screen. Root link: booking flow. ?admin=1: staff dashboard.
if (TAP_TOKEN) {
  startTap(TAP_TOKEN);
} else if (new URLSearchParams(location.search).has('admin')) {
  document.body.classList.add('admin');
  document.title = 'LCKDIN Admin';
  askPin();
} else {
  showBooking();
}

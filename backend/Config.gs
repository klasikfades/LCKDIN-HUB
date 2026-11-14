// ============================================================
// CONFIG: constants, basic helpers, and Settings reading
// ============================================================

const SPREADSHEET_ID = '1A4blo-ANPeep8Ec2qPMK6P1qPBA9ZPZafAP3AJ0fSD4';
const SITE_URL = 'https://lckdin-hub.vercel.app/';
const APP_VERSION = 'v108';   // returned with every reply; bump on each deployment
const TZ = 'Asia/Manila';
const MIN_HOURS = 1;
const PASS_DAILY_CAP_HOURS = 9;   // single place to change the daily pass limit
// Rooms billed one flat hourly rate, not multiplied by the number of people
const FLAT_RATE_ROOMS = [];

const HEADERS = ['Name', 'Date', 'Purpose', 'Time In', 'Time Out', 'Personnel',
                 'Hours', 'Rate/hr', 'Total', 'Tag ID', 'Status', 'Paid', 'Payment method',
                 'Downpayment', 'Balance'];

// Column numbers (A = 1)
const C = { name: 1, date: 2, purpose: 3, timeIn: 4, timeOut: 5, personnel: 6,
            hours: 7, rate: 8, total: 9, tag: 10, status: 11, paid: 12, payment: 13,
            downpayment: 14, balance: 15 };

const LAST_COL = HEADERS.length;        // 15 columns on day tabs and the Visit Log
const KEY_COL = LAST_COL + 1;           // P: Visit Log key column (hidden; blank on day tabs)
const ROOM_HELPER_COL = LAST_COL + 2;   // Q: room name, hidden helper for pricing
const MULT_HELPER_COL = LAST_COL + 3;   // R: people multiplier, hidden helper for pricing
const TABLE_COL = LAST_COL + 4;         // S: "Table: The Huddle" on day tabs
const GUESTS_COL = LAST_COL + 5;        // T: guest names, one per line, on day tabs
const LOG_TABLE_COL = ROOM_HELPER_COL;  // Q on the Visit Log: table
const LOG_GUESTS_COL = MULT_HELPER_COL; // R on the Visit Log: guest names
const LAST_LETTER = 'O';                // last column letter used by the lookup tabs

const DATE_FMT = 'mmm d, yyyy';
const TIME_FMT = 'h:mm AM/PM';
const DATETIME_FMT = 'mmm d, yyyy  h:mm AM/PM';
const STATUS_OPTIONS = ['Booked', 'In', 'Out', 'Open'];
const PAID_OPTIONS = ['Paid', 'Unpaid'];
const PAYMENT_OPTIONS = ['GCash', 'Cash', 'Pass'];

const SHIFT_TAB = 'Shift Summary';
const PASSES_TAB = 'Passes';
const PASS_SALES_TAB = 'Pass Sales';
const FIXED_TABS = ['Visit Lookup', 'Shift Summary', 'Summary', 'Tags', 'Settings', PASS_SALES_TAB, PASSES_TAB];
const LOG_TAB = 'Visit Log';
const SHIFTS_TAB = 'Shifts';
const SHIFT_HEADERS = ['Name', 'Date', 'Clock In', 'Clock Out', 'Hours'];

const PASS_HEADERS = ['Token', 'Name', 'Pass', 'Price', 'Start', 'Expires', 'Created'];
// Prices are read from the Settings tab (column E). Only the length and cap live here.
const PASS_TYPES = {
  'Weekly Pass':  { days: 7,  dailyCap: PASS_DAILY_CAP_HOURS },
  'Monthly Pass': { days: 30, dailyCap: PASS_DAILY_CAP_HOURS }
};

const BRAND = {
  olive: '#4B5340',
  mint: '#F1FFE6',
  yellow: '#FFDD57',
  white: '#FFFFFF',
  band: '#F6FBEF',
  line: '#D5DCC5',
  peso: '"₱"#,##0.00'
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ---------- Spreadsheet and response helpers ----------

function ss() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function reply(obj) {
  // The version lets anyone confirm which backend deployment answered
  return ContentService.createTextOutput(JSON.stringify(Object.assign({ version: APP_VERSION }, obj)))
    .setMimeType(ContentService.MimeType.JSON);
}

// Date -> "14:05" in Manila time
function fmt(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  return Utilities.formatDate(d, TZ, 'HH:mm');
}

// Rounds to 2 decimals (centavos)
function r2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

// True when a cell holds a real number (blank and notes are not numbers)
function isNumeric(v) {
  return v !== '' && v !== null && v !== undefined && !isNaN(Number(v));
}

// "The Huddle" -> "Huddle", for guest lines like "Huddle : king"
function shortRoomName(name) {
  return String(name || '').replace(/^The\s+/i, '').trim();
}

// ---------- Date and text helpers ----------

// Today's date as 'yyyy-MM-dd' in Manila time
function todayStr() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

// Adds n days to a 'yyyy-MM-dd' string
function addDaysStr(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Turns a sheet value into 'yyyy-MM-dd'
function toIso(v) {
  return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v || '');
}

// '2026-10-22' -> 'Oct 22, 2026'
function tabNameFor(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return MONTHS[m - 1] + ' ' + d + ', ' + y;
}

// 'Oct 22, 2026' -> '2026-10-22' (used for Visit Log keys so old rows still match)
function isoFromTabName(name) {
  const m = String(name).match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
  if (!m) return name;
  return m[3] + '-' + String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0');
}

// True for tabs like 'Oct 22, 2026'
function isDayTab(name) {
  return /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(name);
}

function makeToken() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
}

// ---------- Style helpers ----------

function styleHeader(range) {
  range.setBackground(BRAND.olive)
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);
}

function setBorders(range) {
  range.setBorder(true, true, true, true, true, true, BRAND.line,
    SpreadsheetApp.BorderStyle.SOLID);
}

// ---------- Settings (rooms, prices, staff), cached for 5 minutes ----------

// Columns: B = staff name, D = name, E = rate, F = min people, G = max people,
// H = staff PIN, I to L = package prices (1 hr, 3 hrs, 6 hrs, 10 hrs).
function getConfig() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('config');
  if (hit) return JSON.parse(hit);

  const rows = ss().getSheetByName('Settings').getDataRange().getValues();
  const categories = [];
  const passes = {};
  rows.slice(1).forEach(r => {
    const name = String(r[3] || '').trim();
    if (!name) return;
    const rate = Number(r[4]) || 0;
    if (PASS_TYPES[name]) {
      passes[name] = rate;
    } else {
      categories.push({
        name,
        rate,
        minPeople: Number(r[5]) || 1,
        maxPeople: Number(r[6]) || 99,
        flat: FLAT_RATE_ROOMS.indexOf(name) >= 0,
        tiers: {
          h1: Number(r[8]) || 0,
          h3: Number(r[9]) || 0,
          h6: Number(r[10]) || 0,
          h10: Number(r[11]) || 0
        }
      });
    }
  });
  const personnel = rows
    .filter(r => String(r[0]).indexOf('Default In-charge') === 0 && r[1])
    .map(r => String(r[1]).trim());

  const cfg = { categories, passes, personnel, passDailyCap: PASS_DAILY_CAP_HOURS };
  cache.put('config', JSON.stringify(cfg), 300);
  return cfg;
}

// Run this once after you change rooms, prices, or staff names, so changes show up at once
function clearConfigCache() {
  CacheService.getScriptCache().remove('config');
}

// Price of a pass, from the Settings tab
function getPassPrice(passType) {
  const price = getConfig().passes[passType];
  if (price === undefined) throw new Error('Price for ' + passType + ' is missing in Settings');
  return price;
}

function getRate(category) {
  const found = getConfig().categories.find(c => c.name === String(category).trim());
  if (!found) throw new Error('Unknown category: ' + category);
  return found.rate;
}

// Cheapest way to cover `hours` using packages (1, 3, 6, 10 hrs).
// A package is used only if it fits inside the billed hours, so nothing is overbought.
// Examples: 7 hrs Focus = 6 + 1 = 195. 8 hrs Focus = 6 + 1 + 1 = 230. 10 hrs Focus = 200.
function tierPrice(hours, tiers) {
  if (!tiers || hours <= 0) return 0;
  const bundles = [[1, tiers.h1], [3, tiers.h3], [6, tiers.h6], [10, tiers.h10]]
    .filter(b => b[1] > 0);
  if (!bundles.length) return 0;
  const cost = [0];
  for (let h = 1; h <= hours; h++) {
    let best = Infinity;
    bundles.forEach(([n, p]) => {
      if (n > h) return;   // a package must fit inside the hours
      const v = cost[h - n] + p;
      if (v < best) best = v;
    });
    cost[h] = best;
  }
  return cost[hours];
}
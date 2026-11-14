// ============================================================
// SHEETS: day tabs, Visit Log, summary and lookup tabs, protection, On-edit checks
// ============================================================

// ---------- Dropdowns and day tab creation ----------

function listRule(options) {
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(options, true)
    .setAllowInvalid(true)
    .build();
}

// Staff dropdown: every name in Settings column B from row 2 down, so new names appear automatically
function personnelRule() {
  return SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss().getSheetByName('Settings').getRange('B2:B'), true)
    .setAllowInvalid(true)
    .build();
}

// Run once to refresh the staff dropdown on every existing day tab
function refreshPersonnelDropdowns() {
  ss().getSheets().filter(sh => isDayTab(sh.getName())).forEach(sh => {
    sh.getRange('F2:F').setDataValidation(personnelRule());
  });
}

function dayTab(dateStr) {
  const s = ss();
  const name = tabNameFor(dateStr);
  let sh = s.getSheetByName(name);
  if (!sh) {
    sh = s.insertSheet(name);
    sh.appendRow(HEADERS);
    styleDayTab(sh);
    protectDayColumns(sh);
    sh.getRange('F2:F').setDataValidation(personnelRule());
    sh.getRange('K2:K').setDataValidation(listRule(STATUS_OPTIONS));
    sh.getRange('L2:L').setDataValidation(listRule(PAID_OPTIONS));
    sh.getRange('M2:M').setDataValidation(listRule(PAYMENT_OPTIONS));
    addSummaryRow(dateStr);
    arrangeTabs();
  }
  ensureBookingColumns(sh);
  return sh;
}

// Table (S) and Guests (T) columns on a day tab. Adds the headers and widths the first time,
// including on tabs created before these columns existed.
function ensureBookingColumns(sh) {
  const head = sh.getRange(1, TABLE_COL, 1, 2).getValues()[0];
  if (String(head[0]) === 'Table' && String(head[1]) === 'Guests') return;
  sh.getRange(1, TABLE_COL, 1, 2).setValues([['Table', 'Guests']]);
  styleHeader(sh.getRange(1, TABLE_COL, 1, 2));
  sh.setColumnWidth(TABLE_COL, 170);
  sh.setColumnWidth(GUESTS_COL, 260);
  sh.getRange(2, GUESTS_COL, Math.max(sh.getMaxRows() - 1, 1), 1)
    .setWrap(true).setVerticalAlignment('top');
  sh.hideColumns(KEY_COL);   // P is unused on day tabs; keeps the new columns next to Balance
}

function addSummaryRow(dateStr) {
  const s = ss();
  let sum = s.getSheetByName('Summary');
  if (!sum) sum = s.insertSheet('Summary');

  // Make sure row 1 is the header. If it isn't, insert a row above so existing data moves down.
  if (String(sum.getRange(1, 1).getValue()) !== 'Date') {
    sum.insertRowBefore(1);
    sum.getRange(1, 1, 1, 3).setValues([['Date', 'Visits', 'Total Sales']]);
    sum.setFrozenRows(1);
    styleSummary(sum);
  }

  // Next empty row, never row 1
  const row = Math.max(sum.getLastRow(), 1) + 1;
  const q = "'" + tabNameFor(dateStr) + "'";
  sum.getRange(row, 1).setNumberFormat('@').setValue(dateStr);
  sum.getRange(row, 2, 1, 2).setFormulas([[
    `=COUNTA(${q}!A2:A)`,
    `=SUM(${q}!I2:I)`
  ]]);
}

// Hours billed: first hour is 60 min plus a 20 min grace (80 min total).
// 0 to 80 min = 1 hr. 81 to 140 min = 2 hrs. 141 to 200 min = 3 hrs. Minimum 1 hr.
// Total and Balance are written by recalcTotal/syncBalance (Visits file).
// Downpayment is a plain value: the amount already paid.
function writeFormulas(sh, r) {
  sh.getRange(r, C.hours).setFormula(
    `=IF(AND(ISNUMBER(D${r}),ISNUMBER(E${r}),E${r}>=D${r}),MAX(${MIN_HOURS},CEILING((ROUND((E${r}-D${r})*1440,0)-20)/60,1)),"")`
  );
}

// Time In and Time Out show only the time
function formatTimes(sh, r) {
  sh.getRange(r, C.timeIn, 1, 2).setNumberFormat(TIME_FMT).setHorizontalAlignment('center');
}

// A time typed into a time-formatted cell arrives as a Date on 30 Dec 1899.
// Put it back on the visit's date so Time Out is after Time In.
function onVisitDate(value, base) {
  if (!(value instanceof Date)) return value;
  if (value.getFullYear() > 2000) return value;
  const d = (base instanceof Date && base.getFullYear() > 2000) ? base : new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(),
                  value.getHours(), value.getMinutes(), value.getSeconds());
}

// Repair time-only Time In/Time Out cells on one day row, then return the fixed values.
function normalizeVisitTimes(sh, r) {
  const rawIn = sh.getRange(r, C.timeIn).getValue();
  const rawOut = sh.getRange(r, C.timeOut).getValue();
  const dateCell = sh.getRange(r, C.date).getValue();
  let tin = rawIn;
  let tout = rawOut;

  if (rawIn instanceof Date && rawIn.getFullYear() < 2000) {
    tin = onVisitDate(rawIn, dateCell);
    sh.getRange(r, C.timeIn).setValue(tin);
  }
  if (rawOut instanceof Date && rawOut.getFullYear() < 2000) {
    const base = (tin instanceof Date && tin.getFullYear() > 2000) ? tin : dateCell;
    tout = onVisitDate(rawOut, base);
    if (tin instanceof Date && tin.getFullYear() > 2000 && tout <= tin) {
      tout = new Date(tout.getTime() + 24 * 60 * 60 * 1000);
    }
    sh.getRange(r, C.timeOut).setValue(tout);
  }

  const changed = tin !== rawIn || tout !== rawOut;
  if (changed) {
    formatTimes(sh, r);
    SpreadsheetApp.flush();
  }
  return { timeIn: tin, timeOut: tout, changed };
}

// Pads a row out to the full column count
function fullRow(arr) {
  const a = arr.slice(0, LAST_COL);
  while (a.length < LAST_COL) a.push('');
  return a;
}

// ---------- Column protection on day tabs ----------

// Columns staff can't edit: Name, Date, Purpose, Time In, Personnel, Hours, Rate, Total, Tag ID,
// plus the booking Table and Guests columns.
// Time Out, Status, Paid, Payment method, Downpayment and Balance stay open.
const LOCKED_COLS = ['A:D', 'F:J', 'S:T'];
const LOCK_DESC = 'Day tab: columns A-D, F-J and S-T locked';

// Locks the set columns on one day tab. Safe to run again: old locks are removed first.
function protectDayColumns(sh) {
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .filter(p => p.getDescription() === LOCK_DESC)
    .forEach(p => p.remove());

  LOCKED_COLS.forEach(a1 => {
    const p = sh.getRange(a1).protect().setDescription(LOCK_DESC);
    p.removeEditors(p.getEditors());   // only you can edit these columns
  });
}

// Run once from the editor to lock every existing day tab
function protectAllDayTabs() {
  ss().getSheets()
    .filter(sh => isDayTab(sh.getName()))
    .forEach(protectDayColumns);
}

// Run once from the editor to hide the pricing helper columns (Q and R) on every day tab
function hideHelperColumnsOnAllDayTabs() {
  ss().getSheets()
    .filter(sh => isDayTab(sh.getName()))
    .forEach(sh => sh.hideColumns(ROOM_HELPER_COL, 2));
}

// Locks the name-to-status cells of a closed visit so staff can't change them.
// Paid, Payment method, Downpayment and Balance stay editable.
function lockRow(sh, row) {
  const p = sh.getRange(row, 1, 1, C.status).protect()
    .setDescription('Closed visit: name to status locked');
  p.removeEditors(p.getEditors());
}

// ---------- Styling ----------

function styleDayTab(sh) {
  const cols = HEADERS.length;
  const rows = Math.max(sh.getMaxRows(), 2);
  const body = rows - 1;

  sh.setHiddenGridlines(true);
  sh.setTabColor(BRAND.olive);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);
  sh.hideColumns(C.date);
  sh.hideColumns(ROOM_HELPER_COL, 2);
  sh.getRange(1, 1, rows, cols).setFontFamily('Poppins').setFontSize(10)
    .setVerticalAlignment('middle').setBackground(BRAND.white);

  styleHeader(sh.getRange(1, 1, 1, cols));
  sh.setRowHeight(1, 40);
  sh.setRowHeights(2, body, 30);

  const widths = [170, 110, 170, 120, 120, 150, 80, 110, 120, 120, 110, 90, 140, 120, 110];
  widths.forEach((w, i) => sh.setColumnWidth(i + 1, w));

  sh.getRange(2, C.date, body, 1).setNumberFormat(DATE_FMT).setHorizontalAlignment('center');
  sh.getRange(2, C.timeIn, body, 2).setNumberFormat(TIME_FMT).setHorizontalAlignment('center');
  sh.getRange(2, C.hours, body, 1).setNumberFormat('0').setHorizontalAlignment('center');
  sh.getRange(2, C.rate, body, 2).setNumberFormat(BRAND.peso).setHorizontalAlignment('right');
  sh.getRange(2, C.total, body, 1).setFontWeight('bold').setFontColor(BRAND.olive)
    .setBackground('#FFF8D6');
  sh.getRange(2, C.tag, body, 1).setFontColor('#6B7356');
  sh.getRange(2, C.status, body, 1).setHorizontalAlignment('center').setFontWeight('bold');
  sh.getRange(2, C.paid, body, 2).setHorizontalAlignment('center');
  sh.getRange(2, C.downpayment, body, 2).setNumberFormat(BRAND.peso).setHorizontalAlignment('right');

  setBorders(sh.getRange(1, 1, rows, cols));

  const statusRange = sh.getRange(2, C.status, body, 1);
  const paidRange = sh.getRange(2, C.paid, body, 1);
  const pill = (range, text, bg, fg) => SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(text).setBackground(bg).setFontColor(fg).setRanges([range]).build();

  sh.setConditionalFormatRules([
    pill(statusRange, 'Booked', BRAND.yellow, BRAND.olive),
    pill(statusRange, 'In', '#CDEFC2', '#2F5D1E'),
    pill(statusRange, 'Out', '#E3E6DC', BRAND.olive),
    pill(statusRange, 'Open', '#D6E9F8', '#1E4D75'),
    pill(paidRange, 'Paid', '#CDEFC2', '#2F5D1E'),
    pill(paidRange, 'Unpaid', '#FBE3E3', '#8A2B2B'),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=MOD(ROW(),2)=0')
      .setBackground(BRAND.band)
      .setRanges([sh.getRange(2, 1, body, cols)])
      .build()
  ]);
}

function styleSummary(sh) {
  const rows = Math.max(sh.getMaxRows(), 2);
  sh.setHiddenGridlines(true);
  sh.setTabColor(BRAND.yellow);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, rows, 3).setFontFamily('Poppins').setFontSize(10).setVerticalAlignment('middle');
  styleHeader(sh.getRange(1, 1, 1, 3));
  sh.setRowHeight(1, 40);
  sh.setColumnWidth(1, 150);
  sh.setColumnWidth(2, 110);
  sh.setColumnWidth(3, 150);
  sh.getRange(2, 1, rows - 1, 1).setFontWeight('bold');
  sh.getRange(2, 2, rows - 1, 1).setHorizontalAlignment('center');
  sh.getRange(2, 3, rows - 1, 1).setNumberFormat(BRAND.peso).setHorizontalAlignment('right')
    .setFontWeight('bold').setFontColor(BRAND.olive);
  setBorders(sh.getRange(1, 1, rows, 3));
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=MOD(ROW(),2)=0')
      .setBackground(BRAND.band)
      .setRanges([sh.getRange(2, 1, rows - 1, 3)])
      .build()
  ]);
}

// ---------- Pass Sales tab ----------

// Creates the Pass Sales tab once, if it doesn't exist yet
function ensurePassSales() {
  if (!ss().getSheetByName(PASS_SALES_TAB)) buildPassSales();
}

// Builds the Pass Sales tab: a summary table and a list for each pass type.
// Everything is formulas, so it updates by itself. Run once to rebuild if needed.
function buildPassSales() {
  const s = ss();
  getOrCreatePasses();   // make sure the Passes tab exists so the formulas have data to read
  let sh = s.getSheetByName(PASS_SALES_TAB);
  if (!sh) sh = s.insertSheet(PASS_SALES_TAB);
  sh.clear();
  sh.setHiddenGridlines(true);
  sh.setTabColor(BRAND.yellow);
  sh.getRange(1, 1, 120, 23).setFontFamily('Poppins').setFontSize(10)
    .setVerticalAlignment('middle').setBackground(BRAND.white);

  sh.setRowHeight(1, 44);
  sh.getRange('A1').setValue('Pass Sales')
    .setFontSize(18).setFontWeight('bold').setFontColor(BRAND.olive);
  sh.getRange('A2').setValue('Weekly and monthly passes sold. Updates automatically from the Passes tab.')
    .setFontSize(9).setFontColor('#6B7356');

  // Summary table (rows 4 to 8)
  sh.getRange('A4:E4').setValues([['Pass', 'Price', 'Sold', 'Revenue', 'Active today']]);
  styleHeader(sh.getRange('A4:E4'));
  sh.setRowHeight(4, 32);

  const P = `'${PASSES_TAB}'!`;
  const names = Object.keys(PASS_TYPES);
  names.forEach((name, i) => {
    const r = 5 + i;
    sh.getRange(r, 1).setValue(name);
    sh.getRange(r, 2).setFormula(`=IFERROR(VLOOKUP(A${r},Settings!D:E,2,FALSE),"")`);
    sh.getRange(r, 3, 1, 3).setFormulas([[
      `=COUNTIF(${P}$C$2:$C,A${r})`,
      `=SUMIF(${P}$C$2:$C,A${r},${P}$D$2:$D)`,
      `=SUMPRODUCT((${P}$C$2:$C=A${r})*(${P}$F$2:$F>=TODAY()))`
    ]]);
  });
  const lastRow = 5 + names.length;
  sh.getRange(lastRow, 1).setValue('Total');
  sh.getRange(lastRow, 3, 1, 3).setFormulas([[
    `=SUM(C5:C${lastRow - 1})`, `=SUM(D5:D${lastRow - 1})`, `=SUM(E5:E${lastRow - 1})`
  ]]);
  sh.getRange(`A${lastRow}:E${lastRow}`).setFontWeight('bold').setBackground(BRAND.yellow);
  sh.getRange('B5:B7').setNumberFormat(BRAND.peso);
  sh.getRange('D5:D8').setNumberFormat(BRAND.peso);
  sh.getRange('B5:E8').setHorizontalAlignment('center');
  sh.getRange('D5:D8').setHorizontalAlignment('right');
  sh.getRange('A5:A7').setFontWeight('bold');
  setBorders(sh.getRange('A4:E8'));

  // One list per pass type (rows 11 onward). Each block is 7 columns plus a gap column.
  const blockStarts = [1, 9, 17];   // A, I, Q
  names.forEach((name, i) => {
    const c0 = blockStarts[i];
    sh.getRange(10, c0).setValue(name)
      .setFontSize(12).setFontWeight('bold').setFontColor(BRAND.olive);
    sh.getRange(11, c0, 1, PASS_HEADERS.length).setValues([PASS_HEADERS]);
    styleHeader(sh.getRange(11, c0, 1, PASS_HEADERS.length));
    sh.getRange(12, c0).setFormula(
      `=IFERROR(FILTER(${P}A2:G, ${P}C2:C="${name}"), "No ${name.toLowerCase()}es sold yet.")`
    );
    sh.getRange(12, c0 + 3, 500, 1).setNumberFormat(BRAND.peso).setHorizontalAlignment('right');
    sh.getRange(12, c0 + 6, 500, 1).setNumberFormat(DATETIME_FMT).setHorizontalAlignment('center');
    sh.getRange(12, c0 + 4, 500, 2).setNumberFormat(DATE_FMT).setHorizontalAlignment('center');
    sh.setColumnWidth(c0, 170);
    sh.setColumnWidth(c0 + 1, 130);
    sh.setColumnWidth(c0 + 2, 110);
    sh.setColumnWidth(c0 + 3, 90);
    sh.setColumnWidth(c0 + 4, 110);
    sh.setColumnWidth(c0 + 5, 110);
    sh.setColumnWidth(c0 + 6, 170);
  });
  sh.setColumnWidth(8, 24);
  sh.setColumnWidth(16, 24);

  sh.setFrozenRows(1);
  arrangeTabs();
  return sh;
}

// ---------- Shift Summary tab ----------

// Shift Summary: reads the Visit Log. Holds 25 staff. Only the date (B4) and staff (B5) are editable.
function buildShiftSummary() {
  const s = ss();
  let sh = s.getSheetByName(SHIFT_TAB);
  if (!sh) sh = s.insertSheet(SHIFT_TAB);
  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => p.remove());
  sh.clear();

  const SLOTS = 25;
  const FIRST = 8;                  // first staff row
  const LAST = FIRST + SLOTS - 1;   // 32
  const TOT = LAST + 1;             // 33 total row
  const VT = TOT + 3;               // 36 visits title
  const VH = VT + 1;                // 37 visits header
  const VD = VH + 1;                // 38 first visit row
  const VE = 200;                   // last visit row

  sh.setHiddenGridlines(true);
  sh.setTabColor(BRAND.yellow);
  sh.getRange(1, 1, VE, LAST_COL).setFontFamily('Poppins').setFontSize(10)
    .setVerticalAlignment('middle').setBackground(BRAND.white);

  const widths = [170, 110, 150, 120, 120, 150, 80, 110, 120, 120, 110, 90, 140, 120, 110];
  widths.forEach((w, i) => sh.setColumnWidth(i + 1, w));

  // Title
  sh.setRowHeight(1, 44);
  sh.getRange('A1').setValue('Shift Summary')
    .setFontSize(18).setFontWeight('bold').setFontColor(BRAND.olive);
  sh.getRange('A2').setValue('Based on the Visit Log. Edits on day tabs appear here after the next sync.')
    .setFontSize(9).setFontColor('#6B7356');

  // Pickers
  sh.getRange('A4').setValue('Pick a date').setFontWeight('bold').setFontColor(BRAND.olive);
  sh.getRange('B4').setValue(new Date()).setNumberFormat(DATE_FMT)
    .setBackground(BRAND.yellow).setFontWeight('bold').setFontColor(BRAND.olive)
    .setHorizontalAlignment('center');
  sh.getRange('C4').setFormula('=TEXT(B4,"yyyy-mm-dd")')
    .setFontColor('#6B7356').setFontSize(8);

  sh.getRange('A5').setValue('Pick staff (blank = all)').setFontWeight('bold').setFontColor(BRAND.olive);
  sh.getRange('B5').setBackground(BRAND.yellow).setFontWeight('bold').setFontColor(BRAND.olive)
    .setHorizontalAlignment('center');

  // Per-person summary table
  sh.getRange('A7:C7').setValues([['Personnel', 'Clients', 'Paid earnings']]);
  styleHeader(sh.getRange('A7:C7'));
  sh.setRowHeight(7, 32);

  const LOG = `'${LOG_TAB}'!`;
  const dayTest = `(TEXT(${LOG}B2:B,"yyyy-mm-dd")=$C$4)`;

  // Staff names come from Settings column B, starting at row 2
  for (let i = 0; i < SLOTS; i++) {
    const r = FIRST + i;
    const sr = 2 + i;
    sh.getRange(r, 1, 1, 3).setFormulas([[
      `=IF(Settings!B${sr}="","",Settings!B${sr})`,
      `=IF(A${r}="","",SUMPRODUCT(${dayTest}*(${LOG}F2:F=A${r})*(${LOG}K2:K="Out")))`,
      `=IF(A${r}="","",SUMPRODUCT(${dayTest}*(${LOG}F2:F=A${r})*(${LOG}K2:K="Out")*(${LOG}L2:L="Paid"),${LOG}I2:I))`
    ]]);
  }

  sh.getRange(TOT, 1).setValue('Total');
  sh.getRange(TOT, 2, 1, 2).setFormulas([[`=SUM(B${FIRST}:B${LAST})`, `=SUM(C${FIRST}:C${LAST})`]]);
  sh.getRange(`A${TOT}:C${TOT}`).setFontWeight('bold').setBackground(BRAND.yellow);
  sh.getRange(`B${FIRST}:B${TOT}`).setNumberFormat('0').setHorizontalAlignment('center');
  sh.getRange(`C${FIRST}:C${TOT}`).setNumberFormat(BRAND.peso).setHorizontalAlignment('right')
    .setFontWeight('bold').setFontColor(BRAND.olive);
  setBorders(sh.getRange(`A7:C${TOT}`));

  // Visit list for the chosen date and staff
  sh.getRange(VT, 1).setValue('Visits for the selected date and staff')
    .setFontSize(12).setFontWeight('bold').setFontColor(BRAND.olive);
  sh.getRange(VH, 1, 1, LAST_COL).setValues([HEADERS]);
  styleHeader(sh.getRange(VH, 1, 1, LAST_COL));
  sh.setRowHeight(VH, 40);

  sh.getRange(`A${VD}`).setFormula(
    `=IFERROR(FILTER(${LOG}A2:${LAST_LETTER}, ${dayTest}*(${LOG}K2:K="Out")*((($B$5="")+(${LOG}F2:F=$B$5))>0)), "No closed visits for this selection.")`
  );

  sh.getRange(`B${VD}:B${VE}`).setNumberFormat(DATE_FMT).setHorizontalAlignment('center');
  sh.getRange(`D${VD}:E${VE}`).setNumberFormat(TIME_FMT).setHorizontalAlignment('center');
  sh.getRange(`G${VD}:G${VE}`).setNumberFormat('0').setHorizontalAlignment('center');
  sh.getRange(`H${VD}:I${VE}`).setNumberFormat(BRAND.peso).setHorizontalAlignment('right');
  sh.getRange(`I${VD}:I${VE}`).setFontWeight('bold').setFontColor(BRAND.olive);
  sh.getRange(`J${VD}:J${VE}`).setFontColor('#6B7356');
  sh.getRange(`K${VD}:M${VE}`).setHorizontalAlignment('center');
  sh.getRange(`K${VD}:K${VE}`).setFontWeight('bold');
  sh.getRange(`N${VD}:O${VE}`).setNumberFormat(BRAND.peso).setHorizontalAlignment('right');

  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Out')
      .setBackground('#E3E6DC').setFontColor(BRAND.olive)
      .setRanges([sh.getRange(`K${VD}:K${VE}`)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Paid')
      .setBackground('#CDEFC2').setFontColor('#2F5D1E')
      .setRanges([sh.getRange(`L${VD}:L${VE}`)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Unpaid')
      .setBackground('#FBE3E3').setFontColor('#8A2B2B')
      .setRanges([sh.getRange(`L${VD}:L${VE}`)]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=AND($A${VD}<>"",MOD(ROW(),2)=0)`)
      .setBackground(BRAND.band).setRanges([sh.getRange(`A${VD}:${LAST_LETTER}${VE}`)]).build()
  ]);

  // Staff picker: all 25 names. Blank = everyone.
  sh.getRange('B5').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(sh.getRange(`A${FIRST}:A${LAST}`), true)
      .setAllowInvalid(true)
      .build()
  );

  // Lock the whole tab except the date and staff pickers
  const p = sh.protect().setDescription('Shift Summary: read-only except date and staff');
  p.setUnprotectedRanges([sh.getRange('B4'), sh.getRange('B5')]);
  p.removeEditors(p.getEditors());
  return sh;
}

// ---------- Visit Lookup tab ----------

// Visit Lookup: closed visits for the chosen day, read from the Visit Log.
function buildVisitLookup() {
  const s = ss();
  let sh = s.getSheetByName('Visit Lookup');
  if (!sh) sh = s.insertSheet('Visit Lookup');
  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => p.remove());
  sh.clear();

  sh.setHiddenGridlines(true);
  sh.setTabColor(BRAND.yellow);
  sh.getRange(1, 1, 200, LAST_COL).setFontFamily('Poppins').setFontSize(10)
    .setVerticalAlignment('middle').setBackground(BRAND.white);

  const widths = [170, 110, 170, 120, 120, 150, 80, 110, 120, 120, 110, 90, 140, 120, 110];
  widths.forEach((w, i) => sh.setColumnWidth(i + 1, w));

  sh.setRowHeight(1, 44);
  sh.getRange('A1').setValue('Visit lookup')
    .setFontSize(18).setFontWeight('bold').setFontColor(BRAND.olive);
  sh.getRange('A2').setValue('Closed visits for the day you pick. Updates from the day tabs.')
    .setFontSize(10).setFontColor('#6B7356');

  sh.getRange('A4').setValue('Pick a date').setFontWeight('bold').setFontColor(BRAND.olive);
  sh.getRange('B4').setValue(new Date()).setNumberFormat(DATE_FMT)
    .setBackground(BRAND.yellow).setFontWeight('bold').setFontColor(BRAND.olive)
    .setHorizontalAlignment('center');
  sh.getRange('C4').setFormula('=TEXT(B4,"yyyy-mm-dd")')
    .setFontColor('#6B7356').setFontSize(8);

  const logDay = `TEXT('${LOG_TAB}'!B2:B,"yyyy-mm-dd")=$C$4`;

  sh.getRange('A6').setValue('Closed visits').setFontSize(9).setFontColor('#6B7356');
  sh.getRange('A7').setFormula(`=SUMPRODUCT((${logDay})*('${LOG_TAB}'!K2:K="Out"))`)
    .setFontSize(18).setFontWeight('bold').setFontColor(BRAND.olive).setHorizontalAlignment('left');

  sh.getRange('C6').setValue('Paid earnings').setFontSize(9).setFontColor('#6B7356');
  sh.getRange('C7').setFormula(`=SUMPRODUCT((${logDay})*('${LOG_TAB}'!K2:K="Out")*('${LOG_TAB}'!L2:L="Paid"),'${LOG_TAB}'!I2:I)`)
    .setNumberFormat(BRAND.peso)
    .setFontSize(18).setFontWeight('bold').setFontColor(BRAND.olive).setHorizontalAlignment('left');

  sh.getRange('E6').setValue('Outstanding balance').setFontSize(9).setFontColor('#6B7356');
  sh.getRange('E7').setFormula(`=SUMPRODUCT((${logDay})*('${LOG_TAB}'!K2:K="Out")*('${LOG_TAB}'!O2:O<>""),'${LOG_TAB}'!O2:O)`)
    .setNumberFormat(BRAND.peso)
    .setFontSize(18).setFontWeight('bold').setFontColor(BRAND.olive).setHorizontalAlignment('left');

  sh.getRange('A6:B7').setBackground(BRAND.mint);
  sh.getRange('C6:D7').setBackground(BRAND.mint);
  sh.getRange('E6:F7').setBackground(BRAND.mint);
  sh.setRowHeight(6, 22);
  sh.setRowHeight(7, 36);

  sh.getRange(9, 1, 1, LAST_COL).setValues([HEADERS]);
  styleHeader(sh.getRange(9, 1, 1, LAST_COL));
  sh.setRowHeight(9, 40);

  sh.getRange('A10').setFormula(
    `=IFERROR(FILTER('${LOG_TAB}'!A2:${LAST_LETTER}, TEXT('${LOG_TAB}'!B2:B,"yyyy-mm-dd")=$C$4, '${LOG_TAB}'!K2:K="Out"), "No closed visits for this day yet.")`
  );

  sh.getRange('B10:B200').setNumberFormat(DATE_FMT).setHorizontalAlignment('center');
  sh.getRange('D10:E200').setNumberFormat(TIME_FMT).setHorizontalAlignment('center');
  sh.getRange('G10:G200').setNumberFormat('0').setHorizontalAlignment('center');
  sh.getRange('H10:I200').setNumberFormat(BRAND.peso).setHorizontalAlignment('right');
  sh.getRange('I10:I200').setFontWeight('bold').setFontColor(BRAND.olive);
  sh.getRange('J10:J200').setFontColor('#6B7356');
  sh.getRange('K10:M200').setHorizontalAlignment('center');
  sh.getRange('K10:K200').setFontWeight('bold');
  sh.getRange('N10:O200').setNumberFormat(BRAND.peso).setHorizontalAlignment('right');

  const statusRange = sh.getRange('K10:K200');
  const paidRange = sh.getRange('L10:L200');
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Out')
      .setBackground('#E3E6DC').setFontColor(BRAND.olive).setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Paid')
      .setBackground('#CDEFC2').setFontColor('#2F5D1E').setRanges([paidRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Unpaid')
      .setBackground('#FBE3E3').setFontColor('#8A2B2B').setRanges([paidRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($A10<>"",MOD(ROW(),2)=0)')
      .setBackground(BRAND.band).setRanges([sh.getRange(`A10:${LAST_LETTER}200`)]).build()
  ]);

  const p = sh.protect().setDescription('Visit lookup: read-only');
  p.setUnprotectedRanges([sh.getRange('B4')]);
  p.removeEditors(p.getEditors());
  return sh;
}

// ---------- Tab order ----------

// Tab order: fixed tabs, then Shifts, then day tabs newest to oldest, then anything else
function arrangeTabs() {
  const s = ss();
  const all = s.getSheets().map(sh => sh.getName());
  const fixed = [...FIXED_TABS, LOG_TAB, SHIFTS_TAB].filter(n => all.includes(n));
  const days = all.filter(n => isDayTab(n))
    .sort((a, b) => isoFromTabName(b).localeCompare(isoFromTabName(a)));
  const others = all.filter(n => !fixed.includes(n) && !isDayTab(n));

  [...fixed, ...days, ...others].forEach((name, i) => {
    const sh = s.getSheetByName(name);
    if (!sh) return;
    sh.activate();
    s.moveActiveSheet(i + 1);
  });
}

// ---------- Visit Log (copy of every visit, rebuilt from the day tabs) ----------

// Gets the log tab, creating it read-only for everyone except you
function getLog() {
  const s = ss();
  let sh = s.getSheetByName(LOG_TAB);
  if (!sh) {
    sh = s.insertSheet(LOG_TAB);
    sh.appendRow([...HEADERS, 'Key', 'Table', 'Guests']);
    sh.setFrozenRows(1);
    sh.hideColumns(KEY_COL);
    sh.setHiddenGridlines(true);
    sh.setTabColor('#6B7356');
    styleHeader(sh.getRange(1, 1, 1, LOG_GUESTS_COL));
    sh.setRowHeight(1, 40);
    const p = sh.protect().setDescription('Visit log: read-only');
    p.removeEditors(p.getEditors());
    arrangeTabs();
  }
  ensureLogColumns(sh);
  return sh;
}

// Table and Guests columns on the Visit Log (Q and R). Adds them to logs made before they existed.
function ensureLogColumns(sh) {
  if (String(sh.getRange(1, LOG_TABLE_COL).getValue()) === 'Table') return;
  sh.getRange(1, LOG_TABLE_COL, 1, 2).setValues([['Table', 'Guests']]);
  styleHeader(sh.getRange(1, LOG_TABLE_COL, 1, 2));
  sh.setColumnWidth(LOG_TABLE_COL, 170);
  sh.setColumnWidth(LOG_GUESTS_COL, 260);
  sh.getRange(2, LOG_GUESTS_COL, Math.max(sh.getMaxRows() - 1, 1), 1)
    .setWrap(true).setVerticalAlignment('top');
}

// Copies one visit from a day tab into the log (called when a visit is checked out)
function snapshotVisit(sh, r) {
  SpreadsheetApp.flush();
  const log = getLog();
  const v = fullRow(sh.getRange(r, 1, 1, LAST_COL).getValues()[0]);
  const meta = sh.getRange(r, TABLE_COL, 1, 2).getValues()[0];
  const tIn = v[C.timeIn - 1] instanceof Date ? v[C.timeIn - 1].getTime() : v[C.timeIn - 1];
  const key = [isoFromTabName(sh.getName()), r, tIn, v[C.tag - 1], v[C.name - 1]].join('|');

  const keys = log.getLastRow() > 1
    ? log.getRange(2, KEY_COL, log.getLastRow() - 1, 1).getValues().flat()
    : [];
  if (keys.includes(key)) return;

  log.appendRow([...v, key, String(meta[0] || ''), String(meta[1] || '')]);
  const n = log.getLastRow();
  log.getRange(n, C.date).setNumberFormat(DATE_FMT).setHorizontalAlignment('center');
  log.getRange(n, C.timeIn, 1, 2).setNumberFormat(TIME_FMT).setHorizontalAlignment('center');
  log.getRange(n, C.rate, 1, 2).setNumberFormat(BRAND.peso);
  log.getRange(n, C.downpayment, 1, 2).setNumberFormat(BRAND.peso);
  log.getRange(n, LOG_GUESTS_COL).setWrap(true).setVerticalAlignment('top');
}

// True if a Visit Log key belongs to this day (frozen or live)
function isKeyForDay(key, day) {
  return key.indexOf(day + '|') === 0 || key.indexOf('LIVE|' + day + '|') === 0;
}

// Newest first: by Date, then by Time In. Rows with no Time In sort to the bottom of their day.
function sortLogRows(rows) {
  const dateOf = v => {
    const d = v[C.date - 1];
    return d instanceof Date ? d.getTime() : 0;
  };
  const timeInOf = v => {
    const t = v[C.timeIn - 1];
    return t instanceof Date ? t.getTime() : 0;
  };
  return rows.sort((a, b) => (dateOf(b) - dateOf(a)) || (timeInOf(b) - timeInOf(a)));
}

// Rebuilds this day's rows in the Visit Log from its day tab. Other days are left alone.
// Closed visits refresh too, so payment edits (Paid, Downpayment, Balance) show up.
// Name and status are locked on closed rows, so the record can't drift.
// The whole log is kept sorted newest first.
function syncDayToLog(sh) {
  const log = getLog();
  const day = isoFromTabName(sh.getName());
  const last = log.getLastRow();

  let rows = [];
  if (last > 1) {
    rows = log.getRange(2, 1, last - 1, LOG_GUESTS_COL).getValues()
      .filter(r => r[0] !== '' && !isKeyForDay(String(r[KEY_COL - 1]), day));
  }

  const data = sh.getDataRange().getValues();
  for (let r = 2; r <= data.length; r++) {
    const src = data[r - 1];
    const v = fullRow(src);
    if (!v[C.name - 1]) continue;
    const tIn = v[C.timeIn - 1] instanceof Date ? v[C.timeIn - 1].getTime() : v[C.timeIn - 1];
    const base = [day, r, tIn, v[C.tag - 1], v[C.name - 1]].join('|');
    const meta = [String(src[TABLE_COL - 1] || ''), String(src[GUESTS_COL - 1] || '')];
    if (v[C.status - 1] === 'Out') {
      rows.push([...v, base, ...meta]);
    } else {
      rows.push([...v, 'LIVE|' + base, ...meta]);
    }
  }

  rows = sortLogRows(rows);

  const n = rows.length;
  if (n > 0) log.getRange(2, 1, n, LOG_GUESTS_COL).setValues(rows);
  if (last - 1 > n) log.deleteRows(n + 2, last - 1 - n);

  if (n > 0) {
    log.getRange(2, C.date, n, 1).setNumberFormat(DATE_FMT).setHorizontalAlignment('center');
    log.getRange(2, C.timeIn, n, 2).setNumberFormat(TIME_FMT).setHorizontalAlignment('center');
    log.getRange(2, C.rate, n, 2).setNumberFormat(BRAND.peso);
    log.getRange(2, C.downpayment, n, 2).setNumberFormat(BRAND.peso);
    log.getRange(2, LOG_GUESTS_COL, n, 1).setWrap(true).setVerticalAlignment('top');
  }
}

// Rewrites Downpayment as a plain value and Balance from the Paid-wins rule on every day tab.
// Keeps the recorded downpayment where it is a number. Rows with a typed Balance and no
// Downpayment are read as "this much is still owed".
function rewriteBalances() {
  ss().getSheets()
    .filter(sh => isDayTab(sh.getName()))
    .forEach(sh => {
      const last = sh.getLastRow();
      if (last < 2) return;
      const vals = sh.getRange(2, 1, last - 1, LAST_COL).getValues();
      const downs = [], bals = [], payVals = [];
      vals.forEach(r => {
        if (!r[C.name - 1]) {
          downs.push([r[C.downpayment - 1]]);
          bals.push([r[C.balance - 1]]);
          payVals.push([r[C.paid - 1]]);
          return;
        }
        const total = r2(Number(r[C.total - 1]) || 0);
        let paidText = String(r[C.paid - 1] || '').trim();
        const n = r[C.downpayment - 1], o = r[C.balance - 1];
        // An old "Paid" row that still carries a Balance was a downpayment visit; keep it open
        if (paidText === 'Paid' && isNumeric(o) && Number(o) > 0) paidText = 'Unpaid';
        const paid = paidText === 'Paid';
        let down;
        if (isNumeric(n)) down = Math.max(0, Number(n));
        else if (isNumeric(o)) down = Math.max(0, total - Number(o));
        else down = paid ? total : 0;
        down = r2(Math.min(total, down));
        downs.push([down]);
        bals.push([paid ? 0 : r2(Math.max(0, total - down))]);
        payVals.push([paidText]);
      });
      sh.getRange(2, C.downpayment, vals.length, 1).setValues(downs);
      sh.getRange(2, C.balance, vals.length, 1).setValues(bals);
      sh.getRange(2, C.paid, vals.length, 1).setValues(payVals);
    });
}

// Adds the Table/Guests columns and their protection to every existing day tab.
function upgradeDayTabs() {
  ss().getSheets()
    .filter(sh => isDayTab(sh.getName()))
    .forEach(sh => {
      ensureBookingColumns(sh);
      protectDayColumns(sh);
    });
}

// One-time cleanup you can also run from the editor. Safe to run again.
// The timer calls the same upgrade once, then remembers it in Script Properties.
function fixBalances() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    rewriteBalances();
    upgradeDayTabs();
    PropertiesService.getScriptProperties().setProperty('layoutVersion', '2');
  } finally {
    lock.releaseLock();
  }
  syncAllDays();
}

// Rebuilds the Visit Log from every day tab, and fills any blank Personnel from the shift record.
// Runs on a timer (every 5 minutes), so Visit Lookup, Shift Summary and bookings catch up
// even if an On edit trigger missed a change.
function syncAllDays() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;   // skip this run if a write is already in progress
  try {
    // First run after this update: make old rows use the new columns and balance rule
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('layoutVersion') !== '2') {
      rewriteBalances();
      upgradeDayTabs();
      props.setProperty('layoutVersion', '2');
    }

    ss().getSheets()
      .filter(sh => isDayTab(sh.getName()))
      .forEach(sh => syncDayToLog(sh));
    backfillPersonnel();
  } finally {
    lock.releaseLock();
  }
}

// ---------- On-edit checks (installable trigger) ----------

function onEditCore(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (!isDayTab(sh.getName())) return;

  const row = e.range.getRow();
  const col = e.range.getColumn();
  if (row < 2 || e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;

  // Status set to Out by hand: freeze the visit and lock the day row
  if (col === C.status) {
    if (sh.getRange(row, C.status).getValue() === 'Out') {
      snapshotVisit(sh, row);
      lockRow(sh, row);
    }
    return;
  }

  // Payment edits: keep Downpayment, Balance and the dashboard on the same rule.
  if (col === C.paid || col === C.downpayment || col === C.balance) {
    syncPaymentEdit(sh, row, col);
    return;
  }

  if (col !== C.timeIn && col !== C.timeOut) return;

  const isRealTime = v => v instanceof Date && v.getFullYear() > 2000;
  const rawOut = sh.getRange(row, C.timeOut).getValue();
  const outWasTimeOnly = rawOut instanceof Date && rawOut.getFullYear() < 2000;
  const times = normalizeVisitTimes(sh, row);
  const timeIn = times.timeIn;
  const timeOut = times.timeOut;
  const statusCell = sh.getRange(row, C.status);

  if (col === C.timeOut && timeOut !== '' && !isRealTime(timeIn)) {
    e.range.clearContent();
    SpreadsheetApp.getActive().toast(
      'Enter Time In first (for example, Oct 21, 2026 3:30 PM), then Time Out.',
      'Study Hub', 8);
    return;
  }
  if (col === C.timeOut && isRealTime(timeOut) && timeOut <= timeIn && !outWasTimeOnly) {
    e.range.clearContent();
    SpreadsheetApp.getActive().toast('Time Out must be after Time In.', 'Study Hub', 6);
    return;
  }
  if (col === C.timeIn && isRealTime(timeIn) && statusCell.getValue() === 'Open') {
    statusCell.setValue('Booked');
  }
  if (col === C.timeIn || col === C.timeOut) recalcTotal(sh, row);

  if (col === C.timeOut && isRealTime(timeOut)) {
    statusCell.setValue('Out');
    snapshotVisit(sh, row);
    lockRow(sh, row);
  }
}

// Payment edits from a staff member. The same rule is used everywhere:
// Paid wins (Balance 0); otherwise Balance = Total minus Downpayment.
// A number typed into Balance is treated as "still owed" and moved into Downpayment.
function syncPaymentEdit(sh, row, col) {
  const toast = msg => SpreadsheetApp.getActive().toast(msg, 'Study Hub', 6);
  if (col === C.paid) {
    syncBalance(sh, row);
    return;
  }

  if (col === C.downpayment) {
    const v = sh.getRange(row, C.downpayment).getValue();
    if (v !== '' && !isNumeric(v)) { toast('Downpayment must be a number.'); return; }
    syncBalance(sh, row);
    return;
  }

  const v = sh.getRange(row, C.balance).getValue();
  if (v !== '' && !isNumeric(v)) { toast('Balance must be a number.'); return; }
  const bal = v === '' ? 0 : Math.max(0, Number(v));
  if (bal > 0 && String(sh.getRange(row, C.paid).getValue()).trim() === 'Paid') {
    toast('This visit is marked Paid. Set Paid to Unpaid before entering a balance.');
    syncBalance(sh, row);
    return;
  }
  const total = Number(sh.getRange(row, C.total).getValue()) || 0;
  sh.getRange(row, C.downpayment).setValue(r2(Math.max(0, total - bal)));
  syncBalance(sh, row);
}

// Runs from the installable "On edit" trigger: runs the edit checks, then refreshes the log for that day.
// When a Time In or Time Out is typed by hand, it also fills blank Personnel for that day.
function onEdit(e) {
  onEditCore(e);
  if (e && e.range && isDayTab(e.range.getSheet().getName())) {
    const sh = e.range.getSheet();
    try {
      syncDayToLog(sh);
      if (e.range.getColumn() === C.timeIn || e.range.getColumn() === C.timeOut) {
        backfillPersonnel(sh);
      }
    } catch (err) {
      console.error('Visit Log sync failed: ' + err.message);
    }
  }
}
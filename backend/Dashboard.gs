// ============================================================
// DASHBOARD: totals, averages, and per-staff stats for the staff dashboard
// ============================================================

// Monday of the week containing a 'yyyy-MM-dd' date
function dashMondayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt.toISOString().slice(0, 10);
}

function dashAdd(map, key, v) {
  if (!map[key]) map[key] = { visitors: 0, sales: 0 };
  map[key].visitors += v.visitors;
  map[key].sales += v.sales;
}

// Clients and payments accepted per staff member: today, this week, this month.
// Only closed visits count. Staff come from Settings column B, plus "Unassigned" for visits with no staff.
function staffStats() {
  const names = getConfig().personnel;
  const today = todayStr();
  const monday = dashMondayOf(today);
  const monthPrefix = today.slice(0, 7);
  const blank = () => ({ clients: 0, collected: 0, gcash: 0, cash: 0, list: [] });
  const windows = { today: {}, week: {}, month: {} };

  // A booking lives on its day tab. With no tab, the log row is from a deleted day.
  const dayTabs = {};
  ss().getSheets().forEach(s => { if (isDayTab(s.getName())) dayTabs[s.getName()] = true; });

  const sh = ss().getSheetByName(LOG_TAB);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, LAST_COL).getValues().forEach(r => {
      if (r[C.status - 1] !== 'Out') return;
      const dv = r[C.date - 1];
      if (!(dv instanceof Date)) return;
      const iso = Utilities.formatDate(dv, TZ, 'yyyy-MM-dd');
      if (!dayTabs[tabNameFor(iso)]) return;
      const staff = String(r[C.personnel - 1] || '').trim() || 'Unassigned';
      const money = visitMoney(r);   // same Paid-wins rule as the sheet
      const collected = money.collected;
      const method = String(r[C.payment - 1] || '').trim();

      const buckets = [];
      if (iso === today) buckets.push('today');
      if (iso >= monday && iso <= today) buckets.push('week');
      if (iso.slice(0, 7) === monthPrefix) buckets.push('month');

      buckets.forEach(b => {
        if (!windows[b][staff]) windows[b][staff] = blank();
        const s = windows[b][staff];
        s.clients += 1;
        s.collected += collected;
        if (method === 'GCash') s.gcash += collected;
        if (method === 'Cash') s.cash += collected;
        s.list.push({ name: String(r[C.name - 1]), date: iso, amount: collected, method: method });
      });
    });
  }

  // Every staff member from Settings appears, even with no visits yet
  const shape = w => {
    const keys = names.slice();
    Object.keys(w).forEach(k => { if (keys.indexOf(k) < 0) keys.push(k); });
    return keys.map(k => {
      const s = w[k] || blank();
      return { name: k, clients: s.clients, collected: r2(s.collected),
               gcash: r2(s.gcash), cash: r2(s.cash),
               list: s.list.slice().reverse().slice(0, 100) };   // newest first
    });
  };
  return { today: shape(windows.today), week: shape(windows.week), month: shape(windows.month) };
}

// Reads closed visits from the Visit Log and returns daily, weekly and monthly totals plus averages.
// Sales and unpaid use visitMoney: Paid visits count the full total, unpaid visits count the
// downpayment recorded, and the rest of the total is owed.
function getDashboard(pin) {
  checkPin(pin);
  const sh = ss().getSheetByName(LOG_TAB);
  const perDay = {};
  let unpaid = 0;
  const yIso = addDaysStr(todayStr(), -1);
  const nowHM = Utilities.formatDate(new Date(), TZ, 'HH:mm');
  const ySoFar = { visitors: 0, sales: 0 };
  const today0 = todayStr();
  const lastWeekMon = addDaysStr(dashMondayOf(today0), -7);
  const lastWeekSame = addDaysStr(today0, -7);   // same weekday last week
  const dayTabs = {};
  ss().getSheets().forEach(s => { if (isDayTab(s.getName())) dayTabs[s.getName()] = true; });
  const [py, pm, todayDayNo] = today0.split('-').map(Number);
  const lastMonthPrefix = new Date(Date.UTC(py, pm - 2, 1)).toISOString().slice(0, 7);
  const wSoFar = { visitors: 0, sales: 0 };
  const mSoFar = { visitors: 0, sales: 0 };
  const unpaidList = [];

  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, LAST_COL).getValues().forEach(r => {
      if (r[C.status - 1] !== 'Out') return;          // closed visits only
      const dv = r[C.date - 1];
      if (!(dv instanceof Date)) return;
      const iso = Utilities.formatDate(dv, TZ, 'yyyy-MM-dd');
      // The day tab is the source of truth; a missing tab means the day was deleted
      if (!dayTabs[tabNameFor(iso)]) return;
      const money = visitMoney(r);   // same Paid-wins rule as the sheet
      const collected = money.collected;
      const owed = money.owed;

      unpaid += owed;
      if (!perDay[iso]) perDay[iso] = { visitors: 0, sales: 0 };
      perDay[iso].visitors += 1;
      perDay[iso].sales += collected;

      // Yesterday up to the same clock time as now, for a fair "vs yesterday" on the Day view
      if (iso === yIso) {
        const tOut = r[C.timeOut - 1];
        const hm = tOut instanceof Date ? Utilities.formatDate(tOut, TZ, 'HH:mm') : '';
        if (hm && hm <= nowHM) {
          ySoFar.visitors += 1;
          ySoFar.sales += collected;
        }
      }

      // Last week and last month up to the same point as now, for fair Week and Month comparisons
      const tOutP = r[C.timeOut - 1];
      const hmP = tOutP instanceof Date ? Utilities.formatDate(tOutP, TZ, 'HH:mm') : '';
      const beforeNow = !hmP || hmP <= nowHM;
      if (iso >= lastWeekMon && (iso < lastWeekSame || (iso === lastWeekSame && beforeNow))) {
        wSoFar.visitors += 1;
        wSoFar.sales += collected;
      }
      if (iso.slice(0, 7) === lastMonthPrefix) {
        const dayNo = Number(iso.slice(8));
        if (dayNo < todayDayNo || (dayNo === todayDayNo && beforeNow)) {
          mSoFar.visitors += 1;
          mSoFar.sales += collected;
        }
      }

      // Who still owes, for the dashboard's Needs attention list
      if (owed > 0) unpaidList.push({ name: String(r[C.name - 1] || ''), date: iso, amount: r2(owed) });
    });
  }

  const weekly = {}, monthly = {};
  Object.keys(perDay).forEach(iso => {
    dashAdd(weekly, dashMondayOf(iso), perDay[iso]);
    dashAdd(monthly, iso.slice(0, 7), perDay[iso]);
  });

  const today = todayStr();
  const thisMonday = dashMondayOf(today);
  const [ty, tm] = today.split('-').map(Number);

  // Last 30 days, last 12 weeks, last 12 months (empty periods filled with zeros)
  const daily = [];
  for (let i = 29; i >= 0; i--) {
    const d = addDaysStr(today, -i);
    daily.push({ label: d, ...(perDay[d] || { visitors: 0, sales: 0 }) });
  }
  const weeklySeries = [];
  for (let i = 11; i >= 0; i--) {
    const w = addDaysStr(thisMonday, -7 * i);
    weeklySeries.push({ label: w, ...(weekly[w] || { visitors: 0, sales: 0 }) });
  }
  const monthlySeries = [];
  for (let i = 11; i >= 0; i--) {
    const k = new Date(Date.UTC(ty, tm - 1 - i, 1)).toISOString().slice(0, 7);
    monthlySeries.push({ label: k, ...(monthly[k] || { visitors: 0, sales: 0 }) });
  }

  // Averages use only the days, weeks or months that had at least one closed visit
  const dayCount = Object.keys(perDay).length;
  const weekCount = Object.keys(weekly).length;
  const monthCount = Object.keys(monthly).length;
  const values = Object.values(perDay);
  const totalV = values.reduce((a, v) => a + v.visitors, 0);
  const totalS = values.reduce((a, v) => a + v.sales, 0);
  const avg = (x, n) => n ? Math.round((x / n) * 100) / 100 : 0;

  return {
    daily,
    weekly: weeklySeries,
    monthly: monthlySeries,
    averages: {
      perDay:   { visitors: avg(totalV, dayCount),   sales: avg(totalS, dayCount) },
      perWeek:  { visitors: avg(totalV, weekCount),  sales: avg(totalS, weekCount) },
      perMonth: { visitors: avg(totalV, monthCount), sales: avg(totalS, monthCount) }
    },
    passes: passSalesList(),
    staff: staffStats(),
    onDuty: onDutyList(),
    yesterdaySoFar: { visitors: ySoFar.visitors, sales: Math.round(ySoFar.sales * 100) / 100 },
    openVisits: openVisitsList(),
    prevSoFar: {
      week: { visitors: wSoFar.visitors, sales: r2(wSoFar.sales) },
      month: { visitors: mSoFar.visitors, sales: r2(mSoFar.sales) }
    },
    unpaidList: unpaidList.sort((x, y) => (x.date < y.date ? 1 : -1)).slice(0, 50),
    recent: recentActivity(),
    cards: cardList(),
    totals: { visitors: totalV, sales: totalS, unpaid: Math.round(unpaid * 100) / 100 }
  };
}

// Visits checked in and not yet checked out (status In) on today's and yesterday's tabs,
// with the bill so far, priced the same way as check-out. Used by the dashboard's live panel.
function openVisitsList() {
  const out = [];
  const now = new Date();
  for (let back = 0; back <= 1; back++) {
    const iso = addDaysStr(todayStr(), -back);
    const sh = ss().getSheetByName(tabNameFor(iso));
    if (!sh || sh.getLastRow() < 2) continue;
    sh.getRange(2, 1, sh.getLastRow() - 1, MULT_HELPER_COL).getValues().forEach(r => {
      if (r[C.status - 1] !== 'In') return;
      const tIn = r[C.timeIn - 1];
      if (!(tIn instanceof Date)) return;
      // A time-only cell is placed on its tab's date
      const start = tIn.getFullYear() < 2000
        ? new Date(iso + 'T' + Utilities.formatDate(tIn, TZ, 'HH:mm') + ':00+08:00')
        : tIn;
      const minutes = Math.max(0, (now - start) / 60000);
      const name = String(r[C.name - 1] || '');
      const parts = name.split(' : ');
      const room = String(r[ROOM_HELPER_COL - 1] || '').trim();
      const mult = Number(r[MULT_HELPER_COL - 1]) || 1;
      const isPass = String(r[C.payment - 1]).trim() === 'Pass';
      out.push({
        room: parts.length > 1 ? parts[0].trim() : room,
        guest: parts.length > 1 ? parts.slice(1).join(' : ').trim() : name,
        timeIn: start.toISOString(),
        pass: isPass,
        bill: isPass ? 0 : (room ? priceFor(room, billedHours(minutes), mult) : null)
      });
    });
  }
  return out;
}

// Latest check-ins and check-outs from today's and yesterday's tabs, newest first.
function recentActivity() {
  const out = [];
  const now = new Date();
  for (let back = 0; back <= 1; back++) {
    const iso = addDaysStr(todayStr(), -back);
    const sh = ss().getSheetByName(tabNameFor(iso));
    if (!sh || sh.getLastRow() < 2) continue;
    // A time-only cell is placed on its tab's date
    const place = t => !(t instanceof Date) ? null
      : (t.getFullYear() < 2000 ? new Date(iso + 'T' + Utilities.formatDate(t, TZ, 'HH:mm') + ':00+08:00') : t);
    sh.getRange(2, 1, sh.getLastRow() - 1, MULT_HELPER_COL).getValues().forEach(r => {
      const status = r[C.status - 1];
      if (status !== 'In' && status !== 'Out') return;
      const full = String(r[C.name - 1] || '');
      const parts = full.split(' : ');
      const room = parts.length > 1 ? parts[0].trim() : String(r[ROOM_HELPER_COL - 1] || '').trim();
      const name = parts.length > 1 ? parts.slice(1).join(' : ').trim() : full;
      const isPass = String(r[C.payment - 1]).trim() === 'Pass';
      const tIn = place(r[C.timeIn - 1]);
      const tOut = place(r[C.timeOut - 1]);
      if (tIn && tIn <= now) out.push({ type: 'in', room: room, name: name, time: tIn.toISOString() });
      if (status === 'Out' && tOut && tOut <= now) {
        out.push({ type: 'out', room: room, name: name, time: tOut.toISOString(),
          amount: Number(r[C.total - 1]) || 0, pass: isPass });
      }
    });
  }
  return out.sort((x, y) => (x.time < y.time ? 1 : -1)).slice(0, 12);
}

// NFC cards already made (Tags tab), newest first, with their tap links.
function cardList() {
  const sh = ss().getSheetByName('Tags');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()
    .filter(r => r[0])
    .map(r => ({ name: String(r[1]), category: String(r[2]), url: SITE_URL + '?t=' + r[0] }))
    .reverse();
}

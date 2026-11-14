// ============================================================
// API: the single entry point for the booking, tap, staff and dashboard pages
// ============================================================

function doGet() {
  return reply({ ok: true, ...getConfig() });
}

// Runs one action. Called while the lock is held, so keep it to the sheet writes only.
function route(b) {
  if (b.action === 'checkPin')           { checkPin(b.pin); return {}; }
  if (b.action === 'visit')              return handleVisit(b);
  if (b.action === 'newToken')           { checkPin(b.pin); return newToken(b.name, b.category); }
  if (b.action === 'tap')                return handleTap(b.token);
  if (b.action === 'dashboard')          return getDashboard(b.pin);
  if (b.action === 'checkin')            return handleCheckin(b);
  if (b.action === 'extend')             return handleExtend(b);
  if (b.action === 'leave')              return handleLeave(b.token);
  if (b.action === 'staffStatus')        return { staff: staffStatusList() };
  if (b.action === 'staffClockIn')       return staffClockIn(b);
  if (b.action === 'staffClockOut')      return staffClockOut(b);
  throw new Error('Unknown action');
}

// Which actions change a day tab, and so need the Visit Log refreshed afterwards
const SYNC_AFTER = ['visit', 'tap', 'checkin', 'extend', 'leave', 'staffClockIn', 'staffClockOut'];

// Read-only actions skip the script lock, so signing in or opening the dashboard
// never fails while a booking or the timer sync is writing.
const READ_ACTIONS = ['checkPin', 'dashboard', 'staffStatus'];

function doPost(e) {
  let lock = null;
  let b;
  let result;
  try {
    b = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    if (READ_ACTIONS.indexOf(b.action) < 0) {
      lock = LockService.getScriptLock();
      try {
        lock.waitLock(30000);
      } catch (lockErr) {
        return reply({ ok: false, error: 'The sheet is busy. Please try again in a few seconds.' });
      }
    }

    result = route(b);
  } catch (err) {
    // Executions log keeps the action and message for future troubleshooting
    console.error('Action ' + (b && b.action) + ' failed: ' + err.message);
    return reply({ ok: false, error: err.message });
  } finally {
    // Release as soon as the action is done, so other requests are not kept waiting
    if (lock) lock.releaseLock();
  }

  // Sync runs after the lock is released. A sync error must not fail a saved booking.
  if (SYNC_AFTER.indexOf(b.action) >= 0) {
    try {
      const sh = b.action === 'visit' ? dayTab(b.date) : dayTab(todayStr());
      syncDayToLog(sh);
      backfillPersonnel(sh);
    } catch (syncErr) {
      console.error('Visit Log sync failed: ' + syncErr.message);
    }
  }
  return reply({ ok: true, ...result });
}
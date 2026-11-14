// Must be the URL of the CURRENT deployment (Deploy > Manage deployments > New version)
const API_URL = 'https://script.google.com/macros/s/AKfycbzlzbiuTATPOKUXBTQubIVFvLIgiHbWeUeZXTaUEgXV8NgiZb1JxZKf0HACJ4--dHHomA/exec';
const TZ = 'Asia/Manila';
const WEB_VERSION = '2026-11-14.2';   // shown in the browser console for support
const FETCH_MS = 30 * 1000;   // give up on a stalled request instead of waiting forever
const $ = id => document.getElementById(id);

let STAFF = [];   // [{ name, onDuty, since }]
let loading = false;
let loggedVersion = false;

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ISO time -> "9:02 AM" in Manila time
function timeOf(iso) {
  return new Date(iso).toLocaleTimeString('en-PH', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
}

function setMsg(text, isErr) {
  const m = $('msg');
  m.textContent = text;
  m.className = 'msg show ' + (isErr ? 'err' : 'ok');
}

function clearMsg() {
  $('msg').className = 'msg';
  $('msg').textContent = '';
}

async function post(body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_MS);
  let res;
  try {
    res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(body), signal: ctl.signal });
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new Error('The server took too long to answer. Please try again.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let r;
  try {
    r = JSON.parse(text);
  } catch (e) {
    throw new Error('Server reply was not valid. Check the Apps Script deployment.');
  }
  if (!r.ok) throw new Error(r.error || 'Something went wrong');
  return r;
}

// Loads who is on duty and refreshes the name list
async function loadStatus() {
  if (loading) return;   // no overlapping requests
  loading = true;
  try {
    const r = await post({ action: 'staffStatus' });
    if (!loggedVersion) {
      loggedVersion = true;
      console.info('LCKDIN web ' + WEB_VERSION + ' · server ' + (r.version || 'unknown'));
    }
    STAFF = r.staff;
    renderStatus();
  } catch (e) {
    setMsg(e.message, true);
  } finally {
    loading = false;
  }
}

function renderStatus() {
  const on = STAFF.filter(s => s.onDuty);
  $('duty').innerHTML = on.length
    ? on.map(s => `<li><span><i class="dot"></i>${esc(s.name)}</span><small>since ${esc(timeOf(s.since))}</small></li>`).join('')
    : '<li class="none">Nobody is on duty</li>';

  const current = $('staffSel').value;
  $('staffSel').innerHTML = '<option value="">Choose your name</option>' +
    STAFF.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('');

  // Remember the name on this device so staff only choose it once
  const saved = current || localStorage.getItem('staffName') || '';
  if (saved && STAFF.some(s => s.name === saved)) $('staffSel').value = saved;

  updateButtons();
}

// Enables Clock in or Clock out depending on who is on duty.
// Clock in stays disabled while anyone else is still on duty.
function updateButtons() {
  ['inBtn', 'outBtn'].forEach(id => $(id).classList.remove('busy'));

  const me = STAFF.find(s => s.name === $('staffSel').value);
  const inNow = !!(me && me.onDuty);
  const other = STAFF.find(s => s.onDuty && (!me || s.name !== me.name));

  $('inBtn').disabled = !me || inNow || !!other;
  $('outBtn').disabled = !me || !inNow;

  if (other && !inNow) {
    $('who').textContent = other.name + ' is still on duty. They must clock out first.';
  } else {
    $('who').textContent = me
      ? (inNow ? 'You are on duty since ' + timeOf(me.since) : 'You are off duty')
      : '';
  }
}

function setBusy(busy) {
  ['inBtn', 'outBtn'].forEach(id => $(id).classList.toggle('busy', busy));
  $('inBtn').disabled = busy;
  $('outBtn').disabled = busy;
}

async function act(kind) {
  clearMsg();
  const name = $('staffSel').value;
  const pin = $('pin').value.trim();
  if (!name) return setMsg('Choose your name first', true);
  if (!pin) return setMsg('Enter your PIN', true);

  setBusy(true);
  try {
    const r = await post({
      action: kind === 'in' ? 'staffClockIn' : 'staffClockOut',
      staff: name,
      pin: pin
    });
    $('pin').value = '';
    if (kind === 'in') {
      setMsg('Clocked in at ' + timeOf(r.at), false);
    } else {
      setMsg('Clocked out at ' + timeOf(r.at) + ' · ' + r.hours + ' hr', false);
    }
    await loadStatus();
  } catch (e) {
    setMsg(e.message, true);
    updateButtons();
  }
}

$('inBtn').onclick = () => act('in');
$('outBtn').onclick = () => act('out');

$('staffSel').onchange = () => {
  localStorage.setItem('staffName', $('staffSel').value);
  clearMsg();
  updateButtons();
};

$('pin').onkeydown = e => {
  if (e.key === 'Enter') {
    const me = STAFF.find(s => s.name === $('staffSel').value);
    act(me && me.onDuty ? 'out' : 'in');
  }
};

loadStatus();
setInterval(() => { if (!document.hidden) loadStatus(); }, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadStatus(); });

/* =====================================================================
   OFFICE INVENTORY DASHBOARD — app.js
   Talks to the Google Apps Script Web App; computes all analytics
   client-side so every add / edit / delete updates the whole dashboard.
   ===================================================================== */

/* ----------------------------- CONFIG ------------------------------- */
/* Paste your deployed Apps Script Web App URL below (or set it once in
   Settings > Connection inside the app). It ends in /exec              */
var API_URL_DEFAULT = "PASTE_YOUR_WEB_APP_URL_HERE";

var API_URL = (function () {
  var saved = localStorage.getItem("inv_api_url");
  return (saved && saved.indexOf("http") === 0) ? saved
       : (API_URL_DEFAULT.indexOf("http") === 0 ? API_URL_DEFAULT : "");
})();

var SERIES = ['var(--s1)','var(--s2)','var(--s3)','var(--s4)','var(--s5)','var(--s6)','var(--s7)','var(--s8)'];
var CATS = ['Stationery','Pantry'];

/* ----------------------------- STATE -------------------------------- */
var S = {
  items: [], consumption: [], orders: [], suppliers: [], activity: [],
  settings: {},
  loaded: false, offline: !navigator.onLine,
  tab: 'home', sub: 'Stationery',
  user: localStorage.getItem('inv_user') || '',
  simple: localStorage.getItem('inv_simple') === '1',
  derived: {},   // itemId -> computed
  ui: {}         // per-view transient (sort, filter, search)
};

/* --------------------------- UTILITIES ------------------------------ */
function $(sel, root) { return (root || document).querySelector(sel); }
function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
  });
}
function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
function round(n, d) { var p = Math.pow(10, d || 0); return Math.round(n * p) / p; }
function cur() { return (S.settings.currency || '₹'); }
function money(n) {
  n = num(n);
  var s = Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return (n < 0 ? '-' : '') + cur() + s;
}
function today() { return new Date().toISOString().slice(0, 10); }
function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function ymd(v) { var d = toDate(v); return d ? d.toISOString().slice(0, 10) : ''; }
function fmtDate(v) {
  var d = toDate(v); if (!d) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateShort(v) {
  var d = toDate(v); if (!d) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}
function daysAgo(v) {
  var d = toDate(v); if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}
function relDays(v) {
  var n = daysAgo(v);
  if (n == null) return 'never';
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 30) return n + ' days ago';
  if (n < 60) return 'a month ago';
  return Math.round(n / 30) + ' months ago';
}
function monthsBetween(a, b) {
  var da = toDate(a), db = toDate(b); if (!da || !db) return 0;
  return (db.getTime() - da.getTime()) / (86400000 * 30.44);
}
function uid(p) { return (p || 'L') + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36); }
function debounce(fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms || 250); }; }
function by(key, dir) {
  dir = dir === 'desc' ? -1 : 1;
  return function (a, b) {
    var x = a[key], y = b[key];
    if (typeof x === 'string') x = x.toLowerCase();
    if (typeof y === 'string') y = y.toLowerCase();
    if (x == null) x = dir === 1 ? Infinity : -Infinity;
    if (y == null) y = dir === 1 ? Infinity : -Infinity;
    return x < y ? -1 * dir : x > y ? 1 * dir : 0;
  };
}
function pill(status) {
  var m = {
    out: ['b-danger', 'Out of stock'], critical: ['b-danger', 'Critical'],
    low: ['b-warn', 'Reorder'], ok: ['b-ok', 'OK'], overstock: ['b-accent', 'Overstock']
  }[status] || ['b-muted', status];
  return '<span class="badge ' + m[0] + '">' + ICON(status === 'ok' ? 'check' : status === 'overstock' ? 'up' : 'warn', 12) + esc(m[1]) + '</span>';
}

/* --------------------------- ICONS ---------------------------------- */
var ICONS = {
  home:'M3 11l9-8 9 8M5 9v11h5v-6h4v6h5V9',
  overview:'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
  record:'M9 3h6a1 1 0 011 1v1h1a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2V7a2 2 0 012-2h1V4a1 1 0 011-1zM9 12l2 2 4-4',
  required:'M6 2l1.5 3M18 2l-1.5 3M3 7h18l-1.5 12a2 2 0 01-2 1.8H6.5a2 2 0 01-2-1.8L3 7zM9 11v5M15 11v5',
  orders:'M3 3h2l2.4 12.5a1.5 1.5 0 001.5 1.2h8.6a1.5 1.5 0 001.5-1.2L21 8H6M9 20a1 1 0 100 2 1 1 0 000-2zM17 20a1 1 0 100 2 1 1 0 000-2z',
  finance:'M4 20V10M10 20V4M16 20v-7M22 20H2',
  suppliers:'M3 8h11v9H3zM14 11h4l3 3v3h-7M6.5 20a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17.5 20a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
  settings:'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 01-4 0v-.1A1.7 1.7 0 006 19.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00-1.2-2.9H2a2 2 0 010-4h.1A1.7 1.7 0 003.3 6l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.6V2a2 2 0 014 0v.1A1.7 1.7 0 0018 3.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.6 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z',
  activity:'M22 12h-4l-3 9L9 3l-3 9H2',
  box:'M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10',
  plus:'M12 5v14M5 12h14',
  minus:'M5 12h14',
  search:'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.3-4.3',
  filter:'M3 5h18l-7 8v6l-4 2v-8L3 5z',
  trash:'M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13',
  check:'M20 6L9 17l-5-5',
  x:'M18 6L6 18M6 6l12 12',
  warn:'M12 3l9.5 16.5H2.5L12 3zM12 10v4M12 17.5v.5',
  up:'M12 19V5M5 12l7-7 7 7',
  down:'M12 5v14M5 12l7 7 7-7',
  edit:'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z',
  download:'M12 3v12M7 10l5 5 5-5M4 21h16',
  moon:'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  sun:'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z',
  clock:'M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2',
  refresh:'M21 12a9 9 0 11-3-6.7M21 4v5h-5',
  user:'M20 21a8 8 0 10-16 0M12 11a4 4 0 100-8 4 4 0 000 8z',
  dup:'M9 9h11v11H9zM5 15H4V4h11v1',
  tag:'M20 12l-8 8-9-9V3h8l9 9zM7.5 7.5h.01'
};
function ICON(name, size) {
  var p = ICONS[name] || ICONS.box;
  var s = size || 20;
  return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    p.split('M').filter(Boolean).map(function (seg) { return '<path d="M' + seg + '"/>'; }).join('') +
    '</svg>';
}

/* --------------------------- STORAGE CACHE -------------------------- */
function cacheSave() {
  try {
    localStorage.setItem('inv_cache', JSON.stringify({
      items: S.items, consumption: S.consumption, orders: S.orders,
      suppliers: S.suppliers, activity: S.activity.slice(-500), settings: S.settings, at: Date.now()
    }));
  } catch (e) {}
}
function cacheLoad() {
  try {
    var c = JSON.parse(localStorage.getItem('inv_cache') || 'null');
    if (c && c.items) {
      S.items = c.items; S.consumption = c.consumption || []; S.orders = c.orders || [];
      S.suppliers = c.suppliers || []; S.activity = c.activity || []; S.settings = c.settings || {};
      return true;
    }
  } catch (e) {}
  return false;
}

/* ------------------------------ API --------------------------------- */
function apiConfigured() { return API_URL && API_URL.indexOf('http') === 0; }

function apiGetAll() {
  return fetch(API_URL + '?action=getAll&t=' + Date.now(), { method: 'GET' })
    .then(function (r) { return r.json(); });
}
function apiPost(payload) {
  payload.user = S.user;
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  }).then(function (r) { return r.json(); });
}

function loadData(showSpin) {
  if (!apiConfigured()) {
    if (cacheLoad()) { S.loaded = true; recompute(); render(); }
    return openConnectionSetup();
  }
  if (showSpin) setSync('busy', 'Syncing…');
  return apiGetAll().then(function (d) {
    if (d.error) throw new Error(d.error);
    S.items = d.items || []; S.consumption = d.consumption || [];
    S.orders = d.orders || []; S.suppliers = d.suppliers || [];
    S.activity = d.activity || []; S.settings = d.settings || {};
    S.loaded = true; S.offline = false; document.body.classList.remove('is-offline');
    cacheSave(); recompute(); render(); setSync('ok', 'Synced');
  }).catch(function (e) {
    S.offline = true; document.body.classList.add('is-offline');
    setSync('err', 'Offline');
    if (!S.loaded && cacheLoad()) { S.loaded = true; recompute(); render(); }
    else if (!S.loaded) { render(); }
  });
}

/* create/update/delete with optimistic local update, then server, then refresh */
function saveRecord(entity, record, isNew) {
  if (S.offline || !apiConfigured()) { toast('You are offline — cannot save right now.', 'err'); return Promise.reject(); }
  setSync('busy', 'Saving…');
  var action = isNew ? 'create' : 'update';
  return apiPost({ action: action, entity: entity, record: record })
    .then(function (res) {
      if (res.error) throw new Error(res.error);
      return loadData(false).then(function () { setSync('ok', 'Saved'); return res.record; });
    })
    .catch(function (e) { setSync('err', 'Save failed'); toast('Could not save: ' + e.message, 'err'); throw e; });
}
function deleteRecord(entity, id) {
  if (S.offline || !apiConfigured()) { toast('You are offline — cannot delete right now.', 'err'); return Promise.reject(); }
  setSync('busy', 'Deleting…');
  return apiPost({ action: 'delete', entity: entity, id: id })
    .then(function (res) {
      if (res.error) throw new Error(res.error);
      return loadData(false).then(function () { setSync('ok', 'Deleted'); });
    })
    .catch(function (e) { setSync('err', 'Delete failed'); toast('Could not delete: ' + e.message, 'err'); throw e; });
}
function bulkCreate(entity, records) {
  if (S.offline || !apiConfigured()) { toast('You are offline — cannot save right now.', 'err'); return Promise.reject(); }
  setSync('busy', 'Saving…');
  return apiPost({ action: 'bulkCreate', entity: entity, records: records })
    .then(function (res) {
      if (res.error) throw new Error(res.error);
      return loadData(false).then(function () { setSync('ok', 'Saved'); return res.records; });
    })
    .catch(function (e) { setSync('err', 'Save failed'); toast('Could not save: ' + e.message, 'err'); throw e; });
}
function saveSetting(key, value) {
  S.settings[key] = value;
  if (apiConfigured() && !S.offline) apiPost({ action: 'saveSetting', key: key, value: value }).catch(function () {});
}

/* --------------------------- DERIVED / COMPUTE ---------------------- */
function itemById(id) { return S.derived._itemMap ? S.derived._itemMap[id] : null; }
function supplierById(id) { return (S.suppliers || []).filter(function (s) { return s.id === id; })[0]; }

function recompute() {
  var d = { _itemMap: {} };
  S.items.forEach(function (it) { d._itemMap[it.id] = it; });

  // group consumption by item
  var consByItem = {};
  S.consumption.forEach(function (c) { (consByItem[c.itemId] = consByItem[c.itemId] || []).push(c); });

  // received order lines by item (for stock-in + latest price)
  var recvByItem = {}, priceByItem = {};
  (S.orders || []).forEach(function (o) {
    var lines = parseLines(o.linesJSON);
    var received = (o.status === 'Received');
    lines.forEach(function (ln) {
      if (!ln.itemId) return;
      if (received) {
        (recvByItem[ln.itemId] = recvByItem[ln.itemId] || []).push({ date: o.receivedDate || o.date, qty: num(ln.qty) });
      }
      // latest known price from any order (received or ordered), by date
      var pd = o.receivedDate || o.date;
      var cur2 = priceByItem[ln.itemId];
      if (num(ln.unitPrice) > 0 && (!cur2 || (toDate(pd) && toDate(cur2.date) && toDate(pd) > toDate(cur2.date)))) {
        priceByItem[ln.itemId] = { price: num(ln.unitPrice), date: pd };
      }
    });
  });

  S.items.forEach(function (it) {
    var events = [];
    var openDate = it.openingDate || ymd(it.createdAt) || today();
    events.push({ date: openDate, seq: 0, type: 'set', value: num(it.openingStock), src: 'open' });
    (consByItem[it.id] || []).forEach(function (c) {
      var dt = ymd(c.date) || ymd(c.createdAt) || today();
      if (c.mode === 'used') events.push({ date: dt, seq: seqOf(c), type: 'delta', value: -Math.abs(num(c.value)), src: 'use' });
      else if (c.mode === 'added') events.push({ date: dt, seq: seqOf(c), type: 'delta', value: Math.abs(num(c.value)), src: 'add' });
      else events.push({ date: dt, seq: seqOf(c), type: 'set', value: num(c.value), src: 'count' }); // 'left'/count
    });
    (recvByItem[it.id] || []).forEach(function (r) {
      events.push({ date: ymd(r.date) || today(), seq: 1, type: 'delta', value: Math.abs(num(r.qty)), src: 'recv' });
    });
    events.sort(function (a, b) {
      var da = toDate(a.date).getTime(), db = toDate(b.date).getTime();
      return da !== db ? da - db : (a.seq - b.seq);
    });

    var stock = 0, consumedSeries = [], totalConsumed = 0, firstObs = openDate, lastCount = null;
    events.forEach(function (ev) {
      if (ev.type === 'set') {
        if (ev.src === 'count') {
          var used = Math.max(0, stock - ev.value);
          if (used > 0) { totalConsumed += used; consumedSeries.push({ date: ev.date, qty: used }); }
          lastCount = ev.date;
        }
        stock = ev.value;
      } else {
        stock += ev.value;
        if (ev.src === 'use') { totalConsumed += Math.abs(ev.value); consumedSeries.push({ date: ev.date, qty: Math.abs(ev.value) }); lastCount = ev.date; }
      }
    });
    var current = Math.max(0, round(stock, 2));

    // rates
    var obsMonths = Math.max(0.25, monthsBetween(firstObs, today()));
    var actualRate = totalConsumed > 0 ? totalConsumed / obsMonths : 0;   // per month
    var inputRate = (it.needQty && it.needPeriodMonths) ? num(it.needQty) / num(it.needPeriodMonths) : 0;
    var daysCover = actualRate > 0 ? (current / (actualRate / 30.44)) : null;

    // price / value
    var price = priceByItem[it.id] ? priceByItem[it.id].price : num(it.unitCost);
    var value = current * price;

    // reorder level
    var thr = it.reorderThresholdPct != null && it.reorderThresholdPct !== '' ? num(it.reorderThresholdPct) : num(S.settings.defaultThresholdPct || 15);
    var rl = (it.reorderLevel != null && it.reorderLevel !== '') ? num(it.reorderLevel)
             : (it.needUnit === it.unit && it.needQty ? Math.max(1, Math.round(num(it.needQty) * thr / 100)) : 0);

    // status
    var status = 'ok';
    if (current <= 0) status = 'out';
    else if (rl > 0 && current <= rl) status = (current <= rl * 0.5) ? 'critical' : 'low';
    else if (daysCover != null && daysCover < 7) status = 'critical';
    else if (daysCover != null && daysCover < 14) status = 'low';
    else if (it.needUnit === it.unit && it.needQty && current > num(it.needQty) * 2 && actualRate === 0) status = 'overstock';
    var needsOrder = (status === 'out' || status === 'critical' || status === 'low');

    // suggested order qty: top up to one need-cycle above reorder level
    var target = (it.needUnit === it.unit && it.needQty) ? num(it.needQty) : (rl > 0 ? rl * 2 : current);
    var suggested = Math.max(0, Math.round((target + rl) - current));
    if (!needsOrder) suggested = 0;

    d[it.id] = {
      current: current, price: price, value: value,
      actualRate: actualRate, inputRate: inputRate, daysCover: daysCover,
      totalConsumed: totalConsumed, consumedSeries: consumedSeries,
      obsMonths: obsMonths, lastCount: lastCount, reorderLevel: rl,
      status: status, needsOrder: needsOrder, suggested: suggested,
      pctOfNeed: (it.needUnit === it.unit && it.needQty) ? (current / num(it.needQty)) : null
    };
  });

  S.derived = d;
}
function seqOf(c) { var t = toDate(c.createdAt); return t ? t.getTime() % 1e9 : 1; }
function parseLines(j) {
  if (!j) return [];
  if (typeof j === 'object') return j;
  try { var v = JSON.parse(j); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

/* items filtered to current sub-category, with derived merged for convenience */
function itemsIn(cat) {
  return S.items.filter(function (it) { return it.category === cat && String(it.active) !== 'false'; });
}
function D(id) { return S.derived[id] || {}; }

/* --------------------------- UI: SYNC / TOAST / MODAL --------------- */
function setSync(kind, text) {
  var el = $('#syncDot'); if (!el) return;
  el.className = 'syncdot' + (kind === 'busy' ? ' busy' : kind === 'err' ? ' err' : kind === 'off' ? ' off' : '');
  $('#syncText').textContent = text;
  if (kind === 'ok') setTimeout(function () { if ($('#syncText')) { $('#syncText').textContent = 'Synced'; } }, 1500);
}
function toast(msg, kind) {
  var t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  t.innerHTML = ICON(kind === 'err' ? 'warn' : kind === 'ok' ? 'check' : 'refresh', 16) + '<span>' + esc(msg) + '</span>';
  $('#toasts').appendChild(t);
  setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(function () { t.remove(); }, 300); }, 3200);
}
function openModal(html, opts) {
  opts = opts || {};
  var back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = '<div class="modal ' + (opts.wide ? 'wide' : '') + '" role="dialog" aria-modal="true">' + html + '</div>';
  back.addEventListener('mousedown', function (e) { if (e.target === back && !opts.sticky) closeModal(); });
  $('#modalMount').appendChild(back);
  document.body.style.overflow = 'hidden';
  return back;
}
function closeModal() {
  $('#modalMount').innerHTML = '';
  document.body.style.overflow = '';
}
function confirmBox(opts) {
  var m = openModal(
    '<div class="modal-h"><h3>' + esc(opts.title || 'Are you sure?') + '</h3></div>' +
    '<div class="modal-b"><p style="margin:0;color:var(--ink-2)">' + (opts.body || '') + '</p></div>' +
    '<div class="modal-f"><button class="btn ghost" data-x>Cancel</button>' +
    '<button class="btn ' + (opts.danger ? 'danger' : 'primary') + '" data-ok>' + esc(opts.ok || 'Confirm') + '</button></div>');
  $('[data-x]', m).onclick = closeModal;
  $('[data-ok]', m).onclick = function () { closeModal(); opts.onOk && opts.onOk(); };
}

document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

/* --------------------------- NAVIGATION ----------------------------- */
var TABS = [
  { id: 'home', name: 'Home', icon: 'home', grp: 'Daily', title: 'Home', sub: 'What needs attention' },
  { id: 'overview', name: 'Overview', icon: 'overview', grp: 'Daily', title: 'Overview', sub: 'All items & stock' },
  { id: 'record', name: 'Record Consumption', icon: 'record', grp: 'Daily', title: 'Record', sub: 'Log weekly usage' },
  { id: 'required', name: 'Required Items', icon: 'required', grp: 'Daily', title: 'Required Items', sub: 'To be ordered' },
  { id: 'orders', name: 'Orders', icon: 'orders', grp: 'Daily', title: 'Orders', sub: 'Place & track orders' },
  { id: 'finance', name: 'Finance', icon: 'finance', grp: 'Analysis', title: 'Finance', sub: 'Cost & spend analytics' },
  { id: 'suppliers', name: 'Suppliers', icon: 'suppliers', grp: 'Manage', title: 'Suppliers', sub: 'Vendor directory' },
  { id: 'items', name: 'Item Master', icon: 'box', grp: 'Manage', title: 'Item Master', sub: 'Add / edit items' },
  { id: 'activity', name: 'Activity Log', icon: 'activity', grp: 'Manage', title: 'Activity Log', sub: 'Who changed what' },
  { id: 'settings', name: 'Settings', icon: 'settings', grp: 'Manage', title: 'Settings', sub: 'Lists, users, connection' }
];
var MOBILE_TABS = ['home', 'overview', 'record', 'required', 'orders'];

function renderNav() {
  var counts = navCounts();
  var grps = {}; TABS.forEach(function (t) { (grps[t.grp] = grps[t.grp] || []).push(t); });
  var html = '';
  Object.keys(grps).forEach(function (g) {
    html += '<div class="grp">' + esc(g) + '</div>';
    grps[g].forEach(function (t) {
      var c = counts[t.id];
      html += '<button class="' + (S.tab === t.id ? 'active' : '') + (t.id === 'required' && c ? ' alert' : '') + '" data-tab="' + t.id + '">' +
        '<span class="ico">' + ICON(t.icon, 19) + '</span>' + esc(t.name) +
        (c ? '<span class="count">' + c + '</span>' : '') + '</button>';
    });
  });
  $('#nav').innerHTML = html;
  $all('#nav button').forEach(function (b) { b.onclick = function () { setTab(b.dataset.tab); document.body.classList.remove('nav-open'); }; });

  // bottom nav (mobile)
  $('#botnav').innerHTML = MOBILE_TABS.map(function (id) {
    var t = TABS.filter(function (x) { return x.id === id; })[0];
    var c = counts[id];
    return '<button class="' + (S.tab === id ? 'active' : '') + '" data-tab="' + id + '">' + ICON(t.icon, 21) +
      '<span>' + esc(id === 'record' ? 'Record' : id === 'required' ? 'Reorder' : t.name) + '</span>' +
      (c ? '<span class="count badge b-danger" style="position:static;padding:0 5px;font-size:9px">' + c + '</span>' : '') + '</button>';
  }).join('');
  $all('#botnav button').forEach(function (b) { b.onclick = function () { setTab(b.dataset.tab); }; });

  $('#userChip').innerHTML = ICON('user', 15) + '<span style="margin-left:2px">' + esc(S.user || 'Set name') + '</span>';
  $('#userChip').onclick = askUser;
}
function navCounts() {
  var reorder = 0;
  S.items.forEach(function (it) { if (String(it.active) !== 'false' && D(it.id).needsOrder) reorder++; });
  return { required: reorder };
}

function setTab(id) {
  S.tab = id;
  S.ui = {}; // reset per-view transient state
  var t = TABS.filter(function (x) { return x.id === id; })[0] || TABS[0];
  $('#pageTitle').textContent = t.title;
  $('#pageSub').textContent = t.sub;
  window.scrollTo(0, 0);
  renderNav();
  renderView();
}

/* master render */
function render() { renderNav(); renderView(); updatePrimary(); }

function updatePrimary() {
  var pa = $('#primaryAction'); if (!pa) return;
  var map = {
    overview: ['Add item', function () { itemForm(); }],
    items: ['Add item', function () { itemForm(); }],
    record: ['Quick count', function () { setTab('record'); startQuickCount(); }],
    orders: ['New order', function () { orderForm(); }],
    suppliers: ['Add supplier', function () { supplierForm(); }],
    required: ['Order all', function () { orderFromRequired(); }]
  };
  var m = map[S.tab];
  if (m && !S.offline) { pa.style.display = ''; pa.innerHTML = ICON('plus', 16) + m[0]; pa.onclick = m[1]; }
  else pa.style.display = 'none';
}

function renderView() {
  updatePrimary();
  var v = $('#view');
  if (!S.loaded && !apiConfigured()) { return; }
  if (!S.loaded) { v.innerHTML = '<div class="loading"><div class="spinner"></div><span>Loading…</span></div>'; return; }
  var fn = {
    home: viewHome, overview: viewOverview, record: viewRecord, required: viewRequired,
    orders: viewOrders, finance: viewFinance, suppliers: viewSuppliers,
    items: viewItems, activity: viewActivity, settings: viewSettings
  }[S.tab] || viewHome;
  fn(v);
}

/* sub-tab bar */
function subtabBar(counts) {
  return '<div class="subtabs">' + CATS.map(function (c) {
    return '<button class="subtab ' + (S.sub === c ? 'active' : '') + '" data-sub="' + c + '">' + esc(c) +
      (counts && counts[c] != null ? '<span class="n">' + counts[c] + '</span>' : '') + '</button>';
  }).join('') + '</div>';
}
function wireSubtabs(root, cb) {
  $all('[data-sub]', root).forEach(function (b) {
    b.onclick = function () { S.sub = b.dataset.sub; cb ? cb() : renderView(); };
  });
}

/* =================================================================== */
/*  VIEW: HOME (alerts + KPIs)                                          */
/* =================================================================== */
function viewHome(v) {
  var reorder = [], stale = [], pendingOrders = [];
  S.items.forEach(function (it) {
    if (String(it.active) === 'false') return;
    var d = D(it.id);
    if (d.needsOrder) reorder.push(it);
    var da = daysAgo(d.lastCount || it.openingDate);
    if (da != null && da > 30) stale.push(it);
  });
  (S.orders || []).forEach(function (o) { if (o.status === 'Ordered' || o.status === 'Draft') pendingOrders.push(o); });
  reorder.sort(function (a, b) { return (D(a.id).daysCover || 999) - (D(b.id).daysCover || 999); });

  var totalItems = S.items.filter(function (i) { return String(i.active) !== 'false'; }).length;
  var invValue = 0; S.items.forEach(function (it) { invValue += D(it.id).value || 0; });
  var monthSpend = spendInLastDays(30);

  var html = '';
  html += '<div class="kpis">';
  html += kpi('Items tracked', totalItems, CATS.map(function (c) { return itemsIn(c).length + ' ' + c.toLowerCase(); }).join(' · '), '');
  html += kpi('Need to order', reorder.length, reorder.length ? 'Tap to view list' : 'All good', reorder.length ? 'danger' : 'ok');
  html += kpi('Inventory value', money(invValue), 'At latest known prices', 'accent');
  html += kpi('Spent (30 days)', money(monthSpend), pendingOrders.length + ' order(s) pending', '');
  html += '</div>';

  // Alerts feed
  html += '<div class="card" style="margin-bottom:16px"><div class="card-h">' + ICON('warn', 18) +
    '<h3>Needs attention</h3><div class="spacer"></div>' +
    '<button class="btn sm" id="goReq">View all</button></div><div class="card-b">';
  if (!reorder.length && !stale.length && !pendingOrders.length) {
    html += emptyState('check', 'Everything is in order', 'No items below reorder level, no stale counts, no pending orders.');
  } else {
    reorder.slice(0, 8).forEach(function (it) {
      var d = D(it.id);
      html += alertItem(it.id, statusColorClass(d.status), 'required',
        esc(it.name), (d.status === 'out' ? 'Out of stock' : 'Only ' + fmtQty(d.current, it.unit) + ' left') +
        (d.daysCover != null ? ' · ~' + Math.round(d.daysCover) + ' days cover' : '') +
        ' · suggest ' + fmtQty(d.suggested, it.unit));
    });
    stale.slice(0, 4).forEach(function (it) {
      html += alertItem(it.id, 'b-warn', 'clock', esc(it.name) + ' — not counted', 'Last counted ' + relDays(D(it.id).lastCount || it.openingDate) + '. Please recount.');
    });
    pendingOrders.slice(0, 4).forEach(function (o) {
      html += '<div class="alert-item" data-order="' + esc(o.id) + '"><div class="ai-ico b-accent" style="background:var(--accent-bg);color:var(--accent-ink)">' + ICON('orders', 19) + '</div>' +
        '<div class="grow"><div class="ai-t">Order ' + esc(o.status.toLowerCase()) + ' — ' + esc(o.supplierName || 'supplier') + '</div>' +
        '<div class="ai-s">' + money(o.total) + ' · ' + esc(parseLines(o.linesJSON).length) + ' item(s) · ' + fmtDate(o.date) + '</div></div>' +
        ICON('up', 16) + '</div>';
    });
  }
  html += '</div></div>';

  // quick actions
  html += '<div class="row" style="margin-bottom:16px">' +
    '<button class="btn primary" id="qc">' + ICON('record', 16) + 'Record consumption</button>' +
    '<button class="btn" id="qo">' + ICON('orders', 16) + 'New order</button>' +
    '<button class="btn" id="qov">' + ICON('overview', 16) + 'Open overview</button></div>';

  // mini consumption trend
  html += '<div class="charts-grid">';
  html += chartBox('Consumption value — last 6 months', 'Estimated value of items consumed', lineChartSVG(consumptionValueSeries(6), { color: 'var(--s1)', money: true }));
  html += chartBox('Spend — last 6 months', 'From received orders', barChartSVG(spendSeries(6), { color: 'var(--s2)', money: true }));
  html += '</div>';

  v.innerHTML = html;
  $('#goReq').onclick = function () { setTab('required'); };
  $('#qc').onclick = function () { setTab('record'); };
  $('#qo').onclick = function () { orderForm(); };
  $('#qov').onclick = function () { setTab('overview'); };
  $all('.alert-item[data-item]', v).forEach(function (a) { a.onclick = function () { itemDetail(a.dataset.item); }; });
  $all('.alert-item[data-order]', v).forEach(function (a) { a.onclick = function () { orderDetail(a.dataset.order); }; });
  wireCharts(v);
}
function statusColorClass(s) { return (s === 'out' || s === 'critical') ? 'b-danger' : s === 'low' ? 'b-warn' : 'b-muted'; }
function alertItem(itemId, cls, icon, title, sub) {
  var col = cls === 'b-danger' ? 'background:var(--danger-bg);color:var(--danger-ink)' :
            cls === 'b-warn' ? 'background:var(--warn-bg);color:var(--warn-ink)' : 'background:var(--surface-3);color:var(--ink-2)';
  return '<div class="alert-item" data-item="' + esc(itemId) + '"><div class="ai-ico" style="' + col + '">' + ICON(icon, 19) + '</div>' +
    '<div class="grow"><div class="ai-t">' + title + '</div><div class="ai-s">' + sub + '</div></div>' + ICON('up', 16) + '</div>';
}
function kpi(label, value, desc, kind) {
  return '<div class="kpi ' + (kind || '') + '"><div class="l">' + esc(label) + '</div><div class="v">' + value + '</div>' +
    (desc ? '<div class="d">' + esc(desc) + '</div>' : '') + '</div>';
}
function emptyState(icon, title, sub) {
  return '<div class="empty">' + ICON(icon, 44) + '<h4>' + esc(title) + '</h4><div>' + esc(sub || '') + '</div></div>';
}
function chartBox(title, sub, svg) {
  return '<div class="chart-box"><h3>' + esc(title) + '</h3><div class="csub">' + esc(sub) + '</div>' + svg + '</div>';
}
function fmtQty(n, unit) { return round(num(n), 2).toLocaleString('en-IN') + (unit ? ' ' + unit : ''); }

/* =================================================================== */
/*  Generic list view (Overview / Items) with sort/filter/search       */
/* =================================================================== */
function listToolbar(id, extra) {
  return '<div class="toolbar">' +
    '<div class="search grow">' + ICON('search', 16) + '<input id="' + id + '_q" placeholder="Search items…" autocomplete="off"></div>' +
    '<select id="' + id + '_sub2" class="hide"></select>' +
    '<select id="' + id + '_status" style="width:auto;min-width:130px"><option value="">All statuses</option>' +
    '<option value="need">Needs order</option><option value="out">Out of stock</option><option value="ok">OK</option></select>' +
    '<select id="' + id + '_cat" style="width:auto;min-width:150px"><option value="">All sub-categories</option></select>' +
    (extra || '') + '</div>';
}
function getUI(k, def) { if (S.ui[k] == null) S.ui[k] = def; return S.ui[k]; }

function viewOverview(v) { itemListView(v, 'ov', false); }
function viewItems(v) { itemListView(v, 'im', true); }

function itemListView(v, key, isMaster) {
  var counts = {}; CATS.forEach(function (c) { counts[c] = itemsIn(c).length; });
  var html = subtabBar(counts) + listToolbar(key);
  html += '<div id="' + key + '_res"></div>';
  v.innerHTML = html;
  wireSubtabs(v, function () { renderView(); });

  // populate sub-category filter
  var subcats = subcatsFor(S.sub);
  var catSel = $('#' + key + '_cat');
  catSel.innerHTML = '<option value="">All sub-categories</option>' + subcats.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');

  var refresh = function () { renderItemRows(key, isMaster); };
  $('#' + key + '_q').addEventListener('input', debounce(refresh, 200));
  $('#' + key + '_status').onchange = refresh;
  $('#' + key + '_cat').onchange = refresh;
  refresh();
}

function currentItemRows(key) {
  var q = ($('#' + key + '_q') && $('#' + key + '_q').value || '').toLowerCase().trim();
  var status = $('#' + key + '_status') ? $('#' + key + '_status').value : '';
  var cat = $('#' + key + '_cat') ? $('#' + key + '_cat').value : '';
  var rows = itemsIn(S.sub);
  if (q) rows = rows.filter(function (it) { return (it.name + ' ' + (it.brand || '') + ' ' + (it.subcategory || '')).toLowerCase().indexOf(q) >= 0; });
  if (cat) rows = rows.filter(function (it) { return it.subcategory === cat; });
  if (status === 'need') rows = rows.filter(function (it) { return D(it.id).needsOrder; });
  else if (status === 'out') rows = rows.filter(function (it) { return D(it.id).current <= 0; });
  else if (status === 'ok') rows = rows.filter(function (it) { return !D(it.id).needsOrder; });
  var sort = getUI(key + '_sort', { col: 'name', dir: 'asc' });
  rows.sort(sortItems(sort.col, sort.dir));
  return rows;
}
function sortItems(col, dir) {
  return function (a, b) {
    var av, bv, da = D(a.id), db = D(b.id);
    switch (col) {
      case 'name': av = a.name.toLowerCase(); bv = b.name.toLowerCase(); break;
      case 'stock': av = da.current; bv = db.current; break;
      case 'need': av = num(a.needQty); bv = num(b.needQty); break;
      case 'cover': av = da.daysCover == null ? Infinity : da.daysCover; bv = db.daysCover == null ? Infinity : db.daysCover; break;
      case 'usage': av = da.actualRate; bv = db.actualRate; break;
      case 'value': av = da.value; bv = db.value; break;
      case 'last': av = toDate(da.lastCount) ? toDate(da.lastCount).getTime() : 0; bv = toDate(db.lastCount) ? toDate(db.lastCount).getTime() : 0; break;
      case 'cat': av = (a.subcategory || '').toLowerCase(); bv = (b.subcategory || '').toLowerCase(); break;
      case 'status': av = statusRank(da.status); bv = statusRank(db.status); break;
      default: av = a.name; bv = b.name;
    }
    var m = dir === 'desc' ? -1 : 1;
    return av < bv ? -m : av > bv ? m : 0;
  };
}
function statusRank(s) { return { out: 0, critical: 1, low: 2, ok: 3, overstock: 4 }[s] != null ? { out: 0, critical: 1, low: 2, ok: 3, overstock: 4 }[s] : 5; }

function renderItemRows(key, isMaster) {
  var rows = currentItemRows(key);
  var sort = getUI(key + '_sort', { col: 'name', dir: 'asc' });
  var box = $('#' + key + '_res');
  if (!rows.length) { box.innerHTML = emptyState('search', 'No items match', 'Try clearing the search or filters. Use “Add item” to create one.'); return; }

  function sh(col, label, cls) {
    var ind = sort.col === col ? '<span class="sort-ind">' + (sort.dir === 'asc' ? '▲' : '▼') + '</span>' : '';
    return '<th class="sortable ' + (cls || '') + '" data-col="' + col + '">' + esc(label) + ind + '</th>';
  }
  // desktop table
  var t = '<div class="table-wrap desktop-only"><table class="grid"><thead><tr>' +
    sh('name', 'Item') + sh('cat', 'Category') + sh('stock', 'Stock', 'num') +
    sh('need', 'Need', 'num') + sh('usage', 'Use / mo', 'num') + sh('cover', 'Cover', 'num') +
    sh('status', 'Status') + sh('value', 'Value', 'num') + sh('last', 'Last count') + '</tr></thead><tbody>';
  rows.forEach(function (it) {
    var d = D(it.id);
    t += '<tr data-id="' + esc(it.id) + '">' +
      '<td><div class="item-name">' + esc(it.name) + '</div>' + (it.brand ? '<div class="item-meta">' + esc(it.brand) + '</div>' : '') + '</td>' +
      '<td><span class="chip">' + esc(it.subcategory || '—') + '</span></td>' +
      '<td class="num"><b>' + fmtNum(d.current) + '</b> <span class="muted">' + esc(it.unit) + '</span>' + stockMini(it, d) + '</td>' +
      '<td class="num">' + esc(it.needText || (it.needQty ? it.needQty + ' ' + it.needUnit : '—')) + '</td>' +
      '<td class="num">' + (d.actualRate ? fmtNum(d.actualRate) : '<span class="muted">—</span>') + '</td>' +
      '<td class="num">' + (d.daysCover != null ? Math.round(d.daysCover) + 'd' : '<span class="muted">—</span>') + '</td>' +
      '<td>' + pill(d.status) + '</td>' +
      '<td class="num">' + (d.value ? money(d.value) : '<span class="muted">—</span>') + '</td>' +
      '<td class="nowrap muted">' + fmtDateShort(d.lastCount) + '</td></tr>';
  });
  t += '</tbody></table></div>';

  // mobile cards
  t += '<div class="cards-list mobile-only">';
  rows.forEach(function (it) {
    var d = D(it.id);
    t += '<div class="rowcard" data-id="' + esc(it.id) + '"><div class="rc-top"><div class="grow">' +
      '<div class="item-name">' + esc(it.name) + '</div>' + (it.brand ? '<div class="item-meta">' + esc(it.brand) + ' · ' + esc(it.subcategory || '') + '</div>' : '<div class="item-meta">' + esc(it.subcategory || '') + '</div>') +
      '</div>' + pill(d.status) + '</div>' +
      '<div class="rc-meta"><span>Stock <b>' + fmtNum(d.current) + ' ' + esc(it.unit) + '</b></span>' +
      '<span>Need <b>' + esc(it.needText || '—') + '</b></span>' +
      '<span>Use/mo <b>' + (d.actualRate ? fmtNum(d.actualRate) : '—') + '</b></span>' +
      (d.daysCover != null ? '<span>Cover <b>' + Math.round(d.daysCover) + 'd</b></span>' : '') +
      '<span>Last <b>' + fmtDateShort(d.lastCount) + '</b></span></div></div>';
  });
  t += '</div>';
  box.innerHTML = t;

  $all('th.sortable', box).forEach(function (th) {
    th.onclick = function () {
      var col = th.dataset.col;
      if (sort.col === col) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
      else { sort.col = col; sort.dir = col === 'name' || col === 'cat' ? 'asc' : 'desc'; }
      S.ui[key + '_sort'] = sort; renderItemRows(key, isMaster);
    };
  });
  $all('[data-id]', box).forEach(function (r) { r.onclick = function () { itemDetail(r.dataset.id); }; });
}
function fmtNum(n) { return round(num(n), 2).toLocaleString('en-IN'); }
function stockMini(it, d) {
  if (!(it.needUnit === it.unit && it.needQty)) return '';
  var pct = Math.min(100, Math.round((d.current / num(it.needQty)) * 100));
  var col = d.status === 'ok' ? 'var(--ok)' : (d.status === 'low' ? 'var(--warn)' : 'var(--danger)');
  return '<div class="stockbar" style="margin-top:5px"><span style="width:' + pct + '%;background:' + col + '"></span></div>';
}

/* =================================================================== */
/*  VIEW: RECORD CONSUMPTION                                            */
/* =================================================================== */
function viewRecord(v) {
  var html = subtabBar();
  html += '<div class="row" style="margin-bottom:14px">' +
    '<button class="btn primary" id="quickCountBtn">' + ICON('record', 16) + 'Quick weekly count</button>' +
    '<button class="btn" id="singleEntryBtn">' + ICON('plus', 16) + 'Single entry</button></div>';
  html += '<div class="card"><div class="card-h">' + ICON('clock', 18) + '<h3>Recent entries — ' + esc(S.sub) + '</h3></div><div class="card-b" id="rec_log"></div></div>';
  v.innerHTML = html;
  wireSubtabs(v);
  $('#quickCountBtn').onclick = startQuickCount;
  $('#singleEntryBtn').onclick = function () { consumptionForm(); };
  renderConsumptionLog();
}
function renderConsumptionLog() {
  var box = $('#rec_log'); if (!box) return;
  var ids = {}; itemsIn(S.sub).forEach(function (it) { ids[it.id] = it; });
  var rows = S.consumption.filter(function (c) { return ids[c.itemId]; })
    .sort(function (a, b) { return (toDate(b.date) || 0) - (toDate(a.date) || 0) || (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0); })
    .slice(0, 60);
  if (!rows.length) { box.innerHTML = emptyState('record', 'No entries yet', 'Use “Quick weekly count” to record how much of each item is left.'); return; }
  var t = '<div class="cards-list">';
  rows.forEach(function (c) {
    var it = ids[c.itemId];
    var label = c.mode === 'used' ? 'Used ' + fmtNum(c.value) + ' ' + it.unit
              : c.mode === 'added' ? 'Added ' + fmtNum(c.value) + ' ' + it.unit
              : 'Counted ' + fmtNum(c.value) + ' ' + it.unit + ' left';
    t += '<div class="rowcard" data-cid="' + esc(c.id) + '"><div class="rc-top"><div class="grow">' +
      '<div class="item-name">' + esc(it.name) + '</div><div class="item-meta">' + esc(label) +
      (c.consumed ? ' · consumed ' + fmtNum(c.consumed) : '') + '</div></div>' +
      '<div class="right"><div class="chip">' + fmtDateShort(c.date) + '</div>' +
      '<div class="item-meta" style="margin-top:4px">' + esc(c.enteredBy || '') + '</div></div></div></div>';
  });
  t += '</div>';
  box.innerHTML = t;
  $all('[data-cid]', box).forEach(function (r) { r.onclick = function () { consumptionDetail(r.dataset.cid); }; });
}

/* Quick count: guided list of all items in the sub-category */
function startQuickCount() {
  var items = itemsIn(S.sub).sort(by('subcategory')).sort(by('name'));
  if (!items.length) { toast('No items in ' + S.sub, 'warn'); return; }
  var rows = items.map(function (it) {
    var d = D(it.id);
    return '<div class="count-item" data-id="' + esc(it.id) + '"><div class="ci-name">' + esc(it.name) + '</div>' +
      '<div class="ci-sub">' + esc(it.subcategory || '') + (it.brand ? ' · ' + esc(it.brand) : '') + ' · system says <b>' + fmtNum(d.current) + ' ' + esc(it.unit) + '</b></div>' +
      '<div class="ci-row"><label>How many <b>' + esc(it.unit) + '</b> left now?</label>' + stepper(it.id, d.current) + '</div></div>';
  }).join('');
  var m = openModal('<div class="modal-h">' + ICON('record', 20) + '<h3>Weekly count — ' + esc(S.sub) + '</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div>' +
    '<div class="modal-b"><p class="hint" style="margin-top:0">Enter how many of each item are physically left. Leave a box unchanged if you didn\'t count it. Date: <b>' + fmtDate(today()) + '</b> (change later if needed).</p>' + rows + '</div>' +
    '<div class="modal-f"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-save>' + ICON('check', 16) + 'Save count</button></div>', { wide: true, sticky: true });
  wireSteppers(m);
  $all('[data-x]', m).forEach(function (b) { b.onclick = closeModal; });
  $('[data-save]', m).onclick = function () { saveQuickCount(m, items); };
}
function stepper(id, val) {
  return '<div class="stepper"><button type="button" data-dec="' + esc(id) + '">−</button>' +
    '<input type="number" inputmode="decimal" data-count="' + esc(id) + '" value="' + fmtNumRaw(val) + '"></button>' +
    '<button type="button" data-inc="' + esc(id) + '">+</button></div>';
}
function fmtNumRaw(n) { return round(num(n), 2); }
function wireSteppers(root) {
  $all('[data-inc]', root).forEach(function (b) { b.onclick = function () { var i = $('[data-count="' + b.dataset.inc + '"]', root); i.value = round(num(i.value) + 1, 2); }; });
  $all('[data-dec]', root).forEach(function (b) { b.onclick = function () { var i = $('[data-count="' + b.dataset.dec + '"]', root); i.value = Math.max(0, round(num(i.value) - 1, 2)); }; });
}
function saveQuickCount(m, items) {
  var recs = [];
  items.forEach(function (it) {
    var inp = $('[data-count="' + cssq(it.id) + '"]', m); if (!inp) return;
    var d = D(it.id);
    var left = num(inp.value);
    if (round(left, 2) === round(d.current, 2)) return; // unchanged — skip
    recs.push({ id: uid('CON'), date: today(), itemId: it.id, mode: 'left', value: left,
      consumed: Math.max(0, round(d.current - left, 2)), prevStock: d.current, newStock: left,
      enteredBy: S.user, note: 'Weekly count', createdAt: new Date().toISOString() });
  });
  if (!recs.length) { toast('Nothing changed to save.', 'warn'); return; }
  $('[data-save]', m).disabled = true;
  bulkCreate('Consumption', recs).then(function () { closeModal(); toast('Saved ' + recs.length + ' count(s).', 'ok'); })
    .catch(function () { $('[data-save]', m).disabled = false; });
}
function cssq(s) { return String(s).replace(/["\\]/g, '\\$&'); }

/* =================================================================== */
/*  VIEW: REQUIRED ITEMS                                                */
/* =================================================================== */
function viewRequired(v) {
  var counts = {}; CATS.forEach(function (c) { counts[c] = itemsIn(c).filter(function (it) { return D(it.id).needsOrder; }).length; });
  var html = subtabBar(counts);
  var list = itemsIn(S.sub).filter(function (it) { return D(it.id).needsOrder; })
    .sort(function (a, b) { return statusRank(D(a.id).status) - statusRank(D(b.id).status) || (D(a.id).daysCover || 999) - (D(b.id).daysCover || 999); });
  var totalEst = 0; list.forEach(function (it) { totalEst += (D(it.id).suggested * D(it.id).price) || 0; });

  html += '<div class="kpis"><div class="kpi danger"><div class="l">Items to order</div><div class="v">' + list.length + '</div><div class="d">in ' + esc(S.sub) + '</div></div>' +
    '<div class="kpi accent"><div class="l">Estimated cost</div><div class="v">' + money(totalEst) + '</div><div class="d">at latest known prices</div></div></div>';

  if (list.length) html += '<div class="row" style="margin-bottom:14px"><button class="btn primary" id="orderAll">' + ICON('orders', 16) + 'Create order from this list</button></div>';

  html += '<div id="req_res"></div>';
  v.innerHTML = html;
  wireSubtabs(v);
  if ($('#orderAll')) $('#orderAll').onclick = orderFromRequired;

  var box = $('#req_res');
  if (!list.length) { box.innerHTML = emptyState('check', 'Nothing to order in ' + S.sub, 'All items are above their reorder level.'); return; }
  var t = '<div class="cards-list">';
  list.forEach(function (it) {
    var d = D(it.id);
    var trend = sparklineSVG(monthlyConsumption(it.id, 6), { w: 120, h: 34 });
    t += '<div class="rowcard" data-id="' + esc(it.id) + '"><div class="rc-top"><div class="grow">' +
      '<div class="item-name">' + esc(it.name) + '</div><div class="item-meta">' + esc(it.subcategory || '') + (it.brand ? ' · ' + esc(it.brand) : '') + '</div></div>' +
      pill(d.status) + '</div>' +
      '<div class="rc-meta"><span>Now <b>' + fmtNum(d.current) + ' ' + esc(it.unit) + '</b></span>' +
      '<span>Reorder at <b>' + fmtNum(d.reorderLevel) + '</b></span>' +
      '<span>Suggest order <b class="txt-danger">' + fmtNum(d.suggested) + ' ' + esc(it.unit) + '</b></span>' +
      (d.daysCover != null ? '<span>Cover <b>' + Math.round(d.daysCover) + 'd</b></span>' : '') +
      '<span>Use/mo <b>' + fmtNum(d.actualRate) + '</b></span>' +
      '<span style="display:flex;align-items:center;gap:6px">Trend ' + trend + '</span></div></div>';
  });
  t += '</div>';
  box.innerHTML = t;
  $all('[data-id]', box).forEach(function (r) { r.onclick = function () { itemDetail(r.dataset.id); }; });
  wireCharts(box);
}
function orderFromRequired() {
  var list = itemsIn(S.sub).filter(function (it) { return D(it.id).needsOrder; });
  if (!list.length) { toast('Nothing to order.', 'warn'); return; }
  var lines = list.map(function (it) { var d = D(it.id); return { itemId: it.id, name: it.name, qty: d.suggested, unitPrice: d.price || '', amount: (d.suggested * (d.price || 0)) || '' }; });
  orderForm(null, lines);
}

/* =================================================================== */
/*  VIEW: ORDERS                                                        */
/* =================================================================== */
function viewOrders(v) {
  var orders = (S.orders || []).slice().sort(function (a, b) { return (toDate(b.date) || 0) - (toDate(a.date) || 0); });
  // sub-tab filters orders by whether they contain items of that category
  var counts = {}; CATS.forEach(function (c) { counts[c] = orders.filter(function (o) { return orderTouchesCat(o, c); }).length; });
  var html = subtabBar(counts);
  html += '<div class="toolbar"><div class="search grow">' + ICON('search', 16) + '<input id="ord_q" placeholder="Search supplier, invoice…"></div>' +
    '<select id="ord_status" style="width:auto;min-width:150px"><option value="">All statuses</option><option>Draft</option><option>Ordered</option><option>Received</option><option>Cancelled</option></select></div>';
  var totalSpend = orders.filter(function (o) { return o.status === 'Received'; }).reduce(function (s, o) { return s + num(o.total); }, 0);
  html += '<div class="kpis"><div class="kpi"><div class="l">Total orders</div><div class="v">' + orders.length + '</div></div>' +
    '<div class="kpi accent"><div class="l">Total received value</div><div class="v">' + money(totalSpend) + '</div></div></div>';
  html += '<div id="ord_res"></div>';
  v.innerHTML = html;
  wireSubtabs(v);
  var refresh = function () { renderOrders(); };
  $('#ord_q').addEventListener('input', debounce(refresh, 200));
  $('#ord_status').onchange = refresh;
  refresh();
}
function orderTouchesCat(o, cat) {
  var lines = parseLines(o.linesJSON);
  return lines.some(function (ln) { var it = itemById(ln.itemId); return it && it.category === cat; });
}
function renderOrders() {
  var q = ($('#ord_q').value || '').toLowerCase().trim();
  var st = $('#ord_status').value;
  var orders = (S.orders || []).filter(function (o) { return orderTouchesCat(o, S.sub) || parseLines(o.linesJSON).length === 0; })
    .sort(function (a, b) { return (toDate(b.date) || 0) - (toDate(a.date) || 0); });
  if (q) orders = orders.filter(function (o) { return ((o.supplierName || '') + ' ' + (o.invoiceNo || '') + ' ' + (o.notes || '')).toLowerCase().indexOf(q) >= 0; });
  if (st) orders = orders.filter(function (o) { return o.status === st; });
  var box = $('#ord_res');
  if (!orders.length) { box.innerHTML = emptyState('orders', 'No orders yet', 'Use “New order” to record what you buy — with firm, quantity and price.'); return; }
  var t = '<div class="table-wrap desktop-only"><table class="grid"><thead><tr><th>Date</th><th>Supplier</th><th>Items</th><th class="num">Total</th><th>Invoice</th><th>Status</th><th>By</th></tr></thead><tbody>';
  orders.forEach(function (o) {
    t += '<tr data-oid="' + esc(o.id) + '"><td class="nowrap">' + fmtDate(o.date) + '</td><td>' + esc(o.supplierName || '—') + '</td>' +
      '<td>' + parseLines(o.linesJSON).length + ' item(s)</td><td class="num"><b>' + money(o.total) + '</b></td>' +
      '<td>' + esc(o.invoiceNo || '—') + '</td><td>' + orderBadge(o.status) + '</td><td class="muted">' + esc(o.orderedBy || '') + '</td></tr>';
  });
  t += '</tbody></table></div><div class="cards-list mobile-only">';
  orders.forEach(function (o) {
    t += '<div class="rowcard" data-oid="' + esc(o.id) + '"><div class="rc-top"><div class="grow"><div class="item-name">' + esc(o.supplierName || 'Order') + '</div>' +
      '<div class="item-meta">' + fmtDate(o.date) + ' · ' + parseLines(o.linesJSON).length + ' item(s)' + (o.invoiceNo ? ' · ' + esc(o.invoiceNo) : '') + '</div></div>' + orderBadge(o.status) + '</div>' +
      '<div class="rc-meta"><span>Total <b>' + money(o.total) + '</b></span><span>By <b>' + esc(o.orderedBy || '—') + '</b></span></div></div>';
  });
  t += '</div>';
  box.innerHTML = t;
  $all('[data-oid]', box).forEach(function (r) { r.onclick = function () { orderDetail(r.dataset.oid); }; });
}
function orderBadge(s) {
  var m = { Received: 'b-ok', Ordered: 'b-accent', Draft: 'b-muted', Cancelled: 'b-danger' }[s] || 'b-muted';
  return '<span class="badge ' + m + '">' + esc(s || 'Draft') + '</span>';
}

/* =================================================================== */
/*  VIEW: FINANCE                                                       */
/* =================================================================== */
function viewFinance(v) {
  var counts = {}; CATS.forEach(function (c) { counts[c] = itemsIn(c).length; });
  var html = subtabBar(counts);
  var its = itemsIn(S.sub);
  var invValue = 0, monthConsVal = 0;
  its.forEach(function (it) { var d = D(it.id); invValue += d.value || 0; monthConsVal += (d.actualRate * d.price) || 0; });
  var spend90 = spendInLastDays(90, S.sub);
  var spendAll = (S.orders || []).filter(function (o) { return o.status === 'Received' && orderTouchesCat(o, S.sub); }).reduce(function (s, o) { return s + catShareOfOrder(o, S.sub); }, 0);

  html += '<div class="kpis">' +
    kpi('Inventory value', money(invValue), esc(S.sub) + ' on hand', 'accent') +
    kpi('Est. burn / month', money(monthConsVal), 'value consumed', '') +
    kpi('Spent (90 days)', money(spend90), esc(S.sub) + ' received orders', '') +
    kpi('Total spend', money(spendAll), 'all received orders', '') + '</div>';

  html += '<div class="charts-grid">';
  html += chartBox('Monthly spend — ' + S.sub, 'From received orders (last 6 months)', barChartSVG(spendSeries(6, S.sub), { color: 'var(--s2)', money: true }));
  html += chartBox('Consumption value — ' + S.sub, 'Estimated value used per month', lineChartSVG(consumptionValueSeries(6, S.sub), { color: 'var(--s1)', money: true }));
  html += chartBox('Spend by sub-category', 'Received orders, all time', donutSVG(spendBySubcat(S.sub)));
  html += chartBox('Spend by supplier', 'Received orders, all time', barChartSVG(spendBySupplier(S.sub), { color: 'var(--s3)', money: true, horizontal: true }));
  html += '</div>';

  // top cost items
  var top = its.map(function (it) { return { it: it, v: D(it.id).value, burn: (D(it.id).actualRate * D(it.id).price) || 0 }; })
    .filter(function (x) { return x.v > 0 || x.burn > 0; }).sort(function (a, b) { return b.burn - a.burn; }).slice(0, 12);
  html += '<div class="card" style="margin-top:16px"><div class="card-h">' + ICON('finance', 18) + '<h3>Cost by item — ' + esc(S.sub) + '</h3></div><div class="card-b">';
  if (!top.length) html += emptyState('finance', 'No cost data yet', 'Add prices to items, or record orders with prices, to see cost analytics.');
  else {
    html += '<div class="table-wrap"><table class="grid"><thead><tr><th>Item</th><th class="num">Unit cost</th><th class="num">Stock value</th><th class="num">Use/mo</th><th class="num">Monthly cost</th></tr></thead><tbody>';
    top.forEach(function (x) {
      var d = D(x.it.id);
      html += '<tr data-id="' + esc(x.it.id) + '"><td class="item-name">' + esc(x.it.name) + '</td>' +
        '<td class="num">' + (d.price ? money(d.price) : '—') + '</td><td class="num">' + money(d.value) + '</td>' +
        '<td class="num">' + fmtNum(d.actualRate) + '</td><td class="num"><b>' + money(x.burn) + '</b></td></tr>';
    });
    html += '</tbody></table></div>';
  }
  html += '</div></div>';

  v.innerHTML = html;
  wireSubtabs(v);
  $all('[data-id]', v).forEach(function (r) { r.onclick = function () { itemDetail(r.dataset.id); }; });
  wireCharts(v);
}

/* =================================================================== */
/*  VIEW: SUPPLIERS                                                     */
/* =================================================================== */
function viewSuppliers(v) {
  var counts = {}; CATS.forEach(function (c) { counts[c] = (S.suppliers || []).filter(function (s) { return s.category === c || s.category === 'Both' || !s.category; }).length; });
  var html = subtabBar(counts);
  html += '<div class="toolbar"><div class="search grow">' + ICON('search', 16) + '<input id="sup_q" placeholder="Search supplier, phone…"></div></div>';
  html += '<div id="sup_res"></div>';
  v.innerHTML = html;
  wireSubtabs(v);
  $('#sup_q').addEventListener('input', debounce(renderSuppliers, 200));
  renderSuppliers();
}
function renderSuppliers() {
  var q = ($('#sup_q').value || '').toLowerCase().trim();
  var rows = (S.suppliers || []).filter(function (s) { return s.category === S.sub || s.category === 'Both' || !s.category; });
  if (q) rows = rows.filter(function (s) { return ((s.name || '') + ' ' + (s.phone || '') + ' ' + (s.contactPerson || '')).toLowerCase().indexOf(q) >= 0; });
  rows.sort(by('name'));
  var box = $('#sup_res');
  if (!rows.length) { box.innerHTML = emptyState('suppliers', 'No suppliers yet', 'Add the shops/firms you buy from, so orders auto-fill their details.'); return; }
  var t = '<div class="cards-list">';
  rows.forEach(function (s) {
    var spend = (S.orders || []).filter(function (o) { return o.supplierId === s.id && o.status === 'Received'; }).reduce(function (a, o) { return a + num(o.total); }, 0);
    var cnt = (S.orders || []).filter(function (o) { return o.supplierId === s.id; }).length;
    t += '<div class="rowcard" data-sid="' + esc(s.id) + '"><div class="rc-top"><div class="grow"><div class="item-name">' + esc(s.name) + '</div>' +
      '<div class="item-meta">' + esc(s.contactPerson || '') + (s.phone ? ' · ' + esc(s.phone) : '') + '</div></div>' +
      '<span class="chip">' + esc(s.category || 'Both') + '</span></div>' +
      '<div class="rc-meta"><span>Orders <b>' + cnt + '</b></span><span>Spend <b>' + money(spend) + '</b></span>' +
      (s.gstin ? '<span>GSTIN <b>' + esc(s.gstin) + '</b></span>' : '') + '</div></div>';
  });
  t += '</div>';
  box.innerHTML = t;
  $all('[data-sid]', box).forEach(function (r) { r.onclick = function () { supplierDetail(r.dataset.sid); }; });
}

/* =================================================================== */
/*  VIEW: ACTIVITY LOG                                                  */
/* =================================================================== */
function viewActivity(v) {
  var rows = (S.activity || []).slice().sort(function (a, b) { return (toDate(b.timestamp) || 0) - (toDate(a.timestamp) || 0); }).slice(0, 300);
  var html = '<div class="card"><div class="card-h">' + ICON('activity', 18) + '<h3>Activity log</h3><div class="spacer"></div><span class="muted" style="font-size:12.5px">Newest first · ' + rows.length + ' shown</span></div><div class="card-b">';
  if (!rows.length) html += emptyState('activity', 'No activity yet', 'Every add, edit and delete will appear here with who did it.');
  else {
    html += '<div class="cards-list">';
    rows.forEach(function (a) {
      var col = a.action === 'delete' ? 'b-danger' : a.action === 'create' || a.action === 'bulk-add' ? 'b-ok' : 'b-accent';
      html += '<div class="rowcard" style="cursor:default"><div class="rc-top"><div class="grow"><div class="item-name">' +
        esc(cap(a.action)) + ' · ' + esc(a.entity) + '</div><div class="item-meta">' + esc(a.entityLabel || a.entityId || '') + '</div></div>' +
        '<div class="right"><span class="badge ' + col + '">' + esc(a.user || '—') + '</span><div class="item-meta" style="margin-top:4px">' + fmtDateTime(a.timestamp) + '</div></div></div></div>';
    });
    html += '</div>';
  }
  html += '</div></div>';
  v.innerHTML = html;
}
function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
function fmtDateTime(v) { var d = toDate(v); if (!d) return '—'; return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }

/* =================================================================== */
/*  VIEW: SETTINGS                                                      */
/* =================================================================== */
function viewSettings(v) {
  var connected = apiConfigured();
  var html = '<div class="charts-grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">';

  html += '<div class="card"><div class="card-h">' + ICON('refresh', 18) + '<h3>Connection</h3></div><div class="card-b">' +
    '<label>Google Apps Script Web App URL</label><input id="set_api" placeholder="https://script.google.com/…/exec" value="' + esc(API_URL) + '">' +
    '<div class="hint">Paste the /exec URL from your deployed Web App. Everyone using this dashboard must use the same URL. Status: ' +
    (connected ? '<b class="txt-ok">connected</b>' : '<b class="txt-danger">not set</b>') + '</div>' +
    '<div class="row mt16"><button class="btn primary" id="saveApi">Save & connect</button><button class="btn" id="testApi">Test</button></div></div></div>';

  html += '<div class="card"><div class="card-h">' + ICON('user', 18) + '<h3>You</h3></div><div class="card-b">' +
    '<label>Your name (shown on every entry)</label><input id="set_user" value="' + esc(S.user) + '">' +
    '<div class="row mt16"><button class="btn primary" id="saveUser">Save name</button></div>' +
    '<label class="mt16">Simple Count mode</label><div class="hint">Turn this on for a phone that should ONLY record weekly counts (e.g. office staff). It hides everything else.</div>' +
    '<div class="row mt8"><button class="btn ' + (S.simple ? 'danger' : '') + '" id="toggleSimple">' + (S.simple ? 'Turn OFF simple mode' : 'Turn ON simple mode') + '</button></div></div></div>';

  html += settingsListCard('users', 'People', 'Names that appear in the “entered by” list.');
  html += settingsListCard('units', 'Units', 'Measurement units for items (Ream, Pcs, KG…).');
  html += settingsListCard('stationerySubcats', 'Stationery categories', 'Groups within Stationery.');
  html += settingsListCard('pantrySubcats', 'Pantry categories', 'Groups within Pantry.');

  html += '<div class="card"><div class="card-h">' + ICON('settings', 18) + '<h3>General</h3></div><div class="card-b">' +
    '<label>Dashboard title</label><input id="set_title" value="' + esc(S.settings.appTitle || 'Office Inventory') + '">' +
    '<label class="mt16">Currency symbol</label><input id="set_cur" value="' + esc(S.settings.currency || '₹') + '" style="max-width:120px">' +
    '<label class="mt16">Default reorder threshold (%)</label><input id="set_thr" type="number" value="' + esc(S.settings.defaultThresholdPct || 15) + '" style="max-width:120px">' +
    '<div class="hint">An item is flagged to reorder when stock falls to this % of its Need (unless it has its own reorder level).</div>' +
    '<div class="row mt16"><button class="btn primary" id="saveGen">Save</button></div></div></div>';

  html += '</div>';
  v.innerHTML = html;

  $('#saveApi').onclick = function () {
    var u = $('#set_api').value.trim();
    if (u.indexOf('http') !== 0) { toast('Enter a valid URL', 'err'); return; }
    localStorage.setItem('inv_api_url', u); API_URL = u; toast('Connecting…'); loadData(true);
  };
  $('#testApi').onclick = function () {
    var u = $('#set_api').value.trim() || API_URL;
    fetch(u + '?action=ping').then(function (r) { return r.json(); }).then(function (d) { toast(d.ok ? 'Connection OK ✓' : 'Reached, but unexpected reply', d.ok ? 'ok' : 'warn'); }).catch(function () { toast('Could not reach the URL', 'err'); });
  };
  $('#saveUser').onclick = function () { S.user = $('#set_user').value.trim(); localStorage.setItem('inv_user', S.user); addToList('users', S.user); renderNav(); toast('Saved', 'ok'); };
  $('#toggleSimple').onclick = function () { S.simple = !S.simple; localStorage.setItem('inv_simple', S.simple ? '1' : '0'); applySimple(); };
  $('#saveGen').onclick = function () {
    saveSetting('appTitle', $('#set_title').value.trim() || 'Office Inventory');
    saveSetting('currency', $('#set_cur').value.trim() || '₹');
    saveSetting('defaultThresholdPct', num($('#set_thr').value) || 15);
    $('#brandTitle').textContent = S.settings.appTitle; recompute(); toast('Saved', 'ok'); renderView();
  };
  wireSettingsLists(v);
}
function settingsListCard(key, title, hint) {
  var arr = listVal(key);
  return '<div class="card"><div class="card-h">' + ICON('tag', 18) + '<h3>' + esc(title) + '</h3></div><div class="card-b">' +
    '<div class="hint" style="margin-top:0;margin-bottom:10px">' + esc(hint) + '</div>' +
    '<div class="row" style="gap:6px" id="list_' + key + '">' + arr.map(function (x) {
      return '<span class="chip">' + esc(x) + ' <button class="iconbtn" style="width:20px;height:20px;border:none;background:transparent" data-del="' + esc(key) + '|' + esc(x) + '">' + ICON('x', 13) + '</button></span>';
    }).join('') + '</div>' +
    '<div class="row mt8"><input id="add_' + key + '" placeholder="Add…" style="max-width:200px"><button class="btn sm" data-add="' + key + '">Add</button></div></div></div>';
}
function wireSettingsLists(root) {
  $all('[data-add]', root).forEach(function (b) { b.onclick = function () { var k = b.dataset.add; var val = $('#add_' + k).value.trim(); if (val) { addToList(k, val); renderView(); } }; });
  $all('[data-del]', root).forEach(function (b) { b.onclick = function () { var p = b.dataset.del.split('|'); removeFromList(p[0], p[1]); renderView(); }; });
}
function listVal(key) { var v = S.settings[key]; if (Array.isArray(v)) return v; try { var p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; } }
function addToList(key, val) { if (!val) return; var a = listVal(key); if (a.indexOf(val) < 0) { a.push(val); a.sort(); saveSetting(key, a); } }
function removeFromList(key, val) { var a = listVal(key).filter(function (x) { return x !== val; }); saveSetting(key, a); }
function subcatsFor(cat) { return listVal(cat === 'Stationery' ? 'stationerySubcats' : 'pantrySubcats'); }

/* =================================================================== */
/*  FORMS & DETAILS                                                     */
/* =================================================================== */
function field(label, inner, hint, full) {
  return '<div' + (full ? ' class="full"' : '') + '><label>' + esc(label) + '</label>' + inner + (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + '</div>';
}
function opts(arr, sel) { return arr.map(function (o) { return '<option' + (o === sel ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join(''); }

/* ---- ITEM ---- */
function itemForm(item) {
  var isNew = !item; item = item || { category: S.sub, active: true, reorderThresholdPct: S.settings.defaultThresholdPct || 15 };
  var units = listVal('units');
  var html = '<div class="modal-h">' + ICON('box', 20) + '<h3>' + (isNew ? 'Add item' : 'Edit item') + '</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div>' +
    '<div class="modal-b"><div class="form-grid">' +
    field('Category', '<select id="f_cat">' + opts(CATS, item.category) + '</select>') +
    field('Sub-category', '<input id="f_sub" list="dl_sub" value="' + esc(item.subcategory || '') + '"><datalist id="dl_sub">' + subcatsFor(item.category || S.sub).map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('') + '</datalist>') +
    field('Item name', '<input id="f_name" value="' + esc(item.name || '') + '">', '', true) +
    field('Brand', '<input id="f_brand" value="' + esc(item.brand || '') + '">') +
    field('Unit', '<input id="f_unit" list="dl_unit" value="' + esc(item.unit || 'Pcs') + '"><datalist id="dl_unit">' + units.map(function (u) { return '<option>' + esc(u) + '</option>'; }).join('') + '</datalist>') +
    field('Opening / current stock', '<input id="f_open" type="number" inputmode="decimal" value="' + esc(item.openingStock != null ? item.openingStock : 0) + '">', isNew ? 'The stock right now.' : 'Editing this resets the baseline count.') +
    field('Unit cost (' + cur() + ')', '<input id="f_cost" type="number" inputmode="decimal" value="' + esc(item.unitCost || '') + '">', 'Optional — auto-updates from orders.') +
    field('Need quantity', '<input id="f_needq" type="number" inputmode="decimal" value="' + esc(item.needQty || '') + '">', 'Target requirement.') +
    field('Need unit', '<input id="f_needu" list="dl_unit" value="' + esc(item.needUnit || item.unit || 'Pcs') + '">') +
    field('Need period (months)', '<input id="f_needm" type="number" inputmode="decimal" value="' + esc(item.needPeriodMonths || 1) + '">', 'e.g. 2.5 for “per 2.5 months”.') +
    field('Reorder threshold %', '<input id="f_thr" type="number" value="' + esc(item.reorderThresholdPct != null ? item.reorderThresholdPct : (S.settings.defaultThresholdPct || 15)) + '">') +
    field('Reorder level (override)', '<input id="f_rl" type="number" inputmode="decimal" value="' + esc(item.reorderLevel || '') + '">', 'Leave blank to auto-calc from need × threshold.') +
    field('Notes', '<textarea id="f_notes">' + esc(item.notes || '') + '</textarea>', '', true) +
    '</div></div>' +
    '<div class="modal-f">' + (isNew ? '' : '<button class="btn danger left" data-del>' + ICON('trash', 15) + 'Delete</button>') +
    '<button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-save>' + ICON('check', 16) + 'Save item</button></div>';
  var m = openModal(html);
  $('#f_cat', m).onchange = function () { var dl = $('#dl_sub', m); dl.innerHTML = subcatsFor($('#f_cat', m).value).map(function (s) { return '<option>' + esc(s) + '</option>'; }).join(''); };
  $all('[data-x]', m).forEach(function (b) { b.onclick = closeModal; });
  if ($('[data-del]', m)) $('[data-del]', m).onclick = function () { confirmDelete('Items', item, item.name); };
  $('[data-save]', m).onclick = function () {
    var name = $('#f_name', m).value.trim();
    if (!name) { toast('Item name is required', 'err'); return; }
    var rec = Object.assign({}, item, {
      category: $('#f_cat', m).value, subcategory: $('#f_sub', m).value.trim(), name: name,
      brand: $('#f_brand', m).value.trim(), unit: $('#f_unit', m).value.trim() || 'Pcs',
      openingStock: num($('#f_open', m).value), unitCost: $('#f_cost', m).value.trim(),
      needQty: $('#f_needq', m).value.trim(), needUnit: $('#f_needu', m).value.trim(),
      needPeriodMonths: $('#f_needm', m).value.trim(), needText: buildNeedText($('#f_needq', m).value, $('#f_needu', m).value, $('#f_needm', m).value),
      reorderThresholdPct: $('#f_thr', m).value.trim(), reorderLevel: $('#f_rl', m).value.trim(),
      notes: $('#f_notes', m).value.trim(), active: true
    });
    if (isNew) { rec.id = uid('ITM'); rec.openingDate = today(); }
    addToList('units', rec.unit);
    $('[data-save]', m).disabled = true;
    saveRecord('Items', rec, isNew).then(function () { closeModal(); toast('Item saved', 'ok'); }).catch(function () { $('[data-save]', m).disabled = false; });
  };
}
function buildNeedText(q, u, m) { if (!q) return ''; return q + ' ' + (u || '') + '/' + (m || 1) + 'M'; }

function itemDetail(id) {
  var it = itemById(id); if (!it) return; var d = D(id);
  var recent = S.consumption.filter(function (c) { return c.itemId === id; }).sort(function (a, b) { return (toDate(b.date) || 0) - (toDate(a.date) || 0); }).slice(0, 6);
  var html = '<div class="modal-h">' + ICON('box', 20) + '<h3>' + esc(it.name) + '</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div><div class="modal-b">' +
    '<div class="row" style="margin-bottom:14px">' + pill(d.status) + '<span class="chip">' + esc(it.category) + ' · ' + esc(it.subcategory || '—') + '</span>' + (it.brand ? '<span class="chip">' + esc(it.brand) + '</span>' : '') + '</div>' +
    '<div class="kpis" style="margin-bottom:14px">' +
    kpi('Current stock', fmtNum(d.current) + ' <span class="muted" style="font-size:14px">' + esc(it.unit) + '</span>', '', '') +
    kpi('Reorder at', fmtNum(d.reorderLevel) + ' ' + esc(it.unit), '', '') +
    kpi('Use / month', fmtNum(d.actualRate), 'actual, from counts', '') +
    kpi('Days cover', d.daysCover != null ? Math.round(d.daysCover) + ' days' : '—', '', '') + '</div>' +
    '<div class="chart-box" style="box-shadow:none;margin-bottom:14px"><h3>Consumption — last 6 months</h3><div class="csub">Estimated from your counts</div>' + barChartSVG(monthlyConsumption(id, 6).map(function (p) { return { label: p.label, value: p.value }; }), { color: 'var(--s1)' }) + '</div>' +
    detailRows([
      ['Need', it.needText || (it.needQty ? it.needQty + ' ' + it.needUnit + '/' + it.needPeriodMonths + 'M' : '—')],
      ['Input rate (target)', d.inputRate ? fmtNum(d.inputRate) + ' ' + it.needUnit + '/mo' : '—'],
      ['Actual rate', d.actualRate ? fmtNum(d.actualRate) + ' ' + it.unit + '/mo' : '—'],
      ['Suggested order', d.suggested ? fmtNum(d.suggested) + ' ' + it.unit : 'none'],
      ['Unit cost', d.price ? money(d.price) : '—'],
      ['Stock value', money(d.value)],
      ['Last counted', fmtDate(d.lastCount) + ' (' + relDays(d.lastCount) + ')'],
      ['Notes', it.notes || '—']
    ]);
  if (recent.length) {
    html += '<div class="section-title mt16">Recent entries</div><div class="cards-list">';
    recent.forEach(function (c) {
      var label = c.mode === 'used' ? 'Used ' + fmtNum(c.value) : c.mode === 'added' ? 'Added ' + fmtNum(c.value) : 'Counted ' + fmtNum(c.value) + ' left';
      html += '<div class="rowcard" style="cursor:default;padding:9px 12px"><div class="rc-top"><div class="grow item-meta">' + esc(label) + ' ' + esc(it.unit) + ' · ' + esc(c.enteredBy || '') + '</div><span class="chip">' + fmtDateShort(c.date) + '</span></div></div>';
    });
    html += '</div>';
  }
  html += '</div><div class="modal-f"><button class="btn danger left" data-del>' + ICON('trash', 15) + 'Delete</button>' +
    '<button class="btn" data-rec>' + ICON('record', 15) + 'Record</button>' +
    '<button class="btn primary" data-edit>' + ICON('edit', 15) + 'Edit</button></div>';
  var m = openModal(html, { wide: true });
  $('[data-x]', m).onclick = closeModal;
  $('[data-edit]', m).onclick = function () { closeModal(); itemForm(it); };
  $('[data-rec]', m).onclick = function () { closeModal(); consumptionForm(it); };
  $('[data-del]', m).onclick = function () { confirmDelete('Items', it, it.name); };
  wireCharts(m);
}
function detailRows(pairs) {
  return '<div class="card" style="box-shadow:none"><div class="card-b" style="padding:4px 16px">' + pairs.map(function (p) {
    return '<div class="detail-row"><span class="k">' + esc(p[0]) + '</span><span class="v">' + (p[1] == null ? '—' : p[1]) + '</span></div>';
  }).join('') + '</div></div>';
}

/* ---- CONSUMPTION (single) ---- */
function consumptionForm(item, existing) {
  var isNew = !existing;
  var its = S.items.filter(function (i) { return String(i.active) !== 'false'; }).sort(by('name'));
  var selId = item ? item.id : (existing ? existing.itemId : (its[0] && its[0].id));
  var users = listVal('users');
  var html = '<div class="modal-h">' + ICON('record', 20) + '<h3>' + (isNew ? 'Record consumption' : 'Edit entry') + '</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div>' +
    '<div class="modal-b"><div class="form-grid">' +
    field('Item', '<select id="c_item">' + its.map(function (i) { return '<option value="' + esc(i.id) + '"' + (i.id === selId ? ' selected' : '') + '>' + esc(i.name) + ' (' + esc(i.category) + ')</option>'; }).join('') + '</select>', '', true) +
    field('What are you recording?', '<select id="c_mode"><option value="left"' + (existing && existing.mode === 'left' ? ' selected' : '') + '>How many are LEFT (count)</option><option value="used"' + (existing && existing.mode === 'used' ? ' selected' : '') + '>How many were USED</option><option value="added"' + (existing && existing.mode === 'added' ? ' selected' : '') + '>How many ADDED (correction)</option></select>', '', true) +
    field('Quantity', '<input id="c_val" type="number" inputmode="decimal" value="' + esc(existing ? existing.value : '') + '">', '', false) +
    field('Date', '<input id="c_date" type="date" value="' + esc(existing ? ymd(existing.date) : today()) + '">') +
    field('Entered by', '<input id="c_by" list="dl_users" value="' + esc(existing ? existing.enteredBy : S.user) + '"><datalist id="dl_users">' + users.map(function (u) { return '<option>' + esc(u) + '</option>'; }).join('') + '</datalist>') +
    field('Note', '<input id="c_note" value="' + esc(existing ? existing.note : '') + '">', '', true) +
    '</div><div class="hint" id="c_preview" style="margin-top:12px"></div></div>' +
    '<div class="modal-f">' + (isNew ? '' : '<button class="btn danger left" data-del>' + ICON('trash', 15) + 'Delete</button>') +
    '<button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-save>' + ICON('check', 16) + 'Save</button></div>';
  var m = openModal(html);
  function preview() {
    var it = itemById($('#c_item', m).value); if (!it) return;
    var d = D(it.id); var mode = $('#c_mode', m).value; var val = num($('#c_val', m).value);
    var msg = 'System currently shows ' + fmtNum(d.current) + ' ' + it.unit + '. ';
    if (mode === 'left') msg += 'After: ' + fmtNum(val) + ' ' + it.unit + ' (consumed ' + fmtNum(Math.max(0, d.current - val)) + ').';
    else if (mode === 'used') msg += 'After: ' + fmtNum(Math.max(0, d.current - val)) + ' ' + it.unit + '.';
    else msg += 'After: ' + fmtNum(d.current + val) + ' ' + it.unit + '.';
    $('#c_preview', m).textContent = msg;
  }
  ['c_item', 'c_mode', 'c_val'].forEach(function (id) { $('#' + id, m).addEventListener('input', preview); });
  preview();
  $all('[data-x]', m).forEach(function (b) { b.onclick = closeModal; });
  if ($('[data-del]', m)) $('[data-del]', m).onclick = function () { confirmDelete('Consumption', existing, 'this entry'); };
  $('[data-save]', m).onclick = function () {
    var it = itemById($('#c_item', m).value); if (!it) { toast('Pick an item', 'err'); return; }
    var mode = $('#c_mode', m).value, val = num($('#c_val', m).value);
    if ($('#c_val', m).value === '') { toast('Enter a quantity', 'err'); return; }
    var d = D(it.id);
    var rec = Object.assign({}, existing || {}, {
      itemId: it.id, mode: mode, value: val, date: $('#c_date', m).value || today(),
      enteredBy: $('#c_by', m).value.trim() || S.user, note: $('#c_note', m).value.trim(),
      prevStock: d.current,
      consumed: mode === 'left' ? Math.max(0, round(d.current - val, 2)) : mode === 'used' ? val : 0,
      newStock: mode === 'left' ? val : mode === 'used' ? Math.max(0, d.current - val) : d.current + val
    });
    if (isNew) { rec.id = uid('CON'); rec.createdAt = new Date().toISOString(); }
    addToList('users', rec.enteredBy);
    $('[data-save]', m).disabled = true;
    saveRecord('Consumption', rec, isNew).then(function () { closeModal(); toast('Recorded', 'ok'); }).catch(function () { $('[data-save]', m).disabled = false; });
  };
}
function consumptionDetail(cid) {
  var c = S.consumption.filter(function (x) { return x.id === cid; })[0]; if (!c) return;
  consumptionForm(null, c);
}

/* ---- SUPPLIER ---- */
function supplierForm(sup) {
  var isNew = !sup; sup = sup || { category: 'Both', active: true };
  var html = '<div class="modal-h">' + ICON('suppliers', 20) + '<h3>' + (isNew ? 'Add supplier' : 'Edit supplier') + '</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div>' +
    '<div class="modal-b"><div class="form-grid">' +
    field('Firm / shop name', '<input id="s_name" value="' + esc(sup.name || '') + '">', '', true) +
    field('Contact person', '<input id="s_contact" value="' + esc(sup.contactPerson || '') + '">') +
    field('Phone', '<input id="s_phone" value="' + esc(sup.phone || '') + '">') +
    field('Email', '<input id="s_email" value="' + esc(sup.email || '') + '">') +
    field('GSTIN', '<input id="s_gst" value="' + esc(sup.gstin || '') + '">') +
    field('Supplies', '<select id="s_cat">' + opts(['Both', 'Stationery', 'Pantry'], sup.category || 'Both') + '</select>') +
    field('Address', '<textarea id="s_addr">' + esc(sup.address || '') + '</textarea>', '', true) +
    field('Notes', '<textarea id="s_notes">' + esc(sup.notes || '') + '</textarea>', '', true) +
    '</div></div>' +
    '<div class="modal-f">' + (isNew ? '' : '<button class="btn danger left" data-del>' + ICON('trash', 15) + 'Delete</button>') +
    '<button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-save>' + ICON('check', 16) + 'Save</button></div>';
  var m = openModal(html);
  $all('[data-x]', m).forEach(function (b) { b.onclick = closeModal; });
  if ($('[data-del]', m)) $('[data-del]', m).onclick = function () { confirmDelete('Suppliers', sup, sup.name); };
  $('[data-save]', m).onclick = function () {
    var name = $('#s_name', m).value.trim(); if (!name) { toast('Name is required', 'err'); return; }
    var rec = Object.assign({}, sup, {
      name: name, contactPerson: $('#s_contact', m).value.trim(), phone: $('#s_phone', m).value.trim(),
      email: $('#s_email', m).value.trim(), gstin: $('#s_gst', m).value.trim(), category: $('#s_cat', m).value,
      address: $('#s_addr', m).value.trim(), notes: $('#s_notes', m).value.trim(), active: true
    });
    if (isNew) rec.id = uid('SUP');
    $('[data-save]', m).disabled = true;
    saveRecord('Suppliers', rec, isNew).then(function () { closeModal(); toast('Supplier saved', 'ok'); }).catch(function () { $('[data-save]', m).disabled = false; });
  };
}
function supplierDetail(sid) {
  var s = supplierById(sid); if (!s) return;
  var orders = (S.orders || []).filter(function (o) { return o.supplierId === sid; }).sort(function (a, b) { return (toDate(b.date) || 0) - (toDate(a.date) || 0); });
  var spend = orders.filter(function (o) { return o.status === 'Received'; }).reduce(function (a, o) { return a + num(o.total); }, 0);
  var html = '<div class="modal-h">' + ICON('suppliers', 20) + '<h3>' + esc(s.name) + '</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div><div class="modal-b">' +
    detailRows([
      ['Contact', s.contactPerson || '—'], ['Phone', s.phone || '—'], ['Email', s.email || '—'],
      ['GSTIN', s.gstin || '—'], ['Supplies', s.category || 'Both'], ['Address', s.address || '—'],
      ['Total orders', orders.length], ['Received spend', money(spend)], ['Notes', s.notes || '—']
    ]);
  if (orders.length) {
    html += '<div class="section-title mt16">Order history</div><div class="cards-list">';
    orders.slice(0, 10).forEach(function (o) {
      html += '<div class="rowcard" data-oid="' + esc(o.id) + '"><div class="rc-top"><div class="grow item-meta">' + fmtDate(o.date) + ' · ' + parseLines(o.linesJSON).length + ' item(s)</div><div class="right"><b>' + money(o.total) + '</b> ' + orderBadge(o.status) + '</div></div></div>';
    });
    html += '</div>';
  }
  html += '</div><div class="modal-f"><button class="btn danger left" data-del>' + ICON('trash', 15) + 'Delete</button><button class="btn primary" data-edit>' + ICON('edit', 15) + 'Edit</button></div>';
  var m = openModal(html);
  $('[data-x]', m).onclick = closeModal;
  $('[data-edit]', m).onclick = function () { closeModal(); supplierForm(s); };
  $('[data-del]', m).onclick = function () { confirmDelete('Suppliers', s, s.name); };
  $all('[data-oid]', m).forEach(function (r) { r.onclick = function () { closeModal(); orderDetail(r.dataset.oid); }; });
}

/* ---- ORDER ---- */
function orderForm(order, presetLines) {
  var isNew = !order;
  order = order || { date: today(), status: 'Ordered', taxPct: 0, delivery: 0, discount: 0, orderedBy: S.user };
  var lines = presetLines || parseLines(order.linesJSON);
  if (!lines.length) lines = [{ itemId: '', name: '', qty: '', unitPrice: '', amount: '' }];
  var sups = (S.suppliers || []).slice().sort(by('name'));
  var its = S.items.filter(function (i) { return String(i.active) !== 'false'; }).sort(by('name'));

  var html = '<div class="modal-h">' + ICON('orders', 20) + '<h3>' + (isNew ? 'New order' : 'Edit order') + '</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div>' +
    '<div class="modal-b"><div class="form-grid">' +
    field('Supplier', '<select id="o_sup"><option value="">— select —</option>' + sups.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === order.supplierId ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '<option value="__new">+ Add new supplier…</option></select>') +
    field('Status', '<select id="o_status">' + opts(['Draft', 'Ordered', 'Received', 'Cancelled'], order.status || 'Ordered') + '</select>', 'Marking “Received” adds the quantities to stock.') +
    field('Order date', '<input id="o_date" type="date" value="' + esc(ymd(order.date) || today()) + '">') +
    field('Expected / received date', '<input id="o_recv" type="date" value="' + esc(ymd(order.receivedDate) || '') + '">') +
    field('Invoice / bill no.', '<input id="o_inv" value="' + esc(order.invoiceNo || '') + '">') +
    field('Ordered by', '<input id="o_by" value="' + esc(order.orderedBy || S.user) + '">') +
    '</div>' +
    '<div class="section-title mt16">Items</div>' +
    '<div class="table-wrap" style="box-shadow:none"><table class="lines-tbl"><thead><tr><th style="min-width:160px">Item</th><th style="width:70px">Qty</th><th style="width:90px">Price</th><th style="width:90px" class="num">Amount</th><th style="width:34px"></th></tr></thead><tbody id="o_lines"></tbody></table></div>' +
    '<button class="btn sm mt8" id="o_addline">' + ICON('plus', 14) + 'Add line</button>' +
    '<div class="form-grid mt16">' +
    field('Tax / GST %', '<input id="o_tax" type="number" inputmode="decimal" value="' + esc(order.taxPct || 0) + '">') +
    field('Delivery (' + cur() + ')', '<input id="o_deliv" type="number" inputmode="decimal" value="' + esc(order.delivery || 0) + '">') +
    field('Discount (' + cur() + ')', '<input id="o_disc" type="number" inputmode="decimal" value="' + esc(order.discount || 0) + '">') +
    field('Notes', '<input id="o_notes" value="' + esc(order.notes || '') + '">') +
    '</div>' +
    '<div class="card mt16" style="box-shadow:none"><div class="card-b" id="o_totals" style="padding:10px 16px"></div></div>' +
    '</div>' +
    '<div class="modal-f">' + (isNew ? '' : '<button class="btn danger left" data-del>' + ICON('trash', 15) + 'Delete</button>') +
    '<button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-save>' + ICON('check', 16) + 'Save order</button></div>';
  var m = openModal(html, { wide: true });

  function lineRow(ln, i) {
    return '<tr data-li="' + i + '"><td><select class="ln-item" data-i="' + i + '"><option value="">— item —</option>' +
      its.map(function (it) { return '<option value="' + esc(it.id) + '"' + (it.id === ln.itemId ? ' selected' : '') + '>' + esc(it.name) + '</option>'; }).join('') + '</select></td>' +
      '<td><input class="ln-qty" data-i="' + i + '" type="number" inputmode="decimal" value="' + esc(ln.qty) + '"></td>' +
      '<td><input class="ln-price" data-i="' + i + '" type="number" inputmode="decimal" value="' + esc(ln.unitPrice) + '"></td>' +
      '<td class="num ln-amt">' + money(num(ln.qty) * num(ln.unitPrice)) + '</td>' +
      '<td><button class="iconbtn" data-rm="' + i + '" style="width:30px;height:30px">' + ICON('x', 15) + '</button></td></tr>';
  }
  function drawLines() {
    $('#o_lines', m).innerHTML = lines.map(lineRow).join('');
    $all('.ln-item', m).forEach(function (s) { s.onchange = function () { var i = +s.dataset.i; lines[i].itemId = s.value; var it = itemById(s.value); if (it) { lines[i].name = it.name; if (!num(lines[i].unitPrice) && D(it.id).price) { lines[i].unitPrice = D(it.id).price; } } drawLines(); calc(); }; });
    $all('.ln-qty', m).forEach(function (inp) { inp.oninput = function () { lines[+inp.dataset.i].qty = inp.value; updateAmt(+inp.dataset.i); calc(); }; });
    $all('.ln-price', m).forEach(function (inp) { inp.oninput = function () { lines[+inp.dataset.i].unitPrice = inp.value; updateAmt(+inp.dataset.i); calc(); }; });
    $all('[data-rm]', m).forEach(function (b) { b.onclick = function () { lines.splice(+b.dataset.rm, 1); if (!lines.length) lines.push({ itemId: '', qty: '', unitPrice: '' }); drawLines(); calc(); }; });
  }
  function updateAmt(i) { var tr = $('[data-li="' + i + '"]', m); if (tr) $('.ln-amt', tr).textContent = money(num(lines[i].qty) * num(lines[i].unitPrice)); }
  function calc() {
    var sub = lines.reduce(function (a, ln) { return a + num(ln.qty) * num(ln.unitPrice); }, 0);
    var tax = sub * num($('#o_tax', m).value) / 100;
    var total = sub + tax + num($('#o_deliv', m).value) - num($('#o_disc', m).value);
    $('#o_totals', m).innerHTML =
      '<div class="detail-row"><span class="k">Subtotal</span><span class="v">' + money(sub) + '</span></div>' +
      '<div class="detail-row"><span class="k">Tax</span><span class="v">' + money(tax) + '</span></div>' +
      '<div class="detail-row"><span class="k">Grand total</span><span class="v" style="font-size:17px;color:var(--accent)">' + money(total) + '</span></div>';
    m._total = total; m._sub = sub; m._tax = tax;
  }
  drawLines(); calc();
  $('#o_addline', m).onclick = function () { lines.push({ itemId: '', qty: '', unitPrice: '' }); drawLines(); };
  ['o_tax', 'o_deliv', 'o_disc'].forEach(function (id) { $('#' + id, m).oninput = calc; });
  $('#o_sup', m).onchange = function () { if ($('#o_sup', m).value === '__new') { $('#o_sup', m).value = order.supplierId || ''; closeModal(); supplierForm(); } };
  $all('[data-x]', m).forEach(function (b) { b.onclick = closeModal; });
  if ($('[data-del]', m)) $('[data-del]', m).onclick = function () { confirmDelete('Orders', order, 'this order'); };
  $('[data-save]', m).onclick = function () {
    var cleanLines = lines.filter(function (ln) { return ln.itemId && num(ln.qty) > 0; }).map(function (ln) {
      var it = itemById(ln.itemId);
      return { itemId: ln.itemId, name: it ? it.name : ln.name, qty: num(ln.qty), unitPrice: num(ln.unitPrice), amount: num(ln.qty) * num(ln.unitPrice) };
    });
    if (!cleanLines.length) { toast('Add at least one item with quantity', 'err'); return; }
    var supId = $('#o_sup', m).value === '__new' ? '' : $('#o_sup', m).value;
    var sup = supplierById(supId);
    var status = $('#o_status', m).value;
    var rec = Object.assign({}, order, {
      date: $('#o_date', m).value || today(), status: status,
      supplierId: supId, supplierName: sup ? sup.name : (order.supplierName || ''),
      linesJSON: JSON.stringify(cleanLines), subtotal: m._sub, taxPct: num($('#o_tax', m).value), taxAmt: m._tax,
      delivery: num($('#o_deliv', m).value), discount: num($('#o_disc', m).value), total: m._total,
      invoiceNo: $('#o_inv', m).value.trim(), notes: $('#o_notes', m).value.trim(),
      orderedBy: $('#o_by', m).value.trim() || S.user,
      receivedDate: $('#o_recv', m).value || (status === 'Received' ? today() : (order.receivedDate || ''))
    });
    if (isNew) rec.id = uid('ORD');
    $('[data-save]', m).disabled = true;
    saveRecord('Orders', rec, isNew).then(function () { closeModal(); toast('Order saved' + (status === 'Received' ? ' & added to stock' : ''), 'ok'); }).catch(function () { $('[data-save]', m).disabled = false; });
  };
}
function orderDetail(oid) {
  var o = (S.orders || []).filter(function (x) { return x.id === oid; })[0]; if (!o) return;
  var lines = parseLines(o.linesJSON);
  var html = '<div class="modal-h">' + ICON('orders', 20) + '<h3>Order — ' + esc(o.supplierName || '') + '</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div><div class="modal-b">' +
    '<div class="row" style="margin-bottom:12px">' + orderBadge(o.status) + '<span class="chip">' + fmtDate(o.date) + '</span>' + (o.invoiceNo ? '<span class="chip">' + esc(o.invoiceNo) + '</span>' : '') + '</div>' +
    '<div class="table-wrap" style="box-shadow:none;margin-bottom:12px"><table class="grid"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead><tbody>' +
    lines.map(function (ln) { return '<tr><td>' + esc(ln.name || (itemById(ln.itemId) || {}).name || '—') + '</td><td class="num">' + fmtNum(ln.qty) + '</td><td class="num">' + money(ln.unitPrice) + '</td><td class="num">' + money(ln.amount) + '</td></tr>'; }).join('') +
    '</tbody></table></div>' +
    detailRows([
      ['Supplier', o.supplierName || '—'], ['Subtotal', money(o.subtotal)], ['Tax (' + fmtNum(o.taxPct) + '%)', money(o.taxAmt)],
      ['Delivery', money(o.delivery)], ['Discount', '-' + money(o.discount)], ['Grand total', '<b style="color:var(--accent)">' + money(o.total) + '</b>'],
      ['Received on', o.status === 'Received' ? fmtDate(o.receivedDate) : '—'], ['Ordered by', o.orderedBy || '—'], ['Notes', o.notes || '—']
    ]) +
    '</div><div class="modal-f"><button class="btn danger left" data-del>' + ICON('trash', 15) + 'Delete</button>' +
    (o.status !== 'Received' ? '<button class="btn" data-recv>' + ICON('check', 15) + 'Mark received</button>' : '') +
    '<button class="btn primary" data-edit>' + ICON('edit', 15) + 'Edit</button></div>';
  var m = openModal(html, { wide: true });
  $('[data-x]', m).onclick = closeModal;
  $('[data-edit]', m).onclick = function () { closeModal(); orderForm(o); };
  $('[data-del]', m).onclick = function () { confirmDelete('Orders', o, 'this order'); };
  if ($('[data-recv]', m)) $('[data-recv]', m).onclick = function () {
    var rec = Object.assign({}, o, { status: 'Received', receivedDate: o.receivedDate || today() });
    saveRecord('Orders', rec, false).then(function () { closeModal(); toast('Marked received & added to stock', 'ok'); });
  };
}

function confirmDelete(entity, rec, label) {
  confirmBox({
    title: 'Delete ' + esc(label) + '?', danger: true, ok: 'Delete',
    body: 'This permanently removes it for everyone. This cannot be undone.',
    onOk: function () { deleteRecord(entity, rec.id).then(function () { closeModal(); toast('Deleted', 'ok'); }); }
  });
}

/* =================================================================== */
/*  ANALYTICS SERIES HELPERS                                            */
/* =================================================================== */
function monthKeys(n) {
  var arr = [], d = new Date();
  d.setDate(1);
  for (var i = n - 1; i >= 0; i--) {
    var m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    arr.push({ key: m.getFullYear() + '-' + (m.getMonth() + 1), label: m.toLocaleDateString('en-IN', { month: 'short' }), y: m.getFullYear(), mo: m.getMonth() });
  }
  return arr;
}
function monthlyConsumption(itemId, n) {
  var mk = monthKeys(n), map = {};
  mk.forEach(function (m) { map[m.key] = 0; });
  (D(itemId).consumedSeries || []).forEach(function (c) {
    var d = toDate(c.date); if (!d) return; var k = d.getFullYear() + '-' + (d.getMonth() + 1);
    if (map[k] != null) map[k] += c.qty;
  });
  return mk.map(function (m) { return { label: m.label, value: round(map[m.key], 2) }; });
}
function consumptionValueSeries(n, cat) {
  var mk = monthKeys(n), map = {}; mk.forEach(function (m) { map[m.key] = 0; });
  S.items.forEach(function (it) {
    if (cat && it.category !== cat) return;
    var price = D(it.id).price || 0;
    (D(it.id).consumedSeries || []).forEach(function (c) {
      var d = toDate(c.date); if (!d) return; var k = d.getFullYear() + '-' + (d.getMonth() + 1);
      if (map[k] != null) map[k] += c.qty * price;
    });
  });
  return mk.map(function (m) { return { label: m.label, value: round(map[m.key], 2) }; });
}
function spendSeries(n, cat) {
  var mk = monthKeys(n), map = {}; mk.forEach(function (m) { map[m.key] = 0; });
  (S.orders || []).forEach(function (o) {
    if (o.status !== 'Received') return;
    var d = toDate(o.receivedDate || o.date); if (!d) return; var k = d.getFullYear() + '-' + (d.getMonth() + 1);
    if (map[k] == null) return;
    map[k] += cat ? catShareOfOrder(o, cat) : num(o.total);
  });
  return mk.map(function (m) { return { label: m.label, value: round(map[m.key], 2) }; });
}
function catShareOfOrder(o, cat) {
  var lines = parseLines(o.linesJSON);
  var sub = lines.reduce(function (a, ln) { return a + num(ln.amount || num(ln.qty) * num(ln.unitPrice)); }, 0);
  if (!sub) return 0;
  var catSub = lines.reduce(function (a, ln) { var it = itemById(ln.itemId); return a + ((it && it.category === cat) ? num(ln.amount || num(ln.qty) * num(ln.unitPrice)) : 0); }, 0);
  return num(o.total) * (catSub / sub);
}
function spendInLastDays(days, cat) {
  var since = Date.now() - days * 86400000;
  return (S.orders || []).filter(function (o) { return o.status === 'Received' && toDate(o.receivedDate || o.date) && toDate(o.receivedDate || o.date).getTime() >= since; })
    .reduce(function (s, o) { return s + (cat ? catShareOfOrder(o, cat) : num(o.total)); }, 0);
}
function spendBySubcat(cat) {
  var map = {};
  (S.orders || []).forEach(function (o) {
    if (o.status !== 'Received') return;
    parseLines(o.linesJSON).forEach(function (ln) {
      var it = itemById(ln.itemId); if (!it || it.category !== cat) return;
      var k = it.subcategory || 'Other';
      map[k] = (map[k] || 0) + num(ln.amount || num(ln.qty) * num(ln.unitPrice));
    });
  });
  return Object.keys(map).map(function (k) { return { label: k, value: round(map[k], 2) }; }).sort(function (a, b) { return b.value - a.value; });
}
function spendBySupplier(cat) {
  var map = {};
  (S.orders || []).forEach(function (o) {
    if (o.status !== 'Received') return;
    var v = cat ? catShareOfOrder(o, cat) : num(o.total);
    if (v <= 0) return;
    var k = o.supplierName || 'Unknown';
    map[k] = (map[k] || 0) + v;
  });
  return Object.keys(map).map(function (k) { return { label: k, value: round(map[k], 2) }; }).sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
}

/* =================================================================== */
/*  CHARTS (hand-rolled SVG, offline-safe, colorblind palette)         */
/* =================================================================== */
var TIP = null;
function wireCharts(root) {
  $all('[data-tip]', root).forEach(function (el) {
    el.addEventListener('mousemove', function (e) { showTip(e, el.getAttribute('data-tip')); });
    el.addEventListener('mouseenter', function (e) { showTip(e, el.getAttribute('data-tip')); });
    el.addEventListener('mouseleave', hideTip);
  });
}
function showTip(e, html) { var t = $('#vizTip'); t.innerHTML = html; t.style.opacity = '1'; var x = e.clientX + 14, y = e.clientY + 14; if (x + 240 > window.innerWidth) x = e.clientX - 240; t.style.left = x + 'px'; t.style.top = y + 'px'; }
function hideTip() { $('#vizTip').style.opacity = '0'; }

function niceMax(v) { if (v <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))); var f = v / p; var n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10; return n * p; }
function fmtAxis(v, money2) { if (money2) { if (v >= 1000) return cur() + (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k'; return cur() + Math.round(v); } return (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(round(v, 1))); }

function barChartSVG(data, o) {
  o = o || {}; var W = 360, H = 210, padL = 48, padB = 28, padT = 12, padR = 14;
  if (!data || !data.length || data.every(function (d) { return d.value === 0; })) return chartEmpty();
  if (o.horizontal) return barChartH(data, o);
  var max = niceMax(Math.max.apply(null, data.map(function (d) { return d.value; })));
  var iw = W - padL - padR, ih = H - padT - padB, bw = iw / data.length;
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="height:auto;display:block" preserveAspectRatio="xMidYMid meet" role="img">';
  for (var g = 0; g <= 4; g++) { var y = padT + ih * g / 4; svg += '<line class="grid-line" x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '"/>'; svg += '<text class="tick" x="' + (padL - 7) + '" y="' + (y + 4) + '" text-anchor="end">' + fmtAxis(max * (1 - g / 4), o.money) + '</text>'; }
  data.forEach(function (d, i) {
    var bh = max ? (d.value / max) * ih : 0; var x = padL + i * bw + bw * 0.2; var w = bw * 0.6; var yy = padT + ih - bh;
    svg += '<rect x="' + x + '" y="' + yy + '" width="' + w + '" height="' + Math.max(0, bh) + '" rx="3" fill="' + (o.color || 'var(--s1)') + '" data-tip="' + tipHtml(d.label, d.value, o.money) + '"/>';
    svg += '<text class="tick" x="' + (padL + i * bw + bw / 2) + '" y="' + (H - 9) + '" text-anchor="middle">' + esc(d.label) + '</text>';
  });
  svg += '</svg>';
  return svg;
}
function barChartH(data, o) {
  var W = 360, rowH = 30, labelW = 96, padR = 46, padT = 4;
  var max = niceMax(Math.max.apply(null, data.map(function (d) { return d.value; })));
  var H = data.length * rowH + padT * 2;
  var barW = W - labelW - padR;
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="height:auto;display:block" preserveAspectRatio="xMinYMin meet" role="img">';
  data.forEach(function (d, i) {
    var y = padT + i * rowH; var bw = max ? (d.value / max) * barW : 0;
    svg += '<text class="tick" x="0" y="' + (y + rowH / 2) + '" dominant-baseline="middle">' + esc(clip(d.label, 15)) + '</text>';
    svg += '<rect x="' + labelW + '" y="' + (y + 5) + '" width="' + Math.max(1, bw) + '" height="' + (rowH - 12) + '" rx="3" fill="' + (o.color || 'var(--s3)') + '" data-tip="' + tipHtml(d.label, d.value, o.money) + '"/>';
    svg += '<text class="vlabel" x="' + (labelW + bw + 5) + '" y="' + (y + rowH / 2) + '" dominant-baseline="middle">' + fmtAxis(d.value, o.money) + '</text>';
  });
  svg += '</svg>';
  return svg;
}
function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function lineChartSVG(data, o) {
  o = o || {}; var W = 360, H = 210, padL = 48, padB = 28, padT = 12, padR = 14;
  if (!data || !data.length || data.every(function (d) { return d.value === 0; })) return chartEmpty();
  var max = niceMax(Math.max.apply(null, data.map(function (d) { return d.value; })));
  var iw = W - padL - padR, ih = H - padT - padB;
  var pts = data.map(function (d, i) { var x = padL + (data.length === 1 ? iw / 2 : iw * i / (data.length - 1)); var y = padT + ih - (max ? (d.value / max) * ih : 0); return { x: x, y: y, d: d }; });
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="height:auto;display:block" preserveAspectRatio="xMidYMid meet" role="img">';
  for (var g = 0; g <= 4; g++) { var y = padT + ih * g / 4; svg += '<line class="grid-line" x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '"/>'; svg += '<text class="tick" x="' + (padL - 7) + '" y="' + (y + 4) + '" text-anchor="end">' + fmtAxis(max * (1 - g / 4), o.money) + '</text>'; }
  var area = 'M' + pts[0].x + ',' + (padT + ih) + ' ' + pts.map(function (p) { return 'L' + p.x + ',' + p.y; }).join(' ') + ' L' + pts[pts.length - 1].x + ',' + (padT + ih) + ' Z';
  svg += '<path d="' + area + '" fill="' + (o.color || 'var(--s1)') + '" opacity="0.10"/>';
  svg += '<path d="M' + pts.map(function (p) { return p.x + ',' + p.y; }).join(' L') + '" fill="none" stroke="' + (o.color || 'var(--s1)') + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
  pts.forEach(function (p) { svg += '<circle cx="' + p.x + '" cy="' + p.y + '" r="3.4" fill="' + (o.color || 'var(--s1)') + '" stroke="var(--surface)" stroke-width="1.5" data-tip="' + tipHtml(p.d.label, p.d.value, o.money) + '"/>'; });
  data.forEach(function (d, i) { svg += '<text class="tick" x="' + pts[i].x + '" y="' + (H - 9) + '" text-anchor="middle">' + esc(d.label) + '</text>'; });
  svg += '</svg>';
  return svg;
}

function donutSVG(data, o) {
  o = o || {};
  data = (data || []).filter(function (d) { return d.value > 0; });
  if (!data.length) return chartEmpty();
  var total = data.reduce(function (a, d) { return a + d.value; }, 0);
  var R = 42, r = 26, cx = 50, cy = 50, ang = -Math.PI / 2;
  var svg = '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><svg viewBox="0 0 100 100" width="130" height="130" style="flex:none">';
  if (data.length === 1) {
    // single slice = full ring (an arc can't close a full circle)
    svg += '<circle cx="50" cy="50" r="' + ((R + r) / 2) + '" fill="none" stroke="' + SERIES[0] + '" stroke-width="' + (R - r) + '" data-tip="' + tipHtml(data[0].label, data[0].value, true, '100%') + '"/>';
  } else data.forEach(function (d, i) {
    var frac = d.value / total, a2 = ang + frac * Math.PI * 2;
    var large = frac > 0.5 ? 1 : 0;
    var x1 = cx + R * Math.cos(ang), y1 = cy + R * Math.sin(ang), x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);
    var xi2 = cx + r * Math.cos(a2), yi2 = cy + r * Math.sin(a2), xi1 = cx + r * Math.cos(ang), yi1 = cy + r * Math.sin(ang);
    svg += '<path d="M' + x1 + ',' + y1 + ' A' + R + ',' + R + ' 0 ' + large + ' 1 ' + x2 + ',' + y2 + ' L' + xi2 + ',' + yi2 + ' A' + r + ',' + r + ' 0 ' + large + ' 0 ' + xi1 + ',' + yi1 + ' Z" fill="' + SERIES[i % SERIES.length] + '" stroke="var(--surface)" stroke-width="1" data-tip="' + tipHtml(d.label, d.value, true, Math.round(frac * 100) + '%') + '"/>';
    ang = a2;
  });
  svg += '<text x="50" y="48" text-anchor="middle" style="font-size:8px;fill:var(--ink-3)">Total</text><text x="50" y="58" text-anchor="middle" style="font-size:9px;font-weight:700;fill:var(--ink)">' + esc(fmtAxis(total, true)) + '</text></svg>';
  svg += '<div class="legend" style="flex:1;flex-direction:column;gap:6px">' + data.map(function (d, i) {
    return '<div class="li"><span class="sw" style="background:' + SERIES[i % SERIES.length] + '"></span><span style="flex:1">' + esc(d.label) + '</span><b class="tabnum">' + money(d.value) + '</b></div>';
  }).join('') + '</div></div>';
  return svg;
}

function sparklineSVG(data, o) {
  o = o || {}; var w = o.w || 100, h = o.h || 30;
  if (!data || !data.length) return '';
  var vals = data.map(function (d) { return d.value; }); var max = Math.max.apply(null, vals) || 1;
  var pts = data.map(function (d, i) { var x = data.length === 1 ? w / 2 : (w - 4) * i / (data.length - 1) + 2; var y = h - 3 - (d.value / max) * (h - 6); return x + ',' + y; });
  return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--s1)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>';
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function tipHtml(label, value, money2, extra) {
  // build real HTML (label already made safe), then escape once for the attribute
  var html = '<div class="tt">' + esc(label) + '</div><div class="tr"><span>' + (money2 ? 'Amount' : 'Value') +
    '</span><b>' + (money2 ? money(value) : fmtNum(value)) + (extra ? ' · ' + escAttr(extra) : '') + '</b></div>';
  return escAttr(html);
}
function chartEmpty() { return '<div class="empty" style="padding:30px"><div class="muted">No data yet</div></div>'; }

/* =================================================================== */
/*  SIMPLE COUNT MODE (office staff)                                    */
/* =================================================================== */
function applySimple() {
  if (S.simple) { document.body.classList.add('simple'); renderSimple(); }
  else { document.body.classList.remove('simple'); render(); }
}
function renderSimple() {
  var v = $('#view');
  var html = '<div class="simple-wrap"><div class="simple-head"><div class="logo">' + ICON('box', 24) + '</div><div><h1>' + esc(S.settings.appTitle || 'Weekly Stock Count') + '</h1><div class="muted" style="font-size:13px">' + esc(S.user || 'Staff') + ' · ' + fmtDate(today()) + '</div></div></div>';
  html += '<div class="subtabs">' + CATS.map(function (c) { return '<button class="subtab ' + (S.sub === c ? 'active' : '') + '" data-sub="' + c + '">' + esc(c) + '</button>'; }).join('') + '</div>';
  html += '<p class="hint">Enter how many of each item are left right now. Then press Save.</p>';
  html += '<div id="simple_list"></div>';
  html += '<div class="simple-bar"><button class="btn" id="s_exit">Exit</button><button class="btn primary" id="s_save">' + ICON('check', 18) + 'Save count</button></div></div>';
  v.innerHTML = html;
  document.body.classList.remove('nav-open');
  $all('[data-sub]', v).forEach(function (b) { b.onclick = function () { S.sub = b.dataset.sub; renderSimple(); }; });
  drawSimpleList();
  $('#s_exit').onclick = function () {
    confirmBox({ title: 'Exit simple mode?', body: 'This device will show the full dashboard again.', ok: 'Exit', onOk: function () { S.simple = false; localStorage.setItem('inv_simple', '0'); applySimple(); } });
  };
  $('#s_save').onclick = function () { saveSimple(); };
}
function drawSimpleList() {
  var box = $('#simple_list'); if (!box) return;
  var items = itemsIn(S.sub).sort(by('name'));
  if (!items.length) { box.innerHTML = emptyState('box', 'No items', 'Nothing to count in ' + S.sub); return; }
  box.innerHTML = items.map(function (it) {
    var d = D(it.id);
    return '<div class="count-item" data-id="' + esc(it.id) + '"><div class="ci-name">' + esc(it.name) + '</div>' +
      '<div class="ci-sub">' + esc(it.subcategory || '') + ' · now <b>' + fmtNum(d.current) + ' ' + esc(it.unit) + '</b></div>' +
      '<div class="ci-row"><label>' + esc(it.unit) + ' left</label>' + stepper(it.id, d.current) + '</div></div>';
  }).join('');
  wireSteppers(box);
}
function saveSimple() {
  if (!S.user) { askUser(function () { saveSimple(); }); return; }
  var box = $('#simple_list'); var items = itemsIn(S.sub); var recs = [];
  items.forEach(function (it) {
    var inp = $('[data-count="' + cssq(it.id) + '"]', box); if (!inp) return;
    var d = D(it.id); var left = num(inp.value);
    if (round(left, 2) === round(d.current, 2)) return;
    recs.push({ id: uid('CON'), date: today(), itemId: it.id, mode: 'left', value: left, consumed: Math.max(0, round(d.current - left, 2)), prevStock: d.current, newStock: left, enteredBy: S.user, note: 'Weekly count', createdAt: new Date().toISOString() });
  });
  if (!recs.length) { toast('Nothing changed.', 'warn'); return; }
  $('#s_save').disabled = true;
  bulkCreate('Consumption', recs).then(function () { toast('Saved ' + recs.length + ' item(s). Thank you!', 'ok'); renderSimple(); }).catch(function () { $('#s_save').disabled = false; });
}

/* =================================================================== */
/*  USER GATE / THEME / INIT                                            */
/* =================================================================== */
function askUser(cb) {
  var users = listVal('users');
  var html = '<div class="modal-h">' + ICON('user', 20) + '<h3>Who are you?</h3></div><div class="modal-b">' +
    '<label>Your name (shown on everything you record)</label>' +
    '<input id="u_name" value="' + esc(S.user) + '" list="dl_u" placeholder="e.g. Pushp"><datalist id="dl_u">' + users.map(function (u) { return '<option>' + esc(u) + '</option>'; }).join('') + '</datalist>' +
    '<div class="hint">This is just a label so everyone knows who updated what — no password needed.</div></div>' +
    '<div class="modal-f"><button class="btn primary block" data-ok>Continue</button></div>';
  var m = openModal(html, { sticky: true });
  var save = function () { var n = $('#u_name', m).value.trim(); if (!n) { toast('Please enter a name', 'err'); return; } S.user = n; localStorage.setItem('inv_user', n); addToList('users', n); closeModal(); renderNav(); cb && cb(); };
  $('[data-ok]', m).onclick = save;
  $('#u_name', m).addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
}
function initTheme() {
  var saved = localStorage.getItem('inv_theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  paintThemeBtn();
  $('#themeBtn').onclick = function () {
    var cur2 = document.documentElement.getAttribute('data-theme');
    var next = cur2 === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next); localStorage.setItem('inv_theme', next); paintThemeBtn();
  };
}
function paintThemeBtn() {
  var dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
    (!document.documentElement.getAttribute('data-theme') && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  $('#themeBtn').innerHTML = ICON(dark ? 'sun' : 'moon', 17);
}

function openConnectionSetup() {
  S.loaded = true;
  $('#view').innerHTML = '<div class="card" style="max-width:560px;margin:20px auto"><div class="card-h">' + ICON('refresh', 18) + '<h3>Connect your data</h3></div><div class="card-b">' +
    '<p style="margin-top:0;color:var(--ink-2)">This dashboard needs the Google Apps Script Web App URL to load and save your shared inventory. Paste it below (one-time).</p>' +
    '<label>Web App URL (ends in /exec)</label><input id="boot_api" placeholder="https://script.google.com/…/exec">' +
    '<div class="row mt16"><button class="btn primary" id="boot_save">Connect</button></div>' +
    '<div class="hint mt16">Don\'t have it yet? Follow the setup guide (README) to create the Google Sheet and deploy the script — it takes about 5 minutes.</div></div></div>';
  $('#boot_save').onclick = function () { var u = $('#boot_api').value.trim(); if (u.indexOf('http') !== 0) { toast('Enter a valid URL', 'err'); return; } localStorage.setItem('inv_api_url', u); API_URL = u; loadData(true); };
  setSync('off', 'Not connected');
}

function init() {
  initTheme();
  $('#brandTitle').textContent = 'Office Inventory';
  window.addEventListener('online', function () { S.offline = false; document.body.classList.remove('is-offline'); toast('Back online', 'ok'); loadData(true); });
  window.addEventListener('offline', function () { S.offline = true; document.body.classList.add('is-offline'); setSync('err', 'Offline'); });
  window.addEventListener('focus', function () { if (S.loaded && !S.offline && apiConfigured()) loadData(false); });
  // poll for other people's changes
  setInterval(function () { if (S.loaded && !S.offline && apiConfigured() && !$('.modal-back')) loadData(false); }, 45000);

  renderNav();

  var boot = function () {
    if (S.simple) { S.loaded ? applySimple() : loadData(false).then(applySimple); return; }
    loadData(true);
  };

  if (!S.user && !S.simple) { askUser(boot); }
  else if (!S.user && S.simple) { askUser(boot); }
  else { boot(); }

  // keep brand title synced after load
  var origRender = render;
  // service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
}

document.addEventListener('DOMContentLoaded', init);


/* =====================================================================
   OFFICE INVENTORY DASHBOARD — app.js  (v2)
   - Instant optimistic saves + efficient rev-based real-time sync
   - Unit hierarchy (systems / sub-units) with base-unit maths
   - Periods in Months & Days; IST time reference
   - Supplier order frequency + "Additionally Required" forecasting
   ===================================================================== */

/* ----------------------------- CONFIG ------------------------------- */
var API_URL_DEFAULT = "PASTE_YOUR_WEB_APP_URL_HERE";
var API_URL = (function () {
  var s = localStorage.getItem("inv_api_url");
  return (s && s.indexOf("http") === 0) ? s : (API_URL_DEFAULT.indexOf("http") === 0 ? API_URL_DEFAULT : "");
})();

var SERIES = ['var(--s1)','var(--s2)','var(--s3)','var(--s4)','var(--s5)','var(--s6)','var(--s7)','var(--s8)'];
var CATS = ['Stationery','Pantry'];
var TZ = 'Asia/Kolkata';

function deviceId() {
  var d = localStorage.getItem('inv_device');
  if (!d) { d = 'D-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36); localStorage.setItem('inv_device', d); }
  return d;
}

/* ----------------------------- STATE -------------------------------- */
var S = {
  items: [], consumption: [], orders: [], suppliers: [], activity: [], settings: {},
  loaded: false, offline: !navigator.onLine, rev: null, pending: 0,
  tab: localStorage.getItem('inv_tab') || 'home',
  sub: localStorage.getItem('inv_sub') || 'Stationery',
  user: localStorage.getItem('inv_user') || '',
  device: deviceId(),
  simple: localStorage.getItem('inv_simple') === '1',
  derived: {}, ui: {}, simpleState: { itemId: null }
};

/* --------------------------- UTILITIES ------------------------------ */
function $(s, r) { return (r || document).querySelector(s); }
function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); }
function escAttr(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
function round(n, d) { var p = Math.pow(10, d || 0); return Math.round(n * p) / p; }
function fmtNum(n) { return round(num(n), 2).toLocaleString('en-IN'); }
function cur() { return (S.settings.currency || '₹'); }
function money(n) { n = num(n); return (n < 0 ? '-' : '') + cur() + Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }

/* --- time (India) --- */
function today() { try { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); } }
function toDate(v) { if (!v) return null; if (v instanceof Date) return v; var s = String(v); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00'; var d = new Date(s); return isNaN(d.getTime()) ? null : d; }
function ymd(v) { var d = toDate(v); if (!d) return ''; return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
function fmtDate(v) { var d = toDate(v); if (!d) return '—'; return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ }); }
function fmtDateShort(v) { var d = toDate(v); if (!d) return '—'; return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: TZ }); }
function fmtDateTime(v) { var d = toDate(v); if (!d) return '—'; return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ }); }
function daysAgo(v) { var d = toDate(v); if (!d) return null; var t = toDate(today()); return Math.round((t.getTime() - d.getTime()) / 86400000); }
function relDays(v) { var n = daysAgo(v); if (n == null) return 'never'; if (n <= 0) return 'today'; if (n === 1) return 'yesterday'; if (n < 30) return n + ' days ago'; return fmtPeriod(n / 30, false) + ' ago'; }
function daysBetween(a, b) { var da = toDate(a), db = toDate(b); if (!da || !db) return 0; return Math.round((db.getTime() - da.getTime()) / 86400000); }
function monthsBetween(a, b) { return daysBetween(a, b) / 30.44; }
function addDays(dateStr, days) { var d = toDate(dateStr) || new Date(); var n = new Date(d.getTime() + days * 86400000); return ymd(n); }
function addMonths(dateStr, months) { return addDays(dateStr, Math.round(num(months) * 30)); }

/* --- periods as Months & Days (30-day months) --- */
function fmtPeriod(months) {
  /* compact everywhere to save space: e.g. 2M15D, 15D, 3M */
  var totalDays = Math.round(num(months) * 30);
  if (totalDays <= 0) return '0D';
  var m = Math.floor(totalDays / 30), d = totalDays - m * 30;
  return (m ? m + 'M' : '') + (d ? d + 'D' : '');
}
function monthsFromMD(m, d) { return num(m) + num(d) / 30; }

function uid(p) { return (p || 'L') + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36); }
function debounce(fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms || 250); }; }
function by(key) { return function (a, b) { var x = (a[key] == null ? '' : a[key]), y = (b[key] == null ? '' : b[key]); if (typeof x === 'string') x = x.toLowerCase(); if (typeof y === 'string') y = y.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }; }
function cssq(s) { return String(s).replace(/["\\]/g, '\\$&'); }
function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

/* --------------------------- UNIT HELPERS --------------------------- */
function factorsOf(item) {
  var f = item.factorsJSON;
  if (f && typeof f === 'object') return f;
  try { var o = JSON.parse(f); if (o && typeof o === 'object' && Object.keys(o).length) return o; } catch (e) {}
  var base = item.stockUnit || item.unit || 'Pcs'; var m = {}; m[base] = 1;
  if (item.needUnit && item.needUnit !== base) m[item.needUnit] = 1;
  return m;
}
function unitsOf(item) { var f = factorsOf(item); return Object.keys(f).sort(function (a, b) { return f[a] - f[b]; }); }
function baseUnitOf(item) { var f = factorsOf(item), best = null, bv = Infinity; Object.keys(f).forEach(function (u) { if (f[u] < bv) { bv = f[u]; best = u; } }); return best || item.unit || 'Pcs'; }
function stockUnitOf(item) { return item.stockUnit || item.unit || baseUnitOf(item); }
function unitFactor(item, u) { var f = factorsOf(item); return (f[u] != null && f[u] > 0) ? f[u] : 1; }
function toBase(item, qty, u) { return num(qty) * unitFactor(item, u || stockUnitOf(item)); }
function fromBase(item, q, u) { return num(q) / unitFactor(item, u || stockUnitOf(item)); }
function qtyDisp(item, baseQty, u) { u = u || stockUnitOf(item); return fmtNum(fromBase(item, baseQty, u)) + ' ' + u; }

/* --------------------------- ICONS ---------------------------------- */
var ICONS = {
  home:'M3 11l9-8 9 8M5 9v11h5v-6h4v6h5V9',
  overview:'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
  record:'M9 3h6a1 1 0 011 1v1h1a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2V7a2 2 0 012-2h1V4a1 1 0 011-1zM9 12l2 2 4-4',
  required:'M6 2l1.5 3M18 2l-1.5 3M3 7h18l-1.5 12a2 2 0 01-2 1.8H6.5a2 2 0 01-2-1.8L3 7zM9 11v5M15 11v5',
  forecast:'M3 3v18h18M7 15l3-4 3 3 5-7M17 10h3v3',
  orders:'M3 3h2l2.4 12.5a1.5 1.5 0 001.5 1.2h8.6a1.5 1.5 0 001.5-1.2L21 8H6M9 20a1 1 0 100 2 1 1 0 000-2zM17 20a1 1 0 100 2 1 1 0 000-2z',
  finance:'M4 20V10M10 20V4M16 20v-7M22 20H2',
  suppliers:'M3 8h11v9H3zM14 11h4l3 3v3h-7M6.5 20a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17.5 20a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
  settings:'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 01-4 0v-.1A1.7 1.7 0 006 19.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00-1.2-2.9H2a2 2 0 010-4h.1A1.7 1.7 0 003.3 6l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.6V2a2 2 0 014 0v.1A1.7 1.7 0 0018 3.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.6 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z',
  activity:'M22 12h-4l-3 9L9 3l-3 9H2',
  box:'M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10',
  plus:'M12 5v14M5 12h14', minus:'M5 12h14',
  search:'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.3-4.3',
  trash:'M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13',
  check:'M20 6L9 17l-5-5', x:'M18 6L6 18M6 6l12 12',
  warn:'M12 3l9.5 16.5H2.5L12 3zM12 10v4M12 17.5v.5',
  up:'M12 19V5M5 12l7-7 7 7', down:'M12 5v14M5 12l7 7 7-7',
  edit:'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z',
  clock:'M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2',
  refresh:'M21 12a9 9 0 11-3-6.7M21 4v5h-5',
  user:'M20 21a8 8 0 10-16 0M12 11a4 4 0 100-8 4 4 0 000 8z',
  tag:'M20 12l-8 8-9-9V3h8l9 9zM7.5 7.5h.01', back:'M15 18l-6-6 6-6',
  layers:'M12 2l9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 17l9 5 9-5'
};
function ICON(name, size) {
  var p = ICONS[name] || ICONS.box, s = size || 20;
  return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    p.split('M').filter(Boolean).map(function (seg) { return '<path d="M' + seg + '"/>'; }).join('') + '</svg>';
}

/* --------------------------- STORAGE CACHE -------------------------- */
function cacheSave() { try { localStorage.setItem('inv_cache', JSON.stringify({ items: S.items, consumption: S.consumption, orders: S.orders, suppliers: S.suppliers, activity: S.activity.slice(-400), settings: S.settings })); } catch (e) {} }
function cacheLoad() { try { var c = JSON.parse(localStorage.getItem('inv_cache') || 'null'); if (c && c.items) { S.items = c.items; S.consumption = c.consumption || []; S.orders = c.orders || []; S.suppliers = c.suppliers || []; S.activity = c.activity || []; S.settings = c.settings || {}; return true; } } catch (e) {} return false; }

/* ------------------------------ API --------------------------------- */
function apiConfigured() { return API_URL && API_URL.indexOf('http') === 0; }
function apiGetAll() { return fetch(API_URL + '?action=getAll&t=' + Date.now()).then(function (r) { return r.json(); }); }
function apiRev() { return fetch(API_URL + '?action=rev&t=' + Date.now()).then(function (r) { return r.json(); }); }
function apiPost(payload) { payload.user = S.user; return fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) }).then(function (r) { return r.json(); }); }

function loadData(showSpin) {
  if (!apiConfigured()) { if (cacheLoad()) { S.loaded = true; recompute(); render(); } return openConnectionSetup(); }
  if (showSpin) setSync('busy', 'Syncing…');
  return apiGetAll().then(function (d) {
    if (d.error) throw new Error(d.error);
    S.items = d.items || []; S.consumption = d.consumption || []; S.orders = d.orders || [];
    S.suppliers = d.suppliers || []; S.activity = d.activity || []; S.settings = d.settings || {}; S.rev = d.rev;
    S.loaded = true; S.offline = false; document.body.classList.remove('is-offline');
    cacheSave(); recompute(); render(); setSync('ok', 'Synced');
  }).catch(function () {
    S.offline = true; document.body.classList.add('is-offline'); setSync('err', 'Offline');
    if (!S.loaded && cacheLoad()) { S.loaded = true; recompute(); render(); } else if (!S.loaded) render();
  });
}

/* optimistic local mutation */
function applyLocal(entity, record, op) {
  var arr = { Items: 'items', Consumption: 'consumption', Orders: 'orders', Suppliers: 'suppliers' }[entity];
  if (!arr) return;
  var list = S[arr];
  if (op === 'delete') { S[arr] = list.filter(function (x) { return x.id !== record; }); return; }
  var i = -1; for (var k = 0; k < list.length; k++) if (list[k].id === record.id) { i = k; break; }
  if (i >= 0) list[i] = record; else list.push(record);
}
function afterLocalChange() { cacheSave(); recompute(); render(); }

function persist(entity, record, isNew) {
  if (!apiConfigured() || S.offline) { toast('You are offline — cannot save now.', 'err'); return Promise.reject(); }
  applyLocal(entity, record, isNew ? 'create' : 'update'); afterLocalChange();
  S.pending++; setSync('busy', 'Saving…');
  return apiPost({ action: isNew ? 'create' : 'update', entity: entity, record: record })
    .then(function (res) { if (res.error) throw new Error(res.error); S.pending--; setSync('ok', 'Saved'); reconcileSoon(); return res.record; })
    .catch(function (e) { S.pending--; setSync('err', 'Save failed'); toast('Save failed — refreshing.', 'err'); loadData(false); throw e; });
}
function persistDelete(entity, id) {
  if (!apiConfigured() || S.offline) { toast('You are offline — cannot delete now.', 'err'); return Promise.reject(); }
  applyLocal(entity, id, 'delete'); afterLocalChange();
  S.pending++; setSync('busy', 'Deleting…');
  return apiPost({ action: 'delete', entity: entity, id: id })
    .then(function (res) { if (res.error) throw new Error(res.error); S.pending--; setSync('ok', 'Deleted'); reconcileSoon(); })
    .catch(function (e) { S.pending--; setSync('err', 'Delete failed'); toast('Delete failed — refreshing.', 'err'); loadData(false); throw e; });
}
function persistBulk(entity, records) {
  if (!apiConfigured() || S.offline) { toast('You are offline — cannot save now.', 'err'); return Promise.reject(); }
  records.forEach(function (r) { applyLocal(entity, r, 'create'); }); afterLocalChange();
  S.pending++; setSync('busy', 'Saving…');
  return apiPost({ action: 'bulkCreate', entity: entity, records: records })
    .then(function (res) { if (res.error) throw new Error(res.error); S.pending--; setSync('ok', 'Saved'); reconcileSoon(); return res.records; })
    .catch(function (e) { S.pending--; setSync('err', 'Save failed'); toast('Save failed — refreshing.', 'err'); loadData(false); throw e; });
}
function persistManyUpdate(entity, records) {
  if (!apiConfigured() || S.offline) { toast('You are offline — cannot save now.', 'err'); return Promise.reject(); }
  if (!records.length) return Promise.resolve();
  records.forEach(function (r) { applyLocal(entity, r, 'update'); }); afterLocalChange();
  S.pending++; setSync('busy', 'Saving…');
  return apiPost({ action: 'bulkUpdate', entity: entity, records: records })
    .then(function (res) { if (res.error) throw new Error(res.error); S.pending--; setSync('ok', 'Saved'); reconcileSoon(); })
    .catch(function (e) { S.pending--; setSync('err', 'Save failed'); toast('Save failed — refreshing.', 'err'); loadData(false); throw e; });
}
function persistManyDelete(entity, ids) {
  if (!apiConfigured() || S.offline) { toast('You are offline — cannot delete now.', 'err'); return Promise.reject(); }
  if (!ids.length) return Promise.resolve();
  ids.forEach(function (id) { applyLocal(entity, id, 'delete'); }); afterLocalChange();
  S.pending++; setSync('busy', 'Deleting…');
  return apiPost({ action: 'bulkDelete', entity: entity, ids: ids })
    .then(function (res) { if (res.error) throw new Error(res.error); S.pending--; setSync('ok', 'Deleted'); reconcileSoon(); })
    .catch(function (e) { S.pending--; setSync('err', 'Delete failed'); toast('Delete failed — refreshing.', 'err'); loadData(false); throw e; });
}
function saveSetting(key, value) {
  S.settings[key] = value;
  if (apiConfigured() && !S.offline) { S.pending++; apiPost({ action: 'saveSetting', key: key, value: value }).then(function () { S.pending--; }).catch(function () { S.pending--; }); }
}
var reconcileTimer = null;
function reconcileSoon() { clearTimeout(reconcileTimer); reconcileTimer = setTimeout(function () { if (S.pending <= 0 && !S.offline) loadData(false); }, 2500); }
function pollRev() {
  if (!apiConfigured() || S.offline || S.pending > 0 || $('.modal-back')) return;
  apiRev().then(function (d) { if (d && d.rev != null && String(d.rev) !== String(S.rev)) loadData(false); }).catch(function () {});
}

/* --------------------------- COMPUTE (base units) ------------------- */
function itemById(id) { return S.derived._map ? S.derived._map[id] : null; }
function supplierById(id) { for (var i = 0; i < S.suppliers.length; i++) if (S.suppliers[i].id === id) return S.suppliers[i]; return null; }
function parseLines(j) { if (!j) return []; if (typeof j === 'object') return j; try { var v = JSON.parse(j); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function D(id) { return S.derived[id] || {}; }
function itemsIn(cat) { return S.items.filter(function (it) { return it.category === cat && String(it.active) !== 'false'; }); }

function recompute() {
  var d = { _map: {} };
  S.items.forEach(function (it) { d._map[it.id] = it; });
  var consBy = {}; S.consumption.forEach(function (c) { (consBy[c.itemId] = consBy[c.itemId] || []).push(c); });
  var recvBy = {}, priceBy = {};
  S.orders.forEach(function (o) {
    var lines = parseLines(o.linesJSON), received = (o.status === 'Received');
    lines.forEach(function (ln) {
      var it = d._map[ln.itemId]; if (!it) return;
      var lu = ln.unit || stockUnitOf(it);
      if (received) (recvBy[ln.itemId] = recvBy[ln.itemId] || []).push({ date: o.receivedDate || o.date, base: toBase(it, ln.qty, lu) });
      var pd = o.receivedDate || o.date, perBase = num(ln.unitPrice) / unitFactor(it, lu);
      if (perBase > 0) { var cu = priceBy[ln.itemId]; if (!cu || (toDate(pd) && toDate(cu.date) && toDate(pd) >= toDate(cu.date))) priceBy[ln.itemId] = { perBase: perBase, date: pd }; }
    });
  });

  S.items.forEach(function (it) {
    var su = stockUnitOf(it), sf = unitFactor(it, su), nu = it.needUnit || su;
    var events = [], openDate = ymd(it.openingDate) || ymd(it.createdAt) || today();
    events.push({ date: openDate, seq: 0, type: 'set', value: toBase(it, it.openingStock, su), src: 'open' });
    (consBy[it.id] || []).forEach(function (c) {
      var dt = ymd(c.date) || ymd(c.createdAt) || today(), cu = c.unit || su, val = toBase(it, c.value, cu);
      if (c.mode === 'used') events.push({ date: dt, seq: seqOf(c), type: 'delta', value: -Math.abs(val), src: 'use' });
      else if (c.mode === 'added') events.push({ date: dt, seq: seqOf(c), type: 'delta', value: Math.abs(val), src: 'add' });
      else events.push({ date: dt, seq: seqOf(c), type: 'set', value: val, src: 'count' });
    });
    (recvBy[it.id] || []).forEach(function (r) { events.push({ date: ymd(r.date) || today(), seq: 1, type: 'delta', value: Math.abs(r.base), src: 'recv' }); });
    events.sort(function (a, b) { var da = toDate(a.date).getTime(), db = toDate(b.date).getTime(); return da !== db ? da - db : a.seq - b.seq; });

    var stock = 0, consumed = 0, series = [], firstObs = openDate, lastCount = null;
    events.forEach(function (ev) {
      if (ev.type === 'set') {
        if (ev.src === 'count') { var used = Math.max(0, stock - ev.value); if (used > 0) { consumed += used; series.push({ date: ev.date, qty: used }); } lastCount = ev.date; }
        stock = ev.value;
      } else { stock += ev.value; if (ev.src === 'use') { consumed += Math.abs(ev.value); series.push({ date: ev.date, qty: Math.abs(ev.value) }); lastCount = ev.date; } }
    });
    var currentBase = Math.max(0, round(stock, 4));
    var obsMonths = Math.max(0.25, monthsBetween(firstObs, today()));
    var rateBase = consumed > 0 ? consumed / obsMonths : 0;           // base units / month
    var ratePerDay = rateBase / 30.44;
    var needBase = (it.needQty && nu) ? toBase(it, it.needQty, nu) : 0;
    var inputRateBase = (needBase && it.needPeriodMonths) ? needBase / num(it.needPeriodMonths) : 0;
    var daysCover = ratePerDay > 0 ? currentBase / ratePerDay : null;
    var perBase = priceBy[it.id] ? priceBy[it.id].perBase : (num(it.unitCost) / sf);
    var value = currentBase * perBase;
    var thr = (it.reorderThresholdPct != null && it.reorderThresholdPct !== '') ? num(it.reorderThresholdPct) : num(S.settings.defaultThresholdPct || 15);
    var reorderBase = (it.reorderLevel != null && it.reorderLevel !== '') ? toBase(it, it.reorderLevel, su) : (needBase ? Math.max(unitFactor(it, su), needBase * thr / 100) : 0);

    var status = 'ok';
    if (currentBase <= 0) status = 'out';
    else if (reorderBase > 0 && currentBase <= reorderBase) status = (currentBase <= reorderBase * 0.5) ? 'critical' : 'low';
    else if (daysCover != null && daysCover < 7) status = 'critical';
    else if (daysCover != null && daysCover < 14) status = 'low';
    else if (needBase && currentBase > needBase * 2 && rateBase === 0) status = 'overstock';
    var needsOrder = (status === 'out' || status === 'critical' || status === 'low');
    var targetBase = needBase || (reorderBase ? reorderBase * 2 : currentBase);
    var suggestedBase = needsOrder ? Math.max(0, (targetBase + reorderBase) - currentBase) : 0;

    d[it.id] = {
      su: su, sf: sf, nu: nu,
      currentBase: currentBase, current: fromBase(it, currentBase, su),
      perBase: perBase, price: perBase * sf, value: value,
      rateBase: rateBase, actualRate: fromBase(it, rateBase, su), ratePerDay: ratePerDay,
      inputRate: inputRateBase ? fromBase(it, inputRateBase, su) : 0,
      daysCover: daysCover, consumed: consumed, series: series, obsMonths: obsMonths, lastCount: lastCount,
      needBase: needBase, reorderBase: reorderBase, reorderLevel: fromBase(it, reorderBase, su),
      status: status, needsOrder: needsOrder,
      suggestedBase: suggestedBase, suggested: fromBase(it, suggestedBase, su),
      pctOfNeed: needBase ? currentBase / needBase : null,
      supplierId: it.supplierId || ''
    };
  });
  S.derived = d;
}
function seqOf(c) { var t = toDate(c.createdAt); return t ? t.getTime() % 1e9 : 1; }

/* ------------------- supplier frequency / forecasting --------------- */
function nextOrderDateFor(supplierId) {
  var sup = supplierById(supplierId); if (!sup || !sup.orderFrequencyMonths) return null;
  var freq = num(sup.orderFrequencyMonths); if (freq <= 0) return null;
  var last = null;
  S.orders.forEach(function (o) { if (o.supplierId === supplierId && o.status !== 'Cancelled') { var dt = ymd(o.date); if (dt && (!last || toDate(dt) > toDate(last))) last = dt; } });
  var base = last || today();
  var next = addMonths(base, freq);
  if (toDate(next) < toDate(today())) next = addMonths(today(), 0); // overdue → today
  return next;
}
/* items projected to fall to/below reorder before their supplier's next order date, that are NOT already flagged */
function additionallyRequired(cat) {
  var out = [];
  itemsIn(cat).forEach(function (it) {
    var dd = D(it.id); if (dd.needsOrder) return;
    if (!it.supplierId) return;
    var next = nextOrderDateFor(it.supplierId); if (!next) return;
    var days = Math.max(0, daysBetween(today(), next));
    if (dd.ratePerDay <= 0) return;
    var projected = dd.currentBase - dd.ratePerDay * days;
    if (projected > dd.reorderBase && projected > 0) return; // survives comfortably
    var finishDays = dd.ratePerDay > 0 ? dd.currentBase / dd.ratePerDay : null;
    var finishDate = finishDays != null ? addDays(today(), Math.round(finishDays)) : null;
    var qtyBase = Math.max(0, dd.ratePerDay * days + (dd.reorderBase || 0) - dd.currentBase);
    out.push({ it: it, d: dd, nextDate: next, daysUntil: days, projected: projected, finishDate: finishDate, qtyBase: qtyBase, qty: fromBase(it, qtyBase, stockUnitOf(it)) });
  });
  return out.sort(function (a, b) { return a.projected - b.projected; });
}

/* --------------------------- UI: SYNC / TOAST / MODAL --------------- */
function setSync(kind, text) { var el = $('#syncDot'); if (!el) return; el.className = 'syncdot' + (kind === 'busy' ? ' busy' : kind === 'err' ? ' err' : kind === 'off' ? ' off' : ''); $('#syncText').textContent = text; if (kind === 'ok') setTimeout(function () { if ($('#syncText') && S.pending <= 0) $('#syncText').textContent = 'Synced'; }, 1400); }
function toast(msg, kind) { var t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.innerHTML = ICON(kind === 'err' ? 'warn' : kind === 'ok' ? 'check' : 'refresh', 16) + '<span>' + esc(msg) + '</span>'; $('#toasts').appendChild(t); setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(function () { t.remove(); }, 300); }, 3000); }
function openModal(html, opts) {
  opts = opts || {};
  var back = document.createElement('div'); back.className = 'modal-back';
  back.innerHTML = '<div class="modal ' + (opts.wide ? 'wide' : '') + '" role="dialog" aria-modal="true">' + html + '</div>';
  back.addEventListener('mousedown', function (e) { if (e.target === back && !opts.sticky) closeModal(); });
  $('#modalMount').appendChild(back); document.body.style.overflow = 'hidden'; return back;
}
function closeModal() { $('#modalMount').innerHTML = ''; document.body.style.overflow = ''; }
function confirmBox(o) {
  var m = openModal('<div class="modal-h"><h3>' + esc(o.title || 'Are you sure?') + '</h3></div><div class="modal-b"><p style="margin:0;color:var(--ink-2)">' + (o.body || '') + '</p></div><div class="modal-f"><button class="btn ghost" data-x>Cancel</button><button class="btn ' + (o.danger ? 'danger' : 'primary') + '" data-ok>' + esc(o.ok || 'Confirm') + '</button></div>');
  $('[data-x]', m).onclick = closeModal; $('[data-ok]', m).onclick = function () { closeModal(); o.onOk && o.onOk(); };
}
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

/* --------------------------- NAVIGATION ----------------------------- */
var TABS = [
  { id: 'home', name: 'Home', icon: 'home', grp: 'Daily', title: 'Home', sub: 'What needs attention' },
  { id: 'overview', name: 'Overview', icon: 'overview', grp: 'Daily', title: 'Overview', sub: 'All items & stock' },
  { id: 'record', name: 'Record Consumption', icon: 'record', grp: 'Daily', title: 'Record', sub: 'Log usage' },
  { id: 'required', name: 'Required Items', icon: 'required', grp: 'Daily', title: 'Required Items', sub: 'To order now' },
  { id: 'addl', name: 'Additionally Required', icon: 'forecast', grp: 'Daily', title: 'Additionally Required', sub: 'Will run low before next order' },
  { id: 'orders', name: 'Orders', icon: 'orders', grp: 'Daily', title: 'Orders', sub: 'Place & track orders' },
  { id: 'finance', name: 'Finance', icon: 'finance', grp: 'Analysis', title: 'Finance', sub: 'Cost & spend analytics' },
  { id: 'suppliers', name: 'Suppliers', icon: 'suppliers', grp: 'Manage', title: 'Suppliers', sub: 'Vendor directory' },
  { id: 'activity', name: 'Activity Log', icon: 'activity', grp: 'Manage', title: 'Activity Log', sub: 'Who changed what' },
  { id: 'settings', name: 'Settings', icon: 'settings', grp: 'Manage', title: 'Settings', sub: 'Units, people, connection' }
];
var MOBILE_TABS = ['home', 'overview', 'record', 'required', 'orders'];

function navCounts() {
  var reorder = 0, addl = 0;
  S.items.forEach(function (it) { if (String(it.active) !== 'false' && D(it.id).needsOrder) reorder++; });
  CATS.forEach(function (c) { addl += additionallyRequired(c).length; });
  return { required: reorder, addl: addl };
}
function renderNav() {
  var counts = navCounts(), grps = {}; TABS.forEach(function (t) { (grps[t.grp] = grps[t.grp] || []).push(t); });
  var html = '';
  Object.keys(grps).forEach(function (g) {
    html += '<div class="grp">' + esc(g) + '</div>';
    grps[g].forEach(function (t) {
      var c = counts[t.id];
      html += '<button class="' + (S.tab === t.id ? 'active' : '') + (t.id === 'required' && c ? ' alert' : '') + '" data-tab="' + t.id + '"><span class="ico">' + ICON(t.icon, 19) + '</span>' + esc(t.name) + (c ? '<span class="count">' + c + '</span>' : '') + '</button>';
    });
  });
  $('#nav').innerHTML = html;
  $all('#nav button').forEach(function (b) { b.onclick = function () { setTab(b.dataset.tab); document.body.classList.remove('nav-open'); }; });
  $('#botnav').innerHTML = MOBILE_TABS.map(function (id) { var t = TABS.filter(function (x) { return x.id === id; })[0]; var c = counts[id]; return '<button class="' + (S.tab === id ? 'active' : '') + '" data-tab="' + id + '">' + ICON(t.icon, 21) + '<span>' + esc(id === 'record' ? 'Record' : id === 'required' ? 'Reorder' : t.name) + '</span>' + (c ? '<span class="count badge b-danger" style="position:static;padding:0 5px;font-size:9px">' + c + '</span>' : '') + '</button>'; }).join('');
  $all('#botnav button').forEach(function (b) { b.onclick = function () { setTab(b.dataset.tab); }; });
  $('#userChip').innerHTML = ICON('user', 15) + '<span style="margin-left:2px">' + esc(S.user || 'Set name') + '</span>';
  $('#userChip').onclick = function () { askUser(); };
}
function setTab(id) {
  S.tab = id; S.ui = {}; localStorage.setItem('inv_tab', id);
  var t = TABS.filter(function (x) { return x.id === id; })[0] || TABS[0];
  $('#pageTitle').textContent = t.title; $('#pageSub').textContent = t.sub;
  window.scrollTo(0, 0); renderNav(); renderView();
}
function render() { renderNav(); renderView(); updatePrimary(); }
function updatePrimary() {
  var pa = $('#primaryAction'); if (!pa) return;
  var map = {
    overview: ['Add item', function () { itemForm(); }],
    record: ['Quick count', function () { startQuickCount(); }],
    orders: ['New order', function () { orderBuilder(); }],
    suppliers: ['Add supplier', function () { supplierForm(); }],
    required: ['Order all', function () { orderFromRequired(); }]
  };
  var m = map[S.tab];
  if (m && !S.offline) { pa.style.display = ''; pa.innerHTML = ICON('plus', 16) + m[0]; pa.onclick = m[1]; } else pa.style.display = 'none';
}
function renderView() {
  updatePrimary(); var v = $('#view');
  if (!S.loaded && !apiConfigured()) return;
  if (!S.loaded) { v.innerHTML = '<div class="loading"><div class="spinner"></div><span>Loading…</span></div>'; return; }
  var fn = { home: viewHome, overview: viewOverview, record: viewRecord, required: viewRequired, addl: viewAddl, orders: viewOrders, finance: viewFinance, suppliers: viewSuppliers, activity: viewActivity, settings: viewSettings }[S.tab] || viewHome;
  fn(v);
}
function subtabBar(counts) { return '<div class="subtabs">' + CATS.map(function (c) { return '<button class="subtab ' + (S.sub === c ? 'active' : '') + '" data-sub="' + c + '">' + esc(c) + (counts && counts[c] != null ? '<span class="n">' + counts[c] + '</span>' : '') + '</button>'; }).join('') + '</div>'; }
function wireSubtabs(root, cb) { $all('[data-sub]', root).forEach(function (b) { b.onclick = function () { S.sub = b.dataset.sub; localStorage.setItem('inv_sub', S.sub); cb ? cb() : renderView(); }; }); }
function getUI(k, def) { if (S.ui[k] == null) S.ui[k] = def; return S.ui[k]; }

function pill(status) {
  var m = { out: ['b-danger', 'Out of stock'], critical: ['b-danger', 'Critical'], low: ['b-warn', 'Reorder'], ok: ['b-ok', 'OK'], overstock: ['b-accent', 'Overstock'] }[status] || ['b-muted', status];
  return '<span class="badge ' + m[0] + '">' + ICON(status === 'ok' ? 'check' : status === 'overstock' ? 'up' : 'warn', 12) + esc(m[1]) + '</span>';
}
function statusRank(s) { var r = { out: 0, critical: 1, low: 2, ok: 3, overstock: 4 }; return r[s] != null ? r[s] : 5; }
function kpi(label, value, desc, kind) { return '<div class="kpi ' + (kind || '') + '"><div class="l">' + esc(label) + '</div><div class="v">' + value + '</div>' + (desc ? '<div class="d">' + esc(desc) + '</div>' : '') + '</div>'; }
function emptyState(icon, title, sub) { return '<div class="empty">' + ICON(icon, 44) + '<h4>' + esc(title) + '</h4><div>' + esc(sub || '') + '</div></div>'; }
function chartBox(title, sub, svg) { return '<div class="chart-box"><h3>' + esc(title) + '</h3><div class="csub">' + esc(sub) + '</div>' + svg + '</div>'; }

function needStr(it, compact) { if (!it.needQty) return '—'; return fmtNum(it.needQty) + ' ' + (it.needUnit || '') + ' / ' + fmtPeriod(it.needPeriodMonths, compact); }
function fmtQty(n, unit) { return fmtNum(n) + (unit ? ' ' + unit : ''); }
function subcatsFor(cat) { return listVal(cat === 'Stationery' ? 'stationerySubcats' : 'pantrySubcats'); }
function listVal(key) { var v = S.settings[key]; if (Array.isArray(v)) return v; try { var p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; } }
function addToList(key, val) { if (!val) return; var a = listVal(key).slice(); if (a.indexOf(val) < 0) { a.push(val); a.sort(function (x, y) { return String(x).toLowerCase() < String(y).toLowerCase() ? -1 : 1; }); saveSetting(key, a); } }
function removeFromList(key, val) { saveSetting(key, listVal(key).filter(function (x) { return x !== val; })); }
function unitSystems() { var v = S.settings.unitSystems; if (Array.isArray(v)) return v; try { var p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; } }

/* ---- cascade helpers: keep the whole dashboard in step with Settings edits ---- */
function applyUnitRename(map, itemFilter) {
  var itemsCh = [], consCh = [], ordCh = [], ids = {};
  S.items.forEach(function (it) {
    if (!itemFilter(it)) return; ids[it.id] = 1;
    var f = factorsOf(it), nf = {}; Object.keys(f).forEach(function (k) { nf[map[k] || k] = f[k]; }); it.factorsJSON = JSON.stringify(nf);
    ['stockUnit', 'baseUnit', 'needUnit', 'unit'].forEach(function (k) { if (it[k] && map[it[k]]) it[k] = map[it[k]]; });
    itemsCh.push(it);
  });
  S.consumption.forEach(function (c) { if (ids[c.itemId] && c.unit && map[c.unit]) { c.unit = map[c.unit]; consCh.push(c); } });
  S.orders.forEach(function (o) { var lines = parseLines(o.linesJSON), ch = false; lines.forEach(function (ln) { if (ids[ln.itemId] && ln.unit && map[ln.unit]) { ln.unit = map[ln.unit]; ch = true; } }); if (ch) { o.linesJSON = JSON.stringify(lines); ordCh.push(o); } });
  commitCascade(itemsCh, consCh, ordCh);
}
function commitCascade(itemsCh, consCh, ordCh) {
  if (itemsCh && itemsCh.length) persistManyUpdate('Items', itemsCh);
  if (consCh && consCh.length) persistManyUpdate('Consumption', consCh);
  if (ordCh && ordCh.length) persistManyUpdate('Orders', ordCh);
}
function renameSubcatEverywhere(oldV, newV) { var ch = []; S.items.forEach(function (it) { if (it.subcategory === oldV) { it.subcategory = newV; ch.push(it); } }); commitCascade(ch); }
function renamePersonEverywhere(oldV, newV) { var c = [], o = []; S.consumption.forEach(function (x) { if (x.enteredBy === oldV) { x.enteredBy = newV; c.push(x); } }); S.orders.forEach(function (x) { if (x.orderedBy === oldV) { x.orderedBy = newV; o.push(x); } }); commitCascade(null, c, o); }

/* =================================================================== */
/*  HOME                                                               */
/* =================================================================== */
function viewHome(v) {
  var reorder = [], stale = [], pending = [];
  S.items.forEach(function (it) { if (String(it.active) === 'false') return; var dd = D(it.id); if (dd.needsOrder) reorder.push(it); var da = daysAgo(dd.lastCount || it.openingDate); if (da != null && da > 30) stale.push(it); });
  S.orders.forEach(function (o) { if (o.status === 'Ordered' || o.status === 'Draft') pending.push(o); });
  reorder.sort(function (a, b) { return (D(a.id).daysCover == null ? 9999 : D(a.id).daysCover) - (D(b.id).daysCover == null ? 9999 : D(b.id).daysCover); });
  var totalItems = S.items.filter(function (i) { return String(i.active) !== 'false'; }).length;
  var invValue = 0; S.items.forEach(function (it) { invValue += D(it.id).value || 0; });
  var addlCount = navCounts().addl;

  var html = '<div class="kpis">' +
    kpi('Items tracked', totalItems, CATS.map(function (c) { return itemsIn(c).length + ' ' + c.toLowerCase(); }).join(' · '), '') +
    kpi('Need to order', reorder.length, reorder.length ? 'Tap to view' : 'All good', reorder.length ? 'danger' : 'ok') +
    kpi('Coming up', addlCount, 'will run low soon', addlCount ? 'warn' : 'ok') +
    kpi('Inventory value', money(invValue), 'at latest prices', 'accent') + '</div>';

  html += '<div class="card" style="margin-bottom:16px"><div class="card-h">' + ICON('warn', 18) + '<h3>Needs attention</h3><div class="spacer"></div><button class="btn sm" id="goReq">View all</button></div><div class="card-b">';
  if (!reorder.length && !stale.length && !pending.length) html += emptyState('check', 'Everything is in order', 'No items below reorder level, no stale counts, no pending orders.');
  else {
    reorder.slice(0, 8).forEach(function (it) { var dd = D(it.id); html += alertItem(it.id, statusCls(dd.status), 'required', esc(it.name), (dd.status === 'out' ? 'Out of stock' : 'Only ' + qtyDisp(it, dd.currentBase) + ' left') + (dd.daysCover != null ? ' · ~' + fmtPeriod(dd.daysCover / 30, true) + ' cover' : '') + ' · suggest ' + qtyDisp(it, dd.suggestedBase)); });
    stale.slice(0, 4).forEach(function (it) { html += alertItem(it.id, 'b-warn', 'clock', esc(it.name) + ' — not counted', 'Last counted ' + relDays(D(it.id).lastCount || it.openingDate) + '. Please recount.'); });
    pending.slice(0, 4).forEach(function (o) { html += '<div class="alert-item" data-order="' + esc(o.id) + '"><div class="ai-ico" style="background:var(--accent-bg);color:var(--accent-ink)">' + ICON('orders', 19) + '</div><div class="grow"><div class="ai-t">Order ' + esc((o.status || '').toLowerCase()) + ' — ' + esc(o.supplierName || 'supplier') + '</div><div class="ai-s">' + money(o.total) + ' · ' + parseLines(o.linesJSON).length + ' item(s) · ' + fmtDate(o.date) + '</div></div>' + ICON('up', 16) + '</div>'; });
  }
  html += '</div></div>';
  html += '<div class="row" style="margin-bottom:16px"><button class="btn primary" id="qc">' + ICON('record', 16) + 'Record consumption</button><button class="btn" id="qo">' + ICON('orders', 16) + 'New order</button><button class="btn" id="qov">' + ICON('overview', 16) + 'Overview</button></div>';
  html += '<div class="charts-grid">' + chartBox('Consumption value — last 6 months', 'Estimated value of items used', lineChartSVG(consumptionValueSeries(6), { color: 'var(--s1)', money: true })) + chartBox('Spend — last 6 months', 'From received orders', barChartSVG(spendSeries(6), { color: 'var(--s2)', money: true })) + '</div>';
  v.innerHTML = html;
  $('#goReq').onclick = function () { setTab('required'); }; $('#qc').onclick = function () { setTab('record'); }; $('#qo').onclick = function () { orderBuilder(); }; $('#qov').onclick = function () { setTab('overview'); };
  $all('.alert-item[data-item]', v).forEach(function (a) { a.onclick = function () { itemDetail(a.dataset.item); }; });
  $all('.alert-item[data-order]', v).forEach(function (a) { a.onclick = function () { orderDetail(a.dataset.order); }; });
  wireCharts(v);
}
function statusCls(s) { return (s === 'out' || s === 'critical') ? 'b-danger' : s === 'low' ? 'b-warn' : 'b-muted'; }
function alertItem(id, cls, icon, title, sub) {
  var col = cls === 'b-danger' ? 'background:var(--danger-bg);color:var(--danger-ink)' : cls === 'b-warn' ? 'background:var(--warn-bg);color:var(--warn-ink)' : 'background:var(--surface-3);color:var(--ink-2)';
  return '<div class="alert-item" data-item="' + esc(id) + '"><div class="ai-ico" style="' + col + '">' + ICON(icon, 19) + '</div><div class="grow"><div class="ai-t">' + title + '</div><div class="ai-s">' + sub + '</div></div>' + ICON('up', 16) + '</div>';
}

/* =================================================================== */
/*  OVERVIEW (also the item master — add/edit/delete here)             */
/* =================================================================== */
function viewOverview(v) {
  var counts = {}; CATS.forEach(function (c) { counts[c] = itemsIn(c).length; });
  var key = 'ov';
  var html = subtabBar(counts) +
    '<div class="toolbar"><div class="search grow">' + ICON('search', 16) + '<input id="' + key + '_q" placeholder="Search items…" autocomplete="off"></div>' +
    '<select id="' + key + '_status" style="width:auto;min-width:130px"><option value="">All statuses</option><option value="need">Needs order</option><option value="out">Out of stock</option><option value="ok">OK</option></select>' +
    '<select id="' + key + '_cat" style="width:auto;min-width:150px"></select>' +
    '<button class="btn" id="ov_bulk">' + ICON('layers', 16) + 'Bulk</button></div><div id="' + key + '_res"></div>';
  v.innerHTML = html;
  wireSubtabs(v);
  $('#' + key + '_cat').innerHTML = '<option value="">All sub-categories</option>' + subcatsFor(S.sub).map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');
  var refresh = function () { renderItemRows(key); };
  $('#' + key + '_q').addEventListener('input', debounce(refresh, 200));
  $('#' + key + '_status').onchange = refresh; $('#' + key + '_cat').onchange = refresh;
  $('#ov_bulk').onclick = function () { bulkOpen('Items', currentItemRows(key), itemBulkLabel); };
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
  else if (status === 'out') rows = rows.filter(function (it) { return D(it.id).currentBase <= 0; });
  else if (status === 'ok') rows = rows.filter(function (it) { return !D(it.id).needsOrder; });
  var sort = getUI(key + '_sort', { col: 'name', dir: 'asc' });
  rows.sort(sortItems(sort.col, sort.dir));
  return rows;
}
function sortItems(col, dir) {
  return function (a, b) {
    var av, bv, da = D(a.id), db = D(b.id);
    switch (col) {
      case 'stock': av = da.currentBase; bv = db.currentBase; break;
      case 'usage': av = da.rateBase; bv = db.rateBase; break;
      case 'cover': av = da.daysCover == null ? Infinity : da.daysCover; bv = db.daysCover == null ? Infinity : db.daysCover; break;
      case 'value': av = da.value; bv = db.value; break;
      case 'last': av = toDate(da.lastCount) ? toDate(da.lastCount).getTime() : 0; bv = toDate(db.lastCount) ? toDate(db.lastCount).getTime() : 0; break;
      case 'cat': av = (a.subcategory || '').toLowerCase(); bv = (b.subcategory || '').toLowerCase(); break;
      case 'supplier': av = ((supplierById(a.supplierId) || {}).name || '').toLowerCase(); bv = ((supplierById(b.supplierId) || {}).name || '').toLowerCase(); break;
      case 'status': av = statusRank(da.status); bv = statusRank(db.status); break;
      default: av = a.name.toLowerCase(); bv = b.name.toLowerCase();
    }
    var m = dir === 'desc' ? -1 : 1; return av < bv ? -m : av > bv ? m : 0;
  };
}
function renderItemRows(key) {
  var rows = currentItemRows(key), sort = getUI(key + '_sort', { col: 'name', dir: 'asc' }), box = $('#' + key + '_res');
  if (!rows.length) { box.innerHTML = emptyState('search', 'No items match', 'Clear the search/filters, or use “Add item”.'); return; }
  function sh(col, label, cls) { var ind = sort.col === col ? '<span class="sort-ind">' + (sort.dir === 'asc' ? '▲' : '▼') + '</span>' : ''; return '<th class="sortable ' + (cls || '') + '" data-col="' + col + '">' + esc(label) + ind + '</th>'; }
  var t = '<div class="table-wrap desktop-only"><table class="grid"><thead><tr>' + sh('name', 'Item') + sh('cat', 'Category') + sh('supplier', 'Supplier') + sh('stock', 'Stock', 'num') + sh('usage', 'Use / mo', 'num') + sh('cover', 'Cover', 'num') + '<th>Need</th>' + sh('status', 'Status') + sh('value', 'Value', 'num') + sh('last', 'Last count') + '</tr></thead><tbody>';
  rows.forEach(function (it) {
    var dd = D(it.id), sup = supplierById(it.supplierId);
    t += '<tr data-id="' + esc(it.id) + '"><td><div class="item-name">' + esc(it.name) + '</div>' + (it.brand ? '<div class="item-meta">' + esc(it.brand) + '</div>' : '') + '</td>' +
      '<td><span class="chip">' + esc(it.subcategory || '—') + '</span></td>' +
      '<td class="item-meta nowrap">' + (sup ? esc(clip(sup.name, 18)) : '<span class="muted">—</span>') + '</td>' +
      '<td class="num"><b>' + fmtNum(dd.current) + '</b> <span class="muted">' + esc(dd.su) + '</span>' + stockMini(it, dd) + '</td>' +
      '<td class="num">' + (dd.actualRate ? fmtNum(dd.actualRate) : '<span class="muted">—</span>') + '</td>' +
      '<td class="num">' + (dd.daysCover != null ? fmtPeriod(dd.daysCover / 30) : '<span class="muted">—</span>') + '</td>' +
      '<td class="nowrap">' + esc(needStr(it)) + '</td>' +
      '<td>' + pill(dd.status) + '</td>' +
      '<td class="num">' + (dd.value ? money(dd.value) : '<span class="muted">—</span>') + '</td>' +
      '<td class="nowrap muted">' + fmtDateShort(dd.lastCount) + '</td></tr>';
  });
  t += '</tbody></table></div><div class="cards-list mobile-only">';
  rows.forEach(function (it) {
    var dd = D(it.id), sup = supplierById(it.supplierId);
    t += '<div class="rowcard" data-id="' + esc(it.id) + '"><div class="rc-top"><div class="grow"><div class="item-name">' + esc(it.name) + '</div><div class="item-meta">' + esc((it.brand ? it.brand + ' · ' : '') + (it.subcategory || '')) + '</div></div>' + pill(dd.status) + '</div>' +
      '<div class="rc-meta"><span>Stock <b>' + fmtNum(dd.current) + ' ' + esc(dd.su) + '</b></span><span>Need <b>' + esc(needStr(it)) + '</b></span><span>Use/mo <b>' + (dd.actualRate ? fmtNum(dd.actualRate) : '—') + '</b></span>' + (dd.daysCover != null ? '<span>Cover <b>' + fmtPeriod(dd.daysCover / 30) + '</b></span>' : '') + (sup ? '<span>Supplier <b>' + esc(sup.name) + '</b></span>' : '') + '</div></div>';
  });
  t += '</div>';
  box.innerHTML = t;
  $all('th.sortable', box).forEach(function (th) { th.onclick = function () { var col = th.dataset.col; if (sort.col === col) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc'; else { sort.col = col; sort.dir = (col === 'name' || col === 'cat') ? 'asc' : 'desc'; } S.ui[key + '_sort'] = sort; renderItemRows(key); }; });
  $all('[data-id]', box).forEach(function (r) { r.onclick = function () { itemDetail(r.dataset.id); }; });
}
function stockMini(it, dd) { if (!dd.needBase) return ''; var pct = Math.min(100, Math.round((dd.currentBase / dd.needBase) * 100)); var col = dd.status === 'ok' ? 'var(--ok)' : dd.status === 'low' ? 'var(--warn)' : 'var(--danger)'; return '<div class="stockbar" style="margin-top:5px"><span style="width:' + pct + '%;background:' + col + '"></span></div>'; }

/* =================================================================== */
/*  RECORD CONSUMPTION                                                 */
/* =================================================================== */
function viewRecord(v) {
  var html = subtabBar() + '<div class="row" style="margin-bottom:14px"><button class="btn primary" id="quickCountBtn">' + ICON('record', 16) + 'Quick weekly count</button><button class="btn" id="singleEntryBtn">' + ICON('plus', 16) + 'Single entry</button><button class="btn" id="rec_bulk">' + ICON('layers', 16) + 'Bulk</button></div>';
  html += '<div class="card"><div class="card-h">' + ICON('clock', 18) + '<h3>Recent entries — ' + esc(S.sub) + '</h3></div><div class="card-b" id="rec_log"></div></div>';
  v.innerHTML = html; wireSubtabs(v);
  $('#quickCountBtn').onclick = startQuickCount; $('#singleEntryBtn').onclick = function () { consumptionForm(); };
  $('#rec_bulk').onclick = function () { bulkOpen('Consumption', currentConsumptionFiltered(), function (c) { var it = itemById(c.itemId) || {}; var u = c.unit || ''; var lab = c.mode === 'used' ? 'Used ' + fmtNum(c.value) : c.mode === 'added' ? 'Added ' + fmtNum(c.value) : 'Counted ' + fmtNum(c.value) + ' left'; return { title: it.name || '—', sub: lab + ' ' + u + ' · ' + fmtDateShort(c.date) + ' · ' + (c.enteredBy || '') }; }); };
  renderConsumptionLog();
}
function currentConsumptionFiltered() {
  var ids = {}; itemsIn(S.sub).forEach(function (it) { ids[it.id] = it; });
  return S.consumption.filter(function (c) { return ids[c.itemId]; }).sort(function (a, b) { return (toDate(b.date) || 0) - (toDate(a.date) || 0) || (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0); });
}
function renderConsumptionLog() {
  var box = $('#rec_log'); if (!box) return;
  var ids = {}; itemsIn(S.sub).forEach(function (it) { ids[it.id] = it; });
  var rows = S.consumption.filter(function (c) { return ids[c.itemId]; }).sort(function (a, b) { return (toDate(b.date) || 0) - (toDate(a.date) || 0) || (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0); }).slice(0, 60);
  if (!rows.length) { box.innerHTML = emptyState('record', 'No entries yet', 'Use “Quick weekly count” to record how much is left.'); return; }
  var t = '<div class="cards-list">';
  rows.forEach(function (c) { var it = ids[c.itemId], u = c.unit || stockUnitOf(it); var label = c.mode === 'used' ? 'Used ' + fmtNum(c.value) + ' ' + u : c.mode === 'added' ? 'Added ' + fmtNum(c.value) + ' ' + u : 'Counted ' + fmtNum(c.value) + ' ' + u + ' left'; t += '<div class="rowcard" data-cid="' + esc(c.id) + '"><div class="rc-top"><div class="grow"><div class="item-name">' + esc(it.name) + '</div><div class="item-meta">' + esc(label) + '</div></div><div class="right"><div class="chip">' + fmtDateShort(c.date) + '</div><div class="item-meta" style="margin-top:4px">' + esc(c.enteredBy || '') + '</div></div></div></div>'; });
  t += '</div>'; box.innerHTML = t;
  $all('[data-cid]', box).forEach(function (r) { r.onclick = function () { consumptionDetail(r.dataset.cid); }; });
}
function startQuickCount() {
  var items = itemsIn(S.sub).sort(by('name'));
  if (!items.length) { toast('No items in ' + S.sub, 'warn'); return; }
  var rows = items.map(function (it) { var dd = D(it.id); return '<div class="count-item" data-id="' + esc(it.id) + '"><div class="ci-name">' + esc(it.name) + '</div><div class="ci-sub">' + esc(it.subcategory || '') + (it.brand ? ' · ' + esc(it.brand) : '') + ' · system says <b>' + fmtNum(dd.current) + ' ' + esc(dd.su) + '</b></div><div class="ci-row"><label>How many <b>' + esc(dd.su) + '</b> left now?</label>' + stepper(it.id, dd.current) + '</div></div>'; }).join('');
  var m = openModal('<div class="modal-h">' + ICON('record', 20) + '<h3>Weekly count — ' + esc(S.sub) + '</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div><div class="modal-b"><p class="hint" style="margin-top:0">Enter how many of each item are physically left. Leave a box unchanged if not counted. Date: <b>' + fmtDate(today()) + '</b>.</p>' + rows + '</div><div class="modal-f"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-save>' + ICON('check', 16) + 'Save count</button></div>', { wide: true, sticky: true });
  wireSteppers(m); $all('[data-x]', m).forEach(function (b) { b.onclick = closeModal; });
  $('[data-save]', m).onclick = function () { saveQuickCount(m, items); };
}
function stepper(id, val) { return '<div class="stepper"><button type="button" data-dec="' + esc(id) + '">−</button><input type="number" inputmode="decimal" data-count="' + esc(id) + '" value="' + round(num(val), 2) + '"><button type="button" data-inc="' + esc(id) + '">+</button></div>'; }
function wireSteppers(root) { $all('[data-inc]', root).forEach(function (b) { b.onclick = function () { var i = $('[data-count="' + cssq(b.dataset.inc) + '"]', root); i.value = round(num(i.value) + 1, 2); }; }); $all('[data-dec]', root).forEach(function (b) { b.onclick = function () { var i = $('[data-count="' + cssq(b.dataset.dec) + '"]', root); i.value = Math.max(0, round(num(i.value) - 1, 2)); }; }); }
function saveQuickCount(m, items) {
  if (!S.user) { closeModal(); askUser(function(){ startQuickCount(); }); return; }
  var recs = [];
  items.forEach(function (it) { var inp = $('[data-count="' + cssq(it.id) + '"]', m); if (!inp) return; var dd = D(it.id), left = num(inp.value); if (round(left, 2) === round(dd.current, 2)) return; recs.push({ id: uid('CON'), date: today(), itemId: it.id, mode: 'left', value: left, unit: dd.su, consumed: Math.max(0, round(dd.current - left, 2)), prevStock: dd.current, newStock: left, enteredBy: S.user, note: 'Weekly count', createdAt: new Date().toISOString() }); });
  if (!recs.length) { toast('Nothing changed to save.', 'warn'); return; }
  closeModal(); persistBulk('Consumption', recs).then(function () { toast('Saved ' + recs.length + ' count(s).', 'ok'); });
}

/* =================================================================== */
/*  REQUIRED ITEMS                                                     */
/* =================================================================== */
function viewRequired(v) {
  var counts = {}; CATS.forEach(function (c) { counts[c] = itemsIn(c).filter(function (it) { return D(it.id).needsOrder; }).length; });
  var list = itemsIn(S.sub).filter(function (it) { return D(it.id).needsOrder; }).sort(function (a, b) { return statusRank(D(a.id).status) - statusRank(D(b.id).status) || ((D(a.id).daysCover == null ? 9999 : D(a.id).daysCover) - (D(b.id).daysCover == null ? 9999 : D(b.id).daysCover)); });
  var totalEst = 0; list.forEach(function (it) { totalEst += D(it.id).suggestedBase * D(it.id).perBase || 0; });
  var html = subtabBar(counts) + '<div class="kpis"><div class="kpi danger"><div class="l">Items to order</div><div class="v">' + list.length + '</div><div class="d">in ' + esc(S.sub) + '</div></div><div class="kpi accent"><div class="l">Estimated cost</div><div class="v">' + money(totalEst) + '</div><div class="d">at latest prices</div></div></div>';
  if (list.length) html += '<div class="row" style="margin-bottom:14px"><button class="btn primary" id="orderAll">' + ICON('orders', 16) + 'Create order from this list</button><button class="btn" id="req_bulk">' + ICON('layers', 16) + 'Bulk edit</button></div>';
  html += '<div id="req_res"></div>'; v.innerHTML = html; wireSubtabs(v);
  if ($('#orderAll')) $('#orderAll').onclick = orderFromRequired;
  if ($('#req_bulk')) $('#req_bulk').onclick = function () { bulkOpen('Items', list, itemBulkLabel); };
  var box = $('#req_res');
  if (!list.length) { box.innerHTML = emptyState('check', 'Nothing to order in ' + S.sub, 'All items are above their reorder level.'); return; }
  var t = '<div class="cards-list">';
  list.forEach(function (it) { var dd = D(it.id); t += '<div class="rowcard" data-id="' + esc(it.id) + '"><div class="rc-top"><div class="grow"><div class="item-name">' + esc(it.name) + '</div><div class="item-meta">' + esc((it.subcategory || '') + (it.brand ? ' · ' + it.brand : '')) + '</div></div>' + pill(dd.status) + '</div><div class="rc-meta"><span>Now <b>' + qtyDisp(it, dd.currentBase) + '</b></span><span>Reorder at <b>' + fmtNum(dd.reorderLevel) + ' ' + esc(dd.su) + '</b></span><span>Suggest <b class="txt-danger">' + qtyDisp(it, dd.suggestedBase) + '</b></span>' + (dd.daysCover != null ? '<span>Cover <b>' + fmtPeriod(dd.daysCover / 30, true) + '</b></span>' : '') + '<span>Use/mo <b>' + fmtNum(dd.actualRate) + '</b></span><span style="display:flex;align-items:center;gap:6px">Trend ' + sparklineSVG(monthlyConsumption(it.id, 6), { w: 120, h: 34 }) + '</span></div></div>'; });
  t += '</div>'; box.innerHTML = t;
  $all('[data-id]', box).forEach(function (r) { r.onclick = function () { itemDetail(r.dataset.id); }; });
}
function orderFromRequired() {
  var list = itemsIn(S.sub).filter(function (it) { return D(it.id).needsOrder; });
  if (!list.length) { toast('Nothing to order.', 'warn'); return; }
  var lines = list.map(function (it) { var dd = D(it.id); return { itemId: it.id, name: it.name, unit: dd.su, qty: round(dd.suggested, 2), unitPrice: dd.price || '', supplierId: it.supplierId || '' }; });
  orderBuilder(lines);
}

/* =================================================================== */
/*  ADDITIONALLY REQUIRED (forecast to next order)                    */
/* =================================================================== */
function viewAddl(v) {
  var counts = {}; CATS.forEach(function (c) { counts[c] = additionallyRequired(c).length; });
  var list = additionallyRequired(S.sub);
  var html = subtabBar(counts) + '<div class="card" style="margin-bottom:14px;box-shadow:none;background:var(--surface-3)"><div class="card-b" style="padding:12px 16px;font-size:13px;color:var(--ink-2)">These items are fine right now, but based on how fast they are used they will fall to their reorder level <b>before the next order date</b> for their supplier. Order them now to avoid a mid-cycle run-out. Set a supplier and an order frequency (Suppliers tab) and a preferred supplier on each item to power this.</div></div>';
  html += '<div id="addl_res"></div>'; v.innerHTML = html; wireSubtabs(v);
  var box = $('#addl_res');
  if (!list.length) { box.innerHTML = emptyState('forecast', 'Nothing forecast for ' + S.sub, 'No items are projected to run low before their next order date. (Needs a preferred supplier + order frequency + some consumption history.)'); return; }
  var t = '<div class="cards-list">';
  list.forEach(function (x) {
    var it = x.it, dd = x.d, sup = supplierById(it.supplierId);
    t += '<div class="rowcard"><div class="rc-top"><div class="grow"><div class="item-name">' + esc(it.name) + '</div><div class="item-meta">' + esc((it.subcategory || '') + (sup ? ' · ' + sup.name : '')) + '</div></div><span class="badge b-warn">Order ' + qtyDisp(it, x.qtyBase) + '</span></div>' +
      '<div class="rc-meta"><span>Now <b>' + qtyDisp(it, dd.currentBase) + '</b></span><span>Uses <b>' + fmtNum(dd.actualRate) + ' ' + esc(dd.su) + '/mo</b></span><span>Est. finish <b>' + fmtDateShort(x.finishDate) + '</b></span><span>Next order <b>' + fmtDateShort(x.nextDate) + '</b> (' + fmtPeriod(x.daysUntil / 30, true) + ')</span><span>Projected at then <b class="txt-danger">' + qtyDisp(it, Math.max(0, x.projected)) + '</b></span></div>' +
      '<div class="row mt8"><button class="btn sm primary" data-add="' + esc(it.id) + '">' + ICON('plus', 14) + 'Add to order</button><button class="btn sm" data-open="' + esc(it.id) + '">Details</button></div></div>';
  });
  t += '</div>'; box.innerHTML = t;
  $all('[data-open]', box).forEach(function (b) { b.onclick = function () { itemDetail(b.dataset.open); }; });
  $all('[data-add]', box).forEach(function (b) { b.onclick = function () { var x = list.filter(function (y) { return y.it.id === b.dataset.add; })[0]; if (!x) return; orderBuilder([{ itemId: x.it.id, name: x.it.name, unit: D(x.it.id).su, qty: round(x.qty, 2), unitPrice: D(x.it.id).price || '', supplierId: x.it.supplierId || '' }]); }; });
}

/* =================================================================== */
/*  ORDERS                                                             */
/* =================================================================== */
function viewOrders(v) {
  var orders = S.orders.slice().sort(function (a, b) { return (toDate(b.date) || 0) - (toDate(a.date) || 0); });
  var counts = {}; CATS.forEach(function (c) { counts[c] = orders.filter(function (o) { return orderTouchesCat(o, c); }).length; });
  var html = subtabBar(counts) + '<div class="toolbar"><div class="search grow">' + ICON('search', 16) + '<input id="ord_q" placeholder="Search supplier, invoice…"></div><select id="ord_status" style="width:auto;min-width:150px"><option value="">All statuses</option><option>Draft</option><option>Ordered</option><option>Received</option><option>Cancelled</option></select><button class="btn" id="ord_bulk">' + ICON('layers', 16) + 'Bulk</button></div>';
  var totalSpend = orders.filter(function (o) { return o.status === 'Received'; }).reduce(function (s, o) { return s + num(o.total); }, 0);
  html += '<div class="kpis"><div class="kpi"><div class="l">Total orders</div><div class="v">' + orders.length + '</div></div><div class="kpi accent"><div class="l">Received value</div><div class="v">' + money(totalSpend) + '</div></div></div><div id="ord_res"></div>';
  v.innerHTML = html; wireSubtabs(v);
  var refresh = function () { renderOrders(); };
  $('#ord_q').addEventListener('input', debounce(refresh, 200)); $('#ord_status').onchange = refresh;
  $('#ord_bulk').onclick = function () { bulkOpen('Orders', currentOrdersFiltered(), function (o) { return { title: o.supplierName || 'Order', sub: fmtDate(o.date) + ' · ' + money(o.total) + ' · ' + (o.status || '') }; }); };
  refresh();
}
function orderTouchesCat(o, cat) { return parseLines(o.linesJSON).some(function (ln) { var it = itemById(ln.itemId); return it && it.category === cat; }); }
function currentOrdersFiltered() {
  var q = ($('#ord_q') && $('#ord_q').value || '').toLowerCase().trim(), st = $('#ord_status') ? $('#ord_status').value : '';
  var orders = S.orders.filter(function (o) { return orderTouchesCat(o, S.sub) || parseLines(o.linesJSON).length === 0; }).sort(function (a, b) { return (toDate(b.date) || 0) - (toDate(a.date) || 0); });
  if (q) orders = orders.filter(function (o) { return ((o.supplierName || '') + ' ' + (o.invoiceNo || '') + ' ' + (o.notes || '')).toLowerCase().indexOf(q) >= 0; });
  if (st) orders = orders.filter(function (o) { return o.status === st; });
  return orders;
}
function renderOrders() {
  var orders = currentOrdersFiltered();
  var box = $('#ord_res');
  if (!orders.length) { box.innerHTML = emptyState('orders', 'No orders yet', 'Use “New order” to record what you buy.'); return; }
  var t = '<div class="table-wrap desktop-only"><table class="grid"><thead><tr><th>Date</th><th>Supplier</th><th>Items</th><th class="num">Total</th><th>Invoice</th><th>Status</th><th>By</th></tr></thead><tbody>';
  orders.forEach(function (o) { t += '<tr data-oid="' + esc(o.id) + '"><td class="nowrap">' + fmtDate(o.date) + '</td><td>' + esc(o.supplierName || '—') + '</td><td>' + parseLines(o.linesJSON).length + ' item(s)</td><td class="num"><b>' + money(o.total) + '</b></td><td>' + esc(o.invoiceNo || '—') + '</td><td>' + orderBadge(o.status) + '</td><td class="muted">' + esc(o.orderedBy || '') + '</td></tr>'; });
  t += '</tbody></table></div><div class="cards-list mobile-only">';
  orders.forEach(function (o) { t += '<div class="rowcard" data-oid="' + esc(o.id) + '"><div class="rc-top"><div class="grow"><div class="item-name">' + esc(o.supplierName || 'Order') + '</div><div class="item-meta">' + fmtDate(o.date) + ' · ' + parseLines(o.linesJSON).length + ' item(s)' + (o.invoiceNo ? ' · ' + esc(o.invoiceNo) : '') + '</div></div>' + orderBadge(o.status) + '</div><div class="rc-meta"><span>Total <b>' + money(o.total) + '</b></span><span>By <b>' + esc(o.orderedBy || '—') + '</b></span></div></div>'; });
  t += '</div>'; box.innerHTML = t;
  $all('[data-oid]', box).forEach(function (r) { r.onclick = function () { orderDetail(r.dataset.oid); }; });
}
function orderBadge(s) { var m = { Received: 'b-ok', Ordered: 'b-accent', Draft: 'b-muted', Cancelled: 'b-danger' }[s] || 'b-muted'; return '<span class="badge ' + m + '">' + esc(s || 'Draft') + '</span>'; }

/* =================================================================== */
/*  FINANCE                                                            */
/* =================================================================== */
function viewFinance(v) {
  var counts = {}; CATS.forEach(function (c) { counts[c] = itemsIn(c).length; });
  var its = itemsIn(S.sub), invValue = 0, burn = 0;
  its.forEach(function (it) { var dd = D(it.id); invValue += dd.value || 0; burn += (dd.rateBase * dd.perBase) || 0; });
  var spend90 = spendInLastDays(90, S.sub);
  var recvOrders = S.orders.filter(function (o) { return o.status === 'Received' && orderTouchesCat(o, S.sub); });
  var spendAll = recvOrders.reduce(function (s, o) { return s + catShareOfOrder(o, S.sub); }, 0);
  var avgOrder = recvOrders.length ? spendAll / recvOrders.length : 0;
  var runway = burn > 0 ? invValue / burn : null; // months of stock at current burn
  var hh = stockHealth(S.sub);
  var html = subtabBar(counts) + '<div class="kpis">' +
    kpi('Inventory value', money(invValue), esc(S.sub) + ' on hand', 'accent') +
    kpi('Est. burn / month', money(burn), 'value consumed', '') +
    kpi('Stock runway', runway != null ? fmtPeriod(runway, false) : '—', 'at current burn', runway != null && runway < 1 ? 'danger' : '') +
    kpi('Spent (90 days)', money(spend90), esc(S.sub) + ' received', '') +
    kpi('Avg order value', money(avgOrder), recvOrders.length + ' received orders', '') +
    kpi('Stock health', hh.ok + ' OK', hh.low + ' reorder · ' + hh.out + ' out', hh.out ? 'danger' : hh.low ? 'warn' : 'ok') + '</div>';
  html += '<div class="charts-grid">' +
    chartBox('Monthly spend — ' + S.sub, 'From received orders (6 months)', barChartSVG(spendSeries(6, S.sub), { color: 'var(--s2)', money: true })) +
    chartBox('Consumption value — ' + S.sub, 'Estimated value used per month', lineChartSVG(consumptionValueSeries(6, S.sub), { color: 'var(--s1)', money: true })) +
    chartBox('Spend by item', 'Top items by received-order spend', barChartSVG(spendByItem(S.sub), { color: 'var(--s2)', money: true, horizontal: true })) +
    chartBox('Consumption value by item', 'Estimated value used, all time', barChartSVG(consumptionValueByItem(S.sub), { color: 'var(--s1)', money: true, horizontal: true })) +
    chartBox('Spend by sub-category', 'Received orders, all time', donutSVG(spendBySubcat(S.sub))) +
    chartBox('Stock value by sub-category', 'Current on-hand value', donutSVG(stockValueBySubcat(S.sub))) +
    chartBox('Spend by supplier', 'Received orders, all time', barChartSVG(spendBySupplier(S.sub), { color: 'var(--s3)', money: true, horizontal: true })) +
    chartBox('Orders per month', 'Order activity (6 months)', barChartSVG(ordersByMonth(6, S.sub), { color: 'var(--s7)' })) + '</div>';
  var top = its.map(function (it) { var dd = D(it.id); return { it: it, v: dd.value, burn: (dd.rateBase * dd.perBase) || 0 }; }).filter(function (x) { return x.v > 0 || x.burn > 0; }).sort(function (a, b) { return b.burn - a.burn; }).slice(0, 12);
  html += '<div class="card" style="margin-top:16px"><div class="card-h">' + ICON('finance', 18) + '<h3>Cost by item — ' + esc(S.sub) + '</h3></div><div class="card-b">';
  if (!top.length) html += emptyState('finance', 'No cost data yet', 'Add prices to items or record orders with prices.');
  else { html += '<div class="table-wrap"><table class="grid"><thead><tr><th>Item</th><th class="num">Unit cost</th><th class="num">Stock value</th><th class="num">Use/mo</th><th class="num">Monthly cost</th></tr></thead><tbody>'; top.forEach(function (x) { var dd = D(x.it.id); html += '<tr data-id="' + esc(x.it.id) + '"><td class="item-name">' + esc(x.it.name) + '</td><td class="num">' + (dd.price ? money(dd.price) + '<span class="muted">/' + esc(dd.su) + '</span>' : '—') + '</td><td class="num">' + money(dd.value) + '</td><td class="num">' + fmtNum(dd.actualRate) + '</td><td class="num"><b>' + money(x.burn) + '</b></td></tr>'; }); html += '</tbody></table></div>'; }
  html += '</div></div>'; v.innerHTML = html; wireSubtabs(v);
  $all('[data-id]', v).forEach(function (r) { r.onclick = function () { itemDetail(r.dataset.id); }; });
  wireCharts(v);
}

/* =================================================================== */
/*  SUPPLIERS                                                          */
/* =================================================================== */
function viewSuppliers(v) {
  var counts = {}; CATS.forEach(function (c) { counts[c] = S.suppliers.filter(function (s) { return s.category === c || s.category === 'Both' || !s.category; }).length; });
  var html = subtabBar(counts) + '<div class="toolbar"><div class="search grow">' + ICON('search', 16) + '<input id="sup_q" placeholder="Search supplier, phone…"></div><button class="btn" id="sup_bulk">' + ICON('layers', 16) + 'Bulk</button></div><div id="sup_res"></div>';
  v.innerHTML = html; wireSubtabs(v);
  $('#sup_q').addEventListener('input', debounce(renderSuppliers, 200));
  $('#sup_bulk').onclick = function () { bulkOpen('Suppliers', currentSuppliersFiltered(), function (s) { return { title: s.name, sub: (s.category || 'Both') + (s.orderFrequencyMonths ? ' · every ' + fmtPeriod(s.orderFrequencyMonths, true) : '') }; }); };
  renderSuppliers();
}
function currentSuppliersFiltered() {
  var q = ($('#sup_q') && $('#sup_q').value || '').toLowerCase().trim();
  var rows = S.suppliers.filter(function (s) { return s.category === S.sub || s.category === 'Both' || !s.category; });
  if (q) rows = rows.filter(function (s) { return ((s.name || '') + ' ' + (s.phone || '') + ' ' + (s.contactPerson || '')).toLowerCase().indexOf(q) >= 0; });
  return rows.sort(by('name'));
}
function renderSuppliers() {
  var rows = currentSuppliersFiltered();
  var box = $('#sup_res');
  if (!rows.length) { box.innerHTML = emptyState('suppliers', 'No suppliers yet', 'Add the shops/firms you buy from.'); return; }
  var t = '<div class="cards-list">';
  rows.forEach(function (s) { var spend = S.orders.filter(function (o) { return o.supplierId === s.id && o.status === 'Received'; }).reduce(function (a, o) { return a + num(o.total); }, 0); var cnt = S.orders.filter(function (o) { return o.supplierId === s.id; }).length; var next = nextOrderDateFor(s.id); t += '<div class="rowcard" data-sid="' + esc(s.id) + '"><div class="rc-top"><div class="grow"><div class="item-name">' + esc(s.name) + '</div><div class="item-meta">' + esc((s.contactPerson || '') + (s.phone ? ' · ' + s.phone : '')) + '</div></div><span class="chip">' + esc(s.category || 'Both') + '</span></div><div class="rc-meta"><span>Orders <b>' + cnt + '</b></span><span>Spend <b>' + money(spend) + '</b></span>' + (s.orderFrequencyMonths ? '<span>Every <b>' + fmtPeriod(s.orderFrequencyMonths, true) + '</b></span>' : '') + (next ? '<span>Next order <b>' + fmtDateShort(next) + '</b></span>' : '') + '</div></div>'; });
  t += '</div>'; box.innerHTML = t;
  $all('[data-sid]', box).forEach(function (r) { r.onclick = function () { supplierDetail(r.dataset.sid); }; });
}

/* =================================================================== */
/*  ACTIVITY                                                           */
/* =================================================================== */
function viewActivity(v) {
  var rows = S.activity.slice().sort(function (a, b) { return (toDate(b.timestamp) || 0) - (toDate(a.timestamp) || 0); }).slice(0, 300);
  var html = '<div class="card"><div class="card-h">' + ICON('activity', 18) + '<h3>Activity log</h3><div class="spacer"></div><span class="muted" style="font-size:12.5px">Newest first · ' + rows.length + ' shown</span></div><div class="card-b">';
  if (!rows.length) html += emptyState('activity', 'No activity yet', 'Every add, edit and delete appears here with who did it.');
  else { html += '<div class="cards-list">'; rows.forEach(function (a) { var col = a.action === 'delete' ? 'b-danger' : (a.action === 'create' || a.action === 'bulk-add') ? 'b-ok' : 'b-accent'; html += '<div class="rowcard" style="cursor:default"><div class="rc-top"><div class="grow"><div class="item-name">' + esc(cap(a.action)) + ' · ' + esc(a.entity) + '</div><div class="item-meta">' + esc(a.entityLabel || a.entityId || '') + '</div></div><div class="right"><span class="badge ' + col + '">' + esc(a.user || '—') + '</span><div class="item-meta" style="margin-top:4px">' + fmtDateTime(a.timestamp) + '</div></div></div></div>'; }); html += '</div>'; }
  html += '</div></div>'; v.innerHTML = html;
}

/* =================================================================== */
/*  SETTINGS                                                           */
/* =================================================================== */
function viewSettings(v) {
  var connected = apiConfigured();
  var html = '<div class="charts-grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">';
  html += '<div class="card"><div class="card-h">' + ICON('refresh', 18) + '<h3>Connection</h3></div><div class="card-b"><label>Google Apps Script Web App URL</label><input id="set_api" placeholder="https://script.google.com/…/exec" value="' + esc(API_URL) + '"><div class="hint">Everyone must use the same URL. Status: ' + (connected ? '<b class="txt-ok">connected</b>' : '<b class="txt-danger">not set</b>') + '</div><div class="row mt16"><button class="btn primary" id="saveApi">Save & connect</button><button class="btn" id="testApi">Test</button></div></div></div>';
  html += '<div class="card"><div class="card-h">' + ICON('user', 18) + '<h3>You (this device)</h3></div><div class="card-b"><label>Your name — saved automatically for this device</label><input id="set_user" value="' + esc(S.user) + '" list="dl_users_set"><datalist id="dl_users_set">' + listVal('users').map(function (u) { return '<option>' + esc(u) + '</option>'; }).join('') + '</datalist><div class="hint">Shown as “entered by” on everything you record. Editing here updates your name everywhere for this device.</div><label class="mt16">Simple Count mode (this device only)</label><div class="hint">Turn on for a phone that should ONLY record counts (office staff). It hides everything else and always opens in this mode on this device.</div><div class="row mt8"><button class="btn ' + (S.simple ? 'danger' : '') + '" id="toggleSimple">' + (S.simple ? 'Turn OFF simple mode' : 'Turn ON simple mode') + '</button></div></div></div>';
  html += unitSystemsCard();
  html += settingsListCard('users', 'People', 'Everyone who records entries. Names sync to all devices.');
  html += settingsListCard('units', 'Loose units', 'Standalone units (for single-unit items).');
  html += settingsListCard('stationerySubcats', 'Stationery categories', 'Groups within Stationery.');
  html += settingsListCard('pantrySubcats', 'Pantry categories', 'Groups within Pantry.');
  html += '<div class="card"><div class="card-h">' + ICON('settings', 18) + '<h3>General</h3></div><div class="card-b"><label>Dashboard title</label><input id="set_title" value="' + esc(S.settings.appTitle || 'Office Inventory') + '"><label class="mt16">Currency symbol</label><input id="set_cur" value="' + esc(S.settings.currency || '₹') + '" style="max-width:120px"><label class="mt16">Default reorder threshold (%)</label><input id="set_thr" type="number" value="' + esc(S.settings.defaultThresholdPct || 15) + '" style="max-width:120px"><div class="hint">Flag to reorder when stock falls to this % of Need (unless an item sets its own level).</div><div class="row mt16"><button class="btn primary" id="saveGen">Save</button></div></div></div>';
  html += '</div>';
  v.innerHTML = html;
  $('#saveApi').onclick = function () { var u = $('#set_api').value.trim(); if (u.indexOf('http') !== 0) { toast('Enter a valid URL', 'err'); return; } localStorage.setItem('inv_api_url', u); API_URL = u; toast('Connecting…'); loadData(true); };
  $('#testApi').onclick = function () { var u = $('#set_api').value.trim() || API_URL; fetch(u + '?action=ping').then(function (r) { return r.json(); }).then(function (d) { toast(d.ok ? 'Connection OK ✓' : 'Reached, unexpected reply', d.ok ? 'ok' : 'warn'); }).catch(function () { toast('Could not reach the URL', 'err'); }); };
  var un = $('#set_user'); var saveName = function () { var n = un.value.trim(); if (!n) return; S.user = n; localStorage.setItem('inv_user', n); addToList('users', n); renderNav(); }; un.addEventListener('change', function () { saveName(); toast('Name saved', 'ok'); });
  $('#toggleSimple').onclick = function () { S.simple = !S.simple; localStorage.setItem('inv_simple', S.simple ? '1' : '0'); applySimple(); };
  $('#saveGen').onclick = function () { saveSetting('appTitle', $('#set_title').value.trim() || 'Office Inventory'); saveSetting('currency', $('#set_cur').value.trim() || '₹'); saveSetting('defaultThresholdPct', num($('#set_thr').value) || 15); $('#brandTitle').textContent = S.settings.appTitle; recompute(); toast('Saved', 'ok'); renderView(); };
  wireSettingsLists(v); wireUnitSystems(v);
}
function settingsListCard(key, title, hint) {
  var arr = listVal(key).slice().sort(function (a, b) { return String(a).toLowerCase() < String(b).toLowerCase() ? -1 : 1; });
  return '<div class="card"><div class="card-h">' + ICON('tag', 18) + '<h3>' + esc(title) + '</h3></div><div class="card-b"><div class="hint" style="margin:0 0 10px">' + esc(hint) + ' Edits rename everywhere they are used.</div><div class="row" style="gap:6px" id="list_' + key + '">' + arr.map(function (x) { return '<span class="chip">' + esc(x) + ' <button class="iconbtn" style="width:19px;height:19px;border:none;background:transparent" data-editv="' + escAttr(key + '|' + x) + '" title="Rename">' + ICON('edit', 12) + '</button><button class="iconbtn" style="width:19px;height:19px;border:none;background:transparent" data-del="' + escAttr(key + '|' + x) + '" title="Remove">' + ICON('x', 13) + '</button></span>'; }).join('') + '</div><div class="row mt8"><input id="add_' + key + '" placeholder="Add…" style="max-width:200px"><button class="btn sm" data-add="' + key + '">Add</button></div></div></div>';
}
function wireSettingsLists(root) {
  $all('[data-add]', root).forEach(function (b) { b.onclick = function () { var k = b.dataset.add; var val = $('#add_' + k).value.trim(); if (val) { addToList(k, val); renderView(); } }; });
  $all('[data-del]', root).forEach(function (b) { b.onclick = function () { var p = b.dataset.del.split('|'); var key = p[0], val = p.slice(1).join('|'); confirmBox({ title: 'Remove “' + esc(val) + '”?', ok: 'Remove', body: 'Removes it from the list. Records that already used it keep their text.', onOk: function () { removeFromList(key, val); renderView(); } }); }; });
  $all('[data-editv]', root).forEach(function (b) { b.onclick = function () { var p = b.dataset.editv.split('|'); editListValue(p[0], p.slice(1).join('|')); }; });
}
function editListValue(key, val) {
  var m = openModal('<div class="modal-h">' + ICON('edit', 20) + '<h3>Rename “' + esc(val) + '”</h3></div><div class="modal-b"><label>New name</label><input id="ev_name" value="' + esc(val) + '"><div class="hint">This renames it everywhere it is used across the dashboard.</div></div><div class="modal-f"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>Rename</button></div>');
  $('[data-x]', m).onclick = closeModal;
  $('[data-ok]', m).onclick = function () {
    var nv = $('#ev_name', m).value.trim(); if (!nv || nv === val) { closeModal(); return; }
    removeFromList(key, val); addToList(key, nv);
    if (key === 'users') renamePersonEverywhere(val, nv);
    else if (key === 'stationerySubcats' || key === 'pantrySubcats') renameSubcatEverywhere(val, nv);
    else if (key === 'units') { var map = {}; map[val] = nv; applyUnitRename(map, function () { return true; }); }
    closeModal(); toast('Renamed everywhere', 'ok'); renderView();
  };
}
function unitSystemsCard() {
  var sys = unitSystems();
  var body = sys.length ? sys.map(function (s, i) { var used = S.items.filter(function (it) { return it.unitSystem === s.name && String(it.active) !== 'false'; }).length; return '<div class="rowcard" style="cursor:default;padding:10px 12px"><div class="rc-top"><div class="grow"><div class="item-name">' + esc(s.name) + '</div><div class="item-meta">' + s.levels.map(esc).join(' → ') + ' <span class="muted">(small → large)' + (used ? ' · used by ' + used + ' item(s)' : '') + '</span></div></div><button class="iconbtn" data-usedit="' + i + '" title="Edit">' + ICON('edit', 15) + '</button><button class="iconbtn" data-usdel="' + i + '" title="Delete">' + ICON('trash', 15) + '</button></div></div>'; }).join('') : '<div class="hint">No unit systems yet. Create one like Pcs → Pack → Box.</div>';
  return '<div class="card"><div class="card-h">' + ICON('layers', 18) + '<h3>Unit systems</h3></div><div class="card-b"><div class="hint" style="margin:0 0 10px">A unit system is an ordered list of units from smallest to largest (e.g. Pcs, Pack, Box). Pick one on an item, then set how many of each fit in the next — per item.</div><div class="cards-list" style="gap:8px">' + body + '</div><div class="mt16"><label>New system name</label><input id="us_name" placeholder="e.g. Count (Pcs·Pack·Box)"><label class="mt8">Levels, smallest → largest (comma separated)</label><input id="us_levels" placeholder="Pcs, Pack, Box"><div class="row mt8"><button class="btn sm primary" id="us_add">Add system</button></div></div></div></div>';
}
function wireUnitSystems(root) {
  $all('[data-usdel]', root).forEach(function (b) { b.onclick = function () { var i = +b.dataset.usdel, s = unitSystems()[i]; var used = S.items.filter(function (it) { return it.unitSystem === s.name; }); confirmBox({ title: 'Delete unit system “' + esc(s.name) + '”?', danger: true, ok: 'Delete', body: used.length ? ('It is used by ' + used.length + ' item(s). They will keep their current conversions but become single/standalone (no longer tied to this system).') : 'This removes the system.', onOk: function () { var sys = unitSystems().slice(); sys.splice(i, 1); saveSetting('unitSystems', sys); var ch = []; used.forEach(function (it) { it.unitSystem = ''; ch.push(it); }); commitCascade(ch); renderView(); toast('Unit system deleted', 'ok'); } }); }; });
  $all('[data-usedit]', root).forEach(function (b) { b.onclick = function () { editUnitSystem(+b.dataset.usedit); }; });
  if ($('#us_add', root)) $('#us_add', root).onclick = function () {
    var name = $('#us_name').value.trim(); var levels = $('#us_levels').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    if (!name || levels.length < 2) { toast('Give a name and at least 2 levels', 'err'); return; }
    var sys = unitSystems().slice(); sys.push({ name: name, levels: levels }); saveSetting('unitSystems', sys); renderView(); toast('Unit system added', 'ok');
  };
}
function editUnitSystem(i) {
  var sys = unitSystems(), s = sys[i]; if (!s) return;
  var m = openModal('<div class="modal-h">' + ICON('layers', 20) + '<h3>Edit unit system</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div><div class="modal-b"><label>System name</label><input id="us_ename" value="' + esc(s.name) + '"><label class="mt16">Levels (smallest → largest)</label><div id="us_levrows"></div><button class="btn sm mt8" id="us_addlev">' + ICON('plus', 14) + 'Add level</button><div class="hint mt8">Renaming a level updates it on every item that uses this system (and their records). Removing a level leaves those items\' own conversions intact.</div></div><div class="modal-f"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>Save</button></div>');
  var rows = s.levels.slice();
  function draw() { $('#us_levrows', m).innerHTML = rows.map(function (lv, k) { return '<div class="row mt8" data-lr="' + k + '"><input class="us_lev" data-k="' + k + '" value="' + esc(lv) + '" style="max-width:240px"><button class="iconbtn" data-lrm="' + k + '">' + ICON('x', 15) + '</button></div>'; }).join(''); $all('.us_lev', m).forEach(function (inp) { inp.oninput = function () { rows[+inp.dataset.k] = inp.value; }; }); $all('[data-lrm]', m).forEach(function (btn) { btn.onclick = function () { rows.splice(+btn.dataset.lrm, 1); draw(); }; }); }
  draw();
  $('#us_addlev', m).onclick = function () { $all('.us_lev', m).forEach(function (inp) { rows[+inp.dataset.k] = inp.value; }); rows.push(''); draw(); };
  $all('[data-x]', m).forEach(function (b) { b.onclick = closeModal; });
  $('[data-ok]', m).onclick = function () {
    var newName = $('#us_ename', m).value.trim();
    $all('.us_lev', m).forEach(function (inp) { rows[+inp.dataset.k] = inp.value.trim(); });
    var newLevels = rows.filter(Boolean);
    if (!newName || newLevels.length < 2) { toast('Name and at least 2 levels needed', 'err'); return; }
    var oldName = s.name, oldLevels = s.levels.slice();
    // positional rename map (old level -> new level) for cascade
    var map = {}; for (var k = 0; k < Math.min(oldLevels.length, newLevels.length); k++) if (oldLevels[k] !== newLevels[k]) map[oldLevels[k]] = newLevels[k];
    var sys2 = unitSystems().slice(); sys2[i] = { name: newName, levels: newLevels }; saveSetting('unitSystems', sys2);
    // cascade to items on this system
    var itemsCh = []; S.items.forEach(function (it) { if (it.unitSystem === oldName) it.unitSystem = newName; });
    if (Object.keys(map).length) applyUnitRename(map, function (it) { return it.unitSystem === newName; });
    else { S.items.forEach(function (it) { if (it.unitSystem === newName) itemsCh.push(it); }); commitCascade(itemsCh); }
    closeModal(); toast('Unit system updated', 'ok'); renderView();
  };
}

/* =================================================================== */
/*  FORMS                                                              */
/* =================================================================== */
function field(label, inner, hint, full) { return '<div' + (full ? ' class="full"' : '') + '><label>' + esc(label) + '</label>' + inner + (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + '</div>'; }
function opts(arr, sel) { return arr.map(function (o) { return '<option' + (o === sel ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join(''); }
function detailRows(pairs) { return '<div class="card" style="box-shadow:none"><div class="card-b" style="padding:4px 16px">' + pairs.map(function (p) { return '<div class="detail-row"><span class="k">' + esc(p[0]) + '</span><span class="v">' + (p[1] == null ? '—' : p[1]) + '</span></div>'; }).join('') + '</div></div>'; }

/* Reusable units editor: pick which units of a system to use (any subset),
   set conversions between consecutive USED units. Blank/untick skips that unit
   and the chain re-bridges (e.g. use Pcs & Box, skip Pack → "1 Box = ? Pcs"). */
var _ueSeq = 0;
function cssid(u) { return String(u).replace(/[^a-zA-Z0-9]/g, '_'); }
function UnitsEditor(root, systemGetter, seed, onChange) {
  var used = [], conv = {}, stockU = '', myid = 'ue' + (++_ueSeq);
  function levels() { var s = systemGetter(); if (!s) return []; var sys = unitSystems().filter(function (x) { return x.name === s; })[0]; return sys ? sys.levels.slice() : []; }
  function seedInit() {
    var s = systemGetter();
    if (!s) { used = [(seed && (seed.stockUnit || seed.unit)) || 'Pcs']; conv = {}; stockU = used[0]; return; }
    var lv = levels(), f = seed ? factorsOf(seed) : {}, seedUnits = Object.keys(f).filter(function (u) { return lv.indexOf(u) >= 0; });
    used = seedUnits.length ? lv.filter(function (u) { return seedUnits.indexOf(u) >= 0; }) : lv.slice();
    conv = {}; for (var j = 1; j < used.length; j++) conv[used[j]] = (f[used[j]] && f[used[j - 1]]) ? round(f[used[j]] / f[used[j - 1]], 4) : '';
    stockU = (seed && seed.stockUnit && used.indexOf(seed.stockUnit) >= 0) ? seed.stockUnit : used[0];
  }
  function grabConv() { $all('.' + myid + '_cv', root).forEach(function (inp) { conv[inp.dataset.u] = inp.value.trim() === '' ? '' : num(inp.value); }); }
  function recompFromChecks() { var lv = levels(); used = lv.filter(function (u) { var cb = $('#' + myid + '_use_' + cssid(u), root); return cb ? cb.checked : true; }); if (!used.length) used = lv.slice(0, 1); if (stockU && used.indexOf(stockU) < 0) stockU = used[0]; }
  function render() {
    var s = systemGetter();
    if (!s) {
      root.innerHTML = '<div class="form-grid">' + field('Unit', '<input id="' + myid + '_single" list="dl_' + myid + '" value="' + esc(used[0] || 'Pcs') + '"><datalist id="dl_' + myid + '">' + listVal('units').map(function (u) { return '<option>' + esc(u) + '</option>'; }).join('') + '</datalist>') + '</div>';
      $('#' + myid + '_single', root).addEventListener('input', function () { used = [$('#' + myid + '_single', root).value.trim() || 'Pcs']; stockU = used[0]; onChange && onChange(); });
      onChange && onChange(); return;
    }
    var lv = levels();
    var checks = '<div class="row" style="gap:16px;margin-bottom:8px">' + lv.map(function (u) { return '<label style="display:flex;align-items:center;gap:6px;font-weight:600;margin:0"><input type="checkbox" id="' + myid + '_use_' + cssid(u) + '" ' + (used.indexOf(u) >= 0 ? 'checked' : '') + ' style="width:auto"> ' + esc(u) + '</label>'; }).join('') + '</div>';
    var convHtml = ''; for (var j = 1; j < used.length; j++) convHtml += field('1 ' + used[j] + ' = ? ' + used[j - 1], '<input class="' + myid + '_cv" data-u="' + esc(used[j]) + '" type="number" inputmode="decimal" value="' + esc(conv[used[j]] != null ? conv[used[j]] : '') + '">');
    root.innerHTML = '<div class="hint" style="margin:2px 0 8px">Tick the units you use for this item; set how many of the smaller fit in the next used one. Untick (or leave blank) to skip a unit — e.g. use Pcs &amp; Box, skip Pack.</div>' + checks + '<div class="form-grid">' + convHtml + '</div><div class="form-grid mt8">' + field('Track stock in', '<select id="' + myid + '_stock">' + opts(used, stockU) + '</select>') + '</div>';
    lv.forEach(function (u) { var cb = $('#' + myid + '_use_' + cssid(u), root); if (cb) cb.onchange = function () { grabConv(); recompFromChecks(); render(); onChange && onChange(); }; });
    $all('.' + myid + '_cv', root).forEach(function (inp) { inp.addEventListener('input', function () { conv[inp.dataset.u] = inp.value.trim() === '' ? '' : num(inp.value); onChange && onChange(); }); });
    if ($('#' + myid + '_stock', root)) $('#' + myid + '_stock', root).onchange = function () { stockU = $('#' + myid + '_stock', root).value; onChange && onChange(); };
    onChange && onChange();
  }
  function compute() {
    var s = systemGetter();
    if (!s) { var u = (used[0] || 'Pcs'); var f0 = {}; f0[u] = 1; return { factors: f0, used: [u], base: u, stockUnit: u }; }
    grabConv();
    var u2 = used.slice(), stable = false;
    while (!stable && u2.length > 1) { stable = true; for (var j = 1; j < u2.length; j++) { if (!(num(conv[u2[j]]) > 0)) { u2.splice(j, 1); stable = false; break; } } }
    var f = {}; f[u2[0]] = 1; for (var k = 1; k < u2.length; k++) f[u2[k]] = f[u2[k - 1]] * num(conv[u2[k]]);
    var su = (stockU && u2.indexOf(stockU) >= 0) ? stockU : u2[0];
    return { factors: f, used: u2, base: u2[0], stockUnit: su };
  }
  seedInit();
  return { render: render, compute: compute, setSystem: function () { seedInit(); render(); }, usedUnits: function () { return compute().used; }, stockUnit: function () { return compute().stockUnit; } };
}

/* ---- ITEM (with unit system) ---- */
function itemForm(item) {
  var isNew = !item;
  item = item || { category: S.sub, active: true, reorderThresholdPct: S.settings.defaultThresholdPct || 15, needPeriodMonths: 1 };
  var sysList = unitSystems();
  var months = Math.floor(num(item.needPeriodMonths || 0)); var days = Math.round((num(item.needPeriodMonths || 0) - months) * 30);
  var sups = S.suppliers.slice().sort(by('name'));
  var html = '<div class="modal-h">' + ICON('box', 20) + '<h3>' + (isNew ? 'Add item' : 'Edit item') + '</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div><div class="modal-b"><div class="form-grid">' +
    field('Category', '<select id="f_cat">' + opts(CATS, item.category) + '</select>') +
    field('Sub-category', '<input id="f_sub" list="dl_sub" value="' + esc(item.subcategory || '') + '"><datalist id="dl_sub">' + subcatsFor(item.category || S.sub).map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('') + '</datalist>') +
    field('Item name', '<input id="f_name" value="' + esc(item.name || '') + '">', '', true) +
    field('Brand', '<input id="f_brand" value="' + esc(item.brand || '') + '">') +
    field('Preferred supplier', '<select id="f_sup"><option value="">— none —</option>' + sups.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === item.supplierId ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select>', 'Powers the “Additionally Required” forecast.') +
    '</div>' +
    '<div class="section-title mt16">Units</div>' +
    field('Unit system', '<select id="f_usys"><option value="">Single unit</option>' + sysList.map(function (s) { return '<option' + (s.name === item.unitSystem ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select>', 'Create systems in Settings. Single unit = just one unit.') +
    '<div id="f_units"></div>' +
    '<div class="section-title mt16">Stock & need</div><div class="form-grid">' +
    field('Opening / current stock', '<input id="f_open" type="number" inputmode="decimal" value="' + esc(item.openingStock != null ? item.openingStock : 0) + '"> <span id="f_openU" class="hint" style="display:inline"></span>', isNew ? 'The stock right now, in the stock unit.' : 'Editing resets the baseline count.') +
    field('Unit cost (' + cur() + ' per stock unit)', '<input id="f_cost" type="number" inputmode="decimal" value="' + esc(item.unitCost || '') + '">', 'Optional — auto-updates from orders.') +
    field('Need quantity', '<input id="f_needq" type="number" inputmode="decimal" value="' + esc(item.needQty || '') + '">') +
    field('Need unit', '<select id="f_needu"></select>') +
    field('Need period — Months', '<input id="f_needM" type="number" inputmode="numeric" value="' + esc(months) + '">') +
    field('Need period — Days', '<input id="f_needD" type="number" inputmode="numeric" value="' + esc(days) + '">') +
    field('Reorder threshold %', '<input id="f_thr" type="number" value="' + esc(item.reorderThresholdPct != null ? item.reorderThresholdPct : (S.settings.defaultThresholdPct || 15)) + '">') +
    field('Reorder level (override, stock unit)', '<input id="f_rl" type="number" inputmode="decimal" value="' + esc(item.reorderLevel || '') + '">', 'Blank = auto (need × threshold).') +
    field('Notes', '<textarea id="f_notes">' + esc(item.notes || '') + '</textarea>', '', true) +
    '</div></div><div class="modal-f">' + (isNew ? '' : '<button class="btn danger left" data-del>' + ICON('trash', 15) + 'Delete</button>') + '<button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-save>' + ICON('check', 16) + 'Save item</button></div>';
  var m = openModal(html, { wide: true });
  $('#f_cat', m).onchange = function () { $('#dl_sub', m).innerHTML = subcatsFor($('#f_cat', m).value).map(function (s) { return '<option>' + esc(s) + '</option>'; }).join(''); };

  var ue = UnitsEditor($('#f_units', m), function () { return $('#f_usys', m).value; }, item, function () {
    var inc = ue.usedUnits(), su = ue.stockUnit();
    if ($('#f_openU', m)) $('#f_openU', m).textContent = su;
    var nu = $('#f_needu', m); if (nu) { var prev = nu.value || item.needUnit || su; nu.innerHTML = opts(inc, inc.indexOf(prev) >= 0 ? prev : su); }
  });
  ue.render();
  $('#f_usys', m).onchange = function () { ue.setSystem(); };

  $all('[data-x]', m).forEach(function (b) { b.onclick = closeModal; });
  if ($('[data-del]', m)) $('[data-del]', m).onclick = function () { confirmDelete('Items', item, item.name); };
  $('[data-save]', m).onclick = function () {
    var name = $('#f_name', m).value.trim(); if (!name) { toast('Item name is required', 'err'); return; }
    var sysName = $('#f_usys', m).value, U = ue.compute();
    if (!sysName) addToList('units', U.base);
    var needU = $('#f_needu', m).value || U.stockUnit;
    var rec = Object.assign({}, item, {
      category: $('#f_cat', m).value, subcategory: $('#f_sub', m).value.trim(), name: name, brand: $('#f_brand', m).value.trim(),
      supplierId: $('#f_sup', m).value,
      unitSystem: sysName, baseUnit: U.base, stockUnit: U.stockUnit, unit: U.stockUnit, factorsJSON: JSON.stringify(U.factors),
      openingStock: num($('#f_open', m).value), unitCost: $('#f_cost', m).value.trim(),
      needQty: $('#f_needq', m).value.trim(), needUnit: needU, needPeriodMonths: monthsFromMD($('#f_needM', m).value, $('#f_needD', m).value),
      needText: ($('#f_needq', m).value.trim() ? $('#f_needq', m).value.trim() + ' ' + needU + ' / ' + fmtPeriod(monthsFromMD($('#f_needM', m).value, $('#f_needD', m).value), true) : ''),
      reorderThresholdPct: $('#f_thr', m).value.trim(), reorderLevel: $('#f_rl', m).value.trim(), notes: $('#f_notes', m).value.trim(), active: true
    });
    if (isNew) { rec.id = uid('ITM'); rec.openingDate = today(); }
    closeModal(); persist('Items', rec, isNew).then(function () { toast('Item saved', 'ok'); });
  };
}
function itemDetail(id) {
  var it = itemById(id); if (!it) return; var dd = D(id);
  var recent = S.consumption.filter(function (c) { return c.itemId === id; }).sort(function (a, b) { return (toDate(b.date) || 0) - (toDate(a.date) || 0); }).slice(0, 6);
  var sup = supplierById(it.supplierId);
  var levels = unitsOf(it);
  var html = '<div class="modal-h">' + ICON('box', 20) + '<h3>' + esc(it.name) + '</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div><div class="modal-b"><div class="row" style="margin-bottom:14px">' + pill(dd.status) + '<span class="chip">' + esc(it.category) + ' · ' + esc(it.subcategory || '—') + '</span>' + (it.brand ? '<span class="chip">' + esc(it.brand) + '</span>' : '') + '</div>' +
    '<div class="kpis" style="margin-bottom:14px">' + kpi('Current stock', fmtNum(dd.current) + ' <span class="muted" style="font-size:14px">' + esc(dd.su) + '</span>', '', '') + kpi('Reorder at', fmtNum(dd.reorderLevel) + ' ' + esc(dd.su), '', '') + kpi('Use / month', fmtNum(dd.actualRate), 'actual, from counts', '') + kpi('Days cover', dd.daysCover != null ? fmtPeriod(dd.daysCover / 30, false) : '—', '', '') + '</div>' +
    '<div class="chart-box" style="box-shadow:none;margin-bottom:14px"><h3>Consumption — last 6 months</h3><div class="csub">In ' + esc(dd.su) + ', from your counts</div>' + barChartSVG(monthlyConsumption(id, 6), { color: 'var(--s1)' }) + '</div>' +
    detailRows([
      ['Units', levels.length > 1 ? levels.map(function (u) { return u + ' (=' + fmtNum(unitFactor(it, u)) + ' ' + baseUnitOf(it) + ')'; }).join(', ') : dd.su],
      ['Need', needStr(it, false)],
      ['Actual rate', dd.actualRate ? fmtNum(dd.actualRate) + ' ' + dd.su + '/mo' : '—'],
      ['Suggested order', dd.suggestedBase ? qtyDisp(it, dd.suggestedBase) : 'none'],
      ['Unit cost', dd.price ? money(dd.price) + ' / ' + dd.su : '—'],
      ['Stock value', money(dd.value)],
      ['Preferred supplier', sup ? esc(sup.name) : '—'],
      ['Next order (supplier)', it.supplierId && nextOrderDateFor(it.supplierId) ? fmtDate(nextOrderDateFor(it.supplierId)) : '—'],
      ['Last counted', fmtDate(dd.lastCount) + ' (' + relDays(dd.lastCount) + ')'],
      ['Notes', it.notes ? esc(it.notes) : '—']
    ]);
  if (recent.length) { html += '<div class="section-title mt16">Recent entries</div><div class="cards-list">'; recent.forEach(function (c) { var u = c.unit || dd.su; var label = c.mode === 'used' ? 'Used ' + fmtNum(c.value) : c.mode === 'added' ? 'Added ' + fmtNum(c.value) : 'Counted ' + fmtNum(c.value) + ' left'; html += '<div class="rowcard" style="cursor:default;padding:9px 12px"><div class="rc-top"><div class="grow item-meta">' + esc(label) + ' ' + esc(u) + ' · ' + esc(c.enteredBy || '') + '</div><span class="chip">' + fmtDateShort(c.date) + '</span></div></div>'; }); html += '</div>'; }
  html += '</div><div class="modal-f"><button class="btn danger left" data-del>' + ICON('trash', 15) + 'Delete</button><button class="btn" data-rec>' + ICON('record', 15) + 'Record</button><button class="btn primary" data-edit>' + ICON('edit', 15) + 'Edit</button></div>';
  var m = openModal(html, { wide: true });
  $('[data-x]', m).onclick = closeModal; $('[data-edit]', m).onclick = function () { closeModal(); itemForm(it); }; $('[data-rec]', m).onclick = function () { closeModal(); consumptionForm(it); }; $('[data-del]', m).onclick = function () { confirmDelete('Items', it, it.name); };
  wireCharts(m);
}

/* ---- CONSUMPTION (single) — filtered to current sub-tab ---- */
function consumptionForm(item, existing) {
  var isNew = !existing;
  var cat = item ? item.category : (existing ? (itemById(existing.itemId) || {}).category : S.sub) || S.sub;
  var its = itemsIn(cat).sort(by('name'));
  if (!its.length) { toast('No items in ' + cat, 'warn'); return; }
  var selId = item ? item.id : (existing ? existing.itemId : its[0].id);
  var selItem = itemById(selId) || its[0];
  var users = listVal('users');
  var html = '<div class="modal-h">' + ICON('record', 20) + '<h3>' + (isNew ? 'Record consumption' : 'Edit entry') + ' — ' + esc(cat) + '</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div><div class="modal-b"><div class="form-grid">' +
    field('Item', '<select id="c_item">' + its.map(function (i) { return '<option value="' + esc(i.id) + '"' + (i.id === selId ? ' selected' : '') + '>' + esc(i.name) + '</option>'; }).join('') + '</select>', 'Only ' + esc(cat) + ' items (matches the tab).', true) +
    field('What are you recording?', '<select id="c_mode"><option value="left"' + (existing && existing.mode === 'left' ? ' selected' : '') + '>How many are LEFT (count)</option><option value="used"' + (existing && existing.mode === 'used' ? ' selected' : '') + '>How many were USED</option><option value="added"' + (existing && existing.mode === 'added' ? ' selected' : '') + '>How many ADDED (correction)</option></select>', '', true) +
    field('Quantity', '<input id="c_val" type="number" inputmode="decimal" value="' + esc(existing ? existing.value : '') + '">') +
    field('Unit', '<select id="c_unit"></select>') +
    field('Date', '<input id="c_date" type="date" value="' + esc(existing ? ymd(existing.date) : today()) + '">') +
    field('Entered by', '<input id="c_by" list="dl_users" value="' + esc(existing ? existing.enteredBy : S.user) + '"><datalist id="dl_users">' + users.map(function (u) { return '<option>' + esc(u) + '</option>'; }).join('') + '</datalist>') +
    field('Note', '<input id="c_note" value="' + esc(existing ? existing.note : '') + '">', '', true) +
    '</div><div class="hint" id="c_preview" style="margin-top:12px"></div></div><div class="modal-f">' + (isNew ? '' : '<button class="btn danger left" data-del>' + ICON('trash', 15) + 'Delete</button>') + '<button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-save>' + ICON('check', 16) + 'Save</button></div>';
  var m = openModal(html);
  function fillUnits() { var it = itemById($('#c_item', m).value) || selItem; var levels = unitsOf(it); var prev = ($('#c_unit', m).value) || (existing && existing.unit) || stockUnitOf(it); $('#c_unit', m).innerHTML = opts(levels, levels.indexOf(prev) >= 0 ? prev : stockUnitOf(it)); }
  function preview() {
    var it = itemById($('#c_item', m).value); if (!it) return; var dd = D(it.id), mode = $('#c_mode', m).value, u = $('#c_unit', m).value || stockUnitOf(it), valBase = toBase(it, num($('#c_val', m).value), u);
    var msg = 'System shows ' + qtyDisp(it, dd.currentBase) + '. ';
    if (mode === 'left') msg += 'After: ' + qtyDisp(it, valBase) + ' (consumed ' + qtyDisp(it, Math.max(0, dd.currentBase - valBase)) + ').';
    else if (mode === 'used') msg += 'After: ' + qtyDisp(it, Math.max(0, dd.currentBase - valBase)) + '.';
    else msg += 'After: ' + qtyDisp(it, dd.currentBase + valBase) + '.';
    $('#c_preview', m).textContent = msg;
  }
  $('#c_item', m).onchange = function () { fillUnits(); preview(); };
  ['c_mode', 'c_val', 'c_unit'].forEach(function (id) { $('#' + id, m).addEventListener('input', preview); });
  fillUnits(); preview();
  $all('[data-x]', m).forEach(function (b) { b.onclick = closeModal; });
  if ($('[data-del]', m)) $('[data-del]', m).onclick = function () { confirmDelete('Consumption', existing, 'this entry'); };
  $('[data-save]', m).onclick = function () {
    var it = itemById($('#c_item', m).value); if (!it) { toast('Pick an item', 'err'); return; }
    if ($('#c_val', m).value === '') { toast('Enter a quantity', 'err'); return; }
    if (!S.user && !$('#c_by', m).value.trim()) { askUser(); return; }
    var mode = $('#c_mode', m).value, u = $('#c_unit', m).value || stockUnitOf(it), val = num($('#c_val', m).value), dd = D(it.id), valBase = toBase(it, val, u);
    var rec = Object.assign({}, existing || {}, { itemId: it.id, mode: mode, value: val, unit: u, date: $('#c_date', m).value || today(), enteredBy: $('#c_by', m).value.trim() || S.user, note: $('#c_note', m).value.trim(), prevStock: fromBase(it, dd.currentBase, u), consumed: mode === 'left' ? Math.max(0, round(fromBase(it, dd.currentBase, u) - val, 2)) : mode === 'used' ? val : 0, newStock: mode === 'left' ? val : mode === 'used' ? Math.max(0, fromBase(it, dd.currentBase, u) - val) : fromBase(it, dd.currentBase, u) + val });
    if (isNew) { rec.id = uid('CON'); rec.createdAt = new Date().toISOString(); }
    addToList('users', rec.enteredBy);
    closeModal(); persist('Consumption', rec, isNew).then(function () { toast('Recorded', 'ok'); });
  };
}
function consumptionDetail(cid) { var c = S.consumption.filter(function (x) { return x.id === cid; })[0]; if (c) consumptionForm(null, c); }

/* ---- SUPPLIER (with order frequency) ---- */
function supplierForm(sup) {
  var isNew = !sup; sup = sup || { category: 'Both', active: true };
  var fm = Math.floor(num(sup.orderFrequencyMonths || 0)); var fd = Math.round((num(sup.orderFrequencyMonths || 0) - fm) * 30);
  var html = '<div class="modal-h">' + ICON('suppliers', 20) + '<h3>' + (isNew ? 'Add supplier' : 'Edit supplier') + '</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div><div class="modal-b"><div class="form-grid">' +
    field('Firm / shop name', '<input id="s_name" value="' + esc(sup.name || '') + '">', '', true) +
    field('Contact person', '<input id="s_contact" value="' + esc(sup.contactPerson || '') + '">') +
    field('Phone', '<input id="s_phone" value="' + esc(sup.phone || '') + '">') +
    field('Email', '<input id="s_email" value="' + esc(sup.email || '') + '">') +
    field('GSTIN', '<input id="s_gst" value="' + esc(sup.gstin || '') + '">') +
    field('Supplies', '<select id="s_cat">' + opts(['Both', 'Stationery', 'Pantry'], sup.category || 'Both') + '</select>') +
    field('Order frequency — Months', '<input id="s_fm" type="number" inputmode="numeric" value="' + esc(fm) + '">', 'How often you place an order with them.') +
    field('Order frequency — Days', '<input id="s_fd" type="number" inputmode="numeric" value="' + esc(fd) + '">') +
    field('Address', '<textarea id="s_addr">' + esc(sup.address || '') + '</textarea>', '', true) +
    field('Notes', '<textarea id="s_notes">' + esc(sup.notes || '') + '</textarea>', '', true) +
    '</div></div><div class="modal-f">' + (isNew ? '' : '<button class="btn danger left" data-del>' + ICON('trash', 15) + 'Delete</button>') + '<button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-save>' + ICON('check', 16) + 'Save</button></div>';
  var m = openModal(html);
  $all('[data-x]', m).forEach(function (b) { b.onclick = closeModal; });
  if ($('[data-del]', m)) $('[data-del]', m).onclick = function () { confirmDelete('Suppliers', sup, sup.name); };
  $('[data-save]', m).onclick = function () {
    var name = $('#s_name', m).value.trim(); if (!name) { toast('Name is required', 'err'); return; }
    var rec = Object.assign({}, sup, { name: name, contactPerson: $('#s_contact', m).value.trim(), phone: $('#s_phone', m).value.trim(), email: $('#s_email', m).value.trim(), gstin: $('#s_gst', m).value.trim(), category: $('#s_cat', m).value, orderFrequencyMonths: monthsFromMD($('#s_fm', m).value, $('#s_fd', m).value), address: $('#s_addr', m).value.trim(), notes: $('#s_notes', m).value.trim(), active: true });
    if (isNew) rec.id = uid('SUP');
    closeModal(); persist('Suppliers', rec, isNew).then(function () { toast('Supplier saved', 'ok'); });
  };
}
function supplierDetail(sid) {
  var s = supplierById(sid); if (!s) return;
  var orders = S.orders.filter(function (o) { return o.supplierId === sid; }).sort(function (a, b) { return (toDate(b.date) || 0) - (toDate(a.date) || 0); });
  var spend = orders.filter(function (o) { return o.status === 'Received'; }).reduce(function (a, o) { return a + num(o.total); }, 0);
  var next = nextOrderDateFor(sid);
  var itemsFrom = S.items.filter(function (it) { return it.supplierId === sid && String(it.active) !== 'false'; });
  var html = '<div class="modal-h">' + ICON('suppliers', 20) + '<h3>' + esc(s.name) + '</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div><div class="modal-b">' +
    detailRows([['Contact', s.contactPerson || '—'], ['Phone', s.phone || '—'], ['Email', s.email || '—'], ['GSTIN', s.gstin || '—'], ['Supplies', s.category || 'Both'], ['Order frequency', s.orderFrequencyMonths ? fmtPeriod(s.orderFrequencyMonths, false) : '—'], ['Next order due', next ? fmtDate(next) : '—'], ['Items sourced here', itemsFrom.length], ['Total orders', orders.length], ['Received spend', money(spend)], ['Address', s.address ? esc(s.address) : '—'], ['Notes', s.notes ? esc(s.notes) : '—']]);
  if (orders.length) { html += '<div class="section-title mt16">Order history</div><div class="cards-list">'; orders.slice(0, 10).forEach(function (o) { html += '<div class="rowcard" data-oid="' + esc(o.id) + '"><div class="rc-top"><div class="grow item-meta">' + fmtDate(o.date) + ' · ' + parseLines(o.linesJSON).length + ' item(s)</div><div class="right"><b>' + money(o.total) + '</b> ' + orderBadge(o.status) + '</div></div></div>'; }); html += '</div>'; }
  html += '</div><div class="modal-f"><button class="btn danger left" data-del>' + ICON('trash', 15) + 'Delete</button><button class="btn primary" data-edit>' + ICON('edit', 15) + 'Edit</button></div>';
  var m = openModal(html);
  $('[data-x]', m).onclick = closeModal; $('[data-edit]', m).onclick = function () { closeModal(); supplierForm(s); }; $('[data-del]', m).onclick = function () { confirmDelete('Suppliers', s, s.name); };
  $all('[data-oid]', m).forEach(function (r) { r.onclick = function () { closeModal(); orderDetail(r.dataset.oid); }; });
}

/* ---- ORDER (unit per line, IST dates) ---- */
function orderForm(order, presetLines) {
  var isNew = !order;
  order = order || { date: today(), status: 'Ordered', taxPct: 0, delivery: 0, discount: 0, orderedBy: S.user };
  var lines = (presetLines || parseLines(order.linesJSON)).map(function (l) { return Object.assign({}, l); });
  if (!lines.length) lines = [{ itemId: '', unit: '', qty: '', unitPrice: '', amount: '' }];
  var sups = S.suppliers.slice().sort(by('name'));
  var its = S.items.filter(function (i) { return String(i.active) !== 'false'; }).sort(by('name'));
  var html = '<div class="modal-h">' + ICON('orders', 20) + '<h3>' + (isNew ? 'New order' : 'Edit order') + '</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div><div class="modal-b"><div class="form-grid">' +
    field('Supplier', '<select id="o_sup"><option value="">— select —</option>' + sups.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === order.supplierId ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '<option value="__new">+ Add new supplier…</option></select>') +
    field('Status', '<select id="o_status">' + opts(['Draft', 'Ordered', 'Received', 'Cancelled'], order.status || 'Ordered') + '</select>', 'Marking “Received” adds quantities to stock.') +
    field('Order date', '<input id="o_date" type="date" value="' + esc(ymd(order.date) || today()) + '">') +
    field('Received date', '<input id="o_recv" type="date" value="' + esc(ymd(order.receivedDate) || '') + '">', 'Can be the same as order date.') +
    field('Invoice / bill no.', '<input id="o_inv" value="' + esc(order.invoiceNo || '') + '">') +
    field('Ordered by', '<input id="o_by" value="' + esc(order.orderedBy || S.user) + '">') +
    '</div><div class="section-title mt16">Items</div><div class="table-wrap" style="box-shadow:none"><table class="lines-tbl"><thead><tr><th style="min-width:150px">Item</th><th style="width:70px">Unit</th><th style="width:64px">Qty</th><th style="width:84px">Price</th><th style="width:84px" class="num">Amount</th><th style="width:34px"></th></tr></thead><tbody id="o_lines"></tbody></table></div><button class="btn sm mt8" id="o_addline">' + ICON('plus', 14) + 'Add line</button>' +
    '<div class="form-grid mt16">' + field('Tax / GST %', '<input id="o_tax" type="number" inputmode="decimal" value="' + esc(order.taxPct || 0) + '">') + field('Delivery (' + cur() + ')', '<input id="o_deliv" type="number" inputmode="decimal" value="' + esc(order.delivery || 0) + '">') + field('Discount (' + cur() + ')', '<input id="o_disc" type="number" inputmode="decimal" value="' + esc(order.discount || 0) + '">') + field('Notes', '<input id="o_notes" value="' + esc(order.notes || '') + '">') + '</div><div class="card mt16" style="box-shadow:none"><div class="card-b" id="o_totals" style="padding:10px 16px"></div></div></div>' +
    '<div class="modal-f">' + (isNew ? '' : '<button class="btn danger left" data-del>' + ICON('trash', 15) + 'Delete</button>') + '<button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-save>' + ICON('check', 16) + 'Save order</button></div>';
  var m = openModal(html, { wide: true });

  function unitOptsFor(it, sel) { var levels = it ? unitsOf(it) : []; if (!levels.length) return '<option value="">—</option>'; return levels.map(function (u) { return '<option' + (u === sel ? ' selected' : '') + '>' + esc(u) + '</option>'; }).join(''); }
  function lineRow(ln, i) {
    var it = itemById(ln.itemId);
    return '<tr data-li="' + i + '"><td><select class="ln-item" data-i="' + i + '"><option value="">— item —</option>' + its.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === ln.itemId ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></td>' +
      '<td><select class="ln-unit" data-i="' + i + '">' + unitOptsFor(it, ln.unit || (it ? stockUnitOf(it) : '')) + '</select></td>' +
      '<td><input class="ln-qty" data-i="' + i + '" type="number" inputmode="decimal" value="' + esc(ln.qty) + '"></td>' +
      '<td><input class="ln-price" data-i="' + i + '" type="number" inputmode="decimal" value="' + esc(ln.unitPrice) + '"></td>' +
      '<td class="num ln-amt">' + money(num(ln.qty) * num(ln.unitPrice)) + '</td>' +
      '<td><button class="iconbtn" data-rm="' + i + '" style="width:30px;height:30px">' + ICON('x', 15) + '</button></td></tr>';
  }
  function drawLines() {
    $('#o_lines', m).innerHTML = lines.map(lineRow).join('');
    $all('.ln-item', m).forEach(function (s) { s.onchange = function () { var i = +s.dataset.i; lines[i].itemId = s.value; var it = itemById(s.value); if (it) { lines[i].name = it.name; lines[i].unit = stockUnitOf(it); if (!num(lines[i].unitPrice) && D(it.id).price) lines[i].unitPrice = round(D(it.id).price, 2); } drawLines(); calc(); }; });
    $all('.ln-unit', m).forEach(function (s) { s.onchange = function () { lines[+s.dataset.i].unit = s.value; calc(); }; });
    $all('.ln-qty', m).forEach(function (inp) { inp.oninput = function () { lines[+inp.dataset.i].qty = inp.value; updateAmt(+inp.dataset.i); calc(); }; });
    $all('.ln-price', m).forEach(function (inp) { inp.oninput = function () { lines[+inp.dataset.i].unitPrice = inp.value; updateAmt(+inp.dataset.i); calc(); }; });
    $all('[data-rm]', m).forEach(function (b) { b.onclick = function () { lines.splice(+b.dataset.rm, 1); if (!lines.length) lines.push({ itemId: '', unit: '', qty: '', unitPrice: '' }); drawLines(); calc(); }; });
  }
  function updateAmt(i) { var tr = $('[data-li="' + i + '"]', m); if (tr) $('.ln-amt', tr).textContent = money(num(lines[i].qty) * num(lines[i].unitPrice)); }
  function calc() { var sub = lines.reduce(function (a, ln) { return a + num(ln.qty) * num(ln.unitPrice); }, 0); var tax = sub * num($('#o_tax', m).value) / 100; var total = sub + tax + num($('#o_deliv', m).value) - num($('#o_disc', m).value); $('#o_totals', m).innerHTML = '<div class="detail-row"><span class="k">Subtotal</span><span class="v">' + money(sub) + '</span></div><div class="detail-row"><span class="k">Tax</span><span class="v">' + money(tax) + '</span></div><div class="detail-row"><span class="k">Grand total</span><span class="v" style="font-size:17px;color:var(--accent)">' + money(total) + '</span></div>'; m._total = total; m._sub = sub; m._tax = tax; }
  drawLines(); calc();
  $('#o_addline', m).onclick = function () { lines.push({ itemId: '', unit: '', qty: '', unitPrice: '' }); drawLines(); };
  ['o_tax', 'o_deliv', 'o_disc'].forEach(function (id) { $('#' + id, m).oninput = calc; });
  $('#o_sup', m).onchange = function () { if ($('#o_sup', m).value === '__new') { closeModal(); supplierForm(); } };
  $all('[data-x]', m).forEach(function (b) { b.onclick = closeModal; });
  if ($('[data-del]', m)) $('[data-del]', m).onclick = function () { confirmDelete('Orders', order, 'this order'); };
  $('[data-save]', m).onclick = function () {
    var clean = lines.filter(function (ln) { return ln.itemId && num(ln.qty) > 0; }).map(function (ln) { var it = itemById(ln.itemId); return { itemId: ln.itemId, name: it ? it.name : ln.name, unit: ln.unit || (it ? stockUnitOf(it) : ''), qty: num(ln.qty), unitPrice: num(ln.unitPrice), amount: num(ln.qty) * num(ln.unitPrice) }; });
    if (!clean.length) { toast('Add at least one item with quantity', 'err'); return; }
    var supId = $('#o_sup', m).value === '__new' ? '' : $('#o_sup', m).value, sup = supplierById(supId), status = $('#o_status', m).value;
    var rec = Object.assign({}, order, { date: $('#o_date', m).value || today(), status: status, supplierId: supId, supplierName: sup ? sup.name : (order.supplierName || ''), linesJSON: JSON.stringify(clean), subtotal: m._sub, taxPct: num($('#o_tax', m).value), taxAmt: m._tax, delivery: num($('#o_deliv', m).value), discount: num($('#o_disc', m).value), total: m._total, invoiceNo: $('#o_inv', m).value.trim(), notes: $('#o_notes', m).value.trim(), orderedBy: $('#o_by', m).value.trim() || S.user, receivedDate: $('#o_recv', m).value || (status === 'Received' ? today() : (order.receivedDate || '')) });
    if (isNew) rec.id = uid('ORD');
    closeModal(); persist('Orders', rec, isNew).then(function () { toast('Order saved' + (status === 'Received' ? ' & added to stock' : ''), 'ok'); });
  };
}
/* ---- ORDER BUILDER: creates one order PER supplier, items grouped ---- */
function orderBuilder(seedLines) {
  var its = S.items.filter(function (i) { return String(i.active) !== 'false'; }).sort(by('name'));
  var sups = S.suppliers.slice().sort(by('name'));
  var lines = (seedLines && seedLines.length ? seedLines : [{ itemId: '', qty: '', unitPrice: '' }]).map(function (l) {
    var it = itemById(l.itemId);
    return { itemId: l.itemId || '', name: l.name || (it ? it.name : ''), unit: l.unit || (it ? stockUnitOf(it) : ''), qty: l.qty != null ? l.qty : '', unitPrice: l.unitPrice != null ? l.unitPrice : (it && D(it.id).price ? round(D(it.id).price, 2) : ''), supplierId: l.supplierId != null ? l.supplierId : (it ? (it.supplierId || '') : '') };
  });
  var html = '<div class="modal-h">' + ICON('orders', 20) + '<h3>New order(s)</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div><div class="modal-b">' +
    '<div class="hint" style="margin-top:0">Items are grouped by their supplier — <b>one order is created per supplier</b>. Change any item\'s supplier below (individually, or tick several and use “Assign selected”).</div>' +
    '<div class="form-grid mt16">' +
    field('Status (all)', '<select id="ob_status">' + opts(['Draft', 'Ordered', 'Received', 'Cancelled'], 'Ordered') + '</select>', 'Received adds quantities to stock.') +
    field('Order date (all)', '<input id="ob_date" type="date" value="' + today() + '">') +
    field('Received date', '<input id="ob_recv" type="date">', 'Used only if status is Received.') +
    field('Notes (all)', '<input id="ob_notes">') +
    '</div>' +
    '<div class="row mt16" style="align-items:center;gap:8px"><button class="btn sm" id="ob_add">' + ICON('plus', 14) + 'Add item</button><span style="flex:1"></span><span class="hint" style="margin:0">Assign ticked to:</span><select id="ob_bulksup" style="width:auto;min-width:150px"><option value="">— supplier —</option>' + sups.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('') + '<option value="__none">(no supplier)</option></select><button class="btn sm" id="ob_assign">Assign selected</button></div>' +
    '<div id="ob_groups"></div>' +
    '<div class="card mt16" style="box-shadow:none"><div class="card-b" id="ob_foot" style="padding:10px 16px"></div></div>' +
    '</div><div class="modal-f"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok></button></div>';
  var m = openModal(html, { wide: true });

  function unitOpts(it, sel) { var lv = it ? unitsOf(it) : []; if (!lv.length) return '<option value="">—</option>'; return lv.map(function (u) { return '<option' + (u === sel ? ' selected' : '') + '>' + esc(u) + '</option>'; }).join(''); }
  function supOpts(sel) { return '<option value="">— none —</option>' + sups.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === sel ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join(''); }
  function lineRow(i) {
    var ln = lines[i], it = itemById(ln.itemId);
    return '<tr data-li="' + i + '"><td><input type="checkbox" class="ob_sel" data-i="' + i + '" style="width:auto"></td>' +
      '<td><select class="ob_item" data-i="' + i + '"><option value="">— item —</option>' + its.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === ln.itemId ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></td>' +
      '<td><select class="ob_unit" data-i="' + i + '">' + unitOpts(it, ln.unit) + '</select></td>' +
      '<td><input class="ob_qty" data-i="' + i + '" type="number" inputmode="decimal" value="' + esc(ln.qty) + '"></td>' +
      '<td><input class="ob_price" data-i="' + i + '" type="number" inputmode="decimal" value="' + esc(ln.unitPrice) + '"></td>' +
      '<td class="num ob_amt">' + money(num(ln.qty) * num(ln.unitPrice)) + '</td>' +
      '<td><select class="ob_sup" data-i="' + i + '">' + supOpts(ln.supplierId) + '</select></td>' +
      '<td><button class="iconbtn" data-rm="' + i + '" style="width:30px;height:30px">' + ICON('x', 15) + '</button></td></tr>';
  }
  function groupsOf() { var g = {}; lines.forEach(function (ln, i) { (g[ln.supplierId || ''] = g[ln.supplierId || ''] || []).push(i); }); return g; }
  function draw() {
    var g = groupsOf(), keys = Object.keys(g).sort(function (a, b) { if (a === '') return 1; if (b === '') return -1; var an = (supplierById(a) || {}).name || '', bn = (supplierById(b) || {}).name || ''; return an.toLowerCase() < bn.toLowerCase() ? -1 : 1; });
    var html = '';
    keys.forEach(function (k) {
      var sname = k ? ((supplierById(k) || {}).name || 'Unknown') : 'Unassigned';
      html += '<div class="section-title mt16" style="text-transform:none;letter-spacing:0;font-size:13px;display:flex;justify-content:space-between;align-items:center"><span>' + ICON('suppliers', 14) + ' ' + esc(sname) + ' · ' + g[k].length + ' item(s)</span><span class="tabnum" id="gsub_' + cssid(k || 'none') + '"></span></div>' +
        '<div class="table-wrap" style="box-shadow:none"><table class="lines-tbl"><thead><tr><th style="width:24px"></th><th style="min-width:130px">Item</th><th style="width:62px">Unit</th><th style="width:58px">Qty</th><th style="width:74px">Price</th><th style="width:74px" class="num">Amount</th><th style="width:130px">Supplier</th><th style="width:30px"></th></tr></thead><tbody>' +
        g[k].map(function (i) { return lineRow(i); }).join('') + '</tbody></table></div>';
    });
    $('#ob_groups', m).innerHTML = html;
    $all('.ob_item', m).forEach(function (s) { s.onchange = function () { var i = +s.dataset.i; lines[i].itemId = s.value; var it = itemById(s.value); if (it) { lines[i].name = it.name; lines[i].unit = stockUnitOf(it); if (!num(lines[i].unitPrice) && D(it.id).price) lines[i].unitPrice = round(D(it.id).price, 2); if (!lines[i].supplierId) lines[i].supplierId = it.supplierId || ''; } draw(); }; });
    $all('.ob_unit', m).forEach(function (s) { s.onchange = function () { lines[+s.dataset.i].unit = s.value; totals(); }; });
    $all('.ob_sup', m).forEach(function (s) { s.onchange = function () { lines[+s.dataset.i].supplierId = s.value; draw(); }; });
    $all('.ob_qty', m).forEach(function (inp) { inp.oninput = function () { lines[+inp.dataset.i].qty = inp.value; rowAmt(+inp.dataset.i); totals(); }; });
    $all('.ob_price', m).forEach(function (inp) { inp.oninput = function () { lines[+inp.dataset.i].unitPrice = inp.value; rowAmt(+inp.dataset.i); totals(); }; });
    $all('[data-rm]', m).forEach(function (b) { b.onclick = function () { lines.splice(+b.dataset.rm, 1); if (!lines.length) lines.push({ itemId: '', qty: '', unitPrice: '', supplierId: '' }); draw(); }; });
    totals();
  }
  function rowAmt(i) { var tr = $('[data-li="' + i + '"]', m); if (tr) $('.ob_amt', tr).textContent = money(num(lines[i].qty) * num(lines[i].unitPrice)); }
  function totals() {
    var g = groupsOf(), grand = 0, nOrders = 0;
    Object.keys(g).forEach(function (k) { var sub = g[k].reduce(function (a, i) { return a + num(lines[i].qty) * num(lines[i].unitPrice); }, 0); grand += sub; var costed = g[k].some(function (i) { return lines[i].itemId && num(lines[i].qty) > 0; }); if (costed) nOrders++; var el = $('#gsub_' + cssid(k || 'none'), m); if (el) el.textContent = money(sub); });
    $('#ob_foot', m).innerHTML = '<div class="detail-row"><span class="k">Suppliers (orders to create)</span><span class="v">' + nOrders + '</span></div><div class="detail-row"><span class="k">Grand total</span><span class="v" style="font-size:17px;color:var(--accent)">' + money(grand) + '</span></div>';
    $('[data-ok]', m).textContent = 'Create ' + nOrders + ' order' + (nOrders === 1 ? '' : 's');
  }
  draw();
  $('#ob_add', m).onclick = function () { lines.push({ itemId: '', qty: '', unitPrice: '', supplierId: '' }); draw(); };
  $('#ob_assign', m).onclick = function () { var sup = $('#ob_bulksup', m).value; if (!sup) { toast('Pick a supplier to assign', 'warn'); return; } var any = false; $all('.ob_sel', m).forEach(function (cb) { if (cb.checked) { lines[+cb.dataset.i].supplierId = (sup === '__none' ? '' : sup); any = true; } }); if (!any) { toast('Tick some items first', 'warn'); return; } draw(); };
  $all('[data-x]', m).forEach(function (b) { b.onclick = closeModal; });
  $('[data-ok]', m).onclick = function () {
    var status = $('#ob_status', m).value, odate = $('#ob_date', m).value || today(), recv = $('#ob_recv', m).value, notes = $('#ob_notes', m).value.trim();
    var g = {}; lines.forEach(function (ln) { if (!ln.itemId || !(num(ln.qty) > 0)) return; (g[ln.supplierId || ''] = g[ln.supplierId || ''] || []).push(ln); });
    var keys = Object.keys(g); if (!keys.length) { toast('Add at least one item with quantity', 'err'); return; }
    var orders = keys.map(function (k) {
      var gl = g[k].map(function (ln) { var it = itemById(ln.itemId); return { itemId: ln.itemId, name: it ? it.name : ln.name, unit: ln.unit || (it ? stockUnitOf(it) : ''), qty: num(ln.qty), unitPrice: num(ln.unitPrice), amount: num(ln.qty) * num(ln.unitPrice) }; });
      var sub = gl.reduce(function (a, l) { return a + l.amount; }, 0), sup = supplierById(k);
      return { id: uid('ORD'), date: odate, status: status, supplierId: k, supplierName: sup ? sup.name : '', linesJSON: JSON.stringify(gl), subtotal: sub, taxPct: 0, taxAmt: 0, delivery: 0, discount: 0, total: sub, invoiceNo: '', notes: notes, orderedBy: S.user, expectedDate: '', receivedDate: (status === 'Received' ? (recv || today()) : recv) };
    });
    closeModal(); persistBulk('Orders', orders).then(function () { toast('Created ' + orders.length + ' order(s)' + (status === 'Received' ? ' & added to stock' : ''), 'ok'); setTab('orders'); });
  };
}
function orderDetail(oid) {
  var o = S.orders.filter(function (x) { return x.id === oid; })[0]; if (!o) return;
  var lines = parseLines(o.linesJSON);
  var html = '<div class="modal-h">' + ICON('orders', 20) + '<h3>Order — ' + esc(o.supplierName || '') + '</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div><div class="modal-b"><div class="row" style="margin-bottom:12px">' + orderBadge(o.status) + '<span class="chip">' + fmtDate(o.date) + '</span>' + (o.invoiceNo ? '<span class="chip">' + esc(o.invoiceNo) + '</span>' : '') + '</div>' +
    '<div class="table-wrap" style="box-shadow:none;margin-bottom:12px"><table class="grid"><thead><tr><th>Item</th><th class="num">Qty</th><th>Unit</th><th class="num">Price</th><th class="num">Amount</th></tr></thead><tbody>' + lines.map(function (ln) { return '<tr><td>' + esc(ln.name || (itemById(ln.itemId) || {}).name || '—') + '</td><td class="num">' + fmtNum(ln.qty) + '</td><td>' + esc(ln.unit || '') + '</td><td class="num">' + money(ln.unitPrice) + '</td><td class="num">' + money(ln.amount) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
    detailRows([['Supplier', o.supplierName || '—'], ['Subtotal', money(o.subtotal)], ['Tax (' + fmtNum(o.taxPct) + '%)', money(o.taxAmt)], ['Delivery', money(o.delivery)], ['Discount', '-' + money(o.discount)], ['Grand total', '<b style="color:var(--accent)">' + money(o.total) + '</b>'], ['Order date', fmtDate(o.date)], ['Received on', o.status === 'Received' ? fmtDate(o.receivedDate) : '—'], ['Ordered by', o.orderedBy || '—'], ['Notes', o.notes ? esc(o.notes) : '—']]);
  var stageBtn = '';
  if (o.status === 'Draft') stageBtn = '<button class="btn" data-stage="Ordered">' + ICON('check', 15) + 'Mark Ordered</button>';
  else if (o.status === 'Ordered') stageBtn = '<button class="btn" data-stage="Received">' + ICON('check', 15) + 'Mark Received</button>';
  html += '</div><div class="modal-f"><button class="btn danger left" data-del>' + ICON('trash', 15) + 'Delete</button>' + stageBtn + '<button class="btn primary" data-edit>' + ICON('edit', 15) + 'Edit</button></div>';
  var m = openModal(html, { wide: true });
  $('[data-x]', m).onclick = closeModal; $('[data-edit]', m).onclick = function () { closeModal(); orderForm(o); }; $('[data-del]', m).onclick = function () { confirmDelete('Orders', o, 'this order'); };
  if ($('[data-stage]', m)) $('[data-stage]', m).onclick = function () {
    var to = $('[data-stage]', m).dataset.stage;
    var rec = Object.assign({}, o, { status: to });
    if (to === 'Ordered') rec.date = today();
    if (to === 'Received') rec.receivedDate = today();
    closeModal(); persist('Orders', rec, false).then(function () { toast('Marked ' + to + (to === 'Received' ? ' & added to stock' : '') + ' (today)', 'ok'); });
  };
}
function confirmDelete(entity, rec, label) {
  confirmBox({ title: 'Delete ' + esc(label) + '?', danger: true, ok: 'Delete', body: 'This permanently removes it for everyone, and its effect across the dashboard (stock, costs, analytics). This cannot be undone.', onOk: function () { closeModal(); persistDelete(entity, rec.id).then(function () { toast('Deleted', 'ok'); }); } });
}

/* =================================================================== */
/*  BULK EDIT / DELETE                                                 */
/* =================================================================== */
function fieldA(id, label, inner, hint, full) { return '<div' + (full ? ' class="full"' : '') + '><label style="display:flex;align-items:center;gap:8px;margin-bottom:5px"><input type="checkbox" class="ba" data-f="' + id + '" style="width:auto">' + esc(label) + '</label>' + inner + (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + '</div>'; }
function applied(m, id) { var cb = $('.ba[data-f="' + id + '"]', m); return !!(cb && cb.checked); }
function bulkOpen(entity, rows, labelFn) {
  if (!rows || !rows.length) { toast('Nothing to select here.', 'warn'); return; }
  var sel = {};
  function n() { var c = 0; for (var k in sel) if (sel[k]) c++; return c; }
  var listHtml = rows.map(function (r) { var l = labelFn(r); return '<label class="rowcard" style="display:flex;gap:10px;align-items:center;cursor:pointer;padding:9px 12px;box-shadow:none"><input type="checkbox" class="bk" data-id="' + esc(r.id) + '" style="width:auto"><div class="grow" style="min-width:0"><div class="item-name">' + esc(l.title) + '</div><div class="item-meta">' + esc(l.sub) + '</div></div></label>'; }).join('');
  var m = openModal('<div class="modal-h">' + ICON('overview', 20) + '<h3>Bulk — select</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div><div class="modal-b"><div class="row" style="margin-bottom:10px;align-items:center"><label style="display:flex;align-items:center;gap:8px;font-weight:600;margin:0"><input type="checkbox" id="bk_all" style="width:auto">Select all (' + rows.length + ')</label><span style="flex:1"></span><span id="bk_n" class="chip">0 selected</span></div><div class="cards-list" style="gap:6px">' + listHtml + '</div></div><div class="modal-f"><button class="btn danger left" data-del disabled>' + ICON('trash', 15) + 'Delete</button><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-edit disabled>' + ICON('edit', 15) + 'Edit</button></div>', { wide: true, sticky: true });
  function refresh() { var c = n(); $('#bk_n', m).textContent = c + ' selected'; $('[data-edit]', m).disabled = !c; $('[data-del]', m).disabled = !c; }
  $all('.bk', m).forEach(function (cb) { cb.onchange = function () { sel[cb.dataset.id] = cb.checked; refresh(); }; });
  $('#bk_all', m).onchange = function () { var v = $('#bk_all', m).checked; $all('.bk', m).forEach(function (cb) { cb.checked = v; sel[cb.dataset.id] = v; }); refresh(); };
  $all('[data-x]', m).forEach(function (b) { b.onclick = closeModal; });
  $('[data-del]', m).onclick = function () { var ids = rows.filter(function (r) { return sel[r.id]; }).map(function (r) { return r.id; }); if (!ids.length) return; confirmBox({ title: 'Delete ' + ids.length + ' record(s)?', danger: true, ok: 'Delete', body: 'Permanently removes them for everyone, and their effect across the dashboard. Cannot be undone.', onOk: function () { closeModal(); persistManyDelete(entity, ids).then(function () { toast('Deleted ' + ids.length, 'ok'); }); } }); };
  $('[data-edit]', m).onclick = function () { var recs = rows.filter(function (r) { return sel[r.id]; }); if (!recs.length) return; closeModal(); bulkEditForm(entity, recs); };
}
function bulkEditForm(entity, records) { if (entity === 'Items') return bulkEditItems(records); if (entity === 'Orders') return bulkEditOrders(records); if (entity === 'Suppliers') return bulkEditSuppliers(records); if (entity === 'Consumption') return bulkEditConsumption(records); }

function bulkEditItems(records) {
  var sups = S.suppliers.slice().sort(by('name')), sysList = unitSystems(), allSub = [];
  CATS.forEach(function (c) { subcatsFor(c).forEach(function (s) { if (allSub.indexOf(s) < 0) allSub.push(s); }); });
  var html = '<div class="modal-h">' + ICON('overview', 20) + '<h3>Bulk edit ' + records.length + ' item(s)</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div><div class="modal-b"><div class="hint" style="margin-top:0">Tick a field to apply its value to all ' + records.length + ' selected items. Unticked fields are left unchanged.</div><div class="form-grid mt16">' +
    fieldA('category', 'Category', '<select id="b_cat">' + opts(CATS, CATS[0]) + '</select>') +
    fieldA('subcategory', 'Sub-category', '<input id="b_sub" list="b_dlsub"><datalist id="b_dlsub">' + allSub.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('') + '</datalist>') +
    fieldA('brand', 'Brand', '<input id="b_brand">') +
    fieldA('supplierId', 'Preferred supplier', '<select id="b_sup"><option value="">— none —</option>' + sups.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('') + '</select>') +
    fieldA('reorderThresholdPct', 'Reorder threshold %', '<input id="b_thr" type="number">') +
    fieldA('unitCost', 'Unit cost (per stock unit)', '<input id="b_cost" type="number">') +
    fieldA('needQty', 'Need quantity', '<input id="b_needq" type="number">') +
    fieldA('needPeriod', 'Need period (M / D)', '<div class="row"><input id="b_needM" type="number" placeholder="Months" style="max-width:120px"><input id="b_needD" type="number" placeholder="Days" style="max-width:120px"></div>') +
    fieldA('active', 'Active', '<select id="b_active"><option value="true">Active</option><option value="false">Inactive</option></select>') +
    fieldA('notes', 'Notes', '<input id="b_notes">', null, true) +
    '</div><div class="section-title mt16"><label style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:13px"><input type="checkbox" class="ba" data-f="units" style="width:auto">Set up units for all selected</label></div><div id="b_unitsblock" style="opacity:.45;pointer-events:none"><div class="form-grid">' + field('Unit system', '<select id="b_usys"><option value="">Single unit</option>' + sysList.map(function (s) { return '<option>' + esc(s.name) + '</option>'; }).join('') + '</select>') + '</div><div id="b_units"></div><div class="form-grid mt8">' + field('Need unit', '<select id="b_needu"><option value="">— use stock unit —</option></select>') + '</div></div></div><div class="modal-f"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>Apply to ' + records.length + '</button></div>';
  var m = openModal(html, { wide: true });
  var ue = UnitsEditor($('#b_units', m), function () { return $('#b_usys', m).value; }, {}, function () { var inc = ue.usedUnits(), nu = $('#b_needu', m); if (nu) { var prev = nu.value; nu.innerHTML = '<option value="">— use stock unit —</option>' + inc.map(function (u) { return '<option' + (u === prev ? ' selected' : '') + '>' + esc(u) + '</option>'; }).join(''); } });
  ue.render(); $('#b_usys', m).onchange = function () { ue.setSystem(); };
  var ucb = $('.ba[data-f="units"]', m); ucb.onchange = function () { var b = $('#b_unitsblock', m); b.style.opacity = ucb.checked ? '1' : '.45'; b.style.pointerEvents = ucb.checked ? 'auto' : 'none'; };
  $all('[data-x]', m).forEach(function (b) { b.onclick = closeModal; });
  $('[data-ok]', m).onclick = function () {
    var patch = {};
    if (applied(m, 'category')) patch.category = $('#b_cat', m).value;
    if (applied(m, 'subcategory')) patch.subcategory = $('#b_sub', m).value.trim();
    if (applied(m, 'brand')) patch.brand = $('#b_brand', m).value.trim();
    if (applied(m, 'supplierId')) patch.supplierId = $('#b_sup', m).value;
    if (applied(m, 'reorderThresholdPct')) patch.reorderThresholdPct = $('#b_thr', m).value.trim();
    if (applied(m, 'unitCost')) patch.unitCost = $('#b_cost', m).value.trim();
    if (applied(m, 'needQty')) patch.needQty = $('#b_needq', m).value.trim();
    if (applied(m, 'needPeriod')) patch.needPeriodMonths = monthsFromMD($('#b_needM', m).value, $('#b_needD', m).value);
    if (applied(m, 'active')) patch.active = $('#b_active', m).value;
    if (applied(m, 'notes')) patch.notes = $('#b_notes', m).value.trim();
    var unitsOn = applied(m, 'units'), U = unitsOn ? ue.compute() : null, needuSel = unitsOn ? $('#b_needu', m).value : '';
    if (!Object.keys(patch).length && !unitsOn) { toast('Tick at least one field to apply.', 'warn'); return; }
    var recs = records.map(function (r) {
      var it = Object.assign({}, r, patch);
      if (unitsOn) { it.unitSystem = $('#b_usys', m).value; it.baseUnit = U.base; it.stockUnit = U.stockUnit; it.unit = U.stockUnit; it.factorsJSON = JSON.stringify(U.factors); it.needUnit = needuSel || U.stockUnit; }
      if (applied(m, 'needQty') || applied(m, 'needPeriod') || unitsOn) it.needText = (it.needQty ? it.needQty + ' ' + (it.needUnit || stockUnitOf(it)) + ' / ' + fmtPeriod(it.needPeriodMonths, true) : '');
      return it;
    });
    closeModal(); persistManyUpdate('Items', recs).then(function () { toast('Updated ' + recs.length + ' item(s)', 'ok'); });
  };
}
function bulkEditOrders(records) {
  var sups = S.suppliers.slice().sort(by('name'));
  var html = '<div class="modal-h">' + ICON('orders', 20) + '<h3>Bulk edit ' + records.length + ' order(s)</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div><div class="modal-b"><div class="hint" style="margin-top:0">Tick a field to apply it to all selected orders.</div><div class="form-grid mt16">' +
    fieldA('status', 'Status', '<select id="b_status">' + opts(['Draft', 'Ordered', 'Received', 'Cancelled'], 'Ordered') + '</select>', 'Received adds quantities to stock.') +
    fieldA('supplier', 'Supplier', '<select id="b_sup"><option value="">—</option>' + sups.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('') + '</select>') +
    fieldA('orderedBy', 'Ordered by', '<input id="b_by">') +
    fieldA('date', 'Order date', '<input id="b_date" type="date" value="' + today() + '">') +
    fieldA('receivedDate', 'Received date', '<input id="b_recv" type="date" value="' + today() + '">') +
    '</div></div><div class="modal-f"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>Apply to ' + records.length + '</button></div>';
  var m = openModal(html);
  $all('[data-x]', m).forEach(function (b) { b.onclick = closeModal; });
  $('[data-ok]', m).onclick = function () {
    var patch = {};
    if (applied(m, 'status')) patch.status = $('#b_status', m).value;
    if (applied(m, 'supplier')) { var s = supplierById($('#b_sup', m).value); patch.supplierId = $('#b_sup', m).value; patch.supplierName = s ? s.name : ''; }
    if (applied(m, 'orderedBy')) patch.orderedBy = $('#b_by', m).value.trim();
    if (applied(m, 'date')) patch.date = $('#b_date', m).value;
    if (applied(m, 'receivedDate')) patch.receivedDate = $('#b_recv', m).value;
    if (!Object.keys(patch).length) { toast('Tick at least one field.', 'warn'); return; }
    var recs = records.map(function (r) { var o = Object.assign({}, r, patch); if (patch.status === 'Received' && !o.receivedDate) o.receivedDate = today(); return o; });
    closeModal(); persistManyUpdate('Orders', recs).then(function () { toast('Updated ' + recs.length + ' order(s)', 'ok'); });
  };
}
function bulkEditSuppliers(records) {
  var fm0 = '', fd0 = '';
  var html = '<div class="modal-h">' + ICON('suppliers', 20) + '<h3>Bulk edit ' + records.length + ' supplier(s)</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div><div class="modal-b"><div class="hint" style="margin-top:0">Tick a field to apply it to all selected suppliers.</div><div class="form-grid mt16">' +
    fieldA('category', 'Supplies', '<select id="b_cat">' + opts(['Both', 'Stationery', 'Pantry'], 'Both') + '</select>') +
    fieldA('freq', 'Order frequency (M / D)', '<div class="row"><input id="b_fm" type="number" placeholder="Months" style="max-width:120px"><input id="b_fd" type="number" placeholder="Days" style="max-width:120px"></div>') +
    fieldA('contactPerson', 'Contact person', '<input id="b_contact">') +
    fieldA('phone', 'Phone', '<input id="b_phone">') +
    '</div></div><div class="modal-f"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>Apply to ' + records.length + '</button></div>';
  var m = openModal(html);
  $all('[data-x]', m).forEach(function (b) { b.onclick = closeModal; });
  $('[data-ok]', m).onclick = function () {
    var patch = {};
    if (applied(m, 'category')) patch.category = $('#b_cat', m).value;
    if (applied(m, 'freq')) patch.orderFrequencyMonths = monthsFromMD($('#b_fm', m).value, $('#b_fd', m).value);
    if (applied(m, 'contactPerson')) patch.contactPerson = $('#b_contact', m).value.trim();
    if (applied(m, 'phone')) patch.phone = $('#b_phone', m).value.trim();
    if (!Object.keys(patch).length) { toast('Tick at least one field.', 'warn'); return; }
    var recs = records.map(function (r) { return Object.assign({}, r, patch); });
    closeModal(); persistManyUpdate('Suppliers', recs).then(function () { toast('Updated ' + recs.length + ' supplier(s)', 'ok'); });
  };
}
function bulkEditConsumption(records) {
  var users = listVal('users');
  var html = '<div class="modal-h">' + ICON('record', 20) + '<h3>Bulk edit ' + records.length + ' entr(y/ies)</h3><button class="iconbtn" data-x>' + ICON('x', 17) + '</button></div><div class="modal-b"><div class="hint" style="margin-top:0">Tick a field to apply it to all selected entries.</div><div class="form-grid mt16">' +
    fieldA('date', 'Date', '<input id="b_date" type="date" value="' + today() + '">') +
    fieldA('enteredBy', 'Entered by', '<input id="b_by" list="b_dlu"><datalist id="b_dlu">' + users.map(function (u) { return '<option>' + esc(u) + '</option>'; }).join('') + '</datalist>') +
    '</div></div><div class="modal-f"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>Apply to ' + records.length + '</button></div>';
  var m = openModal(html);
  $all('[data-x]', m).forEach(function (b) { b.onclick = closeModal; });
  $('[data-ok]', m).onclick = function () {
    var patch = {};
    if (applied(m, 'date')) patch.date = $('#b_date', m).value;
    if (applied(m, 'enteredBy')) patch.enteredBy = $('#b_by', m).value.trim();
    if (!Object.keys(patch).length) { toast('Tick at least one field.', 'warn'); return; }
    var recs = records.map(function (r) { return Object.assign({}, r, patch); });
    closeModal(); persistManyUpdate('Consumption', recs).then(function () { toast('Updated ' + recs.length + ' entr(y/ies)', 'ok'); });
  };
}
function itemBulkLabel(it) { return { title: it.name, sub: (it.subcategory || '') + ' · ' + qtyDisp(it, D(it.id).currentBase) }; }

/* =================================================================== */
/*  ANALYTICS SERIES                                                   */
/* =================================================================== */
function monthKeys(n) { var arr = [], d = new Date(); d.setDate(1); for (var i = n - 1; i >= 0; i--) { var mo = new Date(d.getFullYear(), d.getMonth() - i, 1); arr.push({ key: mo.getFullYear() + '-' + (mo.getMonth() + 1), label: mo.toLocaleDateString('en-IN', { month: 'short' }) }); } return arr; }
function monthlyConsumption(itemId, n) { var it = itemById(itemId), su = stockUnitOf(it), mk = monthKeys(n), map = {}; mk.forEach(function (m) { map[m.key] = 0; }); (D(itemId).series || []).forEach(function (c) { var d = toDate(c.date); if (!d) return; var k = d.getFullYear() + '-' + (d.getMonth() + 1); if (map[k] != null) map[k] += c.qty; }); return mk.map(function (m) { return { label: m.label, value: round(fromBase(it, map[m.key], su), 2) }; }); }
function consumptionValueSeries(n, cat) { var mk = monthKeys(n), map = {}; mk.forEach(function (m) { map[m.key] = 0; }); S.items.forEach(function (it) { if (cat && it.category !== cat) return; var per = D(it.id).perBase || 0; (D(it.id).series || []).forEach(function (c) { var d = toDate(c.date); if (!d) return; var k = d.getFullYear() + '-' + (d.getMonth() + 1); if (map[k] != null) map[k] += c.qty * per; }); }); return mk.map(function (m) { return { label: m.label, value: round(map[m.key], 2) }; }); }
function spendSeries(n, cat) { var mk = monthKeys(n), map = {}; mk.forEach(function (m) { map[m.key] = 0; }); S.orders.forEach(function (o) { if (o.status !== 'Received') return; var d = toDate(o.receivedDate || o.date); if (!d) return; var k = d.getFullYear() + '-' + (d.getMonth() + 1); if (map[k] == null) return; map[k] += cat ? catShareOfOrder(o, cat) : num(o.total); }); return mk.map(function (m) { return { label: m.label, value: round(map[m.key], 2) }; }); }
function catShareOfOrder(o, cat) { var lines = parseLines(o.linesJSON); var sub = lines.reduce(function (a, ln) { return a + num(ln.amount || num(ln.qty) * num(ln.unitPrice)); }, 0); if (!sub) return 0; var cs = lines.reduce(function (a, ln) { var it = itemById(ln.itemId); return a + ((it && it.category === cat) ? num(ln.amount || num(ln.qty) * num(ln.unitPrice)) : 0); }, 0); return num(o.total) * (cs / sub); }
function spendInLastDays(days, cat) { var since = toDate(today()).getTime() - days * 86400000; return S.orders.filter(function (o) { return o.status === 'Received' && toDate(o.receivedDate || o.date) && toDate(o.receivedDate || o.date).getTime() >= since; }).reduce(function (s, o) { return s + (cat ? catShareOfOrder(o, cat) : num(o.total)); }, 0); }
function spendBySubcat(cat) { var map = {}; S.orders.forEach(function (o) { if (o.status !== 'Received') return; parseLines(o.linesJSON).forEach(function (ln) { var it = itemById(ln.itemId); if (!it || it.category !== cat) return; var k = it.subcategory || 'Other'; map[k] = (map[k] || 0) + num(ln.amount || num(ln.qty) * num(ln.unitPrice)); }); }); return Object.keys(map).map(function (k) { return { label: k, value: round(map[k], 2) }; }).sort(function (a, b) { return b.value - a.value; }); }
function spendBySupplier(cat) { var map = {}; S.orders.forEach(function (o) { if (o.status !== 'Received') return; var v = cat ? catShareOfOrder(o, cat) : num(o.total); if (v <= 0) return; var k = o.supplierName || 'Unknown'; map[k] = (map[k] || 0) + v; }); return Object.keys(map).map(function (k) { return { label: k, value: round(map[k], 2) }; }).sort(function (a, b) { return b.value - a.value; }).slice(0, 8); }
function spendByItem(cat) { var map = {}; S.orders.forEach(function (o) { if (o.status !== 'Received') return; parseLines(o.linesJSON).forEach(function (ln) { var it = itemById(ln.itemId); if (!it || (cat && it.category !== cat)) return; map[it.name] = (map[it.name] || 0) + num(ln.amount || num(ln.qty) * num(ln.unitPrice)); }); }); return Object.keys(map).map(function (k) { return { label: k, value: round(map[k], 2) }; }).sort(function (a, b) { return b.value - a.value; }).slice(0, 8); }
function consumptionValueByItem(cat) { var out = []; S.items.forEach(function (it) { if (cat && it.category !== cat) return; var dd = D(it.id); var v = (dd.consumed || 0) * (dd.perBase || 0); if (v > 0) out.push({ label: it.name, value: round(v, 2) }); }); return out.sort(function (a, b) { return b.value - a.value; }).slice(0, 8); }
function stockValueBySubcat(cat) { var map = {}; itemsIn(cat).forEach(function (it) { var v = D(it.id).value || 0; if (v <= 0) return; var k = it.subcategory || 'Other'; map[k] = (map[k] || 0) + v; }); return Object.keys(map).map(function (k) { return { label: k, value: round(map[k], 2) }; }).sort(function (a, b) { return b.value - a.value; }); }
function ordersByMonth(n, cat) { var mk = monthKeys(n), map = {}; mk.forEach(function (m) { map[m.key] = 0; }); S.orders.forEach(function (o) { if (cat && !orderTouchesCat(o, cat)) return; var d = toDate(o.date); if (!d) return; var k = d.getFullYear() + '-' + (d.getMonth() + 1); if (map[k] != null) map[k]++; }); return mk.map(function (m) { return { label: m.label, value: map[m.key] }; }); }
function stockHealth(cat) { var c = { ok: 0, low: 0, out: 0 }; itemsIn(cat).forEach(function (it) { var s = D(it.id).status; if (s === 'out') c.out++; else if (s === 'low' || s === 'critical') c.low++; else c.ok++; }); return c; }

/* =================================================================== */
/*  CHARTS                                                             */
/* =================================================================== */
function wireCharts(root) { $all('[data-tip]', root).forEach(function (el) { el.addEventListener('mousemove', function (e) { showTip(e, el.getAttribute('data-tip')); }); el.addEventListener('mouseenter', function (e) { showTip(e, el.getAttribute('data-tip')); }); el.addEventListener('mouseleave', hideTip); }); }
function showTip(e, html) { var t = $('#vizTip'); t.innerHTML = html; t.style.opacity = '1'; var x = e.clientX + 14, y = e.clientY + 14; if (x + 240 > window.innerWidth) x = e.clientX - 240; t.style.left = x + 'px'; t.style.top = y + 'px'; }
function hideTip() { $('#vizTip').style.opacity = '0'; }
function niceMax(v) { if (v <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))); var f = v / p; var n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10; return n * p; }
function fmtAxis(v, money2) { if (money2) { if (v >= 1000) return cur() + (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k'; return cur() + Math.round(v); } return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(round(v, 1)); }
function tipHtml(label, value, money2, extra) { var html = '<div class="tt">' + esc(label) + '</div><div class="tr"><span>' + (money2 ? 'Amount' : 'Value') + '</span><b>' + (money2 ? money(value) : fmtNum(value)) + (extra ? ' · ' + escAttr(extra) : '') + '</b></div>'; return escAttr(html); }
function chartEmpty() { return '<div class="empty" style="padding:30px"><div class="muted">No data yet</div></div>'; }
function barChartSVG(data, o) {
  o = o || {}; if (!data || !data.length || data.every(function (d) { return d.value === 0; })) return chartEmpty();
  if (o.horizontal) return barChartH(data, o);
  var W = 360, H = 210, padL = 48, padB = 28, padT = 12, padR = 14, max = niceMax(Math.max.apply(null, data.map(function (d) { return d.value; }))), iw = W - padL - padR, ih = H - padT - padB, bw = iw / data.length;
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="height:auto;display:block" preserveAspectRatio="xMidYMid meet" role="img">';
  for (var g = 0; g <= 4; g++) { var y = padT + ih * g / 4; svg += '<line class="grid-line" x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '"/><text class="tick" x="' + (padL - 7) + '" y="' + (y + 4) + '" text-anchor="end">' + fmtAxis(max * (1 - g / 4), o.money) + '</text>'; }
  data.forEach(function (d, i) { var bh = max ? (d.value / max) * ih : 0, x = padL + i * bw + bw * 0.2, w = bw * 0.6, yy = padT + ih - bh; svg += '<rect x="' + x + '" y="' + yy + '" width="' + w + '" height="' + Math.max(0, bh) + '" rx="3" fill="' + (o.color || 'var(--s1)') + '" data-tip="' + tipHtml(d.label, d.value, o.money) + '"/><text class="tick" x="' + (padL + i * bw + bw / 2) + '" y="' + (H - 9) + '" text-anchor="middle">' + esc(d.label) + '</text>'; });
  return svg + '</svg>';
}
function barChartH(data, o) {
  var W = 360, rowH = 30, labelW = 96, padR = 46, padT = 4, max = niceMax(Math.max.apply(null, data.map(function (d) { return d.value; }))), H = data.length * rowH + padT * 2, barW = W - labelW - padR;
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="height:auto;display:block" preserveAspectRatio="xMinYMin meet" role="img">';
  data.forEach(function (d, i) { var y = padT + i * rowH, bw = max ? (d.value / max) * barW : 0; svg += '<text class="tick" x="0" y="' + (y + rowH / 2) + '" dominant-baseline="middle">' + esc(clip(d.label, 15)) + '</text><rect x="' + labelW + '" y="' + (y + 5) + '" width="' + Math.max(1, bw) + '" height="' + (rowH - 12) + '" rx="3" fill="' + (o.color || 'var(--s3)') + '" data-tip="' + tipHtml(d.label, d.value, o.money) + '"/><text class="vlabel" x="' + (labelW + bw + 5) + '" y="' + (y + rowH / 2) + '" dominant-baseline="middle">' + fmtAxis(d.value, o.money) + '</text>'; });
  return svg + '</svg>';
}
function lineChartSVG(data, o) {
  o = o || {}; if (!data || !data.length || data.every(function (d) { return d.value === 0; })) return chartEmpty();
  var W = 360, H = 210, padL = 48, padB = 28, padT = 12, padR = 14, max = niceMax(Math.max.apply(null, data.map(function (d) { return d.value; }))), iw = W - padL - padR, ih = H - padT - padB;
  var pts = data.map(function (d, i) { var x = padL + (data.length === 1 ? iw / 2 : iw * i / (data.length - 1)); var y = padT + ih - (max ? (d.value / max) * ih : 0); return { x: x, y: y, d: d }; });
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="height:auto;display:block" preserveAspectRatio="xMidYMid meet" role="img">';
  for (var g = 0; g <= 4; g++) { var y = padT + ih * g / 4; svg += '<line class="grid-line" x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '"/><text class="tick" x="' + (padL - 7) + '" y="' + (y + 4) + '" text-anchor="end">' + fmtAxis(max * (1 - g / 4), o.money) + '</text>'; }
  var area = 'M' + pts[0].x + ',' + (padT + ih) + ' ' + pts.map(function (p) { return 'L' + p.x + ',' + p.y; }).join(' ') + ' L' + pts[pts.length - 1].x + ',' + (padT + ih) + ' Z';
  svg += '<path d="' + area + '" fill="' + (o.color || 'var(--s1)') + '" opacity="0.10"/><path d="M' + pts.map(function (p) { return p.x + ',' + p.y; }).join(' L') + '" fill="none" stroke="' + (o.color || 'var(--s1)') + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
  pts.forEach(function (p) { svg += '<circle cx="' + p.x + '" cy="' + p.y + '" r="3.4" fill="' + (o.color || 'var(--s1)') + '" stroke="var(--surface)" stroke-width="1.5" data-tip="' + tipHtml(p.d.label, p.d.value, o.money) + '"/>'; });
  data.forEach(function (d, i) { svg += '<text class="tick" x="' + pts[i].x + '" y="' + (H - 9) + '" text-anchor="middle">' + esc(d.label) + '</text>'; });
  return svg + '</svg>';
}
function donutSVG(data) {
  data = (data || []).filter(function (d) { return d.value > 0; }); if (!data.length) return chartEmpty();
  var total = data.reduce(function (a, d) { return a + d.value; }, 0), R = 42, r = 26, cx = 50, cy = 50, ang = -Math.PI / 2;
  var svg = '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><svg viewBox="0 0 100 100" width="130" height="130" style="flex:none">';
  if (data.length === 1) svg += '<circle cx="50" cy="50" r="' + ((R + r) / 2) + '" fill="none" stroke="' + SERIES[0] + '" stroke-width="' + (R - r) + '" data-tip="' + tipHtml(data[0].label, data[0].value, true, '100%') + '"/>';
  else data.forEach(function (d, i) { var frac = d.value / total, a2 = ang + frac * Math.PI * 2, large = frac > 0.5 ? 1 : 0, x1 = cx + R * Math.cos(ang), y1 = cy + R * Math.sin(ang), x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2), xi2 = cx + r * Math.cos(a2), yi2 = cy + r * Math.sin(a2), xi1 = cx + r * Math.cos(ang), yi1 = cy + r * Math.sin(ang); svg += '<path d="M' + x1 + ',' + y1 + ' A' + R + ',' + R + ' 0 ' + large + ' 1 ' + x2 + ',' + y2 + ' L' + xi2 + ',' + yi2 + ' A' + r + ',' + r + ' 0 ' + large + ' 0 ' + xi1 + ',' + yi1 + ' Z" fill="' + SERIES[i % SERIES.length] + '" stroke="var(--surface)" stroke-width="1" data-tip="' + tipHtml(d.label, d.value, true, Math.round(frac * 100) + '%') + '"/>'; ang = a2; });
  svg += '<text x="50" y="48" text-anchor="middle" style="font-size:8px;fill:var(--ink-3)">Total</text><text x="50" y="58" text-anchor="middle" style="font-size:9px;font-weight:700;fill:var(--ink)">' + esc(fmtAxis(total, true)) + '</text></svg>';
  svg += '<div class="legend" style="flex:1;flex-direction:column;gap:6px">' + data.map(function (d, i) { return '<div class="li"><span class="sw" style="background:' + SERIES[i % SERIES.length] + '"></span><span style="flex:1">' + esc(d.label) + '</span><b class="tabnum">' + money(d.value) + '</b></div>'; }).join('') + '</div></div>';
  return svg;
}
function sparklineSVG(data, o) { o = o || {}; var w = o.w || 100, h = o.h || 30; if (!data || !data.length) return ''; var vals = data.map(function (d) { return d.value; }), max = Math.max.apply(null, vals) || 1; var pts = data.map(function (d, i) { var x = data.length === 1 ? w / 2 : (w - 4) * i / (data.length - 1) + 2; var y = h - 3 - (d.value / max) * (h - 6); return x + ',' + y; }); return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--s1)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>'; }

/* =================================================================== */
/*  SIMPLE MODE — deliberate single entry                             */
/* =================================================================== */
function applySimple() { if (S.simple) { document.body.classList.add('simple'); renderSimple(); } else { document.body.classList.remove('simple'); render(); } }
function renderSimple() {
  var v = $('#view');
  if (S.simpleState.itemId) return renderSimpleEntry(v, S.simpleState.itemId);
  var html = '<div class="simple-wrap"><div class="simple-head"><div class="logo">' + ICON('box', 24) + '</div><div><h1>' + esc(S.settings.appTitle || 'Weekly Stock Count') + '</h1><div class="muted" style="font-size:13px">' + esc(S.user || 'Staff') + ' · ' + fmtDate(today()) + '</div></div></div>';
  html += '<div class="subtabs">' + CATS.map(function (c) { return '<button class="subtab ' + (S.sub === c ? 'active' : '') + '" data-sub="' + c + '">' + esc(c) + '</button>'; }).join('') + '</div>';
  html += '<div class="search" style="margin-bottom:12px">' + ICON('search', 16) + '<input id="s_q" placeholder="Search item…" style="font-size:16px;padding:14px 14px 14px 40px"></div>';
  html += '<p class="hint">Tap the item you counted, then enter how many are left.</p><div id="simple_list"></div>';
  html += '<div class="simple-bar"><button class="btn" id="s_exit" style="flex:0 0 auto">Exit</button><div class="hint" style="flex:1;align-self:center;text-align:center">Tap an item above</div></div></div>';
  v.innerHTML = html; document.body.classList.remove('nav-open');
  $all('[data-sub]', v).forEach(function (b) { b.onclick = function () { S.sub = b.dataset.sub; localStorage.setItem('inv_sub', S.sub); renderSimple(); }; });
  $('#s_q').addEventListener('input', debounce(drawSimpleList, 150));
  $('#s_exit').onclick = function () { confirmBox({ title: 'Exit simple mode?', body: 'This device will show the full dashboard again.', ok: 'Exit', onOk: function () { S.simple = false; localStorage.setItem('inv_simple', '0'); applySimple(); } }); };
  drawSimpleList();
}
function drawSimpleList() {
  var box = $('#simple_list'); if (!box) return;
  var q = ($('#s_q') && $('#s_q').value || '').toLowerCase().trim();
  var items = itemsIn(S.sub).sort(by('name')); if (q) items = items.filter(function (it) { return it.name.toLowerCase().indexOf(q) >= 0; });
  if (!items.length) { box.innerHTML = emptyState('box', 'No items', 'Nothing to count here'); return; }
  box.innerHTML = items.map(function (it) { var dd = D(it.id); return '<button class="count-item" data-pick="' + esc(it.id) + '" style="display:block;width:100%;text-align:left;border:1px solid var(--line);cursor:pointer"><div class="ci-name">' + esc(it.name) + '</div><div class="ci-sub">' + esc(it.subcategory || '') + ' · now <b>' + fmtNum(dd.current) + ' ' + esc(dd.su) + '</b></div></button>'; }).join('');
  $all('[data-pick]', box).forEach(function (b) { b.onclick = function () { S.simpleState.itemId = b.dataset.pick; renderSimple(); }; });
}
function renderSimpleEntry(v, id) {
  var it = itemById(id); if (!it) { S.simpleState.itemId = null; return renderSimple(); }
  var dd = D(id);
  var html = '<div class="simple-wrap"><div class="simple-head"><button class="iconbtn" id="s_back" style="width:44px;height:44px">' + ICON('back', 22) + '</button><div><h1 style="font-size:19px">' + esc(it.name) + '</h1><div class="muted" style="font-size:13px">' + esc(it.subcategory || '') + '</div></div></div>';
  html += '<div class="count-item" style="text-align:center"><div class="ci-sub" style="font-size:15px">System shows <b>' + fmtNum(dd.current) + ' ' + esc(dd.su) + '</b></div><div style="margin:16px 0 6px;font-weight:700;font-size:17px">How many ' + esc(dd.su) + ' are left now?</div><div class="ci-row" style="justify-content:center">' + stepper(it.id, dd.current) + '</div></div>';
  html += '<div class="simple-bar"><button class="btn" id="s_cancel" style="flex:1">Cancel</button><button class="btn primary" id="s_save" style="flex:2">' + ICON('check', 18) + 'Save count</button></div></div>';
  v.innerHTML = html;
  wireSteppers(v);
  $('#s_back').onclick = $('#s_cancel').onclick = function () { S.simpleState.itemId = null; renderSimple(); };
  $('#s_save').onclick = function () {
    if (!S.user) { askUser(function () { $('#s_save') && $('#s_save').click(); }); return; }
    var left = num($('[data-count="' + cssq(it.id) + '"]', v).value);
    if (round(left, 2) === round(dd.current, 2)) { toast('No change — pick another item.', 'warn'); S.simpleState.itemId = null; renderSimple(); return; }
    var rec = { id: uid('CON'), date: today(), itemId: it.id, mode: 'left', value: left, unit: dd.su, consumed: Math.max(0, round(dd.current - left, 2)), prevStock: dd.current, newStock: left, enteredBy: S.user, note: 'Count', createdAt: new Date().toISOString() };
    S.simpleState.itemId = null;
    persist('Consumption', rec, true).then(function () { toast('Saved: ' + it.name + ' = ' + left + ' ' + dd.su, 'ok'); });
    renderSimple();
  };
}

/* =================================================================== */
/*  IDENTITY / THEME / INIT                                            */
/* =================================================================== */
function askUser(cb) {
  var users = listVal('users');
  var html = '<div class="modal-h">' + ICON('user', 20) + '<h3>Who are you?</h3></div><div class="modal-b"><label>Your name (shown on everything you record)</label><input id="u_name" value="' + esc(S.user) + '" list="dl_u" placeholder="e.g. Pushp"><datalist id="dl_u">' + users.map(function (u) { return '<option>' + esc(u) + '</option>'; }).join('') + '</datalist><div class="hint">Saved to this device — you won\'t be asked again here. No password needed.</div></div><div class="modal-f"><button class="btn primary block" data-ok>Continue</button></div>';
  var m = openModal(html, { sticky: true });
  var save = function () { var n = $('#u_name', m).value.trim(); if (!n) { toast('Please enter a name', 'err'); return; } S.user = n; localStorage.setItem('inv_user', n); addToList('users', n); closeModal(); renderNav(); cb && cb(); };
  $('[data-ok]', m).onclick = save; $('#u_name', m).addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
}
function initTheme() {
  var saved = localStorage.getItem('inv_theme'); if (saved) document.documentElement.setAttribute('data-theme', saved); paintThemeBtn();
  $('#themeBtn').onclick = function () { var c = document.documentElement.getAttribute('data-theme'); var n = c === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', n); localStorage.setItem('inv_theme', n); paintThemeBtn(); };
}
function paintThemeBtn() { var dark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); $('#themeBtn').innerHTML = ICON(dark ? 'sun' : 'moon', 17); }
function openConnectionSetup() {
  S.loaded = true;
  $('#view').innerHTML = '<div class="card" style="max-width:560px;margin:20px auto"><div class="card-h">' + ICON('refresh', 18) + '<h3>Connect your data</h3></div><div class="card-b"><p style="margin-top:0;color:var(--ink-2)">Paste the Google Apps Script Web App URL to load and save your shared inventory (one-time).</p><label>Web App URL (ends in /exec)</label><input id="boot_api" placeholder="https://script.google.com/…/exec"><div class="row mt16"><button class="btn primary" id="boot_save">Connect</button></div><div class="hint mt16">Follow the README to create the Google Sheet and deploy the script (~10 min).</div></div></div>';
  $('#boot_save').onclick = function () { var u = $('#boot_api').value.trim(); if (u.indexOf('http') !== 0) { toast('Enter a valid URL', 'err'); return; } localStorage.setItem('inv_api_url', u); API_URL = u; loadData(true); };
  setSync('off', 'Not connected');
}
function init() {
  initTheme();
  $('#brandTitle').textContent = 'Office Inventory';
  var t = TABS.filter(function (x) { return x.id === S.tab; })[0] || TABS[0]; $('#pageTitle').textContent = t.title; $('#pageSub').textContent = t.sub;
  window.addEventListener('online', function () { S.offline = false; document.body.classList.remove('is-offline'); toast('Back online', 'ok'); loadData(true); });
  window.addEventListener('offline', function () { S.offline = true; document.body.classList.add('is-offline'); setSync('err', 'Offline'); });
  window.addEventListener('focus', function () { if (S.loaded && !S.offline && apiConfigured() && S.pending <= 0) loadData(false); });
  setInterval(pollRev, 12000);
  renderNav();
  var boot = function () { if (S.simple) { document.body.classList.add('simple'); } if (S.loaded) { S.simple ? applySimple() : render(); } else { loadData(true).then(function () { if (S.simple) applySimple(); }); } };
  if (!S.user) askUser(boot); else boot();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
}
document.addEventListener('DOMContentLoaded', init);


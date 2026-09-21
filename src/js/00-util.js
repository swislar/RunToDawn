/* ===================== 00 · utilities & state ===================== */
const App = {
  runs: [],          // canonical run list
  other: [],         // non-running workouts
  best: {},          // distance(m) -> {sec, date, runId, method}
  meta: {},          // import meta
  fit: null,         // computed fitness model
  unit: 'km',
  plan: null,
  ready: false
};

const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const el = (tag, attrs, html) => {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') n.className = attrs[k];
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  }
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---- units ---- */
const M_PER_MI = 1609.344;
const toU  = m => App.unit === 'mi' ? m / M_PER_MI : m / 1000;   // metres -> display unit
const fromU = v => App.unit === 'mi' ? v * M_PER_MI : v * 1000;
const uName = () => App.unit === 'mi' ? 'mi' : 'km';
const uLong = () => App.unit === 'mi' ? 'miles' : 'kilometres';

const dist = (m, dp) => toU(m).toFixed(dp == null ? 1 : dp);

/* ---- time formatting ---- */
function hms(sec, forceH) {
  if (!isFinite(sec) || sec < 0) return '–';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  if (h || forceH) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  return m + ':' + String(s).padStart(2, '0');
}
function hm(sec) {
  if (!isFinite(sec) || sec < 0) return '–';
  const h = Math.floor(sec / 3600), m = Math.round(sec % 3600 / 60);
  return h ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + 'm';
}
/** pace in sec per display unit, from sec + metres */
function paceOf(sec, metres) {
  if (!metres || !sec) return NaN;
  return sec / toU(metres);
}
function fmtPace(secPerUnit, withUnit) {
  if (!isFinite(secPerUnit) || secPerUnit <= 0 || secPerUnit > 3600) return '–';
  const m = Math.floor(secPerUnit / 60), s = Math.round(secPerUnit % 60);
  const t = (s === 60 ? (m + 1) + ':00' : m + ':' + String(s).padStart(2, '0'));
  return withUnit ? t + '/' + uName() : t;
}
const paceStr = (sec, metres, withUnit) => fmtPace(paceOf(sec, metres), withUnit !== false);

/* ---- dates ---- */
const DAY = 86400000;
/** local-day key from a run (runs carry their recorded tz offset) */
function dayKey(ms) { const d = new Date(ms); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }
function localMs(run) { return run.start + run.tz * 60000; }          // shifted so UTC getters read local
function startOfWeekUTC(ms) { const d = new Date(ms); const w = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - w * DAY; }
function fmtDate(ms, opts) { return new Date(ms).toLocaleDateString(undefined, opts || { day: 'numeric', month: 'short', year: 'numeric' }); }
function fmtShort(ms) { return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sum = a => a.reduce((x, y) => x + y, 0);
const mean = a => a.length ? sum(a) / a.length : 0;
function median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const i = s.length >> 1; return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; }

/* ---- persistence: settings in localStorage, runs in IndexedDB ---- */
const LS = 'ns.settings.v1';
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; }
}
function saveSettings(patch) {
  try {
    const s = Object.assign(loadSettings(), patch);
    localStorage.setItem(LS, JSON.stringify(s));
  } catch (e) { /* storage may be unavailable or full — the app still works */ }
}

const DB = { name: 'runtodawn', store: 'blobs', v: 1 };
function idb() {
  return new Promise((res, rej) => {
    if (!('indexedDB' in window)) return rej(new Error('no-idb'));
    const r = indexedDB.open(DB.name, DB.v);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains(DB.store)) d.createObjectStore(DB.store); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbPut(key, val) {
  try { const d = await idb(); await new Promise((res, rej) => { const t = d.transaction(DB.store, 'readwrite'); t.objectStore(DB.store).put(val, key); t.oncomplete = res; t.onerror = () => rej(t.error); }); return true; }
  catch (e) { return false; }
}
async function idbGet(key) {
  try { const d = await idb(); return await new Promise((res, rej) => { const t = d.transaction(DB.store, 'readonly'); const q = t.objectStore(DB.store).get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
  catch (e) { return undefined; }
}
async function idbClear() {
  try { const d = await idb(); await new Promise(res => { const t = d.transaction(DB.store, 'readwrite'); t.objectStore(DB.store).clear(); t.oncomplete = res; t.onerror = res; }); return true; }
  catch (e) { return false; }
}

/* ---- tiny markdown renderer for model output ---- */
function md(src) {
  const lines = String(src).replace(/\r/g, '').split('\n');
  let out = '', list = null;
  const inline = t => esc(t)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const close = () => { if (list) { out += '</' + list + '>'; list = null; } };
  for (const raw of lines) {
    const l = raw.trimEnd();
    let m;
    if (!l.trim()) { close(); continue; }
    if ((m = l.match(/^#{1,6}\s+(.*)$/))) { close(); const lv = Math.min(3, l.match(/^#+/)[0].length + 1); out += '<h' + lv + '>' + inline(m[1]) + '</h' + lv + '>'; continue; }
    if ((m = l.match(/^\s*[-*•]\s+(.*)$/))) { if (list !== 'ul') { close(); list = 'ul'; out += '<ul>'; } out += '<li>' + inline(m[1]) + '</li>'; continue; }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { close(); list = 'ol'; out += '<ol>'; } out += '<li>' + inline(m[1]) + '</li>'; continue; }
    close(); out += '<p>' + inline(l) + '</p>';
  }
  close();
  return out;
}

/* ---- toast-free status line ---- */
function say(node, text, kind) {
  if (!node) return;
  node.innerHTML = text ? '<div class="note' + (kind ? ' ' + kind : '') + '">' + text + '</div>' : '';
}

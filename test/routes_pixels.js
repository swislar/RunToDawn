/* Runs the ACTUAL 35-routes.js drawing code against a real 2D canvas
   (node-canvas, Cairo-backed — a faithful Canvas API, not a stub) and
   inspects pixel output. This is the only way to catch a rendering bug that
   a mocked getContext() would hide. */
const fs = require('fs'), vm = require('vm');
const { createCanvas } = require('canvas');

globalThis.window = globalThis;
globalThis.document = {
  readyState: 'complete',
  documentElement: { style: {} },
  head: { appendChild() {} },
  addEventListener() {},
  getElementById(id) { return globalThis.__nodes[id] || null; },
  querySelector(sel) {
    const id = sel.replace(/^#/, '');
    return globalThis.__nodes[id] || null;
  },
  querySelectorAll() { return []; }
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.devicePixelRatio = 1;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };

for (const f of ['00-util', '30-charts', '35-routes'])
  vm.runInThisContext(fs.readFileSync('src/js/' + f + '.js', 'utf8'), { filename: f });

// palette() calls cssVar() -> getComputedStyle(...).getPropertyValue(n) -> '' for every
// token in this harness, so stub palette() directly with the real theme colours instead.
palette = () => ({
  clay: '#A8412C', slate: '#2F6478', amber: '#B07A14', sage: '#5C7A5E', plum: '#7A5C74',
  ink: '#101517', ink2: '#3A4247', ink3: '#6B7378', rule: '#D8D5CC', ruleSoft: '#E7E4DB',
  surf: '#FFFFFF'
});

/* Fake DOM element with just enough surface for setupRouteCanvas/renderRoutes
   to work: clientWidth, style, classList, getContext (delegating to a real
   node-canvas), and event listener plumbing that no-ops. */
function fakeEl(tag, id) {
  const listeners = {};
  const canvas = tag === 'canvas' ? createCanvas(10, 10) : null;
  const el = {
    id, tagName: tag.toUpperCase(),
    _clientWidth: 700,
    get clientWidth() { return el._clientWidth; },
    style: {},
    classList: { add() {}, remove() {}, contains: () => false },
    children: [], _html: '',
    get innerHTML() { return el._html; },
    set innerHTML(v) { el._html = v; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    setPointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: el._clientWidth, height: 360 }; },
    querySelector() { return null }, querySelectorAll() { return [] },
    getAttribute() { return null }, setAttribute() {},
  };
  if (canvas) {
    Object.defineProperty(el, 'width', { get: () => canvas.width, set: v => { canvas.width = v; } });
    Object.defineProperty(el, 'height', { get: () => canvas.height, set: v => { canvas.height = v; } });
    el.getContext = (...a) => canvas.getContext(...a);
    el._canvas = canvas;
  }
  return el;
}

globalThis.__nodes = {
  'v-routes': fakeEl('div', 'v-routes'),
  'rtWrap': fakeEl('div', 'rtWrap'),
  'rtCanvas': fakeEl('canvas', 'rtCanvas'),
  'rtStats': fakeEl('div', 'rtStats'),
  'rtIn': fakeEl('button', 'rtIn'),
  'rtOut': fakeEl('button', 'rtOut'),
  'rtFit': fakeEl('button', 'rtFit'),
};
// $()/$$() from 00-util.js resolve by id through document.getElementById /
// querySelectorAll — give the routes view a querySelectorAll for '#rtPeriod button'
globalThis.__nodes['v-routes'].querySelectorAll = () => [];

let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log((ok ? '  ok  ' : '  \u2717   ') + msg); };

function analyse(canvasEl, bgHex) {
  const c = canvasEl._canvas;
  const ctx = c.getContext('2d');
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  const bg = [parseInt(bgHex.slice(1, 3), 16), parseInt(bgHex.slice(3, 5), 16), parseInt(bgHex.slice(5, 7), 16)];
  let differing = 0, total = 0;
  for (let i = 0; i < data.length; i += 4) {
    total++;
    const dr = Math.abs(data[i] - bg[0]), dg = Math.abs(data[i + 1] - bg[1]), db = Math.abs(data[i + 2] - bg[2]);
    if (dr + dg + db > 10) differing++;
  }
  return { width, height, total, differing, frac: differing / total };
}

/* ---- scenario 1: tight cluster of repeated loops (the common case) ---- */
(function () {
  console.log('--- scenario 1: repeated home loop (tight cluster) ---');
  const mk = (lat, lon, r, n) => {
    const a = [];
    for (let i = 0; i < n; i++) { const f = i / n * Math.PI * 2; a.push(lat + Math.sin(f) * r, lon + Math.cos(f) * r); }
    return { pts: Float32Array.from(a), len: 5000, date: Date.now() - Math.random() * 60 * 86400000 };
  };
  App.ready = true;
  App.routes = [];
  for (let i = 0; i < 25; i++) App.routes.push(mk(1.3521 + (Math.random() - 0.5) * 0.0002, 103.8198 + (Math.random() - 0.5) * 0.0002, 0.006, 180));
  App.meta = { isZip: true };
  renderRoutes();
  const r = analyse(globalThis.__nodes.rtCanvas, '#FFFFFF');
  console.log('  canvas', r.width + 'x' + r.height, '| differing-from-background pixels:', r.differing, '(' + (r.frac * 100).toFixed(2) + '%)');
  check(r.differing > 200, 'visible stroke pixels exist for a tight cluster of 25 routes');
})();

/* ---- scenario 2: routes scattered across a wide city (the suspect edge case) --- */
(function () {
  console.log('\n--- scenario 2: a dominant home loop plus a few far-off outliers ---');
  const mk = (lat, lon, r, n) => {
    const a = [];
    for (let i = 0; i < n; i++) { const f = i / n * Math.PI * 2; a.push(lat + Math.sin(f) * r, lon + Math.cos(f) * r); }
    return { pts: Float32Array.from(a), len: 5000, date: Date.now() - Math.random() * 200 * 86400000 };
  };
  App.routes = [];
  // a home loop used often, plus a handful of one-off runs 10-40 km away (travel, races)
  for (let i = 0; i < 20; i++) App.routes.push(mk(1.3521, 103.8198, 0.006, 180));
  App.routes.push(mk(1.29, 103.85, 0.006, 180));   // ~8 km away
  App.routes.push(mk(1.45, 103.78, 0.006, 180));   // ~11 km away
  App.routes.push(mk(1.10, 103.60, 0.006, 180));   // ~30 km away
  renderRoutes();
  const r = analyse(globalThis.__nodes.rtCanvas, '#FFFFFF');
  console.log('  canvas', r.width + 'x' + r.height, '| differing-from-background pixels:', r.differing, '(' + (r.frac * 100).toFixed(2) + '%)', '| trimmed outliers:', routeView.trimmed);
  check(r.differing > 2000, 'the dominant home loop stays clearly visible once outliers are excluded from the fit (' + r.differing + ' px)');
  check(routeView.trimmed >= 2, 'far-off one-off routes are excluded from the auto-fit (' + routeView.trimmed + ' trimmed)');
})();

/* ---- scenario 2b: a REALISTIC route count \u2014 this is what broke before --- */
(function () {
  console.log('\n--- scenario 2b: 300 routes, a realistic multi-year history ---');
  const mk = (lat, lon, r, n) => {
    const a = [];
    for (let i = 0; i < n; i++) { const f = i / n * Math.PI * 2; a.push(lat + Math.sin(f) * r, lon + Math.cos(f) * r); }
    return { pts: Float32Array.from(a), len: 5000, date: Date.now() - Math.random() * 700 * 86400000 };
  };
  App.routes = [];
  for (let i = 0; i < 300; i++) {
    const jitter = (Math.random() - 0.5) * 0.0015;
    App.routes.push(mk(1.3521 + jitter, 103.8198 + jitter, 0.006 + Math.random() * 0.002, 150));
  }
  const oldAlpha = Math.max(0.05, Math.min(0.55, 0.85 / Math.pow(300, 0.42)));
  renderRoutes();
  const r = analyse(globalThis.__nodes.rtCanvas, '#FFFFFF');
  console.log('  canvas', r.width + 'x' + r.height, '| differing-from-background pixels:', r.differing, '(' + (r.frac * 100).toFixed(2) + '%)');
  console.log('  (the old formula would have used ' + (oldAlpha * 100).toFixed(1) + '% alpha here \u2014 the exact regime that read as blank)');
  check(r.frac > 0.05, 'a realistic 300-route history is clearly visible, not just technically non-zero (' + (r.frac * 100).toFixed(1) + '% of pixels)');
})();

/* ---- scenario 3: a single route ---- */
(function () {
  console.log('\n--- scenario 3: a single route ---');
  const a = [];
  for (let i = 0; i < 150; i++) { const f = i / 150 * Math.PI * 2; a.push(1.3521 + Math.sin(f) * 0.005, 103.8198 + Math.cos(f) * 0.005); }
  App.routes = [{ pts: Float32Array.from(a), len: 4000, date: Date.now() - 5 * 86400000 }];
  renderRoutes();
  const r = analyse(globalThis.__nodes.rtCanvas, '#FFFFFF');
  console.log('  canvas', r.width + 'x' + r.height, '| differing-from-background pixels:', r.differing, '(' + (r.frac * 100).toFixed(2) + '%)');
  check(r.differing > 50, 'a single route is visible on its own');
})();

/* ---- scenario 4: dark theme ---- */
(function () {
  console.log('\n--- scenario 4: dark theme colours ---');
  palette = () => ({
    clay: '#E0705A', slate: '#5E93A8', amber: '#D9A84E', sage: '#8AAE8C', plum: '#B08CA8',
    ink: '#EDEDE8', ink2: '#B9C0C4', ink3: '#8A9296', rule: '#333C42', ruleSoft: '#242C31',
    surf: '#1C2328'
  });
  const a = [];
  for (let i = 0; i < 150; i++) { const f = i / 150 * Math.PI * 2; a.push(1.3521 + Math.sin(f) * 0.005, 103.8198 + Math.cos(f) * 0.005); }
  App.routes = [{ pts: Float32Array.from(a), len: 4000, date: Date.now() - 5 * 86400000 }];
  renderRoutes();
  const r = analyse(globalThis.__nodes.rtCanvas, '#1C2328');
  console.log('  canvas', r.width + 'x' + r.height, '| differing-from-background pixels:', r.differing, '(' + (r.frac * 100).toFixed(2) + '%)');
  check(r.differing > 50, 'visible against a dark background too');
})();

console.log('\n' + (fails ? 'FAIL ' + fails : 'all clean'));
process.exit(fails ? 1 : 0);

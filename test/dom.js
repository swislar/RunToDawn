// Render every view into a real DOM built from the shipped body.html,
// with Chart.js stubbed. Catches selector typos, undefined field access,
// and markup that fails to close.
const fs = require('fs'), vm = require('vm'), { JSDOM } = require('jsdom');
const os = require('os'), path = require('path');
const TMP = os.tmpdir();

const body = fs.readFileSync('src/body.html', 'utf8');
const dom = new JSDOM(`<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`, {
  url: 'https://example.com', pretendToBeVisual: true
});
const w = dom.window;

globalThis.window = w;
globalThis.document = w.document;
globalThis.navigator = w.navigator;
globalThis.HTMLElement = w.HTMLElement;
globalThis.Blob = w.Blob;
globalThis.URL = w.URL;
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
globalThis.getComputedStyle = w.getComputedStyle.bind(w);
globalThis.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {} }));
w.matchMedia = w.matchMedia || globalThis.matchMedia;
w.scrollTo = () => {}; globalThis.scrollTo = () => {};
const store = {};
globalThis.localStorage = w.localStorage || {
  getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; }
};
w.localStorage = globalThis.localStorage;

// Chart.js stub that records what it was asked to draw
const charts = [];
globalThis.Chart = w.Chart = class {
  constructor(ctx, cfg) {
    charts.push({ canvas: ctx && ctx.canvas ? ctx.canvas.id : '?', type: cfg.type, sets: (cfg.data.datasets || []).length });
    this.config = cfg; this.canvas = ctx && ctx.canvas;
    for (const ds of cfg.data.datasets || []) {
      if (!Array.isArray(ds.data)) throw new Error('dataset without array data on ' + (ctx.canvas && ctx.canvas.id));
      for (const v of ds.data) {
        const n = (v && typeof v === 'object') ? v.y : v;
        if (n !== null && n !== undefined && !Number.isFinite(n)) throw new Error('non-finite point on ' + (ctx.canvas && ctx.canvas.id) + ': ' + JSON.stringify(v));
      }
    }
  }
  destroy() {} update() {} resize() {}
};
w.HTMLCanvasElement.prototype.getContext = function () { return { canvas: this }; };
globalThis.indexedDB = w.indexedDB = undefined;

const FILES = ['00-util', '10-parse', '20-metrics', '25-classify', '30-charts', '35-routes', '40-coach', '50-views', '55-coachview', '60-insights', '90-boot'];
for (const f of FILES) vm.runInThisContext(fs.readFileSync('src/js/' + f + '.js', 'utf8'), { filename: f });

const iso = wks => new Date(Date.now() + wks * 7 * 86400000).toISOString().slice(0, 10);
const problems = [];
function check(name, fn) {
  try { fn(); } catch (e) { problems.push(name + ' -> ' + e.message + '\n    ' + (e.stack || '').split('\n')[1]); return; }
  console.log('  ok  ' + name);
}
function auditView(id) {
  const n = document.getElementById(id);
  if (!n) { problems.push('missing view node #' + id); return; }
  const html = n.innerHTML;
  if (!html.trim()) { problems.push(id + ' rendered empty'); return; }
  for (const bad of ['undefined', 'NaN', 'null', 'Infinity', '[object Object]']) {
    const esc2 = bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(^|[>\\s(])' + esc2 + '([<\\s).,%/]|$)', 'g');
    const hits = (html.match(re) || []).length;
    if (hits) { problems.push(`${id}: "${bad}" appears ${hits}× in rendered output`); let m; const re2=new RegExp(re.source,"g"); while((m=re2.exec(html))) problems.push("      ctx: ..."+html.slice(Math.max(0,m.index-90),m.index+40).replace(/s+/g," ")+"..."); }
  }
  console.log(`      #${id}: ${html.length} chars, ${n.querySelectorAll('*').length} nodes`);
}

(async () => {
  const buf = fs.readFileSync(path.join(TMP, 'export.xml'));
  const file = new w.Blob([buf]); file.name = 'export.xml';
  const res = await parseHealthExport(file, { splits: true, dedupe: true, routes: false }, () => {});
  App.runs = res.runs; App.best = res.best; App.meta = res.meta; App.other = res.other; App.ready = true;
  App.unit = 'km';
  App.cls = classifyRuns(App.runs);
  App.walks = App.runs.filter(r => r.kind === 'walk');
  App.train = App.runs.filter(r => r.kind !== 'walk');
  App.routes = [];
  App.fit = buildFitness(App.train, App.best, { hr: App.cls.hr, easyRef: App.cls.easyRef });
  App.load = computeLoad(App.train, App.fit.paces.T);
  console.log('parsed', App.runs.length, 'runs\n');

  console.log('--- views ---');
  check('renderOverview', () => { renderOverview(); auditView('v-overview'); });
  check('renderVolume', () => { renderVolume(); auditView('v-volume'); });
  check('renderRoutes (no routes)', () => { renderRoutes(); auditView('v-routes'); });
  check('renderRoutes (with routes)', () => {
    // two overlapping loops plus one elsewhere
    const mk = (lat, lon, n, day) => {
      const a = [];
      for (let i = 0; i < n; i++) { const f = i / n * Math.PI * 2; a.push(lat + Math.sin(f) * 0.008, lon + Math.cos(f) * 0.008); }
      return { pts: Float32Array.from(a), len: 5000, date: Date.now() - day * 86400000 };
    };
    App.routes = [mk(1.436, 103.786, 120, 3), mk(1.436, 103.786, 120, 9), mk(1.30, 103.85, 120, 400)];
    let strokes = 0;
    const realGC = w.HTMLCanvasElement.prototype.getContext;
    w.HTMLCanvasElement.prototype.getContext = function () {
      return { canvas: this, setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() { strokes++; }, save() {}, restore() {} };
    };
    try { renderRoutes(); } finally { w.HTMLCanvasElement.prototype.getContext = realGC; }
    if (strokes < 3) problems.push('route canvas drew ' + strokes + ' strokes for 3 routes');
    console.log('      route canvas: ' + strokes + ' strokes');
    auditView('v-routes');
    App.routes = [];
  });
  check('renderPerf', () => { renderPerf(); auditView('v-perf'); });
  check('renderCoach', () => { renderCoach(); auditView('v-coach'); });
  check('renderInsights', () => { renderInsights(); auditView('v-insights'); });
  check('renderData', () => { renderData(); auditView('v-data'); });

  console.log('\n--- coach plan render ---');
  check('renderPlan FM', () => {
    const plan = buildPlan({ race: 'FM', raceDate: iso(17), days: 5, longDay: 5, level: 'solid', cross: true }, App.fit, App.runs);
    App.plan = plan; renderPlan(plan);
    const wk = document.querySelectorAll('#v-coach details.wk');
    console.log('      weeks rendered:', wk.length, '| expected', plan.total);
    if (wk.length !== plan.total) problems.push('renderPlan: ' + wk.length + ' week blocks for ' + plan.total + ' weeks');
    auditView('v-coach');
  });
  for (const r of ['10K', 'HM']) check('renderPlan ' + r, () => {
    const plan = buildPlan({ race: r, raceDate: iso(12), days: 4, longDay: 6, level: 'building', cross: false }, App.fit, App.runs);
    renderPlan(plan); auditView('v-coach');
  });

  console.log('\n--- unit + empty-state paths ---');
  check('imperial re-render', () => { App.unit = 'mi'; renderOverview(); renderVolume(); renderPerf(); renderInsights(); App.unit = 'km'; });
  check('no-data overview', () => {
    const keep = { runs: App.runs, train: App.train, best: App.best, fit: App.fit, load: App.load };
    App.runs = []; App.train = []; App.best = {}; App.fit = null; App.load = null; App.ready = false;
    renderOverview(); renderVolume(); renderPerf(); renderCoach(); renderInsights(); renderRoutes();
    Object.assign(App, keep); App.ready = true;
  });
  check('thin-data (3 runs)', () => {
    const keep = App.train;
    App.runs = keep.slice(-3); App.train = App.runs;
    App.best = {}; App.fit = buildFitness(App.train, App.best, {}); App.load = computeLoad(App.train, App.fit ? App.fit.paces.T : 300);
    renderOverview(); renderPerf(); renderCoach();
    App.runs = keep; App.train = keep; App.best = res.best;
    App.fit = buildFitness(App.train, App.best, {}); App.load = computeLoad(App.train, App.fit.paces.T);
  });

  console.log('\n--- navigation ---');
  check('go() through every view', () => {
    for (const v of VIEWS) { go(v.id); if (!document.getElementById('v-' + v.id).classList.contains('on')) throw new Error('view ' + v.id + ' not activated'); }
    go('overview');
  });

  console.log('\ncharts drawn:', charts.length);
  const byCanvas = {}; for (const c of charts) byCanvas[c.canvas] = (byCanvas[c.canvas] || 0) + 1;
  console.log(Object.entries(byCanvas).map(([k, v]) => k + '×' + v).join(', '));

  console.log('\n--- result ---');
  if (problems.length) { console.log('FAIL ' + problems.length); problems.forEach(p => console.log('  ✗ ' + p)); process.exit(1); }
  console.log('all clean');
})().catch(e => { console.error('CRASH', e); process.exit(1); });

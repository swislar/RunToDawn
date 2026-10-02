/* ===================== 90 · data tab, navigation, boot ===================== */

function renderData() {
  const v = $('#v-data');
  const m = App.meta || {};
  let h = '<div class="sechead"><h1>Your data</h1>' +
    '<p class="sub">Everything imported stays in this browser. Nothing about your health is uploaded anywhere by this app.</p></div>';

  if (!App.ready) {
    h += '<div class="note">Nothing imported yet.</div>';
    v.innerHTML = h; return;
  }

  h += '<div class="grid g4">' +
    statTile('Runs', App.train.length, '', (App.walks.length ? App.walks.length + ' set aside' + (App.bogus && App.bogus.length ? ' (incl. ' + App.bogus.length + ' pace anomal' + (App.bogus.length === 1 ? 'y' : 'ies') + ')' : '') + ' · ' : '') + App.other.length + ' other workouts') +
    statTile('Span', App.runs.length ? Math.round((App.runs[App.runs.length - 1].start - App.runs[0].start) / DAY / 30.4) : 0, 'months',
      App.runs.length ? fmtDate(App.runs[0].start) + ' → ' + fmtDate(App.runs[App.runs.length - 1].start) : '') +
    statTile('Runs with splits', m.runsWithSplits || 0, '', (m.samples || 0).toLocaleString() + ' distance samples read') +
    statTile('GPS routes', (App.routes || []).length, '', m.routesFound ? 'of ' + m.routesFound + ' found in the zip' : (m.isZip ? 'none in this zip' : 'need the zip, not export.xml')) +
    statTile('Parse time', ((m.ms || 0) / 1000).toFixed(1), 's', (m.records || 0).toLocaleString() + ' records scanned') +
    '</div>';

  if (m.merged) h += '<div class="note" style="margin-top:14px">' + m.merged + ' duplicate run' + (m.merged === 1 ? '' : 's') + ' merged — the same session recorded by more than one app or device.</div>';
  if (m.sampleTrimmed) h += '<div class="note warn" style="margin-top:14px">The export held more distance samples than fit in memory, so the oldest were dropped. Best efforts from the earliest part of your history may be missing.</div>';

  h += '<div class="grid g2" style="margin-top:16px">' +
    '<div class="panel"><div class="ph"><h3>Import</h3></div><div class="pb"><dl class="kv">' +
    '<dt>File</dt><dd style="font-family:var(--f-ui)">' + esc(m.file || '–') + '</dd>' +
    '<dt>Size</dt><dd>' + ((m.bytes || 0) / 1048576).toFixed(1) + ' MB</dd>' +
    '<dt>Imported</dt><dd style="font-family:var(--f-ui)">' + (m.imported ? fmtDate(m.imported) : '–') + '</dd>' +
    '</dl></div></div>' +
    '<div class="panel"><div class="ph"><h3>Recording sources</h3><div class="tiny">Apps and devices found in the export</div></div>' +
    '<div class="pb"><div class="row">' + (m.sources || []).slice(0, 18).map(s => '<span class="pill">' + esc(s) + '</span>').join('') + '</div></div></div>' +
    '</div>';

  h += '<div class="sechead"><h2>Keep or clear</h2></div>' +
    '<div class="row">' +
    '<button class="btn" type="button" id="expRuns">Save my runs as CSV</button>' +
    '<button class="btn" type="button" id="expJson">Save everything as JSON</button>' +
    '<button class="btn" type="button" id="wipe">Erase everything from this browser</button>' +
    '</div><div id="wipeNote" style="margin-top:12px"></div>';

  v.innerHTML = h;

  $('#expRuns').addEventListener('click', () => {
    const rows = [['date', 'distance_' + uName(), 'duration_s', 'pace_per_' + uName(), 'avg_hr', 'max_hr', 'elevation_m', 'kcal', 'load', 'indoor', 'source']];
    for (const r of App.runs) rows.push([dayKey(localMs(r)), toU(r.m).toFixed(3), r.dur, paceStr(r.dur, r.m, false), r.hrAvg || '', r.hrMax || '', r.elev || '', r.kcal || '', r.load || '', r.indoor ? 'yes' : 'no', r.src]);
    offerDownload('runs.csv', rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n'));
  });
  $('#expJson').addEventListener('click', () => {
    offerDownload('runtodawn-export.json', JSON.stringify({ meta: App.meta, runs: App.runs, best: App.best, brief: athleteBrief() }, null, 1));
  });
  $('#wipe').addEventListener('click', async () => {
    const note = $('#wipeNote');
    if (!$('#wipe').dataset.armed) {
      $('#wipe').dataset.armed = '1';
      $('#wipe').textContent = 'Press again to erase';
      say(note, 'This removes the imported runs and your saved settings, including any API key, from this browser. It cannot be undone.', 'warn');
      return;
    }
    await idbClear();
    try { localStorage.removeItem(LS); } catch (e) { }
    App.runs = []; App.train = []; App.walks = []; App.bogus = []; App.other = []; App.best = {}; App.meta = {}; App.fit = null; App.plan = null; App.ready = false; App.routes = [];
    destroyCharts();
    renderAll(); go('import');
  });
}

/* --------------------------------------------------------------- nav */
const VIEWS = [
  { id: 'import', label: 'Import', el: '#v-import', icon: 'M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2' },
  { id: 'overview', label: 'Overview', el: '#v-overview', icon: 'M4 19V5m0 14h16M8 19v-6m4 6V8m4 11v-9' },
  { id: 'volume', label: 'Volume', el: '#v-volume', icon: 'M3 17l5-6 4 4 4-7 5 5' },
  { id: 'routes', label: 'Routes', el: '#v-routes', icon: 'M9 20l-5-2V6l5-2 6 2 5-2v14l-5 2-6-2zm0 0V4m6 18V6' },
  { id: 'perf', label: 'Performance', el: '#v-perf', icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-9 4-4' },
  { id: 'coach', label: 'Coach', el: '#v-coach', icon: 'M8 4h8v3a4 4 0 0 1-8 0V4Zm4 7v4m-4 5h8m-4-5a4 4 0 0 0 4-4' },
  { id: 'insights', label: 'Insights', el: '#v-insights', icon: 'M12 3a6 6 0 0 0-3 11v3h6v-3a6 6 0 0 0-3-11Zm-2 17h4' },
  { id: 'data', label: 'Data', el: '#v-data', icon: 'M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7' }
];
let current = 'import';

function go(id) {
  const vw = VIEWS.find(v => v.id === id) || VIEWS[0];
  current = vw.id;
  $$('.view').forEach(s => s.classList.remove('on'));
  $(vw.el).classList.add('on');
  $$('#nav button, #tabbar button').forEach(b => b.setAttribute('aria-current', String(b.dataset.view === vw.id)));
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  renderCurrent();
}
window.go = go;

function renderCurrent() {
  destroyCharts();
  if (current === 'overview') renderOverview();
  else if (current === 'volume') renderVolume();
  else if (current === 'routes') renderRoutes();
  else if (current === 'perf') renderPerf();
  else if (current === 'coach') renderCoach();
  else if (current === 'insights') renderInsights();
  else if (current === 'data') renderData();
}
function renderAll() { renderCurrent(); }

function buildNav() {
  const nav = $('#nav'), tab = $('#tabbar');
  nav.innerHTML = ''; tab.innerHTML = '';
  VIEWS.forEach((v, i) => {
    const b = el('button', { type: 'button', 'data-view': v.id, 'aria-current': String(v.id === current) },
      icon(v.icon) + '<span>' + v.label + '</span>' + (i < 9 ? '<span class="k">' + (i + 1) + '</span>' : ''));
    b.addEventListener('click', () => go(v.id));
    nav.appendChild(b);
    const t = el('button', { type: 'button', 'data-view': v.id, 'aria-current': String(v.id === current) },
      icon(v.icon) + '<span>' + v.label + '</span>');
    t.addEventListener('click', () => go(v.id));
    tab.appendChild(t);
  });
}
function icon(d) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="17" height="17" aria-hidden="true"><path d="' + d + '"/></svg>';
}

/* ------------------------------------------------------------- import */
function setProgress(msg, pct, detail) {
  $('#importStatus').style.display = '';
  $('#impMsg').textContent = msg;
  $('#impPct').textContent = Math.round(pct * 100) + '%';
  $('#impBar').style.width = (pct * 100) + '%';
  if (detail !== undefined) $('#impDetail').textContent = detail || '';
}

async function handleFile(file) {
  if (!file) return;
  $('#importDone').style.display = 'none';
  const optRoutes = $('#optRoutes');
  const opts = { splits: $('#optSplits').checked, dedupe: $('#optDedupe').checked, routes: optRoutes ? optRoutes.checked : true };
  try {
    setProgress('Starting', 0.01, file.name + ' · ' + (file.size / 1048576).toFixed(0) + ' MB');
    const res = await parseHealthExport(file, opts, (m, p, d) => setProgress(m, p, d));
    adopt(res);
    setProgress('Done', 1, res.runs.length + ' runs · ' + (res.meta.ms / 1000).toFixed(1) + 's');
    await idbPut('data', { runs: App.runs, other: App.other, best: App.best, meta: App.meta, v: 1 });
    if (App.routes && App.routes.length) await idbPut('routes', App.routes);
    else await idbPut('routes', []);

    const s = rangeStats(App.runs, 0, Date.now());
    $('#importDone').style.display = '';
    $('#importDone').innerHTML = '<div class="panel"><div class="pb">' +
      '<h3 style="margin-bottom:8px">' + res.runs.length + ' runs, ' + dist(s.m, 0) + ' ' + uName() + ', ' + hm(s.sec) + '</h3>' +
      '<p class="tiny">' + (App.meta.runsWithSplits ? App.meta.runsWithSplits + ' of them had distance samples good enough to pull real best efforts out of. ' : '') +
      (App.meta.routesUsed ? App.meta.routesUsed + ' GPS routes read for the heatmap' + (App.meta.routesCapped ? ' (capped at the newest ' + App.meta.routesUsed + ' of ' + App.meta.routesFound + ')' : '') + '. ' :
        (App.meta.isZip ? 'No GPS routes found in the zip \\u2014 the route heatmap will be empty. ' : 'Bare export.xml has no GPS routes \\u2014 upload the zip for the route heatmap. ')) +
      'Kept in this browser, so you will not need to import again unless the export changes.</p>' +
      '<div class="row" style="margin-top:10px"><button class="btn pri" type="button" onclick="go(\'overview\')">See the overview</button>' +
      '<button class="btn" type="button" onclick="go(\'coach\')">Build a training plan</button>' +
      (App.meta.routesUsed ? '<button class="btn ghost" type="button" onclick="go(\'routes\')">See the route heatmap</button>' : '') +
      '</div></div></div>';
    setTimeout(() => { $('#importStatus').style.display = 'none'; }, 2500);
  } catch (e) {
    setProgress('Stopped', 0, '');
    $('#importStatus').style.display = 'none';
    $('#importDone').style.display = '';
    $('#importDone').innerHTML = '<div class="note bad"><strong>That file could not be read.</strong><br>' +
      esc((e && e.message) || String(e)) +
      '<br><br>If the zip is very large, unzip it on your computer and bring in <span class="num">apple_health_export/export.xml</span> instead — it needs far less memory.</div>';
  }
}

function adopt(res) {
  App.runs = res.runs; App.other = res.other || []; App.best = res.best || {}; App.meta = res.meta || {};
  App.routes = res.routes || [];
  recompute();
  App.ready = App.runs.length > 0;
}

function recompute() {
  // classify first — everything downstream depends on knowing what each run was
  App.cls = classifyRuns(App.runs);
  App.walks = App.runs.filter(r => r.kind === 'walk');
  App.train = App.runs.filter(r => r.kind !== 'walk');          // running only
  App.bogus = App.walks.filter(r => r.bogus);

  // Compute reference paces across the athlete's training history
  const normalRuns = App.train.filter(r => r.gap && r.m >= 2000);
  const globalRef = normalRuns.length >= 3 ? median(normalRuns.map(r => r.gap)) : (App.cls.easyRef || 360);
  const localCache = new Map();
  const refForDate = ms => {
    const k = Math.floor(ms / (30 * DAY));
    if (!localCache.has(k)) {
      const center = (k + 0.5) * 30 * DAY;
      const pool = normalRuns.filter(x => Math.abs(x.start - center) <= 90 * DAY);
      localCache.set(k, pool.length >= 3 ? median(pool.map(x => x.gap)) : globalRef);
    }
    return localCache.get(k);
  };

  const excludeIds = new Set(App.walks.map(r => r.id));

  // Purge/sanitize individual run PBs (r.pb)
  for (const r of App.train) {
    if (!r.pb) continue;
    const ref = Math.min(globalRef, refForDate(r.start));
    const runPace = r.gap || (r.m && r.dur ? r.dur / (r.m / 1000) : ref);
    for (const k in r.pb) {
      const m = +k;
      const sec = r.pb[k];
      const pace = sec / (m / 1000);
      if (pace < wrPaceFloor(m) || pace < ref * effortMinRatio(m) || (runPace > 0 && pace < runPace * 0.65)) {
        delete r.pb[k];
      }
    }
  }

  // Validate and purge App.best
  const recoverBest = (m, excludeRunId) => {
    let bestSec = Infinity, bestRun = null;
    for (const r of App.train) {
      if (excludeRunId && r.id === excludeRunId) continue;
      if (r.pb && r.pb[m] && r.pb[m] < bestSec) {
        bestSec = r.pb[m];
        bestRun = r;
      }
    }
    if (bestRun) {
      App.best[m] = { sec: bestSec, date: bestRun.start, runId: bestRun.id, method: 'split', indoor: bestRun.indoor };
      return true;
    }
    delete App.best[m];
    return false;
  };

  for (const mStr in App.best) {
    const m = +mStr;
    const b = App.best[m];
    if (!b) continue;
    const ref = Math.min(globalRef, refForDate(b.date));
    const pace = b.sec / (m / 1000);
    const hostRun = App.runs.find(r => r.id === b.runId);
    const hostPace = hostRun && hostRun.gap ? hostRun.gap : (hostRun && hostRun.m && hostRun.dur ? hostRun.dur / (hostRun.m / 1000) : 0);
    const isBogus = excludeIds.has(b.runId) ||
                    pace < wrPaceFloor(m) ||
                    pace < ref * effortMinRatio(m) ||
                    (b.method === 'split' && hostPace > 0 && pace < hostPace * 0.65);
    if (isBogus) {
      const badRunId = b.runId;
      const badRun = App.runs.find(r => r.id === badRunId);
      if (badRun && badRun.pb) delete badRun.pb[m];
      recoverBest(m, badRunId);
    }
  }

  // Cross-distance physical monotonicity & VDOT sanity check
  // 1. Time monotonicity: a longer distance cannot take less time than a shorter distance.
  // 2. Outlier VDOT: an isolated effort cannot spike far above the athlete's corroborated fitness.
  const targetsAsc = TARGETS.slice().sort((a, b) => a.m - b.m);
  let changed = true;
  while (changed) {
    changed = false;
    const haveVdots = [];
    for (const t of targetsAsc) {
      if (App.best[t.m]) haveVdots.push(vdotFrom(t.m, App.best[t.m].sec));
    }
    const medVdot = haveVdots.length ? median(haveVdots) : 40;

    for (let i = 0; i < targetsAsc.length; i++) {
      const t1 = targetsAsc[i];
      const b1 = App.best[t1.m];
      if (!b1) continue;
      const v1 = vdotFrom(t1.m, b1.sec);

      // Rule 1: Extreme VDOT outlier vs median of recorded efforts
      if (haveVdots.length >= 3 && v1 > medVdot + 7.0) {
        const badRunId = b1.runId;
        const badRun = App.runs.find(r => r.id === badRunId);
        if (badRun && badRun.pb) delete badRun.pb[t1.m];
        recoverBest(t1.m, badRunId);
        changed = true;
        break;
      }

      // Rule 2: Time monotonicity (longer distance cannot take <= time than shorter distance)
      for (let j = i + 1; j < targetsAsc.length; j++) {
        const t2 = targetsAsc[j];
        const b2 = App.best[t2.m];
        if (!b2) continue;
        if (b2.sec <= b1.sec) {
          const badRunId = b2.runId;
          const badRun = App.runs.find(r => r.id === badRunId);
          if (badRun && badRun.pb) delete badRun.pb[t2.m];
          recoverBest(t2.m, badRunId);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  fillBestEffortsFromAverages(App.train, App.best);

  const st = loadSettings();
  App.fit = buildFitness(App.train, App.best, {
    useIndoor: typeof perfIndoor !== 'undefined' ? perfIndoor : false,
    hr: App.cls.hr, easyRef: App.cls.easyRef,
    muted: st.mutedEfforts || {},
    race: st.race || null
  });
  const thr = App.fit ? App.fit.paces.T : (() => {
    const ps = App.train.filter(r => r.m > 2000 && r.dur > 600).map(r => r.dur / (r.m / 1000));
    return ps.length ? median(ps) * 0.86 : 300;
  })();
  computeLoad(App.train, thr);
}

/* --------------------------------------------------------------- theme */
function applyTheme(mode) {
  if (mode === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', mode);
  saveSettings({ theme: mode });
  const b = $('#themeBtn');
  if (b) b.textContent = mode === 'auto' ? 'Theme: auto' : mode === 'dark' ? 'Theme: dark' : 'Theme: light';
}

/* ---------------------------------------------------------------- boot */
function wireUnits() {
  $$('[data-unit]').forEach(b => b.addEventListener('click', () => {
    App.unit = b.dataset.unit;
    saveSettings({ unit: App.unit });
    $$('[data-unit]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.unit === App.unit)));
    if (App.plan) { const p = buildPlan(App.plan.cfg, App.fit, App.train); App.plan = p.error ? null : p; }
    renderCurrent();
  }));
}

function wireDrop() {
  const drop = $('#drop'), input = $('#file');
  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
}

async function boot() {
  const s = loadSettings();
  App.unit = s.unit === 'mi' ? 'mi' : 'km';
  $$('[data-unit]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.unit === App.unit)));
  applyTheme(s.theme || 'auto');

  buildNav();
  wireUnits();
  wireDrop();

  $('#themeBtn').addEventListener('click', () => {
    const cur = loadSettings().theme || 'auto';
    applyTheme(cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto');
    setTimeout(renderCurrent, 30);
  });

  document.addEventListener('keydown', e => {
    if (e.target.matches('input,textarea,select')) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= VIEWS.length) go(VIEWS[n - 1].id);
  });

  // restore a previous import
  const saved = await idbGet('data');
  if (saved && saved.runs && saved.runs.length) {
    App.runs = saved.runs; App.other = saved.other || []; App.best = saved.best || {}; App.meta = saved.meta || {};
    try { App.routes = (await idbGet('routes')) || []; } catch (e) { App.routes = []; }
    recompute();
    idbPut('data', { runs: App.runs, other: App.other, best: App.best, meta: App.meta, v: 1 }).catch(() => {});
    App.ready = true;
    if (s.coach) App.coachCfg = s.coach;
    go('overview');
  } else {
    go('import');
  }

  // Capabilities arrive later, if at all. The page is already usable without them.
  if (window.claude && typeof window.claude.use === 'function') {
    claude.use('sample').then(fn => { window.__sample = fn; if (current === 'insights') renderInsights(); }).catch(() => { });
    claude.use('downloads').then(d => { window.__dl = d; }).catch(() => { });
  }

  window.addEventListener('resize', () => { /* Chart.js handles its own resize */ });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

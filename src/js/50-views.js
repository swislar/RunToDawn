/* ===================== 50 · views ===================== */

function statTile(lab, val, unit, foot, cls) {
  return '<div class="stat"><div class="lab">' + esc(lab) + '</div>' +
    '<div class="val">' + val + (unit ? '<em>' + esc(unit) + '</em>' : '') + '</div>' +
    (foot ? '<div class="foot ' + (cls || '') + '">' + foot + '</div>' : '') + '</div>';
}
function delta(now, prev, suffix) {
  if (!prev) return '';
  const d = (now - prev) / prev * 100;
  const cls = Math.abs(d) < 2 ? 'flat' : d > 0 ? 'up' : 'down';
  return '<span class="' + cls + '">' + (d > 0 ? '+' : '') + d.toFixed(0) + '%</span> ' + (suffix || 'on the period before');
}

/* ------------------------------------------------------------- OVERVIEW */
function renderOverview() {
  const v = $('#v-overview');
  if (!App.ready) { v.innerHTML = emptyState(); return; }
  const runs = App.train, fit = App.fit, now = Date.now();

  const w1 = rangeStats(runs, now - 7 * DAY, now), w1p = rangeStats(runs, now - 14 * DAY, now - 7 * DAY);
  const m1 = rangeStats(runs, now - 28 * DAY, now), m1p = rangeStats(runs, now - 56 * DAY, now - 28 * DAY);
  const yStart = Date.UTC(new Date().getFullYear(), 0, 1);
  const yr = rangeStats(runs, yStart, now);
  const all = rangeStats(runs, 0, now);

  let h = '';

  /* hero: the results board */
  if (fit) {
    h += '<div class="sechead"><h1>Where the numbers say you are</h1>' +
      '<p class="sub">Predicted from your own best efforts, then pulled back towards reality by how much you are actually running. ' +
      'Ranges are wider where the model is guessing further from what you have proved.</p></div>';
    h += raceBoard(fit, null);
    h += '<div class="row" style="margin-top:10px">' +
      '<span class="pill clay">VDOT ' + fit.vdot.toFixed(1) + '</span>' +
      '<span class="pill">Anchored on ' + esc(fit.anchor.label) + ' in ' + hms(fit.anchor.sec) + ', ' + fmtDate(fit.anchor.date, { day: 'numeric', month: 'short', year: 'numeric' }) + '</span>' +
      '<span class="pill">Fatigue exponent ' + fit.riegel.toFixed(3) + (fit.riegelFitted ? ' (fitted to you)' : ' (default)') + '</span>' +
      '</div>';
  } else {
    h += '<div class="sechead"><h1>Overview</h1></div>' +
      '<div class="note warn">Not enough recent effort to model race times. You need at least one run of 1.5 ' + uName() +
      ' or more in roughly the last year. Keep running and this fills in.</div>';
  }

  /* tiles */
  h += '<div class="sechead"><h2>Volume</h2></div><div class="grid g4">' +
    statTile('Last 7 days', dist(w1.m), uName(), delta(w1.m, w1p.m)) +
    statTile('Last 28 days', dist(m1.m), uName(), delta(m1.m, m1p.m)) +
    statTile(new Date().getFullYear() + ' so far', dist(yr.m, 0), uName(), yr.n + ' runs · ' + hm(yr.sec)) +
    statTile('Everything imported', dist(all.m, 0), uName(), all.n + ' runs · ' + hm(all.sec)) +
    '</div>';

  h += '<div class="grid g4" style="margin-top:14px">' +
    statTile('28-day pace', fmtPace(m1.pace), '/' + uName(), m1p.pace ? delta(m1p.pace, m1.pace, 'vs the month before') : '') +
    statTile('28-day time', hm(m1.sec), '', m1.n + ' runs') +
    statTile('Longest run, 28 days', m1.runs.length ? dist(Math.max.apply(null, m1.runs.map(r => r.m))) : '–', uName(), '') +
    statTile('Average heart rate', m1.hr ? m1.hr : '–', m1.hr ? 'bpm' : '', '28-day average across runs') +
    '</div>';

  /* fitness curve */
  const from = Math.max(App.train[0].start, now - 400 * DAY);
  const curve = loadCurve(runs, from, now);
  const last = curve.length ? curve[curve.length - 1] : { ctl: 0, atl: 0, tsb: 0 };
  h += '<div class="sechead"><h2>Fitness, fatigue and form</h2>' +
    '<p class="sub">Three numbers from one input. Every run is scored for training load \u2014 how long it was, ' +
    'multiplied by how hard relative to your threshold pace \u2014 and those daily scores are averaged over two ' +
    'different windows. The slow average is fitness, the fast one is fatigue, and the gap between them is form.</p></div>' +
    '<div class="panel"><div class="pb"><div class="chartbox"><canvas id="c-load"></canvas></div></div></div>' +
    '<div class="grid g3" style="margin-top:14px">' +
    statTile('Fitness', Math.round(last.ctl), 'CTL', '42-day average load') +
    statTile('Fatigue', Math.round(last.atl), 'ATL', '7-day average load') +
    statTile('Form', (last.tsb >= 0 ? '+' : '') + Math.round(last.tsb), 'TSB', formWord(last.tsb)) +
    '</div>' +
    '<div class="panel" style="margin-top:14px"><div class="ph"><h3>How to read these</h3></div><div class="pb">' +
    '<dl class="kv wide">' +
    '<dt>Training load</dt><dd>One point per minute spent at threshold pace, so an hour flat out scores about 100. ' +
      'Easier running scores less than its duration, hard running more, and climbing adds a little. It is the same ' +
      'shape as TSS or Training Load in other tools, computed from pace rather than power.</dd>' +
    '<dt>Fitness <span class="tiny">CTL</span></dt><dd>An exponentially weighted 42-day average of daily load. It rises ' +
      'slowly and falls slowly, which is the point \u2014 it is meant to track the thing that actually takes six weeks ' +
      'to build. Higher is fitter, but only relative to your own history; it is not comparable between people.</dd>' +
    '<dt>Fatigue <span class="tiny">ATL</span></dt><dd>The same calculation over 7 days. It tracks how much you are ' +
      'carrying right now and responds within a few days of a hard block or a rest week.</dd>' +
    '<dt>Form <span class="tiny">TSB</span></dt><dd>Fitness minus fatigue, as of yesterday. Negative means fatigue has ' +
      'run ahead of fitness \u2014 normal and necessary in a build block. Positive means you are carrying less than ' +
      'your fitness can absorb, which is what a taper is for and what detraining also looks like.</dd>' +
    '<dt>Useful bands</dt><dd><span class="pill bad">below \u221225</span> deep in a block, watch for injury and ' +
      'sleep \u00b7 <span class="pill slate">\u221225 to \u22125</span> productive training \u00b7 ' +
      '<span class="pill good">\u22125 to +15</span> fresh, where races are run \u00b7 ' +
      '<span class="pill amber">above +25</span> rested, and if it stays there for weeks, detraining</dd>' +
    '<dt>The catch</dt><dd>These are bookkeeping, not physiology. They know nothing about your sleep, your job, ' +
      'the heat, or whether you are ill. A number that disagrees with how you feel is a number that is wrong.</dd>' +
    '</dl></div></div>';

  /* consistency */
  h += '<div class="sechead"><h2>Consistency</h2></div>' +
    '<div class="panel"><div class="pb">' + heatmapHTML(runs) + '</div></div>';

  /* recent runs */
  h += '<div class="sechead"><h2>Recent runs</h2></div>' + runsTable(runs.slice(-15).reverse());

  v.innerHTML = h;
  if (fit) loadChart('c-load', curve);
  wireHeatmap();
}

function formWord(tsb) {
  if (tsb < -25) return 'deep in the hole \u2014 handle with care';
  if (tsb < -5) return 'training productively';
  if (tsb <= 15) return 'fresh \u2014 race-ready band';
  if (tsb <= 25) return 'well rested';
  return 'rested for a while \u2014 fitness will be drifting down';
}

function raceBoard(fit, targetM) {
  let h = '<div class="board"><div class="bh"><h3 style="margin:0">Predicted race times</h3>' +
    '<span class="tiny">based on ' + fit.cands.length + ' effort' + (fit.cands.length > 1 ? 's' : '') + ' · ' + dist(fit.weeklyM, 0) + ' ' + uName() + '/week recently</span></div><div class="rows">';
  for (const p of fit.preds) {
    const isT = targetM && Math.abs(p.m - targetM) < 60;
    h += '<div class="race' + (isT ? ' is-target' : '') + '">' +
      '<div class="d">' + esc(p.label.replace(' marathon', '')) + '<small>' + dist(p.m) + ' ' + uName() + '</small></div>' +
      '<div><span class="t">' + hms(p.sec, true) + '</span> ' +
      '<span class="rng">&nbsp;' + hms(p.lo, true) + ' – ' + hms(p.hi, true) + '</span></div>' +
      '<div class="p">' + paceStr(p.sec, p.m) + '<br><span class="pill ' + (p.confidence === 'good' ? 'good' : p.confidence === 'fair' ? 'slate' : 'amber') + '">' + p.confidence + '</span></div>' +
      '</div>';
  }
  return h + '</div></div>';
}

function heatmapHTML(runs) {
  const weeks = 53;
  const today = Math.floor(Date.now() / DAY);
  const endWeek = startOfWeekUTC(today * DAY) / DAY;
  const start = endWeek - (weeks - 1) * 7;
  const byDay = new Map();
  for (const r of runs) {
    const k = Math.floor(localMs(r) / DAY);
    let b = byDay.get(k);
    if (!b) { b = { m: 0, sec: 0, n: 0, kinds: [], elev: 0 }; byDay.set(k, b); }
    b.m += r.m; b.sec += r.dur; b.n++; b.elev += r.elev || 0;
    if (r.kind) b.kinds.push(r.kind);
  }
  const vals = Array.from(byDay.values()).map(b => b.m);
  const hi = vals.length ? Math.max.apply(null, vals.slice(-400)) : 1;
  let cells = '';
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const k = start + w * 7 + d;
      const b = byDay.get(k);
      const m = b ? b.m : 0;
      const lvl = !m ? 0 : clamp(Math.ceil(m / hi * 4), 1, 4);
      const op = [0, .28, .48, .72, 1][lvl];
      const future = k > today;
      const style = m ? 'background:var(--clay); opacity:' + op : (future ? 'background:transparent;border:1px dashed var(--rule-soft)' : '');
      /* The native title attribute never appears on a touch screen and is slow
         everywhere else, so the payload rides on data- attributes and a real
         readout is drawn under the grid on hover or tap. */
      const payload = [k * DAY, m, b ? b.sec : 0, b ? b.n : 0, b ? b.elev : 0, b ? b.kinds.join('|') : ''].join('~');
      cells += '<i tabindex="0" data-day="' + payload + '" style="' + style + '"></i>';
    }
  }
  let key = '<div class="heatkey"><span>rest</span>';
  [0, .28, .48, .72, 1].forEach(o => { key += '<i style="' + (o ? 'background:var(--clay);opacity:' + o : 'background:var(--rule-soft)') + '"></i>'; });
  key += '<span>' + dist(hi) + ' ' + uName() + '</span></div>';

  const s2 = streaks(bucketRuns(runs).days);
  const yr = runs.filter(r => Date.now() - r.start < 365 * DAY);
  const daysRun = new Set(yr.map(r => Math.floor(localMs(r) / DAY))).size;

  return '<div class="heatwrap"><div class="heat" id="heatGrid">' + cells + '</div></div>' + key +
    '<div class="heatread" id="heatRead"><span class="tiny">Hover or tap any square for that day.</span></div>' +
    '<div class="row" style="margin-top:10px">' +
    '<span class="pill">' + daysRun + ' of the last 365 days had a run</span>' +
    '<span class="pill">Longest streak ' + s2.best + ' days</span>' +
    '<span class="pill">Current streak ' + s2.cur + ' day' + (s2.cur === 1 ? '' : 's') + '</span>' +
    '<span class="pill">' + yr.length + ' runs in the last year</span></div>';
}

/* The readout under the calendar. Kept as one shared element rather than a
   floating tooltip so it behaves identically under a mouse and a thumb. */
function wireHeatmap() {
  const grid = $('#heatGrid'), read = $('#heatRead');
  if (!grid || !read) return;
  const blank = '<span class="tiny">Hover or tap any square for that day.</span>';
  const show = elx => {
    const raw = elx && elx.getAttribute && elx.getAttribute('data-day');
    if (!raw) return;
    const [ms, m, sec, n, elev, kinds] = raw.split('~');
    const when = fmtDate(+ms, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (!+m) {
      read.innerHTML = '<strong>' + esc(when) + '</strong> <span class="tiny">' +
        (+ms > Date.now() ? 'still to come' : 'rest day \u2014 no running recorded') + '</span>';
      return;
    }
    const ks = kinds ? kinds.split('|').filter(Boolean) : [];
    const labels = ks.map(k => (RUN_KINDS[k] || { label: k }).label);
    read.innerHTML = '<strong>' + esc(when) + '</strong> <span class="tiny">' +
      dist(+m) + ' ' + uName() + ' \u00b7 ' + hms(+sec) + ' \u00b7 ' + paceStr(+sec, +m) +
      (+elev ? ' \u00b7 +' + Math.round(+elev) + ' m' : '') +
      ' \u00b7 ' + n + ' run' + (+n === 1 ? '' : 's') +
      (labels.length ? ' \u00b7 ' + esc(labels.join(', ')) : '') + '</span>';
  };
  grid.addEventListener('mouseover', e => show(e.target.closest('i')));
  grid.addEventListener('focusin', e => show(e.target.closest('i')));
  grid.addEventListener('click', e => show(e.target.closest('i')));
  grid.addEventListener('touchstart', e => show(e.target.closest('i')), { passive: true });
  grid.addEventListener('mouseleave', () => { read.innerHTML = blank; });
}

function runsTable(list) {
  if (!list.length) return '<div class="empty">Nothing here yet.</div>';
  let h = '<div class="panel"><div class="scroller"><table class="tbl"><thead><tr>' +
    '<th>Date</th><th class="n">' + uName() + '</th><th class="n">Time</th><th class="n">Pace</th>' +
    '<th class="n">HR</th><th class="n">Climb</th><th class="n">Load</th><th>Source</th></tr></thead><tbody>';
  for (const r of list) {
    h += '<tr><td>' + fmtDate(localMs(r), { day: 'numeric', month: 'short', year: '2-digit' }) +
      (r.indoor ? ' <span class="pill amber">indoor</span>' : '') + '</td>' +
      '<td class="n">' + dist(r.m) + '</td>' +
      '<td class="n">' + hms(r.dur) + '</td>' +
      '<td class="n">' + paceStr(r.dur, r.m, false) + '</td>' +
      '<td class="n">' + (r.hrAvg || '–') + '</td>' +
      '<td class="n">' + (r.elev ? Math.round(App.unit === 'mi' ? r.elev * 3.28084 : r.elev) + (App.unit === 'mi' ? ' ft' : ' m') : '–') + '</td>' +
      '<td class="n">' + (r.load || '–') + '</td>' +
      '<td class="tiny">' + esc(r.src) + '</td></tr>';
  }
  return h + '</tbody></table></div></div>';
}

/* --------------------------------------------------------------- VOLUME */
let volMode = 'week';
function renderVolume() {
  const v = $('#v-volume');
  if (!App.ready) { v.innerHTML = emptyState(); return; }
  const b = bucketRuns(App.train);

  let buckets, labels, avgW, title;
  if (volMode === 'week') {
    buckets = denseWeeks(b.weeks).slice(-104);
    labels = buckets.map(x => fmtShort(x.key));
    avgW = 4; title = 'Weekly';
  } else if (volMode === 'month') {
    buckets = b.months.slice(-60);
    labels = buckets.map(x => MON[new Date(x.key).getUTCMonth()] + ' ' + String(new Date(x.key).getUTCFullYear()).slice(2));
    avgW = 3; title = 'Monthly';
  } else {
    buckets = b.years;
    labels = buckets.map(x => String(x.key));
    avgW = 2; title = 'Yearly';
  }

  const tot = sum(buckets.map(x => x.m));
  const active = buckets.filter(x => x.n > 0);
  const best = buckets.slice().sort((a, c) => c.m - a.m)[0];

  let h = '<div class="sechead"><h1>Volume</h1>' +
    '<p class="sub">Distance is the part of training that compounds. The line is a rolling average — it matters more than any single bar.</p></div>';

  h += '<div class="row" style="margin-bottom:14px"><div class="seg" role="group" aria-label="Period">' +
    ['week', 'month', 'year'].map(m => '<button type="button" data-vol="' + m + '" aria-pressed="' + (volMode === m) + '">' +
      m.charAt(0).toUpperCase() + m.slice(1) + 'ly</button>').join('') + '</div></div>';

  h += '<div class="grid g4" style="margin-bottom:14px">' +
    statTile('Average ' + volMode, dist(active.length ? tot / active.length : 0), uName(), 'across ' + active.length + ' active ' + volMode + 's') +
    statTile('Biggest ' + volMode, best ? dist(best.m) : '–', uName(), best ? fmtDate(best.key) : '') +
    statTile('Total shown', dist(tot, 0), uName(), sum(buckets.map(x => x.n)) + ' runs') +
    statTile('Time on feet', hm(sum(buckets.map(x => x.sec))), '', 'across the same window') +
    '</div>';

  h += '<div class="panel"><div class="ph"><h3>' + title + ' distance</h3></div>' +
    '<div class="pb"><div class="chartbox tall"><canvas id="c-vol"></canvas></div></div></div>';

  h += '<div class="grid g2" style="margin-top:14px">' +
    '<div class="panel"><div class="ph"><h3>How far you tend to run</h3><div class="tiny">Every run in the import</div></div>' +
    '<div class="pb"><div class="chartbox short"><canvas id="c-hist"></canvas></div></div></div>' +
    '<div class="panel"><div class="ph"><h3>Which days you run</h3><div class="tiny">Distance by day of week</div></div>' +
    '<div class="pb"><div class="chartbox short"><canvas id="c-dow"></canvas></div></div></div>' +
    '</div>';

  /* table */
  h += '<div class="sechead"><h2>' + title + ' breakdown</h2></div>';
  h += '<div class="panel"><div class="scroller"><table class="tbl"><thead><tr><th>' + (volMode === 'year' ? 'Year' : volMode === 'month' ? 'Month' : 'Week of') + '</th>' +
    '<th class="n">' + uName() + '</th><th class="n">Runs</th><th class="n">Time</th><th class="n">Pace</th><th class="n">Climb</th><th class="n">Load</th></tr></thead><tbody>';
  for (const x of buckets.slice().reverse().slice(0, 80)) {
    const lbl = volMode === 'year' ? x.key : fmtDate(x.key, volMode === 'month' ? { month: 'long', year: 'numeric' } : undefined);
    h += '<tr><td>' + lbl + '</td><td class="n">' + dist(x.m) + '</td><td class="n">' + x.n + '</td>' +
      '<td class="n">' + hm(x.sec) + '</td><td class="n">' + (x.pace ? fmtPace(App.unit === 'mi' ? x.pace * 1.609344 : x.pace) : '–') + '</td>' +
      '<td class="n">' + (x.elev ? Math.round(App.unit === 'mi' ? x.elev * 3.28084 : x.elev) : '–') + '</td>' +
      '<td class="n">' + Math.round(x.load) + '</td></tr>';
  }
  h += '</tbody></table></div></div>';

  v.innerHTML = h;
  $$('[data-vol]', v).forEach(btn => btn.addEventListener('click', () => { volMode = btn.dataset.vol; renderVolume(); }));

  volumeChart('c-vol', buckets, labels, avgW);
  distHist('c-hist', App.train);

  const dowM = new Array(7).fill(0);
  for (const r of App.train) dowM[(new Date(localMs(r)).getUTCDay() + 6) % 7] += r.m;
  const p = palette();
  mkChart('c-dow', {
    type: 'bar',
    data: { labels: DOW, datasets: [{ label: uName(), data: dowM.map(m => +toU(m).toFixed(0)), backgroundColor: alpha(p.sage, .6), hoverBackgroundColor: p.sage, borderRadius: 2 }] },
    options: baseOpts(p, { plugins: { tooltip: { callbacks: { label: tipDist } } }, scales: { y: { beginAtZero: true } } })
  });
}

/* ---------------------------------------------------------- PERFORMANCE */
let perfIndoor = false;
function renderPerf() {
  const v = $('#v-perf');
  if (!App.ready) { v.innerHTML = emptyState(); return; }
  const fit = App.fit;

  let h = '<div class="sechead"><h1>Performance</h1>' +
    '<p class="sub">Best efforts are taken from inside your runs where distance samples allow it — the fastest 5&nbsp;km you ' +
    'ever ran, not the average pace of a run that happened to be 5&nbsp;km long.</p></div>';

  /* best efforts */
  let be = '<div class="panel"><div class="ph"><h3>Best efforts</h3><div class="tiny">' +
    (App.meta.runsWithSplits ? App.meta.runsWithSplits + ' runs had usable distance samples' : 'No distance samples were available, so these are whole-run averages') +
    '</div></div><div class="scroller"><table class="tbl"><thead><tr><th>Distance</th><th class="n">Best</th><th class="n">Pace</th>' +
    '<th class="n">VDOT</th><th>When</th><th>Was it a real effort?</th><th class="n">Use</th></tr></thead><tbody>';
  let any = false;
  const muted = (loadSettings().mutedEfforts) || {};
  const byCand = {};
  if (fit) for (const c of fit.cands) byCand[c.m] = c;
  for (const t of TARGETS) {
    const b = App.best[t.m];
    if (!b) continue;
    any = true;
    const c = byCand[t.m];
    const run = App.train.find(r => r.id === b.runId);
    const q = c ? c.maximal : null;
    const bar = q === null ? '<span class="tiny">not scored</span>'
      : '<span class="qbar" title="' + esc(c.why.join('; ')) + '"><i style="width:' + Math.round(q * 100) + '%"></i></span> ' +
        '<span class="tiny">' + (q >= 0.7 ? 'looks maximal' : q >= 0.45 ? 'hard, not all-out' : 'sub-maximal — a floor only') + '</span>';
    be += '<tr' + (muted[t.m] ? ' class="muted"' : '') + '><td><strong>' + t.label + '</strong>' +
      (run && run.kind ? ' <span class="pill ' + (RUN_KINDS[run.kind] || {}).pill + '">' + esc((RUN_KINDS[run.kind] || {}).label) + '</span>' : '') + '</td>' +
      '<td class="n">' + hms(b.sec) + '</td>' +
      '<td class="n">' + paceStr(b.sec, t.m, false) + '</td>' +
      '<td class="n">' + vdotFrom(t.m, b.sec).toFixed(1) + '</td>' +
      '<td>' + fmtDate(b.date) + (b.indoor ? ' <span class="pill amber">indoor</span>' : '') + '</td>' +
      '<td class="tiny">' + bar + '<br>' + (b.method === 'split' ? 'fastest segment inside a run' : 'whole-run average') + '</td>' +
      '<td class="n"><input type="checkbox" data-mute="' + t.m + '"' + (muted[t.m] ? '' : ' checked') + '></td></tr>';
  }
  be += '</tbody></table></div><div class="pb tiny">Untick anything that was not really yours \u2014 a GPS glitch, a downhill, a run with a faster friend. It is removed from the model immediately.</div></div>';
  h += any ? be : '<div class="note warn">No efforts long enough to rank yet — import runs with distance samples, or wait until a few more runs land.</div>';

  /* prediction detail */
  if (fit) {
    h += '<div class="sechead"><h2>Race predictions, and why</h2></div>';
    h += raceBoard(fit, null);
    h += '<div class="grid g2" style="margin-top:14px">';
    h += '<div class="panel"><div class="ph"><h3>What the model is doing</h3></div><div class="pb"><dl class="kv">' +
      '<dt>Anchor effort</dt><dd>' + esc(fit.anchor.label) + ' · ' + hms(fit.anchor.sec) +
        (fit.anchor.entered ? ' <span class="pill clay">you entered this</span>' : '') + '</dd>' +
      '<dt>VDOT</dt><dd>' + fit.vdot.toFixed(1) + '</dd>' +
      '<dt>Fatigue exponent</dt><dd>' + fit.riegel.toFixed(3) + (fit.riegelFitted ? ' fitted' : ' default') + '</dd>' +
      '<dt>Recent volume</dt><dd>' + dist(fit.weeklyM) + ' ' + uName() + '/wk</dd>' +
      '<dt>Longest recent run</dt><dd>' + dist(fit.longest) + ' ' + uName() + '</dd>' +
      '</dl><p class="tiny" style="margin-top:10px"><strong>Best evidence, not average evidence.</strong> Every effort on record is a <em>lower bound</em> — a 10&nbsp;km lifted out of a steady long run proves you can run at least that fast, and proves nothing about your ceiling. So the model takes the strongest effort rather than the mean of all of them. Averaging a race in with a set of easy runs can only ever bias the answer one way, and that is exactly how a predictor ends up handing a 3:15 marathoner 6:30/km as their easy pace.</p>' +
      '<p class="tiny" style="margin-top:8px">From the anchor, two methods are averaged: Riegel scaling with an exponent fitted to your own results, and a Daniels VDOT lookup. Paces on hilly runs are grade-adjusted first. The marathon and half are then slowed by an endurance penalty when weekly volume falls short of what those distances demand.</p>' +
      (fit.submax ? '<div class="note warn" style="margin-top:10px"><strong>Nothing on file looks like a maximal effort.</strong> Your best efforts all came out of runs that were not raced, so this estimate is a floor: you are almost certainly faster than it says. Enter a race result below, or run a hard 5&nbsp;km, and everything here sharpens.</div>' : '') +
      (!fit.corroborated && !fit.submax ? '<p class="tiny" style="margin-top:8px">Only one effort is doing the work here. A second hard effort at a different distance would tighten these ranges considerably.</p>' : '') +
      '</div></div>';

    h += '<div class="panel"><div class="ph"><h3>Training paces</h3><div class="tiny">From VDOT ' + fit.vdot.toFixed(1) + '</div></div>' +
      '<div class="scroller"><table class="tbl"><tbody>' +
      paceRow('Easy', 'E', fit, 'Most of your running. Builds the engine without the cost.') +
      paceRow('Marathon', 'M', fit, 'Steady, controlled, sustainable for hours.') +
      paceRow('Threshold', 'T', fit, 'Comfortably hard — roughly one-hour race effort.') +
      paceRow('Interval', 'I', fit, 'Hard 3–5 minute reps. Raises the ceiling.') +
      paceRow('Repetition', 'R', fit, 'Short and fast for economy, not for fitness.') +
      '</tbody></table></div></div></div>';

    h += '<div class="grid g2" style="margin-top:14px">' +
      '<div class="panel"><div class="ph"><h3>Effort curve</h3><div class="tiny">Your bests against the modelled curve</div></div>' +
      '<div class="pb"><div class="chartbox"><canvas id="c-curve"></canvas></div></div></div>' +
      '<div class="panel"><div class="ph"><h3>Fitness trend</h3><div class="tiny">Rolling best VDOT from efforts inside your runs</div></div>' +
      '<div class="pb"><div class="chartbox"><canvas id="c-vdot"></canvas></div></div></div></div>';
  }

  /* ---- tell the model what it cannot know ---- */
  const st = loadSettings();
  const rc = st.race || {};
  h += '<div class="sechead"><h2>Correct the model</h2>' +
    '<p class="sub">A result you actually raced beats anything that can be inferred from training. Enter one and it becomes the anchor for every number on this page and every pace in your plan.</p></div>' +
    '<div class="panel"><div class="pb"><div class="grid g4">' +
    fld('Distance', '<select id="rcDist">' + ['', '5000', '10000', '21097.5', '42195', 'other'].map(v =>
      '<option value="' + v + '"' + (String(rc.m || '') === v ? ' selected' : '') + '>' +
      (v === '' ? 'none entered' : v === 'other' ? 'other' : { '5000': '5K', '10000': '10K', '21097.5': 'Half marathon', '42195': 'Marathon' }[v]) + '</option>').join('') + '</select>') +
    fld('Time', '<input type="text" id="rcTime" placeholder="e.g. 42:30 or 1:38:20" value="' + esc(rc.sec ? hms(rc.sec) : '') + '">') +
    fld('Date', '<input type="date" id="rcDate" value="' + esc(rc.date ? dayKey(rc.date) : '') + '">') +
    fld('\u00a0', '<button class="btn sm" type="button" id="rcSave">Use this result</button> <button class="btn sm ghost" type="button" id="rcClear">Clear</button>') +
    '</div><div id="rcOther" style="display:' + (String(rc.m) === 'other' || (rc.m && [5000, 10000, 21097.5, 42195].indexOf(+rc.m) < 0) ? '' : 'none') + '">' +
    fld('Distance in metres', '<input type="number" id="rcM" value="' + esc(rc.m || '') + '">') + '</div>' +
    '<div class="tiny" id="rcNote" style="margin-top:8px"></div></div></div>';

  /* ---- what kind of running have you been doing ---- */
  if (App.cls) {
    const mix = {};
    const recent = App.train.filter(r => Date.now() - r.start < 56 * DAY);
    for (const r of recent) mix[r.kind] = (mix[r.kind] || 0) + 1;
    const order = ['recovery', 'easy', 'long', 'steady', 'progression', 'threshold', 'intervals', 'race'];
    h += '<div class="sechead"><h2>What kind of running, actually</h2>' +
      '<p class="sub">Every run in the last eight weeks, sorted by what it actually was. The sort reads the <em>shape</em> of each run \u2014 the spread of paces inside it, whether the fast parts form one sustained block or several short ones with recoveries between, whether pace lifted through the run, and how close peak heart rate came to your observed maximum \u2014 rather than its average. Average pace and average heart rate cannot tell an 8&nbsp;\u00d7&nbsp;400&nbsp;m session from an easy run of the same distance; both are diluted by the jog recoveries in between.</p></div>' +
      '<div class="panel"><div class="pb"><div class="grid g3">' +
      order.filter(k => mix[k]).map(k => statTile(RUN_KINDS[k].label, mix[k], recent.length ? 'of ' + recent.length : '',
        Math.round((mix[k] / Math.max(1, recent.length)) * 100) + '% of recent runs')).join('') +
      '</div><dl class="kv" style="margin-top:12px">' +
      '<dt>Learned easy pace</dt><dd>' + (App.cls.easyRef ? paceOne(App.cls.easyRef) : '\u2014') + '</dd>' +
      '<dt>Observed max heart rate</dt><dd>' + (App.cls.hr.max ? App.cls.hr.max + ' bpm, from ' + App.cls.hr.n + ' runs' : 'no usable heart-rate data') + '</dd>' +
      '<dt>Set aside as walks</dt><dd>' + (App.walks || []).length + ' activit' + ((App.walks || []).length === 1 ? 'y' : 'ies') + '</dd>' +
      '<dt>Runs with a pace profile</dt><dd>' + App.train.filter(r => r.prof).length + ' of ' + App.train.length +
        ' <span class="tiny">without one, only average pace is available and the sort is far cruder</span></dd>' +
      '</dl></div></div>';
  }

  h += '<div class="sechead"><h2>Every run, plotted</h2>' +
    '<p class="sub">Distance against grade-adjusted pace, coloured by what kind of run it was. Walks and hikes are excluded. A healthy block shows a wide cloud: most runs slow, a few sharp.</p></div>' +
    '<div class="panel"><div class="pb"><div class="chartbox tall"><canvas id="c-scatter"></canvas></div></div></div>';

  v.innerHTML = h;
  if (fit) {
    effortCurve('c-curve', App.best, fit);
    vdotTrend('c-vdot');
  }
  paceScatter('c-scatter', App.train);
  wirePerf();
}

/* ------------------------------------------------ performance controls */
function parseClock(s) {
  const p = String(s || '').trim().split(':').map(Number);
  if (!p.length || p.some(x => !isFinite(x))) return 0;
  return p.reverse().reduce((a, v, i) => a + v * Math.pow(60, i), 0);
}
function wirePerf() {
  $$('[data-mute]').forEach(cb => cb.addEventListener('change', () => {
    const st = loadSettings(), mu = st.mutedEfforts || {};
    if (cb.checked) delete mu[cb.getAttribute('data-mute')];
    else mu[cb.getAttribute('data-mute')] = 1;
    saveSettings({ mutedEfforts: mu });
    recompute(); renderPerf();
  }));

  const dsel = $('#rcDist');
  if (dsel) dsel.addEventListener('change', () => {
    const o = $('#rcOther'); if (o) o.style.display = dsel.value === 'other' ? '' : 'none';
  });
  const save = $('#rcSave');
  if (save) save.addEventListener('click', () => {
    const note = $('#rcNote');
    const m = dsel.value === 'other' ? +($('#rcM') || {}).value : +dsel.value;
    const sec = parseClock($('#rcTime').value);
    const dt = $('#rcDate').value ? Date.parse($('#rcDate').value + 'T12:00:00Z') : Date.now();
    if (!(m > 1200)) { note.innerHTML = '<span class="bad">Pick a distance of at least 1200 m.</span>'; return; }
    if (!(sec > 180)) { note.innerHTML = '<span class="bad">Enter the time as mm:ss or h:mm:ss.</span>'; return; }
    const pace = sec / (m / 1000);
    if (pace < 130 || pace > 600) { note.innerHTML = '<span class="bad">That works out at ' + fmtPace(pace) + '/km, which does not look like a race result.</span>'; return; }
    saveSettings({ race: { m, sec, date: dt, label: m === 5000 ? '5K' : m === 10000 ? '10K' : m === 21097.5 ? 'Half' : m === 42195 ? 'Marathon' : Math.round(m) + ' m' } });
    recompute(); renderPerf(); renderOverview();
    const n2 = $('#rcNote'); if (n2) n2.innerHTML = 'Anchored to your entered result. VDOT is now ' + (App.fit ? App.fit.vdot.toFixed(1) : '\u2014') + '.';
  });
  const clr = $('#rcClear');
  if (clr) clr.addEventListener('click', () => { saveSettings({ race: null }); recompute(); renderPerf(); renderOverview(); });
}

function paceRow(name, z, fit, why) {
  return '<tr><td style="width:96px"><strong>' + name + '</strong> <span class="tiny">' + z + '</span></td>' +
    '<td class="n" style="width:110px">' + paceOne(fit.paces[z]) + '</td>' +
    '<td class="tiny">' + why + '</td></tr>';
}

function vdotTrend(id) {
  const pts = [];
  for (const r of App.train) {
    if (!r.pb) continue;
    let best = 0;
    for (const k in r.pb) { const m = +k; if (m < 1500) continue; const v = vdotFrom(m, r.pb[k]); if (v > best) best = v; }
    if (best > 0) pts.push({ ms: localMs(r), v: best });
  }
  if (pts.length < 4) {
    const c = document.getElementById(id);
    if (c && c.parentElement) c.parentElement.innerHTML = '<div class="empty tiny">Needs distance samples inside runs to build this trend. Re-import with split rebuilding switched on.</div>';
    return;
  }
  pts.sort((a, b) => a.ms - b.ms);
  const startW = startOfWeekUTC(pts[0].ms), endW = startOfWeekUTC(Date.now());
  const labels = [], vals = [];
  for (let w = startW; w <= endW; w += 7 * DAY) {
    const win = pts.filter(p => p.ms <= w + 7 * DAY && p.ms > w - 56 * DAY);
    labels.push(fmtShort(w));
    vals.push(win.length ? +Math.max.apply(null, win.map(p => p.v)).toFixed(1) : null);
  }
  lineChart(id, labels, [{ label: 'VDOT (8-week best)', data: vals, fill: true }], { scales: { y: { beginAtZero: false } } });
}

function emptyState() {
  return '<div class="empty"><h3>Nothing imported yet</h3>' +
    '<p class="tiny">Head to Import and drop in your Apple Health export.</p>' +
    '<p style="margin-top:14px"><button class="btn pri" type="button" onclick="go(\'import\')">Go to Import</button></p></div>';
}

/* ===================== 30 · charts ===================== */
const Charts = { live: new Map() };

function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function palette() {
  return {
    clay: cssVar('--clay'), slate: cssVar('--slate'), amber: cssVar('--amber'),
    sage: cssVar('--sage'), plum: cssVar('--plum'),
    ink: cssVar('--ink'), ink2: cssVar('--ink-2'), ink3: cssVar('--ink-3'),
    rule: cssVar('--rule'), ruleSoft: cssVar('--rule-soft'), surf: cssVar('--surface-2')
  };
}
function alpha(hex, a) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}

function baseOpts(p, extra) {
  const o = {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 350 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false, labels: { color: p.ink2, boxWidth: 10, boxHeight: 10, font: { size: 11, family: 'Inter' } } },
      tooltip: {
        backgroundColor: p.surf, titleColor: p.ink, bodyColor: p.ink2,
        borderColor: p.rule, borderWidth: 1, padding: 9, displayColors: true,
        boxWidth: 8, boxHeight: 8, cornerRadius: 5,
        titleFont: { family: 'Inter', size: 12, weight: '600' },
        bodyFont: { family: 'IBM Plex Mono', size: 11.5 }
      }
    },
    scales: {
      x: { grid: { display: false }, border: { color: p.rule },
           ticks: { color: p.ink3, font: { size: 10.5, family: 'Inter' }, maxRotation: 0, autoSkipPadding: 14 } },
      y: { grid: { color: p.ruleSoft, drawTicks: false }, border: { display: false },
           ticks: { color: p.ink3, font: { size: 10.5, family: 'IBM Plex Mono' }, padding: 6 } }
    }
  };
  return deepMerge(o, extra || {});
}
function deepMerge(a, b) {
  for (const k in b) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) { a[k] = deepMerge(a[k] || {}, b[k]); }
    else a[k] = b[k];
  }
  return a;
}

function mkChart(canvasId, cfg) {
  const c = document.getElementById(canvasId);
  if (!c || !window.Chart) return null;
  const old = Charts.live.get(canvasId);
  if (old) old.destroy();
  const ch = new Chart(c.getContext('2d'), cfg);
  Charts.live.set(canvasId, ch);
  return ch;
}
function destroyCharts() { Charts.live.forEach(c => c.destroy()); Charts.live.clear(); }

/* ---- shared tooltip formatters ---- */
const tipDist = ctx => ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(1) + ' ' + uName();
const tipPace = ctx => ctx.dataset.label + ': ' + fmtPace(ctx.parsed.y, true);

/* ---------- weekly / monthly volume ---------- */
function volumeChart(id, buckets, labels, avgWindow) {
  const p = palette();
  const km = buckets.map(b => +toU(b.m).toFixed(2));
  const avg = movingAvg(km, avgWindow || 4);
  return mkChart(id, {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: uName(), data: km, backgroundColor: alpha(p.clay, .55), hoverBackgroundColor: p.clay,
          borderColor: 'transparent', borderRadius: 2, barPercentage: .82, categoryPercentage: .94, order: 2 },
        { type: 'line', label: (avgWindow || 4) + '-period average', data: avg, borderColor: p.slate, borderWidth: 2,
          pointRadius: 0, tension: .3, order: 1 }
      ]
    },
    options: baseOpts(p, {
      plugins: { legend: { display: true, position: 'bottom' }, tooltip: { callbacks: { label: tipDist } } },
      scales: { y: { beginAtZero: true, title: { display: true, text: uLong(), color: p.ink3, font: { size: 10.5, family: 'Inter' } } } }
    })
  });
}
function movingAvg(a, w) {
  const out = [];
  for (let i = 0; i < a.length; i++) {
    const s = Math.max(0, i - w + 1);
    const slice = a.slice(s, i + 1);
    out.push(+(sum(slice) / slice.length).toFixed(2));
  }
  return out;
}

/* ---------- fitness / fatigue / form ---------- */
function loadChart(id, curve) {
  const p = palette();
  const step = Math.max(1, Math.ceil(curve.length / 420));
  const pts = curve.filter((_, i) => i % step === 0);
  return mkChart(id, {
    data: {
      labels: pts.map(d => fmtShort(d.ms)),
      datasets: [
        { type: 'line', label: 'Fitness', data: pts.map(d => +d.ctl.toFixed(1)), borderColor: p.slate,
          backgroundColor: alpha(p.slate, .13), fill: true, borderWidth: 2, pointRadius: 0, tension: .25, yAxisID: 'y' },
        { type: 'line', label: 'Fatigue', data: pts.map(d => +d.atl.toFixed(1)), borderColor: p.clay,
          borderWidth: 1.4, pointRadius: 0, tension: .25, borderDash: [4, 3], yAxisID: 'y' },
        { type: 'line', label: 'Form', data: pts.map(d => +d.tsb.toFixed(1)), borderColor: p.amber,
          borderWidth: 1.4, pointRadius: 0, tension: .25, yAxisID: 'y1' }
      ]
    },
    options: baseOpts(p, {
      plugins: { legend: { display: true, position: 'bottom' } },
      scales: {
        y: { title: { display: true, text: 'load', color: p.ink3, font: { size: 10.5, family: 'Inter' } } },
        y1: { position: 'right', grid: { display: false }, border: { display: false },
              ticks: { color: p.ink3, font: { size: 10.5, family: 'IBM Plex Mono' } },
              title: { display: true, text: 'form', color: p.ink3, font: { size: 10.5, family: 'Inter' } } }
      }
    })
  });
}

/* ---------- pace against distance ---------- */
function paceScatter(id, runs) {
  const p = palette();
  const now = Date.now();
  const age = r => clamp(1 - (now - r.start) / (400 * DAY), .12, 1);
  const colFor = k => ({ race: p.clay, intervals: p.clay, threshold: p.clay, progression: p.amber, steady: p.amber, long: p.slate, easy: p.sage, recovery: p.sage })[k] || p.slate;
  // one dataset per kind, so the legend explains itself and a kind can be hidden
  const order = ['easy', 'recovery', 'long', 'steady', 'progression', 'threshold', 'intervals', 'race'];
  const shown = order.filter(k => runs.some(r => r.kind === k));
  const sets = (shown.length ? shown : ['easy']).map(k => {
    const pts = runs.filter(r => (r.kind || 'easy') === k && r.m > 800 && r.dur > 240)
      .map(r => ({ x: +toU(r.m).toFixed(2), y: +(r.gap ? (App.unit === 'mi' ? r.gap * 1.609344 : r.gap) : paceOf(r.dur, r.m)).toFixed(1), r }));
    return {
      label: (RUN_KINDS[k] || { label: k }).label, data: pts,
      pointRadius: (RUN_KINDS[k] && RUN_KINDS[k].hard) ? 4 : 3, pointHoverRadius: 7,
      backgroundColor: pts.map(d => alpha(d.r.indoor ? p.amber : colFor(k), .16 + age(d.r) * .6)),
      borderColor: 'transparent'
    };
  });
  return mkChart(id, {
    type: 'scatter',
    data: { datasets: sets },
    options: baseOpts(p, {
      interaction: { mode: 'nearest', intersect: true },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, color: p.ink3, font: { size: 10.5, family: 'Inter' } } },
        tooltip: { callbacks: {
          title: c => fmtDate(c[0].raw.r.start),
          label: c => [
            (RUN_KINDS[c.raw.r.kind] || { label: 'Run' }).label + (c.raw.r.why ? ' \u2014 ' + c.raw.r.why : ''),
            dist(c.raw.r.m) + ' ' + uName() + ' in ' + hms(c.raw.r.dur),
            fmtPace(c.raw.y, true) + (c.raw.r.elev > 40 ? ' grade-adjusted' : ''),
            c.raw.r.hrAvg ? c.raw.r.hrAvg + ' bpm average' : null,
            c.raw.r.elev ? '+' + c.raw.r.elev + ' m climbed' : null
          ].filter(Boolean)
        } }
      },
      scales: {
        x: { type: 'linear', beginAtZero: true, grid: { color: p.ruleSoft },
             title: { display: true, text: uLong(), color: p.ink3, font: { size: 10.5, family: 'Inter' } } },
        y: { reverse: true, ticks: { callback: v => fmtPace(v) },
             title: { display: true, text: 'grade-adjusted pace per ' + uName(), color: p.ink3, font: { size: 10.5, family: 'Inter' } } }
      }
    })
  });
}

/* ---------- best-effort curve ---------- */
function effortCurve(id, best, fit) {
  const p = palette();
  const have = TARGETS.filter(t => best[t.m]).map(t => ({ x: +toU(t.m).toFixed(2), y: best[t.m].sec / toU(t.m), t }));
  const model = [];
  if (fit) {
    for (let m = 1000; m <= 42195; m *= 1.12) model.push({ x: +toU(m).toFixed(2), y: timeForVdot(m, fit.vdot) / toU(m) });
    model.push({ x: +toU(42195).toFixed(2), y: timeForVdot(42195, fit.vdot) / toU(42195) });
  }
  return mkChart(id, {
    type: 'scatter',
    data: {
      datasets: [
        { label: 'Modelled', data: model, showLine: true, borderColor: p.slate, borderWidth: 1.6,
          borderDash: [5, 4], pointRadius: 0, tension: .2 },
        { label: 'Your best', data: have, pointRadius: 5, pointHoverRadius: 8,
          backgroundColor: p.clay, borderColor: 'transparent' }
      ]
    },
    options: baseOpts(p, {
      interaction: { mode: 'nearest', intersect: true },
      plugins: { legend: { display: true, position: 'bottom' }, tooltip: { callbacks: {
        title: c => c[0].raw.t ? c[0].raw.t.label : 'Model',
        label: c => c.raw.t ? [hms(best[c.raw.t.m].sec), fmtPace(c.raw.y, true)] : fmtPace(c.raw.y, true)
      } } },
      scales: {
        x: { type: 'logarithmic', title: { display: true, text: uLong() + ' (log)', color: p.ink3, font: { size: 10.5, family: 'Inter' } },
             grid: { color: p.ruleSoft }, ticks: { callback: v => (v >= 1 && [1, 2, 5, 10, 21, 42, 3, 13, 26].some(k => Math.abs(v - k) < .35)) ? String(Math.round(v)) : '' } },
        y: { reverse: true, ticks: { callback: v => fmtPace(v) },
             title: { display: true, text: 'pace per ' + uName(), color: p.ink3, font: { size: 10.5, family: 'Inter' } } }
      }
    })
  });
}

/* ---------- distance histogram ---------- */
function distHist(id, runs) {
  const p = palette();
  const edges = App.unit === 'mi'
    ? [0, 3, 5, 8, 10, 13.1, 18, 26.2, 1e9]
    : [0, 5, 8, 12, 16, 21.1, 30, 42.2, 1e9];
  const labels = [];
  for (let i = 0; i < edges.length - 1; i++) labels.push(i === edges.length - 2 ? edges[i] + '+' : edges[i] + '–' + edges[i + 1]);
  const counts = new Array(labels.length).fill(0);
  for (const r of runs) {
    const d = toU(r.m);
    for (let i = 0; i < edges.length - 1; i++) if (d >= edges[i] && d < edges[i + 1]) { counts[i]++; break; }
  }
  return mkChart(id, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'runs', data: counts, backgroundColor: alpha(p.slate, .6), hoverBackgroundColor: p.slate, borderRadius: 2 }] },
    options: baseOpts(p, {
      plugins: { tooltip: { callbacks: { label: c => c.parsed.y + ' runs' } } },
      scales: { x: { title: { display: true, text: uLong() + ' per run', color: p.ink3, font: { size: 10.5, family: 'Inter' } } }, y: { beginAtZero: true } }
    })
  });
}

/* ---------- generic line ---------- */
function lineChart(id, labels, series, opts) {
  const p = palette();
  const cols = [p.clay, p.slate, p.amber, p.sage, p.plum];
  return mkChart(id, {
    type: 'line',
    data: {
      labels,
      datasets: series.map((s, i) => ({
        label: s.label, data: s.data, borderColor: s.color || cols[i % cols.length],
        backgroundColor: alpha(s.color || cols[i % cols.length], .12),
        fill: !!s.fill, borderWidth: 2, pointRadius: s.points ? 2.5 : 0, pointHoverRadius: 5,
        tension: .28, spanGaps: true, borderDash: s.dash || undefined
      }))
    },
    options: baseOpts(p, deepMerge({ plugins: { legend: { display: series.length > 1, position: 'bottom' } } }, opts || {}))
  });
}

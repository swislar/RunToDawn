/* Does the classifier actually recognise the sessions people do?
   The generator writes /tmp/truth.json alongside the export, so this is a
   real confusion matrix rather than eyeballing a few rows. The session that
   matters most is intervals: its average pace and average heart rate both
   look like an easy run, so anything that gets it right must be reading the
   shape of the run rather than its summary. */
const fs = require('fs'), vm = require('vm'), os = require('os'), path = require('path');
const TMP = os.tmpdir();
globalThis.window = globalThis;
globalThis.document = { readyState: 'complete', documentElement: {}, head: { appendChild() {} }, addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
for (const f of ['00-util', '10-parse', '20-metrics', '25-classify', '40-coach', '60-insights'])
  vm.runInThisContext(fs.readFileSync('src/js/' + f + '.js', 'utf8'), { filename: f });

/* Generator labels map onto app kinds; reps1k and intervals are both rep
   work, and the app does not try to distinguish 400s from 1Ks. */
const MAP = { reps1k: 'intervals' };

(async () => {
  const truth = JSON.parse(fs.readFileSync(path.join(TMP, 'truth.json'), 'utf8'));
  const buf = fs.readFileSync(path.join(TMP, 'export.xml'));
  const file = new Blob([buf]); file.name = 'export.xml';
  const res = await parseHealthExport(file, { splits: true, dedupe: true, routes: false }, () => {});
  App.runs = res.runs; App.best = res.best; App.meta = res.meta; App.unit = 'km';
  const cls = classifyRuns(App.runs);
  App.train = App.runs.filter(r => r.kind !== 'walk');
  App.walks = App.runs.filter(r => r.kind === 'walk');

  console.log('parsed', App.runs.length, 'runs |', App.runs.filter(r => r.prof).length, 'with a usable pace profile');
  console.log('HRmax estimated at', cls.hr.max, '(true 188) | learned easy pace', fmtPace(cls.easyRef) + '/km\n');

  /* match each truth row to the parsed run that starts nearest to it */
  const sorted = App.runs.slice().sort((a, b) => a.start - b.start);
  const conf = {}, totals = {};
  let matched = 0;
  for (const t of truth) {
    let best = null, bd = Infinity;
    for (const r of sorted) { const d = Math.abs(r.start - t.day); if (d < bd) { bd = d; best = r; } }
    if (!best || bd > 90 * 60 * 1000) continue;
    matched++;
    const want = MAP[t.kind] || t.kind;
    const got = best.kind;
    totals[want] = (totals[want] || 0) + 1;
    conf[want] = conf[want] || {};
    conf[want][got] = (conf[want][got] || 0) + 1;
  }

  const kinds = Object.keys(totals).sort();
  const all = Array.from(new Set([].concat.apply([], kinds.map(k => Object.keys(conf[k]))))).sort();
  console.log('--- confusion matrix (rows = truth, columns = classifier) ---');
  console.log('truth'.padEnd(13) + all.map(c => c.slice(0, 9).padStart(11)).join('') + '   n'.padStart(6) + '  correct');
  let fails = 0;
  for (const k of kinds) {
    const row = conf[k];
    const hit = (row[k] || 0) / totals[k];
    console.log(k.padEnd(13) + all.map(c => String(row[c] || '\u00b7').padStart(11)).join('') +
      String(totals[k]).padStart(6) + '   ' + (hit * 100).toFixed(0) + '%');
  }

  console.log('\n--- what has to be true ---');
  const check = (ok, msg) => { if (!ok) fails++; console.log((ok ? '  ok  ' : '  \u2717   ') + msg); };
  const rate = k => (conf[k] && conf[k][k] ? conf[k][k] : 0) / (totals[k] || 1);
  const hardRate = k => {
    const row = conf[k] || {};
    return HARD_KINDS.reduce((a, c) => a + (row[c] || 0), 0) / (totals[k] || 1);
  };

  check(rate('intervals') >= 0.85, 'intervals recognised as intervals (' + (rate('intervals') * 100).toFixed(0) + '%) \u2014 the session average pace cannot see');
  check(hardRate('intervals') >= 0.95, 'intervals always counted as hard work (' + (hardRate('intervals') * 100).toFixed(0) + '%)');
  check(rate('threshold') >= 0.80, 'threshold/tempo recognised (' + (rate('threshold') * 100).toFixed(0) + '%)');
  check(hardRate('threshold') >= 0.95, 'threshold always counted as hard work (' + (hardRate('threshold') * 100).toFixed(0) + '%)');
  check(rate('easy') >= 0.75, 'easy/zone 2 runs stay easy (' + (rate('easy') * 100).toFixed(0) + '%)');
  check(hardRate('easy') <= 0.05, 'easy runs are never counted as hard (' + (hardRate('easy') * 100).toFixed(0) + '% were)');
  check(hardRate('long') <= 0.10, 'long runs are not counted as hard work (' + (hardRate('long') * 100).toFixed(0) + '% were)');
  check(rate('long') >= 0.85, 'long runs recognised as long (' + (rate('long') * 100).toFixed(0) + '%)');
  check(rate('race') >= 0.99, 'the half-marathon race is recognised as a race');
  check((conf['walk'] && conf['walk']['walk']) === totals['walk'], 'the hike logged as a run is set aside as a walk');

  /* the downstream consequences */
  console.log('\n--- downstream ---');
  const fit = buildFitness(App.train, App.best, { hr: cls.hr, easyRef: cls.easyRef });
  App.fit = fit; App.load = computeLoad(App.train, fit.paces.T);
  console.log('  anchor', fit.anchor.label, hms(fit.anchor.sec), '| maximality', fit.anchor.maximal.toFixed(2), '| VDOT', fit.vdot.toFixed(1));
  for (const pr of fit.preds) console.log('   ', pr.label.padEnd(15), hms(pr.sec), pr.confidence);
  const sig = trainingSignals();
  console.log('  time in zone \u2014 easy', (sig.easyShare * 100).toFixed(0) + '%  moderate', (sig.moderateShare * 100).toFixed(0) + '%  hard', (sig.hardShare * 100).toFixed(0) + '%');
  console.log('  hard SESSIONS', (sig.hardSessionShare * 100).toFixed(0) + '% of runs | mix', JSON.stringify(sig.mix));

  /* An athlete doing two quality sessions and three easy runs a week is at
     roughly 60% easy BY RUN COUNT but ~80% by time, which is the number the
     80/20 literature actually refers to. Both should be reported honestly. */
  /* Two quality sessions a week is roughly 40% of SESSIONS but only ~15-20%
     of TIME, because most of an interval session is warm-up, jog recovery
     and cool-down. The time figure is the one the 80/20 research means. */
  /* The two numbers must disagree, and in the right direction: counting
     sessions says a third of this athlete's running is hard, while the clock
     says almost all their TIME is easy. Both are true, and only the second
     one is what the 80/20 literature is talking about. */
  check(sig.easyShare > 0.70 && sig.easyShare <= 0.97,
    'time-in-zone easy share is high (' + (sig.easyShare * 100).toFixed(0) + '%)');
  check(sig.easyShare > (1 - sig.hardSessionShare) + 0.15,
    'time-based easy share is far above the session-count figure (' +
      (sig.easyShare * 100).toFixed(0) + '% vs ' + ((1 - sig.hardSessionShare) * 100).toFixed(0) + '%)');
  check(sig.hardShare > 0.03 && sig.hardShare < 0.25,
    'hard time is a realistic slice (' + (sig.hardShare * 100).toFixed(0) + '%)');
  check(sig.hardSessionShare > 0.25,
    'but hard SESSIONS are correctly counted as ' + (sig.hardSessionShare * 100).toFixed(0) + '% of runs');
  check(fit.anchor.maximal >= 0.6, 'the race anchors the model and scores as a real effort');
  check(fit.vdot > 46 && fit.vdot < 56, 'VDOT lands in a sane band for a 1:34 half (' + fit.vdot.toFixed(1) + ')');

  console.log('\n' + (fails ? 'FAIL ' + fails : 'all clean'));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });

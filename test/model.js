/* Does the physiology actually reproduce the published tables?
   Reference values are Daniels & Gilbert's VDOT race-time table and the
   training-pace table from Daniels' Running Formula. */
const fs = require('fs'), vm = require('vm');
globalThis.window = globalThis;
globalThis.document = { readyState: 'complete', documentElement: {}, head: { appendChild() {} }, addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
for (const f of ['00-util', '10-parse', '20-metrics', '25-classify'])
  vm.runInThisContext(fs.readFileSync('src/js/' + f + '.js', 'utf8'), { filename: f });

const toS = s => s.split(':').reverse().reduce((a, v, i) => a + +v * Math.pow(60, i), 0);
let fails = 0;
const near = (got, want, tolPct, what) => {
  const d = (got - want) / want * 100;
  const ok = Math.abs(d) <= tolPct;
  if (!ok) fails++;
  console.log((ok ? '  ok  ' : '  ✗   ') + what.padEnd(26) +
    hms(want).padStart(9) + ' vs ' + hms(got).padStart(9) + '  ' + (d >= 0 ? '+' : '') + d.toFixed(2) + '%');
};

console.log('--- race times vs Daniels VDOT table (±1.5%) ---');
const RACE = {
  40: ['24:08', '50:03', '1:50:59', '3:49:45'],
  45: ['21:50', '45:16', '1:40:20', '3:28:26'],
  50: ['19:57', '41:21', '1:31:35', '3:10:49'],
  55: ['18:22', '38:06', '1:24:20', '2:56:01'],
  60: ['17:03', '35:22', '1:18:09', '2:43:25'],
  65: ['15:54', '33:01', '1:12:53', '2:32:35']
};
const D = [5000, 10000, 21097.5, 42195], DN = ['5K', '10K', 'HM', 'FM'];
for (const v of Object.keys(RACE))
  for (let i = 0; i < 4; i++) near(timeForVdot(D[i], +v), toS(RACE[v][i]), 1.5, 'VDOT ' + v + ' ' + DN[i]);

console.log('\n--- training paces per km vs Daniels (±2.5%) ---');
const PACE = {
  40: { Efast: '5:58', Eslow: '6:39', M: '5:22', T: '5:00', I: '4:36', R: '4:16' },
  50: { Efast: '5:06', Eslow: '5:41', M: '4:38', T: '4:19', I: '3:59', R: '3:41' },
  60: { Efast: '4:31', Eslow: '5:02', M: '4:05', T: '3:50', I: '3:32', R: '3:16' }
};
for (const v of Object.keys(PACE))
  for (const z of ['Efast', 'Eslow', 'M', 'T', 'I', 'R'])
    near(zonePace(+v, z), toS(PACE[v][z]), 2.5, 'VDOT ' + v + ' ' + z + ' pace');

console.log('\n--- round trip: vdotFrom(timeForVdot(v)) === v ---');
for (const v of [38, 44, 52, 61]) for (const d of D) {
  const back = vdotFrom(d, timeForVdot(d, v));
  const ok = Math.abs(back - v) < 0.05;
  if (!ok) fails++;
  console.log((ok ? '  ok  ' : '  ✗   ') + 'VDOT ' + v + ' @ ' + d + 'm -> ' + back.toFixed(3));
}

console.log('\n--- grade adjustment is bounded and directional ---');
const cases = [[300, 0, 10000, 300], [300, 100, 10000, 300 - 3.5], [300, 5000, 10000, 255]];
for (const [p, asc, dist, want] of cases) {
  const got = gapAdjust(p, asc, dist);
  const ok = Math.abs(got - want) < 0.6;
  if (!ok) fails++;
  console.log((ok ? '  ok  ' : '  ✗   ') + `pace ${p} +${asc}m/${dist}m -> ${got.toFixed(1)} (want ~${want})`);
}

console.log('\n--- upper envelope beats the mean on a mixed-effort athlete ---');
/* An athlete with one genuine 5K race and a pile of easy long runs. The old
   mean-of-efforts model produced a VDOT roughly halfway between the two,
   which is faster than they can run a marathon and slower than they can run
   anything short. The envelope should land on the race. */
const best = {
  5000:    { sec: toS('19:57'), date: Date.now() - 20 * 86400000, runId: 1, method: 'split' },
  10000:   { sec: toS('58:00'), date: Date.now() - 10 * 86400000, runId: 2, method: 'split' },
  21097.5: { sec: toS('2:09:00'), date: Date.now() - 12 * 86400000, runId: 3, method: 'split' }
};
const runs = [
  { id: 1, start: Date.now() - 20 * 86400000, m: 5200, dur: toS('20:50'), hrAvg: 178, hrMax: 189, elev: 20 },
  { id: 2, start: Date.now() - 10 * 86400000, m: 16000, dur: toS('1:33:00'), hrAvg: 140, hrMax: 155, elev: 60 },
  { id: 3, start: Date.now() - 12 * 86400000, m: 24000, dur: toS('2:27:00'), hrAvg: 142, hrMax: 158, elev: 90 }
];
for (let i = 0; i < 20; i++) runs.push({ id: 10 + i, start: Date.now() - (30 + i) * 86400000, m: 10000, dur: toS('58:20'), hrAvg: 139, hrMax: 152, elev: 40 });
runs.sort((a, b) => a.start - b.start);
const cls = classifyRuns(runs);
const fit = buildFitness(runs, best, { hr: cls.hr, easyRef: cls.easyRef });
console.log('  anchor', fit.anchor.label, hms(fit.anchor.sec), '| VDOT', fit.vdot.toFixed(1), '| E pace', fmtPace(fit.paces.E));
const okv = fit.vdot >= 48 && fit.vdot <= 52;
if (!okv) fails++;
console.log((okv ? '  ok  ' : '  ✗   ') + 'VDOT should sit on the 5K race (~50), not the average of race and long runs (~42)');
const eOk = fit.paces.Efast < 315 && fit.paces.Eslow < 350;
if (!eOk) fails++;
console.log((eOk ? '  ok  ' : '  ✗   ') + 'easy range should be about 5:06\u20135:41/km, got ' +
  fmtPace(fit.paces.Efast) + '\u2013' + fmtPace(fit.paces.Eslow));

console.log('\n--- manual race entry overrides everything ---');
const fit2 = buildFitness(runs, best, { hr: cls.hr, easyRef: cls.easyRef, race: { m: 10000, sec: toS('38:00'), date: Date.now() - 5 * 86400000, label: '10K race' } });
const mOk = fit2.anchor.entered === true && fit2.vdot > fit.vdot;
if (!mOk) fails++;
console.log((mOk ? '  ok  ' : '  ✗   ') + 'entered 10K 38:00 becomes the anchor, VDOT ' + fit2.vdot.toFixed(1));

console.log('\n' + (fails ? 'FAIL ' + fails : 'all clean'));
process.exit(fails ? 1 : 0);

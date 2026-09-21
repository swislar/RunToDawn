/* The route heatmap reads GPS tracks out of workout-routes/*.gpx inside the
   export zip — a path that never runs when a bare export.xml is imported, so
   it needs its own test with a real zip. */
const fs = require('fs'), vm = require('vm'), os = require('os'), path = require('path');
const TMP = os.tmpdir();
const JSZip = require('jszip');
globalThis.window = globalThis;
globalThis.document = { readyState: 'complete', documentElement: {}, head: { appendChild() {} }, addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.JSZip = JSZip;
for (const f of ['00-util', '10-parse', '20-metrics', '25-classify'])
  vm.runInThisContext(fs.readFileSync('src/js/' + f + '.js', 'utf8'), { filename: f });

let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log((ok ? '  ok  ' : '  \u2717   ') + msg); };

/* A loop starting at a fixed point, walked as a rough rectangle. Running the
   same loop many times is what a heatmap is for, so most of the tracks here
   repeat with small GPS jitter, exactly like real ones. */
function gpxLoop(dateISO, lat0, lon0, size, points, jitter) {
  let s = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Apple Health Export">\n' +
    '<metadata><time>' + dateISO + '</time></metadata>\n<trk><name>Route</name><trkseg>\n';
  let t = Date.parse(dateISO);
  for (let i = 0; i < points; i++) {
    const f = i / points, leg = Math.floor(f * 4), g = (f * 4) % 1;
    let dLat = 0, dLon = 0;
    if (leg === 0) { dLat = 0; dLon = g * size; }
    else if (leg === 1) { dLat = g * size; dLon = size; }
    else if (leg === 2) { dLat = size; dLon = (1 - g) * size; }
    else { dLat = (1 - g) * size; dLon = 0; }
    const jl = (Math.random() - 0.5) * jitter, jo = (Math.random() - 0.5) * jitter;
    s += '<trkpt lat="' + (lat0 + dLat + jl).toFixed(7) + '" lon="' + (lon0 + dLon + jo).toFixed(7) + '">' +
      '<ele>15.0</ele><time>' + new Date(t).toISOString() + '</time></trkpt>\n';
    t += 5000;
  }
  return s + '</trkseg></trk></gpx>\n';
}

(async () => {
  const xml = fs.readFileSync(path.join(TMP, 'export.xml'), 'utf8');
  const zip = new JSZip();
  zip.file('apple_health_export/export.xml', xml);

  const N = 40;
  for (let i = 0; i < N; i++) {
    const d = new Date(Date.now() - i * 3 * 86400000).toISOString();
    // three quarters on the usual loop, the rest somewhere else
    const home = i % 4 !== 0;
    const lat = home ? 1.4360 : 1.3000, lon = home ? 103.7860 : 103.8500;
    zip.file('apple_health_export/workout-routes/route_' + d.slice(0, 19).replace(/[:]/g, '') + '.gpx',
      gpxLoop(d, lat, lon, 0.009, 300, 0.00012));
  }
  // a junk file that must not crash anything
  zip.file('apple_health_export/workout-routes/route_broken.gpx', '<gpx><trk><trkseg></trkseg></trk></gpx>');
  zip.file('apple_health_export/electrocardiograms/ecg_1.csv', 'not,a,route\n');

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(path.join(TMP, 'export.zip'), buf);
  console.log('zip built:', (buf.length / 1048576).toFixed(1), 'MB,', N + 2, 'extra entries\n');

  const file = new Blob([buf]); file.name = 'export.zip'; 
  const t0 = Date.now();
  const res = await parseHealthExport(file, { splits: true, dedupe: true, routes: true }, () => {});
  console.log('parsed in', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  console.log('meta:', JSON.stringify({ routesFound: res.meta.routesFound, routesUsed: res.meta.routesUsed, capped: res.meta.routesCapped, isZip: res.meta.isZip }), '\n');

  check(res.runs.length > 400, 'workouts still parse normally from inside a zip (' + res.runs.length + ' runs)');
  check(res.meta.routesFound === N + 1, 'every .gpx under workout-routes/ was found (' + res.meta.routesFound + ')');
  check(res.routes.length === N, 'the empty .gpx was skipped, the ' + N + ' real ones kept (' + res.routes.length + ')');
  check(res.routes.every(r => r.pts && r.pts.length >= 12), 'every kept route has points');
  check(res.routes.every(r => r.pts.length / 2 <= 220), 'every route is downsampled to the point budget');
  check(res.routes.every(r => r.date && Math.abs(Date.now() - r.date) < 200 * 86400000), 'each route carries a usable date');

  const pts = res.routes.reduce((a, r) => a + r.pts.length / 2, 0);
  const bytes = pts * 8;
  console.log('\n  ' + pts + ' points total, roughly ' + (bytes / 1024).toFixed(0) + ' KB stored');
  check(bytes / res.routes.length < 4000, 'storage per route stays small enough for IndexedDB');

  /* the non-zip path must not claim routes it cannot have */
  const bare = new Blob([xml]); bare.name = 'export.xml';
  const res2 = await parseHealthExport(bare, { splits: false, dedupe: true, routes: true }, () => {});
  check(res2.routes.length === 0 && res2.meta.isZip === false, 'a bare export.xml yields no routes and says so');

  /* lat/lon sanity: the loop we wrote must come back where we put it */
  const home = res.routes.filter(r => r.pts[0] > 1.40);
  check(home.length >= N * 0.6, 'the repeated home loop dominates (' + home.length + ' of ' + N + ')');
  const lats = [], lons = [];
  for (const r of home) for (let i = 0; i < r.pts.length; i += 2) { lats.push(r.pts[i]); lons.push(r.pts[i + 1]); }
  const span = Math.max.apply(null, lats) - Math.min.apply(null, lats);
  check(span > 0.005 && span < 0.02, 'the loop keeps its real shape after simplification (' + span.toFixed(4) + '\u00b0 tall)');

  console.log('\n' + (fails ? 'FAIL ' + fails : 'all clean'));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });

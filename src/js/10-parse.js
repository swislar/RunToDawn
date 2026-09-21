/* ===================== 10 · Apple Health export parser =====================
   export.xml is a single flat document that can run to hundreds of megabytes,
   so nothing here ever builds a DOM of the whole file. We stream bytes in,
   decode incrementally, and scan the text for the two element types we care
   about, keeping only an unterminated tail between chunks.
   ========================================================================= */

const ACT = {
  Running: 'run', Walking: 'walk', Hiking: 'hike', Cycling: 'bike',
  Swimming: 'swim', Elliptical: 'cross', Rowing: 'cross', StairClimbing: 'cross',
  HighIntensityIntervalTraining: 'hiit', TraditionalStrengthTraining: 'strength',
  FunctionalStrengthTraining: 'strength', CoreTraining: 'strength', Yoga: 'mobility'
};

const TARGETS = [
  { m: 1000,    label: '1K'   },
  { m: 1609.34, label: '1 mi' },
  { m: 3000,    label: '3K'   },
  { m: 5000,    label: '5K'   },
  { m: 10000,   label: '10K'  },
  { m: 15000,   label: '15K'  },
  { m: 21097.5, label: 'Half' },
  { m: 30000,   label: '30K'  },
  { m: 42195,   label: 'Marathon' }
];

/* "2024-03-17 06:42:11 +0800" -> {ms, tz} without touching Date's parser */
function fastDate(s) {
  if (!s || s.length < 19) return null;
  const y = +s.slice(0, 4), mo = +s.slice(5, 7), d = +s.slice(8, 10);
  const h = +s.slice(11, 13), mi = +s.slice(14, 16), se = +s.slice(17, 19);
  if (y !== y || mo !== mo || d !== d) return null;
  let tz = 0;
  if (s.length >= 25) {
    const sign = s.charCodeAt(20) === 45 ? -1 : 1;
    tz = sign * ((+s.slice(21, 23)) * 60 + (+s.slice(23, 25)));
  }
  return { ms: Date.UTC(y, mo - 1, d, h, mi, se) - tz * 60000, tz };
}

function attrIn(s, from, to, key) {
  const i = s.indexOf(key, from);
  if (i < 0 || i >= to) return null;
  const a = i + key.length;
  const b = s.indexOf('"', a);
  if (b < 0 || b > to) return null;
  return s.slice(a, b);
}

const LEN = { km: 1000, mi: 1609.344, m: 1, yd: 0.9144, ft: 0.3048 };
function metres(v, unit) {
  const n = parseFloat(v);
  if (!isFinite(n)) return 0;
  return n * (LEN[unit] || 1);
}
/** "1234.5 cm" / "45 m" -> metres */
function metresWithUnit(v) {
  if (!v) return 0;
  const p = String(v).trim().split(/\s+/);
  const n = parseFloat(p[0]);
  if (!isFinite(n)) return 0;
  const u = (p[1] || 'm').toLowerCase();
  if (u === 'cm') return n / 100;
  if (u === 'in') return n * 0.0254;
  return n * (LEN[u] || 1);
}

/* ---------------------------------------------------------------- scanner */
function makeScanner(opts) {
  const maxSamples = opts.maxSamples || 3000000;
  const workouts = [];
  const smp = { s: [], e: [], v: [], src: [] };   // distance samples
  const srcIds = new Map();
  const restHR = [], mass = [];
  let buf = '', trimmed = false, seenRecords = 0;

  const srcId = name => {
    let i = srcIds.get(name);
    if (i === undefined) { i = srcIds.size; srcIds.set(name, i); }
    return i;
  };

  function handleRecord(s, lt, gt) {
    seenRecords++;
    const type = attrIn(s, lt, gt, ' type="');
    if (!type) return;

    if (type.endsWith('DistanceWalkingRunning')) {
      if (!opts.splits) return;
      const val = attrIn(s, lt, gt, ' value="');
      if (!val) return;
      const n = parseFloat(val);
      if (!(n > 0)) return;
      const sd = fastDate(attrIn(s, lt, gt, ' startDate="'));
      const ed = fastDate(attrIn(s, lt, gt, ' endDate="'));
      if (!sd || !ed) return;
      const span = ed.ms - sd.ms;
      // A split sample is short. Hour-long background aggregates cannot
      // describe what happened inside a run, so they are dropped here.
      if (span < 0 || span > 600000) return;
      smp.s.push(sd.ms); smp.e.push(ed.ms);
      smp.v.push(metres(val, attrIn(s, lt, gt, ' unit="') || 'km'));
      smp.src.push(srcId(attrIn(s, lt, gt, ' sourceName="') || '?'));
      if (smp.s.length > maxSamples) {
        const drop = Math.floor(maxSamples / 3);
        smp.s.splice(0, drop); smp.e.splice(0, drop); smp.v.splice(0, drop); smp.src.splice(0, drop);
        trimmed = true;
      }
      return;
    }
    if (type.endsWith('RestingHeartRate')) {
      const d = fastDate(attrIn(s, lt, gt, ' startDate="'));
      const v = parseFloat(attrIn(s, lt, gt, ' value="'));
      if (d && isFinite(v)) restHR.push([d.ms, v]);
      return;
    }
    if (type.endsWith('IdentifierBodyMass')) {
      const d = fastDate(attrIn(s, lt, gt, ' startDate="'));
      const v = parseFloat(attrIn(s, lt, gt, ' value="'));
      const u = attrIn(s, lt, gt, ' unit="');
      if (d && isFinite(v)) mass.push([d.ms, u === 'lb' ? v * 0.453592 : v]);
    }
  }

  function handleWorkout(w) {
    const gt = w.indexOf('>');
    const rawAct = attrIn(w, 0, gt, ' workoutActivityType="') || '';
    const act = ACT[rawAct.replace('HKWorkoutActivityType', '')] || 'other';

    const sd = fastDate(attrIn(w, 0, gt, ' startDate="'));
    const ed = fastDate(attrIn(w, 0, gt, ' endDate="'));
    if (!sd) return;

    let dur = parseFloat(attrIn(w, 0, gt, ' duration="'));
    const durUnit = attrIn(w, 0, gt, ' durationUnit="') || 'min';
    if (!isFinite(dur)) dur = ed ? (ed.ms - sd.ms) / 60000 : 0;
    let sec = durUnit === 'sec' ? dur : durUnit === 'hr' ? dur * 3600 : dur * 60;

    // Pre-iOS16 exports carry distance on the element itself…
    let m = 0;
    const td = attrIn(w, 0, gt, ' totalDistance="');
    if (td) m = metres(td, attrIn(w, 0, gt, ' totalDistanceUnit="') || 'km');

    let kcal = 0, hrAvg = 0, hrMax = 0, elev = 0, indoor = false;
    const te = attrIn(w, 0, gt, ' totalEnergyBurned="');
    if (te) kcal = parseFloat(te) || 0;

    // …newer ones move it into WorkoutStatistics children.
    let i = gt;
    while ((i = w.indexOf('<WorkoutStatistics ', i)) >= 0) {
      const e = w.indexOf('>', i);
      if (e < 0) break;
      const t = attrIn(w, i, e, ' type="') || '';
      if (t.indexOf('Distance') >= 0 && !m) {
        m = metres(attrIn(w, i, e, ' sum="') || '0', attrIn(w, i, e, ' unit="') || 'km');
      } else if (t.endsWith('HeartRate')) {
        hrAvg = Math.round(parseFloat(attrIn(w, i, e, ' average="')) || 0);
        hrMax = Math.round(parseFloat(attrIn(w, i, e, ' maximum="')) || 0);
      } else if (t.endsWith('ActiveEnergyBurned') && !kcal) {
        kcal = Math.round(parseFloat(attrIn(w, i, e, ' sum="')) || 0);
      }
      i = e + 1;
    }

    i = gt;
    while ((i = w.indexOf('<MetadataEntry ', i)) >= 0) {
      const e = w.indexOf('>', i);
      if (e < 0) break;
      const k = attrIn(w, i, e, ' key="') || '';
      if (k === 'HKElevationAscended') elev = metresWithUnit(attrIn(w, i, e, ' value="'));
      else if (k === 'HKIndoorWorkout') indoor = attrIn(w, i, e, ' value="') === '1';
      i = e + 1;
    }

    workouts.push({
      type: act, start: sd.ms, end: ed ? ed.ms : sd.ms + sec * 1000, tz: sd.tz,
      dur: Math.round(sec), m: Math.round(m), hrAvg, hrMax,
      kcal: Math.round(kcal), elev: Math.round(elev), indoor,
      src: attrIn(w, 0, gt, ' sourceName="') || 'Unknown'
    });
  }

  function consume(final) {
    let i = 0, cut = 0;
    const n = buf.length;
    while (i < n) {
      const lt = buf.indexOf('<', i);
      if (lt < 0) { cut = n; break; }
      if (n - lt < 32 && !final) { cut = lt; break; }

      if (buf.startsWith('<Record ', lt)) {
        const gt = buf.indexOf('>', lt);
        if (gt < 0) { cut = lt; break; }
        let stop = gt + 1;
        if (buf.charCodeAt(gt - 1) !== 47) {                  // not self-closing
          const ce = buf.indexOf('</Record>', gt);
          if (ce < 0) { cut = lt; break; }
          stop = ce + 9;
        }
        handleRecord(buf, lt, gt);
        i = cut = stop;
      } else if (buf.startsWith('<Workout ', lt)) {
        const gt = buf.indexOf('>', lt);
        if (gt < 0) { cut = lt; break; }
        let stop = gt + 1;
        if (buf.charCodeAt(gt - 1) !== 47) {
          const ce = buf.indexOf('</Workout>', gt);
          if (ce < 0) { cut = lt; break; }
          stop = ce + 10;
        }
        handleWorkout(buf.slice(lt, stop));
        i = cut = stop;
      } else {
        i = cut = lt + 1;
      }
    }
    buf = cut ? buf.slice(cut) : buf;
  }

  return {
    feed(text) { buf += text; consume(false); },
    finish() { consume(true); buf = ''; return { workouts, smp, restHR, mass, trimmed, seenRecords, sources: srcIds }; }
  };
}

/* ------------------------------------------------------------ file readers */
async function readXmlBlob(blob, scanner, onProg) {
  const CH = 6 * 1024 * 1024;
  const dec = new TextDecoder('utf-8');
  let done = 0;
  for (let off = 0; off < blob.size; off += CH) {
    const part = blob.slice(off, Math.min(off + CH, blob.size));
    const bytes = new Uint8Array(await part.arrayBuffer());
    scanner.feed(dec.decode(bytes, { stream: true }));
    done += bytes.length;
    onProg(done / blob.size);
    await new Promise(r => setTimeout(r, 0));   // let the progress bar paint
  }
  scanner.feed(dec.decode());
}

function readZipEntry(entry, scanner, onProg) {
  return new Promise((resolve, reject) => {
    const st = entry.internalStream('string');
    st.on('data', (chunk, meta) => {
      st.pause();
      try { scanner.feed(chunk); } catch (e) { return reject(e); }
      if (meta && typeof meta.percent === 'number') onProg(meta.percent / 100);
      setTimeout(() => st.resume(), 0);
    });
    st.on('error', reject);
    st.on('end', () => resolve());
    st.resume();
  });
}

/* -------------------------------------------------------- GPS route files
   Apple Health export.zip carries the actual GPS track for a run as a
   separate file per workout, under workout-routes/*.gpx, never inside
   export.xml itself. There is no cheap link back to which run a given file
   belongs to without a second pass over export.xml's <WorkoutRoute>
   references, and a heatmap does not need that link — it only needs every
   track drawn on top of every other one — so routes are read and simplified
   independently of the workout list. */

/* [lat, lon] pairs out of a GPX file, in document order, without building a
   DOM (there can be thousands of these files; a DOM per file is real GC
   pressure). trkpt attribute order is lat-then-lon in every export seen, but
   this does not assume that. */
function extractTrkpts(text) {
  const pts = [];
  let i = 0;
  while (true) {
    const t = text.indexOf('<trkpt', i);
    if (t < 0) break;
    const gt = text.indexOf('>', t);
    if (gt < 0) break;
    const lat = parseFloat(attrIn(text, t, gt, ' lat="'));
    const lon = parseFloat(attrIn(text, t, gt, ' lon="'));
    if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) pts.push(lat, lon);
    i = gt + 1;
  }
  return pts;
}

/* Haversine-ish planar distance in metres, fine at the scale of one run. */
function fastMetres(lat1, lon1, lat2, lon2) {
  const kx = 111320 * Math.cos((lat1 * Math.PI) / 180), ky = 110540;
  const dx = (lon2 - lon1) * kx, dy = (lat2 - lat1) * ky;
  return Math.sqrt(dx * dx + dy * dy);
}

/* Drop GPS jitter (points that barely moved — a red light, a watch pause)
   with a minimum-gap filter, then stride down to a point budget so a
   three-hour marathon track costs the same to store and draw as a 5K. */
function simplifyRoute(flat, maxPoints) {
  if (flat.length < 8) return null;
  const kept = [flat[0], flat[1]];
  let lastLat = flat[0], lastLon = flat[1], len = 0;
  for (let i = 2; i < flat.length; i += 2) {
    const lat = flat[i], lon = flat[i + 1];
    const d = fastMetres(lastLat, lastLon, lat, lon);
    if (d < 9) continue;                      // jitter / stationary
    if (d > 2000) continue;                    // a GPS glitch, not a stride
    len += d;
    kept.push(lat, lon);
    lastLat = lat; lastLon = lon;
  }
  if (kept.length < 6) return null;
  const n = kept.length / 2;
  if (n <= maxPoints) return { pts: Float32Array.from(kept), len };
  const stride = n / maxPoints;
  const out = [];
  for (let k = 0; k < maxPoints; k++) {
    const idx = Math.min(n - 1, Math.round(k * stride)) * 2;
    out.push(kept[idx], kept[idx + 1]);
  }
  return { pts: Float32Array.from(out), len };
}

/* Read every workout-routes/*.gpx entry in the zip, simplify each, and cap
   the total so a decade of daily GPS tracks still fits comfortably in
   IndexedDB and paints in one frame. Most recent routes are kept first. */
async function readRoutes(zip, onProg) {
  const entries = [];
  zip.forEach((path, f) => { if (!f.dir && /workout-routes\/.*\.gpx$/i.test(path)) entries.push({ path, f }); });
  if (!entries.length) return { routes: [], total: 0, capped: false };
  entries.sort((a, b) => b.path.localeCompare(a.path));   // filenames are date-stamped: newest first

  const MAX_ROUTES = 1200, MAX_POINTS_EACH = 220;
  const capped = entries.length > MAX_ROUTES;
  const use = capped ? entries.slice(0, MAX_ROUTES) : entries;

  const routes = [];
  for (let i = 0; i < use.length; i++) {
    if (i % 12 === 0) { onProg(i / use.length); await new Promise(r => setTimeout(r, 0)); }
    let text;
    try { text = await use[i].f.async('string'); } catch (e) { continue; }
    const flat = extractTrkpts(text);
    const simplified = simplifyRoute(flat, MAX_POINTS_EACH);
    if (simplified) {
      const ti = text.indexOf('<time>');
      const te = ti >= 0 ? text.indexOf('</time>', ti) : -1;
      const ms = te > ti ? Date.parse(text.slice(ti + 6, te)) : NaN;
      simplified.date = isFinite(ms) ? ms : null;
      routes.push(simplified);
    }
  }
  onProg(1);
  return { routes, total: entries.length, capped };
}

function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = () => window.JSZip ? res(window.JSZip) : rej(new Error('zip-lib'));
    s.onerror = () => rej(new Error('zip-lib'));
    document.head.appendChild(s);
  });
}

/* ------------------------------------------------------------- entry point */
async function parseHealthExport(file, opts, report) {
  const t0 = performance.now();
  const scanner = makeScanner(opts);
  const isZip = /\.zip$/i.test(file.name) || file.type === 'application/zip';

  if (isZip) {
    report('Opening the archive', 0.02, 'A large zip is read into memory first — this is the slow part.');
    const JSZipLib = await loadJSZip();
    const zip = await JSZipLib.loadAsync(file);
    let entry = null;
    zip.forEach((path, f) => {
      if (!entry && /(^|\/)export\.xml$/i.test(path) && !f.dir) entry = f;
    });
    if (!entry) {
      zip.forEach((path, f) => { if (!entry && /\.xml$/i.test(path) && !/cda/i.test(path) && !f.dir) entry = f; });
    }
    if (!entry) throw new Error('No export.xml inside that zip. Check you exported from Health rather than another app.');
    report('Reading workouts', 0.05);
    await readZipEntry(entry, scanner, p => report('Reading workouts', 0.05 + p * 0.60));
    if (opts.routes !== false) {
      report('Reading GPS routes', 0.66);
      var routeResult = await readRoutes(zip, p => report('Reading GPS routes', 0.66 + p * 0.16));
    }
  } else {
    report('Reading workouts', 0.03);
    await readXmlBlob(file, scanner, p => report('Reading workouts', 0.03 + p * 0.77));
  }

  report('Sorting it out', 0.83);
  await new Promise(r => setTimeout(r, 0));
  const raw = scanner.finish();

  if (!raw.workouts.length) {
    throw new Error('No workouts found in that file. If it parsed quickly it may be export_cda.xml — the one to use is export.xml.');
  }

  /* ---- split runs from everything else, drop junk ---- */
  raw.workouts.sort((a, b) => a.start - b.start);
  let runs = [], other = [];
  for (const w of raw.workouts) {
    if (w.dur < 60 && w.m < 300) continue;
    if (w.type === 'run') runs.push(w); else other.push(w);
  }

  /* ---- merge duplicates from multiple recording apps ---- */
  let merged = 0;
  if (opts.dedupe && runs.length > 1) {
    const keep = [];
    for (const r of runs) {
      const prev = keep[keep.length - 1];
      if (prev && Math.abs(r.start - prev.start) < 240000) {
        const a = Math.max(r.m, prev.m) || 1;
        if (Math.abs(r.m - prev.m) / a < 0.2) {
          merged++;
          keep[keep.length - 1] = betterOf(prev, r);
          continue;
        }
      }
      keep.push(r);
    }
    runs = keep;
  }
  runs.forEach((r, i) => { r.id = i; });

  /* ---- rebuild splits, then best efforts ---- */
  report('Rebuilding splits', 0.88);
  await new Promise(r => setTimeout(r, 0));
  const best = {};
  let withSplits = 0;
  if (opts.splits && raw.smp.s.length) {
    withSplits = await computeBestEfforts(runs, raw.smp, best, p => report('Rebuilding splits', 0.88 + p * 0.10));
  }
  fillBestEffortsFromAverages(runs, best);

  return {
    runs, other, best,
    restHR: raw.restHR, mass: raw.mass,
    routes: routeResult ? routeResult.routes : [],
    meta: {
      file: file.name, bytes: file.size,
      imported: Date.now(),
      records: raw.seenRecords,
      samples: raw.smp.s.length,
      sampleTrimmed: raw.trimmed,
      runsWithSplits: withSplits,
      merged,
      sources: Array.from(raw.sources.keys()).slice(0, 40),
      routesFound: routeResult ? routeResult.total : 0,
      routesUsed: routeResult ? routeResult.routes.length : 0,
      routesCapped: routeResult ? routeResult.capped : false,
      isZip,
      ms: Math.round(performance.now() - t0)
    }
  };
}

function betterOf(a, b) {
  const score = w => (w.hrAvg ? 4 : 0) + (w.elev ? 2 : 0) + (w.m ? 1 : 0) + (/watch/i.test(w.src) ? 3 : 0);
  const sa = score(a), sb = score(b);
  const win = sb > sa ? b : a, lose = sb > sa ? a : b;
  // keep whichever field the winner is missing
  if (!win.m) win.m = lose.m;
  if (!win.hrAvg) { win.hrAvg = lose.hrAvg; win.hrMax = lose.hrMax; }
  if (!win.elev) win.elev = lose.elev;
  return win;
}

/* Time at a cumulative distance, interpolated between samples. */
function tAt(c, t, x) {
  let lo = 0, hi = c.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (c[mid] < x) lo = mid + 1; else hi = mid; }
  if (lo === 0) return t[0];
  const c0 = c[lo - 1], c1 = c[lo];
  const f = c1 > c0 ? (x - c0) / (c1 - c0) : 0;
  return t[lo - 1] + f * (t[lo] - t[lo - 1]);
}

/* ------------------------------------------------------- pace profile
   The single most useful thing the distance samples give us, and the thing
   average pace destroys. Resampling a run onto a fixed 200 m grid turns it
   into a distribution of paces rather than one number, and the SHAPE of that
   distribution is what separates the sessions people actually do:

     easy / zone 2   narrow — the 10th and 50th percentile nearly touch
     long            narrow, but a lot of it, often with a slow drift
     threshold       one sustained fast block: a wide gap, but few blocks
     intervals       bimodal — fast reps with recoveries between, so many
                     short separate blocks and a very wide p10-to-p90 gap

   Average pace cannot see any of this. An 8x400 session with jog recoveries
   averages out to something that looks like an easy run, which is precisely
   the failure mode this fixes. */
function paceProfile(c, t, total) {
  const STEP = 200;
  const cells = Math.floor(total / STEP);
  if (cells < 8) return null;

  const pace = new Float64Array(cells);          // seconds per km per 200 m cell
  for (let i = 0; i < cells; i++) {
    const a = tAt(c, t, i * STEP), b = tAt(c, t, (i + 1) * STEP);
    const sec = (b - a) / 1000;
    pace[i] = sec > 0 ? sec * 5 : 0;             // 200 m -> per km
  }
  const valid = Array.from(pace).filter(v => v > 120 && v < 1200);
  if (valid.length < 8) return null;
  const sorted = valid.slice().sort((a, b) => a - b);
  const q = f => sorted[clamp(Math.floor(f * (sorted.length - 1)), 0, sorted.length - 1)];
  const p10 = q(0.10), p25 = q(0.25), p50 = q(0.50), p75 = q(0.75), p90 = q(0.90);

  /* Contiguous blocks meaningfully faster than this run's own EASY portion.
     The baseline has to be the slow part of the run, not the median: a tempo
     session can be more than half fast, which would drag a median-based cut
     down onto the tempo itself and find no fast blocks at all. p75 sits in
     the warm-up / recovery pace of any session that has one, and collapses
     onto the run's own pace when it does not — so a flat easy run correctly
     reports zero blocks. Using the run's own percentile rather than an
     absolute pace makes the test identical for a 3-hour marathoner and a
     30-minute 10K runner. */
  const cut = p75 * 0.93;
  const blocks = [];
  let runLen = 0;
  for (let i = 0; i < cells; i++) {
    const fast = pace[i] > 120 && pace[i] < cut;
    if (fast) runLen += STEP;
    else if (runLen) { blocks.push(runLen); runLen = 0; }
  }
  if (runLen) blocks.push(runLen);
  const real = blocks.filter(b => b >= 200);
  const fastDist = sum(real);

  /* First half against second half. A progression run and a tempo run can
     produce an identical "one long fast block"; what separates them is that
     the progression's fast part is the END, while a tempo's sits in the
     middle with a warm-up and cool-down either side. A long run drifts the
     other way. */
  const halfAt = Math.floor(cells / 2);
  const med = a => { const v = a.filter(x => x > 120 && x < 1200).sort((x, y) => x - y); return v.length ? v[v.length >> 1] : 0; };
  const h1 = med(Array.from(pace.slice(0, halfAt))), h2 = med(Array.from(pace.slice(halfAt)));

  /* Time spent in each absolute pace band, in seconds. Storing the histogram
     rather than a single average is what lets the app compute a real
     time-in-zone distribution later, once it knows this athlete's threshold
     pace — which is the measure the 80/20 literature actually uses. Twenty-four
     buckets of 20 s/km covers 2:20/km to 10:00/km. */
  const B0 = 140, BW = 20, NB = 24;
  const bins = new Array(NB).fill(0);
  for (let i = 0; i < cells; i++) {
    const pk = pace[i];
    if (!(pk > 120 && pk < 1200)) continue;
    const b = clamp(Math.floor((pk - B0) / BW), 0, NB - 1);
    bins[b] += (pk / 1000) * STEP;                 // seconds spent in this cell
  }

  return {
    p10: Math.round(p10), p25: Math.round(p25), p50: Math.round(p50),
    p75: Math.round(p75), p90: Math.round(p90),
    spread: +(p75 / p10).toFixed(3),              // how bimodal, 1.0 = flat
    blocks: real.length,
    longestBlock: real.length ? Math.max.apply(null, real) : 0,
    fastFrac: +(fastDist / total).toFixed(3),
    drift: h1 ? +(h2 / h1).toFixed(3) : 1,        // <1 finished faster, >1 faded
    bins, binBase: B0, binWidth: BW
  };
}

async function computeBestEfforts(runs, smp, best, onProg) {
  const n = smp.s.length;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  // records stream out roughly chronologically; a sort makes the window search exact
  const arr = Array.from(order).sort((a, b) => smp.s[a] - smp.s[b]);
  const starts = new Float64Array(n);
  for (let i = 0; i < n; i++) starts[i] = smp.s[arr[i]];

  const lower = x => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (starts[m] < x) lo = m + 1; else hi = m; } return lo; };

  let withSplits = 0;
  for (let k = 0; k < runs.length; k++) {
    const r = runs[k];
    if (k % 60 === 0) { onProg(k / runs.length); await new Promise(res => setTimeout(res, 0)); }

    const from = lower(r.start - 60000);
    const groups = new Map();
    for (let i = from; i < n; i++) {
      const id = arr[i];
      if (smp.s[id] > r.end + 60000) break;
      if (smp.e[id] < r.start - 60000) continue;
      let g = groups.get(smp.src[id]);
      if (!g) { g = { t: [], v: [], total: 0 }; groups.set(smp.src[id], g); }
      g.t.push(smp.e[id]); g.v.push(smp.v[id]); g.total += smp.v[id];
    }
    if (!groups.size) continue;

    // Several apps may both have logged the run. Trust the one whose total
    // matches the workout, otherwise the one that recorded the most.
    let pick = null, bestScore = Infinity;
    for (const g of groups.values()) {
      if (g.t.length < 5) continue;
      const s = r.m ? Math.abs(g.total - r.m) / r.m : 1 / (g.total + 1);
      if (s < bestScore) { bestScore = s; pick = g; }
    }
    if (!pick || (r.m && bestScore > 0.35)) continue;

    const idx = pick.t.map((_, i) => i).sort((a, b) => pick.t[a] - pick.t[b]);
    const t = new Float64Array(idx.length), c = new Float64Array(idx.length);
    let acc = 0;
    for (let i = 0; i < idx.length; i++) { acc += pick.v[idx[i]]; t[i] = pick.t[idx[i]]; c[i] = acc; }
    const total = c[c.length - 1];
    if (total < 900) continue;
    withSplits++;
    r.splitTotal = Math.round(total);

    for (const tg of TARGETS) {
      if (total < tg.m) break;
      let bestSec = Infinity;
      for (let i = 0; i < c.length; i++) {
        const want = c[i] + tg.m;
        if (want > total) break;
        const sec = (tAt(c, t, want) - t[i]) / 1000;
        if (sec > 0 && sec < bestSec) bestSec = sec;
      }
      if (!isFinite(bestSec)) continue;
      if (bestSec / (tg.m / 1000) < 130) continue;   // faster than 2:10/km — bad data
      const cur = best[tg.m];
      if (!cur || bestSec < cur.sec) best[tg.m] = { sec: bestSec, date: r.start, runId: r.id, method: 'split', indoor: r.indoor };
      r.pb = r.pb || {};
      if (!r.pb[tg.m] || bestSec < r.pb[tg.m]) r.pb[tg.m] = bestSec;
    }

    r.prof = paceProfile(c, t, total);
  }
  onProg(1);
  return withSplits;
}

/* Where splits are missing, a run whose whole distance sits close to a target
   still tells us something — just labelled honestly as an average, not an effort. */
function fillBestEffortsFromAverages(runs, best) {
  for (const tg of TARGETS) {
    if (best[tg.m] && best[tg.m].method === 'split') continue;
    let bestSec = Infinity, hit = null;
    for (const r of runs) {
      if (!r.m || !r.dur) continue;
      if (r.m < tg.m * 0.97 || r.m > tg.m * 1.12) continue;
      const sec = r.dur * (tg.m / r.m);
      if (sec / (tg.m / 1000) < 130) continue;
      if (sec < bestSec) { bestSec = sec; hit = r; }
    }
    if (hit) {
      const cur = best[tg.m];
      if (!cur || bestSec < cur.sec) best[tg.m] = { sec: bestSec, date: hit.start, runId: hit.id, method: 'avg', indoor: hit.indoor };
    }
  }
}

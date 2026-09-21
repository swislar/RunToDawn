/* ===================== 20 · running science =====================
   VDOT after Daniels & Gilbert; Riegel with an exponent fitted to the
   athlete rather than assumed; load after the rTSS shape.
   ================================================================ */

const pctVO2 = t => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t); // t in minutes
const vo2At  = v => -4.60 + 0.182258 * v + 0.000104 * v * v;                                          // v in m/min

function vdotFrom(distM, sec) {
  const t = sec / 60;
  if (!(t > 0) || !(distM > 0)) return NaN;
  return vo2At(distM / t) / pctVO2(t);
}
/** metres/min that demands a given VO2 */
function velFor(vo2) {
  const a = 0.000104, b = 0.182258, c = -4.60 - vo2;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}
/** predicted time for a distance at a given VDOT */
function timeForVdot(distM, vdot) {
  let lo = 0.5, hi = 900;
  for (let i = 0; i < 90; i++) {
    const m = (lo + hi) / 2;
    if (vo2At(distM / m) - vdot * pctVO2(m) > 0) lo = m; else hi = m;
  }
  return (lo + hi) / 2 * 60;
}

/* Daniels' training intensities as a fraction of VDOT. A single fixed
   fraction per zone does not work: the percentage of VO2max that each zone
   sits at drifts downwards as VDOT rises — a 65 VDOT runner's threshold is a
   lower share of their maximum than a 40 VDOT runner's is. These rows are
   back-solved from the published pace tables at each VDOT and interpolated
   in between, which reproduces the book to within a second or two per km.
   Efast/Eslow are the two ends of the easy range; E is the middle. */
const ZONE_TAB = [
  { v: 40, Efast: 0.7217, Eslow: 0.6290, M: 0.8243, T: 0.9003, I: 0.9984, R: 1.0957 },
  { v: 45, Efast: 0.7133, Eslow: 0.6217, M: 0.8103, T: 0.8796, I: 0.9740, R: 1.0713 },
  { v: 50, Efast: 0.7027, Eslow: 0.6138, M: 0.7916, T: 0.8641, I: 0.9542, R: 1.0510 },
  { v: 55, Efast: 0.6918, Eslow: 0.6042, M: 0.7781, T: 0.8456, I: 0.9345, R: 1.0296 },
  { v: 60, Efast: 0.6808, Eslow: 0.5953, M: 0.7712, T: 0.8337, I: 0.9219, R: 1.0157 },
  { v: 65, Efast: 0.6743, Eslow: 0.5879, M: 0.7614, T: 0.8268, I: 0.9144, R: 1.0069 }
];
function zoneFrac(vdot, z) {
  const t = ZONE_TAB;
  if (vdot <= t[0].v) return t[0][z];
  if (vdot >= t[t.length - 1].v) return t[t.length - 1][z];
  for (let i = 1; i < t.length; i++) {
    if (vdot <= t[i].v) {
      const f = (vdot - t[i - 1].v) / (t[i].v - t[i - 1].v);
      return t[i - 1][z] + (t[i][z] - t[i - 1][z]) * f;
    }
  }
  return t[t.length - 1][z];
}
/** seconds per kilometre at a training zone */
function zonePace(vdot, z) {
  if (z === 'E') return (zonePace(vdot, 'Efast') + zonePace(vdot, 'Eslow')) / 2;
  const v = velFor(vdot * zoneFrac(vdot, z));
  return 1000 / v * 60;
}

/* ------------------------------------------------------------ aggregation */
function bucketRuns(runs) {
  const weeks = new Map(), months = new Map(), years = new Map(), days = new Map();
  for (const r of runs) {
    const lm = localMs(r);
    const wk = startOfWeekUTC(lm);
    const d = new Date(lm);
    const mo = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const yr = d.getUTCFullYear();
    const dk = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    add(weeks, wk, r); add(months, mo, r); add(years, yr, r); add(days, dk, r);
  }
  function add(map, key, r) {
    let b = map.get(key);
    if (!b) { b = { key, m: 0, sec: 0, n: 0, elev: 0, load: 0, hr: [], runs: [] }; map.set(key, b); }
    b.m += r.m; b.sec += r.dur; b.n++; b.elev += r.elev || 0; b.load += r.load || 0;
    if (r.hrAvg) b.hr.push(r.hrAvg);
    b.runs.push(r.id);
  }
  const fin = map => Array.from(map.values()).sort((a, b) => a.key - b.key)
    .map(b => (b.pace = b.m ? b.sec / (b.m / 1000) : 0, b.hrAvg = b.hr.length ? Math.round(mean(b.hr)) : 0, b));
  return { weeks: fin(weeks), months: fin(months), years: fin(years), days: fin(days) };
}

/** fill in weeks with no running so the chart tells the truth about gaps */
function denseWeeks(weeks, from, to) {
  if (!weeks.length) return [];
  const map = new Map(weeks.map(w => [w.key, w]));
  const start = from != null ? startOfWeekUTC(from) : weeks[0].key;
  const end = to != null ? startOfWeekUTC(to) : weeks[weeks.length - 1].key;
  const out = [];
  for (let k = start; k <= end; k += 7 * DAY) {
    out.push(map.get(k) || { key: k, m: 0, sec: 0, n: 0, elev: 0, load: 0, pace: 0, hrAvg: 0, runs: [] });
  }
  return out;
}

/* ------------------------------------------------------------------- load */
/** rTSS-shaped: an hour at threshold = 100. Needs a threshold speed. */
function computeLoad(runs, thrSecPerKm) {
  const thrSpeed = 1000 / thrSecPerKm;            // m/s
  for (const r of runs) {
    if (!r.dur) { r.load = 0; continue; }
    let speed = r.m ? r.m / r.dur : 0;
    if (!speed) { r.load = Math.round(r.dur / 3600 * 40); continue; }
    // reward climbing: roughly 1 % speed equivalent per 1 % gradient
    if (r.elev && r.m) speed *= 1 + clamp(r.elev / r.m, 0, 0.12) * 1.8;
    const IF = clamp(speed / thrSpeed, 0.4, 1.25);
    r.if = IF;
    r.load = Math.round(r.dur / 3600 * IF * IF * 100);
  }
}

/** Chronic vs acute load. CTL = 42-day, ATL = 7-day exponential averages. */
function loadCurve(runs, fromMs, toMs) {
  const daily = new Map();
  for (const r of runs) {
    const k = Math.floor(localMs(r) / DAY);
    daily.set(k, (daily.get(k) || 0) + (r.load || 0));
  }
  const a = Math.floor(fromMs / DAY), b = Math.floor(toMs / DAY);
  const kc = 2 / (42 + 1), ka = 2 / (7 + 1);
  let ctl = 0, atl = 0;
  const out = [];
  for (let d = a; d <= b; d++) {
    const v = daily.get(d) || 0;
    ctl = ctl + (v - ctl) * kc;
    atl = atl + (v - atl) * ka;
    out.push({ ms: d * DAY, load: v, ctl, atl, tsb: ctl - atl });
  }
  return out;
}

/* ------------------------------------------------- the fitness model */
function buildFitness(runs, best, opts) {
  opts = opts || {};
  const now = Date.now();
  const horizon = opts.horizonDays || 120;
  const useIndoor = !!opts.useIndoor;
  const muted = opts.muted || {};
  const hr = opts.hr || hrScale(runs);
  const easyRef = opts.easyRef || null;
  const byId = new Map(runs.map(r => [r.id, r]));

  /* ---- candidate efforts -------------------------------------------------
     Every best effort is a LOWER bound on what this athlete can do. A 10 km
     lifted out of the middle of a steady long run says "at least this fast";
     it never says "no faster than this". That asymmetry is the whole design:
     efforts are combined by taking the best evidence, not the average of it,
     because averaging an easy run into a race estimate can only ever make
     the answer wrong in one direction. */
  const cands = [];
  for (const tg of TARGETS) {
    const b = best[tg.m];
    if (!b) continue;
    if (b.indoor && !useIndoor) continue;
    if (muted[tg.m]) continue;
    const ageD = (now - b.date) / DAY;
    if (ageD > horizon * 2.5) continue;
    if (tg.m < 1500) continue;                       // too short to anchor an endurance model
    const run = byId.get(b.runId);
    const sec = run ? b.sec * (gapAdjust(b.sec / (tg.m / 1000), run.elev || 0, run.m || tg.m) / (b.sec / (tg.m / 1000))) : b.sec;
    const mx = maximality(b.sec, tg.m, run, hr, easyRef);
    cands.push({
      m: tg.m, label: tg.label, sec: b.sec, gapSec: sec, date: b.date, ageD,
      method: b.method, runId: b.runId, kind: run ? run.kind : null,
      maximal: mx.score, why: mx.why, vdot: vdotFrom(tg.m, sec)
    });
  }

  /* ---- a result the athlete typed in beats anything we inferred ---------- */
  let manual = null;
  if (opts.race && opts.race.m > 1200 && opts.race.sec > 180) {
    const ageD = (now - (opts.race.date || now)) / DAY;
    manual = {
      m: opts.race.m, label: opts.race.label || 'Entered result', sec: opts.race.sec, gapSec: opts.race.sec,
      date: opts.race.date || now, ageD, method: 'entered', maximal: 1, kind: 'race',
      why: ['you entered this result yourself'], vdot: vdotFrom(opts.race.m, opts.race.sec), entered: true
    };
    cands.push(manual);
  }
  if (!cands.length) return null;

  /* ---- staleness ---------------------------------------------------------
     Fitness is not lost at the same rate it is gained. Nothing is discounted
     for the first six weeks; after that roughly one VDOT point per ten weeks,
     bounded, so a genuine race from last spring still counts for something. */
  for (const c of cands) {
    c.stale = clamp((c.ageD - 42) / 70, 0, 4.5);
    c.est = c.vdot - c.stale;
    // an effort we are confident was maximal is trusted at face value; a
    // sub-maximal one is still a floor, so it can still win if it is fast
    c.trust = 0.55 + 0.45 * c.maximal;
  }

  const ranked = cands.slice().sort((a, b) => b.est - a.est);
  const anchor = ranked[0];
  const topVdot = cands.slice().sort((a, b) => b.vdot - a.vdot)[0];

  /* Upper envelope, not a mean. The best evidence sets the level; a second
     independent effort close behind it raises confidence but not the number. */
  let vdot = anchor.est;
  const second = ranked[1];
  const corroborated = !!(second && anchor.est - second.est < 1.5 && Math.abs(Math.log(second.m / anchor.m)) > 0.4);

  /* If the best thing on record is clearly not a maximal effort, the athlete
     is faster than this and we say so by nudging up a little and widening the
     optimistic side of every band. The nudge is deliberately small — half a
     VDOT point at worst — because guessing is not measuring. */
  const submax = anchor.maximal < 0.55 && !anchor.entered;
  if (submax) vdot += (0.55 - anchor.maximal) * 2.0;

  /* ---- Riegel exponent, fitted only to efforts worth fitting ------------- */
  let riegel = 1.06, fitted = false;
  const pts = cands.filter(c => c.m >= 1500 && c.maximal >= 0.5);
  if (pts.length >= 3 && Math.max.apply(null, pts.map(p => p.m)) / Math.min.apply(null, pts.map(p => p.m)) >= 2.5) {
    const x = pts.map(p => Math.log(p.m)), y = pts.map(p => Math.log(p.gapSec));
    const mx = mean(x), my = mean(y);
    let num = 0, den = 0;
    for (let i = 0; i < x.length; i++) { num += (x[i] - mx) * (y[i] - my); den += (x[i] - mx) ** 2; }
    if (den > 0) { const b = num / den; if (b > 1.01 && b < 1.30) { riegel = clamp(b, 1.02, 1.15); fitted = true; } }
  }

  // Volume: the honest brake on a marathon prediction.
  const recent = runs.filter(r => now - r.start < 56 * DAY);
  const weeklyM = sum(recent.map(r => r.m)) / 8;
  const longest = recent.length ? Math.max.apply(null, recent.map(r => r.m)) : 0;

  const races = [
    { m: 5000, label: '5K' }, { m: 10000, label: '10K' },
    { m: 21097.5, label: 'Half marathon' }, { m: 42195, label: 'Marathon' }
  ];

  const bestAt = m => {
    let hit = null;
    for (const t of TARGETS) if (Math.abs(t.m - m) < 60 && best[t.m]) hit = best[t.m];
    return hit;
  };

  const preds = races.map(rc => {
    const rieg = anchor.gapSec * Math.pow(rc.m / anchor.m, riegel);
    const dan = timeForVdot(rc.m, vdot);
    let sec = (rieg * 0.5 + dan * 0.5);

    // Endurance penalty. Riegel and VDOT both assume the aerobic base to
    // hold the pace; below roughly 60 km a week that assumption breaks,
    // worst at the marathon.
    const need = rc.m >= 42000 ? 64000 : rc.m >= 21000 ? 45000 : rc.m >= 10000 ? 32000 : 25000;
    const shortfall = clamp((need - weeklyM) / need, 0, 0.7);
    const sensitivity = rc.m >= 42000 ? 0.17 : rc.m >= 21000 ? 0.09 : rc.m >= 10000 ? 0.04 : 0.02;
    const penalty = shortfall * sensitivity;

    // Never run anything close to this far? Widen the range, don't hide it.
    const longRatio = longest ? longest / rc.m : 0;
    const stretch = clamp(1 - longRatio, 0, 1);

    sec = sec * (1 + penalty);

    // A prediction that is slower than something you have already run is not a
    // prediction, it is an error. Anchor to the proven result where one exists.
    const pb = bestAt(rc.m);
    const pbFresh = pb && (now - pb.date) < 200 * DAY && (!pb.indoor || useIndoor);
    if (pbFresh && sec > pb.sec) sec = pb.sec;

    let spread = 0.022 + Math.abs(Math.log(rc.m / anchor.m)) * 0.035 + stretch * 0.05 + clamp(anchor.ageD / 400, 0, 0.05);
    if (!corroborated) spread += 0.012;
    const upside = submax ? spread * 1.9 : spread;   // no maximal effort on file: the truth is probably faster

    return {
      m: rc.m, label: rc.label, sec,
      lo: sec * (1 - upside), hi: sec * (1 + spread * 1.25),
      penalty, stretch, pb: pb || null, pbFresh: !!pbFresh,
      confidence: stretch > 0.72 ? 'low' : (spread > 0.075 ? 'fair' : 'good')
    };
  });

  return {
    vdot, anchor, topVdot, riegel, riegelFitted: fitted, cands, preds,
    weeklyM, longest, submax, corroborated, manual, hr, easyRef,
    paces: {
      E: zonePace(vdot, 'E'), M: zonePace(vdot, 'M'), T: zonePace(vdot, 'T'),
      I: zonePace(vdot, 'I'), R: zonePace(vdot, 'R'),
      Efast: zonePace(vdot, 'Efast'), Eslow: zonePace(vdot, 'Eslow')
    }
  };
}

/* ---------------------------------------------------------- small summaries */
function rangeStats(runs, fromMs, toMs) {
  const r = runs.filter(x => x.start >= fromMs && x.start < toMs);
  const m = sum(r.map(x => x.m)), sec = sum(r.map(x => x.dur));
  return {
    n: r.length, m, sec, elev: sum(r.map(x => x.elev || 0)),
    load: sum(r.map(x => x.load || 0)),
    pace: m ? sec / (m / 1000) : 0,
    hr: (() => { const h = r.filter(x => x.hrAvg).map(x => x.hrAvg); return h.length ? Math.round(mean(h)) : 0; })(),
    runs: r
  };
}

function streaks(days) {
  const set = new Set(days.map(d => Math.floor(d.key / DAY)));
  let best = 0, cur = 0, run = 0;
  const all = Array.from(set).sort((a, b) => a - b);
  for (let i = 0; i < all.length; i++) {
    run = (i && all[i] === all[i - 1] + 1) ? run + 1 : 1;
    if (run > best) best = run;
  }
  const today = Math.floor(Date.now() / DAY);
  for (let d = today; set.has(d) || d === today; d--) { if (set.has(d)) cur++; else if (d !== today) break; }
  return { best, cur };
}

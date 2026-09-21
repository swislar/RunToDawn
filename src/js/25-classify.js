/* ===================== 25 · what kind of run was that? =====================
   Everything downstream — the fitness estimate, the easy/hard balance, the
   scatter plot — is only as good as knowing what each run was FOR. A 32 km
   long run at 6:10/km and a 5 km time trial at 4:05/km are not two points on
   the same curve, and averaging them is how a model ends up telling a 3:15
   marathoner to run 6:30/km easy.

   Three things happen here:
     1. grade adjustment      — a hilly run is faster than the watch says
     2. run classification    — recovery / easy / long / steady / workout / race
     3. effort maximality     — was that 5 km segment a real effort or a warm-up?
   ========================================================================= */

/* ---------------------------------------------------------- grade adjust */
/* Apple gives us total ascent, not a profile, so we can only correct for the
   average roughness of the route. The widely used field approximation is
   roughly 3.5 s per km for every 10 m climbed per km, on an out-and-back or
   loop where the descent gives some of it back. Capped, because a 1500 m
   vertical trail race is not a road 10K with a fudge factor. */
function gapAdjust(secPerKm, ascentM, distM) {
  if (!(distM > 0) || !(ascentM > 0)) return secPerKm;
  const perKm = ascentM / (distM / 1000);
  const gain = clamp(0.35 * perKm, 0, secPerKm * 0.15);
  return secPerKm - gain;
}
function runGap(r) {
  if (!r.m || !r.dur) return null;
  return gapAdjust(r.dur / (r.m / 1000), r.elev || 0, r.m);
}

/* --------------------------------------------------------------- HR scale */
/* No date of birth in the export, so max HR is taken from what the athlete has
   actually hit: the 97th percentile of per-run maxima, floored at their
   highest observed average. If barely any HR data exists we say so rather
   than inventing 220-minus-a-guess. */
function hrScale(runs) {
  const maxes = runs.map(r => r.hrMax).filter(v => v > 120 && v < 230).sort((a, b) => a - b);
  const avgs = runs.map(r => r.hrAvg).filter(v => v > 100 && v < 220);
  if (maxes.length < 8) return { max: null, n: maxes.length };
  const hi = maxes[Math.min(maxes.length - 1, Math.floor(maxes.length * 0.97))];
  const topAvg = avgs.length ? avgs.slice().sort((a, b) => b - a)[0] : 0;
  return { max: Math.max(hi, topAvg + 4), n: maxes.length, coverage: maxes.length / Math.max(1, runs.length) };
}

/* ----------------------------------------------------- walking detection */
/* Two independent reasons to call something a walk: it is slower than anyone
   runs, or it is slow-ish AND the heart rate never left the basement. The
   second catches hikes and run/walk commutes that the watch filed as runs. */
function walkLike(r, hr) {
  const gp = runGap(r);
  if (!gp) return false;
  if (gp > 600) return true;                                   // slower than 10:00/km
  if (gp > 480 && hr.max && r.hrAvg && r.hrAvg / hr.max < 0.62) return true;
  return false;
}

/* --------------------------------------------------------- classification */
const RUN_KINDS = {
  race:      { label: 'Race / time trial', pill: 'clay',  hard: true,  short: 'race' },
  intervals: { label: 'Intervals',         pill: 'clay',  hard: true,  short: 'reps' },
  threshold: { label: 'Threshold / tempo', pill: 'clay',  hard: true,  short: 'tempo' },
  progression: { label: 'Progression',     pill: 'amber', hard: true,  short: 'prog' },
  steady:    { label: 'Steady',            pill: 'amber', hard: false, short: 'steady' },
  long:      { label: 'Long run',          pill: 'slate', hard: false, short: 'long' },
  easy:      { label: 'Easy',              pill: 'sage',  hard: false, short: 'easy' },
  recovery:  { label: 'Recovery',          pill: 'sage',  hard: false, short: 'rec' },
  walk:      { label: 'Walk / hike',       pill: 'plum',  hard: false, short: 'walk' }
};
/* Only these count against the easy/hard balance. "Steady" deliberately does
   not: a steady run is grey-zone running, which is a different problem from
   too much hard work and is flagged separately. */
const HARD_KINDS = ['race', 'intervals', 'threshold', 'progression'];

/* The athlete's own easy pace, learned rather than assumed: the median
   grade-adjusted pace of the slower two thirds of their recent running. Using
   a median of the slow bulk means a block of hard workouts cannot drag the
   reference down, and one death-march long run cannot drag it up. */
function easyReference(runs, atMs, windowD) {
  const half = ((windowD || 120) * DAY) / 2;
  /* CENTRED on the run, not trailing it. A trailing window measures an
     improving athlete against their own six-week-old self, which biases every
     ratio by a couple of per cent — enough to push genuinely easy running
     into the "steady" bucket and make the easy/hard balance look worse than
     it is. */
  let pool = runs.filter(r => r.kind !== 'walk' && r.m >= 3000 && Math.abs(r.start - atMs) <= half);
  if (pool.length < 8) {
    pool = runs.filter(r => r.kind !== 'walk' && r.m >= 3000)
      .sort((a, b) => Math.abs(a.start - atMs) - Math.abs(b.start - atMs)).slice(0, 30);
  }
  if (!pool.length) return null;
  const paces = pool.map(runGap).filter(v => v).sort((a, b) => a - b);
  if (paces.length < 4) return paces.length ? median(paces) : null;
  /* Take the middle of the distribution: dropping the fastest quarter removes
     the workouts, dropping the slowest fifth removes the long-run drift and
     the recovery jogs. What is left is what this athlete calls easy. */
  const lo = Math.floor(paces.length * 0.25), hi = Math.ceil(paces.length * 0.80);
  return median(paces.slice(lo, Math.max(lo + 1, hi)));
}

function classifyRuns(runs) {
  const hr = hrScale(runs);
  for (const r of runs) { r.gap = runGap(r); r.kind = null; }

  // walks first — they must not pollute the easy reference
  for (const r of runs) if (walkLike(r, hr)) r.kind = 'walk';

  const dists = runs.filter(r => r.kind !== 'walk').map(r => r.m).sort((a, b) => a - b);
  const medDist = dists.length ? median(dists) : 8000;

  // easy pace drifts over a season, so it is recomputed per fortnight rather
  // than once for all time — but cached, because it is an O(n) scan each time
  const refCache = new Map();
  const refFor = ms => {
    const k = Math.floor(ms / (14 * DAY));
    if (!refCache.has(k)) refCache.set(k, easyReference(runs, ms, 120));
    return refCache.get(k);
  };

  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (r.kind === 'walk') continue;
    const ref = refFor(r.start) || r.gap || 360;
    r.easyRef = ref;
    const ratio = r.gap ? r.gap / ref : 1;                  // <1 = faster than easy on average
    const hrRel = (hr.max && r.hrAvg) ? r.hrAvg / hr.max : null;
    const hrPeak = (hr.max && r.hrMax) ? r.hrMax / hr.max : null;
    const isLong = r.m >= Math.max(medDist * 1.5, 15000);
    const pr = r.prof;

    /* ---- the profile, where we have one ------------------------------- */
    let shape = null;
    if (pr) {
      const fastOfEasy = pr.p10 / ref;             // how fast the fast parts are
      shape = {
        bimodal: pr.spread >= 1.22,                // fast and slow parts clearly apart
        sustained: pr.longestBlock >= 2400,        // one block of 2.4 km or more
        chopped: pr.blocks >= 3 && pr.longestBlock < 2400,
        hardBits: fastOfEasy <= 0.90,              // the fast parts really are fast
        fastFrac: pr.fastFrac
      };
    }

    /* ---- heart-rate corroboration ------------------------------------
       An interval session's AVERAGE heart rate is dragged down by the
       recoveries, so average HR is the wrong test. Peak HR is the right
       one: the reps themselves get close to maximum even though the
       session mean does not. */
    const hrSaysHard = hrPeak !== null ? hrPeak >= 0.93 : null;
    const hrSaysEasy = hrRel !== null ? hrRel < 0.75 : null;

    let kind, why = [];

    /* Race: fast the whole way, and fast relative to this athlete. */
    if (ratio <= 0.90 && r.m >= 3000 &&
        (hrRel === null || hrRel >= 0.86) &&
        (!shape || (!shape.bimodal && !shape.chopped))) {
      kind = 'race'; why.push('fast from start to finish');
    }
    /* Intervals: several separate fast blocks with recoveries between them.
       The tell is many short fast blocks, not one long one. */
    else if (shape && shape.hardBits && shape.chopped && shape.bimodal &&
             shape.fastFrac < 0.62 && (hrSaysHard !== false || hrSaysEasy === false)) {
      kind = 'intervals'; why.push(pr.blocks + ' separate fast blocks with recoveries between');
    }
    /* Progression before threshold: both show one long fast block, and the
       thing that tells them apart is WHERE it sits. A progression finishes
       fast, so its second half is markedly quicker than its first. A tempo
       has the block in the middle, between a warm-up and a cool-down, so the
       two halves come out close to level. */
    else if (shape && shape.hardBits && pr.drift <= 0.94 && pr.p90 / pr.p10 >= 1.12) {
      kind = 'progression'; why.push('pace lifted steadily through the run, finishing fastest');
    }
    /* Threshold / tempo: one sustained fast block inside an easier run,
       or a whole run held at comfortably-hard. */
    else if (shape && shape.hardBits && shape.sustained && shape.fastFrac >= 0.18) {
      kind = 'threshold'; why.push('a sustained block of ' + (pr.longestBlock / 1000).toFixed(1) + ' km at pace');
    }
    else if (!shape && ratio <= 0.93 && (hrRel === null || hrRel >= 0.83)) {
      kind = 'threshold'; why.push('held well under easy pace for the whole run');
    }
    else if (isLong) { kind = 'long'; why.push('well beyond your normal distance'); }
    /* "Steady" is the grey zone: faster than easy, never hard. The line sits
       at 5% under the easy reference because Daniels' own easy band spans
       about 11% in pace — anything inside a couple of per cent of the
       reference is still easy running, not a moderate effort. */
    else if (ratio <= 0.95 || (hrRel !== null && hrRel >= 0.80)) {
      kind = 'steady'; why.push('quicker than easy, but never hard');
    }
    else if (ratio >= 1.05 && r.m <= medDist * 0.9) { kind = 'recovery'; why.push('short and deliberately slow'); }
    else { kind = 'easy'; why.push('conversational throughout'); }

    /* Intervals inside a long run still count as a long run for volume
       purposes, but as hard work for the easy/hard balance. Both are true,
       so both are recorded. */
    r.kind = kind;
    r.why = why.join('; ');
    r.hrRel = hrRel;
    r.hrPeak = hrPeak;
    r.hard = HARD_KINDS.indexOf(kind) >= 0;
    if (isLong && r.hard) r.alsoLong = true;

    /* How hard was this really, 0 easy to ~1.4 all-out. Peak HR is weighted
       in because it is the only signal that survives a rep session. */
    const fromHR = hrRel !== null
      ? (hrRel - 0.62) / 0.32 * 0.7 + (hrPeak !== null ? (hrPeak - 0.75) / 0.22 * 0.3 : 0)
      : null;
    r.hardness = clamp(fromHR !== null ? fromHR : (1.12 - ratio) / 0.26, 0, 1.4);
  }

  return { hr, medDist, easyRef: easyReference(runs, Date.now(), 120) };
}

/* ------------------------------------------------- was that a real effort? */
/* Scores 0–1. A best effort pulled out of the middle of a long steady run is
   a lower bound on ability and nothing more; a 10K that WAS the whole run,
   run at 92 % of max heart rate, is close to the truth. The model needs to
   know the difference, and so does the athlete. */
function maximality(effortSec, dist, run, hr, easyRef) {
  if (!run) return { score: 0.35, why: ['no matching activity'] };
  const why = [];
  let s = 0.3;

  const frac = run.dur ? effortSec / run.dur : 0;
  if (frac >= 0.88) { s += 0.30; why.push('the effort was essentially the whole run'); }
  else if (frac >= 0.65) { s += 0.18; why.push('it filled most of the run'); }
  else if (frac >= 0.35) { s += 0.06; why.push('a long block inside a longer run'); }
  else why.push('a short segment inside a longer run');

  if (hr && hr.max && run.hrAvg) {
    const rel = run.hrAvg / hr.max;
    if (rel >= 0.90) { s += 0.30; why.push('average heart rate was ' + Math.round(rel * 100) + '% of max'); }
    else if (rel >= 0.85) { s += 0.20; why.push('average heart rate ' + Math.round(rel * 100) + '% of max'); }
    else if (rel >= 0.78) { s += 0.08; why.push('heart rate ' + Math.round(rel * 100) + '% of max — hard but not all out'); }
    else { s -= 0.12; why.push('heart rate only ' + Math.round(rel * 100) + '% of max'); }
  } else {
    s += 0.06; why.push('no heart rate to check it against');
  }

  if (easyRef) {
    const pace = effortSec / (dist / 1000);
    const r = pace / easyRef;
    if (r <= 0.80) { s += 0.22; why.push('far faster than this athlete\u2019s easy pace'); }
    else if (r <= 0.88) { s += 0.12; why.push('clearly faster than easy pace'); }
    else if (r >= 0.97) { s -= 0.22; why.push('barely faster than easy pace'); }
  }

  // very short efforts inside long runs are often a downhill, not a talent
  if (dist < 2000 && frac < 0.2) { s -= 0.10; why.push('short enough to be a downhill'); }

  return { score: clamp(s, 0, 1), why };
}

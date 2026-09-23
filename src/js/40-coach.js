/* ===================== 40 · the coach =====================
   Periodised plan built from what the athlete is actually doing now:
   current volume sets the starting point, VDOT sets the paces, the race
   sets the shape of the quality work.
   ========================================================================= */

/* Long-run policy, per race.
     want     what the block is trying to reach at least once
     ceiling  never usefully more than this, whatever the numbers say
     minCap   the time cap, in minutes, that overrides distance for slower
              runners — three hours and change is where the injury and
              recovery cost of a single run starts to outrun its benefit
     repeats  how many runs at or near `want` a well-built block contains
     share    long run as a fraction of the week, above which we warn

   The marathon numbers are the ones that matter and they are deliberately
   conventional: essentially every mainstream marathon plan — Daniels,
   Pfitzinger, Higdon, Hansons at the top of its range — puts the athlete
   through repeated runs of 29–32 km, or 2:30–3:00 on feet, in the eight weeks
   before the race. Twenty-three kilometres is a half-marathon plan wearing a
   marathon label: it leaves the last 12 km of the race untrained, which is
   precisely the part that decides the result. */
const LONG = {
  '5K':  { want: 13000, ceiling: 16000, minCap: 90,  repeats: 2, share: 0.35 },
  '10K': { want: 16000, ceiling: 20000, minCap: 105, repeats: 3, share: 0.38 },
  'HM':  { want: 24000, ceiling: 28000, minCap: 150, repeats: 3, share: 0.45 },
  'FM':  { want: 32000, ceiling: 35000, minCap: 195, repeats: 4, share: 0.52 }
};

const RACES = {
  '5K':  { m: 5000,    name: '5K',             taper: 1, key: '5K'  },
  '10K': { m: 10000,   name: '10K',            taper: 2, key: '10K' },
  'HM':  { m: 21097.5, name: 'Half marathon',  taper: 2, key: 'HM'  },
  'FM':  { m: 42195,   name: 'Marathon',       taper: 3, key: 'FM'  }
};

const LEVEL_CAP = { new: 55000, some: 80000, solid: 110000, high: 160000 };

function pace(fit, z) { return fit.paces[z]; }
function paceRange(secPerKm, tol) {
  const a = secPerKm * (1 - (tol || 0.02)), b = secPerKm * (1 + (tol || 0.02));
  return fmtPace(App.unit === 'mi' ? b * 1.609344 : b) + '–' + fmtPace(App.unit === 'mi' ? a * 1.609344 : a) + '/' + uName();
}
/* The easy range is Daniels' own band, not a flat percentage either side of a
   single number — the band is wider at the slow end for a reason. */
function easyRange(fit) {
  const lo = fit.paces.Efast || fit.paces.E * 0.95, hi = fit.paces.Eslow || fit.paces.E * 1.05;
  const a = App.unit === 'mi' ? lo * 1.609344 : lo, b = App.unit === 'mi' ? hi * 1.609344 : hi;
  return fmtPace(a) + '\u2013' + fmtPace(b) + '/' + uName();
}
function paceOne(secPerKm) { return fmtPace(App.unit === 'mi' ? secPerKm * 1.609344 : secPerKm, true); }

/* -------------------------------------------------------------- the plan */
function buildPlan(cfg, fit, runs) {
  const race = RACES[cfg.race];
  const today = new Date();
  const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const raceMs = Date.parse(cfg.raceDate + 'T12:00:00Z');
  if (!isFinite(raceMs)) return { error: 'Pick a race date.' };

  const firstMonday = startOfWeekUTC(todayUTC);
  const raceWeek = startOfWeekUTC(raceMs);
  let total = Math.round((raceWeek - firstMonday) / (7 * DAY)) + 1;
  if (total < 3) return { error: 'That race is too close to build a plan around. Pick a date at least three weeks out, or choose a later race.' };
  const truncated = total > 26;
  if (truncated) total = 26;

  // ---- where we are starting from
  const recent = runs.filter(r => todayUTC - r.start < 28 * DAY);
  const recent8 = runs.filter(r => todayUTC - r.start < 56 * DAY);
  let startVol = cfg.startVol != null ? cfg.startVol : (sum(recent.map(r => r.m)) / 4 || sum(recent8.map(r => r.m)) / 8);
  startVol = Math.max(startVol, 18000);
  const longestRecent = recent8.length ? Math.max.apply(null, recent8.map(r => r.m)) : startVol * 0.3;

  const taper = Math.min(race.taper, Math.max(1, total - 2));
  const ramp = total - taper;
  const cap = Math.min(LEVEL_CAP[cfg.level] || 90000, startVol * 1.75);
  const growth = clamp(0.06 * ramp, 0.12, 0.45);
  const peakVol = clamp(startVol * (1 + growth), startVol * 1.05, cap);

  const basePhase = Math.max(1, Math.round(ramp * 0.40));
  const buildPhase = Math.max(1, Math.round(ramp * 0.33));
  const peakPhase = Math.max(1, ramp - basePhase - buildPhase);

  /* ---- how long does the long run have to get? -------------------------
     The distance the RACE demands comes first; weekly volume is a constraint
     on how safely we can get there, not a licence to skip it. A runner doing
     45 km a week who wants to finish a marathon still has to spend close to
     three hours on their feet — so we schedule it, and separately tell them
     their weekly volume is thin for the job.                               */
  const L = LONG[race.key];
  const ePace = pace(fit, 'E');
  const timeCapM = (L.minCap * 60) / ePace * 1000;        // what minCap minutes buys
  let longPeak = Math.min(L.want, L.ceiling);
  let timeCapped = false;
  if (timeCapM < longPeak) { longPeak = Math.max(timeCapM, L.want * 0.80); timeCapped = true; }
  // someone already running big weeks can go a little past the default
  longPeak = Math.min(L.ceiling, Math.max(longPeak, peakVol * 0.34));

  const longStart = clamp(Math.min(longestRecent * 0.95, startVol * 0.42), 6000, longPeak * 0.92);
  const longShareCap = L.share;
  const longHours = (longPeak / 1000) * ePace / 3600;

  const weeks = [];
  for (let i = 0; i < total; i++) {
    const wStart = firstMonday + i * 7 * DAY;
    const inTaper = i >= ramp;
    let phase;
    if (inTaper) phase = 'Taper';
    else if (i < basePhase) phase = 'Base';
    else if (i < basePhase + buildPhase) phase = 'Build';
    else phase = 'Peak';

    // volume — the underlying ramp is tracked separately from the week that
    // actually gets run, so a down week doesn't flatten everything after it
    let base, target, down = false;
    if (inTaper) {
      const left = taper - (i - ramp);                // weeks remaining incl. this
      const f = race.m >= 42000 ? [0.42, 0.62, 0.80] : race.m >= 21000 ? [0.48, 0.74] : [0.55, 0.80];
      base = peakVol * (f[Math.min(f.length - 1, left - 1)] || 0.5);
      target = base;
    } else {
      const t = ramp === 1 ? 1 : i / (ramp - 1);
      base = startVol + (peakVol - startVol) * Math.pow(t, 0.85);
      const prev = i > 0 ? weeks[i - 1].base : null;
      if (prev && base > prev * 1.11) base = prev * 1.11;    // never more than 11% up
      down = ramp >= 6 && i > 0 && (i + 1) % 4 === 0;
      target = down ? base * 0.76 : base;                    // absorb week
    }

    // long run: progress toward the absolute target, then hold
    /* The peak is reached with weeks to spare and then REPEATED. One heroic
       long run three weeks out does very little; three or four at that
       distance is what actually builds the last hour of a marathon. The ramp
       therefore tops out at about two thirds of the way through and holds,
       with the absorb weeks cutting it back rather than the progression. */
    let longM;
    if (inTaper) {
      const left = taper - (i - ramp);
      longM = longPeak * (left === 1 ? 0.45 : left === 2 ? 0.62 : 0.80);
    } else {
      const topOut = Math.max(1, Math.round(ramp * (L.repeats >= 4 ? 0.64 : 0.74)));
      const t = clamp(i / Math.max(1, topOut - 1), 0, 1);
      longM = longStart + (longPeak - longStart) * Math.pow(t, 0.85);
      if (down) longM = Math.min(longM, longPeak * 0.72);
    }
    /* Volume share is a warning, not a cap, for the marathon: the race does
       not care how many kilometres the rest of the week held. For shorter
       races it IS a cap, because nothing about a 10K needs a three-hour run. */
    const shareLimit = Math.max(target * longShareCap, longStart);
    if (race.m >= 42000) longM = Math.min(longM, longPeak);
    else longM = Math.min(longM, longPeak, shareLimit);
    if (i === total - 1) longM = 0;   // race week: the race is the long run

    const days = layoutWeek({ i, phase, inTaper, total, ramp, target, longM, cfg, fit, race, weeks, raceMs, wStart });

    const actual = sum(days.map(d => d.m || 0));
    weeks.push({
      i, start: wStart, phase, base, planned: target, target: actual, longM, down,
      days, isRaceWeek: i === total - 1
    });
  }

  /* ---- honest notes about what this block can and cannot deliver ------- */
  const training = weeks.filter(w => !w.isRaceWeek);
  const peakLong = Math.max.apply(null, training.map(w => w.longM));
  const nearPeak = training.filter(w => w.longM >= peakLong * 0.93).length;
  const peakWeek = Math.max.apply(null, training.map(w => w.target));
  const advice = [];

  if (race.m >= 42000) {
    const need = 55000;                      // km/week most plans assume by peak
    if (peakWeek < need) advice.push({
      k: 'warn',
      t: 'Your peak week is ' + Math.round(toU(peakWeek)) + ' ' + uName() + ', which is thin for a marathon',
      d: 'Most marathon plans peak nearer ' + Math.round(toU(need)) + ' ' + uName() + '. The long runs here still reach ' +
         Math.round(toU(peakLong)) + ' ' + uName() + ' because the race demands it, which makes them ' +
         Math.round(peakLong / peakWeek * 100) + '% of your biggest week — a high share. Two things help: add a fourth or fifth ' +
         'easy running day before the block starts, and treat every long run as a day that needs a genuinely easy day either side.'
    });
    if (timeCapped) advice.push({
      k: 'info',
      t: 'Your long runs are capped by time, not distance',
      d: 'At your easy pace, ' + Math.round(toU(longPeak)) + ' ' + uName() + ' takes about ' + longHours.toFixed(1) +
         ' hours. Past roughly three hours the damage outruns the benefit, so the peak long run is set by the clock. ' +
         'Run these by duration and let the distance be whatever it is.'
    });
    if (nearPeak < 2) advice.push({
      k: 'warn', t: 'Only ' + nearPeak + ' long run reaches full distance',
      d: 'This block is short for a marathon. Three or four runs at or near ' + Math.round(toU(peakLong)) + ' ' + uName() +
         ' is what builds the final hour of the race. Starting earlier would fix it.'
    });
    advice.push({
      k: 'info', t: 'Fuel the long runs, or they will not measure what you think',
      d: 'A long run done on water alone is a fasted endurance session, not marathon practice, and it will read as a slow run in ' +
         'every metric here. From about 90 minutes take 30–60 g of carbohydrate an hour, and on the two or three dress-rehearsal ' +
         'long runs take exactly what you plan to take on race day, at the same intervals. Pace on a properly fuelled long run is ' +
         'usually 10–20 s/' + uName() + ' quicker for the same effort.'
    });
  }
  if (race.m >= 21000 && race.m < 42000 && peakLong < 18000) advice.push({
    k: 'warn', t: 'Long runs stay short for a half marathon',
    d: 'Ideally at least a few runs reach 18–24 ' + uName() + '. Lengthening the block or adding a running day would get there.'
  });
  if (cfg.days <= 3) advice.push({
    k: 'warn', t: 'Three running days is the floor',
    d: 'It can work, but every session has to count and there is no room to miss one. A fourth easy day is the single cheapest upgrade to this plan.'
  });
  if (truncated) advice.push({ k: 'info', t: 'Plan trimmed to 26 weeks', d: 'Your race is further out than that. Start this block later, or keep building general volume until it begins.' });

  return {
    cfg, race, weeks, total, taper, truncated,
    startVol, peakVol, cap, peakWeek, peakLong, nearPeak, longPeak, timeCapped, longHours,
    longShare: peakLong / peakWeek, advice,
    phases: { base: basePhase, build: buildPhase, peak: peakPhase, taper },
    paces: fit.paces, vdot: fit.vdot,
    goal: fit.preds.find(p => Math.abs(p.m - race.m) < 60)
  };
}

/* ------------------------------------------------------- one week's shape */
function layoutWeek(ctx) {
  const { i, phase, inTaper, total, cfg, fit, race, target, longM, raceMs, wStart } = ctx;
  const nDays = cfg.days;
  const longDow = cfg.longDay;
  const days = [];
  for (let d = 0; d < 7; d++) days.push({ dow: d, kind: 'rest', title: 'Rest', detail: '', m: 0 });

  const isRaceWeek = i === total - 1;
  const raceDow = isRaceWeek ? (new Date(raceMs).getUTCDay() + 6) % 7 : -1;

  if (isRaceWeek) {
    days[raceDow] = {
      dow: raceDow, kind: 'race', title: race.name,
      detail: 'Race day. Warm up 10–15 min easy with a few strides for the ' + (race.m <= 10000 ? '10K or shorter' : 'longer') + ' distances. Go out at the pace you have practised, not the pace you hope for.',
      m: race.m
    };
    for (let d = 0; d < 7; d++) {
      if (d === raceDow) continue;
      const gap = raceDow - d;
      if (gap === 2) days[d] = mk(d, 'rest', 'Rest', 'Full day off. Stay off your feet where you can.', 0);
      else if (gap === 1) days[d] = mk(d, 'easy', 'Shakeout', '20–25 min very easy plus 4 × 20 s strides. Just enough to feel normal.', 4000, fit, 'E');
      else if (gap === 3) days[d] = mk(d, 'quality', 'Sharpener', '2 km easy, then 6 × 60 s at ' + paceOne(pace(fit, 'T')) + ' with 90 s jog, 1.5 km easy.', 7000, fit, 'T');
      else if (gap > 0) days[d] = mk(d, 'easy', 'Easy', '35–40 min easy.', 7000, fit, 'E');
      else days[d] = mk(d, 'rest', 'Rest', 'Race is done. Walk, eat, sleep.', 0);
    }
    return days;
  }

  // quality sessions this week
  let nQ = phase === 'Base' ? 1 : phase === 'Build' ? 2 : phase === 'Peak' ? 2 : 1;
  if (race.m >= 21000 && phase === 'Peak') nQ = 1;   // the long run is the second hard day
  if (nDays <= 4) nQ = Math.min(nQ, 1);
  if (inTaper) nQ = 1;

  // day slots: long run fixed, quality spread away from it
  const qSlots = pickQualityDays(longDow, nDays, nQ);
  const runDays = pickRunDays(longDow, qSlots, nDays);

  days[longDow] = longSession(longDow, ctx);

  const sessions = qualitySessions(ctx, nQ);
  qSlots.forEach((d, k) => {
    const s = sessions[k];
    if (!s) return;
    /* Work metres plus a warm-up and cool-down that scale gently with the
       week but never run away with it. The "easy with strides" filler has no
       prescribed work, so it falls back to a share of the week. */
    const wuM = clamp(target * 0.085, 2400, 5000);
    const m = s.workM != null
      ? clamp(s.workM + wuM, 6000, Math.max(9000, Math.min(20000, target * 0.30)))
      : clamp(target * 0.18, 5500, 11000);
    days[d] = Object.assign({ dow: d }, s, { m: Math.round(m) });
  });

  const used = days.reduce((a, b) => a + (b.m || 0), 0);
  let easyDays = runDays.filter(d => d !== longDow && qSlots.indexOf(d) < 0);
  let left = Math.max(0, target - used);
  // Rather than prescribe token three-kilometre jogs on a heavy week, take the day off.
  while (easyDays.length > 1 && left / easyDays.length < 4500) easyDays = easyDays.slice(0, -1);
  if (easyDays.length) {
    const per = left / easyDays.length;
    easyDays.forEach((d, k) => {
      const m = clamp(per, 4000, Math.max(5000, longM * 0.9));
      days[d] = mk(d, 'easy', k === 0 && phase !== 'Taper' ? 'Easy + strides' : 'Easy',
        Math.round(toU(m) * 10) / 10 + ' ' + uName() + ' at ' + easyRange(fit) +
        (k === 0 && phase !== 'Taper' ? ', finishing with 6 × 20 s strides.' : '.') +
        ' Conversational — if you cannot talk, you are running it too hard.', m, fit, 'E');
    });
  }

  if (cfg.cross) {
    const restDays = days.map((d, k) => k).filter(k => days[k].kind === 'rest' && k !== longDow);
    if (restDays.length > 1) {
      const k = restDays[Math.floor(restDays.length / 2)];
      days[k] = mk(k, 'cross', 'Strength', '30–40 min: single-leg work, calf raises, hip and glute strength, core. The cheapest injury insurance there is.', 0);
    }
  }
  return days;
}

function mk(dow, kind, title, detail, m, fit, zone) {
  return { dow, kind, title, detail, m: Math.round(m || 0), zone: zone || null };
}

function pickQualityDays(longDow, nDays, nQ) {
  // preference order keeps at least one easy day either side of the long run
  const pref = [1, 3, 4, 2, 5, 0, 6];
  const bad = new Set([longDow, (longDow + 6) % 7]);
  const out = [];
  for (const d of pref) {
    if (out.length >= nQ) break;
    if (bad.has(d)) continue;
    if (out.some(x => Math.abs(x - d) < 2)) continue;
    out.push(d);
  }
  return out.sort((a, b) => a - b);
}
function pickRunDays(longDow, qSlots, nDays) {
  const out = new Set([longDow].concat(qSlots));
  const pref = [2, 4, 0, 5, 3, 1, 6];
  for (const d of pref) { if (out.size >= nDays) break; out.add(d); }
  return Array.from(out);
}

/* ------------------------------------------------------------ long runs */
function longSession(dow, ctx) {
  const { phase, fit, race, longM, i, inTaper, ramp } = ctx;
  const km = Math.round(toU(longM) * 10) / 10;
  const E = easyRange(fit);
  const mins = Math.round((longM / 1000) * pace(fit, 'E') / 60);
  const dur = mins >= 90 ? ' (about ' + Math.floor(mins / 60) + 'h' + String(mins % 60).padStart(2, '0') + ')' : '';
  let detail = km + ' ' + uName() + dur + ' easy at ' + E + '.';
  let title = 'Long run';

  /* Fuelling is not a footnote. An under-fuelled long run is a different
     session from the one written on the plan: the pace falls away in the last
     third, the athlete reads that as poor endurance, and every pace-derived
     metric downstream inherits the mistake. */
  const fuel = longM >= 16000
    ? ' Fuel it: 30–60 g of carbohydrate an hour from the 45-minute mark, and drink to thirst. ' +
      'If you finish a long run dizzy or crawling, that is a nutrition result, not a fitness one.'
    : '';

  if (race.m >= 42000) {
    const rehearsal = !inTaper && phase === 'Peak' && longM >= 26000;
    if (rehearsal) {
      const mp = Math.round(toU(longM) * 0.30 * 10) / 10;
      title = 'Long run — race rehearsal';
      detail = km + ' ' + uName() + dur + '. Easy at ' + E + ' to begin, then the last ' + mp + ' ' + uName() +
        ' at ' + paceOne(pace(fit, 'M')) + '. Run it at race-day hour, in race-day shoes, on race-day breakfast, ' +
        'taking the exact gels you intend to use.' + fuel +
        ' This session is the single best predictor of your marathon, and the one most people under-fuel.';
    } else if (phase === 'Peak' || (phase === 'Build' && longM > 22000)) {
      const mp = Math.round(toU(longM) * 0.25 * 10) / 10;
      title = 'Long run with marathon pace';
      detail = km + ' ' + uName() + dur + ': easy at ' + E + ', then close the last ' + mp + ' ' + uName() +
        ' at ' + paceOne(pace(fit, 'M')) + '. Marathon pace on tired legs is the specific skill the race asks for.' + fuel;
    } else if (phase === 'Build') {
      title = 'Long run, progressive';
      detail = km + ' ' + uName() + dur + ' starting at ' + E + ' and drifting down towards ' +
        paceOne(pace(fit, 'M') * 1.04) + ' over the last third. Never a sprint finish.' + fuel;
    } else if (inTaper) {
      detail = km + ' ' + uName() + dur + ' easy, with the middle 20 minutes at ' + paceOne(pace(fit, 'M')) +
        ' just to keep the pace familiar. Shorter than you want it to be — that is the point.';
    } else {
      detail = km + ' ' + uName() + dur + ' easy at ' + E + '. Time on feet is the whole job today.' + fuel;
    }
    return mk(dow, 'long', title, detail, longM, fit, 'E');
  }

  if (race.m >= 21000 && phase !== 'Base' && longM > 14000 && !inTaper) {
    const t = Math.round(toU(longM) * 0.28 * 10) / 10;
    title = 'Long run with half pace';
    detail = km + ' ' + uName() + dur + ': easy at ' + E + ', with ' + t + ' ' + uName() +
      ' in the middle at ' + paceOne(pace(fit, 'M') * 0.985) + ' — your goal half pace.' + fuel;
  } else if (!inTaper && phase !== 'Base' && longM > 12000) {
    title = 'Long run, steady finish';
    detail = km + ' ' + uName() + dur + ' at ' + E + ', last 15 minutes lifting to ' + paceOne(pace(fit, 'M') * 1.05) + '.' + fuel;
  } else if (inTaper) {
    detail = km + ' ' + uName() + dur + ' easy. Shorter than you want it to be. That is the point.';
  } else {
    detail = km + ' ' + uName() + dur + ' easy at ' + E + '.' + fuel;
  }
  return mk(dow, 'long', title, detail, longM, fit, 'E');
}

/* -------------------------------------------------- quality session menu */
function qualitySessions(ctx, nQ) {
  const { phase, fit, race, i, inTaper } = ctx;
  const T = paceOne(pace(fit, 'T')), I = paceOne(pace(fit, 'I')), R = paceOne(pace(fit, 'R')), M = paceOne(pace(fit, 'M'));
  const wu = 'Easy warm-up and cool-down either side';
  const rot = i % 3;
  const out = [];

  /* A session's distance has to follow from what the session actually asks
     for, not from a share of the week. Scaling a "3 x 10 min at threshold"
     by weekly volume produces an 18 km Tuesday on a big week, which is not
     the session that was written down. So each one declares the metres of
     real work it contains (reps plus the jog recoveries between them), and
     the warm-up and cool-down are added on top within sane bounds. */
  const Ep = pace(fit, 'E'), Tp = pace(fit, 'T'), Ip = pace(fit, 'I'), Rp = pace(fit, 'R'), Mp = pace(fit, 'M');
  const at = (sec, p) => sec / p * 1000;               // metres covered in sec seconds
  const reps = (n, workSec, workPace, restSec) => n * (at(workSec, workPace) + at(restSec || 0, Ep * 1.18));
  const repsM = (n, metres, workPace, restSec) => n * (metres + at(restSec || 0, Ep * 1.18));

  const q = (title, detail, workM) => ({ kind: 'quality', title, detail, workM });

  if (inTaper) {
    out.push(q('Pace touch', wu + '. Main set: 5 × 3 min at ' + T + ' with 90 s jog. Should feel controlled and almost easy — you are reminding the legs, not training them.', reps(5, 180, Tp, 90)));
    return out;
  }

  if (phase === 'Base') {
    const menu = [
      q('Hills', wu + '. 8 × 45 s uphill hard but controlled, jog back down. Builds strength and stride power without the pounding of flat speed work.', reps(8, 45, Ip, 75)),
      q('Steady state', wu + '. 25 min continuous at ' + paceOne(pace(fit, 'M') * 1.03) + ' — comfortably hard, nose-breathing just about gone.', at(1500, Mp * 1.03)),
      q('Cruise intervals', wu + '. 4 × 6 min at ' + T + ' with 90 s jog between. Threshold work in bite-size pieces.', reps(4, 360, Tp, 90))
    ];
    out.push(menu[rot]);
    if (nQ > 1) out.push(q('Fartlek', wu + '. 10 × 1 min quick / 1 min easy, by feel rather than by watch.', reps(10, 60, Ip, 60)));
    return out;
  }

  if (race.m <= 10000) {
    const a = [
      q('Threshold', wu + '. 2 × 12 min at ' + T + ' with 3 min jog.', reps(2, 720, Tp, 180)),
      q('VO2 intervals', wu + '. 5 × 1000 m at ' + I + ' with 3 min jog recovery.', repsM(5, 1000, Ip, 180)),
      q('Mixed', wu + '. 3 × 5 min at ' + T + ' (90 s jog), then 4 × 400 m at ' + R + ' (400 m jog).', reps(3, 300, Tp, 90) + repsM(4, 400, Rp, 0) + 1600)
    ];
    const b = [
      q('Reps', wu + '. 8 × 400 m at ' + R + ' with 400 m jog. Fast and relaxed, not a race.', 8 * 800),
      q('Race simulation', wu + '. 3 × 2 km at your goal ' + race.name + ' pace with 3 min jog.', repsM(3, 2000, Tp, 180)),
      q('Short intervals', wu + '. 6 × 800 m at ' + I + ' with 2:30 jog.', repsM(6, 800, Ip, 150))
    ];
    out.push(phase === 'Peak' ? b[rot] : a[rot]);
    if (nQ > 1) out.push(phase === 'Peak' ? a[(rot + 1) % 3] : q('Strides and hills', wu + '. 10 × 20 s strides plus 6 × 30 s hills. Keeps turnover honest between the hard days.', reps(10, 20, Rp, 40) + reps(6, 30, Ip, 60)));
    return out;
  }

  if (race.m < 42000) {   // half marathon
    const a = [
      q('Cruise intervals', wu + '. 5 × 6 min at ' + T + ' with 90 s jog.', reps(5, 360, Tp, 90)),
      q('Threshold block', wu + '. 2 × 15 min at ' + T + ' with 3 min jog.', reps(2, 900, Tp, 180)),
      q('Progression', wu + '. 8 km building from ' + paceOne(pace(fit, 'M') * 1.06) + ' to ' + T + ' over the run.', 8000)
    ];
    const b = [
      q('Half pace blocks', wu + '. 3 × 4 km at goal half pace (' + paceOne(pace(fit, 'M') * 0.985) + ') with 3 min jog.', repsM(3, 4000, Mp, 180)),
      q('Long threshold', wu + '. 25 min continuous at ' + T + '.', at(1500, Tp)),
      q('Sharpening', wu + '. 6 × 1000 m at ' + I + ' with 2:30 jog. Lifts the ceiling so half pace feels cheaper.', repsM(6, 1000, Ip, 150))
    ];
    out.push(phase === 'Peak' ? b[rot] : a[rot]);
    if (nQ > 1) out.push(q('Strides and hills', wu + '. 10 × 20 s strides plus 6 × 30 s hills. A second, deliberately gentler quality day \u2014 turnover and strength, not a second hard threshold session.', reps(10, 20, Rp, 40) + reps(6, 30, Ip, 60)));
    return out;
  }

  // marathon
  const a = [
    q('Cruise intervals', wu + '. 5 × 6 min at ' + T + ' with 90 s jog.', reps(5, 360, Tp, 90)),
    q('Marathon pace', wu + '. 10 km at ' + M + ' continuous.', 10000),
    q('Threshold block', wu + '. 2 × 15 min at ' + T + ' with 3 min jog.', reps(2, 900, Tp, 180))
  ];
  const b = [
    q('Marathon pace blocks', wu + '. 3 × 5 km at ' + M + ' with 1 km float easy between.', 3 * 5000 + 2000),
    q('Long threshold', wu + '. 3 × 10 min at ' + T + ' with 2 min jog.', reps(3, 600, Tp, 120)),
    q('Race rehearsal', wu + '. 16 km at ' + M + ' — same shoes, same gels, same breakfast as race day.', 16000)
  ];
  out.push(phase === 'Peak' ? b[rot] : a[rot]);
  if (nQ > 1) out.push(q('Strides and hills', wu + '. 10 × 20 s strides plus 6 × 30 s hills. A second, deliberately gentler quality day \u2014 turnover and strength, not a second hard threshold session.', reps(10, 20, Rp, 40) + reps(6, 30, Ip, 60)));
  return out;
}

/* ------------------------------------------------------------- exports */
function planToCSV(plan) {
  const rows = [['Week', 'Phase', 'Date', 'Day', 'Session', 'Type', uName(), 'Detail']];
  for (const w of plan.weeks) {
    for (const d of w.days) {
      if (d.kind === 'rest' && !d.detail) continue;
      const ms = w.start + d.dow * DAY;
      rows.push([w.i + 1, w.phase, dayKey(ms), DOW[d.dow], d.title, d.kind,
        d.m ? toU(d.m).toFixed(1) : '', d.detail.replace(/\s+/g, ' ')]);
    }
  }
  return rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
}
function planToMarkdown(plan) {
  let s = '# ' + plan.race.name + ' plan — ' + plan.total + ' weeks\n\n';
  s += 'Goal time ' + (plan.goal ? hms(plan.goal.sec, true) : '—') + ' · VDOT ' + plan.vdot.toFixed(1) + '\n\n';
  s += '| Pace | per ' + uName() + ' |\n|---|---|\n';
  for (const z of ['E', 'M', 'T', 'I', 'R']) s += '| ' + z + ' | ' + paceOne(plan.paces[z]) + ' |\n';
  s += '\n';
  for (const w of plan.weeks) {
    s += '\n## Week ' + (w.i + 1) + ' · ' + w.phase + ' · ' + fmtDate(w.start) + ' · ' + toU(w.target).toFixed(1) + ' ' + uName() + '\n\n';
    for (const d of w.days) {
      if (d.kind === 'rest' && !d.detail) { s += '- **' + DOW[d.dow] + '** — Rest\n'; continue; }
      s += '- **' + DOW[d.dow] + '** — ' + d.title + (d.m ? ' (' + toU(d.m).toFixed(1) + ' ' + uName() + ')' : '') + ': ' + d.detail + '\n';
    }
  }
  return s;
}

/* ===================== 60 · insights =====================
   Two layers. Everything arithmetic is worked out here and shown whether or
   not a model is available; the model is only asked to interpret.
   ========================================================================= */

/* ------------------------------------------------------- local signals */
function trainingSignals() {
  const runs = App.train, now = Date.now();
  const w = n => rangeStats(runs, now - n * DAY, now);
  const last7 = w(7), last28 = w(28), prev28 = rangeStats(runs, now - 56 * DAY, now - 28 * DAY);
  const chronic = last28.load / 4, acute = last7.load;
  const acwr = chronic ? acute / chronic : 0;
  const ramp = prev28.m ? (last28.m / prev28.m - 1) : 0;

  /* The easy/hard balance, done the way the research actually defines it.

     The "80/20" finding (Seiler and others) is about TIME IN ZONE, not about
     how many sessions were hard. Counting sessions gets it badly wrong in
     both directions: an interval session is mostly warm-up, jog recovery and
     cool-down, so calling the whole thing hard overstates it; and three easy
     runs plus two workouts reads as 60% easy when the actual time split is
     nearer 85/15.

     So the honest number comes from the pace histogram each run carries: time
     slower than marathon pace is easy, time at or faster than threshold pace
     is hard, and the grey zone in between is counted separately because
     sitting in it is its own distinct mistake. Where a run has no distance
     samples we fall back to its whole duration at its average pace, which is
     the best that summary data supports. */
  const zones = { easy: 0, moderate: 0, hard: 0 };
  const mPace = App.fit ? App.fit.paces.M : null;
  const tPace = App.fit ? App.fit.paces.T : null;
  if (mPace && tPace) {
    for (const r of last28.runs) {
      const pr = r.prof;
      if (pr && pr.bins) {
        for (let b = 0; b < pr.bins.length; b++) {
          const pk = pr.binBase + b * pr.binWidth + pr.binWidth / 2;
          const sec = pr.bins[b];
          if (pk <= tPace) zones.hard += sec;
          else if (pk <= mPace) zones.moderate += sec;
          else zones.easy += sec;
        }
      } else if (r.dur && r.m) {
        const pk = r.gap || r.dur / (r.m / 1000);
        if (pk <= tPace) zones.hard += r.dur;
        else if (pk <= mPace) zones.moderate += r.dur;
        else zones.easy += r.dur;
      }
    }
  }
  const zoneTotal = zones.easy + zones.moderate + zones.hard;
  const easyShare = zoneTotal > 60 ? zones.easy / zoneTotal : null;   // by time, the real measure
  const moderateShare = zoneTotal > 60 ? zones.moderate / zoneTotal : null;
  const hardShare = zoneTotal > 60 ? zones.hard / zoneTotal : null;

  // session counts are still worth showing, just not as the balance number
  const hard = last28.runs.filter(r => r.hard);
  const enough = last28.runs.length >= 6;
  const hardSessionShare = last28.runs.length ? hard.length / last28.runs.length : null;
  const mix = {};
  for (const r of last28.runs) mix[r.kind || 'easy'] = (mix[r.kind || 'easy'] || 0) + 1;
  const longest28 = last28.runs.length ? Math.max.apply(null, last28.runs.map(r => r.m)) : 0;
  const longShare = last28.m ? longest28 / (last28.m / 4) : 0;
  const daysSince = runs.length ? Math.floor((now - runs[runs.length - 1].start) / DAY) : 999;

  const curve = loadCurve(runs, now - 60 * DAY, now);
  const tsb = curve.length ? curve[curve.length - 1].tsb : 0;
  const ctl = curve.length ? curve[curve.length - 1].ctl : 0;

  const flags = [];
  if (daysSince > 10) flags.push({ k: 'bad', t: 'No runs recorded for ' + daysSince + ' days', d: 'Either a break, an injury, or the export is older than it looks. Everything below describes the data as it stands, not necessarily where you are today.' });
  if (acwr > 1.5 && acute > 50) flags.push({ k: 'bad', t: 'Load has spiked', d: 'This week is ' + acwr.toFixed(2) + '× your recent four-week average. Above about 1.5 the injury odds climb sharply. Hold this week flat and let the average catch up.' });
  else if (acwr < 0.75 && chronic > 30) flags.push({ k: 'warn', t: 'Load has dropped off', d: 'This week is only ' + acwr.toFixed(2) + '× your four-week average. Fine if it is a planned down week or a taper, worth a look if it is not.' });
  else if (chronic > 20) flags.push({ k: 'good', t: 'Load is in a sensible band', d: 'Acute to chronic ratio of ' + acwr.toFixed(2) + ' — building without lurching.' });

  if (ramp > 0.28) flags.push({ k: 'warn', t: 'Distance is climbing fast', d: 'Up ' + Math.round(ramp * 100) + '% on the previous four weeks. Around 10% a month is what most bodies absorb happily.' });
  if (enough && easyShare != null && easyShare < 0.72) flags.push({ k: 'warn', t: 'Not enough easy running', d: Math.round((1 - easyShare) * 100) + '% of your running TIME in the last four weeks was spent at marathon pace or faster. The repeatedly replicated finding in trained distance runners is that around 80% of time sits below that line. The hard days only pay off when the easy days are genuinely easy.' });
  if (enough && moderateShare != null && moderateShare > 0.30) flags.push({ k: 'warn', t: 'A lot of time in the grey zone', d: Math.round(moderateShare * 100) + '% of your running time sits between marathon and threshold pace — too hard to recover from easily, not hard enough to drive much adaptation. This is the most common way a training week quietly stops working.' });
  if (enough && hardShare != null && hardShare < 0.03 && last28.runs.length >= 8) flags.push({ k: 'warn', t: 'Everything is the same pace', d: 'Almost none of the last four weeks was run at threshold or faster. One threshold session a week is the cheapest speed you will ever buy.' });
  if (enough && hardShare != null && hardShare > 0.22) flags.push({ k: 'warn', t: 'A high share of hard running', d: Math.round(hardShare * 100) + '% of your running time was at threshold pace or faster. Above roughly 20% this is hard to sustain for more than a few weeks without the wheels coming off.' });
  if (longShare > 0.52 && longest28 > 10000) flags.push({ k: 'warn', t: 'The long run dominates the week', d: 'Your longest run is ' + Math.round(longShare * 100) + '% of a typical week. Marathon blocks legitimately reach 40–50% — the concern starts above roughly half, where a single run is doing so much of the work that the rest of the week cannot support it. More weekly volume is the fix, not a shorter long run.' });
  if (tsb < -25) flags.push({ k: 'warn', t: 'You are carrying real fatigue', d: 'Form is ' + tsb.toFixed(0) + '. That is fine mid-block and wrong in race week.' });

  return { last7, last28, prev28, acwr, ramp, easyShare, moderateShare, hardShare, zones, zoneTotal, hardSessionShare, mix, hard, longest28, longShare, daysSince, tsb, ctl, flags };
}

/* ------------------------------------------- the brief handed to a model */
function athleteBrief() {
  const fit = App.fit, sig = trainingSignals(), b = bucketRuns(App.train);
  const weeks = denseWeeks(b.weeks).slice(-16).map(w => ({
    week: dayKey(w.key), dist: +toU(w.m).toFixed(1), runs: w.n,
    time_min: Math.round(w.sec / 60), load: Math.round(w.load),
    avg_pace: w.pace ? fmtPace(App.unit === 'mi' ? w.pace * 1.609344 : w.pace) : null
  }));
  const months = b.months.slice(-12).map(m => ({ month: dayKey(m.key).slice(0, 7), dist: +toU(m.m).toFixed(0), runs: m.n }));
  const best = {};
  for (const t of TARGETS) if (App.best[t.m]) best[t.label] = { time: hms(App.best[t.m].sec), when: dayKey(App.best[t.m].date), from: App.best[t.m].method === 'split' ? 'segment inside a run' : 'whole-run average' };

  const brief = {
    units: App.unit,
    today: dayKey(Date.now()),
    history_span: App.train.length ? dayKey(App.train[0].start) + ' to ' + dayKey(App.train[App.train.length - 1].start) : null,
    total_runs: App.train.length,
    weekly_last16: weeks,
    monthly_last12: months,
    best_efforts: best,
    model: fit ? {
      vdot: +fit.vdot.toFixed(1),
      anchor: fit.anchor.label + ' ' + hms(fit.anchor.sec) + ' on ' + dayKey(fit.anchor.date),
      fatigue_exponent: +fit.riegel.toFixed(3),
      anchor_was_a_maximal_effort: +fit.anchor.maximal.toFixed(2),
      no_maximal_effort_on_file: !!fit.submax,
      estimate_corroborated_by_a_second_effort: !!fit.corroborated,
      observed_max_hr: fit.hr && fit.hr.max ? fit.hr.max : null,
      learned_easy_pace_per_km: fit.easyRef ? fmtPace(fit.easyRef) : null,
      predictions: fit.preds.map(p => ({ race: p.label, time: hms(p.sec, true), range: hms(p.lo, true) + '–' + hms(p.hi, true), confidence: p.confidence })),
      training_paces_per_km: { E: fmtPace(fit.paces.E), M: fmtPace(fit.paces.M), T: fmtPace(fit.paces.T), I: fmtPace(fit.paces.I), R: fmtPace(fit.paces.R) }
    } : null,
    current: {
      last_7d_dist: +toU(sig.last7.m).toFixed(1),
      last_28d_dist: +toU(sig.last28.m).toFixed(1),
      prev_28d_dist: +toU(sig.prev28.m).toFixed(1),
      acute_chronic_ratio: +sig.acwr.toFixed(2),
      fitness_ctl: Math.round(sig.ctl),
      form_tsb: Math.round(sig.tsb),
      time_in_zone_last28: sig.easyShare == null ? null : {
        easy_slower_than_marathon_pace: +sig.easyShare.toFixed(2),
        moderate_between_marathon_and_threshold: +sig.moderateShare.toFixed(2),
        hard_threshold_or_faster: +sig.hardShare.toFixed(2),
        note: 'fractions of running TIME, not session counts'
      },
      session_kinds_last28: sig.mix,
      hard_sessions_share_of_runs: sig.hardSessionShare == null ? null : +sig.hardSessionShare.toFixed(2),
      longest_run_28d: +toU(sig.longest28).toFixed(1),
      days_since_last_run: sig.daysSince,
      avg_hr_28d: sig.last28.hr || null
    },
    flags: sig.flags.map(f => f.t)
  };
  if (App.plan) {
    brief.plan = {
      race: App.plan.race.name, race_date: App.plan.cfg.raceDate, weeks: App.plan.total,
      start_weekly: +toU(App.plan.startVol).toFixed(1), peak_weekly: +toU(App.plan.peakVol).toFixed(1),
      days_per_week: App.plan.cfg.days,
      next_two_weeks: App.plan.weeks.filter(w => w.start + 7 * DAY > Date.now()).slice(0, 2).map(w => ({
        week: w.i + 1, phase: w.phase, dist: +toU(w.target).toFixed(1),
        sessions: w.days.filter(d => d.kind !== 'rest').map(d => DOW[d.dow] + ': ' + d.title)
      }))
    };
  }
  return brief;
}

const PROMPTS = {
  read: 'Read this training and tell me what you see. What is going well, what is the single biggest thing holding my race times back, and what would you change in the next four weeks? Be specific and use my numbers.',
  race: 'I want to race well. Given this data, is my goal realistic, what is the pacing plan you would give me, and what are the two most likely ways my race falls apart?',
  plan: 'Review the training plan in this data against my history. Where is it too aggressive, where is it too soft, and what would you change first?',
  week: 'Look only at the last four weeks. Tell me how that block went, whether I am recovering enough, and exactly what next week should look like.'
};

function promptFor(kind, custom) {
  const ask = kind === 'custom' ? (custom || '') : PROMPTS[kind];
  return [
    'You are an experienced distance-running coach reviewing one athlete\'s training data.',
    'The data below was computed from their Apple Health export. Distances are in ' + (App.unit === 'mi' ? 'miles' : 'kilometres') + '; paces are per ' + uName() + '. Times are hh:mm:ss.',
    '',
    'Rules: work from the numbers given, quote them when you make a point, and say plainly when the data cannot answer something.',
    'Do not invent sessions or results that are not here. Do not give medical advice; if something looks like an injury pattern, say so and suggest they see a professional.',
    '"time_in_zone_last28" is measured by running TIME and is the figure that matters for an easy/hard balance; "hard_sessions_share_of_runs" counts sessions instead and will read much higher \u2014 most of an interval session is warm-up and jog recovery, so a session count alone overstates how much hard work happened. Use the time-based figure for the balance, and only mention the session count to explain why the two look different if it is relevant.',
    'If "no_maximal_effort_on_file" is true, the VDOT and predictions are a floor: say plainly that the athlete is probably faster than these numbers, and suggest a recent hard 5K or an entered race result would sharpen them, rather than treating the prediction as settled.',
    'Answer in markdown, under 500 words, no preamble. Lead with the single most important thing.',
    '',
    'ATHLETE DATA:',
    JSON.stringify(athleteBrief(), null, 1),
    '',
    'QUESTION: ' + ask
  ].join('\n');
}

/* --------------------------------------------------------- model callers */
const PROVIDERS = {
  builtin: { name: 'Claude, built into this page', key: false },
  anthropic: { name: 'Anthropic API key', key: true, model: 'claude-sonnet-4-5', hint: 'Starts with sk-ant-' },
  openai: { name: 'OpenAI API key', key: true, model: 'gpt-4.1', hint: 'Starts with sk-' },
  google: { name: 'Google Gemini API key', key: true, model: 'gemini-2.5-flash', hint: 'From Google AI Studio' }
};

async function callModel(provider, key, model, prompt, onText, signal) {
  if (provider === 'builtin') {
    if (!window.__sample) throw { code: 'unavailable', message: 'The built-in model is not available in this view.' };
    const r = await window.__sample(prompt, { onText: u => onText(u.text), signal, modelTier: 'default', cache: false });
    return r.text;
  }
  let url, headers = { 'content-type': 'application/json' }, body;
  if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages';
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
    body = { model, max_tokens: 1600, messages: [{ role: 'user', content: prompt }] };
  } else if (provider === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions';
    headers.authorization = 'Bearer ' + key;
    body = { model, messages: [{ role: 'user', content: prompt }], max_tokens: 1600 };
  } else {
    url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
    headers['x-goog-api-key'] = key;
    body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 1600 } };
  }

  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.code === 20)) throw { code: 'cancelled', message: 'Stopped.' };
    throw { code: 'network', message: 'The request never left the page. Browsers block calls to other sites from a hosted page unless that site allows it, and this page is hosted under a policy that blocks them outright. Use the built-in Claude option, or copy the prompt and paste it into the provider\'s own app.' };
  }
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = (j.error && (j.error.message || j.error.status)) || ''; } catch (e) { }
    throw { code: 'http-' + res.status, message: res.status === 401 || res.status === 403 ? 'That key was rejected (' + res.status + '). ' + detail : 'The provider returned ' + res.status + '. ' + detail };
  }
  const j = await res.json();
  let text = '';
  if (provider === 'anthropic') text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  else if (provider === 'openai') text = (((j.choices || [])[0] || {}).message || {}).content || '';
  else text = ((((j.candidates || [])[0] || {}).content || {}).parts || []).map(p => p.text || '').join('');
  if (!text) throw { code: 'empty', message: 'The provider replied but sent no text back.' };
  onText(text);
  return text;
}

/* ------------------------------------------------------------- the view */
let insightCtl = null;

/* ------------------------------------------------------------- glossary
   Every term this page uses, defined where it is used. Written to be read by
   someone who runs, not someone who reads sports-science papers. */
const GLOSSARY = [
  ['Training load', 'the size of one run',
   'One number combining how long a run was with how hard it was relative to your threshold pace. An hour at threshold scores about 100; an easy hour scores 50\u201365; ten minutes of strides scores almost nothing. It is the same idea as TSS or Training Load elsewhere, computed from pace instead of power because Apple Health has no power meter.'],
  ['Fitness <span class="tiny">CTL, chronic load</span>', 'a 42-day average',
   'An exponentially weighted 42-day average of your daily training load. Slow to rise, slow to fall \u2014 that is deliberate, because the adaptations it stands in for also take about six weeks. Only comparable to your own past, never to somebody else\u2019s.'],
  ['Fatigue <span class="tiny">ATL, acute load</span>', 'a 7-day average',
   'The same calculation over seven days. It moves within a few days of a hard week or a rest week, which is exactly what you want from a fatigue number.'],
  ['Form <span class="tiny">TSB</span>', 'fitness minus fatigue',
   'How much of your fitness is currently available rather than buried under recent work. Negative is normal in a training block. A small positive number after a taper is the state races are run in. A large positive number for weeks means you are rested and slowly getting less fit.'],
  ['Acute&nbsp;:&nbsp;chronic ratio <span class="tiny">ACWR</span>', 'this week against your recent normal',
   'This week\u2019s load divided by the average of the last four weeks. Around 0.8\u20131.3 is building steadily. Sustained readings above roughly 1.5 are associated with a sharp rise in injury rates in the sports-medicine literature; below 0.8 you are either tapering, resting, or quietly losing ground. It is a rough instrument \u2014 useful for spotting a lurch, useless as a target.'],
  ['VDOT', 'one number for your current engine',
   'Jack Daniels\u2019 measure of running fitness, derived from a race result rather than a lab test. It combines how much oxygen you can use with how efficiently you run, which is why two runners with the same VO\u2082max can have different VDOTs. Every training pace on this site comes from it.'],
  ['Grade-adjusted pace <span class="tiny">GAP</span>', 'what a hilly run would have been on the flat',
   'Running uphill costs more than running downhill saves, so a hilly run at 5:40/km is a harder effort than a flat run at the same pace. Apple Health records total ascent but not a full elevation profile, so the correction here is an average one: roughly 3.5&nbsp;s per km for every 10&nbsp;m climbed per km, capped at 15%. It is an approximation, and it is a much better one than ignoring the hills.'],
  ['Threshold <span class="tiny">T pace</span>', 'comfortably hard, about an hour flat out',
   'The pace you could hold in a race lasting roughly an hour \u2014 fast enough that conversation dies, slow enough that you are not fading. The single most trainable quality in distance running, and the pace most people run their easy days at by mistake.'],
  ['Easy <span class="tiny">E pace</span>', 'conversational, and slower than you think',
   'Daniels defines this as a band rather than a number, which is why this site shows a range. The point of easy running is volume without cost; if you finish an easy run needing recovery, it was not an easy run.'],
  ['Interval and repetition <span class="tiny">I and R pace</span>', 'the ceiling, and the economy',
   'I pace is roughly 3\u20135 minute race effort \u2014 it raises how much oxygen you can use. R pace is shorter and faster and trains how efficiently you move, not how much you can take in. They feel similar and do different jobs.'],
  ['Riegel exponent', 'how quickly you slow down as races get longer',
   'Predicting a marathon from a 5K means assuming a rate of slowdown. The textbook value is 1.06; a runner with a deep endurance base slows less (nearer 1.04), one who is all speed slows more (1.10+). Where you have three efforts spread across a wide enough range, that number is fitted to you rather than assumed \u2014 and it is the single biggest lever on a marathon prediction.'],
  ['Maximality', 'was that effort actually a real effort?',
   'A fast 10&nbsp;km lifted out of the middle of a long steady run proves you can run at least that fast, and nothing about your ceiling. Each best effort is scored on whether it filled the run, how high the heart rate went, and how far under your own easy pace it sat. Low-scoring efforts set a floor for the model rather than a level.'],
  ['Time in zone', 'the only honest way to measure easy vs hard',
   'Every 200&nbsp;m of every run is placed in one of three bands by its pace: easier than marathon pace, between marathon and threshold pace, or at threshold and faster. Counting whole sessions instead gets this badly wrong, because most of an interval session is warm-up, jog recovery and cool-down. The widely cited 80/20 finding \u2014 that trained distance runners spend roughly four fifths of their training time at low intensity \u2014 is a statement about time, not about how many days had a workout in them.'],
  ['The grey zone', 'too hard to recover from, too easy to adapt to',
   'Time between marathon and threshold pace. It feels productive, which is the problem: it costs most of what a hard session costs and returns much less. Persistent large amounts of it are the most common reason a training week stops working, and it is the thing an easy-day-too-fast habit produces.'],
  ['Session types', 'what the classifier thinks each run was',
   'Runs are sorted into recovery, easy, long, steady, progression, threshold, intervals and race from the shape of the run \u2014 the spread of paces inside it, whether the fast parts are one sustained block or several short ones with recoveries between, whether pace lifted through the run, and how close the peak heart rate came to your observed maximum. Average pace alone cannot do this: an 8&nbsp;\u00d7&nbsp;400&nbsp;m session and an easy run of the same distance can have identical averages.'],
  ['Ramp rate', 'how fast your distance is climbing',
   'This four weeks against the previous four. Around 10% a month is what most people absorb without complaint. It says nothing about intensity, which is why it sits next to the acute:chronic ratio rather than replacing it.']
];

function glossaryHTML() {
  return '<div class="panel"><div class="ph"><h3>What these words mean</h3>' +
    '<div class="tiny">every term on this page, in plain language</div></div><div class="pb gloss">' +
    GLOSSARY.map(([t, sub, body]) =>
      '<details><summary>' + t + ' <span class="tiny">' + esc(sub) + '</span></summary><div class="gb">' + body + '</div></details>'
    ).join('') + '</div></div>';
}

function renderInsights() {
  const v = $('#v-insights');
  if (!App.ready) { v.innerHTML = emptyState(); return; }
  const s = loadSettings();
  const sig = trainingSignals();

  let h = '<div class="sechead"><h1>Insights</h1>' +
    '<p class="sub">The signals below are worked out on this device from your own data. The written read-out underneath is optional and needs a model.</p></div>';

  h += '<div class="grid g4">' +
    statTile('Acute : chronic load', sig.acwr.toFixed(2), 'ACWR', sig.acwr > 1.5 ? '<span class="down">above the comfortable band</span>' : sig.acwr < 0.8 ? '<span class="flat">easing off</span>' : '<span class="up">0.8\u20131.3 is steady building</span>') +
    statTile('Easy running', sig.easyShare == null ? '\u2013' : Math.round(sig.easyShare * 100), sig.easyShare == null ? '' : '%', 'of running <em>time</em> in 28 days \u00b7 about 80% is the mark') +
    statTile('Fitness', Math.round(sig.ctl), 'CTL', '42-day average load') +
    statTile('Form', (sig.tsb >= 0 ? '+' : '') + Math.round(sig.tsb), 'TSB', sig.tsb > 15 ? 'well rested' : sig.tsb > -5 ? 'fresh \u2014 race band' : sig.tsb > -25 ? 'training productively' : 'digging deep') +
    '</div>';

  /* The three-zone split, drawn as a bar, because the shape is the point. */
  if (sig.easyShare != null) {
    const seg = (v, cls, label) => v > 0.005
      ? '<span class="zseg ' + cls + '" style="width:' + (v * 100).toFixed(1) + '%" title="' + esc(label) + '"></span>' : '';
    h += '<div class="panel" style="margin-top:14px"><div class="ph"><h3>Where the time actually went</h3>' +
      '<div class="tiny">last 28 days, by running time rather than by session</div></div><div class="pb">' +
      '<div class="zbar">' +
      seg(sig.easyShare, 'ze', 'Easy') + seg(sig.moderateShare, 'zm', 'Moderate') + seg(sig.hardShare, 'zh', 'Hard') +
      '</div><div class="zkey">' +
      '<span><i class="ze"></i>Easy \u2014 slower than marathon pace <b>' + Math.round(sig.easyShare * 100) + '%</b></span>' +
      '<span><i class="zm"></i>Moderate \u2014 between marathon and threshold <b>' + Math.round(sig.moderateShare * 100) + '%</b></span>' +
      '<span><i class="zh"></i>Hard \u2014 threshold pace or faster <b>' + Math.round(sig.hardShare * 100) + '%</b></span>' +
      '</div>' +
      '<p class="tiny" style="margin-top:10px">Built from the pace of every 200 m of every run, not from session labels. ' +
      'That distinction matters: an interval session is mostly warm-up, jog recovery and cool-down, so counting the whole ' +
      'thing as hard overstates it badly. By session count, ' + Math.round(sig.hardSessionShare * 100) + '% of your runs ' +
      'carried hard work \u2014 by the clock, ' + Math.round(sig.hardShare * 100) + '% of your time was actually spent there.</p>' +
      '</div></div>';
  }
  if (sig.mix && Object.keys(sig.mix).length) {
    const order = ['recovery', 'easy', 'long', 'steady', 'progression', 'threshold', 'intervals', 'race'];
    h += '<p class="sub" style="margin-top:12px">Last 28 days, by what each run was: ' +
      order.filter(k => sig.mix[k]).map(k => '<span class="pill ' + (RUN_KINDS[k] || {}).pill + '">' +
        sig.mix[k] + ' ' + esc((RUN_KINDS[k] || { label: k }).label.toLowerCase()) + '</span>').join(' ') + '</p>';
  }

  h += '<div class="sechead"><h2>What stands out</h2></div>';
  if (!sig.flags.length) h += '<div class="note">Nothing unusual in the last four weeks.</div>';
  for (const f of sig.flags) {
    h += '<div class="note ' + (f.k === 'bad' ? 'bad' : f.k === 'warn' ? 'warn' : '') + '" style="margin-bottom:8px">' +
      '<strong>' + esc(f.t) + '</strong><br>' + esc(f.d) + '</div>';
  }

  h += '<div class="sechead" style="margin-top:22px"><h2>Glossary</h2>' +
    '<p class="sub">None of these numbers are worth following if you are not sure what they mean. Nothing here is jargon for its own sake \u2014 each one changes a decision.</p></div>' +
    glossaryHTML();

  /* --- model section --- */
  h += '<div class="sechead"><h2>Ask a coach to read it</h2>' +
    '<p class="sub">Your training summary is sent to whichever model you pick. Keys are stored in this browser only and never sent anywhere except that provider.</p></div>';

  h += '<div class="panel"><div class="pb">';
  h += '<div class="grid g2">' +
    fld('Provider', '<select id="provSel">' + Object.keys(PROVIDERS).map(k =>
      '<option value="' + k + '"' + ((s.provider || 'builtin') === k ? ' selected' : '') + '>' + PROVIDERS[k].name + '</option>').join('') + '</select>') +
    fld('Model', '<input type="text" id="modelIn" value="' + esc(s.model || PROVIDERS[s.provider || 'builtin'].model || '') + '" placeholder="provider default">') +
    '</div>';
  h += '<div id="keyWrap">' + fld('API key', '<input type="password" id="keyIn" autocomplete="off" spellcheck="false" value="' + esc(s.rememberKey ? (s.key || '') : '') + '" placeholder="paste your key">') +
    '<label class="chk"><input type="checkbox" id="rememberKey"' + (s.rememberKey ? ' checked' : '') + '><span>Keep this key in this browser so I do not have to paste it again. Leave it off on a shared machine.</span></label></div>';

  h += '<div class="row" style="margin-top:4px">' +
    '<div class="seg" role="group" aria-label="Question">' +
    [['read', 'Read my training'], ['race', 'Race strategy'], ['plan', 'Review my plan'], ['week', 'Last four weeks'], ['custom', 'My own question']]
      .map(([k, l], i) => '<button type="button" data-ask="' + k + '" aria-pressed="' + (i === 0) + '">' + l + '</button>').join('') +
    '</div></div>';
  h += '<div id="customWrap" style="display:none; margin-top:12px">' +
    fld('Your question', '<textarea id="customQ" rows="3" placeholder="e.g. Should I move my long run to Saturday given my work week?"></textarea>') + '</div>';

  h += '<div class="row" style="margin-top:8px">' +
    '<button class="btn pri" type="button" id="askBtn">Get the read-out</button>' +
    '<button class="btn sm ghost" type="button" id="stopBtn" style="display:none">Stop</button>' +
    '<button class="btn sm ghost" type="button" id="copyBtn">Copy the prompt instead</button>' +
    '<span class="tiny" id="askNote"></span></div>';
  h += '</div></div>';

  h += '<div id="insightOut" style="margin-top:16px"></div>';
  v.innerHTML = h;

  const provSel = $('#provSel'), modelIn = $('#modelIn'), keyWrap = $('#keyWrap');
  let ask = 'read';

  function syncProvider() {
    const p = PROVIDERS[provSel.value];
    keyWrap.style.display = p.key ? '' : 'none';
    if (!modelIn.value || !PROVIDERS[provSel.value].model || Object.keys(PROVIDERS).some(k => PROVIDERS[k].model === modelIn.value)) {
      modelIn.value = p.model || '';
    }
    modelIn.disabled = !p.key;
    $('#askNote').innerHTML = p.key
      ? 'Key goes straight to ' + esc(p.name.split(' ')[0]) + ' from your browser.'
      : (window.__sample ? 'Runs on your own Claude account. Nothing to set up.' : 'Only available when this page is open inside Claude.');
  }
  provSel.addEventListener('change', () => { syncProvider(); saveSettings({ provider: provSel.value, model: modelIn.value }); });
  syncProvider();

  $$('[data-ask]', v).forEach(b => b.addEventListener('click', () => {
    ask = b.dataset.ask;
    $$('[data-ask]', v).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    $('#customWrap').style.display = ask === 'custom' ? '' : 'none';
  }));

  $('#copyBtn').addEventListener('click', async () => {
    const t = promptFor(ask, $('#customQ') ? $('#customQ').value : '');
    try { await navigator.clipboard.writeText(t); $('#askNote').textContent = 'Prompt copied. Paste it into any chat app.'; }
    catch (e) { $('#insightOut').innerHTML = '<div class="panel"><div class="pb">' + fld('Prompt', '<textarea rows="12">' + esc(t) + '</textarea>') + '</div></div>'; }
  });

  $('#stopBtn').addEventListener('click', () => { if (insightCtl) insightCtl.abort(); });

  $('#askBtn').addEventListener('click', async () => {
    const provider = provSel.value;
    const key = $('#keyIn') ? $('#keyIn').value.trim() : '';
    const model = modelIn.value.trim() || PROVIDERS[provider].model;
    const out = $('#insightOut');
    if (PROVIDERS[provider].key && !key) { say(out, 'Paste a key for ' + esc(PROVIDERS[provider].name) + ' first, or switch to the built-in option.', 'warn'); return; }

    saveSettings({ provider, model, rememberKey: $('#rememberKey') && $('#rememberKey').checked, key: ($('#rememberKey') && $('#rememberKey').checked) ? key : '' });

    const btn = $('#askBtn');
    btn.disabled = true; $('#stopBtn').style.display = '';
    out.innerHTML = '<div class="panel"><div class="pb"><span class="spin"></span> <span class="tiny" id="thinking">Reading your training…</span></div></div>';
    insightCtl = new AbortController();
    let got = false;
    try {
      const text = await callModel(provider, key, model, promptFor(ask, $('#customQ') ? $('#customQ').value : ''), t => {
        got = true;
        out.innerHTML = '<div class="panel"><div class="pb"><div class="md">' + md(t) + '</div></div></div>';
      }, insightCtl.signal);
      out.innerHTML = '<div class="panel"><div class="pb"><div class="md">' + md(text) + '</div>' +
        '<div class="tiny" style="margin-top:14px; padding-top:10px; border-top:1px solid var(--rule-soft)">Written by ' + esc(model || 'the model') + ' from the summary above. Treat it as a second opinion, not a prescription.</div>' +
        '</div></div>';
    } catch (e) {
      if (e && e.code === 'cancelled') { if (!got) out.innerHTML = ''; }
      else {
        const friendly = {
          not_granted: 'You declined to let this page use your Claude account. Reload the page to be asked again, or paste an API key above.',
          rate_limited: 'Too many requests in a row. Give it a minute, then try again.',
          sampling_disabled: 'The built-in model is switched off for this view. Paste an API key above, or copy the prompt.',
          not_declared: 'The built-in model is not available in this copy of the page. Paste an API key above, or copy the prompt.',
          prompt_too_large: 'That question plus your training summary was too long. Try a shorter custom question.',
          refused: 'The model declined to answer that one. Try rephrasing the question.'
        };
        const msg = (e && (friendly[e.code] || e.message)) || 'Something went wrong reaching the model.';
        const partial = (e && typeof e.text === 'string' && e.text.trim()) ? e.text : '';
        out.innerHTML = (partial ? '<div class="panel"><div class="pb"><div class="md">' + md(partial) + '</div><div class="tiny" style="margin-top:12px">Cut off partway through.</div></div></div>' : '') +
          '<div class="note bad"><strong>Could not get a read-out.</strong><br>' + esc(msg) +
          '<br><br>The signals above do not need a model — they are already computed. You can also press “Copy the prompt instead” and paste it into any chat.</div>';
      }
    } finally {
      btn.disabled = false; $('#stopBtn').style.display = 'none'; insightCtl = null;
    }
  });
}

/* ===================== 55 · coach view ===================== */

function defaultRaceDate(weeks) {
  const d = new Date(Date.now() + (weeks || 16) * 7 * DAY);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + ((7 - day) % 7));     // land on a Sunday
  return dayKey(d.getTime());
}

function renderCoach() {
  const v = $('#v-coach');
  if (!App.ready) { v.innerHTML = emptyState(); return; }
  if (!App.fit) {
    v.innerHTML = '<div class="sechead"><h1>Coach</h1></div><div class="note warn">A plan needs a pace to build from, and there is not enough recent running in the import to set one. Run for a few weeks and come back.</div>';
    return;
  }

  const s = loadSettings();
  const c = App.coachCfg || s.coach || {};
  const recent4 = rangeStats(App.train, Date.now() - 28 * DAY, Date.now());
  const curWeekly = recent4.m / 4;

  let h = '<div class="sechead"><h1>Build a plan</h1>' +
    '<p class="sub">Your current volume sets where the plan starts, your VDOT sets every pace in it, and the race sets the shape of the hard days. ' +
    'Nothing here asks you to jump to a training load you are not already close to.</p></div>';

  h += '<div class="panel"><div class="pb"><form id="coachForm"><div class="grid g3">' +
    fld('Race', '<select name="race">' + Object.keys(RACES).map(k =>
      '<option value="' + k + '"' + ((c.race || 'HM') === k ? ' selected' : '') + '>' + RACES[k].name + '</option>').join('') + '</select>') +
    fld('Race date', '<input type="date" name="raceDate" value="' + esc(c.raceDate || defaultRaceDate(16)) + '" min="' + dayKey(Date.now() + 14 * DAY) + '">') +
    fld('Running days per week', '<select name="days">' + [3, 4, 5, 6, 7].map(n =>
      '<option value="' + n + '"' + ((c.days || 5) === n ? ' selected' : '') + '>' + n + '</option>').join('') + '</select>') +
    fld('Long run day', '<select name="longDay">' + DOW.map((d, i) =>
      '<option value="' + i + '"' + ((c.longDay != null ? c.longDay : 5) === i ? ' selected' : '') + '>' + d + '</option>').join('') + '</select>') +
    fld('Training history', '<select name="level">' +
      [['new', 'Newer to structured training'], ['some', 'A season or two behind me'], ['solid', 'Several years, consistent'], ['high', 'High mileage, experienced']]
        .map(([k, l]) => '<option value="' + k + '"' + ((c.level || 'some') === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>') +
    fld('Starting weekly ' + uLong(), '<input type="number" name="startVol" step="1" min="10" value="' + Math.round(toU(c.startVol != null ? c.startVol : curWeekly)) + '">',
      'Your last four weeks averaged ' + dist(curWeekly) + ' ' + uName() + '. Change it if that period was unusual.') +
    '</div>' +
    '<label class="chk"><input type="checkbox" name="cross"' + (c.cross !== false ? ' checked' : '') + '><span>Add a weekly strength session on a non-running day</span></label>' +
    '<div class="row" style="margin-top:6px"><button class="btn pri" type="submit">Build the plan</button>' +
    '<span class="tiny" id="coachHint"></span></div>' +
    '</form></div></div>';

  h += '<div id="planOut" style="margin-top:20px"></div>';
  v.innerHTML = h;

  $('#coachForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const cfg = {
      race: f.get('race'), raceDate: f.get('raceDate'),
      days: +f.get('days'), longDay: +f.get('longDay'), level: f.get('level'),
      startVol: fromU(+f.get('startVol')), cross: f.get('cross') === 'on'
    };
    App.coachCfg = cfg;
    saveSettings({ coach: cfg });
    const plan = buildPlan(cfg, App.fit, App.train);
    App.plan = plan.error ? null : plan;
    renderPlan(plan);
  });

  if (App.plan) renderPlan(App.plan);
}

function fld(label, input, help) {
  return '<label class="fld"><span>' + esc(label) + '</span>' + input +
    (help ? '<em class="tiny" style="font-style:normal; display:block; margin-top:4px">' + esc(help) + '</em>' : '') + '</label>';
}

function renderPlan(plan) {
  const out = $('#planOut');
  if (!out) return;
  if (plan.error) { out.innerHTML = '<div class="note bad">' + esc(plan.error) + '</div>'; return; }

  const training = plan.weeks.filter(w => !w.isRaceWeek);
  const peak = Math.max.apply(null, training.map(w => w.target));
  const totalM = sum(plan.weeks.map(w => w.target));
  const longest = Math.max.apply(null, training.map(w => w.longM));

  let h = '<div class="sechead"><h2>' + plan.total + ' weeks to your ' + esc(plan.race.name.toLowerCase()) + '</h2>' +
    '<p class="sub">' + esc(phaseSentence(plan)) + '</p></div>';

  h += '<div class="grid g4">' +
    statTile('Goal time', plan.goal ? hms(plan.goal.sec, true) : '–', '', plan.goal ? hms(plan.goal.lo, true) + ' – ' + hms(plan.goal.hi, true) : '') +
    statTile('Peak week', dist(peak), uName(), 'from ' + dist(plan.startVol) + ' ' + uName() + ' today') +
    statTile('Longest run', dist(longest), uName(), plan.nearPeak + ' week' + (plan.nearPeak === 1 ? '' : 's') + ' at or near it') +
    statTile('Total volume', dist(totalM, 0), uName(), 'across the whole plan') +
    '</div>';

  /* What this block can and cannot deliver — said before the athlete has
     spent three months finding out. */
  if (plan.advice && plan.advice.length) {
    h += '<div class="panel" style="margin-top:14px"><div class="ph"><h3>Read this before you start</h3>' +
      '<div class="tiny">' + plan.advice.length + ' note' + (plan.advice.length > 1 ? 's' : '') + ' about the shape of this block</div></div><div class="pb">';
    for (const a of plan.advice)
      h += '<div class="note ' + (a.k === 'warn' ? 'warn' : '') + '" style="margin:0 0 10px"><strong>' + esc(a.t) + '</strong><br>' + esc(a.d) + '</div>';
    h += '</div></div>';
  }
  if (plan.peakVol >= plan.cap * 0.99) h += '<div class="note warn" style="margin-top:14px">Peak volume is capped by your stated training history. If the plan feels too easy by week ' + Math.round(plan.total * 0.6) + ', change that setting and rebuild rather than adding distance ad hoc.</div>';

  /* the long-run story, which for a marathon IS the plan */
  h += '<div class="panel" style="margin-top:14px"><div class="ph"><h3>The long run</h3>' +
    '<div class="tiny">the session this whole block is built around</div></div><div class="pb">' +
    '<div class="grid g3">' +
    statTile('Peak long run', dist(plan.peakLong), uName(), Math.floor(plan.longHours) + 'h' + String(Math.round((plan.longHours % 1) * 60)).padStart(2, '0') + ' at easy pace') +
    statTile('Runs at that length', plan.nearPeak, '', 'in the ' + plan.total + '-week block') +
    statTile('Share of peak week', Math.round(plan.longShare * 100), '%', plan.longShare > 0.45 ? 'high — keep the other days truly easy' : 'comfortable') +
    '</div></div></div>';

  /* pace card */
  h += '<div class="grid g2" style="margin-top:14px"><div class="panel"><div class="ph"><h3>Your paces for this block</h3></div>' +
    '<div class="scroller"><table class="tbl"><tbody>' +
    ['E', 'M', 'T', 'I', 'R'].map(z => '<tr><td><strong>' + { E: 'Easy', M: 'Marathon', T: 'Threshold', I: 'Interval', R: 'Repetition' }[z] + '</strong></td>' +
      '<td class="n">' + paceOne(plan.paces[z]) + '</td></tr>').join('') +
    '</tbody></table></div></div>';

  h += '<div class="panel"><div class="ph"><h3>Weekly volume</h3></div><div class="pb"><div class="chartbox short"><canvas id="c-plan"></canvas></div></div></div></div>';

  h += '<div class="row" style="margin:18px 0 12px">' +
    '<button class="btn sm" type="button" id="planCsv">Save as CSV</button>' +
    '<button class="btn sm" type="button" id="planMd">Save as Markdown</button>' +
    '<button class="btn sm ghost" type="button" id="planExpand">Open every week</button></div>';

  for (const w of plan.weeks) {
    const isNow = Date.now() >= w.start && Date.now() < w.start + 7 * DAY;
    h += '<details class="wk"' + (isNow || w.i === 0 ? ' open' : '') + '>' +
      '<summary><span class="wn">Week ' + (w.i + 1) + '</span>' +
      '<span class="pill ' + phasePill(w.phase) + '">' + w.phase + '</span>' +
      '<span class="wd">' + fmtDate(w.start, { day: 'numeric', month: 'short' }) + ' – ' + fmtDate(w.start + 6 * DAY, { day: 'numeric', month: 'short' }) + '</span>' +
      (isNow ? '<span class="pill clay">this week</span>' : '') +
      '<span class="wv">' + dist(w.target) + ' ' + uName() + '</span></summary><div class="days">';
    for (const d of w.days) {
      h += '<div class="day"><span class="dn">' + DOW[d.dow] + '</span>' +
        '<span class="dt t-' + d.kind + '">' + esc(d.title) + '</span>' +
        '<span class="dd">' + (d.m ? '<em>' + dist(d.m) + ' ' + uName() + '</em> · ' : '') + esc(d.detail || '') + '</span></div>';
    }
    h += '</div></details>';
  }

  out.innerHTML = h;

  const p = palette();
  mkChart('c-plan', {
    data: {
      labels: plan.weeks.map(w => 'W' + (w.i + 1)),
      datasets: [
        { type: 'bar', label: uName(), data: plan.weeks.map(w => +toU(w.target).toFixed(1)),
          backgroundColor: plan.weeks.map(w => alpha(w.phase === 'Taper' ? p.slate : w.phase === 'Peak' ? p.clay : p.sage, .62)), borderRadius: 2 },
        { type: 'line', label: 'long run', data: plan.weeks.map(w => +toU(w.longM).toFixed(1)), borderColor: p.amber, borderWidth: 2, pointRadius: 0, tension: .3 }
      ]
    },
    options: baseOpts(p, { plugins: { legend: { display: true, position: 'bottom' }, tooltip: { callbacks: { label: tipDist } } }, scales: { y: { beginAtZero: true } } })
  });

  $('#planExpand').addEventListener('click', e => {
    const opening = e.target.textContent.indexOf('Open') === 0;
    $$('.wk', out).forEach(d => { d.open = opening; });
    e.target.textContent = opening ? 'Collapse every week' : 'Open every week';
  });
  $('#planCsv').addEventListener('click', () => offerDownload('training-plan.csv', planToCSV(plan)));
  $('#planMd').addEventListener('click', () => offerDownload('training-plan.md', planToMarkdown(plan)));
}

function phasePill(p) { return p === 'Base' ? 'good' : p === 'Build' ? 'slate' : p === 'Peak' ? 'clay' : 'amber'; }

function phaseSentence(plan) {
  const f = plan.phases;
  return f.base + ' weeks building the base, ' + f.build + ' sharpening, ' + f.peak +
    ' at race-specific work, then ' + f.taper + ' week' + (f.taper > 1 ? 's' : '') + ' of taper. ' +
    'Volume rises about ' + Math.round((plan.peakVol / plan.startVol - 1) * 100) + '% with a lighter week every fourth week to let the work land.';
}

/* ---- saving files: uses the artifact download capability when it exists,
        falls back to a plain blob link everywhere else ---- */
async function offerDownload(filename, text) {
  const mime = filename.endsWith('.csv') ? 'text/csv' : filename.endsWith('.json') ? 'application/json' : 'text/markdown';
  if (window.__dl) {
    try { await window.__dl.save({ filename, data: new Blob([text], { type: mime }) }); return; }
    catch (e) { if (e && e.code === 'declined') return; }
  }
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  } catch (e) { /* last resort: nothing to do */ }
}

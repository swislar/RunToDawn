/* Build a synthetic Apple Health export.xml that mimics the real shapes:
   old-style Workout attributes, new-style WorkoutStatistics, duplicate
   sources, indoor runs, and per-30s-ish distance samples.

   The important part for the classifier is that each session type has the
   INTERNAL SHAPE it has in real life:
     easy        flat pace throughout
     recovery    flat, slower, short
     long        flat, slow drift, long
     threshold   one sustained block well under easy pace
     intervals   short fast reps with jog recoveries between them
     progression pace lifting steadily through the run
     race        fast start to finish
   Average pace and average heart rate cannot tell intervals from an easy run.
   The leg-by-leg samples below are what make that test meaningful. */
const fs = require('fs'), os = require('os'), path = require('path');
const TMP = os.tmpdir();
function tz(d) { return d.toISOString().slice(0, 19).replace('T', ' ') + ' +0000'; }
const start = (function () { const d = new Date(Date.now() - 130 * 7 * 86400000); const wd = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - wd, 6, 0, 0); })();
const runs = [];
let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

const HRMAX = 188;
let out = '';
let recXml = [];

/* A session is a list of [metres, secPerKm] legs. */
function session(kind, base) {
  const jog = base * 1.15;
  switch (kind) {
    case 'recovery':
      return { legs: [[5000 + Math.round(rnd() * 1500), base * 1.10]], hrAvg: 0.66, hrMax: 0.72 };
    case 'easy': {
      const km = 8 + rnd() * 3;
      return { legs: [[Math.round(km * 1000), base * (0.99 + rnd() * 0.04)]], hrAvg: 0.71, hrMax: 0.78 };
    }
    case 'long': {
      const km = 16 + rnd() * 8;
      const m = Math.round(km * 1000 / 3);
      return { legs: [[m, base * 1.00], [m, base * 1.04], [m, base * 1.09]], hrAvg: 0.74, hrMax: 0.83 };
    }
    case 'threshold': {
      const T = base * 0.80;
      return { legs: [[2000, base], [3000, T], [800, jog], [3000, T], [2000, base]], hrAvg: 0.84, hrMax: 0.90 };
    }
    case 'intervals': {
      const R = base * 0.70;
      const legs = [[2000, base]];
      for (let i = 0; i < 8; i++) { legs.push([400, R]); legs.push([200, jog * 1.10]); }
      legs.push([2000, base]);
      // average HR is DILUTED by the recoveries; peak is near maximum
      return { legs, hrAvg: 0.80, hrMax: 0.96 };
    }
    case 'reps1k': {
      const I = base * 0.755;
      const legs = [[2000, base]];
      for (let i = 0; i < 5; i++) { legs.push([1000, I]); legs.push([400, jog * 1.10]); }
      legs.push([1500, base]);
      return { legs, hrAvg: 0.83, hrMax: 0.95 };
    }
    case 'progression': {
      const m = 2200;
      return { legs: [[m, base * 1.03], [m, base * 0.97], [m, base * 0.90], [m, base * 0.83]], hrAvg: 0.82, hrMax: 0.90 };
    }
  }
}

function emitSamples(day, legs, src) {
  let t = day;
  for (const [metres, pace] of legs) {
    let done = 0;
    while (done < metres - 0.5) {
      const dm = Math.min(30 / pace * 1000, metres - done);
      const dt = dm * pace / 1000;
      recXml.push(`<Record type="HKQuantityTypeIdentifierDistanceWalkingRunning" sourceName="${src}" unit="km" creationDate="${tz(new Date(t))}" startDate="${tz(new Date(t))}" endDate="${tz(new Date(t + dt * 1000))}" value="${(dm / 1000).toFixed(5)}"/>`);
      t += dt * 1000; done += dm;
    }
  }
  return t;
}

const WEEKLY = [
  ['easy', 'intervals', 'easy', 'threshold', 'long'],
  ['recovery', 'reps1k', 'easy', 'progression', 'long'],
  ['easy', 'threshold', 'easy', 'easy', 'long'],
  ['recovery', 'intervals', 'easy', 'easy', 'long']
];

for (let w = 0; w < 130; w++) {
  const base = 400 - w * 0.35;                  // easy pace, seconds per km
  const plan = w < 20 ? ['easy', 'easy', 'easy', 'easy', 'long'] : WEEKLY[w % WEEKLY.length];

  for (let k = 0; k < 5; k++) {
    const kind = plan[k];
    const day = start + (w * 7 + [0, 1, 3, 4, 6][k]) * 86400000 + Math.floor(rnd() * 3600000);
    const s = session(kind, base);
    const metres = s.legs.reduce((a, l) => a + l[0], 0);
    const dur = Math.round(s.legs.reduce((a, l) => a + l[0] * l[1] / 1000, 0));
    const km = metres / 1000;
    const end = day + dur * 1000;
    const hrAvg = Math.round(HRMAX * s.hrAvg);
    const hrMax = Math.round(HRMAX * s.hrMax);
    runs.push({ day, km, dur, kind });

    if (w % 2 === 0) {
      out += `<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="${(dur / 60).toFixed(5)}" durationUnit="min" totalDistance="${km.toFixed(5)}" totalDistanceUnit="km" totalEnergyBurned="${Math.round(km * 65)}" totalEnergyBurnedUnit="kcal" sourceName="Apple Watch" sourceVersion="10.1" creationDate="${tz(new Date(end))}" startDate="${tz(new Date(day))}" endDate="${tz(new Date(end))}">\n`;
      out += ` <MetadataEntry key="HKIndoorWorkout" value="0"/>\n <MetadataEntry key="HKElevationAscended" value="${Math.round(km * 800)} cm"/>\n`;
      out += ` <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" startDate="${tz(new Date(day))}" endDate="${tz(new Date(end))}" average="${hrAvg}" minimum="98" maximum="${hrMax}" unit="count/min"/>\n`;
      out += `</Workout>\n`;
    } else {
      out += `<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="${(dur / 60).toFixed(5)}" durationUnit="min" sourceName="Apple Watch" startDate="${tz(new Date(day))}" endDate="${tz(new Date(end))}">\n`;
      out += ` <MetadataEntry key="HKIndoorWorkout" value="0"/>\n`;
      out += ` <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" sum="${km.toFixed(5)}" unit="km"/>\n`;
      out += ` <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="${hrAvg}" maximum="${hrMax}" unit="count/min"/>\n`;
      out += `</Workout>\n`;
    }

    if (w % 7 === 3 && k === 0) {
      out += `<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="${(dur / 60).toFixed(5)}" durationUnit="min" totalDistance="${(km * 0.98).toFixed(5)}" totalDistanceUnit="km" sourceName="Strava" startDate="${tz(new Date(day + 40000))}" endDate="${tz(new Date(end + 40000))}"/>\n`;
    }

    emitSamples(day, s.legs, 'Apple Watch');

    for (let j = 0; j < 6; j++) {
      const t2 = day + 6 * 3600000 + j * 1800000;
      recXml.push(`<Record type="HKQuantityTypeIdentifierDistanceWalkingRunning" sourceName="iPhone" unit="km" creationDate="${tz(new Date(t2))}" startDate="${tz(new Date(t2))}" endDate="${tz(new Date(t2 + 240000))}" value="0.31000"/>`);
    }
  }

  out += `<Workout workoutActivityType="HKWorkoutActivityTypeCycling" duration="45" durationUnit="min" totalDistance="18" totalDistanceUnit="km" sourceName="Apple Watch" startDate="${tz(new Date(start + (w * 7 + 5) * 86400000))}" endDate="${tz(new Date(start + (w * 7 + 5) * 86400000 + 2700000))}"/>\n`;
  recXml.push(`<Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Apple Watch" unit="count/min" startDate="${tz(new Date(start + w * 7 * 86400000))}" endDate="${tz(new Date(start + w * 7 * 86400000))}" value="${Math.round(52 - w * 0.02)}"/>`);
}

/* A genuine half-marathon race, 5 weeks before the synthetic "now". */
const raceDay = start + 125 * 7 * 86400000 + 8 * 3600000;
const racePace = 268;
const raceDur = Math.round(21097.5 * racePace / 1000);
out += `<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="${(raceDur / 60).toFixed(5)}" durationUnit="min" totalDistance="21.09750" totalDistanceUnit="km" sourceName="Apple Watch" startDate="${tz(new Date(raceDay))}" endDate="${tz(new Date(raceDay + raceDur * 1000))}">\n`;
out += ` <MetadataEntry key="HKIndoorWorkout" value="0"/>\n`;
out += ` <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="${Math.round(HRMAX * 0.91)}" maximum="${Math.round(HRMAX * 0.97)}" unit="count/min"/>\n`;
out += `</Workout>\n`;
emitSamples(raceDay, [[21097.5, racePace]], 'Apple Watch');
runs.push({ day: raceDay, km: 21.0975, dur: raceDur, kind: 'race' });

/* An indoor treadmill run with a suspiciously fast pace. */
out += `<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" totalDistance="8.5" totalDistanceUnit="km" sourceName="Apple Watch" startDate="${tz(new Date(raceDay + 3 * 86400000))}" endDate="${tz(new Date(raceDay + 3 * 86400000 + 1800000))}">\n <MetadataEntry key="HKIndoorWorkout" value="1"/>\n</Workout>\n`;

/* A real walk logged as a walk, and a hike logged as a RUN by a third-party
   app. Both should be kept out of the running analytics. */
const walkDay = start + 128 * 7 * 86400000 + 10 * 3600000;
out += `<Workout workoutActivityType="HKWorkoutActivityTypeWalking" duration="62" durationUnit="min" totalDistance="4.80000" totalDistanceUnit="km" sourceName="Apple Watch" startDate="${tz(new Date(walkDay))}" endDate="${tz(new Date(walkDay + 3720000))}"/>\n`;
const hikeDay = walkDay + 2 * 86400000;
const hikeDur = 5200;
out += `<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="${(hikeDur / 60).toFixed(5)}" durationUnit="min" totalDistance="6.20000" totalDistanceUnit="km" sourceName="SomeTracker" startDate="${tz(new Date(hikeDay))}" endDate="${tz(new Date(hikeDay + hikeDur * 1000))}">\n`;
out += ` <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="104" maximum="118" unit="count/min"/>\n`;
out += `</Workout>\n`;
emitSamples(hikeDay, [[6200, 838]], 'SomeTracker');
runs.push({ day: hikeDay, km: 6.2, dur: hikeDur, kind: 'walk' });

out = `<?xml version="1.0" encoding="UTF-8"?>\n<HealthData locale="en_SG">\n` + recXml.join('\n') + '\n' + out + `</HealthData>\n`;
fs.writeFileSync(path.join(TMP, 'export.xml'), out);

const byKind = {};
for (const r of runs) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
fs.writeFileSync(path.join(TMP, 'truth.json'), JSON.stringify(runs.map(r => ({ day: r.day, kind: r.kind }))));
console.log('wrote', (out.length / 1048576).toFixed(1), 'MB;', runs.length, 'runs');
console.log('ground truth:', Object.entries(byKind).map(([k, v]) => k + ' ' + v).join('  '));
console.log('last run', new Date(Math.max.apply(null, runs.map(r => r.day))).toISOString().slice(0, 10));

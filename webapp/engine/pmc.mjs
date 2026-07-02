// Performance Management Chart (CTL/ATL/TSB) — a faithful JS port of
// core/training_load.py. Pure, dependency-free. The Python core stays canonical;
// test/engine.test.mjs asserts this matches golden vectors dumped from it.
//
// Activity shape (already parsed — the browser's FIT decode fills this in):
//   { date: "YYYY-MM-DD" (UTC calendar day), sport, duration_s,
//     avg_power?, avg_heart_rate?, powers?: number[] }

// Banister TRIMP coefficients + the normaliser that puts a hard hour near 100.
const TRIMP_B = 0.64;
const TRIMP_C = 1.92;
const TRIMP_SCALE = 100.0 / (60.0 * 0.85 * TRIMP_B * Math.exp(TRIMP_C * 0.85));
const DEFAULT_RESTING_HR = 60;
const DURATION_LOAD_PER_MIN = 1.0;
const NP_WINDOW_S = 30;
const BASIS_UNIT = { power: "tss", hr: "trimp", duration: "tss" };

const round1 = (x) => Math.round(x * 10) / 10;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// Normalized Power: 4th root of the mean of the 30s rolling-average power^4.
function normalizedPower(powers, window = NP_WINDOW_S) {
  const vals = powers.filter((p) => p != null);
  const n = vals.length;
  if (n === 0) return 0;
  const w = n >= window ? window : n;
  let acc = 0;
  for (let i = 0; i < w; i++) acc += vals[i];
  const rolled = [acc / w];
  for (let i = w; i < n; i++) { acc += vals[i] - vals[i - w]; rolled.push(acc / w); }
  const mean4 = rolled.reduce((s, r) => s + r ** 4, 0) / rolled.length;
  return mean4 ** 0.25;
}

// One activity's daily-load contribution and the basis used (or null if unscorable).
export function scoreActivity(a, athlete, restingHr) {
  const durationS = a.duration_s || 0;
  if (durationS <= 0) return null;
  const minutes = durationS / 60;

  if (athlete.ftp_w && athlete.ftp_w > 0) {
    const np = a.powers && a.powers.length ? normalizedPower(a.powers)
      : (a.avg_power ? Number(a.avg_power) : null);
    if (np && np > 0) {
      const intensity = np / Number(athlete.ftp_w);
      return { load: 100.0 * (durationS / 3600.0) * intensity * intensity, basis: "power" };
    }
  }
  if (athlete.max_heart_rate && athlete.max_heart_rate > 0 && a.avg_heart_rate) {
    const span = Number(athlete.max_heart_rate) - restingHr;
    if (span > 0) {
      const hrr = clamp01((Number(a.avg_heart_rate) - restingHr) / span);
      const trimp = minutes * hrr * TRIMP_B * Math.exp(TRIMP_C * hrr);
      return { load: trimp * TRIMP_SCALE, basis: "hr" };
    }
  }
  return { load: minutes * DURATION_LOAD_PER_MIN, basis: "duration" };
}

function* dateRange(minIso, maxIso) {
  let d = Date.parse(minIso + "T00:00:00Z");
  const end = Date.parse(maxIso + "T00:00:00Z");
  for (; d <= end; d += 86400000) yield new Date(d).toISOString().slice(0, 10);
}

const hasPower = (a) => Boolean(a.avg_power) || (a.powers || []).some((p) => p);

// Full PMC. Mirrors compute_training_load(...).as_dict().
export function computeTrainingLoad(activities, athlete, opts = {}) {
  const { sport = null, ctlDays = 42, atlDays = 7, asOf = null } = opts;
  const acts = activities.filter((a) => sport === null || a.sport === sport);
  const restingHr = Number(athlete.resting_heart_rate || DEFAULT_RESTING_HR);

  const daily = new Map();
  const basis = { power: 0, hr: 0, duration: 0 };
  const unitsSeen = new Set();
  let scored = 0;
  for (const a of acts) {
    const s = scoreActivity(a, athlete, restingHr);
    if (!s) continue;
    daily.set(a.date, (daily.get(a.date) || 0) + s.load);
    basis[s.basis] += 1;
    unitsSeen.add(BASIS_UNIT[s.basis]);
    scored += 1;
  }
  // Evaluate "as of" a day by extending the timeline with a zero-load day.
  if (asOf && daily.size && !daily.has(asOf)) daily.set(asOf, 0);

  const unit = unitsSeen.size === 0 ? "tss" : unitsSeen.size === 1 ? [...unitsSeen][0] : "mixed";
  const needs = [];
  if (acts.some(hasPower) && !(athlete.ftp_w > 0)) needs.push("ftp_w");
  if (acts.some((a) => a.avg_heart_rate) && !(athlete.max_heart_rate > 0)) needs.push("max_heart_rate");
  const coverage = { activities: acts.length, scored, basis };

  const series = [];
  if (daily.size) {
    const keys = [...daily.keys()].sort();
    const aCtl = 1 - Math.exp(-1 / ctlDays);
    const aAtl = 1 - Math.exp(-1 / atlDays);
    let pc = 0, pa = 0;
    for (const date of dateRange(keys[0], keys[keys.length - 1])) {
      const load = daily.get(date) || 0;
      const tsb = pc - pa;
      pc += (load - pc) * aCtl;
      pa += (load - pa) * aAtl;
      series.push({ date, load: round1(load), ctl: round1(pc), atl: round1(pa), tsb: round1(tsb) });
    }
  }
  const current = series.length ? series[series.length - 1] : null;
  return { unit, ctl_days: ctlDays, atl_days: atlDays, current, series, coverage, needs };
}

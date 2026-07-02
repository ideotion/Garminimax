// Dynamic-coach sensor state — a faithful JS port of core/coach_state.py.
// Reads today's fitness/fatigue/form, ramp, ACWR, monotony/strain, days-since-hard
// and (from wellness) resting-HR readiness. Reuses the PMC (single load source).
//
// Interpretive thresholds mirror web/content/coach/coach-evidence.pack.json
// (Gabbett 2016 ACWR; Buchheit 2014 readiness; Foster 1998 monotony/strain).
import { computeTrainingLoad } from "./pmc.mjs";

export const ACWR_ACUTE_DAYS = 7;
export const ACWR_CHRONIC_DAYS = 28;
export const ACWR_UNDERTRAINING_BELOW = 0.8;
export const ACWR_SWEET_SPOT_HIGH = 1.3;
export const ACWR_CAUTION_HIGH = 1.5;
export const HARD_DAY_LOAD_RATIO = 1.5;
export const HARD_DAY_MIN_LOAD = 50.0;
export const READINESS_RHR_ELEVATED = 5;
export const READINESS_BASELINE_DAYS = 7;
const RAMP_MIN_DAYS = 8;

const round0 = (x) => Math.round(x);
const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;
const sum = (xs) => xs.reduce((s, v) => s + v, 0);
const mean = (xs) => sum(xs) / xs.length;
const pstdev = (xs) => { const m = mean(xs); return Math.sqrt(sum(xs.map((v) => (v - m) ** 2)) / xs.length); };
const daysBetween = (aIso, bIso) =>
  Math.round((Date.parse(aIso + "T00:00:00Z") - Date.parse(bIso + "T00:00:00Z")) / 86400000);

function acwrZone(acwr) {
  if (acwr == null) return null;
  if (acwr < ACWR_UNDERTRAINING_BELOW) return "undertraining";
  if (acwr <= ACWR_SWEET_SPOT_HIGH) return "sweet_spot";
  if (acwr <= ACWR_CAUTION_HIGH) return "caution";
  return "high_risk";
}

function readiness(wellness, asOf) {
  const days = (wellness || [])
    .filter((w) => w.date <= asOf)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!days.length) return null;
  const latest = days[days.length - 1];
  const baselineDays = days.slice(-(READINESS_BASELINE_DAYS + 1), -1); // prior week, excl. latest
  const rhrs = baselineDays.map((w) => w.resting_hr).filter((v) => v != null);
  const baseline = rhrs.length ? round1(mean(rhrs)) : null;
  const rhrDelta = baseline != null && latest.resting_hr != null
    ? round1(latest.resting_hr - baseline) : null;
  const fresh = rhrDelta == null ? null : rhrDelta < READINESS_RHR_ELEVATED;
  return {
    date: latest.date, resting_hr: latest.resting_hr ?? null,
    baseline_resting_hr: baseline, rhr_delta: rhrDelta,
    avg_stress: latest.avg_stress ?? null, fresh, basis: "wellness:resting_hr+stress",
  };
}

export function computeCoachState(activities, athlete, opts = {}) {
  const { sport = null, asOf = null, wellness = null } = opts;
  const tl = computeTrainingLoad(activities, athlete, { sport, asOf });
  const series = tl.series;
  const ready = readiness(wellness, asOf);
  const notes = [];

  const base = {
    as_of: asOf, unit: tl.unit, ctl: null, atl: null, tsb: null, ramp_rate: null,
    acwr: null, acwr_zone: null, monotony: null, strain: null, days_since_hard: null,
    last_hard_date: null, readiness: ready, history_days: 0,
    coverage: tl.coverage, needs: [...tl.needs], notes,
  };
  if (!series.length) {
    notes.push("No scored activities yet -- import history to start coaching.");
    return base;
  }

  const current = series[series.length - 1];
  const loads = series.map((d) => d.load);
  const historyDays = series.length;

  let rampRate = null;
  if (historyDays >= RAMP_MIN_DAYS) rampRate = round1(current.ctl - series[historyDays - RAMP_MIN_DAYS].ctl);
  else notes.push(`Ramp rate needs ${RAMP_MIN_DAYS} days of history (${historyDays} so far).`);

  let acwr = null;
  if (historyDays >= ACWR_CHRONIC_DAYS) {
    const acute = sum(loads.slice(-ACWR_ACUTE_DAYS));
    const chronic = sum(loads.slice(-ACWR_CHRONIC_DAYS)) / (ACWR_CHRONIC_DAYS / ACWR_ACUTE_DAYS);
    acwr = chronic > 0 ? round2(acute / chronic) : null;
  }
  if (acwr != null) notes.push("ACWR is a useful but contested signal -- treat it as one input, not a verdict.");
  else if (historyDays < ACWR_CHRONIC_DAYS) notes.push(`ACWR needs ${ACWR_CHRONIC_DAYS} days of history (${historyDays} so far).`);

  let monotony = null, strain = null;
  const last7 = loads.slice(-7);
  if (last7.length >= 2) {
    const m7 = mean(last7), sd7 = pstdev(last7);
    if (sd7 > 0) { monotony = round2(m7 / sd7); strain = round0(sum(last7) * monotony); }
    else if (m7 > 0) notes.push("Every day this week carried similar load (very monotonous) -- vary your days.");
  }

  let lastHard = null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].load >= Math.max(HARD_DAY_MIN_LOAD, HARD_DAY_LOAD_RATIO * series[i].ctl)) {
      lastHard = series[i].date; break;
    }
  }
  const daysSinceHard = lastHard ? daysBetween(asOf, lastHard) : null;

  if (historyDays < 42) notes.push("Fitness (CTL) is still warming up in the first ~6 weeks of history (understated).");

  return {
    ...base, ctl: current.ctl, atl: current.atl, tsb: current.tsb, ramp_rate: rampRate,
    acwr, acwr_zone: acwrZone(acwr), monotony, strain, days_since_hard: daysSinceHard,
    last_hard_date: lastHard, history_days: historyDays,
  };
}

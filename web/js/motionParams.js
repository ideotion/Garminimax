/* motionParams — pure mappings from recorded activity metrics to figure motion
   parameters (mission PR9): cadence -> gait frequency & rep tempo, heart rate ->
   breathing rate, effort flush, and a subtle fatigue posture droop.

   No I/O, no DOM, no state: numbers in, bounded numbers out, deterministic and
   null-safe (missing inputs return neutral values so nothing changes until real
   data is wired in). Runs in the browser (window.MotionParams) and under Node,
   where every table is unit-tested.

   Sources (biomechanics appendix Sect. D): HR zones use the simple %HRmax model
   (Z1 50-60 .. Z5 90-100); breathing couples to cadence via step-breath ratios
   (Z1-2 4:4, Z3 3:3, Z4 2:2, Z5 ragged) with per-zone clamps inside the measured
   ranges (ALA resting 12-20; Blackie 1991 maximal 40-60); running cadence norms
   150-200 spm, per-leg cycle = spm/120 Hz. The cadence->tempo and zone->breath
   couplings are labeled in the appendix as constructed heuristics anchored to
   measured endpoints — they are exposed here as tunable tables, not asserted as
   physiology. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MotionParams = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const num = (v) => (typeof v === "number" && isFinite(v) && v > 0 ? v : null);

  // HR zone from the simple %HRmax model: Z1 50-60 .. Z5 90-100.
  // Below 50% counts as Z1 (at-rest movement); missing inputs default to Z2
  // (easy) — the neutral assumption for guided home movement.
  function hrZone(hr, hrMax) {
    const h = num(hr), m = num(hrMax);
    if (!h || !m) return 2;
    const f = h / m;
    if (f < 0.6) return 1;
    if (f < 0.7) return 2;
    if (f < 0.8) return 3;
    if (f < 0.9) return 4;
    return 5;
  }

  // Steps per full breath (inhale+exhale) and the per-zone breaths/min clamp.
  // Ratios per the appendix's coupling table; clamps sit inside the measured
  // resting->maximal ranges so degenerate cadences can't produce absurd rates.
  const BREATH_TABLE = {
    1: { steps: 8, min: 12, max: 18 },   // 4:4
    2: { steps: 8, min: 14, max: 24 },   // 4:4
    3: { steps: 6, min: 24, max: 40 },   // 3:3
    4: { steps: 4, min: 38, max: 46 },   // 2:2
    5: { steps: 3.5, min: 44, max: 60 }, // ragged (<2:2)
  };

  // Breathing rate (breaths/min) from cadence + heart rate. With cadence the
  // breath locks to step count (zone ratio); without it, the zone midpoint.
  function breathRateFor(input = {}) {
    const zone = hrZone(input.hr, input.hrMax);
    const t = BREATH_TABLE[zone];
    const cad = num(input.cadence_spm);
    if (!cad) return Math.round((t.min + t.max) / 2);
    return Math.round(clamp(cad / t.steps, t.min, t.max));
  }

  // Per-leg gait cycle frequency (Hz) from cadence (steps/min, both feet):
  // one leg cycles at cadence/2 per minute -> spm/120 per second.
  function gaitFrequency(cadence_spm) {
    const cad = num(cadence_spm);
    return cad ? cad / 120 : 0;
  }

  // Rep-tempo multiplier from cadence, against an easy-run baseline of 170 spm:
  // slower cadence -> slower reps. Bounded to the engine's usable tempo band.
  const TEMPO_BASELINE_SPM = 170;
  function repTempoScale(cadence_spm) {
    const cad = num(cadence_spm);
    if (!cad) return 1;
    return clamp(TEMPO_BASELINE_SPM / cad, 0.6, 1.8);
  }

  // Effort flush 0..1 (sweat/skin-flush ramp for renderers): 0 up to 60% HRmax,
  // 1 from 95%. A display scalar, not a physiological claim.
  function effortFlush(hr, hrMax) {
    const h = num(hr), m = num(hrMax);
    if (!h || !m) return 0;
    return clamp((h / m - 0.6) / 0.35, 0, 1);
  }

  // Subtle fatigue posture droop (degrees of extra trunk pitch): 0 below 75%
  // HRmax, ramping to DROOP_MAX_DEG at 100%. Bounded here AND in applyLife.
  const DROOP_MAX_DEG = 4;
  function fatigueDroop(hr, hrMax) {
    const h = num(hr), m = num(hrMax);
    if (!h || !m) return 0;
    return clamp((h / m - 0.75) / 0.25, 0, 1) * DROOP_MAX_DEG;
  }

  // One-call bundle for the renderer's optional `live` hookup.
  function motionParamsFor(input = {}) {
    return {
      zone: hrZone(input.hr, input.hrMax),
      breathRate: breathRateFor(input),
      gaitHz: gaitFrequency(input.cadence_spm),
      tempoScale: repTempoScale(input.cadence_spm),
      flush: effortFlush(input.hr, input.hrMax),
      droopDeg: fatigueDroop(input.hr, input.hrMax),
    };
  }

  return {
    hrZone, breathRateFor, gaitFrequency, repTempoScale, effortFlush,
    fatigueDroop, motionParamsFor, BREATH_TABLE, TEMPO_BASELINE_SPM, DROOP_MAX_DEG,
  };
});

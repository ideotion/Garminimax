// SPDX-License-Identifier: GPL-3.0-or-later
// Table-driven tests for the activity-metrics -> motion-parameters mappings
// (web/js/motionParams.js, mission PR9) and the applyLife droop extension.
// All functions are pure, bounded, and null-safe: missing inputs return
// neutral values so default behaviour is unchanged until live data is wired.
"use strict";
const assert = require("node:assert");
const { test } = require("node:test");
const MP = require("../../web/js/motionParams.js");
const P = require("../../web/js/pose3d.js");

test("PR9: hrZone follows the simple %HRmax table and defaults to Z2", () => {
  const rows = [
    [95, 190, 1],   // 50%
    [110, 190, 1],  // 58%
    [125, 190, 2],  // 66%
    [145, 190, 3],  // 76%
    [165, 190, 4],  // 87%
    [180, 190, 5],  // 95%
    [null, 190, 2], // missing hr -> neutral easy
    [140, null, 2], // missing hrMax -> neutral easy
  ];
  for (const [hr, hrMax, zone] of rows) {
    assert.strictEqual(MP.hrZone(hr, hrMax), zone, `hr=${hr}/${hrMax}`);
  }
});

test("PR9: breathing couples to cadence via zone step-ratios, clamped to bands", () => {
  const rows = [
    // cadence, hr, hrMax, expected br/min
    [160, 120, 190, 20],   // Z2, 160/8 = 20
    [170, 145, 190, 28],   // Z3, 170/6 = 28.3 -> 28
    [180, 165, 190, 45],   // Z4, 180/4 = 45
    [180, 182, 190, 51],   // Z5, 180/3.5 = 51.4 -> 51
    [80, 165, 190, 38],    // degenerate low cadence clamps to the Z4 floor
    [300, 120, 190, 24],   // degenerate high cadence clamps to the Z2 ceiling
    [null, 165, 190, 42],  // no cadence -> Z4 midpoint
    [null, null, null, 19],// nothing -> Z2 midpoint (easy guided movement)
  ];
  for (const [cad, hr, hrMax, want] of rows) {
    assert.strictEqual(MP.breathRateFor({ cadence_spm: cad, hr, hrMax }), want,
      `cad=${cad} hr=${hr}`);
  }
  // Every value the table can produce sits inside the measured 12-60 range.
  for (const z of [1, 2, 3, 4, 5]) {
    const t = MP.BREATH_TABLE[z];
    assert.ok(t.min >= 12 && t.max <= 60, `zone ${z} band inside 12-60`);
  }
});

test("PR9: gait frequency is cadence/120 Hz per leg", () => {
  assert.strictEqual(MP.gaitFrequency(180), 1.5);
  assert.strictEqual(MP.gaitFrequency(150), 1.25);
  assert.ok(Math.abs(MP.gaitFrequency(200) - 5 / 3) < 1e-9);
  assert.strictEqual(MP.gaitFrequency(null), 0);
  assert.strictEqual(MP.gaitFrequency(-10), 0);
});

test("PR9: rep tempo scales against the 170 spm baseline, bounded", () => {
  assert.strictEqual(MP.repTempoScale(170), 1);
  assert.ok(Math.abs(MP.repTempoScale(200) - 0.85) < 1e-9);  // faster cadence -> quicker reps
  assert.strictEqual(MP.repTempoScale(85), 1.8);             // 2.0 clamped to 1.8
  assert.strictEqual(MP.repTempoScale(1000), 0.6);           // floor
  assert.strictEqual(MP.repTempoScale(undefined), 1);        // neutral default
});

test("PR9: effort flush ramps 0 at 60% HRmax to 1 at 95%, else 0", () => {
  assert.strictEqual(MP.effortFlush(100, 200), 0);           // 50%
  assert.strictEqual(MP.effortFlush(120, 200), 0);           // 60% edge
  const mid = MP.effortFlush(155, 200);                      // 77.5% -> 0.5
  assert.ok(Math.abs(mid - 0.5) < 1e-9, `mid=${mid}`);
  assert.strictEqual(MP.effortFlush(190, 200), 1);           // 95%
  assert.strictEqual(MP.effortFlush(220, 200), 1);           // clamped over max
  assert.strictEqual(MP.effortFlush(null, 200), 0);
});

test("PR9: fatigue droop is 0 below 75% HRmax and bounded at DROOP_MAX_DEG", () => {
  assert.strictEqual(MP.fatigueDroop(140, 200), 0);          // 70%
  assert.strictEqual(MP.fatigueDroop(150, 200), 0);          // 75% edge
  const mid = MP.fatigueDroop(175, 200);                     // 87.5% -> half
  assert.ok(Math.abs(mid - MP.DROOP_MAX_DEG / 2) < 1e-9);
  assert.strictEqual(MP.fatigueDroop(200, 200), MP.DROOP_MAX_DEG);
  assert.strictEqual(MP.fatigueDroop(260, 200), MP.DROOP_MAX_DEG);  // clamped
  assert.strictEqual(MP.fatigueDroop(150, null), 0);
  // Monotone non-decreasing across the ramp.
  let prev = -1;
  for (let hr = 100; hr <= 210; hr += 5) {
    const d = MP.fatigueDroop(hr, 200);
    assert.ok(d >= prev, `droop must not decrease (hr=${hr})`);
    prev = d;
  }
});

test("PR9: the bundle is deterministic and neutral without inputs", () => {
  const a = MP.motionParamsFor({ cadence_spm: 172, hr: 150, hrMax: 190 });
  const b = MP.motionParamsFor({ cadence_spm: 172, hr: 150, hrMax: 190 });
  assert.deepStrictEqual(a, b);
  const neutral = MP.motionParamsFor({});
  assert.deepStrictEqual(
    { tempo: neutral.tempoScale, flush: neutral.flush, droop: neutral.droopDeg, gait: neutral.gaitHz },
    { tempo: 1, flush: 0, droop: 0, gait: 0 });
});

test("PR9: applyLife droop pitches the trunk, hard-bounded, default unchanged", () => {
  const pose = {};
  P.BONES.forEach((b) => { pose[b.name] = [0, 0, 0, 1]; });
  // Default path (no droop) is bit-for-bit what it was.
  const plain = P.applyLife(pose, 500, { breath: 1, sway: 1 });
  const withZero = P.applyLife(pose, 500, { breath: 1, sway: 1, droopDeg: 0 });
  assert.deepStrictEqual(plain, withZero);
  // Droop alone pitches the thoracic bone by exactly the requested degrees...
  const drooped = P.applyLife(pose, 500, { droopDeg: 3 });
  assert.ok(Math.abs(P.swingAngle(drooped.thoracic) - 3 * Math.PI / 180) < 1e-9);
  // ...and absurd values clamp to LIFE_MAX.droopDeg.
  const wild = P.applyLife(pose, 500, { droopDeg: 999 });
  assert.ok(P.swingAngle(wild.thoracic) <= P.LIFE_MAX.droopDeg * Math.PI / 180 + 1e-9);
});

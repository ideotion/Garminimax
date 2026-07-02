// SPDX-License-Identifier: GPL-3.0-or-later
// Tests for the self-mocap landmark->keyframe mapping (tools/selfmocap/,
// mission PR10) using SYNTHETIC MoveNet COCO-17 fixtures — no model, no
// weights, no camera. The mapping is scale/translation-invariant, gates on
// confidence, and its output feeds the 2-D->3-D adapter like any authored view.
"use strict";
const assert = require("node:assert");
const { test } = require("node:test");
const LM = require("../../tools/selfmocap/landmarkMap.js");
const P = require("../../web/js/pose3d.js");

// A synthetic standing person in image pixels (origin top-left, y down),
// roughly centered at x=320 in a 640x480 frame. Indices per COCO-17.
function standingLandmarks(scale = 1, dx = 0, dy = 0) {
  const pts = [
    [320, 80],           // 0 nose
    [312, 74], [328, 74],// eyes
    [305, 80], [335, 80],// ears
    [280, 140], [360, 140], // shoulders
    [270, 210], [370, 210], // elbows
    [265, 275], [375, 275], // wrists
    [295, 250], [345, 250], // hips
    [292, 340], [348, 340], // knees
    [290, 430], [350, 430], // ankles
  ];
  return pts.map(([x, y]) => [x * scale + dx, y * scale + dy, 0.9]);
}

test("PR10: a standing frame maps to a sane art-space front pose", () => {
  const pose = LM.landmarksToPose2D(standingLandmarks());
  assert.ok(pose, "pose produced");
  // Hips anchored at the canonical position, head above shoulders above hips
  // (art y grows downward), ankles at the canonical ground band.
  assert.ok(Math.abs(pose.hip[0] - 120) < 0.5 && Math.abs(pose.hip[1] - 178) < 0.5);
  assert.ok(pose.head[1] < pose.sh[1] && pose.sh[1] < pose.hip[1]);
  assert.ok(Math.abs((pose.lankle[1] + pose.rankle[1]) / 2 - 312) < 1);
  // Subject-left lands on the l* joints (un-mirrored camera).
  assert.ok(pose.lknee[0] < pose.rknee[0]);
});

test("PR10: mapping is scale- and translation-invariant", () => {
  const a = LM.landmarksToPose2D(standingLandmarks(1));
  const b = LM.landmarksToPose2D(standingLandmarks(2.5, 100, -40));
  for (const k of Object.keys(a)) {
    assert.ok(Math.abs(a[k][0] - b[k][0]) < 0.2 && Math.abs(a[k][1] - b[k][1]) < 0.2, k);
  }
});

test("PR10: low-confidence joints are dropped, torso is the minimum", () => {
  const lm = standingLandmarks();
  lm[9][2] = 0.1;                    // left wrist below threshold
  const pose = LM.landmarksToPose2D(lm);
  assert.ok(pose && !("lhand" in pose), "low-confidence wrist omitted");
  // Without both hips there is no anchor: unusable frame.
  const noHips = standingLandmarks();
  noHips[11][2] = 0.1; noHips[12][2] = 0.1;
  assert.strictEqual(LM.landmarksToPose2D(noHips), null);
});

test("PR10: mirrored (selfie) capture flips left/right", () => {
  const pose = LM.landmarksToPose2D(standingLandmarks(), { mirrored: true });
  assert.ok(pose.lknee[0] > pose.rknee[0], "mirroring swaps sides in x");
});

test("PR10: the mapped pose drives the existing 2-D->3-D adapter", () => {
  const pose = LM.landmarksToPose2D(standingLandmarks());
  const adapted = P.adaptPose({ front: { stand: pose } }, "stand");
  const jp = P.forwardKinematics(adapted, { ground: true });
  assert.ok(jp.head[1] > jp.spine[1] && jp.spine[1] > jp.hips[1] * 0.9, "upright figure");
});

test("PR10: frames reduce to a deterministic draft exercise", () => {
  // A two-second squat: hips and head descend then rise.
  const frames = [];
  const transform = LM.computeTransform(standingLandmarks());   // calibrate ONCE, standing
  for (let i = 0; i <= 20; i++) {
    const drop = Math.sin((i / 20) * Math.PI) * 60;   // down then up, px
    const lm = standingLandmarks();
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].forEach((idx) => { lm[idx][1] += drop; });
    frames.push({ tMs: i * 100, pose: LM.landmarksToPose2D(lm, { transform }) });
  }
  const draft = LM.framesToKeyframes(frames, { keyframes: 3 });
  assert.ok(draft && draft.views.front && draft.phases.length >= 2);
  const again = LM.framesToKeyframes(frames, { keyframes: 3 });
  assert.deepStrictEqual(draft, again, "deterministic");
  // The mid keyframe captures the descent (hip art-y larger = lower).
  const poses = Object.values(draft.views.front);
  const hipYs = poses.map((p) => p.hip[1]);
  assert.ok(Math.max(...hipYs) > hipYs[0] + 10, "squat descent preserved in keyframes");
  // Every phase references a real pose (matches the content integrity rule).
  const names = new Set(Object.keys(draft.views.front));
  for (const ph of draft.phases) assert.ok(names.has(ph.from) && names.has(ph.to));
});

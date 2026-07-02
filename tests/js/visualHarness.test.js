// SPDX-License-Identifier: GPL-3.0-or-later
// Tests for the visual-regression harness (scripts/visual-harness.js): the
// snapshot pipeline is deterministic, an intentionally altered pose is flagged,
// the committed baseline parses and its approval policy is enforced (drift is
// fatal only once a HUMAN has approved the baselines — the agent never
// approves), and the SVG gallery emits real drawable images.
"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const { test } = require("node:test");
const VH = require("../../scripts/visual-harness.js");

const subset = () => VH.loadContent().slice(0, 2);

test("PR8: signatures are deterministic across runs", () => {
  const a = VH.buildSignatures(subset());
  const b = VH.buildSignatures(subset());
  assert.deepStrictEqual(a, b);
  assert.ok(Object.keys(a).length >= 4, "expected several snapshots per movement");
});

test("PR8: an intentionally altered pose changes its signature", () => {
  const [ex] = subset();
  const tampered = JSON.parse(JSON.stringify(ex));
  const view = tampered.views.side || tampered.views.front;
  const firstPose = view[Object.keys(view)[0]];
  firstPose.hip = [firstPose.hip[0] + 9, firstPose.hip[1] - 12];   // nudge the hip
  const before = VH.buildSignatures([ex]);
  const after = VH.buildSignatures([tampered]);
  const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
  assert.ok(changed.length > 0, "harness must flag an altered pose");
});

test("PR8: the committed baseline parses and is honestly labeled", () => {
  assert.ok(fs.existsSync(VH.BASELINE), "baseline file missing — run --update");
  const b = VH.readBaseline();
  assert.ok(b && b._meta && b.signatures, "baseline shape");
  assert.strictEqual(typeof b._meta.approved, "boolean");
  assert.ok(Object.keys(b.signatures).length > 200, "expected full-library coverage");
  // The agent generates candidates; only a human flips this via --approve.
  assert.ok(b._meta.note.includes("human") || b._meta.approved === true);
});

test("PR8: full-library comparison honors the approval policy", () => {
  const current = VH.buildSignatures(VH.loadContent());
  const baseline = VH.readBaseline();
  const r = VH.compare(current, baseline);
  if (baseline._meta.approved) {
    // A human signed these off: any drift is a real regression.
    assert.deepStrictEqual({ drift: r.drift, missing: r.missing }, { drift: [], missing: [] },
      `visual drift after approval: ${r.drift.slice(0, 5).join(", ")}`);
  } else {
    // Unapproved candidates: report, never fail — approval is the human's call.
    if (r.drift.length || r.missing.length) {
      console.warn(`visual-harness: ${r.drift.length} drifted / ${r.missing.length} missing vs UNAPPROVED candidates (informational)`);
    }
    assert.ok(r.matched + r.drift.length + r.missing.length === Object.keys(baseline.signatures).length);
  }
});

test("PR8: the SVG gallery emits real drawable images", () => {
  const sb = VH.makeSandbox();
  const [ex] = subset();
  const snaps = VH.snapshotExercise(sb, ex);
  const svg = VH.svgFromCommands(snaps[0].commands);
  assert.ok(svg.startsWith("<svg"), "svg root");
  assert.ok(svg.includes("<path") && svg.includes("Gradient"), "shaded body parts present");
  assert.ok(svg.includes("<circle") || svg.includes("<ellipse"), "head/shadow present");
});

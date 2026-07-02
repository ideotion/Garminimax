#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
/* Visual-regression harness for the 3-D canvas figure (mission PR8).

   Renders every movement's key poses headlessly through the REAL renderer
   (web/js/formModel3d.js) with a recording 2-D context, then:

     signatures  the ordered draw-command stream per snapshot, quantized to
                 0.1 px and hashed — the regression GATE. Deterministic pure
                 math (no rasterizer, no antialiasing variance), so a diff
                 means the projected geometry, depth order, or styling really
                 changed. Baselines live in tests/visual-baselines/ and start
                 "approved": false.
     gallery     the same command streams re-emitted as SVG files + an HTML
                 index — the HUMAN-APPROVAL surface. A person eyeballs the
                 gallery, then (and only then) runs `--approve`.

   Honest scope note: the mission asked for headless raster images; this
   environment has no rasterizer available offline (no npm, no node-canvas),
   so the harness captures the renderer's draw commands instead — strictly
   more deterministic to diff, and the SVG gallery gives the human real
   images to judge. Pixel screenshots can be layered on later via a browser.

   Usage:
     node scripts/visual-harness.js               # compare current vs baseline
     node scripts/visual-harness.js --update      # write candidate baselines (approved:false)
     node scripts/visual-harness.js --gallery     # write artifacts/visual-gallery/
     node scripts/visual-harness.js --approve     # HUMAN ONLY: mark baselines approved
   The agent that generates candidates must never run --approve. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(ROOT, "tests", "visual-baselines", "signatures.json");
const GALLERY = path.join(ROOT, "artifacts", "visual-gallery");

// Fixed palette (the dark theme's resolved tokens) so output is deterministic.
const PALETTE = { "--text": "rgb(232,232,234)", "--surface": "rgb(26,26,32)", "--bg": "rgb(16,16,20)" };
const CANVAS_W = 280, CANVAS_H = 330;

// ------------------------- recording 2-D context ----------------------------
function makeRecorder() {
  const commands = [];
  const q = (v) => (typeof v === "number" ? Math.round(v * 10) / 10 : v);
  let fillStyle = "#000", strokeStyle = "#000", lineWidth = 1;
  function gradient(kind, args) {
    return { __grad: kind, args: args.map(q), stops: [], addColorStop(off, color) { this.stops.push([q(off), color]); } };
  }
  const styleDesc = (s) => (s && s.__grad ? { g: s.__grad, a: s.args, s: s.stops } : s);
  const ctx = {
    setTransform() {}, save() { commands.push(["save"]); }, restore() { commands.push(["restore"]); },
    clearRect(...a) { commands.push(["clear", ...a.map(q)]); },
    beginPath() { commands.push(["begin"]); },
    closePath() { commands.push(["close"]); },
    moveTo(x, y) { commands.push(["M", q(x), q(y)]); },
    lineTo(x, y) { commands.push(["L", q(x), q(y)]); },
    arc(x, y, r) { commands.push(["A", q(x), q(y), q(r)]); },
    ellipse(x, y, rx, ry) { commands.push(["E", q(x), q(y), q(rx), q(ry)]); },
    fill() { commands.push(["fill", styleDesc(fillStyle)]); },
    stroke() { commands.push(["stroke", styleDesc(strokeStyle), q(lineWidth)]); },
    createLinearGradient(...a) { return gradient("lin", a); },
    createRadialGradient(...a) { return gradient("rad", a); },
    set fillStyle(v) { fillStyle = v; }, get fillStyle() { return fillStyle; },
    set strokeStyle(v) { strokeStyle = v; }, get strokeStyle() { return strokeStyle; },
    set lineWidth(v) { lineWidth = v; }, get lineWidth() { return lineWidth; },
    set lineCap(_) {}, set lineJoin(_) {},
  };
  return { ctx, commands };
}

// ------------------------------ DOM sandbox ---------------------------------
function makeSandbox() {
  const recorders = [];
  function makeEl(tag) {
    const el = {
      tag, style: {}, dataset: {}, _attrs: {}, _kids: [], className: "", value: "0",
      type: "", checked: false, disabled: false, isConnected: true, textContent: "",
      width: CANVAS_W, height: CANVAS_H, clientWidth: CANVAS_W,
      classList: { _s: new Set(), add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
      setAttribute(k, v) { this._attrs[k] = String(v); }, getAttribute(k) { return this._attrs[k] ?? null; },
      removeAttribute(k) { delete this._attrs[k]; },
      appendChild(c) { this._kids.push(c); return c; },
      append(...cs) { this._kids.push(...cs); },
      addEventListener() {}, removeEventListener() {},
      getContext() { if (!this._rec) { this._rec = makeRecorder(); recorders.push(this._rec); } return this._rec.ctx; },
      set innerHTML(v) { this._html = v; this._kids = []; }, get innerHTML() { return this._html || ""; },
    };
    Object.defineProperty(el, "onclick", { set(f) { el._click = f; }, get() { return el._click; } });
    return el;
  }
  let rafCb = null;
  const sandbox = {
    document: {
      createElement: (t) => makeEl(t), createElementNS: (_n, t) => makeEl(t),
      documentElement: { getAttribute: () => "dark" },
      createTextNode: (t) => ({ nodeType: 3, textContent: t }),
    },
    window: { matchMedia: () => ({ matches: false }), devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} },
    getComputedStyle: () => ({ getPropertyValue: (n) => PALETTE[n] || "" }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame: (cb) => { rafCb = cb; return 1; },
    cancelAnimationFrame: () => { rafCb = null; },
    performance: { now: () => 0 },
    console, Math, JSON, Object, Array, String, Number, Boolean, Date,
  };
  sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const src = ["web/js/pose3d.js", "web/js/formModel3d.js"]
    .map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n")
    + "\n;globalThis.__FM3D = FormModel3D;";
  vm.runInContext(src, sandbox, { filename: "harness-bundle.js" });
  return {
    FormModel3D: sandbox.__FM3D,
    makeEl,
    recorders,
    fireFrame(ts) { if (rafCb) { const cb = rafCb; rafCb = null; cb(ts); } },
    hasFrame() { return !!rafCb; },
  };
}

// -------------------------- snapshots per movement ---------------------------
// Key poses: the rest pose, then each phase at its midpoint and end. Timestamps
// walk the real phase clock, so easing and the (deterministic) life overlay are
// captured exactly as the app draws them.
function snapshotExercise(sb, ex) {
  const host = sb.makeEl("div");
  const before = sb.recorders.length;
  const inst = sb.FormModel3D.create(host, ex, {});
  const rec = sb.recorders[before]; // the canvas this instance drew to
  if (!rec) throw new Error(`${ex.id}: renderer created no canvas context`);
  const snaps = [];
  const take = (label) => { snaps.push({ label, commands: rec.commands.splice(0) }); };

  inst.reset();
  take("rest");

  inst.start();
  let ts = 16;                       // first frame stamps the phase start
  sb.fireFrame(ts); rec.commands.splice(0);
  for (const ph of ex.phases || []) {
    const dur = ph.dur || 1000;
    ts += dur / 2; sb.fireFrame(ts); take(`${ph.name}@0.5`);
    ts += dur / 2 + 1; sb.fireFrame(ts); take(`${ph.name}@1`);
    if (!sb.hasFrame()) break;       // finished (single-pass reps or set end)
  }
  inst.destroy();
  return snaps;
}

const hash = (obj) => crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 16);

function loadContent() {
  const H = JSON.parse(fs.readFileSync(path.join(ROOT, "web/content/home/exercises.json"), "utf8")).exercises;
  const T = JSON.parse(fs.readFileSync(path.join(ROOT, "web/content/taichi/movements.json"), "utf8")).movements;
  return H.concat(T);
}

// Build { "<exId>/<label>": sha } for the whole library (or a provided list).
function buildSignatures(movements) {
  const sb = makeSandbox();
  const out = {};
  for (const ex of movements) {
    for (const s of snapshotExercise(sb, ex)) out[`${ex.id}/${s.label}`] = hash(s.commands);
  }
  return out;
}

// ------------------------------- SVG gallery --------------------------------
function svgFromCommands(commands) {
  const defs = [];
  const body = [];
  let pathD = "", gradId = 0;
  const styleAttr = (desc) => {
    if (desc && desc.g) {
      const id = `g${++gradId}`;
      const stops = desc.s.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("");
      if (desc.g === "lin") {
        const [x1, y1, x2, y2] = desc.a;
        defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient>`);
      } else {
        const [, , , cx, cy, r] = desc.a;
        defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${r}">${stops}</radialGradient>`);
      }
      return `url(#${id})`;
    }
    return desc;
  };
  let pendingShape = null; // last arc/ellipse awaiting its fill
  for (const c of commands) {
    switch (c[0]) {
      case "begin": pathD = ""; pendingShape = null; break;
      case "M": pathD += `M${c[1]} ${c[2]}`; break;
      case "L": pathD += `L${c[1]} ${c[2]}`; break;
      case "close": pathD += "Z"; break;
      case "A": pendingShape = `<circle cx="${c[1]}" cy="${c[2]}" r="${c[3]}"`; break;
      case "E": pendingShape = `<ellipse cx="${c[1]}" cy="${c[2]}" rx="${c[3]}" ry="${c[4]}"`; break;
      case "fill": {
        const f = styleAttr(c[1]);
        if (pendingShape) { body.push(`${pendingShape} fill="${f}"/>`); pendingShape = null; }
        else if (pathD) body.push(`<path d="${pathD}" fill="${f}"/>`);
        break;
      }
      default: break;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" width="${CANVAS_W}" height="${CANVAS_H}">` +
    `<rect width="100%" height="100%" fill="${PALETTE["--bg"]}"/>` +
    (defs.length ? `<defs>${defs.join("")}</defs>` : "") + body.join("") + `</svg>`;
}

function writeGallery(movements) {
  fs.mkdirSync(GALLERY, { recursive: true });
  const sb = makeSandbox();
  const cards = [];
  for (const ex of movements) {
    for (const s of snapshotExercise(sb, ex)) {
      const name = `${ex.id}__${s.label.replace(/[^a-z0-9.@-]/gi, "_")}.svg`;
      fs.writeFileSync(path.join(GALLERY, name), svgFromCommands(s.commands));
      cards.push(`<figure><img src="${name}" width="200" loading="lazy"><figcaption>${ex.id}<br>${s.label}</figcaption></figure>`);
    }
  }
  fs.writeFileSync(path.join(GALLERY, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Form-model visual gallery</title>` +
    `<style>body{background:#101014;color:#e8e8ea;font:14px system-ui;margin:20px}` +
    `main{display:flex;flex-wrap:wrap;gap:10px}figure{margin:0;text-align:center;font-size:11px}</style>` +
    `<h1>Form-model visual gallery</h1><p>Human review surface for the visual-regression baselines. ` +
    `If these all look right, run <code>node scripts/visual-harness.js --approve</code>.</p><main>${cards.join("")}</main>`);
  return cards.length;
}

// --------------------------------- baselines ---------------------------------
function readBaseline() {
  try { return JSON.parse(fs.readFileSync(BASELINE, "utf8")); } catch (_) { return null; }
}

function compare(current, baseline) {
  const drift = [], missing = [], extra = [];
  const base = (baseline && baseline.signatures) || {};
  for (const k of Object.keys(base)) {
    if (!(k in current)) missing.push(k);
    else if (current[k] !== base[k]) drift.push(k);
  }
  for (const k of Object.keys(current)) if (!(k in base)) extra.push(k);
  return { drift, missing, extra, matched: Object.keys(base).length - drift.length - missing.length };
}

function main() {
  const arg = process.argv[2] || "";
  const movements = loadContent();

  if (arg === "--gallery") {
    const n = writeGallery(movements);
    console.log(`wrote ${n} SVG snapshots -> ${path.relative(ROOT, GALLERY)}/index.html`);
    return;
  }
  if (arg === "--approve") {
    // HUMAN-ONLY step: running this asserts a person reviewed the gallery.
    const b = readBaseline();
    if (!b) { console.error("no baseline to approve — run --update first"); process.exit(1); }
    b._meta.approved = true;
    b._meta.approved_at = new Date().toISOString();
    fs.writeFileSync(BASELINE, JSON.stringify(b, null, 2) + "\n");
    console.log("baselines marked APPROVED — signature drift now fails the suite");
    return;
  }
  if (arg === "--update") {
    const signatures = buildSignatures(movements);
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(BASELINE, JSON.stringify({
      _meta: {
        generator: "scripts/visual-harness.js v1",
        approved: false,
        note: "CANDIDATE baselines. A human must review the SVG gallery (node scripts/visual-harness.js --gallery, open artifacts/visual-gallery/index.html) and then run --approve. Until approved, drift is reported but not fatal.",
      },
      signatures,
    }, null, 2) + "\n");
    console.log(`wrote ${Object.keys(signatures).length} candidate signatures (approved: false)`);
    return;
  }

  const current = buildSignatures(movements);
  const baseline = readBaseline();
  if (!baseline) { console.log("no baseline committed — run --update"); return; }
  const r = compare(current, baseline);
  const status = baseline._meta && baseline._meta.approved ? "APPROVED" : "unapproved (candidates)";
  console.log(`baseline: ${status} · matched ${r.matched} · drift ${r.drift.length} · missing ${r.missing.length} · new ${r.extra.length}`);
  if (r.drift.length) console.log("drifted:", r.drift.slice(0, 10).join(", "), r.drift.length > 10 ? "…" : "");
  process.exit(baseline._meta && baseline._meta.approved && (r.drift.length || r.missing.length) ? 1 : 0);
}

if (require.main === module) main();

module.exports = { makeSandbox, snapshotExercise, buildSignatures, svgFromCommands, compare, loadContent, readBaseline, hash, BASELINE };

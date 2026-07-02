/* selfmocap/landmarkMap — pure mapping from MoveNet COCO-17 pose landmarks to
   the repo's 2-D front-view keyframe format (3-D realism mission PR10).

   This is the testable heart of the self-mocap authoring tool: an AUTHORING
   utility, never part of the shipped runtime (nothing under web/ imports it).
   Numbers in, numbers out — no model, no camera, no I/O — so the pipeline is
   unit-tested with synthetic landmark fixtures long before any model weights
   exist locally (weights are never committed; see the README for the human
   vendoring step).

   Landmark topology (appendix Sect. E.3, MoveNet KEYPOINT_DICT):
     0 nose | 1 leftEye | 2 rightEye | 3 leftEar | 4 rightEar |
     5 leftShoulder | 6 rightShoulder | 7 leftElbow | 8 rightElbow |
     9 leftWrist | 10 rightWrist | 11 leftHip | 12 rightHip |
     13 leftKnee | 14 rightKnee | 15 leftAnkle | 16 rightAnkle
   Known gap (Sect. E.4): MoveNet has no foot/heel landmark, so foot direction
   cannot be recovered — fine here, because the front-view keyframe format has
   no toe joints (the 3-D adapter rests feet at identity for front views).

   Output space: the shared 240x340 art canvas, ground y=318, hips centered on
   x=120 — the exact format web/content exercises author their `views.front` in. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LandmarkMap = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KP = {
    nose: 0, leftEye: 1, rightEye: 2, leftEar: 3, rightEar: 4,
    leftShoulder: 5, rightShoulder: 6, leftElbow: 7, rightElbow: 8,
    leftWrist: 9, rightWrist: 10, leftHip: 11, rightHip: 12,
    leftKnee: 13, rightKnee: 14, leftAnkle: 15, rightAnkle: 16,
  };
  const ART = { groundY: 318, centerX: 120, hipY: 178, ankleY: 312 };
  const DEFAULTS = { minScore: 0.3 };

  // Accept [x, y, score] arrays or {x, y, score} objects; null when unusable.
  function _kp(landmarks, idx, minScore) {
    const k = landmarks[idx];
    if (!k) return null;
    const x = Array.isArray(k) ? k[0] : k.x;
    const y = Array.isArray(k) ? k[1] : k.y;
    const s = Array.isArray(k) ? (k.length > 2 ? k[2] : 1) : (k.score != null ? k.score : 1);
    if (typeof x !== "number" || typeof y !== "number" || !isFinite(x) || !isFinite(y)) return null;
    return s >= minScore ? [x, y] : null;
  }
  const _mid = (a, b) => (a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : (a || b));

  /* Calibrate the image->art transform from ONE reference frame (a standing
     pose): the hip midpoint anchors at the canonical hip position and the
     hip->ankle span sets the scale. Compute it once per recording and pass it
     to every frame — re-deriving it per frame would re-anchor the hips each
     time and erase real vertical travel (a squat would read as "legs shrink"). */
  function computeTransform(landmarks, opts = {}) {
    const minScore = opts.minScore != null ? opts.minScore : DEFAULTS.minScore;
    const g = (name) => _kp(landmarks, KP[name], minScore);
    const hipMid = _mid(g("leftHip"), g("rightHip"));
    const ankMid = _mid(g("leftAnkle"), g("rightAnkle"));
    if (!hipMid || !ankMid) return null;
    const legSpan = Math.abs(ankMid[1] - hipMid[1]);
    if (legSpan < 1e-6) return null;
    return {
      scale: (ART.ankleY - ART.hipY) / legSpan,      // image px -> art units
      originX: hipMid[0], originY: hipMid[1],
      mirrored: !!opts.mirrored,
    };
  }

  /* Map one frame of COCO-17 landmarks (image coordinates, any scale) to a
     front-view art-space pose {head, sh, hip, lknee, rknee, lankle, rankle,
     lelb, relb, lhand, rhand}. Pass opts.transform (from computeTransform on a
     standing calibration frame) for multi-frame capture; without it the frame
     self-anchors (single-pose use). Joints below minScore are omitted (the
     engine tolerates sparse poses). Camera-mirroring: image "left*" landmarks
     are the SUBJECT'S left; the art space draws the subject facing the viewer,
     so subject-left maps to art l* joints unless mirrored (selfie view). */
  function landmarksToPose2D(landmarks, opts = {}) {
    const minScore = opts.minScore != null ? opts.minScore : DEFAULTS.minScore;
    const g = (name) => _kp(landmarks, KP[name], minScore);

    const tr = opts.transform || computeTransform(landmarks, opts);
    if (!tr) return null;                            // no anchor -> unusable frame
    const hipMid = _mid(g("leftHip"), g("rightHip"));
    const ankL = g("leftAnkle"), ankR = g("rightAnkle");
    if (!hipMid) return null;
    const scale = tr.scale, sx = tr.mirrored ? -scale : scale;

    const toArt = (p) => (p ? [
      Math.round((ART.centerX + (p[0] - tr.originX) * sx) * 10) / 10,
      Math.round((ART.hipY + (p[1] - tr.originY) * scale) * 10) / 10,
    ] : null);

    const head = _mid(g("nose"), _mid(g("leftEar"), g("rightEar"))) || g("nose");
    const out = {
      head: toArt(head),
      sh: toArt(_mid(g("leftShoulder"), g("rightShoulder"))),
      hip: toArt(hipMid),
      lknee: toArt(g("leftKnee")), rknee: toArt(g("rightKnee")),
      lankle: toArt(ankL), rankle: toArt(ankR),
      lelb: toArt(g("leftElbow")), relb: toArt(g("rightElbow")),
      lhand: toArt(g("leftWrist")), rhand: toArt(g("rightWrist")),
    };
    for (const k of Object.keys(out)) if (!out[k]) delete out[k];
    return out.hip && out.sh ? out : null;           // torso is the minimum viable pose
  }

  /* Reduce N captured frames [{tMs, pose}] to K keyframes, ready to hand-edit
     into an exercise. Deterministic: light per-joint smoothing (3-tap moving
     average over neighbouring frames), then keyframes picked at the endpoints
     plus the frames nearest to uniform time splits. Emits the repo's exercise
     skeleton: views.front poses named p1..pK and looping phases. */
  function framesToKeyframes(frames, opts = {}) {
    const K = Math.max(2, Math.min(opts.keyframes || 4, frames.length));
    const usable = frames.filter((f) => f && f.pose);
    if (usable.length < 2) return null;

    const smooth = usable.map((f, i) => {
      const prev = usable[Math.max(0, i - 1)].pose, next = usable[Math.min(usable.length - 1, i + 1)].pose;
      const p = {};
      for (const k of Object.keys(f.pose)) {
        const a = prev[k] || f.pose[k], b = next[k] || f.pose[k];
        p[k] = [
          Math.round(((a[0] + f.pose[k][0] + b[0]) / 3) * 10) / 10,
          Math.round(((a[1] + f.pose[k][1] + b[1]) / 3) * 10) / 10,
        ];
      }
      return { tMs: f.tMs, pose: p };
    });

    const t0 = smooth[0].tMs, t1 = smooth[smooth.length - 1].tMs;
    const picks = [];
    for (let i = 0; i < K; i++) {
      const target = t0 + ((t1 - t0) * i) / (K - 1);
      let best = 0, bd = Infinity;
      smooth.forEach((f, j) => { const d = Math.abs(f.tMs - target); if (d < bd) { bd = d; best = j; } });
      if (!picks.includes(best)) picks.push(best);
    }

    const views = { front: {} };
    const phases = [];
    picks.forEach((idx, i) => { views.front[`p${i + 1}`] = smooth[idx].pose; });
    const names = Object.keys(views.front);
    names.forEach((name, i) => {
      const prev = names[(i - 1 + names.length) % names.length];
      const dur = i === 0
        ? Math.max(400, Math.round(smooth[picks[picks.length - 1]].tMs - smooth[picks[names.length - 2] ? picks[names.length - 2] : 0].tMs))
        : Math.max(400, Math.round(smooth[picks[i]].tMs - smooth[picks[i - 1]].tMs));
      phases.push({ name: `Phase ${i + 1}`, dur, from: prev, to: name });
    });
    return { views, phases, _note: "self-mocap draft — review joints, name poses/phases, add cues before shipping" };
  }

  return { KP, ART, DEFAULTS, computeTransform, landmarksToPose2D, framesToKeyframes };
});

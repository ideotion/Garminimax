# Self-mocap authoring tool (scaffold) — mission PR10

A contributor-side, **offline** tool to draft exercise motion from webcam video:
capture frames → run a locally-vendored pose model → map landmarks to the
repo's keyframe format → clean up/retime → export a draft exercise JSON to
hand-edit. **Authoring only — the shipped runtime never loads any of this.**

## Status

| Piece | State |
|---|---|
| Landmark→keyframe mapping (`landmarkMap.js`) | ✅ implemented, unit-tested with synthetic COCO-17 fixtures (`tests/js/selfmocap.test.js`) |
| Cleanup/retime/export (`framesToKeyframes`) | ✅ implemented, tested |
| Capture page (`index.html`) | scaffold with documented seams — inert until a human vendors the model |
| Model weights | **never committed** (repo rule); manual vendoring below |

## Model choice — MoveNet, not BlazePose (appendix §E)

**MoveNet SinglePose Thunder** (or Lightning for low-end machines):
- library `@tensorflow/tfjs` + `@tensorflow-models/pose-detection`: **Apache-2.0** ✅
- model **weights: Apache-2.0, confirmed** (Google's Kaggle model card; corroborated by NVIDIA NGC) — redistributable, vendorable ✅
- explicit local-load path (`modelUrl` / `io.IOHandler`) — offline by design ✅
- known gaps, mitigated in `landmarkMap.js`: 17 COCO keypoints only — **no
  foot/heel landmark** (fine: the front-view keyframe format has no toe joints)
  and 2-D only (the repo's 2-D→3-D adapter lifts it like any authored view).

**BlazePose GHUM is rejected** for this repo: its `.task`/`.tflite` weight
binary carries **no confirmed allowlist license** (GHUM-derived; the Apache-2.0
grant covers the library, not the asset). Do not vendor it unless its asset
license text is independently verified.

## Human step — vendoring the model (do not automate)

1. Download MoveNet SinglePose Thunder (TF.js graph-model format) from the
   official source (Kaggle Models: `google/movenet`, variant
   `singlepose-thunder`, TF.js). Verify the card states **Apache-2.0**.
2. Place it under `tools/selfmocap/model/` (gitignored — weights are binaries
   and are never committed; this directory stays local).
3. Vendor `tf.min.js` + `pose-detection.min.js` (both Apache-2.0) beside it,
   and fill the two marked `<script>` seams in `index.html`.
4. Record: webcam capture samples landmarks per frame → `landmarksToPose2D`
   → collect `{tMs, pose}` frames → `framesToKeyframes` → download the draft
   JSON → hand-edit (name poses/phases, write cues, set reps/tempo) → validate
   with the content integrity tests → PR as normal content.

The mapping/cleanup logic is already fully tested, so the human step is
plumbing, not math.

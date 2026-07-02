# Fenix5Sync Web — offline, in-browser Garmin analyzer

A fully client-side port of Fenix5Sync's analytics: pick your `.FIT` files, and
your **fitness / fatigue / form** and **dynamic-coach state** are computed
**entirely in the browser**. Your data is never uploaded — the page is static and
the only network calls fetch two code libraries (swappable for local copies).

This is the **first cut** (broader vertical slice): ingest → decode → store →
PMC chart + coach "today" card + activity list. It's the second front-end on the
**same analytics as the desktop app**, kept honest by golden-vector parity tests.

## Why it's trustworthy: one source of truth

The analytics live in `engine/` as a dependency-free JS port of the Python
`core/` modules (`training_load.py`, `coach_state.py`). They can't silently drift:
`tools/gen_golden.py` dumps `(input → output)` fixtures from the **canonical
Python core**, and `test/engine.test.mjs` asserts the JS engine reproduces them.

```
npm test          # runs node --test → 14 parity checks against golden.json
```

Regenerate the fixtures whenever the Python core changes (from a Fenix5Sync checkout):

```
python tools/gen_golden.py > test/golden.json
```

## What's verified vs pending

- **Verified here (Node):** the whole analytics engine — TSS/TRIMP/duration load
  scoring, the CTL/ATL/TSB EWMAs, `as_of` decay, ramp rate, ACWR (+ zone), Foster
  monotony/strain, days-since-hard, resting-HR readiness. Byte-for-byte-equivalent
  to the Python core (within last-decimal rounding).
- **Needs a real-browser smoke test (can't run headless here):** the FIT decode
  (`fit-file-parser`), the File System Access folder picker, IndexedDB persistence,
  and the Chart.js rendering. These are standard integrations wired to the verified
  engine; open `app/index.html` over `http(s)` and load a folder of `.FIT` files.

## Run locally

```
# any static server (module scripts need http, not file://)
python -m http.server -d app 8080   # then open http://localhost:8080
```

Plug your watch in via **USB mass-storage mode** and pick its `GARMIN/Activity`
folder (Chromium desktop), or use "Pick files…" / drag-and-drop (every browser).

## Layout

```
engine/      pure analytics (JS port of core/) — the verified heart
  pmc.mjs         CTL/ATL/TSB Performance Management Chart
  coachState.mjs  dynamic-coach sensor state
app/         browser shell (ingest, store, UI) around the engine
  index.html  fit.mjs  store.mjs  main.mjs
test/        engine.test.mjs + golden.json (from the Python core)
tools/       gen_golden.py (regenerate fixtures)
```

## Deploy (per the feasibility report)

Host this as a **first-party static site** (its own origin) and **launch it from
Strikingly with a link** — not an embedded iframe. Inside a cross-origin iframe the
File System Access pickers are blocked and OPFS is partitioned; a first-party page
keeps full capability and isolates your data from the host's page scripts.

1. Push this repo; enable **GitHub Pages** (Settings → Pages → deploy `app/` or the
   built site). It serves over HTTPS with correct MIME types.
2. In **Strikingly**, add an HTML section with a launch link:
   ```html
   <a href="https://USER.github.io/REPO/" target="_blank" rel="noopener noreferrer">Open the Analyzer</a>
   ```

### Air-gapped build (optional)
Vendor the two runtime libraries so nothing is fetched at load: download
`chart.js` and `fit-file-parser` into `app/vendor/`, point `index.html`'s
`<script src>` and `FIT_URL` in `fit.mjs` at them.

## Roadmap (next slices)

- Swap IndexedDB → `@sqlite.org/sqlite-wasm` (`opfs-sahpool` VFS) — same store API,
  no COOP/COEP needed (works on GitHub Pages).
- Port the remaining analytics (`zones`, `metrics`, `splits`, `best_efforts`,
  `race`, `hr_trends`) behind the same golden-vector guard.
- Port the coach **plan** (`coach_plan.py` → schedule + `.ics`).
- PWA manifest + service worker (offline + Safari persistence).

## License

GPL-3.0-or-later, matching Fenix5Sync. `fit-file-parser` is MIT; Chart.js is MIT.

# Garminimax

**Local-first, offline archive for your Garmin Fenix 5.** Plug the watch into a
Debian/Ubuntu machine over USB and Garminimax extracts your activities, stores
them losslessly on disk, and shows them in a clean local web GUI — with charts
and an offline GPS track plot. No Garmin account, no Garmin software, **no
network access at runtime**, no telemetry. The watch is treated as **strictly
read-only**: nothing is ever written to the device.

The goal is durable, long-term data capture you fully own. Raw `.FIT` files are
kept as the canonical source, parsed into a queryable SQLite database, and can be
exported as CSV, JSON, GPX, TCX, the original raw file, or a full-fidelity NDJSON
archive for later analysis — optionally anonymized for safe sharing.

> **Tested hardware.** Garminimax has only been tested with a **Garmin Fenix 5**
> smartwatch. The import pipeline is format-based (`.FIT` / `.TCX` / `.GPX`) and
> should in principle work with other Garmin devices and platforms, but those
> paths are **unverified** — expect rough edges, and please report what you find.

Repository: <https://github.com/ideotion/Garminimax>

---

## Highlights

- **Read-only & offline.** The device is never modified; the server binds to
  `127.0.0.1` only and makes zero network calls. Every frontend asset
  (including Chart.js) is vendored — the GUI works with the network unplugged.
- **Lossless capture.** Raw `.FIT` files are stored alongside an indexed SQLite
  DB. Every FIT field is preserved with its units, so re-parsing and future
  analysis are always possible.
- **More than FIT.** Imports `.FIT`, `.TCX` and `.GPX` from a folder, a single
  file or a `.zip` — so exports from other watches/platforms (Coros, Suunto,
  Wahoo, Polar, Strava, Komoot, …) should land in the same local archive too.
  (Format-based and unverified — see the *Tested hardware* note above; only the
  Fenix 5 has actually been tested.)
- **Export anywhere, privately.** Re-share to **Garmin Connect** (TCX / original
  FIT) or any app (universal GPX) — with **opt-in anonymization** that scrubs GPS
  near home/finish, strips device & personal data, and can shift dates. It's a
  non-destructive transform on the exported copy; your archive stays intact.
- **Deduplicated** by SHA-256 of file *contents* (not filename), with an import
  ledger — re-running a sync only imports what's new.
- **Resilient.** One corrupt or truncated file is logged and skipped; it never
  aborts the batch. DB writes are atomic per activity.
- **Three clean layers:** a reusable Python `core` library, a FastAPI server, and
  a vanilla-JS GUI — plus a thin CLI. The core works independently of the API/CLI.

---

## Install

Target OS is **Debian/Ubuntu** (apt-based). The installer is idempotent and safe
to re-run.

### 1. One-line install (bootstrap)

```sh
curl -fsSL https://raw.githubusercontent.com/ideotion/Garminimax/main/install.sh | bash
```

This clones the repo to `~/.local/share/garminimax`, installs system and Python
dependencies, writes a default config, creates a launcher, and opens the GUI.

### 2. Inspect-before-run (recommended)

Piping a script straight into a shell means trusting it sight-unseen. To read it
first:

```sh
curl -fsSL https://raw.githubusercontent.com/ideotion/Garminimax/main/install.sh -o install.sh
less install.sh        # review it
bash install.sh
```

### 3. Manual install (clone, then run)

```sh
git clone https://github.com/ideotion/Garminimax.git
cd Garminimax
./install.sh
```

When run from inside a checkout, `install.sh` detects the real `origin` URL from
git and installs that working copy in place (it won't re-clone).

### What the installer does

1. Ensures `git` is present.
2. `apt-get install`s (with `sudo`) only the missing system packages:
   `python3`, `python3-venv`, `python3-pip`, `jmtpfs` (MTP watches), `gpsbabel`
   (GPX export).
3. Creates a Python virtualenv (`.venv`) and installs the package + dependencies.
4. Writes a default config to `~/.config/garminimax/config.yaml` if none exists.
5. Generates a launcher (`~/.local/bin/garminimax`), an XDG `.desktop` entry, and
   a `systemd --user` unit for optional auto-start.
6. Starts the server on `127.0.0.1` and opens your browser.

Environment overrides: `GMX_PORT`, `GMX_DIR`, `GMX_REPO_URL`, `GMX_BRANCH`,
`GMX_NO_LAUNCH=1` (skip auto-launch).

> **Note on the install URL/branch:** the one-liner points at the `main` branch.
> If you're installing from a feature branch, pass `GMX_BRANCH=<branch>` or use
> the manual clone path.

---

## Usage

### Web GUI

After install the GUI is at **<http://127.0.0.1:8765/>**. Views:

- **Dashboard** — activity list with date / sport / distance / duration filters,
  sortable columns and summary tiles.
- **Insights** — local-only accomplishments, monthly/cumulative trends, personal
  records and an activity calendar.
- **Recap** — a private *Year in Sport* (per-year and all-time), exportable as a
  self-contained, shareable HTML card that anyone can open with no account.
- **Segments** — capture a route from one of your activities and race yourself
  over your whole history: a private leaderboard and progress trend, no cloud.
- **Privacy** — a defensive self-audit of what your own tracks reveal (likely
  home, routine), with a recommended privacy radius that feeds anonymization.
- **Sports at Home** — guided, evidence-based training with the furniture and
  objects you already own (built for fragile/deconditioned users, scalable for
  the fit): a PAR-Q+-style readiness check, a pseudo-3-D tempo-paced offline
  form-model engine, a 35-exercise library, a balanced session builder + offline
  player, and a sit-to-stand capacity check, all on a sourced evidence base.
- **Coach** — turn an objective (5K/10K/half/marathon, dates or weeks, optional
  goal time, days, level) into a dated base→build→peak→taper→race plan with
  evidence-graded pace/heart-rate/effort target ranges, exportable as an `.ics`
  calendar. Training information, not medical advice.
- **Tai Chi** — 21 simplified movement/breathing pacers and a length-adjustable
  flow builder, rendered by the shared form-model engine (a gentle pacer, not
  instructed form).
- **Activity detail** — summary stats, heart-rate / speed / elevation charts, an
  offline GPS track plot, **HR & power training zones**, laps, and per-activity
  CSV/JSON/GPX/TCX/raw export.
- **Import / Sync** — one button to acquire & parse from the watch, with live
  progress and a run summary (found / imported / skipped / failed). Also imports
  a full **Garmin/Strava account export** (the downloaded `.zip` or folder) so
  your whole cloud history lands locally — nested zips and gzipped files are
  handled and everything is content-deduplicated.
- **Export** — bulk CSV/JSON and the full-fidelity NDJSON archive.
- **Logs** — the latest run log.

API docs (development) are at `/docs`.

### Relaunch later

Any of:

```sh
garminimax serve --open                 # if ~/.local/bin is on your PATH
~/.local/share/garminimax/.venv/bin/garminimax serve --open
systemctl --user enable --now garminimax.service   # auto-start on login
```

…or launch **Garminimax** from your desktop application menu.

### CLI (dev / headless)

```sh
garminimax sync                  # import new activities from the watch
garminimax list --sport running  # search the local store
garminimax show 12               # one activity's summary + laps
garminimax export 12 --format tcx      # per-activity (csv|json|gpx|tcx|raw)
garminimax export 12 -f gpx --anonymize # scrub location & sensitive data
garminimax export --bulk --format csv
garminimax salvage broken.fit --import # recover a corrupt/truncated FIT file
garminimax archive               # full-fidelity NDJSON archive of everything
garminimax plan -g 10k --target-date 2026-09-30 --time 50:00 --ics plan.ics  # objective -> dated plan + calendar
garminimax serve --open          # run the GUI/API
garminimax init-config           # write a default config file
```

Pass `--config /path/to/config.yaml` (or set `GARMINIMAX_CONFIG`) to any command.

### Using the core library directly

The core has no web/CLI dependencies:

```python
from core import load_config, import_activities, Store, ActivityFilter

cfg = load_config()                      # YAML or built-in defaults
summary = import_activities(cfg)         # acquire -> dedupe -> parse -> store
with Store(cfg.storage.db_path) as store:
    runs = store.search(ActivityFilter(sport="running", min_distance=5000))
```

---

## Configuration

A single YAML file drives everything (default:
`~/.config/garminimax/config.yaml`; see [`config.example.yaml`](config.example.yaml)
for the fully-documented template). Key sections:

| Section   | What it controls                                                        |
|-----------|-------------------------------------------------------------------------|
| `source`  | acquisition `mode` (`auto`/`mass_storage`/`mtp`/`path`/`folder`/`file`/`zip`), source path, formats, recursion |
| `storage` | data dir, raw `.FIT` subdir, SQLite DB path                             |
| `export`  | output dir, path to the `gpsbabel` binary                               |
| `dedupe`  | enable/disable content-hash dedupe                                      |
| `anonymize` | opt-in export scrubbing: GPS privacy radius/fuzz/drop, device & personal stripping, date shifting |
| `athlete` | optional thresholds for training zones: `max_heart_rate`, `resting_heart_rate`, `ftp_w` |
| `server`  | host (**loopback only — enforced**), port, browser auto-open            |
| `logging` | log dir, level                                                          |

**Device connection.** The Fenix 5 connects either as USB **mass storage** (it
appears as a drive — Garminimax scans the usual mountpoints for `GARMIN/Activity`)
or via **MTP** (mounted on demand with `jmtpfs`). `mode: auto` tries mass storage
then MTP. If auto-detection misses your setup, set `source.mode: path` and point
`source.path` at the activity folder (or use `gio mount` and point at the gvfs
path). Unlock the watch and allow file access when prompted.

**Importing other formats & sources.** Garminimax imports `.FIT`, `.TCX` and
`.GPX`, detected by content (not just extension). Beyond a connected watch, point
it at files you already have:

```sh
# a folder of mixed exports (optionally recursive)
garminimax --config <(echo 'source: {mode: folder, path: ~/exports, recursive: true}') sync
```

Or set in `config.yaml`:

```yaml
source:
  mode: folder        # folder | file | zip | path | auto | mass_storage | mtp
  path: "~/exports"   # a directory, a single file, or a .zip
  recursive: true     # descend into subdirectories
  formats: []         # restrict to e.g. ["gpx"]; empty = all (fit, tcx, gpx)
```

TCX/GPX are mapped onto the same canonical model as FIT; values those formats
omit (GPX has no distance/speed/ascent) are derived from the track. `.zip`
archives are extracted to a temp dir with path-traversal protection. Everything
is still content-deduplicated and stored losslessly under their original format.

You can also edit config from the API (`GET`/`PUT /api/config`); a non-loopback
`server.host` is rejected to keep the app local-only.

---

## Long-term archival & data formats

Capturing the data durably is the point; analysis comes later. Garminimax keeps
your data in three complementary forms:

1. **Raw `.FIT`** — the canonical, lossless source of truth, content-addressed in
   `<data_dir>/raw/`. Re-parsing is always possible; nothing is thrown away.
2. **SQLite** — a single self-contained, indexed, queryable database
   (`activities`, `laps`, `trackpoints`, `import_ledger`). SQLite is a stable,
   well-documented archival format with excellent long-term tooling.
3. **NDJSON archive** — `garminimax archive` (or Export → *Long-term archive*)
   writes one complete activity per line, with the full time series, laps and
   every FIT field (units included). It's portable, append/stream-friendly, and
   loads directly into pandas / DuckDB / `jq` — and converts cleanly to columnar
   formats like Parquet when you move on to data mining.

All exports run locally; nothing leaves your machine.

---

## Data model (for later analysis)

- `activities` — session summary (sport, start time, distance, durations, HR,
  speed, cadence, power, ascent/descent, start lat/long, device, …) plus an
  `extra` JSON blob preserving all remaining FIT fields with units; indexed on
  date, sport, distance and duration.
- `laps` — per-lap summaries, foreign-keyed to the activity.
- `trackpoints` — the record-level time series (timestamp, lat/long, HR, cadence,
  speed, altitude, distance, temperature, power), foreign-keyed and ordered.

---

## Development

```sh
git clone https://github.com/ideotion/Garminimax.git
cd Garminimax
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[test,dev]"
pytest                 # core (parse->store->export, dedupe, search) + API tests
ruff check .                                       # lint
bandit -ll -c pyproject.toml -r core server cli    # security (medium+)
pip-audit                                           # dependency vulnerabilities
garminimax serve --open
```

CI runs the same lint, security and test checks. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the contribution workflow and
[`SECURITY.md`](SECURITY.md) for vulnerability reporting.

The test suite generates a small valid `.FIT` fixture with a stdlib-only encoder
(`tests/fixtures/make_fit.py`) and exercises the full pipeline end-to-end.

### Layout

```
core/     pure-Python library: acquire, dedupe, parse, store, search, export, pipeline
server/   FastAPI app (JSON API + static frontend), loopback-only
web/       vanilla-JS GUI, vendored Chart.js, no build step
cli/       typer CLI (sync/list/show/export/archive/serve)
tests/     pytest suite + sample .FIT fixture
install.sh Debian bootstrap installer
```

### Dependencies

Python: `fastapi`, `uvicorn`, `fitparse`, `pyyaml`, `typer`, `defusedxml`
(hardened XML parsing for imported GPX/TCX) — plus `pytest`, `httpx` for tests and
`ruff`, `bandit`, `pip-audit` in the `dev` extra. System (optional but
recommended): `jmtpfs` (MTP), `gpsbabel` (GPX — there is also a built-in GPX
writer fallback). Frontend: Chart.js is vendored in `web/vendor/` (MIT); no other
JS dependencies, no CDN.

### Releases

Releases are automated and version-file driven — `main` is never renamed, and
each release is a tag. **The only manual step is bumping the version**, in a
normal PR:

1. Edit `version` in [`pyproject.toml`](pyproject.toml) (semver, e.g. `0.2.0`).
   It's the single source of truth — `core.__version__` reads it from the
   installed package metadata, so there's nothing else to change.
2. Open a PR and merge it to `main`.

On merge, [`.github/workflows/release.yml`](.github/workflows/release.yml) runs
the test suite and — if that version has no Release yet — tags the commit
`v<version>` and publishes a GitHub Release with auto-generated notes. Merges
that don't change the version are a no-op.

---

## Exporting & sharing

Per-activity export offers the right format for wherever it's going:

| Format | Best for |
|--------|----------|
| **GPX** | Universal — Strava, Komoot, most apps and tools |
| **TCX** | Garmin Connect (native upload) and Strava |
| **Original** (`raw`) | Byte-for-byte source file — the most faithful, Garmin-native re-upload |
| **CSV / JSON** | Spreadsheets, scripts, analysis |

**Anonymization (opt-in, non-destructive).** Tick *Anonymize* in the GUI, pass
`--anonymize` on the CLI, or add `?anonymize=true` to an export request — or set
`anonymize.enabled: true` to always scrub exports. It transforms only the
exported **copy**; the stored archive is never modified. Configurable scrubbing
(see [`config.example.yaml`](config.example.yaml)):

- **Location** — drop all GPS, and/or null positions within a *privacy radius* of
  the start **and** end (hide home/finish), and/or jitter remaining points.
- **Device identity** — make/model and serial / unit / ANT ids.
- **Personal profile** — age, weight, height, gender, …
- **Dates** — rebase timestamps to hide *when* you exercised (durations preserved).

(The `raw` original-file export can't be anonymized, by definition — use GPX/TCX/JSON/CSV.)

---

## Privacy & safety

- The watch filesystem is **read-only**; Garminimax only copies files off it.
- The server binds to `127.0.0.1` and makes **no network calls** at runtime.
- No Garmin account, no cloud, no telemetry. Your data stays on your machine.
- Sharing a file? **Anonymize** it on export to scrub location and personal data
  without touching your lossless local copy (see *Exporting & sharing*).

---

## License

GPL-3.0-or-later. See [`LICENSE`](LICENSE).

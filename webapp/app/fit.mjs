// Decode .FIT files in-browser and normalize to the engine's activity shape.
// Uses fit-file-parser (MIT). Loaded from a CORS CDN by default; drop the library
// into ./vendor/ and change FIT_URL for a fully offline/air-gapped build.
const FIT_URL = "https://cdn.jsdelivr.net/npm/fit-file-parser@3/+esm";

let _FitParser = null;
async function getParser() {
  if (!_FitParser) {
    const mod = await import(/* @vite-ignore */ FIT_URL);
    _FitParser = mod.default || mod.FitParser || mod;
  }
  return _FitParser;
}

const utcDate = (d) => new Date(d).toISOString().slice(0, 10);

async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sessionsToActivities(data, id) {
  const sessions = (data && data.sessions) || [];
  const rows = sessions.length ? sessions : (data && data.activity ? [data.activity] : []);
  const out = [];
  rows.forEach((s, i) => {
    const start = s.start_time || s.timestamp;
    const dur = s.total_timer_time || s.total_elapsed_time;
    if (!start || !dur) return;
    out.push({
      id: sessions.length > 1 ? `${id}:${i}` : id,
      date: utcDate(start),
      start_time: new Date(start).toISOString(),
      sport: String(s.sport || "generic").toLowerCase(),
      duration_s: Number(dur),
      avg_heart_rate: s.avg_heart_rate != null ? Math.round(s.avg_heart_rate) : null,
      avg_power: s.avg_power != null ? Math.round(s.avg_power) : null,
    });
  });
  return out;
}

// Decode one file (ArrayBuffer) -> normalized activities. Content-addressed by
// SHA-256 so re-importing the same file is a no-op (mirrors the desktop store).
export async function decodeFit(arrayBuffer) {
  const FitParser = await getParser();
  const id = await sha256Hex(arrayBuffer);
  const parser = new FitParser({ force: true, mode: "list", speedUnit: "km/h", lengthUnit: "m" });
  const data = await new Promise((resolve, reject) =>
    parser.parse(arrayBuffer, (err, d) => (err ? reject(err) : resolve(d))));
  return sessionsToActivities(data, id);
}

// Decode many files, tolerant of individual bad files (logged, skipped — never
// aborts the batch, matching the desktop pipeline's guarantee).
export async function decodeFiles(files, onProgress) {
  const activities = [];
  const errors = [];
  let done = 0;
  for (const file of files) {
    try {
      const buf = await file.arrayBuffer();
      activities.push(...(await decodeFit(buf)));
    } catch (e) {
      errors.push({ name: file.name, error: String(e && e.message || e) });
    }
    if (onProgress) onProgress(++done, files.length);
  }
  return { activities, errors };
}

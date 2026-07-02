// App wiring: pick .FIT files -> decode -> store -> analytics (the verified
// engine, identical to the Python core) -> canvas chart + coach "today" card.
// Everything runs in this tab; no data leaves the browser.
import { decodeFiles } from "./fit.mjs";
import { getAll, putMany, requestPersistence } from "./store.mjs";
import { computeTrainingLoad } from "../engine/pmc.mjs";
import { computeCoachState } from "../engine/coachState.mjs";

const $ = (id) => document.getElementById(id);
const todayUTC = () => new Date().toISOString().slice(0, 10);

// ---- athlete thresholds (persisted locally) ----
const ATH_KEY = "f5s-athlete";
function loadAthlete() {
  let a = {}; try { a = JSON.parse(localStorage.getItem(ATH_KEY)) || {}; } catch (_) {}
  $("maxhr").value = a.max_heart_rate || "";
  $("resthr").value = a.resting_heart_rate || "";
  $("ftp").value = a.ftp_w || "";
  return a;
}
function athlete() {
  const n = (v) => (v ? Number(v) : undefined);
  const a = { max_heart_rate: n($("maxhr").value), resting_heart_rate: n($("resthr").value), ftp_w: n($("ftp").value) };
  localStorage.setItem(ATH_KEY, JSON.stringify(a));
  return a;
}

// ---- ingest ----
async function* filesFromDir(handle) {
  for await (const entry of handle.values()) {
    if (entry.kind === "file" && entry.name.toLowerCase().endsWith(".fit")) yield await entry.getFile();
    else if (entry.kind === "directory") yield* filesFromDir(entry);
  }
}

async function ingest(files) {
  const list = [...files].filter((f) => f.name.toLowerCase().endsWith(".fit"));
  if (!list.length) { setStatus("No .fit files found."); return; }
  setStatus(`Decoding ${list.length} file(s)…`);
  const { activities, errors } = await decodeFiles(list, (d, t) => setStatus(`Decoding ${d}/${t}…`));
  await putMany(activities);
  await requestPersistence();
  const msg = `Imported ${activities.length} activit${activities.length === 1 ? "y" : "ies"}` +
    (errors.length ? ` · ${errors.length} file(s) skipped (unreadable)` : "");
  setStatus(msg);
  await refresh();
}
const setStatus = (t) => { $("ingestStatus").textContent = t; };

// ---- analytics + render ----
let chart = null;
async function refresh() {
  const acts = await getAll();
  if (!acts.length) return;
  const ath = athlete();
  const asOf = todayUTC();
  const runs = acts.filter((a) => /run/.test(a.sport));
  const state = computeCoachState(runs.length ? runs : acts, ath, { asOf });
  const tl = computeTrainingLoad(acts, ath, { asOf });
  renderState(state);
  renderPMC(tl.series.slice(-120));
  renderList(acts);
}

const NUM = (v, signed) => v == null ? "—" : (signed && v > 0 ? "+" : "") + v;
const ZONE = { undertraining: ["undertraining", "var(--accent)"], sweet_spot: ["sweet spot", "var(--good)"],
  caution: ["caution", "var(--warn)"], high_risk: ["high risk", "var(--bad)"] };

function renderState(s) {
  $("stateCard").hidden = false;
  const stat = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  $("stateGrid").innerHTML =
    stat("Form (TSB)", NUM(s.tsb, true)) + stat("Fitness (CTL)", NUM(s.ctl)) +
    stat("Fatigue (ATL)", NUM(s.atl)) + stat("Ramp /wk", NUM(s.ramp_rate, true)) +
    stat("ACWR", s.acwr == null ? "—" : s.acwr) + stat("Days since hard", NUM(s.days_since_hard));

  const badges = [];
  const z = ZONE[s.acwr_zone];
  if (z) badges.push(`<span class="badge" style="background:${z[1]}">load: ${z[0]}</span>`);
  const r = s.readiness;
  if (r && r.fresh != null) {
    badges.push(r.fresh
      ? `<span class="badge" style="background:var(--good)">recovered</span>`
      : `<span class="badge" style="background:var(--warn)">resting HR +${r.rhr_delta} bpm — favour recovery</span>`);
  } else {
    badges.push(`<span class="muted">Readiness: sync monitoring files to enable the recovery check.</span>`);
  }
  $("stateBadges").innerHTML = badges.join(" ");
  $("stateNotes").innerHTML = (s.notes || []).map((n) => `<li>${n}</li>`).join("");
}

function renderPMC(series) {
  $("pmcCard").hidden = false;
  const labels = series.map((d) => d.date);
  const ds = (label, key, color, fill) => ({
    label, data: series.map((d) => d[key]), borderColor: color,
    backgroundColor: color + "33", fill, tension: 0.25, pointRadius: 0, borderWidth: 2 });
  const cfg = {
    type: "line",
    data: { labels, datasets: [
      ds("Fitness (CTL)", "ctl", "#4b9fff", false),
      ds("Fatigue (ATL)", "atl", "#d6a432", false),
      ds("Form (TSB)", "tsb", "#3fb950", true)] },
    options: { responsive: true, interaction: { mode: "index", intersect: false },
      scales: { x: { ticks: { maxTicksLimit: 8, color: "#6b7d8f" }, grid: { display: false } },
        y: { ticks: { color: "#6b7d8f" }, grid: { color: "#2a333d" } } },
      plugins: { legend: { labels: { color: "#9fb0c0" } } } },
  };
  if (chart) chart.destroy();
  chart = new Chart($("pmc"), cfg);
}

function renderList(acts) {
  $("listCard").hidden = false;
  $("listCount").textContent = `(${acts.length})`;
  const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  const rows = acts.slice().reverse().slice(0, 500).map((a) =>
    `<tr><td>${a.date}</td><td>${a.sport}</td><td>${fmtDur(a.duration_s)}</td>` +
    `<td>${a.avg_heart_rate ?? "—"}</td><td>${a.avg_power ?? "—"}</td></tr>`).join("");
  $("listTable").querySelector("tbody").innerHTML = rows;
}

// ---- events ----
function wire() {
  loadAthlete();
  ["maxhr", "resthr", "ftp"].forEach((id) => $(id).addEventListener("change", refresh));

  $("pickFiles").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", (e) => ingest(e.target.files));

  const pickDir = $("pickDir");
  if (!window.showDirectoryPicker) { pickDir.hidden = true; }
  else pickDir.addEventListener("click", async () => {
    try {
      const handle = await window.showDirectoryPicker();
      const files = []; for await (const f of filesFromDir(handle)) files.push(f);
      await ingest(files);
    } catch (e) { if (e && e.name !== "AbortError") setStatus("Folder read failed: " + e.message); }
  });

  const drop = $("drop");
  ["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
  drop.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer.files.length) ingest(e.dataTransfer.files); });

  refresh(); // show anything already stored from a previous visit
}
wire();

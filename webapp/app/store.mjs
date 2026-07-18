// Minimal IndexedDB store for parsed activities. Content-addressed by id, so
// re-importing the same file overwrites (no duplicates). This is the browser's
// stand-in for the desktop SQLite store; everything stays on-device.
//
// (First cut: IndexedDB. The dedicated repo swaps in sqlite-wasm + OPFS
// opfs-sahpool per the feasibility report, keeping this same getAll/putMany API.)
const DB_NAME = "garminimax";
const STORE = "activities";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putMany(activities) {
  if (!activities.length) return 0;
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const os = tx.objectStore(STORE);
    activities.forEach((a) => os.put(a));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return activities.length;
}

export async function getAll() {
  const db = await open();
  const rows = await new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows;
}

export async function requestPersistence() {
  // Ask the browser to keep this data across storage pressure (helps Safari's
  // 7-day eviction). Best-effort; no-op where unsupported.
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); }
  catch (_) { /* ignore */ }
  return false;
}

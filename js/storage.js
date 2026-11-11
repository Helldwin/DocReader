// Sauvegarde automatique anti-crash dans IndexedDB (gros volume, survit au rechargement).
// Si IndexedDB est indisponible (navigation privée stricte…), on tente localStorage.
const DB = 'iris-app';
const STORE = 'kv';
const KEY = 'autosave';

function open() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => { db.close(); resolve(req?.result); };
        t.onerror = () => { db.close(); reject(t.error); };
    });
}

/** payload = { state, role, savedAt, exportedAt, pendingHost } */
export async function saveAutosave(payload) {
    const data = { ...payload, savedAt: Date.now() };
    try {
        await tx('readwrite', (s) => s.put(data, KEY));
    } catch {
        try { localStorage.setItem('iris.' + KEY, JSON.stringify(data)); } catch { /* quota */ }
    }
}

export async function loadAutosave() {
    try {
        const v = await tx('readonly', (s) => s.get(KEY));
        if (v) return v;
    } catch { /* ignore */ }
    try { return JSON.parse(localStorage.getItem('iris.' + KEY) || 'null'); } catch { return null; }
}

export async function clearAutosave() {
    try { await tx('readwrite', (s) => s.delete(KEY)); } catch { /* ignore */ }
    try { localStorage.removeItem('iris.' + KEY); } catch { /* ignore */ }
}

// Clé/valeur générique IndexedDB (ex : poignée du fichier .iris ouvert, non sérialisable en JSON).
export async function kvGet(key) { try { return await tx('readonly', (s) => s.get(key)); } catch { return undefined; } }
export async function kvSet(key, value) { try { await tx('readwrite', (s) => s.put(value, key)); } catch { /* ignore */ } }
export async function kvDel(key) { try { await tx('readwrite', (s) => s.delete(key)); } catch { /* ignore */ } }

// Petites préférences par navigateur (pseudo joueur, identifiant client…).
export const prefs = {
    get(k, def = null) { try { const v = localStorage.getItem('iris.pref.' + k); return v === null ? def : JSON.parse(v); } catch { return def; } },
    set(k, v) { try { localStorage.setItem('iris.pref.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

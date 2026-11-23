// Publication du portail joueurs depuis le .iris :
//   - un paquet chiffré par agent (code unique), cf. js/portal-data.js
//   - tous les documents distribués, chiffrés dans vault/docs/ (sauf les .enc déjà présents dans vault/)
//   - les cartes cochées « portail », brouillard appliqué, chiffrées dans vault/maps/
//   - data/journal.json (passages censurés chiffrés par personnage) et data/portal.json
// Les fichiers sont écrits directement dans le dossier du dépôt (Chrome / Edge) ou fournis en .zip.
import { loadImage } from './util.js';
import { publishJournal } from './journal.js';
import { fogDims, fogImage, isRevealed, revealedBounds } from './fog.js';
import { kvGet, kvSet } from './storage.js';
import { PORTAL_VERSION, normCode, agentFileId, agentPath, sealJson, sealBytes, kindOf } from './portal-data.js';

/** Dossiers entièrement gérés par la publication (les .enc obsolètes y sont supprimés). */
export const MANAGED_DIRS = ['vault/agents', 'vault/docs', 'vault/maps'];
export const isDossier = (doc) => /dossier/i.test(doc.category || '');
const isExternal = (src) => /^https?:\/\//i.test(src) && !src.startsWith(location.origin);

async function bytesOf(src) {
    const res = await fetch(src, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${src} introuvable (${res.status})`);
    const blob = await res.blob();
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || '' };
}

/** Carte publiée : le brouillard est « cuit » dans l'image (les zones inexplorées n'existent pas côté joueur). */
async function bakeFog(map, bytes, mime) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    try {
        const img = await loadImage(url);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const fog = await loadImage(fogImage(map, 1));
        const { cell, cols, rows } = fogDims(map);
        const sx = canvas.width / map.width, sy = canvas.height / map.height;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(fog, 0, 0, cols * cell * sx, rows * cell * sy);
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.9));
        return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/webp' };
    } finally { URL.revokeObjectURL(url); }
}

/** Documents visibles par un personnage (publics + accordés). */
export const docsOf = (state, c) => state.documents.filter((d) => d.public || c.docs.includes(d.id));

/** Vérifications avant publication (affichées dans Planifier › Portail joueurs). */
export function portalChecks(state) {
    const issues = [];
    const seen = new Map();
    for (const c of state.characters) {
        const code = normCode(c.portalCode);
        if (code.length < 8) issues.push(`${c.name} : code joueur trop court (8 caractères minimum).`);
        if (seen.has(code)) issues.push(`${c.name} et ${seen.get(code)} ont le même code joueur.`);
        seen.set(code, c.name);
    }
    for (const d of state.documents) {
        if (!state.characters.some((c) => docsOf(state, c).includes(d))) continue;
        if (/\.enc(\?|$)/i.test(d.src) && !d.code) issues.push(`Document « ${d.title} » : fichier .enc sans code de déchiffrement.`);
        if (!d.src && !d.text) issues.push(`Document « ${d.title} » : ni fichier ni texte.`);
    }
    return issues;
}

/**
 * Construit tous les fichiers du portail.
 * Retourne { files: Map<chemin, texte>, report: string[], warnings: string[] }.
 */
export async function buildPortal(state, onProgress = () => {}) {
    const blocking = portalChecks(state).filter((m) => /code joueur|même code/.test(m));
    if (blocking.length) throw new Error(blocking.join(' '));
    const files = new Map();
    const warnings = [];
    const now = Date.now();

    // ---- Documents : chaque fichier est chiffré UNE fois avec sa propre clé ; les paquets agents contiennent la clé.
    const docEntries = new Map();
    const used = state.documents.filter((d) => state.characters.some((c) => docsOf(state, c).includes(d)));
    let n = 0;
    for (const d of used) {
        onProgress(`Document ${++n}/${used.length} : ${d.title}`);
        const base = { id: d.id, title: d.title, category: d.category, desc: d.desc, dossier: isDossier(d) };
        const src = d.src || '';
        try {
            if (!src) { docEntries.set(d.id, { ...base, kind: 'text', text: d.text }); continue; }
            if (/\.enc(\?|$)/i.test(src) && !src.startsWith('data:')) {
                // Archive déjà chiffrée dans vault/ : on la référence telle quelle avec son code.
                if (!d.code) { warnings.push(`« ${d.title} » ignoré : code .enc manquant.`); continue; }
                docEntries.set(d.id, { ...base, kind: kindOf(src.replace(/\.enc.*$/i, '')), src, key: d.code, mime: kindOf(src.replace(/\.enc.*$/i, '')) === 'image' ? 'image/png' : 'application/pdf' });
                continue;
            }
            if (isExternal(src)) { docEntries.set(d.id, { ...base, kind: 'link', url: src }); continue; }
            const { bytes, mime } = await bytesOf(src);
            const path = `vault/docs/${d.id}.enc`;
            files.set(path, await sealBytes(bytes, d.vaultKey));
            const m = mime || (/\.pdf/i.test(src) ? 'application/pdf' : 'application/octet-stream');
            docEntries.set(d.id, { ...base, kind: kindOf(m), src: path, key: d.vaultKey, mime: m, ...(d.text ? { text: d.text } : {}) });
        } catch (e) {
            warnings.push(`« ${d.title} » non publié : ${e.message}`);
        }
    }

    // ---- Cartes cochées « portail »
    const maps = [];
    for (const m of state.maps.filter((x) => x.portal && x.image)) {
        onProgress(`Carte : ${m.name}`);
        try {
            let { bytes, mime } = await bytesOf(m.image);
            if (m.fog.enabled) ({ bytes, mime } = await bakeFog(m, bytes, mime || 'image/png'));
            const path = `vault/maps/${m.id}.enc`;
            files.set(path, await sealBytes(bytes, m.vaultKey));
            maps.push({
                id: m.id, name: m.name, src: path, key: m.vaultKey, mime: mime || 'image/png', width: m.width, height: m.height, view: revealedBounds(m),
                markers: m.markers.filter((k) => isRevealed(m, k.x, k.y)).map(({ name, x, y, desc, icon }) => ({ name, x, y, desc, icon })),
            });
        } catch (e) {
            warnings.push(`Carte « ${m.name} » non publiée : ${e.message}`);
        }
    }

    // ---- Bestiaire connu des agents
    const bestiary = state.bestiary.filter((b) => b.known).map((b) => ({ name: b.name, type: b.kind, danger: b.danger, description: b.desc, avatar: b.avatar }));

    // ---- Journal public (passages censurés chiffrés par personnage)
    onProgress('Journal…');
    const { entries, warnings: jw } = await publishJournal(state);
    warnings.push(...jw);
    files.set('data/journal.json', JSON.stringify(entries, null, 2));

    // ---- Paquets agents
    const salt = state.portal.salt;
    const report = [];
    for (const c of state.characters) {
        onProgress(`Joueur : ${c.name}`);
        const docs = docsOf(state, c).map((d) => docEntries.get(d.id)).filter(Boolean);
        const bundle = {
            v: PORTAL_VERSION,
            publishedAt: now,
            campaign: { title: state.meta.title, session: state.meta.sessionNumber, currency: state.rules.currency },
            agent: {
                id: c.id, name: c.name, player: c.player, avatar: c.avatar, color: c.color, status: c.status,
                hp: c.hp, hpMax: c.hpMax, money: c.money, bio: c.bio, fields: c.fields,
                stats: state.rules.stats.map((s) => ({ label: s.label, value: c.stats[s.key] ?? 0 })),
                inventory: c.inventory.map(({ name, qty, desc }) => ({ name, qty, desc })),
            },
            docs, maps, bestiary,
            keys: { [c.id]: c.secret }, // déclassification de SES passages du journal
        };
        const id = await agentFileId(c.portalCode, salt);
        files.set(agentPath(id), await sealJson(bundle, normCode(c.portalCode)));
        report.push(`${c.name} : ${docs.length} doc(s)`);
    }
    files.set('data/portal.json', JSON.stringify({ version: PORTAL_VERSION, title: state.meta.title, salt, publishedAt: now }, null, 2));
    return { files, report, warnings, counts: { agents: state.characters.length, docs: docEntries.size, maps: maps.length, bestiary: bestiary.length } };
}

// ---------------------------------------------------------------- Écriture dans le dépôt (Chrome / Edge)
export const dirSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** Dossier du dépôt mémorisé (poignée File System Access) ; `ask` = proposer d'en choisir un. */
export async function repoDir({ ask = false, change = false } = {}) {
    let h = change ? null : await kvGet('repoDir');
    if (h) {
        if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return h;
        if (ask && (await h.requestPermission({ mode: 'readwrite' })) === 'granted') return h;
        if (!ask) return h; // connu mais permission à redemander au moment de publier
    }
    if (!ask) return null;
    h = await window.showDirectoryPicker({ id: 'iris-repo', mode: 'readwrite' });
    await kvSet('repoDir', h);
    return h;
}

export async function looksLikeRepo(dir) {
    try { await dir.getFileHandle('session.html'); return true; } catch { return false; }
}

async function subdir(root, path, create = true) {
    let d = root;
    for (const part of path.split('/').filter(Boolean)) d = await d.getDirectoryHandle(part, { create });
    return d;
}

/** Écrit les fichiers puis supprime les .enc obsolètes des dossiers gérés (codes changés, documents retirés). */
export async function writeToRepo(dir, files, onProgress = () => {}) {
    let i = 0;
    for (const [path, content] of files) {
        onProgress(`Écriture ${++i}/${files.size} : ${path}`);
        const parts = path.split('/');
        const name = parts.pop();
        const d = await subdir(dir, parts.join('/'));
        const w = await (await d.getFileHandle(name, { create: true })).createWritable();
        await w.write(content);
        await w.close();
    }
    let removed = 0;
    for (const p of MANAGED_DIRS) {
        let d;
        try { d = await subdir(dir, p, false); } catch { continue; }
        const stale = [];
        for await (const [name, h] of d.entries()) if (h.kind === 'file' && name.endsWith('.enc') && !files.has(`${p}/${name}`)) stale.push(name);
        for (const name of stale) { await d.removeEntry(name); removed++; }
    }
    return { written: files.size, removed };
}

// ---------------------------------------------------------------- Archive .zip (sans compression, sans dépendance)
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
})();
function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

export function makeZip(files) {
    const te = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const [path, content] of files) {
        const name = te.encode(path);
        const data = typeof content === 'string' ? te.encode(content) : content;
        const crc = crc32(data);
        const h = new DataView(new ArrayBuffer(30));
        h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
        h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true);
        h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
        parts.push(h, name, data);
        const c = new DataView(new ArrayBuffer(46));
        c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
        c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
        c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
        central.push(c, name);
        offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.size, true); end.setUint16(10, files.size, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

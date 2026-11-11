// Enregistrement direct dans le fichier .iris ouvert (File System Access API — Chrome / Edge).
// Ailleurs (Firefox, Safari) : repli automatique sur le téléchargement d'une copie.
import { kvGet, kvSet, kvDel } from './storage.js';

const TYPES = [{ description: 'Campagne I.R.I.S.', accept: { 'application/json': ['.iris'] } }];
const KEY = 'fileHandle';

export const fsSupported = typeof window !== 'undefined' && 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;
let handle = null;

export async function restoreHandle() {
    if (!fsSupported) return null;
    handle = (await kvGet(KEY)) || null;
    return handle;
}

export const handleName = () => handle?.name || null;

export async function forgetHandle() {
    handle = null;
    await kvDel(KEY);
}

/** Ouvre un .iris via le sélecteur natif et mémorise le fichier. Retourne un File, ou null si annulé. */
export async function openWithPicker() {
    try {
        const [h] = await window.showOpenFilePicker({ types: TYPES, multiple: false });
        handle = h;
        await kvSet(KEY, h);
        return await h.getFile();
    } catch (e) {
        if (e.name === 'AbortError') return null;
        throw e;
    }
}

async function permitted(h, ask) {
    const opts = { mode: 'readwrite' };
    if ((await h.queryPermission(opts)) === 'granted') return true;
    if (!ask) return false;
    return (await h.requestPermission(opts)) === 'granted';
}

/** Permission d'écriture déjà accordée (pour la sauvegarde silencieuse) ? */
export async function canWriteSilently() {
    return !!handle && (await permitted(handle, false).catch(() => false));
}

/**
 * Écrit le texte dans le fichier mémorisé.
 * ask=true : peut ouvrir "Enregistrer sous" / demander la permission (doit suivre un clic).
 * Retourne true si écrit, false si impossible (l'appelant bascule sur le téléchargement).
 * Lève AbortError si l'utilisateur annule la boîte de dialogue.
 */
export async function writeIris(text, { ask = true, suggestedName = 'campagne.iris' } = {}) {
    if (!fsSupported) return false;
    if (!handle) {
        if (!ask) return false;
        handle = await window.showSaveFilePicker({ suggestedName, types: TYPES });
        await kvSet(KEY, handle);
    }
    if (!(await permitted(handle, ask))) return false;
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
    return true;
}

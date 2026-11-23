// Annuler / rétablir (Ctrl+Z / Ctrl+Y) pour Planifier et la vue MJ.
// Instantanés de l'état pris après chaque série de modifications (regroupées sur ~0,7 s : un coup de
// pinceau ou une saisie = une seule étape). Les très longues chaînes (images, PDF importés) sont mises
// de côté une seule fois et partagées entre instantanés : l'historique reste léger.
// Ne sont jamais annulés : la session en direct (connexions, attributions, demandes), les messages
// privés, l'ambiance en cours et le codex importé.
import { store } from './store.js';
import { debounce, toast } from './util.js';
import { withMapAccessor } from './iris-file.js';

const MAX = 40;
const BIG = 20000;
const big = new Map();      // chaîne → jeton
const bigBack = new Map();  // jeton → chaîne
let undoStack = [];
let redoStack = [];
let current = null;          // instantané de l'état courant
let restoring = false;

function snap(state) {
    const { lore, session, chats, ...rest } = state;
    return JSON.stringify(rest, (k, v) => {
        if (k === 'updatedAt') return undefined; // horodatage : pas une modification en soi
        if (typeof v === 'string' && v.length > BIG) {
            let t = big.get(v);
            if (!t) { t = `\u0000big:${big.size}`; big.set(v, t); bigBack.set(t, v); }
            return t;
        }
        return v;
    });
}

function unsnap(text) {
    return JSON.parse(text, (k, v) => (typeof v === 'string' && v.startsWith('\u0000big:') ? bigBack.get(v) ?? '' : v));
}

const record = debounce(() => {
    if (!store.state || restoring) return;
    const next = snap(store.state);
    if (next === current) return;
    if (current) { undoStack.push(current); if (undoStack.length > MAX) undoStack.shift(); }
    redoStack = [];
    current = next;
}, 700);

/** À appeler quand une campagne est chargée : repart d'un historique vide. */
export function resetHistory() {
    undoStack = [];
    redoStack = [];
    current = store.state ? snap(store.state) : null;
}

store.on((evt) => {
    if (evt.type === 'load') { if (!restoring) resetHistory(); return; }
    if (evt.net || evt.saved || evt.history) return;
    record();
});

function apply(text) {
    const s = store.state;
    const data = unsnap(text);
    restoring = true;
    try {
        const live = { music: s.ambience.music, sfx: s.ambience.sfx };
        for (const k of Object.keys(data)) s[k] = data[k];
        Object.assign(s.ambience, live);
        withMapAccessor(s);
        if (!s.maps.some((m) => m.id === s.activeMapId)) s.activeMapId = s.maps[0]?.id;
        store.commit('structure', { history: true });
    } finally { restoring = false; }
}

export function undo() {
    record.flush?.();
    if (!undoStack.length) { toast('Rien à annuler.', 'info', 1500); return false; }
    redoStack.push(current);
    current = undoStack.pop();
    apply(current);
    toast('Annulé.', 'info', 1200);
    return true;
}

export function redo() {
    if (!redoStack.length) { toast('Rien à rétablir.', 'info', 1500); return false; }
    undoStack.push(current);
    current = redoStack.pop();
    apply(current);
    toast('Rétabli.', 'info', 1200);
    return true;
}

export const canUndo = () => undoStack.length > 0;

const editable = (el) => el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

// Raccourcis : seulement hors champ de saisie (sinon on laisse l'annulation native du texte).
document.addEventListener('keydown', (e) => {
    if (!store.state || !['planner', 'gm'].includes(store.meta.role)) return;
    if (!(e.ctrlKey || e.metaKey) || editable(document.activeElement)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
});

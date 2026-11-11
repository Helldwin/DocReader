// État central côté MJ + sauvegarde automatique anti-crash.
// Toute modification passe par store.commit() → autosave (IndexedDB) + notification des vues
// + diffusion aux joueurs connectés.
import { CONFIG } from './config.js';
import { debounce } from './util.js';
import { saveAutosave } from './storage.js';

let state = null;
const meta = { role: null, exportedAt: 0, pendingHost: false };
const subs = new Set();

const persist = debounce(() => {
    if (state) saveAutosave({ state, role: meta.role, exportedAt: meta.exportedAt, pendingHost: meta.pendingHost });
}, CONFIG.AUTOSAVE_DEBOUNCE_MS);

function emit(evt) {
    for (const fn of subs) {
        try { fn(evt); } catch (e) { console.error('[IRIS store]', e); }
    }
}

export const store = {
    get state() { return state; },
    meta,

    load(s, role, extra = {}) {
        state = s;
        meta.role = role;
        meta.exportedAt = extra.exportedAt ?? 0;
        meta.pendingHost = !!extra.pendingHost;
        persist.flush();
        emit({ type: 'load' });
    },

    /**
     * type 'update'    : valeur modifiée depuis un champ (les formulaires ne sont pas redessinés)
     * type 'structure' : ajout / suppression / changement externe → les vues se redessinent
     */
    commit(type = 'structure', detail = {}) {
        if (!state) return;
        state.meta.updatedAt = Date.now();
        persist();
        emit({ type, ...detail });
    },

    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    clearSubscribers() { subs.clear(); },

    markExported() { meta.exportedAt = Date.now(); persist.flush(); },
    get dirty() { return !!state && state.meta.updatedAt > meta.exportedAt + 50; },
    flush() { persist.flush(); },
    unload() { state = null; meta.role = null; }, // les vues se désabonnent elles-mêmes
};

window.addEventListener('beforeunload', (e) => {
    store.flush();
    if (store.dirty && meta.role) { e.preventDefault(); e.returnValue = ''; }
});

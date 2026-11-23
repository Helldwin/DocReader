// Mécanique d'interface commune :
//  - data-act="nom"            → clic routé vers une action enregistrée (registerActions)
//  - form data-submit="nom"    → soumission routée vers une action
//  - data-bind="scope|chemin"  → champ lié directement à l'état (store), sans code par champ
//      scopes : state, meta, gm, rules, dice, map[:<mapId>], char:<id>, item:<charId>:<itemId>,
//               field:<charId>:<index>, doc:<id>, stat:<index>, marker:<mapId>:<index>, journal:<id>,
//               token:<mapId>:<charId>, npc:<id>, fog[:<mapId>], bank:<id>, scene:<id>, shop…, track…,
//               combo:<entrée de combat>, mapnote:<mapId>:<noteId>, table:<id>, timer
//      data-kind : int | float | tags | list  (sinon texte / case à cocher)
import { store } from './store.js';
import { toast, setPath, toInt } from './util.js';
import { findChar, findDoc, findMap, findNpc, findBank, findScene } from './iris-file.js';

const actions = {};
export function registerActions(obj) { Object.assign(actions, obj); }
/** Exécute une action enregistrée depuis le code (ex. : ouverture d'un résultat de recherche). */
export function runAction(name, el = { dataset: {} }) { return actions[name]?.(el); }

export function resolveScope(scope) {
    const s = store.state;
    if (!s) return null;
    const [kind, a, b] = scope.split(':');
    switch (kind) {
        case 'meta': return s.meta;
        case 'gm': return s.gm;
        case 'rules': return s.rules;
        case 'dice': return s.rules.dice;
        case 'state': return s;
        case 'map': return a ? findMap(s, a) : s.map;
        case 'char': return findChar(s, a);
        case 'item': return findChar(s, a)?.inventory.find((i) => i.id === b);
        case 'field': return findChar(s, a)?.fields[toInt(b, -1)];
        case 'doc': return findDoc(s, a);
        case 'stat': return s.rules.stats[toInt(a, -1)];
        case 'marker': return b === undefined ? s.map.markers[toInt(a, -1)] : findMap(s, a)?.markers[toInt(b, -1)];
        case 'journal': return s.journal.find((j) => j.id === a);
        case 'token': return b === undefined ? s.map.tokens[a] : findMap(s, a)?.tokens[b];
        case 'npc': return findNpc(s, a);
        case 'fog': return a ? findMap(s, a)?.fog : s.map.fog;
        case 'bank': return findBank(s, a);
        case 'scene': return findScene(s, a);
        case 'combo': return s.combat.order.find((o) => o.id === a);
        case 'mapnote': return findMap(s, a)?.notes.find((n) => n.id === b);
        case 'table': return s.tables.find((t) => t.id === a);
        case 'timer': return s.session.timer;
        case 'assign': return s.session.assignments;
        case 'shop': return s.shops.find((x) => x.id === a);
        case 'shopitem': return s.shops.find((x) => x.id === a)?.items.find((i) => i.id === b);
        case 'track': return s.ambience.tracks.find((t) => t.id === a);
        default: return null;
    }
}

function readValue(el) {
    const kind = el.dataset.kind;
    if (el.type === 'checkbox') return el.checked;
    const v = el.value;
    if (kind === 'float' || el.type === 'range') return Number(v) || 0;
    if (kind === 'int' || el.type === 'number') return kind === 'float' ? Number(v) || 0 : toInt(v, 0);
    if (kind === 'tags') return v.split(',').map((t) => t.trim()).filter(Boolean);
    if (kind === 'list') return v.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
    return v;
}

function onBind(e) {
    const el = e.target;
    if (!el.dataset?.bind) return;
    const liveEvent = el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'color' ? 'change' : 'input';
    if (e.type !== liveEvent) return;
    const [scope, path] = el.dataset.bind.split('|');
    const target = resolveScope(scope);
    if (!target) return;
    setPath(target, path, readValue(el));
    store.commit(el.dataset.structure ? 'structure' : 'update', { scope, path });
}

let installed = false;
export function installDelegation() {
    if (installed) return;
    installed = true;
    document.addEventListener('click', async (e) => {
        const el = e.target.closest('[data-act]');
        if (!el) return;
        const fn = actions[el.dataset.act];
        if (!fn) return;
        if (el.tagName === 'BUTTON' || el.tagName === 'A') e.preventDefault();
        try { await fn(el, e); } catch (err) { console.warn(err); toast(err.message || String(err), 'error'); }
    });
    document.addEventListener('submit', async (e) => {
        const f = e.target.closest('form[data-submit]');
        if (!f) return;
        e.preventDefault();
        const fn = actions[f.dataset.submit];
        try { await fn?.(f, e); } catch (err) { console.warn(err); toast(err.message || String(err), 'error'); }
    });
    document.addEventListener('input', onBind);
    document.addEventListener('change', onBind);
}

/** Remplace le HTML d'un conteneur en conservant le focus / la sélection du champ actif. */
export function rerender(el, html) {
    if (!el) return;
    const active = document.activeElement;
    let key = null, start = null, end = null;
    if (active && el.contains(active)) {
        key = active.dataset?.bind ? `[data-bind="${CSS.escape(active.dataset.bind)}"]` : active.id ? `#${CSS.escape(active.id)}` : null;
        try { start = active.selectionStart; end = active.selectionEnd; } catch { /* non texte */ }
    }
    // Les champs de formulaire non liés (montant à créditer, objet à ajouter…) gardent leur saisie.
    const fieldKey = (f) => `${f.form?.dataset.submit || ''}|${f.form?.dataset.id || ''}|${f.name}`;
    const activeField = !key && active && el.contains(active) && active.name && active.form ? fieldKey(active) : null;
    const typed = new Map();
    el.querySelectorAll('form [name]').forEach((f) => {
        if (f.type !== 'checkbox' && f.type !== 'submit' && f.tagName !== 'BUTTON' && f.value) typed.set(fieldKey(f), f.value);
    });
    const scroll = el.scrollTop;
    el.innerHTML = html;
    el.scrollTop = scroll;
    if (typed.size) el.querySelectorAll('form [name]').forEach((f) => { const v = typed.get(fieldKey(f)); if (v !== undefined && f.tagName !== 'BUTTON') f.value = v; });
    if (activeField) [...el.querySelectorAll('form [name]')].find((f) => fieldKey(f) === activeField)?.focus();
    if (key) {
        const n = el.querySelector(key);
        if (n) { n.focus(); try { if (start !== null) n.setSelectionRange(start, end); } catch { /* ignore */ } }
    }
}

/** Petite barre d'onglets : retourne le HTML. */
export function tabsHtml(tabs, current, act) {
    return `<nav class="tabs">${tabs.map((t) => `<button class="tab ${t.id === current ? 'active' : ''}" data-act="${act}" data-tab="${t.id}">
        <i class="fa-solid ${t.icon}"></i><span>${t.label}</span>${t.badge ? `<b class="badge">${t.badge}</b>` : ''}</button>`).join('')}</nav>`;
}

export const formData = (form) => Object.fromEntries(new FormData(form).entries());

// Règles du jeu appliquées à l'état (fonctions pures, testables, utilisées par le MJ
// et pour valider les demandes des joueurs). Toute erreur métier lève une Error lisible.
import { CONFIG } from './config.js';
import { uid } from './util.js';
import { findChar, findDoc, findShop, findTrack } from './iris-file.js';
import { resolveRoll } from './dice.js';
import { isRevealed } from './fog.js';

const posInt = (v) => {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n <= 0) throw new Error('Montant / quantité invalide.');
    return n;
};

function mustChar(state, id) {
    const c = findChar(state, id);
    if (!c) throw new Error('Personnage introuvable.');
    return c;
}

export function addLedger(state, entry) {
    state.ledger.push({ id: uid('l'), ts: Date.now(), ...entry });
    if (state.ledger.length > CONFIG.MAX_LEDGER) state.ledger.splice(0, state.ledger.length - CONFIG.MAX_LEDGER);
}

/** Crédit (amount > 0) ou débit (amount < 0) par le MJ. Le solde peut devenir négatif (dette). */
export function adjustMoney(state, charId, amount, text = '') {
    const c = mustChar(state, charId);
    const a = Math.trunc(Number(amount));
    if (!a) throw new Error('Montant invalide.');
    c.money += a;
    addLedger(state, { kind: a > 0 ? 'credit' : 'debit', charId, amount: Math.abs(a), text: text || (a > 0 ? 'Crédit MJ' : 'Débit MJ'), balance: c.money });
}

export function transferMoney(state, fromId, toId, amount, text = '') {
    if (fromId === toId) throw new Error('Destinataire invalide.');
    const from = mustChar(state, fromId);
    const to = mustChar(state, toId);
    const a = posInt(amount);
    if (from.money < a) throw new Error('Fonds insuffisants.');
    from.money -= a;
    to.money += a;
    addLedger(state, { kind: 'transfer', charId: fromId, to: toId, amount: a, text: text || `Virement à ${to.name}` });
}

export function addItem(state, charId, { name, qty = 1, desc = '' }) {
    const c = mustChar(state, charId);
    const n = String(name || '').trim();
    if (!n) throw new Error('Nom d\'objet requis.');
    const q = posInt(qty);
    const same = c.inventory.find((i) => i.name.toLowerCase() === n.toLowerCase() && (i.desc || '') === (desc || ''));
    if (same) same.qty += q;
    else c.inventory.push({ id: uid('i'), name: n, qty: q, desc });
    return c;
}

export function transferItem(state, fromId, toId, itemId, qty = 1) {
    if (fromId === toId) throw new Error('Destinataire invalide.');
    const from = mustChar(state, fromId);
    const to = mustChar(state, toId);
    const item = from.inventory.find((i) => i.id === itemId);
    if (!item) throw new Error('Objet introuvable.');
    const q = posInt(qty);
    if (item.qty < q) throw new Error('Quantité insuffisante.');
    item.qty -= q;
    if (item.qty === 0) from.inventory = from.inventory.filter((i) => i !== item);
    addItem(state, to.id, { name: item.name, qty: q, desc: item.desc });
    addLedger(state, { kind: 'item', charId: fromId, to: toId, amount: q, text: `${item.name} ×${q} → ${to.name}` });
}

/** Achat dans une boutique ouverte : débit automatique, objet ajouté, stock décrémenté. */
export function buyItem(state, charId, shopId, itemId, qty = 1) {
    const c = mustChar(state, charId);
    const shop = findShop(state, shopId);
    if (!shop || !shop.open) throw new Error('Cette boutique est fermée.');
    const art = shop.items.find((i) => i.id === itemId);
    if (!art) throw new Error('Article introuvable.');
    const q = posInt(qty);
    if (art.stock >= 0 && art.stock < q) throw new Error(`Stock insuffisant (${art.stock} restant).`);
    const total = art.price * q;
    if (c.money < total) throw new Error('Fonds insuffisants.');
    c.money -= total;
    if (art.stock >= 0) art.stock -= q;
    addItem(state, c.id, { name: art.name, qty: q, desc: art.desc });
    addLedger(state, { kind: 'purchase', charId: c.id, amount: total, text: `${art.name} ×${q} — ${shop.name}`, balance: c.money });
    return { item: art, total };
}

/** Événement marquant (document montré, ambiance…) pour le brouillon de rapport. */
export function logEvent(state, text) {
    state.log.push({ id: uid('e'), ts: Date.now(), text });
    if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
}

/**
 * Jet de dé lancé par le MJ.
 * p : { charId?, statKey?, mod, difficulty?, isPublic, label? }
 */
export function makeRoll(state, p, forcedRoll = null) {
    const dice = state.rules.dice;
    const c = p.charId ? findChar(state, p.charId) : null;
    const stat = p.statKey ? state.rules.stats.find((s) => s.key === p.statKey) : null;
    const statValue = c && stat ? Number(c.stats[stat.key] ?? 0) : null;
    const res = resolveRoll(dice, { statValue, mod: p.mod, difficulty: p.difficulty, roll: forcedRoll });
    const roll = {
        id: uid('r'),
        ts: Date.now(),
        charId: c?.id || null,
        charName: c?.name || 'MJ',
        statKey: stat?.key || null,
        statLabel: stat?.label || null,
        statValue,
        mod: Number(p.mod) || 0,
        sides: dice.sides,
        mode: dice.mode,
        label: p.label || '',
        public: p.isPublic !== false,
        ...res,
    };
    state.rolls.push(roll);
    if (state.rolls.length > CONFIG.MAX_ROLLS) state.rolls.splice(0, state.rolls.length - CONFIG.MAX_ROLLS);
    return roll;
}

export function addChat(state, charId, from, text) {
    mustChar(state, charId);
    const t = String(text || '').trim().slice(0, 2000);
    if (!t) throw new Error('Message vide.');
    (state.chats[charId] ||= []).push({ id: uid('m'), ts: Date.now(), from, text: t });
    return t;
}

// ---------------- Vue filtrée envoyée à chaque joueur ----------------
// Règle d'or : un joueur ne reçoit QUE ce qu'il a le droit de voir.

/** Remplace les gros fichiers importés (data:) par une référence téléchargeable à la demande. */
const assetRef = (src, key) => (String(src || '').startsWith('data:') && src.length > 4096 ? `asset:${key}` : src);

export function publicChar(c, rules) {
    return { id: c.id, name: c.name, color: c.color, avatar: c.avatar, status: c.status, ...(rules.partyHpVisible ? { hp: c.hp, hpMax: c.hpMax } : {}) };
}

export function docMeta(d) {
    return { id: d.id, title: d.title, category: d.category, desc: d.desc, code: d.code, text: d.text, src: assetRef(d.src, 'doc:' + d.id) };
}

/** Un client peut-il télécharger ce fichier importé ? (clé "map", "doc:<id>", "audio:<id>") */
export function canGetAsset(state, charId, key) {
    if (key === 'map') return state.map.shared;
    if (key.startsWith('doc:')) return canSeeDoc(state, charId, key.slice(4));
    if (key.startsWith('audio:')) {
        const id = key.slice(6);
        return state.ambience.music?.trackId === id || state.ambience.sfx?.trackId === id;
    }
    return false;
}

export function assetData(state, key) {
    if (key === 'map') return state.map.image;
    if (key.startsWith('doc:')) return findDoc(state, key.slice(4))?.src;
    if (key.startsWith('audio:')) return findTrack(state, key.slice(6))?.src;
    return null;
}

function ambienceView(state) {
    const out = { music: null, sfx: null };
    for (const ch of ['music', 'sfx']) {
        const p = state.ambience[ch];
        const t = p && findTrack(state, p.trackId);
        if (t) out[ch] = { ts: p.ts, id: t.id, name: t.name, volume: t.volume, src: assetRef(t.src, 'audio:' + t.id) };
    }
    return out;
}

export function canSeeDoc(state, charId, docId) {
    const d = findDoc(state, docId);
    if (!d) return false;
    if (d.public || state.session.spotlight?.docId === docId) return true;
    const c = findChar(state, charId);
    return !!c && c.docs.includes(docId);
}

export function viewFor(state, clientId, online) {
    const charId = state.session.assignments[clientId] || null;
    const c = charId ? findChar(state, charId) : null;
    const rules = state.rules;
    const view = {
        t: 'view',
        campaign: { title: state.meta.title, session: state.meta.sessionNumber, currency: rules.currency, stats: rules.stats, dice: rules.dice },
        me: null,
        key: null,
        roster: state.characters.filter((x) => Object.values(state.session.assignments).includes(x.id))
            .map((x) => ({ ...publicChar(x, rules), online: online.has(x.id) })),
        rolls: state.rolls.filter((r) => r.public).slice(-25),
        map: null,
        docs: [],
        chat: [],
        ledger: [],
        shops: [],
        spotlight: null,
        ambience: ambienceView(state),
    };
    const m = state.map;
    if (m.shared && m.image) {
        const tokens = {};
        for (const [id, t] of Object.entries(m.tokens)) if (t.visible !== false) tokens[id] = { x: t.x, y: t.y };
        // Les PNJ cachés par le MJ ou sous le brouillard ne sont pas envoyés du tout.
        const npcs = m.npcs.filter((n) => n.visible !== false && isRevealed(m, n.x, n.y)).map((n) => ({ id: n.id, name: n.name, color: n.color, x: n.x, y: n.y }));
        view.map = {
            image: assetRef(m.image, 'map'), width: m.width, height: m.height, markers: m.markers, tokens, npcs,
            fog: m.fog.enabled ? { enabled: true, cell: m.fog.cell, revealed: m.fog.revealed } : null,
            chars: state.characters.filter((x) => tokens[x.id]).map((x) => ({ id: x.id, name: x.name, color: x.color, avatar: x.avatar })),
        };
    }
    const sp = state.session.spotlight;
    if (sp) { const d = findDoc(state, sp.docId); if (d) view.spotlight = { ts: sp.ts, doc: docMeta(d) }; }
    if (!c) return view;
    const { gmNotes, secret, ...mine } = c;
    view.me = mine;
    view.key = { [c.id]: secret };
    view.docs = state.documents.filter((d) => d.public || c.docs.includes(d.id)).map(docMeta);
    view.chat = (state.chats[c.id] || []).slice(-200);
    view.ledger = state.ledger.filter((l) => l.charId === c.id || l.to === c.id).slice(-40);
    view.shops = state.shops.filter((s) => s.open).map((s) => ({ id: s.id, name: s.name, desc: s.desc, items: s.items }));
    return view;
}

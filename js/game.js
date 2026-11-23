// Règles du jeu appliquées à l'état (fonctions pures, testables, utilisées par le MJ
// et pour valider les demandes des joueurs). Toute erreur métier lève une Error lisible.
import { CONFIG } from './config.js';
import { uid, isDead } from './util.js';
import { findChar, findDoc, findShop, findTrack, findMap, findBank, findScene, findNpc, findTable, normalizeNpc } from './iris-file.js';
import { resolveRoll, rollDie } from './dice.js';
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

/** Pose une fiche de la banque (PNJ / créature) sur une carte. */
export function spawnFromBank(state, mapId, bankId, { x, y, visible = true } = {}) {
    const m = findMap(state, mapId);
    const b = findBank(state, bankId);
    if (!m) throw new Error('Carte introuvable.');
    if (!b) throw new Error('Fiche PNJ introuvable.');
    const same = m.npcs.filter((n) => n.refId === b.id).length;
    const npc = normalizeNpc({
        name: same ? `${b.name} ${same + 1}` : b.name, color: b.color, avatar: b.avatar, refId: b.id,
        hp: b.hpMax || b.hp, hpMax: b.hpMax, visible,
        x: x ?? Math.round(m.width / 2) + same * 30, y: y ?? Math.round(m.height / 2),
    });
    m.npcs.push(npc);
    return npc;
}

/**
 * Lance une scène : carte affichée, musique, document à l'écran, documents distribués,
 * boutiques ouvertes, PNJ posés (masqués) sur la carte. `present` = ids des personnages en jeu.
 * Retourne la liste lisible de ce qui a été fait.
 */
export function launchScene(state, sceneId, present = []) {
    const sc = findScene(state, sceneId);
    if (!sc) throw new Error('Scène introuvable.');
    const done = [];
    const ts = Date.now();
    const map = sc.mapId && findMap(state, sc.mapId);
    if (map) {
        state.activeMapId = map.id;
        if (sc.shareMap) state.mapShared = true;
        done.push(`carte « ${map.name} »${sc.shareMap ? ' affichée' : ''}`);
    }
    const t = sc.trackId && findTrack(state, sc.trackId);
    if (t) { state.ambience[t.loop ? 'music' : 'sfx'] = { trackId: t.id, ts }; done.push(`ambiance « ${t.name} »`); }
    const target = map || state.map;
    let placed = 0;
    for (const id of sc.npcs) {
        if (!findBank(state, id) || target.npcs.some((n) => n.refId === id)) continue;
        spawnFromBank(state, target.id, id, { visible: false });
        placed++;
    }
    if (placed) done.push(`${placed} PNJ posé(s) masqué(s)`);
    for (const id of sc.shopIds) { const sh = findShop(state, id); if (sh && !sh.open) { sh.open = true; done.push(`boutique « ${sh.name} » ouverte`); } }
    let given = 0;
    for (const docId of sc.grantDocs) {
        if (!findDoc(state, docId)) continue;
        for (const cid of present) {
            const c = findChar(state, cid);
            if (c && !c.docs.includes(docId)) { c.docs.push(docId); given++; }
        }
    }
    if (given) done.push(`${given} document(s) distribué(s)`);
    const d = sc.docId && findDoc(state, sc.docId);
    if (d) { state.session.spotlight = { docId: d.id, ts }; done.push(`« ${d.title} » à l'écran`); }
    state.session.sceneId = sc.id;
    logEvent(state, `Scène : ${sc.title}${done.length ? ' (' + done.join(', ') + ')' : ''}`);
    return done;
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
    return { id: c.id, name: c.name, color: c.color, avatar: c.avatar, status: c.status, dead: isDead(c), ...(rules.partyHpVisible ? { hp: c.hp, hpMax: c.hpMax } : {}) };
}

export function docMeta(d) {
    return { id: d.id, title: d.title, category: d.category, desc: d.desc, code: d.code, text: d.text, src: assetRef(d.src, 'doc:' + d.id) };
}

/** Un client peut-il télécharger ce fichier importé ? (clé "map:<id>", "doc:<id>", "audio:<id>") */
export function canGetAsset(state, charId, key) {
    // Seule la carte actuellement montrée est téléchargeable (pas les cartes préparées par le MJ).
    if (key.startsWith('map:')) return state.mapShared && key.slice(4) === state.map.id;
    if (key.startsWith('doc:')) return canSeeDoc(state, charId, key.slice(4));
    if (key.startsWith('audio:')) {
        const id = key.slice(6);
        return state.ambience.music?.trackId === id || state.ambience.sfx?.trackId === id;
    }
    return false;
}

export function assetData(state, key) {
    if (key.startsWith('map:')) return findMap(state, key.slice(4))?.image;
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
        campaign: { title: state.meta.title, session: state.meta.sessionNumber, currency: rules.currency, stats: rules.stats, dice: rules.dice, playerRolls: rules.playerRolls },
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
        combat: combatView(state),
        timer: timerView(state.session.timer),
        pings: pingsView(state),
        myRequests: [],
    };
    const m = state.map;
    if (state.mapShared && m?.image) {
        const tokens = {};
        for (const [id, t] of Object.entries(m.tokens)) if (t.visible !== false) tokens[id] = { x: t.x, y: t.y };
        // Les PNJ cachés par le MJ ou sous le brouillard ne sont pas envoyés du tout (ni leurs PV).
        const npcs = m.npcs.filter((n) => n.visible !== false && isRevealed(m, n.x, n.y)).map((n) => ({ id: n.id, name: n.name, color: n.color, avatar: n.avatar, x: n.x, y: n.y }));
        view.map = {
            id: m.id, name: m.name,
            image: assetRef(m.image, 'map:' + m.id), width: m.width, height: m.height,
            markers: m.markers.filter((k) => isRevealed(m, k.x, k.y)).map(({ name, x, y, desc, icon }) => ({ name, x, y, desc, icon })), tokens, npcs, // lieux cachés par le brouillard : non envoyés
            fog: m.fog.enabled ? { enabled: true, cell: m.fog.cell, revealed: m.fog.revealed } : null,
            chars: state.characters.filter((x) => tokens[x.id]).map((x) => ({ id: x.id, name: x.name, color: x.color, avatar: x.avatar, dead: isDead(x) })),
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
    view.myRequests = (state.session.rollRequests || []).filter((r) => r.charId === c.id).map((r) => r.statKey || '');
    view.ledger = state.ledger.filter((l) => l.charId === c.id || l.to === c.id).slice(-40);
    view.shops = state.shops.filter((s) => s.open).map((s) => ({ id: s.id, name: s.name, desc: s.desc, items: s.items }));
    return view;
}


// ---------------- Minuteur / chrono ----------------
export const timerElapsed = (t, now = Date.now()) => t.acc + (t.running ? Math.max(0, now - t.anchor) : 0);
/** Valeur affichée (ms) : temps restant (compte à rebours) ou écoulé (chrono). */
export const timerValue = (t, now = Date.now()) => (t.mode === 'up' ? timerElapsed(t, now) : Math.max(0, t.duration - timerElapsed(t, now)));
export function timerView(t) {
    if (!t || !t.visible || (!t.running && !t.acc)) return null;
    return { label: t.label, mode: t.mode, running: t.running, value: timerValue(t) };
}
export function timerStart(t) { if (!t.running) { t.running = true; t.anchor = Date.now(); } }
export function timerPause(t) { if (t.running) { t.acc = timerElapsed(t); t.running = false; } }
export function timerReset(t) { t.running = false; t.acc = 0; t.anchor = 0; }
export const fmtClock = (ms) => {
    const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return `${h ? h + ':' : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(x).padStart(2, '0')}`;
};

// ---------------- Combat ----------------
/** Bonus d'initiative : la stat choisie dans les règles (÷10 en mode d100). */
function initBonus(state, entry) {
    const key = state.rules.initStat;
    if (!key || entry.kind !== 'char') return 0;
    const v = Number(findChar(state, entry.ref)?.stats[key]) || 0;
    return state.rules.dice.mode === 'under' ? Math.round(v / 10) : v;
}

export function rollInitiative(state, entry) {
    entry.init = rollDie(20) + initBonus(state, entry);
    return entry.init;
}

export const sortCombat = (combat) => combat.order.sort((a, b) => b.init - a.init || (a.kind === 'char' ? -1 : 1));

/** Démarre un combat avec les participants [{ ref, kind, name }] (initiative tirée pour chacun). */
export function startCombat(state, participants) {
    const order = participants.map((p) => ({ id: uid('co'), ref: p.ref, kind: p.kind, name: p.name, init: 0 }));
    order.forEach((o) => rollInitiative(state, o));
    state.combat = { active: true, round: 1, turn: 0, order };
    sortCombat(state.combat);
    logEvent(state, `Combat engagé : ${order.map((o) => `${o.name} (${o.init})`).join(', ')}`);
}

export function combatEntity(state, o) {
    return o.kind === 'npc' ? findNpc(state, o.ref) : findChar(state, o.ref);
}

export function nextTurn(state, dir = 1) {
    const c = state.combat;
    if (!c.active || !c.order.length) return;
    let t = c.turn + dir;
    if (t >= c.order.length) { t = 0; c.round++; }
    if (t < 0) { t = c.order.length - 1; c.round = Math.max(1, c.round - 1); }
    c.turn = t;
}

export function endCombat(state) {
    if (state.combat.active) logEvent(state, `Fin du combat (${state.combat.round} round${state.combat.round > 1 ? 's' : ''})`);
    state.combat = { active: false, round: 1, turn: 0, order: [] };
}

/** Ce que voient joueurs et spectateurs : les PNJ masqués ou sous le brouillard n'apparaissent pas. */
function combatView(state) {
    const c = state.combat;
    if (!c?.active) return null;
    const m = state.map;
    const order = [];
    c.order.forEach((o, i) => {
        const e = combatEntity(state, o);
        if (!e) return;
        if (o.kind === 'npc') {
            const onActive = m.npcs.includes(e);
            if (!onActive || e.visible === false || !isRevealed(m, e.x, e.y)) return;
        }
        order.push({ name: e.name || o.name, kind: o.kind, ref: o.kind === 'char' ? o.ref : '', current: i === c.turn, dead: o.kind === 'char' ? isDead(e) : (e.hpMax > 0 && e.hp <= 0) });
    });
    return { round: c.round, order };
}

// ---------------- PV de zone ----------------
/** Applique `delta` PV (négatif = dégâts) à plusieurs cibles [{ kind, ref }]. */
export function applyHpMany(state, targets, delta) {
    const d = Math.trunc(Number(delta));
    if (!d) throw new Error('Montant invalide.');
    const names = [];
    for (const t of targets) {
        const e = t.kind === 'npc' ? findNpc(state, t.ref) : findChar(state, t.ref);
        if (!e) continue;
        const max = e.hpMax > 0 ? e.hpMax : Infinity;
        e.hp = Math.min(max, (Number(e.hp) || 0) + d);
        names.push(e.name);
    }
    if (names.length) logEvent(state, `${d < 0 ? 'Dégâts' : 'Soins'} ${Math.abs(d)} PV : ${names.join(', ')}`);
    return names.length;
}

// ---------------- Jets de groupe ----------------
export function groupRoll(state, charIds, p) {
    const group = uid('g');
    const rolls = charIds.map((id) => {
        const r = makeRoll(state, { ...p, charId: id });
        r.group = group;
        return r;
    });
    return { group, rolls };
}

// ---------------- Tables aléatoires ----------------
export function tableEntries(table) {
    return String(table.entries || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const m = /^(\d+)\s*[x×]\s+(.+)$/i.exec(l);
        return m ? { weight: Math.max(1, Number(m[1])), text: m[2] } : { weight: 1, text: l };
    });
}

export function drawTable(state, tableId) {
    const t = findTable(state, tableId);
    if (!t) throw new Error('Table introuvable.');
    const entries = tableEntries(t);
    if (!entries.length) throw new Error('Table vide.');
    const total = entries.reduce((a, e) => a + e.weight, 0);
    const roll = rollDie(total);
    let acc = 0;
    const hit = entries.find((e) => (acc += e.weight) >= roll);
    const r = { id: uid('r'), ts: Date.now(), charId: null, charName: 'MJ', statKey: null, statLabel: null, statValue: null, mod: 0, sides: total, mode: state.rules.dice.mode,
        label: `${t.name} : ${hit.text}`, public: t.public, roll, target: null, total: roll, outcome: 'raw', table: t.id };
    state.rolls.push(r);
    if (state.rolls.length > CONFIG.MAX_ROLLS) state.rolls.splice(0, state.rolls.length - CONFIG.MAX_ROLLS);
    return { text: hit.text, roll: r };
}

// ---------------- Pings sur la carte ----------------
export function addPing(state, { x, y, by = 'MJ', color = '#ffd900', mapId = state.map.id }) {
    const now = Date.now();
    state.session.pings = (state.session.pings || []).filter((p) => now - p.ts < 6000).slice(-6);
    state.session.pings.push({ id: uid('pg'), mapId, x: Math.round(x), y: Math.round(y), by: String(by).slice(0, 40), color, ts: now });
}

function pingsView(state) {
    const now = Date.now();
    return (state.session.pings || []).filter((p) => p.mapId === state.map.id && now - p.ts < 6000 && state.mapShared).map(({ id, x, y, by, color, ts }) => ({ id, x, y, by, color, age: now - ts }));
}

// ---------------- Bilan de session ----------------
export function sessionSnapshot(state) {
    const chars = {};
    for (const c of state.characters) {
        const inv = {};
        for (const i of c.inventory) inv[i.name] = (inv[i.name] || 0) + i.qty;
        chars[c.id] = { name: c.name, hp: c.hp, hpMax: c.hpMax, money: c.money, inv, docs: [...c.docs], dead: isDead(c) };
    }
    const revealed = {};
    for (const m of state.maps) revealed[m.id] = m.markers.filter((k) => isRevealed(m, k.x, k.y)).map((k) => k.name);
    return { ts: Date.now(), chars, revealed };
}

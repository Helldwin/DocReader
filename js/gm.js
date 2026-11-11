// Vue MJ en direct : héberge la session, voit et modifie tout, lance les dés, gère la carte,
// les documents, l'économie et les conversations privées.
import { store } from './store.js';
import { registerActions, rerender, tabsHtml } from './ui.js';
import { esc, avatarHtml, hpBar, fmtTime, toast, beep, confirmBox, modal, toInt, muted, setMuted } from './util.js';
import { findChar, findDoc, docKind, newDocument, normalizeNpc } from './iris-file.js';
import { Host } from './net.js';
import { viewFor, makeRoll, addChat, transferItem, transferMoney, buyItem, canGetAsset, assetData, logEvent } from './game.js';
import { OUTCOME_LABEL, describeRoll } from './dice.js';
import { charEditorHtml, docEditorHtml, kindIcon, shopEditorHtml, ambienceHtml } from './editors.js';
import { LiveMap } from './map.js';
import { paintFog, fillFog } from './fog.js';
import { AmbiencePlayer } from './audio.js';
import { exportIris } from './planner.js';
import { draftReport } from './report.js';
import { clearAutosave } from './storage.js';

const TABS = [
    { id: 'sheet', label: 'Fiche', icon: 'fa-id-card' },
    { id: 'dice', label: 'Dés', icon: 'fa-dice-d20' },
    { id: 'map', label: 'Carte', icon: 'fa-map-location-dot' },
    { id: 'chat', label: 'Messages', icon: 'fa-comments' },
    { id: 'docs', label: 'Documents', icon: 'fa-folder-open' },
    { id: 'shops', label: 'Commerce', icon: 'fa-store' },
    { id: 'ambience', label: 'Ambiance', icon: 'fa-music' },
];

const STATUS = {
    connecting: ['Connexion au relais…', 'warn'],
    online: ['Session en ligne', 'ok'],
    reconnecting: ['Reconnexion…', 'warn'],
    'id-taken': ['Code encore occupé, nouvel essai…', 'warn'],
};

let rt = null; // état d'exécution (non sauvegardé)

export function mountGm(el, { onExit }) {
    const s = store.state;
    rt = {
        el, onExit, tab: 'sheet', charId: s.characters[0]?.id || null, chatId: null, status: 'connecting',
        unread: {}, lastSent: new Map(), map: null, docModal: null, brush: null, brushSize: 2,
        audio: new AmbiencePlayer(async (src) => (String(src).startsWith('asset:') ? assetData(store.state, src.slice(6)) : src)),
        dice: { charId: s.characters[0]?.id || '', mod: 0, difficulty: s.rules.dice.defaultDifficulty, label: '', isPublic: true, sides: s.rules.dice.sides },
    };
    el.innerHTML = `<div class="gm">
        <header class="topbar">
            <div class="brand"><svg class="sigil" viewBox="0 0 100 100"><polygon points="50,6 94,90 6,90"/><circle cx="50" cy="64" r="17"/><circle cx="50" cy="64" r="5" fill="currentColor"/></svg>
                <div><b>${esc(s.meta.title)}</b><small>Vue MJ — session n°${esc(s.meta.sessionNumber)}</small></div></div>
            <button class="code-box" data-act="gm.copyCode" title="Copier le lien d'invitation"><small>Code</small><b>${esc(s.session.code)}</b><i class="fa-regular fa-copy"></i></button>
            <span id="gm-status" class="pill"></span>
            <span class="grow"></span>
            <span id="gm-dirty" class="pill"></span>
            <button class="icon-btn" data-act="gm.copyWatch" title="Copier le lien spectateur (stream / OBS)"><i class="fa-solid fa-video"></i></button>
            <button class="icon-btn" data-act="gm.mute" id="gm-mute" title="Écouter l'ambiance sur cet ordinateur"><i class="fa-solid fa-volume-high"></i></button>
            <button class="btn ghost" data-act="gm.export"><i class="fa-solid fa-floppy-disk"></i> <span class="hide-sm">Enregistrer .iris</span></button>
            <button class="btn bad" data-act="gm.end"><i class="fa-solid fa-flag-checkered"></i> <span class="hide-sm">Terminer</span></button>
        </header>
        <div class="gm-body">
            <aside class="gm-side">
                <h5>Agents</h5><div id="gm-roster"></div>
                <h5>Connexions <small id="gm-count"></small></h5><div id="gm-lobby"></div>
            </aside>
            <main class="gm-main"><div id="gm-tabs"></div><div id="gm-panel" class="gm-panel"></div></main>
        </div>
    </div>`;

    rt.host = new Host(s.session.code, {
        onStatus: (st) => { rt.status = st; renderStatus(); },
        onHello: (id, msg) => {
            const c = findChar(store.state, store.state.session.assignments[id]);
            if (msg.role === 'spectator') toast(`👁 Spectateur connecté : ${msg.name || 'stream'}`, 'info');
            else toast(c ? `${msg.name || 'Un joueur'} a rejoint (${c.name})` : `${msg.name || 'Un joueur'} attend une attribution`, 'info');
            beep(660, 0.08);
            store.commit('update', { net: true });
            rt.lastSent.delete(id);
            broadcast.now();
        },
        onLeave: (id) => {
            rt.lastSent.delete(id);
            store.commit('update', { net: true });
        },
        onMessage: (id, msg) => handleClient(id, msg),
    });
    rt.host.start();
    // Début de session (pour le brouillon de rapport) — conservé en cas de reprise après crash.
    if (!s.session.startedAt) { s.session.startedAt = Date.now(); store.commit('update'); }
    rt.unsub = store.on(onStore);
    renderAll();
    syncAudio();
}

function syncAudio() {
    rt?.audio.apply(viewFor(store.state, '', new Set()).ambience);
}

export function unmountGm() {
    if (!rt) return;
    rt.unsub?.();
    rt.audio?.stop();
    rt.map?.destroy();
    rt.host?.stop();
    rt = null;
}

// ---------------------------------------------------------------- Réseau
const onlineChars = () => {
    const set = new Set();
    for (const id of rt.host.clientIds) { const c = store.state.session.assignments[id]; if (c) set.add(c); }
    return set;
};

function sendViews() {
    if (!rt) return;
    const online = onlineChars();
    for (const id of rt.host.clientIds) {
        const v = JSON.stringify(viewFor(store.state, id, online));
        if (rt.lastSent.get(id) === v) continue;
        rt.lastSent.set(id, v);
        rt.host.send(id, JSON.parse(v));
    }
}
let bTimer = null;
const broadcast = () => { clearTimeout(bTimer); bTimer = setTimeout(sendViews, 60); };
broadcast.now = () => { clearTimeout(bTimer); sendViews(); };

function handleClient(clientId, msg) {
    const s = store.state;
    const charId = s.session.assignments[clientId];
    const me = findChar(s, charId);
    const fail = (text) => rt.host.send(clientId, { t: 'error', text });
    // Un spectateur (stream) ne fait que regarder.
    if (rt.host.clients.get(clientId)?.role === 'spectator' && msg.t !== 'getAsset') return;
    try {
        switch (msg.t) {
            case 'chat': {
                if (!me) return fail('Aucun personnage attribué.');
                addChat(s, me.id, 'player', msg.text);
                if (!(rt.tab === 'chat' && rt.chatId === me.id)) rt.unread[me.id] = (rt.unread[me.id] || 0) + 1;
                beep(880, 0.06); setTimeout(() => beep(1100, 0.06), 90);
                if (rt.tab !== 'chat') toast(`💬 ${me.name} : ${String(msg.text).slice(0, 80)}`, 'info', 5000);
                store.commit('structure', { chat: me.id });
                break;
            }
            case 'giveItem': {
                if (!me) return fail('Aucun personnage attribué.');
                const to = findChar(s, msg.to);
                if (!to || !Object.values(s.session.assignments).includes(to.id)) return fail('Destinataire absent de la session.');
                const item = me.inventory.find((i) => i.id === msg.itemId);
                transferItem(s, me.id, to.id, msg.itemId, msg.qty);
                toast(`${me.name} donne ${item?.name} ×${msg.qty} à ${to.name}`, 'info');
                store.commit('structure');
                break;
            }
            case 'giveMoney': {
                if (!me) return fail('Aucun personnage attribué.');
                const to = findChar(s, msg.to);
                if (!to || !Object.values(s.session.assignments).includes(to.id)) return fail('Destinataire absent de la session.');
                transferMoney(s, me.id, to.id, msg.amount, msg.text ? String(msg.text).slice(0, 120) : '');
                toast(`${me.name} vire ${msg.amount} ${s.rules.currency} à ${to.name}`, 'info');
                store.commit('structure');
                break;
            }
            case 'buy': {
                if (!me) return fail('Aucun personnage attribué.');
                const { item, total } = buyItem(s, me.id, msg.shopId, msg.itemId, msg.qty);
                toast(`🛒 ${me.name} achète ${item.name} ×${msg.qty} (${total} ${s.rules.currency})`, 'info');
                rt.host.send(clientId, { t: 'info', text: `Achat effectué : ${item.name} ×${msg.qty} (−${total} ${s.rules.currency})` });
                store.commit('structure');
                break;
            }
            case 'getAsset': {
                const key = String(msg.key || '');
                if (!canGetAsset(s, charId, key)) return fail('Ressource non autorisée.');
                return rt.host.send(clientId, { t: 'asset', key, data: assetData(s, key) });
            }
            default: break;
        }
    } catch (e) {
        fail(e.message);
    }
}

// ---------------------------------------------------------------- Rendu
function onStore(evt) {
    if (!rt?.el.isConnected) return;
    broadcast();
    // Coup de pinceau sur le brouillard : rafraîchissement léger de la carte uniquement.
    if (evt.type === 'update' && evt.scope === 'fog' && !evt.path) { rt.map?.update(store.state.map, store.state.characters); return; }
    renderSide();
    renderDirty();
    renderTabs();
    if (evt.type === 'structure' || evt.type === 'load') { refreshPanel(evt); syncAudio(); }
    else if (rt.tab === 'map' && (evt.scope?.startsWith('token') || evt.scope?.startsWith('npc') || evt.scope === 'map')) refreshPanel(evt);
    else if (evt.scope?.startsWith('track')) syncAudio();
    if (rt.docModal && evt.type === 'structure') refreshDocModal();
}

function renderAll() {
    renderStatus();
    renderDirty();
    renderSide();
    renderTabs();
    mountPanel();
}

function renderStatus() {
    const el = rt.el.querySelector('#gm-status');
    const [label, tone] = STATUS[rt.status] || ['Hors ligne', 'bad'];
    el.textContent = label;
    el.className = 'pill ' + tone;
}

function renderDirty() {
    const el = rt.el.querySelector('#gm-dirty');
    el.innerHTML = store.dirty ? '<i class="fa-solid fa-floppy-disk"></i> Autosave navigateur' : '<i class="fa-solid fa-check"></i> Enregistré';
    el.className = 'pill hide-sm ' + (store.dirty ? 'warn' : 'ok');
    el.title = 'Les modifications sont sauvegardées en continu dans ce navigateur (anti-crash) et, si le .iris a été ouvert avec Chrome/Edge, réécrites automatiquement dans le fichier.';
}

function renderSide() {
    const s = store.state;
    const online = onlineChars();
    rerender(rt.el.querySelector('#gm-roster'), s.characters.map((c) => `
        <button class="roster-item ${c.id === rt.charId ? 'active' : ''}" data-act="gm.pick" data-id="${c.id}">
            ${avatarHtml(c)}<span class="grow"><b>${esc(c.name)} ${online.has(c.id) ? '<i class="dot ok" title="Connecté"></i>' : ''}</b>
            ${hpBar(c.hp, c.hpMax)}<small>${esc(c.money)} ${esc(s.rules.currency)}${c.status ? ' · ' + esc(c.status) : ''}</small></span>
            ${rt.unread[c.id] ? `<b class="badge">${rt.unread[c.id]}</b>` : ''}
        </button>`).join('') || '<p class="muted small">Aucun personnage : ajoutez-en dans Planifier.</p>');

    const opts = (sel) => `<option value="">— Non attribué —</option>` + s.characters.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const ids = rt.host.clientIds;
    rt.el.querySelector('#gm-count').textContent = `(${ids.length})`;
    rerender(rt.el.querySelector('#gm-lobby'), ids.map((id) => {
        const cl = rt.host.clients.get(id);
        if (cl.role === 'spectator') {
            return `<div class="lobby-item spectator"><div class="row"><span class="grow"><i class="fa-solid fa-video"></i> ${esc(cl.name)} <small class="muted">spectateur</small></span>
                <button class="icon-btn danger" data-act="gm.kick" data-id="${esc(id)}" title="Exclure"><i class="fa-solid fa-user-slash"></i></button></div></div>`;
        }
        return `<div class="lobby-item"><span><i class="fa-solid fa-user"></i> ${esc(cl.name)}</span>
            <div class="row"><select data-bind="assign|${esc(id)}" data-structure="1">${opts(s.session.assignments[id])}</select>
            <button class="icon-btn danger" data-act="gm.kick" data-id="${esc(id)}" title="Exclure"><i class="fa-solid fa-user-slash"></i></button></div></div>`;
    }).join('') || `<p class="muted small">Personne pour l'instant. Partagez le code <b>${esc(s.session.code)}</b>.</p>`);
}

function renderTabs() {
    const unread = Object.values(rt.unread).reduce((a, b) => a + b, 0);
    rt.el.querySelector('#gm-tabs').innerHTML = tabsHtml(TABS.map((t) => (t.id === 'chat' ? { ...t, badge: unread || '' } : t)), rt.tab, 'gm.tab');
}

const panel = () => rt.el.querySelector('#gm-panel');

/** Construit le squelette de l'onglet (champs de saisie persistants). */
function mountPanel() {
    if (rt.tab !== 'map') { rt.map?.destroy(); rt.map = null; }
    const p = panel();
    const s = store.state;
    if (rt.tab === 'sheet') {
        p.innerHTML = '<div id="gm-sheet"></div>';
    } else if (rt.tab === 'dice') {
        p.innerHTML = `<div class="dice-layout">
            <section class="card" id="gm-dice-form"></section>
            <section class="card"><div id="gm-last-roll"></div><h4>Historique</h4><ul id="gm-rolls" class="roll-log"></ul></section></div>`;
    } else if (rt.tab === 'map') {
        p.innerHTML = `<div class="map-layout"><div id="gm-map" class="map-box tall"></div><section class="card" id="gm-map-side"></section></div>`;
    } else if (rt.tab === 'chat') {
        rt.chatId ||= s.characters[0]?.id || null;
        p.innerHTML = `<div class="chat-layout"><div id="gm-chat-list" class="split-list"></div>
            <section class="chat-box"><div id="gm-chat-msgs" class="chat-msgs"></div>
            <form class="chat-form" data-submit="gm.send"><input name="text" placeholder="Message privé…" autocomplete="off" required><button class="btn"><i class="fa-solid fa-paper-plane"></i></button></form></section></div>`;
    } else if (rt.tab === 'docs') {
        p.innerHTML = `<div class="row wrap mb"><button class="btn" data-act="gm.newDoc"><i class="fa-solid fa-plus"></i> Nouveau document</button>
            <button class="btn ghost" data-act="tool.encrypt"><i class="fa-solid fa-lock"></i> Chiffrer un PDF</button>
            <span id="gm-spot" class="grow"></span></div><div id="gm-docs"></div>`;
    } else if (rt.tab === 'shops') {
        p.innerHTML = '<div class="row mb"><button class="btn" data-act="shop.add"><i class="fa-solid fa-plus"></i> Nouvelle boutique</button></div><div id="gm-shops"></div>';
    } else if (rt.tab === 'ambience') {
        p.innerHTML = '<div id="gm-amb"></div>';
    }
    refreshPanel({ type: 'load' });
}

function refreshPanel() {
    const s = store.state;
    if (rt.tab === 'sheet') {
        const c = findChar(s, rt.charId) || s.characters[0];
        rt.charId = c?.id || null;
        rerender(rt.el.querySelector('#gm-sheet'), c ? charEditorHtml(s, c, { live: true }) : '<p class="muted pad">Aucun personnage.</p>');
    } else if (rt.tab === 'dice') {
        renderDiceForm();
        renderRolls();
    } else if (rt.tab === 'map') {
        renderMap();
    } else if (rt.tab === 'shops') {
        rerender(rt.el.querySelector('#gm-shops'), s.shops.map((sh) => shopEditorHtml(s, sh, { live: true })).join('') || '<p class="muted">Aucune boutique. Créez-en une : les joueurs pourront acheter eux-mêmes quand elle est ouverte.</p>');
    } else if (rt.tab === 'ambience') {
        rerender(rt.el.querySelector('#gm-amb'), ambienceHtml(s, { live: true }));
    } else if (rt.tab === 'chat') {
        renderChat();
    } else if (rt.tab === 'docs') {
        renderDocs();
    }
}

// ---------------------------------------------------------------- Dés
function renderDiceForm() {
    const s = store.state;
    const d = rt.dice;
    const dice = s.rules.dice;
    const c = findChar(s, d.charId);
    const statBtns = c ? s.rules.stats.map((st) => `<button class="stat-btn" data-act="gm.roll" data-stat="${esc(st.key)}">
        <small>${esc(st.label)}</small><b>${esc(c.stats[st.key] ?? 0)}</b></button>`).join('') : '';
    rerender(rt.el.querySelector('#gm-dice-form'), `
        <h4><i class="fa-solid fa-dice-d20"></i> Lancer un dé <small class="muted">d${dice.sides} · ${dice.mode === 'under' ? 'sous la stat' : 'stat + jet vs difficulté'}</small></h4>
        <div class="grid2">
            <label>Personnage<select data-dice="charId">${s.characters.map((x) => `<option value="${x.id}" ${x.id === d.charId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
            <label>Bonus / malus<div class="row"><button class="icon-btn" data-act="gm.mod" data-delta="${dice.mode === 'under' ? -10 : -1}">−</button>
                <input type="number" data-dice="mod" value="${esc(d.mod)}" class="w-num center"><button class="icon-btn" data-act="gm.mod" data-delta="${dice.mode === 'under' ? 10 : 1}">+</button></div></label>
            ${dice.mode === 'over' ? `<label>Difficulté<input type="number" data-dice="difficulty" value="${esc(d.difficulty)}"></label>` : ''}
            <label>Intitulé (optionnel)<input data-dice="label" value="${esc(d.label)}" placeholder="Crocheter la serrure…"></label>
            <label class="check span2"><input type="checkbox" data-dice="isPublic" ${d.isPublic ? 'checked' : ''}> Afficher le résultat à tous les joueurs</label>
        </div>
        <div class="stat-btns mt">${statBtns || '<p class="muted">Choisissez un personnage.</p>'}</div>
        <div class="row mt"><span class="lbl">Jet libre</span>d<input type="number" min="2" data-dice="sides" value="${esc(d.sides)}" class="w-num">
            <button class="btn ghost" data-act="gm.roll" data-stat=""><i class="fa-solid fa-dice"></i> Lancer</button></div>`);
}

function rollHtml(r, big = false) {
    return `<div class="roll ${esc(r.outcome)} ${big ? 'big' : ''}">
        <div class="roll-die">${esc(r.roll)}</div>
        <div><b>${esc(r.charName)}${r.statLabel ? ' — ' + esc(r.statLabel) : ''}</b>${r.label ? ` <i>« ${esc(r.label)} »</i>` : ''}
        <p>${esc(OUTCOME_LABEL[r.outcome])} · <small>${esc(describeRoll(r))}</small></p>
        <small class="muted">${fmtTime(r.ts)} ${r.public ? '' : '· <i class="fa-solid fa-eye-slash"></i> secret'}</small></div></div>`;
}

function renderRolls() {
    const rolls = store.state.rolls;
    const last = rolls[rolls.length - 1];
    rt.el.querySelector('#gm-last-roll').innerHTML = last ? rollHtml(last, true) : '<p class="muted">Aucun jet pour le moment.</p>';
    rt.el.querySelector('#gm-rolls').innerHTML = rolls.slice(-40, -1).reverse().map((r) => `<li>${rollHtml(r)}</li>`).join('');
}

// ---------------------------------------------------------------- Carte
function renderMap() {
    const s = store.state;
    const box = rt.el.querySelector('#gm-map');
    if (!rt.map || rt.map.el !== box) {
        rt.map = new LiveMap(box, {
            editable: true,
            fogAlpha: 0.55, // le MJ voit à travers le brouillard
            onTokenMove: (id, x, y, kind) => {
                const m = store.state.map;
                if (kind === 'npc') {
                    const n = m.npcs.find((x2) => x2.id === id);
                    if (n) Object.assign(n, { x, y });
                    store.commit('update', { scope: 'npc:' + id });
                } else {
                    m.tokens[id] = { ...(m.tokens[id] || {}), x, y };
                    store.commit('update', { scope: 'token:' + id });
                }
            },
            onPaint: (x, y) => {
                const m = store.state.map;
                if (!m.fog.enabled) return;
                if (paintFog(m, x, y, rt.brushSize, rt.brush === 'reveal')) store.commit('update', { scope: 'fog' });
            },
        });
    }
    rt.map.setBrush(s.map.fog.enabled ? rt.brush : null);
    rt.map.update(s.map, s.characters);
    const fog = s.map.fog;
    const brushBtn = (mode, icon, label) => `<button class="btn sm ${rt.brush === mode ? '' : 'ghost'}" data-act="gm.brush" data-mode="${mode}"><i class="fa-solid ${icon}"></i> ${label}</button>`;
    rerender(rt.el.querySelector('#gm-map-side'), `
        <button class="btn full ${s.map.shared ? 'ok' : ''}" data-act="gm.shareMap"><i class="fa-solid ${s.map.shared ? 'fa-eye' : 'fa-eye-slash'}"></i> ${s.map.shared ? 'Carte affichée aux joueurs' : 'Carte masquée aux joueurs'}</button>
        <p class="muted small mt">Glissez les jetons pour déplacer personnages et PNJ en direct.</p>

        <h4 class="mt"><i class="fa-solid fa-smog"></i> Brouillard de guerre</h4>
        <label class="check"><input type="checkbox" data-bind="fog|enabled" data-structure="1" ${fog.enabled ? 'checked' : ''}> Activer le brouillard</label>
        ${fog.enabled ? `<div class="row wrap mt">${brushBtn('reveal', 'fa-eye', 'Révéler')}${brushBtn('hide', 'fa-eye-slash', 'Masquer')}
            ${rt.brush ? '<button class="btn sm ghost" data-act="gm.brush" data-mode=""><i class="fa-solid fa-hand"></i> Déplacer</button>' : ''}</div>
        <div class="row mt"><span class="lbl">Pinceau</span><select data-brushsize class="w-sel">${[1, 2, 3, 5, 8].map((n) => `<option value="${n}" ${n === rt.brushSize ? 'selected' : ''}>${n} case${n > 1 ? 's' : ''}</option>`).join('')}</select>
            <span class="lbl">Case</span><input type="number" min="10" step="10" class="w-num" data-bind="fog|cell" data-structure="1" value="${esc(fog.cell)}" title="Taille d'une case en pixels (change la grille)"></div>
        <div class="row mt"><button class="btn ghost sm" data-act="gm.fogAll" data-reveal="1">Tout révéler</button><button class="btn ghost sm" data-act="gm.fogAll" data-reveal="0">Tout masquer</button></div>
        <p class="muted small">${rt.brush ? 'Cliquez-glissez sur la carte pour peindre.' : 'Choisissez Révéler ou Masquer puis peignez sur la carte.'} Les PNJ sous le brouillard sont invisibles pour les joueurs.</p>` : ''}

        <h4 class="mt"><i class="fa-solid fa-skull"></i> PNJ & ennemis</h4>
        ${s.map.npcs.map((n) => `<div class="token-row"><span class="avatar npc" style="--c:${esc(n.color)}"><i class="fa-solid fa-skull"></i></span>
            <input data-bind="npc:${n.id}|name" value="${esc(n.name)}" class="grow">
            <input type="color" data-bind="npc:${n.id}|color" data-structure="1" value="${esc(n.color)}" class="w-color">
            <label class="check" title="Visible des joueurs"><input type="checkbox" data-bind="npc:${n.id}|visible" data-structure="1" ${n.visible ? 'checked' : ''}><i class="fa-solid fa-eye"></i></label>
            <button class="icon-btn danger" data-act="gm.delNpc" data-id="${n.id}" title="Retirer"><i class="fa-solid fa-xmark"></i></button></div>`).join('')}
        <form class="row mt" data-submit="gm.addNpc"><input name="name" placeholder="Garde, Dragon…" required class="grow"><button class="btn sm"><i class="fa-solid fa-plus"></i> PNJ</button></form>

        <h4 class="mt">Agents</h4>
        ${s.characters.map((c) => {
        const t = s.map.tokens[c.id];
        return `<div class="token-row">${avatarHtml(c)}<span class="grow">${esc(c.name)}</span>
                ${t ? `<label class="check" title="Visible des joueurs"><input type="checkbox" data-bind="token:${c.id}|visible" data-structure="1" ${t.visible !== false ? 'checked' : ''}><i class="fa-solid fa-eye"></i></label>
                <button class="icon-btn danger" data-act="gm.untoken" data-id="${c.id}" title="Retirer de la carte"><i class="fa-solid fa-xmark"></i></button>`
        : `<button class="btn ghost sm" data-act="gm.token" data-id="${c.id}">Placer</button>`}</div>`;
    }).join('')}
        ${s.map.image ? '' : '<p class="muted small mt">Configurez l\'image de la carte dans Planifier > Carte.</p>'}`);
}

// ---------------------------------------------------------------- Messages
function renderChat() {
    const s = store.state;
    if (rt.chatId) rt.unread[rt.chatId] = 0;
    rt.el.querySelector('#gm-chat-list').innerHTML = s.characters.map((c) => {
        const last = (s.chats[c.id] || []).slice(-1)[0];
        return `<button class="list-item ${c.id === rt.chatId ? 'active' : ''}" data-act="gm.chatWith" data-id="${c.id}">${avatarHtml(c)}
            <span class="grow"><b>${esc(c.name)}</b><small>${last ? esc(last.text.slice(0, 40)) : '—'}</small></span>${rt.unread[c.id] ? `<b class="badge">${rt.unread[c.id]}</b>` : ''}</button>`;
    }).join('');
    const msgs = rt.el.querySelector('#gm-chat-msgs');
    const c = findChar(s, rt.chatId);
    msgs.innerHTML = c ? ((s.chats[c.id] || []).map((m) => `<div class="msg ${m.from === 'gm' ? 'mine' : ''}"><p>${esc(m.text)}</p><small>${m.from === 'gm' ? 'MJ' : esc(c.name)} · ${fmtTime(m.ts)}</small></div>`).join('')
        || `<p class="muted center pad">Aucun message avec ${esc(c.name)}.</p>`) : '';
    msgs.scrollTop = msgs.scrollHeight;
    renderTabs();
}

// ---------------------------------------------------------------- Documents
function renderDocs() {
    const s = store.state;
    const sp = s.session.spotlight ? findDoc(s, s.session.spotlight.docId) : null;
    rt.el.querySelector('#gm-spot').innerHTML = sp ? `<span class="pill ok"><i class="fa-solid fa-tv"></i> À l'écran : ${esc(sp.title)}</span> <button class="btn ghost sm" data-act="gm.unspot">Retirer</button>` : '';
    rerender(rt.el.querySelector('#gm-docs'), s.documents.map((d) => `<section class="card doc-row">
        <div class="row wrap"><i class="fa-solid ${kindIcon(docKind(d))}"></i><b class="grow">${esc(d.title)} <small class="muted">${esc(d.category)}</small></b>
            <button class="btn ghost sm" data-act="doc.preview" data-id="${d.id}"><i class="fa-solid fa-eye"></i> Lire</button>
            <button class="btn ghost sm" data-act="gm.editDoc" data-id="${d.id}"><i class="fa-solid fa-pen"></i> Éditer</button>
            <button class="btn sm" data-act="gm.spot" data-id="${d.id}"><i class="fa-solid fa-tv"></i> Montrer à tous</button></div>
        <div class="chips">${d.public ? '<span class="chip on">Public</span>' : s.characters.map((c) => `<button class="chip ${c.docs.includes(d.id) ? 'on' : ''}" data-act="gm.grant" data-id="${c.id}" data-doc="${d.id}">${esc(c.name)}</button>`).join('')}</div>
    </section>`).join('') || '<p class="muted">Aucun document. Créez-en un ou préparez-les dans Planifier.</p>');
}

function refreshDocModal() {
    const m = rt.docModal;
    if (!m?.el.isConnected) { rt.docModal = null; return; }
    const d = findDoc(store.state, m.id);
    if (!d) { m.close(); return; }
    rerender(m.el.querySelector('.modal-body'), docEditorHtml(store.state, d));
}

// Saisie du formulaire de dés (pas liée au .iris : état d'interface).
document.addEventListener('input', (e) => {
    const k = e.target.dataset?.dice;
    if (!k || !rt) return;
    rt.dice[k] = e.target.type === 'checkbox' ? e.target.checked : ['mod', 'difficulty', 'sides'].includes(k) ? toInt(e.target.value) : e.target.value;
    if (k === 'charId') renderDiceForm();
});
document.addEventListener('input', (e) => {
    if (e.target.dataset?.brushsize === undefined || !rt) return;
    rt.brushSize = toInt(e.target.value, 2);
});

// ---------------------------------------------------------------- Actions
registerActions({
    'gm.tab': (el) => { rt.tab = el.dataset.tab; renderTabs(); mountPanel(); },
    'gm.pick': (el) => {
        rt.charId = el.dataset.id;
        rt.dice.charId = el.dataset.id;
        rt.chatId = el.dataset.id;
        renderSide();
        if (['sheet', 'dice', 'chat'].includes(rt.tab)) refreshPanel();
    },
    'gm.copyCode': async () => {
        const url = new URL('session.html', location.href);
        url.search = '?join=' + store.state.session.code;
        try { await navigator.clipboard.writeText(url.href); toast('Lien d\'invitation copié : ' + url.href, 'ok'); } catch { toast('Code : ' + store.state.session.code); }
    },
    'gm.copyWatch': async () => {
        const url = new URL('session.html', location.href);
        url.search = `?watch=${store.state.session.code}&obs=1`;
        try { await navigator.clipboard.writeText(url.href); toast('Lien spectateur copié (à coller dans une « Source navigateur » OBS) : ' + url.href, 'ok', 7000); } catch { toast(url.href); }
    },
    'gm.mute': (el) => {
        setMuted(!muted);
        rt.audio.setMuted(muted);
        el.innerHTML = muted ? '<i class="fa-solid fa-volume-xmark"></i>' : '<i class="fa-solid fa-volume-high"></i>';
    },
    'gm.export': () => exportIris(),
    'gm.end': async () => {
        const s = store.state;
        const m = modal('Terminer la session', `<form class="stack" data-submit="gm.endGo">
            <p>Le fichier .iris à jour va être enregistré. Conservez-le : il servira à lancer la prochaine session.</p>
            <label class="check"><input type="checkbox" name="draft" checked> Générer un brouillon de rapport (jets, achats, événements)</label>
            <label class="check"><input type="checkbox" name="next" checked> Préparer la session n°${s.meta.sessionNumber + 1}</label>
            <div class="row end"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">Enregistrer et terminer</button></div></form>`);
        rt.endModal = m;
    },
    'gm.endGo': async (form) => {
        const s = store.state;
        const before = { journal: s.journal.length, startedAt: s.session.startedAt, lastSession: s.session.lastSession, n: s.meta.sessionNumber };
        if (form.draft.checked) s.journal.push(draftReport(s));
        s.session.lastSession = { startedAt: s.session.startedAt || 0, endedAt: Date.now() };
        s.session.startedAt = 0;
        if (form.next.checked) s.meta.sessionNumber += 1;
        if (!(await exportIris())) {
            // Enregistrement annulé : la session continue comme avant.
            s.journal.length = before.journal;
            Object.assign(s.session, { startedAt: before.startedAt, lastSession: before.lastSession });
            s.meta.sessionNumber = before.n;
            return;
        }
        s.session.spotlight = null;
        s.ambience.music = null;
        s.ambience.sfx = null;
        rt.endModal?.close();
        for (const id of rt.host.clientIds) rt.host.send(id, { t: 'ended' });
        await new Promise((r) => setTimeout(r, 300));
        await clearAutosave();
        store.meta.exportedAt = Date.now() + 1000;
        rt.onExit?.();
    },
    'gm.kick': async (el) => {
        const id = el.dataset.id;
        if (!(await confirmBox('Exclure ce joueur de la session ?', 'Exclure'))) return;
        rt.host.send(id, { t: 'kicked' });
        delete store.state.session.assignments[id];
        setTimeout(() => { const c = rt.host.clients.get(id); try { c?.conn.close(); } catch { /* ignore */ } }, 300);
        store.commit('structure');
    },
    'gm.mod': (el) => { rt.dice.mod = toInt(rt.dice.mod) + Number(el.dataset.delta); renderDiceForm(); },
    'gm.roll': (el) => {
        const s = store.state;
        const d = rt.dice;
        const free = !el.dataset.stat;
        const dice = s.rules.dice;
        let r;
        if (free) {
            const saved = dice.sides;
            dice.sides = Math.max(2, toInt(d.sides, dice.sides));
            try { r = makeRoll(s, { charId: d.charId || null, mod: d.mod, isPublic: d.isPublic, label: d.label }); } finally { dice.sides = saved; }
        } else {
            r = makeRoll(s, { charId: d.charId, statKey: el.dataset.stat, mod: d.mod, difficulty: d.difficulty, isPublic: d.isPublic, label: d.label });
        }
        beep(r.outcome.includes('success') ? 880 : r.outcome === 'raw' ? 600 : 220, 0.15, 'triangle');
        rt.dice.mod = 0;
        rt.dice.label = '';
        store.commit('structure');
    },
    'gm.shareMap': () => { store.state.map.shared = !store.state.map.shared; store.commit('structure'); },
    'gm.token': (el) => {
        const s = store.state;
        if (!s.map.image) throw new Error('Aucune carte configurée.');
        const { x, y } = rt.map?.center() || { x: s.map.width / 2, y: s.map.height / 2 };
        s.map.tokens[el.dataset.id] = { x, y, visible: true };
        store.commit('structure');
    },
    'gm.untoken': (el) => { delete store.state.map.tokens[el.dataset.id]; store.commit('structure'); },
    'gm.chatWith': (el) => { rt.chatId = el.dataset.id; renderChat(); },
    'gm.send': (form) => {
        if (!rt.chatId) throw new Error('Choisissez un personnage.');
        addChat(store.state, rt.chatId, 'gm', form.text.value);
        form.reset();
        store.commit('structure');
        form.text.focus();
    },
    'gm.newDoc': () => {
        const d = newDocument();
        store.state.documents.push(d);
        store.commit('structure');
        const m = modal('Nouveau document', docEditorHtml(store.state, d), { wide: true, onClose: () => { rt && (rt.docModal = null); store.commit('structure'); } });
        rt.docModal = { ...m, id: d.id };
    },
    'gm.editDoc': (el) => {
        const d = findDoc(store.state, el.dataset.id);
        if (!d) return;
        const m = modal(`Éditer — ${d.title}`, docEditorHtml(store.state, d), { wide: true, onClose: () => { rt && (rt.docModal = null); store.commit('structure'); } });
        rt.docModal = { ...m, id: d.id };
    },
    'gm.grant': (el) => {
        const c = findChar(store.state, el.dataset.id);
        const id = el.dataset.doc;
        const has = c.docs.includes(id);
        c.docs = has ? c.docs.filter((x) => x !== id) : [...c.docs, id];
        if (!has) {
            const title = findDoc(store.state, id)?.title;
            logEvent(store.state, `${c.name} obtient le document « ${title} »`);
            toast(`${c.name} reçoit « ${title} »`, 'ok');
        }
        store.commit('structure');
    },
    'gm.spot': (el) => {
        const s = store.state;
        s.session.spotlight = { docId: el.dataset.id, ts: Date.now() };
        logEvent(s, `Document montré à tous : « ${findDoc(s, el.dataset.id)?.title} »`);
        store.commit('structure');
        toast('Document affiché sur l\'écran de tous les joueurs.', 'ok');
    },
    'gm.unspot': () => { store.state.session.spotlight = null; store.commit('structure'); },

    'gm.brush': (el) => {
        rt.brush = el.dataset.mode || null;
        renderMap();
    },
    'gm.fogAll': async (el) => {
        const reveal = el.dataset.reveal === '1';
        if (!(await confirmBox(reveal ? 'Révéler toute la carte ?' : 'Recouvrir toute la carte de brouillard ?'))) return;
        fillFog(store.state.map, reveal);
        store.commit('structure');
    },
    'gm.addNpc': (form) => {
        const s = store.state;
        if (!s.map.image) throw new Error('Aucune carte configurée.');
        const { x, y } = rt.map?.center() || { x: s.map.width / 2, y: s.map.height / 2 };
        s.map.npcs.push(normalizeNpc({ name: form.name.value.trim(), x, y }));
        form.reset();
        store.commit('structure');
    },
    'gm.delNpc': (el) => {
        const m = store.state.map;
        m.npcs = m.npcs.filter((n) => n.id !== el.dataset.id);
        store.commit('structure');
    },
});

// Vue MJ en direct : héberge la session, voit et modifie tout, lance les dés, gère la carte,
// les documents, l'économie et les conversations privées.
import { store } from './store.js';
import { registerActions, rerender, tabsHtml, runAction } from './ui.js';
import { esc, avatarHtml, hpBar, fmtTime, toast, beep, confirmBox, modal, toInt, muted, setMuted, aliveFirst, deadCls, deadMark, uid } from './util.js';
import { findChar, findDoc, findMap, findBank, findTrack, findShop, lorePage, docKind, newDocument, normalizeNpc } from './iris-file.js';
import { Host } from './net.js';
import { viewFor, makeRoll, addChat, transferItem, transferMoney, buyItem, canGetAsset, assetData, logEvent, launchScene, spawnFromBank,
    groupRoll, drawTable, addPing, timerStart, timerPause, timerReset, timerValue, fmtClock, sessionSnapshot, nextTurn } from './game.js';
import { combatPanelHtml, hpAreaHtml } from './combat.js';
import { undo, redo } from './history.js';
import { openSearch, setSearchOpener } from './search.js';
import { mountCodex, unmountCodex, showCodexPage } from './codex.js';
import { OUTCOME_LABEL, describeRoll } from './dice.js';
import { charEditorHtml, docEditorHtml, kindIcon, shopEditorHtml, ambienceHtml } from './editors.js';
import { LiveMap } from './map.js';
import { paintFog, paintRect, fillFog } from './fog.js';
import { AmbiencePlayer } from './audio.js';
import { exportIris } from './planner.js';
import { draftReport } from './report.js';
import { clearAutosave } from './storage.js';

const TABS = [
    { id: 'sheet', label: 'Fiche', icon: 'fa-id-card' },
    { id: 'dice', label: 'Dés', icon: 'fa-dice-d20' },
    { id: 'map', label: 'Carte', icon: 'fa-map-location-dot' },
    { id: 'combat', label: 'Combat', icon: 'fa-shield-halved' },
    { id: 'scenes', label: 'Scènes', icon: 'fa-clapperboard' },
    { id: 'chat', label: 'Messages', icon: 'fa-comments' },
    { id: 'docs', label: 'Documents', icon: 'fa-folder-open' },
    { id: 'shops', label: 'Commerce', icon: 'fa-store' },
    { id: 'ambience', label: 'Ambiance', icon: 'fa-music' },
    { id: 'codex', label: 'Codex', icon: 'fa-book-skull' },
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
        el, onExit, tab: 'sheet', charId: aliveFirst(s.characters)[0]?.id || null, chatId: null, status: 'connecting', mapId: s.activeMapId,
        unread: {}, lastSent: new Map(), map: null, docModal: null, brush: null, brushSize: 2,
        audio: new AmbiencePlayer(async (src) => (String(src).startsWith('asset:') ? assetData(store.state, src.slice(6)) : src)),
        dice: { charId: aliveFirst(s.characters)[0]?.id || '', mod: 0, difficulty: s.rules.dice.defaultDifficulty, label: '', isPublic: true, sides: s.rules.dice.sides, groupStat: s.rules.stats[0]?.key || '', groupAll: false },
        lastRoll: null, lastGroup: null, pingMode: false, timerDone: false,
    };
    el.innerHTML = `<div class="gm">
        <header class="topbar">
            <div class="brand"><svg class="sigil" viewBox="0 0 100 100"><polygon points="50,6 94,90 6,90"/><circle cx="50" cy="64" r="17"/><circle cx="50" cy="64" r="5" fill="currentColor"/></svg>
                <div><b>${esc(s.meta.title)}</b><small>Vue MJ — session n°${esc(s.meta.sessionNumber)}</small></div></div>
            <button class="code-box" data-act="gm.copyCode" title="Copier le lien d'invitation"><small>Code</small><b>${esc(s.session.code)}</b><i class="fa-regular fa-copy"></i></button>
            <span id="gm-status" class="pill"></span>
            <span class="grow"></span>
            <span id="gm-dirty" class="pill"></span>
            <button class="icon-btn" data-act="gm.search" title="Rechercher (Ctrl+K)"><i class="fa-solid fa-magnifying-glass"></i></button>
            <button class="icon-btn" data-act="gm.undo" title="Annuler (Ctrl+Z)"><i class="fa-solid fa-rotate-left"></i></button>
            <button class="icon-btn" data-act="gm.redo" title="Rétablir (Ctrl+Y)"><i class="fa-solid fa-rotate-right"></i></button>
            <button class="icon-btn" data-act="gm.help" title="Raccourcis clavier (?)"><i class="fa-solid fa-keyboard"></i></button>
            <button class="icon-btn" data-act="gm.copyWatch" title="Copier le lien spectateur (stream / OBS)"><i class="fa-solid fa-video"></i></button>
            <button class="icon-btn" data-act="gm.mute" id="gm-mute" title="Écouter l'ambiance sur cet ordinateur"><i class="fa-solid fa-volume-high"></i></button>
            <button class="btn ghost" data-act="gm.export"><i class="fa-solid fa-floppy-disk"></i> <span class="hide-sm">Enregistrer .iris</span></button>
            <button class="btn bad" data-act="gm.end"><i class="fa-solid fa-flag-checkered"></i> <span class="hide-sm">Terminer</span></button>
        </header>
        <div class="gm-body">
            <aside class="gm-side">
                <h5>Joueurs</h5><div id="gm-roster"></div>
                <div id="gm-requests"></div>
                <h5>Minuteur</h5><div id="gm-timer"></div>
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
    if (!s.session.startedAt) { s.session.startedAt = Date.now(); s.session.startSnapshot = sessionSnapshot(s); store.commit('update'); }
    else if (!s.session.startSnapshot) s.session.startSnapshot = sessionSnapshot(s);
    rt.unsub = store.on(onStore);
    setSearchOpener(openFromSearch);
    rt.tick = setInterval(tickTimer, 500);
    rt.lobbyTick = setInterval(() => rt && renderLobby(), 4000);
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
    clearInterval(rt.tick);
    clearInterval(rt.lobbyTick);
    setSearchOpener(null);
    unmountCodex();
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
            case 'rollReq': {
                if (!me) return fail('Aucun personnage attribué.');
                const mode = s.rules.playerRolls;
                if (mode === 'off') return fail('Le MJ lance les dés lui-même.');
                const st = msg.statKey ? s.rules.stats.find((x) => x.key === msg.statKey) : null;
                if (msg.statKey && !st) return fail('Statistique inconnue.');
                const label = String(msg.label || '').slice(0, 80);
                if (mode === 'auto') {
                    makeRoll(s, { charId: me.id, statKey: st?.key, mod: 0, isPublic: true, label });
                    store.commit('structure');
                } else {
                    if ((s.session.rollRequests || []).filter((r) => r.charId === me.id).length >= 3) return fail('Déjà 3 demandes en attente.');
                    s.session.rollRequests.push({ id: uid('rq'), charId: me.id, statKey: st?.key || '', label, ts: Date.now() });
                    beep(760, 0.07);
                    toast(`🎲 ${me.name} demande un jet${st ? ' de ' + st.label : ''}`, 'info', 5000);
                    store.commit('structure');
                }
                break;
            }
            case 'notes': {
                if (!me) return;
                me.playerNotes = String(msg.text || '').slice(0, 20000);
                store.commit('update', { scope: 'char:' + me.id, path: 'playerNotes', net: true });
                broadcast();
                break;
            }
            case 'mapPing': {
                if (!me && rt.host.clients.get(clientId)?.role !== 'spectator') return;
                const m = s.map;
                if (!s.mapShared || !(Number.isFinite(msg.x) && Number.isFinite(msg.y))) return;
                addPing(s, { x: Math.max(0, Math.min(m.width, msg.x)), y: Math.max(0, Math.min(m.height, msg.y)), by: me?.name || 'Joueur', color: me?.color || '#00e5ff', mapId: m.id });
                store.commit('update', { scope: 'ping' });
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
    if (evt.type === 'update' && evt.scope?.startsWith('fog') && !evt.path) { rt.map?.update(mapCfg(), store.state.characters); return; }
    if (evt.scope === 'ping') { rt.map?.update(mapCfg(), store.state.characters); return; }
    renderSide();
    renderDirty();
    renderTabs();
    if (evt.type === 'structure' || evt.type === 'load') { refreshPanel(evt); syncAudio(); }
    else if (rt.tab === 'map' && (evt.scope?.startsWith('token') || evt.scope?.startsWith('npc') || evt.scope?.startsWith('map'))) refreshPanel(evt);
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
    rerender(rt.el.querySelector('#gm-roster'), aliveFirst(s.characters).map((c) => `
        <button class="roster-item ${c.id === rt.charId ? 'active' : ''} ${deadCls(c)}" data-act="gm.pick" data-id="${c.id}">
            ${avatarHtml(c)}<span class="grow"><b>${esc(c.name)}${deadMark(c)} ${online.has(c.id) ? '<i class="dot ok" title="Connecté"></i>' : ''}</b>
            ${hpBar(c.hp, c.hpMax)}<small>${esc(c.money)} ${esc(s.rules.currency)}${c.status ? ' · ' + esc(c.status) : ''}</small></span>
            ${rt.unread[c.id] ? `<b class="badge">${rt.unread[c.id]}</b>` : ''}
        </button>`).join('') || '<p class="muted small">Aucun personnage : ajoutez-en dans Planifier.</p>');

    renderRequests();
    renderTimerCard();
    renderLobby();
}

function renderRequests() {
    const s = store.state;
    const reqs = s.session.rollRequests || [];
    rerender(rt.el.querySelector('#gm-requests'), reqs.length ? `<h5>Demandes de jets <small>(${reqs.length})</small></h5>${reqs.map((r) => {
        const c = findChar(s, r.charId);
        const st = s.rules.stats.find((x) => x.key === r.statKey);
        return `<div class="req-item">${avatarHtml(c)}<span class="grow"><b>${esc(c?.name || '?')}</b><small>${st ? esc(st.label) + ` (${esc(c?.stats[st.key] ?? 0)})` : 'jet libre'}${r.label ? ' · « ' + esc(r.label) + ' »' : ''}</small></span>
            <button class="icon-btn ok" data-act="gm.req" data-id="${r.id}" data-how="public" title="Lancer (public)"><i class="fa-solid fa-check"></i></button>
            <button class="icon-btn" data-act="gm.req" data-id="${r.id}" data-how="secret" title="Lancer en secret"><i class="fa-solid fa-eye-slash"></i></button>
            <button class="icon-btn danger" data-act="gm.req" data-id="${r.id}" data-how="refuse" title="Refuser"><i class="fa-solid fa-xmark"></i></button></div>`;
    }).join('')}` : '');
}

function renderTimerCard() {
    const t = store.state.session.timer;
    rerender(rt.el.querySelector('#gm-timer'), `<div class="timer-gm">
        <div class="row"><b id="gm-timer-val" class="timer-big">${fmtClock(timerValue(t))}</b><span class="grow"></span>
            <button class="icon-btn ${t.running ? 'ok' : ''}" data-act="gm.timerToggle" title="${t.running ? 'Pause' : 'Démarrer'}"><i class="fa-solid ${t.running ? 'fa-pause' : 'fa-play'}"></i></button>
            <button class="icon-btn" data-act="gm.timerReset" title="Remettre à zéro"><i class="fa-solid fa-rotate"></i></button></div>
        <input data-bind="timer|label" value="${esc(t.label)}" placeholder="Intitulé (la bombe, le rituel…)" class="mt">
        <div class="row mt"><select data-bind="timer|mode" data-structure="1" class="grow"><option value="down" ${t.mode === 'down' ? 'selected' : ''}>Compte à rebours</option><option value="up" ${t.mode === 'up' ? 'selected' : ''}>Chrono</option></select>
            ${t.mode === 'down' ? `<input type="number" min="0" step="0.5" value="${t.duration / 60000}" data-timermin class="w-hp" title="Durée (minutes)"><small>min</small>` : ''}</div>
        <label class="check mt"><input type="checkbox" data-bind="timer|visible" data-structure="1" ${t.visible ? 'checked' : ''}> Visible des joueurs</label></div>`);
}

function tickTimer() {
    if (!rt) return;
    const t = store.state.session.timer;
    const el = rt.el.querySelector('#gm-timer-val');
    const v = timerValue(t);
    if (el) { el.textContent = fmtClock(v); el.classList.toggle('urgent', t.mode === 'down' && t.running && v <= 10000); }
    if (t.mode === 'down' && t.running && v === 0 && !rt.timerDone) {
        rt.timerDone = true;
        beep(220, 0.4, 'square');
        toast(`⏰ ${t.label || 'Minuteur'} : temps écoulé !`, 'warn', 6000);
    }
    if (v > 0) rt.timerDone = false;
}

function renderLobby() {
    const s = store.state;
    const opts = (sel) => `<option value="">— Non attribué —</option>` + aliveFirst(s.characters).map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}${deadCls(c) ? ' (mort)' : ''}</option>`).join('');
    const ids = rt.host.clientIds;
    rt.el.querySelector('#gm-count').textContent = `(${ids.length})`;
    rerender(rt.el.querySelector('#gm-lobby'), ids.map((id) => {
        const cl = rt.host.clients.get(id);
        if (cl.role === 'spectator') {
            return `<div class="lobby-item spectator"><div class="row"><span class="grow"><i class="fa-solid fa-video"></i> ${esc(cl.name)} <small class="muted">spectateur</small></span>
                <button class="icon-btn danger" data-act="gm.kick" data-id="${esc(id)}" title="Exclure"><i class="fa-solid fa-user-slash"></i></button></div></div>`;
        }
        const silent = Math.round((Date.now() - cl.lastSeen) / 1000);
        const q = silent > 9 ? ['bad', `muet depuis ${silent} s`] : cl.rtt === undefined ? ['', '…'] : cl.rtt > 400 ? ['warn', `${cl.rtt} ms`] : ['ok', `${cl.rtt} ms`];
        return `<div class="lobby-item"><div class="row"><span class="grow"><i class="fa-solid fa-user"></i> ${esc(cl.name)}</span>
                <small class="net ${q[0]}" title="Latence / dernier signal"><i class="fa-solid fa-signal"></i> ${q[1]}</small>
                <button class="icon-btn" data-act="gm.resync" data-id="${esc(id)}" title="Renvoyer la vue complète (joueur bloqué)"><i class="fa-solid fa-arrows-rotate"></i></button></div>
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
    if (rt.tab !== 'codex') unmountCodex();
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
    } else if (rt.tab === 'scenes') {
        p.innerHTML = '<div id="gm-scenes"></div>';
    } else if (rt.tab === 'combat') {
        p.innerHTML = '<div id="gm-combat"></div>';
    } else if (rt.tab === 'codex') {
        p.innerHTML = '<div id="cx-root" class="cx-live"></div>';
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
    } else if (rt.tab === 'scenes') {
        renderScenes();
    } else if (rt.tab === 'combat') {
        rerender(rt.el.querySelector('#gm-combat'), combatPanelHtml(s, gmMap().id));
    } else if (rt.tab === 'codex') {
        mountCodex(rt.el.querySelector('#cx-root')); // idempotent : la navigation dans le codex n'est pas perdue
    }
}

// ---------------------------------------------------------------- Scènes
function renderScenes() {
    const s = store.state;
    const n = s.meta.sessionNumber;
    const card = (sc) => {
        const cur = s.session.sceneId === sc.id;
        const tags = [];
        const m = findMap(s, sc.mapId); if (m) tags.push(`<span class="chip"><i class="fa-solid fa-map"></i> ${esc(m.name)}${sc.shareMap ? '' : ' (MJ)'}</span>`);
        const t = findTrack(s, sc.trackId); if (t) tags.push(`<span class="chip"><i class="fa-solid ${t.loop ? 'fa-music' : 'fa-bolt'}"></i> ${esc(t.name)}</span>`);
        const d = findDoc(s, sc.docId); if (d) tags.push(`<span class="chip"><i class="fa-solid fa-tv"></i> ${esc(d.title)}</span>`);
        sc.grantDocs.map((id) => findDoc(s, id)).filter(Boolean).forEach((x) => tags.push(`<span class="chip"><i class="fa-solid fa-file-circle-plus"></i> ${esc(x.title)}</span>`));
        sc.npcs.map((id) => findBank(s, id)).filter(Boolean).forEach((b) => tags.push(`<button class="chip" data-act="gm.bankInfo" data-id="${b.id}"><i class="fa-solid fa-skull"></i> ${esc(b.name)}</button>`));
        sc.shopIds.map((id) => findShop(s, id)).filter(Boolean).forEach((x) => tags.push(`<span class="chip"><i class="fa-solid fa-store"></i> ${esc(x.name)}</span>`));
        const refs = sc.codex.map((id) => lorePage(s, id)).filter(Boolean).map((p) => `<button class="chip" data-act="gm.codexPage" data-id="${esc(p.id)}"><i class="fa-solid fa-book"></i> ${esc(p.name)}</button>`).join('');
        return `<section class="card scene-card ${cur ? 'current' : ''} ${sc.done ? 'done' : ''}">
            <div class="row wrap"><h4 class="grow">${cur ? '<i class="fa-solid fa-circle-play ok"></i>' : sc.done ? '<i class="fa-solid fa-circle-check"></i>' : '<i class="fa-solid fa-clapperboard"></i>'} ${esc(sc.title)}</h4>
                <button class="btn sm" data-act="gm.scene" data-id="${sc.id}"><i class="fa-solid fa-play"></i> ${cur ? 'Relancer' : 'Lancer'}</button>
                <button class="btn ghost sm" data-act="gm.sceneDone" data-id="${sc.id}">${sc.done ? 'Rouvrir' : '<i class="fa-solid fa-check"></i> Jouée'}</button></div>
            ${tags.length ? `<div class="chips mb">${tags.join('')}</div>` : ''}
            ${sc.summary ? `<p class="pre">${esc(sc.summary)}</p>` : ''}
            ${sc.goals ? `<div class="scene-goals"><span class="lbl">Objectifs / indices</span><p class="pre">${esc(sc.goals)}</p></div>` : ''}
            ${refs ? `<div class="chips mt">${refs}</div>` : ''}
        </section>`;
    };
    const now = s.scenes.filter((sc) => sc.session === n);
    const others = s.scenes.filter((sc) => sc.session !== n);
    rerender(rt.el.querySelector('#gm-scenes'), `
        ${now.map(card).join('') || `<p class="muted">Aucune scène prévue pour la session n°${esc(n)}. Préparez-les dans Planifier › Scénario.</p>`}
        ${others.length ? `<details class="mt"><summary class="muted">Autres scènes (${others.length})</summary><div class="mt">${others.map(card).join('')}</div></details>` : ''}`);
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
            <label>Personnage<select data-dice="charId">${aliveFirst(s.characters).map((x) => `<option value="${x.id}" ${x.id === d.charId ? 'selected' : ''}>${esc(x.name)}${deadCls(x) ? ' (mort)' : ''}</option>`).join('')}</select></label>
            <label>Bonus / malus<div class="row"><button class="icon-btn" data-act="gm.mod" data-delta="${dice.mode === 'under' ? -10 : -1}">−</button>
                <input type="number" data-dice="mod" value="${esc(d.mod)}" class="w-num center"><button class="icon-btn" data-act="gm.mod" data-delta="${dice.mode === 'under' ? 10 : 1}">+</button></div></label>
            ${dice.mode === 'over' ? `<label>Difficulté<input type="number" data-dice="difficulty" value="${esc(d.difficulty)}"></label>` : ''}
            <label>Intitulé (optionnel)<input data-dice="label" value="${esc(d.label)}" placeholder="Crocheter la serrure…"></label>
            <label class="check span2"><input type="checkbox" data-dice="isPublic" ${d.isPublic ? 'checked' : ''}> Afficher le résultat à tous les joueurs</label>
        </div>
        <div class="stat-btns mt">${statBtns || '<p class="muted">Choisissez un personnage.</p>'}</div>
        <div class="row mt"><span class="lbl">Jet libre</span>d<input type="number" min="2" data-dice="sides" value="${esc(d.sides)}" class="w-num">
            <button class="btn ghost" data-act="gm.roll" data-stat=""><i class="fa-solid fa-dice"></i> Lancer</button>
            <button class="btn ghost" data-act="gm.reroll" title="Relancer le dernier jet (R)" ${rt.lastRoll ? '' : 'disabled'}><i class="fa-solid fa-repeat"></i></button></div>
        <h4 class="mt"><i class="fa-solid fa-users"></i> Jet de groupe</h4>
        <div class="row wrap"><select data-dice="groupStat" class="grow">${s.rules.stats.map((st) => `<option value="${esc(st.key)}" ${st.key === d.groupStat ? 'selected' : ''}>${esc(st.label)}</option>`).join('')}</select>
            <label class="check" title="Sinon : seulement les joueurs connectés"><input type="checkbox" data-dice="groupAll" ${d.groupAll ? 'checked' : ''}> Tous les vivants</label>
            <button class="btn" data-act="gm.groupRoll"><i class="fa-solid fa-dice"></i> Lancer pour le groupe</button></div>
        ${groupHtml()}
        <h4 class="mt"><i class="fa-solid fa-table-list"></i> Tables aléatoires</h4>
        <div class="row wrap">${(s.tables || []).map((t) => `<button class="btn ghost sm" data-act="gm.drawTable" data-id="${t.id}" title="${t.public ? 'Résultat visible des joueurs' : 'Résultat secret'}">${t.public ? '' : '<i class="fa-solid fa-eye-slash"></i> '}${esc(t.name)}</button>`).join('') || '<span class="muted small">Créez vos tables (rencontres, butin, rumeurs…) dans Planifier › Tables aléatoires.</span>'}</div>`);
}

function groupHtml() {
    if (!rt.lastGroup) return '';
    const rolls = store.state.rolls.filter((r) => r.group === rt.lastGroup);
    if (!rolls.length) return '';
    const ok = rolls.filter((r) => r.outcome.includes('success')).length;
    return `<table class="table mt group-table"><thead><tr><th>Joueur</th><th>Dé</th><th>Résultat</th></tr></thead><tbody>
        ${rolls.map((r) => `<tr class="${esc(r.outcome)}"><td>${esc(r.charName)}</td><td class="mono">${esc(r.roll)} / ${esc(r.target ?? '—')}</td><td>${esc(OUTCOME_LABEL[r.outcome])}</td></tr>`).join('')}
        </tbody></table><p class="muted small">${ok} réussite(s) sur ${rolls.length} · ${esc(rolls[0].statLabel || '')}</p>`;
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
/** Carte affichée dans l'onglet Carte du MJ (peut différer de celle que voient les joueurs). */
function gmMap() {
    const s = store.state;
    if (!rt || !findMap(s, rt.mapId)) { if (rt) rt.mapId = s.activeMapId; return s.map; }
    return findMap(s, rt.mapId);
}

/** Configuration passée à la carte du MJ : carte affichée + pings en cours sur celle-ci. */
function mapCfg() {
    const m = gmMap();
    const now = Date.now();
    return { ...m, pings: (store.state.session.pings || []).filter((p) => p.mapId === m.id && now - p.ts < 6000).map((p) => ({ ...p, age: now - p.ts })) };
}

function renderMap() {
    const s = store.state;
    const m = gmMap();
    const box = rt.el.querySelector('#gm-map');
    if (!rt.map || rt.map.el !== box) {
        rt.map = new LiveMap(box, {
            editable: true,
            fogAlpha: 0.55, // le MJ voit à travers le brouillard
            onTokenMove: (id, x, y, kind) => {
                const mm = gmMap();
                if (kind === 'npc') {
                    const n = mm.npcs.find((x2) => x2.id === id);
                    if (n) Object.assign(n, { x, y });
                    store.commit('update', { scope: 'npc:' + id });
                } else {
                    mm.tokens[id] = { ...(mm.tokens[id] || {}), x, y };
                    store.commit('update', { scope: `token:${mm.id}:${id}` });
                }
            },
            onPaint: (x, y) => {
                const mm = gmMap();
                if (!mm.fog.enabled) return;
                if (paintFog(mm, x, y, rt.brushSize, rt.brush === 'reveal')) store.commit('update', { scope: 'fog:' + mm.id });
            },
            onRect: (x0, y0, x1, y1) => {
                const mm = gmMap();
                if (mm.fog.enabled && paintRect(mm, x0, y0, x1, y1, rt.brush === 'rect-reveal')) store.commit('update', { scope: 'fog:' + mm.id });
            },
            onNoteMove: (id, x, y) => {
                const n = gmMap().notes.find((k) => k.id === id);
                if (n) { Object.assign(n, { x, y }); store.commit('update', { scope: 'map:' + gmMap().id }); }
            },
            onPing: (x, y) => {
                addPing(store.state, { x, y, by: 'MJ', color: '#ffd900', mapId: gmMap().id });
                store.commit('update', { scope: 'ping' });
            },
        });
    }
    rt.map.setBrush(m.fog.enabled ? rt.brush : null);
    rt.map.setPingMode(rt.pingMode);
    rt.map.update(mapCfg(), s.characters);
    const fog = m.fog;
    const shown = m.id === s.activeMapId;
    const brushBtn = (mode, icon, label) => `<button class="btn sm ${rt.brush === mode ? '' : 'ghost'}" data-act="gm.brush" data-mode="${mode}"><i class="fa-solid ${icon}"></i> ${label}</button>`;
    const bankOpts = s.bestiary.map((b) => `<option value="${b.id}">${esc(b.name)} — ${esc(b.kind)}</option>`).join('');
    rerender(rt.el.querySelector('#gm-map-side'), `
        ${s.maps.length > 1 ? `<label>Carte<select data-gmmap>${s.maps.map((x) => `<option value="${x.id}" ${x.id === m.id ? 'selected' : ''}>${x.id === s.activeMapId ? '★ ' : ''}${esc(x.name)}</option>`).join('')}</select></label>` : ''}
        ${shown
        ? `<button class="btn full mt ${s.mapShared ? 'ok' : ''}" data-act="gm.shareMap"><i class="fa-solid ${s.mapShared ? 'fa-eye' : 'fa-eye-slash'}"></i> ${s.mapShared ? 'Carte affichée aux joueurs' : 'Carte masquée aux joueurs'}</button>`
        : `<button class="btn full mt" data-act="gm.showMap" data-id="${m.id}"><i class="fa-solid fa-tv"></i> Montrer cette carte aux joueurs</button>
            <p class="muted small">Les joueurs voient : <b>${esc(s.map.name)}</b> ${s.mapShared ? '(affichée)' : '(masquée)'}. Vous préparez « ${esc(m.name)} » sans qu'ils la voient.</p>`}
        <p class="muted small mt">Glissez les jetons pour déplacer personnages et PNJ en direct.</p>
        <div class="row wrap mt">
            <button class="btn sm ${rt.pingMode ? '' : 'ghost'}" data-act="gm.pingMode" title="Clic = signal visible par tous (ou Alt+clic) — P"><i class="fa-solid fa-location-crosshairs"></i> Ping</button>
            <button class="btn sm ghost" data-act="gm.hpArea"><i class="fa-solid fa-burst"></i> PV de zone</button>
            <button class="btn sm ghost" data-act="gm.undo" title="Annuler (Ctrl+Z)"><i class="fa-solid fa-rotate-left"></i> Annuler</button></div>

        <h4 class="mt"><i class="fa-solid fa-smog"></i> Brouillard de guerre</h4>
        <label class="check"><input type="checkbox" data-bind="fog:${m.id}|enabled" data-structure="1" ${fog.enabled ? 'checked' : ''}> Activer le brouillard</label>
        ${fog.enabled ? `<div class="row wrap mt">${brushBtn('reveal', 'fa-eye', 'Révéler')}${brushBtn('hide', 'fa-eye-slash', 'Masquer')}
            ${brushBtn('rect-reveal', 'fa-vector-square', 'Zone +')}${brushBtn('rect-hide', 'fa-square', 'Zone −')}
            ${rt.brush ? '<button class="btn sm ghost" data-act="gm.brush" data-mode=""><i class="fa-solid fa-hand"></i> Déplacer</button>' : ''}</div>
        <div class="row mt"><span class="lbl">Pinceau</span><select data-brushsize class="w-sel">${[1, 2, 3, 5, 8].map((n) => `<option value="${n}" ${n === rt.brushSize ? 'selected' : ''}>${n} case${n > 1 ? 's' : ''}</option>`).join('')}</select>
            <span class="lbl">Case</span><input type="number" min="10" step="10" class="w-num" data-bind="fog:${m.id}|cell" data-structure="1" value="${esc(fog.cell)}" title="Taille d'une case en pixels (change la grille)"></div>
        <div class="row mt"><button class="btn ghost sm" data-act="gm.fogAll" data-reveal="1">Tout révéler</button><button class="btn ghost sm" data-act="gm.fogAll" data-reveal="0">Tout masquer</button></div>
        <p class="muted small">${String(rt.brush).startsWith('rect') ? 'Tracez un rectangle (une pièce, un couloir…).' : rt.brush ? 'Cliquez-glissez sur la carte pour peindre.' : 'Choisissez un outil puis peignez sur la carte (F pour alterner).'} Les PNJ et lieux sous le brouillard sont invisibles pour les joueurs. Ctrl+Z annule.</p>` : ''}

        <h4 class="mt"><i class="fa-solid fa-note-sticky"></i> Notes MJ <small class="muted">(jamais visibles des joueurs)</small></h4>
        ${m.notes.map((n) => `<div class="token-row"><i class="fa-solid fa-note-sticky note-ico"></i>
            <input data-bind="mapnote:${m.id}:${n.id}|text" value="${esc(n.text)}" class="grow" placeholder="Piège, indice, PNJ caché…">
            <button class="icon-btn danger" data-act="gm.delNote" data-id="${n.id}" title="Supprimer"><i class="fa-solid fa-xmark"></i></button></div>`).join('')}
        <button class="btn ghost sm mt" data-act="gm.addNote"><i class="fa-solid fa-plus"></i> Note au centre de la vue</button>

        <h4 class="mt"><i class="fa-solid fa-skull"></i> PNJ & ennemis</h4>
        ${m.npcs.map((n) => `<div class="token-row">${n.avatar ? avatarHtml(n) : `<span class="avatar npc" style="--c:${esc(n.color)}"><i class="fa-solid fa-skull"></i></span>`}
            <input data-bind="npc:${n.id}|name" value="${esc(n.name)}" class="grow">
            ${n.hpMax ? `<input type="number" class="w-hp" data-bind="npc:${n.id}|hp" value="${esc(n.hp)}" title="PV (sur ${esc(n.hpMax)})">` : ''}
            ${n.refId && findBank(s, n.refId) ? `<button class="icon-btn" data-act="gm.bankInfo" data-id="${n.refId}" title="Fiche"><i class="fa-solid fa-circle-info"></i></button>` : `<input type="color" data-bind="npc:${n.id}|color" data-structure="1" value="${esc(n.color)}" class="w-color">`}
            <label class="check" title="Visible des joueurs"><input type="checkbox" data-bind="npc:${n.id}|visible" data-structure="1" ${n.visible ? 'checked' : ''}><i class="fa-solid fa-eye"></i></label>
            <button class="icon-btn danger" data-act="gm.delNpc" data-id="${n.id}" title="Retirer"><i class="fa-solid fa-xmark"></i></button></div>`).join('')}
        ${bankOpts ? `<form class="row mt" data-submit="gm.addBank"><select name="bank" class="grow">${bankOpts}</select>
            <label class="check" title="Posé masqué : invisible des joueurs jusqu'à ce que vous cochiez l'œil"><input type="checkbox" name="hidden"><i class="fa-solid fa-eye-slash"></i></label>
            <button class="btn sm"><i class="fa-solid fa-plus"></i> Poser</button></form>` : ''}
        <form class="row mt" data-submit="gm.addNpc"><input name="name" placeholder="PNJ rapide : Garde, Dragon…" required class="grow"><button class="btn sm ghost"><i class="fa-solid fa-plus"></i> PNJ</button></form>

        <h4 class="mt">Joueurs</h4>
        ${aliveFirst(s.characters).map((c) => {
        const t = m.tokens[c.id];
        return `<div class="token-row ${deadCls(c)}">${avatarHtml(c)}<span class="grow">${esc(c.name)}${deadMark(c)}</span>
                ${t ? `<label class="check" title="Visible des joueurs"><input type="checkbox" data-bind="token:${m.id}:${c.id}|visible" data-structure="1" ${t.visible !== false ? 'checked' : ''}><i class="fa-solid fa-eye"></i></label>
                <button class="icon-btn danger" data-act="gm.untoken" data-id="${c.id}" title="Retirer de la carte"><i class="fa-solid fa-xmark"></i></button>`
        : `<button class="btn ghost sm" data-act="gm.token" data-id="${c.id}">Placer</button>`}</div>`;
    }).join('')}
        ${m.image ? '' : '<p class="muted small mt">Configurez l\'image de cette carte dans Planifier › Cartes.</p>'}`);
}

// ---------------------------------------------------------------- Messages
function renderChat() {
    const s = store.state;
    if (rt.chatId) rt.unread[rt.chatId] = 0;
    rt.el.querySelector('#gm-chat-list').innerHTML = aliveFirst(s.characters).map((c) => {
        const last = (s.chats[c.id] || []).slice(-1)[0];
        return `<button class="list-item ${c.id === rt.chatId ? 'active' : ''} ${deadCls(c)}" data-act="gm.chatWith" data-id="${c.id}">${avatarHtml(c)}
            <span class="grow"><b>${esc(c.name)}${deadMark(c)}</b><small>${last ? esc(last.text.slice(0, 40)) : '—'}</small></span>${rt.unread[c.id] ? `<b class="badge">${rt.unread[c.id]}</b>` : ''}</button>`;
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
// Choix de la carte affichée dans l'onglet Carte du MJ (ne change pas ce que voient les joueurs).
document.addEventListener('change', (e) => {
    if (e.target.dataset?.gmmap === undefined || !rt) return;
    rt.mapId = e.target.value;
    rt.brush = null;
    renderMap();
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
            <label class="check"><input type="checkbox" name="draft" checked> Générer un brouillon de rapport : bilan (PV, morts, objets, documents, lieux découverts) + chronologie</label>
            <label class="check"><input type="checkbox" name="next" checked> Préparer la session n°${s.meta.sessionNumber + 1}</label>
            <div class="row end"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">Enregistrer et terminer</button></div></form>`);
        rt.endModal = m;
    },
    'gm.endGo': async (form) => {
        const s = store.state;
        const before = { journal: s.journal.length, startedAt: s.session.startedAt, lastSession: s.session.lastSession, n: s.meta.sessionNumber, snap: s.session.startSnapshot };
        if (form.draft.checked) s.journal.push(draftReport(s));
        s.session.lastSession = { startedAt: s.session.startedAt || 0, endedAt: Date.now() };
        s.session.startedAt = 0;
        s.session.startSnapshot = null;
        if (form.next.checked) s.meta.sessionNumber += 1;
        if (!(await exportIris())) {
            // Enregistrement annulé : la session continue comme avant.
            s.journal.length = before.journal;
            Object.assign(s.session, { startedAt: before.startedAt, lastSession: before.lastSession, startSnapshot: before.snap });
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
    'gm.roll': (el) => doRoll(el.dataset.stat || '', { ...rt.dice }),
    'gm.reroll': () => { if (rt.lastRoll) doRoll(rt.lastRoll.stat, rt.lastRoll.d); },
    'gm.shareMap': () => {
        const s = store.state;
        s.mapShared = !s.mapShared;
        if (s.mapShared) logEvent(s, `Carte affichée : ${s.map.name}`);
        store.commit('structure');
    },
    'gm.showMap': (el) => {
        const s = store.state;
        const m = findMap(s, el.dataset.id);
        if (!m) return;
        s.activeMapId = m.id;
        s.mapShared = true;
        logEvent(s, `Carte affichée : ${m.name}`);
        store.commit('structure');
        toast(`Les joueurs voient maintenant « ${m.name} ».`, 'ok');
    },
    'gm.token': (el) => {
        const m = gmMap();
        if (!m.image) throw new Error('Aucune image pour cette carte.');
        const { x, y } = rt.map?.center() || { x: m.width / 2, y: m.height / 2 };
        m.tokens[el.dataset.id] = { x, y, visible: true };
        store.commit('structure');
    },
    'gm.untoken': (el) => { delete gmMap().tokens[el.dataset.id]; store.commit('structure'); },
    'gm.addBank': (form) => {
        const m = gmMap();
        if (!m.image) throw new Error('Aucune image pour cette carte.');
        const { x, y } = rt.map?.center() || {};
        const n = spawnFromBank(store.state, m.id, form.bank.value, { x, y, visible: !form.hidden.checked });
        store.commit('structure');
        toast(`${n.name} posé${n.visible ? '' : ' (masqué)'}.`, 'ok');
    },
    'gm.bankInfo': (el) => {
        const b = findBank(store.state, el.dataset.id);
        if (!b) return;
        const page = b.loreId && lorePage(store.state, b.loreId);
        const m = modal(b.name, `<div class="stack">
            <div class="row">${avatarHtml(b, 'xl')}<div><b>${esc(b.kind)}</b><p class="muted">PV max ${esc(b.hpMax)}</p></div></div>
            ${b.stats ? `<section class="card"><h4>Caractéristiques</h4><p class="pre">${esc(b.stats)}</p></section>` : ''}
            ${b.desc ? `<section class="card"><h4>Description</h4><p class="pre">${esc(b.desc)}</p></section>` : ''}
            ${b.notes ? `<section class="card"><h4>Notes MJ</h4><p class="pre">${esc(b.notes)}</p></section>` : ''}
            ${page ? `<button class="btn ghost" data-act="gm.codexPage" data-id="${esc(page.id)}"><i class="fa-solid fa-book"></i> Fiche du codex</button>` : ''}</div>`);
        rt.infoModal = m;
    },
    'gm.scene': (el) => {
        const s = store.state;
        const done = launchScene(s, el.dataset.id, [...onlineChars()]);
        rt.mapId = s.activeMapId;
        store.commit('structure');
        toast(`Scène lancée${done.length ? ' : ' + done.join(', ') : ''}.`, 'ok', 6000);
    },
    'gm.sceneDone': (el) => {
        const s = store.state;
        const sc = s.scenes.find((x) => x.id === el.dataset.id);
        if (!sc) return;
        sc.done = !sc.done;
        if (sc.done && s.session.sceneId === sc.id) s.session.sceneId = '';
        store.commit('structure');
    },
    'gm.codexPage': (el) => {
        rt.infoModal?.close();
        rt.infoModal = null;
        showCodexPage(el.dataset.id);
        rt.tab = 'codex';
        renderTabs();
        mountPanel();
    },
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
        rt.pingMode = false;
        renderMap();
    },
    'gm.fogAll': async (el) => {
        const reveal = el.dataset.reveal === '1';
        if (!(await confirmBox(reveal ? 'Révéler toute la carte ?' : 'Recouvrir toute la carte de brouillard ?'))) return;
        fillFog(gmMap(), reveal);
        store.commit('structure');
    },
    'gm.addNpc': (form) => {
        const m = gmMap();
        if (!m.image) throw new Error('Aucune image pour cette carte.');
        const { x, y } = rt.map?.center() || { x: m.width / 2, y: m.height / 2 };
        m.npcs.push(normalizeNpc({ name: form.name.value.trim(), x, y }));
        form.reset();
        store.commit('structure');
    },
    'gm.delNpc': (el) => {
        for (const m of store.state.maps) m.npcs = m.npcs.filter((n) => n.id !== el.dataset.id);
        store.commit('structure');
    },
});


// ---------------------------------------------------------------- Jets (commun : bouton, relance, raccourci R)
function doRoll(stat, d) {
    const s = store.state;
    const dice = s.rules.dice;
    let r;
    if (!stat) {
        const saved = dice.sides;
        dice.sides = Math.max(2, toInt(d.sides, dice.sides));
        try { r = makeRoll(s, { charId: d.charId || null, mod: d.mod, isPublic: d.isPublic, label: d.label }); } finally { dice.sides = saved; }
    } else {
        r = makeRoll(s, { charId: d.charId, statKey: stat, mod: d.mod, difficulty: d.difficulty, isPublic: d.isPublic, label: d.label });
    }
    rt.lastRoll = { stat, d: { ...d } };
    beep(r.outcome.includes('success') ? 880 : r.outcome === 'raw' ? 600 : 220, 0.15, 'triangle');
    rt.dice.mod = 0;
    rt.dice.label = '';
    store.commit('structure');
    return r;
}

/** Ouverture d'un résultat de recherche (Ctrl+K) dans la vue MJ. */
function openFromSearch(it) {
    if (!rt) return;
    const s = store.state;
    const go = (tab) => { rt.tab = tab; renderTabs(); mountPanel(); };
    if (it.kind === 'char') { rt.charId = it.id; rt.dice.charId = it.id; go('sheet'); renderSide(); }
    else if (it.kind === 'bank') { runAction('gm.bankInfo', { dataset: { id: it.id } }); }
    else if (it.kind === 'doc') { go('docs'); runAction('gm.editDoc', { dataset: { id: it.id } }); }
    else if (it.kind === 'scene') go('scenes');
    else if (it.kind === 'map' || it.kind === 'marker') {
        rt.mapId = it.mapId || it.id;
        go('map');
        if (it.kind === 'marker') {
            const m = findMap(s, rt.mapId);
            const k = m?.markers[Number(it.id.split(':')[1])];
            if (k && rt.map?.map) setTimeout(() => { rt.map.map.setView([m.height - k.y, k.x], 1); rt.map.flashPing({ x: k.x, y: k.y, by: k.name, color: '#00e5ff' }); }, 300);
        }
    } else if (it.kind === 'shop') go('shops');
    else if (it.kind === 'track') go('ambience');
    else if (it.kind === 'table') go('dice');
    else if (it.kind === 'lore') { showCodexPage(it.id); go('codex'); }
}

const GM_ACTIONS = {
    'gm.search': () => openSearch(),
    'gm.undo': () => undo(),
    'gm.redo': () => redo(),
    'gm.help': () => modal('Raccourcis clavier', `<table class="table">
        <tr><td><kbd>1</kbd>…<kbd>9</kbd></td><td>Sélectionner le joueur n° (liste de gauche)</td></tr>
        <tr><td><kbd>R</kbd></td><td>Relancer le dernier jet</td></tr>
        <tr><td><kbd>N</kbd> / <kbd>Maj</kbd>+<kbd>N</kbd></td><td>Tour suivant / précédent (combat)</td></tr>
        <tr><td><kbd>F</kbd></td><td>Brouillard : Révéler → Masquer → Zone + → Zone − → Déplacer</td></tr>
        <tr><td><kbd>P</kbd></td><td>Mode ping sur la carte (ou <kbd>Alt</kbd>+clic)</td></tr>
        <tr><td><kbd>Ctrl</kbd>+<kbd>K</kbd></td><td>Rechercher partout</td></tr>
        <tr><td><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd></td><td>Annuler / rétablir</td></tr>
        <tr><td><kbd>?</kbd></td><td>Cette aide</td></tr></table>`),
    'gm.req': (el) => {
        const s = store.state;
        const r = s.session.rollRequests.find((x) => x.id === el.dataset.id);
        if (!r) return;
        s.session.rollRequests = s.session.rollRequests.filter((x) => x !== r);
        const id = Object.keys(s.session.assignments).find((k) => s.session.assignments[k] === r.charId);
        if (el.dataset.how === 'refuse') {
            if (id) rt.host.send(id, { t: 'error', text: 'Le MJ a refusé ce jet.' });
        } else {
            const roll = makeRoll(s, { charId: r.charId, statKey: r.statKey || null, mod: 0, difficulty: s.rules.dice.defaultDifficulty, isPublic: el.dataset.how === 'public', label: r.label });
            if (el.dataset.how === 'secret' && id) rt.host.send(id, { t: 'info', text: 'Le MJ a lancé votre jet en secret.' });
            beep(roll.outcome.includes('success') ? 880 : 220, 0.12, 'triangle');
        }
        store.commit('structure');
    },
    'gm.timerToggle': () => {
        const t = store.state.session.timer;
        if (t.running) timerPause(t);
        else { if (t.mode === 'down' && timerValue(t) === 0) timerReset(t); timerStart(t); logEvent(store.state, `Minuteur lancé${t.label ? ' : ' + t.label : ''}`); }
        store.commit('structure');
    },
    'gm.timerReset': () => { timerReset(store.state.session.timer); store.commit('structure'); },
    'gm.resync': (el) => {
        rt.lastSent.delete(el.dataset.id);
        broadcast.now();
        toast('Vue complète renvoyée.', 'ok', 1500);
    },
    'gm.groupRoll': () => {
        const s = store.state;
        const online = onlineChars();
        const ids = aliveFirst(s.characters).filter((c) => !deadCls(c) && (rt.dice.groupAll || online.has(c.id))).map((c) => c.id);
        if (!ids.length) throw new Error(rt.dice.groupAll ? 'Aucun personnage vivant.' : 'Aucun joueur connecté : cochez « Tous les vivants ».');
        const { group } = groupRoll(s, ids, { statKey: rt.dice.groupStat, mod: rt.dice.mod, difficulty: rt.dice.difficulty, isPublic: rt.dice.isPublic, label: rt.dice.label || 'Jet de groupe' });
        rt.lastGroup = group;
        beep(600, 0.1, 'triangle');
        store.commit('structure');
    },
    'gm.drawTable': (el) => {
        const { text, roll } = drawTable(store.state, el.dataset.id);
        toast(`🎲 ${roll.label.split(' : ')[0]} → ${text}${roll.public ? '' : ' (secret)'}`, 'info', 8000);
        store.commit('structure');
    },
    'gm.pingMode': () => { rt.pingMode = !rt.pingMode; if (rt.pingMode) rt.brush = null; renderMap(); },
    'gm.hpArea': () => { rt.hpModal = modal('Dégâts / soins de zone', hpAreaHtml(store.state, gmMap().id)); },
    'gm.addNote': () => {
        const m = gmMap();
        const { x, y } = rt.map?.center() || { x: m.width / 2, y: m.height / 2 };
        m.notes.push({ id: uid('mn'), x, y, text: '' });
        store.commit('structure');
    },
    'gm.delNote': (el) => { const m = gmMap(); m.notes = m.notes.filter((n) => n.id !== el.dataset.id); store.commit('structure'); },
};
registerActions(GM_ACTIONS);

document.addEventListener('change', (e) => {
    if (e.target.dataset?.timermin === undefined || !rt) return;
    const t = store.state.session.timer;
    t.duration = Math.max(0, Number(e.target.value) || 0) * 60000;
    store.commit('structure');
});

// Raccourcis clavier MJ (hors champ de saisie et hors modale).
const BRUSH_CYCLE = ['reveal', 'hide', 'rect-reveal', 'rect-hide', null];
document.addEventListener('keydown', (e) => {
    if (!rt || e.ctrlKey || e.metaKey || e.altKey) return;
    const a = document.activeElement;
    if (a && (a.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName))) return;
    if (document.querySelector('.modal-backdrop')) return;
    const s = store.state;
    const k = e.key;
    if (/^[1-9]$/.test(k)) {
        const c = aliveFirst(s.characters)[Number(k) - 1];
        if (c) { rt.charId = c.id; rt.dice.charId = c.id; rt.chatId = c.id; renderSide(); if (['sheet', 'dice', 'chat'].includes(rt.tab)) refreshPanel(); }
    } else if (k === 'r' || k === 'R') { if (rt.lastRoll) doRoll(rt.lastRoll.stat, rt.lastRoll.d); }
    else if (k === 'n' || k === 'N') { if (s.combat.active) { nextTurn(s, e.shiftKey ? -1 : 1); beep(700, 0.05); store.commit('structure'); } }
    else if (k === 'f' || k === 'F') {
        if (rt.tab !== 'map' || !gmMap().fog.enabled) return;
        rt.brush = BRUSH_CYCLE[(BRUSH_CYCLE.indexOf(rt.brush) + 1) % BRUSH_CYCLE.length];
        rt.pingMode = false;
        renderMap();
        toast(`Outil : ${{ reveal: 'Révéler', hide: 'Masquer', 'rect-reveal': 'Zone +', 'rect-hide': 'Zone −' }[rt.brush] || 'Déplacer'}`, 'info', 1000);
    } else if (k === 'p' || k === 'P') { if (rt.tab === 'map') GM_ACTIONS['gm.pingMode'](); }
    else if (k === '?') GM_ACTIONS['gm.help']();
    else return;
    e.preventDefault();
});

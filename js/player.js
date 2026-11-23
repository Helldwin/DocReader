// Vue Joueur : rejoint une session par code, reçoit sa fiche filtrée depuis le navigateur du MJ.
import { registerActions, rerender, tabsHtml } from './ui.js';
import { esc, avatarHtml, hpBar, fmtTime, toast, beep, modal, uid, setMuted, muted, aliveFirst, deadCls, deadMark } from './util.js';
import { Client } from './net.js';
import { prefs } from './storage.js';
import { OUTCOME_LABEL, describeRoll } from './dice.js';
import { docKind } from './iris-file.js';
import { kindIcon, ledgerLine } from './editors.js';
import { openDocViewer } from './docviewer.js';
import { LiveMap } from './map.js';
import { renderJournal, fetchJournal } from './journal.js';
import { CONFIG } from './config.js';
import { AmbiencePlayer } from './audio.js';
import { showRollOverlay } from './rolloverlay.js';
import { TimerDisplay, combatBannerHtml } from './timer.js';
import { debounce, isDead } from './util.js';

const STATUS = {
    connecting: ['Connexion…', 'warn'],
    connected: ['Connecté', 'ok'],
    'not-found': ['Session introuvable — nouvel essai…', 'warn'],
    lost: ['Connexion perdue — reconnexion…', 'bad'],
    error: ['Erreur réseau — nouvel essai…', 'bad'],
};

let rt = null;

export function clientId() {
    let id = prefs.get('clientId');
    if (!id) { id = uid('p'); prefs.set('clientId', id); }
    return id;
}

export function mountPlayer(el, { code, name, onExit }) {
    rt = {
        el, code, name, onExit, view: null, status: 'connecting', tab: 'sheet',
        seenRolls: null, seenChat: null, unread: 0, assets: new Map(), pending: new Map(),
        spotTs: null, spotModal: null, map: null, journal: null, pingMode: false, notesDraft: null, timer: null,
        audio: new AmbiencePlayer((src) => asset(src)),
    };
    el.innerHTML = `<div class="player">
        <header class="topbar" id="pv-head"></header>
        <div id="pv-tabs"></div>
        <div id="pv-strip" class="pv-strip"><span id="pv-timer" class="hidden"></span><div id="pv-combat" class="grow"></div></div>
        <main id="pv-panel" class="pv-panel"></main>
        <div id="pv-roll" class="roll-overlay hidden"></div>
        <div id="pv-flash" class="screen-flash hidden"></div>
    </div>`;
    rt.timer = new TimerDisplay(el.querySelector('#pv-timer'));
    rt.client = new Client(code, { t: 'hello', clientId: clientId(), name }, {
        onStatus: (s) => { rt.status = s; renderHead(); if (s !== 'connected' && !rt.view) renderWaiting(); },
        onMessage: onMessage,
    });
    rt.client.start();
    renderHead();
    renderWaiting();
}

export function unmountPlayer() {
    if (!rt) return;
    rt.client?.stop();
    rt.audio?.stop();
    rt.map?.destroy();
    rt.timer?.destroy();
    rt.spotModal?.close();
    rt = null;
}

// ---------------------------------------------------------------- Messages réseau
function onMessage(msg) {
    if (!rt) return;
    switch (msg.t) {
        case 'view': onView(msg); break;
        case 'asset': {
            rt.assets.set(msg.key, msg.data);
            rt.pending.get(msg.key)?.resolve(msg.data);
            rt.pending.delete(msg.key);
            if (msg.key.startsWith('map:') && rt.tab === 'map') renderMap();
            break;
        }
        case 'error': toast(msg.text, 'error'); break;
        case 'info': toast(msg.text, 'ok'); break;
        case 'kicked': end('Le MJ vous a retiré de la session.'); break;
        case 'ended': end('La session est terminée. Merci d\'avoir joué !'); break;
        default: break;
    }
}

function end(text) {
    const onExit = rt.onExit;
    unmountPlayer();
    onExit?.(text);
}

/** Récupère auprès du MJ un fichier importé dans le .iris (référence "asset:clé"). */
function asset(ref) {
    if (!String(ref).startsWith('asset:')) return Promise.resolve(ref);
    const key = ref.slice(6);
    if (rt.assets.has(key)) return Promise.resolve(rt.assets.get(key));
    if (rt.pending.has(key)) return rt.pending.get(key).promise;
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    rt.pending.set(key, { promise, resolve });
    rt.client.send({ t: 'getAsset', key });
    return promise;
}

function onView(v) {
    const prev = rt.view;
    rt.view = v;
    // Nouveaux jets publics → animation
    const ids = v.rolls.map((r) => r.id);
    if (rt.seenRolls) {
        const fresh = v.rolls.filter((r) => !rt.seenRolls.has(r.id));
        if (fresh.length) showRoll(fresh[fresh.length - 1]);
    }
    rt.seenRolls = new Set(ids);
    // Ambiance sonore lancée par le MJ
    rt.audio.setMuted(muted);
    rt.audio.apply(v.ambience);
    if (rt.tab === 'shop' && !v.shops?.length) rt.tab = 'sheet';
    // Nouveaux messages du MJ
    const gmMsgs = v.chat.filter((m) => m.from === 'gm').length;
    if (rt.seenChat !== null && gmMsgs > rt.seenChat && rt.tab !== 'chat') { rt.unread += gmMsgs - rt.seenChat; beep(880, 0.06); toast('💬 Nouveau message du MJ', 'info'); }
    rt.seenChat = gmMsgs;
    // Document mis à l'écran par le MJ
    if (v.spotlight && v.spotlight.ts !== rt.spotTs) {
        rt.spotTs = v.spotlight.ts;
        rt.spotModal?.close();
        rt.spotModal = openDocViewer(v.spotlight.doc, { resolveSrc: (d) => asset(d.src) });
        beep(520, 0.12);
    } else if (!v.spotlight && rt.spotTs) {
        rt.spotTs = null;
        rt.spotModal?.close();
        rt.spotModal = null;
    }
    notifyChanges(prev, v);
    rt.timer.set(v.timer);
    rt.el.querySelector('#pv-combat').innerHTML = combatBannerHtml(v.combat, v.me?.id);
    rt.el.querySelector('#pv-strip').classList.toggle('empty', !v.timer && !v.combat);
    if (rt.tab === 'map' && !v.map) rt.tab = 'sheet';
    const structural = !prev || !!prev.me !== !!v.me || !!prev.map !== !!v.map || !!prev.shops?.length !== !!v.shops?.length;
    renderHead();
    if (!v.me) { renderWaiting(); return; }
    renderTabs();
    if (structural) mountPanel(); else refreshPanel();
}

/** Ce qui vient de changer pour le joueur : document ou objet reçu, mort, soins. */
function notifyChanges(prev, v) {
    const a = prev?.me, b = v.me;
    if (!a || !b || a.id !== b.id) return;
    const docsBefore = new Set(prev.docs.map((d) => d.id));
    const fresh = v.docs.filter((d) => !docsBefore.has(d.id));
    if (fresh.length) { beep(980, 0.08); setTimeout(() => beep(1320, 0.1), 110); fresh.forEach((d) => toast(`📄 Nouveau document : ${d.title}`, 'ok', 6000)); }
    const qty = (inv) => inv.reduce((m, i) => { m[i.name] = (m[i.name] || 0) + i.qty; return m; }, {});
    const qa = qty(a.inventory), qb = qty(b.inventory);
    const got = Object.entries(qb).filter(([n, q]) => q > (qa[n] || 0));
    if (got.length) { beep(880, 0.08); got.forEach(([n, q]) => toast(`🎒 Objet reçu : ${n}${q - (qa[n] || 0) > 1 ? ' ×' + (q - (qa[n] || 0)) : ''}`, 'ok', 5000)); }
    if (b.money > a.money) toast(`🪙 +${b.money - a.money} ${v.campaign.currency}`, 'ok', 3500);
    const wasDead = isDead(a), dead = isDead(b);
    if (dead && !wasDead) flash('dead', 'Vous êtes à terre…', [196, 147, 110]);
    else if (!dead && wasDead) flash('heal', 'Vous revenez à vous !', [523, 659, 784]);
    else if (b.hp < a.hp) flash('hurt', `−${a.hp - b.hp} PV`, [180]);
    else if (b.hp > a.hp) flash('heal', `+${b.hp - a.hp} PV`, [660, 880]);
}

function flash(kind, text, notes) {
    const el = rt.el.querySelector('#pv-flash');
    el.className = `screen-flash ${kind}`;
    el.innerHTML = `<span>${esc(text)}</span>`;
    notes.forEach((f, i) => setTimeout(() => beep(f, kind === 'dead' ? 0.35 : 0.12, kind === 'dead' ? 'sawtooth' : 'triangle'), i * 160));
    clearTimeout(rt.flashT);
    rt.flashT = setTimeout(() => el.classList.add('hidden'), kind === 'dead' ? 4200 : 1600);
}

const sendNotes = debounce((text) => { rt?.client.send({ t: 'notes', text }); }, 700);

// ---------------------------------------------------------------- Rendu
function renderHead() {
    if (!rt) return;
    const v = rt.view;
    const me = v?.me;
    const [label, tone] = STATUS[rt.status] || STATUS.connecting;
    rt.el.querySelector('#pv-head').innerHTML = `
        ${me ? avatarHtml(me, 'lg') : '<svg class="sigil" viewBox="0 0 100 100"><polygon points="50,6 94,90 6,90"/><circle cx="50" cy="64" r="17"/><circle cx="50" cy="64" r="5" fill="currentColor"/></svg>'}
        <div class="pv-id"><b>${esc(me?.name || 'Personnage non assigné')}</b><small>${esc(v?.campaign.title || 'I.R.I.S.')}${me?.status ? ' · ' + esc(me.status) : ''}</small></div>
        ${me ? `<div class="pv-vitals">${hpBar(me.hp, me.hpMax)}<span class="money"><i class="fa-solid fa-coins"></i> ${esc(me.money)} ${esc(v.campaign.currency)}</span></div>` : ''}
        <span class="grow"></span>
        <span class="pill ${tone}">${label}</span>
        <button class="icon-btn" data-act="pv.mute" title="Son">${muted ? '<i class="fa-solid fa-volume-xmark"></i>' : '<i class="fa-solid fa-volume-high"></i>'}</button>
        <button class="icon-btn" data-act="pv.quit" title="Quitter"><i class="fa-solid fa-power-off"></i></button>`;
}

function renderWaiting() {
    rt.el.querySelector('#pv-tabs').innerHTML = '';
    const connected = rt.status === 'connected';
    rt.el.querySelector('#pv-panel').innerHTML = `<div class="waiting">
        <div class="spinner"></div>
        <h2>${connected ? 'En attente d\'attribution' : 'Connexion à la session'}</h2>
        <p class="muted">${connected ? `Vous êtes dans la salle. Le MJ va vous attribuer votre personnage, ${esc(rt.name)}.` : `Code <b class="mono">${esc(rt.code)}</b> — le MJ doit avoir lancé la session.`}</p>
        <p class="muted small">Vos passages classifiés et vos documents deviendront accessibles une fois votre personnage assigné.</p></div>`;
}

function tabs() {
    const v = rt.view;
    return [
        { id: 'sheet', label: 'Fiche', icon: 'fa-id-card' },
        { id: 'inv', label: 'Inventaire', icon: 'fa-briefcase' },
        { id: 'docs', label: 'Documents', icon: 'fa-folder-open', badge: v.docs.length || '' },
        ...(v.map ? [{ id: 'map', label: 'Carte', icon: 'fa-map-location-dot' }] : []),
        ...(v.shops?.length ? [{ id: 'shop', label: 'Boutique', icon: 'fa-store' }] : []),
        { id: 'chat', label: 'MJ', icon: 'fa-comments', badge: rt.unread || '' },
        { id: 'journal', label: 'Rapports', icon: 'fa-scroll' },
        { id: 'party', label: 'Groupe', icon: 'fa-users' },
    ];
}

function renderTabs() {
    rt.el.querySelector('#pv-tabs').innerHTML = tabsHtml(tabs(), rt.tab, 'pv.tab');
}

const panel = () => rt.el.querySelector('#pv-panel');

function mountPanel() {
    if (rt.tab !== 'map') { rt.map?.destroy(); rt.map = null; }
    const p = panel();
    if (rt.tab === 'chat') {
        rt.unread = 0;
        renderTabs();
        p.innerHTML = `<section class="chat-box solo"><div id="pv-msgs" class="chat-msgs"></div>
            <form class="chat-form" data-submit="pv.send"><input name="text" placeholder="Message privé au MJ (question, intention, secret…)" autocomplete="off" required>
            <button class="btn"><i class="fa-solid fa-paper-plane"></i></button></form></section>`;
    } else if (rt.tab === 'map') {
        p.innerHTML = `<div class="pv-map-wrap"><div id="pv-map" class="map-box tall"></div>
            <button class="btn sm map-ping-btn ${rt.pingMode ? '' : 'ghost'}" data-act="pv.pingMode" title="Clic sur la carte = signal visible par tous (ou Alt+clic)"><i class="fa-solid fa-location-crosshairs"></i> Ping</button></div>`;
    } else if (rt.tab === 'journal') {
        p.innerHTML = `<div class="journal-wrap"><p class="muted small"><i class="fa-solid fa-user-secret"></i> Connecté en tant que <b>${esc(rt.view.me.name)}</b> : les passages qui vous concernent sont déclassifiés.</p><div id="pv-journal" class="journal-list"><p class="muted">Chargement…</p></div></div>`;
        loadJournal();
        return;
    } else {
        p.innerHTML = '<div id="pv-content"></div>';
    }
    refreshPanel();
}

function refreshPanel() {
    const v = rt.view;
    const me = v.me;
    const c = rt.el.querySelector('#pv-content');
    if (rt.tab === 'sheet') {
        const canRoll = v.campaign.playerRolls && v.campaign.playerRolls !== 'off' && !isDead(me);
        const pending = new Set(v.myRequests || []);
        const stats = v.campaign.stats.map((s) => (canRoll
            ? `<button class="stat-tile rollable ${pending.has(s.key) ? 'pending' : ''}" data-act="pv.roll" data-stat="${esc(s.key)}" title="${pending.has(s.key) ? 'En attente du MJ' : 'Lancer le dé'}"><small>${esc(s.label)}</small><b>${esc(me.stats[s.key] ?? 0)}</b>${pending.has(s.key) ? '<i class="fa-solid fa-hourglass-half"></i>' : '<i class="fa-solid fa-dice-d20"></i>'}</button>`
            : `<div class="stat-tile"><small>${esc(s.label)}</small><b>${esc(me.stats[s.key] ?? 0)}</b></div>`)).join('');
        if (rt.notesDraft !== null && rt.notesDraft === (me.playerNotes || '')) rt.notesDraft = null;
        const notes = rt.notesDraft ?? me.playerNotes ?? '';
        const fields = (me.fields || []).filter((f) => f.label || f.value).map((f) => `<div class="field-tile"><small>${esc(f.label)}</small><b>${esc(f.value)}</b></div>`).join('');
        rerender(c, `${fields ? `<section class="card"><h4><i class="fa-solid fa-id-badge"></i> Identité</h4><div class="field-tiles">${fields}</div></section>` : ''}
            <section class="card"><h4><i class="fa-solid fa-chart-simple"></i> Statistiques ${canRoll ? `<small class="muted">— cliquez pour lancer${v.campaign.playerRolls === 'validate' ? ' (validé par le MJ)' : ''}</small>` : ''}</h4><div class="stat-tiles">${stats}</div></section>
            ${me.bio ? `<section class="card"><h4><i class="fa-solid fa-user"></i> Dossier</h4><p class="pre">${esc(me.bio)}</p></section>` : ''}
            <section class="card"><h4><i class="fa-solid fa-book-open"></i> Mon carnet <small class="muted">— vos notes, gardées d'une session à l'autre (le MJ peut les lire)</small></h4>
                <textarea id="pv-notes" rows="6" placeholder="Indices, noms, pistes, soupçons…">${esc(notes)}</textarea></section>
            <section class="card"><h4><i class="fa-solid fa-dice-d20"></i> Derniers jets</h4><ul class="roll-log">${v.rolls.slice().reverse().slice(0, 12).map((r) => `<li>${rollHtml(r)}</li>`).join('') || '<li class="muted">Aucun jet.</li>'}</ul></section>`);
    } else if (rt.tab === 'inv') {
        const others = v.roster.filter((x) => x.id !== me.id);
        rerender(c, `<section class="card"><h4><i class="fa-solid fa-briefcase"></i> Inventaire</h4>
            <ul class="inv">${me.inventory.map((i) => `<li><span class="qty">×${esc(i.qty)}</span><span class="grow"><b>${esc(i.name)}</b>${i.desc ? `<small>${esc(i.desc)}</small>` : ''}</span>
                ${others.length ? `<button class="btn ghost sm" data-act="pv.give" data-item="${i.id}"><i class="fa-solid fa-hand-holding"></i> Donner</button>` : ''}</li>`).join('') || '<li class="muted">Inventaire vide.</li>'}</ul></section>
            <section class="card"><h4><i class="fa-solid fa-coins"></i> Finances — ${esc(me.money)} ${esc(v.campaign.currency)}</h4>
            ${others.length ? `<form class="row wrap" data-submit="pv.pay"><select name="to">${others.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>
                <input name="amount" type="number" min="1" max="${Math.max(1, me.money)}" placeholder="Montant" required class="w-num"><input name="text" placeholder="Motif" class="grow">
                <button class="btn"><i class="fa-solid fa-money-bill-transfer"></i> Virer</button></form>` : '<p class="muted small">Aucun autre joueur connecté pour un virement.</p>'}
            <ul class="ledger mt">${v.ledger.slice().reverse().map((l) => ledgerLine(fakeState(v), l, me.id)).join('') || '<li class="muted">Aucune transaction.</li>'}</ul></section>`);
    } else if (rt.tab === 'docs') {
        rerender(c, `<div class="doc-grid">${v.docs.map((d) => `<button class="doc-tile" data-act="pv.doc" data-id="${d.id}">
            <i class="fa-solid ${kindIcon(docKind(d))}"></i><b>${esc(d.title)}</b><small>${esc(d.category)}</small>${d.desc ? `<p>${esc(d.desc)}</p>` : ''}</button>`).join('') || '<p class="muted">Aucun document pour le moment.</p>'}</div>`);
    } else if (rt.tab === 'shop') {
        const cur = esc(v.campaign.currency);
        rerender(c, v.shops.map((sh) => `<section class="card"><h4><i class="fa-solid fa-store"></i> ${esc(sh.name)}</h4>${sh.desc ? `<p class="muted">${esc(sh.desc)}</p>` : ''}
            <ul class="inv">${sh.items.map((i) => {
            const out = i.stock === 0;
            const afford = me.money >= i.price;
            return `<li><span class="grow"><b>${esc(i.name)}</b>${i.desc ? `<small>${esc(i.desc)}</small>` : ''}<small>${i.stock < 0 ? 'Stock illimité' : `${esc(i.stock)} en stock`}</small></span>
                <b class="price">${esc(i.price)} ${cur}</b>
                <form class="row" data-submit="pv.buy" data-id="${sh.id}:${i.id}">
                    <input name="qty" type="number" min="1" ${i.stock > 0 ? `max="${i.stock}"` : ''} value="1" class="w-num" ${out ? 'disabled' : ''}>
                    <button class="btn sm" ${out || !afford ? 'disabled' : ''}>${out ? 'Épuisé' : afford ? '<i class="fa-solid fa-cart-shopping"></i> Acheter' : 'Trop cher'}</button>
                </form></li>`;
        }).join('') || '<li class="muted">Rien à vendre pour le moment.</li>'}</ul></section>`).join('')
            + `<p class="muted small center">Solde : <b>${esc(me.money)} ${cur}</b></p>`);
    } else if (rt.tab === 'party') {
        rerender(c, `<div class="party">${aliveFirst(v.roster).map((x) => `<div class="card party-card ${x.id === me.id ? 'me' : ''} ${deadCls(x)}">${avatarHtml(x, 'lg')}
            <div class="grow"><b>${esc(x.name)}${deadMark(x)} ${x.online ? '<i class="dot ok"></i>' : '<i class="dot"></i>'}</b>${x.status ? `<small>${esc(x.status)}</small>` : ''}
            ${x.hpMax !== undefined ? hpBar(x.hp, x.hpMax) : ''}</div></div>`).join('')}</div>`);
    } else if (rt.tab === 'chat') {
        const box = rt.el.querySelector('#pv-msgs');
        box.innerHTML = v.chat.map((m) => `<div class="msg ${m.from === 'player' ? 'mine' : ''}"><p>${esc(m.text)}</p><small>${m.from === 'gm' ? 'MJ' : 'Vous'} · ${fmtTime(m.ts)}</small></div>`).join('')
            || '<p class="muted center pad">Posez vos questions au MJ ici, personne d\'autre ne les verra.</p>';
        box.scrollTop = box.scrollHeight;
    } else if (rt.tab === 'map') {
        renderMap();
    }
}

/** ledgerLine attend un état : on reconstruit le minimum depuis la vue. */
function fakeState(v) {
    return { rules: { currency: v.campaign.currency }, characters: v.roster.concat(v.roster.some((r) => r.id === v.me.id) ? [] : [v.me]) };
}

async function renderMap() {
    const v = rt.view;
    const box = rt.el.querySelector('#pv-map');
    if (!box || !v.map) return;
    if (!rt.map || rt.map.el !== box) {
        // L'onglet a été redessiné : la carte doit être reconstruite sur le nouvel élément.
        rt.map?.destroy();
        rt.map = new LiveMap(box, { editable: false, fogFit: true, onPing: (x, y) => { if (rt.client.send({ t: 'mapPing', x, y })) beep(900, 0.05); } });
    }
    rt.map.setPingMode(rt.pingMode);
    let image = v.map.image;
    if (image.startsWith('asset:')) {
        const key = image.slice(6);
        if (!rt.assets.has(key)) { asset(image); box.innerHTML ||= '<p class="muted center pad">Téléchargement de la carte…</p>'; return; }
        image = rt.assets.get(key);
    }
    rt.map.update({ ...v.map, image, pings: v.pings }, v.map.chars);
}

async function loadJournal() {
    const box = rt.el.querySelector('#pv-journal');
    try {
        rt.journal ||= await fetchJournal(CONFIG.JOURNAL_URL);
        if (rt?.tab === 'journal') await renderJournal(box, rt.journal, rt.view.key || {});
    } catch {
        box.innerHTML = '<p class="muted">Journal indisponible.</p>';
    }
}

function rollHtml(r) {
    return `<div class="roll ${esc(r.outcome)}"><div class="roll-die">${esc(r.roll)}</div>
        <div><b>${esc(r.charName)}${r.statLabel ? ' — ' + esc(r.statLabel) : ''}</b>${r.label ? ` <i>« ${esc(r.label)} »</i>` : ''}
        <p>${esc(OUTCOME_LABEL[r.outcome])} · <small>${esc(describeRoll(r))}</small></p><small class="muted">${fmtTime(r.ts)}</small></div></div>`;
}

function showRoll(r) {
    showRollOverlay(rt.el.querySelector('#pv-roll'), r, { mine: !!r.charId && r.charId === rt.view?.me?.id });
}

// ---------------------------------------------------------------- Actions
registerActions({
    'pv.tab': (el) => { rt.tab = el.dataset.tab; renderTabs(); mountPanel(); },
    'pv.roll': (el) => {
        if ((rt.view.myRequests || []).includes(el.dataset.stat)) return toast('Demande déjà envoyée au MJ.', 'info');
        if (!rt.client.send({ t: 'rollReq', statKey: el.dataset.stat })) throw new Error('Non connecté.');
        beep(700, 0.05);
        if (rt.view.campaign.playerRolls === 'validate') toast('Demande de jet envoyée au MJ.', 'info', 2500);
    },
    'pv.pingMode': (el) => { rt.pingMode = !rt.pingMode; rt.map?.setPingMode(rt.pingMode); el.classList.toggle('ghost', !rt.pingMode); },
    'pv.quit': () => { const f = rt.onExit; unmountPlayer(); f?.(); },
    'pv.mute': () => { setMuted(!muted); rt.audio.setMuted(muted); renderHead(); },
    'pv.buy': (form) => {
        const [shopId, itemId] = form.dataset.id.split(':');
        if (!rt.client.send({ t: 'buy', shopId, itemId, qty: Number(form.qty.value) || 1 })) throw new Error('Non connecté.');
    },
    'pv.send': (form) => {
        if (!rt.client.send({ t: 'chat', text: form.text.value })) throw new Error('Non connecté.');
        form.reset();
        form.text.focus();
    },
    'pv.doc': (el) => {
        const d = rt.view.docs.find((x) => x.id === el.dataset.id);
        if (d) openDocViewer(d, { resolveSrc: (doc) => asset(doc.src) });
    },
    'pv.give': (el) => {
        const v = rt.view;
        const item = v.me.inventory.find((i) => i.id === el.dataset.item);
        if (!item) return;
        const others = v.roster.filter((x) => x.id !== v.me.id);
        const m = modal(`Donner — ${item.name}`, `<form class="stack" data-submit="pv.giveGo" data-item="${item.id}">
            <label>À<select name="to">${others.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></label>
            <label>Quantité<input name="qty" type="number" min="1" max="${item.qty}" value="1"></label>
            <div class="row end"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">Donner</button></div></form>`);
        rt.giveModal = m;
    },
    'pv.giveGo': (form) => {
        rt.client.send({ t: 'giveItem', itemId: form.dataset.item, to: form.to.value, qty: Number(form.qty.value) });
        rt.giveModal?.close();
    },
    'pv.pay': (form) => {
        rt.client.send({ t: 'giveMoney', to: form.to.value, amount: Number(form.amount.value), text: form.text.value });
        form.reset();
    },
});


// Carnet du joueur : envoyé au MJ pendant la frappe (il est enregistré dans le .iris).
document.addEventListener('input', (e) => {
    if (e.target.id !== 'pv-notes' || !rt) return;
    rt.notesDraft = e.target.value;
    sendNotes(e.target.value);
});

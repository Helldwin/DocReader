// Vue spectateur : écran de diffusion pour un stream (Actual Play), à mettre dans OBS
// comme "Source navigateur". Lecture seule : carte, groupe, jets publics, documents montrés,
// ambiance sonore. Aucune donnée privée n'est envoyée à un spectateur.
//   session.html?watch=CODE          → vue spectateur
//   session.html?watch=CODE&obs=1    → fond transparent, sans effet CRT (incrustation)
import { esc, avatarHtml, hpBar, uid } from './util.js';
import { Client } from './net.js';
import { prefs } from './storage.js';
import { openDocViewer } from './docviewer.js';
import { LiveMap } from './map.js';
import { AmbiencePlayer } from './audio.js';
import { showRollOverlay, rollLineHtml } from './rolloverlay.js';

let rt = null;

function spectatorId() {
    let id = prefs.get('spectatorId');
    if (!id) { id = uid('s'); prefs.set('spectatorId', id); }
    return id;
}

export function mountSpectator(el, { code, name = 'Stream', obs = false, onExit }) {
    document.body.classList.toggle('obs', obs);
    rt = { el, code, onExit, view: null, seenRolls: null, spotTs: null, spotModal: null, assets: new Map(), pending: new Map(), map: null, status: 'connecting' };
    rt.audio = new AmbiencePlayer((src) => asset(src));
    el.innerHTML = `<div class="spectator">
        <header class="sp-head"><svg class="sigil" viewBox="0 0 100 100"><polygon points="50,6 94,90 6,90"/><circle cx="50" cy="64" r="17"/><circle cx="50" cy="64" r="5" fill="currentColor"/></svg>
            <div class="grow"><b id="sp-title">I.R.I.S.</b><small id="sp-sub">Connexion à la session ${esc(code)}…</small></div>
            <span id="sp-live" class="pill warn">Connexion…</span></header>
        <main class="sp-main"><div id="sp-map" class="sp-map"></div><aside id="sp-feed" class="sp-feed"></aside></main>
        <footer id="sp-party" class="sp-party"></footer>
        <div id="sp-roll" class="roll-overlay hidden"></div>
    </div>`;
    rt.client = new Client(code, { t: 'hello', clientId: spectatorId(), name, role: 'spectator' }, {
        onStatus: (s) => {
            rt.status = s;
            const live = rt.el.querySelector('#sp-live');
            live.className = 'pill ' + (s === 'connected' ? 'ok' : 'warn');
            live.innerHTML = s === 'connected' ? '<i class="dot ok"></i> En direct' : s === 'not-found' ? 'En attente du MJ…' : 'Reconnexion…';
        },
        onMessage,
    });
    rt.client.start();
    renderMap();
}

export function unmountSpectator() {
    if (!rt) return;
    rt.client?.stop();
    rt.audio?.stop();
    rt.map?.destroy();
    rt.spotModal?.close();
    document.body.classList.remove('obs');
    rt = null;
}

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

function onMessage(msg) {
    if (!rt) return;
    if (msg.t === 'view') return onView(msg);
    if (msg.t === 'asset') {
        rt.assets.set(msg.key, msg.data);
        rt.pending.get(msg.key)?.resolve(msg.data);
        rt.pending.delete(msg.key);
        if (msg.key === 'map') renderMap();
        return;
    }
    if (msg.t === 'ended' || msg.t === 'kicked') {
        const f = rt.onExit;
        unmountSpectator();
        f?.(msg.t === 'ended' ? 'Fin de la session. Merci d\'avoir regardé !' : 'Le MJ a fermé la vue spectateur.');
    }
}

function onView(v) {
    rt.view = v;
    rt.el.querySelector('#sp-title').textContent = v.campaign.title;
    rt.el.querySelector('#sp-sub').textContent = `Session n°${v.campaign.session}`;
    if (rt.seenRolls) {
        const fresh = v.rolls.filter((r) => !rt.seenRolls.has(r.id));
        if (fresh.length) showRollOverlay(rt.el.querySelector('#sp-roll'), fresh[fresh.length - 1]);
    }
    rt.seenRolls = new Set(v.rolls.map((r) => r.id));
    rt.audio.apply(v.ambience);
    if (v.spotlight && v.spotlight.ts !== rt.spotTs) {
        rt.spotTs = v.spotlight.ts;
        rt.spotModal?.close();
        rt.spotModal = openDocViewer(v.spotlight.doc, { resolveSrc: (d) => asset(d.src) });
    } else if (!v.spotlight && rt.spotTs) {
        rt.spotTs = null;
        rt.spotModal?.close();
        rt.spotModal = null;
    }
    rt.el.querySelector('#sp-party').innerHTML = v.roster.map((c) => `<div class="sp-agent">${avatarHtml(c, 'lg')}
        <div><b>${esc(c.name)}</b>${c.status ? `<small>${esc(c.status)}</small>` : ''}${c.hpMax !== undefined ? hpBar(c.hp, c.hpMax) : ''}</div></div>`).join('');
    rt.el.querySelector('#sp-feed').innerHTML = `<h5>Derniers jets</h5><ul class="roll-log">${v.rolls.slice(-6).reverse().map((r) => `<li>${rollLineHtml(r)}</li>`).join('') || '<li class="muted small">—</li>'}</ul>
        ${v.ambience?.music ? `<p class="sp-music"><i class="fa-solid fa-music"></i> ${esc(v.ambience.music.name)}</p>` : ''}`;
    renderMap();
}

function renderMap() {
    const box = rt.el.querySelector('#sp-map');
    const m = rt.view?.map;
    if (!m) {
        rt.map?.destroy();
        rt.map = null;
        box.innerHTML = `<div class="sp-idle"><svg class="sigil huge" viewBox="0 0 100 100"><polygon points="50,6 94,90 6,90"/><circle cx="50" cy="64" r="17"/><circle cx="50" cy="64" r="5" fill="currentColor"/></svg>
            <p>${esc(rt.view?.campaign.title || 'I.R.I.S.')}</p></div>`;
        return;
    }
    let image = m.image;
    if (image.startsWith('asset:')) {
        if (!rt.assets.has('map')) { asset(image); return; }
        image = rt.assets.get('map');
    }
    if (!rt.map) { box.innerHTML = ''; rt.map = new LiveMap(box, { editable: false }); }
    rt.map.update({ ...m, image }, m.chars);
}



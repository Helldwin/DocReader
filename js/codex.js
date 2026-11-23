// Codex du MJ : consultation du lore importé (pages, synopsis, diagrammes du scénario).
// Utilisé dans « Planifier » et dans la vue MJ en direct. Jamais envoyé aux joueurs.
import { store } from './store.js';
import { registerActions } from './ui.js';
import { esc, toast } from './util.js';
import { newDocument, lorePage } from './iris-file.js';
import { sanitizeLoreHtml, pageToText } from './lore.js';

const cx = { el: null, lore: null, tab: 'pages', pageId: null, q: '', cat: '', diagramId: null, nodeId: null, dq: '', view: null, history: [] };

const nameOf = (id) => lorePage(store.state, id)?.name || '';
const img = (id) => (id && store.state.lore?.images[id]) || '';
const linkHtml = (id) => {
    const p = lorePage(store.state, id);
    return p ? `<button class="lore-link" data-act="cx.page" data-id="${esc(id)}">${esc(p.name)}</button>` : '<span class="lore-link missing">(lien)</span>';
};

/** Monte le codex dans `el`. Idempotent : ne redessine pas si rien n'a changé (préserve le zoom du diagramme). */
export function mountCodex(el, { force = false } = {}) {
    const lore = store.state?.lore || null;
    if (!force && cx.el === el && el.isConnected && cx.lore === lore && el.firstChild) return;
    cx.el = el;
    cx.lore = lore;
    renderCodex();
}

export function unmountCodex() {
    cx.view?.destroy();
    cx.view = null;
    cx.el = null;
}

/** Ouvre une page du codex (depuis une scène, un lieu…). */
export function showCodexPage(id) {
    cx.tab = 'pages';
    cx.pageId = id;
    if (cx.el?.isConnected) renderCodex();
}

function renderCodex() {
    const el = cx.el;
    if (!el?.isConnected) return;
    const lore = store.state.lore;
    cx.view?.destroy();
    cx.view = null;
    if (!lore) {
        el.innerHTML = `<div class="card center pad"><i class="fa-solid fa-book-skull big-ico"></i>
            <p>Aucun lore importé.</p><p class="muted small">Planifier › Codex › <b>Importer un .lore</b> (Amsel Suite) : pages, diagrammes, cartes, fiches PJ / PNJ.</p></div>`;
        return;
    }
    const tabs = [['pages', 'fa-book', `Pages (${lore.pages.length})`], ['diagram', 'fa-diagram-project', `Diagrammes (${lore.diagrams.length})`], ['synopsis', 'fa-scroll', 'Synopsis']];
    el.innerHTML = `<div class="codex">
        <nav class="tabs">${tabs.map(([id, icon, label]) => `<button class="tab ${cx.tab === id ? 'active' : ''}" data-act="cx.tab" data-tab="${id}"><i class="fa-solid ${icon}"></i><span>${label}</span></button>`).join('')}
            <span class="grow"></span><small class="muted cx-src" title="Importé le ${new Date(lore.importedAt).toLocaleString('fr-FR')}"><i class="fa-solid fa-feather"></i> ${esc(lore.title || lore.source)}</small></nav>
        <div class="codex-body" id="cx-body"></div></div>`;
    const body = el.querySelector('#cx-body');
    if (cx.tab === 'pages') body.innerHTML = pagesHtml(lore);
    else if (cx.tab === 'synopsis') body.innerHTML = `<article class="card lore-text">${sanitizeLoreHtml(lore.synopsis, linkHtml) || '<p class="muted">Pas de synopsis.</p>'}</article>`;
    else mountDiagramTab(body, lore);
}

// ---------------------------------------------------------------- Pages
function filteredPages(lore) {
    const q = cx.q.trim().toLowerCase();
    return lore.pages.filter((p) => (!cx.cat || p.category === cx.cat)
        && (!q || p.name.toLowerCase().includes(q) || p.aliases?.some((a) => a.toLowerCase().includes(q)) || p.category.toLowerCase().includes(q)));
}

function listHtml(lore) {
    const groups = new Map();
    for (const p of filteredPages(lore)) {
        const k = p.category;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(p);
    }
    return [...groups].map(([cat, list]) => `<h5 class="cx-cat">${esc(cat)} <small>${list.length}</small></h5>` + list.map((p) => `
        <button class="list-item ${p.id === cx.pageId ? 'active' : ''}" data-act="cx.page" data-id="${esc(p.id)}">
            ${p.image && img(p.image) ? `<span class="avatar"><img src="${esc(img(p.image))}" alt=""></span>` : '<i class="fa-solid fa-file-lines"></i>'}
            <span><b>${esc(p.name)}</b>${p.group ? `<small>${esc(p.group)}</small>` : ''}</span></button>`).join('')).join('') || '<p class="muted small">Aucun résultat.</p>';
}

function pagesHtml(lore) {
    if (!cx.pageId || !lore.pages.some((p) => p.id === cx.pageId)) cx.pageId = filteredPages(lore)[0]?.id || null;
    const cats = [...new Set(lore.pages.map((p) => p.category))];
    return `<div class="split codex-split">
        <div class="split-list cx-list-col">
            <input data-cx="q" value="${esc(cx.q)}" placeholder="Rechercher une page…" autocomplete="off">
            <div class="chips mt">${['', ...cats].map((c) => `<button class="chip ${cx.cat === c ? 'on' : ''}" data-act="cx.cat" data-cat="${esc(c)}">${esc(c || 'Tout')}</button>`).join('')}</div>
            <div id="cx-list" class="cx-list mt">${listHtml(lore)}</div>
        </div>
        <div class="split-detail" id="cx-page">${pageHtml(lorePage(store.state, cx.pageId))}</div>
    </div>`;
}

function pageHtml(p) {
    if (!p) return '<p class="muted pad">Choisissez une page.</p>';
    const s = store.state;
    const blocks = p.blocks.map((b) => {
        if (b.type === 'text') return `<section class="card lore-text">${b.title ? `<h4>${esc(b.title)}</h4>` : ''}${sanitizeLoreHtml(b.html, linkHtml)}</section>`;
        if (b.type === 'image') return img(b.image) ? `<section class="card">${b.title ? `<h4>${esc(b.title)}</h4>` : ''}<img class="lore-img" src="${esc(img(b.image))}" alt=""></section>` : '';
        if (b.type === 'fields') {
            return `<section class="card">${b.title ? `<h4>${esc(b.title)}</h4>` : ''}<dl class="lore-fields">${b.fields.map((f) => `<dt>${esc(f.label)}</dt><dd>${f.link ? linkHtml(f.link) : ''}${f.link && f.value ? ' ' : ''}${esc(f.value)}</dd>`).join('')}</dl></section>`;
        }
        return '';
    }).join('');
    // Rétroliens : pages et nœuds de diagramme qui mentionnent cette page.
    const needle = p.id;
    const back = s.lore.pages.filter((o) => o.id !== p.id && o.blocks.some((b) => (b.type === 'text' && b.html.includes(needle)) || (b.type === 'fields' && b.fields.some((f) => f.link === needle))));
    const nodes = s.lore.diagrams.flatMap((d) => d.nodes.filter((n) => n.page === needle).map((n) => ({ d, n })));
    const uses = [
        ...s.characters.filter((c) => c.loreId === p.id).map((c) => `<span class="chip on"><i class="fa-solid fa-user"></i> Personnage : ${esc(c.name)}</span>`),
        ...s.bestiary.filter((b) => b.loreId === p.id).map((b) => `<span class="chip on"><i class="fa-solid fa-skull"></i> Banque : ${esc(b.name)}</span>`),
        ...s.maps.flatMap((m) => m.markers.filter((k) => k.loreId === p.id).map(() => `<span class="chip on"><i class="fa-solid fa-location-dot"></i> Lieu sur « ${esc(m.name)} »</span>`)),
        ...s.scenes.filter((sc) => sc.codex.includes(p.id)).map((sc) => `<span class="chip on"><i class="fa-solid fa-clapperboard"></i> Scène : ${esc(sc.title)}</span>`),
    ];
    return `<article class="lore-page">
        <header class="card lore-head">
            ${p.image && img(p.image) ? `<img class="lore-cover" src="${esc(img(p.image))}" alt="">` : ''}
            <div class="grow"><small class="muted">${esc(p.category)}${p.group ? ' · ' + esc(p.group) : ''}</small><h2>${esc(p.name)}</h2>
                ${p.aliases?.length ? `<p class="muted small">Alias : ${esc(p.aliases.join(', '))}</p>` : ''}
                ${uses.length ? `<div class="chips">${uses.join('')}</div>` : ''}
                <div class="row wrap mt">
                    ${cx.history.length ? '<button class="btn ghost sm" data-act="cx.back"><i class="fa-solid fa-arrow-left"></i> Retour</button>' : ''}
                    <button class="btn ghost sm" data-act="cx.toDoc" data-id="${esc(p.id)}" title="Crée un document texte (non partagé) avec le contenu de cette page"><i class="fa-solid fa-file-export"></i> Créer un document joueur</button>
                </div></div>
        </header>
        ${blocks || '<p class="muted">Page vide.</p>'}
        ${back.length || nodes.length ? `<section class="card"><h4><i class="fa-solid fa-link"></i> Mentionné dans</h4><div class="chips">
            ${back.map((o) => `<button class="chip" data-act="cx.page" data-id="${esc(o.id)}">${esc(o.name)}</button>`).join('')}
            ${nodes.map(({ d, n }) => `<button class="chip" data-act="cx.node" data-diagram="${esc(d.id)}" data-id="${esc(n.id)}"><i class="fa-solid fa-diagram-project"></i> ${esc(d.name)} › ${esc(n.label || n.legend || '…')}</button>`).join('')}
        </div></section>` : ''}
    </article>`;
}

// ---------------------------------------------------------------- Diagrammes
function mountDiagramTab(body, lore) {
    if (!lore.diagrams.length) { body.innerHTML = '<p class="muted pad">Aucun diagramme dans ce lore.</p>'; return; }
    if (!lore.diagrams.some((d) => d.id === cx.diagramId)) cx.diagramId = lore.diagrams[0].id;
    const d = lore.diagrams.find((x) => x.id === cx.diagramId);
    body.innerHTML = `<div class="dg-layout">
        <div class="row wrap dg-toolbar">
            <select data-cx="diagram">${lore.diagrams.map((x) => `<option value="${esc(x.id)}" ${x.id === d.id ? 'selected' : ''}>${esc(x.name)} (${x.nodes.length})</option>`).join('')}</select>
            <input data-cx="dq" value="${esc(cx.dq)}" placeholder="Chercher (nom, date, lieu…) — Entrée = suivant" autocomplete="off" class="grow">
            <span id="dg-hits" class="muted small"></span>
            <button class="icon-btn" data-act="cx.zoom" data-f="1.25" title="Zoom +"><i class="fa-solid fa-plus"></i></button>
            <button class="icon-btn" data-act="cx.zoom" data-f="0.8" title="Zoom −"><i class="fa-solid fa-minus"></i></button>
            <button class="icon-btn" data-act="cx.fit" title="Tout afficher"><i class="fa-solid fa-expand"></i></button>
        </div>
        <div class="dg-main"><div id="dg-view" class="dg-view"></div><aside id="dg-side" class="dg-side card"></aside></div>
    </div>`;
    cx.view = new DiagramView(body.querySelector('#dg-view'), d, { onSelect: (id) => { cx.nodeId = id; renderNodeSide(); } });
    if (cx.dq) cx.view.search(cx.dq, body.querySelector('#dg-hits'), false);
    if (cx.nodeId && d.nodes.some((n) => n.id === cx.nodeId)) { cx.view.select(cx.nodeId); cx.view.focus(cx.nodeId); } else cx.nodeId = null;
    renderNodeSide();
}

function renderNodeSide() {
    const side = cx.el?.querySelector('#dg-side');
    if (!side) return;
    const d = store.state.lore?.diagrams.find((x) => x.id === cx.diagramId);
    const n = d?.nodes.find((x) => x.id === cx.nodeId);
    if (!n) {
        side.innerHTML = `<p class="muted small">Glissez pour vous déplacer, molette pour zoomer, cliquez une carte pour lire son détail.</p>
            <p class="muted small">${d ? `${d.nodes.length} nœuds · ${d.edges.length} liens` : ''}</p>`;
        return;
    }
    const label = (id) => { const o = d.nodes.find((x) => x.id === id); return o ? (o.label || o.legend || '…') : '?'; };
    const out = d.edges.filter((e) => e.s === n.id);
    const inc = d.edges.filter((e) => e.t === n.id);
    const rel = (e, other) => `<li><button class="lore-link" data-act="cx.node" data-diagram="${esc(d.id)}" data-id="${esc(other)}">${esc(label(other))}</button>${e.label ? ` <small class="muted">— ${esc(e.label)}</small>` : ''}</li>`;
    side.innerHTML = `${n.legend ? `<small class="dg-legend">${esc(n.legend)}</small>` : ''}<h4>${esc(n.label || '—')}</h4>
        ${n.image && img(n.image) ? `<img class="lore-img" src="${esc(img(n.image))}" alt="">` : ''}
        ${n.desc ? `<p class="pre">${esc(n.desc)}</p>` : ''}
        ${n.page && nameOf(n.page) ? `<button class="btn ghost sm" data-act="cx.page" data-id="${esc(n.page)}"><i class="fa-solid fa-book"></i> Fiche : ${esc(nameOf(n.page))}</button>` : ''}
        ${inc.length ? `<h5 class="mt">Avant / causes</h5><ul class="dg-rel">${inc.map((e) => rel(e, e.s)).join('')}</ul>` : ''}
        ${out.length ? `<h5 class="mt">Ensuite / conséquences</h5><ul class="dg-rel">${out.map((e) => rel(e, e.t)).join('')}</ul>` : ''}`;
}

const EDGE_COLORS = { white: '#ffe873', gray: '#8c8a6c', grey: '#8c8a6c', black: '#6b6b6b' };
const NODE_W = 240;
const PAD = 80;

/** Diagramme Amsel (nœuds positionnés + liens) : HTML pour les cartes, SVG pour les liens, pan / zoom maison. */
class DiagramView {
    constructor(el, diagram, { onSelect }) {
        this.el = el;
        this.d = diagram;
        this.onSelect = onSelect;
        this.k = 1; this.tx = 0; this.ty = 0;
        this.hits = []; this.hitIdx = -1;
        const xs = diagram.nodes.map((n) => n.x), ys = diagram.nodes.map((n) => n.y);
        this.ox = Math.min(0, ...xs) - PAD;
        this.oy = Math.min(0, ...ys) - PAD;
        el.innerHTML = `<div class="dg-world"><svg class="dg-edges"></svg>${diagram.nodes.map((n) => `
            <div class="dg-node ${n.kind}" data-node="${esc(n.id)}" style="left:${n.x - this.ox}px;top:${n.y - this.oy}px">
                ${n.legend ? `<small>${esc(n.legend)}</small>` : ''}
                ${n.kind === 'image' && img(n.image) ? `<img src="${esc(img(n.image))}" alt="" draggable="false">` : ''}
                ${n.label ? `<b>${esc(n.label)}</b>` : ''}
                ${n.desc ? `<p>${esc(n.desc.length > 160 ? n.desc.slice(0, 159) + '…' : n.desc)}</p>` : ''}
                ${n.page ? '<i class="fa-solid fa-book dg-has-page" title="Liée à une fiche"></i>' : ''}
            </div>`).join('')}</div>`;
        this.world = el.querySelector('.dg-world');
        this.svg = el.querySelector('.dg-edges');
        this.nodes = new Map([...el.querySelectorAll('.dg-node')].map((n) => [n.dataset.node, n]));
        // Les images changent la hauteur des cartes : on retrace les liens une fois chargées.
        el.querySelectorAll('.dg-node img').forEach((i) => i.addEventListener('load', () => this.drawEdges(), { once: true }));
        this.drawEdges();
        this.bind();
        requestAnimationFrame(() => this.fit());
    }

    box(id) {
        const n = this.d.nodes.find((x) => x.id === id);
        const el = this.nodes.get(id);
        if (!n || !el) return null;
        return { x: n.x - this.ox, y: n.y - this.oy, w: el.offsetWidth || NODE_W, h: el.offsetHeight || 60 };
    }

    drawEdges() {
        let W = 0, H = 0;
        for (const id of this.nodes.keys()) { const b = this.box(id); if (b) { W = Math.max(W, b.x + b.w + PAD); H = Math.max(H, b.y + b.h + PAD); } }
        this.W = W; this.H = H;
        this.world.style.width = `${W}px`;
        this.world.style.height = `${H}px`;
        const pt = (b, side) => ({ left: [b.x, b.y + b.h / 2, -1, 0], right: [b.x + b.w, b.y + b.h / 2, 1, 0], top: [b.x + b.w / 2, b.y, 0, -1], bottom: [b.x + b.w / 2, b.y + b.h, 0, 1] }[side] || [b.x + b.w, b.y + b.h / 2, 1, 0]);
        const paths = [], labels = [];
        for (const e of this.d.edges) {
            const a = this.box(e.s), b = this.box(e.t);
            if (!a || !b) continue;
            const [x1, y1, dx1, dy1] = pt(a, e.sh), [x2, y2, dx2, dy2] = pt(b, e.th);
            const k = Math.max(40, Math.hypot(x2 - x1, y2 - y1) * 0.35);
            const c1 = [x1 + dx1 * k, y1 + dy1 * k], c2 = [x2 + dx2 * k, y2 + dy2 * k];
            const color = EDGE_COLORS[e.color] || e.color || '#ffe873';
            const dash = e.dash === 'dotted' ? '2 7' : e.dash === 'dashed' ? '10 7' : '';
            paths.push(`<path data-edge="${esc(e.id)}" data-s="${esc(e.s)}" data-t="${esc(e.t)}" d="M${x1},${y1} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${x2},${y2}" stroke="${esc(color)}" stroke-width="${e.width}" ${dash ? `stroke-dasharray="${dash}"` : ''} marker-end="url(#dg-arrow)"/>`);
            if (e.label) {
                const mx = (x1 + 3 * c1[0] + 3 * c2[0] + x2) / 8, my = (y1 + 3 * c1[1] + 3 * c2[1] + y2) / 8;
                labels.push(`<text x="${mx}" y="${my}">${esc(e.label.length > 48 ? e.label.slice(0, 47) + '…' : e.label)}</text>`);
            }
        }
        this.svg.setAttribute('width', W);
        this.svg.setAttribute('height', H);
        this.svg.innerHTML = `<defs><marker id="dg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#ffd900"/></marker></defs>
            <g class="dg-paths">${paths.join('')}</g><g class="dg-labels">${labels.join('')}</g>`;
    }

    apply() { this.world.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.k})`; }

    fit() {
        const r = this.el.getBoundingClientRect();
        if (!r.width || !this.W) return;
        this.k = Math.min(1, Math.max(0.03, Math.min(r.width / this.W, r.height / this.H)));
        this.tx = (r.width - this.W * this.k) / 2;
        this.ty = (r.height - this.H * this.k) / 2;
        this.apply();
    }

    zoomAt(f, cx, cy) {
        const k = Math.min(2.5, Math.max(0.03, this.k * f));
        this.tx = cx - (cx - this.tx) * (k / this.k);
        this.ty = cy - (cy - this.ty) * (k / this.k);
        this.k = k;
        this.apply();
    }

    zoom(f) { const r = this.el.getBoundingClientRect(); this.zoomAt(f, r.width / 2, r.height / 2); }

    focus(id) {
        const b = this.box(id);
        if (!b) return;
        const r = this.el.getBoundingClientRect();
        this.k = Math.max(this.k, 0.8);
        this.tx = r.width / 2 - (b.x + b.w / 2) * this.k;
        this.ty = r.height / 2 - (b.y + b.h / 2) * this.k;
        this.world.classList.add('dg-anim');
        this.apply();
        setTimeout(() => this.world?.classList.remove('dg-anim'), 350);
    }

    select(id) {
        this.nodes.forEach((n, k) => n.classList.toggle('sel', k === id));
        this.svg.querySelectorAll('path[data-edge]').forEach((p) => p.classList.toggle('sel', p.dataset.s === id || p.dataset.t === id));
    }

    /** Surligne les nœuds correspondants ; `next` = centre sur le résultat suivant. */
    search(q, out, next) {
        const t = q.trim().toLowerCase();
        if (!next || t !== this.lastQ) {
            this.lastQ = t;
            this.hits = t ? this.d.nodes.filter((n) => `${n.label} ${n.legend} ${n.desc}`.toLowerCase().includes(t)).map((n) => n.id) : [];
            this.hitIdx = -1;
            const set = new Set(this.hits);
            this.nodes.forEach((n, k) => { n.classList.toggle('hit', set.has(k)); n.classList.toggle('dim', !!t && !set.has(k)); });
        }
        if (out) out.textContent = t ? `${this.hits.length} résultat${this.hits.length > 1 ? 's' : ''}` : '';
        if (next && this.hits.length) {
            this.hitIdx = (this.hitIdx + 1) % this.hits.length;
            const id = this.hits[this.hitIdx];
            this.select(id);
            this.focus(id);
            this.onSelect?.(id);
            if (out) out.textContent = `${this.hitIdx + 1} / ${this.hits.length}`;
        }
    }

    bind() {
        const el = this.el;
        let drag = null;
        el.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            drag = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: false, node: e.target.closest('.dg-node')?.dataset.node };
            el.setPointerCapture(e.pointerId);
        });
        el.addEventListener('pointermove', (e) => {
            if (!drag) return;
            const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
            if (!drag.moved && Math.hypot(dx, dy) < 4) return;
            drag.moved = true;
            el.classList.add('dragging');
            this.tx = drag.tx + dx;
            this.ty = drag.ty + dy;
            this.apply();
        });
        const up = () => {
            if (drag && !drag.moved && drag.node) { this.select(drag.node); this.onSelect?.(drag.node); }
            drag = null;
            el.classList.remove('dragging');
        };
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
        el.addEventListener('wheel', (e) => {
            e.preventDefault();
            const r = el.getBoundingClientRect();
            this.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
        }, { passive: false });
        this.ro = new ResizeObserver(() => { if (!this.fitted) { this.fitted = true; this.fit(); } });
        this.ro.observe(el);
    }

    destroy() {
        this.ro?.disconnect();
        this.el.innerHTML = '';
        this.world = null;
    }
}

// ---------------------------------------------------------------- Saisie (recherche) et actions
document.addEventListener('input', (e) => {
    const k = e.target.dataset?.cx;
    if (!k || !cx.el?.contains(e.target)) return;
    if (k === 'q') {
        cx.q = e.target.value;
        const list = cx.el.querySelector('#cx-list');
        if (list) list.innerHTML = listHtml(store.state.lore);
    } else if (k === 'dq') {
        cx.dq = e.target.value;
        cx.view?.search(cx.dq, cx.el.querySelector('#dg-hits'), false);
    }
});
document.addEventListener('change', (e) => {
    if (e.target.dataset?.cx !== 'diagram' || !cx.el?.contains(e.target)) return;
    cx.diagramId = e.target.value;
    cx.nodeId = null;
    renderCodex();
});
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.dataset?.cx !== 'dq') return;
    e.preventDefault();
    cx.view?.search(cx.dq, cx.el.querySelector('#dg-hits'), true);
});

registerActions({
    'cx.tab': (el) => { cx.tab = el.dataset.tab; renderCodex(); },
    'cx.cat': (el) => { cx.cat = el.dataset.cat; renderCodex(); },
    'cx.page': (el) => {
        if (cx.pageId && cx.pageId !== el.dataset.id) cx.history.push(cx.pageId);
        if (cx.history.length > 30) cx.history.shift();
        cx.tab = 'pages';
        cx.pageId = el.dataset.id;
        if (cx.el?.isConnected) {
            renderCodex();
            cx.el.querySelector('#cx-page')?.scrollIntoView({ block: 'start' });
        }
    },
    'cx.back': () => { const id = cx.history.pop(); if (id) { cx.pageId = id; renderCodex(); } },
    'cx.node': (el) => {
        cx.tab = 'diagram';
        cx.diagramId = el.dataset.diagram;
        cx.nodeId = el.dataset.id;
        renderCodex();
    },
    'cx.zoom': (el) => cx.view?.zoom(Number(el.dataset.f)),
    'cx.fit': () => cx.view?.fit(),
    'cx.toDoc': (el) => {
        const s = store.state;
        const p = lorePage(s, el.dataset.id);
        if (!p) return;
        const d = newDocument();
        d.title = p.name;
        d.category = p.category;
        d.text = pageToText(p, nameOf);
        s.documents.push(d);
        store.commit('structure');
        toast(`Document « ${p.name} » créé (non partagé). Relisez-le dans Documents avant de le donner : il peut contenir des secrets.`, 'ok', 6500);
    },
});

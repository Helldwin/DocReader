// Recherche globale MJ (Ctrl+K) : personnages, PNJ, documents, scènes, cartes, lieux, codex,
// boutiques, pistes, tables. La vue active (Planifier ou MJ) fournit la façon d'ouvrir un résultat.
import { store } from './store.js';
import { esc, modal } from './util.js';

let opener = null; // (item) => void
export function setSearchOpener(fn) { opener = fn; }

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function items(state) {
    const out = [];
    const add = (kind, icon, id, label, sub = '', extra = {}) => out.push({ kind, icon, id, label, sub, ...extra });
    state.characters.forEach((c) => add('char', 'fa-user', c.id, c.name, `Personnage${c.player ? ' · ' + c.player : ''}`));
    state.bestiary.forEach((b) => add('bank', 'fa-skull', b.id, b.name, `${b.kind} · banque`));
    state.documents.forEach((d) => add('doc', 'fa-file-lines', d.id, d.title, `Document · ${d.category}`));
    state.scenes.forEach((s) => add('scene', 'fa-clapperboard', s.id, s.title, `Scène${s.session ? ' · session ' + s.session : ''}`));
    state.maps.forEach((m) => {
        add('map', 'fa-map', m.id, m.name, 'Carte');
        m.markers.forEach((k, i) => add('marker', 'fa-location-dot', `${m.id}:${i}`, k.name, `Lieu · ${m.name}`, { mapId: m.id }));
    });
    state.shops.forEach((s) => add('shop', 'fa-store', s.id, s.name, 'Boutique'));
    state.ambience.tracks.forEach((t) => add('track', t.loop ? 'fa-music' : 'fa-bolt', t.id, t.name, t.loop ? 'Musique' : 'Effet'));
    (state.tables || []).forEach((t) => add('table', 'fa-table-list', t.id, t.name, 'Table aléatoire'));
    state.lore?.pages.forEach((p) => add('lore', 'fa-book', p.id, p.name, `Codex · ${p.category}`, { aliases: p.aliases }));
    return out;
}

function match(list, q) {
    const t = fold(q).trim();
    if (!t) return list.slice(0, 30);
    const scored = [];
    for (const it of list) {
        const name = fold(it.label);
        const hay = `${name} ${fold(it.sub)} ${(it.aliases || []).map(fold).join(' ')}`;
        let score = -1;
        if (name.startsWith(t)) score = 3;
        else if (name.includes(t)) score = 2;
        else if (hay.includes(t)) score = 1;
        else if (t.split(/\s+/).every((w) => hay.includes(w))) score = 0.5;
        if (score >= 0) scored.push([score, it]);
    }
    return scored.sort((a, b) => b[0] - a[0] || a[1].label.localeCompare(b[1].label)).slice(0, 30).map((x) => x[1]);
}

export function openSearch() {
    if (!store.state || !opener) return;
    const all = items(store.state);
    const m = modal('Rechercher', `<input class="search-input" placeholder="Nom, lieu, document, page du codex…" autocomplete="off" spellcheck="false">
        <ul class="search-results"></ul><p class="muted small">↑ ↓ pour naviguer · Entrée pour ouvrir · Échap pour fermer</p>`);
    const input = m.el.querySelector('.search-input');
    const ul = m.el.querySelector('.search-results');
    let res = [];
    let sel = 0;
    const draw = () => {
        ul.innerHTML = res.map((it, i) => `<li class="${i === sel ? 'sel' : ''}" data-i="${i}"><i class="fa-solid ${it.icon}"></i><b>${esc(it.label)}</b><small>${esc(it.sub)}</small></li>`).join('')
            || '<li class="muted">Aucun résultat.</li>';
        ul.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    };
    const go = (i) => { const it = res[i]; if (!it) return; m.close(); opener(it); };
    input.addEventListener('input', () => { res = match(all, input.value); sel = 0; draw(); });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { sel = Math.min(res.length - 1, sel + 1); draw(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
        else if (e.key === 'Enter') { go(sel); e.preventDefault(); }
    });
    ul.addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) go(Number(li.dataset.i)); });
    res = match(all, '');
    draw();
    setTimeout(() => input.focus(), 20);
}

document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && ['planner', 'gm'].includes(store.meta.role)) {
        e.preventDefault();
        if (!document.querySelector('.search-input')) openSearch();
    }
});

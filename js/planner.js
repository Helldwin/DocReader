// Vue "Planifier une session" : configure intégralement la campagne avant (ou entre) les sessions.
import { store } from './store.js';
import { registerActions, rerender, tabsHtml } from './ui.js';
import { esc, avatarHtml, pickFile, readDataUrl, loadImage, toast, download, randomCode, uid, confirmBox } from './util.js';
import { newCharacter, newJournalEntry, findChar, DICE_PRESETS, serialize, filename } from './iris-file.js';
import { discordConfigured, currentDiscordUser } from './auth.js';
import { charEditorHtml, docEditorHtml, shopEditorHtml, ambienceHtml } from './editors.js';
import { draftReport, reportRange } from './report.js';
import { writeIris, handleName, fsSupported } from './filesave.js';
import { publishJournal, importPublished, fetchJournal, parseMarkup } from './journal.js';
import { LiveMap } from './map.js';
import { CONFIG } from './config.js';

const SECTIONS = [
    { id: 'campaign', label: 'Campagne', icon: 'fa-flag' },
    { id: 'rules', label: 'Règles & dés', icon: 'fa-dice-d20' },
    { id: 'chars', label: 'Personnages', icon: 'fa-users' },
    { id: 'docs', label: 'Documents', icon: 'fa-folder-open' },
    { id: 'map', label: 'Carte', icon: 'fa-map' },
    { id: 'shops', label: 'Boutiques', icon: 'fa-store' },
    { id: 'ambience', label: 'Ambiance', icon: 'fa-music' },
    { id: 'journal', label: 'Rapports', icon: 'fa-scroll' },
];

const ui = { section: 'campaign', charId: null, journalId: null };
let root = null;
let unsub = null;
let previewMap = null;

export function mountPlanner(el, { onHost, onExit }) {
    root = el;
    ui.onHost = onHost;
    ui.onExit = onExit;
    root.innerHTML = `<div class="planner">
        <header class="topbar">
            <div class="brand"><svg class="sigil" viewBox="0 0 100 100"><polygon points="50,6 94,90 6,90"/><circle cx="50" cy="64" r="17"/><circle cx="50" cy="64" r="5" fill="currentColor"/></svg>
                <div><b>Planifier une session</b><small id="pl-title"></small></div></div>
            <span class="grow"></span>
            <span id="pl-dirty" class="pill"></span>
            <button class="btn ghost" data-act="pl.export"><i class="fa-solid fa-floppy-disk"></i> Enregistrer le .iris</button>
            <button class="icon-btn" data-act="pl.exportCopy" title="Télécharger une copie du .iris"><i class="fa-solid fa-download"></i></button>
            <button class="btn" data-act="pl.host"><i class="fa-solid fa-tower-broadcast"></i> Lancer la session</button>
            <button class="icon-btn" data-act="pl.exit" title="Quitter"><i class="fa-solid fa-power-off"></i></button>
        </header>
        <div class="planner-body">
            <aside id="pl-nav" class="side-nav"></aside>
            <main id="pl-main" class="planner-main"></main>
        </div>
    </div>`;
    unsub = store.on(onStore);
    renderAll();
}

export function unmountPlanner() {
    unsub?.();
    previewMap?.destroy();
    previewMap = null;
}

function onStore(evt) {
    if (!root?.isConnected) return;
    renderHeader();
    if (evt.type === 'structure' || evt.type === 'load') renderMain();
    else if (evt.scope?.startsWith('char:') && evt.path === 'name') renderCharList();
    else if (evt.scope?.startsWith('journal:') && ['title', 'date'].includes(evt.path)) renderJournalList();
    else if (evt.scope?.startsWith('marker:') || evt.scope === 'map') refreshMapPreview();
}

function renderAll() {
    renderHeader();
    root.querySelector('#pl-nav').innerHTML = SECTIONS.map((s) => `<button class="side-link ${s.id === ui.section ? 'active' : ''}" data-act="pl.section" data-tab="${s.id}"><i class="fa-solid ${s.icon}"></i> ${s.label}</button>`).join('');
    renderMain();
}

function renderHeader() {
    const s = store.state;
    root.querySelector('#pl-title').textContent = `${s.meta.title} — session n°${s.meta.sessionNumber}`;
    const d = root.querySelector('#pl-dirty');
    const file = handleName();
    d.textContent = store.dirty ? 'Modifications non enregistrées' : file ? `Enregistré · ${file}` : 'À jour';
    d.className = 'pill ' + (store.dirty ? 'warn' : 'ok');
}

function renderMain() {
    const main = root.querySelector('#pl-main');
    if (ui.section !== 'map') { previewMap?.destroy(); previewMap = null; }
    const fn = { campaign: campaignHtml, rules: rulesHtml, chars: charsHtml, docs: docsHtml, map: mapHtml, shops: shopsHtml, ambience: ambHtml, journal: journalHtml }[ui.section];
    rerender(main, fn());
    if (ui.section === 'map') refreshMapPreview();
}

// ---------------------------------------------------------------- Campagne
function campaignHtml() {
    const s = store.state;
    const u = currentDiscordUser();
    const discord = discordConfigured()
        ? `<label class="span2">ID Discord des MJ autorisés à héberger <small class="muted">(séparés par des virgules — vide = pas de contrôle)</small>
            <input data-bind="gm|discordIds" data-kind="list" value="${esc(s.gm.discordIds.join(', '))}" placeholder="ex : 123456789012345678"></label>
            <p class="span2 muted small">${u ? `Connecté à Discord : <b>${esc(u.name)}</b> (ID ${esc(u.id)}) <button class="btn ghost sm" data-act="pl.addMyDiscord">Ajouter mon ID</button>` : 'Non connecté à Discord : la vérification aura lieu au lancement de la session.'}</p>`
        : `<p class="span2 muted small"><i class="fa-brands fa-discord"></i> Contrôle Discord désactivé (renseignez DISCORD_CLIENT_ID dans js/config.js pour l'activer).</p>`;
    return `<h2>Campagne</h2>
    <section class="card grid2">
        <label class="span2">Titre de la campagne<input data-bind="meta|title" value="${esc(s.meta.title)}"></label>
        <label>Numéro de la prochaine session<input type="number" min="1" data-bind="meta|sessionNumber" value="${esc(s.meta.sessionNumber)}"></label>
        <label>Nom du MJ<input data-bind="gm|name" value="${esc(s.gm.name)}"></label>
        <label>Monnaie du jeu<input data-bind="rules|currency" value="${esc(s.rules.currency)}"></label>
        <label class="check"><input type="checkbox" data-bind="rules|partyHpVisible" ${s.rules.partyHpVisible ? 'checked' : ''}> Les joueurs voient les PV du groupe</label>
        <label class="span2">Notes de préparation (privées)<textarea rows="5" data-bind="meta|notes">${esc(s.meta.notes)}</textarea></label>
    </section>
    <h3>Accès</h3>
    <section class="card grid2">
        <div><span class="lbl">Code de session</span><div class="row"><b class="code-big">${esc(s.session.code)}</b>
            <button class="btn ghost sm" data-act="pl.newCode"><i class="fa-solid fa-rotate"></i> Nouveau code</button></div>
            <p class="muted small">Les joueurs rejoignent avec ce code. Il est conservé dans le .iris : d'une session à l'autre, il ne change pas.</p></div>
        <div><span class="lbl">Attributions mémorisées</span><p>${Object.keys(s.session.assignments).length} navigateur(s) joueur reconnu(s).</p>
            <button class="btn ghost sm" data-act="pl.resetAssign"><i class="fa-solid fa-eraser"></i> Oublier les attributions</button></div>
        ${discord}
    </section>`;
}

// ---------------------------------------------------------------- Règles
function rulesHtml() {
    const s = store.state;
    const d = s.rules.dice;
    const stats = s.rules.stats.map((st, i) => `<tr>
        <td><input data-bind="stat:${i}|label" value="${esc(st.label)}"></td>
        <td class="w-key"><input class="mono" value="${esc(st.key)}" data-act-change="pl.statKey" data-index="${i}"></td>
        <td class="w-act"><button class="icon-btn danger" data-act="pl.delStat" data-index="${i}" title="Supprimer"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('');
    return `<h2>Règles & dés</h2>
    <section class="card">
        <h4>Statistiques des personnages</h4>
        <table class="table"><thead><tr><th>Libellé</th><th>Code</th><th></th></tr></thead><tbody>${stats}</tbody></table>
        <form class="row mt" data-submit="pl.addStat"><input name="label" placeholder="Nouvelle statistique (ex : Discrétion)" required class="grow"><button class="btn"><i class="fa-solid fa-plus"></i> Ajouter</button></form>
    </section>
    <section class="card">
        <h4>Système de dés</h4>
        <div class="row wrap">
            <button class="btn ghost sm" data-act="pl.dicePreset" data-preset="under">Préréglage d100 « sous la stat »</button>
            <button class="btn ghost sm" data-act="pl.dicePreset" data-preset="over">Préréglage d20 « + stat vs difficulté »</button>
        </div>
        <div class="grid3 mt">
            <label>Faces du dé<input type="number" min="2" data-bind="dice|sides" data-structure="1" value="${esc(d.sides)}"></label>
            <label>Mode
                <select data-bind="dice|mode" data-structure="1">
                    <option value="under" ${d.mode === 'under' ? 'selected' : ''}>Jet ≤ stat + bonus = réussite</option>
                    <option value="over" ${d.mode === 'over' ? 'selected' : ''}>Jet + stat + bonus ≥ difficulté</option>
                </select></label>
            ${d.mode === 'over' ? `<label>Difficulté par défaut<input type="number" data-bind="dice|defaultDifficulty" value="${esc(d.defaultDifficulty)}"></label>` : '<span></span>'}
            <label>Réussite critique si dé ${d.mode === 'under' ? '≤' : '≥'}<input type="number" data-bind="dice|critSuccess" value="${esc(d.critSuccess)}"></label>
            <label>Échec critique si dé ${d.mode === 'under' ? '≥' : '≤'}<input type="number" data-bind="dice|critFail" value="${esc(d.critFail)}"></label>
        </div>
        <p class="muted small mt">${d.mode === 'under'
        ? `Exemple : stat 60, bonus +10 → réussite si le d${d.sides} fait 70 ou moins.`
        : `Exemple : stat 3, bonus +2, difficulté ${d.defaultDifficulty} → réussite si d${d.sides} + 5 ≥ ${d.defaultDifficulty}.`}</p>
    </section>`;
}

// ---------------------------------------------------------------- Personnages
function charsHtml() {
    const s = store.state;
    if (!ui.charId || !findChar(s, ui.charId)) ui.charId = s.characters[0]?.id || null;
    const c = ui.charId ? findChar(s, ui.charId) : null;
    return `<h2>Personnages</h2>
    <div class="split">
        <div class="split-list"><div id="pl-charlist">${charListHtml()}</div>
            <button class="btn full mt" data-act="pl.addChar"><i class="fa-solid fa-user-plus"></i> Ajouter un personnage</button></div>
        <div class="split-detail">${c ? charEditorHtml(s, c) : '<p class="muted pad">Créez votre premier personnage.</p>'}</div>
    </div>`;
}

function charListHtml() {
    return store.state.characters.map((c) => `<button class="list-item ${c.id === ui.charId ? 'active' : ''}" data-act="pl.pickChar" data-id="${c.id}">
        ${avatarHtml(c)}<span><b>${esc(c.name)}</b><small>${esc(c.player || '—')}</small></span></button>`).join('');
}
function renderCharList() {
    const el = root.querySelector('#pl-charlist');
    if (el) el.innerHTML = charListHtml();
}

// ---------------------------------------------------------------- Documents
function docsHtml() {
    const s = store.state;
    const cats = [...new Set(['Rapport', 'Dossier', 'Lettre', 'Livre', 'Grimoire', 'Artefact', 'Carte', 'Photo', ...s.documents.map((d) => d.category)])];
    return `<h2>Bibliothèque de documents</h2>
    <p class="muted">Les fichiers peuvent être hébergés dans <code>vault/</code> (recommandé pour les gros PDF, chiffrés en .enc) ou importés directement dans le .iris. Donnez l'accès dans la fiche de chaque personnage, ou en direct pendant la session.</p>
    <div class="row wrap mb">
        <button class="btn" data-act="doc.add"><i class="fa-solid fa-plus"></i> Nouveau document</button>
        <button class="btn ghost" data-act="tool.encrypt"><i class="fa-solid fa-lock"></i> Chiffrer un PDF pour vault/</button>
    </div>
    <datalist id="doc-categories">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    ${s.documents.map((d) => docEditorHtml(s, d)).join('') || '<p class="muted">Aucun document.</p>'}`;
}

// ---------------------------------------------------------------- Boutiques & ambiance
function shopsHtml() {
    const s = store.state;
    return `<h2>Boutiques</h2>
    <p class="muted">Marchands, armureries, distributeurs… Ouvrez une boutique (ici ou en direct dans la vue MJ) : les joueurs y achètent eux-mêmes, leur argent est débité automatiquement.</p>
    <div class="row mb"><button class="btn" data-act="shop.add"><i class="fa-solid fa-plus"></i> Nouvelle boutique</button></div>
    ${s.shops.map((sh) => shopEditorHtml(s, sh)).join('') || '<p class="muted">Aucune boutique.</p>'}`;
}

function ambHtml() {
    return `<h2>Ambiance sonore</h2>
    <p class="muted">Pendant la session, le MJ lance une musique (en boucle) ou un effet ponctuel : il est joué chez tous les joueurs et sur la vue spectateur du stream. Ici, ▶ fait un aperçu local.</p>
    ${ambienceHtml(store.state)}`;
}

// ---------------------------------------------------------------- Carte
function mapHtml() {
    const m = store.state.map;
    const isData = m.image.startsWith('data:');
    const markers = m.markers.map((mk, i) => `<tr>
        <td><input data-bind="marker:${i}|name" value="${esc(mk.name)}"></td>
        <td class="w-num"><input type="number" data-bind="marker:${i}|x" value="${esc(mk.x)}"></td>
        <td class="w-num"><input type="number" data-bind="marker:${i}|y" value="${esc(mk.y)}"></td>
        <td><input data-bind="marker:${i}|icon" value="${esc(mk.icon)}" placeholder="fa-location-dot"></td>
        <td><input data-bind="marker:${i}|desc" value="${esc(mk.desc)}"></td>
        <td class="w-act"><button class="icon-btn danger" data-act="pl.delMarker" data-index="${i}"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('');
    return `<h2>Carte du monde</h2>
    <section class="card grid3">
        <label class="span2">Image (chemin du dépôt ou URL)<div class="row">
            <input data-bind="map|image" data-structure="1" value="${isData ? '' : esc(m.image)}" placeholder="${isData ? 'Image importée dans le .iris' : 'vault/Iris_Map.png'}" class="grow">
            <button class="btn ghost" data-act="pl.mapImport"><i class="fa-solid fa-file-arrow-up"></i> Importer</button>
            <button class="btn ghost" data-act="pl.mapSize" title="Lire la taille réelle de l'image"><i class="fa-solid fa-ruler-combined"></i> Détecter la taille</button></div></label>
        <div class="row"><label>Largeur px<input type="number" data-bind="map|width" data-structure="1" value="${esc(m.width)}"></label>
        <label>Hauteur px<input type="number" data-bind="map|height" data-structure="1" value="${esc(m.height)}"></label></div>
        <div class="span3 row wrap">
            <button class="btn ghost sm" data-act="pl.importPortalMap"><i class="fa-solid fa-file-import"></i> Reprendre data/carte.json du site</button>
            <span class="muted small">Cliquez sur la carte pour ajouter un lieu.</span></div>
    </section>
    <div id="pl-map" class="map-box"></div>
    <section class="card mt">
        <h4>Lieux</h4>
        <table class="table"><thead><tr><th>Nom</th><th>X</th><th>Y</th><th>Icône FA</th><th>Description</th><th></th></tr></thead><tbody>${markers || '<tr><td colspan="6" class="muted">Aucun lieu.</td></tr>'}</tbody></table>
    </section>`;
}

function refreshMapPreview() {
    const el = root.querySelector('#pl-map');
    if (!el) return;
    if (!previewMap || previewMap.el !== el) {
        previewMap?.destroy();
        previewMap = new LiveMap(el, {
            fogAlpha: 0.55,
            onClick: (x, y) => {
                store.state.map.markers.push({ name: 'Nouveau lieu', x, y, desc: '', icon: '' });
                store.commit('structure');
            },
        });
    }
    previewMap.update(store.state.map, store.state.characters);
}

// ---------------------------------------------------------------- Rapports
function journalHtml() {
    const s = store.state;
    if (!ui.journalId || !s.journal.find((j) => j.id === ui.journalId)) ui.journalId = s.journal[0]?.id || null;
    const j = s.journal.find((x) => x.id === ui.journalId);
    const charOpts = s.characters.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
    const secrets = j ? parseMarkup(j.content).filter((x) => x.secret).length : 0;
    return `<h2>Rapports de session</h2>
    <p class="muted">Résumés consultables à tout moment sur le portail. Les passages censurés sont chiffrés avec la clé du personnage concerné : seul un joueur connecté en session avec ce personnage peut les lire.</p>
    <div class="row wrap mb">
        <button class="btn" data-act="pl.addJournal"><i class="fa-solid fa-plus"></i> Nouveau rapport</button>
        <button class="btn ok" data-act="pl.publish"><i class="fa-solid fa-cloud-arrow-up"></i> Publier → journal.json</button>
        <button class="btn ghost" data-act="pl.importJournal"><i class="fa-solid fa-file-import"></i> Reprendre le journal du site</button>
        <button class="btn ghost" data-act="pl.draft" title="Chronologie des jets, achats et événements de la dernière session"><i class="fa-solid fa-wand-magic-sparkles"></i> Brouillon automatique</button>
    </div>
    <div class="split">
        <div class="split-list" id="pl-journallist">${journalListHtml()}</div>
        <div class="split-detail">${j ? `<section class="card grid3">
            <label>Date<input data-bind="journal:${j.id}|date" value="${esc(j.date)}" placeholder="AAAA-MM-JJ"></label>
            <label class="span2">Titre<input data-bind="journal:${j.id}|title" value="${esc(j.title)}"></label>
            <label class="span3">Mots-clés <small class="muted">(séparés par des virgules)</small><input data-bind="journal:${j.id}|tags" data-kind="tags" value="${esc(j.tags.join(', '))}"></label>
            <div class="span3 row wrap"><span class="lbl">Censurer la sélection pour :</span>
                <select id="pl-secret-char">${charOpts}</select>
                <button class="btn ghost sm" data-act="pl.wrapSecret" data-id="${j.id}" ${charOpts ? '' : 'disabled'}><i class="fa-solid fa-user-secret"></i> Censurer</button>
                <span class="muted small">${secrets} passage(s) censuré(s)</span></div>
            <label class="span3">Contenu<textarea id="pl-journal-content" rows="16" data-bind="journal:${j.id}|content">${esc(j.content)}</textarea></label>
            <p class="span3 muted small">Syntaxe : <code>[[secret:Nom du personnage]]texte réservé[[/secret]]</code></p>
            <div class="span3 row end"><button class="btn bad" data-act="pl.delJournal" data-id="${j.id}"><i class="fa-solid fa-trash"></i> Supprimer ce rapport</button></div>
        </section>` : '<p class="muted pad">Aucun rapport.</p>'}</div>
    </div>`;
}

function journalListHtml() {
    return [...store.state.journal].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((j) => `<button class="list-item ${j.id === ui.journalId ? 'active' : ''}" data-act="pl.pickJournal" data-id="${j.id}">
        <i class="fa-solid fa-file-lines"></i><span><b>${esc(j.title || 'Sans titre')}</b><small>${esc(j.date)}</small></span></button>`).join('') || '<p class="muted">—</p>';
}
function renderJournalList() {
    const el = root.querySelector('#pl-journallist');
    if (el) el.innerHTML = journalListHtml();
}

// ---------------------------------------------------------------- Actions
registerActions({
    'pl.section': (el) => { ui.section = el.dataset.tab; renderAll(); },
    'pl.exit': () => ui.onExit?.(),
    'pl.host': () => ui.onHost?.(),
    'pl.export': () => exportIris(),
    'pl.exportCopy': () => exportIris({ copy: true }),
    'pl.draft': () => {
        const s = store.state;
        const j = draftReport(s, reportRange(s));
        if (j.content.includes('(brouillon automatique, 0 événement')) toast('Aucun événement enregistré pour la dernière session : chronologie vide.', 'warn');
        s.journal.push(j);
        ui.journalId = j.id;
        store.commit('structure');
    },
    'pl.newCode': async () => {
        if (!(await confirmBox('Les joueurs devront utiliser le nouveau code. Continuer ?'))) return;
        store.state.session.code = randomCode();
        store.commit('structure');
    },
    'pl.resetAssign': () => { store.state.session.assignments = {}; store.commit('structure'); },
    'pl.addMyDiscord': () => {
        const u = currentDiscordUser();
        if (!u) return;
        const ids = new Set(store.state.gm.discordIds);
        ids.add(u.id);
        store.state.gm.discordIds = [...ids];
        store.commit('structure');
    },

    'pl.addStat': (form) => {
        const label = form.label.value.trim();
        const s = store.state;
        let key = label.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase() || 'STA';
        while (s.rules.stats.some((x) => x.key === key)) key = key.slice(0, 2) + Math.floor(Math.random() * 10);
        s.rules.stats.push({ key, label });
        for (const c of s.characters) c.stats[key] ??= 0;
        store.commit('structure');
    },
    'pl.delStat': async (el) => {
        const s = store.state;
        const st = s.rules.stats[Number(el.dataset.index)];
        if (!st || !(await confirmBox(`Supprimer la statistique « ${st.label} » de tous les personnages ?`, 'Supprimer'))) return;
        s.rules.stats.splice(Number(el.dataset.index), 1);
        for (const c of s.characters) delete c.stats[st.key];
        store.commit('structure');
    },
    'pl.dicePreset': (el) => {
        store.state.rules.dice = { ...DICE_PRESETS[el.dataset.preset] };
        store.commit('structure');
        toast('Préréglage appliqué. Pensez à ajuster les statistiques des personnages.', 'info', 4500);
    },

    'pl.pickChar': (el) => { ui.charId = el.dataset.id; renderMain(); },
    'pl.addChar': () => {
        const c = newCharacter(store.state, `Agent ${store.state.characters.length + 1}`);
        store.state.characters.push(c);
        ui.charId = c.id;
        store.commit('structure');
    },

    'pl.mapImport': async () => {
        const f = await pickFile('image/*');
        if (!f) return;
        const url = await readDataUrl(f);
        const img = await loadImage(url);
        Object.assign(store.state.map, { image: url, width: img.naturalWidth, height: img.naturalHeight });
        store.commit('structure');
    },
    'pl.mapSize': async () => {
        const m = store.state.map;
        const img = await loadImage(m.image);
        m.width = img.naturalWidth;
        m.height = img.naturalHeight;
        store.commit('structure');
        toast(`Taille détectée : ${m.width} × ${m.height}`, 'ok');
    },
    'pl.importPortalMap': async () => {
        const res = await fetch('data/carte.json', { cache: 'no-cache' });
        if (!res.ok) throw new Error('data/carte.json introuvable.');
        const c = await res.json();
        Object.assign(store.state.map, { image: c.image || '', width: c.width || 0, height: c.height || 0, markers: (c.markers || []).map((m) => ({ name: m.name || '', x: m.x || 0, y: m.y || 0, desc: m.desc || '', icon: m.icon || '' })) });
        store.commit('structure');
        toast('Carte du portail importée.', 'ok');
    },
    'pl.delMarker': (el) => { store.state.map.markers.splice(Number(el.dataset.index), 1); store.commit('structure'); },

    'pl.addJournal': () => {
        const j = newJournalEntry();
        j.title = `Session ${store.state.meta.sessionNumber}`;
        store.state.journal.push(j);
        ui.journalId = j.id;
        store.commit('structure');
    },
    'pl.pickJournal': (el) => { ui.journalId = el.dataset.id; renderMain(); },
    'pl.delJournal': async (el) => {
        if (!(await confirmBox('Supprimer ce rapport ?', 'Supprimer'))) return;
        store.state.journal = store.state.journal.filter((j) => j.id !== el.dataset.id);
        store.commit('structure');
    },
    'pl.wrapSecret': (el) => {
        const ta = root.querySelector('#pl-journal-content');
        const who = root.querySelector('#pl-secret-char').value;
        const { selectionStart: a, selectionEnd: b, value } = ta;
        const inner = value.slice(a, b) || 'Texte réservé…';
        ta.value = `${value.slice(0, a)}[[secret:${who}]]${inner}[[/secret]]${value.slice(b)}`;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.focus();
        renderMain();
    },
    'pl.publish': async () => {
        const { entries, warnings } = await publishJournal(store.state);
        download('journal.json', JSON.stringify(entries, null, 2));
        warnings.forEach((w) => toast(w, 'warn', 7000));
        toast('journal.json téléchargé : remplacez data/journal.json dans le dépôt puis poussez (git push).', 'ok', 7000);
    },
    'pl.importJournal': async () => {
        const entries = await fetchJournal(CONFIG.JOURNAL_URL);
        const s = store.state;
        const imported = await importPublished(entries, s.characters, () => uid('j'));
        const known = new Set(s.journal.map((j) => `${j.date}|${j.title}`));
        const fresh = imported.filter((j) => !known.has(`${j.date}|${j.title}`));
        s.journal.push(...fresh);
        store.commit('structure');
        toast(`${fresh.length} rapport(s) importé(s) (${imported.length - fresh.length} déjà présents).`, 'ok');
    },
});

// Changement du code d'une statistique : on migre les valeurs de tous les personnages.
document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset?.actChange !== 'pl.statKey') return;
    const s = store.state;
    const st = s.rules.stats[Number(el.dataset.index)];
    const key = el.value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
    if (!st || !key || key === st.key) { el.value = st?.key || ''; return; }
    if (s.rules.stats.some((x) => x.key === key)) { toast('Ce code existe déjà.', 'error'); el.value = st.key; return; }
    for (const c of s.characters) { c.stats[key] = c.stats[st.key] ?? 0; delete c.stats[st.key]; }
    st.key = key;
    store.commit('structure');
});

/**
 * Enregistre le .iris : directement dans le fichier ouvert (Chrome / Edge),
 * sinon téléchargement d'une copie. copy=true force le téléchargement.
 */
export async function exportIris({ copy = false, quiet = false } = {}) {
    const s = store.state;
    const text = serialize(s);
    if (!copy && fsSupported) {
        try {
            if (await writeIris(text, { suggestedName: filename(s) })) {
                store.markExported();
                store.commit('update');
                if (!quiet) toast(`Enregistré dans « ${handleName()} ».`, 'ok');
                return true;
            }
        } catch (e) {
            if (e.name === 'AbortError') return false;
            console.warn(e);
            toast('Écriture directe impossible : téléchargement d\'une copie.', 'warn');
        }
    }
    download(filename(s), text);
    store.markExported();
    store.commit('update');
    if (!quiet) toast('Fichier .iris téléchargé. Gardez-le précieusement : c\'est votre sauvegarde.', 'ok', 5000);
    return true;
}

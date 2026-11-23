// Vue "Planifier une session" : configure intégralement la campagne avant (ou entre) les sessions.
import { store } from './store.js';
import { registerActions, rerender, tabsHtml } from './ui.js';
import { esc, avatarHtml, pickFile, readDataUrl, loadImage, toast, download, randomCode, uid, confirmBox, modal } from './util.js';
import { newCharacter, newJournalEntry, findChar, findMap, findBank, findScene, findDoc, findTrack, findShop, lorePage, newMap, normalizeBankEntry, normalizeScene, DICE_PRESETS, DEFAULT_STATS, serialize, filename } from './iris-file.js';
import { discordConfigured, currentDiscordUser } from './auth.js';
import { charEditorHtml, docEditorHtml, shopEditorHtml, ambienceHtml, bankEditorHtml } from './editors.js';
import { draftReport, reportRange } from './report.js';
import { writeIris, handleName, fsSupported } from './filesave.js';
import { publishJournal, importPublished, fetchJournal, parseMarkup } from './journal.js';
import { LiveMap } from './map.js';
import { CONFIG } from './config.js';
import { readLoreFile, loreSummary, applyLore } from './lore.js';
import { mountCodex, unmountCodex, showCodexPage } from './codex.js';

const SECTIONS = [
    { id: 'campaign', label: 'Campagne', icon: 'fa-flag' },
    { id: 'rules', label: 'Règles & dés', icon: 'fa-dice-d20' },
    { id: 'chars', label: 'Personnages', icon: 'fa-users' },
    { id: 'bank', label: 'PNJ & créatures', icon: 'fa-skull' },
    { id: 'scenes', label: 'Scénario', icon: 'fa-clapperboard' },
    { id: 'docs', label: 'Documents', icon: 'fa-folder-open' },
    { id: 'map', label: 'Cartes', icon: 'fa-map' },
    { id: 'shops', label: 'Boutiques', icon: 'fa-store' },
    { id: 'ambience', label: 'Ambiance', icon: 'fa-music' },
    { id: 'codex', label: 'Codex & lore', icon: 'fa-book-skull' },
    { id: 'journal', label: 'Rapports', icon: 'fa-scroll' },
];

const ui = { section: 'campaign', charId: null, journalId: null, mapId: null, bankId: null, sceneId: null, cxLore: undefined };
let root = null;
let unsub = null;
let previewMap = null;
let loreSrc = null;   // .lore en cours d'import
let loreModal = null;

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
    unmountCodex();
    ui.cxLore = undefined;
}

function onStore(evt) {
    if (!root?.isConnected) return;
    renderHeader();
    if (evt.type === 'structure' || evt.type === 'load') renderMain();
    else if (evt.scope?.startsWith('char:') && evt.path === 'name') renderCharList();
    else if (evt.scope?.startsWith('journal:') && ['title', 'date'].includes(evt.path)) renderJournalList();
    else if (evt.scope?.startsWith('bank:') && ['name', 'kind'].includes(evt.path)) renderBankList();
    else if (evt.scope?.startsWith('scene:') && ['title', 'session', 'done'].includes(evt.path)) renderSceneList();
    else if (evt.scope?.startsWith('map:') && evt.path === 'name') renderMapChips();
    else if (evt.scope?.startsWith('marker:') || evt.scope?.startsWith('map')) refreshMapPreview();
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
    if (ui.section !== 'codex') { unmountCodex(); ui.cxLore = undefined; }
    // Codex : on ne redessine que si le lore a changé (le zoom du diagramme est conservé).
    else if (ui.cxLore === store.state.lore && main.querySelector('#cx-root')) return;
    const fn = { campaign: campaignHtml, rules: rulesHtml, chars: charsHtml, bank: bankHtml, scenes: scenesHtml, docs: docsHtml, map: mapHtml, shops: shopsHtml, ambience: ambHtml, codex: codexHtml, journal: journalHtml }[ui.section];
    rerender(main, fn());
    if (ui.section === 'map') refreshMapPreview();
    if (ui.section === 'codex') { ui.cxLore = store.state.lore; mountCodex(main.querySelector('#cx-root'), { force: true }); }
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
    ${prepHtml()}
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

/** Check-list de la prochaine session : ce qui est prêt, ce qui manque. */
function prepHtml() {
    const s = store.state;
    const n = s.meta.sessionNumber;
    const scenes = s.scenes.filter((sc) => sc.session === n);
    const mapsOk = s.maps.filter((m) => m.image).length;
    const item = (ok, text, section, hint = '') => `<li class="${ok ? 'ok' : 'warn'}"><i class="fa-solid ${ok ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i>
        <span class="grow">${text}${hint ? ` <small class="muted">${hint}</small>` : ''}</span><button class="btn ghost sm" data-act="pl.section" data-tab="${section}">Ouvrir</button></li>`;
    return `<h3>Préparation de la session n°${esc(n)}</h3>
    <section class="card"><ul class="prep-list">
        ${item(s.characters.length > 0, `${s.characters.length} personnage(s)`, 'chars')}
        ${item(scenes.length > 0, `${scenes.length} scène(s) prévue(s) pour cette session`, 'scenes', scenes.length ? esc(scenes.map((x) => x.title).join(' · ')) : 'Préparez le déroulé : carte, musique, documents et PNJ se lancent d\'un clic.')}
        ${item(mapsOk > 0, `${mapsOk} carte(s) prête(s) sur ${s.maps.length}`, 'map', `Active : ${esc(s.map.name)}`)}
        ${item(s.bestiary.length > 0, `${s.bestiary.length} fiche(s) PNJ / créature`, 'bank')}
        ${item(s.documents.length > 0, `${s.documents.length} document(s)`, 'docs')}
        ${item(s.ambience.tracks.length > 0, `${s.ambience.tracks.length} piste(s) d'ambiance`, 'ambience')}
        ${item(!!s.lore, s.lore ? `Codex : ${s.lore.pages.length} pages, ${s.lore.diagrams.length} diagramme(s)` : 'Aucun lore importé', 'codex', s.lore ? '' : 'Importez votre .lore Amsel Suite.')}
    </ul></section>`;
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
        <h4>Fiche d'identité</h4>
        <label>Champs proposés sur chaque fiche <small class="muted">(séparés par des virgules — visibles des joueurs)</small>
            <input data-bind="rules|fieldPresets" data-kind="tags" value="${esc(s.rules.fieldPresets.join(', '))}" placeholder="Titre, Âge, Profession, Force, Dextérité…"></label>
        <p class="muted small">Ajoutés automatiquement aux nouveaux personnages ; bouton « Champs de la campagne » sur les fiches existantes.</p>
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
const plMap = () => {
    const s = store.state;
    if (!findMap(s, ui.mapId)) ui.mapId = s.activeMapId;
    return findMap(s, ui.mapId) || s.map;
};

function mapChipsHtml() {
    const s = store.state;
    const cur = plMap();
    return s.maps.map((x) => `<button class="chip ${x.id === cur.id ? 'on' : ''}" data-act="pl.pickMap" data-id="${x.id}">${x.id === s.activeMapId ? '<i class="fa-solid fa-star" title="Carte active"></i> ' : ''}${esc(x.name)}</button>`).join('');
}
function renderMapChips() {
    const el = root.querySelector('#pl-mapchips');
    if (el) el.innerHTML = mapChipsHtml();
}

function mapHtml() {
    const s = store.state;
    const m = plMap();
    const M = `map:${m.id}`;
    const isData = m.image.startsWith('data:');
    const markers = m.markers.map((mk, i) => `<tr>
        <td><input data-bind="marker:${m.id}:${i}|name" value="${esc(mk.name)}"></td>
        <td class="w-num"><input type="number" data-bind="marker:${m.id}:${i}|x" value="${esc(mk.x)}"></td>
        <td class="w-num"><input type="number" data-bind="marker:${m.id}:${i}|y" value="${esc(mk.y)}"></td>
        <td><input data-bind="marker:${m.id}:${i}|icon" value="${esc(mk.icon)}" placeholder="fa-location-dot"></td>
        <td><input data-bind="marker:${m.id}:${i}|desc" value="${esc(mk.desc)}"></td>
        <td class="w-act">${mk.loreId && lorePage(s, mk.loreId) ? `<button class="icon-btn" data-act="pl.codexPage" data-id="${esc(mk.loreId)}" title="Fiche du codex"><i class="fa-solid fa-book"></i></button>` : ''}</td>
        <td class="w-act"><button class="icon-btn danger" data-act="pl.delMarker" data-index="${i}"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('');
    const active = m.id === s.activeMapId;
    return `<h2>Cartes</h2>
    <p class="muted">Préparez autant de cartes que nécessaire (monde, région, ville, donjon, plan d'un bâtiment…). Chacune a ses lieux, ses jetons, ses PNJ et son brouillard.
        La carte <i class="fa-solid fa-star"></i> active est celle que voient les joueurs quand vous l'affichez ; en session, on change de carte d'un clic (ou via une scène).</p>
    <div class="row wrap mb"><div class="chips grow" id="pl-mapchips">${mapChipsHtml()}</div>
        <button class="btn sm" data-act="pl.addMap"><i class="fa-solid fa-plus"></i> Nouvelle carte</button></div>
    <section class="card grid3">
        <label>Nom de la carte<input data-bind="${M}|name" value="${esc(m.name)}"></label>
        <div class="row wrap span2">${active ? '<span class="pill ok"><i class="fa-solid fa-star"></i> Carte active (vue par les joueurs)</span>'
        : `<button class="btn ghost sm" data-act="pl.activeMap" data-id="${m.id}"><i class="fa-solid fa-star"></i> Définir comme carte active</button>`}
            <span class="grow"></span>
            <button class="btn ghost sm" data-act="pl.dupMap" data-id="${m.id}" title="Copie (image + lieux, sans jetons)"><i class="fa-solid fa-clone"></i> Dupliquer</button>
            ${s.maps.length > 1 ? `<button class="btn bad sm" data-act="pl.delMap" data-id="${m.id}"><i class="fa-solid fa-trash"></i> Supprimer</button>` : ''}</div>
        <label class="span2">Image (chemin du dépôt ou URL)<div class="row">
            <input data-bind="${M}|image" data-structure="1" value="${isData ? '' : esc(m.image)}" placeholder="${isData ? `Image importée dans le .iris (${Math.round(m.image.length / 1365)} Ko)` : 'vault/Iris_Map.png'}" class="grow">
            <button class="btn ghost" data-act="pl.mapImport"><i class="fa-solid fa-file-arrow-up"></i> Importer</button>
            <button class="btn ghost" data-act="pl.mapSize" title="Lire la taille réelle de l'image"><i class="fa-solid fa-ruler-combined"></i> Détecter la taille</button></div></label>
        <div class="row"><label>Largeur px<input type="number" data-bind="${M}|width" data-structure="1" value="${esc(m.width)}"></label>
        <label>Hauteur px<input type="number" data-bind="${M}|height" data-structure="1" value="${esc(m.height)}"></label></div>
        <div class="span3 row wrap">
            <button class="btn ghost sm" data-act="pl.importPortalMap"><i class="fa-solid fa-file-import"></i> Reprendre data/carte.json du site</button>
            <span class="muted small">Cliquez sur la carte pour ajouter un lieu.${m.npcs.length ? ` ${m.npcs.length} PNJ posé(s) sur cette carte.` : ''}</span></div>
    </section>
    <div id="pl-map" class="map-box"></div>
    <section class="card mt">
        <h4>Lieux</h4>
        <table class="table"><thead><tr><th>Nom</th><th>X</th><th>Y</th><th>Icône FA</th><th>Description (visible des joueurs)</th><th></th><th></th></tr></thead><tbody>${markers || '<tr><td colspan="7" class="muted">Aucun lieu.</td></tr>'}</tbody></table>
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
                plMap().markers.push({ name: 'Nouveau lieu', x, y, desc: '', icon: '', loreId: '' });
                store.commit('structure');
            },
        });
    }
    previewMap.update(plMap(), store.state.characters);
}

// ---------------------------------------------------------------- Banque PNJ / créatures
function bankHtml() {
    const s = store.state;
    if (!findBank(s, ui.bankId)) ui.bankId = s.bestiary[0]?.id || null;
    const b = findBank(s, ui.bankId);
    return `<h2>PNJ & créatures</h2>
    <p class="muted">Fiches réutilisables : en session, posez-les sur n'importe quelle carte (plusieurs exemplaires possibles), suivez leurs PV, consultez leurs notes. Une scène peut les poser automatiquement (masqués).</p>
    <div class="split">
        <div class="split-list"><div id="pl-banklist">${bankListHtml()}</div>
            <button class="btn full mt" data-act="pl.addBank"><i class="fa-solid fa-plus"></i> Nouvelle fiche</button></div>
        <div class="split-detail">${b ? bankEditorHtml(s, b) : '<p class="muted pad">Aucune fiche. Créez-en une, ou importez vos fiches PNJ depuis un .lore (Codex & lore).</p>'}</div>
    </div>`;
}
function bankListHtml() {
    const groups = new Map();
    for (const b of store.state.bestiary) { if (!groups.has(b.kind)) groups.set(b.kind, []); groups.get(b.kind).push(b); }
    return [...groups].map(([k, list]) => `<h5 class="cx-cat">${esc(k)} <small>${list.length}</small></h5>` + list.map((b) => `<button class="list-item ${b.id === ui.bankId ? 'active' : ''}" data-act="pl.pickBank" data-id="${b.id}">
        ${avatarHtml(b)}<span><b>${esc(b.name)}</b><small>PV ${esc(b.hpMax)}</small></span></button>`).join('')).join('');
}
function renderBankList() {
    const el = root.querySelector('#pl-banklist');
    if (el) el.innerHTML = bankListHtml();
}

// ---------------------------------------------------------------- Scénario (scènes)
function scenesHtml() {
    const s = store.state;
    if (!findScene(s, ui.sceneId)) ui.sceneId = s.scenes.find((x) => x.session === s.meta.sessionNumber)?.id || s.scenes[0]?.id || null;
    const sc = findScene(s, ui.sceneId);
    return `<h2>Scénario</h2>
    <p class="muted">Découpez chaque session en scènes. En jeu (onglet <b>Scènes</b> de la vue MJ), « Lancer » applique tout d'un coup : carte affichée, musique, document à l'écran, documents remis aux présents, boutiques ouvertes, PNJ posés masqués. Les notes restent sous vos yeux.</p>
    <div class="split">
        <div class="split-list"><div id="pl-scenelist">${sceneListHtml()}</div>
            <button class="btn full mt" data-act="pl.addScene"><i class="fa-solid fa-plus"></i> Nouvelle scène (session ${esc(s.meta.sessionNumber)})</button></div>
        <div class="split-detail">${sc ? sceneEditorHtml(s, sc) : '<p class="muted pad">Aucune scène. Créez la première scène de la prochaine session.</p>'}</div>
    </div>`;
}

function sceneListHtml() {
    const s = store.state;
    const sessions = [...new Set(s.scenes.map((x) => x.session))].sort((a, b) => (a || 1e9) - (b || 1e9));
    return sessions.map((n) => `<h5 class="cx-cat">${n ? `Session ${esc(n)}${n === s.meta.sessionNumber ? ' <small>(prochaine)</small>' : ''}` : 'Non planifiées'}</h5>`
        + s.scenes.filter((x) => x.session === n).map((x) => `<button class="list-item ${x.id === ui.sceneId ? 'active' : ''} ${x.done ? 'is-done' : ''}" data-act="pl.pickScene" data-id="${x.id}">
            <i class="fa-solid ${x.done ? 'fa-circle-check' : 'fa-clapperboard'}"></i><span><b>${esc(x.title)}</b><small>${esc(sceneTags(s, x).join(' · ') || '—')}</small></span></button>`).join('')).join('') || '<p class="muted small">—</p>';
}
function renderSceneList() {
    const el = root.querySelector('#pl-scenelist');
    if (el) el.innerHTML = sceneListHtml();
}

/** Résumé court de ce qu'une scène déclenche. */
export function sceneTags(s, sc) {
    const t = [];
    const m = findMap(s, sc.mapId); if (m) t.push(`🗺 ${m.name}`);
    const tr = findTrack(s, sc.trackId); if (tr) t.push(`♪ ${tr.name}`);
    const d = findDoc(s, sc.docId); if (d) t.push(`📄 ${d.title}`);
    if (sc.npcs.length) t.push(`☠ ${sc.npcs.length}`);
    return t;
}

function sceneEditorHtml(s, sc) {
    const S = `scene:${sc.id}`;
    const sel = (field, items, label, empty) => `<label>${label}<select data-bind="${S}|${field}" data-structure="1"><option value="">${empty}</option>
        ${items.map(([id, name]) => `<option value="${esc(id)}" ${sc[field] === id ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>`;
    const chips = (field, items, empty) => (items.length ? `<div class="chips">${items.map(([id, name]) => `<button class="chip ${sc[field].includes(id) ? 'on' : ''}" data-act="pl.sceneToggle" data-id="${sc.id}" data-field="${field}" data-val="${esc(id)}">${esc(name)}</button>`).join('')}</div>` : `<p class="muted small">${empty}</p>`);
    const pages = s.lore ? [...s.lore.pages].sort((a, b) => a.name.localeCompare(b.name)) : [];
    const idx = s.scenes.indexOf(sc);
    return `<section class="card grid3">
        <label class="span2">Titre<input data-bind="${S}|title" value="${esc(sc.title)}"></label>
        <label>Session n°<input type="number" min="0" data-bind="${S}|session" value="${esc(sc.session)}" title="0 = non planifiée"></label>
        <label class="span3">Déroulé / notes MJ <small class="muted">(ce qui se passe, descriptions à lire, réactions des PNJ…)</small><textarea rows="8" data-bind="${S}|summary">${esc(sc.summary)}</textarea></label>
        <label class="span3">Objectifs, indices, issues possibles<textarea rows="4" data-bind="${S}|goals">${esc(sc.goals)}</textarea></label>
        <label class="check span3"><input type="checkbox" data-bind="${S}|done" ${sc.done ? 'checked' : ''}> Scène jouée</label>
    </section>
    <h3>Au lancement de la scène</h3>
    <section class="card grid3">
        ${sel('mapId', s.maps.map((m) => [m.id, m.name]), 'Carte', '— ne pas changer —')}
        <label class="check"><input type="checkbox" data-bind="${S}|shareMap" ${sc.shareMap ? 'checked' : ''}> Afficher la carte aux joueurs</label>
        ${sel('trackId', s.ambience.tracks.map((t) => [t.id, `${t.loop ? '♪' : '⚡'} ${t.name}`]), 'Musique / effet', '— aucun —')}
        ${sel('docId', s.documents.map((d) => [d.id, d.title]), 'Document montré à tous', '— aucun —')}
        <div class="span3"><span class="lbl">Documents remis aux personnages présents</span>${chips('grantDocs', s.documents.map((d) => [d.id, d.title]), 'Aucun document dans la bibliothèque.')}</div>
        <div class="span3"><span class="lbl">PNJ / créatures posés (masqués) sur la carte</span>${chips('npcs', s.bestiary.map((b) => [b.id, b.name]), 'Banque vide (section PNJ & créatures).')}</div>
        <div class="span3"><span class="lbl">Boutiques ouvertes</span>${chips('shopIds', s.shops.map((x) => [x.id, x.name]), 'Aucune boutique.')}</div>
    </section>
    <h3>Références</h3>
    <section class="card">
        ${s.lore ? `<div class="chips">${sc.codex.map((id) => { const p = lorePage(s, id); return p ? `<span class="chip on"><button class="lore-link" data-act="pl.codexPage" data-id="${esc(id)}">${esc(p.name)}</button>
            <button class="chip-x" data-act="pl.sceneToggle" data-id="${sc.id}" data-field="codex" data-val="${esc(id)}" title="Retirer">×</button></span>` : ''; }).join('')}</div>
            <select class="mt" data-act-change="pl.sceneAddCodex" data-id="${sc.id}"><option value="">+ Lier une page du codex…</option>${pages.filter((p) => !sc.codex.includes(p.id)).map((p) => `<option value="${esc(p.id)}">${esc(p.name)} — ${esc(p.category)}</option>`).join('')}</select>`
        : '<p class="muted small">Importez un .lore (Codex & lore) pour lier des fiches (lieux, PNJ, artefacts…) à cette scène.</p>'}
    </section>
    <div class="row end">
        <button class="btn ghost sm" data-act="pl.moveScene" data-id="${sc.id}" data-dir="-1" ${idx <= 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
        <button class="btn ghost sm" data-act="pl.moveScene" data-id="${sc.id}" data-dir="1" ${idx >= s.scenes.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-down"></i></button>
        <button class="btn ghost sm" data-act="pl.dupScene" data-id="${sc.id}"><i class="fa-solid fa-clone"></i> Dupliquer</button>
        <button class="btn bad" data-act="pl.delScene" data-id="${sc.id}"><i class="fa-solid fa-trash"></i> Supprimer</button>
    </div>`;
}

// ---------------------------------------------------------------- Codex & lore
function codexHtml() {
    const lore = store.state.lore;
    const size = lore ? (JSON.stringify(lore).length / 1048576).toFixed(1) : 0;
    return `<h2>Codex & lore</h2>
    <div class="row wrap mb">
        <button class="btn" data-act="pl.loreImport"><i class="fa-solid fa-file-import"></i> ${lore ? 'Réimporter / mettre à jour' : 'Importer un .lore'} <small>(Amsel Suite)</small></button>
        ${lore ? `<span class="muted small grow">« ${esc(lore.source)} » · importé le ${new Date(lore.importedAt).toLocaleDateString('fr-FR')} · ${lore.pages.length} pages · ${lore.diagrams.length} diagramme(s) · ≈ ${size} Mo dans le .iris</span>
            <button class="btn bad sm" data-act="pl.loreRemove"><i class="fa-solid fa-trash"></i> Retirer le codex</button>` : ''}
    </div>
    <p class="muted small"><i class="fa-solid fa-lock"></i> Le codex est réservé au MJ : il vit dans le .iris et n'est jamais envoyé aux joueurs. Pour partager une page, utilisez « Créer un document joueur ». Il est aussi consultable en direct (onglet Codex de la vue MJ).</p>
    <div id="cx-root" class="cx-planner"></div>`;
}

function loreImportForm(sum) {
    const s = store.state;
    const defaultStats = s.rules.stats.map((x) => x.key).join() === DEFAULT_STATS.map((x) => x.key).join();
    const box = (name, checked, label, detail = '') => `<label class="check"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}> <span>${label}${detail ? `<br><small class="muted">${detail}</small>` : ''}</span></label>`;
    const list = (a, n = 6) => esc(a.slice(0, n).join(', ') + (a.length > n ? ` … (+${a.length - n})` : ''));
    return `<form class="stack" data-submit="pl.loreGo">
        <p>Projet <b>${esc(sum.title)}</b> : ${sum.pages} pages, ${sum.images} illustrations.</p>
        ${box('codex', true, `Codex : ${sum.pages} pages + synopsis`, list(sum.categories, 10))}
        ${box('diagrams', sum.diagrams.length > 0, `Diagrammes (${sum.diagrams.length})`, list(sum.diagrams))}
        ${box('images', true, 'Illustrations (vignettes) pour le codex et les portraits', 'Alourdit le .iris de quelques Mo.')}
        ${box('maps', sum.maps.length > 0, `Cartes (${sum.maps.length}) — épingles converties en lieux`, list(sum.maps))}
        ${box('pcs', sum.pcs.length > 0, `Fiches PJ → personnages (${sum.pcs.length})`, `${list(sum.pcs)} — identité, PV, bio, portrait, arme unique. Les personnages déjà importés ne sont pas recréés.`)}
        ${sum.pcs.length ? box('updatePcs', false, 'Mettre à jour les personnages déjà importés', 'Compétences, identité, bio et portrait (pas les PV actuels, l\'argent ni l\'inventaire).') : ''}
        ${box('skills', sum.skills.length > 0 && defaultStats, `Compétences des fiches PJ → statistiques de la campagne (${sum.skills.length}, d100 « sous la stat »)`,
        sum.skills.length ? `${list(sum.skills, 8)}${defaultStats ? '' : ' — ⚠ remplace vos statistiques actuelles (valeurs conservées si même nom).'}` : 'Aucune compétence détectée.')}
        ${box('npcs', sum.npcs.length > 0, `Fiches PNJ → banque PNJ & créatures (${sum.npcs.length})`, list(sum.npcs))}
        <p id="lore-progress" class="muted small"></p>
        <div class="row end"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn"><i class="fa-solid fa-file-import"></i> Importer</button></div>
    </form>`;
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

    'pl.pickMap': (el) => { ui.mapId = el.dataset.id; renderMain(); },
    'pl.addMap': () => {
        const m = newMap(store.state);
        store.state.maps.push(m);
        ui.mapId = m.id;
        store.commit('structure');
    },
    'pl.activeMap': (el) => { store.state.activeMapId = el.dataset.id; store.commit('structure'); },
    'pl.dupMap': (el) => {
        const s = store.state;
        const src = findMap(s, el.dataset.id);
        if (!src) return;
        const m = newMap(s, `${src.name} (copie)`);
        Object.assign(m, { image: src.image, width: src.width, height: src.height, markers: src.markers.map((k) => ({ ...k })), fog: { ...src.fog } });
        s.maps.push(m);
        ui.mapId = m.id;
        store.commit('structure');
    },
    'pl.delMap': async (el) => {
        const s = store.state;
        const m = findMap(s, el.dataset.id);
        if (!m || s.maps.length < 2 || !(await confirmBox(`Supprimer la carte « ${m.name} » (lieux, jetons, PNJ posés, brouillard) ?`, 'Supprimer'))) return;
        s.maps = s.maps.filter((x) => x !== m);
        if (s.activeMapId === m.id) s.activeMapId = s.maps[0].id;
        for (const sc of s.scenes) if (sc.mapId === m.id) sc.mapId = '';
        ui.mapId = s.activeMapId;
        store.commit('structure');
    },
    'pl.codexPage': (el) => { ui.section = 'codex'; showCodexPage(el.dataset.id); renderAll(); },

    'pl.addBank': () => {
        const b = normalizeBankEntry({ name: `PNJ ${store.state.bestiary.length + 1}` });
        store.state.bestiary.push(b);
        ui.bankId = b.id;
        store.commit('structure');
    },
    'pl.pickBank': (el) => { ui.bankId = el.dataset.id; renderMain(); },

    'pl.addScene': () => {
        const s = store.state;
        const sc = normalizeScene({ title: `Scène ${s.scenes.filter((x) => x.session === s.meta.sessionNumber).length + 1}`, session: s.meta.sessionNumber });
        s.scenes.push(sc);
        ui.sceneId = sc.id;
        store.commit('structure');
    },
    'pl.pickScene': (el) => { ui.sceneId = el.dataset.id; renderMain(); },
    'pl.sceneToggle': (el) => {
        const sc = findScene(store.state, el.dataset.id);
        const f = el.dataset.field;
        if (!sc || !Array.isArray(sc[f])) return;
        const v = el.dataset.val;
        sc[f] = sc[f].includes(v) ? sc[f].filter((x) => x !== v) : [...sc[f], v];
        store.commit('structure');
    },
    'pl.moveScene': (el) => {
        const list = store.state.scenes;
        const i = list.findIndex((x) => x.id === el.dataset.id);
        const j = i + Number(el.dataset.dir);
        if (i < 0 || j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
        store.commit('structure');
    },
    'pl.dupScene': (el) => {
        const s = store.state;
        const src = findScene(s, el.dataset.id);
        if (!src) return;
        const sc = normalizeScene({ ...src, id: null, title: `${src.title} (copie)`, done: false });
        s.scenes.splice(s.scenes.indexOf(src) + 1, 0, sc);
        ui.sceneId = sc.id;
        store.commit('structure');
    },
    'pl.delScene': async (el) => {
        const s = store.state;
        const sc = findScene(s, el.dataset.id);
        if (!sc || !(await confirmBox(`Supprimer la scène « ${sc.title} » ?`, 'Supprimer'))) return;
        s.scenes = s.scenes.filter((x) => x !== sc);
        if (s.session.sceneId === sc.id) s.session.sceneId = '';
        store.commit('structure');
    },

    'pl.loreImport': async () => {
        const f = await pickFile('.lore,.lorekit,.tar');
        if (!f) return;
        toast('Lecture du fichier…', 'info', 1500);
        loreSrc = await readLoreFile(f);
        const sum = loreSummary(loreSrc);
        loreModal = modal(`Importer « ${sum.title} »`, loreImportForm(sum), { onClose: () => { loreSrc = null; loreModal = null; } });
    },
    'pl.loreGo': async (form) => {
        if (!loreSrc) return;
        const btn = form.querySelector('button:not([type])');
        btn.disabled = true;
        const progress = form.querySelector('#lore-progress');
        const opts = Object.fromEntries(['codex', 'diagrams', 'images', 'maps', 'pcs', 'updatePcs', 'skills', 'npcs'].map((k) => [k, !!form.elements.namedItem(k)?.checked]));
        try {
            const report = await applyLore(store.state, loreSrc, opts, (t) => { progress.textContent = t; });
            loreModal?.close();
            store.commit('structure');
            toast(`Import terminé : ${report.join(' · ') || 'rien à importer'}.`, 'ok', 9000);
        } catch (e) {
            btn.disabled = false;
            progress.textContent = '';
            throw e;
        }
    },
    'pl.loreRemove': async () => {
        if (!(await confirmBox('Retirer le codex (pages, diagrammes, illustrations) du .iris ? Les personnages, cartes et PNJ importés sont conservés.', 'Retirer'))) return;
        store.state.lore = null;
        for (const sc of store.state.scenes) sc.codex = [];
        store.commit('structure');
    },

    'pl.mapImport': async () => {
        const f = await pickFile('image/*');
        if (!f) return;
        const url = await readDataUrl(f);
        const img = await loadImage(url);
        const m = plMap();
        Object.assign(m, { image: url, width: img.naturalWidth, height: img.naturalHeight });
        if (/^(Carte \d+|Carte principale)$/.test(m.name)) m.name = f.name.replace(/\.[^.]+$/, '');
        store.commit('structure');
    },
    'pl.mapSize': async () => {
        const m = plMap();
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
        Object.assign(plMap(), { image: c.image || '', width: c.width || 0, height: c.height || 0, markers: (c.markers || []).map((m) => ({ name: m.name || '', x: m.x || 0, y: m.y || 0, desc: m.desc || '', icon: m.icon || '', loreId: '' })) });
        store.commit('structure');
        toast('Carte du portail importée.', 'ok');
    },
    'pl.delMarker': (el) => { plMap().markers.splice(Number(el.dataset.index), 1); store.commit('structure'); },

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

// Liaison d'une page du codex à une scène (menu déroulant).
document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset?.actChange !== 'pl.sceneAddCodex' || !el.value) return;
    const sc = findScene(store.state, el.dataset.id);
    if (sc && !sc.codex.includes(el.value)) sc.codex.push(el.value);
    store.commit('structure');
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

// Éditeurs réutilisés par "Planifier une session" ET par la vue MJ en direct :
// même formulaire, mêmes règles → une seule chose à maintenir.
import { store } from './store.js';
import { registerActions } from './ui.js';
import { esc, avatarHtml, pickFile, resizeImage, readDataUrl, toast, confirmBox, fmtDateTime, download, modal } from './util.js';
import { findChar, findDoc, docKind, newDocument, findShop, findTrack, normalizeShop, normalizeShopItem, normalizeTrack } from './iris-file.js';
import { randomSecret, encryptBytes, b64 } from './crypto.js';
import { adjustMoney, addItem, logEvent } from './game.js';
import { openDocViewer } from './docviewer.js';
import { AmbiencePlayer } from './audio.js';

// ---------------------------------------------------------------- Boutiques
export function shopEditorHtml(state, shop, { live = false } = {}) {
    const S = `shop:${shop.id}`;
    const cur = esc(state.rules.currency);
    const rows = shop.items.map((i) => `<tr>
        <td><input data-bind="shopitem:${shop.id}:${i.id}|name" value="${esc(i.name)}"></td>
        <td class="w-num"><input type="number" min="0" data-bind="shopitem:${shop.id}:${i.id}|price" value="${esc(i.price)}" title="Prix (${cur})"></td>
        <td class="w-num"><input type="number" min="-1" data-bind="shopitem:${shop.id}:${i.id}|stock" value="${esc(i.stock)}" title="-1 = illimité"></td>
        <td><input data-bind="shopitem:${shop.id}:${i.id}|desc" value="${esc(i.desc)}" placeholder="Description"></td>
        <td class="w-act"><button class="icon-btn danger" data-act="shop.delItem" data-id="${shop.id}" data-item="${i.id}" title="Retirer"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('')
        || '<tr><td colspan="5" class="muted">Aucun article.</td></tr>';
    return `<section class="card shop-card ${shop.open ? 'open' : ''}">
        <div class="row wrap">
            <h4 class="grow"><i class="fa-solid fa-store"></i> ${esc(shop.name)}</h4>
            <button class="btn sm ${shop.open ? 'ok' : 'ghost'}" data-act="shop.toggle" data-id="${shop.id}"><i class="fa-solid ${shop.open ? 'fa-door-open' : 'fa-door-closed'}"></i> ${shop.open ? 'Ouverte aux joueurs' : 'Fermée'}</button>
            ${live ? '' : `<button class="icon-btn danger" data-act="shop.delete" data-id="${shop.id}" title="Supprimer"><i class="fa-solid fa-trash"></i></button>`}
        </div>
        <div class="grid2">
            <label>Nom<input data-bind="${S}|name" value="${esc(shop.name)}"></label>
            <label>Description (visible des joueurs)<input data-bind="${S}|desc" value="${esc(shop.desc)}"></label>
        </div>
        <table class="table mt"><thead><tr><th>Article</th><th>Prix</th><th>Stock</th><th>Description</th><th></th></tr></thead><tbody>${rows}</tbody></table>
        <form class="row wrap mt" data-submit="shop.addItem" data-id="${shop.id}">
            <input name="name" placeholder="Nouvel article" required class="grow">
            <input name="price" type="number" min="0" placeholder="Prix" required class="w-num">
            <input name="stock" type="number" min="-1" value="-1" class="w-num" title="-1 = illimité">
            <button class="btn"><i class="fa-solid fa-plus"></i> Ajouter</button>
        </form>
        <p class="muted small">Stock −1 = illimité. Un achat débite automatiquement le joueur et ajoute l'objet à son inventaire.</p>
    </section>`;
}

// ---------------------------------------------------------------- Ambiance sonore
export function ambienceHtml(state, { live = false } = {}) {
    const amb = state.ambience;
    const playing = (t) => (amb.music?.trackId === t.id ? 'music' : amb.sfx?.trackId === t.id ? 'sfx' : null);
    const rows = amb.tracks.map((t) => {
        const isData = t.src.startsWith('data:');
        const on = live && playing(t) === 'music';
        return `<section class="card track ${on ? 'playing' : ''}">
        <div class="row wrap">
            <button class="icon-btn ${on ? 'ok' : ''}" data-act="amb.play" data-id="${t.id}" title="${live ? (t.loop ? 'Lancer pour tous' : 'Jouer l\'effet pour tous') : 'Écouter (aperçu local)'}">
                <i class="fa-solid ${t.loop ? 'fa-play' : 'fa-bolt'}"></i></button>
            ${on ? '<button class="icon-btn" data-act="amb.stop" title="Arrêter"><i class="fa-solid fa-stop"></i></button>' : ''}
            <input data-bind="track:${t.id}|name" value="${esc(t.name)}" class="grow">
            <label class="check" title="Musique en boucle (sinon : effet ponctuel)"><input type="checkbox" data-bind="track:${t.id}|loop" data-structure="1" ${t.loop ? 'checked' : ''}> Boucle</label>
            <label class="check vol" title="Volume"><i class="fa-solid fa-volume-low"></i><input type="range" min="0" max="1" step="0.05" data-bind="track:${t.id}|volume" value="${esc(t.volume)}"></label>
            <button class="icon-btn danger" data-act="amb.delete" data-id="${t.id}" title="Supprimer"><i class="fa-solid fa-trash"></i></button>
        </div>
        <div class="row mt"><input data-bind="track:${t.id}|src" data-structure="1" value="${isData ? '' : esc(t.src)}" placeholder="${isData ? `Fichier importé (${Math.round(t.src.length / 1365)} Ko)` : 'URL ou chemin du dépôt (ex : vault/audio/pluie.mp3)'}" class="grow">
            <button class="btn ghost sm" data-act="amb.import" data-id="${t.id}"><i class="fa-solid fa-file-arrow-up"></i> Importer</button></div>
    </section>`;
    }).join('');
    const now = live ? `<div class="row wrap mb"><span class="pill ${amb.music ? 'ok' : ''}"><i class="fa-solid fa-music"></i> ${amb.music ? esc(findTrack(state, amb.music.trackId)?.name || '') : 'Silence'}</span>
        ${amb.music ? '<button class="btn ghost sm" data-act="amb.stop"><i class="fa-solid fa-stop"></i> Couper la musique</button>' : ''}</div>` : '';
    return `${now}
    <div class="row wrap mb"><button class="btn" data-act="amb.add" data-loop="1"><i class="fa-solid fa-music"></i> Ajouter une musique</button>
        <button class="btn ghost" data-act="amb.add" data-loop="0"><i class="fa-solid fa-bolt"></i> Ajouter un effet</button></div>
    ${rows || '<p class="muted">Aucune piste. Ajoutez des musiques d\'ambiance (en boucle) et des effets ponctuels (porte qui grince, explosion…).</p>'}
    <p class="muted small">Préférez des fichiers dans <code>vault/audio/</code> (le .iris reste léger) ; un fichier importé est envoyé aux joueurs au moment où il est joué.</p>`;
}

let preview = null; // aperçu local dans "Planifier"

// ---------------------------------------------------------------- Personnage
export function charEditorHtml(state, c, { live = false } = {}) {
    const S = `char:${c.id}`;
    const cur = esc(state.rules.currency);
    const stats = state.rules.stats.map((s) => `
        <label class="stat"><span>${esc(s.label)} <small>${esc(s.key)}</small></span>
        <input type="number" data-bind="${S}|stats.${esc(s.key)}" value="${esc(c.stats[s.key] ?? 0)}"></label>`).join('');
    const inv = c.inventory.map((i) => `
        <tr>
            <td><input data-bind="item:${c.id}:${i.id}|name" value="${esc(i.name)}"></td>
            <td class="w-qty"><input type="number" min="0" data-bind="item:${c.id}:${i.id}|qty" value="${esc(i.qty)}"></td>
            <td><input data-bind="item:${c.id}:${i.id}|desc" value="${esc(i.desc)}" placeholder="Description"></td>
            <td class="w-act"><button class="icon-btn danger" data-act="char.delItem" data-id="${c.id}" data-item="${i.id}" title="Retirer"><i class="fa-solid fa-trash"></i></button></td>
        </tr>`).join('') || '<tr><td colspan="4" class="muted">Inventaire vide.</td></tr>';
    const docs = state.documents.map((d) => `
        <label class="check"><input type="checkbox" data-act="char.toggleDoc" data-id="${c.id}" data-doc="${d.id}" ${c.docs.includes(d.id) || d.public ? 'checked' : ''} ${d.public ? 'disabled title="Document public"' : ''}>
        ${esc(d.title)} <small class="muted">${esc(d.category)}${d.public ? ' · public' : ''}</small></label>`).join('') || '<p class="muted">Aucun document dans la bibliothèque.</p>';
    const ledger = live ? state.ledger.filter((l) => l.charId === c.id || l.to === c.id).slice(-15).reverse().map((l) => ledgerLine(state, l, c.id)).join('') || '<li class="muted">Aucune transaction.</li>' : '';

    return `<div class="char-editor">
    <section class="card char-head">
        <button class="avatar-btn" data-act="char.avatar" data-id="${c.id}" title="Changer l'avatar">${avatarHtml(c, 'xl')}<i class="fa-solid fa-camera"></i></button>
        <div class="grid2 grow">
            <label>Nom du personnage<input data-bind="${S}|name" value="${esc(c.name)}"></label>
            <label>Joueur·se<input data-bind="${S}|player" value="${esc(c.player)}" placeholder="Pseudo du joueur"></label>
            <label>Statut<input data-bind="${S}|status" value="${esc(c.status)}" placeholder="Blessé, Empoisonné…"></label>
            <label>Couleur du jeton<input type="color" data-bind="${S}|color" data-structure="1" value="${esc(c.color)}"></label>
        </div>
    </section>

    <section class="card">
        <h4><i class="fa-solid fa-heart-pulse"></i> Vitalité & finances</h4>
        <div class="row wrap gap-l">
            <div class="vital">
                <span class="lbl">PV</span>
                <button class="icon-btn" data-act="char.hp" data-id="${c.id}" data-delta="-5" title="-5">−5</button>
                <button class="icon-btn" data-act="char.hp" data-id="${c.id}" data-delta="-1" title="-1">−1</button>
                <input type="number" class="w-num" data-bind="${S}|hp" value="${esc(c.hp)}"> /
                <input type="number" class="w-num" data-bind="${S}|hpMax" value="${esc(c.hpMax)}">
                <button class="icon-btn" data-act="char.hp" data-id="${c.id}" data-delta="1" title="+1">+1</button>
                <button class="icon-btn" data-act="char.hp" data-id="${c.id}" data-delta="5" title="+5">+5</button>
            </div>
            <div class="vital">
                <span class="lbl">Solde</span>
                <input type="number" class="w-num" data-bind="${S}|money" value="${esc(c.money)}"> <span>${cur}</span>
            </div>
        </div>
        <form class="row wrap mt" data-submit="char.money" data-id="${c.id}">
            <input name="amount" type="number" min="1" placeholder="Montant" class="w-num" required>
            <input name="text" placeholder="Motif (ex : Achat d'une lanterne)" class="grow">
            <button class="btn ok" name="dir" value="credit"><i class="fa-solid fa-plus"></i> Créditer</button>
            <button class="btn bad" name="dir" value="debit"><i class="fa-solid fa-minus"></i> Débiter</button>
        </form>
        ${live ? `<ul class="ledger mt">${ledger}</ul>` : ''}
    </section>

    <section class="card">
        <h4><i class="fa-solid fa-chart-simple"></i> Statistiques</h4>
        <div class="stats-grid">${stats}</div>
    </section>

    <section class="card">
        <h4><i class="fa-solid fa-briefcase"></i> Inventaire</h4>
        <table class="table"><thead><tr><th>Objet</th><th>Qté</th><th>Description</th><th></th></tr></thead><tbody>${inv}</tbody></table>
        <form class="row wrap mt" data-submit="char.addItem" data-id="${c.id}">
            <input name="name" placeholder="Nouvel objet" required class="grow">
            <input name="qty" type="number" min="1" value="1" class="w-num">
            <input name="desc" placeholder="Description" class="grow">
            <button class="btn"><i class="fa-solid fa-plus"></i> Ajouter</button>
        </form>
    </section>

    <section class="card">
        <h4><i class="fa-solid fa-folder-open"></i> Documents accessibles</h4>
        <div class="checks">${docs}</div>
    </section>

    <section class="card grid2">
        <label>Biographie / notes visibles par le joueur<textarea rows="5" data-bind="${S}|bio">${esc(c.bio)}</textarea></label>
        <label>Notes secrètes du MJ <small class="muted">(jamais envoyées au joueur)</small><textarea rows="5" data-bind="${S}|gmNotes">${esc(c.gmNotes)}</textarea></label>
    </section>

    <section class="card">
        <h4><i class="fa-solid fa-key"></i> Clé de déclassification des rapports</h4>
        <p class="muted small">Sert à chiffrer les passages censurés qui concernent ce personnage. Le joueur la reçoit automatiquement quand il est connecté avec ce personnage. Si vous la changez, republiez le journal.</p>
        <div class="row"><input readonly value="${esc(c.secret)}" class="grow mono"><button class="btn ghost" data-act="char.regenSecret" data-id="${c.id}"><i class="fa-solid fa-rotate"></i> Régénérer</button></div>
    </section>
    ${live ? '' : `<div class="row end"><button class="btn bad" data-act="char.delete" data-id="${c.id}"><i class="fa-solid fa-user-xmark"></i> Supprimer ce personnage</button></div>`}
    </div>`;
}

export function ledgerLine(state, l, viewpointId) {
    const to = l.to ? findChar(state, l.to)?.name : '';
    const from = findChar(state, l.charId)?.name || '?';
    const cur = esc(state.rules.currency);
    let sign = '', cls = '';
    if (l.kind === 'credit') { sign = '+'; cls = 'ok'; }
    else if (l.kind === 'debit' || l.kind === 'purchase') { sign = '−'; cls = 'bad'; }
    else if (l.kind === 'transfer') { const out = l.charId === viewpointId; sign = out ? '−' : '+'; cls = out ? 'bad' : 'ok'; }
    const amount = l.kind === 'item' ? `<i class="fa-solid fa-box"></i>` : `<b class="${cls}">${sign}${esc(l.amount)} ${cur}</b>`;
    const who = l.kind === 'transfer' || l.kind === 'item' ? `${esc(from)} → ${esc(to || '?')}` : '';
    return `<li><span class="muted small">${fmtDateTime(l.ts)}</span> ${amount} <span>${esc(l.text)}</span> <small class="muted">${who}</small></li>`;
}

// ---------------------------------------------------------------- Documents
export function docEditorHtml(state, d) {
    const S = `doc:${d.id}`;
    const kind = docKind(d);
    const isData = d.src.startsWith('data:');
    const holders = state.characters.filter((c) => c.docs.includes(d.id)).map((c) => esc(c.name)).join(', ') || '—';
    return `<section class="card doc-card">
        <div class="row">
            <h4 class="grow"><i class="fa-solid ${kindIcon(kind)}"></i> ${esc(d.title)}</h4>
            <button class="btn ghost" data-act="doc.preview" data-id="${d.id}"><i class="fa-solid fa-eye"></i> Aperçu</button>
            <button class="icon-btn danger" data-act="doc.delete" data-id="${d.id}" title="Supprimer"><i class="fa-solid fa-trash"></i></button>
        </div>
        <div class="grid2">
            <label>Titre<input data-bind="${S}|title" value="${esc(d.title)}"></label>
            <label>Catégorie<input data-bind="${S}|category" value="${esc(d.category)}" list="doc-categories"></label>
            <label class="span2">Source (URL ou fichier du dépôt, ex : vault/rapport.pdf.enc)
                <div class="row"><input data-bind="${S}|src" data-structure="1" value="${isData ? '' : esc(d.src)}" placeholder="${isData ? `Fichier importé (${Math.round(d.src.length / 1365)} Ko) — stocké dans le .iris` : 'vault/… .pdf.enc / .pdf / .png …'}" class="grow">
                <button class="btn ghost" data-act="doc.import" data-id="${d.id}" title="Importer un PDF ou une image dans le .iris"><i class="fa-solid fa-file-arrow-up"></i> Importer</button></div></label>
            <label>Code de déchiffrement (.enc)<input data-bind="${S}|code" value="${esc(d.code)}" placeholder="si fichier .enc"></label>
            <label class="check"><input type="checkbox" data-bind="${S}|public" data-structure="1" ${d.public ? 'checked' : ''}> Accessible à tous les joueurs</label>
            <label class="span2">Description (visible des joueurs)<input data-bind="${S}|desc" value="${esc(d.desc)}"></label>
            <label class="span2">Texte du document <small class="muted">(si pas de fichier : lettre, note, télégramme…)</small><textarea rows="4" data-bind="${S}|text">${esc(d.text)}</textarea></label>
        </div>
        <p class="muted small">Type détecté : ${esc(kind)} · Détenu par : ${holders}</p>
    </section>`;
}

export function kindIcon(kind) {
    return { pdf: 'fa-file-pdf', enc: 'fa-file-shield', image: 'fa-image', text: 'fa-file-lines', link: 'fa-link' }[kind] || 'fa-file';
}

// ---------------------------------------------------------------- Actions
const mustChar = (el) => {
    const c = findChar(store.state, el.dataset.id);
    if (!c) throw new Error('Personnage introuvable.');
    return c;
};

registerActions({
    'char.avatar': async (el) => {
        const c = mustChar(el);
        const f = await pickFile('image/*');
        if (!f) return;
        c.avatar = await resizeImage(f, 160);
        store.commit('structure');
    },
    'char.hp': (el) => {
        const c = mustChar(el);
        c.hp = Math.min(c.hpMax, c.hp + Number(el.dataset.delta));
        store.commit('structure');
    },
    'char.money': (form, e) => {
        const c = findChar(store.state, form.dataset.id);
        const amount = Number(form.amount.value);
        const dir = e.submitter?.value === 'debit' ? -1 : 1;
        adjustMoney(store.state, c.id, dir * amount, form.text.value.trim());
        form.reset();
        toast(`${dir > 0 ? 'Crédit' : 'Débit'} de ${amount} ${store.state.rules.currency} — ${c.name}`, 'ok');
        store.commit('structure');
    },
    'char.addItem': (form) => {
        addItem(store.state, form.dataset.id, { name: form.name.value, qty: form.qty.value, desc: form.desc.value });
        form.reset();
        store.commit('structure');
    },
    'char.delItem': (el) => {
        const c = mustChar(el);
        c.inventory = c.inventory.filter((i) => i.id !== el.dataset.item);
        store.commit('structure');
    },
    'char.toggleDoc': (el) => {
        const c = mustChar(el);
        const id = el.dataset.doc;
        c.docs = el.checked ? [...new Set([...c.docs, id])] : c.docs.filter((x) => x !== id);
        if (el.checked && store.meta.role === 'gm') {
            const title = findDoc(store.state, id)?.title;
            logEvent(store.state, `${c.name} obtient le document « ${title} »`);
            toast(`${c.name} reçoit « ${title} »`, 'ok');
        }
        store.commit('structure');
    },
    'char.regenSecret': async (el) => {
        const c = mustChar(el);
        if (!(await confirmBox('Les passages déjà publiés pour ce personnage deviendront illisibles jusqu\'à la prochaine publication du journal. Continuer ?'))) return;
        c.secret = randomSecret();
        store.commit('structure');
    },
    'char.delete': async (el) => {
        const c = mustChar(el);
        if (!(await confirmBox(`Supprimer définitivement ${c.name} ?`, 'Supprimer'))) return;
        const s = store.state;
        s.characters = s.characters.filter((x) => x.id !== c.id);
        delete s.map.tokens[c.id];
        for (const [k, v] of Object.entries(s.session.assignments)) if (v === c.id) delete s.session.assignments[k];
        store.commit('structure', { deleted: c.id });
    },

    'doc.add': () => {
        store.state.documents.push(newDocument());
        store.commit('structure');
    },
    'doc.delete': async (el) => {
        const s = store.state;
        const d = findDoc(s, el.dataset.id);
        if (!d || !(await confirmBox(`Supprimer « ${d.title} » ?`, 'Supprimer'))) return;
        s.documents = s.documents.filter((x) => x.id !== d.id);
        for (const c of s.characters) c.docs = c.docs.filter((x) => x !== d.id);
        if (s.session.spotlight?.docId === d.id) s.session.spotlight = null;
        store.commit('structure');
    },
    'doc.import': async (el) => {
        const d = findDoc(store.state, el.dataset.id);
        const f = await pickFile('application/pdf,image/*');
        if (!f) return;
        if (f.size > 12 * 1024 * 1024) throw new Error('Fichier trop lourd (> 12 Mo). Placez-le plutôt dans vault/ et indiquez son chemin.');
        d.src = await readDataUrl(f);
        if (!d.title || d.title === 'Nouveau document') d.title = f.name.replace(/\.[^.]+$/, '');
        store.commit('structure');
        toast('Fichier intégré au .iris', 'ok');
    },
    'doc.preview': (el) => {
        const d = findDoc(store.state, el.dataset.id);
        if (d) openDocViewer(d);
    },

    // Outil : chiffre un PDF au format vault/*.enc (compatible avec le portail).
    'tool.encrypt': async () => {
        const f = await pickFile('application/pdf,image/*');
        if (!f) return;
        const m = modal('Chiffrer un document', `<form class="stack" data-submit="tool.encryptGo">
            <p>Fichier : <b>${esc(f.name)}</b></p>
            <label>Code d'accès<input name="code" required minlength="4" autocomplete="off"></label>
            <label class="check"><input type="checkbox" name="add" checked> Ajouter à la bibliothèque de documents</label>
            <button class="btn">Chiffrer et télécharger</button></form>`);
        m.el._file = f;
        m.el._close = m.close;
    },
    'tool.encryptGo': async (form) => {
        const wrap = form.closest('.modal-backdrop');
        const f = wrap._file;
        const code = form.code.value.trim();
        const out = b64.encode(await encryptBytes(new Uint8Array(await f.arrayBuffer()), code));
        const name = f.name + '.enc';
        download(name, out, 'text/plain');
        if (form.add.checked) {
            const d = newDocument();
            d.title = f.name.replace(/\.[^.]+$/, '');
            d.src = 'vault/' + name;
            d.code = code;
            store.state.documents.push(d);
            store.commit('structure');
        }
        wrap._close();
        toast(`« ${name} » téléchargé : placez-le dans le dossier vault/ du site puis publiez.`, 'ok', 6000);
    },
});

registerActions({
    'shop.add': () => {
        store.state.shops.push(normalizeShop({ name: 'Nouvelle boutique' }));
        store.commit('structure');
    },
    'shop.delete': async (el) => {
        const s = store.state;
        const shop = findShop(s, el.dataset.id);
        if (!shop || !(await confirmBox(`Supprimer la boutique « ${shop.name} » ?`, 'Supprimer'))) return;
        s.shops = s.shops.filter((x) => x !== shop);
        store.commit('structure');
    },
    'shop.toggle': (el) => {
        const shop = findShop(store.state, el.dataset.id);
        shop.open = !shop.open;
        if (store.meta.role === 'gm') logEvent(store.state, `Boutique « ${shop.name} » ${shop.open ? 'ouverte' : 'fermée'}`);
        store.commit('structure');
    },
    'shop.addItem': (form) => {
        const shop = findShop(store.state, form.dataset.id);
        shop.items.push(normalizeShopItem({ name: form.name.value.trim(), price: form.price.value, stock: form.stock.value }));
        form.reset();
        store.commit('structure');
    },
    'shop.delItem': (el) => {
        const shop = findShop(store.state, el.dataset.id);
        shop.items = shop.items.filter((i) => i.id !== el.dataset.item);
        store.commit('structure');
    },

    'amb.add': (el) => {
        store.state.ambience.tracks.push(normalizeTrack({ name: el.dataset.loop === '1' ? 'Nouvelle musique' : 'Nouvel effet', loop: el.dataset.loop === '1' }));
        store.commit('structure');
    },
    'amb.delete': async (el) => {
        const s = store.state;
        const t = findTrack(s, el.dataset.id);
        if (!t || !(await confirmBox(`Supprimer « ${t.name} » ?`, 'Supprimer'))) return;
        s.ambience.tracks = s.ambience.tracks.filter((x) => x !== t);
        if (s.ambience.music?.trackId === t.id) s.ambience.music = null;
        store.commit('structure');
    },
    'amb.import': async (el) => {
        const t = findTrack(store.state, el.dataset.id);
        const f = await pickFile('audio/*');
        if (!f) return;
        if (f.size > 15 * 1024 * 1024) throw new Error('Fichier trop lourd (> 15 Mo). Placez-le plutôt dans vault/audio/ et indiquez son chemin.');
        t.src = await readDataUrl(f);
        if (/^Nouv/.test(t.name)) t.name = f.name.replace(/\.[^.]+$/, '');
        store.commit('structure');
        toast('Piste intégrée au .iris', 'ok');
    },
    'amb.play': (el) => {
        const s = store.state;
        const t = findTrack(s, el.dataset.id);
        if (!t?.src) throw new Error('Indiquez d\'abord le fichier audio.');
        const ts = Date.now();
        if (store.meta.role === 'gm') {
            s.ambience[t.loop ? 'music' : 'sfx'] = { trackId: t.id, ts };
            if (t.loop) logEvent(s, `Ambiance : ${t.name}`);
            store.commit('structure');
            return;
        }
        preview ||= new AmbiencePlayer();
        preview.first = false;
        const p = { ts, src: t.src, volume: t.volume };
        preview.apply({ music: t.loop ? p : null, sfx: t.loop ? null : p });
    },
    'amb.stop': () => {
        if (store.meta.role === 'gm') { store.state.ambience.music = null; store.commit('structure'); return; }
        preview?.stop();
        preview = null;
    },
});

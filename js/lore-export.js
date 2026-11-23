// Export du .iris vers un projet Amsel Suite (.lore).
// On repart TOUJOURS du .lore d'origine (mises en page, modèles, runes, images pleine résolution) et on
// produit une COPIE mise à jour — l'original n'est jamais modifié. Les nouvelles pages sont construites
// à partir des modèles du projet (Fiche PJ, Fiche PNJ, Lieu, Opération, Quête…), comme le ferait Amsel.
//
//   personnages   → fiches PJ : runes (identité, PV, blessures, compétences, caractéristiques), lore, portrait
//   banque PNJ    → fiches PNJ / Créature
//   lieux, cartes → pages « Lieu » + épingles ; cartes créées dans l'appli → nouvelles cartes Amsel
//   rapports      → pages « Opération » (séparateur « Rapports de session »)
//   scènes        → pages « Quête » (séparateur « Scénario »)
// Chaque élément exporté garde l'identifiant de sa page (`loreId`) : un nouvel export met à jour
// les mêmes pages au lieu de les dupliquer.
import { esc, loadImage } from './util.js';
import { loreHtmlToText } from './lore.js';
import { parseMarkup } from './journal.js';

const uuid = () => crypto.randomUUID();
const te = new TextEncoder();

/** Texte brut → HTML de module Amsel (un paragraphe par ligne). */
function textToHtml(text) {
    return String(text || '').split('\n').map((l) => `<p class="text-xs/5">${esc(l)}</p>`).join('') || '<p class="text-xs/5"></p>';
}
const tagHtml = (id) => `<tag-component id="lorePage/${esc(id)}"></tag-component> `;
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const norm = (t) => String(t || '').replace(/…$/, '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- Accès au projet
function project(data) {
    const runes = new Map();
    const groups = new Map();
    for (const g of data.runeGroups || []) { groups.set(g.idHash, g); for (const r of g.runes || []) runes.set(r.idHash, r); }
    const tpl = (re, cat) => (data.templates || []).find((t) => re.test(t.name)) || (cat && (data.templates || []).find((t) => t.category === cat)) || null;
    return {
        data, runes, groups,
        pages: new Map((data.pages || []).map((p) => [p.idHash, p])),
        tpl: {
            pc: tpl(/\bPJ\b/i, null),
            npc: tpl(/\bPNJ\b/i, 'LC_Person'),
            creature: tpl(/cr[ée]ature/i, 'LC_Bestiary'),
            place: tpl(/^lieu/i, 'LC_Geography'),
            report: tpl(/op[ée]ration/i, 'LC_Event'),
            scene: tpl(/qu[êe]te/i, 'LC_Event'),
        },
    };
}

/** Nouvelle page vide (ou pré-remplie) à partir d'un modèle du projet. */
function newPage(P, tpl, name, fill = {}) {
    const pageContent = (tpl.usedModules || []).map((m) => {
        const c = { idHash: uuid(), relatedModuleId: m.idHash };
        if (m.typeCodeModule === 'LM_Standard_Text') { c.header = ''; c.body = fill.text?.(m.header) ?? '<p class="text-xs/5"></p>'; }
        else if (m.typeCodeModule === 'LM_Rune') {
            const g = P.groups.get(m.linkedModuleTemplateId);
            c.runesContent = (g?.runes || []).map((r) => {
                let v = fill.rune?.(r.label, m.header);
                if (r.type === 'LR_Tag' && typeof v === 'string') { const t = pageByName(P, v); v = t ? { tag: t.idHash } : ''; }
                return { values: [runeValue(r, v)], relatedRuneId: r.idHash };
            });
            c.nbRows = 1;
        } else if (m.typeCodeModule === 'LM_Image') {
            const img = fill.image?.(m.header);
            c.visualContent = img ? { idHash: uuid(), relatedImage: img, display: 'fit', caption: '' } : { idHash: uuid(), relatedTheme: 'current', themeImageIndex: 0, display: 'fill', caption: '' };
        }
        return c;
    });
    return { idHash: uuid(), name, isFavorite: false, pageContent, templateId: tpl.idHash, mirrorLinksId: [], aliases: [] };
}

const pageByName = (P, name) => (name ? [...P.pages.values()].find((p) => same(p.name, name)) : null);

/** Valeur de rune selon son type (texte, choix, étiquette vers une page, quantité). */
function runeValue(r, v) {
    const out = { text: '', choice: '', tag: '', divergent: false, quantum: 0 };
    if (v === undefined || v === null || v === '') return out;
    if (typeof v === 'object' && v.tag) { out.tag = `lorePage/${v.tag}`; return out; }
    if (r.type === 'LR_Quantum') out.quantum = Number(v) || 0;
    else if (r.type === 'LR_Choice') out.choice = String(v);
    else out.text = String(v);
    return out;
}

/** Met à jour les runes d'une page existante : `get(label)` renvoie la nouvelle valeur ou undefined. */
function updateRunes(P, page, get) {
    let changed = 0;
    for (const c of page.pageContent || []) {
        for (const rc of c.runesContent || []) {
            const r = P.runes.get(rc.relatedRuneId);
            if (!r) continue;
            const v = get(r.label);
            if (v === undefined) continue;
            const cur = rc.values?.[0] || {};
            if (cur.tag || r.type === 'LR_Tag' || /^nom$/i.test(r.label)) continue; // liens et nom d'état civil : on ne les écrase pas
            const next = runeValue(r, v);
            const before = r.type === 'LR_Quantum' ? cur.quantum : r.type === 'LR_Choice' ? cur.choice : cur.text;
            const after = r.type === 'LR_Quantum' ? next.quantum : r.type === 'LR_Choice' ? next.choice : next.text;
            if (String(before ?? '') === String(after ?? '')) continue;
            rc.values = [{ ...cur, ...next, tag: cur.tag || '' }];
            changed++;
        }
    }
    return changed;
}

const moduleOf = (P, page, content) => (P.data.templates.find((t) => t.idHash === page.templateId)?.usedModules || []).find((m) => m.idHash === content.relatedModuleId);

/** Remplace le texte d'un module si le contenu (comparé en texte brut) a changé. */
function updateText(P, page, headerRe, text, nameOf) {
    for (const c of page.pageContent || []) {
        if (c.body === undefined) continue;
        const m = moduleOf(P, page, c);
        if (!m || !headerRe.test(m.header)) continue;
        const cur = norm(loreHtmlToText(c.body, nameOf));
        const next = norm(text);
        if (!next || cur === next || (text.endsWith('…') && cur.startsWith(next))) return 0;
        c.body = textToHtml(text);
        return 1;
    }
    return 0;
}

// ---------------------------------------------------------------- Images
async function pngBytes(src, max = 0) {
    const img = await loadImage(src);
    const scale = max ? Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)) : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: img.naturalWidth, height: img.naturalHeight };
}

/** Ajoute une image au projet (PNG + vignette 400 px, comme Amsel). Retourne son idHash. */
async function addImage(P, extra, src, displayedName) {
    const id = uuid();
    const full = await pngBytes(src);
    const thumb = await pngBytes(src, 400);
    extra.set(`img/${id}.png`, full.bytes);
    extra.set(`img/${id}.thumb.400.png`, thumb.bytes);
    const folder = (P.data.imageFolders || []).find((f) => f.isRootFolder) || P.data.imageFolders?.[0];
    P.data.importedImages.push({ idHash: id, optimized: true, extension: 'png', displayedName, index: -1, isFavorite: false, folderId: folder?.idHash || '', creationTimestamp: Math.floor(Date.now() / 1000) });
    return { id, width: full.width, height: full.height };
}

// ---------------------------------------------------------------- Ordre des pages / séparateurs
function appendToDivider(P, name, templateId, pageId) {
    const d = P.data;
    let div = d.pagesDividers.find((x) => x.name === name);
    if (!div) {
        div = { idHash: uuid(), closed: false, name, type: templateId };
        d.pagesDividers.push(div);
        d.pagesOrder.push({ idHash: div.idHash, type: 'divider' });
    }
    // Insère juste avant le séparateur suivant (ou en fin de liste).
    const start = d.pagesOrder.findIndex((o) => o.idHash === div.idHash);
    let i = start + 1;
    while (i < d.pagesOrder.length && d.pagesOrder[i].type !== 'divider') i++;
    d.pagesOrder.splice(i, 0, { idHash: pageId, type: 'item' });
}

function addPage(P, page, divider) {
    P.data.pages.push(page);
    P.pages.set(page.idHash, page);
    if (divider) appendToDivider(P, divider, page.templateId, page.idHash);
    else P.data.pagesOrder.push({ idHash: page.idHash, type: 'item' });
}

// ---------------------------------------------------------------- Export
/**
 * Applique le .iris au projet `src` (résultat de readLoreFile) et renvoie { blob, report }.
 * Modifie `state` : chaque élément exporté reçoit le `loreId` de sa page.
 */
export async function exportLore(state, src, onProgress = () => {}) {
    const data = structuredClone(src.data);
    const P = project(data);
    const extra = new Map();
    const report = { updated: 0, created: 0, pins: 0, maps: 0, images: 0 };
    const nameOf = (id) => P.pages.get(id)?.name || '';
    const pageOf = (id) => (id && P.pages.get(id)) || null;

    // ---- Personnages
    for (const c of state.characters) {
        onProgress(`Personnage : ${c.name}`);
        const values = (label, header) => {
            if (/^nom$/i.test(label)) return c.name;
            if (/^pv$|points? de vie/i.test(label)) return `${c.hp}/${c.hpMax}`;
            if (/^blessures?$/i.test(label)) return c.status;
            const st = state.rules.stats.find((s) => same(s.label, label));
            if (st && (!header || !/caract/i.test(header))) return String(c.stats[st.key] ?? '');
            const f = c.fields.find((x) => same(x.label, label));
            return f ? f.value : undefined;
        };
        let page = pageOf(c.loreId);
        if (page) {
            const n = updateRunes(P, page, (l) => values(l)) + updateText(P, page, /lore|bio|dossier/i, c.bio, nameOf);
            if (page.name !== c.name) { page.name = c.name; report.updated++; } else if (n) report.updated++;
            continue;
        }
        if (!P.tpl.pc) continue;
        let img = null;
        if (c.avatar) { try { img = (await addImage(P, extra, c.avatar, c.name)).id; report.images++; } catch { /* portrait illisible */ } }
        page = newPage(P, P.tpl.pc, c.name, {
            rune: (label, header) => values(label, header),
            text: (h) => (/lore|bio/i.test(h) ? textToHtml(c.bio) : /stuff|inventaire|équipement/i.test(h) ? (c.inventory.length ? `<ul class="list-disc pl-5">${c.inventory.map((i) => `<li><p class="text-xs/5">${esc(i.name)}${i.qty > 1 ? ` ×${i.qty}` : ''}${i.desc ? ` — ${esc(i.desc)}` : ''}</p></li>`).join('')}</ul>` : undefined) : undefined),
            image: () => img,
        });
        addPage(P, page, null);
        c.loreId = page.idHash;
        report.created++;
    }

    // ---- Banque PNJ / créatures
    for (const b of state.bestiary) {
        onProgress(`PNJ : ${b.name}`);
        const body = [b.desc, b.stats && `Caractéristiques :\n${b.stats}`, b.notes && `Notes MJ :\n${b.notes}`].filter(Boolean).join('\n\n');
        let page = pageOf(b.loreId);
        if (page) {
            const n = updateText(P, page, /lore|description/i, b.desc, nameOf);
            if (page.name !== b.name) { page.name = b.name; report.updated++; } else if (n) report.updated++;
            continue;
        }
        const tpl = (/cr[ée]ature|boss|ennemi/i.test(b.kind) && P.tpl.creature) || P.tpl.npc;
        if (!tpl) continue;
        let img = null;
        if (b.avatar) { try { img = (await addImage(P, extra, b.avatar, b.name)).id; report.images++; } catch { /* ignore */ } }
        page = newPage(P, tpl, b.name, {
            rune: (label) => (/^nom$/i.test(label) ? b.name : /univers|type/i.test(label) ? b.kind : undefined),
            text: () => textToHtml(body),
            image: () => img,
        });
        addPage(P, page, null);
        b.loreId = page.idHash;
        report.created++;
    }

    // ---- Cartes et lieux
    const rootMapFolder = (data.mapFolders || []).find((f) => f.isRootFolder) || data.mapFolders?.[0];
    for (const m of state.maps) {
        if (!m.image || !m.width || !m.height) continue;
        onProgress(`Carte : ${m.name}`);
        let am = data.maps.find((x) => x.idHash === m.loreId);
        if (!am) {
            let img;
            try { img = await addImage(P, extra, m.image, m.name); } catch { continue; }
            report.images++;
            am = { isFavorite: false, idHash: uuid(), name: m.name, imageInstance: { idHash: uuid(), relatedImage: img.id, display: 'fit', caption: '' }, folderId: rootMapFolder?.idHash || '', pins: [], lastZoom: 0, lastPosition: { lat: m.height / 2, lng: m.width / 2 } };
            data.maps.push(am);
            m.loreId = am.idHash;
            report.maps++;
        } else if (am.name !== m.name) am.name = m.name;
        for (const k of m.markers) {
            let page = pageOf(k.loreId);
            if (!page && P.tpl.place) {
                page = newPage(P, P.tpl.place, k.name || 'Lieu', { text: (h) => (/descr/i.test(h) ? textToHtml(k.desc) : undefined) });
                addPage(P, page, null);
                k.loreId = page.idHash;
                report.created++;
            }
            if (!page) continue;
            const pos = { lat: m.height - k.y, lng: k.x };
            const pin = am.pins.find((p) => p.related?.idHash === page.idHash);
            if (pin) {
                if (Math.abs(pin.position.lat - pos.lat) > 1 || Math.abs(pin.position.lng - pos.lng) > 1) { pin.position = pos; report.pins++; }
            } else {
                am.pins.push({ type: 'RELATION', idHash: uuid(), position: pos, color: 'purple', related: { idHash: page.idHash, pageType: 'lorePage' } });
                report.pins++;
            }
        }
    }

    // ---- Rapports de session → pages « Opération »
    const charName = (ref) => state.characters.find((c) => c.id === ref || same(c.name, ref))?.name || ref;
    for (const j of state.journal) {
        if (!P.tpl.report || !(j.title || j.content)) continue;
        onProgress(`Rapport : ${j.title}`);
        const text = parseMarkup(j.content).map((s) => (s.secret ? `[Réservé à ${charName(s.secret)} : ${s.text}]` : s.text)).join('');
        const name = j.title || `Rapport ${j.date}`;
        const runes = (label) => (/nom/i.test(label) ? name : /localisation|lieu/i.test(label) ? (j.tags || []).join(', ') : undefined);
        const head = j.date ? `Date : ${j.date}\n\n` : '';
        let page = pageOf(j.loreId);
        if (page) {
            const n = updateRunes(P, page, runes) + updateText(P, page, /retranscription|récit|déroul|évènement|événement/i, head + text, nameOf);
            if (page.name !== name) { page.name = name; report.updated++; } else if (n) report.updated++;
            continue;
        }
        page = newPage(P, P.tpl.report, name, { rune: runes, text: () => textToHtml(head + text) });
        addPage(P, page, 'Rapports de session');
        j.loreId = page.idHash;
        report.created++;
    }

    // ---- Scènes → pages « Quête »
    for (const sc of state.scenes) {
        if (!P.tpl.scene) continue;
        onProgress(`Scène : ${sc.title}`);
        const map = state.maps.find((m) => m.id === sc.mapId);
        const start = [sc.session ? `Session ${sc.session}` : '', map ? `Carte : ${map.name}` : '', sc.done ? 'Scène jouée' : ''].filter(Boolean).join(' · ');
        const links = sc.codex.filter((id) => P.pages.has(id));
        const npcs = sc.npcs.map((id) => state.bestiary.find((b) => b.id === id)).filter(Boolean);
        const quest = textToHtml(sc.summary) + (links.length || npcs.some((b) => P.pages.has(b.loreId))
            ? `<p class="text-xs/5">${[...links, ...npcs.filter((b) => P.pages.has(b.loreId)).map((b) => b.loreId)].map(tagHtml).join('')}</p>` : '');
        const body = (h) => (/départ/i.test(h) ? textToHtml(start) : /qu[êe]te/i.test(h) ? quest : /déroul/i.test(h) ? textToHtml(sc.goals) : undefined);
        let page = pageOf(sc.loreId);
        if (page) {
            let n = 0;
            for (const c of page.pageContent) {
                const m = moduleOf(P, page, c);
                if (!m || c.body === undefined) continue;
                const next = body(m.header);
                if (next !== undefined && next !== c.body && norm(loreHtmlToText(next, nameOf)) !== norm(loreHtmlToText(c.body, nameOf))) { c.body = next; n++; }
            }
            if (page.name !== sc.title) { page.name = sc.title; report.updated++; } else if (n) report.updated++;
            continue;
        }
        page = newPage(P, P.tpl.scene, sc.title, { text: body });
        addPage(P, page, 'Scénario');
        sc.loreId = page.idHash;
        report.created++;
    }

    onProgress('Archive…');
    const files = new Map([['data.json', te.encode(JSON.stringify(data))]]);
    const imgs = [...src.files.keys()].filter((k) => k.startsWith('img/'));
    for (const k of imgs) files.set(k, src.files.get(k));
    for (const [k, v] of extra) files.set(k, v);
    return { blob: makeTar(files, imgs.length || extra.size ? ['img/'] : []), report };
}

// ---------------------------------------------------------------- Archive tar (ustar)
function header(name, size, type, mtime) {
    const h = new Uint8Array(512);
    const put = (str, off, len) => h.set(te.encode(str).subarray(0, len), off);
    const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
    put(name, 0, 100);
    put(type === '5' ? '000777 \0' : '000666 \0', 100, 8);
    put('000000 \0', 108, 8);
    put('000000 \0', 116, 8);
    put(oct(size, 12), 124, 12);
    put(oct(mtime, 12), 136, 12);
    put('        ', 148, 8);
    put(type, 156, 1);
    put('ustar\0', 257, 6);
    put('00', 263, 2);
    put('000000 \0', 329, 8);
    put('000000 \0', 337, 8);
    let sum = 0;
    for (const b of h) sum += b;
    put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    return h;
}

export function makeTar(files, dirs = []) {
    const mtime = Math.floor(Date.now() / 1000);
    const parts = [];
    const pad = (n) => new Uint8Array((512 - (n % 512)) % 512);
    let first = true;
    for (const [name, data] of files) {
        parts.push(header(name, data.length, '0', mtime), data, pad(data.length));
        if (first) { for (const d of dirs) parts.push(header(d, 0, '5', mtime)); first = false; }
    }
    parts.push(new Uint8Array(1024));
    return new Blob(parts, { type: 'application/x-tar' });
}

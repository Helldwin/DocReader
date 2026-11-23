// Import d'un projet Amsel Suite (.lore / .lorekit) : archive tar contenant `data.json` + `img/`.
// Tout se fait dans le navigateur. Le contenu devient :
//   - un Codex réservé au MJ (pages, synopsis, diagrammes, illustrations)  → state.lore
//   - des cartes (épingles → lieux)                                          → state.maps
//   - des personnages joueurs (fiches PJ : compétences, identité, PV, arme)  → state.characters
//   - une banque de PNJ / créatures                                          → state.bestiary
import { esc, uid, readDataUrl, loadImage } from './util.js';
import { newCharacter, normalizeBankEntry, normalizeMap, DICE_PRESETS } from './iris-file.js';

// ---------------------------------------------------------------- Archive tar (ustar / pax / GNU)
export function untar(buffer) {
    const u8 = new Uint8Array(buffer);
    const dec = new TextDecoder();
    const files = new Map();
    const str = (a, len) => { const s = u8.subarray(a, a + len); const z = s.indexOf(0); return dec.decode(z < 0 ? s : s.subarray(0, z)); };
    let off = 0;
    let nextName = null;
    while (off + 512 <= u8.length) {
        if (u8[off] === 0) break; // bloc vide : fin d'archive
        let name = str(off, 100);
        const size = parseInt(str(off + 124, 12).trim() || '0', 8) || 0;
        const type = String.fromCharCode(u8[off + 156] || 48);
        const prefix = str(off + 345, 155);
        if (prefix) name = `${prefix}/${name}`;
        if (nextName) { name = nextName; nextName = null; }
        const start = off + 512;
        const data = u8.subarray(start, start + size);
        if (type === 'L') nextName = dec.decode(data).replace(/\0[\s\S]*$/, '');
        else if (type === 'x') { const m = dec.decode(data).match(/\d+ path=([^\n]*)\n/); if (m) nextName = m[1]; }
        else if (type === '0' || type === '7') files.set(name.replace(/^\.\//, ''), data);
        off = start + Math.ceil(size / 512) * 512;
    }
    return files;
}

export async function readLoreFile(file) {
    const files = untar(await file.arrayBuffer());
    const raw = files.get('data.json');
    if (!raw) throw new Error('Fichier .lore invalide : data.json introuvable dans l\'archive.');
    let data;
    try { data = JSON.parse(new TextDecoder().decode(raw)); } catch { throw new Error('data.json illisible dans le .lore.'); }
    if (!Array.isArray(data.pages)) throw new Error('Ce fichier ne ressemble pas à un projet Amsel Suite.');
    return { name: file.name, data, files };
}

// ---------------------------------------------------------------- HTML Amsel → HTML sûr / texte
const ALLOWED = new Set(['P', 'BR', 'HR', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'H1', 'H2', 'H3', 'H4', 'H5', 'BLOCKQUOTE', 'CODE', 'PRE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'SUB', 'SUP', 'MARK']);
const BLOCK = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'BLOCKQUOTE', 'TR', 'PRE', 'HR', 'UL', 'OL']);
const parseHtml = (html) => new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html').body; // document inerte : aucun script exécuté
const linkId = (el) => String(el.getAttribute('id') || '').replace(/^lorePage\//, '');

/** HTML d'une page Amsel → HTML limité à une liste blanche, sans aucun attribut. `link(id)` rend les renvois. */
export function sanitizeLoreHtml(html, link) {
    const walk = (node) => {
        let out = '';
        for (const n of node.childNodes) {
            if (n.nodeType === 3) out += esc(n.nodeValue);
            else if (n.nodeType === 1) {
                const tag = n.tagName;
                if (tag === 'TAG-COMPONENT') out += link(linkId(n));
                else if (tag === 'BR' || tag === 'HR') out += `<${tag.toLowerCase()}>`;
                else if (ALLOWED.has(tag)) out += `<${tag.toLowerCase()}>${walk(n)}</${tag.toLowerCase()}>`;
                else out += walk(n);
            }
        }
        return out;
    };
    return walk(parseHtml(html));
}

/** HTML Amsel → texte brut (bio d'un personnage, document joueur…). */
export function loreHtmlToText(html, nameOf = () => '') {
    const walk = (node) => {
        let out = '';
        for (const n of node.childNodes) {
            if (n.nodeType === 3) out += n.nodeValue;
            else if (n.nodeType === 1) {
                if (n.tagName === 'TAG-COMPONENT') { out += nameOf(linkId(n)) || ''; continue; }
                if (n.tagName === 'BR') { out += '\n'; continue; }
                if (n.tagName === 'HR') { out += '\n———\n'; continue; }
                const inner = walk(n);
                if (n.tagName === 'LI') out += `\n• ${inner.trim()}`;
                else if (BLOCK.has(n.tagName)) out += `\n${inner}\n`;
                else out += inner;
            }
        }
        return out;
    };
    return walk(parseHtml(html)).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Texte brut d'une page du codex (tous ses blocs). */
export function pageToText(page, nameOf) {
    const parts = [];
    for (const b of page.blocks) {
        if (b.type === 'text') parts.push((b.title ? `${b.title.toUpperCase()}\n` : '') + loreHtmlToText(b.html, nameOf));
        if (b.type === 'fields') parts.push((b.title ? `${b.title.toUpperCase()}\n` : '') + b.fields.map((f) => `${f.label} : ${f.value || nameOf(f.link) || ''}`).join('\n'));
    }
    return parts.filter((p) => p.trim()).join('\n\n');
}

// ---------------------------------------------------------------- Conversion du projet
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml' };
const SIDE = (h, def) => (/^(?:source|target)-(left|right|top|bottom)-/.exec(h || '') || [])[1] || def;
const COLOR_OK = /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i;

function imageEntry(src, id, thumb) {
    const meta = (src.data.importedImages || []).find((i) => i.idHash === id);
    if (!meta) return null;
    const ext = String(meta.extension || 'png').toLowerCase();
    const names = thumb ? [`img/${id}.thumb.400.${ext}`, `img/${id}.${ext}`] : [`img/${id}.${ext}`, `img/${id}.thumb.400.${ext}`];
    for (const n of names) if (src.files.has(n)) return { bytes: src.files.get(n), mime: MIME[ext] || 'image/png', name: meta.displayedName };
    return null;
}

/** Image du projet en data: URL. `thumb` : vignette ré-encodée en WebP (≤ 720 px) pour garder le .iris léger. */
async function imageUrl(src, id, thumb = true) {
    const e = id && imageEntry(src, id, thumb);
    if (!e) return '';
    const url = await readDataUrl(new Blob([e.bytes], { type: e.mime }));
    if (!thumb) return url;
    try {
        const small = await shrink(url, 720, 0.82);
        return small.length < url.length ? small : url;
    } catch { return url; }
}

async function shrink(dataUrl, max, quality) {
    const img = await loadImage(dataUrl);
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', quality);
}

const smallAvatar = (dataUrl) => (dataUrl ? shrink(dataUrl, 160, 0.85) : '');

/** Pages Amsel → pages du codex : { id, name, category, kind, image, aliases, blocks[] }. */
function convertPages(data) {
    const templates = new Map((data.templates || []).map((t) => [t.idHash, t]));
    const runes = new Map();
    for (const g of data.runeGroups || []) for (const r of g.runes || []) runes.set(r.idHash, r);
    const dividers = new Map();
    // Les séparateurs ("Monde d'IRIS", "Notre Monde"…) regroupent les pages qui les suivent.
    let current = '';
    const divs = new Map((data.pagesDividers || []).map((d) => [d.idHash, d.name]));
    for (const o of data.pagesOrder || []) {
        if (divs.has(o.idHash)) current = divs.get(o.idHash);
        else dividers.set(o.idHash, current);
    }
    const order = new Map((data.pagesOrder || []).map((o, i) => [o.idHash, i]));

    return (data.pages || []).map((p) => {
        const tpl = templates.get(p.templateId);
        const mods = new Map((tpl?.usedModules || []).map((m) => [m.idHash, m]));
        const page = { id: p.idHash, name: p.name || 'Sans titre', category: tpl?.name || 'Page', kind: tpl?.category || '', group: dividers.get(p.idHash) || '', image: '', aliases: (p.aliases || []).map(String), blocks: [] };
        const blocks = [];
        for (const c of p.pageContent || []) {
            const m = mods.get(c.relatedModuleId);
            const type = m?.typeCodeModule || (c.runesContent ? 'LM_Rune' : c.visualContent ? 'LM_Image' : 'LM_Standard_Text');
            const title = m?.header || c.header || '';
            const pos = m ? m.positionYMin * 100 + m.positionXMin : 9999;
            if (type === 'LM_Image') {
                const img = c.visualContent?.relatedImage;
                if (!img) continue;
                if (!page.image) page.image = img;
                else blocks.push({ pos, type: 'image', title, image: img });
            } else if (type === 'LM_Rune') {
                const fields = (c.runesContent || []).map((rc) => {
                    const r = runes.get(rc.relatedRuneId);
                    if (!r) return null;
                    const tag = (rc.values || []).map((v) => v.tag).find(Boolean);
                    const value = (rc.values || []).map((v) => v.text || v.choice || (r.type === 'LR_Quantum' && v.quantum ? String(v.quantum) : '')).filter(Boolean).join(' / ');
                    return { label: r.label, value, link: tag ? String(tag).replace(/^lorePage\//, '') : '' };
                }).filter((f) => f && (f.value || f.link));
                if (fields.length) blocks.push({ pos, type: 'fields', title, fields });
            } else if (type === 'LM_Standard_Text') {
                const html = c.body || '';
                if (html.replace(/<[^>]*>/g, '').trim() || /<tag-component/.test(html)) blocks.push({ pos, type: 'text', title, html });
            }
        }
        blocks.sort((a, b) => a.pos - b.pos);
        page.blocks = blocks.map(({ pos, ...b }) => b);
        page.order = order.get(p.idHash) ?? 9999;
        return page;
    }).sort((a, b) => a.order - b.order);
}

function convertDiagrams(data) {
    return (data.diagrams || []).map((g) => ({
        id: g.idHash,
        name: g.name || 'Diagramme',
        nodes: (g.nodes || []).map((n) => ({
            id: n.idHash, label: n.label || '', legend: n.legend || '', desc: n.description || '',
            x: Number(n.position?.x) || 0, y: Number(n.position?.y) || 0,
            kind: n.nodeType === 'image' ? 'image' : 'text',
            image: n.visualContent?.relatedImage || '',
            page: n.related?.pageType === 'lorePage' ? n.related.idHash : '',
        })),
        edges: (g.edges || []).map((e) => ({
            id: e.idHash, s: e.source, t: e.target, sh: SIDE(e.sourceHandle, 'right'), th: SIDE(e.targetHandle, 'left'),
            label: e.label || '', color: COLOR_OK.test(e.strokeColor || '') ? e.strokeColor : '',
            width: Math.min(8, Math.max(1, Number(e.strokeWidth) || 2)),
            dash: e.strokeStyle === 'dotted' ? 'dotted' : e.strokeStyle === 'dashed' ? 'dashed' : '',
        })),
    }));
}

const isPc = (p) => /\bPJ\b/i.test(p.category);
const isNpc = (p) => /\bPNJ\b/i.test(p.category) || p.kind === 'LC_Bestiary';
const allFields = (p) => p.blocks.filter((b) => b.type === 'fields');
/** Bloc de compétences : titré « Compétences » ou composé d'au moins 6 valeurs numériques. */
const isSkillBlock = (b) => /comp[ée]tence/i.test(b.title) || (b.fields.length >= 6 && b.fields.every((f) => /^\d{1,3}$/.test(f.value)));

/** Aperçu de ce que contient le projet (pour la fenêtre d'import). */
export function loreSummary(src) {
    const pages = convertPages(src.data);
    const skills = new Set();
    for (const p of pages.filter(isPc)) for (const b of allFields(p).filter(isSkillBlock)) b.fields.forEach((f) => skills.add(f.label));
    return {
        title: src.data.fileName || src.name.replace(/\.[^.]+$/, ''),
        pages: pages.length,
        categories: [...new Set(pages.map((p) => p.category))],
        diagrams: (src.data.diagrams || []).map((d) => `${d.name} (${(d.nodes || []).length} nœuds)`),
        maps: (src.data.maps || []).map((m) => `${m.name} (${(m.pins || []).length} lieux)`),
        pcs: pages.filter(isPc).map((p) => p.name),
        npcs: pages.filter(isNpc).map((p) => p.name),
        skills: [...skills],
        images: (src.data.importedImages || []).length,
    };
}

/** Code court et unique pour une statistique : « Combat à distance » → COMD. */
function statKey(label, taken) {
    const words = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/[^A-Z]+/).filter((w) => w.length > 1 && !['DE', 'DU', 'DES', 'LA', 'LE', 'LES', 'ET', 'EN'].includes(w));
    let key = (words[0] || 'STA').slice(0, 3) + (words[1]?.[0] || '');
    let n = 2;
    const base = key;
    while (taken.has(key)) key = base.slice(0, 3) + n++;
    taken.add(key);
    return key;
}

const PIN_ICON = { LC_Geography: 'fa-location-dot', LC_Societal: 'fa-building-shield', LC_Event: 'fa-flag', LC_Person: 'fa-user', LC_Focus: 'fa-gem', LC_Bestiary: 'fa-dragon' };

/**
 * Applique le projet à l'état de la campagne.
 * opts : { codex, diagrams, maps, pcs, updatePcs, skills, npcs, images }
 * Retourne la liste des actions réalisées (pour le message de fin).
 */
export async function applyLore(state, src, opts, onProgress = () => {}) {
    const report = [];
    const data = src.data;
    const pages = convertPages(data);
    const byId = new Map(pages.map((p) => [p.id, p]));
    const nameOf = (id) => byId.get(id)?.name || '';
    const firstText = (p, max = 400) => {
        const t = p.blocks.filter((b) => b.type === 'text').map((b) => loreHtmlToText(b.html, nameOf)).join('\n\n').trim();
        return t.length > max ? t.slice(0, max - 1) + '…' : t;
    };

    // ---- Codex + diagrammes + illustrations
    if (opts.codex || opts.diagrams) {
        onProgress('Codex…');
        const diagrams = opts.diagrams ? convertDiagrams(data) : (state.lore?.diagrams || []);
        const keepPages = opts.codex ? pages : (state.lore?.pages || []);
        const images = {};
        if (opts.images) {
            const used = new Set();
            for (const p of keepPages) { if (p.image) used.add(p.image); p.blocks.forEach((b) => b.image && used.add(b.image)); }
            for (const d of diagrams) d.nodes.forEach((n) => n.image && used.add(n.image));
            let i = 0;
            for (const id of used) {
                onProgress(`Illustrations ${++i}/${used.size}…`);
                const url = await imageUrl(src, id, true);
                if (url) images[id] = url;
            }
        }
        state.lore = {
            source: src.name,
            importedAt: Date.now(),
            title: data.fileName || '',
            synopsis: opts.codex ? (data.synopsis || '') : (state.lore?.synopsis || ''),
            pages: keepPages,
            diagrams,
            images: opts.images ? images : (state.lore?.images || {}),
        };
        if (opts.codex) report.push(`${pages.length} pages dans le codex`);
        if (opts.diagrams) report.push(`${diagrams.length} diagramme(s)`);
        if (opts.images) report.push(`${Object.keys(images).length} illustration(s)`);
    }

    // ---- Compétences des fiches PJ → statistiques de la campagne (d100 « sous la stat »)
    const pcs = pages.filter(isPc);
    const skillLabels = [];
    for (const p of pcs) for (const b of allFields(p).filter(isSkillBlock)) for (const f of b.fields) if (!skillLabels.includes(f.label)) skillLabels.push(f.label);
    if (opts.skills && skillLabels.length) {
        const old = state.rules.stats;
        const taken = new Set();
        const stats = skillLabels.map((label) => {
            const prev = old.find((s) => s.label.toLowerCase() === label.toLowerCase());
            if (prev) { taken.add(prev.key); return { key: prev.key, label }; }
            return { key: null, label };
        }).map((s) => (s.key ? s : { key: statKey(s.label, taken), label: s.label }));
        state.rules.stats = stats;
        if (state.rules.dice.mode !== 'under') state.rules.dice = { ...DICE_PRESETS.under };
        for (const c of state.characters) {
            const next = {};
            for (const s of stats) next[s.key] = c.stats[s.key] ?? 50;
            c.stats = next;
        }
        // Champs d'identité proposés à chaque nouvelle fiche (Titre, Âge, Profession, caractéristiques…)
        const presets = new Set(state.rules.fieldPresets);
        for (const p of pcs) for (const b of allFields(p).filter((x) => !isSkillBlock(x))) for (const f of b.fields) if (!/^(nom|pv|blessures?)$/i.test(f.label)) presets.add(f.label);
        state.rules.fieldPresets = [...presets];
        report.push(`${stats.length} compétences comme statistiques (d100)`);
    }

    // ---- Fiches PJ → personnages
    if (opts.pcs) {
        let created = 0, updated = 0;
        for (const p of pcs) {
            onProgress(`Personnage : ${p.name}…`);
            let c = state.characters.find((x) => x.loreId === p.id);
            const isNew = !c;
            if (c && !opts.updatePcs) continue;
            if (!c) c = newCharacter(state, p.name);
            c.loreId = p.id;
            const fields = [];
            for (const b of allFields(p)) {
                if (isSkillBlock(b)) {
                    for (const f of b.fields) {
                        const st = state.rules.stats.find((s) => s.label.toLowerCase() === f.label.toLowerCase());
                        if (st && /^\d+$/.test(f.value)) c.stats[st.key] = Number(f.value);
                    }
                    continue;
                }
                for (const f of b.fields) {
                    if (/^nom$/i.test(f.label)) continue;
                    if (/^pv$|points? de vie/i.test(f.label)) {
                        const m = /(-?\d+)\s*\/\s*(\d+)/.exec(f.value) || /(-?\d+)/.exec(f.value);
                        if (m && (isNew || opts.updatePcs)) { c.hpMax = Number(m[2] ?? m[1]); if (isNew) c.hp = Number(m[1]); }
                        continue;
                    }
                    if (/^blessures?$/i.test(f.label)) { if (isNew) c.status = f.value; continue; }
                    const value = f.value || nameOf(f.link);
                    if (value) fields.push({ label: f.label, value });
                }
            }
            if (fields.length) c.fields = fields;
            const bio = p.blocks.filter((b) => b.type === 'text' && /lore|histoire|bio|dossier|^$/i.test(b.title)).map((b) => loreHtmlToText(b.html, nameOf)).join('\n\n').trim();
            if (bio) c.bio = bio;
            if (p.image && opts.images !== false) {
                try { c.avatar = await smallAvatar(await imageUrl(src, p.image, true)); } catch { /* image absente */ }
            }
            if (isNew) {
                // Arme unique + objets liés de la fiche → inventaire
                const linked = new Set();
                for (const b of allFields(p)) for (const f of b.fields) if (f.link && byId.has(f.link)) linked.add(f.link);
                for (const b of p.blocks.filter((x) => x.type === 'text' && /stuff|inventaire|objet|équipement/i.test(x.title))) {
                    for (const m of b.html.matchAll(/lorePage\/([0-9a-f-]{36})/g)) if (byId.has(m[1])) linked.add(m[1]);
                }
                for (const id of linked) {
                    const lp = byId.get(id);
                    if (isPc(lp) || isNpc(lp)) continue;
                    const desc = allFields(lp).flatMap((b) => b.fields).filter((f) => !/^nom$/i.test(f.label)).map((f) => `${f.label} : ${f.value || nameOf(f.link)}`).join(' · ');
                    if (!c.inventory.some((i) => i.name === lp.name)) c.inventory.push({ id: uid('i'), name: lp.name, qty: 1, desc: desc || lp.category });
                }
                c.gmNotes = `Importé depuis « ${src.name} » (fiche ${p.category}).`;
                state.characters.push(c);
                created++;
            } else updated++;
        }
        if (created || updated) report.push(`${created} personnage(s) créé(s)${updated ? `, ${updated} mis à jour` : ''}`);
    }

    // ---- Fiches PNJ / créatures → banque
    if (opts.npcs) {
        let n = 0;
        for (const p of pages.filter(isNpc)) {
            let b = state.bestiary.find((x) => x.loreId === p.id);
            if (!b) { b = normalizeBankEntry({ name: p.name, kind: p.kind === 'LC_Bestiary' ? 'Créature' : 'PNJ', loreId: p.id, color: p.kind === 'LC_Bestiary' ? '#ff3b3b' : '#b388ff' }); state.bestiary.push(b); n++; }
            b.name = p.name;
            b.desc = firstText(p, 600);
            const facts = allFields(p).flatMap((x) => x.fields).filter((f) => !/^nom$/i.test(f.label)).map((f) => `${f.label} : ${f.value || nameOf(f.link)}`);
            if (facts.length) b.stats = facts.join('\n');
            if (p.image && opts.images !== false) { try { b.avatar = await smallAvatar(await imageUrl(src, p.image, true)); } catch { /* ignore */ } }
        }
        report.push(`${pages.filter(isNpc).length} PNJ dans la banque${n ? ` (${n} nouveau${n > 1 ? 'x' : ''})` : ''}`);
    }

    // ---- Cartes (épingles → lieux, coordonnées Leaflet CRS.Simple : y = hauteur − lat)
    if (opts.maps) {
        for (const lm of data.maps || []) {
            onProgress(`Carte : ${lm.name}…`);
            const url = await imageUrl(src, lm.imageInstance?.relatedImage, false);
            if (!url) continue;
            const img = await loadImage(url);
            const w = img.naturalWidth, h = img.naturalHeight;
            const markers = (lm.pins || []).map((pin) => {
                const p = byId.get(pin.related?.idHash);
                const x = Math.round(Number(pin.position?.lng) || 0);
                const y = Math.round(h - (Number(pin.position?.lat) || 0));
                return { name: p?.name || pin.label || pin.name || 'Lieu', x: Math.max(0, Math.min(w, x)), y: Math.max(0, Math.min(h, y)), desc: p ? firstText(p, 220) : '', icon: PIN_ICON[p?.kind] || 'fa-location-dot', loreId: p?.id || '' };
            });
            let m = state.maps.find((x) => x.loreId === lm.idHash);
            const blank = state.maps.length === 1 && !state.maps[0].image && !state.maps[0].markers.length && !state.maps[0].loreId ? state.maps[0] : null;
            if (!m && blank) m = blank;
            if (!m) { m = normalizeMap({ name: lm.name }, state.maps.length); state.maps.push(m); }
            Object.assign(m, { name: lm.name || m.name, image: url, width: w, height: h, loreId: lm.idHash });
            m.markers = [...m.markers.filter((k) => !k.loreId), ...markers];
            report.push(`carte « ${m.name} » (${markers.length} lieu${markers.length > 1 ? 'x' : ''})`);
        }
    }
    return report;
}

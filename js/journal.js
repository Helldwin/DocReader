// Rapports de session (journal de campagne) avec passages censurés.
//
// Rédaction (dans le .iris, Planifier > Rapports) :
//     Texte public [[secret:Nathan]]Ce que seul Nathan doit lire.[[/secret]] suite publique.
//   (on peut mettre le nom OU l'identifiant du personnage)
//
// Publication → data/journal.json : chaque passage censuré est CHIFFRÉ (AES-GCM) avec la clé
// secrète du personnage. Rien n'est lisible dans le code source / l'inspecteur F12.
// Le joueur reçoit sa clé uniquement lorsqu'il est connecté en session avec ce personnage.
import { esc } from './util.js';
import { sealText, unsealText } from './crypto.js';

const SECRET_RE = /\[\[secret:([^\]]+)\]\]([\s\S]*?)\[\[\/secret\]\]/g;

/** Découpe un texte balisé en segments { text } | { secret: ref, text }. */
export function parseMarkup(content) {
    const out = [];
    let last = 0;
    for (const m of String(content || '').matchAll(SECRET_RE)) {
        if (m.index > last) out.push({ text: content.slice(last, m.index) });
        out.push({ secret: m[1].trim(), text: m[2] });
        last = m.index + m[0].length;
    }
    if (last < String(content || '').length) out.push({ text: content.slice(last) });
    return out;
}

function resolveChar(characters, ref) {
    const r = ref.toLowerCase();
    return characters.find((c) => c.id === ref) || characters.find((c) => c.name.toLowerCase() === r);
}

/** Produit le contenu de data/journal.json. Retourne { entries, warnings }. */
export async function publishJournal(state) {
    const warnings = [];
    const entries = [];
    for (const j of state.journal) {
        const segs = parseMarkup(j.content);
        const content = [];
        for (const s of segs) {
            if (!s.secret) { content.push(s.text); continue; }
            const c = resolveChar(state.characters, s.secret);
            if (!c) { warnings.push(`« ${j.title} » : personnage introuvable « ${s.secret} » (passage ignoré).`); continue; }
            content.push({ sealed: c.id, data: await sealText(s.text, c.secret) });
        }
        entries.push({ date: j.date, title: j.title, tags: j.tags, content });
    }
    entries.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return { entries, warnings };
}

/** Inverse : réimporte un journal publié dans le .iris (le MJ possède toutes les clés). */
export async function importPublished(entries, characters, makeId) {
    const out = [];
    for (const e of entries || []) {
        let content = '';
        if (typeof e.content === 'string') content = e.content;
        else for (const seg of e.content || []) {
            if (typeof seg === 'string') { content += seg; continue; }
            const c = characters.find((x) => x.id === seg.sealed);
            let txt = '(passage illisible : clé inconnue)';
            if (c) { try { txt = await unsealText(seg.data, c.secret); } catch { /* clé changée */ } }
            content += `[[secret:${c ? c.name : seg.sealed}]]${txt}[[/secret]]`;
        }
        out.push({ id: makeId(), date: e.date || '', title: e.title || '', tags: e.tags || [], content });
    }
    return out;
}

/**
 * Affiche le journal publié dans `container`.
 * keys = { [characterId]: secret } — clés détenues par le lecteur (vide sur le portail public).
 */
export async function renderJournal(container, entries, keys = {}) {
    if (!Array.isArray(entries) || entries.length === 0) {
        container.innerHTML = '<p class="journal-empty">Aucune entrée pour le moment.</p>';
        return;
    }
    const sorted = [...entries].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    container.innerHTML = '';
    for (const entry of sorted) {
        const el = document.createElement('details');
        el.className = 'journal-entry';
        const tags = (entry.tags || []).map((t) => `<span class="journal-tag">${esc(t)}</span>`).join(' ');
        el.innerHTML = `<summary class="journal-entry-header">
                <div>
                    <p class="journal-date">${esc(entry.date)}</p>
                    <p class="journal-title">${esc(entry.title || 'Sans titre')}</p>
                    <div class="journal-tags">${tags}</div>
                </div>
                <i class="fa-solid fa-chevron-down journal-chevron"></i>
            </summary>
            <div class="journal-entry-body"><p class="journal-text"></p></div>`;
        const p = el.querySelector('.journal-text');
        const segments = typeof entry.content === 'string' ? [entry.content] : (entry.content || []);
        for (const seg of segments) {
            if (typeof seg === 'string') { p.append(seg); continue; }
            const span = document.createElement('span');
            const key = keys[seg.sealed];
            let clear = null;
            if (key) { try { clear = await unsealText(seg.data, key); } catch { clear = null; } }
            if (clear !== null) {
                span.className = 'declassified';
                span.title = 'Passage déclassifié pour votre agent';
                span.textContent = clear;
            } else {
                span.className = 'redacted';
                span.title = 'Passage classifié — accès réservé à un agent précis (connectez-vous en session)';
                // Longueur approximative, pour l'effet "barre noire" — le contenu réel n'est pas dans la page.
                span.textContent = '█'.repeat(Math.max(6, Math.min(60, Math.round(seg.data.length / 12))));
            }
            p.append(span);
        }
        container.appendChild(el);
    }
}

export async function fetchJournal(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Journal introuvable');
    return res.json();
}

// Scan des archives déjà présentes dans vault/ (fichiers .enc déposés à la main, ancien système Google Sheet)
// pour les déclarer comme documents du .iris : titre, catégorie et destinataire devinés depuis le nom,
// code récupéré depuis l'ancienne feuille (CSV) si fournie, puis vérifié par un vrai déchiffrement.
import { CONFIG } from './config.js';
import { b64, decryptBytes } from './crypto.js';
import { dirSupported, repoDir, MANAGED_DIRS } from './publish.js';

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Fichiers .enc à la racine de vault/ (les dossiers gérés par la publication sont ignorés). */
export async function listVault() {
    if (dirSupported) {
        const dir = await repoDir({ ask: true });
        if (dir) {
            const vault = await dir.getDirectoryHandle('vault');
            const out = [];
            for await (const [name, h] of vault.entries()) if (h.kind === 'file' && /\.enc$/i.test(name)) out.push(name);
            return { names: out.sort(), source: `dossier « ${dir.name} »` };
        }
    }
    if (!CONFIG.GITHUB_REPO) throw new Error('Impossible de lister vault/ : ouvrez le terminal dans Chrome / Edge ou renseignez GITHUB_REPO dans js/config.js.');
    const res = await fetch(`https://api.github.com/repos/${CONFIG.GITHUB_REPO}/contents/vault`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Liste GitHub indisponible (${res.status}).`);
    const items = await res.json();
    const managed = MANAGED_DIRS.map((d) => d.split('/').pop());
    return { names: items.filter((i) => i.type === 'file' && /\.enc$/i.test(i.name) && !managed.includes(i.name)).map((i) => i.name).sort(), source: `dépôt GitHub ${CONFIG.GITHUB_REPO} (fichiers poussés)` };
}

/** Lignes de l'ancienne feuille publiée en CSV : type, code, url. */
export async function fetchLegacySheet(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Feuille inaccessible (${res.status}).`);
    return (await res.text()).split(/\r?\n/).slice(1).map((l) => l.split(',')).filter((r) => r.length >= 3)
        .map((r) => ({ type: r[0].trim(), code: r[1].trim(), url: r.slice(2).join(',').trim() }));
}

/** Devine titre, catégorie et personnages concernés depuis le nom de fichier. */
export function guessFromName(name, characters) {
    const title = name.replace(/\.enc$/i, '').replace(/\.(pdf|png|jpe?g|webp)$/i, '').trim();
    const f = ` ${fold(title).replace(/[^a-z0-9]+/g, ' ')} `;
    const category = /dossier|acte|naissance|fiche|identit/.test(f) ? 'Dossier' : /rapport/.test(f) ? 'Rapport' : /lettre|courrier/.test(f) ? 'Lettre' : /photo/.test(f) ? 'Photo' : 'Archive';
    const words = (s, min) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length >= min);
    const owners = characters.filter((c) => words(c.name, 4).some((w) => f.includes(` ${w} `)) || words(c.player, 3).some((w) => f.includes(` ${w} `))).map((c) => c.id);
    return { title, category, owners };
}

/** Le code ouvre-t-il vraiment le fichier ? */
export async function testCode(src, code) {
    if (!code) return false;
    try {
        const res = await fetch(src, { cache: 'no-cache' });
        if (!res.ok) return false;
        await decryptBytes(b64.decode(await res.text()), code);
        return true;
    } catch { return false; }
}

/** Code de la feuille correspondant à un fichier (comparaison sur le nom, URL encodée ou non). */
export function sheetMatch(rows, name) {
    const n = fold(name);
    return rows.find((r) => { try { return fold(decodeURIComponent(r.url.split('/').pop())) === n; } catch { return fold(r.url).endsWith(n); } }) || null;
}

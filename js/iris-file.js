// Format de fichier .iris : un JSON unique qui contient TOUTE la campagne.
// `normalize()` complète les champs manquants : un vieux .iris reste toujours lisible
// quand on ajoute des fonctionnalités (pensez à incrémenter FORMAT_VERSION + migrer).
import { uid, randomCode } from './util.js';
import { randomSecret } from './crypto.js';

export const FORMAT_VERSION = 1;

export const DEFAULT_STATS = [
    { key: 'FOR', label: 'Force' },
    { key: 'AGI', label: 'Agilité' },
    { key: 'INT', label: 'Intellect' },
    { key: 'PER', label: 'Perception' },
    { key: 'CHA', label: 'Charisme' },
    { key: 'VOL', label: 'Volonté' },
];

export const DICE_PRESETS = {
    under: { sides: 100, mode: 'under', critSuccess: 5, critFail: 96, defaultDifficulty: 0 },
    over: { sides: 20, mode: 'over', critSuccess: 20, critFail: 1, defaultDifficulty: 12 },
};

const COLORS = ['#ffd900', '#00e5ff', '#ff5ca8', '#7CFC00', '#ff8c00', '#b388ff', '#ff3b3b', '#40e0d0'];

export function newCampaign() {
    return normalize({
        meta: { title: 'I.R.I.S. — Nouvelle campagne', createdAt: Date.now() },
    });
}

export function newCharacter(state, name = 'Nouvel agent') {
    const stats = {};
    for (const s of state.rules.stats) stats[s.key] = state.rules.dice.mode === 'under' ? 50 : 0;
    return normalizeCharacter({
        name,
        color: COLORS[state.characters.length % COLORS.length],
        stats,
    }, state.rules);
}

export function newDocument() {
    return normalizeDocument({ title: 'Nouveau document' });
}

export function newJournalEntry() {
    return { id: uid('j'), date: new Date().toISOString().slice(0, 10), title: 'Nouvelle session', tags: [], content: '' };
}

export function normalizeCharacter(c = {}, rules) {
    const stats = { ...(c.stats || {}) };
    for (const s of rules?.stats || []) if (!(s.key in stats)) stats[s.key] = 0;
    return {
        id: c.id || uid('c'),
        name: c.name || 'Agent',
        player: c.player || '',
        avatar: c.avatar || '',
        color: c.color || '#ffd900',
        status: c.status || '',
        hp: num(c.hp, 10),
        hpMax: num(c.hpMax, 10),
        money: num(c.money, 0),
        stats,
        inventory: (c.inventory || []).map((i) => ({ id: i.id || uid('i'), name: i.name || 'Objet', qty: num(i.qty, 1), desc: i.desc || '' })),
        docs: Array.isArray(c.docs) ? [...c.docs] : [],
        bio: c.bio || '',
        gmNotes: c.gmNotes || '',
        secret: c.secret || randomSecret(),
    };
}

export function normalizeDocument(d = {}) {
    return {
        id: d.id || uid('d'),
        title: d.title || 'Document',
        category: d.category || 'Rapport',
        src: d.src || '',        // URL (ex: vault/xxx.pdf.enc) OU data: URL importée
        code: d.code || '',      // code de déchiffrement si .enc
        text: d.text || '',      // document texte rédigé directement dans l'appli
        desc: d.desc || '',
        public: !!d.public,      // accessible à tous les joueurs
    };
}

export function normalizeShop(s = {}) {
    return {
        id: s.id || uid('s'),
        name: s.name || 'Boutique',
        desc: s.desc || '',
        open: !!s.open,          // visible et accessible aux joueurs
        items: (s.items || []).map(normalizeShopItem),
    };
}

export function normalizeShopItem(i = {}) {
    return { id: i.id || uid('si'), name: i.name || 'Article', price: num(i.price, 10), stock: num(i.stock, -1), desc: i.desc || '' }; // stock -1 = illimité
}

export function normalizeTrack(t = {}) {
    return { id: t.id || uid('a'), name: t.name || 'Piste', src: t.src || '', loop: t.loop !== false, volume: clampNum(t.volume, 0, 1, 0.6) };
}

export function normalizeNpc(n = {}) {
    return { id: n.id || uid('n'), name: n.name || 'PNJ', color: n.color || '#ff3b3b', x: num(n.x, 0), y: num(n.y, 0), visible: n.visible !== false };
}

const clampNum = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };

export function normalize(raw = {}) {
    const rulesIn = raw.rules || {};
    const dice = { ...DICE_PRESETS.under, ...(rulesIn.dice || {}) };
    const rules = {
        stats: Array.isArray(rulesIn.stats) && rulesIn.stats.length ? rulesIn.stats.map((s) => ({ key: String(s.key), label: s.label || s.key })) : DEFAULT_STATS.map((s) => ({ ...s })),
        dice,
        currency: rulesIn.currency || 'Crédits',
        partyHpVisible: rulesIn.partyHpVisible !== false,
    };
    const map = raw.map || {};
    const state = {
        format: 'iris',
        version: FORMAT_VERSION,
        meta: {
            title: raw.meta?.title || 'I.R.I.S.',
            createdAt: raw.meta?.createdAt || Date.now(),
            updatedAt: raw.meta?.updatedAt || Date.now(),
            sessionNumber: num(raw.meta?.sessionNumber, 1),
            notes: raw.meta?.notes || '',
        },
        gm: {
            name: raw.gm?.name || 'MJ',
            discordIds: (raw.gm?.discordIds || []).map(String).filter(Boolean),
        },
        rules,
        characters: [],
        documents: (raw.documents || []).map(normalizeDocument),
        map: {
            image: map.image || '',
            width: num(map.width, 0),
            height: num(map.height, 0),
            markers: (map.markers || []).map((m) => ({ name: m.name || '', x: num(m.x, 0), y: num(m.y, 0), desc: m.desc || '', icon: m.icon || '' })),
            tokens: { ...(map.tokens || {}) },
            npcs: (map.npcs || []).map(normalizeNpc),
            fog: { enabled: !!map.fog?.enabled, cell: Math.max(10, num(map.fog?.cell, 50)), revealed: map.fog?.revealed || '' },
            shared: !!map.shared,
        },
        shops: (raw.shops || []).map(normalizeShop),
        ambience: { tracks: (raw.ambience?.tracks || []).map(normalizeTrack), music: null, sfx: null },
        log: Array.isArray(raw.log) ? raw.log : [],
        chats: { ...(raw.chats || {}) },
        ledger: Array.isArray(raw.ledger) ? raw.ledger : [],
        rolls: Array.isArray(raw.rolls) ? raw.rolls : [],
        journal: (raw.journal || []).map((j) => ({ id: j.id || uid('j'), date: j.date || '', title: j.title || '', tags: j.tags || [], content: typeof j.content === 'string' ? j.content : '' })),
        session: {
            code: raw.session?.code || randomCode(),
            assignments: { ...(raw.session?.assignments || {}) }, // clientId -> characterId
            spotlight: null,
            startedAt: num(raw.session?.startedAt, 0),          // début de la session en cours (brouillon de rapport)
            lastSession: raw.session?.lastSession || null,       // { startedAt, endedAt } de la précédente
        },
    };
    state.characters = (raw.characters || []).map((c) => normalizeCharacter(c, rules));
    return state;
}

function num(v, def) {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
}

export function serialize(state) {
    // Le plein écran de document et l'ambiance en cours sont de l'état "live", non sauvegardé.
    const out = {
        ...state,
        meta: { ...state.meta, updatedAt: Date.now() },
        session: { ...state.session, spotlight: null },
        ambience: { tracks: state.ambience.tracks, music: null, sfx: null },
    };
    return JSON.stringify(out, null, 2);
}

export function parse(text) {
    let raw;
    try { raw = JSON.parse(text); } catch { throw new Error('Fichier illisible : ce n\'est pas un .iris valide.'); }
    if (!raw || (raw.format && raw.format !== 'iris')) throw new Error('Format inconnu : ce fichier n\'est pas un .iris.');
    if ((raw.version || 1) > FORMAT_VERSION) throw new Error('Ce .iris a été créé par une version plus récente de l\'application.');
    return normalize(raw);
}

export function filename(state) {
    const slug = state.meta.title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'campagne';
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return `${slug}_S${state.meta.sessionNumber}_${stamp}.iris`;
}

export const findChar = (state, id) => state.characters.find((c) => c.id === id);
export const findDoc = (state, id) => state.documents.find((d) => d.id === id);
export const findShop = (state, id) => state.shops.find((s) => s.id === id);
export const findTrack = (state, id) => state.ambience.tracks.find((t) => t.id === id);

/** Type d'affichage d'un document, déduit de sa source. */
export function docKind(doc) {
    const src = (doc.src || '').toLowerCase();
    if (!src && doc.text) return 'text';
    if (src.startsWith('data:application/pdf') || /\.pdf(\?|$)/.test(src)) return 'pdf';
    if (src.startsWith('data:image') || /\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/.test(src)) return 'image';
    if (/\.enc(\?|$)/.test(src)) return 'enc';
    if (src) return 'link';
    return 'text';
}

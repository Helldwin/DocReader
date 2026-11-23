// Accès « agent » au portail : chaque personnage possède un code unique.
// Ce code sert à la fois à TROUVER son paquet (nom de fichier dérivé par PBKDF2, rien n'est listé)
// et à le DÉCHIFFRER (AES-256-GCM). Le paquet contient la fiche de l'agent, la liste de ses
// documents avec leurs clés, les cartes publiées, le bestiaire connu et sa clé de déclassification.
//
//   data/portal.json               { version, title, salt, publishedAt }          (public)
//   vault/agents/<id>.enc          paquet de l'agent, chiffré avec son code       (1 par personnage)
//   vault/docs/<docId>.enc         documents chiffrés avec leur propre clé        (partagés)
//   vault/maps/<mapId>.enc         cartes chiffrées (brouillard déjà appliqué)
// Module sans dépendance au DOM de l'appli : utilisé par le terminal (publication) ET le portail (lecture).
import { CONFIG } from './config.js';
import { b64, encryptBytes, decryptBytes } from './crypto.js';

export const PORTAL_VERSION = 1;
const te = new TextEncoder();
const td = new TextDecoder();
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I, O, 0, 1 (confusions à la lecture)

/** Forme canonique d'un code : majuscules, sans tirets ni espaces. */
export const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** Affichage lisible : K7QM-2XRP-9TDA */
export const fmtCode = (c) => normCode(c).replace(/(.{4})(?=.)/g, '$1-');

/** Code agent aléatoire : 12 caractères ≈ 60 bits. */
export function randomAgentCode() {
    const a = crypto.getRandomValues(new Uint8Array(12));
    return fmtCode(Array.from(a, (b) => ALPHABET[b % ALPHABET.length]).join(''));
}

/** Identifiant du fichier d'un agent : PBKDF2 (lent) pour qu'on ne puisse pas tester des codes à la chaîne. */
export async function agentFileId(code, salt) {
    const base = await crypto.subtle.importKey('raw', te.encode(normCode(code)), { name: 'PBKDF2' }, false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: te.encode(`iris-agent-file:${salt}`), iterations: CONFIG.PBKDF2_ITERATIONS, hash: 'SHA-256' }, base, 128);
    return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const agentPath = (id) => `vault/agents/${id}.enc`;

/** Objet → texte Base64 chiffré avec `password`. */
export async function sealJson(obj, password) {
    return b64.encode(await encryptBytes(te.encode(JSON.stringify(obj)), password));
}

export async function openJson(text, password) {
    return JSON.parse(td.decode(await decryptBytes(b64.decode(text), password)));
}

/** Octets → contenu d'un fichier .enc (Base64, même format que les archives existantes). */
export async function sealBytes(bytes, password) {
    return b64.encode(await encryptBytes(bytes, password));
}

/** Kind d'affichage d'après le type MIME / le nom de fichier. */
export function kindOf(mimeOrName) {
    const s = String(mimeOrName || '').toLowerCase();
    if (/pdf/.test(s)) return 'pdf';
    if (/^image\/|\.(png|jpe?g|gif|webp|avif|svg)(\.enc)?$/.test(s)) return 'image';
    return 'pdf';
}

// ---------------------------------------------------------------- Lecture (portail)
/**
 * Identifie un agent : retrouve et déchiffre son paquet.
 * Lève { denied: true } si aucun paquet ne correspond (code inconnu).
 */
export async function loginAgent(code, base = '') {
    const c = normCode(code);
    if (c.length < 4) throw Object.assign(new Error('Code trop court.'), { denied: true });
    const cfgRes = await fetch(`${base}data/portal.json`, { cache: 'no-cache' });
    if (!cfgRes.ok) throw new Error('Portail non publié (data/portal.json introuvable).');
    const cfg = await cfgRes.json();
    const id = await agentFileId(c, cfg.salt);
    const res = await fetch(base + agentPath(id), { cache: 'no-cache' });
    if (!res.ok) throw Object.assign(new Error('Code inconnu.'), { denied: true });
    try {
        return await openJson(await res.text(), c);
    } catch {
        throw Object.assign(new Error('Code invalide.'), { denied: true });
    }
}

/** Télécharge et déchiffre un fichier .enc → ArrayBuffer. */
export async function fetchSealed(src, key) {
    const res = await fetch(src, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Fichier introuvable : ${src}`);
    return decryptBytes(b64.decode(await res.text()), key);
}

/** Fichier chiffré → URL blob affichable (image de carte, illustration…). */
export async function sealedObjectUrl(src, key, mime = 'image/png') {
    return URL.createObjectURL(new Blob([await fetchSealed(src, key)], { type: mime }));
}

// Chiffrement AES-256-GCM + PBKDF2-SHA256.
// Format binaire : salt(16) | iv(12) | données chiffrées — encodé en Base64.
// Identique aux fichiers vault/*.enc existants : rétrocompatible.
import { CONFIG } from './config.js';

const te = new TextEncoder();
const td = new TextDecoder();

export const b64 = {
    encode(bytes) {
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        let s = '';
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return btoa(s);
    },
    decode(str) {
        const bin = atob(String(str).replace(/\s/g, ''));
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8;
    },
};

async function deriveKey(password, salt, usage) {
    const base = await crypto.subtle.importKey('raw', te.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: CONFIG.PBKDF2_ITERATIONS, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

export async function encryptBytes(data, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, 'encrypt');
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
    const out = new Uint8Array(28 + cipher.length);
    out.set(salt, 0);
    out.set(iv, 16);
    out.set(cipher, 28);
    return out;
}

export async function decryptBytes(data, password) {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    const key = await deriveKey(password, u8.slice(0, 16), 'decrypt');
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.slice(16, 28) }, key, u8.slice(28));
}

/** Chiffre un texte → Base64. */
export async function sealText(text, password) {
    return b64.encode(await encryptBytes(te.encode(text), password));
}

/** Déchiffre un Base64 produit par sealText. Lève une erreur si la clé est fausse. */
export async function unsealText(sealed, password) {
    return td.decode(await decryptBytes(b64.decode(sealed), password));
}

/** Télécharge un fichier .enc (Base64) et le déchiffre → ArrayBuffer. */
export async function fetchEncrypted(url, password) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Fichier introuvable : ' + url);
    return decryptBytes(b64.decode(await res.text()), password);
}

/** Phrase secrète aléatoire lisible (clé de déclassification d'un personnage). */
export function randomSecret(len = 20) {
    const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const a = crypto.getRandomValues(new Uint8Array(len));
    return Array.from(a, (b) => alphabet[b % alphabet.length]).join('');
}

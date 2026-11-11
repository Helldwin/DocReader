// Brouillard de guerre : la carte est découpée en cases de `fog.cell` pixels.
// Les cases révélées sont stockées en bitset Base64 (≈ 1 Ko pour une carte 4000×2750) :
// léger dans le .iris et à envoyer aux joueurs à chaque coup de pinceau.
import { b64 } from './crypto.js';

export function fogDims(map) {
    const cell = Math.max(10, Math.floor(map.fog?.cell || 50));
    return { cell, cols: Math.max(1, Math.ceil(map.width / cell)), rows: Math.max(1, Math.ceil(map.height / cell)) };
}

function decode(map) {
    const { cols, rows } = fogDims(map);
    const bits = new Uint8Array(Math.ceil((cols * rows) / 8));
    if (map.fog?.revealed) {
        try { const src = b64.decode(map.fog.revealed); bits.set(src.subarray(0, bits.length)); } catch { /* corrompu : tout masqué */ }
    }
    return bits;
}

const get = (bits, i) => (bits[i >> 3] >> (i & 7)) & 1;
const set = (bits, i, v) => { if (v) bits[i >> 3] |= 1 << (i & 7); else bits[i >> 3] &= ~(1 << (i & 7)); };

/** Le point (x, y) en pixels image est-il révélé ? (toujours vrai si brouillard désactivé) */
export function isRevealed(map, x, y) {
    if (!map.fog?.enabled) return true;
    const { cell, cols, rows } = fogDims(map);
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
    return !!get(decode(map), cy * cols + cx);
}

/** Pinceau circulaire de `radius` cases autour de (x, y). Retourne true si quelque chose a changé. */
export function paintFog(map, x, y, radius, reveal) {
    const { cell, cols, rows } = fogDims(map);
    const bits = decode(map);
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    const r = Math.max(0, radius - 1);
    let changed = false;
    for (let j = cy - r; j <= cy + r; j++) {
        for (let i = cx - r; i <= cx + r; i++) {
            if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
            if ((i - cx) ** 2 + (j - cy) ** 2 > r * r + r) continue;
            const k = j * cols + i;
            if (get(bits, k) !== (reveal ? 1 : 0)) { set(bits, k, reveal); changed = true; }
        }
    }
    if (changed) map.fog.revealed = b64.encode(bits);
    return changed;
}

export function fillFog(map, reveal) {
    const bits = decode(map).fill(reveal ? 0xff : 0);
    map.fog.revealed = b64.encode(bits);
}

/** Image du brouillard (1 pixel = 1 case) ; l'agrandissement lissé du navigateur adoucit les bords. */
export function fogImage(map, alpha = 1) {
    const { cols, rows } = fogDims(map);
    const bits = decode(map);
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(cols, rows);
    const a = Math.round(alpha * 255);
    for (let k = 0; k < cols * rows; k++) {
        const o = k * 4;
        img.data[o] = 3; img.data[o + 1] = 6; img.data[o + 2] = 4;
        img.data[o + 3] = get(bits, k) ? 0 : a;
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
}

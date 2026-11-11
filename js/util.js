// Petits utilitaires partagés (DOM, échappement, fichiers, sons, toasts).

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Échappe une valeur pour l'insérer dans du HTML (texte ou attribut). */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function uid(prefix = '') {
    const a = new Uint8Array(6);
    crypto.getRandomValues(a);
    return prefix + Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomCode(len = 6) {
    const a = new Uint8Array(len);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const toInt = (v, def = 0) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
};

export function debounce(fn, ms) {
    let t;
    const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    d.flush = (...args) => { clearTimeout(t); fn(...args); };
    return d;
}

export function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
export function fmtDateTime(ts) {
    return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export function initials(name) {
    return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}

/** Avatar : image si dispo, sinon initiales sur la couleur du personnage. */
export function avatarHtml(c, cls = '') {
    const color = esc(c?.color || '#ffd900');
    if (c?.avatar) return `<span class="avatar ${cls}" style="--c:${color}"><img src="${esc(c.avatar)}" alt=""></span>`;
    return `<span class="avatar ${cls}" style="--c:${color}">${esc(initials(c?.name))}</span>`;
}

export function hpBar(hp, hpMax) {
    const pct = hpMax > 0 ? clamp((hp / hpMax) * 100, 0, 100) : 0;
    const tone = pct > 50 ? 'ok' : pct > 20 ? 'warn' : 'bad';
    return `<div class="hpbar ${tone}" title="PV ${hp} / ${hpMax}"><span style="width:${pct}%"></span><b>${esc(hp)} / ${esc(hpMax)}</b></div>`;
}

// ---------------- Fichiers ----------------
export function download(filename, content, mime = 'application/json') {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept = '') {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.onchange = () => resolve(input.files[0] || null);
        input.click();
    });
}

export const readText = (file) => file.text();
export function readDataUrl(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
    });
}

/** Redimensionne une image (avatar) pour garder le .iris léger. */
export async function resizeImage(file, max = 160) {
    const url = await readDataUrl(file);
    const img = await loadImage(url);
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', 0.85);
}

export function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Image introuvable : ' + String(src).slice(0, 80)));
        img.src = src;
    });
}

// ---------------- Toasts ----------------
export function toast(msg, tone = 'info', ms = 3200) {
    let box = document.getElementById('toasts');
    if (!box) {
        box = document.createElement('div');
        box.id = 'toasts';
        document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${tone}`;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 400);
}

// ---------------- Modale générique ----------------
/** Ouvre une modale ; `body` est du HTML. Retourne { el, close }. */
export function modal(title, body, { wide = false, onClose } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">
        <header class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close title="Fermer"><i class="fa-solid fa-xmark"></i></button></header>
        <div class="modal-body">${body}</div></div>`;
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    return { el: wrap, close };
}

export function confirmBox(message, okLabel = 'Confirmer') {
    return new Promise((resolve) => {
        let done = false;
        const m = modal('Confirmation', `<p class="mb">${esc(message)}</p>
            <div class="row end"><button class="btn ghost" data-close>Annuler</button><button class="btn" data-ok>${esc(okLabel)}</button></div>`,
        { onClose: () => { if (!done) resolve(false); } });
        m.el.querySelector('[data-ok]').onclick = () => { done = true; m.close(); resolve(true); };
    });
}

// ---------------- Sons (bips synthétiques, comme le portail) ----------------
let audioCtx = null;
export let muted = false;
export function setMuted(v) { muted = v; }
export function beep(freq = 600, duration = 0.08, type = 'sine') {
    try {
        if (muted) return;
        audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        gain.gain.setValueAtTime(0.07, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch { /* audio indisponible */ }
}

// ---------------- Accès par chemin (liaison des formulaires) ----------------
export function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] ??= {};
    o[keys[keys.length - 1]] = value;
}
export function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

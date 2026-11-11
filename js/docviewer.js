// Lecteur de documents intégré : PDF, PDF chiffré (.enc), images, textes rédigés, liens.
import { esc, modal, toast } from './util.js';
import { b64, decryptBytes } from './crypto.js';
import { docKind } from './iris-file.js';

if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

async function bytesFrom(src) {
    const res = await fetch(src);
    if (!res.ok) throw new Error('Document introuvable (' + res.status + ')');
    return res;
}

/**
 * @param doc         document normalisé
 * @param resolveSrc  async (doc) => URL utilisable (le joueur récupère les fichiers importés auprès du MJ)
 */
export function openDocViewer(doc, { resolveSrc = async (d) => d.src } = {}) {
    const kind = docKind(doc);
    const m = modal(doc.title, `
        <div class="viewer-tools">
            <span class="pill">${esc(doc.category || kind)}</span>
            <span class="grow"></span>
            <button class="icon-btn" data-zoom="-1" title="Dézoomer"><i class="fa-solid fa-magnifying-glass-minus"></i></button>
            <button class="icon-btn" data-zoom="1" title="Zoomer"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
        </div>
        <div class="viewer-stage"><div class="viewer-pages" style="--zoom:1"><p class="muted center pad">Déchiffrement en cours…</p></div></div>`, { wide: true });
    const pages = m.el.querySelector('.viewer-pages');
    let zoom = 1;
    m.el.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
        zoom = Math.min(3, Math.max(0.4, zoom + Number(b.dataset.zoom) * 0.2));
        pages.style.setProperty('--zoom', zoom);
    }));

    (async () => {
        try {
            if (kind === 'text') {
                pages.innerHTML = `<article class="paper">${esc(doc.text)}</article>`;
                return;
            }
            const src = await resolveSrc(doc);
            if (kind === 'image') {
                pages.innerHTML = `<img class="viewer-img" src="${esc(src)}" alt="${esc(doc.title)}">`;
                return;
            }
            if (kind === 'link') {
                pages.innerHTML = `<p class="center pad"><a class="btn" href="${esc(src)}" target="_blank" rel="noopener">Ouvrir le lien <i class="fa-solid fa-arrow-up-right-from-square"></i></a></p>`;
                return;
            }
            let data;
            if (kind === 'enc') {
                let code = doc.code;
                if (!code) code = await askCode(pages);
                const txt = await (await bytesFrom(src)).text();
                data = await decryptBytes(b64.decode(txt), code).catch(() => { throw new Error('Code de déchiffrement invalide.'); });
            } else {
                data = await (await bytesFrom(src)).arrayBuffer();
            }
            await renderPdf(pages, data);
        } catch (e) {
            console.warn(e);
            pages.innerHTML = `<p class="error center pad"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(e.message || 'Lecture impossible')}</p>`;
        }
    })();
    return m;
}

function askCode(container) {
    return new Promise((resolve) => {
        container.innerHTML = `<form class="center pad stack" style="max-width:320px;margin:auto">
            <label>Code d'autorisation</label><input type="password" required autofocus>
            <button class="btn">Déchiffrer</button></form>`;
        const f = container.querySelector('form');
        f.onsubmit = (e) => { e.preventDefault(); const v = f.querySelector('input').value.trim(); container.innerHTML = '<p class="muted center pad">Déchiffrement…</p>'; resolve(v); };
    });
}

async function renderPdf(container, data) {
    if (!window.pdfjsLib) throw new Error('Moteur PDF indisponible.');
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
    container.innerHTML = '';
    const target = Math.min(1100, container.clientWidth || 900) * Math.min(2, window.devicePixelRatio || 1) * 1.25;
    for (let n = 1; n <= pdf.numPages; n++) {
        if (!container.isConnected) return; // modale fermée
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: target / base.width });
        const canvas = document.createElement('canvas');
        canvas.className = 'viewer-page';
        canvas.width = vp.width;
        canvas.height = vp.height;
        container.appendChild(canvas);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    }
    if (pdf.numPages === 0) toast('Document vide', 'warn');
}

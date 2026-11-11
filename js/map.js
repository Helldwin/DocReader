// Carte temps réel (Leaflet, global `L`) : image + lieux + jetons (personnages et PNJ) + brouillard.
// Le MJ déplace les jetons et peint le brouillard ; joueurs et spectateurs voient tout en direct.
import { esc, initials } from './util.js';
import { fogImage } from './fog.js';

export class LiveMap {
    /**
     * opts : {
     *   editable,                      jetons déplaçables (MJ)
     *   onTokenMove(id, x, y, kind),   kind ∈ 'char' | 'npc'
     *   onClick(x, y),                 clic sur la carte (hors pinceau)
     *   onPaint(x, y), onPaintEnd(),   pinceau de brouillard (MJ)
     *   fogAlpha                       opacité du brouillard (1 joueurs, ~0.55 MJ)
     * }
     */
    constructor(el, opts = {}) {
        this.el = el;
        this.opts = opts;
        this.map = null;
        this.imageKey = '';
        this.tokens = new Map(); // clé -> marker
        this.markersLayer = null;
        this.fogLayer = null;
        this.fogKey = '';
        this.brush = null;
    }

    /** cfg : { image, width, height, markers, tokens, npcs, fog }, chars : [{ id, name, color, avatar }] */
    update(cfg, chars) {
        if (!cfg?.image || !cfg.width || !cfg.height) {
            this.destroy();
            this.el.innerHTML = '<div class="map-empty"><i class="fa-solid fa-map-location-dot"></i><p>Aucune carte configurée.</p></div>';
            return;
        }
        const key = `${cfg.image.slice(0, 200)}|${cfg.image.length}|${cfg.width}|${cfg.height}`;
        if (!this.map || key !== this.imageKey) this._build(cfg, key);
        this.cfg = cfg;
        this._markers(cfg);
        this._fog(cfg);
        this._tokens(cfg, chars);
    }

    _build(cfg, key) {
        this.destroy();
        this.el.innerHTML = '';
        this.imageKey = key;
        this.h = cfg.height;
        this.bounds = [[0, 0], [cfg.height, cfg.width]];
        this.map = L.map(this.el, { crs: L.CRS.Simple, minZoom: -4, maxZoom: 3, zoomSnap: 0.25, attributionControl: false });
        L.imageOverlay(cfg.image, this.bounds).addTo(this.map);
        this.map.fitBounds(this.bounds);
        this.markersLayer = L.layerGroup().addTo(this.map);
        this.markersKey = '';
        const toImg = (e) => [Math.round(e.latlng.lng), Math.round(this.h - e.latlng.lat)];
        this.map.on('click', (e) => { if (!this.brush) this.opts.onClick?.(...toImg(e)); });
        this.map.on('mousedown', (e) => { if (this.brush) { this.painting = true; this.opts.onPaint?.(...toImg(e)); } });
        this.map.on('mousemove', (e) => { if (this.brush && this.painting) this.opts.onPaint?.(...toImg(e)); });
        const stop = () => { if (this.painting) { this.painting = false; this.opts.onPaintEnd?.(); } };
        this.map.on('mouseup', stop);
        this.map.on('mouseout', stop);
        if (this.brush) this.setBrush(this.brush);
        // Leaflet calcule mal sa taille si le conteneur était masqué : on recalcule.
        this.ro = new ResizeObserver(() => this.map?.invalidateSize());
        this.ro.observe(this.el);
    }

    /** mode : null | 'reveal' | 'hide' — en mode pinceau, la carte ne se déplace plus à la souris. */
    setBrush(mode) {
        this.brush = mode || null;
        if (!this.map) return;
        if (this.brush) this.map.dragging.disable(); else this.map.dragging.enable();
        this.el.classList.toggle('brushing', !!this.brush);
    }

    _markers(cfg) {
        const k = JSON.stringify(cfg.markers || []);
        if (k === this.markersKey) return;
        this.markersKey = k;
        this.markersLayer.clearLayers();
        for (const m of cfg.markers || []) {
            const icon = L.divIcon({ className: 'map-poi', html: `<i class="fa-solid ${esc(m.icon || 'fa-location-dot')}"></i>`, iconSize: [26, 26], iconAnchor: [13, 13] });
            L.marker([this.h - m.y, m.x], { icon }).addTo(this.markersLayer)
                .bindPopup(`<strong>${esc(m.name)}</strong>${m.desc ? '<br>' + esc(m.desc) : ''}`);
        }
    }

    _fog(cfg) {
        const fog = cfg.fog;
        if (!fog?.enabled) {
            this.fogLayer?.remove();
            this.fogLayer = null;
            this.fogKey = '';
            return;
        }
        const key = `${fog.cell}|${fog.revealed}|${cfg.width}|${cfg.height}`;
        if (key === this.fogKey && this.fogLayer) return;
        this.fogKey = key;
        const url = fogImage(cfg, this.opts.fogAlpha ?? 1);
        if (this.fogLayer) this.fogLayer.setUrl(url);
        else this.fogLayer = L.imageOverlay(url, this.bounds, { className: 'fog-layer', interactive: false }).addTo(this.map);
    }

    _entities(cfg, chars) {
        const out = [];
        for (const c of chars) {
            const t = cfg.tokens?.[c.id];
            if (t) out.push({ key: 'c:' + c.id, id: c.id, kind: 'char', name: c.name, color: c.color, avatar: c.avatar, x: t.x, y: t.y, hidden: t.visible === false });
        }
        for (const n of cfg.npcs || []) out.push({ key: 'n:' + n.id, id: n.id, kind: 'npc', name: n.name, color: n.color, x: n.x, y: n.y, hidden: n.visible === false });
        return out;
    }

    _tokens(cfg, chars) {
        const seen = new Set();
        for (const e of this._entities(cfg, chars)) {
            seen.add(e.key);
            const latlng = [this.h - e.y, e.x];
            const face = e.avatar ? `<img src="${esc(e.avatar)}" alt="">` : e.kind === 'npc' ? '<i class="fa-solid fa-skull"></i>' : esc(initials(e.name));
            const html = `<div class="token ${e.kind === 'npc' ? 'npc' : ''} ${e.hidden ? 'token-hidden' : ''}" style="--c:${esc(e.color || '#ffd900')}">${face}</div><span class="token-name">${esc(e.name)}</span>`;
            const icon = () => L.divIcon({ className: 'token-wrap', html, iconSize: [40, 40], iconAnchor: [20, 20] });
            let mk = this.tokens.get(e.key);
            if (!mk) {
                mk = L.marker(latlng, { draggable: !!this.opts.editable, icon: icon(), zIndexOffset: e.kind === 'npc' ? 900 : 1000 }).addTo(this.map);
                mk._html = html;
                if (this.opts.editable) {
                    mk.on('dragend', () => {
                        const p = mk.getLatLng();
                        this.opts.onTokenMove?.(e.id, Math.round(p.lng), Math.round(this.h - p.lat), e.kind);
                    });
                }
                this.tokens.set(e.key, mk);
            } else {
                if (!mk.dragging?.moving?.()) mk.setLatLng(latlng);
                if (mk._html !== html) { mk.setIcon(icon()); mk._html = html; }
            }
        }
        for (const [k, mk] of this.tokens) if (!seen.has(k)) { mk.remove(); this.tokens.delete(k); }
    }

    /** Centre de la carte en coordonnées image (pour poser un nouveau jeton). */
    center() {
        if (!this.map) return { x: 0, y: 0 };
        const c = this.map.getCenter();
        return { x: Math.round(c.lng), y: Math.round(this.h - c.lat) };
    }

    destroy() {
        this.ro?.disconnect();
        try { this.map?.remove(); } catch { /* ignore */ }
        this.map = null;
        this.fogLayer = null;
        this.fogKey = '';
        this.tokens.clear();
        this.imageKey = '';
    }
}

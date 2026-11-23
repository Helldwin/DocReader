// Carte temps réel (Leaflet, global `L`) : image + lieux + jetons (personnages et PNJ) + brouillard.
// Le MJ déplace les jetons et peint le brouillard ; joueurs et spectateurs voient tout en direct.
import { esc, initials } from './util.js';
import { fogImage, revealedBounds } from './fog.js';

export class LiveMap {
    /**
     * opts : {
     *   editable,                      jetons déplaçables (MJ)
     *   onTokenMove(id, x, y, kind),   kind ∈ 'char' | 'npc'
     *   onClick(x, y),                 clic sur la carte (hors pinceau)
     *   onPaint(x, y), onPaintEnd(),   pinceau de brouillard (MJ)
     *   fogAlpha                       opacité du brouillard (1 joueurs, ~0.55 MJ)
     *   fogFit                         cadre la vue sur la zone révélée (joueurs, spectateurs)
     *   onRect(x0, y0, x1, y1)         pinceau rectangle (modes 'rect-reveal' / 'rect-hide')
     *   onNoteMove(id, x, y)           note MJ déplacée
     *   onPing(x, y)                   Alt+clic ou mode ping : signal visible par tous
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
        this._notes(cfg.notes);
        this._pings(cfg.pings);
        if (this.opts.fogFit) this._fitFog(cfg);
    }

    /** Notes MJ épinglées (vue MJ uniquement : jamais présentes dans la vue joueur). */
    _notes(notes) {
        const k = JSON.stringify(notes || []);
        if (k === this.notesKey) return;
        this.notesKey = k;
        this.notesLayer ||= L.layerGroup().addTo(this.map);
        this.notesLayer.clearLayers();
        for (const n of notes || []) {
            const icon = L.divIcon({ className: 'map-note', html: '<i class="fa-solid fa-note-sticky"></i>', iconSize: [24, 24], iconAnchor: [12, 12] });
            const mk = L.marker([this.h - n.y, n.x], { icon, draggable: !!this.opts.onNoteMove, zIndexOffset: 1200 }).addTo(this.notesLayer);
            mk.bindTooltip(esc(n.text || 'Note'), { direction: 'top', className: 'note-tip' });
            mk.on('dragend', () => { const p = mk.getLatLng(); this.opts.onNoteMove?.(n.id, Math.round(p.lng), Math.round(this.h - p.lat)); });
        }
    }

    /** Signaux « ici ! » : onde animée, une seule fois par ping. */
    _pings(pings) {
        this.seenPings ||= new Set();
        for (const p of pings || []) {
            if (this.seenPings.has(p.id) || (p.age ?? 0) > 4000) { this.seenPings.add(p.id); continue; }
            this.seenPings.add(p.id);
            this.flashPing(p);
        }
    }

    flashPing(p) {
        if (!this.map) return;
        const icon = L.divIcon({ className: 'ping-wrap', html: `<span class="ping" style="--c:${esc(p.color || '#ffd900')}"></span><span class="ping-by">${esc(p.by || '')}</span>`, iconSize: [0, 0] });
        const mk = L.marker([this.h - p.y, p.x], { icon, interactive: false, zIndexOffset: 2000 }).addTo(this.map);
        setTimeout(() => mk.remove(), 3200);
    }

    /**
     * Joueurs : la vue se cadre sur la partie révélée par le brouillard, se recadre quand le MJ
     * en révèle davantage, et on ne peut pas s'éloigner dans le noir.
     */
    _fitFog(cfg) {
        const b = revealedBounds(cfg);
        const key = b ? `${b.x0},${b.y0},${b.x1},${b.y1}` : 'all';
        if (key === this.fitKey) return;
        const first = this.fitKey === undefined;
        this.fitKey = key;
        if (!b) {
            this.map.setMaxBounds(null);
            if (!first) this.map.flyToBounds(this.bounds, { duration: 0.6 });
            return;
        }
        const h = this.h;
        const padX = Math.max((b.x1 - b.x0) * 0.15, 40), padY = Math.max((b.y1 - b.y0) * 0.15, 40);
        const view = [[h - (b.y1 + padY), b.x0 - padX], [h - (b.y0 - padY), b.x1 + padX]];
        const roomX = Math.max((b.x1 - b.x0) * 0.6, 200), roomY = Math.max((b.y1 - b.y0) * 0.6, 200);
        this.map.setMaxBounds([[h - (b.y1 + roomY), b.x0 - roomX], [h - (b.y0 - roomY), b.x1 + roomX]]);
        if (first) this.map.fitBounds(view);
        else this.map.flyToBounds(view, { duration: 0.6 });
    }

    _build(cfg, key) {
        this.destroy();
        this.el.innerHTML = '';
        this.imageKey = key;
        this.h = cfg.height;
        this.bounds = [[0, 0], [cfg.height, cfg.width]];
        this.map = L.map(this.el, { crs: L.CRS.Simple, minZoom: -4, maxZoom: 3, zoomSnap: 0.25, attributionControl: false, maxBoundsViscosity: 0.85 });
        L.imageOverlay(cfg.image, this.bounds).addTo(this.map);
        this.map.fitBounds(this.bounds);
        this.fitKey = undefined; // nouvelle image : recadrage brouillard à refaire
        this.markersLayer = L.layerGroup().addTo(this.map);
        this.markersKey = '';
        const toImg = (e) => [Math.round(e.latlng.lng), Math.round(this.h - e.latlng.lat)];
        const isRect = () => String(this.brush || '').startsWith('rect');
        this.map.on('click', (e) => {
            if (this.brush) return;
            if (this.pingMode || e.originalEvent?.altKey) { if (this.opts.onPing) { this.opts.onPing(...toImg(e)); return; } }
            this.opts.onClick?.(...toImg(e));
        });
        this.map.on('mousedown', (e) => {
            if (!this.brush) return;
            this.painting = true;
            if (isRect()) {
                this.rectStart = e.latlng;
                this.rectShape = L.rectangle([e.latlng, e.latlng], { color: this.brush === 'rect-reveal' ? '#4ade80' : '#ff4d4d', weight: 2, dashArray: '6 4', fillOpacity: 0.15, interactive: false }).addTo(this.map);
            } else this.opts.onPaint?.(...toImg(e));
        });
        this.map.on('mousemove', (e) => {
            if (!this.brush || !this.painting) return;
            if (isRect()) this.rectShape?.setBounds([this.rectStart, e.latlng]);
            else this.opts.onPaint?.(...toImg(e));
        });
        const stop = (e) => {
            if (!this.painting) return;
            this.painting = false;
            if (isRect() && this.rectStart) {
                const end = e?.latlng || this.rectShape?.getBounds().getNorthEast() || this.rectStart;
                const a = toImg({ latlng: this.rectStart }), b = toImg({ latlng: end });
                this.rectShape?.remove();
                this.rectShape = null;
                this.rectStart = null;
                this.opts.onRect?.(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]));
                return;
            }
            this.opts.onPaintEnd?.();
        };
        this.map.on('mouseup', stop);
        this.map.on('mouseout', stop);
        if (this.brush) this.setBrush(this.brush);
        // Leaflet calcule mal sa taille si le conteneur était masqué : on recalcule.
        this.ro = new ResizeObserver(() => this.map?.invalidateSize());
        this.ro.observe(this.el);
    }

    /** Mode ping : un clic envoie un signal au lieu d'agir sur la carte. */
    setPingMode(on) {
        this.pingMode = !!on;
        this.el.classList.toggle('pinging', this.pingMode);
    }

    /** mode : null | 'reveal' | 'hide' | 'rect-reveal' | 'rect-hide' — en mode pinceau, la carte ne se déplace plus. */
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
            if (t) out.push({ key: 'c:' + c.id, id: c.id, kind: 'char', name: c.name, color: c.color, avatar: c.avatar, x: t.x, y: t.y, hidden: t.visible === false, dead: c.dead === true || (c.hpMax > 0 && c.hp <= 0) });
        }
        for (const n of cfg.npcs || []) out.push({ key: 'n:' + n.id, id: n.id, kind: 'npc', name: n.name, color: n.color, avatar: n.avatar, x: n.x, y: n.y, hidden: n.visible === false });
        return out;
    }

    _tokens(cfg, chars) {
        const seen = new Set();
        for (const e of this._entities(cfg, chars)) {
            seen.add(e.key);
            const latlng = [this.h - e.y, e.x];
            const face = e.avatar ? `<img src="${esc(e.avatar)}" alt="">` : e.kind === 'npc' ? '<i class="fa-solid fa-skull"></i>' : esc(initials(e.name));
            const html = `<div class="token ${e.kind === 'npc' ? 'npc' : ''} ${e.hidden ? 'token-hidden' : ''} ${e.dead ? 'is-dead' : ''}" style="--c:${esc(e.color || '#ffd900')}">${face}</div><span class="token-name">${esc(e.name)}</span>`;
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
        this.notesLayer = null;
        this.notesKey = '';
        this.tokens.clear();
        this.imageKey = '';
    }
}

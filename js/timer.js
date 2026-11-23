// Affichage du minuteur / chrono côté joueur et spectateur. La valeur reçue est celle de
// l'instant d'envoi par le MJ ; on continue de l'écouler localement entre deux mises à jour.
import { esc, beep } from './util.js';
import { fmtClock } from './game.js';

export class TimerDisplay {
    constructor(el) {
        this.el = el;
        this.t = null;
        this.base = 0;
        this.beeped = false;
        this.iv = setInterval(() => this.tick(), 250);
    }

    set(t) {
        this.t = t;
        this.base = Date.now();
        if (t?.mode === 'down' && t.value > 0) this.beeped = false;
        this.tick();
    }

    value() {
        const t = this.t;
        if (!t) return 0;
        const d = t.running ? Date.now() - this.base : 0;
        return t.mode === 'up' ? t.value + d : Math.max(0, t.value - d);
    }

    tick() {
        if (!this.el?.isConnected) return;
        const t = this.t;
        if (!t) { this.el.innerHTML = ''; this.el.classList.add('hidden'); return; }
        const v = this.value();
        const urgent = t.mode === 'down' && v <= 10000;
        this.el.classList.remove('hidden');
        this.el.className = `timer-chip ${urgent ? 'urgent' : ''} ${t.running ? '' : 'paused'}`;
        this.el.innerHTML = `<i class="fa-solid ${t.mode === 'up' ? 'fa-stopwatch' : 'fa-hourglass-half'}"></i>${t.label ? ` <span>${esc(t.label)}</span>` : ''} <b>${fmtClock(v)}</b>`;
        if (t.mode === 'down' && v === 0 && t.running && !this.beeped) { this.beeped = true; beep(220, 0.4, 'square'); setTimeout(() => beep(180, 0.5, 'square'), 450); }
    }

    destroy() { clearInterval(this.iv); }
}

/** Bandeau d'initiative (joueur / spectateur). */
export function combatBannerHtml(c, meId = '') {
    if (!c) return '';
    return `<div class="combat-banner"><span class="lbl"><i class="fa-solid fa-shield-halved"></i> Round ${esc(c.round)}</span>
        ${c.order.map((o) => `<span class="cb-item ${o.current ? 'current' : ''} ${o.dead ? 'is-dead' : ''} ${o.kind} ${o.ref && o.ref === meId ? 'me' : ''}">${o.kind === 'npc' ? '<i class="fa-solid fa-skull"></i> ' : ''}${esc(o.name)}</span>`).join('<i class="fa-solid fa-chevron-right cb-sep"></i>')}</div>`;
}

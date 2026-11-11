// Animation plein écran d'un jet de dé (vue joueur et vue spectateur).
import { esc, beep } from './util.js';
import { OUTCOME_LABEL, describeRoll } from './dice.js';

let hideTimer = null;

export function showRollOverlay(el, r, { mine = false } = {}) {
    el.className = `roll-overlay ${mine ? 'mine' : ''}`;
    el.innerHTML = `<div class="roll-card rolling"><div class="big-die">?</div><p class="roll-who">${esc(r.charName)}${r.statLabel ? ' — ' + esc(r.statLabel) : ''}</p>${r.label ? `<p class="muted">« ${esc(r.label)} »</p>` : ''}</div>`;
    const die = el.querySelector('.big-die');
    let n = 0;
    const spin = setInterval(() => { die.textContent = 1 + Math.floor(Math.random() * r.sides); if (++n % 2) beep(300 + Math.random() * 400, 0.02); }, 70);
    clearTimeout(hideTimer);
    setTimeout(() => {
        clearInterval(spin);
        if (!el.isConnected) return;
        die.textContent = r.roll;
        const card = el.querySelector('.roll-card');
        card.classList.remove('rolling');
        card.classList.add(r.outcome);
        card.insertAdjacentHTML('beforeend', `<p class="roll-outcome">${esc(OUTCOME_LABEL[r.outcome])}${r.outcome === 'raw' ? ` : ${esc(r.total)}` : ''}</p><small>${esc(describeRoll(r))}</small>`);
        beep(r.outcome.includes('success') ? 990 : r.outcome === 'raw' ? 660 : 180, 0.25, 'triangle');
        hideTimer = setTimeout(() => el.classList.add('hidden'), 4500);
    }, 1300);
}

export function rollLineHtml(r) {
    return `<div class="roll ${esc(r.outcome)}"><div class="roll-die">${esc(r.roll)}</div>
        <div><b>${esc(r.charName)}${r.statLabel ? ' — ' + esc(r.statLabel) : ''}</b>${r.label ? ` <i>« ${esc(r.label)} »</i>` : ''}
        <p>${esc(OUTCOME_LABEL[r.outcome])} · <small>${esc(describeRoll(r))}</small></p></div></div>`;
}

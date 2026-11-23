// Onglet Combat de la vue MJ : participants, initiative, tours, PV en direct, dégâts / soins de zone.
import { store } from './store.js';
import { registerActions } from './ui.js';
import { esc, avatarHtml, hpBar, toast, beep, aliveFirst, isDead, deadCls, deadMark } from './util.js';
import { findChar, findNpc, findMap } from './iris-file.js';
import { startCombat, nextTurn, endCombat, sortCombat, rollInitiative, combatEntity, applyHpMany } from './game.js';

const tgtKey = (kind, ref) => `${kind}:${ref}`;

/** Cibles possibles : joueurs (vivants d'abord) + PNJ de la carte affichée. */
function candidates(state, mapId) {
    const m = findMap(state, mapId) || state.map;
    return [
        ...aliveFirst(state.characters).map((c) => ({ kind: 'char', ref: c.id, name: c.name, e: c })),
        ...m.npcs.map((n) => ({ kind: 'npc', ref: n.id, name: n.name, e: n })),
    ];
}

/** Formulaire PV de zone (réutilisé par l'onglet Combat et la modale de la carte). */
export function hpAreaHtml(state, mapId, preselect = []) {
    const list = state.combat.active
        ? state.combat.order.map((o) => ({ kind: o.kind, ref: o.ref, name: combatEntity(state, o)?.name || o.name, e: combatEntity(state, o) })).filter((x) => x.e)
        : candidates(state, mapId);
    return `<form class="stack" data-submit="cb.hp">
        <div class="chips">${list.map((x) => `<label class="chip-check ${deadCls(x.e)}"><input type="checkbox" name="t" value="${tgtKey(x.kind, x.ref)}" ${preselect.includes(tgtKey(x.kind, x.ref)) ? 'checked' : ''}>
            ${x.kind === 'npc' ? '<i class="fa-solid fa-skull"></i>' : '<i class="fa-solid fa-user"></i>'} ${esc(x.name)} <small>${esc(x.e.hp)}/${esc(x.e.hpMax || '∞')}</small></label>`).join('') || '<span class="muted small">Aucune cible.</span>'}</div>
        <div class="row wrap"><button type="button" class="btn ghost sm" data-act="cb.selAll">Tout cocher</button>
            <input name="amount" type="number" min="1" value="5" class="w-num" required>
            <button class="btn bad" name="dir" value="dmg"><i class="fa-solid fa-burst"></i> Dégâts</button>
            <button class="btn ok" name="dir" value="heal"><i class="fa-solid fa-heart-circle-plus"></i> Soins</button></div>
    </form>`;
}

export function combatPanelHtml(state, mapId) {
    const c = state.combat;
    const stats = `<label class="w-sel2">Initiative : d20 +<select data-bind="rules|initStat"><option value="">rien</option>${state.rules.stats.map((s) => `<option value="${esc(s.key)}" ${state.rules.initStat === s.key ? 'selected' : ''}>${esc(s.label)}${state.rules.dice.mode === 'under' ? ' ÷ 10' : ''}</option>`).join('')}</select></label>`;
    if (!c.active) {
        const list = candidates(state, mapId);
        return `<section class="card">
            <h4><i class="fa-solid fa-shield-halved"></i> Engager un combat</h4>
            <form class="stack" data-submit="cb.start">
                <div class="chips">${list.map((x) => `<label class="chip-check ${deadCls(x.e)}"><input type="checkbox" name="p" value="${tgtKey(x.kind, x.ref)}" ${!isDead(x.e) && (x.kind === 'char' || x.e.visible !== false) ? 'checked' : ''}>
                    ${x.kind === 'npc' ? '<i class="fa-solid fa-skull"></i>' : avatarHtml(x.e)} ${esc(x.name)}</label>`).join('')}</div>
                <div class="row wrap">${stats}<button class="btn"><i class="fa-solid fa-dice-d20"></i> Tirer l'initiative et commencer</button></div>
                <p class="muted small">Les PNJ proposés sont ceux de la carte affichée dans l'onglet Carte. Les joueurs voient l'ordre du tour (sans les PNJ masqués ou sous le brouillard).</p>
            </form>
        </section>
        <section class="card"><h4><i class="fa-solid fa-burst"></i> Dégâts / soins de zone</h4>${hpAreaHtml(state, mapId)}</section>`;
    }
    const inOrder = new Set(c.order.map((o) => tgtKey(o.kind, o.ref)));
    const addable = candidates(state, mapId).filter((x) => !inOrder.has(tgtKey(x.kind, x.ref)));
    const rows = c.order.map((o, i) => {
        const e = combatEntity(state, o);
        if (!e) return `<div class="cb-row gone"><span class="grow muted">${esc(o.name)} (retiré de la carte)</span><button class="icon-btn danger" data-act="cb.remove" data-id="${o.id}"><i class="fa-solid fa-xmark"></i></button></div>`;
        const scope = o.kind === 'npc' ? `npc:${e.id}` : `char:${e.id}`;
        return `<div class="cb-row ${i === c.turn ? 'current' : ''} ${deadCls(e)}">
            <span class="cb-turn">${i === c.turn ? '<i class="fa-solid fa-play"></i>' : i + 1}</span>
            ${o.kind === 'npc' && !e.avatar ? `<span class="avatar npc" style="--c:${esc(e.color)}"><i class="fa-solid fa-skull"></i></span>` : avatarHtml(e)}
            <span class="grow"><b>${esc(e.name)}${deadMark(e)}</b>${o.kind === 'npc' && e.visible === false ? ' <small class="muted"><i class="fa-solid fa-eye-slash"></i> masqué</small>' : ''}
                ${e.hpMax ? hpBar(e.hp, e.hpMax) : ''}</span>
            <label class="cb-init" title="Initiative">Init<input type="number" data-bind="combo:${o.id}|init" value="${esc(o.init)}" class="w-hp"></label>
            <label class="cb-init" title="PV">PV<input type="number" data-bind="${scope}|hp" value="${esc(e.hp)}" class="w-hp"></label>
            <button class="icon-btn" data-act="cb.reroll" data-id="${o.id}" title="Relancer l'initiative"><i class="fa-solid fa-dice"></i></button>
            <button class="icon-btn" data-act="cb.goto" data-index="${i}" title="Donner la main"><i class="fa-solid fa-hand-point-right"></i></button>
            <button class="icon-btn danger" data-act="cb.remove" data-id="${o.id}" title="Retirer du combat"><i class="fa-solid fa-xmark"></i></button>
        </div>`;
    }).join('');
    return `<section class="card">
        <div class="row wrap"><h4 class="grow"><i class="fa-solid fa-shield-halved"></i> Round ${esc(c.round)} — au tour de <b>${esc(combatEntity(state, c.order[c.turn] || {})?.name || '—')}</b></h4>
            <button class="btn ghost sm" data-act="cb.prev" title="Tour précédent (Maj+N)"><i class="fa-solid fa-backward-step"></i></button>
            <button class="btn sm" data-act="cb.next" title="Tour suivant (N)"><i class="fa-solid fa-forward-step"></i> Suivant</button>
            <button class="btn ghost sm" data-act="cb.sort"><i class="fa-solid fa-arrow-down-wide-short"></i> Trier</button>
            <button class="btn bad sm" data-act="cb.end"><i class="fa-solid fa-flag-checkered"></i> Fin du combat</button></div>
        <div class="cb-list mt">${rows}</div>
        ${addable.length ? `<form class="row mt" data-submit="cb.add"><select name="who" class="grow">${addable.map((x) => `<option value="${tgtKey(x.kind, x.ref)}">${x.kind === 'npc' ? '☠ ' : ''}${esc(x.name)}</option>`).join('')}</select>
            <button class="btn ghost sm"><i class="fa-solid fa-plus"></i> Ajouter (initiative tirée)</button></form>` : ''}
        <div class="row wrap mt">${stats}</div>
    </section>
    <section class="card"><h4><i class="fa-solid fa-burst"></i> Dégâts / soins de zone</h4>${hpAreaHtml(state, mapId)}</section>`;
}

const parse = (v) => { const [kind, ref] = String(v).split(':'); return { kind, ref }; };
const entityName = (s, t) => (t.kind === 'npc' ? findNpc(s, t.ref) : findChar(s, t.ref))?.name || '?';

registerActions({
    'cb.start': (form) => {
        const s = store.state;
        const ps = [...form.querySelectorAll('input[name="p"]:checked')].map((i) => parse(i.value)).map((t) => ({ ...t, name: entityName(s, t) }));
        if (!ps.length) throw new Error('Choisissez au moins un participant.');
        startCombat(s, ps);
        beep(330, 0.2, 'sawtooth');
        store.commit('structure');
    },
    'cb.next': () => { nextTurn(store.state, 1); beep(700, 0.05); store.commit('structure'); },
    'cb.prev': () => { nextTurn(store.state, -1); store.commit('structure'); },
    'cb.goto': (el) => { store.state.combat.turn = Number(el.dataset.index); store.commit('structure'); },
    'cb.sort': () => {
        const c = store.state.combat;
        const cur = c.order[c.turn];
        sortCombat(c);
        c.turn = Math.max(0, c.order.indexOf(cur));
        store.commit('structure');
    },
    'cb.end': () => { endCombat(store.state); store.commit('structure'); },
    'cb.reroll': (el) => {
        const o = store.state.combat.order.find((x) => x.id === el.dataset.id);
        if (o) { toast(`${o.name} : initiative ${rollInitiative(store.state, o)}`, 'info'); store.commit('structure'); }
    },
    'cb.remove': (el) => {
        const c = store.state.combat;
        const i = c.order.findIndex((x) => x.id === el.dataset.id);
        if (i < 0) return;
        c.order.splice(i, 1);
        if (i < c.turn) c.turn--;
        if (c.turn >= c.order.length) c.turn = 0;
        if (!c.order.length) endCombat(store.state);
        store.commit('structure');
    },
    'cb.add': (form) => {
        const s = store.state;
        const t = parse(form.who.value);
        const o = { id: `co${Date.now().toString(36)}`, ref: t.ref, kind: t.kind, name: entityName(s, t), init: 0 };
        rollInitiative(s, o);
        const cur = s.combat.order[s.combat.turn];
        s.combat.order.push(o);
        sortCombat(s.combat);
        s.combat.turn = Math.max(0, s.combat.order.indexOf(cur));
        toast(`${o.name} rejoint le combat (initiative ${o.init}).`, 'info');
        store.commit('structure');
    },
    'cb.selAll': (el) => {
        const boxes = [...el.closest('form').querySelectorAll('input[name="t"]')];
        const all = boxes.every((b) => b.checked);
        boxes.forEach((b) => { b.checked = !all; });
    },
    'cb.hp': (form, e) => {
        const targets = [...form.querySelectorAll('input[name="t"]:checked')].map((i) => parse(i.value));
        if (!targets.length) throw new Error('Cochez au moins une cible.');
        const amount = Math.abs(Number(form.amount.value) || 0);
        const dir = e.submitter?.value === 'heal' ? 1 : -1;
        const n = applyHpMany(store.state, targets, dir * amount);
        toast(`${dir < 0 ? 'Dégâts' : 'Soins'} ${amount} PV → ${n} cible(s).`, dir < 0 ? 'warn' : 'ok');
        form.closest('.modal-backdrop')?.querySelector('[data-close]')?.click();
        store.commit('structure');
    },
});

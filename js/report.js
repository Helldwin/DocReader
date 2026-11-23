// Brouillon automatique de rapport de session : chronologie des jets, achats, transactions
// et événements marquants. Le MJ n'a plus qu'à le réécrire en récit avant de publier.
import { uid, fmtTime } from './util.js';
import { findChar } from './iris-file.js';
import { OUTCOME_LABEL, describeRoll } from './dice.js';
import { isRevealed } from './fog.js';

/** Bornes de la session à résumer : celle en cours, sinon la précédente. */
export function reportRange(state) {
    const s = state.session;
    if (s.startedAt) return { from: s.startedAt, to: Date.now() };
    if (s.lastSession) return { from: s.lastSession.startedAt, to: s.lastSession.endedAt };
    return { from: 0, to: Date.now() };
}

/**
 * Bilan de la session : différences entre l'état au début (session.startSnapshot) et maintenant —
 * PV, morts, argent, objets gagnés / perdus, documents obtenus, lieux découverts, scènes jouées.
 * Retourne des lignes de texte (vide s'il n'y a pas d'état de départ).
 */
export function sessionSummary(state) {
    const snap = state.session.startSnapshot;
    if (!snap) return [];
    const cur = state.rules.currency;
    const out = [];
    for (const c of state.characters) {
        const was = snap.chars[c.id];
        if (!was) { out.push(`• ${c.name} rejoint l'équipe.`); continue; }
        const bits = [];
        const dead = c.hpMax > 0 && c.hp <= 0;
        if (dead && !was.dead) bits.push('✝ MORT');
        else if (!dead && was.dead) bits.push('revenu à la vie');
        if (c.hp !== was.hp && !dead) bits.push(`PV ${was.hp} → ${c.hp}/${c.hpMax}`);
        if (c.money !== was.money) bits.push(`${c.money > was.money ? '+' : '−'}${Math.abs(c.money - was.money)} ${cur}`);
        const inv = {};
        for (const i of c.inventory) inv[i.name] = (inv[i.name] || 0) + i.qty;
        const gained = Object.entries(inv).filter(([n, q]) => q > (was.inv[n] || 0)).map(([n, q]) => `${n}${q - (was.inv[n] || 0) > 1 ? ` ×${q - (was.inv[n] || 0)}` : ''}`);
        const lost = Object.entries(was.inv).filter(([n, q]) => q > (inv[n] || 0)).map(([n, q]) => `${n}${q - (inv[n] || 0) > 1 ? ` ×${q - (inv[n] || 0)}` : ''}`);
        if (gained.length) bits.push(`obtient : ${gained.join(', ')}`);
        if (lost.length) bits.push(`perd : ${lost.join(', ')}`);
        const docs = c.docs.filter((d) => !was.docs.includes(d)).map((d) => state.documents.find((x) => x.id === d)?.title).filter(Boolean);
        if (docs.length) bits.push(`documents : ${docs.join(', ')}`);
        if (bits.length) out.push(`• ${c.name} — ${bits.join(' · ')}`);
    }
    for (const m of state.maps) {
        const before = new Set(snap.revealed?.[m.id] || []);
        const found = m.markers.filter((k) => !before.has(k.name) && isRevealed(m, k.x, k.y)).map((k) => k.name);
        if (found.length && (m.fog.enabled || before.size)) out.push(`• Lieux découverts (${m.name}) : ${found.join(', ')}`);
    }
    const played = state.scenes.filter((sc) => sc.done && sc.session === state.meta.sessionNumber).map((sc) => sc.title);
    if (played.length) out.push(`• Scènes jouées : ${played.join(', ')}`);
    return out;
}

export function draftReport(state, { from, to } = reportRange(state)) {
    const cur = state.rules.currency;
    const name = (id) => findChar(state, id)?.name || '?';
    const inRange = (x) => x.ts >= from && x.ts <= to;
    const events = [];

    for (const r of state.rolls.filter(inRange)) {
        const what = r.table ? 'tirage sur table' : r.statLabel ? `jet de ${r.statLabel}` : `jet libre d${r.sides}`;
        const label = r.label ? `« ${r.label} » — ` : '';
        const secret = r.public ? '' : '  ⚠ jet secret : à retirer ou à censurer';
        events.push({ ts: r.ts, text: `${r.charName} : ${label}${what} → ${OUTCOME_LABEL[r.outcome]} (${describeRoll(r)})${secret}` });
    }
    for (const l of state.ledger.filter(inRange)) {
        const t = {
            credit: `${name(l.charId)} reçoit ${l.amount} ${cur} (${l.text})`,
            debit: `${name(l.charId)} paie ${l.amount} ${cur} (${l.text})`,
            purchase: `${name(l.charId)} achète ${l.text} pour ${l.amount} ${cur}`,
            transfer: `${name(l.charId)} vire ${l.amount} ${cur} à ${name(l.to)}${l.text && !l.text.startsWith('Virement') ? ` (${l.text})` : ''}`,
            item: `${name(l.charId)} donne ${l.text}`,
        }[l.kind];
        if (t) events.push({ ts: l.ts, text: t });
    }
    for (const e of (state.log || []).filter(inRange)) events.push({ ts: e.ts, text: e.text });
    events.sort((a, b) => a.ts - b.ts);

    const date = new Date(from || Date.now());
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const party = state.characters.filter((c) => Object.values(state.session.assignments).includes(c.id)).map((c) => c.name).join(', ');
    const lines = events.map((e) => `${fmtTime(e.ts)} — ${e.text}`);
    const summary = from === state.session.startedAt ? sessionSummary(state) : [];
    const content = [
        '[Résumé à rédiger : racontez la session à la manière d\'un rapport I.R.I.S.]',
        '',
        party ? `Joueurs présents : ${party}` : '',
        '',
        ...(summary.length ? ['— Bilan de la session —', ...summary, ''] : []),
        `— Chronologie (brouillon automatique, ${events.length} événement(s)) —`,
        ...lines,
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');

    return { id: uid('j'), date: iso, title: `Session ${state.meta.sessionNumber} — brouillon`, tags: ['Brouillon'], content };
}

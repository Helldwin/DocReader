// Brouillon automatique de rapport de session : chronologie des jets, achats, transactions
// et événements marquants. Le MJ n'a plus qu'à le réécrire en récit avant de publier.
import { uid, fmtTime } from './util.js';
import { findChar } from './iris-file.js';
import { OUTCOME_LABEL, describeRoll } from './dice.js';

/** Bornes de la session à résumer : celle en cours, sinon la précédente. */
export function reportRange(state) {
    const s = state.session;
    if (s.startedAt) return { from: s.startedAt, to: Date.now() };
    if (s.lastSession) return { from: s.lastSession.startedAt, to: s.lastSession.endedAt };
    return { from: 0, to: Date.now() };
}

export function draftReport(state, { from, to } = reportRange(state)) {
    const cur = state.rules.currency;
    const name = (id) => findChar(state, id)?.name || '?';
    const inRange = (x) => x.ts >= from && x.ts <= to;
    const events = [];

    for (const r of state.rolls.filter(inRange)) {
        const what = r.statLabel ? `jet de ${r.statLabel}` : `jet libre d${r.sides}`;
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
    const content = [
        '[Résumé à rédiger : racontez la session à la manière d\'un rapport I.R.I.S.]',
        '',
        party ? `Agents présents : ${party}` : '',
        '',
        `— Chronologie (brouillon automatique, ${events.length} événement(s)) —`,
        ...lines,
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');

    return { id: uid('j'), date: iso, title: `Session ${state.meta.sessionNumber} — brouillon`, tags: ['Brouillon'], content };
}

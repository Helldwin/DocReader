// Moteur de dés. Deux modes configurables dans le .iris (Planifier > Règles) :
//  - "under" : jet ≤ (stat + modificateur) = réussite (ex : d100 façon Appel de Cthulhu)
//  - "over"  : jet + stat + modificateur ≥ difficulté = réussite (ex : d20)
// Les critiques portent sur le résultat naturel du dé.

/** Entier uniforme dans [1, sides], sans biais de modulo. */
export function rollDie(sides) {
    sides = Math.max(2, Math.floor(sides));
    const limit = Math.floor(0x100000000 / sides) * sides;
    const a = new Uint32Array(1);
    do crypto.getRandomValues(a); while (a[0] >= limit);
    return (a[0] % sides) + 1;
}

/**
 * @param {object} dice  rules.dice
 * @param {object} p     { statValue, mod, difficulty, roll? }  (roll forcé pour les tests)
 * @returns {{roll:number, target:number|null, total:number, outcome:string}}
 *   outcome ∈ 'crit-success' | 'success' | 'fail' | 'crit-fail' | 'raw'
 */
export function resolveRoll(dice, { statValue = null, mod = 0, difficulty = null, roll = null } = {}) {
    const r = roll ?? rollDie(dice.sides);
    const m = Number(mod) || 0;

    if (statValue === null || statValue === undefined) {
        // Jet libre (dégâts, hasard…) : pas de réussite/échec.
        return { roll: r, target: null, total: r + m, outcome: 'raw' };
    }

    if (dice.mode === 'over') {
        const total = r + Number(statValue) + m;
        const target = Number(difficulty ?? dice.defaultDifficulty ?? 10);
        let outcome = total >= target ? 'success' : 'fail';
        if (dice.critSuccess && r >= dice.critSuccess) outcome = 'crit-success';
        else if (dice.critFail && r <= dice.critFail) outcome = 'crit-fail';
        return { roll: r, target, total, outcome };
    }

    // mode "under"
    const target = Number(statValue) + m;
    let outcome = r <= target ? 'success' : 'fail';
    if (dice.critSuccess && r <= dice.critSuccess) outcome = 'crit-success';
    else if (dice.critFail && r >= dice.critFail) outcome = 'crit-fail';
    return { roll: r, target, total: r, outcome };
}

export const OUTCOME_LABEL = {
    'crit-success': 'Réussite critique',
    success: 'Réussite',
    fail: 'Échec',
    'crit-fail': 'Échec critique',
    raw: 'Résultat',
};

export function describeRoll(r) {
    const mod = r.mod ? ` ${r.mod > 0 ? '+' : '−'} ${Math.abs(r.mod)}` : '';
    if (r.outcome === 'raw') return `d${r.sides}${mod} → ${r.total}`;
    if (r.mode === 'over') return `d${r.sides} (${r.roll}) + ${r.statLabel} ${r.statValue}${mod} = ${r.total} vs ${r.target}`;
    return `d${r.sides} → ${r.roll} / seuil ${r.target} (${r.statLabel} ${r.statValue}${mod})`;
}

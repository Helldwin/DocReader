// Modèles de PNJ prêts à l'emploi et générateur de noms (ambiance française / surnaturelle).
import { rollDie } from './dice.js';

const pick = (a) => a[rollDie(a.length) - 1];

const FIRST = ['Adèle', 'Albane', 'Anatole', 'Armand', 'Aurèle', 'Basile', 'Bérénice', 'Blanche', 'Camille', 'Céleste', 'Clément', 'Colette', 'Corentin', 'Daphné',
    'Edmond', 'Éloïse', 'Émile', 'Ernest', 'Faustine', 'Félix', 'Gaspard', 'Gustave', 'Hélène', 'Honoré', 'Inès', 'Isaure', 'Jules', 'Josèphe', 'Léon', 'Lucien',
    'Madeleine', 'Margaux', 'Marius', 'Mathilde', 'Octave', 'Odile', 'Philémon', 'Prudence', 'Rosalie', 'Sidonie', 'Solène', 'Théodore', 'Victorine', 'Yvon', 'Zélie'];
const LAST = ['Arnaud', 'Beaumont', 'Bellanger', 'Corbin', 'Delacroix', 'Desmarais', 'Duval', 'Fauvel', 'Guérin', 'Hallé', 'Kerjean', 'Lancelin', 'Le Goff', 'Lemoine',
    'Marchal', 'Morvan', 'Noirot', 'Ollivier', 'Pellerin', 'Quéméner', 'Ravel', 'Rozenn', 'Sauvage', 'Tanguy', 'Vasseur', 'Verlaine', 'Villiers'];
const SYL = ['ka', 'zor', 'ul', 'mor', 'th', 'xa', 'gr', 'esh', 'vyr', 'om', 'na', 'ith', 'rak', 'sul', 'aë', 'dra', 'quo', 'zh'];
const EPITHET = ['le Silencieux', 'aux Mille Yeux', 'des Profondeurs', 'qui Murmure', 'de la Brume', 'l\'Affamé', 'sans Visage', 'du Phare', 'des Échos'];

/** Nom humain (prénom + nom). */
export const humanName = () => `${pick(FIRST)} ${pick(LAST)}`;

/** Nom d'entité surnaturelle. */
export function creatureName() {
    let n = '';
    const k = 2 + rollDie(2);
    for (let i = 0; i < k; i++) n += pick(SYL);
    n = n.charAt(0).toUpperCase() + n.slice(1);
    return rollDie(2) === 1 ? `${n} ${pick(EPITHET)}` : n;
}

export const randomName = (kind) => (/cr[ée]ature|boss/i.test(kind || '') ? creatureName() : humanName());

/** Modèles rapides pour la banque PNJ & créatures. */
export const NPC_TEMPLATES = [
    { id: 'civil', label: 'Civil', kind: 'PNJ', color: '#b388ff', hpMax: 8, stats: 'Aucun entraînement au combat.\nFuit au premier signe de danger.', desc: 'Habitant ordinaire, témoin potentiel.' },
    { id: 'garde', label: 'Garde / vigile', kind: 'Ennemi', color: '#ff8c00', hpMax: 12, stats: 'Combat rapproché 50 · Armes à feu 40\nMatraque 1d6 · Pistolet 1d10', desc: 'Uniforme, radio à la ceinture, plus prudent que courageux.' },
    { id: 'agent', label: 'Agent I.R.I.S.', kind: 'Ennemi', color: '#ffd900', hpMax: 14, stats: 'Combat 60 · Discrétion 55 · Perception 60\nArme de service 1d10 · Neutraliseur (Volonté ou paralysé 1 round)', desc: 'Costume sombre, oreillette, regard qui ne cligne jamais.' },
    { id: 'cultiste', label: 'Cultiste', kind: 'Ennemi', color: '#ff3b3b', hpMax: 10, stats: 'Combat rapproché 45 · Rituel 55\nDague 1d4 · Incantation : peur (Volonté −20)', desc: 'Capuche, symboles gravés sur les avant-bras, psalmodie.' },
    { id: 'bete', label: 'Bête', kind: 'Créature', color: '#7CFC00', hpMax: 16, stats: 'Morsure 60 · 1d8\nCharge : renverse (Esquiver −10)', desc: 'Animal sauvage ou altéré, imprévisible.' },
    { id: 'spectre', label: 'Spectre', kind: 'Créature', color: '#40e0d0', hpMax: 10, stats: 'Intangible : immunisé aux armes ordinaires\nToucher glacial 1d6 + Volonté ou terreur', desc: 'Silhouette translucide, la température chute à son approche.' },
    { id: 'abomination', label: 'Abomination', kind: 'Créature', color: '#ff5ca8', hpMax: 30, stats: 'Attaques multiples 2× 1d10\nRégénère 2 PV / round · Vue de l\'Abîme (Volonté ou 1d4 de santé mentale)', desc: 'Chairs qui ne devraient pas exister dans ce monde.' },
    { id: 'boss', label: 'Boss', kind: 'Boss', color: '#ff3b3b', hpMax: 50, stats: 'Agit deux fois par round\nCapacité signature à définir\nPhase 2 sous 50 % PV', desc: 'Antagoniste majeur.' },
];

// =====================================================================
//  I.R.I.S. — Configuration globale (seul fichier à adapter en général)
// =====================================================================
export const CONFIG = {
    // ID client d'une application Discord (https://discord.com/developers/applications)
    // avec l'URL de session.html déclarée en "Redirect". Laisser vide pour désactiver
    // le contrôle Discord. Les ID Discord autorisés à héberger sont dans le .iris
    // (Planifier > Campagne > "ID Discord MJ autorisés").
    DISCORD_CLIENT_ID: '1570089733738995792',

    // Préfixe des identifiants PeerJS (évite les collisions avec d'autres sites).
    PEER_PREFIX: 'iris-jdr-v2-',

    // Options PeerJS. Vide = serveur public gratuit 0.peerjs.com.
    // Exemple serveur perso : { host: 'peer.mondomaine.fr', port: 443, path: '/', secure: true }
    PEER_OPTIONS: {},

    // Journal publié (lu par le portail et par la vue joueur).
    JOURNAL_URL: 'data/journal.json',

    // Délai de sauvegarde automatique dans le navigateur (ms).
    AUTOSAVE_DEBOUNCE_MS: 400,

    // Itérations PBKDF2 (doit rester identique au format des fichiers .enc existants).
    PBKDF2_ITERATIONS: 100000,

    // Nombre maximum de jets / transactions conservés dans le .iris.
    MAX_ROLLS: 200,
    MAX_LEDGER: 500,
};

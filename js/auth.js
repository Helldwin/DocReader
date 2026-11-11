// Contrôle Discord (OAuth2 "implicit grant", 100% côté navigateur, aucun secret stocké).
// Le MJ se connecte avec Discord ; son ID doit figurer dans gm.discordIds du .iris.
// NB : c'est une barrière d'usage, pas une sécurité absolue (tout tourne chez le client) —
// la vraie clé reste le fichier .iris, qui ne quitte jamais l'ordinateur du MJ.
import { CONFIG } from './config.js';

const SS_USER = 'iris.discordUser';
const SS_NONCE = 'iris.discordNonce';

export const discordConfigured = () => !!CONFIG.DISCORD_CLIENT_ID;

/** Le .iris exige-t-il une vérification Discord ? */
export const discordRequired = (state) => discordConfigured() && (state?.gm?.discordIds?.length || 0) > 0;

export function currentDiscordUser() {
    try { return JSON.parse(sessionStorage.getItem(SS_USER) || 'null'); } catch { return null; }
}

export function isAuthorizedGm(state) {
    if (!discordRequired(state)) return true;
    const u = currentDiscordUser();
    return !!u && state.gm.discordIds.includes(String(u.id));
}

function redirectUri() {
    return location.origin + location.pathname;
}

export function startDiscordLogin() {
    const nonce = crypto.randomUUID();
    sessionStorage.setItem(SS_NONCE, nonce);
    const params = new URLSearchParams({
        client_id: CONFIG.DISCORD_CLIENT_ID,
        response_type: 'token',
        redirect_uri: redirectUri(),
        scope: 'identify',
        state: nonce,
        prompt: 'none',
    });
    location.href = 'https://discord.com/oauth2/authorize?' + params;
}

/** À appeler au démarrage : récupère le jeton dans l'URL au retour de Discord. */
export async function consumeDiscordRedirect() {
    if (!location.hash.includes('access_token=')) return null;
    const p = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', location.pathname + location.search);
    const expected = sessionStorage.getItem(SS_NONCE);
    sessionStorage.removeItem(SS_NONCE);
    if (!expected || p.get('state') !== expected) throw new Error('Réponse Discord invalide (state).');
    const res = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `${p.get('token_type') || 'Bearer'} ${p.get('access_token')}` },
    });
    if (!res.ok) throw new Error('Impossible de lire le profil Discord.');
    const u = await res.json();
    const user = { id: String(u.id), name: u.global_name || u.username };
    sessionStorage.setItem(SS_USER, JSON.stringify(user));
    return user;
}

export function discordLogout() {
    sessionStorage.removeItem(SS_USER);
}

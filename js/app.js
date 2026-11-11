// Point d'entrée de session.html : accueil, routage entre les vues, reprise après crash.
import { store } from './store.js';
import { installDelegation, registerActions } from './ui.js';
import { esc, pickFile, readText, toast, fmtDateTime, confirmBox, debounce } from './util.js';
import { newCampaign, parse, serialize } from './iris-file.js';
import { fsSupported, openWithPicker, forgetHandle, restoreHandle, writeIris, canWriteSilently } from './filesave.js';
import { mountSpectator, unmountSpectator } from './spectator.js';
import { loadAutosave, clearAutosave, prefs } from './storage.js';
import { discordRequired, isAuthorizedGm, currentDiscordUser, startDiscordLogin, consumeDiscordRedirect, discordLogout } from './auth.js';
import { mountPlanner, unmountPlanner } from './planner.js';
import { mountGm, unmountGm } from './gm.js';
import { mountPlayer, unmountPlayer } from './player.js';
import './editors.js';

const app = document.getElementById('app');
let current = null;

function unmountCurrent() {
    if (current === 'planner') unmountPlanner();
    if (current === 'gm') unmountGm();
    if (current === 'player') unmountPlayer();
    if (current === 'spectator') unmountSpectator();
    current = null;
}

function go(route, opts = {}) {
    unmountCurrent();
    current = route;
    document.body.dataset.route = route;
    if (route === 'home') return renderHome(opts.message);
    if (route === 'planner') {
        store.meta.role = 'planner';
        store.flush();
        return mountPlanner(app, { onHost: () => startHosting(), onExit: () => leaveGm() });
    }
    if (route === 'gm') {
        store.meta.role = 'gm';
        store.meta.pendingHost = false;
        store.flush();
        return mountGm(app, { onExit: () => { store.unload(); go('home', { message: 'Session terminée. Le fichier .iris a été enregistré.' }); } });
    }
    if (route === 'player') {
        return mountPlayer(app, { code: opts.code, name: opts.name, onExit: (message) => go('home', { message }) });
    }
    if (route === 'spectator') {
        return mountSpectator(app, { code: opts.code, name: opts.name, obs: opts.obs, onExit: (message) => go('home', { message }) });
    }
}

async function leaveGm() {
    if (store.dirty && !(await confirmBox('Des modifications n\'ont pas été enregistrées dans le .iris. Elles restent dans la sauvegarde automatique de ce navigateur. Quitter quand même ?', 'Quitter'))) return;
    store.unload();
    go('home');
}

// ---------------------------------------------------------------- Accueil
async function renderHome(message) {
    const params = new URLSearchParams(location.search);
    const joinCode = (params.get('join') || prefs.get('lastCode', '') || '').toUpperCase();
    const auto = await loadAutosave();
    const u = currentDiscordUser();
    app.innerHTML = `<div class="home">
        <header class="home-head">
            <svg class="sigil big" viewBox="0 0 100 100"><polygon points="50,6 94,90 6,90"/><circle cx="50" cy="64" r="17"/><circle cx="50" cy="64" r="5" fill="currentColor"/></svg>
            <div><h1>I.R.I.S.</h1><p>Terminal de session — Institut de Recherche et d'Investigation Surnaturelle</p></div>
        </header>
        ${message ? `<div class="notice">${esc(message)}</div>` : ''}
        ${auto?.state ? `<div class="notice warn row wrap">
            <i class="fa-solid fa-life-ring"></i>
            <span class="grow">Sauvegarde automatique trouvée : <b>${esc(auto.state.meta.title)}</b> — ${esc(auto.role === 'gm' ? 'session en cours' : 'planification')} du ${fmtDateTime(auto.savedAt)}${auto.state.meta.updatedAt > (auto.exportedAt || 0) + 50 ? ' · <b>non exportée</b>' : ''}</span>
            <button class="btn" data-act="home.resume"><i class="fa-solid fa-rotate-left"></i> Reprendre</button>
            <button class="btn ghost" data-act="home.discard">Supprimer</button></div>` : ''}
        <div class="home-grid">
            <section class="card home-card">
                <h2><i class="fa-solid fa-right-to-bracket"></i> Rejoindre une session</h2>
                <p class="muted">Entrez le code donné par votre MJ.</p>
                <form class="stack" data-submit="home.join">
                    <label>Code de session<input name="code" class="mono code-input" value="${esc(joinCode)}" maxlength="8" required autocomplete="off" placeholder="ABC123"></label>
                    <label>Votre pseudo<input name="name" value="${esc(prefs.get('playerName', ''))}" maxlength="40" required placeholder="Pseudo"></label>
                    <button class="btn" value="play"><i class="fa-solid fa-satellite-dish"></i> Rejoindre</button>
                    <button class="btn ghost" value="watch" title="Écran de diffusion en lecture seule (stream / OBS)"><i class="fa-solid fa-video"></i> Regarder en spectateur</button>
                </form>
            </section>
            <section class="card home-card">
                <h2><i class="fa-solid fa-tower-broadcast"></i> Héberger (MJ)</h2>
                <p class="muted">Importez votre fichier <code>.iris</code> pour ouvrir la session. Rien n'est stocké en ligne : en fin de partie, vous récupérez le fichier mis à jour.</p>
                <button class="btn full" data-act="home.host"><i class="fa-solid fa-file-import"></i> Importer un .iris et héberger</button>
                ${u ? `<p class="muted small mt"><i class="fa-brands fa-discord"></i> ${esc(u.name)} <button class="btn ghost sm" data-act="home.discordOut">Déconnexion</button></p>` : ''}
            </section>
            <section class="card home-card">
                <h2><i class="fa-solid fa-compass-drafting"></i> Planifier une session</h2>
                <p class="muted">Créez une campagne, ses personnages, documents, carte et rapports — ou ajustez un .iris existant.</p>
                <div class="stack">
                    <button class="btn full" data-act="home.plan"><i class="fa-solid fa-file-pen"></i> Ouvrir un .iris</button>
                    <button class="btn ghost full" data-act="home.new"><i class="fa-solid fa-plus"></i> Nouvelle campagne</button>
                </div>
            </section>
        </div>
        <footer class="home-foot"><a href="index.html"><i class="fa-solid fa-arrow-left"></i> Retour au portail</a></footer>
    </div>`;
    if (joinCode && params.get('join')) app.querySelector('input[name="name"]').focus();
}

async function importIris() {
    const auto = await loadAutosave();
    if (auto?.state && auto.state.meta.updatedAt > (auto.exportedAt || 0) + 50 &&
        !(await confirmBox('Une sauvegarde automatique NON enregistrée existe dans ce navigateur. Ouvrir un autre fichier l\'écrasera. Continuer ?', 'Écraser'))) return false;
    // Chrome / Edge : on garde un lien vers le fichier pour réenregistrer dedans directement.
    let f;
    if (fsSupported) f = await openWithPicker();
    else { await forgetHandle(); f = await pickFile('.iris,application/json'); }
    if (!f) return false;
    const state = parse(await readText(f));
    store.load(state, 'planner', { exportedAt: Date.now() + 1000 });
    toast(`« ${state.meta.title} » chargé${fsSupported ? ' — les enregistrements iront directement dans ce fichier' : ''}.`, 'ok', 4500);
    return true;
}

// Réécriture silencieuse dans le fichier .iris ouvert (si le navigateur l'a déjà autorisé).
const autoFileSave = debounce(async () => {
    if (!store.state || !['planner', 'gm'].includes(store.meta.role) || !store.dirty) return;
    if (!(await canWriteSilently())) return;
    try {
        if (await writeIris(serialize(store.state), { ask: false })) { store.markExported(); store.commit('update', { saved: true }); }
    } catch (e) { console.warn('[IRIS] sauvegarde fichier', e); }
}, 8000);
store.on((evt) => { if (!evt.saved) autoFileSave(); });

async function startHosting() {
    const s = store.state;
    if (!s) return;
    if (!discordRequired(s) || isAuthorizedGm(s)) return go('gm');
    const u = currentDiscordUser();
    unmountCurrent();
    current = 'gate';
    app.innerHTML = `<div class="home"><section class="card home-card gate">
        <h2><i class="fa-brands fa-discord"></i> Vérification du MJ</h2>
        ${u ? `<p class="error">Le compte Discord <b>${esc(u.name)}</b> (ID ${esc(u.id)}) n'est pas autorisé à héberger « ${esc(s.meta.title)} ».</p>`
        : `<p>Ce fichier .iris est réservé à un MJ identifié. Connectez-vous avec Discord pour ouvrir la session.</p>`}
        <div class="row wrap"><button class="btn" data-act="gate.login"><i class="fa-brands fa-discord"></i> ${u ? 'Changer de compte' : 'Se connecter avec Discord'}</button>
        <button class="btn ghost" data-act="gate.back">Retour</button></div></section></div>`;
}

registerActions({
    'home.join': (form, e) => {
        const code = form.code.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        const name = form.name.value.trim();
        if (code.length < 4) throw new Error('Code invalide.');
        prefs.set('playerName', name);
        prefs.set('lastCode', code);
        if (e?.submitter?.value === 'watch') return go('spectator', { code, name: name || 'Spectateur' });
        go('player', { code, name });
    },
    'home.host': async () => { if (await importIris()) startHosting(); },
    'home.plan': async () => { if (await importIris()) go('planner'); },
    'home.new': async () => { await forgetHandle(); store.load(newCampaign(), 'planner'); go('planner'); },
    'home.resume': async () => {
        const auto = await loadAutosave();
        if (!auto?.state) return;
        store.load(parse(JSON.stringify(auto.state)), auto.role || 'planner', { exportedAt: auto.exportedAt });
        if (auto.role === 'gm' || auto.pendingHost) startHosting(); else go('planner');
    },
    'home.discard': async () => {
        if (!(await confirmBox('Supprimer définitivement la sauvegarde automatique ? Les modifications non exportées seront perdues.', 'Supprimer'))) return;
        await clearAutosave();
        renderHome();
    },
    'home.discordOut': () => { discordLogout(); renderHome(); },
    'gate.login': async () => {
        store.meta.pendingHost = true;
        store.flush();
        await new Promise((r) => setTimeout(r, 150)); // laisse IndexedDB terminer l'écriture
        discordLogout();
        startDiscordLogin();
    },
    'gate.back': () => { go('planner'); },
});

// ---------------------------------------------------------------- Démarrage
(async function boot() {
    installDelegation();
    await restoreHandle();
    // Lien direct spectateur (OBS) : session.html?watch=CODE[&obs=1][&name=...]
    const params = new URLSearchParams(location.search);
    const watch = (params.get('watch') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (watch) return go('spectator', { code: watch, name: params.get('name') || 'Stream', obs: params.get('obs') === '1' });
    try {
        const user = await consumeDiscordRedirect();
        if (user) {
            const auto = await loadAutosave();
            if (auto?.state && auto.pendingHost) {
                store.load(parse(JSON.stringify(auto.state)), 'planner', { exportedAt: auto.exportedAt, pendingHost: true });
                toast(`Connecté à Discord : ${user.name}`, 'ok');
                return startHosting();
            }
        }
    } catch (e) {
        toast(e.message, 'error', 6000);
    }
    go('home');
})();

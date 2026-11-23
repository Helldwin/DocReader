# I.R.I.S. — Portail de Campagne

Portail rétrofuturiste pour l'Institut de Recherche et d'Investigation Surnaturelle (I.R.I.S.), utilisé comme hub de campagne JDR :
- séquence de démarrage terminal au boot
- hub d'accueil avec bandeau d'avertissement, badge d'habilitation et tuiles de navigation
- **Archives** : documents chiffrés classés par catégorie, protégés par code d'accès
- **Dossier Perso** : fiche d'agent individuelle, protégée par le même système de code
- **Carte du Monde** : carte interactive (pan/zoom, marqueurs) basée sur une image
- **Journal de Campagne** : compte-rendus de session, chronologiques et dépliables
- **Bestiaire / Codex** : fiches d'entités classées par niveau de danger
- alerte "Accès Refusé" (flash + tampon) en cas de code invalide
- viewer PDF centré avec tampon de classification, horloge de session et thème par type de document
- support A4 + carré, PageFlip stabilisé
- compatible GitHub Pages, 100% statique (aucun serveur/backend requis)
- **Terminal de session** (`session.html`) : partie en temps réel MJ ↔ joueurs (voir ci-dessous)

## Lancer

Ouvrir index.html
ou déployer sur GitHub Pages.

## Brancher votre système réel

Tout est dans index.html (pas d'app.js séparé) :
- `_getDbUrl()` : endpoint Google Sheet (obfusqué en base64 inversé)
- `deriveDecryptKey` / `decryptBuffer` : logique PBKDF2 + AES-GCM
- `vault/*.enc` : archives chiffrées référencées par la feuille (colonnes type, code, url)

## Archives vs Dossier Perso

Les deux utilisent la même feuille Google Sheet (colonnes `type, code, url`) et le même chiffrement AES.
- Une ligne avec `type = dossier` n'apparaît **pas** dans la grille des Archives : elle est réservée à la tuile "Dossier Perso" du hub.
- Pour donner à un joueur l'accès à sa fiche : ajoutez une ligne `dossier, <code du joueur>, <url du .pdf.enc>` (même procédé de chiffrement que pour les autres archives).
- Un joueur ne peut voir que le dossier correspondant à son propre code — pas de sélection de classification, juste le code.

## Carte du Monde (`data/carte.json`)

```json
{
  "image": "vault/Iris_Map.png",
  "width": 2000,
  "height": 1400,
  "markers": [
    { "name": "Siège I.R.I.S.", "x": 1000, "y": 700, "desc": "...", "icon": "fa-building-shield" }
  ]
}
```
- Ajoutez votre image de carte dans `vault/` (ou toute autre URL accessible) et référencez-la dans `image`.
- `width`/`height` doivent correspondre aux dimensions réelles de l'image en pixels.
- `x`/`y` d'un marqueur sont des coordonnées pixel depuis le coin haut-gauche de l'image.
- `icon` est un nom d'icône Font Awesome solid (ex. `fa-building-shield`), optionnel.
- Si l'image est absente ou introuvable, un message de repli s'affiche automatiquement — aucune erreur bloquante.

## Journal de Campagne (`data/journal.json`)

Tableau d'entrées `{ date, title, tags[], content }`, trié par date décroissante à l'affichage. Chaque entrée est un accordéon dépliable dans le hub.

## Bestiaire / Codex (`data/bestiaire.json`)

Tableau d'entrées `{ name, type, danger, description }`. `danger` accepte `Faible`, `Modéré`, `Élevé` ou `Critique` (la couleur du badge s'adapte automatiquement). Cliquer sur une carte ouvre la fiche complète.

---

# Terminal de session (`session.html`)

Application de jeu en direct, toujours **100 % statique** : le navigateur du MJ fait office de serveur et les joueurs s'y connectent en pair-à-pair (WebRTC via [PeerJS](https://peerjs.com), relais public gratuit pour la mise en relation). Aucune base de données : tout vit dans le fichier `.iris` du MJ.

## Déroulé d'une partie

1. **Planifier une session** → *Nouvelle campagne* (ou *Ouvrir un .iris*) : campagne (avec check-list de la prochaine session), règles et dés, personnages, PNJ & créatures, scénario (scènes), documents, cartes, boutiques, ambiance, codex & lore, rapports. *Enregistrer le .iris*.
2. **Héberger (MJ)** → importer le `.iris`. Le code de session s'affiche en haut (clic = copie du lien d'invitation `session.html?join=CODE`).
3. Les joueurs vont sur **Rejoindre une session**, saisissent le code + leur pseudo, et attendent en salle d'attente.
4. Dans le panneau *Connexions*, le MJ attribue un personnage à chaque joueur. L'attribution est mémorisée : un joueur qui recharge sa page (ou revient la session suivante depuis le même navigateur) retrouve son personnage automatiquement.
5. **Terminer** → le `.iris` est enregistré (options : générer un brouillon de rapport, passer au numéro de session suivant). C'est lui qu'il faudra ouvrir la prochaine fois.

**Enregistrement** : sous Chrome / Edge, le `.iris` ouvert est réenregistré **directement dans le même fichier** (*Enregistrer .iris*), puis automatiquement quelques secondes après chaque modification. Sous Firefox / Safari, une copie est téléchargée. L'icône ⬇ télécharge toujours une copie.

**Anti-crash** : chaque modification est aussi sauvegardée en continu dans le navigateur du MJ (IndexedDB). Après un plantage ou un F5, l'accueil propose *Reprendre* : la session repart avec le même code et les joueurs se reconnectent tout seuls.

## Ce que fait chaque vue

| Vue MJ | Vue joueur |
|---|---|
| **Fiche** : tout modifier en direct (PV, statut, stats, argent avec crédit/débit motivé, inventaire, accès aux documents, bio, notes secrètes) | **Fiche** : stats, dossier, derniers jets |
| **Dés** : choisir le personnage, bonus/malus, puis cliquer sur une stat ; jet public ou secret ; jet libre (dN) | Animation du jet sur l'écran de tous |
| **Carte** : choisir parmi les cartes, *Montrer cette carte aux joueurs* (on prépare une carte pendant qu'ils en voient une autre), glisser les jetons, **PNJ / ennemis** (fiches de la banque avec portrait et PV, ou PNJ rapide), **brouillard de guerre** par carte | **Carte** (si le MJ l'affiche), jetons en direct, brouillard opaque |
| **Scènes** : les scènes prévues pour la session ; *Lancer* = carte affichée, musique, document à l'écran, documents remis aux présents, boutiques ouvertes, PNJ posés masqués. Notes, objectifs et fiches du codex sous les yeux | Tout ce que la scène déclenche, en direct |
| **Codex** : le lore importé (pages, diagrammes, synopsis), réservé au MJ | — |
| **Messages** : une conversation privée par personnage, badge de non-lus | **MJ** : chat privé avec le MJ |
| **Documents** : donner l'accès, *Montrer à tous* (ouvre le document chez chaque joueur), éditer, chiffrer un PDF | **Documents** : lecteur intégré (PDF, `.enc`, image, texte) |
| **Commerce** : ouvrir / fermer les boutiques, ajuster prix et stocks en direct | **Boutique** (si une est ouverte) : acheter, débit automatique, objet ajouté à l'inventaire |
| **Ambiance** : lancer une musique en boucle ou un effet ponctuel chez tous (🔊 dans la barre = écoute locale du MJ) | Lecture automatique de l'ambiance |
| | **Inventaire** : donner un objet, virer de l'argent à un autre agent, historique des transactions |
| | **Rapports** : journal avec ses passages censurés déclassifiés ; **Groupe** : agents connectés |

Un joueur ne reçoit **que** ses propres données (jamais les notes MJ, les messages ou l'inventaire des autres, ni les jets secrets). Les PNJ masqués ou situés sous le brouillard ne sont pas envoyés du tout.

## Vue spectateur (stream / OBS)

Écran de diffusion en lecture seule pour un Actual Play : carte et jetons, bandeau du groupe (PV), derniers jets avec la même animation que les joueurs, documents montrés à tous, ambiance sonore.

- Bouton 🎥 dans la barre MJ → copie le lien `session.html?watch=CODE&obs=1`.
- Dans OBS : *Source* → *Navigateur*, coller le lien, 1920×1080. `obs=1` rend le fond transparent (sans effet CRT) pour l'incrustation ; sans ce paramètre, la vue garde le thème I.R.I.S.
- Cochez *Contrôler l'audio via OBS* pour récupérer l'ambiance dans le stream.
- Depuis l'accueil, *Regarder en spectateur* ouvre la même vue. Un spectateur apparaît dans *Connexions* (exclusion possible) et ne peut rien modifier.

## Préparer une session (Planifier)

- **Personnages** : stats, PV, argent, inventaire, documents, bio, notes MJ, et un bloc **Identité** de champs libres visibles du joueur (titre, âge, profession, caractéristiques…). Les champs proposés par défaut se règlent dans *Règles & dés › Fiche d'identité*.
- **PNJ & créatures** : banque de fiches réutilisables (portrait, type, PV, caractéristiques, description, notes MJ). En session, on les pose sur n'importe quelle carte, en plusieurs exemplaires.
- **Scénario** : chaque scène a un n° de session, un déroulé, des objectifs/indices et ce qu'elle déclenche au lancement (carte, musique, document à l'écran, documents à distribuer, PNJ, boutiques) + des pages du codex en référence.
- **Cartes** : autant de cartes que voulu (monde, ville, donjon…), chacune avec ses lieux, jetons, PNJ et brouillard. La carte ★ active est celle que voient les joueurs. *Dupliquer* copie l'image et les lieux.
- **Campagne** : check-list de la prochaine session (scènes prévues, cartes prêtes, PNJ, documents, ambiance, codex).

## Import d'un projet Amsel Suite (`.lore`)

*Planifier › Codex & lore › Importer un .lore* lit l'archive directement dans le navigateur (rien n'est envoyé en ligne). Chaque partie est optionnelle :

| Dans le .lore | Devient |
|---|---|
| Pages (lieux, opérations, artefacts, quêtes…) + synopsis | **Codex** MJ : recherche, filtres par modèle, renvois cliquables, « Mentionné dans », *Créer un document joueur* |
| Diagrammes (ex. *Résumé du plot*) | Visualiseur : glisser / molette, recherche (Entrée = suivant), détail d'un nœud, causes / conséquences, lien vers la fiche |
| Cartes + épingles | Cartes de la campagne, épingles → lieux (nom et description de la page liée) |
| Fiches PJ | Personnages : compétences → stats (d100 « sous la stat »), identité (titre, âge, caractéristiques, profession, compétence unique), PV, blessures → statut, lore → bio, portrait, arme unique → inventaire |
| Fiches PNJ / créatures | Banque PNJ & créatures |

Réimporter met à jour le codex, les cartes et la banque ; les personnages existants ne sont modifiés que si l'option est cochée (jamais leurs PV en cours, leur argent ni leur inventaire). Les illustrations sont ré-encodées en vignettes WebP (≈ 0,7 Mo pour un projet de 50 pages). Le codex n'est **jamais** envoyé aux joueurs.

## Brouillon de rapport automatique

Pendant la session, l'appli note les jets (avec intitulé et résultat), achats, crédits/débits, dons, virements, documents donnés ou montrés, boutiques ouvertes et musiques lancées. En fin de session (case cochée par défaut) ou via *Planifier > Rapports > Brouillon automatique*, un rapport « Session N — brouillon » est créé avec la chronologie horodatée. Il ne reste qu'à le réécrire en récit, puis à le publier. Les jets secrets y sont signalés ⚠, pour que vous les retiriez ou les censuriez.

## Règles de dés (Planifier > Règles & dés)

- **Sous la stat** (préréglage d100) : réussite si le dé ≤ stat + bonus ; critique si dé ≤ 5, échec critique si dé ≥ 96.
- **Stat + jet vs difficulté** (préréglage d20) : réussite si dé + stat + bonus ≥ difficulté ; critiques sur 20 / 1.
- Faces, seuils critiques, difficulté par défaut et liste des statistiques sont modifiables.

## Rapports & passages censurés

Dans *Planifier > Rapports*, sélectionnez un passage puis *Censurer* (ou tapez `[[secret:Nom du personnage]]texte[[/secret]]`).
*Publier → journal.json* télécharge le fichier à placer dans `data/journal.json` (puis `git push`). Chaque passage censuré y est **chiffré (AES-256-GCM)** avec la clé du personnage : il n'est lisible ni sur le portail ni dans l'inspecteur F12. Seul un joueur **connecté en session avec ce personnage** reçoit la clé et voit le passage en clair (onglet *Rapports*). *Reprendre le journal du site* réimporte un journal publié dans le `.iris`.

## Documents

- Gros PDF : chiffrez-les avec *Chiffrer un PDF pour vault/* (même format que les archives du portail), déposez le `.enc` dans `vault/`, le chemin et le code sont remplis automatiquement.
- Petits fichiers : *Importer* les intègre directement dans le `.iris` (transmis aux joueurs à la demande).
- Document texte : rédigez directement le contenu (lettre, télégramme…).

## Contrôle Discord du MJ (optionnel)

1. Créez une application sur https://discord.com/developers/applications → *OAuth2* → *Redirects* : ajoutez l'URL exacte de `session.html` (ex. `https://<compte>.github.io/DocReader/session.html`).
2. Renseignez son *Client ID* dans `js/config.js` (`DISCORD_CLIENT_ID`).
3. Dans *Planifier > Campagne*, ajoutez les ID Discord autorisés (*Ajouter mon ID* une fois connecté).

Un `.iris` avec des ID renseignés ne peut alors être hébergé qu'après connexion Discord d'un compte autorisé. C'est une barrière d'usage (tout s'exécute dans le navigateur) : la vraie protection reste le fichier `.iris`, qui ne doit jamais être publié (`*.iris` est dans `.gitignore`).

## Format `.iris`

JSON lisible (version 2) : `meta`, `gm`, `rules` (stats, dés, monnaie, champs d'identité), `characters` (stats, identité, PV, argent, inventaire, docs, bio, notes MJ, clé secrète), `documents`, `maps[]` (image, lieux, jetons, PNJ, brouillard) + `activeMapId` / `mapShared`, `bestiary` (banque PNJ), `scenes`, `lore` (codex importé), `shops` (articles, prix, stocks), `ambience` (pistes audio), `chats`, `ledger` (transactions), `rolls`, `log` (événements), `journal`, `session` (code, attributions, début de session, scène en cours). Les champs manquants sont complétés à l'import (`js/iris-file.js` → `normalize`) : un ancien fichier reste toujours lisible (un `.iris` v1 à carte unique devient automatiquement la « Carte principale »). Un `.iris` v2 ne s'ouvre pas avec une version antérieure de l'appli.

## Organisation du code

```
session.html        page de l'application (aucune étape de build)
css/session.css     thème (couleurs dans :root)
js/config.js        réglages : Discord, serveur PeerJS, URL du journal
js/app.js           accueil, routage, reprise après crash
js/planner.js       vue Planifier
js/gm.js            vue MJ + traitement des demandes joueurs
js/player.js        vue joueur
js/spectator.js     vue spectateur (stream / OBS)
js/editors.js       fiche personnage, document, boutique, ambiance (partagés MJ & planif)
js/game.js          règles métier (transferts, achats, jets, vue filtrée par joueur)
js/report.js        brouillon automatique de rapport
js/lore.js          import Amsel Suite (.lore : tar + data.json) → codex, cartes, PJ, PNJ
js/codex.js         codex MJ : pages, synopsis, visualiseur de diagrammes
js/fog.js           brouillard de guerre (grille compacte)
js/audio.js         lecteur d'ambiance · js/rolloverlay.js animation des jets
js/filesave.js      enregistrement direct dans le .iris (Chrome / Edge)
js/dice.js  js/journal.js  js/crypto.js  js/map.js  js/docviewer.js
js/net.js           réseau P2P (hôte / client, reconnexion, heartbeat)
js/store.js  js/storage.js  js/iris-file.js  js/ui.js  js/util.js  js/auth.js
```

Tester en local : `python -m http.server` à la racine puis http://localhost:8000/session.html (ouvrir un 2ᵉ navigateur ou une fenêtre privée pour jouer un joueur).

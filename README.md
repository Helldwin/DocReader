# I.R.I.S. — Portail de Campagne

Portail rétrofuturiste pour l'Institut de Recherche et d'Investigation Surnaturelle (I.R.I.S.), utilisé comme hub de campagne JDR :
- séquence de démarrage terminal au boot
- hub d'accueil avec bandeau d'avertissement, badge d'habilitation et tuiles de navigation
- **un code agent unique par joueur** : il ouvre tout ce qui le concerne, même sans session en cours
- **Archives** : documents chiffrés de l'agent, classés par catégorie
- **Dossier Perso** : fiche d'agent (identité, compétences, PV, équipement, bio) + pièces du dossier
- **Carte** : cartes publiées par le MJ (brouillard de guerre appliqué), pan/zoom, lieux
- **Journal de Campagne** : compte-rendus de session, avec les passages censurés déclassifiés pour l'agent
- **Bestiaire / Codex** : entités rencontrées, classées par niveau de danger
- alerte "Accès Refusé" (flash + tampon) en cas de code invalide
- viewer PDF « livre » avec tampon de classification, horloge de session et thème par type de document
- compatible GitHub Pages, 100% statique (aucun serveur/backend requis)
- **Terminal de session** (`session.html`) : partie en temps réel MJ ↔ joueurs (voir ci-dessous)

## Lancer

Ouvrir index.html
ou déployer sur GitHub Pages.

## Accès agent (portail)

Tout le contenu du portail est produit par le terminal : **Planifier › Portail joueurs › Publier**. Rien n'est à éditer à la main.

1. Chaque personnage a un **code agent** (ex. `K7QM-2XRP-9TDA`, modifiable : on peut reprendre le code que le joueur connaît déjà, 8 caractères minimum). Donnez-le au joueur.
2. Préparez le contenu dans le .iris : documents donnés au personnage (ou publics), cartes cochées *Portail*, fiches PNJ cochées *Connue des agents*, rapports.
3. *Publier dans le dossier du dépôt* (Chrome / Edge, écrit directement les fichiers) ou *Télécharger le .zip* (à extraire à la racine du dépôt), puis `git push`.
4. Sur le portail, le joueur saisit son code une fois (option *Mémoriser sur cet appareil*) : toutes les tuiles s'ouvrent.

| Fichier publié | Contenu |
|---|---|
| `data/portal.json` | titre, date de publication, sel public (aucun secret) |
| `vault/agents/<id>.enc` | **paquet de l'agent**, chiffré avec son code : fiche, liste de ses documents avec leurs clés, cartes, bestiaire connu, clé de déclassification du journal. `<id>` est dérivé du code (PBKDF2) : impossible de savoir quel fichier appartient à qui |
| `vault/docs/<docId>.enc` | documents importés dans le .iris (PDF, images), chiffrés une seule fois avec leur propre clé |
| `vault/maps/<mapId>.enc` | cartes, brouillard déjà appliqué (les lieux encore cachés ne sont pas publiés) |
| `data/journal.json` | journal public ; chaque passage censuré est chiffré avec la clé du personnage concerné |

- Les archives déjà chiffrées dans `vault/*.enc` (ancien système) sont **réutilisées telles quelles** : ajoutez-les comme document (chemin `vault/Rapport.pdf.enc` + leur code), donnez-les aux personnages concernés, publiez.
- Catégorie contenant « Dossier » → tuile **Dossier Perso** ; autres catégories → **Archives**.
- `vault/agents`, `vault/docs` et `vault/maps` sont gérés par la publication : les fichiers obsolètes (code changé, document retiré) y sont supprimés.
- Changer un code puis republier rend l'ancien inutilisable. Un joueur ne voit jamais les documents d'un autre, ni les notes MJ, ni les PNJ non publiés.
- La Google Sheet et `data/carte.json` / `data/bestiaire.json` ne sont plus utilisés par le portail.

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

## Confort de jeu (vue MJ)

| | |
|---|---|
| **Combat** | Onglet *Combat* : participants (joueurs + PNJ de la carte), initiative d20 (+ statistique choisie), tour en cours, PV en direct, ajout en cours de combat. Les joueurs et le stream voient l'ordre du tour (sans les PNJ masqués). |
| **PV de zone** | Dégâts ou soins sur plusieurs cibles d'un coup (onglet Combat ou bouton *PV de zone* de la carte). |
| **Jets de groupe** | Onglet Dés : même compétence pour tous les joueurs connectés (ou tous les vivants), tableau des résultats. |
| **Jets des joueurs** | Les joueurs cliquent sur leurs statistiques ; selon *Règles & dés* : refusé, direct, ou validé par le MJ (public / secret / refus) depuis la colonne de gauche. |
| **Tables aléatoires** | *Planifier › Tables aléatoires* (une entrée par ligne, « 3x » = pondération) ; tirage d'un clic dans l'onglet Dés, public ou secret. |
| **Minuteur / chrono** | Colonne de gauche ; affiché chez les joueurs et sur le stream, alerte à zéro. |
| **Carte** | Pinceau *Zone +* / *Zone −* (rectangle), notes MJ épinglées et déplaçables (jamais envoyées), *Ping* (ou Alt+clic) visible de tous — les joueurs peuvent pinger aussi. |
| **Annuler / rétablir** | Ctrl+Z / Ctrl+Y (hors champ de saisie), boutons dans la barre : fiches, carte, brouillard, combat… (pas les messages ni la session en direct). |
| **Recherche** | Ctrl+K : personnages, PNJ, documents, scènes, cartes, lieux, codex, boutiques, pistes, tables. |
| **Raccourcis** | 1-9 joueur, R relancer, N / Maj+N tour suivant / précédent, F outil de brouillard, P ping, ? aide. |
| **Connexions** | Latence et dernier signal de chaque joueur, bouton pour renvoyer la vue complète à un joueur bloqué. |
| **Bilan de session** | À la fin, le brouillon de rapport commence par un bilan : PV, morts, argent, objets gagnés / perdus, documents obtenus, lieux découverts, scènes jouées. |
| **Préparation** | Modèles rapides de PNJ + noms aléatoires, duplication de personnages et de fiches PNJ, export / import d'un personnage seul (`.personnage.json`). |

Côté joueur : carnet personnel (sauvegardé dans le .iris, lisible par le MJ), notifications quand un document, un objet ou de l'argent est reçu, effet visuel en cas de blessure, de mort ou de soin.

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

## Export vers Amsel Suite (`.lore`)

*Planifier › Codex & lore › Exporter en .lore* : choisissez votre `.lore` actuel, une **copie mise à jour** est téléchargée (`… (DocReader AAAA-MM-JJ).lore`) ; l'original n'est jamais modifié. Les nouvelles pages sont construites à partir des modèles du projet.

| Dans le .iris | Dans la copie .lore |
|---|---|
| Personnages | Fiches PJ : PV, blessures, identité, compétences, caractéristiques, lore (la rune « Nom » et les liens vers d'autres pages ne sont pas écrasés) ; nouveaux personnages → nouvelles fiches PJ avec portrait |
| PNJ & créatures | Fiches PNJ / Créature (description, caractéristiques, notes MJ) |
| Lieux des cartes | Pages « Lieu » + épingles ; position mise à jour si le lieu a été déplacé ; cartes créées dans l'appli → nouvelles cartes Amsel |
| Rapports | Pages « Opération » sous le séparateur *Rapports de session* (passages censurés en clair, notés « Réservé à … ») |
| Scènes | Pages « Quête » sous le séparateur *Scénario* (déroulé, objectifs, liens vers les fiches) |

Chaque élément exporté retient sa page : un nouvel export met à jour les mêmes pages au lieu de les dupliquer — repartez donc de la dernière copie exportée. Restent hors du .lore : codes agents, argent, jets, brouillard, documents chiffrés.

## Archives existantes de `vault/`

*Planifier › Documents › Scanner vault/* liste les `.enc` déposés à la racine de `vault/` (dossier local sous Chrome / Edge, sinon le dépôt GitHub `GITHUB_REPO` de `js/config.js`) et les déclare comme documents : titre et catégorie d'après le nom, destinataire deviné (nom du personnage ou pseudo du joueur). Collez l'URL CSV de l'ancienne Google Sheet pour récupérer les codes : chacun est vérifié par un vrai déchiffrement.

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
js/report.js        brouillon automatique de rapport + bilan de session
js/combat.js        onglet Combat (initiative, tours, PV de zone)
js/history.js       annuler / rétablir
js/search.js        recherche globale Ctrl+K
js/timer.js         minuteur et bandeau de combat (joueur / stream)
js/names.js         modèles de PNJ et noms aléatoires
js/lore.js          import Amsel Suite (.lore : tar + data.json) → codex, cartes, PJ, PNJ
js/codex.js         codex MJ : pages, synopsis, visualiseur de diagrammes
js/lore-export.js   export .iris → copie .lore (Amsel Suite)
js/vault-scan.js    scan des archives .enc de vault/ (+ codes de l'ancienne Google Sheet)
js/publish.js       publication du portail joueurs (paquets agents, documents, cartes, .zip)
js/portal-data.js   format du portail : code agent, dérivation du fichier, lecture côté index.html
js/fog.js           brouillard de guerre (grille compacte)
js/audio.js         lecteur d'ambiance · js/rolloverlay.js animation des jets
js/filesave.js      enregistrement direct dans le .iris (Chrome / Edge)
js/dice.js  js/journal.js  js/crypto.js  js/map.js  js/docviewer.js
js/net.js           réseau P2P (hôte / client, reconnexion, heartbeat)
js/store.js  js/storage.js  js/iris-file.js  js/ui.js  js/util.js  js/auth.js
```

Tester en local : `python -m http.server` à la racine puis http://localhost:8000/session.html (ouvrir un 2ᵉ navigateur ou une fenêtre privée pour jouer un joueur).

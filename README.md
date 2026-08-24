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

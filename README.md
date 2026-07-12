# I.R.I.S. — Portail d'Archives Classifiées

Portail rétrofuturiste pour l'Institut de Recherche et d'Investigation Surnaturelle (I.R.I.S.) :
- séquence de démarrage terminal au boot
- portail d'accueil avec bandeau d'avertissement et badge d'habilitation
- sélection de la classification du document par cartes (au lieu d'un menu déroulant)
- alerte "Accès Refusé" (flash + tampon) en cas de code invalide
- viewer PDF centré avec tampon de classification, horloge de session et thème par type de document
- support A4 + carré, PageFlip stabilisé
- compatible GitHub Pages

## Lancer

Ouvrir index.html
ou déployer sur GitHub Pages.

## Brancher votre système réel

Tout est dans index.html (pas d'app.js séparé) :
- `_getDbUrl()` : endpoint Google Sheet (obfusqué en base64 inversé)
- `deriveDecryptKey` / `decryptBuffer` : logique PBKDF2 + AES-GCM
- `vault/*.enc` : archives chiffrées référencées par la feuille (colonnes type, code, url)

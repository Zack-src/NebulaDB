# Suivi des updates

Lot lancé le 2026-10-09 sur la branche `updates` (partie de `main` au commit `de5c5f6`).
Un commit par changement. Cocher une ligne quand son commit est sur `updates`, avec son hash.

État : `[ ]` à faire · `[~]` en cours · `[x]` fait · `[!]` bloqué (raison à côté).

## A. Base de données de Nebula : SQLite → PostgreSQL

Branche à part `feat/postgres-storage`, fusionnée dans `updates` quand le serveur démarre et que
les tests passent. PostgreSQL seul (SQLite n'est plus un stockage possible pour Nebula ; il reste
un moteur cible pour les projets).

- [~] A1. Couche d'accès asynchrone (`pg`, pool, transactions) à la place de `better-sqlite3`
- [~] A2. Schéma PostgreSQL de départ (équivalent des migrations 1 à 45) et migrations suivantes
- [~] A3. Conversion des modules serveur (requêtes et appelants en `async`)
- [~] A4. Tests serveur sur PostgreSQL (une base isolée par fichier de test)
- [~] A5. Outil de bascule d'une instance SQLite existante vers PostgreSQL
- [~] A6. Configuration, Docker Compose, README, sauvegarde/restauration en ligne de commande
- [ ] A7. Fusion dans `updates` et conversion des requêtes ajoutées entre-temps par les lots B à F

## B. Lot 1 — petits conforts

- [x] B1. Message à la restauration d'un projet qui revient détaché d'une connexion — `9f04aee`
- [x] B2. Tables ignorées par la surveillance : sélecteur au lieu du champ texte — `2e7aeaf`
- [x] B3. Variables d'environnement : tableau clé/valeur, variables manquantes signalées — `7e8882c`
- [x] B4. Base d'un projet sur une connexion : liste des bases du serveur + « créer » — `72b58bc`

## C. Lot 2 — SQL

- [x] C1. Éditeur SQL (coloration, complétion des tables et colonnes du schéma) — `5932a4c`, `478534c`
- [x] C2. Requêtes enregistrées — `3b11f8f`
- [~] C3. Édition de lignes dans la grille de résultats

## D. Lot 3 — navigation

- [x] D1. Formulaire de connexion en onglets (Connexion / Règles / Projets) — `3b5bef6`
- [x] D2. Palette `Ctrl+K` globale (projets, tables, onglets, connexions) — `b7dd320`, `f10d6b9`

## E. Lot 4 — déploiement et droits

- [~] E1. Revue avant production (demande, approbation par une autre personne, déploiement)
- [~] E2. Rôle « peut déployer » sans être administrateur du projet

## F. Lot 5 — le reste

- [x] F1. Alertes de surveillance : e-mail, acquittement, mise en sourdine — `a9c6b69`, `0c8bc97`, `8f6a98e`
- [x] F2. Dictionnaire : description multi-ligne, export PDF — `7c33923`, `692f305`
- [~] F3. Export des migrations en fichiers versionnés (Flyway / Liquibase)
- [ ] F4. CLI / action GitHub
- [ ] F5. Suggestions d'index à partir des statistiques de requêtes
- [ ] F6. Lien de partage en lecture seule (diagramme, dictionnaire)
- [ ] F7. Sauvegardes vers S3 / SFTP (en plus du dossier ou partage monté)

## G. Dette repérée en route

- [ ] G1. Remettre à niveau les 11 tests navigateur (e2e) qui échouent déjà sur `de5c5f6` : ils
      attendent des éléments retirés par la refonte (« Ouvrir », onglet « Données & SQL », « Déployer »)
- [ ] G3. Test serveur instable sous charge : « /api/v1 backups: a running backup is cancelled with a key »
- [ ] G2. Formater `bundle.ts` et `bundle.test.ts` (avertissement Prettier antérieur à ce lot)

## En attente d'une décision de Zack

- SSO (quel fournisseur, OIDC ou SAML)
- Tunnel SSH et autorité de certification TLS personnalisée
- IA optionnelle (quel service, quelles données peuvent sortir de l'instance)
- Variantes d'un projet par client (format d'export, profondeur de la hiérarchie)

## Journal

| Date       | Ligne | Commit    | Note                                                                                                                               |
| ---------- | ----- | --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-09 | B3    | `7e8882c` | Table clé/valeur + variables manquantes ; e2e réécrit, non lancé                                                                   |
| 2026-10-09 | B1    | `9f04aee` | Avertissement (toast) + champ `detachedConnections` dans la réponse, API v1 comprise                                               |
| 2026-10-09 | B2    | `2e7aeaf` | Pastilles + liste à cocher avec recherche ; nom hors schéma accepté                                                                |
| 2026-10-09 | B4    | `72b58bc` | Liste des bases du serveur (datalist), état « existe / sera créée », doublons signalés                                             |
| 2026-10-09 | C1    | `478534c` | Éditeur CodeMirror : dialecte par moteur, complétion tables/colonnes ; essayé en navigateur sur SQLite seulement                   |
| 2026-10-09 | D2    | `b7dd320` | Palette globale ; ne s'ouvre pas depuis l'éditeur DBML (Ctrl+K y est un préfixe de raccourcis) ; e2e dédié passé chez l'agent      |
| 2026-10-09 | D1    | `3b5bef6` | Onglets Connexion / Règles / Projets, un seul Enregistrer, repère « ! » sur l'onglet fautif ; refait par-dessus la liste des bases |
| 2026-10-09 | F2    | `692f305` | Descriptions multi-lignes (notes DBML en triple quote) et export PDF côté navigateur ; pas de `format=pdf` dans l'API              |
| 2026-10-09 | C2    | `3b11f8f` | Requêtes enregistrées, privées ou partagées ; migration 46 ; 344 tests serveur passent après intégration                           |
| 2026-10-09 | F1    | `8f6a98e` | E-mail sur abonnement (option par compte), acquittement, sourdine avec durée ; migrations 47 à 49 ; relais SMTP réel non essayé    |

Vérifié après intégration des quatre lignes B : 337 tests serveur, 121 tests web, typecheck et lint propres.
Non vérifié : tests navigateur (e2e) et essai à la main des écrans.

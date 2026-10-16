# Suivi des updates

Lot lancé le 2026-10-09 sur la branche `updates` (partie de `main` au commit `de5c5f6`).
Un commit par changement. Cocher une ligne quand son commit est sur `updates`, avec son hash.

État : `[ ]` à faire · `[~]` en cours · `[x]` fait · `[!]` bloqué (raison à côté).

## A. Base de données de Nebula : SQLite → PostgreSQL

Branche à part `feat/postgres-storage`, fusionnée dans `updates` quand le serveur démarre et que
les tests passent. PostgreSQL seul (SQLite n'est plus un stockage possible pour Nebula ; il reste
un moteur cible pour les projets).

- [x] A1. Couche d'accès asynchrone (`pg`, pool, transactions) à la place de `better-sqlite3` — `bf1e9de` (branche `feat/postgres-storage`)
- [x] A2. Schéma PostgreSQL de départ (équivalent des migrations 1 à 45) et migrations suivantes — `bf1e9de` (branche `feat/postgres-storage`)
- [x] A3. Conversion des modules serveur (requêtes et appelants en `async`) — `bf1e9de`, `b31cc17`, `94ec99d` (branche `feat/postgres-storage`)
- [x] A4. Tests serveur sur PostgreSQL (une base isolée par fichier de test) — `bf1e9de` (branche `feat/postgres-storage`)
- [x] A5. Outil de bascule d'une instance SQLite existante vers PostgreSQL — `b7c8638` (branche `feat/postgres-storage`)
- [x] A6. Configuration, Docker Compose, README, sauvegarde/restauration en ligne de commande — `7a9877c` (branche `feat/postgres-storage`)
- [x] A7. Fusion dans `updates` et conversion des requêtes ajoutées entre-temps par les lots B à F — `81a9e94`

## B. Lot 1 — petits conforts

- [x] B1. Message à la restauration d'un projet qui revient détaché d'une connexion — `9f04aee`
- [x] B2. Tables ignorées par la surveillance : sélecteur au lieu du champ texte — `2e7aeaf`
- [x] B3. Variables d'environnement : tableau clé/valeur, variables manquantes signalées — `7e8882c`
- [x] B4. Base d'un projet sur une connexion : liste des bases du serveur + « créer » — `72b58bc`

## C. Lot 2 — SQL

- [x] C1. Éditeur SQL (coloration, complétion des tables et colonnes du schéma) — `5932a4c`, `478534c`
- [x] C2. Requêtes enregistrées — `3b11f8f`
- [x] C3. Édition de lignes dans la grille de résultats — `51d09c7`, `b80129e`

## D. Lot 3 — navigation

- [x] D1. Formulaire de connexion en onglets (Connexion / Règles / Projets) — `3b5bef6`
- [x] D2. Palette `Ctrl+K` globale (projets, tables, onglets, connexions) — `b7dd320`, `f10d6b9`

## E. Lot 4 — déploiement et droits

- [x] E1. Revue avant production (demande, approbation par une autre personne, déploiement) — `2fc92e9`
- [x] E2. Rôle « peut déployer » sans être administrateur du projet — `efca567`

## F. Lot 5 — le reste

- [x] F1. Alertes de surveillance : e-mail, acquittement, mise en sourdine — `a9c6b69`, `0c8bc97`, `8f6a98e`
- [x] F2. Dictionnaire : description multi-ligne, export PDF — `7c33923`, `692f305`
- [x] F3. Export des migrations en fichiers versionnés (Flyway / Liquibase) — `4b743d1`
- [~] F4. CLI / action GitHub — CLI faite (`4ca2137`, `85ea884`) ; action GitHub non faite
- [x] F5. Suggestions d'index à partir des statistiques de requêtes — `a5c7745`
- [!] F6. Lien de partage en lecture seule (diagramme, dictionnaire) — interrompu : serveur commité, interface inachevée, non intégré (branche `agent/share-links`)
- [!] F7. Sauvegardes vers S3 / SFTP (en plus du dossier ou partage monté) — interrompu sans commit, non intégré (copie `agent/backup-remote`)

## G. Dette repérée en route

- [x] G1. Remettre à niveau les 11 tests navigateur (e2e) qui échouent déjà sur `de5c5f6` : ils — `0ec4721` à `9988177`
      attendent des éléments retirés par la refonte (« Ouvrir », onglet « Données & SQL », « Déployer »)
- [x] G3. Test serveur instable sous charge : « /api/v1 backups: a running backup is cancelled with a key » — `bb090e9`
- [x] G2. Formater `bundle.ts` et `bundle.test.ts` (avertissement Prettier antérieur à ce lot) — `c2e7b46`

## H. Lot 6 — connexion sécurisée (décidé le 2026-10-16 : SSO en OIDC, tunnel SSH, TLS personnalisé)

- [x] H1. TLS personnalisé par connexion : certificat d'autorité, certificat et clé client, vérification du certificat
      (PostgreSQL, MySQL, SQL Server ; Oracle en `tcps` sans test possible)
- [x] H2. Tunnel SSH par connexion : bastion, mot de passe ou clé privée, empreinte de la clé d'hôte
- [x] H3. Formulaire de connexion : onglet « Sécurité » pour TLS et SSH, empreinte remplie au test
- [x] H4. SSO OIDC côté serveur : découverte, PKCE, compte lié par l'identifiant du fournisseur, création à la volée optionnelle
- [x] H5. SSO OIDC côté interface : bouton sur l'écran de connexion, réglages dans l'administration
- [x] H6. Documentation, CHANGELOG, vérification complète

## En attente d'une décision de Zack

- IA optionnelle (quel service, quelles données peuvent sortir de l'instance)
- Variantes d'un projet par client (format d'export, profondeur de la hiérarchie)

## Journal

| Date       | Ligne | Commit    | Note                                                                                                                                                                                                                                                       |
| ---------- | ----- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-09 | B3    | `7e8882c` | Table clé/valeur + variables manquantes ; e2e réécrit, non lancé                                                                                                                                                                                           |
| 2026-10-09 | B1    | `9f04aee` | Avertissement (toast) + champ `detachedConnections` dans la réponse, API v1 comprise                                                                                                                                                                       |
| 2026-10-09 | B2    | `2e7aeaf` | Pastilles + liste à cocher avec recherche ; nom hors schéma accepté                                                                                                                                                                                        |
| 2026-10-09 | B4    | `72b58bc` | Liste des bases du serveur (datalist), état « existe / sera créée », doublons signalés                                                                                                                                                                     |
| 2026-10-09 | C1    | `478534c` | Éditeur CodeMirror : dialecte par moteur, complétion tables/colonnes ; essayé en navigateur sur SQLite seulement                                                                                                                                           |
| 2026-10-09 | D2    | `b7dd320` | Palette globale ; ne s'ouvre pas depuis l'éditeur DBML (Ctrl+K y est un préfixe de raccourcis) ; e2e dédié passé chez l'agent                                                                                                                              |
| 2026-10-09 | D1    | `3b5bef6` | Onglets Connexion / Règles / Projets, un seul Enregistrer, repère « ! » sur l'onglet fautif ; refait par-dessus la liste des bases                                                                                                                         |
| 2026-10-09 | F2    | `692f305` | Descriptions multi-lignes (notes DBML en triple quote) et export PDF côté navigateur ; pas de `format=pdf` dans l'API                                                                                                                                      |
| 2026-10-09 | C2    | `3b11f8f` | Requêtes enregistrées, privées ou partagées ; migration 46 ; 344 tests serveur passent après intégration                                                                                                                                                   |
| 2026-10-09 | F1    | `8f6a98e` | E-mail sur abonnement (option par compte), acquittement, sourdine avec durée ; migrations 47 à 49 ; relais SMTP réel non essayé                                                                                                                            |
| 2026-10-14 | E2    | `efca567` | Niveau `deploy` entre édition et administrateur ; l'import depuis une base reste administrateur                                                                                                                                                            |
| 2026-10-14 | E1    | `2fc92e9` | Revue sur étape « Revue » : jamais par l'auteur, approbation valable 7 jours, plan refait au déploiement ; migration 50                                                                                                                                    |
| 2026-10-14 | F3    | `4b743d1` | Export SQL / Flyway / Liquibase en zip, niveau `deploy` ; formats vérifiés sur documentation seulement                                                                                                                                                     |
| 2026-10-14 | A1–A6 | `7a9877c` | Branche PostgreSQL complète sur sa base : 364 tests serveur sur PostgreSQL, bascule depuis SQLite essayée sur une vraie instance ; image Docker non construite ; pas encore fusionnée                                                                      |
| 2026-10-15 | C3    | `b80129e` | Édition de lignes depuis l'explorateur (clé primaire requise, SQL montré avant, tout ou rien)                                                                                                                                                              |
| 2026-10-15 | F5    | `a5c7745` | Suggestions d'index depuis les statistiques, ajout via le schéma du projet                                                                                                                                                                                 |
| 2026-10-15 | F4    | `85ea884` | CLI `nebuladb` (+ plan et bundle exposés en `/api/v1`) ; action GitHub non faite                                                                                                                                                                           |
| 2026-10-16 | A7    | `81a9e94` | PostgreSQL fusionné : migrations 46–50 devenues 2–6, code ajouté depuis converti ; 415 tests serveur sur PostgreSQL, 35 CLI                                                                                                                                |
| 2026-10-16 | A6    | `1468cb8` | Image Docker construite, pile `docker compose` démarrée (migrations, admin, projet, import, web OK) ; copie de l'instance locale (schéma 50) basculée vers PostgreSQL : 210 lignes, le serveur redémarre dessus                                            |
| 2026-10-16 | G1    | `9988177` | Harnais sur PostgreSQL, 12 tests remis à l'interface actuelle ; `npm run test:e2e` : 45/45, aucun bug applicatif trouvé                                                                                                                                    |
| 2026-10-16 | —     | `a4b3e2b` | Nettoyage complet (copies et branches d'agents, conteneurs de test, anciennes bases SQLite) ; installation neuve sur PostgreSQL ; les commandes en ligne lisent `.env` ; tout repassé : 415 serveur, 154 web, 158 moteur, 78 shared, 35 CLI, 45 navigateur |
| 2026-10-16 | H1–H3 | `ff111f4` | TLS (autorité, certificat client, vérification) et tunnel SSH par connexion, onglet Sécurité ; PostgreSQL et MySQL essayés, tunnel essayé avec un serveur SSH simulé ; SQL Server / Oracle non essayés                                                     |
| 2026-10-16 | H4–H5 | `cb1d2c4` | SSO OpenID Connect (PKCE, compte lié par `sub`, création optionnelle, domaines) ; essayé avec un fournisseur simulé, jamais avec un vrai Keycloak / Entra ID                                                                                               |
| 2026-10-16 | H6    | `c6b9c29` | CHANGELOG et docs ; 433 serveur, 154 web, 158 moteur, 78 shared, 35 CLI, 47/47 navigateur ; un `await` manquant corrigé dans un test d'export                                                                                                              |

Dernière vérification complète (2026-10-15, version stable) : build complet, 391 tests serveur, 154 tests web, 158 tests du moteur DBML, 35 tests CLI, typecheck, lint, Prettier et imports circulaires propres.
Non vérifié : tests navigateur (e2e) et essai à la main des écrans.

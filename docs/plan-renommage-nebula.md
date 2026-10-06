# Plan de renommage AthanorDB vers NebulaDB

Date : 6 octobre 2026. État : renommage applicatif effectué et dépôt GitHub renommé ; déplacement local en cours.

## Convention cible

- Produit et titres : `NebulaDB` ; forme courte dans les phrases : `Nebula`.
- Identifiants techniques : `nebuladb`, scope npm `@nebuladb`.
- Variables de configuration : `NEBULADB_*` ; variables des scripts `NEBULA_*` lorsqu'elles remplacent `ATHANOR_*`.
- API des plugins : `nebula.*` ; globals internes `__nebula*`.
- Remplacer les variantes selon leur contexte, sans remplacement universel aveugle.

## Inventaire

Voir `inventaire-renommage-nebula.md` pour les 452 fichiers et leurs lignes avant renommage. Le relevé inclut les fichiers ignorés et cachés, dont `apps/server/.env` et `.claude/launch.json`. Les secrets ne sont pas recopiés. Les dépendances, sorties de compilation, coverage et historique Git sont exclus ; ils ne constituent pas des sources à modifier manuellement.

Zones concernées :

| Zone                   | Emplacements principaux                                                                                                          | Travail                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Interface              | `apps/web/index.html`, `src/components/layout/Navbar.svelte`, `src/locales/fr.json`, `src/locales/en.json`, composants et styles | Nom affiché, messages, titres, commentaires, classes CSS                                 |
| Workspaces             | `package.json`, les quatre manifests sous apps/packages, `package-lock.json`, imports TS/Svelte, `eslint.config.js`              | `athanordb` et `@athanordb/*` vers `nebuladb` et `@nebuladb/*`                           |
| Serveur                | `apps/server/src/config.ts`, `shared/crypto.ts`, `index.ts`, outils bootstrap/rotation/backup et modules                         | Variables, logs, erreurs, noms et commentaires                                           |
| Déploiement            | `Dockerfile`, les quatre `docker-compose*.yml`, `.github/workflows/ci.yml`, `.claude/launch.json`                                | Services, volumes, chemins, identifiants des bases de test                               |
| Configuration locale   | `apps/server/.env`, base SQLite sous `apps/server/data`                                                                          | Migrer les noms de variables en conservant exactement leurs valeurs et la base existante |
| Persistance navigateur | `utils/theme.ts`, `utils/preferences.ts`, préférences DBML, registre plugins, `index.html`                                       | Migration des clés de stockage, y compris les clés dynamiques de viewport                |
| Plugins                | `features/plugins/sandboxRuntime.ts`, `communityTemplates.ts`, `PluginManagerDialog.svelte`, `dialog/StudioTab.svelte`, tests    | API utilisateur `athanor.*`, runtime, code d'exemple et plugins déjà enregistrés         |
| Authentification       | `modules/auth/session.ts`, `modules/auth/totp.ts`, `shared/emailTemplates.ts`                                                    | Cookie, émetteur TOTP, sujets et corps des emails                                        |
| Intégrations           | `modules/webhooks/dispatcher.ts`, `delivery.ts`, `modules/publicApi/openapi.ts`, `infrastructure/metrics.ts`                     | En-têtes, User-Agent, extension OpenAPI, noms des métriques                              |
| Formats échangés       | `packages/shared/src/backups.ts`, `modules/backups/runner.ts`, `features/editor/canvas/tableClipboard.ts`                        | Format de sauvegarde et marqueur du presse-papiers                                       |
| Tests et outils        | tests unitaires, `apps/web/e2e`, `scripts/*`, harness et outils bench                                                            | Imports, variables, fixtures, globals, sélecteurs et assertions                          |
| Documentation          | README, CHANGELOG, CONTRIBUTING, SECURITY, LICENSE, docs utilisateur/API/webhooks/légal, plans et maquettes                      | Tous les textes, exemples, commandes et références                                       |

## Ordre d'exécution

### 1. Établir les références et protéger les données

- Capturer l'état des tests et du build avant modification.
- Sauvegarder la base applicative par une méthode SQLite cohérente et relever le volume Docker utilisé.
- Laisser les données métier et bases externes inchangées. Les mentions contenues dans des données utilisateur ne sont pas des textes de marque à réécrire.
- Préserver la modification locale déjà présente dans `.claude/settings.local.json`.

### 2. Renommer les sources et les workspaces ensemble

- Mettre à jour les cinq manifests, les imports et références de scope.
- Régénérer le lockfile par npm, puis les sorties de compilation ; ne pas modifier node_modules ou dist à la main.
- Renommer marque, textes d'interface, emails, documentation, commentaires, classes et identifiants internes.
- Harmoniser les globals de benchmark/performance et leurs consommateurs dans les scripts.

### 3. Migrer la configuration et le stockage serveur

- Lire `NEBULADB_*` en priorité ; assurer une transition explicite depuis `ATHANORDB_*`. Appliquer la même résolution dans config, crypto et scripts, notamment pour SECRET et SECRET_PREVIOUS.
- Conserver exactement les clés de chiffrement existantes : le changement de nom ne doit pas rendre les credentials, secrets TOTP ou sauvegardes illisibles.
- Pour une nouvelle installation, utiliser `nebuladb.sqlite`. Pour une installation existante, garder le chemin actuel configuré ou réaliser une migration contrôlée, serveur arrêté, avec vérification de la base et traitement cohérent des fichiers WAL/SHM. Ne pas ouvrir silencieusement une nouvelle base vide.
- Renommer les services Docker. Rebrancher le volume existant via son nom physique explicite ou réaliser une copie contrôlée avant d'adopter `nebuladb-data`. Ne pas supprimer le volume historique.
- Modifier les noms des variables du .env local sans afficher ni réécrire leurs valeurs.

### 4. Migrer les préférences et les plugins

- Copier les anciennes clés localStorage vers les nouvelles si la destination n'existe pas, puis écrire sous le nouveau nom. Inclure thème au chargement initial, préférences d'éditeur, viewports, plugins et leurs réglages.
- Exposer `nebula.*` dans le sandbox. Prévoir temporairement un alias de l'ancienne API pour les plugins enregistrés : ne pas remplacer aveuglément du code utilisateur.
- Renommer les modèles de plugins, erreurs, globals internes et tests.
- Émettre un marqueur de presse-papiers NebulaDB tout en acceptant l'ancien marqueur.

### 5. Préserver les contrats et fichiers existants

- Cookie `nebuladb_sid` : prévoir une reprise de l'ancienne session et un effacement cohérent des deux cookies à la déconnexion.
- Nouveaux enrollments TOTP avec l'émetteur NebulaDB ; les secrets et authentificateurs déjà configurés restent valides.
- Nouveau format de sauvegarde `nebuladb-backup` ; accepter également les sauvegardes `athanordb-backup` et vérifier la restauration réelle.
- Renommer `x-athanordb-*`, le User-Agent et `x-athanordb-scope`. Documenter le changement et prévoir une transition pour les consommateurs de webhooks.
- Renommer les métriques `athanordb_*`, avec migration documentée des tableaux de bord et alertes.
- Auditer aussi le préfixe indirect des clés API `adb_`, qui n'apparaît pas dans une recherche Athanor. Décider d'un nouveau préfixe pour les clés créées sans invalider les anciennes.

### 6. Vérifier le renommage applicatif

- Build, tests des workspaces, lint et détection des cycles.
- Tests E2E ciblés : authentification, préférences, plugins, SQL, connexion, sauvegarde/restauration et webhooks.
- Prouver les migrations : configuration historique, déchiffrement existant, base existante, ancien plugin et ancien backup.
- Refaire une recherche insensible à la casse incluant fichiers cachés/ignorés et noms de fichiers. Les seules occurrences historiques autorisées doivent être recensées : compatibilité, tests de migration et documents de transition/inventaire.
- Vérifier démarrage natif et Docker, imports npm et synchronisation des noms dans CI/fixtures.
- Préparer une note de migration, puis un rollback du déploiement et de la configuration ; conserver sauvegarde et ancien volume jusqu'à validation.

### 7. Renommer le dépôt GitHub en NebulaDB

- Effectuer cette étape après validation complète des étapes 1 à 6.
- Identifier le dépôt à partir du remote Git réel, vérifier que le nom NebulaDB est disponible chez son propriétaire, puis renommer le dépôt existant sans en créer un nouveau.
- Mettre à jour le remote local, les liens, badges et intégrations qui utilisent l'ancien chemin. Vérifier l'accès au nouveau remote et la CI.
- Conserver l'historique Git, les branches, issues et pull requests du dépôt existant.

### 8. Renommer le dossier local en NebulaDB — dernière opération

- Effectuer cette étape après le renommage du dépôt et la vérification du nouveau remote.
- Arrêter les serveurs, watchers et autres processus qui utilisent le checkout ; fermer les terminaux qui ont ce dossier comme répertoire courant.
- Depuis le dossier parent, renommer `C:\Users\gdesramaux\source\repos\local\AthanorDB` en `C:\Users\gdesramaux\source\repos\local\NebulaDB`. Vérifier les chemins absolus et l'absence d'un dossier cible existant avant l'opération.
- Mettre à jour les chemins enregistrés dans Codex, l'éditeur, les raccourcis et les éventuels scripts externes, puis rouvrir le projet depuis son nouveau chemin.
- Vérifier l'état Git, le remote et le démarrage de l'application depuis NebulaDB. Préserver les fichiers locaux, le .env et les données SQLite.
- Prévoir une exécution depuis le parent avec les permissions nécessaires : le chemin cible est extérieur à la racine actuellement autorisée en écriture.

Ces deux renommages viennent en dernier. Le dépôt GitHub a été renommé en conservant son identifiant et son historique ; le remote local a été mis à jour et vérifié. Ne pas modifier les artefacts binaires par substitution de texte.

## Critères de réussite

Le produit porte NebulaDB, ses identifiants techniques utilisent nebuladb/nebula, les imports et outils fonctionnent, une installation existante retrouve ses données et secrets, et les anciennes mentions restantes sont limitées à une liste explicite de compatibilité. Une suppression immédiate de toute occurrence historique nécessiterait une migration incompatible ; la transition est préférable.

## Validation réalisée

- Build propre et suite complète : 657 tests réussis, 9 tests de moteurs externes ignorés, aucun échec.
- Trois scénarios navigateur réussis : migration des préférences et sessions, espace de travail SQL, sauvegarde/restauration et planification.
- Lint et absence de cycles : validés. Les fragments de maquette statique sont exclus du lint applicatif ; les sources et nouveaux fichiers ont été formatés pour les contrôles de CI de la version 1.0.0.
- Valeurs des 12 variables locales conservées lors du changement de préfixe ; la clé de chiffrement lit toujours les données existantes. Le chemin SQLite a ensuite été adapté au fichier `nebuladb.sqlite`.
- Base locale sauvegardée avant les modifications puis après arrêt des serveurs ; intégrité SQLite vérifiée et WAL consolidé.
- Dépôt GitHub renommé, identifiant `1315186952` conservé, remote HTTPS et accès Git vérifiés.
- Déplacement du dossier encore en attente : Windows signale un verrou détenu par VS Code et Claude Code. Les processus de développement, le terminal inactif dédié au projet et les runtimes Codex inactifs qui détenaient un verrou ont été arrêtés.

Voir `renommage-nebuladb.md` pour les comportements de compatibilité et les instructions de retour arrière.

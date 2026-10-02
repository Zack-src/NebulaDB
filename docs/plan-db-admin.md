# Plan : administration des bases de données connectées

Statut (2026-10-02) : **phases 0 à 3 livrées**, plus le moniteur de sessions, le mode
lecture seule par connexion et l'export CSV de la phase 4. Reste à faire : voir
« Database console follow-ups » dans `docs/todo.md`. Le texte ci-dessous est le plan
d'origine, conservé pour référence ; là où l'implémentation s'en écarte, c'est noté dans
`CHANGELOG.md` et `docs/todo.md`.

## Décisions prises

- Les connexions deviennent **globales** : gérées par l'admin global, indépendantes des projets. Un projet peut y être rattaché (optionnel).
- Moteurs prioritaires : **PostgreSQL, MySQL/MariaDB, SQL Server, Oracle**. SQLite : explorateur et SQL oui, utilisateurs/permissions sans objet (message clair).
- Les fonctions d'administration (SQL libre, utilisateurs, suppression) sont **réservées à l'admin global** (`requireAdmin`) et **toujours auditées**.

## État actuel (à connaître)

- Monorepo npm : `apps/server` (Fastify 5, better-sqlite3 pour les métadonnées), `apps/web` (Svelte 5 runes), `packages/shared`, `packages/dbml-engine`.
- Onglet actuel : `apps/web/src/features/admin/ConnectionsTab.svelte` (choix d'un projet puis `features/connections/ConnectionManagerModal.svelte`). Formulaire : `ConnectionFormFields.svelte` (Oracle absent du sélecteur, présent dans `DEFAULT_PORTS`).
- Serveur : `apps/server/src/modules/connections/` (`routes.ts`, `repository.ts`, `deploy.ts`, `pull.ts`, `createFromDatabase.ts`, `hostGuard.ts`, `connectionBudget.ts`, `drivers/{interface,index,postgres,mysql,mssql,oracle,sqlite}.ts`).
- Table `project_connections` (migration 8, `config_encrypted` = AES-256-GCM via `shared/crypto.ts`). Migrations versionnées dans `infrastructure/migrations.ts`.
- API publique `/api/v1/.../connections` (`modules/publicApi/connectionRoutes.ts`) + `openapi.ts` (test de synchro `openapi.test.ts`).
- `deployment_history`, webhooks (`deployment.completed`) et `createProjectFromDatabase` dépendent de `project_connections` : à migrer sans casse.
- `DatabaseDriver` (`interface.ts`) est orienté DDL/DBML. La nouvelle couche d'administration doit être **séparée** (voir phase 2/3), pas greffée sur `introspectSchema`.

## Phase 0 : prérequis sécurité (avant toute exécution SQL libre)

Reprendre les lacunes de `docs/todo.md` Phase 27 :

1. DNS rebinding : résoudre une fois, puis se connecter à l'IP résolue (`hostGuard.ts`).
2. SQLite : restreindre `filePath` à un répertoire autorisé (variable d'env), en plus de `assertNotAppDatabase`.
3. Rate-limit par IP sur les routes de connexion (aujourd'hui seul le budget par cible existe).
4. Rotation du secret : versionner le chiffrement (`v1:iv:tag:ct`), commande de ré-chiffrement avec ancienne et nouvelle clé.

## Phase 1 : connexions globales (onglet admin)

**Modèle de données** (nouvelle migration)

- Table `db_connections` : `id, name, engine, environment, config_encrypted, tags_json, created_by, created_at, updated_at, last_status, last_checked_at, last_version, last_latency_ms`.
- Table de liaison `project_connection_links(project_id, connection_id)`.
- Migrer chaque ligne de `project_connections` vers `db_connections` + un lien, en conservant les ids pour ne pas casser `deployment_history` (ou ajouter `connection_id` mappé). Migration à sens unique, testée sur une base peuplée.
- Garder la compatibilité des routes `/api/projects/:id/connections` (lecture via les liens) et `/api/v1`. Marquer l'ancien comportement d'écriture comme déprécié dans `openapi.ts` et `docs/public-api.md`.

**Serveur**

- Nouveau module `modules/dbAdmin/` (ou extension de `connections`) :
  - `GET/POST /api/admin/connections`, `PUT/DELETE /api/admin/connections/:id`, `POST /api/admin/connections/test`, `POST /api/admin/connections/:id/health`.
  - `PUT /api/admin/connections/:id/projects` pour lier/délier des projets.
  - Toutes derrière `requireAdmin`, audit `dbconn.create|update|delete|link`.
  - La suppression d'une connexion liée demande confirmation et retire les liens (pas de cascade sur les projets).
- Ajouter `oracle` au sélecteur ; corriger `ERRORS.CONNECTION_ENGINE_INVALID` (message obsolète) ; clés i18n `connections.engine.*`.
- Santé : version du serveur, latence, état ; vérification manuelle + périodique légère (pas de polling agressif, respecter `connectionBudget`).

**Frontend**

- Refonte de `ConnectionsTab.svelte` : liste globale (nom, moteur, environnement, tags, santé), création/édition via `ConnectionFormFields` (réutilisé), suppression avec confirmation, liaison aux projets.
- Garder « Check differences », « Pull schema », déploiement : ils prennent la connexion globale + un projet lié.
- i18n `fr.json` et `en.json` (`admin.*`, `connections.*`).

**Tests**

- Tests unitaires du repository et de la migration.
- Tests d'intégration des drivers : ajouter MSSQL (via `docker-compose.mssql.yml`, actuellement non suivi par git : le versionner) et Oracle (image `gvenzl/oracle-free`, optionnel en CI).
- e2e `apps/web/e2e/` : créer, modifier, supprimer une connexion globale ; un non-admin reçoit 403.

## Phase 2 : explorateur et exécution SQL

**Contrat de driver d'administration** (`drivers/admin/interface.ts`, un fichier par moteur)

```ts
interface DatabaseAdminDriver {
  listDatabases(): Promise<DbInfo[]>;
  listSchemas(db: string): Promise<SchemaInfo[]>;
  listTables(db: string, schema?: string): Promise<TableInfo[]>;   // taille, nb de lignes estimé
  describeTable(ref): Promise<ColumnInfo[]>;                       // colonnes, index, contraintes
  browseRows(ref, { limit, offset, orderBy }): Promise<RowsPage>;  // pagination serveur
  runQuery(sql, opts: { readOnly, timeoutMs, maxRows }): Promise<QueryResult>;
  dropDatabase | dropTable | dropColumn(ref): Promise<void>;
  close(): Promise<void>;
}
```

- Identifiants SQL toujours quotés par moteur (jamais d'interpolation brute) ; valider `ref` contre les listes réelles.
- `runQuery` : timeout, plafond de lignes (ex. 1000), transaction `READ ONLY` quand `readOnly` (Postgres `SET TRANSACTION READ ONLY`, MySQL `START TRANSACTION READ ONLY`, MSSQL/Oracle : utilisateur ou garde-fou côté parseur + avertissement). Mode écriture explicite, avec confirmation côté UI.
- Suppressions : confirmation forte (saisir le nom), jamais sur les bases système (`postgres`, `mysql`, `master`, `SYS`…, liste par moteur), budget d'écriture existant appliqué.
- Routes `POST /api/admin/connections/:id/{databases,tables,describe,rows,query,drop}` ; audit de chaque requête (texte SQL tronqué + durée + nb de lignes, jamais les valeurs de résultat).
- Historique des requêtes par admin (table `admin_query_history`, rétention configurable).

**Frontend** : nouvel écran « Explorateur » par connexion : arbre bases > schémas > tables > colonnes, grille de données paginée, éditeur SQL (CodeMirror déjà présent), bascule lecture seule/écriture, export CSV des résultats.

## Phase 3 : utilisateurs et permissions

**Modèle commun** : `DbPrincipal { name, kind: 'user'|'role', host?, canLogin, memberOf[], locked }` et `DbGrant { principal, scope: server|database|schema|table|column, object, privileges[], grantable }`.

**Adaptateurs** (`drivers/admin/users/{postgres,mysql,mssql,oracle}.ts`)

| Moteur        | Principaux                                                          | Privilèges                                                                   |
| ------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| PostgreSQL    | `pg_roles` (rôles = users/groupes), `LOGIN`, appartenances          | `GRANT/REVOKE` par base/schéma/table/colonne, `ALTER DEFAULT PRIVILEGES`     |
| MySQL/MariaDB | `mysql.user` (`user@host`), `SHOW GRANTS`, rôles (8+/MariaDB 10.4+) | `GRANT/REVOKE` global/base/table/colonne ; attention aux différences MariaDB |
| SQL Server    | logins (serveur) + users (base) + rôles fixes/personnalisés         | `GRANT/DENY/REVOKE`, `ALTER ROLE ... ADD MEMBER`                             |
| Oracle        | `DBA_USERS`, `DBA_ROLES`, `DBA_SYS_PRIVS`, `DBA_TAB_PRIVS`          | `GRANT/REVOKE` système et objet, quotas tablespace                           |

- Fonctions : lister, créer, supprimer, changer le mot de passe, verrouiller/déverrouiller, matrice de permissions, ajout/retrait de rôles.
- **Aperçu SQL avant exécution** obligatoire (réutiliser l'idée de `DeploymentModal`) ; exécution transactionnelle quand le moteur le permet (pas de DDL transactionnel sur MySQL/Oracle : le signaler).
- Détecter les droits insuffisants du compte de connexion et afficher un message précis plutôt qu'une erreur brute.
- Mots de passe : jamais journalisés ni renvoyés ; génération côté serveur possible, affichée une seule fois.
- Audit : `dbuser.create|drop|grant|revoke|password` avec cible et privilèges.

**Frontend** : onglet « Utilisateurs » dans l'écran de la connexion : liste, détail, matrice de privilèges (cases à cocher par scope), aperçu SQL, confirmation.

## Phase 4 : fonctions complémentaires proposées

Par ordre de valeur :

1. Moniteur de sessions : liste des requêtes en cours, durée, kill (`pg_terminate_backend`, `KILL`, `ALTER SYSTEM KILL SESSION`).
2. Import/export de données (CSV/SQL) et sauvegarde/restauration (`pg_dump`, `mysqldump`, `BACKUP DATABASE` selon moteur ; à cadrer : outils présents dans le conteneur ?).
3. Index, contraintes, statistiques de taille et plans d'exécution (`EXPLAIN`).
4. Comparaison de schéma entre deux connexions (réutiliser `dbml-engine/diff.ts`).
5. Tunnel SSH et TLS avec CA personnalisée (aujourd'hui `rejectUnauthorized:false`).
6. Mode lecture seule imposé par connexion (drapeau) et alertes sur opérations destructrices.
7. NoSQL (MongoDB) : hors périmètre, contrat de driver différent.

## Ordre de livraison conseillé

1. Phase 0, puis Phase 1 (livrable seul, valeur immédiate : ce que demande l'admin).
2. Phase 2 (explorateur + SQL).
3. Phase 3, un moteur à la fois : PostgreSQL, MySQL/MariaDB, SQL Server, Oracle.
4. Phase 4 à la carte.

Chaque phase : migration testée, routes dans `openapi.ts` si exposées en `/api/v1`, i18n fr/en, tests unitaires + e2e, entrée dans `CHANGELOG.md` (qui n'a pas encore « project from database », duplication de table, check differences, MSSQL/Oracle) et mise à jour de `docs/todo.md`.

## Risques

- Migration `project_connections` : `PRAGMA foreign_keys` est désactivé, les suppressions en cascade sont manuelles (`deleteProjectCascade`) ; ne rien oublier.
- Droits requis très élevés pour la phase 3 (compte `sa`, `SUPERUSER`, `SYSDBA`) : documenter, et refuser proprement sinon.
- Oracle et MSSQL manquent de tests automatisés aujourd'hui ; les ajouter avant d'étendre.
- Budget par cible en mémoire (mono-process) : acceptable tant qu'il n'y a pas de cluster.

# Fusion des hiérarchies de drivers (`connections/drivers` et `dbAdmin/drivers`)

Statut : plan + étape 1 réalisée. Origine : scan du 2026-10-23, §5 (Lot E, P1 XL).

## 1. État des lieux

Deux contrats, volontairement séparés à l'origine :

- `DatabaseDriver` (`connections/drivers/interface.ts`) : la cible vue comme un `Project` DBML : introspection, `executeMigration`, seeds (`insertRows`), `queryRows`, sessions de restauration. Moteurs : postgres, mysql, mssql, oracle, sqlite, bigquery.
- `DatabaseAdminDriver` (`dbAdmin/drivers/interface.ts`) : la cible vue comme un serveur à opérer : navigation, console SQL, comptes/droits, sessions, `rowSession`. Moteurs : postgres, mysql, mssql, oracle, sqlite, bigquery.

Le couplage est déjà à sens unique : `dbAdmin/drivers/<moteur>.ts` importe de `connections/drivers/<moteur>.ts` les fabriques de configuration (`postgresPoolConfig`, `mysqlPoolConfig`, `mssqlPoolConfig`, `oraclePoolAttributes`, `openBigQuery`, `assertSqlitePathAllowed`, `bigQueryColumnType`). Il n'y a donc pas deux implémentations de la connexion : la duplication réelle est plus mince que le titre du scan ne le laisse penser.

## 2. Responsabilités : dupliquées ou réellement différentes

| Responsabilité                                                                                                 | connections/drivers                                                                          | dbAdmin/drivers                                                                                                                  | Verdict                                                                                           |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Construction des options de connexion (hôte, port, user, adresse épinglée `pinnedAddress`, `connectionString`) | `*PoolConfig()` exportées                                                                    | réutilise ces fonctions                                                                                                          | Déjà partagé                                                                                      |
| TLS / SSL                                                                                                      | `tls.ts` (`driverTlsOptions`) + adaptation par moteur (`mysqlTls`, mssql `options`)          | via les `*PoolConfig`                                                                                                            | Déjà partagé                                                                                      |
| Tunnel SSH                                                                                                     | `sshTunnel.ts`, ouvert par l'appelant (`withDriver` / deploy) avant l'instanciation          | idem, même module                                                                                                                | Déjà partagé (hors drivers)                                                                       |
| Garde d'hôte / épinglage                                                                                       | `hostGuard.ts`, `targetPinning.ts`                                                           | idem                                                                                                                             | Déjà partagé                                                                                      |
| Timeout de connexion                                                                                           | 5000 ms en dur dans postgres et mssql ; mysql sans valeur (défaut mysql2)                    | 5000 ms en dur dans mysql                                                                                                        | Dupliqué : constante unique faite (étape 1). Écart mysql à trancher                               |
| Timeout de requête                                                                                             | aucun (migrations longues)                                                                   | `statement_timeout` pg, `timeout` mysql2, worker SQLite tué, par requête                                                         | Réellement différent                                                                              |
| Quoting d'identifiants                                                                                         | `q(ident, dialect)` de `@nebuladb/dbml-engine`                                               | `quoteDouble/Backtick/Bracket` (`dbAdmin/drivers/common.ts`) ; `quote` local dans `connectionAdminRoutes.ts` ; `sqliteImport.ts` | Dupliqué : un module serveur unique, parité avec `q()` testée (étape 1)                           |
| Littéraux de chaîne                                                                                            | `RowValue` en paramètres liés                                                                | `literal()`, `N'...'` mssql, variante mysql avec backslash, `rowEdits.ts:346`                                                    | Partiellement dupliqué : les variantes par moteur sont légitimes ; seul le standard est factorisé |
| Mappage de types                                                                                               | `bigQueryColumnType`, types lus dans `information_schema` pour construire le `Project`       | types affichés dans `describeTable` (`DbAdminTableDescription`) lus avec des requêtes proches                                    | Dupliqué en partie (requêtes de catalogue), forme de sortie différente                            |
| Normalisation d'erreurs                                                                                        | `testConnection` renvoie `error: err.message` ; `executeMigration` renvoie `{success,error}` | `ApiError("DB_ADMIN_*")` et erreurs moteur propagées au routeur                                                                  | Différent : deux conventions. À unifier en dernière étape                                         |
| Cycle de vie du pool                                                                                           | un pool par instance, `close()`                                                              | un pool par requête HTTP (`routeKit.withDriver`, cf. scan §387)                                                                  | Différent (voir étape 4)                                                                          |
| Introspection                                                                                                  | `introspectSchema()` -> `Project`                                                            | `listTables/describeTable` -> types d'admin                                                                                      | Même catalogue interrogé de deux façons                                                           |
| Écriture de données                                                                                            | `insertRows`, sessions de restauration                                                       | `rowSession`, `runQuery` avec garde `sqlGuard`                                                                                   | Réellement différent (contrats de sécurité distincts)                                             |

## 3. Architecture cible

Un module par moteur, `engines/<moteur>/` (ou `drivers/<moteur>/`), qui expose :

```ts
interface EngineHandle {            // ce que rend connect()
  readonly engine: Engine;
  readonly dialect: QuotingStyle;
  query(sql, params?, opts?: { timeoutMs?; readOnly? }): Promise<RawResult>;
  transaction<T>(fn: (run: RunStatement) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
connect(config: DriverConnectionConfig, opts?): Promise<EngineHandle>
```

- `connect()` regroupe options, TLS, épinglage, timeout de connexion et ouverture du pool (ce que font déjà les `*PoolConfig`).
- Les deux contrats actuels deviennent deux couches minces au-dessus du handle : `DatabaseDriver` (introspection, déploiement, restauration) et `DatabaseAdminDriver` (console, comptes). Ni l'un ni l'autre ne perd ses garde-fous (`sqlGuard`, `assertDataStatement`).
- Les helpers purs (quoting, littéraux, constantes) vivent dans `apps/server/src/shared/sqlQuoting.ts` (étape 1). `packages/dbml-engine` garde son `q()` (il est aussi embarqué dans le navigateur) ; un test fige la parité des deux.

## 4. Étapes, par risque croissant

| #   | Étape                                                                                                                                                                                                                                                                                             | Risque                                                             | Stratégie de test                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Helpers purs partagés : quoting, littéral standard, constante de timeout de connexion ; suppression des copies locales                                                                                                                                                                            | Très faible (aucun changement de comportement)                     | Tests unitaires du module + parité avec `q()` ; suite existante inchangée                                                                                                 |
| 2   | Aligner les écarts mineurs, chacun en commit à part : timeout de connexion mysql de `connections`, `PRAGMA table_info("${tableName}")` non échappé dans `connections/drivers/sqlite.ts` (corriger avec `quoteDouble`), `literal` mssql/mysql déplacés au module partagé avec tests de cas limites | Faible (petits changements de comportement assumés)                | Tests unitaires + tests `live` qui passent sur conteneurs                                                                                                                 |
| 3   | Types et requêtes de catalogue communs : une fonction par moteur qui lit colonnes/clés/index brutes, consommée par `introspectSchema` et `describeTable`                                                                                                                                          | Moyen                                                              | Tests de contrat : mêmes lignes de catalogue -> les deux sorties ; tests live existants (`postgres.test.ts`, `mysql.test.ts`, `live.test.ts`)                             |
| 4   | `connect()` et `EngineHandle` par moteur, dont réutilisation du pool côté console (corrige aussi le scan §387, une connexion par requête HTTP) ; les deux drivers s'en servent                                                                                                                    | Élevé                                                              | Migrer un moteur à la fois, en commençant par SQLite puis PostgreSQL ; tests live + tests de routes (`routes.test.ts`) ; test de fuite de connexions (`connectionBudget`) |
| 5   | Erreurs : un normalisateur (`EngineError` avec code, message sûr, détail interne) utilisé par les deux couches                                                                                                                                                                                    | Élevé (messages visibles côté web, tests de routes qui les figent) | Tests de routes sur les messages ; table moteur -> code                                                                                                                   |
| 6   | Fusion des interfaces (optionnelle) ou suppression des ré-exports                                                                                                                                                                                                                                 | Moyen                                                              | Compilation + suite complète ; aucune signature de route modifiée                                                                                                         |

Règles de passage : une étape par PR ; avant d'ouvrir l'étape suivante, la suite complète du serveur et les tests live doivent passer sur conteneurs (postgres 55432, mysql, mssql) ; pas de changement de signature utilisée par les routes avant l'étape 6.

## 5. Étape 1 : ce qui a été fait

- Nouveau `apps/server/src/shared/sqlQuoting.ts` : `quoteDouble`, `quoteBacktick`, `quoteBracket`, `quotingStyleFor`, `quoteIdentifier(ident, engine)`, `sqlLiteral`, `CONNECT_TIMEOUT_MS`.
- `dbAdmin/drivers/common.ts` : `quote*` et `literal` y sont ré-exportés (les imports existants ne bougent pas).
- `dbAdmin/connectionAdminRoutes.ts` : le sélecteur local de quoting devient `quoteIdentifier`.
- `infrastructure/sqliteImport.ts` : la copie locale de `quote` utilise `quoteDouble`.
- Timeout de connexion de 5 s : postgres et mssql (`connections`) et mysql (`dbAdmin`) lisent `CONNECT_TIMEOUT_MS`.
- Tests : `shared/sqlQuoting.test.ts`.

## 6. Recommandation pour l'étape 2

Traiter d'abord le `PRAGMA table_info("${tableName}")` non échappé de `connections/drivers/sqlite.ts` (corriger avec `quoteDouble` ; un nom de table contenant `"` casse aujourd'hui l'introspection), puis aligner le timeout de connexion de mysql côté `connections`, en deux commits séparés. Ne pas toucher à `packages/dbml-engine` tant que son `q()` doit rester utilisable dans le navigateur.

**Fait (étape 2) :** les `PRAGMA table_info` et `foreign_key_list` de `connections/drivers/sqlite.ts` échappent maintenant le nom de table (test avec un nom contenant `"`), et le pool MySQL de `connections` utilise `CONNECT_TIMEOUT_MS`. L'étape 3 (requêtes de catalogue communes) reste à faire.

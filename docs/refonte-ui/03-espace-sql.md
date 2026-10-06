# 03 - Espace « Requêtes » (SQL pour tous les utilisateurs)

Statut : proposition de conception, rien n'est implémenté. Rédigé le 2026-10-05 après lecture de
`docs/etat-des-features.md` (sections 6 à 9), `docs/permissions.md`, `docs/plan-db-admin.md` et du code
(`apps/web/src/features/sql/**`, `features/admin/connections/**`, `features/workspace/DataTab.svelte`,
`features/editor/ProjectEditor.svelte`, `apps/server/src/modules/dbAdmin/**`, `modules/dbAccess/**`).
Chaque affirmation sur l'existant renvoie à un fichier ; ce qui n'a pas été vérifié est marqué
« à vérifier ».

Périmètre : un espace SQL de premier niveau, ouvert à tout compte ayant accès à une base, pas
seulement aux administrateurs ni seulement à l'intérieur d'un projet. Les autres chapitres de la
refonte (navigation globale, design system, contrastes, administration) sont traités ailleurs ; ce
document dit explicitement ce qu'il attend d'eux (section 12).

Table des matières

1. Diagnostic de l'existant
2. Principes de conception
3. Vue d'ensemble de l'espace
4. Explorateur d'objets (arbre)
5. Onglets et éditeur
6. Exécution (sélection, script, lot, annulation, transactions)
7. Panneau de résultats, messages, EXPLAIN, export
8. Requêtes enregistrées, historique, variables
9. Liens avec le modèle et détails de table
10. Permissions par rôle : ce que l'interface montre, masque, désactive
11. Maquettes ASCII
12. Dépendances avec la navigation globale et le design system
13. Dimension serveur : routes, migrations, garde-fous
14. Lots de livraison
15. Tests
16. Risques et questions ouvertes

---

## 1. Diagnostic de l'existant

### 1.1 Où est le SQL aujourd'hui : un seul composant, trois cadres, un quatrième point d'entrée

Tout le SQL de l'application passe par un seul composant, `features/sql/SqlPanel.svelte` (221 lignes,
une `<textarea>` + un bouton + un `ResultGrid`). Il est monté à trois endroits différents :

| # | Endroit | Fichiers | Qui y accède | Particularité |
|---|---------|----------|--------------|---------------|
| 1 | Admin > Connexions > « Ouvrir » > onglet « SQL » | `admin/ConnectionsTab.svelte` (l.17 et l.106) > `admin/connections/DbConsole.svelte` > `SqlPanel` | Administrateurs d'instance | Console complète : explorateur, SQL, utilisateurs, sessions, santé, sauvegardes, journal (7 sections dans `DbConsole`) |
| 2 | Onglet « Données » d'un projet | `editor/ProjectEditor.svelte` (l.634) > `workspace/DataTab.svelte` > `DbConsole` | Admin, et membres **si la connexion est rattachée au projet** | Seul chemin d'un membre. `DataTab` cherche la connexion dans la liste du projet (`connections.find`) : une connexion accordée mais non rattachée à un projet est introuvable |
| 3 | Tiroir SQL sous le diagramme (Ctrl+J) | `sql/sqlDrawer.svelte.ts`, `sql/EditorSqlDrawer.svelte` > `SqlPanel compact` | Idem 2, sur la connexion active du projet | Hauteur 140 à 640 px, mémorisée en `localStorage` ; reçoit les requêtes « Voir les données » du diagramme via `request = {sql, token}` |
| 4 | « Voir les données » dans l'explorateur | `connections/ExplorerPanel.svelte` (379 lignes) + `ResultGrid` | Idem 1 | Grille paginée côté serveur (`GET :id/rows`, 100 par page, 500 max), séparée du SQL |

Constat : ce n'est pas « trois SQL différents » mais **un panneau minimal re-cadré trois fois**, sans
espace propre. Il n'existe aucune entrée « Requêtes » dans la navigation (`app/App.svelte` ne connaît
que projets / paramètres / admin / projet ouvert).

### 1.2 Limites fonctionnelles constatées

1. **Éditeur** : simple `<textarea>` (`TEXTAREA_CODE_CLASS`). Ni coloration, ni complétion, ni
   formatage, ni onglets. Pourtant CodeMirror 6 est déjà dans `apps/web/package.json`
   (`@codemirror/{autocomplete,commands,language,lint,search,state,view}`, utilisés par
   `features/editor/dbml/**`). Il manque seulement `@codemirror/lang-sql` (absent, vérifié).
2. **Une seule instruction.** `assertReadOnlyStatement` refuse tout `;` interne (`sqlGuard.ts`,
   « only one statement at a time ») ; `assertDataStatement` idem pour les membres `write`. En mode
   écriture administrateur, PostgreSQL accepte un script (protocole simple) mais n'affiche que le
   **dernier** résultat (`drivers/postgres.ts` l.214-215 : `raw[raw.length - 1]`). Aucun jeu de
   résultats multiple, aucun message (« 3 lignes modifiées », `PRINT`, `NOTICE`).
3. **Pas d'annulation.** La requête est un `POST :id/query` qui attend jusqu'à 30 s (membres) ou 120 s
   (admin). `useAsyncAction` ne propose pas d'abandon. Seul `drivers/mssql.ts` annule en interne, pour
   couper à `maxRows + 1`. Rien n'arrête une requête longue côté base, sauf l'onglet « Sessions » de
   l'admin (`SessionsPanel`, réservé aux administrateurs).
4. **Aucune session côté base.** `withDriver` (`dbAdmin/routes.ts` l.75) ouvre un driver, exécute, ferme,
   à **chaque** requête, et dépense le budget de la cible (`takeConnectionBudget`). Conséquences : pas de
   table temporaire, pas de `SET`, pas de `BEGIN` ... `COMMIT` sur plusieurs envois, pas de variable
   serveur qui survive d'une exécution à l'autre.
5. **Accès des membres par le projet uniquement** (voir 1.1 #2-3). `GET /api/me/db-access` ne renvoie que
   `{connectionId, level}` (`modules/dbAccess/routes.ts`, `repository.ts#listAccessibleConnections`),
   pas de nom, de moteur, d'environnement. Le nom vient de la liste des connexions du projet.
6. **Historique pauvre** : 200 entrées par (utilisateur, connexion), 50 renvoyées
   (`queryHistory.ts`), sans recherche, sans épinglage, sans lien avec l'exécution (pas de nombre
   d'instructions, pas d'identifiant d'exécution).
7. **Pas de requêtes enregistrées**, pas de dossiers, pas de partage (❌ dans `etat-des-features.md`
   section 7).
8. **Pas d'EXPLAIN** ni de plan. `EXPLAIN` est accepté comme mot-clé de lecture (`READ_KEYWORDS`), donc
   on peut le taper, mais le résultat est une grille de texte.
9. **Export** : CSV des lignes déjà chargées seulement (`ResultGrid.svelte#toCsv`, BOM UTF-8). Ni JSON, ni
   Excel, ni copie formatée.
10. **Pas de métadonnées pour la complétion** : aucune route ne renvoie « toutes les colonnes de toutes les
    tables d'une base » ; `describeTable` est table par table. Pas de liste de procédures/fonctions
    (`DatabaseAdminDriver` n'a ni `listRoutines` ni DDL de table).
11. **Beaucoup de popups pour une action simple** : `ConfirmDialog` pour chaque écriture,
    `ConfirmDialog` de politique de structure, `StructureRedirectDialog`, `StatementModal` pour les
    suppressions, `PersonalAccountDialog` pour le compte personnel.
12. **Le SQL est noyé dans l'administration** : `DbConsole` mélange SQL, explorateur et gestion de
    serveur. Un membre voit « un morceau de console d'admin » ; un admin cherche la requête dans un onglet
    d'une fiche de connexion.

### 1.3 Ce qui est solide et à conserver tel quel

- **Sécurité côté serveur** : `requireDbConsoleUser` (`dbAccess/service.ts`) vérifie la grant à chaque
  requête, répond `404` à qui n'a pas le droit ; clé d'API refusée ; `assertReadOnlyStatement` /
  `assertDataStatement` ; `READ ONLY` transaction (PostgreSQL, MySQL, Oracle) ; curseur PostgreSQL ;
  plafonds 1000 lignes / 30 s pour les membres, 5000 / 120 s pour l'admin ; audit de chaque requête
  (`dbaccess.query` / `dbadmin.query`) ; historique ; statistiques par forme de requête
  (`queryStats.ts`) ; politique de structure (`structurePolicy.ts`) ; compte protégé ; mode `readOnly`
  par connexion ; comptes personnels (`PERSONAL_CREDENTIALS_REQUIRED`).
- **Routes explorateur déjà partagées** : `/api/connections/:id/{overview,schemas,tables,table,rows,query,
  query-history}` doublées en `/api/admin/connections/...` par la boucle `consoleRoutes`
  (`dbAdmin/routes.ts` l.284-467). L'espace Requêtes se bâtit sur `/api/connections/:id/...` pour tous.
- **Grille virtualisée** : `components/ui/DataGrid.svelte` fait déjà du fenêtrage (`rowHeight = 28`,
  `overscan = 8`) ; elle suffit pour 5000 lignes et se réutilise telle quelle.
- **Badge d'environnement** : `features/environments/EnvironmentBadge.svelte`, alimenté par
  `environment / environmentColor / production` des résumés de connexion
  (`packages/shared/src/schema.ts` l.256-278). Attention : ces champs viennent de l'étape (« stage »)
  du projet auquel la connexion est liée (`connections/repository.ts` l.72-82) ; une connexion sans
  étape n'a pas d'environnement.
- **Génération de requêtes d'aperçu** : `sql/previewStatement.ts` (`quoteIdentifier`,
  `previewRowsStatement`) avec tests.

---

## 2. Principes de conception

1. **Un espace, pas un panneau.** « Requêtes » est une destination de premier niveau, au même rang que
   « Projets » et « Administration ». Un membre sans projet y trouve ses bases.
2. **Un seul moteur d'UI, plusieurs cadres.** L'éditeur, les onglets et le panneau de résultats sont des
   composants uniques (`features/queries/**`) ; le tiroir sous le diagramme et l'onglet « Données » du
   projet les réutilisent, ils n'ont plus de code SQL propre. `SqlPanel.svelte` disparaît.
3. **Lecture par défaut, écriture volontaire et visible.** Le mode ne se cache pas dans une case
   discrète : il colore l'éditeur, la barre d'état et le bouton Exécuter (déjà le principe de `SqlPanel` :
   bordure `danger` en écriture). L'indicateur de production double cette signalétique.
4. **Les droits de la base sont la vraie limite.** Le filtre d'Athanor (`sqlGuard.ts`) est un garde-fou,
   pas un analyseur (`etat-des-features.md` l.233). L'interface ne promet jamais « sûr » ; elle dit
   « vous exécutez avec le compte X, ses droits décident ».
5. **Moins de popups.** Les confirmations d'écriture, de politique de structure et de compte personnel
   deviennent des bandeaux en ligne dans l'espace de travail. Seule exception : la suppression d'objet
   (base, table, colonne), déjà protégée par retape du nom (`StatementModal`).
6. **Le clavier d'abord.** Chaque action fréquente a un raccourci ; la palette de commandes (si la
   refonte en prévoit une) l'expose. Voir 5.4 pour les contraintes des raccourcis réservés au navigateur.
7. **Honnêteté sur les limites.** Si un moteur ne sait pas annuler (SQLite), pas de plan réel
   (SQL Server en lecture seule), on grise avec une explication, on ne simule pas.
8. **Jamais plus de droits par l'interface.** Aucune fonction nouvelle n'élargit ce qu'un `read` ou un
   `write` peut faire (matrice section 10). Les nouveautés d'ergonomie (scripts, plans, export) sont
   bornées par les mêmes gardes, appliquées instruction par instruction.

---

## 3. Vue d'ensemble de l'espace

### 3.1 Place dans la navigation

Route proposée : `/requetes` (liste des connexions accessibles) et `/requetes/:connectionId` (espace de
travail), avec la base et l'onglet dans des paramètres de requête (`?db=shop&tab=3`). À ajouter à
`projects/projectRouting.svelte` (je n'ai pas lu ce fichier en détail : à vérifier la structure des
routes) et à `app/App.svelte` (nouvelle branche entre « settings » et « admin »). L'entrée apparaît dans
la navigation globale **si et seulement si** l'utilisateur a au moins une connexion accessible
(`GET /api/me/sql-connections` non vide, section 13.1) ; sinon elle apparaît quand même pour un
administrateur (il peut créer une connexion), et reste masquée pour un membre sans accès (voir l'écran
« pas d'accès », section 11.6, atteignable par lien direct).

### 3.2 Les quatre zones

```
+-------------------------------------------------------------------------------+
| BARRE DE CONTEXTE  connexion · base · compte · mode · environnement           |
+--------------+----------------------------------------------------------------+
|              | ONGLETS DE REQUÊTES                                            |
| EXPLORATEUR  +----------------------------------------------------------------+
| (arbre)      | ÉDITEUR (CodeMirror 6)                                         |
|              +----------------------------------------------------------------+
|              | RÉSULTATS · MESSAGES · PLAN · HISTORIQUE                       |
+--------------+----------------------------------------------------------------+
| BARRE D'ÉTAT  lignes · durée · compte · mode · curseur                        |
+-------------------------------------------------------------------------------+
```

- Les trois séparateurs (arbre / éditeur, éditeur / résultats) utilisent `components/ui/Splitter.svelte`
  (déjà présent) ; tailles mémorisées en `localStorage` (même mécanisme que `SqlDrawerState.rememberHeight`).
- Le panneau de gauche a trois vues commutables : **Objets** (arbre), **Enregistrées** (requêtes
  enregistrées), **Historique**. Moins de panneaux flottants, plus de vues d'un même rail.
- Sous 900 px de large : l'arbre devient un tiroir ; les résultats passent sous l'éditeur en plein écran
  commutable. Le mobile n'est pas une cible (outil de travail clavier), mais l'écran de choix de
  connexion et la lecture d'un résultat doivent rester utilisables.

### 3.3 Barre de contexte : le sélecteur « connexion / base / compte / mode »

Une seule ligne, toujours visible, qui répond aux quatre questions « où ? », « avec quoi ? », « en
lecture ou en écriture ? », « dans quel environnement ? » :

- **Connexion** : liste déroulante de `GET /api/me/sql-connections`, avec pastille de santé
  (`online/offline`, cf. `ConnectionHealth` dans `schema.ts`), moteur, badge d'environnement.
- **Base** (si `capabilities.multiDatabase`) : liste des bases ; les bases système sont masquées sauf
  case « afficher les bases système » (administrateur seulement, voir 10.4). Remplace `USE` (interdit en
  lecture sur SQL Server : mot-clé `USE` de `MSSQL_FORBIDDEN`). Le champ `database` du corps de requête
  est déjà pris en charge (`routes.ts` l.378).
- **Compte** : « compte partagé » / « votre compte `ada` » / « compte requis » (voir 10.5).
- **Mode** : interrupteur Lecture / Écriture, avec l'état réel : pour `read` l'interrupteur est absent
  (pas grisé : il n'a pas de sens, cf. `SqlPanel` `canWrite`) ; pour une connexion `readOnly` il est
  grisé avec l'info-bulle `dbadmin.readOnlyConnection` existante.
- **Environnement** : `EnvironmentBadge` ; en production, bandeau pleine largeur (section 7.7).

Le contexte (connexion, base, mode) est **porté par l'onglet**, pas par la page : deux onglets peuvent
viser deux bases, comme dans SSMS. Le mode Écriture est **par onglet et jamais mémorisé** : un onglet
rouvert est toujours en lecture (même règle que `SqlPanel` : `writeMode = false` sur `request`).

### 3.4 Connexions de travail

« Connexions de travail » = l'ensemble des connexions que l'utilisateur garde ouvertes dans l'arbre,
comme les serveurs d'un explorateur d'objets SSMS.

- La racine de l'arbre liste **les connexions épinglées** (étoile dans le sélecteur), pas toutes celles du
  serveur. À la première visite : toutes les connexions accessibles si moins de 5, sinon les 5 plus
  récemment utilisées.
- Épinglage et ordre : `localStorage` en V1 (clé `athanordb.queries.pinned.<userId>`), table serveur
  en V2 si la question ouverte Q9 le demande.
- **Pas de connexion ad hoc** (host/port/mot de passe saisis par un membre) : ce serait de la création de
  connexion, qui est un pouvoir d'administrateur (`ConnectionEditModal`, `hostGuard.ts` contre le SSRF).
  Voir Q3 pour un éventuel « jeton de connexion temporaire » côté admin.

---

## 4. Explorateur d'objets (arbre)

### 4.1 Hiérarchie

```
Connexions épinglées
 └─ ● Shop prod  [postgres] [PROD]
     ├─ Bases de données
     │   └─ shop
     │       ├─ Schémas
     │       │   └─ public
     │       │       ├─ Tables (42)
     │       │       │   └─ orders  ~1,2 M lignes · 480 Mo
     │       │       │       ├─ Colonnes
     │       │       │       │   ├─ id            bigint     PK
     │       │       │       │   └─ customer_id   bigint     FK
     │       │       │       ├─ Index (3)
     │       │       │       └─ Contraintes (2)
     │       │       ├─ Vues (6)
     │       │       ├─ Procédures et fonctions (11)   [nouveau]
     │       │       └─ Séquences (PostgreSQL, Oracle)  [V2]
     │       └─ ...
     └─ Sécurité (administrateur seulement) → lien vers Admin > Utilisateurs
```

Règles par moteur (selon `DbAdminCapabilities`, `packages/shared/src/dbAdmin.ts`) :

| Capacité | Effet sur l'arbre |
|----------|-------------------|
| `multiDatabase = false` (SQLite) | pas de niveau « Bases de données » |
| `schemas = false` (MySQL : base = schéma ; SQLite) | pas de niveau « Schémas » |
| `users`, `sessions` | pas d'entrée « Sécurité » / « Sessions » dans l'arbre ; ces liens n'existent que pour un administrateur |
| `dropDatabase` | menu contextuel « Supprimer la base » (administrateur seulement) |

### 4.2 Chargement paresseux et volume

- Chaque nœud charge ses enfants à l'ouverture via les routes existantes : `overview` (bases),
  `schemas?database=`, `tables?database=&schema=` (tables **et** vues, champ `kind`), `table?...` (colonnes,
  index, contraintes). Nouveau : `routines?database=&schema=` (13.3).
- Arbre **aplati et virtualisé** : le modèle (`treeModel.ts`) produit une liste plate de lignes visibles
  (profondeur, id, état ouvert) rendue avec le même fenêtrage que `DataGrid` (lignes de 24 px). Nécessaire
  dès ~2000 tables (un entrepôt SQL Server en a davantage).
- Filtre en haut : filtre insensible à la casse sur les noms **déjà chargés** ; s'il n'y a rien de chargé
  pour la base, il déclenche un chargement des tables (une requête, pas une par nœud).
- Les compteurs « (42) » viennent des listes déjà chargées. `rowEstimate` et `sizeBytes` sont déjà dans
  `DbAdminTable` ; afficher `~1,2 M lignes` avec `~` (estimation, pas un `COUNT(*)`).
- Rafraîchissement : bouton sur chaque nœud + F5 dans l'arbre ; invalide aussi le cache de complétion
  (4.5 / 5.3).
- Erreur par nœud : une base inaccessible (droits) affiche le message de la base (« permission denied for
  schema x ») dans le nœud, en ligne, sans bloquer le reste. Le serveur renvoie déjà le message natif en
  `502 DB_ADMIN_QUERY_FAILED` (commentaire de `withDriver`).

### 4.3 Interactions (clic, double-clic, menu contextuel)

| Geste | Sur une table / vue | Sur une colonne | Sur une procédure |
|-------|---------------------|-----------------|-------------------|
| Clic | sélectionne ; le volet de droite peut montrer la fiche (4.4) | idem | idem |
| Double-clic | ouvre la **fiche de la table** dans un onglet (sans fermer l'éditeur) | insère le nom de la colonne à la position du curseur de l'éditeur actif | ouvre la définition dans un nouvel onglet (lecture seule) |
| Glisser-déposer | insère le nom qualifié dans l'éditeur | insère `table.colonne` | insère le nom |
| Menu contextuel | voir ci-dessous | Copier le nom · Filtrer par... | Copier le nom · Générer `EXEC` (écriture, admin seulement) |

Menu contextuel d'une table (tous niveaux d'accès) :
- **Sélectionner les 100 premières lignes** : ouvre un nouvel onglet avec `previewRowsStatement`
  (`sql/previewStatement.ts`, `LIMIT` / `TOP` selon le moteur) et l'exécute en lecture. Reprend le
  comportement de « Voir les données » (`PREVIEW_ROWS = 100`).
- **Générer** > `SELECT` (toutes les colonnes nommées), `INSERT`, `UPDATE`, `DELETE`. Les trois derniers
  produisent du texte dans un onglet ; leur exécution dépend du niveau (un `read` ne peut pas les lancer :
  le bouton Exécuter explique pourquoi, 10.2).
- **Copier** > nom, nom qualifié, DDL.
- **Voir dans le diagramme** (9.1) si la table est modélisée dans un projet lisible par l'utilisateur.
- Administrateur seulement : **Supprimer la table / la vue / la colonne / la base** (fenêtre
  `StatementModal` conservée : aperçu du SQL + retape du nom ; route `POST /api/admin/connections/:id/drop`
  inchangée, avec la politique de structure).

### 4.4 Fiche de table (détails)

Ouverte dans un onglet de type « objet » (icône différente, pas d'éditeur). Sous-onglets :

| Sous-onglet | Contenu | Source |
|-------------|---------|--------|
| Données | grille paginée (100/page), tri par colonne par **génération de SQL** (voir note), bouton « Ouvrir en requête » | `GET :id/rows` existant ; tri/filtre : lot 6 |
| Colonnes | nom, type, nullable, défaut, clé primaire, clé étrangère | `DbAdminColumn` (existant) |
| Index | nom, colonnes, unique, type | `DbAdminIndex` |
| Contraintes | PK, FK (cible cliquable), CHECK, UNIQUE | `DbAdminConstraint` |
| DDL | `CREATE TABLE` reconstitué + bouton Copier / Ouvrir dans un onglet | nouveau `GET :id/ddl` (13.3) |
| Statistiques | lignes estimées, taille, date de dernière analyse (si le moteur la donne) | `DbAdminTable.rowEstimate/sizeBytes` ; reste en V2 |

Note sur le tri/filtre : plutôt que d'ajouter `orderBy` / `where` à `browseRows` (injection à surveiller
dans 5 drivers), la grille de la fiche **génère l'instruction** (`SELECT * FROM t WHERE c = ... ORDER BY
...`) avec `quoteIdentifier` et la lance par le chemin `query` habituel (donc sous les mêmes gardes,
audit et historique). Le bouton « Ouvrir en requête » copie cette instruction dans un onglet. Aucun nouveau
chemin d'exécution à auditer.

### 4.5 Source de la complétion

L'arbre et la complétion partagent le même cache de métadonnées (`metadataCache.svelte.ts`, clé
`connexion + base`) : ce que l'arbre a chargé n'est pas redemandé, et la route groupée (13.3,
`completion-metadata`) remplit le cache d'un coup pour la base active.

---

## 5. Onglets et éditeur

### 5.1 Onglets de requêtes

- Onglet = `{ id, titre, sql, connectionId, database, mode: 'read'|'write', savedQueryId?, dirty,
  resultats[], dernierPlan?, viewState (curseur, scroll) }`. Les résultats ne sont jamais persistés (ils
  peuvent contenir des données sensibles).
- Création : bouton « + » (Alt+T), double-clic sur la barre d'onglets, ou toute action « ouvrir dans un
  nouvel onglet » (menu contextuel d'une table, historique, requête enregistrée).
- Titre automatique « Requête 1 », renommable (double-clic). Pastille `●` si modifié non enregistré ;
  icône cadenas rouge si l'onglet est en mode Écriture ; pastille rouge « PROD » si la connexion est en
  production.
- **Persistance des brouillons** : texte des onglets en `localStorage` par utilisateur
  (`athanordb.queries.tabs.<userId>`, jusqu'à 20 onglets, 200 Ko chacun) pour survivre à un
  rechargement ; côté serveur seulement via « Enregistrer » (section 8). Le stockage local est enveloppé
  de `try/catch` (déjà la règle de `utils/storage`).
- Fermeture d'un onglet modifié : pas de popup ; l'onglet se ferme et reste récupérable via « Rouvrir
  l'onglet fermé » (Ctrl+Shift+T est réservé au navigateur → Alt+Shift+T) pendant la session.
- Réorganisation par glisser-déposer ; menu de l'onglet : Dupliquer, Renommer, Fermer les autres, Épingler.

### 5.2 Éditeur CodeMirror 6

Composant `SqlEditor.svelte` (pattern de `editor/dbml/DbmlEditor/DbmlEditor.svelte`, chargé en `import()`
dynamique comme `DataTab`/`EditorSqlDrawer` le sont déjà, pour ne pas alourdir le bundle principal).

| Fonction | Choix | Remarque |
|----------|-------|----------|
| Coloration par dialecte | `@codemirror/lang-sql` : `PostgreSQL`, `MySQL`, `MariaDB`, `MSSQL`, `SQLite`, `PLSQL` ; dialecte choisi par `connection.engine`, `Compartment` reconfigurable | nouvelle dépendance, à ajouter dans `apps/web/package.json` |
| Complétion | `autocompletion()` + source maison depuis le cache de métadonnées (5.3) ; mots-clés du dialecte fournis par `lang-sql` | |
| Formatage | `sql-formatter` (dialectes `postgresql`, `mysql`, `mariadb`, `transactsql`, `plsql`, `sqlite`), Ctrl+Shift+F, sur la sélection ou tout le tampon | nouvelle dépendance, chargée à la demande |
| Snippets | `snippetCompletion` de `@codemirror/autocomplete` : `sel` (SELECT ... FROM ... WHERE), `selt` (SELECT TOP/LIMIT), `ins`, `upd`, `del`, `cte`, `join`, `cnt` | liste dans `snippets.ts`, par dialecte |
| Historique d'édition | `history()` de `@codemirror/commands` (annuler/rétablir par onglet) | |
| Recherche | `@codemirror/search` déjà présent (Ctrl+F) | |
| Commentaires | Ctrl+/ bascule `--` ; Ctrl+Shift+/ bloc `/* */` | |
| Diagnostics | `@codemirror/lint` : soulignement des objets inconnus (table absente du cache) en avertissement, des instructions d'écriture dans un onglet en lecture en information | pas un analyseur : règles simples sur le jeton |
| Mise en évidence de l'instruction courante | décoration de fond léger entre deux `;` (sert à « Exécuter l'instruction courante ») | |
| Marquage du mode | bordure de l'éditeur `danger` en écriture (reprise de `SqlPanel`) | |
| Thème | sombre/clair via les variables du design system ; contraste ≥ 4,5:1 pour tous les jetons de coloration (exigence de la refonte) | voir 12 |

Les limites de `lang-sql` (pas d'analyse sémantique, dialecte Oracle partiel) sont acceptées : la
complétion et la coloration sont une aide, jamais une validation. Seul le serveur (garde-fous + base)
décide.

### 5.3 Complétion depuis le schéma

Comportement attendu :

- Après `FROM ` / `JOIN ` : tables et vues de la base active (schéma par défaut d'abord) ; après `schema.` :
  les tables de ce schéma ; après `alias.` ou `table.` : les colonnes de la table (alias résolu par un
  petit analyseur de la requête courante : on lit les `FROM x [AS] y` / `JOIN x y` de l'instruction sous le
  curseur, sans parseur complet).
- Dans `SELECT` / `WHERE` / `ORDER BY` : colonnes des tables de la clause `FROM` de l'instruction.
- Détail de chaque proposition : type de colonne, `PK`, `nullable`, estimation de lignes pour les tables.
- **Jointures suggérées** (V2) : sur `JOIN t ON`, proposer `a.fk = b.pk` d'après les clés étrangères
  (`DbAdminConstraint`).
- **Source de données** : la route `GET :id/completion-metadata?database=` (13.3) renvoie schémas, tables,
  vues, colonnes. Mise en cache côté client par `connexion|base`, durée 5 min, invalidée par le bouton
  Actualiser. Plafond serveur : 3000 tables et 40 000 colonnes ; au-delà la réponse contient les noms
  de tables seulement (`columnsLoaded: false`) et les colonnes sont demandées par table via
  `GET :id/table` (déjà existante) au moment de la frappe de `table.`.
- Un membre `read` obtient la complétion de **ce que son compte peut voir** : la métadonnée est lue avec
  son compte (partagé ou personnel) ; aucune élévation.

### 5.4 Raccourcis clavier

Contrainte : Ctrl+N, Ctrl+T, Ctrl+W (et leurs variantes Maj) sont réservés au navigateur et ne peuvent pas
être interceptés de façon fiable ; je n'en utilise aucun.

| Action | Raccourci | Remarque |
|--------|-----------|----------|
| Exécuter la sélection, sinon l'instruction courante | Ctrl+Entrée | Reprend le raccourci actuel de `SqlPanel` (`Ctrl + Enter`) |
| Exécuter tout le script | F5 ou Ctrl+Maj+Entrée | F5 = convention SSMS |
| Annuler l'exécution | Ctrl+. (ou bouton Stop) | |
| Expliquer (plan estimé) | Ctrl+Alt+E | 7.5 |
| Formater | Ctrl+Maj+F | |
| Enregistrer la requête | Ctrl+S (`preventDefault`) | ouvre le champ de nom en ligne, pas une popup |
| Nouvel onglet / fermer l'onglet | Alt+T / Alt+W | |
| Onglet suivant / précédent | Ctrl+PageSuiv / Ctrl+PagePréc | natif navigateur sur certaines plateformes : à vérifier |
| Bascule tiroir sous le diagramme | Ctrl+J | existant, inchangé |
| Aller à l'objet (palette) | Ctrl+K | seulement si la refonte prévoit une palette globale |
| Rechercher dans l'historique | Ctrl+Alt+H | |
| Rechercher dans les résultats | Ctrl+F dans la grille | |

Une aide « Raccourcis » (bouton `?` de la barre d'état) s'ouvre en popover, pas en modale.

---

## 6. Exécution

### 6.1 Que lance chaque geste

| Geste | Texte envoyé | Mode de découpage |
|-------|--------------|-------------------|
| Ctrl+Entrée avec sélection | la sélection | séparée en instructions |
| Ctrl+Entrée sans sélection | l'instruction sous le curseur (entre deux `;`, ou bloc séparé par ligne vide si pas de `;`) | une instruction |
| F5 / Ctrl+Maj+Entrée | tout le tampon | séparée en instructions (script) |
| « Exécuter ce lot » (SQL Server) | texte jusqu'au prochain `GO` autour du curseur | lot unique, `GO` retiré |
| Menu de l'historique ou d'une requête enregistrée « Exécuter » | le texte entier, dans un nouvel onglet | script |

« Lot » (SQL Server) : un lot `GO`-séparé est envoyé tel quel (une requête), car les variables
(`DECLARE @x`) ne survivent pas d'un lot à l'autre ; le garde de lecture de SQL Server regarde déjà
tout mot interdit n'importe où dans le lot (`MSSQL_FORBIDDEN` : `SET`, `EXEC`, `USE`...). Sur les autres
moteurs, chaque instruction est exécutée séparément, dans l'ordre, sur la même connexion physique.

### 6.2 Découpage des instructions (côté serveur)

Nouveau module `dbAdmin/sqlSplit.ts#splitStatements(sql, engine)`. Il s'appuie sur
`stripSqlNoise` (déjà dans `sqlGuard.ts`) pour ne pas couper dans les commentaires et chaînes, et traite :
`$tag$ ... $tag$` (PostgreSQL), `GO` seul sur une ligne (SQL Server), `/` seul sur une ligne et blocs
`BEGIN ... END;` (Oracle PL/SQL : traité comme **une** instruction), `DELIMITER` (MySQL : refusé avec un
message, non pris en charge). Le découpage est fait **côté serveur** (source de vérité pour les gardes) ;
le client a une copie légère pour déterminer « l'instruction courante » (le même fichier est placé dans
`packages/shared` pour éviter deux implémentations : `packages/shared/src/sqlSplit.ts`).

### 6.3 Plafonds et gardes par instruction

Chaque instruction passe par le garde du rôle, indépendamment :

| Rôle / mode | Garde appliqué à chaque instruction | Nombre max. d'instructions | Transaction |
|-------------|--------------------------------------|----------------------------|-------------|
| `read` (ou lecture pour tous) | `assertReadOnlyStatement` | 20 | une transaction `READ ONLY` par instruction (PostgreSQL, MySQL, Oracle) ; rien sur SQL Server |
| `write`, mode écriture | `assertDataStatement` + `confirmWrite` | 10 | **obligatoirement une transaction unique « tout ou rien »** : un échec annule tout |
| Administrateur, lecture | `assertReadOnlyStatement` | 200 | idem `read` |
| Administrateur, écriture | politique de structure sur l'ensemble des instructions (`findStructuralStatements`) | 200 | option « tout ou rien » (cochée par défaut), non transactionnelle pour le DDL MySQL/Oracle (message explicite) |

Les plafonds 1000 lignes (membre) / 5000 (admin) et 30 s / 120 s restent **par exécution entière** pour
les membres : le temps restant est réparti (une instruction qui dépasse coupe le script). Le plafond de
lignes s'applique par jeu de résultats, et un plafond total de 5000 lignes (membre : 2000) par exécution
protège la mémoire du serveur.

Option par défaut pour un script : « Arrêter à la première erreur » (cochée) ; décochable pour un
administrateur seulement (comportement `SQLCMD`/SSMS « continuer »).

### 6.4 Annulation

- Le client génère un `runId` (UUID v4) et l'envoie avec la requête. Le serveur garde un registre
  en mémoire `Map<runId, { userId, connectionId, cancel(): Promise<void> }>` (mono-process, comme
  `connectionBudget` : limite assumée, cf. `plan-db-admin.md` section Risques).
- `POST /api/connections/:id/run/:runId/cancel` : seul le propriétaire du run (ou un administrateur)
  peut annuler ; réponse `204` même si le run est déjà fini (idempotent).
- Mécanisme par moteur :

| Moteur | Annulation | Remarque |
|--------|------------|----------|
| PostgreSQL | seconde connexion : `SELECT pg_cancel_backend(pid)` (pid lu au début du run) | droit de s'annuler soi-même, sans rôle spécial |
| MySQL / MariaDB | seconde connexion : `KILL QUERY <connection_id>` | |
| SQL Server | `request.cancel()` (déjà utilisé dans `mssql.ts` l.261-274) | |
| Oracle | `connection.break()` d'`oracledb` | à vérifier sur le driver en place |
| SQLite | **non annulable** (`better-sqlite3` est synchrone ; à vérifier dans `sqlite.ts`) | bouton Stop désactivé, durée max réduite à 30 s |

- Après annulation : message « Exécution annulée après 4,2 s », le résultat partiel déjà reçu est
  conservé.
- Annulation à la fermeture de l'onglet ou au rechargement de la page : le serveur détecte la coupure de
  la requête HTTP (`req.raw.on('close')`) et appelle `cancel()`. Aucun processus fantôme sur la base ;
  l'audit note `cancelled`.

### 6.5 Transactions explicites

Deux niveaux, livrés séparément :

1. **Dans une exécution** (lot 4) : « tout ou rien », décrit en 6.3. Sans session persistante. Couvre
   les besoins courants (« je modifie 3 tables ensemble »). C'est la forme proposée par défaut à tous les
   utilisateurs en écriture.
2. **Transaction manuelle entre plusieurs exécutions** (lot 11, optionnel, taille L) : bouton
   « Ouvrir une transaction » qui épingle une connexion physique côté serveur (« session de travail »)
   jusqu'à `COMMIT` / `ROLLBACK` ou 5 minutes d'inactivité (rollback automatique). Garde-fous :
   une session par (utilisateur, connexion, base), réservée aux administrateurs et aux membres `write` ;
   bandeau permanent orange « Transaction ouverte depuis 00:42 · 3 instructions · Valider · Annuler » ;
   fermeture de l'onglet ou du navigateur = rollback ; plafond global de sessions pinnées (20) pour ne
   pas affamer le serveur de base (budget de `connectionBudget`). Les mots `BEGIN` / `COMMIT` /
   `ROLLBACK` tapés à la main restent **refusés** aux membres (ils ne sont pas dans les mots-clés de
   données de `assertDataStatement`, à vérifier dans `DATA_WRITE_KEYWORDS`) ; seul le bouton ouvre la
   transaction. Cette session épinglée permettrait en prime les tables temporaires et `SET` pour les
   administrateurs.

Décision recommandée : livrer le niveau 1 ; ne faire le niveau 2 qu'après validation du propriétaire
(question Q5), car il ajoute un état serveur long (fuites de connexions, verrous tenus par un
navigateur oublié).

### 6.6 Variables et paramètres

Les variables natives des moteurs (`@x` MySQL/SQL Server, `:x` Oracle, `\set` psql) ne sont pas
portables et pour la plupart refusées par les gardes. Athanor propose donc ses **paramètres** :

- Syntaxe `{{nom}}` dans le texte, par exemple `WHERE created_at >= {{depuis}}` (même notation que les
  variables de modèle du projet, cf. `permissions.md` l.54 : cohérence de langage, objets distincts).
- À l'exécution (Ctrl+Entrée), si le texte contient des `{{...}}`, un **formulaire en ligne** apparaît au
  dessus des résultats : un champ par paramètre, type (texte, nombre, date, booléen, liste de valeurs),
  mémorisé dans l'onglet et dans la requête enregistrée.
- La substitution se fait **côté client** en littéraux échappés par moteur (pas de concaténation brute) :
  texte entre quotes avec doublage des apostrophes ; nombre validé par expression ; date ISO validée ;
  booléen par moteur. Le SQL final est affiché dans l'onglet Messages (« SQL exécuté ») et c'est lui que
  le serveur garde, audite et historise. Les gardes ne dépendent donc pas de la substitution.
- Les valeurs ne sont pas stockées dans l'historique serveur (le SQL final, oui, comme aujourd'hui).
- Hors périmètre V1 : listes déroulantes alimentées par une requête.

### 6.7 Mode lecture seule / écriture avec confirmation

Machine d'états d'un onglet :

```
        [Lecture] --(interrupteur Écriture)--> [Écriture armée, rouge]
            ^                                        |
            |                                  Exécuter (Ctrl+Entrée)
            |                                        v
            |                         [Bandeau de confirmation en ligne]
            |                         "Cette exécution peut modifier des données
            |                          sur « Shop prod » (PRODUCTION).
            |                          [Exécuter 2 instructions]  [Annuler]"
            |                                        |
            +------ après l'exécution (option) ------+
```

- Le mode retombe en **Lecture** après chaque exécution d'écriture réussie ou en erreur (réarmement
  explicite à chaque fois ; option utilisateur « garder le mode écriture » désactivée en production).
- La confirmation est un **bandeau en ligne** au-dessus des résultats, avec le nombre et la nature des
  instructions (« 1 UPDATE, 1 DELETE »), le nom de la connexion et l'environnement. Elle remplace le
  `ConfirmDialog` actuel (`SqlPanel` l.185). Elle envoie `confirmWrite: true` dans le corps de la requête
  (déjà exigé par le serveur pour un membre : `DB_ACCESS_WRITE_CONFIRMATION_REQUIRED`), et
  `confirmStructural: true` quand la politique de structure l'a demandé.
- Pas de retape du nom de connexion en production par défaut (décision déjà prise :
  `etat-des-features.md` l.220) ; paramètre optionnel par connexion proposé (Q4).
- `UPDATE` / `DELETE` sans `WHERE` : le client détecte le motif sur l'instruction (analyse légère) et
  ajoute au bandeau « sans clause WHERE : toutes les lignes de la table seront touchées » ; le bouton
  devient `Exécuter quand même`. Avertissement uniquement : le serveur ne refuse pas (ce serait une
  fausse promesse, un `WHERE 1=1` le contourne).

---

## 7. Panneau de résultats

### 7.1 Onglets du panneau

`Résultats 1 · Résultats 2 · ... · Messages · Plan · Historique de l'onglet` (le dernier est facultatif,
V2). Un exécution de n instructions produit n entrées réparties entre jeux de résultats (instruction qui
renvoie des colonnes) et messages (les autres).

### 7.2 Jeux de résultats multiples

Format de réponse du nouveau `POST :id/run` (13.2) :

```ts
interface RunResponse {
  runId: string;
  status: "done" | "error" | "cancelled";
  durationMs: number;
  items: RunItem[];           // dans l'ordre des instructions
}
type RunItem =
  | { kind: "rows"; index: number; sql: string; columns: DbAdminColumnMeta[]; rows: unknown[][];
      rowCount: number; truncated: boolean; durationMs: number }
  | { kind: "affected"; index: number; sql: string; rowCount: number; durationMs: number }
  | { kind: "message"; index: number; level: "info" | "warning"; text: string }   // NOTICE, PRINT
  | { kind: "error"; index: number; sql: string; message: string; code?: string; position?: number };
```

`columns` passe de `string[]` à `{ name, type }` (le type natif est connu des drivers : sert à
l'alignement à droite des nombres, au format des dates, au mode « lecture de cellule »). L'ancien format
`DbAdminQueryResult` reste servi par `POST :id/query` pour la compatibilité des clients existants.

### 7.3 Grille

Réutilisation de `DataGrid.svelte` (virtualisée, tri, largeurs) avec ajouts :

- numéro de ligne, cellule `NULL` en gris italique, booléens en pastille, nombres alignés à droite
  (via `type`), dates formatées en ISO sans fuseau forcé ;
- cellules longues tronquées avec ellipse ; **panneau de cellule** (clic droit > « Voir la valeur ») pour
  le texte long, le JSON (mis en forme) et le binaire (hexadécimal tronqué) ;
- sélection de cellules / lignes / colonnes (clic, Maj+clic, Ctrl+A) ;
- copie : Ctrl+C = TSV (collable dans Excel), « Copier avec en-têtes », « Copier en CSV », « Copier en JSON »,
  « Copier en `INSERT` » (menu contextuel) ;
- recherche dans le résultat (Ctrl+F dans la grille) sur les lignes chargées ;
- tri **local** (sur les lignes chargées) ; indication « tri sur 1000 lignes reçues, pas sur la table »
  quand `truncated` est vrai. Ne jamais laisser croire à un tri serveur.
- Performance : fenêtrage existant OK jusqu'au plafond de 5000 lignes ; pas de pagination dans une
  requête libre (le plafond fait office de limite, avec bandeau « Résultat tronqué à 1000 lignes »
  déjà prévu par `dbadmin.result.truncated`).

### 7.4 Onglet Messages

Chronologie en texte : `[14:02:11] (1) UPDATE orders ... → 12 lignes modifiées, 8 ms`, notices
du moteur, avertissements, **erreurs en ligne avec position** (`position` de l'erreur PostgreSQL/MySQL
convertie en ligne/colonne ; clic = saut dans l'éditeur + soulignement rouge), et le **SQL réellement
exécuté** après substitution des paramètres. C'est aussi ici que s'affichent les deux réponses de la
politique de structure (6.7 / 10.6), avec leurs boutons, au lieu de popups :

- `STRUCTURE_VIA_SCHEMA` : « Cette base est modélisée dans le projet **Boutique**. Les changements de
  structure passent par le schéma. [Ouvrir le projet]. »
- `STRUCTURE_CONFIRMATION_REQUIRED` : « Cette instruction modifie la structure (`ALTER TABLE orders`) et
  laissera le schéma du projet en retard. [Exécuter quand même] [Annuler] ».

### 7.5 EXPLAIN / plan d'exécution

Bouton « Expliquer » (Ctrl+Alt+E) sur l'instruction courante. Résultat dans l'onglet **Plan** :

- Arbre de nœuds normalisé (`PlanNode { id, label, relation?, cost?, estRows?, actualRows?, timeMs?,
  warnings[], children[] }`) rendu comme un arbre indenté avec une barre de coût relatif par nœud, les
  nœuds les plus chers surlignés, et les avertissements (parcours séquentiel d'une grande table, estimation
  de lignes très éloignée du réel).
- Bascule « Arbre / Texte brut / JSON ou XML ». Le brut est toujours disponible (le plan SQL Server est un
  XML `.sqlplan` téléchargeable pour SSMS).
- Mode **Estimé** (ne lance pas la requête) disponible pour `read` et `write`. Mode **Réel**
  (`EXPLAIN ANALYZE`, `SET STATISTICS XML ON`) : **exécute** l'instruction ; réservé à l'administrateur et
  aux membres `write`, en mode Écriture armé (confirmation en ligne), et exécuté dans une transaction
  annulée (`ROLLBACK`) pour les instructions de données. Un `read` n'a que l'estimé.

| Moteur | Estimé | Réel | Format | Remarque |
|--------|--------|------|--------|----------|
| PostgreSQL | `EXPLAIN (FORMAT JSON)` | `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` dans `BEGIN ... ROLLBACK` | JSON | arbre complet |
| MySQL 8 / MariaDB | `EXPLAIN FORMAT=JSON` | `EXPLAIN ANALYZE` (MySQL 8.0.18+) | JSON / texte | MariaDB : `ANALYZE FORMAT=JSON` ; à vérifier par version |
| SQL Server | `SET SHOWPLAN_XML ON` | `SET STATISTICS XML ON` | XML | **jamais tapé par l'utilisateur** : le serveur l'enveloppe lui-même (le garde de lecture interdit `SET`) |
| Oracle | `EXPLAIN PLAN FOR` + `DBMS_XPLAN.DISPLAY` | `DBMS_XPLAN.DISPLAY_CURSOR` | texte | écrit dans `PLAN_TABLE` : hors transaction `READ ONLY` ; texte brut seulement en V1 |
| SQLite | `EXPLAIN QUERY PLAN` | non | texte | arbre simple |

Le pilote ajoute une méthode `explain(sql, { analyze, database })` à `DatabaseAdminDriver` (13.4).
SQL Server et Oracle restent en « texte/XML brut » en V1 ; seuls PostgreSQL, MySQL et SQLite produisent
l'arbre normalisé (lot 8), les deux autres suivent.

### 7.6 Export et copie

| Format | Source | Détail |
|--------|--------|--------|
| CSV | client (existant : `toCsv`, BOM UTF-8) | séparateur configurable `,` / `;` (Excel français) ; en-têtes optionnels |
| JSON | client | tableau d'objets, valeurs déjà JSON-sûres (`DbAdminQueryResult`) |
| Excel `.xlsx` | client, bibliothèque légère chargée à la demande (`write-excel-file`, à vérifier ; éviter `exceljs`, trop lourde) | types respectés (nombres, dates), en-têtes figés |
| TSV dans le presse-papiers | client | Ctrl+C |
| Export complet (au-delà du plafond d'affichage) | serveur : `POST :id/export` en flux | plafond 50 000 lignes, formats CSV/JSON, même garde que la requête, audité `dbaccess.export` ; **lot 7 optionnel**, voir Q6 |

L'export client ne contient que les lignes **reçues** (≤ plafond) et l'interface l'écrit : « Export de
1 000 lignes sur un résultat tronqué ».

### 7.7 Indicateur d'environnement (Prod)

Aujourd'hui `EnvironmentBadge` (nom, couleur, `production`). Dans l'espace :

- **Bandeau de production** : si `connection.production`, ligne de 24 px sous la barre de contexte, fond
  rouge (jeton `danger`) texte blanc, icône + libellé « PRODUCTION · Shop prod » (jamais la couleur seule :
  exigence d'accessibilité) ; teinte rouge de la barre d'onglets de la connexion ; pastille « PROD » dans
  le titre de l'onglet et dans le sélecteur de connexion.
- Autres environnements : bandeau fin (4 px) à la couleur de l'environnement (`environmentColor`) + badge.
- En production : mode Écriture jamais mémorisé, bandeau de confirmation toujours demandé (même pour
  l'administrateur), option « garder le mode écriture » absente.
- Limite assumée : l'environnement vient de l'étape du projet lié. Une connexion sans étape n'a pas de
  bandeau. Proposition en Q4 : champ « environnement » directement sur la connexion d'administration.

---

## 8. Requêtes enregistrées, historique, variables

### 8.1 Modèle

- **Requête enregistrée** : `{ id, connectionId, database?, folderId?, name, description?, sql, params[],
  visibility: 'private' | 'connection', kind: 'read'|'write'|'structure', ownerId, createdAt, updatedAt }`.
- **Dossier** : `{ id, connectionId, ownerId, visibility, parentId?, name }`, deux niveaux maximum.
- **Visibilité** : `private` (moi seul) ou `connection` (toutes les personnes ayant un accès actif à cette
  connexion : administrateurs, membres `read`/`write`). Pas de partage par équipe en V1 (une grant peut déjà
  venir d'une équipe) ; Q7 pour un partage par équipe ou par utilisateur.
- `kind` est calculé à l'enregistrement par la même analyse que `findStructuralStatements` /
  `assertDataStatement` pour afficher une étiquette (« lecture », « écrit des données », « structure ») à
  celui qui reçoit la requête. **Information seulement** : les droits de celui qui exécute décident.

### 8.2 Droits

| Action | Propriétaire | Autre ayant accès à la connexion | Administrateur d'instance |
|--------|:------------:|:--------------------------------:|:-------------------------:|
| Lire une requête `private` | oui | non | non (la vie privée prime ; le journal d'audit garde les exécutions) |
| Lire une requête `connection` | oui | oui | oui |
| Créer / modifier / supprimer les siennes | oui | | |
| Modifier / supprimer celle d'un autre | non | non | supprimer oui (modération) |
| Passer en `connection` | oui, s'il a accès à la connexion | | |
| Exécuter une requête partagée | selon **son** niveau (`read` ne lance jamais une écriture) | | |

Retirer l'accès à la connexion à quelqu'un fait disparaître pour lui les requêtes partagées au prochain
appel (jointure sur `effectiveDbAccess`, comme tout le reste). Les requêtes `private` d'un utilisateur
dont l'accès est retiré restent en base (supprimées avec la connexion ou le compte).

### 8.3 Interface

Vue « Enregistrées » du rail gauche :

- Arbre dossiers > requêtes, deux sections : **Mes requêtes** et **Partagées** (nom du propriétaire en
  gris) ; recherche plein texte (nom + description + SQL) ; glisser-déposer pour ranger.
- Clic = ouvre dans un onglet ; double-clic = ouvre et exécute (si lecture) ; icône de cadenas rouge si la
  requête est étiquetée écriture/structure (pas de double-clic exécutant dans ce cas).
- Enregistrer : Ctrl+S sur un nouvel onglet affiche **un champ de nom en ligne dans l'onglet** (pas de
  popup) + sélecteur de dossier + bascule « Partager avec les personnes ayant accès à cette connexion ».
- Mise à jour : Ctrl+S sur un onglet lié modifie la requête (si c'est la sienne) ; sinon « Enregistrer une
  copie ».

### 8.4 Historique

Vue « Historique » (amélioration de `query-history`) : liste groupée par jour, filtre texte, filtre
statut (réussi / erreur), filtre mode (lecture / écriture), durée et nombre de lignes, bouton
« Épingler » = convertir en requête enregistrée, « Ouvrir dans un onglet », « Réexécuter ». Restent :
200 entrées par (utilisateur, connexion) (`MAX_ENTRIES` de `queryHistory.ts`, relevable à 500), SQL
tronqué à 20 000 caractères. Un script multi-instructions est **une** entrée (texte complet) avec le
nombre d'instructions ; les statistiques par forme (`queryStats.ts`) continuent à être alimentées par
instruction.

---

## 9. Liens avec le modèle (diagramme)

### 9.1 De l'espace Requêtes vers le diagramme

Pour une table de l'arbre : « Voir dans le diagramme ». Le lien est possible si la connexion est liée à
au moins un projet **que l'utilisateur peut lire** et dont le modèle contient une table de même nom
(comparaison insensible à la casse, schéma si présent). Résolution :

- Administrateur : `overview.structurePolicy.projects` donne déjà les projets liés (et leurs noms) ;
  pour un membre cette liste est vidée volontairement (`routes.ts` l.308, « named to administrators
  only »).
- Membre : le nouveau `GET /api/me/sql-connections` (13.1) renvoie `projects: [{id, name}]` filtrés par
  `getEffectivePermission ≥ view` (un membre ne apprend le nom d'un projet que s'il peut le lire).
- Action : `routing.openProjectById(projectId, { tableName })` (signature utilisée par
  `App.svelte` pour les résultats de recherche : `focusTarget`), qui ouvre le projet et centre la table.
- Plusieurs projets : petit menu « Ouvrir dans... ». Aucun projet : l'entrée est absente (pas grisée avec
  une explication longue ; une info-bulle « Aucun projet lisible ne modélise cette base » suffit).

### 9.2 Du diagramme vers l'espace Requêtes

Aujourd'hui `SqlDrawerState.viewTableData` ouvre le tiroir et pose `request = {sql, token}`. Cible :

- Le **tiroir** (Ctrl+J) est conservé comme « requête rapide » : il héberge le **même** composant
  `QueryWorkspace` en mode compact (un onglet visible, pas d'arbre), sur la connexion active du projet. Il
  partage l'état des onglets avec l'espace Requêtes (même `tabsStore`), donc une requête commencée sous le
  diagramme se retrouve dans l'espace complet via un bouton **« Ouvrir dans l'espace Requêtes »** (icône
  d'agrandissement, ouvre la route `/requetes/:id?tab=...`).
- « Voir les données » sur une table du diagramme (`viewTableData`) ouvre le tiroir et exécute
  l'aperçu comme aujourd'hui ; ajout d'une action du menu contextuel de la table « Ouvrir dans l'espace
  Requêtes ».
- L'onglet « Données » du projet (`DataTab.svelte`) est remplacé par `QueryWorkspace` avec la connexion
  pré-sélectionnée (verrouillée sur celles du projet) : plus de `DbConsole` pour les membres. L'administrateur
  y trouve un lien « Administration de ce serveur » vers l'ancienne console (utilisateurs, sessions...).
- Le texte « Voir ce que la base contient » est cohérent avec l'état « hors schéma » : si une requête a
  changé la structure (`markOutOfSchema`), le bandeau de dérive du projet existant s'affiche déjà ; l'espace
  Requêtes affiche en plus un lien « Voir le projet » dans l'onglet Messages (7.4).

### 9.3 Détails de table

Fiche décrite en 4.4. Les clés étrangères de la fiche sont des liens : clic sur la cible d'une FK = ouvrir
la fiche de la table cible dans un onglet.

---

## 10. Permissions par rôle

### 10.1 Rôles et ce qu'ils signifient vraiment aujourd'hui

Source : `docs/permissions.md` (« Database access (members) »), `dbAccess/service.ts#requireDbConsoleUser`,
`dbAdmin/routes.ts`.

| Rôle | Comment on l'obtient | Notes |
|------|----------------------|-------|
| Administrateur d'instance | `users.is_admin` | accès à toute connexion, `access = "admin"` |
| Membre `write` | grant `write` sur la connexion (utilisateur ou équipe) | données seulement : `INSERT/UPDATE/DELETE/MERGE`, une instruction, `confirmWrite` |
| Membre `read` | grant `read` | une instruction de lecture, `READ ONLY`, 1000 lignes, 30 s |
| Sans accès | aucune grant | `404 CONNECTION_NOT_FOUND` (même réponse que « inexistante ») |
| Clé d'API | quelle que soit la personne | refusée sur ces routes (`404`) : l'espace est une affaire de navigateur |

Deux dimensions de **compte de base** se combinent avec le niveau, par connexion
(`connection.authMode` : `shared` / `personal`) :

- **Compte partagé** : tout membre exécute avec le compte stocké sur la connexion ; seul le filtre
  d'Athanor le borne (`etat-des-features.md` l.213-214). Le droit réel dépend du compte, souvent très
  privilégié : c'est le point de faiblesse connu.
- **Compte personnel** : la personne exécute avec le compte qu'elle a donné (`PUT
  /api/connections/:id/credentials`) ; sans compte, `PERSONAL_CREDENTIALS_REQUIRED`. Les droits de la base
  s'ajoutent aux filtres d'Athanor.

### 10.2 Matrice « fonction × rôle » dans l'espace Requêtes

Légende : **✔** disponible ; **—** invisible (masqué) ; **◐** visible mais désactivé avec explication ;
**(A)** fonctionnalité administrateur uniquement.

| Fonction de l'espace | Admin | Membre `write` | Membre `read` | Sans accès |
|----------------------|:-----:|:--------------:|:-------------:|:----------:|
| Voir l'entrée « Requêtes » | ✔ | ✔ | ✔ | — (écran 11.6 par lien direct) |
| Liste des connexions accessibles | toutes | accordées | accordées | vide |
| Arbre : bases, schémas, tables, vues, colonnes, index | ✔ | ✔ | ✔ | — |
| Bases système dans l'arbre | ✔ (case) | — | — | — |
| Fiche de table, DDL, données paginées | ✔ | ✔ | ✔ | — |
| Définition de procédure / fonction / vue | ✔ | ✔ | ✔ | — |
| Éditeur, onglets, complétion, formatage, snippets | ✔ | ✔ | ✔ | — |
| Lecture (SELECT, EXPLAIN estimé, SHOW) | ✔ | ✔ | ✔ | — |
| Script de lectures (jusqu'à 20 instructions) | ✔ (200) | ✔ (20) | ✔ (20) | — |
| Interrupteur Écriture | ✔ | ✔ | — | — |
| Écriture de données (INSERT/UPDATE/DELETE/MERGE) | ✔ | ✔ (10, transaction unique) | ◐ « Votre accès est en lecture seule. Demandez l'accès en écriture à un administrateur. » | — |
| Structure (CREATE/ALTER/DROP/TRUNCATE) | ✔ (politique de structure) | ◐ « La structure se modifie dans le schéma du projet. » (jamais autorisée) | ◐ idem | — |
| Procédures (`EXEC`/`CALL`), `SELECT ... INTO` | ✔ (A) | ◐ refusées par le filtre | ◐ | — |
| Comptes, droits (GRANT/REVOKE/CREATE USER) | ✔ (A, politique) | ◐ refusés | ◐ | — |
| EXPLAIN réel (`ANALYZE`) | ✔ | ✔ (mode écriture armé) | — (estimé seulement) | — |
| Annuler sa propre exécution | ✔ | ✔ | ✔ | — |
| Annuler l'exécution d'un autre | ✔ (A) via Sessions | — | — | — |
| Historique perso, recherche, épingler | ✔ | ✔ | ✔ | — |
| Requêtes enregistrées perso | ✔ | ✔ | ✔ | — |
| Partager une requête avec la connexion | ✔ | ✔ | ✔ | — |
| Supprimer la requête partagée d'un autre | ✔ (A) | — | — | — |
| Export CSV / JSON / Excel / copie | ✔ | ✔ | ✔ | — |
| Export complet serveur (> plafond) | ✔ | ✔ | ◐ à décider (Q6) | — |
| Relever les plafonds (5000 lignes, 120 s) | ✔ (A) | — | — | — |
| Supprimer base/table/colonne depuis l'arbre | ✔ (A) | — | — | — |
| Utilisateurs, sessions, sauvegardes, santé, journal de la base | lien vers l'administration (A) | — | — | — |
| Voir le projet modélisant la table | ✔ | ✔ si lisible | ✔ si lisible | — |
| Donner son compte (mode personnel) | ✔ | ✔ | ✔ | — |

Règles d'affichage :

- **Masquer** ce qui est hors du champ de la personne (administration, bases système, interrupteur
  Écriture pour `read`). Raison : un bouton inutilisable en permanence est du bruit, et dire à un membre
  `read` qu'il existe une administration des sessions ne lui apprend rien d'utile.
- **Désactiver avec explication** ce que la personne pourrait demander à avoir : l'écriture pour un `read`,
  la structure pour tous les membres (pour qu'on sache où aller), l'écriture sur une connexion en lecture
  seule. L'explication est une phrase courte en info-bulle **et** dans la barre d'état quand l'utilisateur
  tente l'action (pas seulement au survol : l'accessibilité clavier l'exige).
- Les droits sont relus à chaque requête côté serveur ; le client rafraîchit `GET /api/me/sql-connections`
  à l'ouverture de l'espace et sur un `403/404` inattendu, pour réagir à une grant retirée.

### 10.3 Garde-fous qui restent identiques (rappel pour ne rien élargir)

`sqlGuard.ts` inchangé dans sa logique ; seules les entrées changent (une instruction à la fois, après
découpage). Plafonds membres inchangés. Pas de `confirmStructural` pour un membre. `CONNECTION_READ_ONLY`
toujours prioritaire. Un membre sans compte personnel n'est jamais connecté en compte stocké.

### 10.4 Bases système et liste de toutes les bases

Aujourd'hui `overview` liste toutes les bases du serveur à un membre (`etat-des-features.md` l.237 : point
signalé pour la revue de sécurité). L'espace masque les bases `system` par défaut côté interface pour tous
(simplification) et ne les montre aux administrateurs que sur demande. **Ce n'est pas une mesure de
sécurité** : un membre peut toujours taper `SELECT * FROM mysql.user` si son compte le peut. Le vrai
correctif (liste filtrée côté serveur, par droit effectif) est un point de la revue de sécurité, pas de
ce chantier ; à noter en Q8.

### 10.5 Compte actif : ce que la personne voit

| Mode | Affichage dans la barre de contexte | Action |
|------|-------------------------------------|--------|
| Partagé (membre) | « Compte partagé » + info-bulle « Vos droits sont ceux du compte de la connexion. » | aucune |
| Partagé (admin) | « Compte partagé : `svc_app` » | lien vers la connexion |
| Personnel, compte donné | « Votre compte : `ada` » + `⋯` > Changer / Retirer | |
| Personnel, compte manquant | « Compte requis » en orange et **panneau en ligne dans la zone de travail** : champs identifiant (pré-rempli par `suggestedUsername`) et mot de passe + bouton « Se connecter » | remplace la popup `PersonalAccountDialog` ; mêmes routes `connectionsApi` |

Le panneau « compte requis » est affiché à la place des résultats **et** à la place de l'arbre de la
connexion concernée (qui ne peut pas se charger). Le serveur ne révèle toujours pas le nom du compte
stocké à un membre (Q10).

### 10.6 Messages d'erreur utiles (mappage code serveur → texte)

Le principe : dire **ce qui s'est passé, pourquoi, et quoi faire**, dans l'onglet Messages (7.4) et la
barre d'état, sans jargon de code. Les codes existent déjà côté serveur (`shared/errors.ts`).

| Code / situation | Texte proposé (fr) | Action proposée |
|------------------|--------------------|-----------------|
| `CONNECTION_NOT_FOUND` (404) | « Cette connexion n'existe pas ou vous n'y avez plus accès. » | Retour à la liste ; rafraîchir les accès |
| `DB_ACCESS_WRITE_FORBIDDEN` | « Votre accès à cette base est en lecture seule. Demandez l'accès en écriture à un administrateur. » | Lien « Voir qui administre » (si utile) |
| `DB_ACCESS_WRITE_CONFIRMATION_REQUIRED` | (ne doit pas se produire : le bandeau envoie la confirmation) | Rafraîchir l'onglet |
| `DB_ADMIN_WRITE_NOT_ALLOWED` (membre, structure/autre) | « Cette instruction n'est pas autorisée depuis cet espace (`DROP`, procédures et comptes sont réservés). Les changements de structure se font dans le schéma du projet. » | [Ouvrir le projet] si lié |
| `DB_ADMIN_WRITE_NOT_ALLOWED` (lecture, plusieurs instructions, avant lot 4) | « Une seule instruction à la fois en lecture. » | disparaît avec les scripts |
| `CONNECTION_READ_ONLY` | « Cette connexion est en lecture seule (réglage de l'administrateur). » | |
| `PERSONAL_CREDENTIALS_REQUIRED` | « Cette connexion utilise des comptes personnels. Saisissez votre identifiant de base pour continuer. » | panneau 10.5 |
| `STRUCTURE_VIA_SCHEMA` (admin) | voir 7.4 | [Ouvrir le projet] |
| `STRUCTURE_CONFIRMATION_REQUIRED` (admin) | voir 7.4 | [Exécuter quand même] |
| `DB_ADMIN_QUERY_FAILED` (502) | afficher **le message de la base tel quel** (« permission denied for table orders ») sous un en-tête « La base a refusé l'instruction » + position cliquable | si « permission denied » : « Votre compte (`ada`) n'a pas ce droit sur la base. Demandez-le au propriétaire de la base. » |
| Timeout | « Interrompu après 30 s (limite de votre accès). » | « Ajouter un filtre ou un LIMIT » ; admin : relever la limite |
| Annulation | « Exécution annulée après 4,2 s. » | |
| Résultat tronqué | « Affichage limité à 1 000 lignes. Affinez la requête ou exportez. » | |
| Connexion hors ligne | « Impossible de joindre le serveur. Dernière vérification il y a 3 min. » | Réessayer ; lien vers la santé (A) |
| Limite de débit (429) | « Trop de requêtes en peu de temps. Réessayez dans quelques secondes. » | |
| Budget de la cible (`takeConnectionBudget`) | « Trop de connexions en cours vers ce serveur. Réessayez. » | |

Les textes vont dans `locales/fr.json` et `en.json` sous `queries.*` ; les clés `dbadmin.*` /
`dbAccess.*` existantes sont réutilisées quand elles couvrent le cas.

---

## 11. Maquettes ASCII

Les largeurs sont indicatives (écran 1440 px). Le style visuel (couleurs, espacements, icônes) relève du
chapitre design system ; ici, structure et états.

### 11.1 Écran principal

```
+--------------------------------------------------------------------------------------------------------+
| Athanor   Projets   Requêtes*   Administration                                      [?]  [cloche]  [ada v] |
+--------------------------------------------------------------------------------------------------------+
| Connexion [* Shop prod  v] [PROD]  Base [shop v]  Compte: partagé   Mode [ Lecture | Ecriture ]     [Etat]|
+========================================= PRODUCTION · Shop prod =======================================+
| OBJETS | ENREGISTREES | HISTORIQUE |  [ Requête 1 * ][ top_clients ][ orders (table) ][ + ]            |
+--------+-----------------------------+------------------------------------------------------------------+
| filtrer...                           |  1  SELECT c.id, c.name, SUM(o.total) AS ca                       |
| v * Shop prod  postgres   [PROD]     |  2    FROM customers c                                            |
|   v shop                             |  3    JOIN orders o ON o.customer_id = c.id                       |
|     v public                         |  4   WHERE o.created_at >= {{depuis}}                             |
|       v Tables (42)                  |  5   GROUP BY c.id, c.name                                        |
|         > customers     ~12 k        |  6   ORDER BY ca DESC;                                            |
|         v orders        ~1,2 M       |                                                                   |
|             id          bigint  PK   |  [> Exécuter Ctrl+Entrée] [Expliquer] [Formater] [Enregistrer]    |
|             customer_id bigint  FK   |  Limite 1 000 lignes v   Délai 30 s v                  [Stop]     |
|             created_at  timestamptz  +------------------------------------------------------------------+
|         > order_items   ~3,8 M       | Résultats 1 | Messages (2) | Plan | Historique de l'onglet       |
|       > Vues (6)                     |  id  | name        | ca        |  Copier v  Exporter v           |
|       > Procédures et fonctions (11) | -----+-------------+-----------+                                  |
|   + Autre base (2)                   |  17  | Dupont SA   | 128 440,0 |                                  |
|                                      |  3   | Martin & Cie|  97 120,5 |                                  |
|                                      |  ...                                                              |
+--------------------------------------+------------------------------------------------------------------+
| 1 000 lignes (tronqué) · 412 ms · postgres 16 · compte partagé · lecture · Ln 4, Col 22                [?]|
+--------------------------------------------------------------------------------------------------------+
```

Points de lecture : la ligne `====` est le bandeau de production (rouge, avec le texte) ; l'étoile après
« Requêtes » marque l'entrée active ; `*` après un titre d'onglet signale un brouillon modifié.

### 11.2 Arbre d'objets : états

```
Etat normal                      Etat filtre « ord »            Etat erreur par noeud
v * Shop prod                    v * Shop prod                  v * Stats (mysql)
  v shop                           v shop                         v reporting
    v public                         v public                       ! permission denied for schema
      v Tables (42)                    v Tables (2/42)                 hr  [Réessayer]
        > orders                         > orders                  > ventes
        > order_items                    > order_items
                                       v Vues (1/6)
Menu contextuel (clic droit sur orders)
+---------------------------------------+
| Sélectionner les 100 premières lignes |
| Ouvrir la fiche                       |
| Générer         >  SELECT / INSERT /..|
| Copier          >  nom / nom qualifié |
| Voir dans le diagramme  > Boutique    |
| ------------------------------------- |
| Supprimer la table...    (admin seul) |
+---------------------------------------+
```

### 11.3 Résultat multi-jeux, messages et erreur

```
Résultats 1 (12 lignes) | Résultats 2 (3 lignes) | Messages (4)* | Plan
--------------------------------------------------------------------------
[14:02:11] (1) SELECT ... orders          12 lignes · 8 ms
[14:02:11] (2) SELECT ... customers        3 lignes · 5 ms
[14:02:11] (3) UPDATE orders SET ...       0 ligne modifiée · 3 ms
[14:02:11] (4) ERREUR  La base a refusé l'instruction
            relation "orderz" does not exist          (ligne 9, colonne 8)  [Aller à l'erreur]
            Exécution arrêtée à l'instruction 4 sur 6. Rien n'a été modifié (tout ou rien).
```

### 11.4 Requêtes enregistrées

```
OBJETS | ENREGISTREES* | HISTORIQUE
rechercher dans les requêtes...                [+ Dossier]
v MES REQUETES
  v Facturation
      Impayés > 30 j                         lecture
      Régularisation avoirs       [cadenas]  écrit des données
  v Exports
      Top clients du mois  {{mois}}          lecture
> PARTAGEES
    Contrôle d'intégrité        par grégoire   lecture
    Purge sessions expirées     par ada        [cadenas] écrit des données
-----------------------------------------------------------
Enregistrer (dans l'onglet, en ligne) :
  Nom [ Top clients du mois        ]  Dossier [ Exports v ]
  [x] Partager avec les personnes qui ont accès à « Shop prod »
  [Enregistrer]  [Annuler]
```

### 11.5 EXPLAIN (onglet Plan, PostgreSQL)

```
Plan estimé · PostgreSQL 16 · coût total 18 412            [Estimé | Réel*]  [Arbre | Texte | JSON]
-------------------------------------------------------------------------------------------------
Sort (ca DESC)                                  coût 18 412  ████████████████████ 100 %
 └ HashAggregate (c.id, c.name)                 coût 17 980  ██████████████████▌   97 %
    └ Hash Join (o.customer_id = c.id)          coût 15 210  ███████████████▌      83 %
       ├ Seq Scan on orders o   [!]             coût 12 004  ████████████▌         65 %  ~1,2 M lignes
       │    ! Parcours séquentiel d'une grande table. Index absent sur orders(created_at).
       └ Hash                                   coût    410  ██                     2 %
          └ Seq Scan on customers c             coût    322  █▌                     2 %  ~12 k lignes
[Copier le plan] [Ouvrir en texte] [Réel (exécute la requête)]  « Réel » est désactivé en lecture.
```

### 11.6 État « pas d'accès » et variantes

```
Aucune connexion accessible
+---------------------------------------------------------------+
|                          [icône base barrée]                  |
|        Vous n'avez accès à aucune base de données.            |
|  Un administrateur peut vous donner l'accès en lecture ou     |
|  en écriture à une connexion.                                 |
|                                                               |
|   Administrateurs : ada, grégoire  [Écrire à un admin]        |
|   (affiché seulement si l'instance le permet : Q11)           |
+---------------------------------------------------------------+

Accès retiré pendant la session (404 reçu)
+---------------------------------------------------------------+
| Vous n'avez plus accès à « Shop prod ».                       |
| Vos requêtes enregistrées personnelles sont conservées.       |
| [Choisir une autre connexion]                                 |
+---------------------------------------------------------------+

Compte personnel requis
+---------------------------------------------------------------+
| « Shop prod » utilise des comptes personnels.                 |
| Identifiant [ ada_db     ] (proposé par l'administrateur)     |
| Mot de passe [ ********** ]                                   |
| [Se connecter]   Vos identifiants sont chiffrés, jamais vus   |
|                  par les administrateurs.                     |
+---------------------------------------------------------------+
```

### 11.7 Écriture armée avec confirmation en ligne

```
 Mode [ Lecture | ECRITURE* ]   ← bordure de l'éditeur rouge
 UPDATE orders SET status = 'cancelled' WHERE id = 42;
 +-------------------------------------------------------------------------------------+
 | ! Cette exécution peut modifier des données sur « Shop prod » (PRODUCTION).         |
 |   1 instruction : UPDATE orders  ·  tout ou rien                                    |
 |   [Exécuter 1 instruction]   [Annuler]                                              |
 +-------------------------------------------------------------------------------------+
 UPDATE orders SET status = 'x';   → « sans clause WHERE : toutes les lignes seront touchées »
                                      [Exécuter quand même]  [Annuler]
```

---

## 12. Dépendances avec la navigation globale et le design system

À valider avec les autres chapitres de la refonte (je ne les ai pas ; ce sont des attentes, pas des faits) :

1. Une **destination de premier niveau « Requêtes »** dans la navigation globale (rail ou barre
   supérieure), visible selon 3.1, avec raccourci d'ouverture.
2. Des **jetons de couleur** `danger`, `warning`, `success`, `env-prod` avec contrastes validés en clair et
   en sombre ; l'éditeur reprend les mêmes jetons pour la coloration (≥ 4,5:1 sur le fond).
3. Des composants **Splitter**, **Tabs réordonnables**, **arbre virtualisé**, **bandeau en ligne** (alerte
   avec actions), **menu contextuel** (`Menu.svelte` / `contextMenuStyles.ts` existent) et **popover**
   (`Popover.svelte`) ; les ajouts à `components/ui/` doivent être communs, pas propres à cet espace.
4. Politique « moins de popups » : bandeau en ligne comme composant standard de confirmation non
   destructive.
5. Lecteur d'écran : l'arbre suit le motif ARIA `tree` (`role=tree/treeitem`, `aria-expanded`, flèches) ;
   la grille de résultats garde `aria-label` (`dbadmin.result.gridLabel` existe) ; les changements
   d'état de l'exécution (terminé, erreur, annulé) passent par une région `aria-live="polite"`.

---

## 13. Dimension serveur

### 13.1 Découverte des connexions : `GET /api/me/sql-connections`

Remplace, pour l'espace, la dépendance à la liste des connexions du projet.

- Garde : `requireUser`, refus pour clé d'API (`{ connections: [] }`, comme `/api/me/db-access`).
- Réponse : pour chaque connexion accessible (administrateur : toutes ; membre : celles des grants,
  `listAccessibleConnections`) :
  `{ id, name, engine, level: "admin"|"read"|"write", environment?, environmentColor?, production?,
  readOnly, authMode, personalAccount?: { hasCredentials: boolean, suggestedUsername?: string },
  health: { status, checkedAt }, projects: [{ id, name }] }`.
- Aucune information réseau (`host`, `port`, `user`, `connectionString`) pour un membre : ce qu'il lui faut
  pour travailler, rien de plus. `projects` ne contient que les projets que la personne peut lire.
- Fichiers : `dbAccess/routes.ts` (route), `dbAccess/repository.ts` (requête jointe `db_connections`),
  `packages/shared/src/dbAdmin.ts` (type `SqlConnectionEntry`), `apps/web/src/services/dbAccessApi.ts`.
  `GET /api/me/db-access` reste (compatibilité de `ProjectEditor.mayQuery`).

### 13.2 Exécution : `POST /api/connections/:id/run` (et miroir admin)

Ajouté dans la boucle `consoleRoutes` de `dbAdmin/routes.ts` pour hériter des deux préfixes et du garde
`requireDbConsoleUser`. Corps :

```ts
{ sql: string; database?: string; runId: string;              // uuid côté client
  mode: "read" | "write";                                     // remplace readOnly (readOnly = mode === "read")
  allOrNothing?: boolean;                                      // défaut true en écriture
  stopOnError?: boolean;                                       // défaut true ; false réservé à l'admin
  maxRows?: number; timeoutMs?: number;
  confirmWrite?: boolean; confirmStructural?: boolean;
  paramsApplied?: boolean }                                    // pour l'audit seulement
```

Étapes serveur (dans l'ordre, tout est refusé avant toute connexion à la base) :

1. Garde d'accès (`requireDbConsoleUser`), taille (`MAX_SQL_LENGTH`), `mode === "write"` interdit pour
   `read` (`DB_ACCESS_WRITE_FORBIDDEN`) et sur connexion `readOnly` (`CONNECTION_READ_ONLY`),
   `confirmWrite` exigé d'un membre.
2. `splitStatements` ; refus si plus d'instructions que le plafond du rôle (6.3).
3. Pour **chaque** instruction : garde du rôle (`assertReadOnlyStatement` / `assertDataStatement`) ; pour
   l'administrateur en écriture : `findStructuralStatements` sur l'ensemble + `judgeStructuralActions`
   (comportement actuel de `routes.ts` l.392-402, appliqué à la liste).
4. Un seul `withDriver` pour toute l'exécution (une connexion, un budget dépensé, comme aujourd'hui pour une
   requête), enregistrement du `runId` dans le registre d'annulation (6.4).
5. Boucle d'exécution : `driver.runStatement(stmt, {...})` renvoie un `RunItem` ; plafonds de lignes et de
   temps cumulés ; arrêt selon `stopOnError`.
6. Audit : une ligne `dbaccess.query` / `dbadmin.query` **par instruction** (format actuel du détail),
   plus une ligne `…script` récapitulative (nombre, durée, statut). Historique : une entrée avec le
   texte complet. `recordQuery` est appelé une fois par instruction pour `queryStats` (formes), mais
   l'historique reçoit l'exécution entière (nouveau paramètre `statementCount`).
7. Réponse `RunResponse` (7.2). Les erreurs de la base ne sont plus des `502` de toute la route : une
   instruction en erreur est un `RunItem { kind: "error" }` dans une réponse `200`, avec le message natif ;
   les refus d'Athanor (garde, droit, confirmation) restent des erreurs HTTP avant exécution.

`POST :id/query` reste tel quel (clients, tests existants `routes.test.ts`). Il est réimplémenté au
dessus de `run` en lot 3 ou laissé intact (décision de l'implémenteur ; l'important est qu'il n'y ait
qu'un seul chemin de garde).

Limite de débit : `POST :id/run` à 60 par minute et par utilisateur (plus strict que `READ_LIMIT` 240,
car un script lance jusqu'à 200 instructions) ; 3 exécutions simultanées par (utilisateur, connexion) ;
au-delà `429 DB_ADMIN_TOO_MANY_RUNS` (nouveau code).

### 13.3 Métadonnées, objets, DDL

| Route | Rôle | Garde |
|-------|------|-------|
| `GET :id/completion-metadata?database=` | schémas, tables, vues, colonnes (nom, type, PK, FK cible) pour la complétion ; ETag | `requireDbConsoleUser` |
| `GET :id/routines?database=&schema=` | procédures et fonctions (nom, type, signature) | idem |
| `GET :id/definition?database=&schema=&name=&kind=` | définition d'une vue, procédure, fonction | idem |
| `GET :id/ddl?database=&schema=&table=` | `CREATE TABLE` reconstitué | idem |

Implémentation : trois méthodes ajoutées à `DatabaseAdminDriver` (`drivers/interface.ts`) et implémentées
dans les 5 drivers : `listColumns(database, schema?)` (une requête `information_schema.columns` /
`ALL_TAB_COLUMNS` / `PRAGMA table_info` en boucle pour SQLite), `listRoutines`, `getDefinition`. DDL de
table : module commun `dbAdmin/ddl.ts` qui reconstruit depuis `describeTable` (colonnes, index,
contraintes) avec les règles de citation de `drivers/common.ts` ; l'utiliser aussi comme repli quand un
moteur n'a pas d'équivalent à `SHOW CREATE TABLE`. Le DDL est une approximation documentée (« reconstitué »),
pas un export fidèle (pas de partitions, de commentaires, de droits).

Plafonds : réponse `completion-metadata` limitée à 3000 tables / 40 000 colonnes (6.3 du même esprit que
les plafonds de ligne) ; au-delà, noms de tables seulement. Mise en cache serveur 60 s par
(connexion, base, utilisateur) pour ne pas rouvrir une connexion à chaque frappe.

### 13.4 EXPLAIN : `POST :id/explain`

Corps : `{ sql, database?, analyze?: boolean, confirmWrite?: boolean }`. Garde :

- `analyze=false` : `assertReadOnlyStatement` sur l'instruction (même un `UPDATE` ne peut pas être
  « expliqué » en estimé par un `read` : refusé comme toute écriture) ; pour un `write`/admin,
  `assertDataStatement` accepté (l'estimé n'exécute rien).
- `analyze=true` : réservé à `write` et administrateur, `confirmWrite` obligatoire, instruction unique,
  exécution dans une transaction annulée.
- Le serveur construit lui-même le préfixe `EXPLAIN` ou le jeu `SET SHOWPLAN_XML` ; l'utilisateur n'envoie
  jamais d'`EXPLAIN` à la main pour cette route (les `EXPLAIN` tapés dans l'éditeur restent possibles dans
  `run`, comme aujourd'hui).
- Réponse : `{ engine, mode: "estimated"|"actual", format: "json"|"xml"|"text", raw: string,
  tree?: PlanNode[], totalCost?: number }`. Méthode `explain()` ajoutée à `DatabaseAdminDriver` ;
  normalisation dans `dbAdmin/plans/{postgres,mysql,sqlite}.ts` (fonctions pures, testables sans base).
- Audit `dbaccess.explain` / `dbadmin.explain` (texte de l'instruction, mode).

### 13.5 Annulation

`POST :id/run/:runId/cancel` (6.4). Registre en mémoire `dbAdmin/runRegistry.ts`. Chaque driver expose
`cancelCurrent(): Promise<void>` ; implémentation par moteur détaillée en 6.4. Audit
`dbadmin.query.cancel`.

### 13.6 Requêtes enregistrées et migration SQLite

Dernière migration constatée : `version: 38` dans `infrastructure/migrations.ts` (tableau en fin de
fichier ; à revérifier au moment d'écrire). Nouvelle migration **39** :

```sql
CREATE TABLE IF NOT EXISTS saved_query_folders (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','connection')),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS saved_queries (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  folder_id TEXT,
  database_name TEXT,
  name TEXT NOT NULL,
  description TEXT,
  sql TEXT NOT NULL,
  params_json TEXT,
  kind TEXT NOT NULL DEFAULT 'read' CHECK (kind IN ('read','write','structure')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','connection')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_saved_queries_conn ON saved_queries(connection_id, visibility, owner_id);
ALTER TABLE admin_query_history ADD COLUMN statement_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE admin_query_history ADD COLUMN run_id TEXT;
```

Points d'attention (pièges du dépôt, signalés dans `plan-db-admin.md`) : **`PRAGMA foreign_keys` est
désactivé**, donc pas de `ON DELETE CASCADE` : les suppressions sont manuelles. À ajouter dans la
suppression d'une connexion (`connections/repository.ts#deleteConnection`) : effacer
`saved_queries`, `saved_query_folders` de cette connexion, comme pour `admin_query_history`
(à vérifier : le fait que cette dernière y soit déjà nettoyée) ; et dans la suppression d'un compte
(service `users`) : effacer ses requêtes `private`, et **réattribuer à NULL / à l'admin qui supprime** ses
requêtes `connection` (ne pas faire disparaître du partage une requête utile à d'autres : décision
proposée, Q7).

Routes (sous `/api/connections/:id/`, garde `requireDbConsoleUser`, double préfixe admin comme le reste) :
`GET saved-queries`, `POST saved-queries`, `PUT saved-queries/:qid`, `DELETE saved-queries/:qid`,
`GET/POST/PUT/DELETE query-folders`. Règles : propriété vérifiée sur le serveur (10.2) ; plafonds :
500 requêtes et 50 dossiers par (utilisateur, connexion), SQL ≤ 200 000 caractères (`MAX_SQL_LENGTH`),
nom ≤ 120 ; `kind` recalculé côté serveur (jamais pris du client). Audit : `savedquery.create`,
`savedquery.share`, `savedquery.delete` (nom et visibilité, **pas** le SQL, déjà gardé par l'audit des
exécutions).

### 13.7 Garde-fous de sécurité (synthèse)

1. Aucune route de l'espace n'est exposée sous `/api/v1` ni aux clés d'API (`requireDbConsoleUser`
   continue de refuser `req.apiKey` pour un membre). `openapi.ts` et son test de synchronisation ne
   changent pas ; vérifier que les nouvelles routes n'y sont pas capturées.
2. Chaque instruction est jugée par le garde du rôle **avant** la première connexion ; un script dont une
   instruction est refusée n'en exécute aucune (pas d'exécution partielle d'un script contenant un refus).
3. Aucun `EXPLAIN ANALYZE`, `SET SHOWPLAN`, `BEGIN` construit par le client : le serveur construit les
   enveloppes (contre l'injection par texte d'enveloppe).
4. Registre d'annulation : seule la personne qui a lancé le run ou un administrateur peut annuler ; les
   `runId` sont des UUID, jamais devinables par énumération, et vérifiés contre `userId`.
5. Les requêtes enregistrées sont du texte ; **jamais exécutées automatiquement** à l'ouverture, même
   partagées (évite le « piège » d'une requête de purge ouverte puis exécutée par réflexe de double-clic :
   le double-clic n'exécute que les requêtes étiquetées lecture).
6. Paramètres `{{...}}` substitués côté client en littéraux échappés ; le serveur ne les connaît pas.
7. Export serveur : même garde que la requête, plafonné (50 000), journalisé avec le nombre de lignes,
   jamais les valeurs.
8. Journalisation : l'audit garde le texte SQL tel quel (limite déjà documentée,
   `etat-des-features.md` l.163-164 : `IDENTIFIED BY '…'` apparaît). L'espace doit **avertir** à
   l'enregistrement d'une requête et à l'exécution si le texte contient un motif de mot de passe
   (`IDENTIFIED BY`, `PASSWORD =`, `WITH PASSWORD`) : « Ce texte sera conservé dans le journal. »
9. Documentation obligatoire : mettre à jour `docs/permissions.md` (section « Database access
   (members) » + nouvelles lignes de la matrice) **dans le même commit** que chaque route, comme l'exige
   l'en-tête de ce fichier.
10. Débit et budget : limites de 13.2 ; une exécution = un budget (un `withDriver`), pas un par
    instruction.

---

## 14. Lots de livraison

Estimations en jours-personne indicatifs : **S** = 1 à 2 j, **M** = 3 à 5 j, **L** = 6 à 10 j. Ordre
choisi pour livrer de la valeur visible tôt et sans élargir les droits : d'abord l'accès et l'éditeur, puis
le moteur d'exécution, puis le confort.

### Lot 0 - Entrée et découverte (S)

Objectif : un membre voit ses connexions sans passer par un projet.

- Serveur : `GET /api/me/sql-connections` (13.1), type partagé `SqlConnectionEntry`.
- Web : route `/requetes`, entrée de navigation, `QueriesPage.svelte`, `ConnectionPicker.svelte`, états
  « aucune connexion » et « accès retiré » (11.6). Le contenu reste le `SqlPanel` actuel (réutilisé
  provisoirement).
- Fichiers : `dbAccess/routes.ts`, `dbAccess/repository.ts`, `packages/shared/src/dbAdmin.ts`,
  `services/dbAccessApi.ts`, `app/App.svelte`, `projects/projectRouting.svelte.ts`, nouveau
  `features/queries/{QueriesPage,ConnectionPicker,NoAccess}.svelte`, `locales/{fr,en}.json`.
- Acceptation : un membre `read` sans aucun projet voit sa connexion, l'ouvre, exécute un `SELECT` ; un
  utilisateur sans grant voit l'écran 11.6 ; un `404` en cours de session affiche « accès retiré » ; la clé
  d'API reçoit une liste vide.
- Tests : serveur (membre voit seulement ses grants ; équipe ; admin voit tout ; clé d'API vide ; aucune
  fuite de `host`/`user`) ; e2e Playwright : parcours membre sans projet.

### Lot 1 - Éditeur CodeMirror et onglets (M)

- Web : `SqlEditor.svelte` (lang-sql par dialecte, formatage, snippets, historique d'édition, raccourcis),
  `QueryTabs.svelte`, `tabsStore.svelte.ts` (persistance `localStorage`), barre de contexte, mode
  Lecture/Écriture par onglet. Remplace la `<textarea>`.
- Dépendances : `@codemirror/lang-sql`, `sql-formatter` (import dynamique).
- Fichiers : nouveaux `features/queries/{SqlEditor,QueryTabs,ContextBar}.svelte`, `sqlLanguage.ts`,
  `snippets.ts`, `format.ts` ; `apps/web/package.json`.
- Acceptation : coloration correcte pour les 5 moteurs ; Ctrl+Entrée exécute la sélection ou l'instruction
  courante ; 20 onglets persistent après rechargement ; le mode Écriture ne survit jamais à un
  rechargement ; l'ancien raccourci reste.
- Tests : unitaires (choix du dialecte, instruction courante, persistance corrompue tolérée) ; e2e (créer,
  renommer, fermer, rouvrir un onglet).

### Lot 2 - Arbre d'objets et fiche de table (M)

- Serveur : `routines`, `definition`, `ddl` (13.3 partie objets), méthodes de driver `listRoutines`,
  `getDefinition`, `dbAdmin/ddl.ts`.
- Web : `ObjectTree.svelte` (aplati/virtualisé), `treeModel.ts`, `TableDetails.svelte`, menu contextuel,
  insertion dans l'éditeur, filtre. `ExplorerPanel` n'est plus utilisé par l'espace (il reste dans la
  console d'administration jusqu'au lot 10).
- Fichiers : `drivers/{interface,postgres,mysql,mssql,oracle,sqlite}.ts`, `dbAdmin/routes.ts`,
  `features/queries/{ObjectTree,TableDetails,treeModel}`, `sql/previewStatement.ts` (réutilisé).
- Acceptation : arbre fluide à 5000 tables ; double-clic sur une colonne l'insère ; « Sélectionner les 100
  premières lignes » ouvre un onglet et exécute ; le DDL s'affiche pour chaque moteur ; une base refusée
  montre l'erreur du nœud sans casser l'arbre.
- Tests : drivers (`live.test.ts` étendu : `listRoutines`, `getDefinition` sur PostgreSQL et MySQL en CI ;
  MSSQL/Oracle en optionnel) ; unitaires du modèle d'arbre ; e2e (naviguer, filtrer).

### Lot 3 - Moteur d'exécution : scripts, résultats multiples, messages, annulation (L)

Le plus gros lot, le plus risqué pour la sécurité.

- Serveur : `sqlSplit.ts` (+ copie `packages/shared`), `POST :id/run`, `runRegistry.ts`, `POST
  :id/run/:runId/cancel`, `runStatement` et `cancelCurrent` par driver, audit par instruction, plafonds,
  historique étendu (migration 39 partielle : colonnes d'historique).
- Web : `ResultsPane.svelte` (onglets Résultats / Messages), gestion de `runId`, bouton Stop, bandeau de
  confirmation en ligne (remplace `ConfirmDialog`), traitement des deux réponses de politique de structure
  en ligne, messages d'erreur 10.6.
- Fichiers : `dbAdmin/{routes,sqlSplit,runRegistry,queryHistory}.ts`, `drivers/*.ts`,
  `migrations.ts`, `packages/shared/src/{dbAdmin,sqlSplit}.ts`, `features/queries/{ResultsPane,
  ConfirmBar,Messages,runClient}`.
- Acceptation : un script de 4 `SELECT` produit 4 jeux ; une erreur à l'instruction 3 arrête et le
  dit (position cliquable) ; en écriture membre, 2 `UPDATE` sont tout-ou-rien (le 2e échoue = le 1er
  annulé, vérifié par un `SELECT` ensuite) ; Stop interrompt un `pg_sleep(30)` en moins de 2 s ; un
  `read` ne peut pas glisser un `UPDATE` en 3e position d'un script (aucune instruction exécutée) ;
  un administrateur sous `schema-only` reste redirigé vers le schéma ; ancien `POST :id/query` intact.
- Tests : `sqlSplit.test.ts` (chaînes, commentaires, `$$`, `GO`, `/` Oracle, `DELIMITER` refusé) ;
  `routes.test.ts` étendu (matrice rôle × mode × script, plafonds, `409`/`403` existants inchangés) ;
  `live.test.ts` (annulation sur PostgreSQL et MySQL) ; test de non-régression de `sqlGuard.test.ts`.

### Lot 4 - Complétion depuis le schéma (M)

- Serveur : `completion-metadata` (13.3), `listColumns` par driver, cache 60 s.
- Web : `metadataCache.svelte.ts`, source de complétion, résolution d'alias, diagnostics d'objets
  inconnus.
- Acceptation : `FROM ord` propose `orders` en moins de 100 ms après le premier chargement ; `o.` propose
  les colonnes de `orders` quand `orders o` est dans la requête ; un membre ne voit que les tables
  lisibles par son compte ; échec de métadonnées = complétion limitée aux mots-clés, sans erreur
  bloquante.
- Tests : unitaires du résolveur d'alias (cas : sous-requêtes, CTE, `schema.table alias`) ; serveur
  (plafonds, ETag) ; e2e (frappe et sélection).

### Lot 5 - Requêtes enregistrées et historique (M)

- Serveur : migration 39 (tables), routes 13.6, nettoyage à la suppression de connexion et de compte.
- Web : vues « Enregistrées » et « Historique » du rail, enregistrement en ligne, dossiers, recherche,
  épinglage.
- Acceptation : une requête partagée est visible d'un autre membre ayant accès, pas d'un membre sans accès
  ; retirer la grant la fait disparaître au prochain appel ; un `read` ne peut pas exécuter une requête
  partagée qui écrit (refus clair) ; supprimer la connexion supprime ses requêtes ; double-clic
  n'exécute jamais une requête étiquetée écriture.
- Tests : repository (propriété, visibilité), routes (matrice 10.2), migration sur base peuplée (la
  convention du dépôt : migration testée), e2e (enregistrer, partager, retrouver).

### Lot 6 - Résultats : grille enrichie, export, copie (M)

- Web : panneau de cellule, copie TSV/CSV/JSON/INSERT, export CSV/JSON/Excel (import dynamique), tri/filtre
  de la fiche de table par génération de SQL, formatage par type.
- Serveur : `columns` typées dans `RunItem` (déjà prévues au lot 3 ; ici affichage).
- Optionnel (Q6) : `POST :id/export` en flux (plafond 50 000) + audit.
- Acceptation : l'export Excel s'ouvre sans avertissement dans Excel, nombres et dates typés ; `Ctrl+C`
  d'une sélection colle dans une feuille ; le CSV garde le BOM et le séparateur choisi.
- Tests : unitaires (`toCsv`, TSV, échappements, nombres larges en chaîne) ; e2e (export).

### Lot 7 - EXPLAIN (M)

- Serveur : `POST :id/explain`, `explain()` par driver, normalisation PostgreSQL/MySQL/SQLite en
  `PlanNode`, brut pour SQL Server/Oracle.
- Web : onglet Plan (arbre, barres de coût, avertissements, brut), bouton Expliquer, mode Réel confirmé.
- Acceptation : l'estimé ne modifie rien (vérifié par un `UPDATE` expliqué puis relu) ; le Réel exécute
  dans une transaction annulée (aucune ligne modifiée après un `EXPLAIN ANALYZE UPDATE`) ; un `read` n'a
  pas le Réel.
- Tests : fonctions de normalisation (jeux JSON enregistrés), `routes.test.ts` (droits), `live.test.ts`
  PostgreSQL.

### Lot 8 - Liens avec le modèle et cadres (S/M)

- Web : « Voir dans le diagramme » ; tiroir (Ctrl+J) et onglet « Données » remplacés par
  `QueryWorkspace` compact/ancré ; bouton « Ouvrir dans l'espace Requêtes ».
- Fichiers : `sql/sqlDrawer.svelte.ts`, `sql/EditorSqlDrawer.svelte`, `workspace/DataTab.svelte`,
  `editor/ProjectEditor.svelte` (l.226, 357-360, 634, 804-814), `projects/projectRouting`.
- Acceptation : depuis une table de l'arbre, le projet s'ouvre sur la table ; une requête commencée dans
  le tiroir se retrouve dans l'espace ; un membre ne voit jamais le nom d'un projet qu'il ne peut pas lire.
- Tests : e2e ; unitaires de `sqlDrawer`.

### Lot 9 - Production, paramètres, finitions de sécurité (S/M)

- Bandeau de production (7.7), avertissement `UPDATE/DELETE` sans `WHERE`, avertissement motif de mot de
  passe, paramètres `{{...}}` avec formulaire, option de retape du nom en production si Q4 le décide.
- Acceptation : en production, aucun mode écriture mémorisé ; un `DELETE FROM t` est signalé ; un
  paramètre date invalide est refusé avant envoi.
- Tests : unitaires de la substitution (injection : apostrophes, `;`, commentaires), e2e.

### Lot 10 - Retrait des doublons et documentation (S)

- Supprimer `sql/SqlPanel.svelte`, `ConfirmDialog`s de confirmation d'écriture devenus inutiles ; réduire
  `DbConsole` aux sections d'administration (utilisateurs, sessions, santé, sauvegardes, journal) avec un
  lien « Ouvrir dans l'espace Requêtes » ; `ExplorerPanel` conservé seulement pour les suppressions
  administrateur (menu de l'arbre) ou retiré ; mise à jour de `docs/permissions.md`,
  `docs/etat-des-features.md` (section 7), `docs/user-guide.md`, `CHANGELOG.md`.
- Acceptation : aucun import de `SqlPanel` ; la console d'administration ne contient plus d'onglet SQL
  (un lien à la place) ; la doc dit la vérité.
- Tests : suite complète verte (build, lint, tests serveur et web, e2e).

### Lot 11 (optionnel) - Transactions manuelles et sessions de travail (L)

Voir 6.5 niveau 2. Ne démarre qu'après la décision Q5. Serveur : `workSession.ts` (connexion pinnée,
inactivité 5 min, rollback automatique, plafond global), routes `POST :id/session/{begin,commit,rollback}`,
affichage de l'état ; Web : bandeau de transaction ouverte.
Acceptation : fermer l'onglet annule ; 5 min d'inactivité annulent ; 21e session refusée proprement ;
aucun verrou ne subsiste dans `listBlocking` après annulation. Tests : `live.test.ts` PostgreSQL/MySQL +
tests de fuite (compteur de connexions ouvertes avant/après).

### Récapitulatif

| Lot | Contenu | Taille | Dépend de |
|-----|---------|:------:|-----------|
| 0 | Entrée, découverte des connexions | S | - |
| 1 | Éditeur CM6 + onglets | M | 0 |
| 2 | Arbre + fiche de table + DDL | M | 0 |
| 3 | Moteur d'exécution (scripts, multi-résultats, annulation) | L | 1 |
| 4 | Complétion depuis le schéma | M | 1, 2 |
| 5 | Requêtes enregistrées + historique | M | 1 |
| 6 | Résultats, export, copie | M | 3 |
| 7 | EXPLAIN | M | 3 |
| 8 | Liens avec le modèle, tiroir, onglet Données | S/M | 1, 2 |
| 9 | Production, paramètres, finitions | S/M | 3 |
| 10 | Retrait des doublons, doc | S | 8 |
| 11 | Transactions manuelles (optionnel) | L | 3, décision Q5 |

Total indicatif sans le lot 11 : environ 30 à 45 jours-personne. Livrables à valeur autonome : 0 (accès
des membres), 0+1 (un vrai éditeur), 0+1+2 (explorateur complet), puis 3.

---

## 15. Tests (stratégie transversale)

- **Serveur** (`node --test`, comme `routes.test.ts`, `sqlGuard.test.ts`, `queryStats.test.ts`) :
  - matrice rôle (admin / `write` / `read` / sans accès / clé d'API) × mode × nombre d'instructions pour
    `run`, `explain`, `completion-metadata`, `routines`, `ddl`, `saved-queries` ;
  - non-régression : tous les tests actuels de `routes.test.ts` (892 lignes) et `sqlGuard.test.ts` (170)
    passent sans modification ;
  - `sqlSplit.test.ts` : chaînes avec `;`, commentaires imbriqués, `$$`, `GO`, blocs Oracle, `DELIMITER` ;
  - annulation et fuite de connexions (`live.test.ts` PostgreSQL et MySQL ; MSSQL/Oracle en optionnel,
    comme aujourd'hui) ;
  - migration 39 sur base peuplée ; suppression de connexion et de compte (nettoyage manuel, FK
    désactivées) ;
  - audit : une ligne par instruction, jamais de valeurs de résultat.
- **Web** (`vitest`, comme `dataGrid.test.ts`, `previewStatement.test.ts`) : instruction courante,
  dialecte, substitution de paramètres, modèle d'arbre, résolveur d'alias, `toCsv`/TSV, état des onglets.
- **E2E** (Playwright, `apps/web/e2e/*.e2e.ts`) : parcours membre `read` sans projet ; membre `write`
  confirme une écriture et voit le bandeau ; administrateur sous politique `schema-only` ; compte
  personnel manquant puis donné ; annulation d'une requête longue ; enregistrement et partage ;
  grant retirée pendant la session.
- **Accessibilité** : navigation clavier de l'arbre et de la grille, contrastes des bandeaux de
  production, région live des états d'exécution (audit manuel de fin de lot 3 et lot 9).

---

## 16. Risques et questions ouvertes pour le propriétaire

### 16.1 Risques

| # | Risque | Gravité | Parade |
|---|--------|:-------:|--------|
| R1 | Les scripts élargissent la surface d'attaque du filtre SQL (il « n'est pas un analyseur », `etat-des-features.md` l.233) : un découpage faux laisse passer une instruction que le garde n'a pas vue | haute | Le garde s'applique au **texte complet reçu** ET à chaque instruction ; le découpeur est testé sur un corpus d'évasions (chaînes, `$$`, commentaires MySQL `/*!`) ; en cas de doute, refus ; plafonds d'instructions ; revue de sécurité (déjà due avant tout usage réel) |
| R2 | Compte partagé très privilégié : l'espace rend l'accès plus facile et plus visible, donc plus utilisé | haute | Messages « vos droits sont ceux du compte de la connexion » ; recommander les comptes personnels ; Q1 |
| R3 | Annulation : chaque moteur a ses pièges (permissions de `KILL QUERY`, `pg_cancel_backend` sur un autre rôle, SQLite non annulable) | moyenne | Annuler **sa propre** session par pid connu ; test par moteur ; Stop désactivé honnêtement sur SQLite |
| R4 | Sessions épinglées (lot 11) : fuites de connexion, verrous tenus | haute | Lot optionnel, plafonds, rollback automatique, tests de fuite |
| R5 | Volume : arbre de milliers de tables, complétion de dizaines de milliers de colonnes | moyenne | Virtualisation, plafonds serveur, chargement par table au-delà |
| R6 | Le texte SQL (avec secrets) est gardé tel quel dans l'audit et l'historique | moyenne | Avertissement 13.7 point 8 ; Q2 pour un masquage serveur |
| R7 | Les requêtes partagées deviennent un vecteur de « piège » (ex. `DELETE` partagé) | moyenne | Étiquette de nature, double-clic non exécutant, droits de l'exécutant, confirmation en ligne |
| R8 | `lang-sql` et `sql-formatter` : poids du bundle et dialectes incomplets (Oracle) | basse | Import dynamique ; repli sur le dialecte standard ; le formatage peut être désactivé par moteur |
| R9 | Registres en mémoire (annulation, budget) : non partagés si l'instance passe en plusieurs processus | basse | Documenté comme la limite actuelle de `connectionBudget` |
| R10 | Rattrapage de la navigation : l'espace dépend d'une destination de premier niveau qui relève d'un autre chapitre | moyenne | Lot 0 livrable avec une entrée provisoire (lien depuis l'écran des projets, à côté de « Admin ») |
| R11 | Contrastes et accessibilité : bandeaux rouge/orange, coloration d'éditeur | moyenne | Jetons validés au chapitre design system ; audit en fin de lots 3 et 9 |

### 16.2 Questions ouvertes

1. **Q1 - Compte partagé ou personnel par défaut ?** Faut-il, pour une connexion où des membres ont des
   grants, **recommander** (ou imposer, par un réglage d'instance) les comptes personnels, sachant que le
   filtre d'Athanor ne remplace pas les droits de la base ? Et doit-on afficher aux membres le nom du
   compte partagé utilisé (Q10) ?
2. **Q2 - Secrets dans l'audit.** Masquer côté serveur les motifs `IDENTIFIED BY '…'` / `PASSWORD '…'`
   dans l'audit et l'historique (changement de comportement documenté comme « antérieur » dans
   `etat-des-features.md`), ou seulement avertir à la saisie ?
3. **Q3 - Connexion temporaire.** Souhaitez-vous que l'administrateur puisse créer un lien « connexion
   éphémère » (expire en 24 h, un seul utilisateur) pour un prestataire, plutôt que d'accorder une
   grant durable ? Hors périmètre de ce document, mais ça influence le modèle de grants.
4. **Q4 - Environnement et production.** (a) L'environnement vient aujourd'hui de l'étape du projet
   lié ; veut-on un champ « environnement » **sur la connexion d'administration** pour que le bandeau
   Prod existe aussi sans projet ? (b) Faut-il retaper le nom de la connexion avant une écriture en
   production (décision actuelle : non) ? (c) Faut-il interdire le mode écriture aux membres en
   production et le réserver aux administrateurs ?
5. **Q5 - Transactions manuelles (lot 11).** Besoin réel ou « tout ou rien » suffit-il ? Le lot 11 ajoute
   un état serveur long (connexions pinnées). Recommandation : ne pas le faire tant qu'un cas d'usage
   concret n'est pas posé.
6. **Q6 - Export massif.** Un membre `read` peut-il exporter jusqu'à 50 000 lignes (aujourd'hui :
   1 000), ce qui change la nature de ce qu'on peut sortir de la base via Athanor ? Réservé aux `write`
   et administrateurs, ou à tous, ou jamais (export limité à l'affichage) ? Pas de restriction par
   colonne existe aujourd'hui (`permissions.md` fin).
7. **Q7 - Partage des requêtes.** Seulement « tout le monde ayant accès à la connexion », ou aussi par
   équipe / par personne ? Que devient une requête partagée quand son auteur est supprimé
   (réattribution à l'administrateur proposée) ? Un `read` peut-il publier une requête d'écriture (elle
   est étiquetée, mais il ne peut pas la lancer lui-même) ?
8. **Q8 - Liste des bases pour un membre.** Faut-il, dans ce chantier, filtrer côté serveur la liste des
   bases par droit effectif (aujourd'hui toutes les bases du serveur sont listées à un membre,
   `etat-des-features.md` l.237) ? Recommandation : le traiter dans la revue de sécurité, masquer côté
   interface en attendant.
9. **Q9 - Où vivent les préférences ?** Connexions épinglées, onglets ouverts et brouillons en
   `localStorage` (perdus à un changement de navigateur) ou en base (suivent l'utilisateur, mais stockent
   du SQL non enregistré sur le serveur) ? Recommandation V1 : local ; V2 : brouillons serveur chiffrés.
10. **Q10 - Visibilité du compte de la connexion pour un membre.** Montrer « compte partagé `svc_app` »
    révèle un nom de compte technique ; le masquer rend le diagnostic des erreurs « permission denied »
    plus difficile. Quelle politique ?
11. **Q11 - Écran « pas d'accès ».** Peut-on afficher la liste des administrateurs à un membre sans accès
    (utile, mais divulgue qui administre l'instance) ?
12. **Q12 - Édition de lignes dans la grille.** Hors périmètre (❌ dans l'état des features). Faut-il la
    prévoir après les transactions manuelles (modification d'une cellule = `UPDATE` généré et confirmé en
    ligne, uniquement pour les tables ayant une clé primaire) ? Si oui, le choix des lots 3 et 11 devient
    plus structurant.
13. **Q13 - Prise en charge d'Oracle et SQL Server pour l'EXPLAIN visuel et l'annulation.** Ces moteurs
    ont peu de tests automatisés (`plan-db-admin.md`, Risques). Livre-t-on l'espace en le déclarant
    « complet sur PostgreSQL et MySQL, de base sur SQL Server/Oracle/SQLite » ?
14. **Q14 - SQLite et fichiers.** SQLite est surtout une base locale/serveur-fichier : acceptable en
    lecture dans l'espace (oui), mais l'annulation impossible et les restrictions d'écriture de fichier
    (`assertNotAppDatabase`) valent-elles une mention dédiée ?
15. **Q15 - Nom de l'entrée de navigation.** « Requêtes » (retenu ici), « SQL », « Données » ? À trancher
    avec le chapitre navigation, en gardant la cohérence avec l'onglet de projet actuel « Données & SQL ».

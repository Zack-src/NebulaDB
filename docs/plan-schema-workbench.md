# Plan : écosystème schéma ↔ base de données (brouillon v1, détaillé)

Statut (2026-10-02) : **brouillon à affiner, rien n'est commencé.** Chaque chantier ci-dessous donne :
l'objectif, **où** ça vit dans l'application, **ce que ça donne visuellement** (maquettes ASCII),
le comportement, les données/API touchées, et les questions ouvertes. Prolonge
`docs/plan-db-admin.md` (console d'administration, livrée).

Légende des maquettes : `[ ]` bouton, `( )` choix, `▾` liste déroulante _maison_, `🔒` verrou, `⚠` alerte.

---

## 0. Vision et navigation cible

Un seul produit, **deux modes de travail sur une même base**, avec un passage d'un clic de l'un à l'autre.

| Mode                       | Usage                                                                            | Où                                                                      |
| -------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Données & SQL** (simple) | Requêtes, consultation/édition de lignes ; admin : utilisateurs, rôles, sessions | Console de la connexion (existe) + panneau SQL dans l'éditeur (nouveau) |
| **Schéma** (avancé)        | Créer / modifier / supprimer tables, colonnes, index, relations                  | **Uniquement via l'éditeur de schéma**, puis déploiement                |

**Où ça se place aujourd'hui** : l'éditeur est `features/editor/ProjectEditor.svelte` (barre
`ProjectToolbar.svelte`, canvas `canvas/CanvasArea.svelte`, panneau texte `dbml/DbmlPanel.svelte`,
bascule `mcd/ViewModeToggle.svelte`). La console est `features/admin/connections/DbConsole.svelte`
(Explorateur / SQL / Utilisateurs / Sessions), accessible seulement via Admin → Connexions.

**Cible : un « espace de travail base de données » par projet** avec une barre d'onglets unique :

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ ◀ Projets   Boutique-prod     [env: PROD ●]   ◉ postgres-prod ▾    👥 3   [Déployer]│
├─────────────────────────────────────────────────────────────────────────────────────┤
│  Schéma    Données & SQL    Déploiements    Historique    ┊ Admin : Utilisateurs    │
│  ━━━━━━                                                   ┊         Sessions        │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                          (contenu de l'onglet actif)                                │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

- « Schéma » = l'éditeur actuel (canvas + DBML). « Données & SQL » = explorateur + console réutilisés.
- Les onglets _Utilisateurs_ / _Sessions_ n'apparaissent que pour l'admin global (comme aujourd'hui).
- Le sélecteur de connexion (`postgres-prod ▾`) est le même partout ; l'environnement (PROD/DEV) est
  toujours visible, en rouge pour la production.
- Les redirections du §2 deviennent un simple changement d'onglet **avec l'objet sélectionné**.

**À créer** : `features/workspace/WorkspaceShell.svelte` (barre + routage d'onglets), route
`/projects/:id/:tab` dans `features/projects/projectRouting.svelte.ts`.

---

## 1. Fondations UI : design system et composants maison (à faire en premier)

**Constat** : ~19 fichiers `.svelte` utilisent `<select>`, ~43 des `<input>` natifs. La base
`components/ui/` contient `Button, Input, Field, Card, Badge, Tabs, List*, Skeleton*, EmptyState` et
`components/overlays/{Modal, GlobalTooltip}`. Il manque tout ce qui est « formulaire riche » et « menus ».

### 1.1 Composants à créer (`apps/web/src/components/ui/`)

| Composant                                  | Remplace                                                                  | Particularités                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `Select.svelte` / `Combobox.svelte`        | `<select>`                                                                | recherche, groupes, icône par option, clavier, mobile               |
| `Menu.svelte` + `MenuItem`                 | menus ad hoc (`ToolbarMenu`, `InsertToolDropdown`, `DetailLevelDropdown`) | un seul moteur : positionnement, sous-menus, raccourcis affichés    |
| `Checkbox`, `Radio`, `Switch`              | cases natives                                                             | états indéterminé / désactivé / erreur                              |
| `NumberInput`, `TextArea`, `PasswordInput` | `<input type=number…>`                                                    | stepper, unités, afficher/masquer                                   |
| `Popover`, `Tooltip`                       | tooltips natifs `title=`                                                  | ancrage, flèche, délai                                              |
| `Toast`                                    | messages ponctuels                                                        | pile, actions « Annuler »                                           |
| `ConfirmDialog`                            | `confirm()` / modales répétées                                            | niveau de danger, « retapez le nom » (déjà utilisé pour les DROP)   |
| `DataGrid`                                 | `ResultGrid.svelte`                                                       | virtualisation, tri, redimensionnement de colonnes, cellules typées |
| `Splitter`                                 | panneaux fixes                                                            | redimensionnable, mémorisé par utilisateur                          |
| `KeyHint`, `SegmentedControl`              | `ViewModeToggle`                                                          | uniformisation                                                      |

Exemple visuel d'un `Select` maison (à la place du menu natif du navigateur) :

```
Moteur
┌──────────────────────────────┐
│ 🐘 PostgreSQL              ▾ │         ┌──────────────────────────────┐
└──────────────────────────────┘         │ 🔎 Rechercher…               │
                                         ├──────────────────────────────┤
                                         │ ✓ 🐘 PostgreSQL              │
                                         │   🐬 MySQL / MariaDB         │
                                         │   🪟 SQL Server              │
                                         │   🔴 Oracle                  │
                                         │   🪶 SQLite                  │
                                         └──────────────────────────────┘
```

### 1.2 Tokens et thème

- Fichier unique de tokens (`styles/`) : couleurs sémantiques (`--surface-1/2/3`, `--accent`,
  `--danger`, `--warning`, `--locked`), espacements (échelle 4 px), rayons, ombres, durées d'animation
  (`--motion-fast: 120ms`), tailles de police. Clair/sombre issus des mêmes tokens.
- Le `components/dev/ComponentCatalogue.svelte` existant devient la **vitrine vivante** : chaque composant,
  tous ses états, clair/sombre.

### 1.3 Garde-fou de migration

- Règle ESLint locale : interdit `<select>` et `<input type="checkbox|radio|number|date">` bruts dans
  `features/**` ; migration écran par écran (liste dans ce document, cases à cocher).
- Accessibilité : rôles ARIA, focus visible, navigation clavier testée (Playwright, `apps/web/e2e/`).

**Questions ouvertes** : socle headless (Bits UI / Melt UI) ou tout en interne ? maquettes Figma d'abord ?

---

## 2. Éditeur DBML : bugs d'édition et auto-format (correctif prioritaire, indépendant)

**Symptôme** : en modifiant à la main la cible d'une relation (`Ref: orders.user_id > users.id` → autre
table), le texte « revient en arrière ».

**Où** : `features/editor/dbml/DbmlEditor/DbmlEditor.svelte` (effet de resync, l. ~150-180),
`dbml/setup.ts` (`documentSync`), `dbml/format.ts`, `dbml/completion.ts`, `dbml/rename.ts`.

**Hypothèses classées**

1. _Boucle frappe → parse → modèle → sérialisation → écrasement_ : l'effet de resync réécrit le buffer
   avec la sérialisation normalisée alors que l'utilisateur est en train de taper (état transitoirement
   invalide, ou texte reformaté).
2. _Normalisation à la volée_ (`format.ts`) appliquée pendant l'édition.
3. _Complétion_ qui remplace une plage devenue obsolète.
4. _Référence invalide un instant_ : le schéma est resynchronisé depuis l'ancien modèle.

**Plan de correction**

- **Test de reproduction d'abord** : test CodeMirror headless qui rejoue une frappe sur une ligne `Ref:` et
  vérifie que le texte final = texte tapé (aucun `dispatch` externe pendant la frappe).
- **Règle** : _pendant que l'éditeur a le focus et qu'une saisie a eu lieu il y a < N ms, le buffer est
  la source de vérité ; la resynchronisation est différée_ (au blur ou après pause) et ne remplace jamais
  une version plus récente (numéro de révision comparé).
- **Formatage = action explicite** : bouton « Formater » + raccourci + option « formater à
  l'enregistrement » (désactivée par défaut). Plus de réécriture silencieuse.
- **Modifications automatiques listées et configurables** dans les réglages de l'éditeur.

Visuel — réglages de l'éditeur :

```
Éditeur DBML ─ comportement
  Formater automatiquement ........ [ Jamais ▾ ]   (Jamais · À l'enregistrement · À la pause)
  Renommage propagé (graphe) ...... ( ) Oui  (•) Demander
  Compléter les relations ......... [✓]
  Synchroniser avec le graphe ..... [ À la pause (400 ms) ▾ ]
```

- Indicateur discret dans `StatusBar.svelte` : `● Synchronisé` / `◌ En attente` / `⚠ Erreur ligne 42`.

**Tests** : séquences de frappe sur `Ref:`/types/noms ; deux clients simultanés (cf. `documentSync`).

---

## 3. Verrouillage de tables et rôles

**Objectif** : un admin bloque une table ; un utilisateur moins permissionné **consulte** mais ne peut
ni changer la structure, ni supprimer la table, ni modifier ses données par défaut (seed).

### 3.1 Où ça apparaît

**a) Sur le graphe** (`editor/nodes/TableNode.svelte`, sous-dossier `table/`) :

```
┌─────────────────────────────┐        ┌─────────────────────────────┐
│ users                  🔒   │        │ orders                      │
├─────────────────────────────┤        ├─────────────────────────────┤
│ 🔑 id         bigint        │        │ 🔑 id         bigint        │
│    email      varchar(255)  │        │ ↗  user_id    bigint        │
│    created_at timestamp     │        │    total      numeric(10,2) │
└─────────────────────────────┘        └─────────────────────────────┘
 bordure grisée + cadenas ;               table libre, éditable
 poignées d'édition masquées
```

**b) Clic droit** (`canvas/CanvasContextMenu.svelte`), pour un utilisateur sans droit :

```
 users  🔒 Verrouillée par Alice (admin) — « Table de référence RH »
 ───────────────────────────────
  Voir les données
  Copier le DDL
  ✗ Renommer              (grisé — table verrouillée)
  ✗ Supprimer             (grisé — table verrouillée)
```

**c) Pour l'admin**, le même menu propose « Verrouiller… » :

```
┌ Verrouiller la table « users » ───────────────────────────────────────┐
│ Niveau      (•) Structure  seuls les admins modifient colonnes/types  │
│             ( ) Complet    structure + données initiales + suppression│
│ Motif       [ Table de référence RH________________________ ]         │
│ Qui peut déverrouiller   [ Admins du projet ▾ ]                       │
│                                      [Annuler]  [🔒 Verrouiller]      │
└───────────────────────────────────────────────────────────────────────┘
```

**d) Éditeur DBML** : les lignes d'une table verrouillée sont **en lecture seule** (plage protégée
CodeMirror, fond légèrement hachuré, info-bulle « verrouillée »). Le reste du fichier reste éditable.

**e) Liste des verrous** : onglet/panneau « Verrous » (admin) avec tableau Table · Niveau · Posé par ·
Date · Motif · [Déverrouiller].

### 3.2 Modèle et application

- Migration : `table_locks(project_id, table_name, level, reason, locked_by, locked_at)`.
- **Serveur = source de vérité** : toute écriture de schéma (routes `projects/routes/crud.ts`,
  `importExport.ts`, API publique `/api/v1`, plugins, collaboration) est validée ; erreur
  `TABLE_LOCKED` (+ clé i18n `serverErrorMessages.ts`). Les diffs de schéma qui touchent une table
  verrouillée sont rejetés **en entier** avec la liste des tables en cause.
- Permission explicite `table.lock.manage` ; audit `table.lock|unlock` (`shared/audit.ts`).
- Temps réel : événement de collaboration pour afficher/retirer le cadenas sans rechargement.
- Le seed (§5) hérite du verrou `full`.

**Questions ouvertes** : verrou par colonne ? un admin de projet peut-il lever le verrou de l'admin
global ? matrice de rôles exacte (aujourd'hui `projects` + `teams`, à documenter avant de coder).

---

## 4. Politique « la structure passe par le schéma »

**Constat** : la console (`modules/dbAdmin/`, `sqlGuard.ts`, `StatementModal.svelte`) permet DROP de
colonne/table/base et du DDL en SQL libre : cela contourne le schéma et crée de la dérive.

### 4.1 Comportement

Toute action structurelle tentée en console est interceptée :

```
┌ Modifier la structure ──────────────────────────────────────────────┐
│  ⚠ Cette base est pilotée par le schéma « Boutique-prod ».          │
│                                                                     │
│  Vous essayez de : supprimer la colonne  orders.legacy_ref          │
│                                                                     │
│  Les changements de structure se font dans le schéma, puis sont     │
│  déployés — vous gardez l'historique, la revue et le retour arrière.│
│                                                                     │
│            [Annuler]            [ Ouvrir dans le schéma  ➜ ]        │
└─────────────────────────────────────────────────────────────────────┘
```

- « Ouvrir dans le schéma » → onglet Schéma, centré et **sélectionné sur `orders.legacy_ref`**
  (mécanisme `scrollToTable` de `DbmlEditor` déjà présent, à étendre à la colonne).
- Détection dans le SQL libre via `sqlGuard.ts` : `CREATE|ALTER|DROP` sur `TABLE|COLUMN|INDEX|VIEW`.
- Base non rattachée à un projet : « Créer un projet depuis cette base » (`NewProjectFromDatabaseModal`).

### 4.2 Réglage admin (désactivable)

Dans Admin → Connexions → _Modifier la connexion_ (`ConnectionEditModal.svelte`), nouvelle section :

```
Politique de structure
 (•) Via le schéma uniquement   — redirection obligatoire (recommandé)
 ( ) Avertir                    — autorisé après confirmation, marqué « hors schéma »
 ( ) Libre                      — aucune restriction
 [✓] Appliquer aussi au SQL libre
```

Défaut d'instance dans Admin → Paramètres ; la connexion peut être plus stricte, jamais plus laxiste
que le défaut sauf décision de l'admin global. Changement audité.

### 4.3 Dérive

Si une action « hors schéma » a eu lieu, un bandeau dans l'onglet Schéma :
`⚠ La base a divergé du schéma (2 différences) [Voir] [Resynchroniser]` — réutilise « Check differences »
(`editor/compare/`) et `pull.ts`.

**Questions ouvertes** : politique par connexion, par projet, ou les deux (le plus strict gagne) ?
connexion `read-only` = cas particulier ?

---

## 5. Données initiales (seeds) : tables ↔ fichiers CSV

### 5.1 Où et visuel

Dans le panneau d'une table (sélection sur le graphe → panneau latéral/inspecteur), section
« Données initiales » :

```
users                                                          🔒 (si verrouillée)
├ Colonnes │ Index │ Relations │ Données initiales ◂
──────────────────────────────────────────────────────────────
 Source   [ 📄 users.csv  (12 Ko, 248 lignes) ]  [Remplacer] [Retirer]
 Format   CSV ▾     Séparateur  ; ▾    En-tête  [✓]    Encodage  UTF-8 ▾
 Si déjà des lignes  ( ) Ignorer  (•) Ajouter si vide  ( ) Mettre à jour (clé : id ▾)

 Correspondance des colonnes
   CSV            →   Table
   id             →   id            ✓
   mail           →   email         ✓ (suggéré)
   prenom         →   — ignorer ▾
 Aperçu                                          ⚠ 2 problèmes
 ┌────┬──────────────────┬────────────┐
 │ id │ email            │ created_at │
 │ 1  │ a@x.fr           │ 2026-01-02 │
 │ 2  │ ⚠ « pas un mail »│ 2026-01-03 │   ← ligne 2 : valeur invalide (varchar(255) ok, UNIQUE violé)
 └────┴──────────────────┴────────────┘
```

Sur le graphe : petite icône 📄 dans l'en-tête des tables qui ont un seed, tooltip « 248 lignes (CSV) ».
Dans le DBML : annotation de table `Note`/`seed: 'users.csv'` (à définir, doit rester du DBML valide).

### 5.2 Modèle et déploiement

- Entité `table_seeds(project_id, table_name, format, file_ref, options_json, updated_at)`.
- Interface `SeedSource` (`csv` en V1 ; `json`, `xlsx`, `sql` ensuite) → pas de CSV figé dans le modèle.
- Stockage du fichier côté serveur, **versionné avec l'historique du projet**.
- Validation à l'import (types, NOT NULL, UNIQUE, clés étrangères) **avant** le déploiement ; protection
  contre l'injection de formules CSV, limite de taille, détection d'encodage.
- Étape ajoutée dans `modules/connections/deploy.ts` : après le DDL, insertion **dans l'ordre du graphe
  de clés étrangères**, par lots, en transaction quand le moteur le permet ; les cycles sont détectés et
  signalés. Le dry-run (`DeploymentModal.svelte`) affiche : `users : +248 lignes`.
- Export inverse : console → table → « Exporter comme données initiales » (CSV déjà exportable).

**Questions ouvertes** : taille max (flux au-delà) ? renommage de colonne → migration du mapping ?

---

## 6. SQL depuis l'éditeur de schéma

### 6.1 Où et visuel

Panneau **repliable en bas** de l'onglet Schéma (raccourci `Ctrl+J`), redimensionnable (`Splitter`) :

```
┌ Canvas ────────────────────────────────────────────────────────────────┐
│    [users 🔒]────<[orders]────<[order_items]                           │
│                                                                        │
├ ▾ SQL ─ postgres-prod · PROD ● · lecture seule ────────────[⤢] [✕] ────┤
│ 1  SELECT u.email, count(*) AS commandes                               │
│ 2  FROM users u JOIN orders o ON o.user_id = u.id                      │
│ 3  GROUP BY u.email ORDER BY commandes DESC LIMIT 100;                 │
│ [▶ Exécuter Ctrl+↵]  Historique ▾  Max 1000 lignes · 5 s               │
├────────────────────────────────────────────────────────────────────────┤
│ email              │ commandes │         42 ms · 100 lignes  [CSV]     │
│ a@x.fr             │ 18        │                                       │
└────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Liens graphe ↔ SQL (ce qui fait l'expérience)

- Clic droit sur une table → **Voir les données** : ouvre le panneau avec `SELECT * FROM users LIMIT 100`.
- Clic sur un nom de table dans un résultat/erreur → sélection de la table dans le graphe.
- Autocomplétion SQL alimentée par **le schéma du projet** (pas besoin d'interroger la base).
- Résultat → ligne cliquable pour ouvrir la ligne liée (clé étrangère) dans un second onglet de résultats.
- DDL tapé ici → même interception que §4 (« Ouvrir dans le schéma »).

### 6.3 Technique

Extraire `SqlPanel.svelte`, `ResultGrid.svelte` (→ `DataGrid`, §1) de `features/admin/connections/` vers
`features/sql/` pour que console **et** éditeur les partagent ; `services/dbAdminApi.ts` inchangé côté API.

### 6.4 Permissions (à trancher, sécurité)

Aujourd'hui toute la console est `requireAdmin`. Proposition : _lecture seule_ pour les membres
d'un projet ayant le rôle « éditeur » (connexion liée, `READ ONLY`, quotas `connectionBudget`, audit),
_écriture de données_ selon un droit explicite, structure jamais (§4).

---

## 7. Refonte visuelle écran par écran

Ordre (chaque écran = une PR, avec captures avant/après) :

1. Connexion/inscription (`features/auth/`) — vitrine du nouveau style.
2. Liste des projets (`projects/ProjectListScreen.svelte`).
3. Barre d'outils et canvas (`ProjectToolbar`, `canvas/*Toolbar*`, menus → `Menu`).
4. Panneaux : DBML, historique, commentaires, paramètres.
5. Console base de données (`admin/connections/*`) et administration.
6. Modales : tout passe par `Modal` + `ConfirmDialog` uniformisés.

**Principes** : une seule hiérarchie (surface → carte → ligne), densité réglable (confortable/compacte),
transitions courtes et cohérentes, états vides illustrés (`EmptyState`), squelettes de chargement,
mode sombre de première classe, `prefers-reduced-motion` respecté.

---

## 8. Journal d'activité et logs (admin)

**Objectif** : une interface admin pour voir **tout ce qui s'est passé**, de deux sources :
(A) ce qui a été fait **depuis Athanor**, (B) ce que la **base elle-même** a enregistré.

**Existant** : `shared/audit.ts` (journal append-only des actions sensibles), `modules/audit/routes.ts`,
`features/admin/AuditTab.svelte`, `ErrorsTab.svelte`, historique de déploiement (`deployment_history`),
historique SQL par admin (`admin_query_history`).

### 8.1 Où et visuel

Nouvel onglet Admin → **Activité** (remplace/fédère Audit + Erreurs), vue unique à filtres :

```
Activité        Source: [ Toutes ▾ ]  Connexion: [ postgres-prod ▾ ]  Utilisateur: [ Tous ▾ ]
                Type: [ Structure · Données · Comptes · Sessions · Déploiements ]  Période: [ 24 h ▾ ]
                🔎 Rechercher…                                                        [Exporter CSV]
─────────────────────────────────────────────────────────────────────────────────────────────────
 ● 14:32  Athanor   alice   DÉPLOIEMENT  Boutique-prod → postgres-prod   +2 tables, 1 colonne   ›
 ● 14:10  Athanor   bob     SQL (écriture) UPDATE users SET … (12 lignes)                         ›
 ▲ 13:58  Base      app_etl DDL           ALTER TABLE orders ADD COLUMN note text      ⚠ externe ›
 ● 13:40  Athanor   alice   VERROU        users verrouillée (structure)                           ›
 ○ 13:05  Base      —       CONNEXION     12 sessions ouvertes (pic)                              ›
─────────────────────────────────────────────────────────────────────────────────────────────────
 ● Athanor   ▲ Base (détecté)   ⚠ hors Athanor           Détail ▸ SQL complet, durée, IP, corrélation
```

- Clic sur une ligne : panneau de détail (SQL complet, durée, lignes affectées, IP, projet, lien
  « Ouvrir dans le schéma » ou « Voir le déploiement »).
- Filtre « Hors Athanor uniquement » en un clic ; tri chronologique, pagination par curseur.
- Les entrées Athanor sont liées au même identifiant de corrélation que les lignes de log base (§8.3).

### 8.2 Journal Athanor (A)

- Étendre `shared/audit.ts` : types d'événements ajoutés (verrous, politique de structure, seeds,
  SQL de l'éditeur, détection de dérive), champs communs `connection_id, project_id, correlation_id`.
- Rétention configurable (Admin → Paramètres), export CSV/JSON, signature d'intégrité optionnelle (chaînage
  de hashs) pour un journal infalsifiable.
- Plus de bruit : les lectures simples restent hors journal (comme aujourd'hui) ; seules les écritures,
  la structure, les comptes et les sessions sont tracées.

### 8.3 Logs côté base de données (B)

Les moteurs n'exposent pas tous la même chose ; on définit des **niveaux de capacité** par connexion,
détectés au test de connexion et affichés à l'admin :

| Niveau                    | Nécessite                             | Donne                                                       | Moteurs                                                                                                                                                              |
| ------------------------- | ------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Instantané**        | lecture du catalogue                  | « le schéma a changé » (sans auteur)                        | tous, y compris SQLite                                                                                                                                               |
| **1 — Activité**          | droits de supervision                 | sessions actives, requêtes récentes, utilisateurs connectés | `pg_stat_activity` / `pg_stat_statements`, `performance_schema` (MySQL), DMV (SQL Server), `V$SESSION` (Oracle)                                                      |
| **2 — Journal DDL/audit** | configuration côté serveur par le DBA | qui a fait quoi, quand                                      | PostgreSQL (event triggers ou lecture du log), MySQL (`general_log` en table / audit plugin), SQL Server (Extended Events / trace par défaut), Oracle (audit unifié) |

Visuel — carte de capacité dans _Modifier la connexion_ :

```
Surveillance de la base
 Niveau 0  Détection des changements de schéma   ✓ disponible
 Niveau 1  Activité des sessions                 ✓ disponible
 Niveau 2  Journal des modifications (qui/quand) ✗ non configuré   [Comment l'activer ▸]
           └ « Créez un event trigger ddl_audit… » (script fourni, à exécuter par votre DBA)
```

- Athanor **ne configure jamais** l'audit côté serveur sans accord explicite : il fournit le script et
  vérifie ensuite qu'il fonctionne.
- Collecte : tâche de fond légère (réutilise l'intervalle de santé, `ATHANORDB_CONNECTION_HEALTH_INTERVAL_MINUTES`),
  respecte `connectionBudget`, jamais de polling agressif. Lignes stockées dans `db_activity_log`
  (rétention courte, plafonnée) ; contenu des requêtes tronqué et masqué (littéraux sensibles).
- Nouveau module serveur `modules/dbMonitor/` (collecteurs par moteur dans `drivers/`, même schéma que `dbAdmin/drivers`).

**Questions ouvertes** : quelle rétention par défaut ? masquage des littéraux dans les requêtes copiées ?
export vers un SIEM (syslog/webhook) ?

---

## 9. Détection des modifications externes et alertes

**Objectif** : si la base est modifiée autrement que par un déploiement Athanor, Athanor le **détecte** et
**alerte**, pour les projets configurés en mode « détecter les modifications externes à Athanor ».

### 9.1 Configuration (par projet, avec connexion liée)

Dans les paramètres du projet, onglet **Surveillance** :

```
Surveillance de la base                                 Connexion : postgres-prod
 [✓] Détecter les modifications externes à Athanor
 Vérifier              [ toutes les 15 min ▾ ]     (5 min · 15 min · 1 h · 6 h · quotidien)
 Portée                (•) Structure (tables, colonnes, index, contraintes)
                       ( ) Structure + vues/fonctions/procédures
                       ( ) + comptes et permissions (admins)
 Ignorer               [ schémas techniques : pg_*, information_schema ▾ ] [ + tables… ]
 Quand une différence est trouvée
   Alerter via   [✓] Dans Athanor   [✓] E-mail (admins du projet)   [ ] Webhook   [ ] Slack*
   Gravité       ( ) Info   (•) Avertissement   ( ) Critique si connexion PROD
   Action auto   (•) Aucune   ( ) Marquer le projet « divergent » et bloquer les déploiements
                                                                  [Enregistrer]
```

*Slack via webhook entrant, pas une intégration dédiée au début.

### 9.2 Comment ça marche (principe)

1. **Empreinte de référence** : après chaque déploiement réussi ou « pull », Athanor introspecte la base
   (`introspectSchema`, déjà présent) et stocke une **empreinte normalisée** (hash par table + détail).
   C'est l'état « attendu ».
2. **Contrôle périodique** (tâche de fond, même mécanique que la santé des connexions) : nouvelle
   introspection, comparaison avec la référence.
3. **Attribution** : si différence, on regarde si un déploiement Athanor récent l'explique
   (`deployment_history`). Sinon → **modification externe**. Avec le niveau 2 (§8.3), on ajoute
   l'auteur et l'heure exacts ; sinon « auteur inconnu (détecté à 14:30) ».
4. **Événement** `drift.detected` : entrée de journal (§8), alerte, mise à jour de l'état du projet.
5. Après traitement par l'utilisateur, la référence est mise à jour (§9.4).

Nuance de conception : on compare une **représentation normalisée** (types canonisés, ordre stable,
valeurs par défaut équivalentes) pour éviter les faux positifs (ex. `varchar(255)` vs `character varying(255)`).

### 9.3 Ce que voit l'utilisateur

**a) Bandeau dans l'éditeur de schéma** :

```
⚠ La base « postgres-prod » a été modifiée en dehors d'Athanor (détecté à 14:30) — 3 différences
  [ Voir les différences ]   [ Mettre à jour le schéma ]   [ Réappliquer le schéma ]   [ Ignorer ]
```

**b) Page de détail des différences** (réutilise `editor/compare/`) :

```
 Différences base ↔ schéma                       Auteur : app_etl (niveau 2)   14:28
 ─────────────────────────────────────────────────────────────────────────────────
  + orders.note        text           ajoutée dans la base       [Importer] [Supprimer de la base]
  ~ users.email        varchar(255) → varchar(320)               [Importer] [Rétablir]
  − audit_log          table absente de la base                  [Retirer du schéma] [Recréer]
```

Chaque différence se résout : **importer** dans le schéma (le schéma suit la base), **rétablir**
(un déploiement ramène la base au schéma), ou **ignorer** (liste d'exceptions).

**c) Indicateurs** : pastille rouge sur la liste des projets et sur l'onglet Schéma, badge « divergent »
sur les tables concernées dans le graphe (en plus du cadenas §3).

**d) Centre d'alertes admin** : cloche dans la barre du haut avec la liste, accusé de réception, historique.

### 9.4 Alertes

- **Canaux** : dans Athanor (cloche), **e-mail** (SMTP déjà configuré, `config.ts`/`nodemailer`),
  **webhook** (`modules/webhooks/` : nouvel événement `drift.detected`, signature et reprises existantes).
- Anti-bruit : regroupement (une alerte par détection, pas par table), délai de grâce, mise en sourdine,
  accusé de réception, rappel si non traité sous N heures.
- **Dérive connue** : si l'utilisateur choisit « Ignorer », la différence est ajoutée à une liste
  d'exceptions et ne ré-alerte pas.
- **Lien avec §4** : la politique « structure via le schéma » évite la dérive côté Athanor ; la détection
  couvre le reste (DBA, scripts, autres outils).

### 9.5 Données et API

- Tables : `schema_fingerprints(project_id, connection_id, taken_at, source, hash, snapshot_json)`,
  `drift_events(id, project_id, connection_id, detected_at, status, summary_json, attributed_to)`,
  `monitor_settings` (config §9.1), `alert_acks`.
- Routes : `GET/PUT /api/projects/:id/monitoring`, `POST …/monitoring/check` (vérifier maintenant),
  `GET …/drift`, `POST …/drift/:id/resolve`. Exposé aussi dans `/api/v1` + `openapi.ts`.
- Garde-fous : un contrôle respecte `connectionBudget` et `hostGuard` ; les erreurs de connexion ne
  génèrent pas de fausses dérives (état « inconnu », alerte séparée « base injoignable »).

**Questions ouvertes** : portée du premier lot (structure seule ?) ; faut-il surveiller les **données**
(ex. lignes d'une table verrouillée modifiées) ou seulement la structure ? Bloquer automatiquement les
déploiements si divergence non résolue ?

---

## 10. Projets dérivés (variantes par client / par moteur)

**Besoin** : un projet de base (ex. **DeepDetect**) et des **sous-projets** (ex. **L'Oréal**, **La Poste**) qui
héritent de la base, la **personnalisent** (tables/colonnes en plus, types changés, tables retirées) et
peuvent cibler **un autre moteur** (PostgreSQL pour l'un, SQL Server pour l'autre). Quand la base évolue,
les variantes doivent pouvoir suivre **sans perdre leur personnalisation**.

**Où aujourd'hui** : projets plats (`features/projects/ProjectList*.svelte`, `modules/projects/`), conversion
de types déjà présente (`editor/ConvertTypesModal.svelte`), comparaison (`editor/compare/`).

### 10.1 Modèle : base + surcouche (overlay), pas une copie

Une variante **référence** son parent et ne stocke que **ses différences** sous forme d'opérations
structurées. Le schéma d'une variante = _schéma du parent à la version V_ + _surcouche_.

```
DeepDetect (base)  v12
 ├─ L'Oréal      suit v12   surcouche : +colonne users.brand_code, ~ orders.total → numeric(12,4), +table loreal_export
 │                          moteur : PostgreSQL
 └─ La Poste     suit v11   surcouche : −table audit_log, +colonne parcels.tracking_no
                            moteur : SQL Server  (types convertis)
```

Pourquoi pas une simple copie (fork) : une copie ne peut plus recevoir les évolutions de la base ; un
fusionnement de **texte** DBML est fragile. Des **opérations sur le modèle** (`addColumn`, `changeType`,
`dropTable`, `renameColumn`…) se rejouent et se fusionnent proprement.

- Prérequis technique : **identifiants stables** pour tables/colonnes (pour suivre un renommage dans la base
  et ne pas le prendre pour « suppression + ajout »). À vérifier dans `packages/shared/src/schema.ts`.
- Profondeur : **un seul niveau** au début (base → variantes). Multi-niveaux (base → secteur → client) plus tard.
- Plusieurs bases possibles ; une variante peut être **détachée** (devient projet autonome, copie résolue).

### 10.2 Où et visuel

**a) Liste des projets : arborescence repliable**

```
 Projets                                                    [ + Nouveau ▾ ]  ( ) Liste  (•) Arbre
 ▾ 🧬 DeepDetect            base · v12 · 3 variantes                   ⚠ 1 variante en retard
     ├ 🏢 L'Oréal           PostgreSQL · suit v12 · +3 −0 ~1             ● à jour
     ├ 🏢 La Poste          SQL Server · suit v11 · +1 −1 ~0             ▲ base mise à jour (v12)
     └ 🏢 Acme (test)       PostgreSQL · épinglé v9                      ○ épinglé
 ▸ 📦 Autre projet
```

« Nouveau ▾ » propose _Projet vide_, _Depuis une base de données_, **Variante d'un projet…**.

**b) Dans l'éditeur** : fil d'Ariane et trois états visuels dans le graphe.

```
 ◀ DeepDetect › L'Oréal     ( Résolu ◂ ) ( Surcouche seule )  ( Base )       moteur : PostgreSQL ▾
 ┌────────────────────┐   ┌────────────────────┐   ┌────────────────────┐
 │ users          ⬓   │   │ orders         ~   │   │ loreal_export   ＋ │
 │ … hérité (grisé)   │   │ total numeric(12,4)│   │ … ajouté           │
 └────────────────────┘   │   ↑ était (10,2)   │   └────────────────────┘
   ⬓ hérité  ~ modifié  ＋ ajouté  ✕ retiré (hachuré)   └────────────────────┘
```

- **Résolu** : le schéma complet vu par le client. **Surcouche seule** : uniquement ce que la variante change.
  **Base** : le parent, en lecture seule. Le panneau DBML affiche le résolu (lecture seule sur l'hérité).
- Éditer un élément hérité propose : « Modifier pour L'Oréal uniquement » (crée une opération de surcouche)
  ou « Modifier dans la base… » (si permission, impacte toutes les variantes — avec analyse d'impact).

**c) Mise à jour de la base : fusion guidée**

```
┌ DeepDetect v11 → v12  ·  variante La Poste ───────────────────────────────┐
│ 5 changements de la base       ✓ 4 s'appliquent sans conflit                │
│  + users.last_login           ✓ appliqué                                    │
│  ~ orders.status  varchar(20) → varchar(40)   ✓ appliqué                    │
│  − parcels.legacy_ref         ⚠ CONFLIT : La Poste a modifié cette colonne  │
│        ( ) Garder la version La Poste  ( ) Prendre la base  ( ) Éditer…      │
│                              [ Rester sur v11 ]  [ Appliquer la mise à jour ]│
└──────────────────────────────────────────────────────────────────────────────┘
```

Chaque variante choisit : **suivre la dernière version** (alerte + fusion), **épingler** une version, ou
**détacher**.

**d) Matrice des variantes** (vue d'ensemble, utile pour l'équipe produit)

```
 Table / colonne        Base   L'Oréal   La Poste   Acme
 users                   ●       ●         ●         ●
 audit_log               ●       ●         ✕         ●
 orders.total          (10,2)  (12,4)~   (10,2)    (10,2)
 loreal_export           —       ＋         —         —
 Moteur                  PG      PG        MSSQL     PG
```

### 10.3 Changement de moteur par variante

- Choix du moteur cible dans la variante ; **table de correspondance de types** par moteur
  (réutilise/étend `ConvertTypesModal` et `dbml-engine`) : `jsonb` → `nvarchar(max)` + contrainte JSON, etc.
- Avertissements de **perte de fidélité** (type sans équivalent, séquences vs identity, sensibilité à la casse).
- Surcharge manuelle d'un type pour une variante (une opération de surcouche comme une autre).
- Le déploiement génère le DDL **du moteur de la variante** (les pilotes existent déjà pour 5 moteurs).

### 10.4 Déploiement, seeds, verrous, rôles

- Chaque variante a **ses propres connexions et déploiements** (historique distinct), ses seeds (§5)
  qui surchargent ceux de la base (ex. jeu de données propre au client).
- **Verrous (§3) hérités** : une table verrouillée dans la base l'est dans toutes les variantes (la
  surcouche ne peut pas la modifier) ; une variante peut verrouiller en plus.
- **Rôles** : droits par projet. Une équipe peut gérer « L'Oréal » sans voir « La Poste » ni modifier la
  base ; le propriétaire de la base voit l'état de toutes les variantes.
- **Surveillance (§9)** : par variante, avec sa propre empreinte de référence.

### 10.5 Données et API

- `projects` : `parent_id`, `base_version`, `follow_mode` (`latest | pinned | detached`), `target_engine`.
- `project_versions(project_id, version, created_at, snapshot_json)` : instantanés **de la base** (version
  = chaque « publication » explicite, pas chaque frappe).
- `variant_ops(project_id, seq, op, target_id, payload_json)` : journal d'opérations de la surcouche.
- Routes `…/variants`, `…/variants/:id/resolve`, `…/variants/:id/merge`; exposé dans `/api/v1` + `openapi.ts`.
- **Publier une version de la base** : action explicite (« Publier v13 », notes de version) ; les variantes
  « suivre la dernière » reçoivent une alerte (§9.4) et une fusion à valider.

**Questions ouvertes** : un seul niveau d'héritage au départ ? une variante peut-elle **ajouter un
seed** sur une table verrouillée de la base ? versionnement : automatique ou « publication » explicite
(recommandé) ? comment représenter la surcouche en DBML pour l'export (résolu seul, ou base + patch) ?

---

## 11. Sauvegardes, rollback de déploiement et de données

**Besoin** : gérer les sauvegardes d'une base depuis Athanor, et pouvoir **revenir en arrière** sur un
déploiement (structure) ou sur des données.

### 11.1 Sauvegardes — où et visuel

Nouvel onglet **Sauvegardes** dans l'espace de travail (§0) et dans la console de connexion :

```
Sauvegardes · postgres-prod                  [ ▶ Sauvegarder maintenant ]   [ ⚙ Planification ]
 Espace utilisé 3,4 Go · Dernière : aujourd'hui 02:00 (OK)    Prochaine : demain 02:00
─────────────────────────────────────────────────────────────────────────────────────────
 Date            Type          Déclencheur             Taille   Vérifiée   Rétention
 02-10 02:00     Complète      Planifiée               1,2 Go   ✓ restauré  7 j
 01-10 14:31     Avant déploiement  Déploiement #84    0,9 Go   —          30 j  [📌 épinglée]
 01-10 02:00     Complète      Planifiée               1,2 Go   ✓           7 j
 28-09 11:02     Table users   Manuelle (alice)        14 Mo    —          —
                                              [Restaurer ▾] [Télécharger] [Supprimer]
```

**Planification**

```
 Fréquence      [ Tous les jours ▾ ] à [ 02:00 ]       Portée  (•) Base entière ( ) Tables : [ + ]
 Rétention      Garder  [7] quotidiennes  [4] hebdomadaires  [6] mensuelles
 Destination    [ Stockage local ▾ ]   (Local · S3 compatible · SFTP)     Chiffrement  [✓] AES-256
 Avant déploiement  [✓] Sauvegarde automatique (PROD)   Vérification  [✓] test de restauration hebdo
```

### 11.2 Comment (par niveau de capacité, comme §8.3)

| Niveau                       | Principe                                                                             | Prérequis                           | Moteurs                       |
| ---------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------- | ----------------------------- |
| **Logique** (V1)             | Athanor exporte structure + données **via le pilote** (SQL / CSV par table), en flux | droits de lecture                   | tous, y compris SQLite        |
| **Natif** (V2)               | Lance l'outil du moteur (`pg_dump`, `mysqldump`, `BACKUP DATABASE`, Data Pump)       | binaire accessible ou accès serveur | PG, MySQL, SQL Server, Oracle |
| **Point dans le temps** (V3) | Archive des journaux (WAL, binlog…)                                                  | configuré par le DBA                | PG, MySQL, SQL Server, Oracle |

- V1 suffit pour les bases petites/moyennes ; Athanor **affiche une limite de taille** et propose le
  natif au-delà. Les sauvegardes sont **chiffrées** (clé dérivée du secret, rotation compatible avec §
  rotation existante), stockées hors de la base d'Athanor, avec somme de contrôle.
- Exécution **en tâche de fond** avec suivi de progression, annulation, et respect de `connectionBudget`.
- **Vérification** : restauration périodique dans une base temporaire + comptage de lignes, résultat affiché.

### 11.3 Restauration

```
┌ Restaurer — sauvegarde du 02-10 02:00 ─────────────────────────────────────────┐
│ Quoi        ( ) Toute la base   (•) Tables : [ users ✕ ] [ orders ✕ ] [ + ]     │
│ Où          (•) Même base (écrase)   ( ) Autre connexion : [ postgres-dev ▾ ]    │
│             ( ) Nouvelle base : [ boutique_restore_0210 ]                        │
│ Aperçu      users : 12 480 lignes → remplacées (actuellement 12 501)             │
│             ⚠ 21 lignes créées depuis la sauvegarde seront perdues               │
│ Avant       [✓] Faire une sauvegarde de l'état actuel d'abord                    │
│ Confirmer   tapez « postgres-prod » : [____________]       [Annuler] [Restaurer]  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Protections : confirmation par saisie du nom, sauvegarde de sécurité automatique, **blocage si la
connexion est en lecture seule** ou si la politique §4 l'interdit, respect des **verrous de tables** (§3),
audit complet (§8), droit dédié `backup.restore` (admin par défaut).

### 11.4 Rollback de déploiement (structure)

Dans l'historique de déploiements (`deployment_history`, `DeploymentModal.svelte`) :

```
 Déploiements · postgres-prod
 #84  01-10 14:31  alice   +2 tables, 1 colonne        ✓ réussi    [ Détail ]  [ ↩ Revenir avant ce déploiement ]
 #83  28-09 09:12  bob     ~ orders.total              ✓ réussi
```

```
┌ Revenir avant le déploiement #84 ───────────────────────────────────────────────┐
│ Script inverse généré :  DROP TABLE refunds; DROP TABLE refund_items;            │
│                          ALTER TABLE orders DROP COLUMN note;                    │
│ ⚠ Perte de données :  refunds (1 204 lignes), orders.note (3 980 valeurs)        │
│    ( ) Accepter la perte   (•) D'abord sauvegarder ces données  ( ) Annuler       │
│ Le schéma du projet sera aussi ramené à la version d'avant (nouvelle révision).   │
│                                             [Annuler]  [Voir le SQL]  [Revenir]   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- Le script inverse est calculé à partir de **deux empreintes** (avant/après, §9.5), pas deviné.
- Cas non réversibles signalés clairement (colonne supprimée sans sauvegarde, type réduit avec perte).
- Pour les variantes (§10), le retour arrière concerne la variante ; si la base a été touchée, l'analyse
  d'impact montre les autres variantes concernées.

### 11.5 Rollback de données

- **Table par table** depuis une sauvegarde (§11.3) ; aperçu des lignes qui changeraient (diff de données).
- **Restaurer une ligne ou une plage** (option V2) : « récupérer les lignes supprimées entre X et Y ».
- Pour les tables suivies, journal des modifications via le niveau 2 (§8.3) pour annuler une requête
  d'écriture précise (UPDATE/DELETE exécuté depuis Athanor : on **mémorise les lignes avant** quand la
  portée est petite, seuil configurable), proposé comme « Annuler cette requête ».

### 11.6 Chronologie unifiée

Une seule frise où déploiements, sauvegardes, restaurations et dérives externes (§9) apparaissent, avec
un point de retour possible à chaque étape :

```
 ───●────────●───────▲──────●────────●──────────────▶ temps
  02:00     14:31   14:58   02:00    ↩ restauré
  Sauv.     Déploi. Dérive  Sauv.    users (alice)
            #84     ext.
```

### 11.7 Données et API

- Tables : `backups(id, connection_id, kind, trigger, started_at, finished_at, size, checksum, storage_ref,
encrypted, verified_at, retention_until, pinned)`, `backup_schedules`, `restore_jobs`, `storage_targets`.
- Module serveur `modules/backups/` (collecteurs par moteur dans `drivers/`, tâches planifiées avec le
  mécanisme de santé existant), routes `…/backups`, `…/restore`, `…/deployments/:id/rollback`.
- Config d'instance : dossier de stockage, quotas, `ATHANORDB_BACKUP_*`.

**Questions ouvertes** : taille maximale du mode logique ? où stocker (volume local, S3) et qui paie
l'espace ? rétention légale (RGPD : durée max d'une sauvegarde contenant des données personnelles) ?
la restauration d'une base de production exige-t-elle une double approbation ?

---

## 12. Environnements et promotion (validé)

**Décision** : un projet se déploie à travers une **chaîne d'environnements configurable par l'admin**
(nom, nombre et ordre des étapes libres). Exemples : `DEV › Staging › Prod` ou
`DEV › PreProd › Non-Prod › Prod`.

### 12.1 Configuration (Admin → Environnements)

```
Chaîne d'environnements (instance)                              [ Modèle : Standard ▾ ]
  1 ● DEV        🟢  libre            promotion par : tous les éditeurs
  2 ● PreProd    🟡  revue requise    promotion par : admins du projet
  3 ● Non-Prod   🟡  revue requise    promotion par : admins du projet
  4 ● Prod       🔴  protégé          promotion par : admins + approbation (§12.4)
                                                    [ + Ajouter une étape ]  glisser pour réordonner
 Chaque étape : nom · couleur · niveau de protection · fenêtre de déploiement · sauvegarde auto avant (§11)
```

- Chaîne **par défaut d'instance**, **surchargeable par projet** (ex. un projet sans PreProd).
- Contraintes : au moins 1 étape ; une seule marquée « production » (déclenche les protections
  renforcées : sauvegarde auto, confirmation par saisie du nom, couleur rouge partout).
- Étapes et protections stockées en base (`environments`, `project_environments`), pas codées en dur ;
  l'actuel champ `environment` des connexions (`db_connections.environment`) devient une **référence** à une étape.

### 12.2 Promotion

Dans l'espace de travail (§0), un onglet **Pipeline** :

```
 Pipeline · Boutique-prod
   DEV            PreProd           Non-Prod          Prod
   v14 ●──────▶   v13 ●──────▶     v13 ●──────▶      v12 ●
   postgres-dev   postgres-pre      postgres-np       postgres-prod
   à jour         ▲ 1 en attente    ▲ en attente      ⚠ retard : 2 versions
                  [ Promouvoir v14 ▸ ]
```

- **Promouvoir** = déployer _la même version du schéma_ vers l'étape suivante, avec le diff réel affiché
  (introspection de la cible, pas seulement « ce qui a changé dans le projet »).
- Les étapes ne se sautent pas, sauf droit explicite (« correctif urgent », audité).
- Chaque promotion crée une entrée de déploiement (historique §11.4) et peut déclencher une alerte.

### 12.3 Comparaison entre environnements

```
 Comparer   [ PreProd ▾ ]  ⇄  [ Prod ▾ ]                          7 différences
  + users.last_login        présent en PreProd, absent en Prod       [ Promouvoir ]
  ~ orders.total            numeric(10,2) ↔ numeric(12,4)
  ✕ tmp_import              absent en PreProd, présent en Prod  ⚠ hors schéma
```

Réutilise `editor/compare/` et `introspectSchema`. Détecte aussi les écarts **hors Athanor** (lien avec §9).

### 12.4 Garde-fous par étape

- Fenêtres de déploiement et gel (idée 2 de la liste) **par étape**, sauvegarde automatique avant
  déploiement, approbation requise (revue avant déploiement) configurables **par étape**.
- Chaque étape peut imposer : « la version doit d'abord être passée avec succès à l'étape précédente ».

### 12.5 Variables par environnement

Valeurs propres à chaque étape pour un même schéma : nom de schéma, préfixe de table, tablespace, etc.

```
 Variables                 DEV        PreProd     Prod
 {{schema}}                dev        preprod     public
 {{table_prefix}}          dev_       pp_         —
 {{tablespace}}            —          —           ts_fast
```

Substituées au moment du DDL ; contrôle de cohérence (variable utilisée mais non définie → blocage du déploiement).

### 12.6 Relation avec les variantes (§10)

Deux axes **orthogonaux** : une **variante** = _pour qui_ (L'Oréal, La Poste) ; un **environnement** =
_où dans le cycle de vie_ (DEV…Prod). Chaque variante a sa propre chaîne de connexions (une par étape) ; la
matrice de variantes (§10.2d) gagne une colonne « étape courante ».

**Questions ouvertes** : la chaîne est-elle par instance, par équipe ou par projet (proposition : défaut
d'instance + surcharge par projet) ? les variables supportent-elles des secrets (chiffrés) ?

---

## 13. Changements destructifs et retour arrière (validé)

Valide les idées 4, 5 et 6 de la liste : les points 4 et 6 sont détaillés au §11 (script inverse, bouton
« Revenir avant ce déploiement », sauvegarde automatique avant déploiement). Reste à spécifier le point 5.

### 13.1 Détection des changements destructifs

Calculée **au plan de déploiement** (dry-run, `DeploymentModal.svelte`), à partir du diff et, quand
c'est possible, d'une **requête d'échantillonnage** sur la cible (comptes, valeurs maximales).

| Changement                           | Détection                                     | Gravité                           |
| ------------------------------------ | --------------------------------------------- | --------------------------------- |
| `DROP TABLE` / `DROP COLUMN`         | suppression de données                        | 🔴 bloquant par défaut en Prod    |
| Réduction de longueur / de précision | valeur max actuelle > nouvelle limite         | 🔴 si dépassement avéré, 🟡 sinon |
| Ajout de `NOT NULL`                  | `COUNT(*)` des NULL > 0 et pas de défaut      | 🔴                                |
| Ajout de `UNIQUE` / clé primaire     | doublons existants                            | 🔴                                |
| Changement de type incompatible      | conversion impossible sur des valeurs réelles | 🔴 / 🟡                           |
| Ajout de clé étrangère               | lignes orphelines                             | 🔴                                |
| Renommage perçu comme drop+add       | identifiants stables (§10.1)                  | 🟡 « est-ce un renommage ? »      |

Visuel dans le plan de déploiement :

```
 Plan de déploiement #85 → postgres-prod                       2 changements à risque
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ 🔴 DROP COLUMN orders.note        3 980 valeurs non vides seront perdues       │
 │      ( ) Accepter la perte  (•) Sauvegarder la colonne avant  ( ) Retirer ce changement │
 │ 🟡 ALTER users.email varchar(320)→(255)   max actuel : 187 → OK                │
 └──────────────────────────────────────────────────────────────────────────────┘
                              [Annuler]   [Déployer (1 risque accepté)]
```

- Les risques **acceptés** sont enregistrés dans l'historique du déploiement (qui, quand, pourquoi).
- Niveau de blocage par étape d'environnement (§12.4) : en Prod, un 🔴 non traité interdit le déploiement.
- L'échantillonnage respecte `connectionBudget`, est borné en durée et ne lit **aucune donnée sensible** :
  seulement des agrégats (comptes, min/max).

### 13.2 Liens

- « Sauvegarder la colonne avant » alimente la restauration fine du §11.5.
- La politique de structure (§4) et les verrous (§3) s'appliquent **avant** cette analyse.

---

## 14. Génération de données de test (validé), avec point d'extension IA

**Décision** : proposer la **génération de données** (idée 11). Prévoir dès maintenant un **point d'extension**
pour brancher plus tard un fournisseur d'IA, **optionnel et désactivé par défaut**.

### 14.1 Où et visuel

Dans l'inspecteur d'une table (à côté des données initiales du §5) et dans l'explorateur :

```
users ─ Données initiales │ Générer ◂
 Volume    [ 500 ] lignes          Reproductible [✓] graine : [ 42 ]
 Colonnes
   id          auto-incrément            ✓
   email       Email réaliste            ▾  (prénom.nom@exemple.fr)
   first_name  Prénom (fr)               ▾
   role        Valeur parmi : admin, user  ▾  poids 5 % / 95 %
   created_at  Date entre [ 2024-01-01 ] et [ aujourd'hui ]
   company_id  ↗ clé étrangère → companies  (tirage dans les lignes existantes)
 Aperçu (5 lignes)                                         [ Régénérer ]  [ Utiliser comme seed ]  [ Insérer dans postgres-dev ]
```

### 14.2 Fonctionnement

- **Générateurs par type et par nom de colonne** : détection heuristique (`email`, `phone`, `iban`, `city`…)
  - choix manuel dans un **catalogue** (noms, adresses, dates, nombres, énumérations pondérées, UUID,
    texte, expressions régulières, valeur fixe, copie d'une autre colonne).
- **Intégrité** : respect de `NOT NULL`, `UNIQUE`, types, longueurs, **clés étrangères** (ordre de
  génération suivant le graphe de dépendances, comme les seeds §5), contraintes `CHECK` simples.
- **Reproductible** (graine) et **par locale** (fr, en…).
- **Destinations** : (a) enregistrer comme **seed** de la table (§5), (b) insérer directement dans une
  connexion **non-production** (jamais en Prod sans droit explicite), (c) exporter en CSV.
- Volumes importants : génération par lots, flux, progression et annulation.

### 14.3 Point d'extension IA (optionnel, futur)

Interface côté serveur, **sans dépendre d'un fournisseur** :

```
interface DataGeneratorProvider {
  id: string;                         // "builtin" | "ai:<fournisseur>"
  generate(request: {
    table: TableSchema;               // structure + contraintes (aucune donnée réelle)
    rows: number;
    locale: string;
    hints?: string;                   // consigne libre de l'utilisateur
    seed?: number;
  }): AsyncIterable<Row[]>;
}
```

- Le générateur intégré (`builtin`) est le seul actif au départ ; un fournisseur IA s'enregistre sans
  modifier le reste (même esprit que `drivers/index.ts` et les plugins).
- **Garde-fous prévus dès la conception** : l'IA ne reçoit **que la structure** (jamais de données de la base
  réelle) ; activation par l'admin, par instance ou par projet ; journalisation des demandes (§8) ; quotas ;
  clé du fournisseur chiffrée comme les autres secrets ; résultat **validé par les mêmes contraintes**
  que le générateur intégré avant insertion (l'IA propose, le moteur vérifie).
- Usages IA envisagés : « 200 clients français réalistes d'une PME du transport », jeux de données
  cohérents entre tables liées, cas limites volontaires (accents, valeurs très longues).

### 14.4 Données et API

- `generator_configs(project_id, table_name, config_json, seed, updated_at)` (règles par colonne), liées au
  projet et versionnées avec lui ; héritées/surchargées par variante (§10).
- Routes `…/tables/:name/generate/preview`, `…/generate/run`; exposé dans `/api/v1` + `openapi.ts`.

**Questions ouvertes** : catalogue de générateurs : bibliothèque existante (type Faker) ou interne ?
limites de volume en V1 ? l'IA peut-elle un jour voir des _échantillons anonymisés_ (idée 10) pour
mieux imiter la réalité ?

---

## 15. Qualité du schéma : linter et dictionnaire de données (validé : points 16, 19)

### 15.1 Linter de schéma configurable (16)

**Où** : analyse en continu dans l'éditeur (`dbml-engine` a déjà `validateProject` et `dbml/lint.ts` côté
éditeur : on étend ces mécanismes) ; réglages dans Paramètres du projet → **Règles**.

```
Règles du schéma                         Profil : [ Strict ▾ ]   (Souple · Standard · Strict · Perso)
 Règle                                         Gravité        Portée
 Chaque table a une clé primaire               ● Erreur       tout le projet
 Clés étrangères indexées                      ● Avertissement
 Noms en snake_case                            ● Avertissement    pattern : ^[a-z][a-z0-9_]*$
 Pas de varchar sans longueur                  ○ Info
 Colonnes created_at / updated_at présentes    ○ Désactivée       [ tables : *_log exclues ]
 Pas de type FLOAT pour de l'argent            ● Erreur
 Table sans description                        ○ Info
                                               [ Bloquer le déploiement si erreur  ✓ ]
```

- **Dans l'éditeur** : soulignement dans le DBML (comme `errorRuler.ts`) + pastille sur le nœud du graphe ;
  panneau **Problèmes** listant les violations, avec **correction rapide** quand elle est sûre
  (« Ajouter une clé primaire `id` », « Créer l'index sur la clé étrangère »).
- Règles **intégrées** + règles personnalisées simples (pattern de nom, type interdit, colonne obligatoire).
- Exceptions ciblées par commentaire/annotation (`// lint-ignore: pk-required`) et par liste.
- S'applique aussi à l'API (`/api/v1/projects/:id/lint`) pour la CI (idée 25, à arbitrer).
- Variantes (§10) : règles héritées de la base, durcissables par variante.

### 15.2 Dictionnaire de données (19)

**Où** : section **Documentation** de l'inspecteur de table/colonne et page dédiée **Dictionnaire**.

```
Dictionnaire de données · Boutique-prod                 🔎 Rechercher     [ Exporter ▾ HTML · PDF · CSV · Markdown ]
 Table       Propriétaire   Classification   Description
 users       Équipe Compte  🔴 Personnelle   Comptes clients. Une ligne par personne.
   email     —              🔴 Identifiant   Adresse de connexion, unique.
   birthday  —              🔴 Sensible      Optionnelle.
 orders      Équipe Ventes  🟡 Interne       Commandes validées uniquement.
 ⚠ 12 tables sans description · 4 sans propriétaire                 [ Compléter avec l'IA (optionnel) ]
```

- Champs : description, propriétaire (utilisateur ou équipe), **classification** (publique, interne,
  personnelle, sensible), étiquettes libres. Stockés **dans le schéma** (notes DBML, `Note:` déjà supportées)
  pour suivre l'historique du projet et les variantes.
- **Export** HTML autonome (site statique avec diagramme + dictionnaire, partageable), PDF, CSV, Markdown.
- Indicateur de complétude et règle de lint associée (« table sans description »).
- Prépare le terrain pour la classification RGPD et le masquage (idées 21-22, à arbitrer).

---

## 16. Performance et optimisation (validé : points 15, 17, 18 + conseiller de requêtes activable)

Nouvel onglet **Performance** de l'espace de travail (§0) et de la console de connexion. Il regroupe
quatre outils, du plus simple au plus ambitieux.

### 16.1 Plan d'exécution visuel (15)

Dans le panneau SQL (§6) et la console : bouton **Expliquer** (`EXPLAIN`, sans exécuter) et **Analyser**
(`EXPLAIN ANALYZE`, **lecture seule uniquement**, confirmation requise car la requête s'exécute vraiment).

```
 EXPLAIN  SELECT … FROM orders o JOIN users u ON u.id = o.user_id WHERE o.status = 'paid'
 ┌───────────────┐   ┌────────────────────────┐   ┌──────────────────────────┐
 │ Hash Join     │◀──│ Seq Scan  orders  🔴   │   │ Index Scan users_pkey ✓  │
 │ 8,2 ms        │   │ 1,2 M lignes lues      │   │ 1 ligne                  │
 │               │   │ filtre status='paid'   │   └──────────────────────────┘
 └───────────────┘   │ 💡 index (status) évite │
                     │    ce parcours complet  │
                     └────────────────────────┘
 Coût total 18 420 · temps 412 ms · lignes estimées 1,1 M / réelles 98 000  ⚠ estimation fausse
```

- Arbre de nœuds avec **couleur selon le coût**, lignes lues vs estimées, tri/jointure/boucle repérés,
  mise en évidence du nœud le plus lent, texte brut disponible. Normalisation par moteur
  (PostgreSQL/MySQL/SQL Server/Oracle ; SQLite `EXPLAIN QUERY PLAN` simplifié).

### 16.2 Index : suggestions et nettoyage (17, 18)

Liste classée par **impact estimé**, issue de l'analyse des requêtes (§16.4) et des statistiques de la base :

```
 Index                                                                          Action
 💡 Créer  orders(status, created_at)    sert 1 840 requêtes/jour · gain estimé −92 %   [ Proposer dans le schéma ]
 💡 Créer  order_items(order_id)         clé étrangère non indexée · jointures lentes   [ Proposer dans le schéma ]
 ♻ Doublon idx_users_email ⊂ uq_users_email    redondant                                [ Proposer la suppression ]
 💤 Inutilisé idx_orders_legacy (0 lecture depuis 94 j, 310 Mo)                          [ Proposer la suppression ]
```

- **Colonnes/tables inutilisées** (18) : statistiques d'usage du moteur (`pg_stat_user_tables/indexes`,
  `sys.dm_db_index_usage_stats`, `performance_schema`, vues Oracle) ; seuil de durée réglable ; avertissement
  quand les statistiques ont été **réinitialisées récemment** (fausserait la conclusion).
- **Jamais d'application directe sur la base** : une suggestion devient une **modification du schéma** (voir
  §16.5) puis passe par la chaîne normale (revue, déploiement, politique §4).

### 16.3 Tableau « ce qui coûte » (base de l'analyse)

```
 Requêtes les plus coûteuses (24 h)         Appels   Moyenne   Total     Plan
 SELECT … FROM orders WHERE status = ?       1 840   412 ms    12,6 min  Seq Scan 🔴   [ Analyser ▸ ]
 SELECT … FROM users WHERE lower(email) = ?  9 210    38 ms     5,8 min  Index non utilisé ⚠
```

### 16.4 Conseiller de requêtes (activable, désactivé par défaut)

**Besoin** : détecter les requêtes SQL exécutées sur une base et, à partir d'elles, proposer (a) des
**réécritures de requêtes** et (b) des **modifications de la base** qui les accélèrent.

**Activation** (par connexion, admin global ; hors Prod par défaut jusqu'à confirmation explicite) :

```
Conseiller de requêtes                                                           [ ○ Désactivé ]
 Sources  [✓] Statistiques du moteur (pg_stat_statements, Query Store…)   état : ✓ disponible
          [✓] Requêtes exécutées depuis Athanor (console / éditeur)
          [ ] Journal de requêtes lentes du moteur (nécessite configuration DBA)
 Échantillonnage  toutes les [ 15 min ▾ ]    Rétention [ 14 j ▾ ]    Seuil « lente » [ 200 ms ]
 Confidentialité  [✓] Remplacer les valeurs littérales par ?   [✓] Ne jamais stocker les paramètres
 EXPLAIN ANALYZE  ( ) Jamais  (•) Sur demande, lecture seule      Budget max : [ 2 % ] de charge
```

**Collecte** (réutilise le niveau 1 du §8.3, aucune installation d'agent) :

| Moteur        | Source                                                   |
| ------------- | -------------------------------------------------------- |
| PostgreSQL    | `pg_stat_statements` (extension à activer par le DBA)    |
| MySQL/MariaDB | `performance_schema.events_statements_summary_by_digest` |
| SQL Server    | Query Store / `sys.dm_exec_query_stats`                  |
| Oracle        | `V$SQL` / `V$SQLSTATS`                                   |
| SQLite        | seulement les requêtes passées par Athanor               |

Chaque requête est **normalisée** (valeurs → `?`), empreinte, puis agrégée : appels, temps total/moyen,
lignes, plan. Aucune valeur de paramètre n'est conservée.

**Analyse en trois couches**

1. **Réécriture de la requête** (analyse syntaxique par dialecte) :
   `SELECT *` inutile · fonction sur colonne indexée dans le `WHERE` (`lower(email)`) · `LIKE '%x'` ·
   conversion implicite de type · `NOT IN` avec NULL · sous-requête corrélée → jointure ·
   pagination `OFFSET` profonde → pagination par clé · `DISTINCT`/`ORDER BY` superflus · **N+1**
   (même requête répétée en rafale) · jointure sans condition.
2. **À partir du plan** : parcours complet sur grosse table, tri sur disque, estimations très fausses,
   jointure à boucles imbriquées coûteuse.
3. **Modifications de la base** : index manquant (ordre des colonnes, couvrant, partiel) · index redondant
   ou inutilisé · type de colonne différent des deux côtés d'une jointure · statistiques périmées
   (`ANALYZE`) · table énorme à partitionner · vue matérialisée / dénormalisation pour une agrégation
   répétée · colonne `text` volumineuse lue partout (la sortir).

**Écran de résultat**

```
Conseiller · postgres-prod                      Analysé : 1 204 requêtes · 9 recommandations
 #1  Impact élevé · 12,6 min/jour gagnables
     SELECT * FROM orders WHERE status = ?
     ┌─ Requête ──────────────────────────┐  ┌─ Proposée ──────────────────────────┐
     │ SELECT * FROM orders               │  │ SELECT id, total, created_at        │
     │ WHERE status = ?                   │  │ FROM orders WHERE status = ?        │
     └────────────────────────────────────┘  └─────────────────────────────────────┘
     Cause : parcours complet de 1,2 M lignes  ·  Confiance : 🟢 élevée (plan observé)
     Actions :  [ Copier la requête ]   [ Voir le plan ]   [ Proposer l'index dans le schéma ▸ ]
 #2  Impact moyen · lower(email) = ? empêche l'index
     → Proposer : index fonctionnel users(lower(email))   ou   colonne `email_lower` générée
```

- **Estimation d'impact** : gain basé sur les temps mesurés ; pour un index, validation par index
  _hypothétique_ quand le moteur le permet (`hypopg` PostgreSQL), sinon libellé « estimation » avec niveau de
  confiance explicite. On ne promet pas ce qu'on ne peut pas mesurer.
- **Faux positifs** : bouton « ignorer cette recommandation » (mémorisé), regroupement des requêtes
  équivalentes, aucune recommandation sur trop peu d'échantillons.

### 16.5 Appliquer une recommandation

- **Sur la requête** : si la requête est **dans Athanor** (historique/console, ou requêtes enregistrées si
  l'idée 13 est retenue), « Remplacer par la version proposée » ; si elle vient d'une application externe,
  « Copier » avec le diff (Athanor n'a pas accès au code de l'application).
- **Sur la base** : jamais un `CREATE INDEX` direct. **« Proposer dans le schéma »** ouvre le projet, ajoute
  l'index/la modification en **changement en attente** (visuel « ＋ proposé » comme les variantes §10), puis suit
  le circuit normal : revue, plan de déploiement avec risques (§13), promotion (§12), sauvegarde. Le DDL généré
  est adapté au moteur et au risque (`CREATE INDEX CONCURRENTLY` sur PostgreSQL, `ONLINE = ON` sur SQL
  Server, estimation de la taille et du temps).
- **Variantes** (§10) : une recommandation issue de la base de prod d'un client s'applique à _sa_ variante, ou
  est proposée à la base commune si elle vaut pour tous.

### 16.6 Garde-fous

- **Charge** : lecture des vues statistiques uniquement, budget et intervalle bornés, `connectionBudget`
  respecté ; `EXPLAIN ANALYZE` seulement sur demande, en lecture seule, avec délai maximal.
- **Confidentialité** : les requêtes peuvent contenir des données personnelles ; normalisation à la collecte,
  rétention courte, accès **admin uniquement**, tout est audité (§8) ; les statistiques ne quittent pas Athanor.
- **IA optionnelle** (même principe que §14.3) : interface `QueryAdvisorProvider` ; si activée, elle ne reçoit que
  la requête **normalisée** + la structure des tables concernées + le plan, jamais de valeurs ni de données. Ses
  propositions sont **re-validées** (analyse syntaxique, équivalence de résultat sur échantillon quand c'est
  possible, `EXPLAIN` du résultat) avant d'être affichées avec un niveau de confiance.
- Désactivation en un clic = arrêt de la collecte et **purge** des données collectées.

**Questions ouvertes** : bibliothèque d'analyse SQL multi-dialectes (ex. `node-sql-parser`, ou analyseur maison
limité à `SELECT`) ? quelle durée de rétention par défaut ? afficher les recommandations aux non-admins
(sans le texte des requêtes) ? permettre la comparaison avant/après un déploiement d'index (mesure du gain réel) ?

---

## 17. Tableau de santé des connexions (validé : point 34)

**Où** : onglet **Santé** de l'espace de travail et vignette sur la liste des connexions (Admin → Connexions,
qui montre déjà l'état et la latence grâce à `ATHANORDB_CONNECTION_HEALTH_INTERVAL_MINUTES`).

```
Santé · postgres-prod        PostgreSQL 16.3 · en ligne 41 j        Période : [ 24 h ▾ ]   ↻ il y a 2 min
 ┌ Latence ─────────────┐ ┌ Sessions ─────────┐ ┌ Taille ──────────────┐ ┌ Requêtes lentes ───┐
 │ 14 ms     ▁▂▁▁▃▂▁   │ │ 38 / 100   ▂▃▅▃▂  │ │ 41,2 Go  +0,8 Go/sem │ │ 12 (> 200 ms)      │
 └──────────────────────┘ └───────────────────┘ └──────────────────────┘ └────────────────────┘
 Plus grosses tables            Taille   Croissance 30 j        Verrous en cours
  orders                        18,4 Go  +6 %                    ⚠ 1 transaction bloque 3 autres (alice, 4 min) [ Voir ▸ ]
  order_items                   9,1 Go   +4 %
```

- Métriques par niveau de capacité (§8.3) : **niveau 0** latence/version/disponibilité/taille ; **niveau 1**
  sessions, verrous bloquants, requêtes lentes, réplication si disponible.
- Séries courtes conservées côté Athanor (agrégées, rétention réglable), échantillonnage léger.
- Liens directs : session bloquante → onglet Sessions (§console) avec **kill** (existant) ; requête lente →
  Conseiller (§16.4) ; croissance → historique de taille (idée 36, à arbitrer).
- Seuils d'alerte (idée 35) : hors périmètre validé pour l'instant, mais le modèle d'alerte du §9.4 sert déjà.

### 17.1 Trafic : nombre de requêtes et volume de données (admin, « si possible »)

**Besoin** : l'admin voit, par connexion, **combien de requêtes** arrivent et **quel volume de données**
est reçu (upload : client → base) et envoyé (download : base → client).

**Visuel** (dans l'onglet Santé, bloc « Trafic ») :

```
Trafic · postgres-prod                           Période : [ 24 h ▾ ]   Source : [ Toute la base ▾ ]  (Toute la base · Via Athanor)
 ┌ Requêtes ─────────────────────────┐ ┌ Données ──────────────────────────────┐
 │ 1,24 M           pic 310/s à 11:42│ │ ↓ 18,4 Go envoyées   ↑ 2,1 Go reçues  │
 │ ▁▂▃▅▇▆▄▃▂▂▃▄▅▆▅▃▂▁                │ │ ▁▂▂▃▆▇▅▃▂▂▃▃▄▅▃▂▂▁  (↓ plein / ↑ trait)│
 └───────────────────────────────────┘ └───────────────────────────────────────┘
 Répartition     SELECT 86 %   INSERT 9 %   UPDATE 4 %   DELETE 0,6 %   DDL 0,0 %   autre 0,4 %
 Par utilisateur / application                 Requêtes     ↓ Envoyé     ↑ Reçu      Exactitude
  app_shop (api-01…03)                          1,05 M      15,9 Go      1,4 Go       ● exacte
  app_etl  (10.0.4.12)                          0,11 M       2,1 Go      0,6 Go       ● exacte
  athanor_admin (via Athanor)                   0,00 M       0,4 Go      0,0 Go       ● mesurée par Athanor
 ⓘ PostgreSQL n'expose pas les octets réseau : volume estimé d'après les lignes et blocs lus (± 20 %)
```

- Pastille d'**exactitude** par métrique : _exacte_ (compteur du moteur), _estimée_ (déduite, avec marge),
  _indisponible_ (le moteur ne l'expose pas), _mesurée par Athanor_ (trafic qui passe par Athanor).
  On **n'affiche jamais une estimation comme une mesure**.
- Filtres : connexion, utilisateur base, application, hôte client, base/schéma, période ; export CSV.
- Lien avec le journal (§8) : clic sur un pic → liste des requêtes/sessions de ce créneau.

**Ce que chaque moteur permet réellement** (niveau 1 du §8.3, lecture de vues statistiques, aucun agent) :

| Moteur              | Nombre de requêtes                                            | Volume de données                                                                                 | Ventilation                                         |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **MySQL / MariaDB** | `Questions`, `Com_select/insert/update/delete`                | ✅ exact : `Bytes_sent` / `Bytes_received`                                                        | par compte (`performance_schema.status_by_account`) |
| **Oracle**          | `user calls`, `execute count` (`V$SYSSTAT`)                   | ✅ exact : `bytes sent via SQL*Net to client` / `bytes received via SQL*Net from client`          | par session (`V$SESSTAT`)                           |
| **SQL Server**      | `Batch Requests/sec` (compteurs de performance)               | ⚠ partiel : lectures/écritures par connexion (`sys.dm_exec_connections`), paquets réseau          | par session / login                                 |
| **PostgreSQL**      | `xact_commit + xact_rollback`, `calls` (`pg_stat_statements`) | ⚠ estimé : lignes retournées (`tup_returned/fetched`), blocs lus ; **pas d'octets réseau natifs** | par base et par rôle (`pg_stat_statements`)         |
| **SQLite**          | seulement via Athanor                                         | seulement via Athanor                                                                             | —                                                   |

**Trafic passant par Athanor** (toujours exact) : Athanor compte lui-même requêtes, lignes et octets des
résultats de la console, de l'éditeur SQL, des déploiements et de l'introspection. Il est affiché **à part**
(« Via Athanor ») pour distinguer la charge qu'il génère de celle des applications.

**Collecte**

- Compteurs **cumulatifs** lus à intervalle régulier ; Athanor calcule les **deltas**, gère la
  **remise à zéro** (redémarrage du serveur : on ignore le delta négatif plutôt que d'afficher un pic faux).
- Même tâche de fond que la santé (§17) ; respect de `connectionBudget` ; une lecture de vues système par
  intervalle, négligeable pour la base.
- **Agrégation décroissante** : minute (7 j) → heure (90 j) → jour (2 ans), durées réglables ; stockage
  compact dans `connection_metrics(connection_id, bucket_start, resolution, queries, by_type_json,
bytes_out, bytes_in, rows_returned, quality)`.
- Ventilation par utilisateur/application **optionnelle** (désactivée par défaut) car elle expose des
  noms de comptes ; accès **admin uniquement**, audité.

**Questions ouvertes** : pour PostgreSQL, accepter une estimation (lignes × taille moyenne de ligne) ou
laisser « indisponible » tant que le DBA n'a pas activé une source d'octets ? alerter sur des seuils de
trafic (lien avec l'idée 35, à arbitrer) ? facturation interne par client/variante (§10) à partir de ces
chiffres ?

---

## 18. Notifications par abonnement (validé : point 32)

**Besoin** : « prévenez-moi quand **cette table** change ». Chacun s'abonne à ce qui l'intéresse.

**Où** : icône 🔔 sur une table (graphe, inspecteur), un projet, une connexion, une étape d'environnement.
Centre de notifications dans la barre du haut (partagé avec les alertes du §9.4).

```
 Suivre « users »  🔔
  Me prévenir quand :  [✓] la structure change   [✓] elle est verrouillée / déverrouillée
                       [ ] ses données initiales changent   [✓] une dérive externe la touche
                       [✓] un déploiement la modifie (avec l'étape : [ Prod ▾ ])
  Par :  [✓] Dans Athanor   [✓] E-mail   [ ] Webhook        Fréquence :  ( ) Immédiat  (•) Résumé quotidien
```

- Abonnement à une **table**, un **projet**, une **étape**, une **variante**, ou à « tout ce qui concerne la Prod ».
- Événements issus de ceux qui existent déjà : modification de schéma (révisions), verrous (§3), déploiements,
  dérive (§9), sauvegardes en échec (§11), nouvelle version de base disponible (§10).
- Résumé quotidien groupé pour éviter le bruit ; **ne jamais notifier son propre changement** ; respect des
  droits (on ne notifie pas d'un projet que l'on ne peut pas voir).
- Données : `subscriptions(user_id, scope_type, scope_id, events_json, channels_json, digest)` ;
  réutilise le canal e-mail (SMTP) et `modules/webhooks/` ; routes `/api/subscriptions`.

---

## 19. Annuler / rétablir et historique visuel (validé : point 39)

**Constat** : `features/editor/history/` (`HistoryPanel`, `DiffSummary`) et les révisions
(`modules/projects/routes/revisions.ts`) existent ; l'annulation en session dépend des hooks de l'éditeur.

**Cible**

```
 Historique                                         Filtrer : [ Tout ▾ ]   [ Mes modifications ✓ ]
 ●  Maintenant        (état courant)
 ●  14:32  alice      Ajout de la colonne orders.note                       [ Aperçu ] [ Restaurer ]
 ●  14:20  vous       Renommage users → customers                           ◂ vous êtes ici (annulé)
 ○  14:10  bob        Ajout de la table refunds         ⛓ déployé en PreProd #84
 ●  13:55  vous       Changement de type orders.total
 ─ Aperçu : diff visuel sur le graphe (ajouts en vert, retraits en rouge, modifications en orange)
```

- **Annuler/Rétablir** (`Ctrl+Z` / `Ctrl+Maj+Z`) **par utilisateur** en collaboration (on n'annule que ses
  propres changements), sans effacer les modifications des autres ; pile bornée, persistée pendant la session.
- **Aperçu avant restauration** : le graphe affiche le diff de la révision ; « Restaurer » crée une **nouvelle
  révision** (jamais de réécriture de l'historique).
- Marqueurs sur la frise : déploiements (par étape §12), verrous, versions publiées (§10), dérives (§9).
- Restauration partielle : « Restaurer seulement cette table » depuis une révision.
- Respect des **verrous** (§3) : on ne peut pas restaurer une version qui modifierait une table verrouillée.
- Regroupement des micro-modifications (frappes) en une entrée pour garder une frise lisible.

**Questions ouvertes** : durée de rétention des révisions détaillées (compactage après N jours) ? l'annulation
d'un changement déjà déployé propose-t-elle directement un nouveau déploiement ?

---

## 20. Ordre de livraison proposé

| #   | Lot                                                                                     | Dépend de              | Valeur                             |
| --- | --------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------- |
| 1   | Correctif éditeur DBML (§2)                                                             | —                      | corrige un bug gênant, indépendant |
| 2   | Fondations UI : tokens + Select/Menu/Switch/Checkbox/ConfirmDialog/Toast (§1)           | —                      | débloque tout le reste             |
| 3   | Rôles et verrous de tables (§3)                                                         | 2 (cadenas, dialogues) | cœur « gouvernance »               |
| 4   | Politique « structure via le schéma » + redirection (§4)                                | 3                      | cohérence console ↔ schéma         |
| 5   | Espace de travail à onglets (§0)                                                        | 2                      | navigation fluide                  |
| 6   | SQL dans l'éditeur (§6)                                                                 | 4, 5                   | expérience demandée                |
| 7   | Seeds CSV (§5)                                                                          | 3                      | déploiement avec données           |
| 8   | Journal d'activité Athanor (§8.1-8.2)                                                   | 2                      | traçabilité admin                  |
| 9   | Détection des modifications externes + alertes, niveau 0 (§9)                           | 8                      | cœur « sécurité »                  |
| 10  | Logs côté base niveaux 1-2 (§8.3)                                                       | 8, 9                   | attribution de l'auteur            |
| 11  | Sauvegardes logiques + restauration + rollback de déploiement (§11.1-11.4)              | 8                      | filet de sécurité                  |
| 12  | Projets dérivés : base + variantes, fusion, moteur par variante (§10)                   | 3, 5                   | multi-clients                      |
| 13  | Sauvegardes natives / rollback de données fin / chronologie (§11.5-11.6)                | 11                     | complétude                         |
| 14  | Environnements configurables, pipeline et promotion (§12)                               | 3, 11                  | cycle de vie DEV → Prod            |
| 15  | Détection des changements destructifs (§13)                                             | 11                     | déploiements sûrs                  |
| 16  | Génération de données de test (+ point d'extension IA) (§14)                            | 7                      | jeux de test                       |
| 17  | Linter de schéma + dictionnaire de données (§15)                                        | 2                      | qualité et documentation           |
| 18  | Annuler/rétablir et historique visuel (§19)                                             | 2, 3                   | confort d'édition                  |
| 19  | Plan d'exécution visuel + tableau de santé + trafic requêtes/volume (§16.1, §17, §17.1) | 6, 8                   | observabilité                      |
| 20  | Notifications par abonnement (§18)                                                      | 9                      | informer les bonnes personnes      |
| 21  | Index : suggestions et nettoyage (§16.2-16.3)                                           | 19                     | performance                        |
| 22  | Conseiller de requêtes activable, réécritures + modifications de base (§16.4-16.6)      | 21, 12                 | optimisation guidée                |
| 23  | Refonte visuelle écran par écran (§7)                                                   | 2                      | cohérence globale, en continu      |

Chaque lot : migration testée, i18n fr/en, audit, `CHANGELOG.md`, `docs/user-guide.md`, API publique et
`openapi.ts` si concernés.

## 21. Risques transverses

- **Variantes** : identifiants stables des objets du schéma, conflits de fusion, explosion de la matrice si trop de variantes.
- **Conseiller de requêtes** : les requêtes contiennent des données personnelles (normalisation, rétention, accès admin), charge sur la base, recommandations fausses (afficher la confiance), dialectes SQL multiples.
- **Environnements** : migration de `db_connections.environment` vers des étapes configurables sans casser l'existant ; droits de promotion.
- **Données générées / IA** : ne jamais envoyer de données réelles à un fournisseur externe ; jamais d'insertion en Prod par défaut.
- **Sauvegardes** : volume et durée sur grosses bases, stockage des secrets/données personnelles, restauration destructrice.
- **Surveillance** : faux positifs (normalisation des types), charge sur la base cible, droits requis pour les logs côté base.
- **Sécurité** : SQL pour non-admins, import de fichiers (taille, formules CSV, encodage).
- **Compatibilité** : `/api/v1`, plugins, import DBML doivent respecter verrous et politiques.
- **Performance** : gros seeds et résultats (virtualisation), temps de resync de l'éditeur.
- **Ampleur** : la refonte touche presque tout → livrer par petites PR, composants d'abord.

## 22. Idées en attente

_(à compléter)_

Idées retenues de la liste de propositions : 4, 5, 6 (§11, §13), 7, 8, 9 (§12), 11 (§14), 15, 16, 17, 18, 19 (§15-16), 32 (§18), 34 (§17, dont trafic §17.1), 39 (§19), plus le conseiller de requêtes (§16.4). Les autres (1-3, 10, 12-14, 20-31, 33, 35-38, 40) restent à arbitrer.

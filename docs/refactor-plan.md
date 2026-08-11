# Refactorisation AthanorDB

> **État : exécutée.** Ce document conserve l'analyse d'origine ; le résultat
> constaté figure en fin de page (§5).

## 0. Stack constaté

Monorepo npm workspaces, ~23 500 LOC sur 175 fichiers TS/TSX.

| Workspace              | Rôle                          | Stack                                                            |
| ---------------------- | ----------------------------- | ---------------------------------------------------------------- |
| `apps/web`             | SPA éditeur de diagrammes     | React 18, Vite 5, Tailwind 3, `@xyflow/react`, CodeMirror 6, Yjs |
| `apps/server`          | API + serveur temps réel      | Fastify 5, better-sqlite3, WebSocket Yjs                         |
| `packages/shared`      | Types, protocole, limites     | TS pur + Yjs                                                     |
| `packages/dbml-engine` | Parse / sérialise / diff DBML | `@dbml/core`                                                     |

**Points déjà sains** (à ne pas casser) : 0 `TODO`/`FIXME`, 0 bloc de code commenté, 1 seul `any`, séparation workspaces propre, kit de primitives `ui/` déjà présent, tokens Tailwind branchés sur les variables CSS de `index.css` (une seule palette).

---

## 1. Cartographie : structure actuelle vs cible

### 1.1 `apps/web/src` — actuel

Racine plate : **40 fichiers** au même niveau, mélangeant écrans, nœuds de canvas, modales et utilitaires. 7 sous-dossiers existent déjà (`admin`, `dbmlEditor`, `editor`, `hooks`, `plugins`, `projectList`, `refEdge`, `settings`, `table`, `ui`, `icons`) mais la découpe s'est arrêtée à mi-chemin : `TableNode.tsx` est à la racine alors que `table/` existe, `RefEdge.tsx` est à la racine alors que `refEdge/` existe, `ProjectList.tsx` est à la racine alors que `projectList/` existe.

```
apps/web/src/
  App.tsx  AcceptInvite.tsx  AdminConsole.tsx  CanvasArea.tsx (917 l.)
  ChangePasswordModal.tsx  ColorSwatchPicker.tsx  CommentThread.tsx
  CursorNode.tsx  DbmlPanel.tsx  DisplayNameField.tsx  EnumNode.tsx
  ErrorBoundary.tsx  ExportDialog.tsx  HistoryPanel.tsx  Icons.tsx (258 l.)
  ImportDialog.tsx  Login.tsx  Modal.tsx  Navbar.tsx  PluginManagerDialog.tsx
  PresenceList.tsx  ProjectEditor.tsx  ProjectList.tsx  ProjectListScreen.tsx
  ProjectTeamsModal.tsx  RefEdge.tsx  SettingsModal.tsx  SettingsPage.tsx
  StickyNoteNode.tsx  TableGroupNode.tsx  TableNode.tsx  Tooltip.tsx
  ValidationPanel.tsx  ZoneNode.tsx
  autoLayout.ts  awarenessColor.ts  localPrefs.ts  refGeometry.ts
  types.ts  useAwarenessStates.ts  useProjectDoc.ts  yjsClient.ts
  index.css  fonts.css  main.tsx
  + admin/ dbmlEditor/ editor/ hooks/ icons/ plugins/ projectList/
    refEdge/ settings/ table/ ui/
```

### 1.2 `apps/web/src` — cible

Organisation **par domaine métier** (feature-first), avec les couches transverses isolées :

```
apps/web/src/
├── main.tsx
├── app/
│   ├── App.tsx                     ← shell seul
│   ├── AppRouter.tsx               ← cascade de vues extraite de App.tsx
│   └── providers/AppProviders.tsx  ← I18nProvider + ErrorBoundary racine
├── assets/
│   ├── icons/*.svg                 ← déplacé depuis src/icons
│   └── fonts/                      ← déplacé depuis public/fonts
├── components/
│   ├── ui/                         ← primitives existantes (Button, Card, Input, …)
│   ├── overlays/                   ← Modal, Tooltip, ContextMenu
│   └── inputs/                     ← ColorSwatchPicker, InlineRenameField
├── features/
│   ├── auth/                       ← Login, AcceptInvite, ChangePasswordModal, useAuthSession
│   ├── projects/                   ← ProjectListScreen, ProjectList, projectList/*, useProjects, useProjectRouting
│   ├── editor/
│   │   ├── ProjectEditor.tsx
│   │   ├── canvas/                 ← CanvasArea éclaté (voir §2.2)
│   │   ├── nodes/                  ← TableNode, EnumNode, ZoneNode, StickyNoteNode, TableGroupNode, CursorNode, table/*
│   │   ├── edges/                  ← RefEdge, refEdge/*
│   │   ├── dbml/                   ← DbmlPanel, dbmlEditor/*
│   │   ├── history/                ← HistoryPanel
│   │   ├── validation/             ← ValidationPanel
│   │   ├── comments/               ← CommentThread
│   │   └── io/                     ← ImportDialog, ExportDialog
│   ├── collaboration/              ← PresenceList, useAwarenessStates, awarenessColor, yjsClient, useProjectDoc
│   ├── admin/                      ← AdminConsole + admin/*
│   ├── settings/                   ← SettingsPage, SettingsModal, settings/*
│   ├── teams/                      ← ProjectTeamsModal
│   └── plugins/                    ← plugins/*
├── services/                       ← COUCHE MANQUANTE (voir §2.1)
│   ├── httpClient.ts
│   ├── ApiError.ts
│   ├── authApi.ts  projectsApi.ts  usersApi.ts  teamsApi.ts
│   ├── invitationsApi.ts  auditApi.ts  convertApi.ts
├── i18n/
│   ├── I18nProvider.tsx  useTranslation.ts  translate.ts  formatters.ts
│   └── serverErrorMessages.ts      ← mapping code serveur → clé de traduction
├── locales/
│   ├── fr.json
│   └── en.json
├── hooks/                          ← génériques uniquement
│   ├── useOutsideClick.ts  useEscapeKey.ts  useInlineRename.ts  useAsyncAction.ts
├── utils/                          ← autoLayout, refGeometry, preferences (ex-localPrefs)
├── styles/                         ← index.css éclaté (voir §2.4)
└── types/                          ← types.ts éclaté par domaine
```

### 1.3 `apps/server/src` — actuel vs cible

Actuel : `routes/` contient à la fois le routage HTTP, la validation, les règles métier et l'accès SQL. `routes/projects.ts` fait **562 lignes / 19 handlers / 58 `reply.code(...)` / 48 littéraux d'erreur en dur**.

Cible — découpage en modules à responsabilité unique :

```
apps/server/src/
├── index.ts                    ← bootstrap seul (plugins Fastify, enregistrement des modules)
├── config.ts
├── infrastructure/
│   ├── db.ts  migrations.ts  backup.ts  backupRunner.ts  restore.ts
├── modules/
│   ├── auth/         routes.ts  service.ts  (email, lockout, password, session)
│   ├── users/        routes.ts  service.ts  repository.ts
│   ├── teams/        routes.ts  service.ts  repository.ts
│   ├── projects/
│   │   ├── routes/   crud.ts  revisions.ts  importExport.ts  members.ts
│   │   ├── service.ts  repository.ts
│   ├── invitations/  routes.ts  service.ts
│   ├── audit/        routes.ts  service.ts
│   └── convert/      routes.ts  service.ts
├── shared/
│   ├── errors.ts     ← ApiError + catalogue de codes (voir §2.1)
│   ├── guards.ts     ← requireAuth / requireAdmin / requireProjectAccess
│   └── replies.ts    ← sérialisation uniforme des réponses d'erreur
└── realtime/         ← yjs/room.ts, yjs/persistence.ts
```

---

## 2. Éléments dupliqués / redondants identifiés

### 2.1 Accès API — la duplication la plus coûteuse

**49 appels `fetch()` bruts répartis dans 20 composants.** Chaque appelant réimplémente les mêmes 4 gestes :

| Motif répété                         | Occurrences | Fichiers |
| ------------------------------------ | ----------- | -------- |
| `"Content-Type": "application/json"` | 20          | 17       |
| `await res.json()`                   | 18          | 16       |
| test `!res.ok` + `setError(...)`     | 7           | 5        |
| `setError(data.error ?? "…")`        | 10          | 10       |

Conséquences : la couche UI est couplée aux URLs de l'API (`/api/projects/${id}/revisions/${revId}/restore` écrit à la main dans `HistoryPanel.tsx`), aucun point unique pour l'authentification, le retry ou le typage des réponses, et surtout **les messages d'erreur du serveur (en anglais) sont affichés bruts à l'utilisateur** sur 10 sites.

Cible : `services/httpClient.ts` (une seule fonction `request<T>()` : en-têtes, parsing, `ApiError` typée) + un module par ressource. Les composants n'appellent plus que `projectsApi.restoreRevision(projectId, revisionId)`.

### 2.2 `CanvasArea.tsx` — 917 lignes, 6 composants dans un seul fichier

| Ligne | Élément inline              | Destination                                       |
| ----- | --------------------------- | ------------------------------------------------- |
| 118   | `CanvasContextMenu`         | `features/editor/canvas/CanvasContextMenu.tsx`    |
| 150   | `CanvasSearchPanel`         | `features/editor/canvas/CanvasSearchPanel.tsx`    |
| 228   | `ToolbarMenu`               | `features/editor/canvas/ToolbarMenu.tsx`          |
| 303   | `DetailLevelDropdown`       | `features/editor/canvas/DetailLevelDropdown.tsx`  |
| 339   | `ZoomControls`              | `features/editor/canvas/ZoomControls.tsx`         |
| 417   | `PluginMenu`                | `features/editor/canvas/PluginMenu.tsx`           |
| 468   | `CanvasArea` (9 `useState`) | `features/editor/canvas/CanvasArea.tsx` (~200 l.) |

L'état de recherche (4 `useState`, l. 569-572) sort en `useCanvasSearch.ts`.

### 2.3 Micro-motifs dupliqués

| Motif                                                              | Occurrences | Extraction cible                      |
| ------------------------------------------------------------------ | ----------- | ------------------------------------- |
| Renommage inline (`commitRename` ×4, `commitName` ×2, `commit` ×6) | 12          | `hooks/useInlineRename.ts`            |
| `addEventListener("keydown")` + Escape                             | 13 sites    | `hooks/useEscapeKey.ts`               |
| Fermeture au clic extérieur (`handleOutsideClick` ×4)              | 4           | `hooks/useOutsideClick.ts`            |
| `refresh()` = fetch + setState + setLoading                        | 6 sites     | `hooks/useAsyncResource.ts`           |
| `isSqlDialect` défini 2× côté serveur                              | 2           | `packages/shared`                     |
| Chargement/écriture localStorage (6 paires `loadX`/`saveX`)        | 12          | `utils/preferences.ts` générique typé |

### 2.4 Double système d'icônes

`Icons.tsx` (258 l.) exporte **51 composants SVG écrits à la main**, alors que `src/icons/` contient **36 fichiers `.svg`** et que `vite-plugin-svgr` est déjà installé. Deux sources pour la même chose. Cible : un seul système (svgr sur `assets/icons/*.svg`, `Icons.tsx` réduit à un barrel de ré-exports).

### 2.5 Styles

`index.css` (275 l.) mélange tokens (`:root`), reset, utilitaires glassmorphism, styles de nœuds React Flow, keyframes et overrides de la librairie. Cible : `styles/tokens.css`, `base.css`, `animations.css`, `reactflow.css`, `fonts.css`, agrégés par `styles/index.css`.

52 `style={{…}}` inline subsistent face à 373 `className` Tailwind — à convertir sauf quand la valeur est calculée (positions de canvas).

### 2.6 Code mort confirmé

| Élément                                                                                                                                       | Statut                   |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `DisplayNameField.tsx`                                                                                                                        | fichier jamais importé   |
| `ui/StatusPill.tsx`                                                                                                                           | fichier jamais importé   |
| `Icons.tsx` : `ShieldCheckIcon`, `DatabaseIcon`, `ZapIcon`, `ChevronDownIcon`, `ExternalLinkIcon`, `MousePointerIcon`, `MoveIcon`, `GridIcon` | 8 exports non référencés |
| `ui/Badge.tsx :: CountBadge`, `ui/Card.tsx :: CardFooter`                                                                                     | non référencés           |
| `ui/layout.ts :: TOOLBAR_GROUP`, `TOOLBAR_DIVIDER`, `TOOLBAR_SPACER`                                                                          | non référencés           |
| `dbmlEditor/setup.ts :: readOnlyCompartment`                                                                                                  | non référencé            |

Total : 2 fichiers + 14 exports à supprimer. À revérifier après extraction i18n (un export peut redevenir utile).

---

## 3. Stratégie d'internationalisation

### 3.1 État des lieux

**~509 chaînes utilisateur en dur** dans `apps/web` (78 fichiers). Le problème n'est pas seulement l'absence d'i18n : **l'UI est déjà bilingue par accident**.

| Langue détectée      | Occurrences |
| -------------------- | ----------- |
| Français             | 75          |
| Anglais (multi-mots) | 107         |
| Mot unique / ambigu  | 70          |

Exemples voisins dans la même interface : `"Console d'administration"` à côté de `"Add table"`, `"Aucune action enregistrée pour ce filtre."` à côté de `"Create team"`.

Côté serveur : **93 messages d'erreur en anglais** (`"authentication required"`, `"project not found"`, `"limit must be a number"`) renvoyés dans `{ error: "…" }` et **affichés bruts** dans l'UI sur 10 sites.

### 3.2 Mécanisme retenu : helper natif typé (pas de `react-i18next`)

Justification : le projet est délibérément sobre en dépendances (polices auto-hébergées, pas de routeur, pas de librairie d'état, pas de data-fetching). `react-i18next` + `i18next` ajoute ~40 kB gzip pour deux langues et un besoin sans namespaces dynamiques ni chargement distant. Un helper de ~120 lignes couvre tout le besoin, avec en prime la **vérification des clés à la compilation**.

```
i18n/
├── translate.ts        interpolation {{var}} + pluriel via Intl.PluralRules
├── I18nProvider.tsx    contexte React, locale persistée (utils/preferences)
├── useTranslation.ts   hook → { t, locale, setLocale }
├── formatters.ts       Intl.DateTimeFormat / NumberFormat / RelativeTimeFormat
└── serverErrorMessages.ts
```

Typage : `type TranslationKey = keyof typeof fr` — toute clé absente de `en.json` devient une erreur `tsc`, donc le CI existant (`npm run build`) détecte les traductions manquantes sans outil supplémentaire.

Chargement : `fr.json` importé statiquement (locale par défaut), `en.json` en `import()` dynamique.

### 3.3 Convention de clés

Namespaces alignés sur l'arborescence `features/` :

```json
{
  "common": { "save": "Enregistrer", "cancel": "Annuler", "delete": "Supprimer" },
  "auth": { "login.title": "Connexion", "login.passwordPlaceholder": "Mot de passe" },
  "editor": { "canvas.addTable": "Ajouter une table", "canvas.detailLevel.compact": "Compact" },
  "projects": { "list.empty": "Aucun projet", "card.deletedOn": "Supprimé le {{date}}" },
  "errors": { "PROJECT_NOT_FOUND": "Ce projet est introuvable." }
}
```

### 3.4 Erreurs serveur — codes plutôt que phrases

Le serveur renvoie désormais un code stable en plus du message :

```ts
// avant
reply.code(404).send({ error: "project not found" });
// après
throw new ApiError(404, "PROJECT_NOT_FOUND");
// → { error: "project not found", code: "PROJECT_NOT_FOUND" }
```

Le champ `error` est conservé (compatibilité, logs, appels API directs) ; le client traduit à partir de `code` et retombe sur `error` si le code est inconnu. Ce mapping seul supprime les 10 sites où de l'anglais brut est affiché à l'utilisateur.

### 3.5 Sélecteur de langue

Ajouté dans `features/settings` (onglet Préférences), locale persistée en `localStorage` via `utils/preferences.ts`, initialisée depuis `navigator.language` avec repli sur `fr`. Le `<html lang>` est mis à jour par `I18nProvider`.

**Hors périmètre** (à confirmer) : la documentation `docs/` et les textes légaux (`docs/legal/cgu.md`, `confidentialite.md`) restent en français — leur traduction juridique n'est pas un travail de refactorisation.

---

## 4. Plan de migration étape par étape

Chaque étape est autonome, compile, et passe `npm run lint && npm run build && npm test`. Aucune étape ne mélange déplacement de fichiers et changement de comportement.

| #      | Étape                                                                                                                                                   | Portée         | Risque             | Vérification            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------ | ----------------------- |
| **1**  | **Suppression du code mort** — 2 fichiers + 14 exports (§2.6)                                                                                           | 16 éléments    | Très faible        | `lint` + `build`        |
| **2**  | **Alias de chemins** — `@/*` dans `tsconfig` + `vite.config.ts`, remplacement des imports relatifs profonds                                             | web            | Très faible        | `build`                 |
| **3**  | **Couche `services/`** — `httpClient` + `ApiError` + 7 modules API ; migration des 49 `fetch`                                                           | 20 fichiers    | Moyen              | test manuel par écran   |
| **4**  | **Codes d'erreur serveur** — `shared/errors.ts`, `ApiError`, `guards.ts` ; conversion des 110 `reply.code`                                              | serveur        | Moyen              | tests serveur existants |
| **5**  | **Hooks génériques** — `useEscapeKey`, `useOutsideClick`, `useInlineRename`, `useAsyncResource`, `utils/preferences` ; remplacement des 12+13+4+6 sites | web            | Faible             | `build` + test manuel   |
| **6**  | **Éclatement `CanvasArea.tsx`** — 6 composants + `useCanvasSearch` (§2.2)                                                                               | 1 → 8 fichiers | Moyen              | test manuel canvas      |
| **7**  | **Éclatement `routes/projects.ts`** — 4 fichiers de routes + service + repository ; idem `users.ts` (347 l.)                                            | serveur        | Moyen              | tests serveur           |
| **8**  | **Restructuration des dossiers web** — déplacement vers `app/ components/ features/ services/ hooks/ utils/ styles/ types/ assets/`                     | ~116 fichiers  | Faible (mécanique) | `build`                 |
| **9**  | **Unification des icônes** — svgr unique, `Icons.tsx` → barrel                                                                                          | 51 → ~36       | Faible             | inspection visuelle     |
| **10** | **Éclatement des styles** — `index.css` → `styles/*`                                                                                                    | 2 → 6 fichiers | Faible             | inspection visuelle     |
| **11** | **Socle i18n** — `i18n/*`, `locales/fr.json`, `locales/en.json`, provider, sélecteur de langue                                                          | nouveau        | Faible             | build                   |
| **12** | **Extraction des chaînes** — les ~509 littéraux, écran par écran, en commençant par les 107 chaînes anglaises orphelines (§3.1)                         | 78 fichiers    | Élevé (volume)     | relecture par écran     |
| **13** | **Traduction serveur → client** — `serverErrorMessages.ts`, câblage des codes de l'étape 4                                                              | web            | Faible             | test des cas d'erreur   |
| **14** | **Passe de nommage** — vérification `camelCase`/`PascalCase`, verbes d'action sur les fonctions                                                         | global         | Faible             | `lint`                  |
| **15** | **Garde-fous** — règle ESLint contre les littéraux JSX non traduits, script de vérification de parité `fr`/`en` dans le CI                              | outillage      | Faible             | CI                      |

Ordre imposé par les dépendances : 3 avant 4 (le client doit savoir lire les codes), 4 avant 13, 11 avant 12, 8 après 6 (déplacer moins de fichiers). Les étapes 1, 2, 9, 10 sont indépendantes et peuvent être avancées.

### Points nécessitant un arbitrage avant l'étape 12

1. **Langue de référence des clés** — proposition : valeurs `fr.json` = source de vérité (majorité du code métier récent est en français), `en.json` en traduction.
2. **Périmètre `docs/`** — traduits ou laissés en français ?
3. **Textes des plugins** (`plugins/examples.ts`, `registry.ts` — 10 chaînes) : traduits, ou considérés comme du contenu de démonstration ?

---

## 5. Résultat constaté

Toutes les étapes du plan ont été exécutées. `npm run lint`, `npm run build` et
`npm test --workspaces` passent (165 tests : 80 serveur, 36 dbml-engine, 32 web,
17 shared).

### 5.1 Mesures avant / après

| Indicateur                                |                          Avant |                                                  Après |
| ----------------------------------------- | -----------------------------: | -----------------------------------------------------: |
| `fetch()` bruts dans les composants       |                             49 |                                                  **0** |
| `CanvasArea.tsx`                          |                         917 l. |                              **292 l.** (+ 10 modules) |
| `routes/projects.ts`                      |           562 l. / 19 handlers | **4 fichiers de routes + repository**, ≤ 120 l. chacun |
| Fichiers > 500 lignes (hors tests)        |                              3 |      **1** (`dbmlEditor/symbols.ts`, parseur cohérent) |
| Chaînes UI en dur                         | ~509 (75 FR / 107 EN mélangés) |                           **0** — 448 clés × 2 locales |
| Erreurs serveur affichées en anglais brut |                       10 sites |                                                  **0** |
| Fichiers/exports morts                    |        2 fichiers + 14 exports |                                                  **0** |

### 5.2 Écarts par rapport au plan

- **`useInlineRename` n'existe pas.** Les douze sites de renommage se sont
  réduits à un seul primitif, `hooks/useDraftValue`, qui couvre aussi les
  champs type / valeur par défaut / note. Un deuxième hook au périmètre
  chevauchant aurait recréé la duplication qu'il devait supprimer.
- **`postcss-import` a dû être ajouté en dépendance explicite.** Un `@import`
  placé après une règle est ignoré (spec CSS) : la première version de la
  découpe supprimait silencieusement quatre fichiers du bundle. Les directives
  `@tailwind` vivent désormais dans `styles/tailwind.css`, importé à sa position
  exacte dans la cascade.
- **Structure serveur élargie.** Au-delà du découpage des routes, `db`,
  `migrations`, `backup*` et `restore` sont passés sous `infrastructure/`,
  `yjs/` sous `realtime/`, et `permissions`/`audit` sous `shared/`.

### 5.3 Garde-fous ajoutés

1. **Parité des locales à la compilation** — `i18n/localeParity.ts` type
   `en.json` contre `fr.json`. Une clé manquante ou en trop casse `tsc`, donc le
   CI existant. Aucun fichier ne l'importe à l'exécution : le bundler ne tire
   pas `en.json` dans le chunk initial.
2. **Règle ESLint anti-régression** — `no-restricted-syntax` sur les nœuds
   `JSXText` contenant 4 lettres ou plus. Toute nouvelle phrase écrite en dur
   dans un composant échoue au lint.
3. **Point de sortie unique des erreurs serveur** — `registerErrorHandler`
   sérialise chaque `ApiError`, et un throw inattendu ne peut plus laisser fuir
   un message interne (requête SQL, chemin de fichier) vers le client.

### 5.4 Restant volontairement non traité

- **Onglet « Éditeur » des paramètres** : deux cases à cocher (`aimantage`,
  `surlignage des clés étrangères`) sont `defaultChecked` sans gestionnaire —
  elles ne pilotent rien. Traduites mais non câblées : les brancher est une
  décision produit, pas une refactorisation.
- **Messages d'erreur de l'API de plugins** (`registry.ts`, `PluginHost.ts`,
  `sandboxRuntime.ts`) laissés en anglais : ce sont des diagnostics destinés à
  l'auteur du plugin, au même titre que n'importe quelle erreur d'API JS, pas
  des textes d'interface.
- **`docs/` et textes légaux** laissés en français, conformément à l'arbitrage
  du §3.5.

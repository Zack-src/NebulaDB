# Refonte UI/UX - 02 - Espace de modélisation : canvas et contrôle des tables

Domaine : l'éditeur de schéma (onglet « Schéma » d'un projet), sa barre du haut, ses barres flottantes, les nœuds de table, les relations, les panneaux (DBML, historique, commentaires, problèmes), la palette et les raccourcis.
Hors domaine (traités par les autres sections du plan) : liste des projets, console d'administration, onglets Données & SQL / Déploiements / Journal côté base (on ne traite ici que leur *point d'entrée* dans la barre du projet).

Statut : proposition de conception, aucune ligne de code modifiée. Tout ce qui est écrit au présent sous « Existant » a été vérifié dans le code (fichiers cités). Les chiffres marqués « estimé » n'ont pas été mesurés dans un navigateur.

---

## 0. Lecture rapide (pour le propriétaire)

1. Le « loooong header » est en réalité **trois endroits** : (a) la barre du projet `ProjectToolbar.svelte` (13 boutons + 3 indicateurs), (b) la seconde barre `WorkspaceBar.svelte` (6 onglets + 5 contrôles), (c) l'en-tête de **chaque table** du canvas, qui peut porter jusqu'à **9 boutons-icônes** dans un nœud large de 190 px minimum. La refonte traite les trois, sinon on déplace le problème.
2. Principe directeur : **on ne met dans une barre que ce qui s'applique à tout le projet ; ce qui s'applique à un objet vit sur l'objet** (barre flottante, menu clic droit, inspecteur).
3. Le modèle cible tient en cinq pièces : un **header unique de 48 px** (navigation + 3 actions), un **dock d'outils** au bas du canvas (créer), un **inspecteur** à droite (propriétés de la sélection, remplace 6 popovers), un **registre de commandes** unique alimentant menus contextuels / barre flottante / palette `Ctrl+K` / raccourcis, et une **barre d'état** (synchro, verrous, problèmes, SQL).
4. Effet chiffré visé (détail en annexe A) : barre(s) du haut de **24 contrôles à 12** (6 + 6 onglets), de **~100 px** de chrome vertical en haut à **48 px**, de **42 à 36 contrôles permanents** au total (le gain est surtout en haut ; on expose volontairement 5 outils de création au lieu d'un menu), **0 action révélée au seul survol**, et de **19 popups à saisie** (13 modales + 6 popovers de formulaire) à **10 modales** de flux réellement nécessaires (les popovers de formulaire deviennent sections d'inspecteur).
5. Deux défauts découverts pendant l'audit, à corriger indépendamment de la refonte : le cluster d'actions Importer/Exporter/Convertir/Comparer/Déployer est en `hidden md:flex` donc **inaccessible sous 768 px** ; les boutons Annuler/Rétablir/Réorganiser **restent actifs sur les onglets autres que Schéma** alors que les raccourcis y sont désactivés (`ProjectEditor.svelte` l. 542).

---

## 1. Inventaire exhaustif des contrôles actuels

Convention : « clics » = nombre de clics depuis le canvas au repos pour atteindre l'action (clic droit compté comme 1 ; survol non compté mais signalé « survol »).

### 1.1 Barre du projet - `apps/web/src/features/editor/ProjectToolbar.svelte` (APP_HEADER = `h-14`, 56 px, `components/ui/layout.ts`)

| # | Contrôle | Libellé FR (`fr.json`) | Condition d'affichage | Clics |
|---|----------|------------------------|-----------------------|-------|
| H1 | Retour aux projets | `admin.backToProjects` | toujours | 1 |
| H2 | Marque + nom du projet | (texte, non interactif) | toujours | - |
| H3 | Pastille « Lecture seule » | `projects.card.readOnly` | `viewOnly` | - |
| H4 | Annuler | `editor.undo` « Annuler (Ctrl+Z) » | `!viewOnly` | 1 |
| H5 | Rétablir | `editor.redo` « Rétablir (Ctrl+Maj+Z) » | `!viewOnly` | 1 |
| H6 | Réorganiser automatiquement | `editor.autoLayout` | `!viewOnly` | 1 |
| H7 | Importer | `editor.import` | `!viewOnly` ; masqué < md | 1 + modale |
| H8 | Exporter | `editor.export` | toujours ; masqué < md | 1 + modale |
| H9 | Convertir les types | `editor.convertTypes` | `!viewOnly` ; masqué < md | 1 + modale |
| H10 | Comparer | `editor.compare` | toujours ; masqué < md | 1 + modale |
| H11 | Déployer (bouton primaire) | `deployment.deploy` | `onShowDeploy && !viewOnly && isProjectAdmin` ; masqué < md | 1 + modale |
| H12 | Indicateur « Connexion… / Reconnexion… » | `editor.connecting` / `editor.reconnecting` | seulement si pas `connected && synced` | - |
| H13 | Présence (avatars, vous inclus) | `PresenceList.svelte` | toujours | - (tooltip) |
| H14 | Menu « Suivre » | `FollowMenu.svelte` | `props.follow` (app réelle) | 2 |
| H15 | Cloche de notifications | `NotificationBell.svelte` | `props.follow` | 1 |
| H16 | Visite guidée | `tour.replay` | `onShowTour` | 1 |
| H17 | Paramètres | `common.settings` -> `SettingsModal` | `onOpenSettings` | 1 + modale |

Total : **13 boutons** (H1, H4-H11, H14-H17), **3 indicateurs** (H3, H12, H13) + marque. Libellés textuels visibles seulement à partir de `lg` (`hidden lg:inline`), sinon icônes seules **sans nom accessible** pour H7-H10 (le `<Button>` ne reçoit pas d'`aria-label`, seul le `<span>` masqué porte le texte : un `display:none` retire ce texte de l'arbre d'accessibilité).

Estimation de largeur (à mesurer) à 1024 px : groupe droit `shrink-0` = 5 boutons avec libellé (~510 px) + 5 icônes/avatars (~190 px) = ~700 px ; le groupe gauche (5 boutons + nom) doit se contenter de ~320 px : le nom du projet (`truncate`, `min-w-0`) est le premier sacrifié.

### 1.2 Seconde barre - `apps/web/src/features/workspace/WorkspaceBar.svelte`

| # | Contrôle | Condition | Clics |
|---|----------|-----------|-------|
| W1 | Onglet Schéma | toujours | 1 |
| W2 | Onglet Données & SQL | si l'utilisateur peut interroger une connexion (`mayQuery`) | 1 |
| W3 | Onglet Déploiements | `isProjectAdmin` | 1 |
| W4 | Onglet Historique | toujours | 1 |
| W5 | Onglet Problèmes (+ badge nombre) | toujours | 1 |
| W6 | Onglet Dictionnaire | toujours | 1 |
| W7 | Compteur de verrous (cadenas + n) | `lockCount > 0` | 1 + modale `TableLocksList` |
| W8 | Bouton SQL (Ctrl+J) | `canUseSql && tab === "schema"` | 1 (tiroir bas) |
| W9 | Badge d'environnement (rouge si production) | connexion avec environnement | - |
| W10 | « Mon compte SQL » | connexion `authMode === "personal"` | 1 + modale |
| W11 | Sélecteur de connexion courante (`Select`, `w-56`) | `connections.length > 0` | 2 |

Total : **6 onglets + 5 contrôles**. Hauteur estimée ~44-48 px (`pt-2.5` + onglet ; non mesurée). Les bandeaux `DriftBanner` (un par connexion dérivée) et `HistoryPreviewBanner` s'empilent en dessous.

### 1.3 Pilule basse du canvas - `canvas/CanvasToolbar.svelte` (+ `ToolbarMenu`, `InsertToolDropdown`, `DetailLevelDropdown`, `PluginMenu`)

| # | Contrôle | Contenu | Clics |
|---|----------|---------|-------|
| C1 | Segment MLD | bascule de vue (`ViewModeToggle`) | 1 |
| C2 | Segment MCD | idem | 1 |
| C3 | Menu « Insérer » | table / zone / note / énumération (arme un outil, pose au clic suivant) | 2 + clic canvas |
| C4 | Menu « Détail » | compact / standard / complet (**global**, `setAllDetailLevels`) | 2 |
| C5 | Surligner les liens (toggle, `data-testid="toggle-link-highlight"`) | `highlightLinks` | 1 |
| C6 | Afficher les erreurs de schéma (toggle, `data-testid="toggle-validation-issues"`) | `showValidationIssues` | 1 |
| C7 | Réinitialiser le tracé des liens | commande interne `reset-link-routing`, si `canWrite` | 1 |
| C8 | Minicarte (toggle) | `useSharedMinimapVisible` | 1 |
| C9 | Rechercher une table (Ctrl+F) | `CanvasSearchPanel` | 1 |
| C10 | Menu Plugins | commandes de plugins + « gérer les plugins » (`PluginQuickPalette`) | 2+ |

Total : **10 contrôles de premier niveau** (+ 4 + 3 + N entrées de menu). Tous les libellés des toggles C5-C8 sont des icônes sans texte.

### 1.4 Pilule de zoom - `canvas/CanvasZoomBar.svelte`

Z1 `-`, Z2 pourcentage -> menu (Ajuster / Ajuster à la sélection / 50 % / 100 % / 200 %), Z3 `+`, Z4 Ajuster. **4 contrôles + 5 entrées**. Le menu affiche `Shift+1` comme raccourci de « Ajuster » (`FIT_SHORTCUT`) mais **aucun gestionnaire de touche n'a été trouvé** dans `apps/web/src` (recherche `Digit1`, `key === "1"`) : l'indication est trompeuse ou le raccourci est fourni par Svelte Flow sans que ce soit documenté. À vérifier avant de promettre quoi que ce soit.

### 1.5 Barres flottantes contextuelles existantes

| # | Contrôle | Fichier | Déclencheur |
|---|----------|---------|-------------|
| S1 | « n tables sélectionnées » + bouton Grouper + grille de **15 pastilles** de couleur | `canvas/SelectionColorToolbar.svelte` (`Panel top-center`) | 2+ tables sélectionnées |
| S2 | Champ de recherche + précédent / suivant / fermer | `canvas/CanvasSearchPanel.svelte` | C9 ou Ctrl+F |
| S3 | Bandeau de statut transitoire (copie, collage, message de plugin) | `CanvasArea.svelte` l. 424-431 | événements |

### 1.6 Nœud de table - `nodes/TableNode.svelte` + `nodes/table/*`

En-tête (`TABLE_HEADER_CLASS`, hauteur `34px * --canvas-font-scale`, nœud `min-w-[190px]`). Les actions sont dans `HEADER_ACTIONS_CLASS` : `opacity-0` sauf `group-hover` / table sélectionnée / popover ouvert / commentaires présents. **Il n'existe aucune alternative au survol** (tactile, clavier).

| # | Contrôle | Condition | Au repos ? |
|---|----------|-----------|------------|
| T1 | Nom (double-clic = renommer en place) | `!readOnly && !structureLocked` | oui |
| T2 | Cadenas (gérer le verrou, ou icône seule) | table verrouillée | **oui** (`!opacity-100`) |
| T3 | Icône « données initiales » (CSV) | `data.seed` existe | **oui** |
| T4 | Triangle de problèmes de validation | `issues.length > 0` | oui |
| T5 | « Aller au DBML » | `onGoToDbml` | survol |
| T6 | « Voir les données » | `onViewData` (SQL utilisable) | survol |
| T7 | « Données initiales (CSV) » (ajout) | `!seed && onManageSeed` | survol |
| T8 | « Verrouiller la table… » | `!lock && onManageLock` | survol |
| T9 | Commentaires de la table (`CommentThread`) | `!readOnly` | survol / si commentaires |
| T10 | Paramètres de la table (engrenage -> `TableSettingsPopover`/`TableSettingsPanel`, 300 px) | `!readOnly` | survol |
| T11 | Pied « + Ajouter une colonne » | `onAddField && detailLevel !== "compact"` | oui |

Pire cas : T2, T3, T4, T5, T6, T7(ou T3), T8(ou T2), T9, T10 = **9 boutons-icônes de 24 px** soit 9 x 24 + 8 x 3 px de gap = **240 px** dans un nœud dont la largeur minimale est de 190 px, nom compris. Les icônes recouvrent donc le nom (tronqué par `text-ellipsis`) dès qu'elles apparaissent.

Contenu du popover T10 (`TableSettingsPanel.svelte`) : nom, 15 pastilles de couleur, bouton Dupliquer, section Index (liste `IndexRow`, formulaire `AddIndexForm` : colonnes, unique, pk, nom).

Ligne de colonne (`TableNodeRow.svelte`) :

| # | Contrôle | Notes |
|---|----------|-------|
| R1 | Poignée de glisser (grip) pour réordonner | HTML5 drag natif, MIME `application/x-athanordb-field`, **souris seulement** |
| R2 | Nom (double-clic = renommer) | |
| R3 | Pastilles PK / FK / UQ / NN / AI / note | non interactives (tooltips) |
| R4 | Engrenage -> `FieldEditorPopover`/`FieldEditorPanel` | survol (`ROW_ACTIONS_CLASS`) |
| R5 | Indicateur de commentaires (si existants) | popover `CommentThread` |
| R6 | Type (texte) | non éditable en place |
| R7 | 4 poignées de relation (gauche/droite x source/cible) | glisser pour créer une relation |

Contenu de R4 (`FieldEditorPanel.svelte`, 401 lignes) : bouton Supprimer **sans confirmation ni toast d'annulation** (l. 205-215), nom, type + suggestions, 4 bascules (clé primaire / unique / non nul / auto-incrément), actions référentielles ON DELETE / ON UPDATE par FK, valeur par défaut, note, fil de commentaires + zone de saisie + Publier.

### 1.7 Relations - `edges/*`

| # | Contrôle | Notes |
|---|----------|-------|
| E1 | Clic sur le trait (zone de capture 24 px) = sélection ; clic sur un point candidat = insère un point | `RefEdge.svelte` l. 200-217 |
| E2 | Pastille de cardinalité `CardinalityBadge` (à la sélection) : engrenage « Options du lien » + « Réinitialiser le tracé » | `RefEdgeOverlay.svelte` |
| E3 | `EdgeSettingsPopover` : cardinalité (boutons), ON DELETE, ON UPDATE, couleur (+ réinitialiser), réinitialiser le tracé, inverser le sens, supprimer | 245 lignes |
| E4 | Points de passage (glisser, double-clic) | `EdgeWaypoints.svelte` |
| E5 | Menu contextuel (`EdgeContextMenu`) : insérer/supprimer un point, réinitialiser le tracé, réinitialiser la couleur, inverser, supprimer | |

### 1.8 Autres nœuds et menus

| # | Objet | Contrôles |
|---|-------|-----------|
| O1 | Zone (`ZoneNode`) | redimensionnement (`NodeResizer`), double-clic = renommer, sélecteur de couleur (popover) |
| O2 | Note (`StickyNoteNode`) | redimensionnement, sélecteur de couleur, texte en place |
| O3 | Groupe de tables (`TableGroupNode`) | double-clic = renommer, bouton « Dégrouper » |
| O4 | Énumération (`EnumNode` / `EnumValueRow`) | renommer, « + valeur », édition/suppression des valeurs |
| O5 | Clic droit sur canvas vide (`CanvasContextMenu`) | 4 insertions, Copier (si sélection), Coller ; `canWrite` seulement |
| O6 | Clic droit sur table / colonne / sélection | **supprimé** : `onnodecontextmenu={suppressNativeMenu}` (`CanvasArea.svelte` l. 393-394) - aucun menu |
| O7 | Mode MCD (`McdToolbar`) | réinitialiser les positions, minicarte, mention « lecture seule » |

### 1.9 Panneau DBML - `dbml/DbmlPanel.svelte` (+ `DbmlEditor/`)

D1 aller au symbole (Ctrl+P), D2 palette de commandes (Ctrl+Maj+P), D3 formater (Maj+Alt+F), D4 replier ; si replié : D5 bouton `ChevronRight` en haut à gauche du canvas (26 px) ; indicateur de synchro ; barre de statut ; bandeau d'erreur de parsing. Redimensionnable (`panelWidth`, poignée avec double-clic = largeur par défaut). **Largeur du canvas = fenêtre - panneau DBML** : il n'y a aucune règle de largeur minimale du canvas.

### 1.10 Modales et popups de l'éditeur

Modales (montées dans `ProjectEditor.svelte`, toutes chargées à la demande) : `ImportDialog`, `ExportDialog`, `ConvertTypesModal`, `CompareProjectsModal`, `PluginManagerDialog`, `DeploymentModal` (écriture), `DeploymentModal readOnly` (différences), `TableLocksList`, `TableLockDialog`, `SeedDialog` (419 lignes), `SettingsModal`, `EditorTour`, et `PersonalAccountDialog` (dans `PersonalAccountButton`) = **13**.
Popovers : `TableSettingsPanel`, `FieldEditorPanel`, `CommentThread` (un composant, deux emplacements : table et colonne), `EdgeSettingsPopover`, `FollowMenu`, `NotificationBell`, 4 `ToolbarMenu` (Insérer, Détail, Zoom, Plugins), `PluginQuickPalette`, sélecteur de couleur zone, sélecteur de couleur note = **13** (dont **6 popovers de formulaire** : TableSettings, FieldEditor, CommentThread, EdgeSettings, couleur zone, couleur note).
Menus contextuels : `CanvasContextMenu`, `EdgeContextMenu` = **2**.
Total : **28 popups** (13 modales + 13 popovers + 2 menus contextuels), dont **19 à saisie** (13 modales + 6 popovers de formulaire).

### 1.11 Raccourcis clavier réellement implémentés

| Touche | Action | Source |
|--------|--------|--------|
| Ctrl/Cmd+Z ; Ctrl+Maj+Z ; Ctrl+Y | annuler / rétablir (désactivé hors Schéma et en MCD) | `hooks/editorKeyboardShortcuts.svelte.ts` |
| Ctrl+D | dupliquer la sélection | idem |
| Ctrl+C / Ctrl+V | copier / coller (presse-papiers système) | `hooks/canvasClipboard.svelte.ts` |
| Suppr / Retour arrière | supprimer sélection (point de passage d'abord) | `canvas/canvasDeleteKey.svelte.ts` |
| Ctrl+F | recherche de table | `canvas/canvasSearch.svelte.ts` |
| Echap | ferme menu contextuel / désarme l'outil / ferme recherche | `useEscapeKey` |
| Ctrl+J | tiroir SQL | `features/sql/sqlDrawer.svelte.ts` |
| Ctrl+P, Ctrl+Maj+P, Ctrl+S, Maj+Alt+F, Ctrl+Maj+M | dans l'éditeur DBML uniquement | `dbml/DbmlEditor/*` |
| Ctrl+Maj+P (hors éditeur) | HUD de performance | `components/dev/PerfHud.svelte` |
| Shift+1 | affiché, **non trouvé** (voir 1.4) | `CanvasZoomBar.svelte` |

`Ctrl+K` n'est lié à rien dans l'application (vérifié). Aucune touche d'outil (V, T, R...) n'existe. Aucune aide « raccourcis » n'existe en dehors d'une étape de la visite guidée (`tour.shortcuts.body`).

### 1.12 Dépendances externes à préserver

- `EditorTour.svelte` cible `.svelte-flow`, `.cm-editor`, `[data-testid="toggle-link-highlight"]` (avec `parent: true`), `[role="tablist"]`. Si C5 disparaît, **la visite guidée perd son étape « barre d'outils »**.
- Le harnais de bench (`BenchHarness.svelte`, script de bench mentionné dans le commentaire de `CanvasToolbar.svelte`) clique `toggle-link-highlight`.
- `RENDER_LOD_TABLE_THRESHOLD = 150` (`ProjectEditor.svelte` l. 14) : au-delà de 150 tables tout passe en « compact » à l'affichage ; l'inspecteur doit lire `liveProject`, pas `renderProject`, pour montrer le vrai niveau de détail.

---

## 2. Diagnostic chiffré

### 2.1 Compte des contrôles

| Zone | Permanents (interactifs) | Dans des menus | Indicateurs |
|------|--------------------------|----------------|-------------|
| Barre du projet | 13 | 0 | 3 |
| Barre de l'espace de travail | 11 (6 onglets + 5) | 0 | 1 (badge env, déjà compté dans les 5) |
| Pilule basse | 10 | 4 + 3 + N plugins (>= 2) | 0 |
| Pilule de zoom | 4 | 5 | 1 (pourcentage) |
| Panneau DBML | 4 | 0 | 2 |
| **Sous-total hors tables** | **42** | **>= 14** | **~6** |
| Par table (pire cas) | 10 (T1-T10) + pied | popover 300 px avec ~20 champs | - |
| Par colonne | 3 (R1, R2, R4) + R5 | popover avec ~14 champs | - |
| Par relation | 3 entrées (E1, E2, E5) | popover avec 8 sections | - |

Avant même d'avoir une table, l'utilisateur fait face à **42 contrôles permanents + 14 en menus = 56 points d'action**, dont 24 dans les deux barres du haut.

### 2.2 Problèmes constatés (avec preuve)

| # | Problème | Preuve | Gravité |
|---|----------|--------|---------|
| P1 | Deux barres empilées (56 px + ~46 px estimé) = ~100 px, soit ~12 % d'un écran 1366x768 avant tout contenu | `ProjectToolbar` + `WorkspaceBar` | haute |
| P2 | Actions de **projet** (Importer, Exporter, Convertir, Comparer) au même niveau visuel que l'action **primaire** (Déployer) : 5 boutons de poids équivalent | `ProjectToolbar.svelte` l. 79-86, 147-162 | haute |
| P3 | Sous 768 px, Importer/Exporter/Convertir/Comparer/Déployer **n'existent plus** (`hidden md:flex`) ; aucun repli | l. 148 | haute |
| P4 | Entre 768 et 1023 px, ces boutons sont des icônes sans nom accessible | l. 150-153 | moyenne |
| P5 | Annuler/Rétablir/Réorganiser visibles et actifs sur Données, Déploiements, Historique, Problèmes, Dictionnaire | `onUndo` appelle `undoManager` sans garde ; garde seulement sur le clavier (`ProjectEditor` l. 542) | moyenne (risque d'annuler une édition invisible) |
| P6 | « Réorganiser automatiquement » (action destructrice : déplace toutes les tables) à 1 clic, sans annulation explicite documentée, collée à Annuler/Rétablir | `historyActions` | moyenne |
| P7 | Réglages **d'affichage** (détail, liens, erreurs, minicarte, tracés) mélangés aux outils de **création** dans la même pilule | `CanvasToolbar.svelte` | moyenne |
| P8 | Détail (compact/standard/complet) est **global** alors que les nœuds portent `detailLevel` par table (`renderProject` le manipule table par table) : pas de réglage par table | `setAllDetailLevels`, `ProjectEditor` l. 436-450 | basse |
| P9 | Contexte de connexion éclaté en 4 éléments (sélecteur, badge d'environnement, « Mon compte SQL », bouton SQL) répartis entre deux barres | `WorkspaceBar.svelte` l. 65-110 | moyenne |
| P10 | En-tête de table : jusqu'à 9 icônes de 24 px pour un nœud de 190 px minimum ; **révélées au survol seulement** | `tableStyles.ts` l. 123-125 | haute |
| P11 | Propriétés de table et de colonne dans des **popovers de 300 px** : ouverture par un engrenage caché (survol), fermeture au clic extérieur et à tout mouvement de viewport (`useCloseOnViewportChange`) -> on perd sa saisie en zoomant/panant | `TableSettingsPanel.svelte` l. 63-66 | haute |
| P12 | Pas de menu clic droit sur une table, une colonne ou une sélection (`suppressNativeMenu`) alors qu'il existe pour le canvas vide et la relation | `CanvasArea.svelte` l. 393-394 | haute |
| P13 | Suppression de colonne sans confirmation ni annulation visible | `FieldEditorPanel.svelte` l. 205-215 | moyenne |
| P14 | Réordonnancement de colonnes uniquement à la souris (HTML5 drag) | `TableNodeRow.svelte` | moyenne (a11y) |
| P15 | Aucune palette de commandes globale ; la seule (`CommandPalette.svelte`) est enfermée dans l'éditeur DBML ; `PluginQuickPalette` ne contient que les plugins | `dbml/CommandPalette.svelte` | moyenne |
| P16 | Indication de raccourci `Shift+1` sans implémentation trouvée | 1.4 | basse (honnêteté de l'UI) |
| P17 | Verrous : le compteur est dans la barre haute mais la liste est une modale ; la gestion d'un verrou est une seconde modale | `TableLocksList`, `TableLockDialog` | moyenne |
| P18 | Largeur : aucune largeur minimale garantie du canvas quand DBML (largeur libre) + SQL (hauteur libre) sont ouverts ; aucun panneau de droite n'existe encore, l'ajouter naïvement aggraverait le problème | `DbmlPanel`, `Splitter` | à cadrer |

### 2.3 Contrastes (calculés à partir de `styles/tokens.css`, ratio WCAG)

| Paire | Ratio | Seuil | Verdict |
|-------|-------|-------|---------|
| `--color-text-muted` #656c82 sur `--color-surface` #13151f (sombre) | 3,48 | 4,5 (texte) | échec |
| idem sur `--color-surface-raised` #1a1d2b | 3,20 | 4,5 | échec |
| `--color-text-muted` #7d8296 sur `--color-surface` #fbfcfe (clair) | 3,72 | 4,5 | échec |
| idem sur `--color-bg-canvas` #eef0f4 | 3,34 | 4,5 | échec |
| `--color-border` #e2e5ec sur surface claire | 1,23 | 3 (composants UI) | échec |
| `--color-border-strong` #c7cbd6 sur surface claire | 1,58 | 3 | échec |
| `--color-border` #292d3f sur surface sombre | 1,33 | 3 | échec |
| grille `--color-canvas-grid` #33353c sur canevas sombre | 1,57 | décoratif | acceptable |
| `--color-text-secondary` #9ea5b8 sur surface sombre | 7,39 | 4,5 | ok |

Conséquences : tous les libellés secondaires (hints, compteurs, type de colonne `ROW_TYPE_CLASS`, raccourcis dans les menus, états désactivés) sont sous AA ; la séparation des barres et les bords de boutons sont quasi invisibles en thème clair. Cible : `--color-text-muted` >= 4,5:1 sur toutes les surfaces (valeurs de départ à valider : sombre `#8a91a8` ~5,6:1 sur `#13151f` ; clair `#5f657a` ~5,6:1 sur `#fbfcfe` - à recalculer avec le script de l'annexe), `--color-border-strong` >= 3:1 pour tout contour d'un contrôle interactif, focus visible 2 px `--color-primary` (déjà présent dans `canvasToolbarStyles.ts`). Le détail des tokens est du ressort de la section « design system » du plan ; on exige ici seulement les seuils.

---

## 3. Modèle d'interaction cible

### 3.1 Principes

1. **Le projet en haut, l'objet sur l'objet.** Header = navigation + 3 actions de projet. Tout ce qui agit sur table/colonne/relation/zone vit dans la barre flottante, le menu contextuel ou l'inspecteur.
2. **Une action, un seul modèle de définition.** Un registre de commandes (id, libellé, icône, raccourci, `quand(sélection)`, `exécuter`) alimente : menu Projet, barre flottante, menus contextuels, palette Ctrl+K, aide des raccourcis. Fini les 5 listes parallèles (`panelActions`, `TOOLS`, `items` de `CanvasContextMenu`, `EdgeContextMenu`, `attributeToggles`).
3. **Panneaux plutôt que popups** pour tout ce qui s'édite (propriétés, commentaires, verrous, index). Modales seulement pour : action lourde à flux propre (Importer, Exporter, Déployer, Données initiales, Comparer), confirmation destructrice, compte SQL.
4. **Rien n'est caché derrière le survol.** Toute action révélée au survol a un équivalent clavier et un équivalent tactile (sélection -> barre flottante).
5. **Défaire plutôt que confirmer.** Une suppression se fait sans modale et propose « Annuler » dans un toast (le composant `toast.svelte.ts` supporte déjà une action : voir `component-catalogue.e2e.ts` l. 173) ; Yjs `UndoManager` est déjà la source de vérité.
6. **Un mode à la fois, visible.** L'outil actif est toujours affiché (dock) et se quitte par Echap.
7. **Dégradation par priorité.** Primaire (toujours visible) -> secondaire (menu) -> rare (palette seulement).

### 3.2 Hiérarchie des actions de projet

| Niveau | Actions | Emplacement |
|--------|---------|-------------|
| Primaire (toujours visible) | Déployer (admin) ; changement d'onglet ; état de la base cible | header |
| Secondaire (1 clic dans un menu) | Importer, Exporter, Comparer, Convertir les types, Visite guidée, Raccourcis, Paramètres du projet/compte, Suivi des notifications, Retour aux projets | menu « Projet » (clic sur le nom) et menu avatar |
| Fréquent sur le canvas | Annuler, Rétablir, outils de création, zoom | dock bas / pilule zoom |
| Réglage d'affichage | détail, surlignage des liens, erreurs, minicarte, grille, tracés, MLD/MCD | menu « Affichage » (haut droite du canvas) |
| Rare (palette uniquement) | Réinitialiser tous les tracés, Réorganiser automatiquement, Gérer les plugins, Voir les tables verrouillées | Ctrl+K |

Décision sur Réorganiser (P6) : sort du header ; devient « Réorganiser les tables… » dans Affichage et palette, avec toast d'annulation. Décision sur Déployer : reste le seul bouton coloré du header, **adjacent** au chip de base cible pour qu'on sache toujours *où* on déploie (cf. e2e `environments`, qui ouvre la modale de déploiement).

### 3.3 Header cible (une seule barre, 48 px)

Contenu, de gauche à droite :

1. `[<]` retour aux projets (icône, `aria-label`).
2. **Nom du projet** + chevron : bouton qui ouvre le **menu Projet** ; pastille « Lecture seule » à côté si applicable.
3. **Onglets** Schéma | Données & SQL | Déploiements | Historique | Problèmes (badge) | Dictionnaire (mêmes conditions de visibilité qu'aujourd'hui, `workspaceTabs` dans `ProjectEditor.svelte` l. 234-249).
4. *(espace flexible)*
5. **Chip « Base cible »** : `[● Boutique-prod · Production v]`. Remplace W9 + W10 + W11. Son popover liste les connexions, affiche l'environnement (rouge si production), l'état de « Mon compte SQL » (point d'avertissement sur le chip tant que le compte n'est pas fourni) et propose « Gérer mon compte SQL ». Masqué s'il n'y a aucune connexion (sinon invitation discrète « Lier une base » pour les admins).
6. **Déployer** (primaire, admin) - toujours à droite du chip.
7. **Présence** (4 avatars max + « +N » ; clic sur un avatar = suivre/centrer sur son curseur, lot ultérieur).
8. **Cloche** (le suivi du projet `FollowMenu` passe dans son popover, pied « Suivre ce projet » ; à valider, voir question Q7).
9. **Avatar du compte** (menu : Paramètres, Visite guidée, Raccourcis clavier, Se déconnecter).

Indicateur de synchronisation : quitte le header, va dans la **barre d'état** (3.8) ; le header n'affiche qu'une pastille rouge discrète sur l'avatar de présence si la connexion est perdue (une erreur de synchro doit rester visible partout, d'où la double présence : barre d'état en détail, pastille en alerte).

**Largeur maximale et alignement.** La barre a un fond pleine largeur ; son contenu est dans un conteneur `max-w-[1680px] mx-auto px-4`. Sur un écran 2560 px le contenu du header ne s'étale donc pas. Le canvas reste pleine largeur (c'est un outil, pas une page). Les onglets non canvas (Problèmes, Dictionnaire, Historique, Déploiements, Données) limitent leur contenu à `max-w-[1280px]` centré sauf la grille de données (pleine largeur).

**Comportement en écran étroit** (largeur de la fenêtre) :

| Largeur | Header | Onglets | Autres |
|---------|--------|---------|--------|
| >= 1280 | complet | icône + libellé | tout visible |
| 1024-1279 | complet | icône + libellé pour l'onglet actif, icône seule + tooltip pour les autres | chip Base réduit à pastille d'environnement + nom tronqué (max 140 px) |
| 768-1023 | `[<] Nom v` ... `[Déployer][cloche icône][avatar]` | onglets repliés dans un sélecteur `Schéma v` (menu) à la place des onglets | présence masquée (accessible dans le menu avatar) ; chip Base dans le menu Projet |
| 640-767 | `[<] Nom v` ... `[⋯]` | sélecteur d'onglet | Déployer passe dans `⋯` ; Importer etc. restent dans le menu Projet (**corrige P3**) |
| < 640 | consultation seule | navigation du bas (5 icônes) | édition canvas désactivée (pas de dock ni d'inspecteur flottant) ; message « Ouvrez sur un écran plus large pour modifier » ; l'inspecteur devient une feuille plein écran en lecture |

### 3.4 Menu Projet (clic sur le nom du projet, `Alt+P`)

```
+--------------------------------------+
| Importer un schéma...         Ctrl+I |  <- modifications seulement (édition)
| Exporter...                   Ctrl+E |
| Comparer avec un autre projet...     |
| Convertir les types...               |
|--------------------------------------|
| Historique des versions              |  -> onglet Historique
| Voir les tables verrouillées (3)     |  -> ouvre l'inspecteur en mode Verrous
|--------------------------------------|
| Suivi des notifications       >      |  (si Q7 validée)
| Paramètres du projet...              |
| Raccourcis clavier            ?      |
| Visite guidée                        |
|--------------------------------------|
| Retour aux projets                   |
+--------------------------------------+
```

Notes : `Ctrl+I`/`Ctrl+E` sont proposés mais `Ctrl+I` ouvre « Informations » dans Firefox ; à arbitrer (Q5). Les entrées d'écriture (Importer, Convertir) sont **absentes** en lecture seule, comme aujourd'hui (la logique `viewOnly` de `ProjectToolbar` l. 79-86 est conservée). Les modales ouvertes sont inchangées (`ImportDialog`, `ExportDialog`, `CompareProjectsModal`, `ConvertTypesModal`) : lot 1 ne fait que changer leur point d'entrée.

### 3.5 Dock d'outils et modes

Pilule flottante en bas au centre (remplace `CanvasToolbar`) : **9 contrôles**.

```
 [ V Sélection ][ H Main ] | [ T Table ][ R Relation ][ Z Zone ][ N Note ][ E Enum ] | [ <- ][ -> ]
```

| Outil | Touche | Comportement |
|-------|--------|--------------|
| Sélection | `V` | défaut ; clic, lasso (déjà `lassoSelection.ts`), déplacement |
| Main | `H` ou `Espace` maintenu | pan au clic gauche (aujourd'hui pan = boutons 1 et 2 uniquement, `panOnDrag={[1, 2]}`) |
| Table | `T` | **armé comme aujourd'hui** (`activeInsertTool`) : un clic pose une table et la met en saisie du nom ; reste armé ; Echap/`V` sort |
| Relation | `R` | nouveau. Curseur en croix ; clic sur une colonne source (surlignée), puis clic sur la colonne cible -> crée la relation (réutilise `mutations.onConnect`, qui prend des ids de poignées `${fieldId}-right-source` ; voir `projectMutations.ts` l. 275-283). Echap annule la sélection de source. Le glisser depuis une poignée reste possible dans tous les modes |
| Zone | `Z` | armé ; clic = pose, glisser = trace la taille (extension de l'existant) |
| Note | `N` | armé ; clic pose une note en édition |
| Enum | `E` | armé ; clic pose une énumération en édition du nom |
| Annuler / Rétablir | `Ctrl+Z`, `Ctrl+Maj+Z` | désactivés (grisés) hors onglet Schéma et en MCD |

États : outil actif = fond `primary` + `aria-pressed="true"` ; l'outil actif est rappelé par un libellé flottant près du curseur (« Table - cliquer pour poser, Echap pour finir ») pendant les 3 premières utilisations seulement (compteur dans `localStorage`, try/catch).
Le dock **disparaît** en lecture seule (seuls zoom et Affichage restent) - comme `canWrite` masque le groupe d'insertion aujourd'hui.
Le dock se replie en pastille « Outils » sous 900 px de large de canvas.

### 3.6 Menu « Affichage » (haut droite du canvas)

Un seul bouton `Affichage v` (icône œil) en haut à droite du canvas ; popover (pas modale) :

```
+------------------------------------------+
| Vue            [ MLD | MCD ]              |
| Niveau de détail [Compact|Standard|Complet] (toutes les tables)  |
|------------------------------------------|
| [x] Surligner les liens                    |
| [x] Afficher les erreurs de schéma         |
| [ ] Minicarte                       M      |
| [ ] Aligner sur la grille                  |
|------------------------------------------|
| Réorganiser les tables...                  |
| Réinitialiser le tracé des liens           |
| Plugins >  (commandes de plugins)          |
+------------------------------------------+
```

Reprend C1, C2, C4, C5, C6, C7, C8, C10, H6. `Rechercher` (C9) : `Ctrl+F` (surlignage sur le canvas, conservé) et `Ctrl+K` (aller à) couvrent la recherche (3.7) ; le bouton disparaît, l'entrée « Rechercher une table » existe dans la palette. Le basculement MLD/MCD reste *aussi* un segment visible en haut à gauche du canvas (un changement de mode ne doit pas être caché dans un menu) : `[ MLD | MCD ]`, 2 boutons.

Détail par table : l'inspecteur de table expose un sélecteur « Détail de cette table » (compact / standard / complet / suivre le réglage global) ; dépend d'une évolution du modèle (Q4).

### 3.7 Palette de commandes `Ctrl+K`

Surcouche centrée (largeur 560 px, `role="dialog"` + `combobox`), unique pour le projet. Sections ordonnées, filtrage flou :

1. **Récents** (5 dernières commandes/objets).
2. **Aller à** : tables, colonnes (`table.colonne`), enums, zones (réutilise l'index de `useCanvasSearch` et `dbml/symbols.ts`) ; Entrée = centrer + sélectionner.
3. **Actions** : toutes les commandes du registre valides pour la sélection courante (« Ajouter une colonne », « Dupliquer », « Verrouiller... », « Importer... »).
4. **Affichage** : bascules du menu Affichage.
5. **Onglets** : « Aller à Problèmes », etc.
6. **Plugins** : `canvasCommands` (remplace l'accès par `PluginMenu`/`PluginQuickPalette`, dont le champ « Rechercher une action ou un plugin... » est testé dans `plugins-locks.e2e.ts` l. 75).
Préfixes : `>` actions seules, `@` objets seuls, `#` onglets. Les raccourcis s'affichent à droite. La palette interne à l'éditeur DBML (`Ctrl+Maj+P`) est conservée *dans* l'éditeur, inchangée ; `Ctrl+K` ouvre la palette projet depuis partout, éditeur DBML compris (un handler dans la keymap CodeMirror). On ne lie pas `Ctrl+Maj+P` hors éditeur : il est déjà pris par le HUD de performance (`components/dev/PerfHud.svelte`).

### 3.8 Barre d'état (bas du canvas, 28 px, onglet Schéma)

```
 [● Synchronisé]  [L 3 verrouillées]  [⚠ 5 problèmes]  [Ligne 12]            [DBML ◧]  [SQL ▲ Ctrl+J]
```
(ASCII réel : `*`, `[L]`, `[!]`.) Contenu : état de synchro (remplace H12 ; devient rouge et cliquable « Reconnecter » si coupé), nombre de tables verrouillées -> ouvre l'inspecteur en mode « Verrous » (remplace W7 et la modale `TableLocksList`), nombre de problèmes -> onglet Problèmes (même source que le badge, `quality.findings.length`), bascule panneau DBML, bascule tiroir SQL (remplace W8, garde `Ctrl+J`). Le bouton SQL n'apparaît que si `canUseSql`, comme aujourd'hui.

### 3.9 Barre flottante de sélection (contextuelle)

Ancrée **au-dessus de l'objet sélectionné** (Svelte Flow fournit `NodeToolbar` pour les nœuds ; pour une sélection multiple, ancrage au-dessus de la boîte englobante, à l'emplacement de `SelectionColorToolbar`). Disparaît pendant un déplacement, un zoom rapide (< 0,35) et en lecture seule (sauf « Voir les données » / « Commenter »). Contenu par type :

| Sélection | Boutons (icône + tooltip + raccourci) | Plus (`...`) |
|-----------|----------------------------------------|--------------|
| 1 table | Couleur (pastille -> 15 couleurs) \| + Colonne `C` \| Dupliquer `Ctrl+D` \| Voir les données (si SQL) \| Commenter (compteur) \| Verrouiller (état) | menu contextuel complet de la table |
| 1 colonne | Type (chip éditable) \| PK \| UQ \| NN \| AI (bascules) \| Relation `R` \| Commenter | menu contextuel de la colonne |
| 1 relation | Cardinalité (chip -> 4 choix) \| Inverser \| Couleur \| Supprimer | menu relation |
| 2+ tables | Couleur \| Grouper `Ctrl+G` \| Dupliquer \| Aligner > \| Supprimer | verrouiller, copier |
| zone / note / groupe | Couleur \| Renommer `F2` \| Supprimer / Dégrouper | |

La barre contextuelle est **redondante avec l'inspecteur par construction** (mêmes commandes du registre) : c'est un raccourci, jamais la seule voie.

### 3.10 En-tête de table allégé

Le nœud ne contient plus que : **nom** + **états au repos** + **« ... » au survol ou à la sélection**.

```
+-----------------------------------+
| users        [L][D][!2][c3] [...] |   <- états au repos : verrou, données, problèmes, commentaires ; [...] au survol / à la sélection
+-----------------------------------+
```
Règles : au plus **4 pictogrammes d'état** (verrou, données initiales, problèmes, commentaires) de 16 px, non interactifs au survol seul, **cliquables** (ouvrent la section correspondante de l'inspecteur) ; **1 bouton `...`** (24 px) qui ouvre le menu contextuel table. Largeur occupée au pire : 4 x 16 + 24 + gaps ~ 100 px (contre 240 px aujourd'hui). Le pied « + Ajouter une colonne » est conservé (T11) : c'est la création en ligne la plus découvrable.

### 3.11 Inspecteur (panneau latéral droit)

**Rôle** : propriétés et actions détaillées de la sélection ; remplace `TableSettingsPanel`, `FieldEditorPanel`, `EdgeSettingsPopover`, les popovers de couleur zone/note, `CommentThread` (table et colonne), `TableLocksList`, `TableLockDialog`, et héberge l'accès à `SeedDialog`.

Spécifications :
- Largeur 320 px par défaut, 280-420 px redimensionnable (poignée `Splitter` existante, orientation verticale à vérifier : `Splitter.svelte` gère `edge="top"` ; prévoir `edge="left"`), mémorisée par utilisateur (clé `localStorage` avec try/catch).
- Ouverture : touche `I`, bouton de la barre d'état, ou clic sur un pictogramme d'état. Option « Ouvrir à la sélection » (par défaut **oui** au premier lancement, désactivable ; la préférence suit `utils/preferences.ts`).
- Fermeture : `X`, `Echap` quand le focus est dans l'inspecteur, ou `I`.
- Etat vide (rien de sélectionné) : carte « Projet » : nombre de tables / relations / enums, problèmes (3 premiers, lien vers l'onglet), verrous, base cible, + trois boutons « Ajouter une table », « Importer », « Coller du DBML ».
- Largeur minimale garantie du canvas : **520 px**. Si `fenêtre - DBML - inspecteur < 520`, l'inspecteur passe en **mode flottant** (superposé à droite du canvas, ombre, bouton « épingler » pour réserver la place) ; si même ainsi le canvas < 360, le DBML se replie en rail.
- Aucun contenu n'est perdu en cas de zoom/pan (contrairement aux popovers : P11) ; chaque champ se valide à la perte de focus ou `Entrée`, `Echap` annule le champ en cours (comportement de `useDraftValue` conservé).

Contenu par type de sélection :

**Table** (sections repliables, état de repli mémorisé) :
1. *Identité* : Nom (verrouillé si `structureLocked`), Note (texte), Couleur d'en-tête (15 pastilles + hex), Détail de cette table.
2. *Colonnes* (liste dense, une ligne = poignée, nom, type, 4 mini-bascules PK/UQ/NN/AI, `x`) : clic = sélectionne la colonne ; double-clic = renomme ; glisser = réordonne ; `+ Colonne` en pied avec focus immédiat.
3. *Index* (n) : liste `IndexRow`, bouton `+ Index` ouvre la ligne `AddIndexForm` en place (plus de formulaire popover).
4. *Relations* : liste « sortantes / entrantes » (table.colonne -> table.colonne, cardinalité) ; clic = sélectionne la relation.
5. *Verrou* : état, niveau, raison, par qui ; bouton « Verrouiller... » -> formulaire **en place** (niveau + raison + confirmer) ; remplace `TableLockDialog` (146 lignes) tant que le serveur garde la même API.
6. *Données* : « Voir les données » (si SQL), « Données initiales » (ouvre `SeedDialog` - reste modale, flux lourd : tableau CSV, 419 lignes), badge du nombre de lignes.
7. *Commentaires* : fil de la table + saisie ; badge dans le titre de section.
8. Pied : Dupliquer, Supprimer la table (danger, avec toast d'annulation).

**Colonne** : Nom ; Type (champ avec suggestions ; remplace `FieldEditorPanel` type + suggestions) ; Attributs (4 interrupteurs libellés, `Switch.svelte` existe) ; Valeur par défaut ; Note ; *Relation* (si FK : table cible, cardinalité, ON DELETE, ON UPDATE, « Voir la relation ») ou bouton « Créer une relation... » (active l'outil `R` avec cette colonne comme source) ; Commentaires de la colonne ; pied : Supprimer (toast d'annulation).

**Relation** : de -> vers (liens cliquables), Cardinalité, ON DELETE, ON UPDATE, Couleur (15 + « par défaut »), Tracé (« Réinitialiser le tracé », nombre de points), Inverser le sens, Supprimer. (Contenu = `EdgeSettingsPopover` actuel sans changement de logique.)

**Enum** : nom, liste de valeurs éditable (ajout/suppression/réordonner), où elle est utilisée (colonnes utilisant ce type).
**Zone / Note** : texte/nom, couleur, `Envoyer à l'arrière`.
**Groupe** : nom, tables membres, Dégrouper.
**Sélection multiple** (n tables) : résumé « 4 tables », Couleur (appliquée à toutes), Détail, Grouper, Aligner (haut/milieu/bas, gauche/centre/droite, répartir), Dupliquer, Verrouiller..., Supprimer.
**Mode Verrous** (depuis la barre d'état) : liste des tables verrouillées (remplace `TableLocksList`), clic = centre + sélectionne.

### 3.12 Menus contextuels (clic droit, touche Menu, `Maj+F10`, appui long tactile)

Un seul composant `ContextMenu` alimenté par le registre. Positionnement : `menuPlacement` (existant dans `CanvasContextMenu`). Le pan au bouton droit est conservé (tolérance 3 px, `CONTEXT_MENU_DRAG_TOLERANCE_PX`) ; le menu n'apparaît que sur clic sans glisser. Chaque menu est `role="menu"` avec navigation par flèches (à ajouter : les menus actuels n'ont pas de gestion des flèches - vérifié dans `CanvasContextMenu.svelte`, uniquement des `<button>`).

| Cible | Entrées (dans l'ordre) |
|-------|------------------------|
| **Canvas vide** | Ajouter une table ici `T` ; Ajouter une zone `Z` ; Ajouter une note `N` ; Ajouter une énumération `E` ; ---- ; Coller ici `Ctrl+V` ; Tout sélectionner `Ctrl+A` ; ---- ; Importer un schéma... ; Ajuster à la vue ; Réorganiser les tables... |
| **Table** | Renommer `F2` ; Ajouter une colonne `C` ; ---- ; Dupliquer `Ctrl+D` ; Copier `Ctrl+C` ; Couleur > ; Détail > ; ---- ; Voir les données ; Données initiales... ; Aller au DBML ; Commenter ; Verrouiller... ; ---- ; Grouper la sélection `Ctrl+G` (si >= 2) ; Centrer sur la table ; Supprimer `Suppr` |
| **Colonne** | Renommer `F2` ; Type > (int, bigint, varchar, text, boolean, timestamp, uuid, ...) ; Clé primaire [x] ; Unique [x] ; Non nul [x] ; Auto-incrément [x] ; ---- ; Créer une relation vers... `R` ; Ajouter une note ; Commenter ; ---- ; Monter `Alt+Haut` ; Descendre `Alt+Bas` ; Dupliquer la colonne ; Copier le nom ; ---- ; Supprimer |
| **Relation** | Options (ouvre l'inspecteur) ; Cardinalité > ; ON DELETE > ; ON UPDATE > ; Couleur > ; Inverser le sens ; ---- ; Insérer un point ; Réinitialiser le tracé ; Aller à la colonne source / cible ; ---- ; Supprimer |
| **Point de passage** | Supprimer le point ; Réinitialiser le tracé |
| **Zone** | Renommer ; Couleur > ; Sélectionner son contenu ; Envoyer à l'arrière ; Supprimer |
| **Note** | Modifier ; Couleur > ; Supprimer |
| **Groupe** | Renommer ; Dégrouper ; Sélectionner les tables ; Supprimer le groupe |
| **Enum** | Renommer ; Ajouter une valeur ; Supprimer |
| **Sélection multiple** | Grouper `Ctrl+G` ; Couleur > ; Aligner > ; Dupliquer ; Copier ; Verrouiller... ; Supprimer |

Les entrées d'écriture sont retirées (pas grisées) en lecture seule ; les entrées impossibles pour cause de verrou sont **grisées avec la raison** en tooltip (« Table verrouillée par X »), ce qui reprend `lockNote` de `TableNode.svelte`.

### 3.13 Raccourcis clavier cible

Principe : touches simples (sans modificateur) uniquement quand le focus est sur le canvas (`isTypingTarget` de `canvasSearch.svelte.ts` est réutilisé pour ne jamais voler une saisie), jamais dans l'éditeur DBML (`.cm-editor`).

| Touche | Action | Statut |
|--------|--------|--------|
| `Ctrl+K` | palette de commandes | nouveau |
| `?` ou `F1` | aide des raccourcis (feuille) | nouveau |
| `V` / `H` / `T` / `R` / `Z` / `N` / `E` | outils | nouveau |
| `Echap` | quitte l'outil -> désélectionne -> ferme le panneau flottant (cascade) | étendu |
| `Ctrl+Z`, `Ctrl+Maj+Z`, `Ctrl+Y` | annuler / rétablir | existant |
| `Ctrl+D` | dupliquer | existant |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | copier / couper / coller | existant (`Ctrl+X` nouveau) |
| `Suppr` / `Retour arrière` | supprimer | existant |
| `Ctrl+A` | tout sélectionner | nouveau |
| `Ctrl+G` / `Ctrl+Maj+G` | grouper / dégrouper | nouveau |
| `F2` | renommer l'objet sélectionné | nouveau |
| `C` | ajouter une colonne (table sélectionnée) | nouveau |
| `Entrée` | table sélectionnée : entre dans ses colonnes (focus 1re colonne) ; colonne : renommer ; dans le dernier champ de nom : ajoute une colonne | nouveau |
| `Tab` / `Maj+Tab` | objet suivant / précédent (ordre : nom de table alphabétique) ; dans l'inspecteur : champ suivant | nouveau |
| Flèches | déplacent la sélection (voisin le plus proche) ; avec `Maj` étendent ; avec `Alt` déplacent la colonne (Haut/Bas) ou la table (pas de grille) | nouveau |
| `Ctrl+F` | rechercher une table | existant |
| `Ctrl+J` | tiroir SQL | existant |
| `I` | inspecteur | nouveau |
| `M` | minicarte | nouveau |
| `Maj+1` / `Maj+2` / `Ctrl+0` / `Ctrl+=` / `Ctrl+-` | ajuster tout / ajuster à la sélection / 100 % / zoom + / zoom - | `Maj+1` à implémenter (aujourd'hui affiché sans code) |
| `Maj+F10` / touche Menu | menu contextuel de l'objet focalisé | nouveau |
| `Alt+P` | menu Projet | nouveau |

Conflits vérifiés : `Ctrl+Maj+P` est pris par le HUD de performance (dev) hors éditeur DBML -> la palette projet utilise `Ctrl+K` seulement. `Ctrl+D` (favori du navigateur), `Ctrl+J` (téléchargements), `Ctrl+G` (rechercher suivant) exigent `preventDefault` ; le code actuel le fait pour `Ctrl+D`/`Ctrl+J`.

---

## 4. Schémas des écrans

Légende : `[...]` bouton ; `{...}` champ ; `(*)` sélectionné ; `<>` poignée ; largeur de référence 150 colonnes = fenêtre 1440 px.

### 4.1 Etat normal (rien de sélectionné, DBML ouvert, inspecteur ouvert sur l'état vide)

```
+----------------------------------------------------------------------------------------------------------------------------------------------+
| [<] Boutique v [Lecture seule]  Schéma | Données & SQL | Déploiements | Historique | Problèmes(5) | Dictionnaire      [Prod v][Déployer] (JD)(MA)(+2) [cloche] (ZG) |  48 px
+------------------------+---------------------------------------------------------------------------------------+-----------------------------+
| DBML            [?][>_][F][<]|  [ MLD | MCD ]                                                [Affichage v]  |  PROJET                     |
|----------------------------| .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . |  12 tables - 14 relations   |
| 1 Table users {            | .  +-----------------+          +--------------------+                      .  |  2 enums                    |
| 2   id int [pk]            | .  | users      [!2] |          | orders         [..]|                      .  |                             |
| 3   email varchar          | .  |-----------------|   *----->|--------------------|                      .  |  Problèmes (5)              |
| 4 }                        | .  | id        int   |          | id          int    |                      .  |  ! orders.total sans type   |
| 5 Table orders {           | .  | email  varchar  |          | user_id  int  FK   |                      .  |  ! users sans clé primaire  |
| ...                        | .  | + Ajouter...    |          | + Ajouter...       |                      .  |  Voir tous ->               |
|                            | .  +-----------------+          +--------------------+                      .  |                             |
|                            | .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . |  Base : boutique-prod       |
|                            |                                                                                      |  [Ajouter une table]        |
|                            |  [-] 100% [+] [fit]      [V][H] | [T][R][Z][N][E] | [<-][->]                            |  [Importer]  [Coller DBML]  |
+----------------------------+---------------------------------------------------------------------------------------+-----------------------------+
| [*] Synchronisé   [L] 3 verrouillées   [!] 5 problèmes                                      [DBML <>]  [SQL ^ Ctrl+J]  [Inspecteur I]        | 28 px
+----------------------------------------------------------------------------------------------------------------------------------------------+
```
Le chrome vertical passe de ~100 px à 48 + 28 = 76 px, dont la barre d'état est **en bas** (le haut perd ~52 px).
Gauche : DBML (largeur libre, défaut actuel). Centre : canvas (minimum 520 px). Droite : inspecteur 320 px. A 1440 px de large : 1440 - 420 (DBML) - 320 = 700 px de canvas.

### 4.2 Une table sélectionnée

```
+----------------------------------------------------------------------------------------------------------------------------------------------+
| [<] Boutique v   Schéma(*)| Données & SQL | ...                                       [Prod v][Déployer] (JD)(MA) [cloche] (ZG)                    |
+------------------------+---------------------------------------------------------------------------------------+-----------------------------+
| DBML                   |  [ MLD | MCD ]                                                [Affichage v]           |  TABLE  users          [x]  |
|                        |                                                                                      |-----------------------------|
|                        |        [#][+Col][Dupl][Données][Comm 2][L][...]      <- barre flottante              |  v Identité                 |
|                        |        +------------------------+                                                    |   Nom   {users           }  |
|                        |        | users        [!2][c2][...]|  <- bord primaire, 2 px                         |   Note  {Les clients...  }  |
|                        |        |------------------------|                                                    |   Couleur (#)(#)(#)(#)...    |
|                        |        | id           int   PK   |                                                    |   Détail {Suivre global v}  |
|                        |        | email     varchar UQ NN |                                                    |  v Colonnes (4)    [+ Colonne]|
|                        |        | created_at timestamp    |                                                    |   <> id          int  P U N A x|
|                        |        | + Ajouter une colonne   |                                                    |   <> email   varchar  . U N . x|
|                        |        +------------------------+                                                    |   <> created_at ts    . . . . x|
|                        |                                                                                      |  > Index (1)                |
|                        |                                                                                      |  > Relations (2)            |
|                        |                                                                                      |  > Verrou                   |
|                        |                                                                                      |  > Données                  |
|                        |                                                                                      |  > Commentaires (2)         |
|                        |                                                                                      |  [Dupliquer]  [Supprimer]   |
+------------------------+---------------------------------------------------------------------------------------+-----------------------------+
```

### 4.3 Une colonne sélectionnée

```
                        |        +------------------------+      barre flottante :                             |  COLONNE  users.email  [x]  |
                        |        | users              [...]|      [varchar v][PK][UQ*][NN*][AI][Relation][Comm] |-----------------------------|
                        |        |------------------------|                                                    |  Nom     {email           }  |
                        |        | id           int   PK   |                                                    |  Type    {varchar(255)  v }  |
                        |        |(*)email   varchar UQ NN |  <- ligne cerclée primaire, poignées visibles      |  Attributs                  |
                        |        | created_at timestamp    |                                                    |   Clé primaire        [ o  ]|
                        |        +------------------------+                                                    |   Unique              [  o*]|
                        |                                                                                      |   Non nul             [  o*]|
                        |                                                                                      |   Auto-incrément      [ o  ]|
                        |                                                                                      |  Défaut {              }    |
                        |                                                                                      |  Note   {Adresse de... }    |
                        |                                                                                      |  Relation                   |
                        |                                                                                      |   (aucune)  [Créer... R]    |
                        |                                                                                      |  Commentaires (0)           |
                        |                                                                                      |  [Supprimer la colonne]     |
```
Pour une colonne FK, la section « Relation » montre `-> users.id`, cardinalité, ON DELETE / ON UPDATE et le lien « Voir la relation ».

### 4.4 Sélection multiple (3 tables)

```
                        |   [3 tables][Couleur (#) v][Grouper][Aligner v][Dupliquer][Supprimer]   <- au-dessus de la boîte englobante
                        |      +--------+          +----------+          +---------+                            |  3 TABLES SÉLECTIONNÉES [x] |
                        |      | users  |          | orders   |          | items   |   (cadre pointillé)        |-----------------------------|
                        |      +--------+          +----------+          +---------+                            |  users, orders, items       |
                        |                                                                                      |  Couleur  (#)(#)(#)(#)(#)    |
                        |                                                                                      |  Détail   [Compact|Std|Complet]|
                        |                                                                                      |  Aligner  [|=][=|][=|=] ...    |
                        |                                                                                      |  [Grouper "Nouveau groupe"] |
                        |                                                                                      |  [Dupliquer] [Verrouiller...]|
                        |                                                                                      |  [Supprimer 3 tables]       |
```
Reprend S1 (`SelectionColorToolbar`) : la grille de 15 pastilles ne flotte plus au centre du canvas, elle vit dans l'inspecteur ; la barre flottante n'a qu'un bouton Couleur.

### 4.5 Plusieurs panneaux ouverts (DBML + canvas + inspecteur + tiroir SQL + historique d'aperçu), écran 1280 px

```
+--------------------------------------------------------------------------------------------------------------------+
| [<] Boutique v   Schéma(*)| Données | Déploiem. | Historique | Problèmes(5) | Dict.        [Prod v][Déployer] (JD) [cloche] (ZG)|
+--------------------------------------------------------------------------------------------------------------------+
| Aperçu de la version du 12/09 - 3 tables modifiées                         [Retour à l'historique] [Fermer l'aperçu] |  <- HistoryPreviewBanner (existant)
+----------------------+-------------------------------------------------------+-------------------------------------+
| DBML 360 px          |  [MLD|MCD]                          [Affichage v]     |  TABLE users              [x]       |
|                      |  (canvas 520 px minimum)                               |  ... (inspecteur 400 px)            |
|                      |        +----------+   +----------+                     |                                     |
|                      |        | users    |-->| orders   |                     |                                     |
+----------------------+--------+----------+---+----------+---------------------+-------------------------------------+
|=== splitter (existant Splitter.svelte) ======================================================================== ^v ===|
| SQL - boutique-prod                                                                       [Exécuter Ctrl+Entrée]    |
| SELECT * FROM users LIMIT 100;                                                                                      |
+--------------------------------------------------------------------------------------------------------------------+
| [*] Synchronisé   [L] 3   [!] 5                                                      [DBML <>] [SQL v] [Inspecteur] |
+--------------------------------------------------------------------------------------------------------------------+
```
Règle de priorité en cas de manque de place (largeur du canvas < 520 px) : (1) l'inspecteur passe en flottant épinglable, (2) le DBML se replie en rail de 40 px (les trois états du panneau : ouvert / rail / masqué), (3) sous 360 px de canvas, un seul panneau latéral est ouvert à la fois (le dernier ouvert gagne) et un toast l'indique une fois. Hauteur : le tiroir SQL garde sa limite (`SqlDrawerState.MIN_HEIGHT/MAX_HEIGHT`) ; le canvas garde 240 px de hauteur minimum.

### 4.6 Header cible, états

Large (>= 1280) :
```
[<] Boutique v [Lecture seule]   [#] Schéma | [db] Données & SQL | [>] Déploiements | [h] Historique | [!] Problèmes 5 | [b] Dictionnaire      [* Prod-livraison · Production v] [ Déployer ]  (JD)(MA)(+2)  [cloche]  (ZG v)
```
Moyen (1024-1279) :
```
[<] Boutique v   [#] Schéma | [db] | [>] | [h] | [!] 5 | [b]            [* Prod v] [Déployer]  (JD)(MA)  [cloche] (ZG v)
```
Etroit (768-1023) :
```
[<] Boutique v   [ Schéma v ]                                                              [Déployer] [cloche] (ZG v)
```
Mobile (< 768) :
```
[<] Boutique v                                                                                          [ ... ]
(consultation seule ; navigation d'onglets en barre basse : Schéma | Données | Problèmes | Historique | Plus)
```
Hiérarchie : primaire = Déployer (seul élément plein couleur) ; secondaire = chip Base, menu Projet, avatar ; rare = tout le reste via menus/palette. **Compte final : 6 contrôles interactifs** hors onglets (retour, menu Projet, chip Base, Déployer, cloche, avatar) + la présence (indicateur) + 6 onglets ; barre unique de 48 px.

---

## 5. Table « contrôle actuel -> nouvel emplacement »

Légende emplacements : **Header** (barre unique), **Menu Projet**, **Menu avatar**, **Chip Base**, **Dock**, **Zoom**, **Affichage**, **Barre d'état**, **Flottante** (barre contextuelle), **CTX** (menu clic droit), **Insp.** (inspecteur), **Palette** (Ctrl+K), **Modale** (conservée).

| Contrôle actuel (fichier) | Nouvel emplacement | Raccourci | Clics (avant -> après) |
|---------------------------|--------------------|-----------|-------------------------|
| H1 Retour (`ProjectToolbar`) | Header (inchangé) | - | 1 -> 1 |
| H2 Nom du projet | Header : devient bouton du menu Projet | `Alt+P` | - -> 1 |
| H3 Pastille lecture seule | Header, à côté du nom | - | - |
| H4 Annuler | Dock (+ `Ctrl+Z`) ; grisé hors Schéma | `Ctrl+Z` | 1 -> 1 |
| H5 Rétablir | Dock | `Ctrl+Maj+Z` | 1 -> 1 |
| H6 Réorganiser automatiquement | Affichage + Palette (avec toast d'annulation) ; menu CTX canvas vide | - | 1 -> 2 |
| H7 Importer | Menu Projet + CTX canvas vide + Palette + glisser-déposer d'un fichier sur le canvas (lot 9) ; modale `ImportDialog` conservée | `Ctrl+I`? (Q5) | 1 -> 2 |
| H8 Exporter | Menu Projet + Palette ; modale `ExportDialog` conservée | `Ctrl+E`? | 1 -> 2 |
| H9 Convertir les types | Menu Projet + Palette ; modale conservée | - | 1 -> 2 |
| H10 Comparer | Menu Projet + Palette ; modale conservée | - | 1 -> 2 |
| H11 Déployer | Header, bouton primaire à droite du chip Base | - | 1 -> 1 |
| H12 Indicateur connexion | Barre d'état (détail) + pastille d'alerte sur l'avatar | - | - |
| H13 Présence | Header (4 + « +N ») | - | - |
| H14 Suivre (`FollowMenu`) | Menu Projet > Suivi des notifications (ou pied de la cloche, Q7) | - | 2 -> 2 |
| H15 Cloche | Header (inchangée) | - | 1 -> 1 |
| H16 Visite guidée | Menu avatar + Menu Projet | - | 1 -> 2 |
| H17 Paramètres | Menu avatar (`SettingsModal` conservée) | - | 1 -> 2 |
| W1-W6 Onglets | Header (même barre) ; repli en sélecteur < 1024 px | `Alt+1..6` | 1 -> 1 |
| W7 Compteur de verrous + `TableLocksList` | Barre d'état -> Inspecteur mode Verrous | - | 2 -> 2 |
| W8 Bouton SQL | Barre d'état (SQL ^) | `Ctrl+J` | 1 -> 1 |
| W9 Badge d'environnement | Chip Base | - | - |
| W10 Mon compte SQL | Chip Base (popover) ; avertissement sur le chip tant que manquant ; modale `PersonalAccountDialog` conservée | - | 1 -> 2 |
| W11 Sélecteur de connexion | Chip Base (popover) | - | 2 -> 2 |
| C1/C2 MLD / MCD | Canvas haut gauche (segment) + Affichage | - | 1 -> 1 |
| C3 Menu Insérer (4 outils) | Dock (5 boutons directs : T, R, Z, N, E) | `T R Z N E` | 2 + 1 -> 1 + 1 |
| C4 Détail global | Affichage ; Insp. (par table) | - | 2 -> 2 |
| C5 Surligner les liens | Affichage (case) ; **conserver `data-testid="toggle-link-highlight"`** sur la case | - | 1 -> 2 |
| C6 Erreurs de schéma | Affichage (case) ; **conserver `data-testid="toggle-validation-issues"`** | - | 1 -> 2 |
| C7 Réinitialiser le tracé des liens | Affichage + Palette ; CTX relation (pour une seule) | - | 1 -> 2 |
| C8 Minicarte | Affichage (case) | `M` | 1 -> 1 clavier / 2 souris |
| C9 Rechercher une table | Palette (« Aller à ») et `Ctrl+F` (surlignage sur le canvas, conservé) | `Ctrl+F`, `Ctrl+K` | 1 -> 0 clavier |
| C10 Menu Plugins | Affichage > Plugins + Palette (section Plugins) ; « Gérer les plugins » dans Palette | - | 2 -> 2 |
| Z1-Z3 Zoom (-, %, +) | Zoom (pilule bas gauche, inchangée) ; raccourcis ajoutés | `Maj+1`, `Ctrl+0`, `Ctrl+=`, `Ctrl+-` | inchangé |
| Z4 Ajuster (icône doublon de l'entrée du menu %) | absorbé par le menu % (Ajuster, Ajuster à la sélection, 50/100/200 %) et `Maj+1` | `Maj+1` | 1 -> 2 ou 0 au clavier |
| S1 Barre de couleur multi-sélection + Grouper | Flottante (Couleur, Grouper) + Insp. (multi) | `Ctrl+G` | 1 -> 1 |
| S2 Panneau de recherche | Conservé pour `Ctrl+F` (surlignage), alimenté par le même index que la Palette | `Ctrl+F` | inchangé |
| S3 Bandeau de statut transitoire | Toast centré bas (composant `toast`) | - | - |
| T1 Nom de table | inchangé (double-clic) + `F2` | `F2` | 2 -> 1 |
| T2 Cadenas | Pictogramme d'état (cliquable -> Insp. Verrou) | - | 1 -> 1 |
| T3 Données initiales (présentes) | Pictogramme d'état (-> Insp. Données) | - | 1 -> 1 |
| T4 Problèmes | Pictogramme d'état (-> section Problèmes de l'Insp.) | - | 0 -> 1 |
| T5 Aller au DBML | CTX table + Flottante `...` + Palette | - | 1 survol -> 2 |
| T6 Voir les données | Flottante (bouton direct) + CTX + Insp. Données ; **libellé « Voir les données » conservé** | - | 1 survol -> 1 (table sélectionnée) |
| T7 Données initiales (ajout) | Insp. Données + CTX | - | 1 -> 2 |
| T8 Verrouiller la table… | Flottante + CTX + Insp. Verrou (formulaire en place) | - | 1 survol -> 1 |
| T9 Commentaires de la table | Flottante (compteur) + Insp. Commentaires | - | 1 -> 1 |
| T10 Paramètres de la table (popover) | Insp. Table (Identité, Index, Couleur, Dupliquer) | `I` | 1 -> 0-1 |
| T11 + Ajouter une colonne | conservé dans le nœud + `C` + Insp. | `C` | 1 -> 1 |
| R1 Grip de réordonnancement | conservé (pointeur) + `Alt+Haut/Bas` + glisser dans l'Insp. | `Alt+Haut/Bas` | - |
| R2 Renommer colonne | conservé (double-clic) + `F2` | `F2` | - |
| R3 Pastilles PK/UQ/NN/AI | conservées (lecture) ; bascules dans Flottante et Insp. | - | - |
| R4 Engrenage colonne (`FieldEditorPanel`) | **supprimé** : le clic sur la ligne sélectionne et ouvre l'Insp. Colonne | `I` | 2 -> 1 |
| R5 Commentaires de colonne | Insp. Colonne + indicateur conservé sur la ligne | - | 1 -> 1 |
| R6 Type (texte) | cliquable : champ de type en place avec suggestions | - | 3 -> 2 |
| R7 Poignées de relation | conservées ; l'outil `R` ajoute la voie « deux clics » | `R` | - |
| Supprimer colonne (popover) | Insp. pied + CTX + `Suppr` ; toast « Annuler » | `Suppr` | 2 -> 1 |
| E2/E3 Options du lien (popover) | Insp. Relation + Flottante (Cardinalité, Inverser, Couleur, Supprimer) | - | 2 -> 1 |
| E4 Points de passage | conservés | - | - |
| E5 Menu contextuel relation | CTX relation (étendu) | - | 1 -> 1 |
| O1 Zone : couleur (popover) | Flottante + Insp. | - | 2 -> 1 |
| O2 Note : couleur (popover) | Flottante + Insp. | - | 2 -> 1 |
| O3 Groupe : Dégrouper | Flottante + CTX + `Ctrl+Maj+G` | - | 1 -> 1 |
| O4 Enum : valeurs | conservé en ligne + Insp. Enum | - | - |
| O5 Menu canvas vide | CTX canvas vide (libellé « Ajouter une table » **conservé** pour les e2e) | - | 1 -> 1 |
| O6 Pas de menu sur table/colonne | CTX table / colonne / sélection | clic droit / `Maj+F10` | non offert -> 1 |
| O7 Barre MCD (réinitialiser, minicarte) | Affichage (même menu, entrées contextualisées au mode) | - | 1 -> 2 |
| D1-D3 DBML (symbole, palette, formater) | inchangés dans l'en-tête du panneau DBML | inchangés | - |
| D4/D5 Replier / réafficher DBML | rail + barre d'état (DBML) | - | 1 -> 1 |
| Modale Verrous (`TableLockDialog`) | Insp. Verrou (formulaire en place) | - | modale -> panneau |
| Modale Liste de verrous (`TableLocksList`) | Insp. mode Verrous | - | modale -> panneau |
| Modale Données initiales (`SeedDialog`) | **conservée** (flux lourd), ouverte depuis Insp. | - | - |
| Visite guidée (`EditorTour`) | conservée ; étape « barre d'outils » repointée sur le dock | - | - |

Bilan : disparaissent **2 modales** (`TableLockDialog`, `TableLocksList`, remplacées par des sections d'inspecteur) et **6 popovers de formulaire** (`TableSettingsPanel`, `FieldEditorPanel`, `CommentThread`, `EdgeSettingsPopover`, couleur zone, couleur note) ; les `ToolbarMenu` Insérer et Détail disparaissent (dock, Affichage), Plugins devient une section d'Affichage et de la palette. Restent **10 modales de flux** (Import, Export, Convertir, Comparer, Déployer, Différences en lecture seule, Données initiales, Compte SQL, Paramètres, gestion des Plugins), plus la visite guidée : 19 -> 10 popups à saisie. Les surfaces légères sans formulaire lourd (menus Projet / avatar / Affichage / zoom, chip Base, cloche, menu contextuel unique, palette, aide des raccourcis) sont ajoutées ou conservées.

---

## 6. Interactions détaillées

### 6.1 Création rapide d'une table

| Voie | Geste | Résultat |
|------|-------|----------|
| Outil | `T` puis clic canvas | table `table_n` posée au point, **champ du nom en édition** (texte sélectionné), outil reste armé |
| Double-clic | double-clic sur canvas vide (outil Sélection) | identique, une seule fois (comportement actuel de `handlePaneClick` inchangé pour l'outil armé) |
| CTX | clic droit canvas vide -> Ajouter une table | position = pointeur (`flowPosition`) |
| Palette | `Ctrl+K` -> « Ajouter une table » | centre de la vue |
| Etat vide | bouton « Ajouter une table » de la carte | centre de la vue |
| Collage | coller du DBML ou du SQL (détection du texte) | tables créées (prolonge `tableClipboard.ts`) |
| Fichier | glisser un `.dbml`/`.sql` sur le canvas | ouvre `ImportDialog` pré-rempli |

Dans le champ du nom : `Entrée` valide et **passe en saisie de la première colonne** (nom vide, focus) ; `Echap` annule le renommage mais garde la table (annulable par `Ctrl+Z`) ; `Tab` valide et passe à la colonne.

### 6.2 Création rapide d'une colonne en ligne

- `C` sur table sélectionnée, ou clic sur « + Ajouter une colonne » : une ligne **en édition** apparaît (aujourd'hui : `field_n` de type `int` créé d'office, `TableNode.svelte` l. 407-415, sans entrer en édition). Nouveau : le nom est en édition immédiate.
- Saisie rapide dans le champ de nom, grammaire proche de DBML : `email varchar(255) not null unique` -> nom `email`, type `varchar(255)`, `NN`, `UQ`. Mots-clés reconnus : `pk`, `unique`/`uq`, `not null`/`nn`, `increment`/`ai`, `default: x`. Si le texte ne contient qu'un mot, il s'agit du nom et le type reste `int`. (Risque : le parsing doit réutiliser le moteur `@athanordb/dbml-engine` plutôt qu'un second parseur ; voir R3.)
- `Entrée` valide et ouvre la colonne suivante ; `Entrée` sur une ligne vide la supprime et termine la saisie ; `Echap` annule la dernière ligne vide.
- `Tab` dans un champ de nom passe au champ de type (liste de suggestions en dessous, flèches + `Entrée`) puis revient au nom de la ligne suivante.

### 6.3 Edition en place

| Objet | Déclencheur | Validation | Annulation |
|-------|-------------|------------|------------|
| Nom de table | double-clic, `F2`, `Entrée` ouvrant le renommage | `Entrée`, perte de focus | `Echap` (restaure `table.name`) |
| Nom de colonne | idem | idem | idem |
| Type de colonne | clic sur le type, `F2` puis `Tab` | `Entrée`, choix de suggestion | `Echap` |
| Note de table/colonne | Inspecteur (textarea) | perte de focus | `Echap` |
| Nom de zone / groupe / enum | double-clic (existant) + `F2` | idem | idem |
| Valeur d'enum | double-clic (existant) | idem | idem |
| Texte de note | double-clic (existant) | perte de focus | `Echap` |

Les gestes s'appuient sur `useDraftValue` (déjà utilisé pour le nom de table et de colonne) : un seul comportement de brouillon pour tous les champs de l'inspecteur, sans écriture Yjs à chaque frappe. Verrou : un champ verrouillé reste lisible, `aria-disabled`, tooltip portant `lockNote`.

### 6.4 Glisser-déposer

| Geste | Etat actuel | Cible |
|-------|-------------|-------|
| Déplacer une/plusieurs tables | existant (`onDrag*`, grille 10 px optionnelle) | inchangé ; `Alt` maintenu = désactive l'aimantation ; flèches = pas d'1 px (10 avec `Maj`) |
| Lasso | existant (`lassoSelection.ts`) | inchangé |
| Réordonner une colonne dans la table | HTML5 drag sur le grip, souris seulement | conservé + `Alt+Haut/Bas` + glisser dans la liste de l'inspecteur ; indicateur d'insertion existant (`rowDropIndicatorClass`) |
| Créer une relation | glisser d'une poignée à une autre | conservé + outil `R` (2 clics) + menu colonne « Créer une relation vers... » (ouvre l'outil, source déjà posée) |
| Déposer un fichier `.dbml`/`.sql`/`.json` sur le canvas | non géré | ouvre `ImportDialog` pré-rempli (lot 9) |
| Déposer une table dans une zone | zones visuelles, sans appartenance | inchangé ; « Sélectionner son contenu » calcule par intersection géométrique |
| Déplacer une colonne vers **une autre table** | non géré | **hors périmètre** (Q6) |
| Redimensionner zone / note | existant (`NodeResizer`) | inchangé |
| Redimensionner DBML / inspecteur / SQL | DBML et SQL existants | inspecteur ajouté, même `Splitter` |

Pendant un glisser, la barre flottante est masquée et l'inspecteur n'est pas rafraîchi (il suit `selectedTableIds`, qui est déjà stable pendant un drag : `sameIds` dans `ProjectEditor.svelte` l. 16-20, 487-493).

### 6.5 Annuler / rétablir

- Source de vérité : `docHandle.undoManager` (Yjs) - conservée. Les boutons du dock sont `disabled` quand l'onglet n'est pas Schéma, en MCD, ou en lecture seule (corrige P5).
- Toute suppression (table, colonne, relation, zone, note, groupe) affiche un toast « *x supprimée.* [Annuler] » pendant 6 s ; le bouton appelle `undoManager.undo()` (une seule étape par action : les mutations passent par `doc.transact`, voir `deleteNodes`).
- Les actions multi-étapes (Réorganiser, Convertir les types, Grouper, collage) doivent s'exécuter dans **une transaction** pour qu'un `Ctrl+Z` les annule d'un coup (à auditer pour chaque mutation ; Réorganiser : `commandRunner.onAutoLayout`).
- Libellés d'historique : le tooltip du bouton Annuler indique l'action à défaire (« Annuler : renommer la table users »), à condition d'attacher des métadonnées aux éléments de pile (`stack-item-added`) - lot 9, optionnel.
- Les verrous serveur peuvent refuser un `undo` (le serveur annule des changements sur table verrouillée : toast `locks.revertedToast` existant) : le message reste.

### 6.6 Etats vides

| Situation | Contenu |
|-----------|---------|
| Projet sans table | carte centrée sur le canvas : « Commencez votre schéma » + [Ajouter une table `T`] [Importer un schéma] [Coller du DBML] [Partir d'un modèle] (les modèles de projet existent : `project-templates.e2e.ts`) ; l'éditeur DBML affiche un exemple en commentaire |
| Table sans colonne | ligne fantôme « Tapez un nom de colonne... » (focus au clic) à la place du pied seul |
| Rien de sélectionné (inspecteur) | carte Projet (4.1) |
| Recherche / Palette sans résultat | « Aucun résultat pour « x ». Créer une table « x » ? » (action directe) |
| Aucune base liée (chip) | admin : « Lier une base de données » (lien console) ; autres : chip masqué |
| Onglet Problèmes vide | « Aucun problème. Le schéma respecte les règles actives. » (hors périmètre détaillé, mais le badge de l'onglet disparaît) |
| Aucun verrou (mode Verrous) | « Aucune table verrouillée. » |
| Lecture seule | pas d'état vide d'édition : « Ce projet est vide. » |
| Connexion perdue | barre d'état rouge « Hors ligne - vos modifications seront envoyées au retour de la connexion » (ce que l'indicateur H12 laissait entendre seulement par couleur) |

### 6.7 Détails de comportement transverses

- **Sélection unifiée.** Aujourd'hui l'état est éclaté : `nodesState.nodes[].selected` (tables, zones...), `selectedFieldId` et `selectedEdgeId` (`ProjectEditor.svelte` l. 297-298), et la sélection d'une colonne *désélectionne le nœud* (`TableNode.svelte` l. 76-80). On introduit `EditorSelection` (kind + ids), dérivé de ces sources dans un premier temps (lot 0) ; l'inspecteur et le registre ne lisent que lui.
- **Un clic sur une colonne** sélectionne la colonne *et garde la table dans l'inspecteur comme fil d'Ariane* : « users > email » (clic sur « users » remonte).
- **Survol.** Les actions de survol restantes (`...`) n'existent que pour la découvrabilité à la souris ; le tactile s'appuie sur la sélection.
- **Zoom bas.** Sous 0,35 de zoom, les nœuds se réduisent (compact déjà géré par `canvasContext.quantizeZoom`) ; barre flottante masquée, inspecteur inchangé.
- **Performance.** L'inspecteur monte son contenu seulement si ouvert ; les listes de colonnes sont rendues sans virtualisation jusqu'à 200 colonnes (au-delà : fenêtrage, à ajouter si besoin). Aucun calcul d'inspecteur dans le chemin chaud du drag (cf. `docs/perf/`).
- **Collaboration.** Aucun changement de protocole : les champs de l'inspecteur écrivent via les mêmes mutations (`projectMutations.ts`, `canvasNodes.svelte.ts`) ; la sélection distante reste affichée (`remoteSelections`) et l'inspecteur mentionne « X édite aussi cette table » si `remoteSelections.get(tableId)` est non vide.

---

## 7. Accessibilité

### 7.1 Clavier

1. **Ordre de tabulation** : header (retour, menu Projet, onglets en `tablist` avec flèches, chip Base, Déployer, présence, cloche, avatar) -> panneau DBML -> canvas (un seul arrêt « zone de dessin ») -> inspecteur -> barre d'état. `F6` / `Maj+F6` cyclent entre ces régions (landmarks).
2. **Canvas navigable** : le canvas est un `role="application"` avec `aria-label="Diagramme du schéma"` ; avec le focus dedans : flèches = objet voisin, `Entrée` = entrer dans la table (colonnes), `Echap` = remonter, `Tab` = sortir vers l'inspecteur. Chaque nœud de table reçoit `role="group"` + `aria-label="Table users, 4 colonnes"` ; chaque colonne `role="button"` + `aria-selected`.
3. **Menus** : `role="menu"` / `menuitem` / `menuitemcheckbox` (PK, UQ...), flèches, `Début`/`Fin`, saisie de lettre, `Echap` rend le focus à l'élément déclencheur. Le composant `Menu.svelte` / `MenuItem.svelte` existe (`components/ui`) ; à vérifier qu'il gère les flèches avant de le généraliser (les menus de canvas actuels ne le font pas).
4. **Palette** : `role="dialog"` modal + `combobox` avec `aria-activedescendant`, résultats en `listbox` ; annonce du nombre de résultats (`aria-live="polite"`).
5. **Dock** : `role="toolbar"` avec `aria-orientation="horizontal"`, un seul tab-stop, flèches entre outils, `aria-pressed` pour l'outil actif.
6. **Pas de piège** : l'inspecteur n'est pas modal ; `Echap` depuis ses champs revient au canvas avec la sélection intacte.
7. **Alternatives aux gestes souris** : relation = outil `R` (2 touches Entrée) ou menu colonne ; réordonner = `Alt+Haut/Bas` ; déplacer table = `Alt+flèches` ; redimensionner zone = inspecteur (largeur/hauteur numériques) ; lasso = `Ctrl+A` puis `Maj+clic`/`Maj+flèches`.

### 7.2 Lecteur d'écran

- Tous les boutons-icônes ont `aria-label` (corrige H7-H10 à 768-1023 px, où le texte est en `display:none` : `Button` + `span.hidden` ne fournit pas de nom accessible).
- Annonces `aria-live="polite"` (région unique dans le header, `sr-only`) pour : table créée, colonne ajoutée, relation créée, suppression + possibilité d'annuler, déplacement par clavier, résultat d'import, perte/retour de connexion.
- Les couleurs ne sont jamais seules : une table verrouillée a un cadenas **et** une bordure pointillée (déjà), un problème a une icône **et** un compteur, l'environnement de production a un mot « Production » **et** une couleur.
- Les tooltips (`data-tooltip`) ne sont pas lus par les lecteurs d'écran : tout libellé important doit exister aussi en `aria-label` / `aria-describedby`. Audit à faire : le composant global `data-tooltip` (CSS, `styles/*.css`) ne génère aucun attribut ARIA.
- Relations : chaque trait reçoit `role="img"` et `<title>` « users.id relie orders.user_id (un à plusieurs) » ; aujourd'hui seul le titre d'un problème est rendu (`RefEdge.svelte` l. 221).

### 7.3 Contrastes, taille, mouvement

- Cibles : texte >= 4,5:1, composants >= 3:1 (voir 2.3) ; cibles tactiles >= 32 px dans le dock (aujourd'hui 36 px, conservés), >= 24 px ailleurs (WCAG 2.2 2.5.8) ; les pastilles de couleur de 22 px (`SWATCH_CELL_CLASS`) passent à 28 px dans l'inspecteur.
- Focus visible : contour 2 px `primary` + décalage sur **tous** les contrôles (déjà fait pour les pilules, à étendre aux nœuds et lignes : `:focus-visible` sur `.table-node-row`).
- `prefers-reduced-motion` : désactiver `animate-view-switch-in` (utilisée à chaque bascule MLD/MCD et sur chaque pilule) et la transition d'ouverture de l'inspecteur.
- Les pictogrammes d'état de table ont une zone cliquable de 24 px même si l'icône en fait 16.
- Zoom navigateur 200 % : le header suit le tableau de comportement en écran étroit ; aucun défilement horizontal de la page ; le canvas reste utilisable.

---

## 8. Lots de travail

Estimation : **S** <= 1 jour, **M** 2-4 jours, **L** 5-8 jours (un développeur connaissant le code). Ordre = ordre de livraison ; chaque lot est fusionnable seul et laisse l'application fonctionnelle.

### Lot 0 - Fondations : registre de commandes et sélection unifiée (M)
- **Contenu** : module `features/editor/commands/` (`registry.ts`, `commands.ts`, types) ; `EditorSelection` (`selection.svelte.ts`) dérivé de `nodesState`, `selectedFieldId`, `selectedEdgeId` ; aucune modification visuelle.
- **Fichiers** : `ProjectEditor.svelte` (extraction des états l. 297-310, 484-493), `hooks/useCanvasNodes/canvasNodes.svelte.ts`, nouveau dossier `commands/`, `hooks/canvasEdges.svelte.ts`.
- **Acceptation** : toutes les commandes existantes (Importer... Dupliquer, Grouper, Supprimer) sont déclarées une fois ; `EditorSelection.kind` correct pour table / colonne / relation / multi / rien ; tests unitaires (Vitest) sur le registre (`quand`, ordre, raccourcis uniques) ; aucun changement de comportement.
- **e2e** : aucun.

### Lot 1 - Header unique, menu Projet, chip Base, menu avatar (M)
- **Contenu** : fusion `ProjectToolbar` + `WorkspaceBar` en une barre de 48 px ; menu Projet (Importer, Exporter, Comparer, Convertir, Historique, Verrous, Raccourcis, Visite, Retour) ; chip Base (connexion, environnement, Mon compte SQL) ; menu avatar (Paramètres, Visite, Se déconnecter) ; onglets responsifs ; correction P3/P4 ; largeur max du contenu ; suppression de l'affichage de Annuler/Rétablir/Réorganiser du header (le dock arrive au lot 3 : en attendant, les trois restent dans un petit groupe gauche du canvas, voir note ci-dessous).
- **Fichiers** : `ProjectToolbar.svelte`, `workspace/WorkspaceBar.svelte`, `ProjectEditor.svelte` (props et état des modales), `connections/PersonalAccountButton.svelte` (devient contenu de popover), `environments/EnvironmentBadge.svelte`, `components/ui/layout.ts` (`APP_HEADER` -> variante 48 px **uniquement pour l'éditeur** ; les autres écrans gardent 56 px, voir Q2), `components/ui/Tabs.svelte` (mode repli), `locales/fr.json` + `en.json` (parité contrôlée par `i18n/localeParity.ts`).
- **Note de transition** : Annuler/Rétablir/Réorganiser migrent au lot 3 ; pour ne pas casser `canvas-interactions.e2e.ts`, le lot 1 les place dans une mini-pilule fixe en haut à gauche du canvas portant le même `aria-label` « Annuler (Ctrl+Z) ».
- **Acceptation** : une seule barre de 48 px ; 7 contrôles + onglets au maximum ; aucun contrôle perdu (table section 5) ; < 768 px : Importer/Exporter/Comparer/Convertir/Déployer accessibles ; noms accessibles sur tous les boutons ; le chip Base montre l'environnement de production en rouge avec le mot « Production » ; fonctionnement sans connexion (chip absent) ; capture visuelle à 1440, 1280, 1024, 768, 390.
- **e2e à adapter** : `compare-projects` (Comparer -> menu Projet), `plugins-locks` l. 255 et `plugin-sandbox` l. 77 (Importer/Exporter), `deployment-risks`/`environments`/`seeds`/`lint`/`workspace`/`pipeline` (Déployer inchangé mais `.first()` à retirer s'il n'y a plus qu'un bouton), `onboarding` l. 91 (Visite guidée dans le menu avatar), `personal-accounts` (bouton `data-testid="personal-account"` conservé dans le popover), `workspace` (onglets et sélecteur de connexion).

### Lot 2 - Barre d'état (S)
- **Contenu** : barre de 28 px (synchro, verrous, problèmes, DBML, SQL) ; retrait de W7/W8 de l'ancienne barre ; synchro d'alerte sur l'avatar.
- **Fichiers** : nouveau `workspace/StatusBar.svelte`, `ProjectEditor.svelte`, `features/sql/sqlDrawer.svelte.ts` (inchangé, seulement le point d'appel), `editor/locks/TableLocksList.svelte` (provisoirement toujours modale).
- **Acceptation** : le compteur de verrous ouvre la liste ; `Ctrl+J` fonctionne comme avant ; hors ligne -> barre rouge + texte ; la barre n'existe que sur l'onglet Schéma.
- **e2e** : `table-locks` (ouverture de la liste), `workspace` (bouton SQL), `onboarding` si la barre devient ancre de visite.

### Lot 3 - Dock d'outils, outil Relation, menu Affichage, raccourcis d'outils (L)
- **Contenu** : remplace `CanvasToolbar`, `InsertToolDropdown`, `DetailLevelDropdown`, `PluginMenu` (sauf `PluginQuickPalette`, repris) ; outils V/H/T/R/Z/N/E, Echap ; Affichage ; segment MLD/MCD en haut à gauche ; `Maj+1` etc. ; réutilise `activeInsertTool` de `CanvasArea.svelte` en l'étendant (`CanvasInsertTool` -> `CanvasTool` dans `canvas/types.ts`).
- **Fichiers** : `canvas/CanvasArea.svelte` (gestion des outils, curseurs `canvas-placing` dans `styles/canvas.css`), `canvas/CanvasToolbar.svelte` (supprimé/remplacé), `canvas/types.ts`, `canvas/CanvasZoomBar.svelte` (raccourcis), `hooks/editorKeyboardShortcuts.svelte.ts` (touches d'outils), `hooks/projectMutations.ts` (`onConnect` appelé par l'outil Relation), `mcd/McdToolbar.svelte` + `mcd/McdCanvas.svelte` (aligner sur Affichage), `components/ui/canvasToolbarStyles.ts`, `onboarding/EditorTour.svelte` (ancre `toggle-link-highlight`), `utils/preferences.ts`.
- **Acceptation** : 5 outils de création accessibles en 1 clic ou 1 touche ; l'outil actif est visible et se quitte par Echap ; l'outil Relation crée une FK en 2 clics et refuse (message) une relation vers une table verrouillée (comportement `onLockedRelation` existant) ; l'état des réglages d'affichage persiste (`saveHighlightLinks`, `saveShowValidationIssues`) ; `data-testid` `toggle-link-highlight` / `toggle-validation-issues` conservés ; bench inchangé (aucun coût de rendu ajouté dans le drag) ; MCD : Affichage fonctionne sans outils d'édition.
- **e2e** : `canvas-interactions` (Annuler, « Ajouter une table » via menu contextuel), `project-lifecycle` l. 57-61, `plugin-sandbox` l. 46, `canvas-clipboard`, `onboarding`, scripts de bench.

### Lot 4 - Inspecteur : squelette, table, colonne (L)
- **Contenu** : panneau droit (redimensionnable, mémorisé, mode flottant) ; états vide / table / colonne ; remplace `TableSettingsPopover` + `TableSettingsPanel`, `FieldEditorPopover` + `FieldEditorPanel`, `IndexRow`, `AddIndexForm` (réutilisés dans le panneau) ; la ligne de colonne perd R4 et sélectionne ; règle de largeur minimale du canvas ; mode « Verrous » ; formulaire de verrou en place.
- **Fichiers** : nouveau `features/editor/inspector/` (`Inspector.svelte`, `TableInspector.svelte`, `ColumnInspector.svelte`, `ProjectInspector.svelte`, `LocksInspector.svelte`), `nodes/TableNode.svelte`, `nodes/table/TableNodeRow.svelte`, `nodes/table/FieldEditorPanel.svelte` (supprimé après extraction des sections), `nodes/table/TableSettingsPanel.svelte` (idem), `locks/TableLockDialog.svelte` (logique reprise), `locks/TableLocksList.svelte`, `ProjectEditor.svelte` (mise en page à 3 colonnes), `components/ui/Splitter.svelte` (arête gauche), `dbml/DbmlPanel.svelte` (états rail), `utils/preferences.ts`.
- **Acceptation** : toute propriété modifiable avant (liste section 1.6/1.7) l'est dans l'inspecteur ; aucune perte de saisie au zoom/pan ; les champs verrouillés sont inertes avec raison ; l'inspecteur n'impacte pas le drag (profilage PerfHud avant/après sur 500 tables) ; DBML + inspecteur à 1280 px laissent >= 520 px au canvas ; lecture seule : champs `readonly`, aucune action d'écriture ; deux utilisateurs éditant la même table : pas de conflit visuel (dernier écrit gagne, comme aujourd'hui).
- **e2e** : `table-locks` (Verrouiller dans l'inspecteur au lieu du bouton de nœud), `dictionary`, `lint`, `structure-policy`, `dbml-editing`, `history` (si sélection de table), `comment-mentions` (fil de commentaires de table/colonne dans l'inspecteur), `seeds`, `seed-from-database`.

### Lot 5 - Inspecteur : relation, enum, zone, note, groupe, multi-sélection (M)
- **Contenu** : `RelationInspector`, `EnumInspector`, `ZoneNoteInspector`, `GroupInspector`, `MultiInspector` ; suppression de `EdgeSettingsPopover` et des popovers de couleur (zone/note) ; `SelectionColorToolbar` supprimé (remplacé par Flottante au lot 6 et `MultiInspector`) ; alignement/répartition (nouvelle mutation `alignTables` dans `projectMutations.ts`).
- **Fichiers** : `inspector/*`, `edges/EdgeSettingsPopover.svelte`, `edges/CardinalityBadge.svelte` (réduit à la pastille), `edges/RefEdgeOverlay.svelte`, `nodes/ZoneNode.svelte`, `nodes/StickyNoteNode.svelte`, `nodes/TableGroupNode.svelte`, `nodes/EnumNode.svelte`, `canvas/SelectionColorToolbar.svelte`, `hooks/projectMutations.ts`.
- **Acceptation** : toutes les options de la section 1.7 (E3) disponibles ; l'alignement est annulable en un `Ctrl+Z` ; lecture seule respectée.
- **e2e** : `canvas-clipboard`, `plugins-locks` (zones), tout test qui ouvre « Options du lien ».

### Lot 6 - Barre flottante de sélection et en-tête de table allégé (M)
- **Contenu** : `SelectionBar.svelte` (via `NodeToolbar` de Svelte Flow) alimentée par le registre ; en-tête de table réduit à nom + 4 pictogrammes + `...` ; suppression de T5-T10 du nœud (ils restent accessibles par Flottante/CTX/Inspecteur) ; libellés accessibles conservés.
- **Fichiers** : `nodes/TableNode.svelte`, `nodes/table/tableStyles.ts` (`HEADER_ACTIONS_CLASS`, `HEADER_BTN_CLASS`), `canvas/CanvasArea.svelte`, nouveau `canvas/SelectionBar.svelte`, `hooks/useCanvasNodes/buildTableNodes.ts` (le bundle de callbacks du cache de nœuds : **ne pas réintroduire d'identités instables**, cf. commentaire « Stable identities » de `ProjectEditor` l. 301-302), `hooks/useCanvasNodes/canvasNodes.svelte.ts`.
- **Acceptation** : en-tête <= 100 px d'icônes ; plus d'élément révélé au seul survol hors le `...` ; la barre suit la table pendant le pan/zoom et se cache pendant le drag ; aucune régression de perf (benchmark 150 / 500 tables) ; « Voir les données », « Verrouiller la table… », « Ajouter une colonne » restent trouvables par `getByRole("button")` après sélection de la table.
- **e2e** : `workspace` l. 109 (Voir les données), `table-locks` l. 38/116/122, `seeds`, `onboarding`.

### Lot 7 - Menus contextuels complets (M)
- **Contenu** : composant `ContextMenu` partagé (flèches, `menuitemcheckbox`, sous-menus) ; menus table / colonne / relation / zone / note / groupe / enum / multi / canvas vide ; remplace `CanvasContextMenu` et `EdgeContextMenu` ; levée de `suppressNativeMenu` ; `Maj+F10` et appui long.
- **Fichiers** : `canvas/CanvasArea.svelte` (l. 393-394 et `handleContextMenu`), `canvas/CanvasContextMenu.svelte`, `edges/EdgeContextMenu.svelte`, `components/ui/Menu.svelte` / `MenuItem.svelte` / `contextMenuStyles.ts`, `nodes/TableNode.svelte`, `nodes/table/TableNodeRow.svelte`, `edges/edgeRouting.svelte.ts`.
- **Acceptation** : chaque entrée du tableau 3.12 présente et testée ; le pan bouton droit n'ouvre pas le menu (tolérance 3 px conservée) ; navigation clavier complète ; les entrées de lecture seule/verrou sont retirées/grisées selon la règle.
- **e2e** : `project-lifecycle`, `canvas-interactions`, `plugin-sandbox` (« Ajouter une table » depuis le menu du canvas **doit rester disponible avec le même libellé**) ; nouveaux : menu table, menu colonne, menu relation.

### Lot 8 - Palette `Ctrl+K`, aide des raccourcis, raccourcis restants (M)
- **Contenu** : `CommandPalette` projet (sections, préfixes, récents), `ShortcutsSheet` (`?`), raccourcis de 3.13 restants (`Ctrl+A`, `Ctrl+G`, `F2`, `C`, `Entrée`, flèches, `Alt+flèches`) ; liaison `Ctrl+K` dans CodeMirror ; implémentation de `Maj+1` ; intégration de `PluginQuickPalette` comme section.
- **Fichiers** : nouveaux `editor/palette/ProjectPalette.svelte`, `editor/palette/ShortcutsSheet.svelte` ; `hooks/editorKeyboardShortcuts.svelte.ts` ; `canvas/canvasSearch.svelte.ts` (source des résultats) ; `dbml/symbols.ts` (index) ; `dbml/DbmlEditor/*` (keymap) ; `plugins/PluginQuickPalette.svelte`.
- **Acceptation** : toute commande du registre est trouvable par la palette ; `Ctrl+K` fonctionne depuis le canvas, l'inspecteur et l'éditeur DBML ; aucun raccourci à touche simple ne se déclenche pendant une saisie (test sur `isTypingTarget`) ; la palette gère l'absence de résultat et propose « Créer ».
- **e2e** : `global-search` (champ « Rechercher un schéma… » est celui de la liste des projets : non concerné), `plugins-locks` l. 75 (placeholder « Rechercher une action ou un plugin... » -> nouveau placeholder à reporter), nouveau test Ctrl+K.

### Lot 9 - Création rapide et glisser-déposer (M)
- **Contenu** : table créée en édition de nom ; saisie rapide de colonne (grammaire DBML) ; `Entrée` chaîné ; double-clic canvas ; dépôt de fichier -> `ImportDialog` ; toast d'annulation sur toutes les suppressions ; `Alt+Haut/Bas` pour réordonner ; métadonnées d'historique pour libeller Annuler.
- **Fichiers** : `hooks/projectMutations.ts` (`addTable`, `addField`), `nodes/TableNode.svelte`, `nodes/table/TableNodeRow.svelte`, `canvas/CanvasArea.svelte`, `io/ImportDialog.svelte`, `components/ui/toast.svelte.ts`, `packages/dbml-engine` (fonction de parsing d'une ligne de colonne).
- **Acceptation** : de « T » à une table de 3 colonnes saisie sans souris en < 15 s ; toute suppression est annulable en 1 clic ; le glissement d'un fichier ne déclenche jamais d'écriture sans confirmation de l'Importer.
- **e2e** : `canvas-interactions`, `project-lifecycle`, nouveau test « création clavier ».

### Lot 10 - Etats vides, responsive fin, accessibilité, contrastes (M)
- **Contenu** : états vides (6.6) ; `role`/`aria` du canvas, des nœuds, des relations ; région `aria-live` ; `prefers-reduced-motion` ; tokens de contraste (en coordination avec la section design system) ; mode consultation < 640 px ; balayage axe-core en e2e.
- **Fichiers** : `styles/tokens.css`, `styles/canvas.css`, `edges/RefEdge.svelte`, `nodes/*`, `Tabs.svelte`, `ProjectEditor.svelte`, composants d'état vide (`components/ui/EmptyState.svelte`).
- **Acceptation** : 0 violation axe de niveau sérieux/critique sur Schéma ; contrastes de 2.3 tous >= seuils ; parcours complet au clavier (création table -> colonne -> relation -> déploiement) ; test lecteur d'écran manuel (NVDA) documenté.
- **e2e** : nouveau `a11y.e2e.ts`, `component-catalogue` (nouveaux composants).

### Lot 11 - Nettoyage, i18n, documentation, visite guidée (S)
- **Contenu** : suppression du code mort (`CanvasToolbar`, `ToolbarMenu` s'il n'est plus utilisé hors zoom, `SelectionColorToolbar`, anciens popovers), clés i18n orphelines (`fr.json`, `en.json`), `docs/user-guide.md`, `docs/etat-des-features.md`, étapes de `EditorTour`.
- **Acceptation** : `tsc`, lint, tests unitaires et e2e verts ; plus aucune clé de traduction inutilisée ; guide utilisateur à jour.

**Récapitulatif** : 0 M, 1 M, 2 S, 3 L, 4 L, 5 M, 6 M, 7 M, 8 M, 9 M, 10 M, 11 S = **2 L + 8 M + 2 S** ~ 35 à 55 jours-développeur. Chemin critique : 0 -> 4 -> 6 -> 7. Les lots 1-2 (le « loooong header ») livrent déjà l'essentiel de la perception et peuvent partir en premier, indépendamment du reste.

### 8.1 Ordre de livraison conseillé en trois jalons

| Jalon | Lots | Ce que voit l'utilisateur |
|-------|------|---------------------------|
| A - « Header court » | 0, 1, 2 | une barre de 48 px, menu Projet, chip Base, barre d'état ; plus de bouton perdu sur mobile |
| B - « Créer et régler » | 3, 4, 5, 6 | dock d'outils, Affichage, inspecteur, en-têtes de table allégés |
| C - « Aller vite » | 7, 8, 9, 10, 11 | menus clic droit partout, Ctrl+K, saisie rapide, accessibilité |

### 8.2 Tests e2e : tableau de synthèse des adaptations

Les tests e2e sont dans `apps/web/e2e/*.e2e.ts` (38 fichiers, ~5 700 lignes ; `harness.ts` fournit l'environnement). Sélecteurs sensibles trouvés par recherche :

| Fichier | Sélecteur / libellé actuel | Impacté par | Adaptation |
|---------|----------------------------|-------------|------------|
| `canvas-interactions.e2e.ts` l. 35, 81 | texte « Ajouter une table » ; bouton « Annuler (Ctrl+Z) » | lots 1, 3, 7 | conserver le libellé du menu canvas ; le bouton Annuler garde son `aria-label` (dock) |
| `project-lifecycle.e2e.ts` l. 57-61 | clic droit canvas -> « Ajouter une table » | lot 7 | libellé conservé |
| `plugin-sandbox.e2e.ts` l. 46, 77 | « Ajouter une table » ; bouton « Exporter » | lots 1, 7 | Exporter -> menu Projet puis entrée « Exporter... » |
| `plugins-locks.e2e.ts` l. 75, 184, 255-278 | placeholder palette plugins ; bouton « Insérer created_at/updated_at... » ; bouton « Importer » + dialogue « Importer un schéma » | lots 1, 8 | Importer via menu Projet ; palette : nouveau placeholder |
| `compare-projects.e2e.ts` l. 57 | bouton « Comparer » | lot 1 | menu Projet |
| `deployment-risks`, `environments`, `seeds`, `lint`, `workspace` | bouton « Déployer » (`exact`, `.first()`) | lot 1 | inchangé en nom ; vérifier l'unicité |
| `table-locks.e2e.ts` l. 38, 116, 122 | « Ajouter une colonne », « Verrouiller la table… » dans le nœud | lots 4, 6 | sélectionner la table puis bouton de la barre flottante / inspecteur ; garder les libellés |
| `workspace.e2e.ts` l. 109, 144 | « Voir les données » dans le nœud ; « Déployer » | lots 1, 6 | idem |
| `onboarding.e2e.ts` l. 51, 91 | « Visite guidée · 1 / 5 » ; bouton « Visite guidée » | lots 1, 3, 11 | menu avatar ; étape barre d'outils repointée ; texte 5 étapes à ajuster |
| `canvas-clipboard.e2e.ts` | copier/coller, zones | lots 3, 7 | vérifier raccourcis et menu |
| `personal-accounts.e2e.ts` | `data-testid="personal-account"` | lot 1 | testid conservé |
| scripts de bench (`toggle-link-highlight`) | `data-testid` | lot 3 | testid conservé |
| nouveaux | - | lots 3, 4, 7, 8, 9, 10 | création clavier, outil Relation, inspecteur colonne, Ctrl+K, menu colonne, a11y |

---

## 9. Risques et questions ouvertes

### 9.1 Risques

| # | Risque | Probabilité / impact | Parade |
|---|--------|----------------------|--------|
| R1 | **Régression de performance** : un inspecteur ou une barre flottante réactive à chaque frame de drag ferait perdre le gain obtenu (le code décrit 66 % du temps dans le hit-testing/layout à 500 tables) | moyenne / haute | l'inspecteur lit `selectedTableIds` stabilisé (`sameIds`) et `liveProject`, jamais `nodesState.nodes` ; barre flottante masquée en drag ; mesurer avec PerfHud et le bench avant chaque fusion |
| R2 | Identités de callbacks instables dans le cache de nœuds (`buildTableNodes`) -> re-rendu de toutes les tables (avertissement explicite dans `ProjectEditor` l. 301-302) | moyenne / haute | tout nouveau callback de nœud passe par le bundle stable ; revue ciblée au lot 6 |
| R3 | Saisie rapide de colonne : un second parseur diverge de DBML | moyenne / moyenne | extraire/exposer une fonction du `dbml-engine`, tests de parité |
| R4 | Découvrabilité : on retire les engrenages de survol ; un utilisateur habitué ne trouve plus les paramètres | haute / moyenne | clic sur table = inspecteur ouvert par défaut ; infobulle de première utilisation ; visite guidée mise à jour ; `?` |
| R5 | Conflit de raccourcis à touche simple avec la saisie (champ de nom, éditeur DBML, plugins en iframe) | moyenne / moyenne | garde `isTypingTarget` + `.cm-editor` ; tests ; désactivation globale possible dans Paramètres |
| R6 | Largeur : trois colonnes + tiroir SQL sur petit écran | haute / moyenne | règle des 520 px, inspecteur flottant, repli du DBML (4.5) |
| R7 | Tests e2e nombreux à réécrire (~14 fichiers touchés) | haute / moyenne | conserver libellés et `data-testid` ; adapter lot par lot ; helper `selectTable(page, name)` dans `harness.ts` |
| R8 | Deux écrans à maintenir (MCD et MLD) pour Affichage/dock | basse / basse | MCD n'utilise que Affichage et zoom ; pas de dock |
| R9 | Plugins : `canvasCommands`, `PluginQuickPalette` et l'API de plugins supposent la pilule basse | basse / moyenne | l'API ne change pas (contributions) ; seul l'emplacement UI bouge ; tests `plugin-sandbox` |
| R10 | Verrous : formulaire en place dans l'inspecteur vs modale actuelle (confirmation explicite) ; risque de verrouiller par erreur | basse / moyenne | bouton explicite « Verrouiller » avec raison obligatoire si la politique du projet l'impose (à vérifier dans `permissions.md`) |
| R11 | Accessibilité du canvas (Svelte Flow) : le focus clavier natif des nœuds est limité | moyenne / haute | prototype tôt au lot 3 ; sinon rôle `application` + navigation maison |
| R12 | Contrastes : changer `--color-text-muted` touche toute l'application, pas seulement l'éditeur | haute / basse | coordination avec la section design system ; livrer en un seul commit transverse |

### 9.2 Questions ouvertes pour le propriétaire

| # | Question | Option recommandée |
|---|----------|--------------------|
| Q1 | « Le header » dont vous parlez : barre du projet, seconde barre, **en-tête des tables**, ou les trois ? | Les trois (hypothèse de ce plan) : confirmer |
| Q2 | Hauteur de header : 48 px dans l'éditeur seulement (les autres écrans restent à 56 px, ce qui réintroduit le décalage de 6 px que `layout.ts` voulait éviter) ou 48 px partout ? | 48 px partout (impact hors périmètre : coordonner avec la section « shell ») |
| Q3 | Faut-il supprimer le bouton Annuler/Rétablir du header au profit du dock ? (dbdiagram les garde en haut, Figma en bas) | Dock ; raccourcis inchangés |
| Q4 | Niveau de détail **par table** (modèle déjà prêt : `table.detailLevel`) : l'offrir dans l'inspecteur ? | Oui, avec « suivre le réglage global » par défaut |
| Q5 | Raccourcis `Ctrl+I` (Firefox : « Informations ») et `Ctrl+E` (Chrome : recherche) pour Importer/Exporter : on les supprime ? | Ne pas lier de raccourci : Importer / Exporter par Ctrl+K |
| Q6 | Déplacer une colonne d'une table à une autre par glisser ? (modifie la structure, risque de rupture de FK) | Hors périmètre de cette refonte |
| Q7 | Où mettre « Suivre ce projet » (`FollowMenu`) : menu Projet ou pied de la cloche ? (je n'ai pas lu son contenu en détail) | Pied de la cloche (même famille : notifications) |
| Q8 | Inspecteur ouvert automatiquement à la sélection : activé par défaut ? | Oui au premier lancement, mémorisé ensuite |
| Q9 | Verrous : la modale `TableLockDialog` doit-elle rester une modale (acte grave, réservé aux administrateurs) ? | Formulaire en place + confirmation par bouton, motif obligatoire |
| Q10 | La barre d'état est-elle acceptable en bas (convention éditeurs de code) ou veut-on garder la synchro dans le header ? | Barre d'état + pastille d'alerte sur l'avatar |
| Q11 | Outil « Relation » : acceptez-vous des touches simples (T, R, Z, N, E, V, H) alors que le DBML est éditable à côté ? | Oui, désactivées dès que le focus est dans un champ ou le DBML |
| Q12 | Mobile/tablette : édition tactile prévue, ou consultation seule sous 640 px ? | Consultation seule (coût 2-3x supérieur sinon) |
| Q13 | `Maj+1` est affiché mais non implémenté : l'implémenter, ou retirer l'indication ? | Implémenter (lot 3) |
| Q14 | La visite guidée (5 étapes) doit-elle être refaite après la refonte ? | Oui, au lot 11 |

---

## Annexe A - Définition et décompte des « contrôles permanents »

Est compté un élément interactif (bouton, onglet, sélecteur, bascule) rendu dans le DOM sans survol ni sélection préalable, sur l'onglet Schéma, en MLD, avec droits d'édition complets, SQL disponible, administrateur de projet, application réelle (`guided`).

| Zone | Avant | Après |
|------|-------|-------|
| Barre du haut (actions) | 13 (ProjectToolbar) + 5 (WorkspaceBar hors onglets) = 18 | 6 : retour, menu Projet, chip Base, Déployer, cloche, avatar |
| Onglets | 6 | 6 |
| Pilule / dock d'outils | 10 | 9 (V, H, T, R, Z, N, E, Annuler, Rétablir) |
| Affichage + bascule MLD/MCD | (compris dans les 10 ci-dessus) | 1 + 2 |
| Zoom | 4 | 3 |
| Barre d'état | 0 | 5 (verrous, problèmes, DBML, SQL, inspecteur) |
| Panneau DBML | 4 | 4 |
| **Total** | **42** (13 + 11 + 10 + 4 + 4) | **36** (6 + 6 + 9 + 3 + 3 + 5 + 4) |

Lecture honnête : le total baisse de 6 seulement, parce que cinq outils de création sont exposés directement au lieu d'un menu et que la barre d'état apporte cinq contrôles. Le gain réel est ailleurs : **barre du haut 24 -> 12** (18 actions + 6 onglets -> 6 + 6), **~100 px -> 48 px** de hauteur en haut, **0 action de projet visible hors Déployer**, **0 action révélée au seul survol** (contre jusqu'à 7 boutons d'en-tête de table + 1 par colonne), **19 -> 10 popups à saisie**. Ces indicateurs, et non le total, servent de critères d'acceptation globaux.

## Annexe B - Script de contrôle des contrastes

Le calcul de la section 2.3 est reproductible : luminance relative sRGB (`0.2126 R + 0.7152 G + 0.0722 B` après linéarisation `v/12.92` ou `((v+0.055)/1.055)^2.4`), ratio `(L1 + 0.05) / (L2 + 0.05)`. A intégrer comme test unitaire sur `styles/tokens.css` (lecture des variables `--color-*` des deux thèmes) pour empêcher toute régression sous les seuils.

## Annexe C - Fichiers lus pour ce document

`features/editor/ProjectEditor.svelte`, `ProjectToolbar.svelte`, `ConvertTypesModal.svelte` (existence), `features/workspace/WorkspaceBar.svelte`, `features/editor/canvas/{CanvasArea,CanvasToolbar,CanvasZoomBar,ToolbarMenu,InsertToolDropdown,DetailLevelDropdown,CanvasContextMenu,SelectionColorToolbar,types,canvasDeleteKey,canvasSearch}`, `nodes/{TableNode,ZoneNode,StickyNoteNode,TableGroupNode,EnumNode}`, `nodes/table/{TableNodeRow,TableSettingsPopover,TableSettingsPanel,FieldEditorPanel,tableStyles}`, `edges/{RefEdge,RefEdgeOverlay,EdgeContextMenu,EdgeSettingsPopover}`, `mcd/ViewModeToggle`, `dbml/DbmlPanel` (en-tête), `hooks/editorKeyboardShortcuts`, `features/connections/PersonalAccountButton`, `features/collaboration/PresenceList`, `components/ui/{layout,canvasToolbarStyles}`, `styles/tokens.css`, `locales/fr.json`, `apps/web/e2e/*` (recherche de sélecteurs). Non lus en détail : `FollowMenu`, `NotificationBell`, `SeedDialog`, `TableLockDialog`, `Menu.svelte`, `Tabs.svelte` (leur comportement exact est à confirmer au démarrage des lots 1, 4, 7).

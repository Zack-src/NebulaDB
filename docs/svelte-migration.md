# Migration React → Svelte 5 (apps/web)

Objectif : remplacer React 19 + React Flow 12 par **Svelte 5 (runes) + Svelte Flow 1.x**
(le port officiel de React Flow, même moteur `@xyflow/system`), sans perte de
fonctionnalité ni de rendu, et mesurer l'effet sur les performances du canvas.

## 1. Périmètre

| Zone | Fichiers | Nature du travail |
| --- | ---: | --- |
| Socle (entrée, App, ErrorBoundary, i18n, hooks) | ~20 | réécriture en runes / `<svelte:boundary>` |
| Composants UI partagés (`components/`) | 17 | portage 1:1 des classes Tailwind |
| Écrans (auth, projets, réglages, admin, équipes, connexions) | ~35 | portage 1:1 |
| Éditeur : barre d'outils, dialogs (import/export/historique/types), plugins | ~25 | portage 1:1 |
| Panneau DBML (CodeMirror) | 7 composants + 4 hooks | CodeMirror est framework-agnostique : seul le « montage » change |
| **Canvas** (nœuds, arêtes, toolbars, lasso, recherche, export image, MCD) | ~45 | portage vers Svelte Flow + adaptation du pipeline doc → nœuds/arêtes |
| Code déjà agnostique (services, utils, plugins runtime, dbml/*.ts, autoLayout, pathMath…) | ~90 | inchangé (retrait des imports de types React Flow) |

Aucun changement côté serveur, `packages/shared` ou `packages/dbml-engine`.

## 2. Correspondances techniques

| React | Svelte 5 |
| --- | --- |
| `useState` / `useMemo` | `$state` / `$derived` (réactivité fine, pas de VDOM) |
| « reset d'état quand une prop change » (`useDraftValue`, etc.) | `$derived` inscriptible (`let draft = $derived(value)`) |
| `useEffect` / `useLayoutEffect` | `$effect` (exécuté avant peinture) / `$effect.pre` |
| `React.memo` + comparateurs sur mesure | inutile : un composant ne recalcule que les expressions dont les dépendances ont changé |
| `createPortal(…, document.body)` | action `use:portal` |
| Context i18n | module `i18n.svelte.ts` à état global réactif |
| `ErrorBoundary` (classe) | `<svelte:boundary>` + snippet `failed` |
| `lazy()` + `Suspense` | `import()` dynamique + `{#await}` (mêmes chunks séparés) |
| SVG via `vite-plugin-svgr` | `?raw` + composant `Icon.svelte` |
| `@xyflow/react` (`ReactFlow`, `Handle`, `NodeResizer`, `MiniMap`, `Panel`, `ViewportPortal`, `useReactFlow`, `useStore`) | `@xyflow/svelte` (`SvelteFlow`, `Handle`, `NodeResizer`, `MiniMap`, `Panel`, `ViewportPortal`, `useSvelteFlow`, `useStore`) |
| `onNodesChange` + `applyNodeChanges` | `bind:nodes` (état `$state.raw`) + `onnodedragstart/stop` pour l'écriture Yjs |
| classes `.react-flow__*` | classes `.svelte-flow__*` (CSS, e2e, bench) |

## 3. Canvas : ce qui est conservé / simplifié

Conservé à l'identique (logique métier et optimisations structurelles) :
- construction des nœuds depuis Yjs avec **cache par table** (`tableNodeCache`) et
  report `selected`/`measured` d'un rebuild à l'autre ;
- arêtes en deux passes (géométrie lourde gelée pendant drag/lasso, surcouche
  légère hover/sélection qui réutilise les objets inchangés) ;
- toggle « liens » par **classe CSS** sur la racine ;
- lasso maison (rectangle peint hors du framework, commit seulement quand l'ensemble change) ;
- LOD compact au-delà de 150 tables, `content-visibility`, curseurs distants
  montés seulement s'il y a des pairs ;
- clé Suppr prioritaire sur les points d'arête, raccourcis, undo Yjs.

Simplifié grâce à Svelte :
- plus de comparateurs `memo` (`TableNode`, `RefEdge`) ni de `useSyncExternalStore` :
  les petits stores globaux (`highlightedFields`, `selectionDragState`) deviennent
  des `$state` lus directement par clé ;
- plus de `Profiler` React (remplacé par des spans `perfMonitor` équivalents).

## 4. Ordre d'exécution

1. Outillage : Vite (`@sveltejs/vite-plugin-svelte`), tsconfig, `svelte-check`,
   Tailwind (glob `.svelte`), ESLint (`eslint-plugin-svelte`, règle « texte en dur »
   portée sur `SvelteText`), CSS `svelte-flow`.
2. Socle : i18n, utilitaires runes (async action/resource, escape stack,
   popover, placement, flash, portal), Tooltip global, Modal, UI primitives, icônes.
3. Écrans hors éditeur.
4. Éditeur hors canvas (toolbar, DBML, dialogs, plugins).
5. Canvas MLD (nœuds, arêtes, toolbars, lasso, recherche, export, curseurs) puis MCD.
6. Harnais `/#bench` et `/#components`, tests e2e (sélecteurs), script de bench.
7. Suppression de toute dépendance React ; `svelte-check`, lint, tests unitaires,
   e2e, build.
8. Mesures après migration (même matrice, même machine) et rapport avant/après.

## 5. Vérification

- `npm run build -w apps/web` (svelte-check + vite build) sans erreur ;
- `npm test` (tests unitaires : inchangés, ils portent sur la logique agnostique) ;
- `npm run test:e2e` (parcours projet, canvas, catalogue, sandbox plugins) ;
- revue visuelle écran par écran (thèmes sombre/clair) ;
- `node scripts/bench-web.mjs --tag svelte` comparé à `bench-react-baseline`.

## 6. État

Migration terminée le 2026-09-22 : toutes les étapes ci-dessus sont faites,
plus aucune dépendance ni aucun fichier React. Résultats avant/après
(performance du canvas, bundle) : [`perf/svelte-migration-results.md`](perf/svelte-migration-results.md).

Écart corrigé en cours de route : le premier cadrage du canvas (`fitView`)
se calculait avant que Svelte Flow ne mesure la largeur finale du panneau
(le panneau DBML se monte dans le même tick). Le canvas se recadre maintenant
quand le panneau change de taille, tant que l'utilisateur n'a pas déplacé la vue.

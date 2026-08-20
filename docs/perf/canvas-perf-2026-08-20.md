# Performance de l'éditeur canvas — mesures et optimisations (20/08/2026)

Chasse aux freezes / pertes de FPS de l'éditeur MLD, sur les gestes signalés :
zoom, déplacement d'une ou plusieurs tables, recoloration, changement de
propriété de colonne, affichage/masquage des liens et cardinalités,
suppression de colonnes.

## 1. Comment c'est mesuré

- **Banc d'essai in-app** : `apps/web/src/features/editor/bench`, accessible sur
  `/#bench?tables=500&columns=8&detail=full`. C'est **le vrai éditeur**
  (`ProjectEditor`, même pipeline doc -> nœuds -> arêtes, même panneau DBML) monté
  sur un schéma synthétique déterministe, avec le transport WebSocket remplacé
  par un Y.Doc local pré-rempli : aucun serveur, aucun réseau dans les chiffres.
  Le chunk est chargé en `lazy()` : coût nul pour une session normale.
- **Pilote** : `scripts/bench-web.mjs` (Playwright/CDP). Build de production,
  servi en local, gestes réellement injectés (molette + Ctrl, drag souris,
  clics sur la barre d'outils). Les mutations de schéma (couleur, flag de
  colonne, suppression de colonne) sont écrites dans le Yjs exactement comme le
  font les popovers — c'est le pipeline d'après-mutation qui coûte, pas le clic.
- **Métrique principale** : *blocking time* = temps passé dans des tâches du
  thread principal de plus de 50 ms pendant le geste (le proxy standard du « ça
  fige »). Complété par p95 / pire image, images perdues, et les spans
  `perfMonitor` de l'app.
- **Matrice** : 10 / 50 / 100 / 200 / 500 tables × niveaux de détail
  complet / standard / compact, plus un balayage 4 / 8 / 16 / 32 colonnes à
  100 tables. Fenêtre 1600×900, zoom fixé à 0,6 pour cadrer ~20 tables.
- **Réserve importante** : les runs comparatifs tournent en Chrome **headless**
  (rendu logiciel), ce qui amplifie le coût de peinture. Un run de contrôle
  headed (GPU) sur la build optimisée donne ≤ 199 ms de blocking partout à
  500 tables / standard, et 0 sur la plupart des scénarios. Les chiffres
  ci-dessous sont donc un **stress test comparatif**, pas le ressenti final sur
  une machine avec GPU.

Rejouer : `node scripts/bench-web.mjs --tag mon-run` (options : `--headed`,
`--matrix quick|multi`, `--only select-multi,drag-multi`, `--skip-build`).

## 2. Ce que l'état initial donnait

| geste | 200 t. complet | 500 t. standard | 500 t. complet |
| --- | ---: | ---: | ---: |
| afficher/masquer les liens | 4 946 ms | 6 946 ms | **53 129 ms** |
| sélection multiple (rubber band) | 471 ms | 1 007 ms | 3 022 ms |
| déplacer la sélection | 366 ms | 556 ms | 2 522 ms |
| déplacer une table | 259 ms | 540 ms | 2 082 ms |
| recolorer une table | 204 ms | 252 ms | 734 ms |
| supprimer des colonnes | 212 ms | 244 ms | 732 ms |
| ouverture du projet | 4 554 ms | 5 094 ms | 38 913 ms |

Deux constats structurants :

1. **Le niveau de détail pèse plus que le nombre de tables.** À 500 tables,
   passer de complet à compact divise le coût par ~30 : ce sont les lignes de
   colonnes (et leurs 4 handles chacune) qui font le volume de DOM.
2. **Le nombre de colonnes ne change presque rien en mode standard** (4 -> 32
   colonnes : 171 -> 238 ms sur le pire scénario), parce que standard n'affiche
   que les colonnes PK/FK. En mode complet, colonnes = lignes = coût.

## 3. Les goulots identifiés (et pourquoi)

### 3.1 Un sélecteur de store par table, en O(tables × relations)

`TableNode` répondait lui-même à « quelles de mes colonnes sont sur une relation
mise en évidence ? » via un `useStore` qui parcourait **tout** le tableau
d'arêtes. Zustand ré-exécute le sélecteur de *chaque* abonné à *chaque* mutation
du store — y compris un simple tick de transform pendant un zoom. Mesuré :
**1 511 000 exécutions** de ce sélecteur pour un seul basculement du bouton
« liens » à 500 tables (~1,5 s rien qu'à l'intérieur du sélecteur).

### 3.2 Le toggle « liens / cardinalités » passait par les props React

`highlightLinks` était injecté dans le `data` de chaque nœud : le basculer
reconstruisait les 500 objets de nœuds, re-rendait les 500 tables et toutes
leurs lignes… pour un changement de **couleur**.

### 3.3 Reconstruire un nœud = re-mesurer tout le canvas

Le point le plus coûteux et le moins visible. `adoptUserNodes` (React Flow)
considère le canvas entier comme « non mesuré » (`nodesInitialized = false`) dès
qu'**un** nœud arrive sans `measured`. Nos nœuds étant reconstruits à chaque mise
à jour du doc, une simple recoloration déclenchait une re-mesure complète :
`getBoundingClientRect` sur chaque handle de chaque table, soit ~16 000 layouts
forcés à 500 tables / complet — **~690 ms de style + layout** pour un changement
de couleur, profilé au CDP.

### 3.4 `EdgeLabelRenderer` de React Flow : un `querySelector` par arête et par mutation

Leur composant résout son conteneur via un sélecteur zustand qui appelle
`domNode.querySelector(...)`. Avec 500 relations montées, cela fait 500 requêtes
DOM à chaque changement du store (~70 ms par mutation, 270 ms sur un seul drag).

### 3.5 Détails annexes

- `useCanvasEdges` dépend du tableau de nœuds : toutes les arêtes (et leurs
  closures) étaient reconstruites **à chaque image** d'un drag.
- `onNodesChange` changeait d'identité à chaque image de drag, donc
  `<ReactFlow>` recevait une nouvelle prop à chaque image.
- `RemoteCursorsLayer` montait un `ViewportPortal` (même problème de
  `querySelector` que 3.4) même en session solo, sans aucun curseur à afficher.

## 4. Ce qui a été corrigé

| # | Correctif | Fichiers |
| --- | --- | --- |
| 1 | Le calcul « colonnes mises en évidence » se fait **une fois pour tout le canvas** (O(arêtes)) et chaque table lit sa clé en O(1) | `canvas/highlightedFields.ts`, `nodes/TableNode.tsx`, `canvas/CanvasArea.tsx` |
| 2 | Le toggle « liens » devient **une classe CSS** sur la racine du canvas, combinée au marqueur `is-fk` de chaque ligne — zéro travail React | `styles/canvas.css`, `nodes/table/tableStyles.ts`, `TableNodeRow.tsx`, `useCanvasNodes/*` |
| 3 | Cache de nœud par table : on ne reconstruit que la table qui a réellement changé (au lieu de ~15 closures × 500 tables par édition) | `useCanvasNodes/tableNodeCache.ts`, `buildTableNodes.ts` |
| 4 | Report du `measured` (et de la sélection) d'un rebuild à l'autre, avec identités stables — plus de re-mesure globale | `useCanvasNodes/useSelectionPreservingNodes.ts` |
| 5 | Portail d'étiquettes d'arêtes maison : conteneur résolu une fois, et monté seulement quand l'arête a quelque chose à afficher | `edges/EdgeLabelPortal.tsx`, `edges/RefEdge.tsx` |
| 6 | Géométrie des arêtes gelée pendant un drag (React Flow suit déjà les handles) + `onNodesChange` d'identité stable | `useCanvasEdges.ts`, `useNodesChangeHandler.ts` |
| 7 | Aucun `ViewportPortal` monté quand personne d'autre n'est sur le canvas | `collaboration/RemoteCursorsLayer.tsx` |

## 5. Résultats (blocking time en ms — avant -> **après**)

| config | zoom | zoom-links-on | drag-single | select-multi | drag-multi | recolor-multi | recolor-single | column-flag | highlight-toggle | delete-columns |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **10 t. full** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **10 t. standard** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **10 t. compact** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **50 t. full** | 0 | 0 | 15 → **0** | 0 | 0 | 14 → **0** | 15 → **0** | 19 → **0** | 239 → **0** | 14 → **0** |
| **50 t. standard** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **50 t. compact** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **100 t. full** | 0 | 0 | 83 → **0** | 48 → **0** | 67 → **0** | 83 → **0** | 76 → **0** | 74 → **0** | 1096 → **0** | 78 → **0** |
| **100 t. standard** | 0 | 0 | 8 → **0** | 0 | 0 | 9 → **0** | 5 → **0** | 7 → **0** | 171 → **0** | 5 → **0** |
| **100 t. compact** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **200 t. full** | 0 | 0 | 259 → **0** | 380 → **373** | 307 → **0** | 261 → **19** | 204 → **0** | 208 → **0** | 4946 → **28** | 212 → **0** |
| **200 t. standard** | 0 | 0 | 66 → **0** | 12 → **0** | 38 → **0** | 65 → **0** | 67 → **0** | 65 → **0** | 879 → **0** | 60 → **0** |
| **200 t. compact** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 153 → **0** | 0 |
| **500 t. full** | 69 → **42** | 383 → **136** | 2082 → **164** | 2905 → **841** | 2627 → **278** | 1076 → **245** | 734 → **22** | 769 → **52** | 53129 → **220** | 732 → **27** |
| **500 t. standard** | 0 → **23** | 2 → **14** | 540 → **28** | 851 → **126** | 653 → **46** | 307 → **4** | 252 → **0** | 304 → **14** | 6946 → **200** | 244 → **0** |
| **500 t. compact** | 0 | 7 → **0** | 179 → **0** | 254 → **5** | 192 → **0** | 87 → **0** | 65 → **0** | 108 → **6** | 1593 → **32** | 69 → **0** |

Balayage colonnes (100 tables, standard) :

| colonnes (100 t. standard) | zoom | zoom-links-on | drag-single | select-multi | drag-multi | recolor-multi | recolor-single | column-flag | highlight-toggle | delete-columns |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **8 colonnes** | 0 | 0 | 8 → **0** | 0 | 0 | 9 → **0** | 5 → **0** | 7 → **0** | 171 → **0** | 5 → **0** |
| **4 colonnes** | 0 | 0 | 9 → **0** | 0 | 0 | 6 → **0** | 5 → **0** | 7 → **0** | 173 → **0** | 3 → **0** |
| **16 colonnes** | 0 | 0 | 9 → **0** | 0 | 0 | 6 → **0** | 5 → **0** | 6 → **0** | 162 → **0** | 5 → **0** |
| **32 colonnes** | 0 | 0 | 14 → **0** | 0 | 0 | 8 → **0** | 5 → **0** | 6 → **0** | 238 → **0** | 9 → **0** |

Sélection multiple au vrai geste (rubber band ; la première campagne utilisait
un ctrl/maj-clic que ce canvas n'interprète pas comme additif) :

| config | select-multi | drag-multi | recolor-multi |
| --- | --- | --- | --- |
| **200 t. full** | 471 → **79** | 366 → **33** | 285 → **15** |
| **500 t. standard** | 1007 → **269** | 556 → **28** | 331 → **1** |
| **500 t. full** | 3022 → **802** | 2522 → **698** | 1155 → **187** |

Cadence d'images (p95 de l'intervalle entre images) :

| config | zoom p95 | zoom liens visibles p95 | drag p95 |
| --- | --- | --- | --- |
| 10 t. full | 13.5 → **13.5** ms | 13.4 → **13.4** ms | 13.4 → **13.4** ms |
| 10 t. standard | 13.5 → **13.5** ms | 13.5 → **13.4** ms | 13.5 → **13.4** ms |
| 10 t. compact | 13.5 → **13.5** ms | 13.5 → **13.4** ms | 13.5 → **13.4** ms |
| 50 t. full | 13.5 → **13.5** ms | 13.4 → **13.4** ms | 13.5 → **13.4** ms |
| 50 t. standard | 13.5 → **13.5** ms | 13.4 → **13.5** ms | 13.5 → **13.5** ms |
| 50 t. compact | 13.5 → **13.5** ms | 13.5 → **13.4** ms | 13.5 → **13.4** ms |
| 100 t. full | 13.5 → **13.5** ms | 13.5 → **13.6** ms | 13.4 → **13.5** ms |
| 100 t. standard | 13.5 → **13.5** ms | 13.5 → **13.4** ms | 13.5 → **13.5** ms |
| 100 t. compact | 13.5 → **13.4** ms | 13.5 → **13.4** ms | 13.5 → **13.4** ms |
| 200 t. full | 26.6 → **13.5** ms | 26.7 → **26.7** ms | 26.7 → **13.4** ms |
| 200 t. standard | 13.5 → **13.4** ms | 13.5 → **13.4** ms | 13.5 → **13.5** ms |
| 200 t. compact | 13.5 → **13.4** ms | 13.4 → **13.4** ms | 13.5 → **13.5** ms |
| 500 t. full | 40.2 → **26.8** ms | 66.8 → **53.5** ms | 106.7 → **40.1** ms |
| 500 t. standard | 26.7 → **26.7** ms | 40 → **26.8** ms | 66.7 → **13.5** ms |
| 500 t. compact | 13.5 → **13.5** ms | 26.7 → **26.7** ms | 40.1 → **13.5** ms |

Ouverture du projet (montage initial) :

| config | avant | après |
| --- | ---: | ---: |
| 10 t. full (8 col.) | 520 ms | **486 ms** |
| 10 t. standard (8 col.) | 456 ms | **450 ms** |
| 10 t. compact (8 col.) | 441 ms | **442 ms** |
| 50 t. full (8 col.) | 783 ms | **679 ms** |
| 50 t. standard (8 col.) | 539 ms | **529 ms** |
| 50 t. compact (8 col.) | 461 ms | **468 ms** |
| 100 t. full (8 col.) | 1559 ms | **1143 ms** |
| 100 t. standard (8 col.) | 714 ms | **640 ms** |
| 100 t. compact (8 col.) | 513 ms | **503 ms** |
| 200 t. full (8 col.) | 4554 ms | **2804 ms** |
| 200 t. standard (8 col.) | 1270 ms | **974 ms** |
| 200 t. compact (8 col.) | 660 ms | **599 ms** |
| 500 t. full (8 col.) | 38913 ms | **13314 ms** |
| 500 t. standard (8 col.) | 5094 ms | **2730 ms** |
| 500 t. compact (8 col.) | 1611 ms | **1086 ms** |
| 100 t. standard (4 col.) | 717 ms | **620 ms** |
| 100 t. standard (16 col.) | 712 ms | **636 ms** |
| 100 t. standard (32 col.) | 723 ms | **640 ms** |

### En résumé

- Jusqu'à **200 tables**, presque tous les gestes sont à **0 ms** de blocking.
- À **500 tables / complet**, le pire cas passe de **53 s à 0,22 s**
  (afficher/masquer les liens), le drag d'une table de 2,1 s à 0,16 s, la
  recoloration d'une table de 0,73 s à 0,02 s.
- L'**ouverture** d'un schéma de 500 tables en mode complet passe de 39 s à
  13 s ; en standard, de 5,1 s à 2,7 s.

## 6. Ce qui reste, et pistes

- **Sélection multiple à 500 tables / complet** (802 ms headless, ~96 ms avec
  GPU) : le profil CDP montre que le reste est de la **peinture** (623 ms de
  `Paint`), pas du JavaScript. Piste : `content-visibility: auto` sur les nœuds
  (virtualisation native sans démontage) — à valider, car les handles hors écran
  ne seraient plus mesurables par React Flow.
- **Le mode complet à 500 tables** reste le pire cas structurel : ~4 000 lignes
  de colonnes et ~16 000 handles dans le DOM. Le levier produit existe déjà (le
  niveau de détail) ; un passage automatique en compact sous un certain zoom
  serait cohérent.
- Le panneau DBML resérialise le schéma à chaque mise à jour du doc
  (`dbml.serialize` ~11 ms à 500 tables, `dbml.signature` ~10 ms) : négligeable
  aujourd'hui, à revoir s'il grossit.

## 7. Fichiers de mesures

- `docs/perf/bench-before.json` / `.md` — matrice complète avant.
- `docs/perf/bench-after.json` / `.md` — matrice complète après.
- `docs/perf/bench-before-multi.json`, `bench-after-multi.json` — sous-ensemble
  sélection multiple au geste rubber band.

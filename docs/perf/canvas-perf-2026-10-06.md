# Canvas sur un PC lent — mesures et correctifs (06/10/2026)

Un collègue voit le canvas saccader et le compteur `longtask` du HUD
(Ctrl+Maj+P) monter vite. Le banc d'essai tournait sur une machine rapide, où
le canvas Svelte paraissait déjà à 0 ms de blocage : le problème ne se voyait
pas.

## Mesurer un PC lent

`node scripts/bench-web.mjs --tag x --cpu 6 --skip-build --configs 100:8:full`

- `--cpu N` ralentit le thread principal N fois (CDP). 6× ≈ un portable modeste.
- `--profile` : fonctions les plus coûteuses par scénario (construire avec
  `BENCH_READABLE=1 npm run build -w apps/web` pour garder les noms).
- `--trace` : temps propre par étape du moteur de rendu (style, peinture, hit test…).
- `--css fichier.css` : injecte une feuille de style pour tester une hypothèse sans rebuild.
- Nouveaux scénarios : `pan`, `hover-sweep`, `zoom-again`, `idle-links-on`
  (lien visibles, souris immobile).
- La sortie sépare maintenant script / style / layout / autre (peinture, hit test, GC).

## Ce que montrait le profil

Sur 100 tables en détail complet à 6× : un zoom bloquait 3,4 s, un simple
déplacement de souris sans clic 0,4 s, et un canvas **immobile** avec les liens
surlignés occupait le thread principal en continu. Le JavaScript ne pesait que
~20 % : le reste était du travail du navigateur (peinture, compositing).

1. **Poignées de connexion** (4 par colonne + 4 par table) : masquées par
   `opacity: 0`, positionnées par `transform`. Chacune garde donc un nœud
   d'effet et de transformation que le navigateur parcourt à chaque image.
   Mesuré par injection CSS : −35 à −85 % de blocage sur pan/survol/zoom.
2. **Boutons d'action des lignes** (grip, crayon) : même problème (`opacity-0`),
   ~1 600 boutons cachés pour 100 tables.
3. **Animation « surligner les liens »** : un `stroke-dashoffset` n'est pas
   animable par le compositeur ; chaque image restyle et repeint toutes les
   relations, indéfiniment.
4. **Survol pendant un pan/zoom** : les tables glissent sous un pointeur immobile,
   chaque ligne « survolée » relançait le calcul des relations surlignées.
5. **`contain-intrinsic-size` sans `auto`** : une table hors écran retombait à
   220×120, puis reprenait sa vraie taille au retour, ce qui déclenchait une
   re-mesure complète de ses poignées (`getBoundingClientRect`, ~40 % du temps
   script d'un zoom).
6. Petits coûts : `elementFromPoint` à chaque mouvement de souris
   (`GlobalTooltip`), `screenToFlowPosition` à chaque événement
   (`collaboratorCursor`), un `$derived` de zoom revalidé à chaque image de pan.

## Correctifs

| Cause | Correctif |
| --- | --- |
| 1 | `.table-node .svelte-flow__handle` : `visibility: hidden`, plus de `transform` (marge négative) ; visible au survol de la ligne |
| 2 | `invisible` / `group-hover:visible` ; grip et crayon ne sont montés que pendant que la table est survolée (`actionsVisible`), avec un espace réservé de même taille |
| 3 | Au-delà de 40 relations, les liens surlignés sont des tirets fixes ; ceux de la table survolée ou sélectionnée restent animés |
| 4 | `ProjectEditor` ignore le survol entre `onmovestart` et `onmoveend` |
| 5 | `contain-intrinsic-size: auto 220px auto 120px` |
| 6 | Cf. `GlobalTooltip`, `collaboratorCursor`, `CanvasArea` ; `canvasEdges` renvoie le même tableau quand aucun drapeau de relation n'a changé |

## Résultats (blocking time en ms, CPU ×6, avant → après)

| config / scénario | avant | après |
| --- | ---: | ---: |
| 100 t. complet · zoom | 3 450 | 1 328 (zoom répété : 495) |
| 100 t. complet · pan | 607 | 0 |
| 100 t. complet · survol sans clic | 382 | 95 |
| 100 t. complet · zoom, liens affichés | 3 372 | 1 054 |
| 100 t. complet · déplacer la sélection | 245 | 57 |
| 200 t. standard · zoom, liens affichés | 1 411 | 958 |
| 200 t. standard · zoom répété | — | 93 |
| liens affichés, canvas immobile (travail « autre ») | 1 700 ms / 1,5 s | ~130 ms |

Données : `bench-slowpc-before.*` / `bench-slowpc-after.*`.

## Pistes testées sans effet mesurable (CPU ×6, 100 t. complet, 2 passes chacune)

À ne pas refaire sans nouvelle raison :

- trait de survol des relations (`.svelte-flow__edge-interaction`) en `stroke: transparent` ;
- `box-shadow: none` sur les tables ; `transition: none` sur tout le contenu des tables ;
- `contain: layout style paint` sur les tables ; `will-change: transform` sur le viewport (pire) ;
- supprimer `content-visibility: auto` : le premier zoom gagne ~30 % de JS (les tables
  hors écran ne sont plus mesurées à une fausse taille puis re-mesurées), mais le drag d'une
  sélection et un second zoom coûtent plus cher en peinture. Compromis non retenu ;
- le temps « autre » restant d'un zoom (~2 s à ×6 pour ~48 pas) est de la peinture/compositing
  incompressible avec des milliers d'éléments : ~15 ms par image à ×6, soit ~2,5 ms sur une machine normale.

Correctif ajouté : le lasso lit le rect du canvas avant d'écrire son style (plus de layout forcé à chaque image).

## Ce qui reste

- Le **premier** zoom d'une session reste le plus cher (1,3 s à 6× en 100 t. complet) :
  `getBoundingClientRect` des poignées de chaque table qui entre pour la première fois
  dans la vue (`updateNodeInternals` de Svelte Flow). Piste : ne mesurer
  que les poignées utilisées par une relation, ou mesurer en différé.
- La peinture elle-même (plusieurs milliers d'éléments en détail complet) : un
  passage automatique en détail « standard » sous un certain zoom reste le levier le plus fort.
- Les e2e `compare-projects`, `lint`, `environments`, la partie « Déployer » de
  `seeds` et d'autres échouent déjà sur le code d'origine (même message) : non traités ici.

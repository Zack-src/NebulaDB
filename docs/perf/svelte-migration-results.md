# Migration React → Svelte : résultats avant / après

Mesures du 2026-09-22, même machine, même matrice (`scripts/bench-web.mjs`, fenêtre
1600×900, zoom 0,6), même harnais `/#bench` (le vrai éditeur sur un schéma
synthétique, doc Yjs local). Avant = `main` (React 19 + React Flow 12.11),
après = branche `feat/svelte-migration` (Svelte 5 + Svelte Flow 1.6).
Détail scénario par scénario : [`bench-react-vs-svelte.md`](bench-react-vs-svelte.md)
(généré par `node scripts/bench-compare.mjs`), données brutes dans
`bench-react-baseline.json` et `bench-svelte.json`.

## Performance du canvas (18 configurations × 10 scénarios)

| Indicateur | React | Svelte | Écart |
| --- | ---: | ---: | ---: |
| Temps bloquant cumulé (tâches > 50 ms) | 784 ms | 331 ms | **−58 %** |
| … sur les 3 configs à 500 tables seulement | 702 ms | 284 ms | **−60 %** |
| Chargement + montage (somme des 18 configs) | 14 487 ms | 9 318 ms | **−36 %** |
| Images perdues (> 33 ms), somme | 197 | 118 | **−40 %** |
| … à 500 tables | 128 | 65 | −49 % |
| Pire image, somme des 180 scénarios | 5 323 ms | 3 840 ms | −28 % |
| p95 d'intervalle d'image, moyenne | 9,7 ms | 8,9 ms | −8 % |

Points forts, à 500 tables :

- **glisser une table / une sélection** : 20–29 ms de blocage → 0–3 ms, p95 21–28 ms → 7 ms (60 fps constant) ;
- **zoom** : 53–113 ms de blocage → 0–15 ms ;
- **sélection multiple** : p95 14–21 ms → 7 ms, plus aucune image perdue ;
- **bascule « surligner les liens »** : −35 à −55 % de blocage ;
- **montage initial** : 1,45–1,52 s → 0,81–1,02 s.

Régressions mesurées (une seule passe, à confirmer par une deuxième) :

- `zoom-links-on` en détail « complet » : 0 → 29 ms (100 tables) et 4 → 40 ms (500 tables)
  de blocage, alors que le p95 et les images perdues baissent sur ce même scénario à 500 tables ;
- `delete-columns` à 500 tables : +6 ms de blocage (19 → 25 et 16 → 22).

En dessous de 50 tables, les deux versions tiennent déjà 144 fps avec 0 ms de
blocage : la différence n'y est visible que sur le montage (−25 à −54 %).

## Taille du bundle (gzip, `vite build`)

| Chunk | React | Svelte | Écart |
| --- | ---: | ---: | ---: |
| `index` (code applicatif + runtime du framework) | 186,7 Ko | 153,3 Ko | −33,5 Ko |
| `xyflow` (moteur du canvas) | 76,3 Ko | 89,7 Ko | +13,4 Ko |
| i18n | 15,0 Ko | 14,9 Ko | ≈ |
| **Chemin critique d'une vue projet** (index + xyflow + i18n) | **278,1 Ko** | **257,9 Ko** | **−20,2 Ko (−7 %)** |
| Tous les fichiers JS/CSS | 727,9 Ko | 714,5 Ko | −13,4 Ko |

Les boîtes de dialogue chargées à la demande (import, export, historique,
plugins, déploiement…) prennent chacune 0,4 à 2,5 Ko gzip de plus : Svelte
compile le balisage en JS, alors que React envoie une seule fois un runtime
plus lourd. Ce n'est payé qu'à l'ouverture de la boîte de dialogue.

## Ce qui a été vérifié

- `svelte-check` : 0 erreur, 0 avertissement (799 fichiers) ; `vite build` OK ;
- ESLint (règles Svelte + règle « texte en dur » portée sur `SvelteText`) : 0 erreur ;
- tests unitaires : 59/59 ; `madge` : aucun cycle ;
- e2e Playwright : 4/4 (cycle de vie d'un projet, interactions canvas, catalogue
  de composants dans les deux thèmes, sandbox plugins) ;
- plus aucune dépendance React (`react`, `react-dom`, `@xyflow/react`,
  `@vitejs/plugin-react`, `vite-plugin-svgr`, `eslint-plugin-react-hooks`),
  aucun fichier `.tsx`.

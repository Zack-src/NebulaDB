# 05 — Design system, thèmes et composants

> Section « langage visuel et méthode de migration » du plan de refonte UI/UX d'AthanorDB.
> Périmètre : `apps/web` (Svelte 5 + Tailwind v4 pontée sur des variables CSS).
> Tous les ratios de ce document sont **calculés** (formule WCAG 2.x de luminance relative, plus APCA Lc en indication) par les scripts décrits en section 8.4. Aucune valeur n'est estimée à l'œil.
> Lecture : sections 1 (audit) et 2 (palette) = le « quoi » ; 3 à 5 = échelles et composants ; 6 = règles d'usage ; 7 à 9 = comment y aller.

## 0. Résumé décisionnel

1. **Le chantier est surtout un changement de valeurs, pas de classes.** Le dépôt est déjà tokenisé : `apps/web/src/styles/tokens.css` (264 lignes) alimente Tailwind via `tailwind.config.js`, et `text-text-muted` ou `bg-surface` s'écrivent déjà partout (367 occurrences de `text-text-muted`). Remplacer les valeurs du fichier de tokens corrige l'essentiel du « thème clair cramé » sans toucher aux composants. Les ~164 couleurs en dur restantes sont concentrées dans le canvas, le déploiement et les réglages.
2. **Les deux thèmes actuels échouent AA sur 37 à 40 % des paires mesurées** (sombre 21 sur 52, clair 19 sur 52 ; les paires « potentielles », comme le texte blanc sur un fond `success` plein, sont comptées même si le code ne les emploie pas encore). Le coupable n°1 est `--color-text-muted` (2,9:1 à 3,8:1 selon la surface), utilisé 367 fois, y compris pour les placeholders et les légendes.
3. **« Cramé » = saturation 72–98 % sur tous les accents du thème clair** (`#059669` 94 %, `#0284c7` 98 %, `#ea580c` 90 %), blanc pur `#ffffff` sur la surface élevée (luminance 1,0), fond froid bleuté, et teintes `rgba()` pastel qui rendent le texte coloré illisible (badge danger 3,9:1). La nouvelle palette passe les accents à 38–57 % de saturation (ambre 79 %, irréductible sans virer au boue) et remplace le blanc par un papier chaud `#fbfaf7` (luminance 0,956).
4. **Nouvelle palette** : 2 thèmes (`clair` « Papier », `sombre` « Ardoise »), 1 modificateur `contraste élevé`, 1 mode `système`. 88/88 paires exigées passent sur chaque thème ; texte principal en AAA partout (≥ 11,8:1), secondaire en AAA en clair (≥ 7,6:1) et ≥ 6,7:1 en sombre ; `text-muted` ≥ 5,6:1 en clair et ≥ 4,9:1 en sombre.
5. **Séparer « solide », « texte » et « fond doux » pour chaque sémantique** (`--color-danger`, `--color-danger-text`, `--color-danger-subtle`, `--color-danger-border`). Aujourd'hui une seule valeur sert de texte et de fond, ce qui est mathématiquement impossible à tenir en sombre.
6. **Bordures de contrôle** : les champs et cases utilisent un token dédié (`--color-border-control`, ≥ 3:1) ; les séparateurs décoratifs restent discrets. Aujourd'hui les bordures de champ font 1,2:1 à 1,8:1 (échec WCAG 1.4.11).
7. **Un seul principe de pop-up** : la modale n'est conservée que pour la **confirmation destructive**. Les 38 fichiers qui déclarent `<Modal>` sont redistribués en tiroirs (drawer), pages et éditions en ligne (section 6.2, tableau exhaustif).
8. **Garde-fous automatisés avant toute migration visuelle** : test de contraste dans `npm test`, règle de « cliquet » contre les couleurs en dur, baselines de captures dans le harnais E2E existant (qui n'est **pas** exécuté en CI aujourd'hui, point à décider, section 10).
9. **Estimation globale** : 13 lots (0 à 12), environ 66 à 90 jours-développeur ; le thème clair corrigé (lots 0 à 2) demande 8 à 10 jours dont **2 à 3 pour le lot 2 lui-même**, et peut sortir seul derrière un drapeau d'aperçu.

---

## 1. Audit de l'existant

### 1.1 Architecture actuelle des couleurs (vérifiée dans le code)

| Élément | Où | Constat |
|---|---|---|
| Tokens | `apps/web/src/styles/tokens.css` | `:root` = sombre « obsidian » par défaut ; `:root[data-theme="light"]` = surcharge claire. 264 lignes. |
| Pont Tailwind | `apps/web/tailwind.config.js` | `colors`, `fontSize`, `borderRadius`, `boxShadow`, `transitionDuration` → `var(--…)`. Tailwind v4 chargé via `@config`, preflight désactivé (`styles/tailwind.css`). |
| Application du thème | `apps/web/src/utils/theme.ts` + script inline de `apps/web/index.html` | `ThemePreset = "obsidian" \| "midnight" \| "emerald" \| "light"`. Seul `light` pose `data-theme`. Le script de boot n'examine que `localStorage["athanordb.theme"] === "light"`. |
| Choix utilisateur | `features/settings/SettingsTabContent.svelte` (l. 4-27, 133-155) | 4 cartes ; `midnight` et `emerald` sont marquées « bientôt », désactivées, avec des pastilles en dur (`bg-[#0f172a]`, `bg-[#064e3b]`, `border-blue-500`, `border-emerald-500`). |
| Couleurs d'environnement | `features/environments/EnvironmentBadge.svelte` | `STAGE_COLOR` mappe 7 couleurs (green, blue, violet, amber, orange, red, grey) sur des tokens ; fond `color-mix(… 14 %)`, bordure `45 %`, `text-[10px] font-bold uppercase`. La prod est forcée en rouge. |
| Couleurs de données canvas | `features/editor/canvas/canvasMinimapColor.ts`, `edges/refEdgeTypes.ts`, `edges/RefEdge.svelte`, `nodes/table/tableStyles.ts`, `nodes/StickyNoteNode.svelte`, `components/inputs/colorSwatches.ts` | Toutes en dur (hex), indépendantes du thème. |
| Éditeur DBML (CodeMirror) | `features/editor/dbml/language.ts` + `searchPanel.ts` | La coloration lit déjà `--color-syntax-*` et `--color-editor-*` (bon point). Le panneau de recherche porte 20 couleurs en dur. |
| Non suivi du système | — | Aucune occurrence de `prefers-color-scheme`, `prefers-contrast` ni `forced-colors` dans `src/` (seul `prefers-reduced-motion` est géré, `tokens.css` l. 258 et `ToastHost.svelte`). |

### 1.2 Mesures (script `scan2.mjs`, 399 fichiers `.svelte`/`.ts`/`.css`/`.js` hors tests)

Les chiffres excluent `tokens.css`, qui est le seul endroit où une couleur en dur est légitime.

| Mesure | Valeur |
|---|---|
| Hex en dur (`#rgb`, `#rrggbb`) | **86** occurrences, **44** valeurs distinctes (quelques faux positifs : regex `#[0-9a-fA-F]{3,8}` dans `language.ts`) |
| `rgb()/rgba()` en dur | **22** |
| Classes à valeur arbitraire (`bg-[#…]`, `border-[rgb…]`…) | **10** |
| Classes de palette Tailwind brute (`indigo-600`, `emerald-500`, `slate-400`…) | **46** |
| `bg-white`/`text-black`/`border-white/15`… | **42** (dont 25 `text-white`) |
| Total hors tokens | **≈ 164** + 42 blanc/noir |
| Plus gros porteurs | `editor/dbml/searchPanel.ts` (20), `inputs/colorSwatches.ts` (15), `settings/SettingsTabContent.svelte` (11), `connections/deployment/DeploymentDiffStep.svelte` (9) et `DeploymentRisksStep.svelte` (9), `styles/canvas.css` (8), `dev/PerfHud.svelte` (7), `ui/Button.svelte` (6) |
| Par domaine | éditeur 63, déploiement/connexions 31, `components/inputs` 15, réglages 11, `components/ui` 8, `canvas.css` 8, admin 6, projets 6, auth 4 |
| Couleurs les plus répétées | `#6366f1` (6), `#f59e0b` (6), `#a855f7` (4), `#06b6d4` (4), `#818cf8` (4), `#ef4444` (3) : ce sont les anciens tokens recopiés à la main |
| Modales | **38** fichiers déclarent `<Modal>` (dont `ConfirmDialog` et `TableLocksList`) ; **12** fichiers emploient `ConfirmDialog` ; 3 largeurs (`narrow` 440 px, défaut 640 px, `wide` 760 px) ; coque unique `components/overlays/Modal.svelte` (bon : focus piégé, retour du focus, Échap, scroll verrouillé) |
| Boutons | `<Button>` 280 usages ; `<button>` bruts **126** ; 8 variantes dont `gradient` et `glow` (aucun usage littéral `variant="gradient\|glow"` : code mort à supprimer) |
| Tailles de police | tokens `text-caption/label/body-sm/body/heading` : **80** usages ; `text-xs` (Tailwind brut, 12 px) : **249** ; `text-sm/base/lg/xl` : 27 ; tailles arbitraires `text-[Npx]` : **≈ 200** sur **13 valeurs distinctes** (9, 9,5, 10, 10,5, 11, 11,5, 12, 12,5, 13, 13,5, 14, 15, 17 px) dont **36 occurrences ≤ 10,5 px** |
| Espacements arbitraires | ≈ 17 (`px-[7px]`, `gap-[5px]`…) : l'espacement est globalement sain |
| Rayons | `rounded-sm` 60, `rounded-md` 59, `rounded-full` 46, `rounded-lg` 42, `rounded-xl` 19, `rounded` 19, `rounded-xs` 3 |
| Ombres | `shadow-lg` 18, `-md` 12, `-xs` 11, `-sm` 11, `-xl` 3, `-2xl` 3 (alias de `xl`) |
| z-index | 10 via tokens `--z-*`, 6 valeurs arbitraires `z-[NNN]` |
| États de focus | `focus-visible:` 65, `focus:` 21, `outline-hidden/none` 20, `focus:ring` 6 : trois conventions concurrentes. `Input` utilise `focus:` (anneau `primary/25`, donc quasi invisible), `Button` utilise `focus-visible:outline-primary` |
| États désactivés | `opacity-45` (Button), `opacity-50` (champs), `opacity-40` (cartes de thème) : trois valeurs |
| États d'erreur | `INPUT_INVALID_CLASS` (9 usages) mais `aria-invalid` seulement 4 fois : l'erreur est portée par la couleur seule dans la plupart des cas |

### 1.3 Contrastes des thèmes actuels (calculés)

Seuil appliqué : **4,5:1** pour le texte, **3:1** pour les composants d'interface (bordures de champ, anneaux de focus). Les fonds « doux » (`*-light`) sont le `rgba` du token composé sur `--color-surface`.

#### Thème sombre actuel (« obsidian ») : 21 sur 52 paires en échec

| Paire (texte / fond) | Couleurs | Ratio | Seuil |
|---|---|---|---|
| text-muted / bg | `#656c82 / #090a0f` | **3.79** | 4.5:1 |
| text-muted / surface | `#656c82 / #13151f` | **3.48** | 4.5:1 |
| text-muted / raised | `#656c82 / #1a1d2b` | **3.20** | 4.5:1 |
| text-muted / hover | `#656c82 / #222638` | **2.87** | 4.5:1 |
| white / primary (btn) | `#ffffff / #6366f1` | **4.47** | 4.5:1 |
| white / primary-hover | `#ffffff / #818cf8` | **2.98** | 4.5:1 |
| primary (texte) / surface | `#6366f1 / #13151f` | **4.07** | 4.5:1 |
| primary (texte) / bg | `#6366f1 / #090a0f` | **4.43** | 4.5:1 |
| primary / primary-light(sur surface) | `#6366f1 / #202241` | **3.44** | 4.5:1 |
| white / success (bouton plein) | `#ffffff / #10b981` | **2.54** | 4.5:1 |
| white / warning (bouton plein) | `#ffffff / #f59e0b` | **2.15** | 4.5:1 |
| danger / danger-light (badge) | `#ef4444 / #321c24` | **4.20** | 4.5:1 |
| white / danger (bouton plein) | `#ffffff / #ef4444` | **3.76** | 4.5:1 |
| white / info (bouton plein) | `#ffffff / #38bdf8` | **2.14** | 4.5:1 |
| white / locked (bouton plein) | `#ffffff / #94a3b8` | **2.56** | 4.5:1 |
| muted / bg (placeholder input) | `#656c82 / #13151f` | **3.48** | 4.5:1 |
| border / surface (UI 3:1) | `#292d3f / #13151f` | **1.33** | 3:1 |
| border-strong / surface (UI 3:1) | `#3b415a / #13151f` | **1.81** | 3:1 |
| border-strong / bg (UI 3:1) | `#3b415a / #090a0f` | **1.97** | 3:1 |
| syntax comment / editor-bg | `#5c6370 / #17181b` | **2.94** | 4.5:1 |
| syntax gutter / editor-bg | `#475569 / #17181b` | **2.34** | 4.5:1 |

#### Thème clair actuel : 19 sur 52 paires en échec

| Paire (texte / fond) | Couleurs | Ratio | Seuil |
|---|---|---|---|
| text-muted / bg | `#7d8296 / #f4f5f8` | **3.50** | 4.5:1 |
| text-muted / surface | `#7d8296 / #fbfcfe` | **3.72** | 4.5:1 |
| text-muted / raised | `#7d8296 / #ffffff` | **3.81** | 4.5:1 |
| text-muted / hover | `#7d8296 / #f1f3f8` | **3.44** | 4.5:1 |
| success (texte) / surface | `#059669 / #fbfcfe` | **3.67** | 4.5:1 |
| success / success-light (badge) | `#059669 / #ddf0ec` | **3.18** | 4.5:1 |
| white / success (bouton plein) | `#ffffff / #059669` | **3.77** | 4.5:1 |
| warning / warning-light (badge) | `#b45309 / #f2e8e1` | **4.16** | 4.5:1 |
| danger / danger-light (badge) | `#dc2626 / #f7e2e4` | **3.90** | 4.5:1 |
| info (texte) / surface | `#0284c7 / #fbfcfe` | **3.99** | 4.5:1 |
| info / info-light (badge) | `#0284c7 / #ddeef7` | **3.44** | 4.5:1 |
| white / info (bouton plein) | `#ffffff / #0284c7` | **4.10** | 4.5:1 |
| stage-orange / pastille | `#ea580c / #f9e8e1` | **2.99** | 4.5:1 |
| muted / bg (placeholder input) | `#7d8296 / #fbfcfe` | **3.72** | 4.5:1 |
| border / surface (UI 3:1) | `#e2e5ec / #fbfcfe` | **1.23** | 3:1 |
| border-strong / surface (UI 3:1) | `#c7cbd6 / #fbfcfe` | **1.58** | 3:1 |
| border-strong / bg (UI 3:1) | `#c7cbd6 / #f4f5f8` | **1.49** | 3:1 |
| syntax op / editor-bg | `#db2777 / #fbfcfe` | **4.48** | 4.5:1 |
| syntax gutter / editor-bg | `#94a3b8 / #fbfcfe` | **2.50** | 4.5:1 |

#### Autres échecs mesurés hors tokens

| Élément | Fichier | Couleurs | Ratio |
|---|---|---|---|
| Relation 1–n sur canvas clair | `edges/refEdgeTypes.ts` | `#34d399` / `#eef0f4` | **1,68** |
| Relation n–n sur canvas clair | idem | `#fbbf24` / `#eef0f4` | **1,46** |
| Relation 1–1 sur canvas clair | idem | `#818cf8` / `#eef0f4` | **2,61** |
| Relation atténuée sur canvas sombre | `edges/RefEdge.svelte` (`DIMMED_STROKE`) | `#475569` / `#0d0e14` | **2,54** |
| Nom de colonne lié | `styles/canvas.css` l. 63 | `#a5b4fc` / `#fbfcfe` (clair) | **1,94** |
| Zone ambre dans la minimap | `canvasMinimapColor.ts` | `#f59e0b` / blanc | **2,15** |
| Grille du canvas | `tokens.css` | `#d7dae2` / `#eef0f4` (clair) ; `#33353c` / `#0d0e14` (sombre) | 1,23 ; 1,57 (décoratif, acceptable) |

### 1.4 Trois défauts structurels à corriger (pas seulement des valeurs)

**a) `prefersDarkText()` choisit le mauvais texte.** `apps/web/src/utils/color.ts` bascule en texte sombre au-dessus de la luminance 0,42. Le vrai point d'égalité entre blanc et `#13151f` est à **L = 0,197**. Entre 0,197 et 0,42, le code met du **blanc** sur des fonds où le noir est meilleur. Appliqué à `DEFAULT_PALETTE` de `components/inputs/colorSwatches.ts` (15 teintes proposées pour les en-têtes de tables), **10 teintes sur 15 donnent un texte en dessous de 4,5:1** : `#ef4444` 3,76 ; `#22c55e` 2,28 ; `#14b8a6` 2,49 ; `#f97316` 2,80 ; `#0ea5e9` 2,77 ; `#06b6d4` 2,43 ; `#ec4899` 3,53 ; `#f43f5e` 3,67 ; `#a855f7` 3,96 ; `#6366f1` 4,47. C'est le bug de lisibilité le plus visible sur le diagramme.

**b) Les effets « verre » ne suivent pas le thème.** `styles/utilities.css` code `.glass-panel` en `rgba(19, 21, 31, 0.75)` et `.glass-card` en `rgba(26, 29, 43, 0.6)`, `.gradient-bg-hero` en `rgba(99,102,241,…)`. `features/auth/Login.svelte` (l. 86) pose `Card variant="glow"` + `glass-panel` : en thème clair, le texte (`--color-text` quasi noir) se retrouve sur un fond **sombre** (à confirmer visuellement, la logique CSS ne laisse pas d'autre résultat). Le chevron de `.app-select` est un SVG avec `stroke='%239ea5b8'` figé.

**c) Une valeur pour deux usages.** `--color-danger`, `--color-success`, etc. servent à la fois de couleur de texte (`text-danger`, 51 usages) et de fond plein (`bg-danger`, 17 usages). En clair, `#dc2626` fonctionne pour les deux ; en sombre, il faut `#f2918a` pour le texte et `#c2433b` pour le fond. Un token unique ne peut pas satisfaire les deux : d'où le découpage en 4 rôles (section 2.3).

### 1.5 Ce qui est déjà bon (à conserver)

- Pont tokens → Tailwind en une seule source de vérité ; couches CSS explicites (`@layer theme, base, components, utilities, app`).
- `Modal.svelte` : piège de focus, restauration du focus, Échap, verrouillage du scroll, fermeture au backdrop seulement si appui **et** relâchement dessus.
- `Button` : l'étiquette accessible des boutons icône est dérivée du `data-tooltip`.
- Échelle de mouvement (`--motion-*`) mise à zéro sous `prefers-reduced-motion`.
- `ToastHost` : `role="region"`, `aria-live="polite"`.
- `DataGrid` virtualisé (`rowHeight`, `overscan`), `Splitter`, `Skeleton*`, `SegmentedControl`, `Tabs` (pill/line/boxed), `Popover`/`Menu`.
- Règles ESLint déjà en place pour guider la migration (`HARD_CODED_TEXT`, `NATIVE_CONTROLS_NOT_MIGRATED` dans `eslint.config.js`) : le même mécanisme servira pour les couleurs (section 8.2).
- Un catalogue de composants rendable sans authentification (`#components`, `components/dev/ComponentCatalogue.svelte`) et son test `e2e/component-catalogue.e2e.ts` : base idéale des captures de non-régression.

### 1.6 Couleurs « cramées » identifiées (thème clair actuel)

| Rôle | Valeur actuelle | Saturation HSL | Problème | Remplacement |
|---|---|---|---|---|
| Surface élevée | `#ffffff` | 0 % | Blanc pur, luminance 1,0 : éblouissant en grand aplat, contraste de 18,4:1 avec le texte, et rien ne se distingue du fond | `#fbfaf7` (L = 0,956) |
| Fond d'app | `#f4f5f8` | 22 % | Dominante bleue froide | `#eeece7` (neutre chaud, saturation 17 %, luminance 0,84) |
| Marque | `#4f46e5` | **75 %** | Indigo électrique, vibre sur fond clair | `#4a4fa6` (**38 %**) |
| Succès | `#059669` | **94 %** | Émeraude fluo ; 3,67:1 en texte (échec) | `#2b6e4c` (44 %) texte `#22573c` |
| Info | `#0284c7` | **98 %** | Bleu saturé ; 3,99:1 en texte (échec) | `#2a6a98` (57 %) |
| Danger | `#dc2626` | 72 % | Rouge vif, 3,9:1 sur pastille | `#b03a33` (55 %) texte `#8e2d27` |
| Orange d'étape | `#ea580c` | **90 %** | 2,99:1 sur sa pastille | `#a24e1a` texte `#7f3a10` |
| Violet d'étape / accent | `#7c3aed` / `#9333ea` | 83 % / 81 % | Violets néon ; `accent-purple`/`accent-cyan` ne servent qu'à la page de connexion | `#7647a0`, tokens `accent-*` supprimés |
| Fonds doux | `rgba(x, 0.12)` sur blanc | n/a | Lavis translucides : la couleur du texte coloré ne tient pas 4,5:1 | fonds opaques calculés, pré-composés |
| Bordures | `#e2e5ec` / `#c7cbd6` | n/a | 1,23:1 et 1,58:1 : ni décoratives apaisées ni lisibles comme contrôles | trois paliers (subtle / border / control) |
| Ombres | `rgba(15,23,42,…)` | n/a | Gris-bleu froid | ombres chaudes `rgba(60,50,30,…)` |

---

## 2. Nouvelle palette

### 2.1 Principes

1. **Papier chaud, pas écran blanc** : en clair, aucun aplat > `#fbfaf7`. L'élévation se lit par la **luminosité de la surface** (plus lumineux = plus haut) et la bordure, pas par une grosse ombre.
2. **Accents désaturés** : saturation HSL ≤ 57 % (≤ 79 % pour l'ambre) ; la couleur dit « catégorie », jamais « alarme » par défaut. Seul le danger peut rester franc.
3. **Quatre rôles par sémantique** : `solide` (fond de bouton/pastille pleine, texte blanc dessus), `text` (texte sur surface neutre ou sur fond doux), `subtle` (fond doux opaque), `border`.
4. **Trois paliers de bordure** : `border-subtle` (séparateurs décoratifs, exempts WCAG), `border` (cartes, panneaux), `border-control` (champs, cases, boutons secondaires : ≥ 3:1 sur toute surface, conforme 1.4.11), plus `border-strong` (survol/actif).
5. **Le texte coloré ne dépend jamais seul de la couleur** : icône ou libellé accompagnent chaque statut (WCAG 1.4.1).
6. **Le sombre garde son esprit « Ardoise »** (bleu-gris profond) mais remonte `text-muted`, les bordures de contrôle, le commentaire de code, le gutter.
7. **Les tokens sont en hex opaques**. Plus de `rgba` pour les fonds doux : un ratio ne se vérifie que sur une couleur composée connue. Les surcouches dynamiques (survol sur une zone colorée) restent possibles avec `color-mix()`, déjà utilisé dans `EnvironmentBadge.svelte`.

### 2.2 Échelle d'élévation

```
CLAIR « Papier »                         SOMBRE « Ardoise »
bg-canvas  #e8e5df  zone de travail      bg-canvas  #13161c  zone de travail
bg         #eeece7  fond d'application   bg         #0f1115  fond d'application
surface-1  #f6f4f0  panneaux, cartes     surface-1  #181b22  panneaux, cartes
surface-2  #fbfaf7  popovers, modales,   surface-2  #1f232c  popovers, modales,
                    champs, nœuds                            champs, nœuds
surface-3  #e7e4dd  survol / pressé /    surface-3  #282d38  survol / pressé /
                    sélection neutre                         sélection neutre
```

En clair, `surface-2` est la **plus claire** (on « monte » vers la lumière) ; en sombre, elle est plus claire que `surface-1` aussi. La règle « plus haut = plus clair » vaut donc pour les deux thèmes et simplifie l'écriture des composants (`Drawer`, `Popover`, `Menu` = `surface-2`).

### 2.3 Tokens sémantiques (noms)

| Nouveau token | Rôle | Remplace (tokens existants) |
|---|---|---|
| `--color-bg` | fond de l'application | `--color-bg` (inchangé) |
| `--color-bg-canvas` | zone du diagramme | `--color-bg-canvas` (inchangé) |
| `--color-surface-1` | panneaux, cartes, barres | `--color-surface` |
| `--color-surface-2` | élevé : popover, modale, champ, nœud | `--color-surface-raised` |
| `--color-surface-3` | survol, pressé, sélection neutre | `--color-surface-hover` |
| `--color-overlay` | voile derrière modale | `--color-overlay` (inchangé, valeurs revues) |
| `--color-border-subtle` | séparateurs décoratifs | nouveau (≈ ancien `border` à 50 % d'opacité, déjà utilisé via `border-border/60`) |
| `--color-border` | cadre de carte/panneau | `--color-border` |
| `--color-border-control` | champs, cases, boutons secondaires (≥ 3:1) | `--color-border-strong` (usage « contrôle ») |
| `--color-border-strong` | survol/actif d'un contrôle | `--color-border-strong` (usage « hover ») |
| `--color-text` | texte principal | inchangé |
| `--color-text-secondary` | texte secondaire | inchangé |
| `--color-text-muted` | aide, légende, placeholder (≥ 4,5:1 garanti) | inchangé (valeur corrigée) |
| `--color-text-disabled` | texte désactivé (exempté WCAG) | nouveau, remplace `opacity-45/50` sur le texte |
| `--color-on-primary` | texte sur fond `primary` | `--color-text-on-accent` |
| `--color-ink` | texte sombre fixe (sur jaune, sur teinte claire) | `--color-text-on-light` |
| `--color-primary` | fond plein marque (bouton principal) | `--color-primary` |
| `--color-primary-hover` | survol du fond plein | `--color-primary-hover` |
| `--color-primary-text` | lien, icône active, accent de texte (≥ 6,8:1) | **nouveau** : remplace `text-primary` (42 usages) |
| `--color-primary-subtle` | fond doux (sélection, onglet actif) | `--color-primary-light` |
| `--color-primary-border` | bordure d'accent | `--color-primary-border` |
| `--color-focus-ring` | anneau de focus | nouveau (aujourd'hui = `outline-primary`) |
| `--color-success` · `-text` · `-subtle` · `-border` | solide / texte / fond doux / bordure | `--color-success`, `-hover`, `-light`, `-border` |
| idem `warning`, `danger`, `info`, `locked` | | idem |
| `--color-env-{green,blue,violet,amber,orange,red,grey}-{fg,bg,border,dot}` | pastilles d'environnement | `--color-stage-violet`, `--color-stage-orange`, usage de `success/info/warning/danger/text-muted` par `STAGE_COLOR` |
| `--color-data-1…12` | teintes d'en-têtes de tables, zones, groupes | `DEFAULT_PALETTE` (`colorSwatches.ts`), `DEFAULT_HEADER_COLOR`, constantes de `canvasMinimapColor.ts` |
| `--color-edge-{one-to-one,one-to-many,many-to-many,dimmed,issue,highlight}` | relations | `CARDINALITY_STYLE`, `DIMMED_STROKE`, `ISSUE_STROKE` |
| `--color-chart-1…6` | graphiques, sparklines | nouveau |
| `--color-sticky-{bg,ink,border}` | notes adhésives | `#fef08a`, `#ca8a04`, `rgba(35,37,42,.45)` en dur |
| `--color-canvas-grid` | grille | inchangé |
| `--color-editor-*`, `--color-syntax-*` | CodeMirror | inchangés (valeurs corrigées) ; `editor-gutter-bg` = `editor-bg`, `editor-border` = `border`, `editor-tooltip-bg` = `surface-2`, `editor-tooltip-border` = `border`, `editor-muted` = `text-muted` deviennent des alias `var()` |

Tokens **supprimés** : `--color-accent-purple`, `--color-accent-cyan` (uniquement le dégradé du logo de connexion), `--shadow-glow`, `.glow-indigo`, `.gradient-bg-hero`, variantes de bouton `gradient`/`glow`.

### 2.4 Valeurs prêtes à coller : thème clair « Papier »

`apps/web/src/styles/tokens/theme-light.css` (généré, voir 8.1). `:root[data-theme="light"]`.

```css
:root[data-theme="light"] {
  /* Neutres */
  --color-bg: #eeece7;
  --color-bg-canvas: #e8e5df;
  --color-surface-1: #f6f4f0;
  --color-surface-2: #fbfaf7;
  --color-surface-3: #e7e4dd;
  --color-text: #1f1e1b;
  --color-text-secondary: #47443e;
  --color-text-muted: #5c5850;
  --color-text-disabled: #8e8a80;
  --color-border-subtle: #ddd9d0;
  --color-border: #cfcabf;
  --color-border-control: #837e73;
  --color-border-strong: #625e55;
  /* Marque */
  --color-primary: #4a4fa6;
  --color-primary-hover: #3e4392;
  --color-primary-text: #3e4392;
  --color-primary-subtle: #e3e4f2;
  --color-primary-border: #b3b6dc;
  --color-on-primary: #ffffff;
  --color-focus-ring: #3e4392;
  /* Sémantiques : solide / texte / fond doux / bordure */
  --color-success: #2b6e4c;
  --color-success-text: #22573c;
  --color-success-subtle: #dfebe2;
  --color-success-border: #a9cbb5;
  --color-warning: #8a5410;
  --color-warning-text: #6e410b;
  --color-warning-subtle: #f2e6d2;
  --color-warning-border: #d7b98a;
  --color-danger: #b03a33;
  --color-danger-text: #8e2d27;
  --color-danger-subtle: #f4deda;
  --color-danger-border: #dda9a3;
  --color-info: #2a6a98;
  --color-info-text: #1f5379;
  --color-info-subtle: #dce9f2;
  --color-info-border: #a4c2d9;
  --color-locked: #5b6270;
  --color-locked-text: #464c58;
  --color-locked-subtle: #e3e5e8;
  --color-locked-border: #b9bec6;
  /* Éditeur DBML / SQL */
  --color-editor-bg: #f9f8f4;
  --color-editor-gutter-text: #6f6b62;
  --color-editor-active-line: #efede7;
  --color-editor-selection: #cfd2ee;
  --color-syntax-comment: #6a665d;
  --color-syntax-keyword: #7a3fa6;
  --color-syntax-modifier: #8a5410;
  --color-syntax-type: #0f6b73;
  --color-syntax-class: #2a5fb0;
  --color-syntax-variable: #2b2a26;
  --color-syntax-string: #2b6e4c;
  --color-syntax-number: #a24a12;
  --color-syntax-operator: #b03872;
  --color-syntax-punctuation: #5f5b53;
  --color-syntax-brace: #47443e;
  /* Environnements : texte / fond / bordure / pastille */
  --color-env-green-fg: #22573c;
  --color-env-green-bg: #dfebe2;
  --color-env-green-border: #a9cbb5;
  --color-env-green-dot: #2b6e4c;
  --color-env-blue-fg: #1f5379;
  --color-env-blue-bg: #dce9f2;
  --color-env-blue-border: #a4c2d9;
  --color-env-blue-dot: #2a6a98;
  --color-env-violet-fg: #53388a;
  --color-env-violet-bg: #e8e1f3;
  --color-env-violet-border: #bba8d9;
  --color-env-violet-dot: #7647a0;
  --color-env-amber-fg: #6e410b;
  --color-env-amber-bg: #f2e6d2;
  --color-env-amber-border: #d7b98a;
  --color-env-amber-dot: #8a5410;
  --color-env-orange-fg: #7f3a10;
  --color-env-orange-bg: #f3e0d3;
  --color-env-orange-border: #d9ab8c;
  --color-env-orange-dot: #a24e1a;
  --color-env-red-fg: #8e2d27;
  --color-env-red-bg: #f4deda;
  --color-env-red-border: #dda9a3;
  --color-env-red-dot: #b03a33;
  --color-env-grey-fg: #464c58;
  --color-env-grey-bg: #e3e5e8;
  --color-env-grey-border: #b9bec6;
  --color-env-grey-dot: #5b6270;
  /* Données du canvas (tables, zones, groupes) : 12 teintes, texte blanc ≥ 4,5:1 */
  --color-data-1: #46505e;
  --color-data-2: #4a4fa6;
  --color-data-3: #2f6a9b;
  --color-data-4: #1f6f78;
  --color-data-5: #3a7050;
  --color-data-6: #66701f;
  --color-data-7: #85650f;
  --color-data-8: #a24e1a;
  --color-data-9: #a9423b;
  --color-data-10: #a04570;
  --color-data-11: #7647a0;
  --color-data-12: #6b665c;
  /* Relations */
  --color-edge-one-to-one: #4a4fa6;
  --color-edge-one-to-many: #2a6c4d;
  --color-edge-many-to-many: #8e5c10;
  --color-edge-dimmed: #7c776c;
  --color-edge-issue: #b03a33;
  --color-edge-highlight: #2b2f8a;
  /* Graphiques */
  --color-chart-1: #4a4fa6;
  --color-chart-2: #1f6f78;
  --color-chart-3: #85650f;
  --color-chart-4: #a04570;
  --color-chart-5: #2f6a9b;
  --color-chart-6: #3a7050;
  /* Divers canvas */
  --color-canvas-grid: #bdb8ad;
  --color-sticky-bg: #f4e7a6;
  --color-sticky-ink: #2b2616;
  --color-sticky-border: #8f7a1f;
  --color-overlay: rgba(31, 30, 27, 0.42);
  --shadow-1: 0 1px 2px rgba(60, 50, 30, 0.10), 0 0 0 1px rgba(60, 50, 30, 0.04);
  --shadow-2: 0 4px 14px rgba(60, 50, 30, 0.14), 0 1px 3px rgba(60, 50, 30, 0.08);
  --shadow-3: 0 16px 40px rgba(60, 50, 30, 0.20), 0 4px 12px rgba(60, 50, 30, 0.10);
  color-scheme: light;
}
```

### 2.5 Valeurs prêtes à coller : thème sombre « Ardoise »

```css
:root,
:root[data-theme="dark"] {
  /* Neutres */
  --color-bg: #0f1115;
  --color-bg-canvas: #13161c;
  --color-surface-1: #181b22;
  --color-surface-2: #1f232c;
  --color-surface-3: #282d38;
  --color-text: #ecedf1;
  --color-text-secondary: #b0b5c2;
  --color-text-muted: #929aab;
  --color-text-disabled: #5e6474;
  --color-border-subtle: #262b35;
  --color-border: #333947;
  --color-border-control: #7c8499;
  --color-border-strong: #a0a7b8;
  /* Marque */
  --color-primary: #4f53cf;
  --color-primary-hover: #5d61db;
  --color-primary-text: #a9adff;
  --color-primary-subtle: #25284d;
  --color-primary-border: #4a4f96;
  --color-on-primary: #ffffff;
  --color-focus-ring: #a9adff;
  /* Sémantiques : solide / texte / fond doux / bordure */
  --color-success: #2e7d57;
  --color-success-text: #7ad0a0;
  --color-success-subtle: #17302a;
  --color-success-border: #2f6b4e;
  --color-warning: #946009;
  --color-warning-text: #e8b766;
  --color-warning-subtle: #352a17;
  --color-warning-border: #7a5a22;
  --color-danger: #c2433b;
  --color-danger-text: #f2918a;
  --color-danger-subtle: #3a1e22;
  --color-danger-border: #8a3a3a;
  --color-info: #2e71a6;
  --color-info-text: #7dbceb;
  --color-info-subtle: #182d3d;
  --color-info-border: #356a94;
  --color-locked: #6b7385;
  --color-locked-text: #b0b7c6;
  --color-locked-subtle: #252a33;
  --color-locked-border: #566074;
  /* Éditeur DBML / SQL */
  --color-editor-bg: #14171d;
  --color-editor-gutter-text: #858da4;
  --color-editor-active-line: #1b1f27;
  --color-editor-selection: #34397a;
  --color-syntax-comment: #8790a3;
  --color-syntax-keyword: #d2a0f0;
  --color-syntax-modifier: #e5c07b;
  --color-syntax-type: #5fc7d2;
  --color-syntax-class: #74b6f5;
  --color-syntax-variable: #e4e7ee;
  --color-syntax-string: #9ed08a;
  --color-syntax-number: #e0a878;
  --color-syntax-operator: #f08ab8;
  --color-syntax-punctuation: #9aa1b3;
  --color-syntax-brace: #b8becb;
  /* Environnements : texte / fond / bordure / pastille */
  --color-env-green-fg: #7ad0a0;
  --color-env-green-bg: #17302a;
  --color-env-green-border: #2f6b4e;
  --color-env-green-dot: #4fb27f;
  --color-env-blue-fg: #7dbceb;
  --color-env-blue-bg: #182d3d;
  --color-env-blue-border: #356a94;
  --color-env-blue-dot: #5aa6dc;
  --color-env-violet-fg: #c4a6ee;
  --color-env-violet-bg: #2a2140;
  --color-env-violet-border: #6a4e96;
  --color-env-violet-dot: #a482da;
  --color-env-amber-fg: #e8b766;
  --color-env-amber-bg: #352a17;
  --color-env-amber-border: #7a5a22;
  --color-env-amber-dot: #d9a244;
  --color-env-orange-fg: #f0a877;
  --color-env-orange-bg: #35241a;
  --color-env-orange-border: #8a5a38;
  --color-env-orange-dot: #e58f55;
  --color-env-red-fg: #f2918a;
  --color-env-red-bg: #3a1e22;
  --color-env-red-border: #8a3a3a;
  --color-env-red-dot: #e5655c;
  --color-env-grey-fg: #b0b7c6;
  --color-env-grey-bg: #252a33;
  --color-env-grey-border: #566074;
  --color-env-grey-dot: #8790a3;
  /* Données du canvas (tables, zones, groupes) : 12 teintes, texte blanc ≥ 4,5:1 */
  --color-data-1: #5f6b7c;
  --color-data-2: #5a5ec4;
  --color-data-3: #2f6a9b;
  --color-data-4: #1f6f78;
  --color-data-5: #3a7050;
  --color-data-6: #66701f;
  --color-data-7: #85650f;
  --color-data-8: #a24e1a;
  --color-data-9: #a9423b;
  --color-data-10: #a04570;
  --color-data-11: #8257b3;
  --color-data-12: #6b665c;
  /* Relations */
  --color-edge-one-to-one: #9a9ef7;
  --color-edge-one-to-many: #6cc796;
  --color-edge-many-to-many: #e0ad5a;
  --color-edge-dimmed: #6d7588;
  --color-edge-issue: #f2918a;
  --color-edge-highlight: #c6c9ff;
  /* Graphiques */
  --color-chart-1: #9a9ef7;
  --color-chart-2: #5fc7d2;
  --color-chart-3: #e0ad5a;
  --color-chart-4: #f08ab8;
  --color-chart-5: #74b6f5;
  --color-chart-6: #6cc796;
  /* Divers canvas */
  --color-canvas-grid: #2e3441;
  --color-sticky-bg: #5c5224;
  --color-sticky-ink: #f6efc9;
  --color-sticky-border: #a8963f;
  --color-overlay: rgba(5, 6, 9, 0.66);
  --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.40);
  --shadow-2: 0 6px 16px rgba(0, 0, 0, 0.45), 0 1px 3px rgba(0, 0, 0, 0.30);
  --shadow-3: 0 20px 48px rgba(0, 0, 0, 0.55), 0 6px 14px rgba(0, 0, 0, 0.32);
  color-scheme: dark;
}
```

### 2.6 Tableau de vérification : thème clair

Lecture : « Niveau » = AAA si ≥ 7:1, AA si ≥ 4,5:1 (texte) ou ≥ 3:1 (composant), « info » = pas d'exigence (décoratif ou information doublée par une autre cue). APCA Lc en valeur absolue : ≥ 75 texte courant, ≥ 60 texte de contenu secondaire, ≥ 45 gros texte/icônes.

| Groupe | Paire (texte / fond) | Valeurs | Ratio | Niveau | APCA Lc |
|---|---|---|---|---|---|
| Texte | text / bg | `#1f1e1b` / `#eeece7` | 14.12 | AAA | 92.4 |
| Texte | text-secondary / bg | `#47443e` / `#eeece7` | 8.22 | AAA | 81.3 |
| Texte | text-muted / bg | `#5c5850` / `#eeece7` | 6.00 | AA | 73.3 |
| Texte | text / canvas | `#1f1e1b` / `#e8e5df` | 13.26 | AAA | 88.4 |
| Texte | text-secondary / canvas | `#47443e` / `#e8e5df` | 7.72 | AAA | 77.3 |
| Texte | text-muted / canvas | `#5c5850` / `#e8e5df` | 5.63 | AA | 69.4 |
| Texte | text / surface-1 | `#1f1e1b` / `#f6f4f0` | 15.17 | AAA | 97.1 |
| Texte | text-secondary / surface-1 | `#47443e` / `#f6f4f0` | 8.83 | AAA | 86 |
| Texte | text-muted / surface-1 | `#5c5850` / `#f6f4f0` | 6.44 | AA | 78.1 |
| Texte | text / surface-2 | `#1f1e1b` / `#fbfaf7` | 15.97 | AAA | 100.6 |
| Texte | text-secondary / surface-2 | `#47443e` / `#fbfaf7` | 9.30 | AAA | 89.5 |
| Texte | text-muted / surface-2 | `#5c5850` / `#fbfaf7` | 6.78 | AA | 81.6 |
| Texte | text / surface-3 | `#1f1e1b` / `#e7e4dd` | 13.13 | AAA | 87.8 |
| Texte | text-secondary / surface-3 | `#47443e` / `#e7e4dd` | 7.64 | AAA | 76.7 |
| Texte | text-muted / surface-3 | `#5c5850` / `#e7e4dd` | 5.57 | AA | 68.7 |
| Texte | text-disabled / surface-2 (exempt) | `#8e8a80` / `#fbfaf7` | 3.30 | info | 59 |
| Marque | on-primary / primary | `#ffffff` / `#4a4fa6` | 7.09 | AAA | 89.3 |
| Marque | on-primary / primary-hover | `#ffffff` / `#3e4392` | 8.67 | AAA | 94 |
| Marque | primary-text / surface-1 | `#3e4392` / `#f6f4f0` | 7.89 | AAA | 83 |
| Marque | primary-text / surface-2 | `#3e4392` / `#fbfaf7` | 8.30 | AAA | 86.5 |
| Marque | primary-text / bg | `#3e4392` / `#eeece7` | 7.34 | AAA | 78.3 |
| Marque | primary-text / canvas | `#3e4392` / `#e8e5df` | 6.89 | AA | 74.3 |
| Marque | primary-text / surface-3 | `#3e4392` / `#e7e4dd` | 6.83 | AA | 73.6 |
| Marque | primary-text / primary-subtle | `#3e4392` / `#e3e4f2` | 6.87 | AA | 74 |
| Marque | accent-ui (primary-text) / surface-2 | `#3e4392` / `#fbfaf7` | 8.30 | AA | 86.5 |
| Focus | focus-ring / surface-1 | `#3e4392` / `#f6f4f0` | 7.89 | AA | 83 |
| Focus | focus-ring / surface-3 | `#3e4392` / `#e7e4dd` | 6.83 | AA | 73.6 |
| Focus | focus-ring / bg | `#3e4392` / `#eeece7` | 7.34 | AA | 78.3 |
| Focus | focus-ring / canvas | `#3e4392` / `#e8e5df` | 6.89 | AA | 74.3 |
| Sémantique | success-text / surface-2 | `#22573c` / `#fbfaf7` | 8.06 | AAA | 85.8 |
| Sémantique | success-text / surface-1 | `#22573c` / `#f6f4f0` | 7.66 | AAA | 82.3 |
| Sémantique | success-text / success-subtle | `#22573c` / `#dfebe2` | 6.86 | AA | 75.1 |
| Sémantique | on-success (blanc) / success (solide) | `#ffffff` / `#2b6e4c` | 6.11 | AA | 85.4 |
| Sémantique | warning-text / surface-2 | `#6e410b` / `#fbfaf7` | 8.30 | AAA | 86.4 |
| Sémantique | warning-text / surface-1 | `#6e410b` / `#f6f4f0` | 7.89 | AAA | 83 |
| Sémantique | warning-text / warning-subtle | `#6e410b` / `#f2e6d2` | 7.02 | AAA | 75.4 |
| Sémantique | on-warning (blanc) / warning (solide) | `#ffffff` / `#8a5410` | 6.26 | AA | 86 |
| Sémantique | danger-text / surface-2 | `#8e2d27` / `#fbfaf7` | 7.88 | AAA | 84.5 |
| Sémantique | danger-text / surface-1 | `#8e2d27` / `#f6f4f0` | 7.48 | AAA | 81 |
| Sémantique | danger-text / danger-subtle | `#8e2d27` / `#f4deda` | 6.38 | AA | 70.8 |
| Sémantique | on-danger (blanc) / danger (solide) | `#ffffff` / `#b03a33` | 6.00 | AA | 84.3 |
| Sémantique | info-text / surface-2 | `#1f5379` / `#fbfaf7` | 7.82 | AAA | 85 |
| Sémantique | info-text / surface-1 | `#1f5379` / `#f6f4f0` | 7.43 | AAA | 81.5 |
| Sémantique | info-text / info-subtle | `#1f5379` / `#dce9f2` | 6.60 | AA | 73.8 |
| Sémantique | on-info (blanc) / info (solide) | `#ffffff` / `#2a6a98` | 5.81 | AA | 84 |
| Sémantique | locked-text / surface-2 | `#464c58` / `#fbfaf7` | 8.26 | AAA | 86.6 |
| Sémantique | locked-text / surface-1 | `#464c58` / `#f6f4f0` | 7.85 | AAA | 83.2 |
| Sémantique | locked-text / locked-subtle | `#464c58` / `#e3e5e8` | 6.83 | AA | 74.2 |
| Sémantique | on-locked (blanc) / locked (solide) | `#ffffff` / `#5b6270` | 6.13 | AA | 85.8 |
| UI | border-control / surface-2 (champ) | `#837e73` / `#fbfaf7` | 3.87 | AA | 64.7 |
| UI | border-control / surface-1 | `#837e73` / `#f6f4f0` | 3.68 | AA | 61.2 |
| UI | border-control / bg | `#837e73` / `#eeece7` | 3.42 | AA | 56.5 |
| UI | border-control / surface-3 | `#837e73` / `#e7e4dd` | 3.18 | AA | 51.8 |
| UI | border-strong / surface-2 | `#625e55` / `#fbfaf7` | 6.19 | AA | 79.1 |
| Éditeur | gutter-text / editor-bg | `#6f6b62` / `#f9f8f4` | 5.00 | AA | 72.2 |
| Syntaxe | syntax-comment / editor-bg | `#6a665d` / `#f9f8f4` | 5.38 | AA | 74.4 |
| Syntaxe | syntax-keyword / editor-bg | `#7a3fa6` / `#f9f8f4` | 6.40 | AA | 78.7 |
| Syntaxe | syntax-modifier / editor-bg | `#8a5410` / `#f9f8f4` | 5.89 | AA | 76.6 |
| Syntaxe | syntax-type / editor-bg | `#0f6b73` / `#f9f8f4` | 5.86 | AA | 76.4 |
| Syntaxe | syntax-cls / editor-bg | `#2a5fb0` / `#f9f8f4` | 5.88 | AA | 76.5 |
| Syntaxe | syntax-variable / editor-bg | `#2b2a26` / `#f9f8f4` | 13.52 | AAA | 96.9 |
| Syntaxe | syntax-string / editor-bg | `#2b6e4c` / `#f9f8f4` | 5.75 | AA | 76 |
| Syntaxe | syntax-number / editor-bg | `#a24a12` / `#f9f8f4` | 5.61 | AA | 74.9 |
| Syntaxe | syntax-operator / editor-bg | `#b03872` / `#f9f8f4` | 5.41 | AA | 73.6 |
| Syntaxe | syntax-punct / editor-bg | `#5f5b53` / `#f9f8f4` | 6.36 | AA | 79.1 |
| Syntaxe | syntax-brace / editor-bg | `#47443e` / `#f9f8f4` | 9.13 | AAA | 88.3 |

### 2.7 Tableau de vérification : thème sombre

| Groupe | Paire (texte / fond) | Valeurs | Ratio | Niveau | APCA Lc |
|---|---|---|---|---|---|
| Texte | text / bg | `#ecedf1` / `#0f1115` | 16.15 | AAA | 95.7 |
| Texte | text-secondary / bg | `#b0b5c2` / `#0f1115` | 9.21 | AAA | 61.8 |
| Texte | text-muted / bg | `#929aab` / `#0f1115` | 6.69 | AA | 47 |
| Texte | text / canvas | `#ecedf1` / `#13161c` | 15.48 | AAA | 95.3 |
| Texte | text-secondary / canvas | `#b0b5c2` / `#13161c` | 8.83 | AAA | 61.4 |
| Texte | text-muted / canvas | `#929aab` / `#13161c` | 6.41 | AA | 46.6 |
| Texte | text / surface-1 | `#ecedf1` / `#181b22` | 14.73 | AAA | 94.7 |
| Texte | text-secondary / surface-1 | `#b0b5c2` / `#181b22` | 8.40 | AAA | 60.8 |
| Texte | text-muted / surface-1 | `#929aab` / `#181b22` | 6.10 | AA | 46.1 |
| Texte | text / surface-2 | `#ecedf1` / `#1f232c` | 13.45 | AAA | 93.6 |
| Texte | text-secondary / surface-2 | `#b0b5c2` / `#1f232c` | 7.67 | AAA | 59.7 |
| Texte | text-muted / surface-2 | `#929aab` / `#1f232c` | 5.57 | AA | 45 |
| Texte | text / surface-3 | `#ecedf1` / `#282d38` | 11.79 | AAA | 91.7 |
| Texte | text-secondary / surface-3 | `#b0b5c2` / `#282d38` | 6.72 | AA | 57.9 |
| Texte | text-muted / surface-3 | `#929aab` / `#282d38` | 4.88 | AA | 43.1 |
| Texte | text-disabled / surface-2 (exempt) | `#5e6474` / `#1f232c` | 2.66 | info | 19.6 |
| Marque | on-primary / primary | `#ffffff` / `#4f53cf` | 6.05 | AA | 85 |
| Marque | on-primary / primary-hover | `#ffffff` / `#5d61db` | 5.00 | AA | 79.6 |
| Marque | primary-text / surface-1 | `#a9adff` / `#181b22` | 8.29 | AAA | 60.3 |
| Marque | primary-text / surface-2 | `#a9adff` / `#1f232c` | 7.57 | AAA | 59.2 |
| Marque | primary-text / bg | `#a9adff` / `#0f1115` | 9.10 | AAA | 61.3 |
| Marque | primary-text / canvas | `#a9adff` / `#13161c` | 8.72 | AAA | 60.8 |
| Marque | primary-text / surface-3 | `#a9adff` / `#282d38` | 6.64 | AA | 57.3 |
| Marque | primary-text / primary-subtle | `#a9adff` / `#25284d` | 6.79 | AA | 57.6 |
| Marque | accent-ui (primary-text) / surface-2 | `#a9adff` / `#1f232c` | 7.57 | AA | 59.2 |
| Focus | focus-ring / surface-1 | `#a9adff` / `#181b22` | 8.29 | AA | 60.3 |
| Focus | focus-ring / surface-3 | `#a9adff` / `#282d38` | 6.64 | AA | 57.3 |
| Focus | focus-ring / bg | `#a9adff` / `#0f1115` | 9.10 | AA | 61.3 |
| Focus | focus-ring / canvas | `#a9adff` / `#13161c` | 8.72 | AA | 60.8 |
| Sémantique | success-text / surface-2 | `#7ad0a0` / `#1f232c` | 8.51 | AAA | 65.3 |
| Sémantique | success-text / surface-1 | `#7ad0a0` / `#181b22` | 9.32 | AAA | 66.5 |
| Sémantique | success-text / success-subtle | `#7ad0a0` / `#17302a` | 7.61 | AAA | 63.7 |
| Sémantique | on-success (blanc) / success (solide) | `#ffffff` / `#2e7d57` | 5.02 | AA | 79.8 |
| Sémantique | warning-text / surface-2 | `#e8b766` / `#1f232c` | 8.54 | AAA | 65.5 |
| Sémantique | warning-text / surface-1 | `#e8b766` / `#181b22` | 9.35 | AAA | 66.6 |
| Sémantique | warning-text / warning-subtle | `#e8b766` / `#352a17` | 7.62 | AAA | 63.9 |
| Sémantique | on-warning (blanc) / warning (solide) | `#ffffff` / `#946009` | 5.33 | AA | 81.6 |
| Sémantique | danger-text / surface-2 | `#f2918a` / `#1f232c` | 6.89 | AA | 54.7 |
| Sémantique | danger-text / surface-1 | `#f2918a` / `#181b22` | 7.54 | AAA | 55.9 |
| Sémantique | danger-text / danger-subtle | `#f2918a` / `#3a1e22` | 6.62 | AA | 54.1 |
| Sémantique | on-danger (blanc) / danger (solide) | `#ffffff` / `#c2433b` | 5.05 | AA | 79.3 |
| Sémantique | info-text / surface-2 | `#7dbceb` / `#1f232c` | 7.69 | AAA | 60 |
| Sémantique | info-text / surface-1 | `#7dbceb` / `#181b22` | 8.42 | AAA | 61.1 |
| Sémantique | info-text / info-subtle | `#7dbceb` / `#182d3d` | 6.93 | AA | 58.5 |
| Sémantique | on-info (blanc) / info (solide) | `#ffffff` / `#2e71a6` | 5.21 | AA | 80.9 |
| Sémantique | locked-text / surface-2 | `#b0b7c6` / `#1f232c` | 7.82 | AAA | 60.7 |
| Sémantique | locked-text / surface-1 | `#b0b7c6` / `#181b22` | 8.56 | AAA | 61.8 |
| Sémantique | locked-text / locked-subtle | `#b0b7c6` / `#252a33` | 7.16 | AAA | 59.5 |
| Sémantique | on-locked (blanc) / locked (solide) | `#ffffff` / `#6b7385` | 4.76 | AA | 78.5 |
| UI | border-control / surface-2 (champ) | `#7c8499` / `#1f232c` | 4.21 | AA | 34.1 |
| UI | border-control / surface-1 | `#7c8499` / `#181b22` | 4.61 | AA | 35.2 |
| UI | border-control / bg | `#7c8499` / `#0f1115` | 5.05 | AA | 36.2 |
| UI | border-control / surface-3 | `#7c8499` / `#282d38` | 3.69 | AA | 32.3 |
| UI | border-strong / surface-2 | `#a0a7b8` / `#1f232c` | 6.53 | AA | 52 |
| Éditeur | gutter-text / editor-bg | `#858da4` / `#14171d` | 5.42 | AA | 40.2 |
| Syntaxe | syntax-comment / editor-bg | `#8790a3` / `#14171d` | 5.60 | AA | 41.4 |
| Syntaxe | syntax-keyword / editor-bg | `#d2a0f0` / `#14171d` | 8.57 | AAA | 60.4 |
| Syntaxe | syntax-modifier / editor-bg | `#e5c07b` / `#14171d` | 10.39 | AAA | 70.6 |
| Syntaxe | syntax-type / editor-bg | `#5fc7d2` / `#14171d` | 9.05 | AAA | 63.3 |
| Syntaxe | syntax-cls / editor-bg | `#74b6f5` / `#14171d` | 8.33 | AAA | 59.1 |
| Syntaxe | syntax-variable / editor-bg | `#e4e7ee` / `#14171d` | 14.50 | AAA | 91.2 |
| Syntaxe | syntax-string / editor-bg | `#9ed08a` / `#14171d` | 10.12 | AAA | 69.1 |
| Syntaxe | syntax-number / editor-bg | `#e0a878` / `#14171d` | 8.58 | AAA | 60.5 |
| Syntaxe | syntax-operator / editor-bg | `#f08ab8` / `#14171d` | 7.72 | AAA | 55.5 |
| Syntaxe | syntax-punct / editor-bg | `#9aa1b3` / `#14171d` | 6.94 | AA | 50.4 |
| Syntaxe | syntax-brace / editor-bg | `#b8becb` / `#14171d` | 9.63 | AAA | 66.3 |

**Bilan** : Clair : 88/88 paires exigées passent (96 mesurées au total) ; 30/67 paires de texte atteignent AAA. Sombre : 88/88 ; 43/67 en AAA. Les paires qui n'atteignent « que » AA sont par construction : `text-muted` (4,9 à 6,8:1), le blanc sur bouton plein (4,8 à 8,7:1), les couleurs de syntaxe (5,4 à 13,5:1 en clair). Elles passent en AAA dans le mode contraste élevé (2.9). Le texte principal est partout en AAA ; le secondaire l'est partout en clair et descend à 6,7:1 sur `surface-3` en sombre. Remarque WCAG 1.4.11 : en sombre, le fond plein `primary` (`#4f53cf`) ne fait que 2,6:1 sur `surface-2` ; ce n'est pas une violation car le composant est identifié par son libellé blanc (6,05:1), et ses états actif/focus utilisent `primary-text` (7,6:1).

### 2.8 Environnements (Dev / Staging / Prod / Revue…)

Correspondance avec l'existant : le type `EnvironmentColor` de `packages/shared/src/environments.ts` compte 7 valeurs ; la migration serveur (`apps/server/src/infrastructure/migrations.ts`, ~l. 586) attribue `green` à DEV, `amber` à Staging, `red` à Prod. On conserve ces défauts et on propose `violet` pour « Revue/Recette » et `blue` pour « Test/QA ». **La production reste rouge quel que soit le choix** (règle de `EnvironmentBadge`), et reçoit en plus une bordure de 2 px et l'icône cadenas (information non portée par la couleur seule).

| Couleur (rôle) | Thème | Texte | Fond | Bordure | Pastille | Texte/fond | Texte/surface-1 | Pastille/fond |
|---|---|---|---|---|---|---|---|---|
| Vert (Dev) | clair | `#22573C` | `#DFEBE2` | `#A9CBB5` | `#2B6E4C` | 6.86 | 7.66 | 4.98 |
| Bleu (Test/QA) | clair | `#1F5379` | `#DCE9F2` | `#A4C2D9` | `#2A6A98` | 6.60 | 7.43 | 4.70 |
| Violet (Revue) | clair | `#53388A` | `#E8E1F3` | `#BBA8D9` | `#7647A0` | 7.17 | 8.31 | 5.19 |
| Ambre (Staging) | clair | `#6E410B` | `#F2E6D2` | `#D7B98A` | `#8A5410` | 7.02 | 7.89 | 5.07 |
| Orange (Pré-prod) | clair | `#7F3A10` | `#F3E0D3` | `#D9AB8C` | `#A24E1A` | 6.53 | 7.60 | 4.51 |
| Rouge (Prod) | clair | `#8E2D27` | `#F4DEDA` | `#DDA9A3` | `#B03A33` | 6.38 | 7.48 | 4.66 |
| Gris (Autre) | clair | `#464C58` | `#E3E5E8` | `#B9BEC6` | `#5B6270` | 6.83 | 7.85 | 4.86 |
| Vert (Dev) | sombre | `#7AD0A0` | `#17302A` | `#2F6B4E` | `#4FB27F` | 7.61 | 9.32 | 5.36 |
| Bleu (Test/QA) | sombre | `#7DBCEB` | `#182D3D` | `#356A94` | `#5AA6DC` | 6.93 | 8.42 | 5.35 |
| Violet (Revue) | sombre | `#C4A6EE` | `#2A2140` | `#6A4E96` | `#A482DA` | 7.22 | 8.24 | 4.88 |
| Ambre (Staging) | sombre | `#E8B766` | `#352A17` | `#7A5A22` | `#D9A244` | 7.62 | 9.35 | 6.16 |
| Orange (Pré-prod) | sombre | `#F0A877` | `#35241A` | `#8A5A38` | `#E58F55` | 7.45 | 8.68 | 5.92 |
| Rouge (Prod) | sombre | `#F2918A` | `#3A1E22` | `#8A3A3A` | `#E5655C` | 6.62 | 7.54 | 4.57 |
| Gris (Autre) | sombre | `#B0B7C6` | `#252A33` | `#566074` | `#8790A3` | 7.16 | 8.56 | 4.49 |

Règle de construction : le fond de pastille est opaque (plus de `color-mix` à 14 %), le texte est ≥ 6,3:1 dessus, la pastille ronde (`dot`) est ≥ 4,4:1 sur son fond (≥ 3:1 exigé pour un graphique). `EnvironmentBadge.svelte` devient `StatusPill` avec `tone="env-amber"` (section 5.14).

### 2.9 Option « contraste élevé » et « suivre le système »

Mécanisme : un attribut indépendant `data-contrast="more"` sur `<html>`, **cumulable** avec `data-theme`. Il se déclenche seul si l'utilisateur est en `Système` et que `prefers-contrast: more` est actif, ou à la demande dans Réglages → Affichage.

Valeurs vérifiées (toutes ≥ 7:1 pour le texte et les bordures de contrôle) :

| Jeton | HC clair | HC sombre |
|---|---|---|
| bg / surface-1 / surface-2 | `#ffffff` | `#000000` / `#0a0a0a` / `#141414` |
| surface-3 | `#ededed` | `#262626` |
| text | `#000000` (21:1) | `#ffffff` (21:1) |
| text-secondary | `#1a1a1a` (17,4:1) | `#f0f0f0` (16,2:1) |
| text-muted | `#333333` (10,8:1 sur surface-3) | `#d4d4d4` (10,2:1 sur surface-3) |
| border / border-control | `#000000` (21:1) | `#ffffff` (21:1) |
| primary (fond) / on-primary | `#2b2f8a` (11,2:1 avec blanc) | `#b5b8ff` (11,3:1 avec noir) |
| primary-text | `#2b2f8a` (11,2:1) | `#c6c9ff` (13,2:1) |
| success / warning / danger / info (texte) | `#14532d` 9,1 · `#6b3a00` 9,4 · `#9b1c1c` 8,2 · `#0b4a75` 9,3 | `#9be8bc` 14,7 · `#ffd28a` 14,8 · `#ffb3ad` 12,3 · `#a5d8ff` 13,9 |
| focus-ring | `#000000`, 3 px + offset 2 px | `#ffffff`, 3 px + offset 2 px |

Autres règles du mode : fonds doux remplacés par fond de surface + bordure 2 px de la couleur sémantique ; ombres supprimées (bordure pleine à la place) ; le texte des couleurs de syntaxe passe à ≥ 7:1 ; les teintes `data-N` des tables gagnent une bordure noire/blanche 2 px.

`@media (forced-colors: active)` : on ne redéfinit pas les couleurs, on garantit les bordures (`border: 1px solid CanvasText` sur boutons/champs), l'anneau de focus (`outline: 2px solid Highlight`) et que les pastilles de statut conservent leur libellé texte.

**Suivre le système** : valeur de préférence `"system"` (nouveau défaut pour les nouveaux comptes, voir question Q1). Résolution dans le script de `index.html` : `localStorage.athanordb.theme` ∈ `system|light|dark` ; si `system`, `matchMedia('(prefers-color-scheme: dark)')`, avec écouteur `change` pour basculer en direct. Les anciennes valeurs stockées sont migrées : `obsidian` → `dark`, `light` → `light`, `midnight`/`emerald` → `dark`. Les cartes « bientôt » disparaissent (une option désactivée qui promet une fonction est un défaut d'UX ; thèmes additionnels = hors périmètre, voir Q2).

Repli sans JavaScript : `@media (prefers-color-scheme: light) { :root:not([data-theme]) { … } }` généré par le même script de build (8.1), pour qu'un script bloqué n'impose pas du sombre à un utilisateur en clair.

### 2.10 Couleurs de données du canvas

#### Teintes d'en-têtes de tables, zones et groupes (12 teintes)

Conçues pour que **le texte blanc passe 4,5:1 sur chacune** (donc plus besoin d'un second texte par table) et que la teinte reste ≥ 3:1 contre le canvas, dans chaque thème. Trois teintes (ardoise, indigo, violet) ont une variante sombre plus claire pour tenir 3:1 sur le canvas sombre.

| # | Nom | Clair | Blanc/fond | vs canvas clair | Sombre | Blanc/fond | vs canvas sombre |
|---|---|---|---|---|---|---|---|
| 1 | ardoise | `#46505e` | 8.17 | 6.50 | `#5f6b7c` | 5.41 | 3.35 |
| 2 | indigo | `#4a4fa6` | 7.09 | 5.64 | `#5a5ec4` | 5.48 | 3.31 |
| 3 | bleu | `#2f6a9b` | 5.74 | 4.57 | `#2f6a9b` | 5.74 | 3.15 |
| 4 | turquoise | `#1f6f78` | 5.83 | 4.64 | `#1f6f78` | 5.83 | 3.11 |
| 5 | vert | `#3a7050` | 5.81 | 4.62 | `#3a7050` | 5.81 | 3.12 |
| 6 | olive | `#66701f` | 5.38 | 4.28 | `#66701f` | 5.38 | 3.37 |
| 7 | ocre | `#85650f` | 5.43 | 4.32 | `#85650f` | 5.43 | 3.33 |
| 8 | orange | `#a24e1a` | 5.77 | 4.59 | `#a24e1a` | 5.77 | 3.14 |
| 9 | rouge | `#a9423b` | 5.95 | 4.73 | `#a9423b` | 5.95 | 3.04 |
| 10 | rose | `#a04570` | 5.87 | 4.67 | `#a04570` | 5.87 | 3.09 |
| 11 | violet | `#7647a0` | 6.61 | 5.25 | `#8257b3` | 5.30 | 3.42 |
| 12 | pierre | `#6b665c` | 5.71 | 4.54 | `#6b665c` | 5.71 | 3.17 |

Les anciennes teintes de `DEFAULT_PALETTE` sont rapprochées de la teinte la plus proche (distance en OKLab) **à l'affichage seulement** ; les valeurs hex enregistrées dans les projets ne sont pas modifiées (question Q4). Le champ hex libre est conservé. Dans tous les cas, `prefersDarkText()` est remplacé par un choix **au meilleur ratio** :

```ts
// apps/web/src/utils/color.ts
export function readableInk(bg: string): "#ffffff" | "var(--color-ink)" {
  return contrastRatio("#ffffff", bg) >= contrastRatio(INK_HEX, bg) ? "#ffffff" : "var(--color-ink)";
}
```
(garantit ≥ 4,58:1 pour n'importe quel fond, au lieu de 2,28:1 dans le pire cas actuel).

#### Relations

Chaque cardinalité est doublée d'un **motif** (plein, tirets, pied de corbeau) pour ne pas dépendre de la couleur seule (WCAG 1.4.1) ; les couleurs sont ≥ 3,5:1 sur le canvas (≥ 3:1 exigé pour un graphique).

| Relation | Clair | vs canvas | Sombre | vs canvas | Motif (non-couleur) |
|---|---|---|---|---|---|
| one-to-one | `#4a4fa6` | 5.64 | `#9a9ef7` | 7.43 | trait plein, marqueur `1`—`1` |
| one-to-many | `#2a6c4d` | 4.99 | `#6cc796` | 8.84 | trait plein, pied de corbeau |
| many-to-many | `#8e5c10` | 4.53 | `#e0ad5a` | 8.88 | tirets longs, pied de corbeau des deux côtés |
| dimmed | `#7c776c` | 3.54 | `#6d7588` | 3.93 | trait fin 1 px, atténué |
| issue | `#b03a33` | 4.77 | `#f2918a` | 7.93 | pointillé + icône ⚠ |
| highlight | `#2b2f8a` | 8.90 | `#c6c9ff` | 11.39 | trait plein 2,5 px |

#### Zones, groupes, notes, minimap

- **Zone** : fond = teinte `data-N` à 14 % (clair) / 20 % (sombre) sur le canvas ; bordure pleine 1,5 px de la teinte ; **le libellé de zone utilise `--color-text`** (11,2:1 clair, 12,9:1 sombre) et non la teinte : le texte coloré sur son propre lavis plafonne à 3,7–4,0:1 (mesuré). Un pastille de la teinte précède le libellé.
- **Groupe de tables** : bordure pointillée de la teinte, même règle pour le libellé. Remplace `TABLE_GROUP_COLOR = "#a855f7"`.
- **Enum** : `data-4` (turquoise) en-tête, remplace `ENUM_COLOR = "#06b6d4"`.
- **Note adhésive** : sticky clair encre/fond 12.09, bordure/canvas 3.36 ; sticky sombre encre/fond 6.74, bordure/canvas 6.12 ; placeholder (text-muted)/surface-2 clair 6.78, sombre 5.57. Clair : `#f4e7a6` / encre `#2b2616` / bordure `#8f7a1f` ; sombre : `#5c5224` / `#f6efc9` / `#a8963f`. La bordure est indispensable en clair car le jaune pâle a la même luminance que le canvas (1,01:1).
- **Minimap** : lit les tokens via `getComputedStyle` (une seule lecture par changement de thème) au lieu de constantes hex.
- **Grille** : clair `#bdb8ad`, sombre `#2e3441` (1,57:1 et 1,45:1 : décoratif, volontairement discret).
- **Poignées de relation** (`styles/canvas.css`, `.table-row-handle`) : remplir avec `--color-border-control` et liseré `--color-bg-canvas`, au lieu de `#9aa3b0`/`#1e2024`.

#### Graphiques et tableau de bord

Six séries, chacune ≥ 3:1 sur `surface-1` dans les deux thèmes (≥ 6,4:1 en sombre sur `surface-2`, mesuré) ; **marqueurs de forme obligatoires** pour distinguer les séries sans couleur (courbes avec points différents, barres avec motif) et libellés directs plutôt que légende seule.

| Série | Clair | vs surface-1 | Sombre | vs surface-1 | Marqueur |
|---|---|---|---|---|---|
| 1 | `#4a4fa6` | 6.46 | `#9a9ef7` | 7.06 | ● |
| 2 | `#1f6f78` | 5.31 | `#5fc7d2` | 8.69 | ■ |
| 3 | `#85650f` | 4.95 | `#e0ad5a` | 8.45 | ▲ |
| 4 | `#a04570` | 5.34 | `#f08ab8` | 7.41 | ◆ |
| 5 | `#2f6a9b` | 5.23 | `#74b6f5` | 8.00 | ○ |
| 6 | `#3a7050` | 5.29 | `#6cc796` | 8.41 | □ |

### 2.11 CodeMirror / SQL : coloration syntaxique

Les 11 rôles de `language.ts` sont conservés (`comment`, `keyword`, `modifier`, `type`, `class`, `variable`, `string`, `number`, `operator`, `punctuation`, `brace`) ; seules les valeurs changent, et **le même jeu sert au DBML et au SQL** (`features/sql/*`, `features/editor/dbml/*`) via les mêmes tokens `--color-syntax-*`. Toutes ≥ 4,5:1 sur `editor-bg` ET sur `editor-active-line`, et ≥ 3:1 sur `editor-selection` (valeurs et ratios dans les tableaux 2.6 et 2.7, lignes « Syntaxe »). Correctifs notables : commentaire sombre `#5c6370` (2,94:1) → `#8790a3` (5,6:1) ; gutter sombre `#475569` (2,34:1) → `#858da4` (5,4:1) ; gutter clair `#94a3b8` (2,50:1) → `#6f6b62` ; opérateur clair `#db2777` (4,48:1) → `#b03872`. Les commentaires restent en retrait par la teinte et l'italique, **pas** par un contraste insuffisant.

Autres surfaces CodeMirror à raccorder aux tokens : `.cm-searchMatch` et `.cm-lintRange-warning` (`language.ts` l. 284, 285, 357, rgba en dur), le panneau de recherche (`searchPanel.ts`, 20 couleurs en dur), les icônes SVG en `currentColor`.

---

## 3. Échelles : typographie, espacement, rayons, ombres, densité, cibles

### 3.1 Typographie

Police UI conservée (**Plus Jakarta Sans**) et monospace (**JetBrains Mono**), déjà chargées par `styles/fonts.css`. L'échelle passe de 13 tailles arbitraires + 5 tokens + 5 tailles Tailwind à **7 rangs**.

| Token | Taille | Interligne | Usage | Remplace (nb d'usages actuels) |
|---|---|---|---|---|
| `--text-caption` | 11 px | 1,35 | métadonnées secondaires (horodatage, compteur), **jamais** seul porteur d'information essentielle | `text-[9px]`…`[11.5px]` (≈ 130) |
| `--text-label` | 12 px | 1,4 | étiquettes de champ, en-têtes de colonne, pastilles | `text-xs` (249), `[12px]`, `[12.5px]` |
| `--text-body` | 13 px (compact) / 14 px (confortable) | 1,5 | texte courant, champs, boutons, lignes | `[13px]`, `[13.5px]`, `text-body` |
| `--text-title` | 14 px / 15 px | 1,4 | titres de section de panneau, titres de carte | `[14px]`, `[15px]`, `text-title` |
| `--text-heading` | 16 px | 1,35 | titres de tiroir, titre de page secondaire | `text-lg`, `[17px]`, `text-heading` |
| `--text-page` | 20 px | 1,3 | titre de page | nouveau |
| `--text-metric` | 28 px, chiffres tabulaires | 1,1 | valeur d'une carte de métrique | nouveau |

Règles : **plancher à 11 px** (les 36 occurrences de 9 à 10,5 px, dont les pastilles `text-[10px]` de `Badge` et `EnvironmentBadge`, passent à 11 px ; les pastilles perdent le `uppercase` si le libellé est une saisie utilisateur : « DEV » tapé par l'admin n'a pas à être recapitalisé). `font-variant-numeric: tabular-nums` sur toutes les colonnes numériques et les métriques. Graisses : 400 courant, 500 libellés, 600 titres/boutons (le 700 de `font-bold` ne sert plus que le logo). Tailwind : redéfinir `fontSize.xs/sm/base/lg/xl` pour qu'ils pointent sur ces rangs (sinon `text-sm` = 14 px et `text-xs` = 12 px, deux échelles en parallèle).

### 3.2 Espacement

Échelle de 4 px conservée (déjà saine : seulement ≈ 17 valeurs arbitraires). Ajouts : `--space-0: 0`, `--space-10: 40px`, `--space-12: 48px`, `--space-16: 64px`. Jetons d'usage (pour éviter les débats) :

| Jeton | Valeur compact / confortable | Usage |
|---|---|---|
| `--gap-inline` | 6 / 8 px | icône + libellé, éléments d'une barre |
| `--gap-field` | 12 / 16 px | entre champs d'un formulaire |
| `--pad-card` | 12 / 16 px | intérieur d'une carte |
| `--pad-panel` | 12 / 16 px | intérieur d'un tiroir/panneau |
| `--pad-page` | 24 / 32 px | gouttière d'une page |

Les 17 valeurs arbitraires (`px-[7px]`, `gap-[5px]`, `gap-[3px]`…) sont arrondies au pas de 4 sauf dans le canvas (nœuds de table : `h-[calc(27px*var(--canvas-font-scale))]` reste, ce n'est pas du chrome).

### 3.3 Rayons

Réduire de 7 rangs à 5 ; `rounded-xl` (14 px, 19 usages) et `2xl` (18 px) n'ont plus de rôle distinct.

| Token | Valeur | Usage |
|---|---|---|
| `--radius-xs` | 4 px | pastilles internes, cases à cocher, marqueurs |
| `--radius-sm` | 6 px | boutons, champs, éléments de menu |
| `--radius-md` | 8 px | cartes, nœuds de table, popovers |
| `--radius-lg` | 12 px | tiroirs (angle libre), boîte de confirmation, cartes de métrique |
| `--radius-full` | 999 px | pastilles de statut, interrupteurs, avatars |

Migration : `rounded-xl`/`2xl` → `rounded-lg`. Le `Modal` actuel (`rounded-xl` = 14 px) devient `rounded-lg` (12 px).

### 3.4 Ombres et élévation

Quatre niveaux, plus un anneau (pas une ombre) pour le focus. L'élévation se lit d'abord par la surface (2.2), l'ombre n'est qu'un renfort. Valeurs des deux thèmes en 2.4 et 2.5.

| Niveau | Token | Usage | Surface |
|---|---|---|---|
| 0 | aucune | contenu à plat, tableaux | `surface-1` |
| 1 | `--shadow-1` | cartes interactives au survol, barre flottante | `surface-2` |
| 2 | `--shadow-2` | popovers, menus, menu contextuel, toasts | `surface-2` |
| 3 | `--shadow-3` | tiroirs, boîte de confirmation, palette de commandes | `surface-2` |

Suppressions : `--shadow-glow`, `shadow-xl/2xl` (6 usages), le `backdrop-blur-[3px]` de `Modal` (coût de rendu sur un canvas de plusieurs centaines de nœuds, gain visuel nul). Le flou « verre » (`glass-*`) disparaît de l'interface ; il reste à décider pour la page de connexion (Q9).

### 3.5 Densité

Trois profils, portés par `data-density` sur `<html>` ; `compact` est le défaut (c'est l'apparence actuelle, aucune régression pour les utilisateurs existants). `tactile` s'active automatiquement sous `@media (pointer: coarse)` sauf choix explicite.

| Variable | `compact` | `comfortable` | `tactile` |
|---|---|---|---|
| `--control-h-xs` | 24 px | 28 px | 36 px |
| `--control-h-sm` | 28 px | 32 px | 40 px |
| `--control-h-md` | 32 px | 36 px | 44 px |
| `--control-h-lg` | 40 px | 44 px | 48 px |
| `--row-h` (listes, `DataGrid`) | 28 px | 36 px | 48 px |
| `--text-body` | 13 px | 14 px | 15 px |
| `--space-scale` | 1 | 1,15 | 1,3 |
| `--pad-card` / `--pad-panel` | 12 px | 16 px | 16 px |

`Button` (tailles actuelles 24/28/32/40, `components/ui/Button.svelte`) et `inputStyles.ts` (24/28/32) lisent ces variables au lieu de classes `h-6/h-7/h-8` figées. Le `rowHeight = 28` de `DataGrid.svelte` devient `var(--row-h)`.

### 3.6 Cibles tactiles (WCAG 2.2)

- **2.5.8 Taille de cible (AA)** : toute cible ≥ 24 × 24 px CSS **ou** assez d'espace autour. Les tailles actuelles `icon-xs` (24 px) passent tout juste ; elles ne doivent être utilisées que dans les popovers denses du canvas, jamais en isolation.
- **2.5.5 (AAA, visé sous `tactile`)** : 44 × 44 px. Technique : zone de frappe étendue par pseudo-élément `::after { inset: -4px }` sur les boutons icône en `compact`, sans grossir le visuel.
- **2.4.11 Focus non masqué (AA)** : barres collantes et tiroirs ajoutent `scroll-padding` pour que l'élément focalisé ne passe pas sous elles.
- **Anneau de focus unique** : `outline: 2px solid var(--color-focus-ring); outline-offset: 2px` via `:focus-visible` posé **une fois** dans `base.css`, et suppression des 20 `outline-hidden` sans remplaçant (sauf champs où la bordure `primary-text` + anneau 2 px remplace l'ancien `ring-primary/25`). Contraste de l'anneau ≥ 3:1 sur toutes les surfaces (lignes « Focus » des tableaux 2.6/2.7).
- **Focus sur survol** : tout état `hover:` doit avoir son jumeau `focus-visible:` ; règle ajoutée à la revue de composants (178 `hover:` contre 86 `focus*` aujourd'hui).


---

## 4. États communs et contrat d'accessibilité de tout composant

Ces règles s'appliquent à **chaque** composant de la section 5 et aux primitives existantes (section 7). Elles remplacent les 3 conventions de focus, 3 opacités de désactivation et le traitement ad hoc de l'erreur relevés en 1.2.

| État | Règle visuelle | Règle technique |
|---|---|---|
| Repos | surface + `border-control` pour un contrôle, `border` pour un conteneur | — |
| Survol | fond `surface-3` (neutres) ou `primary-hover` (plein) ; bordure `border-strong` | jamais seul : un `:focus-visible` équivalent existe |
| Focus clavier | `outline: 2px solid var(--color-focus-ring); outline-offset: 2px` posé dans `base.css` pour `:focus-visible` | composants ne redéfinissent rien ; champs : bordure `primary-text` **et** anneau |
| Actif / pressé | fond `surface-3` plus sombre d'un cran, pas de `scale(.98)` sous `prefers-reduced-motion` | — |
| Sélectionné / activé | fond `primary-subtle` + texte `primary-text` + **marqueur non coloré** (coche, barre latérale de 2 px, `aria-selected`) | `aria-selected`/`aria-pressed`/`aria-current` |
| Désactivé | texte `text-disabled`, bordure `border`, curseur `not-allowed` ; **pas d'`opacity`** sur le conteneur | `disabled` natif ou `aria-disabled="true"` ; si l'action reste utile à expliquer : `aria-disabled` + tooltip du pourquoi |
| Erreur | bordure `danger` 2 px + icône + message `danger-text` sous le champ | `aria-invalid="true"`, `aria-describedby` vers le message ; jamais la couleur seule |
| Chargement | `Skeleton` (5.11) ou spinner de 16 px dans le bouton | `aria-busy="true"` ; le libellé du bouton reste |
| Lecture seule | fond `surface-1`, texte `text`, bordure en pointillé | `readonly` ; sélectionnable et copiable |

Contrat minimal par composant : nom accessible (`aria-label` ou `label` lié) ; opérable au clavier avec l'ordre de tabulation visuel ; échappement (Échap) pour tout ce qui s'ouvre ; rôle ARIA exact (pas de `div` cliquable : les 126 `<button>` bruts restent des `<button>`, les `div` cliquables sont des erreurs) ; annonce des changements dynamiques par `aria-live` polite (toasts, résultats de recherche, compteurs) ; respect de `prefers-reduced-motion` via les tokens `--motion-*` déjà en place ; texte ≥ 11 px ; cible ≥ 24 px.

---

## 5. Catalogue des composants à créer ou refondre

Convention : fichiers cibles sous `apps/web/src/components/ui/` (primitives) ou `components/overlays/` (couches flottantes). Les props sont écrites pour Svelte 5 (`$props()`), TypeScript strict. « Existant » indique ce que le dépôt possède déjà et que le composant remplace ou étend.

### 5.1 `Drawer` — panneau latéral (nouveau, remplace ~16 modales)

Existant lié : `features/sql/EditorSqlDrawer.svelte` (tiroir SQL, comportement propre), `components/overlays/Modal.svelte` (réutilise sa logique de focus).

```ts
interface DrawerProps {
  title: string;                       // aria-labelledby
  open: boolean;                       // bind:open
  onClose: () => void;
  side?: "right" | "left";             // défaut "right"
  size?: "sm" | "md" | "lg";           // 400 / 560 / 760 px ; plein écran sous 640 px
  modal?: boolean;                     // défaut false : le canvas reste utilisable à côté
  dismissable?: boolean;               // false pendant une action en cours
  dirty?: boolean;                     // true : demande confirmation avant fermeture
  header?: Snippet; children: Snippet; footer?: Snippet;   // footer = actions collantes
}
```
- **États** : fermé, ouvrant (translation 180 ms, 0 sous reduced-motion), ouvert, `busy`, `dirty`. Redimensionnable à la souris via `Splitter` existant en mode non modal.
- **A11y** : `role="dialog"` + `aria-modal` si `modal`, sinon `role="complementary"` ; focus déplacé à l'ouverture et restauré à la fermeture (copier la logique de `Modal.svelte`, l. 60-80) ; Tab piégé seulement si `modal` ; Échap ferme (désactivé si `dirty` sans confirmation) ; scroll interne, en-tête et pied collants ; `scroll-padding` pour 2.4.11.
- **Usage** : formulaire d'édition de 1 à ~10 champs, détail d'un objet, aperçu/appliquer un lot, réglage d'une extension. Non modal par défaut pour garder le contexte (diagramme visible). Surface `surface-2`, `shadow-3` seulement si modal, sinon bordure simple.
- **Ne pas** : y mettre un assistant multi-étapes de plus de 3 écrans (→ page), une confirmation destructive (→ 5.13).

### 5.2 `CommandPalette` — palette de commandes globale (extension de l'existant)

Existant : `features/editor/dbml/CommandPalette.svelte` (locale à l'éditeur DBML, score par sous-séquence avec bonus de début de mot, types `PaletteItem` dans `DbmlEditor/types.ts`).

```ts
interface Command { id: string; label: string; hint?: string; group: "Aller à" | "Actions" | "Projets" | "Tables" | "Réglages";
                    keywords?: string[]; shortcut?: string; icon?: Component; when?: () => boolean; run: () => void | Promise<void>; }
interface CommandPaletteProps { commands: Command[]; placeholder?: string; recents?: string[]; onClose: () => void; }
```
- **Ouverture** : `Ctrl/Cmd+K` partout (et `F1`). Fournisseurs enregistrés par fonctionnalité (`registerCommands(source)`) ; la palette DBML actuelle devient un fournisseur de la palette globale.
- **États** : vide (récents + suggestions), saisie (résultats groupés, surlignage des lettres trouvées), aucun résultat (propose « Rechercher dans le SQL »), exécution en cours.
- **A11y** : motif `combobox` + `listbox` (`role="combobox"`, `aria-expanded`, `aria-activedescendant`, `aria-controls`), flèches haut/bas, Entrée, Échap ; résultat annoncé (`aria-live="polite"` : « 5 résultats ») ; chaque raccourci affiché en `<kbd>`.
- **Usage** : navigation (« Aller au projet… », « Ouvrir Admin → Utilisateurs »), actions (Nouveau projet, Exporter, Basculer le thème, Changer la densité). Surface `surface-2`, `shadow-3`, largeur 560 px, rayon `lg`. C'est la seule fenêtre centrée non destructive conservée, parce qu'elle est éphémère (une frappe, une exécution).

### 5.3 `ContextMenu` — menu contextuel (unification)

Existant : `components/ui/Menu.svelte`, `MenuItem.svelte`, `Popover.svelte`, `components/ui/contextMenuStyles.ts`, `features/editor/canvas/CanvasContextMenu.svelte`, `ToolbarMenu.svelte` : trois implémentations de la même chose.

```ts
type MenuEntry =
  | { kind: "item"; id: string; label: string; icon?: Component; shortcut?: string; danger?: boolean; disabled?: boolean | string; checked?: boolean; onSelect: () => void }
  | { kind: "submenu"; id: string; label: string; entries: MenuEntry[] }
  | { kind: "separator" } | { kind: "label"; label: string };
interface ContextMenuProps { entries: MenuEntry[]; x: number; y: number; onClose: () => void; }  // + <Menu> ancré (bouton) avec le même moteur
```
- **États** : item survolé/actif (roving `tabindex`), désactivé (avec raison au survol/focus si `disabled` est une chaîne), danger (`danger-text`, séparé en bas), coché, sous-menu ouvert (flèche droite).
- **A11y** : `role="menu"`/`menuitem`/`menuitemcheckbox`, flèches, Début/Fin, lettre de saut, Échap, Maj+F10 / touche Menu pour l'ouvrir au clavier, `aria-haspopup` pour les sous-menus, focus restauré sur l'élément déclencheur.
- **Usage** : clic droit sur table/champ/relation/zone ; actions de ligne dans les listes (en doublon d'un bouton « … » `MoreMenu` visible, car le clic droit n'est pas découvrable). Placement via `utils/placement.ts` existant, z-index `--z-context-menu`.

### 5.4 `FloatingToolbar` — barre d'outils flottante

Existant : `components/ui/AnimatedToolbarPill.svelte`, `canvasToolbarStyles.ts`, `features/editor/canvas/CanvasZoomBar.svelte`, `InsertToolDropdown.svelte`, `DetailLevelDropdown.svelte`.

```ts
interface FloatingToolbarProps { label: string; orientation?: "horizontal" | "vertical"; placement?: "top" | "bottom" | "left" | "right";
  anchor?: HTMLElement | { x: number; y: number }; items: ToolbarItem[]; overflow?: "menu" | "scroll"; }
type ToolbarItem = { id: string; icon: Component; label: string; shortcut?: string; kind?: "button" | "toggle" | "menu" | "segment"; pressed?: boolean; disabled?: boolean; onSelect?: () => void; entries?: MenuEntry[] } | { kind: "separator" };
```
- **États** : au repos (`surface-2`, `shadow-1`), outil actif (`primary-subtle` + soulignement 2 px), désactivé, débordement dans un menu « … » sous 480 px de large. Apparition 120 ms.
- **A11y** : `role="toolbar"` + `aria-label` + `aria-orientation` ; un seul arrêt de tabulation (roving), flèches pour parcourir ; chaque bouton icône a `aria-label` (déjà dérivé du `data-tooltip` par `Button`) ; boutons à bascule avec `aria-pressed` ; infobulle ≥ 400 ms **et** au focus.
- **Usage** : outils du canvas (sélection, table, relation, note, zone), barre de sélection multiple (aligner, colorier, grouper), zoom. Taille de bouton `--control-h-md`, cible tactile étendue.

### 5.5 `Tree` — arbre

Existant : `features/admin/connections/ExplorerPanel.svelte` (explorateur de base distante), `features/editor/dictionary/DictionaryPanel.svelte`, projets/groupes.

```ts
interface TreeNode<T = unknown> { id: string; label: string; icon?: Component; badge?: string | number; children?: TreeNode<T>[]; lazy?: boolean; data?: T; }
interface TreeProps<T> { nodes: TreeNode<T>[]; expanded?: Set<string>;  selected?: string | null; multi?: boolean;   // bind:
  loadChildren?: (node: TreeNode<T>) => Promise<TreeNode<T>[]>; onSelect?: (n: TreeNode<T>) => void; onActivate?: (n: TreeNode<T>) => void;
  renderLabel?: Snippet<[TreeNode<T>]>; filter?: string; virtualize?: boolean; "aria-label": string; }
```
- **États** : replié/déplié (chevron + `aria-expanded`), sélectionné (`primary-subtle` + barre 2 px), focalisé, chargement paresseux (squelette de 2 lignes), vide (« Aucune table »), filtré (correspondances surlignées, parents conservés), erreur de chargement (ligne avec « Réessayer »).
- **A11y** : motif ARIA `tree` : `role="tree"`/`treeitem`/`group`, `aria-level`/`aria-setsize`/`aria-posinset`, flèches (haut/bas, droite = déplier/entrer, gauche = replier/parent), Début/Fin, `*` déplie les frères, saisie de caractères pour sauter, Entrée = activer, Espace = sélectionner.
- **Usage** : explorateur de schéma d'une connexion, liste de tables/groupes d'un projet, arborescence de dossiers de projets. Virtualisation au-delà de 200 nœuds (réutiliser la mécanique de `DataGrid`). Ligne de hauteur `--row-h`.

### 5.6 `DataGrid` v2 — grille de données virtualisée

Existant : `components/ui/DataGrid.svelte` (props : `columns`, `rows`, `sort` bindable, `widths` bindable, `onWidthsCommit`, `rowHeight = 28`, `overscan = 8`, `maxHeight = 420`) + `dataGrid.ts` + `dataGrid.test.ts`. Ajouts :

```ts
interface DataGridProps<R> { columns: Column<R>[]; rows: R[]; rowKey: (r: R) => string; density?: "inherit" | "compact" | "comfortable";
  sort?: SortState | null; selection?: Set<string>; selectionMode?: "none" | "single" | "multi";
  stickyColumns?: number; loading?: boolean; empty?: Snippet; error?: { message: string; retry: () => void };
  onRowActivate?: (r: R) => void; rowActions?: (r: R) => MenuEntry[]; expandable?: Snippet<[R]>; "aria-label": string; height?: number | "fill"; }
```
- **États** : chargement (lignes squelette avec la hauteur réelle, pas de saut de mise en page), vide (EmptyState), erreur, ligne survolée/sélectionnée/focalisée, colonne triée (`aria-sort`), redimensionnement (poignée 8 px de large, curseur, `aria-valuenow`), valeur `NULL` en `text-muted` italique (jamais vide), troncature avec infobulle + copie.
- **A11y** : `role="grid"`, `aria-rowcount`/`aria-colcount`/`aria-rowindex` (indispensables en virtualisé), navigation par cellule (flèches), Entrée active, Espace sélectionne, Ctrl+A, `aria-selected`. Une table non éditable simple peut rester `role="table"`.
- **Usage** : résultats SQL, données de seeds, journal d'activité, utilisateurs. `font-variant-numeric: tabular-nums`, en-tête collant, rayures **non** (fond uni + séparateur `border-subtle`).

### 5.7 `Breadcrumb` — fil d'Ariane (nouveau)

Aucun existant (seul `DbmlEditor/StatusBar.svelte` expose une trace de position de curseur).

```ts
interface Crumb { label: string; href?: string; onSelect?: () => void; icon?: Component; menu?: MenuEntry[] }   // menu = frères
interface BreadcrumbProps { items: Crumb[]; maxVisible?: number /* défaut 4 */; "aria-label"?: string /* défaut "Fil d'Ariane" */ }
```
- **États** : lien, courant (texte `text`, `aria-current="page"`, non cliquable), tronqué (`…` ouvre un menu des niveaux masqués), survol/focus standard.
- **A11y** : `<nav aria-label>` + `<ol>`, séparateurs décoratifs `aria-hidden`, le dernier élément porte `aria-current="page"`.
- **Usage** : Équipe › Projet › Version, Admin › Connexions › Fiche. Hauteur 32 px, sous l'en-tête d'application. Sous 640 px : seulement « ‹ Parent ».

### 5.8 `SideNav` — navigation latérale repliable (nouveau)

Existant à remplacer : `components/layout/Navbar.svelte` (barre haute avec bouton compte), `features/workspace/WorkspaceBar.svelte` (onglets `Tabs variant="line"`), `features/admin/AdminConsole.svelte` (onglets d'admin).

```ts
interface NavItem { id: string; label: string; icon: Component; href?: string; badge?: number | string; children?: NavItem[]; permission?: () => boolean; }
interface SideNavProps { sections: { label?: string; items: NavItem[] }[]; current: string; collapsed?: boolean;  // bind:collapsed, mémorisé
  footer?: Snippet; onNavigate: (id: string) => void; "aria-label": string; }
```
- **États** : déplié (232 px, icône + libellé), replié (56 px, icône + infobulle au survol **et au focus**), élément courant (`aria-current="page"` + barre latérale 3 px + fond `primary-subtle`), avec pastille de compteur, sous-menu déplié ; sous 768 px : devient un tiroir (5.1) ouvert par un bouton menu.
- **A11y** : `<nav aria-label>`, liste de liens (pas de rôles `tab`) ; bouton de repli avec `aria-expanded` et libellé ; lien « Aller au contenu » en première tabulation ; état replié mémorisé en préférence utilisateur.
- **Usage** : navigation de premier niveau (Projets, Équipes, Déploiements, Surveillance, Admin, Réglages). Remplace les onglets de `WorkspaceBar` ; les onglets restent pour les vues d'un même objet (Tabs, 5.9).

### 5.9 `DetailLayout` — fiche (mise en page de détail)

Existant : `features/admin/TeamDetailView.svelte`, `admin/DbAccessEditor.svelte`, `workspace/PipelineCard.svelte` ; chacun invente sa disposition.

```ts
interface DetailLayoutProps { title: string; subtitle?: string; status?: Snippet /* StatusPill */; breadcrumb?: Crumb[]; actions?: Snippet;
  tabs?: TabItem[]; activeTab?: string; aside?: Snippet; /* colonne latérale de métadonnées, 320 px */ children: Snippet;
  dirty?: boolean; onSave?: () => void; onDiscard?: () => void; }
```
- **Anatomie** : fil d'Ariane → en-tête (titre `--text-page`, statut, actions primaires à droite) → onglets (`Tabs variant="line"`) → corps en sections (`<section aria-labelledby>`) avec titre `--text-title` → colonne latérale optionnelle (propriétés : créé le, propriétaire, environnement). Pied d'enregistrement collant quand `dirty` (« Modifications non enregistrées » + Enregistrer/Annuler).
- **A11y** : un seul `h1` par page ; sections avec `aria-labelledby` ; onglets `role="tablist"` (déjà géré par `Tabs`) ; le pied collant est un `role="region"` annoncé.
- **Usage** : une connexion, une équipe, un utilisateur, un projet. Remplace les modales d'édition riches : l'édition se fait **dans la page** (sections avec champs en ligne ou bouton « Modifier » qui ouvre un tiroir).

### 5.10 `EmptyState` v2

Existant : `components/ui/EmptyState.svelte` (boîte pointillée avec un texte centré, 8 lignes).

```ts
interface EmptyStateProps { icon?: Component; title: string; description?: string;
  primary?: { label: string; onclick: () => void; icon?: Component }; secondary?: { label: string; href?: string; onclick?: () => void };
  variant?: "first-use" | "no-results" | "no-permission" | "error" | "offline"; compact?: boolean; }
```
- **Variantes** (texte `ux-copy` à valider avec le propriétaire) : *première utilisation* (invite + action primaire : « Créer un projet »), *aucun résultat* (rappel des filtres + « Effacer les filtres »), *pas de droit* (explique quel rôle, lien vers l'admin), *erreur* (message, « Réessayer », détail repliable), *hors ligne*.
- **A11y** : l'icône est décorative (`aria-hidden`), `role="status"` seulement quand l'état apparaît après une action (résultats vides d'une recherche) ; titre en `h2/h3` selon le contexte.
- **Usage** : toute liste, grille, panneau sans contenu. Remplace les 32 usages (27 fichiers) de l'`EmptyState` à une ligne ; fond `surface-1`, bordure **pointillée supprimée** (elle se lit comme « zone de dépôt »).

### 5.11 `Skeleton`

Existant : `Skeleton.svelte`, `SkeletonCard.svelte`, `SkeletonCardGrid.svelte` (conservés). Ajouts : `SkeletonRow`, `SkeletonTree`, `SkeletonDetail`.

```ts
interface SkeletonProps { shape?: "line" | "block" | "circle"; width?: string; height?: string; lines?: number; }
```
- **États** : pulsation douce 1,4 s (désactivée sous `prefers-reduced-motion`, remplacée par une teinte fixe `surface-3`), jamais plus de 400 ms de latence avant affichage (évite le clignotement).
- **A11y** : le conteneur chargé porte `aria-busy="true"` ; un seul libellé caché « Chargement… » (`role="status"`) pour l'ensemble, pas un par bloc.
- **Usage** : toute zone chargée via `useAsyncResource` (`app/asyncResource.svelte.ts`) ; la hauteur du squelette = la hauteur finale (zéro décalage de mise en page).

### 5.12 `Toast` — notifications

Existant : `components/overlays/ToastHost.svelte` + `components/ui/toast.svelte.ts` (tons `info|success|warning|danger`, durée par défaut vs durée avec action, région `aria-live="polite"`). On garde l'API, on corrige le rendu et la politique.

```ts
toast.show({ tone, title, description?, action?: { label, onclick }, durationMs?, persistent?: boolean, id?: string /* dédoublonnage */ });
```
- **Politique** : succès = 4 s ; info = 6 s ; avertissement et erreur avec détail = persistants jusqu'à fermeture ; avec action (annuler) = 8 s et pause au survol/focus ; maximum 3 visibles, regroupement des doublons (« ×3 ») ; l'erreur bloquante n'est **pas** un toast mais un message en ligne près de la cause.
- **Rendu** : `surface-2`, bordure gauche 3 px du ton, icône de ton + titre en `text`, description en `text-secondary` (texte coloré interdit, ratio non garanti), `shadow-2`, en bas à gauche pour ne pas couvrir le zoom du canvas (à confirmer, Q7).
- **A11y** : région `aria-live="polite"` (existante) ; `role="alert"` seulement pour `danger` ; pause de l'expiration au focus (WCAG 2.2.1) ; bouton fermer étiqueté ; les notifications importantes restent consultables dans le centre existant (`features/notifications/NotificationBell.svelte`).

### 5.13 `ConfirmDialog` destructif (seule modale conservée)

Existant : `components/overlays/ConfirmDialog.svelte` (4,4 Ko, 12 fichiers l'emploient) bâti sur `Modal.svelte` avec `narrow`.

```ts
interface ConfirmDialogProps { title: string; consequence: string;     // ce qui sera perdu, en une phrase concrète
  confirmLabel: string;                                                // verbe + objet : « Supprimer 3 tables », jamais « OK »
  tone?: "danger" | "warning"; typeToConfirm?: string;                // saisir le nom de l'objet pour les cas irréversibles
  details?: Snippet; busy?: boolean; onConfirm: () => void | Promise<void>; onCancel: () => void; }
```
- **États** : repos, saisie de confirmation invalide (bouton désactivé `aria-disabled` + indication), `busy` (non fermable), erreur renvoyée par le serveur (message en ligne, la boîte reste ouverte).
- **A11y** : `role="alertdialog"` + `aria-describedby` vers la conséquence ; **focus initial sur « Annuler »** (jamais sur l'action destructive) ; Échap = annuler ; Entrée ne confirme pas pour `typeToConfirm` ; bouton destructif `danger` avec libellé explicite, pas seulement rouge.
- **Usage** : suppression d'utilisateur/projet/compte, vider la corbeille, restauration qui écrase, rollback de déploiement, désactiver/regénérer la 2FA (liste en 6.2). Largeur 440 px, `rounded-lg`, `shadow-3`. Toute autre « confirmation » légère (quitter sans enregistrer sur un champ) se fait en ligne ou en annulation (toast « Annuler »).

### 5.14 `StatusPill` — pastille de statut (remplace `Badge` et `EnvironmentBadge`)

Existant : `components/ui/Badge.svelte` (5 tons : admin/muted/warning/success/danger, `text-[10px] uppercase`), `features/environments/EnvironmentBadge.svelte` (7 couleurs).

```ts
type PillTone = "neutral" | "primary" | "success" | "warning" | "danger" | "info" | "locked"
              | `env-${"green"|"blue"|"violet"|"amber"|"orange"|"red"|"grey"}`;
interface StatusPillProps { tone: PillTone; label: string; icon?: Component; dot?: boolean; size?: "sm" | "md"; emphasis?: "subtle" | "solid"; production?: boolean; title?: string; }
```
- **États** : `subtle` (fond `*-subtle`, texte `*-text`, bordure `*-border`), `solid` (fond solide + blanc, réservé au danger/production), avec ou sans point. Hauteur 20 px, texte 11-12 px, **pas de majuscules forcées**.
- **A11y** : le sens est dans le **libellé** (« Production », « En échec »), jamais dans la couleur seule ; `title`/infobulle pour la précision ; pastille de production avec cadenas + bordure 2 px ; contraste vérifié aux tableaux 2.6 à 2.8.
- **Usage** : environnement d'une connexion, état d'un déploiement, rôle (`admin`), verrou, invitation (en attente/acceptée/expirée), santé d'une base (« Santé »).

### 5.15 `MetricCard` — carte de métrique et tableau de bord

Existant : `features/workspace/MonitoringCard.svelte`, `CompareEnvironmentsCard.svelte`, onglet « Santé »/trafic des CHANGELOG récents.

```ts
interface MetricCardProps { label: string; value: string | number; unit?: string; delta?: { value: number; direction: "up" | "down" | "flat"; goodWhen: "up" | "down" };
  status?: "ok" | "warn" | "crit" | "unknown"; series?: number[]; seriesLabel?: string; href?: string; loading?: boolean; error?: string; asOf?: Date; }
```
- **Anatomie** : libellé (`--text-label`, `text-secondary`), valeur (`--text-metric`, tabular), delta avec flèche **et** signe (+3,2 %), mini-courbe `chart-1` sans axes mais avec valeur min/max au survol et alternative textuelle, horodatage « il y a 2 min ».
- **États** : chargement (skeleton de la hauteur réelle), erreur (icône + « Réessayer »), inconnu (« — » `text-muted`, jamais 0), seuils (`warn`/`crit` → pastille 5.14, pas seulement la bordure).
- **A11y** : `role="group"` + `aria-label` « Latence p95 : 42 ms, en hausse de 3 % » ; courbes avec `<title>`/`<desc>` ou tableau de données masqué ; ne pas animer plus de 400 ms.
- **Usage** : grille `repeat(auto-fit, minmax(220px, 1fr))` en tête de la vue Surveillance, Santé, Déploiements ; 4 à 6 cartes maximum par écran.

### 5.16 `FilterBar` — barre de filtres

Existant : filtres ad hoc dans `ActivityTab.svelte`, `ErrorsTab.svelte`, `UsersTab.svelte`, `InvitationsTab.svelte`, listes de projets.

```ts
type FilterDef = { id: string; label: string; type: "search" | "select" | "multiselect" | "date-range" | "toggle"; options?: { value: string; label: string; count?: number }[] };
interface FilterBarProps { filters: FilterDef[]; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void;
  resultCount?: number; saved?: { name: string; value: Record<string, unknown> }[]; sticky?: boolean; syncToUrl?: boolean; }
```
- **Anatomie** : champ de recherche large (raccourci `/` pour le focaliser), puces de filtre (clic = popover d'options), puces actives avec ✕ (« Environnement : Prod ✕ »), bouton « Tout effacer », compteur « 24 résultats » (`aria-live="polite"`), tri à droite.
- **États** : aucun filtre, filtres actifs, aucun résultat (→ `EmptyState` variante `no-results`), chargement (le compteur affiche un squelette, la liste garde l'ancien contenu atténué sans opacité : bandeau de progression de 2 px).
- **A11y** : `role="search"` sur le conteneur ; chaque puce est un bouton à `aria-expanded` ; suppression d'une puce au clavier (Retour arrière/Suppr sur la puce focalisée) ; l'état des filtres est reflété dans l'URL (`syncToUrl`) pour le partage et le retour arrière du navigateur.
- **Usage** : toutes les listes d'admin (activité, erreurs, utilisateurs, invitations), journal des déploiements, liste de projets.

---

## 6. Règles : fenêtre, panneau, page ou en ligne ?

### 6.1 Arbre de décision

| Si l'interaction… | alors | Exemple |
|---|---|---|
| **détruit ou écrase** des données de façon difficile à annuler | **Dialogue de confirmation destructif** (5.13), seule modale | supprimer un projet, restaurer une sauvegarde |
| tient en **un champ ou un choix** sur un objet visible | **En ligne** (champ éditable sur place, `Popover` ancré, menu) | renommer, changer un rôle, verrouiller une table |
| est **réversible immédiatement** | **En ligne + toast « Annuler »** plutôt qu'une confirmation | archiver, retirer un membre, déplacer |
| édite ou affiche **un objet** avec ≤ 10 champs sans quitter le contexte | **Tiroir** (5.1), non modal | éditer une connexion, aperçu d'un statement, réglage d'un plugin |
| demande de **comparer** avec le contexte visible | **Tiroir large non modal** ou panneau scindé (`Splitter`) | propriétés d'une table à côté du diagramme |
| est un **parcours à plusieurs étapes** (> 3), un **assistant**, ou dure **> 1 minute** | **Page** (route dédiée) avec stepper et brouillon | déploiement, import depuis une base, création de projet |
| est une **zone de réglages durable** (plusieurs sections) | **Page** | Réglages, Extensions, Sécurité (2FA) |
| est une **fiche** consultée et partagée par lien | **Page** (`DetailLayout`, 5.9) | connexion, équipe, utilisateur |
| est une **info non bloquante** (succès, état de tâche) | **Toast** (5.12) ou bannière en ligne | « Projet exporté », « Redirigé vers Structure » |
| est une **erreur de saisie** | **Message en ligne** au champ, jamais un toast | « Nom déjà utilisé » |
| est une **recherche/navigation** rapide | **Palette de commandes** (5.2) | Ctrl+K |

Cinq invariants :
1. **Pas de modale sur modale**, jamais. Un tiroir peut ouvrir un dialogue de confirmation, rien d'autre.
2. **Chaque page/tiroir a une URL** (hash ou chemin) : lien partageable, bouton Retour fonctionnel, restauration après rechargement. Aujourd'hui `Root.svelte` n'expose que des routes ponctuelles (par ex. `#components`) : un routeur léger est un prérequis du lot 8 (Q8).
3. **Un tiroir non modal ne bloque ni le canvas ni le clavier du canvas**, sauf focus dans le tiroir.
4. **Fermer = jamais perdre silencieusement** : si `dirty`, demander (confirmation « Abandonner les modifications ? ») ; si une opération est en vol, fermeture inhibée (comportement actuel de `dismissable`).
5. **Largeurs normalisées** : confirmation 440 px ; tiroir 400/560/760 px ; palette 560 px. Fin des `w-[Npx]` ad hoc (les plus fréquents aujourd'hui : 220, 420, 640, 340, 300).

### 6.2 Inventaire des 38 fichiers `<Modal>` et destination proposée

La cible est une proposition de tri par type d'interaction ; chaque fichier est à ré-ouvrir au moment de son lot pour confirmer. Décompte : **10 confirmations destructives**, **16 tiroirs**, **8 pages**, **4 interactions en ligne/popover/toast** = 38.

| Fichier (sous `apps/web/src/`) | Aujourd'hui | Destination |
|---|---|---|
| `components/overlays/ConfirmDialog.svelte` | confirmation générique (12 appelants) | **Confirmation destructive** (5.13), ajout de `typeToConfirm` |
| `features/admin/DeleteUserModal.svelte` | suppression utilisateur | Confirmation destructive |
| `features/backups/RestoreDialog.svelte` | restauration d'une sauvegarde | Confirmation destructive, `typeToConfirm` |
| `features/connections/RollbackConfirmModal.svelte` | rollback de déploiement | Confirmation destructive |
| `features/projects/components/DeleteProjectModal.svelte` | suppression de projet | Confirmation destructive |
| `features/projects/components/EmptyTrashModal.svelte` | vider la corbeille | Confirmation destructive |
| `features/settings/DeleteAccountModal.svelte` | suppression de compte | Confirmation destructive, `typeToConfirm` |
| `features/settings/totp/TotpDisableModal.svelte` | désactiver la 2FA | Confirmation destructive |
| `features/settings/totp/TotpRegenerateModal.svelte` | regénérer les codes | Confirmation destructive |
| `features/admin/connections/ConnectionEditModal.svelte` | édition de connexion (formulaire riche) | **Tiroir `lg`** (ou section de la fiche connexion) |
| `features/admin/connections/StatementModal.svelte` | affichage d'un statement | Tiroir `md` (lecture, copie) |
| `features/admin/lint/LintApplyModal.svelte` | aperçu et application de corrections | Tiroir `lg` |
| `features/admin/lint/LintPresetModal.svelte` | édition de préréglage de lint | Tiroir `md` |
| `features/admin/ResetPasswordModal.svelte` | réinitialiser un mot de passe | Tiroir `sm` de la fiche utilisateur |
| `features/admin/UserDbAccessModal.svelte` | accès base d'un utilisateur | Tiroir `lg` |
| `features/backups/BackupScopeDialog.svelte` | portée d'une sauvegarde | Tiroir `md` |
| `features/connections/PersonalAccountDialog.svelte` | compte personnel de connexion | Tiroir `sm` |
| `features/editor/ConvertTypesModal.svelte` | conversion de types | Tiroir `md` |
| `features/editor/io/ExportDialog.svelte` | export | Tiroir `md` |
| `features/editor/io/ImportDialog.svelte` | import | Tiroir `md` |
| `features/editor/seeds/SeedDialog.svelte` | génération de données | Tiroir `lg` |
| `features/editor/locks/TableLocksList.svelte` | liste des verrous | Tiroir `sm` / panneau |
| `features/plugins/dialog/PluginSettingsModal.svelte` | réglages d'une extension | Tiroir `md` |
| `features/projects/components/WebhooksModal.svelte` | webhooks d'un projet | Tiroir `lg` |
| `features/teams/ProjectTeamsModal.svelte` | équipes d'un projet | Tiroir `md` |
| `features/connections/DeploymentModal.svelte` | assistant de déploiement (étapes diff, risques, résultat) | **Page** « Déploiement » avec stepper |
| `features/editor/compare/CompareProjectsModal.svelte` | comparaison de projets | **Page** (ou panneau scindé plein écran) |
| `features/plugins/PluginManagerDialog.svelte` | gestion des extensions | **Page** « Extensions » |
| `features/projects/components/TemplatePickerModal.svelte` | galerie de modèles | **Page** « Nouveau projet » |
| `features/projects/NewProjectFromDatabaseModal.svelte` | création depuis une base | **Page** (assistant) |
| `features/settings/SettingsModal.svelte` | réglages (modale à onglets) | **Page** « Réglages » |
| `features/settings/totp/TotpSetupWizard.svelte` | assistant 2FA | **Page** Réglages → Sécurité (stepper en ligne) |
| `features/admin/TeamDetailView.svelte` | vue détail équipe (contient une modale) | **Fiche** `DetailLayout` ; sa modale interne → tiroir |
| `features/auth/ChangePasswordModal.svelte` | changement de mot de passe | **En ligne** : section Réglages → Sécurité |
| `features/editor/locks/TableLockDialog.svelte` | verrouiller une table | **Popover ancré** à la table |
| `features/settings/totp/BackupCodesModal.svelte` | affichage unique des codes | **En ligne** (carte dans la page Sécurité + « Télécharger ») |
| `features/sql/StructureRedirectDialog.svelte` | redirection vers Structure | **Toast avec action** / bannière en ligne |
| `features/admin/ConnectionsTab.svelte` | modale interne de suppression d'une connexion (`deleting`, l. 222) | Confirmation destructive |

### 6.3 Ce que cela change pour l'utilisateur

Passage de 38 fenêtres bloquantes à **1 modèle de modale** (10 confirmations), contre 3 largeurs et 36 contenus aujourd'hui. Le diagramme reste visible quand on édite une connexion ou consulte un statement, et chaque étape de parcours long a une adresse.

---

## 7. Refonte des primitives existantes (`components/ui/`, `inputs/`, `overlays/`)

| Composant (fichier) | Constat vérifié | Décision |
|---|---|---|
| `Button.svelte` | 8 variantes ; `gradient`/`glow` sans usage littéral et en palette Tailwind brute (`indigo-600`, `violet-600`) ; `text-white` sur `bg-primary` = 4,47:1 en sombre ; `active:scale-[0.98]` ; `disabled:opacity-45` | Réduire à **5 variantes** : `primary`, `secondary` (ex-`default`), `ghost`, `danger`, `danger-ghost`. Supprimer `gradient`, `glow`, `outline` (fusionné dans `secondary`). Texte `on-primary`. Hauteurs via `--control-h-*`. Disabled par tokens, pas d'opacité. Le bouton `danger` plein (`danger` + blanc) existe pour les confirmations. Prop `loading`. |
| `Badge.svelte` | 5 tons, `text-[10px] font-bold uppercase`, `bg-*-light` (alpha) | Remplacé par `StatusPill` (5.14). Alias temporaire. |
| `Input` / `TextArea` / `NumberInput` / `PasswordInput` / `Select` (`inputStyles.ts`) | focus `ring-primary/25` quasi invisible ; bordure `border` 1,3:1 ; erreur par classe, `aria-invalid` 4 fois pour 9 `INPUT_INVALID_CLASS` ; hauteur codée `h-8`… | Bordure `border-control`, focus = bordure `primary-text` + anneau 2 px, erreur = `aria-invalid` → style (le CSS lit `[aria-invalid="true"]` au lieu d'une classe, ce qui rend l'erreur accessible *par construction*). Hauteurs `--control-h-*`. Chevron `.app-select` via `mask`/`currentColor`. |
| `Field.svelte`, `Hint.svelte`, `ErrorText.svelte` | libellé et aide dans des composants séparés ; `Hint` = `text-[12.5px] text-text-muted` | `Field` porte libellé, aide, erreur, `aria-describedby` automatique, indicateur « obligatoire » textuel. |
| `Checkbox`, `RadioGroup`, `Switch`, `SegmentedControl`, `Tabs` | `Checkbox` natif teinté `accent-primary` (15 px) ; `Tabs` 3 variantes (`pill`, `line`, `boxed`) | Cases ≥ 16 px, bordure `border-control`, état indéterminé ; `Tabs` : garder `line` (navigation d'objet) et `boxed` (choix), `pill` n'a qu'un usage sur 9 (`line` 4, `boxed` 4) : le supprimer au profit de `line`. |
| `Card.svelte` | variantes dont `glass` (`border-white/[0.06]`) et `glow` | Variantes `plain`, `interactive`, `selected`. `glass`/`glow` supprimées (connexion : Q9). Fond `surface-1`, bordure `border`, rayon `md`. |
| `EmptyState`, `Skeleton*` | voir 5.10 et 5.11 | |
| `Modal.svelte` | coque unique, `rounded-xl`, `border-border-strong`, `backdrop-blur-[3px]`, titre en `text-[14px] font-bold`, croix | Devient la coque interne de `ConfirmDialog` ; la logique de focus est extraite en `utils/focusTrap` pour `Drawer` et `CommandPalette`. Plus d'usage direct en `features/`: règle ESLint `no-restricted-imports` (8.2). |
| `Popover.svelte`, `Menu*`, `Select.svelte` (11 Ko) | 3 moteurs de placement/fermeture | Un seul moteur (`actions/placement.ts`, `hooks/dismissablePopover.svelte.ts` déjà là) ; voir 5.3. |
| `Splitter.svelte` | porte déjà `role="separator"` (l. 87) | Vérifier flèches clavier et `aria-valuenow` ; ajouter une poignée de 8 px de large (cible). |
| `ColorSwatchPicker` + `colorSwatches.ts` | 15 teintes en dur, bordure `border-white/15` | 12 teintes `--color-data-N` (2.10) + champ hex ; légende textuelle du nom de teinte (`aria-label`). |
| `ToastHost`, `GlobalTooltip` | z-index tokens OK | Tooltip : délai 400 ms, présent aussi au focus ; contenu non interactif. |
| `components/dev/PerfHud.svelte` | 7 couleurs en dur | Hors périmètre produit (outil dev) : exempter dans l'allowlist ESLint. |


---

## 8. Méthode de migration progressive

Principe : **changer les valeurs d'abord (gain visible, risque faible), les composants ensuite, les parcours en dernier**, avec des filets de sécurité posés *avant* le premier pixel modifié. Aucune étape ne casse l'appli : les anciens noms de tokens restent valides (alias) jusqu'au lot de clôture.

### 8.1 Fichier de tokens : source unique générée

```
apps/web/design/tokens.json            # source de vérité : primitives + thèmes + contraste élevé + densité
apps/web/design/contrast-pairs.json    # manifeste des paires à vérifier (section 8.4)
scripts/design/build-tokens.mjs        # produit le CSS ci-dessous ; `npm run tokens` et vérifié en CI (git diff --exit-code)
apps/web/src/styles/tokens/generated.css   # NE PAS ÉDITER : :root (sombre), [data-theme=light], [data-contrast=more], [data-density=…],
                                           #   @media (prefers-color-scheme: light) :root:not([data-theme]), @media (forced-colors)
apps/web/src/styles/tokens.css         # garde : polices, espacement, mouvement, z-index, + bloc d'alias legacy ci-dessous
```
Pourquoi générer plutôt qu'écrire à la main : le même JSON alimente le CSS **et** le test de contraste (une seule source, impossible de vérifier autre chose que ce qui est livré), et le repli `prefers-color-scheme` sans JS ne duplique pas les valeurs à la main.

Bloc d'alias legacy (dans `tokens.css`, supprimé au lot 12) :

```css
:root {
  --color-surface: var(--color-surface-1);
  --color-surface-raised: var(--color-surface-2);
  --color-surface-hover: var(--color-surface-3);
  --color-text-on-accent: var(--color-on-primary);
  --color-text-on-light: var(--color-ink);
  --color-primary-light: var(--color-primary-subtle);
  --color-success-light: var(--color-success-subtle);   /* idem warning, danger, info, locked */
  --color-success-hover: color-mix(in srgb, var(--color-success) 88%, black);   /* survol = plus sombre, ratio du blanc dessus ne baisse jamais */
  --color-stage-violet: var(--color-env-violet-dot);
  --color-stage-orange: var(--color-env-orange-dot);
  --color-editor-gutter-bg: var(--color-editor-bg);
  --color-editor-border: var(--color-border);
  --color-editor-tooltip-bg: var(--color-surface-2);
  --color-editor-tooltip-border: var(--color-border);
  --color-editor-muted: var(--color-text-muted);
  --color-editor-active-gutter-text: var(--color-text-secondary);
}
```

Extension du pont Tailwind (`apps/web/tailwind.config.js`, mêmes clés `DEFAULT` conservées pour ne rien casser) :

```js
surface: { DEFAULT: "var(--color-surface-1)", 1: "var(--color-surface-1)", 2: "var(--color-surface-2)", 3: "var(--color-surface-3)",
           raised: "var(--color-surface-2)", hover: "var(--color-surface-3)" },       // raised/hover = alias jusqu'au lot 12
border:  { DEFAULT: "var(--color-border)", subtle: "var(--color-border-subtle)", control: "var(--color-border-control)", strong: "var(--color-border-strong)" },
primary: { DEFAULT: "var(--color-primary)", hover: "var(--color-primary-hover)", text: "var(--color-primary-text)",
           subtle: "var(--color-primary-subtle)", light: "var(--color-primary-subtle)", border: "var(--color-primary-border)" },
danger:  { DEFAULT: "var(--color-danger)", text: "var(--color-danger-text)", subtle: "var(--color-danger-subtle)", light: "var(--color-danger-subtle)", border: "var(--color-danger-border)", hover: "var(--color-danger-hover)" },
// idem success, warning, info, locked ; puis :
env:  { green: { fg: "var(--color-env-green-fg)", bg: "var(--color-env-green-bg)", border: "…", dot: "…" }, /* … 7 couleurs */ },
data: { 1: "var(--color-data-1)", /* … 12 */ }, edge: { /* 6 */ }, chart: { /* 6 */ },
```
`boxShadow` : `1`, `2`, `3` (et `xs/sm/md/lg/xl/DEFAULT` mappés vers 1/1/2/3/3 pendant la transition) ; `borderRadius` : 5 rangs, `xl`/`2xl` alias de `lg`.

Gestion du thème à l'exécution (`utils/theme.ts` + script inline de `index.html`, aujourd'hui dupliqués à la main) :

```ts
export type ThemePreference = "system" | "light" | "dark";
export type ContrastPreference = "auto" | "more" | "off";      // auto = suit prefers-contrast
export type DensityPreference = "compact" | "comfortable" | "tactile" | "auto";  // auto = pointer: coarse → tactile
// résolution => <html data-theme="light|dark" data-contrast="more|normal" data-density="…">
// stockage : athanordb.theme / athanordb.contrast / athanordb.density ; migration obsidian→dark, midnight|emerald→dark.
```
Un seul module pur `resolveAppearance(prefs, mediaQueries)` testable (`theme.test.ts`), importé par le script inline compilé à la build plutôt que recopié (l'actuel commentaire de `index.html` signale la duplication comme dette).

Basculement progressif : pendant les lots 2 à 11, les nouvelles valeurs sont sous `[data-palette="v2"]` posé par un réglage « Nouvelle apparence (aperçu) » (stocké dans `athanordb.palette`). Défaut `v1` jusqu'à validation par le propriétaire, puis défaut `v2`, puis suppression du drapeau au lot 12. Coût : tokens dupliqués pendant la transition ; bénéfice : retour arrière en un clic et comparaison côte à côte avec le propriétaire.

### 8.2 Garde-fou « plus de couleur en dur » (ESLint + cliquet)

ESLint est déjà branché (`eslint.config.js`, job `Lint` de `.github/workflows/ci.yml`) avec deux précédents : `HARD_CODED_TEXT` et `NATIVE_CONTROLS_NOT_MIGRATED` (liste blanche de fichiers non encore migrés). On répète le motif exactement :

```js
// eslint.config.js (extrait)
const HARD_CODED_COLOR = [
  { selector: "Literal[value=/(^|[^&\\w])#[0-9a-fA-F]{3,8}\\b/]", message: "Couleur hex en dur : utiliser un token (--color-*)." },
  { /* sélecteur à valider sur l'AST de svelte-eslint-parser */ selector: "SvelteLiteral[value=/(^|[^&\\w])#[0-9a-fA-F]{6}\\b/]", message: "Couleur hex en dur dans le balisage." },
  { selector: "TemplateElement[value.raw=/(bg|text|border|from|to|via|fill|stroke|ring|shadow|outline|decoration)-\\[(#|rgb|hsl)/]", message: "Classe de couleur arbitraire." },
  { selector: "Literal[value=/\\b(bg|text|border|from|to|via|fill|stroke|ring)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}\\b/]", message: "Palette Tailwind brute interdite." },
  { selector: "Literal[value=/rgba?\\(/]", message: "rgb()/rgba() en dur : token ou color-mix(var(--…))." },
];
const COLORS_NOT_MIGRATED = [ /* ~25 fichiers aujourd'hui : voir la liste de 1.2, réduite à chaque lot */ ];
{ files: ["apps/web/src/**/*.{svelte,ts}"], ignores: [...COLORS_NOT_MIGRATED, "**/*.test.ts", "apps/web/src/components/dev/**"],
  rules: { "no-restricted-syntax": ["error", HARD_CODED_TEXT, ...HARD_CODED_COLOR] } }   // le sélecteur de texte est répété (la config plate remplace les options)
```
Règles complémentaires : `no-restricted-imports` interdisant `@/components/overlays/Modal.svelte` dans `features/**` hors `ConfirmDialog` (empêche toute nouvelle modale) ; `no-restricted-syntax` sur `SvelteElement[name.name='button']` hors `components/` (126 `<button>` bruts à migrer vers `Button`, pour hériter des états de la section 4 : à traiter lot par lot).

Le **CSS** n'est pas couvert par ESLint (pas de stylelint dans le dépôt) : `scripts/design/check-colors.mjs` compte hex/rgba/hsl dans `apps/web/src/**/*.css` hors `styles/tokens/**`, compare à `apps/web/design/color-baseline.json` (`{ "styles/canvas.css": 8, "styles/utilities.css": 5 }`) et **échoue si un nombre augmente** (cliquet) ; il est ajouté à l'étape `Lint` de la CI. Valeur cible : `{}`.

### 8.3 Codemod

`scripts/design/codemod-tokens.mjs` (Node pur, sans dépendance, mode `--dry-run` qui écrit un rapport, mode `--write`) applique des substitutions de classes **sûres** fichier par fichier, avec un test unitaire (`codemod-tokens.test.mjs`, entrées → sorties) :

| Motif trouvé | Remplacement | Nb estimé |
|---|---|---|
| `bg-surface-raised` / `hover:bg-surface-hover` | `bg-surface-2` / `hover:bg-surface-3` | à compter au dry-run |
| `\bbg-surface\b(?!-)` | `bg-surface-1` | idem |
| `(?<!text-)text-(primary)\b` | `text-primary-text` (42) | 42 |
| `(?<!text-)text-(success\|warning\|danger\|info\|locked)\b` | `text-$1-text` (51 + 27 + 18 + 4) | ≈ 100 |
| `(bg\|border)-(primary\|success\|warning\|danger\|info\|locked)-light` | `-subtle` | quelques-uns |
| `text-text-onaccent` ; `text-white` sur un élément `bg-primary` | `text-on-primary` | 25 `text-white` à trier à la main |
| `border-border-strong` | `border-border-control` **puis revue** (décoratif → `border-border`) | à compter |
| `rounded-(xl\|2xl)` | `rounded-lg` | 19 |
| `shadow-(xs\|sm)` / `shadow-md` / `shadow-(lg\|xl\|2xl)` | `shadow-1` / `shadow-2` / `shadow-3` | 22 / 12 / 24 |
| `text-\[(9\|9.5\|10\|10.5\|11)px\]` | `text-caption` | ≈ 107 |
| `text-\[(11.5\|12\|12.5)px\]`, `text-xs` | `text-label` | ≈ 314 |
| `text-\[(13\|13.5)px\]` | `text-body` | 22 |
| `text-\[(14\|15)px\]` | `text-title` | 4 |
| `text-\[17px\]`, `text-lg` | `text-heading` | 11 |
| `px-\[7px\]`→`px-2`, `gap-\[5px\]`→`gap-1.5`, `gap-\[3px\]`→`gap-1`… | pas de 4 | ≈ 17 |

Non automatisables (revue humaine, listes dans le rapport) : les 46 classes de palette Tailwind (choix du rôle), les hex/rgba (rôle sémantique), les styles inline `style:color=`, `canvas.css`, `searchPanel.ts`, `language.ts`. Chaque lot de migration = « codemod + correction manuelle des restes + retrait des fichiers de `COLORS_NOT_MIGRATED` + nouvelles captures ».

### 8.4 Tests de contraste automatisés en CI

La CI exécute déjà `npm test` (`apps/web` : `tsx --test "src/**/*.test.ts"`). Un fichier `apps/web/src/styles/tokens.contrast.test.ts` s'y ajoute : zéro infrastructure nouvelle, il s'exécute à chaque PR.

```ts
// contrat : pour chaque thème × contraste, pour chaque paire du manifeste, ratio >= min
import { test } from "node:test"; import assert from "node:assert/strict";
import tokens from "../../design/tokens.json" with { type: "json" };
import pairs from "../../design/contrast-pairs.json" with { type: "json" };   // [{ fg, bg, min, kind: "text"|"ui", where }]

const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (hex: string) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

for (const mode of ["light", "dark", "light+more", "dark+more"]) for (const p of pairs) {
  test(`${mode} : ${p.fg} / ${p.bg} (${p.where})`, () => {
    const min = mode.endsWith("+more") && p.kind === "text" ? 7 : p.min;
    assert.ok(ratio(resolve(mode, p.fg), resolve(mode, p.bg)) >= min);
  });
}
```
Le manifeste est généré à partir des tableaux 2.6 à 2.8 (≈ 90 paires par thème). Règles associées : (1) **aucun token de texte/fond n'est valide sans entrée au manifeste** (un second test vérifie que chaque `--color-*-text` et chaque `-subtle` y figure) ; (2) fonds translucides interdits dans le JSON (les `color-mix` de survol sont explicitement listés avec leur résultat calculé) ; (3) APCA reporté mais non bloquant (Lc ≥ 60 pour le texte courant, avertissement).

Complément **axe-core** dans le harnais E2E : on injecte `axe.min.js` (paquet `axe-core`, dépendance de dev) dans la page du catalogue (`#components`) et on lance la règle `color-contrast` + `aria-*` + `label` pour chaque combinaison thème × contraste × densité ; échec si une violation `serious`/`critical` apparaît. Cela attrape ce que le manifeste ne voit pas (un composant qui utilise la mauvaise combinaison de tokens). Un test unitaire vérifie en plus que chacune des 12 teintes `data-N` et des 15 teintes historiques de `DEFAULT_PALETTE` donne ≥ 4,5:1 avec `readableInk`.

### 8.5 Captures de non-régression visuelle

Existant utile : `apps/web/e2e/harness.ts` (démarre un environnement complet : serveur + web), `playwright-core` en dépendance racine, `e2e/component-catalogue.e2e.ts` (charge `#components`, sans authentification ni projet). **Contrainte à connaître : la CI actuelle (`.github/workflows/ci.yml`) n'exécute pas les tests E2E** (ni `test:e2e`, ni Playwright) ; elle fait lint, circularité, format, build, test unitaire, audit.

Dispositif proposé (`apps/web/e2e/visual/`) :

- **Moteur** : `playwright-core` + `pixelmatch` + `pngjs` (deux petites dépendances de dev), sans passer au runner `@playwright/test` (le projet utilise `node:test` via `tsx`). `page.screenshot({ animations: "disabled", caret: "hide" })`, `await document.fonts.ready`, `page.emulateMedia({ colorScheme, reducedMotion: "reduce", forcedColors })`, thème forcé en posant `localStorage` avant le chargement.
- **Matrice** : 4 apparences (clair, sombre, clair+contraste, sombre+contraste) × 2 densités (compact, confortable) × écrans : (a) catalogue `#components` complet, (b) un projet de démonstration avec **les 12 teintes de tables, 3 cardinalités, une zone, un groupe, une note, une table verrouillée**, (c) éditeur DBML + panneau SQL avec un échantillon couvrant les 11 rôles de syntaxe, (d) Admin → Connexions avec une pastille par couleur d'environnement et la prod, (e) tiroir ouvert, (f) dialogue de confirmation destructif, (g) Réglages, (h) liste de projets vide + remplie, (i) connexion (page de login, le cas `glass-panel`), (j) palette de commandes. ≈ 80 captures, ≈ 10 Mo de PNG ; baselines versionnées dans `apps/web/e2e/visual/__baselines__/<apparence>-<densité>/<écran>.png` (pas de LFS nécessaire à cette taille).
- **Seuils** : 0,1 par pixel (pixelmatch) ; échec au-delà de 0,2 % de pixels différents ; zones dynamiques (horodatages, avatars aléatoires) masquées par `data-visual-mask`.
- **Stabilité** : exécution dans l'image Docker Playwright épinglée (polices et anti-crénelage identiques en local et CI) ; la génération des baselines se fait *dans cette image*, jamais sur le poste.
- **Flux de mise à jour** : `npm run test:visual -- --update` produit les nouvelles images ; la PR montre l'ancien/nouveau/diff (artefact CI) ; toute PR de lot *doit* expliquer chaque image modifiée. Premier jalon : prendre les baselines de l'**existant** (lot 0) pour que le diff du lot 2 démontre précisément l'effet de la nouvelle palette.
- **Branchement CI** : nouveau job `visual` dans `ci.yml`, déclenché sur les PR qui touchent `apps/web/src/**/*.{css,svelte}` ou `apps/web/design/**` (paramètre `paths`), plus un passage nocturne ; le job construit le serveur et le web puis lance le harnais (durée estimée 6 à 10 min).

### 8.6 Ordre de migration et dépendances

```
Lot 0 garde-fous ─▶ Lot 1 tokens ─▶ Lot 2 palette v2 ─┬▶ Lot 3 primitives ─┬▶ Lot 6 couches flottantes ─▶ Lot 9/10/11 modales
                                                       ├▶ Lot 4 canvas       ├▶ Lot 7 navigation + routage ─▶ Lot 11 pages
                                                       └▶ Lot 5 typo/rayons  └▶ Lot 8 données et états
                                                                                                   Lot 12 clôture (tout le reste)
```
Pourquoi cet ordre : (1) le thème clair est la demande explicite, il sort au lot 2, après 8 à 10 jours cumulés (lots 0 à 2) ; (2) le canvas (lot 4) concentre les plus gros échecs de contraste et l'image publique du produit ; (3) les modales (lots 9 à 11) sont les plus nombreuses mais exigent d'abord `Drawer`, `ConfirmDialog` v2 et le routage ; (4) le nettoyage final retire les alias quand ESLint garantit qu'aucun appelant ne reste.

---

## 9. Lots de travail, estimations et critères d'acceptation

Échelle : **S** = 1 à 3 jours, **M** = 4 à 7 jours, **L** = 8 à 15 jours, pour un développeur front connaissant le dépôt (hors revue du propriétaire). Total indicatif : **66 à 90 jours-développeur**.

| Lot | Intitulé | Taille | Jours | Dépend de |
|---|---|---|---|---|
| 0 | Garde-fous : test de contraste, ESLint couleurs + cliquet CSS, harnais de captures (baselines de l'existant) | M | 4-5 | — |
| 1 | Pipeline de tokens : `tokens.json`, build, alias legacy, pont Tailwind, `theme.ts` (système/contraste/densité), drapeau `data-palette` | S | 2 | 0 |
| 2 | **Palette v2** : valeurs clair/sombre/contraste élevé, correction `canvas.css`/`utilities.css`/login, ombres, réglage Apparence | S | 2-3 | 1 |
| 3 | Primitives : Button, champs/Field, cases/radio/switch, Tabs, Card, focus global, `StatusPill`, attributs de densité | M | 5-7 | 2 |
| 4 | Canvas et données : `data-N`, `readableInk`, relations + motifs, zones/groupes/notes/minimap, sélecteur de teinte, CodeMirror/SQL | M | 5-7 | 2 |
| 5 | Typographie, rayons, ombres, espacements : codemod, plancher 11 px, config Tailwind | M | 3-4 | 2 |
| 6 | Couches flottantes : `Drawer`, `ConfirmDialog` v2, `ContextMenu` unifié, `Toast` politique, `FloatingToolbar`, extraction `focusTrap` | L | 7-10 | 3 |
| 7 | Navigation et routage : routeur léger, `SideNav`, `Breadcrumb`, `DetailLayout`, `CommandPalette` globale | L | 8-12 | 3 |
| 8 | Données et états : `Tree`, `DataGrid` v2, `FilterBar`, `EmptyState` v2, squelettes, `MetricCard` | M | 6-8 | 3, 5 |
| 9 | Migration des modales, vague 1 : 10 confirmations + 4 interactions en ligne | M | 5-6 | 6 |
| 10 | Migration des modales, vague 2 : 16 tiroirs | L | 7-9 | 6, 8 |
| 11 | Migration des modales, vague 3 : 8 pages (Réglages, Déploiement, Comparaison, Nouveau projet/base, Extensions, 2FA, fiche équipe) | L | 10-14 | 7, 10 |
| 12 | Clôture : retrait des alias et du drapeau `v2`, code mort, allowlist ESLint vide, doc | S | 2-3 | tous |

### Critères d'acceptation

**Lot 0**
- `npm test` échoue si une paire du manifeste passe sous son seuil (démontré en dégradant volontairement un token dans une PR de test).
- ESLint signale une couleur en dur dans un fichier hors `COLORS_NOT_MIGRATED` ; `check-colors.mjs` échoue si un compteur CSS augmente.
- `npm run test:visual` produit les ≈ 80 baselines de l'existant, relancé deux fois de suite sans aucun écart, en local et en CI.
- Aucune modification de rendu.

**Lot 1**
- `npm run tokens` régénère `generated.css` sans diff en CI ; l'appli s'affiche pixel pour pixel comme avant (captures du lot 0 identiques) avec `data-palette="v1"`.
- `theme.ts` testé : `system` suit `prefers-color-scheme` en direct ; anciennes valeurs de stockage migrées ; aucun flash de thème au chargement (script inline).

**Lot 2**
- Contraste : 100 % des paires du manifeste passent (88/88 par thème), contraste élevé ≥ 7:1 pour tout le texte ; axe `color-contrast` : 0 violation sur le catalogue dans les 4 apparences.
- Revue du propriétaire sur captures clair/sombre côte à côte : plus aucun aplat blanc pur (aucun token ≥ `#fbfaf7`), accents à ≤ 57 % de saturation ; la page de connexion est lisible en clair.
- Le texte `text-muted` n'est sous 4,5:1 sur aucune surface (mesure automatique).
- Réglage Apparence : Système/Clair/Sombre + Contraste élevé + Densité ; les cartes « bientôt » ont disparu.

**Lot 3**
- `Button` n'a plus que 5 variantes ; les usages de `gradient`/`glow` et `Badge` sont migrés ou aliasés ; hauteurs lues dans `--control-h-*`.
- Un seul style de focus (`:focus-visible` global) : 0 `outline-hidden` sans remplaçant (comptage ESLint) ; chaque `hover:` d'un composant a son `focus-visible:`.
- Un champ `aria-invalid="true"` s'affiche en erreur sans classe ; erreur lisible en niveaux de gris (icône + texte).
- Catalogue `#components` couvre chaque variante et chaque état (repos, survol, focus, actif, désactivé, erreur, chargement).

**Lot 4**
- Les 15 teintes historiques et la teinte libre donnent un texte ≥ 4,5:1 (test unitaire sur `readableInk`) ; les 12 teintes `data-N` ≥ 3:1 contre le canvas dans les deux thèmes.
- Les trois cardinalités se distinguent en niveaux de gris (motif) ; la prod et les relations en erreur sont identifiables sans couleur.
- 0 hex dans `features/editor/**`, `canvas.css`, `colorSwatches.ts` ; la minimap suit le thème.
- Export PNG/PDF : rendu identique à l'écran dans les deux thèmes (ou clair forcé selon Q5).

**Lot 5**
- 0 `text-[Npx]` ; aucune taille < 11 px ; `text-xs/sm/lg` redéfinis sur l'échelle ; 5 rayons, 4 ombres.
- Captures : variations ≤ 1 px d'alignement, validées une à une.

**Lot 6**
- `Drawer` : focus entrant/sortant, Échap, `dirty` avec confirmation, redimensionnable, non modal par défaut ; testé au clavier et au lecteur d'écran (NVDA) sur un parcours.
- `ConfirmDialog` : `role="alertdialog"`, focus initial sur Annuler, `typeToConfirm` fonctionnel.
- Un seul moteur de menu (Menu, ContextMenu, ToolbarMenu) : 2 implémentations supprimées ; navigation clavier complète (flèches, Début/Fin, lettre, Échap).
- Toasts : politique de durée appliquée, pause au focus/survol, doublons regroupés.

**Lot 7**
- Chaque page et tiroir a une URL ; Retour/Avancer et rechargement restaurent l'état.
- `SideNav` repliable, mémorisée, utilisable au clavier ; lien « Aller au contenu » ; sous 768 px devient un tiroir.
- `Ctrl+K` ouvre la palette depuis n'importe quel écran (hors champ de saisie bloquant) ; 100 % des destinations de navigation y figurent.

**Lot 8**
- `Tree` : motif ARIA complet, 5 000 nœuds sans dégradation (virtualisé) ; `DataGrid` : `aria-rowcount`/`aria-rowindex`, 100 000 lignes fluides (la suite `dataGrid.test.ts` étendue).
- Tout chargement liste a un squelette de hauteur identique (CLS ≈ 0 mesuré) ; tout état vide a un titre, une explication et une action.

**Lots 9, 10, 11**
- À la fin de chaque vague : les fichiers concernés n'importent plus `Modal.svelte` (règle ESLint) ; chaque destination est conforme au tableau 6.2 ou l'écart est consigné ; textes FR/EN à parité (`localeParity.ts` vert) ; captures mises à jour.
- Fin du lot 11 : `grep "<Modal"` dans `features/` ne trouve que `ConfirmDialog` ; plus de modale sur modale.

**Lot 12**
- `COLORS_NOT_MIGRATED` vide, règles en `error` partout ; aucun alias legacy dans `tokens.css` ni dans `tailwind.config.js` ; `--color-accent-*`, `glow`, `glass-*` supprimés ; `docs/etat-des-features.md` et `docs/user-guide.md` mis à jour ; `CHANGELOG.md` complété.

---

## 10. Risques et questions ouvertes

### 10.1 Risques

| # | Risque | Impact | Parade |
|---|---|---|---|
| R1 | Les couleurs de tables/zones sont stockées en hex dans les projets (et circulent via Yjs/collaboration) | Migrer les données serait irréversible et conflictuel en temps réel | **Ne jamais réécrire** les hex stockés ; seul l'affichage est assisté (`readableInk`, suggestion de teintes `data-N`) ; Q4 |
| R2 | Export image/PDF (`html-to-image`, `jspdf`) lit des variables CSS | Un export en thème sombre peut produire un document sombre sur papier | Option explicite « Export en clair » (Q5) ; test de captures sur l'export |
| R3 | Changer de thème restyle tout le document, `color-mix`/transitions sur un canvas de centaines de nœuds | Saccades, perte de fluidité | Mesurer avec `scripts/bench-web.mjs` (existant) avant/après ; pas de transition de couleur globale ; pas de `backdrop-filter` |
| R4 | Baselines visuelles instables (polices, anti-crénelage) | Faux positifs, fatigue d'équipe | Image Docker épinglée, seuil 0,2 %, masques sur zones dynamiques |
| R5 | L'E2E n'est pas exécuté en CI aujourd'hui | Les captures ne protègent que si un job les lance | Job `visual` ciblé par `paths` + nocturne (Q6) |
| R6 | 38 modales à migrer : projet qui s'étire | Interface hybride durable | Règle ESLint « pas de nouvelle `Modal` » dès le lot 6 ; vagues bornées ; drapeau `v2` |
| R7 | Le français est plus long (`fr.json` 128 Ko contre 116 Ko pour `en.json`) | Débordements dans `SideNav` replié, boutons, pastilles | Tests de captures en FR **et** EN ; `min-width: 0`, troncature avec infobulle |
| R8 | Extensions tierces (`features/plugins`) pourraient dépendre d'anciens noms de tokens ou de classes | Casse silencieuse | Vérifier le contrat d'API des plugins ; garder les alias legacy aussi longtemps que la compatibilité plugins l'exige (Q10) |
| R9 | `color-mix()` pour les survols recrée des couleurs non vérifiées | Régression de contraste invisible | Test : chaque `color-mix` doit figurer au manifeste avec résultat calculé ; sinon interdit par ESLint |
| R10 | Désaturer la marque peut diluer l'identité | Refus du propriétaire | Drapeau `data-palette`, comparaison côte à côte, Q9 |
| R11 | Des ratios conformes ne garantissent pas la conformité WCAG complète | Faux sentiment de sécurité | Audit manuel clavier + lecteur d'écran (NVDA/VoiceOver) sur 5 parcours clés à la fin des lots 6, 7, 11 |
| R12 | Apprentissage : nouveaux motifs (Drawer, URL de page) pour les utilisateurs existants | Pic de support | Notes de version, palette `Ctrl+K` qui retrouve l'ancien emplacement, réglage Apparence « aperçu » avant bascule |

### 10.2 Questions pour le propriétaire (avec recommandation)

- **Q1 — Thème par défaut.** Passer de « sombre fixe » à **« Système »** pour les nouveaux comptes (les comptes existants gardent leur choix) ? *Recommandé : oui.*
- **Q2 — Thèmes `midnight` et `emerald`.** Aujourd'hui affichés « bientôt » et désactivés (`SettingsTabContent.svelte`). *Recommandé : supprimer les cartes tant qu'aucun thème n'est livré ; les remettre via le pipeline de tokens quand voulus (un thème = un bloc dans `tokens.json`).*
- **Q3 — Densité par défaut.** `compact` (identique à l'existant) ou `comfortable` (14 px, plus d'air, plus simple à lire) pour l'interface « simplifiée » ? *Recommandé : `comfortable` hors canvas pour les nouveaux comptes, `compact` conservé pour les existants.*
- **Q4 — Teintes de tables.** Proposer un « Mettre à jour mes couleurs » (remplace les 15 teintes historiques par les 12 nouvelles, action explicite par projet) ou ne jamais toucher aux données ? *Recommandé : jamais automatique, bouton explicite par projet.*
- **Q5 — Export image/PDF.** Toujours en clair, ou suivre le thème actif ? *Recommandé : option avec « clair » par défaut.*
- **Q6 — CI.** Accepter un job `visual` (et idéalement `e2e`) dans `ci.yml` ? Sans cela, les non-régressions visuelles reposent sur la discipline des développeurs. *Recommandé : oui, ciblé par `paths` + nocturne.*
- **Q7 — Navigation.** Remplacer la barre haute + onglets par une **navigation latérale repliable** (`SideNav`) ou garder la barre haute et ajouter seulement la palette et le fil d'Ariane ? Position des toasts : bas-gauche (hors zoom du canvas) ? *Recommandé : navigation latérale ; toasts bas-gauche.*
- **Q8 — Routage.** Accepter des URL pour chaque page/tiroir (nécessaire à « page plutôt que popup ») : hash (`#/projets/42/connexions`) ou chemin (nécessite un repli serveur) ? *Recommandé : hash, pas de changement serveur.*
- **Q9 — Marque et page de connexion.** Conserver le halo indigo et l'effet verre de `Login.svelte` (effet verre qui ne tient pas en clair) ou une page sobre à fond de surface ? Nom des thèmes « Papier »/« Ardoise » acceptable ? *Recommandé : page sobre, indigo désaturé `#4a4fa6`.*
- **Q10 — Plugins.** Les extensions tierces peuvent-elles rendre de l'interface ou lire les variables CSS ? Si oui, quels tokens deviennent un contrat public stable ?
- **Q11 — « Interface simplifiée ».** Veut-on un **mode « Simple/Avancé »** masquant SQL, lint, seeds, déploiement derrière « Avancé », ou seulement une meilleure hiérarchie ? Cela change la navigation (5.8) et doit être tranché avec les sections « parcours » du plan.
- **Q12 — Textes.** Valider avec le propriétaire le ton des titres de confirmation destructive et des états vides (verbe + objet, conséquences explicites), en FR d'abord, EN dérivé.

---

## Annexe A — Scripts et chiffres de référence

Les scripts Node qui ont produit tous les ratios et comptages de ce document sont des prototypes jetables (scratchpad de session) à **reprendre dans `scripts/design/`** : `wcag.mjs` (ratio WCAG 2.x, composition alpha, APCA Lc), `audit.mjs` (paires de l'existant), `palette.mjs` (nouvelle palette et ~96 paires par thème), `final.mjs` / `gen.mjs` (environnements, données, relations, graphiques, contraste élevé, génération des blocs CSS), `scan2.mjs` (comptage des couleurs en dur, tailles, espacements). La formule utilisée :

```
L = 0,2126·R + 0,7152·G + 0,0722·B   (canaux sRGB linéarisés : c/12,92 si c ≤ 0,04045, sinon ((c+0,055)/1,055)^2,4)
ratio = (Lclair + 0,05) / (Lfoncé + 0,05)
```
Seuils retenus : texte < 18 px normal ou < 14 px gras ≥ 4,5:1 (AA) / 7:1 (AAA) ; composants graphiques et contrôles ≥ 3:1 (1.4.11) ; mode contraste élevé ≥ 7:1 pour le texte.

## Annexe B — Rappel des fichiers du dépôt cités

`apps/web/src/styles/{tokens,base,utilities,canvas,index,tailwind}.css` · `apps/web/tailwind.config.js` · `apps/web/index.html` · `apps/web/src/utils/{theme,color}.ts` · `apps/web/src/components/ui/{Button,Badge,Card,EmptyState,Hint,Input*,DataGrid,Menu,MenuItem,Popover,Select,Tabs,Splitter,Skeleton*,toast.svelte.ts,inputStyles.ts}` · `apps/web/src/components/overlays/{Modal,ConfirmDialog,ToastHost,GlobalTooltip}.svelte` · `apps/web/src/components/layout/Navbar.svelte` · `apps/web/src/components/inputs/{ColorSwatchPicker.svelte,colorSwatches.ts}` · `apps/web/src/features/settings/SettingsTabContent.svelte` · `apps/web/src/features/environments/EnvironmentBadge.svelte` · `apps/web/src/features/editor/{canvas/canvasMinimapColor.ts,edges/refEdgeTypes.ts,edges/RefEdge.svelte,nodes/table/tableStyles.ts,nodes/StickyNoteNode.svelte,dbml/language.ts,dbml/searchPanel.ts,dbml/CommandPalette.svelte}` · `apps/web/src/features/auth/Login.svelte` · `apps/web/e2e/{harness.ts,component-catalogue.e2e.ts}` · `eslint.config.js` · `.github/workflows/ci.yml` · `packages/shared/src/environments.ts` · `apps/server/src/infrastructure/migrations.ts`.

# Plan de refonte UI/UX d'AthanorDB

Synthèse des cinq études détaillées de [`refonte-ui/`](./refonte-ui/), écrites par cinq sous-agents après lecture du
code. Ce document tranche ce qui peut l'être, signale les contradictions entre études et liste les décisions qui
reviennent au propriétaire. Le détail (schémas, tableaux feature par feature, lots, fichiers) reste dans chaque étude.

| Étude                                                                                           | Contenu                                                               |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [01 — Architecture de l'information](./refonte-ui/01-architecture-information.md)              | Navigation, classement de toutes les features, URL, rôles             |
| [02 — Canvas et contrôle des tables](./refonte-ui/02-canvas-et-controle-tables.md)              | Le header trop long, barre flottante, inspecteur, clic droit          |
| [03 — Espace SQL](./refonte-ui/03-espace-sql.md)                                                | Un espace « Requêtes » type SSMS pour tous les utilisateurs           |
| [04 — Administration unifiée](./refonte-ui/04-administration-unifiee.md)                        | **Non écrite** (voir « Trou du plan »)                                |
| [05 — Design system et thèmes](./refonte-ui/05-design-system-et-themes.md)                      | Palette, contrastes calculés, composants, migration                   |
| [06 — Parcours, popups, feuille de route](./refonte-ui/06-parcours-popups-et-feuille-de-route.md) | Audit des dialogues, 12 parcours, phases, tests, estimation          |

Réserve générale : les études lisent le code mais n'ont pas lancé l'application. Les chiffres de clics, de largeurs
et de durées sont des estimations à mesurer avant la phase 1.

## 1. Pourquoi refondre : le constat commun

- **Pas de routeur.** Seules `/project/:id[/onglet]`, `/invite/…` et `/reset-password/…` ont une URL. L'administration,
  les paramètres et la console d'une base sont de l'état local (`App.svelte`, `Root.svelte`). Le serveur ne renvoie
  `index.html` que pour des chemins listés à la main (`apps/server/src/app.ts:243-247`).
- **Trop d'étages de navigation.** 27 onglets de premier niveau, 4 en-têtes différents, 3 barres empilées dans l'onglet
  Données d'un projet. Les mêmes choses existent à plusieurs endroits (paramètres en deux coques, SQL monté à trois
  endroits).
- **Trop de popups.** Entre 33 et 48 modales selon la méthode de comptage (voir « Contradictions »). Des empilements :
  déploiement, modification d'une connexion avec import, plugins.
- **Un header de canvas qui déborde.** 42 contrôles permanents avant la première table, 13 boutons dans la barre du
  projet, jusqu'à 9 icônes dans un en-tête de table de 190 px. Les actions de projet sont invisibles sous 768 px.
- **Des contrastes insuffisants.** 19 paires sur 52 échouent AA en clair, 21 sur 52 en sombre. `text-muted` est entre 2,9
  et 3,8:1 ; les bordures de champ sont à 1,2–1,8:1.

## 2. Principes directeurs

1. Une seule coque : barre latérale, fil d'Ariane, palette `Ctrl+K`. Jamais plus d'une barre d'onglets en plus.
2. Tout écran a une URL, y compris les tiroirs et les fiches.
3. La modale est réservée à l'irréversible. Le reste : page, panneau latéral, popover, inline, ou toast avec « Annuler ».
4. L'objet se traite sur l'objet : clic droit, barre flottante, inspecteur.
5. On masque ce qui est hors rôle ; on grise avec la raison seulement pour un verrou ou la production.
6. Ce que le moteur ou le compte ne peut pas donner est dit (« Non disponible »), jamais affiché à zéro.
7. Le contraste est AA minimum, vérifié par un test automatique, et le sens ne repose jamais sur la couleur seule.
8. Un registre de commandes unique alimente menus, barre flottante, palette et raccourcis.
9. Coexistence ancien/nouveau par drapeau par surface (`ui.v2.*`) ; pas de changement d'API ni de modèle de données
   pour la refonte elle-même.

## 3. Architecture cible (étude 01)

- **Barre latérale à 4 entrées** : Accueil, Projets, Bases, Administration. « Espace » devient un simple filtre de la
  liste des projets (tous, mes projets, groupes, corbeille).
- **Quatre niveaux** : global, projet, base, administration.
- **URL** (français proposé) : `/projets`, `/p/:id/{schema,qualite,versions,bases,parametres}`, `/bases/:id/…`,
  `/requetes/:connectionId`, `/admin/…`, `/compte/…`. Les liens `/invite` et `/reset-password` restent valides.
- **Projet** : onglets Schéma, Qualité, Versions, Bases, Paramètres. Déployer devient l'action de l'onglet Bases, et
  l'assistant passe en pleine page.
- **Bases = objet de premier niveau**, sorti de l'administration. Un même composant sert deux contextes : instance
  (8 onglets) et projet (4 onglets d'exploitation + lien « Administrer »).
- **Administration** : colonne secondaire en 4 familles (Personnes, Bases, Qualité, Journaux) + vue d'ensemble.
  « Équipes » devient « groupes ». Un seul composant Journal à trois périmètres.
- **Mon compte** : une page unique ; l'onglet « Équipe » (qui n'affiche que soi-même), « Facturation » (où se
  trouvent les clés d'API) et « À propos » disparaissent ; `SettingsModal` est supprimé.
- Le tableau « feature de `etat-des-features.md` → nouvel emplacement » est dans l'étude 01 (sections 1 à 11 couvertes).

## 4. Le canvas (étude 02)

- **Header unique de 48 px, 6 contrôles** : retour, menu Projet, pastille « Base » (connexion, environnement,
  Mon compte SQL), Déployer (seul bouton primaire), cloche, avatar.
- **Menu Projet** : Importer, Exporter, Comparer, Convertir, Historique, Visite.
- **Dock d'outils** en bas du canvas (sélection, main, texte, relation, zone, note, annuler/rétablir) ; **menu
  Affichage** (détail, liens, erreurs, minicarte, MLD/MCD, tracés, plugins).
- **Inspecteur de 320 px** à droite, qui remplace 6 popovers de formulaire et 2 modales de verrous ; barre flottante de
  sélection ; clic droit sur table, colonne, relation, zone et canvas vide ; barre d'état en bas (synchro, verrous,
  problèmes, SQL).
- **En-tête de table** réduit au nom, 4 pictogrammes d'état et un bouton `…`.
- Suppression de colonne annulable par toast (aujourd'hui sans confirmation ni annulation).
- **Gain honnête** : barre du haut de 24 à 12 contrôles ; total permanent de 42 à 36. L'objectif est la lisibilité, pas
  seulement le compte.
- Bugs relevés à corriger au passage : annuler/rétablir actifs hors de l'onglet Schéma, `Shift+1` affiché sans
  gestionnaire, actions de projet inaccessibles sous 768 px.

## 5. L'espace SQL (étude 03)

- **Destination « Requêtes »** dans la navigation globale, ouverte à tout compte ayant un accès accordé. Le tiroir
  `Ctrl+J` et l'onglet « Données » deviennent des cadres du même espace de travail ; `SqlPanel` (une `<textarea>`) est
  supprimé.
- **Problème actuel à corriger en premier** : un membre n'atteint le SQL que par un projet. Une base accordée mais
  rattachée à aucun projet lui est inaccessible. Nouvelle route `GET /api/me/sql-connections`.
- **Interface** : arbre d'objets (bases, schémas, tables, vues, procédures, colonnes, index), onglets de requêtes avec
  contexte propre, éditeur CodeMirror 6 (dialecte par moteur, formatage, snippets, complétion depuis le schéma), grille
  virtualisée à plusieurs jeux de résultats, messages, export, requêtes enregistrées (privées/partagées, dossiers).
- **Exécution** : lot multi-instructions découpé côté serveur, chaque instruction filtrée par le garde du rôle avant
  toute connexion ; plafonds par rôle (lecture 20, écriture membre 10 en transaction « tout ou rien », admin 200) ;
  annulation par moteur (impossible sur SQLite, dit honnêtement) ; EXPLAIN estimé pour tous, réel réservé à
  l'écriture/admin dans une transaction annulée.
- **Sécurité** : le mode écriture n'est jamais mémorisé ; bandeau rouge « PRODUCTION » ; avertissement sur
  `UPDATE`/`DELETE` sans `WHERE` ; structure toujours désactivée pour les membres, avec explication.
- **Moins de popups** : les confirmations d'écriture, de politique de structure et de compte personnel deviennent des
  bandeaux en ligne.

## 6. Design system et thèmes (étude 05)

- **C'est surtout un changement de valeurs de tokens, pas de classes** : `tokens.css` alimente déjà Tailwind et
  `text-text-muted` revient 367 fois. Les anciens noms restent valides par alias jusqu'au dernier lot.
- **Nouvelle palette** : clair « Papier » (gris chaud, aucun aplat au-dessus de `#fbfaf7`, accents à 38–57 % de
  saturation) et sombre « Ardoise » ; modes « système » et contraste élevé (≥ 7:1). 88 paires exigées sur 88 passent
  dans chaque thème (calcul, pas estimation) ; `text-muted` ≥ 5,6:1 en clair et ≥ 4,9:1 en sombre.
- **Couleurs sémantiques** découpées en solide / texte / fond doux / bordure, avec des fonds opaques ; 3 paliers de
  bordure dont `border-control` à 3:1 minimum ; 7 couleurs d'environnement (la prod reste rouge), 12 teintes de données
  du canvas, relations doublées d'un motif, syntaxe CodeMirror/SQL.
- **Échelles** : 7 rangs typographiques (plancher 11 px, contre 13 tailles aujourd'hui), 5 rayons, 4 ombres, 3
  densités ; cibles 24 px minimum, 44 px en tactile.
- **Composants** : 16 au catalogue, dont 5 nouveaux (Drawer, Breadcrumb, SideNav, DetailLayout, FilterBar).
- **Bugs trouvés** : `prefersDarkText()` donne un texte sous 4,5:1 sur 10 des 15 teintes d'en-tête de table
  (seuil 0,42 au lieu de 0,197) ; `Login.svelte` utilise `.glass-panel` codé en sombre (à vérifier à l'écran en thème
  clair) ; environ 164 couleurs en dur hors tokens.
- **Migration** : `tokens.json` génère le CSS et un test de contraste lancé par `npm test` ; règle ESLint contre les
  couleurs en dur ; codemod ; captures de non-régression via le harnais E2E ; drapeau `data-palette="v2"` pour le retour
  arrière ; le CI actuel n'exécute pas l'E2E (job `visual` proposé).
- **Le thème clair corrigé sort tôt** : après les lots 0 à 2, soit 8 à 10 jours.

## 7. Plan anti-popups (étude 06)

48 dialogues recensés : 17 restent des confirmations, 11 deviennent des pages avec URL, 12 passent en inline, 4 en
panneau latéral, 3 en popover, 1 est supprimé (`SettingsModal`). Cible : 17 confirmations ou moins et plus aucun
`Modal` direct dans `features/`. À supprimer en priorité : déploiement (`DeploymentModal` + confirmation), modification
d'une connexion + import, plugins (modale dans modale). Risque noté : ne pas perdre l'aperçu SQL avant exécution que
fournit `StatementModal`.

## 8. Feuille de route

| Phase | Contenu                                                                                  | Dépend de |
| ----- | ---------------------------------------------------------------------------------------- | --------- |
| 0     | Fondations : tokens, nouvelle palette, composants de base, test de contraste, routeur    | —         |
| 1     | Navigation : coque, URL, repli serveur générique, palette `Ctrl+K`                       | 0         |
| 2     | Canvas : header court, dock, inspecteur, clic droit (jalons A/B/C)                       | 1         |
| 3     | Espace Requêtes (12 lots)                                                                | 1         |
| 4     | Administration unifiée                                                                   | 1         |
| 5     | Projets et déploiement, retrait des anciennes modales                                    | 2, 3, 4   |
| 6     | Polissage, accessibilité, recette avec le propriétaire                                   | toutes    |

Les phases 2 et 3 peuvent avancer en parallèle après la 1. Si le budget est contraint : phases 0, 1, 4, 5 d'abord
(~19 semaines), canvas en dernier, polissage non négociable.

**Estimation** : 34 semaines-développeur (26 à 43), soit ~18 semaines à 3 développeurs. 38 fichiers e2e à adapter ou
réécrire (~35,5 jours dont 12 nouveaux tests de parcours qui comptent les clics). Les estimations par étude ne
s'additionnent pas : canvas 35–55 j, SQL 30–45 j, design system 66–90 j se recouvrent avec les phases ci-dessus.

**Mesures de succès** : nombre de dialogues (≤ 17), clics par parcours (−40 % visé sur déploiement, retour arrière,
accès aux bases, création d'un compte SQL), contrastes AA, violations axe, temps par parcours. Une base de référence
est à relever avant la phase 1.

## 9. Contradictions entre études, à trancher

| Sujet                         | Écart                                                                                                                                                           | Proposition                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Nombre de modales             | 33 (01), 38 (05), 48 (06), 28 popups dont 13 modales sur le canvas seul (02)                                                                                    | Retenir 48 (06, comptage le plus large) ; refaire un décompte unique par script avant la phase 1    |
| Menu « Projet » / « Fichier » | 02 garde les modales existantes d'import/export/comparaison ; 01 veut des panneaux                                                                              | Panneaux (cohérent avec la règle anti-popups) ; les modales actuelles servent de transition         |
| Migrations                    | 03 annonce la migration 39 pour les requêtes enregistrées                                                                                                       | 39 à 41 existent déjà (activité, compteurs, santé) : renuméroter à 42                               |
| Routeur                       | 01 propose des URL ; 06 laisse le choix de la bibliothèque ouvert                                                                                               | À décider avant la phase 1 (question 2)                                                             |
| Surveillance                  | Par projet (existant) ou par base (proposé par 01, question 12)                                                                                                 | À décider                                                                                           |

## 10. Trou du plan : l'administration unifiée

L'étude 04 n'a pas été produite : le lancement de son agent a été refusé par le classificateur de permissions
(motif donné : « Auto-Mode Bypass »), refus non contourné. L'étude 01 pose déjà la structure (4 familles, la matrice
d'accès aux bases, les fiches), mais il manque la conception détaillée demandée en premier par le propriétaire : la
**fiche personne unifiée** (profil Athanor + groupes + projets + accès aux bases + comptes SQL sur chaque base +
activité + sécurité), la **fiche base** (vue d'ensemble, accès et comptes, objets, sessions, sauvegardes, surveillance,
journal, paramètres), les listes avec filtres et actions en masse, et le tableau « onglet actuel → nouvel emplacement »
pour toute l'administration. Les phases 4 et 5 ne devraient pas démarrer sans cette étude.

## 11. Décisions attendues du propriétaire

Bloquantes pour la phase 1 :

1. « Nouveau projet » ouvre-t-il la page `/new` (un clic de plus) ?
2. Quelle bibliothèque de routage, ou routeur maison ?
3. Administration dans la même coque que le reste, ou dans une coque séparée ?
4. Un rôle DBA distinct de l'administrateur d'instance ?
5. URL en français ou en anglais ?
6. Sens exact d'« espace » (le plan en fait un filtre de la liste des projets).

Pour les autres phases :

7. Surveillance rattachée au projet ou à la base.
8. Ouvrir `/bases` aux membres, après la revue de sécurité sur la fuite d'inventaire des bases.
9. Mobile : parcours administrateur et lecteur seulement, canvas en consultation (proposition de l'étude 06).
10. Thème « système » par défaut ; mode Simple/Avancé ; CI visuelle (job `visual`).
11. Ne jamais réécrire les couleurs de table déjà enregistrées.
12. Espace SQL : comptes personnels recommandés ou imposés ; retaper le nom de la base en production avant écriture ;
    export massif autorisé en lecture ; partage des requêtes enregistrées ; besoin réel de transactions manuelles ;
    masquage des secrets dans l'audit.
13. Branches de schéma ou variantes (lié au projet racine, mis de côté).

Les études contiennent chacune leur liste complète (16 + 14 + 15 + 12 + 14 questions) ; celles ci-dessus sont les plus
structurantes.

## 12. Ce qui n'est pas vérifié

- Largeurs et hauteurs de barres, nombre de clics et durées : estimés, pas mesurés dans un navigateur.
- Annulation d'une requête sur Oracle et SQLite, contenu de `DATA_WRITE_KEYWORDS`, bibliothèque d'export Excel.
- Conflit éventuel de `Ctrl+K` avec CodeMirror ; liens émis par le serveur (notifications, webhooks) vers `/project/…`.
- `FollowMenu`, `SeedDialog`, `TableLockDialog`, `Menu.svelte` et `Tabs.svelte` n'ont pas été lus en détail ; la
  destination des modales (étude 05) est une proposition à confirmer fichier par fichier.
- Le bug `Login.svelte` en thème clair est à confirmer visuellement.

# Refonte UI/UX — 01. Architecture de l'information et navigation globale

Domaine : « toutes les fonctionnalités, comment les classer, comment les afficher ».
Hors périmètre ici : thèmes et contrastes, composants visuels, détail intérieur de chaque écran
(traités dans les autres sections du plan de refonte).

État du code analysé : `main` au commit `d12fedb`, dossier de travail propre. Sources :
`docs/etat-des-features.md` (lu en entier), `docs/todo.md` (feuille de route, Phases 29-38),
`docs/permissions.md`, `docs/user-guide.md` et le code de `apps/web/src`. Chaque affirmation
sur l'existant cite un fichier ; ce qui n'a pas été vérifié est marqué « non vérifié ».

---

## 0. Résumé exécutif

1. Aujourd'hui l'application n'a **pas de routeur** : 3 familles d'URL seulement
   (`/invite/:token`, `/reset-password/:token`, `/project/:id[/onglet]`) et tout le reste
   (administration, paramètres, console d'une base) est de l'état en mémoire, sans URL, sans
   retour navigateur, perdu au rechargement
   (`apps/web/src/features/projects/projectRouting.svelte.ts`, `apps/web/src/app/App.svelte`).
2. Il y a **27 onglets de premier niveau répartis sur 4 barres différentes** (6 de l'espace
   projet, 8 de l'administration, 6 des paramètres, 7 de la console d'une base), **4 en-têtes
   différents** (`Navbar`, `ProjectToolbar`, en-tête d'`AdminConsole`, en-tête de `SettingsPage`)
   et **33 fenêtres modales ou dialogues** (+ 2 composants de base).
3. La même chose existe à plusieurs endroits : paramètres en 2 coques, console de base à 2
   endroits, accès aux bases éditable à 4 endroits, déploiement ouvert depuis 3 endroits,
   4 journaux nommés différemment.
4. Proposition : **une coque unique** (barre latérale à 4 entrées + fil d'Ariane + palette
   `Ctrl+K`), **4 niveaux** (Global > Espace > Projet > Base), **vraies URL en français** pour
   tout, **jamais plus de 2 barres de navigation à la fois**, et **33 modales ramenées à 7
   dialogues de confirmation** (le reste devient page, panneau latéral ou section en ligne).
5. La visibilité suit le rôle : on **masque** ce qu'on ne peut pas faire (sauf si l'explication
   aide, par exemple un verrou ou la production), on ne grise jamais sans dire pourquoi.

---

## 1. Inventaire de l'existant, écran par écran

### 1.1 La coque (`apps/web/src/app/`)

`App.svelte` (142 lignes) choisit **une** vue plein écran parmi 8 branches, dans cet ordre :

| #   | Branche                                | Condition                                   | Composant                                                  |
| --- | -------------------------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| 1   | Acceptation d'invitation               | `/invite/:token` lu une fois au montage     | `features/auth/AcceptInvite.svelte`                        |
| 2   | Réinitialisation du mot de passe       | `/reset-password/:token` lu au montage      | `features/auth/ResetPassword.svelte`                       |
| 3   | Chargement                             | `session === "loading"`                     | coque vide                                                 |
| 4   | Éditeur de projet                      | `routing.openProject` (a priorité sur tout) | `features/editor/ProjectEditor.svelte` (41 Ko)             |
| 5   | Connexion                              | pas de session                              | `features/auth/Login.svelte` (+ `MfaStep`, `ForgotPasswordStep`) |
| 6   | Paramètres du compte                   | `viewMode === "settings"` (état local)      | `features/settings/SettingsPage.svelte`                    |
| 7   | Console d'administration               | `adminOpen` (état local)                    | `features/admin/AdminConsole.svelte`                       |
| 8   | Liste des projets (« tableau de bord ») | défaut                                     | `features/projects/ProjectListScreen.svelte`               |

`Root.svelte` ajoute deux routes de développement par hash : `#bench` (banc de perf du canevas)
et `#components` (catalogue de composants), chargées à la demande. À conserver telles quelles.

**Routage réel** (`projectRouting.svelte.ts`) : `PROJECT_PATH = /^\/project\/([^/]+)(?:\/([a-z]+))?$/`.
Onglets reconnus : `data`, `deployments`, `history`, `problems`, `dictionary` ; `schema` n'a
pas de segment. Paramètres `?table=&field=` pour cibler une table. `popstate` ne gère que
`/` ↔ `/project/:id`. Côté serveur, chaque chemin doit être listé à la main dans
`apps/server/src/app.ts` (lignes 243-247 : `/invite/:token`, `/reset-password/:token`,
`/project/:id`, `/project/:id/:tab`) pour que `index.html` soit servi au rechargement.

### 1.2 Liste des projets (`features/projects/`)

- `ProjectListScreen.svelte` : `Navbar` + `ProjectList`.
- `components/layout/Navbar.svelte` : marque, bouton « Admin »
  (visible seulement si `session.isAdmin` **et** si l'écran a passé `onOpenAdmin`, donc
  seulement ici), cloche de notifications (`NotificationBell`), bouton compte
  (avatar + nom + engrenage → Paramètres), bouton de déconnexion.
- `ProjectList.svelte` (12,6 Ko) : colonne de sections **Actifs / Archivés / Corbeille** avec
  compteurs (`components/ProjectTabs.svelte`, `projectSections.ts`), champ de recherche (filtre
  par nom + recherche dans le contenu dès 2 caractères, `components/GlobalSearchResults.svelte`),
  création : bouton « + » (schéma vide), bouton « Depuis un modèle »
  (`TemplatePickerModal`), « Depuis une base » (`NewProjectFromDatabaseModal`).
- Menu d'une carte (`components/ProjectCard.svelte`) : renommer (double clic), **gérer les
  équipes** (`ProjectTeamsModal`), **webhooks** (`WebhooksModal`), archiver, mettre à la corbeille,
  restaurer, supprimer définitivement ; modales `DeleteProjectModal`, `EmptyTrashModal`.

### 1.3 Espace de travail d'un projet (`features/editor/`, `features/workspace/`)

Trois étages d'en-têtes superposés :

1. `ProjectToolbar.svelte` : retour (icône chevron), nom du projet, badge lecture seule,
   annuler / rétablir / disposition auto, **Importer, Exporter, Convertir les types, Comparer**
   (4 boutons ouvrant des modales), bouton **Déployer** (administrateur du projet), indicateur de
   connexion temps réel, présence, **Suivre** (`FollowMenu`), cloche, visite guidée (icône « i »),
   engrenage = **paramètres du compte en modale** (`SettingsModal`).
2. `workspace/WorkspaceBar.svelte` : onglets du projet + à droite : compteur de verrous,
   bouton SQL (`Ctrl+J`), badge d'environnement, bouton « compte personnel » de la base, **sélecteur
   de base** (connexion courante).
3. Dans l'onglet « Données » : `DbConsole` ajoute **sa propre barre d'onglets** (7 onglets).

**Onglets du projet** (`workspaceTabs`, `ProjectEditor.svelte` l. 234-248) : `schema`
(toujours), `data` (si l'utilisateur peut interroger une base du projet), `deployments`
(administrateur du projet), `history`, `problems` (avec compteur), `dictionary`. Un onglet
demandé par l'URL mais non offert retombe **silencieusement** sur `schema` (l. 250-256).

Outils présents dans le canevas (non onglets) : `canvas/CanvasToolbar.svelte`,
`canvas/PluginMenu.svelte` (+ `PluginManagerDialog`), `CanvasSearchPanel`, `CanvasContextMenu`,
`dbml/CommandPalette.svelte` (palette **locale à l'éditeur DBML** : symboles / commandes,
alimentée par `dbml/DbmlEditor/paletteItems.ts`), `comments/*`, `locks/*`, `mcd/*` (bascule
MLD/MCD), `seeds/*` (`SeedDialog`, `GeneratePanel`), `drift/DriftBanner.svelte`
(bandeau en tête de page), tiroir SQL (`sql/EditorSqlDrawer.svelte`, `Ctrl+J`), visite guidée
(`onboarding/EditorTour.svelte`).

**Onglet Déploiements** (`workspace/DeploymentsTab.svelte`) empile : titre de la base +
« Vérifier les différences » + « Déployer » ; `PipelineCard` ; `MonitoringCard` (surveillance
des modifications externes **et** des comptes, pour *toutes* les bases du projet) ;
`CompareEnvironmentsCard` ; `connections/DeploymentHistoryPanel`. Le déploiement lui-même est
`connections/DeploymentModal.svelte` (14,3 Ko), ouvert depuis **3 endroits** (bouton de la
barre d'outils, bouton de l'onglet, « Vérifier les différences », `differencesFor`).

### 1.4 Administration (`features/admin/`)

`AdminConsole.svelte` : 8 sections en onglets, dans cet ordre (constante `SECTIONS`) :

| #   | Clé            | Étiquette (clé i18n)            | Composant                            |
| --- | -------------- | ------------------------------- | ------------------------------------ |
| 1   | `invitations`  | `admin.section.invitations`     | `InvitationsTab.svelte` (**défaut**) |
| 2   | `teams`        | `admin.section.teams` (« équipes ») | `TeamsTab` → `TeamDetailView`    |
| 3   | `users`        | `admin.section.users`           | `UsersTab.svelte`                    |
| 4   | `audit`        | `admin.section.activity`        | `ActivityTab.svelte`                 |
| 5   | `errors`       | `admin.section.errors`          | `ErrorsTab.svelte`                   |
| 6   | `connections`  | `admin.section.connections`     | `ConnectionsTab.svelte`              |
| 7   | `environments` | `admin.section.environments`    | `EnvironmentsTab.svelte`             |
| 8   | `lint`         | `admin.section.lint`            | `lint/LintPresetsTab.svelte`         |

La largeur du contenu passe de 880 à 1240 px quand on ouvre « connexions » (saut de mise en
page). `ConnectionsTab` contient : la liste des connexions, la **politique de structure par
défaut de l'instance** (une carte au-dessus de la liste), la création/édition
(`connections/ConnectionEditModal`) et l'ouverture de la console (`connections/DbConsole`).

**Console d'une base** (`admin/connections/DbConsole.svelte`, barre `Tabs` ligne 58-69), 7
onglets : `explorer`, `sql`, `users` (si le moteur a des comptes), `sessions`, `health`,
`backups`, `journal` (les trois derniers : administrateur d'instance seulement). Le **même
composant** sert dans l'onglet « Données » d'un projet (`workspace/DataTab.svelte`), avec les
mêmes règles.

### 1.5 Paramètres du compte (`features/settings/`)

Deux coques pour le même contenu (`SettingsTabContent.svelte`, 10,8 Ko) :
`SettingsPage.svelte` (page entière, depuis la liste) et `SettingsModal.svelte` (modale,
depuis l'éditeur, `ProjectEditor.svelte` l. 601). 6 onglets (`settingsSections.ts`) :

| Onglet       | Contenu réel (vérifié dans `SettingsTabContent.svelte`)                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| Profil       | e-mail, nom, mot de passe, `TwoFactorAuth`, `ActiveSessions`, `SqlAccounts`, `PersonalData`               |
| Apparence    | langue, préréglages de thème (obsidian, midnight, emerald, light ; certains « bientôt »), style de grille |
| Éditeur      | aimantation à la grille, surbrillance des clés étrangères (2 réglages)                                    |
| Équipe       | **uniquement la carte de soi-même** (nom, e-mail, badge) : aucune gestion d'équipe                        |
| Facturation  | carte « gratuit pour toujours » **+ `ApiKeys` (clés d'API) enterrées ici**                                |
| À propos     | version, licence, état de synchronisation                                                                 |

### 1.6 Les modales (33)

`find` sur `*Modal.svelte` / `*Dialog.svelte` hors composants de base (`overlays/Modal.svelte`,
`overlays/ConfirmDialog.svelte`) : **33 fichiers**. Répartition : administration 7
(`DeleteUserModal`, `ResetPasswordModal`, `UserDbAccessModal`, `ConnectionEditModal`,
`StatementModal`, `LintApplyModal`, `LintPresetModal`), éditeur 8 (`ConvertTypesModal`,
`CompareProjectsModal`, `ExportDialog`, `ImportDialog`, `TableLockDialog`, `SeedDialog`,
`PluginManagerDialog`, `PluginSettingsModal`), connexions/déploiement 3 (`DeploymentModal`,
`RollbackConfirmModal`, `PersonalAccountDialog`), sauvegardes 2 (`BackupScopeDialog`,
`RestoreDialog`), projets 5 (`NewProjectFromDatabaseModal`, `DeleteProjectModal`,
`EmptyTrashModal`, `TemplatePickerModal`, `WebhooksModal`), équipes 1 (`ProjectTeamsModal`),
compte 6 (`ChangePasswordModal`, `DeleteAccountModal`, `SettingsModal`, `BackupCodesModal`,
`TotpDisableModal`, `TotpRegenerateModal`), SQL 1 (`StructureRedirectDialog`).
La disposition de chacune est dans le § 6.

### 1.7 Défauts constatés

**D1 — Pas d'adresses pour la moitié de l'application.** Administration, paramètres, console
d'une base, assistant de déploiement : aucune URL. Pas de lien à partager (« regarde cette
base »), rechargement = retour à la liste, bouton Précédent du navigateur qui sort de
l'application. `adminOpen` et `viewMode` sont des `$state` locaux d'`App.svelte`.

**D2 — Quatre en-têtes, quatre « retour » différents.** `Navbar` (bouton texte « Retour » ou
marque), `ProjectToolbar` (icône chevron + infobulle), `AdminConsole` (icône chevron + marque
+ titre), `SettingsPage` (texte « Retour » + marque cliquable). Le bouton « Admin » n'existe
que sur la liste des projets : depuis un projet ou les paramètres, on ne peut pas aller en
administration sans repasser par la liste.

**D3 — Trois barres de navigation empilées** dans « Données » d'un projet : en-tête, onglets du
projet + sélecteur de base, onglets de la console (7). Un utilisateur doit comprendre trois
niveaux avant d'écrire un `SELECT`.

**D4 — Paramètres en double coque** (`SettingsPage` / `SettingsModal`), et l'engrenage de
l'éditeur ouvre les paramètres **du compte**, pas ceux du projet : il n'y a pas d'endroit
« paramètres du projet ». Ses réglages sont éparpillés : équipes et webhooks dans le menu de
la carte de la liste, lint dans l'onglet Problèmes, base dans la barre d'espace, suivi dans
`FollowMenu`, renommer/archiver dans la liste.

**D5 — Fonctions enterrées.**
- Clés d'API : onglet « Facturation » (`SettingsTabContent.svelte` l. 222-241), alors que la
  facturation n'est qu'un texte « gratuit ».
- « Mes comptes SQL » : tout en bas de l'onglet Profil, sous 2FA et sessions.
- Webhooks et équipes d'un projet : uniquement par le menu de la carte dans la liste, jamais
  depuis le projet ouvert.
- Surveillance (modifications externes + comptes) : carte dans l'onglet Déploiements alors que
  son résultat (bandeau `DriftBanner`) apparaît en haut de toutes les pages du projet et que
  l'historique de ce qui s'est passé « côté base » est dans Admin > Connexions > Journal.
- Politique de structure par défaut : carte au-dessus de la liste des connexions.
- Visite guidée : icône « i » discrète de la barre d'outils de l'éditeur seulement.
- Données de départ (CSV) et générateur : dans un clic droit / dialogue de table.

**D6 — La même chose à plusieurs endroits.**

| Objet                      | Endroits actuels                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Paramètres du compte       | `SettingsPage` (liste) et `SettingsModal` (éditeur)                                                                          |
| Console d'une base         | Admin > Connexions > Ouvrir ; projet > Données (`DataTab`)                                                                   |
| Accès d'un membre à une base | `UserDbAccessModal` (Admin > Utilisateurs), `TeamDetailView` (Admin > Équipes), `InvitationsTab` (à l'invitation), + compte SQL dans Paramètres > Profil et `PersonalAccountButton`/`PersonalAccountDialog` dans la barre d'espace |
| Déployer                   | bouton de `ProjectToolbar`, bouton de `DeploymentsTab`, « Vérifier les différences »                                         |
| Journaux                   | Admin > Activité, Admin > Erreurs, console > Journal (par base), historique du projet (journal de modélisation)              |
| Santé / état d'une base    | console > Santé, `connections` liste (pastille de santé), bandeau de dérive, `MonitoringCard`                                |
| Lint                       | modèles : Admin > Lint ; projet : onglet Problèmes (`LintSettingsCard`) ; application d'un modèle : `LintApplyModal`          |
| Notifications              | cloche dans `Navbar` **et** dans `ProjectToolbar`                                                                            |
| Créer un projet            | « + », « Depuis un modèle », « Depuis une base » (3 chemins, 2 modales)                                                      |
| Palette de commandes       | seulement dans l'éditeur DBML (`CommandPalette.svelte`) ; recherche globale seulement dans la liste de projets               |

**D7 — Vocabulaire incohérent.** « Équipes » (UI : `admin.section.teams`, `ProjectTeamsModal`)
contre « groupes » (documents de pilotage : « Comptes Athanor et groupes ») ; « Connexions »
(menu admin) / « bases » (console) / « environnements » ; « Activité » / « Journal » /
« Journal des erreurs » ; « Paramètres » (`settings.*`) / « Réglages » (infobulle de
`ProjectToolbar` : `common.settings`) ; « Données & SQL » contre « Données » (étiquette réelle
de l'onglet) contre « Console » ; « dérive » (jargon interne) contre « modifications faites
hors Athanor ».

**D8 — Fonctions factices ou à moitié.** Onglet « Équipe » des paramètres (carte de soi-même)
et « Facturation » (texte) : espace pris, rien à faire. Thèmes marqués « bientôt ».

**D9 — Rôle visible nulle part.** Le seul indice de son rôle est le badge « Lecture seule »
de la barre d'outils et l'absence silencieuse d'onglets. Un lecteur qui reçoit un lien vers
`/project/:id/deployments` atterrit sur le schéma sans explication
(`ProjectEditor.svelte` l. 250-256). Un lien vers un projet interdit donne une erreur textuelle
sur la liste (`openLinkError`).

**D10 — Barres d'outils surchargées et à largeur variable.** `ProjectToolbar` : 4 actions
de fichier + déployer + 3 actions d'historique + présence + suivi + cloche + visite + paramètres
= 13 contrôles dans un en-tête de 40 px ; masquage `hidden md:flex` des actions de fichier
(donc inaccessibles sous la largeur `md`).

**D11 — Création de contenu éclatée.** Les « actions sur la base » (importer depuis une base,
créer un projet depuis une base, tirer le schéma, comparer avec la base, déployer) vivent dans
5 écrans différents.

**D12 — Dépendance du routage à l'état.** `focusTarget`, `tab` et `openProject` sont des états
parallèles synchronisés à la main avec `history` (trois `$effect` dans
`projectRouting.svelte.ts`). Toute nouvelle page hérite de cette fragilité tant que le routage
n'est pas centralisé.

### 1.8 Ce que l'existant fait bien (à garder)

- Onglets filtrés par droit réel (`workspaceTabs`) : le principe « on masque ce qu'on ne peut
  pas faire » est déjà là.
- Sélecteur de base unique dans l'espace de travail, avec badge d'environnement en rouge en
  production (`WorkspaceBar.svelte`).
- Console de base commune aux deux entrées : un seul composant, bonne base de réemploi.
- Chargement différé (`{#await import(...)}`) de tous les panneaux lourds
  (`ProjectEditor.svelte`).
- L'éditeur démonte le canevas quand on change d'onglet (pas de raccourcis fantômes).

---

## 2. Principes directeurs de la nouvelle architecture

1. **Une adresse par écran.** Tout écran et tout onglet a une URL ; la navigation navigateur
   (précédent/suivant, rechargement, copier-coller du lien) marche partout.
2. **Quatre niveaux, un seul fil d'Ariane.** Global > Espace > Projet > Base. On sait toujours
   où l'on est et on remonte d'un clic.
3. **Une seule barre d'onglets visible à la fois** (en plus de la barre latérale). En contexte
   base, la barre d'onglets du projet cède la place à celle de la base ; le projet reste
   accessible par le fil d'Ariane.
4. **Un objet, un endroit canonique.** Une même fonction peut avoir plusieurs *entrées*
   (raccourci, lien, palette) mais un seul *écran propriétaire*.
5. **Les modales sont réservées aux confirmations** (destruction, restauration, écriture en
   production) et à la saisie d'un code (2FA). Tout formulaire de plus de 2 champs devient
   page, panneau latéral ou section dépliée.
6. **Masquer plutôt que griser**, sauf quand l'explication a de la valeur (table verrouillée,
   production, accès refusé à une base : voir § 5).
7. **Le vocabulaire est unique** (§ 3.1) et identique en français et en anglais (mêmes
   concepts).
8. **Les domaines métier restent regroupés** : modéliser (projet), publier (déploiement),
   exploiter (base), administrer (instance), personnaliser (compte).

---

## 3. Nouvelle architecture

### 3.1 Vocabulaire retenu

| Ancien (code / UI)                     | Nouveau terme en français            | Remarque                                                                    |
| -------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| équipe(s), `teams`                     | **groupe(s)**                        | aligné sur `etat-des-features.md` ; renommer `admin.section.teams` etc.     |
| connexion, connexion à une base        | **base** (la page) ; « connexion » reste le terme du formulaire technique | `connections.*` → `bases.*` côté libellés |
| Données & SQL / Données / Console      | **Données** (explorateur) et **SQL**  | deux onglets de la base                                                     |
| Activité (admin), Journal (base)       | **Journal** (avec un périmètre : instance / projet / base) | un seul mot                                              |
| Journal des erreurs                    | **Erreurs** (sous Journal)           |                                                                             |
| dérive, surveillance des tables        | **Modifications externes**           | « dérive » reste dans le code                                               |
| surveillance des comptes               | **Comptes de la base — surveillance** | sous Base > Comptes                                                        |
| Paramètres / Réglages                  | **Paramètres** partout               | `common.settings`                                                           |
| Problèmes (lint)                       | **Qualité**                          | l'onglet regroupe Problèmes, Dictionnaire, Verrous                          |
| Historique                             | **Versions**                         | Historique, Comparer                                                        |
| Environnement                          | **Environnement**                    | inchangé                                                                    |
| Mes comptes SQL                        | **Mes comptes SQL**                  | inchangé                                                                    |

### 3.2 Les quatre niveaux

| Niveau        | Contenu                                                                 | Navigation propre                                       | Préfixe d'URL            |
| ------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------ |
| **1. Global** | Accueil, Projets, Bases, Administration, Compte, notifications, aide    | **Barre latérale** (rail d'icônes + libellés)           | `/`, `/projets`, `/bases`, `/admin`, `/compte` |
| **2. Espace** | Un périmètre de travail : tous mes projets, un groupe, la corbeille     | **Sélecteur d'espace** en tête de la page Projets (menu déroulant + filtres latéraux) | `/projets?espace=…` |
| **3. Projet** | Modéliser, qualité, versions, bases du projet, paramètres du projet     | **Barre d'onglets du projet** (6 onglets)               | `/p/:id/…`               |
| **4. Base**   | Explorer, interroger, déployer, administrer une base                    | **Barre d'onglets de la base** (remplace celle du projet) | `/bases/:id/…` ou `/p/:id/bases/:id/…` |

**Définition de l'« espace »** (décision proposée, à valider — Q1) : un *espace* est un
périmètre de projets, pas une nouvelle entité en base. En V1 : « Tous », « Mes projets »
(dont je suis propriétaire), « Partagés avec moi », un espace par **groupe** dont je suis
membre, « Archivés », « Corbeille ». Il n'y a pas de page d'espace séparée : c'est la page
`/projets` filtrée. Quand le « projet racine et déclinaisons » (Phase 35) arrivera, une
*famille* (racine + variantes) s'insère sous ce niveau sans changer les URL (`/projets?famille=…`,
onglet « Variantes » du projet racine).

### 3.3 Niveau 1 — la coque et la barre latérale

La barre latérale remplace `Navbar`, l'en-tête d'`AdminConsole` et celui de `SettingsPage`.
Elle est **repliable** (rail de 56 px / 232 px) et se **replie automatiquement** dans l'onglet
Schéma pour laisser la place au canevas. Rien n'y est configurable par l'utilisateur en V1.

```
Zone haute
  [Marque AthanorDB]
  Accueil                      /
  Projets                      /projets                (compteur : actifs)
  Bases                        /bases                  (visible si au moins 1 base accessible)
  Administration               /admin                  (administrateur d'instance seulement)

Zone basse
  Rechercher… Ctrl+K           ouvre la palette
  Notifications (cloche)       popover + « Tout voir » → /notifications
  Aide                         menu : visite guidée, raccourcis, guide, version, licence
  Compte (avatar + nom)        menu : Mon compte, Apparence, Langue, Se déconnecter
```

Décisions :
- **4 entrées** seulement à gauche (3 pour un membre sans base). Pas de sous-menus dépliés :
  la navigation de niveau 3 et 4 est dans la page, pas dans la barre latérale.
- Le **bouton « Admin »** devient une entrée permanente de la barre (corrige D2).
- Les **notifications** quittent les 2 en-têtes pour une seule cloche de la barre ; dans
  l'éditeur la cloche reste aussi dans la barre supérieure de la page (présence + suivi), car
  la barre latérale est repliée.
- **Aide** regroupe : visite guidée (aujourd'hui `ProjectToolbar` icône « i »), raccourcis
  clavier, guide utilisateur (`docs/user-guide.md` publié), « À propos » (version, licence,
  état de synchronisation : contenu de l'ancien onglet « À propos »).
- **Compte** (menu) : « Mon compte » → `/compte` ; bascule rapide de **thème** (clair / sombre /
  système) et de **langue** (sans quitter la page) ; « Se déconnecter ».
- La **barre supérieure** de chaque page contient : fil d'Ariane (gauche), actions de la page
  (droite : présence/suivi dans un projet, badge d'environnement dans une base), bouton de
  recherche `Ctrl+K`.

### 3.4 Fil d'Ariane

Forme : `Accueil › Projets › Boutique › Bases › pg-prod › SQL`. Règles :
- Chaque segment est un lien, sauf le dernier ; **chaque segment de projet ou de base est aussi
  un menu de bascule** (clic sur le nom → liste de mes projets / des bases de ce projet, avec
  recherche).
- Le **badge d'environnement** (couleur, rouge en production) est collé au nom de la base et
  reste visible sur tous les onglets de la base, pas seulement dans un dialogue.
- Sous 640 px : seul le dernier parent + le courant (« ‹ Boutique / SQL »).
- Les pages hors projet affichent : `Administration › Utilisateurs`, `Compte › Sécurité`,
  `Bases › pg-prod › Comptes`.

### 3.5 Niveau 3 — le projet

Barre d'onglets du projet (remplace `WorkspaceBar` + moitié de `ProjectToolbar`) :

| Onglet                | Sous-sections                                                          | Qui le voit                              |
| --------------------- | ---------------------------------------------------------------------- | ---------------------------------------- |
| **Schéma**            | canevas / DBML / MCD, commentaires, recherche, SQL (tiroir `Ctrl+J`)   | tous (lecture : `view`)                  |
| **Qualité**           | Problèmes · Dictionnaire · Verrous                                     | tous (modifier : `edit`)                 |
| **Versions**          | Historique · Comparer · Journal de modélisation                        | tous (restaurer : `edit`)                |
| **Bases**             | Bases du projet · Pipeline · Modifications externes · Données de départ · Comparer les environnements | selon accès (voir § 5)     |
| **Paramètres**        | Général · Accès (groupes) · Webhooks · Qualité du projet · Notifications | administrateur du projet               |
| *Variantes* (réservé) | arbre, matrice (Phase 35)                                              | projets racine, plus tard                |

Choix de conception :
- **« Schéma » reste l'onglet par défaut**, et reste le seul où la barre latérale se replie.
- **Fichier ▾** (nouveau menu dans la barre supérieure du Schéma) remplace les 4 boutons
  Importer / Exporter / Convertir les types / Comparer : *Importer…*, *Exporter…*,
  *Convertir les types…* ouvrent des **panneaux latéraux droits** (adressables
  `?panneau=importer|exporter|convertir`) ; *Comparer…* mène à Versions > Comparer.
- **Annuler / rétablir / disposition auto** restent des icônes de la barre d'outils du canevas
  (`canvas/CanvasToolbar`), pas de la barre supérieure : ce sont des actions de canevas.
- **Déployer** n'est plus un bouton global de l'en-tête : c'est l'action principale de
  l'onglet **Bases** (et de chaque page de base, onglet *Déploiements*). Un raccourci
  « Déployer… » existe dans la palette `Ctrl+K` (contexte projet, administrateur).
- **Paramètres du projet** devient un vrai onglet (corrige D4). L'engrenage de l'éditeur, qui
  ouvrait les paramètres du compte, disparaît : le compte est dans la barre latérale.
- **Qualité** réunit ce qui est réparti entre « Problèmes », « Dictionnaire » et le compteur
  de verrous : un même sujet (la santé du schéma), trois vues.
- **Suivre** (`FollowMenu`) reste dans la barre supérieure du projet (action de lecteur) et est
  aussi un réglage dans Paramètres > Notifications.

### 3.6 Niveau 4 — la base

Une base a **deux contextes** d'accès pour un seul composant :

- **Contexte instance** : `/bases/:id/…` (administrateur d'instance, ou membre avec accès) —
  toutes les fonctions.
- **Contexte projet** : `/p/:projet/bases/:id/…` — les fonctions utiles pour ce projet.

Onglets (barre de la base) :

| Onglet            | Contenu (anciennes sources)                                                                                                 | Contexte instance | Contexte projet |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- | :---------------: | :-------------: |
| **Aperçu**        | santé, version, latence, tailles, trafic, sessions en cours (résumé), alertes, modifications externes, dernier déploiement (`HealthPanel`, `MonitoringCard`, `DriftBanner`) | ✔ | ✔ |
| **Données**       | explorateur, données paginées, export CSV, export en données de départ (`ExplorerPanel`)                                      | ✔ | ✔ |
| **SQL**           | éditeur, historique de ses requêtes, mode écriture confirmé (`SqlPanel`)                                                      | ✔ | ✔ |
| **Déploiements**  | assistant (remplace `DeploymentModal`), historique et retour arrière, pipeline (`DeploymentHistoryPanel`, `PipelineCard`)     | tous projets, filtre | ce projet |
| **Comptes**       | comptes/rôles/privilèges, créer/supprimer/verrouiller, sessions, accès Athanor accordés, surveillance des comptes (`UsersPanel`, `SessionsPanel`, `DbAccessEditor`) | ✔ (admin) | lien « administrer » |
| **Journal**       | événements Athanor, requêtes (temps/fréquence), côté base (`JournalPanel`)                                                    | ✔ (admin) | lien |
| **Sauvegardes**   | liste, planification, restauration (`BackupsPanel`)                                                                           | ✔ (admin) | lien |
| **Paramètres**    | édition de la connexion, environnement, tags, lecture seule, politique de structure, compte personnel, projets rattachés, SSH/TLS à venir (`ConnectionEditModal`, `ConnectionFormFields`) | ✔ (admin) | lien |

Règle : dans le contexte projet, les 4 onglets d'exploitation sont affichés ; les 4 onglets
d'administration (Comptes, Journal, Sauvegardes, Paramètres) sont remplacés par **un seul lien
« Administrer cette base ↗ »** vers le contexte instance — ce qui supprime la superposition de
barres (D3) tout en gardant un seul code.

**« Mon compte SQL »** (aujourd'hui `PersonalAccountButton` + `PersonalAccountDialog`) devient
une **bannière en ligne** en haut des onglets Données / SQL quand la base demande un compte
personnel et que l'utilisateur n'en a pas : « Cette base utilise un compte par personne. Saisir
mon mot de passe », formulaire déplié à la place d'une modale. La gestion complète est dans
`/compte/comptes-sql`.

### 3.7 Niveau 1 bis — Administration (`/admin`)

Colonne secondaire à gauche (pas d'onglets horizontaux : 8 → 11 entrées regroupées), la barre
latérale globale restant visible en rail :

| Groupe             | Entrée                       | Ancienne source                                      | URL                                  |
| ------------------ | ---------------------------- | ---------------------------------------------------- | ------------------------------------ |
| *(tête)*           | **Vue d'ensemble**           | nouveau (§ 4.1)                                      | `/admin`                             |
| **Personnes**      | Utilisateurs                 | `UsersTab`                                           | `/admin/utilisateurs`, `…/:id`       |
|                    | Groupes                      | `TeamsTab`, `TeamDetailView`                         | `/admin/groupes`, `…/:id`            |
|                    | Invitations                  | `InvitationsTab`                                     | `/admin/invitations`                 |
|                    | Accès aux bases              | `UserDbAccessModal`, `DbAccessEditor`, `TeamDetailView` (nouveau : matrice) | `/admin/acces-bases` |
| **Bases**          | Environnements               | `EnvironmentsTab`                                    | `/admin/environnements`              |
|                    | Politique de structure       | carte de `ConnectionsTab`                            | `/admin/politique-structure`         |
| **Qualité**        | Modèles de lint              | `LintPresetsTab`, `LintPresetModal`, `LintApplyModal` | `/admin/qualite`, `…/:id`           |
| **Journaux**       | Journal d'activité           | `ActivityTab`                                        | `/admin/journal`                     |
|                    | Erreurs                      | `ErrorsTab`                                          | `/admin/erreurs`                     |
| *(à venir)*        | Alertes, Export SIEM, SMTP   | Phase 34, `etat-des-features` §8/§10/§5              | `/admin/alertes`, `/admin/export-journal` |

Les **bases elles-mêmes** (ancien onglet « Connexions ») ne sont plus dans l'administration :
elles sont un objet de premier niveau (`/bases`), parce que des membres non administrateurs y
ont accès et que le sujet (exploiter une base) n'est pas de l'administration d'instance.
`/admin/politique-structure` règle seulement la politique par défaut.

**Accès aux bases** (page canonique) : une matrice *personnes/groupes × bases* avec le niveau
(aucun / lecture / écriture) et le compte SQL associé. C'est l'écran propriétaire de
`DbAccessEditor` ; les trois autres entrées (fiche utilisateur, fiche groupe, invitation, Base >
Comptes) **réutilisent le même composant filtré** (une personne, un groupe, une base) — on ne
peut pas supprimer ces entrées, car elles correspondent à des points de vue différents sur la
même donnée, mais elles ne sont plus quatre implémentations.

### 3.8 Niveau 1 bis — Mon compte (`/compte`)

Remplace `SettingsPage` **et** `SettingsModal` (une seule page, plus de modale).

| Section             | Contenu                                                                                         | Ancienne source                              | URL                         |
| ------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------- |
| **Profil**          | e-mail, nom, mes groupes (lecture seule, remplace l'onglet « Équipe »)                          | Profil + Équipe                              | `/compte`                   |
| **Sécurité**        | mot de passe, 2FA, sessions actives                                                             | Profil (blocs)                               | `/compte/securite`          |
| **Mes comptes SQL** | un compte par base qui en demande un                                                            | `SqlAccounts` (bas de Profil)                | `/compte/comptes-sql`       |
| **Clés d'API**      | clés, portées, lien vers OpenAPI                                                                | `ApiKeys` (dans Facturation)                 | `/compte/api`               |
| **Apparence**       | thème, langue, style de grille                                                                  | onglet Apparence                             | `/compte/apparence`         |
| **Éditeur**         | aimantation, surbrillance des clés étrangères, options de l'éditeur DBML (formatage, complétion, délai de synchronisation — emplacement actuel non vérifié, probablement `dbml/DbmlPanel.svelte`) | onglet Éditeur | `/compte/editeur` |
| **Plugins**         | gestionnaire (stockage local au navigateur), réglages de plugin                                  | `PluginManagerDialog`, `PluginSettingsModal` | `/compte/plugins`           |
| **Mes données**     | export de mes données, suppression du compte (zone dangereuse)                                   | `PersonalData`, `DeleteAccountModal`         | `/compte/donnees`           |

Supprimés : l'onglet « Équipe » (aucune fonction), « Facturation » (aucun produit ; à
recréer quand l'offre hébergée existera — Q9), « À propos » (déplacé dans Aide).

### 3.9 Niveau 1 — Accueil, Projets, Bases (contenu)

- **Accueil `/`** : page adaptative au rôle (§ 4).
- **Projets `/projets`** : liste/grille, filtre latéral d'espace (Tous, Mes projets, Partagés,
  groupes, Archivés, Corbeille avec compteurs, reprise de `ProjectTabs`), recherche (nom +
  contenu, reprise de `GlobalSearchResults`), bouton **Nouveau projet** → page
  `/projets/nouveau` (§ 6) au lieu de deux modales ; menu d'une carte réduit à *Ouvrir,
  Renommer, Archiver, Corbeille* + « Paramètres du projet » (le reste est dans le projet).
- **Bases `/bases`** : liste des bases accessibles (administrateur : toutes ; membre : celles
  accordées) avec pastille de santé, environnement, moteur, tags, projets rattachés, niveau
  d'accès (lecture/écriture). Bouton **Nouvelle base** (administrateur) → `/bases/nouvelle`.
  Filtre par environnement et par tag.
- **Notifications `/notifications`** : boîte de réception complète (mentions, réponses,
  déploiements des projets suivis), filtre « non lues ».

---

## 4. Pages d'accueil par rôle

Les rôles sont deux axes (`docs/permissions.md`) : instance (administrateur / membre) et projet
(`view`, `edit`, `administrator`), plus un **droit d'accès à une base** (`read`/`write`)
indépendant. L'accueil est déterminé par ce que la personne peut *faire*, dans cet ordre de
priorité, et les blocs s'additionnent (un administrateur voit aussi « Reprendre »).

### 4.1 Administrateur d'instance — « Vue d'ensemble de l'instance »

```
Accueil
├─ À traiter (alertes, ne s'affiche que si non vide)
│    · modifications externes ouvertes (n bases)          → /p/…/bases (dérive)
│    · comptes de base modifiés hors Athanor (n bases)    → /bases/:id/comptes
│    · bases hors ligne ou lentes (n)                     → /bases?etat=hors-ligne
│    · invitations en attente (n)                         → /admin/invitations
│    · erreurs de l'application (24 h) (n)                → /admin/erreurs
├─ Bases (cartes de santé : nom, environnement, latence, sessions, verrous bloquants)
├─ Activité récente (10 dernières lignes du journal d'activité)       → /admin/journal
├─ Reprendre (5 projets récents)
└─ Raccourcis : Inviter · Nouvelle base · Nouveau projet · Ouvrir le SQL
```

### 4.2 Éditeur de projet (au moins un projet `edit` ou `administrator`, pas administrateur d'instance)

```
Accueil
├─ Reprendre (projets récents avec dernière modification, badge de mon niveau)
├─ Pour vous (mentions, réponses, déploiements des projets que j'administre)
├─ Modifications externes sur mes projets (bandeau si une base de mes projets a dérivé)
├─ Bases de mes projets (état, dernier déploiement) — administrateur de projet seulement
└─ Raccourcis : Nouveau projet · Importer un DBML · Depuis une base
```

### 4.3 Membre avec accès SQL (droit sur au moins une base)

```
Accueil
├─ Mes bases (cartes : nom, environnement, niveau « lecture » / « données (écriture) »,
│    compte SQL personnel à saisir si demandé)    → /bases/:id/donnees | /sql
├─ Dernières requêtes (mon historique, 5)
├─ Reprendre (projets récents)
└─ Raccourcis : Ouvrir le SQL de la dernière base · Mes comptes SQL
```
Le membre n'y accède aujourd'hui que depuis un projet rattaché (décision D24 de
`docs/a-decider-et-a-tester.md`, « Accès aux bases : par où »). La page `/bases` pour un
membre est précisément la décision ouverte « Une page “Mes bases” hors projet » : l'accueil
la matérialise ; **si D24 est maintenue**, la carte mène à `/p/:projet/bases/:id/sql` d'un
projet rattaché (Q4).

### 4.4 Lecteur (`view` seulement, pas d'accès base)

```
Accueil
├─ Projets partagés avec moi (grille, badge « Lecture seule »)
├─ Récemment consultés
└─ Notifications / mentions (si une mention reste possible — voir permissions.md)
```
Pas de bloc Bases, pas de raccourcis de création si l'instance le permet : tout compte peut
créer un projet (`docs/permissions.md`), donc **« Nouveau projet »** reste visible pour tous.

### 4.5 Atterrissage après connexion

Lien profond conservé : un utilisateur non connecté qui ouvre `/p/:id/…` voit la connexion puis
atterrit **sur ce lien** (comportement actuel `App.svelte` branche 5 → 4). Sinon : `/`. Pas de
mémoire de « dernière page » en V1 (Q13).

---

## 5. Règles de visibilité par rôle

### 5.1 Convention

| Cas                                                          | Traitement                                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Fonction hors de portée du rôle                              | **Masquée** (entrée de menu, onglet, bouton, option de palette)                                              |
| Fonction possible mais bloquée par un état (verrou, production, base en lecture seule, politique de structure, projet archivé) | **Visible, désactivée, avec la raison** dans une infobulle et, pour les cas fréquents, une phrase en ligne |
| Lien profond vers une page interdite                         | **Page « Accès refusé »** explicite (jamais de retour silencieux au schéma), avec un lien utile              |
| Lien vers un objet supprimé                                  | Page « Introuvable » avec les projets/bases récents                                                         |
| Rôle modifié pendant la session                              | La page courante affiche un bandeau « vos droits ont changé » et recharge ses onglets                        |
Rappel : l'interface *suit* la règle, c'est le serveur qui la fait respecter
(`docs/permissions.md`, `apps/server/src/shared/guards.ts`).

### 5.2 Matrice de visibilité de la navigation

Légende : ● visible · ○ visible sous condition (note) · — masqué. Colonnes : **AI** admin
d'instance · **AP** administrateur de projet · **ED** `edit` · **LE** `view` · **BA** droit
d'accès à une base (`read`/`write`, indépendant des rôles de projet).

| Élément                                         | AI | AP | ED | LE | BA | Condition / note                                                     |
| ----------------------------------------------- | :-: | :-: | :-: | :-: | :-: | -------------------------------------------------------------------- |
| Accueil, Projets, Compte, Notifications, Aide   | ●  | ●  | ●  | ●  | ●  | tout compte                                                          |
| Nouveau projet                                  | ●  | ●  | ●  | ●  | ●  | tout compte peut créer un projet                                     |
| Bases (entrée de barre latérale)                | ●  | ○  | —  | —  | ●  | AP : seulement les bases de ses projets, en contexte projet          |
| Administration                                  | ●  | —  | —  | —  | —  |                                                                      |
| Projet > Schéma, Qualité, Versions              | ●  | ●  | ●  | ●  | —  | `view` suffit pour lire ; modifier : `edit`                          |
| Projet > Bases                                  | ●  | ●  | ○  | ○  | ○  | ED/LE/BA : visible seulement s'ils ont un droit sur une base du projet ; sinon masqué |
| Projet > Paramètres                             | ●  | ●  | —  | —  | —  |                                                                      |
| Base > Aperçu                                   | ●  | ●  | ○  | ○  | ●  | AP : états des bases du projet ; BA : aperçu réduit (sans comptes)   |
| Base > Données, SQL                             | ●  | ○  | ○  | ○  | ●  | uniquement via droit d'accès à la base (jamais « parce qu'on est dans le projet » — D24) |
| Base > Déploiements                             | ●  | ●  | —  | —  | —  | AP du projet                                                         |
| Base > Comptes, Journal, Sauvegardes, Paramètres | ●  | —  | —  | —  | —  | admin d'instance (garde `requireAdmin`)                              |
| Écriture SQL (mode écriture)                    | ●  | ○  | ○  | ○  | ○  | niveau `write` seulement ; données uniquement ; jamais la structure  |
| Déployer / retour arrière                       | ●  | ●  | —  | —  | —  | production : nom de la base à retaper                                |
| Verrous : placer, lever                         | ●  | ●  | —  | —  | —  | `instance` : admin d'instance seulement                              |
| Modifier le schéma, importer, données de départ | ●  | ●  | ●  | —  | —  |                                                                      |
| Exporter, comparer, lire le dictionnaire        | ●  | ●  | ●  | ●  | —  |                                                                      |
| Commenter avec mention                          | ●  | ●  | ●  | —  | —  | `edit` ou plus                                                       |
| Webhooks, groupes du projet, lint du projet     | ●  | ●  | —  | —  | —  |                                                                      |
| Surveillance (activer, régler)                  | ●  | ●  | —  | —  | —  | AP du projet ; surveillance des *comptes* : admin d'instance seulement |
| Voir le bandeau de modification externe         | ●  | ●  | ●  | ●  | —  |                                                                      |
| Sauvegardes, restauration                       | ●  | —  | —  | —  | —  | admin d'instance                                                     |
| Clés d'API                                      | ●  | ●  | ●  | ●  | ●  | selon portées, tout compte                                           |
| Plugins                                         | ●  | ●  | ●  | ●  | ●  | local au navigateur                                                  |

### 5.3 Règles de détail

1. **L'entrée « Bases » apparaît seulement s'il y a quelque chose à y voir** : administrateur
   d'instance ou au moins un droit d'accès. Un administrateur de projet voit les bases de son
   projet à l'intérieur du projet (onglet Bases), pas forcément dans la barre latérale.
2. **Pas de fuite d'inventaire.** La note de revue de sécurité (« la vue d'ensemble liste toutes
   les bases du serveur à un membre », `etat-des-features.md` § « Points pour la revue de
   sécurité ») doit être traitée au niveau de l'explorateur : la liste des bases du serveur
   n'est montrée qu'à l'administrateur ; un membre ne voit que la base à laquelle il est
   rattaché. Le choix de navigation ne résout pas ce point, il le rend visible.
3. **Compte de la connexion protégé** : l'écran Comptes n'offre pas d'action interdite sur le
   compte de la connexion ; la ligne affiche un cadenas et « protégé » (cohérent avec « sans
   exception, même pour l'administrateur »).
4. **Production** : toute action destructive ou d'écriture sur une base de niveau « protégé »
   affiche une barre de contexte rouge fixe sous le fil d'Ariane (« PRODUCTION »), pas
   seulement un badge.
5. **Projet archivé / corbeille** : consultation seule ; bandeau d'état en tête, Paramètres
   (restaurer) accessible à l'administrateur.
6. **Lecteur** : l'interface du Schéma passe en « lecture seule » visible (badge dans la barre
   supérieure + outils d'édition absents), jamais un canevas éditable qui refuserait ensuite.

---

## 6. Où va chaque fonctionnalité de `etat-des-features.md`

Colonnes : fonctionnalité · emplacement actuel · **nouvel emplacement** (URL) · forme.
Formes : **P** page · **O** onglet · **Pn** panneau latéral · **S** section dépliée/en ligne ·
**K** palette `Ctrl+K` · **D** dialogue de confirmation.
Aucune ligne de `etat-des-features.md` n'est omise (états ❌ inclus, avec place réservée).

### 6.1 Section 1 — Modélisation

| Fonctionnalité                                                      | Aujourd'hui                                              | Nouvel emplacement                                                         | Forme   |
| ------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------- | ------- |
| Éditeur DBML et canvas synchronisés                                 | onglet `schema`                                          | `/p/:id/schema`                                                            | O       |
| Tables, colonnes, relations, enums, zones, notes, groupes, index    | canevas / DBML                                           | `/p/:id/schema` (menu « Insérer », clic droit)                             | O + K   |
| Réglages de l'éditeur DBML                                          | `DbmlPanel` / paramètres Éditeur (non vérifié)           | `/compte/editeur` (+ raccourci « Options DBML » dans le panneau)           | P       |
| Copier/coller, duplication, annuler/rétablir                        | canevas, `Ctrl+Z/Y/D`                                    | inchangé (`/p/:id/schema`) ; commandes dans K                              | O + K   |
| Vue conceptuelle MCD                                                | bascule `ViewModeToggle`                                 | `/p/:id/schema?vue=mcd`                                                    | O       |
| Import DBML/SQL                                                     | `ImportDialog`                                           | Schéma > Fichier ▾ > Importer (`?panneau=importer`)                        | Pn      |
| Export DBML/SQL/PNG/SVG/PDF                                         | `ExportDialog`                                           | Schéma > Fichier ▾ > Exporter (`?panneau=exporter`)                        | Pn      |
| Modèles de départ                                                   | `TemplatePickerModal`                                    | `/projets/nouveau` (galerie)                                               | P       |
| Projet créé depuis une base existante                               | `NewProjectFromDatabaseModal`                            | `/projets/nouveau?source=base` ; aussi `/bases/:id` > « Créer un projet »  | P + K   |
| Recherche dans tous les projets                                     | champ de la liste                                        | palette `Ctrl+K` (+ champ de `/projets`)                                   | K + P   |
| Conversion de types entre moteurs                                   | `ConvertTypesModal`                                      | Schéma > Fichier ▾ > Convertir les types (`?panneau=convertir`)            | Pn      |
| Linter de schéma (profils, corrections, blocage de déploiement)     | onglet `problems`                                        | `/p/:id/qualite/problemes`                                                 | O       |
| Lint : bibliothèque, modèle par défaut, version du projet, règles   | Admin > Lint ; `LintSettingsCard`                        | modèles : `/admin/qualite` ; projet : `/p/:id/parametres/qualite`          | P       |
| Dictionnaire de données                                             | onglet `dictionary`                                      | `/p/:id/qualite/dictionnaire`                                              | O       |
| Verrous de table                                                    | pastille + `TableLocksList` + `TableLockDialog`          | liste `/p/:id/qualite/verrous` ; poser/lever : popover sur la table        | O + Pn  |
| Historique, aperçu sur le graphe, restauration d'une table          | onglet `history`                                         | `/p/:id/versions/historique` (+ `/p/:id/versions/:revision`)               | O       |
| Comparaison de deux projets, SQL de migration                       | `CompareProjectsModal`                                   | `/p/:id/versions/comparer?avec=:autre`                                     | P       |
| Collaboration temps réel, présence, commentaires                    | barre d'outils, panneau de commentaires                  | barre supérieure du Schéma (présence), panneau commentaires                | Pn      |
| Mentions `@`                                                        | commentaires                                             | inchangé ; boîte de réception `/notifications`                             | S       |
| Fusion par champ (❌)                                               | —                                                        | transparent (pas d'UI) ; indicateur « 2 personnes sur cette table »        | —       |
| Points de passage des relations, relation inversée (❌)             | —                                                        | Schéma, menu d'une relation (`EdgeContextMenu`)                            | —       |
| Export Prisma/TypeORM/GraphQL/JSON Schema (❌, plugins)             | —                                                        | Fichier ▾ > Exporter > format « plugin » ; catalogue dans `/compte/plugins` | Pn      |

### 6.2 Section 2 — Projet racine et déclinaisons (❌, places réservées)

| Fonctionnalité                                     | Nouvel emplacement                                              | Forme |
| -------------------------------------------------- | --------------------------------------------------------------- | ----- |
| Projet racine et variantes par client              | `/projets?famille=:id` (arbre) ; badge « racine / variante »    | P     |
| Publication de versions, suivi / épinglage         | `/p/:racine/variantes` (onglet réservé)                         | O     |
| Fusion à trois voies                               | `/p/:variante/versions/fusion`                                  | P     |
| Vues arbre / résolu / surcouche / base, matrice    | `/p/:racine/variantes/matrice`                                  | O     |
| Moteur, droits, connexions, déploiements propres   | les onglets du projet de la variante, inchangés                 | —     |

### 6.3 Section 3 — Connexions aux bases

| Fonctionnalité                                                   | Aujourd'hui                                  | Nouvel emplacement                                              | Forme |
| ---------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------- | ----- |
| Connexions au niveau de l'instance, rattachées aux projets       | Admin > Connexions                           | liste `/bases` ; rattachement `/bases/:id/parametres`           | P     |
| PostgreSQL, MySQL/MariaDB, SQL Server, Oracle, SQLite            | `ConnectionFormFields`                       | `/bases/nouvelle`, `/bases/:id/parametres`                      | P     |
| Chiffrement des identifiants, rotation, anti DNS-rebinding       | serveur                                      | `/bases/:id/parametres` (mention) ; rotation : `/admin` (réservé) | S   |
| Santé, tags, lecture seule par connexion                         | liste + `HealthPanel`                        | pastilles `/bases` ; détail `/bases/:id/apercu`                 | P     |
| Environnements configurables                                     | Admin > Environnements                       | `/admin/environnements`                                         | P     |
| Variables par environnement dans les noms de tables et schémas   | `EnvironmentsTab`, DBML `{{ }}`              | `/admin/environnements` ; aperçu résolu : Schéma (sélecteur d'environnement) | P |
| Tunnel SSH, autorité TLS personnalisée (❌)                      | —                                            | `/bases/:id/parametres` > Réseau et sécurité                    | S     |

### 6.4 Section 4 — Déploiement

| Fonctionnalité                                                | Aujourd'hui                                      | Nouvel emplacement                                                     | Forme |
| ------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- | ----- |
| Assistant : différences → risques → SQL → résultat            | `DeploymentModal` (3 entrées)                    | `/p/:id/bases/:base/deploiements/nouveau` (assistant en étapes)        | P     |
| Comparatif montré avant le déploiement                        | étape de l'assistant                             | étape 1 de l'assistant ; aussi bouton « Comparer avec la base »        | P     |
| Mesure des risques sur les données existantes                 | étape de l'assistant                             | étape 2 de l'assistant                                                 | P     |
| Confirmation et sauvegarde automatique en production          | dans la modale                                   | dernière étape + `D` de confirmation (nom de la base à retaper)        | D     |
| Pipeline sans saut d'étape                                    | `PipelineCard`                                   | `/p/:id/bases` (en-tête de l'onglet)                                   | O     |
| Comparaison de deux environnements                            | `CompareEnvironmentsCard`                        | `/p/:id/bases/comparer`                                                | P     |
| Historique des déploiements, retour arrière                   | `DeploymentHistoryPanel`, `RollbackConfirmModal` | `/p/:id/bases/:base/deploiements` ; retour arrière : `D`               | O + D |
| Données initiales CSV, reprise depuis la base                 | `SeedDialog`, `GeneratePanel`                    | `/p/:id/bases/donnees-depart` (liste par table) et `…/:table`          | P     |
| Générateur de données de test                                 | `GeneratePanel`                                  | `/p/:id/bases/donnees-depart/generateur`                               | P     |
| Sauvegardes logiques, planification, restauration             | Admin > Connexions > Ouvrir > Sauvegardes        | `/bases/:id/sauvegardes` ; restauration : page + `D`                   | O + D |
| Revue avant production, fenêtres, gel (❌)                    | —                                                | `/p/:id/parametres` > Déploiement ; boîte « À relire » dans l'accueil  | S     |
| Revenir avant ce déploiement, sauvegardes natives (❌)        | —                                                | `/p/:id/bases/:base/deploiements` (action sur une ligne)               | O     |
| Action GitHub / CLI (❌)                                      | —                                                | `/compte/api` (+ aide) ; `/p/:id/parametres/integrations`              | P     |

### 6.5 Section 5 — Comptes Athanor et groupes

| Fonctionnalité                                                    | Aujourd'hui                           | Nouvel emplacement                                              | Forme |
| ----------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------- | ----- |
| Invitation, mot de passe oublié, 2FA, sessions, verrouillage      | `Login`, `AcceptInvite`, Profil       | pages publiques inchangées ; `/compte/securite`                 | P     |
| E-mails (invitation, réinitialisation)                            | serveur                               | `/admin/invitations` (état d'envoi) ; SMTP réservé              | P     |
| Désactiver, supprimer, réinitialiser un compte                    | `UsersTab` + 2 modales                | `/admin/utilisateurs/:id` ; suppression : `D`                   | P + D |
| Groupes : un utilisateur dans 0 à n groupes                       | Admin > Équipes                       | `/admin/groupes`, `/admin/groupes/:id`                          | P     |
| Projet associé à des groupes, un niveau par groupe                | `ProjectTeamsModal` (menu de carte)   | `/p/:id/parametres/acces`                                       | P     |
| Invitation avec groupes, accès aux bases et compte SQL            | `InvitationsTab`                      | `/admin/invitations/nouvelle` (formulaire en page)              | P     |
| Rôle intermédiaire (❌)                                           | —                                     | colonne supplémentaire de `/p/:id/parametres/acces`             | —     |
| Restriction de lecture par table/colonne (❌)                     | —                                     | Paramètres du projet > Accès, section avancée                   | —     |
| SSO, passkeys (❌)                                                | —                                     | `/admin/authentification` ; `/compte/securite`                  | —     |

### 6.6 Section 6 — Utilisateurs et permissions des bases connectées

| Fonctionnalité                                                   | Aujourd'hui                              | Nouvel emplacement                                                     | Forme |
| ---------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- | ----- |
| Lister les comptes, rôles et privilèges                          | console > Utilisateurs                   | `/bases/:id/comptes`                                                   | O     |
| Créer, supprimer, mot de passe, activer, rôle, accorder/révoquer | `UsersPanel` + `StatementModal`          | `/bases/:id/comptes` ; aperçu de l'instruction en ligne (S)            | O + S |
| Sessions en cours et arrêt d'une session                         | console > Sessions                       | `/bases/:id/comptes?vue=sessions` (aperçu résumé dans Aperçu)          | O     |
| Compte SQL personnel par utilisateur et par base                 | option de connexion                      | `/bases/:id/parametres` (option) ; saisie : bannière dans Données/SQL  | S     |
| Accès à une base par utilisateur ou groupe                       | 3 endroits (D6)                          | `/admin/acces-bases` (matrice), filtres dans fiche personne/groupe/base | P     |
| L'admin associe un compte de base à un compte Athanor            | `DbAccessEditor`                         | même composant                                                         | P     |
| Créer le compte de base avec l'invitation                        | `InvitationsTab`                         | `/admin/invitations/nouvelle` > section « Accès aux bases »            | S     |
| Gestion de ses comptes SQL depuis ses Paramètres                 | Profil (`SqlAccounts`)                   | `/compte/comptes-sql`                                                  | P     |
| Privilèges au niveau colonne (🟡)                                | lisibles seulement                       | `/bases/:id/comptes` (détail d'un compte)                              | O     |
| Protection du compte de la connexion                             | `UsersPanel`                             | cadenas « protégé » dans la liste (§ 5.3)                              | O     |

### 6.7 Section 7 — Requêtes SQL

| Fonctionnalité                                                  | Aujourd'hui                             | Nouvel emplacement                                                        | Forme |
| --------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------- | ----- |
| Console SQL (lecture seule par défaut, écriture confirmée)      | console > SQL                           | `/bases/:id/sql` et `/p/:id/bases/:id/sql`                                | O     |
| Explorateur, données paginées, export CSV                       | console > Explorateur                   | `/bases/:id/donnees`                                                      | O     |
| Onglet « Données & SQL » + panneau SQL dans l'éditeur           | `DataTab`, `EditorSqlDrawer` (`Ctrl+J`) | `/p/:id/bases/:id/donnees|sql` ; tiroir `Ctrl+J` conservé dans le Schéma  | O + Pn |
| SQL pour les utilisateurs non administrateurs                   | idem, selon accès                       | idem ; accueil membre § 4.3                                               | O     |
| Grille de résultats                                             | `ResultGrid`                            | composant de la page SQL                                                  | —     |
| Historique de ses requêtes, journalisation                      | `SqlPanel` (historique), Journal        | historique : panneau de la page SQL ; journalisation : `/bases/:id/journal` | Pn + O |
| Changement de structure renvoyé vers le schéma                  | `StructureRedirectDialog`               | bandeau en ligne sous l'éditeur : « Passer par le schéma »               | S     |
| Éditeur SQL avec complétion (❌)                                | —                                       | page SQL                                                                  | —     |
| Requêtes enregistrées, EXPLAIN visuel, édition de lignes (❌)   | —                                       | page SQL (liste latérale) ; page Données (édition)                        | —     |

### 6.8 Section 8 — Journaux

| Fonctionnalité                                             | Aujourd'hui                  | Nouvel emplacement                                              | Forme |
| ---------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------- | ----- |
| Journal d'activité (filtres, export CSV/JSON)              | Admin > Activité             | `/admin/journal`                                                | P     |
| Journal d'une base précise                                 | console > Journal            | `/bases/:id/journal`                                            | O     |
| Journal de la modélisation                                 | historique du projet         | `/p/:id/versions/historique` ; ligne « Modélisation » dans `/admin/journal` (à relier, 🟡) | O |
| Journal des erreurs                                        | Admin > Erreurs              | `/admin/erreurs`                                                | P     |
| Logs côté base (connexions et requêtes hors Athanor)       | console > Journal > côté base | `/bases/:id/journal?vue=cote-base`                             | O     |
| Export syslog / SIEM (❌)                                  | —                            | `/admin/export-journal`                                         | P     |

Le composant de filtre est **partagé** (`ActivityTab` et `JournalPanel` réutilisent déjà les
mêmes clés `activity.*`) : un seul composant `Journal` paramétré par le périmètre
(instance / projet / base).

### 6.9 Section 9 — Performance et conseils

| Fonctionnalité                                  | Aujourd'hui                  | Nouvel emplacement                                                | Forme |
| ----------------------------------------------- | ---------------------------- | ----------------------------------------------------------------- | ----- |
| Temps et fréquence d'utilisation par requête    | `JournalPanel` (Requêtes)    | `/bases/:id/journal?vue=requetes`                                 | O     |
| Tableau de santé                                | `HealthPanel`                | `/bases/:id/apercu` (bloc Santé)                                  | O     |
| Trafic par connexion                            | `HealthPanel` / compteurs    | `/bases/:id/apercu` (bloc Trafic), carte dans `/bases`            | O     |
| Suggestions d'index (❌)                        | —                            | `/p/:id/qualite/problemes` (catégorie « Performance ») + `/bases/:id/apercu` | O |
| Conseiller de requêtes et de schéma, IA (❌)    | —                            | `/p/:id/qualite/conseils` (réservé) ; SQL : bouton « Analyser »   | O     |

### 6.10 Section 10 — Modifications faites hors Athanor

| Fonctionnalité                                       | Aujourd'hui                                | Nouvel emplacement                                                           | Forme |
| ---------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- | ----- |
| Surveillance activable des tables et colonnes        | `MonitoringCard` (onglet Déploiements)     | `/p/:id/bases` > « Modifications externes » (réglages par projet)            | S     |
| Bandeau, différences, resynchroniser, ignorer        | `DriftBanner` (en tête de tous les onglets) | bandeau conservé (toutes pages du projet) → `/p/:id/bases/:base/apercu`      | S     |
| Webhook et notification dans l'application           | serveur, cloche                            | webhook : `/p/:id/parametres/webhooks` ; notification : `/notifications`    | P     |
| Surveillance des utilisateurs et des permissions     | `MonitoringCard` (option `accounts`)       | réglage : `/p/:id/bases` ; résultat : `/bases/:id/comptes` (admin) + « À traiter » de l'accueil admin | S + O |
| Alerte par e-mail, acquittement, sourdine (❌)       | —                                          | `/admin/alertes` ; acquitter : action sur le bandeau                         | P     |

### 6.11 Section 11 — Autour

| Fonctionnalité                                      | Aujourd'hui                     | Nouvel emplacement                                              | Forme |
| --------------------------------------------------- | ------------------------------- | --------------------------------------------------------------- | ----- |
| API publique, clés à portées, OpenAPI               | Paramètres > Facturation        | `/compte/api`                                                   | P     |
| Webhooks                                            | `WebhooksModal` (carte de projet) | `/p/:id/parametres/webhooks`                                  | P     |
| Notifications (projets suivis, mentions, réponses)  | cloche ×2, `FollowMenu`         | cloche de la barre + `/notifications` ; suivi : barre du projet + `/p/:id/parametres/notifications` | P |
| Plugins                                             | `PluginManagerDialog`, `PluginMenu` | gestion : `/compte/plugins` ; exécution : menu Plugins du canevas + palette `Ctrl+K` | P + K |
| Visite guidée                                       | icône « i » de l'éditeur        | menu Aide > « Visite guidée » + palette                         | K     |
| Thèmes                                              | Paramètres > Apparence          | `/compte/apparence` + bascule rapide du menu Compte             | P     |
| Français + anglais                                  | Paramètres > Apparence          | `/compte/apparence` + bascule du menu Compte                    | P     |
| Composants de formulaire maison                     | transverse                      | hors navigation                                                 | —     |
| Refonte visuelle, accessibilité, mobile (❌)        | Phase 37                        | cette refonte ; mobile : voir Q8                                | —     |
| Revue de sécurité, relecture juridique (❌)         | hors produit                    | hors navigation (« À propos » : mentions légales)               | —     |
| Première version taguée                             | hors produit                    | Aide > À propos (version)                                       | —     |
| CI GitHub                                           | hors produit                    | hors navigation                                                 | —     |

### 6.12 Fonctions transverses non listées dans `etat-des-features.md` mais présentes dans le code

| Fonction                                               | Nouvel emplacement                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| Renommer / archiver / corbeille / restaurer / supprimer | `/projets` (menu de carte) et `/p/:id/parametres/general`            |
| Mise en corbeille vidée en masse (`EmptyTrashModal`)    | `/projets?espace=corbeille` + `D`                                     |
| Suppression définitive (`DeleteProjectModal`)           | `D` depuis la corbeille et depuis Paramètres > Général (zone dangereuse) |
| Politique de structure par défaut de l'instance         | `/admin/politique-structure`                                          |
| Politique de structure propre à une base                | `/bases/:id/parametres`                                               |
| Changer son mot de passe                                | `/compte/securite` (section dépliée, plus de `ChangePasswordModal`)   |
| Codes de secours 2FA, désactiver / régénérer la 2FA     | `/compte/securite` ; codes affichés dans la page ; désactiver/régénérer : `D` avec saisie du code |
| Recherche dans le canevas (`CanvasSearchPanel`), DBML   | inchangées dans le Schéma ; commande « Chercher dans le projet » dans K |
| Palette de l'éditeur DBML (`CommandPalette`)            | conservée dans l'éditeur DBML (symboles / commandes), accessible aussi par préfixe dans K (Q6) |
| Banc de performance, catalogue de composants            | `#bench`, `#components` inchangés                                     |

---

## 7. Dialogues : sort des 33 modales

| #  | Composant actuel                  | Nouvelle forme                                                           | Garde-t-on un dialogue ? |
| -- | --------------------------------- | ------------------------------------------------------------------------ | :----------------------: |
| 1  | `DeleteUserModal`                 | confirmation (impact : projets, groupes)                                 | oui                      |
| 2  | `ResetPasswordModal`              | section en ligne de `/admin/utilisateurs/:id`                            | non                      |
| 3  | `UserDbAccessModal`               | section « Accès aux bases » de la fiche personne                         | non                      |
| 4  | `ConnectionEditModal`             | pages `/bases/nouvelle` et `/bases/:id/parametres`                       | non                      |
| 5  | `StatementModal`                  | volet « Aperçu de l'instruction » sous le formulaire, bouton Appliquer   | non                      |
| 6  | `LintApplyModal`                  | section « Appliquer à des projets » de la fiche modèle                   | non                      |
| 7  | `LintPresetModal`                 | page `/admin/qualite/:id`                                                | non                      |
| 8  | `ChangePasswordModal`             | section dépliée de `/compte/securite`                                    | non                      |
| 9  | `BackupScopeDialog`               | formulaire déplié « Nouvelle sauvegarde » dans `/bases/:id/sauvegardes`  | non                      |
| 10 | `RestoreDialog`                   | page `/bases/:id/sauvegardes/:sauvegarde/restaurer` + `D` final          | oui (dernière étape)     |
| 11 | `DeploymentModal`                 | assistant en pleine page `/p/:id/bases/:base/deploiements/nouveau`       | oui (production)         |
| 12 | `PersonalAccountDialog`           | bannière en ligne + `/compte/comptes-sql`                                | non                      |
| 13 | `RollbackConfirmModal`            | confirmation                                                             | oui                      |
| 14 | `ConvertTypesModal`               | panneau latéral `?panneau=convertir`                                     | non                      |
| 15 | `CompareProjectsModal`            | page `/p/:id/versions/comparer`                                          | non                      |
| 16 | `ExportDialog`                    | panneau latéral `?panneau=exporter`                                      | non                      |
| 17 | `ImportDialog`                    | panneau latéral `?panneau=importer`                                      | non                      |
| 18 | `TableLockDialog`                 | popover ancré sur la table + liste dans Qualité > Verrous                | non                      |
| 19 | `SeedDialog`                      | page `/p/:id/bases/donnees-depart/:table`                                | non                      |
| 20 | `PluginManagerDialog`             | page `/compte/plugins`                                                   | non                      |
| 21 | `PluginSettingsModal`             | section dépliée de la fiche du plugin                                    | non                      |
| 22 | `NewProjectFromDatabaseModal`     | page `/projets/nouveau?source=base`                                      | non                      |
| 23 | `DeleteProjectModal`              | confirmation                                                             | oui                      |
| 24 | `EmptyTrashModal`                 | confirmation                                                             | oui                      |
| 25 | `TemplatePickerModal`             | galerie de `/projets/nouveau`                                            | non                      |
| 26 | `WebhooksModal`                   | page `/p/:id/parametres/webhooks`                                        | non                      |
| 27 | `DeleteAccountModal`              | confirmation (depuis la zone dangereuse de `/compte/donnees`)            | oui                      |
| 28 | `SettingsModal`                   | supprimé (remplacé par `/compte`)                                        | non                      |
| 29 | `BackupCodesModal`                | affichage unique en ligne dans `/compte/securite`                        | non                      |
| 30 | `TotpDisableModal`                | confirmation avec saisie du code                                         | oui                      |
| 31 | `TotpRegenerateModal`             | confirmation avec saisie du code                                         | oui                      |
| 32 | `StructureRedirectDialog`         | bandeau en ligne sous l'éditeur SQL                                      | non                      |
| 33 | `ProjectTeamsModal`               | page `/p/:id/parametres/acces`                                           | non                      |

Bilan : **33 → 7 dialogues** (suppression d'utilisateur, retour arrière, suppression d'un
projet, vidage de corbeille, suppression du compte, désactivation 2FA, régénération 2FA)
auxquels s'ajoutent la confirmation d'écriture SQL (`dbadmin.sql.confirmWrite`, déjà inline
dans `SqlPanel`), la dernière étape de déploiement/restauration en production et le
dialogue d'écriture de structure (`dbadmin.structure.confirm*`). Tous passent par
`ConfirmDialog`. Règle d'écriture : un dialogue = une phrase de conséquence, un bouton
destructif nommé par son verbe (« Supprimer l'utilisateur »), jamais « OK ».

---

## 8. Palette de commandes `Ctrl+K`

### 8.1 État de l'existant

- Recherche globale du contenu des projets : seulement dans le champ de la liste
  (`ProjectList.svelte` → `GlobalSearchResults`, service `searchApi`).
- Palette de l'éditeur DBML (`editor/dbml/CommandPalette.svelte`, `paletteItems.ts`) :
  modes « symboles » / « commandes », locale au CodeMirror.
- Plugins : `plugins/PluginQuickPalette.svelte` (palette rapide de plugins).
- Raccourcis connus : `Ctrl+J` (tiroir SQL, constante `SQL_SHORTCUT` dans `WorkspaceBar.svelte`),
  `Ctrl+Z`/`Ctrl+Y`/`Ctrl+D` (`editorKeyboardShortcuts.svelte.ts`), raccourcis de plugins
  (`plugins/shortcuts.ts`).
- Aucune palette globale. La liste de la Phase 38 propose « 37 global command palette
  (`Ctrl+K`) » et « 38 cross-search (schemas, queries, journal) » : **non arbitrées** (Q5).

### 8.2 Décision proposée

Une palette unique, ouverte par `Ctrl+K` (ou `Ctrl+Shift+P` dans l'éditeur DBML pour éviter le
conflit avec CodeMirror : conflit **non vérifié**, à tester) et par le bouton de recherche de
la barre supérieure. Elle remplace le champ de recherche globale de la liste comme point
d'entrée principal, qui reste présent sur `/projets` pour filtrer la page.

**Préfixes** : rien = tout ; `>` commandes ; `@` personnes ; `#` bases ; `/` pages ;
`:` symboles du schéma ouvert ; `?` aide.

**Groupes de résultats** (dans cet ordre, filtrés par rôle) :

| Groupe          | Exemples                                                                                                  | Visible pour           |
| --------------- | --------------------------------------------------------------------------------------------------------- | ---------------------- |
| Aller à         | projets récents, bases, pages (Journal, Utilisateurs, Mon compte…)                                        | selon rôle             |
| Dans le projet  | tables et colonnes (reprend `searchApi`), enums, notes ; « Problèmes », « Historique »                    | contexte projet        |
| Actions         | Nouveau projet · Importer un DBML · Ouvrir le SQL de `pg-prod` · Déployer sur… · Inviter · Basculer le thème · Changer de langue · Visite guidée · Se déconnecter | selon rôle et contexte |
| Journal         | « Requêtes lentes sur pg-prod », événements d'une personne (recherche transverse, Phase 38 n° 38)         | administrateur         |
| Plugins         | commandes des plugins actifs (`PluginHost`), raccourcis déclarés                                          | contexte projet        |
| Aide            | raccourcis clavier, guide                                                                                 | tous                   |

**Règles** :
1. La palette **ne contient jamais** d'action que l'utilisateur ne peut pas faire (mêmes règles
   que § 5) ; une action disponible mais bloquée (verrou) est affichée avec sa raison.
2. Les actions dangereuses (supprimer, vider la corbeille, retour arrière) **y sont absentes** :
   elles se font dans la page concernée.
3. Les résultats sont **contextuels** : « Nouvelle table » n'existe que dans le Schéma d'un
   projet éditable.
4. Chaque élément affiche son raccourci propre quand il en a un (`Ctrl+J`…).
5. La palette de l'éditeur DBML reste telle quelle dans CodeMirror ; K y renvoie via le
   préfixe `:` (symboles) pour ne pas dupliquer l'index.

### 8.3 Raccourcis globaux proposés

`Ctrl+K` palette · `G` puis `P/B/A/C` navigation (Projets/Bases/Admin/Compte) — non retenu en
V1 faute d'arbitrage (Phase 38 n° 40, « raccourcis personnalisables ») · `Ctrl+J` tiroir SQL
(inchangé) · `?` liste des raccourcis · `Esc` ferme panneau puis palette.

---

## 9. Barre latérale, onglets ou palette : règle de choix

| Besoin                                                   | Support              | Exemple                                                     |
| -------------------------------------------------------- | -------------------- | ----------------------------------------------------------- |
| Changer de domaine (modéliser / exploiter / administrer) | **Barre latérale**   | Projets, Bases, Administration                              |
| Parcourir les facettes d'un même objet                   | **Onglets**          | projet : Schéma, Qualité… ; base : Aperçu, Données, SQL…    |
| Parcourir un grand nombre de pages de configuration      | **Colonne secondaire** | Administration, Mon compte                                 |
| Sous-vues d'un onglet                                    | **Segments** (contrôle segmenté) | Qualité : Problèmes / Dictionnaire / Verrous      |
| Action rare ou transverse                                | **Palette `Ctrl+K`** | Basculer le thème, ouvrir une base, inviter                 |
| Action contextuelle fréquente                            | **Bouton + clic droit** | Poser un verrou, insérer une table                         |
| Détail d'un élément sans quitter la liste                | **Panneau latéral**  | Exporter, importer, une revision, un compte SQL             |
| Confirmation d'un acte irréversible                      | **Dialogue**         | Supprimer, retour arrière, écriture en production           |
| État ou avertissement persistant                         | **Bandeau**          | PRODUCTION, modification externe, projet archivé            |

Plafonds : barre latérale ≤ 4 entrées métier ; onglets ≤ 7 par barre ; un onglet ne contient
jamais plus de 3 segments ; profondeur d'URL ≤ 4 segments.

---

## 10. Schémas des écrans de niveau 1

### 10.1 Coque commune

```
┌──────┬──────────────────────────────────────────────────────────────────────────┐
│ ◆    │ Accueil › Projets › Boutique › Schéma            [Ctrl+K Rechercher…]  ◐ │
│      ├──────────────────────────────────────────────────────────────────────────┤
│ ⌂ Acc│                                                                          │
│ ▤ Pro│                       CONTENU DE LA PAGE                                 │
│ ▣ Bas│        (une seule barre d'onglets sous le fil d'Ariane)                  │
│ ⚙ Adm│                                                                          │
│      │                                                                          │
│ ─────│                                                                          │
│ ⌕ Rec│                                                                          │
│ 🔔 3 │                                                                          │
│ ? Aid│                                                                          │
│ (GD) │                                                                          │
└──────┴──────────────────────────────────────────────────────────────────────────┘
```

### 10.2 Accueil — administrateur d'instance

```
┌──────┬──────────────────────────────────────────────────────────────────────────┐
│ rail │ Accueil                                                  [Ctrl+K] ◐      │
│      ├──────────────────────────────────────────────────────────────────────────┤
│      │ À TRAITER                                                                │
│      │ ┌─────────────────────┐ ┌─────────────────────┐ ┌──────────────────────┐ │
│      │ │ ⚠ 2 bases ont des   │ │ ⚠ Comptes modifiés  │ │ ✉ 3 invitations en   │ │
│      │ │ modifications ext.  │ │ hors Athanor (1)    │ │ attente              │ │
│      │ └─────────────────────┘ └─────────────────────┘ └──────────────────────┘ │
│      │ BASES                                           [Nouvelle base]          │
│      │ ● pg-prod  PRODUCTION  12 ms  34 sessions  0 verrou      →               │
│      │ ● pg-staging  STAGING  8 ms   5 sessions                 →               │
│      │ ○ mysql-dev  DEV  hors ligne depuis 14:02                →               │
│      │ ACTIVITÉ RÉCENTE                                  [Voir le journal]      │
│      │  14:21  A. Martin  a déployé « Boutique » sur pg-staging                 │
│      │  14:03  système    base mysql-dev injoignable                            │
│      │ REPRENDRE : [Boutique] [CRM] [Paie]        RACCOURCIS : Inviter · Projet │
└──────┴──────────────────────────────────────────────────────────────────────────┘
```

### 10.3 Projets (niveau Espace)

```
┌──────┬────────────────┬───────────────────────────────────────────────────────┐
│ rail │ ESPACES        │ Projets › Tous                  [Rechercher…] [+ Nouveau]│
│      │ ▸ Tous      14 ├───────────────────────────────────────────────────────┤
│      │   Mes projets 5│  ┌───────────┐ ┌───────────┐ ┌───────────┐            │
│      │   Partagés   9 │  │ vignette  │ │ vignette  │ │ vignette  │            │
│      │ ─ Groupes ──── │  │ Boutique  │ │ CRM       │ │ Paie      │            │
│      │   Finance    4 │  │ Admin · 2h│ │ Édition   │ │ Lecture   │            │
│      │   Support    3 │  └───────────┘ └───────────┘ └───────────┘            │
│      │ ─────────────  │  Résultats de la recherche dans les tables : …         │
│      │   Archivés   2 │                                                       │
│      │   Corbeille  1 │                                                       │
└──────┴────────────────┴───────────────────────────────────────────────────────┘
```

### 10.4 Projet — onglet Schéma (barre latérale repliée)

```
┌─┬────────────────────────────────────────────────────────────────────────────┐
│◆│ Projets › Boutique ▾ › Schéma     👤👤 présence  Suivre ▾  🔔  [Ctrl+K]      │
│⌂├────────────────────────────────────────────────────────────────────────────┤
│▤│ [Schéma] Qualité(3) Versions Bases Paramètres        Fichier ▾   MLD|MCD    │
│▣├────────────────────────────────────────────────────────────────────────────┤
│⚙│ ↶ ↷ ⊞ ⌕ ⊡ …  (outils du canevas)                                           │
│ │ ┌──────────────┐        ┌──────────────┐                ┌───────────────┐   │
│ │ │ DBML (volet) │        │   canevas    │                │ Panneau droit │   │
│ │ │              │        │              │                │ (commentaires,│   │
│ │ │              │        │              │                │ export, …)    │   │
│ │ └──────────────┘        └──────────────┘                └───────────────┘   │
│ │ ═══ SQL (Ctrl+J) ═════════════ tiroir redimensionnable ══════════════════ │
└─┴────────────────────────────────────────────────────────────────────────────┘
```

### 10.5 Projet — onglet Bases

```
│ Projets › Boutique › Bases                                         [Ctrl+K]  │
│ Schéma  Qualité  Versions  [Bases]  Paramètres                               │
│──────────────────────────────────────────────────────────────────────────────│
│ PIPELINE   DEV ──✔── STAGING ──✔── PRODUCTION                    [Déployer…] │
│ ┌ pg-dev ─────────┐ ┌ pg-staging ──────┐ ┌ pg-prod ─────────────────────────┐ │
│ │ ● en ligne      │ │ ● en ligne       │ │ ● en ligne   ⚠ modif. externe   │ │
│ │ Données · SQL   │ │ Données · SQL    │ │ Données · SQL · Déploiements     │ │
│ └─────────────────┘ └──────────────────┘ └──────────────────────────────────┘ │
│ MODIFICATIONS EXTERNES  [surveillance: activée · toutes les 15 min]  [Régler]│
│ DONNÉES DE DÉPART  12 tables  [Gérer]     COMPARER LES ENVIRONNEMENTS [Ouvrir]│
```

### 10.6 Base (contexte instance)

```
│ Bases › pg-prod  [PRODUCTION]                                     [Ctrl+K]   │
│ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ PRODUCTION — les écritures sont confirmées ▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │
│ [Aperçu] Données  SQL  Déploiements  Comptes  Journal  Sauvegardes  Paramètres│
│──────────────────────────────────────────────────────────────────────────────│
│ Santé : ● en ligne  12 ms  v16.2     Sessions 34 (2 longues)   Verrous 0     │
│ Trafic : 1,2 M requêtes/h  ▁▂▃▅▆▇                                            │
│ Modifications externes : aucune        Comptes : référence à jour            │
│ Dernier déploiement : 14:21 par A. Martin (Boutique v42)                     │
│ Projets rattachés : Boutique · CRM                                           │
```

### 10.7 Administration

```
┌──────┬────────────────────┬─────────────────────────────────────────────────────┐
│ rail │ ADMINISTRATION     │ Administration › Utilisateurs         [Inviter ▸]     │
│      │  Vue d'ensemble    ├─────────────────────────────────────────────────────┤
│      │ ─ Personnes ─────  │ Rechercher…                                         │
│      │  ▸ Utilisateurs    │  A. Martin   admin    2 groupes   ● actif   ⋯        │
│      │    Groupes         │  B. Durand   membre   1 groupe    ● actif   ⋯        │
│      │    Invitations (3) │  C. Petit    membre   0 groupe    ○ désactivé ⋯      │
│      │    Accès aux bases │                                                     │
│      │ ─ Bases ─────────  │                                                     │
│      │    Environnements  │                                                     │
│      │    Politique struct│                                                     │
│      │ ─ Qualité ───────  │                                                     │
│      │    Modèles de lint │                                                     │
│      │ ─ Journaux ──────  │                                                     │
│      │    Journal d'activ.│                                                     │
│      │    Erreurs         │                                                     │
└──────┴────────────────────┴─────────────────────────────────────────────────────┘
```

### 10.8 Mon compte

```
┌──────┬────────────────────┬─────────────────────────────────────────────────────┐
│ rail │ MON COMPTE         │ Compte › Sécurité                                    │
│      │  Profil            ├─────────────────────────────────────────────────────┤
│      │ ▸ Sécurité         │ Mot de passe                    [Modifier ▾] (section)│
│      │  Mes comptes SQL   │ Double authentification  ● activée  [Désactiver]     │
│      │  Clés d'API        │ Sessions actives  3             [Fermer les autres]  │
│      │  Apparence         │                                                     │
│      │  Éditeur           │                                                     │
│      │  Plugins           │                                                     │
│      │  Mes données       │                                                     │
└──────┴────────────────────┴─────────────────────────────────────────────────────┘
```

### 10.9 Palette `Ctrl+K`

```
┌───────────────────────────────────────────────────────┐
│ ⌕  pg-pr                                              │
├───────────────────────────────────────────────────────┤
│ ALLER À                                               │
│   ▣ pg-prod  PRODUCTION            Bases              │
│   ▤ Boutique › Bases › pg-prod     Projet             │
│ ACTIONS                                               │
│   ›_ Ouvrir le SQL de pg-prod                Ctrl+J    │
│   ⇪ Déployer Boutique sur pg-prod…                    │
│ DANS LE PROJET                                        │
│   ▦ table « products » (colonne price_pr…)            │
└───────────────────────────────────────────────────────┘
```

---

## 11. URL proposées

Règles : minuscules, sans accents, tirets ; identifiants opaques (`:id`) ; contexte projet
préfixé `p` (court, copiable) ; paramètres `?` pour l'état de vue (jamais pour la navigation
principale) ; `/p/:id` redirige vers `/p/:id/schema`.

### 11.1 Tableau complet

| Route                                                       | Page                                       | Garde                         |
| ----------------------------------------------------------- | ------------------------------------------ | ----------------------------- |
| `/`                                                         | Accueil (adaptatif)                        | connecté                      |
| `/connexion`                                                | Connexion (aujourd'hui rendu sans URL)     | public                        |
| `/invitation/:token` *(alias de `/invite/:token`)*          | Acceptation d'invitation                   | public                        |
| `/reinitialisation/:token` *(alias de `/reset-password/:token`)* | Réinitialisation                       | public                        |
| `/projets`                                                  | Projets (`?espace=`, `?q=`)                | connecté                      |
| `/projets/nouveau`                                          | Nouveau projet (`?source=modele|base|import|vide`) | connecté              |
| `/p/:id`                                                    | → `/p/:id/schema`                          | accès projet                  |
| `/p/:id/schema`                                             | Schéma (`?table=&champ=&vue=mcd&panneau=`) | `view`                        |
| `/p/:id/qualite`                                            | → `/p/:id/qualite/problemes`               | `view`                        |
| `/p/:id/qualite/problemes`, `/dictionnaire`, `/verrous`     | Qualité                                    | `view`                        |
| `/p/:id/versions`                                           | → `/p/:id/versions/historique`             | `view`                        |
| `/p/:id/versions/historique`, `/:revision`, `/comparer`     | Versions                                   | `view`                        |
| `/p/:id/bases`                                              | Bases du projet (pipeline, surveillance)   | accès base ou AP              |
| `/p/:id/bases/donnees-depart`, `/:table`, `/generateur`     | Données de départ                          | `view` (écrire : `edit`)      |
| `/p/:id/bases/comparer`                                     | Comparer les environnements                | AP                            |
| `/p/:id/bases/:base/apercu`, `/donnees`, `/sql`             | Base en contexte projet                    | droit d'accès ou AP/AI        |
| `/p/:id/bases/:base/deploiements`, `/nouveau`, `/:deploiement` | Déploiements                            | AP                            |
| `/p/:id/parametres`                                         | → `/p/:id/parametres/general`              | AP                            |
| `/p/:id/parametres/general`, `/acces`, `/webhooks`, `/qualite`, `/notifications`, `/integrations` | Paramètres du projet | AP (notifications : `view`)  |
| `/bases`                                                    | Liste des bases (`?env=&tag=&etat=`)       | AI ou droit d'accès           |
| `/bases/nouvelle`                                           | Nouvelle base                              | AI                            |
| `/bases/:id/apercu`, `/donnees`, `/sql`                     | Base (instance)                            | AI ou droit d'accès           |
| `/bases/:id/deploiements`                                   | Déploiements de la base, tous projets      | AI                            |
| `/bases/:id/comptes`                                        | Comptes (`?vue=comptes|sessions|acces`)    | AI                            |
| `/bases/:id/journal`                                        | Journal (`?vue=athanor|requetes|cote-base`) | AI                           |
| `/bases/:id/sauvegardes`, `/:sauvegarde/restaurer`          | Sauvegardes                                | AI                            |
| `/bases/:id/parametres`                                     | Paramètres de la base                      | AI                            |
| `/notifications`                                            | Boîte de réception                         | connecté                      |
| `/compte`, `/compte/securite`, `/comptes-sql`, `/api`, `/apparence`, `/editeur`, `/plugins`, `/donnees` | Mon compte | connecté |
| `/admin`                                                    | Vue d'ensemble                             | AI                            |
| `/admin/utilisateurs`, `/utilisateurs/:id`                  | Utilisateurs                               | AI                            |
| `/admin/groupes`, `/groupes/:id`                            | Groupes                                    | AI                            |
| `/admin/invitations`, `/invitations/nouvelle`               | Invitations                                | AI                            |
| `/admin/acces-bases`                                        | Matrice d'accès aux bases                  | AI                            |
| `/admin/environnements`, `/politique-structure`             | Environnements, politique de structure     | AI                            |
| `/admin/qualite`, `/qualite/:modele`                        | Modèles de lint                            | AI                            |
| `/admin/journal`, `/erreurs`                                | Journaux                                   | AI                            |
| `#bench`, `#components`                                     | outils de développement                    | inchangé                      |

Segments **anglais conservés** pour les deux liens déjà diffusés par e-mail
(`/invite/:token`, `/reset-password/:token`) ; les alias français sont ajoutés, jamais
l'inverse (voir § 12).

### 11.2 Mise en œuvre du routage

- Un fichier **unique** `app/routes.ts` : table de routes (motif, garde, composant chargé à
  la demande), `href()` typé, `navigate()`. Remplace `projectRouting.svelte.ts` et les
  `$state` `adminOpen` / `viewMode` d'`App.svelte`.
- Le choix « routeur maison de 80 lignes » ou « bibliothèque légère (navaid, ~1 Ko) » est une
  question ouverte (Q2) ; **dans les deux cas** un seul module possède `history`.
- Côté serveur : remplacer la liste de `app.get(...)` d'`apps/server/src/app.ts` l. 243-247
  par un `setNotFoundHandler` qui sert `index.html` pour tout `GET` hors `/api`, `/ws` (les
  nouvelles routes seraient sinon 404 au rechargement). Cette modification est un **préalable**.
- Chaque onglet est une route (pas un `$state`), donc partageable, rechargeable, et testable
  en e2e sans cliquer.

---

## 12. Plan de migration des routes existantes

### 12.1 Table de redirections

| Ancienne URL / état                                           | Nouvelle URL                                      | Comportement                              |
| ------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------- |
| `/project/:id`                                                | `/p/:id/schema`                                   | 301 côté serveur + redirection client     |
| `/project/:id?table=T&field=F`                                | `/p/:id/schema?table=T&champ=F`                   | le paramètre `field` reste accepté        |
| `/project/:id/data`                                           | `/p/:id/bases` puis, si une seule base accessible, `/p/:id/bases/:base/donnees` | client |
| `/project/:id/deployments`                                    | `/p/:id/bases`                                    | 301                                       |
| `/project/:id/history`                                        | `/p/:id/versions/historique`                      | 301                                       |
| `/project/:id/problems`                                       | `/p/:id/qualite/problemes`                        | 301                                       |
| `/project/:id/dictionary`                                     | `/p/:id/qualite/dictionnaire`                     | 301                                       |
| `/invite/:token`                                              | **inchangée** (+ alias `/invitation/:token`)      | liens d'e-mails déjà envoyés              |
| `/reset-password/:token`                                      | **inchangée** (+ alias `/reinitialisation/:token`) | idem                                     |
| Admin ouvert en mémoire (`adminOpen`)                         | `/admin`                                          | —                                         |
| Admin > Invitations (section par défaut)                      | `/admin/invitations`                              | l'ancienne défaut devient « Vue d'ensemble » |
| Admin > Équipes                                               | `/admin/groupes`                                  | —                                         |
| Admin > Utilisateurs                                          | `/admin/utilisateurs`                             | —                                         |
| Admin > Activité                                              | `/admin/journal`                                  | —                                         |
| Admin > Erreurs                                               | `/admin/erreurs`                                  | —                                         |
| Admin > Connexions                                            | `/bases`                                          | —                                         |
| Admin > Connexions > Ouvrir                                   | `/bases/:id/apercu`                               | —                                         |
| Admin > Environnements                                        | `/admin/environnements`                           | —                                         |
| Admin > Lint                                                  | `/admin/qualite`                                  | —                                         |
| Paramètres (état local `viewMode`)                            | `/compte`                                         | —                                         |
| Paramètres > Équipe                                           | `/compte` (section « Mes groupes »)               | onglet supprimé                           |
| Paramètres > Facturation                                      | `/compte/api`                                     | onglet supprimé (l'API est la seule fonction) |
| Paramètres > À propos                                         | menu Aide > À propos                              | —                                         |
| `#bench`, `#components`                                       | inchangés                                         | —                                         |

### 12.2 Étapes de livraison (chaque étape est livrable seule)

| Étape | Contenu                                                                                                              | Risque de régression                 |
| ----- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **0** | Serveur : repli `index.html` générique (`setNotFoundHandler`) ; alias français pour les liens d'e-mail                | faible                               |
| **1** | Module de routes unique ; `App.svelte` ne contient plus d'état de vue ; anciennes URL redirigées ; aucun changement visuel | moyen (cœur de l'application)   |
| **2** | Coque : barre latérale + fil d'Ariane + barre supérieure ; remplace `Navbar`, les 3 en-têtes ; cloche unique         | moyen                                |
| **3** | Mon compte : page unique, suppression de `SettingsModal`, `Équipe`, `Facturation` ; clés d'API déplacées            | faible                               |
| **4** | Administration : colonne secondaire ; Vue d'ensemble ; fiches personne / groupe en pages ; modales 2, 3, 6, 7 supprimées | moyen                         |
| **5** | Bases : `/bases` + pages de base (instance puis projet) ; `ConnectionEditModal` supprimée ; sauvegardes en pages    | élevé (console + déploiement)        |
| **6** | Projet : onglets Qualité / Versions / Bases / Paramètres ; menu Fichier + panneaux ; `WebhooksModal`, `ProjectTeamsModal` en pages | moyen              |
| **7** | Déploiement : assistant en pleine page ; palette `Ctrl+K` ; accueil par rôle                                          | élevé (déploiement)                  |
| **8** | Nettoyage : suppression des anciennes routes (après 2 versions), mise à jour de `docs/user-guide.md`                  | faible                               |

Les tests de bout en bout (`apps/web/e2e/*.e2e.ts`, **39 fichiers**) ne contiennent aucune
URL `/project/` (recherche faite) : ils naviguent par l'interface, donc ils dépendent des
**libellés et des sélecteurs**, pas des adresses. Chaque étape ci-dessus doit migrer ses
scénarios (`activity.e2e.ts`, `backups.e2e.ts`, `connection-form.e2e.ts`,
`connection-journal.e2e.ts`, `compare-environments.e2e.ts`…) avant fusion.

### 12.3 Compatibilité des liens émis ailleurs

À vérifier avant l'étape 1 (non vérifié dans ce passage) : les liens que le serveur *émet*
(notifications, webhooks, e-mails d'invitation/réinitialisation) et la documentation publique
(`docs/user-guide.md`, `docs/public-api.md`) citent-ils `/project/…` ? Les liens d'invitation
et de réinitialisation sont conservés à l'identique (garantie de la table ci-dessus) ; les
autres passent par la redirection permanente.

---

## 13. Places réservées pour les idées de la Phase 38 (non arbitrées)

Aucune n'est décidée ; ce tableau garantit que la structure peut les recevoir sans refonte.

| Idée (n° `todo.md`)                                 | Place                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| 1-3 Revue avant déploiement, fenêtres, analyse d'impact | `/p/:id/parametres` > Déploiement ; boîte « À relire » de l'accueil ; étape de l'assistant |
| 10 Anonymisation PROD → DEV                         | `/p/:id/bases/donnees-depart` (source « copie anonymisée »)              |
| 12 Édition de lignes                                | `/bases/:id/donnees` (mode édition)                                      |
| 13 Requêtes enregistrées, partagées                 | `/bases/:id/sql` (liste latérale) ; accueil membre                       |
| 14 Explorateur de relations                         | `/bases/:id/donnees` (suivre une clé étrangère)                          |
| 20 Modèles de table                                 | Schéma > menu Insérer                                                    |
| 21-24 Gouvernance (RGPD, masquage, accès temporaire, rapport d'audit) | `/admin/gouvernance` (nouveau groupe) ; classification : Qualité > Dictionnaire |
| 25-29 CLI/CI, sync Git, génération de migrations et de code, site de documentation | `/p/:id/parametres/integrations` ; génération : Fichier ▾ > Exporter |
| 30 Commentaires ancrés avec résolution              | panneau de commentaires du Schéma                                        |
| 31 Branches de schéma                               | onglet Variantes / famille (voir Q10)                                    |
| 33 Mode présentation                                | Schéma, commande de palette                                              |
| 35-36 Alertes à seuil, historique de taille         | `/admin/alertes` ; `/bases/:id/apercu`                                   |
| 37-38 Palette globale, recherche transverse         | adoptées par ce plan (§ 8)                                               |
| 40 Raccourcis et préférences synchronisés           | `/compte/editeur`                                                        |

---

## 14. Risques

| #  | Risque                                                                                               | Gravité | Parade                                                                                               |
| -- | ---------------------------------------------------------------------------------------------------- | :-----: | ---------------------------------------------------------------------------------------------------- |
| R1 | Quitter l'éditeur (ex. aller dans Mon compte) démonte le canevas et coupe la session temps réel (`yjsClient`) ; la reconnexion coûte et efface la sélection | moyenne | garder l'éditeur monté en arrière-plan 30 s ; ou ouvrir les pages hors projet dans la barre latérale sans démonter ; à mesurer |
| R2 | Le routage est le cœur de l'application ; une régression casse l'ouverture de projet                 | élevée  | étape 1 isolée, redirections testées en e2e, `projectRouting.svelte.ts` supprimé seulement après    |
| R3 | Un seul composant pour la base à deux contextes (instance / projet) peut dériver (droits différents) | moyenne | un seul composant `BasePage` recevant `contexte` ; matrice § 5.2 testée par jeu de rôles            |
| R4 | Le serveur sert 404 sur toute nouvelle route rechargée                                               | élevée  | étape 0                                                                                              |
| R5 | Conflit de `Ctrl+K` avec CodeMirror ou les raccourcis de plugins (`plugins/shortcuts.ts` exige un modificateur) | moyenne | tester ; repli `Ctrl+Shift+K` dans l'éditeur DBML ; collision avec un plugin = avertir à l'enregistrement |
| R6 | Renommer « équipes » en « groupes » touche les libellés i18n FR/EN, la doc, les tests e2e, `docs/user-guide.md` | faible  | renommage de libellés seulement ; clés internes `teams` conservées                                   |
| R7 | La barre latérale réduit la largeur du canevas                                                       | moyenne | repliée par défaut dans le Schéma                                                                    |
| R8 | Liens `/project/:id` déjà diffusés (signets, notifications, webhooks)                                | moyenne | redirections permanentes conservées au moins 2 versions                                              |
| R9 | Supprimer 26 modales d'un coup retarde la livraison ; certains flux (déploiement, restauration) sont critiques et jamais regardés à la main (🧪 dans `etat-des-features.md`) | élevée  | convertir en dernier (étapes 5 et 7) et seulement après essai manuel des écrans actuels              |
| R10 | Les écrans marqués 🧪 (accès aux bases, comptes SQL, invitation enrichie, surveillance des comptes) n'ont **jamais été utilisés à la main** : redessiner leur emplacement avant de les voir fonctionner peut figer un mauvais parcours | moyenne | faire les essais manuels de `a-decider-et-a-tester.md` avant l'étape 4/5                            |
| R11 | Mobile non décidé (« écrire “bureau uniquement” ou rendre adaptatif », `a-decider-et-a-tester.md` § 2.2) | moyenne | la barre latérale et les onglets sont conçus avec repli < 768 px ; décision à prendre avant la maquette |
| R12 | La fuite d'inventaire (liste de toutes les bases du serveur visible d'un membre) devient plus visible avec `/bases` | élevée | traiter avec la revue de sécurité (§ 5.3, règle 2) avant de livrer `/bases` aux membres             |

---

## 15. Questions ouvertes pour le propriétaire

| #   | Question                                                                                                                                                       | Recommandation                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Q1  | **Qu'entendez-vous par « espace » ?** Groupe, client (Phase 35), ou simple filtre de la liste de projets ? Ce plan retient le filtre + les groupes.             | filtre + groupes en V1, famille de variantes ensuite                   |
| Q2  | Routeur : module maison (≈ 80 lignes, aucune dépendance) ou bibliothèque légère ?                                                                              | module maison, cohérent avec la politique « composants maison »        |
| Q3  | URL en français (`/projets`, `/bases`, `/compte`) ou anglaises ? Le produit est bilingue (FR+EN) mais `invite`, `reset-password`, `project` sont déjà anglais.   | français, avec alias anglais des 2 liens d'e-mail                       |
| Q4  | **D24** (« accès aux bases : par où ») : maintient-on « depuis un projet rattaché seulement » ou ouvre-t-on `/bases` aux membres ?                              | ouvrir `/bases` aux membres **après** la revue de sécurité (R12)       |
| Q5  | La palette globale `Ctrl+K` et la recherche transverse (Phase 38 n° 37-38) sont-elles retenues ?                                                               | oui pour la navigation et les actions ; recherche du journal en V2     |
| Q6  | La palette de l'éditeur DBML (symboles / commandes) doit-elle fusionner dans `Ctrl+K` ou rester séparée ?                                                       | rester séparée, accessible par préfixe `:`                              |
| Q7  | Renommer « équipes » en « groupes » dans l'interface ?                                                                                                          | oui (aligné sur vos documents)                                          |
| Q8  | Mobile / tablette : « bureau uniquement » ou adaptatif ? Détermine la forme de la barre latérale sur petit écran.                                              | bureau + tablette lisible ; mobile en lecture                           |
| Q9  | Supprimer « Facturation » et « Équipe » des paramètres ? « Facturation » reviendra avec une offre hébergée (D14 / offre hébergée).                              | supprimer maintenant                                                    |
| Q10 | Branches de schéma (Phase 38 n° 31) : couvertes par les variantes (Phase 35) ? Change l'onglet « Variantes » et le sélecteur de version du Schéma.              | à trancher avant la maquette de l'onglet Schéma                         |
| Q11 | « Dérive » : le mot reste-t-il visible (administrateurs) ou toujours « modifications externes » ? Faut-il aussi bloquer les déploiements tant qu'elle est ouverte (question de Phase 34) ? | libellé « modifications externes » partout                  |
| Q12 | Surveillance : elle est aujourd'hui **par projet** (toutes les bases du projet) ; faut-il la régler **par base** ? Ce plan la garde dans `Projet > Bases` et en affiche l'état dans la base. | par projet en V1                                     |
| Q13 | Mémoriser la dernière page visitée par utilisateur (reprise après connexion) ?                                                                                  | non en V1                                                               |
| Q14 | Faut-il un tableau de bord public « statut de l'instance » pour les membres (santé des bases sans détail) ?                                                     | non                                                                     |
| Q15 | Rôle « peut déployer » / « peut lancer du SQL » (section 5 de `etat-des-features.md`) : si créé, il modifie les gardes de visibilité de l'onglet Bases et de Déploiements. | attendre la décision avant de figer § 5.2                              |
| Q16 | Un administrateur de projet qui n'est pas administrateur d'instance doit-il voir la liste complète de `/bases` ou seulement les bases de ses projets ?        | seulement celles de ses projets (dans l'onglet Bases du projet)         |

---

## 16. Récapitulatif chiffré avant / après

| Mesure                                        | Avant                                  | Après                                        |
| --------------------------------------------- | -------------------------------------- | -------------------------------------------- |
| Vues plein écran dans `App.svelte`            | 8 branches, 4 sans URL                 | routes uniques, toutes adressables           |
| Familles d'URL                                | 3                                      | ≈ 10 préfixes, ~60 routes                    |
| En-têtes de navigation                        | 4                                      | 1 (barre supérieure) + 1 barre latérale      |
| Onglets de premier niveau cumulés             | 27 (6 + 8 + 6 + 7)                     | ≤ 7 par barre, jamais 2 barres d'onglets     |
| Barres empilées dans « Données » d'un projet  | 3                                      | 1 (barre de la base) + fil d'Ariane          |
| Modales                                       | 33                                     | 7 dialogues de confirmation                  |
| Éditions de l'accès aux bases                 | 4 implémentations                      | 1 composant, 4 vues filtrées                 |
| Journaux nommés différemment                  | 4                                      | 1 composant « Journal », 3 périmètres        |
| Coques de paramètres du compte                | 2                                      | 1                                            |
| Entrées d'administration                      | 8 onglets                              | 10 entrées groupées en 4 familles + vue d'ensemble |
| Endroits pour créer un projet                 | 3                                      | 1 page `/projets/nouveau`                    |

---

## 17. Ce qui n'est pas traité ici

Style visuel, thèmes et contrastes ; composants (`Modal`, `Tabs`, `List`…) ; contenu détaillé
des écrans (mise en page interne du Schéma, de la grille SQL, de l'assistant de déploiement) ;
accessibilité (focus, lecteurs d'écran, `prefers-reduced-motion`) ; textes d'interface
(micro-copie) ; mobile. Les trois premiers sont traités par les autres sections du plan de
refonte ; ce document fixe seulement le **cadre** que ces sections remplissent.

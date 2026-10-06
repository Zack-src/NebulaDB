# Refonte UI/UX d'AthanorDB — 06. Parcours, plan anti-popups et feuille de route

Document de synthèse transversal. Il complète les sections par domaine (navigation, canvas, SQL,
administration, design system) en répondant à trois questions : **que fait chaque personne avec
l'outil**, **quelles fenêtres modales faut-il supprimer ou transformer**, et **dans quel ordre
et à quel coût mener la refonte sans casser l'existant**.

État du code audité : branche `main`, commit `d12fedb`, arbre propre. Périmètre : `apps/web/src`,
`apps/web/e2e`, `apps/server/src/app.ts` (uniquement pour les routes de repli SPA).

## 0. Méthode et fiabilité des chiffres

| Type de donnée                                      | Source                                                                    | Fiabilité                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------- |
| Inventaire des popups, fichiers, déclencheurs       | `grep` sur `<Modal`, `<ConfirmDialog`, `role="dialog"`, `import(` + lecture | **Vérifié** dans le code                          |
| Nombre de clics « aujourd'hui »                     | Lecture des composants (déclencheurs, `onclick`, étapes)                  | **Compté dans le code**, sans exécution : ±1 clic |
| Durées de parcours                                  | Estimation                                                                | **Hypothèse** à valider par chronométrage (§ 9.6)  |
| Efforts en semaines-développeur                     | Estimation d'après la taille des fichiers et le nombre de tests e2e       | **Hypothèse** ±30 %                               |
| États « fait / à tester » des fonctionnalités       | `docs/etat-des-features.md` (2026-10-05)                                  | Repris tel quel                                   |

Règle de lecture : un clic = un clic ou une touche d'action (ouvrir, valider, changer d'onglet).
La saisie de champs est comptée à part (« champs »). Un « écran » est un changement de vue
complet (route, onglet de page) ; une « popup » est une fenêtre modale bloquante (`Modal`,
`ConfirmDialog`).

---

## 1. Audit exhaustif des popups

### 1.1 Le socle actuel

- **`apps/web/src/components/overlays/Modal.svelte`** — coque unique : piège à focus, restitution du
  focus à la fermeture, blocage du défilement arrière, fermeture par Échap (`useEscapeKey`) et par
  clic sur le fond (appui **et** relâchement sur le fond), props `wide` / `narrow` / `dismissable`.
  Le socle est de bonne qualité : **on le garde** (sous `ConfirmDialog` uniquement à terme).
- **`apps/web/src/components/overlays/ConfirmDialog.svelte`** — « la » boîte de confirmation :
  `danger: none | warning | danger`, `requireText` (retaper le nom), `pending`, `error`, snippet
  `children` pour un aperçu SQL. En `danger`, le focus démarre sur Annuler. Le socle existe donc
  déjà ; 7 dialogues « maison » le contournent (ils utilisent `Modal` directement pour poser une
  question, voir § 1.3 : `DeleteProjectModal`, `RollbackConfirmModal`, `DeleteUserModal`,
  suppression de connexion dans `ConnectionsTab`, `DeleteAccountModal`, `TotpDisableModal`,
  `TotpRegenerateModal`).
- **Aucun** `window.confirm()`, `alert()` ni `prompt()` natif dans `apps/web/src` hors tests
  (`grep -rnE "\b(confirm|alert|prompt)\("` : seule occurrence = un commentaire de
  `ConfirmDialog.svelte`). Point acquis, à préserver (règle ESLint `no-alert` recommandée en phase 0).
- Autres surcouches **non modales** : `NotificationBell.svelte` (`Popover` en `role="dialog"`),
  `EditorTour.svelte` (carte `role="dialog"` sans fond, ne bloque rien), `GlobalTooltip.svelte`,
  `ToastHost.svelte`, `Popover.svelte`, `Menu.svelte`, `CanvasContextMenu.svelte`,
  `CanvasSearchPanel.svelte`, tiroir SQL `EditorSqlDrawer.svelte` (Ctrl+J). Ils ne sont **pas**
  comptés comme popups ; ils sont le vocabulaire cible (§ 3).

### 1.2 Chiffres globaux

| Mesure                                                                   | Valeur                      |
| ------------------------------------------------------------------------ | --------------------------- |
| Composants qui rendent un `<Modal>` directement (fichiers)               | **37** (39 balises : `DeploymentModal` en a 3 — chargement, erreur, principal) |
| Instances de `<ConfirmDialog>` (hors catalogue de dev)                   | **11**, dans 10 fichiers    |
| **Dialogues modaux distincts à auditer**                                 | **48** (37 + 11)            |
| `confirm()` / `alert()` / `prompt()` natifs                              | **0**                       |
| Surcouches non modales (popover, tour, tiroir, toasts)                   | 6 familles                  |
| Fichiers touchés par la requête `Modal|ConfirmDialog|role="dialog"|overlays/` | 64 (dont `Root.svelte`, `ComponentCatalogue.svelte`, état local) |

Répartition par fonctionnalité (dialogues distincts) :

| Fonctionnalité            | `Modal` | `ConfirmDialog` | Total  |
| ------------------------- | :-----: | :-------------: | :----: |
| Administration (`admin/`) |    9    |        3        | **12** |
| Éditeur (`editor/`)       |    7    |        2        |   9    |
| Paramètres (`settings/`)  |    6    |        0        |   6    |
| Projets (liste)           |    5    |        0        |   5    |
| Connexions / déploiement  |    3    |        1        |   4    |
| SQL                       |    1    |        2        |   3    |
| Sauvegardes               |    2    |        1        |   3    |
| Plugins                   |    2    |        0        |   2    |
| Équipes (accès projet)    |    1    |        0        |   1    |
| Authentification          |    1    |        0        |   1    |
| Webhooks (dans projets)   |    —    |        1        |   1    |
| Surveillance (workspace)  |    —    |        1        |   1    |
| **Total**                 | **37**  |     **11**      | **48** |

(La confirmation de rotation du secret de webhook est comptée sous « Webhooks » ; `WebhooksModal`
figure sous « Projets ».)

### 1.3 Inventaire détaillé et verdicts

Légende des verdicts : **K** garder comme confirmation (`ConfirmDialog`) · **P** panneau latéral
non bloquant · **U** page avec URL · **I** inline (dans la page, accordéon, bandeau, formulaire en
ligne) · **O** popover ancré · **S** supprimer.
Durée = nombre de clics et de champs entre le déclencheur et la fin, estimé dans le code.

#### A. Projets (liste) — `apps/web/src/features/projects/`

| # | Fichier | Déclencheur | Contenu | Durée | Verdict | Justification |
|---|---------|-------------|---------|-------|---------|---------------|
| M01 | `components/DeleteProjectModal.svelte` (36 l.) | Carte projet (corbeille) → icône « supprimer définitivement » | Avertissement d'irréversibilité, confirmer | 2 clics | **K** | Vraie irréversibilité. Migrer vers `ConfirmDialog` `danger` + `requireText` (nom du projet) : aujourd'hui pas de retape du nom. |
| M02 | `components/EmptyTrashModal.svelte` (53 l.) | Bouton « Vider la corbeille (n) » de `ProjectList.svelte:230` | Compte et confirmation | 2 clics | **I** | L'action est déjà dans une section dédiée : bouton à double appui (« Vider (3) » → « Confirmer, définitif ») dans la barre de la corbeille, avec retour arrière par Échap ou 5 s. |
| M03 | `components/TemplatePickerModal.svelte` (57 l.) | Bouton « Depuis un modèle » (`ProjectList.svelte:169`) | 4 cartes de modèle | 2 clics | **U** | Un choix entre 3 façons de démarrer = une page « Nouveau projet » (`/new`), pas une fenêtre. Voir parcours J1/J2. |
| M04 | `NewProjectFromDatabaseModal.svelte` (110 l.) | Bouton « Depuis une base » (`ProjectList.svelte:173`) | Formulaire de connexion complet (moteur, hôte, port, base, utilisateur, mot de passe, SSL, URI, fichier SQLite, environnement) via `ConnectionFormFields.svelte` | 2 clics + 6 à 9 champs | **U** | Étape majeure du produit, sans réutilisation d'une connexion existante (l'état local est uniquement des champs : aucun sélecteur de connexion). Devient l'assistant `/new/from-database` (§ J1). |
| M05 | `components/WebhooksModal.svelte` (280 l., + C08) | Carte projet → icône webhook | Liste, création, tests, options, rotation de secret | 3 à 8 clics | **U** | 280 lignes = une page de réglages, pas une fenêtre. Intègre `/project/:id/settings/webhooks`. |
| M06 | `teams/ProjectTeamsModal.svelte` (111 l.) | Carte projet → icône équipes | Groupes associés au projet et niveau | 3 clics | **U** | Même page de réglages de projet : `/project/:id/settings/access`. Réutilisable depuis l'admin d'équipe. |

#### B. Éditeur — `apps/web/src/features/editor/` (chargés en `import()` depuis `ProjectEditor.svelte:824-922`)

| # | Fichier | Déclencheur | Contenu | Durée | Verdict | Justification |
|---|---------|-------------|---------|-------|---------|---------------|
| M07 | `ConvertTypesModal.svelte` (131 l.) | Barre d'outils → Convertir les types (si écriture) | Moteur source/cible, aperçu des remplacements | 3 clics | **P** | Outil projet-large qui doit se lire **à côté du canvas** pour voir l'effet. Panneau latéral droit « Outils ». |
| M08 | `compare/CompareProjectsModal.svelte` (230 l.) | Barre d'outils → Comparer | Choix d'un second projet, diff, SQL de migration | 3 à 5 clics | **U** | Grand tableau de différences : page `/project/:id/compare?with=:other`, partageable. |
| M09 | `io/ExportDialog.svelte` (210 l.) | Barre d'outils → Exporter | Format (DBML/SQL/PNG/SVG/PDF), options, dialecte | 3 à 4 clics | **O** | Choix de format + 2-3 options : menu déroulant à sous-panneau. Téléchargement direct sur le format par défaut. |
| M10 | `io/ImportDialog.svelte` (129 l.) | Barre d'outils → Importer | Coller ou déposer DBML/SQL, validation | 3 clics + saisie | **P** | Collage + aperçu : panneau latéral, avec zone de dépôt aussi sur le canvas vide (état vide). |
| M11 | `locks/TableLockDialog.svelte` (146 l.) | Icône cadenas d'une table (`openLockDialog`) | Durée, motif du verrou | 2 à 3 clics | **O** | 146 lignes pour 2 champs : popover ancré au cadenas de la table. |
| M12 | `locks/TableLocksList.svelte` (109 l.) | Pastille « n tables verrouillées » (`onShowLocks`) | Liste, libération | 2 clics | **O** | Liste courte, alimentée en direct : popover depuis la barre d'état. |
| M13 | `seeds/SeedDialog.svelte` (419 l., + C07) | Bouton « Données initiales » d'une table | CSV, générateur, reprise depuis la base, lignes | 4 à 10 clics | **U** | Le plus gros dialogue (419 l.) : tableau éditable. Sous-onglet `Données › Jeux de données` (`/project/:id/data/seeds/:table`). |
| M14 | `connections/DeploymentModal.svelte` (366 l., + C05) | Bouton Déployer, onglet Déploiements, `ConnectionsTab` | Assistant 5 étapes : diff, risques, SQL, résultat, historique | 6 à 9 clics | **U** | Opération la plus critique, deux popups empilées. Page `/project/:id/deploy`. Voir J4. |

#### C. Connexions et déploiement — `apps/web/src/features/connections/`

| # | Fichier | Déclencheur | Contenu | Durée | Verdict | Justification |
|---|---------|-------------|---------|-------|---------|---------------|
| M15 | `PersonalAccountDialog.svelte` (105 l.) | Paramètres › Mes comptes SQL (`SqlAccounts.svelte:52`), `PersonalAccountButton.svelte` | Identifiant et mot de passe de son compte SQL pour une base | 3 clics + 2 champs | **I** | Ligne de tableau qui se déplie en formulaire (`SqlAccounts`) ; depuis le sélecteur de base du workspace, popover ancré. |
| M16 | `RollbackConfirmModal.svelte` (73 l.) | `DeploymentHistoryPanel.svelte:145` → « revenir en arrière » | SQL du retour arrière, avertissements | 3 clics | **K** | Irréversible/risqué. Migrer sur `ConfirmDialog` (`children` = aperçu SQL, `requireText` en prod). |

#### D. Administration — `apps/web/src/features/admin/` (pas d'URL propre : `adminOpen` dans `Root.svelte`)

| # | Fichier | Déclencheur | Contenu | Durée | Verdict | Justification |
|---|---------|-------------|---------|-------|---------|---------------|
| M17 | `connections/ConnectionEditModal.svelte` (299 l., + C01) | Admin › Connexions › Nouvelle / Modifier | Tous les champs de connexion, test, rattachement à des projets | 3 clics + 6 à 9 champs | **U** | 299 lignes, formulaire large avec tests de connexion. Page `/admin/connections/:id` (ou `/new`), onglets Paramètres / Projets / Compte. |
| M18 | `connections/StatementModal.svelte` (77 l.) | `ExplorerPanel`, `SessionsPanel`, `UsersPanel` (créer/supprimer un compte, tuer une session, supprimer une base…) | Aperçu du SQL exact construit par le serveur, exécution au 2e clic, retape du nom si destructif | 2 clics + saisie | **K** | Excellent patron de sécurité à garder, mais sous la forme `ConfirmDialog` + `children` (aperçu SQL) ; pour les actions non destructives (créer un compte) l'aperçu devient un bloc inline sous le formulaire. |
| M19 | `DeleteUserModal.svelte` (76 l.) | Admin › Utilisateurs › supprimer | Confirmation, conséquences sur les projets | 2 clics | **K** | Destructif. Passer sur `ConfirmDialog` + `requireText` (e-mail). |
| M20 | `lint/LintApplyModal.svelte` (57 l.) | Admin › Modèles de lint › appliquer à des projets | Choix de projets cibles | 3 clics | **P** | Sélecteur multiple : panneau latéral dans la page du modèle. |
| M21 | `lint/LintPresetModal.svelte` (59 l.) | Admin › Modèles de lint › nouveau / renommer | Nom, description | 2 clics + 2 champs | **I** | Deux champs : ligne éditable dans la liste. |
| M22 | `ResetPasswordModal.svelte` (63 l.) | Admin › Utilisateurs › réinitialiser | Mot de passe temporaire ou lien | 3 clics | **I** | Section « Sécurité » de la fiche utilisateur ; le résultat (mot de passe à transmettre) se montre dans un bloc inline avec « Copier ». |
| M23 | `TeamDetailView.svelte` (126 l., en `Modal`) | Admin › Équipes › sélection (`selectedTeamId`) | Membres, projets, accès aux bases de l'équipe | 3 clics | **U** | C'est une vue, pas une popup (nommée « View », rendue en modale) : `/admin/teams/:id`. |
| M24 | `UserDbAccessModal.svelte` (63 l.) | Admin › Utilisateurs › « Accès aux bases » | Niveau lecture/écriture par connexion, nom de compte proposé (`DbAccessEditor`) | 5 clics | **U** | Fiche utilisateur `/admin/users/:id` (section Accès aux bases). Voir J6. |
| M25 | `ConnectionsTab.svelte:222` (`Modal` direct) | Admin › Connexions › corbeille | Suppression d'une connexion | 2 clics | **K** | Destructif : `ConfirmDialog` + `requireText` (nom de la connexion). |

#### E. Paramètres et authentification — `apps/web/src/features/settings/`, `auth/`

| # | Fichier | Déclencheur | Contenu | Durée | Verdict | Justification |
|---|---------|-------------|---------|-------|---------|---------------|
| M26 | `auth/ChangePasswordModal.svelte` (82 l.) | Paramètres › Profil (`SettingsPage.svelte:81`, `SettingsModal`) | 3 champs mot de passe | 2 clics + 3 champs | **I** | Section « Sécurité » dépliable : aucun besoin de masquer la page. |
| M27 | `settings/SettingsModal.svelte` (68 l.) | Barre d'outils de l'éditeur → roue (`onOpenSettings`, `ProjectEditor.svelte:601`) | Les mêmes sections que `SettingsPage.svelte` via `SettingsTabContent` | 1 clic | **S** | **Doublon** : la même matière existe en pleine page. Supprimer la modale ; la roue ouvre `/settings` (retour sur le projet d'origine). |
| M28 | `settings/DeleteAccountModal.svelte` (44 l.) | Paramètres › Données personnelles | Suppression du compte | 2 clics | **K** | Destructif. `ConfirmDialog` + `requireText` (e-mail). |
| M29 | `settings/totp/TotpSetupWizard.svelte` (109 l.) | Paramètres › Double authentification › Activer | QR code, code de vérification | 4 clics + 1 champ | **I** | Assistant 3 étapes déplié dans la section Sécurité (pas de masque). |
| M30 | `settings/totp/TotpDisableModal.svelte` (53 l.) | Désactiver la 2FA | Saisie du mot de passe | 3 clics | **K** | Action sensible : `ConfirmDialog` avec champ mot de passe en `children`. |
| M31 | `settings/totp/TotpRegenerateModal.svelte` (40 l.) | Régénérer les codes de secours | Confirmation | 2 clics | **K** | Invalide les anciens codes : confirmation. |
| M32 | `settings/totp/BackupCodesModal.svelte` (34 l.) | Après activation/régénération | Affichage unique des codes | 1 clic | **I** | Bloc inline « à copier maintenant » avec case « J'ai enregistré mes codes » ; plus rassurant qu'une modale fermable par erreur. |

#### F. Sauvegardes, SQL, plugins, surveillance

| # | Fichier | Déclencheur | Contenu | Durée | Verdict | Justification |
|---|---------|-------------|---------|-------|---------|---------------|
| M33 | `backups/BackupScopeDialog.svelte` (95 l.) | Onglet Sauvegardes › Sauvegarder maintenant (`BackupsPanel`) | Périmètre (bases/tables), options | 3 clics | **I** | Formulaire dépliant dans le panneau Sauvegardes. |
| M34 | `backups/RestoreDialog.svelte` (208 l.) | Sauvegarde › Restaurer | Cible, options, avertissements, vérifications | 4 à 6 clics | **P** | Opération lourde et rare : panneau latéral large avec confirmation finale (`ConfirmDialog`, `requireText` en production). |
| M35 | `plugins/PluginManagerDialog.svelte` (324 l.) | Éditeur › Plugins (`openPlugins`, `ProjectEditor.svelte:311`) | Liste, installation, activation, réglages | 3+ clics | **U** | Gestion d'extensions = page `/settings/plugins` ; le canvas garde le menu `PluginMenu.svelte`. |
| M36 | `plugins/dialog/PluginSettingsModal.svelte` (96 l.) | Plugin › Réglages (imbriquée dans M35 : modale **dans** une modale) | Réglages d'un plugin | 4 clics | **I** | Accordéon dans la ligne du plugin ; supprime l'empilement. |
| M37 | `sql/StructureRedirectDialog.svelte` (91 l.) | `SqlPanel` / `ExplorerPanel` : une instruction de structure est refusée | Explique pourquoi et renvoie vers le schéma | 1 à 2 clics | **I** | Message d'erreur à action (« Ouvrir dans le schéma ») dans la zone de résultat : l'information est la sortie de la requête, pas une interruption. |

#### G. Les 11 `ConfirmDialog`

| # | Fichier | Déclencheur | Danger | Verdict | Justification |
|---|---------|-------------|--------|---------|---------------|
| C01 | `admin/connections/ConnectionEditModal.svelte:287` | « Importer le schéma » dans un projet existant | warning | **K** | Écrase le schéma du projet. |
| C02 | `admin/EnvironmentsTab.svelte:252` | Supprimer une étape d'environnement | (défaut) | **K** | Détache des connexions. |
| C03 | `admin/lint/LintPresetsTab.svelte:107` | Supprimer un modèle de lint | (défaut) | **K** | Détruit un modèle partagé. |
| C04 | `backups/BackupsPanel.svelte:220` | Supprimer une sauvegarde | (défaut) | **K** | Irréversible. |
| C05 | `connections/DeploymentModal.svelte:357` | Déployer (confirmation finale, `requireText` = nom de la connexion, `danger`) | danger | **K** | La confirmation la plus précieuse du produit : à garder telle quelle. |
| C06 | `editor/drift/DriftBanner.svelte:101` | « Resynchroniser le schéma sur la base » | warning | **K** | Écrase le modèle : garder, ajouter l'aperçu du diff en `children`. |
| C07 | `editor/seeds/SeedDialog.svelte:410` | Retirer les lignes initiales d'une table | warning | **I** | Réversible dans l'historique : suppression immédiate + toast « Annuler » (8 s, déjà supporté par `toast.svelte.ts`). |
| C08 | `projects/components/WebhooksModal.svelte:270` | Rotation du secret | (défaut) | **K** | Casse les récepteurs : garder. |
| C09 | `sql/SqlPanel.svelte:195` | Exécuter une écriture (`confirmingWrite`) | danger | **K** | Garde-fou central du mode écriture. |
| C10 | `sql/SqlPanel.svelte:208` | Exécuter une instruction de structure (admin) | warning | **K** | Idem ; ne pas fusionner avec M37 (cas distinct : permis vs refusé). |
| C11 | `workspace/MonitoringCard.svelte:225` | Accepter les comptes constatés comme référence | (défaut) | **I** | Réversible (recalcul au prochain relevé) : bouton direct + toast « Annuler ». |

### 1.4 Bilan des verdicts

| Verdict                          | Nombre | Dialogues                                                                 |
| -------------------------------- | :----: | ------------------------------------------------------------------------- |
| **K** — rester une confirmation  | **17** | M01, M16, M18, M19, M25, M28, M30, M31 (8) ; C01-C06, C08-C10 (9)         |
| **U** — page avec URL            | **11** | M03, M04, M05, M06, M08, M13, M14, M17, M23, M24, M35                     |
| **I** — inline                   | **12** | M02, M15, M21, M22, M26, M29, M32, M33, M36, M37 (10) ; C07, C11 (2)      |
| **P** — panneau latéral          | **4**  | M07, M10, M20, M34                                                        |
| **O** — popover ancré            | **3**  | M09, M11, M12                                                             |
| **S** — supprimé (doublon)       | **1**  | M27                                                                       |
| **Total**                        | **48** |                                                                           |

**Cible : 48 dialogues modaux → 17 confirmations (-65 %), toutes sur le seul `ConfirmDialog`.**
Aucune modale « de contenu » ne subsiste : plus aucun `<Modal>` directement dans `features/`.
Aucune modale imbriquée (M36 dans M35 aujourd'hui ; C05 au-dessus de M14 ; C01 au-dessus de M17).

Empilements de popups existants à supprimer en priorité : **M14 + C05** (déployer), **M17 + C01**
(modifier une connexion + importer), **M35 + M36** (plugins), **M13 + C07** (données initiales),
**M05 + C08** (webhooks), **M23 + sélection d'accès** (équipe).

### 1.5 Ce qui résulte pour `Modal.svelte` et `ConfirmDialog.svelte`

1. `Modal` devient un détail d'implémentation de `ConfirmDialog` (plus exporté pour les features).
   Une règle ESLint `no-restricted-imports` interdira `@/components/overlays/Modal.svelte` dans
   `src/features/**` après la phase 5.
2. `ConfirmDialog` gagne : `children` conservé, un champ `requireText` générique déjà présent,
   une variante `inputs` (champ mot de passe de M30), un `Annuler` toujours en premier
   dans l'ordre de tabulation en `danger`, et le même gabarit de libellé « Verbe + objet »
   (voir § 7, i18n).
3. Nouveaux composants à créer : `SidePanel.svelte` (non modal, redimensionnable, mémorise sa
   largeur), `PageHeader.svelte`, `InlineConfirm.svelte` (bouton à double appui), `PopoverForm.svelte`
   (au-dessus de `Popover.svelte`, qui existe déjà), `UndoToast` (`toast.svelte.ts` supporte
   déjà `action`).

---

## 2. Personas et parcours

### 2.1 Personas

Rappel de la réalité du code : le **rôle d'administrateur d'instance** donne accès à toute
l'administration et à la console de base ; un **rôle intermédiaire** (« peut déployer », « peut lancer
du SQL ») n'existe pas (`docs/etat-des-features.md` § 5, ❌) — le SQL passe par le droit d'accès à
une base (§ 6). Le « DBA » est donc **aujourd'hui un administrateur d'instance** : c'est une question
ouverte (§ 15, Q4).

| Id | Persona | Qui | Besoin principal | Fréquence d'usage | Écrans dominants |
|----|---------|-----|------------------|-------------------|------------------|
| **P1** | **Administrateur d'instance** (Amélie) | Responsable de l'outil | Inviter, donner des droits, brancher des bases, surveiller | Quotidienne, par rafales | Admin (invitations, utilisateurs, équipes, connexions, activité) |
| **P2** | **Responsable de projet / modélisateur** (Marc) | Concepteur de schéma | Modéliser, déployer, relire les risques | Quotidienne | Canvas, DBML, Déployer, Historique, Problèmes |
| **P3** | **Développeur membre avec accès SQL** (Léa) | Consomme le schéma et interroge | Lire des données, écrire des requêtes ponctuelles | Hebdomadaire à quotidienne | Onglet Données & SQL, tiroir SQL, Paramètres › Comptes SQL |
| **P4** | **DBA** (Karim, administrateur d'instance en pratique) | Gère comptes SQL, sessions, santé, sauvegardes | Comptes, privilèges, sessions, santé, journaux | Quotidienne | Admin › Connexions › console (Explorateur, Utilisateurs, Sessions, Santé, Sauvegardes, Journal) |
| **P5** | **Lecteur** (Nadia) | Chef de projet, QA, métier | Comprendre, commenter, être notifié | Occasionnelle | Canvas lecture, Dictionnaire, Commentaires, Notifications |

### 2.2 Les 12 parcours clés — tableau comparatif

Les nombres « aujourd'hui » viennent du code (composants cités) ; **popups** = fenêtres modales
traversées ; **écrans** = vues distinctes (pages ou onglets) ; durée = hypothèse à chronométrer.

| Id | Parcours | Persona | Clics auj. | Champs auj. | Écrans auj. | Popups auj. | Clics cible | Popups cible | Gain clics |
|----|----------|---------|:---------:|:-----------:|:-----------:|:-----------:|:-----------:|:------------:|:----------:|
| J1 | Créer un projet depuis une base existante | P2 | 2 (+1 pour ouvrir) | 6-9 | 2 | 1 (M04) | 3 | 0 | = (champs -80 %) |
| J2 | Démarrer un projet vide ou depuis un modèle | P2 | 1 (vide) / 3 (modèle) | 0 | 2 | 0 / 1 (M03) | 2 | 0 | -1 |
| J3 | Modéliser : table, colonnes, relation, groupe | P2 | ~12 | ~6 | 1 | 0 | ~9 | 0 | -25 % |
| J4 | Déployer en production | P2 | 7 à 9 | 1 (nom en prod) | 1 (modale) | 2 (M14, C05) | 5 | 1 (C05) | -40 % |
| J5 | Revenir en arrière après un déploiement | P2 | 5 | 0-1 | 2 | 2 (M16 sur onglet) | 3 | 1 (M16) | -40 % |
| J6 | Donner accès en lecture à un utilisateur existant | P1 | 6 | 0 | 3 | 1 (M24) | 4 | 0 | -33 % |
| J7 | Inviter un nouvel arrivant avec équipes, accès et compte SQL | P1 | 5 + saisie | 2-4 | 1 | 0 | 4 | 0 | = (aide) |
| J8 | Trouver qui a modifié ma base hors Athanor | P2/P1 | 5 à 7 | 0 | 3 | 0 (+1 si resync) | 3 | 0 | -45 % |
| J9 | Écrire une requête SQL ad hoc | P3 | 1 à 3 | 1 | 1 | 0 (1 en écriture) | 2 | 0 (1 en écriture) | -1 |
| J10 | Créer un compte SQL (et lui accorder un droit) | P4 | 7 à 9 | 3-4 | 3 | 1-2 (M18) | 5 | 0-1 | -40 % |
| J11 | Régler mon compte SQL personnel et ma 2FA | P3 | 4 + 5 | 2 + 1 | 2 | 1 + 2 (M15, M29, M32) | 3 + 3 | 0 | -50 % |
| J12 | Relire, commenter, être notifié (lecteur) | P5 | 3 à 5 | 1 | 1 | 0 | 3 | 0 | = |

Gains de **découverte** (pas seulement de clics) : J1, J6, J8, J10 passent de « trouver où c'est »
(admin sans URL, onglets masqués, droits requis) à « aller à l'objet, ou le chercher dans la palette
de commandes » (§ 3.3).

### 2.3 Détail de chaque parcours — aujourd'hui / cible

Légende ASCII : `[Bouton]`, `<champ>`, `(Écran)`, `{Popup}`, `→` transition, `⇒` résultat.

#### J1 — Créer un projet depuis une base existante (P2)

**Aujourd'hui** (`ProjectList.svelte:173` → `NewProjectFromDatabaseModal.svelte`) :
`[Depuis une base]` → `{modale}` : `<nom>` `<moteur>` `<hôte>` `<port>` `<base>` `<utilisateur>` `<mot de passe>`
`<SSL>` `<environnement>` → `[Créer]` → le serveur crée **connexion + projet + import** (aucun test
préalable ; une erreur se lit dans la modale) → ouverture du canvas. **Pas de réutilisation d'une
connexion déjà déclarée** : on ressaisit les identifiants à chaque projet, et la connexion apparaît
ensuite dans l'admin sans que l'utilisateur sache qu'il en a créé une. 2 clics, 6-9 champs, 1 popup.

**Cible** (`/new/from-database`) :

```text
(Projets) [+ Nouveau projet] ──► (/new)  ┌──────────┬───────────────┬──────────────────┐
                                         │ Vide     │ Depuis modèle │ Depuis une base  │
                                         └──────────┴───────────────┴────────┬─────────┘
                                                                              ▼
 (/new/from-database)  1. Base source           2. Aperçu               3. Nommer
  ┌─────────────────────────────┐   ┌──────────────────────┐   ┌─────────────────────┐
  │ ( ) Connexion existante ▼   │   │ 42 tables, 318 col.  │   │ <Nom du projet>      │
  │ ( ) Nouvelle connexion      │   │ 7 relations déduites │   │ [Créer et ouvrir]    │
  │     <moteur> <hôte> …       │   │ [Tester la connexion]│   └──────────┬──────────┘
  │ [Tester]  ✓ 38 ms           │   └──────────┬───────────┘              ▼
  └─────────────┬───────────────┘              │                    ⇒ (canvas) toast
                └──────────────────────────────┘                       « 42 tables importées »
```

Clics cible : `+ Nouveau` (1) → carte « Depuis une base » (2) → choisir une connexion existante
(si elle existe) ou saisir + `Tester` (3) → `Créer et ouvrir` (4). En réutilisant une connexion :
**3 clics, 1 champ (nom), 0 popup**. Une connexion non admin : l'étape 1 dit explicitement que la
connexion sera enregistrée et visible des administrateurs (honnêteté sur l'effet de bord).

#### J2 — Démarrer un projet vide ou depuis un modèle (P2)

**Aujourd'hui** : `[Nouveau projet]` (`handleCreate`, `ProjectList.svelte:165`) ouvre directement un
schéma vide (1 clic, 0 popup). `[Depuis un modèle]` → `{TemplatePickerModal}` 4 cartes → 1 clic
sur une carte → canvas (3 clics, 1 popup).

**Cible** : la page `/new` (ci-dessus) propose trois cartes dont la première est la plus grande
(« Vide »). Le bouton « + Nouveau projet » **ne crée plus immédiatement** (risque de projets vides
accidentels) : un clic → choix → ouverture. Les modèles montrent une miniature (déjà disponible :
`ProjectThumbnail.svelte`, `templateCopy.ts`). **2 clics, 0 popup**, 1 clic de plus pour le chemin
le plus court (compromis assumé — voir Q9).

#### J3 — Modéliser : table, colonnes, relation (P2)

**Aujourd'hui** (`CanvasToolbar.svelte`, `InsertToolDropdown.svelte`, doc `user-guide.md` § 2) :
`[Insérer ▾]` → `Table` → double-clic en-tête pour renommer → clic sur un champ → éditeur (nom,
type, défaut, PK, non-null, note) → glisser d'ancre à ancre. Environ 12 clics pour une table de 3
colonnes liée à une autre. 0 popup, mais **deux surfaces redondantes** (DBML et canvas) sans
indication de laquelle utiliser (voir doc canvas).

**Cible** : (détail dans la section canvas) création au clavier (`T` puis saisie), éditeur de colonne
en ligne dans la table, relation par glisser ou par saisie `→ users.id` ; aucune modale.

```text
 (Canvas)  [T] ─► table vide en édition : <nom>⏎ <colonne> <type>⏎ <colonne> <type>⏎ Échap
                                       relation : glisser l'ancre  OU  clic droit › « Lier à… » (liste filtrable)
```

~9 clics/touches. Dépend de la phase 2.

#### J4 — Déployer en production (P2)

**Aujourd'hui** (`ProjectEditor.svelte:859-876` → `DeploymentModal.svelte`) :
`[Déployer]` → `{DeploymentModal}` (3 états : chargement, erreur, principal) → choisir la connexion
(`selectedConnId`) → analyse → étape **Différences** → `Suivant` → étape **Risques** (stratégies par
risque) → `Prévisualiser le SQL` → étape **SQL** → `Déployer` → `{ConfirmDialog C05}` (retaper le
nom de la connexion, `danger="danger"`) → `Confirmer` → étape **Résultat**. 7 à 9 clics, 1 champ
(nom), **2 popups empilées**. L'onglet **Déploiements** (`DeploymentsTab.svelte`) affiche aussi
pipeline, comparaison, surveillance : trois « cartes » distinctes qui renvoient chacune vers la modale.

**Cible** (`/project/:id/deploy`) :

```text
(Déployer)  ┌───────────────────────────────────────────────────────────────────────────┐
 /project/42/deploy?to=prod                                                              │
  ① Cible ──── ② Changements ──── ③ Risques ──── ④ Vérifier le SQL ──── ⑤ Déployer       │
  [Dev ▸ Staging ▸ PROD]  (le pipeline sans saut d'étape est la barre elle-même)        │
  ┌─ Résumé en haut, toujours visible ─────────────────────────────────────────┐        │
  │ +3 tables  ~2 colonnes  −0   │  1 risque élevé   │  sauvegarde auto : oui │        │
  └─────────────────────────────────────────────────────────────────────────────┘        │
  [Retour]                                            [Déployer sur PROD… ] ──► {Confirmer}  │
                                                                     (nom retapé)        │
 ⇒ Résultat dans la même page + toast + lien « Annuler ce déploiement » (J5)                │
```

5 clics (Déployer → cible → Suivant → Suivant → Déployer) + confirmation. Le **résumé collé en haut**
permet de ne parcourir les étapes que si le risque l'exige (parcours rapide en 3 clics sans risque).
La confirmation C05 reste une `ConfirmDialog` : c'est le seul endroit où une modale se justifie
pleinement. Les étapes deviennent des sections d'URL (`#risks`), le retour navigateur fonctionne.

#### J5 — Revenir en arrière après un déploiement (P2)

**Aujourd'hui** : `(Déploiements)` → carte historique (`DeploymentHistoryPanel.svelte`) ou étape
« historique » de la modale → `[Revenir en arrière]` sur la ligne → `{RollbackConfirmModal}` →
confirmer. 4 à 5 clics, 1 popup (+1 si la modale de déploiement est déjà ouverte). « Au mieux » :
MySQL ne revient pas à travers un échec en cours de lot (`etat-des-features.md` § 4) — le dire
**avant** le clic, pas après.

**Cible** :

```text
 (Déploiements ▸ historique)  ligne : 12 oct · 3 changements · par Marc · ✓
                              [Revenir…] ──► {ConfirmDialog + aperçu SQL, avertissement par moteur}
 ⇒ ligne « annulé » + toast
```

3 clics, 1 confirmation (justifiée). Le bouton affiche à l'avance « annulation partielle » pour MySQL.

#### J6 — Donner accès en lecture à une base à un utilisateur existant (P1)

**Aujourd'hui** (`UserDbAccessModal.svelte`, `UsersTab.svelte:105`) : en-tête `[Administration]`
(`onOpenAdmin`) → onglet « Utilisateurs » → ligne de l'utilisateur → `[Accès aux bases]` →
`{modale}` : `DbAccessEditor` : cocher la connexion, choisir « lecture » (+ nom de compte
proposé) → `[Enregistrer]` → toast. **5 à 6 clics, 1 popup**, aucune URL (l'état `adminOpen` n'est pas
adressable), et il faut connaître le chemin : l'accès aux bases existe **à trois endroits** (invitation,
utilisateur, équipe) sans lien entre eux.

**Cible** :

```text
 Ctrl+K ─► « donner accès à Léa » ──► (/admin/users/lea)  [Accès aux bases]
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ Accès aux bases de Léa                                                   │
 │ ● prod-pg        ( ) aucun (•) lecture ( ) écriture   compte : <lea_ro>  │
 │ ● staging-mysql  ( ) aucun ( ) lecture (•) écriture   hérité de « Dev » ⓘ │
 │                                          [Enregistrer]  ⇒ toast + journal │
 └──────────────────────────────────────────────────────────────────────────┘
```

Clics : `Ctrl+K` (0) + choisir (1) + lecture (2) + Enregistrer (3) = **3 clics, 0 popup, 1 URL**
(partageable avec un collègue admin). La ligne indique l'origine du droit (direct ou via équipe),
information déjà calculée (`dbAccess`) mais éclatée.

#### J7 — Inviter un nouvel arrivant avec équipes, accès et compte SQL (P1)

**Aujourd'hui** (`InvitationsTab.svelte`) : le formulaire est déjà **inline** : e-mail → cases d'équipes
→ `DbAccessEditor` (accès aux bases + nom de compte à créer à l'acceptation) → `[Inviter]` → lien à
transmettre. C'est le meilleur parcours existant : 0 popup. Défauts : l'écran est dense (3 sections
sans hiérarchie), le compteur `grantCount` n'est pas mis en avant, le lien d'invitation « vaut compte »
(`user-guide.md` § 1) sans avertissement visuel fort, et l'effet « compte sans privilège, à accorder
ensuite » (`etat-des-features.md` § 6) surprend.

**Cible** : même page, en 3 blocs numérotés avec un **récapitulatif latéral** (« Léa recevra : 2 équipes,
lecture sur prod-pg, un compte SQL `lea_ro` créé à l'acceptation, sans privilège »), bouton unique,
lien copiable + état « copié ». 4 clics, 0 popup.

```text
 (/admin/invitations/new)  ① Qui  ② Appartenances (équipes)  ③ Bases (accès + compte)   ┌─ Récap ─┐
 <e-mail>                 ☐ Dev ☑ Data                       prod-pg  (•) lecture         │ 2 équipes│
                                                                              [Inviter ▸]│ 1 accès  │
 ⇒ bloc inline « Lien d'invitation (valable 7 jours) [Copier] » + rappel : « ce lien vaut compte »
```

#### J8 — Trouver qui a modifié ma base hors Athanor (P2 / P1)

**Aujourd'hui** : la détection est visible partout (`DriftBanner.svelte`, bandeau entre la barre d'outils
et le canvas, visible de tous ceux qui ouvrent le projet) ; l'action (« Voir les différences »,
« Resynchroniser » C06, « Ignorer ») est réservée aux administrateurs du projet. Pour savoir
**qui** : `[Administration]` → `Connexions` → ouvrir la console de la base → onglet **Journal**
(`JournalPanel.svelte`, administrateurs d'instance) ou `Activité`. Total : 5 à 7 clics, 3 écrans. Limite
honnête : le niveau 1 relève des **sessions toutes les 5 minutes** (instantané, `etat-des-features.md`
§ 8) ; il ne sait pas toujours dire « qui ». L'interface actuelle ne le dit pas.

**Cible** :

```text
 (Canvas) bandeau : « 2 changements hors Athanor depuis le 12 oct. »  [Voir qui et quoi ▸]
     ──► (/project/42/data/activity?source=externe)
     ┌───────────┬──────────────┬───────────────────────┬──────────────┬────────────────┐
     │ Quand     │ Compte SQL   │ Changement            │ Confiance    │ Action         │
     │ 12 oct 14h│ svc_batch    │ ALTER users ADD col   │ ◐ relevé 5min│ [Reprendre ▾]  │
     └───────────┴──────────────┴───────────────────────┴──────────────┴────────────────┘
 Filtre « hors Athanor » préréglé · colonne « Confiance » explicite (relevé périodique vs audit natif)
```

3 clics (bandeau → table → action). La colonne « Confiance » transforme une limite technique en
information. Les non-administrateurs du projet voient la liste sans les actions.

#### J9 — Écrire une requête SQL ad hoc (P3)

**Aujourd'hui** (`EditorSqlDrawer.svelte`, `SqlPanel.svelte`) : depuis l'éditeur, `Ctrl+J` (ou bouton
SQL) ouvre le **tiroir** sous le diagramme, branché sur la base courante ; saisie ; `Exécuter`. Écriture
(`access = write`) : `{C09}` en plus. Le chemin de l'onglet `Données & SQL` est identique. 1 à 3 clics,
0 popup en lecture. **C'est déjà le bon patron** (panneau non bloquant) : il est à généraliser plutôt
qu'à changer. Manques connus : simple zone de texte sans complétion, pas de requêtes enregistrées
(`etat-des-features.md` § 7, ❌).

**Cible** : inchangé en structure (`Ctrl+J`, tiroir redimensionnable), plus : la table cliquée
alimente `SELECT * FROM … LIMIT 100` ; l'historique des requêtes en liste latérale ; l'écriture
garde C09 mais **le niveau d'accès (lecture / écriture) est affiché en pastille dans l'en-tête du
tiroir** avant de taper.

```text
 Ctrl+J ─► ┌ SQL · prod-pg · ● lecture seule ──────────────── [⤢] [×] ┐
           │ SELECT * FROM users LIMIT 100;            [Exécuter ⌃↵] │
           ├─ résultats ─────────────────────────────────────────────┤
           │ 100 lignes · 38 ms                       [CSV] [Copier] │
           └─────────────────────────────────────────────────────────┘
```

#### J10 — Créer un compte SQL sur une base (P4)

**Aujourd'hui** : `[Administration]` → `Connexions` → ouvrir la console de la connexion → onglet
`Utilisateurs` (`UsersPanel.svelte`) → bouton de création → formulaire (nom, mot de passe, rôle) →
`{StatementModal M18}` : aperçu du SQL exact (secrets masqués) → `Exécuter` ; pour un privilège,
une 2e passe par `StatementModal`. 7 à 9 clics, 1-2 popups. Le patron « aperçu puis exécution » est
excellent ; seule sa forme (modale) est à reprendre.

**Cible** :

```text
 (Admin ▸ Connexions ▸ prod-pg ▸ Comptes)   [+ Nouveau compte]
   ┌ formulaire inline ───────────────┐   ┌ Aperçu du SQL (mis à jour en direct) ───────────┐
   │ <nom> <mot de passe ⟳> <rôle ▾>  │   │ CREATE USER "lea_ro" WITH PASSWORD '••••••••';  │
   └───────────────┬──────────────────┘   └───────────────────────┬─────────────────────────┘
                   └──────────── [Exécuter] ─────────────────────┘  ⇒ ligne ajoutée + toast
 destructif (supprimer, tuer une session) : {ConfirmDialog + aperçu SQL + nom retapé}
```

5 clics, 0 popup (1 si destructif). Option : « Lier à un utilisateur Athanor » dans la même page
(complète l'item ★ « l'admin associe un compte de base à un compte Athanor », 🟡).

#### J11 — Régler mon compte SQL personnel et ma 2FA (P3)

**Aujourd'hui** : Paramètres (`SettingsPage` pleine page, **ou** `SettingsModal` depuis l'éditeur : deux
chemins) › Profil › « Mes comptes SQL » (`SqlAccounts.svelte`) → `[Définir]` → `{PersonalAccountDialog}`
(identifiant + mot de passe) → enregistrer : 4 clics, 1 popup. 2FA : Sécurité › Activer →
`{TotpSetupWizard}` (QR, code) → `{BackupCodesModal}` : 5 clics, 2 popups.
Le bloc « Mes comptes SQL » est nouveau et n'a **jamais été utilisé à la main**
(`etat-des-features.md` § 6, 🧪) : test d'usage prioritaire en recette.

**Cible** : une page `/settings` en sections (Profil, Sécurité, Comptes SQL, Apparence, Éditeur, Plugins,
Clés d'API, Sessions), avec les formulaires dépliables :

```text
 (/settings/sql-accounts)  prod-pg   ● non défini     [Définir ▾]  ──► ligne dépliée :
                           <identifiant> <mot de passe> [Tester et enregistrer]   ⇒ ● lea_ro  ✓
 (/settings/security)      Double authentification  [Activer ▾] ──► ① QR  ② code  ③ codes à copier ☐ enregistrés
```

3 clics + 3 clics, 0 popup. Une bannière contextuelle apparaît dans le tiroir SQL si le compte
personnel est requis mais non défini (« Définir mon compte pour prod-pg » → `/settings/sql-accounts#prod-pg`).

#### J12 — Relire, commenter, être notifié (P5)

**Aujourd'hui** : ouverture du projet, lecture du canvas, `Commentaires`, mentions `@` (notifier même
sans suivre le projet), cloche de notifications (`NotificationBell.svelte`, popover). 3 à 5 clics, 0
popup. Bon parcours. Défauts : le lecteur voit des onglets et boutons qu'il ne peut pas utiliser
(déploiement, SQL) ; la règle « Un projet sans groupe est lisible par tous » n'est pas dite.

**Cible** : interface **adaptative au rôle** : un lecteur ne voit ni Déployer, ni Données & SQL
(masqués, pas grisés), un bandeau « Lecture seule — demander l'accès à @responsable » remplace les
boutons d'édition, le mode lecture du canvas ouvre sur le dictionnaire de la table sélectionnée.

```text
 (Canvas lecture) table users ─ clic ─► panneau droit : Description · Colonnes · Commentaires (3) · Qui l'utilise
                  @marc dans un commentaire ─► cloche (1) ─► clic ─► canvas centré sur le fil
```

---

## 3. Plan anti-popups

### 3.1 Règle de décision (à coller dans le guide du design system)

```text
La tâche demande-t-elle une décision irréversible ou qui écrase / détruit quelque chose ?
 ├─ oui → ConfirmDialog (K). Seul cas de modale. Danger proportionné, aperçu en `children`.
 └─ non
     ├─ contenu > 1 écran ou partageable / revenable (diff, assistant, tableau, formulaire long) → PAGE avec URL (U)
     ├─ outil à lire à côté d'un contenu (canvas, schéma, résultats) → PANNEAU LATÉRAL non bloquant (P)
     ├─ 1 à 3 champs, ou un choix court rattaché à un objet visible → POPOVER ancré (O)
     ├─ formulaire lié à une ligne / section de la page → INLINE : accordéon, ligne éditable, bandeau (I)
     └─ simple information ou résultat → TOAST (réversible : bouton « Annuler »)
```

Interdits : modale **dans** une modale ; modale qui ouvre une 2e modale ; modale pour afficher une
liste ou un tableau ; modale pour un formulaire de plus de 3 champs ; confirmation sur une action
réversible (préférer exécuter puis proposer « Annuler »).

### 3.2 Cible chiffrée

| Indicateur                                                    | Aujourd'hui | Cible fin de phase 5 |
| ------------------------------------------------------------- | :---------: | :------------------: |
| Dialogues modaux distincts                                    |     48      |      **≤ 17**        |
| Dont modales de contenu (`Modal` hors `ConfirmDialog`)        |     37      |      **0**           |
| Modales imbriquées / empilées                                 |     6       |      **0**           |
| `window.confirm/alert/prompt`                                 |     0       |      0 (verrouillé par ESLint) |
| Surfaces à URL (hors `/project/:id/<onglet>`)                 |     0       |      ≥ 19 (voir § 3.3) |
| Parcours J1-J12 traversant ≥ 1 popup de contenu               |    5 / 12   |      **0 / 12**      |

### 3.3 Carte des routes cible

Aujourd'hui seules `/invite/:token`, `/reset-password/:token`, `/project/:id` et
`/project/:id/<data|deployments|history|problems|dictionary>` sont adressables
(`projectRouting.svelte.ts` : `PROJECT_PATH`, `TAB_SEGMENTS`). **L'administration et les paramètres
n'ont pas d'URL** (`adminOpen`, `viewMode` dans `Root.svelte`). Le serveur ne sert `index.html` que
pour les chemins listés dans `apps/server/src/app.ts:243-247` — **chaque nouvelle route doit y être
déclarée**, sinon un rechargement donne un 404.

| Route cible                                   | Remplace | Persona | Phase |
| --------------------------------------------- | -------- | :-----: | :---: |
| `/` (projets)                                 | idem     | tous    | 1     |
| `/new`, `/new/from-database`, `/new/template/:id` | M03, M04 | P2   | 5     |
| `/settings/:section`                          | M26, M27, M29, M32, M35, `SettingsPage` | tous | 1 / 4 |
| `/admin/users`, `/admin/users/:id`            | M22, M24, `UsersTab` | P1 | 4     |
| `/admin/invitations/new`                      | `InvitationsTab` | P1 | 4     |
| `/admin/teams/:id`                            | M23      | P1      | 4     |
| `/admin/connections/:id/(settings\|explorer\|sql\|accounts\|sessions\|health\|backups\|journal)` | M17, console | P1/P4 | 3-4 |
| `/admin/environments`, `/admin/lint/:id`, `/admin/activity`, `/admin/errors` | onglets d'`AdminConsole` | P1 | 4 |
| `/project/:id/deploy`                         | M14      | P2      | 5     |
| `/project/:id/compare`                        | M08      | P2      | 5     |
| `/project/:id/settings/(webhooks\|access)`    | M05, M06 | P2      | 5     |
| `/project/:id/data/seeds/:table`              | M13      | P2      | 5     |
| `/project/:id/data/activity`                  | J8       | P2/P1   | 3     |

### 3.4 Compagnons indispensables au retrait des popups

1. **Annuler plutôt que confirmer** : tout ce qui est réversible s'exécute, puis un toast de 8 s
   propose « Annuler » (`toast.svelte.ts` supporte `action` et 8 s). Cibles immédiates : C07, C11,
   archivage/corbeille d'un projet, libération d'un verrou, retrait d'un groupe.
2. **Palette de commandes (Ctrl+K)** : « aller à… », « donner accès à… », « créer un projet depuis… ».
   Elle absorbe la recherche globale existante (`global-search.e2e.ts`) et rend les URL découvrables.
3. **Fil d'Ariane et retour** : toute page profonde porte un fil (`Administration › Connexions › prod-pg
   › Comptes`) et un « Retour » qui rétablit la position précédente (scroll, filtres).
4. **Brouillon persistant** : un formulaire de page ne perd pas sa saisie au changement de route
   (`sessionStorage`, avec garde `try/catch`).
5. **Garde « modifications non enregistrées »** à la sortie d'une page de formulaire.

---

## 4. Principes de design directeurs (10)

1. **Un écran, une tâche.** Chaque page répond à une intention en une phrase (« Donner accès à Léa »,
   pas « Utilisateurs »). Si on doit y ajouter un onglet pour une 2e intention, c'est une autre page.
2. **La modale est réservée à ce qui est irréversible.** Tout le reste s'affiche dans la page, à côté
   d'elle ou s'exécute avec un « Annuler ». Un seul composant (`ConfirmDialog`).
3. **Tout objet a une adresse.** Une base, un utilisateur, une équipe, un déploiement se partagent
   par lien. Le retour du navigateur est un parcours valide, pas un accident.
4. **Montrer l'effet avant de l'exécuter.** Le SQL qui va partir, le nombre de lignes touchées, le diff
   (déjà le cas de `StatementModal` et du déploiement) : à généraliser comme habitude visuelle
   (« aperçu à droite, action en bas »).
5. **Dire la limite honnêtement.** « Relevé toutes les 5 min », « retour arrière partiel sur MySQL »,
   « compte partagé : seul le filtre Athanor borne vos requêtes » apparaissent là où l'on décide, pas
   dans le guide.
6. **Divulgation progressive.** Les 90 % de cas sont visibles ; l'avancé (URI de connexion, SSH, SSL,
   stratégies de risque, variables) est replié sous « Options avancées », ouvert par mémoire d'usage.
7. **L'état est toujours visible.** Environnement courant (rouge en production), base courante, niveau
   d'accès (lecture / écriture), verrous, mode lecture seule : jamais à deviner, jamais par la seule couleur.
8. **Le rôle façonne l'interface.** On masque ce qu'on ne peut pas faire (au lieu de le griser) et on
   dit comment l'obtenir (« demander l'accès »).
9. **Le contraste d'abord.** Seuils : texte ≥ 4,5:1, texte large et composants d'interface ≥ 3:1,
   en clair **et** en sombre (`styles/tokens.css`, `[data-theme="light"]`). Interdire sous 12 px le texte
   porteur de sens (aujourd'hui 21 occurrences de `text-[10px]`, 2 de `text-[9px]`, 68 de `text-[11px]`).
10. **Le clavier est un citoyen de première classe.** Tout est atteignable sans souris ; les raccourcis
    sont découvrables (palette, info-bulles, panneau « Raccourcis »).

---

## 5. Onboarding, états vides, aide contextuelle, visite guidée

### 5.1 Constat

- `EditorTour.svelte` : 5 étapes, déclenchée à la première ouverture d'un projet, ne bloque rien
  (pas de fond) ; clé `athanordb.tour.editor.seen` en `localStorage` → **par navigateur, pas par
  compte** (un utilisateur qui change de poste revoit la visite). Les sélecteurs sont des classes
  techniques (`.svelte-flow`, `.cm-editor`, `[data-testid="toggle-link-highlight"]`) : fragile en refonte.
  La visite ne couvre ni l'administration ni le SQL.
- `EmptyState.svelte` : 27 utilisations ; la liste des projets affiche seulement un texte
  (`ProjectList.svelte:240`), sans action.
- Aucune aide contextuelle sur les concepts propres au produit (environnement, étape, « protégé »,
  compte partagé vs personnel, « niveau de lint »). `Hint.svelte` existe (utilisé dans
  `StatementModal`) mais n'est pas systématique.

### 5.2 Plan

| Sujet | Décision |
| ----- | -------- |
| **État vide = action** | Chaque `EmptyState` porte un bouton primaire et une phrase de bénéfice. Ex. liste vide : « Aucun projet. [Créer un projet] [Importer un schéma] ». Console sans connexion : « Branchez une base pour déployer. [Ajouter une connexion] ». |
| **Première connexion par rôle** | Bannière non bloquante « Bienvenue » avec **une** checklist de 3 étapes selon le rôle : admin (1. ajouter une connexion, 2. inviter un collègue, 3. définir un environnement) ; modélisateur (1. créer un projet, 2. ajouter une table, 3. connecter une base) ; lecteur (1. ouvrir un projet, 2. commenter). Persistance côté serveur (préférence du compte), pas `localStorage`. |
| **Visite guidée** | Ancrer les étapes sur des attributs `data-tour="…"` stables (plus de classes techniques) ; trois visites courtes (Éditeur, Déploiement, Administration), relançables depuis `?` en en-tête et depuis la palette. Mémorisée par compte. |
| **Aide contextuelle** | Pastille `ⓘ` standard (`Hint`) ouvrant un popover de 2-3 phrases + lien vers la section du guide (`docs/user-guide.md` §…). Priorité : environnement/étape, niveau d'accès aux bases, compte partagé vs personnel, niveau de lint, sauvegarde automatique en production. |
| **Glossaire** | 12 termes figés (§ 8), affichés en info-bulle au premier survol. |
| **Données de démonstration** | Bouton « Explorer avec un exemple » créant un projet modèle (existe : `templateCopy.ts`) sur la page d'accueil vide. |
| **Mesure** | Taux d'achèvement de la checklist, taux de relance de la visite (§ 11). |

---

## 6. Retours d'état : toasts, erreurs, chargements, optimisme

### 6.1 Constat

- **Toasts** : `toast.svelte.ts` (tons info/success/warning/danger, 4 s, 8 s avec action, 4 visibles max).
  27 appels dans `src`. Peu d'écrans utilisent l'action « Annuler ».
- **Erreurs** : `ErrorText.svelte` en bas de modale, `describeApiError` (`i18n/serverErrorMessages.ts`,
  171 lignes). Les erreurs sont **dans la popup** : en passant à des pages, elles ne doivent pas se
  perdre au changement d'étape.
- **Chargements** : `Skeleton.svelte`, `SkeletonCard(Grid).svelte` existent ; `useAsyncResource` /
  `useAsyncAction` (`pending`, `error`) standardisent déjà l'asynchrone.
- **Erreur globale** : `ErrorBoundary.svelte` (interne par projet + externe).

### 6.2 Règles cibles

| Situation | Retour | Détail |
| --------- | ------ | ------ |
| Action réussie sans suite | Toast `success` 4 s | Phrase au passé, objet nommé (« Accès de Léa enregistré »). |
| Action réversible | Toast + « Annuler » 8 s | Corbeille, verrou libéré, ligne initiale retirée, compte accepté comme référence. |
| Action longue (> 1 s) | Bouton en `pending` + libellé progressif | « Analyse du schéma… » ; au-delà de 5 s, barre de progression avec étapes (déploiement, import, sauvegarde). |
| Action très longue / asynchrone | Entrée dans une **file d'activité** (cloche) | Sauvegardes, restaurations, imports de grosses bases : l'utilisateur peut naviguer. |
| Erreur de formulaire | Message **sous le champ** + résumé en haut (`role="alert"`) | Texte actionnable : « Connexion refusée (mot de passe incorrect pour `postgres`). [Modifier les identifiants] ». |
| Erreur serveur inattendue | Bandeau dans la page avec détail repliable + identifiant de corrélation copiable | Lien vers `Administration › Erreurs` pour P1. |
| Perte de réseau / session expirée | Bandeau persistant en haut + conservation du brouillon | Reconnexion sans perdre la saisie. |
| Chargement initial | Squelette de la forme finale | Jamais de page blanche (le `{:else if session === "loading"}` de `App.svelte` rend un cadre vide). |
| Optimisme | Autorisé pour : renommage, couleur, ordre, verrou, commentaire, case à cocher d'accès avant enregistrement groupé | Rollback visible (toast d'erreur + retour à l'état) ; **jamais** pour : déploiement, SQL, suppression de compte, rotation de secret. |

### 6.3 Composants à créer ou renforcer (phase 0)

`Toast` avec file « Annuler » généralisée (`undoable(fn, undoFn, label)`), `InlineAlert`
(info/avertissement/erreur avec action), `ProgressSteps`, `LiveRegion` (annonces lecteur d'écran),
règle de journalisation des erreurs côté client (déjà via `ErrorBoundary`, étendre aux actions asynchrones).

---

## 7. Responsive, mobile et accessibilité

### 7.1 Constat (code)

- Responsive : 60 occurrences de préfixes `sm:` `md:` `lg:` `xl:` dans `.svelte` seulement ; la
  console admin impose `max-w-[1240px]` / `880px` ; le canvas (`@xyflow/svelte`, `.svelte-flow`) et
  l'éditeur DBML (CodeMirror, `.cm-editor`) ne sont pas conçus pour le tactile
  (`etat-des-features.md` § 11 : « Refonte visuelle, accessibilité, mobile » ❌).
- Mouvement : **3** occurrences de `prefers-reduced-motion` / `motion-reduce` dans `src`
  (`styles/animations.css`, …) — couverture partielle.
- ARIA : 329 attributs `aria-*` dans les `.svelte`. `Modal.svelte` gère focus, piège et Échap
  (6 fichiers utilisent `useEscapeKey`). `AdminConsole.svelte` fabrique ses onglets avec des
  `<button>` sans `role="tablist"` / `aria-selected` (alors que `Tabs.svelte` existe) ; `EditorTour`
  repose sur un `role="dialog"` non modal.
- Thèmes : `styles/tokens.css` (sombre par défaut, clair par `[data-theme="light"]`).
- Tailles de texte : beaucoup de `text-[10px]`/`[11px]` (§ 4, principe 9).

### 7.2 Objectifs

| Zone | Mobile (< 640 px) | Tablette (640-1024 px) | Bureau (> 1024 px) |
| ---- | ----------------- | ---------------------- | ------------------ |
| Liste des projets | Liste en une colonne, actions dans un menu | 2 colonnes | Grille |
| Administration | **Complète**, navigation en liste puis détail (pas de tableau large) | Navigation latérale repliable | Navigation latérale + contenu |
| Paramètres | Complète | Complète | Complète |
| Déploiement (`/deploy`) | Complète en lecture + confirmation | Complète | Complète |
| SQL | Lecture seule + saisie | Complète | Complète + tiroir |
| Canvas / DBML | **Consultation uniquement** (zoom, panoramique, lecture des tables, commentaires) ; édition réservée à ≥ 1024 px avec message explicite | Édition au stylet/souris | Complète |

Décision : **ne pas promettre l'édition du canvas sur téléphone**. Priorité mobile = P1 en
déplacement (inviter, désactiver un compte, voir l'activité) et P5 (lire, commenter).

### 7.3 Exigences d'accessibilité (WCAG 2.1 AA, vérifiables)

| Exigence | Règle | Vérification |
| -------- | ----- | ------------ |
| Contraste | 4,5:1 (texte), 3:1 (grand texte, bordures de champ, icônes porteuses de sens) clair et sombre | Script sur `tokens.css` + axe |
| Cibles | ≥ 24×24 px (AA 2.2), 44×44 px sur tactile | Revue visuelle + règle Tailwind |
| Clavier | Tout est atteignable ; ordre logique ; **aucun piège** hors `ConfirmDialog` | Parcours e2e au clavier (J1, J4, J6, J10) |
| Focus visible | Anneau ≥ 2 px, contraste 3:1, jamais supprimé | axe + test |
| Rôles | `Tabs.svelte` partout (retirer les `<button>` d'onglets artisanaux) ; `role="alert"` pour les erreurs ; `aria-live="polite"` pour les toasts | axe |
| Panneaux latéraux | `role="complementary"` ou `region` + `aria-labelledby`, Échap les ferme et rend le focus, pas de piège | test |
| Pages | `<h1>` unique, titre de document mis à jour à chaque route, saut de contenu (« Aller au contenu ») | test |
| Mouvement | `prefers-reduced-motion` : désactive transitions du canvas, des panneaux, de la visite, du pill animé (`AnimatedToolbarPill.svelte`) | test + revue |
| Couleur seule | Jamais seule : environnement de production = rouge **et** libellé « PROD » ; erreur = icône + texte | revue |
| Canvas | Navigation clavier entre tables (flèches), liste textuelle équivalente (dictionnaire) | spécification en phase 2 |
| Lecteur d'écran | Noms accessibles pour les boutons icône (aujourd'hui `data-tooltip` : vérifier qu'`aria-label` est posé) | axe |

Outillage : `@axe-core/playwright` dans le harnais e2e (une vérification par page cible, en phase 6
pour verrouiller), test de contraste dérivé de `tokens.css`.

---

## 8. Internationalisation fr/en

### 8.1 Constat

- `locales/fr.json` et `locales/en.json` : **1 949 lignes chacun** (parité vérifiée par
  `i18n/localeParity.ts`) ; clés typées (`TranslationKeyOf`). Les libellés sont déjà tous externalisés
  (pas de chaînes en dur observées dans les composants audités).
- Les clés suivent la fonctionnalité (`admin.deleteUser.title`, `dbAccess.userTitle`, …). Les
  titres de modales sont des clés `*.title` qui **disparaîtront ou deviendront des titres de page**.

### 8.2 Impact de la refonte

| Changement | Impact | Action |
| ---------- | ------ | ------ |
| 37 modales → pages / panneaux / inline | Les titres `*.title` deviennent `h1` ; les verbes de bouton changent (« Créer », « Enregistrer ») | Charte « Verbe + objet » (« Supprimer le projet », pas « OK »), jeu de 12 termes figés |
| Terminologie incohérente (vérifiée dans la doc : « équipes » vs « groupes », « connexion » vs « base », « étape » vs « environnement ») | Une même chose avec 2-3 noms | **Glossaire FR/EN validé par le propriétaire** (Q6) avant la phase 4 |
| Messages d'erreur réécrits (actionnables) | ~170 lignes de `serverErrorMessages.ts` à reprendre | Passe de réécriture avec le design |
| Palette de commandes, état vides, checklist | ~120 nouvelles clés | Créer en fr puis en, parité imposée en CI |
| Longueur : l'anglais est ~15 % plus court, le français plus long | Boutons et colonnes étroits (tables admin) | Largeurs flexibles, tests visuels dans les deux langues |
| Pluriels, dates relatives (`formatters.ts`) | Déjà gérés | Étendre aux nouveaux textes (« 2 changements ») |
| Docs liées (`user-guide.md`) | Captures et chemins de menu à jour | Mise à jour en phase 6 |

Règle de contrôle qualité : aucune clé orpheline ni manquante (`localeParity`), relecture FR par le
propriétaire, relecture EN en fin de phase 6.

---

## 9. Feuille de route globale

### 9.1 Phases

Principe : **ne jamais casser le chemin existant** ; chaque phase livre quelque chose d'utilisable et
de testé. Les nouvelles surfaces (routes, panneaux) sont ajoutées **à côté** des modales, qui ne sont
supprimées qu'à la fin (phase 5), une fois le flag basculé et la recette passée.

| Phase | Nom | Objectif | Livrables | Dépend de |
| :---: | --- | -------- | --------- | --------- |
| **0** | Fondations | Tokens, composants, outils, filets de sécurité | Tokens contraste (clair/sombre), échelle typographique (plancher 12 px), composants : `SidePanel`, `PageHeader`, `InlineConfirm`, `PopoverForm`, `InlineAlert`, `UndoToast`, `Tabs` avec ARIA, `Breadcrumb` ; routeur typé étendu ; fallback serveur `app.ts` ; flags ; ESLint (`no-alert`) ; `data-testid` stables ; axe dans le harnais ; catalogue (`ComponentCatalogue`) mis à jour | rien |
| **1** | Navigation | Coque unique, routes, palette | Nouvelle coque (en-tête + navigation latérale repliable), `/settings/*`, `/admin/*` adressables (sans changer le contenu), palette Ctrl+K, fil d'Ariane, suppression de `SettingsModal` (M27) | 0 |
| **2** | Canvas | Édition sans modale ni surcharge | Barre d'outils simplifiée, éditeur de colonne en ligne, panneau droit contextuel (propriétés + commentaires), panneaux `ConvertTypes` (M07) / `Import` (M10), popovers verrous (M11, M12) et export (M09), bandeau de dérive amélioré, mode lecture | 0 (1 pour le panneau droit global) |
| **3** | Espace SQL / Données | Un seul espace « Données » | Onglet `Données` refondu : explorateur, SQL, comptes, sessions, santé, sauvegardes, journal en sections adressables ; tiroir SQL amélioré ; Activité hors Athanor (J8) ; remplacement de `StatementModal` par aperçu inline + `ConfirmDialog` ; `StructureRedirectDialog` inline | 1 |
| **4** | Administration | Pages utilisateur, équipe, connexion, invitation | `/admin/users/:id`, `/admin/teams/:id`, `/admin/connections/:id`, `/admin/invitations/new`, lint, environnements, activité ; M17, M20-M24 retirés ; Paramètres complets (M15, M26, M29, M32, M35, M36) | 1, 3 pour les connexions |
| **5** | Projets et déploiement | Parcours de création et de mise en production | `/new/*` (M03, M04), `/project/:id/deploy` (M14), compare (M08), settings webhooks/accès (M05, M06), seeds (M13), restauration (M34), inline (M02, M33, M37), conversion des 7 modales « question » vers `ConfirmDialog` ; suppression des anciennes modales ; règle ESLint `no-restricted-imports` | 0, 1 ; 4 pour le sélecteur de connexions |
| **6** | Polissage | Accessibilité, mobile, i18n, perf | Passe WCAG (axe sur toutes les pages cibles), `prefers-reduced-motion` complet, responsive mobile P1/P5, glossaire et réécriture des messages, relecture EN, visite guidée rénovée, documentation | 1-5 |
| **R** | Recette et stabilisation | Validation avec le propriétaire | Recettes de fin de phase (§ 9.7), correctifs, retrait des flags | continue |

### 9.2 Dépendances et parallélisation

```text
        ┌─────────────┐
        │ 0 Fondations │──────────────────────────────┐
        └──────┬───────┘                              │
               ▼                                      ▼
        ┌────────────┐    ┌──────────────┐    ┌──────────────┐
        │ 1 Navigation│──► │ 3 SQL/Données│──► │ 4 Administration│
        └─────┬──────┘    └──────────────┘    └──────┬───────┘
              │      ┌───────────┐                    │
              └────► │ 2 Canvas  │ (indépendant)      │
                     └─────┬─────┘                    ▼
                           └────────────────► ┌──────────────┐
                                              │ 5 Projets &   │
                                              │   Déploiement │
                                              └──────┬───────┘
                                                     ▼
                                              ┌──────────────┐
                                              │ 6 Polissage  │ → R
                                              └──────────────┘
```

Répartition proposée pour **3 développeurs** (A, B, C) :

| Semaines | A (navigation / admin) | B (canvas / éditeur) | C (SQL / déploiement) |
| -------- | ---------------------- | -------------------- | --------------------- |
| 1-3      | Phase 0 : tokens, `SidePanel`, `PageHeader`, routeur | Phase 0 : composants d'inputs, ARIA `Tabs`, `data-testid` | Phase 0 : harnais e2e, axe, ESLint, flags |
| 4-7      | Phase 1 : coque, routes, palette | Phase 2 : barre d'outils, éditeur en ligne | Phase 3 : espace Données (ré-usage de `DbConsole`) |
| 8-11     | Phase 4 : utilisateurs, équipes, invitations | Phase 2 : panneaux, popovers, lecture | Phase 3 : Activité, aperçu inline, tiroir SQL |
| 12-15    | Phase 4 : connexions, lint, paramètres | Phase 5 : seeds, compare, restauration | Phase 5 : `/new`, `/deploy` |
| 16-17    | Phase 6 : mobile, i18n | Phase 6 : accessibilité canvas | Phase 6 : perf, axe, e2e finaux |
| 18       | R : recette et stabilisation (tous) | | |

Avec **1 développeur**, tout est séquentiel : durée ≈ somme des semaines-développeur (§ 10), soit
~7 mois. Avec **2**, ~3,5 mois (fusionner B et C). L'ordre minimal imposé : 0 → 1 → (2 ‖ 3) → 4 → 5 → 6.

### 9.3 Jalons livrables

| Jalon | Contenu | Critère de sortie |
| ----- | ------- | ----------------- |
| **M0 — Fondations** | Composants et tokens dans le catalogue, `/ui` accessible, CI inchangée verte | Contrastes ≥ AA mesurés, `component-catalogue.e2e.ts` à jour |
| **M1 — Coque** | Navigation, `/admin/*`, `/settings/*`, palette | URL partageables ; 0 régression des 41 tests e2e (anciens chemins encore valides) |
| **M2 — Canvas** | Édition sans modale, panneaux | J3 mesuré ≤ 9 clics |
| **M3 — Données** | Espace Données unifié + Activité hors Athanor | J8 en 3 clics ; J9 inchangé |
| **M4 — Administration** | Fiches utilisateur/équipe/connexion | J6, J7, J10 sans popup de contenu |
| **M5 — Création et déploiement** | `/new`, `/deploy`, suppression des anciennes modales | Dialogues ≤ 17 ; J1, J4 conformes |
| **M6 — AA + mobile** | Audit axe vert, responsive P1/P5 | 0 violation axe « serious/critical » sur les pages cibles |
| **MR — Recette** | Validation propriétaire | PV de recette signé (§ 9.7) |

### 9.4 Coexistence ancien / nouveau et feature flags

Principe : **le strangler par route**. Les nouvelles surfaces sont des routes et des composants
nouveaux ; l'ancien chemin (modale) reste fonctionnel tant que le drapeau est éteint. Ainsi les
tests existants continuent de tourner.

| Mécanisme | Détail |
| --------- | ------ |
| Drapeau par surface | `ui.v2.nav`, `ui.v2.admin`, `ui.v2.projects`, `ui.v2.deploy`, `ui.v2.canvas`, `ui.v2.data`. Lu par un module `flags.ts` : variable d'environnement serveur `ATHANOR_UI_V2=<liste>` (défaut par instance) **+** surcharge par utilisateur dans les Paramètres (`Aperçu de la nouvelle interface`) **+** `?ui=v2` en URL pour les tests. |
| Points d'entrée | Seuls les **déclencheurs** (boutons, liens) testent le drapeau : `onclick={flags.deploy ? goto('/project/42/deploy') : () => showDeployment = true}`. Les deux implémentations coexistent, aucune n'appelle l'autre. |
| Routes serveur | Déclarées dès la phase 0 (`app.ts`), derrière le même SPA : aucun risque si le drapeau est éteint. |
| Données | Aucune migration : la refonte ne change **pas** le modèle de données ni l'API (hors préférences d'onboarding par compte et, éventuellement, un endpoint d'activité unifiée, J8). |
| Retrait | Un drapeau est supprimé quand : recette signée **et** une version publiée avec le drapeau activé par défaut. Le code ancien est supprimé dans la phase suivante. |
| Coût | Duplication transitoire (~15 % de code en plus pendant les phases 1-5). Limite : pas plus de 2 drapeaux « actifs par défaut » en même temps. |

### 9.5 Stratégie de tests

Constat : **38 fichiers** `apps/web/e2e/*.e2e.ts` (+ `harness.ts`, 180 l.), ~5 700 lignes au total
(avec le harnais), 41 tests selon `etat-des-features.md`, 16 tests unitaires (`*.test.ts`) dans
`apps/web/src`. Le harnais (`harness.ts`) fournit les fixtures ; les tests identifient souvent
les fenêtres par `dialog`/`modal` (ex. `deployment-risks` 18 références, `seeds` 20, `webhook-options`
19, `pipeline` 19, `personal-accounts` 13).

Stratégie :

1. **Phase 0 — stabiliser avant de migrer** : introduire des `data-testid` sémantiques
   (`deploy-step-risks`, `user-access-save`), un *page-object* léger par surface dans `harness.ts`
   (`openDeploy()`, `openUser(email)`), et remplacer les sélecteurs sur le rôle `dialog` par ces
   points d'entrée. Les tests ne dépendent plus de la **forme** (modale ou page).
2. **Dupliquer, puis basculer** : pendant la coexistence, chaque test concerné tourne deux fois
   (`flags off` / `flags on`) via un paramètre Playwright (`use: { uiVersion }`). On ne garde que
   la variante « on » après retrait du drapeau.
3. **Nouveaux tests de parcours** : un test e2e par parcours J1-J12 (≈ 12 tests, 0,5 j chacun), qui
   comptent les clics (via helper `countedClicks`) et vérifient l'absence de modale de contenu.
4. **Accessibilité** : `@axe-core/playwright` appelé sur chaque page cible (une passe, pas par test) ;
   un test de contraste lit `tokens.css`.
5. **Non-régression visuelle** : captures Playwright des 10 pages clés, en clair/sombre et fr/en
   (suivi, non bloquant en phases 1-4, bloquant en 6).
6. **Tests unitaires** : routeur (`projectRouting`, nouvelles routes), `flags.ts`, composants `SidePanel`
   et `InlineConfirm` (comportement clavier).
7. **Tests sur vraies bases** (Docker) : **inchangés** — la refonte ne touche pas au serveur.

#### Fichiers e2e concernés et effort

Effort en jours-développeur (réécriture de sélecteurs + adaptation au nouveau parcours + double
exécution), hypothèse ±30 %.

| Fichier `apps/web/e2e/` | Lignes | Surface touchée | Impact | Phase | Effort (j) |
| ----------------------- | :----: | --------------- | :----: | :---: | :--------: |
| `activity.e2e.ts` | 111 | Admin › Activité (route) | M | 4 | 0,5 |
| `backups.e2e.ts` | 157 | M33, M34, C04 | H | 5 | 1 |
| `canvas-clipboard.e2e.ts` | 205 | Canvas (sélecteurs) | M | 2 | 0,5 |
| `canvas-interactions.e2e.ts` | 106 | Canvas, barre d'outils | H | 2 | 1 |
| `comment-mentions.e2e.ts` | 164 | Panneau de commentaires | L | 2 | 0,25 |
| `compare-environments.e2e.ts` | 116 | Carte de comparaison (Déploiements) | M | 5 | 0,5 |
| `compare-projects.e2e.ts` | 82 | M08 → page | H | 5 | 0,5 |
| `component-catalogue.e2e.ts` | 329 | Catalogue (3 tests) : refait avec les nouveaux composants | H | 0 | 1 |
| `connection-form.e2e.ts` | 367 | M04, M17, `ConnectionFormFields` | H | 4-5 | 1,5 |
| `connection-journal.e2e.ts` | 130 | Journal d'une base | M | 3 | 0,5 |
| `db-access.e2e.ts` | 147 | M24, invitation | H | 4 | 1 |
| `db-admin.e2e.ts` | 125 | Console, `StatementModal` | H | 3 | 1 |
| `dbml-editing.e2e.ts` | 162 | Éditeur DBML (mise en page) | L | 2 | 0,25 |
| `deployment-risks.e2e.ts` | 109 | M14 (18 réf.) | H | 5 | 1,5 |
| `dictionary.e2e.ts` | 149 | Onglet Dictionnaire | L | 1 | 0,25 |
| `environments.e2e.ts` | 141 | Admin › Environnements, C02 | M | 4 | 0,75 |
| `global-search.e2e.ts` | 51 | Recherche → palette | M | 1 | 0,5 |
| `history.e2e.ts` | 159 | Onglet Historique | M | 2 | 0,5 |
| `lint.e2e.ts` | 159 | Problèmes | L | 2 | 0,25 |
| `lint-presets.e2e.ts` | 120 | M20, M21, C03 | M | 4 | 0,5 |
| `monitoring.e2e.ts` | 94 | C11, MonitoringCard | M | 3 | 0,5 |
| `notifications.e2e.ts` | 152 | Cloche (popover) | L | 1 | 0,25 |
| `onboarding.e2e.ts` | 100 | Visite guidée, EmptyState | H | 6 | 0,75 |
| `password-reset.e2e.ts` | 71 | Hors périmètre (flux auth) | — | — | 0 |
| `personal-accounts.e2e.ts` | 153 | M15 (13 réf.) | H | 4 | 1 |
| `pipeline.e2e.ts` | 159 | M14, C05 (19 réf.) | H | 5 | 1,5 |
| `plugin-sandbox.e2e.ts` | 101 | M35 / M36 | M | 4 | 0,5 |
| `plugins-locks.e2e.ts` | 309 | M35, M11, M12 | H | 2 / 4 | 1,5 |
| `project-lifecycle.e2e.ts` | 81 | M01, M02, corbeille | M | 5 | 0,5 |
| `project-templates.e2e.ts` | 47 | M03 → `/new` | H | 5 | 0,5 |
| `seed-from-database.e2e.ts` | 126 | M13 (reprise depuis la base) | H | 5 | 1 |
| `seeds.e2e.ts` | 147 | M13, C07 (20 réf.) | H | 5 | 1,5 |
| `structure-policy.e2e.ts` | 191 | C09, C10, M37 | H | 3 | 1 |
| `table-locks.e2e.ts` | 201 | M11, M12 | H | 2 | 1 |
| `variables.e2e.ts` | 102 | Variables d'environnement | L | 4 | 0,25 |
| `webhook-options.e2e.ts` | 132 | M05 (19 réf.), C08 | H | 5 | 1,5 |
| `webhooks.e2e.ts` | 78 | M05 | M | 5 | 0,5 |
| `workspace.e2e.ts` | 184 | Onglets, navigation | H | 1 | 1 |
| **Sous-total adaptation** | | | | | **≈ 28,5** |
| `harness.ts` (page-objects, `uiVersion`) | 180 | Phase 0 | — | 0 | 1 |
| Nouveaux tests J1-J12 | — | 12 × 0,5 j | — | 1-6 | 6 |
| **Total e2e** | | | | | **≈ 35,5 j ≈ 7 semaines-dev** |

Cet effort est **inclus** dans les estimations par phase (§ 10), pas ajouté.

### 9.6 Mesures de succès

| Indicateur | Aujourd'hui | Cible | Comment mesurer |
| ---------- | :---------: | :---: | --------------- |
| Dialogues modaux distincts | 48 | ≤ 17 | `grep` automatisé (script CI) sur `<Modal`, `<ConfirmDialog` |
| `Modal` direct dans `features/` | 37 | 0 | ESLint `no-restricted-imports` |
| Parcours J1-J12 sans popup de contenu | 5 / 12 | 12 / 12 | Tests e2e de parcours |
| Clics totaux J1, J4, J6, J8, J10 (somme) | ≈ 27-33 | ≤ 18 | Helper `countedClicks` dans les tests de parcours |
| Contraste texte (clair et sombre) | non mesuré | 100 % ≥ 4,5:1, composants ≥ 3:1 | Script sur `tokens.css` + axe |
| Violations axe « serious/critical » | non mesuré | 0 sur les pages cibles | `@axe-core/playwright` |
| Texte porteur de sens < 12 px | ≈ 120 occurrences | 0 | `grep text-\[(9|10|11)` |
| Temps pour accomplir J1, J4, J6, J10 (premier essai) | non mesuré | -40 % vs ancienne UI | Test utilisateur chronométré, 5 personnes/persona |
| Taux de réussite sans aide, premier essai | non mesuré | ≥ 85 % | Même test |
| Satisfaction (SUS) | non mesuré | ≥ 75 | Questionnaire en recette |
| Taux d'achèvement de la checklist de bienvenue | — | ≥ 60 % | Évènement serveur |
| Pages avec URL pour les objets du § 3.3 | 5 | ≥ 19 | Revue des routes |

Les valeurs « non mesuré » doivent être **relevées avant la phase 1** (base de référence) : c'est le
seul moyen d'affirmer un gain à la fin.

### 9.7 Plan de recette avec le propriétaire

| Étape | Quand | Format | Contenu | Décision attendue |
| ----- | ----- | ------ | ------- | ----------------- |
| **R0 — Cadrage** | Avant la phase 0 | 1 h | Valider ce document, le glossaire (Q6), les 12 parcours, la liste des 17 confirmations conservées | Go / ajustements |
| **R1 — Revue de maquettes** | Fin des semaines 3 et 7 | 45 min | Maquettes des écrans-clés (liste, `/new`, fiche utilisateur, `/deploy`) | Go par écran |
| **R2 — Recette de jalon** | Fin de chaque jalon M1-M5 | 1 h + scénarios | Le propriétaire déroule les parcours concernés sur l'**instance de démonstration** avec le drapeau activé | Valider / rejeter par parcours (critère de sortie du jalon) |
| **R3 — Test chronométré** | Après M4 | 2 h | Parcours J1, J4, J6, J10 chronométrés avec 3-5 personnes (une par persona) | Mesure du gain (§ 9.6) |
| **R4 — Recette finale** | Fin de phase 6 | ½ journée | Les 12 parcours + vérification de la liste des fonctionnalités marquées 🧪 (voir ci-dessous) | PV signé, retrait des drapeaux |

Fonctionnalités marquées « à tester » (🧪) dans `etat-des-features.md` qui profitent de la refonte pour
passer enfin à l'essai **à la main** : assistant de déploiement (§ 4), invitation enrichie (§ 5), console
Utilisateurs (§ 6), Mes comptes SQL (§ 6), SQL non-administrateur (§ 7), surveillance des comptes (§ 10),
écran de conversion de types (§ 1). La recette R2/R4 sert à cocher ces cases.

---

## 10. Estimation globale en semaines-développeur

Hypothèse : développeur confirmé Svelte 5 / Tailwind connaissant le dépôt, tests e2e inclus
(§ 9.5), revue de code incluse, hors attente de décisions du propriétaire.

| Phase | Contenu principal | Dév. (sem.) | e2e inclus (j) | Incertitude |
| :---: | ----------------- | :---------: | :------------: | :---------: |
| 0 | Tokens, 9 composants, routeur, flags, harnais, ESLint, axe | **3,0** | 2 | ±20 % |
| 1 | Coque, routes `/admin` `/settings`, palette, fil d'Ariane, suppression M27 | **4,0** | 3 | ±25 % |
| 2 | Canvas : barre d'outils, éditeur en ligne, panneaux, popovers, mode lecture | **5,0** | 5 | ±35 % (le canvas est le plus fragile) |
| 3 | Espace Données : sections adressables, Activité hors Athanor, aperçu inline | **4,0** | 3,5 | ±30 % |
| 4 | Administration + Paramètres : fiches, invitations, lint, environnements | **6,0** | 6,5 | ±25 % |
| 5 | `/new`, `/deploy`, compare, seeds, webhooks, sauvegardes, conversion des confirmations | **6,0** | 11 | ±35 % (`DeploymentModal` + seeds = 785 lignes à reprendre) |
| 6 | Accessibilité, mobile, i18n, visite guidée, doc | **4,0** | 3 | ±30 % |
| R | Recette, correctifs, retrait des flags | **2,0** | 1,5 | ±30 % |
| **Total** | | **34,0 sem.-dév.** | 35,5 j | **±25 %** → 26 à 43 |

Durée calendaire : **1 dev ≈ 8 mois** (34 sem.), **2 devs ≈ 4,5 mois**, **3 devs ≈ 18 semaines (≈ 4 mois)**
(parallélisation du § 9.2, avec l'effet de coordination des phases 0 et 6). Les chiffres excluent la
conception visuelle détaillée (maquettes), traitée par les sections de design.

Ordre de priorité si le budget est contraint (valeur / coût) :
1. **Phases 0 + 1 + 4 (J6, J7, J10) + 5 (`/deploy`)** : ≈ 19 sem. — couvrent les parcours les plus
   critiques et la plus grosse part des popups de contenu (M14, M17, M23, M24, M27 = 5 des plus gros).
2. Phase 3 (Données) : ≈ 4 sem.
3. Phase 2 (canvas) : ≈ 5 sem. — à faire en dernier, car aucun dialogue lourd n'y reste (7 petits).
4. Phase 6 : ≈ 4 sem. — non négociable pour l'accessibilité (l'objectif « meilleurs contrastes »
   se joue en phase 0 et se vérifie en 6).

---

## 11. Plan de mise en œuvre immédiat (première itération)

1. Valider ce document (R0). Décider les questions Q1-Q4 (§ 15) : elles bloquent le routeur et les rôles.
2. Relever la base de référence (§ 9.6) : chronométrer J1, J4, J6, J10 sur l'UI actuelle, lancer axe
   sur les 10 écrans, compter `text-[<12px]`.
3. Phase 0, semaine 1 : branche `refonte-ui`, module `flags.ts`, déclaration des routes dans
   `apps/server/src/app.ts` (`/admin/*`, `/settings/*`, `/new*`), `data-testid` + page-objects dans
   `harness.ts`, ESLint `no-alert`.
4. Phase 0, semaines 2-3 : tokens de contraste et composants du § 1.5, mise à jour du
   `ComponentCatalogue.svelte` et de `component-catalogue.e2e.ts`.
5. Première livraison visible (fin semaine 7) : coque + `/settings` + `/admin` adressables + palette.

---

## 12. Risques

| # | Risque | Prob. | Impact | Parade |
| - | ------ | :---: | :----: | ------ |
| R1 | **Régression silencieuse en coexistence** : deux implémentations d'un même parcours divergent | M | H | Double exécution e2e, déclencheurs seuls testent le drapeau, retrait rapide |
| R2 | **Routage artisanal** (regex dans `projectRouting.svelte.ts`) devient ingérable avec ~20 routes | H | M | Table de routes typée en phase 0 (ou adoption d'un routeur léger) ; test unitaire de chaque route |
| R3 | **404 au rechargement** : `app.ts` ne répond `index.html` que pour une liste explicite de chemins | H | M | Remplacer la liste par un repli générique `notFound → index.html` hors `/api` ; vérifier le proxy inverse (`/api/admin` est déjà filtré, voir `etat-des-features.md`) |
| R4 | **Sous-estimation du canvas** (xyflow, DBML synchronisé, collaboration temps réel) | M | H | Phase 2 isolée, jalon avec revue de prototype avant engagement, budget +35 % |
| R5 | **Sécurité** : en passant le SQL/admin en pages, un lien profond expose des écrans à des utilisateurs non autorisés | M | H | Contrôle de rôle côté serveur déjà en place ; garde de route côté client avec message « accès refusé » ; test e2e de chaque route par rôle |
| R6 | **Perte du patron de sécurité « aperçu SQL puis exécuter »** en retirant `StatementModal` | M | H | Tests `db-admin` et `structure-policy` conservés ; aperçu inline obligatoire |
| R7 | **Fatigue de changement** pour les habitués (admin sans URL qui se retrouve avec une navigation) | M | M | Option « ancienne interface » pendant 2 versions ; notes de version ; visite guidée |
| R8 | Fonctionnalités **jamais testées à la main** (🧪) refondues avant d'avoir été éprouvées | H | M | Recette R2 les teste à la main ; ne pas refondre en profondeur ce qui n'a jamais servi (Oracle, SMTP) |
| R9 | **Dette de traduction** (clés orphelines, longueurs) | M | L | Parité en CI, relecture EN en phase 6 |
| R10 | **Lecteurs d'écran** et canvas : aucun standard, risque de promesse non tenue | M | M | Équivalent texte (dictionnaire) et clavier défini avant d'annoncer « accessible » |
| R11 | Plugins : `PluginManagerDialog` + sandbox (`plugin-sandbox.e2e.ts`) dépendent de l'API d'ouverture de dialogue | L | M | Vérifier si les plugins ouvrent des fenêtres via une API publique avant de supprimer `Modal` |
| R12 | Estimation : dépassement dû à `DeploymentModal` (366 l.) et `SeedDialog` (419 l.) | M | M | Découper en sous-composants avant migration (déjà partiellement : `deployment/Deployment*Step.svelte`) |

---

## 13. Ce que cette refonte ne fait pas

- Ne change ni l'API serveur, ni le modèle de données, ni les moteurs pris en charge.
- Ne livre pas le projet racine et ses déclinaisons (`etat-des-features.md` § 2, ❌) ni le conseiller
  de requêtes/IA : l'interface en réserve la place (page `Projet › Variantes`, section « Conseils »)
  sans la remplir.
- Ne promet pas l'édition du canvas sur téléphone (§ 7.2).
- Ne remplace pas la revue de sécurité indépendante ni la relecture juridique, toujours dues avant
  usage réel.

---

## 14. Annexe — correspondance dialogues / phases

| Phase | Dialogues retirés ou transformés |
| :---: | -------------------------------- |
| 1 | M27 (S) |
| 2 | M07 (P), M09 (O), M10 (P), M11 (O), M12 (O) ; C06 enrichie |
| 3 | M18 (K, nouvelle forme), M37 (I) ; C09, C10 conservées |
| 4 | M15, M17, M20, M21, M22, M23, M24, M26, M29, M32, M35, M36 ; C01-C03 reprises sur `ConfirmDialog` unifié |
| 5 | M01, M02, M03, M04, M05, M06, M08, M13, M14, M16, M19, M25, M28, M30, M31, M33, M34 ; C05, C07, C08, C11 |
| **Total** | 48 dialogues traités ; 17 restent en K |

---

## 15. Questions ouvertes pour le propriétaire

Les questions **Q1-Q4 bloquent** le démarrage de la phase 1 ; les autres peuvent se décider en cours.

| Id | Question | Pourquoi c'est important | Ma recommandation |
| -- | -------- | ------------------------ | ----------------- |
| **Q1** | Accepte-t-on que « Nouveau projet » ne crée plus immédiatement un schéma vide, mais ouvre la page `/new` (un clic de plus pour le cas le plus court) ? | Impact sur J2 et sur l'habitude des modélisateurs | Oui : on évite les projets vides accidentels, et un raccourci « Vide » reste en première carte |
| **Q2** | Garde-t-on un routeur artisanal étendu (aucune dépendance) ou adopte-t-on une bibliothèque ? | R2, taille du bundle, effort phase 0 | Étendre l'existant (table de routes typée) : ~200 lignes, pas de dépendance |
| **Q3** | L'administration devient-elle une zone séparée (`/admin`) ou une section de la même coque ? | Structure de la navigation (phase 1) | Même coque, section « Administration » visible seulement des administrateurs d'instance |
| **Q4** | Faut-il un rôle **DBA** distinct d'« administrateur d'instance » (accès à la console de base sans gérer les comptes Athanor) ? | Aujourd'hui la console est réservée à l'admin d'instance (`etat-des-features.md` § 5, rôle intermédiaire ❌) ; la refonte doit prévoir la place | Décider avant la phase 3 ; l'interface prévoit les deux sans rien construire |
| **Q5** | Quelles étapes de la visite guidée sont indispensables, et sur quels rôles ? | Phase 6 | Trois visites courtes (Éditeur, Déploiement, Administration) |
| **Q6** | Valider le glossaire FR/EN : « équipe » ou « groupe » ? « connexion » ou « base » ? « étape » ou « environnement » ? | Cohérence de tous les libellés (§ 8) | Équipe, connexion, environnement (étape = position dans le pipeline) |
| **Q7** | Le thème sombre reste-t-il le thème par défaut ? | Contraste : les deux thèmes doivent atteindre AA ; effort doublé si on les garde tous deux | Garder les deux, sombre par défaut, clair vérifié en phase 6 |
| **Q8** | Niveau d'ambition mobile : P1/P5 uniquement, ou parité complète ? | Phase 6, ~+4 sem. pour la parité | P1 et P5 uniquement, canvas en consultation |
| **Q9** | Pour la **retape du nom** en production : maintenir pour tout déploiement, ou seulement les risques élevés ? | `DeploymentModal` l'exige déjà (`requireText`), SQL en écriture non | Maintenir déploiement ; conserver l'absence de retape pour l'écriture SQL (décision déjà prise, `etat-des-features.md` « Décisions par défaut ») |
| **Q10** | La suppression définitive d'un projet doit-elle exiger la retape du nom ? (M01 : non aujourd'hui) | Cohérence des confirmations | Oui |
| **Q11** | Rétention de l'« ancienne interface » : combien de versions ? | Coût de coexistence (§ 9.4) | 2 versions mineures après l'activation par défaut |
| **Q12** | Budget et équipe : combien de développeurs, quelle date cible ? | Détermine le séquencement du § 9.2 | À fixer en R0 ; je recommande 3 développeurs, ~18 semaines |
| **Q13** | Faut-il mesurer l'usage (évènements d'onboarding, parcours) ou tout se fait en recette manuelle ? | Mesures de succès | Mesures minimales côté serveur (checklist, relance de la visite), sans suivi nominatif |
| **Q14** | L'interface doit-elle masquer ou griser les fonctions non permises ? | Principe 8 | Masquer, avec un lien « demander l'accès » |

---

## 16. Annexe — Références de code citées

| Sujet | Fichier |
| ----- | ------- |
| Coque modale, piège à focus | `apps/web/src/components/overlays/Modal.svelte` |
| Confirmation standard | `apps/web/src/components/overlays/ConfirmDialog.svelte` |
| Toasts | `apps/web/src/components/overlays/ToastHost.svelte`, `apps/web/src/components/ui/toast.svelte.ts` |
| Popover, menus, onglets | `apps/web/src/components/ui/Popover.svelte`, `Menu.svelte`, `Tabs.svelte`, `EmptyState.svelte`, `Hint.svelte`, `Skeleton*.svelte` |
| Routage | `apps/web/src/features/projects/projectRouting.svelte.ts`, `apps/web/src/app/App.svelte`, `Root.svelte` |
| Repli SPA serveur | `apps/server/src/app.ts:237-247` |
| Console admin | `apps/web/src/features/admin/AdminConsole.svelte` (8 sections : invitations, équipes, utilisateurs, activité, erreurs, connexions, environnements, lint) |
| Console base | `apps/web/src/features/admin/connections/DbConsole.svelte` (Explorateur, SQL, Utilisateurs, Sessions, Santé, Sauvegardes, Journal) |
| Workspace | `apps/web/src/features/workspace/WorkspaceBar.svelte`, `DeploymentsTab.svelte`, `MonitoringCard.svelte` |
| Éditeur et dialogues chargés en différé | `apps/web/src/features/editor/ProjectEditor.svelte:824-922` |
| Déploiement | `apps/web/src/features/connections/DeploymentModal.svelte`, `deployment/Deployment*Step.svelte`, `DeploymentHistoryPanel.svelte`, `RollbackConfirmModal.svelte` |
| Création depuis une base | `apps/web/src/features/projects/NewProjectFromDatabaseModal.svelte`, `ProjectList.svelte` |
| Dérive | `apps/web/src/features/editor/drift/DriftBanner.svelte` |
| SQL | `apps/web/src/features/sql/SqlPanel.svelte`, `EditorSqlDrawer.svelte`, `StructureRedirectDialog.svelte` |
| Paramètres | `apps/web/src/features/settings/SettingsPage.svelte`, `SettingsModal.svelte`, `settingsSections.ts`, `SqlAccounts.svelte` |
| Visite guidée | `apps/web/src/features/onboarding/EditorTour.svelte` |
| i18n | `apps/web/src/locales/fr.json`, `en.json`, `apps/web/src/i18n/localeParity.ts`, `serverErrorMessages.ts` |
| Tokens | `apps/web/src/styles/tokens.css` |
| Tests | `apps/web/e2e/*.e2e.ts`, `apps/web/e2e/harness.ts` |
| Fonctionnalités | `docs/etat-des-features.md`, `docs/user-guide.md` |

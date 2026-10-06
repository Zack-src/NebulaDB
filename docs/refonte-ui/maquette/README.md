# Maquette de refonte NebulaDB

Ouvrir **index.html** dans un navigateur. Le fichier contient le CSS et le JavaScript : il peut être copié et partagé seul. Seules les polices Google Fonts sont externes ; des polices système prennent le relais hors ligne.

Le fichier téléchargé d’origine est conservé dans `original.html`. L’application Svelte n’a pas été modifiée.

## Explorer la référence

- **Écrans** : catalogue filtrable de 96 destinations, avec leur famille et le composant source concerné.
- **Composants** : palette, typographie, formulaires, statuts, boutons et règles de mise en page.
- **Rôle** : Admin, Éditeur, Lecteur. Illustration des variantes de permissions, sans constituer une implémentation de sécurité.
- **État** : normal, chargement, vide, aucun résultat, erreur, hors ligne, accès refusé, lecture seule, conflit.
- Les écrans utilisent des fragments d’URL partageables et l’historique du navigateur.
- Les parcours complémentaires sont aussi accessibles depuis les actions du contexte : Objets sur le canvas, Bases, Paramètres, Qualité, Versions, compte et administration.

La barre **Prototype** sert à examiner la maquette. Elle ne fait pas partie du front à implémenter.

## Couverture et correspondance avec le front

Les chemins ci-dessous sont relatifs à `apps/web/src/`. Ils indiquent les surfaces à réutiliser lors de la refonte, sans imposer une nouvelle architecture technique.

| Surface | Référence dans la maquette | Source existante |
| --- | --- | --- |
| Connexion, récupération, MFA, codes de secours, invitation | Famille Authentification | `features/auth/` |
| Accueil et projets | Navigation Accueil / Projets | `features/workspace/`, `features/projects/` |
| Schéma, DBML, MLD/MCD, inspecteur, outils | Projet → Schéma | `features/editor/ProjectEditor.svelte`, `canvas/`, `dbml/`, `mcd/`, `nodes/` |
| Relations et cardinalités | Objets / Relations | `features/editor/edges/` |
| Index et clés composites | Objets → Index et clés composites | `features/editor/nodes/table/AddIndexForm.svelte`, `IndexRow.svelte` |
| Enums, groupes, zones, notes | Objets → écrans dédiés | `features/editor/nodes/` |
| Commentaires, mentions, verrous | Discussions / Verrous | `features/editor/comments/`, `locks/` |
| Import, export, conversion, dictionnaire | Menu Projet et catalogue | `features/editor/io/`, `ConvertTypesModal.svelte`, `dictionary/` |
| Racine et déclinaisons | Paramètres → Projets et déclinaisons | `features/projects/`, `features/editor/compare/` |
| Qualité, modèles, règles personnalisées | Qualité et administration | `features/editor/lint/`, `features/admin/lint/` |
| Versions et restauration de table | Versions / Détail de version | `features/editor/history/` |
| Connexions, objets, comptes, santé, sessions, journaux | Bases → 10 onglets | `features/admin/connections/`, `features/connections/` |
| Compte SQL personnel et privilèges | Compte / Comptes SQL | `features/settings/SqlAccounts.svelte`, `features/admin/connections/UsersPanel.svelte` |
| Requêtes, onglets, résultats, messages, plan, exports | Requêtes | `features/sql/` |
| Comparaison, migration, risques, confirmations, résultats | Projet → Déployer | `features/connections/deployment/`, `features/workspace/CompareEnvironmentsCard.svelte` |
| Historique, détail de déploiement | Historique des déploiements | `features/connections/DeploymentHistoryPanel.svelte` |
| Données initiales et génération | Projet → Bases | `features/workspace/DataTab.svelte`, modules serveur `seeds/`, `generator/` |
| Sauvegarde, portée, planification, restauration | Bases et parcours Sauvegarde | `features/backups/` |
| Utilisateurs, groupes, invitations et accès | Administration | `features/admin/`, `features/teams/` |
| Plugins, catalogue, installés, studio, journaux | Administration → Plugins | `features/plugins/PluginManagerDialog.svelte`, `dialog/` |
| Profil, thèmes, éditeur, sécurité, API, données personnelles | Mon compte | `features/settings/` |
| Notifications, suivi, recherche et aide | Navigation, cloche, Ctrl K | `features/notifications/`, `features/projects/components/GlobalSearchResults.svelte` |

L’inventaire de référence est `docs/etat-des-features.md`, complété par les études existantes de `docs/refonte-ui/`. Les capacités signalées « à venir » dans la maquette d’origine restent signalées comme telles : SSO/passkeys, revue avant production, fenêtres de déploiement, sauvegardes natives, action GitHub/CLI, etc.

## Interactions locales vérifiables

- Modification de tables et colonnes, couleurs, relations, commentaires et verrous.
- Édition du SQL, formatage, ouverture de nouveaux onglets ; résultats de démonstration.
- Installation et retrait de plugins de démonstration, import d’un manifeste JSON.
- Ajout/modification/suppression de lignes de démonstration ; annulation de suppression.
- Import DBML simple avec aperçu, erreurs et application au modèle local.
- Exports DBML, SQL, CSV, JSON et SVG des cartes de tables ; copie avec repli si le presse-papiers est indisponible.
- Création locale d’index, objets et déclinaisons ; formulaires et confirmations des parcours associés.
- Validation du mot de passe et du format de code MFA dans les écrans d’authentification.

Le modèle, les commentaires, les plugins, les brouillons SQL et les enregistrements de démonstration sont conservés dans `localStorage`, clé `nebula-mock-v2`. **Réinitialiser** efface cette clé. Aucun mot de passe saisi dans les nouveaux parcours n’est enregistré par cette extension.

## Limites de la simulation

Cette référence illustre les écrans et les décisions d’interface ; elle ne remplace pas les services de l’application. L’authentification, TOTP, e-mails, connexions, SQL exécuté sur une base, déploiements, sauvegardes et changements de droits sont simulés. Les formulaires de configuration illustrent les réglages ; seuls les objets listés ci-dessus ont une persistance locale explicite.

Le parseur DBML est volontairement limité, hérité du prototype. La conversion d’un import SQL, les exports PNG/PDF et le rendu complet des index par le moteur doivent utiliser les composants existants lors de l’implémentation. Le SVG local exporte les cartes de tables. Les vues et fonctions de base de données restent des données de démonstration.

**Validation réalisée** : compilation syntaxique des scripts, rendu DOM des 96 destinations, huit états de page et parcours interactifs (SQL, recherche, permissions, plugins, relations, index, données, authentification, import). Aucun échec ni erreur JavaScript lors de cette passe.

**Validation visuelle restante** : le navigateur intégré a refusé l’ouverture `file://`. Aucune validation visuelle réelle des espacements, du canvas ou des points de rupture responsive n’est revendiquée. Vérifier dans un navigateur à 375, 768, 1024 et 1440 px, en clair et en sombre, avant de figer une référence pixel à pixel.

## Modifier la maquette

1. Modifier `completion.js` ou `completion.css`.
2. Lancer `node docs/refonte-ui/maquette/build.mjs` depuis le dépôt.
3. Ouvrir `index.html`. `original.html` reste la base de reconstruction.

La QA DOM utilise jsdom, sans ajouter de dépendance à l’application :

```powershell
node docs/refonte-ui/maquette/verify.cjs "CHEMIN_INSTALLATION_JSDOM"
```

Le fichier HTML autonome est le livrable à utiliser. Les fichiers JS/CSS séparés sont ses sources de maintenance.

# Plan — features restantes touchant le front, puis refonte UI/UX

Source : `etat-des-features.md` (2026-10-05). Ce plan sépare ce qui ne demande **aucune décision**
du propriétaire (à livrer en v1) de ce qui est bloqué.

## Étape 1 — Features à ajouter avec impact front (v1)

| Lot | Contenu                                                                                                               | Section | Modèle |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------- | ------ |
| A   | Comptes SQL gérés depuis les Paramètres de l'utilisateur ; création du compte de base dans le geste d'invitation       | 5, 6    | opus   |
| B   | SQL : requêtes enregistrées, éditeur avec complétion depuis le schéma, EXPLAIN visuel, édition de lignes              | 7       | opus   |
| C   | Déploiement : revue avant prod, fenêtres de déploiement, gel ; bouton « revenir avant ce déploiement » ; niveau revue | 3, 4    | opus   |
| D   | Alertes de dérive : acquittement, mise en sourdine, e-mail ; préférences de notification (e-mail, résumé)             | 10, 11  | sonnet |
| E   | Petits manques : dictionnaire (export PDF, description multiligne), journal de modélisation dans Activité, privilèges colonne attribuables, générateurs de données « regex » / « copie de colonne », champs tunnel SSH / CA TLS du formulaire de connexion | 1, 3, 4, 6, 8 | sonnet |
| F   | Performance : tableau de santé / trafic par connexion, suggestions d'index                                            | 9       | opus   |

## Hors périmètre (bloqué par une décision ou trop vaste)

- Projet racine et déclinaisons (Phase 35) : décisions préalables requises.
- Fusion par champ, points de passage des relations : décision / chantier moteur.
- Logs côté base, conseiller IA, SSO / passkeys, revue de sécurité, tag de version.
- Exports Prisma / TypeORM / GraphQL : prévus en plugins.

## Étape 2 — Refonte UI/UX complète

Après l'étape 1 : audit de l'architecture d'information, système de design (tokens, composants),
navigation, puis réécriture écran par écran (workspace, éditeur, admin, connexions, paramètres),
accessibilité et mobile.

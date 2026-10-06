# NebulaDB — état des fonctionnalités

État au **2026-10-05**, sur le commit `60b490c` (`main`) **plus les modifications de la session du
jour, non commitées** (accès aux bases, surveillance des comptes, journal par base, mentions,
corrections moteur, correctif CI).

Ce document liste tout ce que l'outil doit permettre, fonctionnalité par fonctionnalité, avec
son état. Il réunit le besoin exprimé par le propriétaire du produit, ce que le code fait déjà
et ce que [`todo.md`](./todo.md) prévoit. Le détail technique de chaque point reste dans
`todo.md`, qui porte aussi les décisions en attente.

## Légende

| Marque | Sens                                                                                       |
| :----: | ------------------------------------------------------------------------------------------ |
|   ✅   | **Fait** — le code existe et ses tests automatiques passent.                               |
|   🧪   | **À tester** — le code est écrit, mais personne ne l'a vu fonctionner en condition réelle. |
|   🟡   | **À finir ou améliorer** — utilisable, avec un manque connu.                               |
|   ❌   | **À faire** — rien n'est codé.                                                             |
|   ★    | Demandé explicitement dans le récapitulatif du propriétaire.                               |

## Ce qui a été vérifié pour établir cet état

| Contrôle                                             | Résultat                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Format (simulation du CI), lint, imports circulaires | OK                                                                                    |
| Build complet                                        | OK                                                                                    |
| Tests unitaires                                      | 655 passent, 0 échec, 1 ignoré (Oracle : pas de base disponible)                      |
| Tests sur de vraies bases (Docker)                   | PostgreSQL, MySQL, SQL Server passent, dont la lecture des comptes ; Oracle non lancé |
| Tests navigateur (e2e)                               | 41 / 41                                                                               |
| Bug d'export `[pk, unique]` → `UNIQUE PRIMARY KEY`   | Corrigé, testé sur les trois dialectes                                                |

Le reste des états vient de la lecture du code et de `todo.md`, pas d'un essai manuel de
l'application : « fait » veut dire « les tests automatiques passent », pas « un humain l'a
utilisé ».

## 1. Modélisation ★

| Fonctionnalité                                                                                     | État | Reste / remarque                                                                             |
| -------------------------------------------------------------------------------------------------- | :--: | -------------------------------------------------------------------------------------------- |
| Éditeur DBML et canvas synchronisés                                                                |  ✅  |                                                                                              |
| Tables, colonnes, relations, enums, zones, notes, groupes, index/PK composites                     |  ✅  |                                                                                              |
| Réglages de l'éditeur DBML (formatage, complétion, délai de synchronisation)                       |  ✅  |                                                                                              |
| Copier/coller de tables, enums, zones et notes ; duplication ; annuler/rétablir                    |  ✅  | Une colonne typée par un enum, collée sans l'enum, perd la définition                        |
| Vue conceptuelle MCD (Merise)                                                                      |  ✅  |                                                                                              |
| Import DBML/SQL, export DBML/SQL/PNG/SVG/PDF                                                       |  ✅  | Bug `UNIQUE PRIMARY KEY` corrigé                                                             |
| Modèles de départ, projet créé depuis une base existante                                           |  ✅  |                                                                                              |
| Recherche dans tous les projets                                                                    |  ✅  |                                                                                              |
| Conversion de types entre moteurs                                                                  |  🧪  | Écran jamais cliqué par un test                                                              |
| Linter de schéma (profils, corrections, blocage de déploiement)                                    |  ✅  | Le motif de nommage se règle en règle personnalisée                                          |
| Lint : bibliothèque de modèles, modèle par défaut, version propre au projet, règles personnalisées |  🧪  | Testé côté serveur et en navigateur ; jamais utilisé à la main                               |
| Dictionnaire de données                                                                            |  🟡  | Pas d'export PDF ; description sur une seule ligne                                           |
| Verrous de table                                                                                   |  🟡  | Un plugin annonce « fait » alors que le verrou a refusé                                      |
| Historique, aperçu sur le graphe, restauration d'une seule table                                   |  🟡  | Rétention et compaction des révisions non décidées                                           |
| Comparaison de deux projets, avec SQL de migration                                                 |  ✅  | Le diff contre une base réelle ne signale plus `decimal` ni les clés primaires à tort        |
| Collaboration temps réel, présence, commentaires                                                   |  ✅  |                                                                                              |
| Mentions `@` dans les commentaires                                                                 |  ✅  | Ancien commentaire sans identifiant d'auteur ; nom d'une mention non mis à jour au renommage |
| Fusion par champ (deux personnes sur la même table)                                                |  ❌  |                                                                                              |
| Points de passage des relations, détection d'une relation inversée                                 |  ❌  | Attend une décision du propriétaire                                                          |
| Export Prisma / TypeORM / GraphQL / JSON Schema                                                    |  ❌  | Prévu sous forme de plugins                                                                  |

## 2. Projet racine et déclinaisons ★

| Fonctionnalité                                                          | État | Reste / remarque                                      |
| ----------------------------------------------------------------------- | :--: | ----------------------------------------------------- |
| ★ Projet racine et variantes par client (La Poste, L'Oréal…)            |  ❌  | Aucun code (Phase 35) ; décisions préalables requises |
| Publication de versions de la base, suivi ou épinglage par variante     |  ❌  |                                                       |
| Fusion à trois voies quand la base évolue                               |  ❌  |                                                       |
| Vue en arbre, vues « résolu / surcouche / base », matrice des variantes |  ❌  |                                                       |
| Moteur, droits, connexions et déploiements propres à chaque variante    |  ❌  |                                                       |

À décider avant tout code : format de l'export DBML d'une variante, profondeur de la
hiérarchie (base → secteur → client), et si les variantes couvrent aussi les « branches de
schéma ».

## 3. Connexions aux bases ★

| Fonctionnalité                                                       | État | Reste / remarque                                   |
| -------------------------------------------------------------------- | :--: | -------------------------------------------------- |
| Connexions au niveau de l'instance, rattachées aux projets           |  ✅  |                                                    |
| PostgreSQL, MySQL/MariaDB, SQL Server                                |  ✅  | Vérifié sur de vraies bases                        |
| Oracle                                                               |  🧪  | Jamais testé sur une vraie base                    |
| SQLite                                                               |  ✅  |                                                    |
| Chiffrement des identifiants, rotation de la clé, anti DNS-rebinding |  ✅  |                                                    |
| Santé, tags, lecture seule par connexion                             |  ✅  |                                                    |
| Environnements configurables (DEV › Staging › Prod)                  |  🟡  | Le niveau « revue » est appliqué comme « protégé » |
| Variables par environnement dans les noms de tables et de schémas    |  🧪  | `{{schema}}` jamais essayé sur un moteur à schémas |
| Tunnel SSH, autorité de certification TLS personnalisée              |  ❌  |                                                    |

## 4. Déploiement ★

| Fonctionnalité                                               | État | Reste / remarque                                               |
| ------------------------------------------------------------ | :--: | -------------------------------------------------------------- |
| Assistant : différences → risques → SQL → résultat           |  🧪  | Fenêtre découpée en étapes, jamais regardée à la main          |
| ★ Comparatif montré avant le déploiement                     |  ✅  |                                                                |
| Mesure des risques sur les données existantes                |  ✅  | Vérifié sur PostgreSQL et MySQL ; très grosses tables à tester |
| Confirmation et sauvegarde automatique en production         |  ✅  |                                                                |
| Pipeline sans saut d'étape                                   |  ✅  |                                                                |
| Comparaison de deux environnements                           |  🧪  | Faux « différent » attendus entre deux moteurs différents      |
| Historique des déploiements, retour arrière « au mieux »     |  🟡  | MySQL : pas de retour à travers un échec en cours de lot       |
| Données initiales CSV, reprise des lignes depuis la base     |  🧪  | Reprise jamais essayée ailleurs que sur SQLite                 |
| Générateur de données de test                                |  🟡  | Générateurs « regex » et « copie d'une colonne » absents       |
| Sauvegardes logiques, planification, restauration            |  🧪  | Jamais essayées sur les moteurs serveur ni sur plusieurs jours |
| Revue avant production, fenêtres de déploiement, gel         |  ❌  |                                                                |
| Bouton « revenir avant ce déploiement », sauvegardes natives |  ❌  |                                                                |
| Action GitHub / CLI                                          |  ❌  | Un exemple CI est écrit, jamais lancé                          |

## 5. Comptes Nebula et groupes ★

| Fonctionnalité                                                     | État | Reste / remarque                                                             |
| ------------------------------------------------------------------ | :--: | ---------------------------------------------------------------------------- |
| Invitation, mot de passe oublié, 2FA, sessions, verrouillage       |  ✅  |                                                                              |
| E-mails (invitation, réinitialisation)                             |  🧪  | Jamais envoyés par un vrai relais SMTP                                       |
| Administration : désactiver, supprimer, réinitialiser un compte    |  ✅  |                                                                              |
| ★ Groupes (« équipes ») : un utilisateur dans 0 à n groupes        |  ✅  |                                                                              |
| ★ Projet associé à des groupes, avec un niveau par groupe          |  ✅  | Un projet sans groupe est lisible par tous                                   |
| ★ Invitation avec groupes, accès aux bases et compte SQL attribués |  🧪  | Appliqué à l'acceptation, testé côté serveur ; l'écran n'a jamais été cliqué |
| Rôle intermédiaire (« peut déployer », « peut lancer du SQL »)     |  ❌  | Le SQL est couvert par le droit d'accès à une base (section 6)               |
| Restriction de lecture par table ou par colonne                    |  ❌  |                                                                              |
| SSO, passkeys                                                      |  ❌  |                                                                              |

## 6. Utilisateurs et permissions des bases connectées ★

| Fonctionnalité                                                        | État | Reste / remarque                                                                                                                       |
| --------------------------------------------------------------------- | :--: | -------------------------------------------------------------------------------------------------------------------------------------- |
| Lister les comptes, rôles et privilèges                               |  ✅  | Vérifié sur PostgreSQL, MySQL, SQL Server                                                                                              |
| Créer, supprimer, mot de passe, activer, rôle, accorder / révoquer    |  🧪  | Moteur vérifié ; l'écran n'a jamais été affiché                                                                                        |
| Sessions en cours et arrêt d'une session                              |  ✅  |                                                                                                                                        |
| ★ Compte SQL personnel par utilisateur et par base                    |  🧪  | Aucune vraie connexion testée ; option par connexion                                                                                   |
| ★ Accès à une base accordé par l'admin, par utilisateur ou par groupe |  🧪  | Deux niveaux (lecture, écriture de données) par connexion ; vérifié sur PostgreSQL et MySQL en compte partagé, pas en compte personnel |
| ★ L'admin associe un compte de base à un compte Nebula                |  🟡  | L'admin fixe le nom du compte proposé ; la personne saisit le mot de passe                                                             |
| ★ Créer le compte de base en même temps que l'invitation              |  🟡  | Créé à l'acceptation (mot de passe aléatoire gardé par Nebula), vérifié sur PostgreSQL ; compte sans privilège, à accorder ensuite     |
| ★ Gestion de ses comptes SQL depuis ses Paramètres                    |  🧪  | Bloc « Mes comptes SQL » (Paramètres › Profil), testé serveur et navigateur ; jamais utilisé à la main                                 |
| Privilèges au niveau colonne                                          |  🟡  | Lisibles, pas attribuables depuis l'interface                                                                                          |
| Protection du compte de la connexion elle-même                        |  ✅  | Supprimer, verrouiller, changer le mot de passe refusés ; retirer ses privilèges n'est pas intercepté                                  |

## 7. Requêtes SQL ★

| Fonctionnalité                                                     | État | Reste / remarque                                                                                         |
| ------------------------------------------------------------------ | :--: | -------------------------------------------------------------------------------------------------------- |
| Console SQL (lecture seule par défaut, mode écriture confirmé)     |  ✅  | Administrateurs de l'instance                                                                            |
| Explorateur, données paginées, export CSV                          |  ✅  |                                                                                                          |
| ★ Onglet « Données & SQL » et panneau SQL dans l'éditeur de schéma |  ✅  | Administrateurs de l'instance, et membres autorisés sur les bases accordées                              |
| ★ SQL pour les utilisateurs non administrateurs                    |  🧪  | Lecture seule ou données seulement (jamais de structure) ; filtre d'Nebula, pas un analyseur SQL complet |
| Grille de résultats                                                |  🧪  | Jamais utilisée sur un vrai gros résultat                                                                |
| Historique de ses requêtes, journalisation de chaque requête       |  ✅  |                                                                                                          |
| Changement de structure renvoyé vers le schéma                     |  ✅  | Contournable par une procédure ou un bloc `DO` (admin d'instance)                                        |
| Éditeur SQL avec complétion depuis le schéma                       |  ❌  | Simple zone de texte aujourd'hui                                                                         |
| Requêtes enregistrées, EXPLAIN visuel, édition de lignes           |  ❌  |                                                                                                          |

## 8. Journaux ★

| Fonctionnalité                                                | État | Reste / remarque                                                                                                                             |
| ------------------------------------------------------------- | :--: | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Journal d'activité (filtres, export CSV/JSON, non modifiable) |  ✅  |                                                                                                                                              |
| ★ Journal d'une base précise (onglet « Journal » de la base)  |  ✅  | Ce qui passe par Nebula : ouverture, tests, requêtes, déploiements, comptes, alertes                                                         |
| ★ Journal de la modélisation                                  |  🟡  | Dans l'historique du projet, pas dans Activité                                                                                               |
| Journal des erreurs                                           |  ✅  |                                                                                                                                              |
| ★ Logs côté base (connexions et requêtes faites hors Nebula)  |  🟡  | Niveau 1 : sessions relevées toutes les 5 min (instantané, requêtes courtes manquées), vérifié sur PostgreSQL ; pas d'audit natif (niveau 2) |
| Export syslog / SIEM                                          |  ❌  |                                                                                                                                              |

Le texte SQL est gardé tel quel dans l'audit : un `IDENTIFIED BY '…'` y apparaît (comportement
antérieur, maintenant bien visible dans l'onglet Journal).

## 9. Performance et conseils ★

| Fonctionnalité                                        | État | Reste / remarque                                                                                                                                                           |
| ----------------------------------------------------- | :--: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ★ Temps et fréquence d'utilisation par requête        |  🟡  | Requêtes lancées depuis Nebula seulement, regroupées par forme ; rien côté serveur de base                                                                                 |
| Tableau de santé (onglet « Santé »)                   |  🟡  | Sonde, latence, tailles, sessions, verrous bloquants ; vérifié sur PostgreSQL (blocage compris), pas de croissance par table ni de carte sur la liste des connexions       |
| Trafic par connexion (compteurs du serveur)           |  🟡  | Requêtes, octets, lignes selon le moteur (PostgreSQL : transactions, pas d'octets) ; vérifié sur PostgreSQL, MySQL, SQL Server ; pas de ventilation par compte ni d'alerte |
| Suggestions d'index                                   |  ❌  |                                                                                                                                                                            |
| ★ Conseiller de requêtes et de schéma, IA optionnelle |  ❌  | Dépend de la collecte côté serveur de base                                                                                                                                 |

## 10. Modifications faites hors Nebula ★

| Fonctionnalité                                     | État | Reste / remarque                                                                                              |
| -------------------------------------------------- | :--: | ------------------------------------------------------------------------------------------------------------- |
| ★ Surveillance activable des tables et colonnes    |  🧪  | Jamais essayée sur un vrai moteur                                                                             |
| Bandeau, différences, resynchroniser, ignorer      |  🟡  | Pas de traitement ligne par ligne                                                                             |
| Webhook et notification dans l'application         |  ✅  |                                                                                                               |
| ★ Surveillance des utilisateurs et des permissions |  🧪  | Lecture vérifiée sur PostgreSQL, MySQL, SQL Server ; Oracle lu dans le code seulement ; option jamais cliquée |
| Alerte par e-mail, acquittement, mise en sourdine  |  ❌  |                                                                                                               |

## 11. Autour

| Fonctionnalité                                           | État | Reste / remarque                                                                                          |
| -------------------------------------------------------- | :--: | --------------------------------------------------------------------------------------------------------- |
| API publique, clés à portées, OpenAPI                    |  🟡  | Pas de quotas par clé ni de clé multi-projets ; rien de nouveau n'y est exposé (accès aux bases, comptes) |
| Webhooks                                                 |  ✅  | Rotation de secret sans période de grâce                                                                  |
| Notifications sur les projets suivis, mentions, réponses |  🟡  | Pas d'e-mail, pas de résumé quotidien                                                                     |
| Plugins                                                  |  🟡  | Pas de partage en équipe                                                                                  |
| Visite guidée, thèmes, français + anglais                |  ✅  |                                                                                                           |
| Composants de formulaire maison                          |  🧪  | Une dizaine d'écrans migrés jamais cliqués                                                                |
| Refonte visuelle, accessibilité, mobile                  |  ❌  |                                                                                                           |
| Revue de sécurité indépendante, relecture juridique      |  ❌  | Dues avant tout usage réel                                                                                |
| Première version taguée                                  |  ❌  | Tous les paquets sont encore en `0.0.1`                                                                   |
| CI GitHub                                                |  🟡  | Corrigée en local (formatage) ; aucun run tant que ce n'est pas poussé                                    |

## Lecture d'ensemble

- **Ce qui existe et tient :** modélisation, connexions, déploiement, groupes, console SQL,
  journal d'activité, journal par base, mentions.
- **Demandes du propriétaire livrées aujourd'hui, à valider en conditions réelles :**
  accès aux bases par utilisateur ou groupe, SQL pour les non-administrateurs, invitation
  enrichie, surveillance des comptes et permissions, journal d'une base, temps et fréquence
  des requêtes lancées depuis Nebula.
- **Demandes du propriétaire encore absentes :**
  1. conseiller de requêtes et IA (aucune décision prise sur l'analyseur SQL) ;
  2. projet racine et déclinaisons.
- **Limite du droit d'accès aux bases :** deux niveaux seulement par connexion (pas de droit par
  base, schéma ou table). En compte partagé, le membre agit sous le compte stocké sur la
  connexion : seul le filtre d'Nebula le borne.

## Décisions prises par défaut pendant la mise à jour (à confirmer ou changer)

- **Accès aux bases :** `read` = lecture seule ; `write` = une instruction de données à la fois
  avec confirmation ; structure jamais ; le membre n'y accède que depuis un projet rattaché, par
  le navigateur (pas de clé d'API) ; pas de nom à retaper en production pour une écriture.
- **Compte de la connexion :** protégé sans exception, même pour l'administrateur.
- **Mentions :** la personne mentionnée est notifiée même sans suivre le projet ; seuls les droits
  d'édition ou plus peuvent commenter.
- **Surveillance des comptes :** visible des administrateurs d'instance seulement ; un
  `CREATE USER` tapé dans la console SQL déclenche une alerte (seule la console « Utilisateurs »
  met la référence à jour) ; notifications et webhooks portent des compteurs, jamais de noms.
- **Proxy inverse :** les appels explorateur et SQL de l'application passent par
  `/api/connections/:id/…` en plus de `/api/admin/…` ; un proxy qui filtre `/api/admin` doit
  laisser passer ces chemins.

## Points pour la revue de sécurité indépendante

- Le filtre qui borne les écritures des membres est un garde-fou, pas un analyseur : une fonction
  ou procédure appelable dans une instruction de données lui échappe. C'est critique quand le
  compte partagé de la connexion est très privilégié.
- Une invitation accorde ses droits à l'acceptation, sans nouvelle vérification à ce moment.
- La vue d'ensemble liste toutes les bases du serveur à un membre ; révoquer les privilèges du
  compte de la connexion n'est pas intercepté.
- Surveillance des comptes : un changement externe fait dans les quelques millisecondes autour
  d'une action de la console « Utilisateurs » est attribué à Nebula.
- Les statistiques de requêtes gardent le dernier auteur de chaque forme (30 jours).

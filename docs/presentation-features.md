# NebulaDB — fonctionnalités à présenter

## 1. Projets (tableau de bord)

- Créer un projet vide ou **depuis une base existante** (le schéma est lu sur la base).
- Cartes de projet avec miniature du diagramme, onglets, archivage et corbeille.
- **Recherche globale** : trouve une table, une colonne ou un enum dans tous les projets
  visibles, et ouvre le projet centré dessus.
- Un projet s'ouvre sur un espace à onglets : Schéma, Données & SQL, Déploiements, Historique,
  Dictionnaire, Problèmes.

## 2. Modélisation

### Éditeur de code DBML

- Coloration, complétion, survol, aller à la définition, renommage d'un symbole, recherche,
  formatage, palette de commandes.
- Erreurs soulignées dans le texte, barre d'état (`Synced` / `Pending` / `Error on line n`).
- Réglages par navigateur : formatage automatique, complétion, délai d'envoi vers le diagramme
  (jusqu'à « seulement sur Ctrl+S »).
- **Synchronisé dans les deux sens** avec le diagramme : on tape du DBML, le canvas suit, et
  l'inverse.

### Éditeur visuel

- Créer et modifier tables, colonnes, types, clés primaires, contraintes, index (simples et
  composites), valeurs par défaut, directement sur le diagramme.
- Relations tirées à la souris, cardinalités affichées, actions `ON DELETE` / `ON UPDATE`.
- Enums, groupes de tables, **zones** et **notes** (post-it) pour organiser le schéma.
- Copier / coller et dupliquer des tables, enums, zones et notes, y compris d'un projet à
  l'autre ou vers l'éditeur DBML. Annuler / rétablir.

### Canvas

- Couleur des en-têtes de tables, palette de couleurs.
- **Position des liens** : points de passage déplaçables, réglage du routage, remise à zéro.
- Trois niveaux de détail par table, disposition automatique, minimap, zoom, recherche dans le
  diagramme, sélection au lasso.
- **Vue conceptuelle MCD (Merise)** en plus de la vue logique.
- Thèmes clair / sombre, interface en français et en anglais, visite guidée à la première
  ouverture.

### Import / export

- Import : DBML, SQL (PostgreSQL, MySQL, SQL Server, SQLite), JSON Schema.
- Export : DBML, SQL (les mêmes dialectes), TypeScript, Prisma, Mermaid, JSON Schema, PNG, SVG,
  PDF.
- **Bundle de projet** : un seul fichier JSON avec tout le projet (schéma, disposition, verrous,
  données initiales, réglages du générateur, commentaires, couleurs), à réimporter ailleurs.
- **Conversion de types** d'un moteur à l'autre.

## 3. Collaboration

- Édition à plusieurs **en temps réel** : curseurs et présence des autres, modifications
  fusionnées en direct.
- **Commentaires** sur les tables et les colonnes, avec mentions `@` des personnes qui voient le
  projet.
- **Notifications** : suivre un projet (déploiements, verrous, données initiales, base modifiée
  hors Nebula), centre de notifications avec compteur, alerte en cas de mention ou de réponse.

## 4. Historique

- Chaque modification est une révision : frise chronologique, regroupée par personne, avec les
  tables touchées et un filtre « Mes modifications ».
- **Aperçu sur le diagramme** de ce qui a changé depuis une révision (ajouté en vert, modifié en
  orange).
- Restauration non destructive, du schéma entier ou **d'une seule table**.
- Les verrous, restaurations, déploiements et retours arrière apparaissent dans la même frise.

## 5. Qualité et gouvernance du schéma

- **Linter** (onglet Problèmes) : clé primaire présente, clés étrangères indexées, nommage,
  `varchar` avec longueur, colonnes obligatoires, types interdits… avec correction en un clic
  pour certaines règles.
- Profils Souple / Standard / Strict, règles personnalisées (expressions régulières),
  bibliothèque de modèles gérée par l'admin, et option « une erreur bloque le déploiement ».
- **Dictionnaire de données** : description, propriétaire, classification (public, interne,
  personnel, sensible) et tags par table et par colonne ; export Markdown, CSV, HTML.
- **Verrous de table** : un administrateur de projet gèle la structure d'une table pour tous les
  autres, sur tous les chemins d'écriture (canvas, DBML, import, restauration, API).

## 6. Données associées aux tables

- **Données initiales (seeds)** : un fichier CSV par table, vérifié contre la table (types,
  NOT NULL, longueurs, doublons, clés étrangères) avec aperçu avant enregistrement.
- **Reprendre les lignes d'une base** comme données initiales.
- **Générateur de données de test** : un générateur par colonne proposé d'après son nom et son
  type (e-mail, prénom, ville, dates, UUID…), jusqu'à 10 000 lignes, reproductible.
- Les données initiales sont insérées au déploiement, après la création des tables, dans l'ordre
  des dépendances.

## 7. Déploiement sur les bases connectées

- **Assistant en quatre étapes** : différences → risques → SQL → résultat. Le SQL exécuté est
  montré avant, et suit les réponses données aux risques.
- **Mesure des risques sur les données réelles** : colonne supprimée qui contient des données,
  NOT NULL sur des NULL, texte raccourci sous la valeur la plus longue, unicité sur des doublons,
  clé étrangère sur des orphelins.
- **Environnements** : chaîne configurable (DEV › Staging › Prod) avec couleur et niveau de
  protection ; pas de saut d'étape ; en production, nom de la connexion à retaper et sauvegarde
  automatique avant déploiement.
- **Variables par environnement** dans les noms de tables et de schémas
  (`{{table_prefix}}orders`).
- **Historique des déploiements** et **retour arrière**.
- **Vérifier les différences** entre le projet et une base, **comparer deux environnements**,
  carte Pipeline montrant où en est chaque base.
- **Surveillance des modifications faites hors Nebula** : la base est relue périodiquement ; un
  écart déclenche un bandeau dans l'éditeur, une notification et un webhook. Option pour
  surveiller aussi les comptes et privilèges.

## 8. Requêtes SQL et exploration des données

- **Console SQL** depuis l'outil : lecture seule par défaut, mode écriture explicite et confirmé,
  limites de temps et de lignes, historique de ses requêtes.
- **Panneau SQL sous le diagramme** (`Ctrl+J`) et bouton « Voir les données » sur une table.
- **Explorateur** : bases, schémas, tables, structure, données paginées, export CSV.
- Grille de résultats triable et redimensionnable, fluide sur 10 000 lignes.
- **Accès accordé par l'admin** à un utilisateur ou à une équipe, par connexion : `lecture`
  (explorateur + SELECT) ou `écriture` (INSERT / UPDATE / DELETE, une instruction à la fois).
  Jamais de changement de structure : il est renvoyé vers le schéma.
- **Compte SQL personnel** : une connexion peut demander à chacun son propre compte de base ;
  les logs de la base disent alors qui a fait quoi. Géré dans Paramètres › « Mes comptes SQL ».
- Chaque requête, même refusée, est journalisée.

## 9. Administration

### Utilisateurs

- Invitation (par e-mail si SMTP configuré, sinon lien à copier), désactivation, suppression avec
  transfert des projets, réinitialisation de mot de passe.
- **Équipes** : un utilisateur dans plusieurs équipes ; un projet ouvert à des équipes ou à des
  personnes, avec un niveau chacune (lecture, édition, administrateur).
- Une invitation peut porter d'emblée les équipes, les accès aux bases et le compte SQL proposé.

### Bases de données

- Connexions créées par l'admin au niveau de l'instance, puis rattachées aux projets (une
  connexion peut servir plusieurs projets, chacun avec sa propre base sur le serveur).
- **Moteurs supportés** : PostgreSQL, MySQL / MariaDB, SQL Server, Oracle, SQLite, BigQuery.
- Tags, état de joignabilité, option lecture seule, environnement de rattachement.
- **Surveillance imposée** : l'admin peut forcer, sur une connexion, la surveillance des
  modifications hors Nebula pour tout projet qui y est rattaché, avec une fréquence minimale ;
  les administrateurs de projet ne peuvent pas la couper.
- Identifiants chiffrés, rotation de la clé de chiffrement.

### Utilisateurs des bases de données

- Lister les comptes, rôles et privilèges du serveur ; créer, supprimer, verrouiller, changer un
  mot de passe, gérer les rôles, accorder et révoquer — chaque action montrée en SQL avant
  d'être exécutée.
- Associer un compte de base à un compte Nebula, ou le créer avec l'invitation.
- Le compte utilisé par la connexion elle-même est protégé.

### Exploitation des bases

- **Santé** : sonde, latence dans le temps, version, tailles des bases, sessions actives et
  inactives, sessions bloquées par un verrou.
- **Sessions** en cours, avec arrêt d'une session.
- **Journal par base** : tout ce qui est passé par Nebula sur cette base, filtrable et exportable.
- **Statistiques des requêtes** : regroupées par forme, avec nombre d'exécutions, échecs, durée
  moyenne et maximale.
- **Activité côté base** : sessions relevées sur le serveur (à la demande ou toutes les 5 min) et
  trafic mesuré par le serveur.
- **Sauvegardes** des bases connectées : immédiates ou planifiées, chiffrées, téléchargeables,
  restauration de tables choisies.
- **Emplacement des sauvegardes** au choix par base : dossier local ou partage réseau monté sur
  le serveur, testé avant d'être enregistré.
- **Politique de structure** : sur une base modélisée par un projet, la console refuse par défaut
  les `CREATE / ALTER / DROP` et renvoie vers le schéma.

### Instance

- **Journal d'activité** (audit) : qui a fait quoi, filtres par période, type, projet, base ;
  export CSV / JSON.
- **Journal des erreurs**.
- Gestion des environnements et de la bibliothèque de modèles de lint.

## 10. Compte et sécurité

- Double authentification (TOTP) avec codes de secours.
- Sessions actives visibles et révocables, verrouillage après dix échecs de connexion, mot de
  passe oublié.
- Export de ses données personnelles et suppression de son compte.

## 11. Intégrations et extensibilité

- **API publique** `/api/v1` avec clés à portées et description OpenAPI : lint, vérification de
  dérive et déploiement depuis une CI.
- **Webhooks** signés (Slack, Discord, HTTP) : schéma modifié, déploiement terminé, dérive
  détectée.
- **Plugins** exécutés dans un bac à sable du navigateur : exporteurs, importeurs, commandes de
  canvas et d'éditeur ; gestionnaire avec onglets Installés, Marketplace, Studio et Logs.
  Commandes fournies : passage en snake_case / camelCase, ajout de `created_at` / `updated_at`,
  ajout d'une clé UUID, audit et statistiques du schéma.

## 12. Hébergement

- Auto-hébergé : un seul processus, données dans SQLite, image Docker fournie ; aucune requête
  vers un service tiers.
- Sauvegarde et restauration des projets en ligne de commande, sauvegardes planifiées.
- `/api/health` et `/api/metrics` pour la supervision.

## À savoir avant la démo

Points que `docs/etat-des-features.md` signale comme écrits mais jamais éprouvés en conditions
réelles ; à essayer avant de les montrer en direct.

- **Oracle** : jamais testé sur une vraie base. **BigQuery** : ajouté au dernier commit.
- Sauvegardes et restauration des bases : vérifiées de bout en bout sur SQLite seulement.
- Envoi d'e-mails : jamais passé par un vrai relais SMTP.
- Compte SQL personnel et invitation enrichie : testés automatiquement, jamais utilisés à la main.
- Comparaison de deux environnements, variables par environnement, conversion de types : idem.
- Absents de l'outil, si la question est posée : variantes d'un projet par client, conseiller de
  requêtes / IA, suggestions d'index, SSO, tunnel SSH, complétion dans l'éditeur SQL.

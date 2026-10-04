# À décider et à tester

État au 2026-10-06. Ce document reprend, en français et en une seule page, la section
« Owner's checklist » de [`todo.md`](todo.md) : les **décisions** qui attendent le propriétaire
du projet, les **tests** que personne n'a encore vus fonctionner — avec, pour chacun, s'il peut
être **automatisé** —, les **vérifications avant mise à jour** et les **relectures dues**.

`todo.md` reste la référence : chaque ligne renvoie à sa phase, où se trouve le détail. Quand
un point est réglé, le barrer ici **et** dans `todo.md`, avec la date et la réponse.

## Sommaire

1. [Avant de pousser](#1-avant-de-pousser)
2. [Décisions à prendre](#2-décisions-à-prendre)
3. [Tests à faire](#3-tests-à-faire)
4. [À vérifier avant de mettre à jour une vraie instance](#4-à-vérifier-avant-de-mettre-à-jour-une-vraie-instance)
5. [Relectures dues](#5-relectures-dues)
6. [Ce qui peut être automatisé, en résumé](#6-ce-qui-peut-être-automatisé-en-résumé)

---

## 1. Avant de pousser

- [ ] **Environ 180 commits ne sont que sur ce disque** (tout depuis `e0cde00`, soit les
      Phases 29 à 36). Rien n'est sur le dépôt distant : une panne de disque les perd. Pousser
      sur `main` ou sur une branche.
- [ ] **Un commit est rouge pris seul** : `541def6` (rotation du secret d'un webhook) contient
      un test qui appelle des routes ajoutées par le commit suivant, `8450675`. Les fusionner
      avant de pousser, ou l'accepter.
- [ ] **Aucun tag, toutes les versions à `0.0.1`** : décider si cette poussée est la première
      version taguée (voir 2.2).
- Dernière vérification complète, le 2026-10-06, sur le dernier commit de code (`6cbccab`) :
  615 tests unitaires passent, 6 sont ignorés (voir 3.1), 37 tests navigateur passent, ESLint et la détection d'imports
  circulaires sont propres.

---

## 2. Décisions à prendre

**(bloque)** signale une décision dont du code attend la réponse. Les autres ont un
comportement par défaut en place, que la réponse peut changer.

### 2.1 Choix faits par défaut du 4 au 6 octobre — à confirmer ou changer

| #   | Sujet                                               | En place aujourd'hui                                                                                                                                                                                             | Autres options                                                                             |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| D1  | Comptes SQL personnels : option ou obligation ?     | Option par connexion ; les connexions existantes et nouvelles sont en compte partagé                                                                                                                             | En faire le défaut des nouvelles connexions · supprimer le mode partagé                    |
| D2  | Compte de service                                   | La surveillance, les sauvegardes planifiées et le test de disponibilité passent par le compte enregistré sur la connexion, même lancés à la main                                                                 | Une vérification lancée à la main utilise le compte de la personne (et échoue sans compte) |
| D3  | Qui peut donner son compte SQL                      | Administrateurs de l'instance et administrateurs d'un projet rattaché à la connexion                                                                                                                             | À revoir si les membres « edit » obtiennent le SQL (D15)                                   |
| D4  | Règle de lint « donnée personnelle »                | Avertissement en Standard, **erreur en Strict** : un projet Strict qui bloque les déploiements sur erreur peut être refusé après mise à jour                                                                     | Avertissement en Strict aussi · désactivée par défaut                                      |
| D5  | Règles « colonnes décrites » et « ON DELETE »       | Désactivées, sauf en Strict (niveau info)                                                                                                                                                                        | Les monter d'un niveau                                                                     |
| D6  | Rotation du secret d'un webhook                     | L'ancien secret cesse de signer immédiatement                                                                                                                                                                    | Période pendant laquelle les deux secrets signent                                          |
| D7  | SQL en écriture sur la production                   | Confirmé par un dialogue, sans retaper le nom de la connexion                                                                                                                                                    | Exiger le nom, comme pour un déploiement                                                   |
| D8  | Niveaux de capacité par connexion                   | Non construits : rien ne les lit, et il faut les moteurs pour les détecter                                                                                                                                       | Les construire maintenant                                                                  |
| D9  | Sauvegardes par API                                 | Derrière la portée `connections:manage` : la clé d'un administrateur peut télécharger toutes les lignes d'une base. 10 lancements par minute                                                                     | Portée dédiée `backups:manage`                                                             |
| D10 | Restauration, planification, épinglage par API      | Absents de l'API, volontairement                                                                                                                                                                                 | Les ajouter (une restauration par API demanderait le nom de la cible dans la requête)      |
| D11 | Notifications poussées                              | Immédiates seulement dans le projet ouvert ; ailleurs, jusqu'à une minute d'attente                                                                                                                              | Les pousser partout (demande une connexion temps réel hors projet)                         |
| D12 | Contrôles qui ont changé en quittant le natif       | « Actif » d'un webhook est un interrupteur ; « Ajouter à un rôle… » ne permet plus de revenir à « aucun » ; le port 0 s'affiche vide                                                                             | Revenir sur l'un ou l'autre                                                                |
| D13 | Portées d'API des routes ajoutées                   | Vérification de dérive et comparaison de bases derrière `projects:read` ; modification et test d'un webhook derrière `projects:write`                                                                            | Exiger `connections:manage` ou une nouvelle portée                                         |
| D16 | Plugins sur une table verrouillée                   | Le verrou tient partout, mais le plugin affiche son message de réussite à côté du refus ; un plugin du canevas applique la partie non verrouillée, un plugin de l'éditeur DBML ou un import est refusé en entier | Un seul comportement ; masquer le message d'un plugin dont le changement a été annulé      |
| D17 | Stratégies de risque dans la fenêtre de déploiement | De simples boutons radio, description sous le libellé (c'étaient des cartes encadrées) — personne n'a regardé le résultat                                                                                        | Retrouver les cartes                                                                       |
| D18 | Listes à première entrée vide                       | Devenues des indications : une fois une équipe, un membre ou un projet choisi, on ne peut plus revenir à « rien »                                                                                                | Garder une entrée « aucun »                                                                |
| D19 | Grille de résultats                                 | Lignes de 28 px ; colonnes à la largeur de leur contenu, non étirées ; largeurs non mémorisées ; tri sur la page affichée seulement                                                                              | Mémoriser les largeurs par table · tri côté serveur dans l'explorateur                     |
| D20 | Comptes SQL personnels par API                      | Derrière `connections:manage`, lecture comprise ; une clé restreinte à un projet n'agit que sur les connexions de ce projet ; 10 essais par minute par l'application et autant par l'API                         | Portée plus fine · plafond commun aux deux                                                 |
| D21 | Vérification de dérive par API                      | Le compteur de changements ne compte un changement que la première fois : l'exemple de CI s'arrête donc aussi sur une dérive déjà connue et sur une base injoignable                                             | Faire répondre aussi le nombre de dérives ouvertes                                         |

### 2.2 Produit et publication

- [ ] **D14 — Licence (bloque la publication)** : MIT ou AGPL. À décider avant toute
      contribution extérieure ; lié à l'offre hébergée.
- [ ] **Offre hébergée** : y en aura-t-il une ? Elle amène facturation, cloisonnement et
      engagement de service.
- [ ] **Première version taguée** : quand, et sur quel commit.
- [ ] **Mobile / tablette** : écrire « bureau uniquement », ou rendre l'application adaptative.
- [ ] **Politique de langue** : français et anglais, complets tous les deux — à écrire comme
      règle.
- [ ] **Hors V1** : confirmer la liste (SSO, passkeys, mode hors ligne, place de marché de
      plugins).

### 2.3 Fonctionnalités en attente d'une réponse

- [ ] **D15 (bloque) — SQL pour les membres « edit »** : lecture seule sur les connexions
      liées (transaction en lecture seule, plafonds de lignes et de temps, journalisé) ; un
      droit séparé pour écrire des données ; la structure jamais.
- [ ] **(bloque) Relation dessinée « à l'envers »** : veut-on une détection ? Un faux
      avertissement sur un schéma légitime est pire que pas d'avertissement.
- [ ] **(bloque) Points de passage d'une relation** : demande vos essais sur le canevas, ou
      une direction, avant toute refonte.
- [ ] **Dérive** : surveiller aussi les données ? Refuser les déploiements tant qu'une dérive
      est ouverte ? Aujourd'hui : structure seulement, déploiements non bloqués.
- [ ] **Historique** : durée de conservation des révisions détaillées ; annuler un changement
      déjà déployé doit-il proposer un nouveau déploiement ?
- [ ] **Sauvegardes** : qui paie le stockage ; durée légale de conservation de sauvegardes
      contenant des données personnelles ; une restauration doit-elle respecter les verrous de
      table ; un droit dédié à la restauration ; double validation en production.
- [ ] **Pipeline** : ce que signifie la protection « Revue » (une approbation — aujourd'hui
      appliquée comme « Protégé ») ; fenêtres de déploiement et gel.
- [ ] **Extras de sécurité de déploiement** : analyse d'impact avant déploiement, gel en un
      clic, relecture par un ou deux approbateurs — trois petits éléments jamais arbitrés.
- [ ] **Données initiales** : plafond de taille ou lecture en flux au-delà de 2 Mo /
      50 000 lignes ; devenir d'une association quand une colonne est renommée dans le DBML ;
      une annotation DBML pour les données initiales.
- [ ] **Fusion par champ dans une même table** (deux personnes sur deux colonnes de la même
      table : le dernier gagne) : touche le même code que les verrous, à décider ensemble.
- [ ] **Variantes (Phase 35), avant tout code** : export DBML d'une variante ; une variante
      peut-elle ajouter des données initiales à une table verrouillée dans la base ; profondeur
      de la hiérarchie ; les variantes couvrent-elles les « branches de schéma » ?
- [ ] **Conseiller de requêtes, avant tout code** : analyseur SQL multi-dialecte existant, ou
      analyseur maison limité à `SELECT`.
- [ ] **IA** : un fournisseur pourra-t-il voir des échantillons anonymisés ? Aujourd'hui :
      structure seulement.
- [ ] **Journaux côté base** : durée de conservation par défaut ; export syslog / SIEM.
      **Trafic** : accepter une estimation du volume pour PostgreSQL ?
- [ ] **`ATHANORDB_SQLITE_DIR` par défaut** : changement cassant à planifier. Blocage général
      des adresses privées : reste désactivé par défaut ?
- [ ] **Rôles au-delà de lecture / édition / administrateur** : seulement sur demande réelle.
- [ ] **Refonte visuelle** : avant les nouvelles fonctionnalités ou en parallèle ; maquettes
      Figma d'abord ?
- [ ] **Phase 38** : une trentaine d'idées, aucune arbitrée — à couper ou promouvoir une à une.

### 2.4 Décidé à votre place depuis le 2 octobre — à lire une fois

Chaque point est détaillé sous « Decisions taken » dans sa phase de `todo.md`. Aucun n'a été
confirmé. Non coché signifie « pas encore relu », pas « à faire ».

- [ ] **Composants** : construits maison, sans dépendance. Coller sur le canevas : une relation
      vers une table non copiée est abandonnée.
- [ ] **Verrous** : « Structure » et « Complet » appliqués de la même façon ; par table, jamais
      par colonne ; un verrou d'instance ne se lève que par un administrateur de l'instance.
- [ ] **Politique de structure** : par connexion, avec un défaut d'instance ; **le défaut est
      « via le schéma uniquement » et s'applique à la mise à jour** ; vues, fonctions et
      déclencheurs non interceptés.
- [ ] **Espace de travail et historique** : les autres onglets remplacent l'éditeur (la
      sélection est perdue à l'aller-retour) ; modifications regroupées par 2 min / 15 min ;
      à la restauration partielle, une clé étrangère suit la table qui la porte.
- [ ] **Environnements** : au plus une étape de production ; un administrateur de projet peut
      choisir l'étape d'une connexion.
- [ ] **Pipeline** : une carte, pas un onglet ; « promouvoir » = déployer le même schéma à
      l'étape suivante ; sauter une étape est réservé aux administrateurs de l'instance, avec
      un motif.
- [ ] **Variables** : noms de table et schémas seulement ; valeurs limitées aux caractères
      d'identifiant.
- [ ] **Risques** : en production, chaque risque critique exige une réponse explicite.
- [ ] **Sauvegardes** : administrateurs de l'instance seulement ; **pas un instantané
      cohérent** (tables lues l'une après l'autre) ; un déploiement en production sauvegarde
      d'abord et **est refusé si la sauvegarde échoue** ; plafond de 512 Mo.
- [ ] **Restauration** : données seulement ; nom de la cible retapé pour toute cible ;
      sauvegarde de sécurité d'abord ; même moteur uniquement.
- [ ] **Données initiales et génération** : stockées dans la base de l'application ;
      « ajouter si vide » par défaut ; générateur maison, 10 000 lignes au plus, pas
      d'insertion directe.
- [ ] **Surveillance et notifications** : surveillance désactivée par défaut, structure
      seulement ; notifications sur abonnement, par projet et par événement, jamais pour sa
      propre action.
- [ ] **Linter et dictionnaire** : exceptions et descriptions vivent dans la **note** de la
      table (une ligne de DBML) ; seul le niveau erreur bloque, et seulement si le projet le
      demande ; le responsable est un texte libre.
- [ ] **Visite guidée** : sans voile, une fois par navigateur (pas par compte).

---

## 3. Tests à faire

Colonne **Automatisable** : **Oui** = un test peut le vérifier sans personne, il reste à
l'écrire ou à lui fournir son environnement ; **En partie** = un test couvre le mécanisme, un
humain doit juger le résultat ; **Non** = dépend d'un service extérieur, du temps réel ou de
l'œil.

### 3.1 Avec de vrais serveurs de base de données

La machine de développement n'a pas Docker : seul SQLite a été exercé. Les fichiers
`docker-compose.test.yml`, `docker-compose.mssql.yml` et `docker-compose.oracle.yml` du dépôt
servent à cela.

| #   | Test                                                                                                                                                                              | Automatisable           | Comment                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| T1  | **Les 6 tests que la suite ignore** : ce sont les tests réels des pilotes (PostgreSQL, MySQL…). « La suite est verte » veut dire « verte sans eux » depuis le 2 octobre           | **Oui — déjà écrits**   | Démarrer les conteneurs puis `npm test`. À brancher dans la CI avec des services de base de données. À faire en premier   |
| T2  | **Comptes SQL personnels, connexion réelle** : compte accepté, mauvais mot de passe refusé, déploiement et SQL tracés sous ce compte dans les journaux de la base, droit manquant | **Oui** (test à écrire) | Test réel qui crée deux rôles dans le conteneur. La lecture des journaux de la base reste à faire à la main une fois      |
| T3  | **Sauvegarde et restauration** sur PostgreSQL, MySQL, SQL Server, Oracle : entier 64 bits, binaire, NULL et chaîne vide, dates, colonnes identité et séquences                    | **Oui** (test à écrire) | Même scénario que le test SQLite existant, rejoué par moteur                                                              |
| T4  | **Reprendre les lignes d'une table** comme données initiales, sur les quatre moteurs ; dates Oracle                                                                               | **Oui** (test à écrire) | Idem                                                                                                                      |
| T5  | **Insertion des données initiales et sondes de risque** sur les quatre moteurs                                                                                                    | **Oui** (test à écrire) | Déployer un schéma avec données, puis un changement destructif, et lire les risques mesurés                               |
| T6  | **Variables `{{schema}}`** sur un moteur qui a des schémas                                                                                                                        | **Oui** (test à écrire) | PostgreSQL suffit                                                                                                         |
| T7  | **Surveillance et dérive sur un vrai moteur** : un type que la table d'alias ne connaît pas se lit comme un faux « modifié »                                                      | **Oui** (test à écrire) | Déployer puis vérifier qu'aucune dérive n'est signalée sans changement                                                    |
| T8  | **Comparer deux environnements de moteurs différents**                                                                                                                            | **En partie**           | Le test s'écrit ; décider si une différence signalée est vraie ou due aux alias de types demande un humain                |
| T9  | **Panneau des utilisateurs de base** : cinq listes migrées sans jamais avoir été affichées (SQLite n'a pas d'utilisateurs)                                                        | **Oui** (test à écrire) | Test navigateur contre un conteneur PostgreSQL — l'outillage des tests navigateur ne sait aujourd'hui démarrer que SQLite |
| T10 | **Sondes de risque sur une très grande table** : un comptage peut durer jusqu'à sa coupure de 5 s                                                                                 | **En partie**           | Automatisable avec un jeu de données volumineux, mais lourd : une mesure à la main suffit                                 |

### 3.2 Sans serveur de base de données

| #   | Test                                                                                                                                                                                                                                                                         | Automatisable                     | Comment                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T11 | ~~Import du schéma depuis le formulaire de connexion~~                                                                                                                                                                                                                       | **Automatisé le 2026-10-06**      | `e2e/connection-form.e2e.ts` : annuler ne change rien, confirmer importe les tables                                                                                                                                  |
| T12 | ~~Champs du formulaire de connexion et options d'un webhook~~                                                                                                                                                                                                                | **Automatisé le 2026-10-06**      | `e2e/connection-form.e2e.ts`, `e2e/webhook-options.e2e.ts`. Le premier a trouvé un bogue, corrigé : une connexion passée d'une URI à hôte et port gardait son URI et continuait de se connecter à l'ancienne adresse |
| T13 | ~~Plugins face aux verrous de table~~                                                                                                                                                                                                                                        | **Automatisé le 2026-10-06**      | `e2e/plugins-locks.e2e.ts` : le verrou tient dans les quatre cas ; voir D16 pour ce que le test a montré                                                                                                             |
| T14 | **Fenêtre de déploiement après découpage** : couverte par dix tests, mais personne ne l'a regardée                                                                                                                                                                           | **En partie**                     | Le comportement est testé ; l'aspect demande un coup d'œil sur chaque étape (ou des captures comparées)                                                                                                              |
| T15 | **Deux régressions de performance** relevées sur une seule passe de mesure                                                                                                                                                                                                   | **En partie**                     | Le banc de mesure existe : le relancer. Juger si l'écart compte reste humain                                                                                                                                         |
| T16 | **E-mail par un vrai relais SMTP** : jamais vérifié au-delà du test local                                                                                                                                                                                                    | **Non**                           | Dépend du relais et de la délivrabilité. Un envoi manuel (invitation ou réinitialisation). Un faux serveur SMTP ne teste que le protocole                                                                            |
| T17 | **Sauvegardes planifiées sur plusieurs jours** : heure locale du serveur, rattrapage après arrêt, nombre conservé                                                                                                                                                            | **Non** (le mécanisme l'est déjà) | Déjà testé avec une horloge simulée ; l'observation en conditions réelles prend des jours                                                                                                                            |
| T18 | **Sauvegarde au-delà du plafond de taille**, puis refus du déploiement en production                                                                                                                                                                                         | **Déjà automatisé** sur SQLite    | Reste à l'essayer une fois sur une copie d'une vraie base volumineuse                                                                                                                                                |
| T19 | **Écrans migrés le 6 octobre qu'aucun test ne clique** : équipes d'un projet, suppression d'utilisateur, filtre des erreurs, invitations, membres d'équipe, portées de clé d'API, codes de secours, conversion de types, format d'import, ajout d'index, « rester connecté » | **Oui** (tests à écrire)          | Tous faisables sur cette machine                                                                                                                                                                                     |
| T20 | **Grille de résultats sur de vraies données** : table large, texte long, 10 000 lignes — défiler, trier, redimensionner, exporter                                                                                                                                            | **En partie**                     | Le mécanisme est testé (29 tests unitaires, un test navigateur) ; l'usage réel se juge à l'œil                                                                                                                       |
| T21 | **Exemple de CI du guide de l'API** : ses filtres `jq` ont été relus, pas exécutés ; la tâche GitHub Actions n'a jamais tourné                                                                                                                                               | **Oui**                           | L'exécuter une fois avec un vrai `jq`, et une fois dans un dépôt                                                                                                                                                     |

---

## 4. À vérifier avant de mettre à jour une vraie instance

Faire d'abord une sauvegarde (`npm run backup -- <dossier>`) : les migrations sont à sens
unique. Essayer la mise à jour sur une **copie** de la base de l'instance.

| #   | Vérification                                                                                                                                                                      | Automatisable | Comment                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------- |
| V1  | **Migrations 20 à 35 sur une copie de la vraie base** : chacune est testée sur une petite base peuplée, pas sur la vôtre                                                          | **En partie** | Un script peut copier la base et démarrer l'application dessus ; le résultat se relit |
| V2  | **Environnements** : chaque libellé est devenu une étape, avec un ordre et un drapeau « production » devinés                                                                      | **Non**       | Ouvrir Admin → Environnements et corriger                                             |
| V3  | **Politique de structure** : par défaut « via le schéma uniquement », donc le DDL de table est refusé dans la console sur une base rattachée à un projet                          | **Non**       | Choix de l'administrateur, en haut de la liste des connexions                         |
| V4  | **Pipeline** : toutes les étapes affichent « en retard » jusqu'à un premier déploiement ; un déploiement en production est refusé tant que l'étape précédente n'a pas le schéma   | **Non**       | Déployer d'abord sur l'étape précédente, ou passer la suivante en « Libre »           |
| V5  | **Scripts d'API qui déploient en production** : ils doivent maintenant envoyer le nom de la connexion et leurs réponses aux risques ; un libellé d'environnement libre est refusé | **En partie** | Recenser les scripts à la main ; chacun peut ensuite être essayé contre une copie     |
| V6  | **Sauvegarde avant déploiement en production** : place sur le dossier des sauvegardes, plafond de taille face aux bases de production, durée de conservation                      | **Non**       | Vérification d'exploitation                                                           |
| V7  | **Projets en profil de lint Strict qui bloquent sur erreur** (voir D4)                                                                                                            | **Oui**       | Une requête sur la table des réglages de lint les liste                               |
| V8  | **« Annuler » sur un risque annule désormais vraiment** le déploiement                                                                                                            | **Non**       | Prévenir ceux qui cliquaient au travers                                               |
| V9  | **`ATHANORDB_SECRET`** : le perdre fait aussi perdre les sauvegardes, les comptes personnels et les secrets de webhook                                                            | **Non**       | Vérifier qu'il est lui-même sauvegardé, hors de l'instance                            |
| V10 | **`npm run rotate-secret`** rechiffre aussi les comptes personnels                                                                                                                | **Oui**       | À lancer une fois sur une copie si une rotation est prévue                            |
| V11 | **Nettoyage des lignes orphelines** d'avant la correction de la suppression de projet                                                                                             | **Oui**       | Une commande SQL, une seule fois                                                      |
| V12 | **Les entrées « read before upgrading » du changelog**, de haut en bas                                                                                                            | **Non**       | Lecture                                                                               |

---

## 5. Relectures dues

La règle de la Phase 27 : une relecture de sécurité **indépendante**, par quelqu'un qui n'a pas
eu le nez dans ce code, avant de clore l'élément. Aucune n'a été faite.

| #   | Relecture                                                                                                                                          | Automatisable | Comment                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| R1  | **Comptes SQL personnels** : sous quel compte chaque instruction s'exécute ; l'acteur porté par la requête ; la route qui essaie un compte         | **Non**       | Relecture humaine. Un outil d'analyse peut préparer le terrain, pas la remplacer                                       |
| R2  | **Verrous de table** sur tous les chemins d'écriture ; **politique de structure** et son interception                                              | **Non**       | Idem                                                                                                                   |
| R3  | **Phase 32** : environnements et confirmation de production, pipeline et saut d'étape, variables, détection destructive, sauvegardes, restauration | **Non**       | Idem                                                                                                                   |
| R4  | **Données initiales** et leur déploiement ; lecture d'une table comme données initiales                                                            | **Non**       | Idem                                                                                                                   |
| R5  | **Utilisateurs et permissions des bases** depuis la console ; **changement de sens des relations**, qui a modifié le SQL de déploiement            | **Non**       | À faire avant le prochain vrai déploiement                                                                             |
| R6  | **Fuites possibles** par les sondes de risque à travers une frontière de permission                                                                | **Non**       | Idem                                                                                                                   |
| R7  | **Relecture juridique** des CGU et de la politique de confidentialité, y compris le nouveau §2.8 (comptes personnels)                              | **Non**       | Un juriste                                                                                                             |
| R8  | **Audit d'accessibilité** de l'interface : aucun n'a été fait                                                                                      | **En partie** | Un outil automatique trouve les contrastes et les libellés manquants ; clavier et lecteur d'écran se testent à la main |

---

## 6. Ce qui peut être automatisé, en résumé

- **Déjà écrit, il manque l'environnement** : T1 (les 6 tests réels des pilotes). C'est le
  meilleur rapport effort / gain : des conteneurs dans la CI et ces tests tournent à chaque
  poussée.
- **À écrire, sans décision de votre part** — une fois les conteneurs disponibles : T2 à T7 et
  T9 ; dès maintenant, sur cette machine : T19, T21, V7. (T11, T12 et T13 ont été écrits le
  6 octobre.)
- **En partie seulement** — le test existe ou s'écrit, un humain juge le résultat : T8, T10,
  T14, T15, T20, V1, V5, R8.
- **Pas automatisable** : T16 (vrai relais SMTP), T17 (plusieurs jours d'observation), les
  vérifications d'exploitation V2, V3, V4, V6, V8, V9, V12, et toutes les relectures de
  sécurité et juridique (R1 à R7).

# AthanorDB — guide d'utilisation

Ce guide s'adresse aux **utilisateurs** de l'application. Pour installer,
configurer et exploiter un serveur, voir le [README](../README.md) ; pour
contribuer au code, [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## 1. Premiers pas

### Se connecter

AthanorDB n'a pas d'inscription libre : un administrateur crée une invitation,
et vous recevez un lien `/invite/<token>`, valable 7 jours, sur lequel vous
choisissez votre mot de passe — par e-mail si l'instance en envoie, sinon
transmis à la main par l'administrateur. **Ce lien vaut création de compte** —
il n'est protégé par rien d'autre, ne le faites pas suivre.

Si vous perdez votre mot de passe, le lien **« Mot de passe oublié ? »** sous le
formulaire de connexion vous envoie un lien de réinitialisation, valable une
heure et utilisable une seule fois. Choisir un nouveau mot de passe déconnecte
toutes vos sessions ouvertes et débloque un compte bloqué ; la double
authentification, elle, reste exigée. Ce lien n'apparaît que si l'instance est
configurée pour envoyer des e-mails — sinon, seul un administrateur peut
réinitialiser votre mot de passe.

### Le tableau de bord

À la connexion, vous voyez vos projets, répartis entre **Actifs**, **Archivés**
et **Corbeille**. Un projet mis à la corbeille est récupérable ; la suppression
définitive, elle, ne l'est pas.

Le champ de recherche filtre la liste par nom et, dès deux caractères, cherche
aussi **dans le contenu** de tous les projets auxquels vous avez accès : tables,
colonnes et enums dont le nom correspond. Cliquer un résultat ouvre le projet
centré sur la table, colonne surlignée. Le bouton de création ouvre
directement un schéma vide ; **Depuis un modèle** propose à la place un schéma
de départ déjà relié et disposé sur le canevas (blog, e-commerce, SaaS
multi-tenant, authentification). Le projet créé est un projet ordinaire : tout
y reste modifiable.

---

## 2. L'éditeur

Un projet s'ouvre sur un **espace de travail** à onglets, sous l'en-tête :

- **Schéma** — l'éditeur décrit ci-dessous ;
- **Données & SQL** — la base elle-même : explorateur, console SQL, comptes et
  sessions (section 5). Réservé aux administrateurs de l'instance, et présent
  seulement si une base est rattachée au projet ;
- **Déploiements** — ce qui a été déployé sur la base courante, le retour
  arrière, la comparaison schéma / base et le déploiement. Réservé aux
  administrateurs du projet ;
- **Historique** — les versions du schéma (section 4) ;
- **Problèmes** — ce que le linter trouve dans le schéma, avec le nombre de
  constats sur l'onglet (voir « Qualité du schéma » plus bas) ;
- **Dictionnaire** — ce que chaque table et chaque colonne signifie (voir
  « Dictionnaire de données » plus bas).

Chaque onglet a sa propre adresse : on peut la partager, recharger la page ou
utiliser les boutons précédent / suivant du navigateur. À droite de la barre, le
sélecteur indique la **base courante** — celle que visent Données & SQL,
Déploiements et le bouton Déployer — avec son étape (environnement), en rouge
quand c'est l'étape de production.

Sur l'onglet Schéma, les administrateurs de l'instance disposent aussi d'un
**panneau SQL** sous le diagramme (bouton _SQL_ de la barre d'onglets, ou
`Ctrl+J`), redimensionnable, branché sur la base courante. Le bouton **Voir les
données** de l'en-tête d'une table y affiche ses premières lignes. Ce panneau
suit les mêmes règles que la console SQL (section 5) : lecture seule par défaut,
tout est journalisé, et un changement de structure est renvoyé vers le schéma.

L'onglet Schéma a deux moitiés synchronisées en permanence :

- à gauche, le **panneau DBML** — le schéma sous forme de texte ;
- à droite, le **canvas** — le même schéma sous forme de diagramme.

Éditer l'un met l'autre à jour. Le texte DBML se synchronise environ 600 ms
après votre dernière frappe ; la barre d'état de l'éditeur indique où il en est
(_Synchronisé_, _En attente_, _Erreur ligne n_). Tant que vous tapez, c'est
votre texte qui fait foi : il n'est ni reformaté ni remplacé.

Le bouton ⚙ de cette barre d'état liste ce que l'éditeur fait de lui-même, et
permet de le régler (par navigateur) : formatage automatique (jamais par
défaut, ou à l'enregistrement — le bouton _Formater_ et `Maj+Alt+F` restent
disponibles), complétion pendant la frappe, fermeture des crochets, et délai de
synchronisation — jusqu'à « uniquement sur `Ctrl+S` ».

### Créer et modifier des tables

Depuis la barre d'outils flottante en bas du canvas, ou par un clic droit sur
une zone vide, vous pouvez insérer une **table**, une **zone** (rectangle de
regroupement visuel), une **note autocollante** ou un **enum**.

- Double-cliquez l'en-tête d'une table pour la renommer.
- Cliquez un champ pour ouvrir son éditeur (nom, type, valeur par défaut,
  clé primaire, non-null, note).
- Faites glisser depuis le point d'ancrage d'un champ vers un autre champ pour
  créer une relation.
- L'icône d'engrenage d'une table ouvre ses réglages : couleur, et la section
  **Index** (créer un index composite, le marquer unique et/ou clé primaire).
  Une table n'a qu'une clé primaire : marquer un index comme PK retire la
  marque des autres champs.

Sélectionnez au moins deux tables pour faire apparaître le bouton **Grouper**,
qui crée un `TableGroup` (cadre en pointillés autour des tables membres).

### Niveau de détail et lisibilité

La barre d'outils règle le **niveau de détail** (compact / standard / complet),
la **taille du texte**, l'affichage de la minimap et la mise en évidence des
relations. Ces réglages sont visuels et partagés par le projet.

### Qualité du schéma (onglet Problèmes)

Pendant que vous modélisez, le schéma est comparé à des **conventions** : clé
primaire présente, clés étrangères indexées, noms en `snake_case`, `varchar`
avec une longueur, colonnes `created_at` / `updated_at`, pas de flottant pour
un montant, tables décrites. L'onglet **Problèmes** liste les constats table
par table, par niveau (erreur, avertissement, info) ; les erreurs et
avertissements apparaissent aussi sur la table dans le diagramme, et tous sont
soulignés dans l'éditeur DBML.

- **Ouvrir dans le schéma** / **Voir la colonne** amène sur la table concernée.
- Deux constats se corrigent d'un clic, parce qu'il n'y a rien à décider :
  **Ajouter une clé « id »** (table sans clé ni colonne `id`) et **Créer
  l'index** (clé étrangère sans index). C'est une modification du schéma comme
  une autre : elle s'annule avec `Ctrl+Z` et respecte les verrous.
- Les **administrateurs du projet** choisissent les règles, en bas de l'onglet :
  un profil (**Souple**, **Standard** — par défaut —, **Strict**) ou le niveau
  de chaque règle (le projet passe alors en profil **Perso**), une liste de
  **types interdits** et de **colonnes obligatoires** dans chaque table, et
  les **exceptions** (« Ignorer pour cette table »).
- Une table peut aussi s'exempter elle-même, dans sa note :
  `lint-ignore: pk-required` (plusieurs règles séparées par des virgules, ou
  `lint-ignore: all`). Cette mention suit le DBML ; elle ne compte pas comme
  description.
- **Refuser un déploiement tant qu'une erreur est ouverte** (désactivé par
  défaut) : le serveur refuse alors de déployer un schéma qui a un constat de
  niveau erreur, depuis l'application comme par l'API. Les avertissements et
  les infos ne bloquent jamais.

Ce que le linter ne fait pas : il ne regarde que la structure du schéma (pas
les données ni la base déployée), et ses règles de nommage se limitent au
`snake_case` — pas encore de motif de nom personnalisé.

### Dictionnaire de données (onglet Dictionnaire)

Pour chaque table et chaque colonne : une **description**, un **responsable**
(tables), une **classification** — public, interne, personnel, sensible — et
des **étiquettes**. Un champ est enregistré dès qu'on le quitte. La barre en
haut indique la part du schéma décrite ; la recherche et les filtres **À
documenter** et **Données personnelles** réduisent la liste.

Tout est écrit dans la **note** de la table ou de la colonne, à la suite de la
description : `Comptes clients. [owner: equipe-crm] [class: personal] [tags:
rgpd]`. Le dictionnaire fait donc partie du schéma : il suit l'historique,
l'export et l'import DBML, et peut s'écrire directement dans l'éditeur DBML. Une
table verrouillée ne se documente que par ceux que le verrou ne lie pas. Une
description tient sur une ligne.

**Markdown**, **CSV** et **HTML** téléchargent le dictionnaire ; l'API le sert
aussi (`/api/v1/projects/:id/dictionary`). Il n'y a pas encore d'export PDF.

### Vue conceptuelle (MCD)

Le bouton **MLD / MCD** de la barre d'outils bascule vers une vue en notation
Merise : chaque table devient une entité, chaque relation une association,
dérivées automatiquement du schéma. C'est une vue de **lecture seule** — on
peut y déplacer les éléments pour aérer l'affichage (bouton de réinitialisation
inclus), mais toute modification du schéma se fait toujours depuis le MLD ou
le DBML. Une table dont la clé ne se laisse pas reconstruire proprement en
association (association ternaire probable, table de jonction ambiguë) est
signalée plutôt que silencieusement mal convertie.

### Raccourcis clavier

| Raccourci                                  | Effet                                            |
| ------------------------------------------ | ------------------------------------------------ |
| `Ctrl`/`Cmd` + `Z`                         | Annuler                                          |
| `Ctrl`/`Cmd` + `Maj` + `Z` ou `Ctrl` + `Y` | Rétablir                                         |
| `Ctrl`/`Cmd` + `D`                         | Dupliquer la sélection                           |
| `Ctrl`/`Cmd` + `C` puis `Ctrl`/`Cmd` + `V` | Copier / coller les tables sélectionnées         |
| `Ctrl`/`Cmd` + `F`                         | Rechercher une table sur le canvas               |
| `Entrée` / `Maj`+`Entrée`                  | Résultat suivant / précédent (dans la recherche) |
| `Échap`                                    | Fermer la recherche ou le panneau ouvert         |

Le copier / coller passe par le presse-papiers du système : il fonctionne
d'un projet à l'autre, et coller dans l'éditeur DBML donne le texte des tables.
Les copies gardent couleurs, colonnes, index et réglages ; seul le nom change
(`clients_copy`, puis `clients_copy2`…). Les relations entre deux tables
copiées suivent les copies ; celles vers une table non copiée sont laissées de
côté. Le clic droit sur une zone vide propose aussi _Copier_ et _Coller_ (à
l'endroit du clic).

Les raccourcis du canvas sont ignorés pendant que vous tapez dans un champ ou
dans l'éditeur DBML. Les plugins peuvent en déclarer d'autres (voir §7).

> À savoir : `Ctrl+Z` annule vos modifications faites **sur le canvas**. Les
> modifications faites dans le panneau DBML reviennent par le serveur comme
> celles d'un collaborateur, et sortent donc de la pile d'annulation locale —
> pour revenir en arrière sur celles-là, utilisez l'historique (§4).

---

## 3. Travailler à plusieurs

Chaque projet ouvert est un document partagé : les modifications simultanées
fusionnent automatiquement, sans verrou. Les avatars en haut de l'écran montrent
qui est présent, et le curseur de chacun est visible sur le canvas.

Une pastille indique l'état de la connexion (`connecté`, `connexion…`,
`reconnexion…`). En cas de coupure, l'application retente automatiquement et
resynchronise vos modifications à la reconnexion — **tant que l'onglet reste
ouvert**. Il n'y a pas de mode hors-ligne : fermer l'onglet pendant une coupure
perd ce qui n'a pas été synchronisé.

Si vous avez un accès en **lecture seule**, le canvas reste consultable mais
toute modification est refusée par le serveur. Si vos droits changent pendant
que vous travaillez, le changement s'applique en quelques secondes sans avoir à
recharger.

### Verrouiller une table

Un administrateur du projet peut **verrouiller** une table : survolez-la et
cliquez sur le cadenas de son en-tête. Le verrou gèle sa structure — nom,
colonnes, types, contraintes, index, clés étrangères qu'elle porte, et sa
suppression. Tout le monde continue de voir la table, de la déplacer, de changer
sa couleur et de la commenter ; les administrateurs du projet peuvent toujours la
modifier.

- Le cadenas, avec le nom de la personne qui l'a posé et le motif, apparaît chez
  tous les collaborateurs sans recharger.
- Une modification qui touche une table verrouillée est refusée **en entier** :
  un import ou une synchronisation de l'éditeur DBML qui change aussi d'autres
  tables n'est pas appliqué à moitié. Le message nomme les tables en cause.
- La règle vaut partout : canvas, éditeur DBML, import, restauration d'une
  version, récupération depuis une base, API.
- Un administrateur de l'instance peut poser un verrou que seuls les
  administrateurs de l'instance pourront lever.
- Dupliquer une table verrouillée donne une copie libre.
- Dès qu'une table est verrouillée, un cadenas avec leur nombre apparaît dans la
  barre des onglets : il ouvre **Verrous du projet**, la liste de toutes les
  tables verrouillées (niveau, auteur, date, motif). Tout le monde peut la
  lire et aller à la table ; ceux qui peuvent gérer un verrou le modifient ou
  le lèvent depuis cette liste.

Les deux niveaux, _Structure_ et _Complet_, gèlent la structure de la même
façon ; _Complet_ gèle en plus les données initiales de la table (§5). Le détail de qui peut faire quoi est dans
[`permissions.md`](permissions.md).

### Commentaires

Une table ou une colonne peut porter un fil de discussion. Il n'y a pas encore
de mentions ni de notifications : les réponses se découvrent en ouvrant le fil.

---

## 4. Historique et versions

L'onglet **Historique** présente les révisions du projet, de la plus récente à
la plus ancienne. Les modifications faites à la suite par une même personne
sont regroupées sur une ligne (« 3 étapes » — la flèche les déplie), avec les
tables touchées (`+` ajoutée, `~` modifiée, `−` supprimée). La case
**Mes modifications** ne garde que les vôtres. Entre les révisions apparaissent
les verrous posés ou levés, les restaurations et, pour les administrateurs du
projet, les déploiements. Vous pouvez :

- consulter l'état du schéma à une révision donnée, et ce qui a changé depuis ;
- **Aperçu sur le graphe** : le schéma s'affiche avec les tables ajoutées depuis
  cette révision entourées de vert, celles modifiées d'orange ; un bandeau nomme
  celles supprimées depuis. **Fermer l'aperçu** enlève les couleurs ;
- nommer une révision (pour retrouver un jalon) ;
- restaurer une révision — ce qui applique cet état comme une nouvelle
  modification, sans effacer l'historique intermédiaire ;
- restaurer **une seule table** (bouton **Restaurer** au survol d'une ligne des
  modifications, ou **remettre** dans le bandeau d'aperçu) : elle revient comme
  dans la révision, avec ses clés étrangères, et le reste du schéma ne bouge pas.

Une table verrouillée ne peut pas être modifiée par une restauration, entière
ou partielle.

**Comparer** (barre d'outils) confronte le projet ouvert à un autre projet
auquel vous avez accès. Les tables et colonnes sont rapprochées par leur nom :
vous voyez celles qui manquent, celles en trop et les colonnes modifiées (type,
nullabilité, valeur par défaut…). L'onglet _SQL de migration_ donne le script
qui transforme un schéma en l'autre, dans le dialecte de votre choix ; le bouton
⇄ inverse le sens. Ce script est à relire avant toute exécution.

---

## 5. Connecter une vraie base de données

Les connexions sont créées par un administrateur de l'instance, dans
**Admin → Connexions base de données** (voir « Administrer les bases
connectées » plus bas), puis **rattachées aux projets** qui peuvent s'en
servir. Moteurs pris en charge : **PostgreSQL, MySQL/MariaDB, SQL Server,
Oracle et SQLite** — hôte/port ou URI de connexion, avec test avant
enregistrement. Pour un projet, deux usages :

- **Importer le schéma de la base** — lit le schéma réel et remplace le vôtre
  sur le canvas (utile pour démarrer depuis une base existante plutôt que de
  la modéliser à la main).
- **Déployer** — compare le schéma du canvas à la base cible et propose un
  assistant en quatre étapes : les changements détectés, la résolution des
  conflits dangereux (une colonne supprimée qui contient des données peut être
  conservée en base plutôt que droppée, un changement de type peut forcer un
  `CAST`, remplir les `NULL` par une valeur par défaut, etc. — à choisir
  changement par changement), un aperçu du SQL exact avant toute exécution,
  puis le résultat.

Avant tout déploiement, le plan **mesure ce que chaque changement ferait aux
données** déjà en base, par des agrégats seulement (comptes, longueur
maximale — jamais le contenu des lignes) : table ou colonne supprimée qui
contient des données, NOT NULL posé sur des valeurs NULL, nouvelle colonne
NOT NULL sans défaut, longueur réduite sous la plus longue valeur, unicité sur
des doublons, clé étrangère sur des lignes orphelines. Pour chaque risque, vous
choisissez quoi faire ; **« Annuler / Gérer manuellement » bloque le
déploiement** tant que les données ou le schéma ne sont pas corrigés. L'aperçu
SQL suit vos choix, et quand un choix supprime des données, vous pouvez dire
pourquoi : la raison est gardée dans l'historique avec le déploiement.

**Données initiales.** Une table peut apporter ses premières lignes : le
bouton _Données initiales (CSV)_ de son en-tête prend un fichier CSV (2 Mo et
50 000 lignes au plus), associe ses colonnes à celles de la table par leur nom
(modifiable), et montre un aperçu vérifié — type, NOT NULL, longueur, doublons
sur une clé, colonne obligatoire absente. Au déploiement, ces lignes sont
insérées après le schéma, les tables parentes d'abord ; par défaut seulement
si la table est vide (« Ajouter si vide »), sinon à chaque fois (« Toujours
ajouter »). Le plan indique `clients : +248 lignes` et permet de ne pas les
insérer cette fois. Des données avec erreurs bloquent le déploiement tant
qu'elles ne sont pas corrigées.

Un administrateur de l'instance peut aussi partir de **ce que la base contient
déjà** : dans le même dialogue, _Reprendre les lignes de la base_ lit la table
dans la base courante ; depuis _Données & SQL_, le bouton _Données initiales_
d'une table fait la même chose en ouvrant le dialogue. Les lignes sont montrées
vérifiées comme un fichier et **rien n'est enregistré avant « Enregistrer »**.
Seules les colonnes présentes à la fois dans le schéma et dans la base sont
reprises ; une colonne binaire est laissée de côté ; au-delà de 50 000 lignes
ou d'environ 2 Mo, seules les premières lignes sont reprises — dans les trois
cas le dialogue le dit.

**Générer des données de test.** L'onglet _Générer_ du même dialogue fabrique
des lignes à partir de la seule structure de la table : un générateur par
colonne, proposé d'après son nom et son type (e-mail, téléphone, prénom, ville,
dates, nombres, liste de valeurs pondérées, UUID, séquence…), un volume, une
graine (la même graine redonne les mêmes lignes) et une langue. Une clé
étrangère puise dans les données initiales de la table parente. L'aperçu se
régénère à volonté ; **Utiliser comme données initiales** passe les lignes à
l'onglet Fichier, où elles sont vérifiées et enregistrées comme un CSV, et
**Exporter en CSV** les télécharge.

**Pipeline.** En haut de l'onglet _Déploiements_, la carte **Pipeline** range
les bases du projet dans l'ordre des étapes et dit, pour chacune, si elle est
**à niveau** (le schéma actuel y a été déployé), **en retard**, en **échec** ou
**jamais déployée**. Une étape dont la protection n'est pas « Libre » — la
production l'est toujours — ne reçoit le schéma qu'une fois l'étape précédente
du projet à niveau : la carte affiche « Attend DEV », et le déploiement est
refusé tant que ce n'est pas fait. Un administrateur de l'instance peut passer
outre pour un correctif urgent : après le refus, il saisit un motif et choisit
**Sauter l'étape et déployer** ; le motif est journalisé. Une base sans étape
est en dehors du pipeline.

**Variables par environnement.** Un même schéma peut porter des noms différents
selon l'étape : écrivez `{{variable}}` dans le nom ou le schéma d'une table —
`Table "{{table_prefix}}commandes"` — et un administrateur de l'instance donne
sa valeur sur chaque étape (Admin → Environnements, champ _Variables_ :
`table_prefix=pp_, schema=ventes` ; une valeur vide est permise). Le plan, le
déploiement, les données initiales et la vérification des différences
utilisent les noms de l'étape de la connexion ; le projet, lui, garde les
`{{…}}`. Si le schéma utilise une variable que l'étape ne définit pas — ou si
la base n'a pas d'étape —, le déploiement est refusé avant de toucher la base.
Les variables ne s'appliquent qu'aux noms et schémas de tables.

**Comparer deux environnements.** Quand le projet a au moins deux bases,
l'onglet _Déploiements_ propose de les comparer entre elles : choisissez les
deux bases, **Comparer** lit leur structure et liste, table par table, ce qui
n'existe que d'un côté et ce qui diffère (colonnes en plus ou en moins, type,
NOT NULL, valeur par défaut, clé, index, clés étrangères). Une table présente
dans une base mais absente du schéma est marquée **Hors schéma**. Seule la
structure est comparée, pas les données ; pour mettre deux bases au même
niveau, déployez le schéma sur chacune.

**Surveiller les modifications hors Athanor.** Dans l'onglet _Déploiements_,
un administrateur du projet peut faire relire ses bases à intervalle régulier
(de 5 minutes à une fois par jour) : chacune est comparée à l'état laissé par
le dernier déploiement ou import. Une différence qu'Athanor n'explique pas
(quelqu'un a modifié la base avec un autre outil) est listée, allume le
bandeau de l'éditeur et part aux webhooks du projet. Une base illisible est
signalée « injoignable », jamais comme une modification. Un déploiement ou un
import règle ce qui a été trouvé ; **Ignorer** l'écarte définitivement.

Chaque connexion est placée sur une **étape** de la chaîne de déploiement
(DEV › Staging › Prod par défaut — voir « Environnements » plus bas). Sur
l'étape marquée **production**, déployer ou annuler un déploiement demande de
**saisir le nom de la connexion** : rien ne s'exécute avant. L'API publique
applique la même règle (champ `confirmName`).

Chaque déploiement est gardé dans l'**historique de la connexion**, avec qui
l'a lancé et combien d'instructions ont été exécutées, et peut être **annulé**
(retour en arrière au mieux — pas une restauration depuis une sauvegarde : les
données réellement supprimées ne reviennent pas, et c'est signalé comme tel
plutôt que promis). Sur MySQL, un DDL ne peut pas être groupé dans une
transaction : un retour en arrière qui échoue en cours de route peut avoir
appliqué une partie des instructions — vérifiez la base cible dans ce cas.

Aucune exécution n'est automatique : l'assistant demande toujours une
confirmation explicite après avoir montré le SQL qui va tourner.

### Environnements (administrateurs de l'instance)

**Admin → Environnements** définit la chaîne d'étapes sur laquelle les
connexions sont placées, dans l'ordre (flèches pour avancer / reculer une
étape) : nom, couleur, niveau de protection, et la case **Production** — une
seule étape à la fois ; la cocher sur une autre la retire de la précédente.
L'étape de production apparaît en rouge partout et impose la saisie du nom de
la connexion avant un déploiement. Le niveau de protection (libre, revue,
protégé) est enregistré mais ne bloque encore rien : les garde-fous par étape
viendront avec le pipeline de promotion. Supprimer une étape laisse ses
connexions sans étape ; leur historique de déploiement garde le nom.

### Activité (administrateurs de l'instance)

**Admin → Activité** liste ce qui a été fait depuis Athanor et qui compte plus
tard : déploiements, changements de structure et de données sur les bases,
comptes et permissions, sessions, projets, configuration. Filtres : période,
type, projet, base, recherche libre ; une ligne s'ouvre sur son détail (auteur,
détail complet, projet avec un lien, base, IP, requête). **Exporter en CSV /
JSON** télécharge tout ce que les filtres retiennent. Les entrées ne peuvent
être ni modifiées ni supprimées.

### Administrer les bases connectées (administrateurs de l'instance)

**Admin → Connexions base de données** liste toutes les connexions de
l'instance, avec leur état (pastille verte : la base a répondu à la dernière
vérification), leurs tags et les projets rattachés. On y ajoute, modifie et
supprime une connexion ; les identifiants sont chiffrés et ne sont jamais
réaffichés. Cocher **Lecture seule** interdit toute écriture d'Athanor par
cette connexion (déploiement compris).

**Ouvrir** une connexion donne accès à la base elle-même :

- **Explorateur** — bases, schémas, tables et vues ; pour une table, ses
  données (paginées, exportables en CSV) et sa structure (colonnes, index,
  contraintes). On peut supprimer une colonne, une table, une vue ou une base :
  le SQL exact est affiché, et il faut saisir le nom de l'objet pour confirmer.
  Les objets système ne sont pas supprimables.
- **Console SQL** — en **lecture seule** par défaut : une seule instruction de
  lecture à la fois, avec délai maximal et résultat plafonné. Le **mode
  écriture** se coche explicitement et redemande confirmation à chaque
  exécution. Chaque requête est gardée dans votre historique et inscrite au
  journal d'audit (le texte de la requête, jamais ses résultats).
- **Utilisateurs et permissions** — les comptes et rôles de la base, leurs
  privilèges par serveur, base, schéma ou table ; création, suppression,
  changement de mot de passe, activation/désactivation, ajout à un rôle,
  attribution et révocation de privilèges. Chaque action montre son SQL avant
  de s'exécuter. Les différences entre moteurs sont respectées : comptes
  `utilisateur@hôte` sur MySQL, logins serveur et utilisateurs de base sur SQL
  Server, rôles sur PostgreSQL ; SQLite n'a pas de comptes. Un mot de passe
  saisi ou généré n'est ni stocké ni journalisé par Athanor : notez-le.
- **Sessions** — qui est connecté et ce qui s'exécute, avec la possibilité de
  terminer une session bloquée.
- **Sauvegardes** — voir ci-dessous.

**Sauvegarder et restaurer une base.** L'onglet **Sauvegardes** liste les
sauvegardes de la base ouverte. **Sauvegarder maintenant** en lance une : Athanor
lit la structure puis toutes les lignes, table par table, et les range dans un
fichier compressé et chiffré sur le serveur. La liste montre l'avancement, puis
la taille, le nombre de lignes et la date jusqu'à laquelle la sauvegarde est
conservée (30 jours par défaut) ; **épingler** une sauvegarde l'exclut de ce
nettoyage. On peut la **télécharger** (un fichier `.jsonl.gz` : une ligne JSON
par ligne de table) ou la supprimer.

**Restaurer** remet les lignes d'une sauvegarde dans la base : on choisit les
tables, la base cible (celle d'origine, ou une autre du même moteur) et on
saisit le nom de la base pour confirmer. Les tables choisies sont **vidées puis
remplies** — tout ce qui y a changé depuis la sauvegarde est perdu. Par défaut,
l'état actuel de ces tables est d'abord sauvegardé (il apparaît dans la liste,
« Avant restauration ») : c'est ce qui permet de revenir en arrière. À savoir :

- seules les **données** sont restaurées ; les tables et leurs colonnes doivent
  déjà exister (déployez le schéma d'abord) ;
- une table référencée par une autre ne se restaure pas seule : restaurez-les
  ensemble ;
- la restauration n'est pas une transaction unique : si elle échoue en cours de
  route, le résultat l'indique table par table, et la sauvegarde « Avant
  restauration » permet de retrouver l'état d'avant ;
- une connexion en lecture seule ne peut pas être restaurée.

C'est une sauvegarde **logique**, adaptée aux bases petites et moyennes : au-delà
de la limite de l'instance (512 Mo de données par défaut), elle échoue et
l'outil du moteur (`pg_dump`, `mysqldump`…) est le bon choix. Les tables sont
lues l'une après l'autre : sur une base très active, la sauvegarde n'est pas un
instantané parfaitement cohérent. Les vues, séquences et comptes n'en font pas
partie.

**Sauvegarder automatiquement.** En haut de l'onglet, l'interrupteur
« Sauvegarder automatiquement » planifie les sauvegardes de cette base : tous
les jours, toutes les semaines (un jour donné) ou tous les mois (un jour de 1 à
28), à l'heure choisie — **l'heure du serveur**. On indique combien de
sauvegardes planifiées garder : les plus anciennes sont supprimées après chaque
nouvelle, sauf celles qui sont épinglées. La date de la prochaine sauvegarde est
affichée ; si le serveur était arrêté à l'heure prévue, la sauvegarde manquée
est faite une fois à son retour. Un échec est signalé sur cette ligne et dans
la liste, mais n'envoie pas encore d'alerte.

**Avant un déploiement en production**, Athanor sauvegarde la base
automatiquement (case « Sauvegarder la base avant de déployer », cochée par
défaut sur l'environnement de production). Si la sauvegarde n'aboutit pas, rien
n'est déployé. L'historique des déploiements indique qu'une sauvegarde a été
prise ; seul un administrateur de l'instance peut la restaurer.

**La structure passe par le schéma.** Quand une connexion est rattachée à un
projet, la console ne modifie plus elle-même les tables ni les index : supprimer
une table ou une colonne depuis l'explorateur, ou exécuter un
`CREATE / ALTER / DROP TABLE` ou `INDEX` en SQL, ouvre à la place un message qui
renvoie vers le projet — **Ouvrir dans le schéma** l'ouvre directement sur la
table concernée. Le changement se fait là, puis se déploie : il garde son
historique et son retour arrière, et le schéma ne diverge pas de la base.

Ce comportement se règle en haut de la liste des connexions (défaut de
l'instance) et, connexion par connexion, dans sa fenêtre de modification :

- **Via le schéma uniquement** (défaut) — redirection, comme ci-dessus ;
- **Avertir** — autorisé après une confirmation explicite, et inscrit au journal
  d'audit comme fait hors schéma ;
- **Libre** — aucune restriction.

Quand un changement de structure est tout de même fait depuis la console
(politiques **Avertir** et **Libre**), chaque projet rattaché à cette base affiche
un bandeau dans son éditeur : « La base … a été modifiée en dehors du schéma ».
Les administrateurs du projet y voient le nombre de différences et peuvent
**voir les différences**, **resynchroniser** le schéma depuis la base, ou
**ignorer** l'avertissement. Un déploiement ou une resynchronisation le fait
disparaître. Les modifications faites par d'autres outils que la console ne
sont pas encore détectées.

Les données (`INSERT`, `UPDATE`, `DELETE`), les vues, les fonctions, les bases
entières et les connexions rattachées à aucun projet ne sont pas concernées.
C'est un garde-fou, pas un bac à sable : une instruction de structure construite
dans une procédure ou un bloc `DO` n'est pas détectée.

Le compte utilisé par la connexion doit lui-même avoir les droits nécessaires
(lire le catalogue, créer des rôles…) : sinon la base refuse, et son message
est affiché tel quel.

## 6. Import et export

**Importer** (bouton _Importer_) : collez du DBML ou du SQL, ou choisissez un
fichier `.dbml` / `.sql`. Le dialecte SQL est déduit de l'extension et
modifiable. L'import **fusionne** par nom : les tables existantes gardent leur
position et leurs réglages visuels au lieu d'être réinitialisées.

**Exporter** (bouton _Exporter_) :

| Format                              | Remarque                                                     |
| ----------------------------------- | ------------------------------------------------------------ |
| DBML                                | avec ou sans les métadonnées visuelles (positions, couleurs) |
| SQL PostgreSQL / MySQL / SQL Server | via `@dbml/core`                                             |
| PNG                                 | capture du canvas                                            |
| SVG                                 | vectoriel                                                    |
| PDF                                 | une page contenant une capture **matricielle** du canvas     |
| SQLite                              | fourni par le plugin d'exemple, pas en natif (voir §7)       |

Les exports sont enregistrés dans le journal d'audit de l'instance.

---

## 7. Plugins

_Menu plugins_ (barre d'outils du canvas) → **Gérer les plugins**. Un plugin
est un fichier JavaScript qui peut ajouter des formats d'export, des formats
d'import, des commandes de canvas et des commandes d'éditeur DBML.

- Les plugins s'installent **par navigateur** : ils ne sont jamais envoyés au
  serveur, et n'affectent ni vos collègues ni les autres projets.
- Ils s'exécutent dans un Worker isolé, sans accès au réseau (`fetch`,
  `WebSocket`, `XMLHttpRequest` sont retirés), sans accès au DOM ni au stockage
  du navigateur.
- Un plugin peut déclarer des réglages (affichés dans le gestionnaire) et des
  raccourcis clavier.
- Le gestionnaire permet d'installer par collage ou par fichier, d'activer, de
  désactiver, de désinstaller, de récupérer le code source, et affiche les
  erreurs et la sortie console du plugin.

Le plugin d'exemple, installable en un clic, ajoute un export SQLite, une
commande de renommage en `snake_case` et un tri des tables dans l'éditeur DBML.

---

## 8. Votre compte

_Paramètres → Profil_ :

- changer votre nom d'affichage (celui vu par vos collègues et enregistré dans
  l'historique) ;
- changer votre mot de passe ;
- activer la **double authentification** (TOTP, la même application que pour
  n'importe quel autre service — Google Authenticator, Aegis, etc.) : un code
  à six chiffres est alors exigé en plus du mot de passe à la connexion, et
  des codes de secours à usage unique sont fournis une seule fois à
  l'activation, à conserver en lieu sûr ;
- consulter vos **sessions actives** (appareil, IP, dernière activité) et en
  révoquer une, ou vous déconnecter de tous les autres appareils. À faire si
  vous perdez une machine ou si vous vous êtes connecté sur un poste partagé.

_Paramètres → Apparence_ propose un thème sombre (Obsidienne, par défaut) et
un thème clair (Clair moderne). Deux autres presets sombres (Ardoise nuit,
Émeraude cyber) apparaissent dans le sélecteur mais sont désactivés
(« bientôt disponible ») — rien ne les distingue encore visuellement du thème
par défaut.

À la connexion, la case **« Rester connecté 30 jours »** est cochée par défaut.
Décochez-la sur un poste partagé : la session ne dure alors que 12 h et
disparaît à la fermeture du navigateur.

Après dix échecs de connexion, un compte est bloqué quinze minutes. C'est une
protection contre les tentatives automatisées ; attendez, réinitialisez votre
mot de passe par e-mail, ou demandez à un administrateur de le faire.

### Vos données

Toujours dans _Paramètres → Profil_, section **Vos données** :

- **Exporter mes données** télécharge un JSON contenant votre compte, vos
  sessions actives, vos équipes, les projets dont vous êtes propriétaire et les
  actions sensibles que vous avez effectuées. Les empreintes de mot de passe en
  sont exclues volontairement.
- **Supprimer mon compte** est définitif et demande votre mot de passe. Vos
  sessions et vos appartenances aux équipes disparaissent ; les projets dont
  vous êtes propriétaire ne sont **pas** détruits — ils peuvent être partagés
  avec toute une équipe et restent gérables par un administrateur. Vos
  modifications de schéma gardent votre nom dans l'historique des projets :
  c'est du contenu partagé, pas une donnée personnelle vous concernant.

Le dernier administrateur actif d'une instance ne peut pas supprimer son propre
compte — il faut d'abord donner le rôle d'administrateur à quelqu'un d'autre.

Ce que la suppression **ne** retire pas, et pourquoi : les projets dont vous
êtes propriétaire (souvent partagés, ils restent gérables par un administrateur)
et votre nom sur vos modifications passées dans l'historique des projets (du
contenu partagé, dont la réécriture fausserait l'historique des autres). Le
détail figure dans la politique de confidentialité de votre instance — voir
[`docs/legal/`](./legal/README.md) si vous administrez la vôtre.

---

## 9. Ce que l'application ne fait pas (encore)

Dit explicitement pour éviter de le chercher :

- pas de notifications par e-mail (ajout à un projet, réponse à un
  commentaire) — les seuls e-mails envoyés sont les invitations et les
  réinitialisations de mot de passe ;
- pas de SSO ni de passkeys ;
- pas de sauvegarde des bases connectées par l'outil natif du moteur, ni vers un
  stockage externe (S3…) — les sauvegardes sont logiques et restent sur le
  serveur d'Athanor (§5) ;
- pas de mode hors-ligne — un onglet fermé pendant une coupure perd les
  modifications non synchronisées ;
- interface pensée pour un écran large, non adaptée au tactile.

La double authentification (§8), le thème clair (§8) et la connexion à une
vraie base de données (§5 — introspection, déploiement, retour en arrière)
étaient sur cette liste avant : ils existent désormais et n'y figurent plus.
La feuille de route de ce qui reste est dans [`todo.md`](./todo.md).

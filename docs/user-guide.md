# AthanorDB — guide d'utilisation

Ce guide s'adresse aux **utilisateurs** de l'application. Pour installer,
configurer et exploiter un serveur, voir le [README](../README.md) ; pour
contribuer au code, [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## 1. Premiers pas

### Se connecter

AthanorDB n'a pas d'inscription libre : un administrateur crée une invitation et
vous transmet un lien `/invite/<token>`, valable 7 jours, sur lequel vous
choisissez votre mot de passe. **Ce lien vaut création de compte** — il n'est
protégé par rien d'autre, ne le faites pas suivre.

Si vous perdez votre mot de passe, seul un administrateur peut le réinitialiser
(il n'y a pas encore de « mot de passe oublié » en libre-service).

### Le tableau de bord

À la connexion, vous voyez vos projets, répartis entre **Actifs**, **Archivés**
et **Corbeille**. Un projet mis à la corbeille est récupérable ; la suppression
définitive, elle, ne l'est pas.

Le champ de recherche filtre la liste par nom. Le bouton de création ouvre
directement un schéma vide.

---

## 2. L'éditeur

L'écran d'un projet a deux moitiés synchronisées en permanence :

- à gauche, le **panneau DBML** — le schéma sous forme de texte ;
- à droite, le **canvas** — le même schéma sous forme de diagramme.

Éditer l'un met l'autre à jour. Le texte DBML se synchronise environ 600 ms
après votre dernière frappe.

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

### Raccourcis clavier

| Raccourci                | Effet                                          |
| ------------------------ | ---------------------------------------------- |
| `Ctrl`/`Cmd` + `Z`       | Annuler                                        |
| `Ctrl`/`Cmd` + `Maj` + `Z` ou `Ctrl` + `Y` | Rétablir                     |
| `Ctrl`/`Cmd` + `D`       | Dupliquer la sélection                         |
| `Ctrl`/`Cmd` + `F`       | Rechercher une table sur le canvas             |
| `Entrée` / `Maj`+`Entrée` | Résultat suivant / précédent (dans la recherche) |
| `Échap`                  | Fermer la recherche ou le panneau ouvert       |

Les raccourcis du canvas sont ignorés pendant que vous tapez dans un champ ou
dans l'éditeur DBML. Les plugins peuvent en déclarer d'autres (voir §6).

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

### Commentaires

Une table ou une colonne peut porter un fil de discussion. Il n'y a pas encore
de mentions ni de notifications : les réponses se découvrent en ouvrant le fil.

---

## 4. Historique et versions

Le panneau **Historique** liste les révisions du projet, avec leur auteur. Vous
pouvez :

- consulter l'état du schéma à une révision donnée ;
- nommer une révision (pour retrouver un jalon) ;
- restaurer une révision — ce qui applique cet état comme une nouvelle
  modification, sans effacer l'historique intermédiaire.

---

## 5. Import et export

**Importer** (bouton *Importer*) : collez du DBML ou du SQL, ou choisissez un
fichier `.dbml` / `.sql`. Le dialecte SQL est déduit de l'extension et
modifiable. L'import **fusionne** par nom : les tables existantes gardent leur
position et leurs réglages visuels au lieu d'être réinitialisées.

**Exporter** (bouton *Exporter*) :

| Format                        | Remarque                                                     |
| ----------------------------- | ------------------------------------------------------------ |
| DBML                          | avec ou sans les métadonnées visuelles (positions, couleurs)  |
| SQL PostgreSQL / MySQL / SQL Server | via `@dbml/core`                                       |
| PNG                           | capture du canvas                                             |
| SVG                           | vectoriel                                                     |
| PDF                           | une page contenant une capture **matricielle** du canvas      |
| SQLite                        | fourni par le plugin d'exemple, pas en natif (voir §6)        |

Les exports sont enregistrés dans le journal d'audit de l'instance.

---

## 6. Plugins

*Menu plugins* (barre d'outils du canvas) → **Gérer les plugins**. Un plugin
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

## 7. Votre compte

*Paramètres → Profil* :

- changer votre nom d'affichage (celui vu par vos collègues et enregistré dans
  l'historique) ;
- changer votre mot de passe ;
- consulter vos **sessions actives** (appareil, IP, dernière activité) et en
  révoquer une, ou vous déconnecter de tous les autres appareils. À faire si
  vous perdez une machine ou si vous vous êtes connecté sur un poste partagé.

À la connexion, la case **« Rester connecté 30 jours »** est cochée par défaut.
Décochez-la sur un poste partagé : la session ne dure alors que 12 h et
disparaît à la fermeture du navigateur.

Après dix échecs de connexion, un compte est bloqué quinze minutes. C'est une
protection contre les tentatives automatisées ; attendez, ou demandez à un
administrateur de réinitialiser votre mot de passe.

### Vos données

Toujours dans *Paramètres → Profil*, section **Vos données** :

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

## 8. Ce que l'application ne fait pas (encore)

Dit explicitement pour éviter de le chercher :

- pas de mot de passe oublié en libre-service, pas d'envoi d'email ;
- pas de 2FA, pas de SSO ;
- pas de thème clair — l'interface est en thème sombre uniquement ;
- pas de mode hors-ligne ;
- pas d'API publique ni de clés d'API ;
- pas de connexion à une vraie base de données (introspection, migrations) :
  l'export SQL s'arrête au fichier ;
- interface pensée pour un écran large, non adaptée au tactile.

La feuille de route de ces points est dans [`v1-roadmap.md`](./v1-roadmap.md).

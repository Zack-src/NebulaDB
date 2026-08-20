# Édition simultanée à plusieurs — vérification et corrections (20/08/2026)

Vérification demandée : « est-ce que l'enregistrement du code / du canvas pose
problème quand plusieurs utilisateurs sont connectés et éditent en même
temps ? » Réponse courte : **oui, il y avait une perte de données réelle**, sur
le chemin de synchronisation du panneau DBML. Corrigée et re-testée.

## 1. Comment ça a été vérifié

Banc de test réel (scripts jetables, hors dépôt) : serveur AthanorDB lancé sur
une base SQLite neuve, deux comptes (`alice`, `bob`), deux contextes de
navigateur pilotés en parallèle par Playwright, sur **le même projet**. Chaque
scénario vérifie trois choses : ce que voit chaque client, ce que contient le
document côté serveur (export DBML), et ce qui survit à un rechargement puis à
un redémarrage du serveur.

Scénarios joués :

1. deux tables déplacées **en même temps** par les deux utilisateurs ;
2. Alice renomme une table pendant que Bob ajoute une colonne à une autre ;
3. Alice tape dans le panneau DBML pendant que Bob crée une table au canvas ;
4. une édition distante arrive **pendant** un drag en cours ;
5. rechargement des deux clients ;
6. redémarrage complet du serveur.

## 2. Ce qui allait déjà bien

- La couche temps réel (Yjs + WebSocket + `Room`) converge correctement :
  déplacements simultanés, renommages, ajouts — chaque client voit l'état de
  l'autre, sans divergence.
- La persistance est saine : journal de révisions à chaque update, snapshot
  débouncé (2 s), snapshot forcé quand le dernier client quitte la salle et au
  `SIGTERM`. Rien n'a été perdu au rechargement ni au redémarrage.
- Un drag en cours survit à une édition distante : la table atterrit à la
  position lâchée, identique chez les deux clients.
- Les permissions sont revalidées côté serveur (TTL 5 s) et une connexion en
  lecture seule ne peut pas écrire, même avec une trame WebSocket forgée.

## 3. Le vrai problème : le panneau DBML réimportait tout le schéma

### 3.1 Boucle de rétroaction

`createDbmlExtensions` notifiait `onChange` pour **toute** modification du
tampon CodeMirror — y compris celles écrites par l'application elle-même quand
le document change (le miroir document → tampon). Résultat : n'importe quelle
édition au canvas, faite par n'importe qui, était interprétée par le panneau de
**chaque** client connecté comme « l'utilisateur vient de taper », ce qui
marquait le tampon *dirty* et déclenchait 600 ms plus tard un
`POST /api/projects/:id/import` renvoyant **tout le schéma**.

Observé dans les logs réseau du test : à l'ouverture du projet, les deux
clients postent un import sans que personne n'ait tapé quoi que ce soit.

### 3.2 Conséquence : perte silencieuse de données

L'import remplace le document par le contenu du tampon (fusion par nom, puis
`writeProjectToDoc`, qui supprime toute entité absente). Un tampon qui date de
quelques secondes ne contient donc pas ce que l'autre utilisateur vient
d'ajouter — et le fait supprimer.

Reproduit et mesuré :

| scénario | résultat avant correction |
| --- | --- |
| Bob ajoute une colonne au canvas, Alice tape dans le DBML | la colonne de Bob **disparaît** |
| Alice renomme une table, Bob ajoute une colonne ailleurs | la colonne de Bob **disparaît** |
| Alice crée une table dans le DBML, le panneau de Bob resynchronise | la table d'Alice **disparaît** (`tables: 4` puis `tables: 3` dans les réponses d'import) |

Autrement dit : à deux, chaque panneau DBML repoussait périodiquement sa
propre copie du schéma, et le tampon le plus périmé gagnait.

## 4. Corrections

### 4.1 Un miroir document → tampon n'est plus une frappe utilisateur

`apps/web/src/features/editor/dbml/setup.ts` +
`DbmlEditor/useEditorLifecycle.ts` : la transaction qui recopie le document
dans le tampon est marquée d'une annotation `documentSync`, que l'écouteur de
changements ignore. Le panneau ne synchronise donc plus que ce que
l'utilisateur a réellement tapé. La boucle disparaît, et avec elle la majorité
des occasions de collision.

### 4.2 Fusion à trois côtés : l'import ne supprime plus ce qu'il n'a jamais vu

Le tampon seul ne permet pas de distinguer « l'utilisateur a supprimé cette
table » de « l'utilisateur ne l'a jamais eue ». Le client envoie donc désormais
aussi la **baseline** : le texte dérivé du document sur lequel il a édité
(`lastAppliedTextRef`).

Côté serveur (`preserveConcurrentAdditions`, nouveau module de
`packages/dbml-engine`) :

- entité absente du tampon **et** absente de la baseline → ajoutée par
  quelqu'un d'autre entre-temps : **conservée** ;
- entité absente du tampon mais présente dans la baseline → réellement
  supprimée par l'auteur du tampon : **supprimée**.

Appliqué aux tables, aux colonnes, aux relations (par signature d'extrémités),
aux enums et aux groupes de tables. Un import **sans** baseline (dialogue
d'import, script, client plus ancien) garde l'ancien comportement « le fichier
remplace tout », qui est justement ce qu'on attend d'un import ponctuel.

Les modifications concurrentes d'une *même* entité ne sont pas fusionnées : le
tampon gagne, comme le document a toujours tranché pour un champ donné.

## 5. Après correction

| vérification | résultat |
| --- | --- |
| déplacements simultanés, convergence des deux clients | OK |
| renommage + ajout de colonne concurrents | OK (les deux survivent) |
| DBML tapé + table créée au canvas en même temps | OK (les deux survivent) |
| édition distante pendant un drag | OK (même position chez les deux) |
| rechargement des deux clients | OK (4 tables → 4 tables) |
| redémarrage du serveur | OK (4 tables → 4 tables) |
| suppression d'une table depuis le DBML | toujours effective |
| suppression d'une colonne depuis le DBML | toujours effective |
| renommage depuis le DBML | toujours effectif |
| import ponctuel sans baseline | remplace toujours tout |

Couverture automatisée ajoutée : `packages/dbml-engine/src/concurrentEdits.test.ts`
(5 tests sur la fusion à trois côtés — ajouts concurrents conservés,
suppressions réellement appliquées).

## 6. Limites connues restantes

- **Édition simultanée de la même entité** : si Alice renomme une colonne dans
  le DBML pendant que Bob la renomme au canvas, le dernier écrit gagne. C'est
  le comportement du document lui-même (granularité par entité), pas une
  régression.
- **Le panneau DBML n'adopte pas les changements distants tant que le tampon
  est *dirty*** : tant qu'un utilisateur a du texte non synchronisé, son
  panneau montre sa version. C'est voulu (ne pas écraser ce qu'il tape), mais
  cela veut dire qu'il ne voit pas immédiatement le travail des autres dans le
  texte — le canvas, lui, reste à jour.
- **Pas de test e2e multi-utilisateur dans le dépôt** : la vérification a été
  faite avec des scripts Playwright jetables (serveur + deux navigateurs).
  Industrialiser ce banc serait le prochain pas si l'édition collaborative
  devient critique.

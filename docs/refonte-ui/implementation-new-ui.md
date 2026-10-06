# Refonte — branche new-ui

## Interface intégrée

- Coque commune, navigation Projets / Bases / Admin, paramètres, notifications et adaptation mobile.
- Accueil supprimé. Suppression des modèles de projets et de leur catalogue, de la visite guidée, de la disposition automatique et de la dépendance Dagre.
- État de synchronisation représenté par une icône accessible ; cloche pour les notifications.
- SQL dans un panneau redimensionnable à droite du diagramme. Lecture seule, base courante fixe, sans sélecteur ni mode écriture. Le serveur force aussi la lecture seule pour ce contexte.
- Thème clair plus doux, surfaces mieux différenciées, texte et contrôles contrastés. IBM Plex Sans et Mono servies localement avec leurs licences.
- Administration : utilisateurs et invitations réunis. Équipes sélectionnables dès l’invitation et appliquées lors de son acceptation.

## Bases et comptes

- Destination globale Bases pour explorer et interroger les bases accessibles, partagées ou privées.
- Administration des connexions élargie : le bouton Monitoring conserve comptes et permissions, sessions, santé, sauvegardes et journal. Explorateur et console SQL sont dans Bases.
- Une nouvelle connexion réseau utilise par défaut des comptes personnels, sans identifiant commun obligatoire. Les connexions existantes sont conservées. SQLite et les URI gardent leur mode compatible.
- Paramètres → Bases de données : identifiants personnels pour les bases partagées et ajout, modification ou suppression de bases privées.
- Les bases privées sont accessibles uniquement à leur propriétaire, absentes du catalogue admin et non partageables par attribution. Création, modification, suppression et requêtes sont journalisées.
- Admin → Équipes : droits hérités par base et bouton de génération des comptes SQL manquants pour les membres.
- Admin → Utilisateurs → Accès aux bases : génération de comptes ou attribution d’un identifiant et mot de passe existants, vérifiés avant stockage.
- Les secrets sont chiffrés ; les mots de passe ne sont jamais renvoyés au navigateur. La génération conserve les comptes configurés et fournit un bilan des échecs.
- Migration SQLite 42 additive : propriété des bases privées. Aucun changement aux connexions existantes.

La génération exige que l’administrateur ait configuré son propre compte SQL avec les droits de création sur la base. Les comptes nouvellement créés n’obtiennent pas de privilèges SQL automatiquement : ceux-ci se règlent dans Monitoring → Utilisateurs et permissions. Les droits Nebula (lecture/écriture) restent distincts des droits du moteur SQL.

`localhost` dans une connexion désigne le serveur NebulaDB, y compris pour une base Docker. Une base sur le poste de l’utilisateur doit être joignable depuis ce serveur.

Le monitoring manuel des nouvelles bases utilise le compte personnel de l’administrateur. Les sondes automatiques nécessitent un compte de service existant ; une base personnelle sans compte de service n’est pas sondée en arrière-plan.

## Vérifications

- Build des quatre modules, contrôle Svelte et lint des fichiers modifiés.
- Tests de tous les modules : aucun échec ; tests dépendant de moteurs externes ignorés lorsque ces moteurs sont absents.
- Tests serveur : isolation des bases privées, attribution et héritage, invitations, génération idempotente, échecs partiels, affectation d’identifiants et lecture seule SQL de l’éditeur.
- Parcours navigateur : projets, recherche, navigation globale et mobile, SQL à droite, accès membres, bases privées, invitations avec équipe et monitoring séparé.

## Suite de la refonte visuelle

Le socle et ces corrections sont intégrés. L’inspecteur commun aux objets du canvas, les formulaires historiques, les écrans d’authentification et certains parcours de déploiement restent à harmoniser avec la maquette.

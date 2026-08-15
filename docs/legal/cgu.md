# Conditions générales d'utilisation

> **Modèle à adapter et à faire relire par un juriste avant publication.** Voir
> [`README.md`](./README.md) du même dossier. Les marqueurs `[…]` doivent être
> remplacés.

**Éditeur du service :** [ENTITÉ], [ADRESSE]
**Contact :** [CONTACT]
**Service concerné :** l'instance AthanorDB accessible à l'adresse [URL]
**Version en vigueur depuis le :** [DATE]

---

## 1. Objet

Les présentes conditions régissent l'accès et l'utilisation de l'instance
AthanorDB exploitée par [ENTITÉ] (« le Service »).

AthanorDB est un éditeur de schémas de bases de données : il permet de modéliser
des structures de données sous forme de diagrammes et de texte DBML, de
collaborer en temps réel sur ces modèles, d'en conserver l'historique et
d'exporter du SQL.

Le logiciel AthanorDB est distribué séparément sous licence MIT. Ces conditions
portent sur **le service exploité par [ENTITÉ]**, pas sur le logiciel lui-même :
l'utilisation, la copie et la modification du code source relèvent de la licence
MIT et non du présent document.

## 2. Accès au Service

**2.1 Sur invitation.** Il n'existe pas d'inscription libre. Un compte est créé
en acceptant une invitation émise par un administrateur du Service.

**2.2 Le lien d'invitation vaut credential.** Le lien reçu permet, à lui seul,
de créer un compte. Il ne doit pas être transféré. [ENTITÉ] ne peut pas être
tenue responsable de la création d'un compte par un tiers à qui l'utilisateur
aurait communiqué son lien.

**2.3 Sécurité du compte.** L'utilisateur est responsable de la confidentialité
de son mot de passe et des actions effectuées depuis son compte. Il informe
[ENTITÉ] sans délai en cas d'usage non autorisé. Le Service met à disposition
la liste des sessions actives et leur révocation (voir _Paramètres → Profil_).

**2.4 Disponibilité.** Le Service est fourni **sans engagement de
disponibilité**. [ENTITÉ] peut l'interrompre, notamment pour maintenance, sans
préavis. Aucun niveau de service (SLA) n'est garanti par les présentes
conditions ; un engagement de cette nature ne peut résulter que d'un contrat
distinct.

## 3. Utilisation acceptable

L'utilisateur s'engage à ne pas :

1. tenter d'accéder à des projets, comptes ou données pour lesquels il n'a pas
   reçu d'autorisation ;
2. contourner les contrôles d'accès du Service, y compris en s'adressant
   directement à ses interfaces techniques plutôt qu'à l'application ;
3. perturber le fonctionnement du Service ou en dégrader les performances pour
   les autres utilisateurs, notamment par des requêtes automatisées massives ;
4. y téléverser des contenus illicites, ou des contenus dont il n'a pas le droit
   de disposer ;
5. utiliser le Service pour traiter des données pour lesquelles il ne dispose
   pas d'une base légale suffisante.

**Extensions (plugins).** Le Service permet d'installer des extensions
JavaScript. Elles s'exécutent dans le navigateur de l'utilisateur qui les
installe, dans un environnement isolé et sans accès réseau, et ne sont jamais
transmises au serveur ni aux autres utilisateurs. L'utilisateur installe une
extension **sous sa propre responsabilité** : [ENTITÉ] n'en contrôle ni le
contenu ni le comportement.

## 4. Contenus des utilisateurs

**4.1 Propriété.** Les schémas, notes, commentaires et autres contenus créés
dans le Service restent la propriété de leurs auteurs ou de l'organisation pour
laquelle ils travaillent. [ENTITÉ] n'acquiert aucun droit de propriété sur eux.

**4.2 Nature collaborative.** Le Service est multi-utilisateur par conception.
Un projet est visible par les personnes à qui l'accès a été accordé, et par les
administrateurs de l'instance. Les modifications sont attribuées : l'historique
d'un projet conserve le nom d'affichage de leur auteur.

**4.3 Portée des droits d'administration.** Les administrateurs de l'instance
peuvent accéder à l'ensemble des projets, modifier les droits, réinitialiser un
mot de passe et supprimer un compte. Ces pouvoirs sont inhérents à
l'administration du Service.

**4.4 Suppression.** La suppression d'un projet depuis la corbeille est
définitive : elle efface le projet, son historique et ses instantanés. Les
sauvegardes éventuellement configurées par [ENTITÉ] peuvent en conserver une
copie pendant la durée indiquée dans la
[politique de confidentialité](./confidentialite.md).

## 5. Comptes : suspension et suppression

**5.1 Par l'utilisateur.** Un utilisateur peut supprimer son compte à tout
moment depuis _Paramètres → Profil_. La suppression est définitive et retire le
compte, ses sessions et ses appartenances aux équipes. Les projets dont il était
propriétaire ne sont pas détruits : ils peuvent être partagés avec une équipe et
restent gérables par un administrateur. L'attribution de ses modifications
passées dans l'historique des projets n'est pas réécrite.

**5.2 Par [ENTITÉ].** [ENTITÉ] peut désactiver ou supprimer un compte en cas de
manquement aux présentes conditions, de fin de la relation contractuelle ou de
départ de l'organisation. La désactivation met immédiatement fin aux sessions
en cours.

**5.3 Protection contre les tentatives automatisées.** Après un nombre défini
d'échecs de connexion, un compte est temporairement bloqué. Ce blocage est une
mesure de sécurité et non une sanction.

## 6. Responsabilité

**6.1 Fourniture « en l'état ».** Le Service est fourni sans garantie d'aucune
sorte, expresse ou implicite, notamment d'adéquation à un usage particulier ou
d'absence d'erreur.

**6.2 Sauvegardes.** [ENTITÉ] met en œuvre les mesures décrites dans la
politique de confidentialité, **sans garantie de restauration**. Il appartient à
l'utilisateur de conserver ses propres copies des contenus dont la perte lui
serait préjudiciable ; le Service permet l'export à tout moment (DBML, SQL, SVG,
PNG, PDF).

**6.3 Limitation.** Dans la limite permise par le droit applicable, la
responsabilité de [ENTITÉ] ne saurait être engagée pour les dommages indirects,
notamment perte de données, perte d'exploitation ou perte de chance résultant de
l'utilisation ou de l'indisponibilité du Service.

**6.4 SQL généré.** Le SQL produit par le Service est un artefact de
modélisation. Sa vérification avant toute exécution sur une base réelle incombe
à l'utilisateur. [ENTITÉ] n'est pas responsable des conséquences de son
exécution.

## 7. Modification des conditions

[ENTITÉ] peut modifier les présentes conditions. Les utilisateurs en sont
informés par [MOYEN D'INFORMATION]. La poursuite de l'utilisation du Service
après l'entrée en vigueur vaut acceptation.

## 8. Droit applicable et litiges

Les présentes conditions sont régies par le droit [JURIDICTION]. À défaut de
résolution amiable, tout litige relève de la compétence des tribunaux de
[JURIDICTION], sous réserve des règles impératives protégeant les
consommateurs.

## 9. Contact

Toute question relative aux présentes conditions : [CONTACT].

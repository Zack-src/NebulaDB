# Politique de confidentialité

> **Modèle à adapter et à faire relire par un juriste avant publication.** Voir
> [`README.md`](./README.md) du même dossier. Les marqueurs `[…]` doivent être
> remplacés, et les durées vérifiées contre votre configuration réelle.

**Responsable de traitement :** [ENTITÉ], [ADRESSE]
**Contact :** [CONTACT] — [DPO le cas échéant]
**Service concerné :** l'instance AthanorDB accessible à l'adresse [URL]
**Version en vigueur depuis le :** [DATE]

---

## 1. Principe : tout reste sur cette instance

AthanorDB est auto-hébergé. Les données décrites ci-dessous sont stockées dans
un fichier de base de données sur le serveur de [ENTITÉ], et **ne sont
transmises à aucun tiers**.

Concrètement, l'application :

- n'appelle aucun service externe, ni côté serveur ni côté navigateur ;
- n'utilise ni outil d'analyse d'audience, ni traceur publicitaire, ni réseau
  de diffusion de contenu ;
- héberge ses propres polices de caractères — aucune requête n'est faite vers
  un fournisseur de polices ;
- ne dépose qu'**un seul cookie**, celui de session (voir §4).

Le projet AthanorDB lui-même (l'éditeur du logiciel) ne reçoit aucune donnée et
n'a aucun accès à cette instance.

## 2. Données traitées et pourquoi

### 2.1 Compte

| Donnée | Finalité | Base légale |
| --- | --- | --- |
| Adresse email | Identifiant de connexion, envoi de l'invitation | Exécution du contrat / intérêt légitime |
| Empreinte du mot de passe | Authentification. Le mot de passe **n'est jamais stocké en clair** : seule une empreinte scrypt salée est conservée | Exécution du contrat |
| Nom d'affichage | Identification auprès des collaborateurs, attribution des modifications | Exécution du contrat |
| Statut administrateur, date de création, date de désactivation | Gestion des droits | Intérêt légitime |

### 2.2 Sessions

Adresse IP, user-agent du navigateur, dates de création, de dernière activité et
d'expiration. **Finalité :** maintenir la connexion, et permettre à l'utilisateur
de reconnaître et de révoquer ses propres sessions (appareil perdu, poste
partagé). **Base légale :** sécurité du service, intérêt légitime.

### 2.3 Tentatives de connexion échouées

Adresse email concernée, compteur d'échecs, date du dernier échec, date de fin
de blocage éventuel. **Finalité :** protection contre les tentatives
automatisées. **Base légale :** sécurité, intérêt légitime.

### 2.4 Journal d'audit

Auteur (identifiant et email), action, cible, adresse IP, horodatage — pour les
seules actions sensibles : suppression et archivage de projet, import, export,
changement de permission, gestion des équipes, réinitialisation de mot de passe,
désactivation ou suppression de compte, invitations, connexions bloquées.

**Les modifications de schéma n'y figurent pas** : elles relèvent de
l'historique de chaque projet. **Finalité :** sécurité, traçabilité, réponse à
incident. **Base légale :** intérêt légitime.

### 2.5 Contenus et historique des projets

Schémas, notes, commentaires, et l'historique des révisions. Chaque révision
porte le **nom d'affichage** de son auteur. **Finalité :** fonctionnement même
du service. **Base légale :** exécution du contrat.

Ces contenus sont du contenu partagé au sein d'un projet : ils ne sont pas
supprimés lorsqu'un compte l'est (voir §6).

### 2.6 Journaux techniques

Le serveur journalise les requêtes (méthode, chemin, hôte, adresse IP, code de
réponse). Les cookies de session et les en-têtes d'autorisation en sont
**exclus**. **Finalité :** exploitation et diagnostic. **Base légale :** intérêt
légitime.

### 2.7 Ce qui n'est pas collecté

Aucune donnée de paiement, aucune donnée de localisation, aucun profilage,
aucune décision automatisée, aucun suivi comportemental, aucune donnée
particulière au sens de l'article 9 du RGPD.

## 3. Durées de conservation

Ces durées correspondent à la **configuration par défaut** du logiciel.
Vérifiez-les contre la vôtre avant publication.

| Donnée | Conservation | Réglage |
| --- | --- | --- |
| Compte | Jusqu'à sa suppression par l'utilisateur ou un administrateur | — |
| Session | 30 jours glissants, ou 12 h si « rester connecté » a été décoché. Les sessions expirées sont purgées automatiquement toutes les heures | — |
| Tentatives de connexion échouées | Blocage 15 minutes ; les compteurs sans échec récent sont purgés au bout de 24 h | — |
| Journal d'audit | **365 jours**, purge automatique toutes les heures | `ATHANORDB_AUDIT_RETENTION_DAYS` |
| Contenus et historique des projets | Jusqu'à suppression définitive du projet | — |
| Invitations | Lien valable 7 jours ; l'enregistrement (email, date) subsiste jusqu'à révocation ou remplacement par une nouvelle invitation pour la même adresse | — |
| Sauvegardes | Si activées : les **7** dernières exécutions sont conservées, les plus anciennes sont supprimées | `ATHANORDB_BACKUP_KEEP` |
| Journaux techniques | Selon la politique de journalisation de [ENTITÉ] — à compléter | — |

**Conséquence à connaître :** un compte supprimé peut subsister dans les
sauvegardes jusqu'à ce que celles-ci soient renouvelées. C'est une limite
technique normale ; indiquez-la plutôt que de promettre un effacement immédiat
et complet.

## 4. Cookies

Un seul cookie est déposé : **`athanordb_sid`**, le cookie de session. Il est
`HttpOnly`, `SameSite=Lax`, et marqué `Secure` lorsque l'instance est servie en
HTTPS. Sa durée correspond à la durée de session choisie à la connexion (30
jours, ou aucune durée — cookie de session supprimé à la fermeture du navigateur
— si l'option a été décochée).

Ce cookie est **strictement nécessaire** au fonctionnement du service : il ne
sert qu'à l'authentification, et son dépôt ne requiert donc pas de consentement
préalable. Aucun autre cookie, aucun stockage à des fins de mesure d'audience.

*Note technique :* les préférences d'affichage et les extensions installées sont
conservées dans le `localStorage` du navigateur de l'utilisateur. Elles ne sont
pas transmises au serveur et ne constituent pas un traitement par [ENTITÉ].

## 5. Destinataires

Les données sont accessibles :

- à l'utilisateur lui-même ;
- aux personnes ayant reçu l'accès à un projet, pour le contenu de ce projet ;
- aux administrateurs de l'instance, qui peuvent accéder à l'ensemble des
  projets et des comptes ;
- au personnel de [ENTITÉ] chargé de l'exploitation du serveur.

**Aucun transfert à un tiers, aucun sous-traitant, aucun transfert hors Union
européenne** — sous réserve de l'hébergeur du serveur choisi par [ENTITÉ], à
mentionner ici : [HÉBERGEUR].

## 6. Vos droits

Conformément au RGPD, vous disposez d'un droit d'accès, de rectification,
d'effacement, de limitation, d'opposition et de portabilité.

Deux d'entre eux s'exercent directement dans l'application, sans démarche
(*Paramètres → Profil*) :

- **Accès et portabilité** — « Exporter mes données » télécharge, au format
  JSON, votre compte, vos sessions, vos équipes, les projets dont vous êtes
  propriétaire et vos propres entrées du journal d'audit.
- **Effacement** — « Supprimer mon compte » supprime définitivement le compte,
  ses sessions et ses appartenances aux équipes, après confirmation par mot de
  passe.

**Ce que l'effacement ne supprime pas, et pourquoi :**

- Les **projets dont vous êtes propriétaire** ne sont pas détruits : ils sont
  souvent partagés avec une équipe et leur suppression léserait des tiers. Ils
  sont conservés sans propriétaire et restent gérables par un administrateur.
- L'**attribution de vos modifications** dans l'historique des projets. Il
  s'agit d'un nom d'affichage attaché à un contenu partagé ; le réécrire
  altérerait l'intégrité de l'historique sur lequel d'autres utilisateurs
  s'appuient. Sa conservation relève de l'intérêt légitime.
- Les **entrées du journal d'audit** vous concernant, conservées jusqu'au terme
  de leur durée de conservation, pour les besoins de sécurité qui justifient
  leur existence.

Pour toute autre demande, ou pour exercer vos droits par écrit :
[CONTACT]. Réponse sous un mois. Vous pouvez introduire une réclamation auprès
de l'autorité de contrôle compétente ([CNIL] en France).

## 7. Sécurité

Mesures mises en œuvre par le logiciel : empreintes de mot de passe scrypt
(N=65536), cookies de session `HttpOnly`, contrôle d'origine contre les requêtes
inter-sites, limitation du nombre de tentatives par adresse IP **et** par
compte, permissions vérifiées côté serveur y compris sur le canal de
synchronisation temps réel, journal d'audit des actions sensibles.

Mesures relevant de [ENTITÉ] : chiffrement du transport (HTTPS), sécurité du
serveur et du système de fichiers, gestion des accès administrateur, sauvegardes
et leur protection.

**À savoir :** le contenu de la base de données n'est pas chiffré au repos par
l'application. Toute personne disposant d'un accès au système de fichiers du
serveur peut le lire. La protection de cet accès relève de [ENTITÉ].

## 8. Violation de données

En cas de violation susceptible d'engendrer un risque pour vos droits et
libertés, [ENTITÉ] notifie l'autorité de contrôle dans les 72 heures et informe
les personnes concernées lorsque le risque est élevé.

## 9. Modifications

Cette politique peut évoluer. La date d'entrée en vigueur figure en tête de
document ; les modifications substantielles sont portées à la connaissance des
utilisateurs par [MOYEN D'INFORMATION].

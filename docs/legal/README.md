# Documents juridiques — modèles à adapter

> **Ce ne sont pas des documents juridiques opposables en l'état, et ceci n'est
> pas un conseil juridique.** Ce sont des modèles, rédigés à partir de ce que
> le logiciel fait réellement (vérifié dans le code, pas supposé). Ils doivent
> être relus et validés par un juriste avant d'être publiés, et adaptés à votre
> entité, votre juridiction et votre usage.

## Pourquoi ces documents vous concernent, vous

AthanorDB est **auto-hébergé**. Le projet AthanorDB ne fait tourner aucun
service, ne reçoit aucune donnée et n'a aucune relation avec vos utilisateurs.
Si vous déployez une instance et que d'autres personnes s'en servent :

- **c'est vous l'éditeur du service** au sens des CGU ;
- **c'est vous le responsable de traitement** au sens du RGPD, pas le projet.

C'est pour cette raison que ces fichiers contiennent des marqueurs `[…]` : ils
ne peuvent pas être remplis à votre place.

## Les documents

| Fichier | Objet |
| --- | --- |
| [`cgu.md`](./cgu.md) | Conditions générales d'utilisation de votre instance |
| [`confidentialite.md`](./confidentialite.md) | Politique de confidentialité et durées de conservation |

## Ce qu'il faut remplacer

Cherchez `[` dans les deux fichiers. Au minimum :

- `[ENTITÉ]` — nom légal de l'organisation ou de la personne qui exploite l'instance
- `[ADRESSE]` — adresse du siège ou de l'établissement
- `[CONTACT]` — adresse email de contact (et de contact RGPD si différente)
- `[URL]` — adresse à laquelle votre instance est accessible
- `[JURIDICTION]` — droit applicable et tribunal compétent
- `[DPO]` — délégué à la protection des données, si vous en avez désigné un
- `[DATE]` — date d'entrée en vigueur

Vérifiez aussi les valeurs de conservation : elles décrivent la configuration
**par défaut** du logiciel. Si vous modifiez `ATHANORDB_AUDIT_RETENTION_DAYS`,
`ATHANORDB_BACKUP_KEEP` ou `ATHANORDB_BACKUP_INTERVAL_HOURS`, la politique de
confidentialité doit suivre — un document qui annonce une durée que le serveur
n'applique pas est pire que pas de document du tout.

## Ce que ces modèles ne couvrent pas

- **Le contrat de sous-traitance (DPA)** que vos propres clients pourraient
  exiger si vous hébergez leurs données. Il dépend de votre relation
  contractuelle avec eux, pas du logiciel.
- **Les transferts hors UE**, sans objet ici tant que vous hébergez vous-même
  (le logiciel n'appelle aucun service tiers — voir la politique de
  confidentialité), mais qui redeviennent un sujet si vous déployez chez un
  fournisseur cloud non européen.
- **Le registre des traitements**, obligatoire pour beaucoup d'organisations.
  La section « Données traitées » de la politique de confidentialité vous en
  donne la matière, pas la forme.
- **La mention légale d'hébergeur** exigée dans certaines juridictions.

## Où les publier

L'application ne sert pas ces pages aujourd'hui : il n'y a pas de route pour du
contenu juridique, et en ajouter une qui afficherait un modèle non relu serait
la mauvaise moitié du travail. Publiez-les là où vous publiez déjà vos autres
mentions, et faites-y référence depuis votre instance une fois validés.

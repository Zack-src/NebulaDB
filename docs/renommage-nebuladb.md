# Migration vers NebulaDB

Le produit, les packages, la documentation et les outils portent désormais le nom NebulaDB.

## Identifiants

| Avant                                 | Maintenant                |
| ------------------------------------- | ------------------------- |
| AthanorDB / Athanor                   | NebulaDB / Nebula         |
| `athanordb`, `@athanordb/*`           | `nebuladb`, `@nebuladb/*` |
| `ATHANORDB_*`                         | `NEBULADB_*`              |
| API de plugins `athanor.*`            | `nebula.*`                |
| Cookie `athanordb_sid`                | `nebuladb_sid`            |
| Métriques `athanordb_*`               | `nebuladb_*`              |
| En-têtes `x-athanordb-*`              | `x-nebuladb-*`            |
| Extension OpenAPI `x-athanordb-scope` | `x-nebuladb-scope`        |
| Nouvelles clés API `adb_…`            | `ndb_…`                   |

## Installations existantes

- Les anciennes variables serveur restent lues en secours. Une variable `NEBULADB_*` définie prend toujours le dessus, même si elle est vide. Les secrets de chiffrement doivent conserver leur valeur.
- Une base `data/athanordb.sqlite` existante reste utilisée par défaut si `data/nebuladb.sqlite` n'existe pas. Un chemin explicite dans `NEBULADB_DB_PATH` ou son ancien alias reste prioritaire. Ne pas créer une nouvelle base vide pour remplacer une installation existante.
- Les préférences navigateur et les plugins sont copiés sous les nouvelles clés au démarrage, sans écraser des réglages NebulaDB déjà présents. Le code des plugins enregistrés est conservé : l'ancienne API reste un alias dans leur sandbox.
- Les anciennes sessions sont reprises avec le nouveau cookie. La déconnexion efface les deux cookies et révoque les sessions correspondantes.
- Les authentificateurs TOTP existants restent utilisables ; seuls les nouveaux enrollments affichent NebulaDB.
- Les sauvegardes historiques restent restaurables. Les nouvelles sauvegardes et le presse-papiers utilisent la nouvelle marque ; le lecteur accepte le marqueur historique du presse-papiers.
- Les clés API existantes restent valides, car leur résolution utilise leur hash. Seules les nouvelles clés portent le préfixe `ndb_`.
- Les webhooks émettent temporairement les deux jeux d'en-têtes, avec la même signature. Le User-Agent devient `NebulaDB-Webhooks/1`.
- Adapter les requêtes Prometheus et les consommateurs de l'extension OpenAPI aux nouveaux noms.

## Docker

Le service devient `nebuladb`. Avant de démarrer une installation existante, relever le nom physique du volume actuel et définir `NEBULADB_DATA_VOLUME` avec ce nom. La clé logique du volume est `nebuladb-data` ; sans variable, son nom physique est également `nebuladb-data` pour une installation neuve.

Pour conserver un ancien fichier dans ce volume, définir aussi `NEBULADB_DB_PATH` dans le conteneur avec son chemin existant. Ne pas supprimer les anciens volumes avant vérification.

## Checkout local

Le dépôt cible est `https://github.com/Zack-src/NebulaDB` et le dossier cible est `C:\Users\gdesramaux\source\repos\local\NebulaDB`. Après déplacement, recréer les liens locaux npm avec `npm install --ignore-scripts --offline` : sous Windows, ils peuvent encore pointer vers le dossier précédent. Rouvrir les éditeurs et projets depuis le nouveau chemin.

La sauvegarde locale de cette opération est conservée dans `backups/rename-nebuladb/` : copie SQLite cohérente, sources précédentes archivées et ancien `.env`. Ce dossier est ignoré par Git et contient des données locales à conserver sur la machine.

## Retour arrière

Arrêter les processus NebulaDB. Revenir aux sources précédentes et à leur lockfile, restaurer les noms des variables en gardant les mêmes secrets et désigner explicitement la base existante. Recréer les liens npm. Les préférences historiques sont conservées pour permettre ce retour arrière. Restaurer la copie SQLite seulement si les données doivent aussi revenir à l'instant de la sauvegarde ; cela remplacerait les modifications effectuées depuis.

Le renommage du dépôt GitHub et du dossier peut être inversé séparément. Il ne modifie pas l'historique Git et n'invalide pas les données des bases connectées.

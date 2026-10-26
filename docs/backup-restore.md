# Sauvegarde et restauration d'une instance

Ce document décrit ce que NebulaDB sauvegarde réellement, et comment sauvegarder puis restaurer une instance complète. Les commandes supposent le `docker-compose.yml` du dépôt : service `postgres` (utilisateur et base `nebuladb`), service `nebuladb`, volumes `nebuladb-postgres` et `nebuladb-data`.

## 1. Ce que couvre chaque mécanisme

| Mécanisme                                                     | Contenu                                                                            | Ne contient pas                                                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run backup` et `NEBULADB_BACKUP_INTERVAL_HOURS` (planifié) | Un fichier `.dbml` par projet (tables, relations, notes, positions, zones)        | Comptes, équipes, droits, sessions, clés d'API, connexions, historique des révisions, seeds, webhooks, audit |
| Onglet « Sauvegardes » (bases connectées)                     | Dumps des bases **clientes** connectées, dans `NEBULADB_DATABASE_BACKUP_DIR`       | Les données propres de NebulaDB                                                                         |
| `pg_dump` de la base `nebuladb` (ce document)                 | Toutes les données de NebulaDB : comptes, projets, révisions, connexions chiffrées, audit | Le contenu du volume `nebuladb-data` (voir plus bas) et la clé `NEBULADB_SECRET`                          |

Conclusion : l'export DBML planifié est utile (export lisible, versionnable, réimportable projet par projet) mais **ce n'est pas une sauvegarde d'instance**. Chaque dossier produit contient un fichier `LISEZMOI-SCOPE.txt` qui le rappelle.

## 2. Ce qu'il faut sauvegarder pour une instance complète

1. La base PostgreSQL `nebuladb` (`pg_dump`).
2. La valeur de `NEBULADB_SECRET`. Les identifiants des connexions, les secrets 2FA et les secrets de webhooks sont chiffrés avec elle. Sans la même valeur, la base se restaure mais ces éléments sont illisibles : connexions à ressaisir, 2FA à réinitialiser, webhooks à régénérer. Conservez-la dans un gestionnaire de secrets, **pas** à côté du dump.
3. Le volume `nebuladb-data` (monté sur `/data`) : sauvegardes de bases connectées (`database-backups`) et fichiers de seeds.
4. Le fichier `.env` (ou la configuration équivalente).

## 3. Sauvegarde

```bash
# Dump au format custom (compressé, restaurable table par table avec pg_restore)
docker compose exec -T postgres pg_dump -U nebuladb -d nebuladb -Fc > nebuladb-$(date +%Y%m%d-%H%M%S).dump

# Volume de données de l'application
docker run --rm -v nebuladb-data:/data -v "$PWD":/out alpine \
  tar czf /out/nebuladb-data-$(date +%Y%m%d-%H%M%S).tgz -C /data .
```

Planifiez ces deux commandes (cron, tâche planifiée, sauvegarde du fournisseur) et copiez les fichiers **hors de la machine**. Si le volume `nebuladb-postgres` est perdu avec l'hôte, un dump stocké sur le même disque l'est aussi. Si vous avez changé `NEBULADB_POSTGRES_VOLUME`, adaptez les noms de volumes.

Vérifiez chaque dump sans le restaurer :

```bash
pg_restore --list nebuladb-YYYYMMDD-HHMMSS.dump | head
```

## 4. Restauration

Sur une machine neuve (ou après avoir supprimé les volumes), avec le même `.env` et la même valeur de `NEBULADB_SECRET` :

```bash
# 1. Démarrer uniquement PostgreSQL
docker compose up -d postgres

# 2. Restaurer le dump dans une base vide (--clean --if-exists remplace l'existant)
docker compose exec -T postgres pg_restore -U nebuladb -d nebuladb --clean --if-exists --no-owner < nebuladb-YYYYMMDD-HHMMSS.dump

# 3. Restaurer le volume de données
docker run --rm -v nebuladb-data:/data -v "$PWD":/in alpine \
  tar xzf /in/nebuladb-data-YYYYMMDD-HHMMSS.tgz -C /data

# 4. Démarrer l'application (les migrations manquantes s'appliquent au démarrage)
docker compose up -d nebuladb
```

Restaurez toujours dans une version de NebulaDB identique ou plus récente que celle du dump : une version plus ancienne ne connaît pas le schéma.

## 5. Vérification après restauration

- `GET /api/health` répond `ok`.
- Connexion avec un compte existant ; la liste des projets est complète et un projet s'ouvre avec son historique de révisions.
- Onglet des connexions : « Tester la connexion » réussit sur au moins une connexion. Un échec de déchiffrement indique une valeur de `NEBULADB_SECRET` différente.
- Un compte avec 2FA se connecte avec son code.
- Journal d'audit : les dernières entrées d'avant la panne sont présentes.
- Comparaison rapide des volumétries : `docker compose exec postgres psql -U nebuladb -c "SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM projects) AS projects, (SELECT count(*) FROM revisions) AS revisions"` sur l'instance source et sur la restaurée.

## 6. Exercice de restauration

Une sauvegarde jamais restaurée n'est qu'une hypothèse. Au moins une fois par trimestre, et après chaque changement de version majeure :

1. Sur une machine jetable, copiez le `.env` en changeant le port, `NEBULADB_POSTGRES_VOLUME` et le nom du projet Compose (`docker compose -p nebuladb-drill ...`).
2. Déroulez les sections 4 et 5 avec le dernier dump.
3. Notez la durée et les écarts (secret manquant, volume oublié) ; corrigez la procédure ici.
4. Supprimez l'instance de test : `docker compose -p nebuladb-drill down -v`.

## 7. Récupération partielle depuis les exports DBML

Si seuls des exports DBML existent, `npm run restore -- <dossier> [--owner <email>]` recrée chaque fichier comme **nouveau projet** (positions et zones incluses). L'historique des révisions, les comptes et les connexions ne sont pas récupérables par ce chemin.

## 8. Limites connues

- Pas d'export JSONL table par table ni de restauration logique intégrée à NebulaDB : le chemin supporté est `pg_dump` / `pg_restore`.
- La sauvegarde planifiée intégrée ne couvre pas PostgreSQL et ne prévient pas dans l'interface que son contenu est limité au DBML ; seuls `LISEZMOI-SCOPE.txt`, la sortie de `npm run backup` et ce document le disent.

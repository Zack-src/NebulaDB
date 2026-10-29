# Sauvegarde et restauration d'une instance

Ce document décrit ce que NebulaDB sauvegarde réellement, et comment sauvegarder puis restaurer une instance complète. Les commandes supposent le `docker-compose.yml` du dépôt : service `postgres` (utilisateur et base `nebuladb`), service `nebuladb`, volumes `nebuladb-postgres` et `nebuladb-data`.

## 1. Ce que couvre chaque mécanisme

| Mécanisme                                                       | Contenu                                                                                   | Ne contient pas                                                                                              |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `npm run backup` et `NEBULADB_BACKUP_INTERVAL_HOURS` (planifié) | Un fichier `.dbml` par projet (tables, relations, notes, positions, zones)                | Comptes, équipes, droits, sessions, clés d'API, connexions, historique des révisions, seeds, webhooks, audit |
| Onglet « Sauvegardes » (bases connectées)                       | Dumps des bases **clientes** connectées, dans `NEBULADB_DATABASE_BACKUP_DIR`              | Les données propres de NebulaDB                                                                              |
| `pg_dump` de la base `nebuladb` (ce document)                   | Toutes les données de NebulaDB : comptes, projets, révisions, connexions chiffrées, audit | Le contenu du volume `nebuladb-data` (voir plus bas) et la clé `NEBULADB_SECRET`                             |

| `npm run export-instance` / `import-instance` (archive JSONL, sans `pg_dump`) | Toutes les tables applicatives : comptes, projets, révisions, connexions (chiffrées), audit | Sessions et tables éphémères (`sessions`, `mfa_challenges`, `login_attempts`, `password_reset_tokens`), volume `nebuladb-data`, clé `NEBULADB_SECRET` |

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

### Alternative sans `pg_dump` : `export-instance` / `import-instance`

L'image Docker n'embarque pas `pg_dump`. Deux commandes Node font un export/import logique des données propres de NebulaDB (même `DATABASE_URL` que le serveur) :

```bash
# Export (le serveur peut tourner : lecture seule, instantané cohérent)
docker compose exec nebuladb node apps/server/dist/export-instance.js /data/nebuladb-instance.jsonl.gz
# Hors Docker : npm run export-instance -- [fichier.jsonl.gz]

# Import : base NEUVE et vide uniquement, serveur arrêté
docker compose run --rm nebuladb node apps/server/dist/import-instance.js /data/nebuladb-instance.jsonl.gz
# Hors Docker : npm run import-instance -- fichier.jsonl.gz
```

Fonctionnement :

- L'archive est un fichier JSONL compressé (gzip) : un en-tête (version du schéma lue dans `schema_migrations`, colonnes de chaque table), une ligne par enregistrement, puis un manifeste (nombre de lignes et SHA-256 par table). Les tables sont découvertes dans `information_schema` et écrites dans l'ordre des clés étrangères ; seules les tables éphémères listées ci-dessus sont exclues. La lecture se fait par pages (curseur sur la clé primaire) : la mémoire reste constante. Les `BYTEA` (révisions Yjs, snapshots) sont en base64.
- **Les secrets restent chiffrés** (identifiants de connexion, secrets 2FA, secrets de webhooks) : ils ne sont jamais déchiffrés. L'archive n'est exploitable qu'avec la **même** valeur de `NEBULADB_SECRET` ; conservez-la séparément de l'archive.
- L'import applique les migrations puis restaure en **une seule transaction**, clés étrangères actives, remet les compteurs d'identité à la suite des lignes restaurées, et compare nombres de lignes et empreintes au manifeste avant de valider. Toute erreur annule tout.
- Il **refuse** une base qui contient déjà des données (comptes, projets, ou toute autre table ; il n'existe pas d'option pour passer outre) et une archive dont la version de schéma est plus récente que le code. Une archive plus ancienne est acceptée si toutes ses colonnes existent encore.
- Non couvert : les fichiers de seeds et les sauvegardes de bases connectées du volume `nebuladb-data` (à copier comme en section 3), le `.env`, et les sessions (les utilisateurs devront se reconnecter).

Chemin complet sans `pg_dump` : `export-instance`, copie du volume, conservation de `NEBULADB_SECRET` ; à la restauration, base vide, `import-instance`, restauration du volume, démarrage.

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

- `import-instance` ne fusionne pas dans une base existante et ne restaure pas les sessions ; `pg_dump` / `pg_restore` reste le chemin le plus rapide pour de très grosses bases. L'export logique n'est ni planifié ni intégré à l'interface : à lancer depuis cron ou une tâche planifiée.
- La sauvegarde planifiée intégrée ne couvre pas PostgreSQL et ne prévient pas dans l'interface que son contenu est limité au DBML ; seuls `LISEZMOI-SCOPE.txt`, la sortie de `npm run backup` et ce document le disent.

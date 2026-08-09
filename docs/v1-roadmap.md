# AthanorDB — Route vers une V1 professionnelle

Audit du 2026-08-09. Objectif : identifier ce qu'il reste à construire pour que le produit soit crédible dans un usage professionnel (équipe payante, données sensibles, déploiement en prod chez un client). Organisé par les axes demandés, priorité `🔴 Critique` / `🟠 Important` / `🟡 Confort` / `⚪ Optionnel`, avec taille d'effort indicative (S/M/L/XL) et fichiers concernés. Renvoie vers [`docs/todo.md`](./todo.md) pour le détail technique déjà tracké — ce document est la vue produit/stratégique, pas la liste d'implémentation.

**Ce qui marche déjà** (pour cadrer) : édition visuelle + DBML texte synchronisées en live, collaboration CRDT (Yjs) avec reconnect auto, auth email/mot de passe + sessions + invitations + équipes + permissions granulaires, export SQL (Postgres/MySQL/MSSQL), historique/versioning, système de plugins sandboxé, backup/restore, migrations DB versionnées, CI, ~125 tests automatisés. La base technique est solide. Ce qui manque est surtout : durcissement sécurité pour un contexte pro réel, fonctionnalités attendues d'un outil payant, et un gros morceau produit absent — le lien vers une vraie base de données.

**Mis à jour le 2026-08-09 (passes d'implémentation)** : les points marqués ✅ ci-dessous ont été **construits et vérifiés**, en suivant le séquencement recommandé en fin de document.

*Première passe (priorités 1 à 3)* : cohérence complète des promesses affichées (§11), désactivation/suppression de compte, révocation de sessions, verrouillage de compte, journal d'audit, réévaluation en direct des droits d'écriture, error boundary React, `/api/health` réel, plafond de projets par compte, `npm audit` en CI, documentation utilisateur et de gouvernance.

*Seconde passe (lot « S »)* : durée de session configurable, niveau de log paramétrable + redaction, i18n unifiée en français, états de chargement, et la documentation d'exploitation (reverse-proxy/TLS, mono-instance, secrets).

**Quatre bugs** ont été trouvés en construisant ou en vérifiant, et corrigés : fuite mémoire sur l'éviction des rooms (une minuterie `Awareness` gardait chaque projet ouvert en mémoire pour la vie du processus), rendu en cascade dans la vue d'audit, et — en vérifiant les skeletons — une liste de projets d'un compte précédent affichée après reconnexion. Restent ouverts en priorité 1-3 : ce qui dépend d'un envoi d'email réel (mot de passe oublié, invitations) et les sauvegardes planifiées, faute d'environnement pour les vérifier honnêtement. **156 tests** automatisés (contre 125 avant ces passes).

**Complété le 2026-08-09 (première passe — audit)** : chaque point de ce document est désormais tracké côté implémentation dans `todo.md` (phases 19 à 27) — il n'y avait aucune correspondance auparavant, ce document vivait à côté du tracker sans y renvoyer réellement. Quatre axes manquaient également à l'audit initial et ont été ajoutés : **observabilité/exploitation** (§8), **documentation & processus de release** (§9), **conformité juridique/RGPD** (§10) et **cohérence de l'offre commerciale affichée** (§11) — ce dernier étant, en volume de promesses non tenues, le point le plus urgent du document après la sécurité. Une **définition de la V1** en fin de document tranche ce qui est dans le périmètre et ce qui n'y est pas.

---

## 1. Sécurité 🔴

Le plus urgent avant tout usage pro — données de schéma potentiellement sensibles (structure de prod d'un client).

- ✅ **Dépendances vulnérables** — `npm audit` remontait 7 vulnérabilités (2 modérées, 5 hautes) au 2026-08-09 : `fast-uri` (host confusion via backslash — haute), `js-yaml` (DoS quadratique — haute), `nanoid` (générateur qui boucle à l'infini — haute) ont été corrigées dans la foulée de cet audit (`npm audit fix`, non-breaking, build/lint/125 tests revérifiés après). Reste la chaîne `esbuild`/`vite` — nécessite un bump majeur Vite 8, déjà tracké séparément dans `todo.md`. *Précision après revérification* : `npm audit` résume aujourd'hui **2 vulnérabilités (1 modérée, 1 haute)**, mais un seul avis est listé — l'avis `esbuild` (le serveur de dev accepte les requêtes de n'importe quel site) ; la « haute » est le paquet `vite` compté transitivement pour cette même chaîne. Impact dev-server uniquement, rien en production.
- 🔴 **Pas de mot de passe oublié en self-service** — `admin/ResetPasswordModal.tsx` n'existe que côté admin (réinitialise le mot de passe d'un autre utilisateur). Un utilisateur qui oublie son mot de passe est bloqué sans admin disponible. Pour une V1 pro (utilisateurs autonomes), c'est un blocker classique de support. **M** — nécessite un flux "mot de passe oublié" avec token à usage unique + expiration, sur le modèle de l'invitation existante (`routes/invitations.ts` est un bon gabarit).
- ✅ **Révocation de sessions** — fait le 2026-08-09 : `GET /api/auth/sessions` liste vos propres sessions (appareil, IP, dernière activité, session courante repérée), avec révocation unitaire et « déconnecter les autres appareils ». Interface dans *Paramètres → Profil*. Vérifié en navigateur : deux sessions listées, la session curl révoquée depuis l'UI, la session courante conservée.
- 🟠 **Pas de 2FA/MFA** — attendu pour tout outil pro qui stocke de la structure de données client. **M-L** (TOTP simple = M ; passkeys = L).
- ✅ **`canWrite` réévalué en direct** — fait le 2026-08-09 : `Room.join()` reçoit désormais un résolveur d'accès au lieu d'un booléen figé. Les routes qui modifient un droit (grant projet, membres d'équipe, désactivation de compte) forcent une réévaluation immédiate ; sinon un cache de 5 s borne la latence. Un utilisateur qui perd tout accès voit sa socket **fermée**, pas silencieusement rétrogradée. 7 tests dans `yjs/room.test.ts`.
- 🟠 **Pas de rotation ni de scoping des clés API** — il n'y a pas de clé API du tout aujourd'hui (le champ dans `SettingsTabContent.tsx` "Billing" est un placeholder visuel non fonctionnel, cf. section 3). Si une API publique est construite (section 3), elle doit naître avec rotation + scopes + révocation. **L**, à concevoir en même temps que l'API elle-même.
- ✅ **Journal d'audit** — fait le 2026-08-09 : table `audit_log` + hooks sur suppression/archivage/import/export de projet, changements de permission, gestion d'équipe, réinitialisation de mot de passe, désactivation/suppression de compte, invitations et connexions bloquées. Lecture seule pour les admins (`GET /api/audit`, onglet *Audit log*) : ni écriture ni suppression exposées. Les modifications de schéma n'y figurent volontairement pas — l'historique de chaque projet les contient déjà avec leur auteur.
- ✅ **Verrouillage de compte après échecs répétés** — fait le 2026-08-09 : 10 échecs sur un compte le bloquent 15 minutes, vérifié **avant** le hachage scrypt (un compte bloqué ne doit pas continuer à coûter 100 ms par tentative). Complémentaire de la limite par IP, qui ne voit pas une attaque distribuée. Vérifié bout en bout : la 10ᵉ tentative renvoie 429, et le bon mot de passe est refusé pendant le blocage.
- 🟡 **Pas de chiffrement au repos, nulle part** — non bloquant aujourd'hui (la base ne contient que des schémas et des hashs scrypt), mais à savoir : c'est un prérequis dur de la §7, où il faudrait stocker des chaînes de connexion vers des bases tierces. Aucune primitive de chiffrement n'existe dans le code actuellement. **S** à documenter, **M** à construire quand la §7 démarre.
- ✅ **Question des secrets tranchée et documentée** — fait le 2026-08-09 : aucune valeur de configuration n'est un secret aujourd'hui (ni clé d'API, ni clé de signature, ni identifiant de service tiers), donc de simples variables d'environnement suffisent et un gestionnaire de secrets serait de la cérémonie autour de rien. Le README précise à partir de quand cela cesse d'être vrai : le stockage d'une chaîne de connexion vers une base réelle (§7).
- ✅ **Plafond de projets par compte** — fait le 2026-08-09 : 500 projets possédés par compte (409 au-delà). Garde-fou anti-abus, pas une limite commerciale ; les limites d'entités *dans* un projet existaient déjà (Phase 13).
- ✅ **`npm audit` en CI** — fait le 2026-08-09 : étape `npm audit --audit-level=high`, non bloquante. Les deux choix sont commentés dans le workflow : `high` parce que le dépôt porte un constat modéré connu (esbuild, serveur de dev), et une barrière rouge dès le premier jour finit ignorée.

## 2. Login & comptes 🟠

Au-delà du mot de passe oublié (ci-dessus, critique) :

- ✅ **Désactivation et suppression de compte** — fait le 2026-08-09 : `PATCH /api/users/:id/disabled` (réversible ; supprime les sessions du compte et ferme ses sockets ouvertes) et `DELETE /api/users/:id`, qui impose de choisir le sort des projets possédés (transfert vers un autre compte, ou sans propriétaire). Deux garde-fous : on ne peut ni se désactiver/supprimer soi-même, ni retirer le dernier administrateur actif. La paternité des modifications dans l'historique n'est **pas** réécrite. Vérifié : connexion d'un compte désactivé refusée (403), auto-désactivation refusée (400), suppression effective.
- ✅ **Promesse SSO corrigée** — fait le 2026-08-09 : le palier Entreprise distingue désormais visuellement ce qui existe (coche) de ce qui est prévu (horloge), et le SSO est dans la seconde catégorie. Le SSO lui-même reste à construire (**L-XL**) — voir §11 pour la passe complète sur les promesses affichées.
- 🟡 **Pas d'email de bienvenue/notification** — l'invitation par email reste manuelle (lien à relayer à la main, documenté et assumé). Pas de notification "vous avez été ajouté à un projet/équipe", "quelqu'un a commenté", etc. **M**, dépend d'abord d'un vrai envoi SMTP (déjà dans `todo.md`, explicitement reporté faute d'environnement pour le vérifier).
- 🟡 **Rôles binaires seulement** (`view`/`edit`/`administrator` par projet, `is_admin` global) — pas de rôle intermédiaire type "peut inviter mais pas supprimer", pas de rôle au niveau équipe distinct du niveau projet. Suffisant pour une V1, à revisiter si des clients le demandent. **M** si besoin.
- ✅ **Durée de session configurable** — fait le 2026-08-09 : case « Rester connecté 30 jours » cochée par défaut (comportement historique inchangé). Décochée, la session dure 12 h dans un cookie sans `Max-Age`, que le navigateur supprime à sa fermeture — le cas du poste partagé. La durée est stockée par session, sinon le premier usage d'une session courte l'aurait silencieusement promue en session longue.

## 3. Nouvelles fonctionnalités produit 🟠

Ce qui manque pour rivaliser avec dbdiagram.io / DrawSQL / Prisma Studio en usage pro :

- ✅ **Éditeurs visuels Index/PK composites** — fait le 2026-08-09 (voir `todo.md` Phase 14), mentionné ici pour mémoire seulement : ce point est **résolu**.
- 🟠 **Pas d'API publique** — aucune route documentée/stable pour intégrer AthanorDB dans un pipeline externe (CI, script de synchro). Le champ "Clé API" dans les paramètres est un placeholder visuel, pas une vraie fonctionnalité. **L**, et prérequis direct de la section 7 (déploiement automatique) et de toute intégration CI.
- 🟠 **Pas de webhooks** — aucun moyen d'être notifié (Slack, Discord, endpoint custom) qu'un schéma a changé. Utile pour des équipes qui veulent brancher AthanorDB sur leur workflow. **M**.
- 🟠 **Templates de projet** — démarrer un nouveau schéma from scratch à chaque fois ; pas de galerie de modèles (e-commerce, SaaS multi-tenant, etc.) pour accélérer l'onboarding. **M**.
- 🟠 **Comparaison inter-projets / diff visuel** — `diff.ts` calcule déjà un diff structurel entre deux états d'un même projet (utilisé pour l'historique), mais rien ne permet de comparer deux **projets différents** (ex. schéma de staging vs prod). **M**, la logique existe déjà à 80%.
- 🟡 **Recherche globale multi-projets** — chaque projet a maintenant une recherche interne (dashboard + canvas, fait cette session), mais pas de "chercher une table dans tous mes projets". **S-M**.
- 🟡 **Commentaires : pas de mentions/notifications** — `CommentThread.tsx` existe (commentaires sur table/colonne) mais pas de `@mention`, pas de notification quand on est mentionné. **M**.
- 🟡 **Pas d'export vers d'autres outils** (Prisma schema, TypeORM entities, GraphQL SDL, JSON Schema) — le système de plugins permet déjà d'ajouter ça sans toucher au cœur (cf. l'exemple SQLite déjà livré comme plugin). Bon candidat pour montrer la valeur du système de plugins plutôt qu'une feature native. **M chacun, en plugin**.
- ⚪ **Pas de mode hors-ligne/PWA** — l'app ne fonctionne pas sans connexion au serveur (contrairement à ce que suggère "Local-First" sur la landing page — le stockage est côté serveur, pas vraiment local-first au sens strict). **Incohérence à trancher** : soit corriger le message marketing, soit construire un vrai mode offline (IndexedDB + sync différée) — **XL** si on va au bout.

## 4. Amélioration visuelle / UX 🟡

- 🟠 **Rupture de cohérence visuelle landing vs app** — la landing page (refaite cette session : animations au scroll, kinetic typography, bento grid) a un niveau de finition nettement au-dessus du dashboard/éditeur (redesignés mais plus sobres). Un prospect qui clique "Commencer" après la landing atterrit sur un produit visuellement en retrait. **M**, harmoniser (au minimum : mêmes micro-interactions de base — hover states, transitions — sur les boutons/cards du dashboard et de l'éditeur).
- 🟠 **Thème clair toujours absent** — `index.css` reste 100% sombre (`color-scheme: dark`), le sélecteur de thème dans les paramètres est désactivé pour toute option non-"Obsidian" (fait cette session, honnêteté du disabled plutôt que faux bouton). Beaucoup d'environnements pro exigent un thème clair (accessibilité, préférence, contraintes d'affichage). **L** — un vrai thème clair, ce n'est pas juste inverser les couleurs, c'est retravailler contrastes/ombres/glows partout.
- 🟡 **Pas d'onboarding pour un nouvel utilisateur** — après la première connexion, aucun tour guidé/tooltip pour découvrir le canvas, les raccourcis (Ctrl+F, Ctrl+D, etc.), les plugins. **M**.
- 🟡 **Responsive mobile/tablette non traité** — le canvas React Flow + la DBML panel supposent un écran large. Probablement inutilisable en usage tactile aujourd'hui. À clarifier si c'est un objectif V1 (un outil de modélisation de schéma est rarement utilisé sur mobile — potentiellement un non-problème à assumer explicitement plutôt qu'à résoudre). **XL si à traiter, sinon documenter que c'est desktop-only.**
- 🟡 **Accessibilité (a11y) non auditée** — pas de vérification systématique du contraste, navigation clavier complète, lecteurs d'écran. Le canvas React Flow en particulier est nativement peu accessible. **M-L** pour un audit + correctifs de base (formulaires, modales, contrastes) ; le canvas lui-même restera difficile à rendre pleinement accessible.
- ✅ **Error boundary React** — fait le 2026-08-09 : `ErrorBoundary.tsx` autour de l'application, plus une seconde autour de l'éditeur (indexée sur le projet) qui propose « Retour à mes projets » sans rechargement. Une exception au rendu affiche désormais un écran d'erreur avec une issue, au lieu d'une page blanche.
- ✅ **États de chargement** — fait le 2026-08-09, et le problème était plus grave qu'un simple clignotement : le tableau de bord déduit « vide » d'un tableau vide, or un tableau est aussi vide avant que le fetch réponde — un utilisateur ayant des projets se voyait affirmer qu'il n'en avait aucun. Un second bug a été trouvé en vérifiant : rien ne réinitialisait l'état à la déconnexion, donc se reconnecter (avec un autre compte, par exemple) affichait brièvement la liste du compte précédent.

## 5. Code propre / modularité 🟡

- 🟠 **Bundle principal encore volumineux** — 707 Ko brut / 222 Ko gzip pour le chunk `index` après le split déjà fait (`DbmlPanel` 467 Ko, `jspdf` 390 Ko déjà lazy). Vite avertit toujours sur la taille. **M** — découper davantage (React Flow, CodeMirror) en chunks séparés via `manualChunks`, remonter le seuil d'alerte seulement après un vrai travail de découpe, pas en le masquant.
- ✅ **i18n unifiée en français** — fait le 2026-08-09. Le périmètre réel était plus large que les trois fichiers identifiés : toute la console d'administration, `ProjectTeamsModal`, `AcceptInvite` et `ChangePasswordModal` étaient en anglais (`Login.tsx`, lui, était déjà en français). Aucune bibliothèque i18n n'a été ajoutée — sans seconde langue cible, ce serait une couche d'indirection sans rien derrière. Décision consignée dans `todo.md`.
- 🟡 **Pas de documentation API/OpenAPI** — les routes Fastify (`routes/*.ts`) n'ont pas de schéma OpenAPI généré. Fastify a un écosystème mûr pour ça (`@fastify/swagger`). Prérequis direct si une API publique est construite (section 3). **M**.
- 🟡 **Pas de Storybook / catalogue de composants** — `ui/Button.tsx`, `Card.tsx`, etc. n'ont pas de documentation visuelle isolée. Utile si l'équipe grandit. **M**, faible priorité tant que l'équipe reste petite.
- 🟡 **Couverture de tests encore partielle côté web** — 32 tests ajoutés cette session (logique pure : layout, parsing DBML, raccourcis), mais le canvas React Flow lui-même, la synchronisation Yjs bout-en-bout, et les composants React ne sont testés que manuellement. Nécessite un environnement DOM (jsdom/Playwright) volontairement pas ajouté cette session. **L**.
- ⚪ **Pas de linter de dépendances circulaires / limite de complexité cyclomatique** — rien d'alarmant observé, mais aucun outil ne le surveille en continu (`madge`, `eslint-plugin-complexity`). **S** à ajouter, faible urgence.

## 6. Plugins 🟡

Déjà bien avancé (sandbox Worker, settings, raccourcis, export du code source). Ce qu'il manque pour un écosystème pro, dans l'ordre où `todo.md` les scope déjà :

- 🟠 **Pas de partage d'un plugin à l'échelle d'une équipe** — vit dans le `localStorage` d'un seul navigateur. Une équipe ne peut pas standardiser sur un exporteur commun. **L**, implique que le serveur stocke du code tiers (question de confiance à trancher avant).
- 🟡 **Pas d'UI plugin (iframe)** — un plugin ne peut aujourd'hui que contribuer des commandes/exports/paramètres, pas un panneau visuel propre. **L**, à ne construire que si un vrai plugin en a besoin (aucun cas d'usage concret identifié à ce jour).
- 🟡 **Pas de registre/marketplace de plugins** — partager un plugin = envoyer un fichier `.js` à la main. Dépend du point de partage d'équipe ci-dessus. **L**.
- 🟡 **Plugins non testés en CI** — la logique pure (`shortcuts.ts`) l'est depuis cette session ; le runtime sandbox (Worker) et le registre (`localStorage`) ne le sont pas, faute d'environnement navigateur en CI. **M**, nécessite Playwright ou jsdom + un mock de Worker.

## 7. Lier le schéma à une vraie base de données + déploiement automatique 🔴

**C'est le plus gros morceau manquant, et le plus stratégique** — c'est ce qui transformerait AthanorDB d'un éditeur de schéma isolé en un vrai outil de gestion de cycle de vie de base de données (façon Prisma Migrate / Flyway / Liquibase, avec une couche visuelle en plus). Actuellement, tout s'arrête à "exporter du SQL" — rien ne connecte ce SQL à une base réelle.

Aucune brique de départ n'existe encore ; à concevoir en phases, chacune livrable indépendamment (trackées en Phase 27 de `todo.md`) :

**Phase A — Connexion en lecture seule (M-L)**
- Stocker une chaîne de connexion (chiffrée at-rest — nouveau besoin crypto, jamais en clair en base) vers une base cible (Postgres/MySQL/MSSQL d'abord, cohérent avec les dialectes déjà supportés).
- Introspection : lire le schéma réel d'une base et le convertir en `Project` (le sens inverse de ce qui existe aujourd'hui). C'est exactement le "reverse-engineer from a live DB" explicitement mis de côté dans `todo.md` — "nécessite un driver DB, la gestion d'identifiants, et une vraie revue de sécurité pour accepter des chaînes de connexion arbitraires." Cette revue de sécurité est un prérequis non-négociable avant cette phase (risque SSRF si le serveur AthanorDB peut être poussé à se connecter à une adresse interne arbitraire — nécessite allowlisting réseau, timeouts, pas de résolution DNS vers des IP privées sans configuration explicite).

**Phase B — Détection de drift (M)**
- Comparer périodiquement (ou à la demande) le schéma réel de la base cible avec le schéma modélisé dans AthanorDB. `diff.ts` calcule déjà ce genre de diff structurel entre deux `Project` — il "suffit" (relativement) de faire passer l'introspection de la Phase A par le même chemin.
- Afficher le drift dans l'UI ("la base réelle a divergé du modèle sur ces 3 tables").

**Phase C — Génération de migration (L)**
- À partir du diff Phase B (ou d'un diff entre deux révisions de l'historique existant), générer les `ALTER`/`CREATE`/`DROP` nécessaires pour faire converger la base réelle vers le modèle — pas juste un export SQL complet (déjà fait), mais un **diff SQL applicable** sans perte de données existantes (ordre des opérations, gestion des colonnes qui changent de type avec données existantes, etc. — c'est la partie difficile de tout outil de migration).
- Prévisualisation obligatoire avant toute exécution — jamais d'exécution automatique sans confirmation explicite affichant le SQL exact qui va tourner.

**Phase D — Application & rollback (L-XL)**
- Exécuter la migration générée contre la base cible, avec transaction quand le dialecte le permet, et un chemin de rollback (soit une migration inverse générée, soit restauration depuis un snapshot avant application — dépend fortement du SGBD cible).
- Historique des migrations appliquées, séparé par environnement (dev/staging/prod) — nécessite le concept d'"environnement" qui n'existe pas du tout aujourd'hui (un projet = un schéma, pas un schéma × plusieurs cibles).

**Phase E — Automatisation / CI-CD (L)**
- Déclenchement via API/CLI/webhook (dépend de la section 3 — pas d'API publique aujourd'hui) pour intégrer dans un pipeline (GitHub Actions, GitLab CI) : "à chaque merge sur main, applique les migrations en attente sur staging."
- Nécessite l'API publique + les clés API scopées de la section 3, en prérequis direct.

**Risques transverses à cette section, à traiter avant même la Phase A** :
- Stocker des identifiants de connexion à des bases de production tierces est, de loin, la plus grosse surface d'attaque que le produit aurait jamais eue. Chiffrement at-rest, jamais de log des chaînes de connexion, scoping strict des permissions réseau du serveur AthanorDB, et probablement un compte SGBD dédié en lecture-seule minimum recommandé à l'utilisateur plutôt que ses identifiants admin.
- Exécuter du DDL généré automatiquement contre une base de prod sans garde-fou solide (confirmation explicite, dry-run par défaut, pas d'exécution automatique sans opt-in explicite par environnement) est le genre de fonctionnalité qui peut détruire les données d'un client en un clic malheureux. Cette section entière mérite sa propre revue de sécurité dédiée avant toute implémentation, pas seulement un audit après coup.

## 8. Observabilité & exploitation 🟠

Ajouté au complément du 2026-08-09 — axe absent de l'audit initial. La Phase 15 (`todo.md`) a rendu le serveur **propre** (arrêt gracieux, garde-fou d'erreur globale, validation de config, migrations) ; elle ne l'a pas rendu **observable**. Pour un outil dont le mode de panne caractéristique est « la synchronisation s'est arrêtée sans rien dire », c'est la différence entre s'en apercevoir et l'apprendre par un client.

- 🟠 **Aucune métrique exposée** — rien ne publie le nombre de connexions WS, de rooms actives, la latence d'écriture des snapshots ou un taux d'erreur. Un opérateur n'a aucun moyen de savoir si l'instance va bien autrement qu'en l'utilisant. **M** — un endpoint Prometheus suffit, le serveur a déjà toutes les valeurs en mémoire (`Room`).
- ✅ **`/api/health` interroge réellement la base** — fait le 2026-08-09 : renvoie le nombre de projets, de rooms vivantes et l'uptime, et répond **503** si la base est injoignable. Le `HEALTHCHECK` Docker peut enfin détecter autre chose qu'un processus mort.
- ✅ **Sauvegardes planifiées, avec rétention et restauration testée** — fait le 2026-08-09 : le serveur exécute la sauvegarde toutes les `ATHANORDB_BACKUP_INTERVAL_HOURS` (désactivé par défaut), purge au-delà de `ATHANORDB_BACKUP_KEEP`, et ne touche jamais un répertoire qui ne ressemble pas à une sauvegarde horodatée. Surtout : le trajet sauvegarde → restauration est désormais couvert par un test (schéma, clé primaire, positions du canvas), donc il est exercé à chaque passage de CI et non pour la première fois le jour d'un incident. Vérifié en conditions réelles avec un intervalle de 7 s.
- 🟡 **Logs — partiellement fait le 2026-08-09** : niveau pilotable par `ATHANORDB_LOG_LEVEL` (validé au démarrage) et politique de redaction du cookie de session. Vérifié : niveau invalide → sortie en erreur, niveau `warn` → plus de lignes par requête, identifiant de session absent des logs. Restent ouverts : la corrélation d'identifiant de requête jusque dans les chemins WS/`Room`, et la doc de rotation/rétention. **S**.
- 🟡 **Aucun suivi d'erreurs agrégé** — `uncaughtException` est journalisé et survolé (Phase 15), mais rien ne remonte les erreurs là où un opérateur regarderait ; côté client, il n'y a rien du tout. **S-M**.
- ✅ **Mono-instance documenté** — fait le 2026-08-09 : encadré dans le README (un processus par base ; deux conteneurs sur le même volume corrompent les données ; monter en puissance, pas en nombre). Le mode de panne est silencieux et destructeur — exactement ce qui doit être écrit plutôt que découvert.

## 9. Documentation & processus de release 🟠

Ajouté au complément du 2026-08-09. La documentation *opérateur* est bonne (README : installation, config, Docker, backup/restore, premier admin, comptes et invitations). Ce qui manque est la documentation *utilisateur* et tout ce qui entoure une version publiée.

- ✅ **Documentation utilisateur** — fait le 2026-08-09 : [`docs/user-guide.md`](./user-guide.md) couvre la connexion par invitation, le tableau de bord, l'éditeur à deux panneaux, les raccourcis (relevés dans le code, pas de mémoire), la collaboration et la reconnexion, l'historique, l'import/export (en précisant que le PDF est une capture matricielle), les plugins et la gestion du compte — et se termine par une liste explicite de ce que le produit ne fait pas encore.
- 🟠 **Versionnage — partiellement fait le 2026-08-09** : `CHANGELOG.md` existe et met en avant ce dont un exploitant a besoin (quelles migrations vont s'appliquer, quelle action manuelle est requise — aucune ici). Restent absents : les tags git et un schéma de version, sur lesquels un changelog puisse pointer. C'est une décision à prendre, pas un travail à faire. **S**.
- ✅ **`CONTRIBUTING.md` et `SECURITY.md`** — faits le 2026-08-09. Le premier décrit l'installation, les trois commandes que la CI exécute, la carte des workspaces et les deux règles faciles à casser (sérialisation sans parser ; permissions vérifiées côté serveur). Le second donne un canal de signalement privé et un modèle de menace explicite, y compris ce qui est hors périmètre.
- ✅ **Guide de déploiement derrière un reverse-proxy** — fait le 2026-08-09 : les trois points qui cassent réellement, chacun avec son symptôme (terminaison TLS et `ATHANORDB_COOKIE_SECURE` ; transmission de l'upgrade WebSocket, sans laquelle l'app se charge puis ne synchronise jamais ; conservation du `Host`, sans laquelle la protection CSRF renvoie 403 sur chaque connexion). Exemple nginx complet fourni.

## 10. Conformité & juridique 🟠

Ajouté au complément du 2026-08-09. Rien ici n'est technique et difficile ; tout est bloquant pour vendre à une entreprise européenne.

- ✅ **RGPD** — fait le 2026-08-09 : export de ses données personnelles et suppression de son propre compte depuis *Paramètres → Profil*, **plus** une durée de conservation réellement appliquée pour le journal d'audit (`ATHANORDB_AUDIT_RETENTION_DAYS`, 365 jours par défaut, purge horaire) — c'était la seule table sans plafond, et une politique annonçant une durée que le serveur n'applique pas vaut moins que pas de politique. Modèles de CGU et de politique de confidentialité dans [`docs/legal/`](./legal/README.md), rédigés à partir du comportement vérifié du code. **Reste à faire par l'exploitant** : remplir les marqueurs `[…]` et faire relire par un juriste — ces documents sont des modèles, pas des textes opposables en l'état.
- ✅ **CGU et politique de confidentialité** — modèles rédigés le 2026-08-09 dans [`docs/legal/`](./legal/README.md). Ils partent d'un point que l'audit initial n'avait pas explicité : AthanorDB étant auto-hébergé, **c'est l'exploitant de l'instance qui est éditeur du service et responsable de traitement**, pas le projet. Les documents décrivent ce que le logiciel fait réellement (données stockées, durées, cookie unique, absence de tiers) et laissent en marqueurs ce qui dépend de l'entité. Une relecture juridique reste indispensable avant publication.
- 🟡 **Licence MIT et offre cloud payante n'ont jamais été confrontées** — MIT autorise n'importe qui à héberger et revendre le produit, y compris contre l'offre « Cloud Pro » annoncée. C'est peut-être délibéré (beaucoup de projets assument ce modèle) ; ça n'a simplement jamais été tranché explicitement. Le passage à AGPL est un changement à deux fichiers tant qu'il n'y a pas de contributeurs externes — après, c'est beaucoup plus lourd. **S**, mais à décider **tôt**.

## 11. Cohérence de l'offre affichée 🔴

Ajouté au complément du 2026-08-09 — **l'écart le plus grand du document entre ce qui est promis publiquement et ce qui existe**, et le moins cher à corriger. L'audit initial n'avait relevé que le SSO ; l'inventaire complet était plus lourd.

**Section entièrement traitée le 2026-08-09**, en corrigeant les affirmations plutôt qu'en construisant les produits derrière (chacun de ces chantiers est tracké ailleurs, et aucun n'était une raison de laisser la page dire quelque chose de faux en attendant).

- ✅ **Le palier « Cloud Pro » à 12 €/utilisateur/mois et son « essai gratuit »** (dont le bouton ouvrait en réalité l'application auto-hébergée) sont remplacés par une carte « Cloud géré — En préparation » : pas de prix, pas de bouton, et une phrase explicite — *« Pas encore ouvert : aucune inscription, aucun essai, aucun paiement. »* L'introduction de la section annonce désormais sa propre convention : une coche = existe aujourd'hui, une horloge = prévu. C'était le vrai problème — une liste où les deux se ressemblaient.
- ✅ **Le palier Entreprise** distingue maintenant ce qui existe (instance sur votre infrastructure ; journal d'audit, livré ce jour) de ce qui est prévu (SSO, engagement de disponibilité). Le bouton n'ouvre plus l'application en prétendant être un formulaire de contact.
- ✅ **« PDF vectoriels »** : affirmation retirée. Le guide utilisateur qualifie explicitement l'export PDF de capture **matricielle**. L'export SVG, lui, reste bien vectoriel.
- ✅ **« Local-first »** remplacé par « auto-hébergé » sur toute la landing page, dans le README et dans la description du paquet. Le README et une nouvelle entrée de FAQ décrivent le comportement réel : un onglet ouvert encaisse une coupure et se resynchronise, le fermer pendant la coupure perd les modifications non synchronisées, et il n'y a pas de persistance hors-ligne.
- ✅ **Trouvé en rédigeant la politique de confidentialité** : l'application chargeait ses polices depuis `fonts.googleapis.com`, donc chaque visiteur transmettait son adresse IP et son user-agent à Google — alors que la FAQ affirmait « ne dépend d'aucun service tiers pour fonctionner ». C'est aussi le motif exact de décisions de justice européennes sur le RGPD. Les polices sont désormais embarquées (sous-ensembles latin et latin-ext, 244 Ko) : design inchangé, **zéro** requête vers Google, vérifié en navigateur.
- ✅ **Trouvé pendant la vérification en navigateur** : la barre de navigation de l'application elle-même affichait un bouton « Cloud Pro » en style primaire — une incitation à l'achat, à l'intérieur du produit, pour une offre inexistante — qui ouvrait en fait les paramètres. Il indique désormais « Paramètres ». Le champ « Clé API » factice de l'onglet facturation est remplacé par une phrase disant qu'il n'existe ni API publique ni clé d'API.

---

## Définition de la V1

Ajouté le 2026-08-09 : le document listait des manques sans jamais dire où s'arrête la V1. Proposition à valider — c'est une décision produit, pas un constat technique.

**Dans le périmètre V1** (sans ces points, le produit ne peut pas être livré à une équipe payante). État au 2026-08-09, après la passe d'implémentation :

| Point | État |
| --- | --- |
| Désactivation / suppression de compte (§2) | ✅ fait |
| Révocation de session (§1) | ✅ fait |
| Journal d'audit des actions sensibles (§1) | ✅ fait |
| `canWrite` réévalué en direct (§1) | ✅ fait |
| Cohérence promesses affichées / produit réel (§11) | ✅ fait |
| `/api/health` réel (§8) | ✅ fait |
| Documentation utilisateur (§9) | ✅ fait |
| Mot de passe oublié en self-service (§1) | ⛔ bloqué sur l'envoi d'email |
| Sauvegarde planifiée + restauration testée (§8) | ✅ fait |
| Chemin RGPD technique — export + suppression de compte (§10) | ✅ fait |
| Rétention écrite **et appliquée** (§10) | ✅ fait |
| CGU + politique de confidentialité (§10) | ✅ modèles rédigés — relecture juridique à faire |
| Notes de version : tags + schéma de version (§9) | ⬜ décision à prendre |
| Décision écrite : thème clair, mobile, langue (§4, §5) | ⬜ décision à prendre |

**Hors périmètre V1, assumé** (à écrire noir sur blanc plutôt qu'à laisser croire) : SSO, 2FA, API publique, webhooks, mode hors-ligne réel, section §7 en entier, marketplace de plugins, thème clair si la décision est de rester sombre.

Le tri est volontairement conservateur : tout ce qui est « dans le périmètre » est soit une correction de texte, soit un **S**/**M**. Aucun **L** n'est requis pour une V1 crédible — ce qui veut dire que la V1 est atteignable, et que ce qui coûte cher (§7, API, SSO) relève de la V2 et non d'un préalable. Ce qui reste ouvert ci-dessus se répartit en trois familles nettes : **un blocage d'environnement** (pas de serveur SMTP pour vérifier un envoi d'email — écrire du code d'envoi non testé serait précisément le compromis que ce projet a refusé jusqu'ici), **du travail juridique** qui n'est pas du code, et **des décisions produit** qui coûtent une phrase si on les assume et un chantier si on les nie.

---

## Séquencement recommandé pour une V1

Révisé le 2026-08-09 avec les axes §8 à §11. Le classement suit un principe simple : **d'abord ce qui est faux, ensuite ce qui manque**. Corriger une promesse inexacte coûte une heure et supprime un risque réputationnel ; construire la fonctionnalité correspondante coûte des semaines.

1. ~~**Immédiat — une demi-journée, aucune ligne de logique métier**~~ — **fait le 2026-08-09** : `npm audit fix` (3 CVE hautes), puis la passe complète de véracité sur la landing page et dans l'application (§11).
2. ~~**Avant tout usage réel par une équipe**~~ — **fait le 2026-08-09**, sauf un point : suppression/désactivation de compte, révocation de session, `canWrite` réévalué en direct, error boundary React. Reste **le mot de passe oublié en self-service**, qui suppose un envoi SMTP réel — voir la note d'environnement sous la définition de la V1.
3. **Court terme** — ~~journal d'audit~~, ~~verrouillage de compte~~, ~~`/api/health` réel~~, ~~documentation utilisateur~~, ~~`npm audit` en CI~~ **faits le 2026-08-09**. Restent : sauvegarde planifiée avec restauration testée (§8), CGU/confidentialité/RGPD minimal (§10), tags et schéma de version (§9).
4. **Décisions à trancher, pas à repousser** (chacune coûte une phrase si elle est assumée, un chantier si elle est niée) : thème clair ou dark-only, desktop-only ou responsive, français ou i18n réelle, licence MIT face à une offre hébergée, existence ou non d'un produit cloud.
5. **Moyen terme** : API publique + clés scopées (débloque webhooks, CI et toute la §7), 2FA, templates de projet, comparaison inter-projets, harmonisation visuelle landing/app.
6. **Le grand chantier** : §7 (lien DB + déploiement), en 5 phases indépendantes, chacune avec sa propre revue de sécurité *avant* implémentation — c'est ce qui différencierait le plus AthanorDB de la concurrence (dbdiagram.io/DrawSQL n'ont pas ça), mais c'est aussi, de loin, le plus risqué si bâclé.

Rien ici n'est un blocage dur au sens technique — la base (auth, permissions, CRDT, plugins, tests, CI) est déjà solide pour un usage interne ou early-adopters. Le tri ci-dessus distingue trois choses qui étaient mélangées dans la version initiale : ce qui **bloque** un usage professionnel avec de vraies données sensibles (§1, §2, §10), ce qui est **faux aujourd'hui** et se corrige immédiatement (§11), et ce qui est de la **montée en gamme** progressive (le reste).

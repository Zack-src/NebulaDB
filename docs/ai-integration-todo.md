# TODO — Intégration IA

Principe : couche IA côté serveur (`apps/server/src/modules/ai/`). Le navigateur appelle `/api/ai/*` et ne parle jamais au LLM. Les clés ne quittent jamais le serveur. **L'IA propose, l'humain applique.**

## Décisions à trancher

- [ ] SDK ou `fetch` direct (recommandé : `fetch` + 2 adaptateurs)
- [ ] Logger les prompts ou non (recommandé : non, option admin)
- [ ] IA locale : serveur uniquement, ou aussi depuis le navigateur (Ollama sur le poste user, CORS)

## Étape 1 — Socle

- [ ] Créer le module `apps/server/src/modules/ai/` (`providers/`, `resolver.ts`, `settings.ts`, `tools/`, `routes.ts`, `policy.ts`)
- [ ] Adaptateur Anthropic natif
- [ ] Adaptateur OpenAI-compatible (Ollama, LM Studio, vLLM, Azure)
- [ ] Route `POST /ai/chat` en streaming SSE
- [ ] Tool use typé, validation Zod des arguments
- [ ] Types partagés dans `packages/shared`
- [ ] Migration DB : config instance, préférences user, clés chiffrées

### Config admin

- [ ] `ai.enabled` : interrupteur global (off ⇒ routes 404, UI cachée)
- [ ] `ai.mode` : `disabled | instance_provider | user_keys_only | both`
- [ ] `ai.allowUserKeys` et `ai.allowUserLocal`
- [ ] `ai.allowedLocalHosts` : allowlist des endpoints locaux
- [ ] Quotas par user et par jour, liste des modèles autorisés
- [ ] UI admin en page (pas de popup), confirmations inline, feedback visible sur chaque action

### Préférences utilisateur

- [ ] UI : choisir sa propre clé API ou son IA locale (si autorisé par l'admin)
- [ ] Resolver : clé user → clé instance → erreur claire

### Sécurité des clés

- [ ] Chiffrement AES-GCM via `shared/crypto.ts`
- [ ] Ajouter les secrets IA à `rotate-secret`
- [ ] Ne jamais renvoyer une clé au client (masque `••••abcd` uniquement)
- [ ] Exclure les clés des logs, de l'audit et de `export-instance`
- [ ] Supprimer les clés user avec le compte
- [ ] 2FA récente requise pour modifier la config IA ou les clés

### IA locale

- [ ] Réutiliser la garde SSRF de `webhooks/targetPolicy.ts` pour les URL
- [ ] Distinguer « local côté serveur » (admin seulement) et « local côté user »
- [ ] (Optionnel) appel direct navigateur → `localhost` pour l'Ollama du poste user

### Garde-fous transverses

- [ ] Permissions `ai.use` et `ai.admin` dans `shared/permissions.ts`
- [ ] Share links publics : pas d'accès IA
- [ ] Audit : user, provider, modèle, outil, tokens (pas de prompt par défaut)
- [ ] Rate limit par user, plafond de tokens, timeout, taille de contexte bornée
- [ ] Avertissement UI quand une clé externe envoie le schéma chez un tiers
- [ ] Défense prompt injection : noms, commentaires et notes = données non fiables, séparés du prompt système
- [ ] Aucun outil capable d'exfiltrer (pas de fetch URL, pas de webhook) ni de toucher aux connexions DB ou secrets
- [ ] Ne jamais envoyer les credentials de `connections` ; pas de données de lignes sans opt-in

## Étape 2 — Q&A lecture seule (graph + historique)

- [ ] Outils : `get_schema`, `get_graph`, `list_revisions`, `diff_revisions`
- [ ] UI de chat
- [ ] Permissions : l'IA ne voit que ce que le user peut voir

## Étape 3 — Lint

- [ ] Outil `run_lint`
- [ ] Explication des problèmes
- [ ] Outil `propose_fix` : patch DBML proposé

## Étape 4 — Création / modification / optimisation de schéma

- [ ] L'IA produit du DBML
- [ ] Validation par `packages/dbml-engine`, retry auto 1–2 fois puis erreur
- [ ] Affichage d'un diff, application par l'humain
- [ ] Écriture via le chemin normal (permissions du user)
- [ ] Révision taguée `source: ai`, annulable

## Étape 5 — Dictionnaire

- [ ] Proposition de descriptions par table/colonne
- [ ] Validation en lot, accept/reject par ligne

## Étape 6 — Variantes

- [ ] Propositions de diff sur une variante (jamais d'écriture directe)
- [ ] Même mécanisme de validation que l'étape 4

## Étape 7 — Clés perso et IA locale navigateur (si demande)

- [ ] Flux complet clé perso
- [ ] Flux IA locale côté navigateur

## Tests (style `securityProbes.test.ts`)

- [ ] Clé jamais renvoyée par l'API
- [ ] Routes 404 quand `ai.enabled` = false
- [ ] User sans droit refusé
- [ ] SSRF sur l'URL d'IA locale
- [ ] Allowlist des hosts locaux respectée
- [ ] `allowUserKeys` / `allowUserLocal` à false bloque réellement
- [ ] Sortie DBML invalide jamais appliquée
- [ ] Injection de prompt via nom de table / commentaire n'active aucun outil sensible
- [ ] Clés absentes de l'audit et de l'export d'instance

---
name: nodefony-security-review
description: >
  Passe de conformité SÉCURITÉ + NORMES + RFC sur un diff Nodefony, AVANT commit — checklist
  nodefony-spécifique (injection bindée, secrets/credentials hors logs, RFC HTTP/WS/cookies/CORS,
  Zero Trust 403, JWT stateless, crypto mot de passe, zéro any). Objectif : Nodefony = référence
  du dev (classique + agentic). Déclencheurs : "revue sécurité", "audit sécurité", "security review",
  "conformité RFC du diff", "check sécurité avant commit", "c'est safe ?", "vérifie la sécurité".
---

# nodefony-security-review

Revue **exigeante** sécurité/normes/RFC d'un changement Nodefony. Opérationnalise la directive
`feedback_security_rfc_rigor` : appliquée par défaut, pas seulement en Phase 6. Sortie = un
**verdict par catégorie** (✅ / ⚠️ finding `file:line` / ⛔ blocker) + correctifs. Zéro prose.

## Quand

- **Avant CHAQUE commit** touchant : ORM/requêtes, auth/session/cookies, code protocolaire
  (http/http2/ws/cors), logs/profiler, crypto, gestion d'entrées externes.
- À la demande ("revue sécurité", "c'est safe ?").
- Hors scope d'une tâche : si je repère un écart en passant → **le signaler quand même**.

## 1. Cadrer le diff (ne scanner que le changé)

```bash
# src uniquement (ignore dist/généré) — réutilise la logique de nodefony-quick-diff
git diff --name-only HEAD -- 'src/**/*.ts' | grep -v -E 'dist/|\.test\.ts$'
git diff HEAD -- 'src/**/*.ts'
```

Classer chaque fichier touché par **surface** (ORM / auth / protocole / logs / crypto / input) →
n'appliquer que les checks pertinents.

## 2. Checklist (grep ciblé sur le diff, pas tout le repo)

### A. Injection — requêtes TOUJOURS paramétrées ⛔
- SQL/NoSQL via **bindings**, jamais de concat/template dans la requête.
- `db.all(sql\`... ${x}\`)` (drizzle, **tag `sql`**) = bindé ✅. Risque = un template
  **brut** (sans tag) ou une concat passé à un appel db.
```bash
# 1) Template brut interpolé directement dans un appel db (paren collé au backtick) = ⛔
git diff HEAD -- 'src/**/*.ts' | grep -nE '^\+' \
  | grep -E '\.(all|get|run|query|execute|exec|raw|prepare)\(\s*`[^`]*\$\{'
# 2) Concat de string dans une requête = ⛔
git diff HEAD -- 'src/**/*.ts' | grep -nE '^\+' \
  | grep -E '(query|execute|exec|raw)\(' | grep -E '\+ *['"'"'"`]'
```
> Le tag `sql\`…${x}\`` (drizzle) bind les `${}` → **sûr** : il a `sql` AVANT le backtick,
> donc il ne matche PAS le motif `\(\s*\`` du check 1. Si un appel db a un backtick
> **directement** après la parenthèse → template brut → vérifier à la main.
- Critère portable orm-core : passer par `Criteria`/`FieldOperators` (déjà bindés), pas du SQL maison.

### B. Secrets & credentials — jamais en clair, jamais loggés ⛔
- Pas de `password`/`token`/`secret`/`apiKey`/clé privée dans un `log()/console`/exception/réponse.
```bash
git diff HEAD -- 'src/**/*.ts' | grep -niE '(log|console\.|throw|message:).*(password|secret|token|apikey|private[_-]?key)'
```
- ⚠️ **Dette connue** : le **profiler** (`@nodefony/http`) capture le SQL → un INSERT/UPDATE User
  contient le hash. Si la modif alimente `profiler.queries` ou un logger ORM → **redacter** les
  valeurs sensibles (au minimum les colonnes `password`/token). Vérifier la redaction.
- Mots de passe : **hash** (`BcryptEncoder`/argon2), jamais MD5/SHA1, jamais stocké en clair.
- Comparaisons credential = **constant-time** (le leurre anti-timing de `UserService.authenticate`).

### C. Conformité RFC (si code protocolaire) ⚠️→⛔
- Toucher status/headers/méthodes/cookies/CORS/WS/JWT → **vérifier la RFC** (skill `nodefony-rfc`)
  AVANT, et **citer la RFC** dans le commit.
- Headers : casse + séparateurs `\r\n` ; sanitize `statusMessage` (`[^\x20-\x7E]`) avant `writeHead`.
- HTTP/2 : `x-request-id` + `traceparent` posés AUSSI sur le chemin `stream.respond` (gotcha connu).
- Cookies : RFC 6265 — `HttpOnly; Secure; SameSite`. JWT : RFC 7519/7515 (jose, EdDSA/RS256).
- `traceparent` W3C, `X-Request-Id` (RFC 6648 grandfather).

### D. Auth / AuthZ — Zero Trust par défaut ⛔
- HTTP **stateless** : JWT cookie `HttpOnly; Secure; SameSite=Strict` (+ refresh rotation OWASP),
  pas de session RAM serveur (cf `project_security_stateless_http_decision`).
- Route sans décorateur de sécurité → **403 systématique** (jamais d'accès par défaut).
- **CORS** : jamais `Access-Control-Allow-Origin: *` **avec** `credentials` (whitelist stricte).
- CSRF : `SameSite` + Origin check par défaut ; `@CsrfProtect` (HMAC double-submit) pour routes critiques.
- En-têtes sécurité : CSP stricte (`default-src 'self'` + nonces), HSTS, X-Content-Type-Options,
  X-Frame-Options.

### E. Typage = garde-fou ⛔
```bash
git diff HEAD -- 'src/**/*.ts' | grep -nE ':\s*any\b|as any|@ts-ignore|@ts-nocheck|\brequire\('
```
- Zéro `any` / `@ts-ignore` / `require()`. Contrats credential **typés** (`IPasswordAuthenticatedUser`),
  jamais de downcast pour atteindre le hash.

### F. Entrées externes & erreurs ⚠️
- Valider les entrées aux frontières (Zod au boot config ; payloads requête typés/validés).
- Pas de fuite de stack/détails internes au client en prod (errorRenderer).
- Uploads : limites taille/type. WS : limites taille/séquence de frames.

### G. Agentic (couche IA, Phase 12) ⚠️
- Outils d'agent = surface d'attaque : permissions explicites, sandbox, anti prompt-injection,
  pas d'exécution arbitraire. Tracer (AI Act).

## 3. Verdict (format de sortie)

```
SECURITY REVIEW — <n> fichiers
A injection      ✅ | ⚠️ <file:line> | ⛔ <file:line + raison>
B secrets        ...
C RFC            ✅ (RFC 9110 citée) | ⚠️ ...
D auth/authz     ...
E typage         ...
F input/erreurs  ...
VERDICT : ✅ commit OK | ⛔ corriger d'abord : <liste>
```

- **⛔ = blocker** : ne pas committer avant correction (comme un seuil mémoire qui saute).
- ⚠️ = à traiter ou justifier explicitement.

## Anti-patterns

- Scanner tout le repo — **uniquement le diff**.
- « ça a l'air raisonnable » sans vérifier la RFC → charger la source (`nodefony-rfc`).
- Valider un diff ORM sans vérifier que les requêtes sont bindées.
- Oublier la redaction des credentials quand on ajoute un logger/profiler.

## Liens

- Directive : `feedback_security_rfc_rigor`. RFC : skill `nodefony-rfc`.
- Décisions : `project_security_module_design`, `project_security_stateless_http_decision`,
  `project_security_authorization_pending`, `project_studio_debugbar` (profiler/redaction).

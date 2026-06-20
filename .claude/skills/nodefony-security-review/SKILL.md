---
name: nodefony-security-review
description: >
  Hub SÉCURITÉ de Nodefony, deux modes. Mode REVIEW : passe de conformité sécurité + normes + RFC
  sur un diff AVANT commit (injection bindée, secrets/credentials hors logs, RFC HTTP/WS/cookies/CORS,
  Zero Trust 403, JWT stateless, crypto mot de passe, zéro any). Mode RED/BLUE-TEAM : campagne de tests
  d'attaque sur une brique en 2 PASSES (passe 1 threat-first = matrice d'attaque depuis OWASP/RFC AVANT
  de lire le code, anti-biais, trouve les failles ; passe 2 code-first = lire l'implémentation + couvrir
  le reste des branches), avec le cycle red→blue (faille trouvée → corrigée → re-prouvée). Objectif :
  Nodefony = référence du dev (classique + agentic). Le mode RED/BLUE-TEAM CONÇOIT des attaques propres
  à l'architecture du framework (pipeline HTTP+WS partagé, token dans l'ALS, pont api.request, channels
  WS, firewall zones/bypass, scopes DI, trust-proxy) — pas seulement des attaques OWASP génériques — et
  produit un RAPPORT précis par vecteur. Déclencheurs : "revue sécurité", "audit sécurité", "security
  review", "conformité RFC du diff", "check sécurité avant commit", "c'est safe ?", "vérifie la sécurité",
  "red-team", "blue-team", "matrice d'attaque", "test d'attaque", "tester les attaques", "concevoir une
  attaque", "attaquer le framework", "durcir la sécurité", "pentest", "attaquer cette brique".
---

# nodefony-security-review

Hub sécurité **exigeant** de Nodefony — opérationnalise `feedback_security_rfc_rigor` (appliqué par
défaut, pas seulement en Phase 6). **Deux modes** :

- **REVIEW** (§1-3) — gate RÉACTIF sur un diff avant commit. Sortie = **verdict par catégorie**
  (✅ / ⚠️ finding `file:line` / ⛔ blocker) + correctifs.
- **RED/BLUE-TEAM** (§4) — campagne PROACTIVE : construire une matrice de tests d'attaque sur une
  brique sécurité (et corriger si faille). Sortie = `<brique>.attack.test.ts` + commit.

Zéro prose dans les deux cas.

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
- `db.all(sql\`... ${x}\`)`(drizzle, **tag`sql`**) = bindé ✅. Risque = un template
  **brut\*\* (sans tag) ou une concat passé à un appel db.

```bash
# 1) Template brut interpolé directement dans un appel db (paren collé au backtick) = ⛔
git diff HEAD -- 'src/**/*.ts' | grep -nE '^\+' \
  | grep -E '\.(all|get|run|query|execute|exec|raw|prepare)\(\s*`[^`]*\$\{'
# 2) Concat de string dans une requête = ⛔
git diff HEAD -- 'src/**/*.ts' | grep -nE '^\+' \
  | grep -E '(query|execute|exec|raw)\(' | grep -E '\+ *['"'"'"`]'
```

> Le tag `sql\`…${x}\`` (drizzle) bind les `${}`→ **sûr** : il a`sql`AVANT le backtick,
donc il ne matche PAS le motif`\(\s\*\`` du check 1. Si un appel db a un backtick
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
- ⛔ **Chemins & infra — pas d'info-leak FS dans une réponse data plane** : jamais de **chemin
  absolu** serveur (révèle le home, l'arborescence, l'OS) ni d'**URI de connexion avec credential**.
  → relativiser le chemin à la racine du process (`path.relative(process.cwd(), p)`, basename si hors
  projet) ; rédacter le `password` d'une URI (`postgres://user:***@host/db`). Vécu 2026-05-22 :
  `DrizzleOrm.describeConnection` renvoyait le `filename` **absolu** dans `/nodefony/orm/api/orms`
  (dashboard ORM) → corrigé en chemin relatif (`#safeTarget`). Tout adapter exposant une cible de
  connexion DOIT appliquer la même règle.

```bash
# Chemin absolu (home/tmp/var) ou URI avec credential dans une valeur renvoyée
git diff HEAD -- 'src/**/*.ts' | grep -nE '^\+' \
  | grep -E '(target|path|file|uri|url|dsn|connection)\s*[:=].*("|`)/(Users|home|var|tmp|opt|etc)/|//[^/]+:[^@/]+@'
```

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

### H. Dépendances vulnérables (si `package.json`/lockfile touché) ⚠️→⛔

- Toute dep runtime **ajoutée/bumpée** → vérifier qu'elle n'est pas vulnérable (bases OSV/GHSA, §5).

```bash
# Vulns des dépendances (consomme la GitHub Advisory DB / OSV). high|critical = ⛔.
npm audit --omit=dev 2>/dev/null | grep -E "vulnerabilit|high|critical|severity" | head
```

- Peser toute nouvelle dep (règle CLAUDE.md : bundle + mémoire + surface). Préférer le natif `node:`.
  Une dep transitive vulnérable sans patch dispo = ⛔ (chercher une alternative ou pin sûr).

## 3. Verdict (format de sortie)

```
SECURITY REVIEW — <n> fichiers
A injection      ✅ | ⚠️ <file:line> | ⛔ <file:line + raison>
B secrets        ...
C RFC            ✅ (RFC 9110 citée) | ⚠️ ...
D auth/authz     ...
E typage         ...
F input/erreurs  ...
G agentic        ...
H deps (audit)   ✅ 0 vuln | ⚠️ <pkg@ver CVE/GHSA> | ⛔ high|critical
VERDICT : ✅ commit OK | ⛔ corriger d'abord : <liste>
```

- **⛔ = blocker** : ne pas committer avant correction (comme un seuil mémoire qui saute).
- ⚠️ = à traiter ou justifier explicitement.

## 4. Mode RED/BLUE-TEAM — campagne de tests d'attaque sur une brique

> REVIEW (§1-3) gate un DIFF. RED/BLUE-TEAM **attaque une brique** (auth, session, JWT, CSRF/CORS,
> autorisation, crypto token…) pour PROUVER sa solidité ou TROUVER une faille. Directive user
> (`feedback_redteam_threat_first`). Une brique = une session courte. Nommage : `<brique>.attack.test.ts`.

### 4.1 La MÉTHODE 2 PASSES (cœur — ordre impératif)

1. **Passe 1 — threat-first (black-box), AVANT de lire la logique du code.**
   - **Pourquoi** : lire l'implémentation d'abord = **biais de confirmation** → on teste _ce que le
     code fait_ (« je prouve qu'il est sain »), pas _ce qu'il DEVRAIT résister_. L'angle mort = la
     faille. Un test d'attaque n'a de valeur que s'il **peut virer au rouge** sur une implé vulnérable.
   - Écrire la matrice de MENACE : attaques **conçues** depuis l'architecture (§4.4) + attaques
     canoniques OWASP/RFC (§4.5) + verdict attendu (403 / `null` / `false` / throw). Lancer.
     **Rouge = vraie faille trouvée sans biais** ; vert = résiste.
   - Seul le **CÂBLAGE** vient du code (format de token, noms de zones/routes, signature de méthode —
     sinon le test ne tape pas la bonne surface). Les **attaques** = menace pure.
2. **Passe 2 — code-first (white-box), APRÈS.**
   - **Pourquoi** : la menace générique ne couvre pas toutes les **branches** (cas limites propres au
     code, états internes, `if`). La passe 2 **maximise la couverture**.
   - Lire le code, mesurer (`vitest --coverage` ciblé) → **couvrir le reste** : chaque branche/condition
     non atteinte par la passe 1 (vécu CSRF : `#originFromReferer` catch Referer illisible → asymétrie).

**Toujours** : ≥1 **contrôle positif** (sinon « tout bloquer » est trivialement vert) + honnêteté sur
les **limites documentées** (ex. repli CSRF host-only OWASP : http même-hôte passe — couvert ailleurs).

**Briques à crypto DÉLÉGUÉE à une lib auditée** (réplicable — vécu WebAuthn `705b3111`) : quand
déclencher un vecteur exige un secret matériel impossible à forger en test (signature FIDO2 d'un
authenticator, attestation matérielle) — bref un **input crypto-valide** que le black-box ne peut
fabriquer sans simulateur lourd —, NE PAS reconstruire l'authenticator (= tester la lib auditée, pas
Nodefony). Posture :

1. **Prouver le CÂBLAGE** que Nodefony alimente AUTOUR de la lib, sans crypto valide : challenge à
   **usage unique** (rejoue un input bidon 2× → le 1ᵉʳ consomme, le 2ᵉ est rejeté), origine/host
   transmise, **prevCounter** stocké passé à la lib, userId résolu hors body, message uniforme à
   l'échec. (ex. WebAuthn : un `verify` bidon échoue 401 puis rejoue → 400 « challenge consommé ».)
2. **Lire la délégation** (passe 2) : la lib fait-elle VRAIMENT la garde ? (vérifié : `@simplewebauthn`
   rejette `counter <= prev`.) Confirmer que Nodefony lui passe les bons paramètres (allowlist
   d'origines en prod, pas le header ; rpID figé ; prevCounter du store).
3. **Documenter la limite assumée** dans le rapport (§4.7 « Limites documentées ») : « assertions
   crypto-valides non forgées — vérif signature déléguée à <lib auditée>, prouvée par lecture +
   câblage ». Une brique reste « SAINE » si câblage prouvé + délégation lue, même sans rouge-test
   de la signature elle-même. NB : le **compteur anti-DoS** du gabarit §4.3 ne s'applique qu'aux
   briques à **lookup coûteux** (hash mdp/clé) — un store mémoire (WebAuthn) n'en a pas.

### 4.2 Le cycle RED → BLUE

- **RED** trouve (test rouge) → **BLUE** corrige le code → **re-prouve** : le test rouge devient vert
  = preuve de fermeture (vécu Password : oracle de timing trouvé → `consumeDummy()` → re-prouvé).
- **Anti-oracle** (leçon réplicable) : tout chemin d'échec doit consommer le **MÊME coût** — un
  `fail()` direct qui court-circuite le hash/lookup fuit l'existence. Prouver par **COMPTAGE**
  d'opérations (encodeur/store instrumenté), pas au chronomètre (déterministe). Chercher ce motif partout.

### 4.3 Gabarit de test d'attaque (Nodefony)

- **Unit matrice `reject(input)`** sur un **VRAI** store/provider/service (JAMAIS un stub de la logique
  testée) : (a) bonne classe d'erreur + `code`, (b) **message UNIFORME** (anti-énumération : cause fine
  jamais au client), (c) **compteur anti-DoS** — instrumenter le store → prouver qu'une entrée malformée
  n'atteint JAMAIS la couche coûteuse (forme/CRC validés avant le lookup).
- **E2E wire** (si pertinent) : banc `@nodefony/http` réel (serveur up), `login → action légitime
(200) → variantes d'attaque`. Prouve le VRAI pipeline (firewall+zone+authenticator+controller).
- Référence : `security/tests/unit/{jwtAuthenticator,authorization,csrf,cors}.attack?.test.ts`,
  e2e `http/.../{apikey,oauth2}-flow.test.ts`. Boussole : `project_p6_redteam_attack_tests_kit`.

### 4.4 CONCEVOIR des attaques propres au framework (au-delà d'OWASP générique)

> Les listes OWASP (§4.5) couvrent les briques classiques. Le **différenciateur Nodefony** (HTTP+WS
> même pipeline, identité dans l'ALS, pont souverain `api.request`, channels, firewall à zones) crée
> des surfaces d'attaque qu'aucune cheat-sheet ne décrit → il faut les **concevoir**. Méthode =
> `feedback_security_audit_surface_matrix` (matrice **actif × chemin**) muée en générateur d'attaques.
>
> **C'est la défense anti-0-day** (faille « premier jour ») : un vrai zero-day n'est dans AUCUNE base
> (§5 ne liste que le connu). Le seul moyen de le trouver dans Nodefony AVANT l'attaquant = concevoir
> des attaques **non répertoriées** + tenir une posture (fail-closed, least-privilege, surface minimale).

**Algorithme de conception** (à dérouler AVANT de lire la logique) :

1. **Lister les PONTS / TRANSPORTS / SEAMS** : tout endroit où une identité, une garde ou une donnée
   **traverse une frontière** (HTTP→WS, handshake→frame, REST→`api.request`, controller→channel,
   requête→ALS, proxy→app, décorateur→meta, requête→controller singleton).
2. **Pour chaque pont, poser LA question** : « quelle protection existe sur le chemin A (souvent HTTP)
   et est-elle **REJOUÉE à l'identique** sur le chemin B ? » Une garde présente d'un côté, absente sur
   le pont = **attaque conçue** (= le trou `api.request`/channels raté par 3 audits, révélé 06-13).
3. **Appliquer 2 invariants** : « **1 garde = N transports** » (la MÊME garde doit décider sur tous
   les transports) et « **seam vide ≠ ✅** » (un point d'extension non câblé est une attaque potentielle).
4. **Écrire l'attaque** : pour chaque pont, un test qui rejoue l'accès légitime du chemin A sur le
   chemin B SANS la preuve → exiger le même refus.

**Surfaces architecturales Nodefony à attaquer** (table de conception) :

| Surface (pont/seam)                       | Attaque à CONCEVOIR                                                                                                                            | Invariant à prouver                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Pipeline **HTTP+WS partagé**              | une garde `@IsGranted` testée en HTTP est-elle rejouée au **handshake WS** ET à la **frame** ?                                                 | 1 garde = N transports                                                |
| **Token dans l'ALS** (handshake→messages) | le token est-il **figé** au handshake et **non re-trustable** par une frame suivante ? identité forgée dans un message ?                       | ALS = source de vérité, 0 re-trust par frame                          |
| Pont **`api.request`** (souverain)        | une route REST gardée (ou `> GET`) est-elle contournable via `api.request` WS ? fuite `syslog:stream` ?                                        | `api.request` ≤ GET REST, MÊME firewall                               |
| **Channels WS** subscribe/publish         | RBAC par canal ? un user s'abonne-t-il à un namespace réservé (`admin`/`syslog`) ? plancher système ROLE_ADMIN contournable par config ?       | deny par défaut + plancher système non affaiblissable                 |
| **Firewall zones + `bypassFirewall`**     | une route en bypass (login/liveness) expose-t-elle des données ? une zone est-elle mal matchée (préfixe/casse d'URL) → mauvaise zone ?         | bypass = surface minimale ; match de zone exact                       |
| **Décorateurs → meta**                    | `@Anonymous` méthode neutralise-t-il un `@IsGranted` de classe à tort ? un `forward` re-vérifie-t-il l'autz ? la meta gelée est-elle mutable ? | fusion classe+méthode = AND ; forward re-check ; meta `Object.freeze` |
| **Scopes DI** (`@Scope("singleton")`)     | un controller singleton **capture-t-il** un état per-request (user/session) → **fuite inter-utilisateur** ?                                    | singleton = stateless ; contexte via ALS uniquement                   |
| **Trust-proxy / `Forwarded`**             | un `X-Forwarded-For`/`Forwarded` spoofé → fausse IP client (bypass allowlist IP, faux audit, throttle contourné) ?                             | trustProxy CIDR strict, hop count                                     |
| **Multi-`Set-Cookie`**                    | un cookie (csrf/session) **écrase-t-il** l'autre dans la réponse ?                                                                             | `setCookies` multi (bug latent corrigé)                               |

### 4.5 Sources de menace OWASP/RFC par brique (attaques canoniques)

| Brique             | Réf menace                      | Attaques canoniques                                                                                                            |
| ------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Password/login     | OWASP ASVS, NIST 800-63B        | anti-énum (message uniforme), throttle 429+backoff, timing-leurre (comptage), credential incomplet                             |
| Session BFF        | OWASP Session Mgmt, RFC 6265bis | fixation **closure** (ancien cookie rejoué post-login), id forgé, `__Host-`/Secure/SameSite, révocation immédiate              |
| JWT                | **RFC 8725**, 7519/8037         | alg=none, confusion HS/RS, aud/iss/exp/nbf, kid inconnu, sig falsifiée, jti denylist, typ refresh-as-access                    |
| Clés API/PAT       | OWASP                           | forge/CRC/longueur (0 store = anti-DoS), révoquée/expirée/ban, IDOR (404), secret jamais ré-exposé                             |
| Origin (CSRF/CORS) | OWASP CSRF/CORS, Fetch Std      | spoofing **suffixe/préfixe/sous-domaine/userinfo/scheme/port/casse** (match EXACT), `null` origin, token HMAC splicing/parsing |
| Autorisation       | OWASP Access Control            | escalade verticale (hiérarchie unidirectionnelle), confusion d'attribut, IDOR/ownership, DoS cycle hiérarchie, default-DENY    |
| WebAuthn           | W3C WebAuthn L3                 | challenge usage unique (replay), counter anti-clone régressif, rpId/origin mismatch, register sans session                     |
| OAuth2             | RFC 6749/7636/9207              | state anti-CSRF, PKCE S256, iss, account-takeover (0 liaison-email auto), replay du code                                       |

### 4.6 Procédure

1. Choisir la brique ; repérer le **câblage** (format/noms/signatures) **sans lire la logique**.
2. **Passe 1** : composer la matrice = attaques **conçues** (§4.4) + attaques canoniques (§4.5) →
   `<brique>.attack.test.ts` → lancer → trier rouge=faille.
3. Si faille → **BLUE** : corriger le code + re-prouver (le rouge devient vert). Commit `fix(security):`.
4. **Passe 2** : lire le code + `vitest run --coverage` ciblé → **couvrir le reste** des branches.
5. **⚠️ Vérifier que l'artefact existe AVANT de le tester** (la confiance n'exclut pas le contrôle) —
   un kit peut nommer un décorateur/seam aspirationnel (vécu : `@RequireScope` jamais codé). Ancrages
   `fichier:ligne`, pas le kit.
6. Gates (build/typecheck/tests ; memory.test si pipeline touché) → commit `test(security): red-team <brique>`.
   MAJ `project_p6_redteam_attack_tests_kit` (état brique) + MIGRATION_STATUS.

### 4.7 Rapport RED/BLUE-TEAM (format de sortie précis)

```
RED-TEAM — <brique> (<commit>)
Surface : <transports/ponts couverts>  | Sources : <OWASP/RFC réf>
Passe 1 (threat-first) — <N> vecteurs :
  <vecteur d'attaque>            attendu <403|null|false|throw> / obtenu <…>   [✅ résiste | ⛔ FAILLE]
  …
Faille(s) : aucune | <desc + file:line + impact>
BLUE (si faille) : <fix file:line> → re-test <rouge ➜ vert>  (preuve de fermeture)
Passe 2 (couverture) : <fichier.ts> <%avant ➜ %après> ; branches couvertes : <ligne(s)/cas>
Limites documentées (assumées) : <ex. repli host-only OWASP — couvert par X>
Conception framework : <ponts testés : HTTP+WS / api.request / ALS / …>  | <vide si N/A>
Gates : tests <n/n> ; couverture <x%> ; tsc <ok> ; memory.test <ok|N/A>
VERDICT : ✅ brique SAINE prouvée par attaque | ⛔ faille OUVERTE : <liste>
```

- Le rapport est **factuel par vecteur** (pas « ça a l'air sain ») : chaque ligne = une attaque + son
  verdict observé. Une brique n'est « SAINE » que si **toutes** les attaques conçues ont résisté ET
  la couverture est complète (passe 2).

## 5. Référentiels & sources de menace (ouverts)

> Sources publiques alimentant la conception d'attaques (§4.4/§4.5) et la revue (§2). **Règle de
> chargement** : ne PAS charger les sites HTML lourds en session. RFC → skill `nodefony-rfc` (raw +
> proxy). ANSSI (PDF) / CWE-CAPEC / KEV → s'appuyer sur la connaissance ; **WebSearch ciblé** pour
> vérifier une réf précise (CVE, n° CWE/CAPEC, version d'un guide). Citer la source dans le commit.

### A. Recommandations normatives (le « doit faire »)

- **RFC IETF** (HTTP/WS/cookies/CORS/JWT) → skill `nodefony-rfc`. **W3C** (Fetch Metadata, CSP, WebAuthn).
- **OWASP** : Top 10, **ASVS** (exigences vérifiables), **Cheat Sheets** (CSRF/Session/Auth…).
- **NIST** 800-63B (auth/mots de passe), 800-52 (TLS).
- **ANSSI** (réf francophone, libre — `cyber.gouv.fr`/`messervices.cyber.gouv.fr`) : « Recommandations
  pour la mise en œuvre d'un site web — maîtriser les standards de sécurité côté navigateur »
  (ANSSI‑PA‑009, CSP/cookies/headers), « Recommandations de sécurité relatives à TLS » (v1.2),
  « Authentification multifacteur et mots de passe » (ANSSI‑PG‑078), Guide d'hygiène (42 mesures).

### B. Catalogues de faiblesses & patterns (le « concevoir / classer » — §4.4)

- **CWE** (`cwe.mitre.org`) — types de faiblesses (CWE Top 25). Classer chaque finding (ex. CWE‑352
  CSRF, CWE‑639 IDOR, CWE‑384 fixation, CWE‑285 authz).
- **CAPEC** (`capec.mitre.org`) — **patterns d'attaque** réutilisables (mécanique + conditions +
  impact). Source #1 pour CONCEVOIR des vecteurs au-delà d'OWASP.
- **MITRE ATT&CK** — tactiques/techniques adversaires (plutôt infra/post-exploitation).

### C. Bases de vulnérabilités — du n-day au 0-day (le « connu exploité »)

- **CVE** (`cve.org`) / **NVD** (`nvd.nist.gov`) — vulnérabilités publiées (baseline).
- **OSV** (`osv.dev`) + **GHSA** (`github.com/advisories`) — **dépendances** (npm) ; consommées par
  `npm audit` (check §2.H). C'est l'annuaire actionnable pour le code (deps vulnérables).
- **CISA KEV** — vulnérabilités **activement exploitées** « in the wild » (priorité de patch).
- **CERT-FR** (`cert.ssi.gouv.fr`, ANSSI) — alertes/avis FR (souvent 0-day exploité).
- **Google Project Zero** (tracker « 0day In the Wild ») + **ZDI** — recherche 0-day. **EPSS**
  (`first.org/epss`) — probabilité d'exploitation (priorisation).
- ⚠️ **0-day (« faille premier jour »)** : par définition **absent de ces bases**. La défense ≠ une
  base → c'est le **mode RED/BLUE-TEAM de conception** (§4.4) + la posture Zero Trust (fail-closed,
  least-privilege, surface minimale). Concevoir l'attaque non répertoriée = trouver le 0-day soi-même.

## Anti-patterns

- Scanner tout le repo — **uniquement le diff** (REVIEW).
- « ça a l'air raisonnable » sans vérifier la RFC → charger la source (`nodefony-rfc`).
- Valider un diff ORM sans vérifier que les requêtes sont bindées.
- Oublier la redaction des credentials quand on ajoute un logger/profiler.
- **RED-TEAM** : lire la logique du code AVANT la passe 1 (biais) · **stuber** le store/provider testé
  (ne prouve rien) · « tout bloquer » sans contrôle positif · inventer un test pour un artefact absent
  · s'arrêter à la passe 1 (laisser des branches non couvertes) · oublier le cycle blue (faille trouvée
  mais non re-prouvée fermée).

## Liens

- Directives : `feedback_security_rfc_rigor` (exigence sécu), `feedback_redteam_threat_first`
  (2 passes), `feedback_security_audit_surface_matrix` (matrice actif × chemin = générateur d'attaques).
- Red-team : boussole `project_p6_redteam_attack_tests_kit` (état par brique + gabarit). RFC : `nodefony-rfc`.
- Décisions : `project_security_module_design`, `project_security_stateless_http_decision`,
  `project_security_authorization_pending`, `project_studio_debugbar` (profiler/redaction).

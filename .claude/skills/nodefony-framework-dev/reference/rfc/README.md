# Normes & RFC implémentées par Nodefony (bundle OFFLINE)

> Chargé à la demande par `SKILL.md`. **Cheatsheet normatif** : pour chaque norme que le cœur Nodefony
> implémente — le n°, les **sections exactes** utilisées, la **règle concrète** appliquée, et l'**ancrage
> code**. But : coder/auditer la conformité **sans réseau** et **sans re-fetch** (une RFC est IMMUABLE →
> 0 dérive). **Full-text des RFC IETF = bundlé OFFLINE** dans `ietf/rfcNNNN.txt` (38 fichiers, ~3 Mo) —
> `grep`/`awk` la section exacte **sans réseau**. Normes **non-RFC** (W3C WebAuthn/Trace Context, WHATWG
> Fetch/URL, OWASP, NIST, Standard Webhooks) → skill `nodefony-rfc` (raw GitHub + proxy `https://r.jina.ai/`,
> JAMAIS les sites HTML lourds). Inventaire vérifié : **37 RFC code + 25 delta mémoires**, 0 norme fantôme.
> Mettre à jour = éditer en place (pas de journal).

## 0. Fichiers PRÉSENTS offline (~5,6 Mo — `grep`/`awk` sans réseau)

- **`ietf/rfc<N>.txt`** — 38 RFC full-text : 1918 2818 4226 4648 5280 5424 5789 6125 6238 6265 6455 6585 6749 6750 6797 6890 7009 7118 7230 7235 7239 7519 7617 7636 7638 7692 7807 8259 8707 8725 8941 9106 9110 9112 9113 9207 9449 9700.
- **`specs/` (non-RFC)** :
  - Cloud-native : `cloud-12factor.md`, `cloud-k8s-pod-lifecycle.md`, `cloud-k8s-probes.md`.
  - OWASP cheat sheets : `owasp-{authentication,authorization,csp,csrf,jwt,mfa,password-storage,rest-security,security-headers,session-management,ssrf-prevention,tls,xss-prevention}.md`.
  - `standard-webhooks.md` (Standard Webhooks v1), `draft-idempotency-key-header-06.txt` (IETF draft).
- **`specs/nodejs/*.md`** — 16 docs API Node.js : `async_context` (ALS), `http`, `http2`, `https`, `net`, `dgram`, `tls`, `stream`, `worker_threads`, `cluster`, `crypto`, `events`, `process`, `perf_hooks`, `buffer`, `fs`.

> Manquant ici (HTML-only, fetch on-demand via `nodefony-rfc`/proxy) : W3C WebAuthn/Trace-Context/CSP, WHATWG Fetch/URL, NIST SP 800-63B, OWASP ASVS/WSTG/Top10. Les **règles** qu'on en tire sont déjà dans ce README (§1-22).

## Sommaire

1. HTTP core & sémantique · 2. WebSocket · 3. Cookies & sessions · 4. Proxy / trust / SSRF ·
2. CORS & Fetch Metadata · 6. CSRF · 7. Auth (challenge / Basic / Bearer) · 8. JWT/JWS ·
3. OAuth2 / social · 10. 2FA / TOTP · 11. Password hashing & crypto · 12. Certificats & TLS ·
4. En-têtes de sécurité · 14. Syslog & trace · 15. WebAuthn / FIDO2 · 16. Idempotence ·
5. Webhooks · 18. Throttling (NIST) · 19. Supply-chain

---

## 1. HTTP core & sémantique

- **RFC 9110 (HTTP Semantics)** — §15.4 redirections (whitelist `{301,302,303,307,308}`, défaut 302) · §15.5.21 (422) · §6.4.1 (204/304 sans corps) · §15.5.6 (405 + en-tête `Allow`) · §9.3.2 (HEAD sans corps) · §9.2.1 (méthodes sûres GET/HEAD/OPTIONS/TRACE → jamais 403 CSRF) · §8.3 Content-Type · §8.6 Content-Length exact. → `http-kernel.ts`, `Response.ts`, `ErrorRenderer.ts`.
- **RFC 9112 (HTTP/1.1)** — §7.1 chunked Transfer-Encoding (backpressure `highWaterMark`, resolve sur drain, pas de Content-Length avec chunked). → `src/context/http/Response.ts`.
- **RFC 9113 (HTTP/2)** — frames + pseudo-headers, serveur natif `node:http2`.
- **RFC 7230** — §3.1.2 reason-phrase US-ASCII imprimable · §3.2.6 quoted-string. → `forwarded.ts`, `tests/integration/http-rfc-errors.test.ts`.
- **RFC 6585** — 429 Too Many Requests + `Retry-After` (posé par le throttler). **RFC 6797** — HSTS (TLS-only, `max-age`+`includeSubDomains`). **RFC 7807** — Problem Details = OPTION (Nodefony diverge : champ `code`, pas `status`).

## 2. WebSocket

- **RFC 6455** — §7.4 close codes (1000/1001 going-away au shutdown gracieux AVANT cut TCP / 1009 Message Too Big) · §5.3 masking · §5.5.2-3 ping/pong (autoPong) · §8.1 validation UTF-8 (optionnelle, config) · §5.4 fragmentation réassemblée · `maxPayload` → 1009. → `WebsocketContext.ts`, `tests/unit/wsCloseCode.test.ts`. Helper pur `toWsCloseCode` (4xx→4004, jamais un code inventé).
- **RFC 7692** — permessage-deflate (défaut `false` ; `maxPayload` borne la décompression = anti zip-bomb). → `config/schema.ts`.

## 3. Cookies & sessions

- **RFC 6265 / 6265bis** — §8.8.1 SameSite (`Strict` dev / `Lax` prod) · préfixe `__Host-` si HTTPS (X-Forwarded-Proto honoré) · `HttpOnly` + `Secure` par défaut · `Max-Age`. Session `regenerateId()` anti-fixation (OWASP). → `src/context/Cookie.ts`, `tests/unit/Cookie.test.ts`.

## 4. Proxy / trust / SSRF

- **RFC 7239 (Forwarded)** — §4 syntaxe · §8.1 trust boundary stricte · §8.2 anti info-leak (jamais recopier la topologie interne en réponse) ; prioritaire sur `X-Forwarded-*`. → `src/context/forwarded.ts:parseForwarded()`, `trustProxy.ts`.
- **RFC 1918 / 6890** — plages privées + réservées (loopback, link-local) bloquées par le SSRF guard. → `security/src/net/ssrfGuard.ts`. **OWASP SSRF / CAPEC-664** (tricks IPv6) couverts e2e (`webhookSsrf.attack.test.ts`).

## 5. CORS & Fetch Metadata

- **Fetch Standard (WHATWG)** — preflight OPTIONS court-circuité AVANT routing → 204 ; `Access-Control-Allow-Origin` reflète l'origine (ou `*`, jamais ambigu) ; `Vary: Origin`. → `security/service/cors.ts` (logique pure), `http-kernel.ts`.
- **Fetch Metadata (OWASP 2025)** — `Sec-Fetch-Site` PRIMAIRE (same-site OK / cross-site→403), repli `Origin`/`Referer` HOST-only, inconnu→no-op (W3C « SHOULD »). → `security/service/csrf.ts`.

## 6. CSRF

- **RFC 9110 §9.2.1** — CSRF seulement sur POST/PUT/PATCH/DELETE. **OWASP CSRF Cheat Sheet** — double-submit signé : token = `nonce.HMAC-SHA256(secret, nonce)` base64url, **stateless**. → `security/src/csrfToken.ts`.

## 7. Auth — challenge / Basic / Bearer

- **RFC 7235** — §2.1 scheme case-insensitive · §3.1 tout **401 DOIT porter** `WWW-Authenticate: <scheme> realm="…"`. → `firewall.ts:poseChallengeHeader()`.
- **RFC 7617 (Basic)** — base64(user:pass), charset UTF-8, split au **1er** `:`. → `UserPasswordAuthenticator.ts`.
- **RFC 6750 (Bearer)** — `Authorization: Bearer <token>`, scheme case-insensitive, §3.1 jamais exposer le secret en erreur. → `JwtAuthenticator.ts`, `ApiKeyAuthenticator.ts`.

## 8. JWT / JWS

- **RFC 7519** — claims std (iss/sub/aud/exp/nbf/iat/jti). **RFC 8725 (JWT BCP)** — §3.1 **allowlist `["EdDSA"]`** (jamais HS256/`none`) · §3.8 iss obligatoire · §3.10 aud validé · §3.11 `typ=at+jwt`. → `JwtAuthenticator.ts:32-39`, `tests/unit/jwtAuthenticator.test.ts`.

## 9. OAuth2 / social

- **RFC 6749** — §5.1 token response JSON snake_case (Bearer), jamais cookie/URL. **RFC 7636 (PKCE)** — S256 systématique, `code_verifier` obligatoire. **RFC 9700 (OAuth BCP)** — §4.14 rotation refresh + détection de rejeu (famille coupée), state anti-CSRF comparé session, callback URL **exact string match**. **RFC 9207** — `iss` anti-mix-up. **RFC 8707** — `aud` validé côté resource. → `security/service/oauth2.ts`, `tokenService.ts`, `src/oauth/providers/oidc.ts`.

## 10. 2FA / TOTP

- **RFC 6238 (TOTP)** — T = floor((unixtime−T0)/30), drift ±1 pas (§5.2), vecteurs officiels App.B passants. **RFC 4226 (HOTP)** — §5.3 troncature dynamique. **RFC 4648** — base32 sans padding (tolérant espaces/minuscules). → `security/src/totp/totpCrypto.ts`, `tests/unit/totpCrypto.test.ts`.

## 11. Password hashing & crypto

- **RFC 9106 (Argon2id)** — défaut m=19 MiB (≥ min OWASP), t=3 (> min OWASP 2), p=1 ; validé Zod (jamais hardcodé). → `@nodefony/user/src/encoders/Argon2idEncoder.ts`, `defineSecurityConfig.ts`. **bcrypt** = legacy supporté (72 octets max), déprécié au profit d'Argon2id (`MigratingEncoder` au login).

## 12. Certificats & TLS

- **RFC 5280 (X.509)** — §4.1.2.2 serial aléatoire **128 bits** unique (jamais fixe) · §4.2.1.2 SKI · §4.2.1.6 SAN. **RFC 6125 / 2818** — hostname via **SAN** (CN ignoré), wildcard 1 label, IP littérale en `iPAddress`. → `http/service/certificates.ts`, `test/unit/certificates.test.ts`.

## 13. En-têtes de sécurité

- **RFC 8941 (Structured Fields)** — `Origin-Agent-Cluster: ?1` (booléen structuré). → `security/service/securityHeaders.ts`. (+ COOP/COEP/CORP, Referrer-Policy, Permissions-Policy, CSP nonce/statique.)

## 14. Syslog & trace

- **RFC 5424** — syslog structuré, sévérités 0-7 (−1 SPINNER = extension), `procid`=PID. → `src/nodefony/src/syslog/{Syslog,Pdu}.ts`.
- **W3C Trace Context** — `traceparent` (version+traceId+spanId+sampled), génère un spanId frais, propage traceId bout-en-bout, rejette les IDs tout-zéro. → `http/service/trace.ts`.

## 15. WebAuthn / FIDO2

- **W3C WebAuthn L3** — §6.1 cérémonie · §7.2 vérif assertion ; clé publique COSE base64url ; store `IWebAuthnCredentialStore`. **FIDO2** — passkeys (MFA phishing-resistant, NIST AAL2), synced par défaut, `webauthn.enabled` opt-in. → `@nodefony/security`.

## 16. Idempotence

- **draft-ietf-httpapi-idempotency-key-header-06** — §2.6 clé absente→**400** · §2.7 rejeu concurrent→**409** / rejeu post-complétion→réponse mémorisée / **payload différent→422** (fingerprint SHA-256, RFC 9110 §15.5.21). → `nodefony/src/types/IIdempotencyStore.ts`, `framework/src/idempotency.ts:evaluateIdempotency()`.

## 17. Webhooks

- **Standard Webhooks v1** — signature `v1,base64(HMAC-SHA256)`, en-têtes `webhook-id`/`webhook-signature`/`webhook-timestamp`, fenêtre anti-replay configurable, secret chiffré au repos (AES-256-GCM). → `security/src/webhook/webhookSignature.ts`.

## 18. Throttling (brute-force)

- **NIST SP 800-63B** — §5.2.2 throttling login : backoff progressif par identifiant (**jamais** lockout dur admin), 429 + `Retry-After`, compteur **partagé** JSON+Basic. → `security/src/auth/LoginThrottler.ts`.

## 19. Supply-chain

- **OWASP A06 (Vulnerable & Outdated Components)** — `npm audit` avant commit, 0 CVE publiée tolérée.

## 20. Compléments (issus des mémoires IA — conformité implémentée)

- **RFC 8259 (JSON) §11** — `application/json` **sans** `; charset=utf-8`. → §1 (la règle y est, voici le n° exact).
- **RFC 5789 (HTTP PATCH)** — PATCH porte un corps (comme POST/PUT) → DOIT figurer dans la table `parse` de `Request.ts` (cf `gotchas.md`). → `@nodefony/http`.
- **RFC 7638 (JWK Thumbprint)** — `kid` = thumbprint de la clé publique (JWKS, rotation Ed25519). → keystore JWT `@nodefony/security`.
- **RFC 7009 (OAuth Token Revocation)** — révocation des access/refresh (+ denylist `jti` côté JWT). → `tokenService.ts`.
- **W3C CSP Level 3 §3** — CSP par-route additive (merge), **nonce** par requête. → `securityHeaders.ts` + `@Csp` (framework). Complète §13.
- **WHATWG URL Standard** — parsing d'URL robuste pour la comparaison **host EXACT** (anti origin-spoofing : suffixe/préfixe/sous-domaine/userinfo `app.com@evil.com`/port → 403). → repli CSRF/CORS + `checkWebsocketOrigin`. Complète §5/§6.
- **OWASP WSTG-CLNT-10 (CSWSH)** — anti Cross-Site WebSocket Hijacking : `HttpKernel.checkWebsocketOrigin` valide l'Origin au handshake WS. Complète §2.
- **draft-ietf-oauth-browser-based-apps (BFF)** — pattern n°1 = **Backend-For-Frontend** : session serveur cookie opaque côté web/Studio, jamais le token dans le navigateur (anti-XSS). → architecture session (cf §3).
- **NIST SP 800-63B-4 §session** + **AAL2/AAL3** — niveaux d'assurance : AAL2 (passkeys synced tolérés), AAL3 (haute sécu : idle ≤ 15 min / absolu ≤ 12 h). Complète §18 (throttling + modèle session — chantier timeout NIST).
- **OWASP A01 (Broken Access Control)** — IDOR / fuite cross-tenant : scoper par identité ALS serveur (anti-IDOR), jamais un id client. → RBAC `@IsGranted` + data plane.

## 21. Registres de gouvernance vuln (CONSULTER — pas « implémentés »)

Pour une revue/veille sécurité → skill **`nodefony-security-review`** (mode RED/BLUE-team). Référentiels :
**ANSSI** (FR), **CWE** (MITRE, faiblesses), **CAPEC** (MITRE, patterns d'attaque), **OSV** (vulns OSS),
**GHSA** (advisories npm/GitHub), **CISA-KEV** (CVE activement exploitées), **OWASP Top 10** (2025) +
**OWASP ASVS V3** (critères de vérif) + cheat sheets (CSRF, Session Management).

## 22. Normes PRÉVUES (non encore implémentées — pour coder la suite)

> Citées dans la vision (auth agents IA / realtime). Les implémenter = nouveau code ; ici pour ne pas les réinventer.

- **RFC 8693 (OAuth Token Exchange)** — délégation « on-behalf-of » (agents IA / MCP). **RFC 9449 (DPoP)** — token sender-constrained (anti-vol/replay, service-to-service). **RFC 8707 (Resource Indicators)** — `aud` ciblée (déjà partiellement, cf §9). **RFC 7118 / SIP** — bridge VoIP/RTC futur (P15, `PlainTransport` RTP).

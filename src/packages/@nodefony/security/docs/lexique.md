---
title: "Lexique sécurité — sigles & termes expliqués"
navTitle: Lexique sécurité
lang: fr
module: "@nodefony/security"
topic: lexique-securite
section: "Sécurité"
audience: [developer]
tags: [lexique, securite, jwt, oauth, webauthn, csrf, rbac, voters, glossaire]
status: stable
updated: 2026-07-20
source: "src/packages/@nodefony/security/docs/lexique.md"
---

# Lexique sécurité Nodefony

📍 [Documentation](../../../../../docs/index.md) › [Sécurité](index.md) › **Lexique**

> Chaque sigle de la sécurité Nodefony : développé → une explication simple. Toute nouvelle
> abréviation rencontrée dans le code/doc DOIT avoir son entrée ici. Les termes transverses
> (opt-in, lazy, DI, fail-closed…) vivent dans le [lexique général](../../../../../docs/lexique.md) —
> ce fichier ne porte que le vocabulaire PROPRE à la sécurité.

## 📖 Lexique

### Architecture & patterns

<!-- prettier-ignore -->
| Sigle | Développé | En clair |
| --- | --- | --- |
| **BFF** | Backend For Frontend | Le « majordome du navigateur » : le serveur garde les jetons, le navigateur n'a qu'un ticket de vestiaire (cookie de session opaque, illisible en JavaScript). Pattern n°1 IETF pour les apps web. |
| **Zero Trust** | — | « Fermé sauf si explicitement ouvert » : zone protégée + visiteur anonyme → 401, toujours. Aucune confiance implicite. |
| **ALS** | AsyncLocalStorage (Node.js) | Le « fil d'Ariane » d'une requête : un espace de stockage attaché à la requête en cours, accessible partout sans passer d'argument. L'utilisateur authentifié y vit. |
| **mTLS** | mutual TLS (TLS mutuel) | HTTPS contrôle l'identité du serveur ; mTLS contrôle AUSSI celle du client (certificat client exigé) — l'ambassade vérifie ton passeport avant d'ouvrir. Machine↔machine, zones admin. |
| **CRUD** | Create Read Update Delete | Les 4 opérations de base sur une ressource. |

### Jetons & sessions

<!-- prettier-ignore -->
| Sigle | Développé | En clair |
| --- | --- | --- |
| **JWT** | JSON Web Token | La « carte plastifiée signée » : un jeton auto-porteur (identité + rôles + expiration dedans, signé). Personne ne peut le modifier, mais on ne peut pas le rappeler avant expiration. Réservé API/machines chez Nodefony. |
| **JWKS** | JSON Web Key Set | L'annuaire public des clés de signature du serveur — permet aux autres services de vérifier les JWT sans secret partagé. |
| **`kid`** | Key ID | L'étiquette dans l'en-tête d'un JWT qui dit QUELLE clé l'a signé → permet la rotation des clés sans invalider les anciens jetons. |
| **`jti`** | JWT ID | Numéro de série unique d'un JWT → permet de le révoquer individuellement (liste noire). |
| **`aud`** | Audience | Le claim « pour qui est ce jeton » : un jeton volé pour le service A ne marche pas sur le service B. Validation obligatoire (RFC 8707/9700). |
| **DPoP** | Demonstrating Proof of Possession | Jeton « menotté » au client : le porteur prouve qu'il détient une clé privée à chaque usage → un jeton volé seul ne sert à rien. (RFC 9449) |
| **`cnf`** | confirmation (key binding) | Empreinte de la clé à laquelle un jeton est **menotté** (_sender-constrained_) : `jkt` (DPoP, RFC 9449) ou `x5t#S256` (mTLS, RFC 8705). Un jeton volé sans la clé privée = inutilisable. Slot réservé du store Nodefony. |
| **PAT** | Personal Access Token | Clé API personnelle (style GitHub : `nf_xxx_secret`) — stockée hachée, affichée une seule fois. |

### JWT — claims, signature & portée

<!-- prettier-ignore -->
| Sigle | Développé | En clair |
| --- | --- | --- |
| **JWS** | JSON Web Signature | La signature qui rend un JWT infalsifiable : la 3ᵉ partie (`en-tête.charge.SIGNATURE`). |
| **JWK** | JSON Web Key | Une clé cryptographique au format JSON. Une JWK **publique** ne contient jamais le paramètre privé `d`. |
| **claim** | revendication | Une affirmation portée par le JWT. Standards (RFC 7519) : `iss` (émetteur), `sub` (sujet), `aud` (destinataire), `exp` (expire le), `nbf` (pas avant), `iat` (émis à), `jti` (n° série). |
| **Bearer** | « au porteur » | Mode d'envoi `Authorization: Bearer <jwt>`. Quiconque le détient s'en sert (billet au porteur) → HTTPS + `exp` court obligatoires. Chez Nodefony le JWT voyage ainsi, jamais en cookie. |
| **EdDSA / Ed25519** | Edwards-curve DSA | Algo de signature moderne (rapide, déterministe, clés de 32 o). **Défaut JWT** de Nodefony. Ed25519 = la courbe utilisée. |
| **OKP** | Octet Key Pair | La famille de clé (`kty`) des courbes Edwards (Ed25519) au format JWK. |
| **Refresh token** | jeton de rafraîchiss. | Jeton long qui obtient un nouvel _access_ court sans re-login. Stocké serveur → **révocable** (≠ access auto-porté). |
| **Rotation** | — | À chaque rafraîchissement : ancien refresh invalidé, nouveau émis (OWASP RFC 9700). |
| **Reuse detection** | détection de rejeu | Un refresh déjà tourné qui resurgit = preuve de fuite → on révoque toute la **famille** de jetons. |
| **Scope** | portée | Capacités accordées à UN jeton (`orders:read`), axe **distinct** des rôles → `@RequireScope`. Un PAT peut en avoir moins que son porteur. |
| **Downscoping** | réduction de portée | Un jeton n'accorde jamais plus que son porteur : création scopes ⊆ droits du user, usage scopes ∩ droits actuels. |
| **Least privilege** | moindre privilège | N'accorder que le strict nécessaire : un PAT « lecture seule » d'un admin ne peut pas écrire. |

### Authentification

<!-- prettier-ignore -->
| Sigle | Développé | En clair |
| --- | --- | --- |
| **MFA** | Multi-Factor Authentication | Plusieurs preuves d'identité de catégories **différentes** (ce que je sais + ce que je possède + ce que je suis). Terme **générique** : 2 facteurs ou plus → englobe le 2FA. |
| **2FA** | Two-Factor Authentication | Cas **particulier** du MFA à **exactement 2** facteurs (ex. mot de passe + TOTP). Deux preuves de la MÊME catégorie (2 mots de passe) ≠ 2FA. « MFA » a remplacé « 2FA » car plus général, pas par rebranding. |
| **Facteur** | Authentication factor | Une preuve d'identité d'**une** des 3 catégories : savoir (mot de passe), possession (passkey, TOTP), inhérence (biométrie). Combiner ≥2 catégories = MFA. |
| **TOTP** | Time-based One-Time Password | Le code à 6 chiffres qui change toutes les 30 s (Google Authenticator). Legacy : phishable (un faux site peut te le demander). |
| **OTP** | One-Time Password | Mot de passe à usage unique (par mail, SMS…). SMS = déconseillé (NIST). |
| **KBA** | Knowledge-Based Authentication | Les « questions secrètes » (nom du chien…). **INTERDIT** par NIST : trouvable sur les réseaux sociaux. |
| **WebAuthn** | Web Authentication (standard W3C) | L'API navigateur des passkeys : le site demande, l'appareil signe avec une clé privée qui ne sort JAMAIS (Touch ID, Windows Hello, clé USB). |
| **FIDO2** | Fast IDentity Online v2 | L'alliance industrielle + protocoles derrière WebAuthn. |
| **Passkey** | — | Identifiant WebAuthn synchronisé (trousseau Apple/Google) : rien à retenir, rien à voler côté serveur (clé publique seulement), **non-phishable** (liée au domaine exact). |
| **RP / rpId** | Relying Party (ID) | « La partie qui fait confiance » = ton site, identifié par son domaine — une passkey créée pour `exemple.fr` refuse de signer ailleurs (c'est ça l'anti-phishing). |
| **AAL2/AAL3** | Authenticator Assurance Level | Niveaux de confiance NIST d'une authentification : AAL2 = MFA solide (passkeys synced OK), AAL3 = matériel dédié (clé physique). |

### OAuth & délégation

<!-- prettier-ignore -->
| Sigle | Développé | En clair |
| --- | --- | --- |
| **OAuth 2.x** | Open Authorization | Le protocole « je laisse l'app X agir sur mon compte Y sans lui donner mon mot de passe » (login Google/GitHub…). |
| **OIDC** | OpenID Connect | OAuth + une carte d'identité standardisée (ID Token) : pas juste « accède », aussi « voici qui je suis ». |
| **PKCE** | Proof Key for Code Exchange (« pixie ») | Cadenas anti-interception du code OAuth : l'app prouve que c'est bien elle qui a démarré le flow. Obligatoire partout (OAuth 2.1). |
| **ROPC** | Resource Owner Password Credentials | L'app demande directement ton mot de passe — **banni** par OAuth 2.1 (c'est exactement ce qu'OAuth devait éviter). |
| **CIBA** | Client-Initiated Backchannel Authentication | « Approbation à distance » : l'action attend qu'un humain valide sur SON appareil (notification). Pattern clé pour les actions sensibles d'agents IA. |
| **SPIFFE** | Secure Production Identity Framework For Everyone | Standard d'identité des **machines/workloads** (pas des humains) : chaque process reçoit une identité vérifiable. Pertinent P12 (agents). |
| **Token Exchange** | RFC 8693 | « Troc de jeton » : un service/agent échange son jeton contre un autre pour agir **au nom de** quelqu'un (on-behalf-of), avec une portée réduite. Base de la délégation microservices ET agents IA. Slot Nodefony (`tokenExchange`, P12). |
| **`act`** | actor (acteur) | Le claim « qui agit au nom de qui » d'un Token Exchange : chaîne d'acteurs **auditable** (l'agent A agit pour l'utilisateur U) → délégation EXPLICITE, jamais une usurpation muette (≠ impersonation). |

### Attaques & défenses web

| Sigle              | Développé                              | En clair                                                                                                                                                                           |
| ------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **XSS**            | Cross-Site Scripting                   | Injection de JavaScript malveillant dans ta page → il lit tout ce que le JS peut lire (d'où : jetons JAMAIS lisibles en JS → BFF).                                                 |
| **CSRF**           | Cross-Site Request Forgery             | Un site tiers fait émettre par TON navigateur (qui porte tes cookies) une requête que tu n'as pas voulue. Défense moderne : Fetch Metadata + SameSite.                             |
| **Fetch Metadata** | en-têtes `Sec-Fetch-*`                 | Le « cachet de la poste » : le navigateur tamponne lui-même chaque requête avec sa provenance (`Sec-Fetch-Site: cross-site`) — infalsifiable par le site attaquant.                |
| **SameSite**       | attribut de cookie                     | Quand le cookie voyage-t-il depuis un autre site ? `Lax` (défaut) : navigation oui, mutations non. `Strict` : jamais (casse les liens entrants). `None` : toujours (exige Secure). |
| **SSRF**           | Server-Side Request Forgery            | Faire émettre par TON serveur une requête vers une cible interne (ex. métadonnées cloud `169.254.169.254`). Défense webhooks : refuser les IP privées.                             |
| **HSTS**           | HTTP Strict Transport Security         | En-tête « ce site est HTTPS-only pour 1 an » → le navigateur refuse tout HTTP même si l'utilisateur tape http://.                                                                  |
| **CSP**            | Content-Security-Policy                | Liste blanche de ce que la page a le droit de charger/exécuter — l'anti-XSS structurel. Le « nonce » = jeton unique par requête qui signe les scripts légitimes.                   |
| **HMAC**           | Hash-based Message Authentication Code | Signature symétrique d'un message avec un secret partagé — prouve l'origine ET l'intégrité (webhooks signés).                                                                      |
| **CSPRNG**         | Cryptographically Secure PRNG          | Générateur d'aléa imprévisible (≠ `Math.random()`). Obligatoire pour les ID de session.                                                                                            |

### Attaques JWT & durcissement cookie

| Sigle                   | Développé                | En clair                                                                                                                                                                  |
| ----------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`alg=none`**          | —                        | Attaque JWT : un jeton déclare « aucune signature » ; une lib naïve l'accepte → usurpation totale. Défense : **allowlist** d'algos serveur, jamais l'`alg` reçu.          |
| **Algorithm confusion** | substitution d'algo      | Attaque JWT : faire vérifier un RS256 comme un HS256 avec la clé **publique** en secret HMAC. Défense : 1 clé = 1 algo, fixé serveur.                                     |
| **allowlist/denylist**  | liste blanche / noire    | Allowlist = « seulement ceux-ci » (algos acceptés) ; denylist = « tous sauf » (`jti` révoqués). En sécu, préférer l'allowlist.                                            |
| **`__Host-`**           | préfixe de nom de cookie | Le navigateur refuse `__Host-x` sans `Secure` + `Path=/` + sans `Domain` → cookie cloué à l'hôte exact (anti sous-domaine pirate). Nodefony : la **session**, pas le JWT. |

### Autorisation (qui a le droit de faire quoi)

> **authn ≠ authz.** L'**authentification** (authn) répond « QUI es-tu ? » (le firewall, le login).
> L'**autorisation** (authz) répond « as-tu le DROIT de faire ça ? » (les voters, `@IsGranted`).
> On peut être authentifié ET refusé (un `user` connecté sur une route `ROLE_ADMIN` → **403**, pas 401).

| Sigle / terme                       | Développé                      | En clair                                                                                                                                                                                                    |
| ----------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RBAC**                            | Role-Based Access Control      | Droits par RÔLES (`ROLE_ADMIN` peut X). Simple, couvre 80 % des besoins. Niveau **A** chez Nodefony (`RoleVoter`).                                                                                          |
| **ABAC**                            | Attribute-Based Access Control | Droits par ATTRIBUTS contextuels (le **propriétaire** du document peut le modifier) → les voters reçoivent le `subject`. Niveau **C**.                                                                      |
| **Voter**                           | « votant / juré »              | Petit juge spécialisé : pour une décision donnée il rend **un** verdict parmi 3 (GRANT / DENY / ABSTAIN). On en empile autant qu'on veut (rôles, propriété, horaires…), chacun sur son domaine.             |
| **GRANT / DENY / ABSTAIN**          | accorde / refuse / s'abstient  | Les 3 verdicts d'un voter. **ABSTAIN** = « pas mon rayon » (ne compte pas). C'est la combinaison des votes qui tranche, pas un seul.                                                                        |
| **`AuthorizationService.decide()`** | —                              | Le **juge en chef** (`authorization.ts`, J6) : interroge tous les voters et applique la stratégie de vote → un seul booléen GRANT/DENY.                                                                     |
| **Stratégie affirmative**           | —                              | « **un seul GRANT suffit** » (tant qu'aucun DENY) — la stratégie de `decide()`. Permissive sur l'accord, stricte sur le refus.                                                                              |
| **Veto (DENY)**                     | —                              | « **un seul DENY refuse tout** », même si d'autres votent GRANT. Le refus l'emporte toujours (sécurité d'abord).                                                                                            |
| **Default DENY**                    | refus par défaut               | Tous ABSTAIN, ou **zéro** voter, ou aucun GRANT → **refusé** (Zero Trust). Il faut un OUI explicite, le silence ne suffit pas.                                                                              |
| **Fail-closed (voter)**             | « échoue fermé »               | Si un voter **plante** (throw) → compté comme DENY + log ERROR, jamais une 500 qui laisserait passer. L'erreur ne doit jamais ouvrir la porte (cf lexique général `fail-closed`).                           |
| **`voterRegistry`**                 | registre de voters             | Fabrique pluggable (convention-frère de `authenticatorRegistry`) : on **ajoute** un voter sans toucher `decide()`. Le futur `PermissionVoter` (RBAC ORM, niveau B/J6b) s'y branchera.                       |
| **`RoleVoter`**                     | —                              | Le voter niveau **A** : GRANT si le token porte le rôle demandé (via `RoleHierarchyWalker`), ABSTAIN sinon — **jamais de veto** (il ne bloque pas les attributs qu'il ne connaît pas).                      |
| **Attribute**                       | attribut (de décision)         | La chose demandée passée à `decide()` : un rôle (`ROLE_ADMIN`), une permission (`post:edit`)… Ne PAS confondre avec l'ABAC « attribut contextuel » (le `subject`).                                          |
| **Subject**                         | sujet / ressource ciblée       | L'objet **sur lequel** porte l'action (le document à éditer), passé au voter pour les règles ABAC (« est-il le propriétaire ? »). Optionnel — souvent un param de route via `@IsGranted(..., { subject })`. |

### Décorateurs sécurité (panoplie J7)

> Annotations posées sur un **controller** ou une **méthode d'action** (cf lexique général `décorateur`).
> Ils vivent dans `@nodefony/framework` mais expriment des règles de sécurité ; le moteur d'autorisation
> est appelé **par son nom** (0 cycle de dépendance). La **garde** s'exécute dans `Resolver.executeAction`,
> AVANT d'instancier le controller → un refus court-circuite tout (403 sans rien allouer).

<!-- prettier-ignore -->
| Décorateur | Rôle |
| --- | --- |
| **`@IsGranted`** | « exige ce(s) droit(s) ». `@IsGranted("ROLE_ADMIN")`. **Empilés = ET** (toutes les conditions). **Tableau = OU** (`@IsGranted(["ROLE_A", "ROLE_B"])` → l'un OU l'autre). Absorbe `@HasAnyRole`/`@HasAllRoles`. |
| **`@Anonymous`** | « route **publique** » : bypasse le firewall, et **annule** un `@IsGranted` posé au niveau de la classe. À déclarer explicitement (Zero Trust : sinon tout est fermé). |
| **`@CurrentUser`** | Injecte l'utilisateur authentifié (lu dans l'ALS) **en paramètre** de l'action — pas besoin d'aller le chercher dans le contexte à la main. |
| **Garde (guard)** | La vérification elle-même : le code du Resolver qui lit les métadonnées `@IsGranted`, appelle `decide()`, et laisse passer (GRANT) ou lève **403** (DENY). **Une seule garde couvre tous les transports** (HTTP, WS `api.request`, forward) — c'est l'invariant « 1 garde = N transports ». |

### Organismes & textes

<!-- prettier-ignore -->
| Sigle | Développé | En clair |
| --- | --- | --- |
| **IETF** | Internet Engineering Task Force | L'organisme qui écrit les standards d'Internet (les RFC). |
| **RFC** | Request For Comments | Un standard IETF numéroté (RFC 9700…). Malgré le nom modeste, c'est LA norme. |
| **BCP** | Best Current Practice | Catégorie de RFC : « les bonnes pratiques actuelles » consolidées. |
| **W3C** | World Wide Web Consortium | Standards du web côté navigateur (WebAuthn, CSP…). |
| **NIST** | National Institute of Standards and Technology | Agence US dont les guidelines (SP 800-63) font référence mondiale pour l'identité numérique. |
| **OWASP** | Open Worldwide Application Security Project | Communauté de référence sécu applicative (Top 10, Cheat Sheets). |
| **ANSSI** | Agence Nationale de la Sécurité des Systèmes d'Information | L'autorité française de cybersécurité. |

## ⚠️ Pièges — confusions fréquentes en sécurité

Un même mot recouvre deux réalités : les confondre ouvre une faille ou brouille un raisonnement.

| Confusion                               | À garder en tête                                                                                                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **authn ≠ authz**                       | authn = « QUI es-tu ? » (firewall, login). authz = « as-tu le DROIT ? » (voters, `@IsGranted`). Authentifié **et** refusé = **403**, jamais 401.                                       |
| **MFA vs 2FA**                          | 2FA = cas particulier du MFA à **exactement 2** facteurs de catégories **différentes**. Deux mots de passe ≠ 2FA (même catégorie).                                                     |
| **scope vs rôle**                       | Deux axes distincts : le **rôle** dit qui tu es (`ROLE_ADMIN`) ; le **scope** dit ce que CE jeton peut (`orders:read`). Un PAT a des scopes ⊆ des droits de son porteur.               |
| **Attribute (decide) vs attribut ABAC** | `Attribute` = la chose demandée à `decide()` (un rôle, une permission). L'« attribut » ABAC = le **contexte** (le `subject`, ex. le propriétaire). Homonymes, sens opposés.            |
| **allowlist vs denylist**               | allowlist = « seulement ceux-ci » (algos JWT acceptés) ; denylist = « tous sauf » (`jti` révoqués). En sécu, préférer l'allowlist.                                                     |
| **JWT en cookie ?**                     | **Non.** Chez Nodefony le JWT voyage en `Authorization: Bearer` (API/machines) ; le **cookie** ne porte qu'une session opaque BFF (web/Studio). Les confondre casse le modèle hybride. |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Sécurité — vue d'ensemble](index.md) · [Toute la documentation](../../../../../docs/index.md)
- 📖 [Lexique général](../../../../../docs/lexique.md) — le vocabulaire transverse (opt-in, lazy, DI, fail-closed…)
- 🔥 [Firewall](firewall.md) · 🎫 [Jetons](tokens.md) · 🛡️ [CSRF](csrf.md) — les briques où ces termes s'appliquent

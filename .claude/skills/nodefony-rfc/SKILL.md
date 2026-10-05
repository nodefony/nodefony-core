---
name: nodefony-rfc
metadata:
  version: 1.5.0
description: >
  Cite et applique les normes qui font foi pour Nodefony — RFC, W3C/WHATWG, MCP, AGENTS.md —
  depuis des sources brutes, jamais des pages HTML. Porte HORS LIGNE MCP 2026-07-28, AGENTS.md,
  Keycloak 26.8 et un relevé des terminaux (souris, molette, presse-papiers, séquences xterm), avec
  un script de dérive amont. Dit quelles RFC tranchent un proxy inverse.
  Déclencheurs : "RFC", "conformité HTTP", "norme WebSocket", "CORS spec", "RFC 9110/9113/6455/6265",
  "SameSite cookies", "spec MCP", "Model Context Protocol", "autorisation MCP",
  "resource server OAuth", "RFC 9728", "AGENTS.md", "spec AGENTS.md", "AAIF",
  "quelle taille pour AGENTS.md", "dossier .agents",
  "Agent Skills", "quel fichier lit tel agent", "Keycloak", "realm", "importer un realm",
  "audience Keycloak", "hostname Keycloak", "proxy inverse", "reverse proxy", "en-têtes hop-by-hop",
  "request smuggling", "que fait nginx", "norme périmée", "souris dans le terminal", "OSC 52".
---

# nodefony-rfc

Référence canonique des normes pour le framework Nodefony — sources brutes uniquement, zéro token gaspillé en chrome HTML.

> _Maintenance_ : édition **en place** (l'histoire vit dans `git log`). Les RFC IETF ne changent
> jamais ; une spec vivante (MCP, Fetch), si — une révision figée dans `references/` se REMPLACE par
> l'amont, elle ne s'annote pas.

## Règle d'or

Mécanisme de chargement = **règle universelle du `CLAUDE.md` racine** : sources brutes via raw GitHub + proxy `r.jina.ai`, jamais les pages HTML (`tools.ietf.org`, `w3c.org`).
Exception RFC : les `.txt` officiels IETF sont déjà bruts → les charger en direct, sans proxy.
**Zéro prose** : trouver la section RFC → appliquer la syntaxe exacte (casse headers, séparateurs `\r\n`) → valider. Pas de rapport historique.

## Sources canoniques

### 1. HTTP/1.1 & Sémantique — RFC 9110 (remplace 7231)

Source absolue pour status codes, headers, méthodes :

```
https://www.ietf.org/rfc/rfc9110.txt
```

> Utilise `grep` ou cherche le mot-clé exact (ex: `"401 Unauthorized"`) — ne lis jamais les 200 pages.

### 2. HTTP/2 — RFC 9113 (remplace 7540)

Multiplexage, streams, pseudo-headers (`:status`, `:method`, `:authority`) pour `@nodefony/http` :

```
https://www.ietf.org/rfc/rfc9113.txt
```

### 3. WebSocket — RFC 6455

Handshake HTTP, masquage frames, fermeture connexions :

```
https://www.ietf.org/rfc/rfc6455.txt
```

### 4. Cookies & SameSite — RFC 6265

Pour `@nodefony/security` (firewall, session, CSRF) :

```
https://www.ietf.org/rfc/rfc6265.txt
```

### 5. CORS — Fetch Standard W3C

Spec vivante (WHATWG), via proxy markdown :

```
https://r.jina.ai/https://fetch.spec.whatwg.org/
```

### 6. Model Context Protocol — révision `2026-07-28` — **HORS LIGNE**

La spec MCP n'est pas une RFC : elle vit dans un dépôt, en `.mdx`, et **change de forme entre
révisions**. La révision entière est figée dans `references/mcp-2026-07-28/` — **arborescence
identique à l'amont**, donc une URL `…/specification/2026-07-28/<chemin>` se lit ici en
`spec/<chemin>.mdx`, sans rien chercher. La relire ne coûte aucune requête.

| Fichier `references/mcp-2026-07-28/`                          | Ce qu'on y trouve, et pourquoi on y va                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `spec/basic/versioning.mdx`                                   | **Les deux ÈRES** (`modern` ≥ 2026-07-28 vs `legacy` ≤ 2025-11-25) et le tableau de compatibilité client↔serveur    |
| `spec/basic/transports/streamable-http.mdx`                   | Le `POST` unique, `202` sans corps, `Origin`, `-32020`/`-32022`, validation d'en-têtes                              |
| `spec/basic/index.mdx`                                        | Cycle de vie, capacités, forme des messages                                                                         |
| `spec/server/discover.mdx` · `spec/server/tools.mdx`          | `server/discover` ; forme d'un outil, `content[]`, `isError`, schéma de sortie                                      |
| `spec/basic/authorization/index.mdx`                          | Rôle **resource server**, usage du jeton, `401`/`403`, stratégie de scopes, URI canonique (RFC 8707)                |
| `spec/basic/authorization/authorization-server-discovery.mdx` | Où publier les métadonnées, et le **MUST `authorization_servers` ≥ 1**                                              |
| `spec/basic/authorization/security-considerations.mdx`        | Liaison d'audience, vol de jeton, _confused deputy_                                                                 |
| `spec/basic/patterns/*` · `spec/client/*`                     | Annulation, progression, abonnements, MRTR ; `elicitation`, `sampling`, `roots` (côté client)                       |
| `spec/changelog.mdx` · `spec/deprecated.mdx`                  | Ce que la révision a changé, et ce qu'elle a retiré — à lire AVANT de porter du code d'une révision antérieure      |
| `schema/schema.ts` · `schema/schema.json`                     | **Le contrat qui fait foi** quand une phrase de prose est ambiguë — types TypeScript et JSON Schema de tout message |
| `schema/examples/<Type>/*.json`                               | Un exemple canonique par message (`CallToolResult`, `UnsupportedProtocolVersionError`…) — comparer sa sortie à ça   |

🔴 **Deux pièges déjà payés, à relire avant d'affirmer quoi que ce soit :**

1. **Les exigences qui comptent ne sont pas toujours dans la page qui parle de votre sujet.** Un
   serveur bâti sur la seule page `transports` s'est retrouvé _legacy_ tout en annonçant une
   révision _moderne_ — un couple que le tableau de `versioning.mdx` classe « Fails ».
2. **Conforme ≠ joignable.** Annoncer sa révision préférée au lieu d'ÉCHOER celle que le client
   demande rend la porte injoignable par tout SDK déployé. La conformité se mesure **sur un
   client**, pas sur une spec.

Révision courante servie par le code : `src/nodefony/src/mcp/protocol.ts`.

Poser une **nouvelle** révision quand l'amont en publie une (un tarball, pas 180 appels d'API ;
`schema.mdx` est écarté — 726 KB de prose qui redit `schema.ts`) :

```bash
V=2027-xx-xx; R=.claude/skills/nodefony-rfc/references/mcp-$V
gh api repos/modelcontextprotocol/modelcontextprotocol/tarball/main > /tmp/mcp.tgz
mkdir -p /tmp/mcp-x && tar -xzf /tmp/mcp.tgz -C /tmp/mcp-x --strip-components=1 \
  "*/docs/specification/$V/*" "*/schema/$V/*"
find /tmp/mcp-x -name '*.png' -delete && rm -f "/tmp/mcp-x/docs/specification/$V/schema.mdx"
mkdir -p "$R" && cp -R "/tmp/mcp-x/docs/specification/$V/." "$R/spec/" \
  && cp -R "/tmp/mcp-x/schema/$V/." "$R/schema/"
```

> **La révision précédente se GARDE** tant que du code la sert : les clients déployés sont en
> retard sur la spec (`MCP_SUPPORTED_VERSIONS` en liste cinq), et c'est l'ancienne page qui dit ce
> qu'ils attendent.

### 7. OAuth — les deux rôles — **HORS LIGNE, dans le corpus UNIQUE**

🔴 **Les full-text RFC ne vivent PAS dans ce skill.** Une seule copie existe, dans
`.claude/skills/nodefony-framework-dev/references/rfc/ietf/rfc<N>.txt` — deux corpus avaient déjà
produit deux exemplaires byte-identiques de `6750` et `8707`, que rien ne resynchronisait. Ce skill
dit **ce que chaque RFC tranche** ; le texte se lit là-bas, au `grep`.

Ce que la spec MCP délègue aux RFC, pour un serveur qui valide un jeton sans jamais en émettre :

| RFC      | Ce qu'elle tranche                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **9728** | `/.well-known/oauth-protected-resource` — construction de l'URL **avec insertion du chemin**, champs du document, `WWW-Authenticate: Bearer resource_metadata="…"` |
| **6750** | Présentation du jeton, `401 invalid_token`, `403 insufficient_scope`                                                                                               |
| **8707** | `resource` — l'URI canonique qui **lie le jeton à CE serveur** (défense _confused deputy_)                                                                         |

Et la face symétrique — un serveur qui veut que ses signatures soient vérifiables ailleurs :

<!-- prettier-ignore -->
| RFC | Ce qu'elle tranche |
| --- | --- |
| **8414** | `/.well-known/oauth-authorization-server` — l'identifiant d'émetteur (§2 : https, ni requête ni fragment), l'**insertion** du suffixe avant le chemin (§3.1), l'**égalité stricte** du champ `issuer` côté lecteur (§3.3), et les champs REQUIS (`response_types_supported` ; `grant_types_supported` omis vaut `["authorization_code","implicit"]`) |

> Un serveur d'autorisation n'est **jamais** requis pour le rôle ressource : la spec MCP le place
> « beyond the scope […] or a separate entity ». Écrire l'inverse a longtemps servi d'excuse à ne
> rien faire.

### 8. AGENTS.md — la convention d'instructions d'agent — **HORS LIGNE**

`AGENTS.md` est **stewardé par l'Agentic AI Foundation (AAIF), sous la Linux Foundation** — donné
le **2025-12-09** par OpenAI et Anthropic, en même temps que **MCP** et **goose**. Ce n'est pas une
spécification normative : c'est une **convention**, sans schéma ni version, et son dépôt canonique
tient en trois fichiers. Ils sont figés dans `references/agents-md/`, ancrés à leur SHA amont.

| Ce qu'on veut savoir                          | Où le lire, hors ligne                                     |
| --------------------------------------------- | ---------------------------------------------------------- |
| Le format et un exemple minimal               | `references/agents-md/README.md`                           |
| Les phrases qui font foi (précédence, portée) | `references/agents-md/NOTES.md`                            |
| Ce que le dépôt s'applique à lui-même         | `references/agents-md/AGENTS.md`                           |
| L'ancrage amont (dépôt, SHA, fichiers suivis) | `references/agents-md/AMONT.json`                          |
| La gouvernance                                | `Technical_Charter.pdf` du dépôt amont (non figé — 224 Ko) |

🔴 **Les trois faits qui décident d'une conception, et qu'on croit savoir à tort :**

1. **Il n'y a AUCUN mécanisme d'inclusion.** « AGENTS.md is just standard Markdown » — un fichier
   d'annexe n'est chargé par personne, quel que soit le soin de l'index qui le nomme. Le seul
   mécanisme de la convention est la **précédence par proximité** : « the closest AGENTS.md to the
   edited file wins ; explicit user chat prompts override everything ».
2. **La taille a des plafonds ÉDITEURS, et l'un est DUR.** OpenAI Codex **concatène** les
   `AGENTS.md` de la racine jusqu'au répertoire courant et tronque **en silence** à **32 KiB**
   (`project_doc_max_bytes`). Cursor recommande < 500 lignes, Claude Code < 200. Un fichier qui
   dépasse n'échoue pas : il est amputé sans le dire.
3. **`.agents/` n'est PAS une norme** — deux propositions concurrentes, `bgreenwell/dotagents`
   (brouillon, 89 ★) et `agentsfolder/spec` (5 ★, sans évolution depuis janvier 2026), aucune
   implémentation tierce, aucun lien avec l'AAIF. En revanche **`.agents/skills/` est une racine de
   fait** pour les _Agent Skills_ — ce que le produit constate client par client dans
   `src/nodefony/src/cli/aiSyncReport.ts` (`SKILLS_DIR`), avec sa preuve au source de chacun. Ne pas
   confondre les deux : le dossier d'instructions n'existe pas, la racine de skills, si.

**Rester à jour — une spec vivante se périme en SILENCE.** Une RFC ne bouge jamais ; celle-ci, si.
La copie figée porte donc son SHA, et un automate dit quand l'amont l'a dépassée :

```bash
node .claude/skills/nodefony-rfc/scripts/check-amont.mjs
# 0 = à jour · 3 = des fichiers SUIVIS ont changé (il les nomme) · 78 = on ne SAIT pas (réseau)
```

Il ne met **jamais** à jour tout seul : une spec se relit avant d'être remplacée. Quand il signale
une dérive, on relit le comparatif qu'il donne, on remplace les fichiers **et** le `sha` de
`AMONT.json`. Toute référence ajoutée ici sans `AMONT.json` est signalée comme invérifiable — c'est
le cas de `mcp-2026-07-28`, figé à la main.

### 9. Keycloak 26.8 — l'IdP de référence du social login et du serveur de ressources — **HORS LIGNE**

Pas une norme : le **produit** contre lequel le fournisseur `keycloak` de `@nodefony/security`
s'éprouve (login BFF, jetons d'API, compte de service, serveur d'autorisation MCP). Sélection de
37 guides AsciiDoc figés au tag `26.8.0` dans `references/keycloak-26.8/` (`AMONT.json` → suivie par
`check-amont.mjs`). Le décor qui les met en œuvre : profil `keycloak` de `docker/docker-compose.yml`.

| Ce qu'on veut savoir                                      | Où le lire, hors ligne                                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conteneur, `start-dev`, import d'un realm au démarrage    | `guides/server/containers.adoc`, `guides/server/importExport.adoc`                                                                                      |
| Émetteur stable (`hostname`), TLS, port de gestion, santé | `guides/server/hostname.adoc`, `enabletls` absent → `configuration.adoc`, `guides/server/management-interface.adoc`, `guides/observability/health.adoc` |
| Points d'entrée OIDC, flux, client confidentiel, audience | `documentation/server_admin/topics/sso-protocols/*`, `.../clients/oidc/*`                                                                               |
| Échange de jetons, DPoP, serveur d'autorisation MCP       | `guides/securing-apps/{token-exchange,dpop,mcp-authz-server}.adoc`                                                                                      |
| Ruptures de la version figée                              | `documentation/upgrading/topics/changes/changes-26_8_0.adoc`                                                                                            |

🔴 **Les faits qui décident d'une conception :**

1. **Le realm importé n'est JAMAIS réimporté** s'il existe (stratégie `IGNORE_EXISTING`) : modifier
   le JSON ne change rien tant que le volume vit — `down -v` (ou retirer le seul volume Keycloak).
2. **`KC_HOSTNAME` en URL complète** fige l'`iss` : sans lui, l'émetteur suit l'hôte de la requête
   et le navigateur, l'app et un conteneur voient trois émetteurs différents.
3. **Le jeton d'accès porte `aud: "account"` par défaut** — un serveur de ressources qui exige son
   audience (Nodefony l'exige) le refuse tant qu'un _audience mapper_ ne l'ajoute pas.
4. **TLS activé ⇒ le port de gestion passe en https aussi** ; `http-management-scheme=http` le
   garde en clair pour une sonde interne au conteneur.
5. Le `sub` est un **UUID** de l'utilisateur Keycloak, unique dans le realm seulement.

### 10. Proxy inverse — **HORS LIGNE, dans le corpus UNIQUE** + proxys de référence

Texte des RFC : `.claude/skills/nodefony-framework-dev/references/rfc/ietf/` (même règle qu'au §7 :
une seule copie). Ce que chacune tranche pour `ReverseProxy` (`@nodefony/http`) — l'application
détaillée, avec l'ancrage de chaque test, vit au §4 du README du corpus (skill
`nodefony-framework-dev`) :

<!-- prettier-ignore -->
| RFC § | Ce qu'elle tranche |
| --- | --- |
| **9110 §7.6.1** | En-têtes de connexion (et ceux que nomme `Connection`) jamais relayés |
| **9110 §7.6.3 / §7.6** | `Via` obligatoire pour un proxy ; ne jamais se renvoyer un message sans garde de boucle |
| **9112 §6.1 / §6.3 / §11.2** | Cadrage du corps (TE l'emporte sur CL) ; request smuggling |
| **9112 §3.2.2** | Cible absolute-form : le proxy remplace `Host` |
| **9113 §8.2.2 / §8.3.1** | En-têtes interdits en HTTP/2 ; pseudo-en-têtes |
| **7239 §8.1** | `Forwarded` falsifiable : ne le croire que d'un relais de confiance |
| **6455 §4.2.1 / §10.2** | Handshake WebSocket conforme ; contrôle d'`Origin` |
| **5842 §7.2** | `508 Loop Detected` — défini pour WebDAV, emprunté pour une boucle de proxy (RFC 9110 n'en a pas) |

**Avant d'inventer un comportement de proxy, lire ce que font les spécialistes** — docs BRUTES
(un relevé de leurs défauts a déjà corrigé une dizaine de manques : tunnel `h2c`, `Origin`, chaîne
`X-Forwarded-For` crue, chemins `%2e%2e`, agent global sous `NODE_USE_ENV_PROXY`) :

| Proxy   | Source brute (`grep` la directive)                                                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nginx   | `https://raw.githubusercontent.com/nginx/nginx.org/master/xml/en/docs/http/ngx_http_proxy_module.xml` (+ `ngx_http_core_module.xml`, `websocket.xml`)                             |
| HAProxy | `https://raw.githubusercontent.com/haproxy/haproxy/master/doc/configuration.txt`                                                                                                  |
| Envoy   | dépôt `envoyproxy/envoy`, `docs/root/configuration/http/http_conn_man/headers.rst`, `docs/root/faq/configuration/timeouts.rst`, `docs/root/intro/arch_overview/http/upgrades.rst` |
| Caddy   | dépôt `caddyserver/website`, `src/docs/markdown/caddyfile/directives/reverse_proxy.md`                                                                                            |
| Traefik | dépôt `traefik/traefik`, `docs/content/reference/routing-configuration/http/middlewares/{encodedcharacters,stripprefix}.md`                                                       |

⚠️ La doc d'une API Node se **vérifie à l'exécution** avant d'en tirer une conclusion : la doc
de `http.request` laisse lire qu'un `IncomingMessage` coupé émet `'error'` ; le runtime ne l'émet
que s'il a un écouteur (`IncomingMessage.prototype._destroy`, lisible par `node -e`).

### 11. Terminal — souris, molette, sélection, presse-papiers — **HORS LIGNE**

Pas une norme unique : xterm « ctlseqs » fait référence, chaque terminal en implémente une part.
Le relevé de `references/terminal/` donne, pour quinze terminaux et une vingtaine de TUI, le
comportement CONSTATÉ, chaque case avec sa source et un extrait verbatim (« Inconnu » quand rien
ne le dit — jamais déduit).

| Ce qu'on veut savoir                                                           | Où le lire                                      |
| ------------------------------------------------------------------------------ | ----------------------------------------------- |
| Modes 1000/1002/1003/1006/1007/1049/2004, DECRQM, OSC 52, CPR (verbatim)       | `references/terminal/xterm-ctlseqs-extracts.md` |
| Par terminal : molette en écran alternatif, touche de sélection, OSC 52, sonde | `references/terminal/terminals-matrix.md`       |
| Comment les TUI établies arbitrent molette contre sélection, et pourquoi       | `references/terminal/tui-practices.md`          |
| Souris sous Windows (libuv, `setRawMode`), presse-papiers depuis Node          | `references/terminal/node-windows-clipboard.md` |

🔴 **Les trois faits qui décident :** capter la souris (1000/1006) est le SEUL comportement
uniforme pour la molette, et il tue la sélection native (contournement : Maj, ⌥ sous iTerm2, Fn
sous Terminal.app) ; le mode 1007 n'est pas actif par défaut sous Terminal.app, iTerm2 ni xterm ;
OSC 52 n'accuse jamais réception et reste bloqué par défaut dans iTerm2 et xterm — un repli, pas
une voie. Le relevé a été fait sur les dépôts amont du jour : une case qui décide se recontrôle
avant de s'y appuyer.

## Pattern d'usage

1. Identifier la zone fonctionnelle : status code → 9110, frame WS → 6455, etc.
2. `curl -s <URL> | grep -A 20 "<mot-clé>"` pour extraire uniquement la section utile.
3. Adapter à la syntaxe TypeScript Nodefony (jamais de copier-coller verbatim).
4. Citer la RFC dans le commit message si la modif touche un comportement normatif.

## Anti-patterns à éviter

- Reformuler la RFC dans la conversation — coûteux en tokens, source faisant foi.
- Charger plus de 50 lignes d'une RFC en contexte — toujours `grep -A` ciblé.
- Inventer un comportement "raisonnable" sans vérifier la RFC — vérifier d'abord.

---
name: nodefony-rfc
metadata:
  version: 1.1.0
description: >
  Cite et applique les normes qui font foi pour Nodefony — RFC IETF, specs W3C/WHATWG, et la
  spécification Model Context Protocol — depuis des sources brutes, jamais des pages HTML. Porte
  HORS LIGNE la révision MCP 2026-07-28 (transport, versioning, autorisation) et renvoie au corpus
  RFC unique du dépôt (40 full-text, dont OAuth 8414/9728/6750/8707) : les relire coûte zéro requête.
  Déclencheurs : "RFC", "conformité HTTP", "norme WebSocket", "CORS spec", "Fetch standard",
  "RFC 9110/9113/6455/6265", "pseudo-headers HTTP/2", "frame masking", "SameSite cookies",
  "spec MCP", "Model Context Protocol", "révision 2026-07-28", "server/discover", "ère legacy MCP",
  "autorisation MCP", "resource server OAuth", "protected resource metadata", "RFC 9728",
  "WWW-Authenticate", "jeton Bearer", "audience d'un jeton", "resource indicator".
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

## Pattern d'usage

1. Identifier la zone fonctionnelle : status code → 9110, frame WS → 6455, etc.
2. `curl -s <URL> | grep -A 20 "<mot-clé>"` pour extraire uniquement la section utile.
3. Adapter à la syntaxe TypeScript Nodefony (jamais de copier-coller verbatim).
4. Citer la RFC dans le commit message si la modif touche un comportement normatif.

## Anti-patterns à éviter

- Reformuler la RFC dans la conversation — coûteux en tokens, source faisant foi.
- Charger plus de 50 lignes d'une RFC en contexte — toujours `grep -A` ciblé.
- Inventer un comportement "raisonnable" sans vérifier la RFC — vérifier d'abord.

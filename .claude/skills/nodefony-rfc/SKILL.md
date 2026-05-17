---
name: nodefony-rfc
description: >
  Cite et applique les RFC officielles IETF et W3C pour valider la conformité HTTP/1.1, HTTP/2,
  WebSocket, CORS, Cookies dans Nodefony. Utilise les sources brutes (TXT IETF, raw GitHub W3C)
  via le proxy `r.jina.ai` quand nécessaire — interdiction de naviguer sur les pages HTML.
  Déclencheurs : "RFC", "conformité HTTP", "norme WebSocket", "CORS spec", "Fetch standard",
  "RFC 9110/9113/6455/6265", "pseudo-headers HTTP/2", "frame masking", "SameSite cookies".
---

# nodefony-rfc

Référence canonique des RFC pour le framework Nodefony — sources brutes uniquement, zéro token gaspillé en chrome HTML.

## Règle d'or

- **Interdiction** d'utiliser `tools.ietf.org` ou `w3c.org` via les pages HTML.
- Les fichiers `.txt` officiels IETF sont parfaits : 0 token gaspillé en structure de page.
- **Zéro Prose** : trouver la section RFC → appliquer la syntaxe exacte dans le code (casse headers, séparateurs `\r\n`) → valider. Pas de rapport historique.

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

### 4. Cookies & SameSite — RFC 6265bis

Pour `@nodefony/security` (firewall, session, CSRF) :

```
https://www.ietf.org/rfc/rfc6265.txt
```

### 5. CORS — Fetch Standard W3C

Spec vivante (WHATWG), via proxy markdown :

```
https://r.jina.ai/https://fetch.spec.whatwg.org/
```

## Pattern d'usage

1. Identifier la zone fonctionnelle : status code → 9110, frame WS → 6455, etc.
2. `curl -s <URL> | grep -A 20 "<mot-clé>"` pour extraire uniquement la section utile.
3. Adapter à la syntaxe TypeScript Nodefony (jamais de copier-coller verbatim).
4. Citer la RFC dans le commit message si la modif touche un comportement normatif.

## Anti-patterns à éviter

- Reformuler la RFC dans la conversation — coûteux en tokens, source faisant foi.
- Charger plus de 50 lignes d'une RFC en contexte — toujours `grep -A` ciblé.
- Inventer un comportement "raisonnable" sans vérifier la RFC — vérifier d'abord.

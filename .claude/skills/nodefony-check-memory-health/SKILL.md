---
name: nodefony-check-memory-health
description: >
  Gate mémoire de Nodefony : lance la suite d'intégration de @nodefony/http (1000 GET séquentiels,
  100 crashs sync/async, 100 connexions WS), valide les seuils de heap, et surtout dit QUOI FAIRE
  quand un seuil saute (blocker, ne pas commiter, où chercher la fuite, comment distinguer une vraie
  fuite d'un flake d'isolation). Le CLAUDE.md donne la commande ; ce skill donne le protocole et
  l'interprétation — le charger AVANT de lancer la commande, pas après un résultat rouge.
  Déclencheurs : "vérifier la mémoire", "memory leak", "test mémoire", "heap delta", "fuite mémoire",
  "gate mémoire", "j'ai touché au pipeline", "j'ai modifié le Kernel ou le Container",
  "je vais commiter une modif http/framework", "le seuil mémoire a sauté", "heap qui monte".
---

# check-memory-health

Wrapper sur les tests Vitest mémoire de `@nodefony/http` (`memory.test.ts`, config dédiée `vitest.load.config.ts`) avec filtrage chirurgical et grille d'interprétation des seuils.

## Quand l'utiliser

- **Obligatoire** avant tout commit qui modifie : `@nodefony/http`, `@nodefony/framework`, le pipeline request, le DI container, le syslog
- Après un fix sur un hook utilisateur (after-response, signal abort, etc.)
- Pour valider qu'un refactor n'a pas régressé la stabilité GC
- Sur demande explicite : « vérifie la mémoire », « tests memory », « heap delta »

## Pourquoi ça économise des tokens

Lancer le runner sans filtre = des centaines de lignes d'output. Ce filtre isole les lignes utiles (`Test Files`, `Tests`, heap deltas, FAIL).

## Prérequis

- Serveur Nodefony **lancé** sur ports 5151/5152 (voir skill `nodefony-start-server`) — les tests
  **TAPENT** ce serveur, ils ne le spinnent pas. `before all` en ECONNREFUSED = serveur down/port
  pris, **jamais le heap** (vu 3×).
- **NE PAS enchaîner** avec le filet CLI (`RUN_CLI_BOOT=1` spawne `production`/`cluster` sur
  5151/5152 → conflit de ports). Séquencer : (filet CLI seul) PUIS (`start.sh` + memory test).
- Les tests utilisent l'endpoint `/nodefony/test/memory` du module test pour mesurer le heap

## Commande à exécuter

```bash
# Vitest (mocha SUPPRIMÉ 2026-06-05). Le gate = memory.test.ts seul, via
# vitest.load.config.ts (séquentiel, séparé de la non-régression rapide).
cd /Users/cci/repository/nodefony-core/src/packages/@nodefony/http \
  && npm run test:memory 2>&1 \
  | grep -E "Test Files|Tests |heap grew|✓|×|FAIL|memory" \
  | tail -20
```

Output attendu (9/9 verts) :

```
 ✓ nodefony/tests/http/memory.test.ts (9 tests)
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

> ⚠️ Le gate exige un serveur lancé via **`start.sh`** (skill `nodefony-start-server`) : il injecte
> `--expose-gc` pour que la sonde `/nodefony/test/memory` force le GC avant chaque mesure (sinon
> faux positifs GC-noise, ex. async-crash à 10.4 MB — cf [[project_ws_sustained_heap_finding]]).
> Si le serveur tourne depuis longtemps ou a été lancé autrement → restart via le skill d'abord.

## Grille de seuils (règle dure Nodefony — `CLAUDE.md`)

<!-- prettier-ignore -->
| Test | Seuil critique | Si dépassé → cause probable |
| --- | --- | --- |
| 1000 sequential GET | < 35 MB | Fuite dans le cycle de vie request (listeners non removed, scope non leaved) |
| 100 sync crashes | < 10 MB | Kernel ne nettoie pas les scopes après exception |
| 100 async crashes | < 10 MB | Idem + promesse non rejected |
| 100 native TypeError crashes | < 15 MB | Idem + cause chain pas attrappée |
| 500 mixed (index + context + session) | < 20 MB | Storage session qui accumule |
| 200 multipart uploads | < 30 MB | busboy listeners / WriteStream non libérés (hot path streamMultipart) |
| 100 WS connections open/close | < 30 MB | WS listener non removed sur `close` |
| 50 WS echo round-trips | < 25 MB | Buffer message non libéré (seuil 25 : marge bruit GC en fin de suite) |

**Si un seuil saute** → c'est un **blocker**. NE PAS commit. Investiguer :

1. `git diff -w src/` pour identifier les listeners attachés
2. Vérifier `removeListener` / `once` complémentaire (CLAUDE.md règle perf)
3. Vérifier `lazy alloc` (null par défaut → array au premier register → null après fire)
4. Si la cause est trouvée : fix + re-run jusqu'au vert

## Rapport ultra-court

À résumer à l'utilisateur en 3 lignes max :

```
Memory : 8/8 verts | 1000 GET 3200ms (<35MB) | crashs 10/10/15 MB OK | WS 30/20 MB OK
```

## Quand NE PAS utiliser

- Pour mesurer une seule requête isolée → `node --inspect` + profiler Chrome
- Pour de la perf CPU pure → utiliser `npx clinic` ou un benchmark séparé
- Si le serveur n'est pas lancé → lancer d'abord via skill `nodefony-start-server`

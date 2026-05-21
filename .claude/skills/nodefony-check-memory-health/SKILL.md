---
name: nodefony-check-memory-health
description: >
  Lance la suite de tests d'intégration mémoire de @nodefony/http (1000 GET séquentiels,
  100 crashs sync/async, 100 connexions WS) et valide les seuils de Heap Delta Nodefony.
  Indispensable avant tout commit touchant le Kernel, le DI Container ou le pipeline request.
  Déclencheurs : "vérifier la mémoire", "memory leak", "test mémoire", "heap delta",
  "fuite mémoire", "check memory", "perf mémoire serveur".
---

# check-memory-health

Wrapper sur les tests Mocha mémoire de `@nodefony/http` avec filtrage chirurgical et grille d'interprétation des seuils.

## Quand l'utiliser

- **Obligatoire** avant tout commit qui modifie : `@nodefony/http`, `@nodefony/framework`, le pipeline request, le DI container, le syslog
- Après un fix sur un hook utilisateur (after-response, signal abort, etc.)
- Pour valider qu'un refactor n'a pas régressé la stabilité GC
- Sur demande explicite : « vérifie la mémoire », « tests memory », « heap delta »

## Pourquoi ça économise des tokens

Lancer Mocha sans filtre = des centaines de lignes d'output incluant tous les autres tests. Ce filtre isole les 8 lignes utiles (`passing`, `failing`, durations).

## Prérequis

- Serveur Nodefony **lancé** sur ports 5151/5152 (voir skill `nodefony-start-server`)
- Les tests utilisent l'endpoint `/nodefony/test/memory` du module test pour mesurer le heap

## Commande à exécuter

```bash
cd /Users/cci/repository/nodefony-core/src/packages/@nodefony/http \
  && TS_NODE_PROJECT=tsconfig.tests.json \
     npx mocha --config .mocharc.integration.json --grep "Memory" 2>&1 \
  | grep -E "passing|failing|✔|✘|Memory leaks|<" \
  | tail -20
```

Output attendu (8/8 verts) :

```
  Memory leaks — HTTP (requires server)
    ✔ 1000 sequential GET requests — server heap delta < 35 MB (3200ms)
    ✔ 100 consecutive sync crashes — server heap delta < 10 MB (320ms)
    ✔ 100 consecutive async crashes — server heap delta < 10 MB (300ms)
    ✔ 100 consecutive native TypeError crashes — server heap delta < 15 MB (390ms)
    ✔ 500 mixed requests (index + context + session) — server heap delta < 20 MB (1400ms)
    ✔ server is alive after load — /index returns 200
  Memory leaks — WebSocket (requires server)
    ✔ 100 WS connections open/close — server heap delta < 30 MB (480ms)
    ✔ 50 WS echo round-trips open/send/close — heap delta < 20 MB (290ms)

  8 passing (7s)
```

## Grille de seuils (règle dure Nodefony — `CLAUDE.md`)

| Test                                      | Seuil critique         | Si dépassé → cause probable                                         |
| ----------------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| 1000 sequential GET                       | < 35 MB                | Fuite dans le cycle de vie request (listeners non removed, scope non leaved) |
| 100 sync crashes                          | < 10 MB                | Kernel ne nettoie pas les scopes après exception                     |
| 100 async crashes                         | < 10 MB                | Idem + promesse non rejected                                         |
| 100 native TypeError crashes              | < 15 MB                | Idem + cause chain pas attrappée                                     |
| 500 mixed (index + context + session)     | < 20 MB                | Storage session qui accumule                                         |
| 100 WS connections open/close             | < 30 MB                | WS listener non removed sur `close`                                  |
| 50 WS echo round-trips                    | < 20 MB                | Buffer message non libéré                                            |

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

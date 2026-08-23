---
name: nodefony-tail-error-logs
description: >
  Extrait uniquement les erreurs (ERROR / CRITIC / TypeError / SyntaxError / stack traces) des
  derniers logs du serveur Nodefony — supprime les codes ANSI et les requêtes 200 OK. À utiliser dès
  qu'un test d'intégration échoue ou que le serveur a crashé au boot.
  Déclencheurs : "logs du serveur", "erreurs serveur", "voir les crashs", "pourquoi le test échoue",
  "tail logs", "stack trace nodefony".
---

# tail-error-logs

Filtre chirurgical sur `/tmp/nodefony-server.log` pour ne récupérer que les lignes utiles au debug.

## Quand l'utiliser

- Un test d'intégration échoue avec 404 / 500 / ECONNREFUSED
- Le serveur crash au boot (CRITIC / SyntaxError / terminate)
- Suspicion d'erreur silencieuse pendant un run
- Vérification qu'un fix supprime bien un CRITIC connu

## Pourquoi ça économise des tokens

Lire `/tmp/nodefony-server.log` entier sature le contexte (souvent > 2 000 lignes incluant les requêtes 200 OK, l'output Rollup, les debug). Ce skill applique grep + sed pour ne garder que les lignes pertinentes.

## Commandes

### Erreurs récentes (50 dernières lignes filtrées)

```bash
tail -n 200 /tmp/nodefony-server.log \
  | sed 's/\x1b\[[0-9;]*m//g' \
  | grep -E "ERROR|CRITIC|TypeError|SyntaxError|terminate :" \
  | tail -30
```

### Erreurs + 3 lignes de contexte autour (stack traces)

```bash
tail -n 500 /tmp/nodefony-server.log \
  | sed 's/\x1b\[[0-9;]*m//g' \
  | grep -E -A 5 "ERROR|CRITIC|SyntaxError|TypeError"
```

### Toutes les requêtes non-2xx (404, 500, …)

```bash
grep -E "(GET|POST|PUT|DELETE)\s+[345][0-9]{2}\s" /tmp/nodefony-server.log \
  | sed 's/\x1b\[[0-9;]*m//g' \
  | tail -20
```

### CRITIC uniquement (avec stack)

```bash
grep -A 8 "CRITIC" /tmp/nodefony-server.log | sed 's/\x1b\[[0-9;]*m//g' | tail -40
```

### Compter les occurrences d'une erreur connue

```bash
grep -c "Response Already sended" /tmp/nodefony-server.log
```

### Tracer une requête par son ID

```bash
grep "abc12345" /tmp/nodefony-server.log | sed 's/\x1b\[[0-9;]*m//g'
```

## Heuristique de diagnostic

| Pattern dans le log                               | Cause probable                        | Fix                                                            |
| ------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------- |
| `SyntaxError: does not provide an export named X` | dist d'un module périmé               | `cd src/packages/@nodefony/<m> && npm run build` + restart     |
| `CRITIC KERNEL ... terminate : 0` au boot         | crash early : voir lignes précédentes | Lire le stack trace                                            |
| `404` répétés sur des routes valides              | dist du module test périmé            | Rebuild + restart (skill `nodefony-start-server`)              |
| `ECONNREFUSED`                                    | serveur mort                          | Relancer via skill `nodefony-start-server`                     |
| `EADDRINUSE 5151/5152`                            | autre process sur les ports           | `nodefony stop` (jamais un `kill -9` par port — cf ci-dessous) |

> 🔴 **Ne JAMAIS libérer un port par `lsof -ti:PORT | xargs kill -9`.** Sans le filtre
> `-sTCP:LISTEN`, `lsof` rend AUSSI les **clients** connectés à ce port — le navigateur
> ouvert sur Studio, l'agent qui sonde l'application, et jusqu'au process qui lance la
> commande (un banc s'est déjà SIGKILLé son propre lanceur ainsi, sans laisser la moindre
> trace : un process tué en -9 n'écrit rien). `nodefony stop` fait le travail correctement,
> scopé au projet courant, et refuse de toucher au runtime d'une autre application.

## Quand NE PAS utiliser

- Pour analyser les **logs structurés JSON** d'un client → utiliser `jq`
- Pour les **logs des tests** (vitest) → lire l'output du runner directement, pas le log serveur
- Pour les logs **prod** (foreground/Docker → stdout/stderr ; PM2 RETIRÉ du framework — C6, 2026-05-29) → variantes différentes, adapter le chemin/source

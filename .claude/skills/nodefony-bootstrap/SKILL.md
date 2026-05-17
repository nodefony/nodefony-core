---
name: nodefony-bootstrap
description: >
  Prépare le contexte de session Nodefony en 1 commande — récap module ciblé prêt à coder.
  Lit la phase active dans MIGRATION_STATUS.md, charge le CLAUDE.md + MEMORY.md du module,
  vérifie la fraîcheur du dist, liste les fichiers source. Évite de relire 5 fichiers manuellement
  en début de session. Déclencheurs : "bootstrap nodefony", "bootstrap http", "prépare le contexte",
  "session sur <module>", "je vais bosser sur <module>", "ready to code", "ouvrir session module".
  Argument optionnel : nom du module (`http`, `framework`, `security`, `core`, `test`...).
---

# nodefony-bootstrap

Prépare un contexte de session Nodefony prêt à coder en 1 invocation.

## Usage

```
/nodefony-bootstrap                    # vue globale (état des modules + phase active)
/nodefony-bootstrap http               # ciblé module @nodefony/http
/nodefony-bootstrap framework          # ciblé @nodefony/framework
/nodefony-bootstrap core               # ciblé src/nodefony (workspace @nodefony/core)
/nodefony-bootstrap test               # ciblé src/modules/test
```

## Modules connus

| Argument          | Chemin                                       |
| ----------------- | -------------------------------------------- |
| `core`            | `src/nodefony`                               |
| `http`            | `src/packages/@nodefony/http`                |
| `framework`       | `src/packages/@nodefony/framework`           |
| `security`        | `src/packages/@nodefony/security`            |
| `llm`             | `src/packages/@nodefony/llm`                 |
| `agent`           | `src/packages/@nodefony/agent`               |
| `rag`             | `src/packages/@nodefony/rag`                 |
| `vector`          | `src/packages/@nodefony/vector`              |
| `memory`          | `src/packages/@nodefony/memory`              |
| `mcp`             | `src/packages/@nodefony/mcp`                 |
| `agent-guard`     | `src/packages/@nodefony/agent-guard`         |
| `studio`          | `src/packages/@nodefony/studio`              |
| `sequelize`       | `src/packages/@nodefony/sequelize`           |
| `mongoose`        | `src/packages/@nodefony/mongoose`            |
| `redis`           | `src/packages/@nodefony/redis`               |
| `test`            | `src/modules/test`                           |

## Étapes — mode global (sans argument)

```bash
# 1. État stratégique en tête de MIGRATION_STATUS
head -60 MIGRATION_STATUS.md

# 2. Phase active (ligne `🎯` la plus récente)
grep -n "🎯\|## P[0-9]" MIGRATION_STATUS.md | head -20

# 3. Modules disponibles
ls src/packages/@nodefony/ src/modules/
```

Sortie attendue : une vue de 30-40 lignes avec phase active + modules.

## Étapes — mode module (avec argument `<module>`)

### 1. Résoudre le chemin

| Argument                              | Chemin                                           |
| ------------------------------------- | ------------------------------------------------ |
| `core`                                | `src/nodefony`                                   |
| `test`                                | `src/modules/test`                               |
| autre                                 | `src/packages/@nodefony/<module>`                |

Stocker dans `$MODULE_PATH`. Si le dossier n'existe pas → erreur explicite.

### 2. Lire la doc IA du module (parallel)

```bash
# CLAUDE.md du module (instructions, interdits, décisions figées)
test -f "$MODULE_PATH/CLAUDE.md" && cat "$MODULE_PATH/CLAUDE.md" || echo "Pas de CLAUDE.md"

# MEMORY.md du module (gotchas, mots-clés, internals)
test -f "$MODULE_PATH/MEMORY.md" && cat "$MODULE_PATH/MEMORY.md" || echo "Pas de MEMORY.md"
```

### 3. Phase active dans MIGRATION_STATUS

```bash
# Extraire les lignes mentionnant le module
grep -n -A 2 -B 1 "@nodefony/<module>\|src/modules/<module>" MIGRATION_STATUS.md | head -40
```

### 4. Fraîcheur du dist

```bash
# Compare mtime dist vs sources récentes
DIST="$MODULE_PATH/dist/index.js"
if test -f "$DIST"; then
  DIST_MTIME=$(stat -f %m "$DIST" 2>/dev/null || stat -c %Y "$DIST")
  SRC_MTIME=$(find "$MODULE_PATH" -name "*.ts" -not -path "*/dist/*" -not -path "*/node_modules/*" -exec stat -f %m {} \; 2>/dev/null | sort -n | tail -1)
  if [ -n "$SRC_MTIME" ] && [ "$SRC_MTIME" -gt "$DIST_MTIME" ]; then
    echo "⚠️ dist PÉRIMÉ — rebuild requis (npm run clean && npm run build)"
  else
    echo "✅ dist à jour"
  fi
else
  echo "⚠️ dist absent — premier build requis"
fi

# Exports publics actuels du dist
grep -E "^export\s*\{" "$DIST" 2>/dev/null | head -3
```

### 5. Sommaire des fichiers source

```bash
# Top 20 fichiers TS du module (hors dist, node_modules, tests)
find "$MODULE_PATH" -name "*.ts" \
  -not -path "*/dist/*" \
  -not -path "*/node_modules/*" \
  -not -path "*/tests/*" \
  | sort | head -20

# Compter fichiers TS total + tests
echo "TS sources: $(find "$MODULE_PATH" -name "*.ts" -not -path "*/dist/*" -not -path "*/node_modules/*" -not -path "*/tests/*" | wc -l)"
# Tests : selon module, soit `tests/`, soit `nodefony/tests/` — chercher les deux
echo "Tests: $(find "$MODULE_PATH" -path "*/tests/*" -name "*.test.ts" -not -path "*/node_modules/*" -not -path "*/dist/*" 2>/dev/null | wc -l)"
```

### 6. Symboles exportés (via `.ai/symbols.json` si disponible)

```bash
# Symboles publics du module via jq O(1)
jq --arg m "@nodefony/<module>" '.symbols | to_entries
  | map(select(.value.module == $m and .value.exported))
  | map(.key) | sort | .[]' .ai/symbols.json 2>/dev/null | head -20
```

### 7. Sortie finale (récap synthétique)

Présenter à l'utilisateur **dans cet ordre** :

1. **Phase active** : phase qui couvre le module (ex : "P2.7 — W3C traceparent")
2. **État dist** : ✅/⚠️
3. **Symboles exportés clés** : 5-10 noms (Container, Service, ...)
4. **Top gotchas MEMORY.md** : 3-5 bullets critiques
5. **Tests dernière mesure connue** (si trouvé dans CLAUDE.md du module ou MIGRATION_STATUS)
6. **Question à l'utilisateur** : "Sur quoi on bosse ?"

Format de sortie cible : **40 lignes max**. Si dépasse → résumer plus dur.

## Pattern d'usage

- En **début de session** : `/nodefony-bootstrap <module>` → contexte chargé sans devoir lire 5 fichiers à la main.
- Après un **`git pull`** : `/nodefony-bootstrap` (mode global) pour voir si la phase active a bougé.
- Avant de **changer de module** : `/nodefony-bootstrap <nouveau-module>` (et libérer mentalement le contexte précédent).

## Anti-patterns à éviter

- Lancer les tests (long, bruyant) — pas dans le bootstrap. Le user lance les tests sciemment via `check-memory-health` ou commande directe.
- Charger plus de 200 lignes par section — préférer `head` et résumer.
- Ignorer le message "dist périmé" — c'est la première cause d'échec de session.

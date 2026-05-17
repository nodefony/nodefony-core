---
name: session-retro
description: >
  Retour d'expérience automatisé sur la session Claude Code en cours — analyse le transcript JSONL,
  compte les tool_use, identifie les fichiers les + lus, les commandes Bash récurrentes, et propose
  des skills ou optimisations pour la session suivante. À lancer en FIN de session, avant `/compact`
  ou commit final. Déclencheurs : "retour d'expérience", "session retro", "où sont passés les tokens",
  "audit session", "qu'est-ce qui a coûté cher", "propose des skills".
  Argument optionnel : `--save` pour persister le récap dans `docs/session-retros/YYYY-MM-DD.md`.
---

# session-retro

Audit post-session : compter les tool_use, identifier les coûteux, proposer des skills.

## Quand l'utiliser

- **Fin de session** : avant `/compact` ou commit final → comprendre où la session a brûlé des tokens.
- **Après un dépassement de quota** : analyser une session récente pour ne pas refaire la même erreur.
- **Régulièrement** : 1× par semaine pour détecter les patterns qui méritent un nouveau skill.

## Étapes à exécuter

### 1. Localiser le transcript de la session en cours

```bash
TRANSCRIPT_DIR="/Users/cci/.claude/projects/-Users-cci-repository-nodefony-core"
LATEST=$(ls -t "$TRANSCRIPT_DIR"/*.jsonl 2>/dev/null | head -1)
echo "Session : $(basename "$LATEST" .jsonl)"
echo "Lignes  : $(wc -l < "$LATEST")"
echo "Taille  : $(du -h "$LATEST" | cut -f1)"
```

### 2. Comptage tool_use par outil (vue d'ensemble)

```bash
jq -r 'select(.type == "assistant") | .message.content[]? | select(.type == "tool_use") | .name' "$LATEST" \
  | sort | uniq -c | sort -rn
```

Sortie attendue : ranking des outils utilisés (Bash, Read, Edit, Write, Agent, etc.).

### 3. Top 10 fichiers lus (Read.file_path)

```bash
jq -r 'select(.type == "assistant") | .message.content[]?
  | select(.type == "tool_use" and .name == "Read") | .input.file_path' "$LATEST" \
  | sort | uniq -c | sort -rn | head -10
```

> Un fichier lu 3+ fois = candidat soit pour `cat` au début, soit pour une mémorisation MEMORY.md.

### 4. Top 10 commandes Bash (résumé descriptif)

```bash
jq -r 'select(.type == "assistant") | .message.content[]?
  | select(.type == "tool_use" and .name == "Bash") | .input.description' "$LATEST" \
  | sort | uniq -c | sort -rn | head -10
```

### 5. Commandes Bash répétées (candidats skills)

```bash
# Commandes exactes répétées 3+ fois → candidate pour un skill
jq -r 'select(.type == "assistant") | .message.content[]?
  | select(.type == "tool_use" and .name == "Bash") | .input.command' "$LATEST" \
  | sort | uniq -c | awk '$1 >= 3' | sort -rn | head -10
```

### 6. Volume de sortie tool (estimation cache cost)

```bash
# Caractères totaux des tool_result (proxy pour tokens output)
jq -r 'select(.type == "user") | .message.content[]?
  | select(.type == "tool_result") | (.content | tostring | length)' "$LATEST" \
  | awk 'BEGIN {s=0; n=0} {s+=$1; n+=1} END {printf "Tool results : %d events, %d chars total, avg %d chars/event\n", n, s, (n>0 ? s/n : 0)}'
```

### 7. Files Write/Edit (output volume)

```bash
# Fichiers modifiés cette session
jq -r 'select(.type == "assistant") | .message.content[]?
  | select(.type == "tool_use" and (.name == "Write" or .name == "Edit")) | .input.file_path' "$LATEST" \
  | sort | uniq -c | sort -rn
```

### 8. Détection de patterns "candidat skill"

Heuristiques pour proposer un skill (sortir des recommandations explicites) :

- **Même commande Bash répétée 3+ fois** → skill avec wrapper.
- **Même fichier lu 5+ fois** → soit cacher dans MEMORY.md soit faire un skill view-X.
- **Séquence répétée** (build → test → grep error → fix) → skill orchestrateur.
- **Beaucoup de `find` ou `grep` ouverts** → utiliser `.ai/symbols.json` (skill `generate-symbols` doit produire un résultat utilisable).
- **Volume Read élevé sur fichiers de doc externe** → skill load-on-demand.

## Format de sortie final

Sortir au user (et écrire dans `docs/session-retros/<date>-<session-id-short>.md` si `--save`) :

```markdown
# Session retro — <date> — <session-short-id>

## Tool usage
- 47 Bash | 23 Read | 8 Edit | 2 Write | 1 Agent

## Top 5 fichiers lus
| Fichier                                  | Occurrences |
| ---------------------------------------- | ----------- |
| ...                                      | ...         |

## Top 5 commandes Bash
| Description                              | Occurrences |
| ---------------------------------------- | ----------- |
| ...                                      | ...         |

## Volume estimé
- Tool results : X events, Y chars, moy Z chars/event

## Recommandations
1. <skill suggéré> — raison
2. <pattern à éviter> — raison
3. <mémorisation MEMORY.md proposée> — raison

## Patterns à creuser
- ...
```

Garder le rapport sous 60 lignes.

### Optionnel : sauvegarder le retro

Si `--save` passé :

```bash
mkdir -p docs/session-retros
DATE=$(date +%Y-%m-%d)
SHORT_ID=$(basename "$LATEST" .jsonl | cut -c1-8)
OUT="docs/session-retros/$DATE-$SHORT_ID.md"
# Écrire le markdown ci-dessus dans $OUT via tool Write (jamais via echo/cat)
```

## Anti-patterns à éviter

- **Lire tout le transcript** dans Claude — il fait facilement plusieurs MB. Toujours via `jq` pour filtrer.
- **Proposer un skill à la légère** — n'inventer que si le pattern apparaît 3+ fois sur la session.
- **Mesurer les tokens exacts** — impossible côté local sans tokenizer Anthropic. Utiliser les **caractères** comme proxy.
- **Persister par défaut** — n'écrire le fichier que si `--save` (sinon spam).

---
name: retex
description: >
  Retour d'expérience (RETEX) de la session Claude Code en cours — analyse le transcript JSONL,
  compte les tool_use, identifie les fichiers les + lus, les commandes Bash récurrentes, et propose
  des skills / mémoires / optimisations. Sauvegarde TOUJOURS le retex dans docs/session-retros/.
  But réel : alimenter l'amélioration continue de la qualité de travail de l'IA sur Nodefony.
  À lancer en FIN de session, avant `/compact` ou commit final.
  Déclencheurs : "retex", "retour d'expérience", "fais le retex", "session retro", "où sont passés
  les tokens", "audit session", "qu'est-ce qui a coûté cher", "propose des skills".
  Mode consolidation : "consolide les retex", "plan d'amélioration IA" → analyse les 10-20 derniers
  retex et produit un plan d'action.
---

# retex

RETEX = RETour d'EXpérience. Audit post-session : compter les tool_use, identifier les coûteux,
proposer des skills/mémoires. **Toujours sauvegardé** dans `docs/session-retros/`.

## 🎯 But réel (lire en premier)

Les retex ne sont PAS de simples logs de tokens. Leur finalité est **l'amélioration continue de la
qualité de travail de l'IA sur Nodefony** :

1. Chaque session produit 1 retex (auto-save) → trace les coûts, pièges, patterns.
2. Tous les **10 à 20 retex**, lancer le **mode consolidation** (`consolide les retex`) → petite
   session dédiée qui extrait les patterns récurrents et produit un **plan d'action** (nouveaux
   skills, MAJ CLAUDE.md, nouvelles mémoires, conventions).
3. Objectif final : que l'IA apprenne à **développer sur Nodefony parfaitement** avec tout le
   contexte nécessaire, et à terme **s'auto-développe** sur les fonctionnalités demandées.

> Cf mémoire IA `feedback_session_retros_purpose`.

## Quand l'utiliser

- **Fin de chaque session** : avant `/compact` ou commit final → produire + sauver le retex.
- **Après un dépassement de quota** : analyser la session pour ne pas refaire la même erreur.
- **Tous les 10-20 retex** : mode consolidation → plan d'amélioration IA.

---

## MODE 1 — Retex de session (défaut)

### 1. Localiser le transcript de la session en cours

```bash
TRANSCRIPT_DIR="/Users/cci/.claude/projects/-Users-cci-repository-nodefony-core"
LATEST=$(ls -t "$TRANSCRIPT_DIR"/*.jsonl 2>/dev/null | head -1)
echo "Session : $(basename "$LATEST" .jsonl)"
echo "Lignes  : $(wc -l < "$LATEST")"
echo "Taille  : $(du -h "$LATEST" | cut -f1)"
```

### 2. Comptage tool_use par outil

```bash
jq -r 'select(.type == "assistant") | .message.content[]? | select(.type == "tool_use") | .name' "$LATEST" \
  | sort | uniq -c | sort -rn
```

### 3. Top 10 fichiers lus (Read.file_path)

```bash
jq -r 'select(.type == "assistant") | .message.content[]?
  | select(.type == "tool_use" and .name == "Read") | .input.file_path' "$LATEST" \
  | sort | uniq -c | sort -rn | head -10
```

> Un fichier lu 3+ fois = candidat soit pour lecture unique au début, soit pour une mémorisation MEMORY.md.

### 4. Top 10 commandes Bash (résumé descriptif)

```bash
jq -r 'select(.type == "assistant") | .message.content[]?
  | select(.type == "tool_use" and .name == "Bash") | .input.description' "$LATEST" \
  | sort | uniq -c | sort -rn | head -10
```

### 5. Commandes Bash répétées (candidats skills)

```bash
jq -r 'select(.type == "assistant") | .message.content[]?
  | select(.type == "tool_use" and .name == "Bash") | .input.command' "$LATEST" \
  | sort | uniq -c | awk '$1 >= 3' | sort -rn | head -10
```

### 6. Volume de sortie tool (proxy cache cost)

```bash
jq -r 'select(.type == "user") | .message.content[]?
  | select(.type == "tool_result") | (.content | tostring | length)' "$LATEST" \
  | awk 'BEGIN {s=0; n=0} {s+=$1; n+=1} END {printf "Tool results : %d events, %d chars total, avg %d chars/event\n", n, s, (n>0 ? s/n : 0)}'
```

### 7. Files Write/Edit (output volume)

```bash
jq -r 'select(.type == "assistant") | .message.content[]?
  | select(.type == "tool_use" and (.name == "Write" or .name == "Edit")) | .input.file_path' "$LATEST" \
  | sort | uniq -c | sort -rn
```

### 8. Détection de patterns "candidat skill / mémoire"

- **Même commande Bash répétée 3+ fois** → skill avec wrapper.
- **Même fichier lu 5+ fois** → cacher dans MEMORY.md OU skill view-X.
- **Séquence répétée** (build → test → grep error → fix) → skill orchestrateur.
- **Beaucoup de `find`/`grep`** → utiliser `.ai/symbols.json` (skill `generate-symbols`).
- **Friction récurrente** (permissions, validations, pièges) → MAJ CLAUDE.md / settings.
- **Décision archi prise** → vérifier qu'elle est en mémoire IA (sinon perte au prochain /clear).

### 9. Sauvegarde OBLIGATOIRE (auto-save)

Contrairement à l'ancienne version (`--save` optionnel), le retex est **toujours sauvegardé** —
c'est le matériau brut de la consolidation périodique.

```bash
mkdir -p docs/session-retros
DATE=$(date +%Y-%m-%d)
SHORT_ID=$(basename "$LATEST" .jsonl | cut -c1-8)
OUT="docs/session-retros/$DATE-$SHORT_ID.md"
echo "Écriture du retex dans : $OUT"
# Écrire le markdown (format ci-dessous) dans $OUT via tool Write (jamais via echo/cat)
```

### Format du fichier retex

```markdown
---
date: YYYY-MM-DD
session_id: <full-session-id>
focus: <1 ligne — sujet principal de la session>
---

# Session retro — <date> — <session-short-id>

## Tool usage
| Outil | Calls |
| ----- | ----: |
| ...   | ...   |

## Top fichiers Read/Edit
| Fichier | × |
| ------- | -: |
| ...     | ... |

## Coûts évidents
- <ce qui a brûlé des tokens / du temps — restarts serveur, re-lectures, etc.>

## Recommandations
1. <skill suggéré> — raison
2. <pattern à éviter> — raison
3. <mémorisation MEMORY.md proposée> — raison

## Patterns récurrents (déjà gérés)
- ✅ <pattern déjà en mémoire/skill>

## Commits produits
| Commit | Sujet |
| ------ | ----- |
| ...    | ...   |
```

Garder le retex sous ~80 lignes. C'est un résumé, pas un transcript.

---

## MODE 2 — Consolidation (tous les 10-20 retex)

Déclencheurs : "consolide les retex", "plan d'amélioration IA".

### 1. Compter les retex accumulés

```bash
COUNT=$(ls docs/session-retros/*.md 2>/dev/null | wc -l | tr -d ' ')
echo "Retex accumulés : $COUNT"
[ "$COUNT" -lt 10 ] && echo "⚠️ < 10 retex — consolidation prématurée, attendre."
```

### 2. Lire les retex (sections clés uniquement)

```bash
# Extraire les sections "Recommandations" + "Coûts évidents" de tous les retex
for f in docs/session-retros/*.md; do
  echo "=== $f ==="
  awk '/^## (Recommandations|Coûts évidents|Patterns récurrents)/{p=1} /^## (Commits|Tool usage|Top)/{p=0} p' "$f"
done
```

### 3. Extraire les patterns récurrents

Identifier ce qui revient dans ≥ 3 retex :
- Coûts répétés (ex: restarts serveur, re-lectures de doc, friction permissions)
- Recommandations jamais appliquées (skill suggéré 3× mais jamais créé)
- Pièges récurrents (dist périmé, watch Rollup, ALS, etc.)

### 4. Produire un PLAN D'ACTION

Format de sortie (présenter au user + sauver dans `docs/session-retros/CONSOLIDATION-<date>.md`) :

```markdown
# Consolidation retex — <date> — retex #<N1> à #<N2>

## Patterns récurrents détectés
| Pattern | Occurrences | Impact |
| ------- | ----------- | ------ |
| ...     | ...         | ...    |

## Plan d'action (amélioration qualité IA)
1. **<action>** (ex: créer skill X) — résout <pattern>, gain estimé
2. **<MAJ CLAUDE.md>** — ajoute règle Y vue N fois
3. **<nouvelle mémoire IA>** — capture décision Z

## À supprimer / archiver
- Retex consolidés → optionnel : archiver dans docs/session-retros/archive/
```

### 5. Exécuter le plan (avec accord user)

Pour chaque action du plan : créer le skill / éditer CLAUDE.md / écrire la mémoire. **Demander
l'accord user avant d'appliquer des changements structurants** (nouveaux skills, MAJ CLAUDE.md).

---

## Anti-patterns à éviter

- **Lire tout le transcript** dans Claude — il fait plusieurs MB. Toujours via `jq` pour filtrer.
- **Proposer un skill à la légère** — n'inventer que si le pattern apparaît 3+ fois.
- **Mesurer les tokens exacts** — impossible côté local. Utiliser les **caractères** comme proxy.
- **Oublier de sauver** — le retex DOIT être écrit (matériau de la consolidation). Pas optionnel.
- **Consolider trop tôt** — attendre 10-20 retex pour avoir des patterns statistiquement valables.

## Liens

- Mémoire IA : `feedback_session_retros_purpose` (but des retex)
- Mémoire IA : `feedback_token_economy` (économie tokens)
- Sortie : `docs/session-retros/` (versionné dans le repo)

# Boîte à outils CONSOLIDATE — minage du transcript

> Chargé à la demande par le skill `nodefony-session`. **N'est PAS déroulé au END courant** : ces
> analyses (comptage tool_use, top fichiers, coût €, balayage allowlist, détection de candidats
> skill) sont coûteuses et utiles ~1×/10-20 retex. Le END léger fait 5 étapes seulement (cf le corps
> du skill) ; ce fichier sert au mode CONSOLIDATE et à un END approfondi ponctuel.
>
> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; historique = `git log`.

## Quand

- **Fin de chaque session** : avant `/compact` ou commit final → produire + sauver.
- **Après dépassement de quota** : analyser pour ne pas refaire l'erreur.

## 1. Transcript de la session courante

```bash
TRANSCRIPT_DIR="/Users/cci/.claude/projects/-Users-cci-repository-nodefony-core"
LATEST=$(ls -t "$TRANSCRIPT_DIR"/*.jsonl 2>/dev/null | head -1)
echo "Session : $(basename "$LATEST" .jsonl)"; echo "Lignes : $(wc -l < "$LATEST")"; echo "Taille : $(du -h "$LATEST" | cut -f1)"
```

## 2. Comptage tool_use

```bash
jq -r 'select(.type=="assistant")|.message.content[]?|select(.type=="tool_use")|.name' "$LATEST" | sort | uniq -c | sort -rn
```

## 3. Top 10 fichiers lus

```bash
jq -r 'select(.type=="assistant")|.message.content[]?|select(.type=="tool_use" and .name=="Read")|.input.file_path' "$LATEST" | sort | uniq -c | sort -rn | head -10
```

> Fichier lu 3+ fois = candidat lecture-unique-au-début ou mémorisation MEMORY.md.

## 4. Top 10 commandes Bash (descriptions)

```bash
jq -r 'select(.type=="assistant")|.message.content[]?|select(.type=="tool_use" and .name=="Bash")|.input.description' "$LATEST" | sort | uniq -c | sort -rn | head -10
```

## 5. Commandes Bash répétées (candidats skills)

```bash
jq -r 'select(.type=="assistant")|.message.content[]?|select(.type=="tool_use" and .name=="Bash")|.input.command' "$LATEST" | sort | uniq -c | awk '$1>=3' | sort -rn | head -10
```

## 6. Volume sortie tool (proxy coût cache)

```bash
jq -r 'select(.type=="user")|.message.content[]?|select(.type=="tool_result")|(.content|tostring|length)' "$LATEST" | awk 'BEGIN{s=0;n=0}{s+=$1;n+=1}END{printf "Tool results : %d events, %d chars, avg %d\n",n,s,(n>0?s/n:0)}'
```

## 6b. 💶 Coût RÉEL de la session (€) — tokens du transcript

> Le transcript embarque l'`usage` Anthropic par tour (`input/output/cache_creation/cache_read`)
> → coût RÉEL, plus besoin du proxy « caractères ». **Piège** : les lignes `usage` sont
> **dupliquées par le streaming** → **dédoublonner par `message.id`** (sinon coût ×2-3).

```bash
# Prix Claude Opus 4.x (USD / M tokens) : input 15 · output 75 · cache write 5m 18.75 ·
# cache write 1h 30 · cache read 1.50. Taux EUR ajustable (mettre le taux du jour).
USD_EUR=0.92
jq -s --argjson r "$USD_EUR" '
  [ .[] | select(.type=="assistant" and .message.id and .message.usage) ]
  | group_by(.message.id) | map(.[0].message.usage)         # 1 usage par message.id (dédup streaming)
  | { input:(map(.input_tokens//0)|add), output:(map(.output_tokens//0)|add),
      cw5m:(map(.cache_creation.ephemeral_5m_input_tokens//0)|add),
      cw1h:(map(.cache_creation.ephemeral_1h_input_tokens//0)|add),
      cr:(map(.cache_read_input_tokens//0)|add), turns:length }
  | . + { usd: ((.input*15 + .output*75 + .cw5m*18.75 + .cw1h*30 + .cr*1.5)/1e6) }
  | . + { eur: (.usd*$r) }
' "$LATEST"
```

### La vue d'ensemble — TOUS les transcripts du projet

Le `jq` ci-dessus chiffre UNE session. Pour la dépense cumulée — quel modèle a coûté quoi, quelle
part part en cache, quelles sessions pèsent — le script du skill agrège tous les transcripts et
porte sa propre table de prix par modèle :

```bash
node .claude/skills/nodefony-session/scripts/session-cost.mjs
```

Il **dédoublonne par `messageId`** (les journaux répètent la même réponse à plusieurs lignes) et lit
les transcripts sous `~/.claude/projects` — donc hors dépôt, et propre à ce poste : c'est aussi
pourquoi il vit dans le skill et non dans l'outillage du produit.

⚠️ La table de prix d'un script comme celle du `jq` ci-dessus se **périme** — un tarif se revérifie
à la source avant d'être publié dans un retex, jamais recopié de mémoire.

Lire le résultat :

- **Décomposer le coût** input / output / cache-write / cache-read. Insight quasi systématique sur
  une session longue : le **cache (write 1h + read) domine** (souvent 70-85 %) — c'est le CONTEXTE
  chargé (CLAUDE.md + MEMORY.md + skills + gros fichiers relus) qui coûte, **pas** ce que je produis
  (output). → levier d'économie #1 = **contexte plus mince** (`/clear` entre features, MEMORY.md court,
  skills load-on-demand), pas « écrire moins ».
- **Coût / livrable** : diviser `eur` par le nb de commits/features → est-ce que la session a été
  rentable ? Une session « réflexion » sans livrable mais à fort cache = signal de découper.
- Le coût va dans le retex (ligne « 💶 Coût ») ET dans la synthèse intéressante (§8c).

## 8c. ✨ Résumé « le plus intéressant possible » (à présenter au user)

Au-delà des tableaux de stats, clore par un **récit court et dense** (le user l'a demandé) :

1. **Ce qui a été accompli** (1-3 puces : livrables + commits, ou « réflexion → décision »).
2. **LA décision / le POURQUOI** le plus structurant de la session (ce qui survivra au `/clear`).
3. **💶 Coût € + sa lecture** : montant, décomposition, et l'enseignement (où est passé l'argent ;
   cache-dominé ? output ? une re-lecture chère ?).
4. **Efficacité** : 1 fait marquant — 0 restart (HMR), gate verte du 1ᵉʳ coup, OU au contraire un coût
   évitable (N restarts, fichier relu 5×, contexte gonflé).
5. **➡️ La prochaine action** (alignée avec la mémoire de reprise — §10 du SKILL.md).

> But : que le user reparte avec une **photo mémorable** (valeur produite ↔ coût payé), pas un log.

## 7. Write/Edit (volume produit)

```bash
jq -r 'select(.type=="assistant")|.message.content[]?|select(.type=="tool_use" and (.name=="Write" or .name=="Edit"))|.input.file_path' "$LATEST" | sort | uniq -c | sort -rn
```

## 8. Détection candidats skill / mémoire

- Même commande Bash 3+ fois → skill wrapper.
- Même fichier lu 5+ fois → MEMORY.md du module, ou une requête indexée.
- Séquence répétée (build→test→grep error→fix) → skill orchestrateur.
- Beaucoup de `find`/`grep` → `.ai/symbols.json` (skill `nodefony-inspect`).
- Friction récurrente (permissions, pièges) → MAJ CLAUDE.md / settings.
- Décision archi prise → vérifier qu'elle est en mémoire IA (sinon perte au `/clear`).

## 8b. Balayage allowlist (OBLIGATOIRE — directive user 2026-05-22)

À CHAQUE retex : ajouter à `.claude/settings.json` les **commandes process non
dangereuses** qui ont prompté cette session et ne sont pas encore couvertes — par
**wildcard sûr**, pas par invocation exacte (cf [[feedback-permission-autonomy]]).

```bash
# Commandes Bash de la session (1er token réel, après cd .../; et VAR=)
jq -r 'select(.type=="assistant")|.message.content[]?|select(.type=="tool_use" and .name=="Bash")|.input.command' "$LATEST" \
 | sed -E 's/^[[:space:]]*//; s#^cd [^;&]*(;|&&)[[:space:]]*##; s/^[A-Za-z_]+=[^ ]+ //' \
 | awk '{print $1}' | grep -E '^[a-z]' | sort | uniq -c | sort -rn | head -30
```

Pour chaque token récurrent (≥3) : couvert par un wildcard de `settings.json` ? Sinon,
**est-il dangereux** ? Dangereux = écrit/supprime/pousse/installe hors scope sûr
(`rm` hors `/tmp`, `mv`/`cp`, `git push`, `sudo`, `npx`/`node`/`bash` **générique** non
borné). → ces derniers **restent en prompt**. Les sûrs (read-only, lookup, runner de test
ciblé, `mkdir`, scripts `.claude/skills/*`, `lsof`, `curl` localhost) → ajouter le wildcard
le plus étroit possible dans `permissions.allow` (dédupliquer, ne rien retirer).

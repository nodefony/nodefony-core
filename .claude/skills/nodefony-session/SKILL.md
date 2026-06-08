---
name: nodefony-session
description: >
  Cycle de vie d'une session Nodefony en un seul skill (modes RESUME / START / END / CONSOLIDATE) :
  reprendre après un /clear, préparer le contexte d'un module, clôturer avec retex + mémoire de
  reprise. Le détail de chaque mode est dans le corps.
  Déclencheurs : "reprends", "on en était où", "dernière session", "prépare le contexte",
  "session sur <module>", "fin de session", "retex", "consolide les retex".
---

# nodefony-session

Skill **lifecycle** : ouverture (`start`) et clôture (`end` / `consolidate`) d'une session.
Bornes symétriques d'une session = un seul skill, routé par mode.

## Routage du mode

| Argument / phrasé                                                                              | Mode            |
| ---------------------------------------------------------------------------------------------- | --------------- |
| `resume`, `reprendre`, "reprends", "on en était où", "dernière session", "c'est quoi la suite" | **RESUME**      |
| _(vide)_, `start`, nom de module (`http`, `framework`…), "prépare le contexte"                 | **START**       |
| `end`, `retex`, "fais le retex", "fin de session", "où sont passés les tokens"                 | **END**         |
| `consolidate`, "consolide les retex", "plan d'amélioration IA"                                 | **CONSOLIDATE** |

> **Après un `/clear`, dis simplement « reprends » → mode RESUME.** Rien à mémoriser.

---

# MODE RESUME — reprendre après un /clear

Le problème résolu : après `/clear` tu ne sais plus quoi taper ni où on en était.
Réponse : dis **« reprends »**. L'index `MEMORY.md` est déjà rechargé dans mon contexte ;
ce mode en extrait **LA prochaine action** et te la présente.

## 1. Dernière session enregistrée + kit éventuel

```bash
MEM="/Users/cci/.claude/projects/-Users-cci-repository-nodefony-core/memory"
echo "--- dernier état de session (tri par date du nom, pas mtime) ---"
ls "$MEM"/project_session_*_state.md 2>/dev/null | sort | tail -1
echo "--- kits 'LIRE EN PREMIER' actifs ---"
grep -rl "LIRE EN PREMIER" "$MEM"/*_kit.md 2>/dev/null
```

Lire le `_state.md` le plus récent (sections **Fait / Décisions / Reste**). S'il y a un kit
« LIRE EN PREMIER », le lire aussi (priorité sur le \_state générique).

**LIRE AUSSI `docs/session-retros/RETEX.md`** (le SAS des leçons récentes par thème) — c'est ce qui
rend les retex utiles : frictions chaudes pas encore graduées en `feedback_*`. Les appliquer
proactivement cette session (ex. « shell instable → 1 cmd à la fois », pièges build/dist après clean).

## 2. Phase active + git + 🚨 GARDE-FOU cohérence `_state` ↔ commits

```bash
grep -n "🎯\|## P[0-9]" MIGRATION_STATUS.md | head -10
echo "Branche : $(git branch --show-current) — non commités : $(git status --short | wc -l | tr -d ' ')"
echo "--- VÉRITÉ TERRAIN : derniers commits (croiser avec _state.Fait) ---"
git log -6 --format="%h %ci %s"
```

> 🚨 **GARDE-FOU OBLIGATOIRE (anti-`_state`-périmé, ajouté 2026-05-25).** Le `_state` est écrit à la
> MAIN par le mode END ; si END a été lancé au MILIEU d'une session qui a continué, le `_state` ment
> (cas réel 2026-05-25 : END à 00:16 « prochaine = P6 », puis cluster codé à 01:07 → jamais reflété ;
> RESUME a pointé P6 au lieu du cluster). **La vérité = les commits, pas le `_state`.**
>
> **Vérifier** : le dernier commit `feat(...)`/`fix(...)` apparaît-il dans la section `## Fait` du
> `_state` ? **NON → `_state` PÉRIMÉ.** Alors : déduire la prochaine étape du **dernier commit
> `feat/fix` + son kit associé** (pas de la « Priorité 1 » du `_state`), SIGNALER l'incohérence au
> user, et proposer de réécrire le `_state`. Ne JAMAIS restituer la « Priorité 1 » d'un `_state` que
> les commits contredisent.

## 3. Mini-état migration (SI la prochaine étape cible une phase P<n>)

Composer avec le skill **`nodefony-migration-audit`, mode `tableau` / variante A uniquement** :
barres ASCII de progression par phase (tri % décroissant) + l'encadré **PROCHAINE ÉTAPE**
(première phase non finie du chemin critique). Compact — **PAS** l'audit interactif code-par-code.

> Audit réel vérifié dans le code : `/migration-audit` ou dire « audit migration ».
> Si la prochaine étape ne touche aucune phase (chore, fix, doc, skill) → **sauter** ce mini-état.

## 4. Restituer (≤ 30 lignes)

1. **Dernière session** : date + focus
2. **Décisions prises** (extraites du `_state.md`)
3. **➡️ Prochaine étape** : la « Priorité 1 » du Reste — **SAUF si le garde-fou §2 a détecté un
   `_state` périmé** : alors la prochaine étape vient du **dernier commit + son kit**, et on dit au
   user que le `_state` était périmé.
4. **Mini-état migration** (barres + encadré, via `nodefony-migration-audit`) — si phase concernée
5. **Branche git** + non commités (alerte si dist périmé probable)
6. **Question** : « On reprend ça, ou autre chose ? »

> Aucun `_state.md` trouvé → fallback : dernier retex `docs/session-retros/` + phase active.
> Si la prochaine étape cible un module précis → enchaîner sur le **mode START** (`start <module>`)
> pour charger son contexte (CLAUDE.md/MEMORY.md, dist, symboles). RESUME compose avec START.

---

# MODE START — ouverture de session

Prépare un contexte de module prêt à coder en 1 invocation. Sortie cible : **≤ 40 lignes**.

## Usage

```
/nodefony-session            # vue globale (phase active + modules)
/nodefony-session http       # ciblé @nodefony/http
/nodefony-session core       # ciblé src/nodefony
/nodefony-session test       # ciblé src/modules/test
```

## 1. Résolution dynamique du chemin (PAS de table hardcodée — elle se périme)

```bash
ARG="$1"   # vide, "core", "test", ou un nom de package @nodefony/<arg>
case "$ARG" in
  ""|global) MODE_GLOBAL=1 ;;
  core)      MODULE_PATH="src/nodefony" ;;
  test)      MODULE_PATH="src/modules/test" ;;
  *)         MODULE_PATH="src/packages/@nodefony/$ARG" ;;
esac
# Validation + liste réelle si inconnu
if [ -z "$MODE_GLOBAL" ] && [ ! -d "$MODULE_PATH" ]; then
  echo "Module '$ARG' introuvable. Disponibles :"
  ls -1 src/packages/@nodefony/ ; ls -1d src/modules/*/
fi
```

## 2. Mode global (sans argument)

```bash
head -60 MIGRATION_STATUS.md                       # état stratégique
grep -n "🎯\|## P[0-9]" MIGRATION_STATUS.md | head -20   # phase active
ls -1 src/packages/@nodefony/ src/modules/         # modules réels (source de vérité)
```

Sortie : vue 30-40 lignes (phase active + modules).

## 3. Mode module — doc IA (parallèle)

```bash
test -f "$MODULE_PATH/CLAUDE.md" && cat "$MODULE_PATH/CLAUDE.md" || echo "Pas de CLAUDE.md"
test -f "$MODULE_PATH/MEMORY.md" && cat "$MODULE_PATH/MEMORY.md" || echo "Pas de MEMORY.md"
```

## 4. Mode module — contexte git (NOUVEAU)

```bash
echo "Branche : $(git branch --show-current)"
echo "Derniers commits du module :"; git log -3 --oneline -- "$MODULE_PATH"
echo "Fichiers non commités du module : $(git status --short -- "$MODULE_PATH" | wc -l | tr -d ' ')"
# détail src si besoin → skill nodefony-quick-diff
```

## 5. Mode module — fraîcheur du dist

```bash
DIST="$MODULE_PATH/dist/index.js"
if test -f "$DIST"; then
  DIST_MTIME=$(stat -f %m "$DIST" 2>/dev/null || stat -c %Y "$DIST")
  SRC_MTIME=$(find "$MODULE_PATH" -name "*.ts" -not -path "*/dist/*" -not -path "*/node_modules/*" -exec stat -f %m {} \; 2>/dev/null | sort -n | tail -1)
  if [ -n "$SRC_MTIME" ] && [ "$SRC_MTIME" -gt "$DIST_MTIME" ]; then
    echo "⚠️ dist PÉRIMÉ — rebuild requis (npm run clean && npm run build)"
  else echo "✅ dist à jour"; fi
else echo "⚠️ dist absent — premier build requis"; fi
grep -E "^export\s*\{" "$DIST" 2>/dev/null | head -3
```

## 6. Mode module — symboles exportés (`.ai/symbols.json`, O(1))

```bash
jq --arg m "@nodefony/$ARG" '.symbols | to_entries
  | map(select(.value.module == $m and .value.exported)) | map(.key) | sort | .[]' \
  .ai/symbols.json 2>/dev/null | head -20
```

## 7. Sortie finale (récap synthétique, ≤ 40 lignes)

1. **Phase active** couvrant le module (ex : "P7.2 — adapter Mongoose orm-core")
2. **État dist** : ✅/⚠️
3. **Git** : branche + N fichiers non commités + dernier commit
4. **Symboles exportés clés** : 5-10 noms
5. **Top gotchas MEMORY.md** : 3-5 bullets critiques
6. **Frictions `RETEX.md` applicables** : 1-3 si pertinentes pour ce module
7. **Question** : "Sur quoi on bosse ?"

## Anti-patterns START

- Lancer les tests (long, bruyant) — hors bootstrap ; le user les lance sciemment (`nodefony-check-memory-health` ou direct).
- Charger > 200 lignes par section — `head` + résumer.
- Ignorer "dist périmé" — 1ʳᵉ cause d'échec de session.

---

# MODE END — clôture de session (RETEX) — ⚡ CHEMIN RAPIDE par défaut

RETEX = RETour d'EXpérience. **But réel** : amélioration continue de l'IA sur Nodefony — PAS un log
de tokens. Cf `feedback_session_retros_purpose`.

## ⚡ END courant = 5 étapes LÉGÈRES (ne PAS faire les stats lourdes)

Le END par défaut doit être **rapide** (reproche user 2026-05-31 : END trop lourd/pénible). Il fait
SEULEMENT :

0. **MAJ `MIGRATION_STATUS.md` SI la session a fait avancer une phase / un chantier** (feature livrée,
   sous-tâche `LB.x`/`Px.y` cochée, statut changé) → mettre à jour la **ligne concernée** (1ʳᵉ cellule
   - journal) avec le hash de commit, **AVANT** le commit repo (`docs(migration)` ou inclus dans le
     commit feature). Si la session est un chore/fix/doc qui ne touche aucune phase → **sauter**. Règle
     gravée dans [[feedback_migration_status_uptodate]] (la garder ICI pour ne pas l'oublier au END).
1. **MAJ `docs/session-retros/RETEX.md`** (le SAS, lu au START/RESUME) : ajouter **3-5 bullets** des
   frictions/leçons du jour, **rangées par thème** (créer le thème s'il manque), format
   `[1× — <date courte>]`. Si une friction y figure déjà → **incrémenter le compteur** `[2× — …]` +
   re-dater. NE PAS redupliquer ce qui est déjà gradué en `feedback_*` (juste pointer si utile).
2. **Retex brut court** `docs/session-retros/<date>-<id>.md` : focus + Fait + frictions + commits.
   **SANS les tableaux de stats** (tool_use/coût € → déplacés en CONSOLIDATE). ~30 lignes.
3. **`_state` de reprise** (§10) + **MAJ pointeur `MEMORY.md`**.
4. **Commit + push mémoire IA** (§11) **+ push du repo projet** (les commits feature + `docs/`).

> **DÉPLACÉ en CONSOLIDATE** (ne PAS l'exécuter au END courant) : comptage tool_use, top fichiers,
> coût €, balayage allowlist, détection candidats skill. Analyses coûteuses utiles 1×/10-20 retex
> seulement. Les sections numérotées 1-8 ci-dessous = **boîte à outils de CONSOLIDATE**, gardées ici
> pour référence (NE PAS les dérouler à chaque clôture).

## Modèle SAS (pourquoi RETEX.md existe)

3 canaux, 1 seul relu à chaque session : `CLAUDE.md`/skills + `MEMORY.md` (✅ relus) vs
`session-retros/<id>.md` bruts (❌ jamais relus seuls → inertes). **`RETEX.md` comble le trou** :
digest par thème, lu au START/RESUME. Cycle de vie d'une leçon : **friction (RETEX.md, sas)** → vue
**≥3×** → **graduée en `feedback_*`** (durable) + **retirée de RETEX.md**. Règle anti-doublon : une
leçon est dans RETEX.md **OU** `feedback_*`, **jamais les deux** (sinon dérive, cf l'anti-pattern
« liste dupliquée » de `nodefony-check-externals`). CONSOLIDATE gère graduation + archivage pour
borner la taille de RETEX.md (~1 écran).

## Boîte à outils CONSOLIDATE (référence — PAS exécutée au END courant)

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
5. **➡️ La prochaine action** (alignée avec la mémoire de reprise §10).

> But : que le user reparte avec une **photo mémorable** (valeur produite ↔ coût payé), pas un log.

## 7. Write/Edit (volume produit)

```bash
jq -r 'select(.type=="assistant")|.message.content[]?|select(.type=="tool_use" and (.name=="Write" or .name=="Edit"))|.input.file_path' "$LATEST" | sort | uniq -c | sort -rn
```

## 8. Détection candidats skill / mémoire

- Même commande Bash 3+ fois → skill wrapper.
- Même fichier lu 5+ fois → MEMORY.md ou skill view-X.
- Séquence répétée (build→test→grep error→fix) → skill orchestrateur.
- Beaucoup de `find`/`grep` → `.ai/symbols.json` (skill `nodefony-generate-symbols`).
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

## 9. Sauvegarde OBLIGATOIRE (auto-save)

```bash
mkdir -p docs/session-retros
DATE=$(date +%Y-%m-%d); SHORT_ID=$(basename "$LATEST" .jsonl | cut -c1-8)
OUT="docs/session-retros/$DATE-$SHORT_ID.md"
echo "Écriture du retex : $OUT"
# Écrire le markdown (format ci-dessous) dans $OUT via tool Write (jamais echo/cat)
```

### Format du fichier retex (≤ 80 lignes)

```markdown
---
date: YYYY-MM-DD
session_id: <full-session-id>
focus: <1 ligne — sujet principal>
---

# Session retro — <date> — <session-short-id>

## Tool usage

| Outil | Calls |
| ----- | ----: |

## Top fichiers Read/Edit

| Fichier |   × |
| ------- | --: |

## Coûts évidents

- <ce qui a brûlé tokens/temps — restarts serveur, re-lectures…>

## 💶 Coût (€)

- Total ~€X (≈ $Y) — <décompo : cache write/read vs output> ; <enseignement, ex. cache-dominé X %>

## Recommandations

1. <skill suggéré> — raison
2. <pattern à éviter> — raison
3. <mémorisation MEMORY.md> — raison

## Patterns récurrents (déjà gérés)

- ✅ <pattern déjà en mémoire/skill>

## Commits produits

| Commit | Sujet |
| ------ | ----- |
```

## 10. Mémoire de reprise (OBLIGATOIRE — c'est ce que lit le mode RESUME)

Le retex ci-dessus = **stats**. Les **décisions + la prochaine étape** vont dans une mémoire IA
dédiée, écrite/MAJ à CHAQUE fin de session — sinon RESUME n'a rien à reprendre au prochain `/clear`.

```bash
MEM="/Users/cci/.claude/projects/-Users-cci-repository-nodefony-core/memory"
DATE=$(date +%Y-%m-%d)
echo "Mémoire de reprise : $MEM/project_session_${DATE}_state.md"
ls "$MEM"/project_session_${DATE}_state.md 2>/dev/null && echo "(existe → MAJ)" || echo "(à créer)"
```

Écrire (via tool Write) le fichier `project_session_<date>_state.md` :

```markdown
---
name: project-session-<date>-state
description: État fin session <date> — <focus 1 ligne + prochaine étape>
metadata:
  node_type: memory
  type: project
  originSessionId: <full-session-id>
---

# Session <date> — <focus>

## Fait

- <livrables + commits (hash + sujet)>

## Décisions

- <choix archi/design pris cette session, avec le POURQUOI> ; liens [[autre-memoire]]

## Reste — prochaine étape

1. **Priorité 1** : <LA chose à faire ensuite> — liens [[kit]] / [[memoire]]
2. <suite éventuelle>
```

Puis **ajouter/MAJ la ligne pointeur** dans `MEMORY.md` (l'index auto-chargé) :
`- [Session <date> — état + reprise](project_session_<date>_state.md) — <hook + prochaine étape>`

## 11. Sauvegarde de la mémoire IA (OBLIGATOIRE — durabilité crash / changement de PC)

La mémoire IA vit dans `~/.claude/projects/-Users-cci-repository-nodefony-core/memory/` — **HORS
du repo nodefony** (non versionnée par le repo projet). Elle est sauvegardée dans un **repo git
PRIVÉ dédié** `ccamensuli/nodefony-ai-memory` (mis en place 2026-05-24). **À CHAQUE fin de session**,
après avoir écrit le retex + l'état de reprise + MAJ `MEMORY.md`, **commit + push** ce repo, sinon
le backup se périme et un crash perd le travail :

```bash
MEM="/Users/cci/.claude/projects/-Users-cci-repository-nodefony-core/memory"
git -C "$MEM" add -A
git -C "$MEM" -c user.name="Christophe CAMENSULI" -c user.email="ccamensuli@gmail.com" \
  commit -q -m "session <date>: <focus court>" && git -C "$MEM" push -q
git -C "$MEM" log --oneline -1
```

> Restauration sur un nouveau PC (même chemin projet) :
> `git clone git@github.com:ccamensuli/nodefony-ai-memory.git ~/.claude/projects/-Users-cci-repository-nodefony-core/memory`.
> Le mode **RESUME** peut faire `git -C "$MEM" pull -q` au début pour récupérer une session faite ailleurs.

---

# MODE CONSOLIDATE — plan d'amélioration IA + maintenance du SAS (tous les 10-20 retex)

Déclencheurs : "consolide les retex", "plan d'amélioration IA".

> **CONSOLIDATE porte les tâches LOURDES déplacées du END** (stats tool_use / coût € / allowlist via
> la « boîte à outils » du mode END §1-8) **+ la maintenance du SAS `RETEX.md`** qui borne sa taille :
>
> 1. **Graduer** : toute friction de `RETEX.md` atteignant **≥3×** → la promouvoir en **mémoire
>    `feedback_*`** (durable, indexée dans `MEMORY.md`) PUIS **la retirer de `RETEX.md`** (règle
>    anti-doublon : jamais dans les deux). Une friction vue 1-2× reste dans le sas.
> 2. **Archiver** : déplacer les retex bruts consolidés vers `docs/session-retros/archive/`, et dans
>    `RETEX.md` remplacer leurs lignes d'index par 1 résumé par thème (pointeur). `RETEX.md` reste ~1 écran.
> 3. **Nettoyer** : retirer de `RETEX.md` les frictions devenues obsolètes (corrigées dans le code/skill).
>
> ⚠️ **57 retex accumulés au 2026-05-31, jamais consolidés** → CONSOLIDATE est LARGEMENT dû. À lancer
> en session dédiée (gros lot : grader les patterns ≥3× récurrents sur 2 mois, archiver, seeder RETEX.md).

## 1. Compter les retex

```bash
COUNT=$(ls docs/session-retros/*.md 2>/dev/null | grep -v CONSOLIDATION | wc -l | tr -d ' ')
echo "Retex accumulés : $COUNT"
[ "$COUNT" -lt 10 ] && echo "⚠️ < 10 retex — consolidation prématurée, attendre."
```

## 2. Lire les sections clés (jq/awk, pas tout le fichier)

```bash
for f in docs/session-retros/*.md; do
  case "$f" in *CONSOLIDATION*) continue ;; esac
  echo "=== $f ==="
  awk '/^## (Recommandations|Coûts évidents|Patterns récurrents)/{p=1} /^## (Commits|Tool usage|Top)/{p=0} p' "$f"
done
```

## 3. Patterns récurrents (≥ 3 retex)

Coûts répétés (restarts serveur, re-lectures, friction permissions), recommandations jamais
appliquées (skill suggéré 3× jamais créé), pièges récurrents (dist périmé, watch Rollup, ALS…).

## 4. Produire le PLAN D'ACTION

Présenter au user + sauver dans `docs/session-retros/CONSOLIDATION-<date>.md` :

```markdown
# Consolidation retex — <date> — retex #<N1> à #<N2>

## Patterns récurrents détectés

| Pattern | Occurrences | Impact |
| ------- | ----------- | ------ |

## Plan d'action (qualité IA)

1. **<action>** (ex: créer skill X) — résout <pattern>, gain estimé
2. **<MAJ CLAUDE.md>** — règle Y vue N fois
3. **<nouvelle mémoire IA>** — capture décision Z

## À archiver

- Retex consolidés → optionnel : docs/session-retros/archive/
```

## 5. Exécuter (avec accord user)

Créer skill / éditer CLAUDE.md / écrire mémoire. **Demander l'accord avant tout changement
structurant** (nouveaux skills, MAJ CLAUDE.md).

---

## Anti-patterns END / CONSOLIDATE

- **Lire tout le transcript** dans Claude (plusieurs MB) — toujours `jq` pour filtrer.
- **Proposer un skill à la légère** — n'inventer que si le pattern ≥ 3 fois.
- **Mesurer les tokens exacts** — impossible en local ; utiliser les **caractères** comme proxy.
- **Oublier de sauver** le retex — c'est le matériau de la consolidation.
- **Consolider trop tôt** — attendre 10-20 retex.

## Liens

- Mémoire : `feedback_session_retros_purpose` (but des retex), `feedback_token_economy` (économie tokens).
- Sortie retex : `docs/session-retros/` (versionné).

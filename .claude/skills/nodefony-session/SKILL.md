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
# détail src si besoin → skill nodefony-inspect (§6 diff propre)
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
   frictions/leçons du jour, **rangées par thème**, format `[1× — <date courte>]`. Si une friction y
   figure déjà → **incrémenter le compteur** `[2× — …]` + re-dater. NE PAS redupliquer ce qui est
   déjà gradué en `feedback_*` (juste pointer si utile).

   > 🔴 **AVANT d'écrire, LISTER les thèmes existants — et verser dessous.**
   > `grep '^## ' docs/session-retros/RETEX.md`
   > **Ouvrir un thème neuf est le dernier recours, pas le geste par défaut.** Mesuré au
   > CONSOLIDATE du 2026-08-24 : **55 thèmes créés en quatre jours**, si bien que quatre familles
   > évidentes (le décor d'un banc, la sonde qui mesure autre chose, le code de sortie, le gabarit
   > vs son rendu) étaient éclatées en 3-4 thèmes de 2-4 frictions — **aucun n'atteignait le seuil
   > de 5**, alors que réunies elles pesaient 19, 12, 9 et 7. Le seuil de graduation ne mord que si
   > la friction rejoint sa FAMILLE ; un titre neuf par session le désamorce en silence.

2. **Retex brut court** `docs/session-retros/<date>-<id>.md` : focus + Fait + frictions + commits.
   **SANS les tableaux de stats** (tool_use/coût € → déplacés en CONSOLIDATE). ~30 lignes.
3. **`_state` de reprise** (§10) + **MAJ pointeur `MEMORY.md`**.
4. **Commit + push mémoire IA** (§11) **+ push du repo projet** (les commits feature + `docs/`).

> **DÉPLACÉ en CONSOLIDATE** (ne PAS l'exécuter au END courant) : comptage tool_use, top fichiers,
> coût €, balayage allowlist, détection candidats skill. Analyses coûteuses utiles 1×/10-20 retex
> seulement → **`references/consolidate-toolkit.md`**, chargé à la demande. Le END courant ne le
> déroule jamais.

## Modèle SAS (pourquoi RETEX.md existe)

3 canaux, 1 seul relu à chaque session : `CLAUDE.md`/skills + `MEMORY.md` (✅ relus) vs
`session-retros/<id>.md` bruts (❌ jamais relus seuls → inertes). **`RETEX.md` comble le trou** :
digest par thème, lu au START/RESUME. Cycle de vie d'une leçon : **friction (RETEX.md, sas)** →
**thème atteignant ~5 frictions distinctes** → **gradué en `feedback_*`** (durable) + **retiré de
RETEX.md**. Règle anti-doublon : une leçon est dans RETEX.md **OU** `feedback_*`, **jamais les deux**
(sinon dérive, cf l'anti-pattern « liste dupliquée » de `nodefony-check-externals`). CONSOLIDATE gère
graduation + archivage pour borner la taille de RETEX.md (~1 écran).

> 🔴 **Le seuil porte sur le THÈME, pas sur le compteur `[N×]` d'un bullet.** L'ancienne règle
> « friction vue ≥3× » n'a **jamais** déclenché : sur 135 frictions accumulées, 121 étaient à `1×`,
> 14 à `2×`, **zéro à `3×`** — chaque session écrit un bullet NEUF plutôt que d'incrémenter, car les
> formulations diffèrent. Un thème à **35 frictions en dix jours** n'a donc jamais été gradué. Le
> `[N×]` ne sert plus qu'à repérer une répétition à l'identique ; il ne déclenche rien.
> (Constat et chiffres : `docs/session-retros/CONSOLIDATION-2026-08-02.md`.)

## Boîte à outils CONSOLIDATE — déportée

> Le minage du transcript (comptage tool_use, top fichiers, coût € réel, volume de sortie, balayage
> allowlist, détection de candidats skill, synthèse « intéressante » à présenter au user) vit dans
> **`references/consolidate-toolkit.md`** — chargé à la demande. **Ne PAS le dérouler au END
> courant** : ces analyses coûtent et ne servent qu'en CONSOLIDATE ou lors d'un END approfondi
> ponctuel. Le reste de ce mode END (§9-§11) est utilisé à CHAQUE clôture et reste ici.

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
> **`references/consolidate-toolkit.md`**) **+ la maintenance du SAS `RETEX.md`** qui borne sa taille :
>
> 1. **Graduer** : tout **THÈME** de `RETEX.md` portant **~5 frictions distinctes** → le promouvoir
>    en **mémoire `feedback_*`** (durable, indexée dans `MEMORY.md`) PUIS **le retirer de
>    `RETEX.md`** (règle anti-doublon : jamais dans les deux), en laissant une ligne de renvoi vers
>    la mémoire pour qu'aucune leçon ne devienne introuvable.
> 2. **Vérifier le RETRAIT des graduations déjà faites** — c'est le pas qu'on saute, et c'est lui qui
>    gonfle le sas : `git -C "$MEM" log --diff-filter=A --since=<dernier CONSOLIDATE> --name-only
--format="" -- 'feedback_*.md'` liste les mémoires créées entre-temps ; chacune doit avoir vidé
>    son thème du SAS.
> 3. **Archiver** : déplacer les retex bruts consolidés vers `docs/session-retros/archive/` (`git mv`,
>    l'historique suit), et snapshoter `RETEX.md` AVANT coupe
>    (`archive/RETEX-snapshot-<date>.md`). `RETEX.md` reste ~1 écran.
> 4. **Nettoyer** : retirer de `RETEX.md` les frictions devenues obsolètes (corrigées dans le code/skill).

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

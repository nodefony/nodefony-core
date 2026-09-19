---
name: nodefony-session
description: >
  Cycle de vie d'une session Nodefony en un seul skill (modes RESUME / START / END / CONSOLIDATE) :
  reprendre après un /clear — avec l'avancement RÉEL lu sur le jalon et les tickets GitHub, pas sur
  un document écrit à la main —, préparer le contexte d'un module, clôturer avec retex, fermeture
  des tickets soldés et mémoire de reprise. Porte aussi l'AUDIT de la carte des phases —
  confronter `MIGRATION_STATUS.md` au code réel, phase par phase, avec le comptage qui ne se
  refait pas à la main. RESUME et START sont dans le corps ; END et CONSOLIDATE dans `references/`.
  Déclencheurs : "reprends", "on en était où", "dernière session", "où en est la publication",
  "quels tickets restent", "prépare le contexte", "session sur <module>", "fin de session",
  "retex", "consolide les retex", "audit migration", "état des lieux migration",
  "où en est la migration", "avancement migration", "vérifier MIGRATION_STATUS",
  "revue phase par phase", "gros point migration", "assainir le dashboard migration".
---

# nodefony-session

Skill **lifecycle** : ouverture (`start`) et clôture (`end` / `consolidate`) d'une session.
Bornes symétriques d'une session = un seul skill, routé par mode.

## Routage du mode

| Argument / phrasé                                                                              | Mode            | Où est le détail                 |
| ---------------------------------------------------------------------------------------------- | --------------- | -------------------------------- |
| `resume`, `reprendre`, "reprends", "on en était où", "dernière session", "c'est quoi la suite" | **RESUME**      | ici                              |
| _(vide)_, `start`, nom de module (`http`, `framework`…), "prépare le contexte"                 | **START**       | ici                              |
| `end`, `retex`, "fais le retex", "fin de session", "où sont passés les tokens"                 | **END**         | `references/mode-end.md`         |
| `consolidate`, "consolide les retex", "plan d'amélioration IA"                                 | **CONSOLIDATE** | `references/mode-consolidate.md` |

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

## 3. Avancement RÉEL — les tickets GitHub (le pilotage a QUITTÉ le plan)

Depuis que la publication est pilotée par des issues, **c'est le jalon qui dit où on en est** — pas
`MIGRATION_STATUS.md`, pas le `_state`, qui sont tous deux écrits à la main et vieillissent entre
deux sessions. Un ticket, lui, a un état que personne n'oublie de changer.

**Commencer par la joignabilité — et l'ÉNONCER si elle manque.** GitHub tombe, un jeton expire, on
travaille hors ligne : conclure « rien n'a avancé » depuis un `gh` muet serait un faux verdict.

```bash
# La VOIE NORMALE passe par l'EMPREINTE, jamais par le client de tableau de bord
# en ligne de commande : il omet des lignes sans le dire (skill `nodefony-ticket`,
# § Pièges vécus). L'empreinte, elle, est produite par GraphQL PAGINÉ.
if gh api rate_limit --jq '.rate.remaining' >/dev/null 2>&1; then
  echo "✅ GitHub joignable — on RAFRAÎCHIT l'empreinte avant de la lire"
  npm run board:snapshot
  echo "--- fermés depuis la dernière session ---"
  gh issue list --state closed --limit 5 --json number,title,closedAt \
    --jq '.[] | "#\(.number) \(.closedAt[0:10]) \(.title)"'
else
  echo "⚠️ GitHub INJOIGNABLE — empreinte du dernier END : le DIRE au user, avec sa date"
fi
# Jalons + le prochain dans l'ordre + le premier jalon détaillé. Les bornes sont
# STRUCTURELLES : un nom de jalon écrit ici se périmerait à la version suivante.
awk '/^## Jalons/{p=1} /^## Jalon /{n++; if(n==2) exit} p' .ai/BOARD.md
```

> **L'empreinte, c'est `.ai/BOARD.md` + `.ai/board.json`** — une projection des tickets
> **générée** par [`scripts/board-snapshot.mjs`](scripts/board-snapshot.mjs) et commitée, sur le
> modèle de `.ai/symbols.json`. **Ce n'est PAS un repli hors ligne : c'est LA voie de lecture**,
> connectée comme déconnectée. La croire dégradée a coûté un faux verdict — le 2026-09-08, la
> reprise a annoncé un ticket de la `beta` alors que neuf tickets `alpha` restaient ouverts, dont
> un placé DEVANT lui : le client en ligne de commande avait rendu 120 items sur 261, et
> l'empreinte, elle, nommait déjà le bon en toutes lettres sous « ➡️ Le prochain dans l'ordre ».
> Le seul écart entre les deux situations est la FRAÎCHEUR : connecté on la régénère avant de la
> lire, déconnecté on lit celle du dernier END **en disant au user de quand elle date** — trois
> jours d'écart, c'est trois jours de travail qu'elle ignore.
> **Elle ne s'édite JAMAIS à la main** — c'est ce qui la rend incapable de diverger de sa source,
> et toute la différence avec un document de pilotage écrit à la main. La règle qui choisit le
> prochain ticket vit à part, dans [`scripts/board-next.mjs`](scripts/board-next.mjs), pour être
> éprouvable sans réseau (`npm run test:pilotage`).

**Puis CONTRÔLER le tableau avant de s'en servir.** Un ordre de travail restitué depuis un tableau
incohérent envoie travailler au mauvais endroit — et l'incohérence ne crie pas : un ticket hors
tableau est simplement absent de la liste qu'on vient de lire.

```bash
npm run ticket:lint    # 0 = le tableau se tient ; 1 = une erreur de pilotage à solder d'abord
```

Les erreurs se soldent **maintenant** (elles coûtent une commande), pas « plus tard » : c'est le
seul moment où GitHub est joint et où l'on regarde le pilotage. Le détail des neuf contrôles vit
dans le skill `nodefony-ticket` (`references/tableau-de-bord.md`) — le charger si un code est à interpréter.

> 🔴 **Lire `.content.title`, JAMAIS `.title`.** Le champ `title` d'un item de tableau de bord est
> une copie dérivée qui reste sur l'ancien libellé : mesuré, **38 items sur 38** portaient un titre
> différent de leur issue. Restituer ce champ, c'est annoncer au user des tickets qu'il a fait
> renommer. L'API GraphQL, elle, rend le titre courant — le tableau de bord affiché est à jour, seul
> ce champ du client en ligne de commande ment.

**Ce qu'on en tire pour la restitution** : le jalon donne le reste-à-faire, l'ordre donne LA
prochaine chose à prendre, et les tickets fermés depuis la veille disent ce que le `_state` n'a
peut-être pas enregistré. **Si l'ordre du tableau de bord et la « Priorité 1 » du `_state` se
contredisent, le ticket gagne** — même raison que le garde-fou du §2 : ce qui est écrit à la main
se périme, ce qui est un état ne se périme pas.

## 4. Mini-état migration (SI la prochaine étape cible une phase P<n>)

Composer avec **[`references/migration-audit.md`](references/migration-audit.md), mode `tableau` /
variante A uniquement** :
barres ASCII de progression par phase (tri % décroissant) + l'encadré **PROCHAINE ÉTAPE**
(première phase non finie du chemin critique). Compact — **PAS** l'audit interactif code-par-code.

> Audit réel vérifié dans le code : dire « audit migration » — la référence porte le protocole,
> dont le comptage `awk` qu'on ne refait pas à la main sans se tromper.
> Si la prochaine étape ne touche aucune phase (chore, fix, doc, skill) → **sauter** ce mini-état.

## 5. Restituer (≤ 30 lignes)

1. **Dernière session** : date + focus
2. **Décisions prises** (extraites du `_state.md`)
3. **➡️ Prochaine étape** : celle que l'empreinte nomme sous « ➡️ Le prochain dans l'ordre » —
   **jamais une déduction personnelle sur une liste de tickets**. 🔴 Elle vient du **JALON
   COURANT** : tant que la version en cours a des tickets ouverts, un ticket d'une version
   ultérieure ne passe pas devant, même mieux classé. Restituer un ticket dont le jalon n'est pas
   celui qui reste à finir est un faux verdict — vécu le 2026-09-08 : `beta` annoncée avec neuf
   tickets `alpha` ouverts. Si le `_state` désigne un autre ticket que l'empreinte, **l'empreinte
   gagne** et on dit au user que le `_state` était périmé (même raison qu'au §2 : ce qui est écrit
   à la main se périme). ⚠️ L'ordre encode les **dépendances**, pas le moment : un ticket petit
   dont le contexte vient d'être chargé se prend **maintenant** — skill `nodefony-ticket`.
4. **Avancement du jalon COURANT en premier** : `N ouverts / M fermés`, échéance, puis les 2-3
   suivants **de ce jalon**. Les jalons ultérieurs se citent en une ligne, jamais comme du travail
   à prendre. Si GitHub n'a pas répondu : « avancement non vérifié, GitHub injoignable », plus la
   DATE de l'empreinte. Ne jamais présenter un avancement déduit du seul `_state`.
5. **Mini-état migration** (barres + encadré, via `references/migration-audit.md`) — si phase concernée
6. **Branche git** + non commités (alerte si dist périmé probable)
7. **Question** : « On reprend ça, ou autre chose ? »

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

# MODES END et CONSOLIDATE — le détail vit en `references/`

Ces deux modes ferment la session ; ils sont plus longs que RESUME et START, et ne servent qu'une
fois chacun. Les garder ici ferait payer leur lecture à **chaque** reprise — c'est exactement ce que
la divulgation progressive existe pour éviter.

| Mode            | Quand                                               | Charger AVANT d'agir                                               |
| --------------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| **END**         | « fin de session », « retex », « fais le retex »    | [`references/mode-end.md`](references/mode-end.md)                 |
| **CONSOLIDATE** | « consolide les retex », « plan d'amélioration IA » | [`references/mode-consolidate.md`](references/mode-consolidate.md) |

**Ce qu'il faut savoir sans ouvrir la référence** — de quoi décider, jamais de quoi exécuter :

- Le **END courant est LÉGER** : sept étapes, et les stats coûteuses (tool_use, coût €, allowlist)
  n'en font PAS partie — elles vivent en CONSOLIDATE. Un END qui traîne est un END mal fait.
- Il **écrit la mémoire de reprise** `project_session_<date>_state.md` : sans elle, le mode RESUME
  du prochain `/clear` n'a rien à reprendre. C'est l'étape qu'on ne saute jamais.
- Il **régénère l'empreinte des tickets** et **pousse la mémoire IA** — le seul moment où GitHub est
  joint et où le tableau vient d'être mis à jour.
- Le **CONSOLIDATE se déclenche tous les 10-20 retex**, pas à chaque clôture : y brancher un
  contrôle rare en ferait un coût récurrent.

> 🔴 **Ne pas exécuter ces modes de mémoire.** Chaque étape porte un piège payé une fois — un ticket
> qu'on ferme sans compte rendu, un seuil de graduation qui ne mord jamais, une empreinte prise sur
> un tableau incohérent. La référence porte ces pièges ; ce tableau ne porte que la route.

## Liens

- Mémoire : `feedback_session_retros_purpose` (but des retex), `feedback_token_economy` (économie tokens).
- Sortie retex : `docs/session-retros/` (versionné).

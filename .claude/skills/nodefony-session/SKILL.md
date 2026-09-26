---
name: nodefony-session
description: >
  Cycle de vie d'une session Nodefony en un seul skill (modes RESUME / START / END) :
  reprendre après un /clear — avec l'avancement RÉEL lu sur le jalon et les tickets GitHub, pas sur
  un document écrit à la main —, préparer le contexte d'un module, clôturer : fermeture des
  tickets soldés, mémoire de reprise, commit. RESUME et START sont dans le corps ; END dans
  `references/`.
  Déclencheurs : "reprends", "on en était où", "dernière session", "où en est la publication",
  "quels tickets restent", "prépare le contexte", "session sur <module>", "fin de session",
  "clôture la session".
---

# nodefony-session

Skill **lifecycle** : ouverture (`start`) et clôture (`end`) d'une session.
Bornes symétriques d'une session = un seul skill, routé par mode.

## Routage du mode

| Argument / phrasé                                                                              | Mode       | Où est le détail         |
| ---------------------------------------------------------------------------------------------- | ---------- | ------------------------ |
| `resume`, `reprendre`, "reprends", "on en était où", "dernière session", "c'est quoi la suite" | **RESUME** | ici                      |
| _(vide)_, `start`, nom de module (`http`, `framework`…), "prépare le contexte"                 | **START**  | ici                      |
| `end`, "fin de session", "clôture la session", "où sont passés les tokens"                     | **END**    | `references/mode-end.md` |

> **Après un `/clear`, dis simplement « reprends » → mode RESUME.** Rien à mémoriser.

---

# MODE RESUME — reprendre après un /clear

Le problème résolu : après `/clear` tu ne sais plus quoi taper ni où on en était.
Réponse : dis **« reprends »**. L'index `MEMORY.md` est déjà rechargé dans mon contexte ;
ce mode en extrait **LA prochaine action** et te la présente.

## 1. Un appel, puis une lecture

```bash
npm run session:resume      # ~30 lignes ; --offline pour ne pas joindre GitHub
```

Puis **`Read` du `_state` qu'il nomme** (et des kits qu'il cite au `## Reste`). C'est tout : le
script fait, dans l'ordre où l'un éclaire l'autre, ce qui coûtait cinq ou six appels — et trois
contrôles que personne ne faisait. Ses règles vivent dans
[`scripts/session-lib.mjs`](scripts/session-lib.mjs), éprouvées par `npm run test:pilotage`.

| Ligne de sortie                       | Ce qu'elle tranche                                                                                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Git … non poussés N ⚠️`              | un commit non poussé n'a PAS de CI — la ligne CI porte alors sur un commit plus ancien                                                                                                                |
| `🚨 _state PÉRIMÉ`                    | le garde-fou `_state` ↔ commits, **calculé** : des `feat`/`fix` postérieurs au `_state` qu'il ne cite pas. La suite se lit sur EUX, pas sur sa « Priorité 1 » — et on propose de réécrire le `_state` |
| `🧷 Priorité 1 … SANS ticket`         | la Priorité 1 du `_state` n'a aucun ticket, donc le tableau ne la voit pas et `➡️` ne la proposera jamais. On la présente EN PREMIER, avec un ticket à ouvrir. `📌` = elle a un ticket                |
| `CI <sha> ✅/⏳/❌`                   | le dernier commit poussé qui a des runs. `⏳` = en cours : `conclusion` y vaut `""`, seul `status` fait foi                                                                                           |
| `Jalon courant …` + `➡️ #N`           | le prochain dans l'ordre, choisi par [`board-next.mjs`](scripts/board-next.mjs) dans le **jalon COURANT** — jamais un ticket d'une version ultérieure, même mieux classé                              |
| `Fermés depuis la dernière empreinte` | diff de l'empreinte commitée contre la fraîche — lisible hors ligne                                                                                                                                   |
| `Tableau : N erreur(s)`               | `board-lint` lancé UNE fois ; une erreur se solde MAINTENANT (skill `nodefony-ticket`, `references/tableau-de-bord.md`)                                                                               |
| `dist périmé : …`                     | 1ʳᵉ cause d'échec de session → `npm run build` (après pull/merge : `clean && build`)                                                                                                                  |

**Pièges que le script porte — ne pas les contourner à la main :**

- 🔴 **L'empreinte `.ai/board.json` est LA voie de lecture**, connecté comme déconnecté : produite
  par GraphQL paginé ([`board-snapshot.mjs`](scripts/board-snapshot.mjs)), jamais éditée à la main.
  Le client de tableau de bord en ligne de commande omet des lignes sans le dire (vécu : 120 items
  sur 261, et un ticket `beta` annoncé avec neuf `alpha` ouverts), et son champ `.title` reste sur
  l'ancien libellé — la voie GraphQL lit `.content.title`. Hors ligne, le script DIT la date de
  l'empreinte : trois jours d'écart, c'est trois jours de travail qu'elle ignore.
- **Le ticket gagne sur le `_state`… quand le `_state` est PÉRIMÉ**, pas quand le tableau
  IGNORE le travail. Un chantier sans ticket est invisible pour `➡️` : c'est la ligne `🧷` qui le
  rattrape, et elle passe avant. Vécu : le vidage du cliquet de typage, Priorité 1 sans ticket,
  relégué derrière un ticket de release.
- **L'empreinte régénérée laisse `.ai/` modifié** — compté à part dans « non commités » ; il part
  avec le prochain commit.

## 2. Restituer (≤ 30 lignes)

1. **Dernière session** : date + focus
2. **Décisions prises** (extraites du `_state.md`)
3. **➡️ Prochaine étape** : la ligne `🧷` si elle est là (priorité sans ticket, à présenter en
   premier), sinon la ligne `➡️` du script, jamais une déduction personnelle sur une liste de
   tickets. `_state` PÉRIMÉ ou contredit → le DIRE, le ticket gagne. ⚠️ L'ordre encode les
   **dépendances**, pas le moment : un petit ticket dont le contexte vient d'être chargé se prend
   **maintenant** — skill `nodefony-ticket`.
4. **Avancement du jalon COURANT** (ligne `Jalon courant`), les 2 suivants ; les jalons ultérieurs
   en une ligne au plus. Hors ligne : « avancement non vérifié » + la date de l'empreinte.
5. **Git** : non poussés, non commités, `dist` périmé — lignes du script
6. **Question** : « On reprend ça, ou autre chose ? »

> Aucun `_state.md` trouvé → fallback : `git log` récent + ligne `➡️` du tableau.
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
head -40 .ai/BOARD.md                              # jalons + le prochain dans l'ordre (généré)
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
6. **Question** : "Sur quoi on bosse ?"

## Anti-patterns START

- Lancer les tests (long, bruyant) — hors bootstrap ; le user les lance sciemment (`nodefony-check-memory-health` ou direct).
- Charger > 200 lignes par section — `head` + résumer.
- Ignorer "dist périmé" — 1ʳᵉ cause d'échec de session.

---

# MODE END — le détail vit en `references/`

Il ferme la session et ne sert qu'une fois : le garder ici ferait payer sa lecture à **chaque**
reprise. Charger [`references/mode-end.md`](references/mode-end.md) AVANT d'agir.

**Ce qu'il faut savoir sans ouvrir la référence** — de quoi décider, jamais de quoi exécuter :

- Le END tient en **deux passes de script** autour du seul jugement : `npm run session:end`
  prépare (tickets, tableau, empreinte, chemin du `_state`), l'agent ferme les tickets, écrit le
  `_state`, commite et pousse, puis `npm run session:end -- --verify` refuse une clôture
  incomplète. Un END qui traîne est un END mal fait.
- Il **écrit la mémoire de reprise** `project_session_<date>_state.md` : sans elle, le RESUME du
  prochain `/clear` n'a rien à reprendre. C'est l'étape qu'on ne saute jamais.
- **Pas de retex, pas de sas de leçons.** Une friction se traite SUR LE MOMENT : un automate
  (gate, test, garde de script) qui la rend impossible, ou rien. Une leçon écrite pour plus tard
  ne tenait que si l'on y pensait — mesuré, c'était le cas de la majorité.

## Liens

- Mémoire : `feedback_token_economy` (économie tokens).
- Archive des anciens retex : `docs/session-retros/` (historique, plus alimenté).

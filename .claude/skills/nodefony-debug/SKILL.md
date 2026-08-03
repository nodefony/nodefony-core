---
name: nodefony-debug
metadata:
  version: 1.1.0
description: >
  Kit debug runtime de Nodefony — à charger quand quelque chose vient de casser, pas pour concevoir.
  Codifie les recettes de diagnostic éprouvées : flake mémoire (l'isolation dit la vérité), vert en
  isolation et rouge en suite (ressource partagée, pas régression), qualifier une régression par une
  baseline stashée, échec d'intégration dont la première hypothèse est un serveur éteint, dépendance
  implicite à `delete`, faux ENOSPC du harnais. Délègue à `nodefony-tail-error-logs`,
  `nodefony-check-memory-health`, `nodefony-load-test`, `nodefony-frontend-dev` ; la doctrine
  préventive vit dans `nodefony-framework-dev`.
  Déclencheurs : "ça crash", "stack trace", "unhandledRejection", "fuite mémoire", "memory leak",
  "race condition", "reproduire", "ne démarre plus", "test rouge inexpliqué", "test flake",
  "vert isolé rouge en suite", "ce test passe seul mais pas en suite", "diagnostic régression",
  "baseline stash", "est-ce ma régression ?", "404 inexpliqué", "ECONNREFUSED tests", "ENOSPC".
---

# nodefony-debug — kit debug runtime

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; historique = `git log`, version = `metadata.version`.
>
> Règle projet : la doctrine debug PRÉVENTIVE (« coder pour pas casser ») vit dans `nodefony-framework-dev` §2 + §9. Ce skill est RÉACTIF (« ça vient de casser, je diagnostique »). Anti-duplication : références only, pas de copie.

## 1. Quand m'utiliser

Je me charge quand un symptôme runtime arrive : crash boot, fuite mémoire, race, test rouge inexpliqué, régression à diagnostiquer. Mes triggers sont **étroits** par design — hors session debug, je ne pèse rien.

## 2. Quand passer la main (anti-overlap)

| Symptôme                                                            | Skill cible                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Crash boot serveur, stack trace dans logs                           | `nodefony-tail-error-logs` (parse `/tmp/nodefony-server.log`)             |
| Fuite mémoire suspectée (HTTP/WS heap delta)                        | `nodefony-check-memory-health` (run `npm run test:memory`, vitest)        |
| Lenteur, charge, p99                                                | `nodefony-load-test` (k6/autocannon orchestré)                            |
| Modif front .tsx ne passe pas                                       | `nodefony-frontend-dev` §4 (curl `/@fs/` + purge `.vite`)                 |
| Boot enfant direct, arrêt qui pend, reproduction d'un crash au boot | `NODEFONY_DEV_CHILD=1` + `nodefony-start-server` (voir plus bas)          |
| RETEX bugs réels par symptôme                                       | `nodefony-framework-dev` §11 (kit vivant)                                 |
| Design/refacto/build neuf                                           | `nodefony-framework-dev` (cœur backend) ou `nodefony-studio-dev` (Studio) |

## 3. Les recettes éprouvées

### Recette A — Memory test flake en suite full → isolation = vérité

**Symptôme** : `npm run test:memory` (vitest) échoue sur un test memory (`100 sync crashes`, `100 async crashes`, `500 mixed`…) avec un delta heap > seuil (ex : 18.6 MB > 10 MB seuil). Le test **change à chaque run** (ce n'est pas localisé).

**Cause** : variance GC cumulée. Historique : async-crash vu à 10.4 MB sur un serveur chauffé sans
`--expose-gc`, vert sur serveur frais — PAS une fuite réelle. **Résolu structurellement depuis** :
`start.sh` injecte `--expose-gc` et la sonde `/nodefony/test/memory` force le GC avant mesure
(cf [[project_ws_sustained_heap_finding]]). Si flake malgré ça → vérifier que le serveur a bien été
lancé via `start.sh` (pas un boot manuel sans le flag).

**Diagnostic** : **redémarrer le serveur frais via `start.sh`** (`nodefony-start-server`) puis relancer le gate ; ou un test isolé :

```bash
cd src/packages/@nodefony/http && npx vitest run --config vitest.load.config.ts -t "<nom-exact-du-test>"
```

Test isolé < 500ms et passe → c'est un **flake suite**, pas une fuite. Confirmer via baseline stash (recette B) si suspicion régression.

**Ne JAMAIS** desserrer le seuil. Documenté dans `feedback_session_pitfalls` + ce skill.

#### A bis — Généralisation : vert isolé + rouge en suite = RESSOURCE PARTAGÉE (3×)

Le raisonnement « isolation = vérité » ne vaut pas que pour la mémoire. **Un test qui passe seul et
échoue en suite accuse le BANC, pas le code** — et la cause est presque toujours une ressource que
deux fichiers se disputent :

| Ressource                      | Vécu                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| **Index/base de données**      | un banc Redis neuf posé sur l'index 12, déjà pris par deux fichiers qui le purgent        |
| **Port / binaire spawné**      | `CliIntegration`, `completion` : rouges sous `turbo run test` (concurrence), verts isolés |
| **Store persistant non purgé** | des PAT créés sans jamais être révoqués s'accumulent → le banc n'est jouable qu'UNE fois  |
| **Compte absolu**              | une assertion `count === N` casse dès qu'un test voisin écrit dans la même table          |

**Diagnostic** : isoler **deux fichiers ensemble** (pas un seul) — si le rouge revient sans aucun
fichier du diff en cours, c'est la ressource. **Remède** : cloisonner (index/base/préfixe dédiés par
fichier, avec une sentinelle qui refuse deux bancs sur la même cible), jamais sérialiser la suite.

### Recette B — Diagnostic régression : baseline stash

**Symptôme** : tests qui passaient avant ton patch failent maintenant. Avant de paniquer, prouve que c'est TON patch.

**Procédure** :

```bash
git stash                                # remise à HEAD propre
cd src/<module-touché> && npm run build  # rebuild SANS tes changes
bash .claude/skills/nodefony-start-server/stop.sh
bash .claude/skills/nodefony-start-server/start.sh
cd <chemin-tests> && npm run test:integration  # lance la suite à baseline
```

Si la suite échoue **AUSSI** sur baseline → **flake/dette pré-existant** (pas ta régression). Tu peux commit, en notant le flake dans le message + ne pas perdre de temps.

Si la suite passe à baseline mais échoue avec tes changes → **vraie régression**. Stash pop, grep les consommateurs du symbole/comportement modifié (`grep -rn "for...in.*options" src/`, `grep -rn "<symbole-modifié>" src/`). Cf recette E.

**Restaurer** : `git stash pop` + rebuild + restart serveur + re-test.

### Recette C — Fail intégration framework → 1ʳᵉ hypothèse : serveur down

**Symptôme** : `npm run test:integration` à la racine (turbo) sort `code 59` sur `@nodefony/framework` avec 59 tests rouges (`ECONNREFUSED`, `404`, ou exit code = nb de fails).

**Cause** : les tests d'intégration HTTP framework (`/nodefony/kernel/api/*`, `/fw/*`, etc.) requièrent un **serveur Nodefony actif** sur 5151/5152. Turbo ne le démarre PAS. Sans serveur → tous les tests HTTP plantent.

**Procédure correcte** :

```bash
bash .claude/skills/nodefony-start-server/start.sh   # 1. démarrer
npm run test:integration                              # 2. lancer la suite
bash .claude/skills/nodefony-start-server/stop.sh    # 3. couper
```

Avec serveur up → 59/59 verts.

### Recette C-bis — LIRE LE BILAN DU DERNIER BOOT avant de reproduire quoi que ce soit

**Symptôme** : l'application ne démarre plus et tu n'as pas la sortie (démarrage
détaché par le `DevSupervisor`, conteneur qui sort en 78, job de CI) — ou pire,
elle démarre et « tout a l'air normal » alors qu'une brique manque.

**Le premier geste n'est pas de relancer**, c'est de lire ce que le dernier
démarrage a laissé :

```bash
npx nodefony check                       # rapport lisible, en tête
cat var/last-boot.json                   # le bilan brut
npx nodefony check --json | jq .lastBoot # pour un agent
```

Le Kernel écrit `var/last-boot.json` aux **deux** issues : `status: "failed"`
avec la phase atteinte (`onPreStart`, `onBoot`, `onReady`…) et la cause ; ou
`status: "ok"` avec le bilan — `bricksSkipped` (tombées en fail-soft, AVEC la
raison), `bricksGated` (écartées volontairement par `policy`/`when`), les
comptes d'avertissements, les serveurs en écoute, la remédiation suggérée.

**Pourquoi ça change le diagnostic** : un boot qui ÉCHOUE est visible par
construction. Un boot qui **réussit en dégradé** ne l'est pas — le journal le
dit une fois, puis le terminal se ferme et l'application tourne amputée. C'est
le cas qu'on ne diagnostique jamais parce que rien ne le signale.

⚠️ **Lis l'ÂGE que `check` affiche** (« il y a 3 jours ») : le bilan décrit le
dernier démarrage, pas l'instant présent. Un bilan périmé fait chercher un
défaut déjà réparé.

⚠️ Une commande console (`inspect`, une commande de module) démarre sans monter
de serveur : elle n'écrase PAS le bilan. C'est voulu — sinon l'outil de
diagnostic détruirait la preuve qu'il vient chercher.

### Recette D — `vi.useFakeTimers()` plante en mocha (mélange runners) — ⚠️ HISTORIQUE (mocha SUPPRIMÉ 2026-06-05, runner unique = vitest ; gardé comme leçon)

**Symptôme** : `Error: Vitest failed to access its internal state` lors de `npm run test:integration`. Stack trace pointe `getWorkerState()` → `useFakeTimers()`.

**Cause** : un fichier de test importe `import { vi } from "vitest"` mais la suite tourne en **mocha**. Vitest cherche son worker state (inexistant hors runner vitest) → plante.

**Pattern repo** : `tests/unit/**` = vitest (`npm test`), `tests/{integration,http,websockets,routing}/**` = mocha (`npm run test:integration`). Si `.mocharc.integration.json` a `"spec": "nodefony/tests/**/*.test.ts"` SANS `ignore`, mocha ramasse aussi `tests/unit/` → conflit.

**Fix** :

```json
{
  "spec": "nodefony/tests/**/*.test.ts",
  "ignore": "nodefony/tests/unit/**"
}
```

Vérif : `npm test` (vitest) doit passer 166/166, `npm run test:integration` (mocha) ne doit plus ramasser les `*.test.ts` de `tests/unit/`.

### Recette E — `for...in` consommateurs ↔ `delete` vs `undefined`

**Symptôme** : après une micro-optim "delete → = undefined", une régression apparaît loin du code touché (ex : modif `Service.ts` casse les statics mp3/webm/favicon).

**Cause** : `delete obj.k` **supprime** la clé. `obj.k = undefined` **garde** la clé avec valeur undefined. Tout consommateur qui fait `for (const k in obj)` puis accède `obj[k].x` plante sur la valeur undefined → `TypeError: Cannot read properties of undefined`.

**Diagnostic** :

```bash
# Trouver les consommateurs for...in / Object.keys sur le champ touché
grep -rn "for.*in.*<obj>\|Object\.keys.*<obj>" src/ | grep -v "dist/\|node_modules"
```

**Règle** :

- Avant toute micro-optim suggérée par mémoire IA **≥ 7 jours** (« delete déoptimise V8, préférer undefined »), **GREPPER** les consommateurs.
- Si même un seul fait `for...in` avec accès dot → garder `delete`.
- Documenter dans le code (commentaire) ET dans la mémoire IA.

Cas vécu : `Service.ts` ctor ↔ `server-static.initStaticFiles` (cf `feedback_service_options_delete` + commit `8cbf6bb`).

### Recette F — ENOSPC fantôme du harness Bash (outillage, pas Nodefony)

**Symptôme** : une commande Bash (souvent `grep` multi-fichiers) échoue avec
`temp filesystem full (0MB free)` alors que le disque a des To libres ; `df`/`ls` passent.
Intermittent — c'est la **capture stdout du harness** qui sature, PAS le filesystem.

**Contournement fiable** : rediriger l'output vers un fichier puis le lire avec le tool `Read` :

```bash
grep -rn "<pattern>" <fichiers> > /tmp/out.txt 2>&1; echo ok
# puis tool Read sur /tmp/out.txt
```

**Ne PAS** relancer 3 variantes de la même commande qui échoue pareil (vécu 2026-06-11/12).
Bonus même famille : sous charge (serveur dev + 4 Vite), le Bash peut dupliquer/vider les sorties
→ 1 commande à la fois, `Read` plutôt que `cat`/`sed` pour lire un fichier.

### Recette G — `404` sur TOUTES les routes d'un banc → le mode, pas le code

**Symptôme** : une suite d'intégration ou un banc reçoit `404` partout, y compris sur des routes
qu'on lit dans les sources. Le serveur répond pourtant, et son démarrage est vert.

**Cause** : le runtime tourne en **production**, où les modules `policy:"dev"` ne sont pas
chargés — `@nodefony/test`, qui porte `/nodefony/test/*`, en fait partie. Les routes n'existent
pas ; ce n'est pas un défaut de configuration, c'est le rôle de la politique. Vécu à l'échelle
d'un dépôt : une tâche d'intégration continue est morte sept semaines sur ce seul motif, sans
qu'aucune suite ne tourne derrière.

**Diagnostic en une commande** — l'app dit elle-même ce qu'elle a gaté :

```bash
nodefony inspect routes --json | jq '.[].path'      # la route existe-t-elle VRAIMENT ?
nodefony inspect config --json                       # et d'où vient chaque valeur
```

**Conduite** : lancer la suite contre un serveur de **développement** (`--no-watch` pour qu'aucun
rechargement ne coupe le run) ; ou, si c'est bien le mode production qu'on veut éprouver, poser
la dérogation `NF_WITH_DEV_MODULES=1` — qui charge les modules dev en production, le journalise
en `WARNING` et **minute le runtime** (30 min, réglable jusqu'à 4 h par
`NF_WITH_DEV_MODULES_TTL_MIN`, jamais désarmable).

⚠️ **Corollaire de lecture** : un `CRITIC` « arrêt automatique … dérogation » dans le journal
d'un banc n'est pas une panne du framework — c'est cette garde qui a tiré. Régler le TTL et
relancer, plutôt que chercher une fuite.

## 4. Orchestration des skills voisins

Chacun porte son **protocole** ; ce sont des skills à charger, pas des scripts à lancer à l'aveugle.

| Tâche                                    | Où aller                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| Tailler les ERROR/CRITIC du log serveur  | `nodefony-tail-error-logs`                                                |
| Fuite mémoire (HTTP + WS), seuil sauté   | `nodefony-check-memory-health` — porte le diagnostic, pas que la commande |
| Charge / latence / dimensionnement       | `nodefony-load-test` (une trentaine de bancs sous `scripts/`)             |
| Vérif d'une modif front sans navigateur  | `nodefony-frontend-dev` §4 → `references/build-hmr.md` §8                 |
| État d'un symbole, d'une config, du diff | `nodefony-inspect`                                                        |

## 5. Doctrine "memory may lie" (CLAUDE.md global)

Les mémoires IA sont des **observations point-in-time** ; le code change, les mémoires se périment. Avant d'agir sur une mémoire ≥ 7 jours qui suggère une modif :

1. **Audit terrain** : lire le code actuel + grep les consommateurs.
2. Si la mémoire prétend qu'un symbole/fichier existe → vérifier (`jq` sur `.ai/symbols.json`).
3. Si la mémoire suggère une micro-optim → grepper les consommateurs du champ/comportement touché.

Cas vécu : `project_service_base_improvements` point 3 (6 jours) suggérait `delete → undefined` comme "0 risque". Régression terrain → 5 fails statics. Cf [[feedback-service-options-delete]].

## 6. Références (anti-duplication, vérité unique)

- **Boot enfant direct** : `NODEFONY_DEV_CHILD=1` court-circuite le superviseur pour voir le crash brut. La variable est lue par `src/nodefony/src/service/dev/DevSupervisor.ts` et `BootReporter.ts` (vérifié au code). Démarrage/arrêt → `nodefony-start-server`.
- **`nodefony-framework-dev` §11** : RETEX (kit vivant — bugs réels symptôme→cause→fix).
- **`nodefony-framework-dev` §2** : règles absolues perf+mémoire (à respecter en debug aussi).
- **`feedback_session_pitfalls`** (mémoire IA) : pièges récurrents (dist périmé, Bun pour `@nodefony/llm`, etc.).
- **`feedback_service_options_delete`** (mémoire IA, créée 2026-05-27) : règle `delete` obligatoire tant que les consommateurs `for...in` ne sont pas refactorés.
- **CLAUDE.md racine** : règle absolue perf+mémoire (35 MB / 1000 req, 10 MB / 100 crashes, 30 MB / 100 WS) — seuils blockers à respecter.

## 7. Conventions du skill

- **Tight** : ce skill doit rester < 250 lignes. Ajouter une recette = enrichir une section existante OU créer une mémoire IA + 1 ligne de référence ici.
- **Triggers étroits** : ne PAS élargir au design/refacto/build. Ces déclencheurs vivent dans `nodefony-framework-dev`.
- **Anti-duplication** : référencer, jamais copier (la vérité dupliquée dérive — leçon `feedback_convention_frere`).

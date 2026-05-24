# Consolidation retex — 2026-05-24 — retex #9 à #39 (2026-05-21 → 2026-05-24)

> 31 retex depuis la 1ʳᵉ consolidation (#1–#8, `CONSOLIDATION-2026-05-21.md`). Sessions :
> @nodefony/user, Drizzle/Sequelize orm-core, debug bar, profiler, Studio (dashboards, ORM,
> realtime, notifications), P6 security S1, realtime « la Socket Nodefony » + sonde + panneau Hub.
> Comptages = `grep -l` sur les 39 fichiers retex (mesuré, pas estimé).

## Patterns récurrents détectés

| #   | Pattern                                                                                  |  Occ.  | Impact                                                                  | État                                                                                                                |
| --- | ---------------------------------------------------------------------------------------- | :----: | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| I   | **`.git/index.lock` résiduel (hook husky/generate-symbols + lint-staged)**               | **12** | `rm -f` + retry à ~chaque commit (vu jusqu'à ~15×/session, +2× ce jour) | Reco « fixer le hook » répétée ; SEUL pansement appliqué = `rm` en allowlist. **Jamais traité au fond.**            |
| II  | **Turbo cache → dist/types périmé** servi au runtime                                     | **9**  | faux diagnostics (routes fantômes, headers périmés), confusion user     | Mémoires + section CLAUDE.md existent ; réflexe « rebuild DIRECT module » pas encore automatique                    |
| III | **Gros artefact (UI/skill/doc) édité 27–50× faute de cahier des charges amont**          | **6**  | N petits Edits + renumérotations (DebugBar 27× puis 50×, SKILL 49×)     | Règle hygiène #2 existe MAIS non appliquée sur les GROS artefacts (widget visuel, skill, doc)                       |
| IV  | **Vérif front lente** (curl transform, prébundle Vite périmé, hard-reload cache React)   |  4–5   | itérations + faux bugs « cache React »                                  | Partiel (no-headless mémorisé) ; skill `frontend-verify` suggéré 2× **jamais créé** ; flag `--fresh-front` pas fait |
| V   | **Outil ad-hoc avant de vérifier la convention des modules frères** (monocart vs vitest) |   2    | détour coverage (configs /tmp + runs jetés)                             | Mémoire `feedback_coverage_modules` MAJ ; pas de réflexe « grep le frère d'abord »                                  |

### ✅ Patterns de la conso #1 désormais RÉSOLUS (ne pas re-traiter)

- **A — cycle rebuild→restart non-batché** → érigé en règle CLAUDE.md (hygiène #4) ; le réflexe « frontend = HMR, 0 restart » est acquis (noté ✅ dans plusieurs retex).
- **B — `cd` + `start.sh` chemin relatif** → `start.sh`/`stop.sh` durcis (chemin absolu) ; plus revu après le 22.
- **F — AskUserQuestion sur décision design** → règle CLAUDE.md (hygiène #5) ; vu 1 dernière fois le 22 puis stoppé.
- **Bruit hook generate-symbols (homonymes)** → fixé `b31e404`.
- Skills suggérés #1 désormais créés : `framework-dev`, `studio-dev`, `check-externals`, `security-review`, `load-test`, `session`.

## Plan d'action (amélioration qualité IA)

1. **[#I — le plus rentable] Garde-fou anti-`index.lock` au moment du commit.**
   12 retex, jamais traité au fond. Le hook NE PEUT PAS se nettoyer lui-même (git commit détient déjà
   le lock quand le hook tourne) → le remède est **avant** `git commit`, pas dans le hook. Deux options :
   (a) **mémoire-réflexe** : « lock présent + 0 process git → `rm` puis retry » en 1 geste (au lieu de
   diagnostiquer à chaque fois) ; (b) **helper `scripts/safe-commit.sh`** qui fait le check+rm puis
   `git commit -F`. Cause probable du lock POST-commit propre = lint-staged ou l'extension git VSCode.

2. **[#III — règle] Renforcer « cahier des charges amont » SPÉCIFIQUEMENT pour les GROS artefacts.**
   La règle hygiène #2 existe mais saute sur les widgets visuels / skills / docs (DebugBar 27×+50×,
   SKILL 49×). Préciser : artefact > ~150 lignes OU widget visuel OU skill/doc → lister
   sections/panneaux/contrôles AVANT d'écrire, prévoir la structure des sections (éviter les renumérotations).

3. **[#IV — skill différé, enfin] `frontend-verify`** (ou flag du skill `start-server`) : curl
   `/@fs/<abs>` (transpile) + purge `node_modules/.vite` des consumers (`--fresh-front`) + rappel
   hard-reload. Suggéré 2× sans suite. À créer au prochain gros chantier front.

4. **[#II + #V — réflexe] « convention-frère + rebuild-direct ».**
   Avant tout outil ad-hoc (coverage/bench/lint) : `grep`/`ls` un module déjà équipé (framework/http).
   Après modif d'un `index.ts`/décorateur/config consommé au boot : `cd <module> && npm run build`
   (jamais le turbo racine seul). Déjà partiellement en mémoire ; à ancrer comme réflexe systématique.

## À archiver

- 39 retex > seuil. Archiver #1–#8 (déjà consolidés) → `docs/session-retros/archive/` à la prochaine passe
  pour alléger le dossier ; garder les 2 fichiers `CONSOLIDATION-*.md` à la racine du dossier.

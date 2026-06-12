# Consolidation retex — 2026-06-12 — bruts du 2026-06-01 au 2026-06-12 (48) + maintenance du SAS

> 2ᵉ run du mode CONSOLIDATE. Déclenché en fin de session « nettoyage skills » (les skills venaient
> d'être audités/MAJ → moment idéal : les retraits du SAS pointent des sections fraîchement vérifiées).

## Méthode

(1) Extraction `awk` des sections clés des 48 bruts de juin (la plupart sont minces — depuis le END
allégé du 05-31, les frictions vont directement dans `RETEX.md`). (2) **Lecture intégrale du SAS
`RETEX.md` (866 lignes)** = le vrai matériau. (3) Croisement avec les mémoires `feedback_*` ET les
6 skills MAJ le jour même (load-test, debug, check-memory-health, studio-dev, framework-dev, roadmap).
(4) Graduation / retrait / archivage.

## Graduations (frictions ≥3× → mémoires durables)

| Friction                                                     | Occurrences      | Destination                                                                       |
| ------------------------------------------------------------ | ---------------- | --------------------------------------------------------------------------------- |
| `Edit` exige un `Read` (l'outil) — `sed`/`cat` ne compte pas | 4× (06-08→06-12) | **NOUVELLE** `feedback_edit_requires_read_tool`                                   |
| cwd persiste / `cd X && cmd1 ; cmd2` / `git -C`              | 5× + 2 variantes | `feedback_cd_startsh_relative_path` **enrichie** (les 3 formes)                   |
| commitlint subject-case / PascalCase / header ≤ 100          | 8× + 2× + 1×     | déjà gradué (`feedback_commit_fr_apostrophes`) → retrait pur du SAS               |
| memory.test exige serveur lancé (ECONNREFUSED ≠ fuite)       | 3×               | skill `nodefony-check-memory-health` (prérequis + séquencement filet CLI ajoutés) |

## Retraits du SAS (~25 entrées, 866 → ~700 lignes)

- **Couverts par les skills** (vérifié contre leur contenu du jour) : patterns A/B (mono-route,
  verdict 3 issues, stash+rebuild, banc concurrent) → `nodefony-load-test` ; ENOSPC fantôme + shell
  instable → `nodefony-debug` recette F ; memory-flake/GC → `check-memory-health` + `debug` A/C ;
  ~10 frictions front du 06-06 (bureau, sticky, isolation, returnFocus, forage…) → `studio-dev` ;
  build vert ≠ typecheck vert (TS4114/TS18036) → `framework-dev` §8.
- **Déjà gradués** (anti-doublon) : commitlint → `feedback_commit_fr_apostrophes` ; clickodrome →
  `feedback_studio_ergonomie_progressive` ; terminologie FR → `feedback_terminology_forage`.
- **Résolus dans le code** : résidus de tests uploads (`0915764`) ; dist/types pre-push race (hook
  corrigé) ; END trop lourd (skill allégé 05-31) ; Mantine v8→v9 (skill corrigé 1.19.0) ;
  « commits non pushés » (le END pousse désormais).

## Ce qui RESTE au SAS (politique assumée)

~60 frictions **1-2×** réelles et récentes (juin), rangées par thème — c'est du capital
([[feedback_skills_no_slim_down]] : enrichir, ne pas amincir). La cible « ~1 écran » du SAS est
irréaliste à cette densité de sessions ; la borne réelle = **retirer gradué/obsolète/couvert-skill à
chaque CONSOLIDATE** (fait : −25). Candidats graduation au prochain run (2× aujourd'hui) :
« build turbo répété = douleur » · « git push background ne finalise pas » · « registre de fabriques
vs if(name) » · « Object.create(null) ↔ sérialisation ORM ».

## Archivage

**107 bruts** (05-25 → 06-12) déplacés vers `docs/session-retros/archive/` (`git mv`, historique
préservé). Racine = `RETEX.md` (SAS) + 4 `CONSOLIDATION-*.md`. Les 3 consolidations précédentes
couvrent 05-21/05-24/05-31.

## Verdict

La boucle d'amélioration fonctionne : sur ~110 frictions notées en 6 semaines, la grande majorité
était **déjà codifiée** (60+ mémoires `feedback_*`, skills vivants) — le SAS jouait bien son rôle de
tampon. Les 2 seules vraies graduations manquantes (Edit-Read, cwd) sont des frictions **outillage
harness**, pas Nodefony : le système capte bien les leçons projet, un peu moins les leçons d'outillage
(elles ne « casssent » rien, donc s'accumulent). Réflexe ajouté : une friction harness vue 2× → la
graduer sans attendre la 3ᵉ (coût quasi nul, fréquence élevée).

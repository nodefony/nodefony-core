# Consolidation retex — 2026-07-23 — retex 2026-07-10 → 2026-07-23 (38 bruts)

## Bilan d'assainissement

```
                        avant        après        Δ
  RETEX.md (SAS)        407 l.    →   76 l.      −81 %   (~50 k tokens → ~9 k)
  leçons dans le SAS    205       →   27         −87 %
  thèmes                49        →   9          −82 %
  retex bruts actifs    38        →   0          (→ archive/, 250 fichiers au total)
  mémoires feedback_*   79        →   83         +4 graduées, 3 renforcées, 1 skill étendu
```

Snapshot intégral du SAS avant coupe : [`archive/RETEX-snapshot-2026-07-23.md`](archive/RETEX-snapshot-2026-07-23.md) — **rien n'est perdu**.

## Graduations (friction ≥3× → mémoire durable)

| Friction                                                          | Occ. | Graduée en                                              |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------- |
| Deux implémentations d'une même RÈGLE dérivent en silence         | 5×   | `feedback_single_source_rule` **(nouvelle)**            |
| Annoncer les trous / ce qui n'a pas été lancé avant qu'on demande | 5×   | `feedback_announce_gaps_first` **(nouvelle)**           |
| Shell qui fabrique un faux diagnostic (`tail`, `$?`, glob nu)     | 8×   | `feedback_shell_false_diagnostics` **(nouvelle)**       |
| Réécriture mécanique de code (backtick/template, perl, BSD sed)   | 8×   | `feedback_code_rewrite_mechanical_traps` **(nouvelle)** |
| Un test neuf est complaisant → preuve négative obligatoire        | 6×   | fusionné dans `feedback_gate_must_bite`                 |
| Un test qui CONSTATE un bug tombe au fix = signal                 | 3×   | fusionné dans `feedback_gate_must_bite`                 |
| e2e qui spawne le binaire valide le DIST, pas le source           | 3×   | fusionné dans `feedback_session_pitfalls` §7            |
| Vert isolé + rouge en suite = ressource PARTAGÉE                  | 3×   | skill `nodefony-debug`, recette A bis                   |

## Purges (doublons — la leçon existait déjà ailleurs)

- `rg -r` = `--replace` (4ᵉ récidive) → `feedback_rg_no_replace_flag`.
- « Un test qu'on ne LANCE pas n'existe pas » (4×) → CLAUDE.md racine §checklist n°3 + `test:all`.
- « Citer un document au lieu du terrain » (4×) → **devise** en tête du CLAUDE.md racine.
- « Une liste de ports sondés est une convention, pas la topologie » (4×) → **corrigée dans le
  code** : le serveur publie ses ports effectifs (`runtime.json`, `devProcess.ts`). Leçon morte.

## Le vrai constat de cette consolidation : une mémoire ne change pas un comportement

Deux leçons **déjà graduées** au CONSOLIDATE précédent ont mordu **26 fois** depuis :

| Leçon graduée                 | Récidives depuis sa graduation |
| ----------------------------- | ------------------------------ |
| `feedback_bash_cwd_drift`     | **~20**                        |
| `feedback_rg_no_replace_flag` | **6**                          |

Aucune n'est un déficit de connaissance : les deux sont dans l'index, relues à chaque session. Ce
sont des **réflexes de frappe**, et une phrase en mémoire ne les corrige pas. Le remède est
**mécanique** (proposition ci-dessous), pas documentaire. Le SAS a d'ailleurs enregistré la
récidive au lieu de traiter la cause — c'est exactement ce que la règle anti-doublon interdit.

Le cwd a été rendu plus dangereux par sa **polymorphie** : il ne se présente jamais sous son nom
(`SyntaxError` de décorateurs, TS5058, « 0 test », 783 tests d'un autre module). La mémoire porte
désormais le réflexe de diagnostic : _devant une erreur d'outil incompréhensible, la première
hypothèse est le cwd_.

## 💶 Où passe l'argent (période 07-10 → 07-23, 242 transcripts touchés, subagents inclus)

```
  input          0,87 M tokens        cache write 5m   25,9 M
  output        10,23 M tokens        cache write 1h   30,2 M
  cache READ  4 497    M tokens   ← 76 % du coût à lui seul
  ------------------------------------------------------------
  ≈ 8 900 USD / 8 200 EUR      cache 91 %  ·  output 9 %
```

**Ce que je produis coûte 9 %. Relire le contexte coûte 91 %.** Moyenne : **~269 k tokens de
contexte relu par message**. Le contexte FIXE (CLAUDE.md racine 48 Ko + MEMORY.md 18 Ko + global)
ne pèse que **~17 k tokens**, soit 6 % de ce total : **le poste dominant, c'est la longueur des
sessions**, pas les fichiers d'instructions.

Conséquence non intuitive : le cache read croît **quadratiquement** avec la durée d'une session
(chaque tour relit tout l'historique). Une session deux fois plus longue coûte ~4× plus cher.
`feedback_session_hygiene` (« 1 feature = 1 session, `/clear` entre features ») est donc le levier
d'économie n°1 — et lui aussi est gradué depuis longtemps sans être appliqué.

## Plan d'action — 2 décisions qui touchent des fichiers protégés (GO/NO-GO user)

1. **Hook `PreToolUse` sur Bash** dans `.claude/settings.json`, deux motifs seulement :
   - `rg -r…` sans `--replace` explicite → **bloqué** avec le message « `-r` = `--replace` ».
   - commande contenant un `cd` **relatif** (`cd src/…`, `cd ../…`) → **bloquée** au profit d'un
     `cd /chemin/absolu`.
     Coût : ~30 lignes de shell. Bénéfice attendu : les deux récidives les plus coûteuses du projet
     (26 occurrences en 13 jours) deviennent structurellement impossibles.
2. **Allègement du CLAUDE.md racine** (48 Ko) : les sections « Structure d'un module », « Standard
   gestion des types », « Conventions TypeScript » (~40 % du fichier) sont de la **référence**, pas
   des instructions de session → déplaçables dans un skill load-on-demand. Gain : ~5 k tokens ×
   chaque tour de chaque session. Fichier protégé par la règle projet → demande un accord explicite.

## À surveiller (sous le seuil, non gradué)

- **Le `_state` écrit puis la session qui continue** (2× le même jour) — le garde-fou RESUME
  fonctionne (il a joué le 23), mais la cause reste : une clôture n'est valide que si elle est la
  DERNIÈRE action.
- **Chercher les FRÈRES d'un défaut** (3 occurrences proches, formulations différentes) — candidat
  à graduation au prochain tour s'il revient sous une 4ᵉ forme.
- **Le kit/registre d'écarts périme** (2×) — relire le code cible avant d'appliquer une suite à donner.

## Prochain CONSOLIDATE

Dans ~15-20 retex. Le SAS repart à 27 leçons ; la règle « une leçon = SAS ou `feedback_*`, jamais
les deux » a été appliquée strictement, et les **récidives post-graduation ne doivent plus être
enregistrées comme des leçons** — elles appellent un mécanisme.

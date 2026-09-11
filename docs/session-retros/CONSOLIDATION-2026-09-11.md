# Consolidation retex — 2026-09-11 — sas de 695 → 492 lignes

Passe de maintenance du SAS (`RETEX.md`) et de la mémoire IA, déclenchée sur deux thèmes mûrs
signalés au RESUME. Retex couverts : les **9 bruts** du 09-10 et du 09-11, archivés à l'issue.
Sas : **59 → 32 frictions**, 17 → 14 thèmes vivants, **aucun au-dessus du seuil de 5**.

## Ce qui a été gradué

| Thème (frictions)                                         | Destination                          | Pourquoi cette maison                                                                                                  |
| --------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 🪟 Un contrôle VERT qui ne POUVAIT rien voir (21)         | `feedback_gate_must_bite` (§ neuf)   | Le thème est le DIAGNOSTIC dont cette mémoire porte déjà le REMÈDE — débrancher et regarder tomber. Même famille.      |
| 🧾 Un RITUEL de pilotage qui coûte plus qu'il ne rend (5) | `feedback_ritual_must_earn_its_keep` | Mémoire NEUVE : aucune existante ne porte le coût récurrent d'une étape de rituel. Doit ressortir au END et au ticket. |

Le thème 🪟 était mûr **depuis longtemps** (21 frictions, 09-09f → 09-11) et pesait à lui seul
160 lignes du sas. Il tient maintenant en une section de règles : le contrôle qui n'atteint pas sa
cible, le décor que le banc monte lui-même, le cas jamais exécuté, l'assertion de forme, le régime
nominal qui cache, la forme du motif, la question qui n'est pas la bonne, le parseur tolérant, la
zone muette, le rouge fabriqué par le décor, la sonde qui cherche le mauvais marqueur, la lecture
instantanée d'un système en propagation, le code de sortie qui n'est pas le sien.

## Ce qui a été versé ailleurs (sans attendre un seuil)

- **🚪 Un fast-path standalone n'hérite de RIEN** (2) → `feedback_single_source_rule`, dont la
  section « Une porte a plusieurs ENTRÉES » dit exactement cela. La réunion proposée au
  CONSOLIDATE précédent (🚪 + ⚙️) n'a **pas** été retenue : elle mêlait deux mécanismes distincts —
  « le raccourci n'hérite pas » et « le corps d'un script s'exécute à l'import ». ⚙️ reste à 4.
- **Le `✓` que j'imprime ne prouve pas l'état du disque** (1, orphelin du thème 🧾) →
  `feedback_suspect_instrument_and_own_diff`, § « l'instrument le plus suspect est celui qu'on
  vient d'écrire ».

## Porter — la troisième sortie du cycle

`lessons-carriers.mjs --write` : **120 leçons — 8 PRODUIT, 32 DÉPÔT, 80 CONTEXTE, 0 INERTE**
(`.ai/LESSONS.md` régénéré). Les deux graduations portent leur section **Porteur** :

- 🪟 : aucun automate ne peut répondre « qu'aurait-il vu ? » — geste de méthode. Deux porteurs
  partiels : `argv.selftest.mjs` et le régime `--raw` du gate de format. **Règle qui en sort** :
  tout banc neuf qui monte lui-même son décor doit exposer un régime qui NE le monte pas.
- 🧾 : `ticket:lint` tient la cohérence du tableau mais **ne voit ni une frise démarrée dans le
  passé, ni un « In Progress » sans commit récent** ; et `.githooks/post-commit` ne porte pas la
  même exclusion de commits de pilotage que le lint. Deux trous nommés, non comblés cette passe.

L'outil a mordu sur du **neuf** : il a nommé une ancre MORTE dans la mémoire écrite dix minutes
plus tôt (`scripts/board-lint.mjs` — le fichier vit sous `.claude/skills/nodefony-ticket/`).
Corrigée, 0 ancre morte.

## La boucle des recommandations — 983 dans 326 retex

`--recos` : **30/36 mémoires nommées écrites**, **17/28 skills nommés créés**. Décision de cette
passe : **ne rien créer**. Les six mémoires « jamais écrites » ont toutes une maison sous un autre
nom (`feedback_turbo_cache_stale_logs`, `feedback_root_dist_stale_modules`,
`feedback_git_index_lock`, `feedback_config_validation_zod`) ; les onze skills « non résolus » sont
pour la plupart doublés par une règle du `CLAUDE.md`, et le dépôt en porte déjà 27 dont 11 jamais
invoqués — en ajouter dégraderait le dispositif ([`docs/outillage-agents.md`](../outillage-agents.md)).
Cette liste n'est pas un backlog : elle sert à voir ce qui a été accepté par le silence, et à le dire.

## Ce que cette passe n'a pas fait

- Pas de minage du transcript (tool_use, coût €, allowlist) — `references/consolidate-toolkit.md`
  non déroulé : il ne répond pas à la question posée.
- Les 14 thèmes restants sont sous le seuil. Famille encore candidate à réunion au prochain
  passage : « ce qui ne traverse pas une frontière de process » (📐 assertion de chemin 3 +
  🧵 trois choses 1 = 4) — toujours insuffisante.
- Les deux trous de porteur nommés ci-dessus (frise dans le passé, `In Progress` fossile) ne sont
  pas comblés : ce sont des tickets à ouvrir, pas une maintenance de mémoire.

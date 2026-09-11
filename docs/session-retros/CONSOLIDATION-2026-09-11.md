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
- 🧾 : `ticket:lint` (`.claude/skills/nodefony-ticket/scripts/board-lint.mjs`) porte désormais la
  frise — contrôles **FRISE-DECALEE** (le départ s'éloigne d'aujourd'hui dans un sens ou dans
  l'autre, au-delà de 5 jours), **CIBLE-AVANT-DEBUT** et **FRISE-A-TROUS** (un jalon daté à
  moitié ; muet sur un jalon pas encore planifié). Vus rouges par débranchement, puis lancés sur le
  vrai tableau : deux tickets non datés trouvés (#349, #352) et datés.

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
- ⚠️ **Deux des « trous » annoncés par cette passe n'existaient pas.** Le contrôle du statut
  menteur (`STATUT-MENTEUR`, E6) et l'exclusion partagée des commits de pilotage
  (`commit-kind.mjs`, lue par le lint ET par `ticket-progress.mjs`, avec un test qui l'exige)
  étaient là depuis le début — je les ai déclarés absents sans les avoir cherchés, dans le rapport
  même où je graduais la leçon voisine. Friction versée au thème 🕳️ du sas, qui atteint le seuil
  de 5 : à graduer au prochain passage.
- L'empreinte hors ligne (`.ai/board.json`) ne porte PAS les dates : une frise décalée reste
  invisible à qui lit le tableau sans réseau. Non comblé.

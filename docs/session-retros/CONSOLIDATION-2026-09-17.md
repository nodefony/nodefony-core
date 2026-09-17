# Consolidation retex — 2026-09-17 — 25 retex depuis le 2026-09-11

## Ce qui a été fait

| Étape             | Résultat                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| Graduation        | **7 thèmes mûrs** versés dans **6 mémoires** (4 existantes, 2 créées)                            |
| Sas `RETEX.md`    | **1 317 → 495 lignes**, 129 → 30 frictions, **0 thème au-dessus du seuil**                       |
| Archivage         | 25 retex bruts → `archive/` · snapshot d'avant-coupe conservé                                    |
| Portage           | 123 leçons classées — **0 inerte, 0 ancre morte** (`.ai/LESSONS.md` régénéré)                    |
| Index `MEMORY.md` | **27 → 23,2 Ko** — il repassait au-dessus de la limite, donc des entrées n'étaient plus chargées |

## Le pattern le plus coûteux : des familles ÉCLATÉES sous le seuil

🔴 **Deux thèmes distincts décrivaient le même défaut, et séparés aucun ne pesait son vrai poids.**
« Un contrôle qui ratisse trop large crie faux » (13) et « une portée GLOBALE n'est pas un peu
intrusive » (6) sont les deux faces d'une seule chose : **le périmètre réel d'un geste ou d'un
contrôle n'est pas celui qu'on croit viser**. Réunis : **19 frictions**.

C'est exactement le défaut que le skill met en garde — « 55 thèmes créés en quatre jours, quatre
familles évidentes éclatées en thèmes de 2-4 frictions, aucun n'atteignant le seuil ». Le seuil ne
mord que si la friction rejoint sa FAMILLE ; un titre neuf par session le désamorce en silence.

**Ce qui en découle pour les prochains END** : avant d'ouvrir un thème, lire les titres existants
(`npm run retex:seuil -- --all`) et se demander non pas « ai-je déjà écrit CE bullet ? » mais
« de quelle famille ce défaut est-il un cas ? ».

## Les 7 graduations

| Thème                                           | Frictions | Maison                                   | Neuve ? |
| ----------------------------------------------- | --------: | ---------------------------------------- | ------- |
| 🙈 L'outil ALTÈRE sa propre sortie              |        21 | `feedback_shell_false_diagnostics`       | non     |
| 🔭 + 🌍 périmètre plus large que l'intention    |        19 | **`feedback_scope_wider_than_intended`** | **oui** |
| 🤝 Le terrain qu'on donne (délégué ou soi-même) |        17 | `feedback_stale_decor_poisons_verdicts`  | non     |
| 🧪 Ce qu'on PUBLIE est une affirmation          |         8 | `feedback_agent_example_over_prose`      | non     |
| ⚙️ Réutiliser un script, c'est le RELANCER      |         7 | **`feedback_script_import_executes`**    | **oui** |
| 📐 Composer un chemin avec la MÊME opération    |         7 | `feedback_cross_platform_axioms`         | non     |
| 🧪 Un banc comparatif dont les camps dérivent   |         7 | `feedback_measure_method`                | non     |

Cinq versements dans des mémoires existantes pour deux créations — le rapport visé (« une maison
existante d'abord, une neuve en dernier recours »).

## Ce que ces 86 frictions disent, au-delà de leur thème

1. **Ce qui relaie une sortie la déforme autant que le shell.** La notification de tâche de fond a
   annoncé « exit code 0 » sur deux runs ROUGES ; seule la ligne `EXIT=$?` écrite dans le fichier
   capturé disait vrai. Le protocole visait le `| tee` — il vaut pour toute couche qui RAPPORTE.
2. **Un verdict NÉGATIF ne se distingue pas d'un instrument qui regarde ailleurs.** « Absent »,
   « cassé », « mort » se recontrôlent avec un SECOND outil avant d'être dits ; une présence, non.
3. **On est souvent soi-même le second acteur.** Éditer pendant que sa propre suite tourne, lancer
   un build pendant qu'un test lit le `dist` : le décor n'a pas besoin d'un tiers pour être sali.
4. **Un faux positif se supprime par la SOURCE, jamais par un seuil relâché** — un seuil relâché ne
   crie plus du tout, et un gate qu'on apprend à ignorer ne garde rien.
5. **Une grandeur fidèlement mesurée peut ne pas répondre à la question** (`rss` contre
   `phys_footprint` : trois semaines de publication et un ticket P0 sur un artefact de comptage).

## Plan d'action

1. ✅ **Fait** — graduation, archivage, portage, compactage de l'index.
2. **Rien de neuf à outiller.** Les six mémoires touchées ont déjà leur porteur (gate, script ou
   skill) ; `lessons:carriers` rend 0 inerte et 0 ancre morte. Créer un outil de plus ici
   dégraderait le dispositif — le dépôt porte 27 skills dont 11 n'ont jamais été invoqués.
3. **À surveiller au prochain CONSOLIDATE** : le rythme de création de thèmes. Sept thèmes pour
   25 retex est sain ; le signal d'alarme est un thème neuf par session.

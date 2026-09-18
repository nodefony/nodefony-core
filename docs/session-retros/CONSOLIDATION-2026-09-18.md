# Consolidation retex — 2026-09-18 — les 14 retex des 17 et 18 septembre

Le CONSOLIDATE précédent date de la veille (09-17) et laissait le sas à **495 lignes, 30 frictions,
0 thème mûr**. Vingt-quatre heures plus tard : **850 lignes, 64 frictions, 5 thèmes mûrs**.
Sept sessions dans la journée.

## Ce qui a été fait

| Étape          | Résultat                                                                            |
| -------------- | ----------------------------------------------------------------------------------- |
| Graduation     | **6 thèmes** versés dans **6 mémoires existantes — aucune neuve**                   |
| Sas `RETEX.md` | **850 → 479 lignes**, 64 → 26 frictions, **0 thème au-dessus du seuil**             |
| Archivage      | 14 retex bruts → `archive/` (546 au total) · snapshot d'avant-coupe conservé        |
| Portage        | 123 leçons classées — **0 inerte, 0 ancre morte** (`.ai/LESSONS.md` régénéré)       |
| Specs figées   | `refs:check` = 0 · `agents-md` à jour · `mcp-2026-07-28` toujours sans `AMONT.json` |

## Les 6 graduations

| Thème                                           | Frictions | Maison                                       | Neuve ? |
| ----------------------------------------------- | --------: | -------------------------------------------- | ------- |
| 📏 Le CHANGELOG résume, le titre approxime      |         9 | `feedback_source_over_memory`                | non     |
| 🧊 Un banc qui s'arrête au premier échec        |         7 | `feedback_bench_probe_false_verdicts`        | non     |
| 🪤 Ajouter un CAS réveille des hypothèses       |         7 | `feedback_prove_the_target_not_the_verdict`  | non     |
| 🖥️ L'interactif se prouve au PTY                |         5 | `feedback_shell_false_diagnostics`           | non     |
| 🩹 Un repli qui rend une ESPÉRANCE pour un FAIT |         5 | `feedback_reliable_path_demoted_to_fallback` | non     |
| 🪞 Le remède porte le défaut qu'il corrige      |         5 | `feedback_fix_the_family_not_the_instance`   | non     |

**Zéro mémoire neuve, et c'est le résultat le plus important de cette passe.** Le CONSOLIDATE du
2026-08-24 avait mesuré l'inverse — 55 thèmes créés en quatre jours, quatre familles évidentes
éclatées sous le seuil — et le CONSOLIDATE du 09-17 avait encore dû en créer deux. Ici, chaque
thème a trouvé une maison qui existait déjà. La consigne « une mémoire existante d'abord, une neuve
en dernier recours » a mordu.

⚠️ **Le sixième thème n'était pas mûr au début de la passe** : il l'est devenu parce que la session
du jour y a versé sa cinquième friction. Un CONSOLIDATE se relance donc **après** sa propre coupe —
sinon un thème passe le seuil pendant qu'on regarde ailleurs.

## Ce que ces 38 frictions disent, au-delà de leur thème

**Une seule famille les traverse : quelque chose répond à une question VOISINE de celle qu'on pose,
et sa réponse est plausible.**

- Un changelog répond « ce qui a changé », pas « ce que le code fait ».
- Un banc rouge répond « la mesure a échoué », pas « le fichier ne compile plus ».
- `containerHealthy` répond « le conteneur tourne », pas « le serveur est prêt ».
- Un socket ouvert répond « ça écoute », pas « NOTRE serveur écoute ».
- `task-N.gates.json` répond « un tiers du verdict », sous un nom qui promet le verdict.
- Un banc de déclenchement répondait pour le skill du dépôt, pas pour son homonyme livré.

Aucune de ces réponses n'est une erreur : ce sont des réponses **justes à une autre question**.
C'est pourquoi rien ne lève, et pourquoi le diagnostic part systématiquement vers le produit.

**Le contrôle qui les attrape toutes tient en une phrase : de quoi cette valeur est-elle
exactement le constat ?** Quand la réponse est « d'un fait voisin », il reste à chercher la source
qui produit le fait demandé — elle existe presque toujours, et elle coûte une commande.

**Et un signal sous-exploité** : un résultat qui **NE RÉAGIT PAS** à ce qu'on change. Le défaut du
banc de déclenchement n'a été trahi ni par un rouge ni par une relecture, mais par un score
identique après une édition. C'est le seul symptôme qu'un instrument visant à côté puisse produire.

## Plan d'action

1. **Rien à créer.** Les six leçons sont dans des mémoires déjà indexées et déjà relues.
2. **`mcp-2026-07-28` reste sans `AMONT.json`** — sa dérive est invérifiable, et ça fait deux
   CONSOLIDATE que le contrôle le dit. À trancher : poser le manifeste, ou assumer par écrit que
   cette copie est figée pour de bon.
3. **Le corpus de `nodefony-devops` (24 pages) n'est balayé par aucun contrôle de dérive** —
   `check-amont.mjs` ne regarde que `nodefony-rfc` et n'accepte qu'un dépôt GitHub par dossier.
   Ticket annoncé en session, **non ouvert**.
4. **83 leçons sur 123 sont en CONTEXTE** — relues seulement, elles ne tiennent que si on y pense.
   Le rapport PRODUIT (8) / DÉPÔT (32) n'a pas bougé depuis la dernière passe.

## À archiver

- 14 retex bruts déplacés vers `docs/session-retros/archive/`.
- Snapshot d'avant-coupe : `archive/RETEX-snapshot-2026-09-18.md`.

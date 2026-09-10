# Consolidation retex — 2026-09-10 — sas de 827 → 490 lignes

Passe de maintenance du SAS (`RETEX.md`), déclenchée par le compteur : **3 thèmes au-dessus du
seuil de 5**, sas gonflé à 827 lignes, 28 renvois de graduation dispersés dans le corps.

## Ce qui a été gradué

| Thème (frictions)                                           | Destination                                        |
| ----------------------------------------------------------- | -------------------------------------------------- |
| 🧭 La voie FIABLE reléguée en repli (10)                    | **`feedback_reliable_path_demoted_to_fallback`**   |
| 👯 Un JUMEAU non vérifié (6)                                | **`feedback_twin_alignment_unproven`**             |
| 📐 Le verdict BINAIRE d'un banc (5)                         | **`feedback_verdict_discards_its_evidence`**       |
| 🧑‍⚖️ Un AUDIT + 🕶️ relire EN AVEUGLE (4 + 3 = **7**, RÉUNIS)  | **`feedback_outside_look_finds_what_green_hides`** |
| 🧨 DÉCLARATION qui désarme + 💾 CACHE à demi écrit (VERSÉS) | `feedback_destructive_needs_identity_scope` (§)    |

**La réunion est le geste qui manquait.** Les deux derniers thèmes n'atteignaient PAS le seuil
séparément (4 et 3, 2 et 0) : réunis dans leur famille, ils pesaient 7 et 4. C'est le défaut que le
CONSOLIDATE du 2026-08-24 avait déjà nommé — un titre neuf par session désamorce le seuil en
silence. Le contrôle qui l'attrape se fait ICI, en lisant les titres avant de compter.

## Ce qui a été élagué

- **28 renvois « — GRADUÉ » individuels fondus en une table** dans la section de regroupement
  (thème → mémoire), sur le modèle des CONSOLIDATE précédents. Rien n'est perdu : le sens vit dans
  la mémoire, le renvoi n'existe que pour empêcher la réécriture.
- **Sections d'archive remises en FIN de fichier** — elles s'étaient retrouvées au milieu, avec des
  thèmes vivants après elles.
- **57 retex bruts de septembre archivés** (`docs/session-retros/archive/`), le 09-10 restant en
  place.

Résultat : **827 → 490 lignes**, 23 → 16 thèmes vivants, 63 → 33 frictions.
Snapshot avant coupe : `archive/RETEX-snapshot-2026-09-10.md`.

## Porter — la troisième sortie du cycle

`lessons-carriers.mjs` après graduation : **119 leçons — 8 PRODUIT, 31 DÉPÔT, 80 CONTEXTE, 0
INERTE.** Chaque mémoire créée porte désormais une section **Porteur** qui répond en toutes lettres
à « quel automate tient cette leçon ? », y compris quand la réponse est « aucun, et c'est
légitime » : un audit, un usage réel et une relecture en aveugle sont des gestes de méthode, pas
des gates. Une leçon sans porteur NI raison écrite est une leçon qui se reperdra.

## Ce que cette passe n'a pas fait

- Pas de minage du transcript (tool_use, coût €, allowlist) — `references/consolidate-toolkit.md`
  non déroulé, il ne sert pas à cette question.
- `--recos` non lancé : la boucle « recommandation acceptée par le silence » demande du tri
  éditorial, pas une passe de maintenance.
- Les 16 thèmes restants sont tous sous le seuil ; deux familles restent candidates à réunion au
  prochain passage (« ce qui ne traverse pas une frontière de process » : assertion de chemin +
  trois choses qui ne suivent pas ; « réutiliser du code d'un script, c'est le relancer » + fast-path
  standalone).

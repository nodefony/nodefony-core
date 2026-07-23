---
title: "nodefony-html-report — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-html-report/SKILL.md"
---

# `nodefony-html-report`

> Fabrique des rapports HTML autonomes (zéro dépendance, zéro CDN) destinés à des humains qui doivent DÉCIDER — audits, bancs de performance, revues, états des lieux, dashboards figés.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-html-report**

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                                                    |
| ------------------------ | -------------------------------------------------- |
| Version                  | — (non versionné)                                  |
| Famille                  | Références et livrables                            |
| Corps                    | 174 lignes                                         |
| Coût d'activation        | ~3 017 tokens (le corps est chargé à l'invocation) |
| Description              | 935 / 1024 caractères                              |
| Déclencheurs             | 11                                                 |
| Ressources `references/` | 3 page(s), 9 fichiers au total                     |
| Scripts                  | 3                                                  |
| Conformité               | ✅ conforme au standard                            |

## Ce qu'il fait

Fabrique des rapports HTML autonomes (zéro dépendance, zéro CDN) destinés à des humains qui doivent DÉCIDER — audits, bancs de performance, revues, états des lieux, dashboards figés. Fournit une bibliothèque de rendu (`lib/report.mjs`) : graphes SVG (barres, courbes, nuage+régression, waterfall, heatmap, jauge, donut, sparkline), tableaux triables/filtrables, calculateurs interactifs, listes réordonnables par glisser-déposer, onglets, mode présentation, export CSV — et une impression PDF soignée (sauts de page maîtrisés, en-têtes de tableau répétés, hypothèses figées). À utiliser dès qu'un livrable doit être LU, MANIPULÉ ou IMPRIMÉ par une personne, plutôt que relu par un outil.

## Prérequis

Ce que le décor doit fournir pour que ses scripts disent quelque chose : **redis** · **base de données**.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`load-test`](nodefony-load-test.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`rapport HTML` · `générer un rapport` · `rapport imprimable` · `rapport PDF` · `dashboard statique` · `restituer des mesures` · `page de résultats` · `graphe sans dépendance` · `calculateur interactif` · `deck de présentation` · `export CSV`

## Ce que contient le corps

- Quand l'utiliser — et quand NE PAS
- Règle d'or
- Processus (5 étapes)
- La bibliothèque — `lib/report.mjs`
- La marque (logo)
- Checklist qualité (à passer AVANT de livrer)
- Anti-patterns
- Index des références (charger à la demande)
- Exemple vivant

## Références (chargées à la demande)

- `references/ergonomie.md`
- `references/html-vs-md.md`
- `references/print-pdf.md`
- _(+ 6 fichiers dans des sous-dossiers : specs et normes bundlées hors ligne)_

## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script             | Rôle                                                              | Options                                                                                            | Variables d'environnement             |
| ------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `scripts/demo.mjs` | demo.mjs — vitrine ET test de non-régression de `lib/report.mjs`. | `--accent`                                                                                         | `OUT`                                 |
| `lib/brand.mjs`    | brand.mjs — identité visuelle d'un rapport (logo, nom, couleurs). | —                                                                                                  | —                                     |
| `lib/report.mjs`   | report.mjs — bibliothèque de rendu de RAPPORTS HTML autonomes.    | `--accent` `--bg` `--card` `--dim` `--fg` `--line` `--note-bg` `--note-fg` `--warn-bg` `--warn-fg` | `CSS` `PRINT_JS` `SORT_JS` `THEME_JS` |

**Invocation telle que documentée dans chaque script :**

```bash
node .claude/skills/nodefony-html-report/scripts/demo.mjs tmp/demo.html
```

**Toutes les variables lues par ce skill** : `CSS` · `OUT` · `PRINT_JS` · `SORT_JS` · `THEME_JS`

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 935    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 174    |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-html-report/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

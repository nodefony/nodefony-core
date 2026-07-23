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

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _AAIF / Linux Foundation_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **1/1** projet · 💡 **1/1** recommandé (SHOULD).

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

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier                    | Ce qu'il couvre                          | Lignes |
| -------------------------- | ---------------------------------------- | -----: |
| `references/ergonomie.md`  | Ergonomie, dataviz, accessibilité        |    122 |
| `references/html-vs-md.md` | HTML ou Markdown ? Ce que dit le terrain |    125 |
| `references/print-pdf.md`  | Impression & PDF — la mécanique          |    235 |

_(+ 6 fichiers dans des sous-dossiers : specs et normes bundlées hors ligne.)_

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

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** (AAIF / Linux Foundation).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle                                    |   Nature    | État | Mesure | Règle (source)                                                                                                                           |
| ------------------------------------------- | :---------: | :--: | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| name conforme et égal au dossier            | ℹ️ normatif |  ✅  |        | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier                                   |
| description de 1 à 1024 caractères          | ℹ️ normatif |  ✅  | 935    | spec § description : 1-1024 car., non vide (quoi + quand)                                                                                |
| aucun champ hors standard                   | ℹ️ normatif |  ✅  |        | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif |  ✅  | absent | spec § compatibility : 1-500 car. si fourni                                                                                              |
| dossier de ressources nommé `references/`   | ℹ️ normatif |  ✅  |        | spec § resources : le dossier de détail se nomme `references/` (pluriel)                                                                 |
| aucun renvoi vers un skill inexistant       |   projet    |  ✅  |        | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide                                                                   |
| corps < 500 lignes                          | recommandé  |  ✅  | 174    | best-practices : corps court (index) + détail en `references/` (divulgation progressive)                                                 |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-html-report/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

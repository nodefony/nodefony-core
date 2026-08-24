---
title: "nodefony-html-report — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-08-24
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-html-report/SKILL.md"
---

# `nodefony-html-report`

> Fabrique des rapports HTML autonomes (zéro CDN) pour des humains qui doivent DÉCIDER — audits, bancs de performance, revues, dashboards figés.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-html-report**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **2/2** projet · 💡 **1/1** recommandé (SHOULD).

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | — (non versionné) |
| Famille | Références et livrables |
| Corps | 325 lignes |
| Coût d'activation | ~4 775 tokens (le corps est chargé à l'invocation) |
| Description | 1000 / 1024 caractères |
| Déclencheurs | 13 |
| Ressources `references/` | 3 page(s), 13 fichiers au total |
| Scripts | 8 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Fabrique des rapports HTML autonomes (zéro CDN) pour des humains qui doivent DÉCIDER — audits, bancs de performance, revues, dashboards figés. Deux moteurs de figures : `lib/report.mjs` (tableaux triables et filtrables, calculateurs interactifs, onglets, export CSV, impression PDF soignée) et `lib/echarts.mjs`, qui rend CÔTÉ SERVEUR en SVG statique — sans un octet de JavaScript servi, en thème clair ET sombre — barres avec étendue, courbes à deux axes alignés, nuages, boîtes à moustaches, Sankey, radars, cartes de chaleur, arbres pondérés, entonnoirs, cascades, jauges, graphes de relations. `lib/schemas.mjs` dessine les organigrammes et diagrammes de séquence mermaid sans toucher à leur source.

## Prérequis

Ce que le décor doit fournir pour que ses scripts disent quelque chose : **redis** · **base de données**.

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`rapport HTML` · `rapport imprimable` · `dashboard statique` · `restituer des mesures` · `quel graphe choisir` · `diagramme de Sankey` · `boîtes à moustaches` · `deux axes` · `échelle d'un graphe` · `rendre un schéma mermaid` · `calculateur interactif` · `deck de présentation` · `export CSV`

## Ce que contient le corps

- Quand l'utiliser — et quand NE PAS
- Règle d'or
- Processus (5 étapes)
- La bibliothèque — `lib/report.mjs`
- Le moteur de graphes — `lib/echarts.mjs`
- Les schémas mermaid — `lib/schemas.mjs`
- Éprouver le moteur
- La marque (logo)
- Checklist qualité (à passer AVANT de livrer)
- Anti-patterns
- Index des références (charger à la demande)
- Exemple vivant

## Références (chargées à la demande)

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/ergonomie.md` | Ergonomie, dataviz, accessibilité | 122 |
| `references/html-vs-md.md` | HTML ou Markdown ? Ce que dit le terrain | 125 |
| `references/print-pdf.md` | Impression & PDF — la mécanique | 236 |

_(+ 10 fichiers dans des sous-dossiers : specs et normes bundlées hors ligne.)_

## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script | Rôle | Options | Variables d'environnement |
| --- | --- | --- | --- |
| `scripts/demo.mjs` | demo.mjs — vitrine ET test de non-régression de `lib/report.mjs`. | `--accent` | `OUT` |
| `scripts/echarts.selftest.mjs` | Auto-contrôle du moteur de graphes ECharts — les CONTRATS, pas l'esthétique. | `--prove` | — |
| `scripts/formats.selftest.mjs` | Auto-contrôle des FORMATS d'un rapport et du tri de ses tableaux. | — | — |
| `lib/brand.mjs` | brand.mjs — identité visuelle d'un rapport (logo, nom, couleurs). | — | — |
| `lib/echarts.mjs` | Moteur de graphes **Apache ECharts** rendu CÔTÉ SERVEUR, en SVG statique. | `--muted` | — |
| `lib/report-echarts.mjs` | **Adaptateurs** — les fonctions de `report.mjs`, rendues par ECharts. | — | — |
| `lib/report.mjs` | report.mjs — bibliothèque de rendu de RAPPORTS HTML autonomes. | `--accent` `--bg` `--card` `--dim` `--fg` `--line` `--note-bg` `--note-fg` `--warn-bg` `--warn-fg` | `CSS` `PRINT_JS` `SORT_JS` `THEME_JS` |
| `lib/schemas.mjs` | Les **SCHÉMAS** de la documentation — organigrammes et diagrammes de séquence | — | `HAUT` `MARGE` `POLICE` |

**Invocation telle que documentée dans chaque script :**

```bash
node .claude/skills/nodefony-html-report/scripts/demo.mjs tmp/demo.html
node .claude/skills/nodefony-html-report/scripts/echarts.selftest.mjs
node .claude/skills/nodefony-html-report/scripts/formats.selftest.mjs
```

**Toutes les variables lues par ce skill** : `CSS` · `HAUT` · `MARGE` · `OUT` · `POLICE` · `PRINT_JS` · `SORT_JS` · `THEME_JS`

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 1000 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| corps < 500 lignes | recommandé | ✅ | 325 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-html-report/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

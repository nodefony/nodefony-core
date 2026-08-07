---
title: "nodefony-studio-dev — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-08-07
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-studio-dev/SKILL.md"
---

# `nodefony-studio-dev`

> Kit de dev du frontend Studio de Nodefony (@nodefony/studio, React 19) — l'app admin interne du framework.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-studio-dev**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **2/2** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v2.0.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `2.0.0` |
| Famille | Développer le framework |
| Corps | 143 lignes |
| Coût d'activation | ~3 608 tokens (le corps est chargé à l'invocation) |
| Description | 935 / 1024 caractères |
| Déclencheurs | 14 |
| Ressources `references/` | 6 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Kit de dev du frontend Studio de Nodefony (@nodefony/studio, React 19) — l'app admin interne du framework. Construire un écran (page / dashboard / panneau / onglet) vite et bien en réutilisant le UI kit (PageHeader, PageLayout, DataGrid, DataState, StatCard, KpiCard, JsonViewer, MiniChart, DocHint), le hook useResource, les stores MobX et les hooks temps réel nodefony/react. Donne la recette (route + lazy + navConfig + fallback deep-link + data plane), des squelettes copier-coller, le Jumeau Vivant (Twin), la debug bar, le back-end Studio (controller + data plane + realtime), et les règles qualité (a11y, sécu, perf, gate tsc). DÉRIVE de nodefony-frontend-dev (mécanismes front généraux).

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`browser`](nodefony-browser.md) · [`create-frontend-module`](nodefony-create-frontend-module.md) · [`documentation`](nodefony-documentation.md) · [`framework-dev`](nodefony-framework-dev.md) · [`frontend-dev`](nodefony-frontend-dev.md) · [`rfc`](nodefony-rfc.md) · [`security-review`](nodefony-security-review.md) · [`start-server`](nodefony-start-server.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`dev studio` · `page studio` · `dashboard studio` · `écran studio` · `panneau studio` · `composant studio` · `page /nodefony` · `comment coder dans studio` · `Twin` · `jumeau vivant` · `debug bar` · `debugbar` · `barre de debug` · `WDT`

## Ce que contient le corps

- 🔗 Paire POLYMORPHE front ⇄ back (co-évolution OBLIGATOIRE)
- 1. Quand l'utiliser / quand passer la main
- 2. 🚨 RÈGLES ABSOLUES Studio (non négociables — priorité MAX)
- 3. Cartographie — Studio (qui vit où)
- 4. Référence — `references/` (chargé À LA DEMANDE)
- 5. Gates qualité (AVANT commit — l'ordre compte)
- Réfs (CLAUDE.md/MEMORY.md — détails)

## Références (chargées à la demande)

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/backend-studio.md` | Référence — Back-end Studio (controller · data plane · auth · realtime serveur) | 104 |
| `references/debugbar.md` | Référence — Debug bar Nodefony (nodefony/debugbar) | 43 |
| `references/gotchas-studio.md` | Gotchas Studio — règles durables (par thème) | 399 |
| `references/realtime-studio.md` | Référence — Realtime Studio (canaux · hub UI · log protocole · patron sondes) | 123 |
| `references/twin.md` | Référence — Jumeau Vivant (Twin) | 77 |
| `references/ui-kit.md` | Référence — UI kit Studio & construction d'écran | 372 |


## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 935 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| corps < 500 lignes | recommandé | ✅ | 143 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-studio-dev/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

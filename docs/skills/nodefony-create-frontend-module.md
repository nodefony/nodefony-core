---
title: "nodefony-create-frontend-module — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-create-frontend-module/SKILL.md"
---

# `nodefony-create-frontend-module`

> Scaffold d'un module à frontend SPA (React 19, Vue 3, Angular 21) servi par @nodefony/frontend via Vite, DANS LE REPO FRAMEWORK (src/modules/).

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-create-frontend-module**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _AAIF / Linux Foundation_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **1/1** projet · 💡 **1/1** recommandé (SHOULD).

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | — (non versionné) |
| Famille | Développer le framework |
| Corps | 247 lignes |
| Coût d'activation | ~3 770 tokens (le corps est chargé à l'invocation) |
| Description | 642 / 1024 caractères |
| Déclencheurs | 7 |
| Ressources `references/` | 1 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Scaffold d'un module à frontend SPA (React 19, Vue 3, Angular 21) servi par @nodefony/frontend via Vite, DANS LE REPO FRAMEWORK (src/modules/). Dans une APPLICATION, le scaffold est une commande — `nodefony create module <nom> --frontend <fw>` — et ce skill se contente d'y renvoyer : il ne réimplémente pas le CLI. Wrapper de nodefony-create-module : délègue le squelette puis enrichit le spécifique frontend (controller HTML+CSP, registerEntry, entry+App du framework, peerDeps).

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`create-module`](nodefony-create-module.md) · [`start-server`](nodefony-start-server.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`crée un module frontend` · `module react` · `module vue` · `module angular` · `scaffold module avec front` · `nouveau front nodefony` · `module vite`

## Ce que contient le corps

- 🚦 DEUX CAS — ne pas confondre (lire AVANT toute génération)
- Quand l'utiliser
- Phase 0 — Choisir le framework + variables
- Table de paramètres par framework (LE cœur)
- Pré-requis
- Phase 1 — Déléguer à `nodefony-create-module`
- Phase 2 — Enrichissements (POST-`nodefony-create-module`)
- Phase 3 — Build + validation
- Phase 4 (OPT-IN) — Module DISTRIBUÉ npm : UI pré-buildée (molette `ui`)
- Checklist finale
- Pièges communs (les 3 frameworks)
- Skills & références liés

## Références (chargées à la demande)

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/frameworks.md` | Spécifique par framework — nodefony-create-frontend-module | 247 |


## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** (AAIF / Linux Foundation).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 642 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| corps < 500 lignes | recommandé | ✅ | 247 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-create-frontend-module/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

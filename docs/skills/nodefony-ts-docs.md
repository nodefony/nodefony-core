---
title: "nodefony-ts-docs — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-ts-docs/SKILL.md"
---

# `nodefony-ts-docs`

> Consulte la doc officielle TypeScript (utility types, handbook, do's and don'ts) et les types Node.js (@types/node DefinitelyTyped) via sources brutes raw GitHub + proxy r.jina.ai, jamais typescriptlang.org (JS lourd).

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-ts-docs**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _AAIF / Linux Foundation_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **1/1** projet · 💡 **1/1** recommandé (SHOULD).

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | — (non versionné) |
| Famille | Références et livrables |
| Corps | 66 lignes |
| Coût d'activation | ~681 tokens (le corps est chargé à l'invocation) |
| Description | 376 / 1024 caractères |
| Déclencheurs | 8 |
| Ressources `references/` | 0 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Consulte la doc officielle TypeScript (utility types, handbook, do's and don'ts) et les types Node.js (@types/node DefinitelyTyped) via sources brutes raw GitHub + proxy r.jina.ai, jamais typescriptlang.org (JS lourd).

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`comment typer X` · `utility type` · `Pick/Omit/ReturnType` · `@types/node` · `NodeJS.Timeout` · `TS handbook` · `mapped types` · `conditional type`

## Ce que contient le corps

- Règle d'or
- Sources canoniques
- Pattern d'usage
- Anti-patterns à éviter

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** (AAIF / Linux Foundation).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 376 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| corps < 500 lignes | recommandé | ✅ | 66 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-ts-docs/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

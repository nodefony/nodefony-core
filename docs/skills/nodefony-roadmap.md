---
title: "nodefony-roadmap — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-roadmap/SKILL.md"
---

# `nodefony-roadmap`

> Charge le contexte roadmap des phases Studio/IA/Realtime/Frontend de Nodefony — Phase 10 (Studio admin web — LIVRÉ, conventions à respecter), 12 (couche IA agentic — SEULE vraie phase future), 13 (Realtime + Redis cluster + client navigateur — quasi livré, restes identifiés), 14 (frontend builder Vite — LIVRÉ).

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-roadmap**

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
| Corps                    | 161 lignes                                         |
| Coût d'activation        | ~2 821 tokens (le corps est chargé à l'invocation) |
| Description              | 614 / 1024 caractères                              |
| Déclencheurs             | 13                                                 |
| Ressources `references/` | 0 page(s)                                          |
| Scripts                  | 0                                                  |
| Conformité               | ✅ conforme au standard                            |

## Ce qu'il fait

Charge le contexte roadmap des phases Studio/IA/Realtime/Frontend de Nodefony — Phase 10 (Studio admin web — LIVRÉ, conventions à respecter), 12 (couche IA agentic — SEULE vraie phase future), 13 (Realtime + Redis cluster + client navigateur — quasi livré, restes identifiés), 14 (frontend builder Vite — LIVRÉ). À utiliser quand un module doit prévoir une API admin, un design IA-compatible ou un endpoint Studio.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`create-frontend-module`](nodefony-create-frontend-module.md) · [`studio-dev`](nodefony-studio-dev.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`Studio` · `Phase 10` · `Phase 12` · `Phase 13` · `Phase 14` · `couche IA` · `agentic` · `@nodefony/agent` · `@nodefony/realtime` · `@nodefony/client` · `API admin` · `route /nodefony` · `AI Act`

## Ce que contient le corps

- Phase 10 — Module `@nodefony/studio` — ✅ LIVRÉ (conventions toujours actives)
- Phase 12 — Couche IA agentic — ⬜ SEULE VRAIE PHASE FUTURE (après P6)
- Phase 13 — Realtime + Redis cluster + Client navigateur — 🔶 QUASI LIVRÉ
- Phase 14 — `@nodefony/frontend` (builder Vite) — ✅ LIVRÉ
- Pattern d'usage
- Anti-patterns à éviter

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** (AAIF / Linux Foundation).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle                                    |   Nature    | État | Mesure | Règle (source)                                                                                                                           |
| ------------------------------------------- | :---------: | :--: | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| name conforme et égal au dossier            | ℹ️ normatif |  ✅  |        | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier                                   |
| description de 1 à 1024 caractères          | ℹ️ normatif |  ✅  | 614    | spec § description : 1-1024 car., non vide (quoi + quand)                                                                                |
| aucun champ hors standard                   | ℹ️ normatif |  ✅  |        | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif |  ✅  | absent | spec § compatibility : 1-500 car. si fourni                                                                                              |
| dossier de ressources nommé `references/`   | ℹ️ normatif |  ✅  |        | spec § resources : le dossier de détail se nomme `references/` (pluriel)                                                                 |
| aucun renvoi vers un skill inexistant       |   projet    |  ✅  |        | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide                                                                   |
| corps < 500 lignes                          | recommandé  |  ✅  | 161    | best-practices : corps court (index) + détail en `references/` (divulgation progressive)                                                 |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-roadmap/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

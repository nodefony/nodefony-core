---
title: "nodefony-framework-dev — fiche de skill"
lang: fr
audience: humain
generated: scripts/skills-doc.mjs
source: ".claude/skills/nodefony-framework-dev/SKILL.md"
---

# `nodefony-framework-dev`

> Kit de dev du CŒUR backend de Nodefony — core (`nodefony`), `@nodefony/http` (pipeline, serveurs, WS, sessions, certificats), `@nodefony/framework` (Router, Controller, décorateurs).

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-framework-dev**

> [!NOTE]
> Fiche **générée** par `scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                                 |
| ------------------------ | ------------------------------- |
| Version                  | `2.0.0`                         |
| Corps                    | 294 lignes                      |
| Description              | 1007 / 1024 caractères          |
| Déclencheurs             | 23                              |
| Ressources `references/` | 8 page(s), 81 fichiers au total |
| Scripts                  | 0                               |
| Conformité               | ✅ conforme au standard         |

## Ce qu'il fait

Kit de dev du CŒUR backend de Nodefony — core (`nodefony`), `@nodefony/http` (pipeline, serveurs, WS, sessions, certificats), `@nodefony/framework` (Router, Controller, décorateurs). Couvre : créer un service injectable, un module, une commande CLI, une entité/repository/adapter ORM, un endpoint HTTP/WS ou un data plane admin, et le realtime. Donne les règles absolues (perf-mémoire, TS strict, lazy alloc, cleanup des listeners, ALS), les conventions de structure et de configuration, des recettes vérifiées sur le source, les gotchas et les RFC bundlées hors ligne.

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`dev core` · `coder dans le kernel` · `pipeline http` · `créer un service` · `service injectable` · `module hooks` · `commande CLI` · `controller nodefony` · `décorateur route` · `créer une entité` · `repository` · `adapter ORM` · `data plane` · `certificats TLS` · `realtime` · `WebSocket` · `firewall` · `@IsGranted` · `@Idempotent` · `structure d'un module` · `defineConfig` · `avant de coder dans le cœur` · `où brancher ce comportement ?`

## Ce que contient le corps

- 🔗 Paire POLYMORPHE back ⇄ front (co-évolution OBLIGATOIRE)
- 1. Quand l'utiliser / quand passer la main
- 2. 🚨 RÈGLES ABSOLUES (non négociables — priorité MAX)
- 3. Cartographie — qui vit où
- 4. Recettes & référence — `references/` (chargé À LA DEMANDE)
- 5. Gates qualité (AVANT commit — l'ordre compte)
- Réfs (CLAUDE.md/MEMORY.md — détails)

## Références (chargées à la demande)

- `references/conventions.md`
- `references/core.md`
- `references/framework.md`
- `references/gotchas.md`
- `references/http.md`
- `references/orm.md`
- `references/realtime.md`
- `references/security.md`
- _(+ 73 fichiers dans des sous-dossiers : specs et normes bundlées hors ligne)_

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 1007   |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 294    |

Le détail du standard et la méthode de mesure : [Outillage agents](../outillage-agents.md).

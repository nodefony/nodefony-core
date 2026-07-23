---
title: "nodefony-framework-dev — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-framework-dev/SKILL.md"
---

# `nodefony-framework-dev`

> Kit de dev du CŒUR backend de Nodefony — core (`nodefony`), `@nodefony/http` (pipeline, serveurs, WS, sessions, certificats), `@nodefony/framework` (Router, Controller, décorateurs).

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-framework-dev**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _AAIF / Linux Foundation_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **1/1** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v2.0.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `2.0.0` |
| Famille | Développer le framework |
| Corps | 299 lignes |
| Coût d'activation | ~6 399 tokens (le corps est chargé à l'invocation) |
| Description | 1007 / 1024 caractères |
| Déclencheurs | 23 |
| Ressources `references/` | 8 page(s), 81 fichiers au total |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Kit de dev du CŒUR backend de Nodefony — core (`nodefony`), `@nodefony/http` (pipeline, serveurs, WS, sessions, certificats), `@nodefony/framework` (Router, Controller, décorateurs). Couvre : créer un service injectable, un module, une commande CLI, une entité/repository/adapter ORM, un endpoint HTTP/WS ou un data plane admin, et le realtime. Donne les règles absolues (perf-mémoire, TS strict, lazy alloc, cleanup des listeners, ALS), les conventions de structure et de configuration, des recettes vérifiées sur le source, les gotchas et les RFC bundlées hors ligne.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`check-externals`](nodefony-check-externals.md) · [`check-memory-health`](nodefony-check-memory-health.md) · [`create-frontend-module`](nodefony-create-frontend-module.md) · [`create-module`](nodefony-create-module.md) · [`frontend-dev`](nodefony-frontend-dev.md) · [`inspect`](nodefony-inspect.md) · [`load-test`](nodefony-load-test.md) · [`rfc`](nodefony-rfc.md) · [`roadmap`](nodefony-roadmap.md) · [`security-review`](nodefony-security-review.md) · [`start-server`](nodefony-start-server.md) · [`studio-dev`](nodefony-studio-dev.md) · [`tail-error-logs`](nodefony-tail-error-logs.md) · [`ts-docs`](nodefony-ts-docs.md)

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

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/conventions.md` | Conventions de structure — modules, types, configuration | 216 |
| `references/core.md` | Core (nodefony) — référence complète (recettes + API + internals + gotchas) | 713 |
| `references/framework.md` | @nodefony/framework (Router/Controller/admin) — référence complète (recettes + API + internals + gotchas) | 542 |
| `references/gotchas.md` | Gotchas & diagnostic — règles durables (vérité courante) | 94 |
| `references/http.md` | @nodefony/http (pipeline/serveurs/WS/TLS) — référence complète (recettes + API + internals + gotchas) | 586 |
| `references/orm.md` | ORM (orm-core/drizzle/mongoose) — référence complète (recettes + API + internals + gotchas) | 638 |
| `references/realtime.md` | Realtime (WS/hub/RealtimeService) — référence complète (recettes + API + internals + gotchas) | 580 |
| `references/security.md` | Référence SÉCURITÉ (coder AVEC la sécurité) — intemporel | 67 |

_(+ 73 fichiers dans des sous-dossiers : specs et normes bundlées hors ligne.)_

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** (AAIF / Linux Foundation).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 1007 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| corps < 500 lignes | recommandé | ✅ | 299 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-framework-dev/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

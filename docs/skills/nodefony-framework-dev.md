---
title: "nodefony-framework-dev — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-30
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-framework-dev/SKILL.md"
---

# `nodefony-framework-dev`

> Kit de dev du CŒUR backend de Nodefony : core (`nodefony`), `@nodefony/http` (pipeline, serveurs, WS, sessions), `@nodefony/framework` (Router, Controller, décorateurs) et les modules (services, stores, ORM).

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-framework-dev**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **1/1** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v2.0.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `2.0.0` |
| Famille | Développer le framework |
| Corps | 355 lignes |
| Coût d'activation | ~7 507 tokens (le corps est chargé à l'invocation) |
| Description | 980 / 1024 caractères |
| Déclencheurs | 17 |
| Ressources `references/` | 9 page(s), 82 fichiers au total |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Kit de dev du CŒUR backend de Nodefony : core (`nodefony`), `@nodefony/http` (pipeline, serveurs, WS, sessions), `@nodefony/framework` (Router, Controller, décorateurs) et les modules (services, stores, ORM). À charger DÈS qu'une tâche va ÉDITER du code backend, avant la première modification : porte les règles absolues (perf-mémoire, TS strict, lazy alloc, cleanup listeners, ALS), les conventions de structure/config, les recettes vérifiées au source, les gotchas et les RFC hors ligne.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`check-externals`](nodefony-check-externals.md) · [`check-memory-health`](nodefony-check-memory-health.md) · [`create-frontend-module`](nodefony-create-frontend-module.md) · [`create-module`](nodefony-create-module.md) · [`frontend-dev`](nodefony-frontend-dev.md) · [`inspect`](nodefony-inspect.md) · [`load-test`](nodefony-load-test.md) · [`rfc`](nodefony-rfc.md) · [`roadmap`](nodefony-roadmap.md) · [`security-review`](nodefony-security-review.md) · [`start-server`](nodefony-start-server.md) · [`studio-dev`](nodefony-studio-dev.md) · [`tail-error-logs`](nodefony-tail-error-logs.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`modifier du code backend` · `coder dans le kernel` · `toucher au cœur ou au pipeline` · `créer un service injectable/module/controller` · `commande CLI` · `entité/repository/adapter ORM` · `store et pagination` · `listPage/contrat IPage` · `endpoint HTTP/WS ou data plane admin` · `décorateur route` · `@IsGranted/@Idempotent` · `realtime/WebSocket` · `firewall` · `certificats TLS` · `structure d'un module` · `defineConfig` · `où brancher ce comportement ?`

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
| `references/core.md` | Core (nodefony) — référence complète (recettes + API + internals + gotchas) | 721 |
| `references/framework.md` | @nodefony/framework (Router/Controller/admin) — référence complète (recettes + API + internals + gotchas) | 567 |
| `references/gotchas.md` | Gotchas & diagnostic — règles durables (vérité courante) | 94 |
| `references/http.md` | @nodefony/http (pipeline/serveurs/WS/TLS) — référence complète (recettes + API + internals + gotchas) | 586 |
| `references/orm.md` | ORM (orm-core/drizzle/mongoose) — référence complète (recettes + API + internals + gotchas) | 683 |
| `references/portabilite.md` | Portabilité — écrire du code qui tourne sur les 3 plateformes | 141 |
| `references/realtime.md` | Realtime (WS/hub/RealtimeService) — référence complète (recettes + API + internals + gotchas) | 593 |
| `references/security.md` | Référence SÉCURITÉ (coder AVEC la sécurité) — intemporel | 67 |

_(+ 73 fichiers dans des sous-dossiers : specs et normes bundlées hors ligne.)_

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 980 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| corps < 500 lignes | recommandé | ✅ | 355 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-framework-dev/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

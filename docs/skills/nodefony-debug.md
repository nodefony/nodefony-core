---
title: "nodefony-debug — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-08-03
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-debug/SKILL.md"
---

# `nodefony-debug`

> Kit debug runtime de Nodefony — à charger quand quelque chose vient de casser, pas pour concevoir.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-debug**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **2/2** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v1.1.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `1.1.0` |
| Famille | Exécuter, diagnostiquer, mesurer |
| Corps | 254 lignes |
| Coût d'activation | ~4 165 tokens (le corps est chargé à l'invocation) |
| Description | 990 / 1024 caractères |
| Déclencheurs | 18 |
| Ressources `references/` | 0 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Kit debug runtime de Nodefony — à charger quand quelque chose vient de casser, pas pour concevoir. Codifie les recettes de diagnostic éprouvées : flake mémoire (l'isolation dit la vérité), vert en isolation et rouge en suite (ressource partagée, pas régression), qualifier une régression par une baseline stashée, échec d'intégration dont la première hypothèse est un serveur éteint, dépendance implicite à `delete`, faux ENOSPC du harnais. Délègue à `nodefony-tail-error-logs`, `nodefony-check-memory-health`, `nodefony-load-test`, `nodefony-frontend-dev` ; la doctrine préventive vit dans `nodefony-framework-dev`.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`check-memory-health`](nodefony-check-memory-health.md) · [`framework-dev`](nodefony-framework-dev.md) · [`frontend-dev`](nodefony-frontend-dev.md) · [`inspect`](nodefony-inspect.md) · [`load-test`](nodefony-load-test.md) · [`start-server`](nodefony-start-server.md) · [`studio-dev`](nodefony-studio-dev.md) · [`tail-error-logs`](nodefony-tail-error-logs.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`ça crash` · `stack trace` · `unhandledRejection` · `fuite mémoire` · `memory leak` · `race condition` · `reproduire` · `ne démarre plus` · `test rouge inexpliqué` · `test flake` · `vert isolé rouge en suite` · `ce test passe seul mais pas en suite` · `diagnostic régression` · `baseline stash` · `est-ce ma régression ?` · `404 inexpliqué` · `ECONNREFUSED tests` · `ENOSPC`

## Ce que contient le corps

- 1. Quand m'utiliser
- 2. Quand passer la main (anti-overlap)
- 3. Les recettes éprouvées
- 4. Orchestration des skills voisins
- 5. Doctrine "memory may lie" (CLAUDE.md global)
- 6. Références (anti-duplication, vérité unique)
- 7. Conventions du skill

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 990 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| corps < 500 lignes | recommandé | ✅ | 254 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-debug/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

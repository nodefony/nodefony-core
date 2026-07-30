---
title: "nodefony-devkit-bench — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-30
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-devkit-bench/SKILL.md"
---

# `nodefony-devkit-bench`

> Éprouve ce que le scaffold de Nodefony PRODUIT, par trois mesures — le code généré tient-il debout (compilation, tests, HTTP réel), un agent lâché dans une application fraîche découvre-t-il l'outillage au lieu de deviner, et le modèle de données d'un vrai logiciel libre est-il exprimable avec la grammaire de champs.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-devkit-bench**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **1/1** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v1.2.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `1.2.0` |
| Famille | Autres |
| Corps | 381 lignes |
| Coût d'activation | ~5 677 tokens (le corps est chargé à l'invocation) |
| Description | 1016 / 1024 caractères |
| Déclencheurs | 0 |
| Ressources `references/` | 0 page(s) |
| Scripts | 5 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Éprouve ce que le scaffold de Nodefony PRODUIT, par trois mesures — le code généré tient-il debout (compilation, tests, HTTP réel), un agent lâché dans une application fraîche découvre-t-il l'outillage au lieu de deviner, et le modèle de données d'un vrai logiciel libre est-il exprimable avec la grammaire de champs. Vise DEUX buts : que l'agent n'invente rien qu'un générateur produise, et qu'il y arrive en un minimum de TOURS (tours, durée et coût sont dans le transcript). À charger AVANT de déclarer finie une évolution des gabarits ou du moteur de génération : les assertions du dépôt lisent des chaînes dans des fichiers rendus, elles ne voient pas qu'un type généré ne compile pas. Porte l'interprétation des échecs et l'auto-contrôle des juges. Déclencheurs - "j'ai modifié le scaffold", "le code généré compile-t-il ?", "est-ce que create entity marche encore ?", "rejouer le banc devkit", "l'agent trouve-t-il les générateurs ?", "un vrai schéma est-il exprimable ?", "combien de tours a pris l'agent ?".

## Prérequis

Ce que le décor doit fournir pour que ses scripts disent quelque chose : **serveur UP** · **base de données** · **docker** · **redis**.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`framework-dev`](nodefony-framework-dev.md) · [`load-test`](nodefony-load-test.md) · [`release`](nodefony-release.md) · [`skill`](nodefony-skill.md)

## Ce que contient le corps

- Les DEUX buts — ne pas inventer, et ne pas tourner en rond
- Pourquoi trois bancs, et pas un
- Ce que les tests du dépôt ne peuvent pas prouver
- Banc de vérité — le code généré tient-il debout ?
- Banc de découvrabilité — l'agent trouve-t-il ?
- Banc de schéma — un vrai modèle de données est-il exprimable ?
- Interpréter un échec — commencer par le décor
- Quand les lancer
- Quand passer la main

## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script | Rôle | Options | Variables d'environnement |
| --- | --- | --- | --- |
| `scripts/bench-discoverability.mjs` | Banc de DÉCOUVRABILITÉ du devkit — les 9 tâches (gate de la release 10.0.0). | `--allow-empty` `--analyze-only` `--command` `--dangerously-skip-permissi` `--describe-json` `--detach` `--dir` `--dry-run` `--format` `--frontend` `--help` `--json` `--kind` `--left` `--link` `--model` `--name-only` `--no-audit` `--no-fund` `--no-install` `--output-format` `--preset` `--repack` `--setup-only` `--task` `--unified` `--verbose` `--wait` `--yes` | `LINKED` `NF_DEVKIT_BENCH_AGENT` `NF_DEVKIT_BENCH_AGENT_ARGS` `NF_DEVKIT_BENCH_MODEL` |
| `scripts/bench-discoverability.selftest.mjs` | Auto-contrôle des sondes du banc de découvrabilité — le juge, AVANT le verdict. | `--describe-json` `--dry-run` `--help` `--json` `--kind` `--prove` | — |
| `scripts/bench-schema.mjs` | Banc de SCHÉMA — ce que la grammaire de champs ne sait pas exprimer. | `--allow-empty` `--analyze-only` `--dangerously-skip-permissi` `--detach` `--dialect` `--dir` `--dump-only` `--frontend` `--jq` `--json` `--link` `--model` `--no-audit` `--no-fund` `--no-install` `--output-format` `--preset` `--repack` `--schema` `--schema-only` `--setup-only` `--verbose` `--wait` `--yes` | `AGENT` `DIALECT` `LINKED` `MODEL` `NF_DEVKIT_BENCH_AGENT` `NF_DEVKIT_BENCH_AGENT_ARGS` `NF_DEVKIT_BENCH_MODEL` `NF_MYSQL_URL` `NF_PG_URL` |
| `scripts/bench-schema.selftest.mjs` | Éprouve le BANC lui-même — avant qu'il ne juge quoi que ce soit. | `--allow-no-pg` `--dump-only` `--prove` `--schema` | `JUDGE_TABLE` `NF_PG_URL` |
| `scripts/verify-generated.mjs` | Banc de VÉRITÉ du code généré — « ce que le scaffold produit tient-il debout ? » | `--controller` `--detach` `--dialect` `--frontend` `--index` `--json` `--keep` `--link` `--module` `--no-audit` `--no-controller` `--no-e2e` `--no-fund` `--no-tests` `--preset` `--unique` `--wait` `--yes` | `APP` `MODULE` `MODULE_PKG` |

**Invocation telle que documentée dans chaque script :**

```bash
node bench-discoverability.selftest.mjs
node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.selftest.mjs
node scripts/devkit-verify.mjs              # décor + toutes les étapes
```

**Toutes les variables lues par ce skill** : `AGENT` · `APP` · `DIALECT` · `JUDGE_TABLE` · `LINKED` · `MODEL` · `MODULE` · `MODULE_PKG` · `NF_DEVKIT_BENCH_AGENT` · `NF_DEVKIT_BENCH_AGENT_ARGS` · `NF_DEVKIT_BENCH_MODEL` · `NF_MYSQL_URL` · `NF_PG_URL`

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 1016 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| corps < 500 lignes | recommandé | ✅ | 381 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-devkit-bench/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

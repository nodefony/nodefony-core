---
title: "nodefony-devkit-bench — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-27
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-devkit-bench/SKILL.md"
---

# `nodefony-devkit-bench`

> Éprouve ce que le scaffold de Nodefony PRODUIT, par deux mesures — le code généré tient-il debout (il compile, ses tests passent, sa ressource répond vraiment en HTTP), et un agent lâché dans une application fraîche découvre-t-il l'outillage au lieu de deviner.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-devkit-bench**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **1/1** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v1.0.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `1.0.0` |
| Famille | Autres |
| Corps | 200 lignes |
| Coût d'activation | ~3 079 tokens (le corps est chargé à l'invocation) |
| Description | 939 / 1024 caractères |
| Déclencheurs | 0 |
| Ressources `references/` | 0 page(s) |
| Scripts | 2 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Éprouve ce que le scaffold de Nodefony PRODUIT, par deux mesures — le code généré tient-il debout (il compile, ses tests passent, sa ressource répond vraiment en HTTP), et un agent lâché dans une application fraîche découvre-t-il l'outillage au lieu de deviner. À charger AVANT de déclarer finie une évolution des gabarits, de la grammaire de champs, du moteur de génération ou du contrat de ressource : les assertions du dépôt lisent des chaînes dans des fichiers rendus, elles ne voient pas qu'un échantillon viole son propre schéma, qu'une relation déclarée fait lever l'ORM au démarrage, ou qu'un type généré ne compile pas. Porte l'interprétation des échecs et les pièges de décor. Déclencheurs - "j'ai modifié le scaffold", "le code généré compile-t-il ?", "est-ce que create entity marche encore ?", "rejouer le banc devkit", "l'agent trouve-t-il les générateurs ?", "prouver qu'une vague devkit est finie", "tester une app témoin".

## Prérequis

Ce que le décor doit fournir pour que ses scripts disent quelque chose : **serveur UP** · **base de données**.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`framework-dev`](nodefony-framework-dev.md) · [`load-test`](nodefony-load-test.md) · [`release`](nodefony-release.md) · [`skill`](nodefony-skill.md)

## Ce que contient le corps

- Pourquoi deux bancs, et pas un
- Ce que les tests du dépôt ne peuvent pas prouver
- Banc de vérité — le code généré tient-il debout ?
- Banc de découvrabilité — l'agent trouve-t-il ?
- Interpréter un échec — commencer par le décor
- Quand les lancer
- Quand passer la main

## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script | Rôle | Options | Variables d'environnement |
| --- | --- | --- | --- |
| `scripts/bench-discoverability.mjs` | Banc de DÉCOUVRABILITÉ du devkit — les 9 tâches (gate de la release 10.0.0). | `--allow-empty` `--analyze-only` `--command` `--dangerously-skip-permissi` `--describe-json` `--detach` `--dir` `--dry-run` `--format` `--frontend` `--help` `--json` `--kind` `--left` `--link` `--model` `--name-only` `--no-audit` `--no-fund` `--output-format` `--preset` `--setup-only` `--task` `--unified` `--verbose` `--wait` `--yes` | `DEVKIT_BENCH_AGENT` `DEVKIT_BENCH_AGENT_ARGS` `DEVKIT_BENCH_MODEL` |
| `scripts/verify-generated.mjs` | Banc de VÉRITÉ du code généré — « ce que le scaffold produit tient-il debout ? » | `--detach` `--dialect` `--frontend` `--index` `--json` `--keep` `--link` `--no-audit` `--no-controller` `--no-e2e` `--no-fund` `--no-tests` `--preset` `--unique` `--wait` `--yes` | `APP` |

**Invocation telle que documentée dans chaque script :**

```bash
node scripts/devkit-verify.mjs              # décor + toutes les étapes
```

**Toutes les variables lues par ce skill** : `APP` · `DEVKIT_BENCH_AGENT` · `DEVKIT_BENCH_AGENT_ARGS` · `DEVKIT_BENCH_MODEL`

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 939 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| corps < 500 lignes | recommandé | ✅ | 200 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-devkit-bench/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

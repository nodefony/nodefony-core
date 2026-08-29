---
title: "nodefony-devkit-bench — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-08-29
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-devkit-bench/SKILL.md"
---

# `nodefony-devkit-bench`

> Éprouve ce que le scaffold de Nodefony PRODUIT, par trois mesures — le code généré tient-il debout (compilation, tests, HTTP réel), un agent lâché dans une application fraîche découvre-t-il l'outillage au lieu de deviner, et le modèle de données d'un vrai logiciel libre est-il exprimable avec la grammaire de champs.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-devkit-bench**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **2/2** projet · 💡 **0/1** recommandé (SHOULD) · 🏷️ `v1.3.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `1.3.0` |
| Famille | Autres |
| Corps | 621 lignes |
| Coût d'activation | ~10 849 tokens (le corps est chargé à l'invocation) |
| Description | 1016 / 1024 caractères |
| Déclencheurs | 0 |
| Ressources `references/` | 4 page(s) |
| Scripts | 9 |
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
- Banc de conformité — l'application tient-elle les promesses du framework ?
- Banc de schéma — un vrai modèle de données est-il exprimable ?
- Interpréter un échec — commencer par le décor
- Quand les lancer
- Quand passer la main
- Références

## Références (chargées à la demande)

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/agents-et-porte-mcp.md` | Décor d'un run : quel AGENT, et quelle PORTE MCP | 376 |
| `references/banc-decouvrabilite-lecons.md` | Banc de découvrabilité — leçons et études de cas | 607 |
| `references/banc-schema-etudes-de-cas.md` | Banc de schéma — études de cas | 48 |
| `references/methode-de-mesure.md` | Méthode de mesure — ce que le banc devkit a appris sur lui-même | 87 |


## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script | Rôle | Options | Variables d'environnement |
| --- | --- | --- | --- |
| `scripts/bench-discoverability.mjs` | Banc de DÉCOUVRABILITÉ du devkit — ses 25 tâches (gate de la release 10.0.0). | `--agent` `--all` `--allow-empty` `--analyze-only` `--auth` `--check-port-free` `--command` `--confirmer` `--dangerously-skip-permissi` `--depistage` `--describe-json` `--detach` `--diff-filter` `--dir` `--dry-run` `--enregistrer-reference` `--format` `--frontend` `--hard` `--help` `--ignored` `--json` `--kind` `--left` `--link` `--max-time` `--mcp-config` `--model` `--name` `--name-only` `--no-audit` `--no-check` `--no-fund` `--no-install` `--numstat` `--output-format` `--porcelain` `--porteur-args` `--preset` `--purge` `--repack` `--reset` `--rest` `--roles` `--route` `--runs` `--scope` `--selftest` `--setup-only` `--short` `--strict-mcp-config` `--task` `--temoin-args` `--ttl` `--unified` `--verbose` `--wait` `--yes` | `AGENT` `CANAL_OPS_ALERTES` `ENTITE_MIGREE` `JUGE_CSP` `JUGE_CSRF_PARTENAIRE` `JUGE_ENTITY_DELETE` `JUGE_LISTE` `JUGE_M2M` `JUGE_MEDIA` `JUGE_MIGRATION` `JUGE_MODULE` `JUGE_PARAM` `JUGE_PREFIXE` `JUGE_REALTIME_CHANNEL` `JUGE_ROLE_HIERARCHY` `JUGE_SECURE` `JUGE_SESSION` `JUGE_THROTTLE` `JUGE_ZONE` `LINKED` `MCP_REGIME` `MCP_SERVER_NOM` `NF_DEVKIT_BENCH_AGENT` `NF_DEVKIT_BENCH_AGENT_ARGS` `NF_DEVKIT_BENCH_MCP` `NF_DEVKIT_BENCH_MODEL` `NF_MCP_TOKEN` `NOM_APP_TEMOIN` `ORIGINE_PARTENAIRE` `PAGE_WIDGET` `PREPARE_BASE_MIGREE` `PREPARE_MODULE_ABSENT` `PREPARE_ROLE_HIERARCHY` `REPERE_PREFIXE_COMPTE` `ROLE_FACTURATION` `ROUTE_ARTICLES` `ROUTE_CATALOGUE` `ROUTE_COMMANDES` `ROUTE_COMPTE_FACTURES` `ROUTE_COMPTE_PROFIL` `ROUTE_FACTURATION` `ROUTE_IMPORT` `ROUTE_MACHINE` `ROUTE_SYNTHESE` `RUN_ROOT` `TITRE_SEME` |
| `scripts/bench-discoverability.selftest.mjs` | Auto-contrôle des sondes du banc de découvrabilité — le juge, AVANT le verdict. | `--analyze-only` `--describe-json` `--detach` `--dry-run` `--help` `--json` `--kind` `--name` `--no` `--no-check` `--prove` `--yes` | `NF_CLE` |
| `scripts/bench-schema.mjs` | Banc de SCHÉMA — ce que la grammaire de champs ne sait pas exprimer. | `--allow-empty` `--analyze-only` `--dangerously-skip-permissi` `--detach` `--dialect` `--dir` `--dump-only` `--frontend` `--jq` `--json` `--link` `--model` `--no-audit` `--no-fund` `--no-install` `--output-format` `--preset` `--repack` `--schema` `--schema-only` `--setup-only` `--verbose` `--wait` `--yes` | `AGENT` `DIALECT` `LINKED` `MODEL` `NF_DEVKIT_BENCH_AGENT` `NF_DEVKIT_BENCH_AGENT_ARGS` `NF_DEVKIT_BENCH_MODEL` `NF_MYSQL_URL` `NF_PG_URL` |
| `scripts/bench-schema.selftest.mjs` | Éprouve le BANC lui-même — avant qu'il ne juge quoi que ce soit. | `--allow-no-pg` `--dump-only` `--prove` `--schema` | `JUDGE_TABLE` `NF_PG_URL` |
| `scripts/build-devkit-report.mjs` | Construit la page « Un agent sait-il développer avec Nodefony ? ». | `--analyze-only` `--data` `--out` `--runs` | `DATA` `OUT` |
| `scripts/jeton-mcp.selftest.mjs` | Auto-contrôle du JETON de la porte MCP — la durée de vie couvre-t-elle le run, | — | — |
| `scripts/reinit-decor.selftest.mjs` | Auto-contrôle de la remise à zéro du décor — le mécanisme, AVANT de payer un | `--allow-empty` `--format` | — |
| `scripts/verify-generated.mjs` | Banc de VÉRITÉ du code généré — « ce que le scaffold produit tient-il debout ? » | `--auth` `--config` `--controller` `--deny-warnings` `--detach` `--dialect` `--force` `--frontend` `--index` `--inject` `--json` `--keep` `--link` `--module` `--name` `--no-audit` `--no-controller` `--no-e2e` `--no-fund` `--no-ignore` `--no-tests` `--preset` `--repack` `--scope` `--service` `--ttl` `--unique` `--wait` `--yes` | `APP` `COMMAND_ACTION` `COMMAND_CLASS` `INJECTED_SERVICE` `MODULE` `MODULE_PKG` `SERVICE` `SERVICE_METHOD` |
| `scripts/verify-runtime.mjs` | Banc de CONFORMITÉ de l'application générée — « ce qui a été câblé tient-il | `--config` `--etage` `--keep` `--link` `--reporter` | `APP` |

**Invocation telle que documentée dans chaque script :**

```bash
node bench-discoverability.selftest.mjs
node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.selftest.mjs
node scripts/build-devkit-report.mjs [--data docs/devkit/data/10.0.0.json] [--out tmp/devkit.html]
node reinit-decor.selftest.mjs <runDir d'un run précédent>
node scripts/verify-generated.mjs            # décor ISOLÉ + toutes les étapes
```

**Toutes les variables lues par ce skill** : `AGENT` · `APP` · `CANAL_OPS_ALERTES` · `COMMAND_ACTION` · `COMMAND_CLASS` · `DATA` · `DIALECT` · `ENTITE_MIGREE` · `INJECTED_SERVICE` · `JUDGE_TABLE` · `JUGE_CSP` · `JUGE_CSRF_PARTENAIRE` · `JUGE_ENTITY_DELETE` · `JUGE_LISTE` · `JUGE_M2M` · `JUGE_MEDIA` · `JUGE_MIGRATION` · `JUGE_MODULE` · `JUGE_PARAM` · `JUGE_PREFIXE` · `JUGE_REALTIME_CHANNEL` · `JUGE_ROLE_HIERARCHY` · `JUGE_SECURE` · `JUGE_SESSION` · `JUGE_THROTTLE` · `JUGE_ZONE` · `LINKED` · `MCP_REGIME` · `MCP_SERVER_NOM` · `MODEL` · `MODULE` · `MODULE_PKG` · `NF_CLE` · `NF_DEVKIT_BENCH_AGENT` · `NF_DEVKIT_BENCH_AGENT_ARGS` · `NF_DEVKIT_BENCH_MCP` · `NF_DEVKIT_BENCH_MODEL` · `NF_MCP_TOKEN` · `NF_MYSQL_URL` · `NF_PG_URL` · `NOM_APP_TEMOIN` · `ORIGINE_PARTENAIRE` · `OUT` · `PAGE_WIDGET` · `PREPARE_BASE_MIGREE` · `PREPARE_MODULE_ABSENT` · `PREPARE_ROLE_HIERARCHY` · `REPERE_PREFIXE_COMPTE` · `ROLE_FACTURATION` · `ROUTE_ARTICLES` · `ROUTE_CATALOGUE` · `ROUTE_COMMANDES` · `ROUTE_COMPTE_FACTURES` · `ROUTE_COMPTE_PROFIL` · `ROUTE_FACTURATION` · `ROUTE_IMPORT` · `ROUTE_MACHINE` · `ROUTE_SYNTHESE` · `RUN_ROOT` · `SERVICE` · `SERVICE_METHOD` · `TITRE_SEME`

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
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| corps < 500 lignes | recommandé | ❌ | 621 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-devkit-bench/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

---
title: "nodefony-release — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-08-02
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-release/SKILL.md"
---

# `nodefony-release`

> Préparer et éprouver une publication npm de Nodefony (modèle N-paquets verrouillés sur la même version).

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-release**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **1/1** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v1.0.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `1.0.0` |
| Famille | Publier et distribuer |
| Corps | 67 lignes |
| Coût d'activation | ~1 235 tokens (le corps est chargé à l'invocation) |
| Description | 935 / 1024 caractères |
| Déclencheurs | 11 |
| Ressources `references/` | 0 page(s) |
| Scripts | 3 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Préparer et éprouver une publication npm de Nodefony (modèle N-paquets verrouillés sur la même version). Porte la chaîne complète : empaquetage des workspaces publiables avec bascule des `exports.types` au pack, post-traitement des `.d.ts` pour la résolution ESM de Node, puis smoke test en conteneur — installation VIERGE des tarballs, compilation d'une application témoin et preuve de l'arrêt gracieux. À charger AVANT de publier ou de toucher à la surface publiée : ce qu'un dépôt voit de lui-même n'est pas ce qu'un installeur reçoit, et seul le décor jetable le montre. Le plan de version et l'état d'avancement vivent dans `docs/release/nodefony-10.md`.

## Prérequis

Ce que le décor doit fournir pour que ses scripts disent quelque chose : **docker** · **serveur UP**.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`check-externals`](nodefony-check-externals.md) · [`create-module`](nodefony-create-module.md) · [`load-test`](nodefony-load-test.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`publier sur npm` · `faire une release` · `préparer la publication` · `packager les paquets` · `smoke test release` · `tester l'installation depuis les tarballs` · `est-ce que le paquet publié marche ?` · `surface npm` · `types publiés` · `tarball` · `avant de publier`

## Ce que contient le corps

- 1. Quand m'utiliser / quand passer la main
- 2. La chaîne, dans l'ordre
- 3. Pièges
- 4. Gate

## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script | Rôle | Options | Variables d'environnement |
| --- | --- | --- | --- |
| `scripts/fix-dts-extensions.mjs` | Post-processing des `.d.ts` générés : ajoute les extensions AUX SPECIFIERS | `--quiet` | — |
| `scripts/pack-all.mjs` | Pack release des workspaces publiables (modèle B — N-packages lockstep). | `--json` `--pack-destination` `--silent` | `OUT` |
| `scripts/smoke-docker.sh` | Smoke test release (modèle B) + preuve Dockerfile/graceful shutdown (Phase 0.7). | `--exclude-entrypoints` `--name` `--profile` `--yes` | — |

**Invocation telle que documentée dans chaque script :**

```bash
Usage : node .claude/skills/nodefony-release/scripts/fix-dts-extensions.mjs <dir> [--quiet]
Usage (racine repo) : node .claude/skills/nodefony-release/scripts/pack-all.mjs
Usage (racine repo) : bash .claude/skills/nodefony-release/scripts/smoke-docker.sh
```

**Toutes les variables lues par ce skill** : `OUT`

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 935 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| corps < 500 lignes | recommandé | ✅ | 67 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-release/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

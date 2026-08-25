---
title: "nodefony-skill — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-08-25
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-skill/SKILL.md"
---

# `nodefony-skill`

> Créer, éditer, **fusionner, retirer** ou auditer un skill du dépôt Nodefony.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-skill**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **2/2** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v1.2.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `1.2.0` |
| Famille | Cycle de session |
| Corps | 276 lignes |
| Coût d'activation | ~4 293 tokens (le corps est chargé à l'invocation) |
| Description | 991 / 1024 caractères |
| Déclencheurs | 11 |
| Ressources `references/` | 0 page(s) |
| Scripts | 3 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Créer, éditer, **fusionner, retirer** ou auditer un skill du dépôt Nodefony. Dérive de `skill-creator` (qui porte la mécanique générique) et ajoute ce que Nodefony exige en propre : nommage `nodefony-*`, description calibrée pour se DÉCLENCHER (formulations de besoin, pas de noms d'outils), `metadata.version`, ressources en `references/`, note de maintenance intemporelle, table « quand passer la main », et la barrière `skills-doc` qui contrôle la conformité au standard Agent Skills et régénère la fiche publique. Porte les pièges vécus : une règle recopiée dans le CLAUDE.md rend le skill inatteignable, un renvoi survit au refactor qui a supprimé sa cible, une capacité absorbée sans ses déclencheurs devient introuvable.

## Prérequis

Ce que le décor doit fournir pour que ses scripts disent quelque chose : **docker** · **redis** · **base de données**.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`create-module`](nodefony-create-module.md) · [`documentation`](nodefony-documentation.md) · [`inspect`](nodefony-inspect.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`créer un skill` · `nouveau skill` · `éditer un skill` · `fusionner deux skills` · `retirer un skill` · `mon skill ne se déclenche jamais` · `skill non conforme` · `skills-ref validate` · `conformité Agent Skills` · `fiche de skill` · `à quoi sert ce skill`

## Ce que contient le corps

- 1. Quand m'utiliser
- 2. La question préalable : skill, commande, ou règle ?
- 3. Conventions Nodefony (en plus du standard)
- 4. Écrire la description (c'est elle qui décide de tout)
- 5. Réparer un skill qui ne se déclenche jamais
- 6. Fusionner, absorber ou retirer un skill
- 7. Gate — obligatoire avant de dire « fait »
- 8. Le hook de doc — un script se décrit lui-même
- 9. Ce que consomme un registre de skills
- 10. Gabarit
- 11. Pièges vécus
- 12. Liens

## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script | Rôle | Options | Variables d'environnement |
| --- | --- | --- | --- |
| `scripts/scripts-audit.mjs` | scripts-audit — chaque script du dépôt est-il au bon endroit, et quelqu'un l'appelle-t-il ? | `--strict` | — |
| `scripts/skills-doc.mjs` | skills-doc — fiche de documentation par skill, ET gate de conformité. | `--check` | `SKILLS_DOC_DATE` |
| `scripts/trigger-bench.mjs` | trigger-bench — prouve qu'une phrase réelle élit le bon skill. | `--verbose` `--list` | `FRAGILE_MARGIN` |

**Invocation telle que documentée dans chaque script :**

```bash
node .claude/skills/nodefony-skill/scripts/scripts-audit.mjs
node .claude/skills/nodefony-skill/scripts/skills-doc.mjs
node .claude/skills/nodefony-skill/scripts/trigger-bench.mjs
```

**Toutes les variables lues par ce skill** : `FRAGILE_MARGIN` · `SKILLS_DOC_DATE`

### Détail des scripts auto-documentés

#### `scripts/scripts-audit.mjs`

Produit : un classement de chaque script : bien placé, à déplacer, orphelin, ou renvoi mort

```bash
node .claude/skills/nodefony-skill/scripts/scripts-audit.mjs
node .claude/skills/nodefony-skill/scripts/scripts-audit.mjs --strict
```

| Option | Rôle |
| --- | --- |
| `--strict` | sort en échec dès qu'un script est orphelin ou qu'un renvoi est mort |

#### `scripts/skills-doc.mjs`

Produit : une fiche par skill dans docs/skills/, l'index, les cards de la page d'analyse et registry.json

```bash
node .claude/skills/nodefony-skill/scripts/skills-doc.mjs
node .claude/skills/nodefony-skill/scripts/skills-doc.mjs --check
```

| Option | Rôle |
| --- | --- |
| `--check` | contrôle seulement, n'écrit rien (utilisable en intégration continue) |

| Variable | Rôle |
| --- | --- |
| `SKILLS_DOC_DATE` | horodatage des pages générées ; par défaut la date du jour |

#### `scripts/trigger-bench.mjs`

Produit : phrases élisant le bon skill, cas négatifs respectés, couverture, recouvrements (arbitrés vs à trancher)

```bash
node .claude/skills/nodefony-skill/scripts/trigger-bench.mjs
node .claude/skills/nodefony-skill/scripts/trigger-bench.mjs --verbose
```

| Option | Rôle |
| --- | --- |
| `--verbose` | affiche le top-3 par phrase + les recouvrements arbitrés et les cas fragiles |
| `--list` | liste les cas du banc sans les exécuter |

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 991 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| corps < 500 lignes | recommandé | ✅ | 276 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-skill/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

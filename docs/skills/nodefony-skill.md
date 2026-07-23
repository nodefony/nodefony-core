---
title: "nodefony-skill — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-skill/SKILL.md"
---

# `nodefony-skill`

> Créer, éditer ou auditer un skill du dépôt Nodefony.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-skill**

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                                                    |
| ------------------------ | -------------------------------------------------- |
| Version                  | `1.0.0`                                            |
| Famille                  | Cycle de session                                   |
| Corps                    | 191 lignes                                         |
| Coût d'activation        | ~2 881 tokens (le corps est chargé à l'invocation) |
| Description              | 1001 / 1024 caractères                             |
| Déclencheurs             | 11                                                 |
| Ressources `references/` | 0 page(s)                                          |
| Scripts                  | 2                                                  |
| Conformité               | ✅ conforme au standard                            |

## Ce qu'il fait

Créer, éditer ou auditer un skill du dépôt Nodefony. Dérive de `skill-creator` (qui porte la mécanique générique) et ajoute ce que Nodefony exige en propre : nommage `nodefony-*`, description calibrée pour se DÉCLENCHER (formulations de besoin, pas de noms d'outils), `metadata.version`, ressources en `references/`, note de maintenance intemporelle, table « quand passer la main », et la barrière `skills-doc` qui contrôle la conformité au standard Agent Skills et régénère la fiche publique du skill. Porte aussi les pièges vécus : une règle recopiée dans le CLAUDE.md rend le skill inatteignable, un renvoi survit au refactor qui a supprimé sa cible, une description qui décrit l'outil au lieu du moment ne se déclenche jamais.

## Prérequis

Ce que le décor doit fournir pour que ses scripts disent quelque chose : **docker** · **redis** · **base de données**.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`check-memory-health`](nodefony-check-memory-health.md) · [`create-module`](nodefony-create-module.md) · [`debug`](nodefony-debug.md) · [`documentation`](nodefony-documentation.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`créer un skill` · `nouveau skill` · `éditer un skill` · `améliorer un skill` · `mon skill ne se déclenche jamais` · `skill non conforme` · `skills-ref validate` · `conformité Agent Skills` · `fiche de skill` · `à quoi sert ce skill` · `faut-il un skill pour ça ?`

## Ce que contient le corps

- 1. Quand m'utiliser
- 2. La question préalable : skill, commande, ou règle ?
- 3. Conventions Nodefony (en plus du standard)
- 4. Écrire la description (c'est elle qui décide de tout)
- 5. Réparer un skill qui ne se déclenche jamais
- 6. Gate — obligatoire avant de dire « fait »
- 7. Le hook de doc — un script se décrit lui-même
- 8. Ce que consomme un registre de skills
- 9. Gabarit
- 10. Pièges vécus
- 11. Liens

## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script                      | Rôle                                                                  | Options              | Variables d'environnement |
| --------------------------- | --------------------------------------------------------------------- | -------------------- | ------------------------- |
| `scripts/skills-doc.mjs`    | skills-doc — fiche de documentation par skill, ET gate de conformité. | `--check`            | `SKILLS_DOC_DATE`         |
| `scripts/trigger-bench.mjs` | trigger-bench — prouve qu'une phrase réelle élit le bon skill.        | `--verbose` `--list` | —                         |

**Invocation telle que documentée dans chaque script :**

```bash
node .claude/skills/nodefony-skill/scripts/skills-doc.mjs
node .claude/skills/nodefony-skill/scripts/trigger-bench.mjs
```

**Toutes les variables lues par ce skill** : `SKILLS_DOC_DATE`

### Détail des scripts auto-documentés

#### `scripts/skills-doc.mjs`

Produit : une fiche par skill dans docs/skills/, l'index, les cards de la page d'analyse et registry.json

```bash
node .claude/skills/nodefony-skill/scripts/skills-doc.mjs
node .claude/skills/nodefony-skill/scripts/skills-doc.mjs --check
```

| Option    | Rôle                                                                  |
| --------- | --------------------------------------------------------------------- |
| `--check` | contrôle seulement, n'écrit rien (utilisable en intégration continue) |

| Variable          | Rôle                                                       |
| ----------------- | ---------------------------------------------------------- |
| `SKILLS_DOC_DATE` | horodatage des pages générées ; par défaut la date du jour |

#### `scripts/trigger-bench.mjs`

Produit : un compte de phrases élisant le bon skill, les échecs, et les recouvrements à arbitrer

```bash
node .claude/skills/nodefony-skill/scripts/trigger-bench.mjs
node .claude/skills/nodefony-skill/scripts/trigger-bench.mjs --verbose
```

| Option      | Rôle                                                           |
| ----------- | -------------------------------------------------------------- |
| `--verbose` | affiche le score des trois meilleurs skills pour chaque phrase |
| `--list`    | liste les cas du banc sans les exécuter                        |

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 1001   |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 191    |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-skill/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

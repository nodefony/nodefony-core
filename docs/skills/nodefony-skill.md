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

|                          |                         |
| ------------------------ | ----------------------- |
| Version                  | `1.0.0`                 |
| Corps                    | 162 lignes              |
| Description              | 1001 / 1024 caractères  |
| Déclencheurs             | 11                      |
| Ressources `references/` | 0 page(s)               |
| Scripts                  | 2                       |
| Conformité               | ✅ conforme au standard |

## Ce qu'il fait

Créer, éditer ou auditer un skill du dépôt Nodefony. Dérive de `skill-creator` (qui porte la mécanique générique) et ajoute ce que Nodefony exige en propre : nommage `nodefony-*`, description calibrée pour se DÉCLENCHER (formulations de besoin, pas de noms d'outils), `metadata.version`, ressources en `references/`, note de maintenance intemporelle, table « quand passer la main », et la barrière `skills-doc` qui contrôle la conformité au standard Agent Skills et régénère la fiche publique du skill. Porte aussi les pièges vécus : une règle recopiée dans le CLAUDE.md rend le skill inatteignable, un renvoi survit au refactor qui a supprimé sa cible, une description qui décrit l'outil au lieu du moment ne se déclenche jamais.

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
- 7. Gabarit
- 1. Quand m'utiliser / quand passer la main
- 2. La procédure
- 3. Pièges
- 4. Gate
- 8. Pièges vécus
- 9. Liens

## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script                      | Rôle                                                                  | Options              | Variables d'environnement                                                              |
| --------------------------- | --------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------- |
| `scripts/skills-doc.mjs`    | skills-doc — fiche de documentation par skill, ET gate de conformité. | `--check`            | `ANALYSIS` `END` `MAX_BODY_LINES` `MAX_DESC` `OUT_DIR` `SKILLS_DOC_DATE` `START` `VAR` |
| `scripts/trigger-bench.mjs` | trigger-bench — prouve qu'une phrase réelle élit le bon skill.        | `--list` `--verbose` | —                                                                                      |

**Invocation telle que documentée dans chaque script :**

```bash
node .claude/skills/nodefony-skill/scripts/skills-doc.mjs            # régénère docs/skills/ ; sort 1 si un skill n'est pas conforme
node .claude/skills/nodefony-skill/scripts/trigger-bench.mjs           # exécute le banc
```

**Toutes les variables lues par ce skill** : `ANALYSIS` · `END` · `MAX_BODY_LINES` · `MAX_DESC` · `OUT_DIR` · `SKILLS_DOC_DATE` · `START` · `VAR`

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 1001   |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 162    |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-skill/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

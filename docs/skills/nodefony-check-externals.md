---
title: "nodefony-check-externals — fiche de skill"
lang: fr
audience: humain
generated: scripts/skills-doc.mjs
source: ".claude/skills/nodefony-check-externals/SKILL.md"
---

# `nodefony-check-externals`

> Audite la dérive entre la liste `external` des rolldown.config.ts et les `peerDependencies` de chaque package.json Nodefony — détecte le bug « peerDep bundlée » (cause d'échecs de build type @node-rs/bcrypt) et les entrées external périmées.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-check-externals**

> [!NOTE]
> Fiche **générée** par `scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                         |
| ------------------------ | ----------------------- |
| Version                  | — (non versionné)       |
| Corps                    | 86 lignes               |
| Description              | 752 / 1024 caractères   |
| Déclencheurs             | 10                      |
| Ressources `references/` | 0 page(s)               |
| Scripts                  | 0                       |
| Conformité               | ✅ conforme au standard |

## Ce qu'il fait

Audite la dérive entre la liste `external` des rolldown.config.ts et les `peerDependencies` de chaque package.json Nodefony — détecte le bug « peerDep bundlée » (cause d'échecs de build type @node-rs/bcrypt) et les entrées external périmées. Anti-duplication : la même liste est maintenue à la main à deux endroits → dérive garantie. À charger avant une publication npm ou devant un échec de build qui parle d'un paquet natif ou d'un module introuvable à l'exécution.

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`check externals` · `audit externals` · `external rolldown` · `peerDeps externalisées` · `duplication external` · `vérifie les external` · `le bundler avale un peerDep` · `avant de publier sur npm` · `erreur de build sur une dépendance native` · `module introuvable au runtime`

## Ce que contient le corps

- 1. Audit (tous les modules)
- 2. Interpréter — tout « missing » n'est pas un bug
- 3. Corriger (rolldown.config.ts est PROTÉGÉ → accord user)
- 4. Root cause (proposer, ne pas imposer)
- Anti-patterns
- Liens

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 752    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 86     |

Le détail du standard et la méthode de mesure : [Outillage agents](../outillage-agents.md).

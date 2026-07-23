---
title: "nodefony-create-module — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-create-module/SKILL.md"
---

# `nodefony-create-module`

> Scaffold d'un package @nodefony/* du REPO FRAMEWORK (src/packages/) — package.json, tsconfig, rolldown, structure nodefony/{interfaces,service,command,src,config}/, index.ts (Module + @services + exports), CLAUDE.md, MEMORY.md, README.md, peerDeps, manifeste `modules`.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-create-module**

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                                                    |
| ------------------------ | -------------------------------------------------- |
| Version                  | — (non versionné)                                  |
| Famille                  | Développer le framework                            |
| Corps                    | 276 lignes                                         |
| Coût d'activation        | ~4 970 tokens (le corps est chargé à l'invocation) |
| Description              | 891 / 1024 caractères                              |
| Déclencheurs             | 10                                                 |
| Ressources `references/` | 1 page(s)                                          |
| Scripts                  | 0                                                  |
| Conformité               | ✅ conforme au standard                            |

## Ce qu'il fait

Scaffold d'un package @nodefony/* du REPO FRAMEWORK (src/packages/) — package.json, tsconfig, rolldown, structure nodefony/{interfaces,service,command,src,config}/, index.ts (Module + @services + exports), CLAUDE.md, MEMORY.md, README.md, peerDeps, manifeste `modules`. Dans une APPLICATION, le scaffold d'un module est une commande — `nodefony create module <nom>` — et ce skill s'y délègue au lieu de la réimplémenter (une seule source de templates). À charger AVANT d'écrire le moindre fichier d'un module neuf : recomposer le squelette à la main produit un module non conforme (types, exports, config, docs) que rien ne signale.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`check-externals`](nodefony-check-externals.md) · [`create-frontend-module`](nodefony-create-frontend-module.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`crée un module` · `scaffold module` · `nouveau module nodefony` · `génère un module` · `create module` · `bootstrap module` · `module @nodefony/...` · `j'ai besoin d'un nouveau paquet` · `ajouter un module au framework` · `structure d'un module neuf`

## Ce que contient le corps

- 🚦 DEUX CAS — ne pas confondre (lire AVANT toute génération)
- Quand l'utiliser
- Questions à poser à l'user AVANT de générer (AskUserQuestion)
- Étapes d'exécution
- Templates des fichiers à générer
- Validation finale
- Pièges connus à éviter
- Exemples concrets de modules créés

## Références (chargées à la demande)

- `references/templates.md`

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 891    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| aucun renvoi vers un skill inexistant     |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 276    |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-create-module/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

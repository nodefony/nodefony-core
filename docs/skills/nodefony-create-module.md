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

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _AAIF / Linux Foundation_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **1/1** projet · 💡 **1/1** recommandé (SHOULD).

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

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier                   | Ce qu'il couvre                    | Lignes |
| ------------------------- | ---------------------------------- | -----: |
| `references/templates.md` | Templates — nodefony-create-module |    946 |

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** (AAIF / Linux Foundation).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle                                    |   Nature    | État | Mesure | Règle (source)                                                                                                                           |
| ------------------------------------------- | :---------: | :--: | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| name conforme et égal au dossier            | ℹ️ normatif |  ✅  |        | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier                                   |
| description de 1 à 1024 caractères          | ℹ️ normatif |  ✅  | 891    | spec § description : 1-1024 car., non vide (quoi + quand)                                                                                |
| aucun champ hors standard                   | ℹ️ normatif |  ✅  |        | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif |  ✅  | absent | spec § compatibility : 1-500 car. si fourni                                                                                              |
| dossier de ressources nommé `references/`   | ℹ️ normatif |  ✅  |        | spec § resources : le dossier de détail se nomme `references/` (pluriel)                                                                 |
| aucun renvoi vers un skill inexistant       |   projet    |  ✅  |        | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide                                                                   |
| corps < 500 lignes                          | recommandé  |  ✅  | 276    | best-practices : corps court (index) + détail en `references/` (divulgation progressive)                                                 |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-create-module/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

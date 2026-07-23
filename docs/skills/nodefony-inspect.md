---
title: "nodefony-inspect — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-inspect/SKILL.md"
---

# `nodefony-inspect`

> Interroge l'état du dépôt Nodefony sans en lire les sources : graphe symbolique (qui étend une classe, qui implémente une interface, qui importe un symbole, où il est défini), signature d'une méthode, puis config / services / routes d'un module **déjà existant** — ses métadonnées, sans démarrer de serveur et **sans rien créer** (scaffolder → `nodefony-create-module`).

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-inspect**

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                                                    |
| ------------------------ | -------------------------------------------------- |
| Version                  | `1.0.0`                                            |
| Famille                  | Inspecter et auditer                               |
| Corps                    | 210 lignes                                         |
| Coût d'activation        | ~2 989 tokens (le corps est chargé à l'invocation) |
| Description              | 1021 / 1024 caractères                             |
| Déclencheurs             | 15                                                 |
| Ressources `references/` | 0 page(s)                                          |
| Scripts                  | 0                                                  |
| Conformité               | ✅ conforme au standard                            |

## Ce qu'il fait

Interroge l'état du dépôt Nodefony sans en lire les sources : graphe symbolique (qui étend une classe, qui implémente une interface, qui importe un symbole, où il est défini), signature d'une méthode, puis config / services / routes d'un module **déjà existant** — ses métadonnées, sans démarrer de serveur et **sans rien créer** (scaffolder → `nodefony-create-module`). Donne aussi le diff propre des sources non commitées et régénère le graphe. À charger AVANT de partir en `grep` sur plusieurs modules ou d'ouvrir un fichier de 500 lignes pour l'ordre des arguments.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`create-module`](nodefony-create-module.md) · [`framework-dev`](nodefony-framework-dev.md) · [`migration-audit`](nodefony-migration-audit.md) · [`security-review`](nodefony-security-review.md) · [`start-server`](nodefony-start-server.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`qui étend cette classe ?` · `qui implémente cette interface ?` · `qui utilise ce symbole ?` · `où est défini X ?` · `trouver les consommateurs` · `analyse d'impact avant refactor` · `quels paramètres prend cette méthode ?` · `inspecter un module existant` · `montre la config de ce module` · `quelles routes expose ce module` · `ce service est-il enregistré ?` · `qu'est-ce que j'ai modifié ?` · `diff rapide` · `graphe symbolique` · `symbols.json`

## Ce que contient le corps

- 1. Quand m'utiliser / quand passer la main
- 2. Les deux graphes — ne pas se tromper de fichier
- 3. Interroger le graphe — recherche en O(1)
- 4. Signature d'une méthode (graphe **verbose**)
- 5. Comment un module est câblé (config, services, routes)
- 6. Diff propre — ce que j'ai changé
- 7. Limites — ce que l'index ne sait pas
- 8. Pièges
- 9. Liens

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 1021   |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| aucun renvoi vers un skill inexistant     |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 210    |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-inspect/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

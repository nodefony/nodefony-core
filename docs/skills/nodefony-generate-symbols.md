---
title: "nodefony-generate-symbols — fiche de skill"
lang: fr
audience: humain
generated: scripts/skills-doc.mjs
source: ".claude/skills/nodefony-generate-symbols/SKILL.md"
---

# `nodefony-generate-symbols`

> Graphe symbolique TypeScript de Nodefony (classes, interfaces, types, décorateurs, relations inversées) : le génère dans `.ai/symbols.json` et donne les requêtes `jq` pour répondre en O(1), sans parcourir le dépôt — qui étend cette classe, qui implémente cette interface, qui importe ce symbole, quelle est la description TSDoc, où est-il défini.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-generate-symbols**

> [!NOTE]
> Fiche **générée** par `scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                         |
| ------------------------ | ----------------------- |
| Version                  | — (non versionné)       |
| Corps                    | 136 lignes              |
| Description              | 704 / 1024 caractères   |
| Déclencheurs             | 10                      |
| Ressources `references/` | 0 page(s)               |
| Scripts                  | 0                       |
| Conformité               | ✅ conforme au standard |

## Ce qu'il fait

Graphe symbolique TypeScript de Nodefony (classes, interfaces, types, décorateurs, relations inversées) : le génère dans `.ai/symbols.json` et donne les requêtes `jq` pour répondre en O(1), sans parcourir le dépôt — qui étend cette classe, qui implémente cette interface, qui importe ce symbole, quelle est la description TSDoc, où est-il défini. À charger AVANT de partir en `grep` sur plusieurs modules : la réponse est déjà indexée.

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`génère les symboles` · `graphe symbolique` · `regenerate symbols` · `symbols.json` · `qui étend cette classe ?` · `qui implémente cette interface ?` · `qui utilise ce symbole ?` · `où est défini X ?` · `chercher dans tout le repo` · `trouver les consommateurs`

## Ce que contient le corps

- Quand l'utiliser
- Sortie
- Générer
- Format JSON (v2.0)
- Cheat-sheet jq — Zero-Token Lookup
- Limites & règles
- Quand régénérer
- Quand NE PAS utiliser

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 704    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 136    |

Le détail du standard et la méthode de mesure : [Outillage agents](../outillage-agents.md).

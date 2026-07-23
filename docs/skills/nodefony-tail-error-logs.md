---
title: "nodefony-tail-error-logs — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-tail-error-logs/SKILL.md"
---

# `nodefony-tail-error-logs`

> Extrait uniquement les erreurs (ERROR / CRITIC / TypeError / SyntaxError / stack traces) des derniers logs du serveur Nodefony — supprime les codes ANSI et les requêtes 200 OK.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-tail-error-logs**

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                                                  |
| ------------------------ | ------------------------------------------------ |
| Version                  | — (non versionné)                                |
| Famille                  | Exécuter, diagnostiquer, mesurer                 |
| Corps                    | 77 lignes                                        |
| Coût d'activation        | ~880 tokens (le corps est chargé à l'invocation) |
| Description              | 395 / 1024 caractères                            |
| Déclencheurs             | 6                                                |
| Ressources `references/` | 0 page(s)                                        |
| Scripts                  | 0                                                |
| Conformité               | ✅ conforme au standard                          |

## Ce qu'il fait

Extrait uniquement les erreurs (ERROR / CRITIC / TypeError / SyntaxError / stack traces) des derniers logs du serveur Nodefony — supprime les codes ANSI et les requêtes 200 OK. À utiliser dès qu'un test d'intégration échoue ou que le serveur a crashé au boot.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`start-server`](nodefony-start-server.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`logs du serveur` · `erreurs serveur` · `voir les crashs` · `pourquoi le test échoue` · `tail logs` · `stack trace nodefony`

## Ce que contient le corps

- Quand l'utiliser
- Pourquoi ça économise des tokens
- Commandes
- Heuristique de diagnostic
- Quand NE PAS utiliser

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 395    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 77     |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-tail-error-logs/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

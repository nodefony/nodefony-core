---
title: "nodefony-start-server — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-start-server/SKILL.md"
---

# `nodefony-start-server`

> Lance le serveur Nodefony en mode développement pour les tests d'intégration — script unique start.sh (1 commande, 1 approbation) : build conditionnel du module test, kill ports, spawn detached du DevSupervisor (auto-restart), wait boot fail-fast, health check.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-start-server**

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                         |
| ------------------------ | ----------------------- |
| Version                  | — (non versionné)       |
| Corps                    | 209 lignes              |
| Description              | 525 / 1024 caractères   |
| Déclencheurs             | 5                       |
| Ressources `references/` | 0 page(s)               |
| Scripts                  | 2                       |
| Conformité               | ✅ conforme au standard |

## Ce qu'il fait

Lance le serveur Nodefony en mode développement pour les tests d'intégration — script unique start.sh (1 commande, 1 approbation) : build conditionnel du module test, kill ports, spawn detached du DevSupervisor (auto-restart), wait boot fail-fast, health check. Commandes natives standalone nodefony status / nodefony stop (introspection + arrêt propre, de partout).

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`lance le serveur` · `démarre nodefony` · `relance le serveur` · `start server` · `redémarre le serveur`

## Ce que contient le corps

- ⚡ Usage — 1 commande
- Pourquoi un script (et pas des commandes inline)
- Contexte critique (pourquoi spawn detached + binaire direct)
- Serveur dev = DevSupervisor auto-restart (actif depuis 2026-05-22)
- Quand lancer en debug (`-d`)
- Parsing des logs (debug rapide)
- Symptômes courants
- Maintenance des scripts
- Liens

## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script     | Rôle                                                                        | Options                                                                                | Variables d'environnement |
| ---------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------- |
| `start.sh` | start.sh — démarre le serveur Nodefony de manière fiable.                   | `--all` `--cluster` `--detach` `--force-build` `--health` `--log` `--wait` `--workers` | —                         |
| `stop.sh`  | stop.sh — arrête le serveur Nodefony proprement (one-shot, pas de respawn). | —                                                                                      | —                         |

**Invocation telle que documentée dans chaque script :**

```bash
Usage : bash .claude/skills/nodefony-start-server/start.sh [-d] [--force-build] [--cluster [-w N]]
Usage : bash .claude/skills/nodefony-start-server/stop.sh
```

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 525    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ✅  | 209    |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-start-server/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

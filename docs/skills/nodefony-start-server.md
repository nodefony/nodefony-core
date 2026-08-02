---
title: "nodefony-start-server — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-08-02
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-start-server/SKILL.md"
---

# `nodefony-start-server`

> Lance le serveur Nodefony en mode développement pour les tests d'intégration — script unique start.sh (1 commande, 1 approbation) : build conditionnel du module test, kill ports, spawn detached du DevSupervisor (auto-restart), wait boot fail-fast, health check.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-start-server**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **1/1** projet · 💡 **1/1** recommandé (SHOULD).

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | — (non versionné) |
| Famille | Exécuter, diagnostiquer, mesurer |
| Corps | 246 lignes |
| Coût d'activation | ~4 404 tokens (le corps est chargé à l'invocation) |
| Description | 525 / 1024 caractères |
| Déclencheurs | 5 |
| Ressources `references/` | 0 page(s) |
| Scripts | 2 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Lance le serveur Nodefony en mode développement pour les tests d'intégration — script unique start.sh (1 commande, 1 approbation) : build conditionnel du module test, kill ports, spawn detached du DevSupervisor (auto-restart), wait boot fail-fast, health check. Commandes natives standalone nodefony status / nodefony stop (introspection + arrêt propre, de partout).

## Prérequis

Ce que le décor doit fournir pour que ses scripts disent quelque chose : **serveur UP**.

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

| Script | Rôle | Options | Variables d'environnement |
| --- | --- | --- | --- |
| `start.sh` | start.sh — démarre le serveur Nodefony de manière fiable. | `--all` `--cluster` `--detach` `--force-build` `--health` `--log` `--wait` `--workers` | `NF__SECURITY__RATELIMIT__ENABLED` |
| `stop.sh` | stop.sh — arrête le serveur Nodefony proprement (one-shot, pas de respawn). | — | — |

**Invocation telle que documentée dans chaque script :**

```bash
Usage : bash .claude/skills/nodefony-start-server/start.sh [-d] [--force-build] [--cluster [-w N]]
Usage : bash .claude/skills/nodefony-start-server/stop.sh
```

**Toutes les variables lues par ce skill** : `NF__SECURITY__RATELIMIT__ENABLED`

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 525 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| corps < 500 lignes | recommandé | ✅ | 246 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-start-server/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

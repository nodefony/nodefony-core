---
title: "nodefony-tail-error-logs — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-08-07
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-tail-error-logs/SKILL.md"
---

# `nodefony-tail-error-logs`

> Extrait uniquement les erreurs (ERROR / CRITIC / TypeError / SyntaxError / stack traces) des derniers logs du serveur Nodefony — supprime les codes ANSI et les requêtes 200 OK.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-tail-error-logs**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **2/2** projet · 💡 **1/1** recommandé (SHOULD).

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | — (non versionné) |
| Famille | Exécuter, diagnostiquer, mesurer |
| Corps | 77 lignes |
| Coût d'activation | ~880 tokens (le corps est chargé à l'invocation) |
| Description | 395 / 1024 caractères |
| Déclencheurs | 6 |
| Ressources `references/` | 0 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

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

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 395 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| corps < 500 lignes | recommandé | ✅ | 77 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-tail-error-logs/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

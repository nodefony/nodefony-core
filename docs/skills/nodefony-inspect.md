---
title: "nodefony-inspect — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-08-27
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-inspect/SKILL.md"
---

# `nodefony-inspect`

> Interroge le dépôt Nodefony par DEUX voies : le graphe symbolique pour les relations de CODE (qui étend, implémente ou importe un symbole ; où il est défini ; signature d'une méthode), et la commande `nodefony inspect` pour l'état RÉEL d'une application qui démarre (routes montées, services enregistrés, config effective et provenance de chaque valeur) — mêmes valeurs que la console d'administration, sans ouvrir de port, ici comme dans une app.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-inspect**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **2/2** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v1.0.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `1.0.0` |
| Famille | Inspecter et auditer |
| Corps | 259 lignes |
| Coût d'activation | ~3 670 tokens (le corps est chargé à l'invocation) |
| Description | 981 / 1024 caractères |
| Déclencheurs | 15 |
| Ressources `references/` | 0 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Interroge le dépôt Nodefony par DEUX voies : le graphe symbolique pour les relations de CODE (qui étend, implémente ou importe un symbole ; où il est défini ; signature d'une méthode), et la commande `nodefony inspect` pour l'état RÉEL d'une application qui démarre (routes montées, services enregistrés, config effective et provenance de chaque valeur) — mêmes valeurs que la console d'administration, sans ouvrir de port, ici comme dans une app. Donne aussi le diff propre. Ne crée rien (scaffolder → `nodefony-create-module`).

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
- 5bis. Demander à l'application — `nodefony inspect` (état RÉEL)
- 6. Diff propre — ce que j'ai changé
- 7. Limites — ce que l'index ne sait pas
- 8. Pièges
- 9. Liens

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 981 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| corps < 500 lignes | recommandé | ✅ | 259 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-inspect/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

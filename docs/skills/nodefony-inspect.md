---
title: "nodefony-inspect — fiche de skill"
navTitle: nodefony-inspect
lang: fr
audience: [developer]
topic: skills
status: stable
updated: 2026-10-30
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-inspect/SKILL.md"
---

# `nodefony-inspect`

> Interroge le dépôt Nodefony par TROIS voies : le graphe symbolique pour les relations de CODE (qui étend, implémente ou importe un symbole ; où il est défini ; signature d'une méthode), la commande `nodefony inspect` pour l'état RÉEL d'une application (routes montées, services, config effective et provenance de chaque valeur), et le serveur MCP de Nodefony quand la session y est branchée — mêmes réponses par outils, sans boot, si l'application tourne.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-inspect**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **6/6** contrôles normatifs (MUST) · 🛡️ **3/3** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v1.1.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `1.1.0` |
| Famille | Inspecter et auditer |
| Corps | 314 lignes |
| Coût d'activation | ~4 697 tokens (le corps est chargé à l'invocation) |
| Description | 1014 / 1024 caractères |
| Déclencheurs | 17 |
| Ressources `references/` | 0 page(s) |
| Scripts | 2 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Interroge le dépôt Nodefony par TROIS voies : le graphe symbolique pour les relations de CODE (qui étend, implémente ou importe un symbole ; où il est défini ; signature d'une méthode), la commande `nodefony inspect` pour l'état RÉEL d'une application (routes montées, services, config effective et provenance de chaque valeur), et le serveur MCP de Nodefony quand la session y est branchée — mêmes réponses par outils, sans boot, si l'application tourne. Donne aussi le diff propre.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`create-module`](nodefony-create-module.md) · [`framework-dev`](nodefony-framework-dev.md) · [`security-review`](nodefony-security-review.md) · [`session`](nodefony-session.md) · [`start-server`](nodefony-start-server.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`qui étend cette classe ?` · `qui implémente cette interface ?` · `qui utilise ce symbole ?` · `où est défini X ?` · `trouver les consommateurs` · `analyse d'impact avant refactor` · `quels paramètres prend cette méthode ?` · `lire une méthode` · `plan de ce fichier` · `montre la config de ce module` · `quelles routes expose ce module` · `ce service est-il enregistré ?` · `qu'est-ce que j'ai modifié ?` · `graphe symbolique` · `interroge l'application qui tourne` · `demande au serveur MCP` · `carte de visite de l'application`

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

## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script | Rôle | Options | Variables d'environnement |
| --- | --- | --- | --- |
| `scripts/show-symbol.mjs` | show-symbol.mjs — imprime UNE déclaration d'un fichier source, ou son plan, au lieu d'une tranche de lignes. | `--outline` `--show-toplevel` | — |
| `scripts/show-symbol.selftest.mjs` | Éprouve `show-symbol.mjs` sur un dépôt JETABLE : la déclaration rendue doit être EXACTEMENT celle demandée (TSDoc compris, rien autour), le plan doit lister chaque déclaration, et une cible fausse doit faire échouer l'outil en le disant. | `--outline` | — |

**Invocation telle que documentée dans chaque script :**

```bash
node show-symbol.mjs <fichier>#<Symbole> [...]   la déclaration, numérotée
`@usage` node .claude/skills/nodefony-inspect/scripts/show-symbol.selftest.mjs
```

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| en-tête analysable par un vrai parseur YAML | ℹ️ normatif | ✅ |  | spec § frontmatter : « YAML frontmatter » — un en-tête que YAML refuse n'est pas rendu par GitHub, alors que le parseur de l'agent, tolérant, l'accepte sans un mot |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 1014 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| aucun numéro de ticket dans la prose | projet | ✅ |  | Nodefony : un numéro d'issue est un pointeur MORT dans un skill — la règle s'y écrit intemporelle (anti-journal) |
| corps < 500 lignes | recommandé | ✅ | 314 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-inspect/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

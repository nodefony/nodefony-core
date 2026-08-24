---
title: "nodefony-browser — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-08-24
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-browser/SKILL.md"
---

# `nodefony-browser`

> Ouvre une page réelle dans un navigateur piloté — poste ou conteneur — pour la VOIR et surtout la MESURER : contrastes calculés, WCAG par axe-core, Web Vitals, réseau, console, débordements ; et pilote un socket depuis la page, avec ses cookies et son origine.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-browser**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **2/2** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v1.1.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `1.1.0` |
| Famille | Autres |
| Corps | 416 lignes |
| Coût d'activation | ~6 742 tokens (le corps est chargé à l'invocation) |
| Description | 1008 / 1024 caractères |
| Déclencheurs | 18 |
| Ressources `references/` | 1 page(s), 9 fichiers au total |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Ouvre une page réelle dans un navigateur piloté — poste ou conteneur — pour la VOIR et surtout la MESURER : contrastes calculés, WCAG par axe-core, Web Vitals, réseau, console, débordements ; et pilote un socket depuis la page, avec ses cookies et son origine. Sait imposer le thème clair ou sombre. Porte les pièges qui font conclure FAUX : mesurer avant que l'écran soit peuplé, viser le mauvais hôte, observer un autre bundle que celui qu'on a bâti. À charger AVANT de constater quoi que ce soit à l'écran.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`debug`](nodefony-debug.md) · [`frontend-dev`](nodefony-frontend-dev.md) · [`html-report`](nodefony-html-report.md) · [`start-server`](nodefony-start-server.md) · [`studio-dev`](nodefony-studio-dev.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`regarde l'écran` · `vérifie l'affichage` · `est-ce que ça s'affiche ?` · `lis la console` · `y a-t-il des erreurs JS ?` · `mesure le contraste` · `cette couleur est-elle lisible ?` · `capture d'écran` · `vérifie l'accessibilité` · `audit WCAG` · `en mode clair` · `en mode sombre` · `le thème sombre casse quelque chose ?` · `quelles requêtes fait la page ?` · `le temps réel arrive-t-il à l'écran ?` · `teste le websocket` · `quelle latence sur le socket ?` · `la page déborde-t-elle sur mobile ?`

## Ce que contient le corps

- 1. Quand m'utiliser / quand passer la main
- 2. Le décor — deux voies, la locale d'abord
- 3. Voir ET mesurer — `inspect.mjs`
- 3 ter. Piloter le socket de bout en bout — `socket.mjs`
- 3 quinquies. L'audit complet — `audit.mjs` (Lighthouse par le port CDP)
- 3 quater. Observer ce qui se PASSE — `watch.mjs`
- 4. Les trois contraintes structurelles
- 5. Pièges — chacun a déjà fait conclure faux
- 6. Ce que le conteneur ne remplace pas
- 7. Références

## Références (chargées à la demande)

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/pilotage-mcp.md` | Référence — l'autre voie : le serveur MCP du conteneur | 107 |

_(+ 8 fichiers dans des sous-dossiers : specs et normes bundlées hors ligne.)_

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 1008 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| corps < 500 lignes | recommandé | ✅ | 416 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-browser/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

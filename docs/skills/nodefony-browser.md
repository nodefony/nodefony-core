---
title: "nodefony-browser — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-08-07
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-browser/SKILL.md"
---

# `nodefony-browser`

> Ouvre une page réelle dans un navigateur en conteneur pour la VOIR et surtout la MESURER — contrastes et tailles calculés, arbre d'accessibilité, erreurs de console, requêtes réseau — sans installer de navigateur sur le poste.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-browser**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **2/2** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v1.0.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `1.0.0` |
| Famille | Autres |
| Corps | 163 lignes |
| Coût d'activation | ~2 731 tokens (le corps est chargé à l'invocation) |
| Description | 977 / 1024 caractères |
| Déclencheurs | 13 |
| Ressources `references/` | 1 page(s), 9 fichiers au total |
| Scripts | 2 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Ouvre une page réelle dans un navigateur en conteneur pour la VOIR et surtout la MESURER — contrastes et tailles calculés, arbre d'accessibilité, erreurs de console, requêtes réseau — sans installer de navigateur sur le poste. Vaut pour toute page servie par Nodefony : console d'administration, module à frontend, application produite par le scaffold. Porte le décor, le pilotage de Playwright et les pièges qui font conclure FAUX : mesurer avant que l'écran soit peuplé, joindre l'hôte par le mauvais nom, observer un bundle qui n'est pas celui qu'on a bâti. À charger AVANT de constater quoi que ce soit à l'écran.

## Prérequis

Ce que le décor doit fournir pour que ses scripts disent quelque chose : **docker**.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`debug`](nodefony-debug.md) · [`frontend-dev`](nodefony-frontend-dev.md) · [`html-report`](nodefony-html-report.md) · [`start-server`](nodefony-start-server.md) · [`studio-dev`](nodefony-studio-dev.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`regarde l'écran` · `vérifie l'affichage` · `est-ce que ça s'affiche ?` · `montre-moi la page` · `lis la console` · `y a-t-il des erreurs JS ?` · `mesure le contraste` · `cette couleur est-elle lisible ?` · `capture d'écran` · `l'application générée fonctionne-t-elle ?` · `vérifie l'accessibilité` · `audit lighthouse` · `quelles requêtes fait la page ?`

## Ce que contient le corps

- 1. Quand m'utiliser / quand passer la main
- 2. Le décor — un service, déjà déclaré
- 3. Voir ET mesurer — `scripts/inspect.mjs`
- 3 bis. Observer ce qui se PASSE — `scripts/watch.mjs`
- 4. Les trois contraintes structurelles
- 5. Pièges — chacun a déjà fait conclure faux
- 6. Ce que le conteneur ne remplace pas
- 7. Références

## Références (chargées à la demande)

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/pilotage-mcp.md` | Référence — l'autre voie : le serveur MCP du conteneur | 101 |

_(+ 8 fichiers dans des sous-dossiers : specs et normes bundlées hors ligne.)_

## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script | Rôle | Options | Variables d'environnement |
| --- | --- | --- | --- |
| `scripts/inspect.mjs` | Ouvre une page dans le navigateur en conteneur, la MESURE et la capture. | `--no-sandbox` | `BASE` `NF_BROWSER_BASE` `NF_BROWSER_EXPECT` `NF_BROWSER_PAGE` `NF_BROWSER_PASSWORD` `NF_BROWSER_PROBES` `NF_BROWSER_USER` `PAGE` |
| `scripts/watch.mjs` | Observe une page VIVANTE : trafic WebSocket, requêtes réseau, console, et | `--no-sandbox` | `BASE` `DURATION` `NF_BROWSER_BASE` `NF_BROWSER_MAXFRAMES` `NF_BROWSER_PASSWORD` `NF_BROWSER_UNTIL` `NF_BROWSER_USER` `PAGE` `UNTIL` |

**Invocation telle que documentée dans chaque script :**

```bash
`@usage` docker cp <ce-fichier> nodefony-browser:/app/inspect.mjs && docker exec nodefony-browser node /app/inspect.mjs
`@usage` docker exec nodefony-browser node /app/watch.mjs /nodefony/supervision 8000
```

**Toutes les variables lues par ce skill** : `BASE` · `DURATION` · `NF_BROWSER_BASE` · `NF_BROWSER_EXPECT` · `NF_BROWSER_MAXFRAMES` · `NF_BROWSER_PAGE` · `NF_BROWSER_PASSWORD` · `NF_BROWSER_PROBES` · `NF_BROWSER_UNTIL` · `NF_BROWSER_USER` · `PAGE` · `UNTIL`

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 977 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| corps < 500 lignes | recommandé | ✅ | 163 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-browser/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

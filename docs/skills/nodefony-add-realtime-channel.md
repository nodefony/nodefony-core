---
title: "nodefony-add-realtime-channel — fiche de skill"
navTitle: nodefony-add-realtime-channel
lang: fr
audience: [developer]
topic: skills
status: stable
updated: 2026-11-14
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: "src/packages/@nodefony/devkit/skills/nodefony-add-realtime-channel/SKILL.md"
---

# `nodefony-add-realtime-channel`

> Branche le temps réel d'une application Nodefony par ses briques — canal, route appelée par la socket, entrée client, action, canal personnel, flux SSE, contrat typé — au lieu d'un WebSocket ou d'un contrôle d'accès écrits à la main.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-add-realtime-channel**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **6/6** contrôles normatifs (MUST) · 🛡️ **3/3** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v3.0.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `3.0.0` |
| Famille | Autres |
| Corps | 471 lignes |
| Coût d'activation | ~7 923 tokens (le corps est chargé à l'invocation) |
| Description | 992 / 1024 caractères |
| Déclencheurs | 17 |
| Ressources `references/` | 2 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Branche le temps réel d'une application Nodefony par ses briques — canal, route appelée par la socket, entrée client, action, canal personnel, flux SSE, contrat typé — au lieu d'un WebSocket ou d'un contrôle d'accès écrits à la main. Part du besoin (chat, salon privé, jeu, sondes, notification, tâche longue), mène à la ligne, à l'exemple exécuté et à son test, dit qui a le droit de LIRE et d'ÉCRIRE, et porte la production : plusieurs serveurs, reconnexion, redéploiement, révocation. À charger AVANT d'écrire un canal, un abonnement ou un flux. Qui est en ligne → `nodefony-add-realtime-presence` ; des octets → `nodefony-add-realtime-binary`.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`browser`](nodefony-browser.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`temps réel` · `websocket` · `canal` · `push` · `chat` · `salon privé` · `exclure un membre` · `l'exclu revient` · `réserver un canal à un rôle` · `mon canal est public` · `prévenir un utilisateur` · `progression d'une tâche` · `SSE` · `tableau de bord en direct` · `-32601` · `ça marche en local, plus en cluster` · `le canal ne répond jamais`

## Ce que contient le corps

- 1. Quel besoin → quelle brique
- 2. Le geste
- 3. Le patron d'un chat : LIRE par le canal, ÉCRIRE par une route
- 4. Les mots du serveur — canal, fabrique, entrée, action
- 5. Qui a le droit — LIRE et ÉCRIRE sont deux politiques
- 6. Côté client — la façade, jamais le socket nu
- 7. Plusieurs serveurs, redéploiement, révocation — résumé
- 8. SSE ou socket ?
- 9. Un contrat, déclaré UNE fois
- 10. Prouver
- 11. Voisins

## Références (chargées à la demande)

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/contrat.md` | Un contrat, déclaré UNE fois — typer les deux bouts | 23 |
| `references/production.md` | Ce qui ne se voit qu'en production — plusieurs serveurs, réseau, révocation, charge | 141 |


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
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 992 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| aucun numéro de ticket dans la prose | projet | ✅ |  | Nodefony : un numéro d'issue est un pointeur MORT dans un skill — la règle s'y écrit intemporelle (anti-journal) |
| corps < 500 lignes | recommandé | ✅ | 471 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `src/packages/@nodefony/devkit/skills/nodefony-add-realtime-channel/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

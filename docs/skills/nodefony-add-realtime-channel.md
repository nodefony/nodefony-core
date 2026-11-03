---
title: "nodefony-add-realtime-channel — fiche de skill"
navTitle: nodefony-add-realtime-channel
lang: fr
audience: [developer]
topic: skills
status: stable
updated: 2026-11-03
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: "src/packages/@nodefony/devkit/skills/nodefony-add-realtime-channel/SKILL.md"
---

# `nodefony-add-realtime-channel`

> Choisit et branche la brique temps réel que Nodefony fournit déjà — canal, entrée client, action, canal personnel, canal à membres, flux SSE, contrat typé, octets — au lieu d'un WebSocket, d'une liste noire ou d'un contrôle d'accès écrits à la main.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-add-realtime-channel**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **6/6** contrôles normatifs (MUST) · 🛡️ **3/3** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v2.1.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `2.1.0` |
| Famille | Autres |
| Corps | 403 lignes |
| Coût d'activation | ~6 295 tokens (le corps est chargé à l'invocation) |
| Description | 1007 / 1024 caractères |
| Déclencheurs | 21 |
| Ressources `references/` | 2 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Choisit et branche la brique temps réel que Nodefony fournit déjà — canal, entrée client, action, canal personnel, canal à membres, flux SSE, contrat typé, octets — au lieu d'un WebSocket, d'une liste noire ou d'un contrôle d'accès écrits à la main. Part du besoin (salon privé avec exclusion, jeu, sondes, tableau de bord, notification à une personne, tâche longue) et mène à la ligne à écrire, à l'exemple installé et à son test. Porte ce qui ne se voit qu'en production : plusieurs serveurs, reconnexion, révocation, contre-pression. À charger AVANT d'écrire un canal, un abonnement client ou un flux.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`browser`](nodefony-browser.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`temps réel` · `websocket` · `canal` · `push` · `notifications en direct` · `abonnement` · `salon privé` · `exclure un membre` · `réserver un canal à un rôle` · `mon canal est public` · `prévenir un utilisateur` · `progression d'une tâche` · `SSE` · `EventSource` · `réponse en streaming` · `contrat temps réel` · `-32601` · `CBOR` · `Uint8Array` · `ça marche en local, plus en cluster` · `l'exclu revient`

## Ce que contient le corps

- 1. Quel besoin → quelle brique
- 2. Le geste
- 3. Les quatre mots du serveur
- 4. Qui a le droit — la politique, et ce qu'elle ne couvre pas
- 5. Côté client — la façade, jamais le socket nu
- 6. SSE ou socket ?
- 7. Un contrat, déclaré UNE fois
- 8. Ce qui ne se voit qu'en production — lis-le avant de dire « fait »
- 9. Des octets dans un canal
- 10. Prouver
- 11. Voisins

## Références (chargées à la demande)

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/binaire.md` | Des octets dans le temps réel — mode d'emploi complet | 192 |
| `references/production.md` | Ce qui ne se voit qu'en production — plusieurs serveurs, réseau, révocation, charge | 122 |


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
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 1007 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| aucun numéro de ticket dans la prose | projet | ✅ |  | Nodefony : un numéro d'issue est un pointeur MORT dans un skill — la règle s'y écrit intemporelle (anti-journal) |
| corps < 500 lignes | recommandé | ✅ | 403 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `src/packages/@nodefony/devkit/skills/nodefony-add-realtime-channel/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

---
title: "nodefony-add-realtime-channel — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-09-17
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: "src/packages/@nodefony/devkit/skills/nodefony-add-realtime-channel/SKILL.md"
---

# `nodefony-add-realtime-channel`

> Ajoute un flux temps réel à une application Nodefony par la bonne couche — un `RealtimeController` et ses décorateurs de canal — au lieu de recomposer un WebSocket à la main.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-add-realtime-channel**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **6/6** contrôles normatifs (MUST) · 🛡️ **3/3** projet · 💡 **1/1** recommandé (SHOULD).

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | — (non versionné) |
| Famille | Autres |
| Corps | 84 lignes |
| Coût d'activation | ~984 tokens (le corps est chargé à l'invocation) |
| Description | 702 / 1024 caractères |
| Déclencheurs | 13 |
| Ressources `references/` | 0 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Ajoute un flux temps réel à une application Nodefony par la bonne couche — un `RealtimeController` et ses décorateurs de canal — au lieu de recomposer un WebSocket à la main. Porte la façon de fermer un canal à certains rôles, le piège du canal public par défaut, celui du canal dont le nom est calculé, et la façade cliente à employer côté navigateur. À charger AVANT d'écrire du code WebSocket, un canal, ou un abonnement client.

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`flux temps réel` · `websocket` · `canal` · `push` · `notifications en direct` · `abonnement` · `RealtimeController` · `@RealtimeChannel` · `socket client` · `temps réel privé` · `réserver un canal à un rôle` · `mon canal est public` · `diffuser à plusieurs onglets`

## Ce que contient le corps

- Le geste
- Fermer un canal
- 🔴 Le piège du canal dont le nom est calculé
- Côté client — la façade, pas le socket
- Ne pas ouvrir plus que le canal demandé
- Prouver
- Voisins

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
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 702 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| aucun numéro de ticket dans la prose | projet | ✅ |  | Nodefony : un numéro d'issue est un pointeur MORT dans un skill — la règle s'y écrit intemporelle (anti-journal) |
| corps < 500 lignes | recommandé | ✅ | 84 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `src/packages/@nodefony/devkit/skills/nodefony-add-realtime-channel/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

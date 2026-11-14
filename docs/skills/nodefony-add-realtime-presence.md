---
title: "nodefony-add-realtime-presence — fiche de skill"
navTitle: nodefony-add-realtime-presence
lang: fr
audience: [developer]
topic: skills
status: stable
updated: 2026-11-14
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: "src/packages/@nodefony/devkit/skills/nodefony-add-realtime-presence/SKILL.md"
---

# `nodefony-add-realtime-presence`

> Affiche qui est là sur un canal temps réel Nodefony — qui est en ligne dans un salon, combien de spectateurs, dans combien d'onglets — par l'option de présence que le framework tient lui-même, au lieu d'une liste de connectés écrite à la main qui ment dès deux serveurs.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-add-realtime-presence**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **6/6** contrôles normatifs (MUST) · 🛡️ **3/3** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v1.0.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `1.0.0` |
| Famille | Autres |
| Corps | 292 lignes |
| Coût d'activation | ~4 699 tokens (le corps est chargé à l'invocation) |
| Description | 1013 / 1024 caractères |
| Déclencheurs | 13 |
| Ressources `references/` | 0 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Affiche qui est là sur un canal temps réel Nodefony — qui est en ligne dans un salon, combien de spectateurs, dans combien d'onglets — par l'option de présence que le framework tient lui-même, au lieu d'une liste de connectés écrite à la main qui ment dès deux serveurs. Mène de la ligne à déclarer à l'écran (React, Vue, Angular, Svelte) et à son test, et porte ce qui ne se voit qu'en production : plusieurs serveurs, rechargement de page, redéploiement, salon de mille personnes. À charger AVANT d'écrire une liste de présents, un compteur de spectateurs ou un indicateur « en ligne ». Le canal lui-même (le créer, le protéger) relève de `nodefony-add-realtime-channel`.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`browser`](nodefony-browser.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`qui est en ligne ?` · `afficher les connectés` · `liste des présents` · `combien de spectateurs` · `indicateur en ligne` · `statut en ligne` · `Untel est en train d'écrire` · `la liste clignote quand je recharge` · `les présents ne sont pas les mêmes sur deux serveurs` · `présence` · `presence` · `onPresence` · `useNodefonyPresence`

## Ce que contient le corps

- 1. Quand m'utiliser — et quand ce n'est pas de la présence
- 2. La ligne — une option de la politique du canal
- 3. Lire côté navigateur
- 4. Qui est nommé — ce que le serveur a vérifié, jamais ce que le client affirme
- 5. « En train d'écrire » n'est PAS de la présence
- 6. Lire côté serveur — l'observateur qui ne figure pas
- 7. Plusieurs serveurs — UNE condition, puis rien à écrire
- 8. Ce que la présence coûte — et ne coûte pas
- 9. Ce que la présence n'est PAS — ne lui fais pas porter ça
- 10. Prouver
- 11. Voisins

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
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 1013 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| aucun numéro de ticket dans la prose | projet | ✅ |  | Nodefony : un numéro d'issue est un pointeur MORT dans un skill — la règle s'y écrit intemporelle (anti-journal) |
| corps < 500 lignes | recommandé | ✅ | 292 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `src/packages/@nodefony/devkit/skills/nodefony-add-realtime-presence/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

---
title: "nodefony-add-realtime-binary — fiche de skill"
navTitle: nodefony-add-realtime-binary
lang: fr
audience: [developer]
topic: skills
status: stable
updated: 2026-11-14
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: "src/packages/@nodefony/devkit/skills/nodefony-add-realtime-binary/SKILL.md"
---

# `nodefony-add-realtime-binary`

> Fait passer des octets sur la socket Nodefony — mesures de capteurs, image, audio, état de jeu compact, document partagé — par le codec CBOR négocié et un `Uint8Array` dans la charge d'un canal, sous les mêmes gardes que le texte, au lieu de base64, d'un en-tête binaire maison ou d'un WebSocket brut.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-add-realtime-binary**

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
| Corps | 257 lignes |
| Coût d'activation | ~4 029 tokens (le corps est chargé à l'invocation) |
| Description | 985 / 1024 caractères |
| Déclencheurs | 17 |
| Ressources `references/` | 2 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Fait passer des octets sur la socket Nodefony — mesures de capteurs, image, audio, état de jeu compact, document partagé — par le codec CBOR négocié et un `Uint8Array` dans la charge d'un canal, sous les mêmes gardes que le texte, au lieu de base64, d'un en-tête binaire maison ou d'un WebSocket brut. Dit QUAND le binaire gagne et quand il perd, chiffres mesurés à l'appui, comment représenter la donnée (tableau typé, bits tassés, réduction côté serveur), et ce qui rate sans un message. À charger AVANT de mettre des octets, un tableau typé ou un flux audio/vidéo dans un canal, ou de choisir un codec. Le canal lui-même relève de `nodefony-add-realtime-channel`.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`browser`](nodefony-browser.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`envoyer des octets` · `binaire` · `données binaires` · `CBOR` · `Uint8Array` · `Float32Array` · `tableau typé` · `base64` · `envoyer une image` · `audio sur la socket` · `flux de capteurs` · `trames trop grosses` · `réduire la bande passante` · `mes octets arrivent en objet` · `$bytes` · `codec` · `onRealtimeBinary`

## Ce que contient le corps

- 1. Quel besoin → quelle voie
- 2. Décider avec les mesures — le binaire gagne SUR LES OCTETS, et seulement là
- 3. Le modèle — une trame comme les autres
- 4. Mise en place — une ligne par côté
- 5. Publier et recevoir
- 6. Lire des octets sans se tromper
- 7. Canal ou flux brut ?
- 8. Le piège du `$bytes` forgé
- 9. Plusieurs serveurs, bornes, et ce qui arrive SANS message
- 10. Prouver
- 11. Voisins

## Références (chargées à la demande)

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/messages.md` | Chaque message, sa cause, ton geste — des octets qui ne passent pas | 21 |
| `references/mesures.md` | Les mesures du binaire — de quoi décider, avec leurs conditions | 58 |


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
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 985 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| aucun numéro de ticket dans la prose | projet | ✅ |  | Nodefony : un numéro d'issue est un pointeur MORT dans un skill — la règle s'y écrit intemporelle (anti-journal) |
| corps < 500 lignes | recommandé | ✅ | 257 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `src/packages/@nodefony/devkit/skills/nodefony-add-realtime-binary/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

---
title: "nodefony-upgrade — fiche de skill"
navTitle: nodefony-upgrade
lang: fr
audience: [developer]
topic: skills
status: stable
updated: 2026-10-13
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: "src/packages/@nodefony/devkit/skills/nodefony-upgrade/SKILL.md"
---

# `nodefony-upgrade`

> Monte une application Nodefony vers une nouvelle version du framework sans rien laisser derrière : tous les paquets ensemble et sous le bon canal, puis `nodefony upgrade` pour la documentation des agents, les skills et les fichiers livrés qu'un `npm install` ne refait pas, puis les ruptures annoncées corrigées dans le code, le schéma migré et la preuve que tout tient.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-upgrade**

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
| Corps | 114 lignes |
| Coût d'activation | ~1 562 tokens (le corps est chargé à l'invocation) |
| Description | 798 / 1024 caractères |
| Déclencheurs | 9 |
| Ressources `references/` | 0 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Monte une application Nodefony vers une nouvelle version du framework sans rien laisser derrière : tous les paquets ensemble et sous le bon canal, puis `nodefony upgrade` pour la documentation des agents, les skills et les fichiers livrés qu'un `npm install` ne refait pas, puis les ruptures annoncées corrigées dans le code, le schéma migré et la preuve que tout tient. À charger AVANT de lancer la montée de version, pas après un premier rouge. Une panne sans rapport avec une montée → `nodefony-troubleshoot`.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`devops`](nodefony-devops.md) · [`migrate-schema`](nodefony-migrate-schema.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`monter nodefony de version` · `mettre à jour nodefony` · `passer à la nouvelle beta` · `upgrade nodefony` · `npm update nodefony` · `une nouvelle version est sortie` · `mes paquets nodefony sont en retard` · `après la mise à jour plus rien ne compile` · `AGENTS.md est périmé`

## Ce que contient le corps

- Passer la main
- 1. La règle — trois couches, trois gestes
- 2. La procédure
- 3. Pièges
- 4. Gate — la montée est faite quand

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
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 798 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| aucun numéro de ticket dans la prose | projet | ✅ |  | Nodefony : un numéro d'issue est un pointeur MORT dans un skill — la règle s'y écrit intemporelle (anti-journal) |
| corps < 500 lignes | recommandé | ✅ | 114 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `src/packages/@nodefony/devkit/skills/nodefony-upgrade/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

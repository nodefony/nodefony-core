---
title: "nodefony-add-crud — fiche de skill"
navTitle: nodefony-add-crud
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-09-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: "src/packages/@nodefony/devkit/skills/nodefony-add-crud/SKILL.md"
---

# `nodefony-add-crud`

> Crée une ressource complète dans une application Nodefony — entité, schémas de validation, service CRUD, controller REST+WebSocket et tests — par le générateur `nodefony create entity`, sur SQL comme sur MongoDB.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-add-crud**

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
| Corps | 231 lignes |
| Coût d'activation | ~3 581 tokens (le corps est chargé à l'invocation) |
| Description | 1005 / 1024 caractères |
| Déclencheurs | 14 |
| Ressources `references/` | 0 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Crée une ressource complète dans une application Nodefony — entité, schémas de validation, service CRUD, controller REST+WebSocket et tests — par le générateur `nodefony create entity`, sur SQL comme sur MongoDB. Porte la grammaire de champs, la table des types moteur par moteur, les relations et clés étrangères, les réglages pour épouser une table SQL existante, et ce qu'on découvre autrement en production : la table naît au démarrage, un champ ajouté n'est rattrapé que s'il accepte le vide, et la production s'applique par des migrations (skill `nodefony-migrate-schema`). À charger AVANT d'écrire une entité, un repository ou un controller de ressource.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`migrate-schema`](nodefony-migrate-schema.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`ajoute une entité` · `crée un CRUD` · `nouvelle table` · `modèle de données` · `ressource REST` · `je veux stocker des articles/commandes` · `comment définir un champ` · `quels types de champ ?` · `une relation entre deux entités` · `clé étrangère` · `index composite` · `épouser une table existante` · `entité MongoDB` · `schéma Mongoose`

## Ce que contient le corps

- Le geste
- La grammaire de champs
- Sur une application MongoDB
- Épouser une table qui existe déjà
- Toute lecture de liste se BORNE
- La liste rend une PAGE — et il n'y a qu'un dialecte
- Les trois vérités à savoir avant de livrer (SQL)
- Ce qui refuse AVANT d'écrire
- La suppression naît gardée — vérifie-le
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
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 1005 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| aucun numéro de ticket dans la prose | projet | ✅ |  | Nodefony : un numéro d'issue est un pointeur MORT dans un skill — la règle s'y écrit intemporelle (anti-journal) |
| corps < 500 lignes | recommandé | ✅ | 231 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `src/packages/@nodefony/devkit/skills/nodefony-add-crud/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

---
title: "nodefony-dev — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-09-17
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: "src/packages/@nodefony/devkit/skills/nodefony-dev/SKILL.md"
---

# `nodefony-dev`

> Conduit une tâche de développement de bout en bout dans une application Nodefony — comprendre le code en place, choisir la bonne façade, générer plutôt qu'écrire à la main, retrouver la référence installée qu'une recherche ordinaire ne voit pas, puis prouver que c'est fait — et se charge AVANT la première modification, quelle que soit la tâche.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-dev**

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
| Corps | 129 lignes |
| Coût d'activation | ~2 236 tokens (le corps est chargé à l'invocation) |
| Description | 1005 / 1024 caractères |
| Déclencheurs | 14 |
| Ressources `references/` | 0 page(s) |
| Scripts | 1 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Conduit une tâche de développement de bout en bout dans une application Nodefony — comprendre le code en place, choisir la bonne façade, générer plutôt qu'écrire à la main, retrouver la référence installée qu'une recherche ordinaire ne voit pas, puis prouver que c'est fait — et se charge AVANT la première modification, quelle que soit la tâche. Les gestes spécialisés ont leur propre skill (ressource REST, service, canal temps réel, garde de route, migration de schéma, écran vu au navigateur) ; celui-ci porte la conduite commune et dit lequel prendre.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`browser`](nodefony-browser.md) · [`migrate-schema`](nodefony-migrate-schema.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`je veux ajouter une fonctionnalité` · `comment on code dans ce framework` · `par où je commence` · `où est la doc de ça` · `comment ça marche ici` · `quelle est la bonne façon de faire` · `je dois modifier cette application` · `avant de coder` · `est-ce que j'écris ça à la main` · `où lire avant de toucher au code` · `comment vérifier que c'est bon` · `mon changement est-il fini` · `je ne trouve rien sur ce sujet` · `ce n'est pas documenté`

## Ce que contient le corps

- 1. La règle qui gouverne tout
- 2. Trouver la référence — ce que `rg` ne peut pas voir
- 3. Conduire une tâche — la séquence, et ses points d'arrêt
- 4. Cinq pièges qui coûtent une heure
- 5. Quand passer la main
- 6. Avant de dire « fait »

## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script | Rôle | Options | Variables d'environnement |
| --- | --- | --- | --- |
| `scripts/docs.mjs` | Cherche dans la documentation INSTALLÉE avec les paquets Nodefony. | `--help` `--json` `--limit` `--list` `--open` `--root` | `DEFAULT_LIMIT` `USAGE` |

**Toutes les variables lues par ce skill** : `DEFAULT_LIMIT` · `USAGE`

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
| corps < 500 lignes | recommandé | ✅ | 129 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `src/packages/@nodefony/devkit/skills/nodefony-dev/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

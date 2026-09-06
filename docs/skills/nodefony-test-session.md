---
title: "nodefony-test-session — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-09-06
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-test-session/SKILL.md"
---

# `nodefony-test-session`

> Conduit une passe de test COMPLÈTE du dépôt Nodefony — toutes les suites, tous les interrupteurs, tous les bancs — dans l'ordre où chacune ne fausse pas la suivante, et rend un verdict qui distingue une régression du produit d'un artefact de décor.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-test-session**

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
| Corps | 131 lignes |
| Coût d'activation | ~2 565 tokens (le corps est chargé à l'invocation) |
| Description | 961 / 1024 caractères |
| Déclencheurs | 13 |
| Ressources `references/` | 1 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Conduit une passe de test COMPLÈTE du dépôt Nodefony — toutes les suites, tous les interrupteurs, tous les bancs — dans l'ordre où chacune ne fausse pas la suivante, et rend un verdict qui distingue une régression du produit d'un artefact de décor. Porte la matrice des étages, le décor exact de chacun, ce qu'un run vert ne prouve PAS, et l'arbre de décision qui instruit un rouge avant de l'imputer au code. À charger AVANT de lancer la première commande : l'ordre des étages EST le protocole, et un lot joué à l'envers fabrique des rouges qui n'appartiennent à personne.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`check-memory-health`](nodefony-check-memory-health.md) · [`devkit-bench`](nodefony-devkit-bench.md) · [`load-test`](nodefony-load-test.md) · [`multipod-bench`](nodefony-multipod-bench.md) · [`release`](nodefony-release.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`session de test` · `passe de test complète` · `lance tous les tests` · `tous les bancs` · `test:all` · `on teste tout` · `avant la publication on teste quoi ?` · `qu'est-ce qui n'a pas été testé ?` · `ce rouge est-il une régression ?` · `un banc rouge sans changement de code` · `tests verts en isolé rouges en suite` · `combien de tests sont sautés` · `quels bancs restent à jouer`

## Ce que contient le corps

- Ce que ce skill fait — et ce qu'il ne refait pas
- La matrice — six étages, et l'ordre n'est pas négociable
- Ce qu'un run vert ne prouve pas
- Instruire un rouge — l'arbre de décision
- Les interrupteurs — étage C
- Les lots de l'étage D
- Clore la passe
- Références

## Références (chargées à la demande)

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/pieges-de-session.md` | Les pièges d'une passe complète — symptôme, cause, geste | 149 |


## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 961 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| corps < 500 lignes | recommandé | ✅ | 131 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-test-session/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

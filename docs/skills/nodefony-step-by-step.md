---
title: "nodefony-step-by-step — fiche de skill"
navTitle: nodefony-step-by-step
lang: fr
audience: [developer]
topic: skills
status: stable
updated: 2026-10-28
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-step-by-step/SKILL.md"
---

# `nodefony-step-by-step`

> Conduit un chantier de conception avec l'auteur UNE décision à la fois : la situation sur un exemple concret, le piège, une recommandation motivée, puis une question fermée (oui / non / explique).

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-step-by-step**

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
| Corps | 109 lignes |
| Coût d'activation | ~1 746 tokens (le corps est chargé à l'invocation) |
| Description | 674 / 1024 caractères |
| Déclencheurs | 8 |
| Ressources `references/` | 1 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Conduit un chantier de conception avec l'auteur UNE décision à la fois : la situation sur un exemple concret, le piège, une recommandation motivée, puis une question fermée (oui / non / explique). Chaque oui est aussitôt inscrit dans l'ADR et le ticket, et un petit correctif part dans son propre commit. Évite le rapport de quatorze décisions que personne ne peut trancher d'un bloc. Le contenu technique reste aux skills du domaine. Se désactive sur demande.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`documentation`](nodefony-documentation.md) · [`framework-dev`](nodefony-framework-dev.md) · [`inspect`](nodefony-inspect.md) · [`session`](nodefony-session.md) · [`ticket`](nodefony-ticket.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`une décision à la fois` · `décision par décision` · `aide-moi à décider` · `il y a trop de choses` · `j'ai du mal à suivre` · `on avance doucement` · `petit pas par petit pas` · `on fait l'Epic comme ça`

## Ce que contient le corps

- 1. Quand m'utiliser / quand passer la main
- 2. La procédure
- 3. Pour un Epic entier
- 4. Pièges
- 5. Gate

## Références (chargées à la demande)

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/exemples.md` | Exemples — des tours qui ont permis à l'auteur de trancher | 156 |


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
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 674 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| aucun numéro de ticket dans la prose | projet | ✅ |  | Nodefony : un numéro d'issue est un pointeur MORT dans un skill — la règle s'y écrit intemporelle (anti-journal) |
| corps < 500 lignes | recommandé | ✅ | 109 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-step-by-step/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

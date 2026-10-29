---
title: "nodefony-decision-making — fiche de skill"
navTitle: nodefony-decision-making
lang: fr
audience: [developer]
topic: skills
status: stable
updated: 2026-10-29
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-decision-making/SKILL.md"
---

# `nodefony-decision-making`

> Référence de Nodefony pour TRANCHER un sujet sans revenir en arrière — architecture, API publique, sécurité, performance, version, documentation, tickets, nom public.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-decision-making**

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
| Corps | 121 lignes |
| Coût d'activation | ~2 315 tokens (le corps est chargé à l'invocation) |
| Description | 1019 / 1024 caractères |
| Déclencheurs | 12 |
| Ressources `references/` | 7 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Référence de Nodefony pour TRANCHER un sujet sans revenir en arrière — architecture, API publique, sécurité, performance, version, documentation, tickets, nom public. Pose le socle commun (cadrer, relire ce qui fait foi, question fermée à l'auteur, chaque oui inscrit dans l'ADR et le ticket puis gardé par un test) et aiguille vers la méthode que le sujet demande : pas à pas, scénarios avant les options, table d'experts (agents indépendants aux métiers distincts), pré-mortem, mesure, essai jetable. Expert de la délégation : quand déléguer, à quel agent, sur quel modèle, en apprenant de l'usage à dépenser moins pour un résultat identique. Une méthode s'ajoute par un fichier.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`devops`](nodefony-devops.md) · [`documentation`](nodefony-documentation.md) · [`framework-dev`](nodefony-framework-dev.md) · [`inspect`](nodefony-inspect.md) · [`load-test`](nodefony-load-test.md) · [`release`](nodefony-release.md) · [`rfc`](nodefony-rfc.md) · [`security-review`](nodefony-security-review.md) · [`session`](nodefony-session.md) · [`skill`](nodefony-skill.md) · [`ticket`](nodefony-ticket.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`aide-moi à décider` · `comment trancher ça ?` · `une décision à la fois` · `on revient souvent en arrière` · `plusieurs experts autour d'une table` · `contradicteur` · `décision par décision` · `petit pas par petit pas` · `il y a trop de choses` · `j'ai du mal à suivre` · `à quel agent déléguer ?` · `quel modèle pour cet agent ?`

## Ce que contient le corps

- 1. Quand m'utiliser / quand passer la main
- 2. Le socle — commun à toute décision, quelle que soit la méthode
- 3. L'aiguillage — quelle méthode pour quel sujet
- 4. Pièges communs à toutes les méthodes
- 5. Gate

## Références (chargées à la demande)

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/delegation.md` | Déléguer à des agents — pour décider, au bon modèle, au moindre coût | 107 |
| `references/methode-mesure.md` | Méthode — la mesure qui tranche | 47 |
| `references/methode-pas-a-pas.md` | Méthode — pas à pas : des tours qui ont permis à l’auteur de trancher | 181 |
| `references/methode-poc.md` | Méthode — l'essai jetable | 45 |
| `references/methode-pre-mortem.md` | Méthode — pré-mortem | 45 |
| `references/methode-scenarios.md` | Méthode — scénarios : écrire les cas AVANT les options, puis la matrice | 96 |
| `references/methode-table-d-experts.md` | Méthode — la table d'experts : des regards indépendants, chacun sur le bon modèle | 179 |


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
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 1019 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| aucun numéro de ticket dans la prose | projet | ✅ |  | Nodefony : un numéro d'issue est un pointeur MORT dans un skill — la règle s'y écrit intemporelle (anti-journal) |
| corps < 500 lignes | recommandé | ✅ | 121 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-decision-making/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

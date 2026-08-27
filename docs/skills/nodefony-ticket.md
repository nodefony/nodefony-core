---
title: "nodefony-ticket — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-08-27
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-ticket/SKILL.md"
---

# `nodefony-ticket`

> Écrit et organise les tickets GitHub du dépôt Nodefony — titre normé Conventional Commits, corps en quatre blocs dont une preuve `fichier:ligne` et un critère de fin observable, découpage parent/sous-tickets, et pose des champs du tableau de bord (jalon, jours, priorité, ordre, rattrapabilité).

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-ticket**

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
| Corps | 139 lignes |
| Coût d'activation | ~2 153 tokens (le corps est chargé à l'invocation) |
| Description | 777 / 1024 caractères |
| Déclencheurs | 14 |
| Ressources `references/` | 2 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Écrit et organise les tickets GitHub du dépôt Nodefony — titre normé Conventional Commits, corps en quatre blocs dont une preuve `fichier:ligne` et un critère de fin observable, découpage parent/sous-tickets, et pose des champs du tableau de bord (jalon, jours, priorité, ordre, rattrapabilité). À charger AVANT d'ouvrir une issue ou d'en restructurer un lot : un ticket est lu par un humain pressé autant que par un agent, et un titre-phrase le rend illisible pour les deux.

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`crée un ticket` · `ouvre une issue` · `nouveau ticket` · `note ça dans un ticket` · `fais-en des tickets` · `ticket parent` · `sous-tickets` · `découper cette issue` · `reformater les tickets` · `titre de ticket` · `estimer un ticket` · `priorité d'un ticket` · `ajouter au board` · `jalon 10.0.0`

## Ce que contient le corps

- La règle qui gouverne tout
- 1. Le titre — Conventional Commits, comme les commits du dépôt
- 2. Le corps — quatre blocs, toujours dans cet ordre
- 3. Parent et sous-tickets
- 4. Labels et champs du tableau de bord
- 5. Créer, ordonner, rattacher
- Pièges vécus
- Références (chargées à la demande)

## Références (chargées à la demande)

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/conventional-commits.md` | Conventional Commits 1.0.0 — la spec, hors ligne | 53 |
| `references/github-issues.md` | Issues GitHub — sous-tickets, jalons, projets | 76 |


## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 777 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| corps < 500 lignes | recommandé | ✅ | 139 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-ticket/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

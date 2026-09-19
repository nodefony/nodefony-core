---
title: "nodefony-add-service — fiche de skill"
navTitle: nodefony-add-service
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-09-19
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: "src/packages/@nodefony/devkit/skills/nodefony-add-service/SKILL.md"
---

# `nodefony-add-service`

> Crée un service injectable dans une application Nodefony par `nodefony create service`, et le fait entrer dans le conteneur — la moitié qu'on oublie.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-add-service**

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
| Corps | 87 lignes |
| Coût d'activation | ~1 120 tokens (le corps est chargé à l'invocation) |
| Description | 819 / 1024 caractères |
| Déclencheurs | 10 |
| Ressources `references/` | 0 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Crée un service injectable dans une application Nodefony par `nodefony create service`, et le fait entrer dans le conteneur — la moitié qu'on oublie. Porte la distinction entre le nom de la CLASSE et le nom de l'INSTANCE, les deux façons d'obtenir un service depuis un autre (`@inject` au constructeur ou `container.get` à l'usage), et le défaut mesuré qu'un service écrit à la main produit : une classe qui compile, dont les tests passent, et que le conteneur ignore. À charger AVANT d'écrire une classe de service ou d'appeler un service depuis un autre.

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`crée un service` · `un service métier` · `logique métier partagée` · `injecter une dépendance` · `container.get` · `@injectable` · `@services` · `appeler un service depuis un autre` · `mon service est undefined` · `le conteneur ne trouve pas mon service`

## Ce que contient le corps

- Le geste
- Pourquoi ne pas l'écrire à la main — c'est mesuré
- Deux noms, et ils ne servent pas à la même chose
- Obtenir un service depuis un autre — deux voies, un choix
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
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 819 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| aucun numéro de ticket dans la prose | projet | ✅ |  | Nodefony : un numéro d'issue est un pointeur MORT dans un skill — la règle s'y écrit intemporelle (anti-journal) |
| corps < 500 lignes | recommandé | ✅ | 87 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `src/packages/@nodefony/devkit/skills/nodefony-add-service/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

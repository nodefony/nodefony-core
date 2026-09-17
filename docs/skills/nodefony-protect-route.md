---
title: "nodefony-protect-route — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-09-17
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: "src/packages/@nodefony/devkit/skills/nodefony-protect-route/SKILL.md"
---

# `nodefony-protect-route`

> Réserve une route d'une application Nodefony aux personnes habilitées, par les briques du framework plutôt que par un contrôle écrit à la main dans l'action.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-protect-route**

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
| Corps | 182 lignes |
| Coût d'activation | ~2 255 tokens (le corps est chargé à l'invocation) |
| Description | 882 / 1024 caractères |
| Déclencheurs | 16 |
| Ressources `references/` | 0 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Réserve une route d'une application Nodefony aux personnes habilitées, par les briques du framework plutôt que par un contrôle écrit à la main dans l'action. Porte les deux étages (zone du pare-feu et garde par route), la hiérarchie de rôles qui évite d'attribuer un rôle de plus, la façon d'ouvrir une route à un partenaire sans démonter la défense anti-falsification, et les gestes qui affaiblissent l'application en silence. À charger AVANT de poser une garde, d'ouvrir une route à un tiers, ou de toucher à la configuration de sécurité.

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`protège cette route` · `réserver aux administrateurs` · `@IsGranted` · `firewall` · `zone protégée` · `403` · `401` · `un rôle qui en implique un autre` · `roleHierarchy` · `un partenaire doit pouvoir poster` · `erreur CSRF` · `origine refusée` · `@CsrfExempt` · `API pour un programme` · `clé d'API` · `désactiver la sécurité pour tester`

## Ce que contient le corps

- Deux étages, et ils ne font pas la même chose
- 🔴 Ce qu'il ne faut jamais écrire
- Un rôle qui en implique un autre
- Ouvrir à un partenaire sans démonter la défense
- Créer un compte
- Lire l'utilisateur courant
- Un droit métier qui ne se réduit pas à un rôle
- Une API pour un PROGRAMME, pas pour un navigateur
- Les gestes qui affaiblissent en silence
- Prouver — trois identités, pas une
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
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 882 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| aucun numéro de ticket dans la prose | projet | ✅ |  | Nodefony : un numéro d'issue est un pointeur MORT dans un skill — la règle s'y écrit intemporelle (anti-journal) |
| corps < 500 lignes | recommandé | ✅ | 182 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `src/packages/@nodefony/devkit/skills/nodefony-protect-route/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

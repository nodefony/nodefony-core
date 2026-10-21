---
title: "nodefony-troubleshoot — fiche de skill"
navTitle: nodefony-troubleshoot
lang: fr
audience: [developer]
topic: skills
status: stable
updated: 2026-10-21
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: "src/packages/@nodefony/devkit/skills/nodefony-troubleshoot/SKILL.md"
---

# `nodefony-troubleshoot`

> Dépanne une application Nodefony en partant du SYMPTÔME constaté — démarrage qui échoue, route en 404, refus 401 ou 403 inattendu, erreur au journal, colonne absente, tests rouges d'un coup, page lente — et donne pour chacun le premier geste, la commande qui le constate et le skill qui porte le détail.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-troubleshoot**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **6/6** contrôles normatifs (MUST) · 🛡️ **3/3** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v1.1.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `1.1.0` |
| Famille | Autres |
| Corps | 208 lignes |
| Coût d'activation | ~4 968 tokens (le corps est chargé à l'invocation) |
| Description | 1022 / 1024 caractères |
| Déclencheurs | 15 |
| Ressources `references/` | 0 page(s) |
| Scripts | 1 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Dépanne une application Nodefony en partant du SYMPTÔME constaté — démarrage qui échoue, route en 404, refus 401 ou 403 inattendu, erreur au journal, colonne absente, tests rouges d'un coup, page lente — et donne pour chacun le premier geste, la commande qui le constate et le skill qui porte le détail. Extrait les erreurs du journal par un script ; mesure une route par l'outil MCP `nodefony_profile_route` (il tire lui-même les requêtes), le trafic qu'on génère par `nodefony_observe`. À charger DÈS qu'une chose qui marchait ne marche plus, AVANT de lire les sources ou de contourner la panne. Coder une fonctionnalité → `nodefony-dev`.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`browser`](nodefony-browser.md) · [`devops`](nodefony-devops.md) · [`migrate-schema`](nodefony-migrate-schema.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`l'application ne démarre plus` · `le serveur plante au démarrage` · `ma route répond 404` · `ça marchait hier` · `dépanner` · `erreur dans les logs` · `tous mes tests sont rouges` · `cette page est lente` · `trop de requêtes SQL` · `problème de N+1` · `mesure cette route` · `est-ce plus rapide après ma modification` · `erreur 500 intermittente` · `EADDRINUSE` · `ECONNREFUSED`

## Ce que contient le corps

- Passer la main
- 1. La règle — constater, puis corriger la cause
- 2. Le symptôme → le premier geste
- 3. Le journal — extraire, pas lire
- 4. Les pannes qui trompent
- 5. Mesurer l'application qui tourne — `nodefony_profile_route` et `nodefony_observe`
- 6. Avant de dire « réparé »

## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script | Rôle | Options | Variables d'environnement |
| --- | --- | --- | --- |
| `scripts/log-errors.mjs` | Extrait les erreurs du journal d'une application Nodefony — regroupées, datées, avec le geste qui suit. | `--detach` `--help` `--json` `--last` `--live` `--root` `--warnings` | `USAGE` |

**Toutes les variables lues par ce skill** : `USAGE`

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
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 1022 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| aucun numéro de ticket dans la prose | projet | ✅ |  | Nodefony : un numéro d'issue est un pointeur MORT dans un skill — la règle s'y écrit intemporelle (anti-journal) |
| corps < 500 lignes | recommandé | ✅ | 208 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `src/packages/@nodefony/devkit/skills/nodefony-troubleshoot/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

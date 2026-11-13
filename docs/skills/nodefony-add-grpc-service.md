---
title: "nodefony-add-grpc-service — fiche de skill"
navTitle: nodefony-add-grpc-service
lang: fr
audience: [developer]
topic: skills
status: stable
updated: 2026-11-13
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: "src/packages/@nodefony/devkit/skills/nodefony-add-grpc-service/SKILL.md"
---

# `nodefony-add-grpc-service`

> Sert un service gRPC dans une application Nodefony — contrat `.proto`, code généré par `buf`, contrôleur `GrpcController` marqué `@GrpcService`, déclaré par `@controllers` — à charger AVANT d'écrire le contrat ou le contrôleur.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-add-grpc-service**

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
| Corps | 166 lignes |
| Coût d'activation | ~2 186 tokens (le corps est chargé à l'invocation) |
| Description | 717 / 1024 caractères |
| Déclencheurs | 12 |
| Ressources `references/` | 0 page(s) |
| Scripts | 1 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Sert un service gRPC dans une application Nodefony — contrat `.proto`, code généré par `buf`, contrôleur `GrpcController` marqué `@GrpcService`, déclaré par `@controllers` — à charger AVANT d'écrire le contrat ou le contrôleur. Porte les paquets à installer, les pièges de génération, ce que le framework décide à ta place (ports, refus 16/7, erreurs, arrêt, tailles) et un script qui appelle la méthode depuis n'importe quel système pour prouver qu'elle répond.

## Prérequis

Ce que le décor doit fournir pour que ses scripts disent quelque chose : **serveur UP**.

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`service gRPC` · `exposer un contrat protobuf` · `un client Go doit appeler l'application` · `gRPC-Web` · `Connect` · `buf generate` · `@GrpcService` · `GrpcController` · `appeler une méthode gRPC` · `UNAUTHENTICATED` · `UNIMPLEMENTED` · `flux gRPC`

## Ce que contient le corps

- Ce qu'il faut savoir avant d'écrire
- Le geste
- Ce que le framework décide pour toi
- Prouver
- Pièges
- Voisins

## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script | Rôle | Options | Variables d'environnement |
| --- | --- | --- | --- |
| `scripts/call.mjs` | Appelle une méthode gRPC d'une application Nodefony, en protocole Connect (JSON sur HTTP) — la preuve qu'un service répond, sans `curl` ni guillemets. | `--field` `--file` `--header` `--json` `--url` | — |

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
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 717 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| aucun numéro de ticket dans la prose | projet | ✅ |  | Nodefony : un numéro d'issue est un pointeur MORT dans un skill — la règle s'y écrit intemporelle (anti-journal) |
| corps < 500 lignes | recommandé | ✅ | 166 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `src/packages/@nodefony/devkit/skills/nodefony-add-grpc-service/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

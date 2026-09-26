---
title: "nodefony-devops — fiche de skill"
navTitle: nodefony-devops
lang: fr
audience: [developer]
topic: skills
status: stable
updated: 2026-09-26
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-devops/SKILL.md"
---

# `nodefony-devops`

> Porte le déploiement d'une application Nodefony côté FRAMEWORK : les gabarits qui rendent son image, son compose, sa topologie, ses manifestes Kubernetes et sa chaîne d'intégration.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-devops**

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
| Corps | 131 lignes |
| Coût d'activation | ~2 436 tokens (le corps est chargé à l'invocation) |
| Description | 906 / 1024 caractères |
| Déclencheurs | 13 |
| Ressources `references/` | 0 page(s), 24 fichiers au total |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Porte le déploiement d'une application Nodefony côté FRAMEWORK : les gabarits qui rendent son image, son compose, sa topologie, ses manifestes Kubernetes et sa chaîne d'intégration. Donne la carte de ce que le générateur rend déjà, et embarque HORS LIGNE le corpus de référence (Docker, Kubernetes, Podman, OCI, distroless) sur lequel toute décision se tranche. À charger AVANT de toucher à un gabarit de déploiement ou d'affirmer ce qu'un orchestrateur fait : les réponses se lisent dans le corpus, elles ne se déduisent pas. Le skill livré aux applications vit dans le paquet devkit.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`debug`](nodefony-debug.md) · [`documentation`](nodefony-documentation.md) · [`framework-dev`](nodefony-framework-dev.md) · [`load-test`](nodefony-load-test.md) · [`multipod-bench`](nodefony-multipod-bench.md) · [`release`](nodefony-release.md) · [`rfc`](nodefony-rfc.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`gabarit de déploiement` · `Dockerfile généré` · `manifeste Kubernetes du scaffold` · `politique Restricted` · `readOnlyRootFilesystem` · `sondes liveness et readiness` · `arrêt gracieux d'un pod` · `Podman` · `corpus docker` · `corpus kubernetes` · `la CI de l'application générée` · `GitLab CI` · `scanner l'image`

## Ce que contient le corps

- 1. Quand m'utiliser — et quand passer la main
- 2. La règle qui gouverne tout le reste
- 3. Ce que le générateur rend — la carte
- 4. Le corpus de référence — `references/corpus/`
- 5. Le décor local — ce qui est installé, et ce qui ne l'est pas
- 6. Pièges constatés
- 7. Gate

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
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 906 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| aucun numéro de ticket dans la prose | projet | ✅ |  | Nodefony : un numéro d'issue est un pointeur MORT dans un skill — la règle s'y écrit intemporelle (anti-journal) |
| corps < 500 lignes | recommandé | ✅ | 131 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-devops/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

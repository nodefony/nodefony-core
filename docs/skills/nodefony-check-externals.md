---
title: "nodefony-check-externals — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-27
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-check-externals/SKILL.md"
---

# `nodefony-check-externals`

> Audite la dérive entre la liste `external` des rolldown.config.ts et les `peerDependencies` de chaque package.json Nodefony — détecte le bug « peerDep bundlée » (cause d'échecs de build type @node-rs/bcrypt) et les entrées external périmées.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-check-externals**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **1/1** projet · 💡 **1/1** recommandé (SHOULD).

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | — (non versionné) |
| Famille | Publier et distribuer |
| Corps | 86 lignes |
| Coût d'activation | ~1 097 tokens (le corps est chargé à l'invocation) |
| Description | 752 / 1024 caractères |
| Déclencheurs | 10 |
| Ressources `references/` | 0 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Audite la dérive entre la liste `external` des rolldown.config.ts et les `peerDependencies` de chaque package.json Nodefony — détecte le bug « peerDep bundlée » (cause d'échecs de build type @node-rs/bcrypt) et les entrées external périmées. Anti-duplication : la même liste est maintenue à la main à deux endroits → dérive garantie. À charger avant une publication npm ou devant un échec de build qui parle d'un paquet natif ou d'un module introuvable à l'exécution.

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`check externals` · `audit externals` · `external rolldown` · `peerDeps externalisées` · `duplication external` · `vérifie les external` · `le bundler avale un peerDep` · `avant de publier sur npm` · `erreur de build sur une dépendance native` · `module introuvable au runtime`

## Ce que contient le corps

- 1. Audit (tous les modules)
- 2. Interpréter — tout « missing » n'est pas un bug
- 3. Corriger (rolldown.config.ts est PROTÉGÉ → accord user)
- 4. Root cause (proposer, ne pas imposer)
- Anti-patterns
- Liens

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 752 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| corps < 500 lignes | recommandé | ✅ | 86 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-check-externals/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

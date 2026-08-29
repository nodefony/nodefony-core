---
title: "nodefony-migrate-schema — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-08-29
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-migrate-schema/SKILL.md"
---

# `nodefony-migrate-schema`

> Fait évoluer le schéma d'une base Nodefony et le porte en production, par les commandes `orm:generate` et `orm:migrate` — jamais par un `ALTER` écrit à la main ni par la suppression d'une base.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-migrate-schema**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **2/2** projet · 💡 **1/1** recommandé (SHOULD).

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | — (non versionné) |
| Famille | Développer le back |
| Corps | 15 lignes |
| Coût d'activation | ~426 tokens (le corps est chargé à l'invocation) |
| Description | 830 / 1024 caractères |
| Déclencheurs | 10 |
| Ressources `references/` | 0 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Fait évoluer le schéma d'une base Nodefony et le porte en production, par les commandes `orm:generate` et `orm:migrate` — jamais par un `ALTER` écrit à la main ni par la suppression d'une base. Porte la lecture de l'état (que l'application tourne ou non), le plan avant le geste, les codes de refus et le geste que chacun appelle, les trois interdits qui cassent un historique, et le patron de déploiement où les migrations passent AVANT les exemplaires. À charger AVANT de modifier une entité déjà en base, ou avant de déployer un schéma changé.

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`j'ai ajouté un champ à une entité` · `la colonne n'existe pas en base` · `migrer le schéma` · `orm:migrate` · `orm:generate` · `appliquer les migrations` · `déployer un changement de schéma` · `adopter une base existante` · `réparer une migration en échec` · `no such column`

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 830 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| corps < 500 lignes | recommandé | ✅ | 15 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-migrate-schema/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

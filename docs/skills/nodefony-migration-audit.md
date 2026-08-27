---
title: "nodefony-migration-audit — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-08-27
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-migration-audit/SKILL.md"
---

# `nodefony-migration-audit`

> Audit phase-par-phase de l'état RÉEL de la migration Nodefony — confronte MIGRATION_STATUS.md au code (grep/ls/find), une phase à la fois, corrige les écarts.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-migration-audit**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **2/2** projet · 💡 **1/1** recommandé (SHOULD).

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | — (non versionné) |
| Famille | Inspecter et auditer |
| Corps | 430 lignes |
| Coût d'activation | ~7 327 tokens (le corps est chargé à l'invocation) |
| Description | 675 / 1024 caractères |
| Déclencheurs | 11 |
| Ressources `references/` | 0 page(s) |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Audit phase-par-phase de l'état RÉEL de la migration Nodefony — confronte MIGRATION_STATUS.md au code (grep/ls/find), une phase à la fois, corrige les écarts. Inclut un mode synthèse graphique (barres de progression par phase) ET un mode VÉRITÉ exhaustif : croise code + mémoire IA + docs + MD modules → fichier d'audit persistant + assainissement de la FORME du dashboard (anti-obésité).

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`inspect`](nodefony-inspect.md) · [`start-server`](nodefony-start-server.md) · [`ticket`](nodefony-ticket.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`audit migration` · `état des lieux migration` · `où en est la migration` · `avancement migration` · `vérifier MIGRATION_STATUS` · `revue phase par phase` · `mets à jour le migration` · `gros point migration` · `fichier vérité` · `audit vérité` · `assainir le dashboard migration`

## Ce que contient le corps

- Principe (ce qui marche — retour user 2026-05-20)
- Workflow
- Interactivité & UX (pour que le user COMPRENNE, pas juste lise)
- Où va ce que l'audit trouve — DEUX adresses, plus une seule
- Piège — le verdict « en fait livré » se déclenche trop tôt
- Recettes de vérification (code, pas fichier)
- Pièges connus (issus des audits 2026-05-20 + 2026-06-05)
- Mémoire liée

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 675 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| corps < 500 lignes | recommandé | ✅ | 430 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-migration-audit/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

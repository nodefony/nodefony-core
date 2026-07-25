---
title: "nodefony-frontend-dev — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-25
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-frontend-dev/SKILL.md"
---

# `nodefony-frontend-dev`

> Kit de dev FRONT de Nodefony — le full-stack côté client : isomorphisme (`nodefony` partagé front/back), socket client (`RealtimeClient`, hooks React), builder Vite + HMR (`@nodefony/frontend`, React/Vue/Angular), data-plane BFF (`ApiClient`/`useResource`), RBAC isomorphe, ergonomie / temps réel « calme » / a11y / perf (bundlés offline), et **vérification d'une modif front sans navigateur** (transform Vite en `curl`, purge du prébundle, rechargement forcé) — la règle projet interdit le navigateur headless.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-frontend-dev**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **1/1** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v1.0.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `1.0.0` |
| Famille | Développer le framework |
| Corps | 101 lignes |
| Coût d'activation | ~2 568 tokens (le corps est chargé à l'invocation) |
| Description | 1003 / 1024 caractères |
| Déclencheurs | 20 |
| Ressources `references/` | 6 page(s), 14 fichiers au total |
| Scripts | 0 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Kit de dev FRONT de Nodefony — le full-stack côté client : isomorphisme (`nodefony` partagé front/back), socket client (`RealtimeClient`, hooks React), builder Vite + HMR (`@nodefony/frontend`, React/Vue/Angular), data-plane BFF (`ApiClient`/`useResource`), RBAC isomorphe, ergonomie / temps réel « calme » / a11y / perf (bundlés offline), et **vérification d'une modif front sans navigateur** (transform Vite en `curl`, purge du prébundle, rechargement forcé) — la règle projet interdit le navigateur headless. App admin Studio → `nodefony-studio-dev` ; scaffold d'un module front → `nodefony-create-frontend-module` ; le back → `nodefony-framework-dev`.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`create-frontend-module`](nodefony-create-frontend-module.md) · [`framework-dev`](nodefony-framework-dev.md) · [`rfc`](nodefony-rfc.md) · [`security-review`](nodefony-security-review.md) · [`studio-dev`](nodefony-studio-dev.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`dev front nodefony` · `isomorphisme` · `socket client` · `RealtimeClient` · `useNodefony` · `hooks realtime` · `HMR` · `Vite nodefony` · `ApiClient` · `useResource` · `data plane front` · `BFF` · `RBAC front` · `accessibilité front` · `WCAG` · `perf front` · `vérifie le front` · `ma modif front passe ?` · `transform Vite` · `prébundle Vite périmé`

## Ce que contient le corps

- 🔗 Paire POLYMORPHE front ⇄ back (co-évolution OBLIGATOIRE)
- 1. Quand l'utiliser / quand passer la main
- 2. 🚨 RÈGLES ABSOLUES front (non négociables)
- 3. Référence — `references/` (chargé À LA DEMANDE)
- 4. Gates qualité front (AVANT de dire « fait »)
- Réfs

## Références (chargées à la demande)

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/build-hmr.md` | Référence — Builder & HMR Vite (@nodefony/frontend) | 654 |
| `references/data-bff.md` | Consommer le data-plane BFF (front Nodefony) | 243 |
| `references/front-quality.md` | Qualité front (Nodefony) — temps réel calme · perf CSS · a11y · sécu | 154 |
| `references/isomorphic.md` | Cœur isomorphe nodefony côté navigateur | 269 |
| `references/patterns.md` | Patterns d'écran front (Nodefony) — framework-agnostique | 168 |
| `references/realtime-client.md` | RealtimeClient & hooks React (nodefony/client, nodefony/react) | 371 |

_(+ 8 fichiers dans des sous-dossiers : specs et normes bundlées hors ligne.)_

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 1003 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| corps < 500 lignes | recommandé | ✅ | 101 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-frontend-dev/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

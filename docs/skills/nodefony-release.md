---
title: "nodefony-release — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-08-27
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-release/SKILL.md"
---

# `nodefony-release`

> Conduire une publication npm de Nodefony (N paquets verrouillés sur la même version) : quelle commande lancer, dans quel ordre, ce que chaque garde refuse, comment lire un échec.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-release**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **2/2** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v2.0.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `2.0.0` |
| Famille | Publier et distribuer |
| Corps | 247 lignes |
| Coût d'activation | ~4 521 tokens (le corps est chargé à l'invocation) |
| Description | 1013 / 1024 caractères |
| Déclencheurs | 17 |
| Ressources `references/` | 0 page(s) |
| Scripts | 1 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Conduire une publication npm de Nodefony (N paquets verrouillés sur la même version) : quelle commande lancer, dans quel ordre, ce que chaque garde refuse, comment lire un échec. La chaîne appartient au PRODUIT (`npm run release`, `release:pack`, `release:smoke`) ; ce skill porte le raisonnement — une version publiée est BRÛLÉE, npm ne connaît pas la transaction, et ce qu'un dépôt voit de lui-même n'est pas ce qu'un installeur reçoit. À charger AVANT de publier ou de toucher à la surface publiée (`exports`, `files`, `peerDependencies`, gabarits d'application). Plan : `docs/release/nodefony-10.md`.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`check-externals`](nodefony-check-externals.md) · [`create-module`](nodefony-create-module.md) · [`load-test`](nodefony-load-test.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`publier sur npm` · `faire une release` · `préparer la publication` · `puis-je publier ?` · `estampiller la version` · `changelog de la release` · `ordre de publication` · `packager les paquets` · `smoke test release` · `tester l'installation depuis les tarballs` · `est-ce que le paquet publié marche ?` · `surface npm` · `types publiés` · `tarball` · `trusted publishing` · `ENEEDAUTH` · `avant de publier`

## Ce que contient le corps

- 1. La chaîne appartient au PRODUIT — ce skill n'exécute rien
- 2. Ce qui rend une release différente de tout autre geste
- 3. PRÉPARER — ce que `release.mjs` refuse, et ce que chaque refus évite
- 4. ÉPROUVER — l'installation vierge
- 5. Pièges
- 6. Gate

## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script | Rôle | Options | Variables d'environnement |
| --- | --- | --- | --- |
| `scripts/compare-exports.mjs` | compare-exports.mjs — gate #2 de la migration rolldown (sentinelle). | — | — |

**Invocation telle que documentée dans chaque script :**

```bash
node .claude/skills/nodefony-release/scripts/compare-exports.mjs <entryA.js> <entryB.js>   # diff A vs B
```

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 1013 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| corps < 500 lignes | recommandé | ✅ | 247 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-release/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

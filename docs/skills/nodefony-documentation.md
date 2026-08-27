---
title: "nodefony-documentation — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-08-27
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-documentation/SKILL.md"
---

# `nodefony-documentation`

> Kit de dev de la DOCUMENTATION Nodefony, trois faces.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-documentation**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **5/5** contrôles normatifs (MUST) · 🛡️ **2/2** projet · 💡 **1/1** recommandé (SHOULD) · 🏷️ `v3.0.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `3.0.0` |
| Famille | Développer le framework |
| Corps | 469 lignes |
| Coût d'activation | ~7 924 tokens (le corps est chargé à l'invocation) |
| Description | 877 / 1024 caractères |
| Déclencheurs | 18 |
| Ressources `references/` | 2 page(s) |
| Scripts | 7 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Kit de dev de la DOCUMENTATION Nodefony, trois faces. (1) Le SITE PUBLIC : générateur `build-docs-site.mjs`, tri de ce qui devient public (dossier, statut, clé `publish`), liens relatifs, flux GitHub Pages unique, gate anti-lien-mort. (2) Le PORTAIL de la console d'administration et le module `@nodefony/documentation` (DocLayout, MarkdownDoc, data plane anti-traversée). (3) Le SYSTÈME D'ÉCRITURE : standard de rédaction et ses gates doc-lint, anchor-check, code-check, gen-counters.

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`check-memory-health`](nodefony-check-memory-health.md) · [`create-module`](nodefony-create-module.md) · [`framework-dev`](nodefony-framework-dev.md) · [`html-report`](nodefony-html-report.md) · [`load-test`](nodefony-load-test.md) · [`rfc`](nodefony-rfc.md) · [`security-review`](nodefony-security-review.md) · [`start-server`](nodefony-start-server.md) · [`studio-dev`](nodefony-studio-dev.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`publier la doc` · `site de documentation` · `GitHub Pages` · `cette page doit-elle être publique ?` · `retirer une page du site` · `publish` · `portail doc` · `DocLayout` · `MarkdownDoc` · `écrire une page de doc` · `doc de référence` · `standard de rédaction` · `doc-lint` · `anchor-check` · `corpus doc` · `reprendre la doc` · `la doc dit-elle encore vrai ?` · `corriger un écart doc↔code`

## Ce que contient le corps

- Les trois consommateurs de la doc
- Briques front — API exacte
- Navigation du portail — LE HUB D'ABORD, l'arbre ensuite
- Règles de mise en page docs-site (NON négociables)
- Recette — ajouter une page de doc (portail ou onglet module)
- Data plane back — contrat (POC) + cible
- Le module `@nodefony/documentation` — ce qu'il porte
- Écriture de la doc (contenu) — LE SYSTÈME COMPLET
- Gates avant commit
- Retex — template doc impeccable (kit VIVANT, à enrichir)
- Réfs (mémoires IA — détails)

## Références (chargées à la demande)

Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).

| Fichier | Ce qu'il couvre | Lignes |
| --- | --- | --: |
| `references/briques-front.md` | Briques front de la doc — API exacte | 128 |
| `references/redaction-contenu.md` | Rédiger une documentation Nodefony — standard d'écriture (contenu) | 581 |


## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script | Rôle | Options | Variables d'environnement |
| --- | --- | --- | --- |
| `scripts/anchor-check.mjs` | anchor-check.mjs — vérifie l'EXACTITUDE des ancres `fichier:ligne` du corpus doc. | `--show-toplevel` | — |
| `scripts/anchor-fix.mjs` | Recale les ancres `fichier.ts:N` SUSPECT d'une page de doc, par SYMBOLE. | `--apply` | `APPLY` |
| `scripts/anchor-inpage.mjs` | anchor-inpage.mjs — les ancres INTRA-PAGE mènent-elles quelque part ? | — | — |
| `scripts/code-check.mjs` | code-check.mjs — gate de COMPILABILITÉ du « Démarrage rapide » (standard §8sexies). | `--show-toplevel` | — |
| `scripts/doc-lint.mjs` | doc-lint.mjs — Definition of Done mécanique pour la doc Nodefony. | `--show-toplevel` | `COVERAGE` |
| `scripts/gen-counters.mjs` | gen-counters.mjs — génère les compteurs `coverage/tests.<topic>.json` en COMPTANT | `--show-toplevel` | — |
| `lib/slug-heading.mjs` | Slug d'un titre de page — la SEULE implémentation côté Node. | — | — |

**Invocation telle que documentée dans chaque script :**

```bash
Usage : node anchor-check.mjs <page.md> [...]   (exit 1 si FILE_NOT_FOUND/LINE_OUT)
Usage : node anchor-inpage.mjs <page.md ...>
Usage : node code-check.mjs <page.md ...>
Usage : node doc-lint.mjs /tmp/corpus/*.md
Usage : node gen-counters.mjs [topic...]   (sans args : tous les topics)
```

**Toutes les variables lues par ce skill** : `APPLY` · `COVERAGE`

## Conformité au standard Agent Skills

> [!NOTE]
> **Standard [Agent Skills](https://agentskills.io/specification.md)** — Anthropic (standard ouvert).
> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;
> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne
> _Règle_ cite la source exacte de chaque contrôle.

| Contrôle | Nature | État | Mesure | Règle (source) |
| --- | :---: | :---: | --- | --- |
| name conforme et égal au dossier | ℹ️ normatif | ✅ |  | spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier |
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 877 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| corps < 500 lignes | recommandé | ✅ | 469 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-documentation/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

---
title: "nodefony-documentation — fiche de skill"
navTitle: nodefony-documentation
lang: fr
audience: [developer]
topic: skills
status: stable
updated: 2026-10-18
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-documentation/SKILL.md"
---

# `nodefony-documentation`

> Kit de dev de la DOCUMENTATION Nodefony, trois faces.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-documentation**

> [!TIP]
> 🟢 **Conforme** au standard [Agent Skills](https://agentskills.io/specification.md) — _Anthropic (standard ouvert)_.
> ℹ️ **6/6** contrôles normatifs (MUST) · 🛡️ **3/3** projet · 💡 **0/1** recommandé (SHOULD) · 🏷️ `v3.1.0`.

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

| | |
| --- | --- |
| Version | `3.1.0` |
| Famille | Développer le framework |
| Corps | 502 lignes |
| Coût d'activation | ~9 556 tokens (le corps est chargé à l'invocation) |
| Description | 877 / 1024 caractères |
| Déclencheurs | 18 |
| Ressources `references/` | 2 page(s) |
| Scripts | 22 |
| Conformité | ✅ conforme au standard |

## Ce qu'il fait

Kit de dev de la DOCUMENTATION Nodefony, trois faces. (1) Le SITE PUBLIC : générateur `build-docs-site.mjs`, tri de ce qui devient public (dossier, statut, clé `publish`), liens relatifs, flux GitHub Pages unique, gate anti-lien-mort. (2) Le PORTAIL de la console d'administration et le module `@nodefony/documentation` (DocLayout, MarkdownDoc, data plane anti-traversée). (3) Le SYSTÈME D'ÉCRITURE : standard de rédaction et ses gates doc-lint, anchor-check, code-check, gen-counters.

## Prérequis

Ce que le décor doit fournir pour que ses scripts disent quelque chose : **base de données**.

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
| `references/redaction-contenu.md` | Rédiger une documentation Nodefony — standard d'écriture (contenu) | 630 |


## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script | Rôle | Options | Variables d'environnement |
| --- | --- | --- | --- |
| `scripts/anchor-check.mjs` | anchor-check.mjs — vérifie l'EXACTITUDE des ancres `fichier:ligne` du corpus doc. | `--all` `--apply` `--json` `--prouve` `--show-toplevel` | — |
| `scripts/anchor-check.selftest.mjs` | Éprouve `anchor-check.mjs` sur un dépôt JETABLE : il doit signaler une ancre qui a DÉRIVÉ loin de la déclaration qu'elle prouve, et se taire sur une ancre juste — posée sur la déclaration, dans son TSDoc, ou sur un site d'usage. Un gate qu'on n'a jamais vu échouer n'est pas un gate. | — | — |
| `scripts/anchor-context.mjs` | Règles de CONTEXTE d'une ancre, partagées par anchor-check (qui juge) et anchor-fix (qui recale). Écrites deux fois, elles divergeaient : le juge découpait une ligne là où le réparateur ne la découpait pas, et recalait une ancre juste sur le symbole de sa voisine. | — | — |
| `scripts/anchor-fix.mjs` | Recale les ancres `fichier.ts:N` SUSPECT d'une page de doc, par SYMBOLE. Entrée : la sortie d'anchor-check.mjs (stdin). Sortie : édite les .md en place. Règle : on ne déplace une ancre que si UNE seule ligne de définition plausible est trouvée pour les symboles cités — sinon on laisse et on le signale. | `--apply` `--occurrences` `--suggest` | `APPLY` `NF_BOOT_TIMEOUT_MS` |
| `scripts/anchor-fix.selftest.mjs` | Éprouve `anchor-fix.mjs` sur un dépôt JETABLE : chaque ancre SUSPECTE doit être recalée sur la déclaration du symbole qu'ELLE prouve — jamais sur celui d'une ancre voisine. Un outil qui corrige qu'on n'a jamais vu se tromper n'est pas un outil, c'est un pari. | `--apply` | — |
| `scripts/anchor-inpage.mjs` | anchor-inpage.mjs — les ancres INTRA-PAGE mènent-elles quelque part ? | — | — |
| `scripts/anchor-migrate.mjs` | anchor-migrate.mjs — convertit les ancres `fichier:ligne` en ancres par SYMBOLE (`Fichier.ts#Symbole`, `Fichier.ts#Classe.membre`). | `--json` `--report` `--show-toplevel` | — |
| `scripts/anchor-pair-check.mjs` | anchor-pair-check.mjs — après un refactor, confronte chaque ancre `<Fichier>.ts:N` RECALÉE dans l'arbre de travail : le texte de la ligne visée AVANT (à la révision de base) doit être identique au texte de la ligne visée APRÈS (dans l'arbre). Déterministe, exhaustif sur le diff. | `--base` | — |
| `scripts/anchor-remap.mjs` | Recale les ancres `fichier.ts:N` d'une page de doc par le GIT DIFF, pas par symbole : une ancre juste à la révision `--base` est décalée d'exactement le nombre de lignes que le code a gagné ou perdu AVANT elle. Déterministe — là où `anchor-fix.mjs` doit deviner une ligne à partir des mots qui l'entourent (un en-tête `Retry-After`, un `try`, un littéral ne se retrouvent pas). | `--all` `--apply` `--base` `--name-status` `--no-ext-diff` `--quiet` | `APPLY` `BASE` |
| `scripts/anchor-remap.selftest.mjs` | Éprouve `anchor-remap.mjs` sur un dépôt JETABLE : une ancre juste à la base doit glisser d'EXACTEMENT ce que le code a gagné avant elle — ni plus, ni deux fois. | `--apply` `--base` | — |
| `scripts/code-check.mjs` | code-check.mjs — gate de COMPILABILITÉ du « Démarrage rapide » (standard §8sexies). | `--show-toplevel` | — |
| `scripts/corpus.mjs` | Dossiers qu'on ne descend jamais. | — | — |
| `scripts/doc-lint.mjs` | doc-lint.mjs — Definition of Done mécanique pour la doc Nodefony. Une page ne peut être marquée ✅ que si elle PASSE ce linter. Usage : node doc-lint.mjs /tmp/corpus/*.md | `--instructions` `--list` `--published` `--show-toplevel` | `COVERAGE` `NAV_MAX` |
| `scripts/examples.mjs` | Garde des EXEMPLES de code d'une page publiée (`doc-lint`). | — | — |
| `scripts/examples.selftest.mjs` | Auto-contrôle de la garde des exemples (`examples.mjs`). | — | `NF_AUTRE` `NF_HOOK` `NF_JWT_KEYSET` `NF_X` `PG_URL` |
| `scripts/figures.mjs` | Lisibilité des figures mermaid d'une page — ce qu'on ne voit qu'en REGARDANT le rendu, ramené à des règles qu'une machine relit. | — | `DIRECTIVE_COURBE` |
| `scripts/figures.selftest.mjs` | Auto-contrôle des règles de lisibilité des figures (`figures.mjs`). | — | — |
| `scripts/gen-counters.mjs` | gen-counters.mjs — génère les compteurs `coverage/tests.<topic>.json` en COMPTANT les cas réels (`it(`/`test(`) dans les fichiers de `test-map.json`. | `--show-toplevel` | — |
| `scripts/render-figures.mjs` | Rend les figures mermaid d'une page COMME LE LECTEUR LES VOIT, dans les deux moteurs, et les dépose en images — pour les REGARDER avant de dire « fait ». | `--console-seulement` `--only` `--show-toplevel` | — |
| `scripts/symboles.mjs` | Dérive des SYMBOLES cités par les fichiers d'instructions (`CLAUDE.md`, `MEMORY.md`) après un renommage du français vers l'anglais. | — | — |
| `scripts/symboles.selftest.mjs` | Éprouve le contrôle de dérive des symboles : il doit ATTRAPER un symbole que le code ne porte plus, et ne PAS crier sur ce qui est vivant, externe ou hors grammaire. Un gate qu'on n'a jamais vu échouer n'est pas un gate. | — | — |
| `lib/slug-heading.mjs` | Slug d'un titre de page — la SEULE implémentation côté Node. | — | — |

**Invocation telle que documentée dans chaque script :**

```bash
Usage : node anchor-check.mjs [--all|--json] <page.md> [...]   (exit 1 si FILE_NOT_FOUND/LINE_OUT/SUSPECT)
`@usage` node .claude/skills/nodefony-documentation/scripts/anchor-check.selftest.mjs
`@usage` node .claude/skills/nodefony-documentation/scripts/anchor-fix.selftest.mjs
Usage : node anchor-inpage.mjs <page.md ...>
Usage : node anchor-migrate.mjs <page.md|dossier> [...] [--report <f.json>]
node .claude/skills/nodefony-documentation/scripts/anchor-pair-check.mjs src/nodefony/src/kernel/Kernel.ts
node anchor-check.mjs --all <pages…> | node anchor-remap.mjs <repo> --base <rév> [--apply]
`@usage` node .claude/skills/nodefony-documentation/scripts/anchor-remap.selftest.mjs
Usage : node code-check.mjs <page.md ...>
Usage : node doc-lint.mjs /tmp/corpus/*.md
node .claude/skills/nodefony-documentation/scripts/examples.selftest.mjs
node .claude/skills/nodefony-documentation/scripts/figures.selftest.mjs
Usage : node gen-counters.mjs [topic...]   (sans args : tous les topics)
Usage : node render-figures.mjs <page.md> [--console-seulement]
`@usage` node .claude/skills/nodefony-documentation/scripts/symboles.selftest.mjs
```

**Toutes les variables lues par ce skill** : `APPLY` · `BASE` · `COVERAGE` · `DIRECTIVE_COURBE` · `NAV_MAX` · `NF_AUTRE` · `NF_BOOT_TIMEOUT_MS` · `NF_HOOK` · `NF_JWT_KEYSET` · `NF_X` · `PG_URL`

### Détail des scripts auto-documentés

#### `scripts/anchor-pair-check.mjs`

Produit : « identiques: N · écarts: M » puis chaque écart (avant/après) ; exit 1 s'il y a un écart

```bash
node .claude/skills/nodefony-documentation/scripts/anchor-pair-check.mjs src/nodefony/src/kernel/Kernel.ts
node .claude/skills/nodefony-documentation/scripts/anchor-pair-check.mjs src/nodefony/src/kernel/Kernel.ts --base origin/dev
```

| Option | Rôle |
| --- | --- |
| `--base` | révision où les ancres étaient justes (défaut : HEAD) |

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
| description de 1 à 1024 caractères | ℹ️ normatif | ✅ | 877 | spec § description : 1-1024 car., non vide (quoi + quand) |
| aucun champ hors standard | ℹ️ normatif | ✅ |  | spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`) |
| compatibility ≤ 500 caractères (si présent) | ℹ️ normatif | ✅ | absent | spec § compatibility : 1-500 car. si fourni |
| dossier de ressources nommé `references/` | ℹ️ normatif | ✅ |  | spec § resources : le dossier de détail se nomme `references/` (pluriel) |
| aucun renvoi vers un skill inexistant | projet | ✅ |  | Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide |
| aucun renvoi vers une ressource inexistante | projet | ✅ |  | Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide |
| aucun numéro de ticket dans la prose | projet | ✅ |  | Nodefony : un numéro d'issue est un pointeur MORT dans un skill — la règle s'y écrit intemporelle (anti-journal) |
| corps < 500 lignes | recommandé | ❌ | 502 | best-practices : corps court (index) + détail en `references/` (divulgation progressive) |

_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-documentation/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

---
title: "nodefony-documentation — fiche de skill"
lang: fr
audience: humain
topic: skills
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: ".claude/skills/nodefony-documentation/SKILL.md"
---

# `nodefony-documentation`

> Kit de dev de la DOCUMENTATION Nodefony, deux faces.

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **nodefony-documentation**

> [!NOTE]
> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :
> corriger le skill, puis régénérer.

|                          |                                                     |
| ------------------------ | --------------------------------------------------- |
| Version                  | `2.3.0`                                             |
| Famille                  | Développer le framework                             |
| Corps                    | 641 lignes                                          |
| Coût d'activation        | ~10 890 tokens (le corps est chargé à l'invocation) |
| Description              | 993 / 1024 caractères                               |
| Déclencheurs             | 17                                                  |
| Ressources `references/` | 1 page(s)                                           |
| Scripts                  | 6                                                   |
| Conformité               | ✅ conforme au standard                             |

## Ce qu'il fait

Kit de dev de la DOCUMENTATION Nodefony, deux faces. (1) Le PORTAIL doc Studio et le futur module `@nodefony/documentation` : briques React (DocLayout, DocToc, MarkdownDoc, FlowGraph, SymbolGraph), mise en page docs-site, data plane avec allowlist anti-traversée. (2) Le SYSTÈME D'ÉCRITURE de la doc de référence : standard de rédaction (Diátaxis, ancres symboliques, Démarrage rapide compilable, navigation par hubs) et ses gates `scripts/` — doc-lint, anchor-check, code-check, gen-counters, build-preview. Ni les écrans Studio génériques (→ nodefony-studio-dev), ni la création back (→ nodefony-create-module).

## Skills voisins

Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :

[`check-memory-health`](nodefony-check-memory-health.md) · [`create-module`](nodefony-create-module.md) · [`framework-dev`](nodefony-framework-dev.md) · [`load-test`](nodefony-load-test.md) · [`rfc`](nodefony-rfc.md) · [`security-review`](nodefony-security-review.md) · [`start-server`](nodefony-start-server.md) · [`studio-dev`](nodefony-studio-dev.md)

## Quand il se déclenche

Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :

`portail doc` · `DocLayout` · `@nodefony/documentation` · `MarkdownDoc` · `DocToc` · `page de documentation Studio` · `écrire la doc dans Studio` · `écrire une page de doc` · `doc de référence` · `standard de rédaction` · `doc-lint` · `anchor-check` · `corpus doc` · `reprendre la doc` · `avant de rédiger une doc` · `la doc dit-elle encore vrai ?` · `corriger un écart doc↔code`

## Ce que contient le corps

- État actuel (vérité terrain)
- Briques front — API exacte (`import { … } from "../components/ui"`)
- Navigation du portail — LE HUB D'ABORD, l'arbre ensuite
- Règles de mise en page docs-site (NON négociables)
- Recette — ajouter une page de doc (portail ou onglet module)
- Data plane back — contrat (POC) + cible
- Module futur `@nodefony/documentation` — design figé
- Écriture de la doc (contenu) — LE SYSTÈME COMPLET
- Gates avant commit
- Retex — template doc impeccable (kit VIVANT, à enrichir)
- Réfs (mémoires IA — détails)
- Changelog (SemVer)

## Références (chargées à la demande)

- `references/redaction-contenu.md`

## Scripts embarqués

Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque
script, donc toujours à jour après régénération.

| Script                      | Rôle                                                                                | Options                                                                                                                                               | Variables d'environnement                                     |
| --------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `scripts/anchor-check.mjs`  | anchor-check.mjs — vérifie l'EXACTITUDE des ancres `fichier:ligne` du corpus doc.   | `--show-toplevel`                                                                                                                                     | —                                                             |
| `scripts/anchor-inpage.mjs` | anchor-inpage.mjs — les ancres INTRA-PAGE mènent-elles quelque part ?               | —                                                                                                                                                     | —                                                             |
| `scripts/build-preview.mjs` | Tout est relatif au dossier de CE script (tmp/doc-corpus/_tools/) — plus aucun      | `--accent` `--bg` `--border` `--brand` `--code` `--codefg` `--fg` `--muted` `--no-save` `--panel` `--short` `--show-current` `--show-toplevel` `--th` | `GEN_DATE` `LOGO` `MMDC` `NF_BRANCH` `NF_COMMIT` `NF_VERSION` |
| `scripts/code-check.mjs`    | code-check.mjs — gate de COMPILABILITÉ du « Démarrage rapide » (standard §8sexies). | `--show-toplevel`                                                                                                                                     | —                                                             |
| `scripts/doc-lint.mjs`      | doc-lint.mjs — Definition of Done mécanique pour la doc Nodefony.                   | `--show-toplevel`                                                                                                                                     | `COVERAGE`                                                    |
| `scripts/gen-counters.mjs`  | gen-counters.mjs — génère les compteurs `coverage/tests.<topic>.json` en COMPTANT   | `--show-toplevel`                                                                                                                                     | —                                                             |

**Invocation telle que documentée dans chaque script :**

```bash
Usage : node anchor-check.mjs <page.md> [...]   (exit 1 si FILE_NOT_FOUND/LINE_OUT)
Usage : node anchor-inpage.mjs <page.md ...>
Usage : node code-check.mjs <page.md ...>
Usage : node doc-lint.mjs /tmp/corpus/*.md
Usage : node gen-counters.mjs [topic...]   (sans args : tous les topics)
```

**Toutes les variables lues par ce skill** : `COVERAGE` · `GEN_DATE` · `LOGO` · `MMDC` · `NF_BRANCH` · `NF_COMMIT` · `NF_VERSION`

## Conformité au standard Agent Skills

| Contrôle                                  | État | Mesure |
| ----------------------------------------- | :--: | ------ |
| name conforme et égal au dossier          |  ✅  |        |
| description de 1 à 1024 caractères        |  ✅  | 993    |
| aucun champ hors standard                 |  ✅  |        |
| dossier de ressources nommé `references/` |  ✅  |        |
| aucun renvoi vers un skill inexistant     |  ✅  |        |
| corps < 500 lignes (recommandation)       |  ❌  | 641    |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)
- **Le skill lui-même** : `.claude/skills/nodefony-documentation/SKILL.md` — c'est lui qu'on édite, pas cette fiche.

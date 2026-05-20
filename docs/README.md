---
module: global
topic: docs-index
audience: [human, ai]
tags: [documentation, conventions, rag]
status: stable
last-updated: 2026-05-17
---

# Documentation Nodefony

> Documentation **humaine** du framework. Complète les `CLAUDE.md` (instructions IA) et `MEMORY.md` (mémoire IA bas niveau) déjà présents à la racine et dans chaque module.

## Audiences

| Cible       | Source de vérité                                     | Caractère                                |
| ----------- | ---------------------------------------------------- | ---------------------------------------- |
| Humain      | Ce dossier (`docs/`) + `README.md` des modules       | Exemples complets, guides pas-à-pas      |
| IA session  | `CLAUDE.md` + `MEMORY.md` racine/module              | Règles, gotchas, mots-clés               |
| IA RAG futur (Vision) | Ce dossier (`docs/`) + TSDoc extrait via `generate-symbols` | Texte indexable          |

## Structure

```
docs/
├── README.md             ← ce fichier (index + conventions)
├── architecture/         ← concepts transverses : kernel, container, DI, pipeline, lifecycle
├── packages/             ← une page par @nodefony/* — API publique + cas d'usage
└── guides/               ← how-to : routing, sessions, decorators, écrire un module
```

Pas de numérotation préfixée (ex `01_architecture/`) : l'ordre est imposé par le `README.md` de chaque sous-dossier.

## Conventions Markdown

### Frontmatter YAML obligatoire

Chaque fichier `.md` (sauf `README.md` d'index simple) commence par un bloc frontmatter. Ces métadonnées seront consommées par le futur indexer RAG du module **Vision** pour chunker et filtrer sans parser le contenu.

```yaml
---
module: "@nodefony/core"          # workspace ou "global" pour transverse
topic: container                   # slug court — identifiant du sujet
audience: [human, ai]              # cibles : human, ai, ou les deux
tags: [di, container, scope]       # mots-clés pour le RAG
status: stable                     # stable | draft | obsolete
last-updated: 2026-05-17           # YYYY-MM-DD
---
```

| Champ          | Valeurs                                                | Rôle                              |
| -------------- | ------------------------------------------------------ | --------------------------------- |
| `module`       | `@nodefony/<name>` / `global` / `app`                  | Filtre par scope dans le RAG      |
| `topic`        | slug-kebab-case                                        | Identifiant stable de la page     |
| `audience`     | sous-ensemble de `[human, ai]`                         | Permet de séparer doc utilisateur vs notes internes |
| `tags`         | tableau de mots-clés                                   | Indexation thématique             |
| `status`       | `stable` / `draft` / `obsolete`                        | Vision ignore `obsolete`, signale `draft` |
| `last-updated` | date `YYYY-MM-DD`                                      | Permet de prioriser les pages fraîches |

### Structure du corps

```markdown
# <Titre H1 — un seul par fichier>

> Pitch en une phrase (utilisé comme résumé RAG).

## Vue d'ensemble
…

## API publique / concepts clés
…

## Exemples
```typescript
// code complet et exécutable
```

## Gotchas
…

## Liens internes
- [[link/to/other-doc]]
- Code source : `src/...`
```

### Liens

- **Vers une autre page docs/** : chemin relatif `./architecture/kernel.md`.
- **Vers le code source** : chemin absolu depuis la racine, sans backtick : `src/nodefony/src/Container.ts:73`.
- **Vers un symbole** : `[Container](../packages/core.md#container)`.

## TSDoc — source de vérité pour l'API

Toute classe/interface/méthode publique migrée en TypeScript **doit** porter un bloc TSDoc :

```typescript
/**
 * Pitch en une phrase (extrait dans `.ai/symbols.json` → `symbols.X.description`).
 *
 * Description longue optionnelle sur plusieurs paragraphes.
 *
 * @param name - rôle de l'argument
 * @returns ce que renvoie la méthode
 * @throws Type d'erreur lancée dans tel cas
 * @example
 * ```ts
 * const x = container.get<MyService>("my-service");
 * ```
 */
```

- La **première phrase** (jusqu'au point final) est extraite automatiquement par `npm run generate-symbols` dans le champ `symbols.<Name>.description`. Garder cette phrase auto-suffisante.
- Pas de paraphrase de la signature : décrire **l'intention** et les **invariants**.
- Lier au markdown via `@see ../../docs/packages/core.md#container` quand pertinent.

## Workflow

| Quand                                | Action                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| Migration TS d'un fichier            | Ajouter TSDoc sur classe + méthodes publiques (au minimum première phrase)    |
| Nouveau module ou refonte d'API      | Créer/mettre à jour `<module>/docs/index.md` (colocalisé, ADR-0001 — surfacé dans Studio) |
| Concept d'un module précis           | `<module>/docs/<concept>.md` (ex core → `src/nodefony/docs/`)                  |
| Concept **transverse** multi-module  | `docs/guides/` / `docs/architecture/` (racine)                                |
| Nouvelle façon d'utiliser le framework | Créer `docs/guides/<sujet>.md`                                              |
| Renommage / changement d'API public  | Mettre à jour la doc dans la même PR — sinon `status: obsolete` dans le frontmatter |

Pas de hook bloquant pour l'instant : la règle est documentaire. Vision (Phase 10) reconstruira la base RAG depuis ce dossier au boot du mode dev.

## Liens externes

- `CLAUDE.md` (racine) — règles globales du projet
- `MEMORY.md` (racine) — index des mémoires IA par module
- `.claude/skills/generate-symbols/SKILL.md` — extraction du graphe symbolique
- `MIGRATION_STATUS.md` — roadmap P0→P14

# @nodefony/documentation

**Data plane de documentation transverse de Nodefony** — un module _headless_ (back pur) qui indexe
toute la documentation du projet, résout des variables dynamiques côté serveur, et l'expose en JSON
sous `/nodefony/documentation/api/*`.

Il ne rend **aucune page HTML**. Le rendu est laissé au consommateur : le front Studio (page React),
un générateur de site statique, ou le pipeline RAG. Le module se contente de fournir un **index** et
le **contenu résolu** des pages.

## Ce qu'il indexe

Conformément à [ADR-0001](../../../../docs/adr/0001-docs-modules-emplacement-hybride.md) (emplacement
hybride), la doc vit à deux endroits, et les deux sont scannés :

1. **`docs/` racine** — la doc transverse, qui n'appartient à aucun module (guides, ADR, audits, releases).
2. **`<module>/docs/*.md`** — la doc co-localisée à chaque module (`src/packages/@nodefony/<m>/docs/`,
   `src/nodefony/docs/`). Activable/désactivable via `scan.includeModules`.

## Installation / activation

Le module est déclaré dans les `@modules()` de l'application, **après** `@nodefony/framework`
(dépendance des décorateurs `@controller`) et **avant** `@nodefony/studio` (dont le front consomme ce
data plane) :

```ts
// index.ts (racine app)
@modules([
  // …
  "@nodefony/documentation",
  "@nodefony/studio",
])
```

## Configuration

Surcharge depuis la config applicative sous la clé `module-documentation` (fusion récursive) :

```ts
// src/modules/app/nodefony/config/config.ts
export default {
  "module-documentation": {
    scan: { includeModules: false }, // racine seule
    repo: { url: "https://github.com/acme/app", editPathPrefix: "blob" },
    cache: { ttlMs: 0 }, // rescan à chaque requête (dev)
  },
};
```

| Option                | Défaut                                     | Rôle                                                           |
| --------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| `enabled`             | `true`                                     | Active le data plane au boot                                   |
| `scan.rootDir`        | `"docs"`                                   | Dossier de doc transverse, relatif à `kernel.path`             |
| `scan.includeModules` | `true`                                     | Scanne aussi les `<module>/docs/*.md`                          |
| `scan.exclude`        | `["session-retros","node_modules","dist"]` | Segments de chemin ignorés                                     |
| `repo.url`            | dépôt nodefony-core                        | Base du lien « Modifier sur GitHub » (URL publique)            |
| `repo.branch`         | _(auto)_                                   | Branche du lien ; si omise → branche git réelle (`GitService`) |
| `repo.editPathPrefix` | `"edit"`                                   | Segment GitHub : `edit` / `blob` / `tree`                      |
| `cache.ttlMs`         | `30000`                                    | TTL (ms) du cache de l'**index** ; `0` = pas de cache          |

**Variables d'environnement** (précédence maximale, utiles en CI/conteneur sans `.git`) :
`DOCS_REPO_URL`, `DOCS_REPO_BRANCH`.

## API HTTP

### `GET /nodefony/documentation/api/tree`

Index transverse — sections (par dossier racine, et par module) → pages, taguées par audience.

```jsonc
{
  "generatedAt": "2026-05-31T…",
  "audiences": [{ "key": "developer", "label": "Développeur", "desc": "…" }, …],
  "sections": [
    { "id": "root-guides", "label": "Guides", "pages": [{ "slug": "root~guides~intro", "title": "Intro", "audience": [] }] },
    { "id": "mod-http", "label": "Module @nodefony/http", "module": "@nodefony/http", "pages": [ … ] }
  ]
}
```

### `GET /nodefony/documentation/api/page/{slug}`

Contenu d'une page : markdown sans frontmatter, variables `{{ }}` résolues, lien source assemblé.

```jsonc
{
  "slug": "mod~http~index",
  "title": "…",
  "version": "10.0.0",
  "status": "stable",
  "updated": "2026-05-31",
  "source": "src/packages/@nodefony/http/docs/index.md",
  "sourceUrl": "https://github.com/nodefony/nodefony-core/edit/claude-ts/…",
  "markdown": "# …",
}
```

Slug inconnu ou non sûr → **404** avec un corps générique (`{ "slug": "…", "error": "Document inconnu." }`).

## Schéma de slug

Le slug est un identifiant **URL-safe sur un seul segment** (`{slug}` dans la route). C'est une **clé
d'allowlist**, jamais un chemin de fichier.

| Source | Exemple de fichier               | Slug                          |
| ------ | -------------------------------- | ----------------------------- |
| Racine | `docs/guides/session-storage.md` | `root~guides~session-storage` |
| Module | `@nodefony/http/docs/index.md`   | `mod~http~index`              |

Le `/` devient `~` ; le scope npm (`@nodefony/`) est retiré.

## Frontmatter supporté

Bloc optionnel en tête de fichier, encadré de `---`. YAML **plat** uniquement (clé → scalaire ou liste) :

```markdown
---
title: La Socket Nodefony
audience: [developer, devops]
version: "10.0.0"
status: stable
updated: 2026-05-31
---

# Contenu…
```

Champs lus : `title`, `audience` (parmi `developer`/`devops`/`supervisor`/`admin`), `version`,
`status` (`stable`/`draft`/`temporary`/`experimental`/`deprecated`), `updated`, `source`.
Non supporté (volontaire) : objets imbriqués, blocs multilignes `|`/`>`, ancres YAML.

## Variables dynamiques `{{ }}`

Le serveur remplace `{{ name }}` dans le markdown par la valeur d'un fournisseur enregistré. Built-in :
`{{ version }}`, `{{ branch }}`, `{{ commit }}`. Un nom inconnu est laissé tel quel (signale à l'auteur
qu'il manque un provider). Enregistrer une variable :

```ts
documentationService.registerVar("rps", () => String(computeRps()));
```

> ⚠️ Un provider doit retourner une valeur **sûre** (publique, dérivée) — jamais un secret ni un
> chemin FS absolu.

## Sécurité

- Le slug est validé (`isSafeSlug`) **avant** toute recherche ou lecture : rejet de `..`, `/`, `\`,
  octet nul, charset non autorisé, longueur > 512.
- La lecture se fait toujours sur le **chemin réel** mémorisé au scan, jamais reconstruit depuis le slug.
- Les erreurs renvoient un message **générique** au client ; le détail est journalisé côté serveur.

## Briques pures réutilisables

Exportées pour un futur générateur de site statique ou le RAG (testées unitairement) :
`parseFrontmatter`, `metaString`, `metaList`, `scanDocsDir`, `isSafeSlug`, `pathToSlug`.

## Développement

```bash
cd src/packages/@nodefony/documentation
npm test            # vitest — briques pures (frontmatter / slug / docScanner)
npm run build       # rollup + TypeScript → dist/ + dist/types
```

## Licence

CeCILL-B — Christophe CAMENSULI.

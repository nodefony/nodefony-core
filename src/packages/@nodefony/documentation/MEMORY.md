# MEMORY.md — @nodefony/documentation

> IA — ultra-concis. Détail humain = `README.md`. Décisions/interdits = `CLAUDE.md`.

## Purpose

Data plane de documentation transverse **HEADLESS**. Indexe `docs/` racine + `<module>/docs/*.md`
(ADR-0001), résout les variables `{{ }}` côté serveur, expose `/nodefony/documentation/api/{tree,page/:slug}`.
**0 HTML** — front Studio / SSG futur / RAG P12 consomment. Successeur du POC `DocumentationController` du Studio (supprimé).

## Core Components

- `index.ts` — `class Documentation extends Module` (`"documentation"`, `critical=false`). `@services([DocumentationService])` `@controllers([DocumentationController])`. `onKernelRegister` = valide config (`defineDocumentationConfig`, réassigne `this.options`). `onKernelReady` = `registerVar` `version`/`branch`/`commit` via `GitService`.
- `service/DocumentationService.ts` — STATEFUL singleton. `#cache: CacheEntry|null` (TTL), `#vars: Map|null` (lazy). `getTree`/`getPage`/`registerVar`/`invalidate`. `#ensureCache` (scan + index `slug→ScannedDoc`), `#buildSections`, `#resolveVars`, `#buildSourceUrl`, `#coerceStatus`.
- `controller/DocumentationController.ts` — MINCE, réinstancié/req, 0 état. `@controller("/nodefony")`, `@Get` `tree` + `page/{slug}`. try/catch → 404/500 **générique** (détail loggé serveur).
- `src/frontmatter.ts` — `parseFrontmatter` (YAML minimal **SANS dep**) + `metaString`/`metaList`. `ParsedDoc{meta,body}`.
- `src/slug.ts` — `isSafeSlug` (anti-traversée) + `pathToSlug` + `sanitizeSegment`. `SAFE_SLUG=/^[A-Za-z0-9_.~-]+$/`, `MAX_SLUG_LENGTH=512`.
- `src/docScanner.ts` — `scanDocsDir` (`readdir recursive`, best-effort `ENOENT→[]`, tri `relPath`). `ScannedDoc{slug,relPath,absPath,source,group,meta,title}`.
- `src/errors/DocumentationError.ts` — `DocumentationError` (`docCode` string ≠ `code` number du parent `nodefonyError`) → `DocNotFoundError`/`DocUnsafeSlugError`.
- `config/schema.ts` — Zod : `enabled`, `scan{rootDir,includeModules,exclude}`, `repo{url,branch?,editPathPrefix}`, `cache{ttlMs}`. `defineDocumentationConfig` = parse + merge ENV.
- `interfaces/IDocumentation.ts` — `DocAudience`/`DocStatus`/`IDocTree`/`IDocPage`/`IDocPageRef`/`IDocSection`/`IDocAudienceInfo`/`DocVarProvider`/`IDocumentationService`.

## Config (clé `module-documentation` + ENV)

`scan.rootDir="docs"` · `scan.includeModules=true` · `scan.exclude=["session-retros","node_modules","dist"]` · `repo.url`=github nodefony-core · `repo.branch`=**auto** (`GitService.branch`) si omis · `repo.editPathPrefix="edit"|"blob"|"tree"` · `cache.ttlMs=30000` (0 = rescan/req, dev) · `enabled=true`. ENV (précédence max) : `DOCS_REPO_URL`, `DOCS_REPO_BRANCH`.

## Behaviors

- **Slug = CLÉ d'allowlist**, JAMAIS concaténé en chemin. `getPage` lit `doc.absPath` RÉEL (du scan), jamais reconstruit.
- `isSafeSlug` = défense-en-profondeur AVANT recherche. Rejette vide / >512 / `\0` / `/` `\` / hors charset / segment `..`.
- Slug scheme : `docs/a/b.md → root~a~b` ; `<module>/docs/x.md → mod~<short>~x` (scope `@nodefony/` retiré, `/`→`~`).
- Cache TTL = **index seul** ; contenu d'une page **TOUJOURS relu** (frais).
- `{{ name }}` → `provider()` ; inconnu OU provider qui throw → **laissé tel quel** (jamais masqué/crash).
- `#buildSections` : racine groupée par dossier parent (`ROOT_GROUP_LABELS` connus, sinon auto-capitalisé) ; modules groupés par module.
- `sourceUrl` = `repo.url/editPathPrefix/branch/relPath` ; **jamais de chemin FS absolu**.
- App (`m.isApp`) exclue du scan modules (son `docs/` = le `docs/` racine déjà scanné).

## Gotchas

- `onKernelRegister` réassigne `this.options` AVANT le `onBoot` des `@services` → config validée dispo au service.
- `scanDocsDir` best-effort : dossier absent → `[]` (pas d'erreur) ; fichier illisible → `meta={}` + titre humanisé.
- frontmatter NON supporté (volontaire) : objets imbriqués, multilignes `|`/`>`, ancres.
- `DocumentationError.docCode` (string `DOC_*`) ≠ `.code` (number HTTP du parent).
- Tests = **briques pures** (frontmatter/slug/docScanner) ; service+controller = intégration **live server** (suite http).

## Commandes

- Tests : `cd src/packages/@nodefony/documentation && npm test` (vitest, 32 tests, 0 serveur).
- Build : `npm run build` (rollup + TS → `dist/types`).
- API : `GET /nodefony/documentation/api/tree` · `GET /nodefony/documentation/api/page/{slug}`.

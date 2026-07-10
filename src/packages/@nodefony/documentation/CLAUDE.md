# CLAUDE.md — @nodefony/documentation

## Docs liées

- [`MEMORY.md`](./MEMORY.md) — internals IA (composants, behaviors, gotchas)
- [`README.md`](./README.md) — usage humain (config, API, frontmatter)
- [`docs/`](./docs/) — doc vulgarisée surfacée dans Studio (`mod~documentation~*`)
- [`../framework/CLAUDE.md`](../framework/CLAUDE.md) — `@controller` / `@Get` / `@Param`
- [`../../../../CLAUDE.md`](../../../../CLAUDE.md) — règles globales projet
- ADR : [`docs/adr/0001-docs-modules-emplacement-hybride.md`](../../../../docs/adr/0001-docs-modules-emplacement-hybride.md)
- Mémoire IA : `project_doc_portal_faisabilite`, `project_controller_registry_global_dette`

## Rôle du module

**Data plane de documentation transverse de Nodefony — headless (back pur).** Il indexe la doc
co-localisée (`docs/` racine + `<module>/docs/*.md`, ADR-0001), résout les variables dynamiques
`{{ }}` côté serveur, et expose le tout sous `/nodefony/documentation/api/*`. Il ne rend **aucun
HTML** : le front Studio (page React `Documentation.tsx`), un générateur de site statique futur ou
le RAG P12 consomment ce data plane.

**Pourquoi un module dédié** (pas un controller Studio) : la doc porte de l'**état** (index scanné,
cache TTL, registre de providers `{{ }}`) → elle mérite un cycle de vie propre, hors hot path request
(tout lazy). Réutilisable hors Studio. A remplacé le POC `DocumentationController` du Studio (supprimé).

## Structure

```
@nodefony/documentation/
├── index.ts                         ← Module + @services + @controllers + re-exports publics
├── nodefony/
│   ├── config/{config.ts,defineModuleConfig.ts}  ← Zod + ENV
│   ├── controller/DocumentationController.ts  ← @controller("/nodefony") — MINCE (délègue)
│   ├── service/DocumentationService.ts        ← STATEFUL (cache, vars, scan, allowlist)
│   ├── src/{frontmatter.ts,slug.ts,docScanner.ts,errors/}  ← briques PURES réutilisables
│   ├── interfaces/IDocumentation.ts           ← contrat data plane
│   └── tests/unit/{frontmatter,slug,docScanner}.test.ts  ← vitest (briques pures)
└── docs/{index.md,architecture.md}            ← doc du module (auto-scannée → mod~documentation~*)
```

## API / routes (data plane — convention `/nodefony/<module>/api/*`)

| Route                                     | Méthode | Rôle                                                                       |
| ----------------------------------------- | ------- | -------------------------------------------------------------------------- |
| `/nodefony/documentation/api/tree`        | GET     | Index transverse (`IDocTree` : sections → pages taguées audience)          |
| `/nodefony/documentation/api/page/{slug}` | GET     | Contenu d'une page (`IDocPage` : markdown + `{{ }}` résolus + `sourceUrl`) |

Slug inconnu / non sûr → **404 générique** (`{slug, error}`) ; détail loggé serveur (`DOC_NOT_FOUND`/`DOC_UNSAFE_SLUG`).

## Sécurité (RÈGLE ABSOLUE — `feedback_security_rfc_rigor`)

- **Slug = clé d'allowlist, jamais un chemin.** `getPage` retrouve le `ScannedDoc` par égalité de
  slug puis lit son `absPath` RÉEL. Le slug n'est JAMAIS concaténé à un chemin FS.
- **`isSafeSlug` = défense en profondeur** AVANT toute recherche/lecture (rejette `..`, `/`, `\`, `\0`,
  hors charset, > 512). Toute évolution du schéma de slug doit garder ce garde-fou.
- **Zero Trust** : le client ne voit qu'un message générique + un code stable ; le détail reste serveur.
- **Providers `{{ }}` = valeurs SÛRES uniquement** (version, identité git) — JAMAIS un secret ni un
  chemin FS absolu. `sourceUrl` est assemblé depuis un chemin RELATIF au repo.

## Décisions figées

- **Headless** : 0 rendu HTML. Le module produit des shapes JSON (`IDocTree`/`IDocPage`).
- **frontmatter maison** (`src/frontmatter.ts`), pas `gray-matter` : la doc n'utilise qu'un YAML plat
  (scalaire / liste) → on ne paie pas les deps transitives. NON supporté volontaire : objets imbriqués,
  multilignes `|`/`>`, ancres.
- **Config Zod** (`feedback_config_validation_zod`) : `config.ts` = source de vérité, validée au
  `onKernelRegister`. Le schéma reste PUR (pas de `process.env`) ; l'ENV est mergé dans le builder.
- **Cache** : TTL sur l'index seulement ; le contenu d'une page est toujours relu.
- **`critical=false`** : un échec de boot de ce module ne tue jamais le process (résilience).

## Gotchas

- `onKernelRegister` réassigne `this.options` (config validée) AVANT le `onBoot` des `@services`.
- `scanDocsDir` est **best-effort** : dossier absent → `[]`, fichier illisible → frontmatter vide.
- `DocumentationError.docCode` (string) ≠ `code` (number HTTP du parent `nodefonyError`).
- L'app (`m.isApp`) est exclue du scan modules (son `docs/` = le `docs/` racine).

## Tests / build

```bash
cd src/packages/@nodefony/documentation
npm test            # vitest run — briques pures (frontmatter/slug/docScanner), 0 serveur
npm run build       # rolldown + tsgo → dist/ + dist/types
```

> Service + controller = testés en **intégration live server** (curl `/api/tree` + `/api/page`), pas
> en unit (ils dépendent du Kernel/Container). Validé runtime à la création (2026-05-31).

## Ce qu'il ne faut JAMAIS faire sans accord

- Modifier `rolldown.config.ts` / `tsconfig.json`.
- Concaténer un slug dans un chemin FS (casse l'invariant anti-traversée).
- Rendre du HTML dans ce module (il reste headless — le rendu est côté consommateur).
- Exposer une route admin mono-segment `/nodefony/documentation` (toujours `…/api/*`).

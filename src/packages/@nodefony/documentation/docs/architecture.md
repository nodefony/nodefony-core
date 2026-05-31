---
title: Architecture & flux interne
audience: [developer]
version: "10.0.0"
status: stable
updated: 2026-05-31
---

# Architecture du module Documentation

## Vue d'ensemble

Le module sépare nettement **3 couches**, du plus stable au plus volatil :

```
 briques pures (sans état)      service (état)            controller (sans état)
 ┌───────────────────────┐      ┌──────────────────┐      ┌────────────────────────┐
 │ frontmatter.ts        │      │ DocumentationSvc │      │ DocumentationController│
 │ slug.ts (isSafeSlug)  │◄─────│  #cache (TTL)    │◄─────│  @Get /api/tree        │
 │ docScanner.ts         │      │  #vars (lazy)    │      │  @Get /api/page/{slug} │
 └───────────────────────┘      └──────────────────┘      └────────────────────────┘
   fonctions testables            singleton stateful         réinstancié par requête
   en isolation                   (1 par process)            (délègue tout au service)
```

- **Briques pures** (`src/`) : des fonctions sans état, sans dépendance au Kernel → testables en
  isolation (c'est ce que couvrent les tests vitest). Réutilisables tel quel par un futur générateur
  de site statique ou le RAG.
- **Service** : le seul à porter de l'**état** (cache de l'index, registre de variables). Singleton.
- **Controller** : volontairement **mince**. Recréé à chaque requête, il ne stocke rien et délègue
  tout au service ; il ne fait que traduire un résultat (ou une erreur) en réponse HTTP.

## Le flux d'une page

```
GET /api/page/{slug}
   │
   ├─ isSafeSlug(slug) ?  ──non──►  DocUnsafeSlugError ──► 404 générique (log DOC_UNSAFE_SLUG)
   │  oui
   ├─ #ensureCache()      ──► cache frais (TTL) ? sinon rescan FS + reconstruction de l'index
   ├─ index.get(slug) ?   ──non──►  DocNotFoundError  ──► 404 générique (log DOC_NOT_FOUND)
   │  trouvé → on a le chemin absolu RÉEL (mémorisé au scan)
   ├─ readFile(absPath)   ──► parseFrontmatter → { meta, body }
   ├─ #resolveVars(body)  ──► {{ … }} remplacés par leur provider (version, branch, commit)
   └─ #buildSourceUrl()   ──► lien « Modifier sur GitHub » (chemin RELATIF au repo)
```

Détail important : le **cache porte sur l'index** (l'arbre des pages), pas sur le contenu. Une page est
**toujours relue** sur le disque — on ne sert jamais un markdown périmé.

## Le scan (docScanner)

`scanDocsDir(baseDir, source, exclude)` parcourt récursivement un dossier, garde les `.md`, lit leur
frontmatter, et produit un `ScannedDoc` par fichier — dont le **chemin absolu réel** (`absPath`), seule
source de vérité pour la lecture ultérieure.

Le scan est **best-effort** : un dossier absent renvoie une liste vide (pas d'erreur) — c'est ce qui
permet de scanner les `<module>/docs/` de modules qui n'en ont pas, sans planter. Un fichier illisible
garde un titre dérivé de son nom et un frontmatter vide.

Le service appelle `scanDocsDir` une fois pour la racine, puis une fois par module (sauf l'application
elle-même, dont le `docs/` **est** le `docs/` racine).

## Le schéma de slug (sécurité par construction)

`docs/realtime/socket/01-fan-out.md` → `root~realtime~socket~01-fan-out`
`@nodefony/http/docs/index.md` → `mod~http~index`

Le `/` devient `~` pour tenir sur **un seul segment de route**. La transformation est **à sens unique** :
on ne reconstruit jamais un chemin depuis un slug. C'est la combinaison de deux protections qui rend la
traversée de répertoire impossible :

1. **Allowlist** : le slug doit correspondre à une entrée du scan, sinon `404`.
2. **`isSafeSlug`** (défense en profondeur) : rejet de `..`, `/`, `\`, octet nul, charset non autorisé,
   longueur > 512 — appliqué **avant** la recherche.

## Configuration & cycle de boot

- `config/schema.ts` (Zod) est la **source de vérité** ; le type TS en est dérivé (`z.infer`).
- `onKernelRegister` valide la config (défauts + surcharge `module-documentation` + ENV) et la
  réassigne à `this.options` **avant** que le service ne soit instancié.
- `onKernelReady` enregistre les variables built-in (`version`, `branch`, `commit`) via `GitService`,
  une fois tous les modules bootés.

## Voir aussi

- [Présentation du module](index.md)
- ADR-0001 — emplacement hybride de la doc (racine vs module).

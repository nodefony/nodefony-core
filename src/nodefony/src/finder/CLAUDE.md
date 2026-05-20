# CLAUDE.md — FileClass / Finder

> Sous-module `src/nodefony/src/finder/` du workspace `@nodefony/core` (+ `../FileClass.ts`).
> Pour audience IA en cours de session. Complète [`MEMORY.md`](./MEMORY.md) et [`README.md`](./README.md).

## Rôle

Wrapper fs Node.js + recherche de fichiers avec filtres. Utilisé par le Kernel/Module pour découvrir les fichiers du projet (config, controllers, entities, etc.) et par les commands CLI (build, generate, etc.).

## Classes

| Classe | Fichier | Rôle |
|--------|---------|------|
| **`FileClass`** | `src/FileClass.ts` | Wrapper fs : path, stats, read, write, delete |
| **`File`** | `src/finder/` | Sous-classe spécialisée fichier (vs dossier) |
| **`FileResult`** | `src/finder/` | Résultat de recherche (path + stats) |
| **`Result`** | `src/finder/` | Collection de FileResult |
| **`Finder`** | `src/finder/` | API de recherche avec filtres (glob, regex, depth, exclude) |

## Pattern d'usage Finder

```typescript
import { Finder } from "nodefony";

const finder = new Finder();
finder
  .in("/path/to/dir")
  .name("*.ts")                     // glob pattern
  .notName(/\.test\.ts$/)           // regex exclude
  .depth(2)                          // max 2 niveaux
  .files()                           // skip dirs
  .exclude("node_modules");

const result: Result = await finder.find();
result.forEach((file: FileResult) => {
  console.log(file.path, file.stats.size);
});
```

## FileClass — API basique

```typescript
import { FileClass } from "nodefony";

const file = new FileClass("/path/to/file.txt");
await file.read();              // string
await file.write("contenu");    // Promise<void>
await file.delete();            // Promise<void>
file.stats;                      // fs.Stats
file.exists;                     // boolean
file.basename;                   // "file.txt"
file.dirname;                    // "/path/to"
file.extension;                  // ".txt"
```

## Use cases dans le framework

| Use case | Where |
|----------|-------|
| Découverte des configs `config/dev|prod|test/*.ts` | Kernel boot |
| Découverte des controllers (legacy auto-discovery) | Module register |
| Génération de scaffolds (`nodefony generate:module foo`) | Commands generate |
| Listing des modules dans `src/modules/` | Kernel |
| Audit des fichiers (build, validation) | CLI build/lint |

## Pattern dans Module

```typescript
// Module.ts utilise FileClass pour résoudre son path
setPath(p: string | URL): void {
  const path = p instanceof URL ? fileURLToPath(p) : p;
  
  // Si dist/ → remonter 2 niveaux pour avoir le source dir
  if (basename(dirname(path)) === "dist") {
    this.path = resolve(path, "../..");
  } else {
    this.path = dirname(path);
  }
}
```

## ⚠️ Gotchas

| Symptôme | Cause | Fix |
|----------|-------|-----|
| Path absolu vs relatif confusion | API Node.js varie | `FileClass` normalise au constructor |
| `file://` URL traitée comme string | Faut convertir | `fileURLToPath(url)` avant |
| Stats async vs sync | Surcharge possible | Préférer la version async (`.stat()` vs `.statSync()`) |
| Find pattern `**` profond | Performance dégradée | Limiter avec `.depth(N)` |

## Liens

- [`MEMORY.md`](./MEMORY.md) — internals IA détaillés
- [`README.md`](./README.md) — doc humaine API
- [`../../CLAUDE.md`](../../CLAUDE.md) — workspace core
- Usages : `Module.setPath()`, `BuildCommand`, futur `generate:module` (Phase 11)

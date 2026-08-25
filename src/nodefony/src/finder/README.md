# Finder — FileClass, File, FileResult, Result

Async directory traversal and file metadata utilities for Nodefony.

---

## Overview

| Class        | File            | Extends     | Purpose                        |
| ------------ | --------------- | ----------- | ------------------------------ |
| `FileClass`  | `FileClass.ts`  | —           | File/dir metadata wrapper      |
| `File`       | `File.ts`       | `FileClass` | Tree node with parent/children |
| `Result`     | `Result.ts`     | `Array`     | Generic collection base        |
| `FileResult` | `FileResult.ts` | `Result`    | File-aware collection          |
| `Finder`     | `Finder.ts`     | `Event`     | Async directory traverser      |

---

## FileClass

Wraps `fs.lstatSync` to provide typed metadata, MIME detection, and sync/async I/O.

### Constructor

```typescript
import FileClass from "@nodefony/core/FileClass";

const f = new FileClass("/path/to/file.ts");
// or relative path (resolved from process.cwd())
const f2 = new FileClass("src/index.ts");
```

Throws if path does not exist or is empty.

### Properties

```typescript
f.path; // string — absolute real path (follows symlinks)
f.name; // "file.ts"
f.shortName; // "file"
f.ext; // ".ts"
f.type; // "File" | "Directory" | "symbolicLink" | ...
f.mimeType; // "application/javascript" | false (directories)
f.encoding; // "UTF-8" (files only)
f.extention; // "js" | false
f.dirName; // parent directory path
f.stats; // fs.Stats
f.parse; // path.ParsedPath
```

### Type detection

```typescript
f.isFile(); // boolean
f.isDirectory(); // boolean
f.isSymbolicLink(); // boolean
f.isHidden(); // boolean — name starts with "."
f.checkType(); // "File" | "Directory" | "symbolicLink" | ...
f.matchType("File"); // boolean
f.matchName(/\.ts$/); // RegExpExecArray | null
f.matchName("foo.ts"); // boolean
```

### I/O

```typescript
// Sync
f.content(); // Buffer (default)
f.content("utf8"); // string
f.read("utf8"); // follows symlinks
f.readByLine((line, n) => {}); // synchronous line iteration
f.write("data", { encoding: "utf8" });
f.checkSum(); // md5 hex by default
f.checkSum("sha256"); // sha256 hex

// Async
await f.readAsync("utf8"); // follows symlinks

// File operations
const moved = f.move("/new/path/file.ts"); // returns new FileClass
f.unlink(); // deletes file
```

### JSON

```typescript
f.toJson(); // FileClassInterface object
f.toString(); // JSON.stringify(toJson(), null, "\n")
```

---

## Finder

Async recursive directory traverser with event support.

### Basic usage

```typescript
import Finder from "@nodefony/core/finder/Finder";

const finder = new Finder({ recurse: true, depth: 5 });
const result = await finder.in("/path/to/dir");
// result: FileResult (array of File)
```

### Options

```typescript
interface DefaultSettingsInterface {
  recurse?: boolean; // default false — traverse subdirectories
  depth?: number; // default 10 — max recursion depth (null = unlimited)
  seeHidden?: boolean; // default false — include dotfiles
  match?: RegExp | string; // filter all entry names
  matchFile?: string; // filter file names only
  matchDir?: string; // filter directory names only
  exclude?: string | RegExp; // exclude by name
  excludeFile?: string | RegExp; // exclude files by name
  excludeDir?: string | RegExp; // exclude directories by name
  followSymLink?: boolean; // default false
}
```

### Multiple paths

```typescript
const result = await finder.in(["/path/one", "/path/two"]);
// FileClass input also accepted:
const result2 = await finder.in(new FileClass("/path/to/dir"));
```

### Events

Pass as settings to `in()` or use `finder.on(...)`:

```typescript
await finder.in("/path", {
  onFinish: (result, totals, finder) => {
    console.log(totals.File, "files found");
  },
  onError: (err) => console.error(err),
  onHidden: (file) => console.log("hidden:", file.name),
});
```

### Totals

After each `in()` call, `onFinish` receives:

```typescript
interface TotalInterface {
  Directory: number;
  File: number;
  BlockDevice: number;
  CharacterDevice: number;
  symbolicLink: number;
  Fifo: number;
  Socket: number;
  hidden: number;
}
```

### `checkPath()`

Validates and wraps paths as FileResult — useful for type checking before traversal:

```typescript
const r = finder.checkPath("/path/to/dir"); // FileResult
const r2 = finder.checkPath(["/a", "/b"]); // FileResult with 2 entries
```

---

## FileResult

`FileResult extends Result extends Array` — array of `File` objects with helpers.

```typescript
import FileResult from "@nodefony/core/finder/FileResult";

const result: FileResult = await finder.in("/path");

result.getFiles(); // FileResult — all files (recursive)
result.getDirectories(); // FileResult — all directories (recursive)
result.findByName(/\.ts$/); // FileResult — recursive name search, deduped
result.sortByName(); // FileResult — sorted copy
result.sortByType(); // FileResult — sorted by type
result.uniq(); // FileResult — deduplicated by path
result.toString(); // "file1.ts\nfile2.ts\n..."
result.toJson(); // JSON string with nested children
```

### Working with children

```typescript
const root = result[0]; // File (directory)
root.childrens; // FileResult of immediate children
root.childrens.getFiles(); // recursive flat list of all files
root.childrens.sortByName()[0]; // first child alphabetically
```

---

## Migration notes (2026-05-14)

- `ckeckPath()` renamed to `checkPath()` — update any direct callers
- `find()` renamed to `findByName()` — `find()` now refers to `Array.prototype.find`
- `uniq()` now actually deduplicates by path (was a no-op)
- `lodash` removed from Finder — no longer a dependency
- `parser` refactored from `new Promise(async ...)` anti-pattern to proper `async function`
- `FileClass.defaultEncoding.flag` was `"w"` (bug) — fixed to `"r"`

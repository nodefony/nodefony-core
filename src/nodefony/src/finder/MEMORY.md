# MEMORY.md — FileClass / Finder

> IA uniquement — ultra-concis. Voir README.md pour la doc humaine.

## Docs liées

- [`../../MEMORY.md`](../../MEMORY.md) — workspace core (Service, Container)
- [`../kernel/MEMORY.md`](../kernel/MEMORY.md) — Kernel/Module (consommateurs de FileClass — `setPath`, `loadJson`)
- [`../../../../CLAUDE.md`](../../../../CLAUDE.md) — règles projet

---

## FileClass (`FileClass.ts`)

**Purpose**: Wraps `fs.lstatSync` result with typed metadata + sync/async read/write ops.

**Key props**: `path`, `name`, `shortName`, `ext`, `type`, `mimeType`, `encoding`, `extention`, `dirName`, `stats`, `parse`, `match`

**Type strings**: `"File"`, `"Directory"`, `"BlockDevice"`, `"CharacterDevice"`, `"symbolicLink"`, `"Fifo"`, `"Socket"`

**Constructor**: `new FileClass(path)` — absolute or relative (resolved). Throws on missing path. Calls `getRealpath()` (follows symlinks except for symlink entries).

**Methods**:
- `checkType()` → string | undefined
- `isFile()`, `isDirectory()`, `isSymbolicLink()`, `isHidden()`
- `matchName(RegExp|string)` → bool | RegExpExecArray | null
- `matchType(string)` → bool
- `getMimeType(name?)`, `getExtension(mimeType|false)`
- `checkSum(type="md5")` → hex string
- `content(encoding?)` → string | Buffer (sync)
- `read(encoding?)` → follows symlink, sync
- `readAsync(encoding?)` → async, follows symlink
- `readByLine(cb, encoding?)` → synchronous
- `write(data, options)`, `move(target)` → new FileClass, `unlink()`
- `toJson()` → FileClassInterface, `toString()` → JSON string

**Gotchas**:
- `defaultEncoding.flag = "r"` — was `"w"` (pre-existing bug fixed in 2026-05-14)
- `getRealpath()` resolves symlinks → on macOS `/var` → `/private/var`
- `defautWriteOption.flags` (plural) is silently ignored by writeFileSync (flag without 's' is the real option)

---

## File (`File.ts`)

**Purpose**: Extends FileClass with `parent` + `childrens: FileResult` for tree traversal.

**Props**: `parent: File | null`, `childrens: FileResult`
**get length**: delegates to `childrens.length`
**toJson()**: adds `childrens` (JSON string) and `parent` to FileClassInterface

---

## Result (`Result.ts`)

**Purpose**: Extends `Array` — base collection. Used by Finder to accumulate found entries.

**Methods**: `toJson()`, `toString()`, `clean(cb?)`, `query(...)`, `queryGrep(...)`
**Note**: `query()`/`queryGrep()` delegate to element methods — only useful when elements implement them.

---

## FileResult (`FileResult.ts`)

**Purpose**: Extends `Result` with `File`-aware helpers.

**Methods**:
- `toString()` → newline-separated names
- `toJson(json?)` → JSON string with nested childrens
- `uniq()` → dedup by `file.path` → new FileResult
- `findByName(name: string|RegExp, result?)` → recursive search → deduped FileResult
- `getFiles(result?)`, `getDirectories(result?)` → flat recursive collect
- `sortByName(result?)`, `sortByType(result?)` → sorted copy

**Gotcha**: `find()` from old API renamed to `findByName()` — do NOT use `find()` (that's Array.prototype.find)

---

## Finder (`Finder.ts`)

**Purpose**: Async directory traverser. `extends Event`.

**Settings** (`DefaultSettingsInterface`):
```
recurse: false   depth: 10   seeHidden: false
match: null      exclude: null    excludeFile: null   excludeDir: null
followSymLink: false   matchFile: string   matchDir: string
```

**API**:
- `new Finder(settings)` → sets `this.totals` zero state
- `checkPath(path: string|string[]|FileClass)` → FileResult (throws on bad path) ← was `ckeckPath` (typo fixed 2026-05-14)
- `in(path, settings?)` → `Promise<Result>` — merges settings, fires `onFinish`, calls `clean()`
- `clean()` → removeAllListeners + reset totals to 0

**Totals**: `{ Directory, File, BlockDevice, CharacterDevice, symbolicLink, Fifo, Socket, hidden }`

**Events fired**: `on${type}` per entry, `onHidden`, `onError`, `onFinish(result, totals, finder)`

**Internal `parser` function**:
- Was `new Promise(async ...)` anti-pattern — fixed to proper `async function` with `.call(this, ...)`
- Recursion: `Directory` → recurse with `depth - 1`, `symbolicLink` (followSymLink) → recurse on target if isDirectory()
- depth `null` = unlimited, depth `0` = stop

**Deps**: `node:fs/promises` (no lodash — was removed 2026-05-14), `Event`, `FileResult`, `File`, `FileClass`, `Result`

**Test data** at `src/tests/finder/data/` — all placeholder files are **empty** (0 bytes); create tmp files for read/content tests.

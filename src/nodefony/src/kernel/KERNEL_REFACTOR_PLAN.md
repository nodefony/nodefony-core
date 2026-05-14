# KERNEL_REFACTOR_PLAN.md

> Branche : `claude-ts`. Corrections P1/P2 déjà appliquées (session 2026-05-14).
> Ce document liste les améliorations P3/P4 à traiter dans des sessions futures.

---

## Corrections déjà appliquées ✅

| #   | Problème                                      | Fix                                                    |
| --- | --------------------------------------------- | ------------------------------------------------------ |
| 1   | `preRegistered` jamais mis à `true`           | Set après `onPreRegister` + check `setCommandComplete` |
| 2   | `postReady` jamais mis à `true`               | Set dans le `.then()` après `onPostReady`              |
| 3   | `clean()` → `console.trace("pass clean")`     | Remplacé par `removeAllListeners() + modules = {}`     |
| 4   | `terminate()` → `reject(CliKernel.quit(...))` | Corrigé en `reject(e as Error)`                        |
| 5   | `isModule(subclass: any)`                     | Changé en `isModule(subclass: unknown)`                |

---

## Phase P3 — Qualité code (session ≈ 0.5)

### P3.1 — `isCore()` inutilement async

**Problème** : méthode déclarée `async` mais retourne toujours `false`.
Oblige les appelants à `await` pour rien.

```typescript
// Avant
async isCore(): Promise<boolean> {
  return false;
}

// Après — si la logique reste un stub
isCore(): boolean {
  return false;
}
```

**Alternative** : si `isCore` doit détecter le dépôt `nodefony-core`, implémenter la détection réelle :

```typescript
isCore(): boolean {
  try {
    const pkg = JSON.parse(
      readFileSync(`${this.path}/package.json`, "utf-8")
    );
    return pkg.name === "@nodefony/core";
  } catch {
    return false;
  }
}
```

Cela permettrait de supprimer `await this.isCore()` dans `loadApp()`.

---

### P3.2 — `initCluster()` → `console.log` au lieu de syslog

**Problème** : `console.log(this.logEnv())` (lignes 748 + 754) bypass le syslog → n'apparaît pas dans les logs structurés.

```typescript
// Avant
console.log(this.logEnv());

// Après
this.log(this.logEnv(), "INFO", "CLUSTER");
```

---

### P3.3 — `loadApp()` hardcodé sur `${this.path}/dist/index.js`

**Problème** : pas configurable. Si l'app est dans un autre répertoire ou fichier, impossible.

```typescript
// Avant
this.app = await this.loadModule(`${this.path}/dist/index.js`);

// Après — lire depuis options
private getAppEntry(): string {
  return this.options.appEntry ?? `${this.path}/dist/index.js`;
}

private async loadApp(config?: TypeKernelOptions): Promise<Module> {
  this.app = await this.loadModule(this.getAppEntry());
  ...
}
```

Ajouter `appEntry?: string` à `TypeKernelOptions`.

---

## Phase P4 — Architecture (session ≈ 1)

### P4.1 — GC dans `onReady()` — logique applicative dans le core

**Problème** : bloc GC dans `onReady()` (lignes 411-418) est une responsabilité applicative.
Le framework core ne devrait pas décider quand appeler `global.gc()`.

```typescript
// Supprimer dans onReady() :
if (global && global.gc) {
  this.memoryUsage("MEMORY POST READY ");
  setTimeout(() => {
    if (global && global.gc) global.gc();
    this.memoryUsage("EXPOSE GARBADGE COLLECTOR ON START");
  }, 20000);
} else {
  this.memoryUsage("MEMORY POST READY ");
}
```

**Remplacement** : fire un événement `onMemoryReady` avec stats, laisser l'app décider du GC.

```typescript
// Dans onReady() après initServers()
this.memoryUsage("MEMORY POST READY");
await this.fireAsync("onPostReady", this);
```

---

### P4.2 — `isTrunk()` — duplication de détection

**Problème** : `isTrunk()` appelle `isTypeScript()` puis tente `import(${this.path}/dist/index.js)`.
Cette même import est faite dans `loadApp()`. Double I/O.

```typescript
// isTrunk() peut utiliser this.trunk si déjà résolu
async isTrunk(): Promise<trunkType> {
  if (this.trunk) return this.trunk;
  ...
}
```

**Alternative** : fusionner `isTrunk()` et `loadApp()` en une seule opération qui tente l'import, et déduit le type depuis le résultat.

---

### P4.3 — `ModuleConstructor` interface — signature incorrecte

**Problème** : interface déclarée comme `new(kernel: Kernel, ...args)` mais `Module` réel prend `(name, kernel, path, opts)`.
`addModule()` appelle `new Mod(this, ...args)` — passe le kernel en premier, ce qui ne correspond pas à l'interface `Module`.

```typescript
// Interface actuelle (incorrect)
export interface ModuleConstructor {
  new (kernel: Kernel, ...args: any[]): Module;
}

// Module réel
constructor(name: string, kernel: Kernel, path: string, options?: object)
```

**Options** :

1. Corriger `ModuleConstructor` pour refléter la vraie signature.
2. Ou — rendre `addModule` générique avec une factory function.

**Décision à prendre** : est-ce que `addModule(Mod, ...args)` doit passer `(this, ...args)` ou `(name, this, path, ...args)` ? Le premier implique que `Mod` doit wraper le constructeur.

---

### P4.4 — `fixCommanderCli()` — @ts-ignore

**Problème** : deux `@ts-ignore` dans `fixCommanderCli()` (lignes 347 + 361) pour `splice` sur `commander.options`.
Commander expose probablement une API publique pour ça.

```typescript
// Avant
// @ts-ignore
this.cli.commander?.options.splice(index, 1);

// Après — utiliser l'API commander si disponible
// À vérifier dans la doc Commander v12+
```

---

## Ordre recommandé

```
P3.2 (initCluster syslog)   → 15 min, trivial
P3.1 (isCore sync)          → 15 min + décision impl réelle ou stub
P3.3 (loadApp configurable) → 30 min + test + update options type
P4.1 (GC removal)           → 30 min + check impact HTTP module
P4.3 (ModuleConstructor)    → 1h + impact sur tous les addModule() callers
P4.2 (isTrunk dedup)        → 45 min
P4.4 (fixCommanderCli)      → à traiter en même temps que P4.2 ou P3.3
```

---

## Décisions figées (ne pas remettre en question)

- `Events` reste un bitmask Readonly — pas d'enum (pb tree-shaking).
- `preRegistered/registered/booted/ready/postReady` restent des flags booléens (pas d'enum d'état).
- Lifecycle chain ne change pas : `start → preRegister → boot → onReady`.
- `terminate()` appelle toujours `process.nextTick` pour laisser l'event loop se vider.

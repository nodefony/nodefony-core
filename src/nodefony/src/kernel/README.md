# Kernel — @nodefony/core

Orchestrateur principal du framework Nodefony. Gère le lifecycle complet, le DI, les modules, le réseau et la CLI.

---

## Fichiers

| Fichier | Rôle |
|---------|------|
| `Kernel.ts` | Kernel principal — lifecycle, modules, réseau, config |
| `Module.ts` | Unité fonctionnelle (ex-Bundle) — services, hooks, path, controllers |
| `CliKernel.ts` | CLI — Commander, commandes, package manager, syslog |

---

## Kernel

### Lifecycle

Le kernel suit une chaîne d'événements stricte. Chaque étape appelle la suivante si la commande courante n'est pas encore complète.

```
onInit → onPreStart → onStart → onPreRegister → onRegister
       → onPreBoot → onBoot → onReady → onServersReady → onPostReady
       → onTerminate
```

**Flags de progression** (booléens, jamais régressifs) :
- `started` — après `onStart`
- `booted` — après `onBoot`
- `ready` — après `onReady`
- `postReady` — après `onPostReady`

**Bitmask Events** (frozen, exporté) :
```typescript
import { Events } from "@nodefony/core";
// onInit=1, onPreStart=2, onStart=4, ..., onTerminate=1024
```

### Instanciation

```typescript
import Kernel from "./Kernel";

const kernel = new Kernel("development", cliKernel, {
  log: { active: true, debug: false },
  events: { nbListeners: 60 },
});
```

> **Attention** : le constructeur appelle `Nodefony.setKernel(this)` — il ne peut y avoir qu'un kernel actif par process.

### Environnement

```typescript
kernel.setEnv("development");   // this.environment = "development"
kernel.setNodeEnv("production"); // process.env.NODE_ENV = "production"
```

`"dev"` et `"development"` sont équivalents. Tout autre valeur → `"production"`.

### Modules

```typescript
// Ajouter un module (dynamic import)
const mod = await kernel.loadModule("@my/module");

// Ajouter manuellement
const mod = await kernel.addModule(MyModule);

// Récupérer
const mod = kernel.getModule("MyModule");
const all = kernel.getModules(); // Record<string, Module>
```

### Services kernel

```typescript
// Service instancié directement sur le container kernel
const svc = await kernel.addKernelService(MyService, optionalArg);
```

### Réseau

```typescript
// Toutes les interfaces
kernel.interfaces; // { lo: [...], eth0: [...] }

// Filtres
const ext = kernel.interfacesFilter({ type: "external", family: "IPv4", condition: "&&" });
const loc = kernel.interfacesFilter({ type: "local" });

// Première IP externe
const ip = kernel.getFirstExternalInterface("IPv4");
// ip.address → "192.168.1.10"

// Réseau complet structuré
const net = kernel.getNetwork();
// { external, local, ipv4, ipv6, interfaces }
```

> **Gotcha** : `interfacesFilter({})` — filtre vide → tous les tableaux vides (ni `type` ni `family` → `matchType=false && matchFamily=false → false`).

### Commandes (lifecycle conditionnel)

```typescript
// La commande déclare à quel event elle doit s'arrêter
command.kernelEvent = "onBoot"; // kernel termine après onBoot

// setCommandComplete retourne true quand le kernel doit s'arrêter
if (kernel.setCommandComplete(Events.onBoot)) {
  return kernel.terminate(0);
}
```

### Config

```typescript
// Lire la config courante
const opts = kernel.readConfig();

// Merger une config
kernel.readConfig({ log: { debug: true } });
```

### Utilitaires

```typescript
kernel.checkPath("./relative")     // → path absolu ou null si vide
kernel.isConsole()                 // type === "CONSOLE"
kernel.isModule(MyModule)          // isSubclassOf check — throws si null
kernel.clusterIsMaster()           // cluster.isPrimary
kernel.stats()                     // { memory: process.memoryUsage() }
kernel.memoryUsage("POST BOOT")    // log RSS/heap avec niceBytes
kernel.setDomain()                 // "selectAuto" → 1ère IP externe, sinon options.domain
kernel.logEnv()                    // string coloré type/cluster/env/debug
```

### Terminate

```typescript
await kernel.terminate(0); // fire onTerminate → process.nextTick → CliKernel.quit(code)
```

---

## Module

### Créer un module

```typescript
import Module from "./Module";
import type { IKernel } from "../types/IKernel";

class AppModule extends Module {
  constructor(kernel: Kernel) {
    super("app", kernel, import.meta.url, {
      watch: true,
    });
  }

  // Lifecycle hooks — OBLIGATOIREMENT des méthodes prototype
  async onKernelRegister(): Promise<this> {
    this.log("register");
    return this;
  }

  async onKernelBoot(): Promise<this> {
    await this.addService(MyService);
    return this;
  }

  async onKernelReady(): Promise<this> {
    this.log("ready");
    return this;
  }
}

export default AppModule;
```

> **Attention** : Les hooks doivent être des **méthodes prototype**. Une arrow function ou property initializer ne sera pas visible lors de l'appel de `setEvents()` dans `super()`.

### setPath

`setPath()` résout le répertoire du module à partir du path fourni au constructeur.

| Path fourni | Résultat |
|-------------|----------|
| `import.meta.url` (fichier dans `dist/`) | `dirname(dirname(fileURLToPath(url)))` |
| `/path/to/module/package.json` | `/path/to/module` |
| `/path/to/module` | `/path/to` |

### Services

```typescript
// Ajouter un service
const svc = await module.addService(MyService, optionalArg);

// Charger depuis un chemin
const svc = await module.loadService("./path/to/service.js");
```

### Config overrides inter-modules

```typescript
// Dans les options du module A, surcharger la config du module B :
{
  "Module-B": {
    "db": { "host": "localhost" }
  }
}
```

`readOverrideModuleConfig()` est appelé automatiquement au `onPreBoot`.

### Package.json

```typescript
const pkg = await module.getPackageJson();
// pkg.name, pkg.version, pkg.dependencies, ...

const deps = module.getDependencies();
// [ "express", "@nodefony/http", ... ]
// Note : devDependencies exclus. Doublons possibles si dep dans dependencies ET peerDependencies.
```

### Commandes CLI

```typescript
// Dans onKernelRegister ou onKernelBoot
module.addCommand(MyCommand); // kernel.cli requis
```

### Package manager

```typescript
await module.install();         // npm/pnpm/yarn install
await module.install(true);     // install --force
await module.outdated();        // check outdated
```

### Charger du JSON

```typescript
const config = await module.loadJson("./config/app.json");
const abs = await module.loadJson("/absolute/path/config.json");
```

### Controllers

```typescript
// Module.controllers est un registre STATIQUE partagé
const ctrl = module.getController("MyController");
const all = module.getControllers(); // Record<string, TypeController>
```

---

## CliKernel

### Utilisation

```typescript
import CliKernel from "./CliKernel";

const cli = new CliKernel("development");
await cli.start();
```

### Package manager

```typescript
cli.setPackageManager("pnpm"); // "yarn" | "pnpm" | default=npm
// cli.packageManager est désormais cli.pnpm
```

### Commandes

```typescript
cli.addCommand(MyCommand);
cli.parseCommand(process.argv);
await cli.parseCommandAsync(process.argv);
```

**9 commandes enregistrées par `start()`** : `start`, `dev`, `build`, `prod`, `staging`, `install`, `outdated`, `pm2`, `kill`.

### niceBytes (static)

```typescript
CliKernel.niceBytes(1024)    // "1.0 KB"
CliKernel.niceBytes(10240)   // "10 KB"
CliKernel.niceBytes(1048576) // "1.0 MB"
CliKernel.niceBytes(0)       // "0 Bytes"
```

### initSyslog

Filtre de sévérité :
- Par défaut : niveaux 0–6 (EMERGENCY → INFO)
- `debug=true` : ajoute 7 (DEBUG)
- `kernel.type === "SERVER"` + `env === "dev"` : ajoute 4 (WARNING) et 5 (NOTICE)
- `--json` : silencieux

### terminate

```typescript
await cli.terminate(0);
// Avec kernel → kernel.terminate(0)
// Sans kernel → Cli.terminate(0)
```

---

## API rapide

### Kernel

| Méthode | Signature | Notes |
|---------|-----------|-------|
| `start()` | `async (): Promise<this>` | Lance le lifecycle complet |
| `terminate(code?)` | `async (code?: number): Promise<this>` | Fire onTerminate + quit |
| `addModule(Ctor)` | `async (...): Promise<Module>` | Instancie + enregistre |
| `getModule(name)` | `(name: string): Module` | Lookup dans `this.modules` |
| `addKernelService(Ctor)` | `async (...): Promise<Service\|null>` | Service sur container kernel |
| `interfacesFilter(f?)` | `(filters?: FilterInterface): NetworkInterface` | Filtre réseau |
| `checkPath(p)` | `(p: string): string \| null` | Absolu/relatif/null |
| `setEnv(env)` | `(env: EnvironmentType): void` | Normalise environment |
| `setNodeEnv(env)` | `(env: EnvironmentType): void` | Side-effect process.env |
| `isConsole()` | `(): boolean` | type === "CONSOLE" |
| `isModule(cls)` | `(cls: any): boolean` | Throws si null |
| `stats()` | `(): Stats` | { memory: MemoryStats } |
| `memoryUsage(msg?)` | `(msg?, sev?): void` | Log RSS/heap |
| `readConfig(cfg?)` | `(cfg?: TypeKernelOptions): TypeKernelOptions` | Merge ou retourne options |
| `setCommandComplete(p)` | `(p: number): boolean` | Bitmask + check commande |

### Module

| Méthode | Notes |
|---------|-------|
| `setPath(p)` | Résout répertoire du module |
| `setEvents()` | Wire hooks lifecycle — appelé en constructor |
| `addService(Ctor, ...args)` | Instancie + initialize |
| `getPackageJson()` | Lit package.json async |
| `getDependencies()` | deps + peerDeps (pas devDeps) |
| `loadJson(url, cwd?)` | Parse JSON absolu ou relatif |
| `addCommand(Ctor)` | Nécessite kernel.cli |
| `readOverrideModuleConfig()` | Parse keys Module-<name> |
| `install(force?)` | Via packageManager |
| `getController(name)` | Registre static controllers |

---

## Tests

```bash
cd src/nodefony && npm test
# 571 tests ✅ (Kernel: 111, Module: 74, CliKernel: 71)
```

Tests dans `src/nodefony/src/tests/Kernel.test.ts`, `Module.test.ts`, `CliKernel.test.ts`.

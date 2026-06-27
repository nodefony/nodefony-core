# Recettes CŒUR — Service, Module, CLI, config, ALS, erreurs

> Chargé à la demande par `nodefony-framework-dev/SKILL.md`. Recettes copier-coller **vérifiées sur le source**.
> Détail-journal = `git log`. Mettre à jour = éditer la section en place (jamais d'append daté).

## Sommaire

- Service injectable (DI) + `@inject` vs `@Inject`
- Logging (`Service.log`)
- Module (hooks lifecycle)
- Commande CLI + exécution
- Lazy alloc + cleanup listener (patterns perf canoniques)
- RequestContext (ALS) — propagation per-request
- Config de module (`nodefony/config/config.ts`)
- Config de l'APPLICATION (`nodefony.config.ts` + `env.ts`, `defineConfig`)
- Interfaces & types (standard universel)
- Erreurs typées (`nodefonyError` / `HttpError`)

---

### Service injectable (DI)

```typescript
import { injectable, inject, Service } from "nodefony";

@injectable({ singleton: true, name: "user-service" }) // défaut scope=singleton
export class UserService extends Service {
  // ⚠️ tsx (tests) n'émet PAS design:paramtypes → TOUJOURS nommer @inject explicitement
  constructor(
    @inject("database") private db: Database,
    @inject("syslog") private log: Syslog,
  ) {
    super("user-service");
  }
  async findById(id: string): Promise<IUser | null> {
    this.log.log(`lookup ${id}`, "DEBUG");
    return this.db.query<IUser>("SELECT * FROM users WHERE id = ?", [id]); // bindé
  }
}
```

- `@inject("x")` (minuscule) = **paramètre ctor** (`inject:services` sur le constructeur).
- `@Inject("x")` (Majuscule) = **propriété** post-ctor (`inject:properties` sur le **prototype**),
  `private x!: T` (definite assignment ; `undefined` pendant `super()`). Confondre les deux = bug silencieux.
- Singleton déjà dans `kernel.get(name)` → court-circuit (pas de réinstanciation). `"transient"` → toujours new.
- Récup runtime : `kernel.get<UserService>("user-service")`.
- Sévérités log : `EMERGENCY ALERT CRITIC(!=CRITICAL) ERROR WARNING NOTICE INFO DEBUG` (+ `SPINNER=-1`).

### Logging (`Service.log` — tout service en hérite)

```typescript
this.log(payload, "INFO"); // → retourne un Pdu
this.log(err, "ERROR", "AUTH", "login failed"); // (payload, severity, msgid?, msg?)
this.spinlog("Chargement…"); // SPINNER (-1, non bufferisé)
```

- Sévérités (enum `SysLogSeverity`) : `EMERGENCY(0) ALERT(1) CRITIC(2) ERROR(3) WARNING(4) NOTICE(5)
INFO(6) DEBUG(7) SPINNER(-1)`. ⚠️ **`CRITIC`, jamais `CRITICAL`**. `pdu.severity`=number, `pdu.severityName`=string.
- `msgid` = catégorie (`"HTTP-KERNEL"`, `"ROUTER"`, `"FIREWALL"`…). Format console : `HH:MM:SS.mmm SEV MSGID : payload`.
- Ne **jamais** logger après `clean()` (syslog null → Pdu standalone perdu). Filtrage = AVANT `fire("onLog")` (CPU).
- Greps : strip ANSI `sed 's/\x1b\[[0-9;]*m//g'` (ou skill `nodefony-tail-error-logs`).
- **Sink = driver enfichable** (env `file`/`null`/`stdout-pipe`) : `FileSink` **async par défaut** (jamais bloquer
  l'event-loop sur disque lent), `sync` opt-in. **Invariant** : un fatal (sévérité ≤ 3) part en `writeSync` immédiat
  → jamais perdu au `SIGKILL`. Levier perf = coalescence (ring+tick), pas le fd-par-worker.

### Module (hooks lifecycle)

```typescript
import { Module, services } from "nodefony";

@services([UserService, MailerService]) // → enregistrés en onPreBoot
export class MyModule extends Module {
  static readonly path: string = import.meta.url; // OBLIGATOIRE (sert setPath)

  // hooks = méthodes PROTOTYPE (jamais arrow/property)
  async onKernelRegister(): Promise<this> {
    return this;
  } // kernel.once("onRegister")
  async onKernelBoot(): Promise<this> {
    return this;
  } // kernel.once("onBoot")
  async onKernelReady(): Promise<this> {
    return this;
  } // kernel.once("onReady")
}
```

- `@services([...])` → `onPreBoot` (erreurs **catchées**+log, boot continue → vérifier
  `container.has("x")`). ⚠️ `@modules` et `@entities` N'EXISTENT PLUS (retirés — la liste des
  modules vit dans le manifeste `config.modules` de `nodefony.config.ts`, cf chantier defineConfig).
- Le ctor `Module` attache **toujours** 1 listener (`onBoot` → service `rollup`) même sans hook : normal.
- `onKernelBoot` = bon endroit pour s'enregistrer comme **producteur admin** ou **storage de session**.

### Commande CLI

```typescript
import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";

const options: OptionsCommandInterface = {
  showBanner: true,
  kernelEvent: "onReady",
};
// kernelEvent = phase attendue avant generate() : onPostReady(serveurs prêts) | onReady(services) |
//               onBoot(modules) | onPreStart(quasi rien). Défaut "onPostReady".

export class RoutesListCommand extends Command {
  constructor(cli: CliKernel) {
    super("http:routes:list", "Liste les routes", cli, options); // namespace <module>:<action>
    this.alias("routes");
    this.addOption("--json", "Sortie JSON");
  }
  override async onKernelStart(): Promise<void> {
    // AVANT Kernel.boot — config env/type
    (this.cli as CliKernel).setType("CONSOLE");
  }
  override async generate(opts: { json?: boolean }): Promise<this> {
    // APRÈS la phase kernelEvent
    // ⚠️ Commander passe l'instance Cmd en DERNIER arg → generate(userArg, cmd)
    return this;
  }
}
// enregistrement module : module.addCommand(RoutesListCommand) — nécessite kernel.cli != null
```

- `CliKernel extends Cli` (PAS Kernel). `this.environment` est **`undefined` au constructeur** →
  conditionner dans `onKernelStart()`, jamais dans le ctor. Ne PAS rappeler `setCommandVersion()`
  (le ctor `Cli` ajoute déjà `-v`). Built-in : Start/Dev/Build/Prod/Cluster/Install/Outdated
  (`Staging`/`Pm2`/`Kill` RETIRÉS — staging alias mort 2026-05-25, PM2 sorti C6 2026-05-29).

### CLI — exécution & commandes (vue d'ensemble)

```bash
npx nodefony development          # DevCommand (alias `dev`) → DevSupervisor auto-restart
npx nodefony production           # foreground in-process (cloud-native, 0 daemon) · multi-process = `cluster -w N`
npx nodefony build               # rollup tous workspaces · npx nodefony --help / --version
npx nodefony <module>:<action>   # commande de module (ex. http:routes:list) — namespace obligatoire
```

- **2 modes** : _standalone_ (`Command.action()` → `run()` → `generate()`, sans kernel) ; _kernel_
  (`setEvents()` → `kernel.once(kernelEvent, action)`). `kernelEvent` = phase attendue avant `generate()` :
  `onPostReady`(serveurs prêts, défaut) / `onReady`(services) / `onBoot`(modules) / `onPreStart`(quasi rien).
- **Lifecycle** : ctor `addCommand` → `onKernelStart()` (pré-boot : env/type/packageManager) → `kernel.start()`
  → `generate(opts, cmd)` (⚠️ Commander passe l'instance `Cmd` en **dernier** arg). `setEvents()` idempotent (guard `eventsRegistered`).
- **Module CLI** : `module.addCommand(Ctor)` (nécessite `kernel.cli != null`). Namespace `<module>:<action>`
  (`security:user:add`, `orm:migrate`). ⚠️ **Commandes de module cassées sur claude-ts** (bug pré-existant,
  mémoire `project_cli_commands_broken_claude_ts`) → brancher dans une branche dédiée, Phase 11 non finalisée (0 test d'intégration).
- Helpers `Cli` : `niceBytes` (`1024`→`"1.0 KB"`), timers (`startTimer`/`stopTimer`), `setProcessTitle`, banner.
  Réf : `src/nodefony/src/{cli,command,kernel}/{CLAUDE,MEMORY}.md`.

### Lazy alloc + cleanup listener (patterns perf canoniques)

```typescript
// Lazy : getter qui n'alloue qu'au 1ᵉʳ accès (cf Context.signal)
private _phaseIndex: Map<string, number> | null = null;
get phaseIndex(): Map<string, number> {
  if (this._phaseIndex === null) this._phaseIndex = new Map();   // jamais dans le ctor
  return this._phaseIndex;
}
// Cleanup d'une paire finish/close (once n'auto-detache PAS le jumeau)
const onEnd = () => { res.removeListener("finish", onEnd); res.removeListener("close", onEnd); /* … */ };
res.once("finish", onEnd); res.once("close", onEnd);
// Listener différé qui lit l'ALS → bind
res.once("close", AsyncResource.bind(() => { /* RequestContext.get() OK ici */ }));
```

### RequestContext (ALS) — propagation per-request

```typescript
import { RequestContext } from "nodefony";
RequestContext.run({ requestId, scheme, user }, async () => {
  /* tout le pipeline */
});
RequestContext.get(); // payload | undefined
RequestContext.getUserId(); // string | undefined  (rempli par security P6)
RequestContext.pushQuery({ sql, durationMs }); // no-op si !isProfiling() (gratuit en prod)
```

⚠️ Ne pas lire l'ALS depuis un callback détaché (pool ORM, listener non-bind) → capturer la réf du
buffer sur le contexte valide.

### Config de module (`nodefony/config/config.ts`)

```typescript
import path from "node:path";
import { Nodefony, type Kernel } from "nodefony";

export default {
  // Port d'écoute du sous-système. Défaut 0 = aléatoire. Prod : fixer via env.
  port: 0,
  connectors: {
    default: {
      // ⚠️ LAZY (getter) — le kernel n'existe PAS au moment de l'import → deref eager = crash.
      get filename() {
        return path.resolve(
          (Nodefony.getKernel() as Kernel).path,
          "nodefony/databases/x.db",
        );
      },
    },
  },
};
```

- **Commenter CHAQUE option** (FR) : rôle + valeur par défaut + reco prod + exemple de surcharge. Réf =
  `@nodefony/http/nodefony/config/config.ts`.
- ⚠️ **JAMAIS dérefencer le kernel au top-level** (config évaluée à l'import) → **getter lazy** (résolu
  au boot/merge) ou **guard** `Nodefony.getKernel()?.tmpDir?.path ?? "/tmp"`. Sinon module non-importable/testable.
- **Surcharge** : l'app colocalise la config d'un module via **`use("@nodefony/x", { … })`** dans le
  manifeste `modules` de `nodefony.config.ts` (deep-merge sous la config DEFAULT du module avant sa
  validation Zod) ; un module pose `Module-<name>` dans ses options → `readOverrideModuleConfig()` merge
  (`extend(mod.options, override)`). Les clés legacy `module-<name>` à la racine sont remplacées par `use()`.
- **Typage `use()` (OBLIGATOIRE)** : pour que `use("@nodefony/x", …)` propose les clés du module, le module
  **augmente le registre** : `declare module "nodefony" { interface NodefonyModuleConfig { "@nodefony/x": IXConfig } }`
  (declaration merging, pattern Nuxt). Sans ça → `Record<string, unknown>` (accepté, mais 0 auto-complétion).

### Config de l'APPLICATION (`nodefony.config.ts` + `env.ts`) — descripteur `defineConfig`

L'app **n'est plus** un dossier `nodefony/config/*` : **`nodefony.config.ts`** (racine) =
`defineConfig((ctx) => ({ … modules: [ use(…) ] }))` + **`env.ts`** (racine) = `defineEnv` (SEUL lecteur
de `process.env`). Le core porte les défauts (`defaultAppConfig`) ; l'app écrit ses écarts (deep-merge).
`index.ts` racine : `import config from "./nodefony.config"` + `export { env }` (lu par le Kernel pour
`ctx.env`). Validation Zod intégrée au `resolve()` (core) → **plus de `export { validateConfig }`**.

```typescript
import { defineConfig, use } from "nodefony";
import type { env } from "./env";
export default defineConfig<typeof env>((ctx) => ({
  domain: ctx.isProd ? "0.0.0.0" : "127.0.0.1", // par-env via ctx (jamais config.prod.ts)
  log: { debug: ctx.isProd ? [] : "*", driver: ctx.env.NF_LOG_DRIVER },
  modules: [
    use(
      "@nodefony/http",
      { trustedHosts: ["localhost"] },
      { policy: "mandatory" },
    ),
  ],
}));
```

- `ctx = { env, appEnv, runtimeEnv, isProd, isDev, isTest }`. ⚠️ `as const` sur `envEnum([...])`.
- Config cassée au boot → diagnostic clair + `EX_CONFIG` (78) via `Kernel.bootConfigError`.
- Cluster = fichier séparé kernel-free (`nodefony/config/cluster/cluster.config.ts`, lu standalone par le master).
- Guide complet : `docs/guides/configuration.md`. Règles figées : CLAUDE.md racine § « Configuration de l'APPLICATION ».

### Interfaces & types (standard universel — TOUS les modules)

```typescript
// nodefony/interfaces/IThing.ts  → puis barrel nodefony/interfaces/index.ts
export interface IThing {
  id: string;
  name: string;
}

// index.ts du module — re-exporter classes (valeur) ET types (effacés)
export { ThingService } from "./nodefony/service/ThingService";
export type { IThing } from "./nodefony/interfaces/IThing";
```

- **JAMAIS de `.d.ts` écrit à la main** (diverge du code) — types **générés** par Rollup dans `dist/types/`.
- `package.json` obligatoire : `"types": "./dist/types/index.d.ts"` + `"exports": { ".": { "types":
"./dist/types/index.d.ts", "import": "./dist/index.js" } }` (TS 4.7+ lit `exports.types` en priorité).
- Interfaces préfixées **`I`**, dossier `nodefony/interfaces/` + barrel. Type front isomorphe → tsconfig
  `customConditions: ["browser"]` (résout `nodefony` vers le build client). Audit dérive : `nodefony-check-externals`.

### Erreurs typées (`nodefonyError` / `HttpError`)

```typescript
import { nodefonyError } from "nodefony";
throw new nodefonyError("user not found", 404); // (message?: string | Error, code?: number)
try {
  /* … */
} catch (e) {
  throw new nodefonyError(e as Error, 500);
} // wrap : copie message/code/stack
```

- `nodefonyError` ajoute `code: number|null`, `errorType` auto-détecté (TypeError/SystemError/Assertion/
  Mongoose/ClientError), `toJSON()` **filtré** (exclut `context`/`resolver`/`container`/`secure` =
  réf circulaires + fuite). `getDefaultMessage()` remplit le message depuis `STATUS_CODES` si seul `code` fourni.
- Pipeline HTTP/WS : **`HttpError`** (`@nodefony/http`) `extends nodefonyError`, ctor `(message?, code?, context?)` →
  extrait `controller`/`action`/`jsonResponse` de `(context as any)?.resolver` (⚠️ http **ne peut PAS** importer
  framework → cycle ; toujours passer par `resolver` du context). Erreur métier d'un module = étendre `nodefonyError`
  (jamais `globalThis.Error` exporté tel quel — c'est `nodefonyError`, l'ancien export `Error` a été renommé).

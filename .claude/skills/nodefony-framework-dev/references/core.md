# Core (`nodefony`) — référence complète (recettes + API + internals + gotchas)

> Chargé à la demande par `SKILL.md`. **1 concern = 1 fichier** : recettes copier-coller PUIS API publique + internals + gotchas du module. Vérité courante (édition en place, git = historique).

## ▸ Partie A — Recettes (copier-coller, usage)

> Chargé à la demande par `nodefony-framework-dev/SKILL.md`. Recettes copier-coller **vérifiées sur le source**.
> Détail-journal = `git log`. Mettre à jour = éditer la section en place (jamais d'append daté).

## Sommaire

- Service injectable (DI) + `@Inject` vs `@Inject`
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

> **Dans une APPLICATION, ne l'écris pas à la main : `nodefony create service <Nom>
[--module <m>]`.** Il pose la classe + son interface et câble le `@services([…])`
> (qu'il CRÉE si la cible n'en a pas). La forme ci-dessous reste la référence pour le
> REPO framework, où le CLI ne scaffolde pas. Mesuré au banc : sans ce générateur, un
> agent écrit une classe à méthodes `static` — elle compile, elle marche, et elle reste
> invisible au conteneur. `nodefony check` attrape le cas inverse (service `@injectable`
> que personne ne déclare).

```typescript
import { injectable, Inject, Module, Service, Container } from "nodefony";

@injectable() // token = la CLASSE ; scope "singleton" par défaut
export class UserService extends Service {
  // 1er param = le MODULE porteur (tout service en a besoin : il y prend son container).
  // 🔴 Une dépendance se NOMME (@Inject("…")) : le type d'un paramètre ne résout rien (ADR-0018).
  constructor(
    module: Module,
    @Inject("DrizzleService") private db: DrizzleService,
  ) {
    super("userService", module.container as Container); // ← LA clé du container
  }
  async findById(id: string): Promise<IUser | null> {
    this.log(`lookup ${id}`, "DEBUG");
    return this.db.query<IUser>("SELECT * FROM users WHERE id = ?", [id]); // bindé
  }
}
```

**Les DEUX noms d'un service** (la chose à comprendre une fois pour toutes) :

| Ce que tu écris             | Ce que ça nomme                            | Sert à                      |
| --------------------------- | ------------------------------------------ | --------------------------- |
| `@injectable()` / `("Foo")` | la **CLASSE**, au registre des injectables | `@Inject("…")`              |
| `super("userService", …)`   | l'**INSTANCE**, sa clé dans le container   | `kernel.get("userService")` |

Ils n'ont **aucune raison** d'être égaux, et le décorateur ne peut pas connaître le second (il
s'exécute au _chargement_ de la classe ; `super()` à la _construction_). Le DI les réconcilie via la
CLASSE : la clé container est **apprise** quand `addService` pose l'instance, donc `@Inject("UserService")`
(nom de classe) **et** `kernel.get("userService")` (clé) rendent la MÊME instance.
→ Reste libre de les aligner (`HttpKernel`/`"HttpKernel"`) ou non (`Router`/`"router"`) : les deux marchent.

- `@Inject("x")` = **paramètre ctor** (`inject:services` sur le constructeur, sparse par position). Un paramètre
  sans `@Inject` reçoit l'argument positionnel, ou `undefined` — son TYPE ne résout rien, même inscrit
  (`emitDecoratorMetadata: false`, garde `src/nodefony/src/tests/noTypeMetadata.test.ts`). Pas d'injection de propriété.
- **`singleton` (défaut) = UNE instance**, mémoïsée au container. `"transient"` → toujours un new.
  `"request"` → UNE instance par requête (par CONNEXION en WS), rangée sur le scope DI de la
  requête, ctor `(scope, ...deps)`, `clean()` LIFO à la fermeture. Un détenteur singleton
  (service, ou contrôleur sans `@Scope("request")` — le défaut) est refusé : `BootConfigurationError`.
- ⚠️ **Une dépendance ne reçoit JAMAIS les arguments de son parent** : elle se résout (container),
  elle ne s'hérite pas. Donc un service résolu **comme dépendance** n'a pas d'arguments — s'il exige
  son module, il ne doit être atteint qu'après avoir été posé (c'est le rôle de `@services`).

**Utiliser le service** — trois chemins, tous vers la même instance :

```typescript
// 1. En dépendance d'un autre service (le plus courant) — par NOM DE CLASSE
@injectable()
export class OrderService extends Service {
  constructor(
    module: Module,
    @Inject("UserService") private users: UserService,
  ) {
    super("orderService", module.container as Container);
  }
}

// 2. Depuis un controller (singleton par défaut) — par la clé container
class OrderController extends Controller {
  async index() {
    const users = this.kernel.get<UserService>("userService");
    return this.renderJson(await users.findById("42"));
  }
}

// 3. N'importe où, hors DI
const users = Nodefony.getKernel()?.get<UserService>("userService");
```

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

- `@services([...])` → instancie à `onPreBoot` et pose chaque instance au container.
  ⚠️ `@modules` et `@entities` N'EXISTENT PLUS (retirés — la liste des modules vit dans le manifeste
  `config.modules` de `nodefony.config.ts`, cf chantier defineConfig).
- **L'ORDRE de la liste ne compte pas** : il est recalculé depuis les dépendances déclarées
  (`@Inject` + types) — tri topologique **stable** (une liste déjà correcte sort inchangée). Un cycle
  lève une erreur qui NOMME le cycle. → Écris la liste dans l'ordre qui te parle.
- **Un service qui échoue suit la politique de boot** (jamais un skip silencieux) :
  **fatal en production** (ou sur erreur de config) → le boot s'interrompt ; **fail-soft ailleurs**,
  mais **ANNONCÉ** — agrégé au BootReport, qui fait dire « boot DÉGRADÉ » au superviseur. Vaut pour
  la **construction** comme pour l'`init`. Override par module : `static override critical = false`.
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
npx nodefony build               # rolldown tous workspaces · npx nodefony --help / --version
npx nodefony <module>:<action>   # commande de module (ex. http:routes:list) — namespace obligatoire
```

- **2 modes** : _standalone_ (`Command.action()` → `run()` → `generate()`, sans kernel) ; _kernel_
  (`setEvents()` → `kernel.once(kernelEvent, action)`). `kernelEvent` = phase attendue avant `generate()` :
  `onPostReady`(serveurs prêts, défaut) / `onReady`(services) / `onBoot`(modules) / `onPreStart`(quasi rien).
- **Lifecycle** : ctor `addCommand` → `onKernelStart()` (pré-boot : env/type/packageManager) → `kernel.start()`
  → `generate(opts, cmd)` (⚠️ Commander passe l'instance `Cmd` en **dernier** arg). `setEvents()` idempotent (guard `eventsRegistered`).
- **Module CLI** : `module.addCommand(Ctor)` (nécessite `kernel.cli != null`). Namespace `<module>:<action>`
  (`security:user:add`, `orm:migrate`). ⚠️ **Commandes de module cassées** (bug pré-existant,
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
RequestContext.getUserId(); // string | null — `getAuthenticatedUser()?.id`, l'anonyme rend null
RequestContext.getScope(); // IScope | undefined — le scope DI de LA requête (fermé → undefined)
RequestContext.requireScope(); // IScope, ou lève en nommant la cause (hors requête / sans scope / fermé)
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

### Config figée, et surchargée par requête (ADR-0012)

- `module.options` est **gelée en profondeur** à la fin de `onReady` (`freezeConfigTree`) : la compléter
  AU BOOT, jamais après — une écriture tardive lève `TypeError`. Édition à chaud (dev) = remplacement
  (`withResolvedPath` + `kernel.replaceModuleOptions`), jamais écriture en place.
- **Ouvrir une clé à la surcharge par requête** (rare — la clé doit être RELUE par requête et sans
  enjeu de sécurité) :
  1. `config.ts` : `export const xOverlaySchema = z.strictObject({ cle: overlayField(schema.shape.cle) }).partial()`
     — `overlayField` retire le défaut, sinon il s'injecte dans chaque calque ;
  2. classe du module : `override overlaySchema = xOverlaySchema;`
  3. `declare module "nodefony" { interface NodefonyModuleOverlay { "@x/y": z.input<typeof xOverlaySchema> } }`
  4. le LECTEUR lit `useConfig("@x/y").cle` au moment de s'en servir (sinon calque accepté puis ignoré) ;
  5. tests : calque vide = `{}` (aucun défaut injecté), clé hors liste refusée, banc réel avec requête voisine.
- Poser un calque : écouteur `kernel.on("onRequestScope", …)` → `overlayConfig("@x/y", { … })` — seul
  point dans la bulle ALS AVANT la lecture du corps. Modèle : `@nodefony/http` (`httpOverlaySchema`).

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

## ▸ Partie B — API, internals & gotchas

> Chargé à la demande par `nodefony-framework-dev/SKILL.md`. **Surface API + internals + gotchas
> propres au core** — pour coder contre le paquet npm `nodefony` SANS son source (consumer = dist seul).
> Recettes d'usage (écrire un service/module/CLI/config/ALS/erreurs) → `references/core.md`.
> Gotchas transverses (hot path, RFC, idempotence…) → `references/gotchas.md`. Ici = ce que ces deux-là ne disent pas.
>
> **Ancres `fichier:ligne`** vérifiées au source, relatives à `src/nodefony/src/` (sauf mention `@nodefony/…`).
> Le paquet s'appelle **`nodefony`** (PAS `@nodefony/core` — héritage JS). Named exports only, ESM only, 0 default.

## Sommaire

- [Purpose](#purpose)
- [Surface API publique](#surface-api-publique)
  - [Façade `Nodefony`](#façade-nodefony)
  - [`Service`](#service)
  - [`Container` / `Scope`](#container--scope)
  - [`Event` (+ `emitAsyncGuarded`)](#event--emitasyncguarded)
  - [`Kernel` / `CliKernel`](#kernel--clikernel)
  - [`Module`](#module)
  - [DI : `Injector` + `@injectable`/`@Inject`/`@Inject`](#di--injector--injectableinjectinject)
  - [`Syslog` / `Pdu`](#syslog--pdu)
  - [`Cli` / `Command`](#cli--command)
  - [`FileClass` / `Finder`](#fileclass--finder)
  - [`RequestContext` (ALS)](#requestcontext-als)
  - [`nodefonyError`](#nodefonyerror)
- [Internals](#internals)
  - [Algo DI (résolution + scopes)](#algo-di-résolution--scopes)
  - [Lifecycle kernel (ordre des fires)](#lifecycle-kernel-ordre-des-fires)
  - [`applyModuleConfigOverrides`](#applymoduleconfigoverrides)
  - [Event = MÉCANIQUE, Kernel = POLITIQUE](#event--mécanique-kernel--politique)
  - [Propagation ALS](#propagation-als)
- [Gotchas SPÉCIFIQUES core](#gotchas-spécifiques-core)
- [Verdict `FileClass.from` / `getFileAsync`](#verdict-fileclassfrom--getfileasync)

---

## Purpose

`nodefony` = le **socle isomorphe** (Node + navigateur) dont héritent tous les paquets (`@nodefony/http`,
`framework`, `security`, ORM, IA). Il fournit, sans aucune dépendance réseau :

- **`Service`** — classe de base de TOUT composant (Kernel/Module/Controller/adapters) : DI + EventEmitter (composé) + logging.
- **`Container`/`Scope`** — DI hiérarchique : services nommés + scopes per-requête (aucune configuration : `module.options`, figée à `onReady`, calque par requête = `overlayConfig`/`useConfig`).
- **`Kernel`/`Module`** — orchestrateur de boot + unité fonctionnelle (ex-Bundle) avec hooks lifecycle.
- **`Injector` + décorateurs** — résolution DI metadata-driven (`reflect-metadata`), détection de cycle.
- **`Syslog`/`Pdu`** — log structuré RFC 5424, ring buffer O(1), transports + sinks + drivers enfichables.
- **`Cli`/`Command`/`CliKernel`** — framework CLI (wrapper Commander) + lifecycle.
- **`FileClass`/`Finder`** — wrapper fs typé + traversée de répertoires.
- **`RequestContext`** — façade `AsyncLocalStorage` (corrélation per-requête).
- **`Nodefony`** — façade statique (singleton kernel, version, génération d'id).

Build Rollup `preserveModules` → un build **client** dédié (`src/client/`, condition `browser`) shimme `node:*`
et expose un sous-ensemble (NodefonySocket, Pdu, Syslog, Tools…) ⇒ le même paquet est importable côté navigateur.

---

## Surface API publique

> Tout est re-exporté par le barrel `index.ts`, décorateurs DI compris : `kernelDecorator.ts#injectable` exporte
> `{ injectable, Inject, services }`, tous trois ré-exportés par `nodefony`. `entities` vit dans `@nodefony/orm-core`.

### Façade `Nodefony`

`Nodefony.ts#Nodefony` — classe **statique** (`private constructor`, `#kernel` privé statique). Point d'entrée unique au kernel.

| Membre                    | Signature                          | Rôle                                                        | Ancre |
| ------------------------- | ---------------------------------- | ----------------------------------------------------------- | ----- |
| `version`                 | `static readonly string`           | version (lue de `package.json`)                             |       |
| `getKernel()`             | `static (): Kernel \| null`        | kernel courant — **`null` avant `start()`** → toujours `?.` |       |
| `setKernel(k)`            | `static (k): void`                 | appelé par le ctor `Kernel` (pollue le singleton)           |       |
| `generateId()`            | `static (): string`                | uuid v4                                                     |       |
| `generateV5Id(name, ns?)` | `static (string, string?): string` | uuid v5                                                     |       |

### `Service`

`Service.ts#Service` — `class Service implements IService` (n'**étend rien** : EventEmitter **composé**, pas hérité).
Constructeur `(name, container?, notificationsCenter?, options?)` `Service.ts#describeReceived`.

- **DI délégué au container** : `get<T>(name): T|null` (null si pas de container, no-throw) · `set<T>(name,obj): void`
  (**throw** si pas de container) · `has(name): boolean`
  · `remove(name): boolean` (appelle `clean()` si c'est un `Service`, rend `true` s'il existait).
  Aucune API de paramètres : `getParameters`/`setParameters` sont retirés (ADR-0012) — un module
  lit sa config dans `this.options`, figée à la fin de `onReady` ; par requête → `useConfig()`.
- **Events délégués à `#nc` (un `Event`)** : `fire` (=`emit`), `fireAsync`/`emitAsync`,
  `emitAsyncGuarded` (délègue à `this.nc.emitAsyncGuarded`), `on`/`once`/`off`,
  `listen` (non traçé → pas retiré au `clean`), `settingsToListen` (auto-wire des clés `onFoo`).
  `notificationsCenter:false` → pas d'Event → tout appel event throw `notificationsCenter not initialized` (getter `nc`).
- **Logging** : `log(pci, severity?, msgid?, msg?): Pdu` · `spinlog(msg): Pdu` (SPINNER) · `logger`/`trace`
  (= `console.debug`/`trace`). Fallback Pdu standalone si `syslog===null`.
- **Cycle de vie** : `initSyslog(env, debug, opts?)` · `clean(syslog=false)` (null toutes les refs ;
  `clean(true)` → `syslog.reset()`). `clean()` appelle `clean()` sur les enfants `instanceof Service`.
- ⚠️ **SURFACE RÉSERVÉE — 13 noms qu'un service métier ne peut pas redéfinir librement** :
  `get set has remove clean log trace on off once emit fire listen`. Ce sont des méthodes de `Service`
  (`get<T>(name): T|null` est l'accès au CONTENEUR, pas un accesseur métier). Redéfinir l'une
  d'elles avec une autre signature casse l'assignabilité de la classe — et le symptôme est
  **trompeur** : l'IDE souligne le décorateur `@services([X])` du module qui l'enregistre, alors que
  l'erreur (`TS2416`) porte sur la LIGNE DE LA MÉTHODE du service. Vécu : le gate `nodefony check`
  réclame `@services([X])`, l'ajouter ne compile plus, et on cherche le défaut dans le décorateur.
  Un `get(key)` métier se nomme donc autrement (`find`, `fetch`, `lookup`) — **un geste exigé par un
  gate doit compiler.**

### `Container` / `Scope`

`Container.ts` — `class Container implements IContainer`. Registre de services + scopes hiérarchiques.

- `set(name,obj)` (écrit dans `services[name]` **ET** `protoService.prototype` → héritage scopes) · `get<T>(name): T|null`
  · `has(name)` / `remove(name)` (via `name in services`, pas `!!value` → falsy OK) · `keys`/`entries`.
- Scopes (LAZY — `scopes:null` tant que 0 `addScope`) : `addScope` · `enterScope` → `Scope` · `leaveScope`
  · `scopeCount(name): number` (sonde fuite/Studio) · `removeScope`.
- `clean()` / `reset()` (racine seulement : clean + recrée les protos → réutilisable).
- **`Scope extends Container implements IScope`** : `set`/`remove` overridés **own-property only**
  — écrire sur le proto partagé polluerait le parent (data race per-requête). `reset()` **lève** sur un scope.
  `hasOwn(name)` (posé SUR ce scope, jamais hérité) · `own(obj)` (rattache : `clean()` LIFO à la fermeture ;
  lève si scope fermé) · `closed` (getter, `services === null`). Scope imbriqué → chaîne sur les services
  du scope PARENT. Registre des scopes ouverts = `Set` par nom ; `leaveScope` retire AVANT `clean()`.

### `Event` (+ `emitAsyncGuarded`)

`Event.ts#Event` — `class Event extends EventEmitter` (node:events). Ajoute :

<!-- prettier-ignore -->
| Méthode | Signature | Rôle | Ancre |
| --- | --- | --- | --- |
| `fire` | `(name, ...args): boolean` | alias `emit` (sync) | |
| `emitAsync` | `async (name, ...args): Promise<false \| unknown[]>` | série, **await conditionnel** (skip microtask si non-thenable) ; `false` si 0 listener | |
| `fireAsync` | idem | alias `emitAsync` | |
| `emitAsyncGuarded` | `async (name, options, ...args): Promise<IGuardedEmitResult>` | série **gardée** : try/catch + timeout par listener, collecte `{results,errors,stopped}` | |
| `listen` | `(name, fn)` | bind un listener | |
| `settingsToListen` | `(opts, ctx)` | auto-wire `onFoo` → listeners | |

`emitAsyncGuarded` court-circuite 0-listener avant `rawListeners` (0 alloc). Quand `timeoutMs>0` : 1 timer `unref`

- 1 Promise de course **PAR listener** → réservé boot/lifecycle/jobs, **jamais** le hot path. Types `IGuardedEmit*`
  exportés du barrel.

### `Kernel` / `CliKernel`

`kernel/Kernel.ts#Kernel` — `class Kernel extends Service implements IKernel`. Le ctor `kernel/Kernel.ts#Kernel.constructor` appelle `Nodefony.setKernel(this)`.

- **Chaîne async de boot** (chaque maillon appelle le suivant si `!setCommandComplete`) :
  `start()` → `preRegister()` → `boot()` → `onReady()` → `initServers()`.
- **Flags chronologiques** (booléens, jamais régressifs) : `started`, `preRegistered`, `registered`,
  `booted`, `ready`, `postReady`. `progress: number` = OR cumulatif du bitmask `Events`.
- `setCommandComplete(p): boolean` / `isCommandComplete(p): boolean` (toujours `false` si `command===null`).
- **Registre modules** : `addModule(Ctor, ...args)` · `getModule` / `getModules` · `loadModule(name)`
  (dynamic import) · `addKernelService(Ctor, ...args)` (service direct sur le container kernel).
- **Lifecycle gardé** : `fireLifecycle(event, ...args): Promise<IGuardedEmitResult>` (politique, voir Internals).
- **Park / fin de cycle** : `park({keepAlive?})` (Promise jamais résolue — source UNIQUE du « rester vivant ») ·
  `finishOrPark(code)` (park si `lifetime==="longrunning" && !servers`, sinon `terminate`). `terminate(code?)`.
- Divers : `initializeLog()` · `setEnv` / `setNodeEnv` · `getBootReport(): IBootReport`
  (distingue `bootServers===null` non-mesuré de `[]` 0-serveur).
- **`Events`** (bitmask frozen, `Kernel.ts#Events`) : `onInit=1<<0 onPreStart onStart onPreRegister onRegister onPreBoot
onBoot onReady onServersReady onPostReady onTerminate=1<<10`.

`kernel/CliKernel.ts#CliKernel` — **`class CliKernel extends Cli`** (⚠️ PAS `Kernel`). Le `Kernel` est instancié à part et lié à
`cliKernel.kernel`. `constructor(environment?)` `kernel/CliKernel.ts#CliKernel.constructor`. `start(options?)` `kernel/CliKernel.ts#CliKernel.start` crée le Kernel + ajoute les built-ins +
`parseAsync`. `setRunProfile(profile)` (`{servers,lifetime,interactive}`, recopié dans `kernel.runProfile` à
`onStart`). `addCommand` · `initSyslog` · `terminate` (délègue à `kernel.terminate` si présent).

### `Module`

`kernel/Module.ts#Module` — `class Module extends Service implements IModule`. Ctor `(name, kernel, path, options)` `kernel/Module.ts#Module.appOptions`.

- `static controllers` (registre **partagé** toutes instances) · **`static critical: boolean = true`**
  (lue au ctor via `(this.constructor as typeof Module).critical`, AVANT les initializers de sous-classe) · `path`.
- `setPath(p)` (résout `file://`, remonte 2 niveaux si `dist/`, sinon 1) · `setEvents()` (wire les hooks +
  tags owner/critical) · `readOverrideModuleConfig(deep=true)` (clés `Module-<name>` → `extend` config d'un AUTRE module).
- `addService(Ctor, ...args)` (via `Injector.instantiate`) · `getController<T>(name)` · `getDependencies()`
  (deps + peerDeps, devDeps exclus, **pas de dédup**) · `getPackageJson(cwd?)`.
- `addCommand(Ctor)` (throw `Kernel not ready` si `kernel.cli===null`) · `install`/`outdated`.
- **Hooks lifecycle** (optionnels, **méthodes prototype obligatoires**) : `onKernelRegister`/`onKernelBoot`/`onKernelReady`
  (`async (): Promise<this>`) + `initialize?(kernel?)`. Le ctor attache **toujours** 1 listener (`onPreBoot` → `getPackageJson`).

### DI : `Injector` + `@injectable`/`@Inject`/`@Inject`

`kernel/injector/injector.ts` — `class Injector extends Service`. **Deux** registres statiques (globaux) :
`Injector.injectables` (nom → CLASSE, `Object.create(null)` — un objet littéral ferait répondre
`isRegistered("toString"|"constructor")` **vrai** et `register("__proto__")` déracinerait le registre)
et `containerKeys` (CLASSE → clé container réelle, **le token**). Le ctor `(kernel)` déclare **et pose**
`Fetch` (déclarer sans poser = un `new Fetch()` par résolution, donc par requête).

| Membre                 | Signature                       | Rôle                                                                  |
| ---------------------- | ------------------------------- | --------------------------------------------------------------------- |
| `register`             | `static (name, Ctor): Ctor`     | throw si name vide/Ctor null ; **le dernier gagne** (override assumé) |
| `isRegistered`         | `static (name): boolean`        | `name in injectables` (O(1))                                          |
| `getScope`             | `static (name): DIScope`        | lit `di:scope`, défaut `"singleton"`                                  |
| `scopeOf`              | `static (Ctor): DIScope`        | idem depuis la classe — `"request"` compris                           |
| `get`                  | `static (name): Ctor`           | throw `not found or not injectable`                                   |
| `rememberContainerKey` | `static (Ctor, key): void`      | **apprend** le couple (classe, clé) — appelé par `addService`         |
| `containerKeyOf`       | `static (Ctor): string \| null` | où l'instance vit réellement ; `null` = jamais posée                  |
| `instantiate`          | `static <T>(Ctor, ...args): T`  | point d'entrée — **construit toujours** (ne lit pas le container)     |
| `inject`               | `static <T>(Ctor, ...args): T`  | alias `instantiate`                                                   |

**Résolution d'une dépendance** (`_resolveWithStack`) : le nom retrouve la **CLASSE** → la classe dit
la clé (`containerKeyOf(Ctor) ?? nom`) → `kernel.get(clé)` ; absent → instancie **sans argument**, puis
mémoïse sous la clé **canonique** (`instance.name`) et l'apprend. Un échec de construction lève une
erreur **actionnable** (nomme le service, son demandeur, et le remède), `cause` chaînée.
⚠️ `instantiate(X)` sur la classe RACINE ne consulte jamais le container : le scope ne gouverne que
les **dépendances**.

Types exportés : `DIScope = "singleton" \| "transient" \| "request"`, `InjectableOptions`. Décorateurs (`kernelDecorator.ts#injectable`) :
`@injectable(nameOrOptions?)` (register + pose `di:scope`), `@Inject("name")` (paramètre ctor → metadata `inject:services`
sur le **constructeur**), `@services([...])` (sur Module → `onPreBoot`).

### `Syslog` / `Pdu`

`syslog/Syslog.ts#Syslog` — `class Syslog extends Event implements ISyslog`. Ring buffer `CircularBuffer<Pdu>` (`syslog/Syslog.ts#Syslog._ring`, FIFO O(1)).

- `log(payload, severity?, moduleName?, msg?): Pdu` · raccourcis `error`/`warn`/`info`/`debug`/`trace`+ ·
  `print(...args)` / `logMultiple(sev, ...args)`.
- `init(env, debug?, options?)` · `addTransport`/`removeTransport` · `getLogStack(start?,end?,cond?)`
  · `listenWithConditions(cond, cb)`.
- **Statics process-global** : `setOutputBuffering(mode)` / `flushOutput()` · `setLogSink(sink \| null)`
  (`ILogSink` : stdout/file/null) · `overrideConsole(instance)`.
- 3 axes ORTHOGONAUX : ① **sink write** (`ILogSink`) ② **driver query** (`ILogDriver` : memory/file/loki/opensearch, chemin FROID)
  ③ **bus realtime** (`nodefony:syslog`). Tous enfichables + exportés du barrel.

`syslog/Pdu.ts#PID` — `class Pdu` (entrée de log immuable). Champs : `payload`, `uid` (monotone par process), `severity:number`,
`severityName:string` `syslog/Pdu.ts#fastTypeOf`, `timeStamp:number` (**pas** d'objet `Date`), `moduleName`, `msgid`, `msg`, `status`, `pid`
(`= process.pid`, capté 1×), `requestId?` (corrélation ALS). **Provider injectable** `static requestIdProvider`
(branché côté Node par `index.ts#ITestModuleOptions.options` sur `RequestContext.getRequestId` ; `null` côté navigateur). Enum `SysLogSeverity`
`index.ts` : `EMERGENCY=0 ALERT=1 CRITIC=2 ERROR=3 WARNING=4 NOTICE=5 INFO=6 DEBUG=7 SPINNER=-1`. `translateSeverity` `index.ts#JsonRpcServerError`.

### `Cli` / `Command`

`Cli.ts#Cli` — `class Cli extends Service` (wrapper Commander). Surcharges du `constructor` `Cli.ts#Cli.constructor`.

- `addCommand(Ctor)` · `hasCommand` / `getCommand` · `parse`/`parseAsync`.
- `setCommandVersion(v)` (⚠️ throw si rappelé — le ctor ajoute déjà `-v`) · `setCommandOption` · `setCommand`.
- `static niceBytes(x)` (`1024`→`"1.0 KB"`) · `startTimer`/`stopTimer` · `setProcessTitle` ·
  `showBanner` · `handleSignals()` (idempotent : 1ᵉʳ signal draine, 2ᵉ force `exit`) · `terminate`.

`command/Command.ts#OptionsCommandInterface.quietBoot` — `class Command extends Service`. Ctor `(name, description, cli, options?)` `command/Command.ts#defaultCommandOptions`. Enregistre son
action dans Commander au ctor. `onKernelStart?(...args)` `command/Command.ts#Command.onKernelStart` (hook pré-boot). `setEvents()` `command/Command.ts#Command.setEvents` (guard `eventsRegistered`,
idempotent). Chaîne standalone : `action()` → `run()` → `generate()` (à override ; ⚠️ Commander passe
l'instance `Cmd` en **dernier** arg). `addOption` / `addArgument` / `alias`. `kernelEvent` défaut `"onRegister"`.

### `FileClass` / `Finder`

`FileClass.ts#FileClass.stats` — wrapper `fs` typé. **⚠️ Le constructeur `new FileClass(path)` `FileClass.ts#FileClass.constructor` est SYNCHRONE** (`fs.lstatSync` via
`getRealpath` `FileClass.ts#FileClass.getRealpath`/`checkType` `FileClass.ts#FileClass.checkType`). Pour le pipeline → **`static async from(path): Promise<FileClass>` `FileClass.ts#FileClass.from`**
(I/O non bloquante via `stat()`). Lecture : `content(enc?)` (sync), `read(enc?)` (sync),
`readAsync(enc?)`, `readByLine(cb)`. Écriture : `write`, `move` / `moveAsync`, `unlink`.
`toJson()`, `isFile`/`isDirectory`.

`Finder` (`finder/Finder.ts`, `extends Event`) : traverseur async — `checkPath(path)` (sync `FileResult`), `in(path, settings?)`
(`Promise<Result>`, utilise `File.from()`). `File`/`FileResult`/`Result` exportés du barrel.

### `RequestContext` (ALS)

`runtime/RequestContext.ts#RequestContextPayload.resolver` — façade statique au-dessus d'`AsyncLocalStorage` (instance **lazy** `runtime/RequestContext.ts` → 0 coût si jamais `run`).

| Méthode                 | Signature                                                      | Ancre |
| ----------------------- | -------------------------------------------------------------- | ----- |
| `run`                   | `static <T>(payload, fn): T`                                   |       |
| `get`                   | `static (): RequestContextPayload \| undefined`                |       |
| `getRequestId`          | `static (): string \| undefined`                               |       |
| `getUser` / `getUserId` | `static (): unknown / string \| null`                          |       |
| `getContext<T>`         | `static (): T \| undefined`                                    |       |
| `getScope`              | `static (): IScope \| undefined` (scope refermé → `undefined`) |       |
| `requireScope`          | `static (): IScope` — lève en nommant la cause                 |       |
| `set<K>`                | `static (key, value): void` (no-op hors scope)                 |       |
| `isProfiling`           | `static (): boolean`                                           |       |
| `pushQuery`             | `static (query): void` (no-op si !profiling → 0 coût prod)     |       |

### `nodefonyError`

`Error.ts#nodefonyError` — `class nodefonyError extends Error` (= `globalThis.Error`, mais **exporté sous le nom `nodefonyError`** —
l'ancien export `Error` a été renommé, cassant). Ctor `(message?: string | Error, code?: number)` `Error.ts#nodefonyError.error`. Champ
`code: number | null`, `errorType` auto-détecté, `toJSON()` filtré (exclut les réfs circulaires/secrets).

---

## Internals

### Algo DI (résolution + scopes)

`Injector.instantiate(Ctor, ...args)` → `_instantiateWithStack(Ctor, [], args)`. Par arbre d'appel :

1. **Détection de cycle** : `if (stack.includes(Ctor)) throw "Circular dependency detected: A → B → A"`. `nextStack = [...stack, Ctor]`
   — des CONSTRUCTEURS, **copie par valeur** (jamais de mutation du parent) → async-safe.
2. **Une seule source** : `inject:services` (sur le constructeur, posé par `@Inject`, sparse par position). Aucun nom →
   `Reflect.construct(Ctor, args)`. Le type d'un paramètre n'est jamais lu (ADR-0018).
3. Pour chaque position `i` : `@Inject[i]` défini → `_resolveWithStack(name)` ; sinon → arg explicite `argsClass[explicitIdx++]`
   (ou `undefined`). Args restants appendés.

`_resolveWithStack(name, stack)` (jamais d'`args` : une dépendance se résout, elle n'hérite pas) : si `@injectable` → `scope==="transient"` → toujours `new` ; `"singleton"` →
**court-circuit** `kernel.get(containerKeyOf(Ctor) ?? name)` si présent (= le cache singleton, clé apprise par la CLASSE), sinon `new`. Si non-`@injectable` → fallback `kernel.get(name)`,
sinon throw. `"request"` → `_resolveRequestScoped` : refus d'un détenteur singleton, scope lu par
`RequestContext.requireScope()`, lecture sur les propriétés PROPRES du scope, création paresseuse
puis `scope.set` + `scope.own`. La pile porte des CONSTRUCTEURS (détenteur relu sans coût tant
qu'aucun service `request` n'est résolu). Détail : `src/nodefony/src/kernel/injector/MEMORY.md`.

### Lifecycle kernel (ordre des fires)

Ordre EXACT des events émis pendant le boot (`Events` bitmask) :

```
onInit (ctor) → onPreStart → onStart → onPreRegister → [applyModuleConfigOverrides] → onRegister
  → onPreBoot → onBoot → onReady → onServersReady → onPostReady     (… onTerminate au shutdown)
```

- Les **modules** sont chargés depuis le manifeste `config.modules` à **`onPreRegister`** (résolution `resolveModules`/
  `loadModulesFromManifest` — plus de décorateur `@modules`).
- Flags posés APRÈS leur hook : `preRegistered`(onPreRegister) `registered`(onRegister) `booted`(onBoot) `ready`/`postReady`(onReady).
- ⚠️ **`booted=true` PRÉCÈDE `captureBootServers()`** (qui tourne dans `onReady`→`initServers`) → `booted:true` ≠ « serveurs prêts ».
- Hooks de module via `setEvents()` : `onKernelRegister`→`once("onRegister")`, `onKernelBoot`→`once("onBoot")`,
  `onKernelReady`→`once("onReady")`, + `prependOnceListener("onPreBoot")` (charge le `package.json`). Chaque listener est **taggé**
  `(owner, critical)` via `tagListener` (lu par `fireLifecycle`).
- Fin de cycle : `finishOrPark(code)` → `park()` (daemon long-running sans serveur) ou `terminate()` (one-shot).

### `applyModuleConfigOverrides`

`Kernel.applyModuleConfigOverrides()` boucle sur `this.modules` et appelle `readOverrideModuleConfig()` sur chacun.
**Pourquoi centralisé** : avant, l'override `Module-<name>` était appliqué à `onPreBoot` (bitmask 32), donc APRÈS la validation
Zod des modules (`onRegister`, bitmask 16) → silencieusement ignoré pour un module qui fige sa config tôt. Il est désormais
exécuté **ENTRE `onPreRegister` et `onRegister`** (tous les modules enregistrés, validation pas encore faite). Un listener
ajouté PENDANT le fire `onPreRegister` ne serait jamais rappelé → d'où l'appel centralisé hors-listener.

### Event = MÉCANIQUE, Kernel = POLITIQUE

Séparation stricte (réutilisable, testable) :

- **`Event.emitAsyncGuarded`** `Event.ts#Event.emitAsyncGuarded` = mécanique PURE : série + try/catch + timeout/warnMs par listener, retourne
  `{results, errors, stopped}`. Ne décide d'AUCUNE politique (ni log, ni criticité) — l'appelant tranche via les callbacks
  `onListenerError` (retour `true` = stoppe la chaîne) / `onListenerSlow`.
- **`Kernel.fireLifecycle`** `Kernel.ts#Kernel.fireLifecycle` = POLITIQUE : appelle `super.emitAsyncGuarded` avec `bootTimeoutMs`/`bootWarnMs`,
  lit les tags `(owner, critical)` du listener (`readListenerTags` — déballe le wrapper `once` via `.listener`), et applique
  `isBootErrorFatal` : `critical && prod` → fatal (throw, le reste ne boote pas) ; sinon fail-soft + WARNING.
- `Service` **COMPOSE** `Event` (`this.nc`), ne l'étend pas → toute nouvelle méthode event = ajout à `Event` **ET** re-export
  délégué dans `Service` (cf `Service.emitAsyncGuarded`). Le hot path HTTP/WS garde `emitAsync` **nu** (0 timer/alloc/requête).

### Propagation ALS

`RequestContext.run(payload, fn)` ouvre un scope ; tout `await` dans `fn` voit `payload`. La lecture (`get`/`getRequestId`…)
est O(1). **Piège** : un listener EventEmitter attaché DANS la bulle mais qui fire plus tard (message/close/finish, timer,
hook post-réponse) ne voit PLUS l'ALS → l'envelopper dans `AsyncResource.bind()` au moment du bind. Le `requestId` arrive dans
chaque `Pdu` via `Pdu.requestIdProvider` (branché Node-only dans `index.ts#useNodefonyAdaptiveChannel`) ; côté navigateur le provider reste `null`
(0 lecture, 0 alloc). Une corrélation qui doit survivre au teardown ALS → la porter sur un objet explicite (`context`), pas l'ALS.

---

## Gotchas SPÉCIFIQUES core

> (Distincts des gotchas transverses de `references/gotchas.md` et des recettes de `references/core.md`.)

- **Imports cassants (héritage JS)** : `import nodefony from "nodefony"` ❌ (0 default → `import { Nodefony }`) ·
  `import { Error }` ❌ → `import { nodefonyError }` · `import { kernel }` ❌ (singleton supprimé) → `Nodefony.getKernel()`.
- **`inject` (minuscule) n'existe plus** : renommé `Inject` (ADR-0018). Pas d'injection de propriété ; `entities` vient de
  `@nodefony/orm-core`.
- **`Service` n'étend PAS EventEmitter** (composition `#nc`) : `new Service(name, ct, false)` → tout `on/emit/fire` throw
  `notificationsCenter not initialized`. `notificationsCenter` partagé (Event passé) ≠ auto-créé (cleanup par-service traçé).
- **`new Kernel()` pollue le singleton global** (`Nodefony.setKernel(this)` dans le ctor) → isoler les tests Kernel (mock minimal).
- **`CliKernel extends Cli`, PAS `Kernel`** : `this.environment` est `undefined` au constructeur → tout setup conditionnel dans
  `onKernelStart()` (hook command), jamais dans le ctor. Ne pas rappeler `setCommandVersion()` (le ctor `Cli` ajoute déjà `-v`).
- **Hooks de module = méthodes PROTOTYPE** (jamais arrow/property : `super()` tourne AVANT les initializers). Le ctor `Module`
  attache toujours ≥1 listener même sans hook. **`Module.critical` est STATIC** (lue avant les initializers de sous-classe).
- **Paramètre de service reçu `undefined`** = paramètre non nommé : le type ne résout rien, partout (build, vitest, prod)
  → nommer `@Inject("x")`.
- **`pdu.severity` est un NUMBER, `pdu.severityName` une STRING** — ne pas comparer `severity === "INFO"`. Le nom est **`CRITIC`,
  jamais `CRITICAL`**.
- **`Container.set()` après `clean()`** → throw `Container bad argument name` (message trompeur ; vraie cause : `services===null`).
  **`get(name)` retourne `null`** quand `null` est stocké (indistinguable de « absent »).
- **Un service `@services` qui crash suit la politique de boot** — jamais un skip silencieux :
  **fatal en production** (le boot s'interrompt : mieux vaut un pod qui refuse de démarrer qu'un pod
  amputé qui se déclare sain) ; **fail-soft ailleurs**, mais **ANNONCÉ** (BootReport → « boot
  DÉGRADÉ »). Le service est alors absent du container → `container.has("x")` / logs. Vaut pour la
  **construction** comme pour l'`init`. Module non critique : `static override critical = false`.
- **Jamais dérefencer le kernel au top-level d'un fichier chargé à l'import d'un module** (`config.ts` etc.) : le kernel n'existe
  pas encore → crash `Cannot read properties of null`, module non-importable/testable. Utiliser un **getter lazy** ou un guard
  `Nodefony.getKernel()?.x ?? défaut` (pattern complet → `recipes-core.md`).
- **`FileClass` constructeur = SYNCHRONE** (`lstatSync`) → bloque l'event-loop dans le pipeline : préférer `await FileClass.from(path)`.

---

## Verdict `FileClass.from` / `getFileAsync`

Les deux symboles **EXISTENT** (le faux négatif d'un audit antérieur venait d'un `grep` cassé qui renvoyait un fantôme `n()`) :

- **`FileClass.from()`** — `static async from(...)` à `FileClass.ts#FileClass.from`. Fabrique **asynchrone** (I/O non bloquante via
  `stat()` `FileClass.ts#FileClass.stat`), à utiliser dans tout pipeline ; le constructeur `new FileClass()` `FileClass.ts#FileClass.constructor` reste **synchrone** (`lstatSync`).
- **`getFileAsync()`** — `async getFileAsync(file): Promise<FileClass>` à **`@nodefony/framework` `Controller.ts#Controller.addFlash`** (délègue à
  `FileClass.from`). Son jumeau **synchrone `getFile()` `Controller.ts#Controller.getFile` est `@deprecated`** (« Bloque l'event-loop via `fs.lstatSync` »).
  Interface miroir : `IController.ts#IController` (`getFile` deprecated + `getFileAsync`). ⚠️ `getFileAsync` vit dans `framework`,
  pas dans le core — mais le verdict demandé est : **il existe bien** (pas de méthode nommée `n`).

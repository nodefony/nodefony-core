# Référence — Builder & HMR Vite (`@nodefony/frontend`)

Référence autosuffisante du module `@nodefony/frontend` : le builder Vite multi-framework
servi par le serveur Nodefony. Tous les ancrages `fichier:ligne` sont relatifs à
`src/packages/@nodefony/frontend/`. Un LLM doit pouvoir comprendre et utiliser le module
sans lire le source.

## Sommaire

- [1. Purpose](#1-purpose)
- [2. Architecture en un coup d'œil](#2-architecture-en-un-coup-doeil)
- [3. API publique](#3-api-publique)
  - [3.1 `FrontendService`](#31-frontendservice-service-injectable)
  - [3.2 `registerEntry` + déclaration d'entrée](#32-registerentry--declaration-dentree)
  - [3.3 `renderTags` / `renderDocument` / `assetUrl`](#33-rendertags--renderdocument--asseturl)
  - [3.4 `ViteProcessSupervisor`](#34-viteprocesssupervisor)
  - [3.5 Config (`defineFrontendConfig` / schema)](#35-config-definefrontendconfig--schema)
  - [3.6 Data plane admin (`createFrontendAdminApi`)](#36-data-plane-admin-createfrontendadminapi)
- [4. Internals / mécanismes](#4-internals--mécanismes)
  - [4.1 Dev — comment le SPA est servi (HMR Vite)](#41-dev--comment-le-spa-est-servi-hmr-vite)
  - [4.2 Appels d'API — sur l'origine de la page, sans proxy](#42-appels-dapi--sur-lorigine-de-la-page-sans-proxy)
  - [4.3 Prod — build + manifest + statiques](#43-prod--build--manifest--statiques)
  - [4.4 Multi-bundle + familles d'isolation](#44-multi-bundle--familles-disolation)
  - [4.5 Ordre de chargement au boot](#45-ordre-de-chargement-au-boot)
  - [4.6 CSP automatique (origines Vite → firewall)](#46-csp-automatique-origines-vite--firewall)
  - [4.7 Résilience du superviseur](#47-résilience-du-superviseur)
  - [4.8 Assets / CDN](#48-assets--cdn)
  - [4.9 Vite derrière Nodefony — une seule origine en dev](#49-vite-derrière-nodefony--une-seule-origine-en-dev)
- [5. Recette — ajouter un front à un module](#5-recette--ajouter-un-front-à-un-module)
- [6. Gotchas front-build](#6-gotchas-front-build)
- [7. Commandes CLI](#7-commandes-cli)
- [8. Vérifier une modif front SANS navigateur](#8-vérifier-une-modif-front-sans-navigateur)
- [9. Voir l'écran soi-même — le navigateur en conteneur](#9-voir-lécran-soi-même--le-navigateur-en-conteneur)

---

## 1. Purpose

`@nodefony/frontend` est le **builder frontend** de Nodefony. Il pilote **Vite** pour
transpiler/servir les SPA déclarées par chaque module, multi-framework :

- **React 19** (`@vitejs/plugin-react`)
- **Vue 3** (`@vitejs/plugin-vue`)
- **Angular** standalone (`@analogjs/vite-plugin-angular`)
- **Svelte 5** (`@sveltejs/vite-plugin-svelte` — seul plugin de la liste en export NOMMÉ)
- **vanilla** TS/JS (aucun plugin)

La liste ci-dessus est EXHAUSTIVE : `FrontPresetType` ne déclare que des presets réellement
enregistrés par `ViteBuilder` (constructeur, `ViteBuilder.ts:75-80`). Un type hors liste est
refusé à la compilation, et au démarrage par `FrontendPresetUnknownError` (`ViteBuilder.ts:112`,
`ViteConfigGenerator.ts:144`). Solid n'existe pas — l'ajouter = un fichier dans `src/presets/`,
un `registerPreset`, un `case` dans le générateur, une entrée dans l'union.

**Approche hybride découplée** : Vite tourne dans un **process système séparé**
(`child_process.spawn`), JAMAIS in-proc — la compilation/HMR ne bloque pas l'event-loop
backend, et un crash Vite ≠ crash Nodefony. Nodefony **rend lui-même** l'HTML (son moteur de
templates) et y **injecte les `<script>`** qui pointent vers le dev server Vite ; le navigateur
tape directement Vite pour les assets et le HMR. En production, Vite ne tourne pas : un
**build one-shot** produit un `manifest.json` lu pour émettre les balises fingerprintées.

`vite` et les plugins sont des **`peerDependencies`** (jamais des `dependencies` — poids), chargés
**paresseusement** (`await import(...)`) : aucune entrée d'un type donné = plugin jamais chargé.

---

## 2. Architecture en un coup d'œil

```
DEV (env=development)
  Module consumer.onKernelBoot()
    └─ frontendService.registerEntry(this, { type, entry, root, name })
  Kernel "onServersReady"  (les 4 serveurs Nodefony écoutent déjà)
    └─ FrontendService.startDev()
         ├─ groupe les entries par FAMILLE d'isolation (default / angular)
         ├─ par famille : ViteConfigGenerator.toMjs() → écrit vite.config.generated.mjs
         └─ ViteProcessSupervisor.start() → spawn le vrai bin Vite, parse "Local:" → ready
  Navigateur  GET /ma-route  (HTTP 5151 / HTTPS 5152)
    └─ Controller → this.render(svc.renderDocument("nom", ctx.cspNonce))
         → injecte <script src="/_vite/<famille>/@fs/<abs>/main.tsx"> + @vite/client + preamble (RELATIFS)
  Navigateur → Nodefony /_vite/<famille>/… (modules, assets, WS du HMR) → proxy inverse → Vite local (§4.9)
  Navigateur fetch("/ma/api")     : Vite PROXIFIE vers le backend Nodefony
  Kernel "onTerminate" → stopDev() → SIGINT puis SIGKILL(3s)

PROD (env !== development)
  Build préalable : nodefony frontend:build → vite.build() par entry → public/dist/.vite/manifest.json
  Kernel "onServersReady" → FrontendService.setupProd()
    ├─ server-static.addMount(publicPath, outDir)  (résolu PAR NOM, anti-cycle)
    └─ prodHelper = TemplateHelper(null, "production", entries, assetBase)
  Navigateur GET /ma-route → renderTags lit le manifest → <link css>/<modulepreload>/<script> préfixés publicPath
```

Graphe de dépendances : `@nodefony/frontend` est **en bout de chaîne** — il n'importe JAMAIS
`@nodefony/http` ni `@nodefony/framework` (cycle potentiel). Tout couplage runtime (serveur
statique, firewall, certificats) passe par **résolution DI par nom** (`container.get("server-static")`,
`container.get("firewall")`, `container.get("certificates")`).

---

## 3. API publique

Imports publics (`index.ts`) : `Frontend` (Module, default + nommé), `FrontendService`,
`createFrontendAdminApi`/`buildFrontendStatus`, `ViteBuilder`, `ViteProcessSupervisor`,
`ViteConfigGenerator`, `TemplateHelper`, les 4 presets, les erreurs, toutes les interfaces
`I*`, et la config (`defineFrontendConfig`, `frontendConfigJsonSchema`, `frontendConfigSchema`,
types `IFrontendConfigInput`/`IFrontendConfig`).

### 3.1 `FrontendService` (service injectable)

`@injectable()`, nom DI **`"frontend"`** → `container.get("frontend")`
(`FrontendService.ts:69-70`, construit avec le nom `"frontend"` `:92-93`). Implémente
`IFrontendService` (`IFrontendService.ts:23`).

<!-- prettier-ignore -->
| Méthode | Signature | Rôle | Ancrage |
| --- | --- | --- | --- |
| `registerEntry` | `(module: Module, decl: IFrontendModuleDeclaration) => IResolvedFrontendEntry` | Déclare un front à builder/servir. | `FrontendService.ts:228` |
| `listEntries` | `() => ReadonlyArray<IResolvedFrontendEntry>` | Snapshot des entrées résolues. | `:248` |
| `status` | `() => IViteSupervisorStatus` | État du superviseur **primaire** (famille `default`). | `:252` |
| `statusAll` | `() => ReadonlyArray<{ family; status }>` | État de **chaque** instance Vite (multi-famille). | `:271` |
| `startDev` | `() => Promise<void>` | Démarre Vite (1 instance/famille). Idempotent. Auto au boot. | `:289` |
| `stopDev` | `() => Promise<void>` | Stoppe toutes les instances (SIGINT→SIGKILL). | `:495` |
| `build` | `(opts?: { force?: boolean }) => Promise<IFrontendBuildResult>` | Build prod `vite.build()` par entry. | `:525` |
| `renderTags` | `(entryName, nonce?) => string` | Balises `<script>`/`<link>` à injecter. | `:630` |
| `renderDocument` | `(entryName, nonce?) => string` | Document HTML complet (index.html du module + tags). | `:618` |
| `assetUrl` | `(p: string) => string` | Résout l'URL publique d'un asset (préfixe CDN si configuré). | `:114` |

`IFrontendBuildResult` (`IFrontendService.ts:5`) : `{ built: string[]; skipped: string[];
failures: { entryName; message }[] }`.

> Note : `getCspDirectives()` **n'existe plus** comme API publique. La CSP des origines Vite est
> gérée **automatiquement** via le firewall (cf §4.6). Le controller n'a plus à override la CSP.

### 3.2 `registerEntry` + déclaration d'entrée

`IFrontendModuleDeclaration` (`IFrontBuilder.ts:10`) — ce que le module consommateur passe :

<!-- prettier-ignore -->
| Champ | Type | Défaut | Rôle | Ancrage |
| --- | --- | --- | --- | --- |
| `type` | `FrontPresetType` | (requis) | `"react19"`/`"vue3"`/`"angular"`/`"vanilla"`/… | `IFrontBuilder.ts:12` |
| `entry` | `string` | (requis) | Point d'entrée **relatif au module** (ex `./frontend/src/main.tsx`). | `:14` |
| `outDir` | `string?` | `./public/dist` | Sortie du build prod (relatif module). | `:16` |
| `root` | `string?` | `./frontend` | Racine front (contient `index.html`). | `:18` |
| `name` | `string?` | nom du module | Nom logique de l'entrée (= `entryName`, clé de `renderTags`). | `:20` |
| `publicPath` | `string?` | `/_assets/<name>/` | Préfixe public prod (cf §4.3/§4.8). | `:27` |

`registerEntry` (`FrontendService.ts:228`) résout les chemins en **absolu** depuis `module.path`,
stocke `entryFile` relatif au `root`, normalise `publicPath` (leading + trailing `/`,
`:235`/`normalizePublicPath` `:50`), et retourne une `IResolvedFrontendEntry`
(`IFrontBuilder.ts:33` : `moduleName`, `entryName`, `type`, `root`, `entryFile`, `outDir`,
`publicPath`). **À appeler dans le `onKernelBoot()` du module consommateur**
(avant `onServersReady` qui démarre Vite).

### 3.3 `renderTags` / `renderDocument` / `assetUrl`

Source unique des balises = `TemplateHelper` (`src/template/TemplateHelper.ts`).
`FrontendService` route vers le bon helper :

- prod → `prodHelper` (lit les manifests) ;
- dev → helper de la **famille** de l'entrée (`entryFamily.get(name)` → `templateHelpers.get(family)`),
  `FrontendService.ts:764-765`.

- **`renderTags(name, nonce?)`** : juste les `<script>`/`<link>`. À injecter dans un `<head>`.
- **`renderDocument(name, nonce?)`** : lit l'`index.html` **du module** (le dev y met
  meta/polices/externals), **retire** le `<script type=module src=…entry…>` source (non
  résolvable hors dev server Vite), et injecte les tags au marqueur **`<!--nodefony:frontend-->`**
  sinon avant `</head>` (`TemplateHelper.ts:82`/`injectIntoHtml:105`/`FRONTEND_MARKER:23`). Pas
  d'`index.html` → coquille minimale `<div id="root">` générée (`:88-99`).
- **`assetUrl(p)`** : préfixe `p` par `assetBaseUrl` (CDN) si configuré, sinon identité ; URLs
  absolues inchangées (`FrontendService.ts:114`).

Le `nonce` (issu de `Context.cspNonce`) est posé sur les `<script>` (preamble inline dev + entrée)
pour satisfaire `script-src 'nonce-…'` sans `'unsafe-inline'` (`TemplateHelper.ts:237`).

**Aucune origine dans les balises.** En développement, toutes les URLs vers Vite sont relatives à
la page (`/_vite/<famille>/…`) et relayées par Nodefony (§4.9) : elles suivent d'elles-mêmes l'hôte
par lequel le client est arrivé — poste, conteneur, téléphone du réseau local, Codespaces — sans
contenu mixte. En **production**, les URLs du manifest sont relatives au document, comme avant.

**Helpers de template** (façon Symfony `encore_entry_script_tags`), même source `renderTags`/
`renderDocument` :

- **Eta/EJS** : injectés dans les locals par `Controller.withFrontendLocals(param)` (résout
  `frontend` par nom, anti-cycle) → `<%- frontendTags('studio') %>` / `<%- frontendDocument('studio') %>`.
- **Twig** : `frontend_tags` / `frontend_document` (échappe → `|raw`).

### 3.4 `ViteProcessSupervisor`

Implémente `IViteSupervisor` (`IViteSupervisor.ts:70` : `start(entries, viteConfig)`, `stop()`,
`status()`). Une instance par famille d'isolation.

`ViteSupervisorOptions` (`ViteProcessSupervisor.ts:81`) : `devHost`, `devPort`, `startupTimeoutMs`,
`pipeLogs`, `cwd`, `logger`, `backendOrigin?`, `https?` ({keyPath, certPath}), `nodeEnv?`,
`extraEnv?`, + résilience (`autoRestart`, `maxRestarts`, `restartBackoffBaseMs`,
`restartBackoffMaxMs`, `healthCheckIntervalMs`, `healthCheckFailureThreshold`,
`healthCheckTimeoutMs`, `portRetryAttempts`). `DEFAULTS` à `:124`.

`IViteSupervisorStatus` (`IViteSupervisor.ts:21`) : `state` (`ViteSupervisorState` `:6` =
`idle`|`starting`|`ready`|`compiling`|`restarting`|`crashed`|`stopping`|`stopped`|`errored`),
`host`, `port` (réel résolu, `null` si non démarré), `pid`, `lastError`, `entries`, `https`,
`restartCount`, `healthFailures`.

Mécanique : résout le **vrai binaire Vite** (`vite/package.json` → champ `bin`, caché) au lieu de
`npx vite` — 1 process au lieu de 2, et `SIGINT`/`SIGKILL` atteignent Vite directement (sinon Vite
orphelin → `EADDRINUSE` au restart) ; fallback `npx` si non résolu (`resolveViteBin:32`).
`detached: false` → Vite reste dans le groupe de process du serveur (Ctrl+C terminal l'atteint,
`:338`). Le port réel est lu en parsant `Local:\s+https?://host:port` dans le stdout (`:378`/`:401`).

### 3.5 Config (`defineFrontendConfig` / schema)

**Source de vérité = `config/schema.ts` (Zod)**. `config/config.ts` en dérive les défauts
(`frontendConfigSchema.parse({})` `config.ts:24`). `defineFrontendConfig(input)` valide+gèle la
fusion `défauts + module.options` au hook `onKernelRegister` (`index.ts:55`, plante propre si
invalide). `frontendConfigJsonSchema()` produit le JSON Schema introspectable (panneau config Studio,
`index.ts:45`/`defineModuleConfig.ts:35`).

Défauts (`schema.ts`) :

<!-- prettier-ignore -->
| Champ | Défaut | Rôle |
| --- | --- | --- |
| `devHost` | `127.0.0.1` | Host d'écoute Vite (apparaît dans les `<script>`). |
| `devPort` | `5173` | Port Vite (incrémenté si occupé). |
| `autoStartInDevelopment` | `true` | Démarre Vite au boot en `development`. |
| `defaultOutDir` | `./public/dist` | Sortie build par défaut. |
| `defaultRoot` | `./frontend` | Racine front par défaut. |
| `assetBaseUrl` | `""` | Base CDN des assets **prod** (cf §4.8). |
| `startupTimeoutMs` | `30000` | Timeout d'attente du `Local:` Vite. |
| `pipeViteLogs` | `true` | Propage les logs Vite au syslog. |
| `viteEnv` | `{}` | Variables passées au child Vite ; clés `VITE_*` exposées au navigateur. |
| `resilience` | (objet) | `autoRestart:true`, `maxRestarts:5`, `restartBackoffBaseMs:500`, `restartBackoffMaxMs:8000`, `healthCheckIntervalMs:30000`, `healthCheckFailureThreshold:3`, `healthCheckTimeoutMs:5000`, `portRetryAttempts:3`. |

Surcharge côté app : `use("@nodefony/frontend", { ... })` dans le manifeste `modules` de
`nodefony.config.ts` (config colocalisée → `module.options`), ou directement via les `module.options`
du consommateur. La config par entrée (`registerEntry`) est une **déclaration runtime**, PAS de la
config (hors schéma).

### 3.6 Data plane admin (`createFrontendAdminApi`)

`createFrontendAdminApi(service)` (`src/FrontendAdminApi.ts:173`) construit un `IAdminApi`
(namespace `"frontend"`) enregistré auprès du broker au `onKernelBoot` (`index.ts:75-86`). Expose
**`GET /nodefony/frontend/api/vite`** → `buildFrontendStatus(service)` (`:139`) :
`IFrontendStatusView` (`:100`) = `{ available, vite?(version), primary, bundles[] }`, chaque bundle
= `IViteInstanceView` (`:78`) **sans paths FS absolus** (anti info-leak) : `family`, `state`, `host`,
`port`, `pid`, `https`, `restartCount`, `healthFailures`, `entries[{entryName,type,version}]`.
Best-effort, jamais `throw` ; en prod l'instance est `idle`/`pid:null` (Vite ne tourne pas).

---

## 4. Internals / mécanismes

### 4.1 Dev — comment le SPA est servi (HMR Vite)

`startDev()` (`FrontendService.ts:314`) écrit **`<root>/vite.config.generated.mjs`** via
`ViteConfigGenerator.toMjs()` (`service/ViteConfigGenerator.ts:63`), puis spawn Vite. Le fichier
généré est autosuffisant : il `import`e Vite + les plugins **hardcodés** selon les types détectés
(`:77-113`). Il est **réécrit à chaque `startDev`** — ne JAMAIS l'éditer.

Contenu clé de la config générée :

- `base: "/_vite/<famille>/"` en dev (`devBasePath`, `isolationGroups.ts`) : Vite préfixe TOUTES ses
  URLs (modules, assets, `url()` CSS, socket HMR). ⚠️ Jamais une ORIGINE : en dev, Vite réduit un `base`
  absolu à son seul chemin (`resolveBaseUrl`) — l'ancien `base: "https://127.0.0.1:5173/"` valait `/`.
  Les imports JS marchent parce que le navigateur les résout contre l'URL du MODULE (Vite) ; une URL
  d'asset, elle, se résout contre la PAGE (Nodefony) → d'où le proxy (§4.9). `strictPort` est toujours
  posé en dev : le superviseur possède le port.
- `server.cors: true` : le navigateur charge depuis l'origine Nodefony des assets servis par Vite.
- `server.fs.allow` : `process.cwd()` (workspace root, node_modules hoistés) + le `root` de **chaque**
  entry (`:128-129`) → permet de servir via `/@fs/<abs>` (clé du multi-bundle, §4.4).
- `server.https` (si `cfg.https`) : injecte `fs.readFileSync(keyPath/certPath)` — mêmes certs que
  `server-https` (5152), résolus via le service `certificates` (`FrontendService.resolveHttps:372`).

Les balises injectées en dev (`TemplateHelper.renderDevTags:153`) :

1. **Preamble React Fast Refresh** (entries `react19` uniquement, `:191-201`) : un `<script type=module>`
   inline (noncé) qui installe `RefreshRuntime.injectIntoGlobalHook`. Obligatoire — sinon
   `@vitejs/plugin-react can't detect preamble` (normalement injecté par `transformIndexHtml`, mais
   ici c'est Nodefony qui rend l'HTML). Vue/Angular/vanilla : pas de preamble.
2. **`<script src="<base>/@vite/client">`** (`:203`) : le client HMR de Vite (ouvre sa propre WS).
3. **`<script src="<base>/@fs/<abs>/entry">`** (`:205`) : l'entrée, en `/@fs/<absolu>` (cf §4.4).
4. **Pont HMR sans socket** (`hmrBridgeTag:226`) : réutilise `createHotContext` du client `@vite/client`
   DÉJÀ chargé (zéro WS supplémentaire) → relaie les events Vite vers un `CustomEvent("nodefony:hmr")`
   sur `window`, observé par la debug bar.
5. **Debug bar** Nodefony (dev only, `debugBarTag:252`) : résout `nodefony/debugbar` (1×, caché),
   sert via `/@fs`, monte la carte Frontend + sonde HMR. Irrésoluble → commentaire HTML (jamais d'erreur).

Si le superviseur n'est pas `ready` quand `renderTags` est appelé → un **commentaire HTML**
`<!-- @nodefony/frontend: vite supervisor state=... -->` (jamais une page cassée, `:158-160`).

### 4.2 Appels d'API — sur l'origine de la page, sans proxy

La page est rendue par Nodefony : un `fetch("/ma/api/x")` part sur l'origine de la page, donc chez
Nodefony, et Vite ne reçoit que ce que `/_vite/<famille>/` lui relaie (§4.9). Il n'y a **aucun proxy
d'API à déclarer** : `apiProxyPaths` et les clés `backendHost`/`backendPort`/`backendProtocol` ont
été retirés (vestige du POC où Vite servait la page) — la config générée n'a plus de
`server.proxy`. Un `Unexpected token '<'` sur un `fetch` signifie que la page a été ouverte sur le
port de Vite (SPA-fallback HTML) : l'ouvrir par Nodefony.

### 4.3 Prod — build + manifest + statiques

**Build** : `FrontendService.build({force?})` (`FrontendService.ts:634`) importe `vite` à la demande
(`:527`) et appelle `vite.build()` **par entry** (boucle `:535`) — chaque bundle a son propre
`root`/`outDir`/`base`/`manifest` (multi-module + isolation Angular). `ViteBuilder.buildViteConfig`
(`src/builders/ViteBuilder.ts:95`) pose `base = assetBaseUrl + publicPath` **seulement en production**
(`:79-80`) et `build.manifest: true`. Le résultat est `IFrontendBuildResult` :

- **Idempotent** : une entrée dont `outDir/.vite/manifest.json` est plus récent que ses sources est
  **`skipped`** (`isBuildFresh:571` + `newestSourceMtime:584` — scan borné, ignore
  `node_modules`/`.vite`/`outDir`). `--force` rebuild tout.
- **Erreurs collectées** : un bundle KO ne stoppe pas les autres → `failures[]` ; la commande CLI met
  `process.exitCode = 1` (pipeline CI).

**Rendu prod** : `TemplateHelper.renderProdTags` (`TemplateHelper.ts:336`) lit
`outDir/.vite/manifest.json` (Vite ≥5), fallback `outDir/manifest.json` (layout legacy), caché par
`outDir` (`loadManifest:329`). Clé du manifest = `entryFile` POSIX, sinon fallback chunk `isEntry`
(`:297-300`). Émet : **CSS** d'abord (récursif sur les imports, `collectCss:351`, anti-FOUC),
**`<link rel="modulepreload">`** des imports partagés, puis **`<script type=module crossorigin>`**.
Toutes les URLs préfixées par `assetBaseUrl + publicPath` (`:306`). Manifest absent → commentaire HTML
(jamais de crash).

**Service statique** : `FrontendService.setupProd()` (hook `onServersReady`, `env !== development`,
`:463`) monte chaque `outDir` sur son `publicPath` via `container.get("server-static").addMount(prefix,
dir)` — **résolu par nom** (anti-cycle, `:472-479`). Si `server-static` absent → warning (un proxy
frontal/CDN est attendu). Puis crée le `prodHelper` (`:486`).

### 4.4 Multi-bundle + familles d'isolation

Plusieurs modules peuvent enregistrer chacun leur entrée — elles **coexistent**. Le piège résolu :
deux consumers ayant chacun `frontend/src/main.tsx` produiraient la même URL relative
`<base>/src/main.tsx`, et Vite (root unique = `entries[0].root`) résoudrait les deux contre le **root
du premier**. Fix : URL en **`/@fs/<chemin absolu>`** (`TemplateHelper.ts:172-180`) + `server.fs.allow`
listant chaque `root` (`ViteConfigGenerator.ts:160`).

**Familles d'isolation** (`src/isolationGroups.ts`) : `isolationGroup(type)` (`:20`) renvoie une clé de
famille. React/Vue/vanilla/Svelte → **`default`** (extensions disjointes, cohabitent dans **une**
instance Vite). **Angular → `angular`** (process Vite **séparé**) car son plugin transforme **tout**
`.ts` (y compris les stores des autres bundles) → il doit être scopé par son `tsconfig.app.json`
(résolu en absolu, `ViteConfigGenerator.ts:89-105`).

`startDev` regroupe par famille (`groupEntriesByFamily:388`), alloue un **bloc de ports disjoint** par
famille via `familyPortPlan(devPort, families, portRetryAttempts)` (`isolationGroups.ts:112` ; bloc =
`portRetryAttempts + 1` ports → le port-retry d'une instance n'empiète jamais sur une autre famille).
La famille **`default` (PRIMARY_FAMILY, `:35`)** garde `devPort` (5173) ; les autres prennent les blocs
suivants (`orderFamilies:45`). Chaque famille démarre **indépendamment** (`Promise.allSettled:326`) :
une famille qui échoue (ex. Angular) est isolée — `startDev` ne rejette que si **aucune** famille n'a
démarré (`:354-360`).

### 4.5 Ordre de chargement au boot

- **`@nodefony/frontend` doit être chargé AVANT les modules consommateurs** dans le manifeste `modules`
  de `nodefony.config.ts`. Sinon le service `frontend` n'existe pas dans le Container au `onKernelBoot`
  du consommateur → `registerEntry` impossible (le consommateur log une erreur et skip).
- `registerEntry` se fait au **`onKernelBoot`** du consommateur (vérifié : `studio/index.ts:99`,
  `test-frontend-vue/index.ts:28`).
- Le superviseur Vite démarre au **`onServersReady`** (pas `onReady`) : Vite ne doit spawner qu'APRÈS
  que les 4 serveurs Nodefony écoutent, sinon le proxy Vite tape un backend pas encore prêt
  (`FrontendService.init:121-185`). En prod, le même hook fait `setupProd()` à la place.
- Pont de boot dev : `FrontendService` fire `onFrontendStart` (synchrone, avant `await startDev`) +
  `onFrontendReady` (en `finally`) sur le **kernel** pour la checklist `BootReporter`. Aucun listener
  (prod / boot direct) → `fire` no-op, 0 coût.

### 4.6 CSP automatique (fragment Vite → firewall)

Au `startDev`, AVANT le premier spawn, `FrontendService.#registerCsp()` déclare le fragment Vite au
firewall `@nodefony/security` via `firewall.registerCspOrigins("frontend", fragment)` (résolu PAR NOM,
anti-cycle). Le firewall émet **UN seul CSP** (nonce + fragment mergé) → **plus besoin** d'override
`setHeader` dans le controller. `stopDev` appelle `unregisterCspOrigins("frontend")`. No-op si
security absent.

Le fragment (`#viteCspFragment`) ne nomme **aucune origine ni aucun port** : tout passe par l'origine
de la page (§4.9). `'self'` dans chaque directive (elles n'héritent pas de `default-src`, et `'self'`
couvre le `ws(s):` du HMR de même hôte), `'unsafe-eval'` en `script-src` (React Fast Refresh),
`'unsafe-inline'` en `style-src` (styles injectés par Vite), `worker-src 'self' blob:`. En prod,
`startDev` ne tourne pas → CSP strict same-origin.

### 4.7 Résilience du superviseur

`ViteProcessSupervisor` (`service/ViteProcessSupervisor.ts:148`) :

- **Idempotence** : `start()` ré-entrant partage `startPromise` ; `stop()` mémorise `stopPromise`
  (`:197`/`:224`).
- **Port retry** : `EADDRINUSE` → essaie `devPort+1`, `devPort+2`… jusqu'à `portRetryAttempts`
  (`spawnWithPortRetry:257`). Le port réel est dans `status().port`.
- **Auto-restart** : un exit avec `state=ready` (crash inattendu) → `scheduleRestart` avec **backoff
  exponentiel borné** (`base * 2^n`, plafonné à `restartBackoffMaxMs`, `:488-523`). `willingShutdown`
  distingue un stop volontaire (`attachRuntimeExitHandler:463`). Au-delà de `maxRestarts` → `state=errored`.
- **Health check** : `setInterval` (défaut 30s) GET HTTP(S) sur `/` ; N échecs consécutifs (défaut 3)
  → kill le child → restart (`startHealthCheck:529`/`pingVite:573`). `0` désactive.
- **Cleanup** : `stop()` = SIGINT puis **SIGKILL après 3s** (évite les zombies bloquant le port,
  `doStop:605`/`:629-642`). Tous les listeners sur `child` sont tracés (`trackListener:660`) et drainés
  à chaque mort (`cleanupChildListeners:669`) → pas de `MaxListenersExceededWarning` entre restarts.

### 4.8 Assets / CDN

`publicPath` (par entrée, défaut `/_assets/<name>/`) aligne **3 pièces** par construction :

1. `base` Vite au **build** (`ViteBuilder.ts:134`) ;
2. **mount prefix** du serveur statique `Statics` (`setupProd` `addMount`, `:477`) ;
3. **préfixe des URLs** émises par `renderProdTags` (`TemplateHelper.ts:336`).

`assetBaseUrl` (config, défaut `""`) est la base **CDN/object-storage** des assets prod. Quand
renseignée (ex `https://cdn.example.com`), elle préfixe le `base` Vite au build, les URLs de
`renderProdTags`, et le helper `asset('/x')` (`FrontendService.assetUrl:114`) — **sans** toucher au
mount `Statics` (qui reste relatif à l'origine). Vide = assets servis depuis l'origine Nodefony en
chemins relatifs. Bascule cloud-native (nginx/CDN frontal) = changer `assetBaseUrl`/`publicPath` sans
toucher au rendu.

### 4.9 Vite derrière Nodefony — une seule origine en dev

Le problème : la page vient de Nodefony (5152, HTTPS), Vite tourne à part (5173, HTTP). Annoncer
ses scripts sur l'origine de Vite, c'est deux origines, deux certificats — et hors boucle locale le
navigateur refuse un script HTTP dans une page HTTPS (« mixed content » : page blanche depuis un
téléphone, une IP de réseau local, un navigateur en conteneur). Or caméra/micro, Service Workers,
WebAuthn exigent une page HTTPS dès qu'on quitte `localhost`.

Le remède (#526 puis #528) :

1. **Chemin réservé par famille** — `devBasePath(famille)` = `/_vite/<famille>/` (`default`, `vue`,
   `angular` : une instance Vite chacune, sur son port). Émis comme `base` par le générateur, porté par
   `status().base`. Vite fabrique ALORS toutes ses URLs sous ce préfixe — y compris celles des assets,
   relatives au document (`import logo from "./logo.png"` → `/_vite/default/src/logo.png`).
2. **Balises RELATIVES** — `TemplateHelper` émet `/_vite/<famille>/@vite/client`, sans origine. Le
   client Vite déduit son socket HMR de l'URL qui l'a chargé : il ouvre donc `wss://<hôte de la
page>/_vite/<famille>/`.
3. **Proxy inverse côté Nodefony** — `FrontendService.mountDevProxy` monte le préfixe sur le service
   `reverse-proxy` de `@nodefony/http` (résolu PAR NOM, anti-cycle) : HTTP GET/HEAD **et upgrade
   WebSocket** relayés vers `TemplateHelper.devTarget()` (origine LOCALE `http://127.0.0.1:<port>`),
   `Host` réécrit (Vite garde `allowedHosts` et `cors` à leurs défauts stricts), `cookie` et
   `authorization` non transmis. Consulté **avant le routage**. `stopDev` démonte ; en production
   aucun montage → `/_vite/` en 404.

Résultat : page, scripts, images, HMR = **une origine, un certificat**, quel que soit le chemin du
client. `frontend.publicOrigin`, `frontend.https` et le paramètre `requestHost` sont RETIRÉS (une
clé restée interrompt le boot en la nommant). CSP dev : `'self'` suffit (couvre `ws(s):` de même hôte, CSP 3).

Pourquoi pas `server.origin` : il fige UNE origine (casse poste + conteneur servis ensemble), et il est
**ignoré en mode bundlé** de Vite (`fileToUrl$1` → `fileToBuiltUrl`) ; `base` est honoré partout.
Pourquoi pas une substitution par requête dans `res.end` : comportement interne de Vite, seconde
politique d'hôte, sourcemaps décalées.

**Pour coder un front** : importer ses images normalement (`import x from "./x.png"`, `url()` CSS,
`new URL("./x.png", import.meta.url)`) — **jamais `?inline` pour contourner l'origine**. Restent hors
remède, comme dans un Vite pur : une chaîne `src="./x.png"` en JSX/Svelte/template Angular (jamais
transformée — importer, ou servir depuis `public/` de l'app) et un `url()` dans les `styles: [...]`
inline d'Angular (analog ne les réécrit pas ; `styleUrls` oui).

Preuves : `tests/integration/devAssetBase.test.ts` (Vite réel), `tests/unit/devAssetRelay.test.ts`,
http `tests/unit/staticRelay.test.ts` + `tests/http/vite-relay.test.ts` (serveur réel).

---

## 5. Recette — ajouter un front à un module

### 5.1 Activer `@nodefony/frontend` AVANT le module consommateur

Dans `nodefony.config.ts` (manifeste `modules`) :

```ts
modules: [
  "@nodefony/http",
  "@nodefony/framework",
  "@nodefony/frontend", // ← AVANT les consommateurs
  "@nodefony/mon-module",
  // surcharge optionnelle de la config frontend :
  // use("@nodefony/frontend", { devPort: 5173 }),
];
```

### 5.2 Installer les peer deps (selon le framework)

```bash
npm i -D vite @vitejs/plugin-react        # react19
npm i -D vite @vitejs/plugin-vue          # vue3
npm i -D vite @analogjs/vite-plugin-angular   # angular (souvent --legacy-peer-deps)
npm i -D vite                             # vanilla
```

### 5.3 Déclarer l'entrée dans le module consommateur (`onKernelBoot`)

```ts
import { Kernel, Module } from "nodefony";
import { controllers } from "@nodefony/framework";
import type { FrontendService } from "@nodefony/frontend";

@controllers([MyController])
class MyModule extends Module {
  constructor(kernel: Kernel) {
    super("my-module", kernel, import.meta.url, config);
  }

  override async onKernelBoot(): Promise<this> {
    const svc = this.kernel?.container?.get("frontend") as
      FrontendService | undefined;
    if (!svc) {
      this.log("@nodefony/frontend non chargé avant ce module", "ERROR");
      return this;
    }
    svc.registerEntry(this, {
      type: "react19", // | "vue3" | "angular" | "vanilla"
      entry: "./frontend/src/main.tsx",
      root: "./frontend",
      outDir: "./public/dist",
      name: "my-module",
    });
    return this;
  }
}
```

### 5.4 Structure du front

```
src/modules/my-module/frontend/
├── index.html              ← optionnel (Nodefony rend la page sinon) ; marqueur <!--nodefony:frontend-->
└── src/
    ├── main.tsx            ← entry (createRoot(...).render(<App/>) pour React)
    └── App.tsx
```

`vite.config.generated.mjs` apparaît dans `root/` au premier `startDev` — **généré**, à ne pas
versionner/éditer.

### 5.5 Rendre la page depuis un Controller

```ts
@controller("/my-route")
class MyController extends Controller {
  constructor(context: Context) {
    super("MyController", context);
  }

  @route("my-app", { path: "/" })
  render(): unknown {
    this.setContextHtml();
    const svc = this.context?.container?.get("frontend") as
      FrontendService | undefined;
    // renderDocument lit l'index.html du module + injecte les tags + nonce CSP.
    // La CSP des origines Vite est gérée automatiquement par le firewall (cf §4.6).
    return super.render(
      svc?.renderDocument("my-module", this.context?.cspNonce) ??
        "<!-- @nodefony/frontend not started -->",
    );
  }
}
```

### 5.6 Dev vs prod

- **Dev** : `npx nodefony development` → Vite démarre au `onServersReady`. Aller sur
  `http(s)://host:5151|5152/my-route/` ; HMR actif en éditant `App.tsx`.
- **Prod** : `nodefony frontend:build` (écrit `public/dist/.vite/manifest.json` par bundle) PUIS
  démarrer en `production`. `renderDocument`/`renderTags` lisent le manifest ; `Statics` sert
  `public/dist` sous `publicPath`.

> Le squelette complet (package.json, peerDeps, App du framework) est produit par le skill
> `nodefony-create-frontend-module`.

### 5.4 Module DISTRIBUÉ npm — UI pré-buildée sans Vite (molette `ui`)

Un module publié npm avec UI (studio, module tiers) ne fait PAS compiler son front par le
consommateur (pattern bull-board/GraphiQL). La mécanique vit dans **@nodefony/http**
(`resolveUiDelivery` + `PrebuiltUi`), PAS ici — le mode `static` marche **sans @nodefony/frontend**
(zéro peerDep vite chez le consommateur) :

- Config du module : molette `ui: "auto" | "static" | "vite"` (défaut `auto` = vite si
  dev+frontend+sources — repo self-hosted/`--link` — sinon statique si `dist/frontend/` shippé,
  sinon `none` fail-loud). JAMAIS vite en prod.
- `static` : `PrebuiltUi.mount()` sert `dist/frontend/` (build Vite app-mode fait AU PUBLISH,
  `base` = publicPath) sous `/_assets/<name>/` ; le controller rend `renderIndex(cspNonce)`.
  Un module static n'appelle pas `registerEntry` → invisible du superviseur/`listEntries()`.
- Référence vivante : `@nodefony/studio` (`index.ts` onKernelBoot, `vite.config.publish.mts`,
  script `build:ui` enchaîné dans `build` — l'UI vit dans `dist/`, un rebuild backend seul
  l'efface sinon). Recette pas-à-pas : skill `nodefony-create-frontend-module` Phase 4.

---

## 6. Gotchas front-build

- **`vite.config.generated.mjs` est réécrit à chaque `startDev`** — ne JAMAIS l'éditer à la main ni le
  versionner. Toute config Vite custom doit passer par le code du module/preset.
- **`Unexpected token '<'` sur un `fetch` d'API** : la page est ouverte sur le port de Vite, qui
  répond son SPA-fallback HTML. L'ouvrir par Nodefony (cf §4.2) — il n'y a pas de proxy d'API.
- **Image importée en 404 / texte alternatif affiché en dev** : URL sans `/_vite/<famille>/` (balise écrite
  à la main au lieu de `renderTags`), proxy non monté (`@nodefony/http` désaligné → WARNING au boot), ou
  frontal qui intercepte `/_vite/*` avant Nodefony. Sonde : `curl -sk -o /dev/null -w "%{http_code}"
https://127.0.0.1:5152/_vite/default/@vite/client` → `200` attendu, en-tête `Via: … nodefony-…` (cf §4.9).
- **Prébundle `.vite` périmé** : après un changement d'import/subpath ou un upgrade de dep, Vite peut
  servir un cache `node_modules/.vite` obsolète → erreurs d'import fantômes. Purger
  `node_modules/.vite` (le dossier de l'app/du root concerné) puis relancer.
- **Subpath/nouveau fichier non résolu** : `server.fs.allow` ne liste que `process.cwd()` + les `root`
  d'entrées. Un import hors de ces dossiers (ex. fichier dans un autre package non hoisté) → bloqué par
  Vite. Mettre la ressource sous un `root` connu, ou l'exposer via `/@fs/<abs>` (couvert par `cwd`).
- **Port Vite réel ≠ `devPort`** : si 5173 est pris, Vite incrémente ; lire `svc.status().port`. Le
  superviseur parse `Local:` pour le vrai port.
- **Multi-bundle : même `main.tsx` chargé pour toutes les pages** = symptôme de l'URL relative au lieu
  de `/@fs/<abs>`. Vérifier que `renderTags` est utilisé (pas une injection `<script>` manuelle) et que
  chaque `root` est dans `server.fs.allow`.
- **React : `@vitejs/plugin-react can't detect preamble`** : le preamble Fast Refresh n'a pas été
  injecté → utiliser `svc.renderTags("name")`/`renderDocument` (qui l'inline pour `type:"react19"`),
  jamais des `<script>` à la main.
- **Angular casse les autres bundles** : si le plugin Angular transforme des `.ts` hors de son app,
  c'est un défaut de scoping → famille d'isolation `angular` (process séparé) + `tsconfig.app.json` dont
  le `include` ne couvre QUE le front Angular (`isolationGroups.ts`/`ViteConfigGenerator.ts:89`).
  Angular HMR = page reload (pas hot-swap).
- **HTTPS en dev** : rien à faire côté Vite — il est relayé sur l'origine de la page (§4.9), un seul
  certificat à accepter (celui de 5152). `frontend.https` n'existe plus (clé refusée au boot).
- **Vite orphelin / `EADDRINUSE` au restart** : cause = signaux mal relayés. Le superviseur lance le
  vrai bin Vite (pas `npx`) et `detached:false` pour que SIGINT/SIGKILL l'atteignent. Pour tuer un Vite
  resté en vie dans un test : `lsof -ti:<port> -sTCP:LISTEN`.
- **Restart en boucle (`max restarts reached`)** : le superviseur abandonne après `maxRestarts` (5) →
  `state:"errored"`. Lire les logs `[vite]` dans le syslog pour la cause, fixer la source, ou augmenter
  `maxRestarts`.
- **Manifest prod absent → page sans scripts** : `renderProdTags` retourne un commentaire HTML si
  `outDir/.vite/manifest.json` manque → lancer `nodefony frontend:build` AVANT de servir en prod.
- **Build prod « page blanche »** : vérifier que la route backend rend bien `renderDocument`/`renderTags`
  (et non un stub) — en prod le helper doit lire le manifest, pas un placeholder dev.

---

## 7. Commandes CLI

Enregistrées par le module (`index.ts:37-39`) :

- **`nodefony frontend:build [-f|--force]`** (`command/frontend-build.ts`) — build prod de toutes les
  entrées (`vite.build()` par bundle). Idempotent (skip si à jour) ; `--force` rebuild tout ; exit code
  `1` si un bundle échoue. Scripts racine : `npm run build:front`, `npm run build:all` (backend + front).
- **`nodefony frontend:dev`** (`command/frontend-dev.ts`) — démarre Vite manuellement (si
  `autoStartInDevelopment:false`).
- **`nodefony frontend:status [-j|--json]`** (`command/frontend-status.ts`) — état du superviseur
  (state/endpoint/pid/entries) ; `-j` = JSON (consommé par Studio, équivalent de
  `GET /nodefony/frontend/api/vite`).

---

## 8. Vérifier une modif front SANS navigateur

Règle projet : **jamais de navigateur headless / CDP**. Une modif front se prouve côté serveur en
une à trois commandes, puis se **confirme visuellement par le user**. Ce qui suit remplace
l'ouverture d'un navigateur, pas la confirmation.

### 8.1 Le transform Vite répond-il ?

Vite sert un fichier absolu sous le préfixe `/@fs/` — c'est le moyen de vérifier d'un coup la
**résolution** et la **transpilation** :

```bash
ABS="/Users/cci/repository/nodefony-core/src/packages/@nodefony/studio/frontend/src/routes/MaVue.tsx"
curl -sk -o /tmp/vite-check.js -w "http=%{http_code} size=%{size_download}\n" \
  "https://127.0.0.1:5152/_vite/default/@fs${ABS}"
head -5 /tmp/vite-check.js
```

Attendu : `http=200`, une taille au-delà de quelques centaines d'octets, et du **JavaScript
transpilé** (`import … from "react"`, `_jsx(…)` en React 19) — pas de JSX brut, pas de
`Failed to resolve`, pas de `Pre-transform error`.

| Symptôme                                | Cause                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `http=404`                              | chemin faux, ou fichier hors des dossiers autorisés (`server.fs.allow`) |
| `http=500`                              | erreur de syntaxe TS/TSX — Vite renvoie l'erreur en commentaire         |
| `http=200` mais du HTML (`<title>`)     | URL de la page servie, pas `/@fs/<abs>`                                 |
| `http=200` mais la modif n'apparaît pas | prébundle périmé → §8.2                                                 |

> On passe par Nodefony (5152) et le préfixe de la famille (`default`, `vue`, `angular`) : c'est le
> chemin réel du navigateur, proxy compris. Vite lui-même écoute en HTTP sur la boucle locale (5173
> par défaut, port réel : `nodefony frontend:status -j`).

### 8.2 Purger le prébundle d'un module

Vite met en cache les dépendances pré-bundlées dans `node_modules/.vite`. Ce cache **ignore** qu'un
import ou un subpath vient d'apparaître → il peut servir une version sans le nouveau symbole, et le
front semble affirmer qu'un export inexistant… existe pourtant dans le source.

```bash
MOD="src/packages/@nodefony/studio"
rm -rf "$MOD/node_modules/.vite" "$MOD/frontend/node_modules/.vite"
```

Purger **quand** : subpath du cœur nouvellement importé (`nodefony/react`, `nodefony/roles`…) ;
dépendance ajoutée côté front ; erreur `does not provide an export named '…'` sur un import qui
existe ; après un `git pull` qui change les exports d'un module dépendant. Puis redémarrer le
serveur (le subpath neuf force de toute façon une ré-optimisation au boot).

**Ne pas purger sans raison** : la ré-optimisation coûte 5 à 20 s par module au démarrage.

### 8.3 Ce que ces vérifications ne prouvent PAS

- **Les types.** Le transformateur de Vite (esbuild) attrape la syntaxe, jamais les types : un type
  incompatible passe le transform en silence. Gate distincte, dans le module concerné :
  `npm run typecheck` → 0 erreur.
- **Le rendu.** Demander un **rechargement forcé** (`Cmd+Shift+R` sur Safari/Mac, `Ctrl+Shift+R`
  ailleurs) : le navigateur peut conserver l'ancien composant en mémoire après un HMR partiel.
  En **cluster** (`nodefony cluster -w N`) il n'y a **pas de HMR** — après rebuild, le rechargement
  forcé avec « Disable cache » actif est obligatoire, sinon un vieux `index.html` demande un chunk
  haché qui n'existe plus : import différé en 404, ce qui ressemble à un bug de code sans en être un.
- **Les erreurs React au runtime** (hook conditionnel, état mal initialisé) : elles ne se voient que
  dans la console du navigateur — demander au user de coller les lignes.

> Grouper les modifs front avant de demander **une** vérification visuelle, plutôt que d'enchaîner
> les allers-retours.

## 9. Voir l'écran soi-même → skill `nodefony-browser`

Un navigateur en conteneur (service `browser` du `docker-compose.yml`) lit la **console**, l'arbre
d'accessibilité, les **requêtes réelles**, et **MESURE** les couleurs et tailles calculées — sans
rien installer sur le poste. C'est l'environnement isolé que l'exception à la règle « pas de
Chromium sur le poste » prévoyait.

> 🔴 **Ne jamais demander au développeur de jouer la sonde** (« recharge et dis-moi la console »).

Le décor, le pilotage, les trois contraintes structurelles (joindre l'hôte par
`host.docker.internal`, passer par HTTPS 5152, rendre Vite joignable) et les pièges qui font
conclure faux vivent dans le skill **`nodefony-browser`** — ils ne sont pas recopiés ici : une règle
écrite à deux endroits diverge, et la copie empêche d'atteindre le skill qui porte le diagnostic.

Ce qui reste PROPRE au front et vit donc ci-dessus (§8) : prouver une modif **sans** navigateur
(transform Vite en `curl`, purge du prébundle). Le HMR, l'animation et le rendu fin se jugent dans
le navigateur du développeur — le conteneur constate qu'un écran se monte, s'alimente et ne crie pas.

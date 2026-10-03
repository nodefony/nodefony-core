# MEMORY.md — @nodefony/frontend

Purpose: builder Vite multi-framework. Successeur webpackService legacy.

## Core Components

- `Frontend` (Module class) — declared services: [FrontendService]. Commands: frontend:{build,dev,status}.
- `FrontendService` — @injectable, name="frontend". Container.get("frontend").
- `ViteProcessSupervisor` — spawn `npx vite --config <generated.mjs>`. Parse stdout "Local:" → state=ready.
- `ViteConfigGenerator` — produit `${moduleRoot}/vite.config.generated.mjs`. Hardcode imports plugins selon preset types.
- `ViteBuilder` — config Vite in-proc pour mode build (vite.build() programmatique).
- `TemplateHelper` — `renderTags(entryName)` → `<script type="module" src="http://host:port/...">`.

## Presets

- react19 → `@vitejs/plugin-react` lazy import, optimizeDeps: react/react-dom/react-dom/client. Extensions: tsx,jsx,ts,js. TemplateHelper inline preamble Fast Refresh.
- vue3 → `@vitejs/plugin-vue` lazy import, optimizeDeps: vue. Extensions: vue,ts,js. PAS de preamble (Vue se monte via `createApp(App).mount()` dans l'entry) → TemplateHelper chemin générique. Consommateur réf: `src/modules/test-frontend-vue`.
- angular → `@analogjs/vite-plugin-angular` lazy import, optimizeDeps: @angular/core+common+platform-browser. Extensions: ts,html. Angular 21 standalone+zoneless (`bootstrapApplication`+`provideZonelessChangeDetection`, pas zone.js). Generator émet `angular({ disableTypeChecking: false, tsconfig: <ABSOLU> })` (analogjs coupe le typecheck des templates par défaut → sans le drapeau, strictTemplates/strictUnclaimedEventNames ne mordent pas) résolu depuis `angularEntry.root` (cwd Vite = entries[0].root ≠ root angular). PAS de preamble. Consommateur réf: `src/modules/test-frontend-angular` (/angular/app). **Gotchas** : install `--legacy-peer-deps` (TS6 vs @angular/build peer <6.0, mais compiler-cli accepte <6.1) ; `@analogjs/*`+`@angular` DOIVENT être dans `external` du rolldown.config frontend (compiler-cli interop CJS typescript non-bundlable) ; le plugin transforme TOUS les .ts → scoping par tsconfig.app.json (include = frontend angular only) sinon casse le main.ts de Vue ; HMR = page reload (pas hot-swap).
- vanilla → no plugin, no optimizeDeps. Extensions: ts,js.
- svelte5: lazy `@sveltejs/vite-plugin-svelte` (export NOMMÉ `{ svelte }`, spécificateur par VARIABLE — paquet porté par l'app, absent du dépôt). App `--link` : fallback `createRequire(cwd)` + `pathToFileURL` (le preset vit dans le CHECKOUT, le plugin dans l'APP — l'import relatif à l'importeur ne le voit pas). Entry Svelte 5 : `mount(App, { target })` (runes). Famille `default`.

## Vite derrière Nodefony — UNE origine (#528)

- Vite écoute sur la boucle locale (`devHost`, défaut `127.0.0.1`) ; le navigateur ne le joint JAMAIS : `FrontendService.mountDevProxy(devBase, helper)` monte `/_vite/<famille>/` sur le service `reverse-proxy` de `@nodefony/http` (résolu PAR NOM, anti-cycle) — `{ target: () => helper.devTarget(), websocket: true, methods: GET/HEAD, stripHeaders: cookie/authorization }`. `stopDev` → `unmount` par famille.
- Balises RELATIVES (`TemplateHelper.renderDevTags` : `baseUrl = basePathOf(status)`, aucune origine) → page, scripts, images, `url()` CSS ET socket HMR (le client Vite le déduit de `importMetaUrl` = l'origine de la page) partagent origine + certificat. Plus de contenu mixte hors boucle locale ; `isSecureContext` sur IP de LAN / conteneur / Codespaces dès que la page est en HTTPS.
- `TemplateHelper.devTarget()` = `status().origin` (`http://<browserReachableHost(devHost)>:<port réel>`, `undefined` tant que `port === null`) — cible LOCALE, jamais annoncée au navigateur. `browserReachableHost` (0.0.0.0/:: → 127.0.0.1) vit dans `ViteProcessSupervisor.ts`.
- Le proxy réécrit `Host` en `127.0.0.1:<port>` ⇒ générateur SANS `allowedHosts` NI `cors` (barrières Vite DNS-rebinding + CORS CVE-2025-24010 au plus strict) ; jamais de ligne `hmr`.
- RETIRÉS (le relais les rend sans objet) : `frontend.publicOrigin`, `frontend.https` → schéma strict, boot refusé en nommant la clé ; paramètre `requestHost` de `renderTags`/`renderDocument` (signature `(entryName, nonce?)`).
- Résilience : timeout boot → SIGKILL de l'arbre (sinon Vite ORPHELIN hors machine à états) ; `cleanupChildListeners()` en tête d'`attemptSpawn` (drain retry) ; ping santé sur `browserReachableHost` (0.0.0.0 inconnectable win32) ; **budget restarts réarmé au 1er ping santé OK** (5 crashs épars ≠ crash-loop ; le plafond ne compte que les rafales) ; win32 sans viteBin → refus NOMMÉ (npx `.cmd` = EINVAL, pas de fallback masqué) ; exit pendant `willingShutdown` au boot → « arrêt demandé », pas « family failed ».

## Assets en dev (#526)

- Vite en dev réduit `base` à son CHEMIN (`resolveBaseUrl`) → une URL d'asset (`import x from "./x.png"`, `url()` CSS, `<img src>` Vue) est relative au DOCUMENT — sous `/_vite/<f>/`, donc relayée. `viteOrigin` du générateur = `@deprecated`, sans effet.
- `devBasePath(f)` (`isolationGroups.ts`) = `/_vite/<f>/` — `default` | `vue` | `angular`, une instance Vite chacune. Émis `base`, rendu `status().base`, préfixe de TOUTES les balises (Vite refuse hors base).
- Hors remède (comme Vite pur) : chaîne `src="./x"` JSX/Svelte/template Angular non transformée ; `url()` des `styles: [...]` inline Angular (analog). `styleUrls` OK.
- Tests : `unit/devAssetRelay.test.ts`, `unit/templateHelperOrigin.test.ts`, `integration/devAssetBase.test.ts` (Vite réel, fixture `fixtures/asset-frontend`) ; proxy : http `unit/reverseProxy.test.ts`.

## Pipeline

1. consumer module → `frontendService.registerEntry(this, { type, entry })` dans onKernelBoot()
2. kernel.**onServersReady** + env=development + autoStart → service.startDev() (PAS onReady — Vite après que les servers Nodefony écoutent)
3. startDev → `#registerCsp()` puis par famille : `mountDevProxy(devBasePath(famille))` → generator.toMjs (`base: /_vite/<famille>/`, strictPort toujours en dev, AUCUN `server.proxy`) → writeFileSync → supervisor.start (spawn vite)
4. browser → controller rend HTML → TemplateHelper.renderTags injecte `<script>` (+ React preamble pour react19)
5. browser → Nodefony `/_vite/<famille>/…` (HTTP ET upgrade WS du HMR) → proxy inverse → Vite `127.0.0.1:<port>`. Le navigateur ne voit jamais le port Vite.
6. kernel.onTerminate → supervisor.stop (idempotent) → SIGINT + SIGKILL 3s

## Config DEFAULTS

```ts
{
  devHost: "127.0.0.1",
  devPort: 5173,
  autoStartInDevelopment: true,
  defaultOutDir: "./public/dist",
  defaultRoot: "./frontend",
  startupTimeoutMs: 30_000,
  pipeViteLogs: true,
  viteEnv: {},              // VITE_* exposé browser via import.meta.env
  resilience: {             // toutes optionnelles, defaults supervisor
    autoRestart: true,
    maxRestarts: 5,
    restartBackoffBaseMs: 500,
    restartBackoffMaxMs: 8_000,
    healthCheckIntervalMs: 30_000,
    healthCheckFailureThreshold: 3,
    portRetryAttempts: 3,
  },
}
```

## Behaviors

- `vite.config.generated.mjs` overwrite à chaque startDev — ne jamais éditer.
- Port retry : conflit FATAL → devPort+1, devPort+2 (max portRetryAttempts). Port réel dans `status.port` (`null` si rien n'est résolu ; `resolvedPort` remis à `null` à chaque démarrage).
- 🔴 **`isPortInUseMessage` reconnaît un conflit FATAL, pas la chaîne « in use ».** Vite écrit TROIS textes, un seul est un échec (source `httpServerStart`, vite 8.3.0) : `Port X is **already** in use` → `throw`, vite meurt, seul cas à replier · `Port X is in use, trying another one…` → `logger.info`, vite se décale seul · `Port X is in use on a wildcard address, but H:X is available…` → `logger.warn` sur un listen **RÉUSSI**. `already` est le discriminant et il est OBLIGATOIRE. Le rendre optionnel faisait replier un démarrage sans conflit via `startupTimeoutMessage`, au prix de `(portRetryAttempts + 1) × startupTimeoutMs` = 80 s — invisible sur un poste (vite y meurt vite), fatal sur un agent partagé et lent.
- Budget de repli = `(portRetryAttempts + 1) × startupTimeoutMs`. Tout banc qui laisse le superviseur l'épuiser doit avoir une échéance PLUS GRANDE, sinon le harnais le tue avant qu'il puisse parler.
- Auto-restart : child.exit avec state=ready (= crash inattendu) → scheduleRestart() avec backoff exponentiel. `willingShutdown` flag distingue shutdown volontaire.
- Health check : setInterval (default 30s) GET `viteOrigin/`. 3 échecs consécutifs → kill child → trigger restart.
- Idempotence : 2e `start()` retourne `startPromise` en cours. `stop()` mémorise `stopPromise`.
- Listener tracking : `trackListener(target, event, fn)` + `cleanupChildListeners()` au exit. Évite MaxListenersExceededWarning entre restarts.
- HTTPS Vite : option bas niveau `ViteProcessSupervisor({ https: { keyPath, certPath } })` → generator émet `server.https`. `FrontendService` ne la passe JAMAIS (Vite en HTTP sur la boucle locale, le chiffrement est celui de la page).
- React preamble : TemplateHelper inline `<script type="module">` avec `RefreshRuntime.injectIntoGlobalHook` pour entries `type: "react19"`. Sans ça : `@vitejs/plugin-react can't detect preamble`.
- Logs pipeline : split lignes + strip ANSI (`\x1b\[…m`) + dédup préfixe `[vite]` (Vite préfixe parfois lui-même).
- Mode prod: `service.build()` → `vite.build(cfg)` in-proc (one-shot, OK).
- Cleanup stop: SIGINT puis SIGKILL après 3s. Évite zombies bloquant 5173.

## Errors

- `FrontendError` — base, code+context.
- `FrontendPresetUnknownError` — preset type non enregistré.
- `FrontendSupervisorStartError` — spawn/timeout/exit-before-ready.
- `FrontendNoEntriesError` — startDev sans registerEntry préalable.

## Commands CLI

- `nodefony frontend:dev` — start manual (si autoStart=false)
- `nodefony frontend:build` — vite.build() prod
- `nodefony frontend:status [-j]` — état supervisor + entries (consommé par Studio)

## Gotchas

- TemplateHelper.stripRoot strip "./frontend/" du entryFile pour URL Vite (`src/main.tsx`).
- `module.path` (Module class) requis pour résoudre les chemins absolus du consumer.
- Si `state !== "ready"` quand renderTags est appelé → commentaire HTML `<!-- vite supervisor state=... -->`.
- Container.get("frontend") = name passé au constructor Service (pas le className).
- CSP (dev) : `FrontendService.#registerCsp()` déclare le fragment Vite au firewall `@nodefony/security` via `registerCspOrigins("frontend", #viteCspFragment())` (résolu PAR NOM = anti-cycle) → le firewall émet **UN seul** CSP (origines mergées + **nonce par requête**, propagé par `renderDocument(entry, nonce)`). Plus de hack `setHeader`/`getCspDirectives` (supprimés). Fragment Vite (`#viteCspFragment`) : `'self'` dans CHAQUE directive (connect/style/img/font/worker n'héritent pas de `default-src`), `'unsafe-eval'` (React Fast Refresh, non couvert par le nonce), `worker-src 'self' blob:`, `blob:`/`data:` sur connect/img. Jamais émis en prod.
- **CSP posée AVANT le 1er spawn Vite** (`startDev` → `#registerCsp()`) : `startDev` part sur `onServersReady` — les serveurs écoutent DÉJÀ, et un CSP est FIGÉ pour la durée de la page. Le fragment ne nomme AUCUNE origine ni aucun port (tout passe par l'origine de la page) : il ne dépend donc plus de ce que Vite résoudra — `'self'` couvre aussi le `ws(s):` de même hôte (CSP 3). Verrou : `unit/cspBeforeVite.test.ts`.
- Pas de `server.proxy` Vite (ni `apiProxyPaths`, ni `backend*` — retirés) : la page est rendue par Nodefony, ses `fetch` partent sur sa propre origine ; Vite ne reçoit que ce que le relais `/_vite/<famille>/` lui transmet. Une clé `backend*` restée en config → boot refusé, clé nommée (schéma strict).
- `process.kill(child.pid)` tue `npx` (parent), pas Vite. Pour tuer Vite réel dans tests : `lsof -ti:port -sTCP:LISTEN`.
- Test crash auto-restart : `pidListeningOn(port)` puis SIGKILL ; attendre `state==="ready"` + `pid !== nodefonyPidBefore` + `restartCount === 1`.

## Events (Service EventEmitter)

- `frontend:starting` (payload `{ entries }`) — avant spawn
- `frontend:ready` (payload `IViteSupervisorStatus`) — Vite ready
- `frontend:error` (payload `Error`) — spawn/timeout fail
- `frontend:stopped` (no payload) — après stop() propre

### Pont events KERNEL (dev-only — checklist boot `BootReporter`)

Vite compile HORS du cycle Kernel (spawn async, finit après `onPostReady`). Pour l'afficher dans la checklist de boot dev, `FrontendService` émet sur le **kernel** (`kernel.fire`) :

- `onFrontendStart` (payload `{ bundles: number }`) — **SYNCHRONE** dans le handler `onServersReady`, AVANT le `await startDev()` → fire avant `onPostReady` (sinon le reporter finirait avant). BootReporter ouvre la ligne « Frontend (Vite) ».
- `onFrontendReady` (payload `{ bundles, names: string[], ready: number }`) — en `finally` (débloque toujours, succès comme échec). `ready` = nb de familles Vite en état `ready` (0 → `✗ échec`). BootReporter fige la ligne + débloque le « ✓ Prêt » différé.

Aucun listener (boot direct via `start.sh`, prod) → `fire` no-op, 0 coût. Ne fire QUE dans la branche dev (`env === development && autoStartInDevelopment`).

## Tests

- Unit : `nodefony/tests/unit/ViteConfigGenerator.test.ts` — 21 cases. Pure function, ~10ms. Runner = **vitest** (`npm test` = `vitest run`).
- Intégration : `nodefony/tests/integration/ViteProcessSupervisor.test.ts` — 3 cases (start+stop, idempotence, crash auto-restart). Real spawn ~6s. Runner = mocha+ts-node (`npm run test:integration`), **process Vite séparé**.
- Fixture : `nodefony/tests/fixtures/minimal-frontend/` (index.html + src/main.ts vanilla).

## Coverage

- `npm run coverage` = `vitest run --coverage` (v8). Config `vitest.config.ts` (mirror framework, sans alias ORM — test importe la source pure). Setup `nodefony/tests/vitest.setup.ts` + shim `vitest-mocha-shim.mjs`. Sortie `.coverage/` (lcov + json-summary) → onglet Coverage Studio (`readCoverage`).
- **ViteConfigGenerator.ts = 100% lines (53/53)** ; module-wide ~12% (autres fichiers non testés inclus dans `include`, idem framework/http — le % unit ne mesure pas le runtime).
- **Split assumé** : l'intégration (`ViteProcessSupervisor`, spawn Vite) tourne en process séparé → JAMAIS instrumentée. cf [[feedback_coverage_modules]].

## API Studio (route /nodefony/frontend/\*)

- GET /nodefony/frontend/api/status → JSON status (idem `frontend:status -j`)
- GET /nodefony/frontend/api/entries → list entries résolues
- POST /nodefony/frontend/api/restart → stop + startDev

## Prod build + renderProdTags

- **`publicPath`** (IResolvedFrontendEntry, requis) : défaut `/_assets/<entryName>/` (normalisé leading+trailing `/`). = `base` Vite (prod) ⇄ mount `Statics` ⇄ préfixe URLs manifest. Surcharge via `frontend.publicPath`.
- **`TemplateHelper(supervisor|null, mode, entries?)`** : prod → `renderProdTags` lit `outDir/.vite/manifest.json` (fallback `manifest.json` legacy). Cache `Map` par outDir : un manifest TROUVÉ seulement — l'ABSENCE n'est JAMAIS cachée (sinon page blanche jusqu'au restart même après build ; coût de la relecture = état dégradé only). Clé = `entryFile` POSIX sinon chunk `isEntry`. Émet CSS (récursif via imports) + `modulepreload` (imports) + `<script type=module crossorigin>`, préfixés `publicPath`. Manifest absent → commentaire (0 crash) + auto-guérison au reload post-build.
- 🔴 **`build()` pose `NODE_ENV=production` et le RESTAURE** (#137) : Vite dérive `isProduction` de `process.env.NODE_ENV`, qui **PRIME sur le `mode`** de la config. Le kernel d'une commande CLI démarre en développement ⇒ `nodefony frontend:build` publiait un bundle de DÉVELOPPEMENT malgré `mode:"production"` — `import.meta.env.DEV` vrai chez l'utilisateur final (tout code gardé par ce drapeau s'exécutait en production) et messages d'aide du framework de vue embarqués. Le défaut était INVISIBLE dans la config, qui était juste : il ne se voit que sur le fichier RENDU. Restauration obligatoire — `build()` est aussi appelé par `setupProd()`, laisser la variable posée marquerait un process de dev comme production à vie. Témoin dans la fixture (`NODEFONY_BUILD_DEV`/`_PROD`, une seule branche survit au remplacement) → `tests/integration/frontend-build.test.ts`.
- **`FrontendService.build({force?})`** : `vite.build` **par entry** (boucle, pas 1 config partagée — multi-module + Angular isolé). **Skip** si `manifest.mtime >= newestSourceMtime(root)` (scan borné, ignore node_modules/.vite/outDir). Retourne `{built, skipped, failures}`. `ViteBuilder` ajoute `base = assetBaseUrl + publicPath` SEULEMENT en `production`.
- **`assetBaseUrl`** (config `frontend.assetBaseUrl`, défaut `""`) : base CDN/object-storage des assets PROD. Préfixe (sans toucher au mount `Statics` qui reste relatif à l'origine) : `base` Vite build · URLs `renderProdTags` (`this.assetBaseUrl + publicPath`) · helper `asset('/x')`. `FrontendService.assetUrl(p)` = base normalisée (sans slash final) + p ; identité si vide ou URL absolue. Helper de vue `asset` injecté par `Controller.withFrontendLocals` (locals Eta). Test : `ViteBuilder.test.ts`. Carte → CDN via `assets:publish` (à venir).
- **`setupProd()`** (hook `onServersReady`, `env !== development`, async) : entry sans manifest → vite résolvable = `build()` one-shot au boot (WARNING annoncé) ; vite absent (image runtime sans devDeps) = ERROR nommant entry + geste. Jamais de page blanche muette. Puis `container.get("server-static").addMount(publicPath, outDir)` par entry + `prodHelper`. `renderTags` route vers `prodHelper` si présent. **Anti-cycle** : jamais d'import `@nodefony/http`, résolution par nom DI.
- **`Statics` (http)** : `addMount(prefix,dir)` (normalise, idempotent, `serve-static` cache 96h) + `hasMounts()`. `handle()` : guard `url.startsWith(prefix)` (O(1), 0 stat disque sinon) → strip → `serve-static` (pose Content-Type ; fichier servi = Promise pending = routing court-circuité). `http-kernel.onHttpRequest` déclenche le static si `options.statics` OU `hasMounts()`.
- **Page blanche** = route back `GET /nodefony` (StudioController) : injectait `renderTags("studio")` = stub en prod → 0 `<script>` → React jamais chargé. Même route dev/prod, seul le contenu injecté diffère.
- **Pipeline repo** : `npm run build` (backend) PUIS `npm run build:front`/`build:all`. CLI `nodefony frontend:build` fonctionne (dispatch des commandes de module fixé). **Apps générées** : leur `npm run build` chaîne `rolldown && nodefony frontend:build` (un seul geste avant `npm start`).
- **Preuve runtime** : cluster `-w 2` → `GET /nodefony` = balises `/_assets/studio/...` fingerprintées, assets HTTP 200 via Statics. Tests : `tests/integration/frontend-build.test.ts` (8, vrai vite.build + renderDocument).

## Coquille templatable — `renderDocument` + helpers de vue (Eta)

- **Plus de shell codé en dur** dans le controller. `TemplateHelper.renderDocument(entry, nonce?)` lit l'`index.html` DU MODULE (`entry.root`, le dev y met meta/polices/scripts externes), **retire** le `<script type=module src=…entry…>` source (Vite-native, non résolvable quand Nodefony sert la page), injecte les tags (avec le `nonce` CSP) au marqueur **`<!--nodefony:frontend-->`** sinon avant `</head>`. Pas d'`index.html` → coquille minimale générée. `index.html` caché par root en **prod** (dev re-lit pour refléter les éditions).
- `FrontendService.renderDocument(entry, nonce?)` route comme `renderTags` (prodHelper / family helper). `StudioController.renderStudio` = `this.render(svc.renderDocument("studio", ctx.cspNonce))`.
- **Helpers de vue** (façon Symfony `encore_entry_script_tags`), source unique = `renderTags`/`renderDocument` : injectés dans les **locals Eta** par `Controller.withFrontendLocals(param)` (résout `frontend` par nom, anti-cycle) → `frontendTags(entry)` / `frontendDocument(entry)` / `asset(path)`. Plus de Twig/EJS (moteur de vues unique = **Eta**).
- 2 portes d'entrée, 1 source : `index.html` statique (injection marqueur) · vue Eta (`frontendTags`/`frontendDocument`). Toutes finissent par `renderProdTags` (prod) / dev tags.

## Debug bar — auto-injection dev (`TemplateHelper`)

`renderDevTags()` injecte en **dev only** la debug bar Core (`nodefony/debugbar`) après l'entry :

- résout le fichier 1× via `createRequire(import.meta.url).resolve("nodefony/debugbar")` (caché module-level), sert via le `/@fs/<abs>` de Vite (couvert par `server.fs.allow` = cwd).
- `mountDebugBar({ frontend: { framework, name, viteOrigin, hmrUrl } })` → carte Frontend + sonde HMR (`wss://host:port/`). `framework` = `entry.type` (react19/vue3/angular).
- irrésoluble → commentaire HTML, n'altère jamais la page. Apparaît sur toutes les pages front en dev (Studio inclus).
- Pages **hors Vite** (rendu serveur Eta) : pas concernées par renderTags → utiliser le bundle standalone `nodefony/debugbar.js` (cf core MEMORY, ex. route test `/nodefony/test/debugbar.js`).

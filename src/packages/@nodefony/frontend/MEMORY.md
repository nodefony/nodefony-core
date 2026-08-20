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
- angular → `@analogjs/vite-plugin-angular` lazy import, optimizeDeps: @angular/core+common+platform-browser. Extensions: ts,html. Angular 21 standalone+zoneless (`bootstrapApplication`+`provideZonelessChangeDetection`, pas zone.js). Generator émet `angular({ tsconfig: <ABSOLU> })` résolu depuis `angularEntry.root` (cwd Vite = entries[0].root ≠ root angular). PAS de preamble. Consommateur réf: `src/modules/test-frontend-angular` (/angular/app). **Gotchas** : install `--legacy-peer-deps` (TS6 vs @angular/build peer <6.0, mais compiler-cli accepte <6.1) ; `@analogjs/*`+`@angular` DOIVENT être dans `external` du rolldown.config frontend (compiler-cli interop CJS typescript non-bundlable) ; le plugin transforme TOUS les .ts → scoping par tsconfig.app.json (include = frontend angular only) sinon casse le main.ts de Vue ; HMR = page reload (pas hot-swap).
- vanilla → no plugin, no optimizeDeps. Extensions: ts,js.
- svelte5: lazy `@sveltejs/vite-plugin-svelte` (export NOMMÉ `{ svelte }`, spécificateur par VARIABLE — paquet porté par l'app, absent du dépôt). App `--link` : fallback `createRequire(cwd)` + `pathToFileURL` (le preset vit dans le CHECKOUT, le plugin dans l'APP — l'import relatif à l'importeur ne le voit pas). Entry Svelte 5 : `mount(App, { target })` (runes). Famille `default`.

## Dev déporté (P14.17) — origine PUBLIQUE ≠ adresse d'écoute

- `remoteDev.ts` (src/, PUR, env injecté) : `resolveOriginTemplate(tpl, port)` → `{origin, hmr{host,clientPort,protocol}}` ; `{port}` substitué au port RÉEL de chaque spawn (suit familles + retries). `detectRemoteDev(env)` : Codespaces (`CODESPACE_NAME`+`GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN` → `https://<name>-{port}.<domain>`) · Gitpod (`GITPOD_WORKSPACE_URL` → `https://{port}-<host>`). `allowedHostPatternForTemplate` (`{port}` dans l'hôte → `.suffixe` wildcard Vite) · `viteAllowedHostFromPattern` (`*.x` trustedHosts → `.x` Vite ; autre `*` → null ANNONCÉ).
- Priorité origine : `frontend.publicOrigin` config (validée, invalide = ERROR + dérivation locale) > **dérivation par `Host` de la requête** > détection plateforme > dérivation `browserReachableHost(devHost)`:port (0.0.0.0/:: → 127.0.0.1). PAS de variable d'env (retirée : décor d'observation oublié = poste cassé).
- **Dérivation par requête** : `renderTags/renderDocument(entry, nonce?, requestHost?)` → `FrontendService.derivableHost()` décide, `originWithHostname(origin, host)` (pur, `remoteDev.ts`) exécute. Remplace le NOM seul — scheme+port restent ceux de Vite (page http:5151 → assets https:5173). 3 gardes : origine non épinglée (`originPinned` posé au `startDev` si template) · `HttpKernel.isTrustedHostname(h)` (règle UNIQUE, résolue par nom) · `trustedHosts !== true` (bypass = CSP ne couvre que loopback+domain). Host inexploitable → `null` → origine résolue. PROD : ignoré (manifest = chemins relatifs). Helpers Eta (`Controller.withFrontendLocals`) propagent nonce+domain automatiquement.
- `status().origin` = SOURCE UNIQUE des URLs (TemplateHelper baseUrl, boot line, CSP origines exactes + variante ws, FrontendAdminApi.origin, Studio Runtime « Origine », `frontend:status` ligne `public`).
- `viteAllowedHosts()` : `trustedHosts` http (`true`→`true` ; strings converties ; RegExp ignorées WARNING) + domaine kernel + hôte du template — 1 liste (ouvrir un hôte dans trustedHosts ouvre 421, Vite, le CSP ET l'origine dérivée). Vite accepte IP/localhost d'office (source Vite 8 vérifiée : 403 sinon, prouvé au banc témoin).
- ⚠️ **Vite 8 ne monte le check `allowedHosts` HTTP que si `!server.https`** (`node.js:26556`) — nos serveurs sont en TLS, donc le check HTTP est SAUTÉ. Le **WS HMR l'applique toujours** (`shouldHandle` → `isHostAllowed`, + token si `origin` présent). Conséquence : un hôte hors `allowedHosts` charge la page mais n'a PAS de HMR — symptôme muet.
- Generator émet `server.allowedHosts` + `server.hmr` SEULEMENT si fournis (défauts locaux intacts). hmr sans port dans l'origine → 443/80 (forwarder TLS, wss).
- Superviseur : origine figée (sans `{port}`) + port décalé → ERROR annoncée ; multi-familles + origine figée → WARNING (une origine ne sert qu'UNE famille).
- Résilience : timeout boot → SIGKILL de l'arbre (sinon Vite ORPHELIN hors machine à états) ; `cleanupChildListeners()` en tête d'`attemptSpawn` (drain retry) ; ping santé sur `browserReachableHost` (0.0.0.0 inconnectable win32) ; **budget restarts réarmé au 1er ping santé OK** (5 crashs épars ≠ crash-loop ; le plafond ne compte que les rafales) ; win32 sans viteBin → refus NOMMÉ (npx `.cmd` = EINVAL, pas de fallback masqué) ; exit pendant `willingShutdown` au boot → « arrêt demandé », pas « family failed ».

## Pipeline

1. consumer module → `frontendService.registerEntry(this, { type, entry, apiProxyPaths })` dans onKernelBoot()
2. kernel.**onServersReady** + env=development + autoStart → service.startDev() (PAS onReady — Vite après que les servers Nodefony écoutent)
3. startDev → generator.toMjs (base, https, proxy, viteOrigin) → writeFileSync → supervisor.start (spawn vite)
4. browser → controller rend HTML → TemplateHelper.renderTags injecte `<script>` (+ React preamble pour react19)
5. browser ↔ Vite direct (cors=true) sur port 5173. fetch("/api/...") → Vite proxifie vers Nodefony.
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
  backendHost: "127.0.0.1",
  backendPort: 5151,
  backendProtocol: "http",  // http | https
  https: false,             // partage certs Nodefony (server-https 5152)
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
- Port retry : EADDRINUSE → devPort+1, devPort+2 (max portRetryAttempts). Stocké dans `status.port`.
- Auto-restart : child.exit avec state=ready (= crash inattendu) → scheduleRestart() avec backoff exponentiel. `willingShutdown` flag distingue shutdown volontaire.
- Health check : setInterval (default 30s) GET `viteOrigin/`. 3 échecs consécutifs → kill child → trigger restart.
- Idempotence : 2e `start()` retourne `startPromise` en cours. `stop()` mémorise `stopPromise`.
- Listener tracking : `trackListener(target, event, fn)` + `cleanupChildListeners()` au exit. Évite MaxListenersExceededWarning entre restarts.
- HTTPS Vite : si `cfg.https=true`, supervisor récupère `certificates.privateKeyPath` + `certificates.certPath` via DI et les passe au generator (server.https inject fs.readFileSync).
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
- CSP (dev) : `FrontendService.#registerCsp()` déclare les origines Vite au firewall `@nodefony/security` via `registerCspOrigins("frontend", #viteCspFragment())` (résolu PAR NOM = anti-cycle) → le firewall émet **UN seul** CSP (origines mergées + **nonce par requête**, propagé par `renderDocument(entry, nonce)`). Plus de hack `setHeader`/`getCspDirectives` (supprimés). Fragment Vite (`#viteCspFragment`) : `'self'` dans CHAQUE directive (connect/style/img/font/worker n'héritent pas de `default-src`), `'unsafe-eval'` (React Fast Refresh, non couvert par le nonce), `worker-src 'self' blob:`, `blob:`/`data:` sur connect/img. Jamais émis en prod.
- Proxy Vite : en dev, `ViteConfigGenerator` ajoute **TOUJOURS** la regex `^/nodefony/[^/]+/api` au `server.proxy` (en plus des `apiProxyPaths` déclarés) → le data-plane admin/profiler (`/nodefony/<module>/api/*`) est toujours proxifié vers le backend, sinon la debug bar auto-injectée fetch `/nodefony/profiler/api` tombe sur le fallback SPA Vite (HTML) → clic « mort ».
- `process.kill(child.pid)` tue `npx` (parent), pas Vite. Pour tuer Vite réel dans tests : `lsof -ti:port -sTCP:LISTEN`.
- Test crash auto-restart : `pidListeningOn(port)` puis SIGKILL ; attendre `state==="ready"` + `pid !== nodefonyPidBefore` + `restartCount === 1`.

## Events (Service EventEmitter)

- `frontend:starting` (payload `{ backendOrigin, entries }`) — avant spawn
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

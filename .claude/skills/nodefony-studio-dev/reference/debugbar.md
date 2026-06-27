# Référence — Debug bar Nodefony (`nodefony/debugbar`)

> VANILLA TS + Shadow DOM — contexte DIFFÉRENT de Studio React (AUCUN React/Mantine/JSX/UI kit ici).
> C'est un subpath **Core isomorphe**, pas une page Studio.

Contexte **DIFFÉRENT** de Studio. La debug bar (WDT à la Symfony, dev-only) est un subpath **Core**
isomorphe, **vanilla TS + Shadow DOM** — **AUCUN React/Mantine/JSX, AUCUN UI kit Studio ici**.

- **Où** : `src/nodefony/src/client/debugbar/*.ts` (workspace Core `src/nodefony`, PAS studio/frontend).
  `DebugBar.ts` (widget), `network.ts` (intercepteur fetch/XHR), `profile.ts`/`model.ts` (waterfall),
  `format.ts`, `hmr.ts`, `index.ts` (barrel).
- **Particularité vanilla** : DOM créé à la main, monté dans un **Shadow DOM**
  (`host.attachShadow({ mode:"open" })`) → styles 100 % isolés de la page hôte (0 fuite CSS, pas de
  Mantine). **JAMAIS** de splice `</body>` rendu serveur (≠ legacy « sale »). Realtime = `RealtimeClient`
  Core **direct** (PAS les hooks `nodefony/react`), `Pdu` Core pour les logs.
- **API** : `import { mountDebugBar } from "nodefony/debugbar"; mountDebugBar(opts)`. Handle global
  `window.__NODEFONY_DEBUGBAR__.setVisible(bool)/toggle()` ; localStorage **`nf.debugbar.visible`**
  (PARTAGÉ avec `UiStore.debugBar` de Studio). Exports : `DebugBar`, `mountDebugBar`, `computeWaterfall`,
  types `NetEntry`/`DebugBarModel`.
- **3 montages** : (1) auto en dev via plugin Vite (`@nodefony/frontend`) ; (2) toggle Studio
  (`AdminLayout` → handle global) ; (3) standalone `nodefony/debugbar.js`
  (`dist/client/debugbar.standalone.js`, mono-fichier, `<script type=module>` sur page EJS/Twig).
- **Symbiose Studio** : clic Network → `dispatchEvent(new CustomEvent("nodefony:debugbar:select",
{ detail:{ requestId } }))` → `AdminLayout` écoute → `navigate("/nodefony/profiling?req="+id)`.
  Profil serveur via data-plane `/nodefony/profiler/api/*`. SPA : on profile **les appels AJAX**
  (chacun son `X-Request-Id`), pas la page.
- ⚠️ **Build = Core** : `cd src/nodefony && npm run build` (PAS Vite HMR). La règle perf/mémoire Core
  s'applique (lazy, `removeListener`, pas d'alloc « au cas où »).
- ⚠️ **Gotcha import** : `@analogjs/vite-plugin-angular` trébuche sur `import … from "nodefony/debugbar"`
  dans un `.ts` (« Angular decorators ») → dans un **store `.ts`** Studio = **types miroir locaux** ;
  les `.tsx` (plugin React) peuvent importer le subpath.
- **Dev-only / opt-in strict** : jamais en prod (perf + fuite d'info).

## Gotchas debug bar

- **Canal DÉDIÉ `debugbar:stats`** (≠ `dashboard:supervision`, réservé à la page Supervision) : la barre est
  présente en permanence en dev → un canal partagé maintiendrait le ticker supervision actif. Le dispatcher serveur
  route `debugbar:stats[:ms]` ET `dashboard:supervision[:ms]` vers le **même** `createStatsTicker` (canaux distincts).
- **Bouton live ○/●** (temps réel opt-in, **OFF par défaut**, `nf.debugbar.live`) : `startLive`/`stopLive`
  (subscribe/unsubscribe ref-compté). Les listeners `.on` sont TOUJOURS branchés (gratuit) ; seul l'**abonnement** est gaté.
- ⚠️ **Graphe « frames/s » figé en OFF** : il s'alimente de `__stats__` = compteur **GLOBAL** du client partagé (frames
  des autres consommateurs) → gater `sampleThroughput` sur `live` + recaler `prevFrames` au ré-ON (sinon pic).

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
  Mantine). **JAMAIS** de splice `</body>` rendu serveur (≠ legacy « sale »). Realtime = `NodefonySocket`
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

- **Canal DÉDIÉ `nodefony:debugbar`** (≠ `nodefony:supervision`, réservé à la page Supervision) : la barre est
  présente en permanence en dev → un canal partagé maintiendrait le ticker supervision actif. Le dispatcher serveur
  route `nodefony:debugbar[:ms]` ET `nodefony:supervision[:ms]` vers le **même** `createStatsTicker` (canaux distincts).
- **Bouton live ○/●** (temps réel opt-in, **OFF par défaut**, `nf.debugbar.live`) : `startLive`/`stopLive`
  (subscribe/unsubscribe ref-compté). Les listeners `.on` sont TOUJOURS branchés (gratuit) ; seul l'**abonnement** est gaté.
- **Onglets « Nodefony Socket » et « Nodefony SSE »** (≠ Realtime, resté tel quel) : UNE connexion par onglet,
  choisie par une rangée de boutons (`connTab`). Sockets = `pageSockets()` (← `sharedSockets()` d'`announce.ts`,
  celle de la barre étiquetée « barre de debug ») ; flux = `sseStreams()` (intercepteur réseau, `stream.kind === "sse"`).
  Lignes = `describeSocket` du CŒUR (jamais de mise en mots propre à la barre). Rien n'est lu onglet fermé
  (`tabOpen(id)`) — lire `frameLog` ALLUME le journal ; aller-retour à l'ouverture + bouton, jamais en boucle (chaque
  ping écrit 2 trames). Deux sockets sur une page front = NORMAL : celle de l'app + celle de la barre
  (`/nodefony/studio/api/realtime`, seule à offrir les canaux admin).
- **Onglets en CARTES** (Runtime, Perf, Nodefony client, Socket) : `.card` + `kvHtml(label, valeur, aide)` — libellé
  souligné = bulle d'aide (`data-tip` + `tabindex`). Grille libellé/valeur partagée, largeur du libellé en `--kw`.
  **Runtime** = résumé de la page Studio « Runtime & Lancement » : mêmes sources (`RUNTIME_READS`, lues par
  `readRuntime` via `ownFetch`, à l'ouverture + bouton ⟳, JAMAIS en boucle — `/kernel/api/processes` lance `ps`),
  même règle de mode (`runtimeMode` du CŒUR, isomorphe). Sans session admin : une phrase, zéro requête.
  **Perf** = une carte par mesure (paliers `PCT_*`/`LOOP_*` = couleur ET ligne « seuils ») + « Cette page »
  (`readPageTiming`, relu à `load`) ; « — » tant qu'aucune mesure, jamais un 0. **Nodefony client** = six cartes,
  utiles SANS noyau (compte reconnu par le serveur via la socket, briques de la page, raccourcis `nodefony.*`).
- **Budget** : `nodefony/debugbar` gzip dans `.size-budgets.json` (ADR-0007 D10, `npm run size:check`) — un onglet
  de plus = mesurer AVANT de commiter ; la barre embarque sa propre copie de la socket.
- Tests de la barre : double de socket UNIQUE `src/nodefony/src/tests/debugbarFakeSocket.ts` — ne pas recréer de copie partielle.
- ⚠️ **Graphe « frames/s » figé en OFF** : il s'alimente de `__stats__` = compteur **GLOBAL** du client partagé (frames
  des autres consommateurs) → gater `sampleThroughput` sur `live` + recaler `prevFrames` au ré-ON (sinon pic).

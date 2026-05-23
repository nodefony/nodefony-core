# CLAUDE.md — @nodefony/studio

## Docs liées

- [`MEMORY.md`](./MEMORY.md) — internals IA (routes, stores, gotchas)
- [`../frontend/CLAUDE.md`](../frontend/CLAUDE.md) — Vite builder / FrontendService que Studio consomme
- [`../http/CLAUDE.md`](../http/CLAUDE.md) — Context, SSE, headers
- [`../framework/CLAUDE.md`](../framework/CLAUDE.md) — `@controller` / `@route`
- [`../../../../CLAUDE.md`](../../../../CLAUDE.md) — règles globales projet
- Roadmap Phase 10 : skill `nodefony-roadmap`
- Kit de reprise IA : mémoire `project_studio_prep_kit`

## 🚨 RÈGLE ABSOLUE — dev Studio = skill `nodefony-studio-dev` OBLIGATOIRE

**Dès que tu développes le frontend Studio** (page, dashboard, panneau, onglet, composant),
tu DOIS d'abord invoquer le skill **`nodefony-studio-dev`** (déclencheurs : « dev studio »,
« page studio », « dashboard studio », « écran/panneau studio »). Il contient le kit VIVANT :
API exacte du UI kit + hooks `nodefony/react`, recette (route/lazy/navConfig/fallback/data plane),
squelettes, règles qualité (a11y/sécu/perf), gate `npm run typecheck`, et le **retex** (tous les
problèmes rencontrés + leur fix). Source de vérité unique → ne PAS réinventer ni explorer le kit.
**Fin de session Studio** : compléter la section Retex du skill (problèmes + fixes + nouvelles briques).

## Rôle du module

**Admin web de Nodefony** — successeur du legacy `monitoring-bundle`. Backend = controller Nodefony exposant l'UI + des API. Frontend = SPA **React 19** servie via `@nodefony/frontend` (Vite). C'est le **1er consommateur prod** de `@nodefony/frontend`.

**État : POC / partiel** (P10.5 + P10.7 = 🔶). Les API auth sont **mock** (vraie auth = P6). Le contrat `IAdminApi` (P10.2) n'est **pas encore créé** — aujourd'hui les endpoints sont en dur dans le controller.

---

## Structure

```
src/packages/@nodefony/studio/
├── index.ts                      ← Module Studio + registerEntry(frontend)
├── package.json                  ← deps React/Mantine/MobX ; peerDeps @nodefony/*
├── rollup.config.ts / tsconfig.json  ← NE PAS MODIFIER sans accord
├── nodefony/
│   ├── config/config.ts          ← surcharge module-frontend { https: true }
│   ├── controller/StudioController.ts  ← UI /nodefony + /nodefony/{page} ; API /nodefony/studio/api/*
│   ├── controller/StudioRealtimeController.ts  ← WS /nodefony/studio/api/realtime (JSON-RPC 2.0)
│   └── realtime/providers.ts           ← createSyslogBridge + createStatsTicker (transport-agnostiques, forward-compat P13.4)
└── frontend/                     ← SPA React 19 (Vite)
    ├── index.html · vite.config.generated.mjs (généré)
    └── src/
        ├── main.tsx · App.tsx · theme.ts (palette `brand` togglable, nodefony défaut) · layouts/navConfig.ts (nav data-driven)
        ├── stores/   ← MobX : Auth, Connection, Ui, Chat, Root
        ├── services/ ← ApiClient (JWT), AuthService, RealtimeClient (importé du Core isomorphe `nodefony` — PAS de package @nodefony/client séparé, P13.3 supprimé)
        ├── layouts/  ← AuthLayout, AdminLayout (sidebar v2 : rail + groupes repliables + filtre + groupe Data plane auto), navConfig
        ├── routes/   ← Login (stepper 4 étapes), Dashboard, Logs, Chat, stubs
        ├── components/ ← AuthGuard, ConnectionStepper/Drawer, StubPage
        └── utils/ansiToReact.tsx ← colore les logs ANSI → React
```

## Boot & intégration frontend

- **Ordre critique** : dans `index.ts` racine, `@nodefony/studio` doit être chargé **APRÈS** `@nodefony/frontend` (le service Vite doit exister au `onKernelBoot`).
- `index.ts` → `onKernelBoot()` → `frontendService.registerEntry(this, { type:"react19", entry:"./frontend/src/main.tsx", root:"./frontend", name:"studio", apiProxyPaths:["/nodefony/studio/api"] })`.
- `apiProxyPaths` est **obligatoire** : sans lui, `fetch("/nodefony/studio/api/...")` depuis la page servie par Vite tombe sur le SPA-fallback HTML de Vite → erreur JSON. Proxifie l'API uniquement (pas la racine `/nodefony` → les pages SPA restent servies par Vite).
- Multi-bundle OK : Studio coexiste avec `@nodefony/test-frontend-react` (bug multi-bundle résolu, cf mémoire `project_frontend_multibundle_bug`).

## Routes (StudioController) — partition du namespace `/nodefony` (TRANCHÉ 2026-05-20)

`@controller("/nodefony")`. Deux espaces séparés par profondeur :

- **UI SPA (humain)** — mono-segment, portée par CE module (disparaît si Studio absent) :

| Route                      | Méthode | Rôle                                                                                                                                                                                                     |
| -------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/nodefony`                | GET     | Page HTML (charge le bundle React via `frontendService.renderTags("studio")`)                                                                                                                            |
| `/nodefony/{page}`         | GET     | SPA fallback 1 segment → même page React                                                                                                                                                                 |
| `/nodefony/modules/{name}` | GET     | SPA fallback 2 segments **littéral** (deep-link/F5 sur `modules/:name`) → même page React. ⚠️ littéral `modules`, PAS `/{section}/{page}` (sinon masque `/nodefony/test/*` & co — régression 2026-05-20) |

- **Data plane admin (machine)** — `/nodefony/studio/api/*`, ≥3 segments. Mocks "cat.3" hébergés ici faute de mieux, migreront vers leur module propriétaire (`/nodefony/<module>/api/*`) :

| Route                                                                         | Méthode | Rôle                                                                                                                                                                                                                 | Cible migration       |
| ----------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `/nodefony/studio/api/health` · `/info`                                       | GET     | Ping / infos runtime (`/info` inclut `debug`)                                                                                                                                                                        | kernel                |
| `/nodefony/studio/api/auth/login` (POST) · `/auth/me` · `/auth/logout` (POST) | —       | **MOCK** (accepte tout, JWT bidon, `ROLE_NODEFONY_ADMIN`)                                                                                                                                                            | @nodefony/security P6 |
| `/nodefony/studio/api/realtime/info`                                          | GET     | Infos endpoint WS (available:**true**)                                                                                                                                                                               | P13.4/P13.7           |
| `/nodefony/studio/api/realtime`                                               | **WS**  | **WebSocket permanent JSON-RPC 2.0** (`StudioRealtimeController`) — pub/sub par canal (`subscribe`/`unsubscribe` : `syslog:stream`, `dashboard:stats`, …) **+ actions requête→réponse** (`kernel:ping`, `kernel:gc`) | RealtimeService P13.4 |

> **Pourquoi pas `/studio` pour l'UI** : `/nodefony` est réservé au framework, aucune app user n'y monte ses routes ; `/studio` entrerait en collision avec une route applicative. **Le framework boote sans Studio** — l'UI (cat.1) disparaît, le data plane par module (cat.2) reste porté par chaque module.
> **Règle figée** : interdit aux modules une route admin mono-segment `/nodefony/<module>` — toujours `/nodefony/<module>/api/*`.
> **Fallback SPA deep-link = préfixe LITTÉRAL** (`/modules/{name}`), jamais générique `/{section}/{page}` ni catch-all `*`. Un générique masquerait les vraies routes des autres modules sous `/nodefony/<x>/<y>` (ex `/nodefony/test/index` du module test) — **régression vécue le 2026-05-20** (21 échecs http). Le mono-segment `/{page}` est sûr car le framework réserve `/nodefony` (aucune app n'y monte une route mono-segment). Toute nouvelle page SPA à ≥2 segments → ajouter SON fallback littéral. Test de non-régression : `admin-dataplane.test` (`/nodefony/test/index` → JSON).
> **`apiProxyPaths: ["/nodefony/studio/api"]`** — proxifie UNIQUEMENT l'API ; les pages SPA `/nodefony/{page}` restent servies par Vite.
> **SSE retiré (2026-05-23)** : l'ancien endpoint `/studio/api/logs/stream` (Pdu syslog) était mort (front passé au canal WS `syslog:stream`) et cassé en HTTP/2 (`flushHeaders` absent sur `Http2ServerResponse` → `code=000`). Supprimé back + `subscribeSSE` front. La leçon SSE/HTTP2 (écouter `rawRes.once("close")` sur la RESPONSE, pas `request` qui fire trop tôt en HTTP/2) reste valable pour tout futur SSE → mémoire `feedback_sse_http2_request_close`.

## Realtime WS (✅ implémenté 2026-05-20 — forward-compat P13.4)

WebSocket **permanent** `WS /nodefony/studio/api/realtime` (`StudioRealtimeController`), protocole **JSON-RPC 2.0** — exactement ce que parle `RealtimeClient` (core) et que parlera `RealtimeService` (P13.4).

- **Pub/sub PAR CANAL (on-demand)** : le handshake ne pousse RIEN (juste `realtime:welcome`). Le client envoie des notifications `subscribe`/`unsubscribe` `{channel}` ; le serveur démarre/arrête le provider correspondant. → un client ne reçoit que ce qu'il demande ; quitter une page = `unsubscribe` du canal, **le WS reste ouvert**. (`ping` = heartbeat no-op.)
- **Actions (requête→réponse, 2026-05-23)** : une frame AVEC `id` est une **requête RPC** qui attend une réponse `result`/`error` (≠ pub/sub). Routées par `dispatchRequest()` → méthode connue renvoie `{jsonrpc,id,result}`, inconnue `-32601`, handler qui throw `-32603` (message **générique** au client, détail loggé serveur = Zero Trust). Méthodes MVP : **`kernel:ping`** (liveness + RTT, lecture pure) et **`kernel:gc`** (force GC si `--expose-gc`, sinon `{available:false}` ; action de contrôle à effet réel). Le chemin chaud subscribe reste sync/0-alloc — le coût n'est payé que sur une requête `id`. Côté client = `RealtimeClient.request(method,params)` (Promise id-matchée) + helper réutilisable **`client.ping()`** (mesure le RTT). Forward-compat P13.4 : routeur + actions migrent tels quels dans `RealtimeService`. ⚠️ **réutilisable = dans la lib cliente** (`nodefony`), jamais dupliqué par front.
- **Providers transport-agnostiques** : `nodefony/realtime/providers.ts` → `createSyslogBridge(syslog, publish)` + `createStatsTicker(publish, 1000)`. Poussent via `publish(channel, payload)` sans connaître le transport.
- **Canaux figés** : `syslog:stream` (Pdu kernel), `dashboard:stats` (1/s : `uptime, pid, cpuPercent, cpuCount, eventLoopMs, loadavg, memory{rss,heapUsed,heapTotal,external}`). `/api/info` (statique) ajoute `debug` (mode `-d`).
- **Front** : `RootStore` → `RealtimeClient({ url: wss://host/nodefony/studio/api/realtime })`. `AdminLayout` ouvre le WS au montage (couvre le reload, pas seulement Login). `ConnectionStore.subscribe/unsubscribe` émettent au serveur ; **re-`subscribe` de tous les canaux actifs sur `__state__ "connected"`** (reconnect + course au 1er connect). `Logs` = `subscribe("syslog:stream")` ; `Dashboard` = `subscribe("dashboard:stats")` + `subscribe("syslog:stream")` (débit logs/s) + graphes AreaChart CPU/mémoire.
- **Migration P13.4 = locale** : supprimer `StudioRealtimeController`, brancher les mêmes providers + le routage subscribe/unsubscribe sur `RealtimeService.publish`. **Front inchangé**, canaux + enveloppe identiques.

> ⚠️ **GOTCHA push WS** : après le handshake, `WebsocketContext.requestEnded = true` → `context.send()` **rejette** (response du pipeline fermée). Pour un push serveur→client hors action (timer, listener syslog), envoyer sur la **connexion ws brute** : `ctx.connection.send(str, cb)` avec garde `readyState === 1` (équivalent du raw response utilisé en SSE).
> ⚠️ **Perf** : 1 provider = 1 listener/interval, démarré au `subscribe`, `dispose()` garanti au `unsubscribe` ET sur `ctx.once("onFinish")` (close WS, AsyncResource-bound). État pub/sub stocké sur le ctx (persiste entre messages). `setInterval` unref. Validé runtime : push 0 avant subscribe, stop net après unsubscribe, 0 fuite (connect→cleanup symétriques).
> ⚠️ **Multi-process** : `dashboard:stats` lit `process.cpuUsage()/memoryUsage()` → **per-instance** (le process qui tient le WS), PAS cluster-aware. CPU% = % d'UN cœur (pas /cores, depuis 2026-05-20). En multi-process (reusePort, cf [`../http/MEMORY.md`](../http/MEMORY.md)), le WS tombe sur 1 worker → 1 instance affichée. Vue cluster future = `instanceId` dans le payload + Redis pub/sub fan-out (P13). Per-instance est le bon modèle cloud-native (chaque pod se rapporte ; agrégation = Prometheus/Grafana). Détails : mémoire IA `project_multiprocess_scaling`.

## ⚠️ Questions design ouvertes (à trancher — cf `project_studio_prep_kit`)

1. ✅ **Routing `/nodefony` vs `/studio` — TRANCHÉ 2026-05-20** : UI Studio sur `/nodefony` + `/nodefony/{page}` (mono-segment), data plane admin sur `/nodefony/<module>/api/*`. `/studio` rejeté (collision app user). Voir section Routes ci-dessus. Validé runtime (curl + proxy Vite).
2. **`IAdminApi` + `ApiBroker` (P10.2)** : à concevoir — chaque module exposera son admin via ce contrat au lieu des endpoints mock en dur. L'interface peut se figer dès maintenant (indépendant de P5).
3. **CSP** : `StudioController.renderStudio()` override le header CSP via `frontendService.getCspDirectives()` (hack POC cross-origin Vite). TODO P14.14 → migrer dans `@nodefony/security` (cf mémoire `project_csp_vite_security_todo`).

## Décisions figées

- Stack frontend : **React 19** (P10.1 acté) + **Mantine v8** + **MobX 6** (classes, `makeAutoObservable` — pas Zustand/Redux) + React Router 7 + TanStack Table 8 (headless).
- Theme : dark par défaut + toggle scheme persisté `localStorage`. **Palette de marque togglable** (couleur `brand` = alias dynamique `nodefonyBlue #0067ba` ↔ `nodefonyOrange`, `primaryColor:"brand"`, toggle 🎨 persisté `ui.palette`, **défaut nodefony**, dark-safe `primaryShade.dark=4`). Accents en dur écrits `color="brand"` ; warnings/DEBUG/palettes décoratives restent `color="orange"` (sémantique). Couleurs marque extraites du logo officiel (`theme.ts` `buildStudioTheme`).
- Routing (✅ tranché 2026-05-20) : UI `/nodefony` + `/nodefony/{page}` ; data plane `/nodefony/<module>/api/*` (Studio = `/nodefony/studio/api/*`). `/studio` rejeté (collision app user).
- Deps frontend dans le `package.json` du module (pas de `frontend/package.json` séparé).

## Dépendances roadmap (ce qui débloque quoi)

- Faisable **hors P5/P6** : test browser, trancher routing, concevoir `IAdminApi`, vues en lecture mock.
- Gated : `IAdminApi` user/orm/security (P10.4 → P5.6 + P6.8), auth réelle (P10.6 → P6.5), bootstrap frontend final (P10.7 → P14.11 + P14.4), realtime (P13).

## TODO connus

- **Types/exports** : `package.json` a `main` mais **pas** `types` ni `exports` → ajouter `dist/types/index.d.ts` + `exports` (cf table standard types, CLAUDE.md racine).
- Remplacer les mocks `/api/auth/*` par le firewall P6.
- Implémenter les 13 pages stub au fil des phases (Sessions P10.8, Users P10.8, Firewall/Logs P10.9, etc.).

### Backlog UX page Logs (`frontend/src/routes/Logs.tsx`) — idées 2026-05-20

> État actuel : Pdu réel via canal WS `syslog:stream` (plus de SSE), Pause/Live, Clear, filtres (sévérité MultiSelect + module + msgid), autoscroll switch, ansiToReact, MAX_ENTRIES=500, `ScrollArea h=500` fixe.

Quick wins (faible effort, fort impact) :

1. **Autoscroll intelligent** : scroll vers le haut → pause auto le suivi ; bouton flottant « ↓ N nouveaux » pour revenir en bas (réflexe tail moderne, remplace le switch manuel).
2. **Lignes ERROR/CRITIC surlignées** : fond rouge subtil sur toute la ligne (pas juste le badge).
3. **Compteurs par sévérité cliquables** : chips `ERROR 3` / `WARN 12` en topbar, clic = toggle filtre (santé en un coup d'œil).
4. **Recherche plein-texte** sur le message/payload (aujourd'hui on filtre module/msgid mais pas le contenu) + surlignage des matchs.
5. **Copier une ligne / copier le set filtré** (clipboard, pour coller un crash dans un rapport).

Plus gros (mais payant) : 6. **Clic ligne → détail** : drawer/collapse avec le Pdu complet (payload objet, stack trace, pid, tous champs). Aujourd'hui payload objet = `JSON.stringify` inline illisible. 7. **État WS réel dans la page** : afficher connected/reconnecting/error inline (le `Live/Pause` actuel n'est que la pause locale). Largement couvert par `ConnectionOverlay` global ; `ConnectionStore.lastError`/`state` dispo si on veut un badge local. 8. **Layout colonnes alignées + hauteur pleine** : `Group` minWidth → vraie grille ; `ScrollArea` remplit le viewport au lieu de `h={500}` fixe. 9. **Virtualisation** si buffer augmenté : TanStack Virtual (déjà dans les deps) pour ne pas rendre 500+ lignes riches.

Combo recommandé 1ʳᵉ passe : **1 + 2 + 3 + 6**.

## Lancer / tester

```bash
bash .claude/skills/start-nodefony-server/start.sh   # depuis la RACINE du repo
# → https://127.0.0.1:5152/nodefony  (accepter le cert sur 5152 ET le port Vite)
# login mock : admin/admin
```

### Tests unit (vitest — scaffold 2026-05-21)

```bash
cd src/packages/@nodefony/studio
npm test            # vitest run (tests unit, sans serveur)
npm run coverage    # + rapport .coverage/ (affiché par l'onglet Coverage Studio)
```

- Harness = **miroir de `@nodefony/frontend`** : `vitest.config.ts` + `nodefony/tests/{vitest.setup.ts, vitest-mocha-shim.mjs}`. `expect` de **chai** (pas vitest), `vi` de vitest (fake timers + `vi.fn()`).
- `nodefony/tests/unit/providers.test.ts` (11 tests, providers.ts 98.55% stmts / 100% lines) : verrouille le **coalescing `createSyslogBridge`** (le fix du lag Studio, f82b3de) + `createStatsTicker`. Déterministe via `vi.useFakeTimers()`.
- **Split** (volontaire) : le WS endpoint (`StudioRealtimeController`) est de l'**intégration live-server** (subscribe/unsubscribe → frame JSON-RPC) → relève de la suite WS de `@nodefony/http`, pas du run vitest. Le frontend React (stores MobX, `ConnectionDrawer`) = instrumentation séparée non scaffoldée.
- ⚠️ providers.ts n'importe que `node:os/v8/perf_hooks` → tests sur la **source pure**, pas le dist (pas d'alias sequelize/mongoose nécessaire, ≠ http/framework).

## Ce qu'il ne faut JAMAIS faire sans accord

- Modifier `rollup.config.ts` / `tsconfig.json`
- Changer l'ordre de chargement (studio doit rester après @nodefony/frontend)
- Ajouter de la logique métier dans le core via Studio (Studio est générique : il introspecte les modules via `IAdminApi`, il ne contient pas de logique applicative)

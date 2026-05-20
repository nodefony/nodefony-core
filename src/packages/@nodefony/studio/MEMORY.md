# MEMORY.md — @nodefony/studio

> IA, ultra-concis. Détails session : [`CLAUDE.md`](./CLAUDE.md). Kit reprise : mémoire `project_studio_prep_kit`.

## Purpose

Admin web Nodefony (successeur `monitoring-bundle`). Backend controller + SPA React 19 via `@nodefony/frontend`. État : POC/partiel (P10.5+P10.7 🔶). APIs auth = mock (→ P6). `IAdminApi` (P10.2) pas encore créé.

## Core Components

- `index.ts` : `class Studio extends Module`. `onKernelBoot` → `frontendService.registerEntry({type:"react19", entry:"./frontend/src/main.tsx", root:"./frontend", name:"studio", apiProxyPaths:["/nodefony/studio/api"]})`.
- `StudioController` `@controller("/nodefony")` : UI = `/nodefony` (HTML+renderTags) + `/nodefony/{page}` (SPA fallback mono-segment) ; API = `/nodefony/studio/api/{health,info}`, `/nodefony/studio/api/auth/{login,me,logout}` (MOCK), `/nodefony/studio/api/realtime/info` (available:true), `/nodefony/studio/api/logs/stream` (SSE Pdu — **dormant**, front passé en WS).
- `StudioRealtimeController` `@controller("/nodefony/studio/api")` : **WS `/realtime`** (JSON-RPC 2.0). **Pub/sub par canal on-demand** : handshake = `realtime:welcome` seul ; client envoie `subscribe`/`unsubscribe {channel}` → serveur démarre/arrête le provider (`nodefony/realtime/providers.ts` : `createSyslogBridge`/`createStatsTicker`, transport-agnostiques). Canaux `syslog:stream`, `dashboard:stats` (1/s : cpu%/eventLoopMs/loadavg/memory). État pub/sub sur le ctx. Cleanup par canal + global `ctx.once("onFinish")`.
- Frontend : Mantine v8 + MobX 6 + Router 7 + TanStack Table 8 + Mantine charts/spotlight + Tabler icons. 5 stores MobX (Auth/Connection/Ui/Chat/Root). Services : ApiClient(JWT)/AuthService/RealtimeClient. Pages : Login(stepper 4), Dashboard, Logs(ansiToReact), Chat, 13 stubs.

## Config

- `nodefony/config/config.ts` : `{ "module-frontend": { https: true } }` (Vite HTTPS certs Nodefony, anti mixed-content sur 5152).
- `package.json` : `main` OK ; ⚠️ **pas de `types` ni `exports`** (TODO). peerDeps : nodefony, @nodefony/{http,framework,frontend}, vite, @vitejs/plugin-react. deps frontend dans CE package.json (pas de frontend/package.json).

## Behaviors

- Boot : studio chargé APRÈS @nodefony/frontend (sinon service Vite absent au boot). Coexiste avec test-frontend-react (multibundle résolu).
- `renderStudio()` override header CSP via `frontendService.getCspDirectives()` (hack POC cross-origin).
- SSE logs : listener `rawRes.once("close")` sur RESPONSE (pas request — HTTP/2 fire trop tôt). [dormant — front en WS]
- WS realtime : push serveur→client sur `ctx.connection.send()` (raw ws, garde `readyState===1`), PAS `ctx.send()` (rejette après handshake car `requestEnded=true`). Cleanup par canal au `unsubscribe` + global `ctx.once("onFinish")`. Validé : 0 push avant subscribe, stop net après unsubscribe, 0 fuite.
- Front WS : `RootStore` → `RealtimeClient({url: wss://host/nodefony/studio/api/realtime})`. **`AdminLayout` ouvre le WS au montage** (pas seulement Login — sinon reload avec token saute Login → WS jamais ouvert, widgets loading + "disconnected"). `ConnectionStore.subscribe/unsubscribe` émettent au serveur ; re-subscribe des canaux actifs sur `__state__ connected` (reconnect + course 1er connect). `connect()` ne fait plus `disconnect()` au timeout (garde l'autoReconnect).
- Theme dark défaut + toggle localStorage, primary orange.

## Gotchas

- ✅ **Routing TRANCHÉ 2026-05-20** : UI = `/nodefony` + `/nodefony/{page}` (mono-segment, porté par Studio, dispo si module chargé) ; data plane = `/nodefony/<module>/api/*` (≥3 seg, porté par chaque module, indép. de Studio). `/studio` REJETÉ (collision app user — `/nodefony` est réservé framework). Règle : jamais de route admin mono-segment `/nodefony/<module>` (collision page SPA). Validé runtime curl + proxy Vite.
- `apiProxyPaths: ["/nodefony/studio/api"]` obligatoire sinon `fetch("/nodefony/studio/api/...")` tombe sur le SPA-fallback Vite → erreur JSON. Proxifie l'API only (pas la racine `/nodefony`).
- Auth = mock (accepte tout → `ROLE_NODEFONY_ADMIN`). NE PAS croire que la sécurité est branchée.
- `IAdminApi`/`ApiBroker` absents → endpoints en dur. Cible : modules s'auto-exposent via `IAdminApi`.
- CSP hack POC → migrer @nodefony/security (P14.14).
- Realtime forward-compat P13.4 : providers transport-agnostiques (`publish(channel,payload)`), canaux figés. Migration = supprimer le controller + brancher `realtimeService.publish`, front inchangé. Cf [[project_studio_realtime_ws]].
- Dashboard stats = **per-instance** (process qui tient le WS), PAS cluster-aware. CPU% = % d'UN cœur (pas /cores). En multi-process (reusePort) le WS tombe sur 1 worker → 1 instance affichée. Vue cluster = ajouter `instanceId` au payload + Redis pub/sub fan-out (P13). Cloud-native OK (chaque pod se rapporte). Cf [[project_multiprocess_scaling]].
- Build : warning `rollup-sourcemap-path-transform` types — bénin.
- 📋 **Backlog UX page Logs** (idées 2026-05-20) dans `CLAUDE.md` → section "TODO connus". Combo reco : autoscroll intelligent + lignes ERROR surlignées + compteurs sévérité cliquables + détail Pdu au clic.

## Routes API admin (convention `/nodefony/<module>/api/*`)

Studio est le consommateur. Chaque module exposera son `IAdminApi` (P10.2-P10.4). Aujourd'hui : seulement les mocks du StudioController.

## Liens

`project_studio_prep_kit` (reprise) · `project_studio_module` · `project_ia_studio_final` · `project_realtime_vision_studio_beta` · `project_frontend_architecture_decision` · `project_csp_vite_security_todo` · `feedback_sse_http2_request_close`

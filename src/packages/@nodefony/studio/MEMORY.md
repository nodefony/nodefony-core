# MEMORY.md — @nodefony/studio

> IA, ultra-concis. Détails session : [`CLAUDE.md`](./CLAUDE.md). Kit reprise : mémoire `project_studio_prep_kit`.

## Purpose

Admin web Nodefony (successeur `monitoring-bundle`). Backend controller + SPA React 19 via `@nodefony/frontend`. État : POC/partiel (P10.5+P10.7 🔶). APIs auth = mock (→ P6). `IAdminApi` (P10.2) pas encore créé.

## Core Components

- `index.ts` : `class Studio extends Module`. `onKernelBoot` → `frontendService.registerEntry({type:"react19", entry:"./frontend/src/main.tsx", root:"./frontend", name:"studio", apiProxyPaths:["/nodefony/api"]})`.
- `StudioController` `@controller("/nodefony")` : `/` (HTML+renderTags), `/{page}` (SPA fallback), `/api/{health,info}`, `/api/auth/{login,me,logout}` (MOCK), `/api/realtime/info` (stub), `/api/logs/stream` (SSE Pdu réel).
- Frontend : Mantine v8 + MobX 6 + Router 7 + TanStack Table 8 + Mantine charts/spotlight + Tabler icons. 5 stores MobX (Auth/Connection/Ui/Chat/Root). Services : ApiClient(JWT)/AuthService/RealtimeClient. Pages : Login(stepper 4), Dashboard, Logs(ansiToReact), Chat, 13 stubs.

## Config

- `nodefony/config/config.ts` : `{ "module-frontend": { https: true } }` (Vite HTTPS certs Nodefony, anti mixed-content sur 5152).
- `package.json` : `main` OK ; ⚠️ **pas de `types` ni `exports`** (TODO). peerDeps : nodefony, @nodefony/{http,framework,frontend}, vite, @vitejs/plugin-react. deps frontend dans CE package.json (pas de frontend/package.json).

## Behaviors

- Boot : studio chargé APRÈS @nodefony/frontend (sinon service Vite absent au boot). Coexiste avec test-frontend-react (multibundle résolu).
- `renderStudio()` override header CSP via `frontendService.getCspDirectives()` (hack POC cross-origin).
- SSE logs : listener `rawRes.once("close")` sur RESPONSE (pas request — HTTP/2 fire trop tôt).
- Theme dark défaut + toggle localStorage, primary orange.

## Gotchas

- ⚠️ **Routing incohérent** : commentaire `index.ts` dit `/studio` mais controller = `/nodefony` partout. Convention : `/nodefony/<module>/api/*` réservé aux API admin. À trancher.
- `apiProxyPaths` obligatoire sinon `fetch("/nodefony/api/...")` tombe sur le SPA-fallback Vite → erreur JSON.
- Auth = mock (accepte tout → `ROLE_NODEFONY_ADMIN`). NE PAS croire que la sécurité est branchée.
- `IAdminApi`/`ApiBroker` absents → endpoints en dur. Cible : modules s'auto-exposent via `IAdminApi`.
- CSP hack POC → migrer @nodefony/security (P14.14).
- Build : warning `rollup-sourcemap-path-transform` types — bénin.

## Routes API admin (convention `/nodefony/<module>/api/*`)

Studio est le consommateur. Chaque module exposera son `IAdminApi` (P10.2-P10.4). Aujourd'hui : seulement les mocks du StudioController.

## Liens

`project_studio_prep_kit` (reprise) · `project_studio_module` · `project_ia_studio_final` · `project_realtime_vision_studio_beta` · `project_frontend_architecture_decision` · `project_csp_vite_security_todo` · `feedback_sse_http2_request_close`

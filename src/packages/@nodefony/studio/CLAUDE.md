# CLAUDE.md — @nodefony/studio

## Docs liées

- [`MEMORY.md`](./MEMORY.md) — internals IA (routes, stores, gotchas)
- [`../frontend/CLAUDE.md`](../frontend/CLAUDE.md) — Vite builder / FrontendService que Studio consomme
- [`../http/CLAUDE.md`](../http/CLAUDE.md) — Context, SSE, headers
- [`../framework/CLAUDE.md`](../framework/CLAUDE.md) — `@controller` / `@route`
- [`../../../../CLAUDE.md`](../../../../CLAUDE.md) — règles globales projet
- Roadmap Phase 10 : skill `nodefony-roadmap`
- Kit de reprise IA : mémoire `project_studio_prep_kit`

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
│   └── controller/StudioController.ts  ← routes /nodefony (UI + /api/* + SSE logs)
└── frontend/                     ← SPA React 19 (Vite)
    ├── index.html · vite.config.generated.mjs (généré)
    └── src/
        ├── main.tsx · App.tsx · theme.ts (orange Nodefony, dark défaut)
        ├── stores/   ← MobX : Auth, Connection, Ui, Chat, Root
        ├── services/ ← ApiClient (JWT), AuthService, RealtimeClient (préfigure @nodefony/client)
        ├── layouts/  ← AuthLayout, AdminLayout (sidebar + theme toggle)
        ├── routes/   ← Login (stepper 4 étapes), Dashboard, Logs, Chat, stubs
        ├── components/ ← AuthGuard, ConnectionStepper/Drawer, StubPage
        └── utils/ansiToReact.tsx ← colore les logs ANSI → React
```

## Boot & intégration frontend

- **Ordre critique** : dans `index.ts` racine, `@nodefony/studio` doit être chargé **APRÈS** `@nodefony/frontend` (le service Vite doit exister au `onKernelBoot`).
- `index.ts` → `onKernelBoot()` → `frontendService.registerEntry(this, { type:"react19", entry:"./frontend/src/main.tsx", root:"./frontend", name:"studio", apiProxyPaths:["/nodefony/api"] })`.
- `apiProxyPaths` est **obligatoire** : sans lui, `fetch("/nodefony/api/...")` depuis la page servie par Vite tombe sur le SPA-fallback HTML de Vite → erreur JSON.
- Multi-bundle OK : Studio coexiste avec `@nodefony/test-frontend-react` (bug multi-bundle résolu, cf mémoire `project_frontend_multibundle_bug`).

## Routes (StudioController)

`@controller("/nodefony")` :

| Route | Méthode | Rôle |
|---|---|---|
| `/` | GET | Page HTML (charge le bundle React via `frontendService.renderTags("studio")`) |
| `/{page}` | GET | SPA fallback → même page React |
| `/api/health` · `/api/info` | GET | Ping / infos runtime (real) |
| `/api/auth/login` (POST) · `/api/auth/me` · `/api/auth/logout` (POST) | — | **MOCK** (accepte tout, JWT bidon, `ROLE_NODEFONY_ADMIN`). → P6 |
| `/api/realtime/info` | GET | Stub endpoint WS (available:false). → P13.4/P13.7 |
| `/api/logs/stream` | GET | **SSE réel** — streame les `Pdu` du Syslog kernel |

> **SSE** : écouter `rawRes.once("close")` (RESPONSE), jamais `request.on("close")` (fire trop tôt en HTTP/2). Cf mémoire `feedback_sse_http2_request_close`.

## ⚠️ Questions design ouvertes (à trancher — cf `project_studio_prep_kit`)

1. **Routing `/nodefony` vs `/studio`** : le commentaire d'`index.ts` annonce `/studio` (UI) avec `/nodefony` réservé aux API admin par module (`/nodefony/<module>/api/*`), mais le controller fait TOUT sur `/nodefony`. Incohérence doc↔code à résoudre.
2. **`IAdminApi` + `ApiBroker` (P10.2)** : à concevoir — chaque module exposera son admin via ce contrat au lieu des endpoints mock en dur. L'interface peut se figer dès maintenant (indépendant de P5).
3. **CSP** : `StudioController.renderStudio()` override le header CSP via `frontendService.getCspDirectives()` (hack POC cross-origin Vite). TODO P14.14 → migrer dans `@nodefony/security` (cf mémoire `project_csp_vite_security_todo`).

## Décisions figées

- Stack frontend : **React 19** (P10.1 acté) + **Mantine v8** + **MobX 6** (classes, `makeAutoObservable` — pas Zustand/Redux) + React Router 7 + TanStack Table 8 (headless).
- Theme : dark par défaut + toggle persisté `localStorage` ; primary = orange Nodefony.
- Préfixe route UI : `/nodefony` (actuel) — voir question ouverte #1.
- Deps frontend dans le `package.json` du module (pas de `frontend/package.json` séparé).

## Dépendances roadmap (ce qui débloque quoi)

- Faisable **hors P5/P6** : test browser, trancher routing, concevoir `IAdminApi`, vues en lecture mock.
- Gated : `IAdminApi` user/orm/security (P10.4 → P5.6 + P6.8), auth réelle (P10.6 → P6.5), bootstrap frontend final (P10.7 → P14.11 + P14.4), realtime (P13).

## TODO connus

- **Types/exports** : `package.json` a `main` mais **pas** `types` ni `exports` → ajouter `dist/types/index.d.ts` + `exports` (cf table standard types, CLAUDE.md racine).
- Remplacer les mocks `/api/auth/*` par le firewall P6.
- Implémenter les 13 pages stub au fil des phases (Sessions P10.8, Users P10.8, Firewall/Logs P10.9, etc.).

## Lancer / tester

```bash
bash .claude/skills/start-nodefony-server/start.sh   # depuis la RACINE du repo
# → https://127.0.0.1:5152/nodefony  (accepter le cert sur 5152 ET le port Vite)
# login mock : admin/admin
```

## Ce qu'il ne faut JAMAIS faire sans accord

- Modifier `rollup.config.ts` / `tsconfig.json`
- Changer l'ordre de chargement (studio doit rester après @nodefony/frontend)
- Ajouter de la logique métier dans le core via Studio (Studio est générique : il introspecte les modules via `IAdminApi`, il ne contient pas de logique applicative)

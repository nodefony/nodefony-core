# Recette ADMIN data plane (Studio) — + lien FULL-STACK

> Chargé à la demande par `SKILL.md`. Le back EXPOSE le contrat ; `nodefony-studio-dev` le CONSOMME.

## Sommaire

- Endpoint admin data plane (broker `IAdminApi`, RBAC `ROLE_NODEFONY_ADMIN`, audit, duplex)
- Lien full-stack : côté front → `nodefony-studio-dev` (page + `useResource`/`ApiClient` + pont socket)

---

### Endpoint admin data plane (Studio)

```typescript
// Producteur (module http/kernel/orm…) — importe SEULEMENT depuis "nodefony" (jamais framework : cycle)
import type { IAdminApi, IAdminRegistry } from "nodefony";

export function createXxxAdminApi(mod: MyModule): IAdminApi {
  return {
    adminNamespace: "xxx",
    adminDescriptor: () => ({ name: "xxx", order: 50 }),
    adminEndpoints: () => [
      {
        path: "/things",
        method: "GET",
        role: "ROLE_NODEFONY_ADMIN",
        handler: () => ({ things: [] }),
      }, // succès = donnée BRUTE (pas {body}, sinon double-wrap)
    ],
  };
}
// enregistrement dans onKernelBoot : (this.kernel.container.get("adminBroker") as IAdminRegistry).register(api)
```

- Routes admin = **≥3 segments** `/nodefony/<ns>/api/*` (jamais mono-segment → collision SPA Studio).
- L'enveloppe `{status,headers,body}` n'est lue que si `status` OU `headers` présent (sinon donnée brute).
- RBAC : `request.roles` vide tant que P6 absent → 403 inactif (mock), s'activera sans changer le code.
- Le front consomme `store.api.getAbsolute<T>("/nodefony/xxx/api/things")`. Per-instance (header `x-nodefony-instance`).

---

## Côté FRONT (full-stack) — consommation Studio

Le pendant front de cet endpoint vit dans **`nodefony-studio-dev`** :

- page sous `routes/`, fetch via `useResource(() => store.api.getAbsolute(...))` (HTTP) ou pont `api.request` (socket) ;
- contrat partagé = types `I*Api`/`I*Controller` exportés (jamais une copie figée). Voir `nodefony-studio-dev` → `reference/realtime.md` + recette « page données ».

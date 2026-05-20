import type { IAdminApi, IAdminEndpoint, IAdminDescriptor } from "nodefony";
import Router from "../service/router";
import type Route from "./Route";

/**
 * Producteur `IAdminApi` du module **framework** — exposé sous
 * `/nodefony/framework/api/*`.
 *
 * 3ᵉ producteur du data plane admin (kernel, http, puis framework). Introspecte
 * le **Router** : c'est l'équivalent web de `nodefony router:dump` et la source
 * de la future vue « Routes » de Studio (P10.8).
 *
 * Le framework héberge le broker → il s'enregistre directement (pas besoin de
 * passer par `IAdminRegistry` du container comme un module externe).
 *
 * Endpoints :
 *  - `GET /nodefony/framework/api/routes` → toutes les routes enregistrées
 *  - `GET /nodefony/framework/api/info`   → résumé (nb routes, méthodes, modules)
 *
 * @returns le contrat admin de framework, prêt à `broker.register()`.
 */
export function createFrameworkAdminApi(): IAdminApi {
  /** Normalise `requirements.methods` (string | string[]) → tableau majuscule. */
  const methodsOf = (route: Route): string[] => {
    const m = route.requirements?.methods ?? route.method;
    if (Array.isArray(m)) return m.map((x) => String(x).toUpperCase());
    if (typeof m === "string") {
      return m
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    }
    return ["ANY"];
  };

  const serializeRoute = (route: Route) => ({
    name: route.name,
    path: route.path ?? null,
    methods: methodsOf(route),
    controller: route.controller?.name ?? null,
    action: route.classMethod ?? null,
    module: route.module?.name ?? null,
    host: route.host ?? null,
    bypassFirewall: route.bypassFirewall,
  });

  const descriptor: IAdminDescriptor = {
    label: "Routes",
    icon: "route",
    order: 2,
  };

  const endpoints: IAdminEndpoint[] = [
    {
      path: "routes",
      summary: "All registered routes (Router dump) — name, path, methods, controller",
      handler: () => Router.routes.map(serializeRoute),
    },
    {
      path: "info",
      summary: "Routing summary — total routes, methods, owning modules",
      handler: () => {
        const routes = Router.routes;
        const methods = new Set<string>();
        const modules = new Set<string>();
        for (const r of routes) {
          methodsOf(r).forEach((m) => methods.add(m));
          if (r.module?.name) modules.add(r.module.name);
        }
        return {
          routesTotal: routes.length,
          methods: [...methods].sort(),
          modules: [...modules].sort(),
        };
      },
    },
  ];

  return {
    adminNamespace: "framework",
    adminDescriptor: () => descriptor,
    adminEndpoints: () => endpoints,
  };
}

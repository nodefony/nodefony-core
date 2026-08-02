import { parsePageQuery } from "nodefony";
import type {
  IAdminApi,
  IAdminEndpoint,
  IAdminDescriptor,
  IPage,
} from "nodefony";
import Router from "../service/router";
import type Route from "./Route";
import type { IAdminBroker } from "../interfaces/IAdminBroker";
import { createPlaygroundEndpoints } from "./PlaygroundAdminApi";

/** Options de composition du producteur framework. */
export interface FrameworkAdminApiOptions {
  /**
   * Monte les endpoints Playground (`playground/routes`) — **dev uniquement** :
   * la console Studio exécute des mutations depuis le navigateur. Hors dev les
   * endpoints n'existent pas (404) → la page Studio affiche « dev uniquement ».
   */
  playground?: boolean;
}

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
 *  - `GET /nodefony/framework/api/admin`  → **catalogue** du data plane admin
 *    (tous les producteurs + descriptors + endpoints) — pièce « discovery »
 *    de P10.2 que Studio lit pour générer sa navigation admin.
 *
 * @param broker - le broker admin (pour le catalogue). Optionnel : sans lui,
 *   `admin` renvoie une liste vide.
 * @param opts - composition (`playground: true` → endpoints Playground, dev-only).
 * @returns le contrat admin de framework, prêt à `broker.register()`.
 */
export function createFrameworkAdminApi(
  broker?: IAdminBroker,
  opts?: FrameworkAdminApiOptions,
): IAdminApi {
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

  // ── Pagination/tri/filtre SERVEUR (endpoint routes/page, démo <DataGrid mode="server">) ──
  type RouteDump = ReturnType<typeof serializeRoute>;
  /** Premier param d'une query (string|string[]). */
  const one = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  /**
   * Colonnes sur lesquelles `routes/page` sait trier — l'allowlist que
   * `parsePageQuery` fait respecter. Elle a exactement les clés que {@link cell}
   * sait rendre : un `order` sur autre chose est refusé (400) au lieu de trier
   * sur une chaîne vide, ce qui rendait l'ordre arbitraire sans le dire.
   */
  const SORTABLE_COLUMNS = [
    "methods",
    "path",
    "name",
    "controller",
    "module",
    "firewall",
  ] as const;
  /** Valeur d'une colonne pour le tri/filtre serveur (clés = colonnes du front). */
  const cell = (r: RouteDump, key: string): string => {
    switch (key) {
      case "methods":
        return r.methods.join(",");
      case "path":
        return r.path ?? "";
      case "name":
        return r.name ?? "";
      case "controller":
        return [r.controller, r.action].filter(Boolean).join(".");
      case "module":
        return r.module ?? "";
      case "firewall":
        return r.bypassFirewall ? "bypass" : "protected";
      default:
        return "";
    }
  };
  /** Applique un opérateur de filtre (miroir serveur du DataGrid). */
  const matchOp = (raw: string, op: string, value: string): boolean => {
    const s = String(raw ?? "");
    const v = String(value ?? "");
    if (op !== "isEmpty" && op !== "notEmpty" && v === "") return true;
    switch (op) {
      case "contains":
        return s.toLowerCase().includes(v.toLowerCase());
      case "equals":
        return s === v;
      // « est l'un de » (filtre multi-sélection du DataGrid) : la valeur porte
      // une liste séparée par des virgules, et la cellule est découpée pareil —
      // une route `GET,POST` matche dès qu'UNE des méthodes choisies y figure.
      // Miroir EXACT de `matchFilter` côté grid, sinon le mode serveur et le
      // mode client ne filtreraient pas la même chose.
      case "in": {
        const split = (raw: string) =>
          raw
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t !== "");
        const wanted = split(v);
        if (wanted.length === 0) return true;
        return split(s).some((c) => wanted.includes(c));
      }
      case "startsWith":
        return s.toLowerCase().startsWith(v.toLowerCase());
      case "endsWith":
        return s.toLowerCase().endsWith(v.toLowerCase());
      case "isEmpty":
        return s === "";
      case "notEmpty":
        return s !== "";
      default:
        return true;
    }
  };

  const endpoints: IAdminEndpoint[] = [
    {
      path: "routes",
      summary:
        "All registered routes (Router dump) — name, path, methods, controller",
      handler: () => Router.routes.map(serializeRoute),
    },
    {
      path: "routes/page",
      summary:
        "Routes paginées côté SERVEUR — contrat IPageQuery : ?limit&offset&order=champ:ASC&q, " +
        "plus filters(JSON) propre au DataGrid. Rend un IPage.",
      handler: (request): IPage<RouteDump> => {
        const query = parsePageQuery(request.query, {
          defaultLimit: 25,
          sortable: SORTABLE_COLUMNS,
        });
        const search = query.q?.toLowerCase() ?? "";
        let filters: { key: string; op: string; value: string }[] = [];
        try {
          const raw = one(request.query.filters);
          if (raw) filters = JSON.parse(raw) as typeof filters;
        } catch {
          filters = [];
        }

        let rows = Router.routes.map(serializeRoute);
        if (search) {
          rows = rows.filter((r) =>
            [
              r.methods.join(","),
              r.path,
              r.name,
              r.controller,
              r.action,
              r.module,
              r.bypassFirewall ? "bypass" : "protected",
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(search),
          );
        }
        for (const f of filters) {
          rows = rows.filter((r) => matchOp(cell(r, f.key), f.op, f.value));
        }
        const total = rows.length;
        if (query.order?.length) {
          // Tri multi-champs : le premier couple qui départage l'emporte.
          const order = query.order;
          rows = [...rows].sort((a, b) => {
            for (const [key, dir] of order) {
              const cmp = cell(a, key).localeCompare(cell(b, key));
              if (cmp !== 0) return dir === "DESC" ? -cmp : cmp;
            }
            return 0;
          });
        }
        const offset = query.offset ?? 0;
        return {
          items: rows.slice(offset, offset + query.limit),
          total,
          limit: query.limit,
          offset,
          hasNext: offset + query.limit < total,
        };
      },
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
    {
      // Catalogue du data plane admin (discovery P10.2). Construit à la volée
      // depuis broker.list() (descriptors) + broker.routes() (routes montées,
      // chemins absolus + rôles). Source de la nav admin de Studio.
      path: "admin",
      summary: "Admin data plane catalog — producers, descriptors, endpoints",
      handler: () => {
        if (!broker) return { producers: [] };
        const descByNs = new Map(
          broker.list().map((p) => [p.adminNamespace, p.adminDescriptor()]),
        );
        const byNs = new Map<
          string,
          {
            method: string;
            path: string;
            role: string;
            summary: string | null;
          }[]
        >();
        for (const r of broker.routes()) {
          let arr = byNs.get(r.namespace);
          if (!arr) {
            arr = [];
            byNs.set(r.namespace, arr);
          }
          arr.push({
            method: r.method,
            path: r.path,
            role: r.role,
            summary: r.endpoint.summary ?? null,
          });
        }
        const producers = [...byNs.keys()]
          .map((ns) => {
            const d = descByNs.get(ns);
            return {
              namespace: ns,
              label: d?.label ?? ns,
              icon: d?.icon ?? null,
              order: d?.order ?? 99,
              role: d?.role ?? null,
              endpoints: byNs.get(ns)!,
            };
          })
          .sort((a, b) => a.order - b.order);
        return { producers };
      },
    },
  ];

  if (opts?.playground) {
    endpoints.push(...createPlaygroundEndpoints());
  }

  return {
    adminNamespace: "framework",
    adminDescriptor: () => descriptor,
    adminEndpoints: () => endpoints,
  };
}

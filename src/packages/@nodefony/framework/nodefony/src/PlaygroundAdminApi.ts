import type { IAdminEndpoint } from "nodefony";
import Router from "../service/router";
import type Route from "./Route";
import {
  resolveActionMeta,
  extractActionScopes,
} from "../decorators/routerDecorators";
import AdminApiController from "../controller/AdminApiController";

/**
 * Endpoints « Playground » du data plane framework — la source de données de la
 * console vivante des controllers dans Studio (`/nodefony/playground`).
 *
 * Sérialise ce que le Router et les décorateurs savent déjà (routes, transports,
 * paramètres décorés, gardes) : tout est en Reflect/mémoire, il n'y a qu'à
 * l'exposer en JSON. La page Studio générique construit ses formulaires depuis
 * ces métadonnées — AUCUN code généré dans l'app du user, rétroactif sur tout
 * controller (même écrit à la main).
 *
 * **Dev-only par montage** : `createFrameworkAdminApi` n'inclut ces endpoints
 * que si l'app tourne en développement (le playground EXÉCUTE des mutations
 * depuis le navigateur). Hors dev le endpoint n'existe pas (404) — la page
 * Studio affiche « dev uniquement » (fail-loud, pas de dégradation silencieuse).
 *
 * Cold path (introspection à la demande) : le coût de sérialisation par appel
 * est assumé, aucune structure n'est retenue entre les appels.
 */

/** Un paramètre décoré d'une action (`@Param`/`@Body`/`@Query`…), JSON-safe. */
export interface PlaygroundParam {
  /** Source d'injection (`param`, `body`, `query`, `headers`, `cookie`, `user`…). */
  source: string;
  /** Clé ciblée (`@Query("q")` → `"q"`) — `null` = l'objet complet. */
  key: string | null;
  /** Position dans la signature de l'action. */
  index: number;
  /** `@Body({ stream: true })` — flux brut, non rejouable par formulaire. */
  stream: boolean;
}

/** Les gardes déclaratives d'une action, prêtes à afficher (badges Studio). */
export interface PlaygroundGuards {
  /** Clauses `@IsGranted`/`@RequireScope` fusionnées (AND) — `null` = non gardée. */
  security: {
    clauses: { anyOf: string[]; subjectParam: string | null }[];
  } | null;
  /** Scopes `api:action` déclarés (`@RequireScope`), dédupliqués. */
  scopes: string[];
  /** `@Idempotent` — `required:true` = clé obligatoire sur mutation. */
  idempotent: { required: boolean } | null;
  csrfProtect: boolean;
  csrfExempt: boolean;
  /** Intent `@UseSession`/`@Session` — `null` si la route n'en déclare pas. */
  session: unknown;
  /** Route hors firewall (mécanisme d'auth lui-même). */
  bypassFirewall: boolean;
}

/** Une action invocable depuis le playground (1 route du Router). */
export interface PlaygroundAction {
  /** Nom de route (unique) — clé de deep-link et de rejeu. */
  route: string;
  path: string | null;
  /** Transports déclarés (`["POST","WEBSOCKET"]`…) — majuscules. */
  methods: string[];
  /** Vrai si l'action déclare AUSSI le transport WEBSOCKET (pont `api.request`). */
  duplex: boolean;
  /** Nom de la méthode de classe (action). */
  action: string | null;
  /** Variables de path (`{id}` → `["id"]`), ordre de capture. */
  variables: string[];
  /** Défauts de variables (hors clé interne `controller`). */
  defaults: Record<string, unknown>;
  params: PlaygroundParam[];
  guards: PlaygroundGuards;
}

/** Un controller et ses actions, groupés pour la navigation Studio. */
export interface PlaygroundController {
  /** Nom de classe du controller. */
  name: string;
  /** Module propriétaire (`null` si non rattaché). */
  module: string | null;
  actions: PlaygroundAction[];
}

/** Normalise `requirements.methods` (string | string[]) → tableau majuscule. */
function methodsOf(route: Route): string[] {
  const m = route.requirements?.methods ?? route.method;
  if (Array.isArray(m)) return m.map((x) => String(x).toUpperCase());
  if (typeof m === "string") {
    return m
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }
  return ["ANY"];
}

/** Défauts de la route sans la clé interne `controller` (jamais un input user). */
function publicDefaults(route: Route): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(route.defaults)) {
    if (k !== "controller") out[k] = v;
  }
  return out;
}

/** Sérialise une route en action playground (métadonnées figées, JSON-safe). */
function serializeAction(route: Route): PlaygroundAction {
  const meta = resolveActionMeta(route);
  const methods = methodsOf(route);
  const scopes =
    route.controller && route.classMethod
      ? extractActionScopes(route.controller, route.classMethod)
      : [];
  return {
    route: route.name,
    path: route.path ?? null,
    methods,
    duplex: methods.includes("WEBSOCKET"),
    action: route.classMethod ?? null,
    variables: [...route.variables],
    defaults: publicDefaults(route),
    // Les décorateurs TS s'évaluent droite→gauche → la metadata n'est pas
    // ordonnée ; le formulaire veut l'ordre de la signature (index croissant).
    params:
      meta.paramsMeta
        ?.map((p) => ({
          source: p.source,
          key: p.key ?? null,
          index: p.index,
          stream: p.stream === true,
        }))
        .sort((a, b) => a.index - b.index) ?? [],
    guards: {
      security: meta.security
        ? {
            clauses: meta.security.clauses.map((c) => ({
              anyOf: [...c.anyOf],
              subjectParam: c.subjectParam ?? null,
            })),
          }
        : null,
      scopes,
      idempotent: meta.idempotent
        ? { required: meta.idempotent.required }
        : null,
      csrfProtect: meta.csrfProtect,
      csrfExempt: meta.csrfExempt,
      session: meta.sessionIntent,
      bypassFirewall: route.bypassFirewall === true,
    },
  };
}

/**
 * Construit le snapshot playground : toutes les routes à controller, groupées
 * par classe de controller, triées (module puis nom, actions par path).
 *
 * Exclut les routes du **pont admin** (`AdminApiController.dispatch`) : le data
 * plane a déjà son catalogue (`GET /nodefony/framework/api/admin`) et ses ~50
 * routes techniques noieraient les controllers applicatifs.
 *
 * @returns la liste des controllers jouables, prête pour la page Studio.
 */
export function buildPlaygroundSnapshot(): {
  controllers: PlaygroundController[];
} {
  // Clé = identité de référence du constructeur (une classe = un groupe).
  const byController = new Map<object, PlaygroundController>();
  for (const route of Router.routes) {
    const ctor = route.controller;
    if (!ctor || !route.classMethod) continue;
    if ((ctor as unknown) === AdminApiController) continue;
    let group = byController.get(ctor);
    if (!group) {
      group = {
        // Tout constructeur runtime est une Function → `.name` existe toujours.
        name: (ctor as { name?: string }).name ?? "Controller",
        module: route.module?.name ?? null,
        actions: [],
      };
      byController.set(ctor, group);
    }
    group.actions.push(serializeAction(route));
  }
  const controllers = [...byController.values()];
  for (const c of controllers) {
    c.actions.sort((a, b) => (a.path ?? "").localeCompare(b.path ?? ""));
  }
  controllers.sort(
    (a, b) =>
      (a.module ?? "~").localeCompare(b.module ?? "~") ||
      a.name.localeCompare(b.name),
  );
  return { controllers };
}

/**
 * Endpoints playground à greffer au producteur `framework` (dev uniquement —
 * cf gating dans `createFrameworkAdminApi`).
 *
 * @returns `GET /nodefony/framework/api/playground/routes`.
 */
export function createPlaygroundEndpoints(): IAdminEndpoint[] {
  return [
    {
      path: "playground/routes",
      summary:
        "Playground (dev) — controllers + actions + transports + params + guards, form-ready",
      handler: () => buildPlaygroundSnapshot(),
    },
  ];
}

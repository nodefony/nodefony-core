import { Service, Module, Container, Event, injectable } from "nodefony";
import type { IAdminApi } from "nodefony";
import type { HTTPMethod } from "@nodefony/http";
import type { IAdminBroker, IAdminRoute } from "../interfaces/IAdminBroker";
import Router from "./router";
import AdminApiController from "../src/AdminApiController";
import type Controller from "../src/Controller";

const serviceName = "adminBroker";

/**
 * Implémentation du data plane admin (Studio) — collecte les {@link IAdminApi}
 * et monte `/nodefony/<namespace>/api/*` via le Router.
 *
 * Vit dans `@nodefony/framework` : seul niveau qui possède le Router. Le
 * contrat producteur (`IAdminApi`) vit dans le core (inversion de dépendance).
 *
 * @see IAdminBroker pour le contrat public + la convention de routage.
 */
@injectable()
class AdminBroker extends Service implements IAdminBroker {
  readonly rootPrefix = "/nodefony";
  readonly apiSegment = "api";
  readonly defaultRole = "ROLE_NODEFONY_ADMIN";

  /** Producteurs enregistrés, indexés par namespace. */
  private producers = new Map<string, IAdminApi>();
  /** Routes résolues, indexées par nom de route (dispatch O(1)). */
  private byRouteName = new Map<string, IAdminRoute>();
  /** Module framework propriétaire — requis pour `Router.setController`. */
  private frameworkModule: Module;
  /** Vrai une fois `mountAll()` exécuté (idempotence + verrou de register). */
  private mounted = false;

  constructor(module: Module) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options.adminBroker,
    );
    this.frameworkModule = module;
  }

  register(api: IAdminApi): this {
    if (this.mounted) {
      throw new Error(
        `AdminBroker: register("${api.adminNamespace}") après mountAll — routes figées`,
      );
    }
    if (this.producers.has(api.adminNamespace)) {
      throw new Error(
        `AdminBroker: namespace déjà enregistré "${api.adminNamespace}"`,
      );
    }
    this.producers.set(api.adminNamespace, api);
    this.log(`Admin API registered: ${api.adminNamespace}`, "DEBUG");
    return this;
  }

  unregister(namespace: string): boolean {
    const existed = this.producers.delete(namespace);
    if (existed && this.mounted) {
      const router = this.getRouter();
      for (const [name, r] of this.byRouteName) {
        if (r.namespace === namespace) {
          try {
            router.removeRoutes(name);
          } catch {
            /* route absente — ignore */
          }
          this.byRouteName.delete(name);
        }
      }
    }
    return existed;
  }

  override has(namespace: string): boolean {
    return this.producers.has(namespace);
  }

  getApi(namespace: string): IAdminApi | undefined {
    return this.producers.get(namespace);
  }

  list(): readonly IAdminApi[] {
    return Array.from(this.producers.values());
  }

  resolvePath(namespace: string, endpointPath: string): string {
    const tail = endpointPath.replace(/^\/+/, "");
    return `${this.rootPrefix}/${namespace}/${this.apiSegment}/${tail}`;
  }

  resolve(routeName: string): IAdminRoute | undefined {
    return this.byRouteName.get(routeName);
  }

  routes(): readonly IAdminRoute[] {
    return Array.from(this.byRouteName.values());
  }

  mountAll(): void {
    if (this.mounted) return;
    for (const api of this.producers.values()) {
      for (const endpoint of api.adminEndpoints()) {
        const method = (endpoint.method ?? "GET") as HTTPMethod;
        const role = endpoint.role ?? this.defaultRole;
        const path = this.resolvePath(api.adminNamespace, endpoint.path);
        const name = `admin.${api.adminNamespace}.${method}.${endpoint.path}`;
        // « API souveraine » : les snapshots (GET) déclarent AUSSI le transport
        // WEBSOCKET → invocables par le pont WS-RPC `api.request` (même action,
        // même snapshot). Le pont n'atteint QUE ce qui déclare le transport
        // (zéro bypass) ; les mutations (POST/PUT/DELETE) restent HTTP-only
        // tant que la sémantique d'écriture par socket n'est pas conçue (P6).
        const methods: HTTPMethod[] =
          method === "GET" ? [method, "WEBSOCKET"] : [method];
        Router.createRoute(name, {
          path,
          constructor:
            AdminApiController as unknown as Controller["constructor"],
          classMethod: "dispatch",
          requirements: { methods },
        });
        this.byRouteName.set(name, {
          name,
          namespace: api.adminNamespace,
          path,
          method,
          role,
          endpoint,
        });
      }
    }
    // Enregistre le controller pont + propage le module aux routes créées.
    // `Router.setController` fait `Object.defineProperty(proto,"module",{writable:false})`
    // → ne PEUT être appelé qu'UNE fois par classe sur la vie du process (sinon
    // "Cannot redefine property"). En prod il n'y a qu'un broker, mais on garde
    // l'appel idempotent (multi-broker en test, re-boot) via la garde hasOwnProperty.
    if (
      this.byRouteName.size > 0 &&
      !Object.prototype.hasOwnProperty.call(
        AdminApiController.prototype,
        "module",
      )
    ) {
      Router.setController(
        AdminApiController as unknown as Parameters<
          typeof Router.setController
        >[0],
        this.frameworkModule,
      );
    }
    this.mounted = true;
    this.log(
      `Admin data plane mounted: ${this.byRouteName.size} route(s)`,
      "DEBUG",
    );
  }

  private getRouter(): Router {
    return this.get<Router>("router") as Router;
  }
}

export default AdminBroker;

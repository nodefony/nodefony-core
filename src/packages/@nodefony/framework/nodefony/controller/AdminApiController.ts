import { RequestContext, RpcError, executeAdminEndpoint } from "nodefony";
import type {
  IAdminExecution,
  IAdminGateVerdict,
  IAdminRequest,
} from "nodefony";
import type { IAdminBroker, IAdminRoute } from "../interfaces/IAdminBroker";
import type { IIdempotencyStore } from "../interfaces/IIdempotencyStore";
import type { ContextType } from "@nodefony/http";
import Controller from "../src/Controller";
import {
  evaluateIdempotency,
  resolveIdempotencyKey,
  resolveIdentity,
  computeFingerprint,
} from "../src/idempotency";

/**
 * Controller pont unique du data plane admin (Studio).
 *
 * Toutes les routes `/nodefony/<namespace>/api/*` montées par le broker
 * pointent vers `AdminApiController.dispatch`. À l'exécution, le controller :
 *  1. retrouve l'`IAdminRoute` via le nom de route (lookup O(1) du broker) ;
 *  2. projette le `Context` HTTP en {@link IAdminRequest} (découplage core) ;
 *  3. applique le RBAC (différé tant que P6/auth n'est pas câblé) ;
 *  4. appelle le handler du producteur et sérialise le retour en JSON.
 *
 * Un seul controller réutilisé pour N endpoints : pas de génération dynamique
 * de classes, et chaque route reste une vraie `Route` (404/405 du Router OK).
 */
class AdminApiController extends Controller {
  /**
   * Identité de l'instance qui répond — `NODEFONY_INSTANCE_ID` (k8s pod, worker)
   * ou `pid` en fallback. Même convention que les providers realtime Studio.
   * Calculée une fois (statique) : invariante sur la vie du process.
   */
  static readonly instanceId =
    process.env.NODEFONY_INSTANCE_ID ?? String(process.pid);

  constructor(context: ContextType) {
    super("AdminApiController", context);
  }

  /**
   * Action générique appelée par le Resolver pour toute route admin — DUPLEX
   * (« API souveraine ») : même exécution sur les deux transports, seul
   * l'emballage diffère.
   *
   *  - **HTTP** : rendu historique inchangé (`renderJson` + status + header
   *    `x-nodefony-instance`).
   *  - **Pont WS-RPC `api.request`** : valeur **nue** (le pont l'enveloppe
   *    `{id, result}` — snapshot ≡ GET par construction) ; statut ≥ 400 →
   *    {@link RpcError} (`data.status` + `data.body`), symétrie d'un `fetch`
   *    qui expose son statut. L'identité d'instance n'est pas répétée par
   *    réponse : une socket est tenue par UN process (info de connexion).
   *
   * @param args - variables de route positionnelles (`{id}`…), zippées avec
   *   `route.variables` pour reconstruire `request.params`.
   */
  async dispatch(...args: unknown[]) {
    const { status, headers, body } = await this.runAdmin(args);
    if (this.context?.type?.startsWith("websocket")) {
      if (status >= 400) {
        const message =
          (body as { error?: string } | null)?.error ?? "admin error";
        throw new RpcError(message, -32000, { status, body });
      }
      return body;
    }
    // Le data plane admin est PER-INSTANCE : en multi-process (reusePort) ou
    // multi-pod, le LB route la requête vers UN seul process. On estampille
    // donc chaque réponse de l'identité d'instance (même convention que
    // `nodefony:dashboard`) → Studio sait quel pod a répondu. Vue cluster = P13.
    return this.renderJson(body, status, {
      ...headers,
      "x-nodefony-instance": AdminApiController.instanceId,
    });
  }

  /**
   * Résout la route admin, puis délègue l'exécution à la porte unique du cœur.
   *
   * Le LOOKUP est ce qui reste propre à ce transport : ici par **nom de route**
   * (le Router l'impose), là où la CLI et le serveur MCP résolvent par couple
   * namespace/chemin. Tout ce qui suit — autorisation, idempotence, handler,
   * normalisation, traduction des erreurs — est commun, donc partagé
   * ({@link executeAdminEndpoint}) : deux implémentations divergeraient, et
   * c'est la porte la moins relue qui deviendrait la plus permissive.
   */
  private async runAdmin(args: unknown[]): Promise<IAdminExecution> {
    const broker = this.get<IAdminBroker>("adminBroker");
    const name = this.route?.name;
    const adminRoute: IAdminRoute | undefined =
      broker && name ? broker.resolve(name) : undefined;

    if (!adminRoute) {
      // Route montée mais introuvable dans le registre → incohérence interne.
      return {
        status: 500,
        body: { error: "Admin endpoint not registered", route: name ?? null },
      };
    }

    // RBAC, idempotence, handler, normalisation et traduction des erreurs
    // vivent dans la porte UNIQUE du cœur — la même que la commande `inspect`
    // et le serveur MCP empruntent. Ce controller n'est plus qu'un ADAPTATEUR
    // de transport : il projette le Context en requête, fournit la porte
    // d'idempotence (qui a besoin du conteneur), et emballe l'issue.
    return executeAdminEndpoint({
      endpoint: adminRoute.endpoint,
      request: this.buildRequest(args),
      // Rôle **monté avec la route** : le broker l'a résolu au boot.
      requiredRole: adminRoute.role,
      gate: (request) => this.idempotencyGate(adminRoute, request),
      onServerError: (error) => this.log(error, "ERROR"),
    });
  }

  /**
   * Porte d'idempotence d'une **mutation** admin. La sémantique normative
   * (`draft-ietf-httpapi-idempotency-key-header` : 400 clé requise WS / 409
   * concurrent / 422 mismatch / rejeu mémorisé, clé scopée identité anti-IDOR,
   * fingerprint du payload) vit dans le **helper partagé** `idempotency.ts` — le
   * MÊME que le seam `Resolver` des controllers userland `@Idempotent`. Ici on ne
   * fait que TRADUIRE le verdict neutre en forme admin (`shortCircuit` immédiat,
   * ou callbacks `onSuccess`/`onFailure` autour de l'exécution).
   *
   * `required: false` → l'admin n'exige la clé qu'en WS (porté par `isWs` dans le
   * helper) ; en HTTP, une mutation sans clé s'exécute directement (historique).
   */
  private async idempotencyGate(
    adminRoute: IAdminRoute,
    request: IAdminRequest,
  ): Promise<IAdminGateVerdict> {
    if (adminRoute.method === "GET") return {};
    const store = this.get<IIdempotencyStore>("idempotencyStore");
    const verdict = await evaluateIdempotency({
      store,
      identity: resolveIdentity(request.user),
      clientKey: request.idempotencyKey,
      fingerprint: computeFingerprint([
        adminRoute.name,
        request.params,
        request.body ?? null,
      ]),
      isWs: Boolean(
        (this.context?.type as string | undefined)?.startsWith("websocket"),
      ),
      required: false,
    });
    switch (verdict.kind) {
      case "reject":
        return {
          shortCircuit: {
            status: verdict.status,
            body: verdict.detail
              ? { error: verdict.message, detail: verdict.detail }
              : { error: verdict.message },
          },
        };
      case "replay":
        return { shortCircuit: verdict.response };
      case "guarded":
        return {
          onSuccess: (resp) => store?.complete(verdict.key, resp),
          onFailure: () => store?.abort(verdict.key),
        };
      case "execute":
      default:
        return {};
    }
  }

  /** Projette le Context courant en requête admin normalisée. */
  private buildRequest(args: unknown[]): IAdminRequest {
    // `route.variables` = NOMS des variables (string[]), `args` = valeurs
    // matchées positionnelles (le Resolver appelle l'action avec
    // `...resolver.variables`, alignées sur `route.variables`). Cf
    // `Resolver._buildParamArgs`.
    const names = (this.route?.variables ?? []) as string[];
    const params: Record<string, string> = {};
    for (let i = 0; i < names.length; i++) {
      const key = names[i];
      if (typeof key === "string" && args[i] !== undefined) {
        params[key] = String(args[i]);
      }
    }
    const als = RequestContext.get();
    const user = als?.user ?? null;
    return {
      params,
      query: (this.query ?? {}) as Record<string, string | string[]>,
      // WS : le corps de la mutation est porté par l'ALS (le pont `api.request`
      // le pose — pas de corps HTTP parsé en WebSocket). HTTP : `queryPost`.
      // `als.body === undefined` (cas GET/handshake) → on retombe sur queryPost.
      body: als?.body !== undefined ? als.body : (this.queryPost ?? null),
      user,
      roles: this.extractRoles(user),
      requestId: als?.requestId,
      // Clé résolue par le helper partagé (ALS du pont WS > en-tête HTTP, bornée).
      idempotencyKey: resolveIdempotencyKey(
        als?.idempotencyKey,
        this.context?.request?.headers?.["idempotency-key"],
      ),
    };
  }

  /** Extrait les rôles de l'utilisateur ALS sans coupler le core à `IUser`. */
  private extractRoles(user: unknown): readonly string[] {
    if (user && typeof user === "object" && "roles" in user) {
      const roles = (user as { roles: unknown }).roles;
      if (Array.isArray(roles)) {
        return roles.filter((r): r is string => typeof r === "string");
      }
    }
    return [];
  }
}

export default AdminApiController;

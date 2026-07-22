import { RequestContext, RpcError } from "nodefony";
import type { IAdminRequest, IAdminResponse } from "nodefony";
import type { IAdminBroker, IAdminRoute } from "../interfaces/IAdminBroker";
import type {
  IIdempotencyStore,
  IdempotentResponse,
} from "../interfaces/IIdempotencyStore";
import type { ContextType } from "@nodefony/http";
import Controller from "../src/Controller";
import { isAdminGranted } from "../src/adminRbac";
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
   * Exécution transport-agnostique d'un endpoint admin : lookup broker → RBAC
   * → handler → normalisation. Toute issue (succès comme erreur) ressort en
   * `{status, headers?, body}` — les adaptateurs de rendu (HTTP/pont) décident
   * de la forme finale.
   */
  private async runAdmin(args: unknown[]): Promise<{
    status: number;
    headers?: IAdminResponse["headers"];
    body: unknown;
  }> {
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

    const request = this.buildRequest(args);

    // ── RBAC (fail-closed) ───────────────────────────────────────────────────
    // Le firewall (zone `nodefony-admin`) garantit l'AUTHENTIFICATION en amont ;
    // ici on tranche le RÔLE. Un authentifié SANS le rôle requis — y compris
    // `roles=[]` (compte non doté) — est REJETÉ (403). `adminRoute.role === ""`
    // = endpoint public déclaré (`endpoint.public`, ex. `livez`) → accordé.
    // Détail + ex-fail-open documentés dans `isAdminGranted`.
    if (!isAdminGranted(request.roles, adminRoute.role)) {
      return {
        status: 403,
        body: { error: "Forbidden", required: adminRoute.role },
      };
    }

    // ── Idempotence des MUTATIONS (anti double-effet sur rejeu) ──────────────
    // Évaluée APRÈS le RBAC (un 403 ne consomme aucune entrée du cache). Un GET
    // n'est jamais idempotenté (lecture). Pour une mutation : clé OBLIGATOIRE
    // par socket (qui reconnecte/rejoue), OPTIONNELLE en HTTP. La porte
    // court-circuite (400 clé requise WS / 409 in-flight / réponse mémorisée
    // d'un rejeu) ou laisse passer en mémorisant le résultat à la sortie.
    const gate = await this.idempotencyGate(adminRoute, request);
    if (gate.shortCircuit) return gate.shortCircuit;

    // ── Exécution du handler ─────────────────────────────────────────────────
    try {
      const result = await adminRoute.endpoint.handler(request);
      const n = this.normalize(result);
      const resp = {
        status: n.status ?? 200,
        headers: n.headers,
        body: n.body,
      };
      await gate.onSuccess?.(resp); // mémorise pour les rejeux (fresh uniquement)
      return resp;
    } catch (e) {
      await gate.onFailure?.(); // libère la clé in-flight → un échec reste réessayable
      this.log(e as Error, "ERROR");
      return { status: 500, body: { error: "Internal admin handler error" } };
    }
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
  ): Promise<{
    shortCircuit?: {
      status: number;
      headers?: IAdminResponse["headers"];
      body: unknown;
    };
    onSuccess?: (resp: IdempotentResponse) => void | Promise<void>;
    onFailure?: () => void | Promise<void>;
  }> {
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

  /** Normalise le retour d'un handler (donnée brute OU enveloppe) en réponse. */
  private normalize(
    result: unknown,
  ): Required<Pick<IAdminResponse, "body">> & Omit<IAdminResponse, "body"> {
    if (
      result &&
      typeof result === "object" &&
      "body" in result &&
      ("status" in result || "headers" in result)
    ) {
      const r = result as IAdminResponse;
      return { status: r.status ?? 200, headers: r.headers, body: r.body };
    }
    return { status: 200, body: result };
  }
}

export default AdminApiController;

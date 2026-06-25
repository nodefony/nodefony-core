import { createHash } from "node:crypto";
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
    // `dashboard:stats`) → Studio sait quel pod a répondu. Vue cluster = P13.
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
    const gate = this.idempotencyGate(adminRoute, request);
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
      gate.onSuccess?.(resp); // mémorise pour les rejeux (fresh uniquement)
      return resp;
    } catch (e) {
      gate.onFailure?.(); // libère la clé in-flight → un échec reste réessayable
      this.log(e as Error, "ERROR");
      return { status: 500, body: { error: "Internal admin handler error" } };
    }
  }

  /**
   * Porte d'idempotence d'une **mutation** admin. Conforme à
   * `draft-ietf-httpapi-idempotency-key-header-06` (§2.6/§2.7). Renvoie soit un
   * `shortCircuit` (réponse immédiate), soit des callbacks `onSuccess`/`onFailure`
   * à jouer autour de l'exécution (mémoriser / libérer la clé).
   *
   * Politique (codes de statut normatifs) :
   *  - GET → no-op (lecture, jamais idempotentée).
   *  - mutation par **socket** SANS clé → **400** (§2.7 ; une socket rejoue : muter
   *    sans garde-fou exposerait au double-effet que ce dispositif élimine).
   *  - mutation **HTTP** sans clé → exécution directe (rétro-compat ; HTTP ne
   *    rejoue pas tout seul). Clé fournie = honorée.
   *  - rejeu **après complétion** (même payload) → réponse mémorisée (§2.6 Retry).
   *  - rejeu **concurrent** (en cours) → **409** (§2.6/§2.7).
   *  - même clé, **payload différent** → **422** (§2.2/§2.7 — réutilisation interdite).
   *
   * 🔒 La clé de cache est **scopée à l'identité** (`request.user`) + clé client :
   * un utilisateur ne peut jamais rejouer la clé d'un autre (anti-IDOR). Le payload
   * (route + params + corps) est comparé via un **fingerprint** (anti-réutilisation
   * de clé cross-requête).
   */
  private idempotencyGate(
    adminRoute: IAdminRoute,
    request: IAdminRequest,
  ): {
    shortCircuit?: {
      status: number;
      headers?: IAdminResponse["headers"];
      body: unknown;
    };
    onSuccess?: (resp: IdempotentResponse) => void;
    onFailure?: () => void;
  } {
    if (adminRoute.method === "GET") return {};
    const isWs = Boolean(
      (this.context?.type as string | undefined)?.startsWith("websocket"),
    );
    const key = request.idempotencyKey;
    if (isWs && !key) {
      return {
        shortCircuit: {
          status: 400,
          body: { error: "Idempotency-Key required for socket mutations" },
        },
      };
    }
    // Mutation HTTP sans clé : comportement historique (pas de dédup).
    if (!key) return {};
    // Identité stable = scope du cache (anti-IDOR). Dérivée de `request.user`,
    // posé UNIFORMÉMENT dans l'ALS par les DEUX transports (pont WS et firewall
    // HTTP) → une mutation tentée en WS puis rejouée en fetch dédoublonne bien.
    // `getUserId()` ne suffit pas (le firewall HTTP ne le pose pas toujours).
    // Sans identité fiable, on n'utilise PAS le cache (jamais de partage cross-id).
    const identity = this.idempotencyIdentity(request);
    if (!identity) return {};
    const store = this.get<IIdempotencyStore>("idempotencyStore");
    if (!store) return {}; // service absent → dégrade en exécution directe
    // Clé du cache = [identité, clé client] encodé JSON (frontières non
    // ambiguës, sans séparateur magique). Le draft : une Idempotency-Key
    // identifie l'INTENTION d'un appelant → scope (identité, clé).
    const scoped = JSON.stringify([identity, key]);
    // Empreinte du PAYLOAD (route + params + corps) : une même clé rejouée avec
    // un payload DIFFÉRENT = réutilisation interdite (draft §2.2) → 422. Hash →
    // empreinte courte (anti-DoS mémoire) + comparaison O(1) dans le store.
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([adminRoute.name, request.params, request.body ?? null]),
      )
      .digest("hex");
    const outcome = store.begin(scoped, fingerprint);
    if (outcome.state === "mismatch") {
      // draft §2.7 : clé réutilisée avec un autre payload → 422 Unprocessable
      // Content (RFC 9110 §15.5.21). Le client doit corriger (nouvelle clé).
      return {
        shortCircuit: {
          status: 422,
          body: {
            error: "Idempotency-Key is already used",
            detail:
              "This Idempotency-Key was used with a different payload; a key must not be reused across different requests.",
          },
        },
      };
    }
    if (outcome.state === "in-flight") {
      return {
        shortCircuit: {
          status: 409,
          body: {
            error: "Conflict: an identical request is already in progress",
          },
        },
      };
    }
    if (outcome.state === "replayed") {
      return { shortCircuit: outcome.response };
    }
    return {
      onSuccess: (resp) => store.complete(scoped, resp),
      onFailure: () => store.abort(scoped),
    };
  }

  /**
   * Identité stable pour scoper le cache d'idempotence. Dérivée de l'IUser
   * (`request.user`, posé dans l'ALS par les DEUX transports) — `username` /
   * `identifier` / `id` — sans coupler le framework au contrat `IUser`. Fallback
   * sur `userId` de l'ALS, puis `null` (→ pas de cache, jamais de partage
   * cross-identité). Doit être IDENTIQUE des deux transports pour le même compte
   * (sinon une mutation WS rejouée en fetch ne dédoublonnerait pas).
   */
  private idempotencyIdentity(request: IAdminRequest): string | null {
    const u = request.user;
    if (u && typeof u === "object") {
      const o = u as {
        username?: unknown;
        identifier?: unknown;
        id?: unknown;
      };
      for (const v of [o.username, o.identifier, o.id]) {
        if (typeof v === "string" && v) return v;
      }
    }
    const uid = RequestContext.getUserId();
    return typeof uid === "string" && uid ? uid : null;
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
      idempotencyKey: this.resolveIdempotencyKey(als),
    };
  }

  /**
   * Résout la clé d'idempotence d'une mutation : posée dans l'ALS par le pont WS
   * (`params.idempotencyKey`) ou lue de l'en-tête HTTP `Idempotency-Key` (clé
   * minuscule côté Node). `undefined` si absente (GET, mutation HTTP legacy).
   */
  private resolveIdempotencyKey(
    als: ReturnType<typeof RequestContext.get>,
  ): string | undefined {
    let raw: string | undefined;
    if (typeof als?.idempotencyKey === "string" && als.idempotencyKey) {
      raw = als.idempotencyKey;
    } else {
      const h = this.context?.request?.headers?.["idempotency-key"];
      if (typeof h === "string" && h) raw = h;
      else if (Array.isArray(h) && typeof h[0] === "string" && h[0]) raw = h[0];
    }
    // Anti-DoS : une clé d'idempotence est un identifiant court (UUID). Bornée à
    // 255 (convention Stripe) → une clé abusive ne peut pas gonfler le cache
    // borné. Trop longue = traitée comme ABSENTE (→ 400 « clé requise » en WS,
    // pas de dédup en HTTP) plutôt que stockée.
    return raw && raw.length <= 255 ? raw : undefined;
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

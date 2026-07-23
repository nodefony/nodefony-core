import type { Module } from "nodefony";
import type { ContextType, HTTPMethod } from "@nodefony/http";
import Router from "../service/router";
import Controller from "../src/Controller";
import { collectDeclaredApiScopes } from "../src/scopeCatalog";

/**
 * Vue MINIMALE de l'utilisateur courant exposée par `authFlow.me` (P6 J3) — on ne
 * lit que l'identifiant (= `IUser.identifier`, porté par `username`), qui devient
 * le `subjectId` de la clé (cohérent avec le `sub` d'un JWT).
 */
interface ISafeUserLike {
  username: string;
}

/** Vue locale du flux de session BFF (service `authFlow`, posé par security). */
interface ISessionAuthFlow {
  me(context: ContextType): Promise<ISafeUserLike | null>;
}

/**
 * Vue locale du service `apiKeys` (`@nodefony/security` P6.12). Contrat structurel
 * — framework ne dépend JAMAIS de security ; couplage par nom de service.
 */
interface IApiKeyManager {
  isEnabled(): boolean;
  createForSubject(
    subjectId: string,
    subjectType: "user" | "service",
    opts: { name: unknown; scopes?: unknown; expiresInDays?: unknown },
  ): Promise<unknown>;
  listForSubject(subjectId: string): Promise<unknown>;
  revokeForSubject(subjectId: string, id: string): Promise<boolean>;
  describeCapabilities(): unknown;
}

// Montage one-shot par process (même sémantique que `mountSessionAuthRoutes`).
let mounted = false;

/**
 * Endpoints HTTP de **gestion des clés API personnelles (PAT, P6.12)** — console
 * « mes clés » façon GitHub, adaptateurs MINCES au-dessus du service `apiKeys`
 * (`@nodefony/security`) :
 *
 *  - `POST   /nodefony/security/api/keys`        — body `{name, scopes?, expiresInDays?}`
 *    → `201 {id, prefix, name, scopes, token, …}` (le `token` clair n'apparaît qu'ICI)
 *  - `GET    /nodefony/security/api/keys`        — liste les clés du porteur (sans secret)
 *  - `DELETE /nodefony/security/api/keys/{id}`   — révoque → `200 {ok:true}` / `404`
 *    si la clé n'existe pas **ou** appartient à autrui (indiscernable, jamais 403)
 *
 * **PAS de `bypassFirewall`** (≠ login/token/oauth) : ces routes vivent DANS la
 * zone data plane `^/nodefony/[^/]+/api(/|$)` → **session BFF requise**. Le porteur
 * est TOUJOURS l'utilisateur courant (`authFlow.me`), jamais un paramètre — on ne
 * crée/révoque jamais une clé pour autrui. Montés seulement si le service `apiKeys`
 * existe (security chargé + clés activées) → 404, zéro surface, sinon.
 *
 * Erreurs mappées par DUCK-TYPING sur `code` (400/409/503) — framework ne peut pas
 * importer les classes d'erreur de security.
 */
class ApiKeyController extends Controller {
  constructor(context: ContextType) {
    super("ApiKeyController", context);
  }

  /** Émission : crée une clé pour le porteur courant → token clair (1×). */
  async create() {
    const svc = this.#manager();
    if (!svc || !svc.isEnabled()) {
      return this.renderJson({ error: "API keys unavailable" }, 503);
    }
    const subject = await this.#currentSubject();
    if (subject === null) {
      return this.renderJson({ error: "Unauthorized" }, 401);
    }
    const body = (this.queryPost ?? {}) as {
      name?: unknown;
      scopes?: unknown;
      expiresInDays?: unknown;
    };
    try {
      const created = await svc.createForSubject(subject, "user", {
        name: body.name,
        scopes: body.scopes,
        expiresInDays: body.expiresInDays,
      });
      return this.renderJson(created, 201);
    } catch (e) {
      return this.#renderApiKeyError(e);
    }
  }

  /**
   * Capacités/contraintes d'émission (plafond, scopes, préfixe, durée par défaut)
   * — alimente le formulaire de création. Lecture pure, aucune valeur sensible ;
   * accessible à tout porteur authentifié (zone data plane, session BFF).
   */
  async capabilities() {
    const svc = this.#manager();
    if (!svc || !svc.isEnabled()) {
      return this.renderJson({ error: "API keys unavailable" }, 503);
    }
    // P6.8 — enrichit le formulaire avec le catalogue de scopes DÉCOUVERT des
    // routes (`@RequireScope`), groupé par API. Le framework voit le `Router`
    // (security non) → l'agrégation se fait ICI, pas dans `describeCapabilities`.
    // `allowedScopes` (config security) reste un complément (scopes hors-routes).
    const caps = svc.describeCapabilities() as Record<string, unknown>;
    return this.renderJson({
      ...caps,
      declaredScopes: collectDeclaredApiScopes(),
    });
  }

  /** Liste les clés du porteur courant (vue publique, sans secret). */
  async list() {
    const svc = this.#manager();
    if (!svc || !svc.isEnabled()) {
      return this.renderJson({ error: "API keys unavailable" }, 503);
    }
    const subject = await this.#currentSubject();
    if (subject === null) {
      return this.renderJson({ error: "Unauthorized" }, 401);
    }
    return this.renderJson({ keys: await svc.listForSubject(subject) });
  }

  /** Révocation : seulement une clé DU porteur courant (sinon 404, anti-énumération). */
  async revoke(id: unknown) {
    const svc = this.#manager();
    if (!svc || !svc.isEnabled()) {
      return this.renderJson({ error: "API keys unavailable" }, 503);
    }
    const subject = await this.#currentSubject();
    if (subject === null) {
      return this.renderJson({ error: "Unauthorized" }, 401);
    }
    if (typeof id !== "string" || id.length === 0) {
      return this.renderJson({ error: "Not found" }, 404);
    }
    const ok = await svc.revokeForSubject(subject, id);
    if (!ok) {
      // Inexistante OU appartenant à autrui : 404 indiscernable (jamais 403).
      return this.renderJson({ error: "Not found" }, 404);
    }
    return this.renderJson({ ok: true });
  }

  #manager(): IApiKeyManager | null {
    return this.get<IApiKeyManager>("apiKeys") ?? null;
  }

  #flow(): ISessionAuthFlow | null {
    return this.get<ISessionAuthFlow>("authFlow") ?? null;
  }

  /** Identifiant du porteur courant (session BFF revalidée), ou `null` si non authentifié. */
  async #currentSubject(): Promise<string | null> {
    const flow = this.#flow();
    if (!flow) return null;
    const me = await flow.me(this.context as ContextType);
    return me && typeof me.username === "string" ? me.username : null;
  }

  // 400 → message de validation (input, jamais un secret) ; 409 → plafond ;
  // 503 → store indispo ; le reste → pipeline 500 (fail-closed).
  #renderApiKeyError(e: unknown) {
    const code = (e as { code?: unknown }).code;
    if (code === 400) {
      const message = (e as { message?: unknown }).message;
      return this.renderJson(
        { error: typeof message === "string" ? message : "Bad request" },
        400,
      );
    }
    if (code === 409) {
      return this.renderJson({ error: "API key limit reached" }, 409);
    }
    if (code === 503) {
      return this.renderJson({ error: "API keys unavailable" }, 503);
    }
    throw e;
  }
}

/**
 * Monte les routes de gestion des clés API — appelé par le module framework à
 * `onKernelReady`, seulement si le service `apiKeys` est présent.
 *
 * Routes nommées `security.apikeys.*` (espace data plane `/nodefony/security/api/*`).
 * **Aucun `bypassFirewall`** : l'aire data plane (session BFF) les garde — c'est
 * voulu (gérer ses clés exige d'être authentifié).
 */
export function mountApiKeyRoutes(frameworkModule: Module): void {
  if (mounted) return;
  const base = "/nodefony/security/api/keys";
  const routes: Array<[string, string, HTTPMethod, string]> = [
    ["security.apikeys.create", base, "POST", "create"],
    ["security.apikeys.list", base, "GET", "list"],
    // AVANT `/{id}` (DELETE) : path littéral distinct, GET — zéro collision
    // (le `{id}` est DELETE-only), mais on le déclare en amont par lisibilité.
    [
      "security.apikeys.capabilities",
      `${base}/capabilities`,
      "GET",
      "capabilities",
    ],
    ["security.apikeys.revoke", `${base}/{id}`, "DELETE", "revoke"],
  ];
  for (const [name, path, method, classMethod] of routes) {
    Router.createRoute(name, {
      path,
      constructor: ApiKeyController as unknown as Controller["constructor"],
      classMethod,
      requirements: { methods: [method] },
    });
  }
  if (
    !Object.prototype.hasOwnProperty.call(ApiKeyController.prototype, "module")
  ) {
    Router.setController(
      ApiKeyController as unknown as Parameters<typeof Router.setController>[0],
      frameworkModule,
    );
  }
  mounted = true;
}

export default ApiKeyController;

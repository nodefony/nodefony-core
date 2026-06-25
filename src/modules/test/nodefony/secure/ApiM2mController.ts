import { RequestContext } from "nodefony";
import type { IUser } from "@nodefony/user";
import { Controller, controller, Get, RequireScope } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";

/**
 * Banc d'intégration de la ZONE API M2M `test-api` (P6 J4) — JWT Bearer only.
 *
 * Tout `/nodefony/test/m2m/*` est capturé par la zone firewall `test-api`
 * (authenticator `jwt`, `stateless`). Sans `Authorization: Bearer <access>`
 * valide, le firewall répond 401 (+ `WWW-Authenticate: Bearer`) AVANT le
 * controller. L'access s'obtient via `POST /nodefony/security/api/token`
 * (grant credential) puis se rejoue en Bearer.
 */
@controller("/nodefony/test/m2m")
class ApiM2mController extends Controller {
  constructor(context: ContextType) {
    super("ApiM2mController", context);
  }

  /** Identité portée par le JWT (sujet résolu par le firewall dans l'ALS). */
  @Get("/whoami")
  whoami() {
    const user = RequestContext.getUser() as IUser | undefined;
    return this.renderJson({
      identifier: user?.identifier ?? null,
      roles: user?.roles ?? [],
      m2m: true,
    });
  }

  /**
   * Banc P6.8 — exige le scope `m2m:read`. Une clé API / un JWT **scopable** sans
   * ce scope → **403** (`ScopeVoter` ABSTAIN → default-DENY) ; avec → 200. Le
   * catalogue de découverte expose donc l'API `m2m`.
   */
  @Get("/scoped/read")
  @RequireScope("m2m:read")
  scopedRead() {
    return this.renderJson({ ok: true, requiredScope: "m2m:read" });
  }

  /**
   * Banc P6.8 — exige `m2m:write` (même API `m2m`, autre action) → montre
   * plusieurs scopes regroupés sous une même API dans le formulaire de clés.
   */
  @Get("/scoped/write")
  @RequireScope("m2m:write")
  scopedWrite() {
    return this.renderJson({ ok: true, requiredScope: "m2m:write" });
  }

  /**
   * Banc P6.8 — exige `reports:export` (autre API `reports`) → 2ᵉ groupe distinct
   * dans le catalogue découvert, démontre le regroupement par préfixe.
   */
  @Get("/scoped/export")
  @RequireScope("reports:export")
  scopedExport() {
    return this.renderJson({ ok: true, requiredScope: "reports:export" });
  }
}

export default ApiM2mController;

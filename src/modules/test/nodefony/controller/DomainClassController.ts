import { Controller, controller, Get, Domain } from "@nodefony/framework";
import { Context } from "@nodefony/http";

/**
 * Démo @Domain niveau CLASSE — restreint TOUT le contrôleur à un vhost.
 *
 * ⚠️ `@Domain` est placé SOUS `@controller` : les décorateurs de classe
 * s'appliquent de bas en haut, et `@controller` construit les routes — il doit
 * voir le domaine de classe déjà posé. Via Host 127.0.0.1 → 403 sur toutes les
 * routes (le serveur sert le domaine, mais le contrôleur est réservé à localhost).
 */
@controller("/nodefony/test/domain-class")
@Domain("localhost")
class DomainClassController extends Controller {
  constructor(context: Context) {
    super("DomainClassController", context);
  }

  async initialize(): Promise<this> {
    return this;
  }

  @Get("/info")
  info() {
    return this.renderJson({ ok: true, scope: "class localhost" });
  }

  @Get("/other")
  other() {
    return this.renderJson({ ok: true, route: "other" });
  }
}

export default DomainClassController;

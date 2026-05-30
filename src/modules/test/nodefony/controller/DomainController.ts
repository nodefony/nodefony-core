import { Controller, controller, Get, Domain } from "@nodefony/framework";
import { Context } from "@nodefony/http";

/**
 * Démo @Domain niveau MÉTHODE + virtual hosting.
 *
 * `localhost` ET `127.0.0.1` passent tous deux la barrière `trustedHosts`
 * (loopback dev) → ils servent de deux vhosts distincts pour prouver le routing
 * par domaine SANS toucher la config (pas besoin d'un vrai vhost externe).
 */
@controller("/nodefony/test/domain")
class DomainController extends Controller {
  constructor(context: Context) {
    super("DomainController", context);
  }

  async initialize(): Promise<this> {
    return this;
  }

  // MÊME path `/vhost`, vhost différent → le Router distingue via @Domain + le
  // fallthrough (route suivante si matchHostname throw). Host localhost → ici.
  @Get("/vhost")
  @Domain("localhost")
  vhostLocalhost() {
    return this.renderJson({ vhost: "localhost", route: "vhostLocalhost" });
  }

  // MÊME path `/vhost`, Host 127.0.0.1 → ici (la route précédente a throw 403 →
  // le Router a continué jusqu'à celle-ci).
  @Get("/vhost")
  @Domain("127.0.0.1")
  vhost127() {
    return this.renderJson({ vhost: "127.0.0.1", route: "vhost127" });
  }

  // Restreinte à localhost. Via Host 127.0.0.1 : le serveur SERT le domaine
  // (passé trustedHosts) mais la route le refuse → 403 (et non 401).
  @Get("/only-localhost")
  @Domain("localhost")
  onlyLocalhost() {
    return this.renderJson({ ok: true, scope: "localhost only" });
  }
}

export default DomainController;

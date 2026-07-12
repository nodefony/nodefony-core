import { RequestContext } from "nodefony";
import { route, controller, Controller } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";

/**
 * UN controller, DEUX protocoles — le différenciateur Nodefony : HTTP et
 * WebSocket sont co-citoyens du même contexte controller, pas deux mondes.
 */
@controller("/api")
class HelloController extends Controller {
  constructor(context: ContextType) {
    super("hello", context);
  }

  @route("route-hello", { path: "/hello", method: "GET" })
  async hello() {
    // Identité résolue par la zone firewall `main` (^/api, session→anonymous,
    // cf nodefony.config.ts) : connecté = ton user, sinon « anonyme ». HORS
    // zone, elle n'est JAMAIS résolue — même avec un cookie de session valide.
    // `IUser.identifier` = l'identifiant fonctionnel (login/email) ; l'anonyme
    // est un VRAI user (AnonymousUser, identifier "anon."), jamais null en zone.
    const user = RequestContext.getUser() as { identifier?: string } | undefined;
    const authenticated = !!user?.identifier && user.identifier !== "anon.";
    return this.renderJson({
      hello: "<%= it.appName %>",
      pid: process.pid,
      who: authenticated ? user!.identifier! : "anonyme",
    });
  }

<% if (it.complete) { %>  /**
   * Route PROTÉGÉE par la zone `secure` (^/api/secure, session SEULE — cf
   * nodefony.config.ts) : sans session, le firewall répond 401 AVANT d'entrer
   * ici. Le controller peut donc supposer un utilisateur authentifié.
   */
  @route("route-secure-hello", { path: "/secure/hello", method: "GET" })
  async secureHello() {
    const user = RequestContext.getUser() as { identifier?: string } | undefined;
    return this.renderJson({
      message: `Bonjour ${user?.identifier ?? "?"}`,
      zone: "secure",
      pid: process.pid,
    });
  }

<% } %>  /**
   * WebSocket natif : `wscat -c ws://127.0.0.1:5151/api/echo` puis tape un
   * message — la réponse repasse par le MÊME pipeline (firewall, audit, logs).
   */
  @route("route-echo", {
    path: "/echo",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async echo(message: string | Buffer | null) {
    if (!message) {
      return this.renderJson({ handshake: true });
    }
    return this.renderJson({ echo: message.toString() });
  }
}

export default HelloController;

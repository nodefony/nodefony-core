import { route, controller, Controller, CurrentUser } from "@nodefony/framework";
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

  // Besoin d'un `await` avant l'action (charger des préférences, ouvrir une
  // ressource) ? C'est `async initialize(): Promise<this>` — le constructeur
  // asynchrone du controller, optionnel. En HTTP il tourne après le firewall
  // (identité résolue) ; en WebSocket avant l'accept du handshake. Détail et
  // pièges : `@nodefony/framework/docs/controller.md` § Cycle de vie.

  @route("route-hello", { path: "/hello", method: "GET" })
  // `@CurrentUser()` injecte l'utilisateur résolu par la zone firewall `main`
  // (^/api, session→anonymous, cf nodefony.config.ts) : connecté = ton user,
  // sinon « anonyme ». HORS zone, il n'est JAMAIS résolu — même avec un cookie
  // de session valide. `identifier` = l'identifiant fonctionnel (login/email) ;
  // l'anonyme est un VRAI user (AnonymousUser, "anon."), jamais null en zone.
  async hello(@CurrentUser() user?: { identifier?: string }) {
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
  async secureHello(@CurrentUser() user?: { identifier?: string }) {
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

import { route, controller, Controller, CurrentUser } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";

/**
 * <%= it.nameClass %> — UN controller, DEUX protocoles (le différenciateur
 * Nodefony) : HTTP et WebSocket sont co-citoyens du même contexte controller,
 * même pipeline (firewall, audit, logs).
 *
 * Généré par `nodefony create controller` — routes montées sous
 * `<%= it.route %>` (couvertes par la zone firewall `^/api` si tu as gardé le
 * manifeste par défaut : identité résolue, jamais bloquante).
 */
@controller("<%= it.route %>")
class <%= it.nameClass %> extends Controller {
  constructor(context: ContextType) {
    super("<%= it.kebab %>", context);
  }

  @route("<%= it.kebab %>-index", { path: "", method: "GET" })
  // `@CurrentUser()` injecte l'utilisateur posé dans l'ALS par le firewall.
  // `identifier` = identifiant fonctionnel ; l'anonyme est un VRAI user
  // (AnonymousUser, identifier "anon."), jamais null en zone firewall.
  async index(@CurrentUser() user?: { identifier?: string }) {
    const authenticated = !!user?.identifier && user.identifier !== "anon.";
    return this.renderJson({
      controller: "<%= it.kebab %>",
      pid: process.pid,
      who: authenticated ? user!.identifier! : "anonyme",
    });
  }

  /**
   * WebSocket natif : `wscat -c wss://127.0.0.1:5152<%= it.route %>/echo`
   * puis tape un message — la réponse repasse par le MÊME pipeline.
   */
  @route("<%= it.kebab %>-echo", {
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

export default <%= it.nameClass %>;

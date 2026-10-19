import { route, controller, Controller } from "@nodefony/framework";
import type { RouteInput } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import { <%= it.camel %>Gate } from "../mcp/<%= it.kebab %>-gate";

/**
 * <%= it.nameClass %> — la porte Model Context Protocol de l'application : celle
 * par laquelle un agent IA appelle les outils qu'elle décide de lui offrir.
 *
 * Une porte MCP EST un controller : une route `POST <%= it.route %>`, rien de
 * plus. Tout le protocole — négociation de version, catalogue, appel d'outil,
 * progression sur flux SSE, annulation, gardes de transport<% if (it.oauth) { %>, jeton OAuth<% } %> —
 * est tenu par la porte définie dans `../mcp/<%= it.kebab %>-gate.ts`
 * (`defineMcpGate`, `@nodefony/ai`). Cette classe ne fait que la servir : n'y
 * écris aucune ligne de protocole, et n'y ajoute aucun contrôle d'accès — il
 * vit dans la définition de la porte.
 *
 * Pour offrir un outil de plus, ajoute-le à `../mcp/<%= it.kebab %>-tools.ts` :
 * la porte le publie au prochain démarrage.
 *
 * ```bash
 * curl -s<% if (it.oauth) { %> -H "authorization: Bearer $JETON"<% } %> http://localhost:5151<%= it.route %> \
 *   -H 'content-type: application/json' \
 *   -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"<%= it.toolPrefix %>_echo","arguments":{"text":"bonjour"}}}'
 * ```
 */
@controller("<%= it.route %>")
class <%= it.nameClass %> extends Controller {
  constructor(context: ContextType) {
    super("<%= it.kebab %>", context);
  }

  /**
   * `POST` sert un message MCP ; `GET` et `DELETE` répondent `405` + `Allow:
   * POST` — verbes retirés par la révision `2026-07-28` du transport. Sans
   * eux, la requête tomberait sur une autre route, et un client qui reçoit
   * autre chose qu'un `405` rouvre sa connexion indéfiniment.
   */
  // `requirements.methods`, pas l'option `method` : seule la première
  // restreint la correspondance de la route.
  @route("<%= it.kebab %>-mcp", {
    path: "",
    requirements: { methods: ["POST", "GET", "DELETE"] },
    // Schéma VIDE : l'action reçoit l'entrée brute — la porte MCP valide
    // elle-même la trame JSON-RPC et répond dans SON protocole, pas en 422.
    schema: {},
  })
  mcp(input: RouteInput) {
    return <%= it.camel %>Gate.serve(this, input.body);
  }
}

export default <%= it.nameClass %>;

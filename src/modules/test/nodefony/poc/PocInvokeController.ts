import { Controller, route, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";

/**
 * POC « API souveraine » — Phase 1 — ÉCHAFAUDAGE JETABLE (mais valide la BRIQUE).
 *
 * Le **pont WS-RPC `invoke`** : une socket connectée ici reçoit des messages
 * `{ id, path }` et le serveur RE-ROUTE le path **porté par le message** (pas
 * l'URL de connexion) vers l'action correspondante via `router.resolve(context,
 * path)` — le `cleanPathOverride` ajouté au Router. Prouve « 1 socket → N actions »
 * et la convergence avec REST : la MÊME action ({@link PocBookController.byAuthor})
 * est atteinte, avec les mêmes `@Param`, sans la réécrire.
 *
 * Protocole minimal maison (req/resp `id`) — en Phase 1 on n'ajoute PAS
 * `@nodefony/realtime` comme dépendance du module test. Le pont GÉNÉRIQUE de prod
 * (réutilisant `JsonRpcPeer`) sera promu dans realtime / `ResourceController`
 * en Phase 6 si la thèse tient.
 */
@controller("/poc/invoke")
class PocInvokeController extends Controller {
  constructor(context: Context) {
    super("PocInvokeController", context);
  }

  @route("poc-invoke", {
    path: "",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async invoke(message: string | Buffer | null) {
    // Handshake (connexion) : l'action reçoit `null` → on confirme le canal.
    if (message == null) {
      return this.renderJson({ handshake: true });
    }
    let id: unknown;
    let path: string;
    try {
      const payload = JSON.parse(message.toString()) as {
        id?: unknown;
        path?: string;
      };
      id = payload.id;
      path = payload.path ?? "";
    } catch {
      return this.renderJson({ error: "invalid json" });
    }
    const ctx = this.context;
    const router = ctx?.router;
    if (!ctx || !router) {
      return this.renderJson({ id, error: "router unavailable" });
    }
    // resolveByPath : route le path DU MESSAGE (cleanPathOverride), pas l'URL de
    // connexion (/poc/invoke). Aucune mutation de l'état de la connexion.
    const resolver = router.resolve(ctx, path);
    if (!resolver.resolve) {
      return this.renderJson({ id, error: "not found", path });
    }
    // executeAction (PAS callController) : récupère la VALEUR de l'action sans la
    // rendre sur le transport (callController auto-enverrait le brut via
    // returnController → on perdrait l'enveloppe {id,result}). C'est le seam
    // multi-transport découvert en Phase 1.
    // `reload = true` IMPÉRATIF : le container partagé porte déjà CE controller
    // (PocInvokeController) sous "controller" → sans reload, on réutiliserait
    // l'instance courante (sans `byAuthor`) → "Route Action not found".
    const { result } = await resolver.executeAction(undefined, true);
    return this.renderJson({ id, result, path });
  }
}

export default PocInvokeController;

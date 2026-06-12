import { Controller, route, controller, Param } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import { pocBookService } from "./pocBookService";

/**
 * POC « API souveraine » — Phase 1 — ÉCHAFAUDAGE JETABLE.
 *
 * L'action `byAuthor` est écrite **UNE fois**. Elle ne voit AUCUNE information de
 * transport : juste un `@Param` normalisé. Elle est joignable par :
 *  - REST   : `GET /poc/books/by-author/42`
 *  - WS-RPC : via {@link PocInvokeController} qui re-route le même path
 *
 * `methods: ["GET", "WEBSOCKET"]` déclare explicitement les 2 portes acceptées —
 * `matchRequirements` (Route) exige que le transport invoquant figure ici.
 * Retour **brut** (pas de `renderJson`) → REST l'auto-JSON, le pont WS l'enveloppe.
 */
@controller("/poc/books")
class PocBookController extends Controller {
  constructor(context: Context) {
    super("PocBookController", context);
  }

  @route("poc-books-by-author", {
    path: "/by-author/{authorId}",
    requirements: { methods: ["GET", "WEBSOCKET"] },
  })
  byAuthor(@Param("authorId") authorId: string) {
    return pocBookService.byAuthor(authorId);
  }
}

export default PocBookController;

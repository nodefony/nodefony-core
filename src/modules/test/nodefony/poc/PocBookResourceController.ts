import {
  ResourceController,
  route,
  controller,
  Param,
  Query,
} from "@nodefony/framework";
import { Context } from "@nodefony/http";
import { pocBookResourceService, PocBook } from "./pocBookService";

/**
 * POC « API souveraine » — Phase 2 (V4.2) — le premier client RÉEL du modèle
 * stateless + singleton :
 *
 * - `ResourceController` → `static scope = "singleton"` HÉRITÉ (aucun
 *   décorateur ici — c'est le défaut de la classe de base qui est testé) :
 *   UNE instance pour toutes les requêtes (`instances` le prouve).
 * - actions 100 % stateless : arguments décorés + helpers hérités (qui
 *   retrouvent la requête courante via l'ALS V4.1) — jamais `this.x = …`.
 * - mêmes actions joignables en REST (`GET /poc/r-books/*`) et via le pont
 *   WS-RPC `invoke` (`methods: ["GET", "WEBSOCKET"]`) — valeur brute
 *   retournée, chaque porte l'emballe à sa façon.
 *
 * `/meta/stats` est la sonde d'intégration anti-data-race : elle renvoie le
 * `requestId` lu par l'instance PARTAGÉE via l'ALS, après un délai optionnel —
 * le test compare au header `X-Request-Id` de la réponse : un bleed entre
 * requêtes concurrentes ferait diverger les deux.
 */
@controller("/poc/r-books")
class PocBookResourceController extends ResourceController<PocBook> {
  /** Compteur de constructions — l'intégration assert `=== 1` (singleton). */
  static instances = 0;

  constructor(context: Context) {
    super("PocBookResourceController", context, pocBookResourceService);
    PocBookResourceController.instances++;
  }

  @route("poc-rbooks-list", {
    path: "",
    requirements: { methods: ["GET", "WEBSOCKET"] },
  })
  list(@Query("authorId") authorId?: string) {
    // Filtrage EXPOSÉ explicitement (deny-by-default : seul `authorId` passe).
    return this.listResource(authorId !== undefined ? { authorId } : undefined);
  }

  @route("poc-rbooks-get", {
    path: "/{id}",
    requirements: { methods: ["GET", "WEBSOCKET"] },
  })
  detail(@Param("id") id: string) {
    return this.getResource(id);
  }

  @route("poc-rbooks-stats", {
    path: "/meta/stats",
    requirements: { methods: ["GET"] },
  })
  stats(@Query("delay") delay?: string) {
    const ms = delay ? Number(delay) : 0;
    const snapshot = () => ({
      instances: PocBookResourceController.instances,
      // Lu au moment de la RÉPONSE (après le délai) sur l'instance partagée :
      // doit toujours être le requestId de CETTE requête (ALS), pas d'un voisin.
      requestId: this.context?.requestId ?? null,
      routeName: this.route?.name ?? null,
    });
    if (!ms) {
      return snapshot();
    }
    return new Promise((resolve) => setTimeout(() => resolve(snapshot()), ms));
  }
}

export default PocBookResourceController;

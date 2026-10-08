import { Controller, route, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import { RequestContext } from "nodefony";

/**
 * Ce que le banc relit après coup : combien de flux se sont fermés côté
 * serveur, et si l'écouteur de fermeture voyait encore la requête dans l'ALS
 * (la fermeture par le client part de la socket, hors de la bulle).
 */
export const sseState = {
  opened: 0,
  closed: 0,
  closeSawRequestId: [] as Array<string | null>,
};

/**
 * Banc des flux d'événements serveur (SSE) — `/nodefony/test/sse/*`.
 *
 * Prouve sur le serveur réel, en HTTP/1.1 (5151) ET HTTP/2 (5152), ce que
 * `renderSse()` promet : ordre des événements, fermeture par le serveur,
 * nettoyage au départ du client, négociation JSON/flux sur la même route.
 */
@controller("/nodefony/test/sse")
class SseController extends Controller {
  constructor(context: Context) {
    super("SseController", context);
  }

  /** Trois événements (data, type, identifiant), puis fermeture par le serveur. */
  @route("sse-three", { path: "/three" })
  async three() {
    const sse = await this.renderSse({ heartbeat: false });
    await sse.send("un", { id: "1" });
    await sse.send({ n: 2 }, { event: "maj", id: "2" });
    await sse.send("trois\nlignes", { id: "3" });
    return sse.close();
  }

  /**
   * Un flux tenu ouvert jusqu'au départ du client : le banc vérifie que la
   * fermeture est VUE côté serveur, en HTTP/2 comme en HTTP/1.1. En `POST`
   * aussi : en HTTP/1.1 la REQUÊTE a déjà émis `close` quand l'action s'exécute
   * (corps lu, Node ≥ 16) — un flux qui l'écouterait ne verrait JAMAIS le client
   * partir, et battrait dans une socket morte.
   */
  @route("sse-hold", {
    path: "/hold",
    requirements: { methods: ["GET", "POST"] },
  })
  async hold() {
    const sse = await this.renderSse({ heartbeat: 50 });
    sseState.opened++;
    sse.onClose(() => {
      sseState.closed++;
      sseState.closeSawRequestId.push(RequestContext.getRequestId() ?? null);
      // Bornée : le gate mémoire ouvre des centaines de flux, et une sonde qui
      // grossit à chaque itération se lirait comme une fuite du pipeline.
      if (sseState.closeSawRequestId.length > 16)
        sseState.closeSawRequestId.shift();
    });
    await sse.send("prêt", { event: "ready" });
  }

  /** Même route, deux réponses : JSON, ou flux quand le client le demande. */
  @route("sse-negotiate", {
    path: "/negotiate",
    requirements: { methods: ["POST"] },
  })
  async negotiate() {
    if (!this.acceptsSse()) return { mode: "json" };
    const sse = await this.renderSse({ heartbeat: false });
    await sse.send({ mode: "flux" });
    return sse.close();
  }

  /** État relu par le banc. */
  @route("sse-state", { path: "/state" })
  state() {
    return { ...sseState };
  }

  /** Remise à zéro entre deux cas. */
  @route("sse-reset", { path: "/reset" })
  reset() {
    sseState.opened = 0;
    sseState.closed = 0;
    sseState.closeSawRequestId = [];
    return { ...sseState };
  }
}

export default SseController;

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

  /**
   * Banc d'ATTAQUE : renvoie dans le flux ce que la requête lui donne, et
   * publie chaque refus de l'API dans un événement `refused` (nom de l'erreur).
   * Paramètres : `event`, `id`, `data`, `comment`, `retry`, `kind`
   * (`circular` · `bigint` · `undefined`), `after` (`send` après `close()`).
   */
  @route("sse-echo", { path: "/echo" })
  async echo() {
    // Les paramètres se LISENT comme des chaînes, jamais par conversion de type.
    const query = this.queryGet;
    const param = (name: string): string | undefined => {
      const value = query[name];
      return typeof value === "string" ? value : undefined;
    };
    const q = {
      event: param("event"),
      id: param("id"),
      data: param("data"),
      comment: param("comment"),
      retry: param("retry"),
      kind: param("kind"),
      after: param("after"),
    };
    const sse = await this.renderSse({ heartbeat: false });
    const attempt = async (step: () => unknown): Promise<void> => {
      try {
        await step();
      } catch (error) {
        const name = error instanceof Error ? error.name : "unknown";
        await sse.send(name, { event: "refused" });
      }
    };
    if (q.retry !== undefined) await attempt(() => sse.retry(Number(q.retry)));
    if (q.comment !== undefined) await attempt(() => sse.comment(q.comment));
    if (q.kind !== undefined) {
      const values: Record<string, unknown> = {
        bigint: 1n,
        undefined,
        circular: (() => {
          const o: Record<string, unknown> = {};
          o.self = o;
          return o;
        })(),
      };
      const kind = q.kind;
      await attempt(() => sse.send(values[kind]));
    }
    if (q.data !== undefined || q.event !== undefined || q.id !== undefined) {
      await attempt(() => sse.send(q.data ?? "", { event: q.event, id: q.id }));
    }
    await sse.send("fin", { event: "end" });
    await sse.close();
    if (q.after !== undefined) {
      // Après fermeture : ni exception, ni écriture.
      await attempt(() => sse.send("trop tard"));
      await sse.close();
    }
  }

  /**
   * Banc des BORNES d'un flux : `stall` (ms, délai de blocage d'écriture),
   * `max` (octets, taille d'un événement), `duration` (ms, durée de vie). Avec
   * `flood=1`, écrit des événements de 64 Kio sans fin en attendant chaque
   * `drain` : un client qui ne lit plus doit être COUPÉ, pas laissé pendre.
   * Avec `big=<n>`, tente un événement de `n` caractères.
   */
  @route("sse-limits", { path: "/limits" })
  async limits() {
    const query = this.queryGet;
    const num = (name: string): number | undefined => {
      const value = query[name];
      return typeof value === "string" ? Number(value) : undefined;
    };
    const sse = await this.renderSse({
      heartbeat: false,
      stallTimeout: num("stall"),
      maxEventBytes: num("max"),
      maxDuration: num("duration"),
    });
    sseState.opened++;
    sse.onClose(() => {
      sseState.closed++;
    });
    await sse.send("prêt", { event: "ready" });
    const big = num("big");
    if (big !== undefined) {
      try {
        await sse.send("x".repeat(big));
      } catch (error) {
        const name = error instanceof Error ? error.name : "unknown";
        await sse.send(name, { event: "refused" });
      }
    }
    if (query.flood === "1") {
      const chunk = "y".repeat(65_536);
      while (!sse.closed) await sse.send(chunk);
    }
  }

  /**
   * Déclenche la re-validation des flux à identité révocable — ce que le tick
   * du noyau fait toutes les 30 s —, pour un banc déterministe.
   */
  @route("sse-revalidate", { path: "/revalidate" })
  async revalidate() {
    await this.context?.httpKernel?.revalidateStreams();
    return { ...sseState };
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

/**
 * Le même flux DERRIÈRE le pare-feu : `/nodefony/test/secure/*` tombe dans la
 * zone `test-secure` (session BFF ou Basic). Éprouve sur un flux ce que la
 * zone impose à toute requête — anonyme refusé, CSRF sur la mutation — et ce
 * qu'elle impose à une connexion LONGUE : la fermeture à la révocation.
 */
@controller("/nodefony/test/secure/sse")
class SecureSseController extends Controller {
  constructor(context: Context) {
    super("SecureSseController", context);
  }

  /** Tenu ouvert ; `GET` et `POST` (la mutation passe par le CSRF). */
  @route("secure-sse-hold", {
    path: "/hold",
    requirements: { methods: ["GET", "POST"] },
  })
  async hold() {
    const sse = await this.renderSse({ heartbeat: 50 });
    sseState.opened++;
    sse.onClose(() => {
      sseState.closed++;
    });
    await sse.send("prêt", { event: "ready" });
  }
}

export { SecureSseController };
export default SseController;

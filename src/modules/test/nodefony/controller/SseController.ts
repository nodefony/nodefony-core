import { Controller, route, controller, UseSession } from "@nodefony/framework";
import { Context, HttpContext } from "@nodefony/http";
import { RequestContext } from "nodefony";

/** Ce que la route de révocation lit du store de jetons. */
interface IJtiDenier {
  denyJti(jti: string, expiresAt: number): Promise<void>;
}

/** Garde de type : le service porte-t-il `denyJti` ? */
function isJtiDenier(value: unknown): value is IJtiDenier {
  return (
    typeof value === "object" &&
    value !== null &&
    "denyJti" in value &&
    typeof value.denyJti === "function"
  );
}

/**
 * Ce que le banc relit après coup : combien de flux se sont fermés côté
 * serveur, et si l'écouteur de fermeture voyait encore la requête dans l'ALS
 * (la fermeture par le client part de la socket, hors de la bulle).
 *
 * Les trois derniers champs servent la table de parité du cycle de vie
 * (`http/tests/http/streamLifecycle.test.ts`) : la réponse est-elle PRISE dès
 * le retour de l'ouverture, combien de fois le contexte s'est-il terminé, et
 * quel statut a refusé une seconde ouverture.
 */
export const sseState = {
  opened: 0,
  closed: 0,
  closeSawRequestId: [] as Array<string | null>,
  sendedAtOpen: null as boolean | null,
  contextClosed: 0,
  refusedStatus: null as number | null,
};

/** La réponse est-elle prise ? `null` hors contexte HTTP. */
function sendedOf(context: Context | undefined): boolean | null {
  return context instanceof HttpContext ? context.sended : null;
}

/** Statut porté par une erreur levée à l'ouverture — `null` s'il n'y en a pas. */
function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("code" in error))
    return null;
  return typeof error.code === "number" ? error.code : null;
}

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
    sseState.sendedAtOpen = sendedOf(this.context);
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

  /**
   * Fin par le SERVEUR, demandée deux fois : le flux ne se termine qu'une
   * fois, et le contexte aussi (`contextClosed`).
   */
  @route("sse-end", { path: "/end" })
  async end() {
    this.context?.on("onClose", () => {
      sseState.contextClosed++;
    });
    const sse = await this.renderSse({ heartbeat: false });
    sseState.opened++;
    sse.onClose(() => {
      sseState.closed++;
    });
    await sse.send("prêt", { event: "ready" });
    await sse.close();
    await sse.close();
  }

  /**
   * Session active : la valeur `v` posée AVANT l'ouverture doit être sauvée,
   * et son cookie partir avec les en-têtes du flux — après, plus rien ne
   * pourrait les toucher.
   */
  @route("sse-session", { path: "/session" })
  @UseSession()
  async withSession() {
    const value = this.query.v;
    this.session?.set("parity", typeof value === "string" ? value : null);
    const sse = await this.renderSse({ heartbeat: false });
    await sse.send("prêt", { event: "ready" });
    return sse.close();
  }

  /**
   * Seconde ouverture sur une réponse déjà prise : refusée (500), sans
   * toucher au premier flux, qui se termine normalement.
   */
  @route("sse-taken", { path: "/taken" })
  async taken() {
    const sse = await this.renderSse({ heartbeat: false });
    try {
      await this.renderSse({ heartbeat: false });
      sseState.refusedStatus = 0;
    } catch (error) {
      sseState.refusedStatus = statusOf(error);
    }
    await sse.send("prêt", { event: "ready" });
    return sse.close();
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
    const query = this.query;
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
    const query = this.query;
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

  /**
   * Révoque un jeton par son `jti` (liste de refus du store de jetons), puis
   * déclenche la re-validation : ce que le tick du noyau ferait dans la
   * fenêtre suivante. Décor du banc `grpc-context.test.ts` (#695, critère 31).
   */
  @route("sse-revoke", { path: "/revoke" })
  async revoke() {
    const jti =
      this.context instanceof HttpContext
        ? this.context.request.url.searchParams.get("jti")
        : null;
    if (jti === null || jti === "") return { revoked: false };
    const store: unknown = this.get("tokenStore");
    if (!isJtiDenier(store)) return { revoked: false };
    await store.denyJti(jti, Date.now() + 3_600_000);
    await this.context?.httpKernel?.revalidateStreams();
    return { revoked: true };
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
    sseState.sendedAtOpen = null;
    sseState.contextClosed = 0;
    sseState.refusedStatus = null;
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

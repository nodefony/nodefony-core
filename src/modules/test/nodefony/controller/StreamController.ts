import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { Controller, route, controller, UseSession } from "@nodefony/framework";
import {
  Context,
  HttpContext,
  HttpError,
  type ByteStreamEndReason,
  type IByteStreamOptions,
  type IByteStreamResult,
} from "@nodefony/http";
import { RequestContext, type Pdu } from "nodefony";

/**
 * Ce que le banc relit après coup. Les six premiers champs sont ceux de la
 * table de parité du cycle de vie (`http/tests/http/streamLifecycle.test.ts`),
 * les mêmes que `sseState` ; les suivants sont propres au flux d'octets.
 */
export const streamState = {
  opened: 0,
  closed: 0,
  closeSawRequestId: [] as Array<string | null>,
  sendedAtOpen: null as boolean | null,
  contextClosed: 0,
  refusedStatus: null as number | null,
  /** Raisons passées à `onClose`, dans l'ordre. */
  reasons: [] as ByteStreamEndReason[],
  /** Ce qu'a rendu la promesse du dernier flux. */
  lastResult: null as IByteStreamResult | null,
  /** La source du dernier flux a-t-elle été détruite ? */
  sourceDestroyed: null as boolean | null,
  /** Le producteur enfant (`/child`) est-il sorti ? */
  childExited: null as boolean | null,
  /**
   * Sources tenues (`heldSource`) encore VIVANTES. Jamais remis à zéro : c'est
   * un fait, pas un compteur de cas — une source refusée et jamais détruite y
   * reste, et c'est ce que le banc du plafond par IP relit.
   */
  liveSources: 0,
  /** Écritures de la session du dernier `/fail-session` (`session.save`). */
  sessionWrites: null as number | null,
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
 * Une source tenue ouverte : `first` tout de suite (`null` : rien), puis un point toutes les
 * `every` ms (0 : plus rien). Sa destruction est relevée dans l'état.
 */
function heldSource(first: string | null, every: number): Readable {
  let timer: ReturnType<typeof setInterval> | null = null;
  const source = new Readable({
    read() {
      // Les morceaux sont poussés par le minuteur, pas à la demande.
    },
    destroy(error, callback) {
      if (timer !== null) clearInterval(timer);
      streamState.sourceDestroyed = true;
      streamState.liveSources--;
      callback(error);
    },
  });
  streamState.liveSources++;
  if (first !== null) source.push(first);
  if (every > 0) timer = setInterval(() => source.push("."), every);
  return source;
}

/** Une source finie, dont la destruction est relevée. */
function finiteSource(chunks: string[]): Readable {
  const source = Readable.from(chunks, { objectMode: false });
  source.once("close", () => {
    streamState.sourceDestroyed = true;
  });
  return source;
}

/**
 * Banc du flux d'octets (`renderStream`) — `/nodefony/test/stream/*`.
 *
 * Même vocabulaire de routes que le banc SSE pour la table de parité
 * (`hold`, `end`, `session`, `taken`, `limits`, `state`, `reset`), puis les
 * cas propres aux octets : erreur de la source avant et après le premier
 * morceau, source muette, producteur bloqué en écriture, relais `fetch`,
 * source déjà finie.
 */
@controller("/nodefony/test/stream")
class StreamController extends Controller {
  constructor(context: Context) {
    super("StreamController", context);
  }

  /** Ouvre le flux et relève sa fin dans l'état. */
  #open(
    source: Readable | ReadableStream<Uint8Array>,
    options: IByteStreamOptions = {},
  ): Promise<IByteStreamResult> {
    streamState.sourceDestroyed = false;
    const done = this.renderStream(source, {
      ...options,
      onClose: (reason) => {
        streamState.closed++;
        streamState.reasons.push(reason);
        if (streamState.reasons.length > 16) streamState.reasons.shift();
        streamState.closeSawRequestId.push(
          RequestContext.getRequestId() ?? null,
        );
        // Bornée : le gate mémoire ouvre des centaines de flux.
        if (streamState.closeSawRequestId.length > 16)
          streamState.closeSawRequestId.shift();
      },
    });
    streamState.sendedAtOpen = sendedOf(this.context);
    streamState.opened++;
    return done.then((result) => {
      streamState.lastResult = result;
      return result;
    });
  }

  /** Tenu ouvert jusqu'au départ du client : un point toutes les 50 ms. */
  @route("stream-hold", { path: "/hold" })
  hold() {
    return this.#open(heldSource("prêt", 50));
  }

  /** La source se termine : fin propre, contexte terminé une fois. */
  @route("stream-end", { path: "/end" })
  end() {
    this.context?.on("onClose", () => {
      streamState.contextClosed++;
    });
    return this.#open(finiteSource(["prêt", " fin"]), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  /** Session active : la valeur posée AVANT l'ouverture part avec les en-têtes. */
  @route("stream-session", { path: "/session" })
  @UseSession()
  withSession() {
    const value = this.query.v;
    this.session?.set("parity", typeof value === "string" ? value : null);
    return this.#open(finiteSource(["prêt"]));
  }

  /** Seconde ouverture sur une réponse déjà prise : refusée (500). */
  @route("stream-taken", { path: "/taken" })
  taken() {
    const first = this.#open(finiteSource(["prêt"]));
    try {
      void this.renderStream(Readable.from([], { objectMode: false }));
      streamState.refusedStatus = 0;
    } catch (error) {
      streamState.refusedStatus = statusOf(error);
    }
    return first;
  }

  /**
   * Bornes : `stall` (ms), `duration` (ms), `idle` (ms, `idleTimeout`). Avec
   * `flood=1`, la source pousse 64 Kio sans fin ; sinon elle se tait après
   * son premier morceau (`silent=1` : avant même lui).
   */
  @route("stream-limits", { path: "/limits" })
  limits() {
    const query = this.query;
    const num = (name: string): number | undefined => {
      const value = query[name];
      return typeof value === "string" ? Number(value) : undefined;
    };
    let source: Readable;
    if (query.flood === "1") {
      const chunk = Buffer.alloc(65_536, 0x79);
      source = new Readable({
        read() {
          this.push(chunk);
        },
      });
      source.once("close", () => {
        streamState.sourceDestroyed = true;
      });
    } else if (query.silent === "1") {
      source = heldSource(null, 0);
    } else {
      source = heldSource("prêt", 0);
    }
    return this.#open(source, {
      stallTimeout: num("stall"),
      maxDuration: num("duration"),
      idleTimeout: num("idle"),
    });
  }

  /**
   * La source échoue : `when=before` avant tout morceau, `when=after` après
   * le premier. `status=502` lève une `HttpError(502)`, sinon une erreur nue.
   */
  @route("stream-fail", { path: "/fail" })
  fail() {
    return this.#failingSource();
  }

  /**
   * La source échoue AVANT son premier morceau sur une requête qui porte une
   * session mutée. Elle est sauvée deux fois — à l'ouverture du flux, puis par
   * l'envoi de la page d'erreur — et ne doit être ÉCRITE qu'une fois.
   */
  @route("stream-fail-session", { path: "/fail-session" })
  @UseSession()
  failSession() {
    const session = this.session;
    if (session) {
      session.set("stream-fail", Date.now());
      const save = session.save.bind(session);
      streamState.sessionWrites = 0;
      session.save = (...args: Parameters<typeof save>) => {
        streamState.sessionWrites = (streamState.sessionWrites ?? 0) + 1;
        return save(...args);
      };
    }
    return this.#failingSource();
  }

  /** La source de `/fail` et `/fail-session`, réglée par la requête. */
  #failingSource() {
    const query = this.query;
    const error =
      query.status === "502"
        ? new HttpError("Amont injoignable", 502)
        : new Error("EACCES: la source a échoué");
    const after = query.when === "after";
    const source = new Readable({
      read() {
        // Poussé par le minuteur.
      },
    });
    source.once("close", () => {
      streamState.sourceDestroyed = true;
    });
    if (after) source.push("prêt");
    setTimeout(() => source.destroy(error), after ? 100 : 20);
    return this.#open(source);
  }

  /**
   * En-tête refusé par Node (fin de ligne dans la valeur) : il ne part qu'au
   * premier morceau, depuis un écouteur de la source — l'échec doit rendre une
   * page d'erreur, jamais abattre le processus.
   */
  @route("stream-bad-header", { path: "/bad-header" })
  badHeader() {
    return this.#open(finiteSource(["prêt"]), {
      headers: { "x-injected": "a\r\nset-cookie: volé=1" },
    });
  }

  /** Source déjà finie à l'appel : `kind=empty` (vide) ou `destroyed`. */
  @route("stream-finished", { path: "/finished" })
  finished() {
    if (this.query.kind === "destroyed") {
      const source = new Readable({ read() {} });
      source.destroy();
      return this.#open(source);
    }
    return this.#open(finiteSource([]));
  }

  /**
   * Producteur BLOQUÉ en écriture : un enfant Node qui écrit sans fin par
   * `fs.writeSync(1, …)`, comme ffmpeg. Aucun `kill` sur la fin du flux : seule
   * la destruction de sa sortie doit le libérer (EPIPE). Un filet tue l'enfant
   * au bout de 15 s pour ne jamais laisser d'orphelin au banc.
   */
  @route("stream-child", { path: "/child" })
  child() {
    const code =
      "const fs=require('node:fs');const b=Buffer.alloc(65536,120);" +
      "for(;;){fs.writeSync(1,b);}";
    const producer = spawn(process.execPath, ["-e", code], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    streamState.childExited = false;
    const net = setTimeout(() => producer.kill("SIGKILL"), 15_000);
    net.unref();
    producer.stdout.once("close", () => {
      streamState.sourceDestroyed = true;
    });
    producer.once("exit", () => {
      clearTimeout(net);
      streamState.childExited = true;
    });
    return this.#open(producer.stdout);
  }

  /** Relais d'un autre service : `port` d'un amont HTTP local. */
  @route("stream-relay", { path: "/relay" })
  async relay() {
    const port = Number(this.query.port);
    const r = await fetch(`http://127.0.0.1:${port}/`, {
      signal: this.context?.signal ?? null,
    });
    if (!r.ok || r.body === null) throw new HttpError("Amont", 502);
    return this.#open(r.body, {
      headers: {
        "content-type":
          r.headers.get("content-type") ?? "application/octet-stream",
      },
    });
  }

  /**
   * Repère du journal : l'identifiant de la dernière entrée de l'anneau. Le
   * banc le relève AVANT un cas, puis relit ce qui a été écrit depuis.
   */
  @route("stream-journal-mark", { path: "/journal/mark" })
  journalMark() {
    const ring = this.kernel?.syslog?.ringStack ?? [];
    return { uid: ring.length === 0 ? 0 : (ring[ring.length - 1]?.uid ?? 0) };
  }

  /** Entrées de l'anneau du journal postérieures à `since`, toutes sévérités. */
  @route("stream-journal", { path: "/journal" })
  journal() {
    const since = Number(this.query.since ?? 0);
    const ring: Pdu[] = this.kernel?.syslog?.ringStack ?? [];
    return ring
      .filter((pdu) => pdu.uid > since)
      .map((pdu) => {
        const payload: unknown = pdu.payload;
        return {
          severity: pdu.severityName,
          msgid: pdu.msgid,
          text:
            typeof payload === "string"
              ? payload
              : payload instanceof Error
                ? `${payload.name}: ${payload.message}`
                : `[${pdu.typePayload ?? typeof payload}]`,
        };
      });
  }

  /** État relu par le banc. */
  @route("stream-state", { path: "/state" })
  state() {
    return { ...streamState };
  }

  /** Remise à zéro entre deux cas. */
  @route("stream-reset", { path: "/reset" })
  reset() {
    streamState.opened = 0;
    streamState.closed = 0;
    streamState.closeSawRequestId = [];
    streamState.sendedAtOpen = null;
    streamState.contextClosed = 0;
    streamState.refusedStatus = null;
    streamState.reasons = [];
    streamState.lastResult = null;
    streamState.sourceDestroyed = null;
    streamState.childExited = null;
    streamState.sessionWrites = null;
    return { ...streamState };
  }
}

/**
 * Le même flux DERRIÈRE le pare-feu : `/nodefony/test/secure/*` tombe dans la
 * zone `test-secure`. Éprouve sur le flux d'octets ce que la zone impose à
 * une connexion LONGUE — anonyme refusé, fermeture à la révocation — comme
 * `SecureSseController` pour le SSE.
 */
@controller("/nodefony/test/secure/stream")
class SecureStreamController extends Controller {
  constructor(context: Context) {
    super("SecureStreamController", context);
  }

  /** Tenu ouvert ; `GET` et `POST` (la mutation passe par le CSRF). */
  @route("secure-stream-hold", {
    path: "/hold",
    requirements: { methods: ["GET", "POST"] },
  })
  hold() {
    const done = this.renderStream(heldSource("prêt", 50), {
      onClose: () => {
        streamState.closed++;
      },
    });
    streamState.opened++;
    return done;
  }
}

export { SecureStreamController };
export default StreamController;

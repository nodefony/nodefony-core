import diagnosticsChannel from "node:diagnostics_channel";
import type { TracingChannelSubscribers } from "node:diagnostics_channel";
import { Controller, controller, Get, Query } from "@nodefony/framework";
import { Context, REQUEST_TRACE_CHANNEL } from "@nodefony/http";
import type { IRequestTrace, IRpcOutcome } from "@nodefony/http";

/** Sous-canal d'un `TracingChannel`, dans l'ordre où il est publié. */
type TraceEventName = "start" | "end" | "asyncStart" | "asyncEnd" | "error";

/** Ce que l'abonné de la sonde a vu à UN événement — copie, pas référence. */
interface ITraceSnapshot {
  readonly event: TraceEventName;
  readonly protocol: IRequestTrace["protocol"];
  readonly method: IRequestTrace["method"];
  readonly scheme: IRequestTrace["scheme"];
  readonly url: string;
  readonly route: string | null;
  readonly routePath: string | null;
  readonly module: string | null;
  readonly statusCode: number | null;
  readonly durationMs: number | null;
  readonly error: string | null;
  /** Appel RPC : copie des quatre champs publiés, `null` hors RPC (ADR-0026 D10). */
  readonly rpc: IRpcOutcome | null;
  /** Le message est-il le MÊME objet que celui reçu à `start` ? */
  readonly sameObject: boolean;
}

/** Requêtes gardées au plus : la sonde ne doit rien retenir sans borne. */
const KEPT_REQUESTS = 128;
const seen = new Map<string, ITraceSnapshot[]>();
const firstMessage = new Map<string, IRequestTrace>();
/**
 * Banc qui détient la sonde (`/lock`), `null` = libre. UN seul à la fois : les suites
 * de deux paquets tournent en parallèle contre le même serveur, et le
 * désarmement de l'une coupait l'abonnement de l'autre en plein cas.
 * L'exclusion est voulue — « une requête commencée avant l'abonnement n'émet
 * rien » n'a de sens qu'avec un SEUL abonné dans le process.
 */
let owner: string | null = null;
let armed = false;

/** Nom de banc lisible et borné : il revient dans le refus. */
const OWNER_PATTERN = /^[\w:.-]{1,64}$/u;

const record = (event: TraceEventName, message: IRequestTrace): void => {
  let events = seen.get(message.requestId);
  if (events === undefined) {
    if (seen.size >= KEPT_REQUESTS) {
      const oldest = seen.keys().next();
      if (!oldest.done) {
        seen.delete(oldest.value);
        firstMessage.delete(oldest.value);
      }
    }
    events = [];
    seen.set(message.requestId, events);
    firstMessage.set(message.requestId, message);
  }
  const { error } = message;
  events.push({
    event,
    protocol: message.protocol,
    method: message.method,
    scheme: message.scheme,
    url: message.url,
    route: message.route,
    routePath: message.routePath,
    module: message.module,
    statusCode: message.statusCode,
    durationMs: message.durationMs,
    error:
      error === null ? null : error instanceof Error ? error.message : "throw",
    rpc: message.rpc,
    sameObject: firstMessage.get(message.requestId) === message,
  });
  // Fin de la requête : le témoin est calculé, le message ORIGINAL se relâche
  // — il porte l'erreur de la requête, qui retient son contexte (le gate
  // mémoire, abonné armé, comptait sinon 128 contextes vivants).
  if (event === "asyncEnd") firstMessage.delete(message.requestId);
};

const subscribers: TracingChannelSubscribers<IRequestTrace> = {
  start: (message) => record("start", message),
  end: (message) => record("end", message),
  asyncStart: (message) => record("asyncStart", message),
  asyncEnd: (message) => record("asyncEnd", message),
  error: (message) => record("error", message),
};

const channel = diagnosticsChannel.tracingChannel<IRequestTrace>(
  REQUEST_TRACE_CHANNEL,
);

/**
 * Sonde du canal `nodefony.http.request` (#663) : un abonné réel, dans le
 * process du serveur, que les tests d'intégration arment, interrogent puis
 * désarment. Désarmée, elle n'écoute rien — le serveur retrouve le coût nul
 * que mesure le gate mémoire.
 */
@controller("/nodefony/test/trace-channel")
class TraceChannelController extends Controller {
  constructor(context: Context) {
    super("TraceChannelController", context);
  }

  /**
   * Réserve la sonde au banc `owner`, sans s'abonner : la requête qui attend
   * son tour peut être tracée par l'abonné d'un AUTRE banc, elle ne doit donc
   * pas être celle qui abonne. Réentrant pour le même banc (un run interrompu
   * se reprend) ; tenue par un autre → 409 avec son nom, à réessayer.
   */
  @Get("/lock")
  lock(@Query("owner") requested?: string) {
    if (requested === undefined || !OWNER_PATTERN.test(requested)) {
      return this.renderJson({ error: "owner requis" }, 400);
    }
    if (owner !== null && owner !== requested) {
      return this.renderJson({ owner }, 409);
    }
    owner = requested;
    return this.renderJson({ owner });
  }

  /**
   * S'abonne (idempotent) et vide ce qui a été vu — réservé au détenteur du
   * verrou (409 sinon, avec le détenteur).
   */
  @Get("/arm")
  arm(@Query("owner") requested?: string) {
    if (owner === null || owner !== requested) {
      return this.renderJson({ armed: false, owner }, 409);
    }
    if (!armed) {
      channel.subscribe(subscribers);
      armed = true;
    }
    seen.clear();
    firstMessage.clear();
    return this.renderJson({ armed, owner });
  }

  /**
   * Se désabonne et vide ce qui a été vu, en GARDANT le verrou : un banc qui
   * prouve « désabonné, plus rien n'est publié » ne doit pas laisser un autre
   * s'abonner entre-temps. Seul le détenteur le peut.
   */
  @Get("/disarm")
  disarm(@Query("owner") requested?: string) {
    if (owner !== null && owner !== requested) {
      return this.renderJson({ armed, owner }, 409);
    }
    this.#unsubscribe();
    return this.renderJson({ armed, owner });
  }

  /** Se désabonne, vide l'état et rend le verrou — seul son détenteur le peut. */
  @Get("/unlock")
  unlock(@Query("owner") requested?: string) {
    if (owner !== null && owner !== requested) {
      return this.renderJson({ armed, owner }, 409);
    }
    this.#unsubscribe();
    owner = null;
    return this.renderJson({ armed, owner });
  }

  #unsubscribe(): void {
    if (armed) {
      channel.unsubscribe(subscribers);
      armed = false;
    }
    seen.clear();
    firstMessage.clear();
  }

  /** Événements vus, par `requestId`. */
  @Get("/events")
  events() {
    return this.renderJson(Object.fromEntries(seen));
  }

  /** Route servie sans erreur — sa trace porte route, gabarit et module. */
  @Get("/ok")
  ok() {
    return this.renderJson({ ok: true });
  }
}

export default TraceChannelController;

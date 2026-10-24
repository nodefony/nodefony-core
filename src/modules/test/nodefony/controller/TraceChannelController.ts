import diagnosticsChannel from "node:diagnostics_channel";
import type { TracingChannelSubscribers } from "node:diagnostics_channel";
import { Controller, controller, Get } from "@nodefony/framework";
import { Context, REQUEST_TRACE_CHANNEL } from "@nodefony/http";
import type { IRequestTrace } from "@nodefony/http";

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
  /** Le message est-il le MÊME objet que celui reçu à `start` ? */
  readonly sameObject: boolean;
}

/** Requêtes gardées au plus : la sonde ne doit rien retenir sans borne. */
const KEPT_REQUESTS = 128;
const seen = new Map<string, ITraceSnapshot[]>();
const firstMessage = new Map<string, IRequestTrace>();
let armed = false;

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
    sameObject: firstMessage.get(message.requestId) === message,
  });
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

  /** S'abonne (idempotent) et vide ce qui a été vu. */
  @Get("/arm")
  arm() {
    if (!armed) {
      channel.subscribe(subscribers);
      armed = true;
    }
    seen.clear();
    firstMessage.clear();
    return this.renderJson({ armed });
  }

  /** Se désabonne et vide ce qui a été vu. */
  @Get("/disarm")
  disarm() {
    if (armed) {
      channel.unsubscribe(subscribers);
      armed = false;
    }
    seen.clear();
    firstMessage.clear();
    return this.renderJson({ armed });
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

import diagnosticsChannel from "node:diagnostics_channel";
import type {
  IRequestTrace,
  RequestTraceProtocol,
} from "../../interfaces/IRequestTrace";
import type Context from "./Context";

/**
 * Nom du `TracingChannel` qui encadre chaque requête HTTP et chaque handshake
 * WebSocket — forme `module.fonction` recommandée par la documentation de
 * `node:diagnostics_channel` ; les sous-canaux sont
 * `tracing:nodefony.http.request:start`, `:end`, `:asyncStart`, `:asyncEnd`,
 * `:error`.
 */
export const REQUEST_TRACE_CHANNEL = "nodefony.http.request";

/**
 * Le message tel que Nodefony le remplit au fil de la requête : la vue
 * modifiable d'{@link IRequestTrace}, qui reste en lecture seule pour
 * l'abonné.
 */
export type RequestTraceRecord = {
  -readonly [K in keyof IRequestTrace]: IRequestTrace[K];
};

const tracing = diagnosticsChannel.tracingChannel<RequestTraceRecord>(
  REQUEST_TRACE_CHANNEL,
);
// Sous-canaux tenus ici : sous Node 26, `tracing.start` est un accesseur, et
// `diagnostics_channel` ne garde qu'une référence FAIBLE à un canal sans
// abonné. La référence de module évite les deux.
const startChannel = tracing.start;
const endChannel = tracing.end;
const asyncStartChannel = tracing.asyncStart;
const asyncEndChannel = tracing.asyncEnd;
const errorChannel = tracing.error;

/**
 * Dit si quelqu'un écoute le canal — LA garde du chemin chaud : ~1,6 ns
 * mesurées, aucune allocation. Lue une seule fois, au début de la requête :
 * un abonné arrivé ensuite ne voit que les requêtes suivantes (règle des
 * `TracingChannel`, qui interdit une fin sans début).
 *
 * @returns `true` si au moins un sous-canal a un abonné
 */
export function hasRequestTraceSubscribers(): boolean {
  return tracing.hasSubscribers;
}

/**
 * Crée le message de la requête et le range sur son contexte. À n'appeler
 * que sous {@link hasRequestTraceSubscribers} : c'est la seule allocation
 * du canal, et elle n'a lieu que si quelqu'un écoute.
 *
 * @param context - le contexte qui vient d'être construit
 * @param protocol - requête HTTP ou handshake WebSocket
 * @returns le message, de forme fixe, dont les champs de résultat valent `null`
 */
export function openRequestTrace(
  context: Context,
  protocol: RequestTraceProtocol,
): RequestTraceRecord {
  const trace: RequestTraceRecord = {
    requestId: context.requestId,
    protocol,
    method: context.method,
    scheme: context.scheme,
    url: context.url,
    route: null,
    routePath: null,
    module: null,
    statusCode: null,
    durationMs: null,
    error: null,
  };
  context.requestTrace = trace;
  return trace;
}

/**
 * Exécute la partie synchrone du traitement sous `start.runStores` puis
 * publie `end` — la séquence de `TracingChannel.tracePromise`. Les stores
 * liés au canal (`bindStore`, ce que fait un agent APM) restent actifs pour
 * toute la suite asynchrone de la requête.
 *
 * @param trace - le message de la requête
 * @param fn - la fonction qui sert la requête
 * @param thisArg - le receveur de `fn`
 * @param args - les arguments de `fn`
 * @returns ce que rend `fn` — un contexte ou sa promesse
 */
export function runTraced<ThisArg, Args extends unknown[], Result>(
  trace: RequestTraceRecord,
  fn: (this: ThisArg, ...args: Args) => Result,
  thisArg: ThisArg,
  ...args: Args
): Result {
  try {
    return startChannel.runStores(trace, fn, thisArg, ...args);
  } finally {
    endChannel.publish(trace);
  }
}

/**
 * Termine la trace de la requête : remplit les champs de résultat puis
 * publie `error` (s'il y a une exception), `asyncStart` et `asyncEnd`.
 * Idempotent — le premier appel gagne, les suivants ne font rien : un
 * handshake WebSocket a plusieurs sorties, une seule publie la fin.
 *
 * La durée est celle de l'horloge unique du contexte (`stopClock`), la même
 * que celle de la ligne d'accès : le canal n'en mesure aucune.
 *
 * @param context - le contexte de la requête
 * @param statusCode - le statut rendu au client, `null` s'il n'y en a pas eu
 * @param error - l'exception attrapée par le pipeline, `null` ou `undefined` sinon
 */
export function closeRequestTrace(
  context: Context,
  statusCode: number | null,
  error: unknown,
): void {
  const trace = context.requestTrace;
  if (trace === null) return;
  context.requestTrace = null;
  const route = context.resolver?.route ?? null;
  trace.route = route?.name ?? null;
  // Le routeur range la racine en `""` (barre finale retirée) : un gabarit
  // vide n'est pas un `http.route` valide, la racine se publie `/`.
  const path = route?.path;
  trace.routePath = path === undefined ? null : path === "" ? "/" : path;
  trace.module = context.logModule ?? route?.module?.name ?? null;
  trace.statusCode = statusCode;
  trace.durationMs = context.stopClock();
  if (error !== null && error !== undefined) {
    trace.error = error;
    errorChannel.publish(trace);
  }
  asyncStartChannel.publish(trace);
  asyncEndChannel.publish(trace);
}

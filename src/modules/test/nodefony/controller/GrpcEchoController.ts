import { Code, ConnectError } from "@connectrpc/connect";
import type { HandlerContext } from "@connectrpc/connect";
import { setTimeout as sleep } from "node:timers/promises";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { GrpcController, GrpcService } from "@nodefony/framework/grpc";
import type { ContextType } from "@nodefony/http";
import { RequestContext } from "nodefony";
import {
  EchoService,
  type ConverseRequest,
  type ConverseResponseSchema,
  type MirrorRequest,
  type MirrorResponseSchema,
  type PingRequest,
  type PingResponseSchema,
  type SayRequest,
  type SayResponseSchema,
  type StallRequest,
  type StallResponseSchema,
  type WatchRequest,
  type WatchResponseSchema,
} from "../gen/nodefony/test/v1/echo_pb";

/** Instances construites depuis le démarrage : un singleton n'en a qu'une. */
let instances = 0;
/**
 * Appels de `Say` servis, comptés PAR valeur de l'en-tête `x-witness` : témoin
 * qu'un appel refusé n'atteint pas la méthode. Un compteur global se faisait
 * fausser par les `Say` des autres fichiers du banc, joués en parallèle ;
 * chaque test tire son propre témoin. Borné : un banc n'en tient que quelques-uns.
 */
const sayCalls = new Map<string, number>();
const WITNESS_LIMIT = 1024;

/**
 * Appels bloqués (`Stall`, `Watch`) dont le signal s'est abaissé, PAR
 * témoin : un appel bloqué ne répond plus, l'appel `Stall` suivant de même
 * témoin lit le constat. Borné comme `sayCalls`.
 */
const stallAborted = new Set<string>();

/** Note l'interruption du signal d'un appel bloqué, pour son témoin. */
function witnessAbort(signal: AbortSignal, witness: string): void {
  signal.addEventListener(
    "abort",
    () => {
      if (stallAborted.size >= WITNESS_LIMIT) stallAborted.clear();
      stallAborted.add(witness);
    },
    { once: true },
  );
}

/**
 * `nodefony.test.v1.EchoService` — l'application de référence de
 * `@GrpcService` (#695) : chaque route `POST /nodefony.test.v1.EchoService/<M>`
 * passe par tout le pipeline, et ses gardes se liraient sur la méthode du
 * contrat. Singleton (défaut) : une instance pour tous les appels.
 *
 * Banc : `framework/nodefony/tests/integration/grpc.test.ts`.
 */
@GrpcService(EchoService)
export class GrpcEchoController extends GrpcController {
  readonly serial: number;

  constructor(context: ContextType) {
    super("GrpcEchoController", context);
    instances += 1;
    this.serial = instances;
  }

  say(
    request: SayRequest,
    ctx: HandlerContext,
  ): MessageInitShape<typeof SayResponseSchema> {
    // Exception banale (ADR-0026 D7 et D10) : 13, la cause à la ligne d'accès.
    if (ctx.requestHeader.get("x-fail") === "plain") {
      throw new Error("panne voulue (x-fail)");
    }
    const witness = ctx.requestHeader.get("x-witness") ?? "";
    if (!sayCalls.has(witness) && sayCalls.size >= WITNESS_LIMIT) {
      sayCalls.clear();
    }
    const calls = (sayCalls.get(witness) ?? 0) + 1;
    sayCalls.set(witness, calls);
    return {
      sentence: request.sentence,
      requestId: RequestContext.getRequestId() ?? "",
      instance: this.serial,
      calls,
    };
  }

  ping(
    request: PingRequest,
    ctx: HandlerContext,
  ): MessageInitShape<typeof PingResponseSchema> {
    return { sentence: request.sentence, httpMethod: ctx.requestMethod };
  }

  async *converse(
    requests: AsyncIterable<ConverseRequest>,
  ): AsyncIterable<MessageInitShape<typeof ConverseResponseSchema>> {
    let received = 0;
    for await (const request of requests) {
      received += 1;
      yield { sentence: request.sentence, received };
    }
  }

  /**
   * Échéance d'un appel unaire (ADR-0026 D4). `block` : ne répond jamais et
   * ne lit pas son signal — seule l'échéance de Nodefony termine l'appel ;
   * l'interruption du signal est notée pour le témoin. Sinon : rend le temps
   * restant vu à l'appel et le constat du témoin, après `delayMs` — un unaire
   * en vol pendant l'arrêt du serveur finit pendant le drain (ADR-0026 D8).
   */
  stall(
    request: StallRequest,
    ctx: HandlerContext,
  ):
    | MessageInitShape<typeof StallResponseSchema>
    | Promise<MessageInitShape<typeof StallResponseSchema>> {
    if (request.block) {
      witnessAbort(ctx.signal, request.witness);
      return new Promise<never>(() => {});
    }
    if (request.delayMs > 0) {
      return sleep(request.delayMs).then(() => this.stallReport(request, ctx));
    }
    return this.stallReport(request, ctx);
  }

  /** Le temps restant vu par l'appel, et le constat du témoin. */
  private stallReport(
    request: StallRequest,
    ctx: HandlerContext,
  ): MessageInitShape<typeof StallResponseSchema> {
    const timeoutMs = ctx.timeoutMs();
    return {
      timeoutMs: timeoutMs === undefined ? 0 : Math.ceil(timeoutMs),
      hasDeadline: timeoutMs !== undefined,
      aborted: stallAborted.has(request.witness),
    };
  }

  /**
   * Flux serveur long (ADR-0026 D4 point 4) : `burst` messages, puis sans
   * fin (`follow`) ou muet jusqu'à l'annulation. L'adaptateur attend `drain`
   * entre deux messages : un client qui ne lit plus bloque le générateur.
   * `follow` avec `intervalMs` : un message par intervalle, SOURD à son signal
   * — seule la fiche d'appel l'arrête (arrêt du serveur, ADR-0026 D8).
   */
  async *watch(
    request: WatchRequest,
    ctx: HandlerContext,
  ): AsyncIterable<MessageInitShape<typeof WatchResponseSchema>> {
    if (request.witness !== "") witnessAbort(ctx.signal, request.witness);
    const payload = new Uint8Array(request.bytes);
    let seq = 0;
    for (; seq < request.burst; seq++) yield { seq, payload };
    if (request.follow && request.intervalMs > 0) {
      for (;;) {
        await sleep(request.intervalMs);
        yield { seq: seq++, payload };
      }
    }
    if (request.follow) {
      while (!ctx.signal.aborted) yield { seq: seq++, payload };
      return;
    }
    await new Promise<void>((resolve) => {
      if (ctx.signal.aborted) resolve();
      else
        ctx.signal.addEventListener("abort", () => resolve(), { once: true });
    });
  }

  fail(): never {
    throw new ConnectError("échec voulu", Code.FailedPrecondition);
  }

  mirror(
    request: MirrorRequest,
  ): MessageInitShape<typeof MirrorResponseSchema> {
    const value = request.value;
    const payload = value?.payload;
    return {
      value,
      rawSize: payload?.case === "raw" ? payload.value.byteLength : 0,
    };
  }
}

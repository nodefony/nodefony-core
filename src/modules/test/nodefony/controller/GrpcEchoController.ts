import { Code, ConnectError } from "@connectrpc/connect";
import type { HandlerContext } from "@connectrpc/connect";
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

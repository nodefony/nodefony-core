// Adapté du serveur de référence de connect-es
// (packages/connect-conformance/src/routes.ts et protocol.ts),
// Copyright 2021-2026 The Connect Authors, sous licence Apache 2.0
// (http://www.apache.org/licenses/LICENSE-2.0). Modifications : contrôleur
// Nodefony (@GrpcService), codes par table typée, détails d'erreur remis
// bruts, attentes liées au signal de l'appel.
import { setTimeout as delay } from "node:timers/promises";
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { anyPack, type Any } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import type { HandlerContext } from "@connectrpc/connect";
import { GrpcController, GrpcService } from "@nodefony/framework/grpc";
import type { ContextType } from "@nodefony/http";
import { Code as ConformanceCode } from "../gen/connectrpc/conformance/v1/config_pb";
import {
  BidiStreamRequestSchema,
  ClientStreamRequestSchema,
  ConformancePayload_RequestInfoSchema,
  ConformancePayloadSchema,
  ConformanceService,
  HeaderSchema,
  IdempotentUnaryRequestSchema,
  ServerStreamRequestSchema,
  UnaryRequestSchema,
  type BidiStreamRequest,
  type BidiStreamResponseSchema,
  type ClientStreamRequest,
  type ClientStreamResponseSchema,
  type ConformancePayload,
  type ConformancePayload_RequestInfo,
  type Error as ConformanceError,
  type Header,
  type IdempotentUnaryRequest,
  type IdempotentUnaryResponseSchema,
  type ServerStreamRequest,
  type ServerStreamResponseSchema,
  type StreamResponseDefinition,
  type UnaryRequest,
  type UnaryResponseDefinition,
  type UnimplementedResponseSchema,
} from "../gen/connectrpc/conformance/v1/service_pb";

/** Les codes de la suite et ceux de Connect : mêmes valeurs, deux énumérations. */
const CODES: Record<ConformanceCode, Code> = {
  [ConformanceCode.UNSPECIFIED]: Code.Unknown,
  [ConformanceCode.CANCELED]: Code.Canceled,
  [ConformanceCode.UNKNOWN]: Code.Unknown,
  [ConformanceCode.INVALID_ARGUMENT]: Code.InvalidArgument,
  [ConformanceCode.DEADLINE_EXCEEDED]: Code.DeadlineExceeded,
  [ConformanceCode.NOT_FOUND]: Code.NotFound,
  [ConformanceCode.ALREADY_EXISTS]: Code.AlreadyExists,
  [ConformanceCode.PERMISSION_DENIED]: Code.PermissionDenied,
  [ConformanceCode.RESOURCE_EXHAUSTED]: Code.ResourceExhausted,
  [ConformanceCode.FAILED_PRECONDITION]: Code.FailedPrecondition,
  [ConformanceCode.ABORTED]: Code.Aborted,
  [ConformanceCode.OUT_OF_RANGE]: Code.OutOfRange,
  [ConformanceCode.UNIMPLEMENTED]: Code.Unimplemented,
  [ConformanceCode.INTERNAL]: Code.Internal,
  [ConformanceCode.UNAVAILABLE]: Code.Unavailable,
  [ConformanceCode.DATA_LOSS]: Code.DataLoss,
  [ConformanceCode.UNAUTHENTICATED]: Code.Unauthenticated,
};

/**
 * L'erreur que décrit le cas de test. Ses détails (`Any`) repartent tels
 * quels, quel que soit leur type : aucun déballage, aucun registre.
 */
function toConnectError(error: ConformanceError): ConnectError {
  const connectError = new ConnectError(error.message ?? "", CODES[error.code]);
  for (const detail of error.details) {
    connectError.details.push({
      type: detail.typeUrl.slice(detail.typeUrl.lastIndexOf("/") + 1),
      value: detail.value,
    });
  }
  return connectError;
}

function toProtoHeaders(headers: Headers): Header[] {
  const result: Header[] = [];
  headers.forEach((value, name) => {
    result.push(create(HeaderSchema, { name, value: [value] }));
  });
  return result;
}

function appendHeaders(headers: Headers, protoHeaders: Header[]): void {
  for (const header of protoHeaders) {
    for (const value of header.value) headers.append(header.name, value);
  }
}

function requestInfo(
  ctx: HandlerContext,
  requests: Any[],
): ConformancePayload_RequestInfo {
  const timeoutMs = ctx.timeoutMs();
  return create(ConformancePayload_RequestInfoSchema, {
    requestHeaders: toProtoHeaders(ctx.requestHeader),
    requests,
    ...(timeoutMs !== undefined ? { timeoutMs: BigInt(timeoutMs) } : {}),
  });
}

/**
 * Attend, sans survivre à un appel annulé. Quand le signal s'abaisse
 * (échéance, annulation), c'est SA raison qui part — une `ConnectError` à
 * code 4 ou 1 — et non l'`AbortError` générique du minuteur, que Connect
 * classerait 13 `INTERNAL` (vu par la suite de conformité).
 */
async function wait(ms: number, ctx: HandlerContext): Promise<void> {
  if (ms <= 0) return;
  try {
    await delay(ms, undefined, { signal: ctx.signal });
  } catch (e) {
    if (ctx.signal.aborted) throw ctx.signal.reason;
    throw e;
  }
}

/** La forme commune des réponses unaires du contrat : une charge utile. */
interface IPayloadOutput {
  payload: ConformancePayload;
}

async function unaryResponse(
  def: UnaryResponseDefinition | undefined,
  requests: Any[],
  ctx: HandlerContext,
): Promise<IPayloadOutput> {
  appendHeaders(ctx.responseHeader, def?.responseHeaders ?? []);
  appendHeaders(ctx.responseTrailer, def?.responseTrailers ?? []);
  const info = requestInfo(ctx, requests);
  if (def?.response.case === "error") {
    def.response.value.details.push(
      anyPack(ConformancePayload_RequestInfoSchema, info),
    );
    throw toConnectError(def.response.value);
  }
  await wait(def?.responseDelayMs ?? 0, ctx);
  return {
    payload: create(ConformancePayloadSchema, {
      requestInfo: info,
      ...(def?.response.case === "responseData"
        ? { data: def.response.value }
        : {}),
    }),
  };
}

/**
 * `connectrpc.conformance.v1.ConformanceService` — le serveur que la suite de
 * conformité officielle de Connect interroge (#695). Port du serveur de
 * référence de connect-es (`connect-conformance/src/routes.ts`), servi par
 * `@GrpcService` À TRAVERS tout le pipeline de Nodefony. Lancement :
 * `src/modules/test/conformance/run.mjs`.
 */
@GrpcService(ConformanceService)
export class GrpcConformanceController extends GrpcController {
  constructor(context: ContextType) {
    super("GrpcConformanceController", context);
  }

  unary(request: UnaryRequest, ctx: HandlerContext): Promise<IPayloadOutput> {
    return unaryResponse(
      request.responseDefinition,
      [anyPack(UnaryRequestSchema, request)],
      ctx,
    );
  }

  idempotentUnary(
    request: IdempotentUnaryRequest,
    ctx: HandlerContext,
  ): Promise<MessageInitShape<typeof IdempotentUnaryResponseSchema>> {
    return unaryResponse(
      request.responseDefinition,
      [anyPack(IdempotentUnaryRequestSchema, request)],
      ctx,
    );
  }

  /** Contrat EXIGE qu'elle réponde « non implémentée » : c'est le cas testé. */
  unimplemented(): MessageInitShape<typeof UnimplementedResponseSchema> {
    throw new ConnectError(
      "connectrpc.conformance.v1.ConformanceService.Unimplemented",
      Code.Unimplemented,
    );
  }

  async clientStream(
    requests: AsyncIterable<ClientStreamRequest>,
    ctx: HandlerContext,
  ): Promise<MessageInitShape<typeof ClientStreamResponseSchema>> {
    let def: UnaryResponseDefinition | undefined;
    let first = true;
    const received: Any[] = [];
    for await (const request of requests) {
      if (first) {
        def = request.responseDefinition;
        first = false;
      }
      received.push(anyPack(ClientStreamRequestSchema, request));
    }
    return unaryResponse(def, received, ctx);
  }

  async *serverStream(
    request: ServerStreamRequest,
    ctx: HandlerContext,
  ): AsyncIterable<MessageInitShape<typeof ServerStreamResponseSchema>> {
    const def = request.responseDefinition;
    appendHeaders(ctx.responseHeader, def?.responseHeaders ?? []);
    appendHeaders(ctx.responseTrailer, def?.responseTrailers ?? []);
    const received = [anyPack(ServerStreamRequestSchema, request)];
    let info: ConformancePayload_RequestInfo | undefined = requestInfo(
      ctx,
      received,
    );
    for (const data of def?.responseData ?? []) {
      await wait(def?.responseDelayMs ?? 0, ctx);
      yield {
        payload: create(ConformancePayloadSchema, {
          ...(info !== undefined ? { requestInfo: info } : {}),
          data,
        }),
      };
      // L'information de requête ne part qu'avec la première réponse.
      info = undefined;
    }
    if (def?.error !== undefined) {
      if (def.responseData.length === 0) {
        def.error.details.push(
          anyPack(
            ConformancePayload_RequestInfoSchema,
            requestInfo(ctx, received),
          ),
        );
      }
      throw toConnectError(def.error);
    }
  }

  async *bidiStream(
    requests: AsyncIterable<BidiStreamRequest>,
    ctx: HandlerContext,
  ): AsyncIterable<MessageInitShape<typeof BidiStreamResponseSchema>> {
    let def: StreamResponseDefinition | undefined;
    let first = true;
    let fullDuplex = false;
    let sent = 0;
    let received: Any[] = [];
    for await (const request of requests) {
      if (first) {
        first = false;
        def = request.responseDefinition;
        appendHeaders(ctx.responseHeader, def?.responseHeaders ?? []);
        appendHeaders(ctx.responseTrailer, def?.responseTrailers ?? []);
        fullDuplex = request.fullDuplex;
      }
      received.push(anyPack(BidiStreamRequestSchema, request));
      if (!fullDuplex) continue;
      // Duplex intégral : une réponse par requête reçue.
      if (def === undefined || sent >= def.responseData.length) break;
      await wait(def.responseDelayMs, ctx);
      const data = def.responseData[sent];
      yield {
        payload: create(ConformancePayloadSchema, {
          requestInfo: requestInfo(ctx, [
            anyPack(BidiStreamRequestSchema, request),
          ]),
          ...(data !== undefined ? { data } : {}),
        }),
      };
      sent += 1;
      received = [];
    }
    // Reste à envoyer : demi-duplex (rien n'est parti), ou duplex intégral
    // qui demande plus de réponses que de requêtes.
    const info = requestInfo(ctx, received);
    const total = def?.responseData.length ?? 0;
    for (; sent < total; sent++) {
      await wait(def?.responseDelayMs ?? 0, ctx);
      const data = def?.responseData[sent];
      yield {
        payload: create(ConformancePayloadSchema, {
          ...(sent === 0 ? { requestInfo: info } : {}),
          ...(data !== undefined ? { data } : {}),
        }),
      };
    }
    if (def?.error !== undefined) {
      if (def.responseData.length === 0) {
        def.error.details.push(
          anyPack(ConformancePayload_RequestInfoSchema, info),
        );
      }
      throw toConnectError(def.error);
    }
  }
}

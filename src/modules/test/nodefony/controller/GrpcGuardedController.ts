import type { MessageInitShape } from "@bufbuild/protobuf";
import { IsGranted } from "@nodefony/framework";
import { GrpcController, GrpcService } from "@nodefony/framework/grpc";
import type { ContextType } from "@nodefony/http";
import { setTimeout as sleep } from "node:timers/promises";
import { Injector, RequestContext } from "nodefony";
import {
  GuardedEchoService,
  type AdminRequest,
  type AdminResponseSchema,
  type FollowRequest,
  type FollowResponseSchema,
  type MemberRequest,
  type MemberResponseSchema,
  type RelayRequest,
  type RelayResponseSchema,
} from "../gen/nodefony/test/v1/guarded_pb";
import { RequestProbeReader } from "./requestProbe";

/** Appels servis depuis le démarrage : témoin qu'un refus n'atteint rien. */
let calls = 0;

/**
 * `nodefony.test.v1.GuardedEchoService` — les refus du pare-feu et de
 * `@IsGranted` rendus au format du protocole (#695, lot 3 ; ADR-0026 D5).
 *
 * - `Member` vit sous la zone `test-grpc-member` (JWT seul) : sans jeton, le
 *   pare-feu refuse — 16 `UNAUTHENTICATED`.
 * - `Admin` vit sous la zone `test-grpc` (JWT, puis l'anonyme) et porte
 *   `@IsGranted("ROLE_ADMIN")` : anonyme → 16, identifié sans le rôle → 7.
 *
 * - `Follow` et `Relay` (zone `test-grpc-member`) : flux dont chaque message
 *   relève l'identité, la requête et l'exemplaire du service `request` — vus
 *   dans la bulle de la requête jusqu'au dernier message (ADR-0026 D6).
 *
 * Bancs : `framework/nodefony/tests/integration/grpc-refusal.test.ts`,
 * `grpc-context.test.ts`.
 */
@GrpcService(GuardedEchoService)
export class GrpcGuardedController extends GrpcController {
  constructor(context: ContextType) {
    super("GrpcGuardedController", context);
  }

  member(
    request: MemberRequest,
  ): MessageInitShape<typeof MemberResponseSchema> {
    calls += 1;
    return {
      sentence: request.sentence,
      identifier: this.user?.identifier ?? "",
      calls,
    };
  }

  @IsGranted("ROLE_ADMIN")
  admin(request: AdminRequest): MessageInitShape<typeof AdminResponseSchema> {
    calls += 1;
    return {
      sentence: request.sentence,
      identifier: this.user?.identifier ?? "",
      calls,
    };
  }

  /**
   * Flux serveur SOURD : `count` messages espacés de `interval_ms`, sans
   * jamais lire son signal — seul l'arrêt du flux par la fiche d'appel
   * (révocation : 16) l'interrompt.
   */
  async *follow(
    request: FollowRequest,
  ): AsyncIterable<MessageInitShape<typeof FollowResponseSchema>> {
    for (let seq = 0; seq < request.count; seq++) {
      if (seq > 0) await sleep(request.intervalMs);
      yield { seq, ...this.#witness() };
    }
  }

  /** Flux bidirectionnel : un écho par message reçu, avec le même relevé. */
  async *relay(
    requests: AsyncIterable<RelayRequest>,
  ): AsyncIterable<MessageInitShape<typeof RelayResponseSchema>> {
    for await (const request of requests) {
      yield { sentence: request.sentence, ...this.#witness() };
    }
  }

  /** Ce que la bulle de la requête dit À CET INSTANT. */
  #witness(): { identifier: string; requestId: string; probe: number } {
    return {
      identifier: this.user?.identifier ?? "",
      requestId: RequestContext.getRequestId() ?? "",
      probe:
        Injector.instantiate<RequestProbeReader>(RequestProbeReader).probe
          .serial,
    };
  }
}

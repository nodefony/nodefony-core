import type { MessageInitShape } from "@bufbuild/protobuf";
import { IsGranted } from "@nodefony/framework";
import { GrpcController, GrpcService } from "@nodefony/framework/grpc";
import type { ContextType } from "@nodefony/http";
import {
  GuardedEchoService,
  type AdminRequest,
  type AdminResponseSchema,
  type MemberRequest,
  type MemberResponseSchema,
} from "../gen/nodefony/test/v1/guarded_pb";

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
 * Banc : `framework/nodefony/tests/integration/grpc-refusal.test.ts`.
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
}

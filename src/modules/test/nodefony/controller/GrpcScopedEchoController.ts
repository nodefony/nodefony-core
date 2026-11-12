import type { MessageInitShape } from "@bufbuild/protobuf";
import { Scope } from "@nodefony/framework";
import { GrpcController, GrpcService } from "@nodefony/framework/grpc";
import type { ContextType } from "@nodefony/http";
import {
  ScopedEchoService,
  type WhoResponseSchema,
} from "../gen/nodefony/test/v1/echo_pb";

/** Instances construites depuis le démarrage : une par appel. */
let instances = 0;

/**
 * `nodefony.test.v1.ScopedEchoService` — point d'entrée `@Scope("request")`
 * (#695, critère 6) : chaque appel est servi par une instance neuve.
 */
@Scope("request")
@GrpcService(ScopedEchoService)
export class GrpcScopedEchoController extends GrpcController {
  readonly serial: number;

  constructor(context: ContextType) {
    super("GrpcScopedEchoController", context);
    instances += 1;
    this.serial = instances;
  }

  who(): MessageInitShape<typeof WhoResponseSchema> {
    return { instance: this.serial };
  }
}

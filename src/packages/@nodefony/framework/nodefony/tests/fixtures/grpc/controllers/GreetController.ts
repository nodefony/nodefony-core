import { GrpcController, GrpcService } from "@nodefony/framework/grpc";
import type { ContextType } from "@nodefony/http";
import { GreetService } from "../gen/greet/v1/greet_pb";
import type { GreetRequest } from "../gen/greet/v1/greet_pb";

@GrpcService(GreetService)
export class GreetController extends GrpcController {
  constructor(context: ContextType) {
    super("GreetController", context);
  }

  greet(request: GreetRequest) {
    return { greeting: `Bonjour, ${request.name} !` };
  }
}

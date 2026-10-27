import type { ServiceImpl } from "@connectrpc/connect";
import type { connectNodeAdapter } from "@connectrpc/connect-node";
import { Controller, controller, Post } from "@nodefony/framework";
import { Http2Response, HttpContext } from "@nodefony/http";
import type { ContextType } from "@nodefony/http";
import { RequestContext } from "nodefony";
import type { EchoService } from "./gen/nodefony/poc/v1/echo_pb";

/** Le gestionnaire `(req, res)` que rend l'adaptateur (type non exporté par le paquet). */
type NodeHandlerFn = ReturnType<typeof connectNodeAdapter>;

/**
 * Gestionnaire Connect partagé, construit au PREMIER appel : l'adaptateur, le
 * runtime protobuf et le code généré ne sont importés que là. Une application
 * qui ne reçoit jamais d'appel gRPC ne les charge pas (critère du POC #690).
 */
let handler: Promise<NodeHandlerFn> | null = null;

function grpcHandler(): Promise<NodeHandlerFn> {
  handler ??= buildHandler();
  return handler;
}

async function buildHandler(): Promise<NodeHandlerFn> {
  const [{ connectNodeAdapter }, { Code, ConnectError }, schema] =
    await Promise.all([
      import("@connectrpc/connect-node"),
      import("@connectrpc/connect"),
      import("./gen/nodefony/poc/v1/echo_pb"),
    ]);
  const impl: ServiceImpl<typeof EchoService> = {
    say(request) {
      return {
        sentence: request.sentence,
        requestId: RequestContext.getRequestId() ?? "",
      };
    },
    async *converse(requests) {
      let received = 0;
      for await (const request of requests) {
        received += 1;
        yield { sentence: request.sentence, received };
      }
    },
    fail() {
      throw new ConnectError("échec voulu du POC", Code.FailedPrecondition);
    },
  };
  return connectNodeAdapter({
    routes(router) {
      router.service(schema.EchoService, impl);
    },
  });
}

/**
 * POC #690 — sert le service gRPC `nodefony.poc.v1.EchoService` DANS le
 * pipeline : pare-feu, contexte et `requestId` compris. La route est en
 * `bodyStream` pour que le corps arrive en flux (sans quoi l'analyseur le lit
 * en entier avant l'action, et le flux bidirectionnel est impossible).
 * L'action ne rend rien : l'adaptateur écrit lui-même la réponse et ses
 * trailers, sur la requête et la réponse brutes de Node.
 */
@controller("/nodefony.poc.v1.EchoService")
class GrpcPocController extends Controller {
  constructor(context: ContextType) {
    super("GrpcPocController", context);
  }

  /** Toutes les méthodes du service : l'adaptateur route lui-même sur le chemin. */
  @Post("/{method}", { schema: {}, bodyStream: true })
  async call(): Promise<void> {
    const context = this.context;
    if (!(context instanceof HttpContext)) return;
    const response = context.response;
    const nodeResponse = response.response;
    if (nodeResponse === null) return;
    // Un flux gRPC peut rester muet plus longtemps que le délai par flux du
    // contexte (408) : on le désarme, comme le SSE (`startSseStream`) ; le
    // délai de l'appel est celui que porte `grpc-timeout`.
    if (response instanceof Http2Response) response.stream?.setTimeout(0);
    const serve = await grpcHandler();
    await new Promise<void>((resolve) => {
      nodeResponse.once("close", () => resolve());
      serve(context.request.request, nodeResponse);
    });
  }
}

export default GrpcPocController;

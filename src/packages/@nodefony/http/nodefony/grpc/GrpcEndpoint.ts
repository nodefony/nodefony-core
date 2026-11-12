import { Code, ConnectError } from "@connectrpc/connect";
import type {
  ConnectRouter,
  HandlerContext,
  MethodImpl,
} from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { createRegistry } from "@bufbuild/protobuf";
import type {
  DescFile,
  DescMethod,
  DescMethodBiDiStreaming,
  DescMethodClientStreaming,
  DescMethodServerStreaming,
  DescMethodUnary,
  DescService,
  Registry,
} from "@bufbuild/protobuf";
import type HttpContext from "../src/context/http/HttpContext";
import HttpError from "../src/errors/httpError";
import {
  disarmResponseTimeout,
  resolveStreamTarget,
} from "../src/context/http/StreamLifecycle";
import { GrpcCall } from "./GrpcCall";

/** Le gestionnaire `(req, res)` que rend l'adaptateur. */
type NodeHandler = ReturnType<typeof connectNodeAdapter>;

/**
 * Protocoles servis — la section `grpc` de la configuration http
 * (ADR-0026 D3, point 5).
 *
 * @experimental Surface gRPC, ADR-0026 D11.
 */
export interface IGrpcProtocols {
  readonly grpc: boolean;
  readonly grpcWeb: boolean;
  readonly connect: boolean;
}

/** Défaut de l'adaptateur : les trois protocoles (`router.d.ts`). */
const ALL_PROTOCOLS: IGrpcProtocols = Object.freeze({
  grpc: true,
  grpcWeb: true,
  connect: true,
});

/**
 * Options d'un {@link GrpcEndpoint}.
 *
 * @experimental Surface gRPC, ADR-0026 D11.
 */
export interface IGrpcEndpointOptions {
  /**
   * `true` : la cible change à chaque appel (contrôleur `@Scope("request")`),
   * chaque méthode la relit dans la fiche d'appel. `false` (défaut) : la cible
   * du premier appel sert tous les suivants (contrôleur singleton) et ses
   * méthodes sont liées une fois — aucune indirection par appel.
   */
  readonly perCall?: boolean;
}

/**
 * Point d'entrée gRPC d'un service : possède l'adaptateur Connect
 * (`connectNodeAdapter`) et lui confie la requête et la réponse BRUTES de Node
 * d'un contexte déjà passé par le pipeline (pare-feu, gardes).
 *
 * L'adaptateur est construit au premier appel, depuis la section `grpc` de la
 * configuration http. Il reçoit la fiche d'appel ({@link GrpcCall}) par son
 * option `contextValues`, qu'il appelle de façon SYNCHRONE avant toute
 * attente (`connect-node-adapter.js#nodeRequestHandler`) : la cible passe par
 * une case lue à cet instant — ni ALS, ni promesse, ni écouteur de plus.
 *
 * Les méthodes s'inscrivent une à une par `router.rpc`, SANS options : des
 * options passées à l'inscription rallumeraient gRPC et gRPC-Web coupés par la
 * configuration (connectrpc/connect-es#1835). La restriction de protocoles
 * vit sur l'adaptateur seul.
 *
 * @experimental Surface gRPC, ADR-0026 D11.
 */
export class GrpcEndpoint<S extends DescService = DescService> {
  /** Le contrat servi (descripteur généré par `buf`). */
  readonly service: S;
  /** Cible relue à chaque appel (`@Scope("request")`). */
  readonly perCall: boolean;

  #handler: NodeHandler | null = null;
  /** Case synchrone : la cible de l'appel en cours de remise à l'adaptateur. */
  #pendingTarget: object | null = null;
  /** Option `contextValues` : une fiche par appel, rien sur le chemin du 404. */
  readonly #contextValues = (): GrpcCall => new GrpcCall(this.#pendingTarget);

  constructor(service: S, options: IGrpcEndpointOptions = {}) {
    this.service = service;
    this.perCall = options.perCall ?? false;
  }

  /**
   * Remet la requête du contexte à l'adaptateur, qui écrit lui-même la
   * réponse et ses trailers. Synchrone : rien n'est attendu ici.
   *
   * Avant de la remettre : le délai de réponse de Nodefony est désarmé (à
   * l'expiration il écrirait un 408/504 par-dessus — un seul écrivain), et le
   * contexte est marqué répondu (`sended`), si bien que le pipeline n'attend
   * aucune réponse de l'action.
   *
   * @param context - le contexte HTTP de la requête, pas encore répondu.
   * @param target - l'objet qui implémente le service pour cet appel.
   * @throws HttpError 500 quand la réponse est déjà partie, ou que son
   *   transport n'est pas reconnu.
   * @throws HttpError 400 quand l'adaptateur refuse la requête avant d'avoir
   *   rien écrit (requête sans autorité `Host`) — la réponse revient alors au
   *   pipeline.
   */
  serve(context: HttpContext, target: object): void {
    if (context.sended || context.finished || context.response.isHeaderSent()) {
      // Sans contexte : `HttpError` réécrirait le statut de la réponse déjà prise.
      throw new HttpError("gRPC : la réponse est déjà partie", 500);
    }
    const nodeResponse = context.response.response;
    const streamTarget = resolveStreamTarget(context);
    if (nodeResponse === null || streamTarget === null) {
      throw new HttpError("gRPC : transport de réponse inconnu", 500, context);
    }
    // Construit AVANT de prendre la réponse : une méthode introuvable rend
    // une erreur que le pipeline sait encore écrire.
    const handler = this.#handler ?? this.#build(context, target);
    disarmResponseTimeout(streamTarget);
    context.sended = true;
    this.#pendingTarget = target;
    try {
      handler(context.request.request, nodeResponse);
    } catch (error) {
      // `universalRequestFromNodeRequest` lève de façon SYNCHRONE, avant
      // d'écrire quoi que ce soit, sur une requête sans autorité.
      if (nodeResponse.headersSent) throw error;
      context.sended = false;
      context.log(error, "WARNING", "GRPC");
      throw HttpError.withoutStack("gRPC : requête mal formée", 400, context);
    } finally {
      this.#pendingTarget = null;
    }
  }

  /** Construit l'adaptateur, une fois, depuis la configuration http. */
  #build(context: HttpContext, target: object): NodeHandler {
    const protocols = context.httpKernel?.options.grpc ?? ALL_PROTOCOLS;
    const shared = this.perCall ? null : target;
    const handler = connectNodeAdapter({
      grpc: protocols.grpc,
      grpcWeb: protocols.grpcWeb,
      connect: protocols.connect,
      contextValues: this.#contextValues,
      jsonOptions: { registry: contractRegistry(this.service) },
      routes: (router) => registerMethods(router, this.service, shared),
    });
    this.#handler = handler;
    return handler;
  }
}

/**
 * Registre des types du contrat : son fichier et tout ce qu'il importe, types
 * bien connus compris. Sans lui, un `google.protobuf.Any` ne se lit ni ne
 * s'écrit en JSON (Connect et gRPC-Web JSON répondent `INVALID_ARGUMENT`) :
 * le mappage JSON de proto3 exige de résoudre le type emballé. Construit une
 * fois ; Connect ne le consulte que pour `Any` en JSON. Un type emballé hors
 * du graphe d'imports du contrat reste non résolu en JSON — le binaire, lui,
 * le transporte toujours.
 */
function contractRegistry(service: DescService): Registry {
  const files: DescFile[] = [];
  const seen = new Set<DescFile>();
  const visit = (file: DescFile): void => {
    if (seen.has(file)) return;
    seen.add(file);
    files.push(file);
    for (const dependency of file.dependencies) visit(dependency);
  };
  visit(service.file);
  return createRegistry(...files);
}

/**
 * Inscrit chaque méthode du contrat. `shared` non nul : ses méthodes, liées
 * une fois. `null` : une enveloppe par méthode, qui relit la cible dans la
 * fiche d'appel. Un garde par genre de méthode donne à chaque enveloppe le
 * type exact de sa méthode — aucune conversion.
 */
function registerMethods(
  router: ConnectRouter,
  service: DescService,
  shared: object | null,
): void {
  for (const method of service.methods) {
    if (isUnary(method)) {
      router.rpc(
        method,
        shared !== null
          ? pick(method, shared).bind(shared)
          : (request, ctx) => {
              const target = callTarget(ctx);
              return pick(method, target).call(target, request, ctx);
            },
      );
    } else if (isServerStreaming(method)) {
      router.rpc(
        method,
        shared !== null
          ? pick(method, shared).bind(shared)
          : (request, ctx) => {
              const target = callTarget(ctx);
              return pick(method, target).call(target, request, ctx);
            },
      );
    } else if (isClientStreaming(method)) {
      router.rpc(
        method,
        shared !== null
          ? pick(method, shared).bind(shared)
          : (requests, ctx) => {
              const target = callTarget(ctx);
              return pick(method, target).call(target, requests, ctx);
            },
      );
    } else if (isBiDiStreaming(method)) {
      router.rpc(
        method,
        shared !== null
          ? pick(method, shared).bind(shared)
          : (requests, ctx) => {
              const target = callTarget(ctx);
              return pick(method, target).call(target, requests, ctx);
            },
      );
    }
  }
}

// `DescMethod` porte `methodKind` sans être une union discriminée : ces gardes
// donnent à chaque branche le type exact de sa méthode.
function isUnary(method: DescMethod): method is DescMethodUnary {
  return method.methodKind === "unary";
}
function isServerStreaming(
  method: DescMethod,
): method is DescMethodServerStreaming {
  return method.methodKind === "server_streaming";
}
function isClientStreaming(
  method: DescMethod,
): method is DescMethodClientStreaming {
  return method.methodKind === "client_streaming";
}
function isBiDiStreaming(
  method: DescMethod,
): method is DescMethodBiDiStreaming {
  return method.methodKind === "bidi_streaming";
}

/** La cible de l'appel, posée par {@link GrpcEndpoint.serve} dans la fiche. */
function callTarget(ctx: HandlerContext): object {
  const call = ctx.values;
  if (call instanceof GrpcCall && call.target !== null) return call.target;
  throw new ConnectError(
    "appel gRPC reçu hors de GrpcEndpoint.serve : aucune cible",
    Code.Internal,
  );
}

/**
 * L'implémentation d'une méthode du contrat sur sa cible. La signature est
 * garantie à la compilation par `@GrpcService` et la présence vérifiée au
 * démarrage ; ici, le constat qu'il s'agit bien d'une fonction.
 *
 * @throws ConnectError `UNIMPLEMENTED` quand la cible ne la porte pas.
 */
function pick<M extends DescMethod>(method: M, target: object): MethodImpl<M> {
  const impl: unknown = Reflect.get(target, method.localName);
  if (isImplOf(method, impl)) return impl;
  throw new ConnectError(
    `${method.parent.typeName}.${method.name} n'est pas implémentée`,
    Code.Unimplemented,
  );
}

function isImplOf<M extends DescMethod>(
  _method: M,
  value: unknown,
): value is MethodImpl<M> {
  return typeof value === "function";
}

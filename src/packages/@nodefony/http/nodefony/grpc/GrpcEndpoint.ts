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
  openStreamLifecycle,
  resolveStreamTarget,
  STREAM_STALL_TIMEOUT_MS,
  type StreamLifecycle,
} from "../src/context/http/StreamLifecycle";
import { GRPC_DEFAULT_MAX_MESSAGE_BYTES } from "../src/grpc/limits";
import { applicationErrorCode } from "../src/grpc/refusal";
import DefaultErrorRenderer from "../service/error-renderer";
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

/**
 * La section `grpc` de la configuration http : protocoles servis (D3, point
 * 5) et bornes des messages (D4, points 1, 2 et 6).
 *
 * @experimental Surface gRPC, ADR-0026 D11.
 */
export interface IGrpcSettings extends IGrpcProtocols {
  /** Taille maximale d'un message reçu, après décompression (octets). */
  readonly readMaxBytes: number;
  /** Taille maximale d'un message émis (octets). */
  readonly writeMaxBytes: number;
  /** Exige l'en-tête `Connect-Protocol-Version` sur les requêtes Connect. */
  readonly requireConnectProtocolHeader: boolean;
}

/**
 * Levé par le repli de l'adaptateur (`fallback`), qui l'appelle de façon
 * SYNCHRONE quand aucune méthode ne correspond au chemin exact — casse
 * modifiée, le Router étant insensible à la casse. Une seule instance : le
 * repli ne paie aucune allocation, et `serve` le reconnaît par identité.
 */
const UNROUTED = new Error("gRPC : aucune méthode à ce chemin");

/**
 * Repli de l'adaptateur : rien n'est écrit ici. Le refus remonte au pipeline,
 * qui l'écrit au format du protocole comme tout chemin inconnu (ADR-0026 D13
 * point 2) — un seul écrivain des refus. Le repli par défaut de Connect, un
 * 404 nu terminé par une trame DATA, est lu `INTERNAL` par grpc-go
 * (connectrpc/connect-es#1882).
 */
function unrouted(): never {
  throw UNROUTED;
}

/**
 * Défauts de la section `grpc`, quand le contexte n'a pas de noyau http (banc
 * hors serveur) : les trois protocoles (défaut de l'adaptateur,
 * `router.d.ts`) et les bornes de Nodefony — jamais celles de l'adaptateur,
 * qui n'en pose aucune.
 */
const DEFAULT_SETTINGS: IGrpcSettings = Object.freeze({
  grpc: true,
  grpcWeb: true,
  connect: true,
  readMaxBytes: GRPC_DEFAULT_MAX_MESSAGE_BYTES,
  writeMaxBytes: GRPC_DEFAULT_MAX_MESSAGE_BYTES,
  requireConnectProtocolHeader: false,
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
  /** Case synchrone : le contexte de l'appel en cours de remise. */
  #pendingContext: HttpContext | null = null;
  /**
   * Option `contextValues` : une fiche par appel, rien sur le chemin du 404.
   * Accrochée au contexte (`HttpContext.rpc`, ADR-0026 D10) : à l'échéance du
   * délai de réponse, le noyau la termine au lieu d'écrire un 408/504.
   */
  readonly #contextValues = (): GrpcCall => {
    const context = this.#pendingContext;
    const call = new GrpcCall(this.#pendingTarget, context);
    if (context !== null) context.rpc = call;
    return call;
  };
  /**
   * Chemins des méthodes en flux (serveur, client, bidirectionnel) : elles
   * s'ouvrent par le cycle de vie d'un flux. Tout autre chemin — unaire, ou
   * inconnu, que l'adaptateur refusera sans rien écrire — garde son délai de
   * réponse.
   */
  readonly #streamingPaths: ReadonlySet<string>;

  constructor(service: S, options: IGrpcEndpointOptions = {}) {
    this.service = service;
    this.perCall = options.perCall ?? false;
    this.#streamingPaths = streamingPathsOf(service);
  }

  /**
   * Remet la requête du contexte à l'adaptateur, qui écrit lui-même la
   * réponse et ses trailers. Synchrone : rien n'est attendu ici.
   *
   * Avant de la remettre : le contexte est marqué répondu (`sended`), si bien
   * que le pipeline n'attend aucune réponse de l'action.
   *
   * - Appel unaire : le délai de réponse de Nodefony reste armé, et termine
   *   l'appel en 4 `DEADLINE_EXCEEDED` par sa fiche (`HttpContext.rpc`,
   *   ADR-0026 D4 point 3).
   * - Flux : aucune échéance. Il s'ouvre par le cycle de vie d'un flux
   *   (`openStreamLifecycle`, D4 point 4) — délai de réponse désarmé (à
   *   l'expiration il écrirait un 408/504 par-dessus l'adaptateur), place dans
   *   le budget de connexions longues par IP, client qui ne lit plus coupé
   *   par le balayage de blocage. Synchrone, sauf quand une session est à
   *   sauver : l'appel n'est remis qu'après.
   *
   * @param context - le contexte HTTP de la requête, pas encore répondu.
   * @param target - l'objet qui implémente le service pour cet appel.
   * @returns rien, ou la promesse de la remise quand une session est à sauver.
   * @throws HttpError 500 quand la réponse est déjà partie, ou que son
   *   transport n'est pas reconnu.
   * @throws HttpError 429 quand l'IP du client a déjà tous ses flux et sockets
   *   (`wsMaxConnectionsPerIp`) — rendu par le pipeline en 14 `UNAVAILABLE`.
   * @throws HttpError 400 quand l'adaptateur refuse la requête avant d'avoir
   *   rien écrit (requête sans autorité `Host`) — la réponse revient alors au
   *   pipeline.
   * @throws HttpError 404 quand aucune méthode ne correspond au chemin exact
   *   (casse modifiée) — rendu par le pipeline en 12 `UNIMPLEMENTED`.
   */
  serve(context: HttpContext, target: object): void | Promise<void> {
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
    // Un appel unaire GARDE le délai de Nodefony : à l'expiration, le noyau
    // termine l'appel par sa fiche (`HttpContext._onTimeout` →
    // `GrpcCall.expire`) — aucun minuteur de plus.
    if (!this.#streamingPaths.has(context.request.url.pathname)) {
      context.sended = true;
      this.#hand(context, target, handler, nodeResponse);
      return undefined;
    }
    // Un flux n'a aucune échéance : le délai de Nodefony est désarmé (à
    // l'expiration il écrirait un 408/504 par-dessus l'adaptateur), le cycle
    // de vie prend la réponse (`sended`) et une place de connexion longue.
    disarmResponseTimeout(streamTarget);
    const opened = openStreamLifecycle(context, {
      label: "gRPC",
      stallTimeout: STREAM_STALL_TIMEOUT_MS,
      maxDuration: false,
      foreignWriter: true,
    });
    if (opened instanceof Promise) {
      return opened.then((lifecycle) =>
        this.#handStream(lifecycle, target, handler, nodeResponse),
      );
    }
    this.#handStream(opened, target, handler, nodeResponse);
    return undefined;
  }

  /** Remet un flux à l'adaptateur — sauf si le client est déjà parti. */
  #handStream(
    lifecycle: StreamLifecycle,
    target: object,
    handler: NodeHandler,
    nodeResponse: NonNullable<HttpContext["response"]["response"]>,
  ): void {
    if (lifecycle.closed) return;
    this.#hand(lifecycle.context, target, handler, nodeResponse);
  }

  /**
   * Remet la requête à l'adaptateur. La fiche d'appel est créée par
   * `contextValues`, appelée de façon SYNCHRONE dans l'appel : les cases
   * `#pending*` ne vivent que le temps de celui-ci.
   */
  #hand(
    context: HttpContext,
    target: object,
    handler: NodeHandler,
    nodeResponse: NonNullable<HttpContext["response"]["response"]>,
  ): void {
    this.#pendingTarget = target;
    this.#pendingContext = context;
    try {
      handler(context.request.request, nodeResponse);
    } catch (error) {
      // `universalRequestFromNodeRequest` lève de façon SYNCHRONE, avant
      // d'écrire quoi que ce soit, sur une requête sans autorité ; le repli
      // aussi, sur un chemin sans méthode.
      if (nodeResponse.headersSent) throw error;
      context.sended = false;
      context.rpc = null;
      if (error === UNROUTED) {
        throw HttpError.withoutStack("Not Found", 404, context);
      }
      context.log(error, "WARNING", "GRPC");
      throw HttpError.withoutStack("gRPC : requête mal formée", 400, context);
    } finally {
      this.#pendingTarget = null;
      this.#pendingContext = null;
    }
  }

  /** Construit l'adaptateur, une fois, depuis la configuration http. */
  #build(context: HttpContext, target: object): NodeHandler {
    const settings: IGrpcSettings =
      context.httpKernel?.options.grpc ?? DEFAULT_SETTINGS;
    const shared = this.perCall ? null : target;
    const handler = connectNodeAdapter({
      grpc: settings.grpc,
      grpcWeb: settings.grpcWeb,
      connect: settings.connect,
      // Bornes posées sur l'adaptateur, jamais à l'inscription d'une méthode
      // (connectrpc/connect-es#1835). `readMaxBytes` borne aussi la
      // décompression (`envelope.js#envelopeDecompress`).
      readMaxBytes: settings.readMaxBytes,
      writeMaxBytes: settings.writeMaxBytes,
      requireConnectProtocolHeader: settings.requireConnectProtocolHeader,
      contextValues: this.#contextValues,
      fallback: unrouted,
      jsonOptions: { registry: contractRegistry(this.service) },
      routes: (router) => registerMethods(router, this.service, shared),
    });
    this.#handler = handler;
    return handler;
  }
}

/** Les chemins `/<paquet.Service>/<Méthode>` des méthodes en flux du contrat. */
function streamingPathsOf(service: DescService): ReadonlySet<string> {
  const paths = new Set<string>();
  for (const method of service.methods) {
    if (!isUnary(method)) paths.add(`/${service.typeName}/${method.name}`);
  }
  return paths;
}

/**
 * Fin d'un appel unaire (ADR-0026 D4, point 3) : l'appel se termine au plus
 * tard au délai de réponse du serveur, même si le gestionnaire ne lit pas son
 * signal.
 *
 * - L'adaptateur tient l'échéance DU CLIENT et abaisse `ctx.signal`, mais
 *   attend la promesse du gestionnaire
 *   (`invoke-implementation.js#invokeUnaryImplementation`) : un gestionnaire
 *   sourd tiendrait l'appel ouvert sans fin.
 * - Le délai du serveur est celui que Nodefony arme déjà sur toute requête,
 *   gardé sur une route unaire : à l'expiration, `HttpContext._onTimeout`
 *   appelle `GrpcCall.expire`, qui abaisse le signal et rejette la promesse
 *   rendue ici avec 4 `DEADLINE_EXCEEDED`. Aucun minuteur de plus.
 * - Ce délai n'est PAS écrit dans l'en-tête d'échéance : le gestionnaire
 *   verrait par `ctx.timeoutMs()` une échéance que le client n'a pas envoyée
 *   (suite de conformité de Connect : « server echoed back a timeout but none
 *   was expected »).
 * - Un résultat synchrone passe tel quel : ni promesse, ni suivi.
 */
function settleUnary<T>(
  result: T | Promise<T>,
  ctx: HandlerContext,
): T | Promise<T> {
  if (!(result instanceof Promise)) return result;
  const call = ctx.values;
  if (!(call instanceof GrpcCall)) return result;
  const pending: Promise<T> = result;
  return new Promise<T>((resolve, reject) => {
    call.attach(ctx, reject);
    pending.then(
      (value) => {
        call.detach();
        resolve(value);
      },
      (error: unknown) => {
        call.detach();
        // Erreur de l'application : traduite comme une route HTTP la lirait
        // (ADR-0026 D7) ; toute autre valeur passe, l'adaptateur en fait 13.
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors
        reject(translateError(error, ctx));
      },
    );
  });
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
      if (shared !== null) {
        const impl = pick(method, shared);
        router.rpc(method, (request, ctx) =>
          settleUnary(invoke(impl, shared, request, ctx), ctx),
        );
      } else {
        router.rpc(method, (request, ctx) => {
          const target = callTarget(ctx);
          return settleUnary(
            invoke(pick(method, target), target, request, ctx),
            ctx,
          );
        });
      }
    } else if (isServerStreaming(method)) {
      if (shared !== null) {
        const impl = pick(method, shared);
        router.rpc(method, (request, ctx) =>
          translateFirst(invoke(impl, shared, request, ctx), ctx),
        );
      } else {
        router.rpc(method, (request, ctx) => {
          const target = callTarget(ctx);
          return translateFirst(
            invoke(pick(method, target), target, request, ctx),
            ctx,
          );
        });
      }
    } else if (isClientStreaming(method)) {
      if (shared !== null) {
        const impl = pick(method, shared);
        router.rpc(method, (requests, ctx) =>
          translateSettled(invoke(impl, shared, requests, ctx), ctx),
        );
      } else {
        router.rpc(method, (requests, ctx) => {
          const target = callTarget(ctx);
          return translateSettled(
            invoke(pick(method, target), target, requests, ctx),
            ctx,
          );
        });
      }
    } else if (isBiDiStreaming(method)) {
      if (shared !== null) {
        const impl = pick(method, shared);
        router.rpc(method, (requests, ctx) =>
          translateFirst(invoke(impl, shared, requests, ctx), ctx),
        );
      } else {
        router.rpc(method, (requests, ctx) => {
          const target = callTarget(ctx);
          return translateFirst(
            invoke(pick(method, target), target, requests, ctx),
            ctx,
          );
        });
      }
    }
  }
}

/**
 * Lit les erreurs comme une route HTTP les lirait : statut et message client
 * (`DefaultErrorRenderer.describe`). Sans état, partagé par tous les appels.
 */
const ERRORS = new DefaultErrorRenderer();

/**
 * Traduit une erreur levée par l'application en `ConnectError` (ADR-0026 D7) :
 * une `HttpError` d'un service partagé avec des routes HTTP, une validation, un
 * conflit, un code numérique, gardent leur sens — 404 → 5 `NOT_FOUND`, et non
 * 13. Le message suit la règle des routes HTTP (opaque pour un 5xx en
 * production) ; l'erreur d'origine reste la cause, côté serveur.
 *
 * Passent TELLES QUELLES : une `ConnectError` (son code est voulu), une valeur
 * qui n'est pas une `Error`, et une exception que rien ne classe (statut 500
 * hors `HttpError`) — l'adaptateur en fait 13 « internal error », sans jamais
 * envoyer sa cause.
 *
 * Chemin d'erreur seulement : rien n'est payé sur un appel qui réussit.
 */
function translateError(error: unknown, ctx: HandlerContext): unknown {
  if (!(error instanceof Error) || error instanceof ConnectError) return error;
  const { status, message } = ERRORS.describe(error);
  if (status === 500 && !(error instanceof HttpError)) return error;
  const call = ctx.values;
  const identified =
    call instanceof GrpcCall &&
    call.context !== null &&
    call.context.authenticatedUser() !== null;
  return new ConnectError(
    message,
    CONNECT_CODES[applicationErrorCode(status, identified)] ?? Code.Unknown,
    undefined,
    undefined,
    error,
  );
}

/**
 * Le `Code` de Connect de chaque code gRPC (index = numéro, 1 à 16). La table
 * D7 vit hors du sous-chemin gRPC, sans Connect (ADR-0026 D12) : elle rend
 * un nombre, que cette correspondance ramène au type attendu.
 */
const CONNECT_CODES: readonly (Code | undefined)[] = [
  undefined,
  Code.Canceled,
  Code.Unknown,
  Code.InvalidArgument,
  Code.DeadlineExceeded,
  Code.NotFound,
  Code.AlreadyExists,
  Code.PermissionDenied,
  Code.ResourceExhausted,
  Code.FailedPrecondition,
  Code.Aborted,
  Code.OutOfRange,
  Code.Unimplemented,
  Code.Internal,
  Code.Unavailable,
  Code.DataLoss,
  Code.Unauthenticated,
];

/**
 * Appelle l'implémentation sur sa cible ; une erreur levée de façon SYNCHRONE
 * (validation avant toute attente) est traduite ({@link translateError}). Un
 * `try` ne coûte rien à l'appel qui réussit.
 */
function invoke<A, R>(
  impl: (arg: A, ctx: HandlerContext) => R,
  target: object,
  arg: A,
  ctx: HandlerContext,
): R {
  try {
    return impl.call(target, arg, ctx);
  } catch (error) {
    throw translateError(error, ctx);
  }
}

/**
 * Flux client (une seule réponse) : toute erreur est traduite (ADR-0026 D7,
 * point 3). Une promesse par appel, aucune par message reçu.
 */
function translateSettled<T>(
  result: Promise<T>,
  ctx: HandlerContext,
): Promise<T> {
  return result.then(undefined, (error: unknown) => {
    throw translateError(error, ctx);
  });
}

/**
 * Flux serveur et bidirectionnel : traduit les erreurs levées AVANT le premier
 * message (validation, entité introuvable, droit refusé) — là où un service
 * partagé avec des routes HTTP lève (ADR-0026 D7, point 3). Après le premier
 * message, l'erreur passe telle quelle : 13, sauf une `ConnectError`, dont le
 * code est voulu.
 */
function translateFirst<T>(
  source: AsyncIterable<T>,
  ctx: HandlerContext,
): AsyncIterable<T> {
  return new FirstMessageTranslator(source, ctx);
}

/**
 * Itérateur d'un flux dont seule la PREMIÈRE lecture est suivie : une
 * promesse au premier message, puis un appel délégué par message, sans
 * allocation. `return` et `throw` vont à la source : un gestionnaire
 * `async function*` voit son `finally` s'exécuter quand le client part.
 */
class FirstMessageTranslator<T> implements AsyncIterator<T>, AsyncIterable<T> {
  readonly #source: AsyncIterator<T>;
  readonly #ctx: HandlerContext;
  #started = false;

  constructor(source: AsyncIterable<T>, ctx: HandlerContext) {
    this.#source = source[Symbol.asyncIterator]();
    this.#ctx = ctx;
  }

  [Symbol.asyncIterator](): this {
    return this;
  }

  next(): Promise<IteratorResult<T>> {
    if (this.#started) return this.#source.next();
    this.#started = true;
    return this.#source.next().then(undefined, (error: unknown) => {
      throw translateError(error, this.#ctx);
    });
  }

  return(value?: unknown): Promise<IteratorResult<T>> {
    const source = this.#source;
    return source.return === undefined
      ? Promise.resolve({ done: true, value: undefined })
      : source.return(value);
  }

  throw(error?: unknown): Promise<IteratorResult<T>> {
    const source = this.#source;
    if (source.throw !== undefined) return source.throw(error);
    return this.return().then(() => {
      throw error;
    });
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

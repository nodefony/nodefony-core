import { z } from "zod";
import {
  Nodefony,
  ACCESS_ACCOUNT_RESOLVER,
  ACCESS_TOKEN_VERIFIER,
  RequestContext,
  authorizeProtectedResource,
  BearerError,
  buildBearerChallenge,
  missingScopes,
  parseModuleConfig,
  protectedResourceMetadataUrl,
  readBearerHeader,
  BootConfigurationError,
  isPlainObject,
} from "nodefony";
import type {
  IAccessAccountResolver,
  IAccessPrincipal,
  IAccessTokenVerifier,
  IProtectedResourceInput,
  IMcpCaller,
  IMcpTool,
  IMcpToolResult,
  IMcpToolRun,
  RequestContextPayload,
} from "nodefony";
import type { Controller } from "@nodefony/framework";
import { mcpConfigSchema } from "../config/config";
import { mcpCallerRoles } from "./caller";
import { checkMcpAccess, isRelayedRequest } from "./guard";
import {
  JsonRpcError,
  jsonRpcFailure,
  MCP_SUPPORTED_VERSIONS,
  type McpProtocolVersion,
} from "./protocol";
import { handleMcpMessage } from "./server";
import type { IMcpCacheHints, IMcpCancellation, IServerInfo } from "./server";
import {
  createMcpResponseStream,
  MCP_STREAM_GRACE_MS,
  type IMcpEventSink,
} from "./stream";
import {
  collectMcpTools,
  declareMcpTools,
  insufficientScopeMessage,
  mcpCallScopes,
  mcpDeclaredScopes,
  mcpText,
} from "./tools";

/**
 * Une porte MCP sur HTTP — la mécanique, sans la route.
 *
 * `@nodefony/ai` ne monte AUCUNE route : une porte se DÉCLARE, par qui en a
 * besoin — devkit pour l'outillage de développement, une application pour ses
 * propres outils, en développement ou en production selon son choix. On la
 * définit une fois ({@link defineMcpGate}), on la sert d'une ligne
 * (`gate.serve(this, body)`). Gardes d'origine et de localité, validation du
 * jeton, défi `401` avec `resource_metadata`, traduction HTTP ↔ JSON-RPC, flux
 * SSE, refus `405` des verbes retirés : une porte qui recoderait l'une de ces
 * règles finirait plus permissive que les autres sans que rien ne le dise.
 */

/**
 * Plafond d'un événement sur le flux de réponse MCP, octets UTF-8 — celui de la
 * réponse finale, qui porte le résultat entier de l'outil (16 Mio).
 */
export const MCP_STREAM_MAX_EVENT_BYTES = 16 * 1024 * 1024;

/** Sévérités qu'une porte MCP écrit au journal. */
export type McpGateSeverity = "DEBUG" | "WARNING" | "ERROR" | "CRITIC";

/** Un objet a-t-il la forme d'un outil MCP (nom, description, schéma, handler) ? */
function isMcpToolLike(value: unknown): value is IMcpTool {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "description" in value &&
    typeof value.description === "string" &&
    "inputSchema" in value &&
    typeof value.inputSchema === "object" &&
    value.inputSchema !== null &&
    "handler" in value &&
    typeof value.handler === "function"
  );
}

/**
 * Le schéma d'une porte — les réglages de transport et d'autorisation de
 * {@link mcpConfigSchema} (les MÊMES clés que `devkit.mcp.*`), plus ce que la
 * porte publie et comment. Strict : une clé inconnue arrête le démarrage en la
 * nommant, au lieu d'être ignorée.
 */
export const mcpGateSchema = mcpConfigSchema
  .extend({
    name: z
      .string()
      .min(1)
      .optional()
      .describe("Nom annoncé à l'agent ; défaut : le nom du projet"),
    version: z
      .string()
      .min(1)
      .optional()
      .describe("Version annoncée à l'agent ; défaut : celle de Nodefony"),
    instructions: z
      .string()
      .min(1)
      .optional()
      .describe("Ce que l'agent lit pour savoir QUAND se servir de la porte"),
    tools: z
      .union([
        z.literal("modules"),
        z.array(
          z.custom<IMcpTool>(isMcpToolLike, {
            message:
              "un outil MCP porte `name`, `description`, `inputSchema` et `handler`",
          }),
        ),
      ])
      .describe(
        'Les outils servis : une liste, ou `"modules"` pour ceux que déclarent les modules chargés (`getMcpTools()`)',
      ),
    unprotectedRoles: z
      .array(z.string().min(1))
      .default([])
      .describe(
        "Rôles accordés à qui entre SANS jeton (porte sans `authorization`) ; défaut : aucun",
      ),
    protocol: z
      .strictObject({
        versions: z
          .array(z.enum(MCP_SUPPORTED_VERSIONS))
          .min(1)
          .optional()
          .describe(
            "Révisions du protocole acceptées ; défaut : toutes celles du paquet installé",
          ),
      })
      .default({}),
    cache: z
      .strictObject({
        ttlMs: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Durée de fraîcheur des listes, en millisecondes"),
        scope: z
          .enum(["public", "private"])
          .default("private")
          .describe("`private` dès que la liste dépend de l'appelant"),
      })
      .default({ ttlMs: 0, scope: "private" }),
  })
  .superRefine((value, ctx) => {
    // Une porte protégée dérive les rôles du JETON : des rôles « sans jeton »
    // n'y auraient aucun effet — l'écrire laisse croire le contraire.
    if (
      value.unprotectedRoles.length > 0 &&
      value.authorization.authorizationServers.length > 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["unprotectedRoles"],
        message:
          "`unprotectedRoles` ne s'applique qu'à une porte SANS serveur " +
          "d'autorisation : une porte protégée tire les rôles des scopes du jeton.",
      });
    }
  });

/** Ce qu'on écrit pour définir une porte (défauts compris). */
export type IMcpGateDefinition = z.input<typeof mcpGateSchema>;

/** Les réglages EFFECTIFS d'une porte, validés et figés. */
export type IMcpGateSettings = z.output<typeof mcpGateSchema>;

/** Ce que la porte a reçu — lu par elle, jamais par la mécanique. */
export interface IMcpGateRequest<S extends IMcpEventSink = IMcpEventSink> {
  /** Corps tel que le parseur HTTP l'a rendu (`{}` pour un JSON illisible). */
  body: unknown;
  /**
   * Le corps BRUT, lu à la demande : seul moyen de distinguer un `{}` envoyé
   * d'un texte qui ne se parse pas (JSON-RPC `-32700` contre `-32600`). Appelé
   * uniquement quand le corps n'a aucune clé.
   */
  rawBody?: (() => string | undefined) | undefined;
  /** En-tête `Origin`. */
  origin?: string | undefined;
  /** En-tête `MCP-Protocol-Version`. */
  protocolVersion?: string | undefined;
  /** En-tête `Authorization`. */
  authorization?: string | undefined;
  /** Adresse de l'appelant (après `trustProxy`). */
  remoteAddress?: string | undefined;
  /**
   * La requête a traversé un relais (en-tête `Forwarded`, `X-Forwarded-For`,
   * `X-Real-IP` ou `Via`) — refusée par une porte locale.
   */
  relayed?: boolean | undefined;
  /** Abattu quand le client abandonne la requête. */
  signal?: AbortSignal | undefined;
  /**
   * Ouvre un flux SSE — absent quand le client n'en accepte pas : la
   * progression devient alors muette, jamais refusée.
   */
  openStream?: (() => S | Promise<S>) | undefined;
  /**
   * Prévenu de l'identifiant du compte au nom duquel un outil agit — pour le
   * journal de la requête, qui le lit au démontage, hors de la bulle.
   */
  onAccount?: ((identifier: string) => void) | undefined;
}

/**
 * Ce qu'un transport de process (stdio) a reçu : une ligne, sans en-tête ni
 * adresse.
 */
export interface IMcpStdioRequest {
  /** La ligne reçue, telle quelle — un message JSON-RPC, en principe. */
  line: string;
  /** Abattu quand le client s'en va (entrée standard fermée). */
  signal?: AbortSignal | undefined;
  /**
   * Ouvre le puits où écrire les notifications de l'appel, puis sa réponse
   * finale — absent, la progression devient muette.
   */
  openStream?: (() => IMcpEventSink | Promise<IMcpEventSink>) | undefined;
}

/** Ce que l'environnement fournit à une réponse — `serve()` le lit seul. */
export interface IMcpGateRuntime {
  /** Les modules chargés, pour une porte `tools: "modules"`. */
  modules?: Readonly<Record<string, unknown>> | undefined;
  /** Qui sait valider un jeton — requis dès qu'un serveur d'autorisation est déclaré. */
  verifier?: IAccessTokenVerifier | undefined;
  /**
   * Qui retrouve le compte qu'un jeton désigne — requis par un outil
   * `actsForUser` ; absent, un tel outil refuse de s'exécuter.
   */
  accountResolver?: IAccessAccountResolver | undefined;
  /** Identité annoncée ; défaut : `name`/`version` de la porte, sinon le projet. */
  serverInfo?: IServerInfo | undefined;
  /** Journal de la porte ; muet si absent. */
  log?: ((message: string, severity: McpGateSeverity) => void) | undefined;
}

/** Réponse DÉCRITE par la mécanique — la porte l'écrit. */
export type IMcpGateResponse<S extends IMcpEventSink = IMcpEventSink> =
  | {
      kind: "json";
      status: number;
      body: unknown;
      headers?: Readonly<Record<string, string>>;
    }
  | {
      kind: "empty";
      status: number;
      headers?: Readonly<Record<string, string>>;
    }
  | { kind: "stream"; stream: S };

/**
 * Un `tools/call` exige-t-il, par ses ARGUMENTS, des scopes que l'appelant n'a
 * pas ? Seul un outil SERVI est jugé : un nom retenu reste « inconnu », son
 * existence n'est pas révélée par un défi.
 *
 * @param body - message JSON-RPC reçu (objet)
 * @param tools - outils servis à cet appelant
 * @param caller - appelant établi
 * @returns les scopes de l'opération et le message, ou `null` si rien ne manque
 *   (ou si l'appel n'est pas jugeable ici — le moteur le refusera lui-même)
 */
function requiredElevation(
  body: object,
  tools: readonly IMcpTool[],
  caller: IMcpCaller,
): {
  scopes: readonly string[];
  missing: readonly string[];
  message: string;
} | null {
  if (!("method" in body) || body.method !== "tools/call") return null;
  if (!("params" in body) || typeof body.params !== "object") return null;
  const params = body.params;
  if (params === null || !("name" in params)) return null;
  const tool = tools.find((candidate) => candidate.name === params.name);
  if (tool?.scopesFor === undefined) return null;
  const args =
    "arguments" in params && isPlainObject(params.arguments)
      ? params.arguments
      : {};
  const scopes = mcpCallScopes(tool, args);
  if (scopes === null) return null;
  const missing = missingScopes(caller.scopes, scopes);
  return missing.length === 0
    ? null
    : {
        scopes,
        missing,
        message: insufficientScopeMessage(tool.name, missing),
      };
}

/** Une porte MCP définie — à servir depuis une action de controller. */
export interface IMcpGate {
  /** Les réglages effectifs, validés et figés. */
  readonly settings: IMcpGateSettings;
  /**
   * Sert la requête courante d'un controller : `POST` sert le message, `GET` et
   * `DELETE` rendent `405` (verbes retirés par la révision `2026-07-28`).
   *
   * @param controller - le controller de la porte.
   * @param body - le corps reçu (`@Body()`).
   * @returns ce que l'action doit rendre.
   */
  serve(controller: Controller, body: unknown): Promise<unknown>;
  /**
   * Répond à UN `POST` décrit — sans controller, éprouvable sans serveur (et
   * réutilisable par un autre transport).
   *
   * @param request - ce que la porte a reçu.
   * @param runtime - modules, vérificateur, identité, journal.
   * @returns la réponse à écrire ; `stream` quand un flux SSE a été ouvert.
   */
  respond<S extends IMcpEventSink>(
    request: IMcpGateRequest<S>,
    runtime?: IMcpGateRuntime,
  ): Promise<IMcpGateResponse<S>>;
  /**
   * Répond à UNE ligne reçue sur l'entrée standard — le pendant de
   * {@link IMcpGate.respond} pour un client qui lance lui-même son serveur.
   *
   * Ni origine, ni adresse, ni jeton : la frontière est celle du process.
   * L'appelant est anonyme et porte les rôles d'une porte non protégée
   * (`unprotectedRoles`, aucun par défaut) ; les outils réservés restent
   * retenus. Les annulations (`notifications/cancelled`) visent l'unique
   * appelant du process ; un appel annulé ne produit PLUS RIEN — ni
   * progression, ni réponse (`empty`), comme la spec l'exige en stdio. Le
   * statut de la réponse décrite n'a pas de sens hors HTTP : seul son corps
   * s'écrit.
   *
   * @param request - la ligne reçue, et le puits où écrire.
   * @param runtime - modules, identité, journal.
   * @returns la réponse à écrire ; `stream` quand le puits a déjà tout reçu.
   */
  respondStdio(
    request: IMcpStdioRequest,
    runtime?: IMcpGateRuntime,
  ): Promise<IMcpGateResponse>;
  /**
   * Ce que la porte protège, à publier en RFC 9728 — une entrée, ou rien.
   *
   * Un service qui expose `publishedProtectedResources()` voit
   * `@nodefony/framework` monter le document ; les scopes publiés sont ceux
   * que le défi exige. Rôle éteint (aucun serveur d'autorisation) ⇒ rien : un
   * document sans `authorization_servers` apprendrait au client qu'un jeton est
   * nécessaire sans lui dire où l'obtenir.
   *
   * @param modules - les modules chargés, pour une porte `tools: "modules"`.
   * @returns zéro ou une entrée.
   */
  protectedResources(
    modules?: Readonly<Record<string, unknown>>,
  ): readonly IProtectedResourceInput[];
}

const EMPTY_PROTECTED_RESOURCES: readonly IProtectedResourceInput[] =
  Object.freeze([]);

/** La porte coupée par configuration n'existe pas : elle ne se défend pas. */
const DISABLED: IMcpGateResponse<never> = Object.freeze({
  kind: "json",
  status: 404,
  body: Object.freeze({ error: "MCP désactivé" }),
});

/** `GET` / `DELETE` : `405`, `Allow: POST`. */
const METHOD_NOT_ALLOWED: IMcpGateResponse<never> = Object.freeze({
  kind: "empty",
  status: 405,
  headers: Object.freeze({ allow: "POST" }),
});

function failure(
  status: number,
  code: number,
  message: string,
  headers?: Readonly<Record<string, string>>,
): IMcpGateResponse<never> {
  const response: IMcpGateResponse<never> = {
    kind: "json",
    status,
    body: jsonRpcFailure(null, code, message),
  };
  if (headers) response.headers = headers;
  return response;
}

/** JSON-RPC 2.0 §5.1 : `-32700`, un texte qui ne se PARSE pas. */
function parseFailure(): IMcpGateResponse<never> {
  return failure(
    400,
    JsonRpcError.PARSE_ERROR,
    "corps illisible : JSON invalide",
  );
}

/** JSON-RPC 2.0 §5.1 : `-32600`, un JSON lisible qui n'est pas un message. */
function notAMessage(): IMcpGateResponse<never> {
  return failure(
    400,
    JsonRpcError.INVALID_REQUEST,
    "corps attendu : un message JSON-RPC (objet)",
  );
}

/** Clé d'annulation de l'unique appelant d'un transport de process. */
const STDIO_CALLER_KEY = "stdio";

/** L'appelant qu'un transport a établi, et ce qu'il lui doit. */
interface IAdmittedCaller {
  readonly caller: IMcpCaller;
  /** À qui appartiennent les appels que ce message peut annuler. */
  readonly callerKey: string;
  /** Ce que le vérificateur a établi — relu par un outil `actsForUser`. */
  readonly principal: IAccessPrincipal | null;
  /** Un scope manquant se dit-il par un défi `WWW-Authenticate` ? */
  readonly challenge: boolean;
  /** Prévenu quand le client annule l'appel de ce message. */
  readonly onCancelled?: (() => void) | undefined;
}

/** Ce qu'une porte stdio répond à un appel annulé : rien. */
const CANCELLED_SILENCE: IMcpGateResponse<never> = Object.freeze({
  kind: "empty",
  status: 202,
});

/**
 * Branche un témoin sur la table d'annulation : il est prévenu quand le client
 * annule l'appel inscrit. Sans témoin, la table est rendue telle quelle.
 */
function trackCancellation(
  cancellation: IMcpCancellation,
  onCancelled: (() => void) | undefined,
): IMcpCancellation {
  if (onCancelled === undefined) return cancellation;
  return {
    open(id) {
      const handle = cancellation.open(id);
      handle.signal.addEventListener("abort", onCancelled, { once: true });
      return handle;
    },
    cancel: (id, reason) => cancellation.cancel(id, reason),
  };
}

/** Ce que le tronc commun lit de l'échange, quel que soit le transport. */
type IMcpExchange<S extends IMcpEventSink> = Pick<
  IMcpGateRequest<S>,
  "signal" | "openStream" | "onAccount" | "protocolVersion"
>;

/**
 * L'en-tête porte-t-il un gabarit d'interpolation jamais substitué ?
 *
 * Un `.mcp.json` déclare son jeton par `${NF_MCP_TOKEN}` : le client développe
 * la variable, ou transmet la chaîne telle quelle si elle manque. Le second cas
 * ne se distingue d'un jeton invalide par AUCUN symptôme observable de
 * l'extérieur, et c'est pourtant le plus fréquent des deux.
 */
function isUnsubstitutedTemplate(header: string | undefined): boolean {
  const read = readBearerHeader(header);
  return (
    read.kind === "token" &&
    read.token.startsWith("${") &&
    read.token.endsWith("}")
  );
}

/**
 * Le corps reçu est-il un texte qui ne se PARSE pas en JSON ?
 *
 * Le parseur HTTP ignore un JSON malformé et rend `{}` : seul le brut permet
 * de distinguer un `{}` envoyé d'un texte illisible. Relu uniquement sur ce
 * chemin froid (corps vide d'apparence).
 */
function unparsableBody(
  body: unknown,
  rawBody: (() => string | undefined) | undefined,
): boolean {
  if (
    rawBody === undefined ||
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length > 0
  ) {
    return false;
  }
  const text = rawBody()?.trim();
  if (!text) return false;
  try {
    JSON.parse(text);
    return false;
  } catch {
    return true;
  }
}

/** Première valeur d'un en-tête HTTP, ou rien. */
function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Définit une porte MCP — UNE fois, à côté de son controller.
 *
 * La définition est validée et figée ici : une clé inconnue, une révision du
 * protocole que le paquet installé ne sait pas servir, un outil mal formé, un
 * nom en double ou réservé (`nodefony_`) lèvent une `BootConfigurationError`
 * qui nomme la faute — au démarrage, jamais à la première requête. Chaque
 * requête ne paie ensuite aucune validation.
 *
 * ```ts
 * const shopGate = defineMcpGate({
 *   name: "shop",
 *   instructions: "Stock et commandes du magasin.",
 *   tools: [stockTool, orderTool],
 * });
 *
 * @route("shop-mcp", { path: "/mcp", requirements: { methods: ["POST", "GET", "DELETE"] } })
 * mcp(@Body() body: unknown) {
 *   return shopGate.serve(this, body);
 * }
 * ```
 *
 * Défauts : appels locaux seulement (`allowRemote: false`), aucune origine
 * navigateur, aucun jeton exigé, AUCUN rôle accordé — les outils réservés
 * (`scopes`, `requiresAuth`) restent retenus tant qu'une `authorization` ne
 * les ouvre pas.
 *
 * @param definition - ce que la porte publie, à qui, et comment.
 * @returns la porte, prête à servir.
 * @throws BootConfigurationError si la définition est invalide.
 */
export function defineMcpGate(definition: IMcpGateDefinition): IMcpGate {
  const label =
    typeof definition.name === "string" && definition.name.length > 0
      ? `porte MCP « ${definition.name} »`
      : "porte MCP";
  const settings = Object.freeze(
    parseModuleConfig(mcpGateSchema, definition, label),
  );

  // Une liste d'outils se vérifie ICI, une fois : forme du nom, doublon, préfixe
  // réservé aux modules du framework. Servie telle quelle, la même faute se
  // serait dite à chaque requête, dans un journal que personne ne lit.
  let fixedModules: Readonly<Record<string, unknown>> | null = null;
  if (settings.tools !== "modules") {
    const tools = settings.tools;
    fixedModules = Object.freeze({
      gate: Object.freeze({
        // Une porte d'application n'est jamais un module du framework : le
        // préfixe réservé `nodefony_` lui est refusé quel que soit son nom.
        getModuleName: () => undefined,
        getMcpTools: () => tools,
      }),
    });
    const faults: string[] = [];
    declareMcpTools({
      modules: fixedModules,
      onSkip: (why) => faults.push(why),
    });
    if (faults.length > 0) {
      throw new BootConfigurationError(
        `[${label}] outils refusés — ${faults.join(" ; ")}`,
      );
    }
  }

  // Révisions servies, dans l'ordre de préférence du MOTEUR (la plus récente en
  // tête) : c'est elle qu'on annonce à un client qui demande l'inconnu.
  const pinned = settings.protocol.versions;
  const versions: readonly McpProtocolVersion[] = pinned
    ? Object.freeze(MCP_SUPPORTED_VERSIONS.filter((v) => pinned.includes(v)))
    : MCP_SUPPORTED_VERSIONS;
  const cache: IMcpCacheHints = Object.freeze({
    ttlMs: settings.cache.ttlMs,
    cacheScope: settings.cache.scope,
  });
  const gateProtected = settings.authorization.authorizationServers.length > 0;

  /** Les modules dont la porte sert les outils, pour CETTE requête. */
  function servedModules(
    runtime: IMcpGateRuntime | undefined,
  ): Readonly<Record<string, unknown>> | undefined {
    return fixedModules ?? runtime?.modules;
  }

  // Appels en cours, annulables par `notifications/cancelled` — clé = appelant
  // + identifiant JSON-RPC. Allouée au premier appel d'outil, jamais avant ;
  // chaque entrée meurt avec son appel (`close`).
  let inflight: Map<string, AbortController> | null = null;

  /**
   * La table des appels en cours, vue d'UN appelant : il n'atteint que les
   * appels qu'il a lui-même émis.
   */
  function cancellationFor(
    callerKey: string,
    log: IMcpGateRuntime["log"],
  ): IMcpCancellation {
    // `1` et `"1"` sont deux identifiants JSON-RPC distincts.
    const keyOf = (id: string | number) =>
      `${callerKey}\u0000${typeof id === "number" ? "n" : "s"}${id}`;
    return {
      open(id) {
        const key = keyOf(id);
        const controller = new AbortController();
        inflight ??= new Map();
        // Un identifiant déjà en cours pour CET appelant enfreint l'unicité que
        // le protocole impose au client : le premier garde sa place, le second
        // reste annulable par la fermeture de son flux.
        const owned = !inflight.has(key);
        if (owned) inflight.set(key, controller);
        return {
          signal: controller.signal,
          close() {
            if (owned && inflight?.get(key) === controller)
              inflight.delete(key);
          },
        };
      },
      cancel(id, reason) {
        const controller = inflight?.get(keyOf(id));
        if (controller === undefined) return;
        log?.(
          `MCP — appel ${JSON.stringify(id)} annulé par le client${
            reason ? ` : ${reason}` : ""
          }`,
          "DEBUG",
        );
        controller.abort();
      },
    };
  }

  let defaultServerInfo: IServerInfo | null = null;
  /** Identité annoncée — résolue au premier usage, le kernel existant alors. */
  function serverInfo(): IServerInfo {
    defaultServerInfo ??= Object.freeze({
      name: settings.name ?? Nodefony.getKernel()?.projectName ?? "nodefony",
      version: settings.version ?? Nodefony.version,
    });
    return defaultServerInfo;
  }

  async function respond<S extends IMcpEventSink>(
    request: IMcpGateRequest<S>,
    runtime?: IMcpGateRuntime,
  ): Promise<IMcpGateResponse<S>> {
    const log = runtime?.log;
    if (!settings.enabled) return DISABLED;

    const verdict = checkMcpAccess(
      {
        origin: request.origin,
        remoteAddress: request.remoteAddress,
        relayed: request.relayed,
      },
      {
        allowedOrigins: settings.allowedOrigins,
        allowRemote: settings.allowRemote,
      },
    );
    if (!verdict.allowed) {
      // Le motif est LOGGÉ, jamais renvoyé : un appelant refusé n'a pas à
      // apprendre quelles origines seraient admises.
      log?.(`MCP refusé — ${verdict.why}`, "WARNING");
      return failure(403, JsonRpcError.INVALID_REQUEST, "origine refusée");
    }

    // JSON-RPC 2.0 §5.1 distingue `-32700` (texte qui ne se PARSE pas) de
    // `-32600` (JSON lisible qui n'est pas un message).
    const { body } = request;
    if (unparsableBody(body, request.rawBody)) return parseFailure();
    if (body === null || typeof body !== "object") return notAMessage();

    const modules = servedModules(runtime);

    // ─── Qui appelle ? ───────────────────────────────────────────────────────
    // La POSTURE se lit ici — seule la porte sait si elle est protégée — mais
    // la RÈGLE qui en déduit les rôles est `mcpCallerRoles`, partagée par toutes.
    const authz = settings.authorization;
    let caller: IMcpCaller = {
      authenticated: false,
      scopes: [],
      roles: mcpCallerRoles(
        { protected: gateProtected, authenticated: false, scopes: [] },
        settings.unprotectedRoles,
      ),
    };
    // À qui appartiennent les appels que cette requête peut annuler : le titulaire
    // du jeton (émetteur + sujet) s'il en présente un valide, sinon l'adresse
    // distante. Jamais l'identifiant JSON-RPC seul, que le client choisit.
    let callerKey = `addr\u0000${request.remoteAddress ?? ""}`;
    // Ce que le vérificateur a établi — seul un outil `actsForUser` le relit,
    // pour retrouver le compte.
    let principal: IAccessPrincipal | null = null;

    if (gateProtected) {
      const authVerdict = await authorizeProtectedResource(
        request.authorization,
        {
          resource: authz.resource,
          acceptedResources: authz.additionalResources,
          metadataUrl: protectedResourceMetadataUrl(authz.resource),
          // Ce que la porte EXIGE, dérivé de ses outils — la MÊME source que
          // le document RFC 9728 que ce défi fait lire (`protectedResources`).
          scopes: mcpDeclaredScopes({ modules }),
          allowAnonymous: authz.anonymous,
        },
        runtime?.verifier,
      );

      switch (authVerdict.outcome) {
        case "unverifiable":
          // 🔴 La porte se DIT protégée et le jeton n'a pas pu être jugé.
          // Servir reviendrait à accepter n'importe quel porteur. On refuse, et
          // on crie — deux causes, deux messages : rien n'est POSÉ, ou la
          // vérification a ÉCHOUÉ.
          log?.(
            authVerdict.why
              ? "MCP — la vérification du jeton a ÉCHOUÉ, le jeton n'est donc " +
                  "ni accepté ni refusé : la porte refuse de servir (503). " +
                  `Cause — ${authVerdict.why}`
              : "MCP — la porte déclare un serveur d'autorisation, mais aucun " +
                  "vérificateur de jeton n'est posé (`accessTokenVerifier`). " +
                  "La porte refuse de servir : accepter les porteurs sans les " +
                  "valider serait pire que rester anonyme.",
            "CRITIC",
          );
          return failure(
            503,
            JsonRpcError.INTERNAL_ERROR,
            "autorisation indisponible",
          );
        case "challenge":
          // 🔴 Un `Bearer ${…}` que personne n'a substitué : le client CROIT
          // présenter un jeton. La cause n'est pas devinable de l'extérieur —
          // elle se DIT.
          if (isUnsubstitutedTemplate(request.authorization)) {
            log?.(
              "MCP — l'en-tête `Authorization` porte un GABARIT non substitué : " +
                "la variable d'environnement du jeton n'est pas posée dans le " +
                "process du client. Émettre le jeton (`nodefony security:mcp:token`) " +
                "et le poser, ou rendre la porte anonyme pour ce client " +
                "(`nodefony ai:mcp --no-auth`) — sans en-tête, les outils " +
                "publics sont servis.",
              "WARNING",
            );
          }
          // Le défi porte `resource_metadata` : c'est lui qui apprend au
          // client où obtenir un jeton. Sans cet en-tête, le refus serait un mur.
          return failure(
            authVerdict.status,
            JsonRpcError.INVALID_REQUEST,
            "autorisation requise",
            { "WWW-Authenticate": authVerdict.wwwAuthenticate },
          );
        case "authenticated":
          // Les rôles VIENNENT DU JETON : l'audience prouve qu'il vise cette
          // ressource, pas ce que son porteur a le droit d'y faire.
          caller = {
            authenticated: true,
            scopes: authVerdict.principal.scopes,
            subject: authVerdict.principal.subject,
            roles: mcpCallerRoles({
              protected: true,
              authenticated: true,
              scopes: authVerdict.principal.scopes,
            }),
          };
          // L'émetteur compte : deux serveurs d'autorisation peuvent délivrer
          // le même sujet à deux comptes distincts.
          callerKey = `sub\u0000${authVerdict.principal.issuer}\u0000${authVerdict.principal.subject}`;
          principal = authVerdict.principal;
          break;
        case "anonymous":
          // 🔴 Un jeton PRÉSENTÉ et rejeté est servi en anonyme — jamais en
          // silence : c'est le symptôme d'un jeton à renouveler, ou d'une
          // tentative.
          if (authVerdict.rejected) {
            log?.(
              "MCP — jeton REJETÉ (expiré, mauvaise audience ou signature " +
                "invalide) : la requête est servie en ANONYME, les outils " +
                "réservés restent retenus. Renouveler le jeton " +
                "(`nodefony security:mcp:token`) pour les retrouver.",
              "WARNING",
            );
          }
          // Porte protégée qui tolère l'anonyme : il reste sans rôle.
          caller = {
            authenticated: false,
            scopes: [],
            roles: mcpCallerRoles({
              protected: true,
              authenticated: false,
              scopes: [],
            }),
          };
          break;
      }
    }

    return dispatch(
      body,
      { caller, callerKey, principal, challenge: gateProtected },
      request,
      modules,
      runtime,
    );
  }

  /**
   * Répond à UNE ligne reçue sur l'entrée standard.
   *
   * La frontière d'un transport de process est celle du process : qui a lancé
   * la commande a déjà un terminal dans l'application. Aucune origine, aucune
   * adresse, aucun jeton n'y voyage — les gardes de transport HTTP n'y ont rien
   * à juger. L'appelant reste donc anonyme et ne reçoit que les rôles d'une
   * porte NON protégée (aucun par défaut). Une porte protégée ne s'ouvre pas
   * davantage : sans jeton, ses outils réservés restent retenus.
   */
  async function respondStdio(
    request: IMcpStdioRequest,
    runtime?: IMcpGateRuntime,
  ): Promise<IMcpGateResponse> {
    if (!settings.enabled) {
      return failure(404, JsonRpcError.INVALID_REQUEST, "MCP désactivé");
    }
    let body: unknown;
    try {
      body = JSON.parse(request.line);
    } catch {
      return parseFailure();
    }
    if (body === null || typeof body !== "object") return notAMessage();
    // 🔴 Spec MCP, stdio § Cancellation : après `notifications/cancelled`, le
    // serveur ne doit PLUS RIEN envoyer pour cet appel — ni progression, ni
    // réponse. En HTTP la réponse part quand même (le `POST` doit se clore) ;
    // sur le canal unique de stdio, elle serait une faute de protocole.
    // Un objet, pas un `let` : l'analyse de flux ne voit pas l'écriture faite
    // par le rappel, et tiendrait le drapeau pour toujours faux.
    const call = { cancelled: false };
    const open = request.openStream;
    const exchange: IMcpExchange<IMcpEventSink> = {
      signal: request.signal,
      openStream:
        open &&
        (async () => {
          const sink = await open();
          return {
            get closed() {
              return call.cancelled || sink.closed;
            },
            send: (data: unknown) => sink.send(data),
          };
        }),
    };
    const reply = await dispatch(
      body,
      {
        caller: {
          authenticated: false,
          scopes: [],
          roles: mcpCallerRoles(
            { protected: gateProtected, authenticated: false, scopes: [] },
            settings.unprotectedRoles,
          ),
        },
        // Un seul appelant : le process qui a lancé la commande.
        callerKey: STDIO_CALLER_KEY,
        principal: null,
        // Aucun jeton à élargir : `callMcpTool` rend l'`isError`.
        challenge: false,
        onCancelled: () => {
          call.cancelled = true;
        },
      },
      exchange,
      servedModules(runtime),
      runtime,
    );
    return call.cancelled ? CANCELLED_SILENCE : reply;
  }

  /**
   * Le tronc commun à tous les transports, une fois l'appelant établi :
   * collecte, élévation, flux, moteur.
   */
  async function dispatch<S extends IMcpEventSink>(
    body: object,
    admitted: IAdmittedCaller,
    exchange: IMcpExchange<S>,
    modules: Readonly<Record<string, unknown>> | undefined,
    runtime: IMcpGateRuntime | undefined,
  ): Promise<IMcpGateResponse<S>> {
    const log = runtime?.log;
    const { caller, principal } = admitted;
    // Ramassés À CHAQUE requête, jamais mémorisés : un module ajouté — ou
    // rechargé par le superviseur de développement — apparaît sans cache à
    // invalider. Le nombre d'outils retenus est annoncé, pour qu'un agent
    // apprenne qu'un jeton lui ouvrirait davantage ; jamais leur nom.
    let withheldCount = 0;
    const tools = collectMcpTools({
      modules,
      caller,
      // Un outil écarté se DIT : sans ce journal, son auteur chercherait la
      // faute dans un handler que rien n'a jamais appelé.
      onSkip: (why) => log?.(`MCP — ${why}`, "WARNING"),
      // Une rétention n'est PAS une faute : DEBUG, sinon le journal se noie.
      onWithheld: (name, why) => {
        withheldCount += 1;
        log?.(`MCP — outil « ${name} » retenu : ${why}`, "DEBUG");
      },
    });

    // ─── Ce que CES arguments exigent (élévation à la demande) ──────────────
    // Jugé AVANT tout flux : un `403` ne s'écrit plus une fois le flux ouvert.
    // Le défi nomme TOUS les scopes de l'opération en une fois (spec MCP,
    // « Runtime Insufficient Scope Errors »). Porte non protégée : aucun jeton
    // à élargir, `callMcpTool` rend l'`isError` — la même règle, `mcpCallScopes`.
    if (admitted.challenge) {
      const elevation = requiredElevation(body, tools, caller);
      if (elevation !== null) {
        const metadataUrl = protectedResourceMetadataUrl(
          settings.authorization.resource,
        );
        return failure(
          caller.authenticated ? 403 : 401,
          JsonRpcError.INVALID_REQUEST,
          elevation.message,
          {
            "WWW-Authenticate": buildBearerChallenge({
              resourceMetadataUrl: metadataUrl,
              scopes: elevation.scopes,
              // RFC 6750 §3 : sans jeton présenté, aucun code d'erreur.
              ...(caller.authenticated
                ? {
                    error: BearerError.INSUFFICIENT_SCOPE,
                    // RFC 6750 §3 : ASCII seul — le message français, accentué,
                    // y serait mutilé ; il part entier dans le corps.
                    description: `missing scope: ${elevation.missing.join(" ")}`,
                  }
                : {}),
            }),
          },
        );
      }
    }

    const stream = createMcpResponseStream<S>({
      signal: exchange.signal,
      open: exchange.openStream,
      // Un outil long sans `progressToken` ouvrirait sinon jamais son flux,
      // et sa réponse JSON tomberait sous le délai d'inactivité (408).
      graceMs: MCP_STREAM_GRACE_MS,
      onError: (error, final) =>
        log?.(
          `MCP — ${final ? "réponse finale" : "notification"} perdue sur le flux : ${
            error instanceof Error ? error.message : String(error)
          }`,
          final ? "WARNING" : "DEBUG",
        ),
    });
    // Un outil qui agit au nom du compte s'enveloppe pour tout message, SAUF
    // la liste, qui n'exécute rien : la règle « quelle méthode appelle un
    // outil » appartient au moteur — la relire ici en liste blanche laisserait
    // une méthode future exécuter l'outil hors de la bulle.
    const served =
      principal !== null && !("method" in body && body.method === "tools/list")
        ? actingTools(tools, {
            principal,
            resolver: runtime?.accountResolver,
            onAccount: exchange.onAccount,
            log,
          })
        : tools;
    const reply = await handleMcpMessage(
      body,
      {
        tools: served,
        caller,
        withheldCount,
        transport: stream.transport,
        cancellation: trackCancellation(
          cancellationFor(admitted.callerKey, log),
          admitted.onCancelled,
        ),
        serverInfo: runtime?.serverInfo ?? serverInfo(),
        versions,
        cache,
        ...(settings.instructions !== undefined
          ? { instructions: settings.instructions }
          : {}),
      },
      // L'en-tête de révision voyage jusqu'au protocole : face au `_meta` du
      // corps, il permet de refuser une requête que deux intermédiaires
      // liraient à des versions différentes.
      { protocolVersion: exchange.protocolVersion },
    );

    // L'agent n'a reçu qu'un message générique : le détail de l'exception
    // n'existe QU'ICI.
    if (reply.failure) {
      const { tool, error } = reply.failure;
      log?.(
        `MCP — l'outil « ${tool} » a levé : ${
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error)
        }`,
        "ERROR",
      );
    }

    // Un flux ouvert en route : la réponse finale le CLÔT.
    const sse = await stream.finish(reply.body);
    if (sse !== null) return { kind: "stream", stream: sse };
    // `202 Accepted` SANS corps pour une notification : un objet JSON ferait
    // échouer un client conforme, qui n'attend rien à lire.
    if (reply.body === null) return { kind: "empty", status: reply.status };
    return { kind: "json", status: reply.status, body: reply.body };
  }

  return Object.freeze({
    settings,
    respond,
    respondStdio,

    async serve(controller: Controller, body: unknown): Promise<unknown> {
      const context = controller.context;
      const method = context?.method;
      if (method === "GET" || method === "DELETE") {
        // La révision `2026-07-28` a retiré le flux `GET` et la clôture de
        // session `DELETE`, et demande ce `405`. Sans lui, la requête tombe dans
        // une autre route (un repli SPA rend `200` + HTML) que le client prend
        // pour un flux rompu et rouvre indéfiniment.
        return write(
          controller,
          settings.enabled ? METHOD_NOT_ALLOWED : DISABLED,
        );
      }
      const request = controller.request;
      const headers = request?.headers ?? {};
      const response = await respond(
        {
          body,
          rawBody: () =>
            request && "data" in request
              ? request.data.toString(request.charset)
              : undefined,
          origin: firstHeader(headers.origin),
          protocolVersion: firstHeader(headers["mcp-protocol-version"]),
          authorization: firstHeader(headers.authorization),
          remoteAddress: context?.remoteAddress ?? undefined,
          relayed: isRelayedRequest(headers),
          signal: context?.signal,
          // Le journal de requête nomme qui a agi, comme sous une zone.
          onAccount:
            gateProtected && context
              ? (identifier: string) => {
                  context.userIdentifier = identifier;
                }
              : undefined,
          // La réponse finale peut dépasser le plafond d'un événement
          // ordinaire : un résultat d'outil n'a pas de borne en JSON, il n'en
          // reçoit pas une plus basse en flux.
          openStream: controller.acceptsSse()
            ? () =>
                controller.renderSse({
                  maxEventBytes: MCP_STREAM_MAX_EVENT_BYTES,
                })
            : undefined,
        },
        {
          modules:
            fixedModules === null
              ? (context?.kernel?.modules ?? Nodefony.getKernel()?.modules)
              : undefined,
          // Résolu par NOM, et seulement pour une porte protégée : le
          // vérificateur vit dans `@nodefony/security`, dont ce paquet ne
          // dépend pas.
          verifier: gateProtected
            ? (controller.get<IAccessTokenVerifier>(ACCESS_TOKEN_VERIFIER) ??
              undefined)
            : undefined,
          // Même rendez-vous par NOM, posé par le même module.
          accountResolver: gateProtected
            ? (controller.get<IAccessAccountResolver>(
                ACCESS_ACCOUNT_RESOLVER,
              ) ?? undefined)
            : undefined,
          log: (message, severity) => controller.log(message, severity),
        },
      );
      return write(controller, response);
    },

    protectedResources(
      modules?: Readonly<Record<string, unknown>>,
    ): readonly IProtectedResourceInput[] {
      const authz = settings.authorization;
      if (!settings.enabled || !gateProtected) {
        return EMPTY_PROTECTED_RESOURCES;
      }
      return [
        {
          resource: authz.resource,
          authorizationServers: authz.authorizationServers,
          scopesSupported: mcpDeclaredScopes({
            modules: fixedModules ?? modules,
          }),
          resourceName: authz.resourceName,
          resourceDocumentation: authz.resourceDocumentation,
        },
      ];
    },
  });
}

/** Écrit une réponse décrite sur un controller. */
function write(
  controller: Controller,
  response: IMcpGateResponse<Awaited<ReturnType<Controller["renderSse"]>>>,
) {
  switch (response.kind) {
    case "stream":
      // La réponse finale a été écrite sur le flux : il ne reste qu'à le clore.
      return response.stream.close();
    case "empty":
      return controller.renderResponse(
        "",
        undefined,
        response.status,
        response.headers,
      );
    case "json":
      return controller.renderJson(
        response.body,
        response.status,
        response.headers,
      );
  }
}

/** Ce qu'il faut à un outil `actsForUser` pour s'exécuter au nom du compte. */
interface IActingContext {
  readonly principal: IAccessPrincipal;
  readonly resolver: IAccessAccountResolver | undefined;
  readonly onAccount: ((identifier: string) => void) | undefined;
  readonly log: IMcpGateRuntime["log"];
}

/**
 * Message UNIFORME d'un compte inutilisable — la cause (introuvable,
 * verrouillé, sujet externe sans rattachement) part au journal, jamais à
 * l'agent : un refus détaillé dirait quels comptes existent.
 */
const ACCOUNT_UNAVAILABLE =
  "le compte désigné par le jeton n'est pas utilisable : l'outil ne s'exécute pas";

/** Plus long délai qu'un minuteur accepte (2³¹ − 1 ms, ~24,8 jours). */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Les outils servis, ceux qui agissent au nom du compte enveloppés : leur
 * handler s'exécute dans une bulle de requête où le compte est posé.
 *
 * Aucune allocation tant qu'aucun outil ne le déclare : la liste servie est
 * rendue telle quelle.
 */
function actingTools(
  tools: readonly IMcpTool[],
  acting: IActingContext,
): readonly IMcpTool[] {
  let wrapped: IMcpTool[] | null = null;
  for (const [index, tool] of tools.entries()) {
    if (tool.actsForUser !== true) continue;
    wrapped ??= tools.slice();
    wrapped[index] = {
      ...tool,
      handler: (args, caller, run) =>
        runAsAccount(tool, args, caller, run, acting),
    };
  }
  return wrapped ?? tools;
}

/**
 * Exécute un outil au nom du compte que désigne le jeton.
 *
 * Le compte est retrouvé AVANT le handler : les lecteurs de l'identité
 * (`RequestContext.getAuthenticatedUser()`, le voteur de rôles) sont
 * synchrones, une résolution paresseuse ne les atteindrait jamais. La bulle est
 * un NOUVEL objet — elle hérite de la corrélation et du scope de la requête,
 * deux appels concurrents ne se voient pas — vidée en `finally`. Le handler
 * meurt avec le jeton : son signal s'abat à l'expiration.
 *
 * Fail-closed : sans résolveur (CRITIC) ou sans compte utilisable, l'appel rend
 * `isError` — jamais une exécution en anonyme. Une PANNE du résolveur lève, et
 * la porte la traite comme l'exception d'un outil (journal, `-32603` opaque).
 */
async function runAsAccount(
  tool: IMcpTool,
  args: Record<string, unknown>,
  caller: IMcpCaller,
  run: IMcpToolRun | undefined,
  acting: IActingContext,
): Promise<IMcpToolResult> {
  const { principal, resolver, log } = acting;
  if (resolver === undefined) {
    log?.(
      `MCP — l'outil « ${tool.name} » agit au nom d'un compte, mais aucun ` +
        `résolveur de compte n'est posé (\`${ACCESS_ACCOUNT_RESOLVER}\`, ` +
        "module `@nodefony/security`) : l'appel est refusé plutôt que servi " +
        "en anonyme.",
      "CRITIC",
    );
    return mcpText(ACCOUNT_UNAVAILABLE, true);
  }
  const account = await resolver(principal);
  if (account === null) {
    log?.(
      `MCP — l'outil « ${tool.name} » : aucun compte utilisable pour le sujet ` +
        `du jeton (émetteur ${principal.issuer}) — introuvable, inactif, ` +
        "verrouillé ou sans rattachement. Appel refusé.",
      "WARNING",
    );
    return mcpText(ACCOUNT_UNAVAILABLE, true);
  }
  const remainingMs =
    principal.expiresAt === undefined
      ? null
      : principal.expiresAt * 1000 - Date.now();
  if (remainingMs !== null && remainingMs <= 0) {
    return mcpText("le jeton a expiré : l'outil ne s'exécute pas", true);
  }
  acting.onAccount?.(account.user.identifier);
  const store: RequestContextPayload = {
    ...(RequestContext.get() ?? { requestId: "" }),
    token: account.token,
    user: account.user,
  };
  const bounded = boundedRun(run, remainingMs);
  try {
    return await RequestContext.run(store, () =>
      tool.handler(args, caller, bounded.run),
    );
  } finally {
    bounded.dispose();
    RequestContext.release(store);
  }
}

/** Rien à faire : ni minuteur à couper, ni écouteur à retirer, ni progression à porter. */
const NOOP = (): void => {};

/**
 * L'exécution prêtée au handler, bornée par l'expiration du jeton : son signal
 * s'abat quand l'agent abandonne OU quand le jeton expire.
 *
 * Minuteur `unref` et écouteur retirés par `dispose` — rien ne survit à
 * l'appel. Sans expiration connue (ou au-delà de ce qu'un minuteur accepte),
 * l'exécution d'origine est rendue telle quelle.
 */
function boundedRun(
  run: IMcpToolRun | undefined,
  remainingMs: number | null,
): { run: IMcpToolRun | undefined; dispose: () => void } {
  if (remainingMs === null || remainingMs > MAX_TIMER_MS) {
    return { run, dispose: NOOP };
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("jeton expiré")),
    remainingMs,
  );
  timer.unref();
  const parent = run?.signal;
  const onAbort = (): void => controller.abort(parent?.reason);
  if (parent?.aborted) controller.abort(parent.reason);
  else parent?.addEventListener("abort", onAbort, { once: true });
  return {
    run: {
      signal: controller.signal,
      progress: run ? run.progress.bind(run) : NOOP,
    },
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

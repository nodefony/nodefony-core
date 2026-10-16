import {
  authorizeProtectedResource,
  protectedResourceMetadataUrl,
  readBearerHeader,
} from "nodefony";
import type {
  IAccessTokenVerifier,
  IProtectedResourceInput,
  IMcpCaller,
} from "nodefony";
import type { Controller } from "@nodefony/framework";
import type { IMcpConfig } from "../config/config";
import { mcpCallerRoles } from "./caller";
import { checkMcpAccess } from "./guard";
import { JsonRpcError, jsonRpcFailure } from "./protocol";
import { handleMcpMessage } from "./server";
import type { IServerInfo } from "./server";
import { createMcpResponseStream, type IMcpEventSink } from "./stream";
import { collectMcpTools, mcpDeclaredScopes } from "./tools";

/**
 * Une porte MCP sur HTTP — la mécanique, sans la route.
 *
 * `@nodefony/ai` ne monte AUCUNE route : une porte se DÉCLARE, par qui en a
 * besoin — devkit pour l'outillage de développement, une application pour ses
 * propres outils, en développement ou en production selon son choix. Toutes
 * passent par {@link serveMcpRequest} : gardes d'origine et de localité,
 * validation du jeton, défi `401` avec `resource_metadata`, traduction
 * HTTP ↔ JSON-RPC, flux SSE. Une porte qui recoderait l'une de ces règles
 * finirait par être plus permissive que les autres sans que rien ne le dise.
 *
 * La fonction est PURE au sens qui compte : elle ne lit ni le kernel, ni le
 * conteneur, ni la requête — tout lui est donné, et elle rend une réponse
 * DÉCRITE, que la porte écrit. Seules sorties : le journal et l'ouverture du
 * flux, toutes deux fournies par l'appelant.
 */

/**
 * Plafond d'un événement sur le flux de réponse MCP, octets UTF-8 — celui de la
 * réponse finale, qui porte le résultat entier de l'outil (16 Mio).
 */
export const MCP_STREAM_MAX_EVENT_BYTES = 16 * 1024 * 1024;

/** Sévérités qu'une porte MCP écrit au journal. */
export type McpGateSeverity = "DEBUG" | "WARNING" | "ERROR" | "CRITIC";

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
  /** Abattu quand le client abandonne la requête. */
  signal?: AbortSignal | undefined;
  /**
   * Ouvre un flux SSE — absent quand le client n'en accepte pas : la
   * progression devient alors muette, jamais refusée.
   */
  openStream?: (() => S | Promise<S>) | undefined;
}

/** Ce que la PORTE décide — ses réglages, ses outils, son vérificateur. */
export interface IMcpGateOptions {
  /** Réglages de la porte (schéma {@link mcpConfigSchema}). */
  settings: IMcpConfig;
  /**
   * Les modules dont la porte sert les outils (`getMcpTools()`), ramassés à
   * CHAQUE requête. Une porte d'application passe les siens seulement ; la
   * porte de développement passe `kernel.modules`.
   */
  modules?: Readonly<Record<string, unknown>> | undefined;
  /** Qui sait valider un jeton — requis dès qu'un serveur d'autorisation est déclaré. */
  verifier?: IAccessTokenVerifier | undefined;
  /**
   * Rôles accordés par une porte NON protégée. **Aucun par défaut** : seule une
   * porte dont le périmètre protège (module `policy: "dev"`) a le droit de
   * l'élargir, et elle l'écrit.
   */
  operatorRoles?: readonly string[] | undefined;
  /** Identité annoncée à `initialize`. */
  serverInfo: IServerInfo;
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

const NO_ROLES: readonly string[] = [];
const EMPTY_PROTECTED_RESOURCES: readonly IProtectedResourceInput[] =
  Object.freeze([]);

/** La porte coupée par configuration n'existe pas : elle ne se défend pas. */
function disabled(): IMcpGateResponse<never> {
  return { kind: "json", status: 404, body: { error: "MCP désactivé" } };
}

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

/**
 * Sert UN message MCP reçu par une porte HTTP (`POST`).
 *
 * Les statuts rendus sont ceux que la spec impose, et pas un de plus : `202`
 * sans corps pour une notification acceptée, `403` pour une origine ou une
 * adresse refusée, `401` (défi `resource_metadata`) pour un jeton exigé,
 * `503` quand la porte se dit protégée sans pouvoir juger un jeton, `404`
 * pour une porte coupée ou une méthode inconnue.
 *
 * @param request - ce que la porte a reçu.
 * @param options - réglages, modules servis, vérificateur, rôles d'opérateur.
 * @returns la réponse à écrire ; `stream` quand un flux SSE a été ouvert en
 *   route — la porte n'a plus qu'à le clore.
 */
export async function serveMcpRequest<S extends IMcpEventSink>(
  request: IMcpGateRequest<S>,
  options: IMcpGateOptions,
): Promise<IMcpGateResponse<S>> {
  const { settings, log } = options;
  if (!settings.enabled) return disabled();

  const verdict = checkMcpAccess(
    { origin: request.origin, remoteAddress: request.remoteAddress },
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
  if (unparsableBody(body, request.rawBody)) {
    return failure(
      400,
      JsonRpcError.PARSE_ERROR,
      "corps illisible : JSON invalide",
    );
  }
  if (body === null || typeof body !== "object") {
    return failure(
      400,
      JsonRpcError.INVALID_REQUEST,
      "corps attendu : un message JSON-RPC (objet)",
    );
  }

  // ─── Qui appelle ? ─────────────────────────────────────────────────────────
  // La POSTURE se lit ici — seule la porte sait si elle est protégée — mais la
  // RÈGLE qui en déduit les rôles est `mcpCallerRoles`, partagée par toutes.
  const authz = settings.authorization;
  const gateProtected = authz.authorizationServers.length > 0;
  const operatorRoles = options.operatorRoles ?? NO_ROLES;
  let caller: IMcpCaller = {
    authenticated: false,
    scopes: [],
    roles: mcpCallerRoles(
      { protected: gateProtected, authenticated: false, scopes: [] },
      operatorRoles,
    ),
  };

  if (gateProtected) {
    const authVerdict = await authorizeProtectedResource(
      request.authorization,
      {
        resource: authz.resource,
        acceptedResources: authz.additionalResources,
        metadataUrl: protectedResourceMetadataUrl(authz.resource),
        // Ce que la porte EXIGE, dérivé de ses outils — la MÊME source que le
        // document RFC 9728 que ce défi fait lire (`mcpProtectedResources`).
        scopes: mcpDeclaredScopes({ modules: options.modules }),
        allowAnonymous: authz.anonymous,
      },
      options.verifier,
    );

    switch (authVerdict.outcome) {
      case "unverifiable":
        // 🔴 La porte se DIT protégée et le jeton n'a pas pu être jugé. Servir
        // reviendrait à accepter n'importe quel porteur. On refuse, et on crie
        // — deux causes, deux messages : rien n'est POSÉ, ou la vérification a
        // ÉCHOUÉ.
        log?.(
          authVerdict.why
            ? "MCP — la vérification du jeton a ÉCHOUÉ, le jeton n'est donc " +
                "ni accepté ni refusé : la porte refuse de servir (503). " +
                `Cause — ${authVerdict.why}`
            : "MCP — `mcp.authorization` déclare un serveur d'autorisation, mais " +
                "aucun vérificateur de jeton n'est fourni à la porte " +
                "(`accessTokenVerifier`). La porte refuse de servir : accepter les " +
                "porteurs sans les valider serait pire que rester anonyme.",
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
              "process du client. Émettre le jeton (`nodefony security:token`) " +
              "et le poser, ou rendre la porte anonyme pour ce client " +
              "(`nodefony ai:mcp --no-auth`) — sans en-tête, les outils " +
              "publics sont servis.",
            "WARNING",
          );
        }
        // Le défi porte `resource_metadata` : c'est lui qui apprend au client
        // où obtenir un jeton. Sans cet en-tête, le refus serait un mur.
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
              "(`nodefony security:token`) pour les retrouver.",
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

  // Ramassés À CHAQUE requête, jamais mémorisés : un module ajouté — ou
  // rechargé par le superviseur de développement — apparaît sans cache à
  // invalider. Le nombre d'outils retenus est annoncé (`server/discover`), pour
  // qu'un agent apprenne qu'un jeton lui ouvrirait davantage ; jamais leur nom.
  let withheldCount = 0;
  const tools = collectMcpTools({
    modules: options.modules,
    caller,
    // Un outil écarté se DIT : sans ce journal, son auteur chercherait la faute
    // dans un handler que rien n'a jamais appelé.
    onSkip: (why) => log?.(`MCP — ${why}`, "WARNING"),
    // Une rétention n'est PAS une faute : DEBUG, sinon le journal se noie.
    onWithheld: (name, why) => {
      withheldCount += 1;
      log?.(`MCP — outil « ${name} » retenu : ${why}`, "DEBUG");
    },
  });

  const stream = createMcpResponseStream<S>({
    signal: request.signal,
    open: request.openStream,
    onError: (error, final) =>
      log?.(
        `MCP — ${final ? "réponse finale" : "notification"} perdue sur le flux : ${
          error instanceof Error ? error.message : String(error)
        }`,
        final ? "WARNING" : "DEBUG",
      ),
  });
  const reply = await handleMcpMessage(
    body,
    {
      tools,
      caller,
      withheldCount,
      transport: stream.transport,
      serverInfo: options.serverInfo,
    },
    // L'en-tête de révision voyage jusqu'au protocole : face au `_meta` du
    // corps, il permet de refuser une requête que deux intermédiaires liraient
    // à des versions différentes.
    { protocolVersion: request.protocolVersion },
  );

  // L'agent n'a reçu qu'un message générique : le détail de l'exception
  // n'existe QU'ICI.
  if (reply.failure) {
    const { tool, error } = reply.failure;
    log?.(
      `MCP — l'outil « ${tool} » a levé : ${
        error instanceof Error ? (error.stack ?? error.message) : String(error)
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

/**
 * Répond à un `GET` ou un `DELETE` sur une porte MCP — `405`, `Allow: POST`.
 *
 * La révision `2026-07-28` du transport a retiré le flux `GET` et la clôture
 * de session `DELETE`, et demande ce `405` aux clients d'une révision
 * antérieure. Sans lui, la requête tombe dans une autre route (un repli SPA
 * rend `200` + HTML) que le client prend pour un flux rompu et rouvre
 * indéfiniment.
 *
 * @param settings - réglages de la porte (coupée ⇒ `404`, comme `POST`).
 * @returns la réponse à écrire.
 */
export function rejectUnsupportedMcpMethod(
  settings: Pick<IMcpConfig, "enabled">,
): IMcpGateResponse<never> {
  if (!settings.enabled) return disabled();
  return { kind: "empty", status: 405, headers: { allow: "POST" } };
}

/**
 * Ce qu'une porte MCP protège, à publier en RFC 9728 — une entrée, ou rien.
 *
 * Un service qui expose `publishedProtectedResources()` voit `@nodefony/framework`
 * monter le document ; une porte le compose ICI, pour que les scopes publiés
 * soient ceux que le défi exige ({@link serveMcpRequest}). Rôle éteint (aucun
 * serveur d'autorisation) ⇒ rien : un document sans `authorization_servers`
 * apprendrait au client qu'un jeton est nécessaire sans lui dire où l'obtenir.
 *
 * @param settings - réglages de la porte.
 * @param modules - les modules dont elle sert les outils.
 * @returns zéro ou une entrée.
 */
export function mcpProtectedResources(
  settings: IMcpConfig,
  modules?: Readonly<Record<string, unknown>>,
): readonly IProtectedResourceInput[] {
  const authz = settings.authorization;
  if (!settings.enabled || authz.authorizationServers.length === 0) {
    return EMPTY_PROTECTED_RESOURCES;
  }
  return [
    {
      resource: authz.resource,
      authorizationServers: authz.authorizationServers,
      scopesSupported: mcpDeclaredScopes({ modules }),
      resourceName: authz.resourceName,
      resourceDocumentation: authz.resourceDocumentation,
    },
  ];
}

/** Première valeur d'un en-tête HTTP, ou rien. */
function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Écrit une réponse MCP décrite par {@link serveMcpRequest} sur un controller.
 *
 * @param controller - le controller de la porte.
 * @param response - la réponse décrite.
 * @returns ce que l'action du controller doit rendre.
 */
export function writeMcpResponse(
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

/**
 * Fait d'une action de controller une porte MCP — l'usage courant.
 *
 * Lit ce que la mécanique attend dans la requête (en-têtes `Origin`,
 * `MCP-Protocol-Version`, `Authorization`, adresse, signal d'abandon, corps
 * brut, acceptation de SSE), sert le message par {@link serveMcpRequest} et
 * écrit la réponse. Le controller ne fournit que ce que lui seul sait : sa
 * route, ses réglages, les modules dont il sert les outils.
 *
 * ```ts
 * @route("app-mcp", { path: "/mcp", requirements: { methods: ["POST"] } })
 * mcp(@Body() body: unknown) {
 *   return serveMcp(this, body, {
 *     settings: this.get<AppService>("app").mcpSettings(),
 *     modules: { app: this.module },
 *     verifier: this.get<IAccessTokenVerifier>(ACCESS_TOKEN_VERIFIER) ?? undefined,
 *     serverInfo: { name: "mon-app", version: "1.0.0" },
 *   });
 * }
 * ```
 *
 * @param controller - le controller de la porte.
 * @param body - le corps reçu (`@Body()`).
 * @param options - ce que la porte décide ; `log` défaut = journal du controller.
 * @returns ce que l'action doit rendre.
 */
export async function serveMcp(
  controller: Controller,
  body: unknown,
  options: IMcpGateOptions,
) {
  const request = controller.request;
  const headers = request?.headers ?? {};
  const context = controller.context;
  const response = await serveMcpRequest(
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
      signal: context?.signal,
      // La réponse finale peut dépasser le plafond d'un événement ordinaire :
      // un résultat d'outil n'a pas de borne en JSON, il n'en reçoit pas une
      // plus basse en flux.
      openStream: controller.acceptsSse()
        ? () =>
            controller.renderSse({
              maxEventBytes: MCP_STREAM_MAX_EVENT_BYTES,
            })
        : undefined,
    },
    {
      ...options,
      log:
        options.log ??
        ((message, severity) => controller.log(message, severity)),
    },
  );
  return writeMcpResponse(controller, response);
}

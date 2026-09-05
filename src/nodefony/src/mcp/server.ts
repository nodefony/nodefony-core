import {
  JsonRpcError,
  McpProtocolError,
  MCP_PROTOCOL_VERSION,
  MCP_SUPPORTED_VERSIONS,
  MCP_DEFAULT_NEGOTIATED_VERSION,
  META_PROTOCOL_VERSION,
  META_SERVER_INFO,
  isNotification,
  jsonRpcFailure,
  jsonRpcSuccess,
  type IJsonRpcMessage,
  type IMcpHttpReply,
  type JsonRpcId,
} from "./protocol";
import {
  callMcpTool,
  publishMcpTools,
  type IMcpTool,
  type IMcpCaller,
} from "./tools";

/**
 * Cœur du serveur MCP : un message JSON-RPC entre, une réponse HTTP sort.
 *
 * **Fonction pure** — elle ne touche ni au socket, ni au conteneur, ni à
 * l'horloge. C'est ce qui permet d'éprouver le protocole entier (statuts
 * compris) sans démarrer de serveur, et c'est aussi ce qui rend le transport
 * interchangeable : le jour où un transport `stdio` serait nécessaire pour
 * répondre application éteinte, il appellerait cette même fonction.
 *
 * ## Ce que la révision 2026-07-28 change, et pourquoi c'est ce qui rend cette
 * porte viable
 *
 * Les sessions de niveau protocole ont disparu. Rien n'est retenu entre deux
 * appels : chaque `POST` porte tout ce qu'il faut pour être servi. Un
 * redémarrage du serveur de développement — celui que le superviseur déclenche
 * à chaque fichier sauvegardé — ne casse donc aucun état, et la réponse
 * suivante vient du code qui vient d'être rechargé. Aucun cache à invalider,
 * jamais : la fraîcheur est une propriété du protocole, pas une discipline.
 */

/** Ce que ce serveur sait faire, annoncé à l'initialisation. */
interface IServerInfo {
  name: string;
  version: string;
}

/** Tout ce dont le traitement d'un message a besoin. */
export interface IMcpServerContext {
  /**
   * Outils SERVIS, déjà ramassés et filtrés (`collectMcpTools`).
   *
   * ⭐ Ce sont des outils exécutables, pas des noms : c'est ce qui rend le
   * protocole indépendant du catalogue. Tant que cette fonction recevait une
   * allowlist de clés, elle devait connaître le catalogue pour la résoudre —
   * et un serveur MCP d'un autre paquet aurait dû redéclarer le sien.
   */
  tools: readonly IMcpTool[];
  /** Identité annoncée au client. */
  serverInfo: IServerInfo;
  /**
   * Appelant établi par la porte, transmis aux handlers.
   *
   * Le protocole ne s'en sert PAS pour décider : la décision a déjà été prise à
   * la collecte, et `tools` ne contient que ce qui lui revient. Il le transporte
   * pour qu'un outil puisse borner ce qu'il REND à son sujet.
   */
  caller?: IMcpCaller;
  /**
   * Combien d'outils la collecte a RETENUS pour cet appelant.
   *
   * Sert uniquement à l'annonce de `server/discover` — un nombre, jamais un
   * nom. Absent ou `0` = rien à signaler.
   */
  withheldCount?: number;
}

/** En-têtes HTTP dont le protocole se sert. */
export interface IMcpHeaders {
  /** `MCP-Protocol-Version`, absent chez un client de l'ère legacy. */
  protocolVersion?: string;
}

/**
 * Extrait la révision déclarée dans `params._meta`, s'il y en a une.
 *
 * Un client MODERNE la pose à chaque requête ; un client LEGACY ne pose rien
 * et négocie par `initialize`. L'absence n'est donc pas une faute : c'est un
 * indice d'ère.
 */
function metaVersion(params: Record<string, unknown>): string | undefined {
  const meta = params._meta;
  if (typeof meta !== "object" || meta === null) return undefined;
  const value = (meta as Record<string, unknown>)[META_PROTOCOL_VERSION];
  return typeof value === "string" ? value : undefined;
}

/**
 * La requête relève-t-elle de l'ère MODERNE (≥ 2026-07-28) ?
 *
 * L'ère se lit de la déclaration du client — `_meta` OU en-tête, la spec les
 * fait équivalents (leur discordance est déjà refusée en amont). Aucune
 * déclaration = client legacy. Les révisions sont des dates ISO : la
 * comparaison lexicale EST la comparaison chronologique, et une révision
 * future reste moderne sans qu'on y revienne.
 */
function isModernRequest(
  params: Record<string, unknown>,
  headers: IMcpHeaders,
): boolean {
  const declared = metaVersion(params) ?? headers.protocolVersion;
  return declared !== undefined && declared >= MCP_PROTOCOL_VERSION;
}

/**
 * Donne à un résultat la FORME de l'ère du client.
 *
 * Ère moderne : `resultType` est un **MUST** du schéma (« Servers implementing
 * this protocol version MUST include this field ») et `_meta` serverInfo un
 * SHOULD sur chaque réponse. Payé par une connexion réelle : le client
 * officiel (claude-code 2.1.238) rejoue quatre fois un `tools/list` moderne
 * sans `resultType`, puis n'enregistre AUCUN outil — serveur « connected »,
 * porte morte. Un serveur qui annonce l'ère moderne et répond en forme legacy
 * est injoignable, exactement comme l'inverse l'était (cf
 * `MCP_SUPPORTED_VERSIONS`).
 *
 * Ère legacy : résultat inchangé — un client ≤ 2025-11-25 ne définit pas ces
 * champs, les lui envoyer serait du bruit d'une autre ère.
 */
function eraResult(
  modern: boolean,
  serverInfo: IServerInfo,
  result: Record<string, unknown>,
): Record<string, unknown> {
  if (!modern) return result;
  return {
    ...result,
    resultType: "complete",
    _meta: {
      ...(result._meta as Record<string, unknown> | undefined),
      [META_SERVER_INFO]: serverInfo,
    },
  };
}

/**
 * Compose les `instructions` annoncées au client (`initialize` aujourd'hui ;
 * `server/discover` le jour de sa réactivation — cf le retrait plus bas).
 *
 * ⭐ **Le seul endroit où un catalogue filtré peut cesser de mentir par
 * omission.** Un outil retenu faute d'autorisation est, pour le client,
 * indistinguable d'un outil inexistant — c'est voulu (ne pas révéler ce qu'on
 * protège), mais pris au pied de la lettre cela ferait conclure « cette
 * application n'a rien de plus », quand la vérité est « rien de plus POUR TOI,
 * en l'état ». Un agent qui l'ignore ne demandera jamais de jeton.
 *
 * Le compromis retenu : dire qu'il EXISTE des outils réservés et combien, sans
 * jamais les nommer ni dire ce qu'ils font. C'est strictement moins que ce
 * qu'un `401` normalisé révélera le jour où le rôle *resource server* sera
 * branché (RFC 6750 + RFC 9728 disent « il faut un jeton » ET où l'obtenir) —
 * donc rien n'est concédé ici qui ne le soit déjà par la norme.
 *
 * Zéro outil retenu → aucune phrase : annoncer une réserve vide entraînerait un
 * agent à chercher une porte qui n'existe pas.
 */
function discoverInstructions(context: IMcpServerContext): string {
  // ⚠️ Les outils sont NOMMÉS depuis ce qui est réellement servi, jamais
  // récités : une énumération écrite ici taisait `docs` deux sessions après sa
  // livraison — déclaré dans le code, absent de la phrase qui présente la
  // porte, et donc invisible pour l'agent qui la lit en premier.
  const names = context.tools.map((tool) => tool.name);
  const base =
    "Outils d'introspection d'une application Nodefony — ils répondent depuis " +
    "l'application qui TOURNE, pas depuis une lecture des sources. " +
    (names.length > 0
      ? `Disponibles ici : ${names.join(", ")}. Commence par la carte de visite si tu arrives sur cette application.`
      : "Aucun outil n'est servi à cet appelant.");
  const withheld = context.withheldCount ?? 0;
  if (withheld <= 0) {
    return base;
  }
  return (
    `${base} ${withheld} outil(s) supplémentaire(s) sont RÉSERVÉS et ne ` +
    "figurent pas dans `tools/list` : ils exigent une autorisation que cette " +
    "requête ne présente pas. Ce n'est pas une panne, et rien ne sert de les " +
    "deviner — le document de ressource protégée de cette porte (RFC 9728) " +
    "nomme les scopes à demander, et le défi du refus dit où le lire. Ce sont " +
    "eux qu'il faut faire porter au jeton, pas un contournement."
  );
}

/**
 * Choisit la révision à ANNONCER en réponse à `initialize`.
 *
 * 🔴 **Répondre sa propre révision préférée est un bug, pas une politesse.** La
 * spec est explicite : si le serveur sait servir la version demandée, il DOIT
 * répondre celle-là ; sinon, une autre qu'il sait servir — à charge pour le
 * client de raccrocher. Ignorer `params.protocolVersion` et annoncer sa
 * dernière révision rend la porte injoignable par tout client qui ne la connaît
 * pas encore, ce qui est le cas de TOUS tant qu'un SDK n'a pas rattrapé la spec.
 * Vécu : un serveur annonçant `2026-07-28` était refusé par
 * `@modelcontextprotocol/sdk@1.30.0` (« Server's protocol version is not
 * supported ») — conforme à la dernière norme, et parlant à personne.
 *
 * Un client MUET n'obtient pas notre préférée non plus, mais
 * {@link MCP_DEFAULT_NEGOTIATED_VERSION} : c'est la révision que la spec impose
 * de supposer en l'absence de déclaration.
 *
 * @param params - `params` de la requête `initialize`
 * @returns la révision à annoncer
 */
function negotiateVersion(params: Record<string, unknown>): string {
  const asked =
    typeof params.protocolVersion === "string"
      ? params.protocolVersion
      : metaVersion(params);
  if (asked === undefined) {
    return MCP_DEFAULT_NEGOTIATED_VERSION;
  }
  return (MCP_SUPPORTED_VERSIONS as readonly string[]).includes(asked)
    ? asked
    : MCP_PROTOCOL_VERSION;
}

/**
 * Contrôle la cohérence et le support de la révision annoncée.
 *
 * Deux refus distincts, et la spec impose les deux :
 *  - **en-tête ≠ `_meta`** → `400` + `HeaderMismatch` (`-32020`). Le motif est
 *    une vraie faille : un répartiteur de charge peut router sur l'en-tête
 *    pendant que le serveur exécute d'après le corps — deux sources de vérité
 *    pour une même requête.
 *  - **révision inconnue** → `400` + `UnsupportedProtocolVersion` (`-32022`),
 *    **avec la liste de celles qu'on sert** : c'est elle qui permet au client
 *    de se rattraper au lieu d'abandonner.
 *
 * @returns `null` si tout va bien, sinon la réponse de refus
 */
function checkProtocolVersion(
  id: JsonRpcId | null,
  params: Record<string, unknown>,
  headers: IMcpHeaders,
): IMcpHttpReply | null {
  const fromMeta = metaVersion(params);
  const fromHeader = headers.protocolVersion;

  if (fromMeta && fromHeader && fromMeta !== fromHeader) {
    return {
      status: 400,
      body: jsonRpcFailure(
        id,
        McpProtocolError.HEADER_MISMATCH,
        "MCP-Protocol-Version ne correspond pas à _meta",
        { header: fromHeader, meta: fromMeta },
      ),
    };
  }

  const declared = fromMeta ?? fromHeader;
  // Aucune déclaration : client de l'ère legacy. La spec autorise à le servir
  // (`MAY treat a request that omits the header as protocol version
  // 2025-03-26`) ; c'est le choix DUAL-ÈRE assumé ici.
  if (!declared) return null;

  if (!(MCP_SUPPORTED_VERSIONS as readonly string[]).includes(declared)) {
    return {
      status: 400,
      body: jsonRpcFailure(
        id,
        McpProtocolError.UNSUPPORTED_PROTOCOL_VERSION,
        "Unsupported protocol version",
        { supported: [...MCP_SUPPORTED_VERSIONS], requested: declared },
      ),
    };
  }
  return null;
}

/**
 * Traite UN message JSON-RPC.
 *
 * @param message - corps du `POST`, déjà parsé
 * @param context - outils autorisés et briques qui répondent
 * @param headers - en-têtes du transport (`MCP-Protocol-Version`)
 * @returns statut HTTP et corps à écrire (corps `null` = `202` sans contenu)
 */
export async function handleMcpMessage(
  message: IJsonRpcMessage,
  context: IMcpServerContext,
  headers: IMcpHeaders = {},
): Promise<IMcpHttpReply> {
  if (
    message === null ||
    typeof message !== "object" ||
    typeof message.method !== "string"
  ) {
    return {
      status: 400,
      body: jsonRpcFailure(
        null,
        JsonRpcError.INVALID_REQUEST,
        "message JSON-RPC invalide : `method` manquante",
      ),
    };
  }

  const method = message.method;

  // Une NOTIFICATION n'attend aucune réponse. La spec impose `202 Accepted`
  // sans corps quand on l'accepte — répondre un objet JSON ici ferait échouer
  // un client conforme, qui n'attend rien à lire.
  if (isNotification(message)) {
    return { status: 202, body: null };
  }

  const id = message.id as JsonRpcId;
  const params = (
    typeof message.params === "object" && message.params !== null
      ? message.params
      : {}
  ) as Record<string, unknown>;

  const refusal = checkProtocolVersion(id, params, headers);
  if (refusal) return refusal;

  // L'ère du CLIENT décide de la forme de chaque résultat (cf `eraResult`).
  const modern = isModernRequest(params, headers);

  switch (method) {
    // ─── `server/discover` : NON SERVI, et c'est une décision, pas un oubli ──
    // La spec 2026-07-28 en fait un MUST pour un serveur moderne — et ce
    // serveur l'a servi, conforme au schéma champ pour champ. Mesuré alors sur
    // le client dominant (claude-code 2.1.238, proxy journalisant) : quand
    // `server/discover` RÉPOND, le client bascule sur son fil moderne, rejoue
    // `tools/list` quatre fois — réponse conforme (`resultType`, `_meta`),
    // rejouée en JSON puis en SSE — et n'enregistre AUCUN outil : serveur
    // « connected », porte morte. Quand `server/discover` rend -32601, le même
    // client suit le repli que la spec prévoit (« tries server/discover, gets
    // an error, falls back to initialize ») et enregistre les quatre outils.
    // Un serveur legacy est un citoyen légitime de l'écosystème ; un serveur
    // moderne que le seul client déployé ne sait pas finir d'écouter n'est
    // conforme que sur le papier (cf `nodefony-rfc` : conforme ≠ joignable).
    // RÉACTIVER (remettre le `case` — `eraResult` et les tests du fil moderne
    // sont restés en place) le jour où un client réel achève ce fil.

    // ─── Ère LEGACY : le handshake que les clients déployés emploient encore ──
    // ⚠️ `initialize` appartient à l'ère legacy (≤ 2025-11-25) ; le servir fait
    // de ce serveur un DUAL-ÈRE, ce que la spec autorise explicitement
    // (« A server that wishes to support both legacy clients […] MAY implement
    // both behaviors »). C'est un choix, pas un oubli : les clients réellement
    // déployés aujourd'hui ouvrent par `initialize`, et un serveur strictement
    // moderne ne serait joignable par aucun d'eux.
    case "initialize":
      return {
        status: 200,
        body: jsonRpcSuccess(id, {
          protocolVersion: negotiateVersion(params),
          // Seuls les outils sont servis : annoncer une capacité qu'on n'a pas
          // ferait porter au client des appels qui échoueraient ensuite.
          capabilities: { tools: {} },
          serverInfo: context.serverInfo,
          // Le champ existe depuis 2024-11-05 — c'est ici que le catalogue
          // s'annonce (et que les outils RÉSERVÉS cessent de mentir par
          // omission) tant que `server/discover` n'est pas servi.
          instructions: discoverInstructions(context),
        }),
      };

    case "ping":
      // `EmptyResult` EST un `Result` : la forme d'ère s'applique aussi à lui.
      return {
        status: 200,
        body: jsonRpcSuccess(id, eraResult(modern, context.serverInfo, {})),
      };

    case "tools/list":
      return {
        status: 200,
        body: jsonRpcSuccess(
          id,
          eraResult(modern, context.serverInfo, {
            tools: publishMcpTools(context.tools),
          }),
        ),
      };

    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const args = (
        typeof params.arguments === "object" && params.arguments !== null
          ? params.arguments
          : {}
      ) as Record<string, unknown>;

      if (!name) {
        return {
          status: 400,
          body: jsonRpcFailure(
            id,
            JsonRpcError.INVALID_PARAMS,
            "`name` est requis pour `tools/call`",
          ),
        };
      }

      let result;
      try {
        result = await callMcpTool(name, args, context.tools, context.caller);
      } catch (error) {
        return {
          status: 200,
          body: jsonRpcFailure(
            id,
            JsonRpcError.INTERNAL_ERROR,
            `l'outil « ${name} » a échoué : ${(error as Error).message}`,
          ),
        };
      }

      if (result === null) {
        // Outil inconnu OU désactivé par l'allowlist : le client ne peut pas
        // distinguer les deux, et c'est voulu — un outil non exposé n'existe
        // pas de son point de vue.
        return {
          status: 200,
          body: jsonRpcFailure(
            id,
            JsonRpcError.INVALID_PARAMS,
            `outil inconnu « ${name} » — voir tools/list`,
          ),
        };
      }
      return {
        status: 200,
        body: jsonRpcSuccess(
          id,
          eraResult(modern, context.serverInfo, { ...result }),
        ),
      };
    }

    default:
      // `404`, et pas `200` : la spec l'exige explicitement pour une méthode
      // non implémentée, afin de distinguer ce cas d'un serveur qui n'hébergerait
      // pas du tout d'endpoint MCP.
      return {
        status: 404,
        body: jsonRpcFailure(
          id,
          JsonRpcError.METHOD_NOT_FOUND,
          `méthode inconnue « ${method} »`,
        ),
      };
  }
}

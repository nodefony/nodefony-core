import {
  JsonRpcPeer,
  PLATFORM_INBOUND,
  RpcError,
  RpcEnvelope,
  RequestContext,
  type RpcActionHandler,
  type JsonRpcPeerOptions,
  type IRealtimeWelcome,
  type IRealtimeDenied,
  type EventsMap,
  type ActionsMap,
  type DefaultEventsMap,
  type DefaultActionsMap,
  type EventNames,
  type EventPayload,
  type ActionNames,
  type ActionParams,
  type ActionResult,
} from "nodefony";
import type { WebsocketContext, ProfiledResolver } from "@nodefony/http";
import { readBackpressureOptions } from "@nodefony/http";
import { Controller } from "@nodefony/framework";
import { createSyslogUplinkHandler } from "./syslogUplink";
import {
  WsConnectionTransport,
  type RawWsConnection,
} from "../transport/WsConnectionTransport";
import {
  getRealtimeHub,
  type ChannelSink,
  type IRevocableConnection,
} from "./RealtimeHub";
import { ANONYMOUS_REALTIME_TOKEN } from "./AnonymousRealtimeToken";
import type {
  IRealtimeController,
  RealtimePublish,
  RealtimeInboundHandler,
} from "../../interfaces/IRealtimeController";
import type { IRealtimeHandshake } from "../../interfaces/IRealtimeHandshake";
import type { IRealtimeToken } from "../../interfaces/IRealtimeToken";
import {
  getRealtimeActions,
  getRealtimeChannels,
  getRealtimeInbound,
  getRealtimeChannelPolicies,
  DEFAULT_ACTION_POLICY,
  type RealtimeChannelFactory,
} from "../../decorators/realtimeDecorators";
import { welcomeEnv } from "./welcomeEnv";
import { deniedDetail } from "./deniedDetail";

/**
 * Statut HTTP-équivalent d'une erreur survenue pendant une invocation du pont.
 *
 * UNE seule lecture pour les trois sources possibles — la `RpcError` déjà mappée
 * (404 d'un path inconnu…), le `nodefonyError` HTTP-like levé par une action ou
 * une garde (`@IsGranted` → 403), et le `HttpError` 405 agrégé du Router. Écrire
 * ce test à trois endroits l'aurait fait diverger (règle : une décision, une
 * fonction).
 *
 * @returns le statut, ou `null` si l'erreur n'est pas HTTP-like (→ opaque).
 */
function httpStatusOfFrameError(e: unknown): number | null {
  if (e instanceof RpcError) {
    const status = (e.data as { status?: unknown } | undefined)?.status;
    if (typeof status === "number") return status;
    // Params invalides (JSON-RPC 2.0 §5.1 `-32602`) = requête malformée.
    return e.code === -32602 ? 400 : null;
  }
  const code = (e as { code?: unknown }).code;
  return typeof code === "number" && code >= 400 && code <= 599 ? code : null;
}

/**
 * Erreur renvoyée au pair pour une invocation en échec.
 *
 * Un refus est une RÉPONSE (statut exposé, symétrie d'un `fetch`) ; une panne
 * reste OPAQUE (`-32603` générique côté peer — Zero Trust). En profiling, l'id
 * du profil est joint aux refus : le client peut alors radiographier son propre
 * refus (le 403 `@IsGranted` devient pédagogique au lieu d'être un mur).
 */
function toFrameRpcError(
  e: unknown,
  status: number | null,
  requestId?: string,
): unknown {
  if (e instanceof RpcError) {
    if (!requestId) return e;
    const data =
      typeof e.data === "object" && e.data !== null
        ? { ...(e.data as Record<string, unknown>), requestId }
        : { requestId };
    return new RpcError(e.message, e.code, data);
  }
  if (status !== null) {
    const data: Record<string, unknown> = { status };
    if (requestId) data.requestId = requestId;
    return new RpcError(
      e instanceof Error ? e.message : String(e),
      -32000,
      data,
    );
  }
  return e;
}

/** État realtime PAR connexion ws, stocké sur le contexte (persiste entre messages). */
interface RealtimeConnState {
  welcomed: boolean;
  peer: JsonRpcPeer;
  transport: WsConnectionTransport;
  /** canal → sink de CETTE connexion auprès du hub partagé (pour se désabonner). */
  channels: Map<string, ChannelSink>;
  /** canaux full-duplex acceptant une entrée client (null si aucun — cas par défaut). */
  inbound: Record<string, RealtimeInboundHandler> | null;
}

interface RealtimeHolder {
  __nfRealtime?: RealtimeConnState;
}

// F1 (revue 0.6) — garde anti-spam : le WARNING « policies de canal non appliquées »
// (aucun frameAuthorizer câblé) n'est émis qu'UNE fois par process, quel que soit le
// nombre de connexions/controllers. Une fois suffit à alerter l'exploitant.
let warnedUnenforcedPolicies = false;

/**
 * RealtimeController — base d'un endpoint WebSocket temps réel SERVEUR (JSON-RPC 2.0).
 *
 * Factorise TOUT le protocole (handshake/welcome, discrimination request/notification/
 * response via {@link JsonRpcPeer}, actions `result`/`error`, pub/sub par canal, cleanup)
 * — écrit UNE fois, partagé par tous les modules. Un contrôleur concret ne déclare que
 * son métier : {@link createRealtimeChannel} (providers de canaux) + {@link realtimeActions}.
 *
 * Chaque connexion compose un `JsonRpcPeer` (le MÊME que `RealtimeClient` côté navigateur
 * — symétrie isomorphe) branché sur un {@link WsConnectionTransport}.
 *
 * Usage : le sous-classe garde sa route WS et délègue —
 * ```ts
 * @route("ws", { path: "/realtime", requirements: { methods: ["WEBSOCKET"] } })
 * async realtime(message: string | Buffer | null) { this.handleRealtime(message); }
 * ```
 *
 * Perf : les canaux sont **partagés** via {@link RealtimeHub} (1 provider/canal/pod, pas
 * 1 par connexion) ; chaque connexion n'ajoute/retire qu'un *sink* (fan-out). Provider
 * créé au 1ᵉʳ abonné, `dispose()` au dernier (`unsubscribe` ou `onFinish`). Le dispatch
 * d'action n'est payé que sur une requête `id`. C'est aussi le seam du backplane Redis.
 */
export abstract class RealtimeController<
  Emit extends EventsMap = DefaultEventsMap,
  Actions extends ActionsMap = DefaultActionsMap,
>
  extends Controller
  implements IRealtimeController
{
  /**
   * Map des factories de canaux EXACT, lue depuis les décorateurs `@RealtimeChannel`
   * au handshake (cold-path) et mémoïsée par instance. `null` = pas de décorateur
   * sur cette classe → la base court-circuite la lecture metadata par frame.
   */
  private _decoratedChannels: Record<string, RealtimeChannelFactory> | null =
    null;

  /**
   * Crée le provider d'un canal (listener/ticker → `publish`) et renvoie son `dispose`.
   * `null` si le canal est inconnu — la base ne souscrit pas.
   *
   * **Deux façons de déclarer un canal** (coexistent sans casse) :
   *  1. **Décorateur `@RealtimeChannel(name)`** sur une méthode (match EXACT, déclaratif).
   *  2. **Override de cette méthode** (pattern/regex, suffixe `:<ms>`, drill `@<pid>`).
   *
   * La base CONSULTE D'ABORD les décorateurs ; si aucun match, elle appelle
   * cette méthode (fallback). Défaut : `null`. Un controller qui n'utilise QUE
   * des décorateurs peut donc se passer d'override.
   */
  createRealtimeChannel(
    _channel: string,
    _publish: RealtimePublish,
  ): (() => void) | null {
    return null;
  }

  /** Actions RPC exposées (requête→réponse). À surcharger ; défaut : aucune. */
  protected realtimeActions(): Record<string, RpcActionHandler> {
    return {};
  }

  /** Canaux annoncés au handshake. À surcharger ; défaut : aucun. */
  protected realtimeChannels(): string[] {
    return [];
  }

  /**
   * Préfixes de canaux **broadcast** (cross-process) de cet endpoint. À surcharger ;
   * défaut : **aucun** → tous les canaux restent **instance-local** (observabilité,
   * état du pod). Un canal listé ici traverse le {@link IBackplane} (cluster IPC /
   * Redis) : chat, présence, notifications… Cf {@link RealtimeHub.markBroadcastChannel}
   * (défaut sûr : pas de fuite cross-pod de données per-instance sans intention explicite).
   */
  protected realtimeBroadcastChannels(): string[] {
    return [];
  }

  /**
   * Canaux FULL-DUPLEX acceptant une entrée client (`method` = nom du canal). À
   * surcharger ; défaut : **aucun** (sûr — un client ne peut rien pousser au serveur
   * tant qu'un canal n'est pas explicitement déclaré ici). Seam des backings entrants
   * (SIP, bridge). Cf {@link RealtimeInboundHandler} (params NON FIABLES).
   */
  protected realtimeInbound(): Record<string, RealtimeInboundHandler> {
    return {};
  }

  /**
   * Opt-in du **pont API** (« API souveraine », POC Ph.3) : `true` → la
   * connexion expose la méthode RPC `api.request {path}` qui re-route le path
   * porté par le message vers l'action controller correspondante — la MÊME
   * action que le GET REST (`socket.request("/nodefony/kernel/api/modules")`
   * côté client). Le pont n'atteint QUE les routes déclarant le transport
   * `WEBSOCKET` dans leurs `methods` (zéro bypass : une action dit à quels
   * transports elle répond). À surcharger ; défaut : `false` — aucune surface
   * d'invocation ajoutée à un hub sans intention explicite.
   */
  protected realtimeApiRequest(): boolean {
    return false;
  }

  /**
   * Point d'entrée à appeler depuis la route WS du contrôleur. `message === null`
   * = handshake (1ʳᵉ invocation) ; sinon = frame entrante.
   *
   * Le handshake est désormais ASYNC (seams sécu #2/#4 : origin check + run
   * d'authenticator au handshake). Les frames texte entrantes pendant
   * l'authentification sont DROP silencieusement — le transport JSON-RPC n'est pas
   * encore branché, il n'existe donc AUCUN canal pour porter un refus. Le silence
   * est structurel, pas un choix : c'est au client d'attendre `realtime:welcome`
   * avant de pousser.
   *
   * ⚠️ Cette phrase a longtemps ajouté « ce que `RealtimeClient` fait nativement ».
   * C'était FAUX : le client rejouait ses abonnements dès l'ouverture de la socket,
   * si bien qu'un `subscribe` posé avant le démarrage et TOUS ceux d'après une
   * reconnexion étaient perdus ici même, sans un mot des deux côtés. Un contrat écrit
   * d'un seul côté du fil n'est pas tenu ; il l'est désormais par
   * `RealtimeClient.replaySubscriptions` et les deux cas « la fenêtre où le serveur
   * écoute (welcome) » de `RealtimeClientCoverage.test.ts`.
   */
  protected handleRealtime(message: string | Buffer | null): void {
    const ctx = this.context as WebsocketContext | undefined;
    if (!ctx) return;
    if (message == null) {
      // Fire-and-forget — l'auth WS peut être async (cookie JWT → vérif sig…).
      // Erreurs déjà gérées dans `onHandshake` (close socket + log). Ce `void`
      // évite un unhandled rejection si quelque chose throw au-delà du catch.
      void this.onHandshake(ctx);
      return;
    }
    (ctx as unknown as RealtimeHolder).__nfRealtime?.transport.feed(
      message.toString(),
    );
  }

  /**
   * **L1 — duplex serveur→client.** Émet une REQUÊTE vers le client de CETTE
   * connexion (sur une action qu'il a exposée via `client.register(...)`) et attend
   * sa réponse. Possible depuis L0 : le client compose le même `JsonRpcPeer`, il
   * est donc un *callee* (avant L0 : `-32601` systématique).
   *
   * Usages : confirmation d'action (le serveur demande au client de valider),
   * invalidation de cache poussée AVEC accusé, health applicatif serveur→client.
   * Pour une notification sans réponse → {@link notifyClient} (ou un canal pub/sub).
   *
   * @returns le `result` du handler client ; rejette sur erreur applicative
   *   ({@link RpcError} `code`/`data` préservés), méthode inconnue (`-32601`),
   *   timeout, ou connexion fermée (`dispose`).
   * @throws (rejet) si le handshake n'est pas terminé (aucun peer encore).
   */
  protected requestClient<K extends ActionNames<Actions>>(
    method: K,
    params?: ActionParams<Actions, K>,
    timeoutMs?: number,
  ): Promise<ActionResult<Actions, K>> {
    const state = (this.context as unknown as RealtimeHolder).__nfRealtime;
    if (!state) {
      return Promise.reject(
        new Error(
          "requestClient: connexion realtime non établie (welcome non émis)",
        ),
      );
    }
    return state.peer.request(
      method as never,
      params as never,
      timeoutMs,
    ) as Promise<ActionResult<Actions, K>>;
  }

  /**
   * Notification CIBLÉE serveur→client (sans réponse) vers CETTE connexion, hors
   * canal pub/sub — pendant *fire-and-forget* de {@link requestClient}. Pour un
   * fan-out à N abonnés, préférer un canal (`publish` via le hub). No-op si le
   * handshake n'est pas terminé.
   */
  protected notifyClient<K extends EventNames<Emit>>(
    method: K,
    params?: EventPayload<Emit, K>,
  ): void {
    const state = (this.context as unknown as RealtimeHolder).__nfRealtime;
    state?.peer.notify(method as never, params as never);
  }

  /**
   * Handshake : seams sécurité #4 (Origin RFC 6455 §10.2) + #2 (authenticator
   * réseau) PUIS crée peer+transport, enregistre les actions, welcome + cleanup.
   *
   * Pipeline (cold path, 1× par connexion) :
   *  1. Origin check via `hub.checkOrigin()` (bypass si `csrf.checkOrigin.enabled=false`).
   *  2. Resolve authenticator via `hub.resolveAuthenticator(handshake)` (matchers
   *     ordonnés, 1ʳᵉ qui matche capture) → `authenticate()` async.
   *  3. Aucun match OU `enabled=false` → `ANONYMOUS_REALTIME_TOKEN`.
   *  4. Pose le token sur `hub.peer → token` (lookup voters P6 hot-path).
   *
   * Échecs (close WebSocket, codes plage applicative RFC 6455 §7.4.2) :
   *  - Origin refusée    → code 4003 (`forbidden`).
   *  - `authenticate` throw → code 4001 (`unauthorized`).
   */
  private async onHandshake(ctx: WebsocketContext): Promise<void> {
    const holder = ctx as unknown as RealtimeHolder;
    if (holder.__nfRealtime?.welcomed) return;
    const conn = ctx.connection as RawWsConnection | null;
    if (!conn) return;

    const hub = getRealtimeHub();
    const handshake = buildHandshakeFromContext(ctx);

    // Seam #4 — Origin check natif (CSRF defense). Bypass O(1) si pas de guard.
    if (!hub.checkOrigin(handshake.origin)) {
      this.log(
        `WS realtime upgrade refused: Origin "${handshake.origin ?? "(missing)"}" not allowed`,
        "WARNING",
      );
      conn.close(4003, "origin not allowed");
      return;
    }

    // Seam #2 — Authenticator réseau. Fallback ANONYMOUS si aucun matcher.
    const authenticator = hub.resolveAuthenticator(handshake);
    let token: IRealtimeToken;
    if (authenticator !== null && authenticator.supports(handshake)) {
      try {
        token = await authenticator.authenticate(handshake);
        authenticator.onSuccess?.(handshake, token);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        try {
          authenticator.onFailure?.(handshake, err);
        } catch {
          /* hooks d'audit fautifs ne bloquent pas la fermeture */
        }
        this.log(
          `WS realtime auth failed (${authenticator.name}): ${err.message}`,
          "WARNING",
        );
        conn.close(4001, "unauthorized");
        return;
      }
    } else {
      token = ANONYMOUS_REALTIME_TOKEN;
    }

    // Contre-pression de CETTE connexion : réglages lus sur le serveur WebSocket
    // qui la sert — source UNIQUE, partagée avec `send`/`broadcast` HTTP. Cold
    // path (une lecture au handshake, rien par frame).
    const transport = new WsConnectionTransport(
      conn,
      readBackpressureOptions(
        (
          ctx as unknown as {
            server?: Parameters<typeof readBackpressureOptions>[0];
          }
        ).server ?? null,
      ),
    );
    const peerOptions: JsonRpcPeerOptions = {
      // Fail-safe : un payload non JSON-safe (structure circulaire…) ne doit
      // JAMAIS casser la chaîne du peer — sinon unhandledRejection serveur +
      // timeout SILENCIEUX côté client (aucune réponse n'est émise). On répond
      // `-32603` générique (Zero Trust : zéro détail de structure au pair) et
      // on logge l'ERROR serveur (fail-loud, cf « pas de dégradation
      // silencieuse »). Une notification (sans `id`) fautive est droppée.
      send: (frame) => {
        let json: string;
        try {
          json = JSON.stringify(frame);
        } catch (e) {
          this.log(
            `WS realtime send: payload non sérialisable — ${
              e instanceof Error ? e.message : String(e)
            }`,
            "ERROR",
          );
          const id = (frame as { id?: number | string }).id;
          if (id === undefined) return;
          json = JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: {
              code: -32603,
              message: "internal error: non-serializable payload",
            },
          });
        }
        transport.send(json);
      },
      onNotification: (method, params) =>
        this.onRealtimeNotification(ctx, method, params),
      onError: (context, err) =>
        this.log(
          `${context}: ${err instanceof Error ? err.message : String(err)}`,
          "ERROR",
        ),
    };
    // Seam #1 — VERROU DE FRAME (P6). Armé sur TOUTE connexion, sans condition.
    //
    // Il ne l'était qu'au handshake, si une politique existait DÉJÀ
    // (`hasFrameAuthorizer()`), pour garder un bypass 0-coût sur les hubs non
    // sécurisés. Mais une décision d'autorisation prise UNE FOIS, à l'ouverture,
    // vaut pour toute la vie de la connexion : un peer connecté avant la pose du
    // verrou n'était jamais gardé — ni au moment où la politique arrive, ni
    // ensuite. Une socket WS vit des heures ; l'ordre de boot n'est pas une
    // garantie de sécurité.
    //
    // Le bypass n'est pas perdu, il descend d'un cran : `hub.runAuthorizer` rend
    // `true` immédiatement quand aucun authorizer n'est posé. On paie donc un
    // appel et une comparaison de champ privé par frame entrante — devant le
    // parse JSON que cette même frame vient de subir, c'est un prix nul, et le
    // trou d'autorisation se ferme par construction.
    //
    // `peer` est capturé par closure (clé du mapping `peer → token`) — référence
    // DIFFÉRÉE, jamais évaluée pendant la construction, donc pas de TDZ.
    {
      peerOptions.beforeDispatch = (frame) => hub.runAuthorizer(frame, peer);
      peerOptions.onFrameAudit = (reason, frame, auditedPeer) => {
        // Zero Trust : une frame REFUSÉE est tracée (audit P6.14, cold path). Les
        // autres motifs (invalid/method_not_found/internal_error) sont déjà gérés
        // par le peer (réponse d'erreur normalisée) → pas de double log.
        if (reason !== "denied") return;
        this.log("WS realtime frame refused by authorizer", "WARNING");
        // Refus OBSERVABLE : une requête (avec `id`) reçoit déjà `-32001` du peer ;
        // une NOTIFICATION (subscribe/inbound, sans `id`) serait droppée en silence
        // → le client resterait aveugle (croit être abonné). On lui pousse
        // `realtime:denied` avec un motif GÉNÉRIQUE (jamais le détail de la policy
        // — pas d'oracle « il te manque ROLE_ADMIN »). Cold path (refus rare).
        const f = frame as {
          id?: unknown;
          method?: unknown;
          params?: { channel?: unknown };
        };
        if (f.id !== undefined) return; // requête → déjà notifiée par le peer
        const channel =
          f.method === "subscribe"
            ? typeof f.params?.channel === "string"
              ? f.params.channel
              : undefined
            : typeof f.method === "string"
              ? f.method
              : undefined;
        if (channel !== undefined) {
          // Type de PROTOCOLE isomorphe (core) : un seul contrat, garanti par le
          // compilateur des deux bouts (serveur émet ⇄ client `ingestDenied`).
          const denied: IRealtimeDenied = {
            channel,
            reason: "forbidden",
            // Le motif reste générique — c'est lui qui interdit l'oracle. Le
            // détail, lui, ne franchit pas la production (`deniedDetail`) : en
            // développement il évite de chercher pendant une heure une panne de
            // transport là où une politique a simplement fait son travail.
            ...deniedDetail(
              this.kernel?.environment,
              `le verrou de frame a refusé l'accès à « ${channel} » pour cette ` +
                `identité : vérifie les rôles ou scopes exigés par le canal ` +
                `(décorateur \`@RealtimeChannel(nom, { roles })\` ou clé ` +
                `\`realtimeChannels\` de la configuration de sécurité), et ceux ` +
                `que porte le jeton — le \`realtime:welcome\` te les rend`,
            ),
          };
          auditedPeer.notify("realtime:denied", denied);
        }
      };
    }
    const peer = new JsonRpcPeer(peerOptions);
    // Pose `peer → token` AVANT le welcome → voters/audit lookup garanti dès
    // la 1ʳᵉ frame entrante (hot-path O(1) via WeakMap).
    hub.setTokenForPeer(peer, token);
    transport.onMessage((raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return; // frame illisible → ignorée
      }
      peer.receive(parsed);
    });
    // Actions = décorateurs `@RealtimeAction` + override `realtimeActions()`. L'override
    // gagne en cas de conflit (un user peut volontairement écraser un décorateur hérité).
    const decoratedActions = getRealtimeActions(this);
    const allActions: Record<string, RpcActionHandler> = {
      ...decoratedActions,
      ...this.realtimeActions(),
    };
    for (const [name, handler] of Object.entries(allActions)) {
      peer.register(name, handler);
      // Défaut FERMÉ pour TOUTE action, quelle que soit sa voie de déclaration.
      // `@RealtimeAction` pose déjà sa politique ; l'override `realtimeActions()`
      // n'a aucun endroit où en écrire une — sans cette ligne, il resterait la
      // porte ouverte d'à côté (le verrou laisse passer ce qu'aucune politique
      // ne couvre). On ne pose QUE si rien n'est déclaré : une politique
      // existante, plus stricte ou volontairement ouverte, est conservée.
      if (hub.resolveChannelPolicy(name) === null) {
        hub.registerChannelPolicy(name, DEFAULT_ACTION_POLICY);
      }
    }
    // Pont API souverain (opt-in) — enregistré APRÈS les actions custom : la
    // plateforme garde la main sur `api.request` quand le pont est activé.
    if (this.realtimeApiRequest()) {
      peer.register("api.request", (params) =>
        this.invokeApiRequest(ctx, params, peer),
      );
    }

    // Map des canaux décorés (cold-path) — mémoïsé sur l'instance pour que les
    // `subscribe` ultérieurs (chaque frame entrante) lookup en O(1) sans toucher
    // au reflect-metadata.
    this._decoratedChannels = getRealtimeChannels(this);

    // Politiques d'autorisation décorées (`@RealtimeChannel`/`@RealtimeInbound`
    // avec opts) → registre du hub (cold path, idempotent). `@nodefony/security`
    // les lit au `subscribe`/inbound via `resolveChannelPolicy`. `null` si aucun
    // canal décoré n'est protégé → 0 enregistrement.
    const channelPolicies = getRealtimeChannelPolicies(this);
    if (channelPolicies) {
      for (const name in channelPolicies) {
        hub.registerChannelPolicy(name, channelPolicies[name]!);
      }
      // F1 (revue 0.6) — fail-LOUD : une policy de canal n'est appliquée que si un
      // frameAuthorizer est câblé (par @nodefony/security au boot des zones realtime).
      // Sans lui, la policy est INERTE (canal servable mais NON gardé) → dégradation
      // silencieuse. On alerte (jamais en silence) : le canal se croit gardé, il est
      // ouvert. Cf project_resilience_no_silent_degradation.
      if (hub.hasUnenforcedChannelPolicies() && !warnedUnenforcedPolicies) {
        warnedUnenforcedPolicies = true;
        this.log(
          "Realtime channel policies declared but NO frame authorizer is wired — " +
            "these policies are NOT enforced (a protected channel is currently open). " +
            "Load @nodefony/security with a realtime zone to enforce them.",
          "WARNING",
        );
      }
    }

    // F82 cas (2) — le hub ferme les canaux de PLATEFORME quand aucun module de
    // sécurité n'est chargé (aucune identité vérifiable ⇒ aucun accès légitime).
    // Le hub est sans dépendance : il ne sait pas journaliser. On lui prête donc
    // notre journal, et il tire l'alerte au premier refus — une fermeture muette
    // ferait chercher longtemps pourquoi un tableau de bord reste vide.
    hub.onPlatformNotice((message, severity) => this.log(message, severity));

    // Sonde socket : la connexion (= ce transport) entre au registre du hub. La
    // backpressure (`bufferedAmount`) vit sur la connexion brute → seul le transport
    // l'expose. Retiré au close (onFinish, plus bas). `hub` réutilisé depuis le
    // seam #2 plus haut (même scope) — pas de relookup.
    hub.registerConnection(transport);

    // F4 (revue 0.6) — révocation des sockets à identité RÉVOCABLE. Le verrou de frame
    // est SYNC (identité figée au handshake, cf FrameAuthorizer) → il ne coupe pas un
    // socket dont la session meurt (logout HTTP), là où `api.request` re-valide par
    // requête (`isValid`). On inscrit CETTE connexion au tick de révalidation du hub,
    // UNIQUEMENT si le token porte `isValid` : une identité révocable, quel que soit
    // son mode — session BFF relue, ou jeton porteur dont on vérifie la borne `exp`
    // et la révocation. Un anonyme, lui, n'a rien à révoquer → 0 coût. Retiré au
    // close (onFinish, plus bas).
    let revocable: IRevocableConnection | null = null;
    if (typeof token.isValid === "function") {
      revocable = { token, close: (code, reason) => conn.close(code, reason) };
      hub.registerRevocable(revocable);
    }

    // Politique de forward : déclare les canaux broadcast (cross-process) de cet
    // endpoint au hub (idempotent, cold-path). Défaut = aucun → tout instance-local.
    const broadcast = this.realtimeBroadcastChannels();
    for (let i = 0; i < broadcast.length; i++) {
      hub.markBroadcastChannel(broadcast[i]!);
    }

    // Canaux full-duplex = décorateurs `@RealtimeInbound` + override `realtimeInbound()`.
    // `null` si AUCUN des deux n'en déclare → 0 lookup sur le chemin notification.
    const decoratedInbound = getRealtimeInbound(this);
    const overrideInbound = this.realtimeInbound();
    const inboundMap: Record<string, RealtimeInboundHandler> = {
      ...decoratedInbound,
      ...overrideInbound,
    };
    // #35 — canal montant des journaux du navigateur, déclaré ICI plutôt que dans un
    // contrôleur précis : le bénéfice est de servir une application quelconque, et le
    // faire porter par Studio (ou par n'importe quel endpoint nommé) l'aurait réservé
    // à qui hérite du bon contrôleur. Un handler NEUF par connexion — c'est ce qui
    // rend le compteur de débit per-connexion sans registre partagé.
    // Un `realtimeInbound()` qui déclarerait le même nom gagne : la plateforme fournit
    // un défaut, elle ne confisque pas le canal.
    const clientLogs = hub.clientLogsLimits;
    if (
      clientLogs !== null &&
      inboundMap[PLATFORM_INBOUND.syslogUplink] === undefined
    ) {
      // Le journal du CONTRÔLEUR (résolu du conteneur par `Service`), pas le
      // singleton du kernel : c'est le même objet dans une application réelle, mais
      // il reste substituable — un banc qui monte un contrôleur sans kernel doit
      // pouvoir observer ce que le canal réinjecte.
      const syslog = this.syslog;
      if (syslog) {
        inboundMap[PLATFORM_INBOUND.syslogUplink] = createSyslogUplinkHandler({
          syslog,
          ...clientLogs,
        });
      }
    }
    const inbound = Object.keys(inboundMap).length > 0 ? inboundMap : null;

    const state: RealtimeConnState = {
      welcomed: true,
      peer,
      transport,
      channels: new Map(),
      inbound,
    };
    holder.__nfRealtime = state;

    ctx.once?.("onFinish", () => {
      // Désabonne CETTE connexion de tous ses canaux : le hub dispose le provider
      // partagé au dernier abonné (aucun timer/listener orphelin).
      // `liveHub` : résolu À LA FERMETURE, donc distinct du `hub` capturé plus
      // haut au moment du branchement — les masquer l'un l'autre cachait que ce
      // sont deux instants différents.
      const liveHub = getRealtimeHub();
      for (const [channel, sink] of state.channels) {
        liveHub.unsubscribe(channel, sink);
      }
      state.channels.clear();
      liveHub.unregisterConnection(transport); // sonde : sortie symétrique du registre
      if (revocable) liveHub.unregisterRevocable(revocable); // F4 : sortie du tick de révocation
      transport.fireClose();
      peer.dispose("ws closed");
      this.log("WS realtime client disconnected — cleanup done", "INFO");
    });

    // `realtime:welcome` annonce canaux + actions découvrables (décorateurs + override).
    const announcedChannels = [
      ...(this._decoratedChannels ? Object.keys(this._decoratedChannels) : []),
      ...this.realtimeChannels(),
    ];
    // L'identité est lue sur le `token` NEUTRE (`IRealtimeToken`) déjà résolu au
    // handshake (authenticator P6 ou `ANONYMOUS_REALTIME_TOKEN`) — 0 dépendance
    // security, 0 re-lecture base. Le client la consomme pour savoir QUI il est
    // sans taper de route (anonyme → login). Vue « sur soi » : aucun secret.
    // Mode d'exécution — la règle « jamais en production » vit dans
    // `welcomeEnv`, seule et éprouvée : noyée ici, son inversion ne casserait
    // aucun test et annoncerait le mode d'un serveur publié à ses visiteurs.
    const env = this.kernel?.environment;
    const welcome: IRealtimeWelcome = {
      ts: Date.now(),
      protocol: "jsonrpc-2.0",
      channels: announcedChannels,
      methods: peer.methods,
      ...welcomeEnv(env),
      identity: {
        type: token.type,
        authenticated: token.isAuthenticated(),
        userIdentifier: token.getUserIdentifier(),
        roles: token.getRoles(),
        scopes: token.getScopes(),
      },
    };
    peer.notify("realtime:welcome", welcome);
    this.log("WS realtime client connected", "INFO");
  }

  /**
   * Notifications entrantes : pub/sub (subscribe/unsubscribe), heartbeat (ping), puis
   * canaux FULL-DUPLEX déclarés (entrée client → handler `realtimeInbound`).
   */
  private onRealtimeNotification(
    ctx: WebsocketContext,
    method: string,
    params: unknown,
  ): void {
    if (method === "subscribe") {
      this.startChannel(
        ctx,
        (params as { channel?: string } | undefined)?.channel,
      );
      return;
    }
    if (method === "unsubscribe") {
      this.stopChannel(
        ctx,
        (params as { channel?: string } | undefined)?.channel,
      );
      return;
    }
    // Full-duplex : `method` == nom du canal entrant déclaré → handler (per-connexion).
    const state = (ctx as unknown as RealtimeHolder).__nfRealtime;
    const handler = state?.inbound?.[method];
    if (handler) {
      getRealtimeHub().recordInbound(); // sonde : frame full-duplex entrante
      // reply = push serveur→client sur le MÊME canal, vers CETTE connexion.
      handler(params, (payload) => state!.peer.notify(method, payload));
    }
    // `ping` = heartbeat no-op ; notification inconnue = ignorée.
  }

  /** Abonne la connexion à un canal via le hub partagé (idempotent par connexion). */
  private startChannel(ctx: WebsocketContext, channel?: string): void {
    if (!channel) return;
    const state = (ctx as unknown as RealtimeHolder).__nfRealtime;
    if (!state || state.channels.has(channel)) return;
    // F6a (revue 0.6) — cap anti-OOM : plafond de canaux par connexion. Chaque
    // canal ouvert = 1 ticker hub + provider + entrée Map → un socket qui subscribe
    // à N canaux sans borne = OOM. Vérifié APRÈS l'idempotence (un re-subscribe d'un
    // canal déjà tenu ne compte pas). `null` = illimité (opt-out explicite). Sous le
    // seuil, le multiplexage N-canaux reste libre (North Star).
    const cap = getRealtimeHub().maxChannelsPerConnection;
    if (cap !== null && state.channels.size >= cap) {
      // Refus OBSERVABLE (pas de dégradation silencieuse : sinon le client se croit
      // abonné). `realtime:denied` = convention existante ; motif `limit` (une borne
      // de ressource n'est pas un secret, ≠ oracle d'autorisation). Log DEBUG et NON
      // WARNING : un log par subscribe refusé sous flood serait un amplificateur.
      const denied: IRealtimeDenied = {
        channel,
        reason: "limit",
        ...deniedDetail(
          this.kernel?.environment,
          `plafond de ${cap} canaux par connexion atteint : désabonne-toi d'un ` +
            `canal avant d'en ouvrir un autre, ou relève ` +
            `\`maxChannelsPerConnection\` dans la configuration realtime`,
        ),
      };
      state.peer.notify("realtime:denied", denied);
      this.log(
        `WS subscribe refusé (cap ${cap} canaux/connexion atteint) → ${channel}`,
        "DEBUG",
      );
      return;
    }
    // Sink de CETTE connexion : pousse la charge fan-outée par le hub sur son peer.
    // Quand le canal a plusieurs abonnés, le hub a déjà sérialisé la frame — une
    // seule fois pour tous : on l'écrit telle quelle sur le transport, au lieu de
    // refaire le même `JSON.stringify` par connexion. La frame vient de la source
    // unique `JsonRpcPeer.buildNotification`, donc les deux voies sont identiques.
    const sink: ChannelSink = (payload, serialized) => {
      if (serialized !== undefined) state.transport.send(serialized);
      else state.peer.notify(channel, payload);
    };
    // Le hub PARTAGE le provider entre connexions (1 ticker/canal/pod) ; la factory
    // (appelée au 1ᵉʳ abonné) doit capturer des deps long-lived — cf createRealtimeChannel.
    //
    // Ordre de résolution : décorateur `@RealtimeChannel` (match EXACT, O(1)) d'abord,
    // sinon fallback sur l'override classique `createRealtimeChannel` (regex, suffixes,
    // drill cluster). Coexistence sans casse pour les controllers historiques.
    // `subscribeClient` et non `subscribe` : la demande vient du RÉSEAU. C'est
    // cette porte qui applique le plancher des canaux de plateforme ; un service
    // interne du serveur, lui, passe par `subscribe` et n'est pas concerné.
    // Par quelle voie le canal a-t-il été servi ? Le hub l'ignore ; nous seuls
    // le savons. Un canal servi par la fabrique DYNAMIQUE n'a pas de politique
    // déclarée (registre indexé par nom exact) → on le DIT plutôt que de
    // laisser croire à une garde qui n'existe pas.
    let servedByPattern = false;
    const ok = getRealtimeHub().subscribeClient(
      channel,
      sink,
      (ch, publish) => {
        const decFactory = this._decoratedChannels?.[ch];
        if (decFactory) return decFactory(ch, publish);
        const dispose = this.createRealtimeChannel(ch, publish);
        if (dispose !== null) servedByPattern = true;
        return dispose;
      },
      // Le hub ignore JSON-RPC : c'est l'abonné qui lui dit comment fabriquer la
      // frame du canal. Appelé au plus une fois par publication, jamais par abonné.
      (payload) =>
        JSON.stringify(JsonRpcPeer.buildNotification(channel, payload)),
    );
    if (ok) {
      state.channels.set(channel, sink);
      if (servedByPattern)
        getRealtimeHub().noticeUnguardedDynamicChannel(channel);
      this.log(`WS subscribe → ${channel}`, "DEBUG");
      return;
    }
    // Un abonnement qui n'aboutit pas se DIT — TOUJOURS. Sans réponse, le client
    // attendrait des données qui ne viendront jamais : un écran vide sans cause
    // visible, indiscernable d'un canal calme. Deux causes, deux motifs, et
    // aucune n'a le droit de rester muette.
    const plancher = getRealtimeHub().isClosedBySystemFloor(channel);
    // Plancher système : décision d'AUTORISATION → motif générique, comme partout
    // (le détail de la politique ne s'offre pas à qui essuie un refus). Sinon, le
    // hub n'a trouvé personne pour PRODUIRE ce canal : nom mal orthographié ou
    // module absent. Le dire n'ouvre aucun oracle — un canal gardé est tranché en
    // amont par le verrou de frame, donc rendu `forbidden` qu'il existe ou non.
    const denied: IRealtimeDenied = {
      channel,
      reason: plancher ? "forbidden" : "unknown",
      ...deniedDetail(
        this.kernel?.environment,
        plancher
          ? `« ${channel} » appartient au namespace de plateforme, dont le ` +
              `plancher est CLOS tant qu'aucun module de sécurité n'est chargé — ` +
              `ce n'est pas ton identité qui est en cause`
          : `aucun producteur pour « ${channel} » sur ce pod : vérifie ` +
              `l'orthographe du canal, puis qu'un \`@RealtimeChannel("${channel}")\` ` +
              `est bien déclaré dans un controller CHARGÉ (le runtime lit \`dist/\`, ` +
              `pas les sources)`,
      ),
    };
    state.peer.notify("realtime:denied", denied);
    // DEBUG et non WARNING : un log par subscribe refusé sous flood serait un
    // amplificateur (même raison qu'au plafond de canaux).
    this.log(
      plancher
        ? `WS subscribe refusé (canal de plateforme, aucun module de sécurité) → ${channel}`
        : `WS subscribe refusé (aucun producteur pour ce canal) → ${channel}`,
      "DEBUG",
    );
  }

  /**
   * Handler de la méthode RPC `api.request {path}` — le **pont API souverain**
   * (POC Ph.3) : résout le path porté par le message via le Router
   * (`cleanPathOverride` — l'URL de la connexion n'est jamais mutée) puis
   * exécute l'action SANS la rendre (`executeAction`) : la valeur nue est
   * enveloppée `{id, result}` par le peer — snapshot ≡ GET REST par
   * construction.
   *
   * Query : le `?…` du path invoqué est parsé ici (paires plates, clés répétées
   * → array — sémantique `qs` plate) et porté par `resolver.queryOverride`
   * (per-invocation : zéro bleed entre requêtes concurrentes de la même
   * socket). Limitation POC assumée : syntaxe nested `a[b]=c` non supportée
   * par le pont (doc §11 — le parse complet du transport HTTP n'est pas
   * mutualisé tant que Ph.6 n'a pas tranché).
   *
   * Erreurs → {@link RpcError} (`data.status` = statut HTTP équivalent) :
   * `-32602` params invalides, 404 path inconnu, 408 timeout d'action…
   * Tout autre throw de l'action reste opaque (`-32603`, Zero Trust).
   */
  private async invokeApiRequest(
    ctx: WebsocketContext,
    params: unknown,
    peer: JsonRpcPeer,
  ): Promise<unknown> {
    const p = params as
      | {
          path?: unknown;
          method?: unknown;
          body?: unknown;
          idempotencyKey?: unknown;
        }
      | undefined;
    const path = p?.path;
    if (typeof path !== "string" || path.charCodeAt(0) !== 47 /* "/" */) {
      throw new RpcError("api.request: params.path invalide", -32602);
    }
    // Méthode HTTP LOGIQUE de l'invocation. Défaut "GET" = lecture (forme
    // historique du pont, snapshot ≡ GET REST). Une MUTATION déclare sa méthode
    // → exigée EN PLUS du transport WEBSOCKET au resolve (`methodOverride`), pour
    // lever l'ambiguïté GET-via-WS / POST-via-WS sur un même chemin. La sécurité
    // d'écriture (clé d'idempotence requise, dédup) est portée par le data plane
    // admin (`AdminApiController`) — le pont ne fait que router + transporter.
    const method =
      typeof p?.method === "string" ? p.method.toUpperCase() : "GET";
    if (
      method !== "GET" &&
      method !== "POST" &&
      method !== "PUT" &&
      method !== "PATCH" &&
      method !== "DELETE"
    ) {
      throw new RpcError(
        `api.request: méthode ${method} non supportée`,
        -32602,
      );
    }
    const router = ctx.router;
    if (!router) {
      throw new RpcError("api.request: router indisponible", -32000, {
        status: 500,
      });
    }
    // Query du path INVOQUÉ séparée avant le match (le Router matche un pathname).
    const qIdx = path.indexOf("?");
    const pathname = qIdx === -1 ? path : path.slice(0, qIdx);
    // RADIOGRAPHIE de la porte socket — profil de CETTE invocation. Le contexte
    // WS vit pour la CONNEXION : ses phases et son requestId ne peuvent pas
    // décrire une frame parmi N (timeline cumulative). Le profil naît ici, voyage
    // dans l'ALS (seul canal déjà per-invocation, traversé par le Resolver, le
    // controller et les adapters ORM) et se collecte au retour. `null` en prod
    // (ni profiler ni timing) → zéro allocation sur le hot path realtime.
    const frame = ctx.beginFrame(method, path);
    try {
      frame?.phaseStart("resolve");
      let resolver: ReturnType<typeof router.resolve>;
      try {
        // GET → resolve historique (le transport WEBSOCKET matche `context.method`).
        // Mutation → `methodOverride` (méthode logique) exigé en plus du transport.
        resolver = router.resolve(
          ctx,
          pathname,
          method === "GET" ? undefined : method,
        );
      } finally {
        frame?.phaseEnd("resolve");
      }
      if (!resolver.resolve) {
        throw new RpcError(`api.request: not found ${pathname}`, -32000, {
          status: 404,
        });
      }
      // Route / controller / action du profil — lus par le Profiler au retour.
      if (frame) frame.resolver = resolver as unknown as ProfiledResolver;
      if (qIdx !== -1 && qIdx < path.length - 1) {
        const sp = new URLSearchParams(path.slice(qIdx + 1));
        const query: Record<string, unknown> = {};
        for (const [k, v] of sp) {
          const prev = query[k];
          if (prev === undefined) query[k] = v;
          else if (Array.isArray(prev)) (prev as string[]).push(v);
          else query[k] = [prev as string, v];
        }
        resolver.queryOverride = query;
      }
      // J8 — établir le contexte de requête (ALS) AVANT d'exécuter l'action. Le
      // pont api.request est l'équivalent WS du pipeline HTTP : le peer reçoit ses
      // frames via le transport (HORS de la bulle ALS du handshake), donc SANS ce
      // `run` la garde @IsGranted (Resolver) lirait `token = undefined` → 403, même
      // pour un client légitime. On pose le token DU PEER (résolu au handshake,
      // figé O(1) via WeakMap, lié à CETTE connexion → zéro confusion d'identité)
      // + l'IUser (seam neutre `getAttribute("user")`) pour @CurrentUser. Coût : 1
      // `run` (~50-100 ns) + 1 objet littéral, UNIQUEMENT sur api.request (jamais
      // sur publish/subscribe/notify → le hot-path temps réel reste intact).
      const token = getRealtimeHub().getTokenForPeer(peer);
      // 🔒 ZERO TRUST — re-valider l'identité figée au handshake AVANT l'action
      // data plane. Une WebSocket est un SINGLETON partagé qui SURVIT à sa session :
      // après une déconnexion admin puis la connexion d'un autre compte sur le même
      // navigateur, le token resterait « admin » → un GET data plane rejouerait avec
      // l'identité périmée (élévation de privilège). `isValid()` re-lit la source
      // (session BFF) ; périmée/changée → 401. Le client (ApiClient) bascule alors
      // en fetch HTTP (cookie courant) = réponse de référence. Optionnel (anonyme/
      // JWT n'en ont pas) ; payé SEULEMENT ici, jamais sur publish/subscribe.
      // Phase `identity` : c'est une LECTURE DE STORE (session BFF) — la sonde la
      // montre pour ce qu'elle est, un vrai coût de la porte socket.
      if (token.isValid) {
        let valid: boolean;
        frame?.phaseStart("identity");
        try {
          valid = await token.isValid();
        } catch {
          valid = false; // fail-closed : une re-validation qui throw = refus
        } finally {
          frame?.phaseEnd("identity");
        }
        if (!valid) {
          throw new RpcError(
            "api.request: identité de session expirée ou invalide",
            -32000,
            { status: 401 },
          );
        }
      }
      // Capture de rendu per-invocation : une action user peut répondre par un
      // RENDU (`renderJson`/`renderView`) au lieu d'une valeur nue. Sans le sink,
      // `context.send()` écrirait une frame NUE hors protocole ET le retour
      // (`WebsocketResponse`, circulaire via `context`) casserait le stringify de
      // l'enveloppe peer (unhandledRejection + timeout client silencieux — bug
      // vécu au Playground). Le sink vit dans l'ALS → zéro bleed entre frames
      // concurrentes de la même socket.
      const renderSink: { body?: string | Buffer } = {};
      const result = await RequestContext.run(
        {
          requestId: ctx.requestId,
          scheme: ctx.scheme,
          token,
          user: token.getAttribute("user"),
          userId: token.getUserIdentifier(),
          // V4.1 — contexte transport dans l'ALS (controllers singleton data plane).
          context: ctx,
          // Mutation : corps + clé d'idempotence portés par l'ALS (pas de corps
          // HTTP parsé en WS) → lus par `AdminApiController.buildRequest`. Absents
          // pour un GET (`p?.body === undefined` → fallback queryPost vide).
          body: p?.body,
          idempotencyKey:
            typeof p?.idempotencyKey === "string"
              ? p.idempotencyKey
              : undefined,
          renderSink,
          // Radiographie : le profil de la frame (phases émises par le Resolver
          // et le Controller) + son buffer SQL. Le kernel refusait ce buffer au
          // handshake — il aurait cumulé N messages ; per-invocation, il est exact.
          invocation: frame ?? undefined,
          queries: frame?.profilerQueries ?? undefined,
        },
        async () => {
          frame?.phaseStart("action");
          try {
            // `reload = true` : le container de la connexion porte CE hub sous
            // "controller" — sans reload, l'action serait cherchée sur la mauvaise
            // instance (seam découvert au POC Ph.1). Singleton-safe (cache Router).
            // `executeActionGuarded` (PAS `executeAction` nu) : il porte la porte
            // d'idempotence `@Idempotent` (mutations — la méthode logique voyage
            // dans `resolver.methodOverride`) SANS rendre sur le transport ;
            // l'appel nu la court-circuitait → un rejeu `socket.mutate` créait un
            // DOUBLON, et `callController` enverrait la réponse une 2ᵉ fois.
            const { result: actionResult } =
              await resolver.executeActionGuarded(undefined, true);
            // L'action peut retourner un thenable — déballé avant l'enveloppe peer.
            const raw = await Promise.resolve(actionResult);
            // L'action a RENDU (sink alimenté) → le rendu EST la réponse : on le
            // sert en `result` (re-parsé si JSON — `renderJson` a déjà stringifié,
            // le peer re-stringifie l'enveloppe). Le retour de `renderJson` (la
            // `WebsocketResponse`) est ignoré : non sérialisable par construction.
            if (renderSink.body !== undefined) {
              const text = Buffer.isBuffer(renderSink.body)
                ? renderSink.body.toString("utf8")
                : renderSink.body;
              try {
                return JSON.parse(text) as unknown;
              } catch {
                return text; // rendu non-JSON (HTML/texte) → servi brut
              }
            }
            return raw;
          } finally {
            frame?.phaseEnd("action");
          }
        },
      );
      frame?.finish(200);
      // Le client repart avec l'identifiant du profil de SA frame (dev) — le
      // `result` reste la valeur nue (snapshot ≡ GET REST). Hors profiling :
      // valeur nue, aucune enveloppe, aucun octet de plus sur le fil.
      return frame
        ? new RpcEnvelope(result, { requestId: frame.requestId })
        : result;
    } catch (e) {
      // Un refus est une RÉPONSE, pas une panne : le statut HTTP-équivalent est
      // exposé (`data.status`) comme le ferait un `fetch`, et l'id du profil avec
      // — c'est le cas le plus pédagogique du Playground (« refusé ICI, par ÇA »).
      // Une erreur non HTTP-like reste OPAQUE (`-32603`, Zero Trust) : elle n'est
      // pas ré-emballée, seul le profil serveur la garde.
      const status = httpStatusOfFrameError(e);
      frame?.finish(status ?? 500, e);
      throw toFrameRpcError(e, status, frame?.requestId);
    } finally {
      ctx.collectFrame(frame);
    }
  }

  /** Désabonne la connexion d'un canal (le hub dispose le provider au dernier abonné). */
  private stopChannel(ctx: WebsocketContext, channel?: string): void {
    if (!channel) return;
    const state = (ctx as unknown as RealtimeHolder).__nfRealtime;
    const sink = state?.channels.get(channel);
    if (sink) {
      getRealtimeHub().unsubscribe(channel, sink);
      state!.channels.delete(channel);
      this.log(`WS unsubscribe → ${channel}`, "DEBUG");
    }
  }
}

/**
 * Construit un {@link IRealtimeHandshake} immuable depuis le `WebsocketContext`
 * de @nodefony/http — DTO neutre passé aux authenticators réseau (zéro
 * dépendance security/http côté contrat). Cold path (1× par upgrade).
 *
 * - `cookies` est aplati en `Map<string, string>` (Context expose
 *   `Record<string, Cookie>` — on ne garde que `name → value`, les options
 *   path/domain/expires ne sont pas utiles à l'authenticator).
 * - `protocols` : la liste des sous-protocoles annoncés (`Sec-WebSocket-Protocol`,
 *   csv séparé virgule selon RFC 6455 §4.1).
 */
function buildHandshakeFromContext(ctx: WebsocketContext): IRealtimeHandshake {
  const req = ctx.request;
  const headers = (req?.headers ?? {}) as Record<
    string,
    string | string[] | undefined
  >;

  // Cookies → Map<string, string> (le Context expose un Record<name, Cookie>).
  const cookies = new Map<string, string>();
  const rawCookies = (ctx.cookies ?? {}) as Record<
    string,
    { value?: unknown } | undefined
  >;
  for (const name in rawCookies) {
    const c = rawCookies[name];
    if (c && typeof c.value === "string") cookies.set(name, c.value);
  }

  // Sec-WebSocket-Protocol : peut être string CSV ou string[] ; on normalise.
  const rawProto = headers["sec-websocket-protocol"];
  let protocols: string[];
  if (Array.isArray(rawProto)) {
    protocols = rawProto.flatMap((p) => p.split(",").map((x) => x.trim()));
  } else if (typeof rawProto === "string") {
    protocols = rawProto
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  } else {
    protocols = [];
  }

  return {
    headers,
    cookies,
    // CONTRAT IRealtimeHandshake.url = **pathname + query** (ce que matchent les
    // matchers d'authenticator, comme `firewall.matchPath` côté HTTP). Or
    // `WebsocketContext.url` est l'URL ABSOLUE (`wss://host:port/path?q`) → on
    // extrait le path, sinon un matcher `^/nodefony/…` ne matcherait jamais une
    // URL préfixée du scheme (bug J3b : authenticator de zone jamais résolu).
    url: handshakePath(ctx),
    remoteAddress: ctx.remoteAddress ?? "",
    origin: ctx.origin && ctx.origin.length > 0 ? ctx.origin : undefined,
    protocols,
  };
}

/**
 * Extrait le **path** (pathname + query) de l'URL du handshake. `WebsocketContext.url`
 * est absolue (`url.format(wsUrl)`) ; un path relatif (tests/clients legacy) est
 * conservé tel quel. Jamais throw (cold path, 1× par upgrade).
 */
function handshakePath(ctx: WebsocketContext): string {
  const raw = (ctx as { url?: unknown }).url;
  if (typeof raw !== "string" || raw.length === 0) return "/";
  try {
    const u = new URL(raw); // URL absolue → pathname + search
    return u.pathname + u.search;
  } catch {
    return raw.charCodeAt(0) === 47 /* "/" */ ? raw : "/";
  }
}

export default RealtimeController;

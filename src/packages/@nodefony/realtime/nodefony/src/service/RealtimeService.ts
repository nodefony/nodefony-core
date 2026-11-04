import { Service, Module, type IFrameCodec, type JsonRpcPeer } from "nodefony";

import {
  getRealtimeHub,
  RESERVED_SYSTEM_PREFIXES,
  type RealtimeHub,
  type ChannelFactory,
  type ChannelSink,
  type OriginGuard,
  type FrameAuthorizer,
} from "../server/RealtimeHub";
import type { IFirewallGate } from "@nodefony/http";
import { realtimeConnectSource } from "./publicOrigin";
import { applyDeclaredBroadcastPrefixes } from "../../decorators/realtimeDecorators";
import type { IBackplane } from "../../interfaces/IBackplane";
import type { IRealtimeProbe } from "../../interfaces/IRealtimeProbe";
import {
  isRealtimeConfig,
  type IRealtimeConfig,
} from "../../config/defineModuleConfig";
import type { IRealtimeAuthenticator } from "../../interfaces/IRealtimeAuthenticator";
import type { IRealtimeAuthenticatorMatcher } from "../../interfaces/IRealtimeAuthenticatorMatcher";
import type { IRealtimeToken } from "../../interfaces/IRealtimeToken";
import type { IChannelPolicy } from "../../interfaces/IChannelPolicy";

/** Nom sous lequel ce module contribue à la politique de contenu. */
const CSP_CONTRIBUTOR = "realtime";

const serviceName = "realtimeService";

/**
 * Façade DI publique de la **socket Nodefony** côté serveur.
 *
 * Wrapper mince autour du singleton {@link RealtimeHub} : expose
 * `publish`/`subscribe`/`probe` à travers le container DI, applique au boot le
 * backplane custom éventuel (config `backplane.instance` OU service DI nommé
 * `realtimeBackplane`), expose la config gelée pour Studio / introspection.
 *
 * Ce service ne **remplace pas** le hub singleton (consommé par les
 * controllers, l'admin API et les WS handlers via `getRealtimeHub()`) ; il en
 * est l'API stable consommable côté userland. La Module class garde la main
 * sur le wiring `ClusterBackplane` (lié au lifecycle `onCluster` kernel,
 * pré-`onPreBoot`) — orthogonal au backplane custom userland.
 *
 * @example
 * ```ts
 * class MyService extends Service {
 *   constructor(public module: Module) {
 *     super(...);
 *     this.realtime = this.get<RealtimeService>("realtimeService");
 *   }
 *   notify(payload: unknown) {
 *     this.realtime?.publish("my-app:event", payload);
 *   }
 * }
 * ```
 */
class RealtimeService extends Service {
  #config: IRealtimeConfig | null = null;
  // Hub résolu lazy : importer le module ne doit pas alloer le singleton.
  #hub: RealtimeHub | null = null;

  constructor(public module: Module) {
    super(
      serviceName,
      module.container ?? undefined,
      module.notificationsCenter,
      module.options,
    );
  }

  /**
   * Initialise le service au moment où le Module l'enregistre via `addService`
   * (phase `onPreBoot`). Pose la config validée + applique l'éventuel backplane
   * custom userland. Idempotent.
   *
   * Source du backplane custom (priorité décroissante) :
   *  1. `realtimeConfig.backplane.instance` posée par la Module class via le
   *     container (mode "config typée" : `defineRealtimeConfig({}, { backplane })`)
   *  2. Service DI nommé `realtimeBackplane` (mode "userland enregistre une
   *     instance dans son module via container.set")
   *
   * Si aucun n'est fourni → le hub reste avec son backplane par défaut (null =
   * Loopback implicite, ou ClusterBackplane si le worker IPC a déjà été câblé
   * par la Module class). Aucun warn — c'est le cas commun.
   */
  async init(_module: Module): Promise<this> {
    // Posée par la classe `Module` à `onKernelRegister` : absente avant.
    const config: unknown = this.module.config;
    if (!isRealtimeConfig(config)) {
      throw new Error(
        `${serviceName}: realtimeConfig absente (this.module.config vide) — la Module class doit la valider à onKernelRegister`,
      );
    }
    this.#config = config;
    // `enabled: false` → module chargé mais inerte : on NE câble RIEN sur le hub
    // (backplane / origin guard / limites / slow-consumer restent aux défauts, 0
    // listener actif). Cf `realtimeConfigSchema.enabled`.
    if (!this.#config.enabled) {
      this.log(
        "realtime enabled:false → service inerte (hub non câblé)",
        "INFO",
      );
      return this;
    }
    const hub = this.getHub();
    const custom =
      this.#config.backplane.instance ??
      this.get<IBackplane>("realtimeBackplane");
    if (custom && hub.backplane === null) {
      hub.setBackplane(custom);
      this.log(
        `Backplane custom branché (driver déclaré=${this.#config.backplane.driver})`,
        "INFO",
      );
    }
    // Seam #4 — pose la politique Origin (CSRF defense RFC 6455 §10.2) sur le
    // hub. `enabled: false` (défaut) → guard `null` (rétrocompat). Cold path.
    hub.setOriginGuard(buildOriginGuard(this.#config));
    // F6a (revue 0.6) — plafond de canaux par connexion (anti-OOM) posé sur le hub
    // depuis la config (défaut 256, `null` = illimité). Lu par `startChannel`.
    hub.setMaxChannelsPerConnection(
      this.#config.limits.maxChannelsPerConnection,
    );
    // #622 — bornes des admissions : délai de l'authentification à la poignée
    // de main, puis celles d'`allow` (délai, appels en vol par connexion et par
    // exemplaire), lues par la file de chaque connexion.
    hub.setAdmissionLimits({
      authenticateTimeoutMs: this.#config.authenticateTimeoutMs,
      allowTimeoutMs: this.#config.allowTimeoutMs,
      maxPendingAllowsPerConnection: this.#config.maxPendingAllowsPerConnection,
      maxPendingAllowsTotal: this.#config.maxPendingAllowsTotal,
    });
    // F9 (revue 0.6) — câble le seuil de comptage des consommateurs lents de la
    // sonde depuis la config (avant : clé morte, la sonde lisait une constante).
    hub.setSlowConsumerBytes(this.#config.slowConsumer.bytes);
    // #618 — codec binaire des frames (ADR-0022 §2). Le module CBOR ne se charge
    // que s'il est configuré : une application en texte n'en paie pas l'import.
    if (this.#config.codec === "cbor") {
      const { CBOR_FRAME_CODEC } = await import("nodefony/cbor");
      hub.setFrameCodec(CBOR_FRAME_CODEC);
    } else {
      hub.setFrameCodec();
    }
    // #35 — réception des journaux du navigateur. Surface d'ÉCRITURE : fermée tant
    // que la config ne l'ouvre pas, et `null` signifie qu'aucun handler entrant ne
    // sera déclaré (pas un handler qui refuse — un canal qui n'existe pas).
    hub.setClientLogsLimits(
      this.#config.clientLogs.enabled
        ? {
            maxEntriesPerBatch: this.#config.clientLogs.maxEntriesPerBatch,
            maxEntriesPerWindow: this.#config.clientLogs.maxEntriesPerWindow,
            windowMs: this.#config.clientLogs.windowMs,
            maxStringLength: this.#config.clientLogs.maxStringLength,
          }
        : null,
    );
    // Politique de forward DÉCLARÉE (`@RealtimeBroadcast`) posée dès le boot :
    // sans elle, un pod qui publie sans abonné local (job, webhook, worker) ne
    // propagerait rien tant qu'aucun client ne s'est connecté à lui — et deux
    // pods identiques diffuseraient différemment selon leur historique.
    applyDeclaredBroadcastPrefixes(hub);
    // #699 (ADR-0024 §C3) — une socket servie sur une autre origine que la page
    // se déclare elle-même dans `connect-src`, sinon le navigateur la bloque.
    if (this.#config.publicOrigin !== undefined) {
      this.#declareCspOrigin(this.#config.publicOrigin);
    }
    return this;
  }

  /**
   * Déclare au pare-feu l'origine publique de la socket dans `connect-src`.
   *
   * Différé à `onReady` : au moment de `init`, le module de sécurité peut ne pas
   * avoir encore enregistré son pare-feu (ordre des modules). Sans pare-feu
   * (application sans `@nodefony/security`), aucune politique n'est posée :
   * rien à déclarer.
   *
   * @param publicOrigin - origine nue validée par le schéma
   */
  #declareCspOrigin(publicOrigin: string): void {
    const source = realtimeConnectSource(publicOrigin);
    if (source === null) return;
    this.kernel?.once("onReady", () => {
      this.get<IFirewallGate>("firewall")?.registerCspOrigins?.(
        CSP_CONTRIBUTOR,
        { "connect-src": [source] },
      );
    });
  }

  /** Configuration realtime gelée (lue par Studio / introspection). */
  getConfig(): IRealtimeConfig {
    if (!this.#config) {
      throw new Error(`${serviceName}: not initialized`);
    }
    return this.#config;
  }

  /** Hub singleton (broker fan-out canaux PARTAGÉS du process courant). */
  getHub(): RealtimeHub {
    return (this.#hub ??= getRealtimeHub());
  }

  /**
   * Le codec texte des connexions socket, lu PAR NOM par le REST du plan
   * d'administration (`AdminApiController`, framework ne dépend pas de realtime) :
   * les octets d'une réponse `GET` y prennent la même forme que sur la socket.
   */
  get textFrameCodec(): IFrameCodec {
    return this.getHub().textFrameCodec;
  }

  /** Backplane actuellement branché sur le hub (ou null = Loopback implicite). */
  getBackplane(): IBackplane | null {
    return this.getHub().backplane;
  }

  /**
   * Publie une charge sur un canal — fan-out local + propagation backplane si
   * canal broadcast. Délégué à `RealtimeHub.publish`.
   *
   * @throws TypeError si la charge est un scalaire ou `null` (cf `isRealtimePayload`).
   */
  publish(channel: string, payload?: object): void {
    this.getHub().publish(channel, payload);
  }

  /**
   * Abonne un sink à un canal partagé — factory invoquée au 1ᵉʳ abonné, dispose
   * appelé au dernier désabonné. Délégué à `RealtimeHub.subscribe`.
   *
   * @returns `true` si abonné, `false` si la factory a refusé (canal inconnu).
   */
  subscribe(
    channel: string,
    sink: ChannelSink,
    factory: ChannelFactory,
  ): boolean {
    return this.getHub().subscribe(channel, sink, factory);
  }

  /**
   * Désabonne un sink — appelle `dispose` du provider partagé au dernier abonné.
   * Délégué à `RealtimeHub.unsubscribe`. No-op si non abonné.
   */
  unsubscribe(channel: string, sink: ChannelSink): void {
    this.getHub().unsubscribe(channel, sink);
  }

  /**
   * Enregistre la factory d'un **canal système** (plateforme) — délégué à
   * {@link RealtimeHub.registerSystemChannel}. Un module bas niveau
   * (`@nodefony/security` → `nodefony:audit`) déclare au boot comment produire le
   * provider, sans qu'aucun `RealtimeController` ne le connaisse ; tout endpoint
   * le sert alors (lazy : créé au 1ᵉʳ abonné, disposé au dernier).
   */
  registerSystemChannel(channel: string, factory: ChannelFactory): void {
    this.getHub().registerSystemChannel(channel, factory);
  }

  /**
   * Namespaces de canaux **réservés à la plateforme** — la liste que le hub ferme
   * lui-même en l'absence de module de sécurité.
   *
   * Exposée pour qu'un module de sécurité y attache ses politiques **sans
   * redéclarer la liste** : deux inventaires auraient divergé au premier namespace
   * ajouté, et la divergence serait passée inaperçue (un namespace neuf resterait
   * simplement sans politique). Ici, le hub possède la liste, la sécurité possède
   * les rôles.
   */
  reservedSystemPrefixes(): readonly string[] {
    return RESERVED_SYSTEM_PREFIXES;
  }

  /** Snapshot d'observabilité du hub local (consommé par `/nodefony/realtime/api/health`). */
  probe(): IRealtimeProbe {
    return this.getHub().probe();
  }

  /**
   * Marque un préfixe de canal comme **broadcast** (cross-process via le
   * backplane). Sans appel, tout canal reste instance-local. Délégué à
   * `RealtimeHub.markBroadcastChannel`.
   */
  markBroadcastChannel(prefix: string): void {
    this.getHub().markBroadcastChannel(prefix);
  }

  /**
   * **Seam #2/#3 (P13 → P6)** — enregistre un authenticator pour les
   * handshakes WS dont l'URL matche `matcher`. Ordre d'enregistrement
   * préservé (1ʳᵉ match capture). Cold path (boot via P6/userland).
   *
   * @example
   * ```ts
   * // À brancher par @nodefony/security (P6) au boot, depuis les areas
   * // de `defineSecurityConfig()` filtrées sur `realtime: true`.
   * realtimeService.useAuthenticator(
   *   { pattern: "/admin/", host: "admin.example.com" },
   *   jwtRealtimeAuthenticator,
   * );
   * ```
   */
  useAuthenticator(
    matcher: IRealtimeAuthenticatorMatcher,
    authenticator: IRealtimeAuthenticator,
  ): void {
    this.getHub().useAuthenticator(matcher, authenticator);
  }

  /**
   * **Seam #1 (P13 → P6)** — pose le verrou de frame (hot-path `beforeDispatch`).
   * `null` retire la politique. À brancher 1× au boot par `@nodefony/security`
   * depuis les zones `realtime: true`. L'authorizer lit le token déjà résolu au
   * handshake (0 lecture base par frame). Délégué à `RealtimeHub.setFrameAuthorizer`.
   *
   * `options.silentProbe` porte la MÊME décision sans rapporter de refus : elle
   * répond « ce visiteur pourrait-il s'abonner ici ? » pour l'annonce des canaux
   * du `realtime:welcome`, qui interroge N canaux par connexion sans que
   * personne n'ait rien demandé. Elle se pose par CE MÊME appel pour qu'aucun
   * câblage ne puisse poser l'un sans l'autre.
   *
   * @example
   * ```ts
   * // @nodefony/security au boot :
   * realtimeService.setFrameAuthorizer((frame, token) => {
   *   // api.request {path} ≤ GET {path} : zone protégée → exige authentifié
   *   return isFrameAllowed(frame, token);
   * });
   * ```
   */
  setFrameAuthorizer(
    authorizer: FrameAuthorizer | null,
    options?: { readonly silentProbe?: FrameAuthorizer | null },
  ): void {
    this.getHub().setFrameAuthorizer(authorizer, options);
  }

  /**
   * **Seam #1b** — politique d'autorisation déclarée pour un canal/méthode
   * (`@RealtimeChannel`/`@RealtimeInbound` avec opts), agrégée par le hub au
   * handshake. Lu par `@nodefony/security` au moment de la frame `subscribe`/
   * inbound pour appliquer rôles/scopes. `null` = aucune politique métier (le
   * canal est alors soumis à la seule politique plateforme de security).
   *
   * @param channel - nom EXACT du canal ou de la méthode inbound.
   * @returns la politique déclarée, ou `null`.
   */
  resolveChannelPolicy(channel: string): IChannelPolicy | null {
    return this.getHub().resolveChannelPolicy(channel);
  }

  /**
   * Renvoie le token associé à un peer (posé au handshake par le hub). Jamais
   * `null` (Zero Trust : `ANONYMOUS_REALTIME_TOKEN` si aucun authenticator n'a
   * capturé la connexion). Lookup O(1) via WeakMap interne. Branchement P6 :
   * voters / `@IsGranted` realtime lisent l'identité par cette méthode.
   */
  getTokenForPeer(peer: JsonRpcPeer): IRealtimeToken {
    return this.getHub().getTokenForPeer(peer);
  }
}

/**
 * Construit la fonction de garde Origin (RFC 6455 §10.2) depuis la config CSRF.
 * `null` quand le check est désactivé → hub bypass total (rétrocompat). Cold
 * path (1× par boot).
 *
 * Politique fail-closed :
 *  - `enabled: false`                 → `null` (toutes origines acceptées).
 *  - `enabled: true`, Origin absent   → accepté si `allowMissingOrigin: true`,
 *                                       sinon refusé.
 *  - `enabled: true`, Origin présent  → accepté **uniquement** si exact dans
 *                                       `allowList` (pas de wildcard).
 */
function buildOriginGuard(config: IRealtimeConfig): OriginGuard | null {
  const c = config.csrf.checkOrigin;
  // Booléens garantis par le schéma Zod (`checkOriginSchema`, validé au register).
  if (!c.enabled) return null;
  // Capture les valeurs à la résolution → pas de relecture config par upgrade.
  const allowSet = new Set<string>(c.allowList);
  const allowMissing = c.allowMissingOrigin;
  return (origin: string | undefined): boolean => {
    if (origin === undefined || origin === "") return allowMissing;
    return allowSet.has(origin);
  };
}

export default RealtimeService;
export { RealtimeService };

import {
  JsonRpcPeer,
  NODEFONY_CHANNEL_NAMESPACE,
  isPlatformChannel,
} from "nodefony";
import type { RealtimePublish } from "../../interfaces/IRealtimeController";
import type { IClientLogsLimits } from "../../interfaces/IClientLogsLimits";
import type { IChannelPolicy } from "../../interfaces/IChannelPolicy";
import type {
  IRealtimeConnProbe,
  IRealtimeProbe,
} from "../../interfaces/IRealtimeProbe";
import type {
  IBackplane,
  IBackplaneMessage,
} from "../../interfaces/IBackplane";
import LoopbackBackplane from "../backplane/LoopbackBackplane";
import type { IRealtimeAuthenticator } from "../../interfaces/IRealtimeAuthenticator";
import type {
  ICompiledRealtimeMatcher,
  IRealtimeAuthenticatorMatcher,
} from "../../interfaces/IRealtimeAuthenticatorMatcher";
import type { IRealtimeHandshake } from "../../interfaces/IRealtimeHandshake";
import type { IRealtimeToken } from "../../interfaces/IRealtimeToken";
import { ANONYMOUS_REALTIME_TOKEN } from "./AnonymousRealtimeToken";

/**
 * Fonction de filtrage Origin — `true` = upgrade autorisée. Posée par
 * `RealtimeService.init()` depuis `defineRealtimeConfig().csrf.checkOrigin`.
 * `null` = aucune politique (rétrocompat : tout passe — équivalent
 * `enabled: false`).
 */
export type OriginGuard = (origin: string | undefined) => boolean;

/**
 * **Verrou de frame (seam #1 → P6)** — décide si une frame entrante (`api.request`,
 * `subscribe`…) est AUTORISÉE, à partir du {@link IRealtimeToken} déjà résolu au
 * handshake (cold path) et caché sur le peer. `true` = autorisée.
 *
 * Lecture O(1) du token en cache — **JAMAIS de re-authentification ni de lecture
 * base par frame** : l'identité (coûteuse) est figée 1× au handshake, le verrou ne
 * fait que matcher la cible de la frame (path/canal) contre la zone. Posé par
 * `@nodefony/security` au boot via {@link RealtimeService.setFrameAuthorizer}.
 * Doctrine SYNC stricte (cf `JsonRpcPeerOptions.beforeDispatch`) : un `await` par
 * frame coûterait une microtask et sérialiserait le pipeline RPC du peer.
 */
export type FrameAuthorizer = (
  frame: unknown,
  token: IRealtimeToken,
) => boolean;

interface RegisteredAuthenticator {
  readonly matcher: ICompiledRealtimeMatcher;
  readonly authenticator: IRealtimeAuthenticator;
}

/**
 * Seuil d'alerte slow-consumer (octets de `bufferedAmount`). Au-delà, la connexion
 * est comptée comme « lente » par la sonde (PAS encore de drop/close — la sonde MESURE
 * avant qu'on optimise : stringify unique → seuil de drop → coalescing). 1 MiB =
 * `websocket.maxPayload` par défaut : une file qui dépasse une frame max pleine est
 * déjà anormale pour des canaux d'ÉTAT (latest-wins).
 */
export const SLOW_CONSUMER_BYTES = 1 << 20; // 1 MiB

/**
 * **Namespace de canaux RÉSERVÉ À LA PLATEFORME** — un seul préfixe, `nodefony:`.
 *
 * Les canaux qu'il couvre exposent l'état interne du pod : journaux, requêtes de
 * base, métriques process, supervision, contrôle du noyau, journal d'audit. Aucun
 * n'appartient au métier d'une application — ils décrivent le serveur lui-même.
 *
 * La liste reste exposée **ici** (au pluriel, sous forme de tableau) parce que le hub
 * est propriétaire de l'espace de nommage des canaux : c'est lui qui les sert.
 * `@nodefony/security`, quand il est chargé, y attache des POLITIQUES (quels rôles)
 * qu'il lit sur cette liste via la surface de service — il ne la redéclare pas. Deux
 * listes auraient divergé au premier namespace ajouté. Le tableau survit à la
 * réduction à une entrée : la forme est un contrat public (`reservedSystemPrefixes()`),
 * et rien n'interdit qu'un jour un second namespace de plateforme apparaisse.
 *
 * Le nom des canaux, lui, vient de la table `PLATFORM_CHANNELS` du cœur (isomorphe) :
 * le navigateur doit connaître les mêmes noms que le serveur.
 *
 * Sans module de sécurité, ces canaux sont **fermés** aux connexions clientes
 * (cf {@link RealtimeHub.subscribeClient}) : aucune identité n'existe alors, donc
 * personne ne peut prouver qu'il a le droit de les lire.
 */
export const RESERVED_SYSTEM_PREFIXES = [NODEFONY_CHANNEL_NAMESPACE] as const;

/**
 * Le canal appartient-il au namespace réservé à la plateforme ?
 *
 * Alias de {@link isPlatformChannel} (cœur isomorphe) sous le nom que porte cette
 * notion côté hub : le hub raisonne en « canal réservé », le client en « surface de
 * plateforme ». Une seule implémentation — la comparaison est insensible à la casse,
 * sinon `NODEFONY:syslog` échapperait au plancher que `nodefony:syslog` subit.
 *
 * @param channel - nom du canal demandé (suffixes de cadence et de forage inclus).
 */
export const isReservedSystemChannel = isPlatformChannel;

/**
 * Période de re-validation des identités RÉVOCABLES — F4 (revue 0.6).
 * Le verrou de frame est SYNC par doctrine (identité figée au handshake, cf
 * {@link FrameAuthorizer}) → il ne peut pas re-lire la session par frame. Un socket
 * survivrait donc à sa session (`subscribe` garderait ses flux après un logout HTTP),
 * là où `api.request` re-valide déjà par requête (`isValid()`). Ce tick ferme
 * l'écart : toutes les `REVOCATION_REVALIDATE_MS`, les tokens révocables sont
 * re-validés et la connexion fermée si l'identité n'est plus valide (≤ 1 fenêtre de
 * délai). Ordre de grandeur aligné sur le heartbeat WS (`keepaliveInterval` 20 s).
 */
export const REVOCATION_REVALIDATE_MS = 30_000;

/**
 * Connexion à identité RÉVOCABLE inscrite au registre de re-validation (F4). Ne
 * porte QUE ce qu'il faut pour re-valider puis fermer : le token (avec `isValid`) et
 * un `close` fermant la socket brute. 1 entrée = 1 connexion à identité révocable
 * (session BFF relue, ou jeton porteur à borne/denylist).
 */
export interface IRevocableConnection {
  readonly token: IRealtimeToken;
  readonly close: (code: number, reason: string) => void;
}

/**
 * Sink d'un canal : pousse une charge vers UNE connexion abonnée (son `peer.notify`).
 * 1 sink = 1 connexion. Le hub fan-out la charge à tous les sinks d'un canal.
 *
 * `serialized` n'est fourni que si le canal a déclaré un {@link ChannelSerializer}
 * ET qu'il a plusieurs abonnés : la frame ayant été sérialisée une fois pour tous,
 * le sink peut l'envoyer telle quelle au lieu de refaire le travail. Absent, le
 * sink se débrouille comme avant — un sink historique à un seul paramètre ignore
 * simplement l'argument.
 */
export type ChannelSink = (payload: unknown, serialized?: string) => void;

/**
 * Sérialiseur de la frame d'un canal, fourni par l'abonné (le hub ignore tout du
 * protocole). Appelé **au plus une fois par publication**, jamais par abonné.
 */
export type ChannelSerializer = (payload: unknown) => string;

/**
 * Fabrique le provider PARTAGÉ d'un canal (listener/ticker qui pousse via `publish`).
 * Appelée UNE fois, au 1ᵉʳ abonné. Renvoie son `dispose` (appelé au dernier
 * désabonné) ou `null` si le canal est inconnu. Le provider doit capturer des deps
 * **long-lived** (kernel/syslog/broker, valeurs simples) — JAMAIS la connexion qui
 * a déclenché la création (elle peut fermer alors que le provider partagé survit).
 */
export type ChannelFactory = (
  channel: string,
  publish: RealtimePublish,
) => (() => void) | null;

interface ChannelState {
  /** dispose du provider partagé (`null` brièvement pendant la création). */
  dispose: (() => void) | null;
  /**
   * Le canal a-t-il un **propriétaire** — c'est-à-dire une fabrique qui a
   * répondu de lui et fourni un provider réel ? `false` = état **passif** :
   * il n'existe que parce qu'un service serveur ÉCOUTE ce nom ({@link listen}).
   *
   * Un état passif ne vaut PAS existence du canal : une connexion cliente qui
   * le demande fait rejouer la fabrique du controller ({@link subscribe}), qui
   * seule décide. Sans cette distinction, le premier écouteur venu inventait un
   * canal pour tout le monde — et les clients suivants entraient sans que
   * personne n'ait dit que ce canal existait, sur un flux que rien ne produit.
   */
  owned: boolean;
  /** abonnés locaux (1 sink = 1 connexion). */
  sinks: Set<ChannelSink>;
  /**
   * Sérialiseur de frame du canal, posé par le 1ᵉʳ abonné qui en fournit un.
   * `null` = canal sans mutualisation possible (sink historique) → chemin d'avant.
   */
  serialize: ChannelSerializer | null;
  /** publications cumulées sur ce canal (monotone) — sonde fan-out. */
  messages: number;
  /**
   * Le canal traverse-t-il le {@link IBackplane} (cross-process) ? Mis en cache au
   * 1ᵉʳ abonné depuis la politique de forward (cf {@link RealtimeHub.markBroadcastChannel})
   * → le chemin chaud `publish` lit un booléen, jamais une comparaison de chaîne.
   */
  forward: boolean;
}

/**
 * RealtimeHub — broker temps réel **PAR INSTANCE** (1 pod = 1 process = 1 hub local).
 *
 * Élève le realtime serveur du modèle **per-connexion** (chaque connexion son propre
 * ticker/listener = N fois le même travail) au modèle **canaux PARTAGÉS** : un canal a
 * **UN provider** créé au 1ᵉʳ abonné et un **fan-out** vers tous les abonnés. C'est le
 * gain cloud-native (1 ticker/canal/pod) ET le **seam du backplane Redis** (le cross-pod
 * se branchera dans {@link publish} : fan-out local + forward Redis, l'ingress backplane
 * ne refaisant QUE du fan-out local — règle anti-boucle). Cf vision « la socket Nodefony ».
 *
 * Périmètre actuel : canaux **broadcast** (même flux pour tous les abonnés — stats,
 * syslog, orm…). Les canaux **privés/par-connexion** (ex. une ligne SIP par user) =
 * seam futur (le provider serait per-connexion, pas partagé).
 *
 * Perf (règle ABSOLUE) : map des canaux **lazy** (rien alloué tant qu'aucun abonné) ;
 * provider créé au 1ᵉʳ abonné, **disposé au dernier** (aucun timer/listener orphelin) ;
 * fan-out isolé (une connexion fautive ne casse pas la diffusion). Le hub lui-même est
 * **sans dépendance** : ce sont les *factories* (fournies par les contrôleurs) qui
 * portent les deps.
 *
 * Vocabulaire : la **socket** ({@link IRealtimeSocket}) est la prise que tient le métier ;
 * ce **hub** est le broker serveur caché derrière (registre + fan-out local). La socket
 * multiplexe des canaux ; le hub aiguille entre les sockets. La façade *consommateur*
 * côté serveur EXISTE — {@link ServerRealtimeSocket} (`subscribe/on/publish`), exportée
 * par le barrel du module : c'est elle qu'un service back tient, jamais ce hub
 * directement. Même rôle que `RealtimeClient` côté navigateur.
 */
export class RealtimeHub {
  // Lazy : alloué au 1ᵉʳ subscribe (un process sans abonné n'alloue rien).
  #channels: Map<string, ChannelState> | null = null;

  // Compteurs d'auto-observabilité (sonde socket). Primitives → 0 alloc, incrément
  // O(1) sur le chemin `publish` (pas de syscall/stringify). Cumuls MONOTONES → le
  // débit/s se dérive côté lecteur. Cf {@link probe}.
  #publishTotal = 0;
  #fanoutTotal = 0;
  #inboundTotal = 0;

  // Messages d'ingress backplane REFUSÉS par le contrôle d'admission (F83) : canal
  // non déclaré broadcast. Cumul monotone — un compteur qui décolle signale soit un
  // pair mal configuré, soit une écriture tierce dans le bus partagé. C'est le
  // « fail-loud » de cette porte : le hub est sans dépendance (aucun logger), la
  // sonde est son unique canal de signalement. Cf {@link #admitFromBackplane}.
  #ingressRejectedTotal = 0;

  // Abonnements clients refusés par le plancher des canaux de plateforme (F82) :
  // canal réservé demandé alors qu'aucun module de sécurité n'est chargé. Cumul
  // monotone, remonté par la sonde — le hub n'a pas de logger, ce compteur et
  // l'alerte ci-dessous sont ses deux seuls moyens de ne pas rester muet.
  #systemFloorDeniedTotal = 0;

  // Avertissements de PLATEFORME, posés par le contrôleur (qui, lui, sait
  // journaliser — le hub est sans dépendance). Chaque motif n'est émis qu'UNE
  // fois : ces signaux décrivent une configuration, pas un flux ; répétés à
  // chaque abonnement ils deviendraient un amplificateur sous charge.
  #notice: ((message: string, severity: "WARNING" | "INFO") => void) | null =
    null;
  #noticed: Set<string> | null = null;

  // Registre des connexions vivantes — lazy (0 alloc tant qu'aucune connexion). Sert
  // UNIQUEMENT la sonde (backpressure : `bufferedAmount` vit sur la connexion brute,
  // pas sur le sink opaque). Inscrit au handshake, retiré au close (symétrique).
  #connections: Set<IRealtimeConnProbe> | null = null;

  // Registre des connexions à identité RÉVOCABLE (tout token portant `isValid`) —
  // F4 (revue 0.6). Lazy : `null` tant qu'aucune session révocable (anonyme/JWT sans
  // revalidation n'y entrent JAMAIS → 0 coût). Re-validé périodiquement par
  // {@link revalidateRevocable} → ferme les sockets dont la session est morte/changée.
  #revocable: Set<IRevocableConnection> | null = null;

  // Timer du tick de re-validation (F4). Lazy : démarré au 1ᵉʳ révocable, arrêté dès
  // que le registre se vide → 0 timer au repos (règle perf). `unref` : ne bloque
  // jamais l'arrêt du process.
  #revalidateTimer: ReturnType<typeof setInterval> | null = null;

  // Backplane cross-process (P13). `null` par défaut = mono-process (Loopback implicite,
  // 0 overhead : `publish` ne paie qu'un test `!== null`). Branché par le module quand
  // un mode multi-process est détecté (cluster IPC → ClusterBackplane ; pods → Redis).
  // Cf {@link setBackplane} + IBackplane.
  #backplane: IBackplane | null = null;

  // ── Seam sécurité (P13 Bloc A étape 6) ────────────────────────────────────
  //
  // Authenticators réseau enregistrés (1ʳᵉ matcher capture). Lazy : `null` tant
  // qu'aucun `useAuthenticator` n'est appelé → 0 alloc + bypass total côté
  // RealtimeController au handshake (token anonyme gelé direct).
  #authenticators: RegisteredAuthenticator[] | null = null;

  // Mapping `peer → token` (cold path : posé au handshake, lu sur hot path par
  // `beforeDispatch` / `onFrameAudit` consumers — voters P6 lookup `getTokenForPeer`).
  // WeakMap : 0 fuite mémoire quand le peer est GC à la fermeture connexion.
  // Lazy : `null` tant qu'aucun token posé (cas mono-process non sécurisé).
  #peerTokens: WeakMap<JsonRpcPeer, IRealtimeToken> | null = null;

  // Verrou de frame (seam #1 → P6). `null` = pas de politique → `runAuthorizer`
  // rend `true` immédiatement (bypass d'une comparaison). Le RealtimeController
  // arme `beforeDispatch` sur TOUTE connexion, sans regarder ce champ : sinon un
  // peer connecté avant la pose du verrou n'était jamais gardé, pour toute la
  // durée de sa socket. Posé 1× au boot par `@nodefony/security`, mais une pose
  // tardive (rechargement, test) doit mordre sur les connexions en cours.
  // Cf runAuthorizer / hasFrameAuthorizer.
  #frameAuthorizer: FrameAuthorizer | null = null;

  // Le MÊME verdict que `#frameAuthorizer`, mais MUET : posé par le même appel
  // (`setFrameAuthorizer`), issu de la même fabrique, sans le rapporteur d'audit.
  // Il sert à répondre « ce visiteur pourrait-il s'abonner ici ? » hors de toute
  // tentative — le welcome, qui interroge N canaux à chaque connexion. Passer par
  // le verrou lui-même y écrirait N refus au journal d'audit pour des demandes
  // que PERSONNE n'a faites, et un journal d'audit inondé de non-évènements
  // cesse d'être lu. `null` = aucune sonde → on ne filtre rien (cf probeChannel).
  #channelProbe: FrameAuthorizer | null = null;

  // Seam #1b — registre des politiques de canal DÉCLARÉES (`@RealtimeChannel`/
  // `@RealtimeInbound` avec opts), indexé par nom de canal/méthode. Le hub ne
  // DÉCIDE rien (il ignore la hiérarchie de rôles et l'identité réelle) : il
  // collecte la déclaration et l'expose à `@nodefony/security`, seul décideur.
  // Lazy : `null` tant qu'aucun controller décoré ne publie de policy → 0 alloc
  // sur un hub aux canaux libres. Alimenté (idempotent) au handshake.
  #channelPolicies: Map<string, IChannelPolicy> | null = null;

  /**
   * Politiques déclarées par MOTIF de nom (`chat:room:*`), triées du plus
   * spécifique au plus général, et `null` tant qu'aucune n'est déclarée.
   *
   * 🔴 Pourquoi une liste À PART de la Map exacte, et pourquoi elle reste
   * `null` : `resolveChannelPolicy` est appelé à CHAQUE `subscribe`. Le nom
   * exact doit rester une lecture O(1) sans allocation ; les motifs ne sont
   * parcourus que si aucun nom exact ne répond ET qu'il en existe. Une
   * application qui n'en déclare aucun ne paie rien — pas même le test d'un
   * tableau vide.
   *
   * Le tri à l'insertion (littéral le plus long d'abord) évite de trancher au
   * moment de la lecture : entre `chat:*` et `chat:room:*`, c'est le second qui
   * doit gagner sur `chat:room:12`, et l'ordre le dit une fois pour toutes.
   */
  #channelPolicyPatterns: Array<{
    source: string;
    re: RegExp;
    poids: number;
    policy: IChannelPolicy;
  }> | null = null;

  // Registre des canaux SYSTÈME (plateforme) — factory par nom EXACT, fournie par
  // un module bas niveau (`@nodefony/security` → `nodefony:audit`) au boot, SANS
  // qu'aucun RealtimeController ne la connaisse. Consulté par `subscribe` en
  // dernier recours (la factory du controller a renvoyé `null` = canal inconnu de
  // lui) → tout endpoint sert le canal système, ZÉRO couplage à Studio. Lazy :
  // `null` tant qu'aucun module n'en enregistre. Cf {@link registerSystemChannel}.
  #systemChannelFactories: Map<string, ChannelFactory> | null = null;

  // Bornes de la réception des journaux du NAVIGATEUR (#35). `null` (défaut) = le
  // canal montant n'est pas ouvert : `RealtimeController` ne déclare alors AUCUN
  // handler entrant pour lui, donc une frame `nodefony:syslog:uplink` est droppée
  // comme n'importe quelle méthode non déclarée. Posé au boot par
  // `RealtimeService.init()` depuis `defineRealtimeConfig().clientLogs`.
  #clientLogs: IClientLogsLimits | null = null;

  // Garde Origin RFC 6455 §10.2 (CSRF defense). `null` = pas de politique
  // (rétrocompat). Posée par `RealtimeService.init()` depuis
  // `defineRealtimeConfig().csrf.checkOrigin`. Cold path (1× par upgrade).
  #originGuard: OriginGuard | null = null;

  // F6a (revue 0.6) — plafond de canaux PAR CONNEXION (anti-OOM). Lu par
  // `RealtimeController.startChannel` à chaque subscribe (hot-ish path : 1 lecture
  // de champ, pas d'alloc). Défaut = celui du schéma (256) → cap actif même si le
  // hub est utilisé sans `RealtimeService` (tests). Posé depuis
  // `defineRealtimeConfig().limits.maxChannelsPerConnection` au boot. `null` = illimité.
  #maxChannelsPerConnection: number | null = 256;

  // F9 (revue 0.6) — seuil `bufferedAmount` de comptage des consommateurs lents dans
  // `probe()`. Défaut = SLOW_CONSUMER_BYTES ; posé depuis
  // `defineRealtimeConfig().slowConsumer.bytes` au boot (avant ce câblage, la clé de
  // config était MORTE : la sonde lisait la constante). Métrique d'observabilité
  // uniquement — l'ACTION de back-pressure a ses propres seuils dans WsConnectionTransport.
  #slowConsumerBytes: number = SLOW_CONSUMER_BYTES;

  // Politique de forward PAR CANAL (Phase 4). Préfixes des canaux **broadcast**
  // (cross-process). Lazy : `null` tant qu'aucun canal broadcast n'est déclaré →
  // par défaut TOUT canal est **instance-local** (ne traverse PAS le backplane).
  // POURQUOI ce défaut : (1) sûreté Zero-Trust — aucune donnée per-instance (logs,
  // sondes, état interne) ne fuit cross-process sans intention explicite ; (2) tous
  // les canaux d'observabilité actuels (syslog/supervision/orm/nodefony:socket) sont
  // per-instance → corrects en cluster sans aucune déclaration ; (3) le forward (chat,
  // présence, notifications) devient une capacité qu'un canal **demande**. Cf
  // {@link markBroadcastChannel}. En mono-process (`#backplane === null`) cette
  // politique n'est JAMAIS évaluée (le hot path ne paie qu'un test `=== null`).
  #broadcastPrefixes: string[] | null = null;

  /**
   * Abonnement demandé par une **connexion cliente** — même chose que
   * {@link subscribe}, plus le plancher des canaux de plateforme.
   *
   * Pourquoi deux portes : un service du serveur qui écoute ses propres journaux
   * est légitime ; une connexion distante qui demande `nodefony:syslog` alors
   * qu'aucun module de sécurité n'est chargé ne l'est pas. Le hub ne peut pas
   * deviner l'origine d'un appel — le contrôleur, lui, sait qu'il traite une
   * frame venue du réseau, et passe donc par ici.
   *
   * Le plancher ne s'applique **que** sans verrou de frame. Dès qu'un module de
   * sécurité en pose un, c'est lui qui décide (avec les rôles, ce que le hub ne
   * sait pas faire) et le plancher s'efface.
   *
   * @returns `true` si abonné, `false` si canal inconnu ou fermé par le plancher.
   */
  subscribeClient(
    channel: string,
    sink: ChannelSink,
    factory: ChannelFactory,
    serialize?: ChannelSerializer,
  ): boolean {
    // 🔴 Un `*` désigne un MOTIF de politique, jamais un canal. Sans ce refus,
    // un client pourrait s'abonner littéralement à `chat:room:*` : le nom ne
    // correspond à aucune politique EXACTE, et la garde par motif ne le couvre
    // pas non plus (`^chat:room:.*$` matche pourtant `chat:room:*`…) — c'est
    // exactement le genre de nom que personne ne pense à interdire, et qui
    // ouvre une porte à côté du verrou.
    if (channel.includes("*")) {
      this.#notifyOnce(
        "wildcard-channel",
        `abonnement REFUSÉ au canal "${channel}" : le caractère « * » est ` +
          `réservé aux MOTIFS de politique et n'a pas de sens dans un nom de ` +
          `canal servi. Un motif garde une famille, il ne se souscrit pas.`,
      );
      return false;
    }
    if (this.#frameAuthorizer === null && isReservedSystemChannel(channel)) {
      this.#systemFloorDeniedTotal += 1;
      this.#notifyOnce(
        "system-floor",
        `canal de plateforme "${channel}" REFUSÉ : aucun module de sécurité ` +
          `n'est chargé, donc aucune identité ne peut être vérifiée. Les ` +
          `namespaces réservés (${RESERVED_SYSTEM_PREFIXES.join(" ")}) sont ` +
          `fermés à toutes les connexions. Deux causes possibles : la sécurité ` +
          `n'est pas installée (charger @nodefony/security et déclarer une zone ` +
          `protégée), ou ce canal applicatif porte par erreur un préfixe réservé ` +
          `— dans ce cas, le renommer suffit.`,
      );
      return false;
    }
    return this.subscribe(channel, sink, factory, serialize);
  }

  /**
   * Abonne un consommateur qui **répond du canal** : il apporte la `factory`, donc
   * la réponse à « ce canal existe-t-il, et qui le produit ? ». Le provider partagé
   * est créé au 1ᵉʳ abonné de ce genre. Le sink est inscrit AVANT l'appel à
   * `factory` → le 1ᵉʳ paquet immédiat éventuel du provider (ex. tick initial de
   * `createBrokerTicker`) atteint bien cet abonné.
   *
   * Un canal en état **passif** (ouvert par des écouteurs seuls, cf {@link listen})
   * n'est PAS considéré comme existant : la fabrique est rejouée et tranche. Un
   * refus laisse les écouteurs en place — ils n'ont jamais prétendu le produire.
   *
   * @returns `true` si abonné, `false` si canal inconnu (`factory` a renvoyé `null`).
   */
  subscribe(
    channel: string,
    sink: ChannelSink,
    factory: ChannelFactory,
    serialize?: ChannelSerializer,
  ): boolean {
    const channels = (this.#channels ??= new Map<string, ChannelState>());
    let st = channels.get(channel);
    if (st) {
      if (st.owned) {
        st.sinks.add(sink);
        // Canal déjà ouvert par un abonné sans sérialiseur : le premier qui en
        // apporte un ouvre la mutualisation pour les suivants.
        if (st.serialize === null && serialize !== undefined) {
          st.serialize = serialize;
        }
        return true;
      }
      // Canal PASSIF : seuls des écouteurs le tiennent. Celui-ci apporte une
      // fabrique — elle décide. Sink inscrit avant (même invariant qu'à la
      // création), et retiré si la fabrique ne connaît pas le canal.
      st.sinks.add(sink);
      const dispose = this.#createProvider(channel, factory);
      if (dispose === null) {
        st.sinks.delete(sink);
        return false;
      }
      st.dispose = dispose;
      st.owned = true;
      if (serialize !== undefined) st.serialize = serialize;
      return true;
    }
    // 1ᵉʳ abonné : on inscrit le sink AVANT de créer le provider (capte son 1ᵉʳ push).
    // `forward` résolu UNE fois ici (cold path) puis lu en O(1) sur `publish`.
    st = {
      dispose: null,
      owned: false,
      sinks: new Set([sink]),
      serialize: serialize ?? null,
      messages: 0,
      forward: this.#isBroadcast(channel),
    };
    channels.set(channel, st);
    const dispose = this.#createProvider(channel, factory);
    if (dispose === null) {
      channels.delete(channel); // canal inconnu → rien créé, on nettoie
      return false;
    }
    st.dispose = dispose;
    st.owned = true;
    return true;
  }

  /**
   * **Écoute passive** — un service du serveur reçoit ce qui passe sur un canal
   * sans prétendre le produire. C'est la porte de {@link ServerRealtimeSocket} :
   * un service back qui `subscribe` sur sa façade écoute, il n'ouvre rien.
   *
   * Différence avec {@link subscribe} : aucune fabrique, donc aucun provider et
   * **aucune revendication d'existence**. Si le canal n'a pas encore de
   * propriétaire, l'état créé est marqué passif ; la première connexion cliente
   * qui le demandera fera trancher la fabrique du controller. Un canal déjà
   * ouvert est simplement rejoint (le provider partagé n'est pas touché).
   *
   * Un écouteur n'échoue jamais : il entendra si — et quand — quelqu'un publie.
   * Cold path (abonnement d'un service, pas une frame réseau).
   */
  listen(channel: string, sink: ChannelSink): void {
    const channels = (this.#channels ??= new Map<string, ChannelState>());
    const st = channels.get(channel);
    if (st !== undefined) {
      st.sinks.add(sink);
      return;
    }
    channels.set(channel, {
      dispose: null,
      owned: false,
      sinks: new Set([sink]),
      serialize: null,
      messages: 0,
      forward: this.#isBroadcast(channel),
    });
  }

  /**
   * Le canal a-t-il un propriétaire (une fabrique a fourni son provider) ?
   * `false` = inconnu, ou tenu par de seuls écouteurs ({@link listen}).
   */
  isChannelOwned(channel: string): boolean {
    return this.#channels?.get(channel)?.owned ?? false;
  }

  /**
   * Crée le provider d'un canal : fabrique de l'abonné d'abord, registre des
   * canaux SYSTÈME en dernier recours. `null` = canal inconnu des deux.
   */
  #createProvider(
    channel: string,
    factory: ChannelFactory,
  ): (() => void) | null {
    const publishFn = (ch: string, payload: unknown): void =>
      this.publish(ch, payload);
    const dispose = factory(channel, publishFn);
    if (dispose !== null) return dispose;
    // Inconnu du controller → dernier recours : factory de canal SYSTÈME
    // (plateforme) enregistrée par un module bas niveau (nodefony:audit…).
    const sys = this.#systemChannelFactories?.get(channel);
    return sys ? sys(channel, publishFn) : null;
  }

  /**
   * Désabonne une connexion d'un canal. Au **dernier** abonné, `dispose()` le provider
   * et retire le canal (libère timers/listeners). No-op si non abonné.
   */
  unsubscribe(channel: string, sink: ChannelSink): void {
    const st = this.#channels?.get(channel);
    if (!st) return;
    st.sinks.delete(sink);
    if (st.sinks.size === 0) {
      try {
        st.dispose?.();
      } catch {
        /* noop — un provider fautif ne bloque pas le nettoyage */
      }
      this.#channels!.delete(channel);
    }
  }

  /**
   * Publie une charge sur un canal : **fan-out local** **+** propagation conditionnelle
   * au {@link IBackplane} (autres workers/pods). C'est le point d'entrée des providers
   * locaux (tickers, listeners) ET de tout code serveur.
   *
   * Forward **opt-in par canal** : la charge ne traverse le backplane que si le canal
   * est déclaré **broadcast** ({@link markBroadcastChannel}). Par défaut un canal est
   * **instance-local** (per-instance : observabilité, état du pod) → il reste dans le
   * process. Le flag est mis en cache dans l'état du canal (lu en O(1)) ; pour un
   * `publish` serveur sans abonné local (pas d'état), la politique est évaluée à la volée.
   *
   * Anti-boucle : un message **reçu** du backplane ne repasse PAS par ici (il appelle
   * `publishLocal` directement) → aucune ré-émission cross-process, pas de tempête.
   */
  publish(channel: string, payload: unknown): void {
    const st = this.#channels?.get(channel);
    if (st !== undefined) this.#fanout(st, payload);
    // Mono-process : aucun backplane → seul ce test est payé, la politique de forward
    // n'est JAMAIS évaluée (préserve l'invariant « hot path = 1 test null »).
    if (this.#backplane === null) return;
    // Forward opt-in : flag caché si le canal a un état local, sinon politique à la volée
    // (publish serveur vers un canal sans abonné ici mais avec des abonnés ailleurs).
    const forward = st !== undefined ? st.forward : this.#isBroadcast(channel);
    if (forward) this.#backplane.publish(channel, payload);
  }

  /**
   * Fan-out d'une charge aux **seuls abonnés locaux** d'un canal (process courant).
   * NE propage PAS au backplane → c'est la voie d'**ingress** d'un message venu d'un
   * autre pair (le hub câble `backplane.onMessage` dessus dans {@link setBackplane}) :
   * réinjection locale sans reboucler. Aussi appelable directement pour un push
   * strictement local (jamais propagé).
   */
  publishLocal(channel: string, payload: unknown): void {
    const st = this.#channels?.get(channel);
    if (st !== undefined) this.#fanout(st, payload);
  }

  /** Fan-out interne (sonde + livraison isolée). Partagé par `publish`/`publishLocal`. */
  #fanout(st: ChannelState, payload: unknown): void {
    // Sonde : 1 publish, N livraisons (= fan-out réel). Incréments O(1).
    this.#publishTotal += 1;
    st.messages += 1;
    this.#fanoutTotal += st.sinks.size;
    // Diffusion à plusieurs : la frame est la MÊME pour tous → on la sérialise
    // une fois ici plutôt que N fois dans les sinks. À un seul abonné il n'y a
    // rien à mutualiser, et on ne paie donc rien de plus qu'avant.
    let raw: string | undefined;
    if (st.serialize !== null && st.sinks.size > 1) {
      try {
        raw = st.serialize(payload);
      } catch {
        // Charge non sérialisable : on ne casse pas le fan-out. Chaque sink
        // reprend son chemin habituel, qui porte déjà son filet (log + réponse
        // d'erreur au client concerné).
        raw = undefined;
      }
    }
    for (const sink of st.sinks) {
      try {
        sink(payload, raw);
      } catch {
        /* une connexion fautive ne casse pas le fan-out aux autres */
      }
    }
  }

  /**
   * Déclare un **préfixe** de canal **broadcast** : ses publications traversent le
   * {@link IBackplane} (cross-process). Tout le reste demeure instance-local (défaut sûr).
   * Le préfixe couvre la granularité de cadence (`chat:` matche `chat:room1:1000`).
   *
   * Idempotent ; cold-path (appelé au handshake/boot d'un endpoint realtime, jamais
   * sur le chemin chaud). Réévalue les canaux DÉJÀ actifs → l'ordre déclaration/abonnement
   * n'a pas d'importance.
   *
   * @param prefix - préfixe de canal à forwarder (ex. `"chat:"`, `"presence:"`).
   */
  markBroadcastChannel(prefix: string): void {
    // REFUS d'un namespace réservé. Diffuser `syslog:` entre pods ouvrirait
    // l'entrée du bus à ce namespace : un tiers capable d'écrire sur le
    // transport partagé injecterait alors de fausses lignes de journal dans
    // TOUS les pods. C'est précisément le trou que l'admission par canal ferme —
    // l'autoriser ici le rouvrirait par la porte de service.
    if (isReservedSystemChannel(prefix)) {
      this.#notifyOnce(
        "reserved-broadcast",
        `déclaration de diffusion IGNORÉE pour "${prefix}" : ce namespace est ` +
          `réservé à la plateforme (${RESERVED_SYSTEM_PREFIXES.join(" ")}). ` +
          `Le diffuser entre pods ouvrirait l'entrée du bus à ce canal — un ` +
          `tiers pourrait y injecter du contenu. Utiliser un préfixe applicatif.`,
      );
      return;
    }
    const prefixes = (this.#broadcastPrefixes ??= []);
    if (prefixes.includes(prefix)) return;
    prefixes.push(prefix);
    if (this.#channels) {
      for (const [channel, st] of this.#channels) {
        if (!st.forward && channel.startsWith(prefix)) st.forward = true;
      }
    }
  }

  /** Un canal est-il broadcast (préfixe déclaré) ? `false` si aucune politique (défaut local). */
  #isBroadcast(channel: string): boolean {
    const prefixes = this.#broadcastPrefixes;
    if (prefixes === null) return false;
    for (let i = 0; i < prefixes.length; i++) {
      if (channel.startsWith(prefixes[i]!)) return true;
    }
    return false;
  }

  /**
   * Branche le {@link IBackplane} cross-process (cluster IPC, Redis…) et câble son
   * ingress ({@link #admitFromBackplane}) : un message reçu d'un autre pair est
   * réinjecté en **fan-out local uniquement** ({@link publishLocal}) — barrière
   * anti-boucle côté hub (le backplane filtre déjà son propre echo). Remplace un
   * backplane précédent (l'appelant est responsable de `stop()` l'ancien). Démarre
   * le transport.
   *
   * @returns le backplane branché (chaînage).
   */
  setBackplane(backplane: IBackplane): IBackplane {
    this.#backplane = backplane;
    backplane.onMessage((msg) => this.#admitFromBackplane(msg));
    backplane.start();
    return backplane;
  }

  /**
   * **Contrôle d'admission de l'ingress backplane** (F83) — un message venu d'un
   * pair n'est réinjecté QUE si son canal est déclaré **broadcast**
   * ({@link markBroadcastChannel}) ; sinon il est compté et jeté.
   *
   * POURQUOI : la politique de forward était asymétrique. En SORTIE, `publish` ne
   * traverse le backplane que pour un canal broadcast ; en ENTRÉE, tout était
   * accepté. Un pair (ou quiconque écrit dans un bus partagé, cf `envelope.ts`)
   * pouvait donc pousser sur des canaux **instance-local** que la politique refuse
   * précisément de faire voyager — `syslog:`, `nodefony:audit`, `nodefony:socket` —
   * et injecter de faux évènements dans les écrans d'admin de TOUS les pods.
   *
   * Symétrie rétablie, et **quel que soit le driver** : un driver userland qui
   * n'authentifierait rien ne peut pas contourner cette porte. Zéro régression
   * nominale : un pair légitime n'émet que des canaux broadcast (`publish` filtre à
   * la source), et un canal ne peut avoir d'abonné local que si l'endpoint qui le
   * sert a été handshaké — donc ses préfixes déjà déclarés.
   */
  #admitFromBackplane(msg: IBackplaneMessage): void {
    if (!this.#isBroadcast(msg.channel)) {
      this.#ingressRejectedTotal += 1;
      return;
    }
    this.publishLocal(msg.channel, msg.payload);
  }

  /** Backplane cross-process branché, ou `null` en mono-process (lecture/tests/sonde). */
  get backplane(): IBackplane | null {
    return this.#backplane;
  }

  /** Nombre d'abonnés locaux d'un canal (observabilité / tests). */
  subscriberCount(channel: string): number {
    return this.#channels?.get(channel)?.sinks.size ?? 0;
  }

  /**
   * Inscrit une connexion au registre de la sonde (au handshake). Lazy : alloue le
   * Set au 1ᵉʳ appel. Le hub ne lit ces connexions QUE dans {@link probe} (jamais
   * sur le chemin chaud). À équilibrer par {@link unregisterConnection} au close.
   */
  registerConnection(conn: IRealtimeConnProbe): void {
    (this.#connections ??= new Set<IRealtimeConnProbe>()).add(conn);
  }

  /** Retire une connexion du registre de la sonde (au close). No-op si absente. */
  unregisterConnection(conn: IRealtimeConnProbe): void {
    this.#connections?.delete(conn);
  }

  /**
   * Inscrit une connexion à identité RÉVOCABLE au registre de
   * re-validation (F4, revue 0.6). Démarre le tick au 1ᵉʳ inscrit (timer `unref`,
   * 0 timer au repos). À équilibrer par {@link unregisterRevocable} au close.
   * N'inscrire QUE les tokens portant `isValid` (le controller filtre) : une identité
   * non révocable (anonyme/JWT sans revalidation) ne doit pas y entrer.
   */
  registerRevocable(entry: IRevocableConnection): void {
    const set = (this.#revocable ??= new Set<IRevocableConnection>());
    set.add(entry);
    if (this.#revalidateTimer === null) {
      this.#revalidateTimer = setInterval(() => {
        void this.revalidateRevocable();
      }, REVOCATION_REVALIDATE_MS);
      this.#revalidateTimer.unref?.();
    }
  }

  /**
   * Retire une connexion du registre de révocation (au close). Arrête le tick dès que
   * le registre est vide (0 timer au repos). No-op si absente.
   */
  unregisterRevocable(entry: IRevocableConnection): void {
    if (this.#revocable === null) return;
    this.#revocable.delete(entry);
    if (this.#revocable.size === 0 && this.#revalidateTimer !== null) {
      clearInterval(this.#revalidateTimer);
      this.#revalidateTimer = null;
    }
  }

  /**
   * Tick de re-validation (F4) : re-lit l'identité de chaque connexion révocable
   * (`token.isValid()`) et FERME la socket (`4001`) si l'identité est morte : session
   * détruite ou passée à un autre compte, jeton expiré ou révoqué.
   * Fail-closed : une re-validation qui throw ferme aussi (parité `invokeApiRequest`).
   * Snapshot du registre AVANT les `await` (le `close` mute le registre via le cleanup
   * `onFinish`). Exposé (public) pour un test déterministe sans fake timers.
   */
  async revalidateRevocable(): Promise<void> {
    if (this.#revocable === null || this.#revocable.size === 0) return;
    const snapshot = [...this.#revocable];
    for (const entry of snapshot) {
      let valid: boolean | undefined;
      try {
        valid = await entry.token.isValid?.();
      } catch {
        valid = false; // fail-closed : re-validation en erreur = session invalide
      }
      if (valid === false) {
        // Retire AVANT le close : le close déclenche `onFinish` (async) qui
        // ré-appellera unregisterRevocable (idempotent) ; on évite surtout un
        // re-close au tick suivant si onFinish n'a pas encore couru.
        this.unregisterRevocable(entry);
        try {
          entry.close(4001, "session revoked");
        } catch {
          /* socket déjà fermée / close fautif → onFinish finira le nettoyage */
        }
      }
    }
  }

  /**
   * Compte une frame entrante full-duplex (canaux gated SIP/bridge). Appelé par le
   * contrôleur quand un handler `realtimeInbound` traite un message client.
   */
  recordInbound(): void {
    this.#inboundTotal += 1;
  }

  /**
   * Snapshot d'auto-observabilité de la socket (per-instance). Lecture PURE (aucune
   * alloc sur le chemin chaud, jamais throw) : agrège canaux + fan-out + connexions +
   * **backpressure** (`bufferedAmount`, risque #1). Appelé à la demande (endpoint HTTP)
   * ou par le ticker hub `nodefony:socket`. Les cumuls sont monotones → débit dérivé
   * côté lecteur. Cf {@link IRealtimeProbe}.
   */
  probe(): IRealtimeProbe {
    const channels: IRealtimeProbe["channels"] = [];
    if (this.#channels) {
      for (const [channel, st] of this.#channels) {
        channels.push({
          channel,
          subscribers: st.sinks.size,
          messages: st.messages,
        });
      }
    }
    let connectionCount = 0;
    let bytesSentTotal = 0;
    let messagesSentTotal = 0;
    let maxBufferedAmount = 0;
    let totalBufferedAmount = 0;
    let slowConsumers = 0;
    let drops = 0;
    if (this.#connections) {
      for (const c of this.#connections) {
        connectionCount += 1;
        bytesSentTotal += c.bytesSent;
        messagesSentTotal += c.messagesSent;
        drops += c.dropped;
        const buf = c.bufferedAmount;
        if (buf > maxBufferedAmount) maxBufferedAmount = buf;
        totalBufferedAmount += buf;
        if (buf >= this.#slowConsumerBytes) slowConsumers += 1;
      }
    }
    return {
      ts: Date.now(),
      channels,
      channelCount: channels.length,
      publishTotal: this.#publishTotal,
      fanoutTotal: this.#fanoutTotal,
      inboundTotal: this.#inboundTotal,
      ingressRejectedTotal: this.#ingressRejectedTotal,
      systemFloorDeniedTotal: this.#systemFloorDeniedTotal,
      connectionCount,
      bytesSentTotal,
      messagesSentTotal,
      backpressure: {
        maxBufferedAmount,
        totalBufferedAmount,
        slowConsumers,
        drops,
      },
      // Carte d'identité du backplane effectif. `null` (mono-process / fallback)
      // → descripteur `local` (driver loopback), sinon celui du driver branché.
      backplane: this.#backplane?.describe() ?? {
        driver: LoopbackBackplane.driver,
        kind: "local",
        originId: String(process.pid),
        crossPod: false,
      },
    };
  }

  /** Canaux actifs (≥ 1 abonné). Lecture seule. */
  get activeChannels(): string[] {
    return this.#channels ? [...this.#channels.keys()] : [];
  }

  // ─── Seams sécurité (P13 Bloc A étape 6 → P6) ─────────────────────────────

  /**
   * **Seam #2 (P13 → P6)** — enregistre un authenticator pour les handshakes
   * WS dont l'URL matche `matcher`. Ordre d'enregistrement préservé : le
   * **1ʳᵉ** matcher qui capture la connexion gagne. Convention : enregistrer
   * les patterns les plus spécifiques en premier.
   *
   * Idempotent par couple `(matcher, authenticator)` — appel multiple = même
   * effet (push si pas déjà présent). Cold-path (boot via P6/userland).
   *
   * @param matcher        sélecteur (pattern URL + vhost optionnel)
   * @param authenticator  stratégie d'auth réseau (handshake → IRealtimeToken)
   */
  useAuthenticator(
    matcher: IRealtimeAuthenticatorMatcher,
    authenticator: IRealtimeAuthenticator,
  ): void {
    const list = (this.#authenticators ??= []);
    const compiled = compileMatcher(matcher);
    // Dédup ref-identity (push idempotent quand P6 appelle au boot N fois).
    for (let i = 0; i < list.length; i++) {
      if (list[i]!.authenticator === authenticator) return;
    }
    list.push({ matcher: compiled, authenticator });
  }

  /**
   * Résout l'authenticator capturant ce handshake (1ʳᵉ matcher qui matche),
   * ou `null` si aucun (le RealtimeController posera un token anonyme).
   * Cold path (1× par upgrade) — lecture array.
   */
  resolveAuthenticator(
    handshake: IRealtimeHandshake,
  ): IRealtimeAuthenticator | null {
    const list = this.#authenticators;
    if (list === null) return null;
    for (let i = 0; i < list.length; i++) {
      const entry = list[i]!;
      if (entry.matcher.match(handshake)) return entry.authenticator;
    }
    return null;
  }

  /**
   * **Seam #4 (P13 → P6)** — pose la politique Origin (RFC 6455 §10.2).
   * `null` = aucune politique (toutes origines acceptées). Posée 1× par
   * `RealtimeService.init()` depuis `defineRealtimeConfig().csrf.checkOrigin`.
   */
  setOriginGuard(guard: OriginGuard | null): void {
    this.#originGuard = guard;
  }

  /**
   * Vérifie qu'une origin est autorisée (politique CSRF). `true` si aucune
   * politique posée (rétrocompat). Cold path (1× par upgrade).
   */
  checkOrigin(origin: string | undefined): boolean {
    return this.#originGuard === null ? true : this.#originGuard(origin);
  }

  /**
   * F6a (revue 0.6) — plafond de canaux par connexion (anti-OOM). Posé 1× au
   * boot par `RealtimeService.init()` depuis
   * `defineRealtimeConfig().limits.maxChannelsPerConnection`. `null` = illimité.
   */
  setMaxChannelsPerConnection(max: number | null): void {
    this.#maxChannelsPerConnection = max;
  }

  /** Plafond courant de canaux par connexion (`null` = illimité). Lu par `startChannel`. */
  get maxChannelsPerConnection(): number | null {
    return this.#maxChannelsPerConnection;
  }

  /**
   * F9 (revue 0.6) — pose le seuil de comptage des consommateurs lents (`probe()`).
   * Posé 1× au boot par `RealtimeService.init()` depuis
   * `defineRealtimeConfig().slowConsumer.bytes` (sinon la clé de config serait morte).
   */
  setSlowConsumerBytes(bytes: number): void {
    this.#slowConsumerBytes = bytes;
  }

  /**
   * Associe un token au peer (posé par `RealtimeController.onHandshake()` après
   * succès `authenticator.authenticate()` ou fallback anonyme). Lazy alloc de
   * la `WeakMap` au 1ᵉʳ appel (0 coût si aucun authenticator enregistré).
   */
  setTokenForPeer(peer: JsonRpcPeer, token: IRealtimeToken): void {
    (this.#peerTokens ??= new WeakMap<JsonRpcPeer, IRealtimeToken>()).set(
      peer,
      token,
    );
  }

  /**
   * Renvoie le token associé au peer, ou `ANONYMOUS_REALTIME_TOKEN` si aucun
   * (cas Zero Trust : la lecture ne renvoie JAMAIS `null` — slot #6 audit
   * lookup garanti, voters P6 ne se posent jamais la question « actor ? »).
   */
  getTokenForPeer(peer: JsonRpcPeer): IRealtimeToken {
    return this.#peerTokens?.get(peer) ?? ANONYMOUS_REALTIME_TOKEN;
  }

  /**
   * **Seam #1 (P13 → P6)** — pose le verrou de frame (cf {@link FrameAuthorizer}).
   * `null` retire la politique (bypass total). Posé 1× au boot par
   * `@nodefony/security` depuis les zones `realtime: true`. Cold path.
   */
  setFrameAuthorizer(
    authorizer: FrameAuthorizer | null,
    options?: { readonly silentProbe?: FrameAuthorizer | null },
  ): void {
    this.#frameAuthorizer = authorizer;
    // 🔴 Posée par le MÊME appel, volontairement : deux seams séparés se
    // dépareillent le jour où quelqu'un n'en pose qu'un — et la dégradation
    // serait MUETTE (le welcome recommencerait à tout annoncer, sans erreur).
    this.#channelProbe = options?.silentProbe ?? null;
  }

  /**
   * Un verrou de frame est-il posé ?
   *
   * Sert au DIAGNOSTIC (`hasUnenforcedChannelPolicies`, introspection, tests) —
   * **plus** à décider si on arme le verrou sur une connexion : le contrôleur
   * l'arme toujours, précisément pour qu'une politique posée après coup garde
   * les sockets déjà ouvertes.
   */
  hasFrameAuthorizer(): boolean {
    return this.#frameAuthorizer !== null;
  }

  /**
   * Branche l'alerte du plancher système — tirée **une seule fois**, au premier
   * canal de plateforme refusé faute de module de sécurité.
   *
   * Posée par le contrôleur : le hub est sans dépendance (aucun journal), et une
   * fermeture silencieuse serait exactement la dégradation muette qu'on cherche
   * à interdire.
   *
   * @param notify - reçoit le message à journaliser (niveau avertissement).
   */
  onPlatformNotice(
    notify: (message: string, severity: "WARNING" | "INFO") => void,
  ): void {
    this.#notice = notify;
  }

  /**
   * Émet un avertissement de plateforme, **une seule fois par motif**.
   *
   * @param key      - motif (clé de déduplication), pas le texte.
   * @param message  - ce que lira l'exploitant.
   * @param severity - niveau de journal.
   */
  #notifyOnce(
    key: string,
    message: string,
    severity: "WARNING" | "INFO" = "WARNING",
  ): void {
    if (this.#notice === null) return;
    const seen = (this.#noticed ??= new Set<string>());
    if (seen.has(key)) return;
    seen.add(key);
    this.#notice(message, severity);
  }

  /**
   * Ce canal serait-il fermé par le plancher système ? Lecture PURE (ni compteur,
   * ni alerte) — elle sert à expliquer un refus au client plutôt qu'à le décider.
   *
   * Sans elle, un abonnement refusé resterait sans réponse : le client attendrait
   * indéfiniment des données qui ne viendront pas, ce qui est exactement la
   * dégradation muette que ce plancher est censé faire disparaître.
   */
  isClosedBySystemFloor(channel: string): boolean {
    return this.#frameAuthorizer === null && isReservedSystemChannel(channel);
  }

  /**
   * F1 (revue 0.6) — des politiques de canal sont-elles DÉCLARÉES (`@RealtimeChannel`
   * avec `roles`/`scopes`/`authenticated`) sans `frameAuthorizer` pour les faire
   * respecter ? `true` = **dégradation silencieuse** : un canal se croit gardé mais
   * aucun décideur n'est câblé → un subscribe passe non gardé. Vrai uniquement sans
   * `@nodefony/security` (ou toutes les zones en `realtime: false`). Lu par le
   * RealtimeController pour émettre un WARNING au boot (fail-loud, jamais silencieux).
   */
  hasUnenforcedChannelPolicies(): boolean {
    return this.hasChannelPolicies() && this.#frameAuthorizer === null;
  }

  /**
   * **Seam #1b** — déclare la politique d'autorisation d'un canal/méthode
   * (`@RealtimeChannel`/`@RealtimeInbound` avec opts). Appelé au handshake par
   * le controller pour CHAQUE canal décoré (idempotent : même nom = écrase, les
   * controllers d'un même endpoint déclarent la même policy). Cold path.
   *
   * Deux formes de nom, et la seconde garde une FAMILLE :
   *
   * - un nom **exact** (`chat:room`) — lecture O(1) au `subscribe` ;
   * - un **motif** (`chat:room:*`) — il couvre tout canal dérivé servi par une
   *   fabrique dynamique (`chat:room:1000`), ce qu'un nom exact ne faisait pas.
   *   Le `*` remplace n'importe quelle suite de caractères ; tout le reste du
   *   motif est littéral (échappé), y compris `.` et `(`.
   *
   * Précédence : le nom **exact** l'emporte toujours — c'est ainsi qu'on ouvre
   * une exception dans une famille gardée. Entre deux motifs, le plus
   * **spécifique** gagne (littéral le plus long).
   *
   * @param name   - nom exact du canal (subscribe), de la méthode inbound, ou
   *   MOTIF de famille s'il contient `*`.
   * @param policy - exigences ({@link IChannelPolicy}) lues par security.
   */
  registerChannelPolicy(name: string, policy: IChannelPolicy): void {
    // Un canal déclaré dans un namespace réservé hérite du plancher de la
    // plateforme (rôle d'administration), qui l'emporte sur la politique écrite
    // ici. Sans cet avertissement, l'auteur verrait ses utilisateurs refusés sur
    // son propre canal sans comprendre d'où vient l'exigence.
    if (isReservedSystemChannel(name)) {
      this.#notifyOnce(
        "reserved-policy",
        `le canal "${name}" est déclaré dans un namespace RÉSERVÉ à la ` +
          `plateforme (${RESERVED_SYSTEM_PREFIXES.join(" ")}) : le plancher ` +
          `système s'y applique et exigera un rôle d'administration, quelle que ` +
          `soit la politique déclarée ici. Renommer le canal avec un préfixe ` +
          `applicatif si ce n'est pas voulu.`,
      );
    }
    // Un nom qui porte `*` est un MOTIF, pas un canal. Il garde une FAMILLE —
    // c'est la réponse au défaut que l'avertissement ci-dessous se contentait
    // de signaler : `chat:room` ne couvrait pas `chat:room:1000`, servi par la
    // fabrique dynamique, et l'auteur croyait son canal gardé.
    if (name.includes("*")) {
      this.#registerChannelPolicyPattern(name, policy);
      return;
    }
    (this.#channelPolicies ??= new Map<string, IChannelPolicy>()).set(
      name,
      policy,
    );
  }

  /**
   * Nombre maximum de `*` dans un motif.
   *
   * Ce n'est pas une limite de confort : chaque `*` devient un `.*` dans
   * l'expression compilée, et plusieurs `.*` sur une chaîne qui NE matche pas
   * font revenir le moteur sur ses pas — un coût qui explose avec leur nombre.
   * Un motif de canal en demande un, deux au pire ; au-delà, c'est une erreur
   * de déclaration, et on le DIT plutôt que d'exposer un chemin coûteux à ce
   * qu'un client peut nommer.
   */
  static readonly MAX_PATTERN_WILDCARDS = 3;

  /**
   * Compile un motif et l'insère à son rang de spécificité.
   *
   * Le motif est ÉCHAPPÉ intégralement avant que `*` ne devienne `.*` : rien de
   * ce que l'auteur écrit n'est interprété comme une expression régulière. Un
   * `.` reste un point, un `(` reste une parenthèse — sans quoi une déclaration
   * anodine deviendrait une expression, avec ce que cela ouvre.
   */
  #registerChannelPolicyPattern(source: string, policy: IChannelPolicy): void {
    const etoiles = source.split("*").length - 1;
    if (etoiles > RealtimeHub.MAX_PATTERN_WILDCARDS) {
      this.#notifyOnce(
        `pattern-too-broad:${source}`,
        `le motif de politique "${source}" porte ${etoiles} caractères « * » ` +
          `(maximum ${RealtimeHub.MAX_PATTERN_WILDCARDS}) : il est IGNORÉ. Un ` +
          `motif de canal en demande un, deux au pire — au-delà, la mise en ` +
          `correspondance coûte cher sur des noms que le client choisit.`,
      );
      return;
    }
    const echappe = source.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const re = new RegExp(`^${echappe.split("\\*").join(".*")}$`, "u");
    // Poids = longueur du LITTÉRAL, `*` retirés. Entre `chat:*` (5) et
    // `chat:room:*` (10), le second gagne : il en dit plus.
    const poids = source.split("*").join("").length;
    const liste = (this.#channelPolicyPatterns ??= []);
    const deja = liste.findIndex((p) => p.source === source);
    const entree = { source, re, poids, policy };
    if (deja >= 0) {
      // Idempotent, comme la voie exacte : deux controllers d'un même endpoint
      // déclarent le même motif.
      liste[deja] = entree;
      return;
    }
    const rang = liste.findIndex((p) => p.poids < poids);
    if (rang < 0) liste.push(entree);
    else liste.splice(rang, 0, entree);
  }

  /**
   * Politique déclarée pour ce canal/méthode, ou `null` si aucune. Lu par
   * `@nodefony/security` (`resolveChannelPolicy` de la surface DI) au moment de
   * la frame `subscribe`/inbound. O(1), 0 alloc quand le registre est vide.
   */
  resolveChannelPolicy(name: string): IChannelPolicy | null {
    const exact = this.#channelPolicies?.get(name);
    if (exact !== undefined) return exact;
    // Les motifs ne coûtent QUE s'il en existe : une application qui n'en
    // déclare aucun sort ici sans avoir rien parcouru. La liste est déjà triée
    // du plus spécifique au plus général — le premier qui matche est le bon.
    const motifs = this.#channelPolicyPatterns;
    if (motifs === null) return null;
    for (let i = 0; i < motifs.length; i++) {
      if (motifs[i]!.re.test(name)) return motifs[i]!.policy;
    }
    return null;
  }

  /** Des politiques de canal sont-elles déclarées (au moins une) ? */
  hasChannelPolicies(): boolean {
    return (
      (this.#channelPolicies?.size ?? 0) > 0 ||
      (this.#channelPolicyPatterns?.length ?? 0) > 0
    );
  }

  /**
   * Avertit — **une seule fois** — qu'un canal servi par une fabrique
   * DYNAMIQUE n'est couvert par aucune politique déclarée, alors que d'autres
   * canaux du module en portent une.
   *
   * Le registre des politiques est indexé par nom **EXACT** : `@RealtimeChannel`
   * déclare `"chat:room"`, mais un canal dérivé (`chat:room:1000` — cadence,
   * forage, suffixe) est servi par la fabrique dynamique et **ne matche pas**.
   * L'auteur croit alors son canal gardé ; il ne l'est pas, et rien ne le lui
   * dit. C'est ce silence qu'on ferme ici — et depuis qu'une politique peut se
   * déclarer par MOTIF (`chat:room:*`), cet avertissement ne parle plus que des
   * canaux qu'aucun motif ne couvre : il désigne un vrai trou, pas une limite
   * de l'outil.
   *
   * Appelé par le contrôleur, seul à savoir par quelle voie le canal a été
   * servi. Muet si aucune politique n'est déclarée (module aux canaux libres :
   * il n'y a alors aucune promesse à trahir).
   *
   * @param channel - le canal servi dynamiquement, cité en exemple dans l'alerte.
   */
  noticeUnguardedDynamicChannel(channel: string): void {
    if (!this.hasChannelPolicies()) return;
    if (this.resolveChannelPolicy(channel) !== null) return;
    this.#notifyOnce(
      "unguarded-dynamic-channel",
      `le canal "${channel}" est servi par une fabrique DYNAMIQUE et n'est ` +
        `couvert par AUCUNE politique déclarée, alors que ce module en déclare ` +
        `pour d'autres canaux. Un canal dérivé (suffixe de cadence, forage, ` +
        `identifiant) n'hérite pas de la politique de son parent : un nom ` +
        `exact ne garde que lui-même. Déclarer un MOTIF pour garder la famille ` +
        `— @RealtimeChannel("${channel.replace(/[^:]*$/u, "*")}", { … }) — ou ` +
        `porter la vérification dans la fabrique elle-même.`,
    );
  }

  /**
   * Enregistre la **factory d'un canal système** (plateforme) — un module bas
   * niveau (ex. `@nodefony/security` : `nodefony:audit`) déclare au boot comment
   * produire le provider d'un canal, SANS qu'aucun `RealtimeController` ne le
   * connaisse. `subscribe` consulte ce registre quand la factory du controller
   * renvoie `null` → le canal devient servable par TOUT endpoint (présent/futur),
   * zéro couplage à Studio. La factory garde la sémantique lazy du hub (créée au
   * 1ᵉʳ abonné, `dispose` au dernier).
   *
   * @param channel - nom EXACT du canal système (match exact, pas un préfixe).
   * @param factory - {@link ChannelFactory} qui crée le provider partagé.
   */
  registerSystemChannel(channel: string, factory: ChannelFactory): void {
    (this.#systemChannelFactories ??= new Map<string, ChannelFactory>()).set(
      channel,
      factory,
    );
  }

  /**
   * Pont hot-path entre `JsonRpcPeer.beforeDispatch` et le verrou métier : lit
   * le token déjà caché du peer (O(1), 0 lecture base) puis délègue à
   * l'authorizer. `true` (autorisée) si aucun verrou posé (bypass 0-coût) —
   * mais en pratique `beforeDispatch` n'est branché que si `hasFrameAuthorizer()`.
   *
   * @param frame - frame JSON-RPC entrante (brute) à autoriser.
   * @param peer  - peer émetteur (clé du mapping `peer → token`).
   * @returns `true` si la frame peut être dispatchée, `false` si refusée.
   */
  /**
   * Ouvre (ou referme) la réception des journaux du navigateur, avec ses bornes.
   *
   * @param limits - bornes de débit et de taille, ou `null` pour refermer le canal.
   */
  setClientLogsLimits(limits: IClientLogsLimits | null): void {
    this.#clientLogs = limits;
  }

  /** Bornes en vigueur, ou `null` si le canal montant est fermé. */
  get clientLogsLimits(): IClientLogsLimits | null {
    return this.#clientLogs;
  }

  runAuthorizer(frame: unknown, peer: JsonRpcPeer): boolean {
    if (this.#frameAuthorizer === null) return true;
    return this.#frameAuthorizer(frame, this.getTokenForPeer(peer));
  }

  /**
   * Ce peer pourrait-il s'abonner à ce canal ? — même décision que `subscribe`,
   * sans trace ni effet de bord.
   *
   * Rend `true` quand aucune sonde n'est posée : sans sécurité chargée, aucun
   * canal n'est refusé, et l'absence de sonde ne doit jamais faire DISPARAÎTRE
   * des canaux d'un welcome. Un filtre qui échoue doit échouer ouvert ici —
   * c'est le verrou, pas l'annonce, qui protège l'accès.
   *
   * @param channel - le canal interrogé.
   * @param peer - la connexion, d'où l'on tire le jeton résolu au handshake.
   * @returns `true` si un `subscribe` sur ce canal serait accepté.
   */
  probeChannel(channel: string, peer: JsonRpcPeer): boolean {
    if (this.#channelProbe === null) return true;
    // La frame que `subscribe` produirait — la sonde et le verrou lisent donc
    // exactement la même forme, et aucune règle n'est réécrite ici.
    return this.#channelProbe(
      { method: "subscribe", params: { channel } },
      this.getTokenForPeer(peer),
    );
  }

  /** Authenticators enregistrés (debug / tests). Lecture seule. */
  get registeredAuthenticators(): ReadonlyArray<IRealtimeAuthenticator> {
    if (this.#authenticators === null) return EMPTY_AUTH_LIST;
    return this.#authenticators.map((e) => e.authenticator);
  }

  /** Dispose tous les providers et vide le hub (arrêt process / reset de test). */
  clear(): void {
    if (this.#channels) {
      for (const st of this.#channels.values()) {
        try {
          st.dispose?.();
        } catch {
          /* noop */
        }
      }
      this.#channels.clear();
      this.#channels = null;
    }
    this.#connections?.clear();
    this.#connections = null;
    this.#broadcastPrefixes = null;
    this.#authenticators = null;
    this.#peerTokens = null;
    this.#frameAuthorizer = null;
    this.#channelPolicies?.clear();
    this.#channelPolicies = null;
    this.#channelPolicyPatterns = null;
    this.#originGuard = null;
    // Détache le backplane (reset). On ne `stop()` PAS ici : le hub n'en est pas
    // l'owner (créé/détruit par le module qui l'a branché) — il le libère lui-même.
    this.#backplane = null;
    this.#publishTotal = 0;
    this.#fanoutTotal = 0;
    this.#inboundTotal = 0;
    this.#ingressRejectedTotal = 0;
    this.#systemFloorDeniedTotal = 0;
    // Les avertissements de plateforme aussi : sans ce reset, un motif déjà émis
    // reste marqué « vu » pour le process entier. Un test qui vérifie une alerte
    // passe alors seul et échoue en suite — et surtout, un hub réinitialisé se
    // tairait sur une configuration qu'il devrait redénoncer.
    this.#noticed = null;
    this.#notice = null;
  }
}

// Constante partagée pour `registeredAuthenticators` quand aucun n'est posé
// (évite d'allouer un Array vide à chaque lecture du getter en mode "secure off").
const EMPTY_AUTH_LIST: ReadonlyArray<IRealtimeAuthenticator> = Object.freeze(
  [],
);

/**
 * Compile un matcher utilisateur en forme efficace (RegExp précompilée + host
 * lowercase). Cold path (1× par `useAuthenticator`).
 *
 * - `pattern` RegExp : utilisée telle quelle (l'utilisateur sait ce qu'il fait).
 * - `pattern` string : compilée en RegExp **préfixe** ancrée (`^<escaped>`).
 *   Compromis sûr : `"/admin/"` matche `/admin/` ET `/admin/foo` SANS escape
 *   à la main (90 % des cas userland), tout en restant déterministe pour les
 *   tests.
 */
function compileMatcher(
  m: IRealtimeAuthenticatorMatcher,
): ICompiledRealtimeMatcher {
  const pattern =
    m.pattern instanceof RegExp
      ? m.pattern
      : // `RegExp.escape` (Node 24) échappe les méta-caractères → match littéral
        // préfixe ancré, sans helper maison (RFC : escape déterministe + sûr).
        new RegExp("^" + RegExp.escape(m.pattern));
  const host = m.host?.toLowerCase();
  return {
    pattern,
    host,
    match(handshake): boolean {
      if (host !== undefined) {
        // Le host est dans l'en-tête `host:` (RFC 7230 §5.4) — déjà lowercasé
        // côté http natif Node.js. Comparaison stricte (vhost exact, pas de wildcard).
        const raw = handshake.headers["host"];
        const got = Array.isArray(raw) ? raw[0] : raw;
        if ((got ?? "").toLowerCase() !== host) return false;
      }
      // Path sans query string (split sur "?", index 0).
      const qi = handshake.url.indexOf("?");
      const path = qi === -1 ? handshake.url : handshake.url.slice(0, qi);
      return pattern.test(path);
    },
  };
}

// Hub partagé du process (1 pod = 1 hub). Lazy : pas d'instance tant qu'inutilisé.
let _hub: RealtimeHub | null = null;

/** Renvoie le hub realtime du process (singleton lazy). */
export function getRealtimeHub(): RealtimeHub {
  return (_hub ??= new RealtimeHub());
}

export default RealtimeHub;

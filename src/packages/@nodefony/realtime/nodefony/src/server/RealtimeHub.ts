import {
  IDENTITY_DEAD_CLOSE_CODE,
  IDENTITY_REFRESH_CLOSE_CODE,
  TOKEN_EXPIRED_CLOSE_CODE,
  JsonRpcPeer,
  NODEFONY_CHANNEL_NAMESPACE,
  PLATFORM_BUS_CHANNELS,
  RevocationWatch,
  isPlatformChannel,
  isRealtimePayload,
  realtimePayloadError,
  compileChannelPattern,
  countWildcards,
  MAX_CHANNEL_PATTERN_WILDCARDS,
  BootConfigurationError,
  USER_CHANNEL_PREFIX,
  userChannel,
  frameCodecSet,
  containsBytes,
  type IFrameCodec,
  type IFrameCodecSet,
  type RealtimeFrameData,
} from "nodefony";
import { RealtimeConnection } from "./RealtimeConnection";
import type { IRealtimeConnection } from "../../interfaces/IRealtimeConnection";
import type {
  IChannelAdmission,
  IChannelPolicies,
  UserChannelPayload,
} from "nodefony";
import { AdmissionBudget, type IAdmissionLimits } from "./admissionBudget";
import type { IChannelAdmissionRule } from "./connectionAdmission";
import { dropRetainedVerdicts } from "./frameAdmission";
import type { IRealtimeConnectionState } from "../../interfaces/IRealtimeConnectionState";
import { DEFAULT_ACTION_POLICY } from "../../decorators/realtimeDecorators";
import {
  USER_CHANNEL_DECLARATION,
  declarationOf,
  policyDeclarationsDefect,
  resolveDeclaredPolicies,
  type IChannelPolicyEntry,
  type IPatternDeclaration,
  type IPolicyDeclaration,
} from "./channelPolicyResolution";
import { frameRateRejectedTotal } from "@nodefony/http";
import type {
  ContractServerEmit,
  EventNames,
  EventPayload,
  IRealtimeContract,
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
  IBackplaneInfo,
  IBackplaneMessage,
} from "../../interfaces/IBackplane";
import LoopbackBackplane from "../backplane/LoopbackBackplane";
import { readControlOrder, type ControlOrder } from "../backplane/controlOrder";
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
 *
 * `judgesWrite` : le verrou sait juger une politique d'ÉCRITURE distincte de la
 * lecture (ADR-0022 §6, décision 1 quater). Un verrou qui ne le déclare pas ne
 * lirait que la lecture, et laisserait ouverte une écriture plus stricte : le
 * hub refuse alors de démarrer dès qu'une telle écriture est déclarée.
 *
 * `explain` : la phrase qui dit POURQUOI une trame a été refusée, quand le
 * verrou sait la rédiger (`null` sinon). Lu après un refus seulement
 * ({@link RealtimeHub.explainDenial}) — jamais sur le trajet d'une trame
 * acceptée. Elle va au journal du serveur, et au client hors production.
 */
export type FrameAuthorizer = ((
  frame: unknown,
  token: IRealtimeToken,
) => boolean) & {
  readonly judgesWrite?: true;
  readonly explain?: (frame: unknown, token: IRealtimeToken) => string | null;
};

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
 * Période de re-validation des identités RÉVOCABLES — F4 (revue 0.6). Le verrou
 * de frame est SYNC (identité figée au handshake) : ce tick ferme l'écart avec
 * `api.request`, qui re-valide par requête. Définie par le cœur, qui porte le
 * registre partagé avec les flux SSE ; ré-exportée ici pour les consommateurs
 * du hub.
 */
export { REVOCATION_REVALIDATE_MS } from "nodefony";

/**
 * Le MOTIF de famille d'un canal — son dernier segment remplacé par `*`.
 *
 * `"studio:metrics:1s"` → `"studio:metrics:*"`, `"alerts"` → `"*"`. Sert à
 * SUGGÉRER une politique qui garde toute une famille, quand un canal dérivé
 * n'est couvert par aucune.
 *
 * Sans expression régulière, et c'est délibéré : `/[^:]*$/` sur un nom de canal
 * venu de l'extérieur se replie à chaque position d'échec, coût quadratique sur
 * une entrée que le module ne choisit pas. Chercher le dernier séparateur est
 * linéaire, et dit plus clairement ce qu'on fait.
 *
 * @param channel - le nom complet du canal
 * @returns le motif couvrant sa famille
 */
export function channelFamily(channel: string): string {
  const i = channel.lastIndexOf(":");
  return i === -1 ? "*" : `${channel.slice(0, i + 1)}*`;
}

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
 * `frame` n'est fourni que si le canal a déclaré un {@link ChannelFrameBuilder} ET
 * qu'il a plusieurs abonnés : la frame est la MÊME pour tous, le sink en demande
 * l'encodage pour le codec de SA connexion ({@link ChannelFrame.encodeFor}) au lieu
 * de refaire le travail. Absent, le sink se débrouille comme avant — un sink à un
 * seul paramètre ignore simplement l'argument.
 */
export type ChannelSink = (payload: unknown, frame?: ChannelFrame) => void;

/**
 * Fabrique la frame protocolaire d'un canal (l'objet, pas ses octets), fournie par
 * l'abonné : le hub ignore tout du protocole. Appelée **au plus une fois par
 * publication**, jamais par abonné ; l'encodage, lui, se fait une fois par codec.
 */
export type ChannelFrameBuilder = (payload: unknown) => unknown;

/**
 * Frame d'UNE publication diffusée à plusieurs abonnés, encodée **au plus une fois
 * par codec** (ADR-0022 §2) : un canal suivi par des connexions texte et CBOR paie
 * deux encodages, jamais un par connexion. L'encodage est paresseux — un codec
 * qu'aucun abonné n'utilise ne coûte rien.
 *
 * Deux places suffisent : un hub sert au plus son codec texte et son codec
 * binaire. Un troisième codec reste servi, sans mise en cache.
 */
export class ChannelFrame {
  // Champs ordinaires, tous posés au constructeur (forme d'objet stable) :
  // objet alloué à CHAQUE publication diffusée, lu par CHAQUE abonné.
  private readonly message: unknown;
  private codecA: IFrameCodec | null;
  private dataA: RealtimeFrameData | undefined;
  private codecB: IFrameCodec | null;
  private dataB: RealtimeFrameData | undefined;
  // Échec d'encodage déjà RÉCLAMÉ par un abonné, par place (cf claimFailure).
  private claimedA: boolean;
  private claimedB: boolean;

  /** @param message - la frame protocolaire, telle que rendue par le {@link ChannelFrameBuilder}. */
  constructor(message: unknown) {
    this.message = message;
    this.codecA = null;
    this.dataA = undefined;
    this.codecB = null;
    this.dataB = undefined;
    this.claimedA = false;
    this.claimedB = false;
  }

  /**
   * Rend la frame encodée pour un codec, en l'encodant à la première demande.
   *
   * @param codec - le codec de la connexion qui va l'écrire.
   * @returns la trame à écrire telle quelle, ou `undefined` si la frame n'est pas
   *   encodable : l'abonné qui en {@link ChannelFrame.claimFailure | réclame}
   *   l'échec reprend son chemin habituel, qui porte le filet (journal).
   */
  encodeFor(codec: IFrameCodec): RealtimeFrameData | undefined {
    if (codec === this.codecA) return this.dataA;
    if (codec === this.codecB) return this.dataB;
    let data: RealtimeFrameData | undefined;
    try {
      data = codec.encode(this.message);
    } catch {
      data = undefined; // échec retenu : pas de nouvel essai par abonné
    }
    if (this.codecA === null) {
      this.codecA = codec;
      this.dataA = data;
    } else if (this.codecB === null) {
      this.codecB = codec;
      this.dataB = data;
    }
    return data;
  }

  /**
   * Réclame l'échec d'encodage de cette frame pour un codec : `true` au PREMIER
   * abonné qui le demande, `false` ensuite.
   *
   * Un seul abonné reprend alors son chemin habituel, dont le filet journalise
   * l'échec ; les autres sautent la trame, qu'ils ne pourraient pas encoder non
   * plus. Sans cela, une charge non encodable — un `$bytes` forgé par un client,
   * une valeur cyclique — coûtait un encodage et une ligne de journal PAR abonné.
   * Un codec hors des deux places réclame à chaque fois : il n'est pas retenu.
   *
   * @param codec - le codec dont {@link ChannelFrame.encodeFor} a rendu `undefined`.
   * @returns `true` si l'appelant doit dire l'échec.
   */
  claimFailure(codec: IFrameCodec): boolean {
    if (codec === this.codecA) {
      if (this.claimedA) return false;
      this.claimedA = true;
      return true;
    }
    if (codec === this.codecB) {
      if (this.claimedB) return false;
      this.claimedB = true;
      return true;
    }
    return true;
  }
}

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
   * Connexion de chaque sink abonné par un CLIENT (`subscribeClient` avec sa
   * poignée) — ce qui rend un membre identifiable : le lister, l'éjecter, fermer
   * le canal pour lui. Les écouteurs et services du serveur n'y figurent pas.
   * `null` tant qu'aucun client n'est inscrit ; alloué au `subscribe` (chemin
   * froid), jamais lu par le fan-out.
   */
  members: Map<ChannelSink, RealtimeConnection> | null;
  /**
   * Fabrique de frame du canal, posée par le 1ᵉʳ abonné qui en fournit une.
   * `null` = canal sans mutualisation possible (sink historique) → chemin d'avant.
   */
  buildFrame: ChannelFrameBuilder | null;
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
 * Qui a déclaré une sorte de politique sous un nom, et laquelle — retenu au démarrage pour refuser deux classes en désaccord sur un même nom.
 */
export interface IChannelPolicyClaim {
  /** Constructeur du contrôleur qui a déclaré le premier. */
  readonly owner: object;
  /** Son nom, pour le message de refus. */
  readonly ownerName: string;
  /** La politique déclarée. */
  readonly policy: IChannelPolicy;
}

/**
 * Fabrique intégrée du canal personnel : il n'a pas de source, seul `publish`
 * l'alimente. Partagée par tous les canaux `user:` — aucune allocation par canal.
 */
const USER_CHANNEL_DISPOSE = (): void => {};

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
 * directement. Même rôle que `NodefonySocket` côté navigateur.
 */
export class RealtimeHub {
  // Lazy : alloué au 1ᵉʳ subscribe (un process sans abonné n'alloue rien).
  #channels: Map<string, ChannelState> | null = null;

  // Compteurs d'auto-observabilité (sonde socket). Primitives → 0 alloc, incrément
  // O(1) sur le chemin `publish` (pas de syscall/stringify). Cumuls MONOTONES → le
  // débit/s se dérive côté lecteur. Cf {@link probe}.
  #publishTotal = 0;
  #fanoutTotal = 0;
  // Part des connexions FERMÉES dans les cumuls par connexion de la sonde : sans
  // elle, `bytesSentTotal`, `drops` ou `malformedDiscardedTotal` redescendraient
  // à chaque fermeture — un débit dérivé négatif, et un refus qui disparaît avec la
  // connexion fautive. Versée une fois, à la sortie du registre (jamais par frame).
  #closedBytesSent = 0;
  #closedMessagesSent = 0;
  #closedDropped = 0;
  #closedBinaryDiscarded = 0;
  #closedMalformedDiscarded = 0;
  #inboundTotal = 0;

  // Messages d'ingress backplane REFUSÉS par le contrôle d'admission (F83) : canal
  // non déclaré broadcast. Cumul monotone — un compteur qui décolle signale soit un
  // pair mal configuré, soit une écriture tierce dans le bus partagé. C'est le
  // « fail-loud » de cette porte : le hub est sans dépendance (aucun logger), la
  // sonde est son unique canal de signalement. Cf {@link #admitFromBackplane}.
  #ingressRejectedTotal = 0;

  // Publications restées sur ce serveur ALORS qu'un bus est branché (canal non
  // déclaré diffusable) — monotone. Jamais compté sans bus : la question ne se
  // pose pas. Un `++` sur un chemin déjà froid (le forward vient d'être refusé).
  #localOnlyTotal = 0;

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
  // F4 (revue 0.6). Ensemble et minuteur naissent au 1ᵉʳ inscrit et meurent quand
  // il se vide (0 coût au repos) ; anonyme et JWT sans revalidation n'y entrent
  // JAMAIS. Même implémentation que les flux SSE (`RevocationWatch`).
  readonly #revocation = new RevocationWatch<IRevocableConnection>({
    isValid: (entry) => entry.token.isValid?.(),
    // La cause, quand le jeton la connaît : un jeton porteur arrivé à `exp` ferme
    // en 4006 (un jeton neuf suffirait), tout le reste en 4001 (ADR-0021 §S11).
    status: (entry) => entry.token.status?.(),
    revoke: (entry, status) =>
      status === "expired"
        ? entry.close(TOKEN_EXPIRED_CLOSE_CODE, "token expired")
        : entry.close(IDENTITY_DEAD_CLOSE_CODE, "session revoked"),
    identityOf: (entry) => entry.token.getUserIdentifier(),
    // Droits changés, identité vivante : code RECONNECTABLE — le client revient
    // aussitôt avec son identité à jour (4001 l'arrêterait).
    refresh: (entry) =>
      entry.close(IDENTITY_REFRESH_CLOSE_CODE, "identity changed"),
  });

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
  // Connexions qui ont retenu au moins un « oui » du verrou (ADR-0022 §6,
  // décision 1 ter). Lazy ; jamais lu par trame — seulement quand le verrou ou
  // une politique change, pour vider ces verdicts une fois. Aucun compteur de
  // version comparé à chaque trame.
  #retainers: Set<IRealtimeConnectionState> | null = null;

  // Seam #1b — registre des politiques de canal DÉCLARÉES (`@RealtimeChannel`/
  // `@RealtimeInbound` avec opts), indexé par nom de canal/méthode. Le hub ne
  // DÉCIDE rien (il ignore la hiérarchie de rôles et l'identité réelle) : il
  // collecte la déclaration et l'expose à `@nodefony/security`, seul décideur.
  // Lazy : `null` tant qu'aucun controller décoré ne publie de policy → 0 alloc
  // sur un hub aux canaux libres. Alimenté au démarrage du noyau (contrôleurs
  // connus), et à la première poignée de main d'une classe qui y aurait échappé.
  // Vue FUSIONNÉE de chaque nom exact déclaré (lecture et écriture résolues, motifs
  // compris), recalculée à chaque inscription : une trame n'y paie qu'un `get`.
  #channelPolicies: Map<string, IChannelPolicyEntry> | null = null;
  // Ce que chaque nom exact DÉCLARE, par sorte — la source de la vue ci-dessus.
  #policyDeclarations: Map<string, IPolicyDeclaration> | null = null;

  /**
   * Classes de contrôleur dont les politiques sont déjà inscrites — `null`
   * tant qu'aucune ne l'est. Une poignée de main n'en paie qu'un `has` :
   * l'inscription elle-même n'a lieu qu'une fois par classe.
   */
  #policyOwners: WeakSet<object> | null = null;
  // Première classe à déclarer chaque nom, et ce qu'elle a déclaré — lu au
  // démarrage seulement (`claimChannelPolicy`). `null` tant qu'aucune classe
  // décorée n'a inscrit de politique.
  #policyClaims: Map<string, IChannelPolicyClaim> | null = null;

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
  #channelPolicyPatterns: IPatternDeclaration[] | null = null;

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
  // Codecs de frame (ADR-0022 §2) : texte seul tant que la config n'active rien.
  #frameCodecs: IFrameCodecSet = frameCodecSet();
  // Le bus porte-t-il les octets intacts ? Vrai quand un codec binaire est posé ET
  // que le backplane l'a accepté (`IBackplane.enableBytes`, ADR-0021 S6).
  #busBytes = false;

  /**
   * Budget des admissions de l'exemplaire (appels d'`allow` en vol, coupe-circuit,
   * `allowTimedOutTotal`/`allowSaturatedTotal`) — partagé par les files de toutes
   * les connexions. Bornes posées par {@link setAdmissionLimits} au boot.
   */
  readonly admissionBudget = new AdmissionBudget();

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
   * @param member - la connexion qui s'abonne : inscrite au registre du canal,
   *   elle devient un membre identifiable ({@link channelMembers}).
   * @returns `true` si abonné, `false` si canal inconnu ou fermé par le plancher.
   */
  subscribeClient(
    channel: string,
    sink: ChannelSink,
    factory: ChannelFactory,
    buildFrame?: ChannelFrameBuilder,
    member?: RealtimeConnection,
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
    if (!this.subscribe(channel, sink, factory, buildFrame)) return false;
    if (member !== undefined) {
      // Inscrit APRÈS l'abonnement réussi : un refus ne laisse aucune entrée.
      // `st` existe : `subscribe` vient de rendre `true` pour ce canal.
      const st = this.#channels?.get(channel);
      if (st !== undefined)
        (st.members ??= new Map<ChannelSink, RealtimeConnection>()).set(
          sink,
          member,
        );
    }
    return true;
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
    buildFrame?: ChannelFrameBuilder,
  ): boolean {
    const channels = (this.#channels ??= new Map<string, ChannelState>());
    let st = channels.get(channel);
    if (st) {
      if (st.owned) {
        st.sinks.add(sink);
        // Canal déjà ouvert par un abonné sans fabrique de frame : le premier
        // qui en apporte une ouvre la mutualisation pour les suivants.
        if (st.buildFrame === null && buildFrame !== undefined) {
          st.buildFrame = buildFrame;
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
      if (buildFrame !== undefined) st.buildFrame = buildFrame;
      return true;
    }
    // 1ᵉʳ abonné : on inscrit le sink AVANT de créer le provider (capte son 1ᵉʳ push).
    // `forward` résolu UNE fois ici (cold path) puis lu en O(1) sur `publish`.
    st = {
      dispose: null,
      owned: false,
      sinks: new Set([sink]),
      members: null,
      buildFrame: buildFrame ?? null,
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
      members: null,
      buildFrame: null,
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
    const publishFn = (ch: string, payload?: object): void =>
      this.publish(ch, payload);
    const dispose = factory(channel, publishFn);
    if (dispose !== null) return dispose;
    // Inconnu du controller → dernier recours : factory de canal SYSTÈME
    // (plateforme) enregistrée par un module bas niveau (nodefony:audit…).
    const sys = this.#systemChannelFactories?.get(channel);
    if (sys) return sys(channel, publishFn);
    // Canal personnel : fabrique intégrée, sans source. Une demande venue du
    // réseau n'arrive ici qu'après le verrou et la règle d'admission, qui ont
    // déjà dit « c'est le tien » ; un service du serveur, lui, peut l'écouter.
    return channel.startsWith(USER_CHANNEL_PREFIX)
      ? USER_CHANNEL_DISPOSE
      : null;
  }

  /**
   * Désabonne une connexion d'un canal. Au **dernier** abonné, `dispose()` le provider
   * et retire le canal (libère timers/listeners). No-op si non abonné.
   */
  unsubscribe(channel: string, sink: ChannelSink): void {
    const channels = this.#channels;
    const st = channels?.get(channel);
    if (!channels || !st) return;
    st.sinks.delete(sink);
    st.members?.delete(sink);
    if (st.sinks.size === 0) {
      try {
        st.dispose?.();
      } catch {
        /* noop — un provider fautif ne bloque pas le nettoyage */
      }
      channels.delete(channel);
    }
  }

  /**
   * Les connexions abonnées à un canal par un client — **local à ce pod** : les membres servis par un autre exemplaire n'y figurent pas.
   *
   * Les écouteurs et services du serveur (`listen`, `subscribe`) ne sont pas
   * des membres. Chemin froid : une copie à chaque appel.
   *
   * @param channel - nom exact du canal.
   * @returns les membres de ce pod, vide si le canal n'en a aucun ici.
   */
  channelMembers(channel: string): IRealtimeConnection[] {
    const members = this.#channels?.get(channel)?.members;
    return members == null ? [] : Array.from(members.values());
  }

  /**
   * Abonne d'office une connexion à un canal — **local à ce pod** : seule une connexion acceptée par ce processus peut l'être.
   *
   * Même porte qu'un `subscribe` du client (ADR-0022 §6 décision 2) : la
   * politique fixe du canal (rôles, scopes, plancher de plateforme), puis sa
   * règle `allow` s'il en déclare une. Un refus n'abonne pas, et seul
   * l'appelant l'apprend ; jamais un abonnement qui contourne `allow` — le
   * client rejoue ses abonnements à chaque reconnexion, et ce rejeu passe par
   * `allow` : l'application écrit donc l'appartenance là où `allow` la lit.
   *
   * Le client est notifié par `realtime:subscribed { channel, imposed: true }`
   * et inscrit le canal dans ses abonnements ; il peut le quitter.
   *
   * Plusieurs exemplaires : la requête qui décide doit atteindre le processus
   * qui tient la socket — la passer par la socket elle-même (`@RealtimeInbound`,
   * qui reçoit la connexion), ou faire autoriser l'entrée par `allow` (registre
   * partagé) et laisser le navigateur s'abonner.
   *
   * @param channel - nom exact du canal.
   * @param connection - la connexion à abonner (reçue par un gestionnaire `@RealtimeInbound`, ou lue dans {@link channelMembers}).
   * @returns `true` une fois l'abonnement acquitté ; `false` si refusé, si la
   *   connexion est fermée ou inconnue de ce processus, ou si le client s'en
   *   désabonne avant le verdict.
   */
  subscribeConnection(
    channel: string,
    connection: IRealtimeConnection,
  ): Promise<boolean> {
    if (!(connection instanceof RealtimeConnection))
      return Promise.resolve(false);
    return connection.impose(channel);
  }

  /**
   * Retire une connexion d'un canal — **local à ce pod** ; elle reçoit `realtime:closed { reason: "evicted" }`.
   *
   * ⚠️ **Éjecter coupe la connexion du canal, seul `allow` exclut**
   * (ADR-0022 §6 décision 3). Le client ne rejoue pas un canal dont il a été
   * éjecté, mais c'est une politesse : une page rechargée refait `subscribe`.
   * Sur un canal à `allow`, l'éjecté revient si l'application n'a pas retiré
   * l'appartenance là où `allow` la lit ; sur un canal sans `allow`, sa
   * politique fixe le laisse rentrer.
   *
   * @param channel - nom exact du canal.
   * @param connection - la connexion à retirer.
   * @returns `false` si la connexion n'est pas membre du canal, est fermée, ou
   *   inconnue de ce processus — jamais un geste muet.
   */
  evictConnection(channel: string, connection: IRealtimeConnection): boolean {
    return (
      connection instanceof RealtimeConnection &&
      connection.end(channel, "evicted")
    );
  }

  /**
   * Termine un canal pour tous ses membres, **sur tous les serveurs** : chacun reçoit `realtime:closed { reason: "ended" }`, et le producteur est libéré.
   *
   * **Traverse les pods** : avec un backplane branché, l'ordre part sur le bus
   * (`PLATFORM_BUS_CHANNELS.control`, scellé comme toute publication) et chaque
   * serveur l'applique à SES membres. Livraison « au plus une fois » du bus :
   * un pod qui manque l'ordre, ou qui démarre après, est rattrapé par la
   * fabrique, qui rend `null` pour une instance terminée. Un canal de la
   * plateforme (`nodefony:`) reste local — il décrit un pod, pas une partie.
   *
   * Les écouteurs du serveur (`listen`) restent inscrits, sur un canal redevenu
   * PASSIF : le prochain `subscribe` d'un client rejoue la fabrique, et c'est
   * elle qui tranche. **Seule la fabrique clôt un canal** (ADR-0021 S4) — le
   * hub ne garde aucune marque « fermé » : une fabrique qui rend encore un
   * producteur pour ce nom le rouvre. D'où la règle d'écriture d'un canal à
   * durée de vie : son nom porte l'identifiant de l'instance
   * (`room:42:<partie>`), et la fabrique rend `null` pour une instance terminée.
   *
   * @param channel - nom exact du canal.
   * @returns le nombre de membres de CE pod à qui la fin a été notifiée — les
   *   autres serveurs l'appliquent sans compte rendu.
   */
  closeChannel(channel: string): number {
    this.#sendControl({ op: "close", channel });
    return this.#closeLocal(channel);
  }

  /**
   * Éjecte un compte d'un canal, **sur tous les serveurs** : chacune de ses connexions membres reçoit `realtime:closed { reason: "evicted" }`.
   *
   * Tous les onglets du compte sont visés, où qu'ils soient servis ; l'ordre
   * traverse les pods comme {@link closeChannel}. ⚠️ **Éjecter coupe, seul
   * `allow` exclut** (ADR-0022 §6 décision 3) : pour que le compte ne revienne
   * pas, l'application retire l'appartenance là où `allow` la lit.
   *
   * ⚠️ Sur un bus PARTAGÉ, un tiers qui y écrit peut rejouer un ordre capté :
   * sur un canal durable, il recouperait le compte à chaque réadmission (risque
   * accepté et borné, ADR-0022 §6 d4) — bus privé exigé ; changer le secret du
   * bus rend caducs les ordres déjà captés.
   *
   * @param channel - nom exact du canal.
   * @param user - identifiant du compte (`IRealtimeConnection.userId`).
   * @returns le nombre de connexions de CE pod éjectées. Un nom vide ou de plus
   *   de 1 024 caractères n'éjecte rien et ne part pas sur le bus.
   */
  evictUser(channel: string, user: string): number {
    if (!this.#sendControl({ op: "evictUser", channel, user })) return 0;
    return this.#evictUserLocal(channel, user);
  }

  /**
   * Publie un ordre de contrôle aux autres serveurs — s'il y a un bus et que l'ordre a une forme que ses pairs acceptent.
   *
   * @returns `false` si l'ordre est mal formé (rien n'est appliqué nulle part).
   */
  #sendControl(order: ControlOrder): boolean {
    // La garde des pairs : on n'émet jamais ce qu'ils compteraient en rejet.
    if (readControlOrder(order) === null) return false;
    if (this.#backplane !== null && !isReservedSystemChannel(order.channel))
      this.#backplane.publish(PLATFORM_BUS_CHANNELS.control, order);
    return true;
  }

  /** Applique un ordre reçu du bus : forme vérifiée, canal de la plateforme refusé, sinon compté en rejet. */
  #applyControl(payload: unknown): void {
    const order = readControlOrder(payload);
    if (order === null || isReservedSystemChannel(order.channel)) {
      this.#ingressRejectedTotal += 1;
      return;
    }
    // `generation` (réservée, 10.x) est ignorée : toutes les générations sont éjectées.
    if (order.op === "close") this.#closeLocal(order.channel);
    else this.#evictUserLocal(order.channel, order.user);
  }

  /** Éjecte de `channel` les connexions de CE pod dont le compte est `user`. */
  #evictUserLocal(channel: string, user: string): number {
    const members = this.#channels?.get(channel)?.members;
    if (members == null) return 0;
    let evicted = 0;
    // `end` désabonne (retire l'entrée courante) : défini pendant l'itération d'une `Map`.
    for (const member of members.values())
      if (member.userId === user && member.end(channel, "evicted"))
        evicted += 1;
    return evicted;
  }

  /** Termine `channel` pour les membres de CE pod et libère son producteur. */
  #closeLocal(channel: string): number {
    const st = this.#channels?.get(channel);
    if (st === undefined) return 0;
    let ended = 0;
    const members = st.members;
    // `end` désabonne (donc retire l'entrée courante) : supprimer l'entrée en
    // cours d'itération d'une `Map` est défini, le parcours continue.
    if (members !== null)
      for (const member of members.values())
        if (member.end(channel, "ended")) ended += 1;
    // Restent des écouteurs ou services du serveur : le producteur est libéré
    // quand même, et le canal redevient passif (cf `listen`).
    const rest = this.#channels?.get(channel);
    if (rest?.owned === true) {
      try {
        rest.dispose?.();
      } catch {
        /* noop — un provider fautif ne bloque pas la fermeture */
      }
      rest.dispose = null;
      rest.owned = false;
    }
    return ended;
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
   *
   * @param payload - objet, tableau ou octets ; omise = signal sans charge.
   * @throws TypeError si la charge est un scalaire ou `null` ({@link isRealtimePayload},
   *   ADR-0021 S1) — un scalaire se publie dans un objet (`{ value }`).
   */
  publish(channel: string, payload?: object): void {
    if (!isRealtimePayload(payload))
      throw realtimePayloadError(channel, payload);
    const st = this.#channels?.get(channel);
    if (st !== undefined) this.#fanout(st, payload);
    // Mono-process : aucun backplane → seul ce test est payé, la politique de forward
    // n'est JAMAIS évaluée (préserve l'invariant « hot path = 1 test null »).
    if (this.#backplane === null) return;
    // Forward opt-in : flag caché si le canal a un état local, sinon politique à la volée
    // (publish serveur vers un canal sans abonné ici mais avec des abonnés ailleurs).
    const forward = st !== undefined ? st.forward : this.#isBroadcast(channel);
    if (!forward) {
      // Un bus est là, et ce canal reste sur ce serveur : voulu (sonde d'un pod)
      // ou oubli de `@RealtimeBroadcast` — la sonde le rend visible (D5).
      this.#localOnlyTotal += 1;
      return;
    }
    // Des octets que le bus ne porte pas intacts sont refusés plutôt que déformés
    // (ADR-0021 S6/S8) : ils restent livrés aux abonnés de ce serveur.
    if (this.#busRefuses(payload)) {
      this.#notifyOnce(
        "backplane:binary",
        this.#busBytes
          ? `realtime: le canal « ${channel} » publie des octets hors \`Uint8Array\` — le bus entre serveurs ne porte que des \`Uint8Array\` : seuls les abonnés de ce serveur les reçoivent`
          : `realtime: le canal « ${channel} » publie des octets — sans codec binaire côté serveur (\`codec: "cbor"\`) ou sans backplane qui les porte, ils ne traversent pas le bus entre serveurs (ils y seraient déformés) : seuls les abonnés de ce serveur les reçoivent`,
      );
      return;
    }
    this.#backplane.publish(channel, payload);
  }

  /**
   * Le bus refuse-t-il cette charge ? Un `Uint8Array` voyage quand le bus porte
   * les octets ({@link #busBytes}) ; toute autre vue binaire, jamais.
   *
   * Sans bus binaire, le parcours en profondeur n'est payé que si un codec
   * binaire est posé — seul cas où une charge à octets est légitime ; sans codec,
   * seule la charge de premier niveau est examinée, comme avant le codec.
   */
  #busRefuses(payload: object | undefined): boolean {
    const topLevel =
      ArrayBuffer.isView(payload) || payload instanceof ArrayBuffer;
    if (this.#busBytes) return topLevel && !(payload instanceof Uint8Array);
    if (this.#frameCodecs.binary !== null)
      return topLevel || containsBytes(payload);
    return topLevel;
  }

  /** Arme les octets sur le bus quand codec binaire ET backplane sont posés, dans n'importe quel ordre. */
  #armBusBytes(): void {
    const codec = this.#frameCodecs.binary;
    this.#busBytes =
      codec !== null &&
      this.#backplane !== null &&
      this.#backplane.enableBytes?.(codec) === true;
  }

  /**
   * Livre une charge à UNE identité — tous ses onglets, tous les serveurs, et personne d'autre (ADR-0022 §6, D1).
   *
   * Publie sur son canal personnel `user:<userId>` : seuls les onglets de cette
   * identité ont pu s'y abonner (politique intégrée, admission par égalité de
   * chaîne), et le préfixe traverse le bus dès qu'un bus est branché. Rien à
   * déclarer côté application. Personne n'écoute ? La charge est perdue, sans
   * erreur : c'est une diffusion, pas une boîte aux lettres.
   *
   * @param userId - l'`id` STABLE du compte (`RealtimeIdentity.id`), jamais le
   *   login.
   * @param payload - objet, tableau ou octets ; omise = signal sans charge.
   * @throws TypeError si la charge est un scalaire ou `null` (cf {@link publish}).
   */
  publishToUser(userId: string, payload?: object): void {
    this.publish(userChannel(userId), payload);
  }

  /** Préfixes déclarés diffusables entre serveurs, dans l'ordre de déclaration — lu par la ligne de démarrage. */
  broadcastPrefixes(): readonly string[] {
    return this.#broadcastPrefixes ?? [];
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
    // Diffusion à plusieurs : la frame est la MÊME pour tous → on la construit
    // une fois ici, et chaque codec l'encode une fois (`ChannelFrame`), plutôt
    // que N fois dans les sinks. À un seul abonné il n'y a rien à mutualiser, et
    // on ne paie donc rien de plus qu'avant.
    let frame: ChannelFrame | undefined;
    if (st.buildFrame !== null && st.sinks.size > 1) {
      try {
        frame = new ChannelFrame(st.buildFrame(payload));
      } catch {
        // Frame impossible à construire : on ne casse pas le fan-out. Chaque
        // sink reprend son chemin habituel, qui porte déjà son filet (log +
        // réponse d'erreur au client concerné).
        frame = undefined;
      }
    }
    for (const sink of st.sinks) {
      try {
        sink(payload, frame);
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
    for (const prefix of prefixes) {
      if (channel.startsWith(prefix)) return true;
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
    // Le canal personnel doit atteindre l'identité sur TOUS les serveurs : son
    // préfixe est diffusé par le framework, sans déclaration de l'application.
    this.markBroadcastChannel(USER_CHANNEL_PREFIX);
    backplane.onMessage((msg) => this.#admitFromBackplane(msg));
    // Avant `start()` : un driver armé avant de démarrer s'abonne d'un coup aux deux sujets.
    this.#armBusBytes();
    const started = backplane.start();
    // `start()` peut être asynchrone (Redis : abonnement au canal). Son échec
    // n'était rattrapé par personne → rejet non géré. On le signale par le canal
    // de plateforme quand il est branché ; sinon on le relève tel quel, pour ne
    // pas rendre muet un backplane qui ne relaie rien (cold path : 1 appel au boot).
    if (started instanceof Promise) {
      void started.catch((err: unknown) => {
        if (this.#notice === null) {
          throw err instanceof Error ? err : new Error(String(err));
        }
        this.#notifyOnce(
          "backplane:start",
          `realtime: démarrage du backplane en échec — les autres pairs ne recevront rien (${err instanceof Error ? err.message : String(err)})`,
        );
      });
    }
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
   *
   * Seule exception, AVANT ce contrôle : le canal de contrôle
   * (`PLATFORM_BUS_CHANNELS.control`), jamais diffusé aux abonnés — ses ordres,
   * en liste fermée, sont appliqués aux connexions de ce pod ou comptés en rejet.
   */
  #admitFromBackplane(msg: IBackplaneMessage): void {
    if (msg.channel === PLATFORM_BUS_CHANNELS.control) {
      this.#applyControl(msg.payload);
      return;
    }
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

  /**
   * Retire une connexion du registre de la sonde (au close) et verse ses cumuls à
   * ceux des connexions fermées : les totaux de {@link probe} restent monotones.
   * No-op si absente — une double sortie ne compte pas deux fois.
   */
  unregisterConnection(conn: IRealtimeConnProbe): void {
    if (this.#connections?.delete(conn) !== true) return;
    this.#closedBytesSent += conn.bytesSent;
    this.#closedMessagesSent += conn.messagesSent;
    this.#closedDropped += conn.dropped;
    this.#closedBinaryDiscarded += conn.binaryDiscarded ?? 0;
    this.#closedMalformedDiscarded += conn.malformedDiscarded ?? 0;
  }

  /**
   * Inscrit une connexion à identité RÉVOCABLE au registre de
   * re-validation (F4, revue 0.6). Démarre le tick au 1ᵉʳ inscrit (timer `unref`,
   * 0 timer au repos). À équilibrer par {@link unregisterRevocable} au close.
   * N'inscrire QUE les tokens portant `isValid` (le controller filtre) : une identité
   * non révocable (anonyme/JWT sans revalidation) ne doit pas y entrer.
   */
  registerRevocable(entry: IRevocableConnection): void {
    this.#revocation.register(entry);
  }

  /**
   * Retire une connexion du registre de révocation (au close). Arrête le tick dès que
   * le registre est vide (0 timer au repos). No-op si absente.
   */
  unregisterRevocable(entry: IRevocableConnection): void {
    this.#revocation.unregister(entry);
  }

  /**
   * Re-valide toutes les connexions révocables et ferme (`4001`) celles dont
   * l'identité est morte : session détruite ou passée à un autre compte, jeton
   * expiré ou révoqué. Fail-closed : une re-validation qui lève ferme aussi. Le
   * registre est celui des flux SSE ({@link RevocationWatch}) — une garde, deux
   * transports. Exposé (public) pour un test déterministe sans faux minuteur.
   */
  revalidateRevocable(): Promise<void> {
    return this.#revocation.revalidate();
  }

  /**
   * Ferme tout de suite les connexions qui ont figé cette identité — ses droits
   * ont changé (`IDENTITY_CHANGED_EVENT`). Code {@link IDENTITY_REFRESH_CLOSE_CODE},
   * reconnectable : le client revient avec ses rôles frais. Le registre est
   * celui des flux SSE — une règle, deux transports.
   *
   * @param identifier - identifiant de connexion de l'identité changée.
   * @returns le nombre de connexions fermées.
   */
  refreshIdentity(identifier: string): number {
    return this.#revocation.refreshIdentity(identifier);
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
    let bytesSentTotal = this.#closedBytesSent;
    let messagesSentTotal = this.#closedMessagesSent;
    let maxBufferedAmount = 0;
    let totalBufferedAmount = 0;
    let slowConsumers = 0;
    let drops = this.#closedDropped;
    let binaryDiscardedTotal = this.#closedBinaryDiscarded;
    let malformedDiscardedTotal = this.#closedMalformedDiscarded;
    if (this.#connections) {
      for (const c of this.#connections) {
        connectionCount += 1;
        bytesSentTotal += c.bytesSent;
        messagesSentTotal += c.messagesSent;
        drops += c.dropped;
        binaryDiscardedTotal += c.binaryDiscarded ?? 0;
        malformedDiscardedTotal += c.malformedDiscarded ?? 0;
        const buf = c.bufferedAmount;
        if (buf > maxBufferedAmount) maxBufferedAmount = buf;
        totalBufferedAmount += buf;
        if (buf >= this.#slowConsumerBytes) slowConsumers += 1;
      }
    }
    // Carte d'identité du backplane effectif. `null` (mono-process / fallback)
    // → descripteur `local` (driver loopback), sinon celui du driver branché.
    const backplane: IBackplaneInfo = this.#backplane?.describe() ?? {
      driver: LoopbackBackplane.driver,
      kind: "local",
      originId: String(process.pid),
      crossPod: false,
    };
    return {
      ts: Date.now(),
      channels,
      channelCount: channels.length,
      publishTotal: this.#publishTotal,
      fanoutTotal: this.#fanoutTotal,
      inboundTotal: this.#inboundTotal,
      ingressRejectedTotal: this.#ingressRejectedTotal,
      localOnlyTotal: this.#localOnlyTotal,
      systemFloorDeniedTotal: this.#systemFloorDeniedTotal,
      // Compté par le driver (seul à ouvrir l'enveloppe), relayé ici à côté des
      // autres refus de la sonde : 0 sans bus scellé.
      sealRejectedTotal: backplane.sealRejectedTotal ?? 0,
      // Compté par `@nodefony/http` avant le routage : aucun hub ne voit la trame.
      frameRateRejectedTotal: frameRateRejectedTotal(),
      allowTimedOutTotal: this.admissionBudget.timedOutTotal,
      allowSaturatedTotal: this.admissionBudget.saturatedTotal,
      authenticateTimedOutTotal: this.admissionBudget.authenticateTimedOutTotal,
      binaryDiscardedTotal,
      malformedDiscardedTotal,
      connectionCount,
      bytesSentTotal,
      messagesSentTotal,
      backpressure: {
        maxBufferedAmount,
        totalBufferedAmount,
        slowConsumers,
        drops,
      },
      backplane,
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
    for (const entry of list) {
      if (entry.authenticator === authenticator) return;
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
    for (const entry of list) {
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
   * Les codecs de frame du serveur (ADR-0022 §2) : le texte, et le codec binaire
   * accordé aux clients qui l'offrent — `null` tant que la configuration n'en
   * active aucun. Lu une fois par connexion, au handshake, jamais par trame.
   */
  get frameCodecs(): IFrameCodecSet {
    return this.#frameCodecs;
  }

  /**
   * Pose le codec binaire du serveur — 1× au boot par `RealtimeService.init()`,
   * depuis la clé `codec` de la configuration. Sans argument : texte seul.
   *
   * @param codec - le codec activé (`CBOR_FRAME_CODEC` de `nodefony/cbor`).
   */
  setFrameCodec(codec?: IFrameCodec): void {
    this.#frameCodecs = frameCodecSet(codec);
    this.#armBusBytes();
  }

  /**
   * Le codec des connexions texte — celui qu'emprunte aussi le REST du plan
   * d'administration, pour qu'une valeur lue par `GET` soit celle que la socket
   * livre (#618 D9). Avec un codec binaire activé, c'est le JSON à convention
   * d'octets ; sinon le JSON natif.
   */
  get textFrameCodec(): IFrameCodec {
    return this.#frameCodecs.text;
  }

  /**
   * Pose les bornes des admissions (`authenticateTimeoutMs`, `allowTimeoutMs`, `maxPendingAllowsPerConnection`, `maxPendingAllowsTotal`) — 1× au boot par `RealtimeService.init()`.
   */
  setAdmissionLimits(limits: IAdmissionLimits): void {
    this.admissionBudget.configure(limits);
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
   *
   * @throws BootConfigurationError Le verrou ne déclare pas `judgesWrite`
   *   alors qu'une écriture distincte de la lecture est inscrite : il la
   *   laisserait ouverte.
   */
  setFrameAuthorizer(
    authorizer: FrameAuthorizer | null,
    options?: { readonly silentProbe?: FrameAuthorizer | null },
  ): void {
    if (authorizer !== null && authorizer.judgesWrite !== true) {
      const defect = policyDeclarationsDefect(
        this.#policyDeclarations,
        this.#channelPolicyPatterns,
        false,
      );
      if (defect !== null) throw new BootConfigurationError(defect);
    }
    this.#frameAuthorizer = authorizer;
    // Un « oui » retenu valait pour l'ANCIEN verrou.
    this.#dropRetainedVerdicts();
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
   * **Seam #1b** — pose la politique d'un canal/méthode en REMPLAÇANT ce que ce nom déclarait (voie programmatique ; les décorateurs passent par {@link RealtimeHub.declareChannelPolicy}). Cold path.
   *
   * Deux formes de nom, et la seconde garde une FAMILLE :
   *
   * - un nom **exact** (`chat:room`) — lecture O(1) au `subscribe` ;
   * - un **motif** (`chat:room:*`) — il couvre tout canal dérivé servi par une
   *   fabrique dynamique (`chat:room:1000`), ce qu'un nom exact ne faisait pas.
   *   Le `*` remplace n'importe quelle suite de caractères ; tout le reste du
   *   motif est littéral (échappé), y compris `.` et `(`.
   *
   * Précédence, SORTE PAR SORTE (ADR-0022 §6, décision 1 quater) : la lecture
   * d'un nom vient de la déclaration la plus spécifique qui POSE une lecture —
   * le nom **exact**, puis le motif au littéral le plus long ; l'écriture de
   * même. C'est ainsi qu'on ouvre une exception dans une famille gardée, sans
   * effacer la sorte que l'exception ne déclare pas.
   *
   * @param name - nom exact du canal, de la méthode entrante ou de l'action, ou
   *   MOTIF de famille s'il contient `*`.
   * @param policy - exigences de LECTURE ({@link IChannelPolicy}) lues par
   *   security ; seules exigées au `subscribe`.
   * @param admission - instance de la classe d'admission quand `policy.allow`
   *   en est une ; ignorée sinon.
   * @param write - exigences d'ÉCRITURE, exigées EN PLUS de la lecture sur une
   *   trame entrante ; `null` : ce nom n'en déclare pas.
   * @throws BootConfigurationError Classe d'admission sans instance ; `allow`
   *   sur une écriture qui rencontre une lecture différente ; écriture distincte
   *   face à un verrou qui ne sait pas la juger.
   */
  registerChannelPolicy(
    name: string,
    policy: IChannelPolicy,
    admission?: IChannelAdmission,
    write: IChannelPolicy | null = null,
  ): void {
    this.#declare(name, policy, write, null, admission, false);
  }

  /**
   * Déclare la lecture et/ou l'écriture d'un nom en les AJOUTANT à ce qu'il déclarait — une sorte posée remplace la sienne, une sorte `null` garde celle d'avant. Voie des décorateurs (`channelPolicyRegistry.ts#registerControllerPolicies`). Cold path.
   *
   * @param name - nom exact ou motif.
   * @param read - lecture déclarée, ou `null`.
   * @param write - écriture déclarée, ou `null`.
   * @param admission - instance de la classe d'admission désignée par l'une ou
   *   l'autre ; ignorée sinon.
   * @throws BootConfigurationError Mêmes refus que {@link RealtimeHub.registerChannelPolicy}.
   */
  declareChannelPolicy(
    name: string,
    read: IChannelPolicy | null,
    write: IChannelPolicy | null,
    admission?: IChannelAdmission,
  ): void {
    this.#declare(name, read, write, null, admission, true);
  }

  /**
   * Pose le défaut FERMÉ d'une action (`{ authenticated: true }`) — son ÉCRITURE tant que rien d'exact ne déclare son nom et qu'aucun motif ne pose d'écriture ; une lecture de motif s'y ajoute sans l'ouvrir. Idempotent : une poignée de main n'en paie qu'une lecture.
   *
   * @param name - nom de l'action.
   */
  declareActionDefault(name: string): void {
    if (this.#policyDeclarations?.get(name)?.fallback === DEFAULT_ACTION_POLICY)
      return;
    this.#declare(name, null, null, DEFAULT_ACTION_POLICY, undefined, true);
  }

  /** Construit la déclaration d'un nom (remplacée ou fusionnée), puis la valide et la publie. */
  #declare(
    name: string,
    read: IChannelPolicy | null,
    write: IChannelPolicy | null,
    fallback: IChannelPolicy | null,
    admission: IChannelAdmission | undefined,
    merge: boolean,
  ): void {
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
    // Un nom qui porte `*` est un MOTIF, pas un canal : il garde une FAMILLE —
    // `chat:room` ne couvre pas `chat:room:1000`, servi par la fabrique
    // dynamique.
    const isPattern = name.includes("*");
    const previous: IPolicyDeclaration | undefined = isPattern
      ? this.#channelPolicyPatterns?.find((p) => p.source === name)
      : this.#policyDeclarations?.get(name);
    const declaration = declarationOf(
      name,
      read ?? (merge ? (previous?.read ?? null) : null),
      write ?? (merge ? (previous?.write ?? null) : null),
      fallback ?? previous?.fallback ?? null,
      admission ?? previous?.instance,
    );
    if (!isPattern) {
      const exact = new Map<string, IPolicyDeclaration>(
        this.#policyDeclarations ?? [],
      );
      exact.set(name, declaration);
      this.#commitPolicies(exact, this.#channelPolicyPatterns);
      return;
    }
    const re = compileChannelPattern(name);
    if (re === null) {
      this.#notifyOnce(
        `pattern-too-broad:${name}`,
        `le motif de politique "${name}" porte ${countWildcards(name)} caractères « * » ` +
          `(maximum ${RealtimeHub.MAX_PATTERN_WILDCARDS}) : il est IGNORÉ. Un ` +
          `motif de canal en demande un, deux au pire — au-delà, la mise en ` +
          `correspondance coûte cher sur des noms que le client choisit.`,
      );
      return;
    }
    // Poids = longueur du LITTÉRAL, `*` retirés. Entre `chat:*` (5) et
    // `chat:room:*` (10), le second gagne : il en dit plus.
    const weight = name.split("*").join("").length;
    const entry: IPatternDeclaration = {
      ...declaration,
      source: name,
      re,
      weight,
    };
    const patterns = [...(this.#channelPolicyPatterns ?? [])];
    const at = patterns.findIndex((p) => p.source === name);
    if (at >= 0) patterns[at] = entry;
    else {
      const rank = patterns.findIndex((p) => p.weight < weight);
      if (rank < 0) patterns.push(entry);
      else patterns.splice(rank, 0, entry);
    }
    this.#commitPolicies(this.#policyDeclarations, patterns);
  }

  /**
   * Valide l'ensemble des déclarations, recalcule la vue fusionnée de chaque nom exact, puis la publie — rien n'est publié si la validation refuse.
   *
   * La vue est recalculée à chaque inscription (cold path) pour qu'une trame
   * sur un nom exact reste UNE lecture de `Map`, motifs compris.
   */
  #commitPolicies(
    exact: Map<string, IPolicyDeclaration> | null,
    patterns: IPatternDeclaration[] | null,
  ): void {
    const lock = this.#frameAuthorizer;
    const defect = policyDeclarationsDefect(
      exact,
      patterns,
      lock === null || lock.judgesWrite === true,
    );
    if (defect !== null) throw new BootConfigurationError(defect);
    let merged: Map<string, IChannelPolicyEntry> | null = null;
    if (exact !== null) {
      for (const [name, declaration] of exact) {
        const resolved = resolveDeclaredPolicies(name, declaration, patterns);
        if (resolved !== null) {
          (merged ??= new Map<string, IChannelPolicyEntry>()).set(
            name,
            resolved,
          );
        }
      }
    }
    this.#policyDeclarations = exact;
    this.#channelPolicyPatterns = patterns;
    this.#channelPolicies = merged;
    // Inscrite après coup, la politique peut couvrir un canal dont le verrou a
    // déjà dit oui sous l'ancienne : ces verdicts sont oubliés, une fois.
    this.#dropRetainedVerdicts();
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
  static readonly MAX_PATTERN_WILDCARDS = MAX_CHANNEL_PATTERN_WILDCARDS;

  /**
   * Politique déclarée pour ce canal/méthode, ou `null` si aucune. Lu par
   * `@nodefony/security` (`resolveChannelPolicy` de la surface DI) au moment de
   * la frame `subscribe`/inbound. O(1), 0 alloc quand le registre est vide.
   */
  resolveChannelPolicy(name: string): IChannelPolicy | null {
    return this.#resolvePolicyEntry(name)?.policy ?? null;
  }

  /**
   * Lecture ET écriture qui s'appliquent à ce nom, en UNE résolution — `null` si aucune politique ne le couvre (ADR-0022 §6, décision 1 quater).
   *
   * Même résolution que {@link resolveChannelPolicy} : l'entrée la plus
   * spécifique (nom exact, puis motif) gouverne les deux sortes. Rendue telle
   * quelle : aucune allocation, une seule recherche par trame jugée.
   *
   * @param name - nom du canal, de la méthode entrante ou de l'action.
   */
  resolveChannelPolicies(name: string): IChannelPolicies | null {
    return this.#resolvePolicyEntry(name);
  }

  /**
   * Retient la PREMIÈRE classe qui déclare une sorte de politique sous ce nom, et rend celle qui l'avait déjà déclarée — pour refuser au démarrage deux classes en désaccord.
   *
   * @param name - nom exact ou motif.
   * @param kind - sorte déclarée : lecture ou écriture.
   * @param owner - constructeur du contrôleur qui déclare.
   * @param policy - la politique déclarée.
   * @returns la déclaration antérieure de cette sorte, ou `null`.
   */
  claimChannelPolicy(
    name: string,
    kind: "read" | "write",
    owner: object,
    policy: IChannelPolicy,
  ): IChannelPolicyClaim | null {
    const claims = (this.#policyClaims ??= new Map<
      string,
      IChannelPolicyClaim
    >());
    const key = `${kind}\u0000${name}`;
    const previous = claims.get(key);
    if (previous !== undefined) return previous;
    claims.set(key, {
      owner,
      ownerName: typeof owner === "function" ? owner.name : "(contrôleur)",
      policy,
    });
    return null;
  }

  /**
   * Règle d'admission prête à appeler pour ce canal — `null` s'il ne déclare pas `allow`. Lue au `subscribe`, jamais par trame.
   *
   * Même résolution que {@link resolveChannelPolicy} (nom exact, puis motif le
   * plus spécifique) : la règle suit TOUJOURS la politique qui s'applique.
   */
  resolveChannelAdmission(name: string): IChannelAdmissionRule | null {
    return this.#resolvePolicyEntry(name)?.admission ?? null;
  }

  /**
   * Les politiques de cette classe de contrôleur sont-elles déjà inscrites ? Une poignée de main n'en paie que ce `has`.
   *
   * @param owner - le constructeur du contrôleur.
   */
  hasPolicyOwner(owner: object): boolean {
    return this.#policyOwners?.has(owner) === true;
  }

  /**
   * Marque les politiques de cette classe comme inscrites — APRÈS l'inscription réussie, jamais avant : une politique refusée doit l'être de nouveau à la poignée de main suivante, pas laisser le canal ouvert.
   *
   * @param owner - le constructeur du contrôleur.
   */
  addPolicyOwner(owner: object): void {
    (this.#policyOwners ??= new WeakSet<object>()).add(owner);
  }

  /**
   * Politiques qui s'appliquent à ce nom : la vue fusionnée d'un nom exact (une lecture de `Map`), sinon la résolution par motifs, sorte par sorte.
   */
  #resolvePolicyEntry(name: string): IChannelPolicyEntry | null {
    const merged = this.#channelPolicies?.get(name);
    if (merged !== undefined) return merged;
    // Les motifs ne coûtent QUE s'il en existe : une application qui n'en
    // déclare aucun sort ici sans avoir rien parcouru. Repli : le canal
    // personnel porte sa politique intégrée, que l'application n'a rien eu à
    // déclarer (et qu'elle surcharge si elle déclare `user:…`).
    const patterns = this.#channelPolicyPatterns;
    if (patterns === null) {
      return name.startsWith(USER_CHANNEL_PREFIX)
        ? USER_CHANNEL_DECLARATION.self
        : null;
    }
    return resolveDeclaredPolicies(name, undefined, patterns);
  }

  /**
   * Ce nom EXACT porte-t-il une déclaration — motifs ignorés ?
   *
   * @param name - nom d'action ou de canal.
   */
  hasExactChannelPolicy(name: string): boolean {
    return this.#policyDeclarations?.has(name) === true;
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
   * Le registre des politiques lit le nom **EXACT**, puis les **MOTIFS**
   * déclarés ({@link resolveChannelPolicy}) : `@RealtimeChannel` déclare
   * `"chat:room"`, mais un canal dérivé (`chat:room:1000` — cadence, forage,
   * suffixe) servi par la fabrique dynamique ne matche ce nom que si un motif
   * (`chat:room:*`) le couvre. Sans motif, l'auteur croit son canal gardé ; il
   * ne l'est pas, et rien ne le lui dit. C'est ce silence qu'on ferme ici :
   * l'avertissement ne parle que des canaux qu'aucun motif ne couvre — un vrai
   * trou, pas une limite de l'outil.
   *
   * Appelé par le contrôleur, seul à savoir par quelle voie le canal a été
   * servi. Muet si aucune politique n'est déclarée (module aux canaux libres :
   * il n'y a alors aucune promesse à trahir).
   *
   * @param channel - le canal servi dynamiquement, cité en exemple dans l'alerte.
   */
  noticeUnguardedDynamicChannel(channel: string): void {
    // Un canal de plateforme (`nodefony:`) n'est jamais « sans règle » : il a
    // un plancher irréductible — fermé aux clients sans module de sécurité,
    // réservé à `ROLE_NODEFONY_ADMIN` avec lui. Alerter dessus accusait le
    // framework d'un trou qu'il n'a pas (vécu : `nodefony:socket` sous Studio).
    if (isReservedSystemChannel(channel)) return;
    if (!this.hasChannelPolicies()) return;
    if (this.resolveChannelPolicy(channel) !== null) return;
    this.#notifyOnce(
      "unguarded-dynamic-channel",
      `le canal "${channel}" n'a aucune règle d'accès : tout client connecté ` +
        `peut s'y abonner. Il est produit par createRealtimeChannel(), et une ` +
        `règle déclarée sur un nom exact ne couvre pas ses variantes (suffixe ` +
        `de cadence, identifiant). Pour le protéger : ` +
        `@RealtimeChannel("${channelFamily(channel)}", { roles: [ … ] }), ou ` +
        `vérifier les droits dans createRealtimeChannel().`,
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

  /**
   * La raison d'un refus du verrou, quand il sait la dire — `null` sinon, ou si l'explication lève.
   *
   * Chemin FROID : appelé après un refus, jamais par trame acceptée. Le
   * verdict, lui, est déjà rendu : une explication fautive ne change rien à la
   * décision, elle se tait.
   *
   * @param frame - la trame refusée.
   * @param peer - la connexion qui l'a émise.
   * @returns la phrase, ou `null`.
   */
  explainDenial(frame: unknown, peer: JsonRpcPeer): string | null {
    const explain = this.#frameAuthorizer?.explain;
    if (explain === undefined) return null;
    try {
      const said: unknown = explain(frame, this.getTokenForPeer(peer));
      return typeof said === "string" && said.length > 0 ? said : null;
    } catch {
      return null;
    }
  }

  /**
   * Pont hot-path entre `JsonRpcPeer.beforeDispatch` et le verrou métier : lit
   * le token déjà caché du peer (O(1), 0 lecture base) puis délègue à
   * l'authorizer. `true` (autorisée) si aucun verrou posé : `beforeDispatch`
   * est armé sur TOUTE connexion, et c'est ici que le bypass se paie — un
   * appel et une comparaison de champ.
   *
   * @param frame - frame JSON-RPC entrante (brute) à autoriser.
   * @param peer  - peer émetteur (clé du mapping `peer → token`).
   * @returns `true` si la frame peut être dispatchée, `false` si refusée.
   */
  runAuthorizer(frame: unknown, peer: JsonRpcPeer): boolean {
    const authorizer = this.#frameAuthorizer;
    if (authorizer === null) return true;
    // Fermé par défaut, comme `allow` : seul `true` laisse passer. Un verrou
    // écrit `async` par erreur rend une promesse — « vraie », elle admettait
    // tout, et le « oui » se retenait. Un verrou qui LÈVE refuse la trame au
    // lieu de remonter jusqu'au transport : un verrou qui lirait une charge
    // forgée par le client en ferait un déni de service à distance.
    try {
      // Lu en `unknown` : le type promet un booléen, un verrou écrit en
      // JavaScript ou déclaré `async` peut rendre autre chose.
      const verdict: unknown = authorizer(frame, this.getTokenForPeer(peer));
      return verdict === true;
    } catch (e) {
      this.#notifyOnce(
        "frame-authorizer-threw",
        "le verrou des trames a levé une exception — trame refusée : " +
          (e instanceof Error ? e.message : String(e)),
      );
      return false;
    }
  }

  /**
   * Inscrit une connexion qui vient de retenir son premier « oui » du verrou.
   *
   * Appelé par `gateFrame`, jamais par trame chaude ; à équilibrer par
   * {@link untrackRetainedVerdicts} à la fermeture.
   *
   * @param state - état de la connexion.
   */
  trackRetainedVerdicts(state: IRealtimeConnectionState): void {
    (this.#retainers ??= new Set<IRealtimeConnectionState>()).add(state);
  }

  /**
   * Retire une connexion fermée du registre des verdicts retenus.
   *
   * @param state - état de la connexion.
   */
  untrackRetainedVerdicts(state: IRealtimeConnectionState): void {
    this.#retainers?.delete(state);
  }

  // Le verrou ou une politique vient de changer : chaque connexion oublie les
  // « oui » qu'elle avait retenus, et sort du registre (elle y revient au
  // prochain). Cold path.
  #dropRetainedVerdicts(): void {
    const retainers = this.#retainers;
    if (retainers === null) return;
    for (const state of retainers) dropRetainedVerdicts(state);
    this.#retainers = null;
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
    const probe = this.#channelProbe;
    if (probe === null) return true;
    // La frame que `subscribe` produirait — la sonde et le verrou lisent donc
    // exactement la même forme, et aucune règle n'est réécrite ici. Une sonde
    // qui lève échoue OUVERT (la règle ci-dessus) au lieu de casser la poignée
    // de main : c'est le verrou, pas l'annonce, qui protège l'accès.
    try {
      return probe(
        { method: "subscribe", params: { channel } },
        this.getTokenForPeer(peer),
      );
    } catch (e) {
      this.#notifyOnce(
        "channel-probe-threw",
        "la sonde des canaux annoncés a levé une exception — canal annoncé : " +
          (e instanceof Error ? e.message : String(e)),
      );
      return true;
    }
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
    // Posée par le même appel que le verrou (`setFrameAuthorizer`) : elle tombe
    // avec lui, sinon une sonde orpheline masquerait encore des canaux à
    // l'accueil sans qu'aucun verrou ne soit posé.
    this.#channelProbe = null;
    this.#dropRetainedVerdicts();
    this.#channelPolicies?.clear();
    this.#channelPolicies = null;
    this.#channelPolicyPatterns = null;
    this.#policyOwners = null;
    this.#policyClaims = null;
    this.#policyDeclarations = null;
    this.#originGuard = null;
    // Détache le backplane (reset). On ne `stop()` PAS ici : le hub n'en est pas
    // l'owner (créé/détruit par le module qui l'a branché) — il le libère lui-même.
    this.#backplane = null;
    this.#busBytes = false;
    this.#publishTotal = 0;
    this.#fanoutTotal = 0;
    this.#closedBytesSent = 0;
    this.#closedMessagesSent = 0;
    this.#closedDropped = 0;
    this.#closedBinaryDiscarded = 0;
    this.#closedMalformedDiscarded = 0;
    this.#inboundTotal = 0;
    this.#ingressRejectedTotal = 0;
    this.#localOnlyTotal = 0;
    this.#systemFloorDeniedTotal = 0;
    this.admissionBudget.reset();
    this.#frameCodecs = frameCodecSet();
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
        // Le host est dans l'en-tête `host:` (RFC 9110 §7.2) — déjà lowercasé
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

/**
 * Le hub lu à travers le contrat `C` : mêmes méthodes que {@link RealtimeHub},
 * mais `publish` n'accepte que les canaux de `serverToClient`, chacun avec la
 * charge qu'il déclare. C'est le MÊME objet que le hub libre — une vue de type,
 * sans un octet ni une instruction de plus.
 *
 * @typeParam C - le contrat de l'application.
 */
export interface IContractRealtimeHub<C extends IRealtimeContract> extends Omit<
  RealtimeHub,
  "publish" | "publishToUser"
> {
  /**
   * Livre à UNE identité la charge que le contrat déclare pour le canal
   * personnel (clé gabarit `` [k: `user:${string}`]: … `` de `serverToClient`)
   * — cf {@link RealtimeHub.publishToUser}. Contrat sans cette clé : ne compile
   * pas, la forme du message privé se déclare d'abord.
   *
   * @param userId - l'`id` STABLE du compte, jamais le login.
   */
  publishToUser(
    userId: string,
    payload: UserChannelPayload<ContractServerEmit<C>> & object,
  ): void;
  /**
   * Publie sur un canal déclaré par le contrat (fan-out local, puis backplane
   * si le canal est broadcast) — cf {@link RealtimeHub.publish}.
   *
   * @throws TypeError si la charge n'est pas un objet ({@link isRealtimePayload}).
   */
  publish<K extends EventNames<ContractServerEmit<C>>>(
    channel: K,
    payload: EventPayload<ContractServerEmit<C>, K> & object,
  ): void;
}

/**
 * Renvoie le hub realtime du process (singleton lazy) — forme LIBRE : tout nom
 * de canal, toute charge objet.
 */
export function getRealtimeHub(): RealtimeHub;
/**
 * Renvoie le hub realtime du process lu à travers le contrat `C` : la diffusion
 * d'un service, d'un job ou d'une boucle de jeu est vérifiée par le contrat
 * partagé avec le navigateur. Même objet que la forme libre : 0 octet, 0 ns.
 *
 * Le contrat est choisi par l'appelant — rien n'empêche d'en nommer un autre que
 * celui du contrôleur qui sert le canal ; c'est le fichier partagé qui fait foi.
 *
 * @typeParam C - le contrat de l'application.
 *
 * @example
 * ```ts
 * const chat = getRealtimeHub<ChatContract>();
 * chat.publish("chat:room", { from: "ana", text: "salut" }); // charge vérifiée
 * getRealtimeHub().publish("n'importe:quoi", { x: 1 });       // forme libre
 * ```
 */
export function getRealtimeHub<
  C extends IRealtimeContract,
>(): IContractRealtimeHub<C>;
export function getRealtimeHub(): RealtimeHub {
  return (_hub ??= new RealtimeHub());
}

export default RealtimeHub;

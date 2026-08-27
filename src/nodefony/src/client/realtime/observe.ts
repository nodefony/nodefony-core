/**
 * observe — **socle agnostique des liaisons de vue** du client temps réel.
 *
 * Souscrire à un canal, tenir une dernière valeur, borner un journal, filtrer par
 * sévérité, se désabonner proprement : rien de tout cela n'appartient à React, à
 * Vue, à Angular ni à Svelte. Ce qui leur appartient — la SEULE chose qu'une
 * liaison a le droit de contenir — c'est la traduction *rappel + libération →
 * réactivité locale* : un `useState`, un `ref`, un `signal`, une rune.
 *
 * Chaque fonction de ce module a donc la même forme, et c'est tout le contrat :
 *
 * ```
 * observeX(client, …arguments, emit) → dispose
 * ```
 *
 * `emit` est appelé avec la valeur courante ; `dispose` coupe tout. Une liaison
 * s'écrit alors en trois lignes dans n'importe quel framework, et les onze règles
 * qui vivaient dans les hooks React — précédence de la socket fournie, cycle de
 * connexion, appariement `on`↔`subscribe`, format coalescé du journal, tailles
 * d'anneau, canal par défaut — n'existent qu'ICI.
 *
 * Pourquoi ce module existe : sans lui, porter les douze hooks vers trois autres
 * fronts donnait **quatre implémentations de la même règle**, qui divergent en
 * silence. Le dépôt l'a déjà payé — `"__state__"` était recopié en dur dans les
 * trois gabarits, et la convention de cadence avait été fabriquée à la main trois
 * fois côté navigateur avant d'être centralisée.
 *
 * Zéro dépendance à un framework de vue, zéro DOM : ce fichier tourne dans un
 * test Node comme dans un bundle navigateur.
 *
 * @module nodefony/client
 */
import { RealtimeClient } from "./RealtimeClient";
import type {
  RealtimeState,
  RealtimeIdentity,
  RealtimeReconnectInfo,
  NodefonyNotice,
  MessageStats,
} from "./RealtimeClient";
import type {
  BindAdaptiveOptions,
  AdaptiveChannelBinding,
} from "./AdaptiveRate";
import { PLATFORM_CHANNELS } from "../../realtime/platformChannels";

/** Rappel d'une liaison de vue : reçoit la valeur courante. */
export type Emit<T> = (value: T) => void;

/** Libération d'une souscription. Idempotente chez tous les observateurs de ce module. */
export type Dispose = () => void;

/**
 * Socket sur laquelle un observateur travaille. Volontairement le client
 * NON paramétré : une liaison de vue ne connaît pas les cartes d'événements
 * typées de l'application.
 */
export type ObservableClient = RealtimeClient;

/* ────────────────────────── connexion partagée ────────────────────────── */

/** Options de {@link connectShared} — l'adresse, ou la socket déjà construite. */
export interface ConnectSharedOptions {
  /**
   * Adresse du serveur temps réel — la voie SIMPLE. La socket partagée de cette
   * URL est fabriquée (ou réutilisée) et connectée par {@link SharedConnection.start}.
   */
  url?: string;
  /**
   * Socket déjà construite — la voie AVANCÉE, quand l'application possède son
   * cycle de connexion (c'est le cas de la console d'administration, qui
   * re-négocie la socket sur changement d'identité).
   *
   * Fournie, elle l'emporte sur `url` et son cycle n'est **pas** touché : ni
   * `connect`, ni `disconnect`.
   */
  client?: ObservableClient;
}

/** Résultat de {@link connectShared} : la socket, à qui elle appartient, et comment la démarrer. */
export interface SharedConnection {
  /** La socket à donner aux observateurs. */
  socket: ObservableClient;
  /**
   * `true` si c'est nous qui l'avons obtenue depuis l'URL — donc à nous de la
   * connecter. `false` si l'application l'a fournie : son cycle lui appartient.
   */
  owned: boolean;
  /**
   * Ouvre la connexion si elle nous appartient, sinon ne fait rien. Idempotente
   * (`connect()` est un no-op si la socket est déjà connectée ou en cours), et
   * le rejet est avalé : la reconnexion automatique prend le relais, et l'état
   * reste lisible par {@link observeState}.
   */
  start(): void;
}

/**
 * Résout la socket partagée d'une adresse — ou adopte celle qu'on lui donne —
 * et rend de quoi la démarrer sans jamais la couper.
 *
 * Trois règles tiennent dans cette fonction, et c'est pour cela qu'elle existe :
 *
 * 1. **`client` l'emporte sur `url`** ; une socket fournie appartient à
 *    l'application.
 * 2. **`connect()` est idempotent et son rejet est avalé** — le double montage
 *    du mode strict de React n'ouvre pas deux sockets, et un serveur absent au
 *    premier essai ne remonte pas une erreur non gérée.
 * 3. **Jamais de `disconnect()` au démontage.** La connexion appartient à la
 *    PAGE, pas au composant : couper ici tranche les requêtes en vol des autres
 *    consommateurs de la même socket partagée. C'est une régression déjà vécue.
 *
 * Recopiée dans une quatrième liaison, la règle 3 se perd — elle est en creux
 * (« ne pas faire »), donc invisible à la relecture.
 *
 * @example La voie simple, dans n'importe quel framework :
 * ```ts
 * const live = connectShared({ url: "/api/live/realtime" });
 * live.start();
 * observeChannelData(live.socket, "live:events", (e) => setDernier(e));
 * ```
 *
 * @throws si ni `url` ni `client` ne sont fournis — l'adresse dépend de
 *   l'application, le framework n'en devine aucune.
 */
export function connectShared(opts: ConnectSharedOptions): SharedConnection {
  const provided = opts.client;
  const socket = provided ?? RealtimeClient.shared({ url: opts.url });
  const owned = !provided;
  return {
    socket,
    owned,
    start(): void {
      if (!owned) return;
      void socket.connect().catch(() => {
        /* la reconnexion automatique prend le relais ; l'état est lisible par `observeState` */
      });
    },
  };
}

/* ─────────────────────────── état & identité ─────────────────────────── */

/**
 * Observe l'état de la connexion. `emit` reçoit l'état courant **immédiatement**,
 * puis à chaque transition — une liaison n'a donc rien à initialiser à part.
 */
export function observeState(
  client: ObservableClient,
  emit: Emit<RealtimeState>,
): Dispose {
  emit(client.state);
  return client.onState(emit);
}

/**
 * Observe l'identité résolue par le serveur au welcome (`null` tant qu'aucun
 * welcome n'est arrivé, et après un `disconnect()` volontaire). `emit` reçoit la
 * valeur courante immédiatement, puis à chaque (re)welcome.
 *
 * Brique du gating d'écran : `authenticated: false` → écran de connexion, sans
 * route `/auth/me`.
 */
export function observeIdentity(
  client: ObservableClient,
  emit: Emit<RealtimeIdentity | null>,
): Dispose {
  emit(client.identity);
  return client.onIdentity(emit);
}

/**
 * Observe les **tentatives de reconnexion** programmées par le back-off :
 * numéro d'essai, délai retenu, échéance absolue. De quoi rendre un compte à
 * rebours plutôt qu'un « déconnecté » muet.
 *
 * Contrairement aux autres observateurs, rien n'est émis à la souscription : une
 * tentative est un ÉVÉNEMENT, pas un état — il n'y a pas de « valeur courante »
 * à rejouer, et en inventer une afficherait un compte à rebours périmé.
 */
export function observeReconnect(
  client: ObservableClient,
  emit: Emit<RealtimeReconnectInfo>,
): Dispose {
  return client.onReconnect(emit);
}

/* ────────────────────────────── canaux ────────────────────────────────── */

/**
 * Observe un canal pub/sub : `emit` est appelé pour chaque message reçu.
 *
 * L'appariement `on`↔`subscribe` et `dispose`↔`unsubscribe` n'est pas réécrit
 * ici : c'est {@link RealtimeClient.channel} qui l'encapsule, et le rejouer
 * mettrait la même règle deux fois dans le cœur. L'abonnement serveur est
 * ref-compté (N observateurs du même canal = un seul abonnement réseau) et
 * rejoué à chaque reconnexion.
 */
export function observeChannel(
  client: ObservableClient,
  channel: string,
  emit: Emit<unknown>,
): Dispose {
  const handle = client.channel(channel);
  handle.on((payload: unknown) => emit(payload));
  handle.open();
  // `close()` libère les handlers posés par ce handle ET relâche l'abonnement.
  return () => handle.close();
}

/**
 * Observe la **dernière valeur** reçue sur un canal — le cas le plus courant
 * (dernière mesure d'un flux d'état). `emit` reçoit `initial` immédiatement,
 * puis chaque nouvelle valeur : dernier arrivé gagne.
 */
export function observeChannelData<T = unknown>(
  client: ObservableClient,
  channel: string,
  emit: Emit<T | null>,
  initial: T | null = null,
): Dispose {
  emit(initial);
  return observeChannel(client, channel, (payload) => emit(payload as T));
}

/**
 * Observe les **statistiques** d'un canal (débit, série du VU-mètre, total),
 * rafraîchies par l'échantillonneur du client une fois par seconde. `emit`
 * reçoit l'instantané courant immédiatement, puis à chaque échantillon.
 *
 * L'instantané est un objet recréé à chaque lecture : une liaison qui exige une
 * référence stable (le store externe de React) ne doit pas s'y brancher
 * directement — c'est pourquoi le hook correspondant tient un état local.
 */
export function observeChannelStats(
  client: ObservableClient,
  channel: string,
  emit: Emit<MessageStats | null>,
): Dispose {
  const read = (): MessageStats | null =>
    client.getChannelStats(channel) ?? null;
  emit(read());
  return client.onStats(() => emit(read()));
}

/**
 * Clé de **re-liaison** d'un canal en cadence adaptative.
 *
 * Trois valeurs, et trois seulement, doivent défaire puis refaire l'abonnement :
 * le canal de base, la cadence désirée et l'interrupteur adaptatif. Ni le
 * gestionnaire, ni le reste des réglages — leur identité change à chaque rendu
 * dans la plupart des frameworks, et re-lier à chaque rendu couperait le flux en
 * boucle.
 *
 * Chaque liaison a besoin de cette clé sous une forme différente (liste de
 * dépendances React, source d'un `watch` Vue, `$effect` Svelte) ; ce qui doit
 * rester commun, c'est **ce qu'elle contient**.
 */
export function adaptiveRebindKey(
  base: string,
  desiredMs: number,
  enabled = true,
): string {
  return `${base}|${desiredMs}|${enabled ? 1 : 0}`;
}

/** Options de {@link observeAdaptiveChannel} — la cadence désirée est passée à part. */
export type AdaptiveObserveOptions = Omit<BindAdaptiveOptions, "intervalMs">;

/**
 * Observe un canal d'ÉTAT en **cadence adaptative** (AIMD piloté par le client) :
 * la cadence recule sous famine et remonte quand c'est sain, sans changement
 * serveur. `emit` reçoit chaque frame à travers les changements de cadence.
 *
 * Réservé aux canaux latest-wins : décimer un canal d'événements perd des
 * messages.
 *
 * @param desiredMs - cadence souhaitée (ms).
 * @param options - réglages AIMD ; `onRate` reste disponible pour afficher la
 *   cadence effective dans un badge.
 * @returns la poignée du binding (cadence courante, canal effectif, `dispose`).
 */
export function observeAdaptiveChannel(
  client: ObservableClient,
  base: string,
  emit: Emit<unknown>,
  desiredMs: number,
  options: AdaptiveObserveOptions = {},
): AdaptiveChannelBinding {
  return client.adaptiveChannel(base, (...args: unknown[]) => emit(args[0]), {
    ...options,
    intervalMs: desiredMs,
  });
}

/* ────────────────────── auto-observation de la socket ─────────────────── */

/**
 * Ce que le client sait de sa PROPRE socket, à un instant donné.
 *
 * Pourquoi ce contrat existe : quatre écrans lisaient déjà `subscribedChannels`,
 * `framesReceived`, `lastFrameAt` et `lastFrameMethod` à la main pour afficher
 * la même chose — c'est-à-dire quatre lectures qui divergeront. La donnée est
 * parfaitement agnostique ; seule sa mise en page appartient à la vue.
 *
 * La frontière est là, et elle est nette : **l'instantané est ici, la boîte qui
 * l'affiche reste chez chaque front**. Publier un composant obligerait à en
 * écrire un par framework de vue, et ferait entrer du DOM dans un module dont
 * toute la valeur est de n'en avoir aucun.
 */
export interface SocketSnapshot {
  /** L'adresse du serveur temps réel — de QUELLE socket cet instantané parle. */
  url: string | null;
  /** État de la connexion. */
  state: RealtimeState;
  /** Canaux effectivement tenus par cette connexion. */
  channels: readonly string[];
  /** Trames reçues depuis l'ouverture. */
  frames: number;
  /** Trames perdues faute de transport ouvert — un silence qui se compte. */
  unsent: number;
  /** Méthode et horodatage de la dernière trame reçue (`null` si aucune). */
  lastFrame: { method: string | null; at: number | null };
  /** Tentatives de reconnexion depuis la dernière connexion réussie. */
  reconnectAttempts: number;
  /** Échéance de la prochaine tentative (ms epoch), `null` hors reconnexion. */
  nextRetryAt: number | null;
  /** Identité résolue par le serveur, `null` avant le premier welcome. */
  identity: RealtimeIdentity | null;
}

/**
 * Lit l'instantané courant. Purement local : aucune trame n'est émise, rien
 * n'est demandé au serveur — afficher cet état ne coûte donc rien au réseau.
 */
export function socketSnapshot(client: ObservableClient): SocketSnapshot {
  return {
    url: client.url,
    state: client.state,
    channels: client.subscribedChannels,
    frames: client.framesReceived,
    unsent: client.framesUnsent,
    lastFrame: { method: client.lastFrameMethod, at: client.lastFrameAt },
    reconnectAttempts: client.reconnectAttempts,
    nextRetryAt: client.nextRetryAt,
    identity: client.identity,
  };
}

/**
 * Observe l'instantané : `emit` reçoit la valeur courante immédiatement, puis à
 * chaque échantillon du client (une fois par seconde) et à chaque changement
 * d'état — les deux seuls moments où il peut avoir bougé de façon visible.
 *
 * L'horloge est celle de l'échantillonneur DÉJÀ en place ; une liaison qui
 * poserait son propre `setInterval` ajouterait un second réveil par seconde
 * pour la même mesure.
 */
export function observeSnapshot(
  client: ObservableClient,
  emit: Emit<SocketSnapshot>,
): Dispose {
  const pousser = (): void => emit(socketSnapshot(client));
  pousser();
  const offStats = client.onStats(pousser);
  const offState = client.onState(pousser);
  return () => {
    offStats();
    offState();
  };
}

/* ─────────────────────────── journal & notices ────────────────────────── */

/** Options de {@link observeSyslog}. */
export interface ObserveSyslogOptions {
  /** Taille max de l'anneau (les plus anciennes lignes sont évincées). Défaut 500. */
  max?: number;
  /** Ne garder que ces sévérités (ex. `["ERROR", "CRITIC"]`). Toutes par défaut. */
  severities?: string[];
  /** Canal source. Défaut : le canal de journaux de la plateforme. */
  channel?: string;
}

/** Taille par défaut de l'anneau du journal. */
const SYSLOG_RING_DEFAULT = 500;

/** Taille par défaut de l'anneau des notices. */
const NOTICE_RING_DEFAULT = 50;

/**
 * Observe le **journal du serveur** : anneau borné, filtre de sévérité, et
 * surtout le format **coalescé** du canal (`{ logs: Pdu[], dropped }`) autant que
 * l'entrée unique. `emit` reçoit le tableau complet à chaque changement — une
 * nouvelle référence, directement affichable.
 *
 * Le format coalescé est du **protocole serveur** : le décoder dans une liaison
 * de vue, c'est le redécoder dans les trois suivantes. C'est la pire des règles
 * qui vivaient côté React.
 *
 * Le canal par défaut vient de la table des canaux de plateforme — jamais d'une
 * chaîne écrite en clair, que le prochain renommage laisserait derrière lui.
 */
export function observeSyslog(
  client: ObservableClient,
  emit: Emit<unknown[]>,
  opts: ObserveSyslogOptions = {},
): Dispose {
  const {
    max = SYSLOG_RING_DEFAULT,
    severities,
    channel = PLATFORM_CHANNELS.syslog,
  } = opts;
  let entries: unknown[] = [];
  emit(entries);
  return observeChannel(client, channel, (payload) => {
    const record = payload as { logs?: unknown[] } | null;
    const incoming =
      record && Array.isArray(record.logs) ? record.logs : [payload];
    const kept = severities
      ? incoming.filter((entry) =>
          severities.includes((entry as { severity?: string }).severity ?? ""),
        )
      : incoming;
    if (kept.length === 0) return;
    const next = entries.concat(kept);
    entries = next.length > max ? next.slice(-max) : next;
    emit(entries);
  });
}

/**
 * Observe les **notices normalisées** du client : criticités qui cassent le temps
 * réel (codes de fermeture RFC 6455 interprétés), erreurs poussées par le
 * serveur, rétablissement de connexion. `emit` est appelé pour CHAQUE notice —
 * de quoi brancher un centre de notifications.
 *
 * À monter **une seule fois** par page, sans quoi les notifications se dupliquent.
 */
export function observeNotices(
  client: ObservableClient,
  emit: Emit<NodefonyNotice>,
): Dispose {
  return client.onNotice(emit);
}

/** Options de {@link observeNoticeLog}. */
export interface ObserveNoticeLogOptions {
  /** Taille max de l'anneau (les plus anciennes notices sont évincées). Défaut 50. */
  max?: number;
  /** Ne garder que ces sources (ex. `["realtime"]`). Toutes par défaut. */
  sources?: NodefonyNotice["source"][];
}

/**
 * Observe un **historique borné** des dernières notices, filtrable par source :
 * un journal léger des incidents temps réel, distinct des notifications
 * éphémères. `emit` reçoit le tableau complet à chaque changement.
 */
export function observeNoticeLog(
  client: ObservableClient,
  emit: Emit<NodefonyNotice[]>,
  opts: ObserveNoticeLogOptions = {},
): Dispose {
  const { max = NOTICE_RING_DEFAULT, sources } = opts;
  let notices: NodefonyNotice[] = [];
  emit(notices);
  return observeNotices(client, (notice) => {
    if (sources && !sources.includes(notice.source)) return;
    const next = notices.concat(notice);
    notices = next.length > max ? next.slice(-max) : next;
    emit(notices);
  });
}

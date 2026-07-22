/**
 * IRealtimeSocket — « la socket Nodefony » : la prise temps réel **ISOMORPHE** client↔back.
 *
 * C'est LA brique du realtime Nodefony (cf vision « la socket Nodefony ») : un seul lien,
 * qui a une **existence identique côté back et côté front** (fusionnel), dont le **plan de
 * contrôle parle JSON-RPC 2.0** ({@link IRealtimePeer}) et qui **multiplexe N canaux** par
 * souscription. Un consommateur — page front OU service back — tient **UN handle**
 * (`subscribe / on / publish / request`) : c'est SA socket. Il ignore quel transport porte
 * les octets, si le pair est local ou distant, et comment chaque canal est servi.
 *
 * Vocabulaire : la **socket** est la prise (ce qu'on tient) ; derrière elle, côté serveur,
 * un **hub** ({@link RealtimeHub}) aiguille entre les N sockets des clients et, à terme,
 * entre les pods (backplane Redis). La socket multiplexe des canaux ; le hub aiguille entre
 * les sockets. La couche octets, elle, est le {@link IRealtimeTransport} (≠ « socket » ici).
 *
 * ── Un canal = un sous-flux nommé DUPLEX ──
 *  Chaque canal est un tuyau bidirectionnel multiplexé sur la socket. Son **backing est
 *  pluggable côté serveur**, transparent pour le consommateur :
 *   - **pub/sub** (défaut) : notifications JSON-RPC (ex. `nodefony:dashboard`).
 *   - **encapsulation de protocole** : le canal transporte un AUTRE langage tunnelé dans la
 *     socket (ex. **SIP** sur `sip:line1`).
 *   - **bridge** : le canal est câblé vers une autre couche de transport (**TCP/UDP**).
 *   - **proxy** : le canal relaie vers un autre service.
 *  Le **backplane Redis** (fan-out cross-pod cloud-native) n'est qu'UN backing parmi ceux-là.
 *
 * ── Sémantique des verbes (identique des deux côtés, cible différente) ──
 *  - `publish(channel, payload)` : émet sur un canal (duplex). Côté **client** → vers le
 *    serveur (1 pair) ; côté **serveur** → fan-out aux abonnés via le hub (+ backplane).
 *  - `subscribe` / `unsubscribe` : DEMANDE / arrête un flux (ref-compté).
 *  - `on` / `off` : REÇOIT (`on` ≠ `subscribe` : l'un branche le handler local, l'autre
 *    demande au pair de pousser).
 *  - `request(method, params?)` : RPC corrélé (`Promise` du `result`).
 *  - `channel(name)` : renvoie un {@link IRealtimeChannel} (objet par canal) — forme
 *    naturelle des canaux à état (SIP, bridge) et point d'accroche des futures couches
 *    (codec, cadence AIMD, politique drop/coalesce/batch par canal).
 *
 * Impl de référence : {@link RealtimeClient} (navigateur). Côté serveur, le hub à canaux
 * partagés ({@link RealtimeHub}, fan-out + backings) et une façade consommateur dériveront
 * de ce même contrat.
 *
 * @see {@link IRealtimePeer} — la couche protocole (JSON-RPC 2.0) en dessous.
 * @see {@link IRealtimeTransport} — la couche octets (le seul maillon client/serveur).
 */

import type {
  ActionNames,
  ActionParams,
  ActionResult,
  ActionsMap,
  DefaultActionsMap,
  DefaultEventsMap,
  EventNames,
  EventPayload,
  EventsMap,
} from "./RealtimeEventMap";

/** Handler d'un canal pub/sub — reçoit le `params` de la notification (ou `(method, params)` sur `"*"`). */
export type RealtimeHandler = (...args: unknown[]) => void;

/**
 * Compteurs d'un canal — **génériques**, calculés au point d'arrivée des frames donc
 * fiables et réutilisables par toute app. (`RealtimeClient.MessageStats` en est l'alias.)
 */
export interface IChannelStats {
  /** Méthode JSON-RPC == nom du canal pub/sub. */
  method: string;
  /** Total de notifications reçues sur ce canal. */
  msgCount: number;
  /** Timestamp (ms) de la dernière notification, `null` si aucune. */
  lastMessage: number | null;
  /** Débit instantané (msg/s), échantillonné 1×/s. */
  rate: number;
  /** Historique du débit (VU-mètre) — fenêtre glissante. */
  series: number[];
}

/**
 * Handle d'UN canal — vue par-canal d'un sous-flux duplex multiplexé sur la
 * {@link IRealtimeSocket}. Forme naturelle des canaux à état (un appel SIP, une connexion
 * bridgée) : il porte son nom, sa nature et son cycle de vie. C'est le **point d'accroche**
 * des couches à venir (codec de protocole, cadence AIMD, politique `drop|coalesce|batch`) —
 * elles enrichiront ce handle SANS retoucher la socket.
 *
 * N'introduit AUCUN protocole nouveau : fine liaison au-dessus des primitives de la socket
 * (`subscribe`/`on`/`publish`).
 */
export interface IRealtimeChannel {
  /** Nom du canal (clé de multiplexage == method JSON-RPC des notifications). */
  readonly name: string;
  /**
   * Nature du backing serveur (`pubsub` | `protocol` | `bridge` | `proxy` | …), annoncée
   * par le serveur. `undefined` tant qu'inconnue (ex. côté client avant découverte).
   */
  readonly kind?: string;
  /** Branche un handler de réception sur ce canal. Renvoie un `dispose`. */
  on(handler: RealtimeHandler): () => void;
  /** Émet sur ce canal (duplex, one-way). */
  send(payload?: unknown): void;
  /** Ouvre le flux : `subscribe` ref-compté (demande au pair de pousser). */
  open(): void;
  /** Ferme : `unsubscribe` ref-compté + retire les handlers branchés via ce handle. */
  close(): void;
}

/**
 * Contrat de « la socket Nodefony » — voir le bloc de tête du fichier. Implémenté par
 * {@link RealtimeClient} (front) et, à terme, par une façade serveur au-dessus du hub.
 *
 * @typeParam Emit    — canaux pub/sub SORTANTS (typage de `publish`).
 * @typeParam Listen  — canaux pub/sub RÉCEPTIONNÉS (typage de `subscribe`/`on`/`off`).
 * @typeParam Actions — contrat RPC bidirectionnel (typage de `request`).
 *
 * Défauts permissifs sur les 3 → rétro-compat 100% pour le code non paramétré.
 *
 * **Pattern « type conditionnel inline »** : chaque méthode a UNE signature unique
 * paramétrée par un `K extends string`. Si `K` matche la map (`EventNames<Listen>`,
 * `EventNames<Emit>`, `ActionNames<Actions>`) → typage strict ; sinon → fallback
 * permissif (`unknown`/`RealtimeHandler`). Permet les noms système (`__notice__`,
 * `*`, `subscribe`/`unsubscribe` internes) à côté du contrat applicatif typé sans
 * 2 overloads incompatibles en variance.
 */
export interface IRealtimeSocket<
  Emit extends EventsMap = DefaultEventsMap,
  Listen extends EventsMap = DefaultEventsMap,
  Actions extends ActionsMap = DefaultActionsMap,
> {
  /**
   * S'abonne à un canal (ref-compté) : émet la demande au pair UNIQUEMENT au 1ᵉʳ
   * consommateur ; ré-émise automatiquement à chaque (re)connexion. Ne REÇOIT pas —
   * brancher {@link IRealtimeSocket.on} pour ça.
   */
  subscribe(channel: EventNames<Listen> | (string & {})): void;

  /** Désabonne un consommateur (ref-compté) : coupe le flux réseau au DERNIER. No-op si non suivi. */
  unsubscribe(channel: EventNames<Listen> | (string & {})): void;

  /**
   * Branche un handler sur un canal (réception). Renvoie un `dispose` (désabonnement
   * local). Plusieurs handlers par canal autorisés.
   */
  on<K extends string>(
    channel: K,
    handler: K extends EventNames<Listen>
      ? (payload: EventPayload<Listen, K>) => void
      : RealtimeHandler,
  ): () => void;

  /** Retire un handler d'un canal. */
  off<K extends string>(
    channel: K,
    handler: K extends EventNames<Listen>
      ? (payload: EventPayload<Listen, K>) => void
      : RealtimeHandler,
  ): void;

  /**
   * Émet sur un canal (one-way, pas de réponse). Côté client → notification au serveur ;
   * côté serveur → fan-out aux abonnés via le hub (+ backplane). No-op si non connecté.
   */
  publish<K extends string>(
    channel: K,
    payload?: K extends EventNames<Emit> ? EventPayload<Emit, K> : unknown,
  ): void;

  /** RPC corrélé — `Promise` résolue avec le `result` (rejette sur `error`/timeout). */
  request<K extends string, T = unknown>(
    method: K,
    params?: K extends ActionNames<Actions>
      ? ActionParams<Actions, K>
      : unknown,
    timeoutMs?: number,
  ): Promise<K extends ActionNames<Actions> ? ActionResult<Actions, K> : T>;

  /**
   * Vue par-canal — voir {@link IRealtimeChannel}. Fine liaison sur les primitives
   * ci-dessus ; forme cible pour SIP/bridge/proxy et les concerns par-canal.
   */
  channel(name: string): IRealtimeChannel;

  /** Snapshot des compteurs par canal (refs internes — à LIRE, pas à muter). */
  getStats(): IChannelStats[];

  /** Compteurs d'un canal précis (== method JSON-RPC) ou `undefined`. */
  getChannelStats(channel: string): IChannelStats | undefined;

  /** Canaux actuellement abonnés (≥ 1 consommateur). Lecture seule. */
  readonly subscribedChannels: string[];
}

export default IRealtimeSocket;

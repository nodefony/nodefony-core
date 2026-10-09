/**
 * `nodefony/react` — bindings React **fins** du client temps réel isomorphe.
 *
 * Adapte le {@link NodefonySocket} (agnostique : `on()`/`emit()`/`state`) à la
 * réactivité React, sans MobX ni glue à recopier dans chaque app. Réutilisable
 * par Studio ET n'importe quelle app React servie par `@nodefony/frontend`.
 *
 * Principe : des hooks **ciblés et composables** (un hook = une responsabilité),
 * tous **marqués `nodefony`** (`useNodefony*`) pour les repérer d'un coup d'œil.
 * Pas un god-hook : on compose ce dont la vue a besoin. `react` est une peerDep
 * **optionnelle** (ce module n'est tiré que si on importe `nodefony/react`).
 * Aucun JSX (provider via `createElement`) → le build Core ne dépend pas d'un
 * transform JSX.
 *
 * **Ce fichier ne contient PLUS de règle temps réel.** Souscrire, tenir un
 * dernier reçu, borner un anneau, décoder le format coalescé du journal, ne
 * jamais couper une socket partagée : tout cela vit dans le socle agnostique
 * `nodefony/client` (`observe*`, `connectShared`), que les liaisons Vue, Angular
 * et Svelte consomment à l'identique. Ici ne reste que la traduction *rappel +
 * libération → réactivité React* — la seule chose qu'une liaison a le droit de
 * contenir. Un hook qui réencoderait une règle la ferait diverger des trois
 * autres fronts, en silence.
 *
 * L'app reste maîtresse du **cycle de connexion** (`client.connect()`), montée
 * une fois (ex. au shell). Les hooks ne gèrent QUE l'abonnement aux canaux.
 *
 * @module nodefony/react
 */
import * as React from "react";
// `NodefonySocket` n'est importé qu'en TYPE : la fabrication de la socket
// partagée passe par `connectShared` (socle agnostique), qui porte la précédence
// `kernel` > `client` > `url` et le cycle de connexion — la même fonction que celle
// appelée par les trois autres fronts.
import type { NodefonySocket } from "../realtime/NodefonySocket";
import type {
  RealtimeState,
  NodefonyNotice,
  RealtimeIdentity,
  MessageStats,
} from "../realtime/NodefonySocket";
import type { BindAdaptiveOptions } from "../realtime/AdaptiveRate";
import type {
  ClientIdentity,
  ClientKernelState,
  IClientKernel,
} from "../IClientKernel";
import {
  connectShared,
  observeChannel,
  observeState,
  observeChannelStats,
  observeIdentity,
  observeKernelState,
  observeKernelIdentity,
  observeNotices,
  observeNoticeLog,
  observeSyslog,
  observeSnapshot,
  adaptiveRebindKey,
  type ObserveSyslogOptions,
  type ObserveNoticeLogOptions,
  type SocketSnapshot,
} from "../realtime/observe";
import {
  initialSseSnapshot,
  observeSse,
  sseRebindKey,
  type ObserveSseOptions,
  type SseSnapshot,
} from "../sse/observe";

// Convention de cadence partagée client↔serveur — réexportée ici pour que le front
// fabrique ses canaux cadencés depuis le même subpath que les hooks canal.
export {
  rateChannel,
  parseRate,
  isRateChannel,
} from "../../realtime/channelRate";
export type { RateBounds } from "../../realtime/channelRate";

// Les hooks RENDENT ces types (`useNodefonyIdentity` → `RealtimeIdentity`).
// Sans ré-export, le consommateur ne peut pas NOMMER ce qu'il reçoit :
// l'inférence marche, la déclaration explicite lève TS2459.
export type {
  RealtimeIdentity,
  RealtimeState,
  NodefonyNotice,
} from "../realtime/NodefonySocket";
export type { SocketSnapshot } from "../realtime/observe";
export type { SseSnapshot, ObserveSseOptions } from "../sse/observe";
export type { ISseEvent } from "../sse/SseParser";
export type {
  ClientIdentity,
  ClientKernelState,
  IClientKernel,
} from "../IClientKernel";

const NodefonyContext = React.createContext<NodefonySocket | null>(null);
/** Le noyau client fourni au Provider — `null` quand l'application n'en compose pas. */
const NodefonyKernelContext = React.createContext<IClientKernel | null>(null);

export interface NodefonyProviderProps {
  /**
   * Le noyau client de l'application — la voie COMPOSÉE. La socket est celle
   * qu'il a composée (`kernel.get("realtime")`), et le noyau devient lisible
   * par {@link useNodefonyKernel} dans tout le sous-arbre.
   *
   * Fourni, il l'emporte sur `client` et `url`, et le Provider ne touche pas
   * au cycle : c'est le noyau qui ouvre sa socket (`connectOnBoot`,
   * `setIdentity`).
   */
  kernel?: IClientKernel;
  /**
   * Adresse du serveur temps réel — la voie SIMPLE. Le Provider fabrique la
   * socket partagée pour cette URL et la connecte lui-même.
   *
   * Deux consommateurs qui donnent la même URL obtiennent la MÊME socket
   * ({@link NodefonySocket.shared}), donc une seule connexion réseau.
   */
  url?: string;
  /**
   * Socket déjà construite — la voie AVANCÉE, quand l'application possède son
   * cycle de connexion (c'est le cas de la console d'administration, qui
   * re-négocie la socket sur changement d'identité).
   *
   * Fournie, elle l'emporte sur `url` et le Provider ne touche pas au cycle :
   * ni `connect`, ni `disconnect`.
   */
  client?: NodefonySocket;
  children?: React.ReactNode;
}

/**
 * Injecte le client temps réel Nodefony dans le sous-arbre. À monter une fois,
 * au-dessus des composants qui consomment les hooks `useNodefony*`.
 *
 * @example Cas simple — deux concepts, ce Provider et un hook :
 * ```tsx
 * <NodefonyProvider url="/api/live/realtime">
 *   <Chat />
 * </NodefonyProvider>
 * ```
 *
 * @example Cas avancé — l'application possède le cycle de connexion :
 * ```tsx
 * <NodefonyProvider client={monClient}>…</NodefonyProvider>
 * ```
 *
 * @example Cas composé — l'application a un noyau client :
 * ```tsx
 * <NodefonyProvider kernel={kernel}>…</NodefonyProvider>
 * ```
 */
export function NodefonyProvider(
  props: NodefonyProviderProps,
): React.ReactElement {
  const { url, client, kernel } = props;
  // `connectShared` dédoublonne par URL absolue : deux Providers de même URL
  // rendent la même instance. Le `useMemo` n'est donc pas là pour la justesse
  // mais pour éviter la résolution d'URL à chaque rendu.
  const connection = React.useMemo(
    () => connectShared({ url, client, kernel }),
    [client, url, kernel],
  );
  // `start()` est idempotent, avale le rejet, et ne touche PAS au cycle d'une
  // socket fournie — les trois règles vivent dans le socle, pas ici. Toujours
  // pas de `disconnect()` au démontage : la connexion appartient à la PAGE.
  React.useEffect(() => connection.start(), [connection]);
  return React.createElement(
    NodefonyKernelContext.Provider,
    { value: kernel ?? null },
    React.createElement(
      NodefonyContext.Provider,
      { value: connection.socket },
      props.children,
    ),
  );
}

/**
 * `useNodefonyKernel()` — le noyau client fourni au `<NodefonyProvider kernel>`,
 * ou `null` quand l'application n'en compose pas. Référence stable ; pour l'état
 * réactif, prendre {@link useNodefonyKernelState} et
 * {@link useNodefonyKernelIdentity}.
 *
 * C'est la porte d'un composant profond vers `kernel.setIdentity()` : déclarer
 * une connexion sans que l'application écrive son propre contexte.
 */
export function useNodefonyKernel(): IClientKernel | null {
  return React.useContext(NodefonyKernelContext);
}

/** Abonnement inerte, pour la branche « aucun noyau fourni ». */
const noKernelSubscription = (): (() => void) => () => {};
const noKernelSnapshot = (): null => null;

/**
 * `useNodefonyKernelState()` — l'état du noyau (`created` → `booting` →
 * `ready` → `terminated`), ou `null` sans noyau fourni. Re-render uniquement
 * aux transitions.
 */
export function useNodefonyKernelState(): ClientKernelState | null {
  const kernel = useNodefonyKernel();
  return React.useSyncExternalStore(
    kernel
      ? (cb: () => void) => observeKernelState(kernel, () => cb())
      : noKernelSubscription,
    kernel ? () => kernel.state : noKernelSnapshot,
    kernel ? () => kernel.state : noKernelSnapshot,
  );
}

/**
 * `useNodefonyKernelIdentity()` — l'identité DÉCLARÉE au noyau par
 * l'application (`setIdentity`), ou `null` hors session ou sans noyau fourni.
 * Re-render à chaque changement de COMPTE — un profil rafraîchi à clé
 * inchangée ne réveille personne (règle d'identité du noyau).
 *
 * À ne pas confondre avec {@link useNodefonyIdentity}, l'identité RÉSOLUE par
 * le serveur au welcome de la socket.
 */
export function useNodefonyKernelIdentity(): ClientIdentity | null {
  const kernel = useNodefonyKernel();
  return React.useSyncExternalStore(
    kernel
      ? (cb: () => void) => observeKernelIdentity(kernel, () => cb())
      : noKernelSubscription,
    kernel ? () => kernel.identity : noKernelSnapshot,
    kernel ? () => kernel.identity : noKernelSnapshot,
  );
}

/**
 * `useNodefony()` — le client temps réel brut (hub : canaux, syslog, stats…).
 * Tête de gondole + échappatoire pour les cas avancés. Référence stable (pas de
 * re-render) ; pour l'état réactif, utiliser les hooks dédiés ci-dessous.
 *
 * @throws si appelé hors d'un `<NodefonyProvider>`.
 */
export function useNodefony(): NodefonySocket {
  const client = React.useContext(NodefonyContext);
  if (!client) {
    throw new Error(
      "useNodefony() doit être utilisé dans un <NodefonyProvider>.",
    );
  }
  return client;
}

/**
 * `useNodefonyState()` — état de la connexion (`"connected" | "reconnecting" | …`).
 * `useSyncExternalStore` : re-render UNIQUEMENT au changement d'état (snapshot
 * primitif, sans tearing en mode concurrent).
 *
 * Branché sur `onState` — la porte publique — et non sur le nom de l'événement
 * local, qui n'a pas à sortir du client.
 */
export function useNodefonyState(): RealtimeState {
  const client = useNodefony();
  return React.useSyncExternalStore(
    // `observeState` émet la valeur courante à la souscription : React compare
    // alors le snapshot, le trouve inchangé, et ne rend pas pour rien.
    (cb) => observeState(client, () => cb()),
    () => client.state,
    () => client.state,
  );
}

/**
 * `useNodefonyIdentity()` — l'**identité résolue** de la connexion, annoncée par
 * le serveur au `realtime:welcome` (`authenticated`, `roles`, `userIdentifier`,
 * `scopes`). `null` tant qu'aucun welcome n'a été reçu ; une fois reçu, un
 * visiteur anonyme a `authenticated: false`. `useSyncExternalStore` → re-render
 * uniquement quand l'identité change ((re)welcome ou logout). Brique du gating
 * front : `authenticated:false` → écran login, **sans** route `/auth/me`.
 */
export function useNodefonyIdentity(): RealtimeIdentity | null {
  const client = useNodefony();
  return React.useSyncExternalStore(
    (cb) => observeIdentity(client, () => cb()),
    () => client.identity,
    () => client.identity,
  );
}

/**
 * `useNodefonyChannel()` — s'abonne à un canal pub/sub : `onMessage` est appelé
 * à chaque message. Le socle apparie subscribe/unsubscribe serveur (ref-comptés)
 * et le re-subscribe au reconnect. Le handler peut changer à chaque render sans
 * re-déclencher l'abonnement (capturé via ref) ; passer `deps` si le canal
 * effectif dépend d'autres valeurs.
 */
export function useNodefonyChannel(
  channel: string,
  onMessage: (payload: unknown) => void,
  deps: React.DependencyList = [],
): void {
  const client = useNodefony();
  const handlerRef = React.useRef(onMessage);
  handlerRef.current = onMessage;

  // oxlint-disable react-hooks/exhaustive-deps -- API publique : `deps` vient de l'APPELANT (comme pour useEffect), une liste dynamique qu'aucune analyse statique ne peut vérifier
  React.useEffect(() => {
    return observeChannel(client, channel, (payload) =>
      handlerRef.current(payload),
    );
    // `deps` étend volontairement la liste (canal dynamique).
  }, [client, channel, ...deps]);
  // oxlint-enable react-hooks/exhaustive-deps
}

/**
 * `useNodefonyChannelData()` — la **dernière valeur** reçue sur un canal (cas le
 * plus courant : dernière mesure d'un flux de stats). `null` tant que rien n'est
 * arrivé.
 */
export function useNodefonyChannelData<T = unknown>(
  channel: string,
  initial: T | null = null,
): T | null {
  const [data, setData] = React.useState<T | null>(initial);
  useNodefonyChannel(channel, (payload) => setData(payload as T), []);
  return data;
}

/** Réglages adaptatifs du hook (cadence désirée fixée à part par `intervalMs`). */
export type AdaptiveChannelHookOptions = Omit<
  BindAdaptiveOptions,
  "intervalMs" | "onRate"
>;

/** Résultat de {@link useNodefonyAdaptiveChannelData} : dernière valeur + cadence réelle. */
export interface AdaptiveChannelData<T> {
  /** Dernière valeur reçue, `null` tant que rien n'est arrivé. */
  data: T | null;
  /** Cadence effective courante (ms) — bouge avec l'AIMD, à afficher en badge. */
  intervalMs: number;
}

/**
 * `useNodefonyAdaptiveChannel()` — équivalent **handler-based** de {@link useNodefonyChannel}
 * mais en **cadence adaptative** (AIMD client-driven, cf {@link NodefonySocket.adaptiveChannel}) :
 * la lib recule la cadence sous famine puis la remonte quand c'est sain. `onMessage` reçoit
 * chaque frame (handler riche autorisé) ; **renvoie la cadence effective** (ms) pour un badge.
 * Primitif commun à tous les dashboards d'état (Supervision, ORM…) → **logique live identique**.
 * Réservé aux canaux d'ÉTAT (latest-wins). Réglage `enabled` (off = abonnement fixe).
 *
 * Le ré-abonnement n'est relancé que si `base`, `desiredMs`, `enabled` ou `deps` changent —
 * la clé vient de {@link adaptiveRebindKey}, la MÊME que celle des autres liaisons (le
 * handler + les `opts` sont capturés par ref → identité instable sans re-bind).
 */
export function useNodefonyAdaptiveChannel(
  base: string,
  onMessage: (payload: unknown) => void,
  desiredMs: number,
  opts: AdaptiveChannelHookOptions = {},
  deps: React.DependencyList = [],
): number {
  const client = useNodefony();
  const handlerRef = React.useRef(onMessage);
  handlerRef.current = onMessage;
  const optsRef = React.useRef(opts);
  optsRef.current = opts;
  const [intervalMs, setIntervalMs] = React.useState<number>(desiredMs);
  // Primitif → re-bind au toggle adaptatif ⇄ fixe (opts capturées par ref ne le font pas).
  const enabled = opts.enabled !== false;
  const rebindKey = adaptiveRebindKey(base, desiredMs, enabled);

  // oxlint-disable react-hooks/exhaustive-deps -- `rebindKey` = adaptiveRebindKey(base, desiredMs, enabled), la clé de re-liaison PARTAGÉE par toutes les liaisons ; `deps` vient de l'appelant
  React.useEffect(() => {
    const binding = client.adaptiveChannel(
      base,
      (...args: unknown[]) => handlerRef.current(args[0]),
      {
        ...optsRef.current,
        intervalMs: desiredMs,
        enabled,
        onRate: (ms) => setIntervalMs(ms),
      },
    );
    return () => binding.dispose();
  }, [client, rebindKey, ...deps]);
  // oxlint-enable react-hooks/exhaustive-deps

  return intervalMs;
}

/**
 * `useNodefonyAdaptiveChannelData()` — comme {@link useNodefonyChannelData} mais en cadence
 * adaptative. Mince surcouche de {@link useNodefonyAdaptiveChannel} : garde la **dernière
 * valeur** reçue + renvoie la cadence effective (badge UI). Réservé aux canaux d'ÉTAT.
 */
export function useNodefonyAdaptiveChannelData<T = unknown>(
  base: string,
  desiredMs: number,
  opts: AdaptiveChannelHookOptions = {},
  deps: React.DependencyList = [],
): AdaptiveChannelData<T> {
  const [data, setData] = React.useState<T | null>(null);
  const intervalMs = useNodefonyAdaptiveChannel(
    base,
    (payload) => setData(payload as T),
    desiredMs,
    opts,
    deps,
  );
  return { data, intervalMs };
}

/**
 * Stats observées d'un canal (telles que calculées par le client Core).
 *
 * Alias du contrat isomorphe {@link MessageStats} : une copie locale de la forme
 * aurait divergé du jour où le client ajoute un compteur.
 */
export type ChannelStatsSnapshot = MessageStats;

/**
 * `useNodefonyChannelStats()` — stats live d'un canal (débit, série VU-mètre,
 * total). Source = le client Core (`getChannelStats`, échantillonné 1×/s).
 * Implémenté en `state`+effet (pas `useSyncExternalStore`) car le snapshot est
 * un objet recréé → la stabilité de référence requise par le store externe ne
 * tiendrait pas.
 */
export function useNodefonyChannelStats(
  channel: string,
): ChannelStatsSnapshot | null {
  const client = useNodefony();
  const [stats, setStats] = React.useState<ChannelStatsSnapshot | null>(null);
  React.useEffect(
    () => observeChannelStats(client, channel, setStats),
    [client, channel],
  );
  return stats;
}

/**
 * `useNodefonySnapshot()` — ce que la socket sait d'ELLE-MÊME : état, canaux
 * tenus, trames reçues, trames perdues, dernière trame. Rafraîchi par
 * l'échantillonneur déjà en place — aucune horloge de plus, aucune trame émise
 * pour mesurer.
 *
 * La donnée est au socle, la **boîte qui l'affiche** reste à chaque front : les
 * quatre vitrines lisaient ces cinq champs à la main, c'est-à-dire quatre
 * lectures qui divergeront.
 */
export function useNodefonySnapshot(): SocketSnapshot | null {
  const client = useNodefony();
  const [snapshot, setSnapshot] = React.useState<SocketSnapshot | null>(null);
  React.useEffect(() => observeSnapshot(client, setSnapshot), [client]);
  return snapshot;
}

export interface UseSyslogOptions {
  /** Taille max du ring buffer (anciennes lignes évincées). Défaut 500. */
  max?: number;
  /** Ne garder que ces sévérités (ex `["ERROR","CRITIC"]`). Toutes par défaut. */
  severities?: string[];
  /** Canal source. Défaut `"nodefony:syslog"`. */
  channel?: string;
}

/**
 * `useNodefonySyslog()` — flux syslog prêt à l'emploi : ring buffer borné +
 * filtre de sévérité. Le format **coalescé** du canal (`{ logs: Pdu[], dropped }`),
 * l'entrée unique, la taille de l'anneau et le canal par défaut viennent du
 * socle ({@link observeSyslog}) : ce hook n'en connaît aucun. Brique de la page
 * Logs — un seul appel remplace l'effet + le buffer manuels.
 */
export function useNodefonySyslog(opts: UseSyslogOptions = {}): unknown[] {
  const { max, severities, channel } = opts;
  const client = useNodefony();
  const sevKey = severities ? severities.join(",") : "";
  const [entries, setEntries] = React.useState<unknown[]>([]);

  // oxlint-disable react-hooks/exhaustive-deps -- `severities` est recréé à chaque rendu : `sevKey` le résume, et un même `sevKey` garantit le même contenu
  React.useEffect(() => {
    const options: ObserveSyslogOptions = { max, severities, channel };
    return observeSyslog(client, setEntries, options);
    // `severities` est un tableau recréé à chaque rendu : la clé le résume.
  }, [client, channel, max, sevKey]);
  // oxlint-enable react-hooks/exhaustive-deps

  return entries;
}

/**
 * `useNodefonyNotifications()` — s'abonne au flux de **notices normalisées** du
 * client : criticités qui cassent le temps réel (close codes RFC 6455 interprétés),
 * erreurs serveur poussées, rétablissement de connexion. `onNotice` est appelé
 * pour CHAQUE notice → brancher un centre de notifications (snackbar). Le handler
 * peut changer à chaque render sans re-déclencher l'abonnement (capturé via ref).
 *
 * À monter **une seule fois** (shell de l'app) pour ne pas dupliquer les toasts.
 */
export function useNodefonyNotifications(
  onNotice: (notice: NodefonyNotice) => void,
  deps: React.DependencyList = [],
): void {
  const client = useNodefony();
  const handlerRef = React.useRef(onNotice);
  handlerRef.current = onNotice;
  // oxlint-disable react-hooks/exhaustive-deps -- API publique : `deps` vient de l'APPELANT (comme pour useEffect)
  React.useEffect(() => {
    return observeNotices(client, (notice) => handlerRef.current(notice));
  }, [client, ...deps]);
  // oxlint-enable react-hooks/exhaustive-deps
}

export interface UseNoticeLogOptions {
  /** Taille max du ring (anciennes notices évincées). Défaut 50. */
  max?: number;
  /** Ne garder que ces sources (ex `["realtime"]`). Toutes par défaut. */
  sources?: NodefonyNotice["source"][];
}

/**
 * `useNodefonyNoticeLog()` — ring buffer borné des dernières notices, filtrable
 * par source. Brique du hub temps réel (« incidents temps réel ») : un historique
 * léger des criticités realtime, distinct des toasts éphémères. La taille de
 * l'anneau et le filtrage viennent du socle ({@link observeNoticeLog}).
 */
export function useNodefonyNoticeLog(
  opts: UseNoticeLogOptions = {},
): NodefonyNotice[] {
  const { max, sources } = opts;
  const client = useNodefony();
  const srcKey = sources ? sources.join(",") : "";
  const [notices, setNotices] = React.useState<NodefonyNotice[]>([]);

  // oxlint-disable react-hooks/exhaustive-deps -- `sources` est recréé à chaque rendu : `srcKey` le résume, et un même `srcKey` garantit le même contenu
  React.useEffect(() => {
    const options: ObserveNoticeLogOptions = { max, sources };
    return observeNoticeLog(client, setNotices, options);
    // `sources` est un tableau recréé à chaque rendu : la clé le résume.
  }, [client, max, srcKey]);
  // oxlint-enable react-hooks/exhaustive-deps

  return notices;
}

/**
 * `useNodefonySse()` — ouvre un flux SSE au montage, rend son état
 * (`readyState`, dernier événement, erreur), et le FERME au démontage.
 *
 * Indépendant du Provider : un flux n'est pas la socket partagée, c'est la
 * réponse à une requête — ce hook marche donc dans n'importe quel composant.
 * Une adresse `null` n'ouvre rien (écoute suspendue sans démonter).
 *
 * Le flux n'est rouvert que si l'adresse ou les types écoutés changent : un
 * `onEvent` ou un objet d'options recréé à chaque rendu ne coupe rien. Pour
 * tenir un journal, accumuler dans `onEvent` — l'état ne garde que le dernier
 * événement, et React regroupe les rendus d'un même tour.
 *
 * @example
 * ```tsx
 * const flux = useNodefonySse("/progress/run", {
 *   events: ["step"],
 *   onEvent: (e) => setSteps((s) => [...s, JSON.parse(e.data)]),
 * });
 * ```
 */
export function useNodefonySse(
  url: string | null,
  options: ObserveSseOptions = {},
): SseSnapshot {
  const optionsRef = React.useRef(options);
  optionsRef.current = options;
  const [snapshot, setSnapshot] = React.useState<SseSnapshot>(() =>
    initialSseSnapshot(url),
  );
  const key = sseRebindKey(url, options);

  // oxlint-disable react-hooks/exhaustive-deps -- `key` résume l'adresse et les types écoutés ; les autres réglages sont lus à l'ouverture, et `onEvent` passe par la ref
  React.useEffect(
    () =>
      observeSse(url, setSnapshot, {
        ...optionsRef.current,
        onEvent: (event) => optionsRef.current.onEvent?.(event),
      }),
    [key],
  );
  // oxlint-enable react-hooks/exhaustive-deps

  return snapshot;
}

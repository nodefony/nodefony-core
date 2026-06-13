/**
 * `nodefony/react` — bindings React **fins** du client temps réel isomorphe.
 *
 * Adapte le {@link RealtimeClient} (agnostique : `on()`/`emit()`/`state`) à la
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
 * L'app reste maîtresse du **cycle de connexion** (`client.connect()`), montée
 * une fois (ex. au shell). Les hooks ne gèrent QUE l'abonnement aux canaux.
 *
 * @module nodefony/react
 */
import * as React from "react";
import type {
  RealtimeClient,
  RealtimeState,
  NodefonyNotice,
  RealtimeIdentity,
} from "../realtime/RealtimeClient";
import type { BindAdaptiveOptions } from "../realtime/AdaptiveRate";

// Convention de cadence partagée client↔serveur — réexportée ici pour que le front
// fabrique ses canaux cadencés depuis le même subpath que les hooks canal.
export {
  rateChannel,
  parseRate,
  isRateChannel,
} from "../../realtime/channelRate";
export type { RateBounds } from "../../realtime/channelRate";

const NodefonyContext = React.createContext<RealtimeClient | null>(null);

export interface NodefonyProviderProps {
  /** Instance partagée (dérivée de l'origine par l'app, cf RootStore Studio). */
  client: RealtimeClient;
  children?: React.ReactNode;
}

/**
 * Injecte le client temps réel Nodefony dans le sous-arbre. À monter une fois,
 * au-dessus des composants qui consomment les hooks `useNodefony*`.
 */
export function NodefonyProvider(
  props: NodefonyProviderProps,
): React.ReactElement {
  return React.createElement(
    NodefonyContext.Provider,
    { value: props.client },
    props.children,
  );
}

/**
 * `useNodefony()` — le client temps réel brut (hub : canaux, syslog, stats…).
 * Tête de gondole + échappatoire pour les cas avancés. Référence stable (pas de
 * re-render) ; pour l'état réactif, utiliser les hooks dédiés ci-dessous.
 *
 * @throws si appelé hors d'un `<NodefonyProvider>`.
 */
export function useNodefony(): RealtimeClient {
  const client = React.useContext(NodefonyContext);
  if (!client) {
    throw new Error(
      "useNodefony() doit être utilisé dans un <NodefonyProvider>.",
    );
  }
  return client;
}

// Ref-counting des abonnements + re-subscribe au reconnect = **dans le client**
// (`RealtimeClient.subscribe/unsubscribe`, autorité unique partagée avec le store
// MobX Studio). Le binding n'appelle que ces méthodes → deux composants (ou un
// composant + le store) sur le même canal ne se coupent plus l'un l'autre.

/**
 * `useNodefonyState()` — état de la connexion (`"connected" | "reconnecting" | …`).
 * `useSyncExternalStore` : re-render UNIQUEMENT au changement d'état (snapshot
 * primitif, sans tearing en mode concurrent).
 */
export function useNodefonyState(): RealtimeState {
  const client = useNodefony();
  return React.useSyncExternalStore(
    (cb) => client.on("__state__", cb),
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
    (cb) => client.onIdentity(() => cb()),
    () => client.identity,
    () => client.identity,
  );
}

/**
 * `useNodefonyChannel()` — s'abonne à un canal pub/sub : `onMessage` est appelé
 * à chaque message. Gère subscribe/unsubscribe serveur (ref-comptés) +
 * re-subscribe au reconnect. Le handler peut changer à chaque render sans
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

  React.useEffect(() => {
    const dispose = client.on(channel, (...args: unknown[]) =>
      handlerRef.current(args[0]),
    );
    client.subscribe(channel);
    return () => {
      dispose();
      client.unsubscribe(channel);
    };
    // `deps` étend volontairement la liste (canal dynamique).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, channel, ...deps]);
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
 * mais en **cadence adaptative** (AIMD client-driven, cf {@link RealtimeClient.adaptiveChannel}) :
 * la lib recule la cadence sous famine puis la remonte quand c'est sain. `onMessage` reçoit
 * chaque frame (handler riche autorisé) ; **renvoie la cadence effective** (ms) pour un badge.
 * Primitif commun à tous les dashboards d'état (Supervision, ORM…) → **logique live identique**.
 * Réservé aux canaux d'ÉTAT (latest-wins). Réglage `enabled` (off = abonnement fixe).
 *
 * Le ré-abonnement n'est relancé que si `base`, `desiredMs`, `enabled` ou `deps` changent
 * (le handler + les `opts` sont capturés par ref → identité instable sans re-bind).
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, base, desiredMs, enabled, ...deps]);

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

/** Stats observées d'un canal (telles que calculées par le client Core). */
export interface ChannelStatsSnapshot {
  msgCount: number;
  lastMessage: number | null;
  rate: number;
  series: number[];
}

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
  const read = (): ChannelStatsSnapshot | null =>
    (client.getChannelStats(channel) as ChannelStatsSnapshot | undefined) ??
    null;
  const [stats, setStats] = React.useState<ChannelStatsSnapshot | null>(read);
  React.useEffect(() => {
    const dispose = client.on("__stats__", () => setStats(read()));
    return dispose;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, channel]);
  return stats;
}

export interface UseSyslogOptions {
  /** Taille max du ring buffer (anciennes lignes évincées). Défaut 500. */
  max?: number;
  /** Ne garder que ces sévérités (ex `["ERROR","CRITIC"]`). Toutes par défaut. */
  severities?: string[];
  /** Canal source. Défaut `"syslog:stream"`. */
  channel?: string;
}

/**
 * `useNodefonySyslog()` — flux syslog prêt à l'emploi : ring buffer borné +
 * filtre de sévérité. Gère le format **coalescé** du canal
 * (`{ logs: Pdu[], dropped }`) ET le Pdu unique. Brique de la page Logs — un
 * seul appel remplace l'effet + le buffer manuels.
 */
export function useNodefonySyslog(opts: UseSyslogOptions = {}): unknown[] {
  const { max = 500, severities, channel = "syslog:stream" } = opts;
  const sevKey = severities ? severities.join(",") : "";
  const [entries, setEntries] = React.useState<unknown[]>([]);

  useNodefonyChannel(
    channel,
    (payload) => {
      const rec = payload as { logs?: unknown[] } | null;
      const incoming = rec && Array.isArray(rec.logs) ? rec.logs : [payload];
      const filtered = severities
        ? incoming.filter((p) =>
            severities.includes((p as { severity?: string }).severity ?? ""),
          )
        : incoming;
      if (filtered.length === 0) return;
      setEntries((prev) => {
        const next = prev.concat(filtered);
        return next.length > max ? next.slice(-max) : next;
      });
    },
    [channel, max, sevKey],
  );

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
  React.useEffect(() => {
    return client.onNotice((notice) => handlerRef.current(notice));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, ...deps]);
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
 * léger des criticités realtime, distinct des toasts éphémères.
 */
export function useNodefonyNoticeLog(
  opts: UseNoticeLogOptions = {},
): NodefonyNotice[] {
  const { max = 50, sources } = opts;
  const srcKey = sources ? sources.join(",") : "";
  const [notices, setNotices] = React.useState<NodefonyNotice[]>([]);
  useNodefonyNotifications(
    (notice) => {
      if (sources && !sources.includes(notice.source)) return;
      setNotices((prev) => {
        const next = prev.concat(notice);
        return next.length > max ? next.slice(-max) : next;
      });
    },
    [max, srcKey],
  );
  return notices;
}

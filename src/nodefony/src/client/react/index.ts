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
import type { RealtimeClient, RealtimeState } from "../realtime/RealtimeClient";

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
export function NodefonyProvider(props: NodefonyProviderProps): React.ReactElement {
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
    throw new Error("useNodefony() doit être utilisé dans un <NodefonyProvider>.");
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
    (client.getChannelStats(channel) as ChannelStatsSnapshot | undefined) ?? null;
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

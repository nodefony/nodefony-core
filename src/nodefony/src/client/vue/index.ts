/**
 * `nodefony/vue` — liaisons **Vue 3** du client temps réel isomorphe.
 *
 * Adapte le {@link RealtimeClient} (agnostique : `on()`/`emit()`/`state`) à la
 * réactivité de Vue, sans glue à recopier dans chaque application. Le pendant
 * exact de `nodefony/react` : même surface, mêmes noms, mêmes garanties — seule
 * la traduction vers la réactivité change.
 *
 * **Ce fichier ne contient AUCUNE règle temps réel.** Souscrire, tenir un
 * dernier reçu, borner un anneau, décoder le format coalescé du journal, ne
 * jamais couper une socket partagée : tout cela vit dans le socle agnostique
 * `nodefony/client` (`observe*`, `connectShared`), que les liaisons React,
 * Angular et Svelte consomment à l'identique. Ici ne reste que la traduction
 * *rappel + libération → réactivité Vue* — la seule chose qu'une liaison a le
 * droit de contenir. Un composable qui réencoderait une règle la ferait
 * diverger des trois autres fronts, en silence.
 *
 * Trois particularités de Vue que React ne montre pas, et qui sont la raison
 * d'être de ce fichier :
 *
 *  1. **La politique s'écrit en PLUGIN**, pas en composant enveloppant :
 *     `app.use(nodefonyVue, { url })`. C'est le vocabulaire du framework.
 *  2. **Le client n'entre JAMAIS dans un `ref()`** — il serait enveloppé dans
 *     un proxy réactif profond, qui casse les égalités de référence et fait
 *     payer une interception à chaque accès. Il est posé `markRaw`.
 *  3. **La libération passe par `onScopeDispose`**, pas par `onUnmounted` :
 *     c'est le seul des deux qui couvre aussi les portées d'effet créées hors
 *     composant (`effectScope()`), où un abonnement fuirait sans un mot.
 *
 * `vue` est une peerDep **optionnelle** : ce module n'est tiré que si on
 * importe `nodefony/vue`.
 *
 * @example La page entière, en deux concepts :
 * ```ts
 * // main.ts
 * createApp(App).use(nodefonyVue, { url: "/api/live/realtime" }).mount("#app");
 * ```
 * ```vue
 * <script setup lang="ts">
 * import { useNodefonyChannelData, useNodefonyState } from "nodefony/vue";
 * const etat = useNodefonyState();
 * const dernier = useNodefonyChannelData<Evenement>("live:events");
 * </script>
 * ```
 *
 * @module nodefony/vue
 */
import {
  getCurrentScope,
  inject,
  markRaw,
  onScopeDispose,
  shallowRef,
  toValue,
  watch,
  type App,
  type InjectionKey,
  type MaybeRefOrGetter,
  type Plugin,
  type Ref,
} from "vue";
// `RealtimeClient` n'est importé qu'en TYPE : la fabrication de la socket
// partagée passe par `connectShared` (socle agnostique), qui porte la précédence
// `client` sur `url` et le cycle de connexion — la même fonction que celle
// appelée par les trois autres fronts.
import type { RealtimeClient } from "../realtime/RealtimeClient";
import type {
  MessageStats,
  NodefonyNotice,
  RealtimeIdentity,
  RealtimeState,
} from "../realtime/RealtimeClient";
import type { BindAdaptiveOptions } from "../realtime/AdaptiveRate";
import {
  adaptiveRebindKey,
  connectShared,
  observeChannel,
  observeChannelStats,
  observeIdentity,
  observeNoticeLog,
  observeNotices,
  observeSnapshot,
  observeState,
  observeSyslog,
  type Dispose,
  type ObserveNoticeLogOptions,
  type ObserveSyslogOptions,
  type SocketSnapshot,
} from "../realtime/observe";

// Convention de cadence partagée client↔serveur — réexportée ici pour que le
// front fabrique ses canaux cadencés depuis le même subpath que les composables.
export {
  rateChannel,
  parseRate,
  isRateChannel,
} from "../../realtime/channelRate";
export type { RateBounds } from "../../realtime/channelRate";

// Les composables RENDENT ces types (`useNodefonyIdentity` → `RealtimeIdentity`).
// Sans ré-export, le consommateur ne peut pas NOMMER ce qu'il reçoit :
// l'inférence marche, la déclaration explicite lève TS2459.
export type {
  RealtimeIdentity,
  RealtimeState,
  NodefonyNotice,
} from "../realtime/RealtimeClient";
export type { SocketSnapshot } from "../realtime/observe";

/**
 * La clé sous laquelle le plugin fournit la socket.
 *
 * Exportée pour le cas légitime où un sous-arbre doit parler à une AUTRE
 * socket que celle de l'application : `provide(nodefonyClientKey, uneAutre)`
 * dans le composant parent suffit, et les composables du sous-arbre suivent.
 */
export const nodefonyClientKey: InjectionKey<RealtimeClient> =
  Symbol("nodefony:realtime");

/** Réglages du plugin — l'un des deux au moins doit être donné. */
export interface NodefonyVueOptions {
  /**
   * Adresse du serveur temps réel — la voie SIMPLE. Le plugin fabrique la
   * socket partagée pour cette URL et la connecte lui-même.
   *
   * Deux consommateurs qui donnent la même URL obtiennent la MÊME socket
   * ({@link RealtimeClient.shared}), donc une seule connexion réseau.
   */
  url?: string;
  /**
   * Socket déjà construite — la voie AVANCÉE, quand l'application possède son
   * cycle de connexion. Fournie, elle l'emporte sur `url` et le plugin ne
   * touche pas au cycle : ni `connect`, ni `disconnect`.
   */
  client?: RealtimeClient;
}

/**
 * Le plugin — à installer une fois, sur l'application.
 *
 * Il fait exactement deux choses : fournir la socket au sous-arbre, et lancer
 * la connexion. Il n'en coupe aucune : la connexion appartient à la PAGE, pas
 * à un composant, et `disconnect()` tranche les requêtes en vol des autres
 * consommateurs de la même socket partagée.
 *
 * @throws si ni `url` ni `client` n'est fourni — l'adresse dépend de
 *   l'application, et le framework n'en devine aucune (règle du socle : une
 *   adresse devinée marche en développement et se trompe en production).
 *
 * @example
 * ```ts
 * createApp(App).use(nodefonyVue, { url: "/api/live/realtime" }).mount("#app");
 * ```
 */
export const nodefonyVue: Plugin<[NodefonyVueOptions]> = {
  install(app: App, options: NodefonyVueOptions): void {
    const connection = connectShared(options);
    // `markRaw` : le client est un objet à état, avec des `Map` internes et des
    // comparaisons d'identité. Enveloppé dans un proxy réactif, il perdrait ses
    // égalités de référence et paierait une interception par accès — pour une
    // réactivité dont il n'a aucun besoin, ses changements passant par `on*`.
    app.provide(nodefonyClientKey, markRaw(connection.socket));
    // Idempotent, rejet avalé, et sans effet sur le cycle d'une socket fournie
    // — les trois règles vivent dans le socle, pas ici.
    connection.start();
  },
};

/**
 * `useNodefony()` — la socket brute (canaux, journal, statistiques…). Tête de
 * gondole et échappatoire pour les cas avancés ; pour de l'état réactif,
 * prendre les composables dédiés ci-dessous.
 *
 * @throws si le plugin n'est pas installé. Le socle REFUSE de deviner une
 *   adresse : retomber ici sur une socket partagée fabriquée à la volée
 *   donnerait une page qui marche en développement et parle au mauvais hôte
 *   en production — mieux vaut une erreur au premier rendu.
 */
export function useNodefony(): RealtimeClient {
  const client = inject(nodefonyClientKey, null);
  if (!client) {
    throw new Error(
      "useNodefony() : le plugin n'est pas installé — " +
        'app.use(nodefonyVue, { url: "/api/live/realtime" }).',
    );
  }
  return client;
}

/**
 * Exige une portée d'effet, et le dit AVANT que l'abonnement soit pris.
 *
 * Hors portée (appel au niveau d'un module, dans un `setTimeout`, dans un
 * gestionnaire d'événement), rien ne libérerait l'abonnement : la fuite ne se
 * voit pas à l'écran et le canal reste tenu jusqu'à la fermeture de l'onglet.
 * Le remède tient en une ligne côté appelant — `effectScope()` — encore
 * faut-il savoir qu'il manque.
 */
function requireScope(caller: string): void {
  if (!getCurrentScope()) {
    throw new Error(
      `${caller} doit être appelé dans un composant (setup) ou une portée ` +
        "d'effet : hors de là, l'abonnement ne serait jamais libéré. " +
        "Envelopper l'appel dans effectScope().",
    );
  }
}

/**
 * Le motif commun à tous les composables d'abonnement : brancher, rebrancher
 * quand la source change, libérer à la mort de la portée.
 *
 * La source est un {@link MaybeRefOrGetter} — un nom de canal peut être une
 * constante, une `ref`, ou dériver d'autres valeurs. C'est ce qui remplace, en
 * Vue, la liste de dépendances que React doit se faire passer à la main.
 */
function observeReactive<S>(
  caller: string,
  source: MaybeRefOrGetter<S>,
  wire: (value: S) => Dispose,
): void {
  requireScope(caller);
  let release: Dispose | null = null;
  const stop = watch(
    () => toValue(source),
    (value) => {
      release?.();
      release = wire(value);
    },
    { immediate: true },
  );
  onScopeDispose(() => {
    stop();
    release?.();
    release = null;
  });
}

/**
 * `useNodefonyState()` — l'état de la connexion (`"connected"`,
 * `"reconnecting"`, …), tenu à jour. Branché sur la porte publique `onState`,
 * jamais sur le nom de l'événement local, qui n'a pas à sortir du client.
 */
export function useNodefonyState(): Readonly<Ref<RealtimeState>> {
  const client = useNodefony();
  const state = shallowRef<RealtimeState>(client.state);
  observeReactive("useNodefonyState()", client, (socket) =>
    observeState(socket, (value) => {
      state.value = value;
    }),
  );
  return state;
}

/**
 * `useNodefonyIdentity()` — l'**identité résolue** de la connexion, annoncée
 * par le serveur au `realtime:welcome` (`authenticated`, `roles`,
 * `userIdentifier`, `scopes`). `null` tant qu'aucun welcome n'est arrivé ; une
 * fois reçu, un visiteur anonyme a `authenticated: false`. Brique du gating
 * front : `authenticated: false` → écran de connexion, **sans** appeler
 * `/auth/me`.
 */
export function useNodefonyIdentity(): Readonly<Ref<RealtimeIdentity | null>> {
  const client = useNodefony();
  const identity = shallowRef<RealtimeIdentity | null>(client.identity);
  observeReactive("useNodefonyIdentity()", client, (socket) =>
    observeIdentity(socket, (value) => {
      identity.value = value;
    }),
  );
  return identity;
}

/**
 * `useNodefonyChannel()` — s'abonne à un canal pub/sub : `onMessage` est appelé
 * à chaque message. Le socle apparie `subscribe`/`unsubscribe` côté serveur
 * (ref-comptés) et rejoue l'abonnement à chaque reconnexion.
 *
 * Le canal accepte une `ref` ou une fonction : l'abonnement suit alors la
 * valeur, en libérant l'ancien avant de prendre le nouveau.
 */
export function useNodefonyChannel(
  channel: MaybeRefOrGetter<string>,
  onMessage: (payload: unknown) => void,
): void {
  const client = useNodefony();
  observeReactive("useNodefonyChannel()", channel, (name) =>
    observeChannel(client, name, onMessage),
  );
}

/**
 * `useNodefonyChannelData()` — la **dernière valeur** reçue sur un canal (le
 * cas le plus courant : la dernière mesure d'un flux d'état). `null` tant que
 * rien n'est arrivé.
 */
export function useNodefonyChannelData<T = unknown>(
  channel: MaybeRefOrGetter<string>,
  initial: T | null = null,
): Readonly<Ref<T | null>> {
  const data = shallowRef<T | null>(initial);
  useNodefonyChannel(channel, (payload) => {
    data.value = payload as T;
  });
  return data;
}

/** Réglages adaptatifs (la cadence désirée se passe à part, en argument). */
export type AdaptiveChannelOptions = Omit<
  BindAdaptiveOptions,
  "intervalMs" | "onRate"
>;

/** Résultat de {@link useNodefonyAdaptiveChannelData} : valeur + cadence réelle. */
export interface AdaptiveChannelData<T> {
  /** Dernière valeur reçue, `null` tant que rien n'est arrivé. */
  data: Readonly<Ref<T | null>>;
  /** Cadence effective (ms) — bouge avec l'AIMD, à afficher en badge. */
  intervalMs: Readonly<Ref<number>>;
}

/**
 * `useNodefonyAdaptiveChannel()` — comme {@link useNodefonyChannel}, mais en
 * **cadence adaptative** (AIMD piloté par le client) : la cadence recule sous
 * famine puis remonte quand c'est sain, sans rien changer au serveur. Renvoie
 * la cadence effective, à afficher.
 *
 * Réservé aux canaux d'ÉTAT (latest-wins) : décimer un canal d'événements perd
 * des messages.
 *
 * Le ré-abonnement suit {@link adaptiveRebindKey} — la MÊME clé que les trois
 * autres liaisons, pour que les quatre rebranchent aux mêmes instants.
 */
export function useNodefonyAdaptiveChannel(
  base: MaybeRefOrGetter<string>,
  onMessage: (payload: unknown) => void,
  desiredMs: MaybeRefOrGetter<number>,
  options: AdaptiveChannelOptions = {},
): Readonly<Ref<number>> {
  const client = useNodefony();
  const cadence = shallowRef<number>(toValue(desiredMs));
  const enabled = options.enabled !== false;
  observeReactive(
    "useNodefonyAdaptiveChannel()",
    () => adaptiveRebindKey(toValue(base), toValue(desiredMs), enabled),
    () => {
      const binding = client.adaptiveChannel(
        toValue(base),
        (...args: unknown[]) => onMessage(args[0]),
        {
          ...options,
          intervalMs: toValue(desiredMs),
          enabled,
          onRate: (ms: number) => {
            cadence.value = ms;
          },
        },
      );
      return () => binding.dispose();
    },
  );
  return cadence;
}

/**
 * `useNodefonyAdaptiveChannelData()` — comme {@link useNodefonyChannelData},
 * mais en cadence adaptative. Mince surcouche de
 * {@link useNodefonyAdaptiveChannel} : garde la dernière valeur et rend la
 * cadence effective. Réservé aux canaux d'ÉTAT.
 */
export function useNodefonyAdaptiveChannelData<T = unknown>(
  base: MaybeRefOrGetter<string>,
  desiredMs: MaybeRefOrGetter<number>,
  options: AdaptiveChannelOptions = {},
): AdaptiveChannelData<T> {
  const data = shallowRef<T | null>(null);
  const intervalMs = useNodefonyAdaptiveChannel(
    base,
    (payload) => {
      data.value = payload as T;
    },
    desiredMs,
    options,
  );
  return { data: data, intervalMs };
}

/**
 * Statistiques observées d'un canal, telles que le client les calcule.
 *
 * Alias du contrat isomorphe {@link MessageStats} : une copie locale de la
 * forme aurait divergé le jour où le client ajoute un compteur.
 */
export type ChannelStatsSnapshot = MessageStats;

/**
 * `useNodefonyChannelStats()` — statistiques vivantes d'un canal (débit, série
 * pour un VU-mètre, total). La source est l'échantillonneur du client (1×/s) :
 * aucune horloge n'est posée ici, et aucune trame n'est émise pour mesurer.
 */
export function useNodefonyChannelStats(
  channel: MaybeRefOrGetter<string>,
): Readonly<Ref<ChannelStatsSnapshot | null>> {
  const client = useNodefony();
  const stats = shallowRef<ChannelStatsSnapshot | null>(null);
  observeReactive("useNodefonyChannelStats()", channel, (name) =>
    observeChannelStats(client, name, (value) => {
      stats.value = value;
    }),
  );
  return stats;
}

/**
 * `useNodefonySnapshot()` — ce que la socket sait d'ELLE-MÊME : état, canaux
 * tenus, trames reçues, trames perdues, dernière trame. Rafraîchi par
 * l'échantillonneur déjà en place — aucune horloge de plus.
 *
 * La donnée est au socle, la **boîte qui l'affiche** reste à chaque front :
 * publier un composant obligerait à en écrire un par framework de vue, et
 * ferait entrer du DOM dans un module dont toute la valeur est de n'en avoir
 * aucun.
 */
export function useNodefonySnapshot(): Readonly<Ref<SocketSnapshot | null>> {
  const client = useNodefony();
  const snapshot = shallowRef<SocketSnapshot | null>(null);
  observeReactive("useNodefonySnapshot()", client, (socket) =>
    observeSnapshot(socket, (value) => {
      snapshot.value = value;
    }),
  );
  return snapshot;
}

/** Réglages de {@link useNodefonySyslog}. */
export interface UseSyslogOptions {
  /** Taille max de l'anneau (les plus anciennes lignes sont évincées). Défaut 500. */
  max?: number;
  /** Ne garder que ces sévérités (ex. `["ERROR", "CRITIC"]`). Toutes par défaut. */
  severities?: string[];
  /** Canal source. Défaut `"nodefony:syslog"`. */
  channel?: string;
}

/**
 * `useNodefonySyslog()` — le flux du journal, prêt à afficher : anneau borné et
 * filtre de sévérité. Le format **coalescé** du canal (`{ logs, dropped }`),
 * l'entrée unique, la taille de l'anneau et le canal par défaut viennent du
 * socle ({@link observeSyslog}) : ce composable n'en connaît aucun.
 */
export function useNodefonySyslog(
  options: MaybeRefOrGetter<UseSyslogOptions> = {},
): Readonly<Ref<unknown[]>> {
  const client = useNodefony();
  const lines = shallowRef<unknown[]>([]);
  observeReactive(
    "useNodefonySyslog()",
    // Les réglages sont résumés en clé : un objet littéral recréé à chaque
    // rendu rebrancherait l'abonnement sans qu'aucun réglage ait changé.
    () => {
      const o = toValue(options);
      return `${o.channel ?? ""}|${o.max ?? ""}|${(o.severities ?? []).join(",")}`;
    },
    () => {
      const o = toValue(options);
      const settings: ObserveSyslogOptions = {
        max: o.max,
        severities: o.severities,
        channel: o.channel,
      };
      return observeSyslog(
        client,
        (entries) => {
          lines.value = entries;
        },
        settings,
      );
    },
  );
  return lines;
}

/**
 * `useNodefonyNotifications()` — le flux des **notices normalisées** du client :
 * criticités qui cassent le temps réel (codes de fermeture RFC 6455
 * interprétés), erreurs poussées par le serveur, rétablissement de connexion.
 * `onNotice` est appelé pour CHAQUE notice → brancher un centre de
 * notifications.
 *
 * À monter **une seule fois** (le shell de l'application), sans quoi la même
 * notice s'affiche autant de fois qu'il y a d'appels.
 */
export function useNodefonyNotifications(
  onNotice: (notice: NodefonyNotice) => void,
): void {
  const client = useNodefony();
  observeReactive("useNodefonyNotifications()", client, (socket) =>
    observeNotices(socket, onNotice),
  );
}

/** Réglages de {@link useNodefonyNoticeLog}. */
export interface UseNoticeLogOptions {
  /** Taille max de l'anneau (les plus anciennes notices sont évincées). Défaut 50. */
  max?: number;
  /** Ne garder que ces sources (ex. `["realtime"]`). Toutes par défaut. */
  sources?: NodefonyNotice["source"][];
}

/**
 * `useNodefonyNoticeLog()` — l'anneau borné des dernières notices, filtrable
 * par source : un historique léger des criticités, distinct des notifications
 * éphémères. La taille de l'anneau et le filtrage viennent du socle
 * ({@link observeNoticeLog}).
 */
export function useNodefonyNoticeLog(
  options: MaybeRefOrGetter<UseNoticeLogOptions> = {},
): Readonly<Ref<NodefonyNotice[]>> {
  const client = useNodefony();
  const notices = shallowRef<NodefonyNotice[]>([]);
  observeReactive(
    "useNodefonyNoticeLog()",
    () => {
      const o = toValue(options);
      return `${o.max ?? ""}|${(o.sources ?? []).join(",")}`;
    },
    () => {
      const o = toValue(options);
      const settings: ObserveNoticeLogOptions = {
        max: o.max,
        sources: o.sources,
      };
      return observeNoticeLog(
        client,
        (list) => {
          notices.value = list;
        },
        settings,
      );
    },
  );
  return notices;
}

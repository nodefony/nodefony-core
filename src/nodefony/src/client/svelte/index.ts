/**
 * `nodefony/svelte` — liaisons **Svelte 5** du client temps réel isomorphe.
 *
 * Adapte le {@link RealtimeClient} (agnostique : `on()`/`emit()`/`state`) au
 * système d'effets de Svelte, sans glue à recopier dans chaque application. Le
 * pendant exact de `nodefony/react`, `nodefony/vue` et `nodefony/angular` :
 * même surface, mêmes noms, mêmes garanties — seule la traduction change.
 *
 * **Ce fichier ne contient AUCUNE règle temps réel.** Souscrire, tenir un
 * dernier reçu, borner un anneau, décoder le format coalescé du journal, ne
 * jamais couper une socket partagée : tout cela vit dans le socle agnostique
 * `nodefony/client` (`observe*`, `connectShared`), que les quatre liaisons
 * consomment à l'identique. Ici ne reste que la traduction *rappel + libération
 * → réactivité Svelte* — la seule chose qu'une liaison a le droit de contenir.
 *
 * Quatre particularités de Svelte que les trois autres fronts ne montrent pas :
 *
 *  1. **AUCUNE rune n'est publiée ici, et c'est délibéré.** `$state` et
 *     `$effect` sont des constructions du COMPILATEUR : elles n'existent que
 *     dans un fichier `.svelte` ou `.svelte.ts`. Les publier imposerait au
 *     consommateur de compiler notre code — or le plugin Svelte ne compile pas
 *     `node_modules` par défaut : il faudrait une condition d'export `svelte`,
 *     une chaîne `svelte-package`, et le paquet deviendrait sensible aux
 *     versions du compilateur. Pour un front sur quatre. La liaison passe donc
 *     par {@link createSubscriber} (`svelte/reactivity`), l'API publique faite
 *     exactement pour ça : elle intègre un objet ORDINAIRE — écrit en
 *     TypeScript, bâti par le même bundler que les trois autres subpaths — au
 *     système d'effets, sans qu'aucune rune ne vive dans la bibliothèque.
 *  2. **Une valeur se lit `.current`**, jamais par appel : c'est le vocabulaire
 *     de Svelte 5 pour une source réactive externe (`MediaQuery.current`,
 *     `SvelteDate`…). Lu dans un template ou un `$effect`, il suit ; lu ailleurs,
 *     il rend l'instantané courant.
 *  3. **🔴 L'abonnement est PARESSEUX, et c'est le seul écart de comportement
 *     entre les quatre fronts.** React, Vue et Angular s'abonnent au montage ;
 *     ici, l'abonnement n'est pris **qu'au premier `.current` lu dans un effet**,
 *     et il est rendu **quand tous les effets qui le lisaient sont détruits**.
 *     Une valeur créée mais jamais affichée ne s'abonne donc jamais. C'est le
 *     comportement des primitives réactives de Svelte lui-même, et il est
 *     mesuré : un composant qui ne lit rien ne produit aucune trame
 *     `subscribe`. Quand un abonnement doit être pris QUOI QU'IL ARRIVE — une
 *     présence, un effet de bord serveur —, prendre {@link nodefonyChannel}
 *     dans un `$effect` : cette forme-là n'est pas paresseuse.
 *  4. **Un canal qui change ne laisse aucun trou** : le nouvel abonnement est
 *     pris AVANT que l'ancien soit rendu (`+b` puis `-a`), là où les liaisons à
 *     `watch`/`effect` des autres fronts libèrent d'abord. Rien à faire pour
 *     l'obtenir : c'est l'ordre du système d'effets de Svelte.
 *
 * `svelte` est une peerDep **optionnelle** : ce module n'est tiré que si on
 * importe `nodefony/svelte`.
 *
 * @example La page entière, en deux concepts :
 * ```ts
 * // main.ts
 * configureNodefony({ url: "/api/live/realtime" });
 * mount(App, { target: el });
 * ```
 * ```svelte
 * <script lang="ts">
 *   import { nodefonyState, nodefonyChannelData } from "nodefony/svelte";
 *   const etat = nodefonyState();
 *   const dernier = nodefonyChannelData<Evenement>("live:events");
 * </script>
 * <p>connexion : {etat.current}</p>
 * {#if dernier.current}<p>{dernier.current.texte}</p>{/if}
 * ```
 *
 * @module nodefony/svelte
 */
import { createSubscriber } from "svelte/reactivity";
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
// front fabrique ses canaux cadencés depuis le même subpath que les liaisons.
export {
  rateChannel,
  parseRate,
  isRateChannel,
} from "../../realtime/channelRate";
export type { RateBounds } from "../../realtime/channelRate";

// Les liaisons RENDENT ces types (`nodefonyIdentity()` → `RealtimeIdentity`).
// Sans ré-export, le consommateur ne peut pas NOMMER ce qu'il reçoit :
// l'inférence marche, la déclaration explicite lève TS2459.
export type {
  RealtimeIdentity,
  RealtimeState,
  NodefonyNotice,
} from "../realtime/RealtimeClient";
export type { SocketSnapshot } from "../realtime/observe";

/**
 * Une valeur réactive à la mode de Svelte 5 : on la lit `.current`.
 *
 * Le même contrat que `MediaQuery.current` : lue dans un template ou un
 * `$effect`, elle suit ; lue ailleurs, elle rend l'instantané courant.
 */
export interface Reactive<T> {
  readonly current: T;
}

/** Réglages de {@link configureNodefony} — l'un des deux au moins doit être donné. */
export interface NodefonySvelteOptions {
  /**
   * Adresse du serveur temps réel — la voie SIMPLE. La socket partagée de cette
   * URL est fabriquée et connectée.
   *
   * Deux consommateurs qui donnent la même URL obtiennent la MÊME socket
   * ({@link RealtimeClient.shared}), donc une seule connexion réseau.
   */
  url?: string;
  /**
   * Socket déjà construite — la voie AVANCÉE, quand l'application possède son
   * cycle de connexion. Fournie, elle l'emporte sur `url` et son cycle n'est
   * pas touché : ni `connect`, ni `disconnect`.
   */
  client?: RealtimeClient;
}

/** La socket de la page, posée par {@link configureNodefony}. */
let pageSocket: RealtimeClient | null = null;

/**
 * Installe la politique temps réel de l'application — à appeler UNE fois, dans
 * le point d'entrée, avant `mount()`.
 *
 * Svelte n'a pas de contexte applicatif comparable à React : `setContext` ne se
 * pose qu'à l'initialisation d'un composant, et ne couvrirait donc pas les
 * liaisons appelées ailleurs. La politique s'écrit ici comme ce qu'elle est en
 * Svelte : une configuration de module.
 *
 * Elle ne coupe aucune connexion : la connexion appartient à la PAGE, pas à un
 * composant, et `disconnect()` tranche les requêtes en vol des autres
 * consommateurs de la même socket partagée.
 *
 * @throws si ni `url` ni `client` n'est fourni — l'adresse dépend de
 *   l'application, et le framework n'en devine aucune (règle du socle : une
 *   adresse devinée marche en développement et se trompe en production).
 *
 * @example
 * ```ts
 * configureNodefony({ url: "/api/live/realtime" });
 * ```
 */
export function configureNodefony(options: NodefonySvelteOptions): void {
  const connection = connectShared(options);
  pageSocket = connection.socket;
  // Idempotent, rejet avalé, et sans effet sur le cycle d'une socket fournie
  // — les trois règles vivent dans le socle, pas ici.
  connection.start();
}

/**
 * `nodefony()` — la socket brute (canaux, journal, statistiques…). Tête de
 * gondole et échappatoire pour les cas avancés ; pour de l'état réactif, prendre
 * les liaisons dédiées ci-dessous.
 *
 * @throws si {@link configureNodefony} n'a pas été appelé. Le socle REFUSE de
 *   deviner une adresse : retomber ici sur une socket partagée fabriquée à la
 *   volée donnerait une page qui marche en développement et parle au mauvais
 *   hôte en production — mieux vaut une erreur au premier rendu.
 */
export function nodefony(): RealtimeClient {
  if (!pageSocket) {
    throw new Error(
      "nodefony() : configureNodefony() n'a pas été appelé — " +
        'configureNodefony({ url: "/api/live/realtime" }) dans main.ts, avant mount().',
    );
  }
  return pageSocket;
}

/**
 * Une source de valeur : constante, ou fonction qui la lit.
 *
 * Donner une fonction qui lit un `$state` suffit à ce que l'abonnement SUIVE la
 * valeur — c'est ce qui remplace, en Svelte, la liste de dépendances que React
 * doit se faire passer à la main.
 */
export type Source<T> = T | (() => T);

/** Lit une source, qu'elle soit constante ou fonction. */
function read<T>(source: Source<T>): T {
  return typeof source === "function" ? (source as () => T)() : source;
}

/**
 * Le motif commun à toutes les valeurs : brancher au premier lecteur, tenir la
 * dernière valeur reçue, libérer quand plus personne ne lit.
 *
 * `createSubscriber` porte tout le cycle : son `start` n'est appelé qu'au
 * premier `.current` lu dans un effet, une seule fois quels que soient le
 * nombre d'effets lecteurs, et la fonction qu'il rend est appelée quand le
 * dernier d'entre eux est détruit. C'est ce qui donne la libération sans une
 * ligne de `onDestroy` — et c'est aussi ce qui rend l'abonnement paresseux.
 */
function observedValue<T>(
  initial: T,
  wire: (emit: (value: T) => void) => Dispose,
): Reactive<T> {
  let value = initial;
  const subscribe = createSubscriber((update) =>
    wire((v) => {
      value = v;
      update();
    }),
  );
  return {
    get current(): T {
      subscribe();
      return value;
    },
  };
}

/**
 * `nodefonyState()` — l'état de la connexion (`"connected"`, `"reconnecting"`,
 * …), tenu à jour. Branché sur la porte publique `onState`, jamais sur le nom
 * de l'événement local, qui n'a pas à sortir du client.
 */
export function nodefonyState(): Reactive<RealtimeState> {
  const client = nodefony();
  return observedValue<RealtimeState>(client.state, (emit) =>
    observeState(client, emit),
  );
}

/**
 * `nodefonyIdentity()` — l'**identité résolue** de la connexion, annoncée par le
 * serveur au `realtime:welcome` (`authenticated`, `roles`, `userIdentifier`,
 * `scopes`). `null` tant qu'aucun welcome n'est arrivé ; une fois reçu, un
 * visiteur anonyme a `authenticated: false`. Brique du gating front :
 * `authenticated: false` → écran de connexion, **sans** appeler `/auth/me`.
 */
export function nodefonyIdentity(): Reactive<RealtimeIdentity | null> {
  const client = nodefony();
  return observedValue<RealtimeIdentity | null>(client.identity, (emit) =>
    observeIdentity(client, emit),
  );
}

/**
 * `nodefonyChannel()` — s'abonne à un canal pub/sub : `onMessage` est appelé à
 * chaque message. Le socle apparie `subscribe`/`unsubscribe` côté serveur
 * (ref-comptés) et rejoue l'abonnement à chaque reconnexion.
 *
 * **C'est la forme NON paresseuse** : elle rend son propre teardown, ce que
 * `$effect` attend, et l'abonnement est donc pris que la valeur soit affichée
 * ou non.
 *
 * @example
 * ```svelte
 * $effect(() => nodefonyChannel("live:salon", (m) => messages.push(m)));
 * ```
 */
export function nodefonyChannel(
  channel: Source<string>,
  onMessage: (payload: unknown) => void,
): Dispose {
  return observeChannel(nodefony(), read(channel), onMessage);
}

/**
 * `nodefonyChannelData()` — la **dernière valeur** reçue sur un canal (le cas le
 * plus courant : la dernière mesure d'un flux d'état). `null` tant que rien
 * n'est arrivé.
 *
 * Le canal accepte une fonction : donnée dans un `$derived`, elle fait suivre
 * l'abonnement — et le nouveau canal est pris AVANT que l'ancien soit rendu.
 */
export function nodefonyChannelData<T = unknown>(
  channel: Source<string>,
  initial: T | null = null,
): Reactive<T | null> {
  const client = nodefony();
  return observedValue<T | null>(initial, (emit) =>
    observeChannel(client, read(channel), (payload) => emit(payload as T)),
  );
}

/** Réglages adaptatifs (la cadence désirée se passe à part, en argument). */
export type AdaptiveChannelOptions = Omit<
  BindAdaptiveOptions,
  "intervalMs" | "onRate"
>;

/** Résultat de {@link nodefonyAdaptiveChannelData} : valeur + cadence réelle. */
export interface AdaptiveChannelData<T> {
  /** Dernière valeur reçue, `null` tant que rien n'est arrivé. */
  data: Reactive<T | null>;
  /** Cadence effective (ms) — bouge avec l'AIMD, à afficher en badge. */
  intervalMs: Reactive<number>;
}

/**
 * `nodefonyAdaptiveChannel()` — comme {@link nodefonyChannel}, mais en **cadence
 * adaptative** (AIMD piloté par le client) : la cadence recule sous famine puis
 * remonte quand c'est sain, sans rien changer au serveur.
 *
 * Réservé aux canaux d'ÉTAT (latest-wins) : décimer un canal d'événements perd
 * des messages.
 *
 * Comme {@link nodefonyChannel}, rend son teardown — forme non paresseuse, à
 * donner à `$effect`. La cadence effective est poussée par `onRate` ; pour
 * l'AFFICHER, prendre {@link nodefonyAdaptiveChannelData}, qui la rend réactive.
 *
 * Le ré-abonnement suit {@link adaptiveRebindKey} — la MÊME clé que les trois
 * autres liaisons, pour que les quatre rebranchent aux mêmes instants.
 */
export function nodefonyAdaptiveChannel(
  base: Source<string>,
  onMessage: (payload: unknown) => void,
  desiredMs: Source<number>,
  options: AdaptiveChannelOptions & { onRate?: (ms: number) => void } = {},
): Dispose {
  const { onRate, ...rest } = options;
  const binding = nodefony().adaptiveChannel(
    read(base),
    (...args: unknown[]) => onMessage(args[0]),
    {
      ...rest,
      intervalMs: read(desiredMs),
      enabled: rest.enabled !== false,
      onRate,
    },
  );
  return () => binding.dispose();
}

/**
 * `nodefonyAdaptiveChannelData()` — comme {@link nodefonyChannelData}, mais en
 * cadence adaptative. Rend la dernière valeur **et** la cadence effective, les
 * deux réactives. Réservé aux canaux d'ÉTAT.
 *
 * La clé de ré-abonnement est {@link adaptiveRebindKey} : lue à chaque
 * branchement, elle fait suivre l'abonnement quand la base, la cadence désirée
 * ou l'activation changent — et pas quand autre chose bouge.
 */
export function nodefonyAdaptiveChannelData<T = unknown>(
  base: Source<string>,
  desiredMs: Source<number>,
  options: AdaptiveChannelOptions = {},
): AdaptiveChannelData<T> {
  const client = nodefony();
  const enabled = options.enabled !== false;
  let setCadence: ((ms: number) => void) | null = null;
  const data = observedValue<T | null>(null, (emit) => {
    // La clé est LUE ici pour que le branchement en dépende : ré-abonnement aux
    // mêmes instants que dans les trois autres fronts.
    void adaptiveRebindKey(read(base), read(desiredMs), enabled);
    const binding = client.adaptiveChannel(
      read(base),
      (...args: unknown[]) => emit(args[0] as T),
      {
        ...options,
        intervalMs: read(desiredMs),
        enabled,
        onRate: (ms: number) => setCadence?.(ms),
      },
    );
    return () => binding.dispose();
  });
  const intervalMs = observedValue<number>(read(desiredMs), (emit) => {
    setCadence = emit;
    return () => {
      setCadence = null;
    };
  });
  return { data, intervalMs };
}

/**
 * Statistiques observées d'un canal, telles que le client les calcule.
 *
 * Alias du contrat isomorphe {@link MessageStats} : une copie locale de la forme
 * aurait divergé le jour où le client ajoute un compteur.
 */
export type ChannelStatsSnapshot = MessageStats;

/**
 * `nodefonyChannelStats()` — statistiques vivantes d'un canal (débit, série pour
 * un VU-mètre, total). La source est l'échantillonneur du client (1×/s) : aucune
 * horloge n'est posée ici, et aucune trame n'est émise pour mesurer.
 */
export function nodefonyChannelStats(
  channel: Source<string>,
): Reactive<ChannelStatsSnapshot | null> {
  const client = nodefony();
  return observedValue<ChannelStatsSnapshot | null>(null, (emit) =>
    observeChannelStats(client, read(channel), emit),
  );
}

/**
 * `nodefonySnapshot()` — ce que la socket sait d'ELLE-MÊME : état, canaux tenus,
 * trames reçues, trames perdues, dernière trame. Rafraîchi par
 * l'échantillonneur déjà en place — aucune horloge de plus.
 *
 * La donnée est au socle, la **boîte qui l'affiche** reste à chaque front :
 * publier un composant obligerait à en écrire un par framework de vue, et ferait
 * entrer du DOM dans un module dont toute la valeur est de n'en avoir aucun.
 */
export function nodefonySnapshot(): Reactive<SocketSnapshot | null> {
  const client = nodefony();
  return observedValue<SocketSnapshot | null>(null, (emit) =>
    observeSnapshot(client, emit),
  );
}

/** Réglages de {@link nodefonySyslog}. */
export interface SyslogOptions {
  /** Taille max de l'anneau (les plus anciennes lignes sont évincées). Défaut 500. */
  max?: number;
  /** Ne garder que ces sévérités (ex. `["ERROR", "CRITIC"]`). Toutes par défaut. */
  severities?: string[];
  /** Canal source. Défaut `"nodefony:syslog"`. */
  channel?: string;
}

/**
 * `nodefonySyslog()` — le flux du journal, prêt à afficher : anneau borné et
 * filtre de sévérité. Le format **coalescé** du canal (`{ logs, dropped }`),
 * l'entrée unique, la taille de l'anneau et le canal par défaut viennent du
 * socle ({@link observeSyslog}) : cette liaison n'en connaît aucun.
 */
export function nodefonySyslog(
  options: Source<SyslogOptions> = {},
): Reactive<unknown[]> {
  const client = nodefony();
  return observedValue<unknown[]>([], (emit) => {
    const o = read(options);
    const settings: ObserveSyslogOptions = {
      max: o.max,
      severities: o.severities,
      channel: o.channel,
    };
    return observeSyslog(client, emit, settings);
  });
}

/**
 * `nodefonyNotifications()` — le flux des **notices normalisées** du client :
 * criticités qui cassent le temps réel (codes de fermeture RFC 6455
 * interprétés), erreurs poussées par le serveur, rétablissement de connexion.
 * `onNotice` est appelé pour CHAQUE notice → brancher un centre de
 * notifications.
 *
 * Forme non paresseuse (elle rend son teardown), à monter **une seule fois**
 * dans le shell de l'application : sans quoi la même notice s'affiche autant de
 * fois qu'il y a d'appels.
 */
export function nodefonyNotifications(
  onNotice: (notice: NodefonyNotice) => void,
): Dispose {
  return observeNotices(nodefony(), onNotice);
}

/** Réglages de {@link nodefonyNoticeLog}. */
export interface NoticeLogOptions {
  /** Taille max de l'anneau (les plus anciennes notices sont évincées). Défaut 50. */
  max?: number;
  /** Ne garder que ces sources (ex. `["realtime"]`). Toutes par défaut. */
  sources?: NodefonyNotice["source"][];
}

/**
 * `nodefonyNoticeLog()` — l'anneau borné des dernières notices, filtrable par
 * source : un historique léger des criticités, distinct des notifications
 * éphémères. La taille de l'anneau et le filtrage viennent du socle
 * ({@link observeNoticeLog}).
 */
export function nodefonyNoticeLog(
  options: Source<NoticeLogOptions> = {},
): Reactive<NodefonyNotice[]> {
  const client = nodefony();
  return observedValue<NodefonyNotice[]>([], (emit) => {
    const o = read(options);
    const settings: ObserveNoticeLogOptions = {
      max: o.max,
      sources: o.sources,
    };
    return observeNoticeLog(client, emit, settings);
  });
}

/**
 * `nodefony/angular` — liaisons **Angular** du client temps réel isomorphe.
 *
 * Adapte le {@link RealtimeClient} (agnostique : `on()`/`emit()`/`state`) aux
 * *signals* d'Angular, sans glue à recopier dans chaque application. Le pendant
 * exact de `nodefony/react` et `nodefony/vue` : même surface, mêmes noms, mêmes
 * garanties — seule la traduction vers la réactivité change.
 *
 * **Ce fichier ne contient AUCUNE règle temps réel.** Souscrire, tenir un
 * dernier reçu, borner un anneau, décoder le format coalescé du journal, ne
 * jamais couper une socket partagée : tout cela vit dans le socle agnostique
 * `nodefony/client` (`observe*`, `connectShared`), que les quatre liaisons
 * consomment à l'identique. Ici ne reste que la traduction *rappel + libération
 * → signal* — la seule chose qu'une liaison a le droit de contenir. Une liaison
 * qui réencoderait une règle la ferait diverger des trois autres, en silence.
 *
 * Trois particularités d'Angular que React et Vue ne montrent pas, et qui sont
 * la raison d'être de ce fichier :
 *
 *  1. **AUCUN décorateur Angular n'est publié ici**, et c'est délibéré. Un
 *     `@Injectable()` n'est pas du JavaScript : c'est une instruction pour le
 *     compilateur d'Angular, qui doit la transformer. Une bibliothèque qui en
 *     publie doit donc être bâtie par `ng-packagr` au format de paquet Angular
 *     (*partial compilation* + *linker*) — une seconde chaîne de build, et un
 *     couplage aux majeures d'Angular, pour UN subpath sur quatre. Non compilé,
 *     un décorateur marche parfois en développement (si `@angular/compiler` est
 *     chargé) et **casse en production**, où il ne l'est pas. La forme retenue
 *     — `InjectionToken` + `makeEnvironmentProviders` + fonctions `inject*()` —
 *     est celle qu'Angular emploie pour lui-même (`provideHttpClient`,
 *     `provideRouter`, `takeUntilDestroyed`) : du TypeScript ordinaire, que
 *     rolldown bâtit comme le reste, et une DI intacte.
 *     ⚠️ Cela ne restreint EN RIEN l'application : `@Component`, `@Injectable`,
 *     `@Directive` y sont compilés par le plugin Angular du builder Nodefony.
 *     Ces fonctions s'appellent depuis un composant ou un service décoré.
 *  2. **Les écouteurs sont posés HORS ZONE.** Dans une application avec
 *     `zone.js`, `zone.js` remplace `WebSocket` pour savoir quand relancer la
 *     détection de changements : une socket ouverte dans la zone déclenche donc
 *     une détection **globale à chaque trame** — un canal à 10 Hz coûterait dix
 *     détections par seconde à TOUTE l'application, ce que la règle de
 *     performance du projet interdit. {@link provideNodefony} ouvre donc la
 *     connexion dans `NgZone.runOutsideAngular`. Les valeurs, elles, arrivent
 *     par des *signals*, qui notifient leurs lecteurs sans zone : juste dans les
 *     deux mondes, `zone.js` ou `provideZonelessChangeDetection()`.
 *  3. **La libération passe par le contexte d'injection**, jamais par une valeur
 *     de retour : `DestroyRef` pour un abonnement fixe, le nettoyage d'`effect`
 *     pour un abonnement qui suit un signal. C'est le composant (ou le service)
 *     qui possède l'abonnement, et sa destruction le rend.
 *
 * `@angular/core` est une peerDep **optionnelle** : ce module n'est tiré que si
 * on importe `nodefony/angular`.
 *
 * @example La page entière, en deux concepts :
 * ```ts
 * // main.ts
 * bootstrapApplication(AppComponent, {
 *   providers: [provideNodefony({ url: "/api/live/realtime" })],
 * });
 * ```
 * ```ts
 * // app.component.ts
 * @Component({ selector: "app-root", template: `{{ etat() }}` })
 * export class AppComponent {
 *   readonly etat = injectNodefonyState();
 *   readonly dernier = injectNodefonyChannelData<Evenement>("live:events");
 * }
 * ```
 *
 * @module nodefony/angular
 */
import {
  DestroyRef,
  InjectionToken,
  NgZone,
  assertInInjectionContext,
  effect,
  inject,
  makeEnvironmentProviders,
  signal,
  untracked,
  type EnvironmentProviders,
  type Signal,
} from "@angular/core";
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
// front fabrique ses canaux cadencés depuis le même subpath que les fonctions.
export {
  rateChannel,
  parseRate,
  isRateChannel,
} from "../../realtime/channelRate";
export type { RateBounds } from "../../realtime/channelRate";

// Les fonctions RENDENT ces types (`injectNodefonyIdentity` →
// `RealtimeIdentity`). Sans ré-export, le consommateur ne peut pas NOMMER ce
// qu'il reçoit : l'inférence marche, la déclaration explicite lève TS2459.
export type {
  RealtimeIdentity,
  RealtimeState,
  NodefonyNotice,
} from "../realtime/RealtimeClient";
export type { SocketSnapshot } from "../realtime/observe";

/**
 * Le jeton sous lequel {@link provideNodefony} enregistre la socket.
 *
 * Exporté pour le cas légitime où un sous-arbre doit parler à une AUTRE socket
 * que celle de l'application : le fournir à nouveau dans les `providers` d'un
 * composant suffit, et les fonctions du sous-arbre suivent.
 */
export const NODEFONY_CLIENT = new InjectionToken<RealtimeClient>(
  "nodefony:realtime",
);

/** Réglages de {@link provideNodefony} — l'un des deux au moins doit être donné. */
export interface NodefonyAngularOptions {
  /**
   * Adresse du serveur temps réel — la voie SIMPLE. Le fournisseur fabrique la
   * socket partagée pour cette URL et la connecte lui-même.
   *
   * Deux consommateurs qui donnent la même URL obtiennent la MÊME socket
   * ({@link RealtimeClient.shared}), donc une seule connexion réseau.
   */
  url?: string;
  /**
   * Socket déjà construite — la voie AVANCÉE, quand l'application possède son
   * cycle de connexion. Fournie, elle l'emporte sur `url` et le fournisseur ne
   * touche pas au cycle : ni `connect`, ni `disconnect`.
   */
  client?: RealtimeClient;
}

/**
 * Le fournisseur — à poser une fois, dans les `providers` de l'application.
 *
 * Il fait exactement deux choses : enregistrer la socket, et lancer la
 * connexion **hors zone**. Il n'en coupe aucune : la connexion appartient à la
 * PAGE, pas à un composant, et `disconnect()` tranche les requêtes en vol des
 * autres consommateurs de la même socket partagée.
 *
 * La socket est résolue **immédiatement** (donc une adresse manquante est
 * refusée à la construction des providers, pas à la première injection) ; la
 * connexion, elle, n'est ouverte qu'au premier `inject`, et hors zone.
 *
 * @throws si ni `url` ni `client` n'est fourni — l'adresse dépend de
 *   l'application, et le framework n'en devine aucune (règle du socle : une
 *   adresse devinée marche en développement et se trompe en production).
 *
 * @example
 * ```ts
 * bootstrapApplication(AppComponent, {
 *   providers: [
 *     provideZonelessChangeDetection(),
 *     provideNodefony({ url: "/api/live/realtime" }),
 *   ],
 * });
 * ```
 */
export function provideNodefony(
  options: NodefonyAngularOptions,
): EnvironmentProviders {
  // Résolue ICI, pas dans la fabrique : le refus d'une adresse absente doit
  // tomber là où l'erreur se lit (la composition des providers), pas au premier
  // rendu d'un composant. La règle du refus elle-même vit dans le socle.
  const connection = connectShared(options);
  return makeEnvironmentProviders([
    {
      provide: NODEFONY_CLIENT,
      useFactory: (): RealtimeClient => {
        // Hors zone : c'est `connect()` qui fabrique le transport, donc c'est
        // ici que `zone.js` accrocherait la socket à la détection de
        // changements. La reconnexion automatique hérite de la même zone.
        // `NgZone` est fourni dans les deux mondes — sans `zone.js`, c'est une
        // implémentation inerte, et l'appel ne coûte rien.
        inject(NgZone).runOutsideAngular(() => {
          // Idempotent, rejet avalé, et sans effet sur le cycle d'une socket
          // fournie — les trois règles vivent dans le socle, pas ici.
          connection.start();
        });
        return connection.socket;
      },
    },
  ]);
}

/**
 * `injectNodefony()` — la socket brute (canaux, journal, statistiques…). Tête de
 * gondole et échappatoire pour les cas avancés ; pour de l'état réactif, prendre
 * les fonctions dédiées ci-dessous.
 *
 * @throws si {@link provideNodefony} n'est pas dans les `providers`. Le socle
 *   REFUSE de deviner une adresse : retomber ici sur une socket partagée
 *   fabriquée à la volée donnerait une page qui marche en développement et parle
 *   au mauvais hôte en production — mieux vaut une erreur au premier rendu.
 */
export function injectNodefony(): RealtimeClient {
  assertInInjectionContext(injectNodefony);
  const client = inject(NODEFONY_CLIENT, { optional: true });
  if (!client) {
    throw new Error(
      "injectNodefony() : provideNodefony() n'est pas dans les providers — " +
        'bootstrapApplication(App, { providers: [provideNodefony({ url: "/api/live/realtime" })] }).',
    );
  }
  return client;
}

/**
 * Une source de valeur : constante, ou fonction qui la lit (un `Signal` en est
 * un cas — un signal EST une fonction sans argument).
 *
 * C'est ce qui remplace, en Angular, la liste de dépendances que React doit se
 * faire passer à la main : donner un signal suffit à ce que l'abonnement suive.
 */
export type Source<T> = T | (() => T);

/** Lit une source, qu'elle soit constante ou fonction. */
function read<T>(source: Source<T>): T {
  return typeof source === "function" ? (source as () => T)() : source;
}

/**
 * Le motif commun à toutes les fonctions d'abonnement : brancher, rebrancher
 * quand la source change, libérer à la destruction.
 *
 * Deux chemins, et l'écart entre eux est voulu :
 *
 *  - **source constante** → branchement direct + `DestroyRef`. Aucun `effect`
 *    n'est alloué pour une valeur qui ne bougera jamais (règle de performance du
 *    projet : pas de structure allouée « au cas où »).
 *  - **source fonction** → `effect`, dont la lecture TRACKÉE rebranche à chaque
 *    changement et dont le nettoyage rend l'abonnement précédent. `untracked`
 *    entoure le branchement : ce que le socle lirait par ailleurs ne doit pas
 *    devenir une dépendance de l'effet.
 */
function observeReactive<S>(
  source: Source<S>,
  wire: (value: S) => Dispose,
): void {
  if (typeof source !== "function") {
    const release = wire(source);
    inject(DestroyRef).onDestroy(release);
    return;
  }
  effect((onCleanup) => {
    const value = read(source);
    const release = untracked(() => wire(value));
    onCleanup(release);
  });
}

/**
 * `injectNodefonyState()` — l'état de la connexion (`"connected"`,
 * `"reconnecting"`, …), tenu à jour. Branché sur la porte publique `onState`,
 * jamais sur le nom de l'événement local, qui n'a pas à sortir du client.
 */
export function injectNodefonyState(): Signal<RealtimeState> {
  assertInInjectionContext(injectNodefonyState);
  const client = injectNodefony();
  const state = signal<RealtimeState>(client.state);
  observeReactive(client, (socket) =>
    observeState(socket, (value) => state.set(value)),
  );
  return state.asReadonly();
}

/**
 * `injectNodefonyIdentity()` — l'**identité résolue** de la connexion, annoncée
 * par le serveur au `realtime:welcome` (`authenticated`, `roles`,
 * `userIdentifier`, `scopes`). `null` tant qu'aucun welcome n'est arrivé ; une
 * fois reçu, un visiteur anonyme a `authenticated: false`. Brique du gating
 * front : `authenticated: false` → écran de connexion, **sans** appeler
 * `/auth/me`.
 */
export function injectNodefonyIdentity(): Signal<RealtimeIdentity | null> {
  assertInInjectionContext(injectNodefonyIdentity);
  const client = injectNodefony();
  const identity = signal<RealtimeIdentity | null>(client.identity);
  observeReactive(client, (socket) =>
    observeIdentity(socket, (value) => identity.set(value)),
  );
  return identity.asReadonly();
}

/**
 * `injectNodefonyChannel()` — s'abonne à un canal pub/sub : `onMessage` est
 * appelé à chaque message. Le socle apparie `subscribe`/`unsubscribe` côté
 * serveur (ref-comptés) et rejoue l'abonnement à chaque reconnexion.
 *
 * Le canal accepte un signal (ou toute fonction qui le lit) : l'abonnement suit
 * alors la valeur, en libérant l'ancien avant de prendre le nouveau.
 */
export function injectNodefonyChannel(
  channel: Source<string>,
  onMessage: (payload: unknown) => void,
): void {
  assertInInjectionContext(injectNodefonyChannel);
  const client = injectNodefony();
  observeReactive(channel, (name) => observeChannel(client, name, onMessage));
}

/**
 * `injectNodefonyChannelData()` — la **dernière valeur** reçue sur un canal (le
 * cas le plus courant : la dernière mesure d'un flux d'état). `null` tant que
 * rien n'est arrivé.
 */
export function injectNodefonyChannelData<T = unknown>(
  channel: Source<string>,
  initial: T | null = null,
): Signal<T | null> {
  assertInInjectionContext(injectNodefonyChannelData);
  const data = signal<T | null>(initial);
  injectNodefonyChannel(channel, (payload) => data.set(payload as T));
  return data.asReadonly();
}

/** Réglages adaptatifs (la cadence désirée se passe à part, en argument). */
export type AdaptiveChannelOptions = Omit<
  BindAdaptiveOptions,
  "intervalMs" | "onRate"
>;

/** Résultat de {@link injectNodefonyAdaptiveChannelData} : valeur + cadence réelle. */
export interface AdaptiveChannelData<T> {
  /** Dernière valeur reçue, `null` tant que rien n'est arrivé. */
  data: Signal<T | null>;
  /** Cadence effective (ms) — bouge avec l'AIMD, à afficher en badge. */
  intervalMs: Signal<number>;
}

/**
 * `injectNodefonyAdaptiveChannel()` — comme {@link injectNodefonyChannel}, mais
 * en **cadence adaptative** (AIMD piloté par le client) : la cadence recule sous
 * famine puis remonte quand c'est sain, sans rien changer au serveur. Renvoie la
 * cadence effective, à afficher.
 *
 * Réservé aux canaux d'ÉTAT (latest-wins) : décimer un canal d'événements perd
 * des messages.
 *
 * Le ré-abonnement suit {@link adaptiveRebindKey} — la MÊME clé que les trois
 * autres liaisons, pour que les quatre rebranchent aux mêmes instants.
 */
export function injectNodefonyAdaptiveChannel(
  base: Source<string>,
  onMessage: (payload: unknown) => void,
  desiredMs: Source<number>,
  options: AdaptiveChannelOptions = {},
): Signal<number> {
  assertInInjectionContext(injectNodefonyAdaptiveChannel);
  const client = injectNodefony();
  const cadence = signal<number>(read(desiredMs));
  const enabled = options.enabled !== false;
  observeReactive(
    () => adaptiveRebindKey(read(base), read(desiredMs), enabled),
    () => {
      const binding = client.adaptiveChannel(
        read(base),
        (...args: unknown[]) => onMessage(args[0]),
        {
          ...options,
          intervalMs: read(desiredMs),
          enabled,
          onRate: (ms: number) => cadence.set(ms),
        },
      );
      return () => binding.dispose();
    },
  );
  return cadence.asReadonly();
}

/**
 * `injectNodefonyAdaptiveChannelData()` — comme
 * {@link injectNodefonyChannelData}, mais en cadence adaptative. Mince surcouche
 * de {@link injectNodefonyAdaptiveChannel} : garde la dernière valeur et rend la
 * cadence effective. Réservé aux canaux d'ÉTAT.
 */
export function injectNodefonyAdaptiveChannelData<T = unknown>(
  base: Source<string>,
  desiredMs: Source<number>,
  options: AdaptiveChannelOptions = {},
): AdaptiveChannelData<T> {
  assertInInjectionContext(injectNodefonyAdaptiveChannelData);
  const data = signal<T | null>(null);
  const intervalMs = injectNodefonyAdaptiveChannel(
    base,
    (payload) => data.set(payload as T),
    desiredMs,
    options,
  );
  return { data: data.asReadonly(), intervalMs };
}

/**
 * Statistiques observées d'un canal, telles que le client les calcule.
 *
 * Alias du contrat isomorphe {@link MessageStats} : une copie locale de la forme
 * aurait divergé le jour où le client ajoute un compteur.
 */
export type ChannelStatsSnapshot = MessageStats;

/**
 * `injectNodefonyChannelStats()` — statistiques vivantes d'un canal (débit,
 * série pour un VU-mètre, total). La source est l'échantillonneur du client
 * (1×/s) : aucune horloge n'est posée ici, et aucune trame n'est émise pour
 * mesurer.
 */
export function injectNodefonyChannelStats(
  channel: Source<string>,
): Signal<ChannelStatsSnapshot | null> {
  assertInInjectionContext(injectNodefonyChannelStats);
  const client = injectNodefony();
  const stats = signal<ChannelStatsSnapshot | null>(null);
  observeReactive(channel, (name) =>
    observeChannelStats(client, name, (value) => stats.set(value)),
  );
  return stats.asReadonly();
}

/**
 * `injectNodefonySnapshot()` — ce que la socket sait d'ELLE-MÊME : état, canaux
 * tenus, trames reçues, trames perdues, dernière trame. Rafraîchi par
 * l'échantillonneur déjà en place — aucune horloge de plus.
 *
 * La donnée est au socle, la **boîte qui l'affiche** reste à chaque front :
 * publier un composant obligerait à en écrire un par framework de vue, et ferait
 * entrer du DOM dans un module dont toute la valeur est de n'en avoir aucun.
 */
export function injectNodefonySnapshot(): Signal<SocketSnapshot | null> {
  assertInInjectionContext(injectNodefonySnapshot);
  const client = injectNodefony();
  const snapshot = signal<SocketSnapshot | null>(null);
  observeReactive(client, (socket) =>
    observeSnapshot(socket, (value) => snapshot.set(value)),
  );
  return snapshot.asReadonly();
}

/** Réglages de {@link injectNodefonySyslog}. */
export interface InjectSyslogOptions {
  /** Taille max de l'anneau (les plus anciennes lignes sont évincées). Défaut 500. */
  max?: number;
  /** Ne garder que ces sévérités (ex. `["ERROR", "CRITIC"]`). Toutes par défaut. */
  severities?: string[];
  /** Canal source. Défaut `"nodefony:syslog"`. */
  channel?: string;
}

/**
 * `injectNodefonySyslog()` — le flux du journal, prêt à afficher : anneau borné
 * et filtre de sévérité. Le format **coalescé** du canal (`{ logs, dropped }`),
 * l'entrée unique, la taille de l'anneau et le canal par défaut viennent du
 * socle ({@link observeSyslog}) : cette fonction n'en connaît aucun.
 */
export function injectNodefonySyslog(
  options: Source<InjectSyslogOptions> = {},
): Signal<unknown[]> {
  assertInInjectionContext(injectNodefonySyslog);
  const client = injectNodefony();
  const lines = signal<unknown[]>([]);
  const wire = (): Dispose => {
    const o = read(options);
    const settings: ObserveSyslogOptions = {
      max: o.max,
      severities: o.severities,
      channel: o.channel,
    };
    return observeSyslog(client, (entries) => lines.set(entries), settings);
  };
  observeReactive(
    // Les réglages sont résumés en clé : un objet littéral recréé à chaque
    // lecture rebrancherait l'abonnement sans qu'aucun réglage ait changé.
    typeof options === "function"
      ? () => {
          const o = read(options);
          return `${o.channel ?? ""}|${o.max ?? ""}|${(o.severities ?? []).join(",")}`;
        }
      : "",
    wire,
  );
  return lines.asReadonly();
}

/**
 * `injectNodefonyNotifications()` — le flux des **notices normalisées** du
 * client : criticités qui cassent le temps réel (codes de fermeture RFC 6455
 * interprétés), erreurs poussées par le serveur, rétablissement de connexion.
 * `onNotice` est appelé pour CHAQUE notice → brancher un centre de
 * notifications.
 *
 * À monter **une seule fois** (le shell de l'application), sans quoi la même
 * notice s'affiche autant de fois qu'il y a d'appels.
 */
export function injectNodefonyNotifications(
  onNotice: (notice: NodefonyNotice) => void,
): void {
  assertInInjectionContext(injectNodefonyNotifications);
  const client = injectNodefony();
  observeReactive(client, (socket) => observeNotices(socket, onNotice));
}

/** Réglages de {@link injectNodefonyNoticeLog}. */
export interface InjectNoticeLogOptions {
  /** Taille max de l'anneau (les plus anciennes notices sont évincées). Défaut 50. */
  max?: number;
  /** Ne garder que ces sources (ex. `["realtime"]`). Toutes par défaut. */
  sources?: NodefonyNotice["source"][];
}

/**
 * `injectNodefonyNoticeLog()` — l'anneau borné des dernières notices, filtrable
 * par source : un historique léger des criticités, distinct des notifications
 * éphémères. La taille de l'anneau et le filtrage viennent du socle
 * ({@link observeNoticeLog}).
 */
export function injectNodefonyNoticeLog(
  options: Source<InjectNoticeLogOptions> = {},
): Signal<NodefonyNotice[]> {
  assertInInjectionContext(injectNodefonyNoticeLog);
  const client = injectNodefony();
  const notices = signal<NodefonyNotice[]>([]);
  const wire = (): Dispose => {
    const o = read(options);
    const settings: ObserveNoticeLogOptions = {
      max: o.max,
      sources: o.sources,
    };
    return observeNoticeLog(client, (list) => notices.set(list), settings);
  };
  observeReactive(
    typeof options === "function"
      ? () => {
          const o = read(options);
          return `${o.max ?? ""}|${(o.sources ?? []).join(",")}`;
        }
      : "",
    wire,
  );
  return notices.asReadonly();
}

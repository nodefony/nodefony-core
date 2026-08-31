/**
 * `IClientKernel` — contrat du kernel client isomorphe de Nodefony (ADR-0007).
 *
 * Le ClientKernel est le chef d'orchestre de la couche **INFRA** d'une app front
 * (composition des services techniques, lifecycle navigateur, observabilité,
 * cycle d'identité). Il ne possède JAMAIS le rendu, le routing ni l'état métier
 * (React/Vue/Angular + stores restent maîtres de la vue) — clause anti-dérive
 * ADR-0007 D1.
 *
 * Ce fichier EST la spécification : toute évolution de surface passe par un
 * nouvel ADR. Il n'est PAS encore réexporté par le barrel client — il y revient
 * quand la console d'administration l'exerce (ADR-0007 D11.4), gardé par
 * `src/tests/clientSurfaceExercised.test.ts`.
 *
 * @module nodefony/client
 */
import type Syslog from "../syslog/Syslog";
import type {
  RealtimeClient,
  RealtimeOptions,
} from "./realtime/RealtimeClient";

/**
 * États du kernel client, ordonnés et non régressifs (symétrie nominale avec les
 * lifecycle flags du Kernel serveur — `booted`/`ready`/… — sans en singer la
 * sémantique process).
 */
export type ClientKernelState = "created" | "booting" | "ready" | "terminated";

/**
 * Événements émis par le kernel client.
 *
 * Mêmes noms nominaux que les hooks du Kernel serveur quand le sens est le même
 * (`onBoot`/`onReady`/`onTerminate`) ; les événements propres au navigateur
 * (`onIdentityChange`, `onVisibility`, `onOnline`) n'ont volontairement pas
 * d'équivalent back.
 *
 * - `onBoot` — composition faite (`boot()` appelé).
 * - `onReady` — services connectés (socket ouverte, ou opt-out realtime).
 * - `onIdentityChange` — l'identité runtime a changé (login/logout/bascule de
 *   compte). Le kernel a DÉJÀ re-négocié la socket quand l'app reçoit cet
 *   événement (anti-élévation de privilège, ADR-0007 D9) : il ne reste à
 *   l'application qu'à purger ses propres caches scopés.
 * - `onVisibility` — `document.visibilitychange`.
 * - `onOnline` — bascule `online`/`offline` du navigateur.
 * - `onTerminate` — page en cours de déchargement (`pagehide`, best-effort).
 */
export type ClientKernelEvent =
  | "onBoot"
  | "onReady"
  | "onIdentityChange"
  | "onVisibility"
  | "onOnline"
  | "onTerminate";

/**
 * Identité runtime déclarée par l'application au kernel.
 *
 * `key` est une **clé stable de compte** — et elle seule décide d'un « vrai
 * changement » au sens ADR-0007 D9. Ce n'est pas un détail de forme : la garde
 * qui protège contre l'élévation de privilège compare des clés, jamais des
 * objets. Un profil rafraîchi (mêmes droits, nouvel objet) ne doit PAS couper la
 * socket ; une bascule de compte le doit toujours.
 *
 * `data` reste à l'usage de l'application (profil, rôles, ce qu'elle veut
 * retrouver dans le handler) — le kernel ne l'interprète jamais.
 */
export interface ClientIdentity {
  /** Clé stable du compte — l'unique critère du re-handshake (D9). */
  readonly key: string;
  /** Charge libre, opaque au kernel. */
  readonly data?: unknown;
}

/**
 * Registre TYPÉ des services techniques portés par le kernel client.
 *
 * Extensible par **augmentation de module** (même mécanique que le registre de
 * config `NodefonyModuleConfig` back, ADR-0006) : un module/une app déclare ses
 * services sans jamais modifier ce contrat.
 *
 * `realtime` est typé sur la **classe** `RealtimeClient`, pas sur l'interface
 * `IRealtimeSocket` : c'est la correction du premier défaut relevé par #41. Le
 * consommateur publié du registre est `NodefonyProvider`, dont la prop `client`
 * exige la classe ; et `IRealtimeSocket` n'a ni `connect`, ni `disconnect`, ni
 * `state`, ni `identity` — le contrat ne savait donc pas exprimer le
 * re-handshake de sa propre décision D9. Un registre nomme des services
 * composés, pas des abstractions : l'affaiblir n'achetait rien et imposait une
 * conversion de type forcée à chaque lecture.
 *
 * @example
 * ```typescript
 * declare module "nodefony/client" {
 *   interface NodefonyClientServices {
 *     api?: MyApiClient;
 *   }
 * }
 * ```
 */
export interface NodefonyClientServices {
  /** La socket Nodefony de l'app (multiplexage de canaux, isomorphe). */
  realtime?: RealtimeClient;
}

/**
 * Options de `createClientKernel()`.
 *
 * Tout est facultatif : un kernel sans option est légal et ne compose rien —
 * l'opt-in est strict (ADR-0007 D7), le kernel compose, il n'impose pas.
 */
export interface ClientKernelOptions {
  /**
   * Nom du kernel — sert de `msgid` dans les journaux client.
   *
   * @defaultValue `"CLIENT KERNEL"`
   */
  name?: string;
  /**
   * La socket de l'application. Trois formes, par DX décroissante :
   * une instance déjà composée, les options d'une socket partagée
   * (`RealtimeClient.shared`), ou `false`/absent pour ne pas en avoir.
   */
  realtime?: RealtimeClient | RealtimeOptions | false;
  /**
   * Ponter les événements du navigateur (`visibilitychange`, `online`/`offline`,
   * `pagehide`) sur les événements du kernel.
   *
   * @defaultValue `true` quand un document est présent
   */
  browserEvents?: boolean;
  /**
   * Ouvrir la socket au `boot()`.
   *
   * À passer `false` quand la socket est **authentifiée** : c'est alors le login
   * qui l'ouvre, par `setIdentity()`, et ouvrir au démarrage produirait une
   * connexion anonyme qui n'a rien à faire là. Le cas s'est présenté au premier
   * portage réel — la console d'administration n'ouvre sa socket qu'une fois
   * l'utilisateur connu.
   *
   * @defaultValue `true`
   */
  connectOnBoot?: boolean;
  /**
   * Annoncer le kernel dans la console du navigateur au `boot()` — un badge sur
   * une ligne, puis un groupe replié pour le détail.
   *
   * À passer `false` en production : la console d'une application publiée
   * n'appartient pas au framework.
   *
   * @defaultValue `true`
   */
  banner?: boolean;
}

/**
 * Contrat du kernel client isomorphe (ADR-0007 D2 — surface v1, volontairement
 * minimale : chaque méthode publiée est une promesse SemVer).
 *
 * Obtenu via la factory `createClientKernel()` — jamais un singleton de module
 * (testabilité, HMR-safe). Chaque primitive du Core reste utilisable NUE sans
 * kernel (opt-in strict, ADR-0007 D7).
 */
export interface IClientKernel {
  // ── Composition — registre de services nommés, typé par augmentation ──────
  /** Récupère un service enregistré (ou `undefined` s'il n'est pas composé). */
  get<K extends keyof NodefonyClientServices>(
    name: K,
  ): NodefonyClientServices[K];
  /** Enregistre un service sous son nom contractuel. */
  set<K extends keyof NodefonyClientServices>(
    name: K,
    svc: NodefonyClientServices[K],
  ): void;
  /** Teste la présence d'un service (nom libre, y compris hors contrat). */
  has(name: string): boolean;

  // ── Lifecycle (ADR-0007 D5) ────────────────────────────────────────────────
  /** Compose et connecte les services (idempotent). Émet `onBoot` puis `onReady`. */
  boot(): Promise<void>;
  /** Flush l'observabilité et déconnecte (best-effort sur `pagehide`). Émet `onTerminate`. */
  terminate(): Promise<void>;
  /** État courant du kernel — jamais régressif. */
  readonly state: ClientKernelState;

  // ── Identité (ADR-0007 D9) ─────────────────────────────────────────────────
  /**
   * Déclare l'identité runtime courante — c'est l'application qui la connaît
   * (login, logout, bascule de compte), le kernel qui en tire les conséquences.
   *
   * Sur un **vrai** changement de clé, et lui seul, le kernel re-négocie la
   * socket puis émet `onIdentityChange`. Sans cette porte d'entrée, D9 resterait
   * une intention : le kernel n'a aucun moyen d'apprendre qu'un login a eu lieu.
   */
  setIdentity(identity: ClientIdentity | null): void;
  /** Identité runtime courante, telle que l'application l'a déclarée. */
  readonly identity: ClientIdentity | null;

  // ── Événements ─────────────────────────────────────────────────────────────
  /** Abonne un handler à un événement du kernel (API `Event` du Core, chaînable). */
  on(event: ClientKernelEvent, handler: (...args: unknown[]) => void): this;

  // ── Observabilité (ADR-0007 D8) ────────────────────────────────────────────
  /**
   * Journal client de série (`Pdu` isomorphes — corrélables au back par
   * `requestId`).
   *
   * L'ADR-0007 nommait ce membre `log`. Le nom ne pouvait pas tenir : tout
   * `Service` Nodefony porte déjà `log(...)` comme **méthode d'écriture**, et le
   * kernel client en est un — une propriété du même nom masquait le geste
   * d'écriture de toute la lignée. `syslog` est le nom que le framework donne
   * partout ailleurs à ce même objet (`Service.syslog`, `kernel.syslog`) :
   * l'isomorphisme, c'est le même modèle mental des deux côtés du fil.
   */
  readonly syslog: Syslog;
}

/**
 * `IClientKernel` — contrat du kernel client isomorphe de Nodefony (ADR-0007).
 *
 * Publié **types-only** avec `nodefony@10` : gèle le nom et la surface du futur
 * `createClientKernel()` (implémentation Phase 3.2, 1ᵉʳ consommateur = debug-client)
 * sans embarquer un octet de runtime. Ce fichier EST la spécification — toute
 * évolution de surface passe par un nouvel ADR.
 *
 * Le ClientKernel est le chef d'orchestre de la couche **INFRA** d'une app front
 * (composition des services techniques, lifecycle navigateur, observabilité,
 * cycle d'identité). Il ne possède JAMAIS le rendu, le routing ni l'état métier
 * (React/Vue/Angular + stores restent maîtres de la vue) — clause anti-dérive
 * ADR-0007 D1.
 *
 * @module nodefony/client
 */
import type Syslog from "../syslog/Syslog";
import type { IRealtimeSocket } from "../realtime/IRealtimeSocket";

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
 *   compte). Le kernel re-négocie la socket (anti-élévation de privilège,
 *   ADR-0007 D9) puis notifie l'app pour qu'elle purge ses caches scopés.
 * - `onVisibility` — `document.visibilitychange`.
 * - `onOnline` — bascule `online`/`offline` du navigateur.
 * - `onTerminate` — page en cours de déchargement (`pagehide`/`beforeunload`,
 *   best-effort).
 */
export type ClientKernelEvent =
  | "onBoot"
  | "onReady"
  | "onIdentityChange"
  | "onVisibility"
  | "onOnline"
  | "onTerminate";

/**
 * Registre TYPÉ des services techniques portés par le kernel client.
 *
 * Extensible par **augmentation de module** (même mécanique que le registre de
 * config `NodefonyModuleConfig` back, ADR-0006) : un module/une app déclare ses
 * services sans jamais modifier ce contrat.
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
  realtime?: IRealtimeSocket;
}

/**
 * Contrat du kernel client isomorphe (ADR-0007 D2 — surface v1, volontairement
 * minimale : chaque méthode publiée est une promesse SemVer).
 *
 * Obtenu via la factory `createClientKernel()` (Phase 3.2) — jamais un singleton
 * de module (testabilité, HMR-safe). Chaque primitive du Core reste utilisable
 * NUE sans kernel (opt-in strict, ADR-0007 D7).
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

  // ── Événements ─────────────────────────────────────────────────────────────
  /** Abonne un handler à un événement du kernel (API `Event` du Core, chaînable). */
  on(event: ClientKernelEvent, handler: (...args: unknown[]) => void): this;

  // ── Observabilité (ADR-0007 D8) ────────────────────────────────────────────
  /** Logger client de série (`Pdu` isomorphes — corrélables au back par `requestId`). */
  readonly log: Syslog;
}

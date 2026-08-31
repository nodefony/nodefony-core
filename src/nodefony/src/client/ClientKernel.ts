/**
 * `ClientKernel` — implémentation du kernel client isomorphe (ADR-0007).
 *
 * Le pendant navigateur du `Kernel` serveur : il compose les services techniques
 * d'une application front, porte son cycle de vie, son observabilité et son cycle
 * d'identité. Il ne possède **jamais** le rendu, le routing ni l'état métier
 * (clause anti-dérive D1) — React/Vue/Angular restent maîtres de la vue.
 *
 * Il **compose** un {@link Service} du cœur plutôt que d'en hériter, et ce choix
 * s'est décidé au compilateur : `Service.get`/`set` sont la façade du container
 * d'injection, dont la sémantique est « n'importe quel objet sous n'importe quel
 * nom » (`get<T>(name: string): T | null`), tandis que le registre du kernel est
 * **typé et fermé** par le contrat (`get(name): NodefonyClientServices[K]`).
 * Hériter revenait à resserrer une méthode publique de la classe de base — TS2416,
 * et le refus dit une vérité de conception : deux mécanismes différents portaient
 * le même nom. La composition garde les briques isomorphes du cœur (bus
 * d'événements, `Syslog`) sans exposer une surface qui n'est pas celle du contrat.
 *
 * Le budget bundle n'augmente pas de ce fait : `Service` et `Syslog` sont déjà
 * publiés par `nodefony/client`.
 *
 * @module nodefony/client
 */
import Service from "../Service";
import type Syslog from "../syslog/Syslog";
import { RealtimeClient } from "./realtime/RealtimeClient";
import type {
  ClientIdentity,
  ClientKernelEvent,
  ClientKernelOptions,
  ClientKernelState,
  IClientKernel,
  NodefonyClientServices,
} from "./IClientKernel";

/** Un débranchement de listener navigateur, mémorisé pour être défait. */
type Unbind = () => void;

/**
 * Kernel client — obtenu par {@link createClientKernel}, jamais construit en
 * singleton de module (testabilité, HMR-safe : un module réévalué par Vite
 * dédoublerait un singleton, gotcha vécu sur le contexte React de Studio).
 */
export class ClientKernel implements IClientKernel {
  /** Journal client de série — `Pdu` isomorphes, corrélables au back. */
  readonly syslog: Syslog;

  /** Bus d'événements et journal du cœur — la brique isomorphe, pas une copie. */
  readonly #service: Service;
  /** Options de composition, relues au `boot()` — le constructeur ne connecte rien. */
  readonly #options: ClientKernelOptions;

  #state: ClientKernelState = "created";
  #identity: ClientIdentity | null = null;
  /**
   * Promesse du `boot()` en cours — c'est ELLE qui rend l'appel idempotent, y
   * compris pour deux appels concurrents : le second attend le premier au lieu
   * de composer une seconde fois.
   */
  #booting: Promise<void> | null = null;
  /**
   * Registre des services composés. `null` tant que rien n'est enregistré (règle
   * perf : pas de structure allouée « au cas où »). Un objet sans prototype
   * plutôt qu'une `Map` — moins de trois entrées, accès ponctuel.
   */
  #services: Record<string, unknown> | null = null;
  /**
   * Débranchements des listeners navigateur. `null` tant qu'aucun n'est posé —
   * un kernel monté en test, ou hors document, n'en pose aucun.
   */
  #unbind: Unbind[] | null = null;

  constructor(options: ClientKernelOptions = {}) {
    this.#options = options;
    // `Service` fabrique son propre `Syslog` quand aucun container ne lui en
    // fournit : le journal du kernel est donc celui du cœur, pas un doublon.
    this.#service = new Service(options.name ?? "CLIENT KERNEL");
    this.syslog = this.#service.syslog as Syslog;
    // La composition a lieu ICI, pas au `boot()` : une application câble ses
    // magasins sur les services du kernel AVANT de le démarrer — le portage de
    // la console d'administration l'a montré, elle a besoin de la socket pour
    // construire son centre de notifications et son client d'API. Composer
    // n'ouvre rien : `RealtimeClient.shared()` fabrique, `boot()` connecte.
    this.#composeRealtime();
  }

  // ── Composition ────────────────────────────────────────────────────────────

  /**
   * Récupère un service composé, typé par le registre.
   *
   * Rend `undefined` pour un service absent — le registre est décrit par des
   * propriétés optionnelles, si bien que `kernel.get("realtime")` est de type
   * `RealtimeClient | undefined` et nourrit `<NodefonyProvider client={…}>` sans
   * la moindre conversion de type forcée.
   */
  get<K extends keyof NodefonyClientServices>(
    name: K,
  ): NodefonyClientServices[K] {
    if (!this.#services) return undefined;
    return this.#services[name as string] as NodefonyClientServices[K];
  }

  /** Enregistre un service sous son nom contractuel. */
  set<K extends keyof NodefonyClientServices>(
    name: K,
    svc: NodefonyClientServices[K],
  ): void {
    (this.#services ??= Object.create(null) as Record<string, unknown>)[
      name as string
    ] = svc;
  }

  /** Teste la présence d'un service — nom libre, y compris hors contrat. */
  has(name: string): boolean {
    return this.#services !== null && this.#services[name] !== undefined;
  }

  // ── Lifecycle (D5) ─────────────────────────────────────────────────────────

  /** État courant — jamais régressif. */
  get state(): ClientKernelState {
    return this.#state;
  }

  /**
   * Compose et connecte les services. **Idempotent** : rappelé pendant ou après
   * un premier boot, il ne recompose rien et ne réémet aucun événement. Depuis
   * l'état `terminated`, il ne fait rien — l'état ne régresse jamais.
   */
  boot(): Promise<void> {
    if (this.#state === "terminated" || this.#state === "ready") {
      return Promise.resolve();
    }
    if (this.#booting) return this.#booting;
    this.#booting = this.#doBoot();
    return this.#booting;
  }

  async #doBoot(): Promise<void> {
    this.#state = "booting";
    this.#service.fire("onBoot", this);
    this.#bindBrowser();
    const socket =
      this.#options.connectOnBoot === false ? undefined : this.get("realtime");
    if (socket) {
      try {
        await socket.connect();
      } catch (e) {
        // Une socket qui ne s'ouvre pas ne doit pas empêcher l'application de
        // vivre : `RealtimeClient` se reconnecte seul. Le kernel devient `ready`
        // — les écrans qui ne dépendent pas du temps réel doivent s'afficher.
        this.syslog.log(e instanceof Error ? e.message : String(e), "WARNING");
      }
    }
    // `terminate()` peut avoir été appelé PENDANT la connexion (onglet fermé au
    // chargement) : l'état ne régresse jamais, `ready` ne doit pas écraser
    // `terminated`.
    if (this.#state !== "booting") return;
    this.#state = "ready";
    this.#service.fire("onReady", this);
  }

  /**
   * Compose la socket depuis les options — instance passée telle quelle, ou
   * socket partagée fabriquée depuis ses options (une seule connexion par URL).
   * Rien n'est fabriqué quand l'application n'en veut pas : l'opt-in est strict
   * (D7), le kernel compose, il n'impose pas.
   */
  #composeRealtime(): void {
    if (this.has("realtime")) return;
    const opt = this.#options.realtime;
    if (!opt) return;
    this.set(
      "realtime",
      opt instanceof RealtimeClient ? opt : RealtimeClient.shared(opt),
    );
  }

  /**
   * Flush l'observabilité et déconnecte. Idempotent, et **best-effort** : appelé
   * sur `pagehide`, il n'a aucune garantie d'aller au bout — d'où l'ordre choisi,
   * l'événement d'abord, le débranchement ensuite.
   */
  async terminate(): Promise<void> {
    if (this.#state === "terminated") return;
    // L'état bascule AVANT l'émission : un handler qui rappellerait `boot()`
    // depuis `onTerminate` ne doit pas ressusciter le kernel.
    this.#state = "terminated";
    this.#service.fire("onTerminate", this);
    const socket = this.get("realtime");
    if (socket) socket.disconnect();
    this.#unbindBrowser();
    this.#booting = null;
    this.#services = null;
    // Retire les listeners trackés par `Service` et détache son container : sans
    // cela un kernel de test garderait vivants ses handlers.
    this.#service.clean();
  }

  // ── Identité (D9) ──────────────────────────────────────────────────────────

  /** Identité runtime courante, telle que l'application l'a déclarée. */
  get identity(): ClientIdentity | null {
    return this.#identity;
  }

  /**
   * Déclare l'identité runtime — et applique la règle de sécurité D9, née d'une
   * fuite vécue en production.
   *
   * Deux gardes, chacune payée par une régression réelle :
   *
   * 1. **`disconnect()` uniquement sur un VRAI changement de compte** (une clé
   *    connue remplacée par une autre). La socket grave l'identité au handshake ;
   *    le pont « API souveraine » rejouerait sinon des requêtes avec le jeton du
   *    compte précédent. Couper impose un nouveau handshake, donc la relecture du
   *    cookie courant.
   * 2. **`connect()` HORS de cette garde.** Au tout premier chargement, la clé
   *    passe de `null` à une valeur : couper là romprait les requêtes EN VOL qui
   *    passent par le pont, et l'écran resterait en attente jusqu'au délai de
   *    garde (régression « tourne en boucle »).
   *
   * Une clé inchangée n'est pas un changement de compte : le profil est rafraîchi
   * en silence, sans toucher à la socket ni réveiller l'application.
   */
  setIdentity(identity: ClientIdentity | null): void {
    const previous = this.#identity;
    const previousKey = previous ? previous.key : null;
    const key = identity ? identity.key : null;
    this.#identity = identity;
    if (previousKey === key) return;
    const socket = this.get("realtime");
    if (socket) {
      if (previousKey !== null) socket.disconnect();
      if (key !== null) void socket.connect();
    }
    this.#service.fire("onIdentityChange", identity, previous);
  }

  // ── Événements ─────────────────────────────────────────────────────────────

  /** Abonne un handler à un événement du kernel (bus `Event` du cœur, chaînable). */
  on(event: ClientKernelEvent, handler: (...args: unknown[]) => void): this {
    this.#service.on(event, handler);
    return this;
  }

  /** Retire un handler abonné par {@link on}. */
  off(event: ClientKernelEvent, handler: (...args: unknown[]) => void): this {
    this.#service.removeListener(event, handler);
    return this;
  }

  // ── Pont d'événements navigateur (D5) ──────────────────────────────────────

  /**
   * Ponte les événements du navigateur sur ceux du kernel.
   *
   * `pagehide` et non `beforeunload` : ce dernier n'est pas fiable sur mobile
   * (bfcache), et le contrat ne nomme que l'événement kernel — le choix du
   * listener reste une affaire d'implémentation.
   */
  #bindBrowser(): void {
    if (this.#options.browserEvents === false) return;
    const doc: Document | undefined = globalThis.document;
    const win: Window | undefined = globalThis.window;
    if (!doc || !win) return;
    const bind = (
      target: Document | Window,
      type: string,
      handler: () => void,
    ): void => {
      target.addEventListener(type, handler);
      (this.#unbind ??= []).push(() =>
        target.removeEventListener(type, handler),
      );
    };
    bind(doc, "visibilitychange", () =>
      this.#service.fire("onVisibility", doc.visibilityState !== "hidden"),
    );
    bind(win, "online", () => this.#service.fire("onOnline", true));
    bind(win, "offline", () => this.#service.fire("onOnline", false));
    bind(win, "pagehide", () => void this.terminate());
  }

  /** Défait tous les listeners navigateur — appelé par `terminate()`, une fois. */
  #unbindBrowser(): void {
    if (!this.#unbind) return;
    for (const off of this.#unbind) off();
    this.#unbind = null;
  }

  /**
   * Nombre de listeners navigateur encore posés.
   *
   * Sonde de fuite à l'usage des tests : un kernel terminé doit en compter zéro,
   * et c'est la seule façon de le CONSTATER plutôt que de le supposer.
   */
  get browserListenerCount(): number {
    return this.#unbind ? this.#unbind.length : 0;
  }
}

/**
 * Fabrique un kernel client.
 *
 * Factory et non singleton : plusieurs kernels doivent pouvoir coexister en test,
 * et un état de module global se dédouble sous le rechargement à chaud de Vite.
 *
 * @example
 * ```typescript
 * const kernel = createClientKernel({ realtime: { url: "/nodefony/realtime" } });
 * await kernel.boot();
 * kernel.setIdentity({ key: user.id });
 * ```
 */
export function createClientKernel(
  options: ClientKernelOptions = {},
): ClientKernel {
  return new ClientKernel(options);
}

export default ClientKernel;

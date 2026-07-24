import { DebugType, EnvironmentType } from "./types/globals";
import type {
  IService,
  DefaultOptionsService,
  EventListener,
} from "./types/IService";
import type { IKernel } from "./types/IKernel";
import Container, { DynamicParam } from "./Container";
import Event, { EventDefaultInterface } from "./Event";
import type { IGuardedEmitOptions, IGuardedEmitResult } from "./Event";
import Pdu, { Severity, Msgid, Message, Pci } from "./syslog/Pdu";
import Syslog, {
  SyslogDefaultSettings,
  conditionsInterface,
} from "./syslog/Syslog";

const defaultOptions: DefaultOptionsService = {
  events: {
    nbListeners: 20,
  },
};

const defaultSyslogSettings: SyslogDefaultSettings = {
  moduleName: "SERVICE ",
  defaultSeverity: "INFO",
};

/**
 * Brique de base de tout composant Nodefony — câble un nom, un {@link Container} DI,
 * un {@link Syslog} et un bus d'événements {@link Event} (notificationsCenter).
 *
 * Tous les services, modules, kernels et controllers héritent de cette classe.
 * Délègue son API EventEmitter à `notificationsCenter` et son API DI au `container`.
 *
 * Cycle de vie attendu :
 * - `new Service(name, container?, nc?, options?)` — initialise les dépendances
 * - `initSyslog(env, debug, options?)` — démarre la sortie console (optionnel)
 * - `clean()` — retire les listeners trackés et libère les références
 *
 * @remarks Si `notificationsCenter === false`, le service est créé sans bus
 *   d'événements — utile pour des services purement utilitaires.
 */
class Service implements IService {
  public name: string;
  public options: DefaultOptionsService;
  public container: Container | null;
  public kernel: IKernel | null;
  public syslog: Syslog | null;

  // Backing field privé — lecture externe via getter notificationsCenter.
  #nc: Event | undefined;
  // Listeners enregistrés via l'API de ce service — retirés de l'Event partagé à clean().
  #trackedListeners: Map<string | symbol, EventListener[]> = new Map();
  // true si #nc est un Event externe partagé (pas auto-créé).
  #sharedNc = false;

  get notificationsCenter(): Event | undefined {
    return this.#nc;
  }

  // Getter privé avec guard — élimine le if/throw dupliqué sur les 18 méthodes events.
  private get nc(): Event {
    if (!this.#nc) {
      throw new Error(`${this.name}: notificationsCenter not initialized`);
    }
    return this.#nc;
  }

  /**
   * Initialise le service — réutilise les ressources du conteneur si possible,
   * sinon les crée à la volée.
   *
   * @param name - identifiant logique du service (apparaît dans les logs comme `msgid`).
   * @param container - {@link Container} DI partagé ; sinon un nouveau est instancié.
   * @param notificationsCenter - {@link Event} bus existant à partager, ou `false`
   *   pour désactiver les events, ou `null`/`undefined` pour créer un bus dédié.
   * @param options - surcharge des défauts (`events.nbListeners`, `syslog.moduleName`…).
   */
  constructor(
    name: string,
    container?: Container,
    notificationsCenter?: Event | false | null,
    options: DefaultOptionsService = {},
  ) {
    this.name = name;
    this.container =
      container instanceof Container ? container : new Container();
    this.options =
      notificationsCenter === false
        ? { ...options }
        : { ...defaultOptions, ...options };
    this.kernel = this.container.get<IKernel>("kernel");
    this.syslog = this.container.get<Syslog>("syslog");

    if (!this.syslog) {
      // Variable locale — pas besoin d'un champ d'instance.
      const syslogSettings: SyslogDefaultSettings = {
        ...defaultSyslogSettings,
        moduleName: this.name,
        ...(this.options.syslog ?? {}),
      };
      this.syslog = new Syslog(syslogSettings);
      this.container.set("syslog", this.syslog);
    }

    if (notificationsCenter instanceof Event) {
      this.#sharedNc = true;
      this.#nc = notificationsCenter;
      // Listeners injectés par config sur un bus PARTAGÉ → passer par notre
      // wrapper tracké (this.on) sinon clean() ne les retire pas (fuite à
      // chaque construction d'instance — règle absolue perf+mémoire).
      this.attachConfiguredListeners(options);
      // Bus PARTAGÉ : on ne peut que RELEVER son plafond, jamais l'abaisser.
      //
      // `this.options` (fusionné avec `defaultOptions`), PAS le paramètre brut :
      // lire `options` ignorait le défaut `nbListeners: 20` dès que l'appelant
      // n'en passait pas — c'est-à-dire presque toujours.
      //
      // Mais appliquer ce défaut tel quel sur un bus qu'on ne possède PAS le
      // rabaissait : le Kernel dimensionne le sien à 60 (un module ou service =
      // au moins un listener de cycle de vie), puis chaque Service construit
      // ensuite avec ce même bus y réécrivait 20 — le dernier arrivé décidait.
      // À partir d'une quinzaine de modules, le boot se mettait à crier
      // `MaxListenersExceededWarning` sur `onPreBoot`/`onBoot` alors que rien
      // ne fuyait : le plafond avait simplement été écrasé par un invité.
      const shared = this.#nc.getMaxListeners();
      const wanted = this.options.events?.nbListeners ?? 0;
      if (wanted > shared) {
        this.#nc.setMaxListeners(wanted);
      }
    } else if (notificationsCenter !== false) {
      this.#nc = new Event(this.options, this, this.options);
      if (this.options.events?.nbListeners) {
        this.#nc.setMaxListeners(this.options.events.nbListeners);
      }
      if (!this.kernel || this.kernel.container !== this.container) {
        this.container.set("notificationsCenter", this.#nc);
      }
    }

    // `delete` (et non `= undefined`) — `server-static.ts:initStaticFiles`
    // itère `for (... in this.options)` et appelle `.path` sur chaque valeur
    // (suppose la clé `events` ABSENTE après ctor). Le supposé gain V8 hidden
    // class de `= undefined` est annulé par les `if (!v) continue` à ajouter
    // chez tous les consommateurs (pattern `for...in` répandu).
    delete this.options.events;
  }

  /**
   * Convention `onXxx` → enregistre les listeners déclarés en config (clé
   * matchant `/^on(.+)$/`) via {@link Service.on} pour que {@link clean}
   * puisse les retirer du bus partagé. Variante trackée de
   * {@link Event.settingsToListen}.
   */
  private attachConfiguredListeners(
    localSettings: DefaultOptionsService,
  ): void {
    for (const key of Object.keys(localSettings)) {
      if (!/^on(.+)$/.test(key)) continue;
      const handler = (localSettings as Record<string, unknown>)[key];
      if (typeof handler !== "function") continue;
      this.on(key, (handler as EventListener).bind(this));
    }
  }

  /**
   * Démarre la sortie console du Syslog avec l'environnement et la verbosité voulus.
   *
   * @param environment - `"production"` (défaut) ou `"development"`.
   * @param debug - flag de verbosité (true ou {@link DebugType}).
   * @param options - {@link conditionsInterface} pour filtrer les Pdu (severity, msgid…).
   * @returns le résultat de {@link Syslog.init} ou `null` si pas de Syslog.
   */
  initSyslog(
    environment: EnvironmentType = "production",
    debug: DebugType = false,
    options?: conditionsInterface,
  ): ReturnType<Syslog["init"]> | null {
    return this.syslog ? this.syslog.init(environment, debug, options) : null;
  }

  /** Renvoie le nom logique du service (utilisé comme `msgid` syslog par défaut). */
  getName(): string {
    return this.name;
  }

  /**
   * Libère les ressources — retire les listeners trackés du bus partagé pour
   * éviter les fuites mémoire, puis détache container/kernel/syslog/nc.
   *
   * @param syslog - si `true`, appelle aussi {@link Syslog.reset} (transports fermés).
   * @remarks Après `clean()`, toute API héritée (log, event, container) lèvera une erreur.
   */
  clean(syslog = false): void {
    // Retire les listeners de l'Event partagé pour éviter les fuites mémoire.
    if (this.#nc && this.#sharedNc) {
      for (const [event, listeners] of this.#trackedListeners) {
        for (const listener of listeners) {
          this.#nc.removeListener(event, listener);
        }
      }
    }
    this.#trackedListeners.clear();
    this.#sharedNc = false;
    if (this.syslog && syslog) {
      this.syslog.reset();
    }
    this.syslog = null;
    this.#nc = undefined;
    this.container = null;
    this.kernel = null;
  }

  /**
   * Émet une entrée de log structurée — point d'entrée central pour TOUT log Nodefony.
   *
   * @param pci - charge utile (string, objet, Error…). Stockée dans {@link Pdu.payload}.
   * @param severity - niveau syslog (`INFO`, `WARNING`, `ERROR`, `CRITIC`, `DEBUG`…).
   * @param msgid - identifiant logique ; défaut = `this.name`.
   * @param msg - message libre additionnel.
   * @returns le {@link Pdu} émis (utile pour chaîner des transports).
   * @remarks Si syslog est down, fabrique un Pdu directement et catch toute exception.
   */
  log(pci: Pci, severity?: Severity, msgid?: Msgid, msg?: Message): Pdu {
    try {
      if (!msgid) {
        msgid = this.name;
      }
      if (this.syslog) {
        return this.syslog.log(pci, severity, msgid, msg);
      }
      return new Pdu(pci, severity, this.name, msgid, msg);
    } catch (e) {
      console.log(severity, msgid, msg, " : ", pci);
      console.warn(e);
      return new Pdu(e, "ERROR", this.name, msgid, msg);
    }
  }

  /** Raccourci debug — log severity `DEBUG` + `console.debug` formaté. */
  logger(pci: Pci, ...args: unknown[]): void {
    console.debug(Syslog.wrapper(this.log(pci, "DEBUG")).text, pci, ...args);
  }

  /** Comme {@link logger} mais `console.trace` (avec stack trace). */
  trace(pci: Pci, ...args: unknown[]): void {
    console.trace(Syslog.wrapper(this.log(pci, "DEBUG")).text, pci, ...args);
  }

  /** Log severity `SPINNER` — utilisé par le CLI pour animer un spinner. */
  spinlog(message: string): Pdu {
    return this.log(message, "SPINNER");
  }

  // ─── Tracking interne des listeners ────────────────────────────────────────

  private trackListener(
    eventName: string | symbol,
    listener: EventListener,
  ): void {
    const list = this.#trackedListeners.get(eventName) ?? [];
    list.push(listener);
    this.#trackedListeners.set(eventName, list);
  }

  private untrackListener(
    eventName: string | symbol,
    listener: EventListener,
  ): void {
    const list = this.#trackedListeners.get(eventName);
    if (!list) return;
    const idx = list.indexOf(listener);
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) this.#trackedListeners.delete(eventName);
  }

  // ─── Events — délégation vers #nc ──────────────────────────────────────────
  // Chaque listener enregistré via cette API est tracké : `clean()` les retire
  // automatiquement du bus partagé pour éviter les fuites entre services.

  /** Liste les noms d'événements ayant au moins un listener. */
  eventNames(): (string | symbol)[] {
    return this.nc.eventNames();
  }

  /** Alias `emit` — émet l'événement de manière synchrone. */
  fire(eventName: string | symbol, ...args: unknown[]): boolean {
    return this.nc.emit(eventName, ...args);
  }

  /** Émet l'événement et attend que tous les listeners async résolvent. */
  fireAsync(eventName: string | symbol, ...args: unknown[]): Promise<unknown> {
    return this.nc.emitAsync(eventName, ...args);
  }

  /** Émet l'événement (API EventEmitter standard). */
  emit(eventName: string | symbol, ...args: unknown[]): boolean {
    return this.nc.emit(eventName, ...args);
  }

  /** Émet et attend les listeners async — équivalent de {@link fireAsync}. */
  emitAsync(eventName: string | symbol, ...args: unknown[]): Promise<unknown> {
    return this.nc.emitAsync(eventName, ...args);
  }

  /**
   * Variante **gardée** de {@link emitAsync} (cf `Event.emitAsyncGuarded`) : isole
   * chaque listener par try/catch + timeout et collecte les échecs. Réservé au
   * **boot / lifecycle / jobs** (cf `Kernel.fireLifecycle`) — JAMAIS le hot path.
   */
  emitAsyncGuarded(
    eventName: string | symbol,
    options?: IGuardedEmitOptions,
    ...args: unknown[]
  ): Promise<IGuardedEmitResult> {
    return this.nc.emitAsyncGuarded(eventName, options, ...args);
  }

  /** Enregistre un listener (tracké pour cleanup). Voir aussi {@link on}. */
  addListener(eventName: string | symbol, listener: EventListener): this {
    this.nc.addListener(eventName, listener);
    this.trackListener(eventName, listener);
    return this;
  }

  /**
   * Bind le listener sur `this` puis l'enregistre — utile quand le listener
   * référence `this.foo` et ne peut pas être tracké à l'identique.
   *
   * @returns le listener wrappé (ne PAS passer le listener original à `off()`).
   */
  listen(
    eventName: string | symbol,
    listener: EventListener,
  ): (...args: unknown[]) => boolean {
    // listen() bind le listener avant de l'enregistrer — on ne peut pas tracker l'original.
    return this.nc.listen(this, eventName, listener) as (
      ...args: unknown[]
    ) => boolean;
  }

  /** Enregistre un listener (tracké pour cleanup). Alias EventEmitter de {@link addListener}. */
  on(eventName: string | symbol, listener: EventListener): this {
    this.nc.on(eventName, listener);
    this.trackListener(eventName, listener);
    return this;
  }

  /** Enregistre un listener one-shot — auto-retiré après le premier `emit`. */
  once(eventName: string | symbol, listener: EventListener): this {
    // Node.js stocke listener.listener = original → removeListener(original) fonctionne.
    this.nc.once(eventName, listener);
    this.trackListener(eventName, listener);
    return this;
  }

  /** Retire un listener (alias EventEmitter de {@link removeListener}). */
  off(eventName: string | symbol, listener: EventListener): this {
    this.nc.off(eventName, listener);
    this.untrackListener(eventName, listener);
    return this;
  }

  /**
   * Enregistre les événements déclarés dans `localSettings.events.listeners`
   * — utilisé en config pour mapper des hooks sans code impératif.
   */
  settingsToListen(
    localSettings: EventDefaultInterface,
    context: object,
  ): void {
    this.nc.settingsToListen(localSettings, context);
  }

  /** Augmente la limite Node.js (défaut 10) pour éviter le warning MaxListeners. */
  setMaxListeners(n: number): this {
    this.nc.setMaxListeners(n);
    return this;
  }

  /** Retire un listener spécifique et nettoie le tracking interne. */
  removeListener(eventName: string | symbol, listener: EventListener): this {
    this.nc.removeListener(eventName, listener);
    this.untrackListener(eventName, listener);
    return this;
  }

  /** Retire tous les listeners (ou ceux d'un événement précis si fourni). */
  removeAllListeners(eventName?: string | symbol): this {
    if (eventName !== undefined) {
      this.#trackedListeners.delete(eventName);
      this.nc.removeAllListeners(eventName);
    } else {
      this.#trackedListeners.clear();
      this.nc.removeAllListeners();
    }
    return this;
  }

  /** Comme {@link once} mais inséré en tête de la liste des listeners. */
  prependOnceListener(
    eventName: string | symbol,
    listener: EventListener,
  ): this {
    this.nc.prependOnceListener(eventName, listener);
    this.trackListener(eventName, listener);
    return this;
  }

  /** Comme {@link on} mais inséré en tête de la liste des listeners. */
  prependListener(eventName: string | symbol, listener: EventListener): this {
    this.nc.prependListener(eventName, listener);
    this.trackListener(eventName, listener);
    return this;
  }

  /** Limite courante de listeners avant warning Node.js. */
  getMaxListeners(): number {
    return this.nc.getMaxListeners();
  }

  /** Nombre de listeners attachés à un événement (filtré sur `listener` si fourni). */
  listenerCount(eventName: string | symbol, listener?: EventListener): number {
    return this.nc.listenerCount(eventName, listener);
  }

  /** Copie de la liste des listeners (résolus, sans le wrapper `once`). */
  listeners(eventName: string | symbol): EventListener[] {
    return this.nc.listeners(eventName) as EventListener[];
  }

  /** Comme {@link listeners} mais retourne les wrappers Node.js bruts (avec once). */
  rawListeners(eventName: string | symbol): EventListener[] {
    return this.nc.rawListeners(eventName) as EventListener[];
  }

  // ─── Container — délégation ─────────────────────────────────────────────────
  // Façade safe-null : les accesseurs retournent `null` plutôt que de jeter
  // quand le container a déjà été détaché par `clean()`.

  /** Récupère un service du DI container par nom. Retourne `null` si absent ou clean(). */
  get<T>(name: string): T | null {
    return this.container?.get<T>(name) ?? null;
  }

  /**
   * Enregistre un objet dans le DI container.
   * @throws Error si `clean()` a déjà détaché le container.
   */
  set<T>(name: string, obj: T): void {
    if (!this.container) {
      throw new Error(`${this.name}: container not initialized`);
    }
    this.container.set(name, obj);
  }

  /**
   * Retire un service du container — si c'est un `Service`, appelle d'abord
   * son `clean()` pour libérer ses listeners.
   * @returns `true` si retiré, `false` si introuvable ou container détaché.
   */
  remove(name: string): boolean {
    if (this.container) {
      const ele = this.get(name);
      if (ele) {
        if (ele instanceof Service) {
          ele.clean();
        }
        return this.container.remove(name);
      }
    }
    return false;
  }

  /** Récupère un paramètre dynamique (config résolue) — `null` si absent. */
  getParameters(name: string): DynamicParam | null {
    return this.container?.getParameters(name) ?? null;
  }

  /**
   * Définit un paramètre dynamique dans le container.
   * @throws Error si `clean()` a déjà détaché le container.
   */
  setParameters<T>(name: string, ele: T): DynamicParam | null {
    if (!this.container) {
      throw new Error(`${this.name}: container not initialized`);
    }
    return this.container.setParameters(name, ele);
  }

  /** Vérifie l'existence d'un service ou paramètre dans le container. */
  has(name: string): boolean {
    return this.container?.has(name) ?? false;
  }
}

export default Service;
// Ré-exports pour compatibilité avec les imports existants (Kernel, Module, Cli, etc.)
export type { IService, IKernel, DefaultOptionsService, EventListener };

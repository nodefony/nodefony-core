import {
  extend,
  Nodefony,
  Service,
  //Kernel,
  Container,
  Event,
  Module,
  // FamilyType,
  //DynamicService,
  ProtoService,
  ProtoParameters,
  inject,
  injectable,
} from "nodefony";
import HttpKernel, {
  //ProtocolType,
  //ServerType,
  ContextType,
  //httpRequest,
} from "../http-kernel";
import { HTTPMethod } from "../../src/context/Context";
import Session, { OptionsSessionType } from "../../src/session/session";
import Http2Request from "../../src/context/http2/Request";
import HttpRequest from "../../src/context/http/Request";
import Certificate from "../../service/certificates";
import { createHash } from "node:crypto";
import FileSessionStorage from "../../src/session/storage/FileSessionStorage";

export type sessionStrategyType = "none" | "migrate" | "invalidate";
export type sessionStorageType = any; //  "orm" | "memcached" | "redis" | "fileSystem" | "memory";

export type FlashBagSessionType = Record<string, any>;
export type MetaBagSessionType = Record<string, any>;
export interface SerializeSessionType {
  Attributes: ProtoService;
  metaBag: ProtoParameters;
  flashBag: FlashBagSessionType;
  user: string;
}

export interface sessionStorageInterface {
  read: (name: string) => Promise<SerializeSessionType>;
  write: (
    name: string,
    serialize: SerializeSessionType,
    contextSession: string
  ) => Promise<SerializeSessionType>;
  start: (id: string, contextSession: string) => Promise<SerializeSessionType>;
  open: (contextSession: string) => Promise<number>;
  close: () => boolean;
  destroy: (id: string, contextSession: string) => Promise<boolean>;
  gc: (maxlifetime: number, contextSession: string) => Promise<void>;
}

/** Constructeur d'un storage de session (enregistré dans le registre). */
export type SessionStorageCtor = new (
  manager: SessionsService
) => sessionStorageInterface;

@injectable()
class SessionsService extends Service {
  /**
   * Registre des storages de session — inversion de contrôle.
   *
   * Chaque module qui fournit un storage l'enregistre à son chargement
   * (`SessionsService.registerStorage("drizzle", DrizzleStorage)`). Ainsi
   * `@nodefony/http` **ne dépend d'aucun ORM** : pas d'import croisé, pas de
   * cycle, et ajouter un driver ne touche plus ce fichier. Le handler de la
   * config (`session.handler`) sélectionne le storage par son nom.
   */
  static readonly #storages = new Map<string, SessionStorageCtor>();

  /**
   * Enregistre un storage de session sous un nom de handler (insensible à la
   * casse) et émet l'événement kernel `onRegisterSessionStorage` (observabilité
   * Studio / extension). Le kernel peut être absent au tout premier chargement
   * (registration statique) → fire gardé.
   */
  static registerStorage(name: string, ctor: SessionStorageCtor): void {
    const key = name.toLowerCase();
    SessionsService.#storages.set(key, ctor);
    const kernel = Nodefony.getKernel();
    kernel?.fire("onRegisterSessionStorage", key, ctor);
    kernel?.log(`SESSION STORAGE registered : ${key}`, "DEBUG", "SESSION");
  }

  /** Storage enregistré pour un handler, ou `undefined`. */
  static getStorage(name: string): SessionStorageCtor | undefined {
    return SessionsService.#storages.get(String(name ?? "").toLowerCase());
  }

  /** Noms des handlers de session enregistrés. */
  static storageHandlers(): string[] {
    return [...SessionsService.#storages.keys()];
  }

  sessionStrategy: sessionStrategyType = "migrate";
  storage: any = null;
  gc_probability: number = 1;
  gc_divisor: number = 100;
  module: Module;
  defaultSessionName: string = "nodefony";
  sessionAutoStart: string | boolean = false;
  secret?: Buffer;
  iv?: Buffer;
  certificates: Certificate | null;
  constructor(
    module: Module,
    @inject("HttpKernel") public httpKernel: HttpKernel
  ) {
    super(
      "sessions",
      module.container as Container,
      module.notificationsCenter as Event,
      module.options.session
    );
    this.module = module;
    this.certificates = this.get<Certificate>("certificates");
    this.gc_probability =
      this.options.gc_probability === "string"
        ? parseInt(this.options.gc_probability, 10)
        : this.options.gc_probability;
    this.gc_divisor = this.options.gc_divisor;
    this.defaultSessionName = this.options.name;
    this.sessionAutoStart = this.setAutoStart(this.options.start);
    this.once("onTerminate", () => {
      if (this.storage) {
        this.storage.close();
      }
    });
  }

  async initialize(): Promise<this> {
    this.secret = this.createSecret();
    this.iv = this.createIv();
    this.initializeStorage();
    return this;
  }

  initializeStorage(): sessionStorageInterface | null {
    const Storage = SessionsService.getStorage(this.options.handler);
    if (!Storage) {
      this.storage = null;
      this.log(
        `SESSION HANDLER STORAGE NOT FOUND : "${this.options.handler}" ` +
          `(enregistrés : ${SessionsService.storageHandlers().join(", ") || "aucun"})`,
        "ERROR"
      );
      return null;
    }
    this.storage = new Storage(this);
    this.log(`SESSION STORAGE active : ${this.options.handler}`, "INFO");
    // Événement (kernel + service) : quel backend de session est actif.
    this.fire("onSessionStorageReady", this.options.handler, this.storage);
    this.kernel?.fire("onSessionStorageReady", this.options.handler, this.storage);
    this.kernel?.on("onReady", async () => {
      await this.storage.open("default");
    });
    return this.storage;
  }

  createSecret(): Buffer {
    const secret = createHash("sha512")
      .update(this.certificates?.key as Buffer)
      .digest();
    return Buffer.from(secret.buffer.slice(0, 32));
  }

  createIv(): Buffer {
    const iv = createHash("sha512")
      .update(this.certificates?.publicKeyPem as Buffer)
      .digest();
    return Buffer.from(iv.buffer.slice(0, 16));
  }

  setAutoStart(auto: string | null | undefined | boolean): string | false {
    switch (auto) {
      case true:
      case "":
      case undefined:
        return "default";
      case false:
      case null:
        return false;
      default:
        if (typeof auto === "string") {
          return auto;
        }
        throw new Error(`Session start settings config error : ${auto}`);
    }
  }

  async start(
    context: ContextType,
    sessionContext?: string
  ): Promise<Session | null> {
    return new Promise((resolve, reject) => {
      if (context.sessionStarting) {
        if (context.session) {
          resolve(context.session);
          return;
        }
        context.once("onSessionStart", (session: Session, error: Error) => {
          if (session) {
            return resolve(session);
          }
          return reject(error || new Error("Bad Session"));
        });
        return;
      }
      if (context.session) {
        if (context.session.status === "active") {
          this.log(
            `SESSION ALLREADY STARTED ==> ${context.session.name} : ${context.session.id}`,
            "DEBUG"
          );
          return resolve(context.session);
        }
      }
      let inst = null;
      try {
        context.sessionStarting = true;
        sessionContext = this.setAutoStart(sessionContext) as string;
        if (this.probaGarbage()) {
          this.storage.gc(this.options.gc_maxlifetime, sessionContext);
        }
        inst = this.createSession(this.defaultSessionName);
      } catch (e) {
        context.fire("onSessionStart", null, e);
        reject(e);
        throw e;
      }
      inst
        .start(context, sessionContext)
        .then((session) => {
          try {
            context.session = session;
            const method = context.method as HTTPMethod;
            const request = context.request as HttpRequest | Http2Request;
            if (method !== "WEBSOCKET" && request && request.request) {
              request.request.session = session;
            }
            context.sessionStarting = false;
            session.setMetaBag("url", new URL(context.url, "http://localhost"));
            if (context.cleaned) {
              return reject(new Error("context already cleaned"));
            }
            context.fire("onSessionStart", session, null);
            return resolve(session);
          } catch (e) {
            if (context.cleaned) {
              return reject(e);
            }
            context.fire("onSessionStart", null, e);
            return reject(e);
          }
        })
        .catch((err) => {
          //console.error(err);
          if (context.cleaned) {
            return reject(err);
          }
          context.fire("onSessionStart", null, err);
          return reject(err);
        });
    });
  }

  saveSession(context: ContextType): Promise<Session | null> {
    //console.log(`SERVICE SESSION : SAVED : ${context.session?.saved}`);
    if (context.session) {
      if (!context.session.saved) {
        return context.session.save(
          context.user ? context.user : null,
          context.session.contextSession
        );
      }
    }
    return Promise.resolve(null);
  }

  createSession(name: string, options?: OptionsSessionType): Session {
    try {
      options = extend({}, this.options, options);
      return new Session(name, options as OptionsSessionType, this);
    } catch (e) {
      throw e;
    }
  }

  addContextSession(context: ContextType) {
    if (this.storage) {
      this.once("onReady", () => {
        this.storage.open(context);
      });
    }
  }

  setSessionStrategy(strategy: sessionStrategyType) {
    this.sessionStrategy = strategy;
  }

  probaGarbage(): boolean {
    // Génère un nombre aléatoire entre 0 et 100
    const random = Math.floor(Math.random() * 100) + 1;
    // Si le nombre aléatoire est inférieur ou égal à gc_probability
    if (random <= this.gc_probability) {
      return true;
    }
    return false;
  }
}

// Storage built-in fourni par @nodefony/http (les ORM enregistrent les leurs).
SessionsService.registerStorage("files", FileSessionStorage);

export default SessionsService;

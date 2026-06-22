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
  inject,
  injectable,
} from "nodefony";
import type {
  ISessionStorage,
  ISessionSummary,
  ISessionRecord,
  ISessionListFilter,
} from "../../interfaces/ISession";
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
import { createHash, createHmac } from "node:crypto";
import FileSessionStorage from "../../src/session/storage/FileSessionStorage";
import RevocationGuardStorage from "../../src/session/storage/RevocationGuardStorage";

export type sessionStrategyType = "none" | "migrate" | "invalidate";
export type sessionStorageType = any; //  "orm" | "memcached" | "redis" | "fileSystem" | "memory";

export type FlashBagSessionType = Record<string, unknown>;
export type MetaBagSessionType = Record<string, unknown>;

// Contrat de session UNIFIÉ — source de vérité : interfaces/ISession
// (ISessionStorage + ISerializedSession). Alias de transition supprimés (étape 3).

/** Constructeur d'un storage de session (enregistré dans le registre). */
export type SessionStorageCtor = new (
  manager: SessionsService,
) => ISessionStorage;

/**
 * Convertit un timestamp de session (`Date` en mémoire, **string ISO** après
 * `JSON.parse` côté File/Redis, ou `number`) en epoch ms — `null` si absent ou
 * invalide. JSON-safe pour le DTO admin.
 */
function toEpoch(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const t = new Date(value as string | number | Date).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Dérive le pseudonyme public d'une session — `HMAC-SHA256(secret, id)` tronqué,
 * préfixé `sess_`. **Non réversible** : exposer ce `ref` ne révèle pas l'id de
 * session (= le jeton du cookie). Fonction **pure** (testable sans instancier le
 * service ni démarrer de serveur).
 */
export function computeSessionRef(secret: Buffer, id: string): string {
  const mac = createHmac("sha256", secret).update(id).digest("hex");
  return `sess_${mac.slice(0, 24)}`;
}

/**
 * Projette une entrée brute {@link ISessionRecord} en {@link ISessionSummary}
 * **redacté par construction** (allowlist) : jamais `Attributes`, jamais
 * `flashBag`, jamais l'id brut — seulement le `ref` + des champs sûrs
 * (`user`/`ip`/`ua`/dates). Fonction **pure** (cœur de la garantie anti-fuite,
 * testée isolément).
 */
export function toSessionSummary(
  rec: ISessionRecord,
  ref: string,
): ISessionSummary {
  const data = rec.data;
  const user = typeof data.user === "string" ? data.user : "";
  const meta = (data.metaBag ?? {}) as Record<string, unknown>;
  return {
    ref,
    user,
    authenticated: user.length > 0,
    ip: typeof meta.ip === "string" ? meta.ip : null,
    ua: typeof meta.ua === "string" ? meta.ua : null,
    createdAt: toEpoch(data.createdAt),
    updatedAt: toEpoch(data.updatedAt),
    tenantId: typeof meta.tenantId === "string" ? meta.tenantId : null,
  };
}

/**
 * Brouillon d'événement d'audit de session. Forme partagée avec le journal de
 * `@nodefony/security` (`IAuditEventDraft`), **dupliquée** ici car `@nodefony/http`
 * ne dépend pas de security (couplage structurel par nom de service, toléré).
 */
interface ISessionAuditDraft {
  category: "session";
  action: string;
  outcome: "success" | "failure" | "denied";
  actor: string | null;
  resource?: string | null;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/** Vue minimale du service `auditService` (security) — résolu par nom au runtime. */
interface IAuditSinkLike {
  record(event: ISessionAuditDraft): void;
}

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
  // `private static` (soft TS) et non `static #storages` (hard ECMAScript) :
  // un identifiant privé `#` statique est incompatible avec un décorateur de
  // classe (`@injectable()`) → TS18036 sous `tsc --noEmit` (bloquait la CI).
  // Encapsulation et runtime identiques.
  private static readonly storages = new Map<string, SessionStorageCtor>();

  /**
   * Enregistre un storage de session sous un nom de handler (insensible à la
   * casse) et émet l'événement kernel `onRegisterSessionStorage` (observabilité
   * Studio / extension). Le kernel peut être absent au tout premier chargement
   * (registration statique) → fire gardé.
   */
  static registerStorage(name: string, ctor: SessionStorageCtor): void {
    const key = name.toLowerCase();
    SessionsService.storages.set(key, ctor);
    const kernel = Nodefony.getKernel();
    kernel?.fire("onRegisterSessionStorage", key, ctor);
    kernel?.log(`SESSION STORAGE registered : ${key}`, "DEBUG", "SESSION");
  }

  /** Storage enregistré pour un handler, ou `undefined`. */
  static getStorage(name: string): SessionStorageCtor | undefined {
    return SessionsService.storages.get(String(name ?? "").toLowerCase());
  }

  /** Noms des handlers de session enregistrés. */
  static storageHandlers(): string[] {
    return [...SessionsService.storages.keys()];
  }

  sessionStrategy: sessionStrategyType = "migrate";
  storage: any = null;
  gc_probability: number = 1;
  gc_divisor: number = 100;
  module: Module;
  defaultSessionName: string = "nodefony";
  secret?: Buffer;
  iv?: Buffer;
  certificates: Certificate | null;
  constructor(
    module: Module,
    @inject("HttpKernel") public httpKernel: HttpKernel,
  ) {
    super(
      "sessions",
      module.container as Container,
      module.notificationsCenter as Event,
      module.options.session,
    );
    this.module = module;
    this.certificates = this.get<Certificate>("certificates");
    this.gc_probability =
      this.options.gc_probability === "string"
        ? parseInt(this.options.gc_probability, 10)
        : this.options.gc_probability;
    this.gc_divisor = this.options.gc_divisor;
    this.defaultSessionName = this.options.name;
    this.once("onTerminate", () => {
      if (this.storage) {
        this.storage.close();
      }
    });
  }

  async init(): Promise<this> {
    this.secret = this.createSecret();
    this.iv = this.createIv();
    this.initializeStorage();
    return this;
  }

  initializeStorage(): ISessionStorage | null {
    const Storage = SessionsService.getStorage(this.options.handler);
    if (!Storage) {
      this.storage = null;
      this.log(
        `SESSION HANDLER STORAGE NOT FOUND : "${this.options.handler}" ` +
          `(enregistrés : ${SessionsService.storageHandlers().join(", ") || "aucun"})`,
        "ERROR",
      );
      return null;
    }
    // Décoration générique : le garde-fou de révocation s'applique à TOUT
    // backend (file/drizzle/redis/mongo) sans le modifier — la résurrection est
    // un défaut du cycle de vie, pas d'un store. `storage.inner` reste le store
    // réel (introspection admin : quel driver persiste les sessions).
    this.storage = new RevocationGuardStorage(new Storage(this));
    this.log(`SESSION STORAGE active : ${this.options.handler}`, "INFO");
    // Événement (kernel + service) : quel backend de session est actif.
    this.fire("onSessionStorageReady", this.options.handler, this.storage);
    this.kernel?.fire(
      "onSessionStorageReady",
      this.options.handler,
      this.storage,
    );
    this.kernel?.on("onReady", async () => {
      await this.storage.open();
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

  async start(
    context: ContextType,
    readOnly?: boolean,
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
            "DEBUG",
          );
          return resolve(context.session);
        }
      }
      let inst = null;
      try {
        context.sessionStarting = true;
        if (this.probaGarbage()) {
          // GC opportuniste (probabiliste) en arrière-plan : fire-and-forget
          // VOLONTAIRE — on ne bloque pas le démarrage de session pour ça. Mais
          // sa promesse DOIT capturer ses rejets : sinon une erreur du storage
          // (ex. ORM déconnecté pendant le shutdown du kernel, requête encore en
          // vol) remonte en `unhandledRejection` et casse le process. L'échec
          // d'un GC opportuniste se loggue, il ne crashe jamais.
          void this.storage
            .gc(this.options.gc_maxlifetime)
            .catch((e: Error) => this.log(e, "WARNING", "SESSION-GC"));
        }
        inst = this.createSession(this.defaultSessionName);
        // Lecture seule (intent `@UseSession({ readOnly })`) : la session sera
        // reprise/lue mais jamais persistée (cf Session.save).
        inst.readOnly = readOnly === true;
      } catch (e) {
        context.fire("onSessionStart", null, e);
        // `return` (pas `throw`) : un throw post-reject dans un executor est
        // avalé par le constructeur Promise — il ne servait ici que de return.
        return reject(e);
      }
      inst
        .start(context)
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
          if (context.cleaned) {
            return reject(err);
          }
          context.fire("onSessionStart", null, err);
          return reject(err);
        });
    });
  }

  saveSession(context: ContextType): Promise<Session | null> {
    if (context.session) {
      if (!context.session.saved) {
        return context.session.save(
          // `context.user` = principal authentifié (unknown jusqu'à P6 security) ;
          // `save()` attend un identifiant string. serialize() fait `user || ""`
          // → null/undefined équivalents. Cast transitoire (câblage user→session = P6).
          context.user ? (context.user as string) : undefined,
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

  // ── Administration (data plane Studio /nodefony/http/api/sessions) ───────────
  // Surface de gouvernance des sessions : énumération + révocation. RÉSERVÉE au
  // broker admin (RBAC ROLE_NODEFONY_ADMIN appliqué côté HttpAdminApi). Hors
  // hot-path — aucune alloc ni HMAC tant qu'un admin ne consulte pas la console.

  /**
   * `true` si le backend de session courant sait s'énumérer (`listAll`). Un store
   * KV/edge sans scan retourne `false` → l'endpoint admin répond **501** (refus
   * honnête, jamais une liste vide trompeuse).
   */
  supportsEnumeration(): boolean {
    const storage = this.storage as ISessionStorage | null;
    return !!storage && typeof storage.listAll === "function";
  }

  /**
   * Dérive le pseudonyme public d'une session — `HMAC-SHA256(secret, id)` tronqué,
   * préfixé `sess_`. **Non réversible** : exposer ce `ref` ne révèle pas l'id de
   * session (= le jeton du cookie). Le secret HMAC = celui de la couche session
   * (`this.secret`, dérivé de la clé du certificat au boot), jamais sérialisé.
   *
   * @throws Error si le secret n'est pas initialisé (service pas démarré) — capté
   *   en 503 côté endpoint plutôt que d'émettre un `ref` faible.
   */
  sessionRef(id: string): string {
    if (!this.secret) {
      throw new Error(
        "sessions: HMAC secret unavailable (service not initialized)",
      );
    }
    return computeSessionRef(this.secret, id);
  }

  /**
   * Énumère les sessions persistées en {@link ISessionSummary} **redactés** (jamais
   * d'id brut ni d'`Attributes`), des plus récentes aux plus anciennes. Le filtre
   * `user` est poussé au store (WHERE SQL) PUIS ré-appliqué ici (défense si un
   * store l'ignore). Pré-condition : {@link supportsEnumeration} (sinon throw).
   */
  async listAllSessions(
    filter?: ISessionListFilter,
  ): Promise<ISessionSummary[]> {
    const storage = this.storage as ISessionStorage | null;
    if (!storage || typeof storage.listAll !== "function") {
      throw new Error("sessions: enumeration not supported by current storage");
    }
    const records = await storage.listAll(filter);
    const wantUser = filter?.user;
    const out: ISessionSummary[] = [];
    for (const rec of records) {
      const user = typeof rec.data.user === "string" ? rec.data.user : "";
      if (wantUser !== undefined && user !== wantUser) continue;
      out.push(toSessionSummary(rec, this.sessionRef(rec.id)));
    }
    out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return out;
  }

  /**
   * Révoque une session par son `ref` public : re-scanne, recalcule le HMAC de
   * chaque id pour retrouver l'id réel (l'id brut ne quitte jamais le process),
   * puis `destroy()`. `ref` étant public (pas un secret), la comparaison directe
   * est sûre. Idempotent — `false` si aucun `ref` ne correspond.
   */
  async destroyByRef(ref: string, actor?: string | null): Promise<boolean> {
    const storage = this.storage as ISessionStorage | null;
    if (!storage || typeof storage.listAll !== "function") {
      throw new Error("sessions: enumeration not supported by current storage");
    }
    const records = await storage.listAll();
    for (const rec of records) {
      if (this.sessionRef(rec.id) === ref) {
        const subject =
          typeof rec.data.user === "string" ? rec.data.user : null;
        const ok = await storage.destroy(rec.id);
        if (ok) {
          this.log(
            `session revoked by admin — ref=${ref} actor=${actor ?? "admin"}`,
            "INFO",
          );
          this.emitAudit({
            category: "session",
            action: "session.revoked",
            outcome: "success",
            actor: actor ?? null,
            resource: ref,
            metadata: { subject, viaAdmin: true },
          });
        }
        return ok;
      }
    }
    return false;
  }

  /**
   * « Déconnexion partout » : détruit TOUTES les sessions d'un utilisateur (scan
   * O(N) — pas d'index inverse, acceptable en admin). Renvoie le nombre détruit.
   */
  async destroyByUser(
    identifier: string,
    actor?: string | null,
  ): Promise<number> {
    const storage = this.storage as ISessionStorage | null;
    if (!storage || typeof storage.listAll !== "function") {
      throw new Error("sessions: enumeration not supported by current storage");
    }
    const records = await storage.listAll({ user: identifier });
    let destroyed = 0;
    for (const rec of records) {
      if (rec.data.user === identifier) {
        if (await storage.destroy(rec.id)) destroyed++;
      }
    }
    if (destroyed > 0) {
      this.log(
        `sessions revoked by admin (logout-all) — user=${identifier} ` +
          `count=${destroyed} actor=${actor ?? "admin"}`,
        "INFO",
      );
      this.emitAudit({
        category: "session",
        action: "session.revoked",
        outcome: "success",
        actor: actor ?? null,
        resource: identifier,
        reason: "logout_all",
        metadata: { count: destroyed, viaAdmin: true },
      });
    }
    return destroyed;
  }

  // ── Self-service (data plane /nodefony/http/api/sessions/mine) ────────────────
  // Surface « MES sessions » d'un utilisateur AUTHENTIFIÉ quelconque (pas admin).
  // ANTI-IDOR par CONSTRUCTION : l'`identifier` n'est JAMAIS fourni par le client
  // — il vient de l'identité ALS côté serveur (`request.user.identifier`, ===
  // `session.user`, posé au login par `establishSessionFor`). Le périmètre est
  // donc fermé : un utilisateur ne peut ni lister ni révoquer la session d'un
  // autre. Hors hot-path (aucun coût tant qu'un user ne consulte pas ses sessions).

  /**
   * Énumère les sessions APPARTENANT à `identifier` ({@link ISessionSummary}
   * redactés), des plus récentes aux plus anciennes. Délègue à
   * {@link listAllSessions} avec le filtre `user` (poussé au store PUIS ré-appliqué
   * — défense en profondeur). Un `identifier` vide renvoie `[]` (jamais les
   * sessions anonymes `user===""`).
   */
  async listOwnSessions(identifier: string): Promise<ISessionSummary[]> {
    if (!identifier) return [];
    return this.listAllSessions({ user: identifier });
  }

  /**
   * Révoque UNE session **possédée par `identifier`**, désignée par son `ref`
   * public. Contrairement à {@link destroyByRef} (admin, scan GLOBAL), le scan est
   * RESTREINT aux sessions de `identifier` (+ re-check d'appartenance) : un `ref`
   * qui ne lui appartient pas est introuvable → `false`, ce qui ferme l'IDOR.
   * Idempotent. Audité (`self: true`, acteur = le propriétaire).
   */
  async destroyOwnByRef(
    identifier: string,
    ref: string,
    actor?: string | null,
  ): Promise<boolean> {
    if (!identifier) return false;
    const storage = this.storage as ISessionStorage | null;
    if (!storage || typeof storage.listAll !== "function") {
      throw new Error("sessions: enumeration not supported by current storage");
    }
    // Périmètre fermé : on ne scanne QUE les sessions de l'appelant.
    const records = await storage.listAll({ user: identifier });
    for (const rec of records) {
      // Re-check d'appartenance AVANT le match de ref (défense si un store
      // ignorait le filtre) → un ref d'autrui n'est jamais atteignable ici.
      if (rec.data.user !== identifier) continue;
      if (this.sessionRef(rec.id) === ref) {
        const ok = await storage.destroy(rec.id);
        if (ok) {
          this.log(
            `session revoked by owner — ref=${ref} user=${identifier}`,
            "INFO",
          );
          this.emitAudit({
            category: "session",
            action: "session.revoked",
            outcome: "success",
            actor: actor ?? identifier,
            resource: ref,
            metadata: { subject: identifier, self: true },
          });
        }
        return ok;
      }
    }
    return false;
  }

  /**
   * Émet un événement dans le journal d'audit de `@nodefony/security` s'il est
   * monté (résolu par nom au runtime) — **no-op** si security est absent/désactivé.
   * L'action de révocation reste tracée par `this.log()` dans tous les cas.
   */
  // `private` (soft TS) et non `#audit` : pont d'audit interne sans enjeu
  // d'encapsulation forte — reste sur le prototype, donc testable en isolation
  // (orchestration unit via `Object.create`, sans démarrer de serveur).
  private emitAudit(event: ISessionAuditDraft): void {
    this.get<IAuditSinkLike>("auditService")?.record(event);
  }
}

// Storage built-in fourni par @nodefony/http (les ORM enregistrent les leurs).
SessionsService.registerStorage("files", FileSessionStorage);

export default SessionsService;

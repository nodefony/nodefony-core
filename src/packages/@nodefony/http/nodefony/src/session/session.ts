import { extend } from "nodefony";
import type { Severity } from "nodefony";
import { randomBytes } from "node:crypto";
import Cookie, { CookieOptionsType } from "../cookies/cookie";
import type HttpContext from "../context/http/HttpContext";
import type WebsocketContext from "../context/websocket/WebsocketContext";
import type { ContextType } from "../../service/http-kernel";
import type SessionsService from "../../service/sessions/sessions-service";
import type {
  ISession,
  ISessionStorage,
  ISerializedSession,
  SessionStatusType,
  SessionStrategyType,
  FlashBagType,
  MetaBagType,
} from "../../interfaces/ISession";

/**
 * Options d'une session (sous-ensemble de `module.options.session`).
 *
 * Cookie-only : plus de `use_trans_sid`/`use_only_cookies` — un identifiant de
 * session ne voyage JAMAIS dans l'URL (OWASP Session Management). Plus de
 * `encrypt`/`hash_function` — l'identifiant est un secret opaque CSPRNG, pas un
 * hash chiffré « maison ».
 */
export type OptionsSessionType = {
  name?: string;
  cookie?: CookieOptionsType;
  /** Strict mode : un identifiant inconnu du storage → nouvelle session (anti-fixation). */
  use_strict_mode?: boolean;
  /** Lie la session à l'hôte (méta `host`) — rejette un changement d'origine. */
  referer_check?: boolean;
  /**
   * Absolute timeout (OWASP, secondes) : durée de vie MAX depuis la création,
   * indépendante de l'activité. Borne la fenêtre d'exploitation d'un identifiant
   * volé même sur session active. `0`/absent = désactivé (seul l'idle s'applique).
   */
  absolute_timeout?: number;
};

const defaultSessionOptions: OptionsSessionType = {
  name: "nodefony",
  use_strict_mode: true,
  referer_check: false,
};

/** Taille de l'identifiant opaque (octets CSPRNG → base64url, 43 chars). */
const SESSION_ID_BYTES = 32;

/**
 * Session serveur Nodefony — état persistant lié à une identité, indexé par un
 * identifiant **opaque** (porté par le cookie) dans un {@link ISessionStorage}
 * pluggable (File / Redis / SQL). Modèle BFF : le cookie ne transporte qu'un
 * secret aléatoire, jamais de données ni de JWT.
 *
 * Objet **léger** : trois sacs `{}` (attributs / métas / flash)
 * au lieu d'un `Container` DI par session.
 *
 * Dirty-tracking : toute mutation (`set` / `setFlashBag` / `setMetaBag` /
 * `getFlashBag` qui consomme / …) lève {@link dirty} ; {@link save} n'écrit dans
 * le storage **que** si `dirty`. Une requête qui ne touche pas la session ne
 * déclenche aucune écriture (supprime la contention `write`/requête).
 */
class Session implements ISession {
  id: string = "";
  name: string = "";
  status: SessionStatusType = "none";
  storage: ISessionStorage;
  manager: SessionsService;
  saved: boolean = false;
  migrated: boolean = false;
  /**
   * Lecture seule (intent `@UseSession({ readOnly })`) : la session est reprise et
   * lue mais **jamais persistée** — {@link save} devient un no-op. Différenciateur
   * perf : une route qui ne fait que LIRE la session (afficher le user…) ne paie
   * aucune écriture storage.
   */
  readOnly: boolean = false;
  contextSession: string = "default";
  context?: ContextType;
  created?: Date;
  updated?: Date;
  options: OptionsSessionType;
  cookieSession: Cookie | null = null;
  lifetime?: number;
  user?: string;
  strategy: SessionStrategyType;

  // ⚠️ Objets LITTÉRAUX `{}` (PAS `Object.create(null)`) : les sacs sont sérialisés
  // puis insérés par les storages ORM. drizzle-orm `is()` fait
  // `Object.getPrototypeOf(value).constructor` → un objet sans prototype renvoie
  // `null` → `null.constructor` throw. Un objet À prototype est obligatoire ici.
  /** Sac d'attributs applicatifs (clé/valeur) — exposé via {@link getAttributes}. */
  private attributesBag: Record<string, unknown> = {};
  /** Sac de métadonnées techniques (host, ip, ua…) — exposé via {@link getMetas}. */
  private metaBagStore: MetaBagType = {};
  /** Sac de messages flash (consommés à la lecture). Public : lu par les storages. */
  flashBag: FlashBagType = {};
  /** Drapeau dirty-tracking — lu via le getter {@link dirty}. */
  private mutated: boolean = false;

  constructor(
    name: string,
    options: OptionsSessionType,
    manager: SessionsService,
  ) {
    this.options = extend(
      {},
      defaultSessionOptions,
      options,
    ) as OptionsSessionType;
    this.manager = manager;
    this.storage = this.manager.storage as ISessionStorage;
    if (!this.storage) {
      this.status = "disabled";
    }
    this.setName(name);
    this.strategy = this.manager.sessionStrategy;
  }

  /** Vrai si la session a été mutée sans être encore persistée (dirty-tracking). */
  get dirty(): boolean {
    return this.mutated;
  }

  private log(pci: unknown, severity?: Severity): void {
    this.manager.log(pci, severity, `SESSION ${this.name}`);
  }

  // ── Cycle de vie ──────────────────────────────────────────────────

  /**
   * Démarre (ou reprend) la session pour une aire (`contextSession`). Cookie
   * présent → reprise depuis le storage ; sinon → nouvelle session.
   *
   * @param context - contexte HTTP/HTTP2/WS courant.
   * @param contextSession - aire de session (firewall/route) ; défaut courante.
   */
  async start(context: ContextType, contextSession: string): Promise<this> {
    this.context = context;
    if (!contextSession) {
      contextSession = this.contextSession;
    }
    const ret = this.checkStatus();
    if (ret === false) {
      return this; // déjà active
    }
    if (ret === "restart") {
      return this.start(context, contextSession); // storage ré-initialisé
    }
    return this.getSession(contextSession);
  }

  /**
   * Lit l'identifiant opaque du cookie puis reprend la session, ou en crée une
   * neuve si aucun cookie. Cookie-only : aucun identifiant lu depuis l'URL.
   */
  private async getSession(contextSession: string): Promise<this> {
    if (this.context?.cookieSession) {
      // L'identifiant est la valeur BRUTE du cookie (opaque) — aucun déchiffrement.
      this.id = this.context.cookieSession.value as string;
      this.cookieSession = this.context.cookieSession;
    }
    if (this.id) {
      return this.resume(contextSession);
    }
    this.clear();
    if (contextSession) {
      this.contextSession = contextSession;
    }
    return this.create(this.lifetime ?? 0);
  }

  /**
   * Reprend la session `(id, contextSession)` depuis le storage. Invalide
   * (→ session neuve) si introuvable en strict mode, ou expirée/illégitime.
   */
  private async resume(contextSession: string): Promise<this> {
    if (contextSession) {
      this.contextSession = contextSession;
    }
    const data = await this.storage.start(this.id, this.contextSession);
    if (data && Object.keys(data).length) {
      this.deSerialize(data);
      if (!this.isValidSession(data, this.context as ContextType)) {
        this.log(`INVALID SESSION ==> ${this.name} : ${this.id}`, "WARNING");
        await this.invalidate();
        return this;
      }
      this.status = "active";
      return this;
    }
    if (this.options.use_strict_mode) {
      // Identifiant présent mais inconnu du storage → nouvelle session (anti-fixation).
      this.log(`SESSION strict_mode unknown id ==> ${this.name}`, "DEBUG");
      await this.invalidate();
      return this;
    }
    this.status = "active";
    return this;
  }

  /**
   * Crée une session neuve : identifiant opaque CSPRNG, cookie, métadonnées.
   * Marquée `dirty` (sauf `saveUninitialized:false`) → persistée + `Set-Cookie`
   * au prochain {@link save}.
   */
  create(
    lifetime: number,
    id?: string,
    settingsCookie: CookieOptionsType = {},
  ): this {
    this.id = id || this.generateId();
    const settings = extend(
      {},
      this.options.cookie,
      settingsCookie,
    ) as CookieOptionsType;
    this.log(`NEW SESSION CREATE : ${this.id}`, "DEBUG");
    this.cookieSession = this.setCookieSession(lifetime, settings);
    this.setMetasSession(settings);
    this.status = "active";
    // Nouvelle session → à persister (dirty) : Set-Cookie + écriture au 1ᵉʳ save.
    // (La session « lazy » qui diffère cookie + écriture = étape 5.)
    this.mutated = true;
    return this;
  }

  /** Génère un identifiant de session opaque (32 octets CSPRNG → base64url). */
  private generateId(): string {
    return randomBytes(SESSION_ID_BYTES).toString("base64url");
  }

  /**
   * Régénère l'identifiant (nouveau secret opaque) en conservant l'état courant.
   * Anti session-fixation (OWASP) — à invoquer après authentification (seam P6,
   * non câblé). Repositionne le cookie et marque la session `dirty`. L'ancienne
   * entrée storage expire via GC/TTL (suppression stricte câblée au firewall P6).
   */
  regenerateId(): void {
    this.id = this.generateId();
    this.mutated = true;
    if (this.context?.response) {
      this.cookieSession = this.setCookieSession(
        this.lifetime ?? 0,
        this.options.cookie ?? {},
      );
    }
  }

  /**
   * Persiste la session **si elle est dirty** (sinon no-op). Réécrit le blob
   * sérialisé dans le storage, repositionne created/updated, lève l'événement
   * `onSaveSession`.
   *
   * @param user - principal authentifié (string) lié au blob ; défaut courant.
   * @param contextSession - aire de session ; défaut courante.
   */
  async save(
    user?: string,
    contextSession: string = this.contextSession,
  ): Promise<this> {
    if (this.readOnly) {
      // Lecture seule : jamais de write storage. Une mutation tentée sur une
      // session readOnly est une erreur d'usage → on la signale sans persister.
      if (this.mutated) {
        this.log(
          `READONLY SESSION mutated — write skipped : ${this.name}`,
          "WARNING",
        );
      }
      return this;
    }
    if (!this.mutated) {
      return this; // rien muté → aucune écriture storage (dirty-tracking)
    }
    const stored = await this.storage.write(
      this.id,
      this.serialize(user),
      contextSession,
    );
    this.created = stored.createdAt ?? this.created;
    this.updated = stored.updatedAt ?? this.updated;
    this.mutated = false;
    this.saved = true;
    if (this.context) {
      await this.context.fireAsync("onSaveSession", this);
    }
    return this;
  }

  /**
   * Détruit la session courante (storage) et en recrée une neuve (nouvel
   * identifiant + cookie). État applicatif réinitialisé.
   */
  async invalidate(
    lifetime: number = this.lifetime ?? 0,
    id?: string,
    settingsCookie: CookieOptionsType = {},
  ): Promise<this> {
    this.log(`INVALIDATE SESSION ==> ${this.name} : ${this.id}`, "DEBUG");
    const oldId = this.id;
    this.clear();
    await this.storage.destroy(oldId, this.contextSession);
    return this.create(lifetime, id, settingsCookie);
  }

  /**
   * Détruit la session : vide les sacs, supprime l'entrée storage, et (option)
   * efface le cookie.
   */
  async destroy(cookieDelete: boolean = false): Promise<boolean> {
    this.clear();
    await this.storage.destroy(this.id, this.contextSession);
    if (cookieDelete) {
      this.deleteCookieSession();
    }
    return true;
  }

  // ── Cookie (durcissement RFC 6265bis — SameSite/__Host-/None⇒Secure — étape 4) ──

  setCookieSession(
    leftTime: number,
    options: CookieOptionsType = {},
  ): Cookie | null {
    if (this.context && this.context.response) {
      const settings = extend(
        {},
        this.options.cookie,
        options,
      ) as CookieOptionsType;
      if (leftTime) {
        settings.maxAge = leftTime;
      }
      const cookie = new Cookie(this.name, this.id, settings);
      this.context.response.addCookie(cookie);
      this.cookieSession = cookie;
      this.context.cookieSession = cookie;
      return cookie;
    }
    return null;
  }

  deleteCookieSession(): Cookie | null {
    if (this.context && this.context.response) {
      let cookie = this.cookieSession;
      if (cookie) {
        cookie.expires = new Date(0);
      } else {
        cookie = new Cookie(this.name, "", { expires: new Date(0) });
      }
      this.context.response.setCookie(cookie);
      this.cookieSession = null;
      this.context.cookieSession = null;
      return cookie;
    }
    return this.cookieSession;
  }

  // ── Validation ────────────────────────────────────────────────────

  isValidSession(_data: ISerializedSession, context: ContextType): boolean {
    if (this.options.referer_check) {
      try {
        return this.checkSecureReferer(context);
      } catch {
        this.log(
          `SESSION REFERER MISMATCH ==> ${this.name} : ${this.id}`,
          "WARNING",
        );
        return false;
      }
    }
    const now = Date.now();
    // Absolute timeout (OWASP) : âge max depuis la CRÉATION, indépendant de
    // l'activité — un identifiant volé ne reste pas exploitable indéfiniment même
    // si la session est maintenue active artificiellement.
    if (this.options.absolute_timeout && this.created) {
      const age = now - new Date(this.created).getTime();
      if (age > this.options.absolute_timeout * 1000) {
        this.log(
          `SESSION EXPIRED (absolute) ==> ${this.name} : ${this.id}`,
          "WARNING",
        );
        return false;
      }
    }
    // Idle timeout : inactivité depuis le dernier accès (lastUsed = updated).
    if (this.lifetime === 0 || this.lifetime === undefined) {
      return true;
    }
    const lastUsed = new Date(this.updated as Date).getTime();
    if (lastUsed && lastUsed + this.lifetime * 1000 < now) {
      this.log(
        `SESSION EXPIRED (idle) ==> ${this.name} : ${this.id}`,
        "WARNING",
      );
      return false;
    }
    return true;
  }

  checkSecureReferer(context: ContextType): boolean {
    const host = (context as HttpContext | WebsocketContext).getHost();
    const meta = this.getMetaBag("host");
    if (host === meta) {
      return true;
    }
    this.log(
      `SESSION REFERER NOT SAME, HOST: ${host} META: ${String(meta)}`,
      "WARNING",
    );
    throw new Error("session referer mismatch");
  }

  // ── Métadonnées techniques ────────────────────────────────────────

  private setMetasSession(cookieSetting: CookieOptionsType = {}): void {
    this.setMetaBag(
      "lifetime",
      cookieSetting.maxAge ?? this.options.cookie?.maxAge,
    );
    this.setMetaBag("context", this.contextSession || null);
    const ctx = this.context as HttpContext | WebsocketContext | undefined;
    this.setMetaBag("request", ctx?.type);
    try {
      this.setMetaBag("remoteAddress", ctx?.getRemoteAddress());
      this.setMetaBag("host", ctx?.getHost());
      this.setMetaBag("user_agent", ctx?.getUserAgent() || "Not Defined");
    } catch (e) {
      this.log(e, "DEBUG");
    }
  }

  // ── Attributs ──────────────────────────────────────────────────────

  get(key: string): unknown {
    const v = this.attributesBag[key];
    return v === undefined ? null : v;
  }

  set(key: string, value: unknown): unknown {
    this.attributesBag[key] = value;
    this.mutated = true;
    return value;
  }

  getAttributes(): Record<string, unknown> {
    return this.attributesBag;
  }

  // ── MetaBag ────────────────────────────────────────────────────────

  getMetaBag(key: string): unknown {
    const v = this.metaBagStore[key];
    return v === undefined ? null : v;
  }

  setMetaBag(key: string, value: unknown): void {
    this.metaBagStore[key] = value;
    this.mutated = true;
  }

  getMetas(): MetaBagType {
    return this.metaBagStore;
  }

  // ── FlashBag (consommé à la lecture) ───────────────────────────────

  getFlashBag(key: string): unknown {
    const v = this.flashBag[key];
    if (v !== undefined) {
      delete this.flashBag[key];
      this.mutated = true;
      return v;
    }
    return null;
  }

  setFlashBag(key: string, value: unknown): unknown {
    if (!key) {
      throw new Error(`FlashBag key must be define : ${key}`);
    }
    this.flashBag[key] = value;
    this.mutated = true;
    return value;
  }

  flashBags(): FlashBagType {
    return this.flashBag;
  }

  clearFlashBag(key: string): void {
    if (!key) {
      throw new Error(`clearFlashBag key must be define : ${key}`);
    }
    if (this.flashBag[key] !== undefined) {
      delete this.flashBag[key];
      this.mutated = true;
    }
  }

  clearFlashBags(): void {
    this.flashBag = {};
    this.mutated = true;
  }

  // ── Sérialisation ──────────────────────────────────────────────────

  serialize(user?: string): ISerializedSession {
    return {
      Attributes: this.attributesBag,
      metaBag: this.metaBagStore,
      flashBag: this.flashBag,
      user: user ?? this.user ?? "",
    };
  }

  deSerialize(data: ISerializedSession): void {
    // Restauration depuis le storage — écriture DIRECTE (ne lève PAS `dirty`).
    if (data.Attributes) {
      for (const k in data.Attributes) {
        this.attributesBag[k] = data.Attributes[k];
      }
    }
    if (data.metaBag) {
      for (const k in data.metaBag) {
        this.metaBagStore[k] = data.metaBag[k];
      }
    }
    if (data.flashBag) {
      for (const k in data.flashBag) {
        this.flashBag[k] = data.flashBag[k];
      }
    }
    this.created = data.createdAt ?? this.created;
    this.updated = data.updatedAt ?? this.updated;
    if (data.user) {
      this.user = data.user;
    }
  }

  // ── Utils ──────────────────────────────────────────────────────────

  /** Réinitialise les trois sacs (attributs, métas, flash) — état vide. */
  clear(): void {
    this.attributesBag = {};
    this.metaBagStore = {};
    this.flashBag = {};
  }

  getName(): string {
    return this.name;
  }

  setName(name: string): void {
    this.name = name || (this.options.name as string);
  }

  checkStatus(): "restart" | boolean {
    switch (this.status) {
      case "active":
        this.log(
          `SESSION ALREADY STARTED ==> ${this.name} : ${this.id}`,
          "WARNING",
        );
        return false;
      case "disabled": {
        const storage = this.manager.initializeStorage();
        if (storage) {
          this.storage = storage;
          this.status = "none";
          return "restart";
        }
        this.log("SESSION STORAGE HANDLER NOT FOUND", "ERROR");
        throw new Error("SESSION STORAGE HANDLER NOT FOUND");
      }
      default:
        return true;
    }
  }
}

export default Session;

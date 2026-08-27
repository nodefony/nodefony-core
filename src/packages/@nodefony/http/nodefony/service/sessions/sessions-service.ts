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
  GcScheduler,
  AUTO_STORE,
  EMPTY_INFRA,
  resolveAutoStore,
  readStoreLocation,
  countFacets,
  RequestContext,
} from "nodefony";
import type { IPage } from "nodefony";
import type {
  ISessionStorage,
  ISessionSummary,
  ISessionRecord,
  ISessionListFilter,
  ISessionListQuery,
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
import MemorySessionStorage from "../../src/session/storage/MemorySessionStorage";
import RevocationGuardStorage from "../../src/session/storage/RevocationGuardStorage";
import { SESSION_FACETS } from "../../src/session/storage/sessionFilters";
import type { ISessionCounts } from "../../src/session/storage/sessionFilters";

export type sessionStrategyType = "none" | "migrate" | "invalidate";

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
 * Taille des pages lues par les parcours d'administration (révocation par
 * référence, « déconnecter partout »). C'est **la borne mémoire** de ces
 * opérations : quel que soit le parc — 10 ou 10 millions de sessions — le service
 * ne détient jamais plus de `SCAN_PAGE` records à la fois. Assez grand pour que
 * les allers-retours au store restent rares, assez petit pour rester négligeable
 * en RAM.
 */
const SCAN_PAGE = 200;

/**
 * Nombre maximal de pages lues par un parcours d'administration (garde-fou :
 * `SCAN_PAGE × MAX_ADMIN_PAGES` sessions visitées au plus). Protège d'une boucle
 * infinie si un store au curseur ne convergeait jamais vers la fin. Un parcours
 * interrompu est **journalisé** — partiel signalé, jamais silencieux.
 */
const MAX_ADMIN_PAGES = 5_000;

/**
 * Nombre maximal de passages complets d'un « déconnecter partout ». Le premier
 * détruit l'essentiel, le second confirme qu'il ne reste rien ; les suivants ne
 * servent que si un store à curseur faible a sauté des éléments sous la
 * suppression. Au-delà, on journalise plutôt que de boucler — une révocation
 * incomplète doit être VISIBLE, pas silencieuse.
 */
const MAX_LOGOUT_PASSES = 10;

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
  currentRef: string | null = null,
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
    // Comparaison de RÉFÉRENCES, jamais d'identifiants d'utilisateur : dans
    // « mes sessions » toutes les lignes portent le même user, et c'est bien la
    // ligne — pas le compte — que l'appelant doit pouvoir désigner.
    current: currentRef !== null && ref === currentRef,
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
   * config (`session.store`) sélectionne le storage par son nom.
   */
  // `private static` (soft TS) et non `static #storages` (hard ECMAScript) :
  // un identifiant privé `#` statique est incompatible avec un décorateur de
  // classe (`@injectable()`) → TS18036 sous `tsc --noEmit` (bloquait la CI).
  // Encapsulation et runtime identiques.
  private static readonly storages = new Map<string, SessionStorageCtor>();

  /**
   * Enregistre un storage de session sous un nom de store (insensible à la
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

  /** Storage enregistré pour un store, ou `undefined`. */
  static getStorage(name: string): SessionStorageCtor | undefined {
    return SessionsService.storages.get(String(name ?? "").toLowerCase());
  }

  /** Noms des handlers de session enregistrés. */
  static storageHandlers(): string[] {
    return [...SessionsService.storages.keys()];
  }

  sessionStrategy: sessionStrategyType = "migrate";
  storage: ISessionStorage | null = null;
  module: Module;
  defaultSessionName: string = "nodefony";
  secret?: Buffer;
  iv?: Buffer;
  certificates: Certificate | null;
  // Maintenance déterministe HORS hot-path (remplace le tirage probabiliste PHP
  // gc_probability/divisor) — timer/jitter/anti-empilement/désarmement mutualisés
  // dans le GcScheduler du core. Créé au onReady (store ouvert), stoppé au onTerminate.
  private gcScheduler: GcScheduler | null = null;
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
    this.defaultSessionName = this.options.name;
    this.once("onTerminate", () => {
      this.gcScheduler?.stop();
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
    // `auto` (défaut) = suivre l'infra déclarée (cache redis > database > sqlite
    // local si drizzle chargé > repli memory), borné aux handlers réellement
    // enregistrés. Valeur explicite respectée.
    let storeName: string = this.options.store;
    const configured = storeName;
    let reason = `store explicitement configuré ("${configured}")`;
    if (storeName === AUTO_STORE) {
      const auto = resolveAutoStore(
        "session",
        this.kernel?.infra ?? EMPTY_INFRA,
        SessionsService.storageHandlers(),
        "memory",
      );
      storeName = auto.store;
      reason = auto.reason;
      this.log(
        `session.store "auto" → "${storeName}" (${auto.reason})`,
        "INFO",
      );
    }
    let Storage = SessionsService.getStorage(storeName);
    if (!Storage) {
      // Doctrine d'échec : handler EXPLICITE introuvable = config erronée.
      // Prod → boot avorté (des sessions silencieusement mortes cassent le
      // firewall/BFF en cascade) ; dev → repli "memory" ANNONCÉ (l'app reste
      // utilisable, sessions volatiles). Le cas "auto" ne passe jamais ici.
      const known = SessionsService.storageHandlers().join(", ") || "aucun";
      const msg = `session store "${storeName}" inconnu (enregistrés : ${known})`;
      if (this.kernel?.environment === "production") {
        throw new Error(`${msg} — sessions indisponibles : boot avorté.`);
      }
      this.log(`${msg} — repli "memory"`, "WARNING");
      storeName = "memory";
      reason = `repli "memory" (store "${configured}" introuvable)`;
      Storage = SessionsService.getStorage(storeName);
      if (!Storage) {
        // Même le repli builtin manque : irrécupérable, dev compris.
        throw new Error(
          `session store de repli "memory" introuvable — sessions indisponibles.`,
        );
      }
    }
    // Décoration générique : le garde-fou de révocation s'applique à TOUT
    // backend (memory/drizzle/redis/mongo) sans le modifier — la résurrection est
    // un défaut du cycle de vie, pas d'un store. `storage.inner` reste le store
    // réel (introspection admin : quel driver persiste les sessions).
    const innerStorage = new Storage(this);
    // Référence locale : le `onReady` plus bas est asynchrone, et c'est CE store
    // qu'il doit ouvrir — pas celui que `this.storage` désignerait à ce moment-là.
    const storage = new RevocationGuardStorage(innerStorage);
    this.storage = storage;
    this.log(`SESSION STORAGE active : ${storeName}`, "INFO");
    // Événement (kernel + service) : quel backend de session est actif.
    this.fire("onSessionStorageReady", storeName, this.storage);
    this.kernel?.fire("onSessionStorageReady", storeName, this.storage);
    this.kernel?.on("onReady", async () => {
      // Résolution de store enregistrée ICI (pas à l'activation) : `onReady` fire
      // APRÈS le `onBoot` de TOUS les modules → l'ORM (drizzle) est connecté et
      // `readStoreLocation(innerStorage)` peut lire le fichier `.db`. À l'activation
      // (http boote avant drizzle) l'ORM n'existe pas encore → location vide. La
      // résolution n'est lue QUE par l'endpoint Studio (bien après le boot).
      this.kernel?.registerStoreResolution({
        brick: "session",
        nature: "session",
        configured,
        resolved: storeName,
        available: SessionsService.storageHandlers(),
        reason,
        configPath: "http.session.store",
        // Store réel (avant le garde-fou de révocation) : backend fichier → chemin ;
        // drizzle → base SQLite ; memory/réseau → undefined (voir l'infra).
        location: readStoreLocation(innerStorage),
      });
      await storage.open();
      // Maintenance déterministe HORS hot-path (GcScheduler unifié du core) :
      // armée une fois le store ouvert, désarmée au onTerminate. Le scan ne
      // tourne plus PENDANT une requête.
      this.gcScheduler = new GcScheduler({
        intervalS: Number(this.options.gcIntervalS ?? 600),
        jitter: this.options.gcJitter !== false,
        run: () => this.runGc(),
        onError: (e) => this.log(e as Error, "WARNING", "SESSION-GC"),
      });
      this.gcScheduler.start();
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
        // GC retiré du hot-path (était un tirage probabiliste PHP + scan
        // fire-and-forget PENDANT la requête) → désormais un timer déterministe
        // hors requête (voir scheduleGc/runGc). Un appel système de moins par start.
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
            // NB : on ne pose AUCUNE donnée per-requête ici (ex. l'URL courante).
            // La poser salirait la session à CHAQUE requête → branche `save()`
            // (SELECT d'existence + réécriture du blob) au lieu du `touch` léger
            // (lazy-write, cf saveSession). Aucun consommateur ne lit cette URL ;
            // les métas durables (ip/ua/host) sont posées 1× à la création
            // (setMetasSession).
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

  async saveSession(context: ContextType): Promise<Session | null> {
    const session = context.session;
    if (!session) {
      return null;
    }
    if (session.dirty && !session.readOnly) {
      // Mutée ET persistable → écriture du blob (réécrit `updatedAt` = rafraîchit
      // l'idle). `context.user` = principal authentifié ; `save()` attend un
      // identifiant string. serialize() fait `user || ""` → null/undefined équiv.
      return session.save(context.user ? (context.user as string) : undefined);
    }
    // Sinon → prolonge l'idle de façon THROTTLÉE sans réécrire le blob (touch
    // NIST/OWASP). Couvre les cas où `save()` n'écrit pas mais où la session
    // ACTIVE doit rester vivante : (1) session NON mutée — GET / message WS
    // read-only sans écriture applicative (cas DOMINANT : l'activation ne salit
    // plus la session) ; (2) `readOnly` mutée par erreur — write interdit mais
    // l'idle doit quand même glisser (sinon `updatedAt` figé → expirée à tort).
    // Throttlé (1 write / tranche d'idle) → coût négligeable, dirty-tracking
    // préservé pour les vraies écritures.
    await session.touchIfNeeded();
    return session;
  }

  createSession(name: string, options?: OptionsSessionType): Session {
    options = extend({}, this.options, options);
    return new Session(name, options as OptionsSessionType, this);
  }

  setSessionStrategy(strategy: sessionStrategyType) {
    this.sessionStrategy = strategy;
  }

  // ── Maintenance hors hot-path (purge des sessions expirées) ──────────────────
  // Timer/jitter/anti-empilement/désarmement mutualisés dans le GcScheduler du
  // core (créé au onReady, stoppé au onTerminate) — remplace le reliquat PHP
  // gc_probability/divisor (probabiliste, dans le hot-path).

  /**
   * Une passe de purge du store (`storage.gc(idle, absolute)`) — point d'entrée
   * public d'un ordonnanceur : le {@link GcScheduler} l'appelle, mais un futur
   * worker cron (`session:gc` / k8s CronJob) peut l'appeler à sa place (poser
   * alors `gcIntervalS:0`). L'anti-empilement et la capture d'erreur vivent dans
   * le GcScheduler (via `onError`) — ici, la passe métier nue.
   */
  async runGc(): Promise<void> {
    if (!this.storage) return;
    // Purge sur les DEUX bornes NIST/OWASP : idle (inactivité) + absolute (âge
    // depuis création, jamais prolongé). Le store applique celle(s) qu'il sait
    // (Redis : idle via TTL natif → no-op ici, absolute honoré à la lecture).
    await this.storage.gc(
      this.options.idleTimeoutS,
      this.options.absoluteTimeoutS,
    );
  }

  // ── Administration (data plane Studio /nodefony/http/api/sessions) ───────────
  // Surface de gouvernance des sessions : énumération + révocation. RÉSERVÉE au
  // broker admin (RBAC ROLE_NODEFONY_ADMIN appliqué côté HttpAdminApi). Hors
  // hot-path — aucune alloc ni HMAC tant qu'un admin ne consulte pas la console.

  /**
   * `true` si le backend de session courant sait s'énumérer **par pages**
   * (`listPage`). Un store KV/edge sans scan retourne `false` → l'endpoint admin
   * répond **501** (refus honnête, jamais une liste vide trompeuse).
   *
   * C'est bien `listPage` — et non `listAll` — qui fait foi : toute la surface
   * d'administration (listing, révocation par référence, « déconnecter partout »)
   * est bâtie sur la pagination, pour que son coût mémoire soit **indépendant du
   * nombre de sessions**. Un store qui ne saurait que tout charger serait une
   * régression déguisée en capacité.
   */
  supportsEnumeration(): boolean {
    const storage = this.storage;
    return !!storage && typeof storage.listPage === "function";
  }

  /**
   * Champs de tri que le backend de session **actuellement configuré** sait
   * honorer, en vocabulaire public.
   *
   * La capacité se CONSTATE au runtime : la même application rend `["updatedAt",
   * "id"]` sur SQLite et `[]` sur Redis (`SCAN` ne donne aucun ordre global).
   * Le data plane transmet cette liste à `parsePageQuery`, qui **refuse** (400)
   * un `order` qu'aucun store ne pourrait honorer — au lieu de rendre une page
   * non triée en laissant croire le contraire.
   *
   * @returns les champs triables, liste vide si le backend ne trie pas.
   */
  sortableFields(): readonly string[] {
    return this.storage?.sortableFields ?? [];
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
  /**
   * Référence publique de la session qui porte la **requête en cours**, lue dans
   * le contexte de l'ALS — ou `null` quand la requête n'en porte aucune (CLI,
   * appel interne, session jamais démarrée).
   *
   * Point UNIQUE de cette dérivation : marquer « cet appareil » se fait ici, et
   * les deux énumérations (admin et self-service) s'en servent — sans quoi
   * chaque appelant recalculerait la règle et l'une des copies dériverait.
   * Un HMAC par page d'administration, jamais sur le chemin nominal.
   */
  currentSessionRef(): string | null {
    if (!this.secret) return null;
    const id = RequestContext.getContext<ContextType>()?.session?.id;
    return typeof id === "string" && id.length > 0
      ? computeSessionRef(this.secret, id)
      : null;
  }

  async listSessionsPage(
    query: ISessionListQuery,
  ): Promise<IPage<ISessionSummary>> {
    const storage = this.enumerable();
    const page = await storage.listPage!(query);
    const wantUser = query.user;
    // Une seule dérivation pour toute la page (le HMAC ne dépend pas des lignes).
    const currentRef = this.currentSessionRef();
    const items: ISessionSummary[] = [];
    for (const rec of page.items) {
      const user = typeof rec.data.user === "string" ? rec.data.user : "";
      // Ré-application défensive du filtre : un store qui l'ignorerait ne peut
      // pas faire fuiter la session d'un tiers dans « mes sessions ».
      if (wantUser !== undefined && user !== wantUser) continue;
      items.push(toSessionSummary(rec, this.sessionRef(rec.id), currentRef));
    }
    return { ...page, items };
  }

  /**
   * Compte les sessions sans les énumérer (KPI de la console). Renvoie **`-1`**
   * si le backend ne sait pas compter à coût raisonnable (Redis) — l'appelant
   * affiche alors l'inconnu plutôt qu'un chiffre inventé.
   */
  async countSessions(query?: Partial<ISessionListQuery>): Promise<number> {
    const storage = this.enumerable();
    if (typeof storage.countSessions !== "function") return -1;
    return storage.countSessions(query);
  }

  /**
   * Compte les utilisateurs **distincts** ayant une session — le second nombre
   * de la console, celui que `countSessions` ne dit pas (« 400 sessions » n'est
   * pas « 400 personnes »).
   *
   * @returns le nombre d'utilisateurs distincts, ou **`-1`** si le backend ne
   *   sait pas agréger (Redis).
   */
  async countDistinctUsers(
    query?: Partial<ISessionListQuery>,
  ): Promise<number> {
    const storage = this.enumerable();
    if (typeof storage.countDistinctUsers !== "function") return -1;
    return storage.countDistinctUsers(query);
  }

  /**
   * Les compteurs de tête de la console — posés sur la collection ENTIÈRE, pas
   * sur la page affichée.
   *
   * C'est la correction d'un mensonge d'affichage : les cartes étaient calculées
   * dans le navigateur à partir des sessions chargées, donc bornées par la
   * fenêtre du tableau. Elles décrivaient l'échantillon visible en ayant l'air
   * de décrire le parc.
   *
   * Chaque compteur vaut `null` quand le backend ne sait pas répondre — la
   * console affiche alors l'inconnu (« — ») plutôt qu'un zéro qui se lirait
   * comme une absence.
   *
   * @param query - filtres à appliquer avant comptage (sans fenêtre).
   */
  async countSessionFacets(
    query?: Partial<ISessionListQuery>,
  ): Promise<ISessionCounts> {
    const [facets, users] = await Promise.all([
      countFacets(SESSION_FACETS, (facet) =>
        this.countSessions({ ...query, ...facet }),
      ),
      this.countDistinctUsers(query),
    ]);
    return { ...facets, users: users >= 0 ? users : null };
  }

  /**
   * Storage courant, garanti énumérable — factorise la pré-condition de toute la
   * surface admin (une seule formulation de l'erreur, un seul point à faire
   * évoluer).
   *
   * @throws Error si le storage est absent ou n'implémente pas `listPage`.
   */
  // `private` (soft TS) et non `#enumerable` (hard ECMAScript), même raison que
  // `storages` plus haut : une méthode `#` installe un brand check runtime qui
  // rejette tout receveur n'étant pas passé par le constructeur — or les tests
  // d'orchestration instancient volontairement par `Object.create(prototype)`
  // pour isoler la surface admin du constructeur lourd (kernel/certificats).
  private enumerable(): ISessionStorage {
    const storage = this.storage;
    if (!storage || typeof storage.listPage !== "function") {
      throw new Error("sessions: enumeration not supported by current storage");
    }
    return storage;
  }

  /**
   * Parcourt les sessions **page par page**, en ne gardant JAMAIS plus d'une page
   * en mémoire — le cœur de la gouvernance bornée : retrouver une session par sa
   * référence publique impose de recalculer un HMAC sur chaque id, mais pas de
   * charger le parc entier pour le faire.
   *
   * Gère les deux modes du contrat de façon transparente pour l'appelant :
   * curseur (`nextCursor` du store) ou offset (avance de `SCAN_PAGE`). Le visiteur
   * renvoie `true` pour **arrêter** le parcours (court-circuit dès le match).
   *
   * @param filter - restriction poussée au store (ex. `user`).
   * @param visit - appelé pour chaque record ; `true` = stop.
   * @returns `true` si le parcours a été arrêté par le visiteur.
   */
  private async eachSessionRecord(
    filter: ISessionListFilter | undefined,
    visit: (rec: ISessionRecord) => boolean | Promise<boolean>,
  ): Promise<boolean> {
    const storage = this.enumerable();
    let cursor: string | undefined;
    let offset = 0;
    // Garde-fou : borne le nombre d'itérations pour qu'un store au curseur
    // pathologique (qui ne convergerait jamais vers "0") ne boucle pas à l'infini.
    for (let guard = 0; guard < MAX_ADMIN_PAGES; guard += 1) {
      const page: IPage<ISessionRecord> = await storage.listPage!({
        ...filter,
        limit: SCAN_PAGE,
        // withTotal:false → jamais de COUNT sur un parcours (on ne l'affiche pas).
        withTotal: false,
        ...(cursor !== undefined ? { cursor } : { offset }),
      });
      for (const rec of page.items) {
        if (await visit(rec)) return true;
      }
      if (!page.hasNext) return false;
      if (page.nextCursor) {
        cursor = page.nextCursor;
      } else {
        offset += SCAN_PAGE;
      }
    }
    this.log(
      `sessions: parcours admin interrompu après ${MAX_ADMIN_PAGES} pages ` +
        `(résultat potentiellement partiel)`,
      "WARNING",
    );
    return false;
  }

  /**
   * Révoque une session par son `ref` public : re-scanne, recalcule le HMAC de
   * chaque id pour retrouver l'id réel (l'id brut ne quitte jamais le process),
   * puis `destroy()`. `ref` étant public (pas un secret), la comparaison directe
   * est sûre. Idempotent — `false` si aucun `ref` ne correspond.
   */
  async destroyByRef(ref: string, actor?: string | null): Promise<boolean> {
    const storage = this.enumerable();
    let destroyed = false;
    await this.eachSessionRecord(undefined, async (rec) => {
      if (this.sessionRef(rec.id) !== ref) return false;
      const subject = typeof rec.data.user === "string" ? rec.data.user : null;
      destroyed = await storage.destroy(rec.id);
      if (destroyed) {
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
      return true; // référence trouvée → on arrête le parcours
    });
    return destroyed;
  }

  /**
   * « Déconnexion partout » : détruit TOUTES les sessions d'un utilisateur (scan
   * O(N) — pas d'index inverse, acceptable en admin). Renvoie le nombre détruit.
   */
  async destroyByUser(
    identifier: string,
    actor?: string | null,
  ): Promise<number> {
    const storage = this.enumerable();
    let destroyed = 0;
    // Détruire EN PARCOURANT est le cas difficile : la suppression modifie la
    // collection qu'on est en train de lire. Sous offset, chaque suppression fait
    // « glisser » les éléments d'un rang — avancer le décalage en sauterait ;
    // sous curseur, la robustesse dépend du backend (le `SCAN` Redis la garantit,
    // un curseur naïf construit sur un rang ne la garantit pas).
    //
    // Plutôt que de parier sur le mode — donc sur l'implémentation d'un store
    // qu'on ne contrôle pas — on repasse jusqu'à ce qu'un passage COMPLET ne
    // détruise plus rien. La convergence est garantie (chaque passage non final
    // retire au moins une session, le parc est fini) et la propriété rendue est
    // celle qui compte : quand `destroyByUser` rend la main, il ne reste RIEN.
    // Une révocation « déconnecter partout » qui en laisse une seule n'est pas
    // une imprécision, c'est une faille.
    for (let pass = 0; pass < MAX_LOGOUT_PASSES; pass += 1) {
      let destroyedThisPass = 0;
      await this.eachSessionRecord({ user: identifier }, async (rec) => {
        // Re-check d'appartenance : un store qui ignorerait le filtre ne peut pas
        // faire détruire la session d'un tiers.
        if (rec.data.user !== identifier) return false;
        if (await storage.destroy(rec.id)) destroyedThisPass += 1;
        return false; // ne jamais court-circuiter : on veut TOUT le passage
      });
      destroyed += destroyedThisPass;
      // Un passage complet sans destruction = le parc est propre (ou plus rien
      // n'est destructible) → on s'arrête, en ayant la preuve, pas l'espoir.
      if (destroyedThisPass === 0) break;
      if (pass === MAX_LOGOUT_PASSES - 1) {
        this.log(
          `sessions: logout-all interrompu après ${MAX_LOGOUT_PASSES} passages ` +
            `— user=${identifier} (révocation potentiellement incomplète)`,
          "WARNING",
        );
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
   * Énumère **une page** des sessions APPARTENANT à `identifier`
   * ({@link ISessionSummary} redactés). Délègue à {@link listSessionsPage} avec le
   * filtre `user` (poussé au store PUIS ré-appliqué — défense en profondeur). Un
   * `identifier` vide renvoie une page vide (jamais les sessions anonymes
   * `user===""`, qui appartiennent à tout le monde et donc à personne).
   */
  async listOwnSessionsPage(
    identifier: string,
    query: ISessionListQuery,
  ): Promise<IPage<ISessionSummary>> {
    if (!identifier) {
      return {
        items: [],
        total: 0,
        limit: query.limit,
        offset: query.offset ?? 0,
        hasNext: false,
      };
    }
    return this.listSessionsPage({ ...query, user: identifier });
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
    const storage = this.enumerable();
    let destroyed = false;
    // Périmètre fermé : on ne parcourt QUE les sessions de l'appelant.
    await this.eachSessionRecord({ user: identifier }, async (rec) => {
      // Re-check d'appartenance AVANT le match de ref (défense si un store
      // ignorait le filtre) → un ref d'autrui n'est jamais atteignable ici.
      if (rec.data.user !== identifier) return false;
      if (this.sessionRef(rec.id) !== ref) return false;
      destroyed = await storage.destroy(rec.id);
      if (destroyed) {
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
      return true; // référence trouvée → on arrête le parcours
    });
    return destroyed;
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

// Storage built-in fourni par @nodefony/http (les ORM enregistrent les leurs) :
// `memory` (volatil — dev/charge/CI, pendant des Memory*Store de sécurité). La
// persistance des sessions passe par un adapter durable (drizzle=sqlite mono-nœud,
// redis/mongoose multi-nœud) auto-enregistré par le module chargé. Le store fichier
// (1 fichier/session) a été retiré : sqlite couvre la persistance mono-nœud.
SessionsService.registerStorage("memory", MemorySessionStorage);

export default SessionsService;

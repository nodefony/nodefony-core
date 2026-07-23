import {
  Nodefony,
  Container,
  Module,
  Service,
  type Severity,
  type Msgid,
  type Message,
  type Pci,
} from "nodefony";
import type { RedisClientType } from "redis";
import Connection from "../src/Connection";
import { buildClientOptions } from "../src/buildClientOptions";
import { resolveKeyPrefix } from "../src/keyNamespace";
import type { IRedisConfig } from "../interfaces/IRedisConfig";

const serviceName = "redis";

/**
 * Service Redis Nodefony — orchestre N connexions nommées (par défaut `main`,
 * `publish`, `subscribe`) à partir de la config validée par Zod.
 *
 * La config est validée + gelée au boot du Module class (`onKernelRegister`,
 * exposée au container sous `redisConfig`). Le service la consomme sans
 * redupliquer la validation.
 *
 * Perf/mémoire : la map de connexions est en **lazy alloc** (`null` jusqu'à la
 * 1ʳᵉ connexion ouverte) et toutes les connexions sont fermées au `onTerminate`
 * du kernel (listeners retirés explicitement côté `Connection`).
 */
class RedisService extends Service {
  module: Module;
  /** Connexions ouvertes — `null` tant qu'aucune n'est créée (lazy). */
  #connections: Record<string, Connection> | null = null;
  /** Config validée + gelée (résolue à l'init). */
  #config: IRedisConfig | null = null;
  /**
   * Cloison de clés résolue — `undefined` tant que non calculée, `null` quand la
   * résolution a conclu qu'il n'y en a pas (distinction nécessaire : sans elle,
   * une application anonyme recalculerait à chaque clé).
   */
  #keyNamespace: string | null | undefined = undefined;
  /**
   * Connexions actuellement signalées indisponibles — sert à ne journaliser
   * qu'aux TRANSITIONS (une session écrit à chaque requête : journaliser à
   * chaque appel noierait le journal au lieu d'alerter).
   *
   * Lazy : `null` tant que tout va bien, et remis à `null` dès que la dernière
   * connexion est rétablie (aucune structure allouée sur le chemin nominal).
   */
  #unavailable: Set<string> | null = null;

  constructor(module: Module) {
    // Aucune option de service : la config Redis vit dans `module.config`
    // (validée par `defineRedisConfig` au `onKernelRegister`) et se lit via
    // `#resolveConfig()`. Lire ici une clé `.redis` des options du module était
    // un vestige : ces options sont FLAT (cf `index.ts`), la clé n'existe pas et
    // le service recevait toujours `{}` — autant le dire.
    super(serviceName, module.container as Container, null, {});
    this.module = module;
    module.kernel?.once("onTerminate", async () => {
      await this.closeConnections();
    });
  }

  override log(pci: Pci, severity?: Severity, msgid?: Msgid, msg?: Message) {
    if (!msgid) {
      // eslint-disable-next-line no-param-reassign
      msgid = `\x1b[36mREDIS SERVICE ${this.name} \x1b[0m`;
    }
    return super.log(pci, severity, msgid, msg);
  }

  /** Connexions ouvertes (vide si aucune). */
  get connections(): Record<string, Connection> {
    return this.#connections ?? {};
  }

  /**
   * Cloison des clés de CETTE application, résolue une fois.
   *
   * `keyNamespace` explicite, sinon le nom de l'application. Les stores composent
   * leur préfixe avec (`resolveKeyPrefix`) pour que deux applications sur un même
   * Redis n'écrivent — et surtout ne BALAIENT — jamais le même espace de clés.
   *
   * `undefined` = aucune cloison résolue (application anonyme) → les stores
   * gardent leur préfixe historique : une application seule n'a rien à séparer.
   */
  get keyNamespace(): string | undefined {
    if (this.#keyNamespace === undefined) {
      this.#keyNamespace =
        this.#resolveConfig().keyNamespace ??
        this.module.kernel?.projectName ??
        null;
    }
    return this.#keyNamespace ?? undefined;
  }

  /**
   * Préfixe de clés d'un store, cloisonné par application.
   *
   * @param base - préfixe historique du store (`nf:sess`, `nf:tok`, `nf:wac`).
   * @returns le préfixe à utiliser pour composer les clés ET les motifs de balayage.
   */
  keyPrefix(base: string): string {
    return resolveKeyPrefix(base, this.keyNamespace);
  }

  /** Config Redis validée (résout depuis le container, fallback options). */
  #resolveConfig(): IRedisConfig {
    if (this.#config) {
      return this.#config;
    }
    this.#config = this.module.config as IRedisConfig;
    return this.#config;
  }

  /**
   * Ouvre toutes les connexions déclarées dans la config (si `enabled`).
   * Appelé par le cycle de vie du Module. Une connexion en échec est loguée
   * sans bloquer les autres (résilience boot).
   */
  async init(): Promise<this> {
    const config = this.#resolveConfig();
    if (!config.enabled) {
      this.log("Module Redis désactivé (enabled=false) — 0 connexion", "INFO");
      return this;
    }
    for (const name in config.connections) {
      try {
        await this.createConnection(name);
      } catch (e) {
        this.log(e as Error, "ERROR");
      }
    }
    return this;
  }

  /**
   * Crée et ouvre une connexion nommée.
   *
   * @param name - clé de la connexion dans `config.connections`.
   * @returns la connexion ouverte.
   * @throws si le nom est déjà ouvert ou inconnu, ou si la connexion échoue.
   */
  async createConnection(name: string): Promise<Connection> {
    const config = this.#resolveConfig();
    if (this.#connections?.[name]) {
      throw new Error(`${this.name} client "${name}" already exists`);
    }
    const definition = config.connections[name];
    if (!definition) {
      throw new Error(`${this.name} connection "${name}" undefined in config`);
    }
    const options = buildClientOptions(config, definition);
    const conn = new Connection(name, options, this);
    if (this.#connections === null) {
      this.#connections = Object.create(null) as Record<string, Connection>;
    }
    this.#connections[name] = conn;
    await conn.create();
    this.fire("connection", conn.client, conn);
    return conn;
  }

  /** Connexion par nom (ou `undefined`). */
  getConnection(name: string): Connection | undefined {
    return this.#connections?.[name];
  }

  /**
   * Client redis brut d'une connexion **utilisable**, ou `null`.
   *
   * `null` ne veut pas dire « connexion inconnue » mais « ne prends pas la
   * peine » : tous les consommateurs (stores de session, de jetons, de
   * passkeys, backplane realtime, idempotence) traitent `null` comme une
   * indisponibilité et dégradent. Rendre un client fermé leur ferait prendre un
   * `ClientClosedError` là où leur contrat promet un repli.
   *
   * Pourquoi tester l'ouverture et pas seulement la présence : `createClient()`
   * rend un objet AVANT `connect()` (`Connection.create()`), et une connexion
   * dont l'ouverture a échoué reste inscrite dans la map — le client existe donc
   * **sans jamais avoir été ouvert**. `isOpen` (et non `isReady`) est le bon
   * critère : pendant une reconnexion le socket est ouvert et node-redis met les
   * commandes en file, ce qui est exactement la résilience recherchée.
   *
   * L'indisponibilité est **journalisée à la transition** — une dégradation
   * muette contredit le principe de résilience du framework (tout repli
   * s'annonce), mais journaliser à chaque appel noierait le journal.
   */
  getClient(name: string): RedisClientType | null {
    const client = this.#connections?.[name]?.client ?? null;
    if (client?.isOpen) {
      if (this.#unavailable?.delete(name)) {
        if (this.#unavailable.size === 0) {
          this.#unavailable = null;
        }
        this.log(`connexion "${name}" rétablie`, "INFO");
      }
      return client;
    }
    if (!this.#unavailable) {
      this.#unavailable = new Set();
    }
    if (!this.#unavailable.has(name)) {
      this.#unavailable.add(name);
      this.log(
        `connexion "${name}" indisponible (${
          client ? "socket fermé" : "jamais ouverte"
        }) — les consommateurs de cette connexion dégradent tant qu'elle ne revient pas`,
        "WARNING",
      );
    }
    return null;
  }

  /** Ferme toutes les connexions ouvertes (idempotent). */
  async closeConnections(): Promise<void> {
    if (!this.#connections) {
      return;
    }
    for (const name in this.#connections) {
      try {
        await this.#connections[name].close();
      } catch (e) {
        this.log(e as Error, "ERROR");
      }
    }
    this.#connections = null;
  }

  generateId(): string {
    return Nodefony.generateId();
  }
}

export default RedisService;

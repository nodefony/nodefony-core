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
import { defineRedisConfig } from "../config/defineRedisConfig";
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

  constructor(module: Module) {
    super(
      serviceName,
      module.container as Container,
      null,
      (module.options?.redis as Record<string, unknown>) ?? {},
    );
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

  /** Config Redis validée (résout depuis le container, fallback options). */
  #resolveConfig(): IRedisConfig {
    if (this.#config) {
      return this.#config;
    }
    const fromContainer = this.module.get?.("redisConfig") as
      | IRedisConfig
      | undefined;
    this.#config =
      fromContainer ??
      defineRedisConfig((this.module.options?.redis as never) ?? {});
    return this.#config;
  }

  /**
   * Ouvre toutes les connexions déclarées dans la config (si `enabled`).
   * Appelé par le cycle de vie du Module. Une connexion en échec est loguée
   * sans bloquer les autres (résilience boot).
   */
  async initialize(): Promise<this> {
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

  /** Client redis brut par nom de connexion (ou `null`). */
  getClient(name: string): RedisClientType | null {
    return this.#connections?.[name]?.client ?? null;
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

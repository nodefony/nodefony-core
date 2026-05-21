import fs from "node:fs";
import path from "node:path";
import { Service } from "nodefony";
import type { Container, Event, Module } from "nodefony";
import { DrizzleOrm } from "../src/orm-core/index";
import type {
  DrizzleConnectorConfig,
  DrizzleModuleConfig,
} from "../config/config";

const serviceName = "drizzle";

/**
 * Service bootable du module `@nodefony/drizzle`.
 *
 * Au boot du kernel (`onBoot`), instancie un {@link DrizzleOrm} (adapter
 * orm-core) **par connecteur** déclaré dans la config et le connecte ; chaque
 * ORM s'auto-enregistre dans le `ormRegistry` (accessible ensuite via DI ou
 * `OrmRegistry.get(name)`). Ferme proprement les connexions à `onTerminate`.
 *
 * C'est le point d'entrée « ORM par défaut » de l'app : il rend Drizzle utilisable
 * sans logique métier — les entités (`@entity`) ciblant un connecteur sont
 * compilées à la connexion (aucune au départ = base connectée mais vide).
 */
class DrizzleService extends Service {
  module: Module;
  /** ORM connectés, indexés par nom de connecteur. */
  readonly #orms = new Map<string, DrizzleOrm>();

  constructor(module: Module) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options ?? {},
    );
    this.module = module;

    // Connexion au boot (après chargement des modules/entités), fermeture au shutdown.
    this.kernel?.once("onBoot", async () => {
      await this.connectAll().catch((e: Error) => {
        this.log(e, "ERROR");
        throw e;
      });
    });
    this.kernel?.once("onTerminate", async () => {
      await this.disconnectAll().catch(() => {
        /* shutdown — silencieux */
      });
    });
  }

  /** Connecte tous les connecteurs déclarés en config. */
  async connectAll(): Promise<void> {
    const connectors =
      (this.options as unknown as DrizzleModuleConfig).connectors ?? {};
    for (const [name, cfg] of Object.entries(connectors)) {
      await this.#connectOne(name, cfg);
    }
  }

  /** Connecte un connecteur (crée le dossier de la base si nécessaire). */
  async #connectOne(name: string, cfg: DrizzleConnectorConfig): Promise<void> {
    const filename = cfg.filename;
    if (filename && filename !== ":memory:") {
      fs.mkdirSync(path.dirname(filename), { recursive: true });
    }
    const orm = new DrizzleOrm(name, { filename });
    await orm.connect();
    this.#orms.set(name, orm);
    this.log(
      `Drizzle ORM "${name}" connected (${filename ?? ":memory:"})`,
      "INFO",
    );
  }

  /** Ferme toutes les connexions. */
  async disconnectAll(): Promise<void> {
    for (const orm of this.#orms.values()) {
      await orm.disconnect();
    }
    this.#orms.clear();
  }

  /** Retourne l'ORM Drizzle d'un connecteur (défaut : `"default"`). */
  getOrm(name = "default"): DrizzleOrm | undefined {
    return this.#orms.get(name);
  }
}

export default DrizzleService;

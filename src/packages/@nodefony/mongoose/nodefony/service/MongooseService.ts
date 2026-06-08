import mongoose from "mongoose";
import { Service } from "nodefony";
import type { Container, Event, Module } from "nodefony";
import { queryFlowMonitor } from "@nodefony/orm-core";
import { MongooseOrm } from "../src/orm-core/MongooseOrm";
import type {
  MongooseConnectorConfig,
  MongooseModuleConfig,
} from "../config/config";

const serviceName = "mongoose";

/**
 * Service bootable du module `@nodefony/mongoose` (driver NoSQL).
 *
 * Au boot du kernel (`onBoot`), instancie un {@link MongooseOrm} (adapter
 * orm-core) **par connecteur** déclaré dans la config et le connecte ; chaque
 * ORM s'auto-enregistre dans le `ormRegistry`. Ferme proprement les connexions
 * à `onTerminate`.
 *
 * Refonte de l'ancien `Mongoose extends Orm` (core legacy) : ce service ne
 * dérive plus de la base ORM du core — il **orchestre** des adapters orm-core
 * autonomes, exactement comme `DrizzleService`. Le core ne connaît plus l'ORM.
 */
class MongooseService extends Service {
  module: Module;
  /** ORM connectés, indexés par nom de connecteur. */
  readonly #orms = new Map<string, MongooseOrm>();

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
      // Sonde de flux ORM : ON hors production (observabilité Supervision), OFF
      // en prod → coût nul sur le hot path. Override via NODEFONY_ORM_FLOW (1/0).
      const flag = process.env.NODEFONY_ORM_FLOW;
      queryFlowMonitor.setEnabled(
        flag !== undefined
          ? flag === "1" || flag === "true"
          : this.kernel?.environment !== "production",
      );
      // Trace Mongoose des requêtes (dev) si demandé en config.
      if ((this.options as unknown as MongooseModuleConfig).debug) {
        mongoose.set("debug", true);
      }
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
      (this.options as unknown as MongooseModuleConfig).connectors ?? {};
    for (const [name, cfg] of Object.entries(connectors)) {
      await this.#connectOne(name, cfg);
    }
  }

  /** Assemble l'URI de connexion à partir de la config (`uri` ou composants). */
  static buildUri(cfg: MongooseConnectorConfig): string {
    if (cfg.uri) {
      return cfg.uri;
    }
    const host = cfg.host ?? "localhost";
    const port = cfg.port ?? 27017;
    const dbname = cfg.dbname ?? "nodefony";
    return `mongodb://${host}:${port}/${dbname}`;
  }

  /** Connecte un connecteur (URI + options d'auth/pool). */
  async #connectOne(name: string, cfg: MongooseConnectorConfig): Promise<void> {
    const uri = MongooseService.buildUri(cfg);
    const orm = new MongooseOrm(name, uri, cfg.options);
    await orm.connect();
    this.#orms.set(name, orm);
    this.log(`Mongoose ORM "${name}" connected (${orm.safeTarget()})`, "INFO");
  }

  /** Ferme toutes les connexions. */
  async disconnectAll(): Promise<void> {
    for (const orm of this.#orms.values()) {
      await orm.disconnect();
    }
    this.#orms.clear();
  }

  /** Retourne l'ORM Mongoose d'un connecteur (défaut : `"nodefony"`). */
  getOrm(name = "nodefony"): MongooseOrm | undefined {
    return this.#orms.get(name);
  }
}

export default MongooseService;

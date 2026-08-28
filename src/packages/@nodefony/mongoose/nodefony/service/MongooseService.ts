import mongoose from "mongoose";
import type { ConnectOptions } from "mongoose";
import { Service } from "nodefony";
import type { Container, Event, Module } from "nodefony";
import { queryFlowMonitor, resolveOrmFlowEnabled } from "@nodefony/orm-core";
import { MongooseOrm } from "../src/orm-core/MongooseOrm";
import type {
  IMongooseConfig,
  IMongooseConnectorConfig,
} from "../interfaces/IMongooseConfig";

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

    // Connexion au boot (après chargement des modules/entités), fermeture au
    // shutdown. `module.hookKernel` et non `kernel.once` : sans le tag, la
    // promesse `static critical = false` du module ne couvrait PAS ce hook — une
    // base injoignable interrompait le boot en production, malgré elle.
    this.module.hookKernel("onBoot", async () => {
      // Sonde de flux ORM : OFF en prod (coût nul hot path), ON sinon. Override
      // NF_ORM_FLOW. Calcul factorisé en orm-core (C5).
      queryFlowMonitor.setEnabled(resolveOrmFlowEnabled(this.kernel));
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

  /** Config validée (Zod) exposée par le Module (`this.module.config`). */
  #config(): IMongooseConfig {
    return this.module.config as IMongooseConfig;
  }

  /** Connecte tous les connecteurs déclarés en config (validée Zod). */
  async connectAll(): Promise<void> {
    const config = this.#config();
    // Trace Mongoose des requêtes (dev) si demandé en config.
    if (config?.debug) {
      mongoose.set("debug", true);
    }
    const connectors = config?.connectors ?? {};
    for (const [name, cfg] of Object.entries(connectors)) {
      await this.#connectOne(name, cfg);
    }
  }

  /** Assemble l'URI de connexion à partir de la config (`uri` ou composants). */
  static buildUri(cfg: IMongooseConnectorConfig): string {
    if (cfg.uri) {
      return cfg.uri;
    }
    const host = cfg.host ?? "localhost";
    const port = cfg.port ?? 27017;
    const dbname = cfg.dbname ?? "nodefony";
    return `mongodb://${host}:${port}/${dbname}`;
  }

  /**
   * Options de connexion Mongoose d'un connecteur.
   *
   * `options` reste un fourre-tout transmis tel quel — Mongoose valide ses
   * propres `ConnectOptions`, les re-modéliser en Zod serait une duplication
   * qui dériverait. `autoIndex` fait exception, et une seule : il décide si les
   * contraintes d'unicité sont construites au démarrage, ce qui mérite un champ
   * typé, décrit, et visible dans la configuration d'un connecteur.
   *
   * Il **prime** donc sur une clé homonyme écrite dans `options` : entre deux
   * canaux, celui qui est déclaré gagne — la même règle que les délais de
   * connexion, où un choix explicite l'emporte sur un défaut.
   *
   * @param cfg - configuration validée du connecteur.
   * @returns les options à passer à la connexion, ou `undefined` s'il n'y en a aucune.
   */
  static buildConnectOptions(
    cfg: IMongooseConnectorConfig,
  ): ConnectOptions | undefined {
    if (cfg.autoIndex === undefined) {
      return cfg.options as ConnectOptions | undefined;
    }
    return {
      ...((cfg.options ?? {}) as ConnectOptions),
      autoIndex: cfg.autoIndex,
    };
  }

  /** Connecte un connecteur (URI + options d'auth/pool). */
  async #connectOne(
    name: string,
    cfg: IMongooseConnectorConfig,
  ): Promise<void> {
    const uri = MongooseService.buildUri(cfg);
    const orm = new MongooseOrm(
      name,
      uri,
      MongooseService.buildConnectOptions(cfg),
    );
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

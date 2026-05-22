import fs from "node:fs";
import path from "node:path";
import { Service } from "nodefony";
import type { Container, Event, Module } from "nodefony";
import type { Options } from "sequelize";
import { SequelizeOrm } from "../src/orm-core/SequelizeOrm";

const serviceName = "sequelizeOrm";

/** Config du module : connecteurs orm-core indexés par nom (= clé du `ormRegistry`). */
interface SequelizeModuleConfig {
  connectors?: Record<string, Options>;
}

/**
 * Service bootable orm-core du module `@nodefony/sequelize`.
 *
 * Au boot du kernel (`onBoot`), instancie un {@link SequelizeOrm} (adapter
 * orm-core) **par connecteur** déclaré dans `config.orm.connectors` et le
 * connecte ; chaque ORM s'auto-enregistre dans le `ormRegistry` → visible dans le
 * Dashboard ORM (`/nodefony/orm`) à côté de Drizzle. Ferme proprement à
 * `onTerminate`.
 *
 * **Distinct du service legacy** `service/orm.ts` (qui étend l'ancien `Orm` du
 * core et alimente le registre legacy, pas `OrmRegistry`). Les deux cohabitent :
 * connecteurs et clés de config séparés (`orm.connectors` ici vs `connectors`).
 */
class SequelizeService extends Service {
  module: Module;
  /** ORM connectés, indexés par nom de connecteur. */
  readonly #orms = new Map<string, SequelizeOrm>();

  constructor(module: Module) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options ?? {},
    );
    this.module = module;

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

  /** Connecte tous les connecteurs orm-core déclarés en config. */
  async connectAll(): Promise<void> {
    const connectors = (this.options as SequelizeModuleConfig).connectors ?? {};
    for (const [name, cfg] of Object.entries(connectors)) {
      await this.#connectOne(name, cfg);
    }
  }

  /** Connecte un connecteur (crée le dossier de la base SQLite si nécessaire). */
  async #connectOne(name: string, cfg: Options): Promise<void> {
    const storage = typeof cfg.storage === "string" ? cfg.storage : undefined;
    if (storage && storage !== ":memory:") {
      fs.mkdirSync(path.dirname(storage), { recursive: true });
    }
    const orm = new SequelizeOrm(name, cfg);
    await orm.connect();
    this.#orms.set(name, orm);
    this.log(
      `Sequelize ORM "${name}" connected (${String(cfg.dialect)}${storage ? ` ${storage}` : ""})`,
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

  /** Retourne l'ORM Sequelize d'un connecteur (défaut : `"sequelize"`). */
  getOrm(name = "sequelize"): SequelizeOrm | undefined {
    return this.#orms.get(name);
  }
}

export default SequelizeService;

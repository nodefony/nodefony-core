import path from "node:path";
import { Kernel, Nodefony } from "nodefony";

export default {
  debug: true,
  strategy: "migrate", // sync || migrate || none  when nodefony build  or  nodefony install
  // watch: true,
  connectors: {
    nodefony: {
      driver: "sqlite",
      // Getter lazy : kernel déréférencé à la LECTURE (boot/merge), pas à l'import
      // → le module reste IMPORTABLE sans kernel (testabilité). Runtime inchangé.
      get dbname(): string {
        return path.resolve(
          (Nodefony.getKernel() as Kernel).path,
          "nodefony",
          "databases",
          "nodefony.db",
        );
      },
      options: {
        dialect: "sqlite",
        // isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE,
        retry: {
          match: [
            // Sequelize.ConnectionError,
            // Sequelize.ConnectionTimedOutError,
            // Sequelize.TimeoutError,
            /Deadlock/i,
            "SQLITE_BUSY",
          ],
          max: 5,
        },
        pool: {
          max: 5,
          min: 0,
          idle: 10000,
        },
      },
    },
  },
  // orm-core (P5.4) — connecteurs de l'adapter `SequelizeOrm` enregistrés dans le
  // `OrmRegistry` (≠ `connectors` legacy ci-dessus, registre core historique).
  // Surfacés dans le Dashboard ORM (/nodefony/orm) → 2 ORM distincts (Drizzle +
  // Sequelize). Clé ≠ "default" (réservé à Drizzle) : un nom = un ORM dans le
  // registre process-wide.
  orm: {
    connectors: {
      sequelize: {
        dialect: "sqlite",
        logging: false,
        // Getter lazy (idem dbname) : kernel déréférencé à la LECTURE (boot/merge),
        // pas à l'import → module importable sans kernel (testabilité).
        get storage(): string {
          return path.resolve(
            (Nodefony.getKernel() as Kernel).path,
            "nodefony",
            "databases",
            "nodefony-sequelize.db",
          );
        },
      },
    },
  },
  migrations: {
    storage: "sequelize", // sequelize || memory || json
    // Getters lazy (idem dbname) : pas de déréférencement kernel à l'import.
    get path(): string {
      return path.resolve(
        (Nodefony.getKernel() as Kernel).path,
        "nodefony",
        "migrations",
        "sequelize",
      );
    },
    get seedeersPath(): string {
      return path.resolve(
        (Nodefony.getKernel() as Kernel).path,
        "nodefony",
        "migrations",
        "seedeers",
      );
    },
    storageSeedeers: "json",
    options: {},
  },
};

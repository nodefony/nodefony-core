import path from "node:path";
import nodefony, { Kernel } from "nodefony";

export default {
  debug: true,
  strategy: "migrate", // sync || migrate || none  when nodefony build  or  nodefony install
  // watch: true,
  connectors: {
    nodefony: {
      driver: "sqlite",
      dbname: path.resolve(
        (nodefony.kernel as Kernel).path,
        "nodefony",
        "databases",
        "nodefony.db"
      ),
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
  migrations: {
    storage: "sequelize", // sequelize || memory || json
    path: path.resolve(
      (nodefony.kernel as Kernel).path,
      "nodefony",
      "migrations",
      "sequelize"
    ),
    seedeersPath: path.resolve(
      (nodefony.kernel as Kernel).path,
      "nodefony",
      "migrations",
      "seedeers"
    ),
    storageSeedeers: "json",
    options: {},
  },
};

import path from "path";
import { Nodefony, Kernel } from "nodefony";
//import { sequelize } from "@nodefony/sequelize";

const config = {
  connectors: {
    nodefony: {
      driver: "sqlite",
      dbname: path.resolve(
        (Nodefony.getKernel() as Kernel).path,
        "nodefony",
        "databases",
        "nodefony.db",
      ),
      options: {
        dialect: "sqlite",
        // isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE,
        retry: {
          match: [/Deadlock/i, "SQLITE_BUSY"],
          max: 5,
        },
        pool: {
          max: 5,
          min: 0,
          idle: 10000,
        },
      },
    },
    // nodefony: {
    //   driver: "mysql",
    //   dbname: "nodefony",
    //   username: "root",
    //   password: "nodefony",
    //   //credentials: vault,
    //   options: {
    //     dialect: "mysql",
    //     host: "localhost",
    //     port: "3306",
    //     //isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE,
    //     retry: {
    //       match: [
    //         sequelize.ConnectionError,
    //         sequelize.ConnectionTimedOutError,
    //         sequelize.TimeoutError,
    //         /Deadlock/i,
    //       ],
    //       max: 5,
    //     },
    //     pool: {
    //       max: 20,
    //       min: 0,
    //       idle: 10000,
    //       acquire: 60000,
    //     },
    //   },
    // },
    // nodefony: {
    //   driver: "postgres",
    //   dbname: "nodefony",
    //   username: "postgres",
    //   password: "nodefony",
    //   //credentials: vault,
    //   options: {
    //     dialect: "postgres",
    //     host: "localhost",
    //     port: "5432",
    //     //isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE,
    //     retry: {
    //       match: [
    //         sequelize.ConnectionError,
    //         sequelize.ConnectionTimedOutError,
    //         sequelize.TimeoutError,
    //         /Deadlock/i,
    //       ],
    //       max: 5,
    //     },
    //     pool: {
    //       max: 20,
    //       min: 0,
    //       idle: 10000,
    //       acquire: 60000,
    //     },
    //   },
    // },
  },
  // ─── ORM orm-core (Dashboard ORM /nodefony/orm) ───────────────────────────
  // C'EST ICI qu'on choisit le dialecte/la cible de l'adapter `SequelizeOrm`
  // (registre `OrmRegistry`, ≠ `connectors` legacy ci-dessus). Le connecteur
  // `sequelize` apparaît à côté de Drizzle dans le dashboard. Pour basculer en
  // serveur, décommenter MySQL/Postgres : `describeConnection` n'expose JAMAIS
  // les credentials (seul `host:port/base` est affiché ; password rédacté).
  orm: {
    connectors: {
      sequelize: {
        dialect: "sqlite",
        logging: false,
        storage: path.resolve(
          (Nodefony.getKernel() as Kernel).path,
          "nodefony",
          "databases",
          "nodefony-sequelize.db",
        ),
      },
      // sequelize: {
      //   dialect: "mysql",
      //   host: "localhost",
      //   port: 3306,
      //   database: "nodefony",
      //   username: "root",
      //   password: "nodefony", // rédacté dans le dashboard
      //   logging: false,
      // },
      // sequelize: {
      //   dialect: "postgres",
      //   host: "localhost",
      //   port: 5432,
      //   database: "nodefony",
      //   username: "postgres",
      //   password: "nodefony", // rédacté dans le dashboard
      //   logging: false,
      // },
    },
  },
};

export default config;

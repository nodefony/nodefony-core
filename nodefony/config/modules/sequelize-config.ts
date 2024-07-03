import path from "path";
import nodefony, { Kernel } from "nodefony";
//import { sequelize } from "@nodefony/sequelize";

const config = {
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
};

export default config;

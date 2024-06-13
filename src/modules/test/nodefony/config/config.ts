import path from "node:path";
import nodefony, { Kernel } from "nodefony";

export default {
  watch: true,

  "module-sequelize": {
    connectors: {
      myconnector: {
        driver: "sqlite",
        dbname: path.resolve(
          (nodefony.kernel as Kernel).path,
          "nodefony",
          "databases",
          "myconnector.db"
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
  },
};

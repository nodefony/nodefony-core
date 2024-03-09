import {
  Service,
  Module,
  Container,
  Event,
  Entity,
  Orm,
  Severity,
  typeOf,
  extend,
} from "nodefony";
import mongoose, { Model } from "mongoose";

interface Config {
  options: mongoose.ConnectOptions;
  [key: string]: any;
}

const defaultconfigServer = {
  host: "localhost",
  port: 27017,
};

const defaultConfigConnection = {
  socketTimeoutMS: 0,
  // replicaSet: 'rs'
};

const serviceName: string = "mongoose";
class Mongoose extends Orm {
  static engine: typeof mongoose = mongoose;
  module: Module;
  declare db: mongoose.Connection;
  constructor(module: Module) {
    super(serviceName, module, module.options);
    this.module = module;
    module.kernel?.once(
      "onTerminate",
      async () => await this.closeConnections()
    );
    module.kernel?.once("onBoot", async () => {
      await this.boot().catch((e: Error) => {
        throw e;
      });
    });
  }

  boot() {
    return new Promise(async (resolve, reject) => {
      super.boot();
      if (
        this.options.connectors &&
        Object.keys(this.options.connectors).length
      ) {
        for (const name in this.options.connectors) {
          await this.createConnection(name, this.options.connectors[name]);
        }
      } else {
        process.nextTick(async () => {
          this.log("onOrmReady", "DEBUG", "EVENTS MOOGOOSE");
          try {
            await this.fireAsync("onOrmReady", this);
            this.ready = true;
            return resolve(this);
          } catch (e) {
            this.log(e, "ERROR", "EVENTS onOrmReady");
            return reject(e);
          }
        });
      }

      this.kernel?.once("onReady", async () => {
        if (this.kernel?.type === "SERVER") {
          this.displayTable("INFO");
        } else {
          this.displayTable();
        }
      });
      return resolve(this);
    });
  }

  getEntity(name: String): Model<any> | null | Record<string, Entity> {
    if (name) {
      if ((name as string) in this.entities) {
        const entity: Entity = this.entities[name as string];
        return entity.model as Model<any>;
      }
      return null;
    }
    return this.entities;
  }

  async createConnection(name: string, config: Config) {
    if (!name) {
      throw new Error("Mongodb createConnnetion no name connection");
    }
    const host = config.host || this.options.host;
    const port = config.port || this.options.port;
    const url = `mongodb://${host}:${port}/${config.dbname}`;
    const settings = extend(true, {}, defaultConfigConnection, config.options);
    try {
      if (config.credentials && typeOf(config.credentials) === "function") {
        this.log("Try Get Credentials (async method)");
        const auth = await config.credentials(this).catch((e: Error) => {
          throw e;
        });
        if (auth.user) {
          this.log(`Add username Credential for connector ${this.name}`);
          settings.user = auth.user;
        } else {
          this.log("Credentials (async method) no username secret", "WARNING");
        }
        if (auth.pass) {
          this.log(`Add password Credential for connector ${this.name}`);
          settings.pass = auth.pass;
        } else {
          this.log("Credentials (async method) no password secret", "WARNING");
        }
        this.log(`Success Credential (async method) ${auth}`, "DEBUG");
      }
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
    return mongoose
      .createConnection(url, settings)
      .asPromise()
      .then((db) => {
        this.connections[name] = db;
        db.on("close", () => {
          this.closeConnetion(name, db);
        });
        db.on("reconnect", () => {
          this.log(`Reconnection to mongodb database ${name}`, "INFO");
          this.fire("onReconnect", name, db);
          this.connections[name] = db;
        });
        db.on("timeout", () => {
          this.log(`Timeout to mongodb database ${name}`, "INFO");
          this.fire("onTimeout", name, db);
        });
        db.on("parseError", (error) => {
          this.log(`ParseError on mongodb database ${name}`, "ERROR");
          this.log(error, "ERROR");
        });
        db.on("error", (error) => {
          this.log(`Error on mongodb database ${name}`, "ERROR");
          this.log(error, "ERROR");
        });
        db.on("reconnectFailed", (error) => {
          this.log(
            `Error on mongodb database reconnect Failed ${name}`,
            "ERROR"
          );
          this.log(error, "ERROR");
        });
        db.on("disconnected", () => {
          this.log(`mongodb database disconnected ${name}`, "WARNING");
        });
        this.fire("onConnect", name, db);
        this.log(
          `Connection been established successfully
      Type : Mongoose
      DataBase: ${name}
      URL:  ${url}`,
          "INFO",
          `CONNECTOR mongoose ${name}`
        );
        return db;
      })
      .catch((error: Error) => {
        this.log(
          `Cannot connect to mongodb ( ${host}:${port}/${config.dbname} )`,
          "ERROR"
        );
        this.fire("onErrorConnection", null, error);
        // this.log(error, "ERROR");
        throw error;
      });
  }

  static isError(error: Error) {
    return error instanceof mongoose.Error;
  }

  static errorToString(error: Error) {
    return `${error.message}`;
  }

  closeConnetion(name: string, connection: mongoose.Connection) {
    if (!name) {
      throw new Error("Close connection no name connection !!");
    }
    this.fire("onClose", name, connection);
    this.log(`Close connection to mongodb database ${name}`, "WARNING");
    if (this.connections[name]) {
      delete this.connections[name];
    }
  }

  displayTable(severity: Severity = "DEBUG") {
    const options = {
      head: [
        `${this.name.toUpperCase()} CONNECTIONS NAME`,
        "NAME DATABASE",
        "DRIVER",
        "URI",
        "status",
      ],
    };
    const table = this.kernel?.cli?.displayTable([], options);
    if (table) {
      for (const dbname in this.options.connectors) {
        const conn = ["", "", "mongodb", "", ""];
        conn[0] = dbname;
        for (const data in this.options.connectors[dbname]) {
          switch (data) {
            case "dbname":
              conn[1] = this.options.connectors[dbname][data];
              break;
            case "host":
              conn[3] = this.options.connectors[dbname][data];
              break;
            case "port":
              conn[3] += `:${this.options.connectors[dbname][data]}`;
              break;
          }
        }
        conn[4] =
          this.connections[dbname].states[this.connections[dbname]._readyState];
        table.push(conn);
        if (this.kernel && this.kernel.type === "CONSOLE") {
          severity = "DEBUG";
        }
        this.log(`ORM CONNECTORS LIST  : \n${table.toString()}`, severity);
      }
    }
  }

  async closeConnections() {
    for (const conn in this.connections) {
      await this.connections[conn]
        .close()
        .then(() => {
          this.log(`close mongo connection ${conn} `);
        })
        .catch((e: Error) => {
          this.log(e, "ERROR");
        });
    }
  }
}

export default Mongoose;

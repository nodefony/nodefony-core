import { resolve } from "node:path";
import {
  Service,
  Module,
  Container,
  Event,
  Orm,
  Entity,
  Connector,
  typeOf,
  Severity,
  Error as nodefonyError,
} from "nodefony";
import sequelize, {
  Model,
  ConnectionOptions,
  Transaction,
  Options,
  Sequelize as NativeSequelize,
  ModelStatic,
} from "sequelize";

const serviceName: string = "sequelize";
export type Strategy = "sync" | "migrate" | "none";

export type Models = {
  [key: string]: ModelStatic<Model<{}, {}>>;
};

interface Db {
  close: () => Promise<void>;
}

interface Config {
  options: Options;
  [key: string]: any;
}

class ConnectorSequelise extends Connector {
  declare db: NativeSequelize | null;
  constructor(name: string, type: string, options: Config, orm: Sequelize) {
    super(name, type, options, orm);
    this.db = null;
  }

  override onError(err: Error) {
    if (this.state !== "DISCONNECTED") {
      this.orm.kernel?.fire("onError", err, this);
    }
    // this.log(err, "ERROR");
    // this.log(this.settings, "INFO", `CONFIGURATION Sequelize ${this.name}`);
    if (err.code) {
      switch (err.code) {
        case "PROTOCOL_CONNECTION_LOST":
        case "ECONNREFUSED":
          this.state = "DISCONNECTED";
          return new nodefonyError(err.message, err.code);
        // return {
        //   status: 500,
        //   code: err.code,
        //   message: err.message,
        // };
        default:
          return err;
      }
    } else {
      return err;
    }
  }

  override async setConnection(db: NativeSequelize, config: Options) {
    await super.setConnection(db, config);
    /* this.db.afterDisconnect((connection)=>{
      this.log(connection,"WARNING");
    });
    this.db.beforeConnect((config)=>{
      this.log(config, "WARNING");
    });*/
    return db;
  }

  override async connect(
    type: string,
    config: Config
  ): Promise<NativeSequelize> {
    try {
      let logging;
      if (this.orm.debug) {
        logging = (value: any) => {
          this.log(value, "INFO");
        };
      } else {
        logging = false;
      }
      const options: Options = {
        storage: resolve(config.dbname),
        username: config.username,
        password: config.password,
        host: config.host,
        port: config.port,
        database: config.dbname,
        logging,
        ...config.options,
      };
      let conn: NativeSequelize;
      if (config.credentials && typeOf(config.credentials) === "function") {
        this.log("Try Get Credentials (async method)");
        const auth = await config.credentials(this).catch((e: Error) => {
          throw e;
        });
        if (auth.username) {
          this.log(`Add username Credential for connector ${this.name}`);
          options.username = auth.username;
        } else {
          this.log("Credentials (async method) no username secret", "WARNING");
        }
        if (auth.password) {
          this.log(`Add password Credential for connector ${this.name}`);
          options.password = auth.password;
        } else {
          this.log("Credentials (async method) no password secret", "WARNING");
        }
        this.log(`Success Credential (async method) ${auth}`, "DEBUG");
      }
      //console.log(options);
      conn = new sequelize.Sequelize(options);
      return conn
        .authenticate()
        .then(() => {
          return this.setConnection(conn, options);
        })
        .catch((err) => {
          this.log(`Unable to connect to the database : ${err}`, "ERROR");
          //this.onError(err);
          //this.orm.fire("onErrorConnection", this, err);
          throw err;
        });
    } catch (e) {
      console.log("pasasasa");
      this.onError(e as Error);
      this.orm.fire("onErrorConnection", this, e);
      throw e;
    }
  }

  async close() {
    if (this.db) {
      this.orm.log(`Close connection ${this.name}`);
      return await this.db.close().catch((e: Error) => {
        this.orm.log(e, "ERROR");
        throw e;
      });
    }
    return Promise.resolve();
  }
}

class Sequelize extends Orm {
  static engine: typeof sequelize = sequelize;
  engine: typeof sequelize = sequelize;
  strategy: Strategy = "migrate";
  isAssociated: boolean;
  forceAssociated: boolean;
  module: Module;
  constructor(module: Module) {
    super(serviceName, module, module.options);
    this.strategy = "migrate";
    this.isAssociated = false;
    this.forceAssociated = false;
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

  async boot() {
    return new Promise(async (resolve, reject) => {
      super.boot();
      if (
        this.options.connectors &&
        Object.keys(this.options.connectors).length
      ) {
        for (const name in this.options.connectors) {
          await this.createConnection(
            name,
            this.options.connectors[name]
          ).catch((e) => {
            return reject(e);
          });
        }
      } else {
        this.log("onOrmReady", "DEBUG", "EVENTS SEQUELIZE");
        try {
          await this.fireAsync("onOrmReady", this);
          this.ready = true;
          return resolve(this);
        } catch (e) {
          this.log(e, "ERROR", "EVENTS onOrmReady");
          return;
        }
      }
      this.prependListener("onOrmReady", async () => {
        if (this.isAssociated && !this.forceAssociated) {
          return;
        }
        for (const entity in this.entities) {
          const model = this.entities[entity].model as ModelStatic<any>;
          //@ts-ignore
          if (model && model.associate) {
            await this.entities[entity].model.associate(
              this.entities[entity].db.models
            );
            this.log(
              `ASSOCIATE model : ${this.entities[entity].model.name}`,
              "DEBUG"
            );
          }
        }
        this.isAssociated = true;
      });
      this.kernel?.once("onReady", () => {
        if (this.kernel?.type === "SERVER") {
          this.displayTable("INFO");
        } else {
          this.displayTable();
        }
      });
      return resolve(this);
    });
  }

  async createConnection(name: string, config: Config) {
    try {
      if (this.connections[name]) {
        delete this.connections[name];
      }
      // eslint-disable-next-line new-cap
      this.connections[name] = new ConnectorSequelise(
        name,
        config.driver,
        config,
        this
      );
    } catch (e) {
      throw e;
    }
    return await this.connections[name]
      .connect(config.driver, config)
      .catch((e: Error) => {
        throw e;
      });
  }

  getEntity(name: String): Model | null | Record<string, Entity> {
    if (name) {
      if ((name as string) in this.entities) {
        const entity: Entity = this.entities[name as string];
        return entity.model as Model;
      }
      return null;
    }
    return this.entities;
  }

  getNodefonyEntity(name: string): Entity | null | Record<string, Entity> {
    if (name) {
      if (name in this.entities) {
        return this.entities[name];
      }
      return null;
    }
    return this.entities;
  }

  getConnection(name: string) {
    if (this.connections[name]) {
      return this.connections[name].db as object;
    }
    return null;
  }

  getConnections(name: string) {
    if (name) {
      return this.getConnection(name);
    }
    return this.connections;
  }

  getConnectorSettings(tab: any[]) {
    for (const dbname in this.options.connectors) {
      const conn = ["", "", "", "", ""];
      conn[0] = dbname;
      for (const data in this.options.connectors[dbname]) {
        switch (data) {
          case "dbname":
            conn[2] = this.options.connectors[dbname][data];
            break;
          case "options":
            conn[1] = this.options.connectors[dbname][data].dialect;
            if (this.options.connectors[dbname][data].host) {
              conn[3] = `${this.options.connectors[dbname][data].host}:${this.options.connectors[dbname][data].port}`;
            }
            break;
          default:
        }
      }
      if (this.connections[dbname]) {
        conn[4] = this.connections[dbname].state;
      }
      tab.push(conn);
    }
    return tab;
  }

  displayTable(severity: Severity = "DEBUG") {
    const options = {
      head: ["CONNECTOR NAME", "DRIVER", "NAME DATABASE", "HOST", "status"],
    };
    const table = this.kernel?.cli?.displayTable([], options);
    if (table) {
      this.getConnectorSettings(table);

      const res = table.toString();
      this.log(`ORM CONNECTORS LIST  : \n${res}`, severity);
      return res;
    }
  }

  async closeConnections() {
    for (const connection in this.connections) {
      await this.connections[connection].close();
    }
  }
}

export default Sequelize;
export { sequelize, ConnectorSequelise };

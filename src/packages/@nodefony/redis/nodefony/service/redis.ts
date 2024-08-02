import { resolve } from "node:path";
import nodefony, {
  Nodefony,
  Service,
  Module,
  Container,
  Error as nodefonyError,
  Severity,
  Msgid,
  Message,
  extend,
} from "nodefony";
import redis from "redis";
import Connection from "../src/Connection";

const serviceName: string = "redis";

class Redis extends Service {
  static engine: typeof redis = redis;
  engine: typeof redis = redis;
  module: Module;
  connections: Record<string, Connection> = {};
  debug: boolean = false;
  constructor(module: Module) {
    super(
      serviceName,
      module.container as Container,
      null,
      module.options.redis || {}
    );
    this.module = module;
    module.kernel?.once(
      "onTerminate",
      async () => await this.closeConnections()
    );
  }

  log(pci: any, severity?: Severity, msgid?: Msgid, msg?: Message) {
    if (!msgid) {
      // eslint-disable-next-line no-param-reassign
      msgid = `\x1b[36mREDIS SERVICE ${this.name} \x1b[0m`;
    }
    return super.log(pci, severity, msgid, msg);
  }

  async initialize(module: Module): Promise<this> {
    return new Promise(async (resolve, reject) => {
      //console.log(this.options);
      for (const connection in this.options.connections) {
        const options = extend(
          {},
          this.options.globalOptions,
          this.options.connections[connection]
        );
        await this.createConnection(connection, options)
          // .then((client) => {
          //   this.displayTable(client, "INFO");
          //   return client;
          // })
          .catch((e) => {
            this.log(e, "ERROR");
          });
      }
      return resolve(this);
    });
  }

  generateId(): string {
    return nodefony.generateId();
  }
  async createConnection(name: string, options = {}): Promise<Connection> {
    return new Promise((resolve, reject) => {
      try {
        if (!name) {
          name = this.generateId();
        }
        if (name in this.connections) {
          throw new Error(`${this.name} client ${name} already exit `);
        }
        const conn = new Connection(name, options, this);
        this.connections[conn.name] = conn;
        return conn
          .create()
          .then((client) => {
            this.fire("connection", client, conn);
            return resolve(conn);
          })
          .catch((e) => reject(e));
      } catch (e) {
        return reject(e);
      }
    });
  }

  async closeConnections() {
    try {
      for (const connection in this.connections) {
        await this.connections[connection].close();
      }
    } catch (e) {
      this.log(e, "ERROR");
    }
  }

  print(error: Error, message: any) {
    if (error) {
      return this.log(message, "ERROR");
    }
    return this.log(message);
  }

  retry_strategy(retries: number) {
    return Math.min(retries * 100, 10000);
  }
}

export default Redis;
export { redis };

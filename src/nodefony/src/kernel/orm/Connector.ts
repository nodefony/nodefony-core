/* eslint-disable @typescript-eslint/no-explicit-any */
import { Message, Msgid, Orm, Pci, Severity } from "nodefony";
class Connector {
  db: any = null;
  name: string;
  type: string;
  orm: Orm;
  intervalId: number | null = null;
  state: "DISCONNECTED" | "CONNECTED" = "DISCONNECTED";
  options: any;
  constructor(
    name: string,
    type: string,
    options: Record<string, any>,
    orm: Orm
  ) {
    this.name = name;
    this.type = type;
    this.db = null;
    this.orm = orm;
    this.options = options;
  }

  toObject() {
    return {
      state: this.state,
      name: this.name,
      type: this.type,
      options: this.options,
    };
  }

  onError(error: Error) {
    return error;
  }

  async connect(type: string, config: any): Promise<any> {
    console.log(`connect must be override `, type), config;
    return Promise.resolve();
  }

  async setConnection(db: any, config: any) {
    if (!db) {
      throw new Error("Cannot create class Connector without db native");
    }
    this.db = db;
    await this.orm.fireAsync("onConnect", this.name, this.db);
    this.state = "CONNECTED";
    const severity: Severity = "INFO";
    this.log(
      `Connection been established successfully 
      Type : ${this.type}
      Database : ${config.database}`,
      severity
    );
    return db;
  }

  getConnection() {
    return this.db;
  }

  async close() {
    return Promise.resolve();
  }

  log(
    pci: Pci,
    severity?: Severity,
    msgid: Msgid = `CONNECTOR ${this.type} ${this.name}`,
    msg: Message = ""
  ) {
    return this.orm.log(pci, severity, msgid, msg);
  }
}

export default Connector;

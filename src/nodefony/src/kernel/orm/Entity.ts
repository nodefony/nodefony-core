/* eslint-disable @typescript-eslint/no-explicit-any */
import Service from "../../Service";
import Module from "../Module";
import Container from "../../Container";
import { Message, Msgid, Pci, Severity } from "../../syslog/Pdu";

export type TypeEntity<T> = new (...args: any[]) => T;

class Entity extends Service {
  model: any;
  db: any;
  module: Module;
  connectorName: string;
  orm: any;
  encoder: any;
  constructor(
    module: Module,
    name: string,
    ormName: string,
    connectorName: string
  ) {
    super(name, module.container as Container);
    this.module = module;
    this.orm = this.get(ormName);
    if (!this.orm) {
      throw new Error(
        `${this.name} entity can't be registered  ORM not found : ${ormName}`
      );
    }

    this.connectorName = connectorName;
    this.model = null;
    this.encoder = null;

    this.orm.on("onConnect", (connectorName: string, db: any) => {
      if (connectorName === this.connectorName) {
        this.db = db;
        this.model = this.registerModel(this.db);
        this.orm.setEntity(this);
      }
    });
  }

  registerModel(db: any): any {
    console.log(`registerModel must be override`, db);
  }

  override logger(pci: Pci, severity: Severity, msgid: Msgid, msg: Message) {
    if (!msgid) {
      msgid = `Entity ${this.name}`;
    }
    return super.logger(pci, severity, msgid, msg);
  }

  // setEncoder(encoder) {
  //   if (encoder instanceof nodefony.Encoder) {
  //     return (this.encoder = encoder);
  //   }
  //   throw new Error(
  //     `setEncoder : Entity ${this.name} encoder must be an instance of nodefony.Encoder`
  //   );
  // }

  // getEncoder() {
  //   return this.encoder;
  // }

  // hasEncoder() {
  //   if (this.encoder instanceof nodefony.Encoder) {
  //     return true;
  //   }
  //   if (this.encoder === null) {
  //     return false;
  //   }
  //   throw new Error(
  //     `setEncoder : Entity ${this.name} encoder must be an instance of nodefony.Encoder`
  //   );
  // }

  // async encode(value) {
  //   if (this.hasEncoder()) {
  //     return await this.encoder.encodePassword.apply(this.encoder, arguments);
  //   }
  //   return value;
  // }
}

export default Entity;

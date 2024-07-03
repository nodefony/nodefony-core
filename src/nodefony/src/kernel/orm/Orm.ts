/* eslint-disable @typescript-eslint/no-explicit-any */
import Service, { DefaultOptionsService } from "../../Service";
import Module from "../Module";
import Container from "../../Container";
import Event from "../../Event";
import Entity from "./Entity";
import Connector from "./Connector";

class Orm extends Service {
  entities: Record<string, Entity> = {};
  connections: Record<string, Connector | any> = {};
  ready: boolean = false;
  debug: boolean = false;
  connectionNotification: number = 0;
  constructor(name: string, module: Module, options: DefaultOptionsService) {
    super(
      name,
      module.container as Container,
      module.notificationsCenter as Event,
      options
    );
  }
  boot() {
    this.on("onConnect", async (connection) => this.ormReady(connection));
    this.on("onErrorConnection", async (connection, error) =>
      this.ormReady(connection, error)
    );
  }

  ormReady(_connection: Connector, error?: Error) {
    return new Promise((resolve, reject) => {
      const nbConnectors = Object.keys(this.options.connectors).length;
      this.connectionNotification++;
      if (error) {
        this.log(error, "ERROR");
        return reject(error);
      }
      if (nbConnectors === this.connectionNotification) {
        process.nextTick(
          async () =>
            await this.emitAsync("onOrmReady", this)
              .then(() => {
                if (this.kernel?.type !== "CONSOLE") {
                  this.log("onOrmReady", "INFO", `EVENTS ${this.name} ORM`);
                }
                this.connectionNotification = 0;
                this.ready = true;
              })
              .catch((e) => {
                this.log(e, "ERROR");
                return reject(e);
              })
        );
      }
      return resolve(this);
    });
  }
  setEntity(entity: Entity) {
    if (!entity) {
      throw new Error(`${this.name} setEntity : entity  is null `);
    }
    if (!(entity instanceof Entity)) {
      throw new Error(
        `${this.name} setEntity  : not instance of nodefony.Entity`
      );
    }
    if (this.entities[entity.name]) {
      throw new Error(
        `${this.name} setEntity  : Entity Already exist ${entity.name}`
      );
    }
    if (!entity.model) {
      throw new Error(
        `${this.name} setEntity  : Module : ${entity.module.name} Model is undefined in Entity : ${entity.name}`
      );
    }
    this.entities[entity.name] = entity;
    if (this.kernel?.type === "SERVER") {
      this.log(`ENTITY ADD : ${entity.name}`, "INFO");
    }
  }

  async createConnection(name: string, config: any): Promise<any> {
    console.log("createConnection", name, config);
  }
}

export default Orm;

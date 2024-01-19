import Kernel from "./Kernel";
import Event from "../Event";
import Service, { DefaultOptionsService } from "../Service";
import Container from "../Container";

class Module extends Service {
  constructor(name: string, kernel: Kernel, options: DefaultOptionsService) {
    const container: Container = kernel.container as Container;
    const event: Event = kernel.notificationsCenter as Event;
    super(name, container, event, options);
    this.log(`Registre Modefony Module `);
    this.setParameters(`modules.${this.name}`, this.options);
    this.on("onBoot", async () => {
      return await this.onBoot();
    });
    this.on("onStart", async () => {
      return await this.onStart();
    });
    this.on("onReady", async () => {
      return await this.onReady();
    });
  }

  async onBoot(): Promise<this> {
    this.log(`BOOT`, "DEBUG");
    return Promise.resolve(this);
  }

  async onStart(): Promise<this> {
    this.log(`START`, "DEBUG");
    return Promise.resolve(this);
  }

  async onReady(): Promise<this> {
    this.log(`READY`, "DEBUG");
    return Promise.resolve(this);
  }
}

export default Module;

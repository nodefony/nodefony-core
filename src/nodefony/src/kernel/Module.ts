import Kernel, { InjectionType } from "./Kernel";
import Event from "../Event";
import Service, { DefaultOptionsService } from "../Service";
import Container from "../Container";

class Module extends Service {
  constructor(name: string, kernel: Kernel, options: DefaultOptionsService) {
    const container: Container = kernel.container as Container;
    const event: Event = kernel.notificationsCenter as Event;
    super(name, container, event, options);
    this.log(`Registre Modefony Module : ${this.name}`, "INFO");
    this.setParameters(`modules.${this.name}`, this.options);
    this.on("onStart", async () => {
      if (this.onStart) {
        return await this.onStart();
      }
    });
    this.on("onBoot", async () => {
      if (this.onBoot) {
        return await this.onBoot();
      }
    });
    this.on("onReady", async () => {
      if (this.onReady) {
        return await this.onReady();
      }
    });
  }

  addService(
    service: typeof InjectionType,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ): Service {
    const inst = new service(this, ...args);
    this.set(inst.name, inst);
    // this.on("onStart", async () => {
    //   return await inst.onStart();
    // });
    // this.on("onBoot", async () => {
    //   return await inst.onBoot();
    // });
    // this.on("onReady", async () => {
    //   return await inst.onReady();
    // });
    return this.get(inst.name);
  }

  async onStart(): Promise<this> {
    this.log(`MODULE ${this.name} START`, "DEBUG");
    return Promise.resolve(this);
  }

  async onBoot(): Promise<this> {
    this.log(`MODULE ${this.name} BOOT`, "DEBUG");
    return Promise.resolve(this);
  }

  async onReady(): Promise<this> {
    this.log(`MODULE ${this.name} READY`, "DEBUG");
    return Promise.resolve(this);
  }
}

export default Module;

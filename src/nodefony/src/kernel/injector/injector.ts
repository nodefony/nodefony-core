import Service from "../../Service";
import Container from "../../Container";
import Event from "../../Event";
import Kernel, { ServiceConstructor, ServiceWithInitialize } from "../Kernel";
import { Nodefony } from "../../Nodefony";
import Fetch from "../../service/fetchService";

const injectables: Record<string, ServiceConstructor> = {};

class Injector extends Service {
  static injectables: Record<string, ServiceConstructor> = injectables;
  constructor(kernel: Kernel) {
    super(
      "injector",
      kernel.container as Container,
      kernel.notificationsCenter as Event
    );
    Injector.register("Fetch", Fetch);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static register(serviceName: string, service: ServiceConstructor) {
    if (!serviceName || !service) {
      throw new Error(`Injector register  bad argument`);
    }
    return (injectables[serviceName] = service);
  }

  static get(serviceName: string): ServiceConstructor {
    const service = injectables[serviceName];
    if (!service) {
      throw new Error(`Service ${serviceName} not found or not injectable`);
    }
    return service;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static inject(service: ServiceConstructor, ...args: any[]) {
    return Injector.instantiate(service, ...args);
  }

  instantiate(
    constructor: ServiceConstructor,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ) {
    return Injector.instantiate(constructor, ...args);
  }

  static instantiate(
    constructor: ServiceConstructor,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...argsClass: any[]
  ): Service | ServiceWithInitialize {
    const injectInfo = Reflect.getMetadata("inject:services", constructor);
    if (injectInfo) {
      const args = [...argsClass];
      for (let i = 0; i < injectInfo.length; i++) {
        const serviceName = injectInfo[i];
        if (!serviceName) {
          continue;
        }
        let instance;
        if (Nodefony.kernel && Nodefony.kernel.get(serviceName)) {
          instance = Nodefony.kernel.get(serviceName);
        } else {
          instance = Injector.instantiate(
            Injector.get(serviceName),
            ...argsClass
          );
        }
        args.push(instance);
      }
      return Reflect.construct(constructor, args); //new constructor(...args);
    } else {
      return Reflect.construct(constructor, argsClass); //new constructor(...argsClass);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reflect(constructor: ServiceConstructor, ...args: any[]) {
    try {
      return Reflect.construct(constructor, args);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      this.log(`ERRROR SERVICE CLASS ${this.name} ${e.message}`, "ERROR");
      throw e;
    }
  }
}

export default Injector;

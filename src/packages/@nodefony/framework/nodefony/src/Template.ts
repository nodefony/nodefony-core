import { Service, Module, Container, Event } from "nodefony";
class Template extends Service {
  engine: unknown;
  module: Module;
  cache: boolean = true;
  constructor(
    name: string,
    engine: any,
    module: Module,
    options: Record<string, any> = {}
  ) {
    super(
      name,
      module.container as Container,
      module.notificationsCenter as Event,
      options
    );
    this.engine = engine;
    this.module = module;
    this.cache =
      module.kernel?.environment === "prod" ||
      module.kernel?.environment === "production";
  }
}

export default Template;

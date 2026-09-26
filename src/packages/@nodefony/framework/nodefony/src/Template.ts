import { Service, Module, Container } from "nodefony";
class Template extends Service {
  engine: unknown;
  module: Module;
  cache: boolean = true;
  constructor(
    name: string,
    engine: unknown,
    module: Module,
    options: Record<string, unknown> = {},
  ) {
    super(
      name,
      module.container as Container,
      module.notificationsCenter,
      options,
    );
    this.engine = engine;
    this.module = module;
    this.cache =
      module.kernel?.environment === "prod" ||
      module.kernel?.environment === "production";
  }
}

export default Template;

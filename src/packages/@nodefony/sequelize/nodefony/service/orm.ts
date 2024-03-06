import { Service, Module, Container, Event } from "nodefony";
import sequelize from "sequelize";

const serviceName: string = "sequelize";

class Sequelize extends Service {
  static engine: typeof sequelize = sequelize;
  constructor(module: Module) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options
    );
  }
}

export default Sequelize;
export { sequelize };

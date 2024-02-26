import { Service, Module, Container, Event } from "nodefony";

const serviceName: string = "sequelize";

class Sequelize extends Service {
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

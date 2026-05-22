import { Kernel, Module, services, entities } from "nodefony";
import config from "./nodefony/config/config";
// Service orm-core bootable — connecte les SequelizeOrm enregistrés dans OrmRegistry.
import SequelizeService from "./nodefony/service/SequelizeService";

import * as sequelize from "sequelize";
import SessionStorage from "./nodefony/src/SessionStorage";

@services([SequelizeService])
class Sequelize extends Module {
  constructor(kernel: Kernel) {
    super("sequelize", kernel, import.meta.url, config);
  }
}

export default Sequelize;
export { sequelize, entities, SessionStorage, SequelizeService };

// Adapter orm-core (P5.4).
export {
  SequelizeOrm,
  SequelizeRepository,
  SequelizeTransaction,
} from "./nodefony/src/orm-core/index";

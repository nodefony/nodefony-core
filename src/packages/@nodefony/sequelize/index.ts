import { Entity, Kernel, Module, services, entities } from "nodefony";
import config from "./nodefony/config/config";
import orm from "./nodefony/service/orm";
//import { sequelize } from "./nodefony/service/orm";
// Entité session legacy retirée : les sessions sont gérées par @nodefony/drizzle.
// Sequelize reste chargé pour les tests multi-ORM (adapter orm-core), pas la session.
import Command from "./nodefony/command/sync";
import { Models } from "./nodefony/service/orm";
// import sequelize, {
//   Model,
//   ConnectionOptions,
//   Transaction,
//   Options,
//   Sequelize as NativeSequelize,
//   ModelStatic,
// } from "sequelize";

import * as sequelize from "sequelize";
import SessionStorage from "./nodefony/src/SessionStorage";

@services([orm])
class Sequelize extends Module {
  constructor(kernel: Kernel) {
    super("sequelize", kernel, import.meta.url, config);
    this.addCommand(Command);
  }
}

export default Sequelize;
export { sequelize, entities, Models, SessionStorage };

// Adapter orm-core (P5.4) — distinct du service legacy.
export {
  SequelizeOrm,
  SequelizeRepository,
  SequelizeTransaction,
} from "./nodefony/src/orm-core/index";

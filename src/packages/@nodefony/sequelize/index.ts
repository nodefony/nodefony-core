import { Entity, Kernel, Module, services, entities } from "nodefony";
import config from "./nodefony/config/config";
import orm from "./nodefony/service/orm";
//import { sequelize } from "./nodefony/service/orm";
import Session from "./nodefony/entity/sessionEntity";
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
@entities([Session])
class Sequelize extends Module {
  constructor(kernel: Kernel) {
    super("sequelize", kernel, import.meta.url, config);
    this.addCommand(Command);
  }
}

export default Sequelize;
export { sequelize, entities, Models, SessionStorage };

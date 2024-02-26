import { Service, Kernel, Module, services } from "nodefony";
import config from "./nodefony/config/config";
import orm from "./nodefony/service/orm";

@services([orm])
class Sequelize extends Module {
  constructor(kernel: Kernel) {
    super("sequelize", kernel, import.meta.url, config);
  }
}

export default Sequelize;

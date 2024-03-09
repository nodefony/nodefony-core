import { Kernel, Module, services, entities } from "nodefony";
import config from "./nodefony/config/config";
import orm from "./nodefony/service/orm";

import * as mongoose from "mongoose";
import sessionEntity, {
  ISession,
  SessionModel,
} from "./nodefony/entity/sessionEntity";
import mongooseStorage from "./nodefony/src/mongooseStorage";

@services([orm])
@entities([sessionEntity])
class Mongoose extends Module {
  constructor(kernel: Kernel) {
    super("mongoose", kernel, import.meta.url, config);
  }
}

export default Mongoose;
export { mongoose, mongooseStorage, ISession, SessionModel };

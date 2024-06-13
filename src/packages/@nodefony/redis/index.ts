import { Kernel, Module, services } from "nodefony";
import * as redis from "redis";
import RedisService from "./nodefony/service/redis";
import config from "./nodefony/config/config";

@services([RedisService])
class Redis extends Module {
  constructor(kernel: Kernel) {
    super("redis", kernel, import.meta.url, config);
  }
}

export default Redis;
export { RedisService, redis };

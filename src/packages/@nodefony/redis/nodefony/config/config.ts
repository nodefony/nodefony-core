import path from "node:path";
import nodefony, { Kernel } from "nodefony";

export default {
  watch: true,
  debug: true,
  redis: {
    globalOptions: {
      socket: {
        host: "localhost",
        port: 6379,
        family: "IPv4",
      },
    },
    connections: {
      main: {
        name: "main",
        host: "cci-vm",
        port: 6379,
        //db          : null,
        prefix: null,
      },
      publish: {
        name: "publish",
        host: "cci-vm",
        port: 6379,
        //db          : "",
        prefix: "",
      },
      subscribe: {
        name: "subscribe",
        host: "cci-vm",
        port: 6379,
        //db          : "",
        prefix: "",
      },
    },
  },
};

import {
  Service,
  Container,
  Event,
  extend,
  Severity,
  Msgid,
  Message,
} from "nodefony";
import redisService from "../service/redis";
import {
  RedisClientOptions,
  RedisClientType,
  createClient,
  RedisModules,
} from "redis";

export default class Connection extends Service {
  client: RedisClientType | null = null;
  service: redisService;
  connected: boolean = false;
  //override options: RedisClientOptions ={}
  constructor(
    name: string,
    options: Record<string, any>,
    redisService: redisService
  ) {
    super(
      name,
      redisService.container as Container,
      redisService.notificationsCenter as Event,
      options
    );
    this.service = redisService;
  }
  log(pci: any, severity?: Severity, msgid?: Msgid, msg?: Message) {
    if (!msgid) {
      // eslint-disable-next-line no-param-reassign
      msgid = `\x1b[36mREDIS CONNECTION ${this.name} \x1b[0m`;
    }
    return super.log(pci, severity, msgid, msg);
  }

  create(): Promise<RedisClientType> {
    return new Promise(async (resolve, reject) => {
      try {
        this.client = createClient(
          this.options as RedisClientOptions<Record<string, never>>
        ) as RedisClientType;
        if (!this.client) {
          throw new Error("Redis client is not defined");
        }

        this.client.on("error", (error: Error) => {
          this.log(error, "ERROR");
          this.fire("onError", error, this);
        });
        this.client.on("warning", (warning: Error) => {
          this.log(warning, "WARNING");
          this.fire("onWarning", warning, this);
        });
        this.client.on("end", () => {
          this.connected = false;
          this.log(
            `END CONNECT   ${this.options.socket.host} : ${this.options.socket.port} `,
            "INFO"
          );
          this.fire("onEnd", this);
        });
        this.client.on("ready", () => {
          this.fire("onReady", this);
        });
        this.client.on("connect", () => {
          this.connected = true;
          this.log(
            `CONNECT  ${this.options.socket.host} : ${this.options.socket.port} `,
            "INFO"
          );
          this.displayTable();
          this.fire("onConnect", this);
        });
        this.client.on("reconnecting", () => {
          this.fire("onReady", this);
          this.log(
            `RECONNECTING  ${this.options.socket.host} : ${this.options.socket.port} `,
            "INFO"
          );
          this.fire("onReconnecting", this);
        });
        // this.client.on("subscribe", (channel: string, count: number) => {
        //   this.log(
        //     `SUBSCRIBE  ${this.options.socket.host}:${this.options.socket.port} channel : ${channel} `,
        //     "INFO"
        //   );
        //   this.fire("onSubscribe", channel, count, this);
        // });
        // this.client.on("unsubscribe", (channel: string, count: number) => {
        //   this.log(
        //     `UNSUBSCRIBE  ${this.options.socket.host}:${this.options.socket.port} channel : ${channel} `,
        //     "INFO"
        //   );
        //   this.fire("onUnsubscribe", channel, count, this);
        // });
        // this.client.on("psubscribe", (pattern: string, count: number) => {
        //   this.log(
        //     `PSUBSCRIBE  ${this.options.socket.host}:${this.options.socket.port} pattern : ${pattern} `,
        //     "INFO"
        //   );
        //   this.fire("onPsubscribe", pattern, count, this);
        // });
        // this.client.on("punsubscribe", (pattern: string, count: number) => {
        //   this.log(
        //     `PUNSUBSCRIBE  ${this.options.socket.host}:${this.options.socket.port} pattern : ${pattern} `,
        //     "INFO"
        //   );
        //   this.fire("onPunsubscribe", pattern, count, this);
        // });
        // this.client.on("message", (channel: string, message: string) => {
        //   this.log(
        //     `MESSAGE  ${this.options.socket.host}:${this.options.socket.port} channel : ${channel} `,
        //     "DEBUG"
        //   );
        //   this.log(message, "DEBUG");
        //   this.fire("onMessage", channel, message, this);
        // });
        // this.client.on("message_buffer", (channel: string, message: string) => {
        //   this.log(
        //     `MESSAGE BUFFER  ${this.options.socket.host}:${this.options.socket.port} channel : ${channel} `,
        //     "DEBUG"
        //   );
        //   this.log(message, "DEBUG");
        //   this.fire("onMessage_buffer", channel, message, this);
        // });
        // this.client.on(
        //   "pmessage",
        //   (pattern: string, channel: string, message: string) => {
        //     this.log(
        //       `PMESSAGE  ${this.options.socket.host}:${this.options.socket.port} pattern : ${pattern} channel : ${channel} `,
        //       "DEBUG"
        //     );
        //     this.log(message, "DEBUG");
        //     this.fire("onPmessage", pattern, channel, message, this);
        //   }
        // );
        // this.client.on(
        //   "pmessage_buffer",
        //   (pattern: string, channel: string, message: string) => {
        //     this.log(
        //       `PMESSAGE BUFFER  ${this.options.socket.host}:${this.options.socket.port} pattern : ${pattern} channel : ${channel} `,
        //       "DEBUG"
        //     );
        //     this.log(message, "DEBUG");
        //     this.fire("onPmessage_buffer", pattern, channel, message, this);
        //   }
        // );
        await this.client.connect();
        if (this.options.password) {
          if (this.options.username) {
            await this.client.auth({
              username: this.options.username,
              password: this.options.password,
            });
          } else {
            await this.client.auth({
              password: this.options.password,
            });
          }
          this.log(
            `AUTHENTICATED READY ${this.options.socket.host} : ${this.options.socket.port} `,
            "INFO"
          );
        }

        return resolve(this.client);
      } catch (e) {
        console.trace(e);
        return reject(e);
      }
    });
  }

  async close() {
    if (this.client) {
      await this.client.quit();
      this.log("REDIS client close");
    }
  }

  displayTable(severity: Severity = "DEBUG") {
    const options = {
      head: [
        `${this.name.toUpperCase()} CONNECTIONS NAME`,
        "HOSTS",
        "CONNECTED",
      ],
    };
    try {
      const table = this.kernel?.cli?.displayTable([], options);
      if (table && this.client) {
        const data = [];
        data.push(this.name || "");
        let ele: string = this.client.options?.socket?.host || "";
        data.push(ele);
        data.push(this.connected || "");
        table.push(data);
        this.log(` ${this.name} : \n${table.toString()}`, severity);
      }
    } catch (e) {
      throw e;
    }
  }
}

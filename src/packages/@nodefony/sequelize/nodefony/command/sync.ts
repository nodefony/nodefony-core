import {
  OptionsCommandInterface,
  CliKernel,
  Command,
  Connector,
} from "nodefony";
import service, { ConnectorSequelise, sequelize } from "../service/orm";

const options: OptionsCommandInterface = {
  showBanner: true,
  kernelEvent: "onReady",
};

class SequelizeCommand extends Command {
  service: service | null = null;
  constructor(cli: CliKernel) {
    super("sequelize", "Orm sequelize   ", cli, options);
    this.addArgument("[sync]", "Synchronize Entities ");
    this.addArgument("[migrate]", "migration ");
    this.addOption("-f, --force ", "drop entities before for sync only");
    this.addOption("-a, --alter", "try alter entities for sync only");
  }

  override async onKernelBoot(): Promise<void> {
    this.service = this.get("sequelize");
  }

  override async generate(
    arg: string,
    name: string,
    options: { force?: boolean; alter?: boolean }
  ): Promise<this> {
    try {
      switch (arg) {
        case "sync":
          await this.syncConnectors(name, options);
          console.log("psasa");
          return this;
      }
      return this;
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }

  async syncConnectors(
    name: string,
    options: { force?: boolean; alter?: boolean }
  ): Promise<this> {
    return new Promise(async (resolve, reject) => {
      const tab: any[] = [];
      //this.service?.once("onOrmReady", async () => {
      for (const connectorName in this.service?.connections) {
        const connector: ConnectorSequelise =
          this.service?.connections[connectorName];
        if (connector && connector.state === "CONNECTED") {
          const res = await this.sync(connector, options).catch((e) => {
            return reject(e);
          });

          tab.push(res);
          this.log(
            `DATABASE  : ${connector.type} CONNECTION : ${connectorName}`,
            "INFO"
          );
        }
      }
      return resolve(this);
      //});
    });
  }

  async sync(
    connector: ConnectorSequelise,
    options: { force?: boolean; alter?: boolean }
  ) {
    const { force, alter } = options;
    return connector.db
      ?.sync({
        force,
        alter,
        logging: (value: string) => this.log(value, "INFO"),
        hooks: true,
      })
      .then((db) => {
        this.log(
          `DATABASE :${db.config.database} CONNECTION : ${connector.name}`,
          "INFO",
          "SYNC SEQUELIZE"
        );
        return db;
      })
      .catch((error: Error) => {
        this.log(
          `DATABASE :${connector.db?.config.database} CONNECTION : ${connector.name} : ${error}`,
          "ERROR"
        );
        throw error;
      });
  }
}

export default SequelizeCommand;

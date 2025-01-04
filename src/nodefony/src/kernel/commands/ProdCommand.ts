/* eslint-disable @typescript-eslint/ban-ts-comment */
import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import Kernel from "../Kernel";
import pm2 from "pm2";
import pm2Service from "../../service/pm2Service";

const options: OptionsCommandInterface = {
  showBanner: true,
  kernelEvent: "onPostReady",
};

class Prod extends Command {
  service?: pm2Service | null;
  constructor(cli: CliKernel) {
    super(
      "production",
      "Start Server in Production Mode (PM2 process manager)",
      cli as CliKernel,
      options
    );
    this.alias("prod");
    this.addOption(
      "--no-daemon",
      "Nodefony Deamon off for production mode (usefull for docker)"
    );
    // this.addOption(
    //   "--no-dump",
    //   "Nodefony Start don't run Webpack Production Mode"
    // );
  }

  override async onKernelStart(): Promise<void> {
    (this.cli as CliKernel).setType("SERVER");
    this.cli.environment = "production";
    this.service = this.get<pm2Service>("pm2");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  override async generate(options: any): Promise<void | Kernel> {
    try {
      if (process.env.MODE_START && process.env.MODE_START === "PM2") {
        // is pm2
        return this.kernel as Kernel;
      } else {
        if (!this.service) {
          throw new Error(`Service PM2 nor found `);
        }
        await this.service
          .pm2Start()
          .then(async () => {
            if (options.daemon) {
              this.cli.log(`DAEMONIZE Process
                      --no-daemon  if don't want DAEMONIZE  (Usefull for docker)
              `);
              await this.showStatus();
              pm2.disconnect();
              return await this.cli.terminate(0);
            }
            this.log("NO DAEMONIZE");
            await this.showStatus();
            return this.kernel as Kernel;
          })
          .catch(async (e) => {
            this.log(e, "ERROR");
            console.trace(e);
            pm2.disconnect();
            return await this.cli.terminate(1);
          });
      }
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }

  showStatus(): Promise<void> {
    return new Promise((resolve, reject) => {
      process.nextTick(async () => {
        try {
          await pm2Service.tablePm2Process(null, this.cli);
          this.log(`

PM2 Process Manager 2 :
   stop [name]                                             Stop Production Project
   reload [name]                                           Reload Production Project
   delete [name]                                           Delete Production Project from PM2 management
   restart [name]                                          Restart Production Project
   list                                                    List all Production Projects
   kill                                                    Kill PM2 daemon
   logs [name] [nblines]                                   Stream pm2 logs  [name] is project name  and [nblines] to show
   clean-log                                               Remove logs
   pm2-logrotate                                           install pm2 logrotate
   pm2-save                                                save pm2 deamon status, It will save the process list with the corresponding environments into the dump file
   pm2-startup                                             Detect available init system, generate configuration and enable startup system
   pm2-unstartup                                           Disabling startup system

Examples :

$ nodefony logs
$ nodefony reload <myproject>
$ nodedony pm2-logrotate
$ nodedony pm2-save

Examples with pm2 native tools :

$ npx pm2 monit
$ npx pm2 --lines 1000 logs
                    `);
          return resolve();
        } catch (e) {
          return reject(e);
        }
      });
    });
  }
}
export default Prod;

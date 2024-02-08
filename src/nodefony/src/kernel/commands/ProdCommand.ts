/* eslint-disable @typescript-eslint/ban-ts-comment */
import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import Cli from "../../Cli";
import Kernel from "../Kernel";
import pm2, { StartOptions, ProcessDescription } from "pm2";
import path from "path";
import clc from "cli-color";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onPostReady",
};

class Prod extends Command {
  constructor(cli: CliKernel) {
    super(
      "production",
      "Start Server in Production Mode",
      cli as CliKernel,
      options
    );
    this.alias("prod");
    this.alias("pm2");
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
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  override async generate(options: any): Promise<void | Kernel> {
    try {
      if (process.env.MODE_START && process.env.MODE_START === "PM2") {
        // is pm2
        return this.kernel as Kernel;
      } else {
        return await this.pm2Start()
          .then(async () => {
            if (options.daemon) {
              this.cli.log(`DAEMONIZE Process
                      --no-daemon  if don't want DAEMONIZE  (Usefull for docker)
              `);
              await this.showBannerPM2();
              pm2.disconnect();
              return await this.cli.terminate(0);
            }
            this.log("NO DAEMONIZE");
            await this.showBannerPM2();
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

  pm2Start(): Promise<void> {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
      try {
        const config = await this.getPm2Config();
        //console.log(config);
        if (!config.name) {
          config.name = this.kernel?.projectName;
        }

        return pm2.connect((err: Error) => {
          if (err) {
            this.log(err, "ERROR");
            return reject(err);
          }
          return pm2.start(config, (err: Error) => {
            if (err) {
              this.log(err, "ERROR");
              return reject(err);
            }
            this.cli.log("PM2 started");
            resolve();
          });
        });
      } catch (e) {
        return reject(e);
      }
    });
  }

  async getPm2Config(): Promise<StartOptions> {
    if (this.kernel?.pm2Config) {
      return this.kernel?.pm2Config;
    }
    const cli = this.cli as CliKernel;
    try {
      const result = await cli.loadLocalModule(
        path.resolve("nodedony", "config", "pm2", "pm2.config.js")
      );
      return result?.default as StartOptions;
    } catch (e) {
      this.log(`No PM2 config found `, "WARNING");
      return {
        script: process.argv[1] || "nodefony",
        args: "pm2",
        env: {
          NODE_ENV: "production",
          MODE_START: "PM2",
        },
      };
    }
  }

  showBannerPM2(): Promise<void> {
    return new Promise((resolve, reject) => {
      process.nextTick(async () => {
        try {
          pm2.list((err, processDescriptionList) => {
            this.log("LIST PROCESS PM2");
            if (err) {
              this.log(err, "WARNING");
            }
            Prod.tablePm2Process(processDescriptionList, this.cli);
            pm2.dump((err, result) => {
              if (err) {
                this.log(err, "WARNING");
              }
              this.log("PM2 SAVING process");
              if (result.success) {
                this.log(`${process.platform} PM2 process saved `);
              }
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
            });
          });
        } catch (e) {
          return reject(e);
        }
      });
    });
  }

  static tablePm2Process(apps: ProcessDescription[], cli: Cli) {
    // console.log(apps)
    let table = null;
    table = cli.displayTable([], {
      head: [
        clc.blue("App name"),
        clc.blue("id"),
        clc.blue("mode"),
        clc.blue("pid"),
        clc.blue("status"),
        clc.blue("restart"),
        clc.blue("uptime"),
        clc.blue("cpu"),
        clc.blue("memory"),
        clc.blue("username"),
        clc.blue("watching"),
      ],
      // colWidths: [30, 15, 20, 15]
    });
    apps.forEach((ele) => {
      // console.log(ele.pm2_env)
      let cpu = "-";
      let memory = "-";
      if (ele.monit) {
        cpu = `${ele.monit.cpu}%`;
        memory = Cli.niceBytes(ele.monit.memory as number);
      }
      let exec_mode = "-";
      //@ts-ignore
      if (ele.pm2_env?.exec_mode) {
        //@ts-ignore
        exec_mode = ele.pm2_env.exec_mode;
      }
      let status = "-";
      if (ele.pm2_env?.status) {
        status = ele.pm2_env?.status;
      }
      if (ele.pm2_env?.status) {
        status = ele.pm2_env.status;
      }
      let uptime = "-";
      if (ele.pm2_env?.pm_uptime) {
        uptime = Cli.niceUptime(ele.pm2_env?.pm_uptime);
      }
      let restart: string | number = "-";
      if (ele.pm2_env?.restart_time || ele.pm2_env?.restart_time === 0) {
        restart = ele.pm2_env.restart_time;
      }
      let username = "-";
      //@ts-ignore
      if (ele.pm2_env?.username) {
        //@ts-ignore
        username = ele.pm2_env.username;
      }
      let watch = "-";
      //@ts-ignore
      if (ele.pm2_env?.watch || ele.pm2_env?.watch === false) {
        //@ts-ignore
        watch = ele.pm2_env?.watch;
      }
      let pid: string | number = "-";
      if (ele.pid) {
        pid = ele.pid;
      }
      table.push([
        ele.name,
        ele.pm_id,
        exec_mode,
        pid,
        status,
        restart,
        uptime,
        cpu,
        memory,
        username,
        watch,
      ]);
    });
    console.log(table.toString());
  }
}

export default Prod;

/* eslint-disable no-async-promise-executor */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import { extend } from "../Tools";
import Module from "../kernel/Module";
import Cli from "../Cli";
import Event from "../Event";
import Container from "../Container";
import Service from "../Service";
import clc from "cli-color";
import { exec as execCb } from "child_process";
import { promisify } from "util";
const exec = promisify(execCb);

import pm2, { StartOptions, ProcessDescription } from "pm2";

const defaulOptions: StartOptions = {
  script: process.argv[1] || "nodefony",
  args: "production",
  env: {
    NODE_ENV: "production",
    MODE_START: "PM2",
  },
};

class Pm2 extends Service {
  pm2: typeof pm2 = pm2;
  constructor(module: Module, options?: StartOptions) {
    options = extend({}, defaulOptions, options || {});
    super(
      "pm2",
      module.container as Container,
      module.notificationsCenter as Event,
      options as StartOptions
    );
  }

  disconnect(): void {
    return pm2.disconnect();
  }

  async pm2Start(): Promise<void> {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
      try {
        if (!this.options.name) {
          this.options.name = this.kernel?.projectName;
        }
        return pm2.connect((err: Error) => {
          if (err) {
            this.log(err, "ERROR");
            return reject(err);
          }
          return pm2.start(this.options as StartOptions, async (err: Error) => {
            if (err) {
              this.log(err, "ERROR");
              return reject(err);
            }
            this.log("PM2 started");
            await this.dump();
            resolve();
          });
        });
      } catch (e) {
        return reject(e);
      }
    });
  }

  kill(): Promise<this> {
    return Promise.resolve(this);
  }

  async killExec(): Promise<{ stdout: string; stderr: string }> {
    const { stdout, stderr } = await exec("npx pm2 kill");
    if (stderr) {
      this.log(`Kill PM2 MANAGER ${stderr}`, "WARNING");
    } else {
      this.log(`Kill PM2 MANAGER success ${stdout}`);
    }
    return { stdout, stderr };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async dump(): Promise<any> {
    return new Promise((resolve, reject) => {
      return pm2.dump((err, result) => {
        if (err) {
          this.log(err, "WARNING");
          return reject(err);
        }
        this.log("PM2 SAVING process");
        if (result.success) {
          this.log(`${process.platform} PM2 process saved `);
          return resolve(result);
        }
      });
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async flush(name: string | number = "all"): Promise<ProcessDescription[]> {
    return new Promise((resolve, reject) => {
      return pm2.flush(name, (error, result: ProcessDescription[]) => {
        if (error) {
          this.log(error, "ERROR");
          return reject(error);
        }
        return resolve(result);
      });
    });
  }

  static async list(): Promise<ProcessDescription[]> {
    return new Promise((resolve, reject) => {
      pm2.list((err: Error, processDescriptionList: ProcessDescription[]) => {
        if (err) {
          return reject(err);
        }
        return resolve(processDescriptionList);
      });
    });
  }

  static async tablePm2Process(
    processDescriptionList: ProcessDescription[] | null | undefined,
    cli: Cli,
    disconnect: boolean = false
  ): Promise<string> {
    return new Promise(async (resolve, reject) => {
      if (!processDescriptionList) {
        processDescriptionList = await Pm2.list();
      }
      try {
        const table = cli.displayTable([], {
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
        processDescriptionList.forEach((ele) => {
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
        const str = table.toString();
        cli.log(`
${str}`);
        if (disconnect) {
          pm2.disconnect();
        }
        return resolve(str);
      } catch (e) {
        return reject(e);
      }
    });
  }
}

export default Pm2;

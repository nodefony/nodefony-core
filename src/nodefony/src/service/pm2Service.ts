/* eslint-disable @typescript-eslint/ban-ts-comment */
import Module from "../kernel/Module";
import Cli from "../Cli";
import Event from "../Event";
import Container from "../Container";
import Service from "../Service";
import clc from "cli-color";

import pm2, { StartOptions, ProcessDescription } from "pm2";

class Pm2 extends Service {
  pm2: typeof pm2 = pm2;
  constructor(module: Module, options?: StartOptions) {
    super(
      "pm2",
      module.container as Container,
      module.notificationsCenter as Event,
      options as StartOptions
    );
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

  static async tablePm2Process(cli: Cli): Promise<string> {
    return new Promise((resolve, reject) => {
      pm2.list((err: Error, processDescriptionList: ProcessDescription[]) => {
        if (err) {
          return reject(err);
        }
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
        return resolve(str);
      });
    });
  }
}

export default Pm2;

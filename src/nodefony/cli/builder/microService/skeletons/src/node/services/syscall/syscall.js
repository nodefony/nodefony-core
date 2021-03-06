const nodefony = require("nodefony");
const spawn = require('child_process').spawn;
const path = require("path");

//const color = nodefony.Service.getCliColor();
//const red = color.red.bold;
//const blue = color.blueBright.bold;
//const green = color.green;
//const cyan = color.cyan.bold;
//const yellow = color.yellow.bold;

const defaultOption = {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  NODE_ENV: process.env.NODE_ENV
};

class Syscall extends nodefony.Service {

  constructor(service){
    super("syscall", service.container);
    this.service = service ;
    this.settings = this.service.settings.syscall ;
    this.log("Running");
  }

  start(){
    return new Promise (async (resolve, reject)=>{
      try{
        let codeP = await this.python();
        let codeB = await this.bash();
        return resolve({
          python:codeP,
          bash:codeB
        }) ;
      }catch(e){
        return reject(e);
      }
    });
  }

  async python(){
    return await this.spawn(path.resolve("bin", "hello.py"));
  }

  async bash(){
    return await this.spawn(path.resolve("bin", "hello.sh"));
  }

  spawn(command, args=[], options = defaultOption, close=false){
    return new Promise((resolve, reject)=>{
      let cmd = null;
      try {
        if (options.NODE_ENV) {
          options.env.NODE_ENV = options.NODE_ENV;
          delete options.NODE_ENV;
        }
        this.log(`Spawn : ${command} ${args.join(" ")}`, "INFO");
        cmd = spawn(command, args, options || {});
        if (cmd.stdout) {
          cmd.stdout.on('data', (data) => {
            let str = data.toString();
            if (str) {
              if (this.service.debug) {
                this.log(`${command} :\n`, "INFO", "STDOUT");
              }
              this.stdout.write(str);
            }
          });
        }
        if (cmd.stderr) {
          cmd.stderr.on('data', (data) => {
            let str = data.toString();
            if (str) {
              if (this.service.debug) {
                this.log(`${command} :\n`, "INFO", "STDERR");
              }
              process.stdout.write(str);
            }
          });
        }
        cmd.on('close', (code) => {
          if (this.service.debug) {
            this.log(`Child Process exited with code ${code}`, "DEBUG");
          }
          if (close) {
            close(code);
          }
          if (code !== 0) {
            this.log(`Spawn : ${command} ${args.join(" ")} Error Code : ${code}`, "ERROR");
          }
          return resolve(code);
        });
        cmd.on('error', (err) => {
          this.log(err, "ERROR");
          return reject(err);
        });
        if (cmd.stdin) {
          process.stdin.pipe(cmd.stdin);
        }
      } catch (e) {
        this.log(e, "ERROR");
        return reject(e);
      }
    });
  }

}

module.exports = Syscall ;

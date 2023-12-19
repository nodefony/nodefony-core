import Syslog from "./syslog/Syslog"
import nodefony from "./Nodefony"
import Service from './Service'

enum  environment {
  "dev",
  "development",
  "prod",
  "production",
  "stage"
}

enum type{
  "cli",
  "server"
}
type DebugType = boolean | string | string[]
type environmentType = keyof typeof environment
type typeType = keyof typeof type

class Kernel extends Service{
  type: typeType = "server"
  console: boolean = this.isCli()
  environment: environmentType = "production"
  debug : DebugType = false

  constructor(){
    super("KERNEL")
  }
  isCli() {
    return this.type === "cli";
  }

}



export default Kernel
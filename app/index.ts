import { Kernel, Module } from "nodefony";
import http from "@nodefony/http";
import security from "@nodefony/security";
import config from "./src/nodefony/config/config";

class App extends Module {
  constructor(kernel: Kernel) {
    super("app", kernel, config);
    kernel.use(http);
    kernel.use(security);
  }
}

export default App;

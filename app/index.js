import { Kernel } from "nodefony";
import http from "@nodefony/http";

class App extends Kernel {
  constructor(environment, cli, settings) {
    super(environment, cli, settings);
    this.use(http);
  }
}

export default App;

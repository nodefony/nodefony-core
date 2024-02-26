import Module from "../kernel/Module";
import Service from "../Service";
import Container from "../Container";
import fetch from "node-fetch";
import * as library from "node-fetch";
//import { injectable } from "../kernel/decorators/kernelDecorator";

class Fetch extends Service {
  public fetch: typeof fetch;
  public library: typeof library;
  constructor(module: Module) {
    super("Fetch", module.container as Container);
    this.library = library;
    this.fetch = fetch;
  }
}

export default Fetch;

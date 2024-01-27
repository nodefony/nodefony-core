import Module from "../kernel/Module";
import Service from "../Service";
import Container from "../Container";
import fetch from "node-fetch";
import * as library from "node-fetch";

class Fetch extends Service {
  public fetch: typeof fetch;
  public library: typeof library;
  constructor(module: Module) {
    const container = module.container as Container;
    super("fetch", container);
    this.library = library;
    this.fetch = fetch;
  }
}

export default Fetch;

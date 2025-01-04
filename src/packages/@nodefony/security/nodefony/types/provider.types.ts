import { Service } from "nodefony";
import { Firewall } from "./firewall.types";

export type optionsProvider = Record<string, any>;

export interface Provider extends Service {
  constructor(
    name: string,
    options: optionsProvider,
    firewall?: Firewall
  ): Provider;
}

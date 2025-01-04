import { Service } from "nodefony";
import { Firewall } from "./firewall.types";

export type optionsFactory = Record<string, any>;

export interface Factory extends Service {
  constructor(
    name: string,
    options: optionsFactory,
    firewall?: Firewall
  ): Factory;
}

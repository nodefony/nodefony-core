import { Service, Container, Event, inject } from "nodefony";
import Firewall from "../service/firewall";

export type optionsFactory = Record<string, any>;

class Factory extends Service {
  constructor(
    name: string,
    options: optionsFactory = {},
    @inject("firewall") public firewall?: Firewall
  ) {
    const container: Container = firewall?.container as Container;
    const event: Event = firewall?.notificationsCenter as Event;
    super(name, container, event, options);
  }
}

export default Factory;

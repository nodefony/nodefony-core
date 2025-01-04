import { Service, Container, Event, inject } from "nodefony";
import { optionsFactory } from "../types/factory.types";
import { Firewall } from "../types/firewall.types";

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

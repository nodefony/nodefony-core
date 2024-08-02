import { Service, Container, Event, inject } from "nodefony";
import Firewall from "../service/firewall";

export type optionsProvider = Record<string, any>;

class Provider extends Service {
  constructor(
    name: string,
    options: optionsProvider = {},
    @inject("firewall") public firewall?: Firewall
  ) {
    const container: Container = firewall?.container as Container;
    const event: Event = firewall?.notificationsCenter as Event;
    super(name, container, event, options);
  }
}

export default Provider;

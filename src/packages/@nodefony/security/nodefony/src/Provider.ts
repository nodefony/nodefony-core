import { Service, Container, Event, inject } from "nodefony";
import { Firewall } from "../types";
import { optionsProvider } from "../types/provider.types";

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

import { Service, Kernel, Container, Event } from "nodefony";

class ServerHttp extends Service {
  constructor(kernel: Kernel) {
    super(
      "http",
      kernel.container as Container,
      kernel.notificationsCenter as Event
    );
  }
}

export default ServerHttp;

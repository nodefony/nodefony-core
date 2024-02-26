import { Service, Module, Container, Event } from "nodefony";
import { Context } from "@nodefony/http";

class Controller extends Service {
  static basepath: string = "/";
  constructor(name: string, context: Context) {
    super(
      name,
      context.container as Container,
      context.notificationsCenter as Event
    );
  }
}

export default Controller;

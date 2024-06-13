import Container from "../Container";
import Service from "../Service";
import Syslog from "../syslog/Syslog";
import Pdu from "../syslog/Pdu";
import {
  extend,
  isEmptyObject,
  isPlainObject,
  isUndefined,
  isRegExp,
  isContainer,
  typeOf,
  isFunction,
  isArray,
  isPromise,
  isSubclassOf,
} from "../Tools";
import { v5 as uuidv5, v4 as uuidv4 } from "uuid";
import Websocket from "./transport/websocket";
import Storage from "./api/Storage";

class Nodefony {
  private static instance: Nodefony;
  public Service: typeof Service = Service;
  public Container: typeof Container = Container;
  public Syslog: typeof Syslog = Syslog;
  public Pdu: typeof Pdu = Pdu;
  public Websocket: typeof Websocket = Websocket;
  public Storage: typeof Storage = Storage;
  private constructor() {}
  public static getInstance(): Nodefony {
    if (!Nodefony.instance) {
      Nodefony.instance = new Nodefony();
    }
    return Nodefony.instance;
  }
  generateV5Id(name: string, namespace?: string): string {
    return uuidv5(name, namespace || uuidv4());
  }
  generateId(): string {
    return uuidv4();
  }
}

export default Nodefony.getInstance();
export {
  Service,
  Container,
  Pdu,
  Syslog,
  extend,
  isEmptyObject,
  isPlainObject,
  isUndefined,
  isRegExp,
  isContainer,
  typeOf,
  isFunction,
  isArray,
  isPromise,
  isSubclassOf,
};

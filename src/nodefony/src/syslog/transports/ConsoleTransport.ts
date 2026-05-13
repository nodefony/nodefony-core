import type { ITransport } from "../../types/ITransport";
import type Pdu from "../Pdu";
import Syslog from "../Syslog";

export class ConsoleTransport implements ITransport {
  readonly name = "console";
  private readonly pid: string;

  constructor(pid: string = "") {
    this.pid = pid;
  }

  async send(pdu: Pdu): Promise<void> {
    Syslog.normalizeLog(pdu, this.pid);
  }
}

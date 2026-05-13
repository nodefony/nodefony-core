import type { ITransport } from "../../types/ITransport";
import type Pdu from "../Pdu";
import type Syslog from "../Syslog";

// Forwards Pdu from a child syslog to a parent syslog (aggregation pattern).
// The target syslog receives the original Pdu — same severity, msgid, timestamp.
export class SyslogTransport implements ITransport {
  readonly name = "syslog";
  private readonly target: Syslog;

  constructor(target: Syslog) {
    this.target = target;
  }

  async send(pdu: Pdu): Promise<void> {
    this.target.log(pdu);
  }
}

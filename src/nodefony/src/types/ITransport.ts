import type Pdu from "../syslog/Pdu";

export interface ITransport {
  readonly name: string;
  send(pdu: Pdu): Promise<void>;
}

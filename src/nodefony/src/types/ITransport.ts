import type Pdu from "../syslog/Pdu";

export interface ITransport {
  readonly name: string;
  send(pdu: Pdu): Promise<void>;
  /**
   * Libère ce que le transport tient ouvert (fichier, socket). Appelé par le
   * `Syslog` quand il retire ou remplace le transport. Un `send()` ultérieur
   * doit rester possible (réouverture paresseuse).
   */
  close?(): Promise<void>;
}

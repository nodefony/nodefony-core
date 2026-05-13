import { appendFile } from "node:fs/promises";
import type { ITransport } from "../../types/ITransport";
import type Pdu from "../Pdu";

export interface FileTransportOptions {
  path: string;
  format?: "json" | "text";
}

export class FileTransport implements ITransport {
  readonly name = "file";
  private readonly path: string;
  private readonly format: "json" | "text";

  constructor(options: FileTransportOptions) {
    this.path = options.path;
    this.format = options.format ?? "json";
  }

  async send(pdu: Pdu): Promise<void> {
    const line =
      this.format === "json"
        ? JSON.stringify(pdu) + "\n"
        : `${new Date(pdu.timeStamp).toISOString()} ${pdu.severityName} ${pdu.msgid}: ${String(pdu.payload)}\n`;
    await appendFile(this.path, line, "utf8");
  }
}

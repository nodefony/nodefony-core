import * as http from "node:http";
import * as https from "node:https";
import type { ITransport } from "../../types/ITransport";
import type Pdu from "../Pdu";

export interface HttpTransportOptions {
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export class HttpTransport implements ITransport {
  readonly name = "http";
  private readonly url: URL;
  private readonly headers: Record<string, string>;
  private readonly timeout: number;

  constructor(options: HttpTransportOptions) {
    this.url = new URL(options.url);
    this.headers = options.headers ?? {};
    this.timeout = options.timeout ?? 5000;
  }

  send(pdu: Pdu): Promise<void> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(pdu);
      const isHttps = this.url.protocol === "https:";
      const options: http.RequestOptions = {
        hostname: this.url.hostname,
        port: this.url.port || (isHttps ? 443 : 80),
        path: this.url.pathname + this.url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...this.headers,
        },
      };
      const mod = isHttps ? https : http;
      const req = mod.request(options, (res) => {
        res.resume(); // drain response body
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HttpTransport: HTTP ${res.statusCode}`));
        } else {
          resolve();
        }
      });
      req.setTimeout(this.timeout, () => {
        req.destroy(new Error(`HttpTransport: timeout after ${this.timeout}ms`));
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
}

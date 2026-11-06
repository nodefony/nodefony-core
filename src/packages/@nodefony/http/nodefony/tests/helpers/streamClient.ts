/// <reference types="node" />
import http from "node:http";
import http2 from "node:http2";

/**
 * Clients des bancs de réponses EN FLUX (SSE, flux d'octets) : une même
 * ouverture en HTTP/1.1 (5151), HTTP/2 chiffré (5152) et h2c (5153), qui rend
 * la main à l'arrivée des en-têtes et expose le premier morceau, la fin vue
 * par le client (propre ou coupée) et le départ du client.
 */

export const H1 = "http://localhost:5151";
export const H2 = "https://localhost:5152";
export const H2C = "http://localhost:5153";

export type Transport = "HTTP/1.1" | "HTTP/2" | "h2c";
export const TRANSPORTS: Transport[] = ["HTTP/1.1", "HTTP/2", "h2c"];

/** Comment le client a vu la réponse finir : fin propre, ou coupure. */
export type Ending = "end" | "abort";

export interface IFlow {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  raw: string;
  /** Réglée au premier morceau du corps. */
  first: Promise<void>;
  /** Réglée à la fin vue par le client. */
  done: Promise<Ending>;
  /** Le client s'en va : HTTP/1.1 détruit la socket, HTTP/2 annule le flux seul. */
  leave(): void;
  /** Libère la session HTTP/2 du client (sans effet en HTTP/1.1). */
  dispose(): void;
}

/** Ouvre une réponse en HTTP/1.1 et rend la main à l'arrivée des en-têtes. */
export function openH1(path: string, method = "GET"): Promise<IFlow> {
  return new Promise((resolve, reject) => {
    let settleFirst!: () => void;
    let settleDone!: (e: Ending) => void;
    const first = new Promise<void>((r) => (settleFirst = r));
    const done = new Promise<Ending>((r) => (settleDone = r));
    const req = http.request(`${H1}${path}`, { method }, (res) => {
      const flow: IFlow = {
        status: res.statusCode ?? 0,
        headers: res.headers,
        raw: "",
        first,
        done,
        leave: () => req.destroy(),
        dispose: () => undefined,
      };
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        flow.raw += chunk;
        settleFirst();
      });
      res.on("end", () => settleDone("end"));
      res.on("close", () => settleDone(res.complete ? "end" : "abort"));
      res.on("error", () => settleDone("abort"));
      resolve(flow);
    });
    req.on("error", (e) => {
      settleDone("abort");
      reject(e);
    });
    req.end();
  });
}

/** Même ouverture en HTTP/2, chiffré ou en clair (h2c). */
export function openH2(
  path: string,
  origin: string,
  method = "GET",
): Promise<IFlow> {
  return new Promise((resolve, reject) => {
    let settleFirst!: () => void;
    let settleDone!: (e: Ending) => void;
    const first = new Promise<void>((r) => (settleFirst = r));
    const done = new Promise<Ending>((r) => (settleDone = r));
    const session = http2.connect(origin, { rejectUnauthorized: false });
    session.on("error", reject);
    const req = session.request({ ":path": path, ":method": method });
    const flow: IFlow = {
      status: 0,
      headers: {},
      raw: "",
      first,
      done,
      leave: () => req.close(http2.constants.NGHTTP2_CANCEL),
      dispose: () => session.close(),
    };
    req.on("response", (headers) => {
      flow.status = Number(headers[":status"]);
      flow.headers = headers;
      resolve(flow);
    });
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      flow.raw += chunk;
      settleFirst();
    });
    // Pas d'écoute de `end` : un RST_STREAM l'émet aussi. Seul le code de
    // fermeture distingue une fin propre d'une coupure.
    req.on("close", () =>
      settleDone(
        req.rstCode === http2.constants.NGHTTP2_NO_ERROR ? "end" : "abort",
      ),
    );
    req.on("error", () => settleDone("abort"));
    req.end();
  });
}

/** Ouvre `path` sur le transport voulu. */
export function openFlow(
  transport: Transport,
  path: string,
  method = "GET",
): Promise<IFlow> {
  if (transport === "HTTP/1.1") return openH1(path, method);
  return openH2(path, transport === "HTTP/2" ? H2 : H2C, method);
}

/** Attend que `check` réponde vrai, en le relançant toutes les 25 ms. */
export async function until(
  check: () => Promise<boolean>,
  ms = 3000,
): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("délai dépassé");
    await new Promise((r) => setTimeout(r, 25));
  }
}

export const pause = (ms: number): Promise<unknown> =>
  new Promise((r) => setTimeout(r, ms));

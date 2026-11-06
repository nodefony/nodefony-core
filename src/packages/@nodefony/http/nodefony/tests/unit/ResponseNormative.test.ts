/// <reference types="node" />
/**
 * Ce que la réponse met RÉELLEMENT sur le fil dans les cas limites que les
 * normes tranchent (#734) — sur de vrais serveurs Node, jamais sur un double :
 * le cadrage (morceaux, trailers, trames HTTP/2) appartient à Node, et seul le
 * fil dit ce qu'il en a fait.
 *
 * - RFC 9110 §15.3.6 : un 205 ne porte jamais de contenu.
 * - RFC 9110 §6.5.1 / RFC 9112 §6.1 : `Transfer-Encoding` n'est jamais un
 *   trailer, et ne s'envoie qu'à un client HTTP/1.1.
 * - RFC 9113 §8.2.2 : `Transfer-Encoding` n'existe pas en HTTP/2.
 * - RFC 9110 §5.5 / RFC 9113 §8.2.1 : une valeur d'en-tête ne commence ni ne
 *   finit par une espace.
 */
import { expect } from "vitest";
import http from "node:http";
import http2 from "node:http2";
import net from "node:net";
import type { AddressInfo } from "node:net";
import HttpResponse from "../../src/context/http/Response";
import Http2Response from "../../src/context/http2/Response";

/** Contexte minimal que la réponse lit pendant `writeHead`. */
const fakeContext = () =>
  ({
    isRedirect: false,
    httpKernel: null,
    type: "http",
    method: "GET",
    request: { pathname: "/" },
  }) as never;

/** Un serveur HTTP/1.1 dont chaque requête est confiée à `handle`. */
async function h1Server(
  handle: (r: HttpResponse) => void | Promise<void>,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    void handle(new HttpResponse(res, fakeContext()));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}

/** Les octets BRUTS d'une réponse HTTP/1.x — trailers et morceaux compris. */
function rawGet(port: number, version = "1.1"): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(
        `GET / HTTP/${version}\r\nHost: localhost\r\nConnection: close\r\n\r\n`,
      );
    });
    let raw = "";
    socket.setEncoding("latin1");
    socket.on("data", (d: string) => (raw += d));
    socket.on("end", () => resolve(raw));
    socket.on("error", reject);
  });
}

describe("flush() — le cadrage du flux appartient à Node (RFC 9112 §6.1, RFC 9113 §8.2.2)", () => {
  it("HTTP/1.1 : Transfer-Encoding dans l'EN-TÊTE, jamais en trailer", async () => {
    const srv = await h1Server(async (r) => {
      await r.flush("un", "utf-8");
      await r.flush("deux", "utf-8");
      await r.end();
    });
    try {
      const raw = await rawGet(srv.port);
      const at = raw.indexOf("\r\n\r\n");
      const head = raw.slice(0, at).toLowerCase();
      const body = raw.slice(at + 4);
      expect(head).toContain("transfer-encoding: chunked");
      expect(head, "aucune longueur sur un flux").not.toContain(
        "content-length",
      );
      // Après le morceau final `0\r\n`, la section des trailers doit être vide.
      const trailers = body.slice(body.lastIndexOf("0\r\n") + 3);
      expect(trailers.toLowerCase()).not.toContain("transfer-encoding");
      expect(body).toContain("un");
      expect(body).toContain("deux");
    } finally {
      await srv.close();
    }
  });

  it("HTTP/1.0 : aucun Transfer-Encoding envoyé à un client qui ne le connaît pas", async () => {
    const srv = await h1Server(async (r) => {
      await r.flush("un", "utf-8");
      await r.end();
    });
    try {
      const raw = await rawGet(srv.port, "1.0");
      expect(raw.toLowerCase()).not.toContain("transfer-encoding");
      expect(raw).toContain("un");
    } finally {
      await srv.close();
    }
  });

  it("HTTP/2 : ni en-tête ni trailer Transfer-Encoding", async () => {
    const server = http2.createServer();
    server.on("request", (_req, res) => {
      const r = new Http2Response(res, fakeContext());
      void (async () => {
        await r.flush("un", "utf-8");
        await r.flush("deux", "utf-8");
        await r.end();
      })();
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const { port } = server.address() as AddressInfo;
    const client = http2.connect(`http://127.0.0.1:${port}`);
    try {
      const seen = await new Promise<{
        headers: http2.IncomingHttpHeaders;
        trailers: http2.IncomingHttpHeaders;
        body: string;
      }>((resolve, reject) => {
        const req = client.request({ ":path": "/" });
        let headers: http2.IncomingHttpHeaders = {};
        let trailers: http2.IncomingHttpHeaders = {};
        let body = "";
        req.setEncoding("utf8");
        req.on("response", (h) => (headers = h));
        req.on("trailers", (t) => (trailers = t));
        req.on("data", (d: string) => (body += d));
        req.on("end", () => resolve({ headers, trailers, body }));
        req.on("error", reject);
        req.end();
      });
      expect(seen.headers[":status"]).toBe(200);
      expect(seen.headers["transfer-encoding"]).toBeUndefined();
      expect(seen.trailers["transfer-encoding"]).toBeUndefined();
      expect(seen.body).toBe("undeux");
    } finally {
      client.close();
      await new Promise<void>((ok) => server.close(() => ok()));
    }
  });
});

describe("205 Reset Content — jamais de contenu (RFC 9110 §15.3.6)", () => {
  it("le corps posé par l'application ne part pas", async () => {
    const srv = await h1Server((r) => {
      r.setStatusCode(205);
      r.setBody("ne doit pas partir");
      r.writeHead();
      void r.send();
    });
    try {
      const raw = await rawGet(srv.port);
      expect(raw.startsWith("HTTP/1.1 205")).toBe(true);
      expect(raw).not.toContain("ne doit pas partir");
      // Message délimité : longueur zéro annoncée, rien après les en-têtes.
      expect(raw.toLowerCase()).toContain("content-length: 0");
      expect(raw.slice(raw.indexOf("\r\n\r\n") + 4)).toBe("");
    } finally {
      await srv.close();
    }
  });
});

describe("valeur d'en-tête — pas d'espace en bordure (RFC 9110 §5.5, RFC 9113 §8.2.1)", () => {
  it("setHeader rogne les espaces et tabulations de bord", async () => {
    const srv = await h1Server((r) => {
      r.setHeader("X-Bord", " \tv a\t ");
      r.setHeader("X-Liste", [" a", "b "]);
      r.writeHead();
      void r.send("ok");
    });
    try {
      const raw = await rawGet(srv.port);
      expect(raw).toContain("X-Bord: v a\r\n".toLowerCase());
      expect(raw).toContain("x-liste: a\r\n");
      expect(raw).toContain("x-liste: b\r\n");
    } finally {
      await srv.close();
    }
  });
});

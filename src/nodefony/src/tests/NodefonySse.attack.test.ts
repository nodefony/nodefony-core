// Dérogation de FICHIER : ce banc éprouve les gestionnaires `on…` d'EventSource.
/* oxlint-disable unicorn/prefer-add-event-listener */
import { expect } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { NodefonySse } from "../client/sse/NodefonySse";
import { SseParser, type ISseEvent } from "../client/sse/SseParser";

/**
 * RED-TEAM — le client SSE face à un serveur HOSTILE (passe threat-first :
 * matrice conçue sans lire l'implémentation). Chaque cas encode le verdict
 * d'une implémentation saine, d'après WHATWG HTML §9.2 et la matrice de menace.
 */

type Handler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  n: number,
) => void;

interface IDecor {
  url: string;
  hits: http.IncomingHttpHeaders[];
  close(): Promise<void>;
}

const open: NodefonySse[] = [];
const decors: IDecor[] = [];

async function serve(handler: Handler): Promise<IDecor> {
  const hits: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.headers);
    handler(req, res, hits.length);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  const decor: IDecor = {
    url: `http://127.0.0.1:${port}/flux`,
    hits,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
  decors.push(decor);
  return decor;
}

const stream = (res: http.ServerResponse): void => {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const track = (sse: NodefonySse): NodefonySse => (open.push(sse), sse);

afterEach(async () => {
  for (const sse of open.splice(0)) sse.close();
  for (const d of decors.splice(0)) await d.close();
});

describe("RED-TEAM NodefonySse — serveur hostile", () => {
  it("V26 · `retry: 0` du serveur ne provoque pas une tempête de reconnexions", async () => {
    const decor = await serve((_req, res) => {
      stream(res);
      res.end("retry: 0\ndata: x\n\n");
    });
    track(new NodefonySse(decor.url));
    await wait(300);
    // Une implémentation saine impose un plancher : quelques tentatives, pas des centaines.
    expect(decor.hits.length).to.be.at.most(4);
  });

  it("V26 · un `retry` démesuré reste un délai fini — le client se reconnecte un jour", async () => {
    const decor = await serve((_req, res, n) => {
      stream(res);
      if (n === 1) res.end("retry: 99999999999999\ndata: x\n\n");
      else res.write("data: y\n\n");
    });
    const sse = track(new NodefonySse(decor.url));
    await wait(100);
    // Pas de délai > 2^31-1 ms : Node le ramènerait à 1 ms (tempête), ou jamais.
    expect(decor.hits.length).to.equal(1);
    sse.close();
  });

  it("V28 · `lastEventId` avec CR/LF est refusé à la construction", () => {
    expect(
      () =>
        new NodefonySse("http://127.0.0.1:1/x", {
          lastEventId: "a\r\nX-Injecte: 1",
        }),
    ).to.throw();
  });

  it("V28 · un `id` serveur hors Latin-1 ne bloque pas la reconnexion", async () => {
    const decor = await serve((_req, res, n) => {
      stream(res);
      if (n === 1) res.end("retry: 20\nid: é€😀\ndata: a\n\n");
      else res.write("data: b\n\n");
    });
    const sse = track(new NodefonySse(decor.url));
    const got: string[] = [];
    sse.onmessage = (e) => got.push(e.data);
    await wait(400);
    expect(got).to.deep.equal(["a", "b"]);
    expect(decor.hits.length).to.equal(2);
    // L'en-tête porte les OCTETS UTF-8 de l'id (Fetch : isomorphic encode).
    expect(
      Buffer.from(
        decor.hits[1]?.["last-event-id"] as string,
        "latin1",
      ).toString("utf8"),
    ).to.equal("é€😀");
  });

  it("V31 · un écouteur qui ferme au premier événement n'en reçoit pas d'autre du même morceau", async () => {
    const decor = await serve((_req, res) => {
      stream(res);
      res.write("data: 1\n\ndata: 2\n\ndata: 3\n\n");
    });
    const sse = track(new NodefonySse(decor.url));
    const got: string[] = [];
    sse.onmessage = (e) => {
      got.push(e.data);
      sse.close();
    };
    await wait(200);
    expect(got).to.deep.equal(["1"]);
  });

  it("V33 · seuls http: et https: sont acceptés", () => {
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/event-stream,data:%20x%0A%0A",
      "ftp://h/x",
    ]) {
      expect(() => new NodefonySse(url), url).to.throw();
    }
  });

  it("V25 · une infinité de lignes `data:` vides est bornée, sans reconnexion", async () => {
    const decor = await serve((_req, res) => {
      stream(res);
      res.write("retry: 10\n" + "data:\n".repeat(200_000));
    });
    const sse = track(new NodefonySse(decor.url, { maxEventSize: 1024 }));
    await wait(300);
    expect(sse.readyState).to.equal(NodefonySse.CLOSED);
    expect(decor.hits.length).to.equal(1);
  });

  it("V27 · une redirection vers une autre origine ne transporte pas `Authorization`", async () => {
    const target = await serve((_req, res) => {
      stream(res);
      res.write("data: ok\n\n");
    });
    const origin = await serve((_req, res) => {
      res.writeHead(307, { Location: target.url }).end();
    });
    const sse = track(
      new NodefonySse(origin.url, {
        headers: { Authorization: "Bearer secret" },
      }),
    );
    await wait(300);
    expect(target.hits.length).to.be.at.least(1);
    expect(target.hits[0]?.authorization).to.equal(undefined);
    sse.close();
  });
});

describe("RED-TEAM SseParser — découpage différentiel", () => {
  const SAMPLE =
    "﻿id: 1\r\nevent: a\r\ndata: x\r\ndata: é\r\n\r\n: c\rdata: y\r\rdata\n\nretry: 5\nid\ndata: z\n\n";
  const run = (chunks: string[]): ISseEvent[] => {
    const out: ISseEvent[] = [];
    const p = new SseParser({ onEvent: (e) => out.push(e) });
    for (const c of chunks) p.push(c);
    return out;
  };

  it("V29 · tout découpage en deux morceaux rend les mêmes événements qu'un seul morceau", () => {
    const whole = run([SAMPLE]);
    expect(whole.length).to.equal(4);
    for (let i = 0; i <= SAMPLE.length; i++) {
      expect(
        run([SAMPLE.slice(0, i), SAMPLE.slice(i)]),
        `coupure ${i}`,
      ).to.deep.equal(whole);
    }
  });

  it("V29 · caractère par caractère, même résultat", () => {
    // Par unité UTF-16 : c'est ce que fait `TextDecoder` d'un flux d'octets découpé.
    expect(run(SAMPLE.split(""))).to.deep.equal(run([SAMPLE]));
  });
});

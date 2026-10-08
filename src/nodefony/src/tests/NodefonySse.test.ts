// Dérogation de FICHIER : ce banc éprouve les gestionnaires `onopen` /
// `onmessage` / `onerror` d'`EventSource`, que `NodefonySse` reprend à
// l'identique — les remplacer par `addEventListener` ne testerait plus l'API.
/* oxlint-disable unicorn/prefer-add-event-listener */
import { expect } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { NodefonySse } from "../client/sse/NodefonySse";

/**
 * `NodefonySse` contre un vrai serveur `node:http` local — pas de doublure de
 * `fetch` : ce qui est éprouvé est le client tel qu'un script Node l'emploie.
 * Norme : WHATWG HTML §9.2.3 (cycle, reconnexion, échec).
 */

type Handler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: string,
  n: number,
) => void;

interface IDecor {
  url: string;
  requests: Array<{
    method: string;
    headers: http.IncomingHttpHeaders;
    body: string;
  }>;
  close(): Promise<void>;
}

const open: NodefonySse[] = [];

async function serve(handler: Handler): Promise<IDecor> {
  const requests: IDecor["requests"] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (c: string) => (body += c));
    req.on("end", () => {
      requests.push({ method: req.method ?? "", headers: req.headers, body });
      handler(req, res, body, requests.length);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/flux`,
    requests,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

const stream = (res: http.ServerResponse): void => {
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
};

function track(sse: NodefonySse): NodefonySse {
  open.push(sse);
  return sse;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("délai dépassé");
    await wait(10);
  }
}

describe("NodefonySse — client EventSource sur fetch", () => {
  let decor: IDecor | null = null;

  afterEach(async () => {
    for (const sse of open.splice(0)) sse.close();
    await decor?.close();
    decor = null;
  });

  it("reçoit les événements dans l'ordre, typés, avec leur identifiant", async () => {
    decor = await serve((_req, res) => {
      stream(res);
      res.write(
        "data: un\nid: 1\n\nevent: maj\ndata: deux\nid: 2\n\ndata: trois\n\n",
      );
    });
    const sse = track(new NodefonySse(decor.url));
    const got: string[] = [];
    let opened = false;
    sse.onopen = () => (opened = true);
    sse.onmessage = (e) => got.push(`message:${e.data}:${e.lastEventId}`);
    sse.addEventListener("maj", (e) =>
      got.push(`maj:${(e as MessageEvent<string>).data}`),
    );
    expect(sse.readyState).to.equal(NodefonySse.CONNECTING);
    await until(() => got.length === 3);
    expect(opened).to.equal(true);
    expect(sse.readyState).to.equal(NodefonySse.OPEN);
    expect(got).to.deep.equal(["message:un:1", "maj:deux", "message:trois:2"]);
    expect(sse.lastEventId).to.equal("2");
    expect(decor.requests[0]?.headers.accept).to.equal("text/event-stream");
  });

  it("envoie méthode, en-têtes et corps — ce que refuse EventSource", async () => {
    decor = await serve((_req, res) => {
      stream(res);
      res.write("data: ok\n\n");
    });
    const sse = track(
      new NodefonySse(decor.url, {
        method: "POST",
        headers: {
          Authorization: "Bearer jeton",
          "Content-Type": "application/json",
        },
        body: '{"q":1}',
      }),
    );
    await until(() => sse.readyState === NodefonySse.OPEN);
    const req = decor.requests[0];
    expect(req?.method).to.equal("POST");
    expect(req?.headers.authorization).to.equal("Bearer jeton");
    expect(req?.body).to.equal('{"q":1}');
  });

  it("reconnecte après une fin de flux, avec Last-Event-ID et le délai retry: du serveur", async () => {
    decor = await serve((_req, res, _body, n) => {
      stream(res);
      if (n === 1) res.end("retry: 30\nid: 7\ndata: avant\n\n");
      else res.write("data: après\n\n");
    });
    const sse = track(new NodefonySse(decor.url));
    const got: string[] = [];
    let errors = 0;
    sse.onerror = () => errors++;
    sse.onmessage = (e) => got.push(e.data);
    await until(() => got.length === 2);
    expect(got).to.deep.equal(["avant", "après"]);
    expect(errors).to.equal(1);
    expect(decor.requests[0]?.headers["last-event-id"]).to.equal(undefined);
    expect(decor.requests[1]?.headers["last-event-id"]).to.equal("7");
  });

  it("close() arrête toute reconnexion", async () => {
    decor = await serve((_req, res) => {
      stream(res);
      res.end("retry: 20\ndata: x\n\n");
    });
    const sse = track(new NodefonySse(decor.url));
    sse.onerror = () => sse.close();
    await until(() => sse.readyState === NodefonySse.CLOSED);
    await wait(150);
    expect(decor.requests).to.have.length(1);
  });

  it("204 : CLOSED, sans reconnexion (« cesse de te reconnecter »)", async () => {
    decor = await serve((_req, res) => {
      res.writeHead(204).end();
    });
    const sse = track(new NodefonySse(decor.url, { retry: 20 }));
    let errors = 0;
    sse.onerror = () => errors++;
    await until(() => sse.readyState === NodefonySse.CLOSED);
    await wait(150);
    expect(errors).to.equal(1);
    expect(decor.requests).to.have.length(1);
  });

  it("un autre type que text/event-stream échoue sans reconnexion", async () => {
    decor = await serve((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
    });
    const sse = track(new NodefonySse(decor.url, { retry: 20 }));
    await until(() => sse.readyState === NodefonySse.CLOSED);
    await wait(150);
    expect(decor.requests).to.have.length(1);
  });

  it("un serveur qui n'envoie jamais de fin de ligne est coupé, sans reconnexion", async () => {
    decor = await serve((_req, res) => {
      stream(res);
      res.write("data: " + "x".repeat(200));
    });
    const sse = track(
      new NodefonySse(decor.url, { retry: 20, maxEventSize: 64 }),
    );
    await until(() => sse.readyState === NodefonySse.CLOSED);
    await wait(150);
    expect(decor.requests).to.have.length(1);
  });

  it("une coupure réseau reconnecte", async () => {
    decor = await serve((req, res, _body, n) => {
      stream(res);
      if (n === 1) {
        res.write("retry: 20\ndata: un\n\n");
        setTimeout(() => req.socket.destroy(), 20);
      } else res.write("data: deux\n\n");
    });
    const sse = track(new NodefonySse(decor.url));
    const got: string[] = [];
    sse.onmessage = (e) => got.push(e.data);
    await until(() => got.length === 2);
    expect(got).to.deep.equal(["un", "deux"]);
  });
});

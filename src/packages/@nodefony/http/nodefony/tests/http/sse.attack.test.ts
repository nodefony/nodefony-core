/// <reference types="node" />
import { expect } from "vitest";
import http from "node:http";
import net from "node:net";
import { SseParser, type ISseEvent } from "nodefony/client";

/**
 * RED-TEAM — l'API serveur des flux SSE (passe threat-first : matrice conçue
 * sans lire l'implémentation). Banc : `GET /nodefony/test/sse/echo`, qui renvoie
 * ce qu'on lui passe et publie chaque refus de l'API dans un événement `refused`.
 */

const H1 = "http://localhost:5151";
const SSE = "/nodefony/test/sse";

function read(
  path: string,
  init: http.RequestOptions = {},
): Promise<{ status: number; events: ISseEvent[]; raw: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${H1}${path}`, init, (res) => {
      const events: ISseEvent[] = [];
      const parser = new SseParser({ onEvent: (e) => events.push(e) });
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => {
        raw += c;
        parser.push(c);
      });
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, events, raw }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

const echo = (params: Record<string, string>) =>
  read(`${SSE}/echo?${new URLSearchParams(params).toString()}`);
const types = (events: ISseEvent[]) => events.map((e) => e.type);

describe("RED-TEAM SSE — API serveur (requires server)", () => {
  for (const [field, value] of [
    ["event", "x\ndata: forgé"],
    ["event", "x\rdata: forgé"],
    ["id", "1\ndata: forgé"],
    ["id", "1\u0000"],
  ] as const) {
    it(`V1 · ${field} portant ${JSON.stringify(value)} est refusé, rien n'est forgé`, async () => {
      const r = await echo({ [field]: value, data: "x" });
      expect(r.events).to.deep.equal([
        { type: "refused", data: "TypeError", lastEventId: "" },
        { type: "end", data: "fin", lastEventId: "" },
      ]);
      expect(r.raw).not.to.include("forgé");
    });
  }

  for (const data of ["a\n\nevent: x\ndata: b", "a\rb", "a\r\nb", "a\n\n\nb"]) {
    it(`V2 · data ${JSON.stringify(data)} arrive en UN événement, fins de ligne normalisées`, async () => {
      const r = await echo({ data });
      expect(types(r.events)).to.deep.equal(["message", "end"]);
      expect(r.events[0]?.data).to.equal(data.replace(/\r\n|\r/g, "\n"));
    });
  }

  it("V3 · un commentaire sur plusieurs lignes ne fait naître aucun événement", async () => {
    const r = await echo({ comment: "x\ndata: forgé\n\nevent: y" });
    expect(types(r.events)).to.deep.equal(["end"]);
  });

  for (const retry of ["NaN", "-1", "1.5", "Infinity", "1e21", "2147483648"]) {
    it(`V4 · retry(${retry}) est refusé`, async () => {
      const r = await echo({ retry });
      expect(types(r.events)).to.deep.equal(["refused", "end"]);
      expect(r.raw).not.to.match(/^retry:/m);
    });
  }

  it("V4 · retry(1500) part tel quel (contrôle positif)", async () => {
    const r = await echo({ retry: "1500" });
    expect(r.raw).to.match(/^retry: 1500$/m);
    expect(types(r.events)).to.deep.equal(["end"]);
  });

  for (const kind of ["circular", "bigint"]) {
    it(`V6 · une donnée non sérialisable (${kind}) est refusée, le flux continue`, async () => {
      const r = await echo({ kind });
      expect(types(r.events)).to.deep.equal(["refused", "end"]);
    });
  }

  it("V6 · undefined ne s'écrit jamais `data: undefined`", async () => {
    const r = await echo({ kind: "undefined" });
    expect(r.raw).not.to.include("undefined");
  });

  it("V11 · send et close après close() : ni exception, ni écriture, serveur sain", async () => {
    const r = await echo({ after: "1" });
    expect(types(r.events)).to.deep.equal(["end"]);
    const state = await fetch(`${H1}${SSE}/state`);
    expect(state.status).to.equal(200);
  });

  it("V17 · HEAD sur une route de flux répond tout de suite, sans corps", async () => {
    const started = Date.now();
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        `${H1}${SSE}/hold`,
        { method: "HEAD" },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.setTimeout(2000, () => req.destroy(new Error("HEAD sans fin")));
      req.end();
    });
    expect(status).to.equal(200);
    expect(Date.now() - started).to.be.below(1000);
  });

  it("V19 · deux requêtes pipelinées après un flux fini rendent deux réponses complètes", async () => {
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(5151, "localhost", () => {
        const req = `GET ${SSE}/three HTTP/1.1\r\nHost: localhost\r\n\r\n`;
        socket.write(
          req + req.replace("\r\n\r\n", "\r\nConnection: close\r\n\r\n"),
        );
      });
      let out = "";
      socket.setEncoding("latin1");
      socket.on("data", (c: string) => (out += c));
      socket.on("end", () => resolve(out));
      socket.on("error", reject);
    });
    expect(raw.match(/^HTTP\/1\.1 200/gm)).to.have.length(2);
    expect(raw.match(/\r\n0\r\n\r\n/g)).to.have.length(2);
  });

  it("V20 · un Last-Event-ID de 100 Ko est refusé (431), jamais un 500", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        `${H1}${SSE}/three`,
        { headers: { "Last-Event-ID": "x".repeat(100_000) } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).to.equal(431);
  });
});

/// <reference types="node" />
import { expect } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { H1, openFlow, until } from "../helpers/streamClient";

/**
 * Une action qui RENVOIE une `Response` Web standard ou un flux d'octets nu
 * (#749) — sans appeler `renderStream` : le framework répond, la requête ne
 * pend plus jusqu'au 408. Routes : `/nodefony/test/stream/web/*`
 * (`src/modules/test/nodefony/controller/StreamController.ts`).
 *
 * La tuyauterie du flux (contre-pression, délais, HEAD…) est celle de
 * `openStream`, éprouvée par `byteStream.test.ts` ; ici, ce que la `Response`
 * apporte en propre : statut, en-têtes, cookies, et le tri entre une réponse
 * CONSTRUITE et une réponse RELAYÉE.
 */

const BASE = "/nodefony/test/stream";

interface IStreamState {
  sourceDestroyed: boolean | null;
}

async function state(): Promise<IStreamState> {
  const res = await fetch(`${H1}${BASE}/state`);
  return (await res.json()) as IStreamState;
}

describe("Réponse Web et flux nu renvoyés par une action (requires server)", () => {
  it("`return new Response(…)` : statut, en-têtes et cookies de la réponse ; jamais un en-tête de connexion", async () => {
    const res = await fetch(`${H1}${BASE}/web/constructed`);
    expect(res.status).to.equal(201);
    expect(res.headers.get("content-type")).to.equal(
      "text/plain; charset=utf-8",
    );
    expect(res.headers.get("x-web")).to.equal("construite");
    expect(res.headers.getSetCookie()).to.deep.equal([
      "a=1; Path=/",
      "b=2; Path=/",
    ]);
    expect(res.headers.get("upgrade")).to.equal(null);
    expect(await res.text()).to.equal("bonjour");
  });

  it("`return Response.json(…)` : JSON servi tel quel", async () => {
    const res = await fetch(`${H1}${BASE}/web/json`);
    expect(res.status).to.equal(200);
    expect(res.headers.get("content-type")).to.match(/^application\/json/);
    expect(await res.json()).to.deep.equal({ ok: true, source: "web" });
  });

  it("une `Response` sans corps : 204 vide", async () => {
    const res = await fetch(`${H1}${BASE}/web/empty`);
    expect(res.status).to.equal(204);
    expect(await res.text()).to.equal("");
  });

  it("`return Response.error()` : 502, jamais un statut 0", async () => {
    const res = await fetch(`${H1}${BASE}/web/error`);
    expect(res.status).to.equal(502);
  });

  it("`return fetch(…)` : statut et type de l'amont ; ni son encodage (corps déjà décodé) ni ses cookies", async () => {
    const upstream = http.createServer((_req, res) => {
      res.writeHead(202, {
        "content-type": "text/plain; charset=utf-8",
        "content-encoding": "gzip",
        "set-cookie": ["amont=1; Path=/"],
        "x-amont": "oui",
      });
      res.end(gzipSync("bonjour de l'amont"));
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    const { port } = upstream.address() as AddressInfo;
    try {
      const res = await fetch(`${H1}${BASE}/web/fetch?port=${port}`);
      expect(res.status).to.equal(202);
      expect(res.headers.get("content-type")).to.equal(
        "text/plain; charset=utf-8",
      );
      expect(res.headers.get("x-amont")).to.equal("oui");
      expect(res.headers.get("content-encoding")).to.equal(null);
      expect(res.headers.getSetCookie()).to.deep.equal([]);
      expect(await res.text()).to.equal("bonjour de l'amont");
    } finally {
      upstream.closeAllConnections();
      await new Promise((r) => upstream.close(r));
    }
  });

  it("un `Readable` Node renvoyé nu : le corps entier", async () => {
    const res = await fetch(`${H1}${BASE}/web/readable`);
    expect(res.status).to.equal(200);
    expect(await res.text()).to.equal("prêt fin");
  });

  it("un `ReadableStream` Web renvoyé nu : le corps entier", async () => {
    const res = await fetch(`${H1}${BASE}/web/stream`);
    expect(res.status).to.equal(200);
    expect(await res.text()).to.equal("prêt fin");
  });

  it("le client part en plein flux : le `Readable` renvoyé est DÉTRUIT", async () => {
    const flow = await openFlow("HTTP/1.1", `${BASE}/web/readable?held=1`);
    expect(flow.status).to.equal(200);
    await flow.first;
    flow.leave();
    await until(async () => (await state()).sourceDestroyed === true);
    expect((await state()).sourceDestroyed).to.equal(true);
  });

  it("le client part en plein flux : le `ReadableStream` renvoyé est ANNULÉ", async () => {
    const flow = await openFlow("HTTP/1.1", `${BASE}/web/stream?held=1`);
    expect(flow.status).to.equal(200);
    await flow.first;
    flow.leave();
    await until(async () => (await state()).sourceDestroyed === true);
    expect((await state()).sourceDestroyed).to.equal(true);
  });
});

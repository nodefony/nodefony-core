/// <reference types="node" />
import { expect } from "vitest";
import http from "node:http";
import http2 from "node:http2";
import { NodefonySse, SseParser, type ISseEvent } from "nodefony/client";

/**
 * Flux d'événements serveur (SSE) sur le serveur RÉEL — HTTP/1.1 (5151) et
 * HTTP/2 (5152). Routes : `src/modules/test/nodefony/controller/SseController.ts`.
 *
 * Le flux est relu par `SseParser`, l'analyseur UNIQUE du dépôt — celui du
 * client : un second analyseur écrit ici validerait le serveur contre sa propre
 * lecture de la norme.
 */

const H1 = "http://localhost:5151";
const H2 = "https://localhost:5152";
const SSE = "/nodefony/test/sse";
const EXPECTED: ISseEvent[] = [
  { type: "message", data: "un", lastEventId: "1" },
  { type: "maj", data: '{"n":2}', lastEventId: "2" },
  { type: "message", data: "trois\nlignes", lastEventId: "3" },
];

interface IRead {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  events: ISseEvent[];
  raw: string;
  /** Le client s'en va : HTTP/1.1 détruit la socket, HTTP/2 annule le flux seul. */
  leave(): void;
}

/** Collecte le flux jusqu'à sa fin, ou jusqu'à `stop(events)` puis coupe. */
function readH1(
  path: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
  stop?: (events: ISseEvent[], raw: string) => boolean,
): Promise<IRead> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${H1}${path}`,
      { method: init.method ?? "GET", headers: init.headers ?? {} },
      (res) => {
        const out: IRead = {
          status: res.statusCode ?? 0,
          headers: res.headers,
          events: [],
          raw: "",
          leave: () => req.destroy(),
        };
        const parser = new SseParser({ onEvent: (e) => out.events.push(e) });
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          out.raw += chunk;
          parser.push(chunk);
          // Assez lu : on rend la main SANS partir — c'est au test de décider.
          if (stop?.(out.events, out.raw)) resolve(out);
        });
        res.on("end", () => resolve(out));
        res.on("close", () => resolve(out));
      },
    );
    req.on("error", (e) => (stop ? undefined : reject(e)));
    req.end(init.body);
  });
}

/** Même lecture en HTTP/2 ; `stop` annule le FLUX seul (la session reste ouverte). */
function readH2(
  path: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
  stop?: (events: ISseEvent[], raw: string) => boolean,
): Promise<IRead & { session: http2.ClientHttp2Session }> {
  return new Promise((resolve, reject) => {
    const session = http2.connect(H2, { rejectUnauthorized: false });
    session.on("error", reject);
    const req = session.request({
      ":path": path,
      ":method": init.method ?? "GET",
      ...init.headers,
    });
    const out = {
      status: 0,
      headers: {} as IRead["headers"],
      events: [] as ISseEvent[],
      raw: "",
      session,
      leave: () => {
        req.close(http2.constants.NGHTTP2_CANCEL);
      },
    };
    const parser = new SseParser({ onEvent: (e) => out.events.push(e) });
    req.on("response", (h) => {
      out.status = Number(h[":status"]);
      out.headers = h;
    });
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      out.raw += chunk;
      parser.push(chunk);
      if (stop?.(out.events, out.raw)) resolve(out);
    });
    req.on("close", () => resolve(out));
    req.end(init.body);
  });
}

async function getJson(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${H1}${path}`);
  return (await res.json()) as Record<string, unknown>;
}

async function until(check: () => Promise<boolean>, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("délai dépassé");
    await new Promise((r) => setTimeout(r, 25));
  }
}

const ready = (events: ISseEvent[]) => events.some((e) => e.type === "ready");

describe("SSE — renderSse() sur le serveur réel (requires server)", () => {
  it("HTTP/1.1 : trois événements dans l'ordre, découpage par morceaux, puis fin", async () => {
    const r = await readH1(`${SSE}/three`, {
      headers: { Accept: "text/event-stream" },
    });
    expect(r.status).to.equal(200);
    expect(r.headers["content-type"]).to.equal(
      "text/event-stream; charset=utf-8",
    );
    expect(r.headers["cache-control"]).to.equal("no-cache, no-transform");
    expect(r.headers["x-accel-buffering"]).to.equal("no");
    expect(r.headers["transfer-encoding"]).to.equal("chunked");
    expect(r.headers["content-length"]).to.equal(undefined);
    expect(r.events).to.deep.equal(EXPECTED);
  });

  it("HTTP/2 : mêmes trois événements, sans Transfer-Encoding (RFC 9113 §8.2.2)", async () => {
    const r = await readH2(`${SSE}/three`);
    r.session.close();
    expect(r.status).to.equal(200);
    expect(r.headers["content-type"]).to.equal(
      "text/event-stream; charset=utf-8",
    );
    expect(r.headers["transfer-encoding"]).to.equal(undefined);
    expect(r.events).to.deep.equal(EXPECTED);
  });

  for (const [name, read, init] of [
    ["HTTP/1.1 GET", readH1, {}],
    ["HTTP/2 GET", readH2, {}],
    // Le cas qui départage : en HTTP/1.1 la REQUÊTE a déjà émis `close` (corps
    // lu, Node ≥ 16) quand l'action ouvre le flux — écoutée là, la fermeture ne
    // serait jamais vue. Vu rouge en branchant l'écoute sur la requête. C'est le
    // POST de la porte MCP.
    [
      "HTTP/1.1 POST avec corps",
      readH1,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"q":1}',
      },
    ],
    [
      "HTTP/2 POST avec corps",
      readH2,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"q":1}',
      },
    ],
  ] as const) {
    it(`${name} : le départ du client ferme le flux côté serveur — et pas AVANT`, async () => {
      await getJson(`${SSE}/reset`);
      const r: IRead & { session?: http2.ClientHttp2Session } = await read(
        `${SSE}/hold`,
        init,
        ready,
      );
      // Le client est encore là : rien ne doit être fermé.
      await new Promise((res) => setTimeout(res, 200));
      const during = await getJson(`${SSE}/state`);
      expect(during.opened).to.equal(1);
      expect(during.closed).to.equal(0);
      // Le client s'en va — en HTTP/2, le FLUX seul : la session reste ouverte.
      r.leave();
      await until(async () => (await getJson(`${SSE}/state`)).closed === 1);
      r.session?.close();
      const after = await getJson(`${SSE}/state`);
      // L'écouteur de fermeture voit encore la requête dans l'ALS.
      const seen = after.closeSawRequestId as Array<string | null>;
      expect(seen).to.have.length(1);
      expect(seen[0]).to.be.a("string");
    });

    it.skipIf(init !== undefined && "method" in init)(
      `${name} : battement de cœur — un commentaire, ignoré par le client`,
      async () => {
        // `/hold` bat toutes les 50 ms : on lit jusqu'au premier battement.
        const r: IRead & { session?: http2.ClientHttp2Session } = await read(
          `${SSE}/hold`,
          {},
          (_e, raw) => raw.includes(":\n\n"),
        );
        // Attendre la fermeture VUE par le serveur avant de rendre la main : un
        // `close` tardif tombait après le reset du test suivant, qui comptait
        // alors `closed = 1` avant le départ de son client (vu rouge en CI
        // macOS, HTTP/2).
        const closedCount = async () =>
          (await getJson(`${SSE}/state`)).closed as number;
        const before = await closedCount();
        r.leave();
        await until(async () => (await closedCount()) > before);
        r.session?.close();
        expect(r.raw).to.include(":\n\n");
        expect(r.events.map((e) => e.type)).to.deep.equal(["ready"]);
      },
    );
  }

  it("même POST : JSON sans Accept, flux avec Accept: text/event-stream", async () => {
    const json = await fetch(`${H1}${SSE}/negotiate`, { method: "POST" });
    expect(json.headers.get("content-type")).to.match(/application\/json/);
    expect(await json.json()).to.deep.equal({ mode: "json" });
    const flux = await readH1(`${SSE}/negotiate`, {
      method: "POST",
      headers: { Accept: "text/event-stream" },
    });
    expect(flux.events).to.deep.equal([
      { type: "message", data: '{"mode":"flux"}', lastEventId: "" },
    ]);
  });

  it("NodefonySse lit le flux du serveur de bout en bout", async () => {
    const sse = new NodefonySse(`${H1}${SSE}/three`);
    const got: string[] = [];
    // Le gestionnaire `on…` est l'API d'`EventSource` que le client reprend :
    // c'est lui qu'on éprouve, pas `addEventListener`.
    // oxlint-disable-next-line unicorn/prefer-add-event-listener
    sse.onmessage = (e) => got.push(e.data);
    sse.addEventListener("maj", (e) =>
      got.push(`maj:${(e as MessageEvent<string>).data}`),
    );
    // Fin du flux par le serveur → l'erreur annonce la reconnexion : on ferme.
    // oxlint-disable-next-line unicorn/prefer-add-event-listener
    sse.onerror = () => sse.close();
    await until(async () => sse.readyState === NodefonySse.CLOSED);
    expect(got).to.deep.equal(["un", 'maj:{"n":2}', "trois\nlignes"]);
    expect(sse.lastEventId).to.equal("3");
  });
});

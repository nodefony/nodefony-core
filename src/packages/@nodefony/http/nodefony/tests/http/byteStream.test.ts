/// <reference types="node" />
import { expect } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { IS_PROD_TARGET } from "../helpers/targetEnv";
import {
  H1,
  openFlow,
  pause,
  until,
  type Transport,
} from "../helpers/streamClient";

/**
 * Ce qui est PROPRE au flux d'octets (`renderStream` / `openStream`, #724) —
 * le cycle de vie commun avec le SSE est éprouvé par la table de parité
 * (`streamLifecycle.test.ts`). Ici : HEAD, erreur de la source avant et après
 * le premier morceau, source muette, source déjà finie, producteur bloqué en
 * écriture, relais `fetch`.
 */

const BASE = "/nodefony/test/stream";

interface IResult {
  reason: string;
  bytes: number;
}

interface IStreamState {
  sendedAtOpen: boolean | null;
  closed: number;
  reasons: string[];
  lastResult: IResult | null;
  sourceDestroyed: boolean | null;
  childExited: boolean | null;
}

async function state(
  route: "state" | "reset" = "state",
): Promise<IStreamState> {
  const res = await fetch(`${H1}${BASE}/${route}`);
  return (await res.json()) as IStreamState;
}

/** Attend la fin du dernier flux et la rend. */
async function lastResult(ms = 3000): Promise<IResult> {
  let result: IResult | null = null;
  await until(async () => {
    result = (await state()).lastResult;
    return result !== null;
  }, ms);
  if (result === null) throw new Error("aucun résultat");
  return result;
}

const H2_TRANSPORTS: Transport[] = IS_PROD_TARGET
  ? ["HTTP/2"]
  : ["HTTP/2", "h2c"];

describe("Flux d'octets — renderStream (requires server)", () => {
  beforeEach(async () => {
    await state("reset");
  });

  for (const transport of ["HTTP/1.1", ...H2_TRANSPORTS] as Transport[]) {
    it(`${transport} : HEAD rend les en-têtes du GET, sans corps, et détruit la source`, async () => {
      const flow = await openFlow(transport, `${BASE}/end`, "HEAD");
      expect(flow.status).to.equal(200);
      expect(String(flow.headers["content-type"])).to.match(/^text\/plain/);
      expect(await flow.done).to.equal("end");
      flow.dispose();
      expect(flow.raw).to.equal("");
      expect(await lastResult()).to.deep.equal({ reason: "end", bytes: 0 });
      expect((await state()).sourceDestroyed).to.equal(true);
    });

    it(`${transport} : une erreur APRÈS le premier octet est une COUPURE, jamais une fin propre`, async () => {
      const flow = await openFlow(transport, `${BASE}/fail?when=after`);
      expect(flow.status).to.equal(200);
      expect(await flow.done).to.equal("abort");
      flow.dispose();
      expect(flow.raw).to.equal("prêt");
      expect(await lastResult()).to.deep.equal({ reason: "error", bytes: 5 });
    });
  }

  it("GET : en-têtes par défaut d'un flux, et le corps entier", async () => {
    const res = await fetch(`${H1}${BASE}/end`);
    expect(res.status).to.equal(200);
    expect(res.headers.get("cache-control")).to.equal("no-cache, no-transform");
    expect(res.headers.get("x-accel-buffering")).to.equal("no");
    expect(res.headers.get("accept-ranges")).to.equal(null);
    expect(await res.text()).to.equal("prêt fin");
    expect(await lastResult()).to.deep.equal({ reason: "end", bytes: 9 });
  });

  it("une erreur AVANT le premier octet rend la page d'erreur ordinaire : 500", async () => {
    const res = await fetch(`${H1}${BASE}/fail?when=before`);
    expect(res.status).to.equal(500);
    await res.text();
    expect((await lastResult()).reason).to.equal("error");
    expect((await state()).sourceDestroyed).to.equal(true);
  });

  it("…et le code d'une HttpError levée par la source : 502", async () => {
    const res = await fetch(`${H1}${BASE}/fail?when=before&status=502`);
    expect(res.status).to.equal(502);
    await res.text();
    expect((await lastResult()).reason).to.equal("error");
  });

  it("un en-tête refusé au premier morceau rend 500, sans abattre le serveur", async () => {
    const res = await fetch(`${H1}${BASE}/bad-header`);
    expect(res.status).to.equal(500);
    expect(res.headers.get("x-injected")).to.equal(null);
    expect(res.headers.get("set-cookie") ?? "").to.not.contain("volé");
    await res.text();
    expect((await lastResult()).reason).to.equal("error");
    const health = await fetch(`${H1}${BASE}/state`);
    expect(health.status).to.equal(200);
  });

  it("une source MUETTE avant son premier octet rend 504 au bout d'idleTimeout", async () => {
    const started = Date.now();
    const res = await fetch(`${H1}${BASE}/limits?silent=1&idle=300`);
    expect(res.status).to.equal(504);
    await res.text();
    expect(Date.now() - started).to.be.lessThan(2500);
    expect(await lastResult()).to.deep.equal({ reason: "timeout", bytes: 0 });
  });

  it("une source qui se TAIT après son premier octet est coupée au bout d'idleTimeout", async () => {
    const flow = await openFlow("HTTP/1.1", `${BASE}/limits?idle=300`);
    expect(await flow.done).to.equal("abort");
    expect((await lastResult()).reason).to.equal("timeout");
  });

  it("idleTimeout: 0 désarme le chien de garde : une source muette reste ouverte", async () => {
    // Les en-têtes partent au premier octet : une source muette ne rend RIEN,
    // pas même un statut. On observe donc la requête brute, sans l'attendre.
    let answered = false;
    const req = http.get(`${H1}${BASE}/limits?silent=1&idle=0`, (res) => {
      answered = true;
      res.resume();
    });
    req.on("error", () => undefined);
    await until(async () => (await state()).sendedAtOpen === true);
    await pause(1200);
    expect(answered, "ni 504 ni coupure").to.equal(false);
    expect((await state()).lastResult).to.equal(null);
    req.destroy();
    expect((await lastResult()).reason).to.equal("client");
  });

  for (const kind of ["empty", "destroyed"]) {
    it(`source déjà finie (${kind}) : réponse terminée, { end, 0 }, sans promesse pendue`, async () => {
      const res = await fetch(`${H1}${BASE}/finished?kind=${kind}`);
      expect(res.status).to.equal(200);
      expect(await res.text()).to.equal("");
      expect(await lastResult()).to.deep.equal({ reason: "end", bytes: 0 });
    });
  }

  it("producteur BLOQUÉ en écriture : le départ du client le libère en moins de 5 s, sans kill", async () => {
    const flow = await openFlow("HTTP/1.1", `${BASE}/child`);
    await flow.first;
    // Le client ne lit pas : le producteur se bloque sur sa sortie pleine.
    await pause(300);
    expect((await state()).childExited).to.equal(false);
    flow.leave();
    await until(async () => (await state()).childExited === true, 5000);
    expect((await lastResult()).reason).to.equal("client");
    expect((await state()).sourceDestroyed).to.equal(true);
  });

  it("relais fetch : le départ du client ferme la connexion amont en moins de 2 s", async () => {
    let markClosed!: () => void;
    const upstreamClosed = new Promise<void>((r) => (markClosed = r));
    const chunk = Buffer.alloc(16_384, 0x7a);
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/x-test" });
      const timer = setInterval(() => res.write(chunk), 20);
      res.on("close", () => {
        clearInterval(timer);
        markClosed();
      });
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    const { port } = upstream.address() as AddressInfo;
    try {
      const flow = await openFlow("HTTP/1.1", `${BASE}/relay?port=${port}`);
      expect(flow.headers["content-type"]).to.equal("application/x-test");
      await flow.first;
      flow.leave();
      const closedInTime = await Promise.race([
        upstreamClosed.then(() => true),
        pause(2000).then(() => false),
      ]);
      expect(closedInTime, "amont fermé en moins de 2 s").to.equal(true);
      expect((await lastResult()).reason).to.equal("client");
    } finally {
      upstream.closeAllConnections();
      await new Promise((r) => upstream.close(r));
    }
  });
});

/// <reference types="node" />
/**
 * Hooks contexte `onSend`/`onClose` sous gardes zéro-listener (lot C perf).
 *
 * `HttpContext.#doSend` et `close()` ne fire ces hooks QUE si un listener est
 * attaché (économie de 2 Promises/req par hook dans le cas nominal). Ce banc
 * prouve que la garde n'éteint PAS un hook réellement écouté :
 *  - `onSend` fire AVANT writeHead → le header posé par le listener DOIT
 *    arriver au client (preuve par le fil, pas par un état interne) ;
 *  - `onClose` fire au close → compteur relu via /hooks/context/state.
 *
 * Routes sondes : module test `DefaultController` (hooks-context*).
 */
import { expect } from "chai";
import https from "node:https";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };

function get(path: string): Promise<{
  status: number;
  headers: NodeJS.Dict<string | string[]>;
  body: Record<string, unknown>;
}> {
  return new Promise((resolve, reject) => {
    const r = https.request({ ...BASE, method: "GET", path }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        let body: Record<string, unknown>;
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          body = { raw };
        }
        resolve({ status: res.statusCode!, headers: res.headers, body });
      });
    });
    r.on("error", reject);
    r.end();
  });
}

describe("Context hooks onSend/onClose — gardes zéro-listener (lot C)", () => {
  beforeAll(async () => {
    await get("/nodefony/test/hooks/context/reset");
  });

  it("onSend fire quand écouté : le header posé par le listener part au client", async () => {
    const r = await get("/nodefony/test/hooks/context");
    expect(r.status).to.equal(200);
    expect(r.body.armed).to.equal(true);
    expect(
      r.headers["x-hook-onsend"],
      "header absent = la garde a éteint le hook onSend",
    ).to.equal("fired");
  });

  it("onClose fire quand écouté : compteur incrémenté", async () => {
    const state = await get("/nodefony/test/hooks/context/state");
    expect(state.status).to.equal(200);
    expect(state.body.onSendCount, "onSendCount")
      .to.be.a("number")
      .and.to.be.greaterThanOrEqual(1);
    expect(
      state.body.onCloseCount,
      "onCloseCount absent = la garde a éteint le hook onClose",
    )
      .to.be.a("number")
      .and.to.be.greaterThanOrEqual(1);
  });

  it("sans listener : la réponse ne porte jamais le header du hook", async () => {
    const r = await get("/nodefony/test/index");
    expect(r.status).to.equal(200);
    expect(r.headers["x-hook-onsend"]).to.equal(undefined);
  });
});

/// <reference types="node" />
/**
 * BUG-002 — RequestContext (ALS) inside Context.onAfterResponse hooks.
 *
 * onAfterResponse callbacks fire from response "finish"/"close" (HTTP) or
 * "onFinish" (WS) listeners attached BEFORE RequestContext.run() opens the
 * ALS bubble. Without the fix (AsyncResource.bind at registration time) the
 * hooks run outside the bubble and lose requestId/user/traceparent.
 *
 * These tests MUST fail before the fix and pass after.
 *
 * Live server: 127.0.0.1:5152 (HTTPS) + wss://localhost:5152.
 * Routes: src/modules/test/.../AlsController.ts (prefix /nodefony/test/als-test)
 */
import { expect } from "chai";
import https from "node:https";
import WebSocket from "ws";
import "mocha";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const WSS = "wss://localhost:5152";
const wsOpts = { rejectUnauthorized: false };

type Json = Record<string, unknown>;

function get(path: string): Promise<{ status: number; body: Json }> {
  return new Promise((resolve, reject) => {
    const r = https.request({ ...BASE, method: "GET", path }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        try {
          resolve({ status: res.statusCode!, body: raw ? JSON.parse(raw) : {} });
        } catch {
          resolve({ status: res.statusCode!, body: { raw } });
        }
      });
    });
    r.on("error", reject);
    r.end();
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function state(): Promise<Json> {
  return (await get("/nodefony/test/als-test/state")).body;
}

describe("BUG-002 — RequestContext (ALS) inside onAfterResponse", () => {
  beforeEach(async () => {
    await get("/nodefony/test/als-test/reset");
    await wait(30);
  });

  it("HTTP hook sees the request's ALS requestId", async () => {
    const r = await get("/nodefony/test/als-test/after");
    expect(r.status).to.equal(200);
    const ctxId = r.body.contextRequestId as string;
    expect(ctxId).to.be.a("string");
    await wait(60);
    const s = await state();
    const byContext = s.byContext as Record<string, string | null>;
    expect(byContext[ctxId], "hook must observe the ALS requestId").to.equal(ctxId);
  });

  it("HTTP hook sees a user set mid-request via RequestContext.set", async () => {
    const r = await get("/nodefony/test/als-test/after/user");
    expect(r.status).to.equal(200);
    await wait(60);
    const s = await state();
    expect(s.hookUser, "hook must see the post-auth user").to.equal("http-user-7");
  });

  it("WS hook (onFinish) sees the handshake ALS requestId", async function () {
    this.timeout(20_000);
    const handshakeId = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`${WSS}/nodefony/test/als-test/ws/after`, wsOpts);
      ws.on("message", (data: WebSocket.RawData) => {
        const msg = JSON.parse(data.toString()) as Json;
        ws.send("bye");
        setTimeout(() => ws.close(), 10);
        resolve(msg.requestId as string);
      });
      ws.on("error", reject);
    });
    expect(handshakeId).to.be.a("string");
    await wait(80);
    const s = await state();
    expect(s.wsHookHandshakeId).to.equal(handshakeId);
    expect(s.wsHookRequestId, "WS after-hook must restore ALS").to.equal(handshakeId);
  });

  it("isolation: 2 concurrent requests each hook sees its own requestId", async () => {
    const [a, b] = await Promise.all([
      get("/nodefony/test/als-test/after"),
      get("/nodefony/test/als-test/after"),
    ]);
    const idA = a.body.contextRequestId as string;
    const idB = b.body.contextRequestId as string;
    expect(idA).to.not.equal(idB);
    await wait(80);
    const s = await state();
    const byContext = s.byContext as Record<string, string | null>;
    expect(byContext[idA]).to.equal(idA);
    expect(byContext[idB]).to.equal(idB);
  });

  it("late subscribe (registered after _afterResponseFired) still restores ALS", async () => {
    const r = await get("/nodefony/test/als-test/after/late");
    expect(r.status).to.equal(200);
    const ctxId = r.body.contextRequestId as string;
    await wait(80);
    const s = await state();
    expect(s.lateHookRequestId, "late hook must restore ALS").to.equal(ctxId);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import "reflect-metadata";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import { getRealtimeHub } from "../../src/server/RealtimeHub.js";
import type { WsConnectionTransport } from "../../src/transport/WsConnectionTransport.js";
import type { ContextType } from "@nodefony/http";

/**
 * #617 — le serveur temps réel ne lit plus le binaire comme du texte.
 *
 * `handleRealtime` faisait `toString()` de toute trame : un `Buffer` était
 * décodé en UTF-8, ne se parsait pas, et disparaissait sans un mot — comme tout
 * texte non JSON, jeté par un `catch` muet.
 */
function makeCtx() {
  const text: string[] = [];
  const binary: unknown[] = [];
  const conn = {
    readyState: 1,
    send: (data: unknown, cb?: (err?: Error) => void) => {
      if (typeof data === "string") text.push(data);
      else binary.push(data);
      cb?.();
    },
    close: () => {},
  };
  const ctx = {
    connection: conn,
    once: () => {},
    request: { headers: {}, url: "/" },
    cookies: {},
    url: "/",
    remoteAddress: "127.0.0.1",
    origin: "",
  };
  const transport = () =>
    (ctx as unknown as { __nfRealtime?: { transport: WsConnectionTransport } })
      .__nfRealtime!.transport;
  return { ctx, text, binary, transport };
}

class PlainRt extends RealtimeController {
  // Journal capturé : le verdict « une fois, nommé » se lit ici.
  logs: Parameters<RealtimeController["log"]>[] = [];
  override log(...args: Parameters<RealtimeController["log"]>) {
    this.logs.push(args);
    return super.log(...args);
  }
  constructor(ctx: unknown) {
    super("binary-rt", ctx as ContextType);
  }
  feed(message: string | Buffer | null): void {
    this.handleRealtime(message);
  }
  emitBinary(data: ArrayBuffer | ArrayBufferView): boolean {
    return this.sendBinaryToClient(data);
  }
}

class ReaderRt extends PlainRt {
  received: Buffer[] = [];
  protected override onRealtimeBinary(data: Buffer): void {
    this.received.push(data);
  }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function connected<T extends PlainRt>(Ctor: new (ctx: unknown) => T) {
  const decor = makeCtx();
  const rt = new Ctor(decor.ctx);
  rt.feed(null);
  await flush();
  rt.logs.length = 0;
  return { ...decor, rt };
}

describe("RealtimeController — trames binaires et illisibles (#617)", () => {
  beforeEach(() => getRealtimeHub().clear());

  it("binaire sans lecteur → compté, UN journal WARNING, jamais décodé en texte", async () => {
    const { rt, transport } = await connected(PlainRt);
    rt.feed(Buffer.from([0xff, 0xfe]));
    rt.feed(Buffer.from([1]));
    expect(transport().binaryDiscarded).to.equal(2);
    expect(transport().malformedDiscarded).to.equal(0);
    const avertis = rt.logs.filter(
      ([m, s]) => s === "WARNING" && String(m).includes("binaire"),
    );
    expect(avertis).to.have.length(1);
    expect(String(avertis[0]![0])).to.include("onRealtimeBinary()");
  });

  it("onRealtimeBinary → les octets exacts, ni comptés ni journalisés", async () => {
    const { rt, transport } = await connected(ReaderRt);
    const octets = Buffer.from([0xca, 0xfe, 0x00]);
    rt.feed(octets);
    expect(rt.received).to.have.length(1);
    expect(rt.received[0]!.equals(octets)).to.equal(true);
    expect(transport().binaryDiscarded).to.equal(0);
    expect(rt.logs).to.have.length(0);
  });

  it("texte non JSON → compté, UN journal, distinct du binaire", async () => {
    const { rt, transport } = await connected(PlainRt);
    rt.feed("pas du json");
    rt.feed("{tronqué");
    expect(transport().malformedDiscarded).to.equal(2);
    expect(
      rt.logs.filter(([m]) => String(m).includes("illisible")),
    ).to.have.length(1);
  });

  it("sendBinaryToClient → octets émis tels quels, comptés par la sonde", async () => {
    const { rt, binary, transport } = await connected(PlainRt);
    const avant = transport().messagesSent;
    const vue = new Uint8Array([7, 8, 9]);
    expect(rt.emitBinary(vue)).to.equal(true);
    expect(binary).to.deep.equal([vue]);
    expect(transport().messagesSent).to.equal(avant + 1);
  });

  it("avant le welcome → sendBinaryToClient rend false, rien ne part", () => {
    const { ctx, binary } = makeCtx();
    expect(new PlainRt(ctx).emitBinary(new Uint8Array([1]))).to.equal(false);
    expect(binary).to.have.length(0);
  });
});

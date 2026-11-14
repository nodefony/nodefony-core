import { describe, it, expect, beforeEach } from "vitest";
import "reflect-metadata";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import { getRealtimeHub } from "../../src/server/RealtimeHub.js";
import type { RealtimeInboundHandler } from "../../interfaces/IRealtimeController.js";
import type { ContextType } from "@nodefony/http";

/**
 * Une poignée de main qui ÉCHOUE après l'authentification (code d'application
 * qui lève dans `realtimeInbound()`) ne laisse rien au registre du hub : la
 * connexion fermée en 1011 n'y reste pas comptée, ni inscrite au tick de
 * révocation. Le nettoyage (`onFinish`) n'était branché qu'APRÈS ces appels.
 */

const OPEN = 1;

function makeCtx() {
  const closed: number[] = [];
  const conn = {
    readyState: OPEN,
    send: (_data: string, cb?: (err?: Error) => void) => cb?.(),
    close: (code: number) => closed.push(code),
  };
  const ctx = {
    type: "websocket",
    outboundTracer: () => null,
    connection: conn,
    // Le banc ne tire jamais `onFinish` : seul l'ordre d'inscription compte.
    once: () => {},
    request: { headers: {}, url: "/" },
    cookies: {},
    url: "/",
    remoteAddress: "127.0.0.1",
    origin: "",
  };
  return { ctx, closed };
}

class Broken extends RealtimeController {
  constructor(ctx: unknown) {
    super("test-rt-broken-handshake", ctx as ContextType);
  }
  override realtimeInbound(): Record<string, RealtimeInboundHandler> {
    throw new Error("déclaration d'entrée cassée");
  }
  feed(message: string | null): void {
    this.handleRealtime(message);
  }
}

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 10));

describe("poignée de main en échec — rien ne reste au registre du hub", () => {
  beforeEach(() => getRealtimeHub().clear());

  it("🔴 `realtimeInbound()` qui lève : connexion fermée, et non comptée", async () => {
    const { ctx, closed } = makeCtx();
    new Broken(ctx).feed(null);
    await settle();
    expect(closed).to.deep.equal([1011]);
    expect(getRealtimeHub().probe().connectionCount).to.equal(0);
  });
});

/// <reference types="node" />
import { expect, vi } from "vitest";
import WebsocketContext from "../../src/context/websocket/WebsocketContext.js";
import {
  admitFrame,
  frameRateRejectedTotal,
  FRAME_RATE_WINDOW_MS,
  type IFrameRateWindow,
} from "../../src/context/websocket/wsFrameRate.js";

/**
 * Borne de débit ENTRANTE (ADR-0022 §5 C2) : des trames comptées à l'arrivée,
 * AVANT tout décodage ; écartées au-delà de la borne, fermeture `1008` sur un
 * SOLDE de refus, jamais au premier dépassement.
 */
describe("admitFrame — compter les trames dans la fenêtre", () => {
  const fresh = (): IFrameRateWindow => ({ start: 0, count: 0, balance: 0 });

  it("sous la borne : tout passe ; la fenêtre suivante repart de zéro", () => {
    const w = fresh();
    for (let i = 0; i < 3; i++)
      expect(admitFrame(w, 10, 3, 0)).to.equal("send");
    expect(admitFrame(w, 10, 3, 0)).to.equal("drop");
    expect(admitFrame(w, FRAME_RATE_WINDOW_MS, 3, 0)).to.equal("send");
    expect(w.count).to.equal(1);
  });

  it("une trame écartée est comptée dans le cumul du processus", () => {
    const w = fresh();
    const before = frameRateRejectedTotal();
    admitFrame(w, 0, 1, 0);
    admitFrame(w, 0, 1, 0);
    admitFrame(w, 0, 1, 0);
    expect(frameRateRejectedTotal() - before).to.equal(2);
  });
});

/** Contexte WS minimal : seules les pièces que `handleMessage` touche, espions à part. */
function makeWs(options: Record<string, number>) {
  const spies = {
    decode: vi.fn(),
    route: vi.fn(() => undefined),
    close: vi.fn(),
  };
  const context: WebsocketContext = Object.create(WebsocketContext.prototype);
  Object.assign(context, {
    server: { options },
    connection: { close: spies.close },
    frameRate: null,
    rejected: false,
    response: null,
    resolver: {
      resolve: true,
      route: {},
      match: () => undefined,
      callController: spies.route,
    },
    fireAsync: vi.fn(() => Promise.resolve([])),
    setMetaData: vi.fn(),
    logMessageContent: spies.decode,
    reject: vi.fn(),
  });
  return { context, spies };
}

describe("WebsocketContext.handleMessage — borne de débit entrante", () => {
  it("borne 0 (défaut) : aucune fenêtre créée, toutes les trames décodées", async () => {
    const { context, spies } = makeWs({});
    for (let i = 0; i < 50; i++) await context.handleMessage("x", false);
    expect(context.frameRate).to.equal(null);
    expect(spies.decode).toHaveBeenCalledTimes(50);
  });

  it("rafale sous le solde : trames écartées SANS décodage, connexion vivante", async () => {
    const { context, spies } = makeWs({
      maxFramesPerSecond: 5,
      frameRateCloseAfterRejects: 100,
    });
    const before = frameRateRejectedTotal();
    for (let i = 0; i < 20; i++) await context.handleMessage("x", false);
    // Seules les 5 premières atteignent le décodage, le routage, le codec.
    expect(spies.decode).toHaveBeenCalledTimes(5);
    expect(spies.route).toHaveBeenCalledTimes(5);
    expect(frameRateRejectedTotal() - before).to.equal(15);
    expect(spies.close).not.toHaveBeenCalled();
  });

  it("flux soutenu : le solde atteint ferme en 1008", async () => {
    const { context, spies } = makeWs({
      maxFramesPerSecond: 5,
      frameRateCloseAfterRejects: 10,
    });
    for (let i = 0; i < 15; i++) await context.handleMessage("x", false);
    expect(spies.close).toHaveBeenCalledWith(1008, "frame rate");
  });
});

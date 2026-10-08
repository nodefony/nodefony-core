import { describe, expect, it } from "vitest";
import { createMcpResponseStream, type IMcpEventSink } from "../mcp/stream";
import { jsonRpcNotification } from "../jsonrpc/index";

/**
 * Le flux de réponse paresseux de la boîte à outils MCP (#554) : générique,
 * toute porte s'en sert en ne fournissant que l'ouverture de son flux.
 */
class FakeSink implements IMcpEventSink {
  closed = false;
  readonly sent: unknown[] = [];
  failOn: unknown = undefined;
  send(data: unknown): Promise<void> | undefined {
    if (data === this.failOn) throw new RangeError("trop gros");
    this.sent.push(data);
    return undefined;
  }
}

const note = (n: number) =>
  jsonRpcNotification("notifications/progress", { progress: n });

describe("createMcpResponseStream", () => {
  it("sans ouverture possible : pas de `notify`, `finish` rend null — la porte répond en objet", async () => {
    const stream = createMcpResponseStream<FakeSink>({});
    expect(stream.transport.notify).toBeUndefined();
    expect(await stream.finish({ id: 1 })).toBeNull();
  });

  it("rien envoyé en route : le flux n'est JAMAIS ouvert", async () => {
    let opened = 0;
    const stream = createMcpResponseStream({
      open: () => {
        opened++;
        return new FakeSink();
      },
    });
    expect(await stream.finish({ id: 1 })).toBeNull();
    expect(opened).toBe(0);
  });

  it("ouvert au premier envoi, UNE fois ; envois dans l'ordre, réponse finale en dernier", async () => {
    let opened = 0;
    const sink = new FakeSink();
    const stream = createMcpResponseStream({
      open: async () => {
        opened++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return sink;
      },
    });
    stream.transport.notify?.(note(1));
    stream.transport.notify?.(note(2));
    const final = { jsonrpc: "2.0", id: 1, result: {} };
    expect(await stream.finish(final)).toBe(sink);
    expect(opened).toBe(1);
    expect(sink.sent).toEqual([note(1), note(2), final]);
  });

  it("flux fermé par le client : plus rien n'est écrit, la porte le clôt quand même", async () => {
    const sink = new FakeSink();
    const stream = createMcpResponseStream({ open: () => sink });
    stream.transport.notify?.(note(1));
    // Laisser la chaîne d'envoi s'écouler (plusieurs microtâches) avant que le
    // client parte.
    await new Promise((resolve) => setTimeout(resolve, 0));
    sink.closed = true;
    expect(await stream.finish({ id: 1 })).toBe(sink);
    expect(sink.sent).toEqual([note(1)]);
  });

  it("une réponse finale refusée est signalée (final = true), jamais avalée", async () => {
    const sink = new FakeSink();
    const final = { id: 1 };
    sink.failOn = final;
    const lost: boolean[] = [];
    const stream = createMcpResponseStream({
      open: () => sink,
      onError: (_e, isFinal) => lost.push(isFinal),
    });
    stream.transport.notify?.(note(1));
    await stream.finish(final);
    expect(lost).toEqual([true]);
  });

  it("ouverture en échec : signalée, et la porte retombe sur une réponse en objet", async () => {
    const lost: boolean[] = [];
    const stream = createMcpResponseStream<FakeSink>({
      open: () => {
        throw new Error("réponse déjà partie");
      },
      onError: (_e, isFinal) => lost.push(isFinal),
    });
    stream.transport.notify?.(note(1));
    expect(await stream.finish({ id: 1 })).toBeNull();
    expect(lost).toEqual([false]);
  });

  it("le signal est transmis tel quel au protocole", () => {
    const abort = new AbortController();
    expect(
      createMcpResponseStream({ signal: abort.signal }).transport.signal,
    ).toBe(abort.signal);
  });
});

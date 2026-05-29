/* eslint-disable @typescript-eslint/no-explicit-any */
/*
 *   NODEFONY FRAMEWORK UNIT TEST — MOCHA STYLE
 *   Résilience de boot — Event.emitAsyncGuarded + optimisation emitAsync (hot path)
 */

import { expect } from "chai";
import Event from "../Event";

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 1));
}

describe("Event.emitAsyncGuarded", () => {
  it("aucun listener → résultat vide, jamais d'erreur", async () => {
    const ev = new Event();
    const r = await ev.emitAsyncGuarded("none");
    expect(r).to.deep.equal({ results: [], errors: [], stopped: false });
  });

  it("exécute les listeners EN SÉRIE et collecte les résultats dans l'ordre", async () => {
    const ev = new Event();
    const order: number[] = [];
    ev.on("e", async () => {
      await tick();
      order.push(1);
      return "a";
    });
    ev.on("e", () => {
      order.push(2);
      return "b";
    });
    const r = await ev.emitAsyncGuarded("e");
    expect(order).to.deep.equal([1, 2]);
    expect(r.results).to.deep.equal(["a", "b"]);
    expect(r.errors).to.have.length(0);
    expect(r.stopped).to.equal(false);
  });

  it("un listener qui throw n'empêche PAS les suivants (collecte l'erreur)", async () => {
    const ev = new Event();
    const seen: string[] = [];
    ev.on("e", () => {
      seen.push("a");
      throw new Error("boom");
    });
    ev.on("e", () => {
      seen.push("b");
      return "ok";
    });
    const r = await ev.emitAsyncGuarded("e");
    expect(seen).to.deep.equal(["a", "b"]);
    expect(r.errors).to.have.length(1);
    expect(r.errors[0].index).to.equal(0);
    expect(r.errors[0].timedOut).to.equal(false);
    expect((r.errors[0].error as Error).message).to.equal("boom");
    expect(r.results).to.deep.equal(["ok"]);
  });

  it("onListenerError retournant true STOPPE la chaîne", async () => {
    const ev = new Event();
    const seen: string[] = [];
    ev.on("e", () => {
      seen.push("a");
      throw new Error("x");
    });
    ev.on("e", () => {
      seen.push("b");
    });
    const r = await ev.emitAsyncGuarded("e", { onListenerError: () => true });
    expect(seen).to.deep.equal(["a"]); // "b" jamais appelé
    expect(r.stopped).to.equal(true);
    expect(r.errors).to.have.length(1);
  });

  it("borne un listener FIGÉ par timeoutMs (timedOut=true, les suivants tournent)", async () => {
    const ev = new Event();
    const seen: string[] = [];
    ev.on("e", () => {
      seen.push("frozen");
      return new Promise(() => {}); // ne se résout jamais
    });
    ev.on("e", () => {
      seen.push("after");
      return "ok";
    });
    const infos: any[] = [];
    const r = await ev.emitAsyncGuarded("e", {
      timeoutMs: 20,
      onListenerError: (_e, info) => {
        infos.push(info);
      },
    });
    expect(seen).to.deep.equal(["frozen", "after"]);
    expect(r.errors).to.have.length(1);
    expect(r.errors[0].timedOut).to.equal(true);
    expect(infos[0].timedOut).to.equal(true);
    expect(r.results).to.deep.equal(["ok"]);
  });

  it("onListenerSlow alerte au-delà de warnMs (sans compter comme un échec)", async () => {
    const ev = new Event();
    ev.on("e", async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const slow: any[] = [];
    const r = await ev.emitAsyncGuarded("e", {
      warnMs: 10,
      onListenerSlow: (info) => slow.push(info),
    });
    expect(r.errors).to.have.length(0);
    expect(slow).to.have.length(1);
    expect(slow[0].durationMs).to.be.greaterThan(9);
  });
});

describe("Event.emitAsync — optimisation hot path (comportement strictement inchangé)", () => {
  it("retourne false si aucun listener (court-circuit 0-alloc)", async () => {
    const ev = new Event();
    expect(await ev.emitAsync("none")).to.equal(false);
  });

  it("collecte les valeurs sync ET async dans l'ordre d'enregistrement", async () => {
    const ev = new Event();
    ev.on("e", () => "sync");
    ev.on("e", async () => "async");
    const r = await ev.emitAsync("e");
    expect(r).to.deep.equal(["sync", "async"]);
  });

  it("préserve l'ordre séquentiel même avec des délais async", async () => {
    const ev = new Event();
    const order: number[] = [];
    ev.on("e", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
    });
    ev.on("e", () => {
      order.push(2);
    });
    await ev.emitAsync("e");
    expect(order).to.deep.equal([1, 2]);
  });
});

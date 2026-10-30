import { describe, it, expect } from "vitest";
import {
  ClusterBackplane,
  type IClusterBackplaneTransport,
  type ClusterBackplaneEnvelope,
} from "../../src/backplane/ClusterBackplane.js";
import { CLUSTER_RT_KIND } from "nodefony";
import type { IBackplaneMessage } from "../../interfaces/IBackplane.js";

/**
 * Transport IPC factice — capture les enveloppes émises (`sent`) et expose `deliver()`
 * pour simuler l'arrivée d'un message relayé par le master, SANS forker de process.
 */
class FakeTransport implements IClusterBackplaneTransport {
  sent: ClusterBackplaneEnvelope[] = [];
  #cb: ((msg: unknown) => void) | null = null;
  send(env: ClusterBackplaneEnvelope): void {
    this.sent.push(env);
  }
  onReceive(cb: (msg: unknown) => void): void {
    this.#cb = cb;
  }
  /** Simule la réception d'un message IPC quelconque. */
  deliver(msg: unknown): void {
    this.#cb?.(msg);
  }
}

describe("ClusterBackplane (worker-side IPC)", () => {
  it("expose l'originId fourni", () => {
    const bp = new ClusterBackplane(new FakeTransport(), "pid-A");
    expect(bp.originId).to.equal("pid-A");
  });

  it("publish() émet une enveloppe taguée {kind,channel,payload,originId}", () => {
    const t = new FakeTransport();
    const bp = new ClusterBackplane(t, "pid-A");
    bp.publish("nodefony:orm:health", { rps: 12 });
    expect(t.sent).to.have.lengthOf(1);
    expect(t.sent[0]).to.deep.equal({
      kind: CLUSTER_RT_KIND,
      channel: "nodefony:orm:health",
      payload: { rps: 12 },
      originId: "pid-A",
    });
  });

  it("ingress : une enveloppe d'un AUTRE pair atteint le handler (sans le kind)", () => {
    const t = new FakeTransport();
    const bp = new ClusterBackplane(t, "pid-A");
    const got: IBackplaneMessage[] = [];
    bp.onMessage((m) => got.push(m));
    bp.start();
    t.deliver({
      kind: CLUSTER_RT_KIND,
      channel: "nodefony:syslog",
      payload: "hello",
      originId: "pid-B",
    });
    expect(got).to.deep.equal([
      { channel: "nodefony:syslog", payload: "hello", originId: "pid-B" },
    ]);
  });

  it("anti-echo : ignore une enveloppe portant son propre originId", () => {
    const t = new FakeTransport();
    const bp = new ClusterBackplane(t, "pid-A");
    let fired = 0;
    bp.onMessage(() => (fired += 1));
    bp.start();
    t.deliver({
      kind: CLUSTER_RT_KIND,
      channel: "c",
      payload: 1,
      originId: "pid-A", // soi-même
    });
    expect(fired).to.equal(0);
  });

  it("ignore les messages IPC non-realtime (autre kind / malformés)", () => {
    const t = new FakeTransport();
    const bp = new ClusterBackplane(t, "pid-A");
    let fired = 0;
    bp.onMessage(() => (fired += 1));
    bp.start();
    t.deliver({ kind: "nf:ctrl", foo: 1 }); // autre message de contrôle
    t.deliver("plain string");
    t.deliver(null);
    t.deliver({ channel: "c", payload: 1 }); // pas de kind
    expect(fired).to.equal(0);
  });

  it("start() est idempotent (un seul onReceive)", () => {
    let registrations = 0;
    const t: IClusterBackplaneTransport = {
      sent: [],
      send() {},
      onReceive() {
        registrations += 1;
      },
    } as unknown as IClusterBackplaneTransport;
    const bp = new ClusterBackplane(t, "pid-A");
    bp.start();
    bp.start();
    expect(registrations).to.equal(1);
  });

  it("onMessage remplace le handler précédent", () => {
    const t = new FakeTransport();
    const bp = new ClusterBackplane(t, "pid-A");
    const a: number[] = [];
    const b: number[] = [];
    bp.onMessage(() => a.push(1));
    bp.onMessage(() => b.push(1));
    bp.start();
    t.deliver({
      kind: CLUSTER_RT_KIND,
      channel: "c",
      payload: 1,
      originId: "x",
    });
    expect(a).to.have.lengthOf(0);
    expect(b).to.have.lengthOf(1);
  });

  it("stop() détache le handler (plus d'ingress)", () => {
    const t = new FakeTransport();
    const bp = new ClusterBackplane(t, "pid-A");
    let fired = 0;
    bp.onMessage(() => (fired += 1));
    bp.start();
    bp.stop();
    t.deliver({
      kind: CLUSTER_RT_KIND,
      channel: "c",
      payload: 1,
      originId: "x",
    });
    expect(fired).to.equal(0);
  });
});

describe("ClusterBackplane — charge absente (ADR-0021 S1)", () => {
  it("une charge absente arrive `undefined` chez l'autre worker (IPC sérialisé en JSON)", () => {
    const tA = new FakeTransport();
    const tB = new FakeTransport();
    const a = new ClusterBackplane(tA, "pid-A");
    const b = new ClusterBackplane(tB, "pid-B");
    const got: IBackplaneMessage[] = [];
    b.onMessage((m) => got.push(m));
    b.start();
    a.publish("chat:room1", undefined);
    // Relais du master : `nodefony cluster` lance ses workers sans
    // `serialization: "advanced"`, l'IPC passe donc par JSON.
    tB.deliver(JSON.parse(JSON.stringify(tA.sent[0])));
    expect(got).to.have.lengthOf(1);
    expect(got[0]!.payload).to.equal(undefined);
  });
});

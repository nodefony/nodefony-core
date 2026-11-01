import { describe, it, expect } from "vitest";
import { CBOR_FRAME_CODEC } from "nodefony/cbor";
import type { IFrameCodec } from "nodefony";
import { RealtimeHub } from "../../src/server/RealtimeHub";
import type {
  BackplaneHandler,
  IBackplane,
  IBackplaneInfo,
} from "../../interfaces/IBackplane.js";

/**
 * Des octets traversent le bus entre serveurs INTACTS, ou pas du tout — jamais déformés.
 *
 * SYMPTÔME d'origine : un `Uint8Array` publié sur un canal diffusé arrivait chez
 * les abonnés des AUTRES serveurs sous forme d'objet ordinaire (`{"0":1,"1":2}`) :
 * Redis et l'IPC du cluster sérialisaient en JSON. Aucune erreur, aucun compteur.
 *
 * RÈGLE (ADR-0021 S6/S8) : le hub confie des octets au backplane seulement quand
 * un codec binaire est posé ET que le backplane a accepté de les porter
 * (`IBackplane.enableBytes`). Sinon ils restent sur le serveur qui les publie, ses
 * abonnés les reçoivent intacts, et l'exploitant est prévenu UNE fois.
 */

class FakeBackplane implements IBackplane {
  readonly originId = "test";
  published: Array<{ channel: string; payload: unknown }> = [];
  start(): void {}
  stop(): void {}
  publish(channel: string, payload: unknown): void {
    this.published.push({ channel, payload });
  }
  onMessage(_h: BackplaneHandler): void {}
  describe(): IBackplaneInfo {
    return {
      driver: "fake",
      kind: "fake",
      originId: this.originId,
      crossPod: true,
    };
  }
}

/** Backplane qui porte les octets : rend `true` à `enableBytes`, et retient le codec reçu. */
class BytesBackplane extends FakeBackplane {
  enabledWith: IFrameCodec | null = null;
  enableBytes(codec: IFrameCodec): boolean {
    this.enabledWith = codec;
    return true;
  }
}

function harness(bp: IBackplane = new FakeBackplane()) {
  const hub = new RealtimeHub();
  hub.setBackplane(bp);
  hub.markBroadcastChannel("media:");
  const notices: string[] = [];
  hub.onPlatformNotice((message) => notices.push(message));
  const local: unknown[] = [];
  hub.subscribe(
    "media:room1",
    (p) => local.push(p),
    () => () => {},
  );
  return { hub, notices, local };
}

describe("hub — sans bus binaire, des octets ne partent pas déformés", () => {
  it.each([
    ["Uint8Array", new Uint8Array([1, 2, 255])],
    ["vue DataView", new DataView(new ArrayBuffer(2))],
    ["ArrayBuffer", new ArrayBuffer(3)],
  ])("%s : livré aux abonnés locaux, jamais publié sur le bus", (_n, bytes) => {
    const bp = new FakeBackplane();
    const { hub, local } = harness(bp);
    hub.publish("media:room1", bytes);
    expect(local).to.deep.equal([bytes]);
    expect(local[0]).to.equal(bytes);
    expect(bp.published).to.deep.equal([]);
  });

  it("prévient l'exploitant une seule fois, en nommant le canal et le levier", () => {
    const { hub, notices } = harness();
    hub.publish("media:room1", new Uint8Array([1]));
    hub.publish("media:room1", new Uint8Array([2]));
    expect(notices).to.have.length(1);
    expect(notices[0]).to.contain("media:room1");
    expect(notices[0]).to.contain('codec: "cbor"');
  });

  it("une charge JSON sur le même canal traverse toujours le bus", () => {
    const bp = new FakeBackplane();
    const { hub, notices } = harness(bp);
    hub.publish("media:room1", { text: "bonjour" });
    expect(bp.published).to.deep.equal([
      { channel: "media:room1", payload: { text: "bonjour" } },
    ]);
    expect(notices).to.deep.equal([]);
  });

  it("canal local au serveur : des octets restent locaux sans avertissement", () => {
    const bp = new FakeBackplane();
    const { hub, notices } = harness(bp);
    const got: unknown[] = [];
    hub.subscribe(
      "local:room",
      (p) => got.push(p),
      () => () => {},
    );
    hub.publish("local:room", new Uint8Array([7]));
    expect(got).to.have.length(1);
    expect(bp.published).to.deep.equal([]);
    expect(notices).to.deep.equal([]);
  });

  it("codec binaire posé, backplane incapable : des octets IMBRIQUÉS restent locaux aussi", () => {
    const bp = new FakeBackplane();
    const { hub, notices, local } = harness(bp);
    hub.setFrameCodec(CBOR_FRAME_CODEC);
    const payload = { frame: new Uint8Array([1, 2]) };
    hub.publish("media:room1", payload);
    expect(local).to.deep.equal([payload]);
    expect(bp.published).to.deep.equal([]);
    expect(notices).to.have.length(1);
  });
});

describe("hub — bus binaire armé : les octets traversent", () => {
  it("backplane posé AVANT le codec : armé à la pose du codec", () => {
    const bp = new BytesBackplane();
    const { hub, notices } = harness(bp);
    expect(bp.enabledWith).to.equal(null);
    hub.setFrameCodec(CBOR_FRAME_CODEC);
    expect(bp.enabledWith).to.equal(CBOR_FRAME_CODEC);
    const bytes = new Uint8Array([1, 2, 255]);
    const nested = { seq: 1, frame: bytes };
    hub.publish("media:room1", bytes);
    hub.publish("media:room1", nested);
    expect(bp.published).to.deep.equal([
      { channel: "media:room1", payload: bytes },
      { channel: "media:room1", payload: nested },
    ]);
    // Même objet, pas une copie : le driver encode ce que le hub lui confie.
    expect(bp.published[0]?.payload).to.equal(bytes);
    expect(notices).to.deep.equal([]);
  });

  it("codec posé AVANT le backplane : armé à la pose du backplane", () => {
    const hub = new RealtimeHub();
    hub.setFrameCodec(CBOR_FRAME_CODEC);
    const bp = new BytesBackplane();
    hub.setBackplane(bp);
    hub.markBroadcastChannel("media:");
    expect(bp.enabledWith).to.equal(CBOR_FRAME_CODEC);
    hub.publish("media:room1", new Uint8Array([9]));
    expect(bp.published).to.have.length(1);
  });

  it("sans codec binaire, un backplane capable n'est jamais armé", () => {
    const bp = new BytesBackplane();
    const { hub } = harness(bp);
    hub.setFrameCodec();
    expect(bp.enabledWith).to.equal(null);
    hub.publish("media:room1", new Uint8Array([1]));
    expect(bp.published).to.deep.equal([]);
  });

  it("une vue binaire autre qu'un Uint8Array reste locale, même bus armé", () => {
    const bp = new BytesBackplane();
    const { hub, notices, local } = harness(bp);
    hub.setFrameCodec(CBOR_FRAME_CODEC);
    const floats = new Float32Array([1.5]);
    hub.publish("media:room1", floats);
    expect(local).to.deep.equal([floats]);
    expect(bp.published).to.deep.equal([]);
    expect(notices).to.have.length(1);
    expect(notices[0]).to.contain("Uint8Array");
  });
});

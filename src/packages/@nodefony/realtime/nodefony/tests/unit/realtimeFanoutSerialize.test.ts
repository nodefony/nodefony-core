import { describe, it, expect } from "vitest";
import {
  RealtimeHub,
  type ChannelFrame,
} from "../../src/server/RealtimeHub.js";
import { JsonRpcPeer, frameCodecSet, type IFrameCodec } from "nodefony";
import { CBOR_FRAME_CODEC } from "nodefony/cbor";

/**
 * **Fan-out mutualisé (plan S1, ADR-0022 §2)** — sur un canal diffusé, la frame
 * envoyée est IDENTIQUE pour tous les abonnés d'un même codec : l'encoder une fois
 * par abonné revient à refaire N fois le même calcul. Le hub étant agnostique du
 * protocole, c'est l'abonné qui lui fournit la fabrique de frame ; le hub construit
 * la frame une fois, et chaque codec l'encode une fois.
 *
 * Ce que ces tests verrouillent :
 *  - la frame est construite UNE fois et encodée UNE fois PAR codec, quel que soit
 *    le nombre d'abonnés ;
 *  - chaque abonné reçoit la trame de SON codec (texte ou octets), jamais celle d'un
 *    autre ;
 *  - la trame reçue est **exactement** celle du chemin non mutualisé ;
 *  - un codec qu'aucun abonné n'utilise n'est jamais appelé ;
 *  - le chemin historique (sink à un seul argument) est intact ;
 *  - une frame non encodable ne casse pas le fan-out — chaque abonné retombe sur
 *    son propre filet.
 */

const TEXT = frameCodecSet().text;

/** Trames reçues par les abonnés — `"NON_MUTUALISE"` quand le hub n'a rien partagé. */
type Out = Array<string | Uint8Array>;

/** Codec qui compte ses encodages, sans rien changer à ce qu'il rend. */
function counting(codec: IFrameCodec): {
  codec: IFrameCodec;
  count: () => number;
} {
  let n = 0;
  return {
    codec: {
      protocol: codec.protocol,
      encode(frame: unknown) {
        n += 1;
        return codec.encode(frame);
      },
      decode: (data) => codec.decode(data),
    },
    count: () => n,
  };
}

/** Fabrique de frame d'un canal, qui compte ses appels. */
function countingBuilder(channel: string): {
  build: (payload: unknown) => unknown;
  count: () => number;
} {
  let n = 0;
  return {
    build: (payload) => {
      n += 1;
      return JsonRpcPeer.buildNotification(channel, payload);
    },
    count: () => n,
  };
}

/** Abonne un sink qui écrit, comme le contrôleur, la trame de SON codec. */
function subscribeWith(
  hub: RealtimeHub,
  codec: IFrameCodec,
  build: (payload: unknown) => unknown,
  out: Out,
): void {
  hub.subscribe(
    "chat:room",
    (_p, frame?: ChannelFrame) =>
      out.push(frame?.encodeFor(codec) ?? "NON_MUTUALISE"),
    () => () => {},
    build,
  );
}

describe("Fan-out — frame construite une fois, encodée une fois PAR codec", () => {
  it("N abonnés du même codec ⇒ UNE construction, UN encodage", () => {
    const hub = new RealtimeHub();
    const text = counting(TEXT);
    const binary = counting(CBOR_FRAME_CODEC);
    const builder = countingBuilder("chat:room");
    const out: Out = [];
    for (let i = 0; i < 3; i++)
      subscribeWith(hub, text.codec, builder.build, out);

    hub.publish("chat:room", { v: 1 });

    expect(out).to.have.lengthOf(3);
    expect(builder.count()).to.equal(1);
    expect(text.count()).to.equal(1); // le cœur du plan S1
    expect(binary.count()).to.equal(0); // paresseux : aucun abonné CBOR
  });

  it("abonnés texte ET CBOR ⇒ deux encodages, chacun reçoit la trame de son codec", () => {
    const hub = new RealtimeHub();
    const text = counting(TEXT);
    const binary = counting(CBOR_FRAME_CODEC);
    const builder = countingBuilder("chat:room");
    const textOut: Out = [];
    const binOut: Out = [];
    // Entrelacés : l'ordre d'arrivée ne doit rien changer au compte.
    subscribeWith(hub, text.codec, builder.build, textOut);
    subscribeWith(hub, binary.codec, builder.build, binOut);
    subscribeWith(hub, text.codec, builder.build, textOut);
    subscribeWith(hub, binary.codec, builder.build, binOut);

    const payload = { msg: "hello", n: 42, data: new Uint8Array([0, 255]) };
    hub.publish("chat:room", payload);

    expect(builder.count()).to.equal(1);
    expect(text.count()).to.equal(1);
    expect(binary.count()).to.equal(1);
    const frame = JsonRpcPeer.buildNotification("chat:room", payload);
    // Exactement ce que le pair de chaque connexion aurait écrit via `notify`.
    expect(textOut).to.deep.equal([TEXT.encode(frame), TEXT.encode(frame)]);
    expect(binOut).to.have.lengthOf(2);
    for (const raw of binOut) {
      expect(raw).to.be.instanceOf(Uint8Array);
      expect([...(raw as Uint8Array)]).to.deep.equal([
        ...(CBOR_FRAME_CODEC.encode(frame) as Uint8Array),
      ]);
    }
  });

  it("un seul abonné ⇒ pas de mutualisation (on ne paie pas ce qui ne sert à rien)", () => {
    const hub = new RealtimeHub();
    const builder = countingBuilder("chat:room");
    const out: Out = [];
    subscribeWith(hub, TEXT, builder.build, out);

    hub.publish("chat:room", { a: 1 });

    expect(out).to.deep.equal(["NON_MUTUALISE"]); // l'abonné encode lui-même
    expect(builder.count()).to.equal(0);
  });

  it("CONTRÔLE — canal SANS fabrique de frame : le chemin historique est intact", () => {
    const hub = new RealtimeHub();
    const recus: unknown[] = [];
    // Sink à un seul argument, tel qu'écrit avant le plan S1.
    hub.subscribe(
      "stats:cpu",
      (p) => recus.push(p),
      () => () => {},
    );
    hub.subscribe(
      "stats:cpu",
      (p) => recus.push(p),
      () => () => {},
    );

    hub.publish("stats:cpu", { load: 0.5 });

    expect(recus).to.deep.equal([{ load: 0.5 }, { load: 0.5 }]);
  });

  it("frame NON encodable : le fan-out tient, un seul essai par codec, chaque abonné garde son filet", () => {
    const hub = new RealtimeHub();
    const text = counting(TEXT);
    const builder = countingBuilder("chat:room");
    const out: Out = [];
    const cyclique: Record<string, unknown> = {};
    cyclique.self = cyclique; // l'encodage lève
    for (let i = 0; i < 3; i++)
      subscribeWith(hub, text.codec, builder.build, out);

    expect(() => hub.publish("chat:room", cyclique)).to.not.throw();
    // Pas de trame mutualisée → chacun retombe sur son propre chemin (qui log et
    // répond une erreur), exactement comme avant le plan S1 ; l'échec n'est pas
    // retenté pour chaque abonné.
    expect(out).to.deep.equal([
      "NON_MUTUALISE",
      "NON_MUTUALISE",
      "NON_MUTUALISE",
    ]);
    expect(text.count()).to.equal(1);
  });

  it("un troisième codec reste servi, sans mise en cache", () => {
    const hub = new RealtimeHub();
    const a = counting(TEXT);
    const b = counting(CBOR_FRAME_CODEC);
    const c = counting(TEXT);
    const builder = countingBuilder("chat:room");
    const out: Out = [];
    for (const codec of [a.codec, b.codec, c.codec, c.codec])
      subscribeWith(hub, codec, builder.build, out);

    hub.publish("chat:room", { v: 3 });

    expect(out.every((raw) => raw !== "NON_MUTUALISE")).to.equal(true);
    expect([a.count(), b.count(), c.count()]).to.deep.equal([1, 1, 2]);
  });
});

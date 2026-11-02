import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { IRealtimeSocket } from "nodefony";

/** Canal sur lequel l'AUTRE côté émet, et que la socket éprouvée reçoit. */
export const CONFORMANCE_IN = "conformance:in";
/** Canal sur lequel la socket éprouvée publie, et que l'autre côté observe. */
export const CONFORMANCE_OUT = "conformance:out";

/**
 * Ce qu'une implémentation d'`IRealtimeSocket` fournit à la suite : la socket,
 * et les deux gestes de l'AUTRE côté du fil — émettre vers elle, observer ce
 * qu'elle publie. La suite ne connaît rien d'autre : c'est ce qui la rend unique.
 */
export interface ISocketConformanceHarness {
  /** La socket éprouvée, vue par son seul contrat commun. */
  readonly socket: IRealtimeSocket;
  /** L'autre côté émet `payload` sur `channel` (serveur pour le client, autre service pour le serveur). */
  deliver(channel: string, payload: object): void;
  /** Charges que l'autre côté a reçues de `socket.publish` sur {@link CONFORMANCE_OUT}. */
  readonly published: unknown[];
  /** Laisse les trames traverser le fil. */
  settle(): Promise<void>;
  /** Libère la socket et son décor. */
  dispose(): void;
}

/**
 * Suite de conformité UNIQUE du contrat `IRealtimeSocket` (ADR-0022 §10) :
 * le même comportement, joué contre chaque implémentation. Une implémentation
 * qui diverge rougit ICI, sous le nom du cas — jamais plus tard chez
 * l'utilisateur qui passe un code du navigateur au serveur.
 *
 * `request` n'y figure pas : il est hors du contrat commun.
 *
 * @param label - nom de l'implémentation, affiché dans chaque titre
 * @param make - fabrique d'un décor neuf, appelée avant chaque cas
 */
export function describeSocketConformance(
  label: string,
  make: () => Promise<ISocketConformanceHarness>,
): void {
  describe(`IRealtimeSocket — conformité : ${label}`, () => {
    let h: ISocketConformanceHarness;
    beforeEach(async () => {
      h = await make();
    });
    afterEach(() => h.dispose());

    /** Abonne la socket à {@link CONFORMANCE_IN} et attend que l'abonnement soit posé. */
    async function subscribed(): Promise<void> {
      h.socket.subscribe(CONFORMANCE_IN);
      await h.settle();
    }

    /** Fait émettre l'autre côté, puis attend la livraison. */
    async function deliver(payload: object): Promise<void> {
      h.deliver(CONFORMANCE_IN, payload);
      await h.settle();
    }

    it("subscribe + on : reçoit la charge émise par l'autre côté", async () => {
      const got: unknown[] = [];
      h.socket.on(CONFORMANCE_IN, (p) => got.push(p));
      await subscribed();
      await deliver({ v: 1 });
      expect(got).to.deep.equal([{ v: 1 }]);
    });

    it("on SANS subscribe : ne reçoit rien", async () => {
      const got: unknown[] = [];
      h.socket.on(CONFORMANCE_IN, (p) => got.push(p));
      await h.settle();
      await deliver({ v: 1 });
      expect(got).to.deep.equal([]);
    });

    it("plusieurs handlers reçoivent tous ; off et le dispose rendu par on en retirent chacun un", async () => {
      const a: unknown[] = [];
      const b: unknown[] = [];
      const c: unknown[] = [];
      const ha = (p: unknown): void => void a.push(p);
      h.socket.on(CONFORMANCE_IN, ha);
      const disposeB = h.socket.on(CONFORMANCE_IN, (p) => b.push(p));
      h.socket.on(CONFORMANCE_IN, (p) => c.push(p));
      await subscribed();
      await deliver({ n: 1 });
      h.socket.off(CONFORMANCE_IN, ha);
      disposeB();
      await deliver({ n: 2 });
      expect(a).to.deep.equal([{ n: 1 }]);
      expect(b).to.deep.equal([{ n: 1 }]);
      expect(c).to.deep.equal([{ n: 1 }, { n: 2 }]);
    });

    it("un handler qui lève n'empêche pas les suivants de recevoir", async () => {
      const got: unknown[] = [];
      h.socket.on(CONFORMANCE_IN, () => {
        throw new Error("handler fautif");
      });
      h.socket.on(CONFORMANCE_IN, (p) => got.push(p));
      await subscribed();
      await deliver({ v: 2 });
      expect(got).to.deep.equal([{ v: 2 }]);
    });

    it("wildcard « * » : reçoit (canal, charge)", async () => {
      const seen: Array<[unknown, unknown]> = [];
      h.socket.on("*", (...args: unknown[]) => {
        seen.push([args[0], args[1]]);
      });
      await subscribed();
      await deliver({ w: 1 });
      expect(seen).to.deep.include([CONFORMANCE_IN, { w: 1 }]);
    });

    it("subscribe ref-compté : la réception s'arrête au DERNIER unsubscribe, pas avant", async () => {
      const got: unknown[] = [];
      h.socket.on(CONFORMANCE_IN, (p) => got.push(p));
      h.socket.subscribe(CONFORMANCE_IN);
      await subscribed();
      expect(h.socket.subscribedChannels).to.deep.equal([CONFORMANCE_IN]);
      h.socket.unsubscribe(CONFORMANCE_IN);
      await h.settle();
      expect(h.socket.subscribedChannels).to.deep.equal([CONFORMANCE_IN]);
      await deliver({ n: 1 });
      h.socket.unsubscribe(CONFORMANCE_IN);
      await h.settle();
      expect(h.socket.subscribedChannels).to.deep.equal([]);
      await deliver({ n: 2 });
      expect(got).to.deep.equal([{ n: 1 }]);
    });

    it("unsubscribe d'un canal non suivi : sans effet", async () => {
      await subscribed();
      expect(() => h.socket.unsubscribe("conformance:inconnu")).not.to.throw();
      expect(h.socket.subscribedChannels).to.deep.equal([CONFORMANCE_IN]);
    });

    it("statistiques : comptent les charges reçues par canal ; undefined pour un canal jamais reçu", async () => {
      h.socket.on(CONFORMANCE_IN, () => undefined);
      await subscribed();
      await deliver({ s: 1 });
      await deliver({ s: 2 });
      const st = h.socket.getChannelStats(CONFORMANCE_IN);
      expect(st?.method).to.equal(CONFORMANCE_IN);
      expect(st?.msgCount).to.equal(2);
      expect(h.socket.getChannelStats("conformance:jamais")).to.equal(
        undefined,
      );
      expect(h.socket.getStats().map((s) => s.method)).to.include(
        CONFORMANCE_IN,
      );
    });

    it("publish : l'autre côté reçoit la charge", async () => {
      h.socket.publish(CONFORMANCE_OUT, { out: 1 });
      await h.settle();
      expect(h.published).to.deep.equal([{ out: 1 }]);
    });

    it("publish d'un scalaire : TypeError, rien n'est émis", async () => {
      // Une charge scalaire n'a pas de type à la compilation sur un canal non
      // contractuel : c'est la garde d'exécution qui est éprouvée.
      const scalar: unknown = 42;
      expect(() =>
        h.socket.publish(CONFORMANCE_OUT, scalar as object),
      ).to.throw(TypeError);
      await h.settle();
      expect(h.published).to.deep.equal([]);
    });

    it("channel() : open + on reçoit, send publie, close détache et désabonne", async () => {
      const got: unknown[] = [];
      const inbound = h.socket.channel(CONFORMANCE_IN);
      expect(inbound.name).to.equal(CONFORMANCE_IN);
      inbound.on((p) => got.push(p));
      inbound.open();
      await h.settle();
      await deliver({ c: 1 });
      h.socket.channel(CONFORMANCE_OUT).send({ c: 2 });
      await h.settle();
      inbound.close();
      await h.settle();
      expect(h.socket.subscribedChannels).to.deep.equal([]);
      await deliver({ c: 3 });
      expect(got).to.deep.equal([{ c: 1 }]);
      expect(h.published).to.deep.equal([{ c: 2 }]);
    });

    it("channel().send d'un scalaire : TypeError, comme publish", async () => {
      const scalar: unknown = "texte";
      expect(() =>
        h.socket.channel(CONFORMANCE_OUT).send(scalar as object),
      ).to.throw(TypeError);
      await h.settle();
      expect(h.published).to.deep.equal([]);
    });
  });
}

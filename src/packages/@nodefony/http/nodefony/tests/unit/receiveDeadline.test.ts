/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiveDeadline } from "../../src/servers/receiveDeadline";

/**
 * L'échéance de réception HTTP/2 (#765) : une borne ABSOLUE, tenue par UN
 * balayage — jamais un minuteur par requête. Minuteurs simulés : le temps est
 * celui que le test fait passer, et le nombre de minuteurs armés se compte.
 */
describe("ReceiveDeadline — échéance absolue sans minuteur par réception (#765)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aucun minuteur avant la première réception, UN seul ensuite, arrêté quand tout est libéré", () => {
    const deadline = new ReceiveDeadline<object>(3000, () => undefined);
    expect(deadline.running).to.equal(false);
    expect(vi.getTimerCount()).to.equal(0);
    const a = {};
    const b = {};
    const seqA = deadline.track(a);
    const seqB = deadline.track(b);
    expect(vi.getTimerCount()).to.equal(1);
    deadline.release(seqA, a);
    deadline.release(seqB, b);
    // Le tour qui suit la charge garde son minuteur ; le premier tour sans
    // réception nouvelle l'arrête.
    vi.advanceTimersByTime(2000);
    expect(deadline.running).to.equal(false);
    expect(vi.getTimerCount()).to.equal(0);
  });

  it("n'expire JAMAIS avant le délai configuré, et au plus une période après", () => {
    const expired: object[] = [];
    const deadline = new ReceiveDeadline<object>(3000, (item) =>
      expired.push(item),
    );
    const a = {};
    deadline.track(a);
    vi.advanceTimersByTime(3000);
    expect(expired).to.have.length(0);
    vi.advanceTimersByTime(1000);
    expect(expired).to.have.length(1);
    expect(expired[0]).to.equal(a);
    // Plus rien à suivre : le balayage s'arrête au premier tour de repos.
    vi.advanceTimersByTime(1000);
    expect(deadline.running).to.equal(false);
  });

  it("une réception libérée à temps n'expire pas", () => {
    const onExpire = vi.fn();
    const deadline = new ReceiveDeadline<object>(3000, onExpire);
    const a = {};
    const seq = deadline.track(a);
    vi.advanceTimersByTime(2000);
    deadline.release(seq, a);
    vi.advanceTimersByTime(10_000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("expire dans l'ordre d'arrivée ; le balayage s'arrête à la première entrée vivante", () => {
    const expired: object[] = [];
    const deadline = new ReceiveDeadline<object>(3000, (item) =>
      expired.push(item),
    );
    const a = {};
    const b = {};
    deadline.track(a);
    vi.advanceTimersByTime(2000);
    deadline.track(b);
    vi.advanceTimersByTime(2000);
    expect(expired).to.deep.equal([a]);
    vi.advanceTimersByTime(2000);
    expect(expired).to.have.length(2);
    expect(expired[1]).to.equal(b);
  });

  it("une case libérée DERRIÈRE une entrée vivante est balayée sans expirer", () => {
    const expired: object[] = [];
    const deadline = new ReceiveDeadline<object>(3000, (item) =>
      expired.push(item),
    );
    const live = {};
    const done = {};
    deadline.track(live);
    const seq = deadline.track(done);
    deadline.release(seq, done);
    vi.advanceTimersByTime(4000);
    expect(expired).to.have.length(1);
    expect(expired[0]).to.equal(live);
    expect(deadline.size).to.equal(0);
  });

  it("croît sans perdre ni mélanger ses entrées, puis revient à sa capacité de départ", () => {
    const expired: number[] = [];
    const deadline = new ReceiveDeadline<{ n: number }>(1000, (item) =>
      expired.push(item.n),
    );
    const items = Array.from({ length: 200 }, (_, n) => ({ n }));
    const seqs = items.map((item) => deadline.track(item));
    expect(deadline.capacity).to.be.at.least(200);
    // Libération APRÈS la croissance : chaque numéro retrouve son entrée.
    items.forEach((item, i) => {
      if (item.n % 2 === 1) deadline.release(seqs[i] ?? -1, item);
    });
    vi.advanceTimersByTime(2000);
    expect(expired).to.deep.equal(
      items.filter((item) => item.n % 2 === 0).map((item) => item.n),
    );
    // Rendue au premier tour de REPOS seulement.
    vi.advanceTimersByTime(1000);
    expect(deadline.capacity).to.equal(64);
    expect(deadline.running).to.equal(false);
  });

  it("sous charge continue, ni rétrécie ni réarmée d'un tour à l'autre (aucun churn)", () => {
    const deadline = new ReceiveDeadline<object>(30_000, () => undefined);
    // Trois secondes de charge : 300 réceptions par seconde, toutes reçues.
    for (let second = 0; second < 3; second++) {
      for (let i = 0; i < 300; i++) {
        const item = {};
        deadline.release(deadline.track(item), item);
      }
      vi.advanceTimersByTime(1000);
      // Vidé par le tour, mais capacité ET minuteur gardés : le tour suivant
      // n'aura ni à recroître ni à réarmer.
      expect(deadline.size).to.equal(0);
      expect(deadline.capacity).to.equal(512);
      expect(vi.getTimerCount()).to.equal(1);
    }
  });

  it("un numéro PÉRIMÉ ne libère pas la réception qui occupe désormais sa case", () => {
    const expired: object[] = [];
    const deadline = new ReceiveDeadline<object>(1000, (item) =>
      expired.push(item),
    );
    const first = {};
    const staleSeq = deadline.track(first);
    vi.advanceTimersByTime(2000); // `first` expire, l'anneau se vide et repart de 0
    const second = {};
    expect(deadline.track(second)).to.equal(staleSeq);
    deadline.release(staleSeq, first); // l'appelant de `first` libère en retard
    vi.advanceTimersByTime(2000);
    expect(expired).to.have.length(2);
    expect(expired[1]).to.equal(second);
  });

  it("close() arrête le balayage et oublie tout", () => {
    const onExpire = vi.fn();
    const deadline = new ReceiveDeadline<object>(1000, onExpire);
    deadline.track({});
    deadline.close();
    expect(vi.getTimerCount()).to.equal(0);
    vi.advanceTimersByTime(5000);
    expect(onExpire).not.toHaveBeenCalled();
    expect(deadline.size).to.equal(0);
  });

  it("refuse un délai ou une période qui n'est pas un entier positif", () => {
    expect(() => new ReceiveDeadline(0, () => undefined)).to.throw(RangeError);
    expect(() => new ReceiveDeadline(1.5, () => undefined)).to.throw(
      RangeError,
    );
    expect(() => new ReceiveDeadline(1000, () => undefined, 0)).to.throw(
      RangeError,
    );
  });
});

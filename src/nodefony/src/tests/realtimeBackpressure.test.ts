import { expect } from "vitest";
import { decideBackpressure, nextDropBalance } from "../realtime/backpressure";

/**
 * Règle UNIQUE de contre-pression (ADR-0022 §5 C1) : un verdict par cas, et le
 * solde qui monte au refus et redescend à l'envoi.
 */
describe("decideBackpressure — la règle pure du cœur", () => {
  it("send : borne désactivée, ou niveau sous la borne", () => {
    expect(decideBackpressure(1e9, 0, "drop", 5, 0)).to.equal("send");
    expect(decideBackpressure(100, 100, "drop", 5, 0)).to.equal("send");
    // Un solde élevé ne ferme pas une frame qui passe.
    expect(decideBackpressure(10, 100, "drop", 5, 99)).to.equal("send");
  });

  it("drop : au-delà de la borne, solde sous le seuil de fermeture", () => {
    expect(decideBackpressure(101, 100, "drop", 5, 0)).to.equal("drop");
    expect(decideBackpressure(101, 100, "drop", 5, 3)).to.equal("drop");
    // `0` = ne jamais fermer sur solde.
    expect(decideBackpressure(101, 100, "drop", 0, 1e6)).to.equal("drop");
  });

  it("close : politique close au premier dépassement, ou solde atteint", () => {
    expect(decideBackpressure(101, 100, "close", 0, 0)).to.equal("close");
    // Le refus qui porterait le solde à 5 ferme.
    expect(decideBackpressure(101, 100, "drop", 5, 4)).to.equal("close");
  });

  it("le solde monte de 1 par refus et DÉCROÎT de 1 par envoi, plancher 0", () => {
    let balance = 0;
    balance = nextDropBalance("drop", balance);
    balance = nextDropBalance("drop", balance);
    balance = nextDropBalance("close", balance);
    expect(balance).to.equal(3);
    balance = nextDropBalance("send", balance);
    expect(balance).to.equal(2);
    expect(nextDropBalance("send", 0)).to.equal(0);
  });
});

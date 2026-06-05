import { expect } from "chai";
import { closeCodeToNotice } from "../client/realtime/notice";

describe("RealtimeClient — closeCodeToNotice (pendant client de toWsCloseCode)", () => {
  it("fermetures propres/attendues → null (pas de bruit)", () => {
    expect(closeCodeToNotice(1000)).to.equal(null);
    expect(closeCodeToNotice(1001)).to.equal(null);
  });

  it("1006 (abnormal) → warning « connexion perdue »", () => {
    const n = closeCodeToNotice(1006);
    expect(n).to.not.equal(null);
    expect(n!.level).to.equal("warning");
    expect(n!.source).to.equal("realtime");
    expect(n!.code).to.equal(1006);
    expect(n!.message).to.equal("Connexion temps réel perdue");
    expect(n!.ts).to.be.a("number");
  });

  it("1008 (policy = auth/forbidden serveur) → error refusé", () => {
    const n = closeCodeToNotice(1008);
    expect(n!.level).to.equal("error");
    expect(n!.message).to.equal("Accès temps réel refusé");
  });

  it("1009 (too big) → warning payload", () => {
    const n = closeCodeToNotice(1009);
    expect(n!.level).to.equal("warning");
    expect(n!.message).to.equal("Message temps réel trop volumineux");
  });

  it("1011 (server error) → error serveur", () => {
    const n = closeCodeToNotice(1011);
    expect(n!.level).to.equal("error");
    expect(n!.message).to.equal("Erreur serveur temps réel");
  });

  it("4004 (code privé Nodefony = 4xx applicatif) → error introuvable", () => {
    const n = closeCodeToNotice(4004);
    expect(n!.level).to.equal("error");
    expect(n!.message).to.equal("Ressource temps réel introuvable");
  });

  it("1002 (protocole) → error", () => {
    expect(closeCodeToNotice(1002)!.level).to.equal("error");
  });

  it("code inconnu (3001) → warning générique avec le code", () => {
    const n = closeCodeToNotice(3001);
    expect(n!.level).to.equal("warning");
    expect(n!.message).to.contain("3001");
  });

  it("code absent → warning sans code", () => {
    const n = closeCodeToNotice(undefined);
    expect(n!.level).to.equal("warning");
    expect(n!.message).to.equal("Connexion temps réel fermée");
    expect(n!.code).to.equal(undefined);
  });

  it("reason non vide est ajoutée au message", () => {
    const n = closeCodeToNotice(4004, "Not Found");
    expect(n!.message).to.equal("Ressource temps réel introuvable : Not Found");
  });

  it("reason blanche est ignorée (pas de séparateur vide)", () => {
    const n = closeCodeToNotice(1011, "   ");
    expect(n!.message).to.equal("Erreur serveur temps réel");
  });
});

import { expect } from "chai";
import {
  closeCodeToNotice,
  deniedToNotice,
  isReconnectableCloseCode,
} from "../client/realtime/notice";

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

  it("1003 (type non supporté) → error", () => {
    const n = closeCodeToNotice(1003);
    expect(n!.level).to.equal("error");
    expect(n!.message).to.equal("Données temps réel non supportées");
  });

  it("1007 (trame invalide) → error", () => {
    const n = closeCodeToNotice(1007);
    expect(n!.level).to.equal("error");
    expect(n!.message).to.equal("Trame temps réel invalide");
  });

  it("1010 (extension manquante) → error", () => {
    const n = closeCodeToNotice(1010);
    expect(n!.level).to.equal("error");
    expect(n!.message).to.equal("Extension temps réel requise manquante");
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

describe("RealtimeClient — deniedToNotice (refus de canal, pendant FRAME)", () => {
  it("produit TOUJOURS une notice error (≠ close-code qui peut être null)", () => {
    const n = deniedToNotice({ channel: "admin:metrics", reason: "forbidden" });
    expect(n.level).to.equal("error");
    expect(n.source).to.equal("realtime");
    expect(n.message).to.contain("admin:metrics");
    expect(n.ts).to.be.a("number");
  });

  it("message générique : ne révèle JAMAIS le rôle/scope manquant (Zero Trust)", () => {
    const n = deniedToNotice({ channel: "syslog:stream", reason: "forbidden" });
    expect(n.message).to.not.match(/ROLE_|scope/i);
  });
});

describe("RealtimeClient — isReconnectableCloseCode (respect sémantique RFC 6455)", () => {
  it("codes DÉFINITIFS → false (pas de reco : la cause ne disparaît pas)", () => {
    // 1008 = policy (401/403) : le cas central — un anonyme ne doit pas marteler.
    for (const code of [1000, 1002, 1003, 1007, 1008, 1010, 4004]) {
      expect(isReconnectableCloseCode(code), `code ${code}`).to.equal(false);
    }
  });

  it("codes TRANSITOIRES → true (perte réseau, restart, erreur serveur)", () => {
    for (const code of [1001, 1006, 1009, 1011, 1012, 1013]) {
      expect(isReconnectableCloseCode(code), `code ${code}`).to.equal(true);
    }
  });

  it("code absent ou inconnu → true (anormal → on retente)", () => {
    expect(isReconnectableCloseCode(undefined)).to.equal(true);
    expect(isReconnectableCloseCode(3001)).to.equal(true);
  });
});

/**
 * La famille d'un statut d'accès — la seule lecture, partagée par la console
 * du serveur, les Journaux du Studio et la barre de débogage. Un code de
 * fermeture WebSocket (RFC 6455 §7.4) ne doit pas passer pour une erreur
 * serveur à quatre chiffres.
 */
import { describe, expect, it } from "vitest";
import {
  accessStatusFamily,
  findAccessLine,
} from "../syslog/drivers/pduConsole";

describe("accessStatusFamily", () => {
  it("un statut HTTP garde sa centaine", () => {
    expect(accessStatusFamily(101)).toBe(1);
    expect(accessStatusFamily(204)).toBe(2);
    expect(accessStatusFamily(304)).toBe(3);
    expect(accessStatusFamily(404)).toBe(4);
    expect(accessStatusFamily(503)).toBe(5);
  });

  it("🔴 fermeture normale, départ ou sans code : succès", () => {
    expect(accessStatusFamily(1000)).toBe(2);
    expect(accessStatusFamily(1001)).toBe(2);
    expect(accessStatusFamily(1005)).toBe(2);
  });

  it("coupure anormale et défaillance du serveur : 5", () => {
    expect(accessStatusFamily(1006)).toBe(5);
    expect(accessStatusFamily(1011)).toBe(5);
    expect(accessStatusFamily(1014)).toBe(5);
  });

  it("protocole, politique, taille ou code applicatif : 4", () => {
    expect(accessStatusFamily(1002)).toBe(4);
    expect(accessStatusFamily(1008)).toBe(4);
    expect(accessStatusFamily(1009)).toBe(4);
    expect(accessStatusFamily(4001)).toBe(4);
  });

  it("statut inconnu : null", () => {
    expect(accessStatusFamily(null)).toBe(null);
  });
});

describe("findAccessLine", () => {
  const line = (
    uid: number,
    payload: string,
    timeStamp: number,
    requestId?: string,
  ) => ({
    uid,
    msgid: "req",
    payload,
    timeStamp,
    ...(requestId === undefined ? {} : { requestId }),
  });

  it("🔴 retient le même verbe et le même chemin, au plus près de l'instant", () => {
    const rows = [
      line(1, "WS   1000 wss://h/rt  0.8ms 127.0.0.1 [a]", 1_000, "avant"),
      line(2, "WS   1000 wss://h/rt  0.9ms 127.0.0.1 [b]", 5_010, "bonne"),
      line(3, "GET  200 https://h/rt 2ms 127.0.0.1 [c]", 5_000, "http"),
      line(4, "WS   1000 wss://h/autre  1ms 127.0.0.1 [d]", 5_000, "autre"),
    ];
    expect(findAccessLine(rows, "WS", "/rt", 5_000)?.requestId).toBe("bonne");
    expect(findAccessLine(rows, "GET", "/rt", 5_000)?.requestId).toBe("http");
  });

  it("une ligne sans requestId ne se retient pas", () => {
    const rows = [line(1, "GET  200 https://h/ 2ms", 0)];
    expect(findAccessLine(rows, "GET", "/", 0)).toBe(null);
  });
});

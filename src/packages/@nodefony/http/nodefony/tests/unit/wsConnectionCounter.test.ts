/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { WsConnectionCounter } from "../../src/rateLimit/WsConnectionCounter";

/**
 * F6c (revue 0.6) — backstop opt-in du cap de connexions WS concurrentes par IP.
 * Compteur PAR PROCESS (le plafond global/IP reste délégué à l'ingress). On vérifie
 * l'invariant essentiel : acquire réussit sous le plafond, échoue au plafond, et
 * release rend le créneau ; la Map se vide quand une IP n'a plus de socket.
 */
describe("WsConnectionCounter — cap concurrent par IP (par-process)", () => {
  it("acquiert sous le plafond, refuse au plafond", () => {
    const c = new WsConnectionCounter(2);
    expect(c.tryAcquire("1.1.1.1")).toBe(true);
    expect(c.tryAcquire("1.1.1.1")).toBe(true);
    expect(c.tryAcquire("1.1.1.1")).toBe(false); // 3ᵉ → au plafond
    expect(c.rejectedTotal).toBe(1);
  });

  it("release rend un créneau → une nouvelle connexion repasse", () => {
    const c = new WsConnectionCounter(1);
    expect(c.tryAcquire("1.1.1.1")).toBe(true);
    expect(c.tryAcquire("1.1.1.1")).toBe(false); // plafond 1
    c.release("1.1.1.1");
    expect(c.tryAcquire("1.1.1.1")).toBe(true); // créneau libéré
  });

  it("compte chaque IP indépendamment (une IP saturée n'affecte pas les autres)", () => {
    const c = new WsConnectionCounter(1);
    expect(c.tryAcquire("1.1.1.1")).toBe(true);
    expect(c.tryAcquire("1.1.1.1")).toBe(false);
    expect(c.tryAcquire("2.2.2.2")).toBe(true); // autre IP intacte
  });

  it("la Map se vide quand une IP n'a plus de socket (auto-bornée, pas de GC)", () => {
    const c = new WsConnectionCounter(4);
    c.tryAcquire("a");
    c.tryAcquire("a");
    c.tryAcquire("b");
    expect(c.trackedIps).toBe(2);
    c.release("a");
    expect(c.trackedIps).toBe(2); // "a" a encore 1 socket
    c.release("a");
    expect(c.trackedIps).toBe(1); // "a" retombé à 0 → retiré
    c.release("b");
    expect(c.trackedIps).toBe(0);
  });

  it("release d'une IP inconnue est sans effet (safe : close après reconfiguration)", () => {
    const c = new WsConnectionCounter(2);
    c.release("jamais-vue"); // no-op, ne throw pas, ne descend pas sous 0
    expect(c.trackedIps).toBe(0);
    expect(c.tryAcquire("jamais-vue")).toBe(true);
  });

  it("état vierge : 0 IP suivie, 0 rejet, Map lazy", () => {
    const c = new WsConnectionCounter(10);
    expect(c.trackedIps).toBe(0);
    expect(c.rejectedTotal).toBe(0);
    expect(c.max).toBe(10);
  });
});

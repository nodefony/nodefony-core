/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { MemoryRateLimitStore } from "../../src/rateLimit/MemoryRateLimitStore";

/** Horloge contrôlable → test déterministe (jamais la vraie `Date.now`). */
function clock(start = 1_000_000) {
  let t = start;
  return {
    now: (): number => t,
    advance: (ms: number): void => {
      t += ms;
    },
  };
}

const OPTS = { windowMs: 1000, max: 3, maxTracked: 100 };

describe("MemoryRateLimitStore — fenêtre fixe", () => {
  it("autorise sous le plafond et décompte le restant", () => {
    const c = clock();
    const store = new MemoryRateLimitStore(OPTS, c.now);
    const v1 = store.hit("1.1.1.1");
    expect(v1.limited).toBe(false);
    expect(v1.limit).toBe(3);
    expect(v1.remaining).toBe(2);
    expect(v1.retryAfterS).toBe(0);
    expect(store.hit("1.1.1.1").remaining).toBe(1);
    expect(store.hit("1.1.1.1").remaining).toBe(0);
  });

  it("rejette (429) au-delà du plafond, Retry-After ≥ 1", () => {
    const c = clock();
    const store = new MemoryRateLimitStore(OPTS, c.now);
    store.hit("1.1.1.1");
    store.hit("1.1.1.1");
    store.hit("1.1.1.1");
    const v = store.hit("1.1.1.1"); // 4ᵉ → dépasse max=3
    expect(v.limited).toBe(true);
    expect(v.remaining).toBe(0);
    expect(v.retryAfterS).toBeGreaterThanOrEqual(1);
    expect(store.rejectedTotal).toBe(1);
  });

  it("réinitialise le compteur à l'expiration de la fenêtre", () => {
    const c = clock();
    const store = new MemoryRateLimitStore(OPTS, c.now);
    store.hit("1.1.1.1");
    store.hit("1.1.1.1");
    store.hit("1.1.1.1");
    expect(store.hit("1.1.1.1").limited).toBe(true);
    c.advance(1000); // fenêtre expirée
    const v = store.hit("1.1.1.1");
    expect(v.limited).toBe(false);
    expect(v.remaining).toBe(2); // repart à neuf
  });

  it("resetAtMs pointe la fin de la fenêtre courante", () => {
    const c = clock(5_000_000);
    const store = new MemoryRateLimitStore(OPTS, c.now);
    expect(store.hit("1.1.1.1").resetAtMs).toBe(5_000_000 + 1000);
  });

  it("Retry-After décroît à mesure qu'on avance dans la fenêtre", () => {
    const c = clock();
    const store = new MemoryRateLimitStore(OPTS, c.now);
    store.hit("1.1.1.1");
    store.hit("1.1.1.1");
    store.hit("1.1.1.1");
    c.advance(600); // 400 ms restants
    const v = store.hit("1.1.1.1");
    expect(v.limited).toBe(true);
    expect(v.retryAfterS).toBe(1); // ⌈400/1000⌉ = 1
  });
});

describe("MemoryRateLimitStore — isolation par clé (anti-contournement)", () => {
  it("compte chaque IP indépendamment (une IP saturée n'affecte pas les autres)", () => {
    const c = clock();
    const store = new MemoryRateLimitStore(OPTS, c.now);
    store.hit("1.1.1.1");
    store.hit("1.1.1.1");
    store.hit("1.1.1.1");
    expect(store.hit("1.1.1.1").limited).toBe(true);
    // Une autre IP démarre intacte.
    const v = store.hit("2.2.2.2");
    expect(v.limited).toBe(false);
    expect(v.remaining).toBe(2);
  });
});

describe("MemoryRateLimitStore — borne mémoire", () => {
  it("état vierge : 0 clé suivie, 0 rejet, gc no-op (Map lazy)", () => {
    const store = new MemoryRateLimitStore(OPTS);
    expect(store.trackedCount).toBe(0);
    expect(store.rejectedTotal).toBe(0);
    expect(store.gc()).toBe(0);
  });

  it("gc() purge les fenêtres expirées et renvoie le nombre purgé", () => {
    const c = clock();
    const store = new MemoryRateLimitStore(OPTS, c.now);
    store.hit("a");
    store.hit("b");
    expect(store.trackedCount).toBe(2);
    c.advance(1000);
    expect(store.gc()).toBe(2);
    expect(store.trackedCount).toBe(0);
  });

  it("évince en FIFO au cap maxTracked (mémoire bornée)", () => {
    const c = clock();
    const store = new MemoryRateLimitStore(
      { windowMs: 100_000, max: 5, maxTracked: 3 },
      c.now,
    );
    store.hit("ip-1");
    store.hit("ip-2");
    store.hit("ip-3");
    expect(store.trackedCount).toBe(3);
    store.hit("ip-4"); // au cap → FIFO évince ip-1 (le plus ancien)
    expect(store.trackedCount).toBe(3);
    // ip-1 a été oublié → redémarre à neuf (preuve de l'éviction).
    expect(store.hit("ip-1").remaining).toBe(4);
  });
});

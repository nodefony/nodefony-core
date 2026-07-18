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

describe("MemoryRateLimitStore — listPage (introspection admin)", () => {
  /** Store peuplé : 5 IP de trafic décroissant, dont 2 au-dessus du plafond. */
  function seeded() {
    const c = clock();
    const store = new MemoryRateLimitStore(
      { windowMs: 100_000, max: 3, maxTracked: 100 },
      c.now,
    );
    // 10.0.0.1 → 5 hits (limité), 10.0.0.2 → 4 (limité), 10.0.0.3 → 3,
    // 192.168.0.1 → 2, 192.168.0.2 → 1.
    for (let i = 0; i < 5; i += 1) store.hit("10.0.0.1");
    for (let i = 0; i < 4; i += 1) store.hit("10.0.0.2");
    for (let i = 0; i < 3; i += 1) store.hit("10.0.0.3");
    for (let i = 0; i < 2; i += 1) store.hit("192.168.0.1");
    store.hit("192.168.0.2");
    return { store, clock: c };
  }

  it("trie par count DESC : la clé la plus bruyante d'abord", async () => {
    const { store } = seeded();
    const page = await store.listPage({ limit: 3 });
    expect(page.items.map((e) => e.key)).toEqual([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
    ]);
    expect(page.items[0].count).toBe(5);
    expect(page.total).toBe(5);
    expect(page.hasNext).toBe(true);
  });

  it("borne : une page ne rend jamais plus que `limit`", async () => {
    const { store } = seeded();
    expect((await store.listPage({ limit: 2 })).items.length).toBe(2);
  });

  it("parcours par offset : 5 clés distinctes, aucune perdue ni doublée", async () => {
    const { store } = seeded();
    const seen = new Set<string>();
    for (let offset = 0; offset < 5; offset += 2) {
      const page = await store.listPage({ limit: 2, offset });
      for (const e of page.items) seen.add(e.key);
    }
    expect(seen.size).toBe(5);
    const last = await store.listPage({ limit: 2, offset: 4 });
    expect(last.items.length).toBe(1);
    expect(last.hasNext).toBe(false);
  });

  it("filtre limited : seulement les clés qui prennent des 429", async () => {
    const { store } = seeded();
    const limited = await store.listPage({ limit: 50, limited: true });
    expect(limited.items.map((e) => e.key)).toEqual(["10.0.0.1", "10.0.0.2"]);
    expect(limited.items.every((e) => e.limited)).toBe(true);
    expect((await store.listPage({ limit: 50, limited: false })).total).toBe(3);
  });

  it("q filtre par PRÉFIXE de clé (sous-réseau), pas par sous-chaîne", async () => {
    const { store } = seeded();
    expect((await store.listPage({ limit: 50, q: "10.0." })).total).toBe(3);
    expect((await store.listPage({ limit: 50, q: "192.168." })).total).toBe(2);
    // "0.1" existe DANS plusieurs clés mais n'en préfixe aucune.
    expect((await store.listPage({ limit: 50, q: "0.1" })).total).toBe(0);
  });

  it("exclut les fenêtres expirées (un compteur mort n'est pas du trafic)", async () => {
    const { store, clock: c } = seeded();
    c.advance(100_001); // toutes les fenêtres sont échues
    const page = await store.listPage({ limit: 50 });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    // `trackedCount` compte encore les entrées : le gc n'est pas passé — c'est
    // bien la LECTURE qui filtre, pas la purge.
    expect(store.trackedCount).toBe(5);
  });

  it("withTotal:false → total omis, hasNext fiable", async () => {
    const { store } = seeded();
    const page = await store.listPage({ limit: 2, withTotal: false });
    expect(page.total).toBeUndefined();
    expect(page.hasNext).toBe(true);
  });

  it("store jamais sollicité → page vide (Map lazy, aucune alloc)", async () => {
    const store = new MemoryRateLimitStore(OPTS, clock().now);
    const page = await store.listPage({ limit: 10 });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.hasNext).toBe(false);
  });
});

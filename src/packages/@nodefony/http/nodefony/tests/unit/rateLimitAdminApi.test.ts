/// <reference types="node" />
import { describe, it, expect } from "vitest";
import type { Module, IAdminEndpoint, IAdminRequest } from "nodefony";
import { createHttpAdminApi } from "../../service/HttpAdminApi";
import { MemoryRateLimitStore } from "../../src/rateLimit/MemoryRateLimitStore";

/**
 * Data plane admin du rate-limit : `GET rate-limit/list`.
 *
 * Enjeu propre à CET endpoint : il lit un compteur qui peut être **désarmé**
 * (rate-limit désactivé = le défaut). Un 503 ferait disparaître la carte de la
 * console alors que l'information « désarmé » est justement ce qu'un admin veut
 * voir. On prouve donc les deux états, et que la pagination est bien SERVEUR.
 */

/** Module minimal : seul `get(name)` est sollicité par les handlers. */
function makeModule(services: Record<string, unknown>): Module {
  return {
    get: (name: string) => services[name],
  } as unknown as Module;
}

function req(query: Record<string, string> = {}): IAdminRequest {
  return {
    params: {},
    query,
    body: null,
    user: { username: "admin1" },
    roles: ["ROLE_NODEFONY_ADMIN"],
  } as unknown as IAdminRequest;
}

function endpointOf(module: Module, path: string): IAdminEndpoint {
  const found = createHttpAdminApi(module)
    .adminEndpoints()
    .find((e) => e.path === path);
  if (!found) throw new Error(`endpoint ${path} introuvable`);
  return found;
}

/** Horloge contrôlable → fenêtres déterministes. */
function clock(start = 1_000_000) {
  let t = start;
  return {
    now: (): number => t,
    advance: (ms: number): void => {
      t += ms;
    },
  };
}

/** HttpKernel dont le rate-limit est ARMÉ, peuplé de 4 IP de trafic décroissant. */
function armedKernel() {
  const c = clock();
  const store = new MemoryRateLimitStore(
    { windowMs: 100_000, max: 3, maxTracked: 100 },
    c.now,
  );
  for (let i = 0; i < 6; i += 1) store.hit("10.0.0.1"); // limitée
  for (let i = 0; i < 4; i += 1) store.hit("10.0.0.2"); // limitée
  for (let i = 0; i < 2; i += 1) store.hit("10.0.0.3");
  store.hit("192.168.0.9");
  return { kernel: { rateLimitStore: store }, store };
}

describe("HttpAdminApi — GET rate-limit/list", () => {
  it("rate-limit DÉSARMÉ : état honnête, jamais une erreur", async () => {
    const module = makeModule({ HttpKernel: { rateLimitStore: null } });
    const res = (await endpointOf(module, "rate-limit/list").handler(
      req(),
    )) as Record<string, unknown>;
    expect(res.enabled).toBe(false);
    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.trackedCount).toBe(0);
  });

  it("service HttpKernel absent du container : même réponse honnête", async () => {
    const res = (await endpointOf(makeModule({}), "rate-limit/list").handler(
      req(),
    )) as Record<string, unknown>;
    expect(res.enabled).toBe(false);
    expect(res.items).toEqual([]);
  });

  it("armé : page triée par compteur décroissant + métriques du store", async () => {
    const { kernel } = armedKernel();
    const res = (await endpointOf(
      makeModule({ HttpKernel: kernel }),
      "rate-limit/list",
    ).handler(req({ limit: "2" }))) as Record<string, unknown>;
    expect(res.enabled).toBe(true);
    expect((res.items as Array<{ key: string }>).map((e) => e.key)).toEqual([
      "10.0.0.1",
      "10.0.0.2",
    ]);
    expect(res.total).toBe(4);
    expect(res.limit).toBe(2);
    expect(res.trackedCount).toBe(4);
    // 6 hits sur une IP à max=3 → 3 rejets ; 4 hits sur une autre → 1 rejet.
    expect(res.rejectedTotal).toBe(4);
  });

  it("?limited=true ne renvoie que les IP qui prennent des 429", async () => {
    const { kernel } = armedKernel();
    const res = (await endpointOf(
      makeModule({ HttpKernel: kernel }),
      "rate-limit/list",
    ).handler(req({ limited: "true" }))) as Record<string, unknown>;
    const items = res.items as Array<{ key: string; limited: boolean }>;
    expect(items.map((e) => e.key)).toEqual(["10.0.0.1", "10.0.0.2"]);
    expect(items.every((e) => e.limited)).toBe(true);
  });

  it("?q filtre par préfixe (sous-réseau) et ?offset pagine côté serveur", async () => {
    const { kernel } = armedKernel();
    const module = makeModule({ HttpKernel: kernel });
    const sub = (await endpointOf(module, "rate-limit/list").handler(
      req({ q: "10.0." }),
    )) as Record<string, unknown>;
    expect(sub.total).toBe(3);

    const second = (await endpointOf(module, "rate-limit/list").handler(
      req({ limit: "2", offset: "2" }),
    )) as Record<string, unknown>;
    expect((second.items as Array<{ key: string }>).map((e) => e.key)).toEqual([
      "10.0.0.3",
      "192.168.0.9",
    ]);
    expect(second.offset).toBe(2);
  });

  it("l'endpoint est réservé à ROLE_NODEFONY_ADMIN (une IP est une donnée personnelle)", () => {
    const endpoint = endpointOf(makeModule({}), "rate-limit/list");
    expect(endpoint.role).toBe("ROLE_NODEFONY_ADMIN");
    expect(endpoint.method).toBe("GET");
  });
});

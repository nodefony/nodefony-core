/**
 * Branchement du stockage de session Redis (#234) : CHARGER le module suffit.
 *
 * Les autres suites construisent `RedisSessionStorage` à la main — elles
 * resteraient vertes si l'enregistrement disparaissait. Celle-ci passe par le
 * point d'entrée du paquet puis par la vraie résolution du service, celle que
 * suit le démarrage : retirer `SessionsService.registerStorage("redis", …)` la
 * fait tomber. Aucun Redis requis — le stockage ne résout son client qu'au
 * premier accès.
 */
import { expect } from "vitest";
import { SessionsService } from "@nodefony/http";
import { RedisSessionStorage } from "../../../index";

/** Service isolé de son constructeur lourd, dans un run de PRODUCTION. */
function productionService(store: string): SessionsService {
  return Object.assign(
    Object.create(SessionsService.prototype) as SessionsService,
    {
      options: { store, idleTimeoutS: 1800 },
      kernel: { environment: "production", on: () => {}, fire: () => {} },
      log: () => {},
      fire: () => {},
    },
  );
}

describe("Stockage de session Redis — branché par le seul chargement du module", () => {
  it('le registre des sessions connaît "redis" et le résout vers RedisSessionStorage', () => {
    expect(SessionsService.storageHandlers()).toContain("redis");
    expect(SessionsService.getStorage("redis")).toBe(RedisSessionStorage);
  });

  it('session.store "redis" installe RedisSessionStorage en production, sans repli', () => {
    const svc = productionService("redis");
    const storage = svc.initializeStorage();
    // Le service décore tout store d'une garde de révocation : le store réel
    // est son `inner`.
    expect(storage).not.toBeNull();
    expect(storage).toHaveProperty("inner");
    expect(Reflect.get(storage ?? {}, "inner")).toBeInstanceOf(
      RedisSessionStorage,
    );
  });
});

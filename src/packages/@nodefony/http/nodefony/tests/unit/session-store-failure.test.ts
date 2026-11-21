/// <reference types="node" />
/**
 * Doctrine d'échec du stockage de session (#234, `docs/guides/persistence.md`
 * § « Doctrine d'échec ») : un store EXPLICITE introuvable avorte le démarrage
 * en production, et bascule en `memory` en le disant en développement.
 *
 * C'est la seule chose qui rend visible un module de stockage oublié (Redis
 * déclaré, `@nodefony/redis` absent) : sans elle, chaque exemplaire garderait
 * ses sessions en mémoire et un déploiement à plusieurs pods déconnecterait
 * ses utilisateurs sans une erreur.
 */
import { expect, vi } from "vitest";
import SessionsService from "../../service/sessions/sessions-service.js";
import MemorySessionStorage from "../../src/session/storage/MemorySessionStorage.js";

/** Service isolé de son constructeur lourd, dans l'environnement voulu. */
function makeService(
  environment: string,
  store: string,
  log: (msg: unknown, severity?: string) => void = () => {},
): SessionsService {
  return Object.assign(
    Object.create(SessionsService.prototype) as SessionsService,
    {
      // `storage: null` : le défaut du champ, qu'`Object.create` ne pose pas.
      storage: null,
      options: { store, idleTimeoutS: 1800 },
      kernel: { environment, on: () => {}, fire: () => {} },
      log,
      fire: () => {},
    },
  );
}

describe("SessionsService — store explicite introuvable", () => {
  it("en production, le démarrage avorte en nommant le store et ceux qui sont enregistrés", () => {
    const svc = makeService("production", "absent-store");
    expect(() => svc.initializeStorage()).toThrow(
      /session store "absent-store" inconnu \(enregistrés : [^)]*memory[^)]*\).*boot avorté/,
    );
    expect(svc.storage).toBeNull();
  });

  it("en développement, il bascule en memory et l'annonce par un WARNING", () => {
    const log = vi.fn();
    const svc = makeService("development", "absent-store", log);
    const storage = svc.initializeStorage();
    expect(Reflect.get(storage ?? {}, "inner")).toBeInstanceOf(
      MemorySessionStorage,
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /session store "absent-store" inconnu.*repli "memory"/,
      ),
      "WARNING",
    );
  });
});

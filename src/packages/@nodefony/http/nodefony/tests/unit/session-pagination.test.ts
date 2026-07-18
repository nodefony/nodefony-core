/// <reference types="node" />
import MemorySessionStorage from "../../src/session/storage/MemorySessionStorage";
import RevocationGuardStorage from "../../src/session/storage/RevocationGuardStorage";
import type SessionsService from "../../service/sessions/sessions-service";
import {
  runSessionPaginationContract,
  type PaginatedSessionStorage,
} from "../support/sessionPaginationContract";
import { runSessionStoreContract } from "../support/sessionStoreContract";

/**
 * Le contrat de pagination des sessions, déroulé sur les implémentations portées
 * par `@nodefony/http` lui-même :
 *
 * 1. **`MemorySessionStorage`** — l'implémentation de référence ;
 * 2. **`RevocationGuardStorage`** — le décorateur de révocation posé sur TOUT
 *    store actif. Le brancher sur le MÊME banc prouve qu'il transmet la capacité
 *    fidèlement : un décorateur qui « perdrait » `listPage` ferait basculer toute
 *    la console admin en 501, silencieusement.
 *
 * Les adapters (Drizzle, Mongoose, Redis) déroulent ce même banc chez eux, sur
 * des bases réelles.
 */

/** Manager minimal : le store ne lit que les timeouts et journalise. */
function makeManager(): SessionsService {
  return {
    options: { idleTimeoutS: 3600, absoluteTimeoutS: 86_400 },
    log: () => {},
  } as unknown as SessionsService;
}

describe("MemorySessionStorage — pagination", () => {
  let storage: MemorySessionStorage;
  runSessionPaginationContract({
    mode: "offset",
    storage: () => storage as unknown as PaginatedSessionStorage,
    clear: async () => {
      storage = new MemorySessionStorage(makeManager());
    },
  });
});

describe("MemorySessionStorage — contrat comportemental", () => {
  // Le store des tests de charge et de la CI : ses invariants de cycle de vie
  // (createdAt insert-only, touch, gc sur les deux bornes) valent autant que
  // ceux d'un backend persistant — c'est lui qui porte les sessions quand on
  // mesure le framework.
  let storage: MemorySessionStorage;
  runSessionStoreContract({
    storage: () => storage,
    clear: async () => {
      storage = new MemorySessionStorage(makeManager());
    },
    expiry: "applicative",
    touch: true,
  });
});

describe("RevocationGuardStorage — la décoration préserve la pagination", () => {
  let storage: RevocationGuardStorage;
  runSessionPaginationContract({
    mode: "offset",
    storage: () => storage as unknown as PaginatedSessionStorage,
    clear: async () => {
      storage = new RevocationGuardStorage(
        new MemorySessionStorage(makeManager()),
      );
    },
  });
});

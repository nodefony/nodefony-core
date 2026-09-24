import { MemoryTotpSecretStore } from "../../nodefony/src/totp/MemoryTotpSecretStore";
import { runTotpStoreContract } from "../support/totpStoreContract";

// Le store mémoire pilote le MÊME banc de contrat que Drizzle/Mongoose. Sans
// `newStore` (pas de base à relire) ni `countFor` (unicité structurelle : la
// `Map` est indexée par `userId`) — deux capacités que le banc saute en le disant.
let store = new MemoryTotpSecretStore();
describe("MemoryTotpSecretStore — contrat ITotpSecretStore", () => {
  runTotpStoreContract({
    store: () => store,
    clear: async () => {
      store = new MemoryTotpSecretStore();
    },
  });
});

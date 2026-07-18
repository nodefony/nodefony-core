import { MemoryTotpSecretStore } from "../../nodefony/src/totp/MemoryTotpSecretStore";
import { runTotpPaginationContract } from "../support/totpPaginationContract";

// Le store mémoire pilote le MÊME banc de contrat que Drizzle.
// `clear` = instance fraîche (la Map interne n'a pas d'API de purge publique).
let store = new MemoryTotpSecretStore();
runTotpPaginationContract({
  store: () => store,
  clear: async () => {
    store = new MemoryTotpSecretStore();
  },
});

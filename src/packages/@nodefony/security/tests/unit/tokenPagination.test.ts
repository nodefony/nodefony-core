import { MemoryTokenStore } from "../../nodefony/src/token/MemoryTokenStore";
import { runTokenPaginationContract } from "../support/tokenPaginationContract";

// Le store mémoire pilote le MÊME banc de contrat que Drizzle/Mongoose/Redis.
// `clear` = instance fraîche (la Map interne n'a pas d'API de purge publique).
let store = new MemoryTokenStore();
runTokenPaginationContract({
  store: () => store,
  clear: async () => {
    store = new MemoryTokenStore();
  },
  mode: "offset",
});

import { MemoryTokenStore } from "../../nodefony/src/token/MemoryTokenStore";
import { runTokenStoreContract } from "../support/tokenStoreContract";

// Le store mémoire pilote le MÊME banc de contrat que Drizzle/Mongoose. Pas de
// `clear` : le banc re-fabrique une instance vierge après chaque purge.
describe("MemoryTokenStore — contrat ITokenStore", () => {
  runTokenStoreContract({
    create: (now, retention) => new MemoryTokenStore(now, retention),
  });
});

import { MemoryWebAuthnCredentialStore } from "../../nodefony/src/webauthn/MemoryWebAuthnCredentialStore";
import { runWebAuthnPaginationContract } from "../support/webauthnPaginationContract";

// Le store mémoire pilote le MÊME banc de contrat que Drizzle/Mongoose/Redis.
// `clear` = instance fraîche (les Map internes n'ont pas d'API de purge publique).
let store = new MemoryWebAuthnCredentialStore();
runWebAuthnPaginationContract({
  store: () => store,
  mode: "offset",
  clear: async () => {
    store = new MemoryWebAuthnCredentialStore();
  },
});

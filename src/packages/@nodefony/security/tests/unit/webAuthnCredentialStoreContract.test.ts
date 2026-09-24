import { MemoryWebAuthnCredentialStore } from "../../nodefony/src/webauthn/MemoryWebAuthnCredentialStore";
import { runWebAuthnStoreContract } from "../support/webAuthnStoreContract";

// Le store mémoire pilote le MÊME banc de contrat que Drizzle/Mongoose.
// `clear` = instance fraîche (pas d'API de purge publique).
let store = new MemoryWebAuthnCredentialStore();
describe("MemoryWebAuthnCredentialStore — contrat IWebAuthnCredentialStore", () => {
  runWebAuthnStoreContract({
    store: () => store,
    clear: async () => {
      store = new MemoryWebAuthnCredentialStore();
    },
  });
});

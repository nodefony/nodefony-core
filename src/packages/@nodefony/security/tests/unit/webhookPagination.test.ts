import { MemoryWebhookStore } from "../../nodefony/src/webhook/MemoryWebhookStore";
import { runWebhookPaginationContract } from "../support/webhookPaginationContract";

// Le store mémoire pilote le MÊME banc de contrat que Drizzle/Mongoose.
// `clear` = instance fraîche (la Map interne n'a pas d'API de purge publique).
let store = new MemoryWebhookStore();
runWebhookPaginationContract({
  store: () => store,
  clear: async () => {
    store = new MemoryWebhookStore();
  },
});

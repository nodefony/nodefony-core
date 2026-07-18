import { MemoryAuditStore } from "../../nodefony/src/audit/MemoryAuditStore";
import { runAuditPaginationContract } from "../support/auditPaginationContract";

// Le store mémoire pilote le MÊME banc de contrat que Drizzle (sqlite/pg/mysql).
// `clear` = instance fraîche (le ring interne n'a pas d'API de purge publique).
let store = new MemoryAuditStore();
runAuditPaginationContract({
  store: () => store,
  clear: async () => {
    store = new MemoryAuditStore();
  },
});

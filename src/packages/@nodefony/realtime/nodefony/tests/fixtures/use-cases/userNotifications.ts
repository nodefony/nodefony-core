import { getRealtimeHub } from "../../../../index";

/** Depuis un service, un job ou un contrôleur : rien à déclarer, aucun canal à écrire. */
export function notifyInvoicePaid(userId: string, invoice: string): void {
  getRealtimeHub().publishToUser(userId, { kind: "invoice:paid", invoice });
}

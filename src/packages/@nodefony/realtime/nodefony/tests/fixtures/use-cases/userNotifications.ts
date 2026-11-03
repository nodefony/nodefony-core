import { Module, Service, injectable } from "nodefony";
import { getRealtimeHub } from "../../../../index";

/**
 * La facturation. Prévenir quelqu'un est un geste MÉTIER : il part d'un
 * service, d'un job ou d'un contrôleur — rien à déclarer, aucun canal à écrire.
 */
@injectable()
export class BillingService extends Service {
  constructor(module: Module) {
    super("billing", module.container ?? undefined, module.notificationsCenter);
  }

  /** Une facture payée : sa propriétaire l'apprend sur tous ses onglets, elle seule. */
  invoicePaid(userId: string, invoice: string): void {
    getRealtimeHub().publishToUser(userId, { kind: "invoice:paid", invoice });
  }
}

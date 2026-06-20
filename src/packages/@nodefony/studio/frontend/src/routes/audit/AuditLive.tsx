/**
 * Abonnement live au canal `security:audit` — composant INVISIBLE monté
 * conditionnellement (`{live && <AuditLive/>}`). Tant qu'il n'est pas monté, aucun
 * abonnement (ref-compté → 0 ticker serveur quand le switch est OFF). À chaque
 * batch coalescé reçu, remonte au parent qui fusionne en tête de liste.
 *
 * ⚠️ Le canal n'est pas encore servi par la socket Studio (cf `auditModel`
 * `SECURITY_AUDIT_CHANNEL`) : ce composant est PRÊT, il restera muet jusqu'au
 * branchement backend (P6.15 sécurisation Studio). Aucune erreur s'il ne reçoit rien.
 */
import { useNodefonyChannel } from "nodefony/react";
import { SECURITY_AUDIT_CHANNEL, type AuditBatch } from "./auditModel";

export interface AuditLiveProps {
  /** Appelé à chaque batch reçu (events + nb omis sous surcharge). */
  onBatch: (batch: AuditBatch) => void;
}

export function AuditLive({ onBatch }: AuditLiveProps) {
  useNodefonyChannel(SECURITY_AUDIT_CHANNEL, (payload) => {
    const batch = payload as AuditBatch | null;
    if (batch && Array.isArray(batch.events)) {
      onBatch(batch);
    }
  });
  return null;
}
